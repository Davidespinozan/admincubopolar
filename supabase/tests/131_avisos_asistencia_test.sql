-- 131_avisos_asistencia_test.sql — PD-01.1: avisos de asistencia (qué se
-- genera, cuándo, para quién, una sola vez) y su configuración.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t131_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM asistencia_avisos WHERE empleado_id BETWEEN 13101 AND 13109;
  DELETE FROM asistencias WHERE empleado_id BETWEEN 13101 AND 13109;
  DELETE FROM turnos WHERE empleado_id BETWEEN 13101 AND 13109;
  DELETE FROM centros_trabajo WHERE id IN (13101, 13102);
  DELETE FROM empleados WHERE id BETWEEN 13101 AND 13109;
  DELETE FROM auditoria WHERE usuario = 'Admin T131';
  DELETE FROM usuarios WHERE id BETWEEN 13101 AND 13109;
  DELETE FROM auth.users WHERE id::text LIKE '13100000-%';
  IF to_regclass('public.t131_cfg') IS NOT NULL THEN
    UPDATE asistencia_avisos_config c SET (activo, empleado_antes_min, empleado_tarde, empleado_salida_min, jefes_sin_marcar_min, jefes_retardo, jefes_sin_salida_min, jefes, actualizado_por, updated_at)
      = (SELECT activo, empleado_antes_min, empleado_tarde, empleado_salida_min, jefes_sin_marcar_min, jefes_retardo, jefes_sin_salida_min, jefes, actualizado_por, updated_at FROM t131_cfg);
    DROP TABLE t131_cfg;
  END IF;
  IF to_regclass('public.t131_turnos_apartados') IS NOT NULL THEN
    UPDATE turnos t SET activo = true FROM t131_turnos_apartados a WHERE a.id = t.id;
    DROP TABLE t131_turnos_apartados;
  END IF;
END $$;

-- Instante de HOY (día de negocio) a una hora local.
CREATE OR REPLACE FUNCTION t131_ts(p_hora TIME, p_dias INTEGER DEFAULT 0) RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT ((fin_hoy() + p_dias + p_hora)::timestamp AT TIME ZONE fin_zona_negocio())
$$;
CREATE OR REPLACE FUNCTION t131_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t131_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t131_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '13100000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
-- Tipos generados por una llamada, como texto "tipo:empleado" ordenado.
CREATE OR REPLACE FUNCTION t131_tipos(p_r JSONB) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(a ->> 'tipo' || ':' || (SELECT empleado_id FROM asistencia_avisos WHERE id = (a ->> 'id')::bigint), ',' ORDER BY a ->> 'tipo', (a ->> 'id')::bigint), '')
    FROM jsonb_array_elements(p_r -> 'avisos') a
   WHERE (SELECT empleado_id FROM asistencia_avisos WHERE id = (a ->> 'id')::bigint) BETWEEN 13101 AND 13109 $$;
GRANT EXECUTE ON FUNCTION t131_ts(TIME, INTEGER), t131_assert(BOOLEAN, TEXT), t131_err(TEXT, TEXT, TEXT, TEXT), t131_actor(INTEGER), t131_tipos(JSONB) TO PUBLIC;
DROP TABLE IF EXISTS t131_ids;
CREATE TEMP TABLE t131_ids (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t131_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t131_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t131_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t131_j(TEXT) TO PUBLIC;

BEGIN; SELECT t131_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE t131_cfg AS SELECT * FROM asistencia_avisos_config WHERE id = 1;
-- Turnos ajenos a la prueba se apartan (los avisos de la prueba deben ser exactos).
CREATE TABLE t131_turnos_apartados AS SELECT id FROM turnos WHERE activo;
UPDATE turnos SET activo = false WHERE id IN (SELECT id FROM t131_turnos_apartados);
UPDATE asistencia_avisos_config SET activo = true, empleado_antes_min = 10, empleado_tarde = true, empleado_salida_min = 5,
       jefes_sin_marcar_min = 15, jefes_retardo = true, jefes_sin_salida_min = 60, jefes = 'admins' WHERE id = 1;
INSERT INTO auth.users (id, email) SELECT ('13100000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t131' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, es_dueno) VALUES
  (13101, 'Admin T131',  'u1@t131', 'Admin',    'Activo',   '13100000-0000-0000-0000-000000000001', false),
  (13102, 'Dueño T131',  'u2@t131', 'Admin',    'Activo',   '13100000-0000-0000-0000-000000000002', true),
  (13103, 'Uno T131',    'u3@t131', 'Empleado', 'Activo',   '13100000-0000-0000-0000-000000000003', false),
  (13104, 'Dos T131',    'u4@t131', 'Chofer',   'Activo',   '13100000-0000-0000-0000-000000000004', false),
  (13105, 'Admin baja',  'u5@t131', 'Admin',    'Inactivo', '13100000-0000-0000-0000-000000000005', false);
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id) VALUES
  (13101, 'Uno T131',      'Operador', 'Producción', 100, '2024-01-01', 'Activo',   13103),
  (13102, 'Dos T131',      'Chofer',   'Ventas',     100, '2024-01-01', 'Activo',   13104),
  (13103, 'Sinlink T131',  'Operador', 'Producción', 100, '2024-01-01', 'Activo',   NULL),
  (13104, 'Baja T131',     'Operador', 'Producción', 100, '2024-01-01', 'Inactivo', NULL),
  (13105, 'Descansa T131', 'Operador', 'Producción', 100, '2024-01-01', 'Activo',   NULL),
  (13106, 'Cerrado T131',  'Operador', 'Producción', 100, '2024-01-01', 'Activo',   NULL);
INSERT INTO centros_trabajo (id, nombre, latitud, longitud, radio_m, activo) VALUES (13101, 'Centro T131', 24, -104, 100, true), (13102, 'Centro T131 cerrado', 24, -104, 100, false);
-- Todos 08:00–16:00, tolerancia 10. "Descansa" no trabaja hoy; "Cerrado" tiene el centro inactivo.
INSERT INTO turnos (id, empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde) VALUES
  (13101, 13101, 13101, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13102, 13102, 13101, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13103, 13103, 13101, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13104, 13104, 13101, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13105, 13105, 13101, ARRAY[(EXTRACT(ISODOW FROM fin_hoy())::int % 7) + 1]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13106, 13106, 13102, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01');
COMMIT;

\echo '── 131: esquema y acceso'
SELECT t131_assert((SELECT count(*) = 2 AND bool_and(c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('asistencia_avisos', 'asistencia_avisos_config'))
  AND (SELECT count(*) = 2 AND bool_and(cmd = 'SELECT' AND qual = '(erp_rol_activo() = ''Admin''::text)') FROM pg_policies WHERE tablename IN ('asistencia_avisos', 'asistencia_avisos_config'))
  AND (SELECT bool_and(has_table_privilege('authenticated', t, 'SELECT') AND NOT has_table_privilege('authenticated', t, 'INSERT') AND NOT has_table_privilege('authenticated', t, 'UPDATE')
                       AND NOT has_table_privilege('authenticated', t, 'DELETE') AND NOT has_table_privilege('anon', t, 'SELECT'))
         FROM unnest(ARRAY['public.asistencia_avisos', 'public.asistencia_avisos_config']) t),
  '131-01 dos tablas con RLS: lectura de Admin, sin escritura por API, anon nada');
SELECT t131_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
                      AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE')
                      FROM pg_proc WHERE oid = 'public.asistencia_generar_avisos(timestamptz)'::regprocedure)
  AND (SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                       AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 2
         FROM pg_proc WHERE oid IN ('public.avisos_asistencia()'::regprocedure, 'public.guardar_avisos_asistencia(jsonb)'::regprocedure)),
  '131-02 generar avisos: solo service_role; contratos de Admin sin anon');
SELECT t131_assert((SELECT count(*) = 1 FROM asistencia_avisos_config), '131-03 la configuración es una sola fila');

\echo '── 131: avisos a la persona y a los jefes, a su hora y una sola vez'
INSERT INTO t131_ids VALUES ('a0', asistencia_generar_avisos(t131_ts('07:40')));
INSERT INTO t131_ids VALUES ('a1', asistencia_generar_avisos(t131_ts('07:52')));
INSERT INTO t131_ids VALUES ('a1b', asistencia_generar_avisos(t131_ts('07:56')));
SELECT t131_assert(t131_tipos(t131_j('a0')) = '' AND t131_tipos(t131_j('a1')) = 'entrada_proxima:13101,entrada_proxima:13102' AND t131_tipos(t131_j('a1b')) = '',
  '131-04 10 min antes de la entrada: solo a quien tiene usuario, turno hoy, está activo y su centro está activo; no se repite');
SELECT t131_assert((SELECT a ->> 'usuario_id' = '13103' AND a ->> 'titulo' = 'Tu turno empieza a las 08:00' AND a ->> 'destino' = 'empleado'
                      FROM jsonb_array_elements(t131_j('a1') -> 'avisos') a WHERE (SELECT empleado_id FROM asistencia_avisos WHERE id = (a ->> 'id')::bigint) = 13101)
  AND t131_j('a1') -> 'jefes' @> '[13101, 13102]'::jsonb AND NOT t131_j('a1') -> 'jefes' @> '[13105]'::jsonb AND NOT t131_j('a1') -> 'jefes' @> '[13103]'::jsonb,
  '131-05 el aviso a la persona lleva SU usuario; jefes = Admins activos');
-- 13101 marca a las 08:25 (retardo de 25 min); 13102 y 13103 no marcan.
BEGIN; SET LOCAL session_replication_role = replica;
INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min, radio_m, precision_max_m,
                         entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m, entrada_estado, minutos_retardo, operacion_entrada, created_at)
VALUES (13101, 13103, 13101, 13101, fin_hoy(), t131_ts('08:00'), t131_ts('16:00'), 10, 100, 50, t131_ts('08:25'), 24, -104, 10, 5, 'retardo', 25, gen_random_uuid(), t131_ts('08:25'));
COMMIT;
INSERT INTO t131_ids VALUES ('a2', asistencia_generar_avisos(t131_ts('08:10')));
INSERT INTO t131_ids VALUES ('a3', asistencia_generar_avisos(t131_ts('08:12')));
INSERT INTO t131_ids VALUES ('a4', asistencia_generar_avisos(t131_ts('08:27')));
INSERT INTO t131_ids VALUES ('a4b', asistencia_generar_avisos(t131_ts('08:31')));
SELECT t131_assert(t131_tipos(t131_j('a2')) = '' AND t131_tipos(t131_j('a3')) = 'entrada_tarde:13102'
  AND t131_tipos(t131_j('a4')) = 'jefes_retardo:13101,jefes_sin_marcar:13102,jefes_sin_marcar:13103' AND t131_tipos(t131_j('a4b')) = '',
  '131-06 justo en la tolerancia aún no avisa; después: a la persona que no marcó, y a los jefes el retardo y quién falta (también sin usuario)');
SELECT t131_assert((SELECT titulo = 'Uno T131 llegó con retardo' AND mensaje = '25 min tarde (turno de las 08:00).' FROM asistencia_avisos WHERE empleado_id = 13101 AND tipo = 'jefes_retardo')
  AND (SELECT a ->> 'usuario_id' IS NULL FROM jsonb_array_elements(t131_j('a4') -> 'avisos') a WHERE a ->> 'tipo' = 'jefes_retardo'),
  '131-07 el aviso a los jefes dice quién y cuánto; no lleva usuario de la persona');
INSERT INTO t131_ids VALUES ('a5', asistencia_generar_avisos(t131_ts('16:06')));
INSERT INTO t131_ids VALUES ('a6', asistencia_generar_avisos(t131_ts('17:01')));
SELECT t131_assert(t131_tipos(t131_j('a5')) = 'salida:13101' AND t131_tipos(t131_j('a6')) = 'jefes_sin_salida:13101',
  '131-08 salida sin marcar: a la persona a los 5 min y a los jefes a los 60 (quien nunca entró no recibe aviso de salida)');
-- Ventana: lo que tocó hace más de 30 minutos ya no se manda.
BEGIN; DELETE FROM asistencia_avisos WHERE empleado_id BETWEEN 13101 AND 13109; COMMIT;
INSERT INTO t131_ids VALUES ('v1', asistencia_generar_avisos(t131_ts('09:30')));
SELECT t131_assert(t131_tipos(t131_j('v1')) = '', '131-09 programador caído o función recién encendida: no se mandan avisos viejos');

\echo '── 131: configuración'
BEGIN; SET LOCAL ROLE authenticated; SELECT t131_actor(3);
SELECT t131_err($q$SELECT guardar_avisos_asistencia('{"activo":false}')$q$, '131-10 Empleado no cambia los avisos', '42501');
SELECT t131_err($q$SELECT avisos_asistencia()$q$, '131-11 Empleado no lee la configuración', '42501');
SELECT t131_err($q$SELECT asistencia_generar_avisos()$q$, '131-12 nadie genera avisos por API', '42501');
SELECT t131_assert((SELECT count(*) = 0 FROM asistencia_avisos) AND (SELECT count(*) = 0 FROM asistencia_avisos_config), '131-13 Empleado no lee avisos ni configuración por REST');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t131_actor(1);
SELECT t131_err($q$SELECT guardar_avisos_asistencia('{"empleado_antes_min":3}')$q$, '131-14 minutos fuera de rango: rechazado', '22023');
SELECT t131_err($q$SELECT guardar_avisos_asistencia('{"jefes":"todos"}')$q$, '131-15 destinatario desconocido: rechazado', '22023');
SELECT t131_err($q$UPDATE asistencia_avisos_config SET activo = false$q$, '131-16 Admin por REST: no escribe la configuración', '42501');
INSERT INTO t131_ids VALUES ('g1', guardar_avisos_asistencia('{"activo":true,"empleado_antes_min":"","empleado_tarde":true,"empleado_salida_min":5,"jefes_sin_marcar_min":null,"jefes_retardo":false,"jefes_sin_salida_min":60,"jefes":"dueno"}'));
INSERT INTO t131_ids VALUES ('g1b', guardar_avisos_asistencia('{"activo":true,"empleado_antes_min":"","empleado_tarde":true,"empleado_salida_min":5,"jefes_sin_marcar_min":null,"jefes_retardo":false,"jefes_sin_salida_min":60,"jefes":"dueno"}'));
INSERT INTO t131_ids VALUES ('lee', avisos_asistencia());
COMMIT;
SELECT t131_assert((SELECT (empleado_antes_min, jefes_sin_marcar_min, jefes_retardo, jefes, actualizado_por) IS NOT DISTINCT FROM (NULL, NULL, false, 'dueno', 'Admin T131') FROM asistencia_avisos_config)
  AND NOT (t131_j('g1') ->> 'sin_cambios')::boolean AND (t131_j('g1b') ->> 'sin_cambios')::boolean
  AND (SELECT count(*) = 1 FROM auditoria WHERE usuario = 'Admin T131' AND modulo = 'Asistencia' AND detalle LIKE 'Avisos de asistencia:%jefes admins → dueno%')
  AND t131_j('lee') -> 'config' ->> 'jefes' = 'dueno' AND jsonb_typeof(t131_j('lee') -> 'recientes') = 'array',
  '131-17 Admin guarda (vacío = apagado), queda en auditoría una vez, y lee la configuración');
INSERT INTO t131_ids VALUES ('c1', asistencia_generar_avisos(t131_ts('07:52', 1)));
INSERT INTO t131_ids VALUES ('c2', asistencia_generar_avisos(t131_ts('08:27', 1)));
SELECT t131_assert(t131_tipos(t131_j('c1')) = '' AND t131_tipos(t131_j('c2')) = 'entrada_tarde:13101,entrada_tarde:13102'
  AND t131_j('c2') -> 'jefes' @> '[13102]'::jsonb AND NOT t131_j('c2') -> 'jefes' @> '[13101]'::jsonb,
  '131-18 avisos apagados no se generan; "solo el Dueño" cambia a quién van los de jefes');
BEGIN; SET LOCAL ROLE authenticated; SELECT t131_actor(1);
SELECT guardar_avisos_asistencia('{"activo":false,"empleado_tarde":true,"jefes":"admins"}');
COMMIT;
INSERT INTO t131_ids VALUES ('off', asistencia_generar_avisos(t131_ts('08:12', 2)));
SELECT t131_assert(NOT (t131_j('off') ->> 'activo')::boolean AND jsonb_array_length(t131_j('off') -> 'avisos') = 0, '131-19 todo apagado: no se genera nada');
SELECT t131_assert(NOT EXISTS (SELECT 1 FROM asistencias WHERE empleado_id IN (13102, 13103)), '131-20 avisar no registra asistencias ni faltas');

BEGIN; SELECT t131_limpiar(); COMMIT;
SELECT t131_assert(to_regclass('public.t131_cfg') IS NULL AND to_regclass('public.t131_turnos_apartados') IS NULL
  AND NOT EXISTS (SELECT 1 FROM empleados WHERE id BETWEEN 13101 AND 13109) AND NOT EXISTS (SELECT 1 FROM asistencia_avisos WHERE empleado_id BETWEEN 13101 AND 13109),
  '131-21 limpieza: sin fixtures; la configuración vuelve a como estaba');
DROP FUNCTION t131_limpiar(), t131_ts(TIME, INTEGER), t131_assert(BOOLEAN, TEXT), t131_err(TEXT, TEXT, TEXT, TEXT), t131_actor(INTEGER), t131_tipos(JSONB), t131_j(TEXT);
\echo '── 131: TODAS LAS PRUEBAS OK'
