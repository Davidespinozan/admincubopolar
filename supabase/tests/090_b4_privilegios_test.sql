-- 090_b4_privilegios_test.sql — B4: superficie de privilegios y ejecución.
-- nextval acotado; notificaciones; lectura de payloads de pago; historia
-- canónica (rutas, kardex, pagos, CxC, asientos, costos, órdenes); contratos
-- de CxC; grants, secuencias y EXECUTE; privilegios por defecto; funciones
-- retiradas; folios sin truncar; service_role conserva su autoridad.
-- La parte de CxC directa depende de la 091 (se detecta por el grant).

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t90_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 9001 AND 9009;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 9040 AND 9049 OR ruta_id BETWEEN 9001 AND 9009) OR referencia LIKE 'T90%';
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 9040 AND 9049 OR ruta_id BETWEEN 9001 AND 9009) OR concepto LIKE 'T90%' OR referencia LIKE '%T90%';
  DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 9040 AND 9049;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 9040 AND 9049 OR ruta_id BETWEEN 9001 AND 9009);
  DELETE FROM invoice_attempts WHERE id = 9001;
  DELETE FROM payment_intents WHERE id = 9001;
  DELETE FROM payment_webhook_events WHERE id = 9001;
  DELETE FROM ordenes WHERE cliente_id BETWEEN 9040 AND 9049 OR ruta_id BETWEEN 9001 AND 9009 OR id BETWEEN 9021 AND 9029;
  DELETE FROM costos_historial WHERE concepto LIKE 'T90%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P90-%';
  DELETE FROM produccion WHERE sku LIKE 'P90-%';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 9001 AND 9009 OR operacion_id::text LIKE '90000000-%';
  DELETE FROM notificaciones WHERE titulo LIKE 'T90%';
  DELETE FROM auditoria WHERE detalle LIKE '%T90%';
  DELETE FROM rutas WHERE id BETWEEN 9001 AND 9009;
  DELETE FROM clientes WHERE id BETWEEN 9040 AND 9049;
  DELETE FROM cuartos_frios WHERE id = 'CF-90';
  DELETE FROM productos WHERE sku LIKE 'P90-%';
  DELETE FROM usuarios WHERE id BETWEEN 9001 AND 9019;
  DELETE FROM auth.users WHERE id::text LIKE '90000000-%';
END $$;

BEGIN;
SELECT t90_limpiar();
INSERT INTO auth.users (id, email)
  SELECT ('90000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t90' FROM generate_series(1, 9) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9001, 'Admin 90',      'u1@t90', 'Admin',          'Activo',   '90000000-0000-0000-0000-000000000001'),
  (9002, 'Ventas 90',     'u2@t90', 'Ventas',         'Activo',   '90000000-0000-0000-0000-000000000002'),
  (9003, 'Chofer 90',     'u3@t90', 'Chofer',         'Activo',   '90000000-0000-0000-0000-000000000003'),
  (9004, 'Prod 90',       'u4@t90', 'Producción',     'Activo',   '90000000-0000-0000-0000-000000000004'),
  (9005, 'Fact 90',       'u5@t90', 'Facturación',    'Activo',   '90000000-0000-0000-0000-000000000005'),
  (9006, 'Admin Inac 90', 'u6@t90', 'Admin',          'Inactivo', '90000000-0000-0000-0000-000000000006'),
  (9007, 'Bolsas 90',     'u7@t90', 'Almacén Bolsas', 'Activo',   '90000000-0000-0000-0000-000000000007');
-- u9@t90 (…0009) existe en auth.users pero no tiene perfil.
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES ('P90-A', 'Hielo 90', 'Producto Terminado', 30, 0, 0, NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-90', 'Cuarto 90', '{}'::jsonb);
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (9040, 'Cliente 90', 'XAXX010101000', 180, true, 1000);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_confirmada_at) VALUES
  (9001, 'R-9001', 'Ruta 90 sin historia', NULL, NULL,       'Programada',  CURRENT_DATE, '{}', '{}', '{}', '{}', NULL),
  (9002, 'R-9002', 'Ruta 90 cargada',      NULL, NULL,       'Cargada',     CURRENT_DATE, '{"P90-A": 5}', '{"P90-A": 5}', '{}', '{"P90-A": 5}', now()),
  (9003, 'R-9003', 'Ruta 90 con operación', NULL, NULL,      'Programada',  CURRENT_DATE, '{}', '{}', '{}', '{}', NULL),
  (9004, 'R-9004', 'Ruta 90 en progreso',  9003, 'Chofer 90', 'En progreso', CURRENT_DATE, '{"P90-A": 10}', '{"P90-A": 10}', '{}', '{"P90-A": 10}', now());
INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor, ruta_id, resultado) VALUES ('90000000-0000-0000-0000-00000000c001', 'carga_ruta', 'T90', 'sql', 9003, '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id, facturama_uuid) VALUES
  (9021, 'OV-9021', 9040, 'Cliente 90', '1×P90-A', 30, 'Creada',    'Efectivo', 'Contado', 9002, NULL, NULL),
  (9022, 'OV-9022', 9040, 'Cliente 90', '1×P90-A', 30, 'Entregada', 'Efectivo', 'Contado', 9002, NULL, NULL),
  (9023, 'OV-9023', 9040, 'Cliente 90', '1×P90-A', 30, 'Cancelada', 'Efectivo', 'Contado', 9002, NULL, 'T90-UUID'),
  (9024, 'OV-9024', 9040, 'Cliente 90', '2×P90-A', 60, 'Creada',    'Crédito',  'Credito', 9002, NULL, NULL),
  (9025, 'OV-9025', 9040, 'Cliente 90', '3×P90-A', 90, 'Entregada', 'Crédito',  'Credito', 9002, NULL, NULL),
  (9026, 'OV-9026', 9040, 'Cliente 90', '2×P90-A', 50, 'Entregada', 'Crédito',  'Credito', 9002, NULL, NULL);
INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, monto_original, monto_pagado, saldo_pendiente, estatus) VALUES
  (9040, 9024, 60, 0, 60, 'Pendiente'), (9040, 9025, 90, 0, 90, 'Pendiente'), (9040, 9026, 50, 20, 30, 'Parcial');
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (9040, 9026, 20, 'Efectivo', CURRENT_DATE, 'T90-P', 50, 30);
INSERT INTO notificaciones (tipo, titulo, mensaje, leida) VALUES ('info', 'T90 aviso', 'Mensaje 90', false);
INSERT INTO payment_webhook_events (id, provider, event_type, provider_reference, processed, raw_payload) VALUES (9001, 'mercadopago', 'payment', 'T90-1', true, '{"k": 1}');
INSERT INTO payment_intents (id, orden_id, provider, provider_reference, status, amount, raw_payload) VALUES (9001, 9022, 'mercadopago', 'T90-1', 'paid', 30, '{"k": 1}');
INSERT INTO invoice_attempts (id, orden_id, provider, provider_reference, status, request_payload) VALUES (9001, 9022, 'facturama', 'T90-1', 'ok', '{"k": 1}');
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, orden_id) VALUES
  (CURRENT_DATE, 'Egreso',  'Mermas',      'T90 merma',   5,  'MERMA-T90', NULL),
  (CURRENT_DATE, 'Ingreso', 'Ventas',      'T90 venta',   30, NULL,        9022),
  (CURRENT_DATE, 'Egreso',  'Proveedores', 'T90 manual',  12, 'factura 90', NULL);
INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha, referencia) VALUES ('Fijo', 'Renta', 'T90 costo', 10, CURRENT_DATE, '');
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia) VALUES ('Entrada', 'P90-A', 1, 'T90 fixture', 'sql', 'T90');
COMMIT;

CREATE OR REPLACE FUNCTION t90_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '90000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t90_svc() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t90_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t90_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t90_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t90_n(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$ DECLARE n BIGINT; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION t90_actor(INTEGER), t90_svc(), t90_assert(BOOLEAN, TEXT), t90_err(TEXT, TEXT, TEXT, TEXT), t90_rows(TEXT), t90_n(TEXT) TO anon, authenticated, service_role;
DROP TABLE IF EXISTS t90_ids;
CREATE TEMP TABLE t90_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t90_ids TO anon, authenticated, service_role;
INSERT INTO t90_ids VALUES ('r0', (SELECT last_value FROM folio_r_seq)::text);

\echo '── 090: estado físico'
SELECT t90_assert(to_regprocedure('public.registrar_pago(bigint,numeric,text,bigint)') IS NULL AND to_regprocedure('public.move_stock(character varying,integer,text,text,bigint)') IS NULL
  AND to_regprocedure('public.confirmar_produccion(bigint,bigint)') IS NULL AND to_regprocedure('public.timbrar_orden(character varying,bigint)') IS NULL
  AND to_regprocedure('public.check_orden_transition()') IS NULL AND to_regprocedure('public.check_produccion_transition()') IS NULL
  AND to_regprocedure('public.check_stock_positive()') IS NULL AND to_regprocedure('public.prevent_mutation()') IS NULL, '090-01 las 8 funciones sin uso ya no existen');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_operaciones' AND policyname = 'admin_all'), '090-02 stock_operaciones sin la policy admin_all');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype AND p.proname <> 'rls_auto_enable'
  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), '090-03 funciones de disparador: sin EXECUTE para anon ni authenticated');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'rls_auto_enable' AND p.proname !~ '^t[0-9]*_'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')), '090-04 ninguna función de la aplicación ejecutable por anon');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND c.relname !~ '^t[0-9]*_'
  AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
       OR (c.relkind = 'S' AND has_sequence_privilege('anon', c.oid, 'USAGE')))), '090-05 anon sin privilegios en tablas, vistas ni secuencias');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relname !~ '^t[0-9]*_'
  AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'REFERENCES') OR has_table_privilege('authenticated', c.oid, 'TRIGGER'))), '090-06 authenticated sin TRUNCATE, REFERENCES ni TRIGGER');
SELECT t90_assert((
  SELECT coalesce(string_agg(x, ',' ORDER BY x), '') FROM (
    SELECT c.relname || ':' || p.priv AS x FROM pg_class c CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relname !~ '^t[0-9]*_' AND has_table_privilege('authenticated', c.oid, p.priv)) s
  ) = (
  SELECT string_agg(x, ',' ORDER BY x) FROM (
    SELECT t || ':' || op AS x FROM (VALUES
      ('auditoria','INSERT'), ('camiones','INSERT'), ('camiones','UPDATE'), ('chofer_ubicaciones','INSERT'),
      ('clientes','INSERT'), ('clientes','UPDATE'), ('clientes','DELETE'), ('comodatos','INSERT'), ('comodatos','UPDATE'), ('comodatos','DELETE'),
      ('configuracion_empresa','UPDATE'), ('costos_fijos','INSERT'), ('costos_fijos','UPDATE'), ('costos_fijos','DELETE'), ('costos_historial','INSERT'),
      ('cuartos_frios','INSERT'), ('cuartos_frios','UPDATE'), ('cuartos_frios','DELETE'),
      ('cuentas_por_pagar','INSERT'), ('cuentas_por_pagar','UPDATE'), ('cuentas_por_pagar','DELETE'), 
      ('empleados','INSERT'), ('empleados','UPDATE'), ('empleados','DELETE'), ('error_log','INSERT'),
      ('leads','INSERT'), ('leads','UPDATE'), ('leads','DELETE'), ('movimientos_contables','INSERT'), ('movimientos_contables','UPDATE'), ('movimientos_contables','DELETE'),
      ('notificaciones','INSERT'), ('notificaciones','UPDATE'),
      ('ordenes','UPDATE'), ('ordenes','DELETE'), ('precios_esp','INSERT'), ('precios_esp','UPDATE'), ('precios_esp','DELETE'),
      ('produccion','UPDATE'), ('productos','INSERT'), ('productos','UPDATE'), ('productos','DELETE'),
      ('rutas','INSERT'), ('rutas','UPDATE'), ('rutas','DELETE'), ('usuarios','INSERT'), ('usuarios','UPDATE'), ('usuarios','DELETE')) m(t, op)
    WHERE to_regclass('public.' || t) IS NOT NULL
    UNION ALL
    SELECT 'cuentas_por_cobrar:' || op FROM (VALUES ('UPDATE'), ('DELETE')) v(op)
     WHERE has_table_privilege('authenticated', 'cuentas_por_cobrar', 'UPDATE')
    UNION ALL  -- 094 retira el DELETE de produccion (se revierte, no se borra)
    SELECT 'produccion:DELETE' WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_productos_guard_stock')
    UNION ALL  -- 097 retira el INSERT REST de caja (cerrar_caja_ruta)
    SELECT 'cierres_diarios:INSERT' WHERE has_table_privilege('authenticated', 'cierres_diarios', 'INSERT')
    UNION ALL  -- 099 retira el INSERT REST de pago a proveedor (pagar_cuenta_por_pagar)
    SELECT 'pagos_proveedores:INSERT' WHERE has_table_privilege('authenticated', 'pagos_proveedores', 'INSERT')
    UNION ALL  -- 105 retira la escritura REST de devoluciones (contrato de 104)
    SELECT x FROM (VALUES ('devoluciones:INSERT'), ('devoluciones:DELETE')) v(x) WHERE has_table_privilege('authenticated', 'devoluciones', 'INSERT')
    UNION ALL  -- 103 retira el INSERT REST de kardex (contratos de 102)
    SELECT 'inventario_mov:INSERT' WHERE has_table_privilege('authenticated', 'inventario_mov', 'INSERT')
    UNION ALL  -- 101 retira la escritura REST de nómina (contratos de 100)
    SELECT x FROM (VALUES ('nomina_periodos:INSERT'), ('nomina_periodos:UPDATE'), ('nomina_recibos:INSERT')) v(x)
     WHERE has_table_privilege('authenticated', 'nomina_periodos', 'INSERT')) s
  ), '090-07 DML de authenticated = exactamente el mapa de llamadores del frontend (pagos sin DML; CxC sin DML tras 091)');
SELECT t90_assert(NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
  AND (has_sequence_privilege('authenticated', c.oid, 'SELECT') OR has_sequence_privilege('authenticated', c.oid, 'UPDATE')
       OR (has_sequence_privilege('authenticated', c.oid, 'USAGE') AND c.oid NOT IN (
         SELECT pg_get_serial_sequence('public.' || quote_ident(t), 'id')::regclass FROM unnest(ARRAY['auditoria','camiones','chofer_ubicaciones','cierres_diarios','clientes','comodatos','costos_fijos','costos_historial',
           'cuartos_frios','cuentas_por_pagar','devoluciones','empleados','error_log','inventario_mov','leads','movimientos_contables','nomina_periodos','nomina_recibos',
           'notificaciones','pagos_proveedores','precios_esp','productos','rutas','usuarios']) t WHERE pg_get_serial_sequence('public.' || quote_ident(t), 'id') IS NOT NULL)))), '090-08 secuencias: authenticated solo USAGE en el id de las tablas donde el frontend inserta');
SELECT t90_assert(NOT has_sequence_privilege('authenticated', 'folio_r_seq', 'USAGE') AND NOT has_sequence_privilege('authenticated', 'folio_op_seq', 'USAGE') AND NOT has_sequence_privilege('authenticated', 'folio_ov_seq', 'USAGE'), '090-09 secuencias de folio sin acceso directo de la API');
SELECT t90_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp') FROM pg_proc
  WHERE oid IN ('public.nextval(text)'::regprocedure, 'public.b4_ruta_con_historia(bigint)'::regprocedure, 'public.anular_cxc_orden(bigint)'::regprocedure, 'public.ajustar_cxc_devolucion(bigint,numeric)'::regprocedure, 'public.erp_actor_etiqueta()'::regprocedure))
  AND (SELECT bool_and(array_to_string(proconfig, ';') = 'search_path=public, pg_temp') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('b4_escritura_api', 'b4_asiento_de_contrato', 'notificaciones_guard', 'rutas_guard_borrado', 'inventario_mov_guard', 'movimientos_contables_guard', 'costos_historial_guard', 'ordenes_guard_borrado',
                         'fin_ctx_activo', 'fin_es_credito', 'fin_hoy', 'fin_jwt_role', 'fin_marcar_ctx', 'update_updated_at', 'set_updated_at_payment_intents')), '090-10 search_path fijo en las funciones nuevas y en los helpers invocadores');
SELECT t90_assert((SELECT bool_and(NOT prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('b4_escritura_api', 'notificaciones_guard', 'rutas_guard_borrado', 'inventario_mov_guard', 'movimientos_contables_guard', 'costos_historial_guard', 'ordenes_guard_borrado')), '090-11 las guardas de historia son SECURITY INVOKER (leen current_user real)');
SELECT t90_assert(erp_actor_etiqueta() = 'sql', '090-12 erp_actor_etiqueta sin JWT = sql (antes NULL)');

\echo '── 090: nextval acotado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
INSERT INTO t90_ids VALUES ('r1', nextval('folio_r_seq')::text), ('r2', nextval('public.folio_r_seq')::text);
SELECT t90_err($q$SELECT nextval('folio_op_seq')$q$, '090-21 Admin: otra secuencia de folio denegada', '42501', '%no permitida%');
SELECT t90_err($q$SELECT nextval('ordenes_id_seq')$q$, '090-22 Admin: secuencia de id denegada', '42501', '%no permitida%');
SELECT t90_err($q$SELECT nextval('folio_r_seq; x')$q$, '090-23 Admin: texto arbitrario denegado', '42501', '%no permitida%');
SELECT t90_err($q$SELECT pg_catalog.nextval('folio_op_seq')$q$, '090-24 Admin: pg_catalog.nextval directo sin privilegio de secuencia', '42501');
COMMIT;
SELECT t90_assert((SELECT v::bigint FROM t90_ids WHERE k = 'r2') = (SELECT v::bigint FROM t90_ids WHERE k = 'r1') + 1, '090-20 Admin activo: folio_r_seq avanza (con y sin esquema)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(2);
SELECT t90_err($q$SELECT nextval('folio_r_seq')$q$, '090-25 Ventas: nextval denegado', '42501', '%no autorizado%');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(3);
SELECT t90_err($q$SELECT nextval('folio_r_seq')$q$, '090-26 Chofer: nextval denegado', '42501', '%no autorizado%');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(6);
SELECT t90_err($q$SELECT nextval('folio_r_seq')$q$, '090-27 Admin inactivo: nextval denegado', '42501', '%no autorizado%');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(9);
SELECT t90_err($q$SELECT nextval('folio_r_seq')$q$, '090-28 JWT sin perfil: nextval denegado', '42501', '%no autorizado%');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t90_err($q$SELECT nextval('folio_r_seq')$q$, '090-29 anon: sin EXECUTE', '42501');
ROLLBACK;
SELECT t90_assert((SELECT last_value FROM folio_r_seq) = (SELECT v::bigint FROM t90_ids WHERE k = 'r2'), '090-30 los intentos denegados no consumen folios');
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(nextval('folio_r_seq') > 0, '090-31 service_role: nextval de folio_r_seq sigue disponible');
ROLLBACK;

\echo '── 090: notificaciones'
BEGIN; SET LOCAL ROLE anon;
SELECT t90_err($q$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T90 anon', 'x')$q$, '090-40 anon: INSERT denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(6);
SELECT t90_err($q$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T90 inactivo', 'x')$q$, '090-41 usuario inactivo: INSERT denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(9);
SELECT t90_err($q$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T90 sin perfil', 'x')$q$, '090-42 JWT sin perfil: INSERT denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(3);
SELECT t90_assert(t90_rows($q$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T90 chofer', 'aviso')$q$) = 1, '090-43 actor activo: INSERT permitido');
SELECT t90_err($q$UPDATE notificaciones SET titulo = 'T90 cambiado' WHERE titulo = 'T90 aviso'$q$, '090-44 cambiar el título denegado', '42501', '%leída%');
SELECT t90_err($q$UPDATE notificaciones SET mensaje = 'otro', leida = true WHERE titulo = 'T90 aviso'$q$, '090-45 marcar leída junto con otro cambio denegado', '42501', '%leída%');
SELECT t90_assert(t90_rows($q$UPDATE notificaciones SET leida = true WHERE titulo = 'T90 aviso'$q$) = 1, '090-46 marcar como leída permitido');
SELECT t90_err($q$DELETE FROM notificaciones WHERE titulo = 'T90 aviso'$q$, '090-47 DELETE sin privilegio', '42501');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(t90_rows($q$UPDATE notificaciones SET push_enviada = true, mensaje = 'backend' WHERE titulo = 'T90 aviso'$q$) = 1, '090-48 service_role: actualiza cualquier columna (push_enviada)');
ROLLBACK;

\echo '── 090: payloads de pago'
DO $do$
DECLARE a RECORD; v_w BIGINT; v_i BIGINT; v_f BIGINT;
BEGIN
  FOR a IN SELECT * FROM (VALUES (1, 'Admin', true), (5, 'Facturación', true), (2, 'Ventas', false), (3, 'Chofer', false), (4, 'Producción', false), (7, 'Almacén Bolsas', false), (6, 'Admin inactivo', false), (9, 'JWT sin perfil', false)) x(k, tag, ve) LOOP
    PERFORM t90_actor(a.k);
    SET LOCAL ROLE authenticated;
    v_w := (SELECT count(*) FROM payment_webhook_events WHERE id = 9001);
    v_i := (SELECT count(*) FROM payment_intents WHERE id = 9001);
    v_f := (SELECT count(*) FROM invoice_attempts WHERE id = 9001);
    RESET ROLE;
    PERFORM t90_assert((v_w = 1) = a.ve AND (v_i = 1) = a.ve AND (v_f = 1) = a.ve, format('090-5x %s: lectura de webhook/intent/intento de factura = %s', a.tag, a.ve));
  END LOOP;
END $do$;
BEGIN; SET LOCAL ROLE anon;
SELECT t90_err($q$SELECT count(*) FROM payment_webhook_events$q$, '090-58 anon: sin SELECT de webhooks', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert((SELECT count(*) FROM payment_webhook_events WHERE id = 9001) = 1 AND (SELECT count(*) FROM payment_intents WHERE id = 9001) = 1, '090-59 service_role: lee webhooks e intents');
ROLLBACK;

\echo '── 090: rutas con historia'
SELECT t90_assert(NOT b4_ruta_con_historia(9001) AND b4_ruta_con_historia(9002) AND b4_ruta_con_historia(9003) AND b4_ruta_con_historia(9004), '090-60 detección de historia (sin historia / cargada / con operación / en progreso)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_err($q$DELETE FROM rutas WHERE id = 9002$q$, '090-61 Admin: borrar ruta cargada denegado', '42501', '%historia%');
SELECT t90_err($q$DELETE FROM rutas WHERE id = 9003$q$, '090-62 Admin: borrar ruta con operación de stock denegado', '42501', '%historia%');
SELECT t90_err($q$DELETE FROM rutas WHERE id = 9004$q$, '090-63 Admin: borrar ruta en progreso denegado', '42501', '%historia%');
SELECT t90_assert(t90_rows($q$DELETE FROM rutas WHERE id = 9001$q$) = 1, '090-64 Admin: borrar ruta sin historia permitido');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(t90_rows($q$DELETE FROM rutas WHERE id = 9002$q$) = 1, '090-65 service_role: mantenimiento de rutas con historia disponible (ruta cargada)');
ROLLBACK;
SELECT t90_assert((SELECT count(*) FROM rutas WHERE id BETWEEN 9001 AND 9004) = 4, '090-66 las rutas siguen intactas');

\echo '── 090: kardex append-only'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_err($q$UPDATE inventario_mov SET cantidad = 99 WHERE producto = 'P90-A'$q$, '090-70 Admin: UPDATE del kardex denegado (sin privilegio; la guarda es segunda capa)', '42501');
SELECT t90_err($q$DELETE FROM inventario_mov WHERE producto = 'P90-A'$q$, '090-71 Admin: DELETE del kardex denegado (sin privilegio; la guarda es segunda capa)', '42501');
-- 103: sin INSERT REST en el kardex (lo escriben los contratos); antes, el ajuste manual sin referencia se permitía.
SELECT t90_assert(CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN t90_rows($q$INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Entrada', 'P90-A', 2, 'Ajuste manual: T90', 'Admin 90')$q$) = 1 ELSE true END, '090-72 Admin: ajuste manual sin referencia (permitido antes de 103)');
DO $do$ BEGIN IF NOT has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN PERFORM t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES ('Entrada', 'P90-A', 2, 'Ajuste manual: T90', 'Admin 90')$q$, '090-72b (103) Admin: kardex directo negado', '42501'); END IF; END $do$;
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, ruta_id) VALUES ('Salida', 'P90-A', 1, 9004)$q$, '090-73 Admin: movimiento con ruta_id denegado', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, operacion_id) VALUES ('Salida', 'P90-A', 1, gen_random_uuid())$q$, '090-74 Admin: movimiento con operacion_id denegado', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, referencia) VALUES ('Salida', 'P90-A', 1, 'carga_ruta/9004')$q$, '090-75 Admin: referencia carga_ruta/ denegada', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, referencia) VALUES ('Entrada', 'P90-A', 1, 'produccion/T90')$q$, '090-76 Admin: referencia produccion/ denegada', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad, referencia) VALUES ('Salida', 'P90-A', 1, 'MERMA-T90')$q$, '090-77 Admin: referencia MERMA- denegada', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad) VALUES ('Merma', 'P90-A', 1)$q$, '090-78 Admin: tipo Merma denegado', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad) VALUES ('Traspaso entrada', 'P90-A', 1)$q$, '090-79 Admin: tipo Traspaso entrada denegado', '42501', CASE WHEN has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') THEN '%reservado%' END);
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(2);
SELECT t90_err($q$INSERT INTO inventario_mov (tipo, producto, cantidad) VALUES ('Entrada', 'P90-A', 1)$q$, '090-80 Ventas: INSERT en el kardex denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(t90_rows($q$UPDATE inventario_mov SET origen = 'mantenimiento' WHERE producto = 'P90-A'$q$) = 1, '090-81 service_role: mantenimiento del kardex disponible');
ROLLBACK;

\echo '── 090: pagos y CxC sin DML directo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_err($q$INSERT INTO pagos (cliente_id, orden_id, monto, referencia, saldo_antes, saldo_despues) VALUES (9040, 9022, 1, 'T90-X', 0, 0)$q$, '090-90 Admin: INSERT en pagos sin privilegio', '42501');
SELECT t90_err($q$UPDATE pagos SET monto = 1 WHERE referencia = 'T90-P'$q$, '090-91 Admin: UPDATE en pagos sin privilegio', '42501');
SELECT t90_err($q$DELETE FROM pagos WHERE referencia = 'T90-P'$q$, '090-92 Admin: DELETE en pagos sin privilegio', '42501');
SELECT t90_err($q$INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, monto_original, saldo_pendiente) VALUES (9040, 9021, 30, 30)$q$, '090-93 Admin: INSERT en CxC sin privilegio', '42501');
ROLLBACK;
DO $do$
BEGIN
  IF has_table_privilege('authenticated', 'cuentas_por_cobrar', 'UPDATE') THEN
    RAISE NOTICE 'OK: 090-94 (091 aún no aplicada: UPDATE/DELETE de CxC del bundle anterior se conserva)';
    RETURN;
  END IF;
  PERFORM t90_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t90_err($q$UPDATE cuentas_por_cobrar SET saldo_pendiente = 0 WHERE orden_id = 9025$q$, '090-94 Admin: UPDATE en CxC sin privilegio (091)', '42501');
  PERFORM t90_err($q$DELETE FROM cuentas_por_cobrar WHERE orden_id = 9024$q$, '090-95 Admin: DELETE en CxC sin privilegio (091)', '42501');
  RESET ROLE;
END $do$;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(t90_rows($q$UPDATE cuentas_por_cobrar SET saldo_pendiente = saldo_pendiente WHERE orden_id = 9025$q$) = 1
  AND t90_rows($q$INSERT INTO pagos (cliente_id, orden_id, monto, referencia, saldo_antes, saldo_despues) VALUES (9040, 9025, 1, 'T90-S', 0, 0)$q$) = 1, '090-96 service_role: escribe CxC y pagos (webhooks)');
ROLLBACK;

\echo '── 090: contratos de CxC'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(2);
SELECT t90_err($q$SELECT anular_cxc_orden(9024)$q$, '090-100 Ventas: anular CxC denegado', '42501');
SELECT t90_err($q$SELECT ajustar_cxc_devolucion(9025, 10)$q$, '090-101 Ventas: ajustar CxC denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(6);
SELECT t90_err($q$SELECT anular_cxc_orden(9024)$q$, '090-102 Admin inactivo: anular CxC denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t90_err($q$SELECT anular_cxc_orden(9024)$q$, '090-103 anon: sin EXECUTE', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
INSERT INTO t90_ids VALUES ('a1', anular_cxc_orden(9024)::text), ('a0', anular_cxc_orden(9021)::text);
SELECT t90_err($q$SELECT anular_cxc_orden(9026)$q$, '090-104 CxC con cobros: no se anula', '22023', '%cobros%');
SELECT t90_err($q$SELECT anular_cxc_orden(9099)$q$, '090-105 orden inexistente rechazada', '22023');
-- 105: ajustar_cxc_devolucion sin EXECUTE de la API (lo hace registrar_devolucion); el mismo ajuste como SQL de confianza.
DO $do$ BEGIN
  IF has_function_privilege('authenticated', 'public.ajustar_cxc_devolucion(bigint,numeric)', 'EXECUTE') THEN
    INSERT INTO t90_ids VALUES ('d1', ajustar_cxc_devolucion(9025, 30)::text);
  ELSE
    PERFORM t90_err($q$SELECT ajustar_cxc_devolucion(9025, 30)$q$, '090-105b (105) Admin: ajustar CxC por API negado', '42501');
    RESET ROLE;
    INSERT INTO t90_ids VALUES ('d1', ajustar_cxc_devolucion(9025, 30)::text);
    SET LOCAL ROLE authenticated;
  END IF;
END $do$;
SELECT t90_err($q$SELECT ajustar_cxc_devolucion(9025, 0)$q$, '090-106 monto 0 rechazado', CASE WHEN has_function_privilege('authenticated', 'public.ajustar_cxc_devolucion(bigint,numeric)', 'EXECUTE') THEN '22023' ELSE '42501' END);
COMMIT;
SELECT t90_assert((SELECT v::jsonb ->> 'anulada' FROM t90_ids WHERE k = 'a1') = 'true' AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar WHERE orden_id = 9024)
  AND (SELECT v::jsonb ->> 'motivo' FROM t90_ids WHERE k = 'a0') = 'sin_cxc', '090-107 anular: CxC sin cobros eliminada; orden sin CxC → sin_cxc');
SELECT t90_assert((SELECT monto_original = 60 AND saldo_pendiente = 60 AND estatus = 'Pendiente' FROM cuentas_por_cobrar WHERE orden_id = 9025), '090-108 devolución: monto_original 90−30, saldo 90−30, Pendiente');
SELECT t90_assert((SELECT saldo FROM clientes WHERE id = 9040) = 180 - 60 - 30, '090-109 saldo del cliente revertido por ambos contratos (180 − 60 − 30)');
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert((ajustar_cxc_devolucion(9025, 1) ->> 'ajustada') = 'true', '090-110 service_role: contrato de CxC disponible');
ROLLBACK;

\echo '── 090: asientos contables'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_err($q$UPDATE movimientos_contables SET monto = 1 WHERE concepto = 'T90 merma'$q$, '090-120 Admin: editar asiento de merma denegado', '42501', '%contrato%');
SELECT t90_err($q$DELETE FROM movimientos_contables WHERE concepto = 'T90 merma'$q$, '090-121 Admin: borrar asiento de merma denegado', '42501', '%contrato%');
SELECT t90_err($q$UPDATE movimientos_contables SET concepto = 'T90 x' WHERE concepto = 'T90 venta'$q$, '090-122 Admin: editar ingreso de venta de una orden denegado', '42501', '%contrato%');
SELECT t90_err($q$DELETE FROM movimientos_contables WHERE concepto = 'T90 venta'$q$, '090-123 Admin: borrar ingreso de venta de una orden denegado', '42501', '%contrato%');
SELECT t90_err($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia) VALUES (CURRENT_DATE, 'Egreso', 'Producción', 'T90 p', 1, 'PROD-T90')$q$, '090-124 Admin: asiento con referencia PROD- denegado', '42501', '%contrato%');
SELECT t90_err($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (CURRENT_DATE, 'Ingreso', 'Cobranza', 'T90 c', 1, 9022)$q$, '090-125 Admin: ingreso de cobranza de una orden denegado', '42501', '%contrato%');
SELECT t90_err($q$UPDATE movimientos_contables SET referencia = 'MERMA-T90b' WHERE concepto = 'T90 manual'$q$, '090-126 Admin: convertir un asiento manual en uno de contrato denegado', '42501', '%contrato%');
SELECT t90_assert(t90_rows($q$UPDATE movimientos_contables SET monto = 13 WHERE concepto = 'T90 manual'$q$) = 1, '090-127 Admin: editar asiento manual permitido');
SELECT t90_assert(CASE WHEN has_table_privilege('authenticated', 'public.devoluciones', 'INSERT') THEN t90_rows($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (CURRENT_DATE, 'Egreso', 'Devoluciones', 'T90 devolución', 30, 9025)$q$) = 1 ELSE true END, '090-128 Admin: egreso de devolución ligado a orden (manual antes de 105)');
SELECT t90_assert(has_table_privilege('authenticated', 'public.devoluciones', 'INSERT') OR t90_rows($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Egreso', 'Devoluciones', 'T90 devolución sin orden', 30)$q$) = 1, '090-128b (105) Admin: egreso manual de Devoluciones sin orden permitido');
DO $do$ BEGIN IF NOT has_table_privilege('authenticated', 'public.devoluciones', 'INSERT') THEN PERFORM t90_err($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id) VALUES (CURRENT_DATE, 'Egreso', 'Devoluciones', 'T90 devolución', 30, 9025)$q$, '090-128c (105) Admin: reembolso ligado a orden forjado negado', '42501'); END IF; END $do$;
SELECT t90_assert(t90_rows($q$INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES (CURRENT_DATE, 'Ingreso', 'Ventas', 'T90 ingreso manual', 5)$q$) = 1, '090-129 Admin: ingreso manual sin orden permitido');
SELECT t90_assert(t90_rows($q$DELETE FROM movimientos_contables WHERE concepto = 'T90 manual'$q$) = 1, '090-130 Admin: borrar asiento manual permitido');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t90_svc();
SELECT t90_assert(t90_rows($q$UPDATE movimientos_contables SET concepto = 'T90 merma' WHERE concepto = 'T90 merma'$q$) = 1, '090-131 service_role: mantenimiento de asientos disponible');
ROLLBACK;
SELECT t90_assert(b4_asiento_de_contrato('Egreso', 'Mermas', NULL, 'MERMA-1') AND b4_asiento_de_contrato('Egreso', 'Producción', NULL, 'PROD-1') AND b4_asiento_de_contrato('Egreso', 'Proveedores', NULL, 'recepcion_compra/x')
  AND b4_asiento_de_contrato('Ingreso', 'Ventas', 1, NULL) AND NOT b4_asiento_de_contrato('Ingreso', 'Ventas', NULL, NULL) AND NOT b4_asiento_de_contrato('Egreso', 'Devoluciones', 1, NULL)
  AND NOT b4_asiento_de_contrato('Egreso', 'Proveedores', NULL, 'x MERMA-1'), '090-132 regla de asiento de contrato (espejo del frontend)');

\echo '── 090: historial de costos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_assert(t90_rows($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha, referencia) VALUES ('Variable', 'Gas', 'T90 variable', 3, CURRENT_DATE, '')$q$) = 1, '090-140 Admin: costo variable permitido');
SELECT t90_err($q$UPDATE costos_historial SET monto = 1 WHERE concepto = 'T90 costo'$q$, '090-141 Admin: editar historial de costos denegado (sin privilegio; la guarda es segunda capa)', '42501');
SELECT t90_err($q$DELETE FROM costos_historial WHERE concepto = 'T90 costo'$q$, '090-142 Admin: borrar historial de costos denegado (sin privilegio; la guarda es segunda capa)', '42501');
SELECT t90_err($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha) VALUES ('Producción', 'Producción', 'T90 p', 1, CURRENT_DATE)$q$, '090-143 Admin: costo de tipo Producción denegado', '42501', '%producción%');
SELECT t90_err($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, fecha, referencia) VALUES ('Variable', 'Gas', 'T90 p', 1, CURRENT_DATE, 'PROD-T90')$q$, '090-144 Admin: referencia PROD- denegada', '42501', '%producción%');
ROLLBACK;

\echo '── 090: borrado de órdenes'
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(1);
SELECT t90_err($q$DELETE FROM ordenes WHERE id = 9022$q$, '090-150 Admin: borrar orden Entregada denegado', '42501', '%se cancela%');
SELECT t90_err($q$DELETE FROM ordenes WHERE id = 9023$q$, '090-151 Admin: borrar orden Cancelada con CFDI denegado', '42501', '%se cancela%');
SELECT t90_assert(t90_rows($q$DELETE FROM ordenes WHERE id = 9021$q$) = 1, '090-152 Admin: borrar orden Creada sin CFDI permitido');
ROLLBACK;

\echo '── 090: privilegios por defecto'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE NOTICE 'OK: 090-160 (sin rol postgres en este entorno: se verifica en producción)';
    RETURN;
  END IF;
  PERFORM t90_assert(NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
      WHERE d.defaclrole = 'postgres'::regrole AND (d.defaclnamespace = 'public'::regnamespace OR d.defaclnamespace = 0)
        AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)), '090-160 pg_default_acl de postgres: nada para PUBLIC, anon ni authenticated');
  PERFORM t90_assert(EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclnamespace = 0 AND defaclobjtype = 'f'), '090-161 entrada global de funciones de postgres (sin EXECUTE de PUBLIC)');
END $do$;
BEGIN;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN RETURN; END IF;
  SET LOCAL ROLE postgres;
  CREATE TABLE public.t90_da (id BIGSERIAL PRIMARY KEY, x TEXT);
  CREATE FUNCTION public.t90_da_f() RETURNS INTEGER LANGUAGE sql AS 'SELECT 1';
  RESET ROLE;
  PERFORM t90_assert(NOT has_table_privilege('anon', 'public.t90_da', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.t90_da', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.t90_da', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.t90_da', 'TRUNCATE')
    AND has_table_privilege('service_role', 'public.t90_da', 'SELECT'), '090-162 tabla nueva de postgres: nada para anon/authenticated; service_role conserva');
  PERFORM t90_assert(NOT has_sequence_privilege('anon', 'public.t90_da_id_seq', 'USAGE') AND NOT has_sequence_privilege('authenticated', 'public.t90_da_id_seq', 'USAGE'), '090-163 secuencia nueva de postgres: nada para anon/authenticated');
  PERFORM t90_assert(NOT has_function_privilege('anon', 'public.t90_da_f()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.t90_da_f()', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.t90_da_f()'::regprocedure AND a.grantee = 0)
    AND has_function_privilege('service_role', 'public.t90_da_f()', 'EXECUTE'), '090-164 función nueva de postgres: sin EXECUTE de PUBLIC/anon/authenticated; service_role conserva');
END $do$;
ROLLBACK;

\echo '── 090: folios sin truncar'
SELECT t90_assert((SELECT bool_and(pg_get_functiondef(oid) ~ 'greatest\((3|4), length\(q\.s\)\)' AND pg_get_functiondef(oid) !~ 'lpad\([^;]*nextval[^;]*, [34], ''0''\)')
  FROM pg_proc WHERE oid IN ('public.registrar_produccion(uuid,text,text,text,integer,text)'::regprocedure, 'public.registrar_transformacion(uuid,text,integer,text,integer,text,text)'::regprocedure,
                             'public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)), '090-170 OP-/TR-/OV-: padding de ancho mínimo en los tres contratos');
INSERT INTO t90_ids VALUES ('op0', (SELECT last_value FROM folio_op_seq)::text), ('ov0', (SELECT last_value FROM folio_ov_seq)::text);
SELECT setval('folio_op_seq', 999, true);
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(4);
SELECT registrar_produccion('90000000-0000-0000-0000-00000000f001', 'Turno 1', 'Máquina 90', 'P90-A', 1, 'CF-90');
COMMIT;
SELECT t90_assert(EXISTS (SELECT 1 FROM produccion WHERE folio = 'OP-1000' AND sku = 'P90-A'), '090-171 folio_op_seq 999 → 1000: OP-1000 (sin truncar a OP-100)');
SELECT setval('folio_ov_seq', 9999, true);
BEGIN; SET LOCAL ROLE authenticated; SELECT t90_actor(3);
SELECT cerrar_ruta_financiero('90000000-0000-0000-0000-00000000f002'::uuid, 9004, '[{"express":true,"pago":"Efectivo","items":[{"sku":"P90-A","cant":1,"precio":30}]}]'::jsonb);
COMMIT;
SELECT t90_assert(EXISTS (SELECT 1 FROM ordenes WHERE folio = 'OV-10000' AND ruta_id = 9004), '090-172 folio_ov_seq 9999 → 10000: OV-10000 (sin truncar a OV-1000)');
SELECT setval('folio_op_seq', GREATEST((SELECT v::bigint FROM t90_ids WHERE k = 'op0'), 1000), true);
SELECT setval('folio_ov_seq', GREATEST((SELECT v::bigint FROM t90_ids WHERE k = 'ov0'), 10000), true);

BEGIN; SELECT t90_limpiar(); COMMIT;
\echo '── 090: TODAS LAS PRUEBAS OK'
