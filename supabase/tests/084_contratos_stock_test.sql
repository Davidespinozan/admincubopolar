-- 084_contratos_stock_test.sql — R2 fase 1 (aditiva): contratos de stock.
-- Estado físico, denegaciones con huella intacta, carga atómica con
-- asignación FIFO por cuarto (paridad con calcularChangesInventario),
-- idempotencia por operación y por ancla de negocio, no-entrega atómica,
-- salida manual y traspaso, kardex estructurado, legacy intacto.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'P84-%';
DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '84000000-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8420 AND 8429;
DELETE FROM ordenes WHERE id BETWEEN 8420 AND 8429;
DELETE FROM rutas WHERE id BETWEEN 8401 AND 8419;
DELETE FROM clientes WHERE id = 8410;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-84%';
UPDATE cuartos_frios SET stock = stock - 'P84-A' - 'P84-B' - 'P84-C' WHERE stock ?| ARRAY['P84-A', 'P84-B', 'P84-C']; -- la no-entrega devuelve al primer cuarto por id
DELETE FROM productos WHERE sku LIKE 'P84-%';
DELETE FROM usuarios WHERE id BETWEEN 8401 AND 8419;
DELETE FROM auth.users WHERE id::text LIKE '84000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('84000000-0000-0000-0000-000000000001', 'admin84@t'),   ('84000000-0000-0000-0000-000000000002', 'prod84@t'),
  ('84000000-0000-0000-0000-000000000003', 'chofera84@t'), ('84000000-0000-0000-0000-000000000004', 'choferb84@t'),
  ('84000000-0000-0000-0000-000000000005', 'ventas84@t'),  ('84000000-0000-0000-0000-000000000006', 'bolsas84@t'),
  ('84000000-0000-0000-0000-000000000099', 'noprof84@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8401, 'Admin 84',   'admin84@t',   'Admin',          'Activo', '84000000-0000-0000-0000-000000000001'),
  (8402, 'Prod 84',    'prod84@t',    'Producción',     'Activo', '84000000-0000-0000-0000-000000000002'),
  (8403, 'Chofer A84', 'chofera84@t', 'Chofer',         'Activo', '84000000-0000-0000-0000-000000000003'),
  (8404, 'Chofer B84', 'choferb84@t', 'Chofer',         'Activo', '84000000-0000-0000-0000-000000000004'),
  (8405, 'Ventas 84',  'ventas84@t',  'Ventas',         'Activo', '84000000-0000-0000-0000-000000000005'),
  (8406, 'Bolsas 84',  'bolsas84@t',  'Almacén Bolsas', 'Activo', '84000000-0000-0000-0000-000000000006');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES
  ('P84-A', 'Hielo A84', 'Producto Terminado', 30, 0), ('P84-B', 'Hielo B84', 'Producto Terminado', 30, 0), ('P84-C', 'Hielo C84', 'Producto Terminado', 30, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-84A', 'Cuarto 84A', '{"P84-A": 5, "P84-B": 10}'), ('CF-84B', 'Cuarto 84B', '{"P84-A": 20, "P84-C": 3}'), ('CF-84C', 'Cuarto 84C', '{}');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8410, 'Cliente 84', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (8401, 'R-8401', 'Ruta A84',        8403, 'Chofer A84', 'Pendiente firma', CURRENT_DATE, '{"P84-A": 12, "P84-B": 4}', '{"P84-A": 10, "P84-B": 4}', '{"P84-A": 2}', '{"P84-A": 12, "P84-B": 4}', now()),
  (8402, 'R-8402', 'Ruta B84',        8404, 'Chofer B84', 'Pendiente firma', CURRENT_DATE, '{"P84-A": 20}', '{"P84-A": 20}', '{}', '{"P84-A": 20}', now()),
  (8403, 'R-8403', 'Ruta programada', NULL, NULL,         'Programada',      CURRENT_DATE, '{"P84-A": 1}', '{"P84-A": 1}', '{}', '{}', NULL),
  (8404, 'R-8404', 'Ruta excedida',   NULL, NULL,         'Pendiente firma', CURRENT_DATE, '{"P84-A": 5}', '{"P84-A": 5}', '{}', '{"P84-A": 30}', now()),
  (8405, 'R-8405', 'Ruta sku raro',   NULL, NULL,         'Pendiente firma', CURRENT_DATE, '{"P84-ZZ": 1}', '{"P84-ZZ": 1}', '{}', '{"P84-ZZ": 1}', now()),
  (8406, 'R-8406', 'Ruta producción', NULL, NULL,         'Pendiente firma', CURRENT_DATE, '{"P84-C": 2}', '{"P84-C": 2}', '{}', '{"P84-C": 2}', now()),
  (8407, 'R-8407', 'Ruta exacta',     NULL, NULL,         'Pendiente firma', CURRENT_DATE, '{"P84-B": 6}', '{"P84-B": 6}', '{}', '{"P84-B": 6}', now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8420, 'OV-8420', 8410, 'Cliente 84', '3×P84-A', 90, 'Asignada',  'Efectivo', 'Contado', 8405, 8401),
  (8421, 'OV-8421', 8410, 'Cliente 84', '2×P84-A', 60, 'Asignada',  'Efectivo', 'Contado', 8405, 8402),
  (8422, 'OV-8422', 8410, 'Cliente 84', '1×P84-A', 30, 'Entregada', 'Efectivo', 'Contado', 8405, 8401),
  (8423, 'OV-8423', 8410, 'Cliente 84', '1×P84-A', 30, 'Creada',    'Efectivo', 'Contado', 8405, NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8420, 'P84-A', 3, 30, 90), (8420, 'P84-B', 1, 30, 30), (8421, 'P84-A', 2, 30, 60), (8422, 'P84-A', 1, 30, 30), (8423, 'P84-A', 1, 30, 30);
COMMIT;

CREATE OR REPLACE FUNCTION t84_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t84_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t_p087() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION t_p087() TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t84_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t84_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t84_kardex(p_op UUID) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(string_agg(concat_ws(':', tipo, cuarto_id, producto, cantidad, ruta_id, referencia), ' ' ORDER BY cuarto_id, producto), '') FROM inventario_mov WHERE operacion_id = p_op
$$;
CREATE OR REPLACE FUNCTION t84_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(id || '=' || stock::text, ' ' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-84%'),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 8401 AND 8419),
    (SELECT string_agg(concat_ws(':', id, estatus, motivo_no_entrega, reagendada), ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 8420 AND 8429),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P84-%'),
    (SELECT count(*)::text FROM stock_operaciones WHERE operacion_id::text LIKE '84000000-%')))
$$;
DROP TABLE IF EXISTS t84_ids;
CREATE TEMP TABLE t84_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t84_ids TO anon, authenticated;
INSERT INTO t84_ids VALUES ('h0', t84_huella());
CREATE OR REPLACE FUNCTION t84_denegado(p_tag TEXT, p_ruta_ok BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000f1', 8401, 'firma')$q$, p_tag || ': confirmar_carga_ruta denegado', '42501');
  PERFORM t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000f2', 8420, 'Local cerrado')$q$, p_tag || ': registrar_no_entrega denegado', '42501');
  PERFORM t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000f3', 'CF-84B', 'P84-A', 1, 'Venta mostrador')$q$, p_tag || ': salida_cuarto_manual denegado', '42501');
  PERFORM t84_err($q$SELECT traspaso_cuartos('84000000-0000-0000-0000-0000000000f4', 'CF-84B', 'CF-84C', 'P84-A', 1)$q$, p_tag || ': traspaso_cuartos denegado', '42501');
END $$;
GRANT EXECUTE ON FUNCTION t84_denegado(TEXT, BOOLEAN) TO anon, authenticated;

\echo '── 084: estado físico'
SELECT t84_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stock_operaciones'::regclass) AND (SELECT string_agg(policyname, ',' ORDER BY policyname) = 'admin_all,read_all' FROM pg_policies WHERE tablename = 'stock_operaciones')
  AND NOT has_table_privilege('anon', 'public.stock_operaciones', 'SELECT') AND has_table_privilege('authenticated', 'public.stock_operaciones', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.stock_operaciones', 'INSERT'), '084-01 stock_operaciones: RLS, admin_all + read_all, anon sin acceso, authenticated solo lectura');
SELECT t84_assert((SELECT string_agg(column_name, ',' ORDER BY column_name) = 'cuarto_id,operacion_id,ruta_id' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventario_mov' AND column_name IN ('cuarto_id', 'ruta_id', 'operacion_id') AND is_nullable = 'YES')
  AND (SELECT count(*) = 3 FROM pg_constraint WHERE conrelid = 'public.inventario_mov'::regclass AND conname IN ('inventario_mov_cuarto_id_fkey', 'inventario_mov_ruta_id_fkey', 'inventario_mov_operacion_id_fkey') AND confdeltype = 'n'), '084-02 kardex: cuarto_id, ruta_id, operacion_id nullables con FK ON DELETE SET NULL');
SELECT t84_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
    AND has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE')) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('confirmar_carga_ruta', 'registrar_no_entrega', 'salida_cuarto_manual', 'traspaso_cuartos'))
  AND (SELECT count(*) = 4 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('confirmar_carga_ruta', 'registrar_no_entrega', 'salida_cuarto_manual', 'traspaso_cuartos')), '084-03 4 contratos: SECURITY DEFINER, search_path fijo, EXECUTE solo authenticated/service_role');
SELECT t84_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('stock_op_replay', 'stock_mov_cuarto')), '084-04 helpers internos sin EXECUTE para la API');
SELECT t84_assert((SELECT bool_and(pg_get_functiondef(oid) !~ 'update_stocks_atomic|fin_marcar_ctx|get_my_|auth\.jwt|email') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('confirmar_carga_ruta', 'registrar_no_entrega', 'salida_cuarto_manual', 'traspaso_cuartos', 'stock_mov_cuarto', 'stock_op_replay')), '084-05 sin llamada anidada al RPC genérico, sin fin_ctx ni identidad legacy');
-- 084-06: en fase 084 el RPC genérico y el guard 078 conservan el md5 de
-- producción; tras 085 (contención) cambian a propósito y se verifica que el
-- genérico exige Admin y el guard la marca app.carga_ctx. El guard 069 no cambia.
SELECT t84_assert((SELECT md5(pg_get_functiondef(oid)) = '99fb6cfe4933dc702e3531669b0c6ec3' FROM pg_proc WHERE oid = 'public.ordenes_guard_financiero()'::regprocedure)
  AND CASE WHEN pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]'
    THEN pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.carga_ctx'
    ELSE (SELECT md5(pg_get_functiondef(oid)) = '9bfe3e6327d081a39f467279ef654868' FROM pg_proc WHERE oid = 'public.update_stocks_atomic(jsonb)'::regprocedure)
     AND (SELECT md5(pg_get_functiondef(oid)) = 'd62cb42dadf2ec9519ae740eb2f6d28d' FROM pg_proc WHERE oid = 'public.rutas_guard_chofer()'::regprocedure) END,
  '084-06 guard 069 sin cambios; RPC genérico y guard 078 con md5 de producción (084) o contenidos (085)');
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Entrada', 'P84-C', 1, 'legacy insert 84', 'sql');
SELECT t84_assert((SELECT cuarto_id IS NULL AND ruta_id IS NULL AND operacion_id IS NULL FROM inventario_mov WHERE origen = 'legacy insert 84'), '084-07 INSERT legacy sin columnas nuevas sigue funcionando (fila no estructurada)');
DELETE FROM inventario_mov WHERE origen = 'legacy insert 84';

\echo '── 084: actores no autorizados — cero efectos'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('084-10 Ventas',         'ventas84@t',  '84000000-0000-0000-0000-000000000005'),
      ('084-11 Almacén Bolsas', 'bolsas84@t',  '84000000-0000-0000-0000-000000000006'),
      ('084-12 JWT sin perfil', 'noprof84@t',  '84000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t84_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t84_denegado(a.tag, false);
    RESET ROLE;
    PERFORM t84_assert(t84_huella() = (SELECT v FROM t84_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;
BEGIN; SET LOCAL ROLE anon; SELECT t84_actor('anon', NULL, NULL);
SELECT t84_denegado('084-13 anon', false);
SELECT t84_err($q$SELECT * FROM stock_operaciones$q$, '084-14 anon: sin acceso a stock_operaciones', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'choferb84@t', '84000000-0000-0000-0000-000000000004');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000f5', 8401, 'firma')$q$, '084-15 Chofer B: no firma la ruta de A', '42501');
SELECT t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000f6', 8420, 'Local cerrado')$q$, '084-16 Chofer B: no marca no-entrega de una orden de la ruta de A', '42501');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000f7', 'CF-84B', 'P84-A', 1, 'x')$q$, '084-17 Chofer: sin salida manual', '42501');
SELECT t84_err($q$SELECT traspaso_cuartos('84000000-0000-0000-0000-0000000000f8', 'CF-84B', 'CF-84C', 'P84-A', 1)$q$, '084-18 Chofer: sin traspaso', '42501');
ROLLBACK;
SELECT t84_assert(t84_huella() = (SELECT v FROM t84_ids WHERE k = 'h0'), '084-19 Chofer B / Chofer: cero efectos');

\echo '── 084: confirmar_carga_ruta — validaciones (todo o nada)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'chofera84@t', '84000000-0000-0000-0000-000000000003');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e1', 8401, NULL)$q$, '084-20 firma requerida cuando no es excepción', '22023');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e2', 8401, NULL, true, NULL)$q$, '084-21 excepción requiere motivo', '22023');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e3', 999999, 'firma')$q$, '084-22 ruta inexistente', '22023');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'admin84@t', '84000000-0000-0000-0000-000000000001');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e4', 8403, 'firma')$q$, '084-23 ruta Programada (sin solicitud) rechazada', '22023');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e5', 8404, 'firma')$q$, '084-24 carga_real > autorizado + extra rechazada', '22023');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000e6', 8405, 'firma')$q$, '084-25 SKU inexistente rechazado', '22023');
ROLLBACK;
SELECT t84_assert(t84_huella() = (SELECT v FROM t84_ids WHERE k = 'h0'), '084-26 validaciones fallidas: cero efectos (sin kardex, sin operación, cuartos intactos)');

\echo '── 084: confirmar_carga_ruta — Chofer A firma su ruta (paridad FIFO por cuarto)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'chofera84@t', '84000000-0000-0000-0000-000000000003');
INSERT INTO t84_ids VALUES ('c1', confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a1', 8401, 'data:image/png;base64,QQ==')::text);
INSERT INTO t84_ids VALUES ('c1r', confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a1', 8401, 'data:image/png;base64,QQ==')::text);
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a1', 8401, NULL, true, 'otro')$q$, '084-30 mismo operacion_id con otros datos → 23505', '23505');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a2', 8401, 'otra firma')$q$, '084-31 otro operacion_id sobre ruta ya confirmada → rechazado (ancla de negocio)', '22023');
COMMIT;
SELECT t84_assert(((SELECT v FROM t84_ids WHERE k = 'c1')::jsonb ->> 'replay') = 'false' AND ((SELECT v FROM t84_ids WHERE k = 'c1r')::jsonb ->> 'replay') = 'true'
  AND ((SELECT v FROM t84_ids WHERE k = 'c1')::jsonb -> 'asignacion') = ((SELECT v FROM t84_ids WHERE k = 'c1r')::jsonb -> 'asignacion'), '084-32 primera llamada = efecto; segunda = replay con el mismo resultado');
SELECT t84_assert(t84_cf('CF-84A', 'P84-A') = 0 AND t84_cf('CF-84B', 'P84-A') = 13 AND t84_cf('CF-84A', 'P84-B') = 6 AND t84_cf('CF-84B', 'P84-C') = 3, '084-33 asignación = algoritmo del cliente: P84-A 5 de CF-84A + 7 de CF-84B; P84-B 4 de CF-84A (20 → 13, 10 → 6)');
SELECT t84_assert(t84_kardex('84000000-0000-0000-0000-0000000000a1') = 'Salida:CF-84A:P84-A:5:8401:carga_ruta/R-8401 Salida:CF-84A:P84-B:4:8401:carga_ruta/R-8401 Salida:CF-84B:P84-A:7:8401:carga_ruta/R-8401', '084-34 kardex estructurado: 3 filas con cuarto, ruta, operación y referencia');
SELECT t84_assert((SELECT estatus = 'Cargada' AND carga_confirmada_at IS NOT NULL AND carga_confirmada_por::text = '8403' AND firma_carga IS NOT NULL AND NOT firma_excepcion AND firma_excepcion_motivo IS NULL FROM rutas WHERE id = 8401), '084-35 ruta Cargada, firmante = actor (Chofer A), sin excepción');
SELECT t84_assert((SELECT count(*) = 1 FROM stock_operaciones WHERE operacion_id = '84000000-0000-0000-0000-0000000000a1' AND tipo = 'carga_ruta' AND ruta_id = 8401 AND actor = 'Chofer A84' AND actor_id = 8403)
  AND (SELECT count(*) = 3 FROM inventario_mov WHERE operacion_id = '84000000-0000-0000-0000-0000000000a1' AND usuario = 'Chofer A84'), '084-36 una operación, 3 kardex, atribución real');

\echo '── 084: confirmar_carga_ruta — stock insuficiente revierte TODO'
INSERT INTO t84_ids VALUES ('hB', t84_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'choferb84@t', '84000000-0000-0000-0000-000000000004');
SELECT t84_err($q$SELECT confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a3', 8402, 'firma')$q$, '084-40 Chofer B: 20 P84-A con 13 disponibles → Inventario insuficiente', 'P0001');
COMMIT;
SELECT t84_assert(t84_huella() = (SELECT v FROM t84_ids WHERE k = 'hB') AND (SELECT estatus = 'Pendiente firma' AND carga_confirmada_at IS NULL FROM rutas WHERE id = 8402) AND t84_cf('CF-84B', 'P84-A') = 13, '084-41 nada cambió: sin descuento parcial, sin kardex, sin operación, ruta sigue Pendiente firma');

\echo '── 084: confirmar_carga_ruta — Producción/Admin firman en su dispositivo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'prod84@t', '84000000-0000-0000-0000-000000000002');
INSERT INTO t84_ids VALUES ('c2', confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a4', 8406, NULL, true, 'Producción sin celular')::text);
COMMIT;
SELECT t84_assert((SELECT estatus = 'Cargada' AND carga_confirmada_por::text = '8402' AND firma_excepcion AND firma_excepcion_motivo = 'Producción sin celular' AND firma_carga IS NULL FROM rutas WHERE id = 8406) AND t84_cf('CF-84B', 'P84-C') = 1, '084-42 Producción firma por excepción una ruta sin chofer: Cargada, firmante = Producción, P84-C 3 → 1');
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'admin84@t', '84000000-0000-0000-0000-000000000001');
INSERT INTO t84_ids VALUES ('c3', confirmar_carga_ruta('84000000-0000-0000-0000-0000000000a5', 8407, 'firma admin')::text);
COMMIT;
SELECT t84_assert(t84_cf('CF-84A', 'P84-B') = 0 AND (SELECT estatus = 'Cargada' AND carga_confirmada_por::text = '8401' FROM rutas WHERE id = 8407), '084-43 Admin firma carga exacta (6 de 6): cuarto a 0, nunca negativo');

\echo '── 084: registrar_no_entrega'
INSERT INTO t84_ids VALUES ('cf0', (SELECT id FROM cuartos_frios ORDER BY id LIMIT 1));
INSERT INTO t84_ids VALUES ('a0', t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-A')::text), ('b0', t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-B')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'chofera84@t', '84000000-0000-0000-0000-000000000003');
SELECT t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000b0', 8420, '')$q$, '084-50 motivo requerido', '22023');
SELECT t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000b0', 8422, 'Local cerrado')$q$, '084-51 orden Entregada no se marca', '22023');
SELECT t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000b0', 8423, 'Local cerrado')$q$, '084-52 orden sin ruta no se marca', '22023');
INSERT INTO t84_ids VALUES ('n1', registrar_no_entrega('84000000-0000-0000-0000-0000000000b1', 8420, 'Local cerrado', true)::text);
INSERT INTO t84_ids VALUES ('n1r', registrar_no_entrega('84000000-0000-0000-0000-0000000000b1', 8420, 'Local cerrado', true)::text);
SELECT t84_err($q$SELECT registrar_no_entrega('84000000-0000-0000-0000-0000000000b2', 8420, 'Local cerrado')$q$, '084-53 otro operacion_id sobre orden ya No entregada → rechazado (sin doble devolución)', '22023');
COMMIT;
SELECT t84_assert(((SELECT v FROM t84_ids WHERE k = 'n1r')::jsonb ->> 'replay') = 'true' AND ((SELECT v FROM t84_ids WHERE k = 'n1')::jsonb ->> 'replay') = 'false', '084-54 replay de no-entrega');
SELECT t84_assert((SELECT estatus = 'No entregada' AND motivo_no_entrega = 'Local cerrado' AND reagendada AND fecha_no_entrega IS NOT NULL AND ruta_id = 8401 FROM ordenes WHERE id = 8420), '084-55 orden No entregada con motivo/reagendar; ruta intacta');
SELECT t84_assert(CASE WHEN t_p087() THEN t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-A') = (SELECT v::int FROM t84_ids WHERE k = 'a0') AND t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-B') = (SELECT v::int FROM t84_ids WHERE k = 'b0')
  AND (SELECT count(*) = 0 FROM inventario_mov WHERE operacion_id = '84000000-0000-0000-0000-0000000000b1') AND ((SELECT v FROM t84_ids WHERE k = 'n1')::jsonb -> 'devuelto') = '[]'::jsonb
  AND jsonb_array_length((SELECT v FROM t84_ids WHERE k = 'n1')::jsonb -> 'en_camion') = 2
  ELSE t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-A') = (SELECT v::int FROM t84_ids WHERE k = 'a0') + 3 AND t84_cf((SELECT v FROM t84_ids WHERE k = 'cf0'), 'P84-B') = (SELECT v::int FROM t84_ids WHERE k = 'b0') + 1   AND (SELECT count(*) = 2 AND bool_and(cuarto_id = (SELECT v FROM t84_ids WHERE k = 'cf0') AND ruta_id = 8401 AND referencia = 'no_entrega/OV-8420' AND tipo = 'Devolución no entregada') FROM inventario_mov WHERE operacion_id = '84000000-0000-0000-0000-0000000000b1')   AND (SELECT sum(cantidad) = 4 FROM inventario_mov WHERE operacion_id = '84000000-0000-0000-0000-0000000000b1') END, '084-56 devolución = líneas completas (3 P84-A + 1 P84-B) al primer cuarto por id, kardex estructurado, una sola vez (087: sin cuarto, el producto sigue en el camión)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'admin84@t', '84000000-0000-0000-0000-000000000001');
INSERT INTO t84_ids VALUES ('n2', registrar_no_entrega('84000000-0000-0000-0000-0000000000b3', 8421, 'Cliente ausente')::text);
COMMIT;
SELECT t84_assert((SELECT estatus = 'No entregada' FROM ordenes WHERE id = 8421) AND ((SELECT v FROM t84_ids WHERE k = 'n2')::jsonb ->> 'actor') = 'Admin 84', '084-57 Admin marca no-entrega de cualquier ruta');

\echo '── 084: salida_cuarto_manual'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'prod84@t', '84000000-0000-0000-0000-000000000002');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c0', 'CF-84B', 'P84-A', 1, 'Carga a ruta')$q$, '084-60 motivo "Carga a ruta" rechazado (la carga la firma confirmar_carga_ruta)', '22023');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c0', 'CF-84B', 'P84-A', 0, 'Venta mostrador')$q$, '084-61 cantidad 0 rechazada', '22023');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c0', 'CF-84B', 'P84-A', 1, '')$q$, '084-62 motivo vacío rechazado', '22023');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c0', 'CF-84B', 'P84-ZZ', 1, 'Venta mostrador')$q$, '084-63 SKU inexistente rechazado (no crea llaves)', '22023');
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c0', 'CF-84B', 'P84-A', 99, 'Venta mostrador')$q$, '084-64 stock insuficiente rechazado', 'P0001');
INSERT INTO t84_ids VALUES ('s1', salida_cuarto_manual('84000000-0000-0000-0000-0000000000c1', 'CF-84B', 'P84-A', 3, 'Venta mostrador')::text);
INSERT INTO t84_ids VALUES ('s1r', salida_cuarto_manual('84000000-0000-0000-0000-0000000000c1', 'CF-84B', 'P84-A', 3, 'Venta mostrador')::text);
SELECT t84_err($q$SELECT salida_cuarto_manual('84000000-0000-0000-0000-0000000000c1', 'CF-84B', 'P84-A', 4, 'Venta mostrador')$q$, '084-65 mismo operacion_id con otra cantidad → 23505', '23505');
COMMIT;
SELECT t84_assert(t84_cf('CF-84B', 'P84-A') = 10 AND ((SELECT v FROM t84_ids WHERE k = 's1r')::jsonb ->> 'replay') = 'true' AND t84_kardex('84000000-0000-0000-0000-0000000000c1') = 'Salida:CF-84B:P84-A:3:salida_manual/CF-84B', '084-66 salida 13 → 10 una sola vez, kardex con cuarto y referencia');
SELECT t84_assert((SELECT stock ? 'P84-ZZ' = false FROM cuartos_frios WHERE id = 'CF-84B'), '084-67 ninguna llave de SKU inexistente en el cuarto');

\echo '── 084: traspaso_cuartos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'prod84@t', '84000000-0000-0000-0000-000000000002');
SELECT t84_err($q$SELECT traspaso_cuartos('84000000-0000-0000-0000-0000000000d0', 'CF-84B', 'CF-84B', 'P84-A', 1)$q$, '084-70 origen = destino rechazado', '22023');
SELECT t84_err($q$SELECT traspaso_cuartos('84000000-0000-0000-0000-0000000000d0', 'CF-84B', 'CF-NO', 'P84-A', 1)$q$, '084-71 destino inexistente rechazado', '22023');
SELECT t84_err($q$SELECT traspaso_cuartos('84000000-0000-0000-0000-0000000000d0', 'CF-84B', 'CF-84C', 'P84-A', 99)$q$, '084-72 stock insuficiente: rechazado sin efecto parcial', 'P0001');
INSERT INTO t84_ids VALUES ('t1', traspaso_cuartos('84000000-0000-0000-0000-0000000000d1', 'CF-84B', 'CF-84C', 'P84-A', 4)::text);
INSERT INTO t84_ids VALUES ('t1r', traspaso_cuartos('84000000-0000-0000-0000-0000000000d1', 'CF-84B', 'CF-84C', 'P84-A', 4)::text);
COMMIT;
SELECT t84_assert(t84_cf('CF-84B', 'P84-A') = 6 AND t84_cf('CF-84C', 'P84-A') = 4 AND ((SELECT v FROM t84_ids WHERE k = 't1r')::jsonb ->> 'replay') = 'true', '084-73 traspaso 10 → 6 / 0 → 4 una sola vez');
SELECT t84_assert(t84_kardex('84000000-0000-0000-0000-0000000000d1') = 'Traspaso salida:CF-84B:P84-A:4:traspaso/CF-84B>CF-84C Traspaso entrada:CF-84C:P84-A:4:traspaso/CF-84B>CF-84C', '084-74 dos filas de kardex bajo la misma operación: auditable como UN traspaso');
SELECT t84_assert((SELECT count(*) = 7 FROM stock_operaciones WHERE operacion_id::text LIKE '84000000-%') AND (SELECT count(*) = 0 FROM stock_operaciones WHERE operacion_id::text LIKE '84000000-0000-0000-0000-0000000000e%' OR operacion_id::text LIKE '84000000-0000-0000-0000-0000000000f%'), '084-75 solo las operaciones exitosas dejan fila (7); las fallidas ninguna');

\echo '── 084: 078 y el flujo viejo siguen vigentes'
BEGIN; SET LOCAL ROLE authenticated; SELECT t84_actor('authenticated', 'chofera84@t', '84000000-0000-0000-0000-000000000003');
SELECT t84_err($q$UPDATE rutas SET carga_autorizada = '{"P84-A": 999}' WHERE id = 8401$q$, '084-80 078: Chofer sigue sin tocar carga_autorizada', '42501');
DO $do$ BEGIN
  IF pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' THEN
    PERFORM t84_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-84C","sku":"P84-A","delta":-1}]'::jsonb)$q$, '084-82 (085) el Chofer ya no puede usar update_stocks_atomic', '42501');
  ELSE
    PERFORM t84_assert((SELECT update_stocks_atomic('[{"cuarto_id":"CF-84C","sku":"P84-A","delta":-1}]'::jsonb) ->> 'actor') = 'Chofer A84', '084-82 update_stocks_atomic sin cambios: el Chofer aún puede usarlo (contención en fase 3)');
  END IF;
END $do$;
ROLLBACK;

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'P84-%';
DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '84000000-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8420 AND 8429;
DELETE FROM ordenes WHERE id BETWEEN 8420 AND 8429;
DELETE FROM rutas WHERE id BETWEEN 8401 AND 8419;
DELETE FROM clientes WHERE id = 8410;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-84%';
UPDATE cuartos_frios SET stock = stock - 'P84-A' - 'P84-B' - 'P84-C' WHERE stock ?| ARRAY['P84-A', 'P84-B', 'P84-C']; -- la no-entrega devuelve al primer cuarto por id
DELETE FROM productos WHERE sku LIKE 'P84-%';
DELETE FROM usuarios WHERE id BETWEEN 8401 AND 8419;
DELETE FROM auth.users WHERE id::text LIKE '84000000-%';
COMMIT;
\echo '── 084: TODAS LAS PRUEBAS OK'
