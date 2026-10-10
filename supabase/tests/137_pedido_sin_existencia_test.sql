-- 137_pedido_sin_existencia_test.sql — un pedido que se surte después se levanta
-- aunque no haya existencia; mostrador y los clientes anteriores siguen igual; la
-- entrega física sigue exigiendo el producto.
-- Todo dentro de UNA transacción con ROLLBACK: no deja nada en la base.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE cuartos_frios SET stock = COALESCE(stock, '{}'::jsonb) - 'HIB-50K' - 'HIB-25K' - 'HIP-25K' - 'HIT-25K';
DELETE FROM productos WHERE sku IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K', 'T137-EMP', 'T137-X', 'T137-Y');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('T137-EMP', 'Bolsa 137', 'Empaque', 0, 5, 2, NULL),
  ('T137-X',   'Hielo 137 X', 'Producto Terminado', 30, 0, 0, NULL),
  ('T137-Y',   'Hielo 137 Y', 'Producto Terminado', 50, 0, 0, NULL),
  ('HIB-50K', 'Barra de hielo ~50 kg', 'Producto Terminado', 120, 0, 0, NULL),
  ('HIB-25K', 'Media barra de hielo ~25 kg', 'Producto Terminado', 60, 0, 0, NULL),
  ('HIP-25K', 'Picada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T137-EMP'),
  ('HIT-25K', 'Triturada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T137-EMP');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-T137', 'Cuarto 137', '{"HIB-50K": 1, "T137-X": 10}'), ('CF-T137B', 'Cuarto 137 B', '{"T137-X": 5}');
INSERT INTO auth.users (id, email) VALUES ('13700000-0000-0000-0000-000000000001', 'a@t137'), ('13700000-0000-0000-0000-000000000002', 'v@t137'), ('13700000-0000-0000-0000-000000000003', 'p@t137');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13701, 'Admin T137', 'a@t137', 'Admin', 'Activo', '13700000-0000-0000-0000-000000000001'),
  (13702, 'Ventas T137', 'v@t137', 'Ventas', 'Activo', '13700000-0000-0000-0000-000000000002'),
  (13703, 'Prod T137', 'p@t137', 'Producción', 'Activo', '13700000-0000-0000-0000-000000000003');
INSERT INTO clientes (id, nombre, rfc, calle, colonia, credito_autorizado, limite_credito, saldo) VALUES (13701, 'Cliente T137', 'XAXX010101000', 'Calle', 'Col', true, 100, 0);
SET LOCAL session_replication_role = origin;
INSERT INTO sucursales (cliente_id, nombre, es_principal) SELECT 13701, 'Principal', true WHERE NOT EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = 13701);

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_like TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_err NOT ILIKE p_like THEN RAISE EXCEPTION 'FAIL: % (error inesperado: %)', p_msg, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.como(p_k INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"13700000-0000-0000-0000-00000000000' || p_k || '"}', true)::void $$;
-- La auditoría no la lee Ventas: se consulta con los privilegios de quien corre la prueba.
CREATE OR REPLACE FUNCTION pg_temp.aud(p_folio TEXT) RETURNS TABLE (n BIGINT, usuario TEXT, detalle TEXT) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*), max(a.usuario), max(a.detalle) FROM public.auditoria a WHERE a.accion = 'Pedido sin existencia' AND a.modulo = 'Órdenes' AND a.detalle LIKE p_folio || '%' $$;
CREATE TEMP TABLE t137 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t137 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t137 WHERE k = p_k $$;

\echo '── 137: catálogo'
SELECT pg_temp.ok((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.crear_orden(jsonb,jsonb)'::regprocedure)
  AND (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'crear_orden' AND pronamespace = 'public'::regnamespace),
  '137-01 crear_orden conserva firma, SECURITY DEFINER, search_path y permisos (sin anon)');

SET LOCAL ROLE authenticated;
SELECT pg_temp.como(2);

\echo '── 137: sin la bandera nada cambia (mostrador y clientes anteriores)'
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701}', '[{"sku":"T137-X","cantidad":16}]')$q$,
  '137-02 más de lo que hay (15 en dos cuartos): rechazada como siempre', '%Stock insuficiente para T137-X (disponible: 15, pedido: 16)%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701, "permitir_sin_stock": false}', '[{"sku":"T137-Y","cantidad":1}]')$q$,
  '137-03 bandera en falso = sin bandera', '%Stock insuficiente para T137-Y%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701}', '[{"sku":"HIP-25K","cantidad":3}]')$q$,
  '137-04 la regla de la barra sigue rechazando sin la bandera', '%Stock insuficiente de barra%');
INSERT INTO t137 VALUES ('o0', crear_orden('{"cliente_id": 13701}', '[{"sku":"T137-X","cantidad":15}]'));
SELECT pg_temp.ok(pg_temp.j('o0') -> 'faltantes' = '[]'::jsonb AND pg_temp.j('o0') -> 'falta_barra' = 'null'::jsonb AND (pg_temp.j('o0') ->> 'total')::numeric = 450
  AND (SELECT n = 0 FROM pg_temp.aud(pg_temp.j('o0') ->> 'folio')),
  '137-05 con existencia: se crea igual que antes, sin faltantes ni línea de auditoría');

\echo '── 137: pedido que se surtirá después'
INSERT INTO t137 VALUES ('o1', crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"T137-X","cantidad":42},{"sku":"T137-Y","cantidad":3}]'));
SELECT pg_temp.ok(pg_temp.j('o1') ->> 'estatus' = 'Creada' AND (pg_temp.j('o1') ->> 'total')::numeric = 42 * 30 + 3 * 50
  AND pg_temp.j('o1') -> 'faltantes' = '[{"sku":"T137-X","pedido":42,"disponible":15,"falta":27},{"sku":"T137-Y","pedido":3,"disponible":0,"falta":3}]'::jsonb,
  '137-06 se crea Creada, con precio y total del servidor; faltantes por producto');
SELECT pg_temp.ok((SELECT n = 1 AND usuario LIKE '%Ventas T137%' AND detalle LIKE '%27 de T137-X, 3 de T137-Y%' FROM pg_temp.aud(pg_temp.j('o1') ->> 'folio')),
  '137-07 queda en auditoría quién comprometió el pedido y cuánto falta producir');
SELECT pg_temp.ok((SELECT stock ->> 'T137-X' = '10' FROM cuartos_frios WHERE id = 'CF-T137') AND (SELECT stock ->> 'T137-X' = '5' FROM cuartos_frios WHERE id = 'CF-T137B'),
  '137-08 levantar el pedido no mueve inventario (igual que antes)');
INSERT INTO t137 VALUES ('o2', crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"T137-X","cantidad":5}]'));
SELECT pg_temp.ok(pg_temp.j('o2') -> 'faltantes' = '[]'::jsonb
  AND (SELECT n = 0 FROM pg_temp.aud(pg_temp.j('o2') ->> 'folio')),
  '137-09 con la bandera pero con existencia: sin faltantes ni auditoría');
INSERT INTO t137 VALUES ('o3', crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"HIP-25K","cantidad":3},{"sku":"HIB-50K","cantidad":1}]'));
SELECT pg_temp.ok(pg_temp.j('o3') ->> 'falta_barra' LIKE 'Stock insuficiente de barra%' AND pg_temp.j('o3') -> 'faltantes' = '[]'::jsonb
  AND (SELECT n = 1 AND detalle LIKE '%Stock insuficiente de barra%' FROM pg_temp.aud(pg_temp.j('o3') ->> 'folio')),
  '137-10 barra: el pedido se crea y lo que falta de barra queda como aviso (misma regla de 133)');

\echo '── 137: lo demás no se relaja'
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true, "tipo_cobro": "Credito", "metodo_pago": "Crédito"}', '[{"sku":"T137-Y","cantidad":3}]')$q$,
  '137-11 el crédito se sigue validando (límite 100, pedido 150)', '%crédito%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"NO-EXISTE","cantidad":1}]')$q$,
  '137-12 un producto que no existe se sigue rechazando', '%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"T137-X","cantidad":0}]')$q$,
  '137-13 cantidad inválida se sigue rechazando', '%');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13701, "permitir_sin_stock": true}', '[{"sku":"T137-X","cantidad":1}]')$q$,
  '137-14 Producción no levanta pedidos (mismos roles de siempre)', '%no autorizado%');

\echo '── 137: el candado físico sigue en la entrega'
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT completar_venta_directa('13700000-0000-0000-0000-00000000e001', (SELECT (v ->> 'id')::bigint FROM t137 WHERE k = 'o1'), 'contado', 'Efectivo',
  '[{"sku":"T137-X","cuarto_id":"CF-T137","cantidad":42},{"sku":"T137-Y","cuarto_id":"CF-T137","cantidad":3}]')$q$,
  '137-15 el pedido sin existencia NO se puede entregar hasta que el producto exista', '%Stock insuficiente%');
SELECT pg_temp.ok((SELECT estatus = 'Creada' FROM ordenes WHERE id = (pg_temp.j('o1') ->> 'id')::bigint) AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id = (pg_temp.j('o1') ->> 'id')::bigint)
  AND (SELECT stock ->> 'T137-X' = '10' FROM cuartos_frios WHERE id = 'CF-T137'),
  '137-16 el rechazo no dejó nada a medias (orden Creada, sin pago, inventario intacto)');
-- Producción fabrica lo que faltaba: ya se puede entregar.
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE cuartos_frios SET stock = stock || '{"T137-X": 42, "T137-Y": 3}'::jsonb WHERE id = 'CF-T137';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(2);
INSERT INTO t137 VALUES ('e1', completar_venta_directa('13700000-0000-0000-0000-00000000e002', (SELECT (v ->> 'id')::bigint FROM t137 WHERE k = 'o1'), 'contado', 'Efectivo',
  '[{"sku":"T137-X","cuarto_id":"CF-T137","cantidad":42},{"sku":"T137-Y","cuarto_id":"CF-T137","cantidad":3}]'));
SELECT pg_temp.ok((SELECT estatus = 'Entregada' FROM ordenes WHERE id = (pg_temp.j('o1') ->> 'id')::bigint)
  AND (SELECT COALESCE((stock ->> 'T137-X')::int, 0) = 0 AND COALESCE((stock ->> 'T137-Y')::int, 0) = 0 FROM cuartos_frios WHERE id = 'CF-T137')
  AND (SELECT sum(monto) = 1410 FROM pagos WHERE orden_id = (pg_temp.j('o1') ->> 'id')::bigint),
  '137-17 ya producido: se entrega, se cobra y sale del cuarto');

ROLLBACK;
\echo '── 137: TODAS LAS PRUEBAS OK'
