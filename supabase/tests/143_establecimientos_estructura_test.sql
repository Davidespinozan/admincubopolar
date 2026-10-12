-- 143_establecimientos_estructura_test.sql — Tiendas propias, E1: la estructura existe,
-- solo hay CEDIS, los cuartos son del CEDIS, las órdenes no cambian, las tablas nuevas
-- no tienen acceso por API y con el interruptor apagado no se puede crear ninguna tienda.
-- Todo dentro de UNA transacción con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14300000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t143' FROM generate_series(1, 9) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14301, 'Admin T143',      'u1@t143', 'Admin',      'Activo', '14300000-0000-0000-0000-000000000001'),
  (14302, 'Ventas T143',     'u2@t143', 'Ventas',     'Activo', '14300000-0000-0000-0000-000000000002'),
  (14303, 'Produccion T143', 'u3@t143', 'Producción', 'Activo', '14300000-0000-0000-0000-000000000003'),
  (14304, 'Chofer T143',     'u4@t143', 'Chofer',     'Activo', '14300000-0000-0000-0000-000000000004'),
  (14305, 'Empleado T143',   'u5@t143', 'Empleado',   'Activo', '14300000-0000-0000-0000-000000000005'),
  (14306, 'Dueno T143',      'u6@t143', 'Admin',      'Activo', '14300000-0000-0000-0000-000000000006');
UPDATE usuarios SET es_dueno = true WHERE id = 14306;
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P143-A', 'Hielo A143', 'Producto Terminado', 30, 0, 0);
-- Un cuarto insertado SIN decir establecimiento (como hacen todas las suites y la pantalla actual).
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-143', 'Cuarto 143', '{"P143-A": 50}'), ('CF-143V', 'Cuarto 143 vacío', '{}');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (14301, 'Cliente T143', 'XAXX010101000', 0, false, 0);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
  (14391, 'OV-14391', 14301, 'Cliente T143', '2×A', 60, 'Creada', 'Efectivo', 'Contado', 14302);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14391, 'P143-A', 2, 30, 60);
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
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"14300000-0000-0000-0000-00000000000' || p_n || '"}', true)::void $$;
-- Lecturas con privilegios del dueño de la prueba (las tablas nuevas no se leen por API).
CREATE OR REPLACE FUNCTION pg_temp.est() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.establecimientos), (SELECT count(*) FROM public.establecimientos WHERE tipo = 'cedis'),
                        (SELECT count(*) FROM public.establecimientos WHERE tipo <> 'cedis'), (SELECT habilitada FROM public.tiendas_activacion),
                        (SELECT count(*) FROM public.usuario_establecimientos)) $$;
CREATE OR REPLACE FUNCTION pg_temp.cuarto(p_id TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$ SELECT establecimiento_id FROM public.cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION pg_temp.orden(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE(establecimiento_id::text, 'null') || '|' || estatus FROM public.ordenes WHERE id = p_id $$;
CREATE TEMP TABLE t143 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t143 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t143 WHERE k = p_k $$;

\echo '── 143: catálogo'
SELECT pg_temp.ok((SELECT count(*) = 3 AND bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.establecimientos'::regclass, 'public.tiendas_activacion'::regclass, 'public.usuario_establecimientos'::regclass))
  AND (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('establecimientos', 'tiendas_activacion', 'usuario_establecimientos')),
  '143-01 las tres tablas nuevas existen con RLS activa y SIN policies');
SELECT pg_temp.ok((SELECT bool_and(NOT has_table_privilege(r, t, p)) FROM unnest(ARRAY['anon', 'authenticated']) r,
                                   unnest(ARRAY['public.establecimientos', 'public.tiendas_activacion', 'public.usuario_establecimientos']) t,
                                   unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p)
  AND NOT has_sequence_privilege('authenticated', 'public.establecimientos_id_seq', 'USAGE') AND NOT has_sequence_privilege('anon', 'public.establecimientos_id_seq', 'USAGE'),
  '143-02 ni anon ni authenticated pueden leer o escribir las tablas nuevas, ni usar su secuencia');
SELECT pg_temp.ok((SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AND count(*) = 5
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                      AND p.proname IN ('tiendas_habilitadas', 'tiendas_activacion_guard', 'establecimientos_guard', 'cuartos_frios_guard_establecimiento', 'ordenes_guard_establecimiento'))
  AND (SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' FROM pg_proc WHERE oid = 'public.tiendas_habilitadas()'::regprocedure),
  '143-03 las cinco funciones nuevas no son ejecutables por API; la única SECURITY DEFINER lleva search_path fijo');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure)) = 'b1be0d0eda13210f828d23572e8d0fb3'
  AND md5(pg_get_functiondef('public.crear_orden(jsonb,jsonb)'::regprocedure)) = 'ef8e49a380d52f870aaccc1bf2ef323c'
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.traspaso_cuartos(uuid,text,text,text,integer)'::regprocedure)) = '8a03866b79eb80cd45cc3862d43a9b03'
  AND md5(pg_get_functiondef('public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure)) = '3591d07446854c4a682cd41f88489ec6'
  AND md5(pg_get_functiondef('public.ajustar_existencia(uuid,text,integer,text)'::regprocedure)) = 'def11d269c049c7301dfa568a96c529f'
  AND md5(pg_get_functiondef('public.update_orden_atomic(bigint,jsonb,jsonb)'::regprocedure)) = '443fcb9caf68aa44f1c3f595103ad63d'
  AND md5(pg_get_functiondef('public.cuartos_frios_guard()'::regprocedure)) = '2974531ebf77425705492a8efde55c73'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = '27277fcf645f05134275473c7892b769'
  AND md5(pg_get_functiondef('public.erp_roles_activos()'::regprocedure)) = '53c2999e3a7e19c781999d73ea052c68'
  AND md5(pg_get_functiondef('public.erp_lector_negocio()'::regprocedure)) = 'd97f617862eda14b2d86100221e9885b'
  AND md5(pg_get_functiondef('public.cerrar_ruta_admin(uuid,bigint,text,jsonb,jsonb,text)'::regprocedure)) = 'd25f37e2123b47e7f31215f8fbf746c7'
  AND md5(pg_get_functiondef('public.registrar_venta_rapida_ruta(uuid,bigint,bigint,text,jsonb,text,boolean,text,timestamptz)'::regprocedure)) = '68c38f4847373536ee80b5ff3a981311',
  '143-04 NO cambian carga de ruta, pedidos, venta de mostrador, traspaso, kardex, ajuste, identidad, lectura general ni T5-D1/D2: md5 = producción');
SELECT pg_temp.ok((SELECT count(*) = 5 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes')
  AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cuartos_frios')
  AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios')
  AND has_table_privilege('authenticated', 'public.cuartos_frios', 'SELECT') AND has_table_privilege('authenticated', 'public.cuartos_frios', 'INSERT')
  AND has_table_privilege('authenticated', 'public.cuartos_frios', 'UPDATE') AND has_table_privilege('authenticated', 'public.ordenes', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.ordenes', 'INSERT') AND NOT has_table_privilege('anon', 'public.cuartos_frios', 'SELECT'),
  '143-05 policies y permisos de órdenes, cuartos fríos y usuarios: los mismos de antes');

\echo '── 143: solo existe el CEDIS; el interruptor está apagado'
SELECT pg_temp.ok(pg_temp.est() = '1|1|0|f|0'
  AND (SELECT id = 1 AND clave = 'CEDIS' AND tipo = 'cedis' AND activo FROM establecimientos)
  AND (SELECT count(*) = 1 AND bool_and(id AND NOT habilitada AND habilitada_at IS NULL AND habilitada_por IS NULL) FROM tiendas_activacion)
  AND NOT tiendas_habilitadas(),
  '143-06 un solo establecimiento (CEDIS, id 1), interruptor apagado y sin usuarios asignados');
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('CEDIS2', 'Otro CEDIS', 'cedis')$q$, '143-07 no puede existir un segundo CEDIS', '23505', '%establecimientos_un_cedis%');
SELECT pg_temp.falla($q$INSERT INTO tiendas_activacion (id, habilitada) VALUES (false, false)$q$, '143-08 el interruptor es una sola fila', '23514', '%');
SELECT pg_temp.falla($q$DELETE FROM tiendas_activacion$q$, '143-09 el interruptor no se elimina', '42501', '%no se elimina%');
SELECT pg_temp.falla($q$UPDATE tiendas_activacion SET habilitada = true$q$, '143-10 encenderlo exige dejar quién y cuándo', '23514', '%');
SELECT pg_temp.falla($q$DELETE FROM establecimientos WHERE tipo = 'cedis'$q$, '143-11 el CEDIS no se elimina', '42501', '%el CEDIS no se elimina%');
SELECT pg_temp.falla($q$UPDATE establecimientos SET tipo = 'tienda' WHERE id = 1$q$, '143-12 el CEDIS no cambia de tipo', '42501', '%no cambia de tipo ni se desactiva%');
SELECT pg_temp.falla($q$UPDATE establecimientos SET activo = false WHERE id = 1$q$, '143-13 el CEDIS no se desactiva', '42501', '%no cambia de tipo ni se desactiva%');
SELECT pg_temp.falla($q$UPDATE establecimientos SET id = 9 WHERE id = 1$q$, '143-14 el identificador del CEDIS no cambia', '42501', '%identificador no cambia%');

\echo '── 143: con el interruptor apagado NADIE crea una tienda (tampoco SQL de confianza)'
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('TFAB', 'Tienda de fábrica', 'tienda_fabrica')$q$,
  '143-15 SQL de confianza: tienda de fábrica rechazada', '22023', '%todavía no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('T01', 'Tienda Centro', 'tienda')$q$,
  '143-16 SQL de confianza: tienda externa rechazada', '22023', '%todavía no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('X1', 'Otro', 'bodega')$q$, '143-17 tipo desconocido: rechazado (por el interruptor o por la restricción de tipo)', '23514|22023', '%');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('T02', 'Tienda Norte', 'tienda')$q$,
  '143-18 sesión del servidor (service_role): rechazada igual', '22023', '%todavía no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT set_config('request.jwt.claims', '', true);
-- Un contrato SECURITY DEFINER (lo que serán los contratos de E4) tampoco pasa con el interruptor apagado.
CREATE OR REPLACE FUNCTION pg_temp.contrato_crea_tienda() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('app.fin_ctx', 'rpc', true); INSERT INTO public.establecimientos (clave, nombre, tipo) VALUES ('T03', 'Tienda Sur', 'tienda'); END $$;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT pg_temp.contrato_crea_tienda()$q$, '143-19 un contrato del servidor llamado por el Dueño, con contexto de contrato: rechazado', '22023', '%todavía no están activadas%', 'TIENDAS_NO_ACTIVADAS');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.est() = '1|1|0|f|0', '143-20 tras todos los intentos: sigue existiendo solo el CEDIS');

\echo '── 143: sin acceso por API (ni Administración ni el Dueño)'
DO $$
DECLARE n INTEGER; t TEXT;
BEGIN
  FOREACH n IN ARRAY ARRAY[1, 2, 3, 4, 5, 6] LOOP
    PERFORM pg_temp.como(n);
    SET LOCAL ROLE authenticated;
    FOREACH t IN ARRAY ARRAY[
      'SELECT count(*) FROM establecimientos', 'SELECT count(*) FROM tiendas_activacion', 'SELECT count(*) FROM usuario_establecimientos',
      $q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('API1', 'Por API', 'tienda')$q$,
      $q$UPDATE establecimientos SET nombre = 'x' WHERE id = 1$q$, 'DELETE FROM establecimientos',
      $q$UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'api'$q$,
      'INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id) VALUES (14302, 1)', 'SELECT tiendas_habilitadas()'] LOOP
      BEGIN
        EXECUTE t;
        RAISE EXCEPTION 'FAIL: el usuario % pudo ejecutar: %', n, t;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'OK: 143-21 Admin, Ventas, Producción, Chofer, Empleado y Dueño: 9 intentos cada uno por API (leer, crear tienda, editar, borrar, encender el interruptor, asignarse): los 54 rechazados con 42501';
END $$;
SELECT pg_temp.ok(pg_temp.est() = '1|1|0|f|0', '143-22 nada cambió: un CEDIS, interruptor apagado, sin asignaciones');

\echo '── 143: cuartos fríos — todos del CEDIS; el establecimiento no se toca por API'
SELECT pg_temp.ok((SELECT count(*) > 0 AND count(*) FILTER (WHERE establecimiento_id <> 1) = 0 FROM cuartos_frios)
  AND pg_temp.cuarto('CF-143') = 1 AND pg_temp.cuarto('CF-143V') = 1
  AND (SELECT is_nullable = 'NO' AND column_default = '1' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cuartos_frios' AND column_name = 'establecimiento_id'),
  '143-23 TODOS los cuartos son del CEDIS; un cuarto insertado sin decir establecimiento nace en el CEDIS (columna obligatoria, por omisión 1)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO cuartos_frios (id, nombre) VALUES ('CF-143N', 'Cuarto nuevo por la pantalla');
UPDATE cuartos_frios SET nombre = 'Cuarto 143 renombrado' WHERE id = 'CF-143';
INSERT INTO t143 VALUES ('n', (SELECT to_jsonb(count(*)) FROM cuartos_frios WHERE id IN ('CF-143', 'CF-143N')));
SELECT pg_temp.falla($q$INSERT INTO cuartos_frios (id, nombre, establecimiento_id) VALUES ('CF-143X', 'Otro', 2)$q$, '143-25 Admin por API no elige el establecimiento de un cuarto nuevo', '42501|23503', '%');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.cuarto('CF-143N') = 1 AND (SELECT nombre = 'Cuarto 143 renombrado' FROM cuartos_frios WHERE id = 'CF-143') AND (pg_temp.j('n') #>> '{}')::int = 2,
  '143-26 la pantalla actual sigue igual: Admin crea un cuarto (nace en el CEDIS), lo renombra y lo lee');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
INSERT INTO t143 VALUES ('p', (SELECT to_jsonb(count(*)) FROM cuartos_frios WHERE id = 'CF-143'));
RESET ROLE;
SELECT pg_temp.ok((pg_temp.j('p') #>> '{}')::int = 1, '143-27 Producción sigue leyendo los cuartos como antes');

\echo '── 143: órdenes — la historia queda sin establecimiento y por API no se escribe'
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE establecimiento_id IS NOT NULL) = 0 AND count(*) > 0 FROM ordenes)
  AND (SELECT is_nullable = 'YES' AND column_default IS NULL FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ordenes' AND column_name = 'establecimiento_id'),
  '143-28 ninguna orden tiene establecimiento; la columna es opcional y sin valor por omisión (nada se rellenó)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$UPDATE ordenes SET establecimiento_id = 1 WHERE id = 14391$q$, '143-29 Admin por API no asigna establecimiento a una orden', '42501', '%no se cambia por API%');
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$UPDATE ordenes SET establecimiento_id = 1 WHERE id = 14391$q$, '143-30 Ventas por API tampoco', '42501', '%no se cambia por API%');
-- Los contratos de siempre siguen funcionando: pedido nuevo y venta de mostrador desde un cuarto.
SELECT pg_temp.como(2);
INSERT INTO t143 VALUES ('o', crear_orden('{"cliente_id": 14301, "metodo_pago": "Efectivo"}'::jsonb, '[{"sku": "P143-A", "cantidad": 3}]'::jsonb));
SELECT pg_temp.como(2);
INSERT INTO t143 VALUES ('v', completar_venta_directa('14300000-0000-0000-0000-000000000a01'::uuid, (pg_temp.j('o') ->> 'id')::bigint, 'contado', 'Efectivo',
  '[{"sku": "P143-A", "cuarto_id": "CF-143", "cantidad": 3}]'::jsonb, NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.orden(14391) = 'null|Creada' AND pg_temp.orden((pg_temp.j('o') ->> 'id')::bigint) = 'null|Entregada'
  AND (SELECT (stock ->> 'P143-A')::int = 47 FROM cuartos_frios WHERE id = 'CF-143')
  AND (SELECT count(*) = 1 AND sum(monto) = 90 FROM pagos WHERE orden_id = (pg_temp.j('o') ->> 'id')::bigint),
  '143-31 crear_orden y completar_venta_directa funcionan igual: venta de $90 cobrada, 3 piezas salieron del cuarto y la orden queda sin establecimiento (central)');

\echo '── 143: el cambio de establecimiento de un cuarto, fuera de la API, solo con el cuarto vacío'
-- Para probar la regla hay que tener una tienda: se enciende el interruptor DENTRO de esta transacción (se deshace al final).
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 143';
INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('TFAB', 'Tienda de fábrica', 'tienda_fabrica');
INSERT INTO t143 VALUES ('tf', (SELECT to_jsonb(id) FROM establecimientos WHERE clave = 'TFAB'));
CREATE OR REPLACE FUNCTION pg_temp.tf() RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v #>> '{}')::bigint FROM t143 WHERE k = 'tf' $$;
SELECT pg_temp.ok(tiendas_habilitadas() AND pg_temp.est() = '2|1|1|t|0' AND pg_temp.tf() > 1,
  '143-32 con el interruptor ENCENDIDO (solo en esta prueba) sí se crea una tienda, con un id distinto del CEDIS');
SELECT pg_temp.falla(format($q$UPDATE cuartos_frios SET establecimiento_id = %s WHERE id = 'CF-143'$q$, pg_temp.tf()),
  '143-33 un cuarto CON existencia no cambia de establecimiento (movería inventario sin registro)', '22023', '%tiene existencia; vacíalo antes%');
UPDATE cuartos_frios SET establecimiento_id = pg_temp.tf() WHERE id = 'CF-143V';
SELECT pg_temp.ok(pg_temp.cuarto('CF-143V') = pg_temp.tf() AND pg_temp.cuarto('CF-143') = 1, '143-34 un cuarto VACÍO sí puede asignarse a la tienda (por SQL o contrato, no por API)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$UPDATE cuartos_frios SET establecimiento_id = 1 WHERE id = 'CF-143V'$q$, '143-35 aun con tiendas encendidas, Admin por API no cambia el establecimiento de un cuarto', '42501', '%no se cambia por API%');
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('API2', 'Por API', 'tienda')$q$, '143-36 aun con tiendas encendidas, Admin por API no crea establecimientos', '42501', '%');
RESET ROLE;
SELECT pg_temp.falla(format($q$DELETE FROM establecimientos WHERE id = %s$q$, pg_temp.tf()), '143-37 un establecimiento con cuartos no se elimina', '23503', '%');
INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, asignado_por) VALUES (14302, pg_temp.tf(), 'prueba 143');
SELECT pg_temp.falla(format($q$INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id) VALUES (14302, %s)$q$, pg_temp.tf()), '143-38 una asignación no se repite', '23505', '%');
SELECT pg_temp.falla($q$INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id) VALUES (14302, 999)$q$, '143-39 no se asigna a un establecimiento inexistente', '23503', '%');
-- La asignación existe pero todavía no cambia ningún permiso: Ventas sigue leyendo y vendiendo como antes.
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
INSERT INTO t143 VALUES ('r', jsonb_build_object('roles', to_jsonb(erp_roles_activos()), 'lector', erp_lector_negocio(), 'ordenes', (SELECT count(*) FROM ordenes WHERE id = 14391),
                                                   'clientes', (SELECT count(*) FROM clientes WHERE id = 14301), 'cuartos', (SELECT count(*) FROM cuartos_frios WHERE id IN ('CF-143', 'CF-143V'))));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.j('r') -> 'roles' = '["Ventas"]'::jsonb AND (pg_temp.j('r') ->> 'lector')::boolean AND (pg_temp.j('r') ->> 'ordenes')::int = 1
  AND (pg_temp.j('r') ->> 'clientes')::int = 1 AND (pg_temp.j('r') ->> 'cuartos')::int = 2,
  '143-40 un usuario asignado a una tienda conserva EXACTAMENTE sus permisos de hoy (E1 no cambia permisos efectivos)');
UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
SELECT pg_temp.falla(format($q$UPDATE establecimientos SET nombre = 'Otro nombre' WHERE id = %s$q$, pg_temp.tf()), '143-41 al apagar el interruptor, una tienda existente ya no se modifica', '22023', '%todavía no están activadas%', 'TIENDAS_NO_ACTIVADAS');

ROLLBACK;
\echo '── 143: TODAS LAS PRUEBAS OK'
