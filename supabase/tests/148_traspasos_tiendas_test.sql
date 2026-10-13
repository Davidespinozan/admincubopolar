-- 148_traspasos_tiendas_test.sql — Tiendas propias, E7: tiendas remotas, traspasos con tránsito
-- (crear, despachar, recibir, cancelar, retornar, incidencias), permiso de recepción y protección
-- del último cajero. Escenario aislado y solo local: el interruptor se enciende DENTRO de la
-- transacción y todo se deshace con ROLLBACK. (Carreras con dos conexiones: c148_concurrencia.mjs.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t148.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
CREATE TEMP TABLE t148 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t148 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t148 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.n(p_k TEXT, p_campo TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT CASE WHEN p_campo IS NULL THEN (v #>> '{}')::bigint ELSE (v ->> p_campo)::bigint END FROM t148 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t148' FROM generate_series(1, 10) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14801, 'Admin T148',              'u1@t148',  'Admin',      'Activo', '14800000-0000-0000-0000-000000000001'),
  (14802, 'Ventas central T148',     'u2@t148',  'Ventas',     'Activo', '14800000-0000-0000-0000-000000000002'),
  (14803, 'Produccion T148',         'u3@t148',  'Producción', 'Activo', '14800000-0000-0000-0000-000000000003'),
  (14804, 'Chofer T148',             'u4@t148',  'Chofer',     'Activo', '14800000-0000-0000-0000-000000000004'),
  (14805, 'Empleado T148',           'u5@t148',  'Empleado',   'Activo', '14800000-0000-0000-0000-000000000005'),
  (14806, 'Cajera A recibe T148',    'u6@t148',  'Ventas',     'Activo', '14800000-0000-0000-0000-000000000006'),
  (14807, 'Cajero A no recibe T148', 'u7@t148',  'Ventas',     'Activo', '14800000-0000-0000-0000-000000000007'),
  (14808, 'Cajera B recibe T148',    'u8@t148',  'Ventas',     'Activo', '14800000-0000-0000-0000-000000000008'),
  (14809, 'Cajera fabrica T148',     'u9@t148',  'Ventas',     'Activo', '14800000-0000-0000-0000-000000000009'),
  (14810, 'Admin dos T148',          'u10@t148', 'Admin',      'Activo', '14800000-0000-0000-0000-000000000010');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P148-A', 'Hielo A148', 'Producto Terminado', 30, 0, 0), ('P148-B', 'Hielo B148', 'Producto Terminado', 90, 0, 0), ('E148-X', 'Bolsa 148', 'Empaque', 2, 0, 1);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-148-C1', 'Cuarto CEDIS 148', '{"P148-A": 100, "P148-B": 20}'), ('CF-148-C2', 'Cuarto CEDIS dos 148', '{}');
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (14801, 'R-14801', 'ruta 148', 14804, 'Chofer T148', 'Pendiente firma', CURRENT_DATE, '{"P148-A": 20}', '{"P148-A": 20}', '{}', '{"P148-A": 20}', now());
SET LOCAL session_replication_role = origin;
-- El dueño enciende el interruptor (SQL), como en producción.
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 148 (dueño, SQL)';

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
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"14800000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14800000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.q(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
-- Existencia A/B: CEDIS uno | tienda A | tienda B | fábrica
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(COALESCE(stock ->> 'P148-A', '0') || '/' || COALESCE(stock ->> 'P148-B', '0'), ' | ' ORDER BY id)
    FROM public.cuartos_frios WHERE id IN ('CF-148-C1', 'CF-148-RA', 'CF-148-RB', 'CF-148-TF') $$;
-- Lo que un traspaso NO debe tocar: rutas, órdenes, líneas, pagos, CxC, contabilidad, comodatos, mermas.
CREATE OR REPLACE FUNCTION pg_temp.ajeno() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.rutas), (SELECT count(*) FROM public.ordenes), (SELECT count(*) FROM public.orden_lineas), (SELECT count(*) FROM public.pagos),
                   (SELECT count(*) FROM public.cuentas_por_cobrar), (SELECT count(*) FROM public.movimientos_contables), (SELECT count(*) FROM public.comodatos), (SELECT count(*) FROM public.mermas),
                   (SELECT COALESCE(sum(saldo), 0) FROM public.clientes)) $$;
CREATE OR REPLACE FUNCTION pg_temp.linea(p_k TEXT, p_sku TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('/', l.value ->> 'cantidad', l.value ->> 'despachada', l.value ->> 'recibida', l.value ->> 'danada', l.value ->> 'faltante')
    FROM jsonb_array_elements(pg_temp.j(p_k) -> 'lineas') l WHERE l.value ->> 'sku' = p_sku $$;

\echo '── 148: catálogo'
SELECT pg_temp.ok(current_setting('t148.apagado_al_inicio')::boolean, '148-01 el interruptor global estaba APAGADO al empezar (148 no lo toca)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.tienda_checklist(bigint)'::regprocedure)) = 'e82e731dfb92f198af09515be6977c3f'
  AND md5(pg_get_functiondef('public.retirar_usuario_tienda(bigint,bigint,boolean)'::regprocedure)) = 'dd831c01be1739380348d10ee260bd58'
  AND md5(pg_get_functiondef('public.guardar_establecimiento(bigint,text,text,text)'::regprocedure)) = '1ea7cfabf6fe2a9ccc0550db21ae60ca'
  AND to_regprocedure('public.guardar_establecimiento(bigint,text,text)') IS NULL,
  '148-02 los tres contratos de E6 ajustados son los de 148; guardar_establecimiento existe en UNA sola versión (con p_tipo opcional)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure)) = '3591d07446854c4a682cd41f88489ec6'
  AND md5(pg_get_functiondef('public.traspaso_cuartos(uuid,text,text,text,integer)'::regprocedure)) = 'f73c7272614080b951bfc3d813f8dff4'
  AND md5(pg_get_functiondef('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure)) = '50ce141b71b2692a015a1cd77e780fec'
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = 'e1a9770e1bc5cebd7f565c9cfdc2a880'
  AND (SELECT pg_get_constraintdef(oid) NOT LIKE '%traspaso_transito%' FROM pg_constraint WHERE conname = 'stock_operaciones_tipo_check'),
  '148-03 NO cambian: kardex, traspaso directo (144), carga de ruta, venta directa, identidad ni el catálogo de tipos de operación');
SELECT pg_temp.ok((SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND NOT has_table_privilege('authenticated', c.oid, 'SELECT') AND NOT has_table_privilege('authenticated', c.oid, 'INSERT')
                            AND NOT has_table_privilege('anon', c.oid, 'SELECT'))
                     FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('traspasos', 'traspaso_lineas', 'traspaso_eventos'))
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('traspasos', 'traspaso_lineas', 'traspaso_eventos')),
  '148-04 las 3 tablas de traspasos: RLS activa, sin policies y sin NINGÚN acceso por REST (ni lectura): todo por contrato');
SELECT pg_temp.ok((SELECT count(*) = 9 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guardar_establecimiento', 'definir_recepcion_tienda', 'crear_traspaso', 'despachar_traspaso',
                       'recibir_traspaso', 'cancelar_traspaso', 'retornar_traspaso', 'cerrar_incidencia_traspaso', 'traspasos_consulta'))
  AND (SELECT count(*) = 5 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('traspaso_replay', 'traspaso_json', 'traspaso_puede_recibir', 'traspaso_leer_recepcion', 'traspasos_guard')),
  '148-05 9 contratos (SECURITY DEFINER, search_path fijo, sin anon) y 5 funciones internas sin exponer');
SELECT pg_temp.ok((SELECT column_default = 'false' AND is_nullable = 'NO' FROM information_schema.columns WHERE table_name = 'usuario_establecimientos' AND column_name = 'recibe_traspasos')
  AND (SELECT count(*) = 3 FROM information_schema.columns WHERE table_name = 'usuario_establecimientos' AND column_name IN ('vende_desde_cedis', 'traspasa_con_cedis', 'recibe_traspasos')),
  '148-06 recibir traspasos es un TERCER permiso, separado de vender desde el CEDIS y de traspasar con el CEDIS; nace apagado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('crear_traspaso', 'despachar_traspaso', 'recibir_traspaso', 'cancelar_traspaso',
                                'retornar_traspaso', 'cerrar_incidencia_traspaso', 'traspaso_json', 'traspaso_leer_recepcion')
                                AND pg_get_functiondef(p.oid) ~* '\m(rutas|ordenes|orden_lineas|pagos|cuentas_por_cobrar|movimientos_contables|comodatos|clientes|current_setting)\M'),
  '148-07 los contratos de traspaso no mencionan rutas, órdenes, pagos, CxC, contabilidad, comodatos ni clientes, y no leen banderas de sesión');

\echo '── 148: tiendas remotas'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TRX148', 'Rara', 'bodega')$q$, '148-10 tipo inválido', '22023', '%', 'TIPO_INVALIDO');
SELECT pg_temp.falla($q$SELECT guardar_establecimiento(NULL, 'TRX148', 'CEDIS dos', 'cedis')$q$, '148-11 no se crea otro CEDIS', '22023', '%', 'TIPO_INVALIDO');
INSERT INTO t148 VALUES ('ra', guardar_establecimiento(NULL, 'TR148A', 'Tienda remota A 148', 'tienda')), ('rb', guardar_establecimiento(NULL, 'TR148B', 'Tienda remota B 148', 'tienda')),
                        ('tf', guardar_establecimiento(NULL, 'TF148', 'Tienda de fábrica 148'));
SELECT pg_temp.ok(pg_temp.j('ra') ->> 'tipo' = 'tienda' AND NOT (pg_temp.j('ra') -> 'activo')::boolean AND pg_temp.j('tf') ->> 'tipo' = 'tienda_fabrica',
  '148-12 Admin crea tiendas remotas (tipo tienda), que nacen inactivas; sin tipo sigue creando una tienda de fábrica, como en E6');
SELECT pg_temp.falla(format($q$SELECT guardar_establecimiento(%s, NULL, 'Tienda remota A 148', 'tienda_fabrica')$q$, pg_temp.n('ra', 'id')), '148-13 el tipo de una tienda no cambia', '22023', '%', 'TIPO_INVALIDO');
SELECT asignar_cuarto_tienda(pg_temp.n('ra', 'id'), 'CF-148-RA', 'Congelador remota A'), agregar_caja_tienda(pg_temp.n('ra', 'id'), 'Caja 1'),
       asignar_cuarto_tienda(pg_temp.n('rb', 'id'), 'CF-148-RB', 'Congelador remota B'), agregar_caja_tienda(pg_temp.n('rb', 'id'), 'Caja 1'),
       asignar_cuarto_tienda(pg_temp.n('tf', 'id'), 'CF-148-TF', 'Congelador fábrica'),  agregar_caja_tienda(pg_temp.n('tf', 'id'), 'Caja 1');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14806, true, false)$q$, pg_temp.n('ra', 'id')), '148-14 en una tienda remota NADIE recibe el permiso de vender desde el CEDIS', '22023', '%', 'PERMISO_NO_CORRESPONDE');
SELECT pg_temp.falla(format($q$SELECT asignar_usuario_tienda(%s, 14803, false, true)$q$, pg_temp.n('ra', 'id')), '148-15 …ni el de traspasar directo con el CEDIS (ese es solo de la tienda de fábrica)', '22023', '%', 'PERMISO_NO_CORRESPONDE');
SELECT asignar_usuario_tienda(pg_temp.n('ra', 'id'), 14806, false, false), asignar_usuario_tienda(pg_temp.n('ra', 'id'), 14807, false, false),
       asignar_usuario_tienda(pg_temp.n('rb', 'id'), 14808, false, false), asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14809, true, false),
       asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14803, false, true);
SELECT pg_temp.ok((estado_tienda(pg_temp.n('ra', 'id')) -> 'lista_para_activar')::boolean
  AND (SELECT (k.value -> 'ok')::boolean AND k.value ->> 'texto' LIKE '%vende solo su inventario%' FROM jsonb_array_elements(estado_tienda(pg_temp.n('ra', 'id')) -> 'verificacion') k WHERE k.value ->> 'clave' = 'tipo'),
  '148-16 la lista de verificación acepta una tienda remota (identidad, congelador, caja y personal propios)');
SELECT activar_tienda(pg_temp.op(1), pg_temp.n('ra', 'id'), true), activar_tienda(pg_temp.op(2), pg_temp.n('rb', 'id'), true), activar_tienda(pg_temp.op(3), pg_temp.n('tf', 'id'), true);
SELECT pg_temp.ok(pg_temp.q($q$SELECT string_agg(clave || ':' || tipo || ':' || activo, ',' ORDER BY clave) FROM establecimientos WHERE clave LIKE '%148%'$q$)
                  = 'TF148:tienda_fabrica:true,TR148A:tienda:true,TR148B:tienda:true', '148-17 tres tiendas activas: dos remotas y una de fábrica');

\echo '── 148: permiso de recibir traspasos'
SELECT pg_temp.falla(format($q$SELECT definir_recepcion_tienda(%s, 14806, NULL)$q$, pg_temp.n('ra', 'id')), '148-20 hay que decir sí o no', '22023', '%', 'PERMISOS_EXPLICITOS');
SELECT pg_temp.falla(format($q$SELECT definir_recepcion_tienda(%s, 14808, true)$q$, pg_temp.n('ra', 'id')), '148-21 solo a quien está asignado a ESA tienda', '22023', '%', 'USUARIO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT definir_recepcion_tienda(%s, 14803, true)$q$, pg_temp.n('tf', 'id')), '148-22 recibir es del personal de la tienda, no de Producción', '22023', '%', 'PERMISO_NO_CORRESPONDE');
SELECT definir_recepcion_tienda(pg_temp.n('ra', 'id'), 14806, true), definir_recepcion_tienda(pg_temp.n('rb', 'id'), 14808, true);
SELECT pg_temp.ok(pg_temp.q($q$SELECT string_agg(usuario_id || ':' || recibe_traspasos || ':' || vende_desde_cedis || ':' || traspasa_con_cedis, ',' ORDER BY usuario_id) FROM usuario_establecimientos WHERE usuario_id BETWEEN 14803 AND 14809$q$)
                  = '14803:false:false:true,14806:true:false:false,14807:false:false:false,14808:true:false:false,14809:false:true:false',
  '148-23 tres permisos independientes: recibir (cajeras 6 y 8), vender desde el CEDIS (solo la de fábrica) y traspasar con el CEDIS (solo Producción en la fábrica)');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT definir_recepcion_tienda(%s, 14807, true)$q$, pg_temp.n('ra', 'id')), '148-24 una cajera no reparte permisos', '42501');
INSERT INTO t148 VALUES ('ajeno0', to_jsonb(pg_temp.ajeno()));

\echo '── 148: [1] traspaso normal CEDIS → tienda'
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(10), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 10}]'::jsonb, ' ')$q$, pg_temp.n('ra', 'id')), '148-30 falta quién lo transporta', '22023', '%', 'RESPONSABLE_REQUERIDO');
INSERT INTO t148 VALUES ('t1', crear_traspaso(pg_temp.op(10), 1, pg_temp.n('ra', 'id'), 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-B", "cantidad": 2}, {"sku": "P148-A", "cantidad": 10}]'::jsonb, '  Luis   Pérez ', 'Abasto semanal'));
SELECT pg_temp.ok(pg_temp.j('t1') ->> 'estado' = 'pendiente' AND pg_temp.j('t1') ->> 'folio' ~ '^TR-[0-9]{4,}$' AND pg_temp.j('t1') ->> 'responsable' = 'Luis Pérez'
  AND pg_temp.j('t1') -> 'origen' ->> 'tipo' = 'cedis' AND pg_temp.j('t1') -> 'destino' ->> 'cuarto_id' = 'CF-148-RA' AND pg_temp.linea('t1', 'P148-A') = '10'
  AND pg_temp.inv() = '100/20 | 0/0 | 0/0 | 0/0',
  '148-31 crear un traspaso: queda PENDIENTE con origen, destino, cuartos, productos y responsable; todavía no mueve nada');
SELECT pg_temp.ok((crear_traspaso(pg_temp.op(10), 1, pg_temp.n('ra', 'id'), 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 10}, {"sku": "P148-B", "cantidad": 2}]'::jsonb, 'Luis Pérez', 'Abasto semanal') -> 'replay')::boolean
  AND pg_temp.q('SELECT count(*) FROM traspasos') = '1', '148-32 reintento de la creación (mismo operacion_id): el mismo traspaso');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(10), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 99}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')), '148-33 el mismo operacion_id con otros datos: rechazado', '23505', '%', 'OPERACION_REPETIDA');
INSERT INTO t148 VALUES ('t1d', despachar_traspaso(pg_temp.op(11), pg_temp.n('t1', 'traspaso_id')));
SELECT pg_temp.ok(pg_temp.j('t1d') ->> 'estado' = 'en_transito' AND pg_temp.linea('t1d', 'P148-A') = '10/10' AND pg_temp.inv() = '90/18 | 0/0 | 0/0 | 0/0'
  AND traspasos_consulta() -> 'en_camino' = '{"P148-A": 10, "P148-B": 2}'::jsonb AND (traspasos_consulta() -> 'resumen' ->> 'en_transito')::int = 1
  AND pg_temp.q(format($q$SELECT string_agg(producto || ':' || cantidad || ':' || cuarto_id || ':' || tipo, ',' ORDER BY producto) FROM inventario_mov WHERE referencia = 'traspaso/%s'$q$, pg_temp.j('t1') ->> 'folio'))
      = 'P148-A:10:CF-148-C1:Traspaso salida,P148-B:2:CF-148-C1:Traspaso salida',
  '148-34 despachar: sale del cuarto de origen (kardex «Traspaso salida») y queda EN TRÁNSITO; el destino todavía NO sube; el producto en camino se puede consultar');
SELECT pg_temp.como(6);
INSERT INTO t148 VALUES ('t1r', recibir_traspaso(pg_temp.op(12), pg_temp.n('t1', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 10}, {"sku": "P148-B", "recibida": 2, "danada": 0}]'::jsonb));
SELECT pg_temp.ok(pg_temp.j('t1r') ->> 'estado' = 'recibido' AND NOT (pg_temp.j('t1r') -> 'incidencia')::boolean AND pg_temp.linea('t1r', 'P148-A') = '10/10/10/0/0'
  AND pg_temp.j('t1r') ->> 'recibido_por' LIKE '%Cajera A recibe%' AND pg_temp.inv() = '90/18 | 10/2 | 0/0 | 0/0'
  AND pg_temp.q(format($q$SELECT string_agg(producto || ':' || cantidad || ':' || cuarto_id, ',' ORDER BY producto) FROM inventario_mov WHERE referencia = 'traspaso/%s' AND tipo = 'Traspaso entrada'$q$, pg_temp.j('t1') ->> 'folio'))
      = 'P148-A:10:CF-148-RA,P148-B:2:CF-148-RA',
  '148-35 recibir (la cajera de la tienda, con su permiso): entra al congelador de destino (kardex «Traspaso entrada»); trazabilidad completa de origen a recepción');

\echo '── 148: [2] despacho sin existencia · [3] doble despacho'
SELECT pg_temp.como(1);
INSERT INTO t148 VALUES ('t2', crear_traspaso(pg_temp.op(20), 1, pg_temp.n('ra', 'id'), 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 5}, {"sku": "P148-B", "cantidad": 19}]'::jsonb, 'Luis Pérez'));
SELECT pg_temp.falla(format($q$SELECT despachar_traspaso(pg_temp.op(21), %s)$q$, pg_temp.n('t2', 'traspaso_id')), '148-40 [2] sin existencia suficiente de UN producto no se despacha nada', '22023', '%hay 18, se piden 19%', 'SIN_EXISTENCIA');
SELECT pg_temp.ok(pg_temp.inv() = '90/18 | 10/2 | 0/0 | 0/0' AND pg_temp.q(format('SELECT estado FROM traspasos WHERE id = %s', pg_temp.n('t2', 'traspaso_id'))) = 'pendiente'
  AND pg_temp.q(format($q$SELECT count(*) FROM inventario_mov WHERE referencia = 'traspaso/%s'$q$, pg_temp.j('t2') ->> 'folio')) = '0',
  '148-41 [2] el traspaso sigue pendiente; ni una pieza salió ni quedó kardex');
SELECT pg_temp.ok((despachar_traspaso(pg_temp.op(11), pg_temp.n('t1', 'traspaso_id')) -> 'replay')::boolean AND pg_temp.inv() = '90/18 | 10/2 | 0/0 | 0/0',
  '148-42 [3] reintento del despacho (mismo operacion_id): misma respuesta, sin descontar otra vez');
INSERT INTO t148 VALUES ('t3', crear_traspaso(pg_temp.op(22), 1, pg_temp.n('ra', 'id'), 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 10}, {"sku": "P148-B", "cantidad": 4}]'::jsonb, 'Luis Pérez'));
INSERT INTO t148 VALUES ('t3d', despachar_traspaso(pg_temp.op(23), pg_temp.n('t3', 'traspaso_id')));
SELECT pg_temp.falla(format($q$SELECT despachar_traspaso(pg_temp.op(24), %s)$q$, pg_temp.n('t3', 'traspaso_id')), '148-43 [3] doble despacho (otro operacion_id): rechazado', '22023', '%ya está en_transito%', 'TRASPASO_YA_DESPACHADO');
SELECT pg_temp.ok(pg_temp.inv() = '80/14 | 10/2 | 0/0 | 0/0', '148-44 [3] el producto se descontó UNA sola vez');

\echo '── 148: [5][6] recepción parcial, dañados y faltantes · [4] recepción duplicada'
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(30), %s, '[{"sku": "P148-A", "recibida": 10}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')), '148-50 hay que capturar TODOS los productos del traspaso', '22023', '%', 'RECEPCION_INCOMPLETA');
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(30), %s, '[{"sku": "P148-A", "recibida": 10}, {"sku": "P148-B", "recibida": 4}, {"sku": "E148-X", "recibida": 1}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')), '148-51 …y ninguno que no venga en él', '22023', '%', 'RECEPCION_INCOMPLETA');
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(30), %s, '[{"sku": "P148-A", "recibida": 9, "danada": 2}, {"sku": "P148-B", "recibida": 4}]'::jsonb, 'sobra')$q$, pg_temp.n('t3', 'traspaso_id')), '148-52 no puede llegar más de lo despachado', '22023', '%', 'RECEPCION_EXCEDE');
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(30), %s, '[{"sku": "P148-A", "recibida": -1}, {"sku": "P148-B", "recibida": 4}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')), '148-53 cantidades negativas: rechazadas', '22023', '%', 'CANTIDAD_INVALIDA');
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(30), %s, '[{"sku": "P148-A", "recibida": 7, "danada": 2}, {"sku": "P148-B", "recibida": 4}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')), '148-54 con dañados o faltantes hay que escribir qué pasó', '22023', '%', 'NOTA_INCIDENCIA_REQUERIDA');
INSERT INTO t148 VALUES ('t3r', recibir_traspaso(pg_temp.op(30), pg_temp.n('t3', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 7, "danada": 2}, {"sku": "P148-B", "recibida": 4}]'::jsonb, 'Dos bolsas rotas y falta una'));
SELECT pg_temp.ok(pg_temp.j('t3r') ->> 'estado' = 'recibido' AND (pg_temp.j('t3r') -> 'incidencia')::boolean AND NOT (pg_temp.j('t3r') -> 'incidencia_cerrada')::boolean
  AND pg_temp.linea('t3r', 'P148-A') = '10/10/7/2/1' AND pg_temp.linea('t3r', 'P148-B') = '4/4/4/0/0' AND pg_temp.inv() = '80/14 | 17/6 | 0/0 | 0/0',
  '148-55 [5][6] recepción parcial: de 10 llegaron 7 buenas, 2 dañadas y 1 faltó; SOLO las 7 buenas entran al congelador; queda como incidencia con su nota');
SELECT pg_temp.ok((SELECT bool_and(l.cantidad_recibida + l.cantidad_danada + l.cantidad_faltante = l.cantidad_despachada) FROM (SELECT * FROM pg_temp.q('SELECT 1') x) y,
                    LATERAL (SELECT (e.value ->> 'recibida')::int AS cantidad_recibida, (e.value ->> 'danada')::int AS cantidad_danada, (e.value ->> 'faltante')::int AS cantidad_faltante,
                                    (e.value ->> 'despachada')::int AS cantidad_despachada FROM jsonb_array_elements(pg_temp.j('t3r') -> 'lineas') e) l),
  '148-56 en cada producto: recibido + dañado + faltante = despachado');
SELECT pg_temp.ok((recibir_traspaso(pg_temp.op(30), pg_temp.n('t3', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 7, "danada": 2}, {"sku": "P148-B", "recibida": 4}]'::jsonb, 'Dos bolsas rotas y falta una') -> 'replay')::boolean
  AND pg_temp.inv() = '80/14 | 17/6 | 0/0 | 0/0', '148-57 [4] reintento de la recepción (mismo operacion_id): misma respuesta, sin sumar otra vez');
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(31), %s, '[{"sku": "P148-A", "recibida": 10}, {"sku": "P148-B", "recibida": 4}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')),
  '148-58 [4] recepción duplicada (otro operacion_id): rechazada', '22023', '%solo se recibe uno en tránsito%', 'TRASPASO_NO_EN_TRANSITO');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(32), %s, '[{"sku": "P148-A", "recibida": 10}, {"sku": "P148-B", "recibida": 4}]'::jsonb)$q$, pg_temp.n('t3', 'traspaso_id')),
  '148-59 [4] …también si la intenta Administración', '22023', '%', 'TRASPASO_NO_EN_TRANSITO');
SELECT pg_temp.ok(pg_temp.inv() = '80/14 | 17/6 | 0/0 | 0/0' AND pg_temp.q(format($q$SELECT count(*) FROM inventario_mov WHERE referencia = 'traspaso/%s' AND tipo = 'Traspaso entrada'$q$, pg_temp.j('t3') ->> 'folio')) = '2',
  '148-60 [4] el destino subió UNA sola vez');
-- Incidencias
SELECT pg_temp.ok((traspasos_consulta(NULL, 'incidencias') -> 'traspasos' -> 0 ->> 'folio') = pg_temp.j('t3') ->> 'folio' AND jsonb_array_length(traspasos_consulta(NULL, 'incidencias') -> 'traspasos') = 1
  AND (traspasos_consulta() -> 'resumen' ->> 'incidencias_abiertas')::int = 1, '148-61 la incidencia aparece en la consulta de incidencias');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT cerrar_incidencia_traspaso(pg_temp.op(33), %s, 'Ya quedó')$q$, pg_temp.n('t3', 'traspaso_id')), '148-62 la cajera no cierra incidencias', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT cerrar_incidencia_traspaso(pg_temp.op(33), %s, 'ok')$q$, pg_temp.n('t3', 'traspaso_id')), '148-63 cerrar una incidencia exige decir cómo se resolvió', '22023', '%', 'MOTIVO_REQUERIDO');
INSERT INTO t148 VALUES ('t3i', cerrar_incidencia_traspaso(pg_temp.op(33), pg_temp.n('t3', 'traspaso_id'), 'Se descontó al transportista la bolsa faltante'));
SELECT pg_temp.ok((pg_temp.j('t3i') -> 'incidencia_cerrada')::boolean AND pg_temp.j('t3i') ->> 'incidencia_resolucion' LIKE 'Se descontó%' AND pg_temp.inv() = '80/14 | 17/6 | 0/0 | 0/0'
  AND (traspasos_consulta() -> 'resumen' ->> 'incidencias_abiertas')::int = 0, '148-64 Admin cierra la incidencia: deja constancia y NO mueve inventario');
SELECT pg_temp.falla(format($q$SELECT cerrar_incidencia_traspaso(pg_temp.op(34), %s, 'Otra vez la misma')$q$, pg_temp.n('t3', 'traspaso_id')), '148-65 una incidencia cerrada no se cierra dos veces', '22023', '%', 'SIN_INCIDENCIA');
SELECT pg_temp.falla(format($q$SELECT cerrar_incidencia_traspaso(pg_temp.op(34), %s, 'No tenía incidencia')$q$, pg_temp.n('t1', 'traspaso_id')), '148-66 un traspaso sin incidencia no tiene nada que cerrar', '22023', '%', 'SIN_INCIDENCIA');

\echo '── 148: [7] cancelación antes del despacho · [8] después del despacho'
SELECT pg_temp.falla(format($q$SELECT cancelar_traspaso(pg_temp.op(40), %s, 'no')$q$, pg_temp.n('t2', 'traspaso_id')), '148-70 cancelar exige motivo', '22023', '%', 'MOTIVO_REQUERIDO');
INSERT INTO t148 VALUES ('t2c', cancelar_traspaso(pg_temp.op(40), pg_temp.n('t2', 'traspaso_id'), 'No hay producto suficiente esta semana'));
SELECT pg_temp.ok(pg_temp.j('t2c') ->> 'estado' = 'cancelado' AND pg_temp.j('t2c') ->> 'motivo_cancelacion' LIKE 'No hay producto%' AND pg_temp.inv() = '80/14 | 17/6 | 0/0 | 0/0'
  AND (cancelar_traspaso(pg_temp.op(40), pg_temp.n('t2', 'traspaso_id'), 'No hay producto suficiente esta semana') -> 'replay')::boolean,
  '148-71 [7] un traspaso PENDIENTE se cancela con motivo: no movió ni mueve inventario; idempotente');
SELECT pg_temp.falla(format($q$SELECT despachar_traspaso(pg_temp.op(41), %s)$q$, pg_temp.n('t2', 'traspaso_id')), '148-72 [7] un traspaso cancelado no se despacha', '22023', '%ya está cancelado%', 'TRASPASO_YA_DESPACHADO');
INSERT INTO t148 VALUES ('t4', crear_traspaso(pg_temp.op(42), 1, pg_temp.n('rb', 'id'), 'CF-148-C1', 'CF-148-RB', '[{"sku": "P148-A", "cantidad": 5}]'::jsonb, 'Marta Ruiz'));
SELECT despachar_traspaso(pg_temp.op(43), pg_temp.n('t4', 'traspaso_id'));
SELECT pg_temp.falla(format($q$SELECT cancelar_traspaso(pg_temp.op(44), %s, 'Se descompuso el camión')$q$, pg_temp.n('t4', 'traspaso_id')),
  '148-73 [8] un traspaso YA DESPACHADO no se cancela: el producto ya salió', '22023', '%ya se despachó%', 'TRASPASO_EN_TRANSITO');
SELECT pg_temp.ok(pg_temp.inv() = '75/14 | 17/6 | 0/0 | 0/0' AND pg_temp.q(format('SELECT estado FROM traspasos WHERE id = %s', pg_temp.n('t4', 'traspaso_id'))) = 'en_transito',
  '148-74 [8] el intento de cancelar no devolvió nada "en automático": las 5 piezas siguen fuera del CEDIS y en tránsito');
SELECT pg_temp.como(8);
SELECT pg_temp.falla(format($q$SELECT retornar_traspaso(pg_temp.op(45), %s, '[{"sku": "P148-A", "recibida": 5}]'::jsonb, 'Regresó el camión')$q$, pg_temp.n('t4', 'traspaso_id')), '148-75 [8] la cajera no registra retornos al origen', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT retornar_traspaso(pg_temp.op(45), %s, '[{"sku": "P148-A", "recibida": 5}]'::jsonb, 'x')$q$, pg_temp.n('t4', 'traspaso_id')), '148-76 [8] el retorno exige motivo', '22023', '%', 'MOTIVO_REQUERIDO');
INSERT INTO t148 VALUES ('t4x', retornar_traspaso(pg_temp.op(45), pg_temp.n('t4', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 4, "danada": 1}]'::jsonb, 'Se descompuso el camión; regresó al CEDIS'));
SELECT pg_temp.ok(pg_temp.j('t4x') ->> 'estado' = 'retornado' AND (pg_temp.j('t4x') -> 'incidencia')::boolean AND pg_temp.linea('t4x', 'P148-A') = '5/5/4/1/0' AND pg_temp.inv() = '79/14 | 17/6 | 0/0 | 0/0'
  AND pg_temp.q(format($q$SELECT string_agg(tipo || ':' || cantidad || ':' || cuarto_id, ',' ORDER BY id) FROM inventario_mov WHERE referencia = 'traspaso/%s'$q$, pg_temp.j('t4') ->> 'folio'))
      = 'Traspaso salida:5:CF-148-C1,Traspaso entrada:4:CF-148-C1',
  '148-77 [8] si el producto regresa, se registra su RETORNO físico al cuarto de origen: vuelven las 4 buenas, la dañada queda como incidencia; nada desapareció');
SELECT pg_temp.falla(format($q$SELECT cancelar_traspaso(pg_temp.op(46), %s, 'Ya no aplica')$q$, pg_temp.n('t4', 'traspaso_id')), '148-78 un traspaso retornado ya no se cancela', '22023', '%', 'TRASPASO_CERRADO');
SELECT pg_temp.falla(format($q$SELECT retornar_traspaso(pg_temp.op(47), %s, '[{"sku": "P148-A", "recibida": 5}]'::jsonb, 'Otra vez el mismo')$q$, pg_temp.n('t4', 'traspaso_id')), '148-79 …ni se retorna dos veces', '22023', '%', 'TRASPASO_NO_EN_TRANSITO');
SELECT pg_temp.falla(format($q$SELECT retornar_traspaso(pg_temp.op(47), %s, '[{"sku": "P148-A", "recibida": 10}, {"sku": "P148-B", "recibida": 2}]'::jsonb, 'Ya estaba recibido')$q$, pg_temp.n('t1', 'traspaso_id')), '148-80 un traspaso ya recibido no "regresa" por aquí', '22023', '%', 'TRASPASO_NO_EN_TRANSITO');
-- Devolución tienda → CEDIS: el mismo flujo en sentido contrario.
INSERT INTO t148 VALUES ('t5', crear_traspaso(pg_temp.op(48), pg_temp.n('ra', 'id'), 1, 'CF-148-RA', 'CF-148-C1', '[{"sku": "P148-B", "cantidad": 2}]'::jsonb, 'Luis Pérez', 'Devolución de producto que no se vendió'));
SELECT despachar_traspaso(pg_temp.op(49), pg_temp.n('t5', 'traspaso_id'));
SELECT pg_temp.ok(pg_temp.inv() = '79/14 | 17/4 | 0/0 | 0/0', '148-81 devolución tienda → CEDIS: al despachar sale del congelador de la tienda');
SELECT pg_temp.como(6);
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(50), %s, '[{"sku": "P148-B", "recibida": 2}]'::jsonb)$q$, pg_temp.n('t5', 'traspaso_id')), '148-82 en el CEDIS no recibe el personal de la tienda (aunque sea su traspaso)', '42501');
SELECT pg_temp.como(1);
SELECT recibir_traspaso(pg_temp.op(50), pg_temp.n('t5', 'traspaso_id'), '[{"sku": "P148-B", "recibida": 2}]'::jsonb);
SELECT pg_temp.ok(pg_temp.inv() = '79/16 | 17/4 | 0/0 | 0/0', '148-83 …lo recibe Administración y entra al cuarto del CEDIS');

\echo '── 148: validaciones de un traspaso'
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), %s, %s, 'CF-148-RA', 'CF-148-RB', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id'), pg_temp.n('rb', 'id')),
  '148-90 no hay traspasos de tienda a tienda', '22023', '%', 'TRASPASO_NO_VALIDO');
SELECT pg_temp.falla($q$SELECT crear_traspaso(pg_temp.op(60), 1, 1, 'CF-148-C1', 'CF-148-C2', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, '148-91 …ni dentro del CEDIS (eso es un traspaso directo de 144)', '22023', '%', 'TRASPASO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), 1, %s, 'CF-148-C1', 'CF-148-RB', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')),
  '148-92 el cuarto de destino debe ser de la tienda de destino', '22023', '%', 'CUARTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), 1, %s, 'CF-148-RA', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')),
  '148-93 el cuarto de origen debe ser del establecimiento de origen', '22023', '%', 'CUARTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "E148-X", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')), '148-94 solo producto terminado', '22023', '%', 'PRODUCTO_NO_VENDIBLE');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 0}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')), '148-95 cantidad 0', '22023', '%', 'CANTIDAD_INVALIDA');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(60), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 1}, {"sku": "P148-A", "cantidad": 2}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')), '148-96 producto repetido', '22023', '%', 'CANTIDAD_INVALIDA');
SELECT pg_temp.falla($q$SELECT crear_traspaso(pg_temp.op(60), 1, 99999, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, '148-97 tienda inexistente', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
RESET ROLE;
SELECT pg_temp.falla(format($q$UPDATE traspasos SET estado = 'pendiente', recibido_at = NULL WHERE id = %s$q$, pg_temp.n('t1', 'traspaso_id')), '148-98 ni una sesión de confianza regresa de estado un traspaso recibido', '22023', '%no cambia de estado%');
SELECT pg_temp.falla($q$DELETE FROM traspasos$q$, '148-99 un traspaso no se borra', '42501');
SELECT pg_temp.falla($q$UPDATE traspaso_eventos SET actor = 'otro'$q$, '148-100 su historia no se reescribe', '42501');
SELECT pg_temp.falla(format($q$UPDATE traspaso_lineas SET cantidad = 99 WHERE traspaso_id = %s$q$, pg_temp.n('t1', 'traspaso_id')), '148-101 las cantidades pedidas no cambian', '22023');

\echo '── 148: [12] sin permiso · [13] aislamiento entre tiendas'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t148 VALUES ('t6', crear_traspaso(pg_temp.op(70), 1, pg_temp.n('ra', 'id'), 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 3}]'::jsonb, 'Luis Pérez'));
INSERT INTO t148 VALUES ('t7', crear_traspaso(pg_temp.op(71), 1, pg_temp.n('rb', 'id'), 'CF-148-C1', 'CF-148-RB', '[{"sku": "P148-A", "cantidad": 6}]'::jsonb, 'Marta Ruiz'));
SELECT despachar_traspaso(pg_temp.op(72), pg_temp.n('t6', 'traspaso_id')), despachar_traspaso(pg_temp.op(73), pg_temp.n('t7', 'traspaso_id'));
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(74), %s, '[{"sku": "P148-A", "recibida": 3}]'::jsonb)$q$, pg_temp.n('t6', 'traspaso_id')), '148-110 [12] el cajero de la tienda SIN permiso de recepción no recibe', '42501');
SELECT pg_temp.como(8);
SELECT pg_temp.falla(format($q$SELECT recibir_traspaso(pg_temp.op(74), %s, '[{"sku": "P148-A", "recibida": 3}]'::jsonb)$q$, pg_temp.n('t6', 'traspaso_id')), '148-111 [12][13] la cajera de OTRA tienda (con permiso en la suya) no recibe el de la tienda A', '42501');
SELECT pg_temp.falla($q$SELECT recibir_traspaso(pg_temp.op(74), 99999999, '[]'::jsonb)$q$, '148-112 un traspaso inexistente responde lo mismo', '42501');
DO $$
DECLARE f TEXT; n INTEGER; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH n IN ARRAY ARRAY[2, 3, 4, 5, 6, 7, 9] LOOP
    PERFORM pg_temp.como(n);
    FOREACH f IN ARRAY ARRAY[
      format($q$SELECT crear_traspaso(pg_temp.op(75), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')),
      format($q$SELECT despachar_traspaso(pg_temp.op(76), %s)$q$, pg_temp.n('t6', 'traspaso_id')),
      format($q$SELECT cancelar_traspaso(pg_temp.op(77), %s, 'Lo cancelo yo')$q$, pg_temp.n('t6', 'traspaso_id')),
      format($q$SELECT retornar_traspaso(pg_temp.op(78), %s, '[{"sku": "P148-A", "recibida": 3}]'::jsonb, 'Lo regreso yo')$q$, pg_temp.n('t6', 'traspaso_id')),
      format($q$SELECT cerrar_incidencia_traspaso(pg_temp.op(79), %s, 'La cierro yo')$q$, pg_temp.n('t4', 'traspaso_id')),
      format($q$SELECT definir_recepcion_tienda(%s, 14807, true)$q$, pg_temp.n('ra', 'id')),
      $q$SELECT guardar_establecimiento(NULL, 'MIA148', 'Mi tienda', 'tienda')$q$] LOOP
      v_state := NULL;
      BEGIN EXECUTE f; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
      IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (n || ': ' || left(f, 40) || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 148-113 %', v_mal; END IF;
  RAISE NOTICE 'OK: 148-113 [12] Ventas central, Producción, Chofer, Empleado y los cajeros de tienda: crear, despachar, cancelar, retornar, cerrar incidencias y configurar responden "no autorizado"';
END $$;
DO $$
DECLARE n INTEGER; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH n IN ARRAY ARRAY[2, 3, 4, 5, 9] LOOP
    PERFORM pg_temp.como(n);
    v_state := NULL;
    BEGIN PERFORM recibir_traspaso(pg_temp.op(74), pg_temp.n('t6', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 3}]'::jsonb); EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (n || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 148-114 %', v_mal; END IF;
  RAISE NOTICE 'OK: 148-114 [12] Ventas central, Producción, Chofer, Empleado y la cajera de la tienda de fábrica tampoco reciben en la tienda A';
END $$;
SELECT pg_temp.como(6);
INSERT INTO t148 VALUES ('c6', traspasos_consulta());
SELECT pg_temp.ok((SELECT count(*) = 5 AND bool_and(pg_temp.n('ra', 'id') IN ((x.value -> 'origen' ->> 'id')::bigint, (x.value -> 'destino' ->> 'id')::bigint)) FROM jsonb_array_elements(pg_temp.j('c6') -> 'traspasos') x)
  AND pg_temp.j('c6') -> 'en_camino' = '{"P148-A": 3}'::jsonb AND pg_temp.j('c6') -> 'receptores' = 'null'::jsonb AND pg_temp.j('c6') -> 'movimientos' = 'null'::jsonb
  AND (traspasos_consulta(pg_temp.n('ra', 'id')) -> 'puede_recibir')::boolean AND jsonb_array_length(traspasos_consulta(pg_temp.n('rb', 'id')) -> 'traspasos') = 0
  AND NOT (traspasos_consulta(pg_temp.n('rb', 'id')) -> 'puede_recibir')::boolean,
  '148-115 [13] la cajera de la tienda A consulta SOLO los traspasos de su tienda (5), ve lo que viene en camino para ella (3) y nada de la tienda B');
SELECT pg_temp.como(8);
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and((x.value -> 'destino' ->> 'id')::bigint = pg_temp.n('rb', 'id')) FROM jsonb_array_elements(traspasos_consulta() -> 'traspasos') x)
  AND traspasos_consulta() -> 'en_camino' = '{"P148-A": 6}'::jsonb, '148-116 [13] la cajera de la tienda B ve solo los 2 suyos');
SELECT pg_temp.falla($q$SELECT count(*) FROM traspasos$q$, '148-117 [13] nadie de tienda lee traspasos por REST', '42501');
SELECT pg_temp.como(1);  SELECT pg_temp.falla($q$SELECT count(*) FROM traspaso_lineas$q$, '148-118 …ni Administración (todo es por contrato)', '42501');
SELECT pg_temp.como(2);  SELECT pg_temp.falla($q$SELECT traspasos_consulta()$q$, '148-119 [12] Ventas central no consulta traspasos', '42501');
SELECT pg_temp.como(3);  SELECT pg_temp.falla($q$SELECT traspasos_consulta()$q$, '148-120 [12] Producción tampoco', '42501');
SELECT pg_temp.como(1);
INSERT INTO t148 VALUES ('ca', traspasos_consulta(pg_temp.n('ra', 'id')));
SELECT pg_temp.ok(pg_temp.j('ca') -> 'resumen' = '{"pendientes": 0, "en_transito": 1, "recibidos": 3, "retornados": 0, "cancelados": 1, "incidencias_abiertas": 0}'::jsonb
  AND pg_temp.j('ca') -> 'receptores' = jsonb_build_array(jsonb_build_object('usuario_id', 14806, 'nombre', 'Cajera A recibe T148', 'rol', 'Ventas', 'recibe_traspasos', true),
                                                          jsonb_build_object('usuario_id', 14807, 'nombre', 'Cajero A no recibe T148', 'rol', 'Ventas', 'recibe_traspasos', false))
  AND jsonb_array_length(pg_temp.j('ca') -> 'movimientos') = 5
  AND jsonb_array_length(traspasos_consulta(pg_temp.n('ra', 'id'), 'cancelado') -> 'traspasos') = 1 AND jsonb_array_length(traspasos_consulta(NULL, 'en_transito') -> 'traspasos') = 2,
  '148-121 Administración: historial de abastecimiento de la tienda (pendientes, en tránsito, recibidos, cancelados, incidencias), quién puede recibir y sus movimientos de kardex');
SELECT pg_temp.como(6); SELECT recibir_traspaso(pg_temp.op(80), pg_temp.n('t6', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 3}]'::jsonb);
SELECT pg_temp.como(8); SELECT recibir_traspaso(pg_temp.op(81), pg_temp.n('t7', 'traspaso_id'), '[{"sku": "P148-A", "recibida": 6}]'::jsonb);
SELECT pg_temp.ok(pg_temp.inv() = '70/16 | 20/4 | 6/0 | 0/0', '148-122 cada tienda recibió lo suyo');

\echo '── 148: [11] una tienda remota no vende inventario del CEDIS'
SELECT pg_temp.como(6);
INSERT INTO t148 VALUES ('caja_a', (SELECT to_jsonb(c.id) FROM (SELECT (x.value ->> 'id')::bigint AS id FROM jsonb_array_elements(mi_turno_caja() -> 'cajas') x LIMIT 1) c));
INSERT INTO t148 VALUES ('turno_a', abrir_turno_caja(pg_temp.op(90), pg_temp.n('caja_a'), 0));
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(91), %s, '[{"sku": "P148-A", "cantidad": 1, "cuarto_id": "CF-148-C1"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('turno_a', 'turno_id')),
  '148-130 [11] la tienda remota NO vende del CEDIS', '42501', '%CEDIS%', 'CEDIS_SIN_PERMISO');
SELECT pg_temp.ok((SELECT string_agg(id, ',' ORDER BY id) FROM cuartos_frios) = 'CF-148-RA' AND NOT (mis_establecimientos() -> 'establecimientos' -> 0 -> 'vende_desde_cedis')::boolean,
  '148-131 [11] …ni siquiera ve la existencia del CEDIS');
INSERT INTO t148 VALUES ('venta_a', vender_en_tienda(pg_temp.op(92), pg_temp.n('turno_a', 'turno_id'), '[{"sku": "P148-A", "cantidad": 2}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('venta_a') ->> 'total')::numeric = 60 AND pg_temp.inv() = '70/16 | 18/4 | 6/0 | 0/0', '148-132 [11] vende su inventario propio (el que le llegó por traspaso)');
SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(93), 'CF-148-C1', 'CF-148-RA', 'P148-A', 1)$q$,
  '148-133 [11] el traspaso directo (144) sigue sin llegar a una tienda remota: solo se surte con despacho y recepción', '22023', '%', 'TRASPASO_ENTRE_ESTABLECIMIENTOS');
SELECT pg_temp.ok((traspaso_cuartos(pg_temp.op(94), 'CF-148-C1', 'CF-148-TF', 'P148-A', 5) ->> 'stock_destino')::int = 5 AND pg_temp.inv() = '65/16 | 18/4 | 6/0 | 5/0',
  '148-134 la tienda de fábrica conserva su traspaso directo con el CEDIS (Producción con su permiso explícito)');

\echo '── 148: [14] las rutas centrales y lo demás no cambian'
SELECT pg_temp.como(1);
INSERT INTO t148 VALUES ('carga', confirmar_carga_ruta(pg_temp.op(100), 14801, 'data:image/png;base64,QQ=='));
SELECT pg_temp.ok(pg_temp.inv() = '45/16 | 18/4 | 6/0 | 5/0' AND pg_temp.q('SELECT estatus FROM rutas WHERE id = 14801') = 'Cargada',
  '148-140 [14] la carga de una ruta de clientes sigue saliendo SOLO del CEDIS (20 piezas), sin tocar las tiendas');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(x, '|' ORDER BY ord) FROM (SELECT x, ord FROM regexp_split_to_table(pg_temp.ajeno(), '\|') WITH ORDINALITY AS s(x, ord) WHERE ord IN (1, 5, 7, 8, 9)) y)
                  = (SELECT string_agg(x, '|' ORDER BY ord) FROM (SELECT x, ord FROM regexp_split_to_table(pg_temp.j('ajeno0') #>> '{}', '\|') WITH ORDINALITY AS s(x, ord) WHERE ord IN (1, 5, 7, 8, 9)) y)
  AND pg_temp.q('SELECT count(*) FROM ordenes') = ((split_part(pg_temp.j('ajeno0') #>> '{}', '|', 2))::int + 1)::text,
  '148-141 [14] los 7 traspasos no crearon rutas, CxC, comodatos, mermas ni saldos de clientes; la única orden nueva es la venta del POS');
SELECT pg_temp.ok(pg_temp.q($q$SELECT count(*) FROM stock_operaciones WHERE clave LIKE 'traspaso_transito|%' AND tipo = 'traspaso'$q$) = '12'
  AND pg_temp.q($q$SELECT count(*) FROM stock_operaciones WHERE clave LIKE 'traspaso_transito|%' AND (ruta_id IS NOT NULL OR orden_id IS NOT NULL)$q$) = '0',
  '148-142 cada despacho, recepción y retorno quedó como operación de inventario propia (12), sin ruta ni orden');

\echo '── 148: [15] protección del último cajero de una tienda activa'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.ok((retirar_usuario_tienda(pg_temp.n('ra', 'id'), 14807, true) -> 'retirado')::boolean, '148-150 con dos cajeros, uno se puede retirar');
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 14806, true)$q$, pg_temp.n('ra', 'id')), '148-151 la cajera tiene turno abierto: primero se cierra', '22023', '%', 'TURNO_ABIERTO');
SELECT pg_temp.como(6); SELECT cerrar_turno_caja(pg_temp.op(110), pg_temp.n('turno_a', 'turno_id'), 60);
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 14806, true)$q$, pg_temp.n('ra', 'id')),
  '148-152 [15] una tienda ACTIVA no se queda sin su último cajero por un retiro ordinario (ni confirmando)', '22023', '%último cajero de una tienda activa%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 14808)$q$, pg_temp.n('rb', 'id')), '148-153 [15] igual en la otra tienda', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.ok((retirar_usuario_tienda(pg_temp.n('tf', 'id'), 14803) -> 'retirado')::boolean AND pg_temp.q(format('SELECT activo::text FROM establecimientos WHERE id = %s', pg_temp.n('ra', 'id'))) = 'true',
  '148-154 [15] quien no es cajero (Producción) sí se retira; la tienda sigue activa y con su cajera');
SELECT asignar_usuario_tienda(pg_temp.n('ra', 'id'), 14807, false, false);
SELECT pg_temp.ok((retirar_usuario_tienda(pg_temp.n('ra', 'id'), 14806, true) -> 'retirado')::boolean, '148-155 [15] asignado otro cajero, el anterior ya se puede retirar');
SELECT activar_tienda(pg_temp.op(111), pg_temp.n('rb', 'id'), false, 'Cierre definitivo de la tienda B');
SELECT pg_temp.ok((retirar_usuario_tienda(pg_temp.n('rb', 'id'), 14808, true) -> 'retirado')::boolean, '148-156 [15] con la tienda DESACTIVADA (decisión explícita y auditada) sí se retira a su último cajero');
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(112), 1, %s, 'CF-148-C1', 'CF-148-RB', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Marta Ruiz')$q$, pg_temp.n('rb', 'id')),
  '148-157 a una tienda desactivada no se le crean traspasos', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');

\echo '── 148: el dueño apaga el interruptor global → los traspasos se detienen'
RESET ROLE;
SAVEPOINT s_apagado;
SET LOCAL session_replication_role = replica; UPDATE tiendas_activacion SET habilitada = false; SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT crear_traspaso(pg_temp.op(120), 1, %s, 'CF-148-C1', 'CF-148-RA', '[{"sku": "P148-A", "cantidad": 1}]'::jsonb, 'Luis Pérez')$q$, pg_temp.n('ra', 'id')), '148-160 interruptor apagado: no se crean traspasos', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla(format($q$SELECT despachar_traspaso(pg_temp.op(121), %s)$q$, pg_temp.n('t1', 'traspaso_id')), '148-161 …ni se despachan', '22023', '%', 'TIENDAS_NO_ACTIVADAS');
RESET ROLE;
ROLLBACK TO s_apagado;

\echo '── 148: invariantes finales'
SELECT pg_temp.ok(pg_temp.inv() = '45/16 | 18/4 | 6/0 | 5/0', '148-170 existencias finales: CEDIS 45/16, tienda A 18/4, tienda B 6/0, fábrica 5/0');
-- Conservación del producto A: 100 iniciales = lo que hay en cuartos + vendido + cargado a ruta + dañado + faltante.
SELECT pg_temp.ok(100 = 45 + 18 + 6 + 5 + 2 + 20 + (SELECT sum(cantidad_danada + cantidad_faltante) FROM traspaso_lineas WHERE sku = 'P148-A' AND cantidad_recibida IS NOT NULL)
  AND (SELECT sum(cantidad_danada + cantidad_faltante) FROM traspaso_lineas WHERE sku = 'P148-A') = 4
  AND (SELECT count(*) FROM traspasos WHERE estado = 'en_transito') = 0,
  '148-171 conservación: las 100 piezas iniciales = 74 en cuartos + 2 vendidas + 20 en la ruta + 4 dañadas o faltantes registradas en sus traspasos; nada en tránsito');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM cuartos_frios c, jsonb_each_text(c.stock) k WHERE c.id LIKE 'CF-148-%' AND k.value::int < 0)
  AND (SELECT bool_and(l.cantidad_recibida + l.cantidad_danada + l.cantidad_faltante = l.cantidad_despachada) FROM traspaso_lineas l WHERE l.cantidad_recibida IS NOT NULL)
  AND (SELECT count(*) = 0 FROM (SELECT operacion_id, cuarto_id, producto, tipo FROM inventario_mov WHERE referencia LIKE 'traspaso/TR-%' GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d),
  '148-172 ninguna existencia negativa; cada línea cerrada cuadra; ningún movimiento de traspaso duplicado');
ROLLBACK;
