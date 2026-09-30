-- 095_cliente_obsoleto_test.sql — el borrado de producción del frontend
-- anterior a 094 (reverso FIFO por update_stocks_atomic + DELETE + empaque
-- por update_productos_stock_atomic) ya no produce ningún efecto. La
-- devolución de cliente, el reverso canónico, el ajuste de existencia y las
-- operaciones de cuarto siguen funcionando.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t95_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_historial WHERE concepto LIKE '%P95-%';
  DELETE FROM auditoria WHERE detalle LIKE '%P95-%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P95-%';
  DELETE FROM produccion WHERE sku LIKE 'P95-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '95000000-%';
  DELETE FROM cuartos_frios WHERE id IN ('CF-95A', 'CF-95B');
  DELETE FROM productos WHERE sku LIKE 'P95-%';
  DELETE FROM usuarios WHERE id BETWEEN 9501 AND 9509;
  DELETE FROM auth.users WHERE id::text LIKE '95000000-%';
END $$;

BEGIN; SELECT t95_limpiar(); COMMIT;
BEGIN;
INSERT INTO auth.users (id, email) SELECT ('95000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t95' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9501, 'Admin 95', 'u1@t95', 'Admin',      'Activo', '95000000-0000-0000-0000-000000000001'),
  (9502, 'Prod 95',  'u2@t95', 'Producción', 'Activo', '95000000-0000-0000-0000-000000000002'),
  (9503, 'Ventas 95','u3@t95', 'Ventas',     'Activo', '95000000-0000-0000-0000-000000000003');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P95-EMP', 'Bolsa 95', 'Empaque', 0, 200, 2, NULL),
  ('P95-H',   'Hielo 95', 'Producto Terminado', 30, 0, 0, 'P95-EMP');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-95A', 'Cuarto 95 A', '{}'::jsonb), ('CF-95B', 'Cuarto 95 B', '{"P95-H": 40}'::jsonb);
COMMIT;

CREATE OR REPLACE FUNCTION t95_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '95000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t95_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t95_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
-- Huella de todo lo que el flujo viejo podía tocar.
CREATE OR REPLACE FUNCTION t95_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|',
    (SELECT string_agg(id || ':' || stock::text, ',' ORDER BY id) FROM cuartos_frios WHERE id IN ('CF-95A', 'CF-95B')),
    (SELECT string_agg(sku || ':' || stock, ',' ORDER BY sku) FROM productos WHERE sku LIKE 'P95-%'),
    (SELECT string_agg(concat_ws(':', id, estatus, cantidad, cuarto_id, empaque_sku, empaque_cantidad, costo_total, revertida_at), ',' ORDER BY id) FROM produccion WHERE sku LIKE 'P95-%'),
    (SELECT count(*) FROM costos_historial WHERE concepto LIKE '%P95-%'),
    (SELECT count(*) FROM inventario_mov WHERE producto LIKE 'P95-%'))
$$;
GRANT EXECUTE ON FUNCTION t95_actor(INTEGER), t95_assert(BOOLEAN, TEXT), t95_err(TEXT, TEXT, TEXT, TEXT), t95_huella() TO PUBLIC;
DROP TABLE IF EXISTS t95_ids;
CREATE TEMP TABLE t95_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t95_ids TO anon, authenticated, service_role;

\echo '── 095: estado físico'
SELECT t95_assert(NOT has_function_privilege('authenticated', 'public.update_productos_stock_atomic(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.update_productos_stock_atomic(jsonb)', 'EXECUTE'), '095-01 update_productos_stock_atomic sin EXECUTE para authenticated; service_role lo conserva');
SELECT t95_assert(has_function_privilege('authenticated', 'public.update_stocks_atomic(jsonb)', 'EXECUTE')
  AND pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'solo se permiten entradas a cuarto', '095-02 update_stocks_atomic sigue disponible solo para entradas desde la aplicación');

\echo '── 095: producción del contrato (fixture)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(2);
INSERT INTO t95_ids VALUES ('p1', registrar_produccion('95000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 95', 'P95-H', 30, 'CF-95A')::text);
COMMIT;
INSERT INTO t95_ids VALUES ('h0', t95_huella());

\echo '── 095: el borrado de producción del frontend anterior a 094 no tiene efecto'
-- Paso 1 del flujo viejo: reverso FIFO (cuartos en orden de id con existencia).
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(1);
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95A","sku":"P95-H","delta":-30,"tipo":"Reverso producción","origen":"Reverso OP","usuario":"Admin 95"}]'::jsonb)$q$,
  '095-10 paso 1 (reverso FIFO del cuarto): denegado', '42501', '%solo se permiten entradas%');
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95A","sku":"P95-H","delta":-20,"tipo":"Reverso producción"},{"cuarto_id":"CF-95B","sku":"P95-H","delta":-10,"tipo":"Reverso producción"}]'::jsonb)$q$,
  '095-11 reverso FIFO en dos cuartos: denegado completo', '42501');
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":5},{"cuarto_id":"CF-95A","sku":"P95-H","delta":-5}]'::jsonb)$q$,
  '095-12 lote mixto (una entrada y una salida): denegado completo antes de tocar nada', '42501');
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95A","sku":"P95-H","delta":0}]'::jsonb)$q$, '095-13 delta 0: denegado', '42501');
-- Paso 2: DELETE de la producción.
SELECT t95_err(format($q$DELETE FROM produccion WHERE id = %s$q$, (SELECT v::jsonb ->> 'id' FROM t95_ids WHERE k = 'p1')), '095-14 paso 2 (DELETE de producción): denegado', '42501');
-- Paso 3 (solo corría si el DELETE funcionaba): devolución de empaque.
SELECT t95_err($q$SELECT update_productos_stock_atomic('[{"sku":"P95-EMP","delta":30,"tipo":"Entrada","origen":"Reverso producción OP"}]'::jsonb)$q$, '095-15 paso 3 (empaque por RPC genérico): sin EXECUTE', '42501');
COMMIT;
SELECT t95_assert(t95_huella() = (SELECT v FROM t95_ids WHERE k = 'h0'), '095-16 sin ningún efecto: cuartos, empaque, producción, costo y kardex idénticos');

\echo '── 095: flujos vigentes intactos'
-- Devolución de cliente: entrada al cuarto (único llamador vigente del RPC).
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(1);
SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":4,"tipo":"Devolución cliente","origen":"Devolución OV-95","usuario":"Admin 95"}]'::jsonb);
COMMIT;
SELECT t95_assert((SELECT (stock ->> 'P95-H')::int = 44 FROM cuartos_frios WHERE id = 'CF-95B')
  AND (SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P95-H' AND tipo = 'Devolución cliente' AND cantidad = 4), '095-20 devolución de cliente (Admin): entrada al cuarto con kardex');
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(2);
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":1}]'::jsonb)$q$, '095-21 Producción: RPC genérico denegado (sin cambio)', '42501', '%no autorizado%');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(3);
SELECT t95_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":1}]'::jsonb)$q$, '095-22 Ventas: RPC genérico denegado (sin cambio)', '42501', '%no autorizado%');
ROLLBACK;
-- Reverso canónico de la misma producción.
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(1);
INSERT INTO t95_ids VALUES ('r1', revertir_produccion('95000000-0000-0000-0000-00000000b001', (SELECT (v::jsonb ->> 'id')::bigint FROM t95_ids WHERE k = 'p1'), 'captura duplicada')::text);
COMMIT;
SELECT t95_assert((SELECT (stock ->> 'P95-H')::int = 0 FROM cuartos_frios WHERE id = 'CF-95A') AND (SELECT stock = 200 FROM productos WHERE sku = 'P95-EMP')
  AND (SELECT estatus = 'Revertida' FROM produccion WHERE id = (SELECT (v::jsonb ->> 'id')::bigint FROM t95_ids WHERE k = 'p1'))
  AND (SELECT count(*) = 1 FROM costos_historial WHERE tipo = 'Reverso producción' AND concepto LIKE '%P95-H%'), '095-23 revertir_produccion sigue funcionando (cuarto original −30, empaque +30, costo compensatorio)');
-- Ajuste manual de existencia y operación de cuarto (REST del ajuste por cuarto).
BEGIN; SET LOCAL ROLE authenticated; SELECT t95_actor(1);
INSERT INTO t95_ids VALUES ('aj', ajustar_existencia('95000000-0000-0000-0000-00000000c001', 'P95-EMP', 190, 'conteo 095')::text);
UPDATE cuartos_frios SET stock = jsonb_set(stock, '{P95-H}', '43') WHERE id = 'CF-95B';
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Salida', 'P95-H', 1, 'Ajuste Cuarto 95 B: conteo', 'Admin 95');
COMMIT;
SELECT t95_assert((SELECT stock = 190 FROM productos WHERE sku = 'P95-EMP') AND (SELECT (stock ->> 'P95-H')::int = 43 FROM cuartos_frios WHERE id = 'CF-95B')
  AND (SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P95-H' AND origen = 'Ajuste Cuarto 95 B: conteo'), '095-24 ajuste de existencia y ajuste por cuarto siguen funcionando');
-- Autoridades de confianza: service_role y SQL conservan salidas por el RPC.
BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":-3,"tipo":"Salida","origen":"mantenimiento 95"}]'::jsonb);
SELECT update_productos_stock_atomic('[{"sku":"P95-EMP","delta":-5,"tipo":"Salida","origen":"mantenimiento 95"}]'::jsonb);
COMMIT;
SELECT update_stocks_atomic('[{"cuarto_id":"CF-95B","sku":"P95-H","delta":-2,"tipo":"Salida","origen":"sql 95"}]'::jsonb);
SELECT t95_assert((SELECT (stock ->> 'P95-H')::int = 38 FROM cuartos_frios WHERE id = 'CF-95B') AND (SELECT stock = 185 FROM productos WHERE sku = 'P95-EMP'), '095-25 service_role y SQL: salidas por los RPC genéricos siguen disponibles');

BEGIN; SELECT t95_limpiar(); COMMIT;
\echo '── 095: TODAS LAS PRUEBAS OK'
