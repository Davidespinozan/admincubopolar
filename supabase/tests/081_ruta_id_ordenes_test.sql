-- 081_ruta_id_ordenes_test.sql — R1b: ningún actor no Admin cambia
-- ordenes.ruta_id por UPDATE directo (ni en uno ni en dos pasos, ni mezclado
-- con campos legítimos); Ventas conserva su ruta NULL vía asignar_orden y su
-- cobro directo; Chofer conserva no-entrega y cierre 069; Admin intacto.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM auditoria WHERE detalle LIKE 'Orden #812%';
DELETE FROM movimientos_contables WHERE orden_id BETWEEN 8120 AND 8129 OR concepto LIKE '%OV-81%';
DELETE FROM pagos WHERE cliente_id = 8110;
DELETE FROM cuentas_por_cobrar WHERE cliente_id = 8110;
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8120 AND 8129;
DELETE FROM ordenes WHERE id BETWEEN 8120 AND 8129 OR ruta_id BETWEEN 8101 AND 8109;
DELETE FROM rutas WHERE id BETWEEN 8101 AND 8109;
DELETE FROM clientes WHERE id = 8110;
DELETE FROM productos WHERE sku LIKE 'P81-%';
DELETE FROM usuarios WHERE id BETWEEN 8101 AND 8119;
DELETE FROM auth.users WHERE id::text LIKE '81000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('81000000-0000-0000-0000-000000000001', 'admin81@t'),  ('81000000-0000-0000-0000-000000000002', 'ventas81@t'),
  ('81000000-0000-0000-0000-000000000003', 'chofer81@t'), ('81000000-0000-0000-0000-000000000004', 'prod81@t'),
  ('81000000-0000-0000-0000-000000000005', 'bolsas81@t'), ('81000000-0000-0000-0000-000000000006', 'fact81@t'),
  ('81000000-0000-0000-0000-000000000007', 'inadm81@t'),  ('81000000-0000-0000-0000-000000000099', 'noprof81@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8101, 'Admin 81',   'admin81@t',  'Admin',          'Activo',   '81000000-0000-0000-0000-000000000001'),
  (8102, 'Ventas 81',  'ventas81@t', 'Ventas',         'Activo',   '81000000-0000-0000-0000-000000000002'),
  (8103, 'Chofer 81',  'chofer81@t', 'Chofer',         'Activo',   '81000000-0000-0000-0000-000000000003'),
  (8104, 'Prod 81',    'prod81@t',   'Producción',     'Activo',   '81000000-0000-0000-0000-000000000004'),
  (8105, 'Bolsas 81',  'bolsas81@t', 'Almacén Bolsas', 'Activo',   '81000000-0000-0000-0000-000000000005'),
  (8106, 'Fact 81',    'fact81@t',   'Facturación',    'Activo',   '81000000-0000-0000-0000-000000000006'),
  (8107, 'InAdmin 81', 'inadm81@t',  'Admin',          'Inactivo', '81000000-0000-0000-0000-000000000007');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P81-HIELO', 'Hielo 81', 'Producto Terminado', 30, 10);
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8110, 'Cliente 81', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado) VALUES
  (8101, 'R-8101', 'Ruta 81',       8103, 'Chofer 81', 'En progreso', CURRENT_DATE, '{}', '{}', '{}'),
  (8102, 'R-8102', 'Ruta libre 81', NULL, NULL,        'Programada',  CURRENT_DATE, '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8120, 'OV-8120', 8110, 'Cliente 81', '1×P81-HIELO', 30, 'Creada',    'Efectivo', 'Contado', 8102, NULL),
  (8121, 'OV-8121', 8110, 'Cliente 81', '1×P81-HIELO', 30, 'Creada',    'Efectivo', 'Contado', 8102, NULL),
  (8122, 'OV-8122', 8110, 'Cliente 81', '2×P81-HIELO', 60, 'Asignada',  'Efectivo', 'Contado', 8102, 8101),
  (8123, 'OV-8123', 8110, 'Cliente 81', '1×P81-HIELO', 30, 'Asignada',  'Efectivo', 'Contado', 8102, NULL),
  (8124, 'OV-8124', 8110, 'Cliente 81', '1×P81-HIELO', 30, 'Entregada', 'Efectivo', 'Contado', 8102, 8101);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8120, 'P81-HIELO', 1, 30, 30), (8121, 'P81-HIELO', 1, 30, 30), (8122, 'P81-HIELO', 2, 30, 60), (8123, 'P81-HIELO', 1, 30, 30), (8124, 'P81-HIELO', 1, 30, 30);
COMMIT;

CREATE OR REPLACE FUNCTION t81_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t81_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t81_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t81_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t81_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', id, estatus, ruta_id, metodo_pago, folio_nota, motivo_no_entrega, reagendada, total), ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 8120 AND 8129),
    (SELECT count(*)::text FROM ordenes WHERE ruta_id BETWEEN 8101 AND 8109 AND id NOT BETWEEN 8120 AND 8129),
    (SELECT string_agg(concat_ws(':', id, estatus, carga::text), ',' ORDER BY id) FROM rutas WHERE id BETWEEN 8101 AND 8109),
    (SELECT count(*)::text FROM pagos WHERE cliente_id = 8110),
    (SELECT count(*)::text FROM auditoria WHERE detalle LIKE 'Orden #812%')))
$$;
CREATE OR REPLACE FUNCTION t81_orden(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus || '/' || COALESCE(ruta_id::text, 'NULL') FROM ordenes WHERE id = p_id $$;
DROP TABLE IF EXISTS t81_ids;
CREATE TEMP TABLE t81_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t81_ids TO anon, authenticated;
INSERT INTO t81_ids VALUES ('h0', t81_huella());

-- Intentos directos de tocar ruta_id. Si la policy deja ver la fila (Ventas,
-- Chofer, Facturación) el guard rechaza con 42501; si no, 0 filas.
CREATE OR REPLACE FUNCTION t81_ataques(p_tag TEXT, p_visible BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s RECORD; v_sql TEXT;
BEGIN
  FOR s IN SELECT * FROM (VALUES
      ('Creada → Asignada + ruta concreta',          $q$UPDATE ordenes SET estatus = 'Asignada', ruta_id = 8101 WHERE id = 8120$q$),
      ('ruta NULL → concreta sin cambiar estatus',   $q$UPDATE ordenes SET ruta_id = 8101 WHERE id = 8123$q$),
      ('ruta A → ruta B',                            $q$UPDATE ordenes SET ruta_id = 8102 WHERE id = 8122$q$),
      ('ruta concreta → NULL (desasignar)',          $q$UPDATE ordenes SET ruta_id = NULL WHERE id = 8122$q$),
      ('solo ruta en orden Creada',                  $q$UPDATE ordenes SET ruta_id = 8102 WHERE id = 8121$q$),
      ('mixto: campo legítimo + ruta',               $q$UPDATE ordenes SET estatus = 'Asignada', referencia_entrega = 'x', ruta_id = 8101 WHERE id = 8121$q$),
      ('mixto: cobro + ruta',                        $q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo', ruta_id = 8102 WHERE id = 8123$q$)
    ) x(col, sql)
  LOOP
    IF to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NOT NULL THEN
      -- 088: la policy de UPDATE ya acota filas por rol/ruta; denegado = 42501
      -- (guard o WITH CHECK) o 0 filas (fila fuera del alcance del rol).
      BEGIN
        IF t81_rows(s.sql) <> 0 THEN RAISE EXCEPTION 'FAIL: % (088) modificó filas', p_tag || ': ' || s.col; END IF;
        RAISE NOTICE 'OK: % → 0 filas (088)', p_tag || ': ' || s.col;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK: % → rechazado 42501 (088)', p_tag || ': ' || s.col;
      END;
    ELSIF p_visible THEN
      PERFORM t81_err(s.sql, p_tag || ': ' || s.col || ' → rechazado', '42501');
    ELSE
      PERFORM t81_assert(t81_rows(s.sql) = 0, p_tag || ': ' || s.col || ' → 0 filas');
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION t81_ataques(TEXT, BOOLEAN) TO anon, authenticated;

\echo '── 081: estado físico'
SELECT t81_assert((SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_ruta' AND NOT tgisinternal AND tgenabled = 'O' AND pg_get_triggerdef(oid) ~ 'BEFORE UPDATE'), '081-01 trigger trg_ordenes_guard_ruta presente (BEFORE UPDATE)');
SELECT t81_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('public', oid, 'EXECUTE')
  FROM pg_proc WHERE oid = 'public.ordenes_guard_ruta()'::regprocedure), '081-02 ordenes_guard_ruta: search_path fijo, sin EXECUTE para PUBLIC/anon/authenticated');
SELECT t81_assert(pg_get_functiondef('public.ordenes_guard_ruta()'::regprocedure) !~ 'get_my_|auth\.jwt|email', '081-03 guard sin identidad legacy/email');
SELECT t81_assert(/* 105 solo añade la marca tiene_devolucion */ (SELECT md5(regexp_replace(pg_get_functiondef(oid), E'\n     -- 105: la marca de devolución la pone solo registrar_devolucion\\.\n     OR NEW\\.tiene_devolucion IS DISTINCT FROM OLD\\.tiene_devolucion', '')) = '99fb6cfe4933dc702e3531669b0c6ec3' FROM pg_proc WHERE oid = 'public.ordenes_guard_financiero()'::regprocedure) AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_financiero'), '081-04 contrato 069 (ordenes_guard_financiero) sin cambios (md5 de producción)');
SELECT t81_assert((SELECT md5(pg_get_functiondef(oid)) = 'd9e6ce160e0eae40c4aae1d94455b4c0' FROM pg_proc WHERE oid = 'public.asignar_orden(bigint,bigint,bigint)'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '3fc56daefc13ad7697114de2ec2593aa' FROM pg_proc WHERE oid = 'public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = 'b16c475b7c15505a539bbfb98e14ea45' FROM pg_proc WHERE oid = 'public.cancelar_orden_asignada(bigint,bigint)'::regprocedure), '081-05 RPCs 080 sin cambios (md5 de producción)');
SELECT t81_assert((SELECT string_agg(policyname, ',' ORDER BY policyname) = CASE WHEN to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NULL THEN 'admin_all,read_all,rollback_delete,ventas_insert,ventas_update' WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ordenes' AND policyname = 'ventas_insert') THEN 'admin_all,chofer_update_own,read_all,rollback_delete,ventas_insert,ventas_update' ELSE 'admin_all,chofer_update_own,read_all,rollback_delete,ventas_update' END FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes'), '081-06 policies de ordenes sin cambios');

\echo '── 081: Ventas — ataque directo y flujo legítimo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t81_actor('authenticated', 'ventas81@t', '81000000-0000-0000-0000-000000000002');
SELECT t81_ataques('081-10 Ventas', true);
-- dos pasos: estatus primero (equivalente a su RPC), ruta después
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET estatus = 'Asignada' WHERE id = 8120$q$) = 1 AND t81_orden(8120) = 'Asignada/NULL', '081-11 Ventas: Creada → Asignada sin ruta por UPDATE (mismo efecto que su RPC)');
SELECT t81_err($q$UPDATE ordenes SET ruta_id = 8101 WHERE id = 8120$q$, '081-12 Ventas: segundo paso (ruta) rechazado', '42501');
SELECT t81_err($q$UPDATE ordenes SET ruta_id = 8102 WHERE id = 8120$q$, '081-13 Ventas: segundo paso a ruta libre rechazado', '42501');
ROLLBACK;
SELECT t81_assert(t81_huella() = (SELECT v FROM t81_ids WHERE k = 'h0'), '081-14 Ventas: cero efectos tras los ataques');
BEGIN; SET LOCAL ROLE authenticated; SELECT t81_actor('authenticated', 'ventas81@t', '81000000-0000-0000-0000-000000000002');
SELECT asignar_orden(8120, NULL, 8102);
SELECT t81_assert(t81_orden(8120) = 'Asignada/NULL', '081-15 Ventas: asignar_orden con ruta NULL (080) PASS');
SELECT t81_err($q$SELECT asignar_orden(8121, 8101, 8102)$q$, '081-16 Ventas: asignar_orden a ruta concreta sigue denegado (080)', '42501');
SELECT t81_err($q$SELECT asignar_orden(8121, 8101, 8101)$q$, '081-17 Ventas: p_usuario_id de Admin no autoriza', '42501');
-- 081-18 depende de la fase: antes de 110 el cobro directo sin ruta entregaba; desde 110 la venta sin
-- ruta se entrega solo con completar_venta_directa (la escritura directa se rechaza con 42501).
SELECT CASE WHEN to_regprocedure('public.ordenes_guard_entrega_directa()') IS NULL
  THEN t81_assert(t81_rows($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Transferencia', folio_nota = 'N-81' WHERE id = 8123$q$) = 1 AND t81_orden(8123) = 'Entregada/NULL', '081-18 Ventas: cobro directo (estatus, metodo_pago, folio_nota) sigue funcionando (antes de 110)')
  ELSE t81_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Transferencia', folio_nota = 'N-81' WHERE id = 8123$q$, '081-18 Ventas: cobro directo sin ruta ya no entrega (110: completar_venta_directa)', '42501') END;
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET direccion_entrega = 'Calle 1', referencia_entrega = 'portón' WHERE id = 8121$q$) = 1, '081-19 Ventas: campos de entrega editables sin tocar ruta');
ROLLBACK;

\echo '── 081: Chofer — no-entrega y cierre 069 intactos; ruta inmutable'
BEGIN; SET LOCAL ROLE authenticated; SELECT t81_actor('authenticated', 'chofer81@t', '81000000-0000-0000-0000-000000000003');
SELECT t81_ataques('081-20 Chofer', true);
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET estatus = 'No entregada', motivo_no_entrega = 'Local cerrado', fecha_no_entrega = now(), reagendada = true WHERE id = 8122$q$) = 1, '081-21 Chofer: marcarNoEntregada (sin ruta) sigue funcionando');
SELECT t81_err($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 8122$q$, '081-22 Chofer: No entregada es terminal (069 intacto)', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t81_actor('authenticated', 'chofer81@t', '81000000-0000-0000-0000-000000000003');
INSERT INTO t81_ids VALUES ('crf', cerrar_ruta_financiero(8101, '[{"ordenId": 8123, "express": false, "pago": "Efectivo"}]'::jsonb, 8103, 'Chofer 81')::text);
SELECT t81_assert(t81_orden(8123) = 'Entregada/8101' AND (SELECT count(*) = 1 FROM pagos WHERE cliente_id = 8110), '081-23 Chofer: cerrar_ruta_financiero completa ruta_id de una orden escalonada (contexto de contrato) y cobra');
ROLLBACK;
SELECT t81_assert(t81_huella() = (SELECT v FROM t81_ids WHERE k = 'h0'), '081-24 Chofer: todo revertido');

\echo '── 081: otros roles — sin capacidad nueva'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('081-30 Facturación',    'fact81@t',   '81000000-0000-0000-0000-000000000006', true),
      ('081-31 Producción',     'prod81@t',   '81000000-0000-0000-0000-000000000004', false),
      ('081-32 Almacén Bolsas', 'bolsas81@t', '81000000-0000-0000-0000-000000000005', false),
      ('081-33 Admin INACTIVO', 'inadm81@t',  '81000000-0000-0000-0000-000000000007', false),
      ('081-34 JWT sin perfil', 'noprof81@t', '81000000-0000-0000-0000-000000000099', false)) x(tag, email, sub, visible)
  LOOP
    PERFORM t81_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t81_ataques(a.tag, a.visible);
    PERFORM t81_err($q$SELECT asignar_orden(8121, 8101, 8101)$q$, a.tag || ': asignar_orden a ruta denegado (080)', '42501');
    PERFORM t81_err($q$SELECT asignar_ordenes_a_ruta(8102, ARRAY[8121]::bigint[])$q$, a.tag || ': asignar_ordenes_a_ruta denegado (080)', '42501');
    RESET ROLE;
    PERFORM t81_assert(t81_huella() = (SELECT v FROM t81_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;
BEGIN; SET LOCAL ROLE anon; SELECT t81_actor('anon', NULL, NULL);
SELECT t81_ataques('081-35 anon', false);
ROLLBACK;
SELECT t81_assert(t81_huella() = (SELECT v FROM t81_ids WHERE k = 'h0'), '081-36 anon: cero efectos');

\echo '── 081: Admin — despacho y gestión intactos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t81_actor('authenticated', 'admin81@t', '81000000-0000-0000-0000-000000000001');
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET ruta_id = 8102 WHERE id = 8121$q$) = 1 AND t81_orden(8121) = 'Creada/8102', '081-40 Admin: ruta_id directo');
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET estatus = 'Creada', ruta_id = NULL WHERE ruta_id = 8101 AND estatus = 'Asignada'$q$) = 1 AND t81_orden(8122) = 'Creada/NULL', '081-41 Admin: liberar órdenes al cancelar ruta (cancelarRutaConDevolucion)');
SELECT asignar_orden(8120, 8101, 8101);
SELECT t81_assert(t81_orden(8120) = 'Asignada/8101', '081-42 Admin: asignar_orden a ruta concreta (080)');
INSERT INTO t81_ids VALUES ('r1', asignar_ordenes_a_ruta(8102, ARRAY[8122]::bigint[])::text);
SELECT t81_assert(t81_orden(8122) = 'Asignada/8102' AND (SELECT carga = '{"P81-HIELO": 2}'::jsonb FROM rutas WHERE id = 8102), '081-43 Admin: asignar_ordenes_a_ruta + carga (080)');
SELECT cancelar_orden_asignada(8120, 8101);
SELECT t81_assert(t81_orden(8120) = 'Creada/NULL', '081-44 Admin: cancelar_orden_asignada (080)');
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET estatus = 'No entregada', motivo_no_entrega = 'Cierre forzado por admin: x', fecha_no_entrega = now() WHERE id = 8122$q$) = 1, '081-45 Admin: cierre forzado de órdenes (cerrarRuta)');
ROLLBACK;
SELECT t81_assert(t81_huella() = (SELECT v FROM t81_ids WHERE k = 'h0'), '081-46 Admin: todo revertido');
SELECT t81_assert(t81_rows($q$UPDATE ordenes SET ruta_id = 8102 WHERE id = 8121$q$) = 1, '081-47 SQL sin JWT (service_role/cron): sin restricción');
UPDATE ordenes SET ruta_id = NULL WHERE id = 8121;

BEGIN;
DELETE FROM auditoria WHERE detalle LIKE 'Orden #812%';
DELETE FROM movimientos_contables WHERE orden_id BETWEEN 8120 AND 8129 OR concepto LIKE '%OV-81%';
DELETE FROM pagos WHERE cliente_id = 8110;
DELETE FROM cuentas_por_cobrar WHERE cliente_id = 8110;
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8120 AND 8129;
DELETE FROM ordenes WHERE id BETWEEN 8120 AND 8129 OR ruta_id BETWEEN 8101 AND 8109;
DELETE FROM rutas WHERE id BETWEEN 8101 AND 8109;
DELETE FROM clientes WHERE id = 8110;
DELETE FROM productos WHERE sku LIKE 'P81-%';
DELETE FROM usuarios WHERE id BETWEEN 8101 AND 8119;
DELETE FROM auth.users WHERE id::text LIKE '81000000-%';
COMMIT;
\echo '── 081: TODAS LAS PRUEBAS OK'
