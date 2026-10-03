-- 106_costo_empaque_test.sql — costo de empaque por promedio ponderado
-- (forward-only), base contable sin cambio: compra recalcula el promedio en la
-- misma transacción (idempotente), producción hace snapshot, el reverso usa el
-- costo guardado, el catálogo no edita costos y la merma de producto terminado
-- no se valúa.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t106_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_empaque_historial WHERE sku LIKE 'P106-%';
  DELETE FROM costos_historial WHERE concepto LIKE '%P106-%';
  DELETE FROM movimientos_contables WHERE concepto LIKE '%P106-%' OR referencia IN (SELECT 'recepcion_compra/' || operacion_id FROM stock_operaciones WHERE operacion_id::text LIKE '10600000-%');
  DELETE FROM cuentas_por_pagar WHERE proveedor = 'Prov 106';
  DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P106-%'); DELETE FROM mermas WHERE sku LIKE 'P106-%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P106-%';
  DELETE FROM produccion WHERE sku LIKE 'P106-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '10600000-%';
  DELETE FROM auditoria WHERE usuario LIKE '% 106';
  DELETE FROM cuartos_frios WHERE id = 'CF-106';
  DELETE FROM productos WHERE sku LIKE 'P106-%';
  DELETE FROM usuarios WHERE id BETWEEN 10601 AND 10609;
  DELETE FROM auth.users WHERE id::text LIKE '10600000-%';
END $$;

BEGIN; SELECT t106_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('10600000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t106' FROM generate_series(1, 4) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10601, 'Admin 106',  'u1@t106', 'Admin',          'Activo', '10600000-0000-0000-0000-000000000001'),
  (10602, 'Bolsas 106', 'u2@t106', 'Almacén Bolsas', 'Activo', '10600000-0000-0000-0000-000000000002'),
  (10603, 'Prod 106',   'u3@t106', 'Producción',     'Activo', '10600000-0000-0000-0000-000000000003'),
  (10604, 'Ventas 106', 'u4@t106', 'Ventas',         'Activo', '10600000-0000-0000-0000-000000000004');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-106', 'Cuarto 106', '{}');
COMMIT;
-- Altas por SQL de confianza (con triggers): el empaque deja su apertura declarada.
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P106-EMP',  'Bolsa 106',       'Empaque', 0, 100, 2, NULL),
  ('P106-EMP2', 'Bolsa vacía 106', 'Empaque', 0, 0,   9, NULL);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P106-HIELO', 'Hielo 106',  'Producto Terminado', 30, 0, 0, 'P106-EMP'),
  ('P106-HV',    'Hielo V 106','Producto Terminado', 30, 0, 0, NULL);

CREATE OR REPLACE FUNCTION t106_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10600000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t106_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t106_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t106_p(p_sku TEXT) RETURNS RECORD LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock, costo_unitario FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t106_st(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t106_avg(p_sku TEXT) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER AS $$ SELECT costo_unitario FROM productos WHERE sku = p_sku $$;
GRANT EXECUTE ON FUNCTION t106_actor(INTEGER), t106_assert(BOOLEAN, TEXT), t106_err(TEXT, TEXT, TEXT, TEXT), t106_st(TEXT), t106_avg(TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t106_ids;
CREATE TEMP TABLE t106_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t106_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t106_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t106_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t106_j(TEXT) TO PUBLIC;

\echo '── 106: historial y apertura'
SELECT t106_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.costos_empaque_historial'::regclass)
  AND has_table_privilege('authenticated', 'public.costos_empaque_historial', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'DELETE') AND NOT has_table_privilege('anon', 'public.costos_empaque_historial', 'SELECT'),
  '106-01 historial de costo: RLS, solo lectura para la API');
SELECT t106_assert((SELECT bool_and(n = 1) FROM (SELECT count(*) FILTER (WHERE h.evento = 'Apertura') AS n FROM productos p LEFT JOIN costos_empaque_historial h ON h.producto_id = p.id WHERE p.tipo = 'Empaque' GROUP BY p.id) x),
  '106-02 cada empaque tiene exactamente una apertura declarada');
SELECT t106_assert((SELECT cantidad_nueva = 100 AND costo_nuevo = 2 AND operacion_id IS NULL AND cantidad_recibida IS NULL AND total_factura IS NULL
                    FROM costos_empaque_historial WHERE sku = 'P106-EMP' AND evento = 'Apertura'),
  '106-03 apertura: existencia y costo declarados, sin compra (no es una factura)');

\echo '── 106: compra de contado (100 @ 2 + 100 por 600 → 200 @ 4)'
INSERT INTO t106_ids VALUES ('mc0', (SELECT count(*) FROM movimientos_contables)::text), ('cxp0', (SELECT count(*) FROM cuentas_por_pagar)::text), ('ch0', (SELECT count(*) FROM costos_historial)::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(2);
INSERT INTO t106_ids VALUES ('c1', registrar_recepcion_compra('10600000-0000-0000-0000-00000000c001', 'P106-EMP', 100, 600, 'Prov 106', false)::text);
INSERT INTO t106_ids VALUES ('c1r', registrar_recepcion_compra('10600000-0000-0000-0000-00000000c001', 'P106-EMP', 100, 600, 'Prov 106', false)::text);
SELECT t106_err($q$SELECT registrar_recepcion_compra('10600000-0000-0000-0000-00000000c001', 'P106-EMP', 100, 700, 'Prov 106', false)$q$, '106-10 misma operación con otro total: rechazada', '23505');
COMMIT;
SELECT t106_assert(t106_st('P106-EMP') = 200 AND t106_avg('P106-EMP') = 4 AND (t106_j('c1') ->> 'costo_promedio')::numeric = 4 AND (t106_j('c1') ->> 'costo_promedio_anterior')::numeric = 2
  AND (t106_j('c1r') ->> 'replay') = 'true' AND (t106_j('c1r') ->> 'costo_promedio')::numeric = 4,
  '106-11 existencia 200 y promedio 4; el reintento es replay (no recalcula)');
SELECT t106_assert((SELECT count(*) = 1 AND bool_and(evento = 'Compra' AND cantidad_anterior = 100 AND costo_anterior = 2 AND cantidad_recibida = 100 AND total_factura = 600
                      AND cantidad_nueva = 200 AND costo_nuevo = 4 AND actor = 'Bolsas 106' AND actor_id = 10602)
                    FROM costos_empaque_historial WHERE operacion_id = '10600000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) FROM movimientos_contables)::text = (SELECT (v::int + 1)::text FROM t106_ids WHERE k = 'mc0')
  AND (SELECT count(*) = 1 AND bool_and(monto = 600 AND categoria = 'Proveedores') FROM movimientos_contables WHERE referencia = 'recepcion_compra/10600000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) FROM cuentas_por_pagar)::text = (SELECT v FROM t106_ids WHERE k = 'cxp0')
  AND (SELECT count(*) FROM costos_historial)::text = (SELECT v FROM t106_ids WHERE k = 'ch0'),
  '106-12 una transición 2 → 4 con factura, cantidades, operación y actor; un egreso de 600; sin CxP; el promedio no es costo del periodo');

\echo '── 106: compra a crédito sin existencia previa y precisión'
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(1);
INSERT INTO t106_ids VALUES ('c2', registrar_recepcion_compra('10600000-0000-0000-0000-00000000c002', 'P106-EMP2', 50, 350, 'Prov 106', true)::text);
INSERT INTO t106_ids VALUES ('c3', registrar_recepcion_compra('10600000-0000-0000-0000-00000000c003', 'P106-EMP2', 3, 10, 'Prov 106', true)::text);
COMMIT;
SELECT t106_assert((t106_j('c2') ->> 'costo_promedio')::numeric = 7 AND (t106_j('c2') ->> 'costo_promedio_anterior')::numeric = 9
  AND (SELECT count(*) = 2 AND sum(monto_original) = 360 FROM cuentas_por_pagar WHERE proveedor = 'Prov 106')
  AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE referencia IN ('recepcion_compra/10600000-0000-0000-0000-00000000c002', 'recepcion_compra/10600000-0000-0000-0000-00000000c003')),
  '106-20 sin existencia previa el promedio es el de la compra (350/50 = 7, no arrastra el 9); a crédito: CxP, sin egreso');
SELECT t106_assert(t106_avg('P106-EMP2') = round(360::numeric / 53, 6) AND t106_avg('P106-EMP2') = 6.792453 AND t106_st('P106-EMP2') = 53,
  '106-21 precisión: (50×7 + 10)/53 = 6.792453 (6 decimales almacenados)');

\echo '── 106: producción con el promedio y reverso con lo guardado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(3);
INSERT INTO t106_ids VALUES ('p1', registrar_produccion('10600000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 106', 'P106-HIELO', 10, 'CF-106')::text);
COMMIT;
SELECT t106_assert((SELECT costo_empaque = 4 AND costo_total = 40 FROM produccion WHERE id = (t106_j('p1') ->> 'id')::bigint) AND t106_st('P106-EMP') = 190
  AND (SELECT count(*) = 1 AND bool_and(monto = 40 AND tipo = 'Producción') FROM costos_historial WHERE referencia = 'PROD-' || (t106_j('p1') ->> 'id')),
  '106-30 producción de 10 con promedio 4: snapshot 4 / 40, empaque −10, un costo de producción de 40');
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(2);
SELECT registrar_recepcion_compra('10600000-0000-0000-0000-00000000c004', 'P106-EMP', 10, 160, NULL, false);
COMMIT;
SELECT t106_assert(t106_avg('P106-EMP') = round((190 * 4 + 160)::numeric / 200, 6) AND (SELECT costo_empaque = 4 AND costo_total = 40 FROM produccion WHERE id = (t106_j('p1') ->> 'id')::bigint),
  '106-31 una compra posterior cambia el promedio (4.6) pero la producción conserva 4 / 40');
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(1);
INSERT INTO t106_ids VALUES ('rv', revertir_produccion('10600000-0000-0000-0000-00000000a002', (t106_j('p1') ->> 'id')::bigint, 'prueba de reverso 106')::text);
COMMIT;
SELECT t106_assert((SELECT count(*) = 1 AND bool_and(monto = 40) FROM costos_historial WHERE tipo = 'Reverso producción' AND referencia = 'PROD-' || (t106_j('p1') ->> 'id') || '/reverso'),
  '106-32 reverso: compensa exactamente el costo guardado (40), no el promedio vigente');

\echo '── 106: catálogo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(1);
SELECT t106_err($q$UPDATE productos SET costo_unitario = 9 WHERE sku = 'P106-EMP'$q$, '106-40 Admin: editar el costo del empaque por catálogo, negado', '42501', '%recepción de compra%');
SELECT t106_err($q$UPDATE productos SET costo_unitario = 5 WHERE sku = 'P106-HIELO'$q$, '106-41 Admin: poner costo a producto terminado, negado', '42501');
SELECT t106_err($q$UPDATE productos SET tipo = 'Producto Terminado' WHERE sku = 'P106-EMP'$q$, '106-42 un empaque no cambia de tipo', '42501');
UPDATE productos SET nombre = 'Bolsa 106 renombrada', precio = 1, stock_minimo = 5 WHERE sku = 'P106-EMP';
UPDATE productos SET nombre = 'Hielo 106 B', precio = 31 WHERE sku = 'P106-HIELO';
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P106-PT2', 'Hielo nuevo 106', 'Producto Terminado', 10, 0, 55);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P106-EMP3', 'Bolsa nueva 106', 'Empaque', 0, 0, 3);
COMMIT;
SELECT t106_assert((SELECT nombre = 'Bolsa 106 renombrada' AND costo_unitario = round((190 * 4 + 160)::numeric / 200, 6) FROM productos WHERE sku = 'P106-EMP')
  AND (SELECT costo_unitario = 0 FROM productos WHERE sku = 'P106-PT2')
  AND (SELECT count(*) = 1 AND bool_and(evento = 'Apertura' AND costo_nuevo = 3 AND actor = 'Admin 106') FROM costos_empaque_historial WHERE sku = 'P106-EMP3'),
  '106-43 metadatos editables; producto terminado nace con costo 0; empaque nuevo deja su apertura declarada');

\echo '── 106: merma de producto terminado sin valuación'
BEGIN; SET LOCAL session_replication_role = replica;
UPDATE productos SET costo_unitario = 5 WHERE sku = 'P106-HV';   -- costo heredado (fixture de confianza)
UPDATE cuartos_frios SET stock = '{"P106-HV": 20}' WHERE id = 'CF-106';
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t106_actor(3);
INSERT INTO t106_ids VALUES ('m1', registrar_merma_cuarto('10600000-0000-0000-0000-00000000b001', 'CF-106', 'P106-HV', 4, 'Bolsa rota')::text);
COMMIT;
SELECT t106_assert((t106_j('m1') ->> 'mov_contable_id') IS NULL AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE referencia = 'MERMA-' || (t106_j('m1') ->> 'id'))
  AND (SELECT (stock ->> 'P106-HV')::int = 16 FROM cuartos_frios WHERE id = 'CF-106')
  AND pg_get_functiondef('public.registrar_merma(text,integer,text,text,text,bigint,boolean)'::regprocedure) ~ 'v_costo := 0;'
  AND pg_get_functiondef('public.registrar_merma_cuarto(uuid,text,text,integer,text,text)'::regprocedure) ~ 'v_costo := 0;',
  '106-50 merma de cuarto: descuenta el cuarto (102), sin egreso aunque el catálogo traiga costo; ruta y cuarto sin valuación de producto terminado');

BEGIN; SELECT t106_limpiar(); COMMIT;
\echo '── 106: TODAS LAS PRUEBAS OK'
