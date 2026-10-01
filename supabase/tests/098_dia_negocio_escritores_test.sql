-- 098_dia_negocio_escritores_test.sql — escritores de "hoy" con el día de
-- negocio del servidor: pago de CxP y de nómina por contrato, egreso de
-- reembolso de devolución, periodo de costos, defaults de leads/CxP. Las
-- fechas elegidas por el usuario se conservan. Instante frontera: el mismo
-- instante desde sesiones UTC, Mazatlán, Ciudad de México y Madrid guarda el
-- mismo día (Mazatlán). La contención (099) se detecta por el privilegio de
-- INSERT sobre pagos_proveedores.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t98_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM pagos_proveedores WHERE cxp_id BETWEEN 9801 AND 9819;
  DELETE FROM costos_historial WHERE concepto LIKE 'Pago nómina T98%' OR concepto LIKE 'T98%';
  UPDATE nomina_periodos SET movimiento_id = NULL WHERE id BETWEEN 9801 AND 9819;
  DELETE FROM movimientos_contables WHERE concepto LIKE 'Pago a Prov 98%' OR concepto LIKE 'Pago nómina T98%' OR concepto LIKE 'T98%' OR orden_id = 9821;
  DELETE FROM nomina_recibos WHERE periodo_id BETWEEN 9801 AND 9819;
  DELETE FROM nomina_periodos WHERE id BETWEEN 9801 AND 9819;
  DELETE FROM empleados WHERE id = 9801;
  DELETE FROM cuentas_por_pagar WHERE id BETWEEN 9801 AND 9819 OR proveedor = 'Prov 98';
  DELETE FROM leads WHERE nombre LIKE 'T98%';
  DELETE FROM ordenes WHERE id = 9821;
  DELETE FROM usuarios WHERE id BETWEEN 9801 AND 9809;
  DELETE FROM auth.users WHERE id::text LIKE '98000000-%';
END $$;

-- 100: con el modelo canónico de nómina (fecha_inicio, recibos con snapshot) las
-- partes de nómina de esta suite quedan cubiertas por la suite 100.
CREATE OR REPLACE FUNCTION t98_canon() RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nomina_periodos' AND column_name = 'fecha_inicio')
$$;
GRANT EXECUTE ON FUNCTION t98_canon() TO PUBLIC;
BEGIN; SELECT t98_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('98000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t98' FROM generate_series(1, 2) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9801, 'Admin 98',  'u1@t98', 'Admin',  'Activo', '98000000-0000-0000-0000-000000000001'),
  (9802, 'Ventas 98', 'u2@t98', 'Ventas', 'Activo', '98000000-0000-0000-0000-000000000002');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso) VALUES (9801, 'Empleado 98', 'Operador', 'Producción', 300, '2026-01-01');
INSERT INTO cuentas_por_pagar (id, proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, estatus) VALUES
  (9801, 'Prov 98', 'Factura A', 1000, 0, 1000, '2026-09-01', 'Pendiente'),
  (9802, 'Prov 98', 'Factura B', 300,  0, 300,  '2026-09-01', 'Pendiente'),
  (9811, 'Prov 98', 'Frontera UTC',  100, 0, 100, '2026-09-01', 'Pendiente'),
  (9812, 'Prov 98', 'Frontera MZT',  100, 0, 100, '2026-09-01', 'Pendiente'),
  (9813, 'Prov 98', 'Frontera CDMX', 100, 0, 100, '2026-09-01', 'Pendiente'),
  (9814, 'Prov 98', 'Frontera MAD',  100, 0, 100, '2026-09-01', 'Pendiente');
DO $do$ BEGIN
  IF NOT t98_canon() THEN
    INSERT INTO nomina_periodos (id, periodo, fecha_pago, estatus) VALUES
      (9801, 'T98-S1', '2026-09-26', 'Calculada'), (9802, 'T98-S2', '2026-09-26', 'Calculada'), (9803, 'T98-S3', '2026-09-26', 'Pagado'),
      (9811, 'T98-UTC', '2026-09-26', 'Calculada'), (9812, 'T98-MZT', '2026-09-26', 'Calculada'),
      (9813, 'T98-CDMX', '2026-09-26', 'Calculada'), (9814, 'T98-MAD', '2026-09-26', 'Calculada');
    INSERT INTO nomina_recibos (periodo_id, empleado_id, neto_a_pagar) VALUES
      (9801, 9801, 300), (9801, 9801, 200.5), (9803, 9801, 100),
      (9811, 9801, 10), (9812, 9801, 20), (9813, 9801, 30), (9814, 9801, 40);
  END IF;
END $do$;
INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, fecha) VALUES
  (9821, 'OV-9821', 'Cliente 98', 'x', 500, 'Entregada', 'Efectivo', 'Contado', '2026-09-20');
COMMIT;

CREATE OR REPLACE FUNCTION t98_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '98000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t98_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t98_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
GRANT EXECUTE ON FUNCTION t98_actor(INTEGER), t98_assert(BOOLEAN, TEXT), t98_err(TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t98_ids;
CREATE TEMP TABLE t98_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t98_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t98_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t98_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t98_j(TEXT) TO PUBLIC;

\echo '── 098: contratos sin fecha del cliente'
SELECT t98_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND pg_get_function_identity_arguments(oid) !~* 'date') AND count(*) = 2
  FROM pg_proc WHERE oid IN ('public.pagar_cuenta_por_pagar(uuid,bigint,numeric,text,text)'::regprocedure, 'public.pagar_nomina(bigint)'::regprocedure)),
  '098-01 pagar_cuenta_por_pagar y pagar_nomina: SECURITY DEFINER, search_path fijo, sin parámetro de fecha');
BEGIN; SET LOCAL ROLE authenticated; SELECT t98_actor(2);
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9801, 10)$q$, '098-02 Ventas: pago de CxP denegado', '42501');
SELECT t98_err($q$SELECT pagar_nomina(9801)$q$, '098-03 Ventas: pago de nómina denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9801, 10)$q$, '098-04 anon: sin EXECUTE (CxP)', '42501');
SELECT t98_err($q$SELECT pagar_nomina(9801)$q$, '098-05 anon: sin EXECUTE (nómina)', '42501');
ROLLBACK;

\echo '── 098: pago de cuenta por pagar'
BEGIN; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
INSERT INTO t98_ids VALUES ('p1', pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9801, 400, 'Transferencia', 'REF-1')::text);
INSERT INTO t98_ids VALUES ('p1r', pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9801, 400, 'Transferencia', 'REF-1')::text);
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9801, 500, 'Transferencia', 'REF-1')$q$, '098-10 misma operación con otro monto: rechazada', '23505');
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c001', 9802, 400, 'Transferencia', 'REF-1')$q$, '098-11 misma operación en otra cuenta: rechazada', '23505');
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c002', 9801, 0)$q$, '098-12 monto cero: rechazado', '22023', '%Monto inválido%');
SELECT t98_err($q$SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c002', 9899, 10)$q$, '098-13 cuenta inexistente: rechazada', '22023', '%no encontrada%');
INSERT INTO t98_ids VALUES ('p2', pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c003', 9801, 600, NULL, NULL)::text);
INSERT INTO t98_ids VALUES ('p3', pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000c004', 9802, 350, 'Efectivo', '')::text);
COMMIT;
SELECT t98_assert((t98_j('p1') ->> 'fecha')::date = fin_hoy() AND (t98_j('p1') ->> 'estatus') = 'Parcial' AND (t98_j('p1') ->> 'saldo_pendiente')::numeric = 600
  AND (t98_j('p1r') ->> 'replay') = 'true' AND (t98_j('p1r') ->> 'pago_id') = (t98_j('p1') ->> 'pago_id'), '098-14 abono parcial: fecha = fin_hoy(), saldo 600, reintento = replay');
SELECT t98_assert((SELECT monto_pagado = 1000 AND saldo_pendiente = 0 AND estatus = 'Pagada' FROM cuentas_por_pagar WHERE id = 9801)
  AND (SELECT monto_pagado = 350 AND saldo_pendiente = 0 AND estatus = 'Pagada' FROM cuentas_por_pagar WHERE id = 9802), '098-15 misma aritmética de saldo/estatus que el frontend anterior (incluye sobrepago: saldo 0, Pagada)');
SELECT t98_assert((SELECT count(*) = 2 AND bool_and(pp.fecha = fin_hoy() AND m.fecha = pp.fecha AND m.monto = pp.monto AND m.tipo = 'Egreso' AND m.categoria = 'Proveedores'
                     AND m.concepto LIKE 'Pago a Prov 98 — Factura A') FROM pagos_proveedores pp JOIN movimientos_contables m ON m.id = pp.movimiento_id WHERE pp.cxp_id = 9801)
  AND (SELECT count(*) FROM movimientos_contables WHERE concepto LIKE 'Pago a Prov 98 — Factura A') = 2
  AND (SELECT metodo_pago = 'Transferencia' AND referencia = 'REF-1' FROM pagos_proveedores WHERE id = (t98_j('p1') ->> 'pago_id')::bigint)
  AND (SELECT metodo_pago = 'Transferencia' FROM pagos_proveedores WHERE id = (t98_j('p2') ->> 'pago_id')::bigint),
  '098-16 cada abono: un egreso y un pago a proveedor ligados, mismo monto y fecha del servidor (sin duplicado por el replay)');

\echo '── 098: pago de nómina'
DO $do$
BEGIN
  IF t98_canon() THEN
    RAISE NOTICE 'OK: 098-20..24 nómina: cubierto por el modelo canónico (suite 100)';
    RETURN;
  END IF;
  PERFORM t98_actor(1); SET LOCAL ROLE authenticated;
  INSERT INTO t98_ids VALUES ('n1', pagar_nomina(9801)::text);
  INSERT INTO t98_ids VALUES ('n1r', pagar_nomina(9801)::text);
  PERFORM t98_err($q$SELECT pagar_nomina(9802)$q$, '098-20 periodo sin recibos: no hay neto a pagar', '22023', '%No hay neto%');
  PERFORM t98_err($q$SELECT pagar_nomina(9803)$q$, '098-21 periodo ya marcado Pagado: no se paga otra vez', '22023', '%ya está pagado%');
  PERFORM t98_err($q$SELECT pagar_nomina(9899)$q$, '098-22 periodo inexistente', '22023', '%no encontrado%');
  RESET ROLE;
  PERFORM t98_assert((t98_j('n1') ->> 'fecha')::date = fin_hoy() AND (t98_j('n1') ->> 'total_neto')::numeric = 500.5
    AND (t98_j('n1r') ->> 'replay') = 'true' AND (t98_j('n1r') ->> 'movimiento_id') = (t98_j('n1') ->> 'movimiento_id'), '098-23 nómina: fecha = fin_hoy(), total del servidor, segundo pago = replay');
  PERFORM t98_assert((SELECT count(*) = 1 AND bool_and(m.fecha = fin_hoy() AND m.monto = 500.5 AND m.categoria = 'Nómina') FROM movimientos_contables m WHERE m.concepto = 'Pago nómina T98-S1')
    AND (SELECT count(*) = 1 AND bool_and(ch.fecha = fin_hoy() AND ch.periodo = to_char(fin_hoy(), 'YYYY-MM') AND ch.monto = 500.5 AND ch.tipo = 'Nómina'
           AND ch.movimiento_id = (t98_j('n1') ->> 'movimiento_id')::bigint) FROM costos_historial ch WHERE ch.concepto = 'Pago nómina T98-S1')
    AND (SELECT estatus = 'Pagado' AND total_neto = 500.5 AND pagado_at IS NOT NULL AND movimiento_id = (t98_j('n1') ->> 'movimiento_id')::bigint FROM nomina_periodos WHERE id = 9801),
    '098-24 un costo P&L y una salida de efectivo, ligados al periodo');
END $do$;

\echo '── 098: fechas del servidor vs fechas elegidas por el usuario'
BEGIN; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
-- Reembolso de devolución (cliente anterior manda su fecha local): el servidor pone la suya.
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES ('2000-01-01', 'Egreso', 'Devoluciones', 'T98 reembolso', 50, 9821);
-- Frontend nuevo: sin fecha.
INSERT INTO movimientos_contables (tipo, categoria, concepto, monto, orden_id) VALUES ('Egreso', 'Devoluciones', 'T98 reembolso nuevo', 20, 9821);
-- Asientos manuales con fecha elegida por el usuario: se conservan.
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES ('2026-08-15', 'Egreso', 'Devoluciones', 'T98 manual devoluciones', 5);
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES ('2026-08-15', 'Egreso', 'Nómina', 'T98 manual nómina', 5);
-- Costo variable / fijo: fecha elegida → periodo de esa fecha; sin fecha → día del servidor.
INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha) VALUES ('Variable', 'Gasolina', 'T98 gasto con fecha', 7, '2026-08-15');
INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Variable', 'Gasolina', 'T98 gasto sin fecha', 7);
INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha) VALUES ('Fijo', 'Renta', 'T98 fijo con periodo', 7, '2026-07', '2026-08-15');
-- Lead y CxP sin fecha: día del servidor; CxP con emisión elegida: se conserva.
INSERT INTO leads (nombre, estatus) VALUES ('T98 lead', 'Nuevo');
INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, saldo_pendiente) VALUES ('Prov 98', 'T98 sin emisión', 10, 10);
INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, saldo_pendiente, fecha_emision) VALUES ('Prov 98', 'T98 con emisión', 10, 10, '2026-08-15');
COMMIT;
SELECT t98_assert((SELECT bool_and(fecha = fin_hoy()) AND count(*) = 2 FROM movimientos_contables WHERE orden_id = 9821), '098-30 egreso de reembolso de devolución: fecha = fin_hoy() aunque el cliente envíe otra');
SELECT t98_assert((SELECT bool_and(fecha = '2026-08-15') AND count(*) = 2 FROM movimientos_contables WHERE concepto IN ('T98 manual devoluciones', 'T98 manual nómina')), '098-31 asientos manuales: la fecha elegida por el usuario se conserva');
SELECT t98_assert((SELECT periodo = '2026-08' FROM costos_historial WHERE concepto = 'T98 gasto con fecha')
  AND (SELECT fecha = fin_hoy() AND periodo = to_char(fin_hoy(), 'YYYY-MM') FROM costos_historial WHERE concepto = 'T98 gasto sin fecha')
  AND (SELECT periodo = '2026-07' AND fecha = '2026-08-15' FROM costos_historial WHERE concepto = 'T98 fijo con periodo'), '098-32 costos: fecha elegida se conserva, sin fecha = fin_hoy(), periodo derivado solo si falta');
SELECT t98_assert((SELECT fecha = fin_hoy() FROM leads WHERE nombre = 'T98 lead')
  AND (SELECT fecha_emision = fin_hoy() FROM cuentas_por_pagar WHERE concepto = 'T98 sin emisión')
  AND (SELECT fecha_emision = '2026-08-15' FROM cuentas_por_pagar WHERE concepto = 'T98 con emisión'), '098-33 lead y CxP sin fecha: día del servidor; emisión elegida: se conserva');

\echo '── 098: instante frontera desde cuatro zonas de cliente'
-- 2033-03-11 06:30 UTC = 23:30 del día 10 en Mazatlán; día 11 en UTC, CDMX y Madrid.
BEGIN;
CREATE OR REPLACE FUNCTION public.fin_hoy() RETURNS DATE LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $f$ SELECT fin_dia_negocio('2033-03-11 06:30:00+00'::timestamptz) $f$;
SELECT t98_assert(fin_hoy() = '2033-03-10' AND ('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'America/Mexico_City')::date = '2033-03-11'
  AND ('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'Europe/Madrid')::date = '2033-03-11' AND ('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'UTC')::date = '2033-03-11',
  '098-40 instante frontera: Mazatlán día 10; UTC, CDMX y Madrid día 11');
SET LOCAL TimeZone = 'UTC'; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000f001', 9811, 100, 'Transferencia', 'F-UTC');
SELECT CASE WHEN t98_canon() THEN NULL ELSE pagar_nomina(9811) END;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'UTC')::date, 'Egreso', 'Devoluciones', 'T98 frontera UTC', 1, 9821);
INSERT INTO leads (nombre, estatus) VALUES ('T98 frontera UTC', 'Nuevo');
INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Variable', 'Gasolina', 'T98 frontera UTC', 1);
RESET ROLE;
SET LOCAL TimeZone = 'America/Mazatlan'; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000f002', 9812, 100, 'Transferencia', 'F-MZT');
SELECT CASE WHEN t98_canon() THEN NULL ELSE pagar_nomina(9812) END;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'America/Mazatlan')::date, 'Egreso', 'Devoluciones', 'T98 frontera MZT', 2, 9821);
INSERT INTO leads (nombre, estatus) VALUES ('T98 frontera MZT', 'Nuevo');
INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Variable', 'Gasolina', 'T98 frontera MZT', 2);
RESET ROLE;
SET LOCAL TimeZone = 'America/Mexico_City'; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000f003', 9813, 100, 'Transferencia', 'F-CDMX');
SELECT CASE WHEN t98_canon() THEN NULL ELSE pagar_nomina(9813) END;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'America/Mexico_City')::date, 'Egreso', 'Devoluciones', 'T98 frontera CDMX', 3, 9821);
INSERT INTO leads (nombre, estatus) VALUES ('T98 frontera CDMX', 'Nuevo');
INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Variable', 'Gasolina', 'T98 frontera CDMX', 3);
RESET ROLE;
SET LOCAL TimeZone = 'Europe/Madrid'; SET LOCAL ROLE authenticated; SELECT t98_actor(1);
SELECT pagar_cuenta_por_pagar('98000000-0000-0000-0000-00000000f004', 9814, 100, 'Transferencia', 'F-MAD');
SELECT CASE WHEN t98_canon() THEN NULL ELSE pagar_nomina(9814) END;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (('2033-03-11 06:30:00+00'::timestamptz AT TIME ZONE 'Europe/Madrid')::date, 'Egreso', 'Devoluciones', 'T98 frontera MAD', 4, 9821);
INSERT INTO leads (nombre, estatus) VALUES ('T98 frontera MAD', 'Nuevo');
INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Variable', 'Gasolina', 'T98 frontera MAD', 4);
RESET ROLE;
SET LOCAL TimeZone = 'UTC';
SELECT t98_assert((SELECT count(*) = 4 AND bool_and(fecha = '2033-03-10') FROM pagos_proveedores WHERE cxp_id BETWEEN 9811 AND 9814)
  AND (SELECT count(*) = 4 AND bool_and(m.fecha = '2033-03-10') FROM pagos_proveedores pp JOIN movimientos_contables m ON m.id = pp.movimiento_id WHERE pp.cxp_id BETWEEN 9811 AND 9814),
  '098-41 pago de CxP desde UTC, Mazatlán, CDMX y Madrid: pago y egreso del día 10 (Mazatlán)');
SELECT t98_assert(t98_canon() OR (SELECT count(*) = 4 AND bool_and(m.fecha = '2033-03-10' AND ch.fecha = '2033-03-10' AND ch.periodo = '2033-03')
                     FROM nomina_periodos np JOIN movimientos_contables m ON m.id = np.movimiento_id JOIN costos_historial ch ON ch.movimiento_id = m.id WHERE np.id BETWEEN 9811 AND 9814),
  '098-42 pago de nómina desde las cuatro zonas: egreso y costo del día 10, periodo 2033-03');
SELECT t98_assert((SELECT count(*) = 4 AND bool_and(fecha = '2033-03-10') FROM movimientos_contables WHERE concepto LIKE 'T98 frontera %'),
  '098-43 reembolso de devolución: el cliente envió 11/10/11/11 según su zona; se guardó el 10 en las cuatro');
SELECT t98_assert((SELECT count(*) = 4 AND bool_and(fecha = '2033-03-10') FROM leads WHERE nombre LIKE 'T98 frontera %')
  AND (SELECT count(*) = 4 AND bool_and(fecha = '2033-03-10' AND periodo = '2033-03') FROM costos_historial WHERE concepto LIKE 'T98 frontera %'),
  '098-44 lead y gasto sin fecha: día 10 en las cuatro zonas');
-- El reporte 093 clasifica cada evento una sola vez, en el día 10.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO t98_ids VALUES ('r10', reporte_financiero('2033-03-10', '2033-03-10')::text), ('r11', reporte_financiero('2033-03-11', '2033-03-11')::text);
SELECT t98_assert((t98_j('r10') -> 'flujo' ->> 'salidas_pagos_proveedores')::numeric = 400 AND (t98_j('r10') -> 'flujo' ->> 'salidas_nomina')::numeric = CASE WHEN t98_canon() THEN 0 ELSE 100 END
  AND (t98_j('r10') -> 'flujo' ->> 'salidas_reembolsos')::numeric = 10 AND (t98_j('r10') -> 'flujo' ->> 'salidas_costos')::numeric = 0
  AND (t98_j('r10') -> 'flujo' ->> 'salidas_otras')::numeric = 0
  AND (t98_j('r10') -> 'resultados' ->> 'nomina')::numeric = CASE WHEN t98_canon() THEN 0 ELSE 100 END AND (t98_j('r10') -> 'resultados' ->> 'costos_variables')::numeric = 10
  AND (t98_j('r10') -> 'resultados' ->> 'otros_gastos')::numeric = 0,
  '098-45 reporte del día 10: CxP 400, nómina 100 (una salida y un costo), reembolsos 10, sin otros gastos ni doble conteo');
SELECT t98_assert((t98_j('r11') -> 'flujo' ->> 'salidas_pagos_proveedores')::numeric = 0 AND (t98_j('r11') -> 'flujo' ->> 'salidas_nomina')::numeric = 0
  AND (t98_j('r11') -> 'flujo' ->> 'salidas_reembolsos')::numeric = 0 AND (t98_j('r11') -> 'resultados' ->> 'nomina')::numeric = 0
  AND (t98_j('r11') -> 'resultados' ->> 'costos_variables')::numeric = 0, '098-46 reporte del día 11: vacío (nada se fue al día del navegador)');
ROLLBACK;
SELECT t98_assert(fin_hoy() = fin_dia_negocio(now()) AND NOT EXISTS (SELECT 1 FROM pagos_proveedores WHERE cxp_id BETWEEN 9811 AND 9814), '098-47 fin_hoy() restaurado; la prueba de frontera no deja filas');

\echo '── 098: frontend anterior (INSERT REST de pago a proveedor) y contención 099'
DO $do$
BEGIN
  PERFORM t98_actor(1); SET LOCAL ROLE authenticated;
  IF NOT has_table_privilege('authenticated', 'public.pagos_proveedores', 'INSERT') THEN
    PERFORM t98_err($q$INSERT INTO pagos_proveedores (cxp_id, monto, fecha, metodo_pago) VALUES (9802, 1, '2000-01-01', 'Efectivo')$q$, '098-50 INSERT REST de pago a proveedor sin privilegio (099)', '42501');
  ELSE
    INSERT INTO pagos_proveedores (cxp_id, monto, metodo_pago) VALUES (9802, 1, 'Efectivo');
    PERFORM t98_assert((SELECT fecha = fin_hoy() FROM pagos_proveedores WHERE cxp_id = 9802 AND operacion_id IS NULL), '098-50 antes de 099: el INSERT REST sin fecha toma fin_hoy()');
  END IF;
  RESET ROLE;
END $do$;

BEGIN; SELECT t98_limpiar(); COMMIT;
\echo '── 098: TODAS LAS PRUEBAS OK'
