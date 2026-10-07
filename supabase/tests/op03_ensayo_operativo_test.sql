-- op03_ensayo_operativo_test.sql — OP-03: ensayo operativo de punta a punta
-- (local, nunca en producción) con la configuración de catálogo del Día 0:
-- producción embolsada y de barra, preparar desde barra, venta de mostrador
-- (precio público y especial por cliente), ruta completa (carga firmada,
-- cierre financiero, merma de ruta, conteo final), merma de cuarto y reverso
-- de preparación. Cada paso se ejecuta con el ROL que lo hace en la planta y
-- por los mismos contratos que usa la aplicación.
--
-- Arranque: cuarto vacío; bolsa de 5 kg (OP3-E5) 100 y de 25 kg (OP3-E25) 50.
-- Los SKUs de la línea de barra son los reales (el contrato los fija):
-- HIB-50K $120 sin empaque, HIP-25K / HIT-25K $60 con OP3-E25. El hielo
-- embolsado usa un SKU de prueba (OP3-HPC5, $31, bolsa OP3-E5).

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS op3_ids;
CREATE TABLE op3_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON op3_ids TO PUBLIC;
INSERT INTO op3_ids SELECT 'orig:' || sku, to_jsonb(p)::text FROM productos p WHERE sku IN ('HIB-50K', 'HIP-25K', 'HIT-25K');

CREATE OR REPLACE FUNCTION op3_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_historial WHERE referencia IN (SELECT 'PROD-' || id FROM produccion WHERE cuarto_id = 'CF-OP3')
                                  OR referencia IN (SELECT 'PROD-' || id || '/reverso' FROM produccion WHERE cuarto_id = 'CF-OP3');
  DELETE FROM costos_empaque_historial WHERE sku LIKE 'OP3-%';
  DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku IN ('OP3-HPC5', 'HIB-50K', 'HIP-25K', 'HIT-25K') AND (ruta_id = 11661 OR to_jsonb(mermas) ->> 'cuarto_id' = 'CF-OP3'));
  DELETE FROM mermas WHERE sku IN ('OP3-HPC5', 'HIB-50K', 'HIP-25K', 'HIT-25K') AND (ruta_id = 11661 OR to_jsonb(mermas) ->> 'cuarto_id' = 'CF-OP3');
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '11660000-%' OR ruta_id = 11661;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id = 11661;
  DELETE FROM produccion WHERE cuarto_id = 'CF-OP3';
  DELETE FROM inventario_mov WHERE cuarto_id = 'CF-OP3' OR producto LIKE 'OP3-%' OR ruta_id = 11661;
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id IN (11661, 11662));
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id IN (11661, 11662));
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id IN (11661, 11662));
  DELETE FROM ordenes WHERE cliente_id IN (11661, 11662);
  DELETE FROM rutas WHERE id = 11661;
  DELETE FROM camiones WHERE id = 11661;
  DELETE FROM precios_esp WHERE cliente_id IN (11661, 11662);
  DELETE FROM clientes WHERE id IN (11661, 11662);
  DELETE FROM auditoria WHERE usuario LIKE '% OP3';
  DELETE FROM cuartos_frios WHERE id = 'CF-OP3';
  DELETE FROM usuarios WHERE id BETWEEN 11661 AND 11669;
  DELETE FROM auth.users WHERE id::text LIKE '11660000-%';
  DELETE FROM productos WHERE sku IN ('OP3-HPC5', 'OP3-E5', 'OP3-E25', 'HIB-50K', 'HIP-25K', 'HIT-25K');
END $$;

BEGIN; SELECT op3_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11660000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@op3' FROM generate_series(1, 4) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11661, 'Admin OP3',  'u1@op3', 'Admin',      'Activo', '11660000-0000-0000-0000-000000000001'),
  (11662, 'Prod OP3',   'u2@op3', 'Producción', 'Activo', '11660000-0000-0000-0000-000000000002'),
  (11663, 'Ventas OP3', 'u3@op3', 'Ventas',     'Activo', '11660000-0000-0000-0000-000000000003'),
  (11664, 'Chofer OP3', 'u4@op3', 'Chofer',     'Activo', '11660000-0000-0000-0000-000000000004');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('OP3-E5', 'Bolsa 5 kg OP3', 'Empaque', 0, 100, 1, NULL),
  ('OP3-E25', 'Bolsa 25 kg OP3', 'Empaque', 0, 50, 2, NULL),
  ('OP3-HPC5', 'Hielo Purificado en Cubos 5 kg (OP3)', 'Producto Terminado', 31, 0, 0, 'OP3-E5'),
  ('HIB-50K', 'Barra de Hielo ~50 kg', 'Producto Terminado', 120, 0, 0, NULL),
  ('HIP-25K', 'Picada de Barra ~25 kg', 'Producto Terminado', 60, 0, 0, 'OP3-E25'),
  ('HIT-25K', 'Triturada de Barra ~25 kg', 'Producto Terminado', 60, 0, 0, 'OP3-E25');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-OP3', 'Cuarto OP3', '{}');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (11661, 'Cliente público OP3', 'XAXX010101000', 0), (11662, 'Cliente comercial OP3', 'XAXX010101000', 0);
INSERT INTO camiones (id, nombre, placas, modelo, estatus) VALUES (11661, 'Camión OP3', 'OP3-000', 'Prueba', 'Activo');
COMMIT;

CREATE OR REPLACE FUNCTION op3_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION op3_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 100);
END $$;
CREATE OR REPLACE FUNCTION op3_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11660000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION op3_op(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT ('11660000-0000-0000-0000-' || lpad(p_k, 12, '0'))::uuid $$;
-- Estado: HPC5 | barras | picada | triturada (cuarto) | bolsas 5 kg | bolsas 25 kg
CREATE OR REPLACE FUNCTION op3_e() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE((stock ->> 'OP3-HPC5')::int, 0) || '|' || COALESCE((stock ->> 'HIB-50K')::int, 0) || '|' || COALESCE((stock ->> 'HIP-25K')::int, 0)
      || '|' || COALESCE((stock ->> 'HIT-25K')::int, 0) || '|' || (SELECT stock FROM productos WHERE sku = 'OP3-E5') || '|' || (SELECT stock FROM productos WHERE sku = 'OP3-E25')
    FROM cuartos_frios WHERE id = 'CF-OP3' $$;
CREATE OR REPLACE FUNCTION op3_v(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM op3_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION op3_assert(BOOLEAN, TEXT), op3_err(TEXT, TEXT, TEXT, TEXT), op3_actor(INTEGER), op3_op(TEXT), op3_e(), op3_v(TEXT) TO PUBLIC;

\echo '── OP-03 1. Producción: Máquina 30 (embolsado) y Máquina Barra (sin bolsa)'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(2);
SELECT registrar_produccion(op3_op('1'), 'Turno 1', 'Máquina 30', 'OP3-HPC5', 40, 'CF-OP3');
SELECT registrar_produccion(op3_op('2'), 'Turno 1', 'Máquina Barra', 'HIB-50K', 10, 'CF-OP3');
COMMIT;
SELECT op3_assert(op3_e() = '40|10|0|0|60|50', 'E1 Máquina 30: +40 bolsas de 5 kg (−40 bolsas OP3-E5); Máquina Barra: +10 barras sin consumir bolsa');

\echo '── OP-03 2. Preparar desde barra (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(2);
INSERT INTO op3_ids SELECT 'prepP', registrar_preparacion_barra(op3_op('3'), 'HIB-50K', 'HIP-25K', 'CF-OP3', 2)::text;
INSERT INTO op3_ids SELECT 'prepT', registrar_preparacion_barra(op3_op('4'), 'HIB-50K', 'HIT-25K', 'CF-OP3', 1)::text;
SELECT op3_err(format('SELECT registrar_produccion(%L::uuid, %L, %L, %L, 4, %L)', op3_op('5'), 'Turno 1', 'Máquina 30', 'HIP-25K', 'CF-OP3'),
  'E2c picada por máquina: rechazada (solo nace de preparar)', '22023', '%Preparar desde barra%');
COMMIT;
SELECT op3_assert(op3_e() = '40|7|4|2|60|44', 'E2 2 barras → 4 picada y 1 barra → 2 triturada: barras −3, bolsas de 25 kg −6 una sola vez');

\echo '── OP-03 3. Venta de mostrador (Ventas): precio público, barra completa, picada y triturada ya preparadas'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(3);
INSERT INTO op3_ids SELECT 'o1', crear_orden('{"cliente_id": 11661, "tipo_cobro": "Contado", "metodo_pago": "Efectivo"}',
  '[{"sku":"OP3-HPC5","cantidad":2},{"sku":"HIB-50K","cantidad":1},{"sku":"HIP-25K","cantidad":1},{"sku":"HIT-25K","cantidad":1}]')::text;
COMMIT;
SELECT op3_assert((SELECT string_agg(sku || '@' || precio_unit::numeric(10,2), ',' ORDER BY sku) FROM orden_lineas WHERE orden_id = (op3_v('o1')::jsonb ->> 'id')::bigint)
                  = 'HIB-50K@120.00,HIP-25K@60.00,HIT-25K@60.00,OP3-HPC5@31.00'
  AND (op3_v('o1')::jsonb ->> 'total')::numeric = 302,
  'E3a precios calculados por el servidor: público $31, barra $120, picada $60, triturada $60 (total $302)');
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(3);
SELECT completar_venta_directa(op3_op('6'), (op3_v('o1')::jsonb ->> 'id')::bigint, 'contado', 'Efectivo',
  '[{"sku":"OP3-HPC5","cuarto_id":"CF-OP3","cantidad":2},{"sku":"HIB-50K","cuarto_id":"CF-OP3","cantidad":1},{"sku":"HIP-25K","cuarto_id":"CF-OP3","cantidad":1},{"sku":"HIT-25K","cuarto_id":"CF-OP3","cantidad":1}]'::jsonb);
COMMIT;
SELECT op3_assert(op3_e() = '38|6|3|1|60|44'
  AND (SELECT estatus FROM ordenes WHERE id = (op3_v('o1')::jsonb ->> 'id')::bigint) = 'Entregada'
  AND (SELECT sum(monto) FROM pagos WHERE orden_id = (op3_v('o1')::jsonb ->> 'id')::bigint) = 302,
  'E3b entregada y cobrada ($302): barra −1, picada −1, triturada −1, embolsado −2; las bolsas de empaque NO se vuelven a consumir');

\echo '── OP-03 4. Precio especial por cliente (Admin) y pedido de ruta (Ventas)'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(1);
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (11662, 'OP3-HPC5', 28);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(3);
INSERT INTO op3_ids SELECT 'o2', crear_orden('{"cliente_id": 11662, "tipo_cobro": "Contado", "metodo_pago": "Efectivo"}', '[{"sku":"OP3-HPC5","cantidad":3}]')::text;
COMMIT;
SELECT op3_assert((SELECT precio_unit FROM orden_lineas WHERE orden_id = (op3_v('o2')::jsonb ->> 'id')::bigint) = 28
  AND (op3_v('o2')::jsonb ->> 'total')::numeric = 84,
  'E4 cliente comercial: precio especial $28 (el público sigue en $31); total $84');

\echo '── OP-03 5. Ruta: asignar (Admin), carga firmada, cierre financiero, merma de ruta y conteo final (Chofer)'
BEGIN; SET LOCAL session_replication_role = replica;
-- Admin crea la ruta desde "Autorizar ruta" (alta directa, como la vista) con chofer y camión.
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, camion_id)
VALUES (11661, 'R-11661', 'Ruta OP3', 11664, 'Chofer OP3', 'Programada', CURRENT_DATE, '{}', '{}', '{}', '{}', 11661);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(1);
SELECT asignar_ordenes_a_ruta(11661, ARRAY[(op3_v('o2')::jsonb ->> 'id')::bigint]);
COMMIT;
-- El chofer solicita la carga real (3 del pedido + 1 extra de 5 kg y 1 bolsa de picada), autorizada por Admin.
BEGIN; SET LOCAL session_replication_role = replica;
UPDATE rutas SET carga = '{"OP3-HPC5": 4, "HIP-25K": 1}', carga_autorizada = '{"OP3-HPC5": 4, "HIP-25K": 1}', carga_real = '{"OP3-HPC5": 4, "HIP-25K": 1}',
                 estatus = 'Pendiente firma', carga_solicitada_at = now() WHERE id = 11661;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(4);
SELECT confirmar_carga_ruta(op3_op('7'), 11661, 'data:image/png;base64,QQ==');
UPDATE rutas SET estatus = 'En progreso' WHERE id = 11661;
COMMIT;
SELECT op3_assert(op3_e() = '34|6|2|1|60|44' AND (SELECT camion_id FROM rutas WHERE id = 11661) = 11661,
  'E5a carga firmada: salen del cuarto 4 de 5 kg y 1 picada; la ruta usa el camión');
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(4);
SELECT cerrar_ruta_financiero(op3_op('8'), 11661, format('[{"ordenId": %s, "pago": "Efectivo"}]', op3_v('o2')::jsonb ->> 'id')::jsonb, 11664, 'Chofer OP3');
SELECT registrar_mermas_ruta(op3_op('9'), 11661, '[{"sku":"HIP-25K","cant":1,"causa":"Bolsa rota"}]');
SELECT finalizar_inventario_ruta(op3_op('10'), 11661, '{"OP3-HPC5": 1, "HIP-25K": 0}');
COMMIT;
SELECT op3_assert((SELECT estatus FROM ordenes WHERE id = (op3_v('o2')::jsonb ->> 'id')::bigint) = 'Entregada'
  AND (SELECT sum(monto) FROM pagos WHERE orden_id = (op3_v('o2')::jsonb ->> 'id')::bigint) = 84
  AND (SELECT estatus FROM rutas WHERE id = 11661) = 'Cerrada',
  'E5b entrega cobrada en ruta ($84 al precio especial); ruta cerrada');
SELECT op3_assert(op3_e() = '35|6|2|1|60|44', 'E5c conciliación: regresa al cuarto la bolsa de 5 kg sobrante; la picada perdida queda como merma de ruta');

\echo '── OP-03 6. Merma de cuarto (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(2);
SELECT registrar_merma_cuarto(op3_op('11'), 'CF-OP3', 'OP3-HPC5', 2, 'Bolsa rota');
COMMIT;
SELECT op3_assert(op3_e() = '33|6|2|1|60|44', 'E6 merma de cuarto: −2 de 5 kg; sin tocar empaque');

\echo '── OP-03 7. Reverso de preparación (Admin)'
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(1);
SELECT op3_err(format('SELECT revertir_preparacion_barra(%L::uuid, %s, %L)', op3_op('12'), op3_v('prepP')::jsonb ->> 'id', 'prueba'),
  'E7a revertir la picada ya vendida en parte (quedan 2 de 4): rechazado completo', 'P0001', '%Stock insuficiente%HIP-25K%');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(2);
INSERT INTO op3_ids SELECT 'prepT2', registrar_preparacion_barra(op3_op('13'), 'HIB-50K', 'HIT-25K', 'CF-OP3', 1)::text;
COMMIT;
SELECT op3_assert(op3_e() = '33|5|2|3|60|42', 'E7b preparación equivocada: 1 barra → 2 triturada');
BEGIN; SET LOCAL ROLE authenticated; SELECT op3_actor(1);
SELECT revertir_preparacion_barra(op3_op('14'), (op3_v('prepT2')::jsonb ->> 'id')::bigint, 'Se preparó por error');
COMMIT;
SELECT op3_assert(op3_e() = '33|6|2|1|60|44', 'E7c reverso válido: regresan la barra y las 2 bolsas; la triturada vuelve a 1');

\echo '── OP-03 8. Conciliación final'
SELECT op3_assert((SELECT count(*) FILTER (WHERE tipo = 'Produccion') = 2 AND count(*) FILTER (WHERE tipo = 'Preparacion') = 3
                          AND count(*) FILTER (WHERE tipo = 'Preparacion' AND estatus = 'Revertida') = 1 FROM produccion WHERE cuarto_id = 'CF-OP3')
  AND NOT EXISTS (SELECT 1 FROM cuartos_frios c, jsonb_each_text(c.stock) e WHERE c.id = 'CF-OP3' AND e.value::int < 0),
  'E8 historia completa: 2 producciones, 3 preparaciones (1 revertida); sin negativos');

BEGIN; SELECT op3_limpiar(); COMMIT;
BEGIN; SET LOCAL session_replication_role = replica;
INSERT INTO productos SELECT (jsonb_populate_record(NULL::productos, v::jsonb)).* FROM op3_ids WHERE k LIKE 'orig:%';
COMMIT;
DROP TABLE IF EXISTS op3_ids;
\echo '── OP-03: ENSAYO OPERATIVO COMPLETO OK'
