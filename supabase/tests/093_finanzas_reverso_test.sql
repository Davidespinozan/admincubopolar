-- 093_finanzas_reverso_test.sql — Flujo de efectivo vs Estado de resultados,
-- delivered_at, producción inmutable con reverso y trazabilidad del stock.
-- Los reportes se comparan por DELTA contra una base tomada al inicio (el
-- resto de las suites también escribe con fecha de hoy). La parte de
-- contención (094) se detecta por la guarda de stock de productos.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t93_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;  -- limpieza de fixtures: sin guardas
  DELETE FROM devoluciones WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id = 9340 OR folio LIKE 'OV-93%');
  DELETE FROM pagos_proveedores WHERE cxp_id IN (SELECT id FROM cuentas_por_pagar WHERE proveedor LIKE 'Prov T93%');
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id = 9340 OR folio LIKE 'OV-93%') OR referencia LIKE '%T93%';
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id = 9340 OR folio LIKE 'OV-93%')
     OR concepto LIKE '%T93%' OR concepto LIKE '%P93-%' OR referencia LIKE 'recepcion_compra/93000000-%';
  DELETE FROM cuentas_por_cobrar WHERE cliente_id = 9340;
  DELETE FROM cuentas_por_pagar WHERE proveedor LIKE 'Prov T93%';
  DELETE FROM costos_historial WHERE concepto LIKE '%T93%' OR concepto LIKE '%P93-%';
  DELETE FROM mermas WHERE sku LIKE 'P93-%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P93-%';
  DELETE FROM produccion WHERE sku LIKE 'P93-%' OR input_sku LIKE 'P93-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '93000000-%';
  DELETE FROM auditoria WHERE detalle LIKE '%P93-%' OR detalle LIKE '%OP-L93%';
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id = 9340 OR folio LIKE 'OV-93%');
  DELETE FROM ordenes WHERE cliente_id = 9340 OR folio LIKE 'OV-93%';
  DELETE FROM clientes WHERE id = 9340;
  DELETE FROM cuartos_frios WHERE id IN ('CF-93A', 'CF-93B');
  UPDATE cuartos_frios SET stock = stock - 'P93-HIELO' - 'P93-SIN' - 'P93-TR' WHERE stock ?| ARRAY['P93-HIELO', 'P93-SIN', 'P93-TR'];
  DELETE FROM productos WHERE sku LIKE 'P93-%';
  DELETE FROM usuarios WHERE id BETWEEN 9301 AND 9309;
  DELETE FROM auth.users WHERE id::text LIKE '93000000-%';
END $$;

BEGIN;
SELECT t93_limpiar();
COMMIT;
BEGIN;
INSERT INTO auth.users (id, email)
  SELECT ('93000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t93' FROM generate_series(1, 6) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9301, 'Admin 93',  'u1@t93', 'Admin',          'Activo', '93000000-0000-0000-0000-000000000001'),
  (9302, 'Ventas 93', 'u2@t93', 'Ventas',         'Activo', '93000000-0000-0000-0000-000000000002'),
  (9304, 'Prod 93',   'u4@t93', 'Producción',     'Activo', '93000000-0000-0000-0000-000000000004'),
  (9305, 'Fact 93',   'u5@t93', 'Facturación',    'Activo', '93000000-0000-0000-0000-000000000005'),
  (9306, 'Bolsas 93', 'u6@t93', 'Almacén Bolsas', 'Activo', '93000000-0000-0000-0000-000000000006');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P93-EMP',   'Bolsa 93',       'Empaque',            0,  1000, 1.5, NULL),
  ('P93-EMPB',  'Bolsa B 93',     'Empaque',            0,  100,  2,   NULL),
  ('P93-MP',    'Barra 93',       'Materia Prima',      0,  50,   1,   NULL),
  ('P93-HIELO', 'Hielo 93',       'Producto Terminado', 10, 0,    5,   'P93-EMP'),
  ('P93-SIN',   'Hielo sin 93',   'Producto Terminado', 10, 0,    0,   NULL),
  ('P93-TR',    'Triturado 93',   'Producto Terminado', 10, 0,    0,   NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-93A', 'Cuarto 93 A', '{}'::jsonb), ('CF-93B', 'Cuarto 93 B', '{"P93-HIELO": 500}'::jsonb);
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (9340, 'Cliente 93', 'CLI930101AB1', 0, true, 100000);
INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
  ('OV-9301', 9340, 'Cliente 93', '100×P93-HIELO', 1000, 'Asignada', 'Efectivo',          'Contado', 9302),
  ('OV-9302', 9340, 'Cliente 93', '50×P93-HIELO',  500,  'Asignada', 'Crédito',           'Credito', 9302),
  ('OV-9303', 9340, 'Cliente 93', '25×P93-HIELO',  250,  'Asignada', 'QR / Link de pago', 'Contado', 9302),
  ('OV-9304', 9340, 'Cliente 93', '20×P93-HIELO',  200,  'Asignada', 'Crédito',           'Credito', 9302),
  ('OV-9305', 9340, 'Cliente 93', '1×P93-HIELO',   10,   'Asignada', 'Efectivo',          'Contado', 9302);
COMMIT;

CREATE OR REPLACE FUNCTION t93_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '93000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t93_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t93_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t93_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t93_o(p_folio TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$ SELECT id FROM ordenes WHERE folio = p_folio $$;
CREATE OR REPLACE FUNCTION t93_cf(p_cf TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_cf $$;
CREATE OR REPLACE FUNCTION t93_st(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
GRANT EXECUTE ON FUNCTION t93_actor(INTEGER), t93_assert(BOOLEAN, TEXT), t93_err(TEXT, TEXT, TEXT, TEXT), t93_rows(TEXT), t93_o(TEXT), t93_cf(TEXT, TEXT), t93_st(TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t93_ids;
CREATE TEMP TABLE t93_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t93_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t93_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t93_ids WHERE k = p_k $$;
-- Reporte de hoy (sin JWT: autoridad de SQL) y delta de una ruta contra una base.
CREATE OR REPLACE FUNCTION t93_rep() RETURNS JSONB LANGUAGE sql AS $$ SELECT reporte_financiero(fin_hoy(), fin_hoy()) $$;
CREATE OR REPLACE FUNCTION t93_d(p_base TEXT, p_sec TEXT, p_key TEXT) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT (t93_rep() -> p_sec ->> p_key)::numeric - (t93_j(p_base) -> p_sec ->> p_key)::numeric $$;
CREATE OR REPLACE FUNCTION t93_saldo(p_base TEXT, p_key TEXT) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT (t93_rep() -> 'saldos' ->> p_key)::numeric - (t93_j(p_base) -> 'saldos' ->> p_key)::numeric $$;
GRANT EXECUTE ON FUNCTION t93_j(TEXT) TO PUBLIC;

\echo '── 093: estado físico'
SELECT t93_assert((SELECT count(*) = 1 FROM information_schema.columns WHERE table_name = 'ordenes' AND column_name = 'delivered_at')
  AND (SELECT count(*) = 4 FROM information_schema.columns WHERE table_name = 'produccion' AND column_name IN ('revertida_at', 'revertida_por', 'reverso_operacion_id', 'motivo_reverso')), '093-01 columnas nuevas: ordenes.delivered_at y estado de reverso en produccion');
SELECT t93_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE'))
  FROM pg_proc WHERE oid IN ('public.revertir_produccion(uuid,bigint,text)'::regprocedure, 'public.ajustar_existencia(uuid,text,integer,text)'::regprocedure, 'public.reporte_financiero(date,date)'::regprocedure)), '093-02 contratos: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');
SELECT t93_assert(NOT has_function_privilege('authenticated', 'public.fin_egreso_no_efectivo(bigint,text,text)', 'EXECUTE'), '093-03 clasificador interno sin EXECUTE de API');
SELECT t93_assert((SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_delivered_at') AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_produccion_guard'), '093-04 disparadores de delivered_at y de producción presentes');

\echo '── 093: delivered_at (servidor, no falsificable, sin historia inventada)'
INSERT INTO t93_ids VALUES ('base', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
UPDATE ordenes SET delivered_at = '2020-01-01' WHERE folio = 'OV-9305';
COMMIT;
SELECT t93_assert((SELECT delivered_at IS NULL FROM ordenes WHERE folio = 'OV-9305'), '093-10 orden aún no entregada: delivered_at no se puede escribir desde la API');
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
UPDATE ordenes SET estatus = 'Entregada' WHERE folio = 'OV-9305';
COMMIT;
INSERT INTO t93_ids VALUES ('d1', (SELECT delivered_at::text FROM ordenes WHERE folio = 'OV-9305'));
SELECT t93_assert((SELECT v FROM t93_ids WHERE k = 'd1') IS NOT NULL, '093-11 al entrar a Entregada el servidor fija delivered_at');
BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE ordenes SET delivered_at = '2020-01-01', estatus = 'Facturada' WHERE folio = 'OV-9305';
COMMIT;
SELECT t93_assert((SELECT delivered_at::text = (SELECT v FROM t93_ids WHERE k = 'd1') AND estatus = 'Facturada' FROM ordenes WHERE folio = 'OV-9305'), '093-12 Entregada → Facturada (backend) conserva delivered_at; el valor enviado se ignora incluso para service_role');
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, fecha) VALUES ('OV-93L1', 9340, 'Cliente 93', 'legado', 77, 'Entregada', 'Efectivo', 'Contado', '2021-03-10');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE ordenes SET estatus = 'Facturada' WHERE folio = 'OV-93L1';
COMMIT;
SELECT t93_assert((SELECT delivered_at IS NULL FROM ordenes WHERE folio = 'OV-93L1'), '093-13 fila legada entregada: no se inventa delivered_at (ni al facturarla después)');
SELECT t93_assert((reporte_financiero('2021-03-10', '2021-03-10') -> 'resultados' ->> 'ventas_legado')::numeric >= 77
  AND (reporte_financiero('2021-03-10', '2021-03-10') -> 'resultados' ->> 'ventas_legado_n')::int >= 1, '093-14 legado: se reporta aparte como ventas_legado por la fecha de la orden');

\echo '── 093: aceptación financiera (efectivo vs resultados)'
INSERT INTO t93_ids VALUES ('b0', t93_rep()::text);
-- Venta de contado entregada y cobrada (flujo nuevo de mostrador: pago canónico).
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
UPDATE ordenes SET estatus = 'Entregada' WHERE folio = 'OV-9301';
SELECT registrar_pago_orden(t93_o('OV-9301'), 'Efectivo');
-- Venta a crédito entregada: CxC; cobro posterior de 300.
UPDATE ordenes SET estatus = 'Entregada' WHERE folio = 'OV-9302';
SELECT crear_cxc_orden(t93_o('OV-9302'), 30);
SELECT abonar_cxc((SELECT id FROM cuentas_por_cobrar WHERE orden_id = t93_o('OV-9302')), 300, 'Efectivo');
-- Compra de empaque de contado (200).
SELECT registrar_recepcion_compra('93000000-0000-0000-0000-00000000a001', 'P93-EMP', 100, 200, 'Prov T93', false);
-- Renta (costo fijo aplicado: egreso + historial ligado) y nómina pagada.
WITH m AS (INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (fin_hoy(), 'Egreso', 'Renta', 'Renta T93 (Mensual)', 400, '') RETURNING id)
INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id) SELECT 'Fijo', 'Renta', 'Renta T93', 400, to_char(fin_hoy(), 'YYYY-MM'), fin_hoy(), '', id FROM m;
DO $do$ BEGIN
  -- 100: el egreso y el costo de nómina por API se niegan (los registra
  -- pagar_nomina); aquí son un fixture de confianza con la misma forma.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nomina_periodos' AND column_name = 'fecha_inicio') THEN RESET ROLE; END IF;
  WITH m AS (INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (fin_hoy(), 'Egreso', 'Nómina', 'Pago nómina T93', 600) RETURNING id)
  INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, movimiento_id) SELECT 'Nómina', 'Nómina', 'Pago nómina T93', 600, to_char(fin_hoy(), 'YYYY-MM'), fin_hoy(), id FROM m;
END $do$;
COMMIT;
-- 102/103: la merma de cuarto indica el cuarto (registrar_merma_cuarto) cuando existe.
CREATE OR REPLACE FUNCTION t93_merma_cuarto(p_cuarto TEXT, p_sku TEXT, p_cant INTEGER, p_causa TEXT, p_origen TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $mc$
DECLARE r JSONB;
BEGIN
  IF to_regprocedure('public.registrar_merma_cuarto(uuid,text,text,integer,text,text)') IS NULL THEN
    EXECUTE 'SELECT registrar_merma($1, $2, $3, $4)' INTO r USING p_sku, p_cant, p_causa, p_origen;
  ELSE
    EXECUTE 'SELECT registrar_merma_cuarto(gen_random_uuid(), $1, $2, $3, $4)' INTO r USING p_cuarto, p_sku, p_cant, p_causa;
  END IF;
  RETURN r;
END $mc$;
GRANT EXECUTE ON FUNCTION t93_merma_cuarto(TEXT, TEXT, INTEGER, TEXT, TEXT) TO PUBLIC;
-- Consumo de empaque (producción de 100 → 100 × 1.5 = 150) y merma de 10 × 5 = 50.
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
SELECT registrar_produccion('93000000-0000-0000-0000-00000000b001', 'Turno 1', 'Máquina 93', 'P93-HIELO', 100, 'CF-93A');
SELECT t93_merma_cuarto('CF-93A', 'P93-HIELO', 10, 'Bolsa rota');
COMMIT;
SELECT t93_assert(t93_d('b0', 'resultados', 'ventas_entregadas') = 1500, '093-20 ingreso por entrega: contado 1000 + crédito 500 = 1500 (el cobro de 300 NO es otro ingreso)');
SELECT t93_assert(t93_d('b0', 'resultados', 'costo_ventas') = 150, '093-21 costo de ventas: consumo de empaque 150 (la compra de 200 no es gasto)');
SELECT t93_assert(t93_d('b0', 'resultados', 'costos_fijos') = 400 AND t93_d('b0', 'resultados', 'nomina') = 600 AND t93_d('b0', 'resultados', 'mermas') = 50, '093-22 renta 400, nómina 600, merma 50: una vez cada uno');
SELECT t93_assert(t93_d('b0', 'resultados', 'otros_gastos') = 0 AND t93_d('b0', 'resultados', 'otros_ingresos') = 0 AND t93_d('b0', 'resultados', 'gastos_credito') = 0, '093-23 ni el egreso ligado ni el ingreso contable duplican el estado de resultados');
SELECT t93_assert(t93_d('b0', 'resultados', 'utilidad') = 300, '093-24 utilidad = 1500 − 150 − 400 − 600 − 50 = 300');
SELECT t93_assert(t93_d('b0', 'flujo', 'entradas_pagos') = 1300 AND t93_d('b0', 'flujo', 'entradas') = 1300, '093-25 entradas de efectivo: pago de contado 1000 + cobro 300 = 1300 (crédito no cobrado: 0)');
SELECT t93_assert(t93_d('b0', 'flujo', 'salidas_compras_contado') = 200 AND t93_d('b0', 'flujo', 'salidas_costos') = 400 AND t93_d('b0', 'flujo', 'salidas_nomina') = 600
  AND t93_d('b0', 'flujo', 'salidas') = 1200, '093-26 salidas: compra 200 + renta 400 + nómina 600 = 1200');
SELECT t93_assert(t93_d('b0', 'flujo', 'excluido_no_efectivo') = 50 AND t93_d('b0', 'flujo', 'neto') = 100, '093-27 merma y consumo sin salida de dinero; neto 1300 − 1200 = 100');
SELECT t93_assert(t93_saldo('b0', 'cxc_pendiente') = 200, '093-28 CxC pendiente +200 (500 − 300)');

\echo '── 093: pago por webhook (service_role)'
INSERT INTO t93_ids VALUES ('b1', t93_rep()::text);
BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (9340, t93_o('OV-9303'), 250, 'QR / Link de pago', fin_hoy(), 'mercadopago:T93', 0, 0);
UPDATE ordenes SET estatus = 'Entregada' WHERE folio = 'OV-9303';
COMMIT;
SELECT t93_assert(t93_d('b1', 'flujo', 'entradas') = 250 AND t93_d('b1', 'resultados', 'ventas_entregadas') = 250
  AND (SELECT delivered_at IS NOT NULL FROM ordenes WHERE folio = 'OV-9303'), '093-30 webhook: entrada de efectivo una vez (pagos) e ingreso una vez (entrega), sin ingreso contable redundante');

\echo '── 093: compras a crédito y CxP'
INSERT INTO t93_ids VALUES ('b2', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(6);
SELECT registrar_recepcion_compra('93000000-0000-0000-0000-00000000a002', 'P93-EMP', 50, 100, 'Prov T93 crédito', true);
COMMIT;
SELECT t93_assert(t93_d('b2', 'flujo', 'salidas') = 0 AND t93_d('b2', 'resultados', 'utilidad') = 0 AND t93_saldo('b2', 'cxp_pendiente') = 100, '093-31 compra de empaque a crédito: solo CxP (sin salida de dinero ni gasto)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
DO $do$ BEGIN
  IF has_table_privilege('authenticated', 'public.pagos_proveedores', 'INSERT') THEN
    UPDATE cuentas_por_pagar SET monto_pagado = 100, saldo_pendiente = 0, estatus = 'Pagada' WHERE proveedor = 'Prov T93 crédito';
    WITH m AS (INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (fin_hoy(), 'Egreso', 'Proveedores', 'Pago a Prov T93 crédito', 100, '') RETURNING id)
    INSERT INTO pagos_proveedores (cxp_id, monto, fecha, metodo_pago, referencia, movimiento_id) SELECT (SELECT id FROM cuentas_por_pagar WHERE proveedor = 'Prov T93 crédito'), 100, fin_hoy(), 'Transferencia', '', id FROM m;
  ELSE
    -- 099: el pago a proveedor va por el contrato (misma aritmética, fecha del servidor).
    PERFORM pagar_cuenta_por_pagar('93000000-0000-0000-0000-00000000c0f1', (SELECT id FROM cuentas_por_pagar WHERE proveedor = 'Prov T93 crédito'), 100, 'Transferencia', '');
  END IF;
END $do$;
-- CxP de un servicio (no inventario): gasto al emitirse, dinero al pagarse.
INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, categoria, estatus) VALUES ('Prov T93 servicio', 'Mantenimiento T93', 80, 0, 80, fin_hoy(), 'Mantenimiento', 'Pendiente');
COMMIT;
SELECT t93_assert(t93_d('b2', 'flujo', 'salidas_pagos_proveedores') = 100 AND t93_d('b2', 'flujo', 'salidas') = 100 AND t93_d('b2', 'resultados', 'otros_gastos') = 0, '093-32 pago de CxP de empaque: salida de dinero una vez, sin gasto nuevo');
SELECT t93_assert(t93_d('b2', 'resultados', 'gastos_credito') = 80 AND t93_d('b2', 'resultados', 'utilidad') = -80, '093-33 CxP de servicio: gasto una vez al emitirse');
INSERT INTO t93_ids VALUES ('b3', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
DO $do$ BEGIN
  IF has_table_privilege('authenticated', 'public.pagos_proveedores', 'INSERT') THEN
    UPDATE cuentas_por_pagar SET monto_pagado = 80, saldo_pendiente = 0, estatus = 'Pagada' WHERE proveedor = 'Prov T93 servicio';
    WITH m AS (INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (fin_hoy(), 'Egreso', 'Proveedores', 'Pago a Prov T93 servicio', 80, '') RETURNING id)
    INSERT INTO pagos_proveedores (cxp_id, monto, fecha, metodo_pago, referencia, movimiento_id) SELECT (SELECT id FROM cuentas_por_pagar WHERE proveedor = 'Prov T93 servicio'), 80, fin_hoy(), 'Transferencia', '', id FROM m;
  ELSE
    PERFORM pagar_cuenta_por_pagar('93000000-0000-0000-0000-00000000c0f2', (SELECT id FROM cuentas_por_pagar WHERE proveedor = 'Prov T93 servicio'), 80, 'Transferencia', '');
  END IF;
END $do$;
COMMIT;
SELECT t93_assert(t93_d('b3', 'flujo', 'salidas') = 80 AND t93_d('b3', 'resultados', 'utilidad') = 0, '093-34 pago de la CxP de servicio: dinero una vez, sin segundo gasto');

\echo '── 093: devoluciones'
INSERT INTO t93_ids VALUES ('b4', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
UPDATE ordenes SET estatus = 'Entregada' WHERE folio = 'OV-9304';
SELECT crear_cxc_orden(t93_o('OV-9304'), 30);
COMMIT;
INSERT INTO t93_ids VALUES ('b5', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
-- Crédito no cobrado, reembolso 'Efectivo': solo se reduce la CxC (sin egreso).
INSERT INTO devoluciones (orden_id, cliente_id, motivo, tipo_reembolso, total, items, usuario) VALUES (t93_o('OV-9304'), 9340, 'T93 mal estado', 'Efectivo', 50, '[]', 'Admin 93');
SELECT ajustar_cxc_devolucion(t93_o('OV-9304'), 50);
COMMIT;
SELECT t93_assert(t93_d('b5', 'resultados', 'devoluciones') = 50 AND t93_d('b5', 'resultados', 'utilidad') = -50
  AND t93_d('b5', 'flujo', 'salidas') = 0 AND t93_saldo('b5', 'cxc_pendiente') = -50, '093-40 devolución de crédito no cobrado: ingreso −50 y CxC −50, sin salida de dinero');
INSERT INTO t93_ids VALUES ('b6', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
INSERT INTO devoluciones (orden_id, cliente_id, motivo, tipo_reembolso, total, items, usuario) VALUES (t93_o('OV-9301'), 9340, 'T93 reembolso', 'Efectivo', 100, '[]', 'Admin 93');
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (fin_hoy(), 'Egreso', 'Devoluciones', 'Devolución cliente OV-9301 T93', 100, t93_o('OV-9301'));
INSERT INTO devoluciones (orden_id, cliente_id, motivo, tipo_reembolso, total, items, usuario) VALUES (t93_o('OV-9301'), 9340, 'T93 reposición', 'Reposicion', 30, '[]', 'Admin 93');
COMMIT;
SELECT t93_assert(t93_d('b6', 'flujo', 'salidas_reembolsos') = 100 AND t93_d('b6', 'flujo', 'salidas') = 100
  AND t93_d('b6', 'resultados', 'devoluciones') = 100 AND t93_d('b6', 'resultados', 'otros_gastos') = 0 AND t93_d('b6', 'resultados', 'utilidad') = -100, '093-41 reembolso real en efectivo: salida una vez e ingreso −100 una vez; la reposición no mueve nada');

\echo '── 093: costos variables, gastos e ingresos manuales, costo legado'
INSERT INTO t93_ids VALUES ('b7', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
WITH m AS (INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (fin_hoy(), 'Egreso', 'Gasolina', 'Gas T93', 70, '') RETURNING id)
INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id) SELECT 'Variable', 'Gasolina', 'Gas T93', 70, to_char(fin_hoy(), 'YYYY-MM'), fin_hoy(), '', id FROM m;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (fin_hoy(), 'Egreso', 'Combustible', 'Diésel T93', 40);
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (fin_hoy(), 'Ingreso', 'Otro ingreso', 'Venta de chatarra T93', 25);
COMMIT;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (fin_hoy(), 'Egreso', 'Costo de Ventas', 'Producción OP-T93: legado', 30);
SELECT t93_assert(t93_d('b7', 'resultados', 'costos_variables') = 70 AND t93_d('b7', 'flujo', 'salidas_costos') = 70, '093-50 costo variable: una vez en resultados y una vez en efectivo');
SELECT t93_assert(t93_d('b7', 'resultados', 'otros_gastos') = 40 AND t93_d('b7', 'flujo', 'salidas_otras') = 40, '093-51 gasto manual sin vínculo: una vez en cada vista');
SELECT t93_assert(t93_d('b7', 'resultados', 'otros_ingresos') = 25 AND t93_d('b7', 'flujo', 'entradas_manuales') = 25, '093-52 ingreso manual: una vez en cada vista');
SELECT t93_assert(t93_d('b7', 'flujo', 'excluido_no_efectivo') = 30 AND t93_d('b7', 'resultados', 'costo_ventas') = 0 AND t93_d('b7', 'resultados', 'utilidad') = -70 - 40 + 25, '093-53 egreso legado de costo de producción: ni efectivo ni segundo costo');

\echo '── 093: totales sin topes de filas'
BEGIN;
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) SELECT '2021-04-15', 'Egreso', 'Combustible', 'T93 volumen ' || g, 1 FROM generate_series(1, 600) g;
COMMIT;
SELECT t93_assert((reporte_financiero('2021-04-15', '2021-04-15') -> 'flujo' ->> 'salidas_otras')::numeric >= 600
  AND (reporte_financiero('2021-04-15', '2021-04-15') -> 'resultados' ->> 'otros_gastos')::numeric >= 600, '093-55 600 movimientos en un periodo: el total del servidor los incluye todos');

\echo '── 093: autorización del reporte'
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(2);
SELECT t93_err($q$SELECT reporte_financiero(fin_hoy(), fin_hoy())$q$, '093-56 Ventas: reporte financiero denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(5);
SELECT t93_assert((reporte_financiero(fin_hoy(), fin_hoy()) -> 'flujo') IS NOT NULL, '093-57 Facturación: reporte disponible');
SELECT t93_err($q$SELECT reporte_financiero(fin_hoy(), fin_hoy() - 1)$q$, '093-58 periodo invertido rechazado', '22023');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t93_err($q$SELECT reporte_financiero(fin_hoy(), fin_hoy())$q$, '093-59 anon: sin EXECUTE', '42501');
ROLLBACK;

\echo '── 093: reverso de producción'
INSERT INTO t93_ids VALUES ('cogs0', t93_rep()::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
INSERT INTO t93_ids VALUES ('p1', registrar_produccion('93000000-0000-0000-0000-00000000b002', 'Turno 2', 'Máquina 93', 'P93-HIELO', 20, 'CF-93A')::text);
COMMIT;
INSERT INTO t93_ids VALUES ('e0', t93_st('P93-EMP')::text), ('eb0', t93_st('P93-EMPB')::text), ('a0', t93_cf('CF-93A', 'P93-HIELO')::text), ('bb0', t93_cf('CF-93B', 'P93-HIELO')::text);
SELECT t93_assert(t93_d('cogs0', 'resultados', 'costo_ventas') = 30, '093-60 producción de 20: costo 30 (20 × 1.5)');
-- El catálogo cambia de empaque después de producir.
UPDATE productos SET empaque_sku = 'P93-EMPB' WHERE sku = 'P93-HIELO';
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c001', %s, 'error de captura')$q$, t93_j('p1') ->> 'id'), '093-61 Producción: revertir denegado (solo Admin)', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c001', %s, '  ')$q$, t93_j('p1') ->> 'id'), '093-62 motivo vacío rechazado', '22023');
INSERT INTO t93_ids VALUES ('r1', revertir_produccion('93000000-0000-0000-0000-00000000c001', (t93_j('p1') ->> 'id')::bigint, 'error de captura')::text);
INSERT INTO t93_ids VALUES ('r1r', revertir_produccion('93000000-0000-0000-0000-00000000c001', (t93_j('p1') ->> 'id')::bigint, 'error de captura')::text);
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c001', %s, 'otro motivo')$q$, t93_j('p1') ->> 'id'), '093-63 misma operación con otro motivo: rechazada', '23505');
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c002', %s, 'segunda vez')$q$, t93_j('p1') ->> 'id'), '093-64 otra operación sobre una producción ya revertida: rechazada', '22023', '%ya fue revertida%');
COMMIT;
SELECT t93_assert(t93_cf('CF-93A', 'P93-HIELO') = (SELECT v::int FROM t93_ids WHERE k = 'a0') - 20 AND t93_cf('CF-93B', 'P93-HIELO') = (SELECT v::int FROM t93_ids WHERE k = 'bb0'), '093-65 producto terminado sale SOLO del cuarto original (CF-93A −20; CF-93B intacto)');
SELECT t93_assert(t93_st('P93-EMP') = (SELECT v::int FROM t93_ids WHERE k = 'e0') + 20 AND t93_st('P93-EMPB') = (SELECT v::int FROM t93_ids WHERE k = 'eb0'), '093-66 empaque devuelto al SKU histórico (P93-EMP +20); el empaque actual del catálogo no cambia');
SELECT t93_assert((t93_j('r1r') ->> 'replay') = 'true' AND (SELECT count(*) = 2 FROM inventario_mov WHERE operacion_id = '93000000-0000-0000-0000-00000000c001')
  AND (SELECT count(*) = 1 FROM costos_historial WHERE referencia = 'PROD-' || (t93_j('p1') ->> 'id') || '/reverso'), '093-67 reintento: replay sin segundo efecto de stock ni de costo');
SELECT t93_assert(t93_d('cogs0', 'resultados', 'costo_ventas') = 0 AND (SELECT count(*) = 1 FROM costos_historial WHERE referencia = 'PROD-' || (t93_j('p1') ->> 'id')), '093-68 costo neto: original + reverso = 0; el costo original sigue en la historia');
SELECT t93_assert((SELECT estatus = 'Revertida' AND revertida_por = 9301 AND revertida_at IS NOT NULL AND motivo_reverso = 'error de captura'
  AND reverso_operacion_id = '93000000-0000-0000-0000-00000000c001' AND cantidad = 20 AND cuarto_id = 'CF-93A' AND empaque_sku = 'P93-EMP' AND empaque_cantidad = 20
  AND costo_total = 30 AND operacion_id = '93000000-0000-0000-0000-00000000b002' FROM produccion WHERE id = (t93_j('p1') ->> 'id')::bigint), '093-69 la producción sigue existiendo con sus datos originales y el registro del reverso');
SELECT t93_assert((SELECT count(*) = 1 FROM auditoria WHERE accion = 'Revertir' AND modulo = 'Producción' AND detalle LIKE (t93_j('p1') ->> 'folio') || '%'), '093-70 auditoría del reverso (quién, qué, motivo)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
INSERT INTO t93_ids VALUES ('p1b', registrar_produccion('93000000-0000-0000-0000-00000000b002', 'Turno 2', 'Máquina 93', 'P93-HIELO', 20, 'CF-93A')::text);
COMMIT;
SELECT t93_assert((t93_j('p1b') ->> 'replay') = 'true' AND (SELECT count(*) = 1 FROM produccion WHERE operacion_id = '93000000-0000-0000-0000-00000000b002'), '093-71 el operacion_id original sigue ocupado: reintentar la producción es replay');
SELECT t93_assert((SELECT (x ->> 'consumido_produccion')::int FROM jsonb_array_elements(conciliacion_empaque()) x WHERE x ->> 'sku' = 'P93-EMP') = 100, '093-72 conciliación: la producción revertida no cuenta como uso (solo la de 100)');

-- Producción sin empaque: el reverso no inventa empaque.
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
INSERT INTO t93_ids VALUES ('p2', registrar_produccion('93000000-0000-0000-0000-00000000b003', 'Turno 1', 'Máquina 93', 'P93-SIN', 5, 'CF-93A')::text);
COMMIT;
INSERT INTO t93_ids VALUES ('k2', (SELECT count(*) FROM inventario_mov WHERE producto LIKE 'P93-EMP%')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
INSERT INTO t93_ids VALUES ('r2', revertir_produccion('93000000-0000-0000-0000-00000000c003', (t93_j('p2') ->> 'id')::bigint, 'prueba sin empaque')::text);
COMMIT;
SELECT t93_assert((t93_j('r2') ->> 'empaque_devuelto')::int = 0 AND (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P93-EMP%') = (SELECT v FROM t93_ids WHERE k = 'k2')
  AND NOT EXISTS (SELECT 1 FROM costos_historial WHERE referencia = 'PROD-' || (t93_j('p2') ->> 'id') || '/reverso'), '093-73 producción sin empaque: el reverso no devuelve empaque ni crea costo');

-- Cuarto original sin existencia: falla cerrado, sin reverso parcial.
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
INSERT INTO t93_ids VALUES ('p3', registrar_produccion('93000000-0000-0000-0000-00000000b004', 'Turno 1', 'Máquina 93', 'P93-HIELO', 10, 'CF-93A')::text);
COMMIT;
UPDATE cuartos_frios SET stock = jsonb_set(stock, '{P93-HIELO}', '3') WHERE id = 'CF-93A';
INSERT INTO t93_ids VALUES ('e3', t93_st('P93-EMP')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c004', %s, 'sin existencia')$q$, t93_j('p3') ->> 'id'), '093-74 cuarto original con 3 < 10: reverso rechazado', 'P0001', '%Stock insuficiente%');
COMMIT;
SELECT t93_assert(t93_cf('CF-93A', 'P93-HIELO') = 3 AND t93_cf('CF-93B', 'P93-HIELO') = (SELECT v::int FROM t93_ids WHERE k = 'bb0') AND t93_st('P93-EMP') = (SELECT v::int FROM t93_ids WHERE k = 'e3')
  AND (SELECT estatus = 'Confirmada' AND revertida_at IS NULL FROM produccion WHERE id = (t93_j('p3') ->> 'id')::bigint)
  AND NOT EXISTS (SELECT 1 FROM stock_operaciones WHERE operacion_id = '93000000-0000-0000-0000-00000000c004'), '093-75 sin reverso parcial: no toma de otro cuarto, no devuelve empaque, la producción sigue Confirmada');

-- Producción legada sin datos suficientes y transformación: no reversibles.
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus, tipo) VALUES ('OP-L93', CURRENT_DATE, 'Turno 1', 'Máquina 93', 'P93-HIELO', 5, 'Confirmada', 'Produccion');
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
INSERT INTO t93_ids VALUES ('tr', registrar_transformacion('93000000-0000-0000-0000-00000000b005', 'P93-MP', 10, 'P93-TR', 8, 'CF-93A')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c005', %s, 'legado')$q$, (SELECT id FROM produccion WHERE folio = 'OP-L93')), '093-76 producción legada sin cuarto/empaque: no reversible', '22023', '%legada%');
SELECT t93_err(format($q$SELECT revertir_produccion('93000000-0000-0000-0000-00000000c006', %s, 'transformación')$q$, t93_j('tr') ->> 'id'), '093-77 transformación: no reversible todavía', '22023', '%transformaciones%');
SELECT t93_err(format($q$UPDATE produccion SET cantidad = 999 WHERE id = %s$q$, t93_j('p3') ->> 'id'), '093-78 Admin: cambiar la cantidad de una producción por API denegado', '42501', '%inmutable%');
SELECT t93_err(format($q$UPDATE produccion SET estatus = 'Revertida' WHERE id = %s$q$, t93_j('p3') ->> 'id'), '093-79 Admin: marcar Revertida por API denegado', '42501', '%inmutable%');
SELECT t93_assert(t93_rows(format($q$UPDATE produccion SET turno = 'Turno 3', maquina = 'Máquina 20' WHERE id = %s$q$, t93_j('p3') ->> 'id')) = 1, '093-80 Admin: corregir turno y máquina permitido');
COMMIT;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_productos_guard_stock') THEN
    RAISE NOTICE 'OK: 093-81 (094 aún no aplicada: el frontend anterior conserva su DELETE)';
    RETURN;
  END IF;
  PERFORM t93_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t93_err(format($q$DELETE FROM produccion WHERE id = %s$q$, t93_j('tr') ->> 'id'), '093-81 transformación: DELETE físico sin privilegio (094)', '42501');
  PERFORM t93_err(format($q$DELETE FROM produccion WHERE id = %s$q$, t93_j('p1') ->> 'id'), '093-82 producción revertida: DELETE físico sin privilegio; su operacion_id sigue ocupado', '42501');
  RESET ROLE;
END $do$;
SELECT t93_assert((SELECT count(*) = 1 FROM produccion WHERE id = (t93_j('tr') ->> 'id')::bigint) AND (SELECT count(*) = 1 FROM produccion WHERE id = (t93_j('p1') ->> 'id')::bigint), '093-83 las filas originales siguen existiendo');

\echo '── 093: stock de catálogo trazable'
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
INSERT INTO t93_ids VALUES ('s0', t93_st('P93-EMPB')::text);
SELECT t93_assert(t93_rows($q$UPDATE productos SET precio = 1, nombre = 'Bolsa B 93 editada', empaque_sku = NULL WHERE sku = 'P93-EMPB'$q$) = 1 AND t93_st('P93-EMPB') = (SELECT v::int FROM t93_ids WHERE k = 's0'), '093-90 editar nombre/precio/empaque sin enviar stock: el stock no cambia');
COMMIT;
-- Carrera: el formulario abierto con 100; mientras tanto se consume; se guarda solo el precio.
UPDATE productos SET stock = 100 WHERE sku = 'P93-EMPB';
UPDATE productos SET stock = stock - 20 WHERE sku = 'P93-EMPB';
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
UPDATE productos SET precio = 2 WHERE sku = 'P93-EMPB';
COMMIT;
SELECT t93_assert(t93_st('P93-EMPB') = 80, '093-91 guardar metadatos con un formulario viejo no restaura el stock (queda 80)');
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_productos_guard_stock') THEN
    RAISE NOTICE 'OK: 093-92 (094 aún no aplicada: el frontend anterior aún escribe stock)';
    RETURN;
  END IF;
  PERFORM t93_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t93_err($q$UPDATE productos SET stock = 999 WHERE sku = 'P93-EMPB'$q$, '093-92 Admin: cambiar el stock de un insumo por UPDATE denegado (094)', '42501', '%trazables%');
  RESET ROLE;
END $do$;
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
SELECT t93_err($q$SELECT ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-EMPB', 70, '')$q$, '093-93 ajuste sin motivo rechazado', '22023');
SELECT t93_err($q$SELECT ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-EMPB', -1, 'conteo')$q$, '093-94 existencia negativa rechazada', '22023');
SELECT t93_err($q$SELECT ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-ZZ', 1, 'conteo')$q$, '093-95 SKU inexistente rechazado', '22023');
INSERT INTO t93_ids VALUES ('aj', ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-EMPB', 70, 'conteo físico')::text);
INSERT INTO t93_ids VALUES ('ajr', ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-EMPB', 70, 'conteo físico')::text);
SELECT t93_err($q$SELECT ajustar_existencia('93000000-0000-0000-0000-00000000d001', 'P93-EMPB', 60, 'conteo físico')$q$, '093-96 misma operación con otra existencia: rechazada', '23505');
COMMIT;
SELECT t93_assert(t93_st('P93-EMPB') = 70 AND (t93_j('aj') ->> 'delta')::int = -10 AND (t93_j('ajr') ->> 'replay') = 'true'
  AND (SELECT count(*) = 1 AND bool_and(tipo = 'Salida' AND cantidad = 10 AND referencia = 'ajuste_existencia/P93-EMPB' AND usuario = 'Admin 93' AND origen = 'Ajuste manual: conteo físico')
       FROM inventario_mov WHERE operacion_id = '93000000-0000-0000-0000-00000000d001'), '093-97 ajuste de insumo: 80 → 70, un kardex con actor canónico, replay sin duplicar');
SELECT t93_assert((SELECT count(*) >= 1 FROM auditoria WHERE modulo = 'Inventario' AND detalle LIKE 'P93-EMPB: 80 → 70%'), '093-98 auditoría del ajuste');
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(4);
SELECT t93_err($q$SELECT ajustar_existencia(gen_random_uuid(), 'P93-EMPB', 1, 'x')$q$, '093-99 Producción: ajuste denegado', '42501');
ROLLBACK;
-- Producto terminado: el ajuste va a los cuartos con kardex por cuarto.
INSERT INTO t93_ids VALUES ('pt0', (t93_cf('CF-93A', 'P93-HIELO') + t93_cf('CF-93B', 'P93-HIELO'))::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
INSERT INTO t93_ids VALUES ('ajpt', ajustar_existencia('93000000-0000-0000-0000-00000000d002', 'P93-HIELO', (SELECT v::int FROM t93_ids WHERE k = 'pt0') - 5, 'conteo cuartos')::text);
COMMIT;
SELECT t93_assert(t93_cf('CF-93A', 'P93-HIELO') + t93_cf('CF-93B', 'P93-HIELO') = (SELECT v::int FROM t93_ids WHERE k = 'pt0') - 5 AND t93_st('P93-HIELO') = (SELECT v::int FROM t93_ids WHERE k = 'pt0') - 5
  AND (SELECT bool_and(cuarto_id IS NOT NULL AND referencia = 'ajuste_existencia/P93-HIELO') FROM inventario_mov WHERE operacion_id = '93000000-0000-0000-0000-00000000d002'), '093-100 ajuste de producto terminado: cuartos −5 con kardex por cuarto; espejo en productos');
-- Alta de un insumo con existencia inicial: evento de kardex.
BEGIN; SET LOCAL ROLE authenticated; SELECT t93_actor(1);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P93-NUEVA', 'Bolsa nueva 93', 'Empaque', 0, 40, 1);
SELECT t93_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, referencia) VALUES ('Entrada', 'P93-EMPB', 5, 'ajuste_existencia/P93-EMPB')$q$, '093-101 Admin: kardex con referencia de ajuste reservada', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t93_err($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha) VALUES ('Reverso producción', 'Costo de Ventas', 'T93 falso', 1, CURRENT_DATE)$q$, '093-102 Admin: costo de reverso manual reservado', '42501');
COMMIT;
SELECT t93_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Entrada' AND cantidad = 40 AND referencia = 'existencia_inicial/P93-NUEVA' AND usuario = 'Admin 93') FROM inventario_mov WHERE producto = 'P93-NUEVA'), '093-103 alta con existencia inicial: un kardex de entrada con el actor');

BEGIN; SELECT t93_limpiar(); COMMIT;
\echo '── 093: TODAS LAS PRUEBAS OK'
