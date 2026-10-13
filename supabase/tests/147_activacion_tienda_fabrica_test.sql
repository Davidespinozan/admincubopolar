-- 147_activacion_tienda_fabrica_test.sql — Tiendas propias, E6: configuración administrativa,
-- activación controlada y VALIDACIÓN INTEGRADA de la primera tienda de fábrica, de punta a punta:
-- el dueño enciende el interruptor (SQL) → Administración configura la tienda con contratos →
-- la activa → Producción la surte por traspaso → el cajero abre turno, vende de su congelador y
-- del CEDIS, cobra, reintenta, cierra → Administración corrige y confirma el reembolso.
-- Escenario aislado y solo local: todo ocurre dentro de la transacción y se deshace con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t147.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
CREATE TEMP TABLE t147 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t147 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t147 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.n(p_k TEXT, p_campo TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT CASE WHEN p_campo IS NULL THEN (v #>> '{}')::bigint ELSE (v ->> p_campo)::bigint END FROM t147 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14700000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t147' FROM generate_series(1, 12) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, accesos_extra) VALUES
  (14701, 'Admin T147',            'u1@t147',  'Admin',          'Activo',   '14700000-0000-0000-0000-000000000001', '{}'),
  (14702, 'Ventas central T147',   'u2@t147',  'Ventas',         'Activo',   '14700000-0000-0000-0000-000000000002', '{}'),
  (14703, 'Produccion T147',       'u3@t147',  'Producción',     'Activo',   '14700000-0000-0000-0000-000000000003', '{}'),
  (14704, 'Chofer T147',           'u4@t147',  'Chofer',         'Activo',   '14700000-0000-0000-0000-000000000004', '{}'),
  (14705, 'Empleado T147',         'u5@t147',  'Empleado',       'Activo',   '14700000-0000-0000-0000-000000000005', '{}'),
  (14706, 'Cajera con CEDIS T147', 'u6@t147',  'Ventas',         'Activo',   '14700000-0000-0000-0000-000000000006', '{}'),
  (14707, 'Cajero sin CEDIS T147', 'u7@t147',  'Ventas',         'Activo',   '14700000-0000-0000-0000-000000000007', '{}'),
  (14708, 'Vendedor ocupado T147', 'u8@t147',  'Ventas',         'Activo',   '14700000-0000-0000-0000-000000000008', '{}'),
  (14709, 'Bolsas T147',           'u9@t147',  'Almacén Bolsas', 'Activo',   '14700000-0000-0000-0000-000000000009', '{Ventas}'),
  (14710, 'Baja T147',             'u10@t147', 'Ventas',         'Inactivo', '14700000-0000-0000-0000-000000000010', '{}'),
  (14711, 'Admin dos T147',        'u11@t147', 'Admin',          'Activo',   '14700000-0000-0000-0000-000000000011', '{}'),
  (14712, 'Cajera otra tienda T147','u12@t147','Ventas',         'Activo',   '14700000-0000-0000-0000-000000000012', '{}');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P147-A', 'Hielo A147', 'Producto Terminado', 30, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-147-C1', 'Cuarto CEDIS 147', '{"P147-A": 100}'), ('CF-147-VACIO', 'Cuarto CEDIS vacío 147', '{"P147-A": 0}');
INSERT INTO clientes (id, nombre, rfc, regimen, uso_cfdi, cp, saldo, credito_autorizado, limite_credito, estatus) VALUES
  (14701, 'Cliente elegible 147', 'CLI010203AB1',  '601', 'G03', '34000', 0, true,  9999, 'Activo'),
  (14702, 'Cliente ajeno 147',    'XAXX010101000', '616', 'S01', '34000', 0, false, 0,    'Activo'),
  (14703, 'Cliente inactivo 147', 'XAXX010101000', '616', 'S01', '34000', 0, false, 0,    'Inactivo');
INSERT INTO sucursales (id, cliente_id, nombre, es_principal, estatus) VALUES (1470101, 14701, 'Principal', true, 'Activa'), (1470201, 14702, 'Principal', true, 'Activa');
INSERT INTO precios_esp (cliente_id, sku, precio, sucursal_id) VALUES (14701, 'P147-A', 25, NULL);
-- Una venta central sin terminar del vendedor 8 (para la verificación de incompatibilidades).
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, fecha) VALUES
  (14791, 'OV-14791', 14702, 'Cliente ajeno 147', '1×P147-A', 30, 'Creada', 'Efectivo', 'Contado', 14708, CURRENT_DATE);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14791, 'P147-A', 1, 30, 30);
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
  SELECT set_config('app.fin_ctx', '', true), set_config('app.traspaso_ctx', '', true),
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"14700000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14700000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.q(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
-- Existencia de P147-A: CEDIS|congelador de la tienda|cuarto que pasó a la tienda
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(COALESCE(stock ->> 'P147-A', '0'), '|' ORDER BY id) FROM public.cuartos_frios WHERE id IN ('CF-147-C1', 'CF-147-TF', 'CF-147-VACIO') $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(p_est BIGINT, p_clave TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT (k.value -> 'ok')::boolean FROM jsonb_array_elements(estado_tienda(p_est) -> 'verificacion') k WHERE k.value ->> 'clave' = p_clave $$;
CREATE OR REPLACE FUNCTION pg_temp.faltan(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v = PG_EXCEPTION_DETAIL;
  RETURN (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(v::jsonb -> 'faltan') x); END $$;

\echo '── 147: catálogo'
SELECT pg_temp.ok(current_setting('t147.apagado_al_inicio')::boolean, '147-01 el interruptor global estaba APAGADO al empezar: 147 no lo toca ni agrega un contrato que lo encienda');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname NOT LIKE 't%guard'
                     AND pg_get_functiondef(p.oid) ~* 'UPDATE\s+(public\.)?tiendas_activacion'),
  '147-02 ninguna función de la base enciende o apaga el interruptor global (sigue siendo SQL del dueño)');
SELECT pg_temp.ok((SELECT count(*) = 8 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guardar_establecimiento', 'asignar_cuarto_tienda', 'agregar_caja_tienda',
                       'asignar_usuario_tienda', 'retirar_usuario_tienda', 'configurar_clientes_tienda', 'estado_tienda', 'activar_tienda')),
  '147-03 los 8 contratos administrativos: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');
SELECT pg_temp.ok((SELECT count(*) = 4 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('tienda_exigir_admin', 'tienda_cargar', 'tienda_checklist', 'establecimiento_eventos_guard')),
  '147-04 las funciones internas no se exponen por API');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
                    AND table_name IN ('establecimientos', 'usuario_establecimientos', 'establecimiento_clientes', 'tiendas_activacion'))
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.establecimiento_eventos'::regclass)
  AND has_table_privilege('authenticated', 'public.establecimiento_eventos', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.establecimiento_eventos', 'INSERT'),
  '147-05 la configuración de tiendas sigue sin acceso por REST (ni lectura); la historia de activaciones es solo lectura de Admin');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.guardar_caja(bigint,bigint,text,boolean)'::regprocedure)) IS NOT NULL
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = 'e1a9770e1bc5cebd7f565c9cfdc2a880'
  AND md5(pg_get_functiondef('public.erp_es_activo()'::regprocedure)) = '9b87432b5056856944453a60c4e97ff2'
  AND md5(pg_get_functiondef('public.establecimientos_guard()'::regprocedure)) IS NOT NULL
  AND (SELECT column_default = 'true' FROM information_schema.columns WHERE table_name = 'establecimientos' AND column_name = 'activo'),
  '147-06 no cambia ningún contrato anterior (venta directa, identidad) ni la estructura de establecimientos');

\echo '── 147: con el interruptor global apagado nada se configura'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TF147', 'Tienda de fábrica 147')$q$, '147-10 Admin no puede crear una tienda con el interruptor apagado', '22023', '%no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla($q$SELECT activar_tienda(pg_temp.op(1), 1, true)$q$, '147-11 …ni activar nada', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.ok(estado_tienda() = '{"tiendas": [], "tiendas_habilitadas": false}'::jsonb, '147-12 estado_tienda sí responde: tiendas apagadas y ninguna tienda');
SELECT pg_temp.falla($q$UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'yo'$q$, '147-13 Admin no enciende el interruptor por REST', '42501');
RESET ROLE;
-- El dueño lo enciende con SQL (única vía, como quedó cerrado en E1).
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 147 (dueño, SQL)';

\echo '── 147: alta de la tienda de fábrica (nace inactiva)'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(2); SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TF147', 'Tienda de fábrica 147')$q$, '147-20 Ventas central no crea tiendas', '42501');
SELECT pg_temp.como(3); SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TF147', 'Tienda de fábrica 147')$q$, '147-21 Producción tampoco', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'x', 'Tienda')$q$, '147-22 clave inválida', '22023', '%', 'CLAVE_INVALIDA');
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TF147', ' ')$q$, '147-23 sin nombre', '22023', '%', 'NOMBRE_INVALIDO');
INSERT INTO t147 VALUES ('tf', guardar_establecimiento(NULL, ' tf147 ', '  Tienda   de fábrica 147 '));
SELECT pg_temp.ok(pg_temp.j('tf') - 'id' = '{"clave": "TF147", "nombre": "Tienda de fábrica 147", "tipo": "tienda_fabrica", "activo": false, "clientes_pos": "lista"}'::jsonb,
  '147-24 la tienda nace como tienda de fábrica, INACTIVA y con clientes en modo lista (vacía)');
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TF147', 'Otra')$q$, '147-25 la clave no se repite', '22023', '%', 'CLAVE_REPETIDA');
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(1, NULL, 'CEDIS renombrado')$q$, '147-26 el CEDIS no se configura como tienda', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT guardar_establecimiento(%s, 'OTRA', 'Tienda de fábrica 147')$q$, pg_temp.n('tf', 'id')), '147-27 la clave de una tienda no cambia', '22023', '%', 'CLAVE_INVALIDA');
SELECT pg_temp.ok(guardar_establecimiento(pg_temp.n('tf', 'id'), NULL, 'Tienda Fábrica Durango 147') ->> 'nombre' = 'Tienda Fábrica Durango 147', '147-28 se puede cambiar el nombre');
SELECT pg_temp.falla($q$INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('REST147', 'Por REST', 'tienda_fabrica')$q$, '147-29 ni Admin crea establecimientos por REST', '42501');
SELECT pg_temp.falla($q$UPDATE establecimientos SET activo = true$q$, '147-30 ni los activa por REST', '42501');
INSERT INTO t147 VALUES ('e0', estado_tienda(pg_temp.n('tf', 'id')));
SELECT pg_temp.ok(NOT (pg_temp.j('e0') -> 'lista_para_activar')::boolean
  AND (SELECT string_agg(k.value ->> 'clave', ',' ORDER BY k.value ->> 'clave') FROM jsonb_array_elements(pg_temp.j('e0') -> 'verificacion') k
        WHERE (k.value -> 'obligatorio')::boolean AND NOT (k.value -> 'ok')::boolean) = 'caja,cuarto,personal',
  '147-31 lista de verificación recién creada: faltan congelador, caja y personal');
SELECT pg_temp.ok(pg_temp.faltan(format($q$SELECT activar_tienda(pg_temp.op(2), %s, true)$q$, pg_temp.n('tf', 'id'))) = 'caja,cuarto,personal',
  '147-32 activar una tienda incompleta se rechaza y dice exactamente qué falta');

\echo '── 147: congelador, cajas, personal y clientes'
SELECT pg_temp.falla(format($q$SELECT asignar_cuarto_tienda(%s, 'CF-147-TF')$q$, pg_temp.n('tf', 'id')), '147-40 un congelador nuevo necesita nombre', '22023', '%', 'NOMBRE_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT asignar_cuarto_tienda(%s, 'x y', 'Malo')$q$, pg_temp.n('tf', 'id')), '147-41 clave de congelador inválida', '22023', '%', 'CUARTO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT asignar_cuarto_tienda(%s, 'CF-147-C1')$q$, pg_temp.n('tf', 'id')),
  '147-42 un cuarto del CEDIS CON producto no se le pasa a la tienda (el inventario no cambia de dueño sin registro)', '22023', '%solo se asigna un cuarto vacío%', 'CUARTO_CON_EXISTENCIA');
SELECT pg_temp.falla($q$SELECT asignar_cuarto_tienda(1, 'CF-147-VACIO')$q$, '147-43 no se "asignan" cuartos al CEDIS por aquí', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
INSERT INTO t147 VALUES ('c1', asignar_cuarto_tienda(pg_temp.n('tf', 'id'), 'CF-147-TF', 'Congelador tienda de fábrica')),
                        ('c2', asignar_cuarto_tienda(pg_temp.n('tf', 'id'), 'CF-147-VACIO'));
SELECT pg_temp.ok((pg_temp.j('c1') -> 'nuevo')::boolean AND NOT (pg_temp.j('c2') -> 'nuevo')::boolean
  AND pg_temp.q($q$SELECT string_agg(id || ':' || establecimiento_id, ',' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-147-%'$q$)
      = 'CF-147-C1:1,CF-147-TF:' || pg_temp.n('tf', 'id') || ',CF-147-VACIO:' || pg_temp.n('tf', 'id') AND pg_temp.inv() = '100|0|0',
  '147-44 la tienda recibe un congelador nuevo y un cuarto VACÍO del CEDIS; el inventario del CEDIS no se movió');
SELECT pg_temp.falla(format($q$SELECT guardar_caja(NULL, %s, 'Caja 1')$q$, pg_temp.n('tf', 'id')), '147-45 guardar_caja (146) no acepta una tienda inactiva: por eso existe agregar_caja_tienda', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
INSERT INTO t147 VALUES ('k1', agregar_caja_tienda(pg_temp.n('tf', 'id'), ' Caja  1 ')), ('k2', agregar_caja_tienda(pg_temp.n('tf', 'id'), 'Caja 2'));
SELECT pg_temp.falla(format($q$SELECT agregar_caja_tienda(%s, 'caja 1')$q$, pg_temp.n('tf', 'id')), '147-46 no hay dos cajas con el mismo nombre', '22023', '%', 'CAJA_REPETIDA');
SELECT pg_temp.falla($q$SELECT agregar_caja_tienda(1, 'Caja CEDIS')$q$, '147-47 el CEDIS no tiene cajas', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
-- Personal: los dos permisos, separados y siempre explícitos.
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14706, NULL, false)$q$, pg_temp.n('tf', 'id')), '147-50 sin decir sí o no en CADA permiso: rechazado (no hay valores por omisión)', '22023', '%sí o no%', 'PERMISOS_EXPLICITOS');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14706, true, NULL)$q$, pg_temp.n('tf', 'id')), '147-51 …los dos', '22023', '%', 'PERMISOS_EXPLICITOS');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14704, false, false)$q$, pg_temp.n('tf', 'id')), '147-52 un Chofer no se asigna a una tienda', '22023', '%', 'ROL_NO_ASIGNABLE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14709, false, false)$q$, pg_temp.n('tf', 'id')), '147-53 Almacén Bolsas (aunque tenga acceso de Ventas) tampoco', '22023', '%', 'ROL_NO_ASIGNABLE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14705, false, false)$q$, pg_temp.n('tf', 'id')), '147-54 un Empleado tampoco', '22023', '%', 'ROL_NO_ASIGNABLE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14710, false, false)$q$, pg_temp.n('tf', 'id')), '147-55 un usuario dado de baja no se asigna', '22023', '%', 'USUARIO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 99999999, false, false)$q$, pg_temp.n('tf', 'id')), '147-56 un usuario inexistente: misma respuesta', '22023', '%', 'USUARIO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14703, true, false)$q$, pg_temp.n('tf', 'id')), '147-57 vender desde el CEDIS no es un permiso de Producción', '22023', '%', 'PERMISO_NO_CORRESPONDE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14701, true, false)$q$, pg_temp.n('tf', 'id')), '147-58 …ni de Administración', '22023', '%', 'PERMISO_NO_CORRESPONDE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14706, false, true)$q$, pg_temp.n('tf', 'id')), '147-59 traspasar con el CEDIS no es un permiso del cajero', '22023', '%', 'PERMISO_NO_CORRESPONDE');
INSERT INTO t147 VALUES ('a6', asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14706, true, false)), ('a7', asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14707, false, false)),
                        ('a3', asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14703, false, true)), ('a8', asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14708, false, false));
SELECT pg_temp.ok((pg_temp.j('a6') -> 'pasa_a_ventas_tienda')::boolean AND (pg_temp.j('a6') -> 'vende_desde_cedis')::boolean AND NOT (pg_temp.j('a6') -> 'traspasa_con_cedis')::boolean
  AND NOT (pg_temp.j('a3') -> 'pasa_a_ventas_tienda')::boolean AND (pg_temp.j('a3') -> 'traspasa_con_cedis')::boolean AND NOT (pg_temp.j('a3') -> 'vende_desde_cedis')::boolean
  AND pg_temp.q(format($q$SELECT string_agg(usuario_id || ':' || vende_desde_cedis || ':' || traspasa_con_cedis, ',' ORDER BY usuario_id) FROM usuario_establecimientos WHERE establecimiento_id = %s$q$, pg_temp.n('tf', 'id')))
      = '14703:false:true,14706:true:false,14707:false:false,14708:false:false',
  '147-60 cada persona con SUS permisos: la cajera 6 vende desde el CEDIS; el cajero 7 no; Producción traspasa y no vende; los dos permisos nunca van juntos');
SELECT pg_temp.ok((asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14707, false, false) -> 'nueva') = 'false'::jsonb
  AND pg_temp.q(format($q$SELECT count(*) FROM usuario_establecimientos WHERE establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = '4', '147-61 repetir una asignación no la duplica');
SELECT pg_temp.falla(format($q$INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis) VALUES (14707, %s, true)$q$, pg_temp.n('tf', 'id')), '147-62 ni Admin asigna personas por REST', '42501');
-- Clientes elegibles
SELECT pg_temp.falla(format($q$SELECT configurar_clientes_tienda(%s, 'algunos')$q$, pg_temp.n('tf', 'id')), '147-63 modo de clientes inválido', '22023', '%', 'MODO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT configurar_clientes_tienda(%s, NULL, ARRAY[14701, 14703])$q$, pg_temp.n('tf', 'id')), '147-64 un cliente inactivo no se hace elegible (y no se agrega ninguno de esa tanda)', '22023', '%', 'CLIENTE_NO_VALIDO');
INSERT INTO t147 VALUES ('cl', configurar_clientes_tienda(pg_temp.n('tf', 'id'), 'lista', ARRAY[14701, 14701]));
SELECT pg_temp.ok(pg_temp.j('cl') - 'establecimiento_id' = '{"clientes_pos": "lista", "agregados": 1, "quitados": 0, "clientes": 1}'::jsonb, '147-65 un cliente elegible en la lista de la tienda');
SELECT pg_temp.falla(format($q$INSERT INTO establecimiento_clientes (establecimiento_id, cliente_id) VALUES (%s, 14702)$q$, pg_temp.n('tf', 'id')), '147-66 ni Admin toca la lista por REST', '42501');

\echo '── 147: una tienda configurada pero INACTIVA no opera'
SELECT pg_temp.como(6);
SELECT pg_temp.ok((SELECT rol FROM erp_actor()) = 'Ventas Tienda' AND mis_establecimientos() -> 'establecimientos' = '[]'::jsonb AND NOT erp_lector_negocio()
  AND (SELECT count(*) FROM cuartos_frios) = 0,
  '147-70 la cajera ya es «Ventas Tienda» (perdió lo central al asignarla) pero, con la tienda inactiva, todavía no ve ni su tienda ni su congelador');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(10), %s, 100)$q$, pg_temp.n('k1', 'id')), '147-71 …ni abre turno', '42501');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s)$q$, pg_temp.n('tf', 'id')), '147-72 …ni consulta precios', '42501');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(11), 'CF-147-C1', 'CF-147-TF', 'P147-A', 10)$q$, '147-73 Producción (con permiso) tampoco surte una tienda inactiva', '42501|22023');

\echo '── 147: activación'
SELECT pg_temp.como(1);
SELECT pg_temp.ok(pg_temp.faltan(format($q$SELECT activar_tienda(pg_temp.op(2), %s, true)$q$, pg_temp.n('tf', 'id'))) = 'ventas_centrales' AND NOT pg_temp.chk(pg_temp.n('tf', 'id'), 'ventas_centrales'),
  '147-80 configuración incompatible: un cajero asignado tiene una venta central sin terminar (dejaría de poder atenderla) → no se activa');
-- Se retira a ese vendedor. Como se quedaría de Ventas central, hay que confirmarlo.
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 14708)$q$, pg_temp.n('tf', 'id')),
  '147-81 retirar al único cajero-asignado lo devolvería a Ventas central: exige confirmarlo', '22023', '%volvería a ser Ventas central%', 'QUEDARIA_VENTAS_CENTRAL');
SELECT pg_temp.ok((retirar_usuario_tienda(pg_temp.n('tf', 'id'), 14708, true) -> 'queda_ventas_central')::boolean
  AND (retirar_usuario_tienda(pg_temp.n('tf', 'id'), 14708, true) -> 'sin_cambio')::boolean, '147-82 con confirmación se retira (queda en auditoría); repetirlo no hace nada');
SELECT pg_temp.como(8);
SELECT pg_temp.ok((SELECT rol FROM erp_actor()) = 'Ventas' AND erp_lector_negocio(), '147-83 ese vendedor vuelve a ser Ventas central');
SELECT pg_temp.como(6); SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(2), %s, true)$q$, pg_temp.n('tf', 'id')), '147-84 la cajera no activa su tienda', '42501');
SELECT pg_temp.como(2); SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(2), %s, true)$q$, pg_temp.n('tf', 'id')), '147-85 Ventas central tampoco', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((estado_tienda(pg_temp.n('tf', 'id')) -> 'lista_para_activar')::boolean AND pg_temp.chk(pg_temp.n('tf', 'id'), 'seguridad') AND pg_temp.chk(pg_temp.n('tf', 'id'), 'permisos')
  AND (estado_tienda() -> 'tiendas' -> 0 -> 'lista_para_activar')::boolean AND NOT (estado_tienda() -> 'tiendas' -> 0 -> 'activo')::boolean,
  '147-86 lista de verificación completa (congelador, caja, personal, permisos, sin incompatibles, seguridad instalada): lista para activar, todavía inactiva');
SELECT pg_temp.falla(format($q$SELECT activar_tienda(NULL, %s, true)$q$, pg_temp.n('tf', 'id')), '147-87 activar exige operacion_id', '22023');
INSERT INTO t147 VALUES ('act', activar_tienda(pg_temp.op(2), pg_temp.n('tf', 'id'), true, 'Apertura de la tienda de fábrica'));
SELECT pg_temp.ok((pg_temp.j('act') -> 'activo')::boolean AND NOT (pg_temp.j('act') -> 'sin_cambio')::boolean AND jsonb_array_length(pg_temp.j('act') -> 'verificacion') = 10
  AND pg_temp.q(format($q$SELECT concat_ws('|', activo, tipo) FROM establecimientos WHERE id = %s$q$, pg_temp.n('tf', 'id'))) = 't|tienda_fabrica'
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), string_agg(tipo, ',' ORDER BY id), bool_and(actor_id = 14701)) FROM establecimiento_eventos WHERE establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = '2|alta,activacion|t'
  AND pg_temp.q($q$SELECT count(*) FROM auditoria WHERE accion = 'Activación de tienda' AND detalle LIKE 'TF147%'$q$) = '1',
  '147-88 Admin ACTIVA la tienda: explícito y auditable (evento con la lista de verificación de ese momento, quién y por qué)');
SELECT pg_temp.ok((activar_tienda(pg_temp.op(2), pg_temp.n('tf', 'id'), true, 'Apertura de la tienda de fábrica') -> 'replay')::boolean
  AND (activar_tienda(pg_temp.op(3), pg_temp.n('tf', 'id'), true) -> 'sin_cambio')::boolean
  AND pg_temp.q(format($q$SELECT count(*) FROM establecimiento_eventos WHERE establecimiento_id = %s AND tipo = 'activacion'$q$, pg_temp.n('tf', 'id'))) = '1',
  '147-89 idempotente: el reintento devuelve la misma activación y activar algo ya activo no hace nada; una sola activación registrada');
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(2), %s, false, 'otra cosa distinta')$q$, pg_temp.n('tf', 'id')), '147-90 el mismo operacion_id con otra acción: rechazado', '23505', '%', 'OPERACION_REPETIDA');
SELECT pg_temp.ok(pg_temp.q('SELECT habilitada::text FROM tiendas_activacion') = 'true' AND pg_temp.q($q$SELECT count(*) FROM establecimientos WHERE tipo <> 'cedis' AND activo$q$) = '1',
  '147-91 activar UNA tienda no toca el interruptor global ni activa otras');

\echo '── 147: VALIDACIÓN INTEGRADA — 1 y 2. sesión del vendedor de tienda y su establecimiento'
SELECT pg_temp.como(6);
INSERT INTO t147 VALUES ('m6', mis_establecimientos());
SELECT pg_temp.ok((SELECT rol FROM erp_actor()) = 'Ventas Tienda' AND erp_roles_activos() = ARRAY['Ventas Tienda'] AND pg_temp.j('m6') ->> 'perfil' = 'Ventas Tienda'
  AND jsonb_array_length(pg_temp.j('m6') -> 'establecimientos') = 1 AND pg_temp.j('m6') -> 'establecimientos' -> 0 ->> 'clave' = 'TF147'
  AND (pg_temp.j('m6') -> 'establecimientos' -> 0 -> 'vende_desde_cedis')::boolean AND NOT (pg_temp.j('m6') -> 'establecimientos' -> 0 -> 'traspasa_con_cedis')::boolean,
  '147-100 [1-2] la cajera entra como «Ventas Tienda» y su único establecimiento es la tienda de fábrica, con permiso de vender desde el CEDIS (y sin el de traspasar)');
SELECT pg_temp.como(7);
SELECT pg_temp.ok(NOT (mis_establecimientos() -> 'establecimientos' -> 0 -> 'vende_desde_cedis')::boolean, '147-101 [2] el cajero 7 trabaja en la misma tienda SIN ese permiso');

\echo '── 147: surtido por traspaso (los permisos no son implícitos)'
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(20), 'CF-147-C1', 'CF-147-TF', 'P147-A', 10)$q$,
  '147-105 Administración NO tiene permiso implícito de traspasar con el CEDIS (no está asignada con ese permiso)', '42501|22023', '%', 'TRASPASO_NO_AUTORIZADO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(21), 1, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-C1"}]'::jsonb, 'Efectivo')$q$),
  '147-106 …ni puede operar una venta de tienda por ser Admin', '42501');
SELECT pg_temp.como(3);
INSERT INTO t147 VALUES ('tr', traspaso_cuartos(pg_temp.op(22), 'CF-147-C1', 'CF-147-TF', 'P147-A', 10));
SELECT pg_temp.ok(pg_temp.inv() = '90|10|0', '147-107 Producción, con SU permiso explícito, surte la tienda desde el CEDIS (10 piezas, con kardex)');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(23), 1, '[{"sku": "P147-A", "cantidad": 1}]'::jsonb, 'Efectivo')$q$), '147-108 traspasar no da derecho a vender', '42501');

\echo '── 147: VALIDACIÓN INTEGRADA — 3 y 4. apertura de turno, precios y existencias'
SELECT pg_temp.como(6);
INSERT INTO t147 VALUES ('t6', abrir_turno_caja(pg_temp.op(30), pg_temp.n('k1', 'id'), 200));
SELECT pg_temp.ok(pg_temp.j('t6') ->> 'estado' = 'abierto' AND pg_temp.n('t6', 'establecimiento_id') = pg_temp.n('tf', 'id') AND (mi_turno_caja() -> 'turno' ->> 'turno_id')::bigint = pg_temp.n('t6', 'turno_id'),
  '147-110 [3] la cajera abre su turno en la caja 1 con fondo de 200');
SELECT pg_temp.ok(precios_pos(pg_temp.n('tf', 'id'), NULL, ARRAY['P147-A']) -> 'precios' = '[{"sku": "P147-A", "nombre": "Hielo A147", "precio": 30.00}]'::jsonb
  AND precios_pos(pg_temp.n('tf', 'id'), 14701, ARRAY['P147-A']) -> 'precios' -> 0 -> 'precio' = '25.00'::jsonb
  AND buscar_clientes_pos(pg_temp.n('tf', 'id'), 'cliente') -> 'clientes' = '[{"id": 14701, "nombre": "Cliente elegible 147", "nombre_comercial": null, "puede_facturar": true}]'::jsonb,
  '147-111 [4] precios del servidor (30 al público, 25 al cliente elegible) y buscador con SOLO el cliente elegible y sus datos mínimos');
SELECT pg_temp.ok((SELECT string_agg(id || '=' || COALESCE(stock ->> 'P147-A', '0'), ',' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-147-%') = 'CF-147-C1=90,CF-147-TF=10,CF-147-VACIO=0',
  '147-112 [4] existencias: ve sus congeladores y, por su permiso, los cuartos del CEDIS');
SELECT pg_temp.como(7);
INSERT INTO t147 VALUES ('t7', abrir_turno_caja(pg_temp.op(31), pg_temp.n('k2', 'id'), 0));
SELECT pg_temp.ok((SELECT string_agg(id, ',' ORDER BY id) FROM cuartos_frios) = 'CF-147-TF,CF-147-VACIO', '147-113 [4] el cajero sin permiso NO ve la existencia del CEDIS');

\echo '── 147: VALIDACIÓN INTEGRADA — 5 a 10. ventas, cobro, reintento y comprobante'
SELECT pg_temp.como(6);
INSERT INTO t147 VALUES ('v1', vender_en_tienda(pg_temp.op(40), pg_temp.n('t6', 'turno_id'), '[{"sku": "P147-A", "cantidad": 2, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1') ->> 'total')::numeric = 60 AND NOT (pg_temp.j('v1') -> 'desde_cedis')::boolean AND pg_temp.inv() = '90|8|0',
  '147-120 [5] venta desde el inventario PROPIO de la tienda (2 piezas, $60)');
INSERT INTO t147 VALUES ('v2', vender_en_tienda(pg_temp.op(41), pg_temp.n('t6', 'turno_id'), '[{"sku": "P147-A", "cantidad": 3, "cuarto_id": "CF-147-C1"}]'::jsonb, 'Tarjeta (terminal)', 14701, 'AUT 5567', true));
SELECT pg_temp.ok((pg_temp.j('v2') ->> 'total')::numeric = 75 AND (pg_temp.j('v2') -> 'desde_cedis')::boolean AND pg_temp.inv() = '87|8|0'
  AND pg_temp.q(format($q$SELECT concat_ws('|', establecimiento_id, turno_id, cliente_id, requiere_factura) FROM ordenes WHERE id = %s$q$, pg_temp.n('v2', 'orden_id')))
      = concat_ws('|', pg_temp.n('tf', 'id'), pg_temp.n('t6', 'turno_id'), 14701, 't'),
  '147-121 [6] venta desde el CEDIS CON autorización: 3 piezas al cliente elegible a su precio (3×25 = $75), tarjeta, con factura; la venta es de la tienda');
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(42), %s, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-C1"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t7', 'turno_id')),
  '147-122 [7] venta desde el CEDIS SIN autorización: rechazada', '42501', '%CEDIS%', 'CEDIS_SIN_PERMISO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(42), %s, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Efectivo', 14702)$q$, pg_temp.n('t7', 'turno_id')),
  '147-123 un cliente que no es elegible en la tienda: rechazado', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(42), %s, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Crédito (fiado)', 14701)$q$, pg_temp.n('t7', 'turno_id')),
  '147-124 crédito (aunque el cliente tenga crédito autorizado): rechazado', '22023', '%', 'SOLO_PAGO_INMEDIATO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(42), %s, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-TF", "descuento": 5}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t7', 'turno_id')),
  '147-125 descuento: rechazado', '22023', '%', 'PRECIO_NO_PERMITIDO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(44), %s, '[{"sku": "P147-A", "cantidad": 1}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t7', 'turno_id')),
  '147-126 con dos congeladores en la tienda, el cajero indica de cuál', '22023', '%', 'CUARTO_REQUERIDO');
INSERT INTO t147 VALUES ('v4', vender_en_tienda(pg_temp.op(45), pg_temp.n('t7', 'turno_id'), '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT string_agg(concat_ws(':', o.estatus, o.tipo_cobro, (SELECT sum(p.monto) FROM pagos p WHERE p.orden_id = o.id), (SELECT count(*) FROM cuentas_por_cobrar x WHERE x.orden_id = o.id)), ',' ORDER BY o.id)
                                         FROM ordenes o WHERE o.establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = 'Entregada:Contado:60.00:0,Entregada:Contado:75.00:0,Entregada:Contado:30.00:0'
  AND pg_temp.inv() = '87|7|0',
  '147-127 [8] cobro inmediato: las 3 ventas quedan Entregadas, de contado, con un pago por su total y sin CxC');
SELECT pg_temp.como(6);
INSERT INTO t147 VALUES ('v1r', vender_en_tienda(pg_temp.op(40), pg_temp.n('t6', 'turno_id'), '[{"sku": "P147-A", "cantidad": 2, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1r') -> 'replay')::boolean AND pg_temp.n('v1r', 'orden_id') = pg_temp.n('v1', 'orden_id') AND pg_temp.inv() = '87|7|0'
  AND pg_temp.q(format($q$SELECT count(*) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = '3',
  '147-128 [9] reintento idempotente: el mismo cobro devuelve la misma venta; ni otra salida ni otro pago');
SELECT pg_temp.ok(pg_temp.j('v2') ?& ARRAY['folio', 'total', 'metodo', 'referencia', 'lineas', 'cliente_nombre', 'pago_id', 'turno_id', 'caja_id']
  AND pg_temp.j('v2') ->> 'referencia' = (pg_temp.j('v2') ->> 'folio') || ' · AUT 5567' AND pg_temp.j('v2') -> 'lineas' -> 0 ->> 'precio_unit' = '25.00' AND pg_temp.j('v2') ->> 'cliente_nombre' = 'Cliente elegible 147',
  '147-129 [10] comprobante: la venta devuelve folio, líneas con el precio real, total, forma de pago, referencia y cliente');

\echo '── 147: VALIDACIÓN INTEGRADA — 11. cierre de caja'
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(50), %s, 335)$q$, pg_temp.n('t6', 'turno_id')), '147-130 [11] si lo contado no coincide pide motivo (sin decir cuánto)', '22023', '%', 'MOTIVO_DIFERENCIA');
INSERT INTO t147 VALUES ('z6', cerrar_turno_caja(pg_temp.op(50), pg_temp.n('t6', 'turno_id'), 260));
SELECT pg_temp.ok((pg_temp.j('z6') ->> 'efectivo_esperado')::numeric = 260 AND (pg_temp.j('z6') ->> 'diferencia')::numeric = 0
  AND pg_temp.j('z6') -> 'totales' -> 'cobrado_por_metodo' = '{"Efectivo": 60.00, "Tarjeta (terminal)": 75.00}'::jsonb,
  '147-131 [11] cierre: esperado = fondo 200 + efectivo 60 = 260 (la tarjeta no es efectivo); cuadra');

\echo '── 147: VALIDACIÓN INTEGRADA — 12 y 13. corrección administrativa y reembolso'
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(60), %s, 'Cobro duplicado', 'Reintegrar')$q$, pg_temp.n('v2', 'orden_id')), '147-140 [12] la cajera no corrige ventas', '42501');
SELECT pg_temp.como(11);
INSERT INTO t147 VALUES ('cv2', corregir_venta_tienda(pg_temp.op(60), pg_temp.n('v2', 'orden_id'), 'Cobro duplicado en la terminal', 'Reintegrar', NULL, NULL, 'electronico', false));
SELECT pg_temp.ok(pg_temp.j('cv2') -> 'reembolso' ->> 'estado' = 'registrado' AND NOT (pg_temp.j('cv2') -> 'reembolso' -> 'dinero_devuelto')::boolean AND (pg_temp.j('cv2') -> 'reembolso' ->> 'monto')::numeric = 75
  AND pg_temp.j('cv2') ->> 'cuarto_id' = 'CF-147-C1' AND pg_temp.inv() = '90|7|0',
  '147-141 [12-13] Admin corrige la venta con tarjeta: el producto vuelve al cuarto del CEDIS del que salió y el reembolso queda REGISTRADO (no devuelto)');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(61), %s)$q$, pg_temp.n('cv2', 'correccion_id')), '147-142 [13] confirmarlo exige la referencia del banco', '22023', '%', 'REFERENCIA_REQUERIDA');
SELECT pg_temp.ok(confirmar_reembolso_tienda(pg_temp.op(61), pg_temp.n('cv2', 'correccion_id'), 'DEV-991122') ->> 'estado' = 'ejecutado'
  AND pg_temp.q(format($q$SELECT concat_ws('|', reembolso_estado, reembolso_referencia) FROM correcciones_venta_tienda WHERE id = %s$q$, pg_temp.n('cv2', 'correccion_id'))) = 'ejecutado|DEV-991122',
  '147-143 [13] con la referencia queda EJECUTADO');
INSERT INTO t147 VALUES ('c4', corregir_venta_tienda(pg_temp.op(62), pg_temp.n('v4', 'orden_id'), 'El cliente regresó la bolsa', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('t7', 'turno_id')));
SELECT pg_temp.como(7);
INSERT INTO t147 VALUES ('z7', cerrar_turno_caja(pg_temp.op(51), pg_temp.n('t7', 'turno_id'), 0));
SELECT pg_temp.ok(pg_temp.j('c4') -> 'reembolso' ->> 'estado' = 'ejecutado' AND (pg_temp.j('z7') ->> 'efectivo_esperado')::numeric = 0 AND (pg_temp.j('z7') -> 'totales' ->> 'reembolsos_efectivo_caja')::numeric = 30
  AND pg_temp.inv() = '90|8|0',
  '147-144 [12-13] corrección en efectivo desde la caja 2: el reembolso baja el efectivo esperado de ESE turno (1 venta de 30 − 30 de reembolso = 0)');

\echo '── 147: VALIDACIÓN INTEGRADA — 14. aislamiento'
-- Segunda tienda de fábrica con su propia cajera.
SELECT pg_temp.como(1);
INSERT INTO t147 VALUES ('tf2', guardar_establecimiento(NULL, 'TF147B', 'Segunda tienda 147'));
SELECT asignar_cuarto_tienda(pg_temp.n('tf2', 'id'), 'CF-147-TF2', 'Congelador segunda tienda');
INSERT INTO t147 VALUES ('kb', agregar_caja_tienda(pg_temp.n('tf2', 'id'), 'Caja 1'));
SELECT asignar_usuario_tienda(pg_temp.n('tf2', 'id'), 14712, false, false);
SELECT activar_tienda(pg_temp.op(70), pg_temp.n('tf2', 'id'), true);
SELECT pg_temp.falla(format($q$SELECT asignar_cuarto_tienda(%s, 'CF-147-TF')$q$, pg_temp.n('tf2', 'id')), '147-150 un congelador de una tienda no se le pasa a otra', '22023', '%', 'CUARTO_DE_OTRA_TIENDA');
SELECT pg_temp.como(12);
INSERT INTO t147 VALUES ('t12', abrir_turno_caja(pg_temp.op(71), pg_temp.n('kb', 'id'), 0));
SELECT pg_temp.ok((SELECT string_agg(id, ',' ORDER BY id) FROM cuartos_frios) = 'CF-147-TF2' AND (SELECT count(*) FROM ordenes) = 0 AND (SELECT count(*) FROM pagos) = 0
  AND (SELECT count(*) FROM cajas) = 1 AND (SELECT count(*) FROM turnos_caja) = 1 AND jsonb_array_length(mis_establecimientos() -> 'establecimientos') = 1,
  '147-151 [14] la cajera de OTRA tienda no ve congeladores, ventas, pagos, cajas ni turnos de la tienda de fábrica');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(72), %s, '[{"sku": "P147-A", "cantidad": 1, "cuarto_id": "CF-147-TF"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t12', 'turno_id')),
  '147-152 [14] …ni vende de su congelador', '42501', '%', 'INVENTARIO_DE_OTRA_TIENDA');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(73), %s, 0)$q$, pg_temp.n('k1', 'id')), '147-153 [14] …ni abre una caja de la otra tienda', '42501');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'cliente')$q$, pg_temp.n('tf', 'id')), '147-154 [14] …ni busca clientes a nombre de la otra tienda', '42501');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14701)$q$, pg_temp.n('tf2', 'id')), '147-155 [14] …ni usa en SU tienda un cliente elegible solo en la otra', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.como(6);
SELECT pg_temp.ok(NOT erp_lector_negocio() AND NOT erp_es_activo() AND NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Producción', 'Chofer', 'Facturación', 'Almacén Bolsas'])
  AND (SELECT count(*) FROM clientes) = 0 AND (SELECT count(*) FROM productos) = 0 AND (SELECT count(*) FROM rutas) = 0 AND (SELECT count(*) FROM cuentas_por_cobrar) = 0
  AND (SELECT count(*) FROM movimientos_contables) = 0 AND (SELECT count(*) FROM precios_esp) = 0,
  '147-156 [14] operación central: la cajera no lee clientes, productos, rutas, CxC, contabilidad ni precios especiales, y ningún contrato central la acepta');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 14701, "metodo_pago": "Efectivo", "permitir_sin_stock": true}'::jsonb, '[{"sku": "P147-A", "cantidad": 1}]'::jsonb)$q$, '147-157 [14] no crea pedidos centrales', '42501');
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(74), 14791, 'contado', 'Efectivo', '[{"sku":"P147-A","cuarto_id":"CF-147-C1","cantidad":1}]'::jsonb, NULL, NULL)$q$, '147-158 [14] no entrega ventas centrales', '42501');
SELECT pg_temp.falla($q$SELECT estado_tienda()$q$, '147-159 [14] no consulta la configuración de tiendas', '42501');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14706, true, true)$q$, pg_temp.n('tf2', 'id')), '147-160 [14] no se asigna a otra tienda ni se da permisos', '42501');
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(75), 14791, 'contado', 'Efectivo', '[{"sku":"P147-A","cuarto_id":"CF-147-TF","cantidad":1}]'::jsonb, NULL, NULL)$q$,
  '147-161 [14] Ventas central no saca producto del congelador de la tienda', '42501');
SELECT pg_temp.ok((SELECT rol FROM erp_actor()) = 'Ventas' AND erp_lector_negocio() AND (SELECT count(*) FROM clientes WHERE id IN (14701, 14702, 14703)) = 3,
  '147-162 [14] Ventas central conserva su perfil y su lectura');

\echo '── 147: desactivación controlada'
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(80), %s, false, 'Cierre temporal por inventario')$q$, pg_temp.n('tf2', 'id')), '147-170 no se desactiva una tienda con turnos abiertos', '22023', '%turnos de caja abiertos%', 'TURNOS_ABIERTOS');
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 14712, true)$q$, pg_temp.n('tf2', 'id')), '147-171 no se retira a una cajera con turno abierto', '22023', '%', 'TURNO_ABIERTO');
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(80), %s, false)$q$, pg_temp.n('tf', 'id')), '147-172 desactivar exige el motivo', '22023', '%', 'MOTIVO_REQUERIDO');
INSERT INTO t147 VALUES ('des', activar_tienda(pg_temp.op(80), pg_temp.n('tf', 'id'), false, 'Cierre temporal por inventario'));
SELECT pg_temp.ok(NOT (pg_temp.j('des') -> 'activo')::boolean AND (activar_tienda(pg_temp.op(80), pg_temp.n('tf', 'id'), false, 'Cierre temporal por inventario') -> 'replay')::boolean
  AND (activar_tienda(pg_temp.op(81), pg_temp.n('tf', 'id'), false, 'Otra vez lo mismo') -> 'sin_cambio')::boolean
  AND pg_temp.q(format($q$SELECT string_agg(tipo, ',' ORDER BY id) FROM establecimiento_eventos WHERE establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = 'alta,activacion,desactivacion',
  '147-173 Admin desactiva la tienda (sin turnos abiertos) con motivo: auditable e idempotente');
SELECT pg_temp.como(6);
SELECT pg_temp.ok(mis_establecimientos() -> 'establecimientos' = '[]'::jsonb AND (SELECT rol FROM erp_actor()) = 'Ventas Tienda' AND (SELECT count(*) FROM cuartos_frios) = 0 AND (SELECT count(*) FROM ordenes) = 0,
  '147-174 tienda desactivada: su cajera deja de ver todo y NO regresa a Ventas central');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(82), %s, 0)$q$, pg_temp.n('k1', 'id')), '147-175 …ni abre turno', '42501');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(83), 'CF-147-C1', 'CF-147-TF', 'P147-A', 1)$q$, '147-176 …ni se le traspasa producto', '42501|22023');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((activar_tienda(pg_temp.op(84), pg_temp.n('tf', 'id'), true, 'Reapertura') -> 'activo')::boolean, '147-177 se puede volver a activar (vuelve a pasar la lista de verificación)');
SELECT pg_temp.falla($q$UPDATE establecimiento_eventos SET motivo = 'x'$q$, '147-178 la historia de activaciones no se edita', '42501');
SELECT pg_temp.falla($q$DELETE FROM establecimiento_eventos$q$, '147-179 …ni se borra', '42501');

\echo '── 147: superficie — quién puede llamar a los contratos administrativos'
DO $$
DECLARE f TEXT; n INTEGER; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH n IN ARRAY ARRAY[2, 3, 4, 5, 6, 9, 12] LOOP
    PERFORM pg_temp.como(n);
    FOREACH f IN ARRAY ARRAY['SELECT guardar_establecimiento(NULL, NULL, NULL)', 'SELECT asignar_cuarto_tienda(NULL, NULL, NULL)', 'SELECT agregar_caja_tienda(NULL, NULL)',
                             'SELECT asignar_usuario_tienda(NULL, NULL, NULL, NULL)', 'SELECT retirar_usuario_tienda(NULL, NULL, NULL)',
                             'SELECT configurar_clientes_tienda(NULL, NULL, NULL, NULL)', 'SELECT estado_tienda(NULL)', 'SELECT activar_tienda(NULL, NULL, NULL, NULL)'] LOOP
      v_state := NULL;
      BEGIN EXECUTE f; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
      IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (n || ': ' || f || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 147-180 %', v_mal; END IF;
  RAISE NOTICE 'OK: 147-180 Ventas central, Producción, Chofer, Empleado, Almacén Bolsas y los cajeros de tienda: los 8 contratos administrativos responden "no autorizado" (42501)';
END $$;
RESET ROLE;

\echo '── 147: el dueño apaga el interruptor global → todo se detiene'
SAVEPOINT s_apagado;
SET LOCAL session_replication_role = replica; UPDATE tiendas_activacion SET habilitada = false; SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(90), %s, true)$q$, pg_temp.n('tf', 'id')), '147-190 interruptor apagado: no se activa', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14707, false, false)$q$, pg_temp.n('tf', 'id')), '147-191 …ni se configura', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.como(12);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(91), %s, '[{"sku": "P147-A", "cantidad": 1}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t12', 'turno_id')), '147-192 …ni se vende, aunque la tienda esté activa y el turno abierto', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
RESET ROLE;
ROLLBACK TO s_apagado;

\echo '── 147: invariantes finales'
SELECT pg_temp.ok(pg_temp.inv() = '90|8|0', '147-195 existencias finales: CEDIS 90, congelador de la tienda 8');
SELECT pg_temp.ok((SELECT count(*) FROM inventario_mov WHERE producto = 'P147-A' AND cuarto_id IN ('CF-147-C1', 'CF-147-TF')) = 7
  AND (SELECT count(*) FROM cuartos_frios c, jsonb_each_text(c.stock) k WHERE c.id LIKE 'CF-147-%' AND k.value::int < 0) = 0,
  '147-196 todo movimiento quedó en el kardex (2 del traspaso, 3 salidas de venta, 2 reingresos por corrección) y ninguna existencia negativa');
ROLLBACK;
