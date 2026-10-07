-- 115_preparacion_barra_test.sql — OP-01D: "Preparar desde barra".
-- Barra (HIB-50K) = 1 unidad física sin empaque; preparar N barras → 2N
-- bolsas de picada (HIP-25K) o triturada (HIT-25K) consumiendo 2N del empaque
-- configurado en la salida; vender después lo preparado no vuelve a consumir.
-- La carrera con dos conexiones (caso 11) corre en el runner local.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t115_ids;
CREATE TABLE t115_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t115_ids TO PUBLIC;
-- Los 3 SKUs del modelo pueden existir en la base local: se guardan y se restauran al final.
INSERT INTO t115_ids SELECT 'orig:' || sku, to_jsonb(p)::text FROM productos p WHERE sku IN ('HIB-50K', 'HIP-25K', 'HIT-25K');

CREATE OR REPLACE FUNCTION t115_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_historial WHERE referencia IN (SELECT 'PROD-' || id FROM produccion WHERE cuarto_id = 'CF-T115')
                                  OR referencia IN (SELECT 'PROD-' || id || '/reverso' FROM produccion WHERE cuarto_id = 'CF-T115');
  DELETE FROM costos_empaque_historial WHERE sku = 'T115-EMP';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '11500000-%';
  DELETE FROM produccion WHERE cuarto_id = 'CF-T115';
  DELETE FROM inventario_mov WHERE cuarto_id = 'CF-T115' OR producto = 'T115-EMP';
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11551 AND 11559;
  DELETE FROM pagos WHERE orden_id BETWEEN 11551 AND 11559;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11551 AND 11559;
  DELETE FROM ordenes WHERE id BETWEEN 11551 AND 11559;
  DELETE FROM auditoria WHERE detalle LIKE '%CF-T115%' OR usuario LIKE '%115%';
  DELETE FROM cuartos_frios WHERE id = 'CF-T115';
  DELETE FROM clientes WHERE id = 11551;
  DELETE FROM usuarios WHERE id BETWEEN 11551 AND 11559;
  DELETE FROM auth.users WHERE id::text LIKE '11550000-%';
  DELETE FROM productos WHERE sku IN ('T115-EMP', 'HPC-T115', 'HIB-50K', 'HIP-25K', 'HIT-25K');
END $$;

BEGIN; SELECT t115_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11550000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t115' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11551, 'Admin 115', 'u1@t115', 'Admin', 'Activo', '11550000-0000-0000-0000-000000000001'),
  (11552, 'Prod 115', 'u2@t115', 'Producción', 'Activo', '11550000-0000-0000-0000-000000000002'),
  (11553, 'Ventas 115', 'u3@t115', 'Ventas', 'Activo', '11550000-0000-0000-0000-000000000003');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (11551, 'Cliente 115', 'XAXX010101000', 0);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('T115-EMP', 'Bolsa 115', 'Empaque', 0, 20, 1.5, NULL),
  ('HPC-T115', 'Hielo cubos 115', 'Producto Terminado', 31, 0, 0, 'T115-EMP'),
  ('HIB-50K', 'Barra de hielo ~50 kg', 'Producto Terminado', 120, 0, 0, NULL),
  ('HIP-25K', 'Picada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T115-EMP'),
  ('HIT-25K', 'Triturada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T115-EMP');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-T115', 'Cuarto 115', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (11551, 'OV-11551', 11551, 'Cliente 115', 'x', 60, 'Creada', 'Efectivo', 'Contado', 11551, NULL),
  (11552, 'OV-11552', 11551, 'Cliente 115', 'x', 60, 'Creada', 'Efectivo', 'Contado', 11551, NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (11551, 'HIP-25K', 1, 60, 60), (11552, 'HIP-25K', 1, 60, 60);
COMMIT;

CREATE OR REPLACE FUNCTION t115_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t115_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t115_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11550000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
-- Estado: barras | picada | triturada | empaque (existencia) — en el cuarto de la suite.
CREATE OR REPLACE FUNCTION t115_e() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE((stock ->> 'HIB-50K')::int, 0) || '|' || COALESCE((stock ->> 'HIP-25K')::int, 0) || '|' || COALESCE((stock ->> 'HIT-25K')::int, 0)
      || '|' || (SELECT stock FROM productos WHERE sku = 'T115-EMP')
    FROM cuartos_frios WHERE id = 'CF-T115' $$;
CREATE OR REPLACE FUNCTION t115_op(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT ('11500000-0000-0000-0000-0000000000' || p_k)::uuid $$;
CREATE OR REPLACE FUNCTION t115_prep(p_k TEXT, p_salida TEXT, p_barras INTEGER) RETURNS TEXT LANGUAGE sql AS $$
  SELECT format('SELECT registrar_preparacion_barra(%L::uuid, %L, %L, %L, %s)', t115_op(p_k), 'HIB-50K', p_salida, 'CF-T115', p_barras) $$;
GRANT EXECUTE ON FUNCTION t115_assert(BOOLEAN, TEXT), t115_err(TEXT, TEXT, TEXT, TEXT), t115_auth(INTEGER), t115_e(), t115_op(TEXT), t115_prep(TEXT, TEXT, INTEGER) TO PUBLIC;

\echo '── 115: superficie'
SELECT t115_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                       AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                    FROM pg_proc p WHERE p.oid IN ('public.registrar_preparacion_barra(uuid,text,text,text,integer)'::regprocedure,
                                                   'public.revertir_preparacion_barra(uuid,bigint,text)'::regprocedure)),
  '115-00 contratos SECURITY DEFINER, search_path fijo, sin anon/PUBLIC');

\echo '── CASO 1: Máquina Barra produce 100 barras sin empaque'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_assert((registrar_produccion(t115_op('01'), 'Turno 1', 'Máquina Barra', 'HIB-50K', 100, 'CF-T115') ->> 'empaque_sku') IS NULL,
  'C1a producción de barra sin empaque configurado: aceptada por el servidor');
COMMIT;
SELECT t115_assert(t115_e() = '100|0|0|20', 'C1b barras +100 (1 barra física = 1 unidad); empaque sin cambio (20)');

\echo '── OP-01D.1: producción normal NO crea bolsas de barra (casos B, C y F)'
INSERT INTO t115_ids VALUES ('d1', t115_e() || '|' || (SELECT count(*) FROM produccion) || '|' || (SELECT count(*) FROM inventario_mov)
  || '|' || (SELECT count(*) FROM costos_historial) || '|' || (SELECT count(*) FROM stock_operaciones) || '|' || (SELECT count(*) FROM costos_empaque_historial));
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(format('SELECT registrar_produccion(%L::uuid, %L, %L, %L, 4, %L)', t115_op('30'), 'Turno 1', 'Máquina 30', 'HIP-25K', 'CF-T115'),
  'D1-B producción normal de HIP-25K (picada de barra): rechazada', '22023', '%HIP-25K solo se obtiene con Preparar desde barra%');
SELECT t115_err(format('SELECT registrar_produccion(%L::uuid, %L, %L, %L, 4, %L)', t115_op('31'), 'Turno 1', 'Máquina Barra', 'HIT-25K', 'CF-T115'),
  'D1-C producción normal de HIT-25K (triturada de barra): rechazada', '22023', '%HIT-25K solo se obtiene con Preparar desde barra%');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT t115_err(format('SELECT registrar_produccion(%L::uuid, %L, %L, %L, 4, %L)', t115_op('32'), 'Turno 1', 'Máquina 30', 'HIP-25K', 'CF-T115'),
  'D1-B2 tampoco Admin puede producirla por máquina', '22023', '%Preparar desde barra%');
COMMIT;
SELECT t115_assert((SELECT v FROM t115_ids WHERE k = 'd1') = t115_e() || '|' || (SELECT count(*) FROM produccion) || '|' || (SELECT count(*) FROM inventario_mov)
  || '|' || (SELECT count(*) FROM costos_historial) || '|' || (SELECT count(*) FROM stock_operaciones) || '|' || (SELECT count(*) FROM costos_empaque_historial)
  AND NOT EXISTS (SELECT 1 FROM produccion WHERE operacion_id IN (t115_op('30'), t115_op('31'), t115_op('32'))),
  'D1-F sin residuo: preparado, barras y empaque iguales; ninguna fila nueva en produccion, kardex, costos ni stock_operaciones');
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_assert((registrar_produccion(t115_op('33'), 'Turno 1', 'Máquina 30', 'HPC-T115', 1, 'CF-T115') ->> 'replay') = 'false',
  'D1-A2 otros productos con empaque siguen produciéndose normal (HPC-T115)');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica;
DELETE FROM costos_historial WHERE referencia = 'PROD-' || (SELECT id FROM produccion WHERE operacion_id = t115_op('33'));
DELETE FROM inventario_mov WHERE referencia LIKE 'produccion/' || (SELECT folio FROM produccion WHERE operacion_id = t115_op('33')) || '%' OR origen = 'Producción ' || (SELECT folio FROM produccion WHERE operacion_id = t115_op('33'));
DELETE FROM produccion WHERE operacion_id = t115_op('33');
UPDATE cuartos_frios SET stock = stock - 'HPC-T115' WHERE id = 'CF-T115'; UPDATE productos SET stock = 20 WHERE sku = 'T115-EMP';
COMMIT;
SELECT t115_assert(t115_e() = '100|0|0|20', 'D1 estado restaurado para los casos siguientes');

\echo '── CASO 2: preparar 1 barra como picada'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
INSERT INTO t115_ids SELECT 'p2', registrar_preparacion_barra(t115_op('02'), 'HIB-50K', 'HIP-25K', 'CF-T115', 1)::text;
COMMIT;
SELECT t115_assert(t115_e() = '99|2|0|18' AND ((SELECT v FROM t115_ids WHERE k = 'p2')::jsonb ->> 'folio') LIKE 'PB-%',
  'C2/D1-D 1 barra → picada: barras −1, picada +2, empaque configurado −2 (folio PB-)');
SELECT t115_assert((SELECT tipo = 'Preparacion' AND input_sku = 'HIB-50K' AND input_kg = 1 AND cantidad = 2 AND empaque_sku = 'T115-EMP'
                       AND empaque_cantidad = 2 AND costo_total = 3.00 FROM produccion WHERE operacion_id = t115_op('02'))
  AND (SELECT monto = 3.00 FROM costos_historial WHERE tipo = 'Producción' AND referencia = 'PROD-' || ((SELECT v FROM t115_ids WHERE k = 'p2')::jsonb ->> 'id')),
  'C2b evento durable tipo Preparacion; costo del empaque 2 × 1.50 = 3.00 en costos_historial (Producción)');

\echo '── CASO 3: preparar 3 barras como picada (por adelantado)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT registrar_preparacion_barra(t115_op('03'), 'HIB-50K', 'HIP-25K', 'CF-T115', 3);
COMMIT;
SELECT t115_assert(t115_e() = '96|8|0|12', 'C3 3 barras → picada: barras −3, picada +6, empaque −6');

\echo '── CASO 4: preparar 1 barra como triturada'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
INSERT INTO t115_ids SELECT 'p4', registrar_preparacion_barra(t115_op('04'), 'HIB-50K', 'HIT-25K', 'CF-T115', 1)::text;
COMMIT;
SELECT t115_assert(t115_e() = '95|8|2|10', 'C4/D1-E 1 barra → triturada: barras −1, triturada +2, empaque −2 (Admin también puede)');

\echo '── CASOS 5 y 6: vender picada ya preparada (venta directa real)'
INSERT INTO t115_ids VALUES ('e5', t115_e());
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT completar_venta_directa('11500000-0000-0000-0000-0000000000a5'::uuid, 11551, 'contado', 'Efectivo', '[{"sku":"HIP-25K","cuarto_id":"CF-T115","cantidad":1}]'::jsonb);
COMMIT;
SELECT t115_assert(t115_e() = '95|7|2|10', 'C5 vender 1 bolsa preparada: picada −1; barras y empaque SIN cambio (no hay doble consumo)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT completar_venta_directa('11500000-0000-0000-0000-0000000000a6'::uuid, 11552, 'contado', 'Efectivo', '[{"sku":"HIP-25K","cuarto_id":"CF-T115","cantidad":1}]'::jsonb);
COMMIT;
SELECT t115_assert(t115_e() = '95|6|2|10', 'C6 vender la segunda bolsa: picada −1; barras y empaque sin cambio');

\echo '── CASOS 7, 8 y 9: rechazos sin efectos parciales'
INSERT INTO t115_ids VALUES ('e7', t115_e());
-- C7 con empaque de sobra (aislar la falta de barras), luego se devuelve a 10.
BEGIN; SET LOCAL session_replication_role = replica; UPDATE productos SET stock = 1000 WHERE sku = 'T115-EMP'; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(t115_prep('07', 'HIP-25K', 96), 'C7 más barras de las que hay (96 > 95): falla todo', 'P0001', '%Stock insuficiente%HIB-50K%');
COMMIT;
SELECT t115_assert(t115_e() = '95|6|2|1000', 'C7b sin mutación parcial: el empaque NO se consumió aunque había (1000)');
BEGIN; SET LOCAL session_replication_role = replica; UPDATE productos SET stock = 10 WHERE sku = 'T115-EMP'; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(t115_prep('08', 'HIP-25K', 6), 'C8 empaque insuficiente (12 > 10): falla todo', 'P0001', '%Stock insuficiente%T115-EMP%');
COMMIT;
SELECT t115_assert(t115_e() = (SELECT v FROM t115_ids WHERE k = 'e7')
  AND NOT EXISTS (SELECT 1 FROM produccion WHERE operacion_id IN (t115_op('07'), t115_op('08'))),
  'C8b sin mutación parcial: barras, preparado, empaque y produccion intactos');
BEGIN; SET LOCAL session_replication_role = replica; UPDATE productos SET empaque_sku = NULL WHERE sku = 'HIT-25K'; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(t115_prep('09', 'HIT-25K', 1), 'C9 salida sin empaque configurado: bloqueada', '22023', '%no tiene empaque configurado%');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE productos SET empaque_sku = 'T115-EMP' WHERE sku = 'HIT-25K'; COMMIT;
SELECT t115_assert(t115_e() = (SELECT v FROM t115_ids WHERE k = 'e7'), 'C9b sin efectos');

\echo '── Validaciones del contrato'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(format('SELECT registrar_preparacion_barra(%L::uuid, %L, %L, %L, 1)', t115_op('10'), 'HPC-5K', 'HIP-25K', 'CF-T115'), '115-v1 la fuente solo puede ser la barra', '22023', '%no es la barra%');
SELECT t115_err(format('SELECT registrar_preparacion_barra(%L::uuid, %L, %L, %L, 1)', t115_op('10'), 'HIB-50K', 'HPC-5K', 'CF-T115'), '115-v2 la salida solo puede ser picada o triturada de barra', '22023', '%no es una preparación de barra permitida%');
SELECT t115_err(t115_prep('10', 'HIP-25K', 0), '115-v3 cero barras: rechazado (se prepara por barras enteras)', '22023');
SELECT t115_err(format('SELECT registrar_preparacion_barra(NULL, %L, %L, %L, 1)', 'HIB-50K', 'HIP-25K', 'CF-T115'), '115-v4 sin operacion_id: rechazado', '22023');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(3);
SELECT t115_err(t115_prep('10', 'HIP-25K', 1), '115-v5 Ventas no prepara', '42501');
COMMIT;

\echo '── CASO 10: misma llave de idempotencia'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_assert((registrar_preparacion_barra(t115_op('02'), 'HIB-50K', 'HIP-25K', 'CF-T115', 1) ->> 'replay')::boolean,
  'C10a misma operación y mismos datos: replay');
SELECT t115_err(t115_prep('02', 'HIP-25K', 2), 'C10b misma operación con otros datos: 23505', '23505');
SELECT t115_err(format('SELECT registrar_preparacion_barra(%L::uuid, %L, %L, %L, 1)', t115_op('01'), 'HIB-50K', 'HIP-25K', 'CF-T115'),
  'C10c la llave de una producción no sirve para preparar', '23505');
COMMIT;
SELECT t115_assert(t115_e() = (SELECT v FROM t115_ids WHERE k = 'e7') AND (SELECT count(*) = 1 FROM produccion WHERE operacion_id = t115_op('02')),
  'C10d sin doble preparación (estado igual, una sola fila)');

\echo '── CASOS 12 y 13: reverso'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(2);
SELECT t115_err(format('SELECT revertir_preparacion_barra(%L::uuid, %s, %L)', t115_op('20'), (SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id', 'error'),
  '115-r1 Producción no revierte (solo Admin)', '42501');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT t115_err(format('SELECT revertir_produccion(%L::uuid, %s, %L)', t115_op('21'), (SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id', 'error'),
  '115-r2 una preparación NO se revierte con revertir_produccion (107)', '22023');
SELECT revertir_preparacion_barra(t115_op('22'), ((SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id')::bigint, 'Se tomó la barra equivocada');
COMMIT;
SELECT t115_assert(t115_e() = '96|6|0|12', 'C12 reverso válido de 1 barra → 2 triturada: triturada −2, barras +1, empaque +2');
SELECT t115_assert((SELECT estatus = 'Revertida' AND reverso_operacion_id = t115_op('22') FROM produccion WHERE id = ((SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id')::bigint)
  AND (SELECT count(*) = 1 FROM costos_historial WHERE tipo = 'Reverso producción' AND referencia = 'PROD-' || ((SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id') || '/reverso')
  AND (SELECT count(*) = 1 FROM costos_empaque_historial WHERE sku = 'T115-EMP' AND evento = 'Reverso producción' AND costo_unitario_reingreso = 1.5),
  'C12b preparación marcada Revertida; costo compensado una vez; empaque reingresa al costo histórico (1.50)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT t115_assert((revertir_preparacion_barra(t115_op('22'), ((SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id')::bigint, 'Se tomó la barra equivocada') ->> 'replay')::boolean,
  'C13a mismo reverso repetido: replay');
SELECT t115_err(format('SELECT revertir_preparacion_barra(%L::uuid, %s, %L)', t115_op('23'), (SELECT v FROM t115_ids WHERE k = 'p4')::jsonb ->> 'id', 'otra vez'),
  'C13b otro reverso de la misma preparación: rechazado', '22023', '%ya fue revertida%');
COMMIT;
SELECT t115_assert(t115_e() = '96|6|0|12', 'C13c sin doble restauración');
-- Reverso imposible: la picada de PB (3 barras → 6) ya no está completa en el cuarto (se vendieron 2 de las 8).
BEGIN; SET LOCAL session_replication_role = replica;
UPDATE cuartos_frios SET stock = jsonb_set(stock, '{HIP-25K}', '5') WHERE id = 'CF-T115'; COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT t115_err(format('SELECT revertir_preparacion_barra(%L::uuid, %s, %L)', t115_op('24'), (SELECT id FROM produccion WHERE operacion_id = t115_op('03')), 'error'),
  '115-r3 reverso con salida insuficiente (5 < 6): falla todo, sin crear inventario', 'P0001', '%Stock insuficiente%HIP-25K%');
COMMIT;
SELECT t115_assert(t115_e() = '96|5|0|12' AND (SELECT estatus = 'Confirmada' FROM produccion WHERE operacion_id = t115_op('03')),
  '115-r3b sin efectos: barras, preparado, empaque y la preparación intactos');

\echo '── Conciliación de empaque'
BEGIN; SET LOCAL ROLE authenticated; SELECT t115_auth(1);
SELECT t115_assert((SELECT (e ->> 'consumido_produccion')::int = 8 AND (e ->> 'producciones')::int = 2
                    FROM jsonb_array_elements(conciliacion_empaque()) e WHERE e ->> 'sku' = 'T115-EMP'),
  '115-c1 conciliacion_empaque cuenta el empaque de las preparaciones vigentes (2 + 6; la revertida no)');
COMMIT;

BEGIN; SELECT t115_limpiar(); COMMIT;
-- Restaurar los SKUs del modelo que ya existían en la base local.
BEGIN; SET LOCAL session_replication_role = replica;
INSERT INTO productos SELECT (jsonb_populate_record(NULL::productos, v::jsonb)).* FROM t115_ids WHERE k LIKE 'orig:%';
COMMIT;
DROP TABLE IF EXISTS t115_ids;
\echo '── 115: TODAS LAS PRUEBAS OK'
