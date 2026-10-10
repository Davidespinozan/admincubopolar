-- 129_media_barra.sql — MEDIA BARRA: producto "Media barra de hielo ~25 kg" (HIB-25K, $60) y los
-- contratos para que Producción decida qué hacer con la otra mitad de una barra.
--
-- Operación física (dueño, 2026-10-10):
--   * Se vende la barra entera o media barra; el cliente puede pedirla sin preparar, picada o triturada.
--   * El chofer nunca prepara: solo entrega lo ya preparado. Quien decide qué hacer con la mitad que
--     sobra (dejarla como media barra, picarla o triturarla) es Producción.
--   * 115 (preparar barra entera → 2 bolsas del mismo tipo) NO cambia.
--
-- Cambios (aditivos; sin tablas ni columnas nuevas):
--   0. Producto HIB-25K (Producto Terminado, $60, sin empaque; existencia 0, el stock real vive en
--      cuartos_frios.stock). INSERT idempotente (ON CONFLICT DO NOTHING).
--   1. partir_barra(operacion, cuarto, barras) — Admin / Producción. Atómico e idempotente
--      (produccion.operacion_id único): en el MISMO cuarto, barra −N, media barra +2N. Sin empaque ni
--      costo. Fila de produccion tipo 'Partido' (folio PT-###; input_sku = HIB-50K, input_kg = barras).
--   2. revertir_partir_barra(operacion, partido, motivo) — solo Admin. Atómico e idempotente
--      (stock_operaciones 'reverso_produccion', clave 'reverso_partir|<id>|<motivo>'): medias −2N (si
--      ya se vendieron o prepararon y no alcanzan, falla TODO), barra +N. Una sola vez.
--   3. registrar_preparacion_media(operacion, salida, cuarto, medias) — Admin / Producción. Una media
--      barra → 1 bolsa de picada (HIP-25K) o triturada (HIT-25K) en el mismo cuarto, consumiendo 1 del
--      empaque CONFIGURADO en la salida. Fila 'Preparacion' (folio PB-###; input_sku = HIB-25K): se
--      revierte con revertir_preparacion_barra (115), que ya es genérica por input_sku, y la
--      conciliación de empaque (115) ya cuenta las filas 'Preparacion'.
--   4. registrar_produccion: definición de 115 + un rechazo (HIB-25K no se produce por máquina).
--
-- Combinaciones (Producción compone los contratos; cada paso deja inventario consistente):
--   media + media               → partir
--   media + triturada/picada    → partir, preparar 1 media
--   picada + triturada          → partir, preparar 1 media a picada y 1 a triturada
--   (ambas iguales y entera)    → registrar_preparacion_barra de 115
--
-- Reversión (sin registros de partir ni de media): DROP FUNCTION de las tres funciones nuevas,
-- registrar_produccion de 115, y DELETE del producto HIB-25K si no tiene existencia ni historia.
-- Con registros: no borrar historia; revertir cada partir/preparación con sus contratos.

-- ═══ 0. Producto ═══
INSERT INTO productos (sku, nombre, tipo, precio, stock)
VALUES ('HIB-25K', 'Media barra de hielo ~25 kg', 'Producto Terminado', 60, 0)
ON CONFLICT (sku) DO NOTHING;

-- ═══ 1. Partir una barra en dos medias ═══
CREATE OR REPLACE FUNCTION public.partir_barra(p_operacion_id UUID, p_cuarto_id TEXT, p_barras INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuarto  TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_medias  INTEGER;
  v_actor   TEXT;
  v_pb      RECORD;
  v_pm      RECORD;
  v_cf      RECORD;
  v_prev    produccion%ROWTYPE;
  v_id      BIGINT;
  v_folio   TEXT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'partir_barra: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'partir_barra: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_barras IS NULL OR p_barras < 1 THEN
    RAISE EXCEPTION 'partir_barra: se parte al menos 1 barra entera' USING ERRCODE = '22023';
  END IF;
  v_medias := p_barras * 2;

  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.tipo IS DISTINCT FROM 'Partido' OR v_prev.input_kg IS DISTINCT FROM p_barras::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'partir_barra: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'barras', p_barras, 'medias', v_prev.cantidad,
      'cuarto_id', v_prev.cuarto_id, 'replay', true);
  END IF;

  SELECT id, tipo INTO v_pb FROM productos WHERE sku = 'HIB-50K';
  IF NOT FOUND OR COALESCE(v_pb.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'partir_barra: la barra HIB-50K no está en el catálogo como Producto Terminado' USING ERRCODE = '22023';
  END IF;
  SELECT id, tipo INTO v_pm FROM productos WHERE sku = 'HIB-25K';
  IF NOT FOUND OR COALESCE(v_pm.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'partir_barra: la media barra HIB-25K no está en el catálogo como Producto Terminado' USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partir_barra: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_folio := (SELECT 'PT-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);
  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id, input_sku, input_kg, output_kg)
  VALUES (p_operacion_id, v_folio, 'Partir', 'Partir barra', 'HIB-25K', v_medias, 'Confirmada', 'Partido', v_cuarto, 'HIB-50K', p_barras, v_medias)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    IF v_prev.tipo IS DISTINCT FROM 'Partido' OR v_prev.input_kg IS DISTINCT FROM p_barras::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'partir_barra: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'barras', p_barras, 'medias', v_prev.cantidad,
      'cuarto_id', v_prev.cuarto_id, 'replay', true);
  END IF;

  PERFORM stock_mov_cuarto(v_cuarto, 'HIB-50K', -p_barras, 'Salida',
    'Partir ' || v_folio || ': ' || p_barras || ' barra(s) → ' || v_medias || ' media(s)',
    NULL, 'partir/' || v_folio, v_actor, NULL, NULL);
  PERFORM stock_mov_cuarto(v_cuarto, 'HIB-25K', v_medias, 'Entrada',
    'Partir ' || v_folio || ' en ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto),
    NULL, 'partir/' || v_folio, v_actor, NULL, NULL);

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_actor, 'Partir barra', 'Producción', v_folio || ' — ' || p_barras || '×HIB-50K → ' || v_medias || '×HIB-25K');

  RETURN jsonb_build_object('id', v_id, 'folio', v_folio, 'barras', p_barras, 'medias', v_medias, 'cuarto_id', v_cuarto,
    'actor', v_actor, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.partir_barra(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partir_barra(UUID, TEXT, INTEGER) TO authenticated, service_role;

-- ═══ 2. Revertir un partido equivocado ═══
CREATE OR REPLACE FUNCTION public.revertir_partir_barra(p_operacion_id UUID, p_partido_id BIGINT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_p        produccion%ROWTYPE;
  v_folio    TEXT;
  v_barras   INTEGER;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_partir_barra: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_partido_id IS NULL THEN
    RAISE EXCEPTION 'revertir_partir_barra: operación y partido son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'revertir_partir_barra: el motivo es obligatorio' USING ERRCODE = '22023';
  END IF;
  v_clave := 'reverso_partir|' || p_partido_id || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'reverso_produccion', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_p FROM produccion WHERE id = p_partido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_partir_barra: partido no encontrado: %', p_partido_id USING ERRCODE = '22023';
  END IF;
  v_folio := COALESCE(v_p.folio, 'ID ' || v_p.id);
  IF COALESCE(v_p.tipo, '') <> 'Partido' THEN
    RAISE EXCEPTION 'revertir_partir_barra: % no es un partido de barra', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.revertida_at IS NOT NULL OR v_p.estatus = 'Revertida' THEN
    RAISE EXCEPTION 'revertir_partir_barra: el partido % ya fue revertido', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.estatus <> 'Confirmada' OR v_p.input_sku IS NULL OR v_p.input_kg IS NULL OR NULLIF(btrim(COALESCE(v_p.cuarto_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'revertir_partir_barra: el partido % no tiene datos suficientes para revertirse', v_folio USING ERRCODE = '22023';
  END IF;
  v_barras := v_p.input_kg::INTEGER;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'reverso_produccion', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  -- Medias: solo del cuarto ORIGINAL; si ya se vendieron o prepararon, falla todo.
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.sku, -v_p.cantidad, 'Salida', 'Reverso partir ' || v_folio,
                           NULL, 'reverso_partir/' || v_folio, v_etiqueta, NULL, p_operacion_id);
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.input_sku, v_barras, 'Entrada', 'Reverso partir ' || v_folio,
                           NULL, 'reverso_partir/' || v_folio, v_etiqueta, NULL, p_operacion_id);

  UPDATE produccion SET estatus = 'Revertida', revertida_at = now(), revertida_por = v_actor_id,
                        reverso_operacion_id = p_operacion_id, motivo_reverso = v_motivo
   WHERE id = v_p.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Revertir', 'Producción', 'Partir ' || v_folio || ' — ' || v_p.cantidad || '×' || v_p.sku || ' → ' || v_barras || '×' || v_p.input_sku || ' — motivo: ' || v_motivo);

  v_res := jsonb_build_object('id', v_p.id, 'folio', v_folio, 'medias', v_p.cantidad, 'barras', v_barras, 'cuarto_id', v_p.cuarto_id,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.revertir_partir_barra(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_partir_barra(UUID, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 3. Preparar media barra (picada o triturada) ═══
CREATE OR REPLACE FUNCTION public.registrar_preparacion_media(p_operacion_id UUID, p_salida_sku TEXT, p_cuarto_id TEXT, p_medias INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_salida   TEXT := btrim(COALESCE(p_salida_sku, ''));
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_actor    TEXT;
  v_ps       RECORD;
  v_emp      RECORD;
  v_cf       RECORD;
  v_prev     produccion%ROWTYPE;
  v_id       BIGINT;
  v_folio    TEXT;
  v_empaque  TEXT;
  v_costo_u  NUMERIC := 0;
  v_total    NUMERIC := 0;
  v_hoy      DATE := fin_hoy();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_preparacion_media: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_preparacion_media: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_medias IS NULL OR p_medias < 1 THEN
    RAISE EXCEPTION 'registrar_preparacion_media: se prepara al menos 1 media barra' USING ERRCODE = '22023';
  END IF;
  IF v_salida NOT IN ('HIP-25K', 'HIT-25K') THEN
    RAISE EXCEPTION 'registrar_preparacion_media: % no es una preparación de barra permitida', v_salida USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.tipo IS DISTINCT FROM 'Preparacion' OR v_prev.input_sku IS DISTINCT FROM 'HIB-25K' OR v_prev.sku IS DISTINCT FROM v_salida
       OR v_prev.input_kg IS DISTINCT FROM p_medias::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'registrar_preparacion_media: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'medias', p_medias, 'salida_sku', v_prev.sku, 'bolsas', v_prev.cantidad,
      'cuarto_id', v_prev.cuarto_id, 'empaque_sku', v_prev.empaque_sku, 'empaque_cantidad', v_prev.empaque_cantidad,
      'costo_total', v_prev.costo_total, 'replay', true);
  END IF;

  SELECT id, tipo INTO v_ps FROM productos WHERE sku = 'HIB-25K';
  IF NOT FOUND OR COALESCE(v_ps.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_preparacion_media: la media barra HIB-25K no está en el catálogo' USING ERRCODE = '22023';
  END IF;
  SELECT id, tipo, empaque_sku INTO v_ps FROM productos WHERE sku = v_salida;
  IF NOT FOUND OR COALESCE(v_ps.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_preparacion_media: % no está en el catálogo como Producto Terminado', v_salida USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_preparacion_media: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_empaque := NULLIF(btrim(COALESCE(v_ps.empaque_sku, '')), '');
  IF v_empaque IS NULL THEN
    RAISE EXCEPTION 'registrar_preparacion_media: % no tiene empaque configurado', v_salida USING ERRCODE = '22023';
  END IF;
  IF v_empaque IN (v_salida, 'HIB-25K', 'HIB-50K') THEN
    RAISE EXCEPTION 'registrar_preparacion_media: el empaque de % es inválido', v_salida USING ERRCODE = '22023';
  END IF;
  SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_preparacion_media: empaque % no existe en el catálogo', v_empaque USING ERRCODE = '22023';
  END IF;
  v_costo_u := COALESCE(v_emp.costo_unitario, 0);

  v_folio := (SELECT 'PB-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);
  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id,
                          empaque_sku, empaque_cantidad, input_sku, input_kg, output_kg)
  VALUES (p_operacion_id, v_folio, 'Preparación', 'Preparación desde media barra', v_salida, p_medias, 'Confirmada', 'Preparacion', v_cuarto,
          v_empaque, p_medias, 'HIB-25K', p_medias, p_medias)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    IF v_prev.tipo IS DISTINCT FROM 'Preparacion' OR v_prev.input_sku IS DISTINCT FROM 'HIB-25K' OR v_prev.sku IS DISTINCT FROM v_salida
       OR v_prev.input_kg IS DISTINCT FROM p_medias::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'registrar_preparacion_media: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'medias', p_medias, 'salida_sku', v_prev.sku, 'bolsas', v_prev.cantidad,
      'cuarto_id', v_prev.cuarto_id, 'empaque_sku', v_prev.empaque_sku, 'empaque_cantidad', v_prev.empaque_cantidad,
      'costo_total', v_prev.costo_total, 'replay', true);
  END IF;

  -- Mismo orden de candados que 115: empaque → cuarto (media, salida).
  PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
    'sku', v_empaque, 'delta', -p_medias, 'tipo', 'Salida', 'origen', 'Preparación ' || v_folio)));
  PERFORM stock_mov_cuarto(v_cuarto, 'HIB-25K', -p_medias, 'Salida',
    'Preparación ' || v_folio || ': ' || p_medias || ' media(s) → ' || v_salida,
    NULL, 'preparacion/' || v_folio, v_actor, NULL, NULL);
  PERFORM stock_mov_cuarto(v_cuarto, v_salida, p_medias, 'Entrada',
    'Preparación ' || v_folio || ' en ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto),
    NULL, 'preparacion/' || v_folio, v_actor, NULL, NULL);

  IF v_costo_u > 0 THEN
    v_total := round(p_medias * v_costo_u, 2);
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas',
            'Preparación ' || v_folio || ': ' || p_medias || '× HIB-25K → ' || p_medias || '× ' || v_salida || ' (empaque: ' || v_empaque || ')',
            v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, NULL);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total WHERE id = v_id;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_actor, 'Preparar', 'Producción', v_folio || ' — ' || p_medias || '×HIB-25K → ' || p_medias || '×' || v_salida);

  RETURN jsonb_build_object('id', v_id, 'folio', v_folio, 'medias', p_medias, 'salida_sku', v_salida, 'bolsas', p_medias,
    'cuarto_id', v_cuarto, 'empaque_sku', v_empaque, 'empaque_cantidad', p_medias, 'costo_total', v_total,
    'actor', v_actor, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.registrar_preparacion_media(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_preparacion_media(UUID, TEXT, TEXT, INTEGER) TO authenticated, service_role;

-- ═══ 4. Producción normal: la media barra no se produce por máquina ═══
-- Definición vigente de 115, idéntica salvo el bloque marcado "129".
-- CREATE OR REPLACE conserva los permisos (authenticated, service_role).
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
  -- 115 (OP-01D.1): las bolsas de picada / triturada de barra solo entran al
  -- inventario por registrar_preparacion_barra (consumen la barra); una
  -- producción normal las crearía sin consumir barras.
  IF v_sku IN ('HIP-25K', 'HIT-25K') THEN
    RAISE EXCEPTION 'registrar_produccion: % solo se obtiene con Preparar desde barra', v_sku USING ERRCODE = '22023';
  END IF;
  -- 129: la media barra solo nace de partir una barra entera (si no, aparecería sin consumir la barra).
  IF v_sku = 'HIB-25K' THEN
    RAISE EXCEPTION 'registrar_produccion: % solo se obtiene al partir una barra', v_sku USING ERRCODE = '22023';
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
