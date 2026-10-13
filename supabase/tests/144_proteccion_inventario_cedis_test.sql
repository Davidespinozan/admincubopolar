-- 144_proteccion_inventario_cedis_test.sql — Tiendas propias, E2: las operaciones
-- centrales (carga de ruta, pedido, ajuste) usan SOLO inventario del CEDIS; el traspaso
-- entre cuartos no cruza establecimientos salvo CEDIS ↔ tienda de fábrica con
-- autorización explícita; Producción y Chofer no mueven inventario de una tienda.
-- Escenario aislado: se enciende el interruptor de tiendas DENTRO de la transacción y
-- todo se deshace con ROLLBACK. (Concurrencia con dos conexiones: C144a–e en el runner.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t144.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
-- Escenario: una tienda de fábrica y una tienda externa (solo dentro de esta prueba).
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 144';
INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('TFAB144', 'Tienda de fábrica 144', 'tienda_fabrica'), ('TEXT144', 'Tienda externa 144', 'tienda');
CREATE TEMP TABLE t144 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t144 TO authenticated;
INSERT INTO t144 SELECT 'tf', to_jsonb(id) FROM establecimientos WHERE clave = 'TFAB144';
INSERT INTO t144 SELECT 'tx', to_jsonb(id) FROM establecimientos WHERE clave = 'TEXT144';
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t144 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.eid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v #>> '{}')::bigint FROM t144 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t144' FROM generate_series(1, 9) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14401, 'Admin T144',        'u1@t144', 'Admin',      'Activo', '14400000-0000-0000-0000-000000000001'),
  (14402, 'Ventas T144',       'u2@t144', 'Ventas',     'Activo', '14400000-0000-0000-0000-000000000002'),
  (14403, 'Produccion T144',   'u3@t144', 'Producción', 'Activo', '14400000-0000-0000-0000-000000000003'),
  (14404, 'Chofer T144',       'u4@t144', 'Chofer',     'Activo', '14400000-0000-0000-0000-000000000004'),
  (14405, 'Empleado T144',     'u5@t144', 'Empleado',   'Activo', '14400000-0000-0000-0000-000000000005'),
  (14406, 'Chofer Dos T144',   'u6@t144', 'Chofer',     'Activo', '14400000-0000-0000-0000-000000000006'),
  (14407, 'Produccion Aut T144', 'u7@t144', 'Producción', 'Activo', '14400000-0000-0000-0000-000000000007'),
  (14408, 'Admin Aut T144',    'u8@t144', 'Admin',      'Activo', '14400000-0000-0000-0000-000000000008');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P144-A', 'Hielo A144', 'Producto Terminado', 30, 0, 0);
-- Los congeladores de tienda van PRIMERO por orden de id: antes de 144 una carga los habría vaciado primero.
INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES
  ('CF-144-A-TF',  'Congelador tienda de fábrica', '{"P144-A": 30}', pg_temp.eid('tf')),
  ('CF-144-B-TX',  'Congelador tienda externa',    '{"P144-A": 40}', pg_temp.eid('tx')),
  ('CF-144-B-TX2', 'Congelador 2 tienda externa',  '{}',             pg_temp.eid('tx')),
  ('CF-144-C1',    'Cuarto CEDIS 1',               '{"P144-A": 100}', 1),
  ('CF-144-C2',    'Cuarto CEDIS 2',               '{"P144-A": 20}',  1);
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (14401, 'Cliente T144', 'XAXX010101000', 0, false, 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (14401, 'R-14401', 'carga normal',  14404, 'Chofer T144', 'Pendiente firma', CURRENT_DATE, '{"P144-A": 110}', '{"P144-A": 110}', '{}', '{"P144-A": 110}', now()),
  (14402, 'R-14402', 'carga de más',  14406, 'Chofer Dos T144', 'Pendiente firma', CURRENT_DATE, '{"P144-A": 15}',  '{"P144-A": 15}',  '{}', '{"P144-A": 15}',  now());
SET LOCAL session_replication_role = origin;
-- Autorización explícita CEDIS ↔ tienda de fábrica: solo Producción Aut (7) y Admin Aut (8). Además, 7 y 3 pertenecen a la tienda externa SIN esa marca.
INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, traspasa_con_cedis, asignado_por) VALUES
  (14407, pg_temp.eid('tf'), true, 'prueba 144'), (14408, pg_temp.eid('tf'), true, 'prueba 144'),
  (14403, pg_temp.eid('tf'), false, 'prueba 144'), (14407, pg_temp.eid('tx'), true, 'prueba 144');

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
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"14400000-0000-0000-0000-00000000000' || p_n || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14400000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Existencia de P144-A: tienda fábrica|tienda externa|externa 2|CEDIS 1|CEDIS 2
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(COALESCE(stock ->> 'P144-A', '0'), '|' ORDER BY id) FROM public.cuartos_frios WHERE id LIKE 'CF-144-%' $$;
-- Movimientos de kardex de P144-A en cuartos de tienda
CREATE OR REPLACE FUNCTION pg_temp.kt() RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.inventario_mov WHERE producto = 'P144-A' AND cuarto_id IN ('CF-144-A-TF', 'CF-144-B-TX', 'CF-144-B-TX2') $$;

\echo '── 144: catálogo'
SELECT pg_temp.ok(current_setting('t144.apagado_al_inicio')::boolean, '144-01 el interruptor de tiendas estaba APAGADO al empezar (144 no lo toca); se encendió solo dentro de esta prueba');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure)) = '50ce141b71b2692a015a1cd77e780fec'
  AND md5(pg_get_functiondef('public.crear_orden(jsonb,jsonb)'::regprocedure)) = 'ccdd240c58f69d89699c99c89199e911'
  AND md5(pg_get_functiondef('public.ajustar_existencia(uuid,text,integer,text)'::regprocedure)) = '0a5f9c2c95b89c0deb8a38bca5dd7f8a'
  AND md5(pg_get_functiondef('public.traspaso_cuartos(uuid,text,text,text,integer)'::regprocedure)) = 'f73c7272614080b951bfc3d813f8dff4',
  '144-02 los cuatro contratos autorizados tienen la definición nueva esperada');
SELECT pg_temp.ok((SELECT count(*) = 4 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.oid IN ('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure, 'public.crear_orden(jsonb,jsonb)'::regprocedure,
                                                    'public.ajustar_existencia(uuid,text,integer,text)'::regprocedure, 'public.traspaso_cuartos(uuid,text,text,text,integer)'::regprocedure)),
  '144-03 conservan firma, SECURITY DEFINER, search_path y permisos (authenticated sí, anon y PUBLIC no)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure)) = '3591d07446854c4a682cd41f88489ec6'
  AND md5(pg_get_functiondef('public.update_orden_atomic(bigint,jsonb,jsonb)'::regprocedure)) = '443fcb9caf68aa44f1c3f595103ad63d'
  AND md5(pg_get_functiondef('public.cuartos_frios_guard()'::regprocedure)) = '2974531ebf77425705492a8efde55c73'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) IN ('27277fcf645f05134275473c7892b769', 'e1a9770e1bc5cebd7f565c9cfdc2a880')
  AND md5(pg_get_functiondef('public.erp_roles_activos()'::regprocedure)) IN ('53c2999e3a7e19c781999d73ea052c68', '5da5963d56554336793351384f018d74')
  AND md5(pg_get_functiondef('public.erp_lector_negocio()'::regprocedure)) IN ('d97f617862eda14b2d86100221e9885b', '858e98ff65b09e80477dde7298b164d2')
  AND md5(pg_get_functiondef('public.finalizar_inventario_ruta(uuid,bigint,jsonb)'::regprocedure)) = '6df6f7786484a69b7cb78ea6973b5a47'
  AND md5(pg_get_functiondef('public.cerrar_ruta_admin(uuid,bigint,text,jsonb,jsonb,text)'::regprocedure)) = 'd25f37e2123b47e7f31215f8fbf746c7'
  AND md5(pg_get_functiondef('public.registrar_venta_rapida_ruta(uuid,bigint,bigint,text,jsonb,text,boolean,text,timestamptz)'::regprocedure)) = '68c38f4847373536ee80b5ff3a981311'
  AND md5(pg_get_functiondef('public.entregar_orden_ruta(uuid,bigint,text,text,text)'::regprocedure)) = '29967d7a0208ae34f279838a35e87f04',
  '144-04 NO cambian venta de mostrador, kardex, edición de pedidos, guarda del cuarto, identidad (E3), lectura general, cierre de ruta ni T5: md5 = producción');
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('traspaso_fabrica_autorizado', 'cuartos_frios_guard_actor'))
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.cuartos_frios'::regclass AND tgname = 'trg_cuartos_frios_actor' AND NOT tgisinternal AND tgenabled = 'O')
  AND (SELECT is_nullable = 'NO' AND column_default = 'false' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuario_establecimientos' AND column_name = 'traspasa_con_cedis')
  AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cuartos_frios' AND policyname <> 'tienda_read')
  AND NOT has_table_privilege('authenticated', 'public.usuario_establecimientos', 'SELECT'),
  '144-05 la autorización y la guarda no son ejecutables por API; el disparador está activo; la marca de autorización nace apagada; policies de cuartos sin cambio');
-- La marca que reconoce la guarda solo la fija traspaso_cuartos, y ninguna función pública deja fijar una variable por nombre.
SELECT pg_temp.ok((SELECT string_agg(p.proname, ',' ORDER BY p.proname) = 'traspaso_cuartos' FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
                      AND pg_get_functiondef(p.oid) ~ 'set_config\(''app\.traspaso_ctx''')
  AND (SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND pg_get_functiondef(p.oid) ~ 'set_config\(\s*p_'),
  '144-06 la excepción de la guarda no es falsificable por RPC: solo traspaso_cuartos fija su marca y no existe función pública que fije variables por nombre');
SELECT pg_temp.ok(pg_temp.inv() = '30|40|0|100|20', '144-07 escenario: tienda de fábrica 30, tienda externa 40, CEDIS 100 + 20');

\echo '── 144 A: la carga de ruta sale SOLO del CEDIS'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(4);
INSERT INTO t144 VALUES ('c1', confirmar_carga_ruta(pg_temp.op(1), 14401, 'data:image/png;base64,QQ=='));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|40|0|0|10' AND pg_temp.kt() = 0
  AND (SELECT count(*) = 2 AND bool_and(x ->> 'cuarto_id' IN ('CF-144-C1', 'CF-144-C2')) AND sum((x ->> 'cantidad')::int) = 110 FROM jsonb_array_elements(pg_temp.j('c1') -> 'asignacion') x)
  AND (SELECT estatus = 'Cargada' FROM rutas WHERE id = 14401),
  '144-08 carga de 110: salieron 100 y 10 de los dos cuartos del CEDIS; los congeladores de tienda (que van antes por id) NO se tocaron, ni en existencia ni en kardex');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(4);
INSERT INTO t144 VALUES ('c1r', confirmar_carga_ruta(pg_temp.op(1), 14401, 'data:image/png;base64,QQ=='));
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT confirmar_carga_ruta(pg_temp.op(2), 14402, 'data:image/png;base64,QQ==')$q$,
  '144-09 otra ruta pide 15 y al CEDIS le quedan 10: se rechaza aunque las tiendas tengan 70', 'P0001|22023', '%Inventario insuficiente para cargar 15 de P144-A (faltan 5)%');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('c1r') ->> 'replay')::boolean AND pg_temp.inv() = '30|40|0|0|10' AND (SELECT estatus = 'Pendiente firma' AND carga_confirmada_at IS NULL FROM rutas WHERE id = 14402),
  '144-10 el reintento de la primera carga es replay; el rechazo no dejó nada (la segunda ruta sigue sin cargar, existencias iguales)');

\echo '── 144 B: el pedido central cuenta SOLO existencia del CEDIS'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 14401, "metodo_pago": "Efectivo"}'::jsonb, '[{"sku": "P144-A", "cantidad": 15}]'::jsonb)$q$,
  '144-11 pedido de 15 con 10 en el CEDIS: "disponible: 10" (no 80)', '22023', '%Stock insuficiente para P144-A (disponible: 10, pedido: 15)%');
SELECT pg_temp.como(2);
INSERT INTO t144 VALUES ('o1', crear_orden('{"cliente_id": 14401, "metodo_pago": "Efectivo", "permitir_sin_stock": true}'::jsonb, '[{"sku": "P144-A", "cantidad": 15}]'::jsonb));
SELECT pg_temp.como(2);
INSERT INTO t144 VALUES ('o2', crear_orden('{"cliente_id": 14401, "metodo_pago": "Efectivo"}'::jsonb, '[{"sku": "P144-A", "cantidad": 10}]'::jsonb));
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 1 AND min((x ->> 'disponible')::int) = 10 AND min((x ->> 'falta')::int) = 5 FROM jsonb_array_elements(pg_temp.j('o1') -> 'faltantes') x)
  AND pg_temp.j('o2') -> 'faltantes' = '[]'::jsonb AND (pg_temp.j('o2') ->> 'total')::numeric = 300 AND pg_temp.j('o2') ->> 'estatus' = 'Creada'
  AND (SELECT establecimiento_id IS NULL FROM ordenes WHERE id = (pg_temp.j('o2') ->> 'id')::bigint),
  '144-12 pedido por surtir: anota "disponible 10, faltan 5"; un pedido de 10 entra sin faltantes; precio, total y estatus como siempre');

\echo '── 144 C: el ajuste central de producto terminado es del CEDIS'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t144 VALUES ('a1', ajustar_existencia(pg_temp.op(10), 'P144-A', 25, 'Conteo de prueba 144'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('a1') ->> 'anterior')::int = 10 AND (pg_temp.j('a1') ->> 'nueva')::int = 25 AND pg_temp.inv() = '30|40|0|0|25' AND pg_temp.kt() = 0,
  '144-13 ajuste a 25: la existencia anterior era 10 (la del CEDIS, no 80) y la entrada de 15 fue a un cuarto del CEDIS');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t144 VALUES ('a2', ajustar_existencia(pg_temp.op(11), 'P144-A', 0, 'Conteo en cero de prueba 144'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|40|0|0|0' AND pg_temp.kt() = 0, '144-14 ajuste a 0: se vacía el CEDIS; los congeladores de tienda conservan sus 30 y 40, sin un solo movimiento de kardex');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT ajustar_existencia(pg_temp.op(13), 'P144-A', 5, 'Producción no ajusta')$q$, '144-15 el ajuste central sigue siendo solo de Administración', '42501', '%no autorizado%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|40|0|0|0' AND (SELECT COALESCE(sum((stock ->> 'P144-A')::int), 0) = 0 FROM cuartos_frios WHERE establecimiento_id = 1),
  '144-16 tras el rechazo: el CEDIS sigue en 0 y las tiendas en 30 y 40');
-- Deja el CEDIS con 40 y 20 para los traspasos (por contrato, como Administración).
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT ajustar_existencia_cuarto(pg_temp.op(14), 'CF-144-C1', 'P144-A', 40, 'Reparto de prueba 144');
SELECT pg_temp.como(1);
SELECT ajustar_existencia_cuarto(pg_temp.op(15), 'CF-144-C2', 'P144-A', 20, 'Reparto de prueba 144');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|40|0|40|20', '144-17 (preparación) CEDIS 40 + 20; tiendas 30 y 40');

\echo '── 144 D: traspaso entre cuartos'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
INSERT INTO t144 VALUES ('t1', traspaso_cuartos(pg_temp.op(20), 'CF-144-C1', 'CF-144-C2', 'P144-A', 5));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('t1') ->> 'stock_origen')::int = 35 AND (pg_temp.j('t1') ->> 'stock_destino')::int = 25 AND pg_temp.inv() = '30|40|0|35|25',
  '144-18 dentro del CEDIS, Producción traspasa como siempre');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t144 VALUES ('t2', traspaso_cuartos(pg_temp.op(21), 'CF-144-B-TX', 'CF-144-B-TX2', 'P144-A', 4));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|36|4|35|25', '144-19 dentro de UNA tienda (mismo establecimiento), Administración traspasa entre sus dos congeladores');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(22), 'CF-144-C1', 'CF-144-B-TX', 'P144-A', 1)$q$,
  '144-20 CEDIS → tienda externa: rechazado también para Administración (va por despacho y recepción)', '22023', '%establecimientos distintos%', 'TRASPASO_ENTRE_ESTABLECIMIENTOS');
SELECT pg_temp.como(8);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(23), 'CF-144-B-TX', 'CF-144-C1', 'P144-A', 1)$q$,
  '144-21 tienda externa → CEDIS: rechazado aunque el Admin tenga la autorización de fábrica', '22023', '%establecimientos distintos%', 'TRASPASO_ENTRE_ESTABLECIMIENTOS');
SELECT pg_temp.como(8);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(24), 'CF-144-B-TX', 'CF-144-A-TF', 'P144-A', 1)$q$,
  '144-22 tienda externa → tienda de fábrica: rechazado', '22023', '%establecimientos distintos%', 'TRASPASO_ENTRE_ESTABLECIMIENTOS');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(25), 'CF-144-C1', 'CF-144-A-TF', 'P144-A', 5)$q$,
  '144-23 CEDIS → tienda de fábrica SIN autorización explícita: rechazado, también para Administración', '42501', '%No tienes autorización%', 'TRASPASO_NO_AUTORIZADO');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(26), 'CF-144-C1', 'CF-144-A-TF', 'P144-A', 5)$q$,
  '144-24 Producción asignada a la tienda de fábrica pero SIN la marca de traspaso: rechazado', '42501', '%No tienes autorización%', 'TRASPASO_NO_AUTORIZADO');
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(27), 'CF-144-C1', 'CF-144-C2', 'P144-A', 1)$q$, '144-25 Ventas sigue sin poder traspasar (permiso de siempre)', '42501', '%no autorizado%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '30|36|4|35|25' AND (SELECT count(*) = 0 FROM stock_operaciones WHERE operacion_id IN (pg_temp.op(22), pg_temp.op(23), pg_temp.op(24), pg_temp.op(25), pg_temp.op(26), pg_temp.op(27))),
  '144-26 seis traspasos rechazados: ninguna existencia cambió y no quedó ninguna operación registrada');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(7);
INSERT INTO t144 VALUES ('t3', traspaso_cuartos(pg_temp.op(30), 'CF-144-C1', 'CF-144-A-TF', 'P144-A', 10));
INSERT INTO t144 VALUES ('ctx', to_jsonb(COALESCE(current_setting('app.traspaso_ctx', true), '')));
SELECT pg_temp.como(8);
INSERT INTO t144 VALUES ('t4', traspaso_cuartos(pg_temp.op(31), 'CF-144-A-TF', 'CF-144-C2', 'P144-A', 3));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('t3') ->> 'stock_destino')::int = 40 AND (pg_temp.j('t4') ->> 'stock_origen')::int = 37 AND pg_temp.inv() = '37|36|4|25|28' AND pg_temp.j('ctx') #>> '{}' = ''
  AND (SELECT count(*) = 4 FROM inventario_mov WHERE operacion_id IN (pg_temp.op(30), pg_temp.op(31))),
  '144-27 CON autorización explícita: Producción mueve 10 del CEDIS a la tienda de fábrica y el Admin autorizado regresa 3; 2 movimientos por traspaso; la marca queda limpia al terminar');
UPDATE usuario_establecimientos SET traspasa_con_cedis = false WHERE usuario_id = 14407 AND establecimiento_id = pg_temp.eid('tf');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(7);
INSERT INTO t144 VALUES ('t3r', traspaso_cuartos(pg_temp.op(30), 'CF-144-C1', 'CF-144-A-TF', 'P144-A', 10));
SELECT pg_temp.como(7);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(32), 'CF-144-C1', 'CF-144-A-TF', 'P144-A', 1)$q$,
  '144-28 al revocar la marca, el mismo usuario ya no puede (aunque conserve la de la tienda externa)', '42501', '%No tienes autorización%', 'TRASPASO_NO_AUTORIZADO');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('t3r') ->> 'replay')::boolean AND pg_temp.inv() = '37|36|4|25|28', '144-29 el reintento de un traspaso ya hecho responde igual (replay) y no mueve nada otra vez');
UPDATE usuario_establecimientos SET traspasa_con_cedis = true WHERE usuario_id = 14407 AND establecimiento_id = pg_temp.eid('tf');

\echo '── 144 E: Producción y Chofer no mueven inventario de una tienda, llamen lo que llamen'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT salida_cuarto_manual(pg_temp.op(40), 'CF-144-B-TX', 'P144-A', 2, 'Consumo interno')$q$,
  '144-30 Producción: salida manual de un congelador de tienda externa', '42501', '%es de una tienda%Producción no puede mover su inventario%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT salida_cuarto_manual(pg_temp.op(41), 'CF-144-A-TF', 'P144-A', 2, 'Consumo interno')$q$,
  '144-31 Producción: salida manual del congelador de la tienda de fábrica (aunque esté asignada a ella)', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT registrar_merma_cuarto(pg_temp.op(42), 'CF-144-B-TX', 'P144-A', 1, 'Bolsa rota', NULL)$q$,
  '144-32 Producción: merma en un congelador de tienda', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(43), 'CF-144-B-TX', 'CF-144-B-TX2', 'P144-A', 1)$q$,
  '144-33 Producción: traspaso DENTRO de una tienda (mismo establecimiento, pero no es el CEDIS)', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.como(7);
SELECT pg_temp.falla($q$SELECT salida_cuarto_manual(pg_temp.op(44), 'CF-144-A-TF', 'P144-A', 2, 'Consumo interno')$q$,
  '144-34 la autorización de traspaso NO es un pase general: Producción autorizada tampoco hace otra operación en la tienda', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
-- Aunque la sesión tuviera la marca puesta (por API no se puede fijar), sirve solo a Producción y solo para ESOS cuartos.
SELECT pg_temp.como(4);
SELECT set_config('app.traspaso_ctx', 'CF-144-A-TF|CF-144-B-TX', true);
SELECT pg_temp.falla($q$SELECT registrar_merma_cuarto(pg_temp.op(45), 'CF-144-A-TF', 'P144-A', 1, 'Bolsa rota', NULL)$q$,
  '144-35 Chofer no opera cuartos (permiso de siempre), con o sin marca', '42501', '%');
SELECT set_config('app.traspaso_ctx', '', true);
-- Escritura directa por API de la existencia: imposible para todos (política y guarda de siempre).
SELECT pg_temp.como(3);
UPDATE cuartos_frios SET stock = '{"P144-A": 999}' WHERE id = 'CF-144-B-TX';
SELECT pg_temp.como(4);
UPDATE cuartos_frios SET stock = '{"P144-A": 999}' WHERE id = 'CF-144-A-TF';
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '37|36|4|25|28' AND (SELECT count(*) = 0 FROM stock_operaciones WHERE operacion_id IN (pg_temp.op(40), pg_temp.op(41), pg_temp.op(42), pg_temp.op(43), pg_temp.op(44), pg_temp.op(45)))
  AND (SELECT count(*) = 0 FROM mermas WHERE sku = 'P144-A'),
  '144-36 seis intentos por RPC y dos escrituras directas: los congeladores de tienda siguen en 37, 36 y 4; sin operaciones ni mermas registradas');
-- Las mismas operaciones sobre el CEDIS siguen funcionando para Producción.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
INSERT INTO t144 VALUES ('s1', salida_cuarto_manual(pg_temp.op(50), 'CF-144-C1', 'P144-A', 2, 'Consumo interno'));
SELECT pg_temp.como(3);
INSERT INTO t144 VALUES ('m1', registrar_merma_cuarto(pg_temp.op(51), 'CF-144-C2', 'P144-A', 1, 'Bolsa rota', NULL));
-- Administración sí opera el congelador de una tienda (sin cambio), y Ventas central sigue vendiendo del CEDIS.
SELECT pg_temp.como(1);
INSERT INTO t144 VALUES ('x1', ajustar_existencia_cuarto(pg_temp.op(52), 'CF-144-B-TX2', 'P144-A', 3, 'Conteo de tienda de prueba 144'));
SELECT pg_temp.como(2);
INSERT INTO t144 VALUES ('v1', completar_venta_directa(pg_temp.op(53), (pg_temp.j('o2') ->> 'id')::bigint, 'contado', 'Efectivo', '[{"sku": "P144-A", "cuarto_id": "CF-144-C1", "cantidad": 10}]'::jsonb, NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '37|36|3|13|27' AND (SELECT count(*) = 1 AND sum(monto) = 300 FROM pagos WHERE orden_id = (pg_temp.j('o2') ->> 'id')::bigint),
  '144-37 sobre el CEDIS todo sigue igual: Producción saca 2 y registra 1 de merma, Ventas vende 10 y cobra $300; Administración ajusta el congelador de una tienda');

\echo '── 144: integridad'
SELECT pg_temp.ok((SELECT count(*) = 0 FROM cuartos_frios c, jsonb_each_text(COALESCE(c.stock, '{}'::jsonb)) s WHERE c.id LIKE 'CF-144-%' AND s.value::int < 0),
  '144-38 ninguna existencia negativa');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM (SELECT operacion_id, cuarto_id, tipo FROM inventario_mov WHERE producto = 'P144-A' AND operacion_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1) d)
  AND (SELECT count(*) = count(DISTINCT operacion_id) FROM stock_operaciones WHERE operacion_id::text LIKE '14400000-%'),
  '144-39 sin movimientos duplicados: cada operación movió cada cuarto una sola vez');
-- Existencia final = existencia inicial + entradas − salidas del kardex, cuarto por cuarto.
SELECT pg_temp.ok((SELECT bool_and(x.final = x.inicial + x.neto) FROM (
    SELECT c.id, COALESCE((c.stock ->> 'P144-A')::int, 0) AS final,
           CASE c.id WHEN 'CF-144-A-TF' THEN 30 WHEN 'CF-144-B-TX' THEN 40 WHEN 'CF-144-B-TX2' THEN 0 WHEN 'CF-144-C1' THEN 100 ELSE 20 END AS inicial,
           COALESCE((SELECT sum(CASE WHEN i.tipo IN ('Entrada', 'Traspaso entrada', 'Devolución cliente', 'Reverso merma') THEN i.cantidad ELSE -i.cantidad END)
                       FROM inventario_mov i WHERE i.producto = 'P144-A' AND i.cuarto_id = c.id), 0) AS neto
      FROM cuartos_frios c WHERE c.id LIKE 'CF-144-%') x),
  '144-40 en cada cuarto, existencia final = inicial + kardex (nada se movió sin registro)');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cuartos_frios' AND policyname <> 'tienda_read') AND (SELECT count(*) = 5 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes' AND policyname <> 'tienda_read')
  AND has_table_privilege('authenticated', 'public.cuartos_frios', 'UPDATE') AND has_table_privilege('authenticated', 'public.ordenes', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.ordenes', 'INSERT'),
  '144-41 policies y permisos de cuartos y órdenes: sin cambio');

ROLLBACK;
\echo '── 144: TODAS LAS PRUEBAS OK'
