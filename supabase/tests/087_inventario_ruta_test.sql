-- 087_inventario_ruta_test.sql — inventario canónico de ruta.
-- Estado físico y seguridad; balance canónico y sus fallas cerradas;
-- escenarios A–L (devolución, merma, no-entrega, multi-cuarto, multi-SKU,
-- conteo con faltante/sobrante, exprés inválida, respuesta perdida, cierre
-- directo, cierre Admin, cancelación de ruta cargada); merma de ruta
-- (topes, lote idempotente, reverso) y no-entrega sin cuarto.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t87_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P87-%');
  DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku LIKE 'P87-%');
  DELETE FROM mermas WHERE sku LIKE 'P87-%';
  DELETE FROM auditoria WHERE modulo = 'Mermas' AND detalle LIKE '%P87-%';
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8701 AND 8799;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799 OR id BETWEEN 8721 AND 8739);
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799 OR id BETWEEN 8721 AND 8739);
  DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799 OR id BETWEEN 8721 AND 8739);
  DELETE FROM inventario_mov WHERE producto LIKE 'P87-%';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 8701 AND 8799 OR orden_id BETWEEN 8721 AND 8739 OR operacion_id::text LIKE '87000000-%';
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799 OR id BETWEEN 8721 AND 8739);
  DELETE FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799 OR id BETWEEN 8721 AND 8739;
  DELETE FROM rutas WHERE id BETWEEN 8701 AND 8799;
  DELETE FROM clientes WHERE id = 8740;
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-87%';
  UPDATE cuartos_frios SET stock = stock - 'P87-A' - 'P87-B' - 'P87-D' WHERE stock ?| ARRAY['P87-A', 'P87-B', 'P87-D'];
  DELETE FROM productos WHERE sku LIKE 'P87-%';
  DELETE FROM usuarios WHERE id BETWEEN 8701 AND 8729;
  DELETE FROM auth.users WHERE id::text LIKE '87000000-%';
END $$;

BEGIN;
SELECT t87_limpiar();
INSERT INTO auth.users (id, email)
  SELECT ('87000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t87' FROM generate_series(1, 20) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8701, 'Admin 87',  'u1@t87', 'Admin',      'Activo', '87000000-0000-0000-0000-000000000001'),
  (8702, 'Prod 87',   'u2@t87', 'Producción', 'Activo', '87000000-0000-0000-0000-000000000002'),
  (8705, 'Ventas 87', 'u5@t87', 'Ventas',     'Activo', '87000000-0000-0000-0000-000000000005');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
  SELECT 8700 + n, 'Chofer 87-' || n, 'u' || n || '@t87', 'Chofer', 'Activo', ('87000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(10, 20) n;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P87-A', 'Hielo A87', 'Producto Terminado', 30, 0, 2), ('P87-B', 'Hielo B87', 'Producto Terminado', 30, 0, 0), ('P87-D', 'Hielo D87', 'Producto Terminado', 30, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-87A', 'Cuarto 87A', '{"P87-A": 300, "P87-B": 50, "P87-D": 5}'), ('CF-87B', 'Cuarto 87B', '{"P87-D": 10}');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8740, 'Cliente 87', 'XAXX010101000', 0);
-- rutas: una por chofer (idx_ruta_chofer_activa); carga_real = carga autorizada
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (8701, 'R-8701', 'A devolución',     8710, 'Chofer 87-10', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 20}', '{"P87-A": 20}', '{}', '{"P87-A": 20}', now()),
  (8702, 'R-8702', 'B merma',          8711, 'Chofer 87-11', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 20}', '{"P87-A": 20}', '{}', '{"P87-A": 20}', now()),
  (8703, 'R-8703', 'C no-entrega',     8712, 'Chofer 87-12', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 20}', '{"P87-A": 20}', '{}', '{"P87-A": 20}', now()),
  (8704, 'R-8704', 'K admin',          8713, 'Chofer 87-13', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 10}', '{"P87-A": 10}', '{}', '{"P87-A": 10}', now()),
  (8705, 'R-8705', 'E multi-SKU',      8714, 'Chofer 87-14', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 10, "P87-B": 6}', '{"P87-A": 10, "P87-B": 6}', '{}', '{"P87-A": 10, "P87-B": 6}', now()),
  (8706, 'R-8706', 'F/G conteo',       8715, 'Chofer 87-15', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 10}', '{"P87-A": 10}', '{}', '{"P87-A": 10}', now()),
  (8707, 'R-8707', 'H exprés fuera',   8716, 'Chofer 87-16', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 5}',  '{"P87-A": 5}',  '{}', '{"P87-A": 5}', now()),
  (8708, 'R-8708', 'H exprés no carg', 8717, 'Chofer 87-17', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 5}',  '{"P87-A": 5}',  '{}', '{"P87-A": 5}', now()),
  (8709, 'R-8709', 'H exprés exceso',  8718, 'Chofer 87-18', 'Pendiente firma', CURRENT_DATE, '{"P87-A": 5}',  '{"P87-A": 5}',  '{}', '{"P87-A": 5}', now()),
  (8710, 'R-8710', 'D multi-cuarto',   8719, 'Chofer 87-19', 'Pendiente firma', CURRENT_DATE, '{"P87-D": 12}', '{"P87-D": 12}', '{}', '{"P87-D": 12}', now()),
  (8790, 'R-8790', 'legacy cargada',   NULL, NULL,           'En progreso',     CURRENT_DATE, '{"P87-A": 3}',  '{"P87-A": 3}',  '{}', '{"P87-A": 3}', now()),
  (8791, 'R-8791', 'programada',       8720, 'Chofer 87-20', 'Programada',      CURRENT_DATE, '{"P87-A": 3}',  '{"P87-A": 3}',  '{}', '{}', NULL);
UPDATE rutas SET carga_confirmada_at = now() WHERE id = 8790;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8721, 'OV-8721', 8740, 'Cliente 87', '12×P87-A', 360, 'Asignada', 'Efectivo', 'Contado', 8705, 8701),
  (8722, 'OV-8722', 8740, 'Cliente 87', '12×P87-A', 360, 'Asignada', 'Efectivo', 'Contado', 8705, 8702),
  (8723, 'OV-8723', 8740, 'Cliente 87', '5×P87-A',  150, 'Asignada', 'Efectivo', 'Contado', 8705, 8703),
  (8724, 'OV-8724', 8740, 'Cliente 87', '10×P87-A', 300, 'Asignada', 'Efectivo', 'Contado', 8705, 8703),
  (8725, 'OV-8725', 8740, 'Cliente 87', '3×P87-A',  90,  'Asignada', 'Efectivo', 'Contado', 8705, 8704),
  (8726, 'OV-8726', 8740, 'Cliente 87', '4×P87-A',  120, 'Asignada', 'Efectivo', 'Contado', 8705, 8705),
  (8727, 'OV-8727', 8740, 'Cliente 87', '3×P87-D',  90,  'Asignada', 'Efectivo', 'Contado', 8705, 8710);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8721, 'P87-A', 12, 30, 360), (8722, 'P87-A', 12, 30, 360), (8723, 'P87-A', 5, 30, 150), (8724, 'P87-A', 10, 30, 300),
  (8725, 'P87-A', 3, 30, 90), (8726, 'P87-A', 4, 30, 120), (8727, 'P87-D', 3, 30, 90);
COMMIT;

CREATE OR REPLACE FUNCTION t87_actor(p_n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '87000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t87_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t87_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT; v_det TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT, v_det = PG_EXCEPTION_DETAIL; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
  RETURN v_det;
END $$;
CREATE OR REPLACE FUNCTION t87_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t87_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t87_rest(p_ruta BIGINT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT restante FROM balance_ruta_interno(p_ruta) WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t87_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(id || '=' || stock::text, ' ' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-87%'),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 8701 AND 8799),
    (SELECT string_agg(concat_ws(':', id, estatus), ',' ORDER BY id) FROM ordenes WHERE ruta_id BETWEEN 8701 AND 8799),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P87-%'),
    (SELECT count(*)::text FROM mermas WHERE sku LIKE 'P87-%'),
    (SELECT count(*)::text FROM stock_operaciones WHERE ruta_id BETWEEN 8701 AND 8799)))
$$;
DROP TABLE IF EXISTS t87_ids;
CREATE TEMP TABLE t87_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t87_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t87_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t87_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t87_v(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM t87_ids WHERE k = p_k $$;

\echo '── 087: estado físico y seguridad'
SELECT t87_assert(to_regprocedure('public.cerrar_ruta_atomic(bigint,jsonb,text,jsonb,numeric,numeric,text)') IS NULL, '087-01 cerrar_ruta_atomic retirada (sin devolución arbitraria de Admin)');
SELECT t87_assert((SELECT count(*) = 5 AND bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('public', oid, 'EXECUTE'))
  FROM pg_proc WHERE oid IN ('public.calcular_balance_ruta(bigint)'::regprocedure, 'public.finalizar_inventario_ruta(uuid,bigint,jsonb)'::regprocedure, 'public.registrar_mermas_ruta(uuid,bigint,jsonb)'::regprocedure, 'public.balance_ruta_interno(bigint)'::regprocedure, 'public.rutas_guard_inventario()'::regprocedure)), '087-02 contratos nuevos: SECURITY DEFINER, search_path fijo, sin PUBLIC/anon');
SELECT t87_assert(has_function_privilege('authenticated', 'public.calcular_balance_ruta(bigint)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.finalizar_inventario_ruta(uuid,bigint,jsonb)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.registrar_mermas_ruta(uuid,bigint,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.balance_ruta_interno(bigint)', 'EXECUTE'), '087-03 API: balance, finalización y lote; el helper interno no');
SELECT t87_assert(pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.cierre_ctx' AND pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.carga_ctx'
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.rutas'::regclass AND tgname = 'trg_rutas_guard_inventario' AND NOT tgisinternal), '087-04 guard 078 exige app.cierre_ctx (y conserva app.carga_ctx de 085); guard de inventario activo');
SELECT t87_assert(pg_get_functiondef('public.registrar_no_entrega(uuid,bigint,text,boolean)'::regprocedure) !~ 'stock_mov_cuarto|cuartos_frios', '087-05 registrar_no_entrega ya no toca cuartos');
SELECT t87_assert((SELECT pg_get_constraintdef(oid) ~ 'merma_ruta' AND pg_get_constraintdef(oid) ~ 'cierre_ruta' AND pg_get_constraintdef(oid) ~ 'carga_ruta' FROM pg_constraint WHERE conname = 'stock_operaciones_tipo_check'), '087-06 stock_operaciones: tipos merma_ruta y cierre_ruta agregados, previos intactos');
SELECT t87_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'update_stocks_atomic' AND p.proname !~ '^t[0-9]*_' AND pg_get_functiondef(p.oid) ~ 'update_stocks_atomic\('), '087-07 085 intacto: ninguna función invoca el RPC genérico');

\echo '── 087: cargas por contrato (estructuradas)'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES (8701, 10), (8702, 11), (8703, 12), (8704, 13), (8705, 14), (8706, 15), (8707, 16), (8708, 17), (8709, 18), (8710, 19)) x(ruta, n) LOOP
    PERFORM t87_actor(r.n);
    SET LOCAL ROLE authenticated;
    PERFORM confirmar_carga_ruta(('87000000-0000-0000-0000-00000c00' || r.ruta::text)::uuid, r.ruta::bigint, 'data:image/png;base64,QQ==');
    UPDATE rutas SET estatus = 'En progreso' WHERE id = r.ruta;
    RESET ROLE;
  END LOOP;
END $$;
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = 300 - 105 AND t87_cf('CF-87A', 'P87-B') = 44 AND t87_cf('CF-87A', 'P87-D') = 0 AND t87_cf('CF-87B', 'P87-D') = 3
  AND (SELECT count(*) = 10 FROM rutas WHERE id BETWEEN 8701 AND 8710 AND estatus = 'En progreso'), '087-10 10 rutas cargadas por contrato: A −105, B −6, D 5 de CF-87A + 7 de CF-87B');

\echo '── 087: balance canónico, autorización y fallas cerradas'
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(10);
SELECT t87_assert((SELECT count(*) = 1 AND bool_and(sku = 'P87-A' AND cargado = 20 AND entregado = 0 AND merma = 0 AND devuelto = 0 AND restante = 20) FROM calcular_balance_ruta(8701)), '087-11 Chofer dueño: balance de su ruta (cargado 20, restante 20)');
SELECT t87_err($q$SELECT * FROM calcular_balance_ruta(8702)$q$, '087-12 Chofer ajeno: denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(5);
SELECT t87_err($q$SELECT * FROM calcular_balance_ruta(8701)$q$, '087-13 Ventas: denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t87_err($q$SELECT * FROM calcular_balance_ruta(8701)$q$, '087-14 anon: sin EXECUTE', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(1);
SELECT t87_assert((SELECT count(*) = 2 FROM calcular_balance_ruta(8705)), '087-15 Admin: balance de cualquier ruta (multi-SKU: 2 filas)');
SELECT t87_err($q$SELECT * FROM calcular_balance_ruta(8790)$q$, '087-16 carga confirmada sin carga estructurada (legacy): falla cerrado', 'P0001', '%sin carga estructurada%');
ROLLBACK;

\echo '── 087 A: carga 20, entrega 12, devuelve 8'
INSERT INTO t87_ids VALUES ('A0', t87_cf('CF-87A', 'P87-A')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(10);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a1', 8701, '{"P87-A": 20}')$q$, '087-A0 sin cierre financiero: rechazado', '22023', '%cierre financiero%');
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f1'::uuid, 8701, '[{"ordenId": 8721, "pago": "Efectivo"}]'::jsonb, 8710, 'Chofer 87-10');
SELECT t87_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8701$q$, '087-J1 Chofer: cierre directo por REST denegado', '42501');
SELECT t87_err($q$UPDATE rutas SET devolucion = '{"P87-A": 8}' WHERE id = 8701$q$, '087-J2 Chofer: rutas.devolucion por REST denegado', '42501');
INSERT INTO t87_ids VALUES ('A1', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a1', 8701, '{"P87-A": 8}')::text);
INSERT INTO t87_ids VALUES ('A1r', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a1', 8701, '{"P87-A": "8", "P87-B": 0}')::text);
INSERT INTO t87_ids VALUES ('A1o', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a2', 8701, '{"P87-A": 8}')::text);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a1', 8701, '{"P87-A": 7}')$q$, '087-I3 misma operación + otro conteo → 23505', '23505');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000a3', 8701, '{"P87-A": 7}')$q$, '087-I4 otra operación + otro conteo sobre ruta finalizada → 22023', '22023', '%ya tiene inventario finalizado%');
COMMIT;
SELECT t87_assert((t87_j('A1') ->> 'replay') = 'false' AND (t87_j('A1') ->> 'estatus') = 'Cerrada' AND t87_cf('CF-87A', 'P87-A') = t87_v('A0')::int + 8
  AND (SELECT estatus = 'Cerrada' AND devolucion = '{"P87-A": 8}'::jsonb AND fecha_fin IS NOT NULL AND cierre_at IS NOT NULL FROM rutas WHERE id = 8701), '087-A1 el cuarto recibe 8, la ruta queda Cerrada con devolución canónica');
SELECT t87_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Entrada' AND cuarto_id = 'CF-87A' AND ruta_id = 8701 AND cantidad = 8 AND referencia = 'devolucion_ruta/R-8701' AND operacion_id = '87000000-0000-0000-0000-0000000000a1' AND usuario = 'Chofer 87-10') FROM inventario_mov WHERE ruta_id = 8701 AND referencia LIKE 'devolucion_ruta/%'), '087-A2 kardex de devolución estructurado, atribuido al chofer');
SELECT t87_assert((SELECT bool_and(restante = 0) AND sum(cargado) = 20 AND sum(entregado) = 12 AND sum(devuelto) = 8 FROM balance_ruta_interno(8701)), '087-A3 balance de la ruta cerrada = 0 (20 = 12 + 0 + 8)');
SELECT t87_assert((t87_j('A1r') ->> 'replay') = 'true' AND (t87_j('A1o') ->> 'replay') = 'true' AND (t87_j('A1o') ->> 'operacion_original') = '87000000-0000-0000-0000-0000000000a1'
  AND t87_cf('CF-87A', 'P87-A') = t87_v('A0')::int + 8 AND (SELECT count(*) = 1 FROM stock_operaciones WHERE ruta_id = 8701 AND tipo = 'cierre_ruta'), '087-I1/I2 respuesta perdida (misma operación) y UUID perdido (otra operación, mismo conteo): replay, una sola devolución');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(10);
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-00000000009e'::uuid, 8701, '[{"sku":"P87-A","cant":1,"causa":"x"}]')$q$, '087-M1 merma sobre ruta Cerrada rechazada', '22023', '%Cargada o En progreso%');
SELECT t87_err($q$SELECT registrar_merma('P87-A', 1, 'x', NULL, NULL, 8701)$q$, '087-M2 merma suelta sobre ruta Cerrada rechazada', '22023', '%Cargada o En progreso%');
SELECT t87_err($q$SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f9'::uuid, 8701, '[{"express": true, "pago": "Efectivo", "items": [{"sku": "P87-A", "cant": 1, "precio": 30}]}]'::jsonb, 8710, 'x')$q$, '087-A4 exprés después del cierre: rechazada (ruta Cerrada)', '22023|P0001');
SELECT t87_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 8701$q$, '087-A5 Chofer no reabre la ruta cerrada', '42501');
ROLLBACK;

\echo '── 087 B: carga 20, entrega 12, merma 3, devuelve 5 (y reverso de merma de ruta)'
INSERT INTO t87_ids VALUES ('B0', t87_cf('CF-87A', 'P87-A')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(11);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f2'::uuid, 8702, '[{"ordenId": 8722, "pago": "Efectivo"}]'::jsonb, 8711, 'Chofer 87-11');
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b9'::uuid, 8702, '[{"sku":"P87-A","cant":9,"causa":"Bolsa rota"}]')$q$, '087-M3 merma mayor al balance del camión (8) rechazada', '22023', '%supera el inventario del camión%');
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b9'::uuid, 8702, '[{"sku":"P87-B","cant":1,"causa":"Bolsa rota"}]')$q$, '087-M4 merma de un SKU no cargado rechazada', '22023', '%supera el inventario del camión%');
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b9'::uuid, 8702, '[{"sku":"P87-ZZ","cant":1,"causa":"Bolsa rota"}]')$q$, '087-M5 merma de SKU inexistente rechazada', '22023', '%SKU no encontrado%');
INSERT INTO t87_ids VALUES ('Bm0', registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b0'::uuid, 8702, '[{"sku":"P87-A","cant":2,"causa":"Hielo derretido","foto":"data:image/jpeg;base64,AAAA"}]')::text);
COMMIT;
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = t87_v('B0')::int AND t87_rest(8702, 'P87-A') = 6
  AND (SELECT count(*) = 0 FROM mermas_efectos e JOIN mermas m ON m.id = e.merma_id WHERE m.ruta_id = 8702)
  AND (SELECT count(*) = 1 AND bool_and(cuarto_id IS NULL AND tipo = 'Merma' AND cantidad = 2 AND usuario = 'Chofer 87-11') FROM inventario_mov WHERE ruta_id = 8702 AND referencia LIKE 'MERMA-%')
  AND (SELECT count(*) = 1 AND bool_and(mc.monto = 4 AND mc.categoria = 'Mermas') FROM mermas m JOIN movimientos_contables mc ON mc.id = m.mov_contable_id WHERE m.ruta_id = 8702), '087-B1 merma de ruta: sin cuartos ni efectos, kardex del camión, egreso 2×2; balance 8 → 6');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(1);
INSERT INTO t87_ids VALUES ('Brv', revertir_merma((t87_j('Bm0') -> 'registradas' -> 0 ->> 'id')::bigint, 'se contó dos veces')::text);
COMMIT;
SELECT t87_assert((t87_j('Brv') ->> 'estatus') = 'Revertida' AND (t87_j('Brv') ->> 'egreso_borrado') = 'true' AND t87_cf('CF-87A', 'P87-A') = t87_v('B0')::int AND t87_rest(8702, 'P87-A') = 8
  AND (SELECT count(*) = 1 AND bool_and(cuarto_id IS NULL AND ruta_id = 8702 AND cantidad = 2) FROM inventario_mov WHERE tipo = 'Reverso merma' AND referencia = 'MERMA-' || (t87_j('Bm0') -> 'registradas' -> 0 ->> 'id')), '087-B2 reverso de merma de ruta: cero efectos válido, sin cuarto, egreso borrado, vuelve al balance (8)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(11);
INSERT INTO t87_ids VALUES ('Bm1', registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b1'::uuid, 8702, '[{"sku":"P87-A","cant":3,"causa":"Bolsa rota","foto":"data:image/jpeg;base64,BBBB"}]')::text);
INSERT INTO t87_ids VALUES ('Bm1r', registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b1'::uuid, 8702, '[{"sku":"P87-A","cant":3,"causa":"Bolsa rota","foto":"data:image/jpeg;base64,BBBB"}]')::text);
INSERT INTO t87_ids VALUES ('Bm1o', registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b2'::uuid, 8702, '[{"sku":"P87-A","cant":3,"causa":"Bolsa rota","foto":"data:image/jpeg;base64,BBBB"}]')::text);
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-0000000000b1'::uuid, 8702, '[{"sku":"P87-A","cant":1,"causa":"Bolsa rota"}]')$q$, '087-M8 misma operación de lote con otras mermas → 23505', '23505');
INSERT INTO t87_ids VALUES ('B1', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000b5', 8702, '{"P87-A": 5}')::text);
COMMIT;
SELECT t87_assert((t87_j('Bm1r') ->> 'replay') = 'true' AND (t87_j('Bm1o') ->> 'replay') = 'true' AND (SELECT count(*) = 1 FROM mermas WHERE ruta_id = 8702 AND estatus = 'Activa'), '087-M6/M7 lote: replay por operación y por contenido, sin mermas duplicadas');
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = t87_v('B0')::int + 5 AND (SELECT bool_and(restante = 0) AND sum(merma) = 3 AND sum(devuelto) = 5 FROM balance_ruta_interno(8702)) AND (SELECT estatus = 'Cerrada' FROM rutas WHERE id = 8702), '087-B3 el cuarto recibe 5 (no 8), ruta Cerrada, balance 20 = 12 + 3 + 5');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(1);
SELECT t87_err(format('SELECT revertir_merma(%s)', (t87_j('Bm1') -> 'registradas' -> 0 ->> 'id')), '087-B4 reverso de merma de ruta ya cerrada: rechazado', '55000', '%inventario del camión cerrado%');
ROLLBACK;

\echo '── 087 C: no-entrega deja el producto en el camión'
INSERT INTO t87_ids VALUES ('C0', t87_huella()), ('Ccf', t87_cf('CF-87A', 'P87-A')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(12);
INSERT INTO t87_ids VALUES ('Cn', registrar_no_entrega('87000000-0000-0000-0000-0000000000e1', 8723, 'Local cerrado', true)::text);
INSERT INTO t87_ids VALUES ('Cnr', registrar_no_entrega('87000000-0000-0000-0000-0000000000e1', 8723, 'Local cerrado', true)::text);
SELECT t87_err($q$SELECT registrar_no_entrega('87000000-0000-0000-0000-0000000000e2', 8723, 'Local cerrado')$q$, '087-C2 otra operación sobre orden ya No entregada: rechazada', '22023');
COMMIT;
SELECT t87_assert((t87_j('Cn') ->> 'replay') = 'false' AND (t87_j('Cnr') ->> 'replay') = 'true' AND (t87_j('Cn') -> 'devuelto') = '[]'::jsonb AND (t87_j('Cn') -> 'en_camion') = '[{"sku": "P87-A", "cantidad": 5}]'::jsonb
  AND (SELECT estatus = 'No entregada' AND reagendada FROM ordenes WHERE id = 8723), '087-C1 no-entrega: orden No entregada, resultado sin cuarto (devuelto []), producto en el camión; replay');
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = t87_v('Ccf')::int AND (SELECT count(*) = 0 FROM inventario_mov WHERE ruta_id = 8703 AND referencia LIKE 'no_entrega/%')
  AND (SELECT count(*) = 1 FROM stock_operaciones WHERE orden_id = 8723 AND tipo = 'no_entrega') AND t87_rest(8703, 'P87-A') = 20, '087-C3 cuarto intacto, sin kardex de cuarto, evento idempotente registrado; el camión sigue con 20');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(12);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f3'::uuid, 8703, '[{"ordenId": 8724, "pago": "Efectivo"}]'::jsonb, 8712, 'Chofer 87-12');
INSERT INTO t87_ids VALUES ('C1', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000c9', 8703, '{"P87-A": 10}')::text);
COMMIT;
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = t87_v('Ccf')::int + 10 AND (SELECT bool_and(restante = 0) AND sum(entregado) = 10 FROM balance_ruta_interno(8703)), '087-C4 el cierre devuelve el resto correcto (10 = 5 no entregadas + 5 sobrante)');

\echo '── 087 D: carga multi-cuarto del mismo SKU → devolución a los cuartos de origen'
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(19);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f4'::uuid, 8710, '[{"ordenId": 8727, "pago": "Efectivo"}]'::jsonb, 8719, 'Chofer 87-19');
INSERT INTO t87_ids VALUES ('D1', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000d1', 8710, '{"P87-D": 9}')::text);
COMMIT;
SELECT t87_assert(t87_cf('CF-87B', 'P87-D') = 10 AND t87_cf('CF-87A', 'P87-D') = 2
  AND (t87_j('D1') -> 'asignacion') = '[{"sku": "P87-D", "cantidad": 7, "cuarto_id": "CF-87B"}, {"sku": "P87-D", "cantidad": 2, "cuarto_id": "CF-87A"}]'::jsonb, '087-D1 origen reconstruido: 7 a CF-87B (salieron 7) y 2 a CF-87A, en orden inverso de la carga, nunca más de lo que salió de cada cuarto');

\echo '── 087 E: multi-SKU con venta exprés'
INSERT INTO t87_ids VALUES ('Ea', t87_cf('CF-87A', 'P87-A')::text), ('Eb', t87_cf('CF-87A', 'P87-B')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(14);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f5'::uuid, 8705, '[{"ordenId": 8726, "pago": "Efectivo"}, {"express": true, "pago": "Efectivo", "items": [{"sku": "P87-B", "cant": 2, "precio": 30}]}]'::jsonb, 8714, 'Chofer 87-14');
INSERT INTO t87_ids VALUES ('E1', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000e9', 8705, '{"P87-A": 6, "P87-B": 4}')::text);
COMMIT;
SELECT t87_assert(t87_cf('CF-87A', 'P87-A') = t87_v('Ea')::int + 6 AND t87_cf('CF-87A', 'P87-B') = t87_v('Eb')::int + 4 AND (SELECT count(*) = 2 AND bool_and(restante = 0) FROM balance_ruta_interno(8705)), '087-E1 dos SKU: A 10 = 4 + 6, B 6 = 2 exprés + 4');

\echo '── 087 F/G: conteo físico distinto del balance'
INSERT INTO t87_ids VALUES ('F0', t87_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(15);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-0000000000f6'::uuid, 8706, '[]'::jsonb, 8715, 'Chofer 87-15');
COMMIT;
INSERT INTO t87_ids VALUES ('F1', t87_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(15);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-A": 11}')$q$, '087-G1 conteo mayor al balance: rechazado', '22023', '%supera el inventario del camión%');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-A": 10, "P87-B": 1}')$q$, '087-G2 SKU no cargado en el conteo: rechazado', '22023', '%supera el inventario del camión%');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-ZZ": 1}')$q$, '087-G3 SKU desconocido en el conteo: rechazado', '22023', '%SKU no encontrado%');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-A": -1}')$q$, '087-G4 cantidad negativa: rechazada', '22023', '%cantidad inválida%');
INSERT INTO t87_ids VALUES ('Fgap', t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-A": 8}')$q$, '087-F1 conteo menor al balance: rechazado con faltante por SKU', '22023', '%faltante sin merma%'));
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{}')$q$, '087-F2 SKU cargado ausente del conteo = 0: rechazado', '22023', '%faltante sin merma%');
COMMIT;
SELECT t87_assert(t87_j('Fgap') = '{"faltante": {"P87-A": 2}}'::jsonb AND t87_huella() = t87_v('F1') AND (SELECT count(*) = 0 FROM mermas WHERE ruta_id = 8706), '087-F3 detalle estructurado {faltante: {P87-A: 2}}; nada cambió; no se creó merma automática');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(15);
SELECT registrar_mermas_ruta('87000000-0000-0000-0000-0000000000f8'::uuid, 8706, '[{"sku":"P87-A","cant":2,"causa":"Faltante al contar","foto":"data:image/jpeg;base64,CCCC"}]');
INSERT INTO t87_ids VALUES ('F2', finalizar_inventario_ruta('87000000-0000-0000-0000-0000000000f7', 8706, '{"P87-A": 8}')::text);
COMMIT;
SELECT t87_assert((t87_j('F2') ->> 'estatus') = 'Cerrada' AND (SELECT bool_and(restante = 0) AND sum(merma) = 2 AND sum(devuelto) = 8 FROM balance_ruta_interno(8706)), '087-F4 tras declarar la merma del faltante, la misma operación finaliza: 10 = 0 + 2 + 8');

\echo '── 087 H: ventas exprés inválidas → falla cerrado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(16);
DO $do$ BEGIN
  IF to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NOT NULL THEN
    -- 088: el SKU fuera de catálogo ya se rechaza en el cierre financiero,
    -- antes de cualquier efecto; la ruta queda sin exprés ni marca.
    PERFORM t87_err($q$SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-00000000001a'::uuid, 8707, '[{"express": true, "pago": "Efectivo", "items": [{"sku": "P87-ZZ", "cant": 1, "precio": 30}]}]'::jsonb, 8716, 'x')$q$, '087-H1 (088) exprés con SKU fuera de catálogo rechazada en el cierre financiero', '22023');
    RESET ROLE;
    PERFORM t87_assert(NOT EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = 8707) AND NOT EXISTS (SELECT 1 FROM ordenes WHERE ruta_id = 8707), '087-H2 (088) sin venta exprés ni marca de cierre');
  ELSE
    PERFORM cerrar_ruta_financiero('87000000-0000-0000-0000-00000000001a'::uuid, 8707, '[{"express": true, "pago": "Efectivo", "items": [{"sku": "P87-ZZ", "cant": 1, "precio": 30}]}]'::jsonb, 8716, 'x');
    PERFORM t87_err($q$SELECT * FROM calcular_balance_ruta(8707)$q$, '087-H1 exprés con SKU fuera de catálogo: balance falla cerrado', 'P0001', '%no existe en el catálogo%');
    PERFORM t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000009a', 8707, '{"P87-A": 5}')$q$, '087-H2 y la finalización también', 'P0001', '%no existe en el catálogo%');
  END IF;
END $do$;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(17);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-00000000002a'::uuid, 8708, '[{"express": true, "pago": "Efectivo", "items": [{"sku": "P87-B", "cant": 1, "precio": 30}]}]'::jsonb, 8717, 'x');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000008a', 8708, '{"P87-A": 5}')$q$, '087-H3 exprés con SKU válido no cargado: falla cerrado', 'P0001', '%no fue cargado%');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(18);
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-00000000003a'::uuid, 8709, '[{"express": true, "pago": "Efectivo", "items": [{"sku": "P87-A", "cant": 7, "precio": 30}]}]'::jsonb, 8718, 'x');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000007a', 8709, '{}')$q$, '087-H4 exprés por encima de lo cargado: falla cerrado', 'P0001', '%supera lo cargado%');
SELECT t87_err($q$SELECT registrar_merma('P87-A', 1, 'x', NULL, NULL, 8709)$q$, '087-H5 tampoco se registran mermas sobre un balance inconsistente', 'P0001', '%supera lo cargado%');
COMMIT;
SELECT t87_assert((SELECT count(*) = 3 FROM rutas WHERE id IN (8707, 8708, 8709) AND estatus = 'En progreso') AND (SELECT count(*) = 0 FROM stock_operaciones WHERE ruta_id IN (8707, 8708, 8709) AND tipo = 'cierre_ruta'), '087-H6 las tres rutas siguen abiertas, sin devolución');

\echo '── 087 K/L: Admin — cierre canónico, sin cierre ni cancelación directos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(1);
SELECT t87_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8704$q$, '087-K1 Admin: cierre directo de ruta cargada por REST denegado', '42501');
SELECT t87_err($q$UPDATE rutas SET devolucion = '{"P87-A": 99}' WHERE id = 8704$q$, '087-K2 Admin: rutas.devolucion arbitraria denegada', '42501');
SELECT t87_err($q$UPDATE rutas SET estatus = 'Cancelada', cancelada_at = now(), motivo_cancelacion = 'x' WHERE id = 8704$q$, '087-L1 Admin: cancelación de ruta cargada denegada (no hay sobre-devolución)', '42501');
SELECT t87_err($q$UPDATE rutas SET carga_confirmada_at = NULL WHERE id = 8704$q$, '087-L2 Admin: la confirmación de carga no se borra', '42501');
SELECT t87_assert(t87_rows($q$UPDATE rutas SET estatus = 'Cancelada', cancelada_at = now(), motivo_cancelacion = 'Prueba 87' WHERE id = 8791$q$) = 1, '087-L3 Admin: ruta nunca cargada se cancela normal');
SELECT cerrar_ruta_financiero('87000000-0000-0000-0000-00000000002b'::uuid, 8704, '[]'::jsonb, 8701, 'Admin 87');
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000001b', 8704, '{"P87-A": 7}')$q$, '087-K3 órdenes pendientes: rechazado', '22023', '%órdenes pendientes%');
UPDATE ordenes SET estatus = 'No entregada', motivo_no_entrega = 'Cierre forzado por admin: prueba', fecha_no_entrega = now() WHERE id = 8725;
INSERT INTO t87_ids VALUES ('K1', finalizar_inventario_ruta('87000000-0000-0000-0000-00000000001b', 8704, '{"P87-A": 10}')::text);
COMMIT;
SELECT t87_assert((t87_j('K1') ->> 'actor') = 'Admin 87' AND (SELECT estatus = 'Cerrada' FROM rutas WHERE id = 8704) AND (SELECT bool_and(restante = 0) AND sum(devuelto) = 10 FROM balance_ruta_interno(8704)), '087-K4 Admin: cierre canónico (pendiente → No entregada, cierre financiero, conteo = balance 10)');

\echo '── 087: otras precondiciones de la finalización'
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(20);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000001c', 8791, '{}')$q$, '087-P1 ruta no En progreso: rechazado', '22023', '%se requiere En progreso%');
SELECT t87_err($q$SELECT finalizar_inventario_ruta(NULL, 8791, '{}')$q$, '087-P2 operación obligatoria', '22023');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(11);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000003c', 8707, '{}')$q$, '087-P3 Chofer ajeno no finaliza', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(5);
SELECT t87_err($q$SELECT finalizar_inventario_ruta('87000000-0000-0000-0000-00000000004c', 8707, '{}')$q$, '087-P4 Ventas no finaliza', '42501');
ROLLBACK;
-- 102/103: la merma de cuarto indica el cuarto (registrar_merma_cuarto) cuando existe.
CREATE OR REPLACE FUNCTION t87_merma_cuarto(p_cuarto TEXT, p_sku TEXT, p_cant INTEGER, p_causa TEXT, p_origen TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $mc$
DECLARE r JSONB;
BEGIN
  IF to_regprocedure('public.registrar_merma_cuarto(uuid,text,text,integer,text,text)') IS NULL THEN
    EXECUTE 'SELECT registrar_merma($1, $2, $3, $4)' INTO r USING p_sku, p_cant, p_causa, p_origen;
  ELSE
    EXECUTE 'SELECT registrar_merma_cuarto(gen_random_uuid(), $1, $2, $3, $4)' INTO r USING p_cuarto, p_sku, p_cant, p_causa;
  END IF;
  RETURN r;
END $mc$;
GRANT EXECUTE ON FUNCTION t87_merma_cuarto(TEXT, TEXT, INTEGER, TEXT, TEXT) TO PUBLIC;
INSERT INTO t87_ids VALUES ('R0', t87_cf('CF-87A', 'P87-B')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(2);
SELECT t87_err($q$SELECT registrar_mermas_ruta('87000000-0000-0000-0000-00000000005c'::uuid, 8707, '[{"sku":"P87-A","cant":1}]')$q$, '087-P5 Producción no registra lotes de ruta', '42501');
INSERT INTO t87_ids VALUES ('R1', t87_merma_cuarto('CF-87A', 'P87-B', 1, 'Bolsa rota', 'Prod 87')::text);
ROLLBACK;
SELECT t87_assert(t87_cf('CF-87A', 'P87-B') = t87_v('R0')::int, '087-P6 (merma de cuarto en transacción revertida: sin efectos persistidos)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t87_actor(2);
INSERT INTO t87_ids VALUES ('R2', t87_merma_cuarto('CF-87A', 'P87-B', 1, 'Bolsa rota', 'Prod 87')::text);
COMMIT;
SELECT t87_assert(t87_cf('CF-87A', 'P87-B') = t87_v('R0')::int - 1 AND (SELECT count(*) = 1 FROM mermas_efectos WHERE merma_id = (t87_j('R2') ->> 'id')::bigint) AND (t87_j('R2') ->> 'inventario') = 'cuarto', '087-P7 merma de cuarto (Producción, sin ruta): FIFO de 072 intacto, con efectos');

\echo '── 087: invariante global de rutas cerradas'
SELECT t87_assert((SELECT bool_and(COALESCE((SELECT bool_and(b.restante = 0) FROM balance_ruta_interno(r.id) b), true)) FROM rutas r WHERE r.id BETWEEN 8701 AND 8710 AND r.estatus = 'Cerrada')
  AND (SELECT count(*) = 7 FROM rutas WHERE id BETWEEN 8701 AND 8710 AND estatus = 'Cerrada'), '087-Z1 las 7 rutas cerradas: CARGADO = ENTREGADO + MERMA ACTIVA + DEVUELTO');
SELECT t87_assert((SELECT count(*) = 7 FROM stock_operaciones WHERE ruta_id BETWEEN 8701 AND 8710 AND tipo = 'cierre_ruta') AND (SELECT count(*) = 0 FROM (SELECT ruta_id FROM stock_operaciones WHERE tipo = 'cierre_ruta' AND ruta_id BETWEEN 8701 AND 8799 GROUP BY 1 HAVING count(*) > 1) x), '087-Z2 exactamente una finalización por ruta');

BEGIN; SELECT t87_limpiar(); COMMIT;
\echo '── 087: TODAS LAS PRUEBAS OK'
