-- 137_pedido_sin_existencia.sql — un pedido que se surtirá DESPUÉS se puede
-- levantar aunque hoy no haya existencia (decisión del dueño, 2026-10-10).
--
-- Antes `crear_orden` rechazaba toda orden cuya cantidad superara la existencia
-- del momento, también un pedido para entregar otro día que la planta sí puede
-- producir. Ahora hay dos casos:
--   · Mostrador (se entrega ahí mismo) y cualquier cliente anterior de la app:
--     SIN CAMBIO, se exige existencia.
--   · Pedido a domicilio: la pantalla manda `permitir_sin_stock: true`; la orden
--     se crea, la respuesta trae `faltantes` / `falta_barra` y queda una línea en
--     auditoría ("Pedido sin existencia") con lo que hay que producir.
-- Quién: los mismos de siempre (Admin y Ventas, 120). Sin tope de cantidad.
--
-- Lo que NO cambia: precios, crédito, folio, sucursal, respuesta (solo se agregan
-- dos llaves), y los candados físicos: `completar_venta_directa`, la carga del
-- camión y el cierre de ruta siguen exigiendo que el producto exista. La orden no
-- aparta inventario (igual que antes). Producción ya ve los pedidos pendientes
-- en "Qué necesitas producir".
--
-- Idempotente (CREATE OR REPLACE; misma firma y permisos). Reversión: volver a
-- aplicar la definición de `crear_orden` de 133.

CREATE OR REPLACE FUNCTION public.crear_orden(p_orden JSONB, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cli_id   BIGINT;
  v_cli      RECORD;
  v_suc_id   BIGINT;
  v_suc      sucursales%ROWTYPE;
  v_nombre   TEXT;
  v_tipo     TEXT;
  v_metodo   TEXT;
  v_fecha    DATE;
  v_folio    TEXT;
  v_seq      TEXT;
  v_total    NUMERIC;
  v_lin      JSONB;
  v_l        JSONB;
  v_disp     INTEGER;
  v_dir      TEXT;
  v_lat      NUMERIC;
  v_lng      NUMERIC;
  v_ord      ordenes%ROWTYPE;
  -- 137: pedido que se surtirá después (a domicilio): se acepta aunque hoy no haya existencia.
  v_sin_stock BOOLEAN := COALESCE((p_orden ->> 'permitir_sin_stock')::BOOLEAN, false);
  v_faltan    JSONB := '[]'::jsonb;
  v_barra     TEXT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'crear_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden IS NULL OR jsonb_typeof(p_orden) <> 'object' THEN
    RAISE EXCEPTION 'crear_orden: datos de la orden requeridos' USING ERRCODE = '22023';
  END IF;

  v_cli_id := NULLIF(p_orden ->> 'cliente_id', '')::BIGINT;
  IF v_cli_id IS NOT NULL THEN
    -- Candado del cliente: una fusión en curso espera a esta venta (o esta venta ve al cliente ya fusionado).
    SELECT id, nombre, fusionado_en INTO v_cli FROM clientes WHERE id = v_cli_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crear_orden: cliente no encontrado: %', v_cli_id USING ERRCODE = '22023';
    END IF;
    IF v_cli.fusionado_en IS NOT NULL THEN
      RAISE EXCEPTION 'crear_orden: el cliente % fue fusionado como sucursal del cliente %; vende al cliente destino', v_cli_id, v_cli.fusionado_en USING ERRCODE = '22023';
    END IF;
    v_nombre := v_cli.nombre;
  ELSE
    v_nombre := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'cliente_nombre', '')), ''), 'Público en general');
  END IF;
  v_suc_id := sucursal_para_orden(v_cli_id, NULLIF(p_orden ->> 'sucursal_id', '')::BIGINT, 'crear_orden');

  v_tipo := COALESCE(NULLIF(p_orden ->> 'tipo_cobro', ''), 'Contado');
  IF v_tipo NOT IN ('Contado', 'Credito') THEN
    RAISE EXCEPTION 'crear_orden: tipo de cobro inválido: %', v_tipo USING ERRCODE = '22023';
  END IF;
  v_metodo := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'metodo_pago', '')), ''), 'Efectivo');
  IF v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
    RAISE EXCEPTION 'crear_orden: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
  END IF;
  v_fecha := COALESCE(NULLIF(p_orden ->> 'fecha', '')::DATE, fin_hoy());
  v_dir := NULLIF(btrim(COALESCE(p_orden ->> 'direccion_entrega', '')), '');
  v_lat := NULLIF(p_orden ->> 'latitud_entrega', '')::NUMERIC;
  v_lng := NULLIF(p_orden ->> 'longitud_entrega', '')::NUMERIC;
  -- Sin dirección propia: se copia la de la sucursal (texto y coordenadas).
  IF v_dir IS NULL AND v_suc_id IS NOT NULL THEN
    SELECT * INTO v_suc FROM sucursales WHERE id = v_suc_id;
    IF sucursal_con_domicilio(v_suc) THEN
      v_dir := sucursal_direccion_texto(v_suc);
      IF v_lat IS NULL OR v_lng IS NULL THEN
        v_lat := v_suc.latitud; v_lng := v_suc.longitud;
      END IF;
    END IF;
  END IF;

  -- Líneas y total del servidor (precio canónico: sucursal → cliente → lista).
  v_lin := lineas_canonicas(v_cli_id, v_suc_id, p_items);
  v_total := (v_lin ->> 'total')::NUMERIC;

  -- Disponibilidad. Dos casos (137):
  --   · Venta que se entrega ahora (mostrador) y clientes anteriores: se exige existencia,
  --     como siempre (misma regla que la pantalla: suma de cuartos fríos).
  --   · Pedido que se surtirá después (`permitir_sin_stock`): se acepta; lo que falta se
  --     anota (respuesta y auditoría) para que Producción lo fabrique. El candado físico no
  --     cambia: al cargar el camión o al entregar el producto tiene que existir.
  IF NOT v_sin_stock THEN
    -- Disponibilidad (misma regla que el cliente: suma de cuartos fríos).
    -- 133: la media barra, la picada y la triturada se revisan aparte, contra la barra entera.
    FOR v_l IN SELECT * FROM jsonb_array_elements(v_lin -> 'lineas') LOOP
      CONTINUE WHEN v_l ->> 'sku' IN ('HIB-25K', 'HIP-25K', 'HIT-25K');
      SELECT COALESCE(SUM(COALESCE((stock ->> (v_l ->> 'sku'))::INTEGER, 0)), 0) INTO v_disp FROM cuartos_frios;
      IF (v_l ->> 'cantidad')::INTEGER > v_disp THEN
        RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)', v_l ->> 'sku', v_disp, v_l ->> 'cantidad' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    PERFORM barra_exigir_disponible(
      (SELECT COALESCE(jsonb_object_agg(x.sku, x.q), '{}'::jsonb)
         FROM (SELECT e ->> 'sku' AS sku, SUM((e ->> 'cantidad')::INTEGER) AS q FROM jsonb_array_elements(v_lin -> 'lineas') e GROUP BY 1) x),
      (SELECT COALESCE(jsonb_object_agg(k.sku, k.q), '{}'::jsonb)
         FROM (SELECT s.key AS sku, SUM(COALESCE(NULLIF(s.value, '')::INTEGER, 0)) AS q
                 FROM cuartos_frios cf, jsonb_each_text(COALESCE(cf.stock, '{}'::jsonb)) s
                WHERE s.key IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K') GROUP BY 1) k),
      NULL);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', q.sku, 'pedido', q.cantidad, 'disponible', q.disp, 'falta', q.cantidad - q.disp) ORDER BY q.sku), '[]'::jsonb)
      INTO v_faltan
      FROM (SELECT x.sku, x.cantidad,
                   (SELECT COALESCE(SUM(GREATEST(COALESCE(NULLIF(cf.stock ->> x.sku, '')::INTEGER, 0), 0)), 0)::INTEGER FROM cuartos_frios cf) AS disp
              FROM (SELECT e ->> 'sku' AS sku, SUM((e ->> 'cantidad')::INTEGER)::INTEGER AS cantidad
                      FROM jsonb_array_elements(v_lin -> 'lineas') e
                     WHERE e ->> 'sku' NOT IN ('HIB-25K', 'HIP-25K', 'HIT-25K') GROUP BY 1) x) q
     WHERE q.cantidad > q.disp;
    -- Barra (media, picada, triturada): la misma regla de 133; aquí su rechazo es solo un aviso.
    BEGIN
      PERFORM barra_exigir_disponible(
        (SELECT COALESCE(jsonb_object_agg(x.sku, x.q), '{}'::jsonb)
           FROM (SELECT e ->> 'sku' AS sku, SUM((e ->> 'cantidad')::INTEGER) AS q FROM jsonb_array_elements(v_lin -> 'lineas') e GROUP BY 1) x),
        (SELECT COALESCE(jsonb_object_agg(k.sku, k.q), '{}'::jsonb)
           FROM (SELECT s.key AS sku, SUM(COALESCE(NULLIF(s.value, '')::INTEGER, 0)) AS q
                   FROM cuartos_frios cf, jsonb_each_text(COALESCE(cf.stock, '{}'::jsonb)) s
                  WHERE s.key IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K') GROUP BY 1) k),
        NULL);
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
      v_barra := SQLERRM;
    END;
  END IF;

  -- Crédito: por cadena (cliente); misma ecuación y mismo candado que la venta exprés.
  IF v_tipo = 'Credito' AND v_cli_id IS NOT NULL THEN
    PERFORM fin_validar_credito(v_cli_id, v_total);
  END IF;

  -- Folio: misma semántica que el frontend (OV- + padStart(4, '0')).
  v_seq := pg_catalog.nextval('folio_ov_seq'::regclass)::TEXT;
  v_folio := 'OV-' || lpad(v_seq, greatest(4, length(v_seq)), '0');

  INSERT INTO ordenes (folio, cliente_id, sucursal_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, vendedor_id, tipo_cobro,
                       requiere_factura, folio_nota, direccion_entrega, referencia_entrega, latitud_entrega, longitud_entrega)
  VALUES (v_folio, v_cli_id, v_suc_id, v_nombre, v_lin ->> 'productos', v_fecha, v_total, 'Creada', v_metodo, fin_actor_id(NULL), v_tipo,
          COALESCE((p_orden ->> 'requiere_factura')::BOOLEAN, false),
          NULLIF(btrim(COALESCE(p_orden ->> 'folio_nota', '')), ''),
          v_dir,
          NULLIF(btrim(COALESCE(p_orden ->> 'referencia_entrega', '')), ''),
          v_lat, v_lng)
  RETURNING * INTO v_ord;

  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT v_ord.id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
    FROM jsonb_array_elements(v_lin -> 'lineas') l;

  IF jsonb_array_length(v_faltan) > 0 OR v_barra IS NOT NULL THEN
    INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (erp_actor_etiqueta(), 'Pedido sin existencia', 'Órdenes',
            left(v_ord.folio || ' — por producir: '
                 || concat_ws('; ', NULLIF((SELECT string_agg((x ->> 'falta') || ' de ' || (x ->> 'sku'), ', ') FROM jsonb_array_elements(v_faltan) x), ''), v_barra), 500));
  END IF;

  RETURN jsonb_build_object('faltantes', v_faltan, 'falta_barra', v_barra, 'id', v_ord.id, 'folio', v_ord.folio, 'cliente_id', v_ord.cliente_id, 'sucursal_id', v_ord.sucursal_id,
    'cliente_nombre', v_ord.cliente_nombre,
    'productos', v_ord.productos, 'total', v_ord.total, 'estatus', v_ord.estatus, 'fecha', v_ord.fecha, 'metodo_pago', v_ord.metodo_pago,
    'tipo_cobro', v_ord.tipo_cobro, 'requiere_factura', v_ord.requiere_factura, 'direccion_entrega', v_ord.direccion_entrega,
    'referencia_entrega', v_ord.referencia_entrega, 'latitud_entrega', v_ord.latitud_entrega, 'longitud_entrega', v_ord.longitud_entrega,
    'vendedor_id', v_ord.vendedor_id, 'lineas', v_lin -> 'lineas');
END $$;
REVOKE ALL ON FUNCTION public.crear_orden(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_orden(JSONB, JSONB) TO authenticated, service_role;
