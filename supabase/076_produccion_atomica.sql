-- 076_produccion_atomica.sql — F3 / rediseño 076, FASE ADITIVA.
--
-- Producir-y-congelar y transformar hoy son 5-11 llamadas API independientes
-- con compensaciones del frontend que pueden fallar (fila de produccion
-- huérfana, empaque descontado sin producción, costo sin registrar). Esta
-- migración agrega contratos atómicos en el servidor; NO cambia policies ni
-- el frontend (fase aditiva: el frontend actual sigue funcionando igual).
--
--   registrar_produccion     produccion + consumo de empaque + entrada al
--                            cuarto + kardex + costo + costos_historial +
--                            movimientos_contables, todo o nada.
--   registrar_transformacion produccion + consumo del insumo + entrada del
--                            output + kardex + merma de proceso, todo o nada,
--                            sin contabilidad (D9).
--
-- Seguridad: SECURITY DEFINER, search_path fijo, actor canónico de 071 vía
-- fin_actor_permitido(ARRAY['Admin','Producción']). NUNCA se marca el contexto
-- interno (fin_marcar_ctx): los contratos de stock anidados (071) vuelven a
-- evaluar al mismo actor del JWT con sus propias listas de roles, y la
-- atribución del kardex sigue siendo el actor real.
-- Idempotencia: operacion_id (UUID del cliente) UNIQUE; un reintento devuelve
-- el resultado guardado (replay) sin efectos nuevos; mismo operacion_id con
-- datos distintos se rechaza.
-- Único efecto no reversible ante un fallo: el número de folio consumido de
-- folio_op_seq (hueco en la secuencia, igual que hoy).
--
-- También (D12): rename_sku actualiza produccion.empaque_sku.
-- Idempotente.

-- ═══════════════════════════════════════════════════════════════
-- 1. Referencias en produccion (D8)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS operacion_id     UUID;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS cuarto_id        TEXT;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS empaque_sku      TEXT;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS empaque_cantidad INTEGER;
-- Sin FK a propósito (como mermas.mov_contable_id en 072): rastro estable.
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS mov_contable_id  BIGINT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produccion_operacion_id_key') THEN
    ALTER TABLE produccion ADD CONSTRAINT produccion_operacion_id_key UNIQUE (operacion_id);
  END IF;
END $$;

COMMENT ON COLUMN produccion.operacion_id IS 'UUID de la operación del cliente (idempotencia de registrar_produccion / registrar_transformacion).';
COMMENT ON COLUMN produccion.cuarto_id IS 'Cuarto frío donde entró el producto terminado.';
COMMENT ON COLUMN produccion.empaque_sku IS 'Empaque consumido (resuelto en el servidor desde productos.empaque_sku).';
COMMENT ON COLUMN produccion.empaque_cantidad IS 'Unidades de empaque consumidas (1 por unidad producida).';
COMMENT ON COLUMN produccion.mov_contable_id IS 'Egreso de Costo de Ventas creado con la producción.';

-- ═══════════════════════════════════════════════════════════════
-- 2. registrar_produccion
-- ═══════════════════════════════════════════════════════════════
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
  PERFORM update_stocks_atomic(jsonb_build_array(jsonb_build_object(
    'cuarto_id', v_cuarto, 'sku', v_sku, 'delta', p_cantidad, 'tipo', 'Entrada',
    'origen', 'Entrada a ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_folio)));

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

-- Resultado de un replay: exige los mismos datos de negocio.
CREATE OR REPLACE FUNCTION public.registrar_produccion__replay(
  p_row produccion, p_turno TEXT, p_maquina TEXT, p_sku TEXT, p_cantidad INTEGER, p_cuarto TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_row.tipo IS DISTINCT FROM 'Produccion' OR p_row.sku IS DISTINCT FROM p_sku OR p_row.cantidad IS DISTINCT FROM p_cantidad
     OR p_row.cuarto_id IS DISTINCT FROM p_cuarto OR p_row.turno IS DISTINCT FROM p_turno OR p_row.maquina IS DISTINCT FROM p_maquina THEN
    RAISE EXCEPTION 'registrar_produccion: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'id', p_row.id, 'folio', p_row.folio, 'sku', p_row.sku, 'cantidad', p_row.cantidad, 'cuarto_id', p_row.cuarto_id,
    'empaque_sku', p_row.empaque_sku, 'empaque_cantidad', p_row.empaque_cantidad,
    'costo_total', p_row.costo_total, 'mov_contable_id', p_row.mov_contable_id, 'replay', true);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. registrar_transformacion (sin contabilidad, D9)
-- ═══════════════════════════════════════════════════════════════
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
  PERFORM update_stocks_atomic(jsonb_build_array(jsonb_build_object(
    'cuarto_id', v_cuarto, 'sku', v_out, 'delta', p_output_cantidad, 'tipo', 'Entrada',
    'origen', 'Transformación ' || v_folio || ' de ' || v_in || ' → ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto))));
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

CREATE OR REPLACE FUNCTION public.registrar_transformacion__replay(
  p_row produccion, p_in TEXT, p_in_cant INTEGER, p_out TEXT, p_out_cant INTEGER, p_cuarto TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_row.tipo IS DISTINCT FROM 'Transformacion' OR p_row.input_sku IS DISTINCT FROM p_in OR p_row.input_kg IS DISTINCT FROM p_in_cant::numeric
     OR p_row.sku IS DISTINCT FROM p_out OR p_row.output_kg IS DISTINCT FROM p_out_cant::numeric OR p_row.cuarto_id IS DISTINCT FROM p_cuarto THEN
    RAISE EXCEPTION 'registrar_transformacion: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'id', p_row.id, 'folio', p_row.folio, 'input_sku', p_row.input_sku, 'input_cantidad', p_row.input_kg,
    'output_sku', p_row.sku, 'output_cantidad', p_row.output_kg, 'cuarto_id', p_row.cuarto_id,
    'merma', p_row.merma_kg, 'replay', true);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 4. rename_sku (074) + produccion.empaque_sku (D12). Resto idéntico a 074.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rename_sku(p_id BIGINT, p_old_sku TEXT, p_new_sku TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old    TEXT := btrim(COALESCE(p_old_sku, ''));
  v_new    TEXT := btrim(COALESCE(p_new_sku, ''));
  v_actual TEXT;
  v_re     TEXT;
  v_token  TEXT;
  v_actor  TEXT;
BEGIN
  -- Autorización primero: un actor no autorizado no deja ningún rastro.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'rename_sku: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();

  IF v_old = '' OR v_new = '' THEN
    RAISE EXCEPTION 'rename_sku: el SKU actual y el nuevo son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_old = v_new THEN
    RETURN;  -- sin cambio: no se toca nada ni se audita
  END IF;
  IF v_new !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' THEN
    RAISE EXCEPTION 'rename_sku: formato de SKU inválido: %', v_new USING ERRCODE = '22023';
  END IF;

  SELECT sku INTO v_actual FROM productos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_sku: producto % no existe', p_id USING ERRCODE = '22023';
  END IF;
  IF v_actual IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'rename_sku: el SKU % no corresponde al producto %', v_old, p_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM productos WHERE sku = v_new) THEN
    RAISE EXCEPTION 'rename_sku: el SKU % ya existe', v_new USING ERRCODE = '23505';
  END IF;

  -- SKU viejo escapado para regex (token exacto en ordenes.productos).
  v_re := regexp_replace(v_old, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
  v_token := '(^|,\s*)([0-9]+(?:\.[0-9]+)?\s*×\s*)' || v_re || '(?=\s*(?:,|$))';

  -- ═══════════════════════════════════════════════════════════
  -- 1. Tablas con SKU como TEXT (referencias directas) — igual que 036
  -- ═══════════════════════════════════════════════════════════
  UPDATE inventario_mov SET producto = v_new WHERE producto = v_old;
  UPDATE mermas SET sku = v_new WHERE sku = v_old;              -- 072: el guard permite solo este cambio
  UPDATE produccion SET sku = v_new WHERE sku = v_old;
  UPDATE produccion SET input_sku = v_new WHERE input_sku = v_old;
  UPDATE precios_esp SET sku = v_new WHERE sku = v_old;
  UPDATE orden_lineas SET sku = v_new WHERE sku = v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 2. ordenes.productos — "25×HC-25K, 10×HC-5K": solo el token exacto
  -- ═══════════════════════════════════════════════════════════
  UPDATE ordenes
     SET productos = regexp_replace(productos, v_token, '\1\2' || v_new, 'g')
   WHERE productos ~ v_token;

  -- ═══════════════════════════════════════════════════════════
  -- 3. cuartos_frios.stock — JSONB con keys SKU (si la nueva existe, suma)
  -- ═══════════════════════════════════════════════════════════
  UPDATE cuartos_frios
  SET stock = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(stock)
      GROUP BY new_key
    ) sub
  )
  WHERE stock ? v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 4. rutas — JSONB en carga, carga_autorizada, extra_autorizado
  -- ═══════════════════════════════════════════════════════════
  UPDATE rutas
  SET carga = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga)
      GROUP BY new_key
    ) sub
  )
  WHERE carga IS NOT NULL AND carga ? v_old;

  UPDATE rutas
  SET carga_autorizada = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga_autorizada)
      GROUP BY new_key
    ) sub
  )
  WHERE carga_autorizada IS NOT NULL AND carga_autorizada ? v_old;

  UPDATE rutas
  SET extra_autorizado = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(extra_autorizado)
      GROUP BY new_key
    ) sub
  )
  WHERE extra_autorizado IS NOT NULL AND extra_autorizado ? v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 5. Referencias vivas adicionales (D2)
  -- ═══════════════════════════════════════════════════════════
  UPDATE productos SET empaque_sku = v_new WHERE empaque_sku = v_old;
  UPDATE umbrales SET sku = v_new WHERE sku = v_old;
  UPDATE produccion SET empaque_sku = v_new WHERE empaque_sku = v_old;   -- 076 (D12): referencia viva de empaque

  -- ═══════════════════════════════════════════════════════════
  -- 6. Finalmente, el catálogo (productos.sku)
  -- ═══════════════════════════════════════════════════════════
  UPDATE productos SET sku = v_new WHERE id = p_id;

  -- Auditoría con el actor real derivado en el servidor.
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_actor, 'Renombrar SKU', 'Productos', v_old || ' → ' || v_new);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5. Grants: RPCs públicas solo para authenticated (autorización interna);
--    los helpers de replay no se exponen.
-- ═══════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.registrar_produccion(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_transformacion(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_produccion(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_transformacion(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.registrar_produccion__replay(produccion, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_transformacion__replay(produccion, TEXT, INTEGER, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rename_sku(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_sku(BIGINT, TEXT, TEXT) TO authenticated, service_role;
