-- 116_asistencia_test.sql — WF-0 (rol Empleado, vínculo persona ↔ acceso) y
-- PD-01 (reloj checador geolocalizado). Los turnos de los casos en vivo se
-- arman relativos a la hora del servidor; los bordes de horario (tolerancia
-- exacta, turno nocturno, zona horaria del negocio) se prueban con instantes
-- fijos sobre las funciones internas. La carrera con dos conexiones corre en
-- el runner local.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t116_ids;
CREATE TABLE t116_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t116_ids TO PUBLIC;

CREATE OR REPLACE FUNCTION t116_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM asistencia_correcciones WHERE asistencia_id IN (SELECT id FROM asistencias WHERE empleado_id BETWEEN 11651 AND 11659);
  DELETE FROM asistencias WHERE empleado_id BETWEEN 11651 AND 11659;
  DELETE FROM asistencia_intentos WHERE empleado_id BETWEEN 11651 AND 11659;
  DELETE FROM turnos WHERE empleado_id BETWEEN 11651 AND 11659;
  DELETE FROM centros_trabajo WHERE nombre LIKE 'Planta T116%';
  DELETE FROM auditoria WHERE usuario LIKE '%116%' OR detalle LIKE '%T116%';
  DELETE FROM empleados WHERE id BETWEEN 11651 AND 11659;
  DELETE FROM usuarios WHERE id BETWEEN 11651 AND 11659;
  DELETE FROM auth.users WHERE id::text LIKE '11650000-%';
END $$;

BEGIN; SELECT t116_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11650000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t116' FROM generate_series(1, 7) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11651, 'Admin 116', 'u1@t116', 'Admin', 'Activo', '11650000-0000-0000-0000-000000000001'),
  (11652, 'Empleado A 116', 'u2@t116', 'Empleado', 'Activo', '11650000-0000-0000-0000-000000000002'),
  (11653, 'Empleado B 116', 'u3@t116', 'Empleado', 'Activo', '11650000-0000-0000-0000-000000000003'),
  (11654, 'Ventas 116', 'u4@t116', 'Ventas', 'Activo', '11650000-0000-0000-0000-000000000004'),
  (11655, 'Sin vinculo 116', 'u5@t116', 'Empleado', 'Activo', '11650000-0000-0000-0000-000000000005'),
  (11656, 'Chofer C 116', 'u6@t116', 'Chofer', 'Activo', '11650000-0000-0000-0000-000000000006'),
  (11657, 'Producción 116', 'u7@t116', 'Producción', 'Activo', '11650000-0000-0000-0000-000000000007');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES
  (11651, 'Empleado A T116', 'Producción', 'Planta', 300, '2026-01-01', 'Activo'),
  (11652, 'Empleado B T116', 'Producción', 'Planta', 300, '2026-01-01', 'Activo'),
  (11653, 'Chofer C T116', 'Chofer', 'Reparto', 300, '2026-01-01', 'Activo'),
  (11654, 'Nocturno D T116', 'Velador', 'Planta', 300, '2026-01-01', 'Activo'),
  (11655, 'Tarde E T116', 'Producción', 'Planta', 300, '2026-01-01', 'Activo');
COMMIT;

CREATE OR REPLACE FUNCTION t116_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t116_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t116_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11650000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t116_op(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT ('11600000-0000-0000-0000-0000000000' || p_k)::uuid $$;
-- Resultado del último contrato de la transacción (se lee tras RESET ROLE).
CREATE OR REPLACE FUNCTION t116_r() RETURNS JSONB LANGUAGE sql AS $$ SELECT current_setting('t116.r')::jsonb $$;
CREATE OR REPLACE FUNCTION t116_guardar(p_r JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('t116.r', p_r::text, true); $$;
-- Hora local del negocio (fin_zona_negocio(): Mazatlán hasta 121, Durango desde 122) truncada al minuto, desplazada p_min minutos.
CREATE OR REPLACE FUNCTION t116_hora(p_min INTEGER) RETURNS TIME LANGUAGE sql AS $$
  SELECT (date_trunc('minute', now() AT TIME ZONE fin_zona_negocio()) + make_interval(mins => p_min))::time $$;
GRANT EXECUTE ON FUNCTION t116_assert(BOOLEAN, TEXT), t116_err(TEXT, TEXT, TEXT, TEXT), t116_auth(INTEGER), t116_op(TEXT), t116_r(), t116_guardar(JSONB), t116_hora(INTEGER) TO PUBLIC;

-- Planta (Mazatlán) y puntos de prueba: dentro = el mismo punto; fuera = +0.01° de latitud (~1.1 km).

\echo '── 116: superficie'
SELECT t116_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname IN ('registrar_entrada', 'registrar_salida', 'mi_asistencia', 'asistencia_dia',
                         'corregir_asistencia', 'config_asistencia', 'guardar_centro_trabajo', 'guardar_turno', 'vincular_empleado_usuario',
                         'asistencia_turno_aplicable', 'asistencia_empleado_actual', 'asistencia_json')),
  '116-00a contratos SECURITY DEFINER, search_path fijo, sin anon/PUBLIC');
SELECT t116_assert((SELECT count(*) = 12 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname IN ('registrar_entrada', 'registrar_salida', 'mi_asistencia', 'asistencia_dia',
                         'corregir_asistencia', 'config_asistencia', 'guardar_centro_trabajo', 'guardar_turno', 'vincular_empleado_usuario',
                         'asistencia_turno_aplicable', 'asistencia_empleado_actual', 'asistencia_json')),
  '116-00b una sola definición por contrato');
SELECT t116_assert(NOT has_function_privilege('authenticated', 'public.asistencia_turno_aplicable(bigint,timestamptz)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.asistencia_json(asistencias)', 'EXECUTE'),
  '116-00c funciones internas sin EXECUTE para authenticated');
SELECT t116_assert((SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname IN ('centros_trabajo', 'turnos', 'asistencias', 'asistencia_intentos', 'asistencia_correcciones')),
  '116-00d RLS habilitado en las 5 tablas');
SELECT t116_assert((SELECT bool_and(NOT has_table_privilege(r, t, 'INSERT') AND NOT has_table_privilege(r, t, 'UPDATE') AND NOT has_table_privilege(r, t, 'DELETE'))
                    FROM unnest(ARRAY['centros_trabajo', 'turnos', 'asistencias', 'asistencia_intentos', 'asistencia_correcciones']) t,
                         unnest(ARRAY['anon', 'authenticated']) r)
               AND (SELECT bool_and(NOT has_table_privilege('anon', t, 'SELECT'))
                    FROM unnest(ARRAY['centros_trabajo', 'turnos', 'asistencias', 'asistencia_intentos', 'asistencia_correcciones']) t),
  '116-00e sin escritura directa (anon ni authenticated) y anon sin lectura');
SELECT t116_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'asistencia_intentos'
                                 AND column_name ~ '(lat|lng|lon)'),
  '116-00f los intentos rechazados no tienen columnas de coordenadas');
SELECT t116_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname IN ('registrar_entrada', 'registrar_salida', 'corregir_asistencia', 'asistencia_dia', 'mi_asistencia')
                                  AND pg_get_functiondef(p.oid) ~* '(nomina|recibo|percepcion)'),
  '116-00g la asistencia no toca nómina');

\echo '── CASO 1: WF-0 rol Empleado y vínculo 1 a 1'
SELECT t116_assert((SELECT rol FROM usuarios WHERE id = 11652) = 'Empleado', '116-01a el rol Empleado es válido');
SELECT t116_err($$UPDATE usuarios SET rol = 'Gerente' WHERE id = 11652$$, '116-01b un rol fuera de la lista se rechaza', '23514');
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(4);
SELECT t116_err('SELECT vincular_empleado_usuario(11651, 11652)', '116-01c Ventas no vincula empleados', '42501');
SELECT t116_auth(2);
SELECT t116_err('SELECT vincular_empleado_usuario(11651, 11652)', '116-01d Empleado no se vincula a sí mismo', '42501');
SELECT t116_auth(1);
SELECT vincular_empleado_usuario(11651, 11652);
SELECT vincular_empleado_usuario(11652, 11653);
SELECT vincular_empleado_usuario(11653, 11656);
SELECT t116_err('SELECT vincular_empleado_usuario(11654, 11652)', '116-01e un usuario no se liga a dos empleados', '23505');
COMMIT;
SELECT t116_assert((SELECT count(*) FROM empleados WHERE id BETWEEN 11651 AND 11653 AND usuario_id IS NOT NULL) = 3
               AND (SELECT count(*) FROM auditoria WHERE accion = 'Vincular' AND usuario = 'Admin 116') = 3,
  '116-01f Admin vincula A, B y C con auditoría');
SELECT t116_err($$UPDATE empleados SET usuario_id = 11652 WHERE id = 11654$$, '116-01g índice único: ni escribiendo directo se duplica el vínculo', '23505');

\echo '── CASO 2: configuración (solo Admin)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_err($$SELECT guardar_centro_trabajo(NULL, 'Planta T116 X', 23.2, -106.4, 100, 50, true)$$, '116-02a Empleado no configura centros', '42501');
SELECT t116_err('SELECT config_asistencia()', '116-02b Empleado no lee la configuración', '42501');
SELECT t116_auth(1);
SELECT t116_guardar(guardar_centro_trabajo(NULL, 'Planta T116', 23.2494, -106.4111, 100, 50, true));
RESET ROLE;
INSERT INTO t116_ids VALUES ('centro', t116_r() ->> 'id');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(1);
-- A: entró a las (ahora - 5 min), tolerancia 10 → a tiempo. B: (ahora - 30 min) → retardo.
SELECT t116_guardar(guardar_turno(NULL, 11651, (SELECT v::bigint FROM t116_ids WHERE k = 'centro'), ARRAY[1,2,3,4,5,6,7]::smallint[],
                                  t116_hora(-5), t116_hora(-5 + 480), 10, CURRENT_DATE - 3, NULL, true));
SELECT t116_guardar(guardar_turno(NULL, 11652, (SELECT v::bigint FROM t116_ids WHERE k = 'centro'), ARRAY[1,2,3,4,5,6,7]::smallint[],
                                  t116_hora(-30), t116_hora(-30 + 480), 10, CURRENT_DATE - 3, NULL, true));
SELECT t116_err(format('SELECT guardar_turno(NULL, 11651, %s, ARRAY[3]::smallint[], ''06:00'', ''14:00'', 0, CURRENT_DATE, NULL, true)',
                       (SELECT v FROM t116_ids WHERE k = 'centro')),
  '116-02c un segundo turno activo el mismo día se rechaza', '23505');
-- D: nocturno viernes 22:00–06:00; E: jueves 18:00–23:30 (fechas fijas de octubre 2026).
SELECT guardar_turno(NULL, 11654, (SELECT v::bigint FROM t116_ids WHERE k = 'centro'), ARRAY[5]::smallint[], '22:00', '06:00', 15, '2026-09-01', NULL, true);
SELECT guardar_turno(NULL, 11655, (SELECT v::bigint FROM t116_ids WHERE k = 'centro'), ARRAY[4]::smallint[], '18:00', '23:30', 15, '2026-09-01', NULL, true);
SELECT t116_guardar(config_asistencia());
RESET ROLE;
SELECT t116_assert(jsonb_array_length(t116_r() -> 'centros') >= 1 AND jsonb_array_length(t116_r() -> 'turnos') >= 4, '116-02d Admin crea centro y turnos y los lee');
COMMIT;
SELECT t116_assert((SELECT count(*) FROM auditoria WHERE modulo = 'Asistencia' AND usuario = 'Admin 116') = 5, '116-02e cada cambio de configuración queda auditado');

\echo '── CASO 3: sin vínculo / sin turno'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(5);
SELECT t116_guardar(registrar_entrada(t116_op('01'), 23.2494, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'sin_empleado', '116-03a usuario sin empleado ligado: sin_empleado (no marca)');
SET LOCAL ROLE authenticated; SELECT t116_auth(5);
SELECT t116_guardar(mi_asistencia());
RESET ROLE; SELECT t116_assert(t116_r() ->> 'estado' = 'sin_empleado', '116-03b mi_asistencia sin vínculo: sin_empleado');
SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(registrar_entrada(t116_op('02'), 23.2494, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'sin_turno', '116-03c empleado sin turno: sin_turno (configuración pendiente)');
SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(mi_asistencia());
RESET ROLE; SELECT t116_assert(t116_r() ->> 'estado' = 'sin_turno' AND t116_r() -> 'accion' = 'null'::jsonb, '116-03d mi_asistencia sin turno: sin botón');
COMMIT;
SELECT t116_assert((SELECT count(*) FROM asistencias WHERE empleado_id BETWEEN 11651 AND 11659) = 0
               AND (SELECT count(*) FROM asistencia_intentos WHERE empleado_id BETWEEN 11651 AND 11659) = 0, '116-03e nada se registró');

\echo '── CASO 4: precisión insuficiente y fuera de la geocerca (entrada)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('11'), 23.2494, -106.4111, 80));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'precision_insuficiente' AND (t116_r() ->> 'ok')::boolean = false,
  '116-04a precisión 80 m > 50 m: rechazada aunque el punto esté dentro');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('12'), 23.2594, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'fuera_de_rango' AND (t116_r() ->> 'distancia_m')::numeric BETWEEN 1100 AND 1125,
  '116-04b a ~1.1 km: fuera_de_rango con la distancia');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
-- 95 m del centro con precisión 40 m: dentro (distancia <= radio, precisión <= máximo).
SELECT t116_guardar(registrar_entrada(t116_op('13'), 23.2494 + 0.00095, -106.4111, 60));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'precision_insuficiente', '116-04c la precisión se exige ANTES de medir distancia');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
-- 120 m con precisión 40: la incertidumbre NO convierte un punto fuera en dentro.
SELECT t116_guardar(registrar_entrada(t116_op('14'), 23.2494 + 0.00108, -106.4111, 40));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'fuera_de_rango', '116-04d 120 m con precisión 40 m: fuera (no se resta la precisión)');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('12'), 23.2594, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'fuera_de_rango' AND (t116_r() ->> 'replay')::boolean, '116-04e reintento del mismo rechazo: replay, sin otro intento');
COMMIT;
SELECT t116_assert((SELECT count(*) FROM asistencias WHERE empleado_id = 11651) = 0, '116-04f ningún rechazo crea asistencia');
SELECT t116_assert((SELECT count(*) FROM asistencia_intentos WHERE empleado_id = 11651) = 4
               AND (SELECT bool_and(motivo IN ('fuera_de_rango', 'precision_insuficiente')) FROM asistencia_intentos WHERE empleado_id = 11651),
  '116-04g privacidad: 4 intentos con motivo, precisión y distancia (sin coordenadas)');

\echo '── CASO 5: entrada a tiempo, replay, duplicado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('21'), 23.2494 + 0.0005, -106.4111, 12));
RESET ROLE;
SELECT t116_assert((t116_r() ->> 'ok')::boolean AND t116_r() #>> '{asistencia,entrada_estado}' = 'a_tiempo'
               AND (t116_r() #>> '{asistencia,minutos_retardo}')::int = 0 AND (t116_r() #>> '{asistencia,entrada_distancia_m}')::numeric BETWEEN 50 AND 60,
  '116-05a dentro (~56 m), a tiempo (5 min después, tolerancia 10)');
COMMIT;
SELECT t116_assert((SELECT entrada_at = (SELECT created_at FROM asistencias WHERE empleado_id = 11651) AND fecha_laboral IS NOT NULL
                      AND entrada_lat IS NOT NULL AND usuario_id = 11652 FROM asistencias WHERE empleado_id = 11651),
  '116-05b hora del servidor; persona y usuario derivados de la sesión');
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('21'), 23.2494, -106.4111, 12));
RESET ROLE; SELECT t116_assert((t116_r() ->> 'ok')::boolean AND (t116_r() ->> 'replay')::boolean, '116-05c misma operación: replay (mismo resultado)');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('22'), 23.2494, -106.4111, 12));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'ya_registrada' AND NOT (t116_r() ->> 'ok')::boolean, '116-05d segunda entrada (otra operación): ya_registrada');
SET LOCAL ROLE authenticated; SELECT t116_auth(3);
SELECT t116_err($$SELECT registrar_entrada(t116_op('21'), 23.2494, -106.4111, 12)$$, '116-05e la operación de otra persona no se reutiliza', '23505');
COMMIT;
SELECT t116_assert((SELECT count(*) FROM asistencias WHERE empleado_id = 11651) = 1, '116-05f una sola asistencia de A');

\echo '── CASO 6: retardo y tolerancia exacta'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(3);
SELECT t116_guardar(registrar_entrada(t116_op('31'), 23.2494, -106.4111, 20));
RESET ROLE; SELECT t116_assert(t116_r() #>> '{asistencia,entrada_estado}' = 'retardo' AND (t116_r() #>> '{asistencia,minutos_retardo}')::int BETWEEN 30 AND 31,
  '116-06a B 30 min tarde (tolerancia 10): retardo de 30–31 min');
COMMIT;
SELECT t116_assert((SELECT estado || '|' || minutos_retardo FROM asistencia_clasificar_entrada('2026-10-07 07:00-07', 10, '2026-10-07 07:00-07')) = 'a_tiempo|0',
  '116-06b a la hora exacta: a tiempo');
SELECT t116_assert((SELECT estado || '|' || minutos_retardo FROM asistencia_clasificar_entrada('2026-10-07 07:00-07', 10, '2026-10-07 07:10:00-07')) = 'a_tiempo|0',
  '116-06c al último segundo de la tolerancia (07:10:00): a tiempo');
SELECT t116_assert((SELECT estado || '|' || minutos_retardo FROM asistencia_clasificar_entrada('2026-10-07 07:00-07', 10, '2026-10-07 07:10:01-07')) = 'retardo|11',
  '116-06d un segundo después: retardo de 11 min (contado desde la entrada programada)');
SELECT t116_assert((SELECT estado FROM asistencia_clasificar_entrada('2026-10-07 07:00-07', 0, '2026-10-07 07:00:01-07')) = 'retardo',
  '116-06e tolerancia 0: un segundo tarde ya es retardo');

\echo '── CASO 7: lectura cruzada y escritura directa'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(3);
SELECT t116_assert((SELECT count(*) FROM asistencias) = 1 AND (SELECT empleado_id FROM asistencias) = 11652, '116-07a B solo ve su asistencia (RLS)');
SELECT t116_assert((SELECT count(*) FROM asistencia_intentos) = 0 AND (SELECT count(*) FROM centros_trabajo) = 0
               AND (SELECT count(*) FROM asistencia_correcciones) = 0, '116-07b B no ve intentos, centros ni correcciones');
SELECT t116_assert((SELECT count(*) FROM turnos) = 1, '116-07c B solo ve su turno');
SELECT t116_err('SELECT asistencia_dia(CURRENT_DATE)', '116-07d Empleado no lee la asistencia de todos', '42501');
SELECT t116_err($$INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min, radio_m, precision_max_m,
                 entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m, entrada_estado, operacion_entrada)
                 SELECT 11652, 11653, id, centro_id, CURRENT_DATE, now(), now() + interval '8 hours', 0, 100, 50, now(), 0, 0, 1, 0, 'a_tiempo', gen_random_uuid() FROM turnos$$,
  '116-07e INSERT directo rechazado', '42501');
SELECT t116_err($$UPDATE asistencias SET entrada_estado = 'a_tiempo'$$, '116-07f UPDATE directo de la propia asistencia rechazado', '42501');
SELECT t116_err($$DELETE FROM asistencia_intentos$$, '116-07g DELETE directo rechazado', '42501');
SELECT t116_auth(4);
SELECT t116_assert((SELECT count(*) FROM asistencias) = 0 AND (SELECT count(*) FROM turnos) = 0, '116-07h Ventas no ve asistencias ni turnos ajenos');
SELECT t116_err('SELECT asistencia_dia(CURRENT_DATE)', '116-07i Ventas no lee asistencia_dia', '42501');
SELECT t116_auth(1);
SELECT t116_assert((SELECT count(*) FROM asistencias WHERE empleado_id IN (11651, 11652)) = 2
               AND (SELECT count(*) FROM asistencia_intentos WHERE empleado_id = 11651) = 4, '116-07j Admin lee todo');
SELECT t116_err($$UPDATE asistencias SET entrada_estado = 'a_tiempo' WHERE empleado_id = 11652$$, '116-07k ni Admin escribe directo', '42501');
SELECT t116_guardar(asistencia_dia(fin_hoy()));
RESET ROLE;
SELECT t116_assert((SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11651) = 'a_tiempo'
               AND (SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11652) = 'retardo'
               AND (SELECT (e ->> 'intentos')::int FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11651) = 4
               AND (SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11653) = 'sin_turno',
  '116-07l asistencia_dia (Admin): A a tiempo con 4 intentos, B retardo, C sin turno');
COMMIT;

\echo '── CASO 8: salida dentro, repetida, fuera con evidencia, sin entrada, sin precisión'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_salida(t116_op('41'), 23.2494, -106.4111, 200));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'precision_insuficiente', '116-08a salida con precisión 200 m: rechazada (sin coordenadas)');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_salida(t116_op('42'), 23.2494, -106.4111, 15));
RESET ROLE; SELECT t116_assert((t116_r() ->> 'ok')::boolean AND NOT (t116_r() ->> 'fuera_de_ubicacion')::boolean
                             AND (t116_r() #>> '{asistencia,minutos_trabajados}')::int >= 0, '116-08b salida dentro: registrada');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_salida(t116_op('42'), 23.2494, -106.4111, 15));
RESET ROLE; SELECT t116_assert((t116_r() ->> 'ok')::boolean AND (t116_r() ->> 'replay')::boolean, '116-08c misma salida: replay');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_salida(t116_op('43'), 23.2494, -106.4111, 15));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'ya_registrada', '116-08d segunda salida: ya_registrada');
SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('44'), 23.2494, -106.4111, 15));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'ya_registrada', '116-08e entrada tras la salida del mismo turno: ya_registrada');
SET LOCAL ROLE authenticated; SELECT t116_auth(3);
SELECT t116_guardar(registrar_salida(t116_op('45'), 23.2594, -106.4111, 25));
RESET ROLE; SELECT t116_assert((t116_r() ->> 'ok')::boolean AND (t116_r() ->> 'fuera_de_ubicacion')::boolean AND (t116_r() ->> 'distancia_m')::numeric > 1000,
  '116-08f salida FUERA de la geocerca: se acepta y se marca fuera de ubicación');
SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(registrar_salida(t116_op('46'), 23.2494, -106.4111, 15));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'sin_entrada', '116-08g salida sin entrada: sin_entrada');
COMMIT;
SELECT t116_assert((SELECT salida_dentro = false AND salida_lat = 23.2594 AND salida_distancia_m > 1000 AND salida_precision_m = 25
                      FROM asistencias WHERE empleado_id = 11652), '116-08h evidencia de la salida fuera: coordenadas, precisión, distancia y bandera');
SELECT t116_assert((SELECT salida_dentro AND operacion_salida = t116_op('42') FROM asistencias WHERE empleado_id = 11651)
               AND (SELECT count(*) FROM asistencia_intentos WHERE empleado_id = 11651 AND tipo = 'salida') = 1,
  '116-08i A: salida dentro registrada una vez; el rechazo de precisión quedó como intento');

\echo '── CASO 9: corrección de Admin (motivo, original intacto, historial, actor)'
INSERT INTO t116_ids SELECT 'asisA', id::text FROM asistencias WHERE empleado_id = 11651;
INSERT INTO t116_ids SELECT 'asisB', id::text FROM asistencias WHERE empleado_id = 11652;
INSERT INTO t116_ids SELECT 'origB', entrada_at::text FROM asistencias WHERE empleado_id = 11652;
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(4);
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'entrada', now() - interval '1 hour', 'Llegó antes, reloj falló')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09a Ventas no corrige', '42501');
SELECT t116_auth(3);
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'entrada', now() - interval '1 hour', 'Llegó antes, reloj falló')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09b el propio empleado no se corrige', '42501');
SELECT t116_auth(1);
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'entrada', now() - interval '1 hour', '  ')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09c sin motivo: rechazada', '22023', '%motivo%');
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'entrada', now() + interval '1 hour', 'Llegó antes, reloj falló')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09d hora futura: rechazada', '22023');
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'entrada', now(), 'Llegó antes, reloj falló')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09e entrada no anterior a la salida: rechazada', '22023');
SELECT t116_guardar(corregir_asistencia(t116_op('51'), (SELECT v::bigint FROM t116_ids WHERE k = 'asisB'), 'entrada',
                                        (SELECT entrada_programada FROM asistencias WHERE empleado_id = 11652), 'Llegó a tiempo; el teléfono no tenía señal'));
RESET ROLE;
SELECT t116_assert((t116_r() ->> 'ok')::boolean AND t116_r() #>> '{asistencia,entrada_estado}' = 'a_tiempo' AND (t116_r() #>> '{asistencia,corregida}')::boolean,
  '116-09f Admin corrige la entrada de B a la hora programada: a tiempo');
SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_guardar(corregir_asistencia(t116_op('51'), (SELECT v::bigint FROM t116_ids WHERE k = 'asisB'), 'entrada',
                                        (SELECT entrada_programada FROM asistencias WHERE empleado_id = 11652), 'Llegó a tiempo; el teléfono no tenía señal'));
RESET ROLE; SELECT t116_assert((t116_r() ->> 'replay')::boolean, '116-09g la misma corrección: replay (una sola fila de historial)');
SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_err(format($$SELECT corregir_asistencia(t116_op('51'), %s, 'salida', now() - interval '1 minute', 'Otra cosa distinta')$$, (SELECT v FROM t116_ids WHERE k = 'asisB')),
  '116-09h misma operación con otros datos: rechazada', '23505');
SELECT corregir_asistencia(t116_op('52'), (SELECT v::bigint FROM t116_ids WHERE k = 'asisB'), 'salida',
                           (SELECT entrada_programada + interval '8 hours' FROM asistencias WHERE empleado_id = 11652) - interval '8 hours' + interval '1 minute' * 1,
                           'Ajuste de prueba de salida');
COMMIT;
SELECT t116_assert((SELECT entrada_at::text = (SELECT v FROM t116_ids WHERE k = 'origB') AND entrada_corregida_at = entrada_programada
                           AND salida_at IS NOT NULL AND salida_corregida_at = entrada_programada + interval '1 minute' AND minutos_trabajados = 1
                      FROM asistencias WHERE empleado_id = 11652),
  '116-09i el valor original sigue intacto; el corregido va aparte; minutos recalculados');
SELECT t116_assert((SELECT count(*) FROM asistencia_correcciones WHERE asistencia_id = (SELECT v::bigint FROM t116_ids WHERE k = 'asisB')) = 2
               AND (SELECT valor_anterior::text = (SELECT v FROM t116_ids WHERE k = 'origB') AND actor = 'Admin 116' AND actor_id = 11651
                           AND motivo LIKE 'Llegó a tiempo%' AND created_at IS NOT NULL
                      FROM asistencia_correcciones WHERE operacion_id = t116_op('51'))
               AND (SELECT count(*) FROM auditoria WHERE accion = 'Corregir' AND usuario = 'Admin 116') = 2,
  '116-09j historial: valor anterior, nuevo, motivo, actor, hora del servidor; auditado');
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_err($$UPDATE asistencia_correcciones SET motivo = 'cambiado'$$, '116-09k historial inmutable (sin UPDATE)', '42501');
SELECT t116_err($$DELETE FROM asistencia_correcciones$$, '116-09l historial inmutable (sin DELETE)', '42501');
COMMIT;

\echo '── CASO 10: turno nocturno y bordes de zona horaria (instantes fijos)'
-- 2026-10-09 es viernes; los instantes se expresan en la zona del negocio (sin horario de verano).
SELECT t116_assert((SELECT count(*) FROM asistencia_turno_aplicable(11654, ('2026-10-09 20:59'::timestamp AT TIME ZONE fin_zona_negocio()))) = 0,
  '116-10a nocturno: 61 min antes de las 22:00 todavía no abre');
SELECT t116_assert((SELECT fecha_laboral = '2026-10-09' FROM asistencia_turno_aplicable(11654, ('2026-10-09 21:00'::timestamp AT TIME ZONE fin_zona_negocio()))),
  '116-10b nocturno: abre 60 min antes');
SELECT t116_assert((SELECT fecha_laboral = '2026-10-09' AND salida_programada = ('2026-10-10 06:00'::timestamp AT TIME ZONE fin_zona_negocio())
                      FROM asistencia_turno_aplicable(11654, ('2026-10-10 03:00'::timestamp AT TIME ZONE fin_zona_negocio()))),
  '116-10c nocturno: a las 03:00 del sábado el día laboral sigue siendo el viernes');
SELECT t116_assert((SELECT count(*) FROM asistencia_turno_aplicable(11654, ('2026-10-10 06:00'::timestamp AT TIME ZONE fin_zona_negocio()))) = 0,
  '116-10d nocturno: a la hora de salida ya no se puede marcar entrada');
SELECT t116_assert((SELECT count(*) FROM asistencia_turno_aplicable(11654, ('2026-10-08 23:00'::timestamp AT TIME ZONE fin_zona_negocio()))) = 0,
  '116-10e nocturno: el jueves no hay turno');
SELECT t116_assert((SELECT fecha_laboral = '2026-10-08' AND entrada_programada = ('2026-10-08 18:00'::timestamp AT TIME ZONE fin_zona_negocio())
                      FROM asistencia_turno_aplicable(11655, ('2026-10-08 22:00'::timestamp AT TIME ZONE fin_zona_negocio()))),
  '116-10f jueves 22:00 local (ya viernes en UTC): el día laboral es el jueves local');
SELECT t116_assert((SELECT count(*) FROM asistencia_turno_aplicable(11655, ('2026-10-08 06:30'::timestamp AT TIME ZONE fin_zona_negocio()))) = 0,
  '116-10g jueves 06:30 local: el turno de las 18:00 aún no abre');
BEGIN; SET LOCAL timezone = 'Europe/Madrid';
SELECT t116_assert((SELECT fecha_laboral = '2026-10-08' FROM asistencia_turno_aplicable(11655, ('2026-10-08 22:00'::timestamp AT TIME ZONE fin_zona_negocio()))),
  '116-10h el resultado no depende de la zona de la sesión');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_guardar(asistencia_dia('2026-10-01'));   -- jueves pasado, sin marcas
RESET ROLE;
SELECT t116_assert((SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11655) = 'falta'
               AND (SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11654) = 'sin_turno',
  '116-10i día pasado: E (turno jueves) falta; D (solo viernes) sin turno');
COMMIT;

\echo '── CASO 11: salida olvidada (más de 24 h)'
BEGIN; SET LOCAL session_replication_role = replica;
INSERT INTO turnos (empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde, activo)
  VALUES (11653, (SELECT v::bigint FROM t116_ids WHERE k = 'centro'), ARRAY[1,2,3,4,5,6,7]::smallint[], t116_hora(120), t116_hora(120 + 480), 5, CURRENT_DATE - 5, true);
INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min, radio_m, precision_max_m,
                         entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m, entrada_estado, operacion_entrada)
  SELECT 11653, 11656, t.id, t.centro_id, fin_hoy() - 2, now() - interval '50 hours', now() - interval '42 hours', 5, 100, 50,
         now() - interval '50 hours', 23.2494, -106.4111, 10, 0, 'a_tiempo', t116_op('61') FROM turnos t WHERE t.empleado_id = 11653;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(registrar_salida(t116_op('62'), 23.2494, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'sin_entrada', '116-11a entrada de hace 50 h: la salida no la cierra sola');
SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(mi_asistencia());
RESET ROLE; SELECT t116_assert(t116_r() -> 'salida_olvidada' IS NOT NULL AND t116_r() -> 'salida_olvidada' <> 'null'::jsonb
                             AND t116_r() ->> 'estado' = 'fuera_de_horario', '116-11b mi_asistencia avisa la salida olvidada; turno de hoy aún no abre');
SET LOCAL ROLE authenticated; SELECT t116_auth(6);
SELECT t116_guardar(registrar_entrada(t116_op('63'), 23.2494, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'fuera_de_horario', '116-11c entrada 2 h antes del turno: fuera_de_horario');
SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_guardar(asistencia_dia(fin_hoy() - 2));
RESET ROLE;
SELECT t116_assert((SELECT e ->> 'estado' FROM jsonb_array_elements(t116_r() -> 'empleados') e WHERE (e ->> 'empleado_id')::int = 11653) = 'sin_salida',
  '116-11d Admin ve "sin salida" en ese día');
COMMIT;

\echo '── CASO 12: mi_asistencia por persona'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_guardar(mi_asistencia());
RESET ROLE;
SELECT t116_assert(t116_r() ->> 'estado' = 'completa' AND t116_r() -> 'accion' = 'null'::jsonb AND (t116_r() #>> '{empleado,id}')::int = 11651
               AND t116_r() #>> '{turno_hoy,centro}' = 'Planta T116' AND t116_r() #>> '{asistencia,salida_at}' IS NOT NULL,
  '116-12a A: jornada completa, sin botón');
SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT t116_guardar(mi_asistencia());
RESET ROLE; SELECT t116_assert(t116_r() ->> 'estado' = 'sin_empleado', '116-12b Admin sin ficha de empleado: sin_empleado');
COMMIT;

\echo '── CASO 13: aislamiento del rol Empleado en la base'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(2);
SELECT t116_err($$SELECT registrar_produccion(gen_random_uuid(), 'X', 'Y', 'Z', 1, NULL)$$, '116-13a Empleado no registra producción', '42501');
SELECT t116_err($$SELECT registrar_preparacion_barra(gen_random_uuid(), 'HIB-50K', 'HIP-25K', 'Z', 1)$$, '116-13b Empleado no prepara barra', '42501');
SELECT t116_err($$SELECT abonar_cxc(1, 1, 'Efectivo', NULL)$$, '116-13c Empleado no cobra CxC', '42501|P0001|22023');
SELECT t116_err($$SELECT completar_venta_directa(gen_random_uuid(), 1, 'contado', 'Efectivo', '[]'::jsonb, NULL)$$, '116-13d Empleado no completa ventas', '42501|42883|P0001|22023');
SELECT t116_assert((SELECT count(*) FROM empleados) = 0 AND (SELECT count(*) FROM centros_trabajo) = 0, '116-13e Empleado no lee empleados ni centros');
SELECT t116_err($$INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus) VALUES ('X', 1, 'x', 'x', 1, 'Creada')$$, '116-13f Empleado no crea órdenes por REST', '42501');
COMMIT;

\echo '── CASO 14: vínculo y empleado inactivo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT vincular_empleado_usuario(11651, NULL);
SELECT t116_auth(2);
SELECT t116_guardar(registrar_entrada(t116_op('71'), 23.2494, -106.4111, 10));
RESET ROLE; SELECT t116_assert(t116_r() ->> 'codigo' = 'sin_empleado', '116-14a desvinculado: ya no marca');
SET LOCAL ROLE authenticated; SELECT t116_auth(1);
SELECT vincular_empleado_usuario(11651, 11652);
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE usuarios SET estatus = 'Inactivo' WHERE id = 11653; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t116_auth(3);
SELECT t116_err($$SELECT registrar_entrada(t116_op('72'), 23.2494, -106.4111, 10)$$, '116-14b usuario inactivo: sin sesión válida', '42501');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE usuarios SET estatus = 'Activo' WHERE id = 11653; COMMIT;

\echo '── 116: limpieza'
BEGIN; SELECT t116_limpiar(); COMMIT;
DROP TABLE t116_ids;
DROP FUNCTION t116_limpiar(); DROP FUNCTION t116_assert(BOOLEAN, TEXT); DROP FUNCTION t116_err(TEXT, TEXT, TEXT, TEXT); DROP FUNCTION t116_auth(INTEGER);
DROP FUNCTION t116_op(TEXT); DROP FUNCTION t116_r(); DROP FUNCTION t116_guardar(JSONB); DROP FUNCTION t116_hora(INTEGER);
\echo '116: OK'
