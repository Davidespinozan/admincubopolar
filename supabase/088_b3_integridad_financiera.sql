-- 088_b3_integridad_financiera.sql — B3: cierre de autorización e integridad
-- financiera (parte 1 de 2; la 089 retira el INSERT directo de órdenes una vez
-- desplegado el frontend que usa crear_orden).
--
-- Reglas de negocio aprobadas (sesión 2026-09-29):
--   Precio canónico: precio especial del cliente (precios_esp por cliente_id +
--     sku) si existe; si no, productos.precio. Unitario a centavos; subtotal =
--     round(cantidad × unitario, 2); total = suma redondeada; total > 0; IVA 0%.
--   Crédito: cliente con credito_autorizado y límite − Σ saldo_pendiente de sus
--     CxC no pagadas ≥ monto. Misma ecuación para venta normal y exprés; se
--     decide con el cliente bloqueado en la transacción que crea la CxC.
--   Compra de empaque/materia prima: el costo capturado es el total real de la
--     compra; se liga a una recepción de inventario (Opción A).
--
-- Cambios:
--   1. precios_esp UNIQUE (cliente_id, sku).
--   2. Primitivas internas (sin EXECUTE de API): precio_canonico,
--      lineas_canonicas, fin_validar_credito, fin_actor_id, fin_orden_operable,
--      productos_stock_interno.
--   3. crear_orden (Admin, Ventas): orden Creada + líneas en UNA transacción,
--      precios/total/folio/actor/cliente/stock/crédito del servidor.
--   4. update_orden_atomic: reprecia en el servidor; total y precio del cliente
--      se ignoran.
--   5. crear_cxc_orden: orden entregada, sin pago total, sin CxC previa, monto =
--      pendiente, invariante de crédito con el cliente bloqueado; Chofer solo
--      en su ruta, Ventas solo órdenes sin ruta.
--   6. registrar_pago_orden / registrar_ingreso_orden / abonar_cxc: atribución
--      del servidor; Chofer solo su ruta, Ventas solo órdenes sin ruta.
--   7. cerrar_ruta_financiero (5 args): validación completa de ventas exprés
--      ANTES de cualquier efecto (SKU, cantidad, precio = canónico, cliente,
--      factura, método de pago, crédito); líneas y total del servidor;
--      atribución del servidor. Huella y replay de 086 sin cambio.
--   8. registrar_recepcion_compra / registrar_salida_empaque (Admin, Almacén
--      Bolsas): stock de producto + egreso/CxP atómicos e idempotentes.
--   9. update_productos_stock_atomic: solo Admin; registrar_produccion y
--      registrar_transformacion usan productos_stock_interno.
--  10. Policies: sin Egreso genérico, sin CxP de compra genérica, sin
--      costos_historial de Producción, sin literales muertos (Almacén, Bolsas);
--      ordenes UPDATE: Chofer solo su ruta, Ventas solo órdenes sin ruta.
--  11. clientes: saldo / límite / crédito autorizado solo Admin o contratos.
--  12. auditoria / error_log: actor del servidor; auditoria exige actor activo.
--  13. Ruta cargada y Cerrada: terminal para todo rol con JWT (Admin incluido).
--  14. DROP cerrar_ruta_completa. CHECK de usuarios.rol.

-- ═══ 1. Unicidad del precio especial ═══
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precios_esp_cliente_sku_key') THEN
    ALTER TABLE precios_esp ADD CONSTRAINT precios_esp_cliente_sku_key UNIQUE (cliente_id, sku);
  END IF;
END $$;

ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta', 'recepcion_compra', 'salida_empaque'));

-- ═══ 2. Primitivas internas ═══
CREATE OR REPLACE FUNCTION precio_canonico(p_cliente_id BIGINT, p_sku TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(COALESCE((SELECT e.precio FROM precios_esp e WHERE e.cliente_id = p_cliente_id AND e.sku = p.sku), p.precio, 0), 2)
    FROM productos p WHERE p.sku = btrim(COALESCE(p_sku, ''))
$$;
REVOKE ALL ON FUNCTION precio_canonico(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION lineas_canonicas(p_cliente_id BIGINT, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_i      JSONB;
  v_sku    TEXT;
  v_raw    TEXT;
  v_q      INTEGER;
  v_p      NUMERIC;
  v_sub    NUMERIC;
  v_total  NUMERIC := 0;
  v_lineas JSONB := '[]'::jsonb;
  v_vistos TEXT[] := ARRAY[]::TEXT[];
  v_txt    TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'venta: la venta no tiene productos' USING ERRCODE = '22023';
  END IF;
  FOR v_i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := btrim(COALESCE(v_i ->> 'sku', ''));
    IF v_sku = '' THEN
      RAISE EXCEPTION 'venta: SKU requerido' USING ERRCODE = '22023';
    END IF;
    v_raw := btrim(COALESCE(v_i ->> 'cantidad', ''));
    IF v_raw !~ '^[0-9]+(\.0+)?$' OR v_raw::NUMERIC <= 0 OR v_raw::NUMERIC > 1000000 THEN
      RAISE EXCEPTION 'venta: cantidad inválida para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_q := v_raw::NUMERIC::INTEGER;
    IF v_sku = ANY (v_vistos) THEN
      RAISE EXCEPTION 'venta: SKU repetido en la venta: %', v_sku USING ERRCODE = '22023';
    END IF;
    v_p := precio_canonico(p_cliente_id, v_sku);
    IF v_p IS NULL THEN
      RAISE EXCEPTION 'venta: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
    END IF;
    IF v_p < 0 THEN
      RAISE EXCEPTION 'venta: precio inválido para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_sub := round(v_q * v_p, 2);
    v_total := v_total + v_sub;
    v_vistos := v_vistos || v_sku;
    v_txt := v_txt || (v_q || '×' || v_sku);
    v_lineas := v_lineas || jsonb_build_object('sku', v_sku, 'cantidad', v_q, 'precio_unit', v_p, 'subtotal', v_sub);
  END LOOP;
  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'venta: el total de la orden debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('lineas', v_lineas, 'total', v_total, 'productos', array_to_string(v_txt, ', '));
END $$;
REVOKE ALL ON FUNCTION lineas_canonicas(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

-- Invariante de crédito (misma ecuación que la venta normal del frontend):
-- bloquea al cliente para serializar decisiones concurrentes.
CREATE OR REPLACE FUNCTION fin_validar_credito(p_cliente_id BIGINT, p_monto NUMERIC) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cli  RECORD;
  v_usado NUMERIC;
  v_disp  NUMERIC;
BEGIN
  SELECT id, nombre, credito_autorizado, limite_credito INTO v_cli FROM clientes WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crédito: cliente no encontrado: %', p_cliente_id USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(v_cli.credito_autorizado, false) THEN
    RAISE EXCEPTION 'Cliente no tiene crédito autorizado: %', v_cli.nombre USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(SUM(saldo_pendiente), 0) INTO v_usado FROM cuentas_por_cobrar WHERE cliente_id = p_cliente_id AND estatus IS DISTINCT FROM 'Pagada';
  v_disp := round(COALESCE(v_cli.limite_credito, 0) - v_usado, 2);
  IF round(COALESCE(p_monto, 0), 2) > v_disp THEN
    RAISE EXCEPTION 'Excede límite de crédito. Disponible: %', v_disp USING ERRCODE = '22023';
  END IF;
  RETURN v_disp;
END $$;
REVOKE ALL ON FUNCTION fin_validar_credito(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- Atribución: con JWT de usuario, SIEMPRE el actor canónico; el parámetro
-- solo cuenta para service_role / SQL (backend de confianza).
CREATE OR REPLACE FUNCTION fin_actor_id(p_fallback BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN fin_jwt_role() = 'authenticated' THEN erp_usuario_id() ELSE p_fallback END
$$;
REVOKE ALL ON FUNCTION fin_actor_id(BIGINT) FROM PUBLIC, anon, authenticated;

-- ¿Puede el actor directo operar una orden de esta ruta? Dentro de un
-- contrato (fin_ctx) o sin JWT de usuario, la autorización ya ocurrió.
CREATE OR REPLACE FUNCTION fin_orden_operable(p_ruta_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rol TEXT;
BEGIN
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR fin_ctx_activo() THEN RETURN TRUE; END IF;
  v_rol := COALESCE(erp_rol_activo(), '');
  IF v_rol = 'Admin' THEN RETURN TRUE; END IF;
  IF v_rol = 'Chofer' THEN
    RETURN p_ruta_id IS NOT NULL AND EXISTS (SELECT 1 FROM rutas WHERE id = p_ruta_id AND chofer_id = erp_usuario_id());
  END IF;
  IF v_rol IN ('Ventas', 'Facturación') THEN RETURN p_ruta_id IS NULL; END IF;
  RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION fin_orden_operable(BIGINT) FROM PUBLIC, anon, authenticated;

-- Movimiento de stock a nivel producto (interno): mismo cuerpo que el RPC
-- genérico de 071, sin autorización propia (la hace el contrato llamador).
CREATE OR REPLACE FUNCTION productos_stock_interno(p_changes JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  change    JSONB;
  v_sku     TEXT;
  v_delta   INTEGER;
  v_tipo    TEXT;
  v_origen  TEXT;
  v_usuario TEXT := erp_actor_etiqueta();
  v_current INTEGER;
  v_new     INTEGER;
  v_updated INTEGER := 0;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'productos_stock: p_changes debe ser un array' USING ERRCODE = '22023';
  END IF;
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    v_sku    := btrim(COALESCE(change ->> 'sku', ''));
    IF COALESCE(change ->> 'delta', '') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'productos_stock: delta inválido para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_delta  := (change ->> 'delta')::INTEGER;
    IF v_sku = '' OR v_delta = 0 THEN
      RAISE EXCEPTION 'productos_stock: sku y delta distinto de 0 son obligatorios' USING ERRCODE = '22023';
    END IF;
    v_tipo   := COALESCE(change ->> 'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen := COALESCE(change ->> 'origen', 'Sistema');
    SELECT COALESCE(stock, 0) INTO v_current FROM productos WHERE sku = v_sku FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU no encontrado: %', v_sku USING ERRCODE = '22023';
    END IF;
    v_new := v_current + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente de %: disponible=%, requerido=%', v_sku, v_current, ABS(v_delta);
    END IF;
    UPDATE productos SET stock = v_new WHERE sku = v_sku;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'actor', v_usuario);
END $$;
REVOKE ALL ON FUNCTION productos_stock_interno(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION update_productos_stock_atomic(p_changes JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- 088: solo Admin en la API (sin JWT / service_role conservados). Producción
  -- usa registrar_produccion / registrar_transformacion; Almacén Bolsas usa
  -- registrar_recepcion_compra / registrar_salida_empaque.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'update_productos_stock_atomic: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN productos_stock_interno(p_changes);
END $$;

-- ═══ 3. Contratos 076 sin el RPC genérico de producto ═══
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
    PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
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
  PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
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

-- ═══ 4. Creación canónica de órdenes ═══
CREATE OR REPLACE FUNCTION crear_orden(p_orden JSONB, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cli_id   BIGINT;
  v_cli      RECORD;
  v_nombre   TEXT;
  v_tipo     TEXT;
  v_metodo   TEXT;
  v_fecha    DATE;
  v_lin      JSONB;
  v_total    NUMERIC;
  v_seq      TEXT;
  v_folio    TEXT;
  v_l        JSONB;
  v_disp     INTEGER;
  v_lat      NUMERIC;
  v_lng      NUMERIC;
  v_ord      ordenes%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'crear_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden IS NULL OR jsonb_typeof(p_orden) <> 'object' THEN
    RAISE EXCEPTION 'crear_orden: datos de la orden requeridos' USING ERRCODE = '22023';
  END IF;

  v_cli_id := NULLIF(p_orden ->> 'cliente_id', '')::BIGINT;
  IF v_cli_id IS NOT NULL THEN
    SELECT id, nombre INTO v_cli FROM clientes WHERE id = v_cli_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crear_orden: cliente no encontrado: %', v_cli_id USING ERRCODE = '22023';
    END IF;
    v_nombre := v_cli.nombre;
  ELSE
    v_nombre := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'cliente_nombre', '')), ''), 'Público en general');
  END IF;

  v_tipo := COALESCE(NULLIF(p_orden ->> 'tipo_cobro', ''), 'Contado');
  IF v_tipo NOT IN ('Contado', 'Credito') THEN
    RAISE EXCEPTION 'crear_orden: tipo de cobro inválido: %', v_tipo USING ERRCODE = '22023';
  END IF;
  v_metodo := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'metodo_pago', '')), ''), 'Efectivo');
  IF v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
    RAISE EXCEPTION 'crear_orden: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
  END IF;
  v_fecha := COALESCE(NULLIF(p_orden ->> 'fecha', '')::DATE, fin_hoy());
  v_lat := NULLIF(p_orden ->> 'latitud_entrega', '')::NUMERIC;
  v_lng := NULLIF(p_orden ->> 'longitud_entrega', '')::NUMERIC;

  -- Líneas y total del servidor (precio canónico).
  v_lin := lineas_canonicas(v_cli_id, p_items);
  v_total := (v_lin ->> 'total')::NUMERIC;

  -- Disponibilidad (misma regla que el cliente: suma de cuartos fríos).
  FOR v_l IN SELECT * FROM jsonb_array_elements(v_lin -> 'lineas') LOOP
    SELECT COALESCE(SUM(COALESCE((stock ->> (v_l ->> 'sku'))::INTEGER, 0)), 0) INTO v_disp FROM cuartos_frios;
    IF (v_l ->> 'cantidad')::INTEGER > v_disp THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)', v_l ->> 'sku', v_disp, v_l ->> 'cantidad' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Crédito: misma ecuación y mismo candado que la venta exprés.
  IF v_tipo = 'Credito' AND v_cli_id IS NOT NULL THEN
    PERFORM fin_validar_credito(v_cli_id, v_total);
  END IF;

  -- Folio: misma semántica que el frontend (OV- + padStart(4, '0')).
  v_seq := pg_catalog.nextval('folio_ov_seq'::regclass)::TEXT;
  v_folio := 'OV-' || lpad(v_seq, greatest(4, length(v_seq)), '0');

  INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, vendedor_id, tipo_cobro,
                       requiere_factura, folio_nota, direccion_entrega, referencia_entrega, latitud_entrega, longitud_entrega)
  VALUES (v_folio, v_cli_id, v_nombre, v_lin ->> 'productos', v_fecha, v_total, 'Creada', v_metodo, fin_actor_id(NULL), v_tipo,
          COALESCE((p_orden ->> 'requiere_factura')::BOOLEAN, false),
          NULLIF(btrim(COALESCE(p_orden ->> 'folio_nota', '')), ''),
          NULLIF(btrim(COALESCE(p_orden ->> 'direccion_entrega', '')), ''),
          NULLIF(btrim(COALESCE(p_orden ->> 'referencia_entrega', '')), ''),
          v_lat, v_lng)
  RETURNING * INTO v_ord;

  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT v_ord.id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
    FROM jsonb_array_elements(v_lin -> 'lineas') l;

  RETURN jsonb_build_object('id', v_ord.id, 'folio', v_ord.folio, 'cliente_id', v_ord.cliente_id, 'cliente_nombre', v_ord.cliente_nombre,
    'productos', v_ord.productos, 'total', v_ord.total, 'estatus', v_ord.estatus, 'fecha', v_ord.fecha, 'metodo_pago', v_ord.metodo_pago,
    'tipo_cobro', v_ord.tipo_cobro, 'requiere_factura', v_ord.requiere_factura, 'direccion_entrega', v_ord.direccion_entrega,
    'referencia_entrega', v_ord.referencia_entrega, 'latitud_entrega', v_ord.latitud_entrega, 'longitud_entrega', v_ord.longitud_entrega,
    'vendedor_id', v_ord.vendedor_id, 'lineas', v_lin -> 'lineas');
END $$;
REVOKE ALL ON FUNCTION crear_orden(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crear_orden(JSONB, JSONB) TO authenticated, service_role;

-- ═══ 5. Edición de orden con precio del servidor ═══
CREATE OR REPLACE FUNCTION update_orden_atomic(p_orden_id BIGINT, p_update_fields JSONB, p_lineas JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estatus TEXT;
  v_cli     BIGINT;
  v_items   JSONB;
  v_lin     JSONB;
  v_n       INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'update_orden_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT estatus INTO v_estatus FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_estatus <> 'Creada' THEN
    RAISE EXCEPTION 'Solo se pueden editar órdenes en estatus Creada (actual: %)', v_estatus;
  END IF;

  -- Campos no financieros. total y productos del cliente se ignoran (088):
  -- los deriva el servidor de las líneas.
  IF p_update_fields IS NOT NULL AND jsonb_typeof(p_update_fields) = 'object' THEN
    IF NULLIF(p_update_fields ->> 'cliente_id', '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = (p_update_fields ->> 'cliente_id')::BIGINT) THEN
      RAISE EXCEPTION 'update_orden_atomic: cliente no encontrado' USING ERRCODE = '22023';
    END IF;
    UPDATE ordenes SET
      cliente_nombre     = COALESCE(p_update_fields ->> 'cliente_nombre', cliente_nombre),
      cliente_id         = COALESCE((p_update_fields ->> 'cliente_id')::BIGINT, cliente_id),
      fecha              = COALESCE((p_update_fields ->> 'fecha')::DATE, fecha),
      tipo_cobro         = COALESCE(p_update_fields ->> 'tipo_cobro', tipo_cobro),
      folio_nota         = CASE WHEN p_update_fields ? 'folio_nota' THEN p_update_fields ->> 'folio_nota' ELSE folio_nota END,
      direccion_entrega  = CASE WHEN p_update_fields ? 'direccion_entrega' THEN p_update_fields ->> 'direccion_entrega' ELSE direccion_entrega END,
      referencia_entrega = CASE WHEN p_update_fields ? 'referencia_entrega' THEN p_update_fields ->> 'referencia_entrega' ELSE referencia_entrega END,
      latitud_entrega    = CASE WHEN p_update_fields ? 'latitud_entrega' THEN NULLIF(p_update_fields ->> 'latitud_entrega', '')::NUMERIC ELSE latitud_entrega END,
      longitud_entrega   = CASE WHEN p_update_fields ? 'longitud_entrega' THEN NULLIF(p_update_fields ->> 'longitud_entrega', '')::NUMERIC ELSE longitud_entrega END,
      updated_at         = NOW()
    WHERE id = p_orden_id;
  END IF;

  SELECT cliente_id INTO v_cli FROM ordenes WHERE id = p_orden_id;
  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('sku', e ->> 'sku', 'cantidad', e -> 'cantidad')) INTO v_items FROM jsonb_array_elements(p_lineas) e;
    IF v_items IS NULL THEN v_items := '[]'::jsonb; END IF;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('sku', sku, 'cantidad', cantidad) ORDER BY id) INTO v_items FROM orden_lineas WHERE orden_id = p_orden_id;
  END IF;

  IF v_items IS NOT NULL THEN
    v_lin := lineas_canonicas(v_cli, v_items);
    DELETE FROM orden_lineas WHERE orden_id = p_orden_id;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
    SELECT p_orden_id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
      FROM jsonb_array_elements(v_lin -> 'lineas') l;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE ordenes SET total = (v_lin ->> 'total')::NUMERIC, productos = v_lin ->> 'productos', updated_at = NOW() WHERE id = p_orden_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'orden_id', p_orden_id, 'lineas_insertadas', v_n, 'total', (v_lin ->> 'total')::NUMERIC);
END $$;

-- ═══ 6. CxC, pagos e ingresos ═══
CREATE OR REPLACE FUNCTION crear_cxc_orden(p_orden_id BIGINT, p_dias_vencimiento INT DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ord    ordenes%ROWTYPE;
  v_cli    RECORD;
  v_cxc_id BIGINT;
  v_pagado NUMERIC;
  v_pend   NUMERIC;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'crear_cxc_orden: no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF NOT fin_orden_operable(v_ord.ruta_id) THEN
    RAISE EXCEPTION 'crear_cxc_orden: la orden no pertenece a una ruta del actor' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada', p_orden_id; END IF;
  IF v_ord.estatus NOT IN ('Entregada', 'Facturada') THEN
    RAISE EXCEPTION 'crear_cxc_orden: la orden % no está entregada (%)', v_ord.folio, v_ord.estatus USING ERRCODE = '22023';
  END IF;
  IF v_ord.cliente_id IS NULL THEN RAISE EXCEPTION 'Orden % sin cliente: no puede ir a crédito', p_orden_id; END IF;
  IF COALESCE(v_ord.total, 0) <= 0 THEN RAISE EXCEPTION 'Orden % sin total', p_orden_id; END IF;

  SELECT id INTO v_cxc_id FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;
  IF FOUND THEN
    RETURN jsonb_build_object('creada', false, 'cxc_id', v_cxc_id);
  END IF;

  -- 088: una orden ya pagada no genera CxC; el monto es lo pendiente.
  SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
  v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
  IF v_pend <= 0 THEN
    RETURN jsonb_build_object('creada', false, 'motivo', 'ya_pagada', 'pagado', v_pagado, 'total', v_ord.total);
  END IF;

  -- 088: invariante de crédito con el cliente bloqueado (serializa ventas a
  -- crédito concurrentes, normal y exprés).
  PERFORM fin_validar_credito(v_ord.cliente_id, v_pend);

  SELECT nombre INTO v_cli FROM clientes WHERE id = v_ord.cliente_id;
  INSERT INTO cuentas_por_cobrar
    (cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, concepto, estatus)
  VALUES
    (v_ord.cliente_id, p_orden_id, fin_hoy(), fin_hoy() + COALESCE(p_dias_vencimiento, 30),
     v_pend, 0, v_pend, COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || COALESCE(v_cli.nombre, 'Cliente'), 'Pendiente')
  RETURNING id INTO v_cxc_id;

  UPDATE clientes SET saldo = COALESCE(saldo, 0) + v_pend WHERE id = v_ord.cliente_id;

  RETURN jsonb_build_object('creada', true, 'cxc_id', v_cxc_id, 'monto', v_pend);
END $$;

CREATE OR REPLACE FUNCTION abonar_cxc(
  p_cxc_id BIGINT, p_monto NUMERIC, p_metodo TEXT, p_referencia TEXT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cxc   cuentas_por_cobrar%ROWTYPE;
  v_monto NUMERIC := round(COALESCE(p_monto, 0), 2);
  v_nuevo_pagado NUMERIC;
  v_nuevo_saldo  NUMERIC;
  v_estatus TEXT;
  v_pago_id BIGINT;
  v_mov_id  BIGINT;
  v_ref TEXT;
  v_uid BIGINT := fin_actor_id(p_usuario_id);
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Facturación']) THEN
    RAISE EXCEPTION 'abonar_cxc: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  IF v_monto <= 0 THEN RAISE EXCEPTION 'Monto debe ser positivo'; END IF;

  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE id = p_cxc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta por cobrar % no existe', p_cxc_id; END IF;
  IF v_cxc.estatus = 'Pagada' OR COALESCE(v_cxc.saldo_pendiente, 0) <= 0 THEN
    RAISE EXCEPTION 'La cuenta % ya está liquidada', p_cxc_id;
  END IF;
  IF v_monto > round(v_cxc.saldo_pendiente, 2) + 0.01 THEN
    RAISE EXCEPTION 'Abono % excede el saldo pendiente %', v_monto, v_cxc.saldo_pendiente;
  END IF;

  v_nuevo_pagado := round(COALESCE(v_cxc.monto_pagado, 0) + v_monto, 2);
  v_nuevo_saldo  := greatest(0, round(COALESCE(v_cxc.monto_original, 0) - v_nuevo_pagado, 2));
  v_estatus := CASE WHEN v_nuevo_saldo <= 0 THEN 'Pagada' WHEN v_nuevo_pagado > 0 THEN 'Parcial' ELSE 'Pendiente' END;
  v_ref := COALESCE(NULLIF(btrim(p_referencia), ''),
                    'Abono CxC #' || p_cxc_id || ' ' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  UPDATE cuentas_por_cobrar
     SET monto_pagado = v_nuevo_pagado, saldo_pendiente = v_nuevo_saldo, estatus = v_estatus
   WHERE id = p_cxc_id;

  INSERT INTO pagos (cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (v_cxc.cliente_id, v_cxc.orden_id, p_cxc_id, v_monto, COALESCE(NULLIF(p_metodo, ''), 'Efectivo'), fin_hoy(),
          v_ref, round(v_cxc.saldo_pendiente, 2), v_nuevo_saldo, v_uid)
  RETURNING id INTO v_pago_id;

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id, usuario_id)
  VALUES (fin_hoy(), 'Ingreso', 'Cobranza',
          'Cobro CxC #' || p_cxc_id || ' — ' || COALESCE(v_cxc.concepto, 'Cliente'),
          v_monto, v_cxc.orden_id, v_uid)
  RETURNING id INTO v_mov_id;

  IF v_cxc.cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo = COALESCE(saldo, 0) - v_monto WHERE id = v_cxc.cliente_id;
  END IF;

  RETURN jsonb_build_object('pago_id', v_pago_id, 'movimiento_id', v_mov_id,
                            'saldo_despues', v_nuevo_saldo, 'estatus', v_estatus);
END $$;

CREATE OR REPLACE FUNCTION registrar_ingreso_orden(p_orden_id BIGINT, p_usuario_id BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ord ordenes%ROWTYPE;
  v_id  BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_ingreso_orden: no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF NOT fin_orden_operable(v_ord.ruta_id) THEN
    RAISE EXCEPTION 'registrar_ingreso_orden: la orden no pertenece a una ruta del actor' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada', p_orden_id; END IF;
  IF COALESCE(v_ord.total, 0) <= 0 THEN RETURN jsonb_build_object('creado', false, 'motivo', 'sin_total'); END IF;

  SELECT id INTO v_id FROM movimientos_contables
   WHERE orden_id = p_orden_id AND tipo = 'Ingreso' AND categoria = 'Ventas' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('creado', false, 'movimiento_id', v_id); END IF;

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id, usuario_id)
  VALUES (fin_hoy(), 'Ingreso', 'Ventas',
          'Cobro ' || COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || COALESCE(v_ord.cliente_nombre, 'Cliente'),
          round(v_ord.total, 2), p_orden_id, fin_actor_id(p_usuario_id))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('creado', true, 'movimiento_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION registrar_pago_orden(
  p_orden_id BIGINT, p_metodo TEXT, p_referencia TEXT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ord     ordenes%ROWTYPE;
  v_cxc     cuentas_por_cobrar%ROWTYPE;
  v_pagado  NUMERIC;
  v_pend    NUMERIC;
  v_ref     TEXT;
  v_metodo  TEXT := COALESCE(NULLIF(p_metodo, ''), 'Efectivo');
  v_pago_id BIGINT;
  v_res     JSONB;
  v_uid     BIGINT := fin_actor_id(p_usuario_id);
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_pago_orden: no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF NOT fin_orden_operable(v_ord.ruta_id) THEN
    RAISE EXCEPTION 'registrar_pago_orden: la orden no pertenece a una ruta del actor' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada: no se puede cobrar', p_orden_id; END IF;

  SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
  v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
  IF v_pend <= 0 THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ya_pagada', 'pagado', v_pagado, 'total', v_ord.total);
  END IF;

  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;
  IF FOUND THEN
    IF v_cxc.estatus = 'Pagada' OR COALESCE(v_cxc.saldo_pendiente, 0) <= 0 THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'cxc_liquidada', 'cxc_id', v_cxc.id);
    END IF;
    v_res := abonar_cxc(v_cxc.id, least(v_pend, round(v_cxc.saldo_pendiente, 2)), v_metodo, p_referencia, v_uid);
    RETURN v_res || jsonb_build_object('aplicado', true, 'via', 'cxc');
  END IF;

  v_ref := COALESCE(NULLIF(btrim(p_referencia), ''), COALESCE(v_ord.folio, 'ORD-' || p_orden_id) || '-' || v_metodo);
  IF EXISTS (SELECT 1 FROM pagos WHERE referencia = v_ref) THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'referencia_existente', 'referencia', v_ref);
  END IF;

  INSERT INTO pagos (cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (v_ord.cliente_id, p_orden_id, NULL, v_pend, v_metodo, fin_hoy(), v_ref, 0, 0, v_uid)
  RETURNING id INTO v_pago_id;

  PERFORM registrar_ingreso_orden(p_orden_id, v_uid);

  RETURN jsonb_build_object('aplicado', true, 'via', 'contado', 'pago_id', v_pago_id, 'monto', v_pend, 'referencia', v_ref);
END $$;

-- ═══ 7. Cierre financiero (086) con validación de ventas exprés ═══
CREATE OR REPLACE FUNCTION cerrar_ruta_financiero(
  p_operacion_id UUID, p_ruta_id BIGINT, p_entregas JSONB, p_usuario_id BIGINT DEFAULT NULL, p_usuario_nombre TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta    rutas%ROWTYPE;
  v_rol     TEXT;
  v_prev    cierres_financieros_ruta%ROWTYPE;
  v_otra    BIGINT;
  v_huella  TEXT;
  v_actor_id BIGINT;
  v_etiqueta TEXT;
  e         JSONB;
  it        JSONB;
  v_ord     ordenes%ROWTYPE;
  v_metodo  TEXT;
  v_total   NUMERIC;
  v_folio   TEXT;
  v_nuevo_id BIGINT;
  v_cliente_id BIGINT;
  v_factura BOOLEAN;
  v_res     JSONB;
  v_items_str TEXT;
  n_upd INT := 0; n_exp INT := 0; n_pagos INT := 0; n_cxc INT := 0;
  v_saltadas JSONB := '[]'::jsonb;
  v_express  JSONB := '[]'::jsonb;
  v_lin      JSONB;   -- 088: líneas canónicas de la venta exprés
  v_attr     BIGINT := fin_actor_id(p_usuario_id);  -- 088: atribución del servidor
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: ruta requerida' USING ERRCODE = '22023';
  END IF;

  -- Lock de la ruta: serializa cierres concurrentes (misma u otra operación).
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ruta % no existe', p_ruta_id; END IF;

  v_rol := fin_mi_rol_activo();
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer'
     AND v_ruta.chofer_id IS DISTINCT FROM get_my_user_id() THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  IF p_entregas IS NULL OR jsonb_typeof(p_entregas) <> 'array' THEN
    p_entregas := '[]'::jsonb;
  END IF;
  v_huella := fin_huella_cierre(p_ruta_id, p_entregas);

  -- Replay / conflicto: se evalúa ANTES del estado de la ruta, para que un
  -- reintento después de que el JS ya la cerró siga devolviendo el resultado.
  SELECT * INTO v_prev FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true, 'operacion_original', v_prev.operacion_id);
    END IF;
    IF v_prev.operacion_id = p_operacion_id THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado con otros datos (ruta %)', v_ruta.folio USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta % ya tiene cierre financiero registrado con otros datos', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  SELECT ruta_id INTO v_otra FROM cierres_financieros_ruta WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado en la ruta %', v_otra USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'Ruta % ya está %', p_ruta_id, v_ruta.estatus;
  END IF;

  -- 088: validación completa de TODAS las entradas ANTES de cualquier efecto
  -- financiero. Precio canónico (el enviado es solo una aserción), cantidades
  -- enteras positivas, cliente, factura, método de pago y crédito.
  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    v_metodo := NULLIF(btrim(COALESCE(e->>'pago', '')), '');
    IF v_metodo IS NOT NULL AND v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      CONTINUE;
    END IF;
    v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
    IF v_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cliente_id) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: cliente no encontrado: %', v_cliente_id USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'factura')::boolean, false) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado' USING ERRCODE = '22023';
      END IF;
      IF (SELECT upper(btrim(COALESCE(rfc, ''))) FROM clientes WHERE id = v_cliente_id) IN ('', 'XAXX010101000', 'XEXX010101000') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el cliente de la venta exprés no tiene RFC nominativo para facturar' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                               FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
    FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) LOOP
      IF NULLIF(it->>'precio', '') IS NOT NULL
         AND round((it->>'precio')::numeric, 2) IS DISTINCT FROM precio_canonico(v_cliente_id, it->>'sku') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el precio de % (%) no coincide con el precio vigente (%)', it->>'sku', it->>'precio', precio_canonico(v_cliente_id, it->>'sku')
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF fin_es_credito(COALESCE(v_metodo, 'Efectivo')) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: la venta exprés a crédito requiere un cliente registrado' USING ERRCODE = '22023';
      END IF;
      PERFORM fin_validar_credito(v_cliente_id, (v_lin->>'total')::numeric);
    END IF;
  END LOOP;

  v_actor_id := erp_usuario_id();
  v_etiqueta := erp_actor_etiqueta();
  PERFORM fin_marcar_ctx();

  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      -- ── Entrega de una orden existente ──
      SELECT * INTO v_ord FROM ordenes WHERE id = (e->>'ordenId')::bigint FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Orden % de la entrega no existe', e->>'ordenId'; END IF;
      IF v_ord.estatus IN ('Cancelada', 'No entregada') THEN
        RAISE EXCEPTION 'Orden % está % y no puede cerrarse como entregada', v_ord.folio, v_ord.estatus;
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), v_ord.metodo_pago, 'Efectivo');

      UPDATE ordenes
         SET estatus = 'Entregada', metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id;
      n_upd := n_upd + 1;

      v_total := round(COALESCE(v_ord.total, 0), 2);
      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_ord.cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_ord.id, 15);
          IF (v_res->>'creada')::boolean THEN n_cxc := n_cxc + 1; END IF;
        ELSE
          v_res := registrar_pago_orden(v_ord.id, v_metodo, e->>'referencia', v_attr);
          IF (v_res->>'aplicado')::boolean THEN
            n_pagos := n_pagos + 1;
          ELSE
            v_saltadas := v_saltadas || jsonb_build_object('orden_id', v_ord.id, 'folio', v_ord.folio, 'motivo', v_res->>'motivo');
          END IF;
        END IF;
      END IF;
    ELSE
      -- ── Venta exprés ──
      v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
      v_factura := COALESCE((e->>'factura')::boolean, false);
      IF v_factura AND v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado';
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), 'Efectivo');

      -- 088: líneas, precios y total del servidor (validados arriba).
      v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                                 FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
      v_total := (v_lin->>'total')::numeric;
      v_items_str := v_lin->>'productos';

      v_folio := 'OV-' || lpad(pg_catalog.nextval('folio_ov_seq'::regclass)::text, 4, '0');

      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, ruta_id, requiere_factura, vendedor_id, tipo_cobro)
      VALUES (v_folio, v_cliente_id, COALESCE(NULLIF(e->>'cliente', ''), 'Público en general'),
              COALESCE(v_items_str, 'Varios'), fin_hoy(), v_total, 'Entregada', v_metodo, p_ruta_id, v_factura, v_attr,
              CASE WHEN fin_es_credito(v_metodo) THEN 'Credito' ELSE 'Contado' END)
      RETURNING id INTO v_nuevo_id;
      n_exp := n_exp + 1;
      v_express := v_express || jsonb_build_object('id', v_nuevo_id, 'folio', v_folio, 'total', v_total);

      INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
      SELECT v_nuevo_id, l->>'sku', (l->>'cantidad')::int, (l->>'precio_unit')::numeric, (l->>'subtotal')::numeric
        FROM jsonb_array_elements(v_lin->'lineas') l;

      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_nuevo_id, 15);
          n_cxc := n_cxc + 1;
        ELSE
          v_res := registrar_pago_orden(v_nuevo_id, v_metodo, e->>'referencia', v_attr);
          n_pagos := n_pagos + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  v_res := jsonb_build_object(
    'success', true, 'ruta_id', p_ruta_id, 'folio', v_ruta.folio,
    'ordenes_entregadas', n_upd, 'ventas_express', n_exp, 'ordenes_express', v_express,
    'pagos', n_pagos, 'cxc', n_cxc, 'saltadas', v_saltadas,
    'operacion_id', p_operacion_id, 'huella', v_huella, 'actor', v_etiqueta, 'cerrado_at', now(), 'replay', false
  );
  -- La marca de idempotencia vive en la MISMA transacción que los efectos:
  -- si algo falló arriba, no existe.
  INSERT INTO cierres_financieros_ruta (ruta_id, operacion_id, huella, actor_id, actor, resultado)
  VALUES (p_ruta_id, p_operacion_id, v_huella, v_actor_id, v_etiqueta, v_res);

  RETURN v_res;
END $$;

-- ═══ 8. Recepción de compra y salida de empaque / materia prima ═══
CREATE OR REPLACE FUNCTION registrar_recepcion_compra(
  p_operacion_id UUID, p_sku TEXT, p_cantidad INTEGER, p_costo_total NUMERIC, p_proveedor TEXT DEFAULT NULL, p_credito BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_prov     TEXT := NULLIF(btrim(COALESCE(p_proveedor, '')), '');
  v_credito  BOOLEAN := COALESCE(p_credito, false);
  v_costo    NUMERIC := round(COALESCE(p_costo_total, 0), 2);
  v_prod     RECORD;
  v_clave    TEXT;
  v_prev     JSONB;
  v_concepto TEXT;
  v_fin_id   BIGINT;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF v_costo <= 0 THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: el total de la compra debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF v_credito AND v_prov IS NULL THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: la compra a crédito requiere proveedor' USING ERRCODE = '22023';
  END IF;

  v_clave := 'compra|' || v_sku || '|' || p_cantidad || '|' || v_costo || '|' || COALESCE(v_prov, '') || '|' || v_credito;
  v_prev := stock_op_replay(p_operacion_id, 'recepcion_compra', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT sku, nombre, tipo INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF v_prod.tipo NOT IN ('Empaque', 'Materia Prima') THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: % no es empaque ni materia prima', v_sku USING ERRCODE = '22023';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'recepcion_compra', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE sku = v_sku;
  INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
  VALUES ('Entrada', v_sku, p_cantidad, 'Recepción de compra' || COALESCE(' — ' || v_prov, ''), v_etiqueta, 'recepcion_compra/' || v_sku, p_operacion_id);

  v_concepto := CASE WHEN v_prod.tipo = 'Empaque' THEN 'Compra empaques: ' ELSE 'Compra materia prima: ' END || p_cantidad || '×' || v_sku;
  IF v_credito THEN
    INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, fecha_vencimiento, categoria, estatus, referencia)
    VALUES (v_prov, v_concepto, v_costo, 0, v_costo, fin_hoy(), fin_hoy() + 30, 'Proveedores', 'Pendiente', 'recepcion_compra/' || p_operacion_id)
    RETURNING id INTO v_fin_id;
  ELSE
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
    VALUES (fin_hoy(), 'Egreso', 'Proveedores', v_concepto || COALESCE(' — ' || v_prov, ''), v_costo, 'recepcion_compra/' || p_operacion_id, v_actor_id)
    RETURNING id INTO v_fin_id;
  END IF;

  v_res := jsonb_build_object('sku', v_sku, 'cantidad', p_cantidad, 'costo_total', v_costo, 'proveedor', v_prov, 'credito', v_credito,
                              CASE WHEN v_credito THEN 'cxp_id' ELSE 'movimiento_id' END, v_fin_id,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION registrar_recepcion_compra(UUID, TEXT, INTEGER, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_recepcion_compra(UUID, TEXT, INTEGER, NUMERIC, TEXT, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION registrar_salida_empaque(p_operacion_id UUID, p_sku TEXT, p_cantidad INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_prod     RECORD;
  v_clave    TEXT;
  v_prev     JSONB;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'registrar_salida_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_salida_empaque: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  v_clave := 'salida|' || v_sku || '|' || p_cantidad;
  v_prev := stock_op_replay(p_operacion_id, 'salida_empaque', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT sku, tipo, COALESCE(stock, 0) AS stock INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_salida_empaque: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF v_prod.tipo NOT IN ('Empaque', 'Materia Prima') THEN
    RAISE EXCEPTION 'registrar_salida_empaque: % no es empaque ni materia prima', v_sku USING ERRCODE = '22023';
  END IF;
  IF v_prod.stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de %: disponible=%, requerido=%', v_sku, v_prod.stock, p_cantidad;
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'salida_empaque', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  UPDATE productos SET stock = v_prod.stock - p_cantidad WHERE sku = v_sku;
  INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
  VALUES ('Salida', v_sku, p_cantidad, 'Producción', v_etiqueta, 'salida_empaque/' || v_sku, p_operacion_id);

  v_res := jsonb_build_object('sku', v_sku, 'cantidad', p_cantidad, 'stock', v_prod.stock - p_cantidad, 'actor', v_etiqueta,
                              'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION registrar_salida_empaque(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_salida_empaque(UUID, TEXT, INTEGER) TO authenticated, service_role;

-- ═══ 9. Policies: escrituras directas genéricas ═══
DROP POLICY IF EXISTS egreso_operativo_insert ON movimientos_contables;
DROP POLICY IF EXISTS costos_historial_produccion_insert ON costos_historial;
DROP POLICY IF EXISTS cxp_insert_compra ON cuentas_por_pagar;
DROP POLICY IF EXISTS almacen_update ON rutas;
DROP POLICY IF EXISTS almacen_write ON rutas;

-- Órdenes: el Chofer solo actualiza órdenes de SU ruta; Ventas solo órdenes
-- sin ruta (las de ruta las resuelven el chofer dueño o los contratos).
-- Facturación y el literal muerto 'Almacén' no tienen UPDATE directo.
DROP POLICY IF EXISTS ventas_update ON ordenes;
DROP POLICY IF EXISTS chofer_update_own ON ordenes;
CREATE POLICY ventas_update ON ordenes FOR UPDATE TO authenticated
  USING (erp_rol_activo() = 'Ventas' AND ruta_id IS NULL)
  WITH CHECK (erp_rol_activo() = 'Ventas' AND ruta_id IS NULL);
CREATE POLICY chofer_update_own ON ordenes FOR UPDATE TO authenticated
  USING (erp_rol_activo() = 'Chofer' AND ruta_id IN (SELECT r.id FROM rutas r WHERE r.chofer_id = erp_usuario_id()))
  WITH CHECK (erp_rol_activo() = 'Chofer' AND ruta_id IN (SELECT r.id FROM rutas r WHERE r.chofer_id = erp_usuario_id()));

-- ═══ 10. Campos financieros del cliente ═══
CREATE OR REPLACE FUNCTION clientes_guard_financiero() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo() OR COALESCE(erp_rol_activo(), '') = 'Admin' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.saldo, 0) <> 0 OR COALESCE(NEW.limite_credito, 0) <> 0 OR COALESCE(NEW.credito_autorizado, false) THEN
      RAISE EXCEPTION 'clientes: saldo y crédito solo los asigna Admin' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.saldo IS DISTINCT FROM OLD.saldo
     OR NEW.limite_credito IS DISTINCT FROM OLD.limite_credito
     OR NEW.credito_autorizado IS DISTINCT FROM OLD.credito_autorizado THEN
    RAISE EXCEPTION 'clientes: saldo y crédito solo los cambia Admin o un contrato' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION clientes_guard_financiero() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clientes_guard_financiero ON clientes;
CREATE TRIGGER trg_clientes_guard_financiero BEFORE INSERT OR UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION clientes_guard_financiero();

-- ═══ 11. Auditoría y errores: actor del servidor ═══
CREATE OR REPLACE FUNCTION auditoria_actor() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF fin_jwt_role() = 'authenticated' THEN
    NEW.usuario := erp_actor_etiqueta();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auditoria_actor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_auditoria_actor ON auditoria;
CREATE TRIGGER trg_auditoria_actor BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION auditoria_actor();
DROP POLICY IF EXISTS insert_all ON auditoria;
CREATE POLICY insert_all ON auditoria FOR INSERT TO authenticated WITH CHECK (erp_es_activo());

-- error_log acepta errores de cualquier sesión autenticada (observabilidad,
-- incluso antes de tener perfil), pero la identidad la fija el servidor.
CREATE OR REPLACE FUNCTION error_log_actor() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF fin_jwt_role() = 'authenticated' THEN
    NEW.usuario_id := erp_usuario_id();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION error_log_actor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_error_log_actor ON error_log;
CREATE TRIGGER trg_error_log_actor BEFORE INSERT ON error_log FOR EACH ROW EXECUTE FUNCTION error_log_actor();

-- ═══ 12. Ruta cargada y cerrada: terminal ═══
CREATE OR REPLACE FUNCTION rutas_guard_inventario() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_ctx BOOLEAN;
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN
    RETURN NEW;
  END IF;
  v_ctx := COALESCE(current_setting('app.cierre_ctx', true), '') = OLD.id::text;
  -- 088: una ruta cargada y cerrada es terminal para todo rol con JWT (Admin
  -- incluido): reabrirla permitiría entregas, mermas o reversos sobre un
  -- inventario ya finalizado que no se puede volver a cerrar.
  IF OLD.estatus = 'Cerrada' AND OLD.carga_confirmada_at IS NOT NULL AND NEW.estatus IS DISTINCT FROM OLD.estatus THEN
    RAISE EXCEPTION 'rutas: la ruta % está cerrada con inventario finalizado; no se reabre', OLD.folio USING ERRCODE = '42501';
  END IF;
  IF NEW.devolucion IS DISTINCT FROM OLD.devolucion AND NOT v_ctx THEN
    RAISE EXCEPTION 'rutas: devolucion solo la escribe finalizar_inventario_ruta' USING ERRCODE = '42501';
  END IF;
  IF OLD.carga_confirmada_at IS NOT NULL AND NEW.carga_confirmada_at IS DISTINCT FROM OLD.carga_confirmada_at THEN
    RAISE EXCEPTION 'rutas: la confirmación de carga es inmutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.carga_confirmada_at IS NOT NULL AND NEW.estatus IS DISTINCT FROM OLD.estatus THEN
    IF NEW.estatus = 'Cerrada' AND NOT v_ctx THEN
      RAISE EXCEPTION 'rutas: una ruta cargada se cierra con finalizar_inventario_ruta' USING ERRCODE = '42501';
    END IF;
    IF NEW.estatus = 'Cancelada' THEN
      RAISE EXCEPTION 'rutas: una ruta cargada no se cancela; su inventario se resuelve con finalizar_inventario_ruta' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ═══ 13. Función obsoleta ═══
DROP FUNCTION IF EXISTS cerrar_ruta_completa(BIGINT, JSONB);

-- ═══ 14. Universo de roles ═══
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_check') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
      CHECK (rol IN ('Admin', 'Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Sin asignar')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_check' AND NOT convalidated)
     AND NOT EXISTS (SELECT 1 FROM usuarios WHERE rol NOT IN ('Admin', 'Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Sin asignar')) THEN
    ALTER TABLE usuarios VALIDATE CONSTRAINT usuarios_rol_check;
  END IF;
END $$;
