-- 139_entrega_ruta_atomica_test.sql — T5-B: la entrega de ruta y su obligación
-- financiera van en una sola transacción; el fiado se valida en el servidor
-- (autorización, límite 0 = sin capacidad, saldo usado) y nada queda Entregado a
-- crédito sin cuenta por cobrar. Todo dentro de UNA transacción con ROLLBACK.
-- (La concurrencia con dos conexiones corre en el runner: C139a–f.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('13900000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t139' FROM generate_series(1, 20) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13901, 'Admin T139',    'u1@t139', 'Admin',    'Activo', '13900000-0000-0000-0000-000000000001'),
  (13905, 'Ventas T139',   'u5@t139', 'Ventas',   'Activo', '13900000-0000-0000-0000-000000000005'),
  (13906, 'Empleado T139', 'u6@t139', 'Empleado', 'Activo', '13900000-0000-0000-0000-000000000006');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
  SELECT 13900 + n, 'Chofer T139-' || n, 'u' || n || '@t139', 'Chofer', 'Activo', ('13900000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(10, 14) n;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P139-A', 'Hielo A139', 'Producto Terminado', 30, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-139', 'Cuarto 139', '{"P139-A": 500}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (13901, 'SinCredito T139', 'XAXX010101000', 0,   false, 5000),   -- límite capturado pero SIN autorización
  (13902, 'LimiteCero T139', 'XAXX010101000', 0,   true,  0),      -- autorizado, límite 0 = sin capacidad
  (13903, 'Amplio T139',     'XAXX010101000', 0,   true,  1000),
  (13904, 'Justo T139',      'XAXX010101000', 180, true,  300),    -- ya debe 180: le quedan 120
  (13905, 'Contado T139',    'XAXX010101000', 0,   false, 0);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, delivered_at) VALUES
  (13990, 'OV-13990', 13904, 'Justo T139', '6×A', 180, 'Entregada', 'Crédito', 'Credito', now() - interval '3 days');
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (13990, 'P139-A', 6, 30, 180);
INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, concepto, estatus)
  VALUES (13904, 13990, CURRENT_DATE - 3, CURRENT_DATE + 27, 180, 0, 180, 'OV-13990 — Justo T139', 'Pendiente');
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (13901, 'R-13901', 'fiado',            13910, 'Chofer T139-10', 'Pendiente firma', CURRENT_DATE, '{"P139-A": 60}', '{"P139-A": 60}', '{}', '{"P139-A": 60}', now()),
  (13902, 'R-13902', 'cierre con fiado', 13911, 'Chofer T139-11', 'Pendiente firma', CURRENT_DATE, '{"P139-A": 10}', '{"P139-A": 10}', '{}', '{"P139-A": 10}', now()),
  (13903, 'R-13903', 'cierre rechazado', 13912, 'Chofer T139-12', 'Pendiente firma', CURRENT_DATE, '{"P139-A": 10}', '{"P139-A": 10}', '{}', '{"P139-A": 10}', now()),
  (13904, 'R-13904', 'estado anterior',  13913, 'Chofer T139-13', 'Pendiente firma', CURRENT_DATE, '{"P139-A": 20}', '{"P139-A": 20}', '{}', '{"P139-A": 20}', now()),
  (13905, 'R-13905', 'carga corta',      13914, 'Chofer T139-14', 'Pendiente firma', CURRENT_DATE, '{"P139-A": 3}',  '{"P139-A": 3}',  '{}', '{"P139-A": 3}',  now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (13901, 'OV-13901', 13901, 'SinCredito T139', '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  (13902, 'OV-13902', 13902, 'LimiteCero T139', '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13901),
  (13903, 'OV-13903', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13901),
  (13904, 'OV-13904', 13904, 'Justo T139',      '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13901),
  (13905, 'OV-13905', 13904, 'Justo T139',      '1×A', 30,  'Asignada', 'Crédito',  'Credito', 13905, 13901),
  (13906, 'OV-13906', 13905, 'Contado T139',    '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  (13907, 'OV-13907', 13905, 'Contado T139',    '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  (13908, 'OV-13908', 13905, 'Contado T139',    '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  (13909, 'OV-13909', NULL,  'Público',         '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  (13910, 'OV-13910', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13901),
  (13911, 'OV-13911', 13903, 'Amplio T139',     '4×A', 120, 'Cancelada','Efectivo', 'Contado', 13905, 13901),
  (13912, 'OV-13912', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, NULL),
  (13913, 'OV-13913', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13901),
  -- ruta 13902: cierre con un fiado válido y un contado
  (13921, 'OV-13921', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13902),
  (13922, 'OV-13922', 13905, 'Contado T139',    '4×A', 120, 'Asignada', 'Efectivo', 'Contado', 13905, 13902),
  -- ruta 13903: fiado rechazado y cierre
  (13931, 'OV-13931', 13902, 'LimiteCero T139', '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13903),
  -- ruta 13904: estados anteriores a 139 (Entregada a crédito sin cuenta por cobrar)
  (13941, 'OV-13941', 13902, 'LimiteCero T139', '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13904),
  (13942, 'OV-13942', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13904),
  -- ruta 13905: carga de 3, la orden pide 4
  (13951, 'OV-13951', 13903, 'Amplio T139',     '4×A', 120, 'Asignada', 'Crédito',  'Credito', 13905, 13905);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT id, 'P139-A', (total / 30)::int, 30, total FROM ordenes WHERE id BETWEEN 13901 AND 13951;
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
-- Actor de la llamada. En la API cada llamada es su propia transacción; aquí todo corre en una,
-- así que la marca de contrato (app.fin_ctx, local a la transacción) se limpia en cada cambio.
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"13900000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.est(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus || '|' || metodo_pago FROM public.ordenes WHERE id = p_id $$;
-- Dinero de una orden: pagos|suma|movimientos|cuentas por cobrar|saldo de su cuenta
CREATE OR REPLACE FUNCTION pg_temp.dinero(p_orden BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.pagos WHERE orden_id = p_orden), (SELECT COALESCE(sum(monto), 0)::int FROM public.pagos WHERE orden_id = p_orden),
                        (SELECT count(*) FROM public.movimientos_contables WHERE orden_id = p_orden), (SELECT count(*) FROM public.cuentas_por_cobrar WHERE orden_id = p_orden),
                        (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM public.cuentas_por_cobrar WHERE orden_id = p_orden)) $$;
CREATE OR REPLACE FUNCTION pg_temp.saldo(p_cli BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT saldo::int FROM public.clientes WHERE id = p_cli) || '=' || (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM public.cuentas_por_cobrar WHERE cliente_id = p_cli AND estatus IS DISTINCT FROM 'Pagada') $$;
CREATE OR REPLACE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.inventario_mov WHERE producto = 'P139-A'), (SELECT stock ->> 'P139-A' FROM public.cuartos_frios WHERE id = 'CF-139')) $$;
CREATE OR REPLACE FUNCTION pg_temp.aud(p_folio TEXT, p_accion TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.auditoria WHERE modulo = 'Rutas' AND accion = p_accion AND detalle LIKE p_folio || '%' $$;
CREATE TEMP TABLE t139 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t139 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t139 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('13900000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;

\echo '── 139: catálogo'
SELECT pg_temp.ok((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.entregar_orden_ruta(uuid,bigint,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
              AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.ordenes_guard_credito_entrega()'::regprocedure)
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_credito_entrega' AND NOT tgisinternal),
  '139-01 contrato (SECURITY DEFINER, search_path fijo, sin anon) y guarda interna con su disparador');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.fin_validar_credito(bigint,numeric)'::regprocedure)) = '7bb429dd3220d8fe7febe8bf3fe2f219'
  AND md5(pg_get_functiondef('public.crear_cxc_orden(bigint,integer)'::regprocedure)) = 'bee6bcb201f0ee8e88a9bb2de9f99788'
  AND md5(pg_get_functiondef('public.registrar_pago_orden(bigint,text,text,bigint)'::regprocedure)) = 'add148ab82529ea5f3b2c4d2fcdb10ca'
  AND md5(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)) = 'a4e627685850db7af897d3239e1a0dc5'
  AND md5(pg_get_functiondef('public.ordenes_guard_carga_ruta()'::regprocedure)) = 'f9669b57ee94de6905f6eb3ddb4c8473',
  '139-02 NO cambian la regla de crédito, la cuenta por cobrar, el pago, el cierre financiero ni la guarda de carga de 138 (md5 = producción)');

\echo '── 139: cargas por contrato'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES (13901, 10), (13902, 11), (13903, 12), (13904, 13), (13905, 14)) x(ruta, n) LOOP
    PERFORM pg_temp.como(r.n);
    SET LOCAL ROLE authenticated;
    PERFORM confirmar_carga_ruta(('13900000-0000-0000-0000-0000000c' || lpad((r.ruta - 13900)::text, 4, '0'))::uuid, r.ruta::bigint, 'data:image/png;base64,QQ==');
    UPDATE rutas SET estatus = 'En progreso' WHERE id = r.ruta;
    RESET ROLE;
  END LOOP;
END $$;
INSERT INTO t139 VALUES ('h0', to_jsonb(pg_temp.huella()));
SELECT pg_temp.ok(pg_temp.huella() = '5|397', '139-03 cinco rutas cargadas por contrato (salieron 103 del cuarto)');

\echo '── 139: el chofer fía — autorización, límite 0, límite justo'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(1), 13901, 'Crédito')$q$,
  '139-04 cliente SIN crédito autorizado (aunque tenga límite capturado): rechazado', '22023', '%No se puede fiar OV-13901%no tiene crédito autorizado%No se registró la entrega%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(2), 13902, 'Crédito')$q$,
  '139-05 autorizado con límite 0 = SIN capacidad (no "ilimitado"): rechazado', '22023', '%No se puede fiar OV-13902%Excede límite de crédito. Disponible: 0%', 'CREDITO_RECHAZADO');
SELECT pg_temp.ok(pg_temp.est(13901) = 'Asignada|Efectivo' AND pg_temp.est(13902) = 'Asignada|Crédito' AND pg_temp.dinero(13901) = '0|0|0|0|0' AND pg_temp.dinero(13902) = '0|0|0|0|0'
  AND pg_temp.saldo(13901) = '0=0' AND pg_temp.saldo(13902) = '0=0' AND pg_temp.aud('OV-13901', 'Entregar') = 0,
  '139-06 los rechazos no dejan NADA: la orden sigue Asignada con su método, sin deuda, sin cobro, sin saldo, sin auditoría de entrega');
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('c3', entregar_orden_ruta(pg_temp.op(3), 13903, 'Crédito', 'N-77'));
SELECT pg_temp.ok((pg_temp.j('c3') ->> 'ok')::boolean AND pg_temp.j('c3') ->> 'via' = 'credito' AND (pg_temp.j('c3') ->> 'cxc_creada')::boolean AND NOT (pg_temp.j('c3') ->> 'replay')::boolean
  AND pg_temp.est(13903) = 'Entregada|Crédito' AND pg_temp.dinero(13903) = '0|0|0|1|120' AND pg_temp.saldo(13903) = '120=120' AND pg_temp.aud('OV-13903', 'Entregar') = 1,
  '139-07 fiado válido: Entregada + cuenta por cobrar de $120 + saldo del cliente, juntas; sin pago; una línea de auditoría');
RESET ROLE;
SELECT pg_temp.ok((SELECT delivered_at IS NOT NULL AND folio_nota = 'N-77' FROM ordenes WHERE id = 13903)
  AND (SELECT fecha_vencimiento = fin_hoy() + 30 AND monto_original = 120 AND estatus = 'Pendiente' AND cliente_id = 13903 FROM cuentas_por_cobrar WHERE orden_id = 13903),
  '139-08 la cuenta queda asociada a la orden y al cliente, a 30 días; la orden con fecha de entrega y su nota');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('c3b', entregar_orden_ruta(pg_temp.op(3), 13903, 'Crédito', 'N-77'));
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('c3c', entregar_orden_ruta(pg_temp.op(30), 13903, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('c3b') ->> 'replay')::boolean AND NOT (pg_temp.j('c3b') ->> 'metodo_ignorado')::boolean
  AND (pg_temp.j('c3c') ->> 'replay')::boolean AND (pg_temp.j('c3c') ->> 'metodo_ignorado')::boolean
  AND pg_temp.est(13903) = 'Entregada|Crédito' AND pg_temp.dinero(13903) = '0|0|0|1|120' AND pg_temp.saldo(13903) = '120=120' AND pg_temp.aud('OV-13903', 'Entregar') = 1,
  '139-09 reintento idéntico y reintento con otra operación y otro método: replay; ni segunda deuda, ni cobro, ni cambio silencioso de modalidad');
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('c4', entregar_orden_ruta(pg_temp.op(4), 13904, 'Crédito'));
SELECT pg_temp.ok((pg_temp.j('c4') ->> 'cxc_creada')::boolean AND pg_temp.saldo(13904) = '300=300',
  '139-10 cliente con cuentas anteriores (debe 180 de 300): $120 es EXACTAMENTE lo disponible → pasa');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(5), 13905, 'Crédito')$q$,
  '139-11 un peso más ya no cabe (cuentan las deudas vigentes): rechazado', '22023', '%Disponible: 0%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(1);
SELECT abonar_cxc((SELECT id FROM cuentas_por_cobrar WHERE orden_id = 13990), 100, 'Efectivo', NULL, 13901);
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('c5', entregar_orden_ruta(pg_temp.op(5), 13905, 'Crédito'));
SELECT pg_temp.ok((pg_temp.j('c5') ->> 'cxc_creada')::boolean AND pg_temp.saldo(13904) = '230=230',
  '139-12 tras un abono de $100 el crédito se libera y la misma operación ya pasa (300 − 100 + 30 = 230)');

\echo '── 139: contado, link, referencia y carga (T5-A)'
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('e6', entregar_orden_ruta(pg_temp.op(6), 13906, 'Efectivo'));
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('e6b', entregar_orden_ruta(pg_temp.op(6), 13906, 'Efectivo'));
SELECT pg_temp.ok(pg_temp.j('e6') ->> 'via' = 'contado' AND (pg_temp.j('e6') ->> 'pago_aplicado')::boolean AND (pg_temp.j('e6b') ->> 'replay')::boolean
  AND pg_temp.est(13906) = 'Entregada|Efectivo' AND pg_temp.dinero(13906) = '1|120|1|0|0',
  '139-13 contado: Entregada + pago + ingreso en una transacción; el reintento no cobra dos veces');
SELECT pg_temp.como(10);
SELECT entregar_orden_ruta(pg_temp.op(7), 13907, 'Transferencia', NULL, 'SPEI-139-A');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(8), 13908, 'Transferencia', NULL, 'SPEI-139-A')$q$,
  '139-14 falla del cobro (referencia ya usada): la entrega NO se confirma', '23505', '%ya está registrada%No se registró la entrega%', 'REFERENCIA_REPETIDA');
SELECT pg_temp.ok(pg_temp.est(13908) = 'Asignada|Efectivo' AND pg_temp.dinero(13908) = '0|0|0|0|0' AND pg_temp.dinero(13907) = '1|120|1|0|0', '139-15 fallo transaccional sin efectos parciales: la orden sigue Asignada');
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('l8', entregar_orden_ruta(pg_temp.op(9), 13908, 'QR / Link de pago'));
SELECT pg_temp.ok(pg_temp.j('l8') ->> 'via' = 'link' AND pg_temp.est(13908) = 'Entregada|QR / Link de pago' AND pg_temp.dinero(13908) = '0|0|0|0|0',
  '139-16 link de pago: se entrega y NO se inventa un cobro (lo registra el webhook)');
SELECT pg_temp.como(10);
INSERT INTO t139 VALUES ('l8b', entregar_orden_ruta(pg_temp.op(10), 13908, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('l8b') ->> 'resuelta')::boolean AND pg_temp.est(13908) = 'Entregada|Efectivo' AND pg_temp.dinero(13908) = '1|120|1|0|0' AND pg_temp.aud('OV-13908', 'Resolver cobro de entrega') = 1,
  '139-17 cambio de modalidad de una entrega SIN registro financiero: el contrato la resuelve (aquí, el cliente terminó pagando en efectivo)');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(11), 13909, 'Crédito')$q$, '139-18 fiado sin cliente registrado: rechazado', '22023', '%necesita un cliente registrado%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(10);
SELECT entregar_orden_ruta(pg_temp.op(12), 13910, 'Crédito (fiado)');
SELECT pg_temp.ok(pg_temp.est(13910) = 'Entregada|Crédito' AND pg_temp.saldo(13903) = '240=240', '139-19 la etiqueta larga de la pantalla ("Crédito (fiado)") se guarda con el nombre corto del sistema');
SELECT pg_temp.como(14);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(13), 13951, 'Crédito')$q$,
  '139-20 compatibilidad con T5-A: si la orden no cabe en lo cargado se rechaza por la guarda de carga', '22023', '%carga del camión no alcanza%', 'CARGA_INSUFICIENTE');
SELECT pg_temp.ok(pg_temp.est(13951) = 'Asignada|Crédito' AND pg_temp.dinero(13951) = '0|0|0|0|0' AND pg_temp.saldo(13903) = '240=240', '139-21 y no deja deuda: entrega y cuenta por cobrar se deshacen juntas');

\echo '── 139: quién y qué'
SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13913, 'Efectivo')$q$, '139-22 chofer de OTRA ruta: no', '42501');
SELECT pg_temp.como(5);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13913, 'Efectivo')$q$, '139-23 Ventas: no (lo suyo es mostrador)', '42501');
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13913, 'Efectivo')$q$, '139-24 Empleado: no', '42501');
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13913, 'Bitcoin')$q$, '139-25 método desconocido: no', '22023', '%método de pago inválido%');
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13911, 'Efectivo')$q$, '139-26 orden Cancelada: no', '22023', '%está Cancelada%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(14), 13912, 'Efectivo')$q$, '139-27 venta sin ruta: va por mostrador', '22023', '%no está en una ruta%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(15), 13902, 'Crédito (fiado)')$q$,
  '139-28 Admin intenta fiar a quien no tiene capacidad: rechazado igual, con mensaje accionable', '22023', '%Cobra de otra forma o pide a Administración que revise el crédito%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(1);
INSERT INTO t139 VALUES ('a13', entregar_orden_ruta(pg_temp.op(16), 13913, 'Crédito (fiado)'));
SELECT pg_temp.ok((pg_temp.j('a13') ->> 'cxc_creada')::boolean AND pg_temp.est(13913) = 'Entregada|Crédito' AND pg_temp.est(13902) = 'Asignada|Crédito' AND pg_temp.saldo(13903) = '360=360',
  '139-29 Admin registra un fiado válido de una orden de ruta: mismo contrato, mismas reglas');

\echo '── 139: la guarda — nada queda Entregado a crédito fuera de un contrato'
SELECT pg_temp.como(10);
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Crédito' WHERE id = 13902$q$,
  '139-30 las dos escrituras de antes (API directa: Entregada + Crédito): rechazadas', '42501', '%una entrega a crédito se registra con su contrato%');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Crédito (fiado)' WHERE id = 13902$q$, '139-31 también para Admin y con la etiqueta larga', '42501');
SELECT pg_temp.falla($q$UPDATE ordenes SET metodo_pago = 'Crédito' WHERE id = 13906$q$,
  '139-32 cambiar por API el método de una entrega ya cobrada a Crédito: rechazado', '42501');
RESET ROLE;
SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '', true);
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Crédito' WHERE id = 13902$q$, '139-33 sin exención para sesiones de confianza (service role / SQL)', '42501');
SELECT pg_temp.ok(pg_temp.est(13902) = 'Asignada|Crédito' AND pg_temp.est(13906) = 'Entregada|Efectivo', '139-34 nada cambió');

\echo '── 139: estados anteriores a 139 (Entregada a crédito sin cuenta por cobrar) y su salida'
SET LOCAL session_replication_role = replica;
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Crédito', delivered_at = now() WHERE id IN (13941, 13942);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(13);
SELECT pg_temp.falla($q$SELECT cerrar_ruta_financiero(pg_temp.op(40), 13904, '[{"ordenId": 13941, "pago": "Crédito"}, {"ordenId": 13942, "pago": "Crédito"}]'::jsonb, 13913, 'x')$q$,
  '139-35 el cierre de ruta sigue sin registrar un fiado que el servidor rechaza (así se bloqueaba la ruta)', '22023|P0001', '%Excede límite de crédito%');
SELECT pg_temp.como(13);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(41), 13941, 'Crédito')$q$, '139-36 resolverla como fiado sigue rechazado (límite 0)', '22023', '%Disponible: 0%', 'CREDITO_RECHAZADO');
SELECT pg_temp.como(13);
INSERT INTO t139 VALUES ('r41', entregar_orden_ruta(pg_temp.op(42), 13941, 'Efectivo'));
SELECT pg_temp.como(13);
INSERT INTO t139 VALUES ('r42', entregar_orden_ruta(pg_temp.op(43), 13942, 'Crédito'));
SELECT pg_temp.ok((pg_temp.j('r41') ->> 'resuelta')::boolean AND pg_temp.j('r41') ->> 'via' = 'contado' AND pg_temp.est(13941) = 'Entregada|Efectivo' AND pg_temp.dinero(13941) = '1|120|1|0|0'
  AND (pg_temp.j('r42') ->> 'resuelta')::boolean AND (pg_temp.j('r42') ->> 'cxc_creada')::boolean AND pg_temp.dinero(13942) = '0|0|0|1|120' AND pg_temp.saldo(13903) = '480=480',
  '139-37 salida sin SQL: la entrega atorada se resuelve cobrándola de otra forma, o como fiado si el cliente sí tiene capacidad');
SELECT pg_temp.como(13);
INSERT INTO t139 VALUES ('f4', cerrar_ruta_financiero(pg_temp.op(44), 13904, '[{"ordenId": 13941, "pago": "Efectivo"}, {"ordenId": 13942, "pago": "Crédito"}]'::jsonb, 13913, 'x'));
INSERT INTO t139 VALUES ('i4', finalizar_inventario_ruta(pg_temp.op(45), 13904, '{"P139-A": 12}'::jsonb));
SELECT pg_temp.ok((pg_temp.j('f4') ->> 'success')::boolean AND (pg_temp.j('f4') ->> 'cxc')::int = 0 AND (pg_temp.j('f4') ->> 'pagos')::int = 0 AND pg_temp.j('i4') ->> 'estatus' = 'Cerrada'
  AND pg_temp.dinero(13941) = '1|120|1|0|0' AND pg_temp.dinero(13942) = '0|0|0|1|120',
  '139-38 y la ruta ya cierra: el cierre no duplica ni el cobro ni la cuenta por cobrar');

\echo '── 139: cierre de ruta tras fiado válido y tras fiado rechazado'
SELECT pg_temp.como(11);
SELECT entregar_orden_ruta(pg_temp.op(50), 13921, 'Crédito');
SELECT pg_temp.como(11);
SELECT entregar_orden_ruta(pg_temp.op(51), 13922, 'Efectivo');
SELECT pg_temp.como(11);
INSERT INTO t139 VALUES ('f2', cerrar_ruta_financiero(pg_temp.op(52), 13902, '[{"ordenId": 13921, "pago": "Crédito"}, {"ordenId": 13922, "pago": "Efectivo"}]'::jsonb, 13911, 'x'));
INSERT INTO t139 VALUES ('i2', finalizar_inventario_ruta(pg_temp.op(53), 13902, '{"P139-A": 2}'::jsonb));
SELECT pg_temp.ok((pg_temp.j('f2') ->> 'success')::boolean AND (pg_temp.j('f2') ->> 'cxc')::int = 0 AND (pg_temp.j('f2') ->> 'pagos')::int = 0 AND pg_temp.j('i2') ->> 'estatus' = 'Cerrada'
  AND pg_temp.dinero(13921) = '0|0|0|1|120' AND pg_temp.dinero(13922) = '1|120|1|0|0' AND pg_temp.saldo(13903) = '600=600',
  '139-39 ruta con un fiado válido y un contado: cierra; una sola cuenta por cobrar y un solo pago');
SELECT pg_temp.como(12);
SELECT pg_temp.falla($q$SELECT entregar_orden_ruta(pg_temp.op(60), 13931, 'Crédito')$q$, '139-40 fiado rechazado en ruta (límite 0)', '22023', '%Disponible: 0%');
SELECT pg_temp.como(12);
SELECT registrar_no_entrega(pg_temp.op(61), 13931, 'No quiso pagar de contado', false);
INSERT INTO t139 VALUES ('f3', cerrar_ruta_financiero(pg_temp.op(62), 13903, '[]'::jsonb, 13912, 'x'));
INSERT INTO t139 VALUES ('i3', finalizar_inventario_ruta(pg_temp.op(63), 13903, '{"P139-A": 10}'::jsonb));
SELECT pg_temp.ok(pg_temp.j('i3') ->> 'estatus' = 'Cerrada' AND pg_temp.dinero(13931) = '0|0|0|0|0' AND pg_temp.saldo(13902) = '0=0',
  '139-41 tras un fiado rechazado la ruta NO queda bloqueada: la orden se marca no entregada y la ruta cierra; el cliente no debe nada');

\echo '── 139: integridad final'
RESET ROLE;
SELECT pg_temp.ok((SELECT bool_and(c.saldo = COALESCE((SELECT sum(x.saldo_pendiente) FROM cuentas_por_cobrar x WHERE x.cliente_id = c.id AND x.estatus IS DISTINCT FROM 'Pagada'), 0)) FROM clientes c WHERE c.id BETWEEN 13901 AND 13905),
  '139-42 saldos: el saldo de cada cliente = la suma de sus cuentas por cobrar vigentes');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar WHERE orden_id BETWEEN 13901 AND 13990 GROUP BY orden_id HAVING count(*) > 1)
  AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id BETWEEN 13901 AND 13951 GROUP BY orden_id HAVING sum(monto) > 120)
  AND NOT EXISTS (SELECT 1 FROM ordenes o WHERE o.id BETWEEN 13901 AND 13951 AND o.estatus = 'Entregada' AND fin_es_credito(o.metodo_pago)
                    AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar c WHERE c.orden_id = o.id)),
  '139-43 sin duplicados financieros, y NINGUNA orden Entregada a crédito sin su cuenta por cobrar');
SELECT pg_temp.ok(pg_temp.j('h0') #>> '{}' = '5|397' AND pg_temp.huella() = '8|421',
  '139-44 inventario: solo las 5 cargas y las 3 devoluciones de cierre (12 + 2 + 10); ninguna entrega ni rechazo movió kardex');
SELECT pg_temp.ok((SELECT count(*) FROM auditoria WHERE modulo = 'Rutas' AND accion IN ('Entregar', 'Resolver cobro de entrega') AND detalle LIKE 'OV-139%') = 13,
  '139-45 auditoría: una línea por cada entrega o resolución que SÍ ocurrió (10 entregas + 3 resoluciones), ninguna por los rechazos');

ROLLBACK;
\echo '── 139: TODAS LAS PRUEBAS OK'
