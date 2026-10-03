-- 106_costo_empaque_promedio.sql — costo de empaque por promedio ponderado
-- (forward-only). Base contable SIN cambio: el empaque se reconoce como costo
-- al producir (092/093); no se capitaliza producto terminado.
--   1. costos_empaque_historial: evidencia operativa de cada cambio del costo
--      (Apertura declarada al activar y cada Compra). No es asiento contable.
--   2. registrar_recepcion_compra: en la MISMA transacción y con el producto
--      bloqueado, recalcula el promedio ponderado del Empaque con la factura
--      real; idempotente (el replay no recalcula).
--   3. registrar_produccion: lee el promedio con el producto bloqueado; la
--      producción conserva su snapshot (costo_empaque, costo_total).
--   4. Merma de producto terminado: sin valuación (no hay costo unitario de
--      producto terminado bajo esta base).
--   5. Catálogo: por API el costo no se edita; producto terminado nace en 0;
--      el empaque nuevo declara su costo de apertura al darse de alta.
-- Idempotente. No modifica historia.

-- ═══ 1. Historial ═══
CREATE TABLE IF NOT EXISTS public.costos_empaque_historial (
  id                BIGSERIAL PRIMARY KEY,
  producto_id       BIGINT NOT NULL,
  sku               TEXT NOT NULL,
  evento            TEXT NOT NULL CHECK (evento IN ('Apertura', 'Compra')),
  operacion_id      UUID UNIQUE,
  cantidad_anterior INTEGER,
  costo_anterior    NUMERIC(14,6),
  cantidad_recibida INTEGER,
  total_factura     NUMERIC(12,2),
  cantidad_nueva    INTEGER NOT NULL,
  costo_nuevo       NUMERIC(14,6) NOT NULL CHECK (costo_nuevo >= 0),
  actor             TEXT NOT NULL,
  actor_id          BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((evento = 'Compra') = (operacion_id IS NOT NULL AND cantidad_recibida > 0 AND total_factura > 0))
);
CREATE INDEX IF NOT EXISTS costos_empaque_historial_producto ON public.costos_empaque_historial (producto_id, id);
ALTER TABLE public.costos_empaque_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS costos_empaque_historial_read ON public.costos_empaque_historial;
CREATE POLICY costos_empaque_historial_read ON public.costos_empaque_historial FOR SELECT TO authenticated USING (erp_es_activo());
REVOKE ALL ON public.costos_empaque_historial FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.costos_empaque_historial TO authenticated;
GRANT ALL ON public.costos_empaque_historial TO service_role;
DO $$
DECLARE v_seq TEXT := pg_get_serial_sequence('public.costos_empaque_historial', 'id');
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
END $$;

-- Apertura declarada (no reconstruida): existencia y costo vigentes al activar.
INSERT INTO costos_empaque_historial (producto_id, sku, evento, cantidad_nueva, costo_nuevo, actor)
SELECT p.id, p.sku, 'Apertura', COALESCE(p.stock, 0), round(COALESCE(p.costo_unitario, 0), 6), 'Apertura declarada (106)'
  FROM productos p
 WHERE p.tipo = 'Empaque'
   AND NOT EXISTS (SELECT 1 FROM costos_empaque_historial h WHERE h.producto_id = p.id AND h.evento = 'Apertura');

-- ═══ 2. Compra ═══
CREATE OR REPLACE FUNCTION public.registrar_recepcion_compra(p_operacion_id uuid, p_sku text, p_cantidad integer, p_costo_total numeric, p_proveedor text DEFAULT NULL::text, p_credito boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_old_qty  INTEGER;
  v_old_avg  NUMERIC;
  v_new_avg  NUMERIC;
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

  SELECT id, sku, nombre, tipo, COALESCE(stock, 0) AS stock, COALESCE(costo_unitario, 0) AS costo INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF v_prod.tipo NOT IN ('Empaque', 'Materia Prima') THEN
    RAISE EXCEPTION 'registrar_recepcion_compra: % no es empaque ni materia prima', v_sku USING ERRCODE = '22023';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'recepcion_compra', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  -- 106: costo promedio ponderado del empaque con la factura real (misma
  -- transacción y mismo bloqueo del producto que el stock). Sin existencia
  -- previa, el promedio es el de esta compra. Precisión de almacenamiento: 6
  -- decimales; se muestra a 2.
  IF v_prod.tipo = 'Empaque' THEN
    v_old_qty := GREATEST(v_prod.stock, 0);
    v_old_avg := v_prod.costo;
    v_new_avg := CASE WHEN v_old_qty = 0 THEN round(v_costo / p_cantidad, 6)
                      ELSE round((v_old_qty * v_old_avg + v_costo) / (v_old_qty + p_cantidad), 6) END;
    UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad, costo_unitario = v_new_avg, ultimo_costo_fecha = fin_hoy() WHERE sku = v_sku;
    INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida, total_factura,
                                          cantidad_nueva, costo_nuevo, actor, actor_id)
    VALUES (v_prod.id, v_sku, 'Compra', p_operacion_id, v_prod.stock, v_old_avg, p_cantidad, v_costo, v_prod.stock + p_cantidad, v_new_avg, v_etiqueta, v_actor_id);
  ELSE
    UPDATE productos SET stock = COALESCE(stock, 0) + p_cantidad WHERE sku = v_sku;
  END IF;
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
                              'costo_promedio_anterior', v_old_avg, 'costo_promedio', v_new_avg,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $function$;

-- ═══ 3. Producción ═══
CREATE OR REPLACE FUNCTION public.registrar_produccion(p_operacion_id uuid, p_turno text, p_maquina text, p_sku text, p_cantidad integer, p_cuarto_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- 106: el costo (promedio ponderado) se lee con el producto bloqueado: se
    -- serializa con las recepciones de compra del mismo empaque.
    SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque FOR UPDATE;
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
END $function$;

-- ═══ 4. Mermas sin valuación de producto terminado ═══
CREATE OR REPLACE FUNCTION public.registrar_merma(p_sku text, p_cantidad integer, p_causa text DEFAULT NULL::text, p_origen text DEFAULT NULL::text, p_foto text DEFAULT NULL::text, p_ruta_id bigint DEFAULT NULL::bigint, p_afecta_stock boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol        TEXT;
  v_usuario_id BIGINT;
  v_etiqueta   TEXT;
  v_uid        UUID := auth.uid();
  v_prod       RECORD;
  v_ruta       RECORD;
  v_prodfolio  RECORD;
  v_sku        TEXT := btrim(COALESCE(p_sku, ''));
  v_causa      TEXT := COALESCE(NULLIF(btrim(COALESCE(p_causa, '')), ''), 'Sin causa');
  v_origen     TEXT;
  v_foto       TEXT := NULLIF(btrim(COALESCE(p_foto, '')), '');
  v_folio      TEXT;
  v_merma_id   BIGINT;
  v_restante   INTEGER;
  v_cf         RECORD;
  v_disp       INTEGER;
  v_toma       INTEGER;
  v_inv_id     BIGINT;
  v_mov_id     BIGINT;
  v_costo      NUMERIC;
  v_efectos    JSONB := '[]'::jsonb;
  v_origen_inv TEXT;
  v_chofer     TEXT;   -- nombre para origen/concepto de ruta (NULL fuera de ruta)
  v_disp_ruta  INTEGER;  -- 087: inventario canónico del camión para el SKU
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_merma: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  -- 103: la merma física de cuarto se registra con registrar_merma_cuarto
  -- (cuarto elegido, sin FIFO entre cuartos). Desde la aplicación este
  -- contrato queda para merma de ruta (087) y merma de proceso.
  IF p_ruta_id IS NULL AND COALESCE(p_afecta_stock, true) AND COALESCE(fin_jwt_role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'registrar_merma: la merma de cuarto se registra con registrar_merma_cuarto (indica el cuarto)' USING ERRCODE = '42501';
  END IF;
  v_rol        := erp_rol_activo();      -- NULL para service_role / SQL
  v_usuario_id := erp_usuario_id();
  v_etiqueta   := erp_actor_etiqueta();

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_merma: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF p_afecta_stock IS NULL THEN
    RAISE EXCEPTION 'registrar_merma: afecta_stock es obligatorio' USING ERRCODE = '22023';
  END IF;

  SELECT id, sku, nombre, costo_unitario INTO v_prod FROM productos WHERE sku = v_sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;

  -- Ruta: existe y, para Chofer, es suya. Producción no registra mermas de ruta.
  IF p_ruta_id IS NOT NULL THEN
    SELECT id, folio, chofer_id, chofer_nombre, estatus INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_merma: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
    END IF;
    IF v_rol = 'Producción' THEN
      RAISE EXCEPTION 'registrar_merma: Producción no registra mermas de ruta' USING ERRCODE = '42501';
    END IF;
    IF v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_usuario_id THEN
      RAISE EXCEPTION 'registrar_merma: la ruta no pertenece al chofer' USING ERRCODE = '42501';
    END IF;
    v_chofer := COALESCE(NULLIF(btrim(COALESCE(v_ruta.chofer_nombre, '')), ''), v_etiqueta);
    -- 087: la merma de ruta es pérdida del inventario del camión: solo con la
    -- ruta cargada o en progreso (el lock de la ruta serializa mermas y cierre).
    IF v_ruta.estatus NOT IN ('Cargada', 'En progreso') THEN
      RAISE EXCEPTION 'registrar_merma: la ruta % está % (merma de ruta solo en Cargada o En progreso)', v_ruta.folio, v_ruta.estatus USING ERRCODE = '22023';
    END IF;
  ELSIF v_rol = 'Chofer' THEN
    RAISE EXCEPTION 'registrar_merma: el chofer solo registra mermas de su ruta' USING ERRCODE = '42501';
  END IF;

  -- Merma de proceso (transformación): sin efecto de stock propio.
  IF NOT p_afecta_stock THEN
    IF v_rol IS NOT NULL AND v_rol NOT IN ('Admin', 'Producción') THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso solo Admin/Producción' USING ERRCODE = '42501';
    END IF;
    IF p_ruta_id IS NOT NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso no lleva ruta' USING ERRCODE = '22023';
    END IF;
    v_folio := substring(COALESCE(p_origen, '') FROM '^Transformación (TR-[0-9]+)$');
    IF v_folio IS NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso requiere origen "Transformación TR-###"' USING ERRCODE = '22023';
    END IF;
    SELECT folio, input_sku, merma_kg INTO v_prodfolio FROM produccion
     WHERE folio = v_folio AND tipo = 'Transformacion' ORDER BY id LIMIT 1;
    IF NOT FOUND OR v_prodfolio.input_sku IS DISTINCT FROM v_prod.sku THEN
      RAISE EXCEPTION 'registrar_merma: transformación % no encontrada para %', v_folio, v_prod.sku USING ERRCODE = '22023';
    END IF;
    IF p_cantidad > ceil(COALESCE(v_prodfolio.merma_kg, 0)) THEN
      RAISE EXCEPTION 'registrar_merma: cantidad mayor a la merma de la transformación' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM mermas WHERE origen = 'Transformación ' || v_folio AND NOT afecta_stock) THEN
      RAISE EXCEPTION 'registrar_merma: la transformación % ya tiene merma registrada', v_folio USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Foto: data URL (flujo de ruta) o llave de objeto propia en el bucket
  -- `mermas`, existente y no ligada a otra merma. Nunca una URL externa.
  IF v_foto IS NOT NULL THEN
    IF v_foto LIKE 'data:image/%' THEN
      IF length(v_foto) > 3000000 THEN
        RAISE EXCEPTION 'registrar_merma: foto demasiado grande' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF length(v_foto) > 512 OR v_foto !~ '^[^/\\]+(/[^/\\]+)+$' OR v_foto ~ '(^|/)\.\.?(/|$)' THEN
        RAISE EXCEPTION 'registrar_merma: ruta de foto inválida' USING ERRCODE = '22023';
      END IF;
      IF v_uid IS NOT NULL AND split_part(v_foto, '/', 1) <> v_uid::text THEN
        RAISE EXCEPTION 'registrar_merma: la foto no pertenece al actor' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'mermas' AND o.name = v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto no existe en Storage' USING ERRCODE = '22023';
      END IF;
      IF erp_foto_merma_en_uso(v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto ya está ligada a otra merma' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- 087: tope de la merma de ruta = balance canónico del camión (nunca el
  -- stock de cuartos). El helper falla cerrado si las fuentes son ambiguas.
  IF p_ruta_id IS NOT NULL AND p_afecta_stock THEN
    SELECT b.restante INTO v_disp_ruta FROM balance_ruta_interno(p_ruta_id) b WHERE b.sku = v_prod.sku;
    IF COALESCE(v_disp_ruta, 0) < p_cantidad THEN
      RAISE EXCEPTION 'registrar_merma: la merma de %×% supera el inventario del camión (disponible=%)', p_cantidad, v_prod.sku, COALESCE(v_disp_ruta, 0)
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_origen := CASE
    WHEN p_ruta_id IS NOT NULL THEN 'Ruta ' || v_chofer
    ELSE COALESCE(NULLIF(btrim(COALESCE(p_origen, '')), ''), v_etiqueta)
  END;

  INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id, ruta_id, afecta_stock, estatus)
  VALUES (fin_hoy(), v_prod.sku, p_cantidad, v_causa, v_origen, COALESCE(v_foto, ''), v_usuario_id, p_ruta_id, p_afecta_stock, 'Activa')
  RETURNING id INTO v_merma_id;

  IF p_afecta_stock THEN
    -- Descuento FIFO por id de cuarto (mismo orden que el cliente legacy).
    -- FOR UPDATE: dos mermas concurrentes del mismo stock se serializan y la
    -- segunda relee el stock ya descontado.
    v_origen_inv := CASE WHEN p_ruta_id IS NOT NULL THEN 'Merma ruta ' || v_chofer ELSE v_causa END;
    IF p_ruta_id IS NULL THEN
    v_restante := p_cantidad;
    FOR v_cf IN SELECT id, stock FROM cuartos_frios ORDER BY id FOR UPDATE LOOP
      EXIT WHEN v_restante <= 0;
      v_disp := COALESCE((v_cf.stock ->> v_prod.sku)::INTEGER, 0);
      CONTINUE WHEN v_disp <= 0;
      v_toma := LEAST(v_disp, v_restante);
      UPDATE cuartos_frios
         SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_prod.sku], to_jsonb(v_disp - v_toma)),
             updated_at = now()
       WHERE id = v_cf.id;
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
      VALUES ('Merma', v_prod.sku, v_toma, v_origen_inv, v_etiqueta, 'MERMA-' || v_merma_id)
      RETURNING id INTO v_inv_id;
      INSERT INTO mermas_efectos (merma_id, cuarto_id, cantidad, inv_mov_id)
      VALUES (v_merma_id, v_cf.id, v_toma, v_inv_id);
      v_efectos := v_efectos || jsonb_build_object('cuarto_id', v_cf.id, 'cantidad', v_toma, 'inv_mov_id', v_inv_id);
      v_restante := v_restante - v_toma;
    END LOOP;
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para registrar merma de %×%: disponible=%', p_cantidad, v_prod.sku, p_cantidad - v_restante
        USING ERRCODE = 'P0001';
    END IF;
    ELSE
      -- 087: merma de ruta = pérdida del inventario del camión. Sin cuartos
      -- ni mermas_efectos; kardex estructurado (cuarto_id NULL, ruta_id).
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, ruta_id)
      VALUES ('Merma', v_prod.sku, p_cantidad, v_origen_inv, v_etiqueta, 'MERMA-' || v_merma_id, p_ruta_id)
      RETURNING id INTO v_inv_id;
    END IF;

    -- Egreso contable por el costo (si el producto tiene costo).
    -- 106: el producto terminado no tiene costo unitario (el empaque ya se
    -- reconoció al producir): la merma no genera egreso adicional.
    v_costo := 0;
    IF v_costo > 0 THEN
      INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
      VALUES (
        fin_hoy(), 'Egreso', 'Mermas',
        CASE WHEN p_ruta_id IS NOT NULL
          THEN 'Merma ruta ' || v_chofer || ': ' || p_cantidad || '× ' || v_prod.sku
          ELSE 'Merma ' || p_cantidad || '× ' || v_prod.sku
        END || COALESCE(' (' || NULLIF(v_prod.nombre, '') || ')', '') || ' — ' || v_causa,
        round(p_cantidad * v_costo, 2),
        'MERMA-' || v_merma_id,
        v_usuario_id)
      RETURNING id INTO v_mov_id;
      UPDATE mermas SET mov_contable_id = v_mov_id WHERE id = v_merma_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_merma_id, 'sku', v_prod.sku, 'cantidad', p_cantidad, 'estatus', 'Activa',
    'afecta_stock', p_afecta_stock, 'efectos', v_efectos, 'mov_contable_id', v_mov_id,
    'ruta_id', p_ruta_id, 'inventario', CASE WHEN p_ruta_id IS NULL THEN 'cuarto' ELSE 'camion' END, 'actor', v_etiqueta);
END $function$;

CREATE OR REPLACE FUNCTION public.registrar_merma_cuarto(p_operacion_id uuid, p_cuarto_id text, p_sku text, p_cantidad integer, p_causa text DEFAULT NULL::text, p_foto text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id   BIGINT := erp_usuario_id();
  v_etiqueta   TEXT := erp_actor_etiqueta();
  v_uid        UUID := auth.uid();
  v_cuarto     TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_sku        TEXT := btrim(COALESCE(p_sku, ''));
  v_causa      TEXT := COALESCE(NULLIF(btrim(COALESCE(p_causa, '')), ''), 'Sin causa');
  v_foto       TEXT := NULLIF(btrim(COALESCE(p_foto, '')), '');
  v_clave      TEXT;
  v_prev       JSONB;
  v_prod       RECORD;
  v_cf         RECORD;
  v_merma_id   BIGINT;
  v_inv_id     BIGINT;
  v_mov_id     BIGINT;
  v_costo      NUMERIC;
  v_res        JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_merma: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  SELECT id, sku, nombre, tipo, costo_unitario INTO v_prod FROM productos WHERE sku = v_sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;

  -- El cuarto elegido es la autoridad y serializa todo movimiento sobre él.
  SELECT id, nombre, COALESCE((stock ->> v_prod.sku)::INTEGER, 0) AS q INTO v_cf FROM cuartos_frios WHERE id = v_cuarto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: cuarto frío no encontrado: %', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_clave := 'merma_cuarto|' || v_cuarto || '|' || v_prod.sku || '|' || p_cantidad || '|' || v_causa || '|' || COALESCE(v_foto, '');
  v_prev := stock_op_replay(p_operacion_id, 'merma_cuarto', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- Foto: misma regla que registrar_merma (072): llave propia en el bucket
  -- `mermas`, existente y no ligada a otra merma; o data URL acotada.
  IF v_foto IS NOT NULL THEN
    IF v_foto LIKE 'data:image/%' THEN
      IF length(v_foto) > 3000000 THEN
        RAISE EXCEPTION 'registrar_merma: foto demasiado grande' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF length(v_foto) > 512 OR v_foto !~ '^[^/\\]+(/[^/\\]+)+$' OR v_foto ~ '(^|/)\.\.?(/|$)' THEN
        RAISE EXCEPTION 'registrar_merma: ruta de foto inválida' USING ERRCODE = '22023';
      END IF;
      IF v_uid IS NOT NULL AND split_part(v_foto, '/', 1) <> v_uid::text THEN
        RAISE EXCEPTION 'registrar_merma: la foto no pertenece al actor' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'mermas' AND o.name = v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto no existe en Storage' USING ERRCODE = '22023';
      END IF;
      IF erp_foto_merma_en_uso(v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto ya está ligada a otra merma' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  IF v_cf.q < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para registrar merma de %×% en %: disponible=%', p_cantidad, v_prod.sku, v_cuarto, v_cf.q USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'merma_cuarto', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id, ruta_id, afecta_stock, estatus)
  VALUES (fin_hoy(), v_prod.sku, p_cantidad, v_causa, COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto), COALESCE(v_foto, ''), v_actor_id, NULL, true, 'Activa')
  RETURNING id INTO v_merma_id;

  -- Solo el cuarto elegido; kardex con cuarto_id y operación.
  PERFORM stock_mov_cuarto(v_cuarto, v_prod.sku, -p_cantidad, 'Merma', v_causa, NULL, 'MERMA-' || v_merma_id, v_etiqueta, NULL, p_operacion_id);
  SELECT id INTO v_inv_id FROM inventario_mov WHERE operacion_id = p_operacion_id AND referencia = 'MERMA-' || v_merma_id ORDER BY id DESC LIMIT 1;
  INSERT INTO mermas_efectos (merma_id, cuarto_id, cantidad, inv_mov_id) VALUES (v_merma_id, v_cuarto, p_cantidad, v_inv_id);

  -- Valuación vigente (072/093): costo_unitario × cantidad, egreso no-efectivo.
  -- 106: sin valuación de producto terminado (el empaque ya se reconoció al
  -- producir); no hay egreso adicional por la pérdida.
  v_costo := 0;
  IF v_costo > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
    VALUES (fin_hoy(), 'Egreso', 'Mermas',
            'Merma ' || p_cantidad || '× ' || v_prod.sku || COALESCE(' (' || NULLIF(v_prod.nombre, '') || ')', '') || ' — ' || v_causa,
            round(p_cantidad * v_costo, 2), 'MERMA-' || v_merma_id, v_actor_id)
    RETURNING id INTO v_mov_id;
    UPDATE mermas SET mov_contable_id = v_mov_id WHERE id = v_merma_id;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Registrar', 'Mermas', 'Merma #' || v_merma_id || ' — ' || p_cantidad || '×' || v_prod.sku || ' en ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_causa);

  v_res := jsonb_build_object('id', v_merma_id, 'sku', v_prod.sku, 'cantidad', p_cantidad, 'estatus', 'Activa', 'afecta_stock', true,
    'efectos', jsonb_build_array(jsonb_build_object('cuarto_id', v_cuarto, 'cantidad', p_cantidad, 'inv_mov_id', v_inv_id)),
    'mov_contable_id', v_mov_id, 'ruta_id', NULL, 'inventario', 'cuarto', 'cuarto_id', v_cuarto, 'actor', v_etiqueta,
    'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $function$;

-- ═══ 5. Catálogo ═══
CREATE OR REPLACE FUNCTION public.productos_guard_costo() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Producto terminado: sin costo unitario. Empaque: costo de apertura declarado.
    IF COALESCE(NEW.tipo, '') <> 'Empaque' THEN
      NEW.costo_unitario := 0;
    END IF;
    NEW.ultimo_costo_fecha := NULL;
    RETURN NEW;
  END IF;
  IF NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario OR NEW.ultimo_costo_fecha IS DISTINCT FROM OLD.ultimo_costo_fecha THEN
    RAISE EXCEPTION 'productos: el costo del empaque lo fija la recepción de compra (promedio ponderado); el producto terminado no tiene costo unitario'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo AND 'Empaque' IN (COALESCE(NEW.tipo, ''), COALESCE(OLD.tipo, '')) THEN
    RAISE EXCEPTION 'productos: un empaque no cambia de tipo (tiene historial de costo)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.productos_guard_costo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_productos_guard_costo ON productos;
CREATE TRIGGER trg_productos_guard_costo BEFORE INSERT OR UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION public.productos_guard_costo();

-- Empaque nuevo: su costo de alta queda como apertura declarada en el historial.
CREATE OR REPLACE FUNCTION public.productos_costo_apertura() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.tipo = 'Empaque' THEN
    INSERT INTO costos_empaque_historial (producto_id, sku, evento, cantidad_nueva, costo_nuevo, actor, actor_id)
    VALUES (NEW.id, NEW.sku, 'Apertura', COALESCE(NEW.stock, 0), round(COALESCE(NEW.costo_unitario, 0), 6), erp_actor_etiqueta(), erp_usuario_id());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.productos_costo_apertura() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_productos_costo_apertura ON productos;
CREATE TRIGGER trg_productos_costo_apertura AFTER INSERT ON productos FOR EACH ROW EXECUTE FUNCTION public.productos_costo_apertura();
