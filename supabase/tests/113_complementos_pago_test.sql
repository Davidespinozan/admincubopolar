-- 113_complementos_pago_test.sql — OL-04: complemento de pago POR PAGO sobre
-- cfdi_operaciones (reserva antes del proveedor, datos del pago, parcialidad
-- por generación de CFDI, PPD registrado al timbrar, sin efectos de negocio).
-- No hay proveedor: sus resultados se simulan con finalizar_operacion_cfdi.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t113_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11351 AND 11369;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11351 AND 11369;
  DELETE FROM pagos WHERE orden_id BETWEEN 11351 AND 11369 OR cxc_id BETWEEN 11351 AND 11369 OR referencia LIKE 'T113-%';
  DELETE FROM cuentas_por_cobrar WHERE id BETWEEN 11351 AND 11369;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11351 AND 11369;
  DELETE FROM ordenes WHERE id BETWEEN 11351 AND 11369;
  DELETE FROM clientes WHERE id = 11351;
  DELETE FROM usuarios WHERE id BETWEEN 11351 AND 11359;
  DELETE FROM auth.users WHERE id::text LIKE '11350000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t113_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11350000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t113' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11351, 'Admin 113',  'u1@t113', 'Admin',       'Activo', '11350000-0000-0000-0000-000000000001'),
  (11352, 'Ventas A',   'u2@t113', 'Ventas',      'Activo', '11350000-0000-0000-0000-000000000002'),
  (11353, 'Ventas B',   'u3@t113', 'Ventas',      'Activo', '11350000-0000-0000-0000-000000000003'),
  (11354, 'Chofer 113', 'u4@t113', 'Chofer',      'Activo', '11350000-0000-0000-0000-000000000004'),
  (11355, 'Fact 113',   'u5@t113', 'Facturación', 'Activo', '11350000-0000-0000-0000-000000000005');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11351, 'Cliente 113', 'AAA010101AAA', 0, true, 100000);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
  (11351, 'OV-11351', 11351, 'Cliente 113', 'x', 300, 'Entregada', 'Crédito (fiado)', 'Credito', 11352),   -- PPD, 3 parcialidades
  (11352, 'OV-11352', 11351, 'Cliente 113', 'x', 100, 'Entregada', 'Efectivo',        'Contado', 11352),   -- PUE
  (11353, 'OV-11353', 11351, 'Cliente 113', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito', 11352),   -- CFDI sin modo registrado
  (11354, 'OV-11354', 11351, 'Cliente 113', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito', 11352),   -- sin CFDI
  (11355, 'OV-11355', 11351, 'Cliente 113', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito', 11352),   -- saldos incoherentes
  (11356, 'OV-11356', 11351, 'Cliente 113', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito', 11352);   -- forma no determinable
UPDATE ordenes SET delivered_at = now() WHERE id BETWEEN 11351 AND 11356;
INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, estatus, concepto)
  SELECT id, 11351, id, CURRENT_DATE, CURRENT_DATE + 30, total, 0, total, 'Pendiente', 'T113' FROM ordenes WHERE id BETWEEN 11351 AND 11356;
COMMIT;

CREATE OR REPLACE FUNCTION t113_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t113_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t113_srv() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t113_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11350000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t113_op(p_id UUID) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT tipo || '|' || generacion || '|' || estado || '|' || COALESCE(parcialidad::text, '-') FROM cfdi_operaciones WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t113_efectos() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT string_agg(id || ':' || estatus, ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 11351 AND 11356) || '/'
      || (SELECT string_agg(id || ':' || monto_pagado || ':' || saldo_pendiente || ':' || estatus, ',' ORDER BY id) FROM cuentas_por_cobrar WHERE id BETWEEN 11351 AND 11356) || '/'
      || (SELECT count(*) || ':' || COALESCE(sum(monto), 0) FROM pagos WHERE cxc_id BETWEEN 11351 AND 11356) || '/'
      || (SELECT count(*) FROM movimientos_contables WHERE orden_id BETWEEN 11351 AND 11356) || '/'
      || (SELECT saldo FROM clientes WHERE id = 11351) $$;
CREATE TABLE IF NOT EXISTS t113_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT EXECUTE ON FUNCTION t113_assert(BOOLEAN, TEXT), t113_err(TEXT, TEXT, TEXT, TEXT), t113_srv(), t113_auth(INTEGER), t113_op(UUID), t113_efectos() TO PUBLIC;
GRANT ALL ON t113_ids TO PUBLIC;
TRUNCATE t113_ids;

\echo '── 113: superficie de seguridad y esquema'
SELECT t113_assert((SELECT p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                      AND NOT has_function_privilege('public', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    FROM pg_proc p WHERE p.oid = 'public.reservar_complemento_cfdi(bigint,bigint,integer)'::regprocedure)
  AND NOT has_function_privilege('service_role', 'public.cfdi_aplicar_resultado(uuid,text,jsonb)'::regprocedure, 'EXECUTE')
  AND NOT has_table_privilege('service_role', 'public.cfdi_operaciones', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.cfdi_operaciones', 'UPDATE')
  AND (SELECT pg_get_constraintdef(oid) ~ 'complemento' FROM pg_constraint WHERE conname = 'cfdi_operaciones_tipo_check')
  AND (SELECT indexdef ~ 'UNIQUE.*\(pago_id, relacionado_uuid\).*complemento.*exitosa' FROM pg_indexes WHERE indexname = 'idx_cfdi_operaciones_complemento_exitoso'),
  '113-00 reserva SECURITY DEFINER con search_path fijo y EXECUTE solo service role; tipo complemento; un éxito por pago y CFDI');
BEGIN; SET LOCAL ROLE authenticated; SELECT t113_auth(1);
SELECT t113_err($q$SELECT reservar_complemento_cfdi(1, 11351)$q$, '113-01 un usuario autenticado (Admin) no invoca la reserva', '42501');
ROLLBACK;

\echo '── 113: pago ANTES de la factura (queda guardado), factura PPD y dos pagos más'
BEGIN; SET LOCAL ROLE authenticated; SELECT t113_auth(1);
INSERT INTO t113_ids SELECT 'p1', abonar_cxc(11351, 100, 'Efectivo', 'T113-ref-1') ->> 'pago_id';
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351) ->> 'codigo') = 'SIN_CFDI_VIGENTE',
  '113-02 pago registrado antes de la factura: aún no elegible (SIN_CFDI_VIGENTE), sin operación');
SELECT t113_assert((SELECT count(*) = 0 FROM cfdi_operaciones WHERE orden_id = 11351), '113-03 no se reservó nada');
-- Timbrado de la orden (contrato 111) registrando que el CFDI se emitió PPD.
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11351, 'emision', 11351, 'h1') ->> 'operacion_id')::uuid, 'emitida',
  '{"proveedor_id":"FM-I1","cfdi_uuid":"UUID-I1","metodo_pago_sat":"PPD"}');
SELECT t113_assert((SELECT estatus = 'Facturada' FROM ordenes WHERE id = 11351)
  AND (SELECT cfdi_metodo_pago = 'PPD' FROM cfdi_operaciones WHERE orden_id = 11351 AND tipo = 'emision'), '113-04 factura PPD: el modo fiscal queda registrado en la operación de emisión');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t113_auth(1);
INSERT INTO t113_ids SELECT 'p2', abonar_cxc(11351, 120, 'Transferencia SPEI', 'T113-ref-2') ->> 'pago_id';
INSERT INTO t113_ids SELECT 'p3', abonar_cxc(11351, 80, 'Tarjeta (terminal)', 'T113-ref-3') ->> 'pago_id';
COMMIT;
INSERT INTO t113_ids VALUES ('efectos0', t113_efectos());

\echo '── 113: parcialidades en orden; datos del pago; un éxito por pago'
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p2')::bigint, 11351) ->> 'codigo') = 'COMPLEMENTO_ANTERIOR_PENDIENTE'
  AND (reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p2')::bigint, 11351) ->> 'pago_pendiente') = (SELECT v FROM t113_ids WHERE k = 'p1'),
  '113-05 el pago 2 espera a que el pago 1 tenga su complemento');
INSERT INTO t113_ids SELECT 'r1', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11355)::text;
SELECT t113_assert(((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'ok')::boolean
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'parcialidad')::int = 1
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'importe_pagado')::numeric = 100
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'saldo_anterior')::numeric = 300
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'saldo_insoluto')::numeric = 200
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'forma_pago') = '01'
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'fecha_pago') = (SELECT to_char(fecha, 'YYYY-MM-DD') FROM pagos WHERE id = (SELECT v FROM t113_ids WHERE k = 'p1')::bigint)
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'relacionado_uuid') = 'UUID-I1'
  AND ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'folio') = 'P' || (SELECT v FROM t113_ids WHERE k = 'p1') || 'G1',
  '113-06 Facturación reserva el pago 1 (anterior a la factura): parcialidad 1, $100, 300 → 200, forma 01, fecha = pagos.fecha, CFDI relacionado UUID-I1, folio estable');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351) ->> 'codigo') = 'OPERACION_EN_CURSO',
  '113-07 misma solicitud mientras está en curso → OPERACION_EN_CURSO (no cruza al proveedor)');
SELECT t113_assert((reservar_operacion_cfdi(11351, 'cancelacion', 11351, NULL, '02') ->> 'codigo') = 'OPERACION_EN_CURSO',
  '113-08 la serialización por orden de 111 se conserva: no se puede cancelar la factura mientras un complemento está en curso');
SELECT t113_assert((finalizar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'operacion_id')::uuid, 'emitida',
                     '{"proveedor_id":"FM-P1","cfdi_uuid":"UUID-P1"}') ->> 'estado') = 'exitosa',
  '113-09 complemento timbrado → exitosa');
SELECT t113_assert((SELECT pago_id = (SELECT v FROM t113_ids WHERE k = 'p1')::bigint AND cfdi_uuid = 'UUID-P1' AND proveedor_id = 'FM-P1' AND relacionado_uuid = 'UUID-I1'
                      AND parcialidad = 1 AND finalizada_at IS NOT NULL
                    FROM cfdi_operaciones WHERE id = ((SELECT v FROM t113_ids WHERE k = 'r1')::jsonb ->> 'operacion_id')::uuid),
  '113-10 la operación persiste pago, CFDI relacionado, UUID y Id del proveedor y parcialidad');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351) ->> 'codigo') = 'COMPLEMENTO_EMITIDO'
  AND (reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351) ->> 'cfdi_uuid') = 'UUID-P1',
  '113-11 mismo pago otra vez → devuelve el complemento existente (sin reservar)');
SELECT t113_assert(t113_efectos() = (SELECT v FROM t113_ids WHERE k = 'efectos0'), '113-12 el complemento no cambió orden, CxC, pagos, contabilidad ni saldo del cliente');
COMMIT;

\echo '── 113: pago 2 — falla definitiva, luego incierta (bloquea), conciliación, éxito'
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
INSERT INTO t113_ids SELECT 'r2a', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p2')::bigint, 11351)::text;
SELECT t113_assert(((SELECT v FROM t113_ids WHERE k = 'r2a')::jsonb ->> 'parcialidad')::int = 2
  AND ((SELECT v FROM t113_ids WHERE k = 'r2a')::jsonb ->> 'saldo_anterior')::numeric = 200
  AND ((SELECT v FROM t113_ids WHERE k = 'r2a')::jsonb ->> 'saldo_insoluto')::numeric = 80
  AND ((SELECT v FROM t113_ids WHERE k = 'r2a')::jsonb ->> 'forma_pago') = '03',
  '113-13 pago 2 → parcialidad 2, 200 → 80 (el saldo insoluto anterior es el saldo anterior de este), forma 03');
SELECT t113_assert((finalizar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r2a')::jsonb ->> 'operacion_id')::uuid, 'fallida', '{"detalle":{"http":400}}') ->> 'estado') = 'fallida',
  '113-14 rechazo definitivo del proveedor → fallida');
INSERT INTO t113_ids SELECT 'r2b', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p2')::bigint, 11351)::text;
SELECT t113_assert(t113_op(((SELECT v FROM t113_ids WHERE k = 'r2b')::jsonb ->> 'operacion_id')::uuid) = 'complemento|1|en_curso|2',
  '113-15 tras la falla definitiva se reserva otra operación (parcialidad 2 otra vez)');
SELECT t113_assert((finalizar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r2b')::jsonb ->> 'operacion_id')::uuid, 'incierta', '{"detalle":{"error":"timeout"}}') ->> 'estado') = 'incierta',
  '113-16 timeout → incierta');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p2')::bigint, 11351) ->> 'codigo') = 'OPERACION_INCIERTA'
  AND (reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p3')::bigint, 11351) ->> 'codigo') = 'OPERACION_INCIERTA',
  '113-17 con la incierta, ni ese pago ni otro de la orden se reservan (sin reintento automático)');
SELECT t113_err(format($q$SELECT conciliar_operacion_cfdi(%L, 'no_emitida', '{"evidencia":"x"}', 11352)$q$, (SELECT v FROM t113_ids WHERE k = 'r2b')::jsonb ->> 'operacion_id'),
  '113-18 Ventas no concilia', '42501');
SELECT t113_assert((conciliar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r2b')::jsonb ->> 'operacion_id')::uuid, 'emitida',
                     '{"evidencia":"Facturama: folio encontrado","proveedor_id":"FM-P2","cfdi_uuid":"UUID-P2"}', 11355) ->> 'estado') = 'exitosa',
  '113-19 Facturación concilia con evidencia: sí se emitió → exitosa (sin segundo timbrado)');
COMMIT;

\echo '── 113: pago 3 — caída tras el proveedor (lease vencido) y conciliación de no emitido'
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
INSERT INTO t113_ids SELECT 'r3a', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p3')::bigint, 11352)::text;
SELECT t113_assert(((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'parcialidad')::int = 3
  AND ((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'saldo_anterior')::numeric = 80
  AND ((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'saldo_insoluto')::numeric = 0
  AND ((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'forma_pago') = '04',
  '113-20 Ventas A (dueña) reserva el pago 3 → parcialidad 3, 80 → 0, forma 04; cadena 300 → 200 → 80 → 0');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica;
UPDATE cfdi_operaciones SET lease_hasta = now() - interval '1 second' WHERE id = ((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'operacion_id')::uuid; COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p3')::bigint, 11352) ->> 'codigo') = 'OPERACION_INCIERTA'
  AND t113_op(((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'operacion_id')::uuid) = 'complemento|1|incierta|3',
  '113-21 caída tras reservar/timbrar: al vencer el lease queda INCIERTA y bloquea el reintento');
SELECT t113_assert((conciliar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r3a')::jsonb ->> 'operacion_id')::uuid, 'no_emitida',
                     '{"evidencia":"Facturama: folio inexistente"}', 11351) ->> 'estado') = 'descartada',
  '113-22 Admin concilia con evidencia: no se emitió → descartada');
INSERT INTO t113_ids SELECT 'r3b', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p3')::bigint, 11352)::text;
SELECT t113_assert((finalizar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'r3b')::jsonb ->> 'operacion_id')::uuid, 'emitida',
                     '{"proveedor_id":"FM-P3","cfdi_uuid":"UUID-P3"}') ->> 'estado') = 'exitosa',
  '113-23 nueva operación del pago 3 → exitosa');
SELECT t113_assert((SELECT string_agg(parcialidad || ':' || saldo_anterior || '>' || saldo_insoluto, ',' ORDER BY parcialidad)
                    FROM cfdi_operaciones WHERE orden_id = 11351 AND tipo = 'complemento' AND estado = 'exitosa') = '1:300.00>200.00,2:200.00>80.00,3:80.00>0.00',
  '113-24 cadena de saldos exacta por parcialidad (1, 2, 3)');
SELECT t113_assert(t113_efectos() = (SELECT v FROM t113_ids WHERE k = 'efectos0'), '113-25 ningún complemento cambió orden, CxC, pagos, contabilidad ni saldo del cliente');
COMMIT;

\echo '── 113: dueño y roles'
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT t113_err(format($q$SELECT reservar_complemento_cfdi(%s, 11353)$q$, (SELECT v FROM t113_ids WHERE k = 'p1')), '113-26 Ventas B sobre la orden de Ventas A', '42501', '%propias%');
SELECT t113_err(format($q$SELECT reservar_complemento_cfdi(%s, 11354)$q$, (SELECT v FROM t113_ids WHERE k = 'p1')), '113-27 Chofer no emite complementos', '42501');
SELECT t113_err($q$SELECT reservar_complemento_cfdi(99999999, 11351)$q$, '113-28 pago inexistente', '22023');
ROLLBACK;

\echo '── 113: no elegibles (sin operación ni proveedor)'
-- 11352: factura PUE con pago; 11353: CFDI sin modo registrado; 11354: sin CFDI; 11355: saldos incoherentes; 11356: forma no determinable.
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11352, 'emision', 11351, 'h2') ->> 'operacion_id')::uuid, 'emitida', '{"proveedor_id":"FM-I2","cfdi_uuid":"UUID-I2","metodo_pago_sat":"PUE"}');
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11355, 'emision', 11351, 'h5') ->> 'operacion_id')::uuid, 'emitida', '{"proveedor_id":"FM-I5","cfdi_uuid":"UUID-I5","metodo_pago_sat":"PPD"}');
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11356, 'emision', 11351, 'h6') ->> 'operacion_id')::uuid, 'emitida', '{"proveedor_id":"FM-I6","cfdi_uuid":"UUID-I6","metodo_pago_sat":"PPD"}');
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11353, 'emision', 11351, 'h3') ->> 'operacion_id')::uuid, 'emitida', '{"proveedor_id":"FM-I3","cfdi_uuid":"UUID-I3"}');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t113_auth(1);
INSERT INTO t113_ids SELECT 'q2', abonar_cxc(11352, 50, 'Efectivo', 'T113-ref-4') ->> 'pago_id';
INSERT INTO t113_ids SELECT 'q3', abonar_cxc(11353, 50, 'Efectivo', 'T113-ref-5') ->> 'pago_id';
INSERT INTO t113_ids SELECT 'q4', abonar_cxc(11354, 50, 'Efectivo', 'T113-ref-6') ->> 'pago_id';
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica;
INSERT INTO pagos (id, cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES
  (11355001, 11351, 11355, 11355, 40, 'Efectivo', CURRENT_DATE, 'T113-incoherente', 100, 90),
  (11356001, 11351, 11356, 11356, 40, 'Crédito (fiado)', CURRENT_DATE, 'T113-forma', 100, 60),
  (11356002, 11351, NULL, NULL, 40, 'Efectivo', CURRENT_DATE, 'T113-sin-cxc', 0, 0);
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'q2')::bigint, 11351) ->> 'codigo') = 'CFDI_PUE', '113-29 factura PUE → no lleva complemento');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'q3')::bigint, 11351) ->> 'codigo') = 'MODO_FISCAL_NO_REGISTRADO',
  '113-30 CFDI sin modo fiscal registrado → no se infiere de ordenes.metodo_pago');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'q4')::bigint, 11351) ->> 'codigo') = 'SIN_CFDI_VIGENTE', '113-31 sin factura → no elegible');
SELECT t113_assert((reservar_complemento_cfdi(11355001, 11351) ->> 'codigo') = 'DATOS_PAGO_INCONSISTENTES', '113-32 saldos del pago que no cuadran → no elegible');
SELECT t113_assert((reservar_complemento_cfdi(11356001, 11351) ->> 'codigo') = 'FORMA_PAGO_NO_DETERMINABLE', '113-33 método sin forma de pago SAT (no se manda 99) → no elegible');
SELECT t113_assert((reservar_complemento_cfdi(11356002, 11351) ->> 'codigo') = 'PAGO_SIN_CXC', '113-34 pago sin CxC → no lleva complemento');
SELECT t113_assert((SELECT count(*) = 0 FROM cfdi_operaciones WHERE tipo = 'complemento' AND orden_id BETWEEN 11352 AND 11356), '113-35 ninguna de esas solicitudes creó operación');
COMMIT;

\echo '── 113: CFDI cancelado y nueva generación (parcialidad reinicia)'
BEGIN; SET LOCAL ROLE service_role; SELECT t113_srv();
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11351, 'cancelacion', 11351, NULL, '02') ->> 'operacion_id')::uuid, 'cancelada', '{}');
SELECT t113_assert((reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351) ->> 'codigo') = 'SIN_CFDI_VIGENTE',
  '113-36 con el CFDI cancelado no se emiten complementos');
SELECT finalizar_operacion_cfdi((reservar_operacion_cfdi(11351, 'emision', 11351, 'h1b') ->> 'operacion_id')::uuid, 'emitida',
  '{"proveedor_id":"FM-I1B","cfdi_uuid":"UUID-I1B","metodo_pago_sat":"PPD"}');
INSERT INTO t113_ids SELECT 'g2', reservar_complemento_cfdi((SELECT v FROM t113_ids WHERE k = 'p1')::bigint, 11351)::text;
SELECT t113_assert(((SELECT v FROM t113_ids WHERE k = 'g2')::jsonb ->> 'parcialidad')::int = 1
  AND ((SELECT v FROM t113_ids WHERE k = 'g2')::jsonb ->> 'relacionado_uuid') = 'UUID-I1B'
  AND ((SELECT v FROM t113_ids WHERE k = 'g2')::jsonb ->> 'generacion')::int = 2
  AND ((SELECT v FROM t113_ids WHERE k = 'g2')::jsonb ->> 'folio') = 'P' || (SELECT v FROM t113_ids WHERE k = 'p1') || 'G2',
  '113-37 generación 2: el pago 1 vuelve a ser parcialidad 1 contra el CFDI nuevo (los de la generación 1 no cuentan)');
SELECT t113_assert((finalizar_operacion_cfdi(((SELECT v FROM t113_ids WHERE k = 'g2')::jsonb ->> 'operacion_id')::uuid, 'emitida', '{"proveedor_id":"FM-P1B","cfdi_uuid":"UUID-P1B"}') ->> 'estado') = 'exitosa',
  '113-38 complemento de generación 2 → exitosa');
SELECT t113_assert((SELECT count(*) = 2 FROM cfdi_operaciones WHERE tipo = 'complemento' AND estado = 'exitosa' AND pago_id = (SELECT v FROM t113_ids WHERE k = 'p1')::bigint),
  '113-38b un éxito por pago Y por CFDI relacionado (generación 1 y 2)');
COMMIT;

BEGIN; SELECT t113_limpiar(); COMMIT;
DROP TABLE IF EXISTS t113_ids;
\echo '── 113: TODAS LAS PRUEBAS OK'
