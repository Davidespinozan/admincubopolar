-- 119_cierre_api_empleado_test.sql — WF-0.2: el rol Empleado solo usa su sesión,
-- su perfil, Mi asistencia y Mis actividades. Sin escritura directa en
-- auditoria / notificaciones / storage de mermas, sin helpers de historia y sin
-- RPCs de negocio; los demás roles y los contratos conservan su comportamiento.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t119_ids;
CREATE TABLE t119_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t119_ids TO PUBLIC;

CREATE OR REPLACE FUNCTION t119_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM actividad_ocurrencias WHERE actividad_id IN (SELECT id FROM actividades WHERE titulo LIKE 'T119%');
  DELETE FROM actividades WHERE titulo LIKE 'T119%';
  DELETE FROM asistencias WHERE empleado_id = 11951;
  DELETE FROM turnos WHERE empleado_id = 11951;
  DELETE FROM centros_trabajo WHERE nombre = 'Planta T119';
  DELETE FROM auditoria WHERE usuario LIKE '%119%' OR detalle LIKE '%T119%';
  DELETE FROM notificaciones WHERE titulo LIKE 'T119%';
  DELETE FROM storage.objects WHERE bucket_id = 'mermas' AND name LIKE '11950000-%';
  DELETE FROM empleados WHERE id = 11951;
  DELETE FROM usuarios WHERE id BETWEEN 11951 AND 11959;
  DELETE FROM auth.users WHERE id::text LIKE '11950000-%';
END $$;

BEGIN; SELECT t119_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11950000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t119' FROM generate_series(1, 8) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11951, 'Admin 119', 'u1@t119', 'Admin', 'Activo', '11950000-0000-0000-0000-000000000001'),
  (11952, 'Producción 119', 'u2@t119', 'Producción', 'Activo', '11950000-0000-0000-0000-000000000002'),
  (11953, 'Ventas 119', 'u3@t119', 'Ventas', 'Activo', '11950000-0000-0000-0000-000000000003'),
  (11954, 'Chofer 119', 'u4@t119', 'Chofer', 'Activo', '11950000-0000-0000-0000-000000000004'),
  (11955, 'Facturación 119', 'u5@t119', 'Facturación', 'Activo', '11950000-0000-0000-0000-000000000005'),
  (11956, 'Almacén 119', 'u6@t119', 'Almacén Bolsas', 'Activo', '11950000-0000-0000-0000-000000000006'),
  (11957, 'Empleado 119', 'u7@t119', 'Empleado', 'Activo', '11950000-0000-0000-0000-000000000007'),
  (11958, 'Sin asignar 119', 'u8@t119', 'Sin asignar', 'Activo', '11950000-0000-0000-0000-000000000008');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus)
  VALUES (11951, 'Empleado T119', 'Ayudante', 'Planta', 300, '2026-01-01', 'Activo');
INSERT INTO notificaciones (tipo, titulo, mensaje, leida) VALUES ('info', 'T119 fija', 'no se toca', false);
INSERT INTO storage.buckets (id, name) VALUES ('mermas', 'mermas') ON CONFLICT DO NOTHING;
COMMIT;

CREATE OR REPLACE FUNCTION t119_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t119_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t119_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11950000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t119_sub(p_k INTEGER) RETURNS TEXT LANGUAGE sql AS $$ SELECT '11950000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0') $$;
CREATE OR REPLACE FUNCTION t119_r() RETURNS JSONB LANGUAGE sql AS $$ SELECT current_setting('t119.r')::jsonb $$;
CREATE OR REPLACE FUNCTION t119_guardar(p_r JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('t119.r', p_r::text, true); $$;
CREATE OR REPLACE FUNCTION t119_conteos() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; r JSONB := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['camiones', 'cierres_diarios', 'clientes', 'comodatos', 'configuracion_empresa', 'costos_empaque_historial',
    'costos_fijos', 'costos_historial', 'cuartos_frios', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'devoluciones', 'inventario_mov',
    'notificaciones', 'orden_lineas', 'ordenes', 'pagos', 'pagos_proveedores', 'precios_esp', 'produccion', 'productos', 'rutas',
    'stock_operaciones', 'umbrales'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    r := r || jsonb_build_object(t, n);
  END LOOP;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION t119_assert(BOOLEAN, TEXT), t119_err(TEXT, TEXT, TEXT), t119_auth(INTEGER), t119_sub(INTEGER), t119_r(), t119_guardar(JSONB), t119_conteos() TO PUBLIC;

-- Lo único que el Empleado puede ejecutar (A: requerido; B: plataforma sin datos de negocio).
CREATE OR REPLACE FUNCTION t119_permitidas() RETURNS TEXT[] LANGUAGE sql AS $$ SELECT ARRAY[
  -- A. sesión / Mi asistencia / Mis actividades
  'mi_asistencia()', 'registrar_entrada(uuid,double precision,double precision,numeric)',
  'registrar_salida(uuid,double precision,double precision,numeric)', 'asistencia_empleado_actual()',
  'calendario(date,date,boolean,boolean)', 'completar_ocurrencia(uuid,bigint,date,text)',
  -- B. identidad propia (también la evalúan las policies) y cálculo puro
  'erp_actor()', 'erp_actor_nombre()', 'erp_actor_etiqueta()', 'erp_es_activo()', 'erp_lector_negocio()', 'erp_rol_activo()',
  'erp_usuario_id()', 'get_my_rol()', 'get_my_user_id()', 'fin_mi_rol_activo()', 'fin_actor_permitido(text[])', 'fin_jwt_role()',
  'fin_ctx_activo()', 'fin_hoy()', 'fin_zona_negocio()', 'fin_dia_negocio(timestamp with time zone)', 'fin_es_credito(text)',
  'nomina_inicio_semana(date)', 'asistencia_distancia_m(double precision,double precision,double precision,double precision)',
  'asistencia_clasificar_entrada(timestamp with time zone,integer,timestamp with time zone)', 'b4_escritura_api()',
  'b4_asiento_de_contrato(text,text,bigint,text)']::text[] $$;
GRANT EXECUTE ON FUNCTION t119_permitidas() TO PUBLIC;

\echo '── 119: superficie'
SELECT t119_assert(pg_get_functiondef('public.erp_es_activo()'::regprocedure) LIKE '%erp_rol_activo() IS NOT NULL AND erp_rol_activo() <> ''Empleado''%',
  '119-00a erp_es_activo(): activo y no Empleado');
SELECT t119_assert(NOT has_function_privilege('authenticated', 'public.erp_exigir_no_empleado(text)', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.erp_exigir_no_empleado(text)', 'EXECUTE'),
  '119-00b la guarda no se expone por API');
SELECT t119_assert((SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND pg_get_functiondef(p.oid) LIKE '%erp_exigir_no_empleado(%')
                    FROM pg_proc p WHERE p.oid IN ('public.b4_ruta_con_historia(bigint)'::regprocedure, 'public.cuarto_tiene_historia(text)'::regprocedure,
                      'public.empaque_tiene_dependencias(bigint,text)'::regprocedure, 'public.erp_foto_merma_en_uso(text)'::regprocedure)),
  '119-00c los 4 helpers de historia conservan su EXECUTE (triggers de Admin) y llevan la guarda');
SELECT t119_assert((SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%erp_es_activo()%') = 6,
  '119-00d las 6 policies que usan erp_es_activo() no cambian de texto');

\echo '── CASOS 1–2: auditoria, notificaciones y storage de mermas'
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(7);
SELECT t119_assert(NOT erp_es_activo(), '119-00e erp_es_activo() = false para el Empleado');
SELECT t119_err($$INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('Empleado 119', 'Falsa', 'X', 'T119 inventada')$$,
  '119-01 Empleado no inserta auditoría directa', '42501');
SELECT t119_err($$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T119 falsa', 'x')$$,
  '119-02a Empleado no inserta notificaciones', '42501');
UPDATE notificaciones SET leida = true;
SELECT t119_err(format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '%s/2026-10-07/x.jpg')$$, t119_sub(7)),
  '119-02b Empleado no sube archivos al bucket de mermas (ni en su carpeta)', '42501');
RESET ROLE;
SELECT t119_assert((SELECT NOT leida FROM notificaciones WHERE titulo = 'T119 fija'), '119-02c el UPDATE masivo del Empleado no tocó ninguna notificación');
COMMIT;
SELECT t119_assert((SELECT count(*) FROM auditoria WHERE detalle LIKE '%T119 inventada%') = 0
               AND (SELECT count(*) FROM notificaciones WHERE titulo = 'T119 falsa') = 0, '119-02d nada se escribió');

\echo '── CASO 3: lectura de las 24 tablas (117)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(7);
SELECT t119_assert((SELECT bool_and(value::bigint = 0) FROM jsonb_each_text(t119_conteos())), '119-03 Empleado: 0 filas en las 24 tablas');
COMMIT;

\echo '── CASOS 4–5: helpers de historia y RPCs de negocio'
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(7);
SELECT t119_err($$SELECT cuarto_tiene_historia('CF-1')$$, '119-04a cuarto_tiene_historia rechazado', '42501');
SELECT t119_err($$SELECT empaque_tiene_dependencias(1, 'EMP-5')$$, '119-04b empaque_tiene_dependencias rechazado', '42501');
SELECT t119_err($$SELECT b4_ruta_con_historia(1)$$, '119-04c b4_ruta_con_historia rechazado', '42501');
SELECT t119_err($$SELECT erp_foto_merma_en_uso('x.jpg')$$, '119-04d erp_foto_merma_en_uso rechazado', '42501');
COMMIT;
-- Sondeo de TODA la superficie: cada función ejecutable por authenticated fuera
-- de la lista permitida debe rechazar al Empleado con 42501 (argumentos NULL;
-- cada llamada se deshace). Las funciones auxiliares de las suites se excluyen.
DO $$
DECLARE
  f RECORD; v_state TEXT; v_msg TEXT; v_mal TEXT[] := '{}'; v_n INTEGER := 0; v_perm TEXT[] := t119_permitidas();
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11950000-0000-0000-0000-000000000007')::text, true);
  FOR f IN SELECT p.oid::regprocedure::text AS sig, p.proname, oidvectortypes(p.proargtypes) AS args
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND p.prorettype <> 'event_trigger'::regtype AND p.proname !~ '^(t_|t[0-9]+_|op3_)' ORDER BY 1 LOOP
    CONTINUE WHEN f.sig = ANY (v_perm);
    v_n := v_n + 1;
    v_state := NULL;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I(%s)', f.proname,
                     (SELECT string_agg('NULL::' || t, ', ') FROM unnest(string_to_array(NULLIF(f.args, ''), ', ')) t));
      RAISE EXCEPTION 'ejecutó' USING ERRCODE = 'P0099';
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
    END;
    IF v_state <> '42501' THEN v_mal := v_mal || (f.sig || ' → ' || v_state || ' ' || left(v_msg, 60)); END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 119-05 funciones que no rechazan al Empleado: %', v_mal; END IF;
  RAISE NOTICE 'OK: 119-05 las % funciones de negocio ejecutables por authenticated rechazan al Empleado (42501)', v_n;
END $$;

\echo '── CASOS 6–9: Mi asistencia, perfil y contratos de asistencia con auditoría'
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(1);
SELECT vincular_empleado_usuario(11951, 11957);
SELECT t119_guardar(guardar_centro_trabajo(NULL, 'Planta T119', 23.2494, -106.4111, 100, 50, true));
SELECT guardar_turno(NULL, 11951, (t119_r() ->> 'id')::bigint, ARRAY[1,2,3,4,5,6,7]::smallint[],
  (date_trunc('minute', now() AT TIME ZONE 'America/Mazatlan') - interval '5 minutes')::time,
  (date_trunc('minute', now() AT TIME ZONE 'America/Mazatlan') + interval '475 minutes')::time, 10, CURRENT_DATE - 3, NULL, true);
COMMIT;
SELECT t119_assert((SELECT count(*) FROM auditoria WHERE usuario = 'Admin 119' AND modulo IN ('Empleados', 'Asistencia')) = 3,
  '119-09 los contratos de asistencia siguen escribiendo su auditoría (3)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(7);
SELECT t119_assert((SELECT count(*) FROM usuarios) = 1 AND (SELECT nombre FROM erp_actor()) = 'Empleado 119' AND erp_rol_activo() = 'Empleado',
  '119-08 sesión y perfil propio');
SELECT t119_guardar(mi_asistencia());
SELECT t119_assert(t119_r() ->> 'estado' = 'pendiente' AND t119_r() #>> '{empleado,nombre}' = 'Empleado T119', '119-06a Mi asistencia: entrada pendiente');
SELECT t119_guardar(registrar_entrada('11900000-0000-0000-0000-0000000000a1', 23.2494, -106.4111, 10));
SELECT t119_assert((t119_r() ->> 'ok')::boolean AND t119_r() #>> '{asistencia,entrada_estado}' = 'a_tiempo', '119-06b el Empleado marca su entrada');
SELECT t119_assert((SELECT count(*) FROM asistencias) = 1, '119-06c y la ve (solo la suya)');
COMMIT;

\echo '── CASOS 7, 10: Mis actividades y auditoría del calendario'
BEGIN; SET LOCAL ROLE authenticated; SELECT t119_auth(1);
SELECT t119_guardar(guardar_actividad('11900000-0000-0000-0000-0000000000b1', NULL, jsonb_build_object('titulo', 'T119 Barrer andén',
  'categoria', 'limpieza', 'recurrencia', 'unica', 'fecha_inicio', fin_hoy(), 'fecha_fin', fin_hoy() + 1, 'responsable_usuario_id', 11957, 'visibilidad', 'asignado')));
RESET ROLE; INSERT INTO t119_ids VALUES ('act', t119_r() ->> 'id');
SET LOCAL ROLE authenticated; SELECT t119_auth(7);
SELECT t119_guardar(calendario(fin_hoy() - 7, fin_hoy() + 30, true));
SELECT t119_assert(jsonb_array_length(t119_r() -> 'ocurrencias') = 1 AND t119_r() #>> '{ocurrencias,0,titulo}' = 'T119 Barrer andén'
               AND (t119_r() #>> '{ocurrencias,0,puede_completar}')::boolean, '119-07a Mis actividades: la suya, completable');
SELECT t119_guardar(completar_ocurrencia('11900000-0000-0000-0000-0000000000b2', (SELECT v::bigint FROM t119_ids WHERE k = 'act'), fin_hoy(), 'Hecho'));
SELECT t119_assert((t119_r() ->> 'ok')::boolean AND t119_r() #>> '{ocurrencia,clasificacion}' = 'en_ventana', '119-07b el Empleado la completa');
COMMIT;
SELECT t119_assert((SELECT count(*) FROM auditoria WHERE modulo = 'Calendario' AND accion = 'Completar' AND usuario = 'Empleado 119') = 1
               AND (SELECT count(*) FROM auditoria WHERE modulo = 'Calendario' AND accion = 'Crear' AND usuario = 'Admin 119') = 1,
  '119-10 el calendario sigue escribiendo su auditoría (también la del Empleado, por el contrato)');

\echo '── CASOS 11–16: los demás roles conservan su escritura y sus helpers'
DO $$
DECLARE k INTEGER; v_rol TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY[1, 2, 3, 4, 5, 6, 8] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11950000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_rol := erp_rol_activo();
    IF NOT erp_es_activo() OR NOT erp_lector_negocio() THEN RAISE EXCEPTION 'FAIL: %: erp_es_activo/erp_lector_negocio deberían ser true', v_rol; END IF;
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_rol || ' 119', 'Prueba', 'T119', 'T119 ' || v_rol);
    INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T119 ' || v_rol, 'ok');
    EXECUTE format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '%s/2026-10-07/%s.jpg')$q$,
                   '11950000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'), k);
    PERFORM cuarto_tiene_historia('CF-1'), empaque_tiene_dependencias(1, 'EMP-5'), b4_ruta_con_historia(1), erp_foto_merma_en_uso('x.jpg');
    EXECUTE 'RESET ROLE';
  END LOOP;
  RAISE NOTICE 'OK: 119-11..16 Admin, Producción, Ventas, Chofer, Facturación, Almacén Bolsas y Sin asignar: auditoría, notificaciones, foto de merma y helpers como antes';
END $$;
SELECT t119_assert((SELECT count(*) FROM auditoria WHERE modulo = 'T119') = 7 AND (SELECT count(*) FROM notificaciones WHERE titulo LIKE 'T119 %' AND titulo <> 'T119 fija') = 7
               AND (SELECT count(*) FROM storage.objects WHERE bucket_id = 'mermas' AND name LIKE '11950000-%') = 7,
  '119-11b 7 roles × (auditoría + notificación + foto) escritos');
SELECT t119_assert(cuarto_tiene_historia('NO-EXISTE') = false, '119-11c sin sesión (contratos y triggers): los helpers responden igual');

\echo '── 119: limpieza'
BEGIN; SELECT t119_limpiar(); COMMIT;
DROP TABLE t119_ids;
DROP FUNCTION t119_limpiar(); DROP FUNCTION t119_assert(BOOLEAN, TEXT); DROP FUNCTION t119_err(TEXT, TEXT, TEXT); DROP FUNCTION t119_auth(INTEGER);
DROP FUNCTION t119_sub(INTEGER); DROP FUNCTION t119_r(); DROP FUNCTION t119_guardar(JSONB); DROP FUNCTION t119_conteos(); DROP FUNCTION t119_permitidas();
\echo '119: OK'
