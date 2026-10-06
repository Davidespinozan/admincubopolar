-- 088_b3_integridad_test.sql — B3: autorización e integridad financiera.
-- Precio canónico; crear_orden y edición; sin INSERT directo (089); UPDATE de
-- órdenes por dueño de ruta; campos financieros del cliente; CxC y pagos;
-- atribución del servidor; ventas exprés validadas; crédito (ecuación única);
-- recepción de compra y salida de empaque; sin egreso genérico; stock de
-- producto solo Admin; ruta cerrada terminal; auditoría; roles.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t88_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8801 AND 8899;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8840 AND 8849 OR ruta_id BETWEEN 8801 AND 8899);
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8840 AND 8849 OR ruta_id BETWEEN 8801 AND 8899);
  DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 8840 AND 8849;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8840 AND 8849 OR ruta_id BETWEEN 8801 AND 8899);
  DELETE FROM ordenes WHERE cliente_id BETWEEN 8840 AND 8849 OR ruta_id BETWEEN 8801 AND 8899;
  DELETE FROM movimientos_contables WHERE referencia LIKE 'recepcion_compra/88000000-%' OR concepto LIKE '%P88-%';
  DELETE FROM cuentas_por_pagar WHERE referencia LIKE 'recepcion_compra/88000000-%' OR concepto LIKE '%P88-%';
  -- 106+: la compra deja una fila de historial de costo por operación; se limpia
  -- con el resto del fixture para que la suite pueda repetirse.
  IF to_regclass('public.costos_empaque_historial') IS NOT NULL THEN
    EXECUTE $x$DELETE FROM costos_empaque_historial WHERE sku LIKE 'P88-%'$x$;
  END IF;
  DELETE FROM inventario_mov WHERE producto LIKE 'P88-%';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 8801 AND 8899 OR operacion_id::text LIKE '88000000-%';
  DELETE FROM auditoria WHERE detalle LIKE '%T88%';
  DELETE FROM error_log WHERE mensaje LIKE 'T88%';
  DELETE FROM precios_esp WHERE cliente_id BETWEEN 8840 AND 8849;
  DELETE FROM rutas WHERE id BETWEEN 8801 AND 8899;
  DELETE FROM clientes WHERE id BETWEEN 8840 AND 8849;
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-88%';
  UPDATE cuartos_frios SET stock = stock - 'P88-A' - 'P88-B' WHERE stock ?| ARRAY['P88-A', 'P88-B'];
  DELETE FROM productos WHERE sku LIKE 'P88-%';
  DELETE FROM usuarios WHERE id BETWEEN 8801 AND 8829;
  DELETE FROM auth.users WHERE id::text LIKE '88000000-%';
END $$;

BEGIN;
SELECT t88_limpiar();
INSERT INTO auth.users (id, email)
  SELECT ('88000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t88' FROM generate_series(1, 12) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8801, 'Admin 88',        'u1@t88',  'Admin',          'Activo',   '88000000-0000-0000-0000-000000000001'),
  (8802, 'Ventas 88',       'u2@t88',  'Ventas',         'Activo',   '88000000-0000-0000-0000-000000000002'),
  (8803, 'Chofer A 88',     'u3@t88',  'Chofer',         'Activo',   '88000000-0000-0000-0000-000000000003'),
  (8804, 'Chofer B 88',     'u4@t88',  'Chofer',         'Activo',   '88000000-0000-0000-0000-000000000004'),
  (8805, 'Prod 88',         'u5@t88',  'Producción',     'Activo',   '88000000-0000-0000-0000-000000000005'),
  (8806, 'Bolsas 88',       'u6@t88',  'Almacén Bolsas', 'Activo',   '88000000-0000-0000-0000-000000000006'),
  (8807, 'Fact 88',         'u7@t88',  'Facturación',    'Activo',   '88000000-0000-0000-0000-000000000007'),
  (8808, 'Inactivo 88',     'u8@t88',  'Ventas',         'Inactivo', '88000000-0000-0000-0000-000000000008'),
  (8809, 'Chofer C 88',     'u9@t88',  'Chofer',         'Activo',   '88000000-0000-0000-0000-000000000009');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P88-A', 'Hielo A88', 'Producto Terminado', 30, 0, 0),
  ('P88-B', 'Hielo B88', 'Producto Terminado', 50, 0, 0),
  ('P88-E', 'Bolsa 88',  'Empaque',            0,  10, 2),
  ('P88-M', 'Barra 88',  'Materia Prima',      0,  5, 1);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-88', 'Cuarto 88', '{"P88-A": 500, "P88-B": 500}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (8840, 'Cliente Contado 88', 'XAXX010101000', 0, false, 0),
  (8841, 'Cliente Crédito 88', 'CCR880101AB1', 0, true, 100),
  (8842, 'Cliente Especial 88', 'ESP880101AB1', 0, false, 0),
  (8843, 'Cliente Crédito B 88', 'CCB880101AB1', 0, true, 100);
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (8842, 'P88-A', 25.5);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (8801, 'R-8801', 'Ruta A 88', 8803, 'Chofer A 88', 'Pendiente firma', CURRENT_DATE, '{"P88-A": 20}', '{"P88-A": 20}', '{}', '{"P88-A": 20}', now()),
  (8802, 'R-8802', 'Ruta B 88', 8804, 'Chofer B 88', 'Pendiente firma', CURRENT_DATE, '{"P88-A": 20}', '{"P88-A": 20}', '{}', '{"P88-A": 20}', now()),
  (8803, 'R-8803', 'Ruta C 88', 8809, 'Chofer C 88', 'Pendiente firma', CURRENT_DATE, '{"P88-A": 10}', '{"P88-A": 10}', '{}', '{"P88-A": 10}', now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8821, 'OV-8821', 8840, 'Cliente Contado 88', '2×P88-A', 60, 'Asignada', 'Efectivo', 'Contado', 8802, 8801),
  (8822, 'OV-8822', 8840, 'Cliente Contado 88', '1×P88-A', 30, 'Asignada', 'Efectivo', 'Contado', 8802, 8802),
  (8823, 'OV-8823', 8841, 'Cliente Crédito 88', '1×P88-A', 30, 'Entregada', 'Efectivo', 'Contado', 8802, NULL),
  (8824, 'OV-8824', 8840, 'Cliente Contado 88', '1×P88-A', 30, 'Creada', 'Efectivo', 'Contado', 8802, NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8821, 'P88-A', 2, 30, 60), (8822, 'P88-A', 1, 30, 30), (8823, 'P88-A', 1, 30, 30), (8824, 'P88-A', 1, 30, 30);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (8841, 8823, 30, 'Efectivo', CURRENT_DATE, 'T88-PAGADA', 0, 0);
COMMIT;

CREATE OR REPLACE FUNCTION t88_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '88000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t88_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t88_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t88_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
DROP TABLE IF EXISTS t88_ids;
CREATE TEMP TABLE t88_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t88_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t88_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t88_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t88_n(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE n BIGINT; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;

\echo '── 088: estado físico'
SELECT t88_assert(to_regprocedure('public.cerrar_ruta_completa(bigint,jsonb)') IS NULL, '088-01 cerrar_ruta_completa eliminada');
SELECT t88_assert((SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('egreso_operativo_insert', 'costos_historial_produccion_insert', 'cxp_insert_compra', 'almacen_update', 'almacen_write')), '088-02 sin Egreso genérico, sin costos_historial de Producción, sin CxP genérica, sin policies del rol muerto Almacén');
SELECT t88_assert((SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(Almacén|Bolsas)''::text'), '088-03 ningún literal de rol muerto (Almacén, Bolsas) en policies');
SELECT t88_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname !~ '^t[0-9]*_' AND pg_get_functiondef(p.oid) ~ '''(Almacén|Bolsas)''') , '088-04 ningún literal de rol muerto en funciones');
SELECT t88_assert((SELECT count(*) = 1 FROM pg_constraint WHERE conname = 'precios_esp_cliente_sku_key') AND (SELECT convalidated FROM pg_constraint WHERE conname = 'usuarios_rol_check'), '088-05 precios_esp único por cliente+SKU; CHECK de roles validado');
SELECT t88_assert((SELECT bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc
  WHERE oid IN ('public.precio_canonico(bigint,text)'::regprocedure, 'public.lineas_canonicas(bigint,jsonb)'::regprocedure, 'public.fin_validar_credito(bigint,numeric)'::regprocedure,
                'public.fin_actor_id(bigint)'::regprocedure, 'public.fin_orden_operable(bigint)'::regprocedure, 'public.productos_stock_interno(jsonb)'::regprocedure)), '088-06 primitivas internas sin EXECUTE de API');
SELECT t88_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc
  WHERE oid IN ('public.crear_orden(jsonb,jsonb)'::regprocedure, 'public.registrar_recepcion_compra(uuid,text,integer,numeric,text,boolean)'::regprocedure, 'public.registrar_salida_empaque(uuid,text,integer)'::regprocedure)), '088-07 contratos nuevos: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');
SELECT t88_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'update_productos_stock_atomic' AND p.proname !~ '^t[0-9]*_' AND pg_get_functiondef(p.oid) ~ 'update_productos_stock_atomic\('), '088-08 ningún contrato llama ya al RPC genérico de stock de producto');

\echo '── 088: precio canónico'
SELECT t88_assert(precio_canonico(NULL, 'P88-A') = 30 AND precio_canonico(8840, 'P88-A') = 30 AND precio_canonico(8842, 'P88-A') = 25.50 AND precio_canonico(8842, 'P88-B') = 50 AND precio_canonico(8840, 'P88-ZZ') IS NULL, '088-10 precio: especial por ID de cliente + SKU, si no catálogo; SKU inexistente → NULL');
SELECT t88_assert((lineas_canonicas(8842, '[{"sku":"P88-A","cantidad":3},{"sku":"P88-B","cantidad":"2"}]') ->> 'total')::numeric = 176.50, '088-11 total = round(3×25.50) + round(2×50) = 176.50');
SELECT t88_err($q$SELECT lineas_canonicas(NULL, '[{"sku":"P88-A","cantidad":0}]')$q$, '088-12 cantidad 0 rechazada', '22023');
SELECT t88_err($q$SELECT lineas_canonicas(NULL, '[{"sku":"P88-A","cantidad":-2}]')$q$, '088-13 cantidad negativa rechazada', '22023');
SELECT t88_err($q$SELECT lineas_canonicas(NULL, '[{"sku":"P88-A","cantidad":1.5}]')$q$, '088-14 cantidad fraccionaria rechazada', '22023');
SELECT t88_err($q$SELECT lineas_canonicas(NULL, '[{"sku":"P88-ZZ","cantidad":1}]')$q$, '088-15 SKU inexistente rechazado', '22023');
SELECT t88_err($q$SELECT lineas_canonicas(NULL, '[{"sku":"P88-A","cantidad":1},{"sku":"P88-A","cantidad":1}]')$q$, '088-16 SKU repetido rechazado', '22023');
SELECT t88_err($q$INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (8842, 'P88-A', 10)$q$, '088-17 un solo precio especial por cliente+SKU', '23505');

\echo '── 088: creación canónica de órdenes (Ventas)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
INSERT INTO t88_ids VALUES ('o1', crear_orden('{"cliente_id": 8842, "cliente_nombre": "Otro nombre", "tipo_cobro": "Contado", "total": 1, "estatus": "Entregada", "ruta_id": 8801, "vendedor_id": 8801}', '[{"sku":"P88-A","cantidad":2,"precio_unit":0.01}]')::text);
SELECT t88_err($q$SELECT crear_orden('{"cliente_id": 8840}', '[{"sku":"P88-A","cantidad":100000}]')$q$, '088-21 cantidad sin stock en cuartos rechazada', '22023', '%Stock insuficiente%');
SELECT t88_err($q$SELECT crear_orden('{"cliente_id": 8849}', '[{"sku":"P88-A","cantidad":1}]')$q$, '088-22 cliente inexistente rechazado', '22023');
SELECT t88_err($q$SELECT crear_orden('{"cliente_id": 8840, "tipo_cobro": "Credito"}', '[{"sku":"P88-A","cantidad":1}]')$q$, '088-23 crédito sin autorización del cliente rechazado', '22023', '%crédito autorizado%');
SELECT t88_err($q$SELECT crear_orden('{"cliente_id": 8841, "tipo_cobro": "Credito"}', '[{"sku":"P88-A","cantidad":4}]')$q$, '088-24 crédito por encima del límite (120 > 100) rechazado', '22023', '%Excede límite%');
INSERT INTO t88_ids VALUES ('o2', crear_orden('{"cliente_id": 8841, "tipo_cobro": "Credito"}', '[{"sku":"P88-A","cantidad":3}]')::text);
COMMIT;
SELECT t88_assert((t88_j('o1') ->> 'estatus') = 'Creada' AND (t88_j('o1') ->> 'total')::numeric = 51 AND (t88_j('o1') ->> 'cliente_nombre') = 'Cliente Especial 88'
  AND (SELECT ruta_id IS NULL AND vendedor_id = 8802 AND folio ~ '^OV-[0-9]{4,}$' FROM ordenes WHERE id = (t88_j('o1') ->> 'id')::bigint)
  AND (SELECT count(*) = 1 AND bool_and(precio_unit = 25.50 AND subtotal = 51) FROM orden_lineas WHERE orden_id = (t88_j('o1') ->> 'id')::bigint), '088-20 crear_orden: Creada, sin ruta, total/precio del servidor (2×25.50), nombre del cliente de la BD, vendedor = actor; total/estado/ruta/vendedor/precio del cliente ignorados');
SELECT t88_assert((t88_j('o2') ->> 'total')::numeric = 90, '088-25 crédito dentro del límite (90 ≤ 100): orden creada');
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
SELECT t88_err($q$SELECT crear_orden('{"cliente_id": 8840}', '[{"sku":"P88-A","cantidad":1}]')$q$, '088-26 Chofer: crear_orden denegado', '42501');
ROLLBACK;

\echo '── 088: edición con precio del servidor'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
SELECT update_orden_atomic(8824, '{"total": 1, "productos": "falso", "cliente_id": 8842}', '[{"sku":"P88-A","cantidad":4,"precio_unit":0.01,"subtotal":0.04}]');
COMMIT;
SELECT t88_assert((SELECT total = 102 AND productos = '4×P88-A' AND cliente_id = 8842 FROM ordenes WHERE id = 8824) AND (SELECT bool_and(precio_unit = 25.50 AND subtotal = 102) FROM orden_lineas WHERE orden_id = 8824), '088-27 edición: el servidor reprecia (4×25.50 = 102); total, productos y precio del cliente ignorados');

\echo '── 088: sin INSERT directo de órdenes (tras 089)'
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ordenes' AND policyname = 'ventas_insert') THEN
    RAISE NOTICE 'OK: 088-30 (089 aún no aplicada: se omite)';
    RETURN;
  END IF;
  PERFORM t88_actor(3); SET LOCAL ROLE authenticated;
  PERFORM t88_err($q$INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES ('OV-T88X', 8840, 'x', '5×P88-A', 1, 'Entregada', 'Efectivo', 'Contado', 8801)$q$, '088-30 Chofer: INSERT de orden entregada denegado', '42501');
  PERFORM t88_err($q$INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8821, 'P88-A', 5, 0, 0)$q$, '088-31 Chofer: INSERT de línea denegado', '42501');
  PERFORM t88_actor(2);
  PERFORM t88_err($q$INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES ('OV-T88Y', 8840, 'x', '1×P88-A', 1, 'Entregada', 'Efectivo', 'Contado')$q$, '088-32 Ventas: INSERT directo de orden denegado', '42501');
  RESET ROLE;
END $do$;

\echo '── 088: UPDATE de órdenes por dueño de ruta'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 8822$q$) = 0, '088-40 Chofer A: Entregada en la orden de la ruta B no afecta filas');
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET estatus = 'No entregada', motivo_no_entrega = 'x' WHERE id = 8822$q$) = 0, '088-41 Chofer A: No entregada en la ruta B no afecta filas');
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET estatus = 'Cancelada' WHERE id = 8822$q$) = 0, '088-42 Chofer A: Cancelada en la ruta B no afecta filas');
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET direccion_entrega = 'otra' WHERE id = 8822$q$) = 0, '088-43 Chofer A: edición de texto en la ruta B no afecta filas');
SELECT t88_err($q$UPDATE ordenes SET ruta_id = 8802 WHERE id = 8821$q$, '088-44 Chofer A: no puede mover su orden a la ruta de B', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 8821$q$) = 0, '088-45 Ventas: una orden de ruta no se entrega por UPDATE directo');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(7);
SELECT t88_assert(t88_rows($q$UPDATE ordenes SET folio_nota = 'x' WHERE id = 8824$q$) = 0, '088-46 Facturación: sin UPDATE directo de órdenes');
ROLLBACK;
SELECT t88_assert((SELECT estatus = 'Asignada' FROM ordenes WHERE id = 8822) AND (SELECT estatus = 'Asignada' FROM ordenes WHERE id = 8821), '088-47 órdenes de ruta intactas');

\echo '── 088: campos financieros del cliente'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
SELECT t88_err($q$UPDATE clientes SET saldo = 999 WHERE id = 8840$q$, '088-50 Ventas: saldo directo denegado', '42501');
SELECT t88_err($q$UPDATE clientes SET limite_credito = 99999 WHERE id = 8841$q$, '088-51 Ventas: límite de crédito denegado', '42501');
SELECT t88_err($q$UPDATE clientes SET credito_autorizado = true WHERE id = 8840$q$, '088-52 Ventas: autorizar crédito denegado', '42501');
SELECT t88_err($q$INSERT INTO clientes (nombre, rfc, credito_autorizado, limite_credito) VALUES ('T88 nuevo', 'XAXX010101000', true, 500)$q$, '088-53 Ventas: alta con crédito denegada', '42501');
SELECT t88_assert(t88_rows($q$INSERT INTO clientes (nombre, rfc, credito_autorizado, limite_credito) VALUES ('T88 nuevo ok', 'XAXX010101000', false, 0)$q$) = 1, '088-54 Ventas: alta de cliente sin crédito (flujo de la venta) conservada');
SELECT t88_assert(t88_rows($q$UPDATE clientes SET correo = 't88@x' WHERE id = 8840$q$) = 1, '088-55 Ventas: datos de contacto conservados');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(7);
SELECT t88_err($q$UPDATE clientes SET saldo = 1 WHERE id = 8840$q$, '088-56 Facturación: saldo directo denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(1);
SELECT t88_assert(t88_rows($q$UPDATE clientes SET limite_credito = 100 WHERE id = 8843$q$) = 1, '088-57 Admin: gestiona el crédito');
ROLLBACK;

\echo '── 088: CxC y pagos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(1);
INSERT INTO t88_ids VALUES ('cx1', crear_cxc_orden(8823, 15)::text);
COMMIT;
SELECT t88_assert((t88_j('cx1') ->> 'creada') = 'false' AND (t88_j('cx1') ->> 'motivo') = 'ya_pagada' AND (SELECT count(*) = 0 FROM cuentas_por_cobrar WHERE orden_id = 8823) AND (SELECT saldo = 0 FROM clientes WHERE id = 8841), '088-60 orden ya pagada: no genera CxC ni saldo');
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
SELECT t88_err($q$SELECT registrar_pago_orden(8822, 'Efectivo', NULL, 8804)$q$, '088-61 Chofer A: no cobra una orden de la ruta B', '42501');
SELECT t88_err($q$SELECT crear_cxc_orden(8822, 15)$q$, '088-62 Chofer A: no genera CxC de la ruta B', '42501');
SELECT t88_err($q$SELECT registrar_ingreso_orden(8822, 8801)$q$, '088-63 Chofer A: no registra ingreso de la ruta B', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
SELECT t88_err($q$SELECT registrar_pago_orden(8821, 'Efectivo')$q$, '088-64 Ventas: no cobra órdenes de ruta', '42501');
ROLLBACK;
-- Preparación: la orden queda entregada como lo haría un contrato del servidor
-- (desde 110 nadie entrega por escritura directa una orden sin ruta).
BEGIN; SELECT set_config('app.fin_ctx', 'rpc', true); UPDATE ordenes SET estatus = 'Entregada' WHERE id = 8824; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
INSERT INTO t88_ids VALUES ('pg1', registrar_pago_orden(8824, 'Efectivo', NULL, 8801)::text);
COMMIT;
SELECT t88_assert((t88_j('pg1') ->> 'aplicado') = 'true' AND (SELECT count(*) = 1 AND bool_and(usuario_id = 8802 AND monto = 102) FROM pagos WHERE orden_id = 8824)
  AND (SELECT count(*) = 1 AND bool_and(usuario_id = 8802) FROM movimientos_contables WHERE orden_id = 8824), '088-65 pago de mostrador: monto del servidor; pago e ingreso atribuidos al actor (no al id enviado)');

\echo '── 088: recepción de compra y salida de empaque'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(6);
INSERT INTO t88_ids VALUES ('rc1', registrar_recepcion_compra('88000000-0000-0000-0000-00000000c001', 'P88-E', 100, 250.5, 'Plásticos T88', false)::text);
INSERT INTO t88_ids VALUES ('rc1r', registrar_recepcion_compra('88000000-0000-0000-0000-00000000c001', 'P88-E', 100, 250.5, 'Plásticos T88', false)::text);
SELECT t88_err($q$SELECT registrar_recepcion_compra('88000000-0000-0000-0000-00000000c001', 'P88-E', 100, 999, 'Plásticos T88', false)$q$, '088-72 misma operación con otro total → 23505', '23505');
INSERT INTO t88_ids VALUES ('rc2', registrar_recepcion_compra('88000000-0000-0000-0000-00000000c002', 'P88-M', 7, 80, 'Hielos T88', true)::text);
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-ZZ', 1, 10, 'x', false)$q$, '088-73 SKU inexistente rechazado', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-A', 1, 10, 'x', false)$q$, '088-74 producto terminado no es compra de empaque', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 0, 10, 'x', false)$q$, '088-75 cantidad 0 rechazada', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', -3, 10, 'x', false)$q$, '088-76 cantidad negativa rechazada', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 1, 0, 'x', false)$q$, '088-77 total 0 rechazado', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 1, -5, 'x', false)$q$, '088-78 total negativo rechazado', '22023');
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 1, 5, NULL, true)$q$, '088-79 crédito sin proveedor rechazado', '22023');
INSERT INTO t88_ids VALUES ('se1', registrar_salida_empaque('88000000-0000-0000-0000-00000000c003', 'P88-E', 30)::text);
SELECT t88_err($q$SELECT registrar_salida_empaque(gen_random_uuid(), 'P88-E', 100000)$q$, '088-80 salida mayor al stock rechazada', 'P0001', '%Stock insuficiente%');
COMMIT;
-- 092: la entrega a Producción ya no descuenta el total de la empresa.
SELECT t88_assert((SELECT stock = 10 + 100 - CASE WHEN to_regprocedure('public.conciliacion_empaque()') IS NOT NULL THEN 0 ELSE 30 END FROM productos WHERE sku = 'P88-E')
  AND (SELECT count(*) = 1 AND bool_and(tipo = 'Egreso' AND categoria = 'Proveedores' AND monto = 250.50 AND usuario_id = 8806) FROM movimientos_contables WHERE referencia = 'recepcion_compra/88000000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) = 0 FROM cuentas_por_pagar WHERE referencia = 'recepcion_compra/88000000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) = 1 AND bool_and(usuario = 'Bolsas 88') FROM inventario_mov WHERE operacion_id = '88000000-0000-0000-0000-00000000c001'), '088-70 compra de contado: stock +100, exactamente un egreso de proveedor por 250.50, actor canónico');
SELECT t88_assert((t88_j('rc1r') ->> 'replay') = 'true', '088-71 reintento de la misma recepción: replay, sin stock ni egreso duplicados');
SELECT t88_assert((SELECT stock = 12 FROM productos WHERE sku = 'P88-M')
  AND (SELECT count(*) = 1 AND bool_and(monto_original = 80 AND saldo_pendiente = 80 AND proveedor = 'Hielos T88') FROM cuentas_por_pagar WHERE referencia = 'recepcion_compra/88000000-0000-0000-0000-00000000c002')
  AND (SELECT count(*) = 0 FROM movimientos_contables WHERE referencia = 'recepcion_compra/88000000-0000-0000-0000-00000000c002'), '088-81 compra a crédito: stock +7, exactamente una cuenta por pagar, sin egreso de contado');
-- Atomicidad: se fuerza la falla del efecto financiero y luego la del stock.
CREATE OR REPLACE FUNCTION t88_falla() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T88 falla forzada'; END $$;
BEGIN;
CREATE TRIGGER t88_falla_cxp BEFORE INSERT ON cuentas_por_pagar FOR EACH ROW EXECUTE FUNCTION t88_falla();
SET LOCAL ROLE authenticated; SELECT t88_actor(6);
SELECT t88_err($q$SELECT registrar_recepcion_compra('88000000-0000-0000-0000-00000000c004', 'P88-M', 3, 30, 'Hielos T88', true)$q$, '088-82 falla del efecto financiero: la recepción completa se revierte', 'P0001', '%falla forzada%');
RESET ROLE;
SELECT t88_assert((SELECT stock = 12 FROM productos WHERE sku = 'P88-M') AND (SELECT count(*) = 0 FROM stock_operaciones WHERE operacion_id = '88000000-0000-0000-0000-00000000c004'), '088-83 stock sin cambio y sin operación registrada');
ROLLBACK;
BEGIN;
CREATE TRIGGER t88_falla_prod BEFORE UPDATE ON productos FOR EACH ROW WHEN (NEW.sku = 'P88-M') EXECUTE FUNCTION t88_falla();
SET LOCAL ROLE authenticated; SELECT t88_actor(6);
SELECT t88_err($q$SELECT registrar_recepcion_compra('88000000-0000-0000-0000-00000000c005', 'P88-M', 3, 30, 'Hielos T88', false)$q$, '088-84 falla del stock: la recepción completa se revierte', 'P0001', '%falla forzada%');
RESET ROLE;
SELECT t88_assert((SELECT count(*) = 0 FROM movimientos_contables WHERE referencia = 'recepcion_compra/88000000-0000-0000-0000-00000000c005'), '088-85 sin registro financiero');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 1, 5, 'x', false)$q$, '088-86 Chofer: recepción de compra denegada', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(5);
SELECT t88_err($q$SELECT registrar_recepcion_compra(gen_random_uuid(), 'P88-E', 1, 5, 'x', false)$q$, '088-87 Producción: recepción de compra denegada', '42501');
ROLLBACK;

\echo '── 088: sin egreso genérico ni stock genérico de producto'
DO $do$
DECLARE k INTEGER;
BEGIN
  FOREACH k IN ARRAY ARRAY[3, 5, 6, 8] LOOP
    PERFORM t88_actor(k); SET LOCAL ROLE authenticated;
    PERFORM t88_err($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Egreso', 'Proveedores', 'T88 egreso', 10)$q$, '088-90 rol ' || k || ': INSERT directo de egreso denegado', '42501');
    PERFORM t88_err($q$INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, saldo_pendiente, categoria) VALUES ('x', 'T88 cxp', 10, 10, 'Proveedores')$q$, '088-91 rol ' || k || ': INSERT directo de cuenta por pagar denegado', '42501');
    PERFORM t88_err($q$SELECT update_productos_stock_atomic('[{"sku":"P88-E","delta":5}]')$q$, '088-92 rol ' || k || ': stock genérico de producto denegado', '42501');
    RESET ROLE;
  END LOOP;
END $do$;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(5);
SELECT t88_err($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha) VALUES ('Producción', 'Costo de Ventas', 'T88', 1, '2026-09', CURRENT_DATE)$q$, '088-93 Producción: INSERT de costos_historial denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(1);
-- 095: sin llamadores vigentes, el RPC genérico de producto ya no es ejecutable por la API.
DO $do$ DECLARE r95 BOOLEAN := NOT has_function_privilege('authenticated', 'public.update_productos_stock_atomic(jsonb)', 'EXECUTE'); BEGIN
  PERFORM t88_err($q$SELECT update_productos_stock_atomic('[{"sku":"P88-ZZ","delta":5}]')$q$, '088-94 Admin: SKU inexistente rechazado (o sin EXECUTE tras 095)', CASE WHEN r95 THEN '42501' ELSE '22023' END);
  PERFORM t88_err($q$SELECT update_productos_stock_atomic('[{"sku":"P88-E","delta":-100000}]')$q$, '088-95 Admin: stock negativo rechazado (o sin EXECUTE tras 095)', CASE WHEN r95 THEN '42501' ELSE 'P0001' END);
  PERFORM t88_err($q$SELECT update_productos_stock_atomic('[{"sku":"P88-E","delta":0}]')$q$, '088-96 Admin: delta 0 rechazado (o sin EXECUTE tras 095)', CASE WHEN r95 THEN '42501' ELSE '22023' END);
END $do$;
ROLLBACK;

\echo '── 088: auditoría y errores'
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(2);
INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('Admin 88', 'Prueba', 'T88', 'T88 atribución');
INSERT INTO error_log (tipo, mensaje, usuario_id) VALUES ('t88', 'T88 error', 8801);
COMMIT;
SELECT t88_assert((SELECT usuario = 'Ventas 88' FROM auditoria WHERE detalle = 'T88 atribución') AND (SELECT usuario_id = 8802 FROM error_log WHERE mensaje = 'T88 error'), '088-100 la identidad en auditoría y errores la fija el servidor');
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(8);
SELECT t88_err($q$INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('x', 'Prueba', 'T88', 'T88 inactivo')$q$, '088-101 usuario inactivo: auditoría denegada', '42501');
ROLLBACK;

\echo '── 088: ventas exprés y crédito (cierre financiero)'
DO $$ BEGIN
  PERFORM t88_actor(3); SET LOCAL ROLE authenticated;
  PERFORM confirmar_carga_ruta('88000000-0000-0000-0000-00000000a801'::uuid, 8801, 'firma');
  UPDATE rutas SET estatus = 'En progreso' WHERE id = 8801;
  PERFORM t88_actor(9);
  PERFORM confirmar_carga_ruta('88000000-0000-0000-0000-00000000a803'::uuid, 8803, 'firma');
  UPDATE rutas SET estatus = 'En progreso' WHERE id = 8803;
  RESET ROLE;
END $$;
INSERT INTO t88_ids VALUES ('m0', (SELECT count(*) FROM ordenes WHERE ruta_id = 8801)::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P88-A","cant":-2,"precio":30}]}]')$q$, '088-110 cantidad negativa rechazada antes de cualquier efecto', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P88-A","cant":0,"precio":30}]}]')$q$, '088-111 cantidad 0 rechazada', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P88-A","cant":2,"precio":-30}]}]')$q$, '088-112 precio negativo rechazado', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P88-A","cant":2,"precio":1}]}]')$q$, '088-113 precio distinto del vigente rechazado', '22023', '%precio vigente%');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"clienteId":8842,"pago":"Efectivo","items":[{"sku":"P88-A","cant":2,"precio":30}]}]')$q$, '088-114 cliente con precio especial: el precio de catálogo no aplica', '22023', '%precio vigente%');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P88-ZZ","cant":1,"precio":30}]}]')$q$, '088-115 SKU inexistente rechazado antes de efectos', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Trueque","items":[{"sku":"P88-A","cant":1,"precio":30}]}]')$q$, '088-116 método de pago inválido rechazado', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"clienteId":8840,"pago":"Crédito","items":[{"sku":"P88-A","cant":1,"precio":30}]}]')$q$, '088-117 crédito exprés sin autorización rechazado', '22023', '%crédito autorizado%');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"clienteId":8843,"pago":"Crédito","items":[{"sku":"P88-A","cant":4,"precio":30}]}]')$q$, '088-118 crédito exprés sobre el límite (120 > 100) rechazado', '22023', '%Excede límite%');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"pago":"Crédito","items":[{"sku":"P88-A","cant":1,"precio":30}]}]')$q$, '088-119 crédito exprés sin cliente rechazado', '22023');
SELECT t88_err($q$SELECT cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f101'::uuid, 8801, '[{"express":true,"clienteId":8840,"factura":true,"pago":"Efectivo","items":[{"sku":"P88-A","cant":1,"precio":30}]}]')$q$, '088-120 factura con RFC genérico rechazada', '22023');
ROLLBACK;
SELECT t88_assert((SELECT count(*)::text FROM ordenes WHERE ruta_id = 8801) = (SELECT v FROM t88_ids WHERE k = 'm0') AND (SELECT count(*) = 0 FROM cierres_financieros_ruta WHERE ruta_id = 8801), '088-121 ninguna venta exprés, pago ni marca tras los rechazos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(3);
INSERT INTO t88_ids VALUES ('f1', cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f102'::uuid, 8801,
  '[{"ordenId":8821,"pago":"Efectivo"},{"express":true,"clienteId":8843,"pago":"Crédito","items":[{"sku":"P88-A","cant":2,"precio":30}]},{"express":true,"clienteId":8842,"pago":"Efectivo","items":[{"sku":"P88-A","cant":2}]}]', 8801, 'Otro')::text);
INSERT INTO t88_ids VALUES ('f1r', cerrar_ruta_financiero('88000000-0000-0000-0000-00000000f102'::uuid, 8801,
  '[{"ordenId":8821,"pago":"Efectivo"},{"express":true,"clienteId":8843,"pago":"Crédito","items":[{"sku":"P88-A","cant":2,"precio":30}]},{"express":true,"clienteId":8842,"pago":"Efectivo","items":[{"sku":"P88-A","cant":2}]}]', 8801, 'Otro')::text);
COMMIT;
SELECT t88_assert((t88_j('f1') ->> 'replay') = 'false' AND (t88_j('f1r') ->> 'replay') = 'true' AND (SELECT count(*) = 2 FROM ordenes WHERE ruta_id = 8801 AND id <> 8821), '088-122 exprés válida dentro del límite: cierre registrado; replay sin duplicar');
SELECT t88_assert((SELECT count(*) = 1 AND bool_and(monto_original = 60) FROM cuentas_por_cobrar c JOIN ordenes o ON o.id = c.orden_id WHERE o.ruta_id = 8801 AND o.cliente_id = 8843) AND (SELECT saldo = 60 FROM clientes WHERE id = 8843)
  AND (SELECT count(*) = 1 AND bool_and(l.precio_unit = 25.50 AND o.total = 51) FROM ordenes o JOIN orden_lineas l ON l.orden_id = o.id WHERE o.ruta_id = 8801 AND o.cliente_id = 8842), '088-123 CxC y saldo del mismo cliente validado; precio especial del cliente aplicado');
SELECT t88_assert((SELECT bool_and(vendedor_id = 8803) FROM ordenes WHERE ruta_id = 8801 AND id <> 8821) AND (SELECT bool_and(p.usuario_id = 8803) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 8801), '088-124 atribución: vendedor y pagos = chofer del JWT (el id enviado se ignora)');

\echo '── 088: ruta cargada y cerrada es terminal (Admin incluido)'
UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8803;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(1);
SELECT t88_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 8803$q$, '088-130 Admin: Cerrada → En progreso denegado', '42501');
SELECT t88_err($q$UPDATE rutas SET estatus = 'Cargada' WHERE id = 8803$q$, '088-131 Admin: Cerrada → Cargada denegado', '42501');
SELECT t88_err($q$UPDATE rutas SET estatus = 'Programada' WHERE id = 8803$q$, '088-132 Admin: Cerrada → Programada denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t88_actor(9);
SELECT t88_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 8803$q$, '088-133 Chofer: reapertura denegada', '42501');
ROLLBACK;

\echo '── 088: roles'
SELECT t88_err($q$INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES (8829, 'T88 rol', 't88rol@t', 'Almacén', 'Activo')$q$, '088-140 rol muerto Almacén no se puede asignar', '23514');
SELECT t88_err($q$INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES (8829, 'T88 rol', 't88rol@t', 'Bolsas', 'Activo')$q$, '088-141 rol muerto Bolsas no se puede asignar', '23514');

BEGIN; SELECT t88_limpiar(); COMMIT;
DROP FUNCTION IF EXISTS t88_falla() CASCADE;
\echo '── 088: TODAS LAS PRUEBAS OK'
