-- 092_empaque_entrega_test.sql — semántica de empaque (Modelo A).
-- productos.stock del empaque = total de la empresa. Recepción suma, la
-- entrega a Producción es un evento sin efecto de stock, la producción es el
-- único consumo. Conciliación entrega vs uso desde fuentes independientes,
-- con la historia legada aparte. Contabilidad: una salida de dinero por
-- compra (contado) o por pago de la CxP (crédito); la producción solo
-- reconoce costo en costos_historial.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t92_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM costos_historial WHERE concepto LIKE '%P92-%' OR concepto LIKE 'T92%';
  DELETE FROM movimientos_contables WHERE concepto LIKE '%P92-%' OR concepto LIKE 'T92%' OR referencia LIKE 'recepcion_compra/92000000-%';
  DELETE FROM cuentas_por_pagar WHERE referencia LIKE 'recepcion_compra/92000000-%' OR concepto LIKE '%P92-%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P92-%';
  DELETE FROM produccion WHERE sku LIKE 'P92-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '92000000-%';
  UPDATE cuartos_frios SET stock = stock - 'P92-HIELO' - 'P92-SIN' WHERE stock ?| ARRAY['P92-HIELO', 'P92-SIN'];
  DELETE FROM cuartos_frios WHERE id = 'CF-92';
  DELETE FROM productos WHERE sku LIKE 'P92-%';
  DELETE FROM usuarios WHERE id BETWEEN 9201 AND 9209;
  DELETE FROM auth.users WHERE id::text LIKE '92000000-%';
END $$;

BEGIN;
SELECT t92_limpiar();
INSERT INTO auth.users (id, email)
  SELECT ('92000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t92' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9201, 'Admin 92',       'u1@t92', 'Admin',          'Activo',   '92000000-0000-0000-0000-000000000001'),
  (9202, 'Bolsas 92',      'u2@t92', 'Almacén Bolsas', 'Activo',   '92000000-0000-0000-0000-000000000002'),
  (9203, 'Prod 92',        'u3@t92', 'Producción',     'Activo',   '92000000-0000-0000-0000-000000000003'),
  (9204, 'Ventas 92',      'u4@t92', 'Ventas',         'Activo',   '92000000-0000-0000-0000-000000000004'),
  (9205, 'Bolsas Inac 92', 'u5@t92', 'Almacén Bolsas', 'Inactivo', '92000000-0000-0000-0000-000000000005');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P92-EMP',   'Bolsa 92',        'Empaque',            0,  100, 2,  NULL),
  ('P92-EMP2',  'Bolsa chica 92',  'Empaque',            0,  5,   1,  NULL),
  ('P92-MP',    'Barra 92',        'Materia Prima',      0,  50,  1,  NULL),
  ('P92-HIELO', 'Hielo 92',        'Producto Terminado', 30, 0,   0,  'P92-EMP'),
  ('P92-SIN',   'Hielo chico 92',  'Producto Terminado', 30, 0,   0,  'P92-EMP2');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-92', 'Cuarto 92', '{}'::jsonb);
COMMIT;

CREATE OR REPLACE FUNCTION t92_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '92000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t92_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t92_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t92_stock(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t92_conc(p_sku TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT x FROM jsonb_array_elements(conciliacion_empaque()) x WHERE x ->> 'sku' = p_sku $$;
GRANT EXECUTE ON FUNCTION t92_actor(INTEGER), t92_assert(BOOLEAN, TEXT), t92_err(TEXT, TEXT, TEXT, TEXT), t92_stock(TEXT), t92_conc(TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t92_ids;
CREATE TEMP TABLE t92_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t92_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t92_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t92_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t92_j(TEXT) TO PUBLIC;

\echo '── 092: estado físico'
SELECT t92_assert(pg_get_functiondef('public.registrar_salida_empaque(uuid,text,integer)'::regprocedure) !~* 'UPDATE\s+productos', '092-01 la entrega a Producción no actualiza productos.stock');
SELECT t92_assert(pg_get_functiondef('public.registrar_produccion(uuid,text,text,text,integer,text)'::regprocedure) !~* 'INSERT\s+INTO\s+movimientos_contables'
  AND pg_get_functiondef('public.registrar_produccion(uuid,text,text,text,integer,text)'::regprocedure) ~* 'INSERT\s+INTO\s+costos_historial', '092-02 producción: costos_historial sí, sin Egreso en movimientos_contables');
SELECT t92_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.conciliacion_empaque()'::regprocedure), '092-03 conciliacion_empaque: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');
SELECT t92_assert((SELECT bool_and(has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE'))
  FROM pg_proc WHERE oid IN ('public.registrar_salida_empaque(uuid,text,integer)'::regprocedure, 'public.registrar_produccion(uuid,text,text,text,integer,text)'::regprocedure)), '092-04 EXECUTE de los contratos intacto');

\echo '── 092: prueba numérica de aceptación (100 → +20 → entrega 30 → produce 10)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(2);
INSERT INTO t92_ids VALUES ('rc', registrar_recepcion_compra('92000000-0000-0000-0000-00000000a001', 'P92-EMP', 20, 40, 'Plásticos T92', false)::text);
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP') = 120, '092-10 recepción +20: total 120');
SELECT t92_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Egreso' AND categoria = 'Proveedores' AND monto = 40) FROM movimientos_contables WHERE referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a001')
  AND NOT EXISTS (SELECT 1 FROM cuentas_por_pagar WHERE referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a001'), '092-11 compra de contado: exactamente un Egreso Proveedores (40), sin CxP');
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(2);
INSERT INTO t92_ids VALUES ('en', registrar_salida_empaque('92000000-0000-0000-0000-00000000b001', 'P92-EMP', 30)::text);
INSERT INTO t92_ids VALUES ('enr', registrar_salida_empaque('92000000-0000-0000-0000-00000000b001', 'P92-EMP', 30)::text);
SELECT t92_err($q$SELECT registrar_salida_empaque('92000000-0000-0000-0000-00000000b001', 'P92-EMP', 31)$q$, '092-12 misma operación con otra cantidad: rechazada', '23505');
SELECT t92_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P92-MP', 5)$q$, '092-13 Materia Prima por la entrega de empaque: rechazada', '22023', '%no es empaque%');
SELECT t92_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P92-HIELO', 5)$q$, '092-14 producto terminado: rechazado', '22023', '%no es empaque%');
SELECT t92_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P92-EMP', 121)$q$, '092-15 entregar más que el total de la empresa: rechazado', 'P0001', '%Stock insuficiente%');
SELECT t92_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P92-EMP', 0)$q$, '092-16 cantidad 0: rechazada', '22023');
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP') = 120, '092-17 entrega 30: el total sigue en 120 (sin cambio de stock)');
SELECT t92_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Entrega a Producción' AND cantidad = 30 AND referencia = 'salida_empaque/P92-EMP' AND origen = 'Almacén de empaque' AND destino = 'Producción' AND usuario = 'Bolsas 92')
  FROM inventario_mov WHERE operacion_id = '92000000-0000-0000-0000-00000000b001'), '092-18 exactamente un evento durable de entrega (tipo propio, no Salida)');
SELECT t92_assert((t92_j('en') ->> 'evento') = 'entrega_produccion' AND (t92_j('enr') ->> 'replay') = 'true'
  AND (SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P92-EMP' AND tipo = 'Entrega a Producción'), '092-19 reintento de la entrega: replay, sin evento duplicado');
SELECT t92_assert(NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE referencia LIKE '%92000000-0000-0000-0000-00000000b001%' OR concepto LIKE '%Entrega%P92%')
  AND NOT EXISTS (SELECT 1 FROM cuentas_por_pagar WHERE concepto LIKE '%P92-EMP%' AND referencia NOT LIKE 'recepcion_compra/%')
  AND NOT EXISTS (SELECT 1 FROM costos_historial WHERE concepto LIKE '%P92-EMP%'), '092-20 la entrega no tiene efecto contable');
SELECT t92_assert(t92_stock('P92-MP') = 50, '092-21 la materia prima no se movió');

BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(3);
INSERT INTO t92_ids VALUES ('pr', registrar_produccion('92000000-0000-0000-0000-00000000c001', 'Turno 1', 'Máquina 92', 'P92-HIELO', 10, 'CF-92')::text);
INSERT INTO t92_ids VALUES ('prr', registrar_produccion('92000000-0000-0000-0000-00000000c001', 'Turno 1', 'Máquina 92', 'P92-HIELO', 10, 'CF-92')::text);
SELECT t92_err($q$SELECT registrar_produccion('92000000-0000-0000-0000-00000000c001', 'Turno 1', 'Máquina 92', 'P92-HIELO', 11, 'CF-92')$q$, '092-30 misma producción con otra cantidad: rechazada', '23505');
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP') = 110, '092-31 producción de 10: total 120 → 110 (único consumo)');
SELECT t92_assert((t92_j('prr') ->> 'replay') = 'true' AND (SELECT count(*) = 1 FROM produccion WHERE operacion_id = '92000000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) = 1 AND bool_and(cantidad = 10) FROM inventario_mov WHERE producto = 'P92-EMP' AND tipo = 'Salida'), '092-32 reintento de la producción: replay, sin segundo consumo');
SELECT t92_assert((SELECT empaque_sku = 'P92-EMP' AND empaque_cantidad = 10 AND costo_empaque = 2 AND costo_total = 20 AND mov_contable_id IS NULL
  FROM produccion WHERE operacion_id = '92000000-0000-0000-0000-00000000c001'), '092-33 fila de producción: consumo canónico 10 × P92-EMP, costo 20, sin asiento ligado');
SELECT t92_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Producción' AND categoria = 'Costo de Ventas' AND monto = 20 AND movimiento_id IS NULL AND referencia LIKE 'PROD-%')
  FROM costos_historial WHERE concepto LIKE '%P92-HIELO%')
  AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%P92-HIELO%' OR referencia = 'PROD-' || (t92_j('pr') ->> 'id')), '092-34 costo de producción reconocido una vez en costos_historial; ningún Egreso de producción');
SELECT t92_assert((t92_j('pr') ->> 'mov_contable_id') IS NULL AND (t92_j('pr') ->> 'costo_total')::numeric = 20, '092-35 resultado del contrato: costo 20, sin movimiento contable');

BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(3);
SELECT t92_err($q$SELECT registrar_produccion('92000000-0000-0000-0000-00000000c002', 'Turno 1', 'Máquina 92', 'P92-SIN', 6, 'CF-92')$q$, '092-36 empaque total insuficiente (5 < 6): producción rechazada', 'P0001', '%Stock insuficiente%');
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP2') = 5 AND NOT EXISTS (SELECT 1 FROM produccion WHERE operacion_id = '92000000-0000-0000-0000-00000000c002'), '092-37 rechazo sin efectos (stock 5, sin fila de producción)');

\echo '── 092: conciliación entrega vs uso'
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(1);
INSERT INTO t92_ids VALUES ('c1', t92_conc('P92-EMP')::text);
COMMIT;
SELECT t92_assert((t92_j('c1') ->> 'entregado_produccion')::int = 30 AND (t92_j('c1') ->> 'consumido_produccion')::int = 10 AND (t92_j('c1') ->> 'diferencia')::int = 20
  AND (t92_j('c1') ->> 'stock_total')::int = 110 AND (t92_j('c1') ->> 'entregas')::int = 1 AND (t92_j('c1') ->> 'producciones')::int = 1, '092-40 conciliación: entregado 30, usado 10, diferencia 20, total 110');
-- Historia legada ambigua (anterior a 092): no se reinterpreta como entrega canónica.
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Salida', 'P92-EMP', 7, 'Producción', 'sql');
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia) VALUES ('Salida', 'P92-EMP', 3, 'Producción', 'sql', 'salida_empaque/P92-EMP');
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Salida', 'P92-EMP', 4, 'Producción OP-LEG92', 'sql');
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(2);
INSERT INTO t92_ids VALUES ('c2', t92_conc('P92-EMP')::text);
COMMIT;
SELECT t92_assert((t92_j('c2') ->> 'entregado_produccion')::int = 30 AND (t92_j('c2') ->> 'consumido_produccion')::int = 10 AND (t92_j('c2') ->> 'diferencia')::int = 20
  AND (t92_j('c2') ->> 'legado_salidas')::int = 10 AND (t92_j('c2') ->> 'legado_salidas_n')::int = 2
  AND (t92_j('c2') ->> 'legado_consumo')::int = 4 AND (t92_j('c2') ->> 'legado_consumo_n')::int = 1, '092-41 legado aparte: 2 salidas ambiguas (10) y 1 consumo sin fila canónica (4); canónicos sin cambio');
SELECT t92_assert(t92_stock('P92-EMP') = 110, '092-42 la conciliación es métrica de control: no existe un segundo saldo ni cambia el total');
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(4);
SELECT t92_err($q$SELECT conciliacion_empaque()$q$, '092-43 Ventas: conciliación denegada', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(5);
SELECT t92_err($q$SELECT conciliacion_empaque()$q$, '092-44 Almacén Bolsas inactivo: denegada', '42501');
SELECT t92_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P92-EMP', 1)$q$, '092-45 Almacén Bolsas inactivo: entrega denegada', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t92_err($q$SELECT conciliacion_empaque()$q$, '092-46 anon: sin EXECUTE', '42501');
ROLLBACK;

\echo '── 092: compra a crédito (una sola salida de dinero)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(2);
INSERT INTO t92_ids VALUES ('cr', registrar_recepcion_compra('92000000-0000-0000-0000-00000000a002', 'P92-EMP', 5, 10, 'Plásticos T92', true)::text);
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP') = 115 AND (SELECT count(*) = 1 AND bool_and(monto_original = 10 AND saldo_pendiente = 10) FROM cuentas_por_pagar WHERE referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a002')
  AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a002'), '092-50 compra a crédito: stock +5, una CxP, ningún Egreso al recibir');
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(3);
SELECT registrar_produccion('92000000-0000-0000-0000-00000000c003', 'Turno 1', 'Máquina 92', 'P92-HIELO', 5, 'CF-92');
COMMIT;
SELECT t92_assert(t92_stock('P92-EMP') = 110 AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%P92-%' AND categoria = 'Costo de Ventas')
  AND (SELECT count(*) = 2 FROM costos_historial WHERE concepto LIKE '%P92-HIELO%'), '092-51 consumir lo comprado a crédito: costo reconocido, ningún Egreso antes de pagar la CxP');
-- Pago de la CxP como lo hace el frontend (Admin): la única salida de dinero.
BEGIN; SET LOCAL ROLE authenticated; SELECT t92_actor(1);
UPDATE cuentas_por_pagar SET monto_pagado = 10, saldo_pendiente = 0, estatus = 'Pagada' WHERE referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a002';
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (CURRENT_DATE, 'Egreso', 'Proveedores', 'T92 pago CxP Plásticos T92', 10, '');
COMMIT;
SELECT t92_assert((SELECT count(*) = 1 AND sum(monto) = 10 FROM movimientos_contables WHERE tipo = 'Egreso' AND (concepto LIKE 'T92 pago%' OR referencia = 'recepcion_compra/92000000-0000-0000-0000-00000000a002' OR (categoria = 'Costo de Ventas' AND concepto LIKE '%P92-%'))),
  '092-52 ciclo a crédito: exactamente una salida de dinero (el pago de la CxP)');

BEGIN; SELECT t92_limpiar(); COMMIT;
\echo '── 092: TODAS LAS PRUEBAS OK'
