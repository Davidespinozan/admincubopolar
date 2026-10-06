-- 110_contencion_entrega_directa_test.sql — guarda de entrega directa (OL-02D2):
-- fuera del contexto de contrato nadie (Ventas, Admin, service role) lleva a
-- 'Entregada' una orden que no tenía ruta; la venta directa atómica (109), la
-- entrega con ruta (chofer en línea / offline, Admin), el cierre de ruta y la
-- cancelación de CFDI siguen igual; un intento rechazado no deja efectos.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t110_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11001 AND 11039;
  DELETE FROM inventario_mov WHERE producto LIKE 'P110-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '11000000-%' OR orden_id BETWEEN 11001 AND 11039;
  DELETE FROM pagos WHERE orden_id BETWEEN 11001 AND 11039;
  DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 11001 AND 11039;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11001 AND 11039;
  DELETE FROM ordenes WHERE id BETWEEN 11001 AND 11039;
  DELETE FROM rutas WHERE id BETWEEN 11001 AND 11009;
  DELETE FROM auditoria WHERE detalle LIKE 'OV-110%' OR detalle LIKE 'Orden #110%';
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-110%';
  DELETE FROM productos WHERE sku LIKE 'P110-%';
  DELETE FROM clientes WHERE id BETWEEN 11001 AND 11009;
  DELETE FROM usuarios WHERE id BETWEEN 11001 AND 11009;
  DELETE FROM auth.users WHERE id::text LIKE '11000000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t110_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t110' FROM generate_series(1, 6) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11001, 'Admin 110',  'u1@t110', 'Admin',          'Activo', '11000000-0000-0000-0000-000000000001'),
  (11002, 'Ventas 110', 'u2@t110', 'Ventas',         'Activo', '11000000-0000-0000-0000-000000000002'),
  (11003, 'Chofer 110', 'u3@t110', 'Chofer',         'Activo', '11000000-0000-0000-0000-000000000003'),
  (11004, 'Prod 110',   'u4@t110', 'Producción',     'Activo', '11000000-0000-0000-0000-000000000004'),
  (11005, 'Fact 110',   'u5@t110', 'Facturación',    'Activo', '11000000-0000-0000-0000-000000000005'),
  (11006, 'Bolsas 110', 'u6@t110', 'Almacén Bolsas', 'Activo', '11000000-0000-0000-0000-000000000006');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11001, 'Cliente 110', 'XAXX010101000', 0, true, 1000);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P110-A', 'Hielo A 110', 'Producto Terminado', 20, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-110A', 'Cuarto 110A', '{"P110-A": 50}');
INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (11001, 'R-11001', 'T110 ruta', 'En progreso', 11003, '{}', '{}', '{}', '{}'),
  (11002, 'R-11002', 'T110 ruta 2', 'Programada', NULL, '{}', '{}', '{}', '{}');   -- sin chofer: una ruta activa por chofer
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (11001, 'OV-11001', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, NULL),
  (11002, 'OV-11002', 11001, 'Cliente 110', 'x', 40, 'Creada',       'Efectivo', 'Contado', 11002, NULL),
  (11003, 'OV-11003', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, NULL),
  (11004, 'OV-11004', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, 11001),
  (11005, 'OV-11005', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, 11001),
  (11006, 'OV-11006', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, 11001),
  (11007, 'OV-11007', 11001, 'Cliente 110', 'x', 40, 'Facturada',    'Efectivo', 'Contado', 11002, NULL),
  (11008, 'OV-11008', 11001, 'Cliente 110', 'x', 40, 'En ruta',      'Efectivo', 'Contado', 11002, 11001),
  (11009, 'OV-11009', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, NULL),
  (11010, 'OV-11010', 11001, 'Cliente 110', 'x', 40, 'Cancelada',    'Efectivo', 'Contado', 11002, NULL),
  (11011, 'OV-11011', 11001, 'Cliente 110', 'x', 40, 'No entregada', 'Efectivo', 'Contado', 11002, NULL),
  (11012, 'OV-11012', 11001, 'Cliente 110', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11002, 11001),
  (11013, 'OV-11013', 11001, 'Cliente 110', 'x', 40, 'Creada',       'Efectivo', 'Contado', 11002, NULL),
  (11014, 'OV-11014', 11001, 'Cliente 110', 'x', 40, 'En ruta',      'Efectivo', 'Contado', 11002, NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'P110-A', 2, 20, 40 FROM ordenes WHERE id BETWEEN 11001 AND 11014;
COMMIT;

CREATE OR REPLACE FUNCTION t110_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t110_servicio() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t110_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t110_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
-- Ejecuta un UPDATE y devuelve cuántas filas cambió (para RLS que filtra sin error).
CREATE OR REPLACE FUNCTION t110_upd(p_sql TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t110_est(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus::text FROM ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t110_cf() RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> 'P110-A')::int, 0) FROM cuartos_frios WHERE id = 'CF-110A' $$;
CREATE OR REPLACE FUNCTION t110_efectos(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT count(*) FROM pagos WHERE orden_id = p_id) || '/' || (SELECT count(*) FROM cuentas_por_cobrar WHERE orden_id = p_id) || '/'
      || (SELECT count(*) FROM movimientos_contables WHERE orden_id = p_id) || '/' || (SELECT count(*) FROM inventario_mov WHERE referencia = 'venta_directa/' || p_id) || '/'
      || (SELECT count(*) FROM stock_operaciones WHERE orden_id = p_id) || '/' || (SELECT CASE WHEN delivered_at IS NULL THEN 'sin_entrega' ELSE 'con_entrega' END FROM ordenes WHERE id = p_id)
$$;
GRANT EXECUTE ON FUNCTION t110_actor(INTEGER), t110_servicio(), t110_assert(BOOLEAN, TEXT), t110_err(TEXT, TEXT, TEXT, TEXT), t110_upd(TEXT), t110_est(BIGINT), t110_cf(), t110_efectos(BIGINT) TO PUBLIC;

\echo '── 110: guarda instalada y sin superficie de API'
SELECT t110_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp'
                     AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                    FROM pg_proc WHERE oid = 'public.ordenes_guard_entrega_directa()'::regprocedure)
  AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgname = 'trg_ordenes_guard_entrega_directa' AND t.tgrelid = 'public.ordenes'::regclass AND NOT t.tgisinternal)
  AND (SELECT pg_get_triggerdef(oid) ~ 'BEFORE UPDATE OF estatus ON public.ordenes FOR EACH ROW' FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_entrega_directa')
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_financiero'),
  '110-00 función SECURITY DEFINER con search_path fijo, sin EXECUTE para anon/authenticated; trigger BEFORE UPDATE OF estatus; la guarda 105 sigue');

\echo '── 110: el camino heredado sin ruta se rechaza para todos (fuera de contrato)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(2);
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11001$q$, '110-01 Ventas (cliente viejo): Asignada sin ruta → Entregada rechazada', '42501', '%completar_venta_directa%');
SELECT t110_actor(1);
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11001$q$, '110-02 Admin: Asignada sin ruta → Entregada rechazada', '42501', '%completar_venta_directa%');
SELECT t110_err($q$UPDATE ordenes SET ruta_id = 11001, estatus = 'Entregada' WHERE id = 11009$q$, '110-04 Admin: poner ruta y Entregada en el mismo UPDATE rechazado (se mira la ruta ANTERIOR)', '42501', '%completar_venta_directa%');
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11014$q$, '110-04b En ruta sin ruta → Entregada rechazada', '42501');
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11002$q$, '110-13 Creada sin ruta → Entregada sigue rechazada (primero 110 por orden de triggers; 105 también la niega)', '42501');
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11010$q$, '110-19a Cancelada → Entregada: sigue negada por 105 (110 no abre transiciones)', '42501', '%no permitida%');
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11011$q$, '110-19b No entregada → Entregada: sigue negada por 105', '42501', '%no permitida%');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t110_servicio();
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'QR / Link de pago' WHERE id = 11001$q$, '110-03 service role: Asignada sin ruta → Entregada rechazada (sin excepción por rol)', '42501', '%completar_venta_directa%');
SELECT t110_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11013$q$, '110-03b service role: Creada sin ruta → Entregada rechazada', '42501');
COMMIT;
SELECT t110_assert(t110_est(11001) = 'Asignada' AND t110_est(11002) = 'Creada' AND t110_est(11009) = 'Asignada' AND (SELECT ruta_id IS NULL FROM ordenes WHERE id = 11009)
  AND t110_est(11010) = 'Cancelada' AND t110_est(11011) = 'No entregada' AND t110_est(11013) = 'Creada' AND t110_est(11014) = 'En ruta',
  '110-14a tras los rechazos (confirmados) ninguna orden cambió');
SELECT t110_assert(t110_efectos(11001) = '0/0/0/0/0/sin_entrega' AND t110_efectos(11009) = '0/0/0/0/0/sin_entrega' AND t110_cf() = 50
  AND (SELECT count(*) = 0 FROM inventario_mov WHERE producto LIKE 'P110-%'),
  '110-14/15 intento heredado rechazado: sin pago, CxC, ingreso, kardex, operación ni fecha de entrega; existencia intacta (50)');

\echo '── 110: los otros roles no ganan autoridad'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t110_actor(4); SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11001$q$) = 0, '110-20a Producción: sin política de UPDATE (0 filas)');
SELECT t110_actor(5); SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11001$q$) = 0, '110-20b Facturación: sin UPDATE directo (0 filas)');
SELECT t110_actor(6); SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11001$q$) = 0, '110-20c Almacén Bolsas: sin UPDATE directo (0 filas)');
SELECT t110_actor(3); SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11001$q$) = 0, '110-20d Chofer: no ve órdenes sin ruta (0 filas)');
COMMIT;
SELECT t110_assert(t110_est(11001) = 'Asignada', '110-20 tras los intentos de otros roles la orden sigue Asignada');

\echo '── 110: asignación de ruta sin entrega y webhook (solo pago) siguen'
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(1);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET ruta_id = 11002 WHERE id = 11009$q$) = 1, '110-05 Admin asigna ruta sin entregar: permitido');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t110_servicio();
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET metodo_pago = 'QR / Link de pago' WHERE id = 11013$q$) = 1, '110-16 webhook tras OL-02D1 (solo metodo_pago): permitido; no toca estatus');
COMMIT;
SELECT t110_assert((SELECT ruta_id = 11002 AND estatus::text = 'Asignada' FROM ordenes WHERE id = 11009) AND t110_est(11013) = 'Creada'
  AND (SELECT metodo_pago FROM ordenes WHERE id = 11013) = 'QR / Link de pago',
  '110-05/16 la ruta quedó asignada sin entrega; la orden pagada por link sigue Creada');

\echo '── 110: la venta directa atómica (contrato) sigue funcionando'
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(2);
SELECT completar_venta_directa('11000000-0000-0000-0000-000000000a02', 11002, 'contado', 'Efectivo', '[{"sku":"P110-A","cuarto_id":"CF-110A","cantidad":2}]');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(2);
SELECT completar_venta_directa('11000000-0000-0000-0000-000000000a03', 11003, 'credito', 'Crédito (fiado)', '[{"sku":"P110-A","cuarto_id":"CF-110A","cantidad":2}]');
COMMIT;
SELECT t110_assert(t110_est(11002) = 'Entregada' AND t110_efectos(11002) = '1/0/1/1/1/con_entrega', '110-06 Creada sin ruta → completar_venta_directa (contado): Entregada, un pago, un ingreso, una salida, una operación');
SELECT t110_assert(t110_est(11003) = 'Entregada' AND t110_efectos(11003) = '0/1/0/1/1/con_entrega', '110-07 Asignada sin ruta → completar_venta_directa (crédito): Entregada, una CxC, una salida, una operación');
SELECT t110_assert(t110_cf() = 46, '110-06/07 existencia exacta: 50 − 2 − 2 = 46');
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(2);
SELECT t110_err($q$SELECT completar_venta_directa('11000000-0000-0000-0000-000000000a12', 11012, 'contado', 'Efectivo', '[{"sku":"P110-A","cuarto_id":"CF-110A","cantidad":2}]')$q$,
  '110-17 orden con ruta: completar_venta_directa la sigue rechazando', '22023', '%tiene ruta%');
COMMIT;

\echo '── 110: la entrega con ruta sigue igual'
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(3);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11004$q$) = 1, '110-08a Chofer (en línea): Asignada de su ruta → Entregada');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(3);
SELECT t110_assert((registrar_pago_orden(11004, 'Efectivo', NULL, NULL) ->> 'aplicado')::boolean, '110-08b Chofer: el cobro de la entrega se registra');
COMMIT;
-- Cola offline: el replay es la misma mutación (updateOrdenEstatus = UPDATE + registrar_pago_orden); se reintenta dos veces.
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(3);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11005$q$) = 1, '110-09a Chofer offline (replay 1): Entregada');
SELECT t110_assert((registrar_pago_orden(11005, 'Efectivo', NULL, NULL) ->> 'aplicado')::boolean, '110-09b replay 1: cobro registrado');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(3);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11005$q$) = 1, '110-09c Chofer offline (replay 2, ya Entregada): sin transición, sin error');
SELECT t110_assert((registrar_pago_orden(11005, 'Efectivo', NULL, NULL) ->> 'aplicado')::boolean IS NOT TRUE, '110-09d replay 2: el cobro no se duplica');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(3);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11008$q$) = 1, '110-08c Chofer: En ruta (con ruta) → Entregada');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t110_actor(1);
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 11006$q$) = 1, '110-10 Admin: entrega de orden con ruta → Entregada (flujo de ruta sin cambio)');
COMMIT;
SELECT t110_assert(t110_est(11004) = 'Entregada' AND t110_est(11005) = 'Entregada' AND t110_est(11006) = 'Entregada' AND t110_est(11008) = 'Entregada'
  AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 11005) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 11004),
  '110-08/09/10 entregas con ruta confirmadas; el replay offline dejó un solo pago');

\echo '── 110: cierre de ruta y cancelación de CFDI'
SELECT t110_assert((SELECT strpos(d, 'fin_marcar_ctx()') > 0 AND strpos(d, 'fin_marcar_ctx()') < strpos(d, 'SET estatus = ''Entregada''')
                    FROM (SELECT pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure) AS d) x),
  '110-11 cerrar_ruta_financiero marca el contexto de contrato ANTES de entregar (las suites del cierre corren tras 110)');
BEGIN; SET LOCAL ROLE service_role; SELECT t110_servicio();
SELECT t110_assert(t110_upd($q$UPDATE ordenes SET estatus = 'Entregada', cfdi_cancelado_at = now() WHERE id = 11007$q$) = 1, '110-12 cancelación de CFDI (service role): Facturada → Entregada permitida');
COMMIT;
SELECT t110_assert(t110_est(11007) = 'Entregada', '110-12 la orden vuelve a Entregada tras cancelar el CFDI');

BEGIN; SELECT t110_limpiar(); COMMIT;
\echo '── 110: TODAS LAS PRUEBAS OK'
