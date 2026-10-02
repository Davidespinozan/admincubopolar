-- 104_devoluciones_test.sql — devolución de cliente por contrato: una por
-- orden, partidas validadas y precio de la orden, disposición (reintegrar al
-- cuarto elegido o merma sin tocar cuartos), tope de reembolso por lo cobrado,
-- CxC y saldo del cliente coherentes, nota de crédito solo en crédito,
-- reposición bloqueada, nota fiscal pendiente en facturadas, idempotencia y
-- (con 105) inmutabilidad. La fase se detecta por el INSERT de devoluciones.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t104_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM devoluciones WHERE orden_id BETWEEN 10401 AND 10419;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 10401 AND 10419 OR concepto LIKE 'T104%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P104-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '10400000-%' OR orden_id BETWEEN 10401 AND 10419;
  DELETE FROM pagos WHERE orden_id BETWEEN 10401 AND 10419;
  DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 10401 AND 10419;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 10401 AND 10419;
  DELETE FROM ordenes WHERE id BETWEEN 10401 AND 10419;
  DELETE FROM rutas WHERE id = 10401;
  DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P104-%');
  DELETE FROM mermas WHERE sku LIKE 'P104-%';
  DELETE FROM auditoria WHERE usuario = 'Admin 104' OR detalle LIKE 'OV-104%';
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-104%';
  DELETE FROM productos WHERE sku LIKE 'P104-%';
  DELETE FROM clientes WHERE id BETWEEN 10401 AND 10409;
  DELETE FROM usuarios WHERE id BETWEEN 10401 AND 10409;
  DELETE FROM auth.users WHERE id::text LIKE '10400000-%';
END $$;

BEGIN; SELECT t104_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('10400000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t104' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10401, 'Admin 104',  'u1@t104', 'Admin',  'Activo', '10400000-0000-0000-0000-000000000001'),
  (10402, 'Ventas 104', 'u2@t104', 'Ventas', 'Activo', '10400000-0000-0000-0000-000000000002'),
  (10403, 'Chofer 104', 'u3@t104', 'Chofer', 'Activo', '10400000-0000-0000-0000-000000000003');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (10401, 'Cliente 104 contado', 'XAXX010101000', 0), (10402, 'Cliente 104 crédito', 'XAXX010101000', 140);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P104-A', 'Hielo A 104', 'Producto Terminado', 99, 0, 0), ('P104-B', 'Hielo B 104', 'Producto Terminado', 99, 0, 0),
  ('P104-C', 'Hielo C 104', 'Producto Terminado', 99, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-104A', 'Cuarto 104A', '{"P104-A": 50, "P104-B": 50}'), ('CF-104B', 'Cuarto 104B', '{"P104-A": 50}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES
  (10401, 'OV-10401', 10401, 'Cliente 104 contado', 'x', 350, 'Entregada',  'Efectivo',          'Contado'),
  (10402, 'OV-10402', 10401, 'Cliente 104 contado', 'x', 300, 'Entregada',  'Efectivo',          'Contado'),
  (10403, 'OV-10403', 10402, 'Cliente 104 crédito', 'x', 300, 'Entregada',  'Crédito',           'Credito'),
  (10404, 'OV-10404', 10402, 'Cliente 104 crédito', 'x', 100, 'Facturada',  'Crédito',           'Credito'),
  (10405, 'OV-10405', 10401, 'Cliente 104 contado', 'x', 100, 'Entregada',  'Efectivo',          'Contado'),
  (10406, 'OV-10406', 10401, 'Cliente 104 contado', 'x', 100, 'Creada',     'Efectivo',          'Contado'),
  (10407, 'OV-10407', 10401, 'Cliente 104 contado', 'x', 100, 'Cancelada',  'Efectivo',          'Contado'),
  (10408, 'OV-10408', 10401, 'Cliente 104 contado', 'x', 100, 'Entregada',  'QR / Link de pago', 'Contado'),
  (10409, 'OV-10409', 10401, 'Cliente 104 contado', 'x', 100, 'Facturada',  'Efectivo',          'Contado');
INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES (10401, 'R-10401', 'T104 ruta', 'Cerrada', 10403, '{}', '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
  (10410, 'OV-10410', 10401, 'Cliente 104 contado', 'x', 100, 'Entregada', 'Efectivo', 'Contado', 10401);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (10401, 'P104-A', 10, 20, 200), (10401, 'P104-B', 5, 30, 150),
  (10402, 'P104-A', 15, 20, 300),
  (10403, 'P104-A', 15, 20, 300),
  (10404, 'P104-B', 5, 20, 100),
  (10405, 'P104-A', 5, 20, 100), (10406, 'P104-A', 5, 20, 100), (10407, 'P104-A', 5, 20, 100),
  (10408, 'P104-A', 5, 20, 100), (10409, 'P104-A', 5, 20, 100);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES
  (10401, 10401, 350, 'Efectivo', fin_hoy(), 'T104-1', 0, 0),
  (10401, 10402, 200, 'Efectivo', fin_hoy(), 'T104-2', 0, 0),
  (10402, 10403, 200, 'Efectivo', fin_hoy(), 'T104-3', 300, 100),
  (10401, 10405, 100, 'Efectivo', fin_hoy(), 'T104-5', 0, 0),
  (10401, 10408, 100, 'QR / Link de pago', fin_hoy(), 'T104-8', 0, 0),
  (10401, 10409, 100, 'Efectivo', fin_hoy(), 'T104-9', 0, 0);
INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, fecha_venta, monto_original, monto_pagado, saldo_pendiente, estatus) VALUES
  (10402, 10403, fin_hoy(), 300, 200, 100, 'Parcial'),
  (10402, 10404, fin_hoy(), 100, 60, 40, 'Parcial');
COMMIT;

CREATE OR REPLACE FUNCTION t104_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10400000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t104_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t104_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t104_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t104_contenido() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$ SELECT NOT has_table_privilege('authenticated', 'public.devoluciones', 'INSERT') $$;
GRANT EXECUTE ON FUNCTION t104_actor(INTEGER), t104_assert(BOOLEAN, TEXT), t104_err(TEXT, TEXT, TEXT, TEXT), t104_cf(TEXT, TEXT), t104_contenido() TO PUBLIC;
DROP TABLE IF EXISTS t104_ids;
CREATE TEMP TABLE t104_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t104_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t104_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t104_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t104_j(TEXT) TO PUBLIC;

\echo '── 104: contrato y autorización'
SELECT t104_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                    FROM pg_proc WHERE oid = 'public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)'::regprocedure)
  AND (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'devoluciones_orden_key'),
  '104-01 contrato SECURITY DEFINER sin anon; UNIQUE(orden_id): una devolución por orden');
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(2);
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d0f0', 10401, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-02 Ventas: denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(3);
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d0f0', 10401, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-03 Chofer: denegado', '42501');
ROLLBACK;

\echo '── 104: validación de partidas, estatus y tipos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(1);
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10401, '[{"sku":"P104-A","cantidad":11}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-10 A 11 > 10 entregadas: rechazado', '22023', '%máximo 10%');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10401, '[{"sku":"P104-C","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-11 SKU que no estaba en la orden: rechazado', '22023', '%no estaba en la orden%');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10401, '[{"sku":"P104-A","cantidad":1.5}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-12 cantidad no entera: rechazada', '22023');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10401, '[{"sku":"P104-A","cantidad":1},{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-13 SKU repetido: rechazado', '22023');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10406, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-14 orden Creada: rechazada', '22023', '%Entregadas o Facturadas%');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10407, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-15 orden Cancelada: rechazada', '22023');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10405, '[{"sku":"P104-A","cantidad":1}]', 'Reposicion', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-16 reposición: bloqueada', '22023', '%reposición está bloqueada%');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10405, '[{"sku":"P104-A","cantidad":1}]', 'Nota credito', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-17 nota de crédito en venta de contado: negada (sin saldo a favor)', '22023', '%contado%');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10405, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', NULL, 'producto mal')$q$, '104-18 reintegrar sin cuarto: rechazado', '22023');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10405, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-NOPE', 'producto mal')$q$, '104-19 cuarto inexistente: rechazado', '22023');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d001', 10404, '[{"sku":"P104-B","cantidad":5}]', 'Nota credito', 'Reintegrar', 'CF-104A', 'producto mal')$q$, '104-20 nota de crédito mayor que lo pendiente (100 > 40): rechazada', '22023', '%excede lo pendiente%');
ROLLBACK;

\echo '── 104: devolución parcial de contado, reintegrar al cuarto'
INSERT INTO t104_ids VALUES ('rep0', reporte_financiero(fin_hoy(), fin_hoy())::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(1);
-- El cliente intenta mandar precio y total: se ignoran (solo SKU y cantidad).
INSERT INTO t104_ids VALUES ('d1', registrar_devolucion('10400000-0000-0000-0000-00000000d011', 10401,
  '[{"sku":"P104-A","cantidad":3,"precio_unitario":999,"subtotal":5000},{"sku":"P104-B","cantidad":1,"total":500}]', 'Efectivo', 'Reintegrar', 'CF-104B', 'producto con mal sabor')::text);
INSERT INTO t104_ids VALUES ('d1r', registrar_devolucion('10400000-0000-0000-0000-00000000d011', 10401,
  '[{"sku":"P104-A","cantidad":3},{"sku":"P104-B","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104B', 'producto con mal sabor')::text);
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d011', 10401, '[{"sku":"P104-A","cantidad":2}]', 'Efectivo', 'Reintegrar', 'CF-104B', 'producto con mal sabor')$q$, '104-30 misma operación con otro contenido: rechazada', '23505');
SELECT t104_err($q$SELECT registrar_devolucion('10400000-0000-0000-0000-00000000d012', 10401, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104B', 'otra vez')$q$, '104-31 otra operación sobre la misma orden: rechazada (una por orden)', '23505', '%ya tiene una devolución%');
COMMIT;
INSERT INTO t104_ids VALUES ('rep1', reporte_financiero(fin_hoy(), fin_hoy())::text);
SELECT t104_assert((t104_j('d1') ->> 'total')::numeric = 90 AND (t104_j('d1') ->> 'reembolso')::numeric = 90 AND (t104_j('d1') ->> 'cxc_reducido')::numeric = 0
  AND (t104_j('d1r') ->> 'replay') = 'true' AND (t104_j('d1r') ->> 'devolucion_id') = (t104_j('d1') ->> 'devolucion_id'),
  '104-32 total del servidor 3×20 + 1×30 = 90 (precio y total del cliente ignorados); reembolso 90; reintento = replay');
SELECT t104_assert(t104_cf('CF-104B', 'P104-A') = 53 AND t104_cf('CF-104B', 'P104-B') = 1 AND t104_cf('CF-104A', 'P104-A') = 50 AND t104_cf('CF-104A', 'P104-B') = 50
  AND (SELECT count(*) = 1 FROM devoluciones WHERE orden_id = 10401) AND (SELECT tiene_devolucion FROM ordenes WHERE id = 10401),
  '104-33 entra SOLO al cuarto elegido (CF-104B +3 A, +1 B); una devolución; orden marcada');
SELECT t104_assert((SELECT count(*) = 2 AND bool_and(m.tipo = 'Devolución cliente' AND m.cuarto_id = 'CF-104B' AND m.operacion_id = '10400000-0000-0000-0000-00000000d011'
                     AND m.referencia = 'devolucion/' || (t104_j('d1') ->> 'devolucion_id') AND m.origen = 'Devolución OV-10401' AND m.usuario = 'Admin 104')
                    FROM inventario_mov m WHERE m.producto LIKE 'P104-%'),
  '104-34 kardex del servidor: cuarto, operación, referencia a la devolución, orden y actor canónico');
SELECT t104_assert((SELECT count(*) = 1 AND bool_and(monto = 90 AND categoria = 'Devoluciones' AND referencia = 'DEVOL-' || (t104_j('d1') ->> 'devolucion_id') AND fecha = fin_hoy())
                    FROM movimientos_contables WHERE orden_id = 10401)
  AND ((t104_j('rep1') -> 'resultados' ->> 'devoluciones')::numeric - (t104_j('rep0') -> 'resultados' ->> 'devoluciones')::numeric) = 90
  AND ((t104_j('rep1') -> 'flujo' ->> 'salidas_reembolsos')::numeric - (t104_j('rep0') -> 'flujo' ->> 'salidas_reembolsos')::numeric) = 90
  AND (t104_j('rep1') -> 'resultados' ->> 'otros_gastos') = (t104_j('rep0') -> 'resultados' ->> 'otros_gastos'),
  '104-35 un egreso de reembolso (DEVOL-, fin_hoy()); reporte 093: −90 ingreso y −90 caja, una vez; no es gasto operativo');

\echo '── 104: merma (dañado) y tope por lo cobrado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(1);
INSERT INTO t104_ids VALUES ('d2', registrar_devolucion('10400000-0000-0000-0000-00000000d021', 10402, '[{"sku":"P104-A","cantidad":15}]', 'Efectivo', 'Merma', 'CF-104A', 'hielo derretido')::text);
COMMIT;
SELECT t104_assert((t104_j('d2') ->> 'total')::numeric = 300 AND (t104_j('d2') ->> 'cobrado')::numeric = 200 AND (t104_j('d2') ->> 'reembolso')::numeric = 200
  AND (SELECT disposicion = 'Merma' AND cuarto_destino IS NULL FROM devoluciones WHERE orden_id = 10402)
  AND t104_cf('CF-104A', 'P104-A') = 50 AND t104_cf('CF-104B', 'P104-A') = 53
  AND (SELECT count(*) FROM inventario_mov WHERE producto LIKE 'P104-%') = 2 AND NOT EXISTS (SELECT 1 FROM mermas WHERE sku LIKE 'P104-%'),
  '104-40 merma: valor 300, cobrado 200 → reembolso 200 (nunca 300); ningún cuarto cambia, sin kardex ni +/− artificial');

\echo '── 104: crédito (CxC primero, saldo del cliente exacto)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(1);
INSERT INTO t104_ids VALUES ('d3', registrar_devolucion('10400000-0000-0000-0000-00000000d031', 10403, '[{"sku":"P104-A","cantidad":15}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'cliente no lo quiso')::text);
INSERT INTO t104_ids VALUES ('d4', registrar_devolucion('10400000-0000-0000-0000-00000000d041', 10404, '[{"sku":"P104-B","cantidad":2}]', 'Nota credito', 'Reintegrar', 'CF-104A', 'bolsas rotas')::text);
COMMIT;
SELECT t104_assert((t104_j('d3') ->> 'cxc_reducido')::numeric = 100 AND (t104_j('d3') ->> 'saldo_cliente_reducido')::numeric = 100 AND (t104_j('d3') ->> 'reembolso')::numeric = 200
  AND (SELECT saldo_pendiente = 0 AND monto_original = 0 AND monto_pagado = 0 AND estatus = 'Pagada' FROM cuentas_por_cobrar WHERE orden_id = 10403),
  '104-50 valor 300 con 100 pendiente y 200 cobrados: CxC −100 (a 0), saldo del cliente −100, reembolso 200; CxC coherente');
SELECT t104_assert((t104_j('d4') ->> 'total')::numeric = 40 AND (t104_j('d4') ->> 'cxc_reducido')::numeric = 40 AND (t104_j('d4') ->> 'reembolso')::numeric = 0
  AND (t104_j('d4') ->> 'requiere_nota_credito') = 'true' AND (t104_j('d4') ->> 'egreso_id') IS NULL
  AND (SELECT saldo_pendiente = 0 AND monto_original = 60 AND monto_pagado = 60 FROM cuentas_por_cobrar WHERE orden_id = 10404)
  AND (SELECT requiere_nota_credito AND cfdi_nota_credito_uuid IS NULL FROM devoluciones WHERE orden_id = 10404)
  AND (SELECT saldo = 0 FROM clientes WHERE id = 10402) AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE orden_id = 10404),
  '104-51 nota de crédito en crédito facturado: CxC −40, sin salida de dinero, nota fiscal pendiente (sin UUID ficticio); saldo del cliente 140 → 0, nunca negativo');

\echo '── 104: cobro electrónico y facturada de contado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t104_actor(1);
INSERT INTO t104_ids VALUES ('d8', registrar_devolucion('10400000-0000-0000-0000-00000000d081', 10408, '[{"sku":"P104-A","cantidad":1}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'error de pedido')::text);
INSERT INTO t104_ids VALUES ('d9', registrar_devolucion('10400000-0000-0000-0000-00000000d091', 10409, '[{"sku":"P104-A","cantidad":2}]', 'Efectivo', 'Reintegrar', 'CF-104A', 'error de pedido')::text);
COMMIT;
SELECT t104_assert((t104_j('d8') ->> 'reembolso_manual') = 'true'
  AND (SELECT concepto LIKE '%registrado manualmente (cobro original: QR / Link de pago; sin reembolso en el procesador)%' FROM movimientos_contables WHERE orden_id = 10408),
  '104-60 cobro por link de pago: el reembolso se etiqueta como registrado manualmente (sin afirmar reembolso del procesador)');
SELECT t104_assert((t104_j('d9') ->> 'requiere_nota_credito') = 'true' AND (t104_j('d9') ->> 'reembolso')::numeric = 40,
  '104-61 orden facturada de contado: se registra, reembolso 40 y nota fiscal pendiente');

\echo '── 104: contención (105)'
DO $do$
BEGIN
  PERFORM t104_actor(1); SET LOCAL ROLE authenticated;
  IF t104_contenido() THEN
    PERFORM t104_err($q$INSERT INTO devoluciones (orden_id, motivo, tipo_reembolso, total, items, usuario) VALUES (10405, 'x', 'Efectivo', 1, '[]', 'x')$q$, '104-70 INSERT directo de devolución: negado', '42501');
    PERFORM t104_err($q$DELETE FROM devoluciones WHERE orden_id = 10401$q$, '104-71 DELETE de devolución: negado', '42501');
    PERFORM t104_err($q$UPDATE ordenes SET tiene_devolucion = false WHERE id = 10401$q$, '104-72 Admin: limpiar tiene_devolucion por REST, negado', '42501');
    PERFORM t104_err($q$UPDATE ordenes SET tiene_devolucion = true WHERE id = 10405$q$, '104-73 Admin: marcar tiene_devolucion por REST, negado', '42501');
    PERFORM t104_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-104A","sku":"P104-A","delta":1}]')$q$, '104-74 update_stocks_atomic sin EXECUTE de la API', '42501');
    PERFORM t104_err($q$SELECT ajustar_cxc_devolucion(10404, 1)$q$, '104-75 ajustar_cxc_devolucion sin EXECUTE de la API', '42501');
    PERFORM t104_err($q$INSERT INTO movimientos_contables (tipo, categoria, concepto, monto, orden_id) VALUES ('Egreso', 'Devoluciones', 'T104 falso', 5, 10405)$q$, '104-76 egreso de reembolso forjado: negado', '42501');
    PERFORM t104_err(format('UPDATE movimientos_contables SET monto = 1 WHERE id = %s', t104_j('d1') ->> 'egreso_id'), '104-77 editar el egreso del contrato: negado', '42501');
    PERFORM t104_err(format('DELETE FROM movimientos_contables WHERE id = %s', t104_j('d1') ->> 'egreso_id'), '104-78 borrar el egreso del contrato: negado', '42501');
    INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Egreso', 'Devoluciones', 'T104 manual sin orden', 5);
    RAISE NOTICE 'OK: 104-79 asiento manual de Devoluciones sin orden: permitido';
  ELSE
    RAISE NOTICE 'OK: 104-70 antes de 105: la escritura directa aún no se niega (frontend anterior)';
  END IF;
  RESET ROLE;
END $do$;
DO $do$
BEGIN
  PERFORM t104_actor(3); SET LOCAL ROLE authenticated;
  IF t104_contenido() THEN
    PERFORM t104_err($q$UPDATE ordenes SET tiene_devolucion = true WHERE id = 10410$q$, '104-80 Chofer: cambiar tiene_devolucion en orden de su ruta, negado', '42501');
  END IF;
  RESET ROLE;
END $do$;
SELECT t104_assert((SELECT count(*) = 1 FROM devoluciones WHERE orden_id = 10401) AND (SELECT tiene_devolucion FROM ordenes WHERE id = 10401)
  AND (SELECT count(*) = 1 AND bool_and(monto = 90) FROM movimientos_contables WHERE orden_id = 10401), '104-81 tras los intentos: devolución, marca y egreso intactos');

BEGIN; SELECT t104_limpiar(); COMMIT;
\echo '── 104: TODAS LAS PRUEBAS OK'
