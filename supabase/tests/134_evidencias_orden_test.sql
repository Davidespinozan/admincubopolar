-- 134_evidencias_orden_test.sql — evidencias de una venta (comprobante y entrega):
-- quién puede registrarlas, de qué ventas, con qué foto; idempotencia; lectura;
-- inmutabilidad y protección del archivo. Todo en UNA transacción con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('13400000-0000-0000-0000-00000000000' || k)::uuid, 'u' || k || '@t134' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13401, 'Admin T134',   'u1@t134', 'Admin',    'Activo', '13400000-0000-0000-0000-000000000001'),
  (13402, 'Chofer T134',  'u2@t134', 'Chofer',   'Activo', '13400000-0000-0000-0000-000000000002'),
  (13403, 'Chofer2 T134', 'u3@t134', 'Chofer',   'Activo', '13400000-0000-0000-0000-000000000003'),
  (13404, 'Ventas T134',  'u4@t134', 'Ventas',   'Activo', '13400000-0000-0000-0000-000000000004'),
  (13405, 'Emp T134',     'u5@t134', 'Empleado', 'Activo', '13400000-0000-0000-0000-000000000005');
INSERT INTO rutas (id, folio, nombre, chofer_id, estatus) VALUES (13401, 'RT134', 'Ruta T134', 13402, 'En progreso');
INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, vendedor_id, ruta_id, tipo_cobro) VALUES
  (13401, 'OV-T134-1', 'Cliente', 'x', 100, 'Entregada', 13404, 13401, 'Contado'),
  (13402, 'OV-T134-2', 'Cliente', 'x', 100, 'Entregada', 13401, NULL, 'Contado');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('mermas', '13400000-0000-0000-0000-000000000002/ordenes/13401/comprobante_pago-1.jpg'),
  ('mermas', '13400000-0000-0000-0000-000000000002/ordenes/13401/entrega-1.jpg'),
  ('mermas', '13400000-0000-0000-0000-000000000002/ordenes/13402/entrega-1.jpg'),
  ('mermas', '13400000-0000-0000-0000-000000000003/ordenes/13401/entrega-9.jpg'),
  ('mermas', '13400000-0000-0000-0000-000000000004/ordenes/13401/comprobante_pago-2.jpg'),
  ('mermas', '13400000-0000-0000-0000-000000000004/ordenes/13402/entrega-2.jpg');
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_like TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_err NOT ILIKE p_like THEN RAISE EXCEPTION 'FAIL: % (error inesperado: %)', p_msg, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.como(p_k INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '13400000-0000-0000-0000-00000000000' || p_k)::text, true)::void $$;

\echo '── 134: esquema y acceso'
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orden_evidencias'::regclass)
  AND has_table_privilege('authenticated', 'public.orden_evidencias', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.orden_evidencias', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.orden_evidencias', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.orden_evidencias', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.orden_evidencias', 'SELECT')
  AND (SELECT prosecdef AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
         FROM pg_proc WHERE oid = 'public.registrar_evidencia_orden(bigint,text,text,text)'::regprocedure),
  '134-01 tabla con RLS, solo lectura por API, anon nada; contrato sin anon');

SET LOCAL ROLE authenticated;
\echo '── 134: el chofer sube las fotos de las ventas de SU ruta'
SELECT pg_temp.como(2);
CREATE TEMP TABLE t134 (k TEXT PRIMARY KEY, v JSONB);
INSERT INTO t134 VALUES ('c1', registrar_evidencia_orden(13401, 'comprobante_pago', '13400000-0000-0000-0000-000000000002/ordenes/13401/comprobante_pago-1.jpg', '  123456  '));
INSERT INTO t134 VALUES ('c1b', registrar_evidencia_orden(13401, 'comprobante_pago', '13400000-0000-0000-0000-000000000002/ordenes/13401/comprobante_pago-1.jpg', '123456'));
INSERT INTO t134 VALUES ('c2', registrar_evidencia_orden(13401, 'entrega', '13400000-0000-0000-0000-000000000002/ordenes/13401/entrega-1.jpg'));
SELECT pg_temp.ok(NOT (SELECT (v ->> 'replay')::boolean FROM t134 WHERE k = 'c1') AND (SELECT (v ->> 'replay')::boolean FROM t134 WHERE k = 'c1b')
  AND (SELECT v ->> 'id' FROM t134 WHERE k = 'c1') = (SELECT v ->> 'id' FROM t134 WHERE k = 'c1b')
  AND (SELECT count(*) = 2 FROM orden_evidencias WHERE orden_id = 13401),
  '134-02 comprobante y foto de entrega registrados; el reintento con la misma foto no duplica');
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13402, 'entrega', '13400000-0000-0000-0000-000000000002/ordenes/13402/entrega-1.jpg')$q$, '134-03 venta que no es de su ruta: rechazada', '%no es de tu ruta%');
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'entrega', '13400000-0000-0000-0000-000000000003/ordenes/13401/entrega-9.jpg')$q$, '134-04 foto subida por otra persona: rechazada', '%no corresponde a esta venta%');
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'entrega', '13400000-0000-0000-0000-000000000002/ordenes/13401/no-existe.jpg')$q$, '134-05 foto que no se subió: rechazada', '%no se subió%');
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'selfie', '13400000-0000-0000-0000-000000000002/ordenes/13401/entrega-1.jpg')$q$, '134-06 tipo desconocido: rechazado', '%tipo%');
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'entrega', '13400000-0000-0000-0000-000000000002/ordenes/13401/comprobante_pago-1.jpg')$q$, '134-07 la misma foto con otro tipo: rechazada', '%ya está registrada%');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM orden_evidencias), '134-08 el chofer ve las evidencias que él subió');
SELECT pg_temp.ok(erp_foto_merma_en_uso('13400000-0000-0000-0000-000000000002/ordenes/13401/entrega-1.jpg')
  AND NOT erp_foto_merma_en_uso('13400000-0000-0000-0000-000000000002/ordenes/13402/entrega-1.jpg'),
  '134-09 una foto ya ligada a una venta queda protegida contra el borrado del archivo; una sin ligar, no');
SELECT pg_temp.falla($q$DELETE FROM orden_evidencias$q$, '134-10 por API no se borra', '%permission denied%');

\echo '── 134: otros roles'
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'entrega', '13400000-0000-0000-0000-000000000003/ordenes/13401/entrega-9.jpg')$q$, '134-11 otro chofer: la venta no es de su ruta', '%no es de tu ruta%');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM orden_evidencias), '134-12 otro chofer no ve evidencias ajenas');
SELECT pg_temp.como(4);
INSERT INTO t134 VALUES ('v1', registrar_evidencia_orden(13401, 'comprobante_pago', '13400000-0000-0000-0000-000000000004/ordenes/13401/comprobante_pago-2.jpg'));
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13402, 'entrega', '13400000-0000-0000-0000-000000000004/ordenes/13402/entrega-2.jpg')$q$, '134-14 Ventas en una venta de otro vendedor: rechazada', '%no es tuya%');
SELECT pg_temp.como(5);
SELECT pg_temp.falla($q$SELECT registrar_evidencia_orden(13401, 'entrega', 'x')$q$, '134-15 Empleado: no autorizado', '%no autorizado%');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM orden_evidencias), '134-16 Empleado no lee evidencias');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((SELECT count(*) = 3 FROM orden_evidencias WHERE orden_id = 13401)
  AND (SELECT referencia = '123456' AND subido_por = 13402 AND subido_por_nombre <> '' FROM orden_evidencias WHERE foto_path LIKE '%comprobante_pago-1.jpg'),
  '134-13/17 Ventas registra en SU venta; Admin ve todas, con referencia y quién la subió');
RESET ROLE;
SELECT pg_temp.falla($q$UPDATE orden_evidencias SET referencia = 'x'$q$, '134-18 la evidencia es inmutable (también sin JWT)', '%inmutable%');
SELECT pg_temp.ok((SELECT estatus = 'Entregada' AND total = 100 FROM ordenes WHERE id = 13401) AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id IN (13401, 13402)),
  '134-19 registrar evidencia no toca la orden ni crea pagos');

ROLLBACK;
\echo '── 134: TODAS LAS PRUEBAS OK'
