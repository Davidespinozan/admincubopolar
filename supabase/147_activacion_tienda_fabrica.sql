-- 147_activacion_tienda_fabrica.sql — Tiendas propias, E6: configuración y activación
-- controlada de una tienda de fábrica. NO activa nada por sí sola.
--
-- Dos candados distintos, los dos apagados por omisión:
--   · El INTERRUPTOR GLOBAL (tiendas_activacion, 143) sigue como se cerró en E1: lo enciende
--     el dueño con SQL. Aquí NO se agrega ningún contrato que lo encienda. Con él apagado,
--     todos los contratos de esta migración responden TIENDAS_NO_ACTIVADAS.
--   · La ACTIVACIÓN DE CADA TIENDA (establecimientos.activo). Una tienda nueva nace
--     INACTIVA: mientras lo esté, nadie puede abrir turno, vender, buscar clientes ni
--     traspasar con ella (así lo exigen ya 144, 145 y 146). Solo activar_tienda la enciende,
--     y solo si la lista de verificación está completa.
--
-- CONTRATOS (todos de Administración; ninguna escritura por REST)
--   guardar_establecimiento     alta (siempre tienda_fabrica, inactiva) y nombre de una tienda.
--   asignar_cuarto_tienda       congelador de la tienda: uno nuevo, o uno VACÍO del CEDIS.
--   agregar_caja_tienda         primera(s) caja(s) de una tienda todavía inactiva (después
--                               de activarla, las cajas se administran con guardar_caja, 146).
--   asignar_usuario_tienda      persona ↔ tienda, con sus DOS permisos por separado y siempre
--                               explícitos: vende_desde_cedis (cajero) y traspasa_con_cedis
--                               (Producción o Administración). Ninguno se da por omisión.
--   retirar_usuario_tienda      quita la asignación. No con turno abierto; y si el cajero
--                               quedaría como Ventas CENTRAL, exige confirmarlo.
--   configurar_clientes_tienda  modo (lista / todos) y clientes elegibles del POS.
--   estado_tienda               lectura: configuración y lista de verificación.
--   activar_tienda              activa o desactiva: explícito, auditable e idempotente.
--
-- Contratos anteriores: NINGUNO cambia. Idempotente.
-- Reversión (sin tiendas): DROP de los 8 contratos, de tienda_exigir_admin, tienda_cargar,
-- tienda_checklist, establecimiento_eventos_guard y de la tabla establecimiento_eventos.

-- ═══ 0. Precondiciones ═══
DO $$
BEGIN
  IF to_regprocedure('public.pos_es_admin()') IS NULL OR to_regclass('public.cajas') IS NULL
     OR to_regprocedure('public.erp_usuario_de_tienda(bigint)') IS NULL THEN
    RAISE EXCEPTION '147: faltan las migraciones 145 y 146. No se aplicó nada.';
  END IF;
END $$;

-- ═══ 1. Historia de cada establecimiento ═══
CREATE TABLE IF NOT EXISTS public.establecimiento_eventos (
  id                 BIGSERIAL PRIMARY KEY,
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  tipo               TEXT NOT NULL CHECK (tipo IN ('alta', 'activacion', 'desactivacion')),
  operacion_id       UUID UNIQUE,
  huella             TEXT,
  actor_id           BIGINT,
  actor              TEXT,
  motivo             TEXT,
  datos              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.establecimiento_eventos IS
  '147: alta, activación y desactivación de cada tienda, con quién, cuándo, por qué y la lista de verificación de ese momento. Inmutable. Solo la lee Administración.';
CREATE INDEX IF NOT EXISTS establecimiento_eventos_est ON public.establecimiento_eventos (establecimiento_id, id);
ALTER TABLE public.establecimiento_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.establecimiento_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.establecimiento_eventos TO authenticated;
REVOKE ALL ON SEQUENCE public.establecimiento_eventos_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS admin_read ON public.establecimiento_eventos;
CREATE POLICY admin_read ON public.establecimiento_eventos FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');

CREATE OR REPLACE FUNCTION public.establecimiento_eventos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'establecimiento_eventos: no se escribe por API' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'establecimiento_eventos: la historia no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.establecimiento_eventos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_establecimiento_eventos_guard ON public.establecimiento_eventos;
CREATE TRIGGER trg_establecimiento_eventos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.establecimiento_eventos
  FOR EACH ROW EXECUTE FUNCTION public.establecimiento_eventos_guard();

-- ═══ 2. Funciones internas (sin EXECUTE por API) ═══
-- Administración + interruptor global encendido. Primero el permiso: quien no es Admin no se entera de nada más.
CREATE OR REPLACE FUNCTION public.tienda_exigir_admin(p_fn TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION '%: no autorizado', p_fn USING ERRCODE = '42501';
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION '%: las tiendas propias todavía no están activadas', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
END $$;

-- La tienda (nunca el CEDIS), bloqueada: toda la configuración de una tienda va una tras otra.
CREATE OR REPLACE FUNCTION public.tienda_cargar(p_fn TEXT, p_establecimiento_id BIGINT) RETURNS public.establecimientos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e establecimientos%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id FOR UPDATE;
  IF NOT FOUND OR v_e.tipo = 'cedis' THEN
    RAISE EXCEPTION '%: ese establecimiento no es una tienda', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
  RETURN v_e;
END $$;

-- Lista de verificación de una tienda. `obligatorio` = sin eso no se activa.
CREATE OR REPLACE FUNCTION public.tienda_checklist(p_establecimiento_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e         establecimientos%ROWTYPE;
  v_cuartos   INTEGER;
  v_cajas     INTEGER;
  v_cajeros   INTEGER;
  v_mal       INTEGER;
  v_clientes  INTEGER;
  v_colgadas  INTEGER;
  v_extras    INTEGER;
  v_seg       BOOLEAN;
BEGIN
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id;
  SELECT count(*) INTO v_cuartos FROM cuartos_frios WHERE establecimiento_id = v_e.id;
  SELECT count(*) INTO v_cajas FROM cajas WHERE establecimiento_id = v_e.id AND activa;
  SELECT count(*) INTO v_cajeros FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas' AND u.estatus = 'Activo';
  -- Permisos que no corresponden: persona inactiva o de un rol que no se asigna; vender desde el CEDIS
  -- sin ser cajero; traspasar siendo cajero; cualquiera de los dos fuera de una tienda de fábrica.
  SELECT count(*) INTO v_mal FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id
     AND (u.estatus <> 'Activo' OR u.rol NOT IN ('Ventas', 'Producción', 'Admin')
          OR (ue.vende_desde_cedis AND (u.rol <> 'Ventas' OR v_e.tipo <> 'tienda_fabrica'))
          OR (ue.traspasa_con_cedis AND (u.rol NOT IN ('Producción', 'Admin') OR v_e.tipo <> 'tienda_fabrica')));
  SELECT count(*) INTO v_clientes FROM establecimiento_clientes ec JOIN clientes c ON c.id = ec.cliente_id
   WHERE ec.establecimiento_id = v_e.id AND c.estatus = 'Activo' AND c.fusionado_en IS NULL;
  -- Incompatible: un cajero con ventas centrales sin terminar se quedaría sin poder atenderlas.
  SELECT count(*) INTO v_colgadas FROM ordenes o
   WHERE o.establecimiento_id IS NULL AND o.estatus IN ('Creada', 'Asignada', 'En ruta')
     AND o.vendedor_id IN (SELECT ue.usuario_id FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                            WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas');
  SELECT count(*) INTO v_extras FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas' AND cardinality(COALESCE(u.accesos_extra, '{}'::text[])) > 0;
  v_seg := to_regprocedure('public.erp_usuario_de_tienda(bigint)') IS NOT NULL
       AND to_regprocedure('public.erp_tienda_asignada(bigint,boolean)') IS NOT NULL
       AND to_regprocedure('public.vender_en_tienda(uuid,bigint,jsonb,text,bigint,text,boolean)') IS NOT NULL
       AND to_regprocedure('public.cerrar_turno_caja(uuid,bigint,numeric,text,text)') IS NOT NULL
       AND pg_get_functiondef('public.erp_actor()'::regprocedure) LIKE '%Ventas Tienda%'
       AND pg_get_functiondef('public.erp_lector_negocio()'::regprocedure) LIKE '%Ventas Tienda%'
       AND pg_get_functiondef('public.erp_es_activo()'::regprocedure) LIKE '%Ventas Tienda%'
       AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_cuartos_frios_actor', 'trg_ordenes_guard_turno', 'trg_ordenes_guard_establecimiento')
              AND NOT tgisinternal AND tgenabled = 'O') = 3
       AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tienda_read') >= 7
       AND (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
              AND c.relname IN ('establecimientos', 'usuario_establecimientos', 'establecimiento_clientes', 'cajas', 'turnos_caja', 'ventas_tienda'));
  RETURN jsonb_build_array(
    jsonb_build_object('clave', 'interruptor', 'obligatorio', true, 'ok', tiendas_habilitadas(), 'texto', 'Tiendas propias habilitadas por el dueño'),
    jsonb_build_object('clave', 'tipo', 'obligatorio', true, 'ok', v_e.tipo = 'tienda_fabrica', 'texto', 'Es una tienda de fábrica'),
    jsonb_build_object('clave', 'cuarto', 'obligatorio', true, 'ok', v_cuartos > 0, 'texto', 'Tiene al menos un congelador propio', 'cantidad', v_cuartos),
    jsonb_build_object('clave', 'caja', 'obligatorio', true, 'ok', v_cajas > 0, 'texto', 'Tiene al menos una caja activa', 'cantidad', v_cajas),
    jsonb_build_object('clave', 'personal', 'obligatorio', true, 'ok', v_cajeros > 0, 'texto', 'Tiene al menos un cajero (rol Ventas, activo) asignado', 'cantidad', v_cajeros),
    jsonb_build_object('clave', 'permisos', 'obligatorio', true, 'ok', v_mal = 0, 'texto', 'Las personas asignadas y sus permisos de inventario son válidos', 'cantidad', v_mal),
    jsonb_build_object('clave', 'ventas_centrales', 'obligatorio', true, 'ok', v_colgadas = 0,
                       'texto', 'Ningún cajero tiene ventas centrales sin terminar (dejaría de poder atenderlas)', 'cantidad', v_colgadas),
    jsonb_build_object('clave', 'seguridad', 'obligatorio', true, 'ok', COALESCE(v_seg, false), 'texto', 'Permisos, guardas y lectura acotada de tiendas instalados'),
    jsonb_build_object('clave', 'clientes', 'obligatorio', false, 'ok', v_e.clientes_pos = 'todos' OR v_clientes > 0,
                       'texto', CASE WHEN v_e.clientes_pos = 'todos' THEN 'El POS puede elegir a cualquier cliente vigente'
                                     WHEN v_clientes > 0 THEN 'El POS puede elegir a ' || v_clientes || ' cliente(s) de su lista'
                                     ELSE 'Sin clientes elegibles: la tienda solo vende al público en general' END, 'cantidad', v_clientes),
    jsonb_build_object('clave', 'accesos_adicionales', 'obligatorio', false, 'ok', v_extras = 0,
                       'texto', CASE WHEN v_extras = 0 THEN 'Ningún cajero pierde accesos adicionales'
                                     ELSE v_extras || ' cajero(s) tienen accesos adicionales que dejan de valer en la tienda' END, 'cantidad', v_extras));
END $$;
REVOKE ALL ON FUNCTION public.tienda_exigir_admin(TEXT), public.tienda_cargar(TEXT, BIGINT), public.tienda_checklist(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 3. guardar_establecimiento ═══
CREATE OR REPLACE FUNCTION public.guardar_establecimiento(p_id BIGINT, p_clave TEXT, p_nombre TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_clave  TEXT := upper(btrim(COALESCE(p_clave, '')));
  v_nombre TEXT := regexp_replace(btrim(COALESCE(p_nombre, '')), '\s+', ' ', 'g');
  v_etq    TEXT := erp_actor_etiqueta();
  v_e      establecimientos%ROWTYPE;
BEGIN
  PERFORM tienda_exigir_admin('guardar_establecimiento');
  IF length(v_nombre) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'guardar_establecimiento: escribe el nombre de la tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOMBRE_INVALIDO')::text;
  END IF;
  IF p_id IS NULL THEN
    IF v_clave !~ '^[A-Z0-9][A-Z0-9-]{1,19}$' THEN
      RAISE EXCEPTION 'guardar_establecimiento: la clave lleva de 2 a 20 letras, números o guiones' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_INVALIDA')::text;
    END IF;
    BEGIN
      -- Nace INACTIVA y siempre como tienda de fábrica (E6). Solo activar_tienda la enciende.
      INSERT INTO establecimientos (clave, nombre, tipo, activo) VALUES (v_clave, v_nombre, 'tienda_fabrica', false) RETURNING * INTO v_e;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'guardar_establecimiento: ya existe un establecimiento con la clave %', v_clave USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_REPETIDA')::text;
    END;
    INSERT INTO establecimiento_eventos (establecimiento_id, tipo, actor_id, actor, datos)
    VALUES (v_e.id, 'alta', erp_usuario_id(), v_etq, jsonb_build_object('clave', v_e.clave, 'nombre', v_e.nombre, 'tipo', v_e.tipo));
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Alta de tienda', 'Tiendas', v_e.clave || ' — ' || v_e.nombre || ' (inactiva)');
  ELSE
    v_e := tienda_cargar('guardar_establecimiento', p_id);
    IF v_clave <> '' AND v_clave <> v_e.clave THEN
      RAISE EXCEPTION 'guardar_establecimiento: la clave de una tienda no cambia' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_INVALIDA')::text;
    END IF;
    UPDATE establecimientos SET nombre = v_nombre WHERE id = v_e.id RETURNING * INTO v_e;
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Cambio de tienda', 'Tiendas', v_e.clave || ' — ' || v_e.nombre);
  END IF;
  RETURN jsonb_build_object('id', v_e.id, 'clave', v_e.clave, 'nombre', v_e.nombre, 'tipo', v_e.tipo, 'activo', v_e.activo, 'clientes_pos', v_e.clientes_pos);
END $$;

-- ═══ 4. asignar_cuarto_tienda ═══
CREATE OR REPLACE FUNCTION public.asignar_cuarto_tienda(p_establecimiento_id BIGINT, p_cuarto_id TEXT, p_nombre TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id     TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_nombre TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_etq    TEXT := erp_actor_etiqueta();
  v_e      establecimientos%ROWTYPE;
  v_c      cuartos_frios%ROWTYPE;
  v_nuevo  BOOLEAN := false;
BEGIN
  PERFORM tienda_exigir_admin('asignar_cuarto_tienda');
  v_e := tienda_cargar('asignar_cuarto_tienda', p_establecimiento_id);
  IF v_id !~ '^[A-Za-z0-9][A-Za-z0-9-]{1,19}$' THEN
    RAISE EXCEPTION 'asignar_cuarto_tienda: la clave del congelador lleva de 2 a 20 letras, números o guiones' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_INVALIDO')::text;
  END IF;
  SELECT * INTO v_c FROM cuartos_frios WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    IF v_nombre IS NULL THEN
      RAISE EXCEPTION 'asignar_cuarto_tienda: escribe el nombre del congelador nuevo' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOMBRE_INVALIDO')::text;
    END IF;
    INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES (v_id, v_nombre, '{}'::jsonb, v_e.id) RETURNING * INTO v_c;
    v_nuevo := true;
  ELSIF v_c.establecimiento_id = v_e.id THEN
    IF v_nombre IS NOT NULL AND v_nombre <> v_c.nombre THEN
      UPDATE cuartos_frios SET nombre = v_nombre WHERE id = v_c.id RETURNING * INTO v_c;
    END IF;
  ELSIF v_c.establecimiento_id <> 1 THEN
    RAISE EXCEPTION 'asignar_cuarto_tienda: el congelador % es de otra tienda', v_id USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_DE_OTRA_TIENDA')::text;
  ELSE
    -- Un cuarto del CEDIS solo pasa a la tienda VACÍO: con producto, el inventario cambiaría de dueño sin registro.
    IF EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(v_c.stock, '{}'::jsonb)) k WHERE COALESCE(k.value, '0') NOT IN ('0', '0.0')) THEN
      RAISE EXCEPTION 'asignar_cuarto_tienda: el cuarto % tiene producto; solo se asigna un cuarto vacío (el producto llega después por traspaso)', v_id
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_CON_EXISTENCIA')::text;
    END IF;
    UPDATE cuartos_frios SET establecimiento_id = v_e.id, nombre = COALESCE(v_nombre, nombre) WHERE id = v_c.id RETURNING * INTO v_c;
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Congelador de tienda', 'Tiendas', v_e.clave || ' — ' || v_c.id || ' (' || v_c.nombre || ')' || CASE WHEN v_nuevo THEN ' nuevo' ELSE '' END);
  RETURN jsonb_build_object('cuarto_id', v_c.id, 'nombre', v_c.nombre, 'establecimiento_id', v_c.establecimiento_id, 'nuevo', v_nuevo);
END $$;

-- ═══ 5. agregar_caja_tienda (para preparar una tienda que todavía no está activa) ═══
CREATE OR REPLACE FUNCTION public.agregar_caja_tienda(p_establecimiento_id BIGINT, p_nombre TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT := regexp_replace(btrim(COALESCE(p_nombre, '')), '\s+', ' ', 'g');
  v_etq    TEXT := erp_actor_etiqueta();
  v_e      establecimientos%ROWTYPE;
  v_c      cajas%ROWTYPE;
BEGIN
  PERFORM tienda_exigir_admin('agregar_caja_tienda');
  v_e := tienda_cargar('agregar_caja_tienda', p_establecimiento_id);
  IF length(v_nombre) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'agregar_caja_tienda: escribe el nombre de la caja (máximo 60 letras)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOMBRE_INVALIDO')::text;
  END IF;
  BEGIN
    INSERT INTO cajas (establecimiento_id, nombre, activa, creada_por, creada_por_nombre, modificada_por_nombre)
    VALUES (v_e.id, v_nombre, true, erp_usuario_id(), v_etq, v_etq) RETURNING * INTO v_c;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'agregar_caja_tienda: esa tienda ya tiene una caja llamada "%"', v_nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_REPETIDA')::text;
  END;
  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Alta de caja', 'Tiendas', v_e.nombre || ' — ' || v_nombre);
  RETURN jsonb_build_object('id', v_c.id, 'establecimiento_id', v_c.establecimiento_id, 'nombre', v_c.nombre, 'activa', v_c.activa);
END $$;

-- ═══ 6. asignar_usuario_tienda ═══
-- Los dos permisos van SIEMPRE escritos (sí o no): no hay valor por omisión ni permiso implícito, tampoco para Administración.
--   vende_desde_cedis   solo un cajero (rol Ventas) de una tienda de fábrica: vender existencia del CEDIS en su POS (D-S4).
--   traspasa_con_cedis  solo Producción o Administración: mover producto CEDIS ↔ esa tienda con traspaso_cuartos (144).
-- Asignar a un usuario de rol Ventas lo convierte, para el servidor, en «Ventas Tienda» (145).
CREATE OR REPLACE FUNCTION public.asignar_usuario_tienda(p_establecimiento_id BIGINT, p_usuario_id BIGINT, p_vende_desde_cedis BOOLEAN, p_traspasa_con_cedis BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq   TEXT := erp_actor_etiqueta();
  v_e     establecimientos%ROWTYPE;
  v_u     usuarios%ROWTYPE;
  v_antes usuario_establecimientos%ROWTYPE;
  v_era_tienda BOOLEAN;
BEGIN
  PERFORM tienda_exigir_admin('asignar_usuario_tienda');
  v_e := tienda_cargar('asignar_usuario_tienda', p_establecimiento_id);
  IF p_vende_desde_cedis IS NULL OR p_traspasa_con_cedis IS NULL THEN
    RAISE EXCEPTION 'asignar_usuario_tienda: indica sí o no en cada permiso (vender desde el CEDIS y traspasar con el CEDIS)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PERMISOS_EXPLICITOS')::text;
  END IF;
  SELECT * INTO v_u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_u.estatus <> 'Activo' THEN
    RAISE EXCEPTION 'asignar_usuario_tienda: ese usuario no existe o está dado de baja' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'USUARIO_NO_VALIDO')::text;
  END IF;
  IF v_u.rol NOT IN ('Ventas', 'Producción', 'Admin') THEN
    RAISE EXCEPTION 'asignar_usuario_tienda: a una tienda se asignan cajeros (rol Ventas) y, para traspasos, Producción o Administración; % no', v_u.rol
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ROL_NO_ASIGNABLE')::text;
  END IF;
  IF p_vende_desde_cedis AND (v_u.rol <> 'Ventas' OR v_e.tipo <> 'tienda_fabrica') THEN
    RAISE EXCEPTION 'asignar_usuario_tienda: vender desde el CEDIS es solo para un cajero (rol Ventas) de una tienda de fábrica' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PERMISO_NO_CORRESPONDE')::text;
  END IF;
  IF p_traspasa_con_cedis AND (v_u.rol NOT IN ('Producción', 'Admin') OR v_e.tipo <> 'tienda_fabrica') THEN
    RAISE EXCEPTION 'asignar_usuario_tienda: traspasar con el CEDIS es solo para Producción o Administración, en una tienda de fábrica' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PERMISO_NO_CORRESPONDE')::text;
  END IF;
  v_era_tienda := erp_usuario_de_tienda(v_u.id);
  SELECT * INTO v_antes FROM usuario_establecimientos WHERE usuario_id = v_u.id AND establecimiento_id = v_e.id;
  INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis, traspasa_con_cedis, asignado_por)
  VALUES (v_u.id, v_e.id, p_vende_desde_cedis, p_traspasa_con_cedis, v_etq)
  ON CONFLICT (usuario_id, establecimiento_id)
  DO UPDATE SET vende_desde_cedis = EXCLUDED.vende_desde_cedis, traspasa_con_cedis = EXCLUDED.traspasa_con_cedis, asignado_por = EXCLUDED.asignado_por;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, CASE WHEN v_antes.usuario_id IS NULL THEN 'Asignación a tienda' ELSE 'Cambio de permisos de tienda' END, 'Tiendas',
          v_e.clave || ' — ' || v_u.nombre || ' (' || v_u.rol || ') — vende desde CEDIS: ' || CASE WHEN p_vende_desde_cedis THEN 'sí' ELSE 'no' END
          || ', traspasa con CEDIS: ' || CASE WHEN p_traspasa_con_cedis THEN 'sí' ELSE 'no' END);
  RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', v_u.id, 'nombre', v_u.nombre, 'rol', v_u.rol,
                            'vende_desde_cedis', p_vende_desde_cedis, 'traspasa_con_cedis', p_traspasa_con_cedis, 'nueva', v_antes.usuario_id IS NULL,
                            -- Aviso para quien asigna: este usuario deja de ser Ventas central.
                            'pasa_a_ventas_tienda', v_u.rol = 'Ventas' AND NOT v_era_tienda);
END $$;

-- ═══ 7. retirar_usuario_tienda ═══
CREATE OR REPLACE FUNCTION public.retirar_usuario_tienda(p_establecimiento_id BIGINT, p_usuario_id BIGINT, p_confirmar_ventas_central BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq TEXT := erp_actor_etiqueta();
  v_e   establecimientos%ROWTYPE;
  v_u   usuarios%ROWTYPE;
  v_queda_central BOOLEAN;
BEGIN
  PERFORM tienda_exigir_admin('retirar_usuario_tienda');
  v_e := tienda_cargar('retirar_usuario_tienda', p_establecimiento_id);
  SELECT * INTO v_u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM usuario_establecimientos WHERE usuario_id = p_usuario_id AND establecimiento_id = v_e.id) THEN
    RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', p_usuario_id, 'retirado', false, 'sin_cambio', true);   -- reintento: ya no estaba
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.cajero_id = p_usuario_id AND t.establecimiento_id = v_e.id AND t.estado = 'abierto') THEN
    RAISE EXCEPTION 'retirar_usuario_tienda: esa persona tiene un turno de caja abierto en la tienda; ciérralo primero' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_ABIERTO')::text;
  END IF;
  -- Un cajero sin ninguna tienda vuelve a ser Ventas CENTRAL (lee y vende todo lo central): no pasa sin que alguien lo confirme.
  v_queda_central := v_u.rol = 'Ventas' AND v_u.estatus = 'Activo'
    AND NOT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN establecimientos e ON e.id = ue.establecimiento_id
                     WHERE ue.usuario_id = p_usuario_id AND ue.establecimiento_id <> v_e.id AND e.tipo <> 'cedis');
  IF v_queda_central AND NOT COALESCE(p_confirmar_ventas_central, false) THEN
    RAISE EXCEPTION 'retirar_usuario_tienda: al quitarle su única tienda, % volvería a ser Ventas central (vería y vendería lo central). Si ya no trabaja en la empresa, dalo de baja; si de verdad pasa a Ventas central, confírmalo.', v_u.nombre
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'QUEDARIA_VENTAS_CENTRAL')::text;
  END IF;
  DELETE FROM usuario_establecimientos WHERE usuario_id = p_usuario_id AND establecimiento_id = v_e.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Retiro de tienda', 'Tiendas', v_e.clave || ' — ' || COALESCE(v_u.nombre, p_usuario_id::text) || CASE WHEN v_queda_central THEN ' — queda como Ventas central (confirmado)' ELSE '' END);
  RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', p_usuario_id, 'retirado', true, 'queda_ventas_central', v_queda_central);
END $$;

-- ═══ 8. configurar_clientes_tienda ═══
CREATE OR REPLACE FUNCTION public.configurar_clientes_tienda(p_establecimiento_id BIGINT, p_modo TEXT DEFAULT NULL, p_agregar BIGINT[] DEFAULT NULL, p_quitar BIGINT[] DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq  TEXT := erp_actor_etiqueta();
  v_e    establecimientos%ROWTYPE;
  v_modo TEXT := NULLIF(btrim(COALESCE(p_modo, '')), '');
  v_mal  BIGINT;
  v_mas  INTEGER := 0;
  v_menos INTEGER := 0;
BEGIN
  PERFORM tienda_exigir_admin('configurar_clientes_tienda');
  v_e := tienda_cargar('configurar_clientes_tienda', p_establecimiento_id);
  IF v_modo IS NOT NULL AND v_modo NOT IN ('lista', 'todos') THEN
    RAISE EXCEPTION 'configurar_clientes_tienda: el modo es lista o todos' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MODO_INVALIDO')::text;
  END IF;
  IF COALESCE(cardinality(p_agregar), 0) > 500 OR COALESCE(cardinality(p_quitar), 0) > 500 THEN
    RAISE EXCEPTION 'configurar_clientes_tienda: máximo 500 clientes por vez' USING ERRCODE = '22023';
  END IF;
  -- Solo clientes vigentes: activos y no fusionados.
  SELECT x INTO v_mal FROM unnest(COALESCE(p_agregar, '{}'::bigint[])) AS x
   WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id = x AND c.estatus = 'Activo' AND c.fusionado_en IS NULL) LIMIT 1;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'configurar_clientes_tienda: el cliente % no existe, está inactivo o fue fusionado', v_mal USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLIENTE_NO_VALIDO')::text;
  END IF;
  IF v_modo IS NOT NULL AND v_modo <> v_e.clientes_pos THEN
    UPDATE establecimientos SET clientes_pos = v_modo WHERE id = v_e.id RETURNING * INTO v_e;
  END IF;
  INSERT INTO establecimiento_clientes (establecimiento_id, cliente_id, asignado_por)
  SELECT v_e.id, x, v_etq FROM (SELECT DISTINCT y AS x FROM unnest(COALESCE(p_agregar, '{}'::bigint[])) AS y) d
  ON CONFLICT (establecimiento_id, cliente_id) DO NOTHING;
  GET DIAGNOSTICS v_mas = ROW_COUNT;
  DELETE FROM establecimiento_clientes WHERE establecimiento_id = v_e.id AND cliente_id = ANY (COALESCE(p_quitar, '{}'::bigint[]));
  GET DIAGNOSTICS v_menos = ROW_COUNT;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Clientes de tienda', 'Tiendas', v_e.clave || ' — modo ' || v_e.clientes_pos || ', +' || v_mas || ' −' || v_menos);
  RETURN jsonb_build_object('establecimiento_id', v_e.id, 'clientes_pos', v_e.clientes_pos, 'agregados', v_mas, 'quitados', v_menos,
                            'clientes', (SELECT count(*) FROM establecimiento_clientes WHERE establecimiento_id = v_e.id));
END $$;

-- ═══ 9. estado_tienda (lectura) ═══
-- Sin establecimiento: resumen de todas las tiendas. Con establecimiento: su configuración completa.
-- De los clientes solo id y nombre; de las personas, nombre, rol y sus dos permisos.
CREATE OR REPLACE FUNCTION public.estado_tienda(p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e   establecimientos%ROWTYPE;
  v_chk JSONB;
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION 'estado_tienda: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_establecimiento_id IS NULL THEN
    RETURN jsonb_build_object(
      'tiendas_habilitadas', tiendas_habilitadas(),
      'tiendas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'clave', e.clave, 'nombre', e.nombre, 'tipo', e.tipo, 'activo', e.activo, 'clientes_pos', e.clientes_pos,
                                    'lista_para_activar', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tienda_checklist(e.id)) k
                                                                       WHERE (k.value -> 'obligatorio')::boolean AND NOT (k.value -> 'ok')::boolean)) ORDER BY e.id)
                             FROM establecimientos e WHERE e.tipo <> 'cedis'), '[]'::jsonb));
  END IF;
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id;
  IF NOT FOUND OR v_e.tipo = 'cedis' THEN
    RAISE EXCEPTION 'estado_tienda: ese establecimiento no es una tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
  v_chk := tienda_checklist(v_e.id);
  RETURN jsonb_build_object(
    'tiendas_habilitadas', tiendas_habilitadas(),
    'tienda', jsonb_build_object('id', v_e.id, 'clave', v_e.clave, 'nombre', v_e.nombre, 'tipo', v_e.tipo, 'activo', v_e.activo, 'clientes_pos', v_e.clientes_pos),
    'verificacion', v_chk,
    'lista_para_activar', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_chk) k WHERE (k.value -> 'obligatorio')::boolean AND NOT (k.value -> 'ok')::boolean),
    'cuartos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre,
                           'piezas', (SELECT COALESCE(sum(GREATEST(COALESCE(NULLIF(s.value, '')::INTEGER, 0), 0)), 0) FROM jsonb_each_text(COALESCE(c.stock, '{}'::jsonb)) s)) ORDER BY c.id)
                           FROM cuartos_frios c WHERE c.establecimiento_id = v_e.id), '[]'::jsonb),
    'cajas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'activa', c.activa,
                         'turno_abierto', EXISTS (SELECT 1 FROM turnos_caja t WHERE t.caja_id = c.id AND t.estado = 'abierto')) ORDER BY c.nombre, c.id)
                         FROM cajas c WHERE c.establecimiento_id = v_e.id), '[]'::jsonb),
    'personal', COALESCE((SELECT jsonb_agg(jsonb_build_object('usuario_id', u.id, 'nombre', u.nombre, 'rol', u.rol, 'estatus', u.estatus,
                            'vende_desde_cedis', ue.vende_desde_cedis, 'traspasa_con_cedis', ue.traspasa_con_cedis,
                            'turno_abierto', EXISTS (SELECT 1 FROM turnos_caja t WHERE t.cajero_id = u.id AND t.establecimiento_id = v_e.id AND t.estado = 'abierto')) ORDER BY u.nombre, u.id)
                            FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id WHERE ue.establecimiento_id = v_e.id), '[]'::jsonb),
    'clientes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'vigente', c.estatus = 'Activo' AND c.fusionado_en IS NULL) ORDER BY c.nombre, c.id)
                            FROM establecimiento_clientes ec JOIN clientes c ON c.id = ec.cliente_id WHERE ec.establecimiento_id = v_e.id), '[]'::jsonb),
    'historia', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', h.tipo, 'actor', h.actor, 'motivo', h.motivo, 'fecha', h.created_at) ORDER BY h.id DESC)
                            FROM establecimiento_eventos h WHERE h.establecimiento_id = v_e.id), '[]'::jsonb));
END $$;

-- ═══ 10. activar_tienda ═══
CREATE OR REPLACE FUNCTION public.activar_tienda(p_operacion_id UUID, p_establecimiento_id BIGINT, p_activar BOOLEAN, p_motivo TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_e      establecimientos%ROWTYPE;
  v_prev   establecimiento_eventos%ROWTYPE;
  v_chk    JSONB;
  v_faltan JSONB;
  v_huella TEXT;
  v_res    JSONB;
BEGIN
  PERFORM tienda_exigir_admin('activar_tienda');
  IF p_operacion_id IS NULL OR p_activar IS NULL THEN
    RAISE EXCEPTION 'activar_tienda: operación y acción (activar sí o no) son obligatorias' USING ERRCODE = '22023';
  END IF;
  v_huella := jsonb_build_object('establecimiento', p_establecimiento_id, 'activar', p_activar, 'motivo', v_motivo)::text;
  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  SELECT * INTO v_prev FROM establecimiento_eventos WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella IS DISTINCT FROM v_huella THEN
      RAISE EXCEPTION 'activar_tienda: esa operación ya se usó con otros datos' USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'OPERACION_REPETIDA')::text;
    END IF;
    RETURN v_prev.datos || jsonb_build_object('replay', true);
  END IF;
  v_e := tienda_cargar('activar_tienda', p_establecimiento_id);

  IF p_activar THEN
    IF v_e.activo THEN
      RETURN jsonb_build_object('establecimiento_id', v_e.id, 'activo', true, 'sin_cambio', true, 'replay', false);
    END IF;
    v_chk := tienda_checklist(v_e.id);
    SELECT jsonb_agg(k.value ->> 'clave') INTO v_faltan FROM jsonb_array_elements(v_chk) k WHERE (k.value -> 'obligatorio')::boolean AND NOT (k.value -> 'ok')::boolean;
    IF v_faltan IS NOT NULL THEN
      RAISE EXCEPTION 'activar_tienda: a la tienda "%" le falta configuración para activarse', v_e.nombre
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDA_INCOMPLETA', 'faltan', v_faltan)::text;
    END IF;
    UPDATE establecimientos SET activo = true WHERE id = v_e.id RETURNING * INTO v_e;
  ELSE
    IF NOT v_e.activo THEN
      RETURN jsonb_build_object('establecimiento_id', v_e.id, 'activo', false, 'sin_cambio', true, 'replay', false);
    END IF;
    IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
      RAISE EXCEPTION 'activar_tienda: escribe por qué se desactiva la tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
    END IF;
    -- No se apaga con cajas abiertas: primero se cierran los turnos (cada uno con su conteo).
    IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.establecimiento_id = v_e.id AND t.estado = 'abierto') THEN
      RAISE EXCEPTION 'activar_tienda: la tienda tiene turnos de caja abiertos; ciérralos antes de desactivarla' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNOS_ABIERTOS')::text;
    END IF;
    v_chk := tienda_checklist(v_e.id);
    UPDATE establecimientos SET activo = false WHERE id = v_e.id RETURNING * INTO v_e;
  END IF;

  v_res := jsonb_build_object('establecimiento_id', v_e.id, 'clave', v_e.clave, 'nombre', v_e.nombre, 'activo', v_e.activo, 'sin_cambio', false,
                              'motivo', v_motivo, 'actor', v_etq, 'verificacion', v_chk, 'replay', false);
  INSERT INTO establecimiento_eventos (establecimiento_id, tipo, operacion_id, huella, actor_id, actor, motivo, datos)
  VALUES (v_e.id, CASE WHEN p_activar THEN 'activacion' ELSE 'desactivacion' END, p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_motivo, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, CASE WHEN p_activar THEN 'Activación de tienda' ELSE 'Desactivación de tienda' END, 'Tiendas', v_e.clave || ' — ' || v_e.nombre || COALESCE(' — ' || v_motivo, ''));
  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.guardar_establecimiento(BIGINT, TEXT, TEXT), public.asignar_cuarto_tienda(BIGINT, TEXT, TEXT), public.agregar_caja_tienda(BIGINT, TEXT),
  public.asignar_usuario_tienda(BIGINT, BIGINT, BOOLEAN, BOOLEAN), public.retirar_usuario_tienda(BIGINT, BIGINT, BOOLEAN),
  public.configurar_clientes_tienda(BIGINT, TEXT, BIGINT[], BIGINT[]), public.estado_tienda(BIGINT), public.activar_tienda(UUID, BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_establecimiento(BIGINT, TEXT, TEXT), public.asignar_cuarto_tienda(BIGINT, TEXT, TEXT), public.agregar_caja_tienda(BIGINT, TEXT),
  public.asignar_usuario_tienda(BIGINT, BIGINT, BOOLEAN, BOOLEAN), public.retirar_usuario_tienda(BIGINT, BIGINT, BOOLEAN),
  public.configurar_clientes_tienda(BIGINT, TEXT, BIGINT[], BIGINT[]), public.estado_tienda(BIGINT), public.activar_tienda(UUID, BIGINT, BOOLEAN, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
