-- 118_calendario_operativo_test.sql — PD-02: calendario operativo.
-- Generación con fechas fijas (octubre 2026, febrero 2027/2028); estados y
-- terminaciones relativos a fin_hoy(). La carrera con dos conexiones corre en el runner.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t118_ids;
CREATE TABLE t118_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t118_ids TO PUBLIC;

CREATE OR REPLACE FUNCTION t118_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM actividad_ocurrencias WHERE actividad_id IN (SELECT id FROM actividades WHERE titulo LIKE 'T118%');
  DELETE FROM actividades WHERE titulo LIKE 'T118%';
  DELETE FROM auditoria WHERE modulo = 'Calendario' AND (detalle LIKE 'T118%' OR usuario LIKE '%118%');
  DELETE FROM camiones WHERE nombre = 'Camión T118';
  DELETE FROM costos_fijos WHERE nombre = 'Renta T118';
  DELETE FROM usuarios WHERE id BETWEEN 11851 AND 11859;
  DELETE FROM auth.users WHERE id::text LIKE '11850000-%';
END $$;

BEGIN; SELECT t118_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11850000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t118' FROM generate_series(1, 7) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11851, 'Admin 118', 'u1@t118', 'Admin', 'Activo', '11850000-0000-0000-0000-000000000001'),
  (11852, 'Producción 118', 'u2@t118', 'Producción', 'Activo', '11850000-0000-0000-0000-000000000002'),
  (11853, 'Ventas 118', 'u3@t118', 'Ventas', 'Activo', '11850000-0000-0000-0000-000000000003'),
  (11854, 'Empleado 118', 'u4@t118', 'Empleado', 'Activo', '11850000-0000-0000-0000-000000000004'),
  (11855, 'Otro empleado 118', 'u5@t118', 'Empleado', 'Activo', '11850000-0000-0000-0000-000000000005'),
  (11856, 'Producción dos 118', 'u6@t118', 'Producción', 'Activo', '11850000-0000-0000-0000-000000000006'),
  (11857, 'Se va 118', 'u7@t118', 'Chofer', 'Activo', '11850000-0000-0000-0000-000000000007');
INSERT INTO camiones (nombre) VALUES ('Camión T118');
INSERT INTO costos_fijos (nombre) VALUES ('Renta T118');
COMMIT;

CREATE OR REPLACE FUNCTION t118_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t118_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 100);
END $$;
CREATE OR REPLACE FUNCTION t118_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11850000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t118_op(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT ('11800000-0000-0000-0000-0000000000' || p_k)::uuid $$;
CREATE OR REPLACE FUNCTION t118_r() RETURNS JSONB LANGUAGE sql AS $$ SELECT current_setting('t118.r')::jsonb $$;
CREATE OR REPLACE FUNCTION t118_guardar(p_r JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('t118.r', p_r::text, true); $$;
CREATE OR REPLACE FUNCTION t118_id(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT v::bigint FROM t118_ids WHERE k = p_k $$;
-- Ocurrencias de una actividad (por serie) dentro de un resultado de calendario().
CREATE OR REPLACE FUNCTION t118_oc(p_cal JSONB, p_serie BIGINT) RETURNS SETOF JSONB LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_cal -> 'ocurrencias') e WHERE (e ->> 'serie_id')::bigint = p_serie ORDER BY e ->> 'periodo' $$;
CREATE OR REPLACE FUNCTION t118_ventanas(p_cal JSONB, p_serie BIGINT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg((e ->> 'ventana_inicio') || '..' || (e ->> 'ventana_fin'), ' ' ORDER BY e ->> 'periodo') FROM t118_oc(p_cal, p_serie) e $$;
GRANT EXECUTE ON FUNCTION t118_assert(BOOLEAN, TEXT), t118_err(TEXT, TEXT, TEXT, TEXT), t118_auth(INTEGER), t118_op(TEXT), t118_r(), t118_guardar(JSONB),
  t118_id(TEXT), t118_oc(JSONB, BIGINT), t118_ventanas(JSONB, BIGINT) TO PUBLIC;
-- Crear como Admin y guardar el id: t118_crear('clave', op, datos).
CREATE OR REPLACE FUNCTION t118_crear(p_k TEXT, p_op TEXT, p_datos JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  v := guardar_actividad(t118_op(p_op), NULL, p_datos);
  INSERT INTO t118_ids VALUES (p_k, v ->> 'id') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END $$;
GRANT EXECUTE ON FUNCTION t118_crear(TEXT, TEXT, JSONB) TO PUBLIC;

\echo '── 118: superficie'
SELECT t118_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname IN ('calendario', 'completar_ocurrencia', 'guardar_actividad', 'editar_ocurrencia',
                         'desactivar_actividad', 'actividad_visible', 'actividad_ocurrencia_json')),
  '118-00a contratos SECURITY DEFINER, search_path fijo, sin anon/PUBLIC');
SELECT t118_assert(NOT has_function_privilege('authenticated', 'public.actividad_ventanas(actividades,date,date)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.actividad_visible(actividades)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.actividades_guard()', 'EXECUTE'),
  '118-00b funciones internas y de disparador sin EXECUTE para authenticated');
SELECT t118_assert((SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.actividades'::regclass, 'public.actividad_ocurrencias'::regclass))
               AND NOT has_table_privilege('authenticated', 'actividades', 'INSERT') AND NOT has_table_privilege('authenticated', 'actividades', 'UPDATE')
               AND NOT has_table_privilege('authenticated', 'actividad_ocurrencias', 'INSERT') AND NOT has_table_privilege('authenticated', 'actividad_ocurrencias', 'UPDATE')
               AND NOT has_table_privilege('anon', 'actividades', 'SELECT'),
  '118-00c RLS habilitado; sin escritura directa; anon sin lectura');

\echo '── CASO 22: solo Admin crea, edita y desactiva'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_err($$SELECT guardar_actividad(t118_op('99'), NULL, '{"titulo":"T118 x","categoria":"otra","recurrencia":"unica","fecha_inicio":"2026-10-10","fecha_fin":"2026-10-10"}')$$,
  '118-22a Producción no crea actividades', '42501');
SELECT t118_auth(4);
SELECT t118_err($$SELECT guardar_actividad(t118_op('99'), NULL, '{"titulo":"T118 x","categoria":"otra","recurrencia":"unica","fecha_inicio":"2026-10-10","fecha_fin":"2026-10-10"}')$$,
  '118-22b Empleado no crea actividades', '42501');
SELECT t118_auth(1);
-- A1 única próxima (hoy+5..hoy+7), responsable Producción 118 (usuario).
SELECT t118_crear('A1', '01', jsonb_build_object('titulo', 'T118 Limpieza profunda', 'categoria', 'limpieza', 'recurrencia', 'unica',
  'fecha_inicio', fin_hoy() + 5, 'fecha_fin', fin_hoy() + 7, 'responsable_usuario_id', 11852, 'visibilidad', 'asignado'));
-- A2 semanal: la ventana de esta semana es hoy (mismo día ISO), responsable por ROL Producción.
SELECT t118_crear('A2', '02', jsonb_build_object('titulo', 'T118 Revisar cuartos', 'categoria', 'operativa', 'recurrencia', 'semanal',
  'dia_semana_inicio', EXTRACT(ISODOW FROM fin_hoy()), 'dia_semana_fin', EXTRACT(ISODOW FROM fin_hoy()), 'responsable_rol', 'Producción',
  'visibilidad', 'asignado', 'vigente_desde', fin_hoy() - 30));
-- A3 mensual 1 → 5: Mantenimiento Máquina 30.
SELECT t118_crear('A3', '03', jsonb_build_object('titulo', 'T118 Mantenimiento Máquina 30', 'categoria', 'mantenimiento', 'recurrencia', 'mensual',
  'dia_inicio', 1, 'dia_fin', 5, 'responsable_usuario_id', 11852, 'visibilidad', 'asignado', 'relacionado_tipo', 'maquina',
  'relacionado_ref', 'Máquina 30', 'vigente_desde', '2026-01-01'));
-- A4 anual 29 feb (año bisiesto).
SELECT t118_crear('A4', '04', jsonb_build_object('titulo', 'T118 Revisión anual', 'categoria', 'administrativa', 'recurrencia', 'anual',
  'mes', 2, 'dia_inicio', 29, 'dia_fin', 29, 'visibilidad', 'admin', 'vigente_desde', '2026-01-01'));
-- A5 mensual que cruza de mes: 28 → 3.
SELECT t118_crear('A5', '05', jsonb_build_object('titulo', 'T118 Inventario de cierre', 'categoria', 'operativa', 'recurrencia', 'mensual',
  'dia_inicio', 28, 'dia_fin', 3, 'responsable_usuario_id', 11852, 'visibilidad', 'asignado', 'vigente_desde', '2026-01-01'));
-- A6 mensual día 31 (mes corto).
SELECT t118_crear('A6', '06', jsonb_build_object('titulo', 'T118 Corte mensual', 'categoria', 'administrativa', 'recurrencia', 'mensual',
  'dia_inicio', 31, 'dia_fin', 31, 'visibilidad', 'admin', 'vigente_desde', '2026-01-01'));
-- A7 única vencida (hoy-10..hoy-5), responsable Producción 118.
SELECT t118_crear('A7', '07', jsonb_build_object('titulo', 'T118 Fumigación', 'categoria', 'limpieza', 'recurrencia', 'unica',
  'fecha_inicio', fin_hoy() - 10, 'fecha_fin', fin_hoy() - 5, 'responsable_usuario_id', 11852, 'visibilidad', 'asignado'));
-- A8 asignada a Producción 118 pero SOLO Admin la completa.
SELECT t118_crear('A8', '08', jsonb_build_object('titulo', 'T118 Verificación de báscula', 'categoria', 'operativa', 'recurrencia', 'unica',
  'fecha_inicio', fin_hoy(), 'fecha_fin', fin_hoy() + 1, 'responsable_usuario_id', 11852, 'visibilidad', 'asignado', 'asignado_puede_completar', false));
-- A9 pago: responsable Producción 118 pero visibilidad admin (sensible).
SELECT t118_crear('A9', '09', jsonb_build_object('titulo', 'T118 Pagar renta', 'categoria', 'pago', 'recurrencia', 'mensual',
  'dia_inicio', 1, 'dia_fin', 5, 'responsable_usuario_id', 11852, 'visibilidad', 'admin', 'relacionado_tipo', 'costo_fijo',
  'relacionado_ref', (SELECT id::text FROM costos_fijos WHERE nombre = 'Renta T118'), 'vigente_desde', '2026-01-01'));
-- A10 para el Empleado 118 (Mis actividades).
SELECT t118_crear('A10', '10', jsonb_build_object('titulo', 'T118 Lavar camión', 'categoria', 'limpieza', 'recurrencia', 'unica',
  'fecha_inicio', fin_hoy(), 'fecha_fin', fin_hoy() + 2, 'responsable_usuario_id', 11854, 'visibilidad', 'asignado',
  'relacionado_tipo', 'camion', 'relacionado_ref', (SELECT id::text FROM camiones WHERE nombre = 'Camión T118')));
-- A11 para el usuario que se dará de baja.
SELECT t118_crear('A11', '11', jsonb_build_object('titulo', 'T118 Revisar llantas', 'categoria', 'mantenimiento', 'recurrencia', 'unica',
  'fecha_inicio', fin_hoy(), 'fecha_fin', fin_hoy() + 3, 'responsable_usuario_id', 11857, 'visibilidad', 'asignado'));
SELECT t118_err($$SELECT guardar_actividad(t118_op('98'), NULL, jsonb_build_object('titulo','T118 y','categoria','otra','recurrencia','unica','fecha_inicio','2026-10-10','fecha_fin','2026-10-10','relacionado_tipo','maquina','relacionado_ref','Máquina 99'))$$,
  '118-22c relacionado inexistente: rechazado', '22023');
SELECT t118_err($$SELECT guardar_actividad(t118_op('98'), NULL, '{"titulo":"T118 y","categoria":"otra","recurrencia":"mensual","dia_inicio":1}')$$,
  '118-22d recurrencia incompleta: rechazada por la base', '23514');
SELECT t118_guardar(guardar_actividad(t118_op('01'), NULL, '{}'));
RESET ROLE;
SELECT t118_assert((t118_r() ->> 'replay')::boolean AND (t118_r() ->> 'id')::bigint = t118_id('A1'), '118-22e misma operación de alta: replay, sin duplicar');
COMMIT;
SELECT t118_assert((SELECT count(*) FROM actividades WHERE titulo LIKE 'T118%') = 11
               AND (SELECT bool_and(serie_id = id AND version = 1 AND activo) FROM actividades WHERE titulo LIKE 'T118%')
               AND (SELECT count(*) FROM auditoria WHERE modulo = 'Calendario' AND accion = 'Crear' AND usuario = 'Admin 118') = 11,
  '118-22f 11 actividades v1, auditadas');

\echo '── CASOS 1–5, 28–30: generación de ocurrencias (servidor, sin filas)'
SELECT t118_assert((SELECT count(*) FROM actividad_ocurrencias o JOIN actividades a ON a.id = o.actividad_id WHERE a.titulo LIKE 'T118%') = 0,
  '118-31a crear actividades no genera ocurrencias');
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario('2026-10-01', '2026-11-30'));
RESET ROLE;
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A3')) = '2026-10-01..2026-10-05 2026-11-01..2026-11-05', '118-03 mensual 1→5: octubre y noviembre, una por mes');
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A5')) = '2026-09-28..2026-10-03 2026-10-28..2026-11-03 2026-11-28..2026-12-03',
  '118-30a cruce de mes 28→3: cada ocurrencia pertenece al mes en que empieza');
SELECT t118_assert((SELECT e ->> 'periodo' FROM t118_oc(t118_r(), t118_id('A5')) e WHERE e ->> 'ventana_inicio' = '2026-10-28') = '2026-10-01',
  '118-30b 28 oct → 3 nov: periodo = octubre');
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A6')) = '2026-10-31..2026-10-31 2026-11-30..2026-11-30', '118-28a día 31 en noviembre → 30');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario('2026-11-02', '2026-11-02'));
RESET ROLE;
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A5')) = '2026-10-28..2026-11-03', '118-30c consultar solo el 2 nov trae la ocurrencia de octubre (una sola)');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario('2027-02-01', '2027-03-31'));
RESET ROLE;
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A6')) = '2027-02-28..2027-02-28 2027-03-31..2027-03-31', '118-28b día 31 en febrero 2027 → 28');
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A4')) = '2027-02-28..2027-02-28', '118-29a anual 29 feb en 2027 (no bisiesto) → 28 feb');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario('2028-01-01', '2028-12-31'));
RESET ROLE;
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A4')) = '2028-02-29..2028-02-29', '118-04 anual: una vez al año; 2028 bisiesto → 29 feb');
SELECT t118_assert((SELECT count(*) FROM t118_oc(t118_r(), t118_id('A3'))) = 12, '118-05a mensual: 12 ocurrencias en 2028');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario(fin_hoy() - 6, fin_hoy() + 21));
RESET ROLE;
SELECT t118_assert((SELECT count(*) FROM t118_oc(t118_r(), t118_id('A2'))) = 4, '118-02 semanal: 4 ocurrencias en 4 semanas (la de cada semana)');
SELECT t118_assert((SELECT count(*) FROM t118_oc(t118_r(), t118_id('A1'))) = 1 AND (SELECT count(*) FROM t118_oc(t118_r(), t118_id('A7'))) = 1,
  '118-01 única: una sola ocurrencia');
SELECT t118_assert(t118_r() ->> 'hoy' = fin_hoy()::text, '118-05b el día de hoy lo pone el servidor (fin_hoy, Mazatlán)');
COMMIT;
SELECT t118_assert((SELECT count(*) FROM actividad_ocurrencias o JOIN actividades a ON a.id = o.actividad_id WHERE a.titulo LIKE 'T118%') = 0,
  '118-31b leer 3 rangos (incluido 2028) no creó ninguna fila futura');

\echo '── CASOS 6–9: estados'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario(fin_hoy() - 30, fin_hoy() + 30));
RESET ROLE;
SELECT t118_assert((SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A1')) e) = 'proxima', '118-06 hoy < inicio: próxima');
SELECT t118_assert((SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A2')) e WHERE (e ->> 'ventana_inicio')::date = fin_hoy()) = 'pendiente', '118-07 inicio ≤ hoy ≤ fin: pendiente');
SELECT t118_assert((SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A7')) e) = 'vencida', '118-08 hoy > fin sin completar: vencida');
SELECT t118_assert(actividad_estado('2026-10-01', '2026-10-05', true, '2026-12-01') = 'completada'
               AND actividad_estado('2026-10-01', '2026-10-05', false, '2026-10-05') = 'pendiente'
               AND actividad_estado('2026-10-01', '2026-10-05', false, '2026-10-06') = 'vencida'
               AND actividad_estado('2026-10-01', '2026-10-05', false, '2026-09-30') = 'proxima',
  '118-09a bordes del estado (fin inclusive) y completada');
COMMIT;

\echo '── CASOS 10–16, 23–24: completar'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(3);
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''21''), %s, %L)', t118_id('A1'), fin_hoy() + 5), '118-24a Ventas (sin relación) no completa', '42501');
SELECT t118_auth(5);
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''21''), %s, %L)', t118_id('A10'), fin_hoy()), '118-24b otro Empleado no completa la actividad ajena', '42501');
SELECT t118_auth(2);
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''21''), %s, %L)', t118_id('A8'), fin_hoy()), '118-23a asignado sin permiso de completar: rechazado', '42501', '%solo la completa Admin%');
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''21''), %s, %L)', t118_id('A9'), '2026-10-01'), '118-25a actividad solo-Admin: el responsable no la completa', '42501');
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''21''), %s, %L)', t118_id('A1'), fin_hoy() + 6), '118-05c un periodo que no corresponde se rechaza', '22023');
-- Anticipada (A1 empieza en 5 días).
SELECT t118_guardar(completar_ocurrencia(t118_op('21'), t118_id('A1'), fin_hoy() + 5, 'Se adelantó por visita'));
RESET ROLE;
SELECT t118_assert((t118_r() ->> 'ok')::boolean AND t118_r() #>> '{ocurrencia,estado}' = 'completada' AND t118_r() #>> '{ocurrencia,clasificacion}' = 'anticipada',
  '118-10 completada antes de la ventana: completada + anticipada');
SELECT t118_assert(t118_r() #>> '{ocurrencia,completada_por}' = 'Producción 118' AND (t118_r() #>> '{ocurrencia,completada_fecha}')::date = fin_hoy()
               AND t118_r() #>> '{ocurrencia,notas}' = 'Se adelantó por visita' AND t118_r() #>> '{ocurrencia,completada_at}' IS NOT NULL,
  '118-13 evidencia: quién, cuándo (servidor), fecha de negocio y notas');
SET LOCAL ROLE authenticated; SELECT t118_auth(6);
-- En ventana (A2 de esta semana) por otro usuario del rol Producción.
SELECT t118_guardar(completar_ocurrencia(t118_op('22'), t118_id('A2'), date_trunc('week', fin_hoy())::date, NULL));
RESET ROLE;
SELECT t118_assert(t118_r() #>> '{ocurrencia,clasificacion}' = 'en_ventana' AND t118_r() #>> '{ocurrencia,completada_por}' = 'Producción dos 118',
  '118-11 + 118-23b dentro de la ventana: en_ventana; responsable por rol completa');
SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_guardar(completar_ocurrencia(t118_op('23'), t118_id('A7'), fin_hoy() - 10, 'Tarde por lluvia'));
RESET ROLE;
SELECT t118_assert(t118_r() #>> '{ocurrencia,estado}' = 'completada' AND t118_r() #>> '{ocurrencia,clasificacion}' = 'tardia',
  '118-12 completada después del fin: completada (verde) pero tardía');
SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_guardar(completar_ocurrencia(t118_op('23'), t118_id('A7'), fin_hoy() - 10, 'Tarde por lluvia'));
RESET ROLE; SELECT t118_assert((t118_r() ->> 'ok')::boolean AND (t118_r() ->> 'replay')::boolean, '118-14a misma operación: replay');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(completar_ocurrencia(t118_op('24'), t118_id('A7'), fin_hoy() - 10, 'otra vez'));
RESET ROLE;
SELECT t118_assert(t118_r() ->> 'codigo' = 'ya_completada' AND NOT (t118_r() ->> 'ok')::boolean AND t118_r() #>> '{ocurrencia,completada_por}' = 'Producción 118',
  '118-14b segunda terminación (otra operación, aun de Admin): ya_completada con los datos originales');
SET LOCAL ROLE authenticated; SELECT t118_auth(3);
SELECT t118_err(format('SELECT completar_ocurrencia(t118_op(''23''), %s, %L)', t118_id('A7'), fin_hoy() - 10), '118-14c la operación de otro usuario no se reutiliza', '23505|42501');
SELECT t118_auth(4);
SELECT t118_guardar(completar_ocurrencia(t118_op('25'), t118_id('A10'), fin_hoy(), 'Listo'));
RESET ROLE; SELECT t118_assert((t118_r() ->> 'ok')::boolean, '118-23c el Empleado completa SU actividad');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
-- Octubre 2026 de A3 (Admin), y noviembre sigue abierto.
SELECT completar_ocurrencia(t118_op('26'), t118_id('A3'), '2026-10-01', 'Cambio de filtros');
SELECT t118_guardar(calendario('2026-10-01', '2026-11-30'));
RESET ROLE;
SELECT t118_assert((SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A3')) e WHERE e ->> 'periodo' = '2026-10-01') = 'completada'
               AND (SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A3')) e WHERE e ->> 'periodo' = '2026-11-01') <> 'completada',
  '118-16 completar octubre no afecta noviembre');
COMMIT;
SELECT t118_assert((SELECT count(*) FROM actividad_ocurrencias o JOIN actividades a ON a.id = o.actividad_id WHERE a.titulo LIKE 'T118%') = 5
               AND (SELECT count(*) FROM auditoria WHERE modulo = 'Calendario' AND accion = 'Completar' AND detalle LIKE 'T118%') = 5,
  '118-14d una fila por ocurrencia completada (5), auditada');

\echo '── CASO 17: historia inmutable'
SELECT t118_err(format('UPDATE actividad_ocurrencias SET notas = ''x'' WHERE actividad_id = %s', t118_id('A7')), '118-17a ni el superusuario cambia una completada (trigger)', '42501', '%inmutable%');
SELECT t118_err(format('DELETE FROM actividad_ocurrencias WHERE actividad_id = %s', t118_id('A7')), '118-17b la historia no se borra', '42501');
SELECT t118_err(format('UPDATE actividades SET titulo = ''T118 otro'' WHERE id = %s', t118_id('A3')), '118-17c la definición de una versión no se modifica', '42501');
SELECT t118_err(format('DELETE FROM actividades WHERE id = %s', t118_id('A3')), '118-17d una actividad no se borra', '42501');

\echo '── CASO 18: editar SOLO esta ocurrencia'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_err(format('SELECT editar_ocurrencia(t118_op(''31''), %s, ''2026-11-01'', ''2026-11-10'', ''2026-11-12'', ''Máquina en reparación'')', t118_id('A3')),
  '118-18a solo Admin edita una ocurrencia', '42501');
SELECT t118_auth(1);
SELECT t118_err(format('SELECT editar_ocurrencia(t118_op(''31''), %s, ''2026-10-01'', ''2026-10-10'', ''2026-10-12'', ''Ya se hizo antes'')', t118_id('A3')),
  '118-18b una ocurrencia completada no se edita', '22023', '%completada%');
SELECT t118_err(format('SELECT editar_ocurrencia(t118_op(''31''), %s, ''2026-11-01'', ''2026-11-10'', ''2026-11-12'', '' '')', t118_id('A3')), '118-18c motivo obligatorio', '22023');
SELECT editar_ocurrencia(t118_op('31'), t118_id('A3'), '2026-11-01', '2026-11-10', '2026-11-12', 'Máquina en reparación');
SELECT t118_guardar(calendario('2026-10-01', '2026-12-31'));
RESET ROLE;
SELECT t118_assert(t118_ventanas(t118_r(), t118_id('A3')) = '2026-10-01..2026-10-05 2026-11-10..2026-11-12 2026-12-01..2026-12-05'
               AND (SELECT (e ->> 'editada')::boolean AND e ->> 'ventana_inicio_original' = '2026-11-01' AND e ->> 'motivo_edicion' = 'Máquina en reparación'
                      FROM t118_oc(t118_r(), t118_id('A3')) e WHERE e ->> 'periodo' = '2026-11-01'),
  '118-18d solo noviembre cambia; queda la ventana original y el motivo; diciembre intacto');
COMMIT;

\echo '── CASO 19: editar las futuras (versión nueva; la historia no cambia)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(guardar_actividad(t118_op('41'), t118_id('A3'), jsonb_build_object('titulo', 'T118 Mantenimiento Máquina 30 (nuevo)',
  'categoria', 'mantenimiento', 'recurrencia', 'mensual', 'dia_inicio', 10, 'dia_fin', 12, 'responsable_usuario_id', 11852,
  'visibilidad', 'asignado', 'relacionado_tipo', 'maquina', 'relacionado_ref', 'Máquina 30')));
RESET ROLE;
INSERT INTO t118_ids VALUES ('A3v2', t118_r() ->> 'id');
SELECT t118_assert((t118_r() ->> 'version')::int = 2 AND (t118_r() ->> 'serie_id')::bigint = t118_id('A3')
               AND (t118_r() ->> 'vigente_desde')::date = (date_trunc('month', fin_hoy()) + interval '1 month')::date,
  '118-19a versión 2 de la misma serie, vigente desde el mes siguiente (este mes ya empezó con la versión 1)');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_err(format('SELECT guardar_actividad(t118_op(''42''), %s, ''{"titulo":"T118 z","categoria":"otra","recurrencia":"mensual","dia_inicio":1,"dia_fin":2}'')', t118_id('A3')),
  '118-19b la versión cerrada ya no se edita', '22023', '%ya no está vigente%');
SELECT t118_guardar(calendario('2026-10-01', (fin_hoy() + 70)));
RESET ROLE;
SELECT t118_assert((SELECT e ->> 'titulo' = 'T118 Mantenimiento Máquina 30' AND (e ->> 'version')::int = 1 AND e ->> 'estado' = 'completada'
                      FROM t118_oc(t118_r(), t118_id('A3')) e WHERE e ->> 'periodo' = '2026-10-01')
               AND (SELECT count(*) FROM t118_oc(t118_r(), t118_id('A3')) e GROUP BY e ->> 'periodo' ORDER BY 1 DESC LIMIT 1) = 1,
  '118-19c la ocurrencia completada de octubre sigue siendo de la versión 1, intacta; una sola ocurrencia por periodo');
SELECT t118_assert((SELECT bool_and((e ->> 'periodo')::date > fin_hoy() AND extract(day FROM (e ->> 'ventana_inicio')::date) = 10)
                      FROM t118_oc(t118_r(), t118_id('A3')) e WHERE (e ->> 'version')::int = 2)
               AND (SELECT bool_and((e ->> 'periodo')::date <= fin_hoy()) FROM t118_oc(t118_r(), t118_id('A3')) e WHERE (e ->> 'version')::int = 1)
               AND (SELECT count(*) FROM t118_oc(t118_r(), t118_id('A3')) e WHERE (e ->> 'version')::int = 2) >= 2,
  '118-19d los periodos siguientes son versión 2 (días 10–12); los ya iniciados, versión 1');
COMMIT;
SELECT t118_assert((SELECT NOT activo AND vigente_hasta = date_trunc('month', fin_hoy())::date AND motivo_cierre LIKE 'reemplazada%' FROM actividades WHERE id = t118_id('A3'))
               AND (SELECT reemplaza_id = t118_id('A3') FROM actividades WHERE id = t118_id('A3v2')),
  '118-19e la versión 1 queda cerrada (no borrada) y la 2 la reemplaza');

\echo '── CASO 20: desactivar'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_err(format('SELECT desactivar_actividad(%s, ''Ya no aplica'')', t118_id('A2')), '118-20a solo Admin desactiva', '42501');
SELECT t118_auth(1);
SELECT t118_err(format('SELECT desactivar_actividad(%s, '''')', t118_id('A2')), '118-20b motivo obligatorio', '22023');
SELECT desactivar_actividad(t118_id('A2'), 'Ya no se revisan cada semana');
SELECT t118_guardar(desactivar_actividad(t118_id('A2'), 'Ya no se revisan cada semana'));
RESET ROLE; SELECT t118_assert((t118_r() ->> 'replay')::boolean, '118-20c desactivar de nuevo: replay');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario(fin_hoy() - 6, fin_hoy() + 30));
RESET ROLE;
SELECT t118_assert((SELECT count(*) FROM t118_oc(t118_r(), t118_id('A2')) e WHERE (e ->> 'ventana_inicio')::date > fin_hoy()) = 0
               AND (SELECT e ->> 'estado' FROM t118_oc(t118_r(), t118_id('A2')) e WHERE (e ->> 'ventana_inicio')::date = fin_hoy()) = 'completada',
  '118-20d sin ocurrencias futuras; la de esta semana (completada) se conserva');
COMMIT;

\echo '── CASO 21: responsable inactivo'
BEGIN; SET LOCAL session_replication_role = replica; UPDATE usuarios SET estatus = 'Inactivo' WHERE id = 11857; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario(fin_hoy(), fin_hoy() + 3));
RESET ROLE;
SELECT t118_assert((SELECT NOT (e ->> 'responsable_activo')::boolean AND e ->> 'responsable_nombre' = 'Se va 118' FROM t118_oc(t118_r(), t118_id('A11')) e),
  '118-21a Admin la ve marcada "sin responsable activo"');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_err($$SELECT guardar_actividad(t118_op('51'), NULL, '{"titulo":"T118 w","categoria":"otra","recurrencia":"unica","fecha_inicio":"2026-12-01","fecha_fin":"2026-12-01","responsable_usuario_id":11857}')$$,
  '118-21b no se asigna a un usuario inactivo', '22023');
SELECT t118_auth(7);
SELECT t118_err('SELECT calendario(CURRENT_DATE, CURRENT_DATE + 3)', '118-21c el usuario inactivo no lee el calendario', '42501');
COMMIT;

\echo '── CASOS 25–26: visibilidad y aislamiento por API (RLS)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(2);
SELECT t118_guardar(calendario('2026-01-01', fin_hoy() + 30));
SELECT t118_assert((SELECT count(*) FROM actividades WHERE titulo LIKE 'T118%' AND visibilidad = 'admin') = 0
               AND (SELECT count(*) FROM actividades WHERE id = t118_id('A9')) = 0,
  '118-25b el responsable de una actividad solo-Admin no la lee por API');
SELECT t118_assert((SELECT count(*) FROM actividades WHERE titulo LIKE 'T118%') = 7, '118-26a Producción 118 lee por API solo lo suyo y lo de su rol (7 versiones)');
SELECT t118_assert((SELECT count(*) FROM actividad_ocurrencias o WHERE o.actividad_id IN (t118_id('A10'), t118_id('A9'))) = 0,
  '118-26b ocurrencias ajenas o solo-Admin: invisibles por API');
SELECT t118_err($$INSERT INTO actividad_ocurrencias (actividad_id, periodo, ventana_inicio_original, ventana_fin_original, ventana_inicio, ventana_fin) VALUES (1, '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01')$$,
  '118-26c INSERT directo rechazado', '42501');
SELECT t118_err(format('UPDATE actividades SET activo = false WHERE id = %s', t118_id('A1')), '118-26d UPDATE directo rechazado', '42501');
RESET ROLE;
SELECT t118_assert(NOT (t118_r() -> 'ocurrencias') @> jsonb_build_array(jsonb_build_object('actividad_id', t118_id('A9')))
               AND NOT (t118_r() -> 'ocurrencias') @> jsonb_build_array(jsonb_build_object('actividad_id', t118_id('A4')))
               AND (t118_r() -> 'ocurrencias') @> jsonb_build_array(jsonb_build_object('actividad_id', t118_id('A1'))),
  '118-25c calendario() del responsable: sin pagos ni actividades solo-Admin; sí las suyas');
SET LOCAL ROLE authenticated; SELECT t118_auth(4);
SELECT t118_guardar(calendario('2026-01-01', fin_hoy() + 30, true));
SELECT t118_assert((SELECT count(*) FROM actividades) = 1 AND (SELECT id FROM actividades) = t118_id('A10'), '118-26e Empleado: solo SU actividad por API');
RESET ROLE;
SELECT t118_assert(jsonb_array_length(t118_r() -> 'ocurrencias') = 1 AND t118_r() #>> '{ocurrencias,0,titulo}' = 'T118 Lavar camión'
               AND t118_r() #>> '{ocurrencias,0,relacionado_etiqueta}' = 'Camión T118' AND NOT (t118_r() ->> 'es_admin')::boolean,
  '118-26f Mis actividades del Empleado: solo la suya (con su camión)');
SET LOCAL ROLE authenticated; SELECT t118_auth(5);
SELECT t118_assert((SELECT count(*) FROM actividades) = 0 AND (SELECT count(*) FROM actividad_ocurrencias) = 0, '118-26g otro Empleado: nada');
SELECT t118_guardar(calendario('2026-01-01', fin_hoy() + 30));
RESET ROLE; SELECT t118_assert(jsonb_array_length(t118_r() -> 'ocurrencias') = 0, '118-26h calendario() del otro Empleado: vacío');
SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_assert((SELECT count(*) FROM actividades WHERE titulo LIKE 'T118%') = 12, '118-25d Admin lee todo (12 versiones)');
SELECT t118_guardar(calendario('2026-01-01', fin_hoy() + 30, true));
RESET ROLE; SELECT t118_assert(jsonb_array_length(t118_r() -> 'ocurrencias') = 0, '118-26i "Mis actividades" de Admin: solo lo asignado a Admin (nada)');
COMMIT;

\echo '── CASO 27: zona horaria'
BEGIN; SET LOCAL timezone = 'Asia/Tokyo'; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT t118_guardar(calendario(fin_hoy(), fin_hoy()));
RESET ROLE;
SELECT t118_assert((t118_r() ->> 'hoy')::date = (now() AT TIME ZONE fin_zona_negocio())::date, '118-27a "hoy" es el de la zona del negocio aunque la sesión esté en Tokio');
SELECT t118_assert((SELECT bool_and(completada_fecha = (completada_at AT TIME ZONE fin_zona_negocio())::date) FROM actividad_ocurrencias o
                     JOIN actividades a ON a.id = o.actividad_id WHERE a.titulo LIKE 'T118%' AND completada_at IS NOT NULL),
  '118-27b la fecha de terminación es la de negocio');
SELECT t118_assert(actividad_clasificacion('2026-10-01', '2026-10-05', '2026-09-30') = 'anticipada' AND actividad_clasificacion('2026-10-01', '2026-10-05', '2026-10-01') = 'en_ventana'
               AND actividad_clasificacion('2026-10-01', '2026-10-05', '2026-10-05') = 'en_ventana' AND actividad_clasificacion('2026-10-01', '2026-10-05', '2026-10-06') = 'tardia',
  '118-27c bordes de la clasificación (inicio y fin inclusive)');
COMMIT;

\echo '── CASO 31: leer no escribe'
INSERT INTO t118_ids SELECT 'filas', count(*)::text FROM actividad_ocurrencias;
BEGIN; SET LOCAL ROLE authenticated; SELECT t118_auth(1);
SELECT calendario(fin_hoy() - 1000, fin_hoy() + 100) IS NOT NULL;
SELECT t118_err('SELECT calendario(CURRENT_DATE, CURRENT_DATE + 1200)', '118-31c rango máximo', '22023');
COMMIT;
SELECT t118_assert((SELECT count(*) FROM actividad_ocurrencias) = t118_id('filas'), '118-31d calendario de 1,100 días: 0 filas nuevas');

\echo '── 118: limpieza'
BEGIN; SELECT t118_limpiar(); COMMIT;
DROP TABLE t118_ids;
DROP FUNCTION t118_crear(TEXT, TEXT, JSONB); DROP FUNCTION t118_limpiar(); DROP FUNCTION t118_assert(BOOLEAN, TEXT); DROP FUNCTION t118_err(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION t118_auth(INTEGER); DROP FUNCTION t118_op(TEXT); DROP FUNCTION t118_r(); DROP FUNCTION t118_guardar(JSONB); DROP FUNCTION t118_id(TEXT);
DROP FUNCTION t118_oc(JSONB, BIGINT); DROP FUNCTION t118_ventanas(JSONB, BIGINT);
\echo '118: OK'
