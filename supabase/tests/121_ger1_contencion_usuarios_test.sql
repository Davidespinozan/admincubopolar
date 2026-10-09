-- 121_ger1_contencion_usuarios_test.sql — GER-1: tras 121 nadie escribe
-- `usuarios` por REST; Admin la sigue leyendo completa, cada quien la suya, y
-- los cambios van por guardar_usuario.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t121_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM bitacora_cambios WHERE registro_id IN ('12101', '12102', '12103');
  DELETE FROM usuarios WHERE id BETWEEN 12101 AND 12103;
  DELETE FROM auth.users WHERE id::text LIKE '12100000-%';
END $$;
BEGIN; SELECT t121_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('12100000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t121' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (12101, 'Admin 121',  'u1@t121', 'Admin',  'Activo', '12100000-0000-0000-0000-000000000001'),
  (12102, 'Ventas 121', 'u2@t121', 'Ventas', 'Activo', '12100000-0000-0000-0000-000000000002'),
  (12103, 'Chofer 121', 'u3@t121', 'Chofer', 'Activo', '12100000-0000-0000-0000-000000000003');
COMMIT;

CREATE OR REPLACE FUNCTION t121_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t121_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t121_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12100000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
GRANT EXECUTE ON FUNCTION t121_assert(BOOLEAN, TEXT), t121_err(TEXT, TEXT, TEXT), t121_auth(INTEGER) TO PUBLIC;

\echo '── 121: sin escritura REST en usuarios'
SELECT t121_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'admin_all')
               AND NOT has_table_privilege('authenticated', 'public.usuarios', 'INSERT')
               AND NOT has_table_privilege('authenticated', 'public.usuarios', 'UPDATE')
               AND NOT has_table_privilege('authenticated', 'public.usuarios', 'DELETE')
               AND NOT has_sequence_privilege('authenticated', 'public.usuarios_id_seq', 'USAGE')
               AND has_table_privilege('authenticated', 'public.usuarios', 'SELECT'),
  '121-00 sin admin_all ni DML para authenticated; la lectura se conserva');
BEGIN; SET LOCAL ROLE authenticated; SELECT t121_auth(1);
SELECT t121_err($$UPDATE usuarios SET rol = 'Admin' WHERE id = 12102$$, '121-01a Admin no cambia roles por REST', '42501');
SELECT t121_err($$INSERT INTO usuarios (nombre, email, rol) VALUES ('Intruso 121', 'x@t121', 'Admin')$$, '121-01b ni crea usuarios', '42501');
SELECT t121_err($$DELETE FROM usuarios WHERE id = 12103$$, '121-01c ni los borra', '42501');
SELECT t121_assert((SELECT count(*) FROM usuarios WHERE id BETWEEN 12101 AND 12103) = 3, '121-02a Admin lee todos (admin_read)');
SELECT t121_assert((guardar_usuario(12103, 'Chofer Uno 121', 'Chofer', 'Inactivo') ->> 'estatus') = 'Inactivo', '121-02b los cambios van por guardar_usuario');
SELECT t121_auth(2);
SELECT t121_assert((SELECT array_agg(id) FROM usuarios WHERE id BETWEEN 12101 AND 12103) = ARRAY[12102::bigint], '121-03 Ventas solo se lee a sí mismo');
COMMIT;

BEGIN; SELECT t121_limpiar(); COMMIT;
DROP FUNCTION t121_limpiar(); DROP FUNCTION t121_assert(BOOLEAN, TEXT); DROP FUNCTION t121_err(TEXT, TEXT, TEXT); DROP FUNCTION t121_auth(INTEGER);
\echo '── 121: PASS'
