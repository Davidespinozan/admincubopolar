-- 080_rpc_asignacion_test.sql — R1: las RPCs de asignación solo las ejecutan
-- actores activos autorizados; Ventas conserva únicamente Creada → Asignada
-- sin ruta; Admin conserva el despacho completo; denegaciones con cero
-- efectos; semántica de negocio y guard 078 intactos.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM auditoria WHERE detalle LIKE 'Orden #802%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8020 AND 8029;
DELETE FROM ordenes WHERE id BETWEEN 8020 AND 8029;
DELETE FROM rutas WHERE id BETWEEN 8001 AND 8009;
DELETE FROM clientes WHERE id = 8010;
DELETE FROM productos WHERE sku LIKE 'P80-%';
DELETE FROM usuarios WHERE id BETWEEN 8001 AND 8019;
DELETE FROM auth.users WHERE id::text LIKE '80000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('80000000-0000-0000-0000-000000000001', 'admin80@t'),    ('80000000-0000-0000-0000-000000000002', 'ventas80@t'),
  ('80000000-0000-0000-0000-000000000003', 'chofera80@t'),  ('80000000-0000-0000-0000-000000000004', 'choferb80@t'),
  ('80000000-0000-0000-0000-000000000005', 'prod80@t'),     ('80000000-0000-0000-0000-000000000006', 'bolsas80@t'),
  ('80000000-0000-0000-0000-000000000007', 'fact80@t'),     ('80000000-0000-0000-0000-000000000008', 'inadm80@t'),
  ('80000000-0000-0000-0000-000000000009', 'inventas80@t'), ('80000000-0000-0000-0000-000000000099', 'noprof80@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8001, 'Admin 80',    'admin80@t',    'Admin',          'Activo',   '80000000-0000-0000-0000-000000000001'),
  (8002, 'Ventas 80',   'ventas80@t',   'Ventas',         'Activo',   '80000000-0000-0000-0000-000000000002'),
  (8003, 'Chofer A80',  'chofera80@t',  'Chofer',         'Activo',   '80000000-0000-0000-0000-000000000003'),
  (8004, 'Chofer B80',  'choferb80@t',  'Chofer',         'Activo',   '80000000-0000-0000-0000-000000000004'),
  (8005, 'Prod 80',     'prod80@t',     'Producción',     'Activo',   '80000000-0000-0000-0000-000000000005'),
  (8006, 'Bolsas 80',   'bolsas80@t',   'Almacén Bolsas', 'Activo',   '80000000-0000-0000-0000-000000000006'),
  (8007, 'Fact 80',     'fact80@t',     'Facturación',    'Activo',   '80000000-0000-0000-0000-000000000007'),
  (8008, 'InAdmin 80',  'inadm80@t',    'Admin',          'Inactivo', '80000000-0000-0000-0000-000000000008'),
  (8009, 'InVentas 80', 'inventas80@t', 'Ventas',         'Inactivo', '80000000-0000-0000-0000-000000000009');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P80-HIELO', 'Hielo 80', 'Producto Terminado', 30, 10);
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8010, 'Cliente 80', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado) VALUES
  (8001, 'R-8001', 'Ruta A80',   8003, 'Chofer A80', 'En progreso', CURRENT_DATE, '{}', '{}', '{}'),
  (8002, 'R-8002', 'Ruta B80',   8004, 'Chofer B80', 'Programada',  CURRENT_DATE, '{"P80-HIELO": 2}', '{"P80-HIELO": 2}', '{}'),
  (8003, 'R-8003', 'Ruta libre', NULL, NULL,         'Programada',  CURRENT_DATE, '{}', '{}', '{}'),
  (8004, 'R-8004', 'Ruta vieja', NULL, NULL,         'Cerrada',     CURRENT_DATE - 1, '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8020, 'OV-8020', 8010, 'Cliente 80', '1×P80-HIELO', 30, 'Creada',    'Efectivo', 'Contado', 8002, NULL),
  (8021, 'OV-8021', 8010, 'Cliente 80', '1×P80-HIELO', 30, 'Creada',    'Efectivo', 'Contado', 8002, NULL),
  (8022, 'OV-8022', 8010, 'Cliente 80', '3×P80-HIELO', 90, 'Creada',    'Efectivo', 'Contado', 8002, NULL),
  (8023, 'OV-8023', 8010, 'Cliente 80', '2×P80-HIELO', 60, 'Asignada',  'Efectivo', 'Contado', 8002, 8002),
  (8024, 'OV-8024', 8010, 'Cliente 80', '1×P80-HIELO', 30, 'Entregada', 'Efectivo', 'Contado', 8002, 8001);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8020, 'P80-HIELO', 1, 30, 30), (8021, 'P80-HIELO', 1, 30, 30), (8022, 'P80-HIELO', 3, 30, 90), (8023, 'P80-HIELO', 2, 30, 60), (8024, 'P80-HIELO', 1, 30, 30);
COMMIT;

CREATE OR REPLACE FUNCTION t80_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t80_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t80_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t80_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t80_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', id, estatus, ruta_id, vendedor_id, total), ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 8020 AND 8029),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 8001 AND 8009),
    (SELECT count(*)::text FROM auditoria WHERE detalle LIKE 'Orden #802%'),
    (SELECT stock::text FROM productos WHERE sku = 'P80-HIELO')))
$$;
CREATE OR REPLACE FUNCTION t80_orden(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus || '/' || COALESCE(ruta_id::text, 'NULL') FROM ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t80_carga(p_id BIGINT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$ SELECT carga FROM rutas WHERE id = p_id $$;
DROP TABLE IF EXISTS t80_ids;
CREATE TEMP TABLE t80_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t80_ids TO anon, authenticated;
INSERT INTO t80_ids VALUES ('h0', t80_huella());

-- Todo lo que un actor NO autorizado podría intentar con las tres RPCs.
CREATE OR REPLACE FUNCTION t80_denegado(p_tag TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t80_err($q$SELECT asignar_orden(8020, NULL, 8001)$q$,                 p_tag || ': asignar_orden sin ruta denegado', '42501');
  PERFORM t80_err($q$SELECT asignar_orden(8020, 8001, 8001)$q$,                 p_tag || ': asignar_orden a ruta ajena denegado', '42501');
  PERFORM t80_err($q$SELECT asignar_orden(8020, 8003, 8001)$q$,                 p_tag || ': asignar_orden a ruta libre denegado', '42501');
  PERFORM t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[8021]::bigint[])$q$, p_tag || ': asignar_ordenes_a_ruta (ruta libre) denegado', '42501');
  PERFORM t80_err($q$SELECT asignar_ordenes_a_ruta(8002, ARRAY[8021]::bigint[])$q$, p_tag || ': asignar_ordenes_a_ruta (ruta de B) denegado', '42501');
  PERFORM t80_err($q$SELECT asignar_ordenes_a_ruta(8001, ARRAY[8021]::bigint[])$q$, p_tag || ': asignar_ordenes_a_ruta (ruta de A) denegado', '42501');
  PERFORM t80_err($q$SELECT cancelar_orden_asignada(8023, 8001)$q$,             p_tag || ': cancelar_orden_asignada denegado', '42501');
END $$;
GRANT EXECUTE ON FUNCTION t80_denegado(TEXT) TO anon, authenticated;

\echo '── 080: estado físico'
SELECT t80_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp'
  AND NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  AND has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE'))
  FROM pg_proc WHERE oid IN ('public.asignar_orden(bigint,bigint,bigint)'::regprocedure, 'public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure, 'public.cancelar_orden_asignada(bigint,bigint)'::regprocedure)), '080-01 las 3 RPCs: SECURITY DEFINER, search_path fijo, sin EXECUTE para PUBLIC/anon, con EXECUTE para authenticated/service_role');
SELECT t80_assert(pg_get_functiondef('public.asignar_orden(bigint,bigint,bigint)'::regprocedure) ~ 'fin_actor_permitido\(ARRAY\[''Admin'', ''Ventas''\]\)'
  AND pg_get_functiondef('public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure) ~ 'fin_actor_permitido\(ARRAY\[''Admin''\]\)'
  AND pg_get_functiondef('public.cancelar_orden_asignada(bigint,bigint)'::regprocedure) ~ 'fin_actor_permitido\(ARRAY\[''Admin''\]\)', '080-02 comprobaciones de actor canónico presentes');
SELECT t80_assert((SELECT bool_and(pg_get_functiondef(oid) !~ 'get_my_|auth\.jwt|email|fin_marcar_ctx') FROM pg_proc WHERE oid IN ('public.asignar_orden(bigint,bigint,bigint)'::regprocedure, 'public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure, 'public.cancelar_orden_asignada(bigint,bigint)'::regprocedure)), '080-03 sin identidad legacy/email ni bypass por contexto');
SELECT t80_assert((SELECT pg_get_function_result(oid) = 'void' FROM pg_proc WHERE oid = 'public.asignar_orden(bigint,bigint,bigint)'::regprocedure) AND (SELECT pg_get_function_result(oid) = 'jsonb' FROM pg_proc WHERE oid = 'public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure) AND (SELECT pg_get_function_result(oid) = 'void' FROM pg_proc WHERE oid = 'public.cancelar_orden_asignada(bigint,bigint)'::regprocedure), '080-04 firmas y tipos de retorno conservados');
SELECT t80_assert((SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.rutas'::regclass AND tgname = 'trg_rutas_guard_chofer') AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_financiero'), '080-05 guards 069 (ordenes) y 078 (rutas) presentes');

\echo '── 080: actores no autorizados — cero efectos'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('080-10 Chofer A',        'chofera80@t',  '80000000-0000-0000-0000-000000000003'),
      ('080-11 Chofer B',        'choferb80@t',  '80000000-0000-0000-0000-000000000004'),
      ('080-12 Producción',      'prod80@t',     '80000000-0000-0000-0000-000000000005'),
      ('080-13 Almacén Bolsas',  'bolsas80@t',   '80000000-0000-0000-0000-000000000006'),
      ('080-14 Facturación',     'fact80@t',     '80000000-0000-0000-0000-000000000007'),
      ('080-15 Admin INACTIVO',  'inadm80@t',    '80000000-0000-0000-0000-000000000008'),
      ('080-16 Ventas INACTIVO', 'inventas80@t', '80000000-0000-0000-0000-000000000009'),
      ('080-17 JWT sin perfil',  'noprof80@t',   '80000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t80_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t80_denegado(a.tag);
    RESET ROLE;
    PERFORM t80_assert(t80_huella() = (SELECT v FROM t80_ids WHERE k = 'h0'), a.tag || ': cero efectos (órdenes, rutas, carga, auditoría)');
  END LOOP;
END $$;
BEGIN; SET LOCAL ROLE anon; SELECT t80_actor('anon', NULL, NULL);
SELECT t80_err($q$SELECT asignar_orden(8020, NULL, 8001)$q$, '080-18 anon: sin EXECUTE en asignar_orden', '42501');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[8021]::bigint[])$q$, '080-19 anon: sin EXECUTE en asignar_ordenes_a_ruta', '42501');
SELECT t80_err($q$SELECT cancelar_orden_asignada(8023, 8001)$q$, '080-20 anon: sin EXECUTE en cancelar_orden_asignada', '42501');
ROLLBACK;
SELECT t80_assert(t80_huella() = (SELECT v FROM t80_ids WHERE k = 'h0'), '080-21 anon: cero efectos');

\echo '── 080: frontera de Ventas'
BEGIN; SET LOCAL ROLE authenticated; SELECT t80_actor('authenticated', 'ventas80@t', '80000000-0000-0000-0000-000000000002');
SELECT t80_err($q$SELECT asignar_orden(8020, 8001, 8002)$q$, '080-30 Ventas: asignar a ruta concreta (de A) denegado', '42501');
SELECT t80_err($q$SELECT asignar_orden(8020, 8003, 8002)$q$, '080-31 Ventas: asignar a ruta libre denegado', '42501');
SELECT t80_err($q$SELECT asignar_orden(8020, 8001, 8001)$q$, '080-32 Ventas: p_usuario_id de Admin no cambia la autorización', '42501');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[8020, 8021]::bigint[])$q$, '080-33 Ventas: asignación por lote denegada', '42501');
SELECT t80_err($q$SELECT cancelar_orden_asignada(8023, 8002)$q$, '080-34 Ventas: cancelar asignación denegado', '42501');
SELECT t80_assert(t80_huella() = (SELECT v FROM t80_ids WHERE k = 'h0'), '080-35 Ventas: cero efectos hasta aquí');
SELECT asignar_orden(8020, NULL, 8002);
SELECT t80_assert(t80_orden(8020) = 'Asignada/NULL', '080-36 Ventas: Creada → Asignada sin ruta (flujo "Enviar a ruta") PASS');
SELECT asignar_orden(8020, NULL, 8002);
SELECT t80_assert(t80_orden(8020) = 'Asignada/NULL', '080-37 Ventas: repetir la marca es inofensivo (Asignada → Asignada)');
SELECT t80_err($q$SELECT asignar_orden(8024, NULL, 8002)$q$, '080-38 Ventas: orden Entregada no vuelve a Asignada (guard 069)', '42501');
SELECT t80_err($q$SELECT asignar_orden(8023, NULL, 8002)$q$, '080-39 Ventas: no desasigna una orden ya en ruta (ruta_id solo Admin)', '42501');
ROLLBACK;
SELECT t80_assert(t80_huella() = (SELECT v FROM t80_ids WHERE k = 'h0'), '080-40 Ventas: todo revertido');

\echo '── 080: 078 intacto — ningún actor denegado reescribe rutas.carga'
SELECT t80_assert(t80_carga(8003) = '{}'::jsonb AND t80_carga(8002) = '{"P80-HIELO": 2}'::jsonb AND t80_carga(8001) = '{}'::jsonb, '080-41 cargas de las rutas intactas tras la matriz');
BEGIN; SET LOCAL ROLE authenticated; SELECT t80_actor('authenticated', 'chofera80@t', '80000000-0000-0000-0000-000000000003');
SELECT t80_err($q$UPDATE rutas SET carga = '{"P80-HIELO": 99}' WHERE id = 8001$q$, '080-42 Chofer A: carga directa sigue bloqueada por 078', '42501');
SELECT t80_assert(t80_rows($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8001$q$) = 1, '080-43 Chofer A: su flujo 078 sigue funcionando');
ROLLBACK;

\echo '── 080: Admin — despacho completo intacto'
BEGIN; SET LOCAL ROLE authenticated; SELECT t80_actor('authenticated', 'admin80@t', '80000000-0000-0000-0000-000000000001');
SELECT asignar_orden(8020, NULL, 8001);
SELECT t80_assert(t80_orden(8020) = 'Asignada/NULL', '080-50 Admin: asignar_orden sin ruta (OrdenesView)');
SELECT asignar_orden(8021, 8001, 8001);
SELECT t80_assert(t80_orden(8021) = 'Asignada/8001', '080-51 Admin: asignar_orden a ruta concreta');
INSERT INTO t80_ids VALUES ('r1', asignar_ordenes_a_ruta(8003, ARRAY[8022]::bigint[])::text);
SELECT t80_assert(t80_orden(8022) = 'Asignada/8003' AND t80_carga(8003) = '{"P80-HIELO": 3}'::jsonb AND ((SELECT v FROM t80_ids WHERE k = 'r1')::jsonb ->> 'ordenes_asignadas') = '1', '080-52 Admin: asignar_ordenes_a_ruta asigna y recalcula carga; retorno intacto');
INSERT INTO t80_ids VALUES ('r2', asignar_ordenes_a_ruta(8003, ARRAY[8022]::bigint[])::text);
SELECT t80_assert(((SELECT v FROM t80_ids WHERE k = 'r2')::jsonb ->> 'ordenes_asignadas') = '0' AND t80_carga(8003) = '{"P80-HIELO": 3}'::jsonb, '080-53 Admin: reintento idempotente');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8004, ARRAY[8020]::bigint[])$q$, '080-54 Admin: ruta cerrada rechazada (validación original)', 'P0001');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[8024]::bigint[])$q$, '080-55 Admin: orden Entregada no asignable (validación original)', 'P0001');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[8023]::bigint[])$q$, '080-56 Admin: orden ya en otra ruta no asignable (validación original)', 'P0001');
SELECT t80_err($q$SELECT asignar_ordenes_a_ruta(8003, ARRAY[999999]::bigint[])$q$, '080-57 Admin: orden inexistente rechazada', 'P0001');
SELECT cancelar_orden_asignada(8023, 8001);
SELECT t80_assert(t80_orden(8023) = 'Creada/NULL', '080-58 Admin: cancelar asignación devuelve la orden a Creada sin ruta');
SELECT cancelar_orden_asignada(8024, 8001);
SELECT t80_assert(t80_orden(8024) = 'Entregada/8001', '080-59 Admin: cancelar sobre orden no Asignada no cambia nada (comportamiento original)');
SELECT t80_assert((SELECT count(*) = 4 FROM auditoria WHERE detalle LIKE 'Orden #802%' AND usuario = '8001'), '080-60 auditoría de las 4 llamadas con INSERT en auditoria con la atribución enviada (p_usuario_id forense, no autoriza)');
SELECT asignar_orden(8021, 8002, 9999);
SELECT t80_assert(t80_orden(8021) = 'Asignada/8002' AND (SELECT count(*) = 1 FROM auditoria WHERE detalle = 'Orden #8021' AND usuario = '9999'), '080-61 p_usuario_id sigue siendo atribución libre (registrado; limpieza en fase propia)');
ROLLBACK;
SELECT t80_assert(t80_huella() = (SELECT v FROM t80_ids WHERE k = 'h0'), '080-62 Admin: todo revertido, huella intacta');
SELECT asignar_ordenes_a_ruta(8003, ARRAY[8020]::bigint[]);
SELECT t80_assert(t80_orden(8020) = 'Asignada/8003' AND t80_carga(8003) = '{"P80-HIELO": 1}'::jsonb, '080-63 SQL sin JWT (service_role/cron): sin restricción');
UPDATE ordenes SET estatus = 'Creada', ruta_id = NULL WHERE id = 8020; UPDATE rutas SET carga = '{}' WHERE id = 8003; DELETE FROM auditoria WHERE detalle LIKE 'Orden #802%';

\echo '── 080: deuda documentada (fuera de 080)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t80_actor('authenticated', 'ventas80@t', '80000000-0000-0000-0000-000000000002');
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_ruta') THEN
    PERFORM t80_err($q$UPDATE ordenes SET estatus = 'Asignada', ruta_id = 8001 WHERE id = 8021$q$, '080-70 Ventas: ruta concreta por UPDATE directo rechazada (R1b cerrado por 081)', '42501');
  ELSE
    PERFORM t80_assert(t80_rows($q$UPDATE ordenes SET estatus = 'Asignada', ruta_id = 8001 WHERE id = 8021$q$) = 1, '080-70 Ventas aún puede poner una orden Creada en una ruta concreta por UPDATE directo (policy ventas_update + guard 069) → residual R1b, se cierra en 081');
  END IF;
END $do$;
ROLLBACK;

BEGIN;
DELETE FROM auditoria WHERE detalle LIKE 'Orden #802%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8020 AND 8029;
DELETE FROM ordenes WHERE id BETWEEN 8020 AND 8029;
DELETE FROM rutas WHERE id BETWEEN 8001 AND 8009;
DELETE FROM clientes WHERE id = 8010;
DELETE FROM productos WHERE sku LIKE 'P80-%';
DELETE FROM usuarios WHERE id BETWEEN 8001 AND 8019;
DELETE FROM auth.users WHERE id::text LIKE '80000000-%';
COMMIT;
\echo '── 080: TODAS LAS PRUEBAS OK'
