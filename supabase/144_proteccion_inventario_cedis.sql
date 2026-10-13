-- 144_proteccion_inventario_cedis.sql — Tiendas propias, E2: las operaciones centrales
-- usan SOLO inventario del CEDIS.
--
-- Con 143 cada cuarto frío pertenece a un establecimiento y hoy todos son del CEDIS.
-- Antes de que exista una tienda (el interruptor de 143 sigue APAGADO y esta migración
-- no lo toca) hay que cerrar los caminos por los que una operación central tomaría
-- producto de un congelador de tienda:
--
--   A. `confirmar_carga_ruta` bloqueaba y recorría TODOS los cuartos: un camión se
--      cargaría también del congelador de una tienda. Ahora bloquea y carga solo del
--      CEDIS. Mismo orden de bloqueo (ruta → cuartos por id), misma idempotencia.
--   B. `crear_orden` sumaba la existencia de todos los cuartos para avisar faltantes
--      (4 lecturas). Ahora cuenta solo el CEDIS. Precios, cliente, crédito, líneas y
--      el resto del contrato no cambian.
--   C. `ajustar_existencia` (producto terminado) repartía el ajuste entre todos los
--      cuartos. Ahora ajusta solo los del CEDIS. Empaque e insumos no cambian.
--   D. `traspaso_cuartos` movía entre cualesquiera dos cuartos. Ahora: dentro del
--      mismo establecimiento, como siempre; CEDIS ↔ tienda de fábrica solo con la
--      autorización explícita del actor; cualquier otro cruce se rechaza (una tienda
--      externa se abastece con despacho y recepción, bloque E7).
--   E. Guarda de inventario (nueva): Producción y Chofer no cambian la existencia de
--      un cuarto que no es del CEDIS, llamen el contrato que llamen. La identidad
--      sale del token de la petición (`auth.uid()`), que es el mismo dentro de una
--      función SECURITY DEFINER; no depende de qué RPC se use.
--
-- Mientras solo exista el CEDIS, NADA cambia: los filtros dejan los mismos cuartos y
-- la guarda no actúa sobre cuartos del CEDIS. El CEDIS es el establecimiento 1 (143
-- lo garantiza y esta migración lo vuelve a comprobar).
--
-- Autorización del traspaso CEDIS ↔ tienda de fábrica: `usuario_establecimientos.
-- traspasa_con_cedis` (columna nueva, apagada). La necesita todo usuario con sesión,
-- también Administración. Nadie la tiene hoy y no hay pantalla ni contrato que la
-- conceda todavía.
--
-- Lo que NO cambia: `erp_actor`, `erp_roles_activos`, `erp_lector_negocio` (E3),
-- `completar_venta_directa`, `stock_mov_cuarto`, pagos, CxC, caja, mermas, conteos por
-- cuarto, T5-A a T5-D2, policies y permisos. No crea, mueve ni repara datos.
--
-- Cada función es la definición vigente en producción con los cambios marcados "144".
-- La migración ABORTA si alguna de las cuatro no tiene la huella auditada (ni la nueva).
--
-- Idempotente. Reversión: volver a crear las cuatro funciones con su definición
-- anterior (085 para la carga, 137 para el pedido, 108 para el ajuste, 084 para el
-- traspaso), DROP TRIGGER trg_cuartos_frios_actor ON cuartos_frios, DROP FUNCTION
-- cuartos_frios_guard_actor(), traspaso_fabrica_autorizado(bigint) y
-- ALTER TABLE usuario_establecimientos DROP COLUMN traspasa_con_cedis.

-- ═══ 0. Precondiciones: 143 aplicada, CEDIS = 1, y las cuatro funciones son las auditadas ═══
CREATE OR REPLACE FUNCTION pg_temp.t144_exigir(p_firma TEXT, p_antes TEXT, p_despues TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT := md5(pg_get_functiondef(p_firma::regprocedure));
BEGIN
  IF v NOT IN (p_antes, p_despues) THEN
    RAISE EXCEPTION '144: % no tiene la definición auditada (md5 %; se esperaba % o %). No se aplicó nada.', p_firma, v, p_antes, p_despues;
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('public.establecimientos') IS NULL THEN
    RAISE EXCEPTION '144: falta la migración 143 (establecimientos). No se aplicó nada.';
  END IF;
  IF (SELECT count(*) FROM public.establecimientos WHERE id = 1 AND tipo = 'cedis') <> 1 THEN
    RAISE EXCEPTION '144: el CEDIS debe ser el establecimiento 1. No se aplicó nada.';
  END IF;
  PERFORM pg_temp.t144_exigir('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)', 'b1be0d0eda13210f828d23572e8d0fb3', '50ce141b71b2692a015a1cd77e780fec');
  PERFORM pg_temp.t144_exigir('public.crear_orden(jsonb,jsonb)', 'ef8e49a380d52f870aaccc1bf2ef323c', 'ccdd240c58f69d89699c99c89199e911');
  PERFORM pg_temp.t144_exigir('public.ajustar_existencia(uuid,text,integer,text)', 'def11d269c049c7301dfa568a96c529f', '0a5f9c2c95b89c0deb8a38bca5dd7f8a');
  PERFORM pg_temp.t144_exigir('public.traspaso_cuartos(uuid,text,text,text,integer)', '8a03866b79eb80cd45cc3862d43a9b03', 'f73c7272614080b951bfc3d813f8dff4');
END $$;

-- ═══ 1. Autorización explícita del traspaso CEDIS ↔ tienda de fábrica ═══
ALTER TABLE public.usuario_establecimientos ADD COLUMN IF NOT EXISTS traspasa_con_cedis BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.usuario_establecimientos.traspasa_con_cedis IS
  '144: el usuario puede mover producto entre el CEDIS y ESTA tienda de fábrica con traspaso_cuartos. Apagado por omisión; lo exige todo usuario con sesión, también Administración.';

CREATE OR REPLACE FUNCTION public.traspaso_fabrica_autorizado(p_establecimiento_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  -- Sesiones de confianza (servidor, SQL): como en todos los contratos, no llevan actor.
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN RETURN TRUE; END IF;
  IF v_jwt <> 'authenticated' THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM usuario_establecimientos ue JOIN establecimientos e ON e.id = ue.establecimiento_id
     WHERE ue.usuario_id = erp_usuario_id() AND ue.establecimiento_id = p_establecimiento_id
       AND ue.traspasa_con_cedis AND e.tipo = 'tienda_fabrica' AND e.activo);
END $$;
REVOKE ALL ON FUNCTION public.traspaso_fabrica_autorizado(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Guarda: Producción y Chofer no cambian la existencia de un cuarto de tienda ═══
-- Corre en CADA cambio de existencia de un cuarto, lo dispare quien lo dispare (todos los
-- contratos pasan por stock_mov_cuarto → UPDATE cuartos_frios). El actor es el del token
-- de la petición, igual dentro de una función SECURITY DEFINER. Los cuartos del CEDIS no
-- se revisan: ahí todo sigue como hoy.
CREATE OR REPLACE FUNCTION public.cuartos_frios_guard_actor() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT;
  v_rol TEXT;
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock OR OLD.establecimiento_id = 1 THEN
    RETURN NEW;
  END IF;
  v_jwt := fin_jwt_role();
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN
    RETURN NEW;                       -- sesión de confianza: sin actor que restringir
  END IF;
  v_rol := erp_rol_activo();
  IF v_rol IS NULL OR v_rol IN ('Producción', 'Chofer') THEN
    -- Única excepción: el traspaso CEDIS ↔ tienda de fábrica que traspaso_cuartos YA autorizó
    -- (marca local a la transacción, fijada solo por ese contrato y solo para sus dos cuartos).
    IF v_rol = 'Producción'
       AND OLD.id = ANY (string_to_array(COALESCE(current_setting('app.traspaso_ctx', true), ''), '|')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'El cuarto % es de una tienda: % no puede mover su inventario.', OLD.id, COALESCE(v_rol, 'un usuario sin perfil activo')
      USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'INVENTARIO_DE_TIENDA', 'cuarto_id', OLD.id, 'establecimiento', OLD.establecimiento_id)::text;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cuartos_frios_guard_actor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cuartos_frios_actor ON public.cuartos_frios;
CREATE TRIGGER trg_cuartos_frios_actor BEFORE UPDATE OF stock ON public.cuartos_frios
  FOR EACH ROW EXECUTE FUNCTION public.cuartos_frios_guard_actor();

-- ═══ A. Carga de ruta: solo del CEDIS (2 líneas) ═══
-- Definición vigente en producción (md5 b1be0d0eda13210f828d23572e8d0fb3) con SOLO los cambios marcados "144".
CREATE OR REPLACE FUNCTION public.confirmar_carga_ruta(p_operacion_id uuid, p_ruta_id bigint, p_firma text DEFAULT NULL::text, p_excepcion boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Bloquear los cuartos del CEDIS en orden de id antes de asignar (determinista, sin deadlock).
  -- 144: una ruta se carga SOLO del CEDIS (establecimiento 1); los congeladores de tienda no se tocan.
  PERFORM 1 FROM cuartos_frios WHERE establecimiento_id = 1 ORDER BY id FOR UPDATE;

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
    FOR v_cf IN SELECT id, COALESCE((stock ->> v_sku)::INTEGER, 0) AS disp FROM cuartos_frios WHERE establecimiento_id = 1 ORDER BY id LOOP
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
END $function$;

-- ═══ B. Pedido: existencia del CEDIS (4 lecturas) ═══
-- Definición vigente en producción (md5 ef8e49a380d52f870aaccc1bf2ef323c) con SOLO los cambios marcados "144".
CREATE OR REPLACE FUNCTION public.crear_orden(p_orden jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      SELECT COALESCE(SUM(COALESCE((stock ->> (v_l ->> 'sku'))::INTEGER, 0)), 0) INTO v_disp FROM cuartos_frios WHERE establecimiento_id = 1;   -- 144: existencia del CEDIS
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
                WHERE cf.establecimiento_id = 1 AND s.key IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K') GROUP BY 1) k),
      NULL);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', q.sku, 'pedido', q.cantidad, 'disponible', q.disp, 'falta', q.cantidad - q.disp) ORDER BY q.sku), '[]'::jsonb)
      INTO v_faltan
      FROM (SELECT x.sku, x.cantidad,
                   (SELECT COALESCE(SUM(GREATEST(COALESCE(NULLIF(cf.stock ->> x.sku, '')::INTEGER, 0), 0)), 0)::INTEGER FROM cuartos_frios cf WHERE cf.establecimiento_id = 1) AS disp
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
                  WHERE cf.establecimiento_id = 1 AND s.key IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K') GROUP BY 1) k),
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
END $function$;

-- ═══ C. Ajuste de existencia de producto terminado: solo cuartos del CEDIS ═══
-- Definición vigente en producción (md5 def11d269c049c7301dfa568a96c529f) con SOLO los cambios marcados "144".
CREATE OR REPLACE FUNCTION public.ajustar_existencia(p_operacion_id uuid, p_sku text, p_nueva_existencia integer, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_prod     RECORD;
  v_actual   INTEGER;
  v_delta    INTEGER;
  v_rest     INTEGER;
  v_take     INTEGER;
  v_room     RECORD;
  v_origen   TEXT;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'ajustar_existencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'ajustar_existencia: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'ajustar_existencia: el motivo es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_nueva_existencia IS NULL OR p_nueva_existencia < 0 THEN
    RAISE EXCEPTION 'ajustar_existencia: la existencia debe ser 0 o mayor' USING ERRCODE = '22023';
  END IF;
  v_clave := 'ajuste|' || v_sku || '|' || p_nueva_existencia || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'ajuste_existencia', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT sku, tipo, COALESCE(stock, 0) AS stock INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ajustar_existencia: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  -- 108: el empaque no entra por ajuste (no hay costo conocido para esas
  -- unidades y no heredan el promedio). Con el producto bloqueado: la
  -- existencia comparada es la vigente.
  IF v_prod.tipo = 'Empaque' AND p_nueva_existencia > v_prod.stock THEN
    RAISE EXCEPTION 'ajustar_existencia: el empaque % no se aumenta con un ajuste manual (existencia actual: %); las entradas de empaque se registran con la recepción de compra', v_sku, v_prod.stock
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'ajuste_existencia', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  v_origen := 'Ajuste manual: ' || v_motivo;

  IF v_prod.tipo = 'Producto Terminado' THEN
    -- Producto terminado: los cuartos fríos son el inventario (misma regla
    -- que el ajuste anterior: sube en el primer cuarto con existencia o el
    -- primero; baja FIFO por id). productos.stock queda como espejo.
    -- 144: el ajuste central es del CEDIS (establecimiento 1); los congeladores de tienda no se tocan.
    PERFORM 1 FROM cuartos_frios WHERE establecimiento_id = 1 ORDER BY id FOR UPDATE;
    SELECT COALESCE(sum(COALESCE((stock ->> v_sku)::INTEGER, 0)), 0)::INTEGER INTO v_actual FROM cuartos_frios WHERE establecimiento_id = 1;
    v_delta := p_nueva_existencia - v_actual;
    IF v_delta > 0 THEN
      SELECT id INTO v_room FROM cuartos_frios WHERE establecimiento_id = 1 ORDER BY (COALESCE((stock ->> v_sku)::INTEGER, 0) > 0) DESC, id LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ajustar_existencia: no hay cuartos fríos para aplicar el ajuste' USING ERRCODE = '22023';
      END IF;
      PERFORM stock_mov_cuarto(v_room.id, v_sku, v_delta, 'Entrada', v_origen, NULL, 'ajuste_existencia/' || v_sku, v_etiqueta, NULL, p_operacion_id);
    ELSIF v_delta < 0 THEN
      v_rest := -v_delta;
      FOR v_room IN SELECT id, COALESCE((stock ->> v_sku)::INTEGER, 0) AS q FROM cuartos_frios WHERE establecimiento_id = 1 AND COALESCE((stock ->> v_sku)::INTEGER, 0) > 0 ORDER BY id LOOP
        EXIT WHEN v_rest <= 0;
        v_take := least(v_room.q, v_rest);
        PERFORM stock_mov_cuarto(v_room.id, v_sku, -v_take, 'Salida', v_origen, NULL, 'ajuste_existencia/' || v_sku, v_etiqueta, NULL, p_operacion_id);
        v_rest := v_rest - v_take;
      END LOOP;
    END IF;
    UPDATE productos SET stock = p_nueva_existencia WHERE sku = v_sku;
  ELSE
    -- Insumos (empaque, materia prima): productos.stock ES el inventario total.
    -- Empaque: solo a la baja (108); el costo promedio no cambia.
    v_actual := v_prod.stock;
    v_delta := p_nueva_existencia - v_actual;
    IF v_delta <> 0 THEN
      UPDATE productos SET stock = p_nueva_existencia WHERE sku = v_sku;
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
      VALUES (CASE WHEN v_delta > 0 THEN 'Entrada' ELSE 'Salida' END, v_sku, abs(v_delta), v_origen, v_etiqueta, 'ajuste_existencia/' || v_sku, p_operacion_id);
    END IF;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Ajustar', 'Inventario', v_sku || ': ' || v_actual || ' → ' || p_nueva_existencia || '. Motivo: ' || v_motivo);
  v_res := jsonb_build_object('sku', v_sku, 'anterior', v_actual, 'nueva', p_nueva_existencia, 'delta', v_delta,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $function$;

-- ═══ D. Traspaso entre cuartos: mismo establecimiento, o CEDIS ↔ tienda de fábrica con autorización ═══
-- Definición vigente en producción (md5 8a03866b79eb80cd45cc3862d43a9b03) con SOLO los cambios marcados "144".
CREATE OR REPLACE FUNCTION public.traspaso_cuartos(p_operacion_id uuid, p_origen text, p_destino text, p_sku text, p_cantidad integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_prev     JSONB;
  v_clave    TEXT;
  v_so       INTEGER;
  v_sd       INTEGER;
  v_res      JSONB;
  v_eo       RECORD;   -- 144: establecimiento del origen
  v_ed       RECORD;   -- 144: establecimiento del destino
  v_tf       BIGINT;   -- 144: la tienda de fábrica del traspaso excepcional
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'traspaso_cuartos: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_sku IS NULL THEN
    RAISE EXCEPTION 'traspaso_cuartos: origen, destino y sku son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_origen = p_destino THEN
    RAISE EXCEPTION 'traspaso_cuartos: origen y destino deben ser distintos' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'traspaso_cuartos: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = p_origen) OR NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = p_destino) THEN
    RAISE EXCEPTION 'traspaso_cuartos: cuarto frío no encontrado' USING ERRCODE = '22023';
  END IF;
  v_clave := 'traspaso|' || p_origen || '|' || p_destino || '|' || p_sku || '|' || p_cantidad;
  v_prev := stock_op_replay(p_operacion_id, 'traspaso', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  -- 144 (Tiendas E2): este contrato mueve producto dentro de UN establecimiento. La única
  -- excepción es CEDIS ↔ tienda de fábrica (mismo sitio, salida y entrada simultáneas), y
  -- solo para quien tiene la autorización explícita. A una tienda externa NO se traspasa
  -- por aquí: su abastecimiento lleva despacho y recepción (traspasos con tránsito).
  SELECT e.id, e.tipo INTO v_eo FROM cuartos_frios c JOIN establecimientos e ON e.id = c.establecimiento_id WHERE c.id = p_origen;
  SELECT e.id, e.tipo INTO v_ed FROM cuartos_frios c JOIN establecimientos e ON e.id = c.establecimiento_id WHERE c.id = p_destino;
  IF v_eo.id <> v_ed.id THEN
    IF NOT ((v_eo.tipo = 'cedis' AND v_ed.tipo = 'tienda_fabrica') OR (v_eo.tipo = 'tienda_fabrica' AND v_ed.tipo = 'cedis')) THEN
      RAISE EXCEPTION 'Los cuartos % y % son de establecimientos distintos: entre establecimientos no se traspasa con este movimiento (una tienda se abastece con despacho y recepción).', p_origen, p_destino
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_ENTRE_ESTABLECIMIENTOS', 'origen', v_eo.id, 'destino', v_ed.id)::text;
    END IF;
    v_tf := CASE WHEN v_eo.tipo = 'tienda_fabrica' THEN v_eo.id ELSE v_ed.id END;
    IF NOT traspaso_fabrica_autorizado(v_tf) THEN
      RAISE EXCEPTION 'No tienes autorización para mover producto entre el CEDIS y la tienda de fábrica.'
        USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_AUTORIZADO', 'establecimiento', v_tf)::text;
    END IF;
    -- Marca local a la transacción que la guarda de inventario reconoce SOLO para estos dos cuartos.
    PERFORM set_config('app.traspaso_ctx', p_origen || '|' || p_destino, true);
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'traspaso', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  -- Bloquear ambos cuartos en orden de id (sin deadlock entre traspasos cruzados).
  PERFORM 1 FROM cuartos_frios WHERE id IN (p_origen, p_destino) ORDER BY id FOR UPDATE;
  v_so := stock_mov_cuarto(p_origen,  p_sku, -p_cantidad, 'Traspaso salida',  p_origen || ' → ' || p_destino, p_destino, 'traspaso/' || p_origen || '>' || p_destino, v_etiqueta, NULL, p_operacion_id);
  v_sd := stock_mov_cuarto(p_destino, p_sku,  p_cantidad, 'Traspaso entrada', p_origen || ' → ' || p_destino, p_destino, 'traspaso/' || p_origen || '>' || p_destino, v_etiqueta, NULL, p_operacion_id);
  PERFORM set_config('app.traspaso_ctx', '', true);
  v_res := jsonb_build_object('origen', p_origen, 'destino', p_destino, 'sku', p_sku, 'cantidad', p_cantidad, 'stock_origen', v_so, 'stock_destino', v_sd, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $function$;
