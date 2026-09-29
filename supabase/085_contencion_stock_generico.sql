-- 085_contencion_stock_generico.sql — R2 contención de seguridad.
--
-- Objetivo: ningún actor de la API salvo Admin activo puede mutar cuartos
-- fríos con deltas arbitrarios. Tras 084 y el cutover 2A ningún flujo vivo de
-- Chofer/Producción usa update_stocks_atomic; quedaban dependencias ANIDADAS
-- (registrar_produccion, registrar_transformacion, cerrar_ruta_atomic) que
-- corrían con el actor Producción/Admin dentro del RPC genérico.
--
-- 1. Los tres contratos escriben el cuarto con stock_mov_cuarto (084: interno,
--    sin EXECUTE de API, SKU válido, lock del cuarto, sin negativos, kardex
--    con cuarto_id y referencia). Mismas cantidades, cuartos, tipos, orígenes,
--    transacción, rollback, filas de producción, empaque, merma de proceso,
--    costos y atribución (etiqueta del actor).
-- 2. update_stocks_atomic: fin_actor_permitido(['Admin']) para la API (sin
--    JWT y service_role conservan la semántica de mantenimiento existente);
--    validación previa de SKU contra productos (rechazo completo, sin llaves
--    nuevas); kardex con cuarto_id. Sin app.fin_ctx.
-- 3. Guard 078: la transición Pendiente firma → Cargada de un Chofer exige la
--    marca transaccional app.carga_ctx que solo fija confirmar_carga_ruta; la
--    compensación Cargada → Pendiente firma desaparece (sin llamador vivo).
--    Estados del Chofer: Programada → Pendiente firma; Pendiente firma →
--    Cargada (solo contrato); Cargada → En progreso; En progreso → Cerrada.
-- Fuera de alcance (funcional, diagnosticado): doble descuento de merma de
-- ruta (072), retorno al almacén en no-entrega, devolución de ruta. Idempotente.

-- ═══ 1. Contratos 076/069: primitivo interno en lugar del RPC genérico ═══
CREATE OR REPLACE FUNCTION public.registrar_produccion(
  p_operacion_id UUID,
  p_turno        TEXT,
  p_maquina      TEXT,
  p_sku          TEXT,
  p_cantidad     INTEGER,
  p_cuarto_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_turno    TEXT := btrim(COALESCE(p_turno, ''));
  v_maquina  TEXT := btrim(COALESCE(p_maquina, ''));
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_actor    TEXT;
  v_uid      BIGINT;
  v_prod     RECORD;
  v_emp      RECORD;
  v_cf       RECORD;
  v_prev     produccion%ROWTYPE;
  v_id       BIGINT;
  v_folio    TEXT;
  v_empaque  TEXT;
  v_costo_u  NUMERIC := 0;
  v_total    NUMERIC := 0;
  v_mov      BIGINT;
  v_concepto TEXT;
  v_hoy      DATE := fin_hoy();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_produccion: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();
  v_uid   := erp_usuario_id();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_produccion: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_turno = '' OR v_maquina = '' THEN
    RAISE EXCEPTION 'registrar_produccion: turno y máquina son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_produccion: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;

  -- Replay (petición ya confirmada): mismo resultado, cero efectos nuevos.
  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  SELECT id, sku, tipo, empaque_sku INTO v_prod FROM productos WHERE sku = v_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_prod.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_produccion: % no es Producto Terminado', v_sku USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  -- Empaque: resuelto en el servidor; 1 unidad por unidad producida.
  v_empaque := NULLIF(btrim(COALESCE(v_prod.empaque_sku, '')), '');
  IF v_empaque IS NOT NULL THEN
    IF v_empaque = v_sku THEN
      RAISE EXCEPTION 'registrar_produccion: el empaque de % apunta al mismo SKU', v_sku USING ERRCODE = '22023';
    END IF;
    SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_produccion: empaque % no existe en el catálogo', v_empaque USING ERRCODE = '22023';
    END IF;
    v_costo_u := COALESCE(v_emp.costo_unitario, 0);
  END IF;

  v_folio := 'OP-' || lpad(nextval('folio_op_seq'::regclass)::text, 3, '0');

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id, empaque_sku, empaque_cantidad)
  VALUES (p_operacion_id, v_folio, v_turno, v_maquina, v_sku, p_cantidad, 'Confirmada', 'Produccion', v_cuarto,
          v_empaque, CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- Otra llamada concurrente con el mismo operacion_id confirmó primero.
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  -- Consumo de empaque por el contrato seguro de 071 (lock, sin negativos,
  -- kardex con el actor real). Si no alcanza, aborta TODO.
  IF v_empaque IS NOT NULL THEN
    PERFORM update_productos_stock_atomic(jsonb_build_array(jsonb_build_object(
      'sku', v_empaque, 'delta', -p_cantidad, 'tipo', 'Salida', 'origen', 'Producción ' || v_folio)));
  END IF;

  -- Entrada del producto terminado al cuarto (contrato seguro de 071).
  -- 085: escritura directa del cuarto vía el primitivo interno (084), no el RPC
  -- genérico: misma cantidad, cuarto, tipo, origen y atribución (v_actor); el
  -- kardex gana cuarto_id y referencia estructurada.
  PERFORM stock_mov_cuarto(v_cuarto, v_sku, p_cantidad, 'Entrada',
    'Entrada a ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_folio,
    NULL, 'produccion/' || v_folio, v_actor, NULL, NULL);

  -- Costo (D6): cantidad × costo unitario del empaque, en el servidor.
  IF v_empaque IS NOT NULL AND v_costo_u > 0 THEN
    v_total := round(p_cantidad * v_costo_u, 2);
    v_concepto := 'Producción ' || v_folio || ': ' || p_cantidad || '× ' || v_sku || ' (empaque: ' || v_empaque || ')';
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
    VALUES (v_hoy, 'Egreso', 'Costo de Ventas', v_concepto, v_total, 'PROD-' || v_id, v_uid)
    RETURNING id INTO v_mov;
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas', v_concepto, v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, v_mov);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total, mov_contable_id = v_mov WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'sku', v_sku, 'cantidad', p_cantidad, 'cuarto_id', v_cuarto,
    'empaque_sku', v_empaque, 'empaque_cantidad', CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END,
    'costo_total', v_total, 'mov_contable_id', v_mov, 'actor', v_actor, 'replay', false);
END $$;

CREATE OR REPLACE FUNCTION public.registrar_transformacion(
  p_operacion_id    UUID,
  p_input_sku       TEXT,
  p_input_cantidad  INTEGER,
  p_output_sku      TEXT,
  p_output_cantidad INTEGER,
  p_cuarto_id       TEXT,
  p_notas           TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_in     TEXT := btrim(COALESCE(p_input_sku, ''));
  v_out    TEXT := btrim(COALESCE(p_output_sku, ''));
  v_cuarto TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_notas  TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_actor  TEXT;
  v_pin    RECORD;
  v_pout   RECORD;
  v_cf     RECORD;
  v_prev   produccion%ROWTYPE;
  v_id     BIGINT;
  v_folio  TEXT;
  v_merma  INTEGER;
  v_merma_id BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_transformacion: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_transformacion: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_input_cantidad IS NULL OR p_input_cantidad <= 0 OR p_output_cantidad IS NULL OR p_output_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_transformacion: las cantidades deben ser mayores a 0' USING ERRCODE = '22023';
  END IF;
  IF p_output_cantidad > p_input_cantidad THEN
    RAISE EXCEPTION 'registrar_transformacion: la salida no puede superar la entrada' USING ERRCODE = '22023';
  END IF;
  IF v_in = v_out THEN
    RAISE EXCEPTION 'registrar_transformacion: insumo y producto destino deben ser distintos' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN registrar_transformacion__replay(v_prev, v_in, p_input_cantidad, v_out, p_output_cantidad, v_cuarto);
  END IF;

  SELECT id, sku, tipo INTO v_pin FROM productos WHERE sku = v_in;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: insumo no encontrado: %', v_in USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pin.tipo, '') NOT IN ('Materia Prima', 'Insumo') THEN
    RAISE EXCEPTION 'registrar_transformacion: % no es un insumo', v_in USING ERRCODE = '22023';
  END IF;
  SELECT id, sku, tipo INTO v_pout FROM productos WHERE sku = v_out;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: producto destino no encontrado: %', v_out USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pout.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_transformacion: % no es Producto Terminado', v_out USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_merma := p_input_cantidad - p_output_cantidad;
  v_folio := 'TR-' || lpad(nextval('folio_op_seq'::regclass)::text, 3, '0');

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo,
                          input_sku, input_kg, output_kg, merma_kg, rendimiento, destino, cuarto_id)
  VALUES (p_operacion_id, v_folio, 'Transformación', 'Manual', v_out, p_output_cantidad, 'Confirmada', 'Transformacion',
          v_in, p_input_cantidad, p_output_cantidad, v_merma, round(p_output_cantidad::numeric / p_input_cantidad * 100, 2),
          v_notas, v_cuarto)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    RETURN registrar_transformacion__replay(v_prev, v_in, p_input_cantidad, v_out, p_output_cantidad, v_cuarto);
  END IF;

  -- Insumo (productos.stock) → contrato seguro de 071; si no alcanza, aborta todo.
  PERFORM update_productos_stock_atomic(jsonb_build_array(jsonb_build_object(
    'sku', v_in, 'delta', -p_input_cantidad, 'tipo', 'Salida', 'origen', 'Transformación ' || v_folio || ' → ' || v_out)));
  -- Output al cuarto frío → contrato seguro de 071.
  -- 085: primitivo interno (084) en lugar del RPC genérico; mismas cantidades.
  PERFORM stock_mov_cuarto(v_cuarto, v_out, p_output_cantidad, 'Entrada',
    'Transformación ' || v_folio || ' de ' || v_in || ' → ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto),
    NULL, 'transformacion/' || v_folio, v_actor, NULL, NULL);
  -- Merma de proceso (072): sin efecto de stock propio; mismas invariantes.
  IF v_merma > 0 THEN
    v_merma_id := (registrar_merma(v_in, v_merma, 'Merma de proceso — transformación', 'Transformación ' || v_folio,
                                   NULL, NULL, false) ->> 'id')::BIGINT;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'input_sku', v_in, 'input_cantidad', p_input_cantidad,
    'output_sku', v_out, 'output_cantidad', p_output_cantidad, 'cuarto_id', v_cuarto,
    'merma', v_merma, 'merma_id', v_merma_id, 'actor', v_actor, 'replay', false);
END $$;

CREATE OR REPLACE FUNCTION cerrar_ruta_atomic(
  p_ruta_id BIGINT,
  p_devoluciones JSONB,
  p_cuarto_frio_id TEXT,
  p_entregas JSONB,
  p_total_cobrado NUMERIC,
  p_total_credito NUMERIC,
  p_usuario TEXT
) RETURNS JSONB AS $$
DECLARE
  v_ruta rutas%ROWTYPE;
  v_changes JSONB := '[]'::jsonb;
  v_chg     JSONB;
  v_sku TEXT;
  v_qty INT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'cerrar_ruta_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF v_ruta IS NULL THEN
    RAISE EXCEPTION 'Ruta % no encontrada', p_ruta_id;
  END IF;
  IF v_ruta.estatus = 'Cerrada' THEN
    RAISE EXCEPTION 'Ruta % ya está cerrada', p_ruta_id;
  END IF;

  UPDATE rutas SET
    estatus       = 'Cerrada',
    cierre_at     = NOW(),
    devolucion    = p_devoluciones,
    total_cobrado = p_total_cobrado,
    total_credito = p_total_credito
  WHERE id = p_ruta_id;

  IF p_devoluciones IS NOT NULL AND jsonb_typeof(p_devoluciones) = 'object' THEN
    FOR v_sku, v_qty IN
      SELECT key, value::INT
        FROM jsonb_each_text(p_devoluciones)
       WHERE NULLIF(value, '') IS NOT NULL
    LOOP
      IF v_qty > 0 THEN
        v_changes := v_changes || jsonb_build_object(
          'cuarto_id', p_cuarto_frio_id,
          'sku',       v_sku,
          'delta',     v_qty,
          'tipo',      'Entrada',
          'origen',    'Devolución ruta ' || v_ruta.folio,
          'usuario',   p_usuario
        );
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    -- 085: devoluciones al cuarto vía el primitivo interno (084), no el RPC
    -- genérico. Misma cantidad, cuarto, tipo y origen; atribución = actor
    -- autenticado (igual que hacía el RPC genérico, que ignoraba 'usuario').
    FOR v_chg IN SELECT * FROM jsonb_array_elements(v_changes) LOOP
      PERFORM stock_mov_cuarto(v_chg ->> 'cuarto_id', v_chg ->> 'sku', (v_chg ->> 'delta')::INTEGER, v_chg ->> 'tipo',
        v_chg ->> 'origen', NULL, 'devolucion_ruta/' || COALESCE(v_ruta.folio, p_ruta_id::text), erp_actor_etiqueta(), p_ruta_id, NULL);
    END LOOP;
  END IF;

  IF p_total_cobrado > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, created_at)
    VALUES (
      CURRENT_DATE,
      'Ingreso',
      'Ventas',
      'Cobros ruta ' || v_ruta.folio || ' — ' || v_ruta.nombre,
      p_total_cobrado,
      NOW()
    );
  END IF;

  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES (
    'Cerrar',
    'Rutas',
    v_ruta.folio || ' — Cobrado: $' || p_total_cobrado || ', Crédito: $' || p_total_credito,
    p_usuario,
    NOW()
  );

  RETURN jsonb_build_object(
    'success',       true,
    'ruta_id',       p_ruta_id,
    'folio',         v_ruta.folio,
    'total_cobrado', p_total_cobrado,
    'total_credito', p_total_credito
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error cerrando ruta: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ═══ 2. RPC genérico: Admin en la API + SKU válido ═══
CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  change      JSONB;
  v_cuarto_id TEXT;
  v_sku       TEXT;
  v_delta     INTEGER;
  v_tipo      TEXT;
  v_origen    TEXT;
  v_usuario   TEXT;
  v_current   INTEGER;
  v_new       INTEGER;
  v_updated   INTEGER := 0;
BEGIN
  -- 085: solo Admin activo desde la API. Sin JWT (SQL/mantenimiento) y
  -- service_role conservan la semántica previa de fin_actor_permitido. Los
  -- contratos de negocio (076, 069, 084) ya no pasan por aquí: usan
  -- stock_mov_cuarto. Sin bypass por app.fin_ctx.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'update_stocks_atomic: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_usuario := erp_actor_etiqueta();
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'update_stocks_atomic: p_changes debe ser un array';
  END IF;
  -- 085: validación previa de TODOS los SKU (catálogo productos) antes de tocar
  -- nada: un SKU desconocido rechaza la operación completa y nunca crea llaves.
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_sku := change->>'sku';
    IF v_sku IS NULL OR NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'update_stocks_atomic: SKU no encontrado: %', COALESCE(v_sku, '(nulo)') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := change->>'cuarto_id';
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');
    IF v_cuarto_id IS NULL OR v_sku IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'update_stocks_atomic: cuarto_id, sku y delta son obligatorios';
    END IF;
    SELECT COALESCE((stock->>v_sku)::INTEGER, 0)
      INTO v_current
      FROM cuartos_frios
     WHERE id = v_cuarto_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuarto frío no encontrado: %', v_cuarto_id;
    END IF;
    v_new := v_current + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%',
        v_sku, v_cuarto_id, v_current, ABS(v_delta);
    END IF;
    UPDATE cuartos_frios
       SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_sku], to_jsonb(v_new)),
           updated_at = NOW()
     WHERE id = v_cuarto_id;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, cuarto_id)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario, v_cuarto_id);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'actor', v_usuario);
END;
$$;

-- ═══ 3. Carga confirmada solo por contrato; sin compensación ═══
CREATE OR REPLACE FUNCTION confirmar_carga_ruta(p_operacion_id UUID, p_ruta_id BIGINT, p_firma TEXT DEFAULT NULL,
                                                p_excepcion BOOLEAN DEFAULT false, p_motivo TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol       TEXT := fin_mi_rol_activo();
  v_actor_id  BIGINT := erp_usuario_id();
  v_etiqueta  TEXT := erp_actor_etiqueta();
  v_ruta      rutas%ROWTYPE;
  v_prev      JSONB;
  v_clave     TEXT;
  v_sku       TEXT;
  v_qty       TEXT;
  v_restante  INTEGER;
  v_max       NUMERIC;
  v_cf        RECORD;
  v_disp      INTEGER;
  v_tomar     INTEGER;
  v_asig      JSONB := '[]'::jsonb;
  v_res       JSONB;
  v_excepcion BOOLEAN := COALESCE(p_excepcion, false);
  v_motivo    TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_firma     TEXT := NULLIF(btrim(COALESCE(p_firma, '')), '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción', 'Chofer']) THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF v_excepcion AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la excepción requiere motivo' USING ERRCODE = '22023';
  END IF;
  IF NOT v_excepcion AND v_firma IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: firma requerida' USING ERRCODE = '22023';
  END IF;

  v_clave := 'carga|' || p_ruta_id || '|' || CASE WHEN v_excepcion THEN 'exc' ELSE 'firma' END;
  v_prev := stock_op_replay(p_operacion_id, 'carga_ruta', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF fin_jwt_role() = 'authenticated' AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;
  IF v_ruta.carga_confirmada_at IS NOT NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % ya tiene carga confirmada', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  IF v_ruta.estatus <> 'Pendiente firma' THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % está en % (se requiere Pendiente firma)', v_ruta.folio, v_ruta.estatus USING ERRCODE = '22023';
  END IF;
  IF v_ruta.carga_real IS NULL OR jsonb_typeof(v_ruta.carga_real) <> 'object'
     OR NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_ruta.carga_real) WHERE COALESCE(value, '0') ~ '^[0-9]+$' AND value::INTEGER > 0) THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % no tiene carga real registrada', v_ruta.folio USING ERRCODE = '22023';
  END IF;

  -- La fila de operación va antes del kardex (FK inventario_mov.operacion_id); el
  -- resultado se completa al final. Si algo falla, todo se revierte junto.
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, resultado)
  VALUES (p_operacion_id, 'carga_ruta', v_clave, v_actor_id, v_etiqueta, p_ruta_id, '{}'::jsonb);

  -- Bloquear TODOS los cuartos en orden de id antes de asignar (determinista, sin deadlock).
  PERFORM 1 FROM cuartos_frios ORDER BY id FOR UPDATE;

  FOR v_sku, v_qty IN SELECT key, value FROM jsonb_each_text(v_ruta.carga_real) ORDER BY key LOOP
    IF v_qty IS NULL OR v_qty !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: cantidad inválida para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_restante := v_qty::INTEGER;
    IF v_restante = 0 THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
    END IF;
    v_max := COALESCE((v_ruta.carga_autorizada ->> v_sku)::NUMERIC, 0) + COALESCE((v_ruta.extra_autorizado ->> v_sku)::NUMERIC, 0);
    IF v_restante > v_max THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: % (%) supera lo autorizado (%)', v_sku, v_restante, v_max USING ERRCODE = '22023';
    END IF;
    FOR v_cf IN SELECT id, COALESCE((stock ->> v_sku)::INTEGER, 0) AS disp FROM cuartos_frios ORDER BY id LOOP
      EXIT WHEN v_restante <= 0;
      v_disp := v_cf.disp;
      IF v_disp <= 0 THEN CONTINUE; END IF;
      v_tomar := LEAST(v_disp, v_restante);
      PERFORM stock_mov_cuarto(v_cf.id, v_sku, -v_tomar, 'Salida', 'Carga ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text) || CASE WHEN v_excepcion THEN ' (sin firma)' ELSE '' END,
                               'Ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text), 'carga_ruta/' || COALESCE(v_ruta.folio, p_ruta_id::text), v_etiqueta, p_ruta_id, p_operacion_id);
      v_asig := v_asig || jsonb_build_object('cuarto_id', v_cf.id, 'sku', v_sku, 'cantidad', v_tomar);
      v_restante := v_restante - v_tomar;
    END LOOP;
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Inventario insuficiente para cargar % de % (faltan %)', v_qty, v_sku, v_restante;
    END IF;
  END LOOP;

  -- 085: marca de contexto transaccional que el guard 078 exige para la
  -- transición Pendiente firma → Cargada de un Chofer. Solo este contrato la
  -- fija (set_config no es una RPC expuesta); un UPDATE directo por REST no la
  -- tiene y por tanto no puede fingir una carga confirmada sin descuento.
  PERFORM set_config('app.carga_ctx', p_ruta_id::text, true);
  UPDATE rutas
     SET carga_confirmada_at    = now(),
         carga_confirmada_por   = v_actor_id,
         estatus                = 'Cargada',
         firma_carga            = CASE WHEN v_excepcion THEN NULL ELSE v_firma END,
         firma_excepcion        = v_excepcion,
         firma_excepcion_motivo = CASE WHEN v_excepcion THEN v_motivo ELSE NULL END
   WHERE id = p_ruta_id;
  PERFORM set_config('app.carga_ctx', '', true);

  v_res := jsonb_build_object('ruta_id', p_ruta_id, 'folio', v_ruta.folio, 'estatus', 'Cargada', 'excepcion', v_excepcion,
                              'carga', v_ruta.carga_real, 'asignacion', v_asig, 'actor', v_etiqueta, 'actor_id', v_actor_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION rutas_guard_chofer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol        TEXT := erp_rol_activo();
  v_yo         BIGINT := erp_usuario_id();   -- carga_confirmada_por se compara como texto: bigint en prod, text en esquemas locales (041)
  v_cambios    TEXT[];
  v_permitidas TEXT[];
  v_firma      TEXT[] := ARRAY['estatus', 'carga_confirmada_at', 'carga_confirmada_por',
                               'firma_carga', 'firma_excepcion', 'firma_excepcion_motivo'];
  v_sku        TEXT;
  v_qty        TEXT;
  v_max        NUMERIC;
BEGIN
  -- Solo restringe al actor Chofer activo. Admin (admin_all), service_role y
  -- SQL sin JWT siguen igual; Ventas/Producción no tienen policy de UPDATE.
  IF v_rol IS DISTINCT FROM 'Chofer' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key) INTO v_cambios
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key <> 'updated_at';            -- la pone trg_rutas_upd
  IF v_cambios IS NULL THEN
    RETURN NEW;                            -- sin cambios: inofensivo
  END IF;

  IF OLD.estatus = 'Programada' AND NEW.estatus = 'Pendiente firma' THEN
    v_permitidas := ARRAY['estatus', 'carga_real', 'carga_solicitada_at'];
    IF OLD.carga_confirmada_at IS NOT NULL THEN
      RAISE EXCEPTION 'rutas: la ruta % ya tiene carga confirmada', OLD.id USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Pendiente firma' AND NEW.estatus = 'Cargada' THEN
    -- 085: la confirmación de carga SOLO ocurre dentro de confirmar_carga_ruta
    -- (firma + descuento + kardex en una transacción). Un UPDATE directo del
    -- Chofer por REST no lleva la marca app.carga_ctx y se rechaza: no se puede
    -- fingir una carga confirmada sin descontar stock.
    v_permitidas := v_firma;
    IF COALESCE(current_setting('app.carga_ctx', true), '') IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'rutas: la carga se confirma con confirmar_carga_ruta, no por UPDATE directo' USING ERRCODE = '42501';
    END IF;
    IF OLD.carga_confirmada_at IS NOT NULL OR NEW.carga_confirmada_at IS NULL
       OR NEW.carga_confirmada_por::TEXT IS DISTINCT FROM v_yo::TEXT THEN
      RAISE EXCEPTION 'rutas: firma de carga inválida para la ruta %', OLD.id USING ERRCODE = '42501';
    END IF;
  -- 085: la transición de compensación Cargada → Pendiente firma desaparece:
  -- el contrato es atómico y ningún flujo desplegado la necesita.
  ELSIF OLD.estatus = 'Cargada' AND NEW.estatus = 'En progreso' THEN
    v_permitidas := ARRAY['estatus'];
  ELSIF OLD.estatus = 'En progreso' AND NEW.estatus = 'Cerrada' THEN
    v_permitidas := ARRAY['estatus', 'fecha_fin'];
  ELSE
    RAISE EXCEPTION 'rutas: transición % → % no permitida para Chofer', OLD.estatus, NEW.estatus
      USING ERRCODE = '42501';
  END IF;

  IF NOT (v_cambios <@ v_permitidas) THEN
    RAISE EXCEPTION 'rutas: Chofer no puede modificar % (en % → % solo %)',
      array_to_string(v_cambios, ', '), OLD.estatus, NEW.estatus, array_to_string(v_permitidas, ', ')
      USING ERRCODE = '42501';
  END IF;

  -- La carga real nunca supera lo autorizado por Admin (misma regla que el
  -- cliente, ahora en el servidor). Solo cuenta lo autorizado ANTES del UPDATE.
  IF 'carga_real' = ANY (v_cambios) THEN
    IF NEW.carga_real IS NULL OR jsonb_typeof(NEW.carga_real) <> 'object' THEN
      RAISE EXCEPTION 'rutas: carga_real inválida' USING ERRCODE = '42501';
    END IF;
    FOR v_sku, v_qty IN SELECT key, value FROM jsonb_each_text(NEW.carga_real) LOOP
      IF v_qty IS NULL OR v_qty !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'rutas: cantidad inválida para % en carga_real', v_sku USING ERRCODE = '42501';
      END IF;
      v_max := COALESCE((OLD.carga_autorizada ->> v_sku)::NUMERIC, 0)
             + COALESCE((OLD.extra_autorizado ->> v_sku)::NUMERIC, 0);
      IF v_qty::NUMERIC > v_max THEN
        RAISE EXCEPTION 'rutas: carga_real de % (%) supera lo autorizado (%)', v_sku, v_qty, v_max
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;
