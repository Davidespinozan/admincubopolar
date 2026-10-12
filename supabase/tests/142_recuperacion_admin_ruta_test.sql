-- 142_recuperacion_admin_ruta_test.sql — T5-D2: cierre de ruta por Administración en
-- una sola transacción (sin marca financiera parcial), camión que no salió (B1),
-- inicio excepcional (B2), faltante NO justificado distinto de una merma, links de pago
-- pendientes visibles y sin cobro inventado, y permisos. Todo en UNA transacción con
-- ROLLBACK. (La concurrencia con dos conexiones corre en el runner: C142a–g.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14200000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t142' FROM generate_series(1, 30) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14201, 'Admin T142',      'u1@t142', 'Admin',      'Activo', '14200000-0000-0000-0000-000000000001'),
  (14202, 'Admin Dos T142',  'u2@t142', 'Admin',      'Activo', '14200000-0000-0000-0000-000000000002'),
  (14205, 'Ventas T142',     'u5@t142', 'Ventas',     'Activo', '14200000-0000-0000-0000-000000000005'),
  (14206, 'Empleado T142',   'u6@t142', 'Empleado',   'Activo', '14200000-0000-0000-0000-000000000006'),
  (14207, 'Produccion T142', 'u7@t142', 'Producción', 'Activo', '14200000-0000-0000-0000-000000000007');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
  SELECT 14200 + n, 'Chofer T142-' || n, 'u' || n || '@t142', 'Chofer', 'Activo', ('14200000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(10, 19) n;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P142-A', 'Hielo A142', 'Producto Terminado', 30, 0, 0), ('P142-B', 'Hielo B142', 'Producto Terminado', 50, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-142', 'Cuarto 142', '{"P142-A": 500, "P142-B": 100}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (14201, 'Contado T142', 'XAXX010101000', 0, false, 0), (14202, 'Credito T142', 'XAXX010101000', 0, true, 1000);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
  SELECT 14200 + n, 'R-142' || lpad(n::text, 2, '0'), 'ruta ' || n, 14209 + n, 'Chofer T142-' || (9 + n), 'Pendiente firma', CURRENT_DATE,
         CASE WHEN n = 1 THEN '{"P142-A": 20, "P142-B": 4}'::jsonb ELSE '{"P142-A": 10}'::jsonb END,
         CASE WHEN n = 1 THEN '{"P142-A": 20, "P142-B": 4}'::jsonb ELSE '{"P142-A": 10}'::jsonb END, '{}',
         CASE WHEN n = 1 THEN '{"P142-A": 20, "P142-B": 4}'::jsonb ELSE '{"P142-A": 10}'::jsonb END, now()
    FROM generate_series(1, 10) n;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (14211, 'OV-14211', 14201, 'Contado T142', '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 14205, 14201),
  (14212, 'OV-14212', 14201, 'Contado T142', '2×A', 60,  'Asignada', 'Efectivo', 'Contado', 14205, 14201),
  (14213, 'OV-14213', 14202, 'Credito T142', '3×A', 90,  'Asignada', 'Crédito',  'Credito', 14205, 14201),
  (14221, 'OV-14221', 14201, 'Contado T142', '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 14205, 14202),
  (14222, 'OV-14222', 14202, 'Credito T142', '2×A', 60,  'Asignada', 'Crédito',  'Credito', 14205, 14202),
  (14251, 'OV-14251', 14201, 'Contado T142', '2×A', 60,  'Asignada', 'Efectivo', 'Contado', 14205, 14205),
  (14252, 'OV-14252', 14201, 'Contado T142', '1×A', 30,  'Asignada', 'Efectivo', 'Contado', 14205, 14205),
  (14253, 'OV-14253', 14201, 'Contado T142', '1×A', 30,  'Asignada', 'Efectivo', 'Contado', 14205, 14205),
  (14261, 'OV-14261', 14201, 'Contado T142', '2×A', 60,  'Asignada', 'Efectivo', 'Contado', 14205, 14206);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT id, 'P142-A', (total / 30)::int, 30, total FROM ordenes WHERE id BETWEEN 14211 AND 14261;
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT '%', p_detalle TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT; v_state TEXT; v_det TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, v_det = PG_EXCEPTION_DETAIL; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR v_err NOT ILIKE p_like OR (p_detalle IS NOT NULL AND COALESCE(v_det, '') NOT LIKE '%' || p_detalle || '%') THEN
    RAISE EXCEPTION 'FAIL: % (error inesperado % % / %)', p_msg, v_state, v_err, v_det;
  END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 105);
END $$;
-- Actor de la llamada; la marca de contrato (local a la transacción) se limpia en cada cambio.
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"14200000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14200000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Foto de una ruta: estatus|marca financiera|órdenes en la ruta|pendientes|mermas activas|faltantes|intervenciones|pagos|suma pagos|cuentas por cobrar
CREATE OR REPLACE FUNCTION pg_temp.foto(p_ruta BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT estatus FROM public.rutas WHERE id = p_ruta), (SELECT count(*) FROM public.cierres_financieros_ruta WHERE ruta_id = p_ruta),
    (SELECT count(*) FROM public.ordenes WHERE ruta_id = p_ruta), (SELECT count(*) FROM public.ordenes WHERE ruta_id = p_ruta AND estatus IN ('Asignada', 'En ruta')),
    (SELECT count(*) FROM public.mermas WHERE ruta_id = p_ruta AND estatus = 'Activa'), (SELECT count(*) FROM public.ruta_faltantes WHERE ruta_id = p_ruta),
    (SELECT count(*) FROM public.ruta_intervenciones WHERE ruta_id = p_ruta),
    (SELECT count(*) FROM public.pagos p JOIN public.ordenes o ON o.id = p.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT COALESCE(sum(p.monto), 0)::int FROM public.pagos p JOIN public.ordenes o ON o.id = p.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT count(*) FROM public.cuentas_por_cobrar x JOIN public.ordenes o ON o.id = x.orden_id WHERE o.ruta_id = p_ruta)) $$;
CREATE OR REPLACE FUNCTION pg_temp.bal(p_ruta BIGINT, p_sku TEXT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT cargado || '|' || entregado || '|' || merma || '|' || devuelto FROM public.ruta_inventario_resumen(p_ruta) WHERE sku = p_sku $$;
-- Inventario: existencia del cuarto|movimientos de kardex del producto|movimientos contables de mermas
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT stock ->> 'P142-A' FROM public.cuartos_frios WHERE id = 'CF-142'), (SELECT count(*) FROM public.inventario_mov WHERE producto LIKE 'P142-%'),
                        (SELECT count(*) FROM public.movimientos_contables WHERE categoria = 'Mermas' AND concepto LIKE '%P142-%')) $$;
CREATE OR REPLACE FUNCTION pg_temp.est(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus || '|' || COALESCE(ruta_id::text, '-') FROM public.ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION pg_temp.aud(p_ruta TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.auditoria WHERE modulo = 'Rutas' AND accion LIKE '%ruta%' AND detalle LIKE 'Ruta ' || p_ruta || ' —%' $$;
CREATE TEMP TABLE t142 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t142 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t142 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.cierra(p_op INTEGER, p_ruta BIGINT, p_tipo TEXT, p_conteo TEXT, p_falt TEXT DEFAULT NULL, p_motivo TEXT DEFAULT 'El chofer no se presentó a cerrar')
RETURNS JSONB LANGUAGE sql AS $$ SELECT cerrar_ruta_admin(pg_temp.op(p_op), p_ruta, p_tipo, p_conteo::jsonb, p_falt::jsonb, p_motivo) $$;

\echo '── 142: catálogo'
SELECT pg_temp.ok((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AND count(*) = 4
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('cerrar_ruta_admin', 'iniciar_ruta_admin', 'conciliacion_ruta', 'ruta_cobros_pendientes'))
  AND (SELECT prosecdef AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
         FROM pg_proc WHERE oid = 'public.ruta_cobros_pendientes_interno(bigint)'::regprocedure),
  '142-01 cuatro contratos SECURITY DEFINER con search_path fijo y sin anon; el helper interno sin acceso por API');
SELECT pg_temp.ok((SELECT bool_and(c.relrowsecurity) AND count(*) = 2 FROM pg_class c WHERE c.oid IN ('public.ruta_intervenciones'::regclass, 'public.ruta_faltantes'::regclass))
  AND (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('ruta_intervenciones', 'ruta_faltantes'))
  AND NOT has_table_privilege('authenticated', 'public.ruta_intervenciones', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.ruta_intervenciones', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.ruta_faltantes', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.ruta_faltantes', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.ruta_intervenciones', 'SELECT') AND NOT has_table_privilege('anon', 'public.ruta_faltantes', 'SELECT'),
  '142-02 las dos tablas no tienen acceso por API (RLS activa, sin policies, sin grants)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)) = 'a4e627685850db7af897d3239e1a0dc5'
  AND md5(pg_get_functiondef('public.finalizar_inventario_ruta(uuid,bigint,jsonb)'::regprocedure)) = '6df6f7786484a69b7cb78ea6973b5a47'
  AND md5(pg_get_functiondef('public.entregar_orden_ruta(uuid,bigint,text,text,text)'::regprocedure)) = '29967d7a0208ae34f279838a35e87f04'
  AND md5(pg_get_functiondef('public.registrar_venta_rapida_ruta(uuid,bigint,bigint,text,jsonb,text,boolean,text,timestamptz)'::regprocedure)) = '68c38f4847373536ee80b5ff3a981311'
  AND md5(pg_get_functiondef('public.crear_cxc_orden(bigint,integer)'::regprocedure)) = 'bee6bcb201f0ee8e88a9bb2de9f99788'
  AND md5(pg_get_functiondef('public.registrar_pago_orden(bigint,text,text,bigint)'::regprocedure)) = 'add148ab82529ea5f3b2c4d2fcdb10ca'
  AND md5(pg_get_functiondef('public.ordenes_guard_carga_ruta()'::regprocedure)) = 'f9669b57ee94de6905f6eb3ddb4c8473'
  AND md5(pg_get_functiondef('public.ordenes_guard_credito_entrega()'::regprocedure)) = 'a9c59333122fc17f8efb86fd1fe3cc6e',
  '142-03 NO cambian el cierre financiero, el cierre de inventario, la entrega (139), la venta rápida (141), pago, cuenta por cobrar ni las guardas: md5 = producción');
INSERT INTO t142 VALUES ('md5', jsonb_build_object('merma', md5(pg_get_functiondef('public.registrar_merma(text,integer,text,text,text,bigint,boolean)'::regprocedure)),
  'rev', md5(pg_get_functiondef('public.revertir_merma(bigint,text)'::regprocedure)), 'noent', md5(pg_get_functiondef('public.registrar_no_entrega(uuid,bigint,text,boolean)'::regprocedure)),
  'diag', md5(pg_get_functiondef('public.diagnostico_ruta(bigint)'::regprocedure))));

\echo '── 142: cargas por contrato (9 rutas; la 10 queda sin cargar)'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT 14200 + n AS ruta, 9 + n AS chofer FROM generate_series(1, 9) n LOOP
    PERFORM pg_temp.como(r.chofer);
    SET LOCAL ROLE authenticated;
    PERFORM confirmar_carga_ruta(('14200000-0000-0000-0000-0000000c' || lpad((r.ruta - 14200)::text, 4, '0'))::uuid, r.ruta::bigint, 'data:image/png;base64,QQ==');
    RESET ROLE;
  END LOOP;
END $$;
-- Las rutas 1, 5, 6, 7, 8 y 9 las inicia su chofer; 2, 3 y 4 se quedan Cargadas.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT x AS ruta, x - 14191 AS chofer FROM unnest(ARRAY[14201, 14205, 14206, 14207, 14208, 14209]) x LOOP
    PERFORM pg_temp.como(r.chofer);
    SET LOCAL ROLE authenticated;
    UPDATE rutas SET estatus = 'En progreso' WHERE id = r.ruta;
    RESET ROLE;
  END LOOP;
END $$;
INSERT INTO t142 VALUES ('i0', to_jsonb(pg_temp.inv()));
SELECT pg_temp.ok(pg_temp.foto(14201) = 'En progreso|0|3|3|0|0|0|0|0|0' AND pg_temp.foto(14202) = 'Cargada|0|2|2|0|0|0|0|0|0' AND pg_temp.foto(14210) = 'Pendiente firma|0|0|0|0|0|0|0|0|0'
  AND (SELECT stock ->> 'P142-A' FROM cuartos_frios WHERE id = 'CF-142') = '400',
  '142-04 nueve rutas cargadas (salieron 100 del cuarto); seis iniciadas por su chofer, tres Cargadas y una sin cargar');

\echo '── 142: validaciones y permisos'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": 20}', NULL, 'corto')$q$, '142-05 motivo de menos de 10 letras: rechazado', '22023', '%motivo de la intervención%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": 20}', NULL, '          ')$q$, '142-06 motivo en blanco: rechazado', '22023', '%motivo de la intervención%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'forzar', '{"P142-A": 20}')$q$, '142-07 no existe un tipo "forzar"', '22023', '%tipo de cierre inválido%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT cerrar_ruta_admin(NULL, 14201, 'cierre_admin', '{}'::jsonb, NULL, 'El chofer no se presentó')$q$, '142-08 sin operación', '22023', '%operación y ruta son obligatorias%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '[1]')$q$, '142-09 conteo que no es un objeto', '22023', '%el conteo debe ser un objeto%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": -1}')$q$, '142-10 conteo negativo', '22023', '%cantidad inválida en el conteo%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": 1.5}')$q$, '142-11 conteo con decimales', '22023', '%cantidad inválida en el conteo%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": 20}', '[{"sku": "P142-A", "cantidad": 0}]')$q$, '142-12 faltante en cero', '22023', '%faltante inválido%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'cierre_admin', '{"P142-A": 20}', '[{"sku": "P142-A", "cantidad": 1}, {"sku": "P142-A", "cantidad": 2}]')$q$, '142-13 producto repetido en los faltantes', '22023', '%está repetido en los faltantes%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 999999, 'cierre_admin', '{}')$q$, '142-14 ruta inexistente', '22023', '%ruta no encontrada%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14210, 'cierre_admin', '{}')$q$, '142-15 ruta sin carga confirmada: no hay producto que devolver', '22023', '%no tiene carga confirmada%', 'SIN_CARGA');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14202, 'cierre_admin', '{"P142-A": 10}')$q$, '142-16 ruta Cargada con cierre normal: hay que decir si salió o no', '22023', '%elige si el camión no salió%', 'ESTADO_NO_VALIDO');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(1, 14201, 'no_salio', '{"P142-A": 20, "P142-B": 4}')$q$, '142-17 "no salió" sobre una ruta En progreso: rechazado', '22023', '%solo aplica con el camión cargado%', 'ESTADO_NO_VALIDO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(2, 14201, 'cierre_admin', '{"P142-A": 20}')$q$, '142-18 el Chofer no usa el cierre de Administración (ni en su ruta)', '42501', '%no autorizado%');
SELECT pg_temp.como(5);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(2, 14201, 'cierre_admin', '{"P142-A": 20}')$q$, '142-19 Ventas: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(2, 14201, 'cierre_admin', '{"P142-A": 20}')$q$, '142-20 Empleado: rechazado', '42501', '%');
SELECT pg_temp.como(7);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(2, 14201, 'cierre_admin', '{"P142-A": 20}')$q$, '142-21 Producción: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(3), 14204, 'El camión salió sin iniciar')$q$, '142-22 el Chofer no usa el inicio de Administración', '42501', '%no autorizado%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT conciliacion_ruta(14201)$q$, '142-23 el Chofer no lee la conciliación de Administración', '42501', '%no autorizado%');
SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT ruta_cobros_pendientes(14201)$q$, '142-24 un Chofer no consulta los cobros de la ruta de otro', '42501', '%no pertenece a este chofer%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT ruta_cobros_pendientes(NULL)$q$, '142-25 un Chofer no consulta el listado general', '42501', '%no pertenece a este chofer%');
SELECT pg_temp.como(5);
SELECT pg_temp.falla($q$SELECT ruta_cobros_pendientes(14201)$q$, '142-26 Ventas no consulta cobros de ruta', '42501', '%no autorizado%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT count(*) FROM ruta_intervenciones$q$, '142-27 ni Administración lee las tablas por API', '42501', '%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$INSERT INTO ruta_faltantes (merma_id, ruta_id, operacion_id, sku, cantidad, motivo, actor) VALUES (1, 14201, gen_random_uuid(), 'P142-A', 1, 'motivo de prueba', 'x')$q$,
  '142-28 nadie escribe un faltante por API', '42501', '%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14201) = 'En progreso|0|3|3|0|0|0|0|0|0' AND pg_temp.foto(14202) = 'Cargada|0|2|2|0|0|0|0|0|0' AND pg_temp.inv() = pg_temp.j('i0') #>> '{}',
  '142-29 ningún rechazo dejó efectos: sin marca financiera, sin intervención, sin movimiento');

\echo '── 142: órdenes pendientes — el cierre no las resuelve solo'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t142 VALUES ('e11', entregar_orden_ruta(pg_temp.op(10), 14211, 'Efectivo'));
SELECT pg_temp.como(10);
INSERT INTO t142 VALUES ('v1', registrar_venta_rapida_ruta(pg_temp.op(11), 14201, NULL, NULL, '[{"sku": "P142-A", "cant": 2}]'::jsonb, 'Efectivo'));
SELECT pg_temp.como(10);
INSERT INTO t142 VALUES ('e13', entregar_orden_ruta(pg_temp.op(12), 14213, 'Crédito'));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(20, 14201, 'cierre_admin', '{"P142-A": 11, "P142-B": 4}')$q$,
  '142-30 con una orden sin resolver el cierre se rechaza y dice cuál', '22023', '%1 orden(es) sin resolver (OV-14212)%Resuélvelas una por una%', 'ORDENES_PENDIENTES');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14201) = 'En progreso|0|4|1|0|0|0|2|180|1' AND pg_temp.est(14212) = 'Asignada|14201',
  '142-31 DEFECTO A corregido: el intento fallido NO dejó marca financiera ni intervención; la orden sigue Asignada (nada se marcó No entregada sola)');
-- El chofer puede seguir con SU cierre después del intento fallido de Administración.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t142 VALUES ('nf', registrar_no_entrega(pg_temp.op(13), 14212, 'Cliente cerrado'));
SELECT pg_temp.como(10);
INSERT INTO t142 VALUES ('cf1', cerrar_ruta_financiero(pg_temp.op(14), 14201,
  jsonb_build_array(jsonb_build_object('ordenId', 14211, 'pago', 'Efectivo'), jsonb_build_object('ordenId', 14213, 'pago', 'Crédito'),
                    jsonb_build_object('ordenId', (pg_temp.j('v1') ->> 'orden_id')::bigint, 'pago', 'Efectivo')), 14210, 'x'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('cf1') ->> 'success')::boolean AND pg_temp.foto(14201) = 'En progreso|1|4|0|0|0|0|2|180|1',
  '142-32 tras el intento fallido de Administración el chofer registra su cierre financiero sin choque ("otros datos" ya no ocurre)');

\echo '── 142: conciliación antes de cerrar'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('c1', conciliacion_ruta(14201));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('c1') ->> 'estatus' = 'En progreso' AND pg_temp.j('c1') ->> 'chofer' = 'Chofer T142-10' AND (pg_temp.j('c1') ->> 'pendientes')::int = 0
  AND (pg_temp.j('c1') ->> 'cierre_financiero')::boolean AND jsonb_array_length(pg_temp.j('c1') -> 'ordenes') = 4
  AND (SELECT (x ->> 'cargado')::int = 20 AND (x ->> 'entregado')::int = 9 AND (x ->> 'restante')::int = 11 FROM jsonb_array_elements(pg_temp.j('c1') -> 'inventario') x WHERE x ->> 'sku' = 'P142-A')
  AND (SELECT count(*) = 1 AND min(x ->> 'estatus') = 'No entregada' FROM jsonb_array_elements(pg_temp.j('c1') -> 'ordenes') x WHERE (x ->> 'id')::bigint = 14212),
  '142-33 conciliación: estado, chofer, inventario (cargó 20, entregó 9, debe regresar 11) y las 4 órdenes con su estatus, incluida la No entregada');
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(x ->> 'metodo') = 'Efectivo' AND min((x ->> 'pagos')::int) = 2 AND min((x ->> 'monto')::numeric) = 180 FROM jsonb_array_elements(pg_temp.j('c1') -> 'cobros_por_metodo') x)
  AND (pg_temp.j('c1') #>> '{credito,cuentas}')::int = 1 AND (pg_temp.j('c1') #>> '{credito,saldo}')::numeric = 90
  AND (pg_temp.j('c1') #>> '{ventas_rapidas,ventas}')::int = 1 AND (pg_temp.j('c1') #>> '{ventas_rapidas,total}')::numeric = 60
  AND pg_temp.j('c1') -> 'cobros_pendientes' = '[]'::jsonb AND pg_temp.j('c1') -> 'mermas' = '[]'::jsonb AND pg_temp.j('c1') -> 'cierre_caja' = 'null'::jsonb
  AND pg_temp.j('c1') -> 'intervenciones' = '[]'::jsonb,
  '142-34 conciliación: $180 en efectivo (2 pagos), 1 cuenta por cobrar de $90, 1 venta rápida de $60, sin cobros pendientes, sin mermas, efectivo aún sin conciliar');

\echo '── 142: faltante NO justificado — declarado exactamente, distinto de una merma'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 4}')$q$,
  '142-35 faltan 2 y no se declaró nada: rechazado (la diferencia no desaparece sola)', '22023', '%El faltante declarado no coincide%falta {"P142-A": 2} y se declaró nada%', 'FALTANTE_NO_COINCIDE');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 4}', '[{"sku": "P142-A", "cantidad": 1}]')$q$,
  '142-36 se declaró menos de lo que falta: rechazado', '22023', '%no coincide%', 'FALTANTE_NO_COINCIDE');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 4}', '[{"sku": "P142-A", "cantidad": 3}]')$q$,
  '142-37 se declaró más de lo que falta: rechazado', '22023', '%no coincide%', 'FALTANTE_NO_COINCIDE');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 11, "P142-B": 4}', '[{"sku": "P142-A", "cantidad": 2}]')$q$,
  '142-38 se declaró un faltante que el conteo no tiene: rechazado', '22023', '%falta nada y se declaró%', 'FALTANTE_NO_COINCIDE');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 4}', '[{"sku": "P142-B", "cantidad": 2}]')$q$,
  '142-39 faltante declarado en otro producto: rechazado', '22023', '%no coincide%', 'FALTANTE_NO_COINCIDE');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(21, 14201, 'cierre_admin', '{"P142-A": 12, "P142-B": 4}')$q$,
  '142-40 conteo MAYOR a lo que debe regresar: lo rechaza el contrato de inventario y se deshace TODO', '22023', '%el conteo supera el inventario del camión%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14201) = 'En progreso|1|4|0|0|0|0|2|180|1' AND pg_temp.bal(14201, 'P142-A') = '20|9|0|0',
  '142-41 seis intentos rechazados: la ruta sigue En progreso, sin mermas, sin faltantes y sin intervenciones');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('k1', pg_temp.cierra(22, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 3}', '[{"sku": "P142-A", "cantidad": 2}, {"sku": "P142-B", "cantidad": 1}]', 'El chofer dejó el camión y no contó; faltan bolsas'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('k1') ->> 'ok')::boolean AND NOT (pg_temp.j('k1') ->> 'replay')::boolean AND pg_temp.j('k1') ->> 'estatus' = 'Cerrada' AND pg_temp.j('k1') ->> 'estatus_anterior' = 'En progreso'
  AND pg_temp.j('k1') ->> 'marca_financiera' = 'reutilizada' AND pg_temp.j('k1') -> 'devolucion' = '{"P142-A": 9, "P142-B": 3}'::jsonb
  AND jsonb_array_length(pg_temp.j('k1') -> 'faltantes') = 2 AND pg_temp.j('k1') ->> 'actor' LIKE '%Admin T142%' AND pg_temp.j('k1') -> 'ordenes_liberadas' = '[]'::jsonb,
  '142-42 cierre con faltante declarado: ruta Cerrada, devolución 9 y 3, dos faltantes, marca financiera REUTILIZADA (no duplicada), actor del servidor');
SELECT pg_temp.ok(pg_temp.foto(14201) = 'Cerrada|1|4|0|2|2|1|2|180|1' AND pg_temp.bal(14201, 'P142-A') = '20|9|2|9' AND pg_temp.bal(14201, 'P142-B') = '4|0|1|3',
  '142-43 el balance cierra: 20 = 9 vendidas + 2 de faltante + 9 devueltas; los $180 y la cuenta por cobrar no se tocaron');
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(m.estatus = 'Activa' AND m.causa LIKE 'FALTANTE NO JUSTIFICADO — %' AND m.mov_contable_id IS NULL AND COALESCE(m.foto_url, '') = ''
                           AND f.motivo = 'El chofer dejó el camión y no contó; faltan bolsas' AND f.actor_id = 14201 AND f.operacion_id = pg_temp.op(22) AND f.cantidad = m.cantidad AND f.sku = m.sku)
                     FROM ruta_faltantes f JOIN mermas m ON m.id = f.merma_id WHERE f.ruta_id = 14201)
  AND (SELECT count(*) = 0 FROM movimientos_contables WHERE categoria = 'Mermas' AND concepto LIKE '%P142-%')
  AND (SELECT costo_unitario = 0 FROM productos WHERE sku = 'P142-A'),
  '142-44 cada faltante: su fila de mermas (cuadra el balance) + su fila en ruta_faltantes con motivo, Admin y operación; SIN movimiento contable y sin cambio de costo');
SELECT pg_temp.ok((SELECT i.tipo = 'cierre_admin' AND i.actor_id = 14201 AND i.estado_anterior ->> 'estatus' = 'En progreso' AND (i.estado_anterior ->> 'marca_financiera')::boolean
                          AND i.motivo = 'El chofer dejó el camión y no contó; faltan bolsas' AND i.resultado ->> 'estatus' = 'Cerrada' AND jsonb_array_length(i.estado_anterior -> 'inventario') = 2
                     FROM ruta_intervenciones i WHERE i.operacion_id = pg_temp.op(22))
  AND pg_temp.aud('R-14201') = 1
  AND (SELECT detalle LIKE '%En progreso → Cerrada%FALTANTE NO JUSTIFICADO: 2×P142-A, 1×P142-B%Motivo: El chofer dejó%' FROM auditoria WHERE accion = 'Cerrar ruta (Administración)' AND detalle LIKE 'Ruta R-14201 —%'),
  '142-45 intervención: tipo, Admin y hora del servidor, estado anterior (En progreso, con marca, inventario), motivo y resultado; una línea de auditoría');

\echo '── 142: idempotencia'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('k1r', pg_temp.cierra(22, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 3}', '[{"sku": "P142-B", "cantidad": 1}, {"sku": "P142-A", "cantidad": 2}]', '  El chofer dejó el camión y no contó; faltan bolsas '));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(22, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 3}', '[{"sku": "P142-A", "cantidad": 2}, {"sku": "P142-B", "cantidad": 1}]', 'Otro motivo distinto del primero')$q$,
  '142-46 la misma operación con otro motivo: rechazada', '23505', '%operacion_id ya usado con otros datos%');
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(23, 14201, 'cierre_admin', '{"P142-A": 9, "P142-B": 3}', '[{"sku": "P142-A", "cantidad": 2}, {"sku": "P142-B", "cantidad": 1}]')$q$,
  '142-47 otro Admin con OTRA operación sobre la ruta ya cerrada: rechazado, sin segunda intervención', '22023', '%ya está cerrada%', 'RUTA_YA_CERRADA');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('k1r') ->> 'replay')::boolean AND pg_temp.j('k1r') -> 'faltantes' = pg_temp.j('k1') -> 'faltantes' AND pg_temp.foto(14201) = 'Cerrada|1|4|0|2|2|1|2|180|1',
  '142-48 el reintento (mismo contenido, otro orden y espacios) devuelve la misma respuesta: UNA intervención, DOS faltantes, sin duplicar nada');

\echo '── 142: un faltante no justificado no se revierte'
INSERT INTO t142 VALUES ('mf', (SELECT to_jsonb(f.merma_id) FROM ruta_faltantes f WHERE f.ruta_id = 14201 AND f.sku = 'P142-A'));
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla(format('SELECT revertir_merma(%s, %L)', pg_temp.j('mf') #>> '{}', 'se encontraron las bolsas'),
  '142-49 revertir la merma ligada a un faltante: el contrato existente lo rechaza (la ruta está cerrada)', '55000', '%ya está Cerrada (inventario del camión cerrado)%');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(m.estatus = 'Activa' AND m.revertida_at IS NULL) FROM ruta_faltantes f JOIN mermas m ON m.id = f.merma_id WHERE f.ruta_id = 14201)
  AND pg_temp.bal(14201, 'P142-A') = '20|9|2|9' AND (SELECT count(*) = 0 FROM inventario_mov WHERE tipo = 'Reverso merma' AND producto LIKE 'P142-%')
  AND (SELECT count(*) = 0 FROM ruta_faltantes f WHERE NOT EXISTS (SELECT 1 FROM mermas m WHERE m.id = f.merma_id AND m.estatus = 'Activa' AND m.ruta_id = f.ruta_id AND m.sku = f.sku AND m.cantidad = f.cantidad))
  AND (SELECT count(*) = 0 FROM ruta_faltantes f JOIN rutas r ON r.id = f.ruta_id WHERE r.estatus <> 'Cerrada'),
  '142-50 tras el intento: los faltantes siguen activos, sin reverso de kardex ni existencias duplicadas; todo faltante tiene su merma coherente y su ruta cerrada');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.registrar_merma(text,integer,text,text,text,bigint,boolean)'::regprocedure)) = pg_temp.j('md5') ->> 'merma'
  AND md5(pg_get_functiondef('public.revertir_merma(bigint,text)'::regprocedure)) = pg_temp.j('md5') ->> 'rev'
  AND md5(pg_get_functiondef('public.registrar_no_entrega(uuid,bigint,text,boolean)'::regprocedure)) = pg_temp.j('md5') ->> 'noent'
  AND md5(pg_get_functiondef('public.diagnostico_ruta(bigint)'::regprocedure)) = pg_temp.j('md5') ->> 'diag',
  '142-51 la protección NO exigió tocar registrar_merma, revertir_merma, registrar_no_entrega ni diagnostico_ruta');

\echo '── 142: B1 — el camión nunca salió'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(30, 14202, 'no_salio', '{"P142-A": 9}', NULL, 'El chofer no llegó y el camión no salió')$q$,
  '142-52 B1 con conteo incompleto y sin declarar el faltante: rechazado', '22023', '%no coincide%', 'FALTANTE_NO_COINCIDE');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14202) = 'Cargada|0|2|2|0|0|0|0|0|0' AND pg_temp.est(14221) = 'Asignada|14202' AND pg_temp.est(14222) = 'Asignada|14202',
  '142-53 el rechazo deshizo TODO: la ruta sigue Cargada (no quedó En progreso), sin marca, y las órdenes NO se liberaron');
INSERT INTO t142 VALUES ('i1', to_jsonb((SELECT stock ->> 'P142-A' FROM cuartos_frios WHERE id = 'CF-142')));
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('b1', pg_temp.cierra(31, 14202, 'no_salio', '{"P142-A": 10}', NULL, 'El chofer no llegó y el camión no salió'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('b1') ->> 'tipo' = 'no_salio' AND pg_temp.j('b1') ->> 'estatus' = 'Cerrada' AND pg_temp.j('b1') ->> 'estatus_anterior' = 'Cargada' AND pg_temp.j('b1') ->> 'marca_financiera' = 'creada'
  AND pg_temp.j('b1') -> 'devolucion' = '{"P142-A": 10}'::jsonb AND pg_temp.j('b1') -> 'faltantes' = '[]'::jsonb AND jsonb_array_length(pg_temp.j('b1') -> 'ordenes_liberadas') = 2,
  '142-54 B1: Cargada → Cerrada con devolución TOTAL (10), sin faltante, y dos órdenes liberadas');
SELECT pg_temp.ok(pg_temp.est(14221) = 'Creada|-' AND pg_temp.est(14222) = 'Creada|-' AND pg_temp.foto(14202) = 'Cerrada|1|0|0|0|0|1|0|0|0'
  AND (SELECT count(*) = 2 FROM ordenes WHERE id IN (14221, 14222)) AND (SELECT count(*) = 2 FROM orden_lineas WHERE orden_id IN (14221, 14222))
  AND (SELECT (stock ->> 'P142-A')::int FROM cuartos_frios WHERE id = 'CF-142') = (pg_temp.j('i1') #>> '{}')::int + 10
  AND pg_temp.bal(14202, 'P142-A') = '10|0|0|10',
  '142-55 D2-5: las órdenes volvieron a Creada, sin ruta, sin duplicarse y con sus líneas; el producto volvió completo al cuarto; no se inventó ninguna entrega ni No entregada');
SELECT pg_temp.ok((SELECT i.tipo = 'no_salio' AND i.estado_anterior ->> 'estatus' = 'Cargada' AND jsonb_array_length(i.estado_anterior -> 'ordenes_pendientes') = 2 AND NOT (i.estado_anterior ->> 'marca_financiera')::boolean
                     FROM ruta_intervenciones i WHERE i.operacion_id = pg_temp.op(31))
  AND (SELECT count(*) = 1 FROM auditoria WHERE accion = 'Cerrar ruta: el camión no salió' AND detalle LIKE 'Ruta R-14202 — Cargada → Cerrada%2 orden(es) liberada(s)%')
  AND (SELECT fecha_fin IS NOT NULL AND cierre_at IS NOT NULL FROM rutas WHERE id = 14202),
  '142-56 B1 queda auditado como "no salió" con estado anterior Cargada: el paso técnico por En progreso no deja evento de salida');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('b1f', pg_temp.cierra(32, 14203, 'no_salio', '{"P142-A": 7}', '[{"sku": "P142-A", "cantidad": 3}]', 'El camión no salió y al descargar faltaron 3 bolsas'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('b1f') ->> 'estatus' = 'Cerrada' AND pg_temp.foto(14203) = 'Cerrada|1|0|0|1|1|1|0|0|0' AND pg_temp.bal(14203, 'P142-A') = '10|0|3|7',
  '142-57 B1 con faltante: 10 = 3 de faltante no justificado + 7 devueltas');

\echo '── 142: B2 — salió sin inicio digital'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(40), 14204, 'corto')$q$, '142-58 inicio de Administración sin motivo suficiente', '22023', '%motivo de la intervención%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(40), 14205, 'El chofer salió sin tocar la aplicación')$q$, '142-59 una ruta ya En progreso no se "inicia" otra vez', '22023', '%solo inicia una ruta con el camión cargado%', 'ESTADO_NO_VALIDO');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(40), 14210, 'El chofer salió sin tocar la aplicación')$q$, '142-60 una ruta sin carga confirmada no se inicia', '22023', '%solo inicia una ruta con el camión cargado%', 'ESTADO_NO_VALIDO');
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('b2', iniciar_ruta_admin(pg_temp.op(41), 14204, 'El chofer salió sin tocar la aplicación'));
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('b2r', iniciar_ruta_admin(pg_temp.op(41), 14204, 'El chofer salió sin tocar la aplicación'));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(42), 14204, 'Segundo intento con otra operación')$q$, '142-61 segundo inicio con otra operación: rechazado', '22023', '%solo inicia una ruta con el camión cargado%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('b2') ->> 'estatus' = 'En progreso' AND pg_temp.j('b2') ->> 'estatus_anterior' = 'Cargada' AND (pg_temp.j('b2r') ->> 'replay')::boolean
  AND pg_temp.foto(14204) = 'En progreso|0|0|0|0|0|1|0|0|0'
  AND (SELECT i.tipo = 'inicio_admin' AND i.actor_id = 14201 AND i.estado_anterior ->> 'estatus' = 'Cargada' FROM ruta_intervenciones i WHERE i.operacion_id = pg_temp.op(41))
  AND (SELECT count(*) = 1 FROM auditoria WHERE accion = 'Iniciar ruta (Administración)' AND detalle LIKE 'Ruta R-14204 —%')
  AND (SELECT carga_confirmada_at IS NOT NULL AND fecha_fin IS NULL AND cierre_at IS NULL FROM rutas WHERE id = 14204),
  '142-62 B2: Cargada → En progreso con motivo, Admin y hora del servidor; idempotente; sin hora de salida inventada (el sistema no la registra)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(13);
INSERT INTO t142 VALUES ('b2v', registrar_venta_rapida_ruta(pg_temp.op(43), 14204, NULL, NULL, '[{"sku": "P142-A", "cant": 4}]'::jsonb, 'Efectivo'));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(44, 14204, 'no_salio', '{"P142-A": 6}', NULL, 'Intento de decir que no salió')$q$,
  '142-63 una ruta con operaciones no puede cerrarse como "no salió"', '22023', '%solo aplica con el camión cargado%', 'ESTADO_NO_VALIDO');
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('b2c', pg_temp.cierra(45, 14204, 'cierre_admin', '{"P142-A": 6}', NULL, 'El chofer entregó el camión y se fue sin cerrar'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('b2v') ->> 'ok')::boolean AND pg_temp.j('b2c') ->> 'estatus' = 'Cerrada' AND pg_temp.j('b2c') ->> 'marca_financiera' = 'creada'
  AND pg_temp.foto(14204) = 'Cerrada|1|1|0|0|0|2|1|120|0' AND pg_temp.bal(14204, 'P142-A') = '10|4|0|6',
  '142-64 tras el inicio de Administración la ruta opera normal (venta rápida del chofer, T5-D1) y se cierra: 2 intervenciones, $120 cobrados, 10 = 4 + 6');
-- "No salió" con operaciones previas en una ruta Cargada (orden marcada No entregada por Administración).
SET LOCAL session_replication_role = replica;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (14291, 'OV-14291', 14201, 'Contado T142', '1×A', 30, 'No entregada', 'Efectivo', 'Contado', 14205, 14209);
UPDATE rutas SET estatus = 'Cargada' WHERE id = 14209;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(46, 14209, 'no_salio', '{"P142-A": 10}', NULL, 'Intento con una no entregada registrada')$q$,
  '142-65 "no salió" con una orden ya marcada No entregada: rechazado (hubo operación de ruta)', '22023', '%ya tiene operaciones (1 orden(es) No entregada(s))%el camión sí salió%', 'NO_SALIO_CON_OPERACIONES');
RESET ROLE;

\echo '── 142: dinero — entrega sin registro bloquea; link pendiente no'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(14);
INSERT INTO t142 VALUES ('l1', entregar_orden_ruta(pg_temp.op(50), 14251, 'QR / Link de pago'));
SELECT pg_temp.como(14);
INSERT INTO t142 VALUES ('l2', entregar_orden_ruta(pg_temp.op(51), 14252, 'QR / Link de pago'));
RESET ROLE;
-- Estado anterior a 139: orden Entregada de contado sin su cobro.
SET LOCAL session_replication_role = replica;
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo', delivered_at = now() WHERE id = 14253;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(14);
INSERT INTO t142 VALUES ('p5', ruta_cobros_pendientes(14205));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(52, 14205, 'cierre_admin', '{"P142-A": 6}')$q$,
  '142-66 una entrega de contado sin cobro ni cuenta BLOQUEA el cierre y dice cuál', '22023', '%1 entrega(s) sin cobro ni cuenta por cobrar (OV-14253)%', 'ENTREGAS_SIN_REGISTRO');
RESET ROLE;
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('p5')) = 3
  AND (SELECT count(*) = 2 FROM jsonb_array_elements(pg_temp.j('p5')) x WHERE x ->> 'tipo' = 'link')
  AND (SELECT count(*) = 1 AND min(x ->> 'folio') = 'OV-14253' AND min((x ->> 'falta')::numeric) = 30 FROM jsonb_array_elements(pg_temp.j('p5')) x WHERE x ->> 'tipo' = 'sin_registro')
  AND pg_temp.foto(14205) = 'En progreso|0|3|0|0|0|0|0|0|0',
  '142-67 el Chofer ve los cobros pendientes de SU ruta: 2 links y 1 entrega sin registro; el cierre rechazado no dejó marca');
-- La salida segura ya existe (139): la misma llamada resuelve la entrega sin registro.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(14);
INSERT INTO t142 VALUES ('r53', entregar_orden_ruta(pg_temp.op(53), 14253, 'Efectivo'));
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('k5', pg_temp.cierra(54, 14205, 'cierre_admin', '{"P142-A": 6}', NULL, 'El chofer entregó el camión y se fue sin cerrar'));
INSERT INTO t142 VALUES ('p5b', ruta_cobros_pendientes(NULL));
INSERT INTO t142 VALUES ('c5', conciliacion_ruta(14205));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('k5') ->> 'estatus' = 'Cerrada' AND (pg_temp.j('k5') ->> 'links_pendientes')::int = 2 AND pg_temp.foto(14205) = 'Cerrada|1|3|0|0|0|1|1|30|0'
  AND (SELECT count(*) = 0 FROM pagos WHERE orden_id IN (14251, 14252)) AND (SELECT count(*) = 0 FROM cuentas_por_cobrar WHERE orden_id IN (14251, 14252))
  AND (SELECT bool_and(estatus = 'Entregada' AND metodo_pago = 'QR / Link de pago') FROM ordenes WHERE id IN (14251, 14252)),
  '142-68 D2-2: con 2 links pendientes la ruta SÍ cierra; no se registró cobro ni crédito por ellos y siguen Entregadas esperando el pago');
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(x ->> 'tipo' = 'link' AND x ->> 'ruta_estatus' = 'Cerrada' AND (x ->> 'falta')::numeric > 0) FROM jsonb_array_elements(pg_temp.j('p5b')) x WHERE (x ->> 'ruta_id')::bigint = 14205)
  AND jsonb_array_length(pg_temp.j('c5') -> 'cobros_pendientes') = 2
  AND (SELECT jsonb_array_length(i.estado_anterior -> 'links_pendientes') = 2 FROM ruta_intervenciones i WHERE i.operacion_id = pg_temp.op(54)),
  '142-69 después del cierre los 2 links SIGUEN en el listado de Administración y en la conciliación, y quedaron fotografiados en la intervención');
-- Pago tardío por el webhook (sesión de confianza, como el servidor): llega, se repite y no se duplica.
SELECT set_config('request.jwt.claims', '', true), set_config('app.fin_ctx', '', true);
INSERT INTO t142 VALUES ('w1', registrar_pago_orden(14251, 'QR / Link de pago', 'stripe:cs_t142_1', NULL));
INSERT INTO t142 VALUES ('w2', registrar_pago_orden(14251, 'QR / Link de pago', 'stripe:cs_t142_1', NULL));
SELECT pg_temp.ok((pg_temp.j('w1') ->> 'aplicado')::boolean AND NOT (pg_temp.j('w2') ->> 'aplicado')::boolean
  AND (SELECT count(*) = 1 AND sum(monto) = 60 FROM pagos WHERE orden_id = 14251)
  AND (SELECT count(*) = 1 AND min(c.folio) = 'OV-14252' FROM ruta_cobros_pendientes_interno(14205) c),
  '142-70 webhook tardío con la ruta ya cerrada: el pago entra; su reintento NO duplica; el aviso de esa orden desaparece y queda el otro');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('r52', entregar_orden_ruta(pg_temp.op(55), 14252, 'Transferencia', NULL, 'SPEI-T142-1'));
INSERT INTO t142 VALUES ('p5c', ruta_cobros_pendientes(14205));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('r52') ->> 'ok')::boolean AND (SELECT count(*) = 1 AND sum(monto) = 30 AND min(metodo_pago) = 'Transferencia' FROM pagos WHERE orden_id = 14252)
  AND pg_temp.j('p5c') = '[]'::jsonb AND (SELECT estatus = 'Cerrada' FROM rutas WHERE id = 14205) AND pg_temp.bal(14205, 'P142-A') = '10|4|0|6',
  '142-71 el otro link se cobró por otro método con el contrato de 139 (ruta cerrada): un solo pago; ya no hay avisos; la ruta cerrada no cambió');

\echo '── 142: marca financiera previa y recuperación del defecto A'
-- Estado dañado anterior a 142: Administración selló un cierre financiero vacío y no cerró el inventario.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(15);
INSERT INTO t142 VALUES ('e61', entregar_orden_ruta(pg_temp.op(60), 14261, 'Efectivo'));
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('m6', cerrar_ruta_financiero(pg_temp.op(61), 14206, '[]'::jsonb, 14201, 'Admin'));
SELECT pg_temp.como(15);
SELECT pg_temp.falla($q$SELECT cerrar_ruta_financiero(pg_temp.op(62), 14206, '[{"ordenId": 14261, "pago": "Efectivo"}]'::jsonb, 14215, 'x')$q$,
  '142-72 (defecto A, estado anterior) el chofer choca con la marca vacía de Administración', '22023', '%ya tiene cierre financiero registrado con otros datos%');
SELECT pg_temp.como(15);
INSERT INTO t142 VALUES ('p6', ruta_cobros_pendientes(14206));
INSERT INTO t142 VALUES ('b6', (SELECT jsonb_agg(to_jsonb(b)) FROM calcular_balance_ruta(14206) b));
INSERT INTO t142 VALUES ('f6', finalizar_inventario_ruta(pg_temp.op(63), 14206, '{"P142-A": 8}'::jsonb));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('p6') = '[]'::jsonb AND (SELECT (x ->> 'restante')::int = 8 FROM jsonb_array_elements(pg_temp.j('b6')) x WHERE x ->> 'sku' = 'P142-A')
  AND pg_temp.j('f6') ->> 'estatus' = 'Cerrada' AND pg_temp.foto(14206) = 'Cerrada|1|1|0|0|0|0|1|60|0',
  '142-73 recuperación: el diagnóstico dice que no falta ningún registro financiero; el chofer continúa al balance y cierra SU ruta reutilizando la marca, sin cobros duplicados');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(16);
INSERT INTO t142 VALUES ('m7', cerrar_ruta_financiero(pg_temp.op(64), 14207, '[]'::jsonb, 14216, 'x'));
SELECT pg_temp.como(1);
INSERT INTO t142 VALUES ('k7', pg_temp.cierra(65, 14207, 'cierre_admin', '{"P142-A": 10}', NULL, 'El chofer consolidó y no regresó a contar'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('k7') ->> 'marca_financiera' = 'reutilizada' AND pg_temp.foto(14207) = 'Cerrada|1|0|0|0|0|1|0|0|0' AND (SELECT operacion_id = pg_temp.op(64) FROM cierres_financieros_ruta WHERE ruta_id = 14207),
  '142-74 con marca financiera del chofer, Administración cierra reutilizándola: sigue siendo la del chofer, una sola');

\echo '── 142: atomicidad con marca nueva'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(70, 14208, 'cierre_admin', '{"P142-A": 11}', NULL, 'Conteo de más para probar el rechazo')$q$,
  '142-75 ruta SIN marca financiera y conteo de más: lo rechaza el contrato de inventario', '22023', '%el conteo supera el inventario del camión%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(70, 14208, 'cierre_admin', '{"NO-EXISTE": 1, "P142-A": 10}', NULL, 'Producto que no existe en el conteo')$q$,
  '142-76 conteo con un producto inexistente: rechazado por el contrato de inventario', '22023', '%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14208) = 'En progreso|0|0|0|0|0|0|0|0|0' AND (SELECT count(*) = 0 FROM stock_operaciones WHERE ruta_id = 14208 AND tipo = 'cierre_ruta'),
  '142-77 ATOMICIDAD: tras dos fallos la marca financiera que el contrato creó DENTRO de la transacción no existe; sin intervención ni cierre de inventario');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
INSERT INTO t142 VALUES ('k8', pg_temp.cierra(70, 14208, 'cierre_admin', '{"P142-A": 10}', NULL, 'El chofer dejó el camión completo y no cerró'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('k8') ->> 'marca_financiera' = 'creada' AND pg_temp.j('k8') ->> 'actor' LIKE '%Admin Dos T142%' AND pg_temp.foto(14208) = 'Cerrada|1|0|0|0|0|1|0|0|0'
  AND (SELECT count(*) = 1 FROM cierres_financieros_ruta WHERE ruta_id = 14208) AND (SELECT count(*) = 1 FROM stock_operaciones WHERE ruta_id = 14208 AND tipo = 'cierre_ruta'),
  '142-78 la MISMA operación, ya con datos válidos, cierra: una marca, un cierre de inventario, una intervención a nombre del segundo Admin');

\echo '── 142: rutas terminales y después del cierre'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(80, 14202, 'no_salio', '{"P142-A": 10}', NULL, 'Segundo intento sobre ruta cerrada')$q$, '142-79 ruta ya cerrada: no se cierra dos veces', '22023', '%ya está cerrada%', 'RUTA_YA_CERRADA');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT iniciar_ruta_admin(pg_temp.op(81), 14202, 'Intento de iniciar una ruta cerrada')$q$, '142-80 una ruta cerrada no se inicia', '22023', '%solo inicia una ruta con el camión cargado%');
SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT registrar_venta_rapida_ruta(pg_temp.op(82), 14202, NULL, NULL, '[{"sku": "P142-A", "cant": 1}]'::jsonb, 'Efectivo')$q$,
  '142-81 venta rápida tardía sobre la ruta que cerró Administración: rechazada para revisión (T5-D1)', '22023', '%ya está cerrada%', 'RUTA_CERRADA');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(83), 14212, 'Efectivo')$q$,
  '142-82 D2-4: entrega tardía de una orden que Administración ya resolvió: el servidor la rechaza', '22023', '%está No entregada y no se puede entregar%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT registrar_no_entrega(pg_temp.op(84), 14211, 'Llegó tarde')$q$,
  '142-83 D2-4: no entrega tardía de una orden ya entregada: el servidor la rechaza', '22023', '%no se puede marcar desde Entregada%');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE rutas SET estatus = 'Cancelada' WHERE id = 14210;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.cierra(85, 14210, 'cierre_admin', '{}', NULL, 'Intento sobre una ruta cancelada')$q$, '142-84 ruta cancelada: rechazada', '22023', '%ya está cancelada%', 'RUTA_YA_CERRADA');
RESET ROLE;

\echo '── 142: integridad final'
SELECT pg_temp.ok((SELECT count(*) = 0 FROM rutas r WHERE r.id BETWEEN 14201 AND 14210 AND r.estatus = 'Cerrada'
                      AND EXISTS (SELECT 1 FROM ruta_inventario_resumen(r.id) b WHERE b.cargado <> b.entregado + b.merma + b.devuelto)),
  '142-85 toda ruta cerrada cuadra: cargado = entregado + merma/faltante + devuelto');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM (SELECT ruta_id FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 14201 AND 14210 GROUP BY 1 HAVING count(*) > 1) d)
  AND (SELECT count(*) = 0 FROM (SELECT ruta_id FROM stock_operaciones WHERE ruta_id BETWEEN 14201 AND 14210 AND tipo = 'cierre_ruta' GROUP BY 1 HAVING count(*) > 1) d)
  AND (SELECT count(*) = 0 FROM (SELECT orden_id FROM pagos WHERE orden_id BETWEEN 14211 AND 14291 GROUP BY 1 HAVING count(*) > 1) d)
  AND (SELECT count(*) = 0 FROM (SELECT orden_id FROM cuentas_por_cobrar WHERE orden_id BETWEEN 14211 AND 14291 GROUP BY 1 HAVING count(*) > 1) d),
  '142-86 sin duplicados: una marca financiera y un cierre de inventario por ruta; un pago o una cuenta por orden');
SELECT pg_temp.ok((SELECT saldo::int FROM clientes WHERE id = 14202) = (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM cuentas_por_cobrar WHERE cliente_id = 14202 AND estatus IS DISTINCT FROM 'Pagada')
  AND (SELECT saldo::int FROM clientes WHERE id = 14201) = 0,
  '142-87 saldos de clientes = sus cuentas por cobrar abiertas');
SELECT pg_temp.ok((SELECT count(*) FROM ruta_intervenciones WHERE ruta_id BETWEEN 14201 AND 14210) = 8
  AND (SELECT count(*) FROM auditoria WHERE modulo = 'Rutas' AND accion IN ('Cerrar ruta (Administración)', 'Cerrar ruta: el camión no salió', 'Iniciar ruta (Administración)') AND detalle LIKE 'Ruta R-142%') = 8
  AND (SELECT bool_and(actor_id IN (14201, 14202) AND length(motivo) >= 10 AND estado_anterior ? 'estatus') FROM ruta_intervenciones WHERE ruta_id BETWEEN 14201 AND 14210),
  '142-88 ocho intervenciones (5 cierres, 2 "no salió", 1 inicio) = ocho líneas de auditoría, todas con Admin, motivo y estado anterior; ninguna por los rechazos');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM ruta_faltantes WHERE ruta_id BETWEEN 14201 AND 14210)
  AND (SELECT count(*) = 3 FROM mermas m WHERE m.ruta_id BETWEEN 14201 AND 14210 AND m.estatus = 'Activa')
  AND (SELECT count(*) = 0 FROM mermas m WHERE m.ruta_id BETWEEN 14201 AND 14210 AND NOT EXISTS (SELECT 1 FROM ruta_faltantes f WHERE f.merma_id = m.id)),
  '142-89 tres faltantes no justificados, cada uno con su merma; ninguna merma ordinaria se confunde con un faltante');

ROLLBACK;
\echo '── 142: TODAS LAS PRUEBAS OK'
