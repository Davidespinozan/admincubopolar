-- 112_contencion_facturada_test.sql — OL-03B: 'Facturada' solo desde 'Entregada'
-- por el contrato de timbrado y de vuelta solo por la cancelación confirmada,
-- para CUALQUIER actor (service role, sesión sin JWT, Admin, Ventas, contexto
-- financiero). El cierre de ruta conserva 'Facturada'.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t112_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 11201 AND 11209;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11201 AND 11239;
  DELETE FROM pagos WHERE orden_id BETWEEN 11201 AND 11239;
  DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 11201 AND 11239;
  DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11201 AND 11239;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11201 AND 11239;
  DELETE FROM ordenes WHERE id BETWEEN 11201 AND 11239 OR folio LIKE 'OV-112X%';
  DELETE FROM rutas WHERE id BETWEEN 11201 AND 11209;
  DELETE FROM auditoria WHERE detalle LIKE 'OV-112%' OR detalle LIKE 'Orden #112%';
  DELETE FROM clientes WHERE id = 11201;
  DELETE FROM usuarios WHERE id BETWEEN 11201 AND 11209;
  DELETE FROM auth.users WHERE id::text LIKE '11200000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t112_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11200000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t112' FROM generate_series(1, 4) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11201, 'Admin 112',  'u1@t112', 'Admin',       'Activo', '11200000-0000-0000-0000-000000000001'),
  (11202, 'Ventas 112', 'u2@t112', 'Ventas',      'Activo', '11200000-0000-0000-0000-000000000002'),
  (11203, 'Chofer 112', 'u3@t112', 'Chofer',      'Activo', '11200000-0000-0000-0000-000000000003'),
  (11204, 'Fact 112',   'u4@t112', 'Facturación', 'Activo', '11200000-0000-0000-0000-000000000004');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11201, 'Cliente 112', 'XAXX010101000', 0, true, 1000);
INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (11201, 'R-11201', 'T112 ruta', 'En progreso', 11203, '{}', '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id, facturama_id, facturama_uuid) VALUES
  (11201, 'OV-11201', 11201, 'Cliente 112', 'x', 40, 'Creada',       'Efectivo', 'Contado', 11202, NULL,  NULL, NULL),
  (11202, 'OV-11202', 11201, 'Cliente 112', 'x', 40, 'Asignada',     'Efectivo', 'Contado', 11202, NULL,  NULL, NULL),
  (11203, 'OV-11203', 11201, 'Cliente 112', 'x', 40, 'En ruta',      'Efectivo', 'Contado', 11202, 11201, NULL, NULL),
  (11204, 'OV-11204', 11201, 'Cliente 112', 'x', 40, 'Cancelada',    'Efectivo', 'Contado', 11202, NULL,  NULL, NULL),
  (11205, 'OV-11205', 11201, 'Cliente 112', 'x', 40, 'No entregada', 'Efectivo', 'Contado', 11202, 11201, NULL, NULL),
  (11206, 'OV-11206', 11201, 'Cliente 112', 'x', 40, 'Entregada',    'Efectivo', 'Contado', 11202, NULL,  NULL, NULL),
  (11207, 'OV-11207', 11201, 'Cliente 112', 'x', 40, 'Facturada',    'Efectivo', 'Contado', 11202, NULL,  'FM-7', 'UUID-7'),
  -- Cierre de ruta: una entregada por el chofer y facturada ANTES del cierre; otra Facturada con cancelación pendiente; otra normal.
  (11211, 'OV-11211', 11201, 'Cliente 112', 'x', 40, 'Facturada',    'Efectivo', 'Contado', 11202, 11201, 'FM-11', 'UUID-11'),
  (11212, 'OV-11212', 11201, 'Cliente 112', 'x', 40, 'Facturada',    'Efectivo', 'Contado', 11202, 11201, 'FM-12', 'UUID-12'),
  (11213, 'OV-11213', 11201, 'Cliente 112', 'x', 40, 'En ruta',      'Efectivo', 'Contado', 11202, 11201, NULL, NULL);
UPDATE ordenes SET delivered_at = now() WHERE id IN (11206, 11207, 11211, 11212);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'HPC-5K', 2, 20, 40 FROM ordenes WHERE id BETWEEN 11201 AND 11213;
COMMIT;

CREATE OR REPLACE FUNCTION t112_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t112_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t112_upd(p_sql TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t112_srv() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t112_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11200000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t112_ord(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT estatus || '|' || COALESCE(facturama_uuid, '-') || '|' || CASE WHEN cfdi_cancelado_at IS NULL THEN 'vigente' ELSE 'cancelado' END FROM ordenes WHERE id = p_id $$;
GRANT EXECUTE ON FUNCTION t112_assert(BOOLEAN, TEXT), t112_err(TEXT, TEXT, TEXT, TEXT), t112_upd(TEXT), t112_srv(), t112_auth(INTEGER), t112_ord(BIGINT) TO PUBLIC;

\echo '── 112: guarda instalada, sin superficie de API'
SELECT t112_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp'
                      AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                    FROM pg_proc WHERE oid = 'public.ordenes_guard_facturada()'::regprocedure)
  AND (SELECT pg_get_triggerdef(oid) ~ 'BEFORE INSERT OR UPDATE OF estatus ON public.ordenes FOR EACH ROW' FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_facturada')
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_entrega_directa') AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_financiero'),
  '112-00 guarda SECURITY DEFINER con search_path fijo, sin EXECUTE para anon/authenticated; trigger BEFORE INSERT OR UPDATE OF estatus; 105 y 110 siguen');

\echo '── 112: escritura directa → Facturada, rechazada para todo actor'
-- service role (Netlify / backend), con CFDI completo en el UPDATE
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv();
SELECT t112_err(format($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-%s' WHERE id = %s$q$, o, o), '112-01 service role: ' || e || ' → Facturada', '42501', '%solo por el contrato de timbrado%')
  FROM (VALUES (11201, 'Creada'), (11202, 'Asignada'), (11203, 'En ruta'), (11204, 'Cancelada'), (11205, 'No entregada')) v(o, e);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-6' WHERE id = 11206$q$, '112-02 service role: Entregada → Facturada SIN contexto de timbrado', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada', cfdi_cancelado_at = now() WHERE id = 11207$q$, '112-03 service role: Facturada → Entregada SIN contexto de cancelación (cerraba el trampolín)', '42501', '%cancelación confirmada%');
SELECT t112_err($q$INSERT INTO ordenes (folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES ('OV-112X1', 'x', 'x', 1, 'Facturada', 'Efectivo', 'Contado')$q$, '112-04 service role: INSERT directo como Facturada', '42501', '%no se crea Facturada%');
ROLLBACK;
-- contexto financiero amplio (app.fin_ctx = rpc) no basta
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv(); SELECT set_config('app.fin_ctx', 'rpc', true);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-6' WHERE id = 11206$q$, '112-05 app.fin_ctx (contratos financieros) NO autoriza Facturada', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada', cfdi_cancelado_at = now() WHERE id = 11207$q$, '112-06 app.fin_ctx NO autoriza salir de Facturada', '42501');
ROLLBACK;
-- sesión sin JWT (SQL directo)
BEGIN; SELECT set_config('request.jwt.claims', '', true);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-1' WHERE id = 11201$q$, '112-07 sin JWT: Creada → Facturada', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-6' WHERE id = 11206$q$, '112-08 sin JWT: Entregada → Facturada sin contexto', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Cancelada' WHERE id = 11207$q$, '112-09 sin JWT: Facturada → Cancelada', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada', cfdi_cancelado_at = now() WHERE id = 11207$q$, '112-10 sin JWT: Facturada → Entregada sin contexto', '42501');
ROLLBACK;
-- contexto de timbrado pero sin CFDI, o desde otro estatus; contexto cruzado
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv(); SELECT set_config('app.cfdi_ctx', 'emision', true);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada' WHERE id = 11206$q$, '112-11 contexto de timbrado sin facturama_id/uuid', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-1' WHERE id = 11201$q$, '112-12 contexto de timbrado desde Creada', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada', cfdi_cancelado_at = now() WHERE id = 11207$q$, '112-13 contexto de timbrado no permite salir de Facturada', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv(); SELECT set_config('app.cfdi_ctx', 'cancelacion', true);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-6' WHERE id = 11206$q$, '112-14 contexto de cancelación no permite facturar', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11207$q$, '112-15 contexto de cancelación sin cfdi_cancelado_at', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Asignada', cfdi_cancelado_at = now() WHERE id = 11207$q$, '112-16 Facturada → Asignada ni con contexto de cancelación', '42501');
ROLLBACK;
-- usuarios autenticados (Admin, Ventas): 105 ya los detenía; 112 no cambia eso
BEGIN; SET LOCAL ROLE authenticated; SELECT t112_auth(1);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada' WHERE id = 11206$q$, '112-17 Admin por REST: Entregada → Facturada', '42501');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11207$q$, '112-18 Admin por REST: Facturada → Entregada', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t112_auth(2);
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada' WHERE id = 11201$q$, '112-19 Ventas por REST: Creada → Facturada', '42501');
ROLLBACK;
SELECT t112_assert(t112_ord(11201) = 'Creada|-|vigente' AND t112_ord(11206) = 'Entregada|-|vigente' AND t112_ord(11207) = 'Facturada|UUID-7|vigente',
  '112-20 ningún intento dejó efecto');

\echo '── 112: los contratos 111 siguen funcionando con la guarda'
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv();
SELECT t112_assert((finalizar_operacion_cfdi((reservar_operacion_cfdi(11206, 'emision', 11202, 'h6') ->> 'operacion_id')::uuid, 'emitida',
                     '{"proveedor_id":"FM-6","cfdi_uuid":"UUID-6"}') ->> 'estado') = 'exitosa' AND t112_ord(11206) = 'Facturada|UUID-6|vigente',
  '112-21 timbrado legítimo por contrato: Entregada → Facturada');
SELECT t112_assert((finalizar_operacion_cfdi((reservar_operacion_cfdi(11207, 'cancelacion', 11204, NULL, '02') ->> 'operacion_id')::uuid, 'cancelada', '{}') ->> 'estado') = 'exitosa'
  AND t112_ord(11207) = 'Entregada|UUID-7|cancelado', '112-22 cancelación confirmada por contrato: Facturada → Entregada');
SELECT t112_assert(current_setting('app.cfdi_ctx', true) = '', '112-23 el contexto de CFDI no queda abierto tras el contrato');
SELECT t112_err($q$UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'X', facturama_uuid = 'U-7b' WHERE id = 11207$q$, '112-24 después del contrato, una escritura directa sigue rechazada', '42501');
COMMIT;

\echo '── 112: cierre de ruta conserva Facturada'
BEGIN; SET LOCAL ROLE service_role; SELECT t112_srv();
-- 11212: cancelación solicitada y pendiente
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11212, 'cancelacion', 11201, NULL, '02') ->> 'operacion_id')::uuid, 'cancelacion_solicitada', '{"proveedor_estatus":"requested"}');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t112_auth(1);
SELECT t112_assert((cerrar_ruta_financiero('11200000-aaaa-0000-0000-000000000001'::uuid, 11201,
  '[{"ordenId":11211,"pago":"Efectivo"},{"ordenId":11212,"pago":"Efectivo"},{"ordenId":11213,"pago":"Efectivo"}]'::jsonb) ->> 'success')::boolean,
  '112-25 cierre de ruta con una orden Facturada, una Facturada con cancelación pendiente y una En ruta');
COMMIT;
SELECT t112_assert(t112_ord(11211) = 'Facturada|UUID-11|vigente' AND (SELECT facturama_id = 'FM-11' FROM ordenes WHERE id = 11211),
  '112-26 la orden ya Facturada CONSERVA Facturada y su CFDI tras el cierre (antes bajaba a Entregada)');
SELECT t112_assert(t112_ord(11212) = 'Facturada|UUID-12|vigente'
  AND (SELECT estado = 'cancelacion_pendiente' FROM cfdi_operaciones WHERE orden_id = 11212),
  '112-27 Facturada con cancelación pendiente: sigue Facturada y el cierre no toca la operación CFDI');
SELECT t112_assert(t112_ord(11213) = 'Entregada|-|vigente', '112-28 la orden normal En ruta se entrega como siempre');
SELECT t112_assert((SELECT count(*) = 1 FROM pagos WHERE orden_id = 11211) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 11212) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 11213)
  AND (SELECT count(*) = 1 FROM cierres_financieros_ruta WHERE ruta_id = 11201), '112-29 cobro de cada orden como antes (un pago por orden) y un cierre registrado');
BEGIN; SET LOCAL ROLE authenticated; SELECT t112_auth(1);
SELECT t112_assert((cerrar_ruta_financiero('11200000-aaaa-0000-0000-000000000001'::uuid, 11201,
  '[{"ordenId":11211,"pago":"Efectivo"},{"ordenId":11212,"pago":"Efectivo"},{"ordenId":11213,"pago":"Efectivo"}]'::jsonb) ->> 'replay')::boolean,
  '112-30 reintento del mismo cierre: replay (idempotencia sin cambio)');
COMMIT;
SELECT t112_assert((SELECT count(*) = 3 FROM pagos WHERE orden_id IN (11211, 11212, 11213)) AND t112_ord(11211) = 'Facturada|UUID-11|vigente',
  '112-31 el replay no duplica pagos ni cambia la factura');

BEGIN; SELECT t112_limpiar(); COMMIT;
\echo '── 112: TODAS LAS PRUEBAS OK'
