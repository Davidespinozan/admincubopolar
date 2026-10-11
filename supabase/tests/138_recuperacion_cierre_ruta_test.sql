-- 138_recuperacion_cierre_ruta_test.sql — T5-A: una entrega no consume más de lo
-- cargado, no se agregan pedidos a una ruta con carga, el cierre financiero no
-- registra un exceso, y Admin puede revertir una entrega marcada por error.
-- Todo dentro de UNA transacción con ROLLBACK: no deja nada en la base.
-- (La concurrencia con dos conexiones corre en el runner: C138a–d.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('13800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t138' FROM generate_series(1, 20) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13801, 'Admin T138',  'u1@t138', 'Admin',  'Activo', '13800000-0000-0000-0000-000000000001'),
  (13805, 'Ventas T138', 'u5@t138', 'Ventas', 'Activo', '13800000-0000-0000-0000-000000000005');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
  SELECT 13800 + n, 'Chofer T138-' || n, 'u' || n || '@t138', 'Chofer', 'Activo', ('13800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(10, 17) n;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P138-A', 'Hielo A138', 'Producto Terminado', 30, 0, 0), ('P138-B', 'Hielo B138', 'Producto Terminado', 50, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-138', 'Cuarto 138', '{"P138-A": 200, "P138-B": 50}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
  (13801, 'Cliente T138', 'XAXX010101000', 0, false, 0), (13802, 'Crédito T138', 'XAXX010101000', 0, true, 1000);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (13801, 'R-13801', 'entregas',        13810, 'Chofer T138-10', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 20}', '{"P138-A": 20}', '{}', '{"P138-A": 20}', now()),
  (13802, 'R-13802', 'cierre y exprés', 13811, 'Chofer T138-11', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 10}', '{"P138-A": 10}', '{}', '{"P138-A": 10}', now()),
  (13803, 'R-13803', 'programada',      13812, 'Chofer T138-12', 'Programada',      CURRENT_DATE, '{"P138-A": 10}', '{"P138-A": 10}', '{"P138-A": 2}', '{}', NULL),
  (13804, 'R-13804', 'pendiente firma', 13813, 'Chofer T138-13', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 10}', '{"P138-A": 10}', '{}', '{"P138-A": 10}', now()),
  (13805, 'R-13805', 'recuperación',    13814, 'Chofer T138-14', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 10}', '{"P138-A": 10}', '{}', '{"P138-A": 10}', now()),
  (13806, 'R-13806', 'dinero',          13815, 'Chofer T138-15', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 30}', '{"P138-A": 30}', '{}', '{"P138-A": 30}', now()),
  (13807, 'R-13807', 'sin carga (legacy)', 13816, 'Chofer T138-16', 'En progreso',  CURRENT_DATE, '{}', '{}', '{}', '{}', NULL),
  (13808, 'R-13808', 'merma',           13817, 'Chofer T138-17', 'Pendiente firma', CURRENT_DATE, '{"P138-A": 10}', '{"P138-A": 10}', '{}', '{"P138-A": 10}', now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (13801, 'OV-13801', 13801, 'Cliente T138', '12×A', 360, 'Asignada', 'Efectivo', 'Contado', 13805, 13801),
  (13802, 'OV-13802', 13801, 'Cliente T138', '8×A',  240, 'Asignada', 'Efectivo', 'Contado', 13805, 13801),
  (13803, 'OV-13803', 13801, 'Cliente T138', '5×A',  150, 'Asignada', 'Efectivo', 'Contado', 13805, 13801),
  (13804, 'OV-13804', 13801, 'Cliente T138', '3×B',  150, 'Asignada', 'Efectivo', 'Contado', 13805, 13801),
  (13805, 'OV-13805', 13801, 'Cliente T138', '4×A',  120, 'Asignada', 'Efectivo', 'Contado', 13805, 13802),
  (13806, 'OV-13806', 13801, 'Cliente T138', '9×A',  270, 'Asignada', 'Efectivo', 'Contado', 13805, 13802),
  (13807, 'OV-13807', 13801, 'Cliente T138', '14×A', 420, 'Creada',   'Efectivo', 'Contado', 13805, NULL),
  (13808, 'OV-13808', 13801, 'Cliente T138', '3×A',  90,  'Creada',   'Efectivo', 'Contado', 13805, NULL),
  -- Recuperación: 15 de A "entregadas" en una ruta que cargó 10 (estado anterior a 138).
  (13809, 'OV-13809', 13801, 'Cliente T138', '15×A', 450, 'Asignada', 'Efectivo', 'Contado', 13805, 13805),
  (13810, 'OV-13810', 13801, 'Cliente T138', '2×A',  60,  'Asignada', 'Efectivo', 'Contado', 13805, 13805),
  -- Dinero
  (13811, 'OV-13811', 13802, 'Crédito T138', '4×A',  120, 'Asignada', 'Crédito',  'Credito', 13805, 13806),
  (13812, 'OV-13812', 13802, 'Crédito T138', '4×A',  120, 'Asignada', 'Crédito',  'Credito', 13805, 13806),
  (13813, 'OV-13813', 13801, 'Cliente T138', '4×A',  120, 'Asignada', 'Efectivo', 'Contado', 13805, 13806),
  (13814, 'OV-13814', 13801, 'Cliente T138', '4×A',  120, 'Asignada', 'Efectivo', 'Contado', 13805, 13806),
  (13815, 'OV-13815', 13801, 'Cliente T138', '4×A',  120, 'Asignada', 'Efectivo', 'Contado', 13805, 13806),
  -- Sin carga estructurada y merma
  (13816, 'OV-13816', 13801, 'Cliente T138', '99×A', 2970, 'Asignada', 'Efectivo', 'Contado', 13805, 13807),
  (13817, 'OV-13817', 13801, 'Cliente T138', '7×A',  210, 'Asignada', 'Efectivo', 'Contado', 13805, 13808),
  (13818, 'OV-13818', 13801, 'Cliente T138', '6×A',  180, 'Asignada', 'Efectivo', 'Contado', 13805, 13808);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (13801, 'P138-A', 12, 30, 360), (13802, 'P138-A', 8, 30, 240), (13803, 'P138-A', 5, 30, 150), (13804, 'P138-B', 3, 50, 150),
  (13805, 'P138-A', 4, 30, 120), (13806, 'P138-A', 9, 30, 270), (13807, 'P138-A', 14, 30, 420), (13808, 'P138-A', 3, 30, 90),
  (13809, 'P138-A', 15, 30, 450), (13810, 'P138-A', 2, 30, 60), (13811, 'P138-A', 4, 30, 120), (13812, 'P138-A', 4, 30, 120),
  (13813, 'P138-A', 4, 30, 120), (13814, 'P138-A', 4, 30, 120), (13815, 'P138-A', 4, 30, 120), (13816, 'P138-A', 99, 30, 2970),
  (13817, 'P138-A', 7, 30, 210), (13818, 'P138-A', 6, 30, 180);
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT '%') RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT; v_state TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; v_state := SQLSTATE; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR v_err NOT ILIKE p_like THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 100);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"13800000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
-- Lecturas con los privilegios de quien corre la prueba (el chofer no lee todo).
CREATE OR REPLACE FUNCTION pg_temp.est(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT estatus FROM public.ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION pg_temp.cf() RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT (stock ->> 'P138-A')::int FROM public.cuartos_frios WHERE id = 'CF-138' $$;
CREATE OR REPLACE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.inventario_mov WHERE producto LIKE 'P138-%'),
                        (SELECT COALESCE(sum(cantidad), 0) FROM public.inventario_mov WHERE producto LIKE 'P138-%'),
                        (SELECT stock::text FROM public.cuartos_frios WHERE id = 'CF-138')) $$;
CREATE OR REPLACE FUNCTION pg_temp.dinero(p_orden BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.pagos WHERE orden_id = p_orden), (SELECT COALESCE(sum(monto), 0) FROM public.pagos WHERE orden_id = p_orden),
                        (SELECT count(*) FROM public.movimientos_contables WHERE orden_id = p_orden), (SELECT count(*) FROM public.cuentas_por_cobrar WHERE orden_id = p_orden)) $$;
CREATE TEMP TABLE t138 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t138 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t138 WHERE k = p_k $$;

\echo '── 138: catálogo'
SELECT pg_temp.ok((SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_carga_ruta' AND NOT tgisinternal)
  AND (SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 3
         FROM pg_proc WHERE oid IN ('public.ordenes_guard_carga_ruta()'::regprocedure, 'public.ruta_inventario_resumen(bigint)'::regprocedure, 'public.ruta_entrega_no_reversible(bigint)'::regprocedure)),
  '138-01 la guarda y sus funciones internas: SECURITY DEFINER, search_path fijo, sin EXECUTE por API');
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 5
         FROM pg_proc WHERE oid IN ('public.diagnostico_ruta(bigint)'::regprocedure, 'public.revertir_entrega_ruta(uuid,bigint,text,boolean)'::regprocedure,
                                    'public.asignar_orden(bigint,bigint,bigint)'::regprocedure, 'public.asignar_ordenes_a_ruta(bigint,bigint[])'::regprocedure,
                                    'public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)),
  '138-02 contratos: firma y permisos (sin anon)');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ruta_entregas_revertidas'::regclass)
  AND has_table_privilege('authenticated', 'public.ruta_entregas_revertidas', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ruta_entregas_revertidas', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.ruta_entregas_revertidas', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.ruta_entregas_revertidas', 'DELETE') AND NOT has_table_privilege('anon', 'public.ruta_entregas_revertidas', 'SELECT')
  AND (SELECT count(*) = 1 AND bool_and(cmd = 'SELECT' AND qual = '(erp_rol_activo() = ''Admin''::text)') FROM pg_policies WHERE tablename = 'ruta_entregas_revertidas'),
  '138-03 evidencia de reversiones: RLS, lectura solo Admin, sin escritura por API');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.balance_ruta_interno(bigint)'::regprocedure)) = 'd73858db73b550796aa34b739ba89213'
  AND md5(pg_get_functiondef('public.finalizar_inventario_ruta(uuid,bigint,jsonb)'::regprocedure)) = '6df6f7786484a69b7cb78ea6973b5a47'
  AND md5(pg_get_functiondef('public.registrar_no_entrega(uuid,bigint,text,boolean)'::regprocedure)) = '19438688ddd238152a26488daeecdc20',
  '138-04 el balance canónico, la finalización y la no-entrega de 087 NO cambian (md5 = producción)');

\echo '── 138: cargas por contrato'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES (13801, 10), (13802, 11), (13805, 14), (13806, 15), (13808, 17)) x(ruta, n) LOOP
    PERFORM pg_temp.como(r.n);
    SET LOCAL ROLE authenticated;
    PERFORM confirmar_carga_ruta(('13800000-0000-0000-0000-0000000c' || lpad((r.ruta - 13800)::text, 4, '0'))::uuid, r.ruta::bigint, 'data:image/png;base64,QQ==');
    UPDATE rutas SET estatus = 'En progreso' WHERE id = r.ruta;
    RESET ROLE;
  END LOOP;
END $$;
SELECT pg_temp.ok(pg_temp.cf() = 200 - 20 - 10 - 10 - 30 - 10, '138-05 cinco rutas cargadas por contrato (salieron 80 del cuarto)');
INSERT INTO t138 VALUES ('h0', to_jsonb(pg_temp.huella()));

\echo '── 138: una entrega no consume más de lo cargado'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(10);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13801;
SELECT pg_temp.ok(pg_temp.est(13801) = 'Entregada', '138-06 entrega con carga suficiente (12 de 20): pasa');
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13804$q$,
  '138-07 producto que NO se cargó: rechazada', '22023', '%carga del camión no alcanza%3 de P138-B (en el camión quedan 0)%');
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13802;
SELECT pg_temp.ok(pg_temp.est(13802) = 'Entregada', '138-08 segunda entrega que agota la carga (12 + 8 = 20): pasa');
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13803$q$,
  '138-09 la tercera ya no cabe (cuentan las entregas anteriores): rechazada', '22023', '%5 de P138-A (en el camión quedan 0)%');
SELECT pg_temp.ok(pg_temp.est(13803) = 'Asignada' AND pg_temp.est(13804) = 'Asignada' AND pg_temp.dinero(13803) = '0|0|0|0',
  '138-10 la rechazada sigue Asignada, sin cobro: no queda en un estado a medias');
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13801;
SELECT pg_temp.ok(pg_temp.est(13801) = 'Entregada', '138-11 reintento de una entrega ya registrada: sin efecto y sin error');
-- La merma también consume carga.
SELECT pg_temp.como(17);
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO mermas (sku, cantidad, causa, origen, ruta_id, estatus) VALUES ('P138-A', 4, 'Derretido', 'Ruta', 13808, 'Activa');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(17);
SELECT pg_temp.falla($q$UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13817$q$,
  '138-12 la merma registrada cuenta: 7 no caben en 10 − 4', '22023', '%7 de P138-A (en el camión quedan 6)%');
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13818;
SELECT pg_temp.ok(pg_temp.est(13818) = 'Entregada', '138-13 y 6 sí caben');
-- Ruta sin carga estructurada (camino anterior a 087): sin cambio.
SELECT pg_temp.como(16);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13816;
SELECT pg_temp.ok(pg_temp.est(13816) = 'Entregada', '138-14 ruta sin carga confirmada: la guarda no interviene (comportamiento anterior)');

\echo '── 138: no se agregan pedidos a una ruta con carga'
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT asignar_ordenes_a_ruta(13801, ARRAY[13808]::BIGINT[])$q$,
  '138-15 "+ Órdenes" sobre una ruta ya cargada: rechazado', '22023', '%ya tiene su carga capturada%');
SELECT pg_temp.falla($q$SELECT asignar_ordenes_a_ruta(13804, ARRAY[13808]::BIGINT[])$q$,
  '138-16 sobre una ruta con carga capturada en espera de firma: rechazado', '22023', '%ya tiene su carga capturada%');
SELECT pg_temp.falla($q$SELECT asignar_orden(13808, 13801, 13801)$q$, '138-17 asignar_orden a una ruta cargada: rechazado', '22023', '%ya tiene su carga capturada%');
SELECT pg_temp.ok(pg_temp.est(13808) = 'Creada' AND (SELECT ruta_id IS NULL FROM ordenes WHERE id = 13808), '138-18 el pedido sigue Creado y sin ruta');
INSERT INTO t138 VALUES ('a0', asignar_ordenes_a_ruta(13801, ARRAY[13803]::BIGINT[]));
SELECT pg_temp.ok((pg_temp.j('a0') ->> 'ordenes_asignadas')::int = 0, '138-19 repetir la asignación de una orden que ya es de la ruta: no-op permitido');
INSERT INTO t138 VALUES ('a1', asignar_ordenes_a_ruta(13803, ARRAY[13807]::BIGINT[]));
SELECT pg_temp.ok((pg_temp.j('a1') ->> 'ordenes_asignadas')::int = 1 AND pg_temp.est(13807) = 'Asignada'
  AND pg_temp.j('a1') -> 'sin_cubrir' = '[{"sku":"P138-A","pedido":14,"autorizado":12,"falta":2}]'::jsonb
  AND (SELECT carga_autorizada = '{"P138-A": 10}'::jsonb AND extra_autorizado = '{"P138-A": 2}'::jsonb FROM rutas WHERE id = 13803),
  '138-20 antes de cargar sí se agrega; la carga autorizada NO sube sola y la respuesta dice cuánto falta cubrir (14 pedidos, 12 autorizados)');
INSERT INTO t138 VALUES ('a2', asignar_ordenes_a_ruta(13803, ARRAY[13807]::BIGINT[]));
SELECT asignar_orden(13808, NULL, 13801);
SELECT pg_temp.ok(pg_temp.est(13808) = 'Asignada' AND (SELECT ruta_id IS NULL FROM ordenes WHERE id = 13808), '138-21 "Enviar a ruta" (Asignada sin ruta) sigue igual');

\echo '── 138: el cierre financiero no registra un exceso'
SELECT pg_temp.como(11);
SELECT pg_temp.falla($q$SELECT cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f1'::uuid, 13802,
  '[{"ordenId": 13805, "pago": "Efectivo"}, {"express": true, "pago": "Efectivo", "items": [{"sku": "P138-A", "cant": 7, "precio": 30}]}]'::jsonb, 13811, 'x')$q$,
  '138-22 venta exprés que no cabe (4 + 7 > 10): el cierre financiero se rechaza', '22023', '%supera lo que se cargó: P138-A (cargado 10, vendido y entregado 11)%');
SELECT pg_temp.falla($q$SELECT cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f2'::uuid, 13802,
  '[{"ordenId": 13805, "pago": "Efectivo"}, {"ordenId": 13806, "pago": "Efectivo"}]'::jsonb, 13811, 'x')$q$,
  '138-23 orden entregada solo en el cierre que no cabe (4 + 9 > 10): rechazada por la guarda', '22023', '%No se puede entregar OV-13806%');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = 13802) AND pg_temp.est(13805) = 'Asignada' AND pg_temp.est(13806) = 'Asignada'
  AND (SELECT count(*) = 2 FROM ordenes WHERE ruta_id = 13802) AND NOT EXISTS (SELECT 1 FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 13802),
  '138-24 los cierres rechazados no dejaron NADA: ni cierre, ni órdenes entregadas, ni venta exprés, ni pagos');
-- Cierre normal: una entrega, una no-entrega y una exprés que sí cabe; conteo y devolución.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(11);
SELECT registrar_no_entrega('13800000-0000-0000-0000-0000000000a1'::uuid, 13806, 'Local cerrado', false);
INSERT INTO t138 VALUES ('f1', cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f3'::uuid, 13802,
  '[{"ordenId": 13805, "pago": "Efectivo"}, {"express": true, "pago": "Efectivo", "items": [{"sku": "P138-A", "cant": 3, "precio": 30}]}]'::jsonb, 13811, 'x'));
INSERT INTO t138 VALUES ('f1b', cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f3'::uuid, 13802,
  '[{"ordenId": 13805, "pago": "Efectivo"}, {"express": true, "pago": "Efectivo", "items": [{"sku": "P138-A", "cant": 3, "precio": 30}]}]'::jsonb, 13811, 'x'));
INSERT INTO t138 VALUES ('i1', finalizar_inventario_ruta('13800000-0000-0000-0000-0000000000e1'::uuid, 13802, '{"P138-A": 3}'::jsonb));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('f1') ->> 'success')::boolean AND (pg_temp.j('f1') ->> 'pagos')::int = 2 AND (pg_temp.j('f1b') ->> 'replay')::boolean
  AND pg_temp.j('i1') ->> 'estatus' = 'Cerrada' AND (SELECT estatus = 'Cerrada' FROM rutas WHERE id = 13802) AND pg_temp.cf() = 120 + 3
  AND (SELECT count(*) = 2 AND sum(monto) = 210 FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 13802),
  '138-25 cierre normal sin cambios: cobros una sola vez (el reintento es replay), conteo, 3 bolsas de vuelta al cuarto, ruta Cerrada');

\echo '── 138: recuperación de una ruta que ya estaba inconsistente'
-- Estado anterior a 138: una entrega de 15 en una ruta que cargó 10, cobrada en efectivo.
SET LOCAL session_replication_role = replica;
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo', delivered_at = now() WHERE id = 13809;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(14);
SELECT registrar_pago_orden(13809, 'Efectivo', NULL, 13814);
SELECT pg_temp.falla($q$SELECT cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f5'::uuid, 13805, '[{"ordenId": 13809, "pago": "Efectivo"}]'::jsonb, 13814, 'x')$q$,
  '138-26 la ruta inconsistente ya no registra su cierre financiero: dice por qué', '22023', '%supera lo que se cargó: P138-A (cargado 10, vendido y entregado 15)%');
-- En la API cada llamada es su propia transacción; aquí todo corre en una, así que la marca de
-- contrato (app.fin_ctx, local a la transacción) se limpia antes de probar permisos.
SELECT set_config('app.fin_ctx', '', true);
SELECT pg_temp.falla($q$SELECT diagnostico_ruta(13805)$q$, '138-27 el diagnóstico es solo de Admin', '42501');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'El chofer la marcó por error', true)$q$,
  '138-28 el chofer no revierte entregas', '42501');
SELECT pg_temp.como(5); SELECT set_config('app.fin_ctx', '', true);
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'El chofer la marcó por error', true)$q$,
  '138-29 Ventas tampoco', '42501');
SELECT pg_temp.como(1);
INSERT INTO t138 VALUES ('d0', diagnostico_ruta(13805));
SELECT pg_temp.ok(NOT (pg_temp.j('d0') ->> 'consistente')::boolean AND (pg_temp.j('d0') ->> 'exceso_total')::int = 5
  AND pg_temp.j('d0') -> 'inventario' = '[{"sku":"P138-A","cargado":10,"entregado":15,"merma":0,"devuelto":0,"restante":-5,"exceso":5}]'::jsonb
  AND (SELECT o ->> 'no_reversible' IS NULL AND (o ->> 'cobrado')::numeric = 450 FROM jsonb_array_elements(pg_temp.j('d0') -> 'ordenes') o WHERE o ->> 'folio' = 'OV-13809')
  AND (pg_temp.j('d0') ->> 'pendientes')::int = 1,
  '138-30 diagnóstico: cargado 10, entregado 15, exceso 5; la orden es reversible y tiene $450 cobrados');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'x', true)$q$, '138-31 sin motivo: rechazada', '22023', '%motivo%');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'El chofer la marcó por error', false)$q$,
  '138-32 con cobro registrado exige reconocerlo: no se borra dinero en silencio', '22023', '%tiene $450%NO borra ese cobro%');
SELECT pg_temp.ok(pg_temp.est(13809) = 'Entregada' AND NOT EXISTS (SELECT 1 FROM ruta_entregas_revertidas WHERE orden_id = 13809), '138-33 los rechazos no cambiaron nada ni dejaron evidencia falsa');
INSERT INTO t138 VALUES ('m0', to_jsonb(pg_temp.dinero(13809))), ('h1', to_jsonb(pg_temp.huella()));
INSERT INTO t138 VALUES ('r1', revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'El chofer la marcó por error', true));
INSERT INTO t138 VALUES ('r1b', revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13809, 'El chofer la marcó por error', true));
SELECT pg_temp.ok((pg_temp.j('r1') ->> 'ok')::boolean AND pg_temp.j('r1') ->> 'estatus' = 'Asignada' AND (pg_temp.j('r1') ->> 'cobro_conservado')::numeric = 450
  AND (pg_temp.j('r1') ->> 'ruta_consistente')::boolean AND NOT (pg_temp.j('r1') ->> 'replay')::boolean
  AND pg_temp.est(13809) = 'Asignada' AND (SELECT delivered_at IS NULL AND ruta_id = 13805 FROM ordenes WHERE id = 13809),
  '138-34 reversión autorizada: la orden vuelve a Asignada en su ruta, sin fecha de entrega; la ruta queda consistente');
SELECT pg_temp.ok((pg_temp.j('r1b') ->> 'replay')::boolean AND (pg_temp.j('r1b') - 'replay') = (pg_temp.j('r1') - 'replay')
  AND (SELECT count(*) = 1 FROM ruta_entregas_revertidas WHERE orden_id = 13809)
  AND (SELECT count(*) = 1 FROM auditoria WHERE accion = 'Revertir entrega' AND detalle LIKE 'OV-13809%cobro de $450%conservado%'),
  '138-35 reintento con la misma operación: misma respuesta, una sola evidencia y una sola línea de auditoría');
SELECT pg_temp.ok(pg_temp.dinero(13809) = pg_temp.j('m0') #>> '{}' AND pg_temp.huella() = pg_temp.j('h1') #>> '{}',
  '138-36 dinero intacto (pago y movimiento conservados, sin cuenta por cobrar) e inventario y kardex intactos');
SELECT pg_temp.ok((SELECT motivo = 'El chofer la marcó por error' AND actor LIKE '%Admin T138%' AND actor_id = 13801 AND ruta_id = 13805
                          AND antes ->> 'estatus' = 'Entregada' AND antes ->> 'delivered_at' IS NOT NULL AND (antes ->> 'cobrado')::numeric = 450
                          AND antes -> 'lineas' = '[{"sku":"P138-A","cantidad":15}]'::jsonb AND antes -> 'inventario_ruta' -> 0 ->> 'entregado' = '15'
                          AND resultado ->> 'estatus' = 'Asignada' FROM ruta_entregas_revertidas WHERE orden_id = 13809),
  '138-37 evidencia: quién, cuándo, por qué y el estado anterior completo (estatus, fecha, cobro, líneas, inventario de la ruta)');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b2'::uuid, 13809, 'Otra vez la misma orden', true)$q$,
  '138-38 otra operación sobre la misma orden: ya no está Entregada', '22023', '%No está Entregada%');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b1'::uuid, 13810, 'Operación reutilizada', true)$q$,
  '138-39 misma operación con otra orden: rechazada', '23505');
-- La ruta recuperada se cierra por el camino normal: Admin marca no entregadas, cierre y conteo.
SELECT registrar_no_entrega('13800000-0000-0000-0000-0000000000a2'::uuid, 13809, 'Entrega revertida: no se entregó', false);
SELECT registrar_no_entrega('13800000-0000-0000-0000-0000000000a3'::uuid, 13810, 'No se alcanzó a visitar', false);
SELECT cerrar_ruta_financiero('13800000-0000-0000-0000-0000000000f6'::uuid, 13805, '[]'::jsonb, 13801, 'Admin T138');
INSERT INTO t138 VALUES ('i2', finalizar_inventario_ruta('13800000-0000-0000-0000-0000000000e2'::uuid, 13805, '{"P138-A": 10}'::jsonb));
SELECT pg_temp.ok(pg_temp.j('i2') ->> 'estatus' = 'Cerrada' AND pg_temp.cf() = 123 + 10 AND pg_temp.dinero(13809) = pg_temp.j('m0') #>> '{}',
  '138-40 la ruta recuperada cierra sin SQL: las 10 bolsas vuelven al cuarto una sola vez y el cobro conservado sigue ahí');
SELECT pg_temp.ok((SELECT (o ->> 'no_reversible') LIKE '%No está Entregada%' FROM jsonb_array_elements(diagnostico_ruta(13805) -> 'ordenes') o WHERE o ->> 'folio' = 'OV-13809') IS NOT FALSE
  AND (diagnostico_ruta(13805) -> 'revertidas' -> 0 ->> 'folio') = 'OV-13809', '138-41 el diagnóstico conserva el historial de lo revertido');

\echo '── 138: dinero en la reversión'
SELECT pg_temp.como(15);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Crédito' WHERE id IN (13811, 13812);
SELECT crear_cxc_orden(13811, 30); SELECT crear_cxc_orden(13812, 30);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id IN (13813, 13814, 13815);
SELECT pg_temp.como(1);
SELECT abonar_cxc((SELECT id FROM cuentas_por_cobrar WHERE orden_id = 13812), 20, 'Efectivo', NULL, 13801);
INSERT INTO t138 VALUES ('r2', revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b3'::uuid, 13811, 'Se fió por error: no se entregó', false));
SELECT pg_temp.ok((pg_temp.j('r2') ->> 'cxc_anulada')::boolean AND (pg_temp.j('r2') ->> 'cxc_monto')::numeric = 120 AND (pg_temp.j('r2') ->> 'cobro_conservado')::numeric = 0
  AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar WHERE orden_id = 13811) AND (SELECT saldo = 100 FROM clientes WHERE id = 13802)
  AND (SELECT antes -> 'cxc' ->> 'saldo_pendiente' = '120.00' FROM ruta_entregas_revertidas WHERE orden_id = 13811),
  '138-42 fiado sin abonos: la cuenta por cobrar se anula con el contrato de 090 y el saldo del cliente baja (220 → 100); queda en la evidencia');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b4'::uuid, 13812, 'Fiado con abono', true)$q$,
  '138-43 fiado CON abonos: no se revierte (efecto financiero no compensable)', '22023', '%ya tiene abonos%');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'FM-138', facturama_uuid = 'UUID-138' WHERE id = 13813;
UPDATE ordenes SET tiene_devolucion = true WHERE id = 13814;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b5'::uuid, 13813, 'Orden ya facturada', true)$q$,
  '138-44 orden Facturada: no se revierte (efecto externo)', '22023', '%facturada%');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b6'::uuid, 13814, 'Orden con devolución', true)$q$,
  '138-45 orden con devolución: no se revierte', '22023', '%devolución%');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b7'::uuid, 13805, 'Ruta ya cerrada', true)$q$,
  '138-46 orden de una ruta ya Cerrada: no se revierte (para eso es la devolución)', '22023', '%ya está Cerrada%');
SELECT pg_temp.falla($q$SELECT revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b8'::uuid, 13816, 'Ruta sin carga', true)$q$,
  '138-47 orden de una ruta sin carga estructurada: fuera de este contrato', '22023', '%no tiene carga confirmada por contrato%');
INSERT INTO t138 VALUES ('r3', revertir_entrega_ruta('13800000-0000-0000-0000-0000000000b9'::uuid, 13815, 'Marcada por error, sin cobro', false));
SELECT pg_temp.ok((pg_temp.j('r3') ->> 'ok')::boolean AND pg_temp.est(13815) = 'Asignada', '138-48 entrega sin efectos de dinero: se revierte sin pedir nada más');
-- La orden revertida se vuelve a entregar: fecha nueva, y la guarda vuelve a contar.
SELECT pg_temp.como(15);
UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = 13815;
RESET ROLE;
SELECT pg_temp.ok((SELECT estatus = 'Entregada' AND delivered_at IS NOT NULL FROM ordenes WHERE id = 13815), '138-49 la orden revertida se puede volver a entregar y estrena fecha de entrega');
UPDATE ordenes SET delivered_at = NULL WHERE id = 13815;
SELECT pg_temp.ok((SELECT delivered_at IS NOT NULL FROM ordenes WHERE id = 13815), '138-50 fuera de la reversión la fecha de entrega sigue sin poder borrarse (093 sin cambio)');
SELECT pg_temp.ok(pg_temp.j('h0') #>> '{}' = '5|80|{"P138-A": 120, "P138-B": 50}' AND pg_temp.huella() = '7|93|{"P138-A": 133, "P138-B": 50}',
  '138-51 kardex final: 5 cargas (80) + 2 devoluciones de cierre (3 y 10) y nada más; ninguna entrega rechazada ni reversión movió inventario');

ROLLBACK;
\echo '── 138: TODAS LAS PRUEBAS OK'
