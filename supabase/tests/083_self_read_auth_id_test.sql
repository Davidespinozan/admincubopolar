-- 083_self_read_auth_id_test.sql — R5 (base de datos): el email ya no
-- participa en la autorización. self_read lee solo la fila cuyo auth_id es
-- el uid del JWT; el email del JWT (coincidente, distinto, en mayúsculas)
-- no da acceso; perfiles sin vincular no se leen ni se reclaman; Admin,
-- helpers 079 y constraint 082 intactos.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM usuarios WHERE id BETWEEN 8301 AND 8329;
DELETE FROM auth.users WHERE id::text LIKE '83000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('83000000-0000-0000-0000-000000000001', 'admin83@t'),   ('83000000-0000-0000-0000-000000000002', 'ventas83@t'),
  ('83000000-0000-0000-0000-000000000003', 'inadm83@t'),   ('83000000-0000-0000-0000-000000000009', 'atacante83@t'),
  ('83000000-0000-0000-0000-000000000099', 'noprof83@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8301, 'Admin 83',           'admin83@t',    'Admin',  'Activo',   '83000000-0000-0000-0000-000000000001'),
  (8302, 'Ventas 83',          'ventas83@t',   'Ventas', 'Activo',   '83000000-0000-0000-0000-000000000002'),
  (8303, 'InAdmin 83',         'inadm83@t',    'Admin',  'Inactivo', '83000000-0000-0000-0000-000000000003'),
  (8304, 'Sin vincular Admin', 'libre83@t',    'Admin',  'Activo',   NULL),
  (8305, 'Sin vincular Inact', 'libreina83@t', 'Ventas', 'Inactivo', NULL);
COMMIT;

CREATE OR REPLACE FUNCTION t83_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t83_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t83_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
-- ids visibles de usuarios 83xx para el actor actual
CREATE OR REPLACE FUNCTION t83_visibles() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT; BEGIN SELECT COALESCE(string_agg(id::text, ',' ORDER BY id), '') INTO v FROM usuarios WHERE id BETWEEN 8301 AND 8329; RETURN v; END $$;
CREATE OR REPLACE FUNCTION t83_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5((SELECT string_agg(concat_ws(':', id, email, rol, estatus, auth_id), ',' ORDER BY id) FROM usuarios WHERE id BETWEEN 8301 AND 8329))
$$;
CREATE OR REPLACE FUNCTION t83_ident() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('/', COALESCE(erp_rol_activo(), 'NULL'), COALESCE(erp_usuario_id()::text, 'NULL'), COALESCE(get_my_rol(), 'NULL'), COALESCE(get_my_user_id()::text, 'NULL'))
$$;
DROP TABLE IF EXISTS t83_ids;
CREATE TEMP TABLE t83_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t83_ids TO anon, authenticated;
INSERT INTO t83_ids VALUES ('h0', t83_huella());

\echo '── 083: estado físico'
SELECT t83_assert((SELECT qual = '((auth_id IS NOT NULL) AND (auth_id = auth.uid()))' AND with_check IS NULL AND cmd = 'SELECT' AND roles::text = '{authenticated}' FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios' AND policyname = 'self_read'), '083-01 self_read: auth_id = auth.uid(), sin email');
SELECT t83_assert((SELECT string_agg(policyname, ',' ORDER BY policyname) = 'admin_all,self_read' FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios'), '083-02 policies de usuarios: admin_all + self_read (sin otras)');
SELECT t83_assert((SELECT count(*) = 0 FROM pg_policies WHERE (coalesce(qual, '') || coalesce(with_check, '')) ~* 'email')
  AND (SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND pg_get_functiondef(p.oid) ~ 'auth\.jwt\(\)'), '083-03 ninguna policy ni función de public usa email o auth.jwt() para autorizar');
SELECT t83_assert((SELECT pg_get_constraintdef(oid) = 'UNIQUE (auth_id)' FROM pg_constraint WHERE conrelid = 'public.usuarios'::regclass AND conname = 'usuarios_auth_id_key'), '083-04 constraint 082 intacta');
SELECT t83_assert((SELECT md5(pg_get_functiondef(oid)) = '51a6dd4f6ee6486a34f81e3eec54eb8a' FROM pg_proc WHERE oid = 'public.erp_actor()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '0b78d79f3cf63b4d383997120a0faece' FROM pg_proc WHERE oid = 'public.get_my_rol()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '8d31947c0e10b975b4c86ad99345cb2b' FROM pg_proc WHERE oid = 'public.get_my_user_id()'::regprocedure), '083-05 helpers 071/079 intactos (md5 de producción)');

\echo '── 083: self_read por auth_id'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t83_actor('authenticated', 'ventas83@t', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302', '083-10 Ventas activo: lee exactamente su fila');
SELECT t83_actor('authenticated', 'admin83@t', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302' AND t83_ident() = 'Ventas/8302/Ventas/8302', '083-11 email de Admin en el JWT + uid de Ventas: sigue leyendo solo Ventas; identidad Ventas');
SELECT t83_actor('authenticated', 'ADMIN83@T', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302', '083-12 email en mayúsculas: irrelevante');
SELECT t83_actor('authenticated', 'libre83@t', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302', '083-13 email del perfil Admin sin vincular + uid de Ventas: no lo lee');
SELECT t83_actor('authenticated', 'otro@t', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302', '083-14 email cambiado en el JWT: la identidad sigue atada al uid');
SELECT t83_actor('authenticated', NULL, '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_visibles() = '8302', '083-15 sin email en el JWT: sigue leyendo su fila (solo uid)');
SELECT t83_actor('authenticated', 'inadm83@t', '83000000-0000-0000-0000-000000000003');
SELECT t83_assert(t83_visibles() = '8303' AND t83_ident() = 'NULL/NULL/NULL/NULL', '083-16 perfil Inactivo: lee su propia fila (semántica original de self_read) pero sin actor');
ROLLBACK;

\echo '── 083: el email no reclama ni vincula perfiles'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t83_actor('authenticated', 'libre83@t', '83000000-0000-0000-0000-000000000009');
SELECT t83_assert(t83_visibles() = '' AND t83_ident() = 'NULL/NULL/NULL/NULL', '083-20 Auth user con el email del perfil Admin sin vincular: no lee nada, sin actor');
SELECT t83_assert(t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000009' WHERE lower(email) = 'libre83@t'$q$) = 0, '083-21 no puede vincularse al perfil Admin por email (0 filas)');
SELECT t83_assert(t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000009' WHERE id = 8304$q$) = 0, '083-22 ni por id');
SELECT t83_actor('authenticated', 'libreina83@t', '83000000-0000-0000-0000-000000000009');
SELECT t83_assert(t83_visibles() = '' AND t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000009', estatus = 'Activo' WHERE id = 8305$q$) = 0, '083-23 perfil inactivo sin vincular: tampoco se reclama ni reactiva');
SELECT t83_actor('authenticated', 'ventas83@t', '83000000-0000-0000-0000-000000000009');
SELECT t83_assert(t83_visibles() = '' AND t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000009' WHERE id = 8302$q$) = 0, '083-24 uid distinto con el email de Ventas: no lee ni sobrescribe el auth_id existente');
SELECT t83_actor('authenticated', 'noprof83@t', '83000000-0000-0000-0000-000000000099');
SELECT t83_assert(t83_visibles() = '' AND t83_ident() = 'NULL/NULL/NULL/NULL', '083-25 Auth user sin perfil: cero filas, sin actor');
SELECT t83_actor('authenticated', 'ventas83@t', '83000000-0000-0000-0000-000000000002');
SELECT t83_assert(t83_rows($q$UPDATE usuarios SET rol = 'Admin' WHERE id = 8302$q$) = 0 AND t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000001' WHERE id = 8302$q$) = 0, '083-26 el propio usuario no edita su fila (self_read es solo SELECT)');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon; SELECT t83_actor('anon', 'admin83@t', NULL);
-- 090: anon ya no tiene SELECT sobre usuarios (más estricto que cero filas).
DO $do$ DECLARE v TEXT; BEGIN
  BEGIN v := t83_visibles(); EXCEPTION WHEN insufficient_privilege THEN v := ''; END;
  PERFORM t83_assert(v = '', '083-27 anon: cero filas (o sin privilegio tras 090)');
END $do$;
ROLLBACK;
SELECT t83_assert(t83_huella() = (SELECT v FROM t83_ids WHERE k = 'h0'), '083-28 cero cambios en perfiles (nada vinculado, nada reactivado)');

\echo '── 083: Admin y vinculación legítima'
BEGIN; SET LOCAL ROLE authenticated; SELECT t83_actor('authenticated', 'admin83@t', '83000000-0000-0000-0000-000000000001');
SELECT t83_assert(t83_visibles() = '8301,8302,8303,8304,8305', '083-30 Admin: ve todos los perfiles (admin_all)');
SELECT t83_assert(t83_rows($q$UPDATE usuarios SET auth_id = '83000000-0000-0000-0000-000000000009' WHERE id = 8304$q$) = 1, '083-31 Admin: vincula un perfil libre a un uid (alta/reparación explícita)');
SELECT t83_actor('authenticated', 'atacante83@t', '83000000-0000-0000-0000-000000000009');
SELECT t83_assert(t83_ident() = 'Admin/8304/Admin/8304' AND t83_visibles() = '8301,8302,8303,8304,8305', '083-32 tras la vinculación por Admin, ese uid resuelve como el perfil vinculado (Admin activo → admin_all)');
ROLLBACK;
SELECT t83_assert(t83_huella() = (SELECT v FROM t83_ids WHERE k = 'h0'), '083-33 todo revertido');

BEGIN;
DELETE FROM usuarios WHERE id BETWEEN 8301 AND 8329;
DELETE FROM auth.users WHERE id::text LIKE '83000000-%';
COMMIT;
\echo '── 083: TODAS LAS PRUEBAS OK'
