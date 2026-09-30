-- 077_escrituras_produccion_test.sql — F3-B/C/E: escritura directa denegada
-- para roles no Admin; los contratos 076 siguen funcionando; Admin intacto.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P77-%');
DELETE FROM mermas WHERE sku LIKE 'P77-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P77-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P77-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P77-%';
DELETE FROM produccion WHERE sku LIKE 'P77-%';
DELETE FROM cuartos_frios WHERE id = 'CF-77';
DELETE FROM productos WHERE sku LIKE 'P77-%';
DELETE FROM auditoria WHERE detalle LIKE '%P77-%';
DELETE FROM usuarios WHERE id BETWEEN 7701 AND 7709;
DELETE FROM auth.users WHERE id::text LIKE '77000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('77000000-0000-0000-0000-000000000001', 'admin77@t'), ('77000000-0000-0000-0000-000000000002', 'prod77@t'),
  ('77000000-0000-0000-0000-000000000003', 'ventas77@t'), ('77000000-0000-0000-0000-000000000004', 'chofer77@t'),
  ('77000000-0000-0000-0000-000000000005', 'bolsas77@t'), ('77000000-0000-0000-0000-000000000006', 'fact77@t'),
  ('77000000-0000-0000-0000-000000000007', 'inadm77@t'), ('77000000-0000-0000-0000-000000000008', 'inprod77@t'),
  ('77000000-0000-0000-0000-000000000099', 'noprof77@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7701, 'Admin 77',   'admin77@t',  'Admin',          'Activo',   '77000000-0000-0000-0000-000000000001'),
  (7702, 'Prod 77',    'prod77@t',   'Producción',     'Activo',   '77000000-0000-0000-0000-000000000002'),
  (7703, 'Ventas 77',  'ventas77@t', 'Ventas',         'Activo',   '77000000-0000-0000-0000-000000000003'),
  (7704, 'Chofer 77',  'chofer77@t', 'Chofer',         'Activo',   '77000000-0000-0000-0000-000000000004'),
  (7705, 'Bolsas 77',  'bolsas77@t', 'Almacén Bolsas', 'Activo',   '77000000-0000-0000-0000-000000000005'),
  (7706, 'Fact 77',    'fact77@t',   'Facturación',    'Activo',   '77000000-0000-0000-0000-000000000006'),
  (7707, 'InAdmin 77', 'inadm77@t',  'Admin',          'Inactivo', '77000000-0000-0000-0000-000000000007'),
  (7708, 'InProd 77',  'inprod77@t', 'Producción',     'Inactivo', '77000000-0000-0000-0000-000000000008');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P77-HIELO', 'Hielo 77', 'Producto Terminado', 30, 0,  0, 'P77-BOLSA'),
  ('P77-BOLSA', 'Bolsa 77', 'Empaque',            0,  20, 1, NULL),
  ('P77-BARRA', 'Barra 77', 'Materia Prima',      0,  20, 0, NULL),
  ('P77-TRIT',  'Trit 77',  'Producto Terminado', 40, 0,  0, NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-77', 'Cuarto 77', '{}'::jsonb);
INSERT INTO produccion (folio, turno, maquina, sku, cantidad, estatus) VALUES ('OP-77FIX', 'T1', 'M1', 'P77-HIELO', 5, 'Confirmada');
COMMIT;

CREATE OR REPLACE FUNCTION t77_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t77_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t77_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t77_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t77_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', sku, nombre, stock, precio, costo_unitario, empaque_sku, clave_prod_serv), ',' ORDER BY sku) FROM productos WHERE sku LIKE 'P77-%' OR sku LIKE 'X77-%'),
    (SELECT string_agg(concat_ws(':', folio, sku, cantidad, estatus, costo_total), ',' ORDER BY id) FROM produccion WHERE sku LIKE 'P77-%'),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P77-%' OR producto LIKE 'X77-%'),
    (SELECT stock::text FROM cuartos_frios WHERE id = 'CF-77'),
    (SELECT count(*)::text FROM movimientos_contables WHERE concepto LIKE '%P77-%'),
    (SELECT count(*)::text FROM mermas WHERE sku LIKE 'P77-%')))
$$;
CREATE OR REPLACE FUNCTION t77_stock(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
DROP TABLE IF EXISTS t77_ids;
CREATE TEMP TABLE t77_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t77_ids TO anon, authenticated;
INSERT INTO t77_ids VALUES ('h0', t77_huella());

-- Intentos de escritura directa (todas las columnas relevantes).
CREATE OR REPLACE FUNCTION t77_intentos(p_tag TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t77_assert(t77_rows($q$UPDATE productos SET stock = 9999 WHERE sku = 'P77-BOLSA'$q$) = 0, p_tag || ': productos.stock directo no afecta filas');
  PERFORM t77_assert(t77_rows($q$UPDATE productos SET sku = 'P77-RENOMBRADO' WHERE sku = 'P77-HIELO'$q$) = 0, p_tag || ': productos.sku directo no afecta filas (bypass de 074 cerrado)');
  PERFORM t77_assert(t77_rows($q$UPDATE productos SET nombre = 'x', precio = 0.01, costo_unitario = 0, clave_prod_serv = 'X', empaque_sku = NULL WHERE sku = 'P77-HIELO'$q$) = 0, p_tag || ': nombre/precio/costo/SAT/empaque directos no afectan filas');
  PERFORM t77_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('X77-NUEVO', 'x', 1, 1)$q$, p_tag || ': INSERT en productos denegado', '42501');
  PERFORM t77_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Entrada', 'P77-BOLSA', 999, 'x', 'Admin 77')$q$, p_tag || ': INSERT directo de kardex denegado', '42501');
  PERFORM t77_err($q$INSERT INTO produccion (folio, turno, maquina, sku, cantidad, estatus) VALUES ('OP-X77', 'T', 'M', 'P77-HIELO', 1, 'Pendiente')$q$, p_tag || ': INSERT directo en produccion denegado', '42501');
  PERFORM t77_assert(t77_rows($q$UPDATE produccion SET cantidad = 999, estatus = 'Pendiente', sku = 'P77-TRIT' WHERE folio = 'OP-77FIX'$q$) = 0, p_tag || ': UPDATE directo de produccion no afecta filas');
  PERFORM t77_assert(t77_rows($q$DELETE FROM produccion WHERE folio = 'OP-77FIX'$q$) = 0, p_tag || ': DELETE directo de produccion no afecta filas');
END $$;
GRANT EXECUTE ON FUNCTION t77_intentos(TEXT) TO anon, authenticated;

\echo '── 077: estado físico'
SELECT t77_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND ((tablename = 'productos' AND policyname = 'produccion_update') OR (tablename = 'inventario_mov' AND policyname = 'insert_roles') OR (tablename = 'produccion' AND policyname IN ('produccion_update', 'produccion_write')))), '077-01 las 4 policies obsoletas no existen');
SELECT t77_assert((SELECT bool_and(pol = 'admin_all,read_all') FROM (SELECT string_agg(policyname, ',' ORDER BY policyname) pol FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('productos', 'inventario_mov', 'produccion') GROUP BY tablename) x)
  AND (SELECT count(DISTINCT tablename) = 3 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('productos', 'inventario_mov', 'produccion')), '077-02 quedan solo admin_all y read_all en las 3 tablas');
SELECT t77_assert((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.productos'::regclass, 'public.inventario_mov'::regclass, 'public.produccion'::regclass)), '077-03 RLS físico activo');

\echo '── 077: escritura directa denegada (no Admin)'
BEGIN; SET LOCAL ROLE anon; SELECT t77_actor('anon', NULL, NULL);
DO $do$ DECLARE n BIGINT; BEGIN
  BEGIN n := t77_rows($q$UPDATE productos SET stock = 1 WHERE sku = 'P77-BOLSA'$q$); EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  PERFORM t77_assert(n = 0, '077-10 anon: UPDATE productos no afecta filas (o sin privilegio tras 090)');
END $do$;
SELECT t77_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad) VALUES ('Entrada', 'P77-BOLSA', 1)$q$, '077-11 anon: INSERT kardex denegado', '42501');
SELECT t77_err($q$INSERT INTO produccion (turno, maquina, sku, cantidad) VALUES ('T', 'M', 'P77-HIELO', 1)$q$, '077-12 anon: INSERT produccion denegado', '42501');
ROLLBACK;
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('077-20 Producción', 'prod77@t', '77000000-0000-0000-0000-000000000002'),
      ('077-21 Ventas', 'ventas77@t', '77000000-0000-0000-0000-000000000003'),
      ('077-22 Chofer', 'chofer77@t', '77000000-0000-0000-0000-000000000004'),
      ('077-23 Almacén Bolsas', 'bolsas77@t', '77000000-0000-0000-0000-000000000005'),
      ('077-24 Facturación', 'fact77@t', '77000000-0000-0000-0000-000000000006'),
      ('077-25 Producción INACTIVO', 'inprod77@t', '77000000-0000-0000-0000-000000000008'),
      ('077-26 JWT sin perfil', 'noprof77@t', '77000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t77_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t77_intentos(a.tag);
    RESET ROLE;
    PERFORM t77_assert(t77_huella() = (SELECT v FROM t77_ids WHERE k = 'h0'), a.tag || ': cero efectos de negocio');
  END LOOP;
END $$;

\echo '── 077: Producción — escritura directa denegada Y contratos 076 funcionan'
BEGIN; SET LOCAL ROLE authenticated; SELECT t77_actor('authenticated', 'prod77@t', '77000000-0000-0000-0000-000000000002');
SELECT t77_err(format($q$SELECT rename_sku(%s, 'P77-HIELO', 'P77-HIELO2')$q$, (SELECT id FROM productos WHERE sku = 'P77-HIELO')), '077-30 Producción: rename_sku denegado', '42501');
INSERT INTO t77_ids VALUES ('p1', registrar_produccion('77000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 30', 'P77-HIELO', 6, 'CF-77')::text);
INSERT INTO t77_ids VALUES ('p1r', registrar_produccion('77000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 30', 'P77-HIELO', 6, 'CF-77')::text);
SELECT t77_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P77-HIELO', 99, 'CF-77')$q$, '077-31 empaque insuficiente: rechazo completo', 'P0001');
INSERT INTO t77_ids VALUES ('t1', registrar_transformacion('77000000-0000-0000-0000-00000000b001', 'P77-BARRA', 8, 'P77-TRIT', 6, 'CF-77')::text);
SELECT t77_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P77-BARRA', 50, 'P77-TRIT', 40, 'CF-77')$q$, '077-32 insumo insuficiente: rechazo completo', 'P0001');
COMMIT;
SELECT t77_assert(((SELECT v FROM t77_ids WHERE k = 'p1')::jsonb ->> 'actor') = 'Prod 77' AND NOT ((SELECT v FROM t77_ids WHERE k = 'p1')::jsonb ->> 'replay')::boolean
  AND ((SELECT v FROM t77_ids WHERE k = 'p1r')::jsonb ->> 'replay')::boolean, '077-33 registrar_produccion: éxito con actor real; reintento = replay');
SELECT t77_assert(t77_stock('P77-BOLSA') = 14 AND (SELECT (stock ->> 'P77-HIELO')::int FROM cuartos_frios WHERE id = 'CF-77') = 6, '077-34 empaque 20 → 14 (un solo consumo), cuarto +6');
SELECT t77_assert((SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P77-BOLSA' AND tipo = 'Salida' AND usuario = 'Prod 77') AND (SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P77-HIELO' AND tipo = 'Entrada' AND usuario = 'Prod 77'), '077-35 kardex del servidor sigue generándose (sin la policy de INSERT)');
SELECT t77_assert((SELECT count(*) = CASE WHEN to_regprocedure('public.conciliacion_empaque()') IS NOT NULL THEN 0 ELSE 1 END AND bool_and(monto = 6 AND categoria = 'Costo de Ventas') IS NOT FALSE FROM movimientos_contables WHERE concepto LIKE '%P77-HIELO%') AND (SELECT count(*) = 1 FROM costos_historial WHERE concepto LIKE '%P77-HIELO%'), '077-36 egreso y costos_historial generados');
SELECT t77_assert(t77_stock('P77-BARRA') = 12 AND (SELECT (stock ->> 'P77-TRIT')::int FROM cuartos_frios WHERE id = 'CF-77') = 6 AND (SELECT count(*) = 1 FROM mermas WHERE sku = 'P77-BARRA' AND cantidad = 2 AND NOT afecta_stock), '077-37 registrar_transformacion: insumo 20 → 12, output 6, merma de proceso 2');
SELECT t77_assert((SELECT count(*) = 2 FROM produccion WHERE sku LIKE 'P77-%' AND operacion_id IS NOT NULL), '077-38 las filas de producción las crean solo las RPCs (fallidas: ninguna)');

\echo '── 077: Admin intacto'
BEGIN; SET LOCAL ROLE authenticated; SELECT t77_actor('authenticated', 'admin77@t', '77000000-0000-0000-0000-000000000001');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('X77-ADMIN', 'Alta Admin', 'Producto Terminado', 10, 0);
SELECT t77_assert(t77_rows($q$UPDATE productos SET precio = 11, stock_minimo = 5 WHERE sku = 'X77-ADMIN'$q$) = 1, '077-40 Admin: alta y edición de producto');
SELECT t77_assert(t77_rows($q$DELETE FROM productos WHERE sku = 'X77-ADMIN'$q$) = 1, '077-41 Admin: baja de producto');
SELECT t77_assert(t77_rows($q$UPDATE productos SET stock = 25 WHERE sku = 'P77-BARRA'$q$) = 1, '077-42 Admin: ajuste manual de stock');
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Entrada', 'P77-BARRA', 13, 'Ajuste manual', 'Admin 77');
SELECT t77_assert(t77_rows($q$UPDATE produccion SET turno = 'Turno 2' WHERE folio = 'OP-77FIX'$q$) = 1, '077-43 Admin: edición de producción');
SELECT t77_assert(t77_rows($q$DELETE FROM produccion WHERE folio = 'OP-77FIX'$q$) = 1, '077-44 Admin: borrado de producción');
SELECT rename_sku((SELECT id FROM productos WHERE sku = 'P77-TRIT'), 'P77-TRIT', 'P77-TRIT2');
COMMIT;
SELECT t77_assert((SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P77-BARRA' AND origen = 'Ajuste manual'), '077-45 Admin: kardex del ajuste manual');
SELECT t77_assert(EXISTS (SELECT 1 FROM productos WHERE sku = 'P77-TRIT2') AND (SELECT (stock ->> 'P77-TRIT2')::int FROM cuartos_frios WHERE id = 'CF-77') = 6, '077-46 Admin: rename_sku sigue funcionando (cascada al cuarto)');

\echo '── 077: deuda B3 documentada (sin cambios en esta fase)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t77_actor('authenticated', 'inadm77@t', '77000000-0000-0000-0000-000000000007');
SELECT t77_assert(t77_rows($q$UPDATE productos SET nombre = nombre WHERE sku = 'P77-BOLSA'$q$) = (CASE WHEN pg_get_functiondef('public.get_my_rol()'::regprocedure) ~ 'erp_rol_activo' THEN 0 ELSE 1 END), '077-50 Admin INACTIVO: escribe vía admin_all con get_my_rol legacy (deuda B3) o 0 filas tras 079 (identidad canónica)');
ROLLBACK;

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P77-%');
DELETE FROM mermas WHERE sku LIKE 'P77-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P77-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P77-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P77-%' OR producto LIKE 'X77-%';
DELETE FROM produccion WHERE sku LIKE 'P77-%';
DELETE FROM cuartos_frios WHERE id = 'CF-77';
DELETE FROM productos WHERE sku LIKE 'P77-%' OR sku LIKE 'X77-%';
DELETE FROM auditoria WHERE detalle LIKE '%P77-%';
DELETE FROM usuarios WHERE id BETWEEN 7701 AND 7709;
DELETE FROM auth.users WHERE id::text LIKE '77000000-%';
COMMIT;
\echo '── 077: TODAS LAS PRUEBAS OK'
