-- 146_pos_cajas_turnos_test.sql — Tiendas propias, E4: cajas, turnos, venta atómica del POS,
-- cierre, reapertura y corrección administrativa.
-- Escenario aislado: el interruptor de tiendas se enciende DENTRO de la transacción y todo se
-- deshace con ROLLBACK. (Carreras con dos conexiones: c146_concurrencia.mjs.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t146.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 146';
INSERT INTO establecimientos (clave, nombre, tipo, clientes_pos) VALUES
  ('TFAB146', 'Tienda de fábrica 146', 'tienda_fabrica', 'todos'), ('TEXX146', 'Tienda X 146', 'tienda', 'lista'), ('TEYY146', 'Tienda Y 146', 'tienda', 'lista');
CREATE TEMP TABLE t146 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t146 TO authenticated;
INSERT INTO t146 SELECT lower(substr(clave, 1, 4)), to_jsonb(id) FROM establecimientos WHERE clave LIKE '%146';   -- tfab, texx, teyy
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t146 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.n(p_k TEXT, p_campo TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT CASE WHEN p_campo IS NULL THEN (v #>> '{}')::bigint ELSE (v ->> p_campo)::bigint END FROM t146 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14600000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t146' FROM generate_series(1, 11) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14601, 'Admin T146',           'u1@t146',  'Admin',      'Activo', '14600000-0000-0000-0000-000000000001'),
  (14602, 'Ventas central T146',  'u2@t146',  'Ventas',     'Activo', '14600000-0000-0000-0000-000000000002'),
  (14603, 'Produccion T146',      'u3@t146',  'Producción', 'Activo', '14600000-0000-0000-0000-000000000003'),
  (14604, 'Chofer T146',          'u4@t146',  'Chofer',     'Activo', '14600000-0000-0000-0000-000000000004'),
  (14605, 'Empleado T146',        'u5@t146',  'Empleado',   'Activo', '14600000-0000-0000-0000-000000000005'),
  (14606, 'Cajera X uno T146',    'u6@t146',  'Ventas',     'Activo', '14600000-0000-0000-0000-000000000006'),
  (14607, 'Cajero X dos T146',    'u7@t146',  'Ventas',     'Activo', '14600000-0000-0000-0000-000000000007'),
  (14608, 'Cajera Y T146',        'u8@t146',  'Ventas',     'Activo', '14600000-0000-0000-0000-000000000008'),
  (14609, 'Fabrica con CEDIS T146','u9@t146', 'Ventas',     'Activo', '14600000-0000-0000-0000-000000000009'),
  (14610, 'Fabrica sin CEDIS T146','u10@t146','Ventas',     'Activo', '14600000-0000-0000-0000-000000000010'),
  (14611, 'Admin dos T146',       'u11@t146', 'Admin',      'Activo', '14600000-0000-0000-0000-000000000011');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P146-A', 'Hielo A146', 'Producto Terminado', 30, 0, 0), ('P146-B', 'Hielo B146', 'Producto Terminado', 90, 0, 0), ('E146-X', 'Bolsa 146', 'Empaque', 2, 0, 1);
INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES
  ('CF-146-TX',  'Congelador X uno 146', '{"P146-A": 10, "P146-B": 5}', pg_temp.n('texx')),
  ('CF-146-TX2', 'Congelador X dos 146', '{"P146-A": 3}',               pg_temp.n('texx')),
  ('CF-146-TY',  'Congelador Y 146',     '{"P146-A": 10}',              pg_temp.n('teyy')),
  ('CF-146-TF',  'Congelador fábrica 146','{"P146-A": 10}',             pg_temp.n('tfab')),
  ('CF-146-C1',  'Cuarto CEDIS 146',     '{"P146-A": 100}',             1);
INSERT INTO clientes (id, nombre, rfc, regimen, uso_cfdi, cp, saldo, credito_autorizado, limite_credito, estatus) VALUES
  (14601, 'Cliente de lista 146',  'CLI010203AB1',  '601', 'G03', '34000', 0, true,  9999, 'Activo'),
  (14602, 'Cliente ajeno 146',     'XAXX010101000', '616', 'S01', '34000', 0, false, 0,    'Activo'),
  (14603, 'Cliente inactivo 146',  'XAXX010101000', '616', 'S01', '34000', 0, false, 0,    'Inactivo');
INSERT INTO sucursales (id, cliente_id, nombre, es_principal, estatus) VALUES (1460101, 14601, 'Principal', true, 'Activa'), (1460201, 14602, 'Principal', true, 'Activa');
INSERT INTO precios_esp (cliente_id, sku, precio, sucursal_id) VALUES (14601, 'P146-A', 25, NULL);
SET LOCAL session_replication_role = origin;
INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis, asignado_por) VALUES
  (14606, pg_temp.n('texx'), false, 'prueba 146'), (14607, pg_temp.n('texx'), false, 'prueba 146'), (14608, pg_temp.n('teyy'), false, 'prueba 146'),
  (14609, pg_temp.n('tfab'), true,  'prueba 146'), (14610, pg_temp.n('tfab'), false, 'prueba 146');
INSERT INTO establecimiento_clientes (establecimiento_id, cliente_id, asignado_por) VALUES (pg_temp.n('texx'), 14601, 'prueba 146'), (pg_temp.n('texx'), 14603, 'prueba 146');

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
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"14600000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14600000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Consulta de un valor con los permisos del dueño de la prueba (para comprobar el estado real sin cambiar de sesión).
CREATE OR REPLACE FUNCTION pg_temp.q(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
-- Existencia de P146-A: CEDIS|fábrica|X uno|X dos|Y — y P146-B en X uno
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (SELECT string_agg(COALESCE(stock ->> 'P146-A', '0'), '|' ORDER BY id) FROM public.cuartos_frios WHERE id LIKE 'CF-146-%')
         || ' B=' || (SELECT COALESCE(stock ->> 'P146-B', '0') FROM public.cuartos_frios WHERE id = 'CF-146-TX') $$;
-- Huella de TODO lo que una venta fallida no debe dejar: órdenes, líneas, pagos, kardex, operaciones, ingresos, ventas de tienda.
CREATE OR REPLACE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.ordenes), (SELECT count(*) FROM public.orden_lineas), (SELECT count(*) FROM public.pagos),
                   (SELECT count(*) FROM public.inventario_mov), (SELECT count(*) FROM public.stock_operaciones), (SELECT count(*) FROM public.movimientos_contables),
                   (SELECT count(*) FROM public.ventas_tienda), (SELECT count(*) FROM public.cuentas_por_cobrar), (SELECT last_value FROM public.folio_ov_seq)) $$;
CREATE OR REPLACE FUNCTION pg_temp.detalle(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v = PG_EXCEPTION_DETAIL; RETURN SQLERRM || ' / ' || COALESCE(v, ''); END $$;

\echo '── 146: catálogo'
SELECT pg_temp.ok(current_setting('t146.apagado_al_inicio')::boolean, '146-01 el interruptor de tiendas estaba APAGADO al empezar (146 no lo toca); se encendió solo dentro de esta prueba');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.registrar_pago_orden(bigint,text,text,bigint)'::regprocedure)) = 'add148ab82529ea5f3b2c4d2fcdb10ca'
  AND md5(pg_get_functiondef('public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)'::regprocedure)) = 'ba3f4a250794e3b49f54cb167f4a45af'
  AND md5(pg_get_functiondef('public.crear_orden(jsonb,jsonb)'::regprocedure)) = 'ccdd240c58f69d89699c99c89199e911'
  AND md5(pg_get_functiondef('public.lineas_canonicas(bigint,bigint,jsonb)'::regprocedure)) = '1a84a57e4334218972341dcc76e00c28'
  AND md5(pg_get_functiondef('public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure)) = '3591d07446854c4a682cd41f88489ec6'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = 'e1a9770e1bc5cebd7f565c9cfdc2a880'
  AND md5(pg_get_functiondef('public.ordenes_guard_establecimiento()'::regprocedure)) = '041148557f92f4aa2d69315e3b53289d',
  '146-02 NINGÚN contrato histórico cambia: venta directa, pago, devolución, pedido, precios, kardex, identidad y guarda de establecimiento (md5 de siempre)');
SELECT pg_temp.ok((SELECT count(*) = 5 AND bool_and(c.relrowsecurity AND has_table_privilege('authenticated', c.oid, 'SELECT')
                            AND NOT has_table_privilege('authenticated', c.oid, 'INSERT') AND NOT has_table_privilege('authenticated', c.oid, 'UPDATE')
                            AND NOT has_table_privilege('authenticated', c.oid, 'DELETE') AND NOT has_table_privilege('anon', c.oid, 'SELECT'))
                     FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('cajas', 'turnos_caja', 'turnos_caja_eventos', 'ventas_tienda', 'correcciones_venta_tienda')),
  '146-03 las 5 tablas nuevas: RLS activa, solo lectura para authenticated, nada para anon');
SELECT pg_temp.ok((SELECT string_agg(tablename || '.' || policyname || ':' || cmd, ',' ORDER BY tablename, policyname)
                     = 'cajas.admin_read:SELECT,cajas.tienda_read:SELECT,correcciones_venta_tienda.admin_read:SELECT,turnos_caja.admin_read:SELECT,turnos_caja.tienda_read:SELECT,turnos_caja_eventos.admin_read:SELECT,ventas_tienda.admin_read:SELECT'
                     FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('cajas', 'turnos_caja', 'turnos_caja_eventos', 'ventas_tienda', 'correcciones_venta_tienda')),
  '146-04 7 policies, todas de LECTURA: Admin en las 5; el usuario de tienda solo en cajas y turnos');
SELECT pg_temp.ok((SELECT count(*) = 8 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guardar_caja', 'abrir_turno_caja', 'vender_en_tienda', 'cerrar_turno_caja',
                       'reabrir_turno_caja', 'corregir_venta_tienda', 'confirmar_reembolso_tienda', 'mi_turno_caja')),
  '146-05 los 8 contratos: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');
SELECT pg_temp.ok((SELECT count(*) = 8 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('pos_es_admin', 'pos_evento_replay', 'turno_caja_totales', 'cajas_guard',
                       'turnos_caja_guard', 'pos_historia_guard', 'ordenes_guard_turno', 'pos_exigir_establecimiento')),
  '146-06 las funciones internas y las guardas no se exponen por API');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('turnos_caja_un_abierto_por_caja', 'turnos_caja_un_abierto_por_cajero') AND indexdef LIKE '%UNIQUE%abierto%')
  AND (SELECT is_nullable = 'YES' AND column_default IS NULL FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ordenes' AND column_name = 'turno_id')
  AND (SELECT count(*) = 0 FROM ordenes WHERE turno_id IS NOT NULL)
  AND (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes'::regclass AND tgname = 'trg_ordenes_guard_turno' AND tgenabled = 'O'),
  '146-07 un turno abierto por caja y por cajero (índices únicos); ordenes.turno_id opcional y vacío en todas las órdenes existentes; guarda activa');

\echo '── 146: cajas (solo Administración)'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(1);
INSERT INTO t146 VALUES ('x1', guardar_caja(NULL, pg_temp.n('texx'), '  Caja   1 ', true)), ('x2', guardar_caja(NULL, pg_temp.n('texx'), 'Caja 2')),
                        ('y1', guardar_caja(NULL, pg_temp.n('teyy'), 'Caja 1')), ('f1', guardar_caja(NULL, pg_temp.n('tfab'), 'Caja 1')), ('f2', guardar_caja(NULL, pg_temp.n('tfab'), 'Caja 2')),
                        ('x3', guardar_caja(NULL, pg_temp.n('texx'), 'Caja apagada', false));
SELECT pg_temp.ok(pg_temp.j('x1') ->> 'nombre' = 'Caja 1' AND (pg_temp.j('x1') -> 'activa')::boolean AND pg_temp.n('x1', 'establecimiento_id') = pg_temp.n('texx')
  AND (SELECT count(*) = 6 FROM cajas), '146-10 Admin da de alta varias cajas por tienda (D-S9); el nombre se normaliza');
SELECT pg_temp.falla(format($q$SELECT guardar_caja(NULL, %s, 'caja 1')$q$, pg_temp.n('texx')), '146-11 no hay dos cajas con el mismo nombre en una tienda', '22023', '%ya tiene una caja%', 'CAJA_REPETIDA');
SELECT pg_temp.falla($q$SELECT guardar_caja(NULL, 1, 'Caja CEDIS')$q$, '146-12 el CEDIS no tiene cajas de tienda', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
SELECT pg_temp.falla($q$SELECT guardar_caja(NULL, 99999, 'Caja')$q$, '146-13 establecimiento inexistente', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$INSERT INTO cajas (establecimiento_id, nombre) VALUES (%s, 'Por REST')$q$, pg_temp.n('texx')), '146-14 ni Admin escribe cajas por REST', '42501');
SELECT pg_temp.falla(format($q$SELECT guardar_caja(%s, %s, 'Caja 1')$q$, pg_temp.n('x1', 'id'), pg_temp.n('teyy')), '146-15 una caja no cambia de tienda', '22023', '%no cambia de tienda%');
SELECT pg_temp.como(6);  SELECT pg_temp.falla(format($q$SELECT guardar_caja(NULL, %s, 'Mía')$q$, pg_temp.n('texx')), '146-16 el usuario de tienda no crea cajas', '42501');
SELECT pg_temp.como(2);  SELECT pg_temp.falla(format($q$SELECT guardar_caja(NULL, %s, 'Mía')$q$, pg_temp.n('texx')), '146-17 Ventas central tampoco', '42501');

\echo '── 146: apertura de turno'
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(1), %s, -1)$q$, pg_temp.n('x1', 'id')), '146-20 fondo negativo: rechazado', '22023', '%', 'FONDO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(1), %s, 10.005)$q$, pg_temp.n('x1', 'id')), '146-21 fondo con más de dos decimales: rechazado', '22023', '%', 'FONDO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(NULL, %s, 500)$q$, pg_temp.n('x1', 'id')), '146-22 sin operacion_id: rechazado', '22023', '%operacion_id%');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(1), %s, 500)$q$, pg_temp.n('x3', 'id')), '146-23 caja desactivada: rechazado', '22023', '%desactivada%', 'CAJA_INACTIVA');
INSERT INTO t146 VALUES ('t1', abrir_turno_caja(pg_temp.op(1), pg_temp.n('x1', 'id'), 500));
SELECT pg_temp.ok(pg_temp.j('t1') ->> 'estado' = 'abierto' AND pg_temp.n('t1', 'cajero_id') = 14606 AND pg_temp.n('t1', 'establecimiento_id') = pg_temp.n('texx')
  AND (pg_temp.j('t1') ->> 'fondo_inicial')::numeric = 500 AND NOT (pg_temp.j('t1') -> 'replay')::boolean AND pg_temp.j('t1') ->> 'cajero' = 'Cajera X uno T146',
  '146-24 la cajera abre su turno en una caja de SU tienda; el establecimiento y el cajero los pone el servidor');
SELECT pg_temp.ok((SELECT r -> 'replay' = 'true'::jsonb AND (r ->> 'turno_id')::bigint = pg_temp.n('t1', 'turno_id') FROM (SELECT abrir_turno_caja(pg_temp.op(1), pg_temp.n('x1', 'id'), 500) r) q)
  AND pg_temp.q('SELECT count(*) FROM turnos_caja') = '1' AND pg_temp.q('SELECT count(*) FROM turnos_caja_eventos') = '1',
  '146-25 reintento de la apertura (mismo operacion_id): mismo turno, sin duplicar');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(1), %s, 700)$q$, pg_temp.n('x1', 'id')), '146-26 el mismo operacion_id con otro fondo: rechazado', '23505', '%', 'OPERACION_REPETIDA');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(2), %s, 0)$q$, pg_temp.n('x2', 'id')), '146-27 un cajero no tiene dos turnos abiertos', '22023', '%ya tienes un turno abierto%', 'CAJERO_CON_TURNO');
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(2), %s, 0)$q$, pg_temp.n('y1', 'id')), '146-28 no abre turno en la caja de OTRA tienda', '42501');
SELECT pg_temp.falla($q$SELECT abrir_turno_caja(pg_temp.op(2), 99999999, 0)$q$, '146-29 caja inexistente: misma respuesta (no autorizado)', '42501');
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(3), %s, 0)$q$, pg_temp.n('x1', 'id')), '146-30 una caja no tiene dos turnos abiertos', '22023', '%ya tiene un turno abierto%', 'CAJA_OCUPADA');
INSERT INTO t146 VALUES ('t2', abrir_turno_caja(pg_temp.op(3), pg_temp.n('x2', 'id'), 0));
SELECT pg_temp.como(8);  INSERT INTO t146 VALUES ('t3', abrir_turno_caja(pg_temp.op(4), pg_temp.n('y1', 'id'), 100));
SELECT pg_temp.como(9);  INSERT INTO t146 VALUES ('t6', abrir_turno_caja(pg_temp.op(5), pg_temp.n('f1', 'id'), 0));
SELECT pg_temp.como(10); INSERT INTO t146 VALUES ('t7', abrir_turno_caja(pg_temp.op(6), pg_temp.n('f2', 'id'), 0));
SELECT pg_temp.ok(pg_temp.q('SELECT count(*) FROM turnos_caja WHERE estado = ''abierto''') = '5', '146-31 dos cajas de la misma tienda con turnos simultáneos (5 turnos abiertos en 3 tiendas)');
SELECT pg_temp.como(1);  SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(7), %s, 0)$q$, pg_temp.n('x3', 'id')), '146-32 Admin no es cajero: no abre turnos', '42501');
SELECT pg_temp.como(2);  SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(7), %s, 0)$q$, pg_temp.n('x3', 'id')), '146-33 Ventas central: no autorizado', '42501');
SELECT pg_temp.como(5);  SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(7), %s, 0)$q$, pg_temp.n('x3', 'id')), '146-34 Empleado: no autorizado', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT guardar_caja(%s, NULL, 'Caja 1', false)$q$, pg_temp.n('x1', 'id')), '146-35 una caja con turno abierto no se desactiva', '22023', '%', 'CAJA_CON_TURNO_ABIERTO');

\echo '── 146: lectura por REST y mi_turno_caja'
SELECT pg_temp.como(6);
SELECT pg_temp.ok((SELECT count(*) = 3 AND bool_and(establecimiento_id = pg_temp.n('texx')) FROM cajas)
  AND (SELECT count(*) = 1 AND min(id) = pg_temp.n('t1', 'turno_id') FROM turnos_caja)
  AND (SELECT count(*) FROM turnos_caja_eventos) = 0 AND (SELECT count(*) FROM ventas_tienda) = 0 AND (SELECT count(*) FROM correcciones_venta_tienda) = 0,
  '146-40 la cajera ve las cajas de SU tienda (3, ninguna de otra) y solo SU turno (no el del otro cajero de la misma tienda); nada de eventos ni correcciones');
INSERT INTO t146 VALUES ('m6', mi_turno_caja());
SELECT pg_temp.ok(pg_temp.j('m6') -> 'turno' ->> 'turno_id' = (pg_temp.n('t1', 'turno_id'))::text AND jsonb_array_length(pg_temp.j('m6') -> 'cajas') = 2
  AND (SELECT bool_and((c -> 'ocupada')::boolean) FROM jsonb_array_elements(pg_temp.j('m6') -> 'cajas') c)
  AND pg_temp.j('m6')::text !~* 'esperado|contado|diferencia',
  '146-41 mi_turno_caja: su turno y qué cajas de su tienda están ocupadas; no dice cuánto efectivo se espera (conteo a ciegas)');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((SELECT count(*) = 6 FROM cajas) AND (SELECT count(*) = 5 FROM turnos_caja) AND (SELECT count(*) = 5 FROM turnos_caja_eventos)
  AND jsonb_array_length(mi_turno_caja() -> 'cajas') = 6 AND mi_turno_caja() -> 'turno' = 'null'::jsonb, '146-42 Admin ve todas las cajas, turnos y eventos');
SELECT pg_temp.como(2);
SELECT pg_temp.ok((SELECT count(*) FROM cajas) = 0 AND (SELECT count(*) FROM turnos_caja) = 0 AND (SELECT count(*) FROM ventas_tienda) = 0, '146-43 Ventas central no ve cajas ni turnos');
SELECT pg_temp.falla($q$SELECT mi_turno_caja()$q$, '146-44 …ni usa mi_turno_caja', '42501');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$INSERT INTO turnos_caja (caja_id, establecimiento_id, cajero_id, cajero_nombre, fecha_negocio, fondo_inicial) VALUES (%s, %s, 14606, 'x', CURRENT_DATE, 0)$q$, pg_temp.n('x3', 'id'), pg_temp.n('texx')),
  '146-45 la cajera no inserta turnos por REST', '42501');
SELECT pg_temp.falla($q$UPDATE turnos_caja SET fondo_inicial = 0$q$, '146-46 …ni cambia su fondo', '42501');
SELECT pg_temp.falla($q$DELETE FROM turnos_caja$q$, '146-47 …ni borra turnos', '42501');
SELECT pg_temp.falla($q$INSERT INTO ventas_tienda (operacion_id, orden_id, turno_id, caja_id, establecimiento_id, cajero_id, metodo, total, asignacion, huella) VALUES (gen_random_uuid(), 1, 1, 1, 1, 1, 'Efectivo', 1, '[]', 'x')$q$,
  '146-48 …ni inventa ventas de tienda', '42501');

\echo '── 146: venta atómica'
SELECT pg_temp.como(6);
INSERT INTO t146 VALUES ('h0', to_jsonb(pg_temp.huella()));
INSERT INTO t146 VALUES ('v1', vender_en_tienda(pg_temp.op(100), pg_temp.n('t1', 'turno_id'),
  '[{"sku": "P146-A", "cantidad": 2, "cuarto_id": "CF-146-TX"}, {"sku": "P146-B", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1') ->> 'total')::numeric = 150 AND pg_temp.j('v1') ->> 'estatus' = 'Entregada' AND NOT (pg_temp.j('v1') -> 'replay')::boolean
  AND pg_temp.j('v1') ->> 'cliente_nombre' = 'Público en general' AND pg_temp.n('v1', 'turno_id') = pg_temp.n('t1', 'turno_id')
  AND pg_temp.j('v1') -> 'lineas' = '[{"sku": "P146-A", "cantidad": 2, "subtotal": 60.00, "precio_unit": 30.00}, {"sku": "P146-B", "cantidad": 1, "subtotal": 90.00, "precio_unit": 90.00}]'::jsonb,
  '146-50 venta de mostrador: total y precios del servidor (2×30 + 1×90 = 150), entregada al momento');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', estatus, tipo_cobro, metodo_pago, total, vendedor_id, establecimiento_id, turno_id, ruta_id IS NULL, delivered_at IS NOT NULL) FROM ordenes WHERE id = %s$q$, pg_temp.n('v1', 'orden_id')))
                  = concat_ws('|', 'Entregada', 'Contado', 'Efectivo', '150.00', 14606, pg_temp.n('texx'), pg_temp.n('t1', 'turno_id'), 't', 't'),
  '146-51 la orden queda Entregada, de contado, de la cajera, ligada a SU tienda y a SU turno');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(monto), min(metodo_pago), min(usuario_id)) FROM pagos WHERE orden_id = %s$q$, pg_temp.n('v1', 'orden_id'))) = '1|150.00|Efectivo|14606'
  AND pg_temp.q(format($q$SELECT count(*) FROM cuentas_por_cobrar WHERE orden_id = %s$q$, pg_temp.n('v1', 'orden_id'))) = '0'
  AND pg_temp.q(format($q$SELECT count(*) FROM movimientos_contables WHERE orden_id = %s AND tipo = 'Ingreso'$q$, pg_temp.n('v1', 'orden_id')))::int >= 1,
  '146-52 un pago inmediato por el total, sin CxC, con su ingreso contable (los mismos efectos que una venta de mostrador central)');
SELECT pg_temp.ok(pg_temp.inv() = '100|10|8|3|10 B=4'
  AND pg_temp.q(format($q$SELECT string_agg(producto || ':' || cantidad || ':' || cuarto_id || ':' || tipo, ',' ORDER BY producto) FROM inventario_mov WHERE referencia = 'venta_directa/%s'$q$, pg_temp.n('v1', 'orden_id')))
      = 'P146-A:2:CF-146-TX:Salida,P146-B:1:CF-146-TX:Salida',
  '146-53 el inventario baja SOLO del congelador indicado y el kardex guarda de qué cuarto salió');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', turno_id, caja_id, establecimiento_id, cajero_id, metodo, total, desde_cedis, asignacion::text) FROM ventas_tienda WHERE orden_id = %s$q$, pg_temp.n('v1', 'orden_id')))
                  = concat_ws('|', pg_temp.n('t1', 'turno_id'), pg_temp.n('x1', 'id'), pg_temp.n('texx'), 14606, 'Efectivo', '150.00', 'f',
                              '[{"sku": "P146-A", "cantidad": 2, "cuarto_id": "CF-146-TX"}, {"sku": "P146-B", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'),
  '146-54 la venta queda ligada a turno, caja, cajera y cuartos de origen');
-- Reintento y doble clic
INSERT INTO t146 VALUES ('h1', to_jsonb(pg_temp.huella()));
INSERT INTO t146 VALUES ('v1r', vender_en_tienda(pg_temp.op(100), pg_temp.n('t1', 'turno_id'),
  '[{"sku": "P146-B", "cantidad": 1, "cuarto_id": "CF-146-TX"}, {"cuarto_id": "CF-146-TX", "cantidad": 2, "sku": "P146-A"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v1r') -> 'replay')::boolean AND pg_temp.n('v1r', 'orden_id') = pg_temp.n('v1', 'orden_id') AND pg_temp.j('v1r') ->> 'folio' = pg_temp.j('v1') ->> 'folio'
  AND pg_temp.huella() = pg_temp.j('h1') #>> '{}' AND pg_temp.inv() = '100|10|8|3|10 B=4',
  '146-55 reintento tras perder la conexión / doble clic (mismo operacion_id): devuelve la MISMA venta; ni orden, ni pago, ni salida, ni folio nuevos');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(100), %s, '[{"sku": "P146-A", "cantidad": 5, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-56 el mismo operacion_id con otra venta: rechazado', '23505', '%otros datos%', 'OPERACION_REPETIDA');
-- Lo que el cliente NO decide
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX", "precio": 1}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-57 un precio enviado por el cliente: rechazado', '22023', '%los pone el servidor%', 'PRECIO_NO_PERMITIDO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX", "descuento": 10}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-58 un descuento: rechazado (D-S5)', '22023', '%', 'PRECIO_NO_PERMITIDO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX", "precio_unit": 1, "subtotal": 1}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-59 precio unitario o subtotal: rechazado', '22023', '%', 'PRECIO_NO_PERMITIDO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Crédito (fiado)')$q$, pg_temp.n('t1', 'turno_id')),
  '146-60 crédito: rechazado (D-S8)', '22023', '%no hay crédito%', 'SOLO_PAGO_INMEDIATO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'QR / Link de pago')$q$, pg_temp.n('t1', 'turno_id')),
  '146-61 link de pago (cobro que no es inmediato): rechazado', '22023', '%', 'SOLO_PAGO_INMEDIATO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 0, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-62 cantidad 0: rechazada', '22023', '%cantidad entera mayor a 0%');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1.5, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-63 cantidad con decimales: rechazada', '22023', '%cantidad entera%');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')), '146-64 venta sin productos: rechazada', '22023', '%no tiene productos%');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "E146-X", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-65 un empaque no se vende en tienda', '22023', '%', 'PRODUCTO_NO_VENDIBLE');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "NOEXISTE", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-66 SKU inexistente: rechazado', '22023', '%SKU no encontrado%');
-- Origen del inventario
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-67 con dos congeladores en la tienda hay que decir de cuál sale', '22023', '%de qué congelador%', 'CUARTO_REQUERIDO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TY"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-68 no vende del congelador de OTRA tienda', '42501', '%no es de esta tienda%', 'INVENTARIO_DE_OTRA_TIENDA');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-NO-EXISTE"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-69 un cuarto inexistente responde lo mismo', '42501', '%no es de esta tienda%', 'INVENTARIO_DE_OTRA_TIENDA');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-C1"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-70 una tienda normal no vende del CEDIS', '42501', '%CEDIS%', 'CEDIS_SIN_PERMISO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}, {"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TF"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-71 …ni mezclando su congelador con el de otra tienda', '42501', '%', 'INVENTARIO_DE_OTRA_TIENDA');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 9, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-72 sin existencia suficiente EN ESE congelador (hay 8; el otro congelador no cuenta): rechazada', '22023', '%hay 8, se piden 9%', 'SIN_EXISTENCIA');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-B", "cantidad": 1, "cuarto_id": "CF-146-TX"}, {"sku": "P146-A", "cantidad": 4, "cuarto_id": "CF-146-TX2"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-73 si UNA partida no alcanza, no se vende nada', '22023', '%', 'SIN_EXISTENCIA');
-- Cliente
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo', 14602)$q$, pg_temp.n('t1', 'turno_id')),
  '146-74 un cliente fuera de la lista de la tienda: no disponible', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo', 14603)$q$, pg_temp.n('t1', 'turno_id')),
  '146-75 un cliente inactivo (aunque esté en la lista): no disponible', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo', 99999999)$q$, pg_temp.n('t1', 'turno_id')),
  '146-76 un cliente inexistente: la misma respuesta', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo', NULL, NULL, true)$q$, pg_temp.n('t1', 'turno_id')),
  '146-77 factura sin cliente: rechazada', '22023', '%', 'FACTURA_SIN_CLIENTE');
-- Turno ajeno
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t2', 'turno_id')),
  '146-78 no vende en el turno de OTRO cajero de su misma tienda', '42501', '%no autorizado%');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TY"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t3', 'turno_id')),
  '146-79 …ni en el turno de otra tienda', '42501', '%no autorizado%');
SELECT pg_temp.falla($q$SELECT vender_en_tienda(pg_temp.op(101), 99999999, '[{"sku": "P146-A", "cantidad": 1}]'::jsonb, 'Efectivo')$q$, '146-80 un turno inexistente: la misma respuesta', '42501', '%no autorizado%');
SELECT pg_temp.como(1); SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-81 Admin no vende en el turno de una cajera', '42501');
SELECT pg_temp.como(2); SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-82 Ventas central: no autorizado', '42501');
SELECT pg_temp.como(5); SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(101), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-83 Empleado: no autorizado', '42501');
SELECT pg_temp.ok(pg_temp.huella() = pg_temp.j('h1') #>> '{}' AND pg_temp.inv() = '100|10|8|3|10 B=4' AND pg_temp.q('SELECT count(*) FROM ordenes WHERE estatus = ''Creada'' AND turno_id IS NOT NULL') = '0',
  '146-84 NINGUNA de las 28 ventas rechazadas dejó algo: ni orden, ni línea, ni pago, ni kardex, ni operación, ni ingreso, ni folio consumido');

\echo '── 146: más ventas (cliente, tarjeta, dos congeladores, transferencia, un solo congelador, CEDIS con permiso)'
SELECT pg_temp.como(6);
INSERT INTO t146 VALUES ('v2', vender_en_tienda(pg_temp.op(102), pg_temp.n('t1', 'turno_id'), '[{"sku": "P146-A", "cantidad": 2, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Tarjeta (terminal)', 14601, '  AUT   123 ', true));
SELECT pg_temp.ok((pg_temp.j('v2') ->> 'total')::numeric = 50 AND pg_temp.j('v2') ->> 'cliente_nombre' = 'Cliente de lista 146' AND (pg_temp.j('v2') -> 'requiere_factura')::boolean
  AND pg_temp.j('v2') ->> 'referencia' = (pg_temp.j('v2') ->> 'folio') || ' · AUT 123'
  AND pg_temp.q(format($q$SELECT concat_ws('|', cliente_id, sucursal_id, requiere_factura, metodo_pago) FROM ordenes WHERE id = %s$q$, pg_temp.n('v2', 'orden_id'))) = '14601|1460101|t|Tarjeta (terminal)',
  '146-90 con cliente de la lista: su precio especial lo aplica el servidor (2×25 = 50), tarjeta con referencia, con factura');
INSERT INTO t146 VALUES ('v3', vender_en_tienda(pg_temp.op(103), pg_temp.n('t1', 'turno_id'), '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}, {"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX2"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v3') ->> 'total')::numeric = 60 AND jsonb_array_length(pg_temp.j('v3') -> 'lineas') = 1 AND (pg_temp.j('v3') -> 'lineas' -> 0 ->> 'cantidad')::int = 2
  AND pg_temp.inv() = '100|10|5|2|10 B=4', '146-91 el mismo producto de DOS congeladores de la tienda: una línea de 2, una salida de cada congelador');
SELECT pg_temp.como(7);
INSERT INTO t146 VALUES ('v4', vender_en_tienda(pg_temp.op(104), pg_temp.n('t2', 'turno_id'), '[{"sku": "P146-B", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Transferencia SPEI', NULL, 'AUT 123'));
SELECT pg_temp.ok((pg_temp.j('v4') ->> 'total')::numeric = 90 AND pg_temp.n('v4', 'caja_id') = pg_temp.n('x2', 'id') AND pg_temp.j('v4') ->> 'referencia' = (pg_temp.j('v4') ->> 'folio') || ' · AUT 123',
  '146-92 la segunda caja de la misma tienda vende del mismo congelador en SU turno; la misma referencia en otra venta no choca (lleva su folio)');
SELECT pg_temp.como(8);
INSERT INTO t146 VALUES ('v5', vender_en_tienda(pg_temp.op(105), pg_temp.n('t3', 'turno_id'), '[{"sku": "P146-A", "cantidad": 3}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('v5') ->> 'total')::numeric = 90 AND pg_temp.j('v5') -> 'asignacion' -> 0 ->> 'cuarto_id' = 'CF-146-TY' AND pg_temp.inv() = '100|10|5|2|7 B=3',
  '146-93 tienda con un solo congelador: no hace falta indicarlo');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(106), %s, '[{"sku": "P146-A", "cantidad": 1}]'::jsonb, 'Efectivo', 14601)$q$, pg_temp.n('t3', 'turno_id')),
  '146-94 la tienda Y (lista vacía) no vende a un cliente de la lista de la tienda X', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.como(10);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(107), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-C1"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t7', 'turno_id')),
  '146-95 tienda de fábrica, cajero SIN permiso: no vende del CEDIS', '42501', '%', 'CEDIS_SIN_PERMISO');
SELECT pg_temp.como(9);
INSERT INTO t146 VALUES ('v6', vender_en_tienda(pg_temp.op(108), pg_temp.n('t6', 'turno_id'), '[{"sku": "P146-A", "cantidad": 4, "cuarto_id": "CF-146-C1"}, {"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TF"}]'::jsonb, 'Efectivo', 14602));
SELECT pg_temp.ok((pg_temp.j('v6') ->> 'total')::numeric = 150 AND (pg_temp.j('v6') -> 'desde_cedis')::boolean AND pg_temp.inv() = '96|9|5|2|7 B=3'
  AND pg_temp.q(format($q$SELECT concat_ws('|', establecimiento_id, desde_cedis) FROM ventas_tienda WHERE orden_id = %s$q$, pg_temp.n('v6', 'orden_id'))) = pg_temp.n('tfab') || '|t',
  '146-96 tienda de fábrica, cajero CON permiso: vende del CEDIS y de su congelador en la misma venta (D-S4); la venta es de la tienda y queda marcada desde_cedis; modo todos = cualquier cliente vigente');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(109), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t6', 'turno_id')),
  '146-97 …pero nunca del congelador de otra tienda', '42501', '%', 'INVENTARIO_DE_OTRA_TIENDA');
-- Lectura acotada (E3) con ventas reales
SELECT pg_temp.como(8);
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(id) = pg_temp.n('v5', 'orden_id') FROM ordenes) AND (SELECT count(*) = 1 FROM pagos), '146-98 la tienda Y ve su venta y su pago, y ninguno de la tienda X ni de la fábrica');
SELECT pg_temp.como(6);
SELECT pg_temp.ok((SELECT count(*) = 4 FROM ordenes) AND (SELECT count(*) = 4 FROM pagos), '146-99 la tienda X ve las 4 ventas de su tienda (las de las dos cajas)');

\echo '── 146: guardas de la orden y compatibilidad con ventas centrales'
UPDATE ordenes SET turno_id = pg_temp.n('t2', 'turno_id'), total = 1, estatus = 'Cancelada';      -- sin policy de escritura: no alcanza ninguna fila
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', turno_id, total, estatus) FROM ordenes WHERE id = %s$q$, pg_temp.n('v1', 'orden_id'))) = concat_ws('|', pg_temp.n('t1', 'turno_id'), '150.00', 'Entregada')
  AND pg_temp.q('SELECT count(*) FROM ordenes WHERE estatus = ''Cancelada''') = '0', '146-100 la cajera no cambia por REST el turno, el total ni el estatus de ninguna venta (su UPDATE no alcanza filas)');
SELECT pg_temp.falla(format($q$INSERT INTO ordenes (folio, cliente_nombre, productos, total, estatus, tipo_cobro, turno_id) VALUES ('OV-T146', 'x', 'x', 1, 'Creada', 'Contado', %s)$q$, pg_temp.n('t1', 'turno_id')),
  '146-101 …ni inserta órdenes por REST', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$UPDATE ordenes SET turno_id = %s WHERE id = %s$q$, pg_temp.n('t2', 'turno_id'), pg_temp.n('v1', 'orden_id')), '146-102 Admin tampoco mueve una venta de turno por REST', '42501|22023');
SELECT pg_temp.falla(format($q$UPDATE ordenes SET turno_id = %s WHERE id = (SELECT max(id) FROM ordenes WHERE turno_id IS NULL)$q$, pg_temp.n('t1', 'turno_id')), '146-103 …ni mete una orden central en un turno', '42501');
RESET ROLE;
SELECT pg_temp.falla(format($q$UPDATE ordenes SET turno_id = %s WHERE id = %s$q$, pg_temp.n('t2', 'turno_id'), pg_temp.n('v1', 'orden_id')),
  '146-104 ni una sesión de confianza cambia una venta de turno', '22023', '%no cambia de turno%');
SELECT pg_temp.falla(format($q$INSERT INTO ordenes (folio, cliente_nombre, productos, total, estatus, tipo_cobro, establecimiento_id, turno_id, fecha) VALUES ('OV-T146B', 'x', 'x', 1, 'Creada', 'Contado', %s, %s, CURRENT_DATE)$q$, pg_temp.n('teyy'), pg_temp.n('t1', 'turno_id')),
  '146-105 una venta y su turno no pueden ser de establecimientos distintos', '22023', '%mismo establecimiento%', 'ESTABLECIMIENTO_DISTINTO');
-- Venta central de siempre: sin turno ni establecimiento.
SET LOCAL session_replication_role = replica;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, fecha) VALUES
  (14691, 'OV-14691', 14602, 'Cliente ajeno 146', 'x', 60, 'Creada', 'Efectivo', 'Contado', 14602, CURRENT_DATE);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14691, 'P146-A', 2, 30, 60);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
INSERT INTO t146 VALUES ('vc', completar_venta_directa(pg_temp.op(190), 14691, 'contado', 'Efectivo', '[{"sku":"P146-A","cuarto_id":"CF-146-C1","cantidad":2}]'::jsonb, NULL, NULL));
SELECT pg_temp.ok(pg_temp.j('vc') ->> 'estatus' = 'Entregada' AND pg_temp.q('SELECT concat_ws(''|'', turno_id IS NULL, establecimiento_id IS NULL) FROM ordenes WHERE id = 14691') = 't|t'
  AND pg_temp.inv() = '94|9|5|2|7 B=3' AND pg_temp.q('SELECT count(*) FROM ventas_tienda WHERE orden_id = 14691') = '0',
  '146-106 la venta de mostrador central sigue igual: Ventas central, desde el CEDIS, sin turno ni establecimiento');
SELECT pg_temp.falla(format($q$SELECT completar_venta_directa(pg_temp.op(191), %s, 'contado', 'Efectivo', '[{"sku":"P146-A","cuarto_id":"CF-146-TX","cantidad":1}]'::jsonb, NULL, NULL)$q$, pg_temp.n('v1', 'orden_id')),
  '146-107 Ventas central no opera una venta de tienda', '42501|22023');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT completar_venta_directa(pg_temp.op(192), %s, 'contado', 'Efectivo', '[{"sku":"P146-A","cuarto_id":"CF-146-TX","cantidad":1}]'::jsonb, NULL, NULL)$q$, pg_temp.n('v1', 'orden_id')),
  '146-108 la cajera no puede llamar por su cuenta al contrato central (solo existe para ella dentro de vender_en_tienda)', '42501', '%no autorizado%');
SELECT pg_temp.falla($q$SELECT registrar_pago_orden(14691, 'Efectivo', NULL, NULL)$q$, '146-109 …ni cobrar órdenes centrales', '42501');
SELECT pg_temp.ok(NOT fin_ctx_activo(), '146-110 fuera de un contrato no hay contexto transaccional que heredar');

\echo '── 146: interruptor apagado y asignación retirada'
RESET ROLE;
SAVEPOINT s_apagado;
SET LOCAL session_replication_role = replica; UPDATE tiendas_activacion SET habilitada = false; SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(110), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-111 interruptor apagado: no se vende, aunque el turno siga abierto', '22023', '%no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT guardar_caja(NULL, %s, 'Otra')$q$, pg_temp.n('texx')), '146-112 interruptor apagado: no se crean cajas', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
RESET ROLE;
ROLLBACK TO s_apagado;
SAVEPOINT s_sin_asignacion;
DELETE FROM usuario_establecimientos WHERE usuario_id = 14606;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(110), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-113 si le quitan la asignación a la tienda, su turno abierto deja de vender en ese momento', '42501');
RESET ROLE;
ROLLBACK TO s_sin_asignacion;
SAVEPOINT s_caja_inactiva;
SET LOCAL session_replication_role = replica; UPDATE cajas SET activa = false WHERE id = pg_temp.n('x1', 'id'); SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(110), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-114 una caja desactivada deja de vender', '42501', '%', 'TIENDA_NO_DISPONIBLE');
RESET ROLE;
ROLLBACK TO s_caja_inactiva;

\echo '── 146: corrección administrativa'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar')$q$, pg_temp.n('v1', 'orden_id')), '146-120 la cajera no corrige ventas', '42501');
SELECT pg_temp.como(2);
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar')$q$, pg_temp.n('v1', 'orden_id')), '146-121 Ventas central tampoco', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'x', 'Reintegrar')$q$, pg_temp.n('v1', 'orden_id')), '146-122 sin motivo: rechazada', '22023', '%motivo%', 'MOTIVO_REQUERIDO');
SELECT pg_temp.falla($q$SELECT corregir_venta_tienda(pg_temp.op(200), 14691, 'El cliente devolvió todo', 'Reintegrar', 'CF-146-C1')$q$, '146-123 una venta central no se corrige por aquí', '22023', '%', 'NO_ES_VENTA_DE_TIENDA');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar', NULL, NULL, 'electronico')$q$, pg_temp.n('v1', 'orden_id')),
  '146-124 una venta cobrada en efectivo no se reembolsa "a tarjeta"', '22023', '%', 'MEDIO_NO_CORRESPONDE');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar', 'CF-146-TY', NULL, 'efectivo_administracion')$q$, pg_temp.n('v1', 'orden_id')),
  '146-125 el producto no se reintegra al congelador de otra tienda', '22023', '%', 'CUARTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, %s)$q$, pg_temp.n('v1', 'orden_id'), pg_temp.n('t3', 'turno_id')),
  '146-126 el efectivo no sale de la caja de OTRA tienda', '22023', '%', 'TURNO_REEMBOLSO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, NULL)$q$, pg_temp.n('v1', 'orden_id')),
  '146-127 "ya salió de una caja" exige decir de cuál', '22023', '%', 'TURNO_REEMBOLSO_INVALIDO');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(200), %s, 'El cliente devolvió todo', 'Reintegrar', NULL, '[{"sku": "P146-A", "cantidad": 3}]'::jsonb)$q$, pg_temp.n('v1', 'orden_id')),
  '146-128 no se devuelve más de lo vendido (regla del contrato de devoluciones)', '22023', '%máximo 2%');
INSERT INTO t146 VALUES ('h2', to_jsonb(pg_temp.q(format($q$SELECT md5(string_agg(concat_ws(':', id, orden_id, monto, metodo_pago, referencia, fecha), '|' ORDER BY id)) FROM pagos$q$))));
-- C1: venta en efectivo, devolución total, el efectivo YA salió del cajón del turno 1.
INSERT INTO t146 VALUES ('c1', corregir_venta_tienda(pg_temp.op(201), pg_temp.n('v1', 'orden_id'), 'El cliente devolvió todo', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('t1', 'turno_id')));
SELECT pg_temp.ok((pg_temp.j('c1') ->> 'total_devuelto')::numeric = 150 AND pg_temp.j('c1') -> 'reembolso' ->> 'estado' = 'ejecutado' AND (pg_temp.j('c1') -> 'reembolso' -> 'dinero_devuelto')::boolean
  AND (pg_temp.j('c1') -> 'reembolso' ->> 'monto')::numeric = 150 AND (pg_temp.j('c1') -> 'reembolso' ->> 'turno_id')::bigint = pg_temp.n('t1', 'turno_id')
  AND pg_temp.j('c1') ->> 'cuarto_id' = 'CF-146-TX' AND pg_temp.inv() = '94|9|7|2|7 B=4',
  '146-129 corrección total en efectivo desde la caja: el producto vuelve al congelador del que salió y el reembolso queda EJECUTADO contra ese turno');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(total), sum(reembolso), min(disposicion), min(cuarto_destino)) FROM devoluciones WHERE orden_id = %s$q$, pg_temp.n('v1', 'orden_id'))) = '1|150.00|150.00|Reintegrar|CF-146-TX'
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(monto)) FROM movimientos_contables WHERE orden_id = %s AND tipo = 'Egreso' AND categoria = 'Devoluciones'$q$, pg_temp.n('v1', 'orden_id'))) = '1|150.00'
  AND pg_temp.q(format($q$SELECT concat_ws('|', tiene_devolucion, estatus) FROM ordenes WHERE id = %s$q$, pg_temp.n('v1', 'orden_id'))) = 't|Entregada'
  AND pg_temp.q(format($q$SELECT concat_ws('|', turno_venta_id, establecimiento_id, reembolso_medio, reembolso_estado, reembolso_turno_id, actor_id) FROM correcciones_venta_tienda WHERE orden_id = %s$q$, pg_temp.n('v1', 'orden_id')))
      = concat_ws('|', pg_temp.n('t1', 'turno_id'), pg_temp.n('texx'), 'efectivo_caja', 'ejecutado', pg_temp.n('t1', 'turno_id'), 14601),
  '146-130 trazabilidad completa: devolución, egreso contable, venta original, turno de la venta, caja de la que salió el dinero, motivo y actor');
SELECT pg_temp.ok((SELECT r -> 'replay' = 'true'::jsonb AND (r ->> 'correccion_id')::bigint = pg_temp.n('c1', 'correccion_id')
                     FROM (SELECT corregir_venta_tienda(pg_temp.op(201), pg_temp.n('v1', 'orden_id'), 'El cliente devolvió todo', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('t1', 'turno_id')) r) q)
  AND pg_temp.q('SELECT count(*) FROM devoluciones') = '1' AND pg_temp.inv() = '94|9|7|2|7 B=4',
  '146-131 reintento de la corrección (mismo operacion_id): la misma respuesta, sin segunda devolución ni segundo reingreso');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(202), %s, 'Otra vez la misma venta', 'Merma')$q$, pg_temp.n('v1', 'orden_id')), '146-132 una venta tiene una sola corrección', '22023', '%', 'YA_CORREGIDA');
-- C2: venta con tarjeta → reembolso electrónico: solo REGISTRADO hasta confirmarlo.
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(203), %s, 'Cobro duplicado en terminal', 'Reintegrar', NULL, NULL, 'electronico', true)$q$, pg_temp.n('v2', 'orden_id')),
  '146-133 una devolución a tarjeta NO puede nacer como "dinero ya devuelto"', '22023', '%fuera del sistema%', 'REEMBOLSO_EXTERNO_PENDIENTE');
INSERT INTO t146 VALUES ('c2', corregir_venta_tienda(pg_temp.op(203), pg_temp.n('v2', 'orden_id'), 'Cobro duplicado en terminal', 'Reintegrar', NULL, NULL, 'electronico', false));
SELECT pg_temp.ok(pg_temp.j('c2') -> 'reembolso' ->> 'estado' = 'registrado' AND NOT (pg_temp.j('c2') -> 'reembolso' -> 'dinero_devuelto')::boolean
  AND pg_temp.j('c2') -> 'reembolso' ->> 'pendiente' LIKE '%terminal o en el banco%' AND (pg_temp.j('c2') -> 'reembolso' ->> 'monto')::numeric = 50
  AND pg_temp.q(format($q$SELECT concat_ws('|', reembolso_estado, reembolso_ejecutado_at IS NULL, reembolso_turno_id IS NULL) FROM correcciones_venta_tienda WHERE orden_id = %s$q$, pg_temp.n('v2', 'orden_id'))) = 'registrado|t|t'
  AND pg_temp.inv() = '94|9|9|2|7 B=4',
  '146-134 reembolso electrónico: queda REGISTRADO (se debe), el sistema dice que falta hacerlo en la terminal o el banco y NO afirma que el dinero se devolvió');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(204), %s)$q$, pg_temp.n('c2', 'correccion_id')), '146-135 confirmarlo exige la referencia del banco o la terminal', '22023', '%referencia%', 'REFERENCIA_REQUERIDA');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(204), %s, 'DEV-778899')$q$, pg_temp.n('c2', 'correccion_id')), '146-136 la cajera no confirma reembolsos', '42501');
SELECT pg_temp.como(11);
INSERT INTO t146 VALUES ('c2e', confirmar_reembolso_tienda(pg_temp.op(204), pg_temp.n('c2', 'correccion_id'), 'DEV-778899'));
SELECT pg_temp.ok(pg_temp.j('c2e') ->> 'estado' = 'ejecutado' AND (pg_temp.j('c2e') -> 'dinero_devuelto')::boolean AND pg_temp.j('c2e') ->> 'referencia' = 'DEV-778899'
  AND pg_temp.q(format($q$SELECT concat_ws('|', reembolso_estado, reembolso_referencia, reembolso_ejecutado_por LIKE '%%Admin dos%%', reembolso_turno_id IS NULL, resultado -> 'reembolso' ->> 'estado') FROM correcciones_venta_tienda WHERE id = %s$q$, pg_temp.n('c2', 'correccion_id')))
      = 'ejecutado|DEV-778899|t|t|ejecutado',
  '146-137 con la referencia, otro Admin lo marca EJECUTADO: queda quién, cuándo y con qué referencia');
SELECT pg_temp.ok((confirmar_reembolso_tienda(pg_temp.op(204), pg_temp.n('c2', 'correccion_id'), 'DEV-778899') -> 'replay')::boolean, '146-138 reintento de la confirmación: misma respuesta');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(205), %s, 'OTRA-REF')$q$, pg_temp.n('c2', 'correccion_id')), '146-139 un reembolso ya ejecutado no se confirma dos veces', '22023', '%', 'REEMBOLSO_NO_PENDIENTE');
-- C3: devolución parcial como merma, efectivo de Administración pendiente de entregar.
SELECT pg_temp.como(1);
INSERT INTO t146 VALUES ('c3', corregir_venta_tienda(pg_temp.op(206), pg_temp.n('v3', 'orden_id'), 'Una bolsa salió rota', 'Merma', NULL, '[{"sku": "P146-A", "cantidad": 1}]'::jsonb, 'efectivo_administracion', false));
SELECT pg_temp.ok((pg_temp.j('c3') ->> 'total_devuelto')::numeric = 30 AND pg_temp.j('c3') -> 'reembolso' ->> 'estado' = 'registrado' AND pg_temp.j('c3') -> 'reembolso' ->> 'pendiente' LIKE '%entregar el efectivo%'
  AND pg_temp.inv() = '94|9|9|2|7 B=4', '146-140 devolución parcial como merma: no reingresa producto; el efectivo de Administración queda REGISTRADO hasta entregarlo');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(207), %s, NULL, %s)$q$, pg_temp.n('c3', 'correccion_id'), pg_temp.n('t1', 'turno_id')), '146-141 ese reembolso no sale de una caja', '22023', '%no sale de una caja%');
SELECT pg_temp.ok(confirmar_reembolso_tienda(pg_temp.op(207), pg_temp.n('c3', 'correccion_id')) ->> 'estado' = 'ejecutado', '146-142 al entregarlo, Admin lo confirma (sin referencia: es efectivo)');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT md5(string_agg(concat_ws(':', id, orden_id, monto, metodo_pago, referencia, fecha), '|' ORDER BY id)) FROM pagos$q$)) = pg_temp.j('h2') #>> '{}',
  '146-143 las tres correcciones NO modificaron ningún pago histórico');

\echo '── 146: cierre de turno'
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(300), %s, 560)$q$, pg_temp.n('t1', 'turno_id')), '146-150 un cajero no cierra el turno de otro', '42501');
SELECT pg_temp.como(2);
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(300), %s, 560)$q$, pg_temp.n('t1', 'turno_id')), '146-151 Ventas central no cierra turnos', '42501');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(300), %s, -5)$q$, pg_temp.n('t1', 'turno_id')), '146-152 efectivo contado negativo: rechazado', '22023', '%', 'CONTADO_INVALIDO');
-- Turno 1: fondo 500 + efectivo cobrado 210 (150 + 60) − reembolso que salió de esta caja 150 = 560. La tarjeta (50) no es efectivo.
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(300), %s, 710)$q$, pg_temp.n('t1', 'turno_id')), '146-153 si lo contado no coincide, pide motivo', '22023', '%no coincide%', 'MOTIVO_DIFERENCIA');
SELECT pg_temp.ok(pg_temp.detalle(format($q$SELECT cerrar_turno_caja(pg_temp.op(300), %s, 710)$q$, pg_temp.n('t1', 'turno_id'))) !~ '560|150|710|[0-9]{2,}',
  '146-154 …sin decir cuánto se esperaba ni cuánto falta (el conteo es a ciegas)');
INSERT INTO t146 VALUES ('z1', cerrar_turno_caja(pg_temp.op(300), pg_temp.n('t1', 'turno_id'), 560));
SELECT pg_temp.ok(pg_temp.j('z1') ->> 'estado' = 'cerrado' AND (pg_temp.j('z1') ->> 'efectivo_esperado')::numeric = 560 AND (pg_temp.j('z1') ->> 'diferencia')::numeric = 0
  AND pg_temp.j('z1') -> 'totales' = jsonb_build_object('fondo_inicial', 500.00, 'ventas', 3, 'total_vendido', 260.00, 'cobrado_por_metodo', '{"Efectivo": 210.00, "Tarjeta (terminal)": 50.00}'::jsonb,
                                                           'cobrado_efectivo', 210.00, 'reembolsos_efectivo_caja', 150.00, 'correcciones_de_sus_ventas', 3),
  '146-155 cierre del turno 1: esperado = fondo 500 + efectivo 210 − reembolso de caja 150 = 560; totales por forma de pago desde los pagos reales');
SELECT pg_temp.ok((cerrar_turno_caja(pg_temp.op(300), pg_temp.n('t1', 'turno_id'), 560) -> 'replay')::boolean AND pg_temp.q('SELECT count(*) FROM turnos_caja_eventos WHERE tipo = ''cierre''') = '1',
  '146-156 reintento del cierre: misma respuesta, un solo cierre');
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(301), %s, 560)$q$, pg_temp.n('t1', 'turno_id')), '146-157 un turno cerrado no se cierra otra vez', '22023', '%ya está cerrado%', 'TURNO_CERRADO');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(120), %s, '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('t1', 'turno_id')),
  '146-158 no se vende en un turno cerrado', '22023', '%ya está cerrado%', 'TURNO_CERRADO');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT md5(string_agg(concat_ws(':', id, orden_id, monto, metodo_pago, referencia, fecha), '|' ORDER BY id)) FROM pagos$q$)) = pg_temp.j('h2') #>> '{}'
  AND mi_turno_caja() -> 'turno' = 'null'::jsonb, '146-159 el cierre no tocó ningún pago; la cajera ya no tiene turno abierto');
RESET ROLE;
SELECT pg_temp.falla(format($q$INSERT INTO ordenes (folio, cliente_nombre, productos, total, estatus, tipo_cobro, establecimiento_id, turno_id, fecha) VALUES ('OV-T146C', 'x', 'x', 1, 'Creada', 'Contado', %s, %s, CURRENT_DATE)$q$, pg_temp.n('texx'), pg_temp.n('t1', 'turno_id')),
  '146-160 ni una sesión de confianza registra una venta en un turno cerrado (guarda de la tabla)', '22023', '%turno cerrado%', 'TURNO_CERRADO');
SET LOCAL ROLE authenticated;
-- Turno 3 (tienda Y): con diferencia y motivo.
SELECT pg_temp.como(8);
INSERT INTO t146 VALUES ('z3', cerrar_turno_caja(pg_temp.op(302), pg_temp.n('t3', 'turno_id'), 180, 'Faltaron 10 pesos de cambio'));
SELECT pg_temp.ok((pg_temp.j('z3') ->> 'efectivo_esperado')::numeric = 190 AND (pg_temp.j('z3') ->> 'diferencia')::numeric = -10 AND pg_temp.j('z3') ->> 'motivo_diferencia' = 'Faltaron 10 pesos de cambio',
  '146-161 cierre con faltante: se guarda lo contado, la diferencia (−10) y su motivo');
-- Turno 2: lo cierra Administración.
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT cerrar_turno_caja(pg_temp.op(303), %s, 0)$q$, pg_temp.n('t2', 'turno_id')), '146-162 Admin puede cerrar el turno de otra persona, pero debe escribir por qué', '22023', '%por qué%', 'NOTAS_REQUERIDAS');
INSERT INTO t146 VALUES ('z2', cerrar_turno_caja(pg_temp.op(303), pg_temp.n('t2', 'turno_id'), 0, NULL, 'El cajero se retiró sin cerrar'));
SELECT pg_temp.ok((pg_temp.j('z2') ->> 'efectivo_esperado')::numeric = 0 AND pg_temp.j('z2') -> 'totales' -> 'cobrado_por_metodo' = '{"Transferencia SPEI": 90.00}'::jsonb
  AND pg_temp.q(format($q$SELECT concat_ws('|', cerrado_por, notas_cierre) FROM turnos_caja WHERE id = %s$q$, pg_temp.n('t2', 'turno_id'))) = '14601|El cajero se retiró sin cerrar',
  '146-163 cierre administrativo: una venta por transferencia no suma efectivo esperado; queda quién cerró y por qué');

\echo '── 146: reapertura (solo Administración)'
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(400), %s, 'Me equivoqué al contar')$q$, pg_temp.n('t1', 'turno_id')), '146-170 la cajera no reabre su turno', '42501');
INSERT INTO t146 VALUES ('t4', abrir_turno_caja(pg_temp.op(8), pg_temp.n('x2', 'id'), 50));          -- la cajera 6 abre un turno nuevo en la caja 2
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(400), %s, 'x')$q$, pg_temp.n('t1', 'turno_id')), '146-171 reabrir exige motivo', '22023', '%motivo%', 'MOTIVO_REQUERIDO');
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(400), %s, 'Faltó registrar una venta')$q$, pg_temp.n('t1', 'turno_id')),
  '146-172 no se reabre si el cajero ya tiene otro turno abierto', '22023', '%el cajero tiene otro turno%', 'CAJERO_CON_TURNO');
SELECT pg_temp.como(6);  INSERT INTO t146 VALUES ('z4', cerrar_turno_caja(pg_temp.op(304), pg_temp.n('t4', 'turno_id'), 50));
SELECT pg_temp.como(7);  INSERT INTO t146 VALUES ('t5', abrir_turno_caja(pg_temp.op(9), pg_temp.n('x1', 'id'), 0));           -- otro cajero ocupa la caja 1
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(400), %s, 'Faltó registrar una venta')$q$, pg_temp.n('t1', 'turno_id')),
  '146-173 no se reabre si la caja ya tiene otro turno abierto', '22023', '%la caja tiene otro turno%', 'CAJA_OCUPADA');
SELECT pg_temp.como(7);  INSERT INTO t146 VALUES ('z5', cerrar_turno_caja(pg_temp.op(305), pg_temp.n('t5', 'turno_id'), 0));
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(400), %s, 'Faltó registrar una venta')$q$, pg_temp.n('t6', 'turno_id')), '146-174 un turno abierto no se "reabre"', '22023', '%', 'TURNO_ABIERTO');
INSERT INTO t146 VALUES ('r1', reabrir_turno_caja(pg_temp.op(400), pg_temp.n('t1', 'turno_id'), 'Faltó registrar una venta'));
SELECT pg_temp.ok(pg_temp.j('r1') ->> 'estado' = 'abierto' AND (pg_temp.j('r1') ->> 'reaperturas')::int = 1
  AND (pg_temp.j('r1') -> 'cierre_anterior' ->> 'efectivo_contado')::numeric = 560 AND (pg_temp.j('r1') -> 'cierre_anterior' -> 'totales' ->> 'ventas')::int = 3
  AND pg_temp.q(format($q$SELECT concat_ws('|', estado, cerrado_at IS NULL, efectivo_contado IS NULL, reaperturas) FROM turnos_caja WHERE id = %s$q$, pg_temp.n('t1', 'turno_id'))) = 'abierto|t|t|1'
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), string_agg(tipo, ',' ORDER BY id)) FROM turnos_caja_eventos WHERE turno_id = %s$q$, pg_temp.n('t1', 'turno_id'))) = '3|apertura,cierre,reapertura',
  '146-175 Admin reabre con motivo: el cierre anterior queda completo en la historia (no se pierde) y el turno vuelve a estar abierto');
SELECT pg_temp.ok((reabrir_turno_caja(pg_temp.op(400), pg_temp.n('t1', 'turno_id'), 'Faltó registrar una venta') -> 'replay')::boolean, '146-176 reintento de la reapertura: misma respuesta');
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(10), %s, 0)$q$, pg_temp.n('x1', 'id')), '146-177 con el turno reabierto, nadie más abre esa caja', '22023', '%', 'CAJA_OCUPADA');
SELECT pg_temp.como(6);
INSERT INTO t146 VALUES ('v7', vender_en_tienda(pg_temp.op(121), pg_temp.n('t1', 'turno_id'), '[{"sku": "P146-A", "cantidad": 1, "cuarto_id": "CF-146-TX"}]'::jsonb, 'Efectivo'));
INSERT INTO t146 VALUES ('z1b', cerrar_turno_caja(pg_temp.op(306), pg_temp.n('t1', 'turno_id'), 590));
SELECT pg_temp.ok((pg_temp.j('z1b') ->> 'efectivo_esperado')::numeric = 590 AND (pg_temp.j('z1b') -> 'totales' ->> 'ventas')::int = 4 AND (pg_temp.j('z1b') ->> 'diferencia')::numeric = 0,
  '146-178 la cajera registra la venta que faltaba y vuelve a cerrar: el esperado se recalcula con TODAS las operaciones del turno (560 + 30 = 590)');
-- El cajero que deja la tienda: su turno cerrado no se reabre.
RESET ROLE;
SAVEPOINT s_cajero_fuera;
DELETE FROM usuario_establecimientos WHERE usuario_id = 14608;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT reabrir_turno_caja(pg_temp.op(401), %s, 'Revisar el faltante')$q$, pg_temp.n('t3', 'turno_id')),
  '146-179 no se reabre el turno de un cajero que ya no trabaja en esa tienda', '22023', '%ya no trabaja%', 'CAJERO_NO_DISPONIBLE');
RESET ROLE;
ROLLBACK TO s_cajero_fuera;

\echo '── 146: superficie — el Empleado y los perfiles centrales frente a los 8 contratos'
SET LOCAL ROLE authenticated;
DO $$
DECLARE f TEXT; n INTEGER; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH n IN ARRAY ARRAY[2, 3, 4, 5] LOOP
    PERFORM pg_temp.como(n);
    FOREACH f IN ARRAY ARRAY['SELECT guardar_caja(NULL, NULL, NULL, NULL)', 'SELECT abrir_turno_caja(NULL, NULL, NULL)', 'SELECT vender_en_tienda(NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
                             'SELECT cerrar_turno_caja(NULL, NULL, NULL, NULL, NULL)', 'SELECT reabrir_turno_caja(NULL, NULL, NULL)',
                             'SELECT corregir_venta_tienda(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)', 'SELECT confirmar_reembolso_tienda(NULL, NULL, NULL, NULL)', 'SELECT mi_turno_caja()'] LOOP
      v_state := NULL;
      BEGIN EXECUTE f; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
      IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (n || ': ' || f || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 146-180 %', v_mal; END IF;
  RAISE NOTICE 'OK: 146-180 Ventas central, Producción, Chofer y Empleado: los 8 contratos del POS responden "no autorizado" (42501)';
END $$;
SELECT pg_temp.como(6);
DO $$
DECLARE f TEXT; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH f IN ARRAY ARRAY['SELECT guardar_caja(NULL, NULL, NULL, NULL)', 'SELECT abrir_turno_caja(NULL, NULL, NULL)', 'SELECT vender_en_tienda(NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
                           'SELECT cerrar_turno_caja(NULL, NULL, NULL, NULL, NULL)', 'SELECT reabrir_turno_caja(NULL, NULL, NULL)',
                           'SELECT corregir_venta_tienda(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)', 'SELECT confirmar_reembolso_tienda(NULL, NULL, NULL, NULL)'] LOOP
    v_state := NULL;
    BEGIN EXECUTE f; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (f || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 146-181 %', v_mal; END IF;
  RAISE NOTICE 'OK: 146-181 el usuario de tienda sin caja ni turno propios (argumentos vacíos) tampoco obtiene nada de los 7 contratos de escritura';
END $$;
RESET ROLE;

\echo '── 146: invariantes finales'
SELECT pg_temp.ok(pg_temp.inv() = '94|9|8|2|7 B=4', '146-190 existencias finales: CEDIS 94, fábrica 9, X uno 8, X dos 2, Y 7; P146-B en X uno 4');
SELECT pg_temp.ok((SELECT bool_and(x.final = x.inicial + x.neto) FROM (
    SELECT c.id, COALESCE((c.stock ->> 'P146-A')::int, 0) AS final,
           CASE c.id WHEN 'CF-146-C1' THEN 100 WHEN 'CF-146-TX2' THEN 3 ELSE 10 END AS inicial,
           COALESCE((SELECT sum(CASE WHEN i.tipo = 'Salida' THEN -i.cantidad ELSE i.cantidad END) FROM inventario_mov i WHERE i.producto = 'P146-A' AND i.cuarto_id = c.id), 0) AS neto
      FROM cuartos_frios c WHERE c.id LIKE 'CF-146-%') x),
  '146-191 en cada cuarto, existencia final = inicial + kardex (nada se movió sin registro)');
SELECT pg_temp.ok((SELECT count(*) = 7 AND bool_and(o.estatus = 'Entregada' AND o.tipo_cobro = 'Contado' AND o.establecimiento_id = t.establecimiento_id AND o.vendedor_id = t.cajero_id
                            AND (SELECT COALESCE(sum(p.monto), 0) FROM pagos p WHERE p.orden_id = o.id) = o.total
                            AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar x WHERE x.orden_id = o.id)
                            AND EXISTS (SELECT 1 FROM ventas_tienda v WHERE v.orden_id = o.id AND v.turno_id = o.turno_id))
                     FROM ordenes o JOIN turnos_caja t ON t.id = o.turno_id),
  '146-192 las 7 ventas de tienda: Entregadas, de contado, pagadas completas, sin CxC, del establecimiento y del cajero de su turno, con su registro de venta');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM turnos_caja WHERE estado = 'abierto' AND id NOT IN (pg_temp.n('t6', 'turno_id'), pg_temp.n('t7', 'turno_id')))
  AND (SELECT count(*) = 0 FROM (SELECT caja_id FROM turnos_caja WHERE estado = 'abierto' GROUP BY 1 HAVING count(*) > 1) d)
  AND (SELECT count(*) = 0 FROM (SELECT cajero_id FROM turnos_caja WHERE estado = 'abierto' GROUP BY 1 HAVING count(*) > 1) d),
  '146-193 nunca hubo dos turnos abiertos en una caja ni para un cajero');
SELECT pg_temp.ok((SELECT count(*) = 11 AND bool_and(pg_get_functiondef(p.oid) !~* 'cierres_diarios|cerrar_caja_ruta|cuentas_por_cobrar|crear_cxc|abonar_cxc')
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guardar_caja', 'abrir_turno_caja', 'vender_en_tienda', 'cerrar_turno_caja',
                       'reabrir_turno_caja', 'corregir_venta_tienda', 'confirmar_reembolso_tienda', 'mi_turno_caja', 'turno_caja_totales', 'pos_evento_replay', 'pos_es_admin')),
  '146-194 ningún contrato del POS toca la caja diaria de rutas (cierres_diarios) ni escribe crédito o CxC');
ROLLBACK;
