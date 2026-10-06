-- 114_referencia_pago_unica_test.sql — CLOSURE-1 (R-01): una referencia de
-- pago no vacía se registra una sola vez (idx_pagos_ref) y los pagos legítimos
-- distintos no chocan (referencia por omisión de abonar_cxc con el id del pago).
-- La carrera con dos conexiones, los webhooks reales y el pre-chequeo con datos
-- sucios se prueban en el runner local (bloque 114).

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t114_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11451 AND 11469;
  DELETE FROM pagos WHERE orden_id BETWEEN 11451 AND 11469 OR cxc_id BETWEEN 11451 AND 11469 OR referencia LIKE 'T114-%';
  DELETE FROM cuentas_por_cobrar WHERE id BETWEEN 11451 AND 11469;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11451 AND 11469;
  DELETE FROM ordenes WHERE id BETWEEN 11451 AND 11469;
  DELETE FROM clientes WHERE id = 11451;
  DELETE FROM usuarios WHERE id BETWEEN 11451 AND 11459;
  DELETE FROM auth.users WHERE id::text LIKE '11450000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t114_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('11450000-0000-0000-0000-000000000001', 'u1@t114');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11451, 'Admin 114', 'u1@t114', 'Admin', 'Activo', '11450000-0000-0000-0000-000000000001');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11451, 'Cliente 114', 'AAA010101AAA', 1000, true, 100000);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES
  (11451, 'OV-11451', 11451, 'Cliente 114', 'x', 300, 'Entregada', 'Crédito (fiado)', 'Credito'),   -- CxC: abonos sin referencia
  (11452, 'OV-11452', 11451, 'Cliente 114', 'x', 100, 'Entregada', 'Transferencia',   'Contado'),   -- contado, referencia manual
  (11453, 'OV-11453', 11451, 'Cliente 114', 'x', 100, 'Entregada', 'Transferencia',   'Contado'),   -- contado, MISMA referencia manual
  (11454, 'OV-11454', 11451, 'Cliente 114', 'x', 200, 'Entregada', 'Crédito (fiado)', 'Credito'),   -- CxC vía registrar_pago_orden
  (11455, 'OV-11455', 11451, 'Cliente 114', 'x', 100, 'Entregada', 'Efectivo',        'Contado'),   -- contado, referencia por omisión
  (11456, 'OV-11456', 11451, 'Cliente 114', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito'),   -- CxC: abonos en transacciones seguidas
  (11459, 'OV-11459', 11451, 'Cliente 114', 'x', 1000, 'Entregada', 'Efectivo',       'Contado');   -- escrituras directas del backend
INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, estatus, concepto)
  SELECT id, 11451, id, CURRENT_DATE, CURRENT_DATE + 30, total, 0, total, 'Pendiente', 'T114' FROM ordenes WHERE id IN (11451, 11454, 11456);
COMMIT;

CREATE OR REPLACE FUNCTION t114_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t114_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t114_srv() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t114_auth() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"11450000-0000-0000-0000-000000000001"}', true); END $$;
-- Efectos de negocio de las órdenes de la suite: CxC / pagos / ingresos / saldo del cliente.
CREATE OR REPLACE FUNCTION t114_efectos() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT string_agg(id || ':' || monto_pagado || ':' || saldo_pendiente || ':' || estatus, ',' ORDER BY id) FROM cuentas_por_cobrar WHERE id BETWEEN 11451 AND 11469) || '/'
      || (SELECT count(*) || ':' || COALESCE(sum(monto), 0) FROM pagos WHERE orden_id BETWEEN 11451 AND 11469) || '/'
      || (SELECT count(*) || ':' || COALESCE(sum(monto), 0) FROM movimientos_contables WHERE orden_id BETWEEN 11451 AND 11469) || '/'
      || (SELECT saldo FROM clientes WHERE id = 11451) $$;
CREATE TABLE IF NOT EXISTS t114_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT EXECUTE ON FUNCTION t114_assert(BOOLEAN, TEXT), t114_err(TEXT, TEXT, TEXT, TEXT), t114_srv(), t114_auth(), t114_efectos() TO PUBLIC;
GRANT ALL ON t114_ids TO PUBLIC;
TRUNCATE t114_ids;

\echo '── 114: índice y superficie'
SELECT t114_assert((SELECT pg_get_indexdef(indexrelid) = 'CREATE UNIQUE INDEX idx_pagos_ref ON public.pagos USING btree (referencia) WHERE (referencia <> ''''::text)'
                      AND indisunique AND indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.idx_pagos_ref')),
  '114-01 idx_pagos_ref: UNIQUE parcial sobre pagos(referencia) WHERE referencia <> '''' (válido)');
SELECT t114_assert((SELECT p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    FROM pg_proc p WHERE p.oid = 'public.abonar_cxc(bigint,numeric,text,text,bigint)'::regprocedure)
  AND NOT has_table_privilege('authenticated', 'public.pagos', 'INSERT'),
  '114-02 abonar_cxc: misma firma, SECURITY DEFINER, search_path fijo y mismos permisos; authenticated sigue sin INSERT directo en pagos');
SELECT t114_assert((SELECT is_nullable = 'NO' AND column_default = '''''::text' FROM information_schema.columns WHERE table_name = 'pagos' AND column_name = 'referencia'),
  '114-03 convención: referencia NOT NULL DEFAULT '''' ("sin referencia")');

\echo '── 114: referencias vacías y repetidas (escritura directa del backend, como el webhook)'
BEGIN; SET LOCAL ROLE service_role; SELECT t114_srv();
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, saldo_antes, saldo_despues) VALUES (11451, 11459, 1, 'Efectivo', fin_hoy(), 0, 0), (11451, 11459, 1, 'Efectivo', fin_hoy(), 0, 0);
SELECT t114_assert((SELECT count(*) = 2 FROM pagos WHERE orden_id = 11459 AND referencia = ''), '114-04 varias referencias vacías ('''') coexisten (fuera del índice parcial)');
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (11451, 11459, 1, 'QR / Link de pago', fin_hoy(), 'T114-stripe:cs_1', 0, 0);
SELECT t114_err($q$INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (11451, 11459, 1, 'QR / Link de pago', fin_hoy(), 'T114-stripe:cs_1', 0, 0)$q$,
  '114-05 la misma referencia de proveedor por segunda vez: rechazada por el índice (aunque se haya saltado cualquier pre-chequeo)', '23505', '%idx_pagos_ref%');
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (11451, 11459, 1, 'QR / Link de pago', fin_hoy(), 'T114-stripe:cs_2', 0, 0);
SELECT t114_assert((SELECT count(*) = 2 FROM pagos WHERE referencia IN ('T114-stripe:cs_1', 'T114-stripe:cs_2')), '114-06 dos referencias de proveedor distintas: permitidas');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM pagos WHERE orden_id = 11459; COMMIT;

\echo '── 114: abonos de CxC sin referencia (antes: "Abono CxC #id YYYYMMDD-HHMISS")'
INSERT INTO t114_ids VALUES ('e0', t114_efectos());
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
-- misma transacción ⇒ mismo now(): con el formato anterior las dos referencias eran idénticas
INSERT INTO t114_ids SELECT 'a1', abonar_cxc(11451, 100, 'Efectivo') ->> 'pago_id';
INSERT INTO t114_ids SELECT 'a2', abonar_cxc(11451, 100, 'Efectivo') ->> 'pago_id';
COMMIT;
SELECT t114_assert((SELECT count(*) = 2 AND count(DISTINCT referencia) = 2 FROM pagos WHERE cxc_id = 11451)
  AND (SELECT referencia FROM pagos WHERE id = (SELECT v FROM t114_ids WHERE k = 'a1')::bigint) = 'Abono CxC #11451 pago ' || (SELECT v FROM t114_ids WHERE k = 'a1')
  AND (SELECT referencia FROM pagos WHERE id = (SELECT v FROM t114_ids WHERE k = 'a2')::bigint) = 'Abono CxC #11451 pago ' || (SELECT v FROM t114_ids WHERE k = 'a2'),
  '114-07 dos abonos legítimos de la MISMA CxC en la MISMA transacción (mismo segundo): ambos aplican; referencia = "Abono CxC #<cxc> pago <pagos.id>"');
SELECT t114_assert((SELECT monto_pagado = 200 AND saldo_pendiente = 100 AND estatus = 'Parcial' FROM cuentas_por_cobrar WHERE id = 11451)
  AND (SELECT string_agg(saldo_antes::numeric(12,2) || '>' || saldo_despues::numeric(12,2), ',' ORDER BY id) = '300.00>200.00,200.00>100.00' FROM pagos WHERE cxc_id = 11451)
  AND (SELECT count(*) = 2 AND sum(monto) = 200 FROM movimientos_contables WHERE orden_id = 11451 AND categoria = 'Cobranza')
  AND (SELECT saldo = 800 FROM clientes WHERE id = 11451),
  '114-08 montos y saldos sin cambio de semántica: CxC 300 → 100 Parcial, cadena de saldos 300>200>100, dos ingresos Cobranza, saldo del cliente −200');
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth(); INSERT INTO t114_ids SELECT 'b1', abonar_cxc(11456, 30, 'Efectivo') ->> 'pago_id'; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth(); INSERT INTO t114_ids SELECT 'b2', abonar_cxc(11456, 30, 'Efectivo') ->> 'pago_id'; COMMIT;
SELECT t114_assert((SELECT count(*) = 2 AND count(DISTINCT referencia) = 2 FROM pagos WHERE cxc_id = 11456)
  AND (SELECT monto_pagado = 60 AND saldo_pendiente = 40 FROM cuentas_por_cobrar WHERE id = 11456),
  '114-09 dos abonos sin referencia en transacciones seguidas (mismo segundo de reloj): ambos aplican, referencias distintas');

\echo '── 114: referencia manual repetida (falla cerrado, sin efectos)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_assert((abonar_cxc(11451, 50, 'Transferencia SPEI', 'T114-MAN-1') ->> 'estatus') = 'Parcial', '114-10 abono con referencia manual nueva: aplicado');
COMMIT;
INSERT INTO t114_ids VALUES ('e1', t114_efectos());
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_err($q$SELECT abonar_cxc(11451, 50, 'Transferencia SPEI', 'T114-MAN-1')$q$,
  '114-11 la misma referencia manual otra vez: rechazada con mensaje claro (no se modifica ni se le agrega texto)', '23505', '%referencia de pago "T114-MAN-1" ya está registrada%');
SELECT t114_err($q$SELECT abonar_cxc(11451, 50, 'Transferencia SPEI', '  T114-MAN-1  ')$q$,
  '114-12 la misma referencia con espacios alrededor: también rechazada (se compara recortada, como se guarda)', '23505', '%ya está registrada%');
COMMIT;
SELECT t114_assert(t114_efectos() = (SELECT v FROM t114_ids WHERE k = 'e1'),
  '114-13 el abono rechazado no dejó segundo pago, ni cambio de CxC, ni ingreso, ni saldo del cliente');
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_assert((abonar_cxc(11451, 50, 'Transferencia SPEI', 'T114-MAN-2') ->> 'estatus') = 'Pagada', '114-14 otra referencia manual distinta: aplicada (CxC liquidada)');
COMMIT;

\echo '── 114: registrar_pago_orden (contrato sin cambio)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_assert((registrar_pago_orden(11452, 'Transferencia', 'T114-SPEI-1') ->> 'aplicado')::boolean, '114-15 contado con referencia manual: aplicado');
INSERT INTO t114_ids VALUES ('e2', t114_efectos());
INSERT INTO t114_ids SELECT 'r3', registrar_pago_orden(11453, 'Transferencia', 'T114-SPEI-1')::text;
COMMIT;
SELECT t114_assert(((SELECT v FROM t114_ids WHERE k = 'r3')::jsonb ->> 'aplicado')::boolean IS FALSE
  AND ((SELECT v FROM t114_ids WHERE k = 'r3')::jsonb ->> 'motivo') = 'referencia_existente'
  AND t114_efectos() = (SELECT v FROM t114_ids WHERE k = 'e2')
  AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id = 11453) AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE orden_id = 11453),
  '114-16 otra orden con la MISMA referencia manual: resultado no aplicado "referencia_existente" (contrato existente), sin pago ni ingreso');
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_assert((registrar_pago_orden(11455, 'Efectivo') ->> 'referencia') = 'OV-11455-Efectivo', '114-17 contado sin referencia: referencia por omisión <folio>-<método> (sin cambio)');
INSERT INTO t114_ids SELECT 'r5', registrar_pago_orden(11455, 'Efectivo')::text;
COMMIT;
SELECT t114_assert(((SELECT v FROM t114_ids WHERE k = 'r5')::jsonb ->> 'motivo') = 'ya_pagada'
  AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 11455) AND (SELECT count(*) = 1 FROM movimientos_contables WHERE orden_id = 11455),
  '114-18 el mismo cobro otra vez: "ya_pagada"; un pago y un ingreso');
INSERT INTO t114_ids VALUES ('e3', t114_efectos());
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
SELECT t114_err($q$SELECT registrar_pago_orden(11454, 'Efectivo', 'T114-SPEI-1')$q$,
  '114-19 orden con CxC y referencia manual ya registrada: rechazado con mensaje claro (abonar_cxc)', '23505', '%ya está registrada%');
COMMIT;
SELECT t114_assert(t114_efectos() = (SELECT v FROM t114_ids WHERE k = 'e3') AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id = 11454),
  '114-20 sin efectos: CxC, pagos, ingresos y saldo del cliente intactos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t114_auth();
INSERT INTO t114_ids SELECT 'r4', registrar_pago_orden(11454, 'Efectivo')::text;
COMMIT;
SELECT t114_assert(((SELECT v FROM t114_ids WHERE k = 'r4')::jsonb ->> 'via') = 'cxc'
  AND (SELECT referencia FROM pagos WHERE orden_id = 11454) = 'Abono CxC #11454 pago ' || ((SELECT v FROM t114_ids WHERE k = 'r4')::jsonb ->> 'pago_id')
  AND (SELECT estatus = 'Pagada' FROM cuentas_por_cobrar WHERE id = 11454),
  '114-21 la misma orden sin referencia: abono por la CxC con referencia por omisión única; CxC liquidada');

BEGIN; SELECT t114_limpiar(); COMMIT;
DROP TABLE IF EXISTS t114_ids;
\echo '── 114: TODAS LAS PRUEBAS OK'
