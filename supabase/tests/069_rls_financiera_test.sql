-- 069_rls_financiera_test.sql — pruebas de ataque (A-K) y de flujos
-- legítimos (L-V) de la migración 069, ejecutables con psql contra una
-- base local con el esquema del proyecto + shim de auth (ver
-- docs/PENDIENTES_TECNICOS.md, "P1 Fase A").
--
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/069_rls_financiera_test.sql
--
-- Cada bloque simula un actor exactamente como PostgREST: SET ROLE +
-- request.jwt.claims. Un "DENIED" esperado se captura en un DO; después
-- se verifica con superusuario que el dato NO cambió. Cualquier FAIL
-- aborta el script (exit != 0).

\set ON_ERROR_STOP on
\set QUIET on

-- ─── Fixtures ────────────────────────────────────────────────────────
BEGIN;
DELETE FROM pagos; DELETE FROM cuentas_por_cobrar; DELETE FROM movimientos_contables;
DELETE FROM orden_lineas; DELETE FROM ordenes; DELETE FROM rutas; DELETE FROM clientes; DELETE FROM usuarios;
INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES
  (1, 'Admin T',   'admin@t',   'Admin',      'Activo'),
  (2, 'Ventas T',  'ventas@t',  'Ventas',     'Activo'),
  (3, 'Chofer T',  'chofer@t',  'Chofer',     'Activo'),
  (4, 'Prod T',    'prod@t',    'Producción', 'Activo'),
  (5, 'Inact T',   'inactivo@t','Ventas',     'Inactivo'),
  (6, 'Chofer2 T', 'chofer2@t', 'Chofer',     'Activo');
INSERT INTO productos (sku, nombre, precio, stock) SELECT 'HPC-5K', 'Hielo Purificado Cubos 5kg', 35, 100 WHERE NOT EXISTS (SELECT 1 FROM productos WHERE sku = 'HPC-5K');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (10, 'Cliente Crédito', 'XAXX010101000', 0), (11, 'Cliente Contado', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, estatus, fecha) VALUES (100, 'R-100', 'Ruta T', 3, 'En progreso', CURRENT_DATE);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id, vendedor_id) VALUES
  (200, 'OV-0200', 11, 'Cliente Contado', '1×HPC-5K', 100, 'Asignada', 'Efectivo', 'Contado', 100, 2),   -- contado en ruta
  (201, 'OV-0201', 10, 'Cliente Crédito', '1×HPC-5K', 300, 'Asignada', 'Crédito',  'Credito', 100, 2),   -- crédito en ruta
  (202, 'OV-0202', 11, 'Cliente Contado', '1×HPC-5K', 150, 'Entregada','QR / Link de pago', 'Contado', 100, 2), -- ya pagada por link
  (203, 'OV-0203', 10, 'Cliente Crédito', '1×HPC-5K', 500, 'Entregada','Crédito',  'Credito', NULL, 2),  -- crédito con CxC para abonos
  (204, 'OV-0204', 11, 'Cliente Contado', '1×HPC-5K', 80,  'Creada',   'Efectivo', 'Contado', NULL, 2),
  (205, 'OV-0205', 11, 'Cliente Contado', '1×HPC-5K', 60,  'Asignada', 'Efectivo', 'Contado', 100, 2);   -- para cancelar y probar cierre
INSERT INTO pagos (id, cliente_id, orden_id, monto, metodo_pago, referencia, saldo_antes, saldo_despues, fecha) VALUES
  (300, 11, 202, 150, 'QR / Link de pago', 'stripe:cs_test_link', 0, 0, CURRENT_DATE);
INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, monto_original, monto_pagado, saldo_pendiente, estatus, concepto) VALUES
  (400, 10, 203, 500, 0, 500, 'Pendiente', 'OV-0203 — Cliente Crédito');
UPDATE clientes SET saldo = 500 WHERE id = 10;
SELECT setval('ordenes_id_seq', 1000); SELECT setval('pagos_id_seq', 1000);
SELECT setval('cuentas_por_cobrar_id_seq', 1000); SELECT setval('movimientos_contables_id_seq', 1000);
COMMIT;

-- Helper: actuar como un actor (rol JWT + email). NULL email = sin perfil.
CREATE OR REPLACE FUNCTION t_actor(p_jwt_role TEXT, p_email TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', p_jwt_role, 'email', p_email)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
      RAISE NOTICE 'OK: %', p_msg; END $$;

\set QUIET off
\echo
\echo '════════ ATAQUES (todos deben quedar DENIED, sin cambios) ════════'

-- A. Producción: PATCH CxC saldo=0
BEGIN;
SELECT t_actor('authenticated', 'prod@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE cuentas_por_cobrar SET saldo_pendiente = 0, estatus = 'Pagada' WHERE id = 400;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'A denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT saldo_pendiente = 500 AND estatus = 'Pendiente' FROM cuentas_por_cobrar WHERE id = 400), 'A. Producción no puede poner CxC en 0');
ROLLBACK;

-- B. Producción: DELETE CxC
BEGIN;
SELECT t_actor('authenticated', 'prod@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN DELETE FROM cuentas_por_cobrar WHERE id = 400; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'B denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM cuentas_por_cobrar WHERE id = 400), 'B. Producción no puede borrar CxC');
ROLLBACK;

-- C. Producción: INSERT pago falso
BEGIN;
SELECT t_actor('authenticated', 'prod@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, referencia, saldo_antes, saldo_despues) VALUES (11, 204, 80, 'Efectivo', 'falso-C', 0, 0);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'C denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 0 FROM pagos WHERE referencia = 'falso-C'), 'C. Producción no puede insertar pagos');
ROLLBACK;

-- D. Producción: INSERT movimiento contable falso (ingreso)
BEGIN;
SELECT t_actor('authenticated', 'prod@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Ingreso', 'Ventas', 'falso-D', 999);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'D denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 0 FROM movimientos_contables WHERE concepto = 'falso-D'), 'D. Producción no puede insertar ingresos');
ROLLBACK;

-- E. Chofer: PATCH CxC Pagada
BEGIN;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE cuentas_por_cobrar SET estatus = 'Pagada', saldo_pendiente = 0 WHERE id = 400;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'E denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT estatus = 'Pendiente' FROM cuentas_por_cobrar WHERE id = 400), 'E. Chofer no puede marcar CxC Pagada');
ROLLBACK;

-- F. Chofer: DELETE pago
BEGIN;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN DELETE FROM pagos WHERE id = 300; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'F denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE id = 300), 'F. Chofer no puede borrar pagos');
ROLLBACK;

-- G. Chofer: UPDATE orden.total
BEGIN;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE ordenes SET total = 1 WHERE id = 200; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT total = 100 FROM ordenes WHERE id = 200), 'G. Chofer no puede cambiar total');
ROLLBACK;

-- H. Ventas: UPDATE orden.total (y cliente_id, requiere_factura, facturama_uuid)
BEGIN;
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE ordenes SET total = 1 WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'H1 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET cliente_id = 10 WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'H2 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET facturama_uuid = 'fake-uuid' WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'H3 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT total = 80 AND cliente_id = 11 AND facturama_uuid IS NULL FROM ordenes WHERE id = 204), 'H. Ventas no puede cambiar total/cliente/uuid');
ROLLBACK;

-- I. Ventas: estatus arbitrario incompatible (Creada→Entregada, Asignada→Facturada, Entregada→Creada)
BEGIN;
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE ordenes SET estatus = 'Entregada' WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'I1 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET estatus = 'Facturada' WHERE id = 200; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'I2 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET estatus = 'Creada' WHERE id = 202; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'I3 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET metodo_pago = 'Crédito' WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'I4 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT estatus = 'Creada' AND metodo_pago = 'Efectivo' FROM ordenes WHERE id = 204) AND (SELECT estatus = 'Asignada' FROM ordenes WHERE id = 200) AND (SELECT estatus = 'Entregada' FROM ordenes WHERE id = 202), 'I. Ventas no puede saltar estatus ni cambiar metodo_pago fuera del cobro');
ROLLBACK;

-- J. authenticated: rpc timbrar_orden / registrar_pago / increment_saldo
BEGIN;
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM timbrar_orden('OV-0204'::varchar); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J1 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM registrar_pago(10, 100, 'ref-J'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J2 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM increment_saldo(10, -500); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J3 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT saldo = 500 FROM clientes WHERE id = 10) AND (SELECT estatus = 'Creada' FROM ordenes WHERE id = 204) AND (SELECT COUNT(*) = 0 FROM pagos WHERE referencia = 'ref-J'), 'J. RPC legacy e increment_saldo inaccesibles para Ventas');
-- J bis: anon
SELECT t_actor('anon', NULL); SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM increment_saldo(10, -500); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J4 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM registrar_pago_orden(200, 'Efectivo'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J5 denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO pagos (cliente_id, orden_id, monto, referencia, saldo_antes, saldo_despues) VALUES (11, 204, 1, 'anon', 0, 0); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'J6 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT saldo = 500 FROM clientes WHERE id = 10) AND (SELECT COUNT(*) = 1 FROM pagos), 'J. anon no puede tocar saldo ni pagos');
ROLLBACK;

-- K. actor sin perfil e inactivo: todas las anteriores
BEGIN;
SELECT t_actor('authenticated', 'nadie@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN UPDATE cuentas_por_cobrar SET saldo_pendiente = 0 WHERE id = 400; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K1 denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO pagos (cliente_id, orden_id, monto, referencia, saldo_antes, saldo_despues) VALUES (11, 204, 1, 'nadie', 0, 0); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K2 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM registrar_pago_orden(200, 'Efectivo'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K3 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM abonar_cxc(400, 100, 'Efectivo'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K4 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE ordenes SET total = 1 WHERE id = 204; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K5 denied: %', SQLERRM; END $$;
SELECT t_actor('authenticated', 'inactivo@t');
DO $$ BEGIN PERFORM registrar_pago_orden(200, 'Efectivo'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K6 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM cerrar_ruta_financiero(100, '[]'::jsonb); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'K7 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT saldo_pendiente = 500 FROM cuentas_por_cobrar WHERE id = 400) AND (SELECT COUNT(*) = 1 FROM pagos) AND (SELECT total = 80 FROM ordenes WHERE id = 204) AND (SELECT estatus = 'En progreso' FROM rutas WHERE id = 100), 'K. sin perfil / inactivo: nada cambia');
ROLLBACK;

-- K bis. Chofer ajeno no cierra la ruta de otro; cobro directo sobre cancelada rechazado
BEGIN;
SELECT t_actor('authenticated', 'chofer2@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM cerrar_ruta_financiero(100, '[{"ordenId":200,"pago":"Efectivo"}]'::jsonb, 6); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Kb denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT estatus = 'Asignada' FROM ordenes WHERE id = 200) AND (SELECT COUNT(*) = 1 FROM pagos), 'K bis. Chofer ajeno no puede cerrar la ruta');
ROLLBACK;

\echo
\echo '════════ FLUJOS LEGÍTIMOS ════════'

-- L. Ventas crea pedido
BEGIN;
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, requiere_factura)
VALUES ('OV-L', 11, 'Cliente Contado', '2×HPC-5K', 70, 'Creada', 'Efectivo', 'Contado', 2, false);
SELECT t_assert((SELECT COUNT(*) = 1 FROM ordenes WHERE folio = 'OV-L'), 'L. Ventas crea pedido');
-- edición legítima en Creada vía RPC (total cambia SOLO por el contrato)
SELECT update_orden_atomic((SELECT id FROM ordenes WHERE folio = 'OV-L'), '{"total": 90, "productos": "3×HPC-5K"}'::jsonb, '[{"sku":"HPC-5K","cantidad":3,"precio_unit":30,"subtotal":90}]'::jsonb);
SELECT t_assert((SELECT total = 90 FROM ordenes WHERE folio = 'OV-L'), 'L. update_orden_atomic cambia total en Creada');
SELECT t_assert((SELECT COUNT(*) = 1 FROM cuentas_por_cobrar) AND (SELECT COUNT(*) = 1 FROM pagos), 'V. Ventas lee CxC y pagos');
ROLLBACK;

-- M. Cobro permitido de Ventas (mostrador): Asignada→Entregada + contrato de ingreso/pago
BEGIN;
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Transferencia SPEI' WHERE id = 205;
SELECT t_assert((SELECT estatus = 'Entregada' AND metodo_pago = 'Transferencia SPEI' FROM ordenes WHERE id = 205), 'M. Ventas marca Entregada con método al cobrar');
SELECT registrar_pago_orden(205, 'Transferencia SPEI', 'SPEI-123', 2);
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 205 AND monto = 60 AND metodo_pago = 'Transferencia SPEI'), 'S. transferencia registra pago exacto');
SELECT t_assert((SELECT COUNT(*) = 1 FROM movimientos_contables WHERE orden_id = 205 AND tipo = 'Ingreso' AND categoria = 'Ventas'), 'U. ingreso derivado del contrato');
SELECT t_actor('authenticated', 'ventas@t'); SET LOCAL ROLE authenticated;
SELECT registrar_pago_orden(205, 'Transferencia SPEI', 'SPEI-123', 2);
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 205), 'M. segundo cobro no duplica (ya_pagada)');
ROLLBACK;

-- N/O/Q/R/T. Chofer: entrega directa, cierre financiero de ruta con contado, crédito, link ya pagado y exprés
BEGIN;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
UPDATE ordenes SET estatus = 'No entregada', motivo_no_entrega = 'Cliente ausente' WHERE id = 205;
SELECT t_assert((SELECT estatus = 'No entregada' FROM ordenes WHERE id = 205), 'N. Chofer marca No entregada');
SELECT cerrar_ruta_financiero(100, $j$[
  {"ordenId":200,"pago":"Efectivo"},
  {"ordenId":201,"pago":"Crédito"},
  {"ordenId":202,"pago":"QR / Link de pago"},
  {"express":true,"cliente":"Público en general","pago":"Tarjeta","items":[{"sku":"HPC-5K","cant":2,"precio":35}]},
  {"express":true,"clienteId":10,"cliente":"Cliente Crédito","pago":"Crédito","items":[{"sku":"HPC-5K","cant":1,"precio":35}]}
]$j$::jsonb, 3, 'Chofer T');
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 200 AND monto = 100 AND metodo_pago = 'Efectivo'), 'R. efectivo: un pago por el total del servidor');
SELECT t_assert((SELECT COUNT(*) = 1 FROM cuentas_por_cobrar WHERE orden_id = 201 AND saldo_pendiente = 300), 'O. crédito: CxC creada');
SELECT t_assert((SELECT saldo = 500 + 300 + 35 FROM clientes WHERE id = 10), 'O. saldo cliente = CxC previa + crédito ruta + exprés crédito');
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 202), 'P0-1. orden pagada por link NO recibe segundo pago al cerrar ruta');
SELECT t_assert((SELECT SUM(monto) = 150 FROM pagos WHERE orden_id = 202), 'P0-1. SUM(pagos) == total para la orden con link');
SELECT t_assert((SELECT COUNT(*) = 2 FROM ordenes WHERE ruta_id = 100 AND folio LIKE 'OV-%' AND id > 1000), 'Q. dos ventas exprés creadas');
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.id > 1000 AND p.metodo_pago = 'Tarjeta' AND p.monto = 70), 'T. tarjeta exprés: pago = líneas del servidor');
SELECT t_assert((SELECT COUNT(*) = 2 FROM orden_lineas WHERE orden_id > 1000), 'Q. líneas exprés insertadas');
SELECT t_assert((SELECT estatus = 'Entregada' FROM ordenes WHERE id = 200) AND (SELECT estatus = 'Entregada' FROM ordenes WHERE id = 201), 'O. órdenes marcadas Entregada');
-- invariante I1 en todas las órdenes
SELECT t_assert(NOT EXISTS (SELECT 1 FROM ordenes o JOIN pagos p ON p.orden_id = o.id GROUP BY o.id, o.total HAVING SUM(p.monto) > o.total + 0.01), 'I1. SUM(pagos) <= total en todas las órdenes');
-- reintento del cierre: la ruta sigue abierta (el JS la cierra después) → segundo cierre financiero no duplica
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
SELECT cerrar_ruta_financiero(100, '[{"ordenId":200,"pago":"Efectivo"},{"ordenId":202,"pago":"QR / Link de pago"}]'::jsonb, 3, 'Chofer T');
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 200) AND (SELECT COUNT(*) = 1 FROM pagos WHERE orden_id = 202), 'O. re-cierre no duplica pagos');
ROLLBACK;

-- O bis. failure path: entrega de orden cancelada aborta TODO (ningún estado parcial)
BEGIN;
UPDATE ordenes SET estatus = 'Cancelada' WHERE id = 205;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM cerrar_ruta_financiero(100, '[{"ordenId":200,"pago":"Efectivo"},{"ordenId":205,"pago":"Efectivo"}]'::jsonb, 3, 'Chofer T');
  RAISE EXCEPTION 'FAIL: cierre con orden cancelada no abortó';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE 'O bis abortado: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT estatus = 'Asignada' FROM ordenes WHERE id = 200) AND (SELECT COUNT(*) = 0 FROM pagos WHERE orden_id = 200), 'O bis. fallo a mitad: la orden 200 NO quedó Entregada ni cobrada (atómico)');
ROLLBACK;

-- P. abonar_cxc: parcial, tope, liquidación
BEGIN;
SELECT t_actor('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
SELECT abonar_cxc(400, 200, 'Efectivo', NULL, 1);
SELECT t_assert((SELECT monto_pagado = 200 AND saldo_pendiente = 300 AND estatus = 'Parcial' FROM cuentas_por_cobrar WHERE id = 400), 'P. abono parcial');
SELECT t_assert((SELECT saldo = 300 FROM clientes WHERE id = 10), 'P. saldo cliente espeja CxC');
DO $$ BEGIN PERFORM abonar_cxc(400, 301, 'Efectivo'); RAISE EXCEPTION 'FAIL: sobrepago aceptado';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE 'P sobrepago denied: %', SQLERRM; END $$;
SELECT abonar_cxc(400, 300, 'Transferencia', 'SPEI-fin', 1);
SELECT t_assert((SELECT estatus = 'Pagada' AND saldo_pendiente = 0 FROM cuentas_por_cobrar WHERE id = 400), 'P. liquidación');
SELECT t_assert((SELECT saldo = 0 FROM clientes WHERE id = 10), 'P. saldo cliente en 0');
SELECT t_assert((SELECT COUNT(*) = 2 FROM pagos WHERE cxc_id = 400) AND (SELECT COUNT(*) = 2 FROM movimientos_contables WHERE orden_id = 203 AND categoria = 'Cobranza'), 'P. dos pagos y dos ingresos de cobranza');
DO $$ BEGIN PERFORM abonar_cxc(400, 1, 'Efectivo'); RAISE EXCEPTION 'FAIL: abono sobre liquidada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE 'P liquidada denied: %', SQLERRM; END $$;
ROLLBACK;

-- P0-2 (servidor): cobro de contado sobre orden con CxC abonada → cobra solo el saldo
BEGIN;
SELECT t_actor('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
SELECT abonar_cxc(400, 200, 'Efectivo', 'ab-1', 1);
SELECT registrar_pago_orden(203, 'QR / Link de pago', 'link-final', 1);
RESET ROLE;
SELECT t_assert((SELECT SUM(monto) = 500 FROM pagos WHERE orden_id = 203), 'P0-2. SUM(pagos) == total tras abono + cobro final');
SELECT t_assert((SELECT estatus = 'Pagada' FROM cuentas_por_cobrar WHERE id = 400) AND (SELECT saldo = 0 FROM clientes WHERE id = 10), 'P0-2. CxC liquidada y saldo 0');
ROLLBACK;

-- U. Chofer inserta egreso operativo (merma) pero no ingreso
BEGIN;
SELECT t_actor('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Egreso', 'Mermas', 'Merma ruta T', 12);
DO $$ BEGIN INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Ingreso', 'Ventas', 'falso-U', 12);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'U denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT COUNT(*) = 1 FROM movimientos_contables WHERE concepto = 'Merma ruta T') AND (SELECT COUNT(*) = 0 FROM movimientos_contables WHERE concepto = 'falso-U'), 'U. egreso operativo sí, ingreso no');
ROLLBACK;

-- Backend (service_role): sigue pudiendo aplicar pagos y marcar Entregada/Facturada
BEGIN;
SELECT t_actor('service_role', NULL); SET LOCAL ROLE service_role;
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, referencia, saldo_antes, saldo_despues) VALUES (11, 200, 100, 'QR / Link de pago', 'stripe:cs_backend', 0, 0);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'QR / Link de pago' WHERE id = 200;
UPDATE ordenes SET estatus = 'Facturada', facturama_uuid = 'uuid-1' WHERE id = 200;
RESET ROLE;
SELECT t_assert((SELECT estatus = 'Facturada' AND facturama_uuid = 'uuid-1' FROM ordenes WHERE id = 200), 'Backend service_role conserva sus escrituras');
ROLLBACK;

\echo
\echo '════════ TODAS LAS PRUEBAS PASARON ════════'
