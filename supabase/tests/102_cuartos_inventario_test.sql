-- 102_cuartos_inventario_test.sql — inventario de cuartos fríos por contrato:
-- ajuste de conteo por cuarto, merma física en el cuarto elegido (sin FIFO),
-- reverso exacto, integridad de alta/borrado de cuartos, y (con 103) sin
-- escritura REST de la existencia ni del kardex. La fase se detecta por el
-- privilegio de INSERT sobre inventario_mov.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t102_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku LIKE 'P102-%');
  DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P102-%');
  DELETE FROM mermas WHERE sku LIKE 'P102-%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P102-%' OR cuarto_id LIKE 'CF-102%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '10200000-%';
  DELETE FROM auditoria WHERE usuario IN ('Admin 102', 'Prod 102') OR detalle LIKE '%P102-%' OR detalle LIKE '%CF-102%';
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-102%';
  DELETE FROM productos WHERE sku LIKE 'P102-%';
  DELETE FROM usuarios WHERE id BETWEEN 10201 AND 10209;
  DELETE FROM auth.users WHERE id::text LIKE '10200000-%';
END $$;

BEGIN; SELECT t102_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('10200000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t102' FROM generate_series(1, 4) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10201, 'Admin 102',  'u1@t102', 'Admin',      'Activo', '10200000-0000-0000-0000-000000000001'),
  (10202, 'Prod 102',   'u2@t102', 'Producción', 'Activo', '10200000-0000-0000-0000-000000000002'),
  (10203, 'Chofer 102', 'u3@t102', 'Chofer',     'Activo', '10200000-0000-0000-0000-000000000003'),
  (10204, 'Ventas 102', 'u4@t102', 'Ventas',     'Activo', '10200000-0000-0000-0000-000000000004');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P102-X', 'Hielo X 102', 'Producto Terminado', 30, 0, 0),
  ('P102-Y', 'Hielo Y 102', 'Producto Terminado', 30, 0, 0),
  ('P102-C', 'Hielo con costo 102', 'Producto Terminado', 30, 0, 5),
  ('P102-E', 'Bolsa 102', 'Empaque', 1, 10, 1);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-102A', 'Cuarto 102A', '{"P102-X": 100, "P102-Y": 50}'),
  ('CF-102B', 'Cuarto 102B', '{"P102-X": 100, "P102-C": 10}'),
  ('CF-102C', 'Cuarto 102C', '{}');
COMMIT;

CREATE OR REPLACE FUNCTION t102_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10200000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t102_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t102_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t102_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t102_contenido() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$ SELECT NOT has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') $$;
GRANT EXECUTE ON FUNCTION t102_actor(INTEGER), t102_assert(BOOLEAN, TEXT), t102_err(TEXT, TEXT, TEXT, TEXT), t102_cf(TEXT, TEXT), t102_contenido() TO PUBLIC;
DROP TABLE IF EXISTS t102_ids;
CREATE TEMP TABLE t102_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t102_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t102_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t102_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t102_j(TEXT) TO PUBLIC;

\echo '── 102: contratos'
SELECT t102_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 2
  FROM pg_proc WHERE oid IN ('public.ajustar_existencia_cuarto(uuid,text,text,integer,text)'::regprocedure, 'public.registrar_merma_cuarto(uuid,text,text,integer,text,text)'::regprocedure))
  AND pg_get_function_identity_arguments('public.ajustar_existencia_cuarto(uuid,text,text,integer,text)'::regprocedure) !~* 'tipo|referencia|origen|delta',
  '102-01 ajuste y merma de cuarto: SECURITY DEFINER, search_path fijo, sin anon; el cliente no elige tipo/referencia/origen');
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(2);
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a0f0', 'CF-102A', 'P102-X', 1, 'conteo físico')$q$, '102-02 Producción no ajusta conteos', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(3);
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b0f0', 'CF-102A', 'P102-X', 1, 'x')$q$, '102-03 Chofer no registra merma de cuarto', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(4);
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b0f0', 'CF-102A', 'P102-X', 1, 'x')$q$, '102-04 Ventas no registra merma de cuarto', '42501');
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a0f0', 'CF-102A', 'P102-X', 1, 'conteo físico')$q$, '102-05 Ventas no ajusta', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a0f0', 'CF-102A', 'P102-X', 1, 'conteo físico')$q$, '102-06 anon: sin EXECUTE', '42501');
ROLLBACK;

\echo '── 102: ajuste de conteo por cuarto'
INSERT INTO t102_ids VALUES ('k0', (SELECT count(*) FROM inventario_mov)::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(1);
INSERT INTO t102_ids VALUES ('a1', ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a001', 'CF-102A', 'P102-X', 93, 'Conteo físico semanal')::text);
INSERT INTO t102_ids VALUES ('a1r', ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a001', 'CF-102A', 'P102-X', 93, 'Conteo físico semanal')::text);
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a001', 'CF-102A', 'P102-X', 90, 'Conteo físico semanal')$q$, '102-10 misma operación con otro objetivo: rechazada', '23505');
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a002', 'CF-102A', 'P102-X', -1, 'Conteo físico')$q$, '102-11 objetivo negativo: rechazado', '22023');
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a002', 'CF-102A', 'P102-X', 5, 'ok')$q$, '102-12 motivo sin sustancia: rechazado', '22023', '%motivo%');
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a002', 'CF-102A', 'P102-E', 5, 'Conteo físico')$q$, '102-13 insumo (no producto terminado): rechazado', '22023');
SELECT t102_err($q$SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a002', 'CF-NOPE', 'P102-X', 5, 'Conteo físico')$q$, '102-14 cuarto inexistente: rechazado', '22023');
INSERT INTO t102_ids VALUES ('a0', ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a003', 'CF-102A', 'P102-Y', 50, 'Conteo físico sin diferencia')::text);
COMMIT;
SELECT t102_assert(t102_cf('CF-102A', 'P102-X') = 93 AND (t102_j('a1') ->> 'delta')::int = -7 AND (t102_j('a1') ->> 'anterior')::int = 100
  AND (t102_j('a1r') ->> 'replay') = 'true' AND t102_cf('CF-102A', 'P102-Y') = 50,
  '102-15 CF-102A X 100 → 93 (delta −7); reintento = replay; Y del mismo cuarto intacto');
SELECT t102_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Salida' AND cantidad = 7 AND cuarto_id = 'CF-102A' AND referencia = 'ajuste_cuarto/10200000-0000-0000-0000-00000000a001'
                      AND operacion_id = '10200000-0000-0000-0000-00000000a001' AND origen LIKE 'Ajuste de conteo Cuarto 102A: Conteo físico semanal' AND usuario = 'Admin 102')
                     FROM inventario_mov WHERE producto = 'P102-X')
  AND (SELECT count(*) = 1 FROM auditoria WHERE usuario = 'Admin 102' AND accion = 'Ajustar' AND detalle LIKE 'Cuarto 102A — P102-X: 100 → 93 (-7)%')
  AND (SELECT count(*) = 1 FROM stock_operaciones WHERE operacion_id = '10200000-0000-0000-0000-00000000a001' AND tipo = 'ajuste_cuarto'),
  '102-16 un solo evento canónico: kardex del cuarto, referencia estructurada, operación, motivo, auditoría');
SELECT t102_assert((t102_j('a0') ->> 'delta')::int = 0 AND NOT EXISTS (SELECT 1 FROM inventario_mov WHERE producto = 'P102-Y')
  AND (SELECT stock FROM productos WHERE sku = 'P102-X') = 0, '102-17 sin diferencia: sin kardex; el espejo productos.stock no se toca');

\echo '── 102: merma física en el cuarto elegido'
INSERT INTO t102_ids VALUES ('rep0', reporte_financiero(fin_hoy(), fin_hoy())::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(2);
INSERT INTO t102_ids VALUES ('m1', registrar_merma_cuarto('10200000-0000-0000-0000-00000000b001', 'CF-102B', 'P102-X', 10, 'Bolsa rota')::text);
INSERT INTO t102_ids VALUES ('m1r', registrar_merma_cuarto('10200000-0000-0000-0000-00000000b001', 'CF-102B', 'P102-X', 10, 'Bolsa rota')::text);
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b001', 'CF-102B', 'P102-X', 11, 'Bolsa rota')$q$, '102-20 misma operación con otra cantidad: rechazada', '23505');
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b002', 'CF-102C', 'P102-X', 1, 'Bolsa rota')$q$, '102-21 cuarto sin existencia: rechazada (no toma de otro cuarto)', 'P0001', '%insuficiente%');
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b003', 'CF-102B', 'P102-X', 1, 'x', 'otra-persona/2026/x.jpg')$q$, '102-22 foto de carpeta ajena: rechazada', '42501');
SELECT t102_err($q$SELECT registrar_merma_cuarto('10200000-0000-0000-0000-00000000b003', 'CF-102B', 'P102-X', 0, 'x')$q$, '102-23 cantidad 0: rechazada', '22023');
INSERT INTO t102_ids VALUES ('mc', registrar_merma_cuarto('10200000-0000-0000-0000-00000000b004', 'CF-102B', 'P102-C', 2, 'Hielo derretido')::text);
COMMIT;
INSERT INTO t102_ids VALUES ('rep1', reporte_financiero(fin_hoy(), fin_hoy())::text);
SELECT t102_assert(t102_cf('CF-102B', 'P102-X') = 90 AND t102_cf('CF-102A', 'P102-X') = 93 AND t102_cf('CF-102C', 'P102-X') = 0
  AND (t102_j('m1r') ->> 'replay') = 'true' AND (t102_j('m1r') ->> 'id') = (t102_j('m1') ->> 'id'),
  '102-24 CF-102B 100 → 90; los demás cuartos intactos; reintento = replay (sin segunda pérdida)');
SELECT t102_assert((SELECT count(*) = 1 AND bool_and(e.cuarto_id = 'CF-102B' AND e.cantidad = 10 AND m.cuarto_id = 'CF-102B' AND m.tipo = 'Merma' AND m.cantidad = 10
                      AND m.operacion_id = '10200000-0000-0000-0000-00000000b001' AND m.referencia = 'MERMA-' || (t102_j('m1') ->> 'id'))
                     FROM mermas_efectos e JOIN inventario_mov m ON m.id = e.inv_mov_id WHERE e.merma_id = (t102_j('m1') ->> 'id')::bigint)
  AND (SELECT count(*) = 1 FROM mermas WHERE sku = 'P102-X' AND estatus = 'Activa' AND ruta_id IS NULL AND afecta_stock)
  AND (SELECT count(*) = 1 FROM auditoria WHERE usuario = 'Prod 102' AND detalle LIKE 'Merma #' || (t102_j('m1') ->> 'id') || '%en Cuarto 102B%'),
  '102-25 exactamente un efecto CF-102B / X / 10, kardex con cuarto y operación, una merma, auditoría');
SELECT t102_assert((t102_j('m1') ->> 'mov_contable_id') IS NULL
  AND (SELECT monto = 10 AND categoria = 'Mermas' FROM movimientos_contables WHERE id = (t102_j('mc') ->> 'mov_contable_id')::bigint)
  AND ((t102_j('rep1') -> 'resultados' ->> 'mermas')::numeric - (t102_j('rep0') -> 'resultados' ->> 'mermas')::numeric) = 10
  AND (t102_j('rep1') -> 'flujo' ->> 'salidas') = (t102_j('rep0') -> 'flujo' ->> 'salidas'),
  '102-26 valuación vigente: costo 0 → sin egreso; costo 5 × 2 → 10 en mermas (no efectivo, sin salida de caja)');

\echo '── 102: reverso exacto'
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(1);
INSERT INTO t102_ids VALUES ('rv', revertir_merma((t102_j('m1') ->> 'id')::bigint, 'registro equivocado')::text);
SELECT t102_err(format('SELECT revertir_merma(%s)', t102_j('m1') ->> 'id'), '102-30 segundo reverso: rechazado', '55000');
INSERT INTO t102_ids VALUES ('rvc', revertir_merma((t102_j('mc') ->> 'id')::bigint, 'registro equivocado')::text);
COMMIT;
SELECT t102_assert(t102_cf('CF-102B', 'P102-X') = 100 AND t102_cf('CF-102A', 'P102-X') = 93
  AND (SELECT reverso_inv_mov_id IS NOT NULL FROM mermas_efectos WHERE merma_id = (t102_j('m1') ->> 'id')::bigint)
  AND (SELECT estatus = 'Revertida' FROM mermas WHERE id = (t102_j('m1') ->> 'id')::bigint)
  AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE id = (t102_j('mc') ->> 'mov_contable_id')::bigint) AND t102_cf('CF-102B', 'P102-C') = 10,
  '102-31 el reverso regresa exactamente el efecto guardado a CF-102B (100) y borra el egreso ligado');

\echo '── 102: alta, metadatos y borrado de cuartos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(1);
SELECT t102_err($q$INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-102Z', 'Con inventario', '{"P102-X": 5}')$q$, '102-40 alta con existencia: rechazada', '42501');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-102D', 'Cuarto nuevo', '{}');
UPDATE cuartos_frios SET nombre = 'Cuarto nuevo 2', temp = -10, capacidad_tarimas = 8 WHERE id = 'CF-102D';
SELECT t102_err($q$UPDATE cuartos_frios SET id = 'CF-102DD' WHERE id = 'CF-102D'$q$, '102-41 cambiar el id del cuarto: rechazado', '42501');
SELECT t102_err($q$DELETE FROM cuartos_frios WHERE id = 'CF-102A'$q$, '102-42 borrar cuarto con existencia: rechazado', '42501', '%existencia%');
SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a010', 'CF-102C', 'P102-Y', 5, 'Conteo físico inicial');
SELECT ajustar_existencia_cuarto('10200000-0000-0000-0000-00000000a011', 'CF-102C', 'P102-Y', 0, 'Conteo físico final');
SELECT t102_err($q$DELETE FROM cuartos_frios WHERE id = 'CF-102C'$q$, '102-43 borrar cuarto vacío con historia de kardex: rechazado', '42501', '%historia%');
DELETE FROM cuartos_frios WHERE id = 'CF-102D';
COMMIT;
SELECT t102_assert(NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id IN ('CF-102Z', 'CF-102D')) AND EXISTS (SELECT 1 FROM cuartos_frios WHERE id = 'CF-102C')
  AND (SELECT confdeltype = 'r' FROM pg_constraint WHERE conname = 'inventario_mov_cuarto_id_fkey'),
  '102-44 metadatos editables; cuarto sin existencia ni historia se borra; el kardex ya no pierde su cuarto (FK RESTRICT)');

\echo '── 102: devolución de cliente (095, sin cambio)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(1);
SELECT update_stocks_atomic('[{"cuarto_id":"CF-102A","sku":"P102-X","delta":2,"tipo":"Devolución cliente","origen":"Devolución OV-T102"}]');
SELECT t102_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-102A","sku":"P102-X","delta":-2}]')$q$, '102-50 095: salida por el RPC genérico sigue negada', '42501');
COMMIT;
SELECT t102_assert(t102_cf('CF-102A', 'P102-X') = 95, '102-51 la devolución de cliente vigente sigue sumando al cuarto (+2)');

\echo '── 102: frontend anterior y contención 103'
INSERT INTO t102_ids VALUES ('h0', (SELECT md5(string_agg(id || stock::text, '|' ORDER BY id)) FROM cuartos_frios WHERE id LIKE 'CF-102%')
                                 || '/' || (SELECT count(*) FROM inventario_mov) || '/' || (SELECT stock FROM productos WHERE sku = 'P102-X') || '/' || (SELECT count(*) FROM auditoria));
DO $do$
BEGIN
  PERFORM t102_actor(1); SET LOCAL ROLE authenticated;
  IF t102_contenido() THEN
    -- Secuencia de ajustarStockCuarto anterior: el primer paso que cambia inventario se niega.
    PERFORM t102_err($q$UPDATE cuartos_frios SET stock = '{"P102-X": 1, "P102-Y": 50}' WHERE id = 'CF-102A'$q$, '102-60 REST: sobrescribir la existencia del cuarto, negado', '42501');
    PERFORM t102_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, origen) VALUES ('Salida', 'P102-X', 94, 'Ajuste Cuarto 102A: viejo')$q$, '102-61 REST: kardex directo, negado', '42501');
    PERFORM t102_err($q$SELECT registrar_merma('P102-X', 1, 'Bolsa rota')$q$, '102-62 merma de cuarto sin cuarto (FIFO) desde la aplicación: negada', '42501', '%registrar_merma_cuarto%');
    PERFORM t102_err($q$SELECT registrar_mermas_ruta(1::bigint, '[]'::jsonb)$q$, '102-63 sobrecarga legada registrar_mermas_ruta(bigint, jsonb): sin EXECUTE', '42501');
    PERFORM t102_err($q$SELECT salida_cuarto_manual('10200000-0000-0000-0000-00000000c001', 'CF-102A', 'P102-X', 1, 'Ajuste físico')$q$, '102-64 salida manual "Ajuste físico": usa el ajuste de conteo', '22023');
    PERFORM t102_err($q$SELECT salida_cuarto_manual('10200000-0000-0000-0000-00000000c001', 'CF-102A', 'P102-X', 1, 'Otro')$q$, '102-65 salida manual "Otro" sin detalle: rechazada', '22023');
    PERFORM t102_err($q$SELECT salida_cuarto_manual('10200000-0000-0000-0000-00000000c001', 'CF-102A', 'P102-X', 1, 'Merma')$q$, '102-66 salida manual con motivo de merma: rechazada', '22023');
  ELSE
    -- Antes de 103 el frontend anterior sigue funcionando.
    UPDATE cuartos_frios SET nombre = nombre WHERE id = 'CF-102A';
    RAISE NOTICE 'OK: 102-60 antes de 103: la escritura REST de existencia aún no se niega (frontend anterior)';
  END IF;
  RESET ROLE;
END $do$;
DO $do$
BEGIN
  IF t102_contenido() THEN
    PERFORM t102_assert((SELECT md5(string_agg(id || stock::text, '|' ORDER BY id)) FROM cuartos_frios WHERE id LIKE 'CF-102%')
                         || '/' || (SELECT count(*) FROM inventario_mov) || '/' || (SELECT stock FROM productos WHERE sku = 'P102-X') || '/' || (SELECT count(*) FROM auditoria) = (SELECT v FROM t102_ids WHERE k = 'h0'),
      '102-67 cliente anterior: sin cambio de existencia, kardex, espejo ni auditoría');
  END IF;
END $do$;
BEGIN; SET LOCAL ROLE authenticated; SELECT t102_actor(2);
INSERT INTO t102_ids VALUES ('s1', salida_cuarto_manual('10200000-0000-0000-0000-00000000c002', 'CF-102A', 'P102-X', 1, 'Venta directa')::text);
INSERT INTO t102_ids VALUES ('s2', salida_cuarto_manual('10200000-0000-0000-0000-00000000c003', 'CF-102A', 'P102-X', 1, 'Otro: muestra para cliente nuevo')::text);
COMMIT;
SELECT t102_assert(t102_cf('CF-102A', 'P102-X') = 93 AND (SELECT count(*) = 2 FROM inventario_mov WHERE producto = 'P102-X' AND referencia = 'salida_manual/CF-102A' AND cuarto_id = 'CF-102A'),
  '102-68 salida manual con motivo estructurado: descuenta del cuarto con kardex');
SELECT t102_assert(NOT t102_contenido() OR (SELECT count(*) = 2 FROM auditoria WHERE accion = 'Salida manual' AND detalle LIKE 'CF-102A — 1×P102-X%'), '102-69 tras 103: la salida manual queda auditada');

BEGIN; SELECT t102_limpiar(); COMMIT;
\echo '── 102: TODAS LAS PRUEBAS OK'
