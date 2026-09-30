-- 092_empaque_entrega_produccion.sql — semántica de empaque (Modelo A).
--
-- productos.stock de un Empaque = inventario TOTAL de la empresa (almacén +
-- lo que ya está físicamente en Producción sin usar). No existe un saldo de
-- Producción persistido y esta migración no crea uno.
--
--   recepción de compra   (registrar_recepcion_compra, sin cambios): stock += N
--   entrega a Producción  (registrar_salida_empaque): stock += 0; evento de
--                         kardex tipo 'Entrega a Producción' (traslado
--                         logístico, no consumo), idempotente por operación
--   consumo en producción (registrar_produccion): stock −= N (único punto de
--                         consumo); costo en costos_historial, SIN segundo
--                         Egreso en movimientos_contables
--
-- Control 'Salió de almacén a Producción' vs 'Usó Producción':
-- conciliacion_empaque() los deriva de fuentes independientes (eventos de
-- entrega canónicos vs produccion.empaque_cantidad del contrato 076) y reporta
-- aparte la historia legada ambigua (no se reinterpreta).
--
-- Sin reparación histórica: no toca stock, kardex, producción ni contabilidad
-- existentes. Idempotente.

-- ═══ 1. Entrega a Producción: evento, no consumo ═══
CREATE OR REPLACE FUNCTION public.registrar_salida_empaque(p_operacion_id UUID, p_sku TEXT, p_cantidad INTEGER)
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
  -- Misma huella y misma operación que 088: un reintento es replay y la
  -- misma operación con otros datos se rechaza (23505).
  v_clave := 'salida|' || v_sku || '|' || p_cantidad;
  v_prev := stock_op_replay(p_operacion_id, 'salida_empaque', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT sku, tipo, COALESCE(stock, 0) AS stock INTO v_prod FROM productos WHERE sku = v_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_salida_empaque: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  -- 092: solo Empaque. La materia prima la consume registrar_transformacion.
  IF v_prod.tipo <> 'Empaque' THEN
    RAISE EXCEPTION 'registrar_salida_empaque: % no es empaque', v_sku USING ERRCODE = '22023';
  END IF;
  -- Control de captura: no se puede entregar más de lo que la empresa tiene.
  IF v_prod.stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de %: disponible=%, requerido=%', v_sku, v_prod.stock, p_cantidad;
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'salida_empaque', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  -- 092: sin UPDATE de productos.stock. Un solo evento durable de traslado.
  INSERT INTO inventario_mov (tipo, producto, cantidad, origen, destino, usuario, referencia, operacion_id)
  VALUES ('Entrega a Producción', v_sku, p_cantidad, 'Almacén de empaque', 'Producción', v_etiqueta, 'salida_empaque/' || v_sku, p_operacion_id);

  v_res := jsonb_build_object('sku', v_sku, 'cantidad', p_cantidad, 'evento', 'entrega_produccion', 'stock_total', v_prod.stock,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.registrar_salida_empaque(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_empaque(UUID, TEXT, INTEGER) TO authenticated, service_role;

-- ═══ 2. Producción: único consumo de empaque; costo sin segundo Egreso ═══
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

  v_folio := (SELECT 'OP-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

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
  -- 092: el consumo reconoce COSTO (costos_historial, fuente del Costo de
  -- Ventas del Dashboard) pero NO crea un Egreso en movimientos_contables: el
  -- dinero ya salió al comprar (Egreso Proveedores) o saldrá al pagar la CxP.
  -- mov_contable_id queda NULL.
  IF v_empaque IS NOT NULL AND v_costo_u > 0 THEN
    v_total := round(p_cantidad * v_costo_u, 2);
    v_concepto := 'Producción ' || v_folio || ': ' || p_cantidad || '× ' || v_sku || ' (empaque: ' || v_empaque || ')';
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas', v_concepto, v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, NULL);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'sku', v_sku, 'cantidad', p_cantidad, 'cuarto_id', v_cuarto,
    'empaque_sku', v_empaque, 'empaque_cantidad', CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END,
    'costo_total', v_total, 'mov_contable_id', v_mov, 'actor', v_actor, 'replay', false);
END $$;

-- ═══ 3. Conciliación entrega vs uso (métrica de control, no un saldo) ═══
CREATE OR REPLACE FUNCTION public.conciliacion_empaque() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'conciliacion_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku', p.sku, 'nombre', p.nombre, 'stock_total', COALESCE(p.stock, 0),
      'entregado_produccion', e.qty, 'entregas', e.n,
      'consumido_produccion', c.qty, 'producciones', c.n,
      'diferencia', e.qty - c.qty,
      'legado_salidas', ls.qty, 'legado_salidas_n', ls.n,
      'legado_consumo', lc.qty, 'legado_consumo_n', lc.n) ORDER BY p.sku)
    FROM productos p
    -- Salió de almacén a Producción: solo eventos canónicos post-092.
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Entrega a Producción' AND m.referencia LIKE 'salida_empaque/%' AND m.operacion_id IS NOT NULL) e
    -- Usó Producción: el consumo que registró el contrato de producción (076+).
    CROSS JOIN LATERAL (SELECT COALESCE(sum(pr.empaque_cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM produccion pr
                         WHERE pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL AND pr.tipo = 'Produccion') c
    -- Legado ambiguo: salidas anteriores a 092 que descontaron stock.
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida'
                           AND (m.referencia LIKE 'salida_empaque/%' OR (m.referencia IS NULL AND m.origen = 'Producción'))) ls
    -- Legado: consumo de producción sin fila canónica de producción.
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida' AND m.origen LIKE 'Producción OP-%'
                           AND NOT EXISTS (SELECT 1 FROM produccion pr WHERE 'Producción ' || pr.folio = m.origen
                                            AND pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL)) lc
    WHERE p.tipo = 'Empaque'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.conciliacion_empaque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacion_empaque() TO authenticated, service_role;
