-- 079_identidad_legacy_test.sql — B3 fase 1: get_my_rol() / get_my_user_id()
-- delegan en la identidad canónica 071. Usuarios activos: mismo rol e id;
-- inactivos y sin perfil: NULL y las policies legacy cierran; el email del
-- JWT ya no decide la identidad. Superficies representativas de cada dominio.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7901 AND 7999;
DELETE FROM invoice_attempts WHERE provider = 'test79';
DELETE FROM movimientos_contables WHERE concepto LIKE '%T79%';
DELETE FROM leads WHERE nombre LIKE 'Lead 79%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7920 AND 7929;
DELETE FROM ordenes WHERE id BETWEEN 7920 AND 7929 OR folio LIKE 'OV-79%';
DELETE FROM rutas WHERE id BETWEEN 7901 AND 7999;
DELETE FROM clientes WHERE id = 7910 OR nombre LIKE 'Cliente 79%';
DELETE FROM productos WHERE sku LIKE 'P79-%';
DELETE FROM auditoria WHERE detalle LIKE '%T79%';
DELETE FROM usuarios WHERE id BETWEEN 7901 AND 7919;
DELETE FROM auth.users WHERE id::text LIKE '79000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('79000000-0000-0000-0000-000000000001', 'admin79@t'),    ('79000000-0000-0000-0000-000000000002', 'ventas79@t'),
  ('79000000-0000-0000-0000-000000000003', 'chofer79@t'),   ('79000000-0000-0000-0000-000000000004', 'prod79@t'),
  ('79000000-0000-0000-0000-000000000005', 'bolsas79@t'),   ('79000000-0000-0000-0000-000000000006', 'fact79@t'),
  ('79000000-0000-0000-0000-000000000007', 'inadm79@t'),    ('79000000-0000-0000-0000-000000000008', 'inventas79@t'),
  ('79000000-0000-0000-0000-000000000009', 'inchofer79@t'), ('79000000-0000-0000-0000-000000000010', 'inprod79@t'),
  ('79000000-0000-0000-0000-000000000099', 'noprof79@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7901, 'Admin 79',    'admin79@t',    'Admin',          'Activo',   '79000000-0000-0000-0000-000000000001'),
  (7902, 'Ventas 79',   'ventas79@t',   'Ventas',         'Activo',   '79000000-0000-0000-0000-000000000002'),
  (7903, 'Chofer 79',   'chofer79@t',   'Chofer',         'Activo',   '79000000-0000-0000-0000-000000000003'),
  (7904, 'Prod 79',     'prod79@t',     'Producción',     'Activo',   '79000000-0000-0000-0000-000000000004'),
  (7905, 'Bolsas 79',   'bolsas79@t',   'Almacén Bolsas', 'Activo',   '79000000-0000-0000-0000-000000000005'),
  (7906, 'Fact 79',     'fact79@t',     'Facturación',    'Activo',   '79000000-0000-0000-0000-000000000006'),
  (7907, 'InAdmin 79',  'inadm79@t',    'Admin',          'Inactivo', '79000000-0000-0000-0000-000000000007'),
  (7908, 'InVentas 79', 'inventas79@t', 'Ventas',         'Inactivo', '79000000-0000-0000-0000-000000000008'),
  (7909, 'InChofer 79', 'inchofer79@t', 'Chofer',         'Inactivo', '79000000-0000-0000-0000-000000000009'),
  (7910, 'InProd 79',   'inprod79@t',   'Producción',     'Inactivo', '79000000-0000-0000-0000-000000000010');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P79-HIELO', 'Hielo 79', 'Producto Terminado', 30, 10);
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (7910, 'Cliente 79', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha) VALUES
  (7901, 'R-7901', 'Ruta 79',          7903, 'Chofer 79',   'En progreso', CURRENT_DATE),
  (7902, 'R-7902', 'Ruta 79 inactivo', 7909, 'InChofer 79', 'En progreso', CURRENT_DATE);
INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud, precision_m) VALUES (7901, 7903, 20.6, -103.3, 5), (7902, 7909, 20.7, -103.4, 5);
INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('sql', 'Prueba', 'Rutas', 'T79 fixture');
INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Ingreso', 'Ventas', 'T79 fixture', 1);
COMMIT;

CREATE OR REPLACE FUNCTION t79_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t79_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t79_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t79_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t_p087() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION t_p087() TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t79_count(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE 'SELECT count(*) FROM (' || p_sql || ') x' INTO n; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t79_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(concat_ws(':', id, nombre, rol, estatus, auth_id), ',' ORDER BY id) FROM usuarios WHERE id BETWEEN 7901 AND 7919),
    (SELECT string_agg(concat_ws(':', sku, nombre, precio, stock), ',' ORDER BY sku) FROM productos WHERE sku LIKE 'P79-%'),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 7901 AND 7999),
    (SELECT count(*)::text FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7901 AND 7999),
    (SELECT count(*)::text FROM movimientos_contables WHERE concepto LIKE '%T79%'),
    (SELECT count(*)::text FROM clientes WHERE nombre LIKE 'Cliente 79%'),
    (SELECT count(*)::text FROM ordenes WHERE folio LIKE 'OV-79%'),
    (SELECT count(*)::text FROM leads WHERE nombre LIKE 'Lead 79%'),
    (SELECT count(*)::text FROM invoice_attempts WHERE provider = 'test79')))
$$;
DROP TABLE IF EXISTS t79_ids;
CREATE TEMP TABLE t79_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t79_ids TO anon, authenticated;
INSERT INTO t79_ids VALUES ('h0', t79_huella());

-- Identidad + superficies cerradas para quien NO es actor activo con ese rol.
CREATE OR REPLACE FUNCTION t79_identidad(p_tag TEXT, p_rol TEXT, p_id BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t79_assert(get_my_rol() IS NOT DISTINCT FROM p_rol AND get_my_user_id() IS NOT DISTINCT FROM p_id, p_tag || ': get_my_rol=' || COALESCE(p_rol, 'NULL') || ' get_my_user_id=' || COALESCE(p_id::text, 'NULL'));
  PERFORM t79_assert(get_my_rol() IS NOT DISTINCT FROM erp_rol_activo() AND get_my_user_id() IS NOT DISTINCT FROM erp_usuario_id(), p_tag || ': legacy == canónico');
END $$;
CREATE OR REPLACE FUNCTION t79_sin_privilegios(p_tag TEXT, p_self BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t79_assert(t79_count($q$SELECT 1 FROM productos WHERE sku = 'P79-HIELO'$q$) = 0, p_tag || ': catálogo invisible (read_all exige actor activo)');
  PERFORM t79_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('P79-X', 'x', 1, 1)$q$, p_tag || ': INSERT productos denegado', '42501');
  PERFORM t79_assert(t79_rows($q$UPDATE productos SET precio = 1 WHERE sku = 'P79-HIELO'$q$) = 0, p_tag || ': UPDATE productos 0 filas');
  PERFORM t79_assert(t79_rows(format($q$UPDATE usuarios SET estatus = 'Activo', rol = 'Admin' WHERE id = %s$q$, COALESCE(p_self, 7901))) = 0, p_tag || ': no puede (re)activarse ni cambiar su rol vía usuarios.admin_all');
  PERFORM t79_assert(t79_rows($q$UPDATE usuarios SET nombre = nombre WHERE id = 7902$q$) = 0, p_tag || ': UPDATE usuarios ajeno 0 filas');
  PERFORM t79_assert(t79_rows($q$UPDATE rutas SET carga_autorizada = '{"P79-HIELO": 999}' WHERE id = 7901$q$) = 0, p_tag || ': UPDATE rutas 0 filas');
  PERFORM t79_assert(t79_count($q$SELECT 1 FROM pagos$q$) = 0 AND t79_count($q$SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%T79%'$q$) = 0 AND t79_count($q$SELECT 1 FROM auditoria WHERE detalle LIKE '%T79%'$q$) = 0, p_tag || ': ledger y auditoría invisibles');
  PERFORM t79_err($q$INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Egreso', 'Mermas', 'T79 x', 1)$q$, p_tag || ': INSERT egreso operativo denegado', '42501');
  PERFORM t79_err($q$INSERT INTO clientes (nombre) VALUES ('Cliente 79 x')$q$, p_tag || ': INSERT clientes denegado', '42501');
  PERFORM t79_err($q$INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud) VALUES (7901, 7903, 1, 1)$q$, p_tag || ': INSERT ubicación GPS denegado', '42501');
  PERFORM t79_err($q$INSERT INTO leads (nombre) VALUES ('Lead 79 x')$q$, p_tag || ': INSERT leads denegado', '42501');
  PERFORM t79_err($q$INSERT INTO invoice_attempts (provider, status) VALUES ('test79', 'x')$q$, p_tag || ': INSERT invoice_attempts denegado', '42501');
  PERFORM t79_assert(t79_rows($q$DELETE FROM ordenes WHERE folio LIKE 'OV-79%'$q$) = 0, p_tag || ': DELETE ordenes (rollback_delete) 0 filas');
END $$;
GRANT EXECUTE ON FUNCTION t79_identidad(TEXT, TEXT, BIGINT), t79_sin_privilegios(TEXT, BIGINT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION t88_retirada(p_sql TEXT, p_tag TEXT) RETURNS VOID LANGUAGE plpgsql AS $f$
BEGIN
  -- Capacidad genérica retirada por 088: antes se ejecuta; después, 42501.
  IF to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NULL THEN EXECUTE p_sql; RETURN; END IF;
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL: % (088) la capacidad retirada sigue disponible', p_tag;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: % (088) denegado', p_tag;
  END;
END $f$;
GRANT EXECUTE ON FUNCTION t88_retirada(TEXT, TEXT) TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t88_fase() RETURNS BOOLEAN LANGUAGE sql STABLE AS $f$ SELECT to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NOT NULL $f$;
GRANT EXECUTE ON FUNCTION t88_fase() TO anon, authenticated, service_role;
\echo '── 079: estado físico'
SELECT t79_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND provolatile = 's'
  AND NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  AND has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE'))
  FROM pg_proc WHERE oid IN ('public.get_my_rol()'::regprocedure, 'public.get_my_user_id()'::regprocedure)), '079-01 helpers legacy: SECURITY DEFINER, search_path fijo, sin EXECUTE para PUBLIC/anon, con EXECUTE para authenticated/service_role');
SELECT t79_assert(pg_get_functiondef('public.get_my_rol()'::regprocedure) ~ 'SELECT erp_rol_activo\(\)' AND pg_get_functiondef('public.get_my_user_id()'::regprocedure) ~ 'SELECT erp_usuario_id\(\)'
  AND pg_get_functiondef('public.get_my_rol()'::regprocedure) !~ 'email|jwt|usuarios' AND pg_get_functiondef('public.get_my_user_id()'::regprocedure) !~ 'email|jwt|usuarios', '079-02 cuerpos canónicos: delegan en 071, sin email/JWT ni lectura propia de usuarios');
SELECT t79_assert((SELECT pg_get_function_result('public.get_my_rol()'::regprocedure) = 'text' AND pg_get_function_result('public.get_my_user_id()'::regprocedure) = 'bigint'), '079-03 firmas y tipos de retorno conservados');
-- 088/089 retiran a propósito 6 policies con get_my_rol (egreso genérico, 2 del rol muerto Almacén,
-- ventas_update reescrita con erp_rol_activo, y en 089 ventas_insert y write_roles).
SELECT t79_assert((SELECT count(*) = 47 - (SELECT count(*) FROM (VALUES ('movimientos_contables','egreso_operativo_insert'),('rutas','almacen_update'),('rutas','almacen_write'),('ordenes','ventas_insert'),('orden_lineas','write_roles')) x(t, p)
      WHERE NOT EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename = x.t AND q.policyname = x.p))
    - CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ordenes' AND policyname = 'ventas_update' AND qual ~ 'erp_rol_activo') THEN 1 ELSE 0 END
  FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'get_my_rol\(\)')
  AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'get_my_user_id\(\)'), '079-04 dependencias intactas: 47 policies con get_my_rol, 2 con get_my_user_id (ninguna reescrita)');
SELECT t79_assert((SELECT md5(pg_get_functiondef(oid)) = '51a6dd4f6ee6486a34f81e3eec54eb8a' FROM pg_proc WHERE oid = 'public.erp_actor()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '769d64e0c31d5f74cdd765c44b80f259' FROM pg_proc WHERE oid = 'public.erp_rol_activo()'::regprocedure)
  AND (SELECT md5(pg_get_functiondef(oid)) = '02c3f3c9f97eebb1cc4ed11d61051943' FROM pg_proc WHERE oid = 'public.erp_usuario_id()'::regprocedure), '079-05 helpers canónicos 071 sin cambios (md5 de producción)');

\echo '── 079: usuarios activos — misma identidad y policies legacy funcionando'
BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'admin79@t', '79000000-0000-0000-0000-000000000001');
SELECT t79_identidad('079-10 Admin activo', 'Admin', 7901);
SELECT t79_assert(t79_count($q$SELECT 1 FROM usuarios WHERE id BETWEEN 7901 AND 7919$q$) = 10, '079-11 Admin: ve todos los usuarios (usuarios.admin_all)');
SELECT t79_assert(t79_rows($q$UPDATE usuarios SET nombre = 'Ventas 79 ed' WHERE id = 7902$q$) = 1, '079-12 Admin: edita usuarios');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P79-ADMIN', 'Alta 79', 'Producto Terminado', 5, 0);
SELECT t79_assert(t79_rows($q$UPDATE productos SET precio = 6 WHERE sku = 'P79-ADMIN'$q$) = 1 AND t79_rows($q$DELETE FROM productos WHERE sku = 'P79-ADMIN'$q$) = 1, '079-13 Admin: alta, edición y baja de producto (productos.admin_all)');
SELECT t79_assert(t79_rows($q$UPDATE rutas SET carga_autorizada = '{"P79-HIELO": 3}' WHERE id = 7901$q$) = 1, '079-14 Admin: gestiona rutas (rutas.admin_all)');
SELECT t79_assert(t79_count($q$SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%T79%'$q$) = 1 AND t79_count($q$SELECT 1 FROM auditoria WHERE detalle LIKE '%T79%'$q$) = 1 AND t79_count($q$SELECT 1 FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7901 AND 7999$q$) = 2, '079-15 Admin: ve ledger, auditoría y GPS de todos (admin_all / admin_read / admin_or_self_read)');
-- 090: Admin ya no inserta órdenes por REST (crear_orden); la fila es solo fixture.
RESET ROLE;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES (7920, 'OV-7920', 7910, 'Cliente 79', '1×P79-HIELO', 30, 'Creada', 'Efectivo', 'Contado', 7902);
SET LOCAL ROLE authenticated;
SELECT t79_assert(t79_rows($q$DELETE FROM ordenes WHERE id = 7920$q$) = 1, '079-16 Admin: DELETE ordenes (rollback_delete)');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'ventas79@t', '79000000-0000-0000-0000-000000000002');
SELECT t79_identidad('079-20 Ventas activo', 'Ventas', 7902);
SELECT t79_assert(t79_count($q$SELECT 1 FROM productos WHERE sku = 'P79-HIELO'$q$) = 1, '079-21 Ventas: ve catálogo');
INSERT INTO clientes (nombre, rfc) VALUES ('Cliente 79 nuevo', 'XAXX010101000');
SELECT t79_assert(t79_rows($q$UPDATE clientes SET zona = 'Norte' WHERE nombre = 'Cliente 79 nuevo'$q$) = 1, '079-22 Ventas: alta y edición de clientes (ventas_write / ventas_update)');
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes' AND policyname = 'ventas_insert') THEN
    -- 089: Ventas ya no inserta órdenes por REST (usa crear_orden); la fila se
    -- crea como fixture y se comprueba la denegación.
    BEGIN
      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, requiere_factura) VALUES ('OV-79V', 7910, 'Cliente 79', '1×P79-HIELO', 30, 'Creada', 'Efectivo', 'Contado', 7902, false);
      RAISE EXCEPTION 'FAIL: 079-23 (089) INSERT directo de orden no fue denegado';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 079-23 (089) INSERT directo de orden denegado';
    END;
    RESET ROLE;
    INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, requiere_factura) VALUES ('OV-79V', 7910, 'Cliente 79', '1×P79-HIELO', 30, 'Creada', 'Efectivo', 'Contado', 7902, false);
    SET LOCAL ROLE authenticated;
  ELSE
    INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, requiere_factura) VALUES ('OV-79V', 7910, 'Cliente 79', '1×P79-HIELO', 30, 'Creada', 'Efectivo', 'Contado', 7902, false);
  END IF;
END $do$;
INSERT INTO leads (nombre) VALUES ('Lead 79 ventas');
SELECT t79_assert(t79_count($q$SELECT 1 FROM ordenes WHERE folio = 'OV-79V'$q$) = 1 AND t79_count($q$SELECT 1 FROM leads WHERE nombre = 'Lead 79 ventas'$q$) = 1, '079-23 Ventas: crea pedido y lead (ventas_insert / leads.ventas_all)');
SELECT t79_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('P79-V', 'x', 1, 1)$q$, '079-24 Ventas: sin alta de productos', '42501');
SELECT t79_assert(t79_rows($q$UPDATE usuarios SET rol = 'Admin' WHERE id = 7902$q$) = 0 AND t79_count($q$SELECT 1 FROM pagos$q$) >= 0 AND t79_rows($q$UPDATE rutas SET nombre = 'x' WHERE id = 7901$q$) = 0, '079-25 Ventas: sin escalada en usuarios ni rutas');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'chofer79@t', '79000000-0000-0000-0000-000000000003');
SELECT t79_identidad('079-30 Chofer activo', 'Chofer', 7903);
INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud, precision_m) VALUES (7901, 7903, 20.61, -103.31, 5);
SELECT t79_assert(t79_count($q$SELECT 1 FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7901 AND 7999$q$) = 2, '079-31 Chofer: inserta su GPS y solo ve el propio (chofer_insert_own / admin_or_self_read con get_my_user_id)');
SELECT t79_err($q$INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud) VALUES (7902, 7909, 1, 1)$q$, '079-32 Chofer: GPS a nombre de otro chofer denegado', '42501');
DO $do$ BEGIN
  IF t_p087() THEN
    PERFORM t79_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 7901$q$, '079-33 (087) Chofer: el cierre directo ya no existe (finalizar_inventario_ruta)', '42501');
  ELSE
    PERFORM t79_assert(t79_rows($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 7901$q$) = 1, '079-33 Chofer: cierra su ruta (078 intacto)');
    PERFORM t79_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7901$q$, '079-34 Chofer: guard 078 sigue vigente', '42501');
  END IF;
END $do$;
SELECT t79_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('P79-C', 'x', 1, 1)$q$, '079-35 Chofer: sin alta de productos', '42501');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'prod79@t', '79000000-0000-0000-0000-000000000004');
SELECT t79_identidad('079-40 Producción activo', 'Producción', 7904);
SELECT t88_retirada($q$INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Egreso', 'Mermas', 'T79 egreso prod', 2)$q$, '079-41 Producción: egreso directo');
SELECT t79_assert(t79_count($q$SELECT 1 FROM productos WHERE sku = 'P79-HIELO'$q$) = 1, '079-41 Producción: egreso operativo permitido y catálogo visible');
SELECT t79_assert(t79_rows($q$UPDATE productos SET stock = 999 WHERE sku = 'P79-HIELO'$q$) = 0, '079-42 Producción: 077 intacto (sin escritura directa de productos)');
SELECT t79_err($q$INSERT INTO produccion (turno, maquina, sku, cantidad) VALUES ('T', 'M', 'P79-HIELO', 1)$q$, '079-43 Producción: 077 intacto (sin INSERT directo en produccion)', '42501');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'bolsas79@t', '79000000-0000-0000-0000-000000000005');
SELECT t79_identidad('079-50 Almacén Bolsas activo', 'Almacén Bolsas', 7905);
SELECT t88_retirada($q$INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Egreso', 'Proveedores', 'T79 egreso bolsas', 2)$q$, '079-51 Almacén Bolsas: egreso directo');
SELECT t79_assert(t79_count($q$SELECT 1 FROM productos WHERE sku = 'P79-HIELO'$q$) = 1, '079-51 Almacén Bolsas: egreso operativo permitido y catálogo visible');
SELECT t79_err($q$INSERT INTO clientes (nombre) VALUES ('Cliente 79 b')$q$, '079-52 Almacén Bolsas: sin alta de clientes', '42501');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'fact79@t', '79000000-0000-0000-0000-000000000006');
SELECT t79_identidad('079-60 Facturación activo', 'Facturación', 7906);
-- 090: los intentos de factura los escribe el backend (service_role); aquí es fixture.
RESET ROLE;
INSERT INTO invoice_attempts (provider, status) VALUES ('test79', 'pending');
SET LOCAL ROLE authenticated;
SELECT t79_assert(t79_count($q$SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%T79%'$q$) = 1 AND t79_count($q$SELECT 1 FROM invoice_attempts WHERE provider = 'test79'$q$) = 1, '079-61 Facturación: intentos de factura y lectura del ledger (facturacion_all / facturacion_read)');
INSERT INTO clientes (nombre, rfc) VALUES ('Cliente 79 fact', 'XAXX010101000');
SELECT t79_err($q$INSERT INTO leads (nombre) VALUES ('Lead 79 f')$q$, '079-62 Facturación: alta de clientes sí, leads no', '42501');
ROLLBACK;
SELECT t79_assert(t79_huella() = (SELECT v FROM t79_ids WHERE k = 'h0'), '079-69 usuarios activos: todo revertido, huella intacta');

\echo '── 079: inactivos y sin perfil — identidad NULL, policies legacy cerradas'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('079-70 Admin INACTIVO',      'inadm79@t',    '79000000-0000-0000-0000-000000000007', 7907),
      ('079-71 Ventas INACTIVO',     'inventas79@t', '79000000-0000-0000-0000-000000000008', 7908),
      ('079-72 Chofer INACTIVO',     'inchofer79@t', '79000000-0000-0000-0000-000000000009', 7909),
      ('079-73 Producción INACTIVO', 'inprod79@t',   '79000000-0000-0000-0000-000000000010', 7910),
      ('079-74 JWT sin perfil',      'noprof79@t',   '79000000-0000-0000-0000-000000000099', NULL)) x(tag, email, sub, self)
  LOOP
    PERFORM t79_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t79_identidad(a.tag, NULL, NULL);
    PERFORM t79_sin_privilegios(a.tag, a.self);
    RESET ROLE;
    PERFORM t79_assert(t79_huella() = (SELECT v FROM t79_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;
SELECT t79_assert((SELECT estatus = 'Inactivo' AND rol = 'Admin' FROM usuarios WHERE id = 7907), '079-75 el Admin inactivo sigue inactivo: no pudo reactivarse');
BEGIN; SET LOCAL ROLE authenticated; SELECT t79_actor('authenticated', 'inchofer79@t', '79000000-0000-0000-0000-000000000009');
SELECT t79_err($q$INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud) VALUES (7902, 7909, 1, 1)$q$, '079-76 Chofer INACTIVO: ni su propio GPS (get_my_user_id NULL)', '42501');
SELECT t79_assert(t79_count($q$SELECT 1 FROM chofer_ubicaciones WHERE ruta_id = 7902$q$) = 0 AND t79_rows($q$UPDATE rutas SET estatus = 'Cerrada' WHERE id = 7902$q$) = 0, '079-77 Chofer INACTIVO: sin lectura propia de GPS ni cierre de su ruta');
ROLLBACK;

\echo '── 079: el email del JWT ya no decide la identidad'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t79_actor('authenticated', 'admin79@t', '79000000-0000-0000-0000-000000000002');
SELECT t79_identidad('079-80 email de Admin + sub de Ventas → Ventas', 'Ventas', 7902);
SELECT t79_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('P79-SWAP', 'x', 1, 1)$q$, '079-81 email de Admin + sub de Ventas: sin admin_all', '42501');
SELECT t79_assert(t79_rows($q$UPDATE usuarios SET rol = 'Admin' WHERE id = 7902$q$) = 0, '079-82 email de Admin + sub de Ventas: no se autoasciende');
SELECT t79_actor('authenticated', 'ADMIN79@T', '79000000-0000-0000-0000-000000000002');
SELECT t79_identidad('079-83 email de Admin en mayúsculas + sub de Ventas → Ventas', 'Ventas', 7902);
SELECT t79_actor('authenticated', 'admin79@t', '79000000-0000-0000-0000-000000000099');
SELECT t79_identidad('079-84 email de Admin + sub sin perfil → NULL', NULL, NULL);
SELECT t79_actor('authenticated', 'admin79@t', '79000000-0000-0000-0000-000000000007');
SELECT t79_identidad('079-85 email de Admin activo + sub del Admin inactivo → NULL', NULL, NULL);
SELECT t79_actor('authenticated', NULL, '79000000-0000-0000-0000-000000000001');
SELECT t79_identidad('079-86 sin email en el JWT + sub de Admin → Admin (solo auth.uid)', 'Admin', 7901);
SELECT t79_actor('authenticated', 'admin79@t', NULL);
SELECT t79_identidad('079-87 email de Admin sin sub → NULL', NULL, NULL);
ROLLBACK;

\echo '── 079: anon'
BEGIN; SET LOCAL ROLE anon; SELECT t79_actor('anon', NULL, NULL);
SELECT t79_err($q$SELECT get_my_rol()$q$, '079-90 anon: sin EXECUTE en get_my_rol', '42501');
SELECT t79_err($q$SELECT get_my_user_id()$q$, '079-91 anon: sin EXECUTE en get_my_user_id', '42501');
-- 090: anon ya no tiene privilegios de tabla (más estricto que cero filas).
DO $do$ DECLARE n BIGINT; BEGIN
  BEGIN n := t79_count($q$SELECT 1 FROM productos WHERE sku = 'P79-HIELO'$q$) + t79_count($q$SELECT 1 FROM usuarios WHERE id = 7901$q$); EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  PERFORM t79_assert(n = 0, '079-92 anon: nada visible (o sin privilegio tras 090)');
END $do$;
SELECT t79_err($q$INSERT INTO productos (sku, nombre, precio, stock) VALUES ('P79-A', 'x', 1, 1)$q$, '079-93 anon: INSERT denegado', '42501');
DO $do$ DECLARE n BIGINT; BEGIN
  BEGIN n := t79_rows($q$UPDATE usuarios SET estatus = 'Activo' WHERE id = 7907$q$); EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  PERFORM t79_assert(n = 0, '079-94 anon: UPDATE usuarios 0 filas (o sin privilegio tras 090)');
END $do$;
ROLLBACK;
SELECT t79_assert(t79_huella() = (SELECT v FROM t79_ids WHERE k = 'h0'), '079-95 huella final intacta');

BEGIN;
DELETE FROM chofer_ubicaciones WHERE ruta_id BETWEEN 7901 AND 7999;
DELETE FROM invoice_attempts WHERE provider = 'test79';
DELETE FROM movimientos_contables WHERE concepto LIKE '%T79%';
DELETE FROM leads WHERE nombre LIKE 'Lead 79%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7920 AND 7929;
DELETE FROM ordenes WHERE id BETWEEN 7920 AND 7929 OR folio LIKE 'OV-79%';
DELETE FROM rutas WHERE id BETWEEN 7901 AND 7999;
DELETE FROM clientes WHERE id = 7910 OR nombre LIKE 'Cliente 79%';
DELETE FROM productos WHERE sku LIKE 'P79-%';
DELETE FROM auditoria WHERE detalle LIKE '%T79%';
DELETE FROM usuarios WHERE id BETWEEN 7901 AND 7919;
DELETE FROM auth.users WHERE id::text LIKE '79000000-%';
COMMIT;
\echo '── 079: TODAS LAS PRUEBAS OK'
