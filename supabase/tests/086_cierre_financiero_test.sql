-- 086_cierre_financiero_test.sql — F4: cierre financiero de ruta replay-safe.
-- Estado físico; huella lógica insensible a orden/alias; matriz de replay
-- (misma/otra operación × misma/otra huella); efectos exactamente una vez
-- (órdenes, líneas exprés, pagos, CxC, ingresos, saldos, folios); respuesta
-- perdida; operación usada en otra ruta; fallo sin marca; sobrecarga legacy;
-- Admin; sin acceso REST a la tabla del evento.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8601 AND 8609;
DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639;
DELETE FROM auditoria WHERE detalle LIKE '%R-86%';
DELETE FROM rutas WHERE id BETWEEN 8601 AND 8609;
DELETE FROM clientes WHERE id IN (8610, 8611);
DELETE FROM productos WHERE sku LIKE 'P86-%';
DELETE FROM usuarios WHERE id BETWEEN 8601 AND 8609;
DELETE FROM auth.users WHERE id::text LIKE '86000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('86000000-0000-0000-0000-000000000001', 'admin86@t'), ('86000000-0000-0000-0000-000000000002', 'ventas86@t'),
  ('86000000-0000-0000-0000-000000000003', 'chofer86@t'), ('86000000-0000-0000-0000-000000000004', 'chofer86b@t'),
  ('86000000-0000-0000-0000-000000000005', 'chofer86c@t'), ('86000000-0000-0000-0000-000000000006', 'chofer86d@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8601, 'Admin 86',    'admin86@t',   'Admin',  'Activo', '86000000-0000-0000-0000-000000000001'),
  (8602, 'Ventas 86',   'ventas86@t',  'Ventas', 'Activo', '86000000-0000-0000-0000-000000000002'),
  (8603, 'Chofer 86',   'chofer86@t',  'Chofer', 'Activo', '86000000-0000-0000-0000-000000000003'),
  (8604, 'Chofer 86 B', 'chofer86b@t', 'Chofer', 'Activo', '86000000-0000-0000-0000-000000000004'),
  (8605, 'Chofer 86 C', 'chofer86c@t', 'Chofer', 'Activo', '86000000-0000-0000-0000-000000000005'),
  (8606, 'Chofer 86 D', 'chofer86d@t', 'Chofer', 'Activo', '86000000-0000-0000-0000-000000000006');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P86-A', 'Hielo 86', 'Producto Terminado', 35, 0);  -- 088: precio canónico = el de las ventas exprés
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (8610, 'Cliente Contado 86', 'XAXX010101000', 0, false, 0), (8611, 'Cliente Crédito 86', 'XAXX010101000', 0, true, 1000);  -- 088: crédito autorizado
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (8601, 'R-8601', 'Ruta 86',        8603, 'Chofer 86', 'En progreso', CURRENT_DATE, '{"P86-A": 10}', '{"P86-A": 10}', '{}', '{"P86-A": 10}'),
  (8602, 'R-8602', 'Ruta 86 dos',    8605, 'Chofer 86 C', 'En progreso', CURRENT_DATE, '{"P86-A": 5}',  '{"P86-A": 5}',  '{}', '{"P86-A": 5}'),
  (8604, 'R-8604', 'Ruta 86 legacy', 8606, 'Chofer 86 D', 'En progreso', CURRENT_DATE, '{"P86-A": 5}',  '{"P86-A": 5}',  '{}', '{"P86-A": 5}'),
  (8605, 'R-8605', 'Ruta 86 admin',  8604, 'Chofer 86 B', 'En progreso', CURRENT_DATE, '{"P86-A": 5}', '{"P86-A": 5}', '{}', '{"P86-A": 5}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8620, 'OV-8620', 8610, 'Cliente Contado 86', '2×P86-A', 60,  'Asignada',  'Efectivo',         'Contado', 8602, 8601),
  (8621, 'OV-8621', 8611, 'Cliente Crédito 86', '3×P86-A', 90,  'Asignada',  'Crédito',          'Credito', 8602, 8601),
  (8622, 'OV-8622', 8610, 'Cliente Contado 86', '1×P86-A', 30,  'Asignada',  'QR / Link de pago','Contado', 8602, 8601),
  (8623, 'OV-8623', 8610, 'Cliente Contado 86', '1×P86-A', 30,  'Cancelada', 'Efectivo',         'Contado', 8602, 8602),
  (8624, 'OV-8624', 8610, 'Cliente Contado 86', '1×P86-A', 30,  'Asignada',  'Efectivo',         'Contado', 8602, 8602),
  (8625, 'OV-8625', 8610, 'Cliente Contado 86', '1×P86-A', 30,  'Asignada',  'Efectivo',         'Contado', 8602, 8604),
  (8626, 'OV-8626', 8610, 'Cliente Contado 86', '1×P86-A', 30,  'Asignada',  'Efectivo',         'Contado', 8602, 8605);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (8620, 'P86-A', 2, 30, 60), (8621, 'P86-A', 3, 30, 90), (8622, 'P86-A', 1, 30, 30), (8623, 'P86-A', 1, 30, 30),
  (8624, 'P86-A', 1, 30, 30), (8625, 'P86-A', 1, 30, 30), (8626, 'P86-A', 1, 30, 30);
-- 8622 ya pagada por link (webhook) antes del cierre
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (8610, 8622, 30, 'QR / Link de pago', CURRENT_DATE, 'LINK-8622', 0, 0);
COMMIT;

CREATE OR REPLACE FUNCTION t86_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t86_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t86_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
-- Huella de negocio de TODO lo que el cierre financiero puede tocar en las rutas 86xx.
CREATE OR REPLACE FUNCTION t86_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', id, folio, estatus, ruta_id, total, metodo_pago, tipo_cobro, cliente_id, requiere_factura, vendedor_id), ',' ORDER BY id) FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609),
    (SELECT string_agg(concat_ws(':', l.id, l.orden_id, l.sku, l.cantidad, l.precio_unit, l.subtotal), ',' ORDER BY l.id) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id BETWEEN 8601 AND 8609),
    (SELECT string_agg(concat_ws(':', p.id, p.orden_id, p.monto, p.metodo_pago, p.referencia, p.cxc_id), ',' ORDER BY p.id) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id BETWEEN 8601 AND 8609),
    (SELECT string_agg(concat_ws(':', x.id, x.orden_id, x.monto_original, x.saldo_pendiente, x.estatus), ',' ORDER BY x.id) FROM cuentas_por_cobrar x JOIN ordenes o ON o.id = x.orden_id WHERE o.ruta_id BETWEEN 8601 AND 8609),
    (SELECT string_agg(concat_ws(':', m.id, m.tipo, m.categoria, m.monto, m.orden_id), ',' ORDER BY m.id) FROM movimientos_contables m JOIN ordenes o ON o.id = m.orden_id WHERE o.ruta_id BETWEEN 8601 AND 8609),
    (SELECT string_agg(id || '=' || saldo, ',' ORDER BY id) FROM clientes WHERE id IN (8610, 8611)),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 8601 AND 8609),
    (SELECT string_agg(concat_ws(':', ruta_id, operacion_id, huella, actor), ',' ORDER BY ruta_id) FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8601 AND 8609),
    (SELECT last_value::text FROM folio_ov_seq)))
$$;
DROP TABLE IF EXISTS t86_ids;
CREATE TEMP TABLE t86_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t86_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t86_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t86_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t86_h(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM t86_ids WHERE k = p_k $$;

-- Payload lógico P1 y su variante P1b (otro orden de entradas y de llaves, qty
-- en vez de cant, espacios): misma petición lógica.
INSERT INTO t86_ids VALUES ('P1', $j$[
  {"ordenId": 8620, "express": false, "pago": "Efectivo", "referencia": null},
  {"ordenId": 8621, "express": false, "pago": "Crédito"},
  {"ordenId": 8622, "express": false, "pago": "QR / Link de pago"},
  {"express": true, "cliente": "Público en general", "pago": "Tarjeta", "referencia": "TPV-1", "items": [{"sku": "P86-A", "cant": 2, "precio": 35}]},
  {"express": true, "clienteId": 8611, "cliente": "Cliente Crédito 86", "factura": false, "pago": "Crédito", "items": [{"sku": "P86-A", "cant": 1, "precio": 35}]}
]$j$);
INSERT INTO t86_ids VALUES ('P1b', $j$[
  {"express": true, "items": [{"precio": 35.00, "qty": 1, "sku": "P86-A"}], "pago": "Crédito", "cliente": " Cliente Crédito 86 ", "clienteId": "8611"},
  {"pago": "Crédito", "ordenId": "8621"},
  {"items": [{"sku": "P86-A", "cant": 2, "precio": 35}], "referencia": " TPV-1 ", "pago": "Tarjeta", "cliente": "Público en general", "express": true},
  {"ordenId": 8622, "pago": "QR / Link de pago"},
  {"ordenId": 8620, "pago": "Efectivo"}
]$j$);
-- P2: otra petición lógica (una venta exprés más)
INSERT INTO t86_ids VALUES ('P2', (t86_j('P1') || $j$[{"express": true, "cliente": "Público en general", "pago": "Efectivo", "items": [{"sku": "P86-A", "cant": 1, "precio": 35}]}]$j$::jsonb)::text);
INSERT INTO t86_ids VALUES ('h0', t86_huella());

\echo '── 086: estado físico'
SELECT t86_assert((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.cierres_financieros_ruta'::regclass)
  AND (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cierres_financieros_ruta')
  AND NOT has_table_privilege('authenticated', 'public.cierres_financieros_ruta', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.cierres_financieros_ruta', 'SELECT')
  AND has_table_privilege('service_role', 'public.cierres_financieros_ruta', 'SELECT'), '086-01 cierres_financieros_ruta: RLS forzada, sin policies, sin acceso de la API');
SELECT t86_assert((SELECT count(*) = 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'cierres_financieros_ruta' AND indexdef ~ 'UNIQUE' AND indexdef ~ 'operacion_id'), '086-02 operacion_id único entre rutas');
SELECT t86_assert((SELECT count(*) = 2 AND bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('public', oid, 'EXECUTE') AND has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE')) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'cerrar_ruta_financiero'), '086-03 dos sobrecargas de cerrar_ruta_financiero: SECURITY DEFINER, search_path fijo, ACL igual a 069');
SELECT t86_assert(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure) ~ 'cierres_financieros_ruta' AND pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure) !~ 'auth\.jwt|email|get_my_rol', '086-04 contrato nuevo escribe el evento y no usa identidad por email');
SELECT t86_assert(pg_get_functiondef('public.cerrar_ruta_financiero(bigint,jsonb,bigint,text)'::regprocedure) ~ 'gen_random_uuid\(\)' AND pg_get_functiondef('public.cerrar_ruta_financiero(bigint,jsonb,bigint,text)'::regprocedure) !~ 'INSERT INTO', '086-05 sobrecarga legacy solo delega');
SELECT t86_assert((SELECT NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.fin_huella_cierre(bigint,jsonb)'::regprocedure), '086-06 fin_huella_cierre es interna');

\echo '── 086: huella lógica'
SELECT t86_assert(fin_huella_cierre(8601, t86_j('P1')) = fin_huella_cierre(8601, t86_j('P1b')), '086-10 misma petición lógica con otro orden, otras llaves, qty/cant y espacios → misma huella');
SELECT t86_assert(fin_huella_cierre(8601, t86_j('P1')) <> fin_huella_cierre(8601, t86_j('P2')), '086-11 una venta exprés más → otra huella');
SELECT t86_assert(fin_huella_cierre(8601, t86_j('P1')) <> fin_huella_cierre(8602, t86_j('P1')), '086-12 otra ruta → otra huella');
SELECT t86_assert(fin_huella_cierre(8601, '[{"ordenId":8620,"pago":"Efectivo"}]') <> fin_huella_cierre(8601, '[{"ordenId":8620,"pago":"Tarjeta"}]')
  AND fin_huella_cierre(8601, '[{"ordenId":8620,"pago":"Efectivo"}]') <> fin_huella_cierre(8601, '[{"ordenId":8620,"pago":"Efectivo","referencia":"X"}]')
  AND fin_huella_cierre(8601, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":2,"precio":35}]}]') <> fin_huella_cierre(8601, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":2,"precio":36}]}]')
  AND fin_huella_cierre(8601, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":2,"precio":35}]}]') <> fin_huella_cierre(8601, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":3,"precio":35}]}]')
  AND fin_huella_cierre(8601, '[{"express":true,"clienteId":8611,"factura":false,"pago":"Efectivo","items":[]}]') <> fin_huella_cierre(8601, '[{"express":true,"clienteId":8611,"factura":true,"pago":"Efectivo","items":[]}]'), '086-13 método, referencia, precio, cantidad y factura cambian la huella');
SELECT t86_assert(fin_huella_cierre(8601, 'null'::jsonb) = fin_huella_cierre(8601, '[]'::jsonb), '086-14 sin entregas: huella estable');

\echo '── 086: denegaciones (cero efectos)'
BEGIN; SET LOCAL ROLE anon; SELECT t86_actor('anon', NULL, NULL);
SELECT t86_err($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, '[]'::jsonb)$q$, '086-20 anon: sin EXECUTE', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'ventas86@t', '86000000-0000-0000-0000-000000000002');
SELECT t86_err($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, '[]'::jsonb)$q$, '086-21 Ventas: no cierra rutas', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86b@t', '86000000-0000-0000-0000-000000000004');
SELECT t86_err(format($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, %L::jsonb)$q$, t86_h('P1')), '086-22 Chofer ajeno: la ruta no es suya', '42501');
SELECT t86_err($q$SELECT * FROM cierres_financieros_ruta$q$, '086-23 authenticated no lee la tabla del evento', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86@t', '86000000-0000-0000-0000-000000000003');
SELECT t86_err($q$SELECT cerrar_ruta_financiero(NULL::uuid, 8601, '[]'::jsonb)$q$, '086-24 operacion_id obligatorio', '22023');
ROLLBACK;
SELECT t86_assert(t86_huella() = t86_h('h0'), '086-25 cero efectos tras las denegaciones');

\echo '── 086: primer cierre (efectos exactamente una vez)'
INSERT INTO t86_ids VALUES ('seq0', (SELECT last_value::text FROM folio_ov_seq));
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86@t', '86000000-0000-0000-0000-000000000003');
INSERT INTO t86_ids VALUES ('r1', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, t86_j('P1'), 8603, 'Chofer 86')::text);
COMMIT;
SELECT t86_assert((t86_j('r1') ->> 'replay') = 'false' AND (t86_j('r1') ->> 'ordenes_entregadas') = '3' AND (t86_j('r1') ->> 'ventas_express') = '2' AND (t86_j('r1') ->> 'pagos') = '2' AND (t86_j('r1') ->> 'cxc') = '2' AND (t86_j('r1') ->> 'actor') = 'Chofer 86' AND jsonb_array_length(t86_j('r1') -> 'ordenes_express') = 2 AND (t86_j('r1') ->> 'huella') = fin_huella_cierre(8601, t86_j('P1')), '086-30 resultado: 3 entregas, 2 exprés, 2 pagos, 2 CxC, 1 saltada, actor del JWT, huella');
SELECT t86_assert((SELECT count(*) = 1 AND bool_and(monto = 60 AND metodo_pago = 'Efectivo') FROM pagos WHERE orden_id = 8620) AND (SELECT count(*) = 1 AND bool_and(saldo_pendiente = 90) FROM cuentas_por_cobrar WHERE orden_id = 8621) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 8622) AND (SELECT bool_and(estatus = 'Entregada') FROM ordenes WHERE id IN (8620, 8621, 8622)), '086-31 órdenes normales: pago 60, CxC 90, la pagada por link no se cobra dos veces, las tres Entregada');
SELECT t86_assert((SELECT count(*) = 2 FROM ordenes WHERE ruta_id = 8601 AND id NOT BETWEEN 8620 AND 8639 AND estatus = 'Entregada') AND (SELECT count(*) = 2 FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = 8601 AND o.id NOT BETWEEN 8620 AND 8639) AND (SELECT count(*) = 1 AND bool_and(p.monto = 70 AND p.metodo_pago = 'Tarjeta' AND p.referencia = 'TPV-1') FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 8601 AND o.id NOT BETWEEN 8620 AND 8639) AND (SELECT count(*) = 1 AND bool_and(x.monto_original = 35) FROM cuentas_por_cobrar x JOIN ordenes o ON o.id = x.orden_id WHERE o.ruta_id = 8601 AND o.id NOT BETWEEN 8620 AND 8639), '086-32 exprés: 2 órdenes, 2 líneas, 1 pago tarjeta 70 con referencia, 1 CxC 35');
SELECT t86_assert((SELECT count(*) = 2 FROM movimientos_contables m JOIN ordenes o ON o.id = m.orden_id WHERE o.ruta_id = 8601 AND m.tipo = 'Ingreso' AND m.categoria = 'Ventas') AND (SELECT saldo = 125 FROM clientes WHERE id = 8611) AND (SELECT saldo = 0 FROM clientes WHERE id = 8610), '086-33 ingresos: 2 (efectivo + tarjeta); saldo crédito = 90 + 35');
SELECT t86_assert((SELECT last_value - t86_h('seq0')::bigint = 2 FROM folio_ov_seq), '086-34 folio_ov_seq avanzó exactamente 2');
SELECT t86_assert((SELECT count(*) = 1 AND bool_and(operacion_id = '86000000-0000-0000-0000-00000000a001' AND actor = 'Chofer 86' AND actor_id = 8603 AND huella = fin_huella_cierre(8601, t86_j('P1')) AND (resultado ->> 'success') = 'true') FROM cierres_financieros_ruta WHERE ruta_id = 8601), '086-35 evento registrado con operación, huella, actor derivado y resultado');
SELECT t86_assert((SELECT estatus = 'En progreso' FROM rutas WHERE id = 8601), '086-36 la ruta sigue En progreso (el inventario se cierra después)');
SELECT t86_assert(NOT EXISTS (SELECT 1 FROM ordenes o JOIN pagos p ON p.orden_id = o.id WHERE o.ruta_id = 8601 GROUP BY o.id, o.total HAVING SUM(p.monto) > o.total + 0.01), '086-37 I1: SUM(pagos) ≤ total en todas las órdenes de la ruta');
INSERT INTO t86_ids VALUES ('h1', t86_huella());

\echo '── 086: matriz de replay (respuesta perdida, doble tap, conflicto)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86@t', '86000000-0000-0000-0000-000000000003');
INSERT INTO t86_ids VALUES ('r2', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, t86_j('P1b'), 8603, 'Chofer 86')::text);
INSERT INTO t86_ids VALUES ('r3', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a002'::uuid, 8601, t86_j('P1'), 8603, 'Chofer 86')::text);
SELECT t86_err(format($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, %L::jsonb, 8603, 'Chofer 86')$q$, t86_h('P2')), '086-42 misma operación + otra petición → 23505', '23505');
SELECT t86_err(format($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a003'::uuid, 8601, %L::jsonb, 8603, 'Chofer 86')$q$, t86_h('P2')), '086-43 otra operación + otra petición → 22023 (la ruta ya cerró financieramente)', '22023');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86c@t', '86000000-0000-0000-0000-000000000005');
SELECT t86_err(format($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8602, %L::jsonb, 8605, 'Chofer 86 C')$q$, '[{"ordenId":8624,"pago":"Efectivo"}]'), '086-44 operación de la ruta 8601 usada en la 8602 (su chofer) → 23505', '23505');
ROLLBACK;
SELECT t86_assert((t86_j('r2') ->> 'replay') = 'true' AND (t86_j('r2') ->> 'operacion_original') = '86000000-0000-0000-0000-00000000a001' AND (t86_j('r2') ->> 'ventas_express') = '2' AND (t86_j('r2') -> 'ordenes_express') = (t86_j('r1') -> 'ordenes_express'), '086-40 misma operación, misma petición (respuesta perdida / doble tap): resultado almacenado, replay=true');
SELECT t86_assert((t86_j('r3') ->> 'replay') = 'true' AND (t86_j('r3') ->> 'operacion_original') = '86000000-0000-0000-0000-00000000a001', '086-41 otra operación, misma petición (UUID perdido en el cliente): replay, no repite');
SELECT t86_assert(t86_huella() = t86_h('h1'), '086-45 cero efectos en toda la matriz: sin segunda venta exprés, sin pagos, sin CxC, sin ingresos, sin folios');
-- La ruta se cierra después (JS): el replay sigue devolviendo el resultado.
UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8601;
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86@t', '86000000-0000-0000-0000-000000000003');
INSERT INTO t86_ids VALUES ('r4', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a001'::uuid, 8601, t86_j('P1'), 8603, 'Chofer 86')::text);
SELECT t86_err(format($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000a004'::uuid, 8601, %L::jsonb, 8603, 'Chofer 86')$q$, t86_h('P2')), '086-47 ruta Cerrada + otra petición → rechazo sin efectos', '22023|P0001');
COMMIT;
SELECT t86_assert((t86_j('r4') ->> 'replay') = 'true', '086-46 ruta ya Cerrada: el replay de la misma operación sigue respondiendo');
SELECT t86_assert((SELECT count(*) = 2 FROM ordenes WHERE ruta_id = 8601 AND id NOT BETWEEN 8620 AND 8639), '086-48 sigue habiendo exactamente 2 ventas exprés');

\echo '── 086: fallo sin marca'
INSERT INTO t86_ids VALUES ('h2', t86_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86c@t', '86000000-0000-0000-0000-000000000005');
SELECT t86_err($q$SELECT cerrar_ruta_financiero('86000000-0000-0000-0000-00000000b001'::uuid, 8602, '[{"ordenId":8624,"pago":"Efectivo"},{"ordenId":8623,"pago":"Efectivo"},{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":1,"precio":35}]}]'::jsonb, 8605, 'Chofer 86 C')$q$, '086-50 entrega de una orden Cancelada aborta TODO', 'P0001');
ROLLBACK;
SELECT t86_assert((SELECT count(*) = 0 FROM cierres_financieros_ruta WHERE ruta_id = 8602) AND (SELECT estatus = 'Asignada' FROM ordenes WHERE id = 8624) AND (SELECT count(*) = 0 FROM ordenes WHERE ruta_id = 8602 AND id NOT BETWEEN 8620 AND 8639) AND t86_huella() = t86_h('h2'), '086-51 sin marca, sin orden Entregada, sin exprés, sin folio consumido');
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86c@t', '86000000-0000-0000-0000-000000000005');
INSERT INTO t86_ids VALUES ('r5', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000b001'::uuid, 8602, '[{"ordenId":8624,"pago":"Efectivo"},{"express":true,"pago":"Efectivo","items":[{"sku":"P86-A","cant":1,"precio":35}]}]'::jsonb, 8605, 'Chofer 86 C')::text);
COMMIT;
SELECT t86_assert((t86_j('r5') ->> 'replay') = 'false' AND (SELECT count(*) = 1 FROM cierres_financieros_ruta WHERE ruta_id = 8602 AND operacion_id = '86000000-0000-0000-0000-00000000b001') AND (SELECT count(*) = 1 FROM ordenes WHERE ruta_id = 8602 AND id NOT BETWEEN 8620 AND 8639), '086-52 la misma operación, corregida, cierra: el fallo no quemó el UUID');

\echo '── 086: sobrecarga legacy (código anterior a 086)'
INSERT INTO t86_ids VALUES ('PL', '[{"ordenId":8625,"pago":"Efectivo"},{"express":true,"cliente":"Público en general","pago":"Efectivo","items":[{"sku":"P86-A","cant":2,"precio":35}]}]');
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'chofer86d@t', '86000000-0000-0000-0000-000000000006');
INSERT INTO t86_ids VALUES ('l1', cerrar_ruta_financiero(8604, t86_j('PL'), 8606, 'Chofer 86 D')::text);
INSERT INTO t86_ids VALUES ('l2', cerrar_ruta_financiero(8604, t86_j('PL'), 8606, 'Chofer 86 D')::text);
SELECT t86_err($q$SELECT cerrar_ruta_financiero(8604, '[{"ordenId":8625,"pago":"Efectivo"}]'::jsonb, 8606, 'Chofer 86 D')$q$, '086-62 legacy con otra petición tras el cierre → 22023', '22023');
COMMIT;
SELECT t86_assert((t86_j('l1') ->> 'replay') = 'false' AND (t86_j('l2') ->> 'replay') = 'true' AND (SELECT count(*) = 1 FROM ordenes WHERE ruta_id = 8604 AND id NOT BETWEEN 8620 AND 8639) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 8625) AND (SELECT count(*) = 1 FROM cierres_financieros_ruta WHERE ruta_id = 8604), '086-60/61 legacy: primera llamada cierra, la segunda idéntica es replay, 1 exprés y 1 pago');

\echo '── 086: Admin y contexto SQL'
BEGIN; SET LOCAL ROLE authenticated; SELECT t86_actor('authenticated', 'admin86@t', '86000000-0000-0000-0000-000000000001');
INSERT INTO t86_ids VALUES ('ad', cerrar_ruta_financiero('86000000-0000-0000-0000-00000000c001'::uuid, 8605, '[{"ordenId":8626,"pago":"Efectivo"}]'::jsonb, 8601, 'Admin 86')::text);
COMMIT;
SELECT t86_assert((t86_j('ad') ->> 'actor') = 'Admin 86' AND (SELECT actor_id = 8601 FROM cierres_financieros_ruta WHERE ruta_id = 8605) AND (SELECT count(*) = 1 FROM pagos WHERE orden_id = 8626), '086-70 Admin cierra financieramente una ruta ajena; actor del JWT, no del parámetro');
SELECT t86_assert((SELECT count(*) = 4 FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8601 AND 8609) AND (SELECT count(*) = 4 FROM (SELECT DISTINCT operacion_id FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8601 AND 8609) x), '086-71 4 rutas cerradas, 4 operaciones distintas');

BEGIN;
DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8601 AND 8609;
DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639);
DELETE FROM ordenes WHERE ruta_id BETWEEN 8601 AND 8609 OR id BETWEEN 8620 AND 8639;
DELETE FROM auditoria WHERE detalle LIKE '%R-86%';
DELETE FROM rutas WHERE id BETWEEN 8601 AND 8609;
DELETE FROM clientes WHERE id IN (8610, 8611);
DELETE FROM productos WHERE sku LIKE 'P86-%';
DELETE FROM usuarios WHERE id BETWEEN 8601 AND 8609;
DELETE FROM auth.users WHERE id::text LIKE '86000000-%';
COMMIT;
\echo '── 086: TODAS LAS PRUEBAS OK'
