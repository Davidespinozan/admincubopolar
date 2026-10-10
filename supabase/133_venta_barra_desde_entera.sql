-- 133_venta_barra_desde_entera.sql — la media barra, la picada y la triturada se
-- venden contra la BARRA ENTERA.
--
-- Aditiva en esquema (sin tablas ni columnas). Redefine `crear_orden` (123) y
-- `completar_venta_directa` (120) con la misma firma, respuesta y permisos.
-- Compatible con el frontend desplegado antes: solo deja pasar ventas que hoy
-- se rechazan por "Stock insuficiente" de HIB-25K / HIP-25K / HIT-25K.
--
-- Qué había (115/129): la venta de barra se guarda por SKU (HIB-50K entera,
-- HIB-25K media, HIP-25K picada, HIT-25K triturada) y cada capa exigía
-- existencia de ESE SKU; las medias y las bolsas solo existían si Producción
-- las había partido o preparado antes. Sin stock preparado no se podía vender.
--
-- Decisión del dueño (por medio de David, 2026-10-09; sustituye "la venta nunca
-- prepara" de 129): vender media barra, picada o triturada depende SOLO de que
-- haya barra entera. La otra mitad queda como media barra en el cuarto.
--
-- Regla (una sola, en `barra_exigir_disponible`): con B barras enteras, M
-- medias, P bolsas de picada y T de triturada en existencia, un pedido de
-- b barras, m medias, p picadas y t trituradas se puede surtir si
--     b <= B   y   max(0, p − P) + max(0, t − T) + m  <=  M + 2 × (B − b)
-- (1 barra = 2 medias; 1 media = 1 bolsa de picada o de triturada). Lo ya
-- partido o preparado se usa primero.
--
--   crear_orden: la regla se aplica sobre la suma de todos los cuartos.
--   completar_venta_directa: por cada cuarto asignado. Lo que falte se saca de
--     la barra de ESE cuarto dentro de la misma transacción, llamando a los
--     contratos de Producción (`partir_barra`, `registrar_preparacion_barra`,
--     `registrar_preparacion_media`): quedan sus filas de producción, su kardex
--     y el consumo del empaque configurado, y se revierten como siempre. Si no
--     hay bolsas para picar/triturar, la entrega falla completa (sin negativos).
--
-- No cambia: precios, líneas de la orden, CFDI, crédito, pagos, la carga de
-- ruta (`confirmar_carga_ruta`: al camión se sube lo ya preparado; lo prepara
-- Producción antes de firmar la carga) ni `update_orden_atomic` (no valida
-- existencia).
--
-- Reversión: restaurar `crear_orden` de 123 y `completar_venta_directa` de 120 y
-- borrar las dos funciones nuevas. Las preparaciones ya hechas son historia.

-- ═══ 1. La regla ═══
-- p_pedido y p_stock: { sku: cantidad }. p_cuarto NULL = toda la planta.
CREATE OR REPLACE FUNCTION public.barra_exigir_disponible(p_pedido JSONB, p_stock JSONB, p_cuarto TEXT) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_b INTEGER := COALESCE((p_pedido ->> 'HIB-50K')::INTEGER, 0);
  v_m INTEGER := COALESCE((p_pedido ->> 'HIB-25K')::INTEGER, 0);
  v_p INTEGER := COALESCE((p_pedido ->> 'HIP-25K')::INTEGER, 0);
  v_t INTEGER := COALESCE((p_pedido ->> 'HIT-25K')::INTEGER, 0);
  s_b INTEGER := GREATEST(COALESCE(NULLIF(p_stock ->> 'HIB-50K', '')::INTEGER, 0), 0);
  s_m INTEGER := GREATEST(COALESCE(NULLIF(p_stock ->> 'HIB-25K', '')::INTEGER, 0), 0);
  s_p INTEGER := GREATEST(COALESCE(NULLIF(p_stock ->> 'HIP-25K', '')::INTEGER, 0), 0);
  s_t INTEGER := GREATEST(COALESCE(NULLIF(p_stock ->> 'HIT-25K', '')::INTEGER, 0), 0);
  v_falta INTEGER;
  v_donde TEXT := CASE WHEN p_cuarto IS NULL THEN '' ELSE ' en cuarto ' || p_cuarto END;
BEGIN
  IF v_m + v_p + v_t = 0 THEN RETURN; END IF;   -- sin derivados: la barra entera ya se revisó como cualquier producto
  v_falta := GREATEST(v_p - s_p, 0) + GREATEST(v_t - s_t, 0) + v_m - s_m - 2 * GREATEST(s_b - v_b, 0);
  IF v_falta > 0 THEN
    RAISE EXCEPTION 'Stock insuficiente de barra%: hay % barra(s) entera(s) y % media(s); faltan % media(s) para surtir el pedido',
      v_donde, s_b, s_m, v_falta USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.barra_exigir_disponible(JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Surtir un cuarto: partir / preparar lo que falte ═══
-- p_pedido = { sku: cantidad } que saldrá de ESE cuarto en esta venta. El
-- llamador ya bloqueó el cuarto y marcó el contexto de contrato. Cada paso usa
-- una operación derivada de la venta (determinista: un reintento no repite).
CREATE OR REPLACE FUNCTION public.barra_surtir_cuarto(p_operacion_id UUID, p_cuarto TEXT, p_pedido JSONB) RETURNS VOID
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_m     INTEGER := COALESCE((p_pedido ->> 'HIB-25K')::INTEGER, 0);
  v_sku   TEXT;
  v_falta INTEGER;
  v_libre INTEGER;
  v_usar  INTEGER;
  v_n     INTEGER := 0;
  v_stock JSONB;
BEGIN
  IF v_m + COALESCE((p_pedido ->> 'HIP-25K')::INTEGER, 0) + COALESCE((p_pedido ->> 'HIT-25K')::INTEGER, 0) = 0 THEN RETURN; END IF;

  -- Picada y triturada primero: usan medias sueltas y, si no alcanzan, barras.
  FOREACH v_sku IN ARRAY ARRAY['HIP-25K', 'HIT-25K'] LOOP
    SELECT COALESCE(stock, '{}'::jsonb) INTO v_stock FROM cuartos_frios WHERE id = p_cuarto;
    v_falta := COALESCE((p_pedido ->> v_sku)::INTEGER, 0) - GREATEST(COALESCE(NULLIF(v_stock ->> v_sku, '')::INTEGER, 0), 0);
    CONTINUE WHEN v_falta <= 0;
    -- Medias que no necesita la propia venta.
    v_libre := GREATEST(GREATEST(COALESCE(NULLIF(v_stock ->> 'HIB-25K', '')::INTEGER, 0), 0) - v_m, 0);
    v_usar := LEAST(v_falta, v_libre);
    IF v_usar > 0 THEN
      v_n := v_n + 1;
      PERFORM registrar_preparacion_media(md5(p_operacion_id::TEXT || '|barra|' || p_cuarto || '|' || v_n)::UUID, v_sku, p_cuarto, v_usar);
      v_falta := v_falta - v_usar;
    END IF;
    IF v_falta >= 2 THEN
      v_n := v_n + 1;
      PERFORM registrar_preparacion_barra(md5(p_operacion_id::TEXT || '|barra|' || p_cuarto || '|' || v_n)::UUID, 'HIB-50K', v_sku, p_cuarto, v_falta / 2);
      v_falta := v_falta % 2;
    END IF;
    IF v_falta = 1 THEN
      v_n := v_n + 1;
      PERFORM partir_barra(md5(p_operacion_id::TEXT || '|barra|' || p_cuarto || '|' || v_n)::UUID, p_cuarto, 1);
      v_n := v_n + 1;
      PERFORM registrar_preparacion_media(md5(p_operacion_id::TEXT || '|barra|' || p_cuarto || '|' || v_n)::UUID, v_sku, p_cuarto, 1);
    END IF;
  END LOOP;

  -- Medias barras sin preparar: se parten las barras necesarias (la mitad que sobra se queda en el cuarto).
  SELECT COALESCE(stock, '{}'::jsonb) INTO v_stock FROM cuartos_frios WHERE id = p_cuarto;
  v_falta := v_m - GREATEST(COALESCE(NULLIF(v_stock ->> 'HIB-25K', '')::INTEGER, 0), 0);
  IF v_falta > 0 THEN
    v_n := v_n + 1;
    PERFORM partir_barra(md5(p_operacion_id::TEXT || '|barra|' || p_cuarto || '|' || v_n)::UUID, p_cuarto, (v_falta + 1) / 2);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.barra_surtir_cuarto(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ═══ 3. crear_orden (123) + la regla de la barra ═══
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

  RETURN jsonb_build_object('id', v_ord.id, 'folio', v_ord.folio, 'cliente_id', v_ord.cliente_id, 'sucursal_id', v_ord.sucursal_id,
    'cliente_nombre', v_ord.cliente_nombre,
    'productos', v_ord.productos, 'total', v_ord.total, 'estatus', v_ord.estatus, 'fecha', v_ord.fecha, 'metodo_pago', v_ord.metodo_pago,
    'tipo_cobro', v_ord.tipo_cobro, 'requiere_factura', v_ord.requiere_factura, 'direccion_entrega', v_ord.direccion_entrega,
    'referencia_entrega', v_ord.referencia_entrega, 'latitud_entrega', v_ord.latitud_entrega, 'longitud_entrega', v_ord.longitud_entrega,
    'vendedor_id', v_ord.vendedor_id, 'lineas', v_lin -> 'lineas');
END $$;
REVOKE ALL ON FUNCTION public.crear_orden(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_orden(JSONB, JSONB) TO authenticated, service_role;

-- ═══ 4. completar_venta_directa (120) + la regla y el surtido de la barra ═══
CREATE OR REPLACE FUNCTION public.completar_venta_directa(
  p_operacion_id UUID,
  p_orden_id     BIGINT,
  p_modo         TEXT,
  p_metodo       TEXT,
  p_asignacion   JSONB,
  p_referencia   TEXT DEFAULT NULL,
  p_folio_nota   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt        TEXT := fin_jwt_role();
  v_rol        TEXT;
  v_actor_id   BIGINT := erp_usuario_id();
  v_etiqueta   TEXT := erp_actor_etiqueta();
  v_modo       TEXT := btrim(COALESCE(p_modo, ''));
  v_metodo     TEXT := btrim(COALESCE(p_metodo, ''));
  v_ref        TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
  v_nota       TEXT := NULLIF(btrim(COALESCE(p_folio_nota, '')), '');
  v_el         JSONB;
  v_sku        TEXT;
  v_cuarto     TEXT;
  v_cant       NUMERIC;
  v_asig       JSONB;
  v_clave      TEXT;
  v_prev       JSONB;
  v_ord        ordenes%ROWTYPE;
  v_faltan     TEXT;
  v_sobran     TEXT;
  v_desc       TEXT;
  v_rooms      TEXT[];
  v_n_rooms    INTEGER;
  v_a          RECORD;
  v_disp       INTEGER;
  v_pagado     NUMERIC;
  v_pend       NUMERIC;
  v_fin        JSONB;
  v_pago       JSONB := NULL;
  v_cxc        JSONB := NULL;
  v_ord_fin    ordenes%ROWTYPE;
  v_res        JSONB;
BEGIN
  -- 1. Autorización ANTES de marcar el contexto (dentro de fin_ctx los
  --    contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'completar_venta_directa: no autorizado' USING ERRCODE = '42501';
  END IF;
  v_rol := CASE WHEN v_jwt = 'authenticated' THEN COALESCE(fin_mi_rol_activo(), '') ELSE 'Sistema' END;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: operación y orden requeridas' USING ERRCODE = '22023';
  END IF;

  -- 2. Modo y método (las cadenas que ya usan Ventas y Admin).
  IF v_modo NOT IN ('contado', 'credito', 'pagado_link') THEN
    RAISE EXCEPTION 'completar_venta_directa: modo inválido (contado, credito, pagado_link)' USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_modo = 'contado' AND v_metodo IN ('Efectivo', 'Transferencia SPEI', 'Tarjeta (terminal)'))
       OR (v_modo = 'credito' AND v_metodo = 'Crédito (fiado)')
       OR (v_modo = 'pagado_link' AND v_metodo = 'QR / Link de pago')) THEN
    RAISE EXCEPTION 'completar_venta_directa: el método % no corresponde al modo %', v_metodo, v_modo USING ERRCODE = '22023';
  END IF;

  -- 3. Asignación: arreglo de {sku, cuarto_id, cantidad}; cantidades enteras
  --    > 0; sin pares (sku, cuarto) repetidos. Otras llaves se ignoran.
  IF p_asignacion IS NULL OR jsonb_typeof(p_asignacion) <> 'array' OR jsonb_array_length(p_asignacion) = 0 THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación debe ser una lista de {sku, cuarto_id, cantidad}' USING ERRCODE = '22023';
  END IF;
  v_asig := '[]'::jsonb;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_asignacion) LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR jsonb_typeof(v_el -> 'sku') IS DISTINCT FROM 'string' OR jsonb_typeof(v_el -> 'cuarto_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_el -> 'cantidad') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'completar_venta_directa: cada partida requiere sku, cuarto_id y cantidad' USING ERRCODE = '22023';
    END IF;
    v_sku := btrim(v_el ->> 'sku'); v_cuarto := btrim(v_el ->> 'cuarto_id'); v_cant := (v_el ->> 'cantidad')::NUMERIC;
    IF v_sku = '' OR v_cuarto = '' THEN
      RAISE EXCEPTION 'completar_venta_directa: sku y cuarto_id no pueden estar vacíos' USING ERRCODE = '22023';
    END IF;
    IF v_cant <= 0 OR v_cant <> trunc(v_cant) OR v_cant > 2147483647 THEN
      RAISE EXCEPTION 'completar_venta_directa: cantidad inválida para % en % (entero mayor a 0)', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = v_sku AND e.value ->> 'cuarto_id' = v_cuarto) THEN
      RAISE EXCEPTION 'completar_venta_directa: % en % aparece más de una vez', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    v_asig := v_asig || jsonb_build_array(jsonb_build_object('sku', v_sku, 'cuarto_id', v_cuarto, 'cantidad', v_cant::INTEGER));
  END LOOP;
  -- Forma canónica (ordenada por SKU y cuarto): base de la huella y del recorrido.
  SELECT jsonb_agg(e.value ORDER BY e.value ->> 'sku', e.value ->> 'cuarto_id') INTO v_asig FROM jsonb_array_elements(v_asig) e;
  v_clave := jsonb_build_object('orden', p_orden_id, 'modo', v_modo, 'metodo', v_metodo, 'referencia', v_ref, 'folio_nota', v_nota, 'asignacion', v_asig)::text;

  -- 4. Orden bloqueada; propiedad (Ventas: solo sus órdenes).
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'completar_venta_directa: orden % no existe', p_orden_id USING ERRCODE = '22023';
  END IF;
  -- 120: también quien actúa por un acceso adicional de Ventas (rol principal
  -- distinto) queda limitado a sus órdenes. Admin y Ventas: sin cambio.
  IF (v_rol = 'Ventas' OR (v_rol NOT IN ('Admin', 'Sistema') AND erp_tiene_rol('Ventas')))
     AND v_ord.vendedor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no es de este vendedor', v_ord.folio USING ERRCODE = '42501';
  END IF;

  -- 5. Idempotencia (mismo UUID + misma huella → resultado original).
  v_prev := stock_op_replay(p_operacion_id, 'venta_directa', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- 6. Elegibilidad con la orden ya bloqueada.
  IF v_ord.ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % tiene ruta; la entrega y el cobro son del chofer', v_ord.folio USING ERRCODE = '22023';
  END IF;
  IF v_ord.estatus NOT IN ('Creada', 'Asignada') THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % está % (se requiere Creada o Asignada sin ruta)', v_ord.folio, v_ord.estatus USING ERRCODE = '22023';
  END IF;

  -- 7. La asignación cubre EXACTAMENTE las líneas de la orden.
  IF NOT EXISTS (SELECT 1 FROM orden_lineas WHERE orden_id = p_orden_id AND cantidad > 0) THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no tiene líneas', v_ord.folio USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(l.sku || ' (' || l.q || ')', ', ' ORDER BY l.sku) INTO v_faltan
    FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku HAVING SUM(cantidad) > 0) l
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: falta asignar %', v_faltan USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(DISTINCT e.value ->> 'sku', ', ') INTO v_sobran FROM jsonb_array_elements(v_asig) e
   WHERE NOT EXISTS (SELECT 1 FROM orden_lineas l WHERE l.orden_id = p_orden_id AND l.sku = e.value ->> 'sku' AND l.cantidad > 0);
  IF v_sobran IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: % no está en la orden', v_sobran USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(x.sku || ': asignado ' || x.asig || ', orden ' || x.q, '; ' ORDER BY x.sku) INTO v_desc
    FROM (SELECT l.sku, l.q, (SELECT SUM((e.value ->> 'cantidad')::INTEGER) FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku) AS asig
            FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku) l) x
   WHERE x.asig IS DISTINCT FROM x.q;
  IF v_desc IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación no coincide con la orden (%)', v_desc USING ERRCODE = '22023';
  END IF;

  -- 8. Cuartos de la asignación, bloqueados en orden de id; existencia.
  SELECT array_agg(DISTINCT e.value ->> 'cuarto_id' ORDER BY e.value ->> 'cuarto_id') INTO v_rooms FROM jsonb_array_elements(v_asig) e;
  SELECT count(*) INTO v_n_rooms FROM (SELECT 1 FROM cuartos_frios WHERE id = ANY (v_rooms) ORDER BY id FOR UPDATE) k;
  IF v_n_rooms <> array_length(v_rooms, 1) THEN
    RAISE EXCEPTION 'completar_venta_directa: cuarto inexistente en la asignación (%)',
      (SELECT string_agg(r, ', ') FROM unnest(v_rooms) r WHERE NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = r)) USING ERRCODE = '22023';
  END IF;
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    -- 133: media barra, picada y triturada salen de la barra entera del MISMO cuarto (se revisa abajo).
    CONTINUE WHEN v_a.sku IN ('HIB-25K', 'HIP-25K', 'HIT-25K');
    SELECT COALESCE((stock ->> v_a.sku)::INTEGER, 0) INTO v_disp FROM cuartos_frios WHERE id = v_a.cuarto_id;
    IF v_disp < v_a.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%', v_a.sku, v_a.cuarto_id, v_disp, v_a.cantidad USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_cuarto IN SELECT unnest(v_rooms) LOOP
    PERFORM barra_exigir_disponible(
      (SELECT COALESCE(jsonb_object_agg(e.value ->> 'sku', (e.value ->> 'cantidad')::INTEGER), '{}'::jsonb)
         FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'cuarto_id' = v_cuarto),
      (SELECT COALESCE(stock, '{}'::jsonb) FROM cuartos_frios WHERE id = v_cuarto),
      v_cuarto);
  END LOOP;

  -- 9. pagado_link: el pago del proveedor ya cubre el total (sin pago nuevo).
  IF v_modo = 'pagado_link' THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
    v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
    IF COALESCE(v_ord.total, 0) <= 0 OR v_pend > 0 THEN
      RAISE EXCEPTION 'completar_venta_directa: el link de pago de % no cubre el total (pendiente %)', v_ord.folio, greatest(v_pend, 0) USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 10. Registro de la operación (la FK del kardex lo exige antes del movimiento).
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, orden_id, resultado)
  VALUES (p_operacion_id, 'venta_directa', v_clave, v_actor_id, v_etiqueta, p_orden_id, '{}'::jsonb);

  PERFORM fin_marcar_ctx();

  -- 10b (133). Lo que falte de media barra, picada o triturada se saca de la barra
  -- entera del mismo cuarto, con los contratos de Producción (partir / preparar):
  -- mismo kardex, mismo empaque, mismas filas de producción y sus reversos.
  FOR v_cuarto IN SELECT unnest(v_rooms) LOOP
    PERFORM barra_surtir_cuarto(p_operacion_id, v_cuarto,
      (SELECT COALESCE(jsonb_object_agg(e.value ->> 'sku', (e.value ->> 'cantidad')::INTEGER), '{}'::jsonb)
         FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'cuarto_id' = v_cuarto));
  END LOOP;

  -- 11. Salida física: SOLO de los cuartos asignados, con kardex ligado a la orden.
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    PERFORM stock_mov_cuarto(v_a.cuarto_id, v_a.sku, -v_a.cantidad, 'Salida', 'Venta directa ' || COALESCE(v_ord.folio, 'Orden ' || p_orden_id),
                             COALESCE(NULLIF(v_ord.cliente_nombre, ''), 'Cliente'), 'venta_directa/' || p_orden_id, v_etiqueta, NULL, p_operacion_id);
  END LOOP;

  -- 12. Entregada (fecha de entrega e ingreso devengado por el trigger 093).
  UPDATE ordenes
     SET estatus = 'Entregada', metodo_pago = v_metodo, folio_nota = COALESCE(v_nota, folio_nota)
   WHERE id = p_orden_id;

  -- 13. Dinero: pago o CxC por los contratos existentes; un resultado no
  --     aplicado revierte TODO (nunca Entregada sin pago ni CxC).
  IF v_modo = 'contado' THEN
    v_fin := registrar_pago_orden(p_orden_id, v_metodo, v_ref, v_actor_id);
    IF COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: el pago no se aplicó (%)', COALESCE(v_fin ->> 'motivo', 'sin motivo') USING ERRCODE = '22023';
    END IF;
    v_pago := v_fin;
  ELSIF v_modo = 'credito' THEN
    v_fin := crear_cxc_orden(p_orden_id, 30);
    IF COALESCE((v_fin ->> 'creada')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: la CxC no se creó (%)', COALESCE(v_fin ->> 'motivo', 'ya existía') USING ERRCODE = '22023';
    END IF;
    v_cxc := v_fin;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Venta directa', 'Órdenes', COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || v_modo || ' (' || v_metodo || '). Salida: '
          || (SELECT string_agg((e.value ->> 'cantidad') || '×' || (e.value ->> 'sku') || ' de ' || (e.value ->> 'cuarto_id'), ', ' ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku') FROM jsonb_array_elements(v_asig) e));

  SELECT * INTO v_ord_fin FROM ordenes WHERE id = p_orden_id;
  v_res := jsonb_build_object('orden_id', p_orden_id, 'folio', v_ord.folio, 'estatus', v_ord_fin.estatus, 'estatus_anterior', v_ord.estatus,
                              'modo', v_modo, 'metodo', v_metodo, 'total', v_ord.total, 'pago', v_pago, 'cxc', v_cxc, 'asignacion', v_asig,
                              'delivered_at', v_ord_fin.delivered_at, 'actor', v_etiqueta, 'actor_id', v_actor_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;
