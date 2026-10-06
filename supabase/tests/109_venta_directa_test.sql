-- 109_venta_directa_test.sql — completar_venta_directa: venta de mostrador
-- atómica. Asignación explícita por SKU y cuarto (sin selección automática),
-- dueño de la orden, sin ruta tras el bloqueo, modos contado / crédito (30 días)
-- / pagado por link, todo o nada, idempotencia por operación, sin tocar
-- productos.stock de producto terminado, empaque ni costos, y la FSM por REST
-- intacta (Creada → Entregada solo dentro del contrato).

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t109_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 10901 AND 10939;
  DELETE FROM inventario_mov WHERE producto LIKE 'P109-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '10900000-%' OR orden_id BETWEEN 10901 AND 10939;
  DELETE FROM pagos WHERE orden_id BETWEEN 10901 AND 10939;
  DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 10901 AND 10939;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 10901 AND 10939;
  DELETE FROM ordenes WHERE id BETWEEN 10901 AND 10939;
  DELETE FROM rutas WHERE id = 10901;
  DELETE FROM auditoria WHERE detalle LIKE 'OV-109%';
  DELETE FROM costos_empaque_historial WHERE sku LIKE 'P109-%';
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-109%';
  DELETE FROM productos WHERE sku LIKE 'P109-%';
  DELETE FROM clientes WHERE id BETWEEN 10901 AND 10909;
  DELETE FROM usuarios WHERE id BETWEEN 10901 AND 10909;
  DELETE FROM auth.users WHERE id::text LIKE '10900000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t109_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('10900000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t109' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10901, 'Admin 109',    'u1@t109', 'Admin',      'Activo', '10900000-0000-0000-0000-000000000001'),
  (10902, 'Ventas 109A',  'u2@t109', 'Ventas',     'Activo', '10900000-0000-0000-0000-000000000002'),
  (10903, 'Ventas 109B',  'u3@t109', 'Ventas',     'Activo', '10900000-0000-0000-0000-000000000003'),
  (10904, 'Chofer 109',   'u4@t109', 'Chofer',     'Activo', '10900000-0000-0000-0000-000000000004'),
  (10905, 'Prod 109',     'u5@t109', 'Producción', 'Activo', '10900000-0000-0000-0000-000000000005');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (10901, 'Cliente 109 contado', 'XAXX010101000', 0, false, 0),
  (10902, 'Cliente 109 crédito', 'XAXX010101000', 0, true, 1000),
  (10903, 'Cliente 109 sin crédito', 'XAXX010101000', 0, false, 0),
  (10904, 'Cliente 109 límite corto', 'XAXX010101000', 0, true, 10);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P109-A', 'Hielo A 109', 'Producto Terminado', 20, 777, 0), ('P109-B', 'Hielo B 109', 'Producto Terminado', 20, 0, 0),
  ('P109-C', 'Hielo C 109', 'Producto Terminado', 20, 0, 0), ('P109-E', 'Bolsa 109', 'Empaque', 0, 500, 2);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-109A', 'Cuarto 109A', '{"P109-A": 30, "P109-B": 10}'), ('CF-109B', 'Cuarto 109B', '{"P109-A": 20}'),
  ('CF-109C', 'Cuarto 109C', '{"P109-B": 10}'), ('CF-109D', 'Cuarto 109D', '{"P109-A": 3}');
INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES (10901, 'R-10901', 'T109 ruta', 'Programada', 10904, '{}', '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (10901, 'OV-10901', 10901, 'Cliente 109 contado', 'x', 300, 'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10902, 'OV-10902', 10901, 'Cliente 109 contado', 'x', 40,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10903, 'OV-10903', 10901, 'Cliente 109 contado', 'x', 40,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10904, 'OV-10904', 10902, 'Cliente 109 crédito', 'x', 60,  'Creada',    'Efectivo', 'Credito', 10902, NULL),
  (10905, 'OV-10905', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10906, 'OV-10906', 10901, 'Cliente 109 contado', 'x', 40,  'Asignada',  'Efectivo', 'Contado', 10902, NULL),
  (10907, 'OV-10907', 10901, 'Cliente 109 contado', 'x', 20,  'Asignada',  'Efectivo', 'Contado', 10902, 10901),
  (10908, 'OV-10908', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10903, NULL),
  (10909, 'OV-10909', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10910, 'OV-10910', 10901, 'Cliente 109 contado', 'x', 20,  'Entregada', 'Efectivo', 'Contado', 10902, NULL),
  (10911, 'OV-10911', 10903, 'Cliente 109 sin crédito', 'x', 20, 'Creada', 'Efectivo', 'Contado', 10902, NULL),
  (10912, 'OV-10912', 10904, 'Cliente 109 límite corto', 'x', 20, 'Creada', 'Efectivo', 'Contado', 10902, NULL),
  (10913, 'OV-10913', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10914, 'OV-10914', NULL,  'Público en general', 'x', 20,   'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10915, 'OV-10915', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10916, 'OV-10916', 10901, 'Cliente 109 contado', 'x', 100, 'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10918, 'OV-10918', 10901, 'Cliente 109 contado', 'x', 20,  'Creada',    'Efectivo', 'Contado', 10902, NULL),
  (10919, 'OV-10919', 10901, 'Cliente 109 contado', 'x', 20,  'Cancelada', 'Efectivo', 'Contado', 10902, NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (10901, 'P109-A', 10, 20, 200), (10901, 'P109-B', 5, 20, 100),
  (10902, 'P109-A', 2, 20, 40), (10903, 'P109-A', 2, 20, 40), (10904, 'P109-A', 3, 20, 60), (10905, 'P109-A', 1, 20, 20),
  (10906, 'P109-A', 2, 20, 40), (10907, 'P109-A', 1, 20, 20), (10908, 'P109-A', 1, 20, 20), (10909, 'P109-A', 1, 20, 20),
  (10910, 'P109-A', 1, 20, 20), (10911, 'P109-A', 1, 20, 20), (10912, 'P109-A', 1, 20, 20), (10913, 'P109-A', 1, 20, 20),
  (10914, 'P109-A', 1, 20, 20), (10915, 'P109-A', 1, 20, 20), (10916, 'P109-A', 5, 20, 100), (10918, 'P109-A', 1, 20, 20),
  (10919, 'P109-A', 1, 20, 20);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES
  (10901, 10905, 20, 'QR / Link de pago', fin_hoy(), 'stripe:t109-5', 0, 0),
  (10901, 10909, 10, 'QR / Link de pago', fin_hoy(), 'stripe:t109-9', 0, 0),
  (10901, 10910, 20, 'Efectivo', fin_hoy(), 'OV-10913-Efectivo', 0, 0);
COMMIT;

CREATE OR REPLACE FUNCTION t109_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10900000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t109_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t109_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 100);
END $$;
CREATE OR REPLACE FUNCTION t109_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t109_n(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v BIGINT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION t109_est(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus FROM ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t109_vd(p_op TEXT, p_orden BIGINT, p_modo TEXT, p_metodo TEXT, p_asig TEXT, p_ref TEXT DEFAULT NULL, p_nota TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT format('SELECT completar_venta_directa(%L::uuid, %s, %L, %L, %L::jsonb, %L, %L)', '10900000-0000-0000-0000-000000000' || p_op, p_orden, p_modo, p_metodo, p_asig, p_ref, p_nota)
$$;
GRANT EXECUTE ON FUNCTION t109_actor(INTEGER), t109_assert(BOOLEAN, TEXT), t109_err(TEXT, TEXT, TEXT, TEXT), t109_cf(TEXT, TEXT), t109_n(TEXT), t109_est(BIGINT),
  t109_vd(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t109_ids;
CREATE TEMP TABLE t109_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t109_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t109_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t109_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t109_j(TEXT) TO PUBLIC;
INSERT INTO t109_ids VALUES ('base', jsonb_build_object(
  'costos_historial', (SELECT count(*) FROM costos_historial), 'costos_empaque', (SELECT count(*) FROM costos_empaque_historial),
  'mov_contables', (SELECT count(*) FROM movimientos_contables))::text);

\echo '── 109: contrato, permisos y autorización'
SELECT t109_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp'
                     AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                    FROM pg_proc WHERE oid = 'public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)
  AND (SELECT pg_get_constraintdef(oid) LIKE '%venta_directa%' FROM pg_constraint WHERE conname = 'stock_operaciones_tipo_check'),
  '109-01 contrato SECURITY DEFINER, search_path fijo, sin anon; tipo de operación venta_directa');
BEGIN; SET LOCAL ROLE authenticated;
SELECT t109_actor(4);
SELECT t109_err(t109_vd('f01', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-02 Chofer: denegado', '42501');
SELECT t109_actor(5);
SELECT t109_err(t109_vd('f01', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-03 Producción: denegado', '42501');
SELECT t109_actor(3);
SELECT t109_err(t109_vd('f01', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-04 Ventas B sobre la orden de Ventas A: denegado', '42501', '%no es de este vendedor%');
SELECT t109_actor(2);
SELECT t109_err(t109_vd('f01', 10908, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-05 Ventas A sobre la orden de Ventas B: denegado', '42501');
COMMIT;

\echo '── 109: validación de modo, método y asignación (nada se aplica)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
SELECT t109_err(t109_vd('f02', 10902, 'efectivo', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-10 modo inválido', '22023');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-11 contado con método de crédito', '22023', '%no corresponde%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'QR / Link de pago', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-12 contado con link', '22023', '%no corresponde%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Transferencia', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-13 método fuera del catálogo de Ventas/Admin', '22023');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[]'), '109-14 asignación vacía', '22023');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}'), '109-15 asignación que no es lista', '22023');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A"}]'), '109-16 partida sin cantidad', '22023');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":0},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":2}]'), '109-17 cantidad cero', '22023', '%cantidad inválida%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":-2}]'), '109-18 cantidad negativa', '22023', '%cantidad inválida%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1.5},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":0.5}]'), '109-19 cantidad no entera', '22023', '%cantidad inválida%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1},{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-20 par SKU+cuarto repetido: rechazado (no se suma)', '22023', '%más de una vez%');
SELECT t109_err(t109_vd('f02', 10901, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":10}]'), '109-21 falta un SKU de la orden', '22023', '%falta asignar P109-B%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2},{"sku":"P109-C","cuarto_id":"CF-109A","cantidad":1}]'), '109-22 SKU extra', '22023', '%P109-C no está en la orden%');
SELECT t109_err(t109_vd('f02', 10901, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":6},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":3},{"sku":"P109-B","cuarto_id":"CF-109C","cantidad":5}]'), '109-23 suma 9 ≠ 10: rechazada (no se completa sola)', '22023', '%no coincide%');
SELECT t109_err(t109_vd('f02', 10901, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":6},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":5},{"sku":"P109-B","cuarto_id":"CF-109C","cantidad":5}]'), '109-24 suma 11 ≠ 10: rechazada', '22023', '%no coincide%');
SELECT t109_err(t109_vd('f02', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-NOPE","cantidad":2}]'), '109-25 cuarto inexistente', '22023', '%cuarto inexistente%');
SELECT t109_err(t109_vd('f02', 10916, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109D","cantidad":5}]'), '109-26 cuarto sin existencia suficiente (3 < 5)', '22023', '%Stock insuficiente%CF-109D%');
SELECT t109_err(t109_vd('f02', 10907, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-27 Asignada CON ruta: rechazada (es del chofer)', '22023', '%tiene ruta%');
SELECT t109_err(t109_vd('f02', 10910, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-28 orden ya Entregada', '22023', '%Creada o Asignada%');
SELECT t109_err(t109_vd('f02', 10919, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-29 orden Cancelada', '22023');
SELECT t109_err(t109_vd('f02', 10909, 'pagado_link', 'QR / Link de pago', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-30 link con pendiente (10 de 20): sin entrega', '22023', '%no cubre%');
SELECT t109_err(t109_vd('f02', 10913, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-31 pago no aplicado (referencia existente): todo se revierte', '22023', '%pago no se aplicó%');
-- El contexto de contrato de un intento fallido no queda activo: el Chofer sigue denegado.
SELECT t109_actor(4);
SELECT t109_err(t109_vd('f03', 10902, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]'), '109-32 tras un intento fallido el contexto no se filtra: Chofer denegado', '42501');
SELECT t109_actor(2);
SELECT t109_err(t109_vd('f02', 10911, 'credito', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-33 crédito a cliente sin crédito autorizado', '22023', '%crédito autorizado%');
SELECT t109_err(t109_vd('f02', 10912, 'credito', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-34 crédito que excede el límite', '22023', '%límite%');
SELECT t109_err(t109_vd('f02', 10914, 'credito', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]'), '109-35 crédito sin cliente: la CxC falla y todo se revierte', 'P0001', '%sin cliente%');
COMMIT;
SELECT t109_assert(t109_cf('CF-109A', 'P109-A') = 30 AND t109_cf('CF-109A', 'P109-B') = 10 AND t109_cf('CF-109B', 'P109-A') = 20 AND t109_cf('CF-109C', 'P109-B') = 10 AND t109_cf('CF-109D', 'P109-A') = 3
  AND (SELECT count(*) = 0 FROM inventario_mov WHERE producto LIKE 'P109-%') AND (SELECT count(*) = 0 FROM stock_operaciones WHERE orden_id BETWEEN 10901 AND 10939)
  AND (SELECT count(*) = 3 FROM pagos WHERE orden_id BETWEEN 10901 AND 10939) AND (SELECT count(*) = 0 FROM cuentas_por_cobrar WHERE orden_id BETWEEN 10901 AND 10939)
  AND (SELECT count(*) = 0 FROM movimientos_contables WHERE orden_id BETWEEN 10901 AND 10939)
  AND (SELECT bool_and(estatus = 'Creada' AND delivered_at IS NULL) FROM ordenes WHERE id IN (10901, 10902, 10909, 10911, 10912, 10913, 10914, 10916))
  AND t109_est(10907) = 'Asignada' AND (SELECT ruta_id FROM ordenes WHERE id = 10907) = 10901 AND t109_est(10910) = 'Entregada' AND t109_est(10919) = 'Cancelada'
  AND (SELECT saldo FROM clientes WHERE id = 10904) = 0,
  '109-36 tras todos los rechazos (confirmados): cuartos, estatus, kardex, operaciones, pagos, CxC, ingresos y saldo intactos');

\echo '── 109: la FSM por REST no cambia (Creada → Entregada solo dentro del contrato)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
SELECT t109_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 10918$q$, '109-40 Ventas por REST Creada → Entregada: negado', '42501', '%no permitida%');
SELECT t109_actor(1);
SELECT t109_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 10918$q$, '109-41 Admin por REST Creada → Entregada: negado', '42501', '%no permitida%');
ROLLBACK;

\echo '── 109: contado multi-cuarto (A: CF-109A 6 + CF-109B 4; B: CF-109C 5)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('s1', completar_venta_directa('10900000-0000-0000-0000-000000000101', 10901, 'contado', 'Efectivo',
  '[{"sku":"P109-B","cuarto_id":"CF-109C","cantidad":5},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":4},{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":6}]', NULL, 'N-109-1')::text);
COMMIT;
SELECT t109_assert(t109_j('s1') ->> 'estatus' = 'Entregada' AND t109_j('s1') ->> 'estatus_anterior' = 'Creada' AND t109_j('s1') ->> 'modo' = 'contado'
  AND (t109_j('s1') -> 'pago' ->> 'aplicado')::boolean AND (t109_j('s1') -> 'pago' ->> 'monto')::numeric = 300 AND t109_j('s1') -> 'cxc' = 'null'::jsonb
  AND t109_j('s1') -> 'asignacion' = '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":6},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":4},{"sku":"P109-B","cuarto_id":"CF-109C","cantidad":5}]'::jsonb
  AND (t109_j('s1') ->> 'replay')::boolean = false AND t109_j('s1') ->> 'actor' IS NOT NULL AND t109_j('s1') ->> 'delivered_at' IS NOT NULL,
  '109-50 resultado: Entregada desde Creada, pago 300, sin CxC, asignación canónica (ordenada), sin replay');
SELECT t109_assert(t109_cf('CF-109A', 'P109-A') = 24 AND t109_cf('CF-109B', 'P109-A') = 16 AND t109_cf('CF-109C', 'P109-B') = 5 AND t109_cf('CF-109A', 'P109-B') = 10 AND t109_cf('CF-109D', 'P109-A') = 3,
  '109-51 salida exacta SOLO de los cuartos asignados (CF-109A −6, CF-109B −4, CF-109C −5; los demás intactos)');
SELECT t109_assert((SELECT count(*) = 3 AND bool_and(m.tipo = 'Salida' AND m.origen = 'Venta directa OV-10901' AND m.referencia = 'venta_directa/10901'
                     AND m.operacion_id = '10900000-0000-0000-0000-000000000101' AND m.ruta_id IS NULL AND m.usuario = 'Ventas 109A')
                     AND string_agg(m.cuarto_id || ':' || m.producto || ':' || m.cantidad, ',' ORDER BY m.cuarto_id, m.producto) = 'CF-109A:P109-A:6,CF-109B:P109-A:4,CF-109C:P109-B:5'
                    FROM inventario_mov m WHERE m.referencia = 'venta_directa/10901'),
  '109-52 kardex: una salida por cuarto y SKU, ligada a la orden, a la operación y al actor');
SELECT t109_assert((SELECT estatus = 'Entregada' AND metodo_pago = 'Efectivo' AND folio_nota = 'N-109-1' AND delivered_at IS NOT NULL AND ruta_id IS NULL FROM ordenes WHERE id = 10901)
  AND (SELECT count(*) = 1 AND sum(monto) = 300 AND bool_and(metodo_pago = 'Efectivo' AND referencia = 'OV-10901-Efectivo') FROM pagos WHERE orden_id = 10901)
  AND (SELECT count(*) = 1 AND sum(monto) = 300 FROM movimientos_contables WHERE orden_id = 10901 AND tipo = 'Ingreso' AND categoria = 'Ventas')
  AND (SELECT count(*) = 1 FROM stock_operaciones WHERE operacion_id = '10900000-0000-0000-0000-000000000101' AND tipo = 'venta_directa' AND orden_id = 10901 AND resultado ->> 'folio' = 'OV-10901')
  AND (SELECT count(*) = 1 FROM auditoria WHERE accion = 'Venta directa' AND detalle LIKE 'OV-10901 — contado%'),
  '109-53 orden Entregada (método, nota, fecha de entrega), un pago y un ingreso por los contratos existentes, operación y auditoría');

\echo '── 109: contado Transferencia SPEI y Tarjeta; crédito; pagado por link; Asignada sin ruta (Admin)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('s2', completar_venta_directa('10900000-0000-0000-0000-000000000102', 10902, 'contado', 'Transferencia SPEI', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]', 'SPEI-123456', NULL)::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('s3', completar_venta_directa('10900000-0000-0000-0000-000000000103', 10903, 'contado', 'Tarjeta (terminal)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('s4', completar_venta_directa('10900000-0000-0000-0000-000000000104', 10904, 'credito', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":3}]')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('s5', completar_venta_directa('10900000-0000-0000-0000-000000000105', 10905, 'pagado_link', 'QR / Link de pago', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(1);
INSERT INTO t109_ids VALUES ('s6', completar_venta_directa('10900000-0000-0000-0000-000000000106', 10906, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":2}]')::text);
COMMIT;
SELECT t109_assert((SELECT count(*) = 1 AND bool_and(metodo_pago = 'Transferencia SPEI' AND referencia = 'SPEI-123456' AND monto = 40) FROM pagos WHERE orden_id = 10902)
  AND (SELECT metodo_pago = 'Transferencia SPEI' AND estatus = 'Entregada' FROM ordenes WHERE id = 10902)
  AND (SELECT count(*) = 1 AND bool_and(metodo_pago = 'Tarjeta (terminal)' AND monto = 40) FROM pagos WHERE orden_id = 10903) AND t109_est(10903) = 'Entregada',
  '109-60 contado SPEI (con su referencia) y Tarjeta (terminal): un pago cada uno, Entregada');
SELECT t109_assert(t109_est(10904) = 'Entregada' AND (SELECT metodo_pago FROM ordenes WHERE id = 10904) = 'Crédito (fiado)'
  AND (SELECT count(*) = 1 AND bool_and(monto_original = 60 AND saldo_pendiente = 60 AND fecha_venta = fin_hoy() AND fecha_vencimiento = fin_hoy() + 30 AND estatus = 'Pendiente')
       FROM cuentas_por_cobrar WHERE orden_id = 10904)
  AND (SELECT count(*) = 0 FROM pagos WHERE orden_id = 10904) AND (SELECT saldo FROM clientes WHERE id = 10902) = 60
  AND (t109_j('s4') -> 'cxc' ->> 'creada')::boolean AND t109_j('s4') -> 'pago' = 'null'::jsonb AND t109_cf('CF-109B', 'P109-A') = 11,
  '109-61 crédito: una CxC de 60 a 30 días, saldo del cliente +60, sin pago, salida de CF-109B, Entregada');
SELECT t109_assert(t109_est(10905) = 'Entregada' AND (SELECT metodo_pago FROM ordenes WHERE id = 10905) = 'QR / Link de pago'
  AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 10905) AND (SELECT count(*) = 0 FROM movimientos_contables WHERE orden_id = 10905)
  AND (SELECT count(*) = 0 FROM cuentas_por_cobrar WHERE orden_id = 10905) AND t109_j('s5') -> 'pago' = 'null'::jsonb,
  '109-62 pagado por link: entrega física sin pago nuevo (sigue el único pago del proveedor) ni CxC');
SELECT t109_assert(t109_est(10906) = 'Entregada' AND t109_j('s6') ->> 'estatus_anterior' = 'Asignada' AND (SELECT ruta_id IS NULL FROM ordenes WHERE id = 10906)
  AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 10906) AND t109_j('s6') ->> 'actor' = 'Admin 109',
  '109-63 Asignada sin ruta → Entregada por Admin (orden de Ventas A), sin ruta inventada');
SELECT t109_assert(t109_cf('CF-109A', 'P109-A') = 19 AND t109_cf('CF-109B', 'P109-A') = 11 AND t109_cf('CF-109C', 'P109-B') = 5 AND t109_cf('CF-109D', 'P109-A') = 3
  AND (SELECT stock FROM productos WHERE sku = 'P109-A') = 777 AND (SELECT stock FROM productos WHERE sku = 'P109-E') = 500
  AND (SELECT costo_unitario FROM productos WHERE sku = 'P109-E') = 2
  AND (SELECT count(*) FROM costos_historial) = (t109_j('base') ->> 'costos_historial')::bigint
  AND (SELECT count(*) FROM costos_empaque_historial) = (t109_j('base') ->> 'costos_empaque')::bigint,
  '109-64 existencias exactas por cuarto; productos.stock del producto terminado (777), empaque (500 @ 2) y costos SIN cambio');

\echo '── 109: idempotencia'
BEGIN; SET LOCAL ROLE authenticated; SELECT t109_actor(2);
INSERT INTO t109_ids VALUES ('r1', completar_venta_directa('10900000-0000-0000-0000-000000000101', 10901, 'contado', 'Efectivo',
  '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":6,"nota":"llave extra ignorada"},{"sku":"P109-B","cuarto_id":"CF-109C","cantidad":5},{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":4}]', NULL, 'N-109-1')::text);
SELECT t109_err(t109_vd('102', 10902, 'contado', 'Transferencia SPEI', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]', 'SPEI-999999'), '109-71 mismo UUID, otra referencia: rechazado', '23505');
SELECT t109_err(t109_vd('102', 10902, 'contado', 'Tarjeta (terminal)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]', 'SPEI-123456'), '109-72 mismo UUID, otro método: rechazado', '23505');
SELECT t109_err(t109_vd('102', 10902, 'contado', 'Transferencia SPEI', '[{"sku":"P109-A","cuarto_id":"CF-109B","cantidad":2}]', 'SPEI-123456'), '109-73 mismo UUID, otra asignación: rechazado', '23505');
SELECT t109_err(t109_vd('102', 10902, 'credito', 'Crédito (fiado)', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":2}]', 'SPEI-123456'), '109-74 mismo UUID, otro modo: rechazado', '23505');
SELECT t109_err(t109_vd('102', 10915, 'contado', 'Transferencia SPEI', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":1}]', 'SPEI-123456'), '109-75 mismo UUID, otra orden: rechazado', '23505');
SELECT t109_err(t109_vd('199', 10901, 'contado', 'Efectivo', '[{"sku":"P109-A","cuarto_id":"CF-109A","cantidad":10},{"sku":"P109-B","cuarto_id":"CF-109A","cantidad":5}]'), '109-76 otro UUID sobre la orden ya entregada: rechazado', '22023');
COMMIT;
SELECT t109_assert((t109_j('r1') ->> 'replay')::boolean AND t109_j('r1') ->> 'folio' = 'OV-10901' AND (t109_j('r1') -> 'asignacion') = (t109_j('s1') -> 'asignacion')
  AND (SELECT count(*) = 3 FROM inventario_mov WHERE referencia = 'venta_directa/10901') AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 10901)
  AND (SELECT count(*) = 1 FROM movimientos_contables WHERE orden_id = 10901) AND (SELECT count(*) = 1 FROM stock_operaciones WHERE orden_id = 10901)
  AND t109_cf('CF-109A', 'P109-A') = 19 AND t109_est(10915) = 'Creada',
  '109-70 mismo UUID y misma huella (otro orden de partidas, llave extra): replay sin segundo movimiento, pago, ingreso ni operación');

\echo '── 109: el webhook y la carga de ruta no se tocan'
SELECT t109_assert((SELECT pg_get_functiondef('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure) !~ 'venta_directa')
  AND (SELECT pg_get_functiondef('public.salida_cuarto_manual(uuid,text,text,integer,text)'::regprocedure) ~ 'Venta directa')
  AND (SELECT pg_get_functiondef('public.crear_cxc_orden(bigint,integer)'::regprocedure) ~ 'COALESCE\(p_dias_vencimiento, 30\)'),
  '109-80 carga de ruta y salida manual sin cambio; crear_cxc_orden conserva su firma (la ruta sigue pasando sus 15 días)');

BEGIN; SELECT t109_limpiar(); COMMIT;
\echo '── 109: TODAS LAS PRUEBAS OK'
