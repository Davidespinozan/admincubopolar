-- 082_r3_r4_test.sql — R3: confirmar_produccion inalcanzable por roles de API
-- (076 sigue funcionando); R4: auth_id no NULL es único (varios NULL
-- permitidos), identidad canónica intacta. Ambas independientes.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P82-%');
DELETE FROM mermas WHERE sku LIKE 'P82-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P82-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P82-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P82-%';
DELETE FROM produccion WHERE sku LIKE 'P82-%';
DELETE FROM cuartos_frios WHERE id = 'CF-82';
DELETE FROM productos WHERE sku LIKE 'P82-%';
DELETE FROM auditoria WHERE detalle LIKE '%P82-%';
DELETE FROM usuarios WHERE id BETWEEN 8201 AND 8229;
DELETE FROM auth.users WHERE id::text LIKE '82000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('82000000-0000-0000-0000-000000000001', 'admin82@t'),  ('82000000-0000-0000-0000-000000000002', 'ventas82@t'),
  ('82000000-0000-0000-0000-000000000003', 'chofer82@t'), ('82000000-0000-0000-0000-000000000004', 'prod82@t'),
  ('82000000-0000-0000-0000-000000000005', 'bolsas82@t'), ('82000000-0000-0000-0000-000000000006', 'fact82@t'),
  ('82000000-0000-0000-0000-000000000007', 'inadm82@t'),  ('82000000-0000-0000-0000-000000000099', 'noprof82@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8201, 'Admin 82',   'admin82@t',  'Admin',          'Activo',   '82000000-0000-0000-0000-000000000001'),
  (8202, 'Ventas 82',  'ventas82@t', 'Ventas',         'Activo',   '82000000-0000-0000-0000-000000000002'),
  (8203, 'Chofer 82',  'chofer82@t', 'Chofer',         'Activo',   '82000000-0000-0000-0000-000000000003'),
  (8204, 'Prod 82',    'prod82@t',   'Producción',     'Activo',   '82000000-0000-0000-0000-000000000004'),
  (8205, 'Bolsas 82',  'bolsas82@t', 'Almacén Bolsas', 'Activo',   '82000000-0000-0000-0000-000000000005'),
  (8206, 'Fact 82',    'fact82@t',   'Facturación',    'Activo',   '82000000-0000-0000-0000-000000000006'),
  (8207, 'InAdmin 82', 'inadm82@t',  'Admin',          'Inactivo', '82000000-0000-0000-0000-000000000007');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P82-HIELO', 'Hielo 82', 'Producto Terminado', 30, 0,  0, 'P82-BOLSA'),
  ('P82-BOLSA', 'Bolsa 82', 'Empaque',            0,  20, 1, NULL),
  ('P82-BARRA', 'Barra 82', 'Materia Prima',      0,  20, 0, NULL),
  ('P82-TRIT',  'Trit 82',  'Producto Terminado', 40, 0,  0, NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-82', 'Cuarto 82', '{}'::jsonb);
INSERT INTO produccion (id, folio, turno, maquina, sku, cantidad, estatus) VALUES (8290, 'OP-82PEND', 'T1', 'M1', 'P82-HIELO', 9, 'Pendiente');
COMMIT;

CREATE OR REPLACE FUNCTION t82_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t82_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t82_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t82_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t82_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', sku, stock), ',' ORDER BY sku) FROM productos WHERE sku LIKE 'P82-%'),
    (SELECT string_agg(concat_ws(':', id, estatus, cantidad), ',' ORDER BY id) FROM produccion WHERE sku LIKE 'P82-%'),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P82-%'),
    (SELECT stock::text FROM cuartos_frios WHERE id = 'CF-82'),
    (SELECT count(*)::text FROM auditoria WHERE detalle LIKE '%P82-%'),
    (SELECT string_agg(concat_ws(':', id, rol, estatus, auth_id), ',' ORDER BY id) FROM usuarios WHERE id BETWEEN 8201 AND 8229)))
$$;
CREATE OR REPLACE FUNCTION t82_ident() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('/', COALESCE(erp_rol_activo(), 'NULL'), COALESCE(erp_usuario_id()::text, 'NULL'), COALESCE(get_my_rol(), 'NULL'), COALESCE(get_my_user_id()::text, 'NULL'))
$$;
DROP TABLE IF EXISTS t82_ids;
CREATE TEMP TABLE t82_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t82_ids TO anon, authenticated, service_role;
INSERT INTO t82_ids VALUES ('h0', t82_huella());

\echo '── 082 R3: estado físico'
-- 090 retira confirmar_produccion (función muerta): 082-01..03 aceptan esa retirada.
SELECT t82_assert((to_regprocedure('public.confirmar_produccion(bigint,bigint)') IS NULL AND to_regprocedure('public.b4_escritura_api()') IS NOT NULL) OR (SELECT count(*) = 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'confirmar_produccion'), '082-01 confirmar_produccion sigue físicamente presente (o retirada en 090)');
SELECT t82_assert((to_regprocedure('public.confirmar_produccion(bigint,bigint)') IS NULL AND to_regprocedure('public.b4_escritura_api()') IS NOT NULL) OR (SELECT md5(pg_get_functiondef(oid)) = '406cf50b7a01973bde25b4dcdf0316f9' AND prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.confirmar_produccion(bigint,bigint)')), '082-02 cuerpo sin reescribir (md5 de producción) o retirada en 090');
SELECT t82_assert((SELECT NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('service_role', oid, 'EXECUTE')
  FROM pg_proc WHERE oid = to_regprocedure('public.confirmar_produccion(bigint,bigint)')) OR (to_regprocedure('public.confirmar_produccion(bigint,bigint)') IS NULL AND to_regprocedure('public.b4_escritura_api()') IS NOT NULL), '082-03 sin EXECUTE para PUBLIC, anon, authenticated ni service_role (o retirada en 090)');
SELECT t82_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'confirmar_produccion' AND pg_get_functiondef(p.oid) ~ 'confirmar_produccion')
  AND (SELECT count(*) = 0 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND pg_get_functiondef(p.oid) ~ 'confirmar_produccion'), '082-04 ninguna función ni trigger la invoca');

\echo '── 082 R3: ningún rol de API puede ejecutarla; cero efectos'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('082-10 Admin',           'authenticated', 'admin82@t',  '82000000-0000-0000-0000-000000000001'),
      ('082-11 Ventas',          'authenticated', 'ventas82@t', '82000000-0000-0000-0000-000000000002'),
      ('082-12 Chofer',          'authenticated', 'chofer82@t', '82000000-0000-0000-0000-000000000003'),
      ('082-13 Producción',      'authenticated', 'prod82@t',   '82000000-0000-0000-0000-000000000004'),
      ('082-14 Almacén Bolsas',  'authenticated', 'bolsas82@t', '82000000-0000-0000-0000-000000000005'),
      ('082-15 Facturación',     'authenticated', 'fact82@t',   '82000000-0000-0000-0000-000000000006'),
      ('082-16 Admin INACTIVO',  'authenticated', 'inadm82@t',  '82000000-0000-0000-0000-000000000007'),
      ('082-17 JWT sin perfil',  'authenticated', 'noprof82@t', '82000000-0000-0000-0000-000000000099'),
      ('082-18 anon',            'anon',          NULL,         NULL),
      ('082-19 service_role',    'service_role',  NULL,         NULL)) x(tag, dbrole, email, sub)
  LOOP
    PERFORM t82_actor(a.dbrole, a.email, a.sub);
    EXECUTE format('SET LOCAL ROLE %I', a.dbrole);
    PERFORM t82_err($q$SELECT confirmar_produccion(8290, 8201)$q$, a.tag || ': confirmar_produccion denegada por ACL (o inexistente tras 090)', '42501|42883');
    RESET ROLE;
    PERFORM t82_assert(t82_huella() = (SELECT v FROM t82_ids WHERE k = 'h0'), a.tag || ': cero efectos (stock, producción, kardex, auditoría)');
  END LOOP;
END $$;
SELECT t82_assert((SELECT estatus = 'Pendiente' FROM produccion WHERE id = 8290) AND (SELECT stock = 0 FROM productos WHERE sku = 'P82-HIELO'), '082-20 la fila Pendiente sigue Pendiente y el stock en 0 (denegación por ACL, independiente de identidad y de R4)');

\echo '── 082 R3: la arquitectura 076 no la necesita'
BEGIN; SET LOCAL ROLE authenticated; SELECT t82_actor('authenticated', 'prod82@t', '82000000-0000-0000-0000-000000000004');
INSERT INTO t82_ids VALUES ('p1', registrar_produccion('82000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 1', 'P82-HIELO', 6, 'CF-82')::text);
INSERT INTO t82_ids VALUES ('t1', registrar_transformacion('82000000-0000-0000-0000-00000000b001', 'P82-BARRA', 8, 'P82-TRIT', 6, 'CF-82')::text);
COMMIT;
SELECT t82_assert(((SELECT v FROM t82_ids WHERE k = 'p1')::jsonb ->> 'actor') = 'Prod 82' AND (SELECT (stock ->> 'P82-HIELO')::int = 6 FROM cuartos_frios WHERE id = 'CF-82') AND (SELECT stock = 14 FROM productos WHERE sku = 'P82-BOLSA')
  AND (SELECT count(*) = 1 FROM produccion WHERE sku = 'P82-HIELO' AND operacion_id IS NOT NULL AND estatus = 'Confirmada'), '082-21 registrar_produccion: producción Confirmada directa, cuarto +6, empaque 20 → 14');
SELECT t82_assert((SELECT (stock ->> 'P82-TRIT')::int = 6 FROM cuartos_frios WHERE id = 'CF-82') AND (SELECT stock = 12 FROM productos WHERE sku = 'P82-BARRA') AND (SELECT count(*) = 1 FROM mermas WHERE sku = 'P82-BARRA' AND cantidad = 2), '082-22 registrar_transformacion: insumo 20 → 12, salida 6, merma de proceso 2');
SELECT t82_assert((SELECT count(*) = 0 FROM produccion WHERE sku LIKE 'P82-%' AND operacion_id IS NOT NULL AND estatus <> 'Confirmada'), '082-23 076 nunca deja filas Pendiente: nada por confirmar');

\echo '── 082 R4: estado físico'
SELECT t82_assert((SELECT pg_get_constraintdef(oid) = 'UNIQUE (auth_id)' AND contype = 'u' FROM pg_constraint WHERE conrelid = 'public.usuarios'::regclass AND conname = 'usuarios_auth_id_key'), '082-30 constraint usuarios_auth_id_key UNIQUE (auth_id) presente (NULLS DISTINCT)');
SELECT t82_assert((SELECT count(*) = 0 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'usuarios' AND indexname = 'idx_usuarios_auth_id'), '082-31 índice parcial redundante idx_usuarios_auth_id eliminado');
SELECT t82_assert((SELECT string_agg(indexname, ',' ORDER BY indexname) = 'idx_usuarios_visibles,usuarios_auth_id_key,usuarios_email_key,usuarios_pkey' FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'usuarios'), '082-32 índices de usuarios: pkey, email, auth_id único, visibles');
SELECT t82_assert((SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'auth_id'), '082-33 auth_id sigue siendo nullable (R5 decide la vinculación)');
SELECT t82_assert((SELECT md5(pg_get_functiondef(oid)) = '51a6dd4f6ee6486a34f81e3eec54eb8a' FROM pg_proc WHERE oid = 'public.erp_actor()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '0b78d79f3cf63b4d383997120a0faece' FROM pg_proc WHERE oid = 'public.get_my_rol()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '8d31947c0e10b975b4c86ad99345cb2b' FROM pg_proc WHERE oid = 'public.get_my_user_id()'::regprocedure), '082-34 helpers canónicos 071/079 sin cambios (md5 de producción)');

\echo '── 082 R4: invariante de unicidad'
SELECT t82_err($q$INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8210, 'Dup A82', 'dupa82@t', 'Ventas', 'Activo', '82000000-0000-0000-0000-000000000002')$q$, '082-40 segundo perfil con el auth_id de Ventas 82 (otro email) rechazado', '23505');
SELECT t82_err($q$INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8211, 'Dup Admin82', 'dupadmin82@t', 'Admin', 'Activo', '82000000-0000-0000-0000-000000000001')$q$, '082-41 perfil Admin duplicado sobre el auth_id de Admin 82 rechazado (sin escalada por duplicado)', '23505');
SELECT t82_err($q$UPDATE usuarios SET auth_id = '82000000-0000-0000-0000-000000000001' WHERE id = 8202$q$, '082-42 relinkear un perfil a un auth_id ya usado rechazado', '23505');
SELECT t82_err($q$INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8212, 'Dup inactivo82', 'dupin82@t', 'Admin', 'Inactivo', '82000000-0000-0000-0000-000000000007')$q$, '082-43 el auth_id de un perfil inactivo tampoco se duplica', '23505');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8213, 'Sin vincular A82', 'nolinka82@t', 'Ventas', 'Activo', NULL), (8214, 'Sin vincular B82', 'nolinkb82@t', 'Chofer', 'Activo', NULL);
SELECT t82_assert((SELECT count(*) = 2 FROM usuarios WHERE id IN (8213, 8214) AND auth_id IS NULL), '082-44 varios perfiles con auth_id NULL permitidos (alta sin vincular, NULLS DISTINCT)');
SELECT t82_assert(t82_rows($q$UPDATE usuarios SET auth_id = '82000000-0000-0000-0000-000000000099' WHERE id = 8213$q$) = 1, '082-45 vincular un perfil NULL a un auth_id libre permitido');
SELECT t82_err($q$UPDATE usuarios SET auth_id = '82000000-0000-0000-0000-000000000099' WHERE id = 8214$q$, '082-46 un segundo perfil no puede tomar ese mismo auth_id', '23505');
SELECT t82_assert((SELECT count(*) = 1 FROM usuarios WHERE auth_id = '82000000-0000-0000-0000-000000000002') AND (SELECT auth_id IS NULL FROM usuarios WHERE id = 8214), '082-47 los rechazos no dejaron rastro (sin duplicado, sin relink parcial)');

\echo '── 082 R4: identidad canónica sin cambios'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t82_actor('authenticated', 'admin82@t', '82000000-0000-0000-0000-000000000001');
SELECT t82_assert(t82_ident() = 'Admin/8201/Admin/8201', '082-50 Admin activo resuelve igual (canónico y legacy)');
SELECT t82_actor('authenticated', 'ventas82@t', '82000000-0000-0000-0000-000000000002');
SELECT t82_assert(t82_ident() = 'Ventas/8202/Ventas/8202', '082-51 Ventas activo resuelve igual');
SELECT t82_actor('authenticated', 'admin82@t', '82000000-0000-0000-0000-000000000002');
SELECT t82_assert(t82_ident() = 'Ventas/8202/Ventas/8202', '082-52 el email del JWT sigue sin importar: sub de Ventas → Ventas');
SELECT t82_actor('authenticated', 'inadm82@t', '82000000-0000-0000-0000-000000000007');
SELECT t82_assert(t82_ident() = 'NULL/NULL/NULL/NULL', '082-53 inactivo: sin actor (fail-closed)');
SELECT t82_actor('authenticated', 'nolinka82@t', '82000000-0000-0000-0000-000000000099');
SELECT t82_assert(t82_ident() = 'Ventas/8213/Ventas/8213', '082-54 perfil recién vinculado resuelve por auth_id');
SELECT t82_actor('authenticated', 'nolinkb82@t', NULL);
SELECT t82_assert(t82_ident() = 'NULL/NULL/NULL/NULL', '082-55 perfil sin vincular (auth_id NULL) nunca resuelve: sin autoridad por REST');
ROLLBACK;

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P82-%');
DELETE FROM mermas WHERE sku LIKE 'P82-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P82-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P82-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P82-%';
DELETE FROM produccion WHERE sku LIKE 'P82-%';
DELETE FROM cuartos_frios WHERE id = 'CF-82';
DELETE FROM productos WHERE sku LIKE 'P82-%';
DELETE FROM auditoria WHERE detalle LIKE '%P82-%';
DELETE FROM usuarios WHERE id BETWEEN 8201 AND 8229;
DELETE FROM auth.users WHERE id::text LIKE '82000000-%';
COMMIT;
\echo '── 082: TODAS LAS PRUEBAS OK'
