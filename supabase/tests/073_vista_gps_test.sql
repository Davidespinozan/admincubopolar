-- 073_vista_gps_test.sql — Contención B2-V: la vista chofer_ubicacion_actual
-- ya no expone GPS a anon y respeta el RLS de chofer_ubicaciones.
-- Actores: anon · JWT sin perfil · Ventas · Chofer A · Chofer B · Admin.
-- El runner corre este archivo DESPUÉS de verificar que, antes de 073, anon
-- sí leía la vista (detector del hueco).

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7301 AND 7399;
DELETE FROM rutas WHERE id BETWEEN 7301 AND 7399;
DELETE FROM usuarios WHERE id BETWEEN 7301 AND 7309;
DELETE FROM auth.users WHERE id::text LIKE '73000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('73000000-0000-0000-0000-000000000001', 'admin73@t'),
  ('73000000-0000-0000-0000-000000000002', 'ventas73@t'),
  ('73000000-0000-0000-0000-000000000003', 'chofera73@t'),
  ('73000000-0000-0000-0000-000000000004', 'choferb73@t'),
  ('73000000-0000-0000-0000-000000000099', 'noprof73@evil');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7301, 'Admin 73',   'admin73@t',   'Admin',  'Activo', '73000000-0000-0000-0000-000000000001'),
  (7302, 'Ventas 73',  'ventas73@t',  'Ventas', 'Activo', '73000000-0000-0000-0000-000000000002'),
  (7303, 'Chofer A73', 'chofera73@t', 'Chofer', 'Activo', '73000000-0000-0000-0000-000000000003'),
  (7304, 'Chofer B73', 'choferb73@t', 'Chofer', 'Activo', '73000000-0000-0000-0000-000000000004');
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus) VALUES
  (7301, 'R-7301', 'Ruta A73', 7303, 'Chofer A73', 'En progreso'),
  (7302, 'R-7302', 'Ruta B73', 7304, 'Chofer B73', 'En progreso');
INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud, precision_m, created_at) VALUES
  (7301, 7303, 20.60, -103.30, 5, now() - interval '2 minutes'),
  (7301, 7303, 20.61, -103.31, 5, now()),
  (7302, 7304, 20.70, -103.40, 5, now());
COMMIT;

-- Claims tipo PostgREST (role + email + sub).
CREATE OR REPLACE FUNCTION t73_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    (jsonb_build_object('role', p_role)
     || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
     || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t73_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
      RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t73_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (no hubo error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 70);
END $$;
CREATE OR REPLACE FUNCTION t73_n(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;

\echo '── 073: estado físico'
SELECT t73_assert((SELECT reloptions::text ~ 'security_invoker=true' FROM pg_class WHERE oid = 'public.chofer_ubicacion_actual'::regclass), '073-01 security_invoker=true en la vista');
SELECT t73_assert(NOT has_table_privilege('anon', 'public.chofer_ubicacion_actual', 'SELECT') AND NOT has_table_privilege('anon', 'public.chofer_ubicacion_actual', 'INSERT'), '073-02 anon sin privilegios sobre la vista');
SELECT t73_assert(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'chofer_ubicacion_actual' AND grantee IN ('anon', 'PUBLIC')), '073-03 anon/PUBLIC sin grants en la vista');
SELECT t73_assert((SELECT count(*) = 1 AND bool_and(privilege_type = 'SELECT') FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'chofer_ubicacion_actual' AND grantee = 'authenticated'), '073-04 authenticated solo SELECT en la vista');
SELECT t73_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chofer_ubicaciones'::regclass), '073-05 RLS físico sigue en la tabla base');
SELECT t73_assert((SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chofer_ubicaciones' AND policyname IN ('admin_all', 'admin_or_self_read', 'chofer_insert_own')), '073-06 policies de la tabla base sin cambios');
SELECT t73_assert((SELECT relowner FROM pg_class WHERE oid = 'public.chofer_ubicacion_actual'::regclass) = (SELECT relowner FROM pg_class WHERE oid = 'public.chofer_ubicaciones'::regclass), '073-07 dueño de la vista = dueño de la tabla base (sin cambio de ownership)');

\echo '── 073: visibilidad por actor'
BEGIN; SET LOCAL ROLE anon; SELECT t73_actor('anon', NULL, NULL);
SELECT t73_err('SELECT count(*) FROM chofer_ubicacion_actual', '073-10 anon: la vista ya no es legible', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t73_actor('authenticated', 'noprof73@evil', '73000000-0000-0000-0000-000000000099');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399') = 0, '073-11 JWT sin perfil: 0 filas');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t73_actor('authenticated', 'ventas73@t', '73000000-0000-0000-0000-000000000002');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399') = 0, '073-12 Ventas: 0 filas');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t73_actor('authenticated', 'chofera73@t', '73000000-0000-0000-0000-000000000003');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399') = 1
  AND t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399 AND chofer_id <> 7303') = 0, '073-13 Chofer A: solo su última ubicación (misma regla que la tabla base)');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399')
  = t73_n('SELECT count(DISTINCT ruta_id) FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7301 AND 7399'), '073-14 Chofer A: la vista coincide con lo que la tabla base le deja ver');
-- Inserción de ubicación propia (flujo de ChoferView) sigue funcionando.
INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud, precision_m) VALUES (7301, 7303, 20.62, -103.32, 4);
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicaciones WHERE ruta_id = 7301') = 3, '073-15 Chofer: INSERT de su ubicación sigue funcionando');
SELECT t73_err($q$INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud) VALUES (7302, 7304, 1, 1)$q$, '073-16 Chofer: no inserta ubicación de otro chofer (sin cambio)', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t73_actor('authenticated', 'admin73@t', '73000000-0000-0000-0000-000000000001');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicacion_actual WHERE ruta_id BETWEEN 7301 AND 7399') = 2, '073-17 Admin: última ubicación de cada ruta (2)');
SELECT t73_assert(t73_n('SELECT count(*) FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7301 AND 7399') = 3, '073-18 Admin: lectura de la tabla base (mapa de rutas) sin cambio');
SELECT t73_err($q$INSERT INTO chofer_ubicacion_actual (ruta_id, chofer_id, latitud, longitud) VALUES (7301, 7303, 1, 1)$q$, '073-19 authenticated: la vista no admite escritura (sin grant / no actualizable)', '42501|55000');
ROLLBACK;

BEGIN;
DELETE FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7301 AND 7399;
DELETE FROM rutas WHERE id BETWEEN 7301 AND 7399;
DELETE FROM usuarios WHERE id BETWEEN 7301 AND 7309;
DELETE FROM auth.users WHERE id::text LIKE '73000000-%';
COMMIT;
\echo '── 073: TODAS LAS PRUEBAS OK'
