-- 075_cuartos_precios_test.sql — F3 etapa 1: cuartos_frios solo se escribe
-- por Admin o por update_stocks_atomic; precios_esp solo por Admin.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'C75-%';
DELETE FROM precios_esp WHERE sku LIKE 'C75-%';
DELETE FROM cuartos_frios WHERE id LIKE 'CF-C75%';
DELETE FROM productos WHERE sku LIKE 'C75-%';
DELETE FROM clientes WHERE id = 7501;
DELETE FROM usuarios WHERE id BETWEEN 7501 AND 7509;
DELETE FROM auth.users WHERE id::text LIKE '75000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('75000000-0000-0000-0000-000000000001', 'admin75@t'),
  ('75000000-0000-0000-0000-000000000002', 'chofer75@t'),
  ('75000000-0000-0000-0000-000000000003', 'prod75@t'),
  ('75000000-0000-0000-0000-000000000004', 'ventas75@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7501, 'Admin 75',  'admin75@t',  'Admin',      'Activo', '75000000-0000-0000-0000-000000000001'),
  (7502, 'Chofer 75', 'chofer75@t', 'Chofer',     'Activo', '75000000-0000-0000-0000-000000000002'),
  (7503, 'Prod 75',   'prod75@t',   'Producción', 'Activo', '75000000-0000-0000-0000-000000000003'),
  (7504, 'Ventas 75', 'ventas75@t', 'Ventas',     'Activo', '75000000-0000-0000-0000-000000000004');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (7501, 'Cliente 75', 'XAXX010101000', 0);
INSERT INTO productos (sku, nombre, precio, stock) VALUES ('C75-A', 'Hielo 75', 30, 0), ('C75-B', 'Otro 75', 20, 0);
INSERT INTO cuartos_frios (id, nombre, capacidad, stock) VALUES ('CF-C75', 'Cuarto 75', 100, '{"C75-A": 10, "C75-B": 5}'::jsonb);
COMMIT;

CREATE OR REPLACE FUNCTION t75_actor(p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', p_email, 'sub', p_sub)::text, true); END $$;
CREATE OR REPLACE FUNCTION t75_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t75_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
-- Filas afectadas por un DML (0 = la policy no lo permite para ninguna fila).
CREATE OR REPLACE FUNCTION t75_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t75_cuarto() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(string_agg(id || nombre || coalesce(capacidad::text, '') || stock::text, ',' ORDER BY id)) FROM cuartos_frios WHERE id LIKE 'CF-C75%' $$;
DROP TABLE IF EXISTS t75_ids;
CREATE TEMP TABLE t75_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t75_ids TO authenticated;
INSERT INTO t75_ids VALUES ('h0', t75_cuarto());

\echo '── 075: estado físico'
SELECT t75_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cuartos_frios' AND policyname IN ('update_roles', 'write_roles')), '075-01 cuartos_frios: sin policies legacy de escritura para Chofer/Producción');
SELECT t75_assert((SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cuartos_frios') = 'admin_all,read_all', '075-02 cuartos_frios: quedan admin_all y read_all');
SELECT t75_assert((SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'precios_esp') = 'admin_all,read_all', '075-03 precios_esp: quedan admin_all y read_all');
SELECT t75_assert((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.cuartos_frios'::regclass, 'public.precios_esp'::regclass)), '075-04 RLS físico sigue activo');

\echo '── 075: Chofer'
BEGIN; SET LOCAL ROLE authenticated; SELECT t75_actor('chofer75@t', '75000000-0000-0000-0000-000000000002');
SELECT t75_assert(t75_rows($q$UPDATE cuartos_frios SET stock = '{"C75-A": -50}'::jsonb WHERE id = 'CF-C75'$q$) = 0, '075-10 Chofer: escritura directa de stock (incluido negativo) no afecta filas');
SELECT t75_assert(t75_rows($q$UPDATE cuartos_frios SET nombre = 'x', capacidad = 1 WHERE id = 'CF-C75'$q$) = 0, '075-11 Chofer: metadatos del cuarto no modificables');
SELECT t75_assert(t75_rows($q$UPDATE cuartos_frios SET stock = stock - 'C75-B' WHERE id = 'CF-C75'$q$) = 0, '075-12 Chofer: llaves de stock no modificables');
SELECT t75_err($q$INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C75X', 'x', '{}'::jsonb)$q$, '075-13 Chofer: INSERT de cuarto denegado', '42501');
SELECT t75_assert(t75_cuarto() = (SELECT v FROM t75_ids WHERE k = 'h0'), '075-14 Chofer: cuarto sin cambios');
-- 085: contenido → el Chofer ya no ejecuta el RPC genérico (42501).
DO $$ BEGIN IF pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN PERFORM t75_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-C75","sku":"C75-A","delta":-2,"tipo":"Salida","origen":"Carga 75"}]'::jsonb)$q$, '075-14b (085) Chofer sin RPC genérico', '42501'); ELSE PERFORM update_stocks_atomic('[{"cuarto_id":"CF-C75","sku":"C75-A","delta":-2,"tipo":"Salida","origen":"Carga 75"}]'::jsonb); END IF; END $$;
SELECT t75_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-C75","sku":"C75-A","delta":-999}]'::jsonb)$q$, '075-15 Chofer vía RPC: negativo rechazado (o 42501 tras 085)', 'P0001|42501');
COMMIT;
SELECT t75_assert((SELECT (stock ->> 'C75-A')::int = CASE WHEN pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN 10 ELSE 8 END FROM cuartos_frios WHERE id = 'CF-C75'), '075-16 Chofer vía update_stocks_atomic: descuento aplicado (10 → 8) o denegado (085)');
SELECT t75_assert((SELECT count(*) = CASE WHEN pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN 0 ELSE 1 END AND COALESCE(bool_and(usuario = 'Chofer 75' AND cantidad = 2 AND tipo = 'Salida'), true) FROM inventario_mov WHERE producto = 'C75-A'), '075-17 kardex generado por la RPC con el actor real (ninguno tras 085)');
INSERT INTO t75_ids VALUES ('h1', t75_cuarto()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;

\echo '── 075: Producción'
BEGIN; SET LOCAL ROLE authenticated; SELECT t75_actor('prod75@t', '75000000-0000-0000-0000-000000000003');
SELECT t75_err($q$INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C75P', 'x', '{"C75-A": 5000}'::jsonb)$q$, '075-20 Producción: INSERT de cuarto denegado', '42501');
SELECT t75_assert(t75_rows($q$UPDATE cuartos_frios SET stock = '{"C75-A": 9999}'::jsonb WHERE id = 'CF-C75'$q$) = 0, '075-21 Producción: escritura directa de stock no afecta filas');
SELECT t75_assert(t75_cuarto() = (SELECT v FROM t75_ids WHERE k = 'h1'), '075-22 Producción: cuarto sin cambios');
DO $$ BEGIN IF pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN PERFORM t75_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-C75","sku":"C75-A","delta":3,"tipo":"Entrada","origen":"Producción 75"}]'::jsonb)$q$, '075-22b (085) Producción sin RPC genérico', '42501'); ELSE PERFORM update_stocks_atomic('[{"cuarto_id":"CF-C75","sku":"C75-A","delta":3,"tipo":"Entrada","origen":"Producción 75"}]'::jsonb); END IF; END $$;
COMMIT;
SELECT t75_assert((SELECT (stock ->> 'C75-A')::int = CASE WHEN pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN 10 ELSE 11 END FROM cuartos_frios WHERE id = 'CF-C75') AND (SELECT count(*) = CASE WHEN pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN 0 ELSE 1 END FROM inventario_mov WHERE producto = 'C75-A' AND usuario = 'Prod 75'), '075-23 Producción vía update_stocks_atomic: entrada (o denegada tras 085)');

\echo '── 075: Admin'
BEGIN; SET LOCAL ROLE authenticated; SELECT t75_actor('admin75@t', '75000000-0000-0000-0000-000000000001');
SELECT t75_assert(t75_rows($q$UPDATE cuartos_frios SET nombre = 'Cuarto 75 renombrado', capacidad = 120 WHERE id = 'CF-C75'$q$) = 1, '075-30 Admin: administra metadatos del cuarto');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C75N', 'Nuevo 75', '{}'::jsonb);
SELECT t75_assert(t75_rows($q$DELETE FROM cuartos_frios WHERE id = 'CF-C75N'$q$) = 1, '075-31 Admin: crea y elimina cuartos');
COMMIT;

\echo '── 075: precios_esp'
BEGIN; SET LOCAL ROLE authenticated; SELECT t75_actor('ventas75@t', '75000000-0000-0000-0000-000000000004');
SELECT t75_err($q$INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (7501, 'C75-A', 1)$q$, '075-40 Ventas: INSERT directo en precios_esp denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t75_actor('admin75@t', '75000000-0000-0000-0000-000000000001');
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (7501, 'C75-A', 25);
SELECT t75_assert(t75_rows($q$UPDATE precios_esp SET precio = 24 WHERE sku = 'C75-A'$q$) = 1 AND t75_rows($q$DELETE FROM precios_esp WHERE sku = 'C75-A'$q$) = 1, '075-41 Admin: alta, edición y baja de precios especiales');
COMMIT;

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'C75-%';
DELETE FROM precios_esp WHERE sku LIKE 'C75-%';
DELETE FROM cuartos_frios WHERE id LIKE 'CF-C75%';
DELETE FROM productos WHERE sku LIKE 'C75-%';
DELETE FROM clientes WHERE id = 7501;
DELETE FROM usuarios WHERE id BETWEEN 7501 AND 7509;
DELETE FROM auth.users WHERE id::text LIKE '75000000-%';
COMMIT;
\echo '── 075: TODAS LAS PRUEBAS OK'
