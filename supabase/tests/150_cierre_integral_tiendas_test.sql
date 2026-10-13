-- 150_cierre_integral_tiendas_test.sql — Tiendas propias, E9: cierre integral.
--   A) Último cajero: una tienda activa no se queda sin cajero por baja, desactivación, cambio de
--      rol, borrado ni retiro (con `guardar_usuario` intacto).
--   B) Recorrido operativo de punta a punta con los contratos reales (15 pasos, marcados [n]).
--   C) Devoluciones y reembolsos: una sola devolución, un solo egreso, una sola salida de dinero;
--      hecho contable aparte del dinero entregado; reintentos idempotentes.
--   D) Fechas: día de negocio de la venta, del cobro, de la devolución, de la entrega del reembolso
--      y del turno, con frontera de medianoche del negocio.
-- Todo se deshace con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t150.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
CREATE TEMP TABLE t150 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t150 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t150 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.n(p_k TEXT, p_campo TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT CASE WHEN p_campo IS NULL THEN (v #>> '{}')::bigint ELSE (v ->> p_campo)::bigint END FROM t150 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('15000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t150' FROM generate_series(1, 9) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (15001, 'Admin T150',            'u1@t150', 'Admin',      'Activo', '15000000-0000-0000-0000-000000000001'),
  (15002, 'Ventas central T150',   'u2@t150', 'Ventas',     'Activo', '15000000-0000-0000-0000-000000000002'),
  (15003, 'Produccion T150',       'u3@t150', 'Producción', 'Activo', '15000000-0000-0000-0000-000000000003'),
  (15004, 'Admin dos T150',        'u4@t150', 'Admin',      'Activo', '15000000-0000-0000-0000-000000000004'),
  (15006, 'Cajera fabrica T150',   'u6@t150', 'Ventas',     'Activo', '15000000-0000-0000-0000-000000000006'),
  (15007, 'Cajero remota T150',    'u7@t150', 'Ventas',     'Activo', '15000000-0000-0000-0000-000000000007'),
  (15008, 'Cajera suplente T150',  'u8@t150', 'Ventas',     'Activo', '15000000-0000-0000-0000-000000000008');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P150-A', 'Hielo A150', 'Producto Terminado', 30, 0, 0), ('P150-B', 'Hielo B150', 'Producto Terminado', 90, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-150-C1', 'Cuarto CEDIS 150', '{"P150-A": 100, "P150-B": 50}');
SET LOCAL session_replication_role = origin;
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 150 (dueño, SQL)';

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
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"15000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('15000000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.q(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
-- rol|estatus de un usuario, leído sin pasar por RLS.
CREATE OR REPLACE FUNCTION pg_temp.usr(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$ SELECT concat_ws('|', rol, estatus) FROM public.usuarios WHERE id = p_id $$;
SELECT set_config('t150.hoy', fin_hoy()::text, true);
CREATE OR REPLACE FUNCTION pg_temp.hoy() RETURNS DATE LANGUAGE sql AS $$ SELECT current_setting('t150.hoy')::date $$;

\echo '── 150: catálogo'
SELECT pg_temp.ok(current_setting('t150.apagado_al_inicio')::boolean, '150-01 el interruptor global estaba APAGADO al empezar (150 no lo toca)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.guardar_usuario(bigint,text,text,text,text[])'::regprocedure)) = '2b32868497e95e5deaf91af26619ec97'
  AND md5(pg_get_functiondef('public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)'::regprocedure)) IS NOT NULL
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.reporte_financiero(date,date)'::regprocedure)) = '32f9086041739353be01995ebf8a6776'
  AND md5(pg_get_functiondef('public.retirar_usuario_tienda(bigint,bigint,boolean)'::regprocedure)) = 'dd831c01' || substr(md5(pg_get_functiondef('public.retirar_usuario_tienda(bigint,bigint,boolean)'::regprocedure)), 9),
  '150-02 guardar_usuario (120), la venta directa, el reporte financiero y el retiro de tienda (148) conservan su huella: 150 no modifica contratos');
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(t.tgenabled = 'O') FROM pg_trigger t WHERE t.tgname IN ('trg_usuarios_guard_ultimo_cajero', 'trg_usuario_establecimientos_guard_ultimo_cajero') AND NOT t.tgisinternal)
  AND (SELECT count(*) = 4 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('tienda_exigir_otro_cajero', 'usuarios_guard_ultimo_cajero', 'usuario_establecimientos_guard_ultimo_cajero', 'reporte_reembolsos_tiendas'))
  AND NOT has_function_privilege('authenticated', 'public.tienda_exigir_otro_cajero(bigint,bigint,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reporte_reembolsos_tiendas(date,date,bigint)', 'EXECUTE')
  AND (SELECT p.provolatile = 's' FROM pg_proc p WHERE p.oid = 'public.reporte_reembolsos_tiendas(date,date,bigint)'::regprocedure)
  AND pg_get_functiondef('public.reporte_reembolsos_tiendas(date,date,bigint)'::regprocedure) !~* '\m(INSERT|UPDATE|DELETE|set_config|nextval)\M',
  '150-03 dos disparadores activos y cuatro funciones SECURITY DEFINER con search_path fijo, sin anon; la guarda no se expone; el reporte es de solo lectura (STABLE, sin escrituras)');

SELECT pg_temp.ok(has_function_privilege('service_role', 'public.erp_usuario_de_tienda(bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.erp_usuario_de_tienda(bigint)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.erp_usuario_de_tienda(bigint)', 'EXECUTE'),
  '150-04 el rol de servicio (Netlify) puede resolver el perfil de tienda; authenticated y anon no');
\echo '── 150: [1]–[6] alta, personal, permisos, cajas y activación'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t150 VALUES ('tf', guardar_establecimiento(NULL, 'TF150', 'Tienda de fábrica 150')), ('tr', guardar_establecimiento(NULL, 'TR150', 'Tienda remota 150', 'tienda'));
SELECT pg_temp.ok(pg_temp.j('tf') ->> 'tipo' = 'tienda_fabrica' AND NOT (pg_temp.j('tf') -> 'activo')::boolean AND pg_temp.j('tr') ->> 'tipo' = 'tienda' AND NOT (pg_temp.j('tr') -> 'activo')::boolean,
  '150-10 [1][2] alta de una tienda de fábrica y de una tienda remota: las dos nacen INACTIVAS');
SELECT asignar_cuarto_tienda(pg_temp.n('tf', 'id'), 'CF-150-TF', 'Congelador fábrica 150'), asignar_cuarto_tienda(pg_temp.n('tr', 'id'), 'CF-150-TR', 'Congelador remota 150');
SELECT asignar_usuario_tienda(pg_temp.n('tf', 'id'), 15006, true, false), asignar_usuario_tienda(pg_temp.n('tf', 'id'), 15008, false, false),
       asignar_usuario_tienda(pg_temp.n('tf', 'id'), 15003, false, true), asignar_usuario_tienda(pg_temp.n('tr', 'id'), 15007, false, false);
SELECT definir_recepcion_tienda(pg_temp.n('tr', 'id'), 15007, true);
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT string_agg(concat_ws(':', usuario_id, vende_desde_cedis, traspasa_con_cedis, recibe_traspasos), ',' ORDER BY usuario_id) FROM usuario_establecimientos WHERE establecimiento_id IN (%s, %s)$q$,
                                   pg_temp.n('tf', 'id'), pg_temp.n('tr', 'id'))) = '15003:f:t:f,15006:t:f:f,15007:f:f:t,15008:f:f:f',
  '150-11 [3][4] cajeros asignados y permisos de inventario explícitos: vender del CEDIS (una cajera de fábrica), traspasar con el CEDIS (Producción), recibir traspasos (cajero de la remota); ninguno implícito');
INSERT INTO t150 VALUES ('kf', agregar_caja_tienda(pg_temp.n('tf', 'id'), 'Caja F')), ('kr', agregar_caja_tienda(pg_temp.n('tr', 'id'), 'Caja R'));
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(900), %s, 100)$q$, pg_temp.n('kf', 'id')), '150-12 [5] con la caja creada pero la tienda INACTIVA nadie abre turno', '22023|42501');
-- Con las tiendas todavía inactivas, la baja del único cajero NO se impide (la tienda no opera).
SELECT pg_temp.ok((guardar_usuario(15007, 'Cajero remota T150', 'Ventas', 'Inactivo') ->> 'estatus') = 'Inactivo' AND (guardar_usuario(15007, 'Cajero remota T150', 'Ventas', 'Activo') ->> 'estatus') = 'Activo',
  '150-13 con la tienda INACTIVA la baja de su único cajero pasa (y se revierte): la protección es de tiendas activas');
SELECT activar_tienda(pg_temp.op(1), pg_temp.n('tf', 'id'), true), activar_tienda(pg_temp.op(2), pg_temp.n('tr', 'id'), true);
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT string_agg(activo::text, ',') FROM establecimientos WHERE id IN (%s, %s)$q$, pg_temp.n('tf', 'id'), pg_temp.n('tr', 'id'))) = 'true,true',
  '150-14 [6] activación explícita de las dos tiendas (lista de verificación del servidor en verde)');

\echo '── 150: A) último cajero de una tienda activa'
SELECT pg_temp.falla($q$SELECT guardar_usuario(15007, 'Cajero remota T150', 'Ventas', 'Inactivo')$q$, '150-20 BAJA (estatus Inactivo) del único cajero de una tienda activa por guardar_usuario: rechazada', '22023', '%último cajero%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla($q$SELECT guardar_usuario(15007, 'Cajero remota T150', 'Producción', 'Activo')$q$, '150-21 CAMBIO DE ROL del único cajero (Ventas → Producción): rechazado', '22023', '%último cajero%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla($q$SELECT guardar_usuario(15007, 'Cajero remota T150', 'Chofer', 'Inactivo')$q$, '150-22 cambio de rol y baja a la vez: rechazado', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.ok(pg_temp.usr(15007) = 'Ventas|Activo'
  AND pg_temp.q($q$SELECT count(*) FROM bitacora_cambios WHERE tabla = 'usuarios' AND registro_id = '15007' AND detalle = 'guardar_usuario'$q$) = '2',
  '150-23 tras los rechazos el cajero sigue Ventas y Activo y la bitácora solo tiene los dos cambios de antes de activar: nada quedó a medias');
SELECT pg_temp.ok((guardar_usuario(15007, 'Cajero remota (renombrado)', 'Ventas', 'Activo') ->> 'ok')::boolean AND pg_temp.q('SELECT nombre FROM usuarios WHERE id = 15007') = 'Cajero remota (renombrado)',
  '150-24 lo que no le quita la calidad de cajero (cambiar el nombre) sigue pasando por guardar_usuario');
-- La tienda de fábrica tiene DOS cajeras: una se puede dar de baja; la que queda, ya no.
SELECT pg_temp.ok((guardar_usuario(15008, 'Cajera suplente T150', 'Ventas', 'Inactivo') ->> 'estatus') = 'Inactivo', '150-25 con dos cajeras, dar de baja a UNA pasa');
SELECT pg_temp.falla($q$SELECT guardar_usuario(15006, 'Cajera fabrica T150', 'Ventas', 'Inactivo')$q$, '150-26 …y entonces la otra es la última: su baja se rechaza', '22023', '%Tienda de fábrica 150%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla(format($q$SELECT retirar_usuario_tienda(%s, 15006, true)$q$, pg_temp.n('tf', 'id')), '150-27 el retiro por contrato (148) sigue protegiendo igual', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.ok((guardar_usuario(15008, 'Cajera suplente T150', 'Ventas', 'Activo') ->> 'estatus') = 'Activo'
  AND (retirar_usuario_tienda(pg_temp.n('tf', 'id'), 15008, true) -> 'retirado')::boolean AND (asignar_usuario_tienda(pg_temp.n('tf', 'id'), 15008, false, false)) IS NOT NULL,
  '150-28 reactivada la suplente, retirarla por contrato pasa (queda otra cajera) y se vuelve a asignar: los disparadores no estorban la operación normal');
SELECT pg_temp.ok((guardar_usuario(15002, 'Ventas central T150', 'Ventas', 'Inactivo') ->> 'estatus') = 'Inactivo' AND (guardar_usuario(15002, 'Ventas central T150', 'Ventas', 'Activo')) IS NOT NULL
  AND (guardar_usuario(15003, 'Produccion T150', 'Producción', 'Inactivo') ->> 'estatus') = 'Inactivo' AND (guardar_usuario(15003, 'Produccion T150', 'Producción', 'Activo')) IS NOT NULL,
  '150-29 quien no es cajero de tienda (Ventas central, Producción asignado a la tienda) se da de baja como siempre');
RESET ROLE;
-- Sin exención de sesión: tampoco SQL de mantenimiento / service role.
SELECT pg_temp.falla($q$UPDATE usuarios SET estatus = 'Inactivo' WHERE id = 15007$q$, '150-30 UPDATE directo de una sesión de confianza (mantenimiento / service role): también rechazado', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla($q$UPDATE usuarios SET rol = 'Empleado' WHERE id = 15007$q$, '150-31 cambio de rol directo: rechazado', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla($q$DELETE FROM usuarios WHERE id = 15007$q$, '150-32 BORRAR al usuario: rechazado antes de cualquier cascada', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla(format($q$DELETE FROM usuario_establecimientos WHERE usuario_id = 15007 AND establecimiento_id = %s$q$, pg_temp.n('tr', 'id')), '150-33 borrar la asignación sin pasar por el contrato: rechazado', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.falla(format($q$UPDATE usuario_establecimientos SET establecimiento_id = %s WHERE usuario_id = 15007$q$, pg_temp.n('tf', 'id')), '150-34 mover la asignación a otra tienda: rechazado', '22023', '%', 'ULTIMO_CAJERO');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM usuario_establecimientos WHERE usuario_id = 15007) AND pg_temp.usr(15007) = 'Ventas|Activo'
  AND pg_temp.q(format($q$SELECT recibe_traspasos FROM usuario_establecimientos WHERE usuario_id = 15007 AND establecimiento_id = %s$q$, pg_temp.n('tr', 'id'))) = 'true',
  '150-35 la tienda remota conserva a su cajero, asignado y con sus permisos');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.ok((definir_recepcion_tienda(pg_temp.n('tr', 'id'), 15007, false)) IS NOT NULL AND (definir_recepcion_tienda(pg_temp.n('tr', 'id'), 15007, true)) IS NOT NULL,
  '150-36 cambiar un PERMISO de la asignación (recibir traspasos) no es retirar a nadie: pasa');

\echo '── 150: [7] abastecimiento y recepción'
INSERT INTO t150 VALUES ('t1', crear_traspaso(pg_temp.op(10), 1, pg_temp.n('tr', 'id'), 'CF-150-C1', 'CF-150-TR', '[{"sku": "P150-A", "cantidad": 20}, {"sku": "P150-B", "cantidad": 6}]'::jsonb, 'Luis Pérez'));
SELECT despachar_traspaso(pg_temp.op(11), pg_temp.n('t1', 'traspaso_id'));
SELECT pg_temp.como(7);
INSERT INTO t150 VALUES ('r1', recibir_traspaso(pg_temp.op(12), pg_temp.n('t1', 'traspaso_id'), '[{"sku": "P150-A", "recibida": 19, "danada": 1}, {"sku": "P150-B", "recibida": 6}]'::jsonb, 'Una bolsa rota'));
SELECT pg_temp.ok(pg_temp.q($q$SELECT concat_ws('|', (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-C1'), (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TR'), (SELECT stock ->> 'P150-B' FROM cuartos_frios WHERE id = 'CF-150-TR'))$q$) = '80|19|6'
  AND pg_temp.q(format($q$SELECT concat_ws('|', estado, incidencia) FROM traspasos WHERE id = %s$q$, pg_temp.n('t1', 'traspaso_id'))) = 'recibido|t'
  AND pg_temp.q($q$SELECT count(*) FROM ordenes WHERE establecimiento_id IS NOT NULL AND created_at >= now() - interval '1 minute' AND productos LIKE '%P150%'$q$) = '0',
  '150-40 [7] traspaso CEDIS → tienda remota despachado por Administración y recibido por el cajero con permiso: salen 20 del CEDIS, entran 19 buenas; la dañada es incidencia, no venta ni merma contable');
SELECT pg_temp.como(3);
SELECT traspaso_cuartos(pg_temp.op(13), 'CF-150-C1', 'CF-150-TF', 'P150-A', 10);
SELECT pg_temp.ok(pg_temp.q($q$SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TF'$q$) = '10', '150-41 [7] Producción (con permiso) surte el congelador de la tienda de fábrica desde el CEDIS');

\echo '── 150: [8]–[10] turno, venta, cobro y reintento'
SELECT pg_temp.como(6);
INSERT INTO t150 VALUES ('tuf', abrir_turno_caja(pg_temp.op(20), pg_temp.n('kf', 'id'), 100));
INSERT INTO t150 VALUES ('s1', vender_en_tienda(pg_temp.op(21), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P150-A", "cantidad": 2, "cuarto_id": "CF-150-TF"}]'::jsonb, 'Efectivo'));
INSERT INTO t150 VALUES ('s2', vender_en_tienda(pg_temp.op(22), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P150-A", "cantidad": 3, "cuarto_id": "CF-150-C1"}]'::jsonb, 'Tarjeta (terminal)', NULL, 'AUT 150'));
INSERT INTO t150 VALUES ('s3', vender_en_tienda(pg_temp.op(23), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P150-A", "cantidad": 1, "cuarto_id": "CF-150-TF"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok(pg_temp.j('s1') ->> 'estatus' = 'Entregada' AND (pg_temp.j('s1') ->> 'total')::numeric = 60 AND (pg_temp.j('s2') ->> 'total')::numeric = 90 AND (pg_temp.j('s3') ->> 'total')::numeric = 30
  AND pg_temp.q($q$SELECT concat_ws('|', (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TF'), (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-C1'))$q$) = '7|67',
  '150-50 [8][9] turno abierto con fondo y tres ventas: el producto sale del congelador elegido (7 en la tienda; 67 en el CEDIS, con permiso explícito)');
-- [10] Reintento del cobro (respuesta perdida): misma operación → misma venta, sin segundo cobro ni segunda salida.
INSERT INTO t150 VALUES ('s1r', vender_en_tienda(pg_temp.op(21), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P150-A", "cantidad": 2, "cuarto_id": "CF-150-TF"}]'::jsonb, 'Efectivo'));
SELECT pg_temp.ok((pg_temp.j('s1r') -> 'replay')::boolean AND pg_temp.n('s1r', 'orden_id') = pg_temp.n('s1', 'orden_id')
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(monto)) FROM pagos WHERE orden_id = %s$q$, pg_temp.n('s1', 'orden_id'))) = '1|60.00'
  AND pg_temp.q($q$SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TF'$q$) = '7'
  AND pg_temp.q(format($q$SELECT count(*) FROM ordenes WHERE turno_id = %s$q$, pg_temp.n('tuf', 'turno_id'))) = '3',
  '150-51 [10] reintento del cobro con la misma operación: misma venta, UN pago de $60, una sola salida de inventario');
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(21), %s, '[{"sku": "P150-A", "cantidad": 5, "cuarto_id": "CF-150-TF"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('tuf', 'turno_id')),
  '150-52 [10] la misma operación con OTROS datos se rechaza (no se convierte en otra venta)', '23505', '%', 'OPERACION_REPETIDA');
SELECT pg_temp.como(7);
INSERT INTO t150 VALUES ('tur', abrir_turno_caja(pg_temp.op(24), pg_temp.n('kr', 'id'), 50));
INSERT INTO t150 VALUES ('s4', vender_en_tienda(pg_temp.op(25), pg_temp.n('tur', 'turno_id'), '[{"sku": "P150-B", "cantidad": 1}]'::jsonb, 'Efectivo'));
SELECT pg_temp.falla(format($q$SELECT vender_en_tienda(pg_temp.op(26), %s, '[{"sku": "P150-A", "cantidad": 1, "cuarto_id": "CF-150-C1"}]'::jsonb, 'Efectivo')$q$, pg_temp.n('tur', 'turno_id')),
  '150-53 [4] la tienda remota no vende producto del CEDIS', '22023|42501');
-- Con el turno abierto, la baja del cajero de una tienda con otra cajera SÍ pasa (baja urgente); la del último, no.
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT guardar_usuario(15007, 'Cajero remota (renombrado)', 'Ventas', 'Inactivo')$q$, '150-54 con turno abierto, el último cajero de la remota tampoco se da de baja', '22023', '%', 'ULTIMO_CAJERO');

\echo '── 150: D) fechas de la venta, el cobro y el turno'
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT bool_and(fin_dia_negocio(o.delivered_at) = '%s'::date AND o.fecha = '%s'::date AND p.fecha = '%s'::date AND t.fecha_negocio = '%s'::date AND fin_dia_negocio(t.abierto_at) = t.fecha_negocio)
                                         FROM ordenes o JOIN pagos p ON p.orden_id = o.id JOIN turnos_caja t ON t.id = o.turno_id WHERE o.turno_id IN (%s, %s)$q$,
                                   pg_temp.hoy(), pg_temp.hoy(), pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tuf', 'turno_id'), pg_temp.n('tur', 'turno_id'))) = 'true'
  AND pg_temp.q(format($q$SELECT count(*) FROM ordenes o JOIN pagos p ON p.orden_id = o.id WHERE o.turno_id IN (%s, %s)$q$, pg_temp.n('tuf', 'turno_id'), pg_temp.n('tur', 'turno_id'))) = '4',
  '150-60 las 4 ventas: día de negocio de la entrega = fecha de la orden = fecha del cobro = día del turno (todo en la zona del negocio, decidido por el servidor)');

\echo '── 150: [12][13] C) devoluciones y reembolsos'
-- C1: venta en efectivo, el dinero sale YA de la caja de la tienda. C2: venta con tarjeta, devolución electrónica PENDIENTE.
-- C3: venta en efectivo, el dinero lo entregará Administración (todavía no).
INSERT INTO t150 VALUES ('c1', corregir_venta_tienda(pg_temp.op(30), pg_temp.n('s1', 'orden_id'), 'El cliente devolvió las dos bolsas', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('tuf', 'turno_id')));
INSERT INTO t150 VALUES ('c2', corregir_venta_tienda(pg_temp.op(31), pg_temp.n('s2', 'orden_id'), 'Cobro duplicado en la terminal', 'Reintegrar', 'CF-150-C1', NULL, 'electronico', false));
INSERT INTO t150 VALUES ('c3', corregir_venta_tienda(pg_temp.op(32), pg_temp.n('s3', 'orden_id'), 'Producto equivocado', 'Reintegrar', NULL, NULL, 'efectivo_administracion', false));
SELECT pg_temp.ok(pg_temp.j('c1') -> 'reembolso' @> '{"monto": 60.00, "medio": "efectivo_caja", "estado": "ejecutado", "dinero_devuelto": true}'::jsonb
  AND pg_temp.j('c2') -> 'reembolso' @> '{"monto": 90.00, "medio": "electronico", "estado": "registrado", "dinero_devuelto": false}'::jsonb
  AND pg_temp.j('c3') -> 'reembolso' @> '{"monto": 30.00, "medio": "efectivo_administracion", "estado": "registrado", "dinero_devuelto": false}'::jsonb,
  '150-70 [12][13] tres devoluciones: una con el efectivo ya entregado desde la caja, una electrónica pendiente y una en efectivo que entregará Administración (pendiente)');
SELECT pg_temp.ok(pg_temp.q($q$SELECT concat_ws('|', (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TF'), (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-C1'))$q$) = '10|70',
  '150-71 [12] reintegro de inventario: el producto vuelve al cuarto del que salió (10 en la tienda, 70 en el CEDIS)');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(d.total), count(DISTINCT d.orden_id), count(d.egreso_id)) FROM devoluciones d WHERE d.orden_id IN (%s, %s, %s)$q$,
                                   pg_temp.n('s1', 'orden_id'), pg_temp.n('s2', 'orden_id'), pg_temp.n('s3', 'orden_id'))) = '3|180.00|3|3'
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(m.monto), bool_and(m.fecha = '%s'::date AND m.tipo = 'Egreso')) FROM movimientos_contables m WHERE m.id IN (SELECT egreso_id FROM devoluciones WHERE orden_id IN (%s, %s, %s))$q$,
                                   pg_temp.hoy(), pg_temp.n('s1', 'orden_id'), pg_temp.n('s2', 'orden_id'), pg_temp.n('s3', 'orden_id'))) = '3|180.00|t',
  '150-72 [12] hecho CONTABLE: 3 devoluciones, 3 egresos por $180 con fecha de hoy — también las dos cuyo dinero aún NO se entrega');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', count(*) FILTER (WHERE reembolso_estado = 'ejecutado'), COALESCE(sum(reembolso_monto) FILTER (WHERE reembolso_estado = 'ejecutado'), 0),
                                                              count(*) FILTER (WHERE reembolso_estado = 'registrado'), COALESCE(sum(reembolso_monto) FILTER (WHERE reembolso_estado = 'registrado'), 0))
                                         FROM correcciones_venta_tienda WHERE establecimiento_id = %s$q$, pg_temp.n('tf', 'id'))) = '1|60.00|2|120.00',
  '150-73 [13] flujo REAL de dinero: salió $60 (una devolución); $120 se deben y no han salido. El egreso contable ($180) y el dinero entregado ($60) son cosas distintas y se ven separadas');
-- Reintentos idempotentes.
SELECT pg_temp.ok((corregir_venta_tienda(pg_temp.op(30), pg_temp.n('s1', 'orden_id'), 'El cliente devolvió las dos bolsas', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('tuf', 'turno_id')) -> 'replay')::boolean
  AND pg_temp.q(format($q$SELECT concat_ws('|', (SELECT count(*) FROM devoluciones WHERE orden_id = %s), (SELECT count(*) FROM correcciones_venta_tienda WHERE orden_id = %s), (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TF'))$q$,
                                   pg_temp.n('s1', 'orden_id'), pg_temp.n('s1', 'orden_id'))) = '1|1|10',
  '150-74 reintento de la devolución (misma operación): misma respuesta; una devolución, un egreso, un reintegro');
SELECT pg_temp.falla(format($q$SELECT corregir_venta_tienda(pg_temp.op(33), %s, 'Otra vez la misma venta', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, %s)$q$, pg_temp.n('s1', 'orden_id'), pg_temp.n('tuf', 'turno_id')),
  '150-75 una SEGUNDA devolución de la misma venta (operación nueva) se rechaza: no hay doble devolución ni doble salida de dinero', '22023', '%', 'YA_CORREGIDA');
SELECT pg_temp.falla(format($q$SELECT registrar_devolucion(pg_temp.op(34), %s, '[{"sku": "P150-A", "cantidad": 1}]'::jsonb, 'Efectivo', 'Reintegrar', 'CF-150-TF', 'Por el camino central', 'x')$q$, pg_temp.n('s1', 'orden_id')),
  '150-76 tampoco por el contrato central de devoluciones (104, sin cambio): una devolución por orden', '22023|23505|42501');
-- Efectivo esperado de la caja: solo baja con el efectivo que SALIÓ de esa caja.
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', t ->> 'cobrado_efectivo', t ->> 'reembolsos_efectivo_caja') FROM (SELECT turno_caja_totales(%s) AS t) z$q$, pg_temp.n('tuf', 'turno_id'))) = '90.00|60.00',
  '150-77 caja de la tienda: cobró $90 en efectivo y entregó $60 de reembolso; los $30 que entregará Administración y los $90 de la terminal NO bajan su efectivo');
-- Reembolso electrónico: se confirma una sola vez, con referencia.
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(40), %s)$q$, pg_temp.n('c2', 'correccion_id')), '150-78 confirmar la devolución electrónica exige la referencia de la terminal o del banco', '22023', '%', 'REFERENCIA_REQUERIDA');
INSERT INTO t150 VALUES ('e2', confirmar_reembolso_tienda(pg_temp.op(40), pg_temp.n('c2', 'correccion_id'), 'DEV-TERMINAL-150'));
SELECT pg_temp.ok(pg_temp.j('e2') @> '{"estado": "ejecutado", "dinero_devuelto": true, "replay": false}'::jsonb
  AND (confirmar_reembolso_tienda(pg_temp.op(40), pg_temp.n('c2', 'correccion_id'), 'DEV-TERMINAL-150') -> 'replay')::boolean,
  '150-79 [13] reembolso electrónico confirmado con su referencia; el reintento devuelve la misma respuesta');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(41), %s, 'DEV-OTRA-150')$q$, pg_temp.n('c2', 'correccion_id')), '150-80 una SEGUNDA confirmación (operación nueva) se rechaza: el dinero no sale dos veces', '22023', '%', 'REEMBOLSO_NO_PENDIENTE');
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(42), %s, NULL, %s)$q$, pg_temp.n('c3', 'correccion_id'), pg_temp.n('tuf', 'turno_id')),
  '150-81 un reembolso que entrega Administración no se puede cargar después a una caja', '22023');
SELECT pg_temp.ok(pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(monto)) FROM movimientos_contables WHERE id IN (SELECT egreso_id FROM devoluciones WHERE orden_id IN (%s, %s, %s))$q$,
                                   pg_temp.n('s1', 'orden_id'), pg_temp.n('s2', 'orden_id'), pg_temp.n('s3', 'orden_id'))) = '3|180.00',
  '150-82 confirmar la entrega NO crea otro egreso contable: siguen 3 egresos por $180');

\echo '── 150: [11] cierre de turno'
SELECT pg_temp.como(6);
SELECT pg_temp.ok(mi_turno_caja()::text !~* 'esperado|diferencia', '150-90 la cajera no ve el efectivo esperado antes de cerrar');
INSERT INTO t150 VALUES ('zf', cerrar_turno_caja(pg_temp.op(50), pg_temp.n('tuf', 'turno_id'), 130));
SELECT pg_temp.ok(pg_temp.j('zf') ->> 'estado' = 'cerrado' AND (pg_temp.j('zf') ->> 'efectivo_esperado')::numeric = 130 AND (pg_temp.j('zf') ->> 'diferencia')::numeric = 0
  AND (cerrar_turno_caja(pg_temp.op(50), pg_temp.n('tuf', 'turno_id'), 130) -> 'replay')::boolean
  AND pg_temp.q(format($q$SELECT fin_dia_negocio(cerrado_at) = fecha_negocio FROM turnos_caja WHERE id = %s$q$, pg_temp.n('tuf', 'turno_id'))) = 'true',
  '150-91 [11] cierre: esperado = fondo 100 + efectivo 90 − reembolso de caja 60 = 130; contado 130, sin diferencia; reintento idempotente; el turno se cerró en su día de negocio');
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT confirmar_reembolso_tienda(pg_temp.op(43), %s, NULL, %s)$q$, pg_temp.n('c3', 'correccion_id'), pg_temp.n('tuf', 'turno_id')), '150-92 con el turno CERRADO ya no sale efectivo de esa caja', '22023');
INSERT INTO t150 VALUES ('e3', confirmar_reembolso_tienda(pg_temp.op(44), pg_temp.n('c3', 'correccion_id')));
SELECT pg_temp.ok(pg_temp.j('e3') @> '{"estado": "ejecutado", "medio": "efectivo_administracion"}'::jsonb
  AND pg_temp.q(format($q$SELECT concat_ws('|', efectivo_esperado, diferencia) FROM turnos_caja WHERE id = %s$q$, pg_temp.n('tuf', 'turno_id'))) = '130.00|0.00',
  '150-93 [13] Administración entrega los $30 después del cierre: el reembolso queda ejecutado y el cierre de la caja NO se altera');

\echo '── 150: [14] D) reportes y fechas del reembolso'
INSERT INTO t150 VALUES ('rr', reporte_reembolsos_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')));
SELECT pg_temp.ok(pg_temp.j('rr') -> 'resumen' @> '{"devoluciones_en_periodo": 3, "devuelto_en_periodo": 180.00, "reembolsos_registrados_en_periodo": 180.00, "egreso_contable_en_periodo": 180.00, "dinero_entregado_en_periodo": 180.00,
                                                    "entregado_desde_caja": 60.00, "entregado_por_administracion": 30.00, "entregado_electronico": 90.00, "pendientes_al_corte": 0, "pendiente_al_corte": 0}'::jsonb
  AND jsonb_array_length(pg_temp.j('rr') -> 'reembolsos') = 3 AND pg_temp.j('rr') -> 'inconsistencias' = '[]'::jsonb,
  '150-100 [14] conciliación de reembolsos de la tienda: 3 devoluciones por $180; egreso contable $180; dinero entregado $180 = $60 de caja + $30 de Administración + $90 electrónico; nada pendiente; sin inconsistencias');
SELECT pg_temp.ok(jsonb_array_length(reporte_reembolsos_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'reembolsos') = 0
  AND (reporte_reembolsos_tiendas(pg_temp.hoy(), pg_temp.hoy()) -> 'resumen' ->> 'dinero_entregado_en_periodo')::numeric >= 180
  AND pg_temp.j('rr')::text !~* 'rfc|correo|saldo|DEV-TERMINAL',
  '150-101 con una tienda elegida salen solo sus reembolsos; el consolidado los incluye; sin datos de clientes ni la referencia bancaria');
RESET ROLE;
-- Fechas distintas (se mueve la historia de ESTA prueba, con los disparadores apagados): la devolución
-- electrónica se registró hace 3 días y se entregó hoy; la de Administración se registró hoy y se
-- entregó "mañana" a las 00:00:01 del negocio; la de caja se entregó ayer a las 23:59:59.
SET LOCAL session_replication_role = replica;
UPDATE correcciones_venta_tienda SET created_at = created_at - interval '3 days' WHERE id = pg_temp.n('c2', 'correccion_id');
UPDATE movimientos_contables SET fecha = pg_temp.hoy() - 3 WHERE id = (SELECT egreso_id FROM devoluciones WHERE orden_id = pg_temp.n('s2', 'orden_id'));
UPDATE correcciones_venta_tienda SET reembolso_ejecutado_at = ((pg_temp.hoy() + 1)::timestamp + time '00:00:01') AT TIME ZONE fin_zona_negocio() WHERE id = pg_temp.n('c3', 'correccion_id');
UPDATE correcciones_venta_tienda SET created_at = ((pg_temp.hoy() - 1)::timestamp + time '23:00:00') AT TIME ZONE fin_zona_negocio(),
                                     reembolso_ejecutado_at = ((pg_temp.hoy() - 1)::timestamp + time '23:59:59') AT TIME ZONE fin_zona_negocio() WHERE id = pg_temp.n('c1', 'correccion_id');
UPDATE movimientos_contables SET fecha = pg_temp.hoy() - 1 WHERE id = (SELECT egreso_id FROM devoluciones WHERE orden_id = pg_temp.n('s1', 'orden_id'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.ok(reporte_reembolsos_tiendas(pg_temp.hoy() - 3, pg_temp.hoy() - 3, pg_temp.n('tf', 'id')) -> 'resumen'
       @> '{"devoluciones_en_periodo": 1, "reembolsos_registrados_en_periodo": 90.00, "egreso_contable_en_periodo": 90.00, "dinero_entregado_en_periodo": 0, "pendientes_al_corte": 1, "pendiente_al_corte": 90.00, "pendiente_electronico_al_corte": 90.00}'::jsonb,
  '150-102 hace 3 días: una devolución electrónica registrada ($90 de egreso contable) y $0 entregados — al corte de ese día se debían $90 (electrónico pendiente)');
SELECT pg_temp.ok(reporte_reembolsos_tiendas(pg_temp.hoy() - 1, pg_temp.hoy() - 1, pg_temp.n('tf', 'id')) -> 'resumen'
       @> '{"devoluciones_en_periodo": 1, "egreso_contable_en_periodo": 60.00, "dinero_entregado_en_periodo": 60.00, "entregado_desde_caja": 60.00, "pendientes_al_corte": 1, "pendiente_al_corte": 90.00}'::jsonb,
  '150-103 ayer: la entrega de las 23:59:59 (hora del negocio) cuenta AYER ($60 de caja); sigue pendiente la electrónica de hace 3 días');
SELECT pg_temp.ok(reporte_reembolsos_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')) -> 'resumen'
       @> '{"devoluciones_en_periodo": 1, "reembolsos_registrados_en_periodo": 30.00, "egreso_contable_en_periodo": 30.00, "dinero_entregado_en_periodo": 90.00, "entregado_electronico": 90.00, "entregado_por_administracion": 0,
            "pendientes_al_corte": 1, "pendiente_al_corte": 30.00, "pendiente_efectivo_al_corte": 30.00}'::jsonb,
  '150-104 hoy: se registró una devolución de $30 (egreso contable de hoy) y se ENTREGARON los $90 electrónicos de hace 3 días; los $30 quedan pendientes al corte de hoy (se entregan mañana a las 00:00:01)');
SELECT pg_temp.ok(reporte_reembolsos_tiendas(pg_temp.hoy() + 1, pg_temp.hoy() + 1, pg_temp.n('tf', 'id')) -> 'resumen'
       @> '{"devoluciones_en_periodo": 0, "egreso_contable_en_periodo": 0, "dinero_entregado_en_periodo": 30.00, "entregado_por_administracion": 30.00, "pendientes_al_corte": 0}'::jsonb,
  '150-105 mañana: la entrega de las 00:00:01 cuenta MAÑANA ($30), sin egreso contable ese día: frontera de medianoche en la zona del negocio');
SELECT pg_temp.ok((SELECT sum((reporte_reembolsos_tiendas(d, d, pg_temp.n('tf', 'id')) -> 'resumen' ->> 'dinero_entregado_en_periodo')::numeric) = 180
                      AND sum((reporte_reembolsos_tiendas(d, d, pg_temp.n('tf', 'id')) -> 'resumen' ->> 'egreso_contable_en_periodo')::numeric) = 180
                     FROM generate_series(pg_temp.hoy() - 3, pg_temp.hoy() + 1, interval '1 day') g(d0), LATERAL (SELECT g.d0::date AS d) z)
  AND reporte_reembolsos_tiendas(pg_temp.hoy() - 3, pg_temp.hoy() + 1, pg_temp.n('tf', 'id')) -> 'resumen' @> '{"egreso_contable_en_periodo": 180.00, "dinero_entregado_en_periodo": 180.00, "pendiente_al_corte": 0}'::jsonb,
  '150-106 sumando día por día: egreso contable $180 = dinero entregado $180 (cada peso una sola vez, en su fecha); en el periodo completo no queda nada pendiente');
SELECT pg_temp.falla($q$SELECT reporte_reembolsos_tiendas(NULL, fin_hoy())$q$, '150-107 el periodo es obligatorio', '22023', '%', 'RANGO_INVALIDO');
-- Reportes de E8 sobre el mismo día: la venta, la devolución y la caja cuadran con lo operado.
SELECT pg_temp.ok((SELECT concat_ws('|', x.value ->> 'ventas', x.value ->> 'bruto', x.value ->> 'cobrado') FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')) -> 'por_establecimiento') x) = '3|180.00|180.00'
  AND (SELECT concat_ws('|', x.value ->> 'ventas', x.value ->> 'bruto', x.value ->> 'devoluciones') FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_establecimiento') x) = '1|90.00|0'
  AND (SELECT x.value @> '{"estado": "cerrado", "efectivo_esperado": 130.00, "efectivo_contado": 130.00, "diferencia": 0.00, "reembolsos_desde_caja": 60.00}'::jsonb
         FROM jsonb_array_elements(reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')) -> 'turnos') x)
  AND (reporte_abastecimiento_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'unidades') @> '{"despachadas": 26, "recibidas_correctamente": 25, "danadas": 1, "faltantes": 0}'::jsonb
  AND (SELECT (x.value ->> 'piezas')::int FROM jsonb_array_elements(reporte_inventario_establecimientos(pg_temp.n('tr', 'id')) -> 'por_establecimiento') x) = 24,
  '150-108 [14] reportes de E8 del día: ventas por tienda, caja cerrada sin diferencia, abastecimiento (26 despachadas, 25 buenas, 1 dañada) e inventario de la remota (19 + 6 − 1 vendida = 24)');
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT reporte_reembolsos_tiendas(fin_hoy(), fin_hoy())$q$, '150-109 la conciliación de reembolsos es solo de Administración (la cajera recibe 42501)', '42501');
SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT reporte_reembolsos_tiendas(fin_hoy(), fin_hoy())$q$, '150-110 Ventas central tampoco', '42501');

\echo '── 150: [15] desactivación'
SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(60), %s, false, 'Cierre de temporada')$q$, pg_temp.n('tr', 'id')), '150-120 [15] una tienda con un turno abierto no se desactiva', '22023', '%', 'TURNOS_ABIERTOS');
SELECT pg_temp.como(7);
INSERT INTO t150 VALUES ('zr', cerrar_turno_caja(pg_temp.op(61), pg_temp.n('tur', 'turno_id'), 140));
SELECT pg_temp.como(1);
INSERT INTO t150 VALUES ('off', activar_tienda(pg_temp.op(62), pg_temp.n('tr', 'id'), false, 'Cierre de temporada'));
SELECT pg_temp.ok(NOT (pg_temp.j('off') -> 'activo')::boolean AND (pg_temp.j('zr') ->> 'diferencia')::numeric = 0
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*) FILTER (WHERE tipo = 'activacion'), count(*) FILTER (WHERE tipo = 'desactivacion')) FROM establecimiento_eventos WHERE establecimiento_id = %s$q$, pg_temp.n('tr', 'id'))) = '1|1',
  '150-121 [15] cerrado su turno (esperado 50 + 90 = 140), la tienda remota se desactiva con motivo; quedan su activación y su desactivación registradas');
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT abrir_turno_caja(pg_temp.op(63), %s, 50)$q$, pg_temp.n('kr', 'id')), '150-122 [15] en la tienda desactivada ya no se abre turno ni se vende', '22023|42501');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((guardar_usuario(15007, 'Cajero remota (renombrado)', 'Ventas', 'Inactivo') ->> 'estatus') = 'Inactivo' AND pg_temp.usr(15007) = 'Ventas|Inactivo',
  '150-123 [15] con la tienda DESACTIVADA, su último cajero ya se puede dar de baja: esa es la salida ordenada');
SELECT pg_temp.falla(format($q$SELECT activar_tienda(pg_temp.op(64), %s, true)$q$, pg_temp.n('tr', 'id')), '150-124 y la tienda no se reactiva sin un cajero habilitado', '22023', '%', 'TIENDA_INCOMPLETA');
SELECT pg_temp.ok(pg_temp.q($q$SELECT concat_ws('|', (SELECT stock ->> 'P150-A' FROM cuartos_frios WHERE id = 'CF-150-TR'), (SELECT stock ->> 'P150-B' FROM cuartos_frios WHERE id = 'CF-150-TR'))$q$) = '19|5'
  AND (SELECT (x.value ->> 'bruto')::numeric FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_establecimiento') x) = 90,
  '150-125 [15] la tienda desactivada conserva su inventario y su historia: sus ventas siguen en los reportes');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.q('SELECT count(*) FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE turno_id IS NOT NULL AND created_at > now() - interval ''5 minutes'')') = '0'
  AND md5(pg_get_functiondef('public.guardar_usuario(bigint,text,text,text,text[])'::regprocedure)) = '2b32868497e95e5deaf91af26619ec97',
  '150-126 en todo el recorrido: ninguna cuenta por cobrar de tienda, y guardar_usuario sigue con su huella');
ROLLBACK;
