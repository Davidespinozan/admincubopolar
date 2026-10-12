-- 141_venta_rapida_ruta_test.sql — T5-D1: la venta rápida se registra en el servidor
-- cuando ocurre (orden + cobro o cuenta por cobrar en una transacción), es idempotente,
-- respeta la carga (138) y el crédito (139), convive con el cierre financiero sin
-- duplicar nada y se rechaza con la ruta cerrada. Todo en UNA transacción con ROLLBACK.
-- (La concurrencia con dos conexiones corre en el runner: C141a–f.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14100000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t141' FROM generate_series(1, 20) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14101, 'Admin T141',    'u1@t141', 'Admin',    'Activo', '14100000-0000-0000-0000-000000000001'),
  (14105, 'Ventas T141',   'u5@t141', 'Ventas',   'Activo', '14100000-0000-0000-0000-000000000005'),
  (14106, 'Empleado T141', 'u6@t141', 'Empleado', 'Activo', '14100000-0000-0000-0000-000000000006'),
  (14107, 'Produccion T141', 'u7@t141', 'Producción', 'Activo', '14100000-0000-0000-0000-000000000007');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
  SELECT 14100 + n, 'Chofer T141-' || n, 'u' || n || '@t141', 'Chofer', 'Activo', ('14100000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(10, 15) n;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P141-A', 'Hielo A141', 'Producto Terminado', 30, 0, 0), ('P141-B', 'Hielo B141', 'Producto Terminado', 50, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-141', 'Cuarto 141', '{"P141-A": 500, "P141-B": 100}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (14101, 'SinCredito T141', 'XAXX010101000', 0, false, 5000),
  (14102, 'LimiteCero T141', 'XAXX010101000', 0, true,  0),
  (14103, 'Amplio T141',     'AAA010101AAA',  0, true,  1000),
  (14104, 'Justo T141',      'XAXX010101000', 0, true,  100),
  (14105, 'Contado T141',    'XAXX010101000', 0, false, 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (14101, 'R-14101', 'principal',    14110, 'Chofer T141-10', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 60, "P141-B": 5}', '{"P141-A": 60, "P141-B": 5}', '{}', '{"P141-A": 60, "P141-B": 5}', now()),
  (14102, 'R-14102', 'convivencia',  14111, 'Chofer T141-11', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 10}', '{"P141-A": 10}', '{}', '{"P141-A": 10}', now()),
  (14103, 'R-14103', 'carga corta',  14112, 'Chofer T141-12', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 3}',  '{"P141-A": 3}',  '{}', '{"P141-A": 3}',  now()),
  (14104, 'R-14104', 'sin salir',    14113, 'Chofer T141-13', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 10}', '{"P141-A": 10}', '{}', '{"P141-A": 10}', now()),
  (14105, 'R-14105', 'medianoche',   14114, 'Chofer T141-14', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 10}', '{"P141-A": 10}', '{}', '{"P141-A": 10}', now()),
  (14106, 'R-14106', 'camino viejo', 14115, 'Chofer T141-15', 'Pendiente firma', CURRENT_DATE, '{"P141-A": 10}', '{"P141-A": 10}', '{}', '{"P141-A": 10}', now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (14191, 'OV-14191', 14105, 'Contado T141', '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 14105, 14101),
  (14192, 'OV-14192', 14105, 'Contado T141', '2×A', 60,  'Asignada', 'Efectivo', 'Contado', 14105, 14102);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14191, 'P141-A', 4, 30, 120), (14192, 'P141-A', 2, 30, 60);
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
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"14100000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14100000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Foto de una ruta: órdenes|entregadas|pagos|suma pagos|cuentas por cobrar|saldo CxC|ventas rápidas|auditoría de venta rápida
CREATE OR REPLACE FUNCTION pg_temp.foto(p_ruta BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.ordenes WHERE ruta_id = p_ruta), (SELECT count(*) FROM public.ordenes WHERE ruta_id = p_ruta AND estatus = 'Entregada'),
    (SELECT count(*) FROM public.pagos p JOIN public.ordenes o ON o.id = p.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT COALESCE(sum(p.monto), 0)::int FROM public.pagos p JOIN public.ordenes o ON o.id = p.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT count(*) FROM public.cuentas_por_cobrar x JOIN public.ordenes o ON o.id = x.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT COALESCE(sum(x.saldo_pendiente), 0)::int FROM public.cuentas_por_cobrar x JOIN public.ordenes o ON o.id = x.orden_id WHERE o.ruta_id = p_ruta),
    (SELECT count(*) FROM public.ventas_rapidas_ruta WHERE ruta_id = p_ruta),
    (SELECT count(*) FROM public.auditoria WHERE modulo = 'Rutas' AND accion = 'Venta rápida' AND detalle LIKE '%(ruta R-' || p_ruta || ')%')) $$;
CREATE OR REPLACE FUNCTION pg_temp.bal(p_ruta BIGINT, p_sku TEXT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT cargado || '|' || entregado || '|' || merma || '|' || devuelto FROM public.ruta_inventario_resumen(p_ruta) WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION pg_temp.saldo(p_cli BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT saldo::int FROM public.clientes WHERE id = p_cli) || '=' || (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM public.cuentas_por_cobrar WHERE cliente_id = p_cli AND estatus IS DISTINCT FROM 'Pagada') $$;
CREATE OR REPLACE FUNCTION pg_temp.kardex() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.inventario_mov WHERE producto LIKE 'P141-%'), (SELECT stock ->> 'P141-A' FROM public.cuartos_frios WHERE id = 'CF-141')) $$;
CREATE OR REPLACE FUNCTION pg_temp.ord(p_id BIGINT) RETURNS public.ordenes LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.ordenes WHERE id = p_id $$;
CREATE TEMP TABLE t141 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t141 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t141 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.vr(p_op INTEGER, p_ruta BIGINT, p_cli BIGINT, p_items TEXT, p_metodo TEXT, p_factura BOOLEAN DEFAULT false, p_ref TEXT DEFAULT NULL, p_capt TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE sql AS $$ SELECT registrar_venta_rapida_ruta(pg_temp.op(p_op), p_ruta, p_cli, NULL, p_items::jsonb, p_metodo, p_factura, p_ref, p_capt) $$;

\echo '── 141: catálogo'
SELECT pg_temp.ok((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.registrar_venta_rapida_ruta(uuid,bigint,bigint,text,jsonb,text,boolean,text,timestamptz)'::regprocedure)
  AND (SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
              AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.ventas_rapidas_de_ruta(bigint)'::regprocedure),
  '141-01 contratos SECURITY DEFINER con search_path fijo, sin anon');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ventas_rapidas_ruta'::regclass)
  AND (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ventas_rapidas_ruta')
  AND NOT has_table_privilege('authenticated', 'public.ventas_rapidas_ruta', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.ventas_rapidas_ruta', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.ventas_rapidas_ruta', 'SELECT'),
  '141-02 la tabla de registro no tiene acceso por API (RLS activa, sin policies, sin grants)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.fin_validar_credito(bigint,numeric)'::regprocedure)) = '7bb429dd3220d8fe7febe8bf3fe2f219'
  AND md5(pg_get_functiondef('public.crear_cxc_orden(bigint,integer)'::regprocedure)) = 'bee6bcb201f0ee8e88a9bb2de9f99788'
  AND md5(pg_get_functiondef('public.registrar_pago_orden(bigint,text,text,bigint)'::regprocedure)) = 'add148ab82529ea5f3b2c4d2fcdb10ca'
  AND md5(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)) = 'a4e627685850db7af897d3239e1a0dc5'
  AND md5(pg_get_functiondef('public.ordenes_guard_carga_ruta()'::regprocedure)) = 'f9669b57ee94de6905f6eb3ddb4c8473'
  AND md5(pg_get_functiondef('public.entregar_orden_ruta(uuid,bigint,text,text,text)'::regprocedure)) = '29967d7a0208ae34f279838a35e87f04'
  AND md5(pg_get_functiondef('public.ordenes_guard_credito_entrega()'::regprocedure)) = 'a9c59333122fc17f8efb86fd1fe3cc6e',
  '141-03 NO cambian crédito, cuenta por cobrar, pago, cierre financiero, guarda de carga (138) ni entrega y guarda de crédito (139): md5 = producción');

\echo '── 141: cargas por contrato'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES (14101, 10), (14102, 11), (14103, 12), (14105, 14), (14106, 15)) x(ruta, n) LOOP
    PERFORM pg_temp.como(r.n);
    SET LOCAL ROLE authenticated;
    PERFORM confirmar_carga_ruta(('14100000-0000-0000-0000-0000000c' || lpad((r.ruta - 14100)::text, 4, '0'))::uuid, r.ruta::bigint, 'data:image/png;base64,QQ==');
    UPDATE rutas SET estatus = 'En progreso' WHERE id = r.ruta;
    RESET ROLE;
  END LOOP;
END $$;
INSERT INTO t141 VALUES ('k0', to_jsonb(pg_temp.kardex()));
SELECT pg_temp.ok(pg_temp.foto(14101) = '1|0|0|0|0|0|0|0' AND pg_temp.bal(14101, 'P141-A') = '60|0|0|0', '141-04 cinco rutas cargadas; la ruta principal sale sin ventas');

\echo '── 141: venta rápida en efectivo — queda en el servidor al capturarla'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('v1', pg_temp.vr(1, 14101, NULL, '[{"sku": "P141-A", "cant": 2, "precio": 30}]', 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1') ->> 'ok')::boolean AND NOT (pg_temp.j('v1') ->> 'replay')::boolean AND pg_temp.j('v1') ->> 'via' = 'contado'
  AND (pg_temp.j('v1') ->> 'total')::numeric = 60 AND pg_temp.j('v1') ->> 'folio' LIKE 'OV-%' AND (pg_temp.j('v1') ->> 'pago_id') IS NOT NULL AND (pg_temp.j('v1') ->> 'cxc_id') IS NULL,
  '141-05 respuesta: orden nueva con folio, $60 de contado, con su pago');
SELECT pg_temp.ok((SELECT o.estatus = 'Entregada' AND o.ruta_id = 14101 AND o.metodo_pago = 'Efectivo' AND o.tipo_cobro = 'Contado' AND o.total = 60 AND o.cliente_id IS NULL
                          AND o.cliente_nombre = 'Público en general' AND o.vendedor_id = 14110 AND o.fecha = fin_hoy() AND NOT COALESCE(o.requiere_factura, false)
                     FROM pg_temp.ord((pg_temp.j('v1') ->> 'orden_id')::bigint) o)
  AND (SELECT count(*) = 1 AND min(cantidad) = 2 AND min(precio_unit) = 30 FROM orden_lineas WHERE orden_id = (pg_temp.j('v1') ->> 'orden_id')::bigint),
  '141-06 la orden nace Entregada en la ruta, con sus líneas al precio del servidor, atribuida al chofer y con la fecha de negocio');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14101) = '2|1|1|60|0|0|1|1' AND pg_temp.bal(14101, 'P141-A') = '60|2|0|0' AND pg_temp.kardex() = pg_temp.j('k0') #>> '{}',
  '141-07 un pago de $60, una fila de registro, una línea de auditoría; el camión cuenta 2 entregadas; el kardex de cuartos no se mueve');

\echo '── 141: idempotencia'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('v1r', pg_temp.vr(1, 14101, NULL, '[{"sku": "P141-A", "cant": 2, "precio": 30}]', 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1r') ->> 'replay')::boolean AND pg_temp.j('v1r') ->> 'orden_id' = pg_temp.j('v1') ->> 'orden_id' AND pg_temp.j('v1r') ->> 'folio' = pg_temp.j('v1') ->> 'folio',
  '141-08 la misma operación otra vez (doble toque, respuesta perdida): misma orden, replay');
SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('v1r2', pg_temp.vr(1, 14101, NULL, '[{"sku": "P141-A", "cantidad": 2}]', 'Efectivo', false, NULL, now() - interval '1 minute'));
SELECT pg_temp.ok((pg_temp.j('v1r2') ->> 'replay')::boolean, '141-09 el reintento sin precio y con otra hora de captura sigue siendo la misma venta');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(1, 14101, NULL, '[{"sku": "P141-A", "cant": 3}]', 'Efectivo')$q$, '141-10 la misma operación con otra cantidad: rechazada', '23505', '%operacion_id ya usado con otra venta%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(1, 14101, NULL, '[{"sku": "P141-A", "cant": 2}]', 'Tarjeta')$q$, '141-11 la misma operación con otro método: rechazada', '23505', '%operacion_id ya usado con otra venta%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14101) = '2|1|1|60|0|0|1|1', '141-12 tras tres reintentos y dos rechazos: UNA orden, UN pago, UNA fila');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('v2', pg_temp.vr(2, 14101, NULL, '[{"sku": "P141-A", "cant": 2, "precio": 30}]', 'Efectivo'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('v2') ->> 'orden_id' <> pg_temp.j('v1') ->> 'orden_id' AND pg_temp.foto(14101) = '3|2|2|120|0|0|2|2',
  '141-13 otra operación con los mismos datos es OTRA venta (dos ventas iguales seguidas son legítimas)');

\echo '── 141: crédito (reglas de 139) a 30 días'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(10, 14101, 14101, '[{"sku": "P141-A", "cant": 1}]', 'Crédito')$q$,
  '141-14 cliente sin crédito autorizado: rechazado', '22023', '%No se puede fiar esta venta%no tiene crédito autorizado%No se registró nada%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(11, 14101, 14102, '[{"sku": "P141-A", "cant": 1}]', 'Crédito')$q$,
  '141-15 autorizado con límite 0 = sin capacidad: rechazado', '22023', '%No se puede fiar esta venta%Excede límite de crédito. Disponible: 0%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(12, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Crédito')$q$,
  '141-16 fiado sin cliente registrado: rechazado', '22023', '%el crédito necesita un cliente registrado%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(13, 14101, 14104, '[{"sku": "P141-A", "cant": 4}]', 'Crédito')$q$,
  '141-17 fiado que excede el límite (120 > 100): rechazado', '22023', '%No se puede fiar esta venta%Excede límite de crédito%', 'CREDITO_RECHAZADO');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14101) = '3|2|2|120|0|0|2|2' AND pg_temp.saldo(14101) = '0=0' AND pg_temp.saldo(14102) = '0=0' AND pg_temp.saldo(14104) = '0=0',
  '141-18 los fiados rechazados no dejan NADA: ni orden, ni deuda, ni saldo, ni registro, ni auditoría');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('c1', pg_temp.vr(14, 14101, 14103, '[{"sku": "P141-A", "cant": 3, "precio": 30}]', 'Crédito'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('c1') ->> 'via' = 'credito' AND (pg_temp.j('c1') ->> 'cxc_id') IS NOT NULL AND (pg_temp.j('c1') ->> 'pago_id') IS NULL
  AND (SELECT x.monto_original = 90 AND x.saldo_pendiente = 90 AND x.cliente_id = 14103 AND x.fecha_vencimiento = x.fecha_venta + 30
         FROM cuentas_por_cobrar x WHERE x.orden_id = (pg_temp.j('c1') ->> 'orden_id')::bigint)
  AND (SELECT o.tipo_cobro = 'Credito' AND o.metodo_pago = 'Crédito' AND o.estatus = 'Entregada' FROM ordenes o WHERE o.id = (pg_temp.j('c1') ->> 'orden_id')::bigint)
  AND pg_temp.saldo(14103) = '90=90' AND pg_temp.foto(14101) = '4|3|2|120|1|90|3|3',
  '141-19 fiado válido: orden Entregada + cuenta por cobrar de $90 que vence a 30 DÍAS, saldo del cliente = su cuenta, sin cobro inventado');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('c2', pg_temp.vr(15, 14101, 14104, '[{"sku": "P141-A", "cant": 3}]', 'Crédito'));
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(16, 14101, 14104, '[{"sku": "P141-A", "cant": 1}]', 'Crédito')$q$,
  '141-20 el segundo fiado al mismo cliente cuenta el primero (90 + 30 > 100): rechazado', '22023', '%Excede límite de crédito%', 'CREDITO_RECHAZADO');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.saldo(14104) = '90=90', '141-21 el cliente justo quedó con su único fiado');

\echo '── 141: validaciones'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(20, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'QR / Link de pago')$q$, '141-22 la venta rápida no admite link de pago', '22023', '%método de pago inválido%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(21, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Cheque')$q$, '141-23 método desconocido', '22023', '%método de pago inválido%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(22, 14101, NULL, '[{"sku": "P141-A", "cant": 1, "precio": 25}]', 'Efectivo')$q$,
  '141-24 el precio del teléfono no es el vigente: rechazada (no se cobra un precio viejo)', '22023', '%El precio de P141-A cambió%', 'PRECIO_CAMBIO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(23, 14101, NULL, '[]', 'Efectivo')$q$, '141-25 sin productos', '22023', '%no tiene productos%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(24, 14101, NULL, '[{"sku": "P141-A", "cant": 0}]', 'Efectivo')$q$, '141-26 cantidad cero', '22023', '%cantidad inválida%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(25, 14101, NULL, '[{"sku": "P141-A", "cant": 1.5}]', 'Efectivo')$q$, '141-27 cantidad con decimales', '22023', '%cantidad inválida%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(26, 14101, NULL, '[{"sku": "P141-A", "cant": -2}]', 'Efectivo')$q$, '141-28 cantidad negativa', '22023', '%cantidad inválida%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(27, 14101, NULL, '[{"sku": "NO-EXISTE", "cant": 1}]', 'Efectivo')$q$, '141-29 producto desconocido', '22023', '%SKU no encontrado%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(28, 14101, NULL, '[{"sku": "P141-A", "cant": 1}, {"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-30 producto repetido', '22023', '%SKU repetido%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(29, 14101, 999999, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-31 cliente inexistente', '22023', '%cliente no encontrado%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(30, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', true)$q$, '141-32 factura sin cliente', '22023', '%factura sin cliente%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(31, 14101, 14105, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', true)$q$, '141-33 factura a cliente con RFC genérico', '22023', '%no tiene RFC nominativo%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT registrar_venta_rapida_ruta(NULL, 14101, NULL, NULL, '[{"sku": "P141-A", "cant": 1}]'::jsonb, 'Efectivo')$q$, '141-34 sin operación', '22023', '%operacion_id es obligatorio%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(32, 999999, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-35 ruta inexistente', '22023', '%ruta no encontrada%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14101) = '5|4|2|120|2|180|4|4', '141-36 ninguna validación rechazada dejó efectos');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('f1', registrar_venta_rapida_ruta(pg_temp.op(33), 14101, 14103, 'Amplio (mostrador)', '[{"sku": "P141-A", "cant": 1}, {"sku": "P141-B", "cant": 2}]'::jsonb, 'Transferencia', true, 'SPEI-141-1'));
RESET ROLE;
SELECT pg_temp.ok((SELECT o.requiere_factura AND o.total = 130 AND o.cliente_id = 14103 AND o.cliente_nombre = 'Amplio (mostrador)' AND o.metodo_pago = 'Transferencia'
                     FROM ordenes o WHERE o.id = (pg_temp.j('f1') ->> 'orden_id')::bigint)
  AND (SELECT count(*) = 2 FROM orden_lineas WHERE orden_id = (pg_temp.j('f1') ->> 'orden_id')::bigint)
  AND (SELECT p.monto = 130 AND p.referencia = 'SPEI-141-1' FROM pagos p WHERE p.orden_id = (pg_temp.j('f1') ->> 'orden_id')::bigint)
  AND pg_temp.bal(14101, 'P141-B') = '5|2|0|0',
  '141-37 venta con factura, dos productos y transferencia con referencia: orden de $130 marcada para facturar y su pago');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(34, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Transferencia', false, 'SPEI-141-1')$q$,
  '141-38 referencia de pago repetida: rechazada, sin venta', '23505', '%ya está registrada en otro cobro%', 'REFERENCIA_REPETIDA');

\echo '── 141: permisos'
SELECT pg_temp.como(5);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(40, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-39 Ventas no registra ventas rápidas de ruta', '42501', '%no autorizado%');
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(41, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-40 Empleado: rechazado', '42501', '%');
SELECT pg_temp.como(7);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(42, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-41 Producción: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(43, 14101, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-42 un chofer no vende en la ruta de otro', '42501', '%la ruta no pertenece a este chofer%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT ventas_rapidas_de_ruta(14101)$q$, '141-43 el chofer no lee el listado administrativo', '42501', '%no autorizado%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT count(*) FROM ventas_rapidas_ruta$q$, '141-44 nadie lee la tabla de registro por API', '42501', '%');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$INSERT INTO ventas_rapidas_ruta (operacion_id, ruta_id, orden_id, huella, capturada_at, actor) VALUES (gen_random_uuid(), 14101, 14191, 'x', now(), 'x')$q$,
  '141-45 nadie escribe la tabla de registro por API', '42501', '%');
SELECT pg_temp.como(1);
INSERT INTO t141 VALUES ('a1', pg_temp.vr(44, 14101, 14105, '[{"sku": "P141-A", "cant": 1}]', 'Tarjeta'));
INSERT INTO t141 VALUES ('l1', ventas_rapidas_de_ruta(14101));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('a1') ->> 'ok')::boolean AND (SELECT vendedor_id = 14101 FROM ordenes WHERE id = (pg_temp.j('a1') ->> 'orden_id')::bigint),
  '141-46 Administración sí puede registrar una venta rápida en cualquier ruta en curso (queda a su nombre)');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('l1')) = 6
  AND (SELECT sum((x ->> 'cobrado')::numeric) = 280 AND sum(COALESCE((x ->> 'cxc_saldo')::numeric, 0)) = 180 AND sum((x ->> 'total')::numeric) = 460
              AND bool_and(x ->> 'actor' IS NOT NULL AND x ->> 'capturada_at' IS NOT NULL AND x ->> 'registrada_at' IS NOT NULL AND x ->> 'folio' LIKE 'OV-%')
         FROM jsonb_array_elements(pg_temp.j('l1')) x),
  '141-47 listado de Administración: 6 ventas rápidas, $460 = $280 cobrados + $180 por cobrar, con actor y horas');

\echo '── 141: carga (regla de 138) y convivencia con entregas (139)'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(12);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(50, 14103, NULL, '[{"sku": "P141-A", "cant": 4}]', 'Efectivo')$q$,
  '141-48 vender 4 con 3 en el camión: rechazada', '22023', '%no cabe en lo que queda en el camión%No se registró nada%', 'CARGA_INSUFICIENTE');
SELECT pg_temp.como(12);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(51, 14103, NULL, '[{"sku": "P141-B", "cant": 1}]', 'Efectivo')$q$,
  '141-49 vender un producto que no se cargó: rechazada', '22023', '%no cabe en lo que queda en el camión%', 'CARGA_INSUFICIENTE');
SELECT pg_temp.como(12);
INSERT INTO t141 VALUES ('s1', pg_temp.vr(52, 14103, NULL, '[{"sku": "P141-A", "cant": 3}]', 'Efectivo'));
SELECT pg_temp.como(12);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(53, 14103, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$,
  '141-50 con el camión vacío ya no entra ni una más', '22023', '%no cabe%', 'CARGA_INSUFICIENTE');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.foto(14103) = '1|1|1|90|0|0|1|1' AND pg_temp.bal(14103, 'P141-A') = '3|3|0|0', '141-51 la ruta corta quedó con UNA venta de 3 y sin rastro de los rechazos');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t141 VALUES ('e1', entregar_orden_ruta(pg_temp.op(54), 14191, 'Efectivo'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('e1') ->> 'ok')::boolean AND pg_temp.bal(14101, 'P141-A') = '60|16|0|0',
  '141-52 la entrega de una orden de la misma ruta (139) convive: el camión cuenta ventas rápidas + entregas (12 + 4)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(55, 14101, NULL, '[{"sku": "P141-A", "cant": 45}]', 'Efectivo')$q$,
  '141-53 la venta rápida cuenta lo ya entregado por órdenes (16 + 45 > 60)', '22023', '%no cabe%', 'CARGA_INSUFICIENTE');
SELECT pg_temp.como(13);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(56, 14104, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$,
  '141-54 ruta que todavía no sale (Pendiente firma): rechazada', '22023', '%todavía no sale%', 'RUTA_NO_INICIADA');
RESET ROLE;

\echo '── 141: convivencia con el cierre financiero — antes, después y sin duplicar'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('w1', pg_temp.vr(60, 14102, NULL, '[{"sku": "P141-A", "cant": 2}]', 'Efectivo'));
SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('w2', pg_temp.vr(61, 14102, 14103, '[{"sku": "P141-A", "cant": 1}]', 'Crédito'));
SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('w3', entregar_orden_ruta(pg_temp.op(62), 14192, 'Efectivo'));
RESET ROLE;
INSERT INTO t141 VALUES ('venc', (SELECT to_jsonb(fecha_vencimiento) FROM cuentas_por_cobrar WHERE orden_id = (pg_temp.j('w2') ->> 'orden_id')::bigint));
SELECT pg_temp.ok(pg_temp.foto(14102) = '3|3|2|120|1|30|2|2' AND pg_temp.saldo(14103) = '120=120', '141-55 antes del cierre: 2 ventas rápidas + 1 entrega, $120 cobrados y $30 fiados');
-- El teléfono manda al cierre lo que ve como entregado: ahora TODO son órdenes del servidor.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('cf', cerrar_ruta_financiero(pg_temp.op(63), 14102,
  jsonb_build_array(jsonb_build_object('ordenId', 14192, 'pago', 'Efectivo'),
                    jsonb_build_object('ordenId', (pg_temp.j('w1') ->> 'orden_id')::bigint, 'pago', 'Efectivo'),
                    jsonb_build_object('ordenId', (pg_temp.j('w2') ->> 'orden_id')::bigint, 'pago', 'Crédito')), 14111, 'x'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('cf') ->> 'ventas_express')::int = 0 AND (pg_temp.j('cf') ->> 'pagos')::int = 0 AND (pg_temp.j('cf') ->> 'cxc')::int = 0
  AND jsonb_array_length(pg_temp.j('cf') -> 'saltadas') = 2 AND pg_temp.foto(14102) = '3|3|2|120|1|30|2|2' AND pg_temp.saldo(14103) = '120=120'
  AND (SELECT to_jsonb(fecha_vencimiento) = pg_temp.j('venc') FROM cuentas_por_cobrar WHERE orden_id = (pg_temp.j('w2') ->> 'orden_id')::bigint),
  '141-56 el cierre financiero recibe esas ventas como órdenes ya resueltas: 0 ventas nuevas, 0 pagos, 0 cuentas; nada se duplica y el vencimiento a 30 días no cambia');
-- LA VENTA DESPUÉS DE "Registrar ventas y mermas" (el defecto de T5-D1).
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('w4', pg_temp.vr(64, 14102, NULL, '[{"sku": "P141-A", "cant": 2}]', 'Efectivo'));
INSERT INTO t141 VALUES ('b2', (SELECT jsonb_agg(to_jsonb(b)) FROM calcular_balance_ruta(14102) b));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('w4') ->> 'ok')::boolean AND pg_temp.foto(14102) = '4|4|3|180|1|30|3|3'
  AND (SELECT (x ->> 'entregado')::int = 7 AND (x ->> 'restante')::int = 3 FROM jsonb_array_elements(pg_temp.j('b2')) x WHERE x ->> 'sku' = 'P141-A'),
  '141-57 venta rápida DESPUÉS del cierre financiero: aceptada con su cobro, y el balance del camión ya la cuenta (debe regresar 3, no 5)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT finalizar_inventario_ruta(pg_temp.op(65), 14102, '{"P141-A": 5}'::jsonb)$q$,
  '141-58 el conteo que ignora esa venta (5) ya no cuadra: el servidor lo rechaza por sobrante, no la convierte en merma', '22023', '%el conteo supera el inventario del camión%');
SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('fi', finalizar_inventario_ruta(pg_temp.op(66), 14102, '{"P141-A": 3}'::jsonb));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('fi') ->> 'estatus' = 'Cerrada' AND pg_temp.bal(14102, 'P141-A') = '10|7|0|3' AND (SELECT count(*) = 0 FROM mermas WHERE ruta_id = 14102)
  AND pg_temp.foto(14102) = '4|4|3|180|1|30|3|3',
  '141-59 la ruta cierra con el conteo real (3): 10 = 7 vendidas + 3 devueltas, sin merma inventada y con los $180 en el sistema');

\echo '── 141: ruta cerrada — la venta pendiente NO se registra; el reintento de una aceptada sí responde'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(67, 14102, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$,
  '141-60 venta que llega con la ruta ya cerrada: rechazada con código para revisión', '22023', '%ya está cerrada%no se registró%Requiere revisión de Administración%', 'RUTA_CERRADA');
SELECT pg_temp.como(11);
INSERT INTO t141 VALUES ('w4r', pg_temp.vr(64, 14102, NULL, '[{"sku": "P141-A", "cant": 2}]', 'Efectivo'));
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(68, 14102, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$,
  '141-61 tampoco Administración registra ventas en una ruta cerrada', '22023', '%ya está cerrada%', 'RUTA_CERRADA');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('w4r') ->> 'replay')::boolean AND pg_temp.j('w4r') ->> 'orden_id' = pg_temp.j('w4') ->> 'orden_id' AND pg_temp.foto(14102) = '4|4|3|180|1|30|3|3'
  AND (SELECT estatus = 'Cerrada' FROM rutas WHERE id = 14102) AND pg_temp.bal(14102, 'P141-A') = '10|7|0|3',
  '141-62 el reintento de una venta YA aceptada responde igual con la ruta cerrada; la ruta cerrada no cambió (sin ventas, cobros ni órdenes fuera de ruta)');
SET LOCAL session_replication_role = replica;
UPDATE rutas SET estatus = 'Cancelada' WHERE id = 14104;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(13);
SELECT pg_temp.falla($q$SELECT pg_temp.vr(69, 14104, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo')$q$, '141-63 ruta cancelada: rechazada igual', '22023', '%ya está cancelada%', 'RUTA_CERRADA');
RESET ROLE;

\echo '── 141: camino anterior (teléfono sin actualizar) — conviven sin doble registro'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(15);
INSERT INTO t141 VALUES ('o1', pg_temp.vr(70, 14106, NULL, '[{"sku": "P141-A", "cant": 2}]', 'Efectivo'));
SELECT pg_temp.como(15);
INSERT INTO t141 VALUES ('o2', cerrar_ruta_financiero(pg_temp.op(71), 14106,
  '[{"express": true, "pago": "Efectivo", "cliente": "Público en general", "items": [{"sku": "P141-A", "cant": 3, "precio": 30}]}]'::jsonb, 14115, 'x'));
SELECT pg_temp.como(15);
INSERT INTO t141 VALUES ('o3', pg_temp.vr(72, 14106, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo'));
INSERT INTO t141 VALUES ('o4', finalizar_inventario_ruta(pg_temp.op(73), 14106, '{"P141-A": 4}'::jsonb));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('o2') ->> 'ventas_express')::int = 1 AND pg_temp.foto(14106) = '3|3|3|180|0|0|2|2' AND pg_temp.bal(14106, 'P141-A') = '10|6|0|4'
  AND pg_temp.j('o4') ->> 'estatus' = 'Cerrada',
  '141-64 una venta individual + una venta dentro del cierre (versión anterior) + otra individual después: 3 órdenes, 3 pagos ($180), 6 vendidas, cierra con 4');

\echo '── 141: fecha de la venta y cruce de medianoche (zona de negocio)'
SET LOCAL session_replication_role = replica;
UPDATE rutas SET carga_confirmada_at = now() - interval '3 days' WHERE id = 14105;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m1', pg_temp.vr(80, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', false, NULL,
  ((fin_hoy() - 1)::text || ' 23:59:30')::timestamp AT TIME ZONE fin_zona_negocio()));
SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m2', pg_temp.vr(81, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', false, NULL,
  ((fin_hoy() - 1)::text || ' 00:00:30')::timestamp AT TIME ZONE fin_zona_negocio()));
SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m3', pg_temp.vr(82, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', false, NULL,
  ((fin_hoy() - 2)::text || ' 23:59:30')::timestamp AT TIME ZONE fin_zona_negocio()));
SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m4', pg_temp.vr(83, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', false, NULL, now() + interval '2 days'));
SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m5', pg_temp.vr(84, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo', false, NULL, now() - interval '30 days'));
SELECT pg_temp.como(14);
INSERT INTO t141 VALUES ('m6', pg_temp.vr(85, 14105, NULL, '[{"sku": "P141-A", "cant": 1}]', 'Efectivo'));
RESET ROLE;
SELECT pg_temp.ok((SELECT fecha = fin_hoy() - 1 FROM ordenes WHERE id = (pg_temp.j('m1') ->> 'orden_id')::bigint)
  AND (SELECT fecha = fin_hoy() - 1 FROM ordenes WHERE id = (pg_temp.j('m2') ->> 'orden_id')::bigint)
  AND (SELECT fecha = fin_hoy() - 2 FROM ordenes WHERE id = (pg_temp.j('m3') ->> 'orden_id')::bigint),
  '141-65 medianoche: 23:59:30 de anteayer y 00:00:30 de ayer (un minuto de diferencia) caen en días de negocio distintos; 23:59:30 de ayer es de ayer');
SELECT pg_temp.ok((SELECT fecha = fin_hoy() FROM ordenes WHERE id = (pg_temp.j('m4') ->> 'orden_id')::bigint)
  AND (SELECT fecha = fin_dia_negocio((SELECT carga_confirmada_at FROM rutas WHERE id = 14105)) FROM ordenes WHERE id = (pg_temp.j('m5') ->> 'orden_id')::bigint)
  AND (SELECT fecha = fin_hoy() FROM ordenes WHERE id = (pg_temp.j('m6') ->> 'orden_id')::bigint)
  AND (SELECT capturada_at <= now() FROM ventas_rapidas_ruta WHERE operacion_id = pg_temp.op(83))
  AND (SELECT capturada_at = (SELECT carga_confirmada_at FROM rutas WHERE id = 14105) FROM ventas_rapidas_ruta WHERE operacion_id = pg_temp.op(84)),
  '141-66 la hora del teléfono se acota: una hora futura cuenta como ahora, una anterior a la salida cuenta como la salida, sin hora = ahora');
SELECT pg_temp.ok((SELECT count(*) = 6 AND bool_and(p.fecha = fin_hoy()) FROM pagos p JOIN ventas_rapidas_ruta v ON v.orden_id = p.orden_id WHERE v.ruta_id = 14105),
  '141-67 el cobro lleva la fecha en que el servidor lo recibió (hoy), aunque la venta sea de ayer: efectivo recibido y todavía no conciliado no se fecha hacia atrás');

\echo '── 141: integridad final'
SELECT pg_temp.ok((SELECT count(*) = 0 FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id WHERE o.ruta_id IS DISTINCT FROM v.ruta_id OR o.estatus <> 'Entregada')
  AND (SELECT count(*) = 0 FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id
        WHERE o.total <> COALESCE((SELECT sum(p.monto) FROM pagos p WHERE p.orden_id = o.id), 0) + COALESCE((SELECT sum(x.monto_original) FROM cuentas_por_cobrar x WHERE x.orden_id = o.id), 0))
  AND (SELECT count(*) = 0 FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id
        WHERE o.total <> (SELECT sum(l.subtotal) FROM orden_lineas l WHERE l.orden_id = o.id)),
  '141-68 cada venta rápida: una orden Entregada de su ruta, total = líneas, y total = cobro + cuenta por cobrar (ni de más ni de menos)');
SELECT pg_temp.ok((SELECT count(*) = count(DISTINCT orden_id) AND count(*) = count(DISTINCT operacion_id) FROM ventas_rapidas_ruta)
  AND (SELECT count(*) = 0 FROM (SELECT orden_id FROM pagos WHERE orden_id IN (SELECT orden_id FROM ventas_rapidas_ruta) GROUP BY 1 HAVING count(*) > 1) d)
  AND (SELECT count(*) = 0 FROM (SELECT orden_id FROM cuentas_por_cobrar WHERE orden_id IN (SELECT orden_id FROM ventas_rapidas_ruta) GROUP BY 1 HAVING count(*) > 1) d),
  '141-69 sin duplicados: una operación = una orden = un cobro o una cuenta');
SELECT pg_temp.ok(pg_temp.saldo(14103) = '120=120' AND pg_temp.saldo(14104) = '90=90' AND pg_temp.saldo(14101) = '0=0' AND pg_temp.saldo(14102) = '0=0' AND pg_temp.saldo(14105) = '0=0',
  '141-70 saldo de cada cliente = suma de sus cuentas por cobrar abiertas');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM ruta_inventario_resumen(14101) b WHERE b.entregado + b.merma + b.devuelto > b.cargado)
  AND (SELECT count(*) = 0 FROM ruta_inventario_resumen(14103) b WHERE b.entregado + b.merma + b.devuelto > b.cargado)
  AND (SELECT count(*) = 0 FROM ruta_inventario_resumen(14105) b WHERE b.entregado + b.merma + b.devuelto > b.cargado),
  '141-71 en ninguna ruta lo vendido supera lo cargado');
SELECT pg_temp.ok((SELECT count(*) FROM auditoria WHERE modulo = 'Rutas' AND accion = 'Venta rápida' AND detalle LIKE '%(ruta R-141%') = (SELECT count(*) FROM ventas_rapidas_ruta WHERE ruta_id BETWEEN 14101 AND 14106),
  '141-72 auditoría: una línea por cada venta que SÍ ocurrió, ninguna por los rechazos');

ROLLBACK;
\echo '── 141: TODAS LAS PRUEBAS OK'
