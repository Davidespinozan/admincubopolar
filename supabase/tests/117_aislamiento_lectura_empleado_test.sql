-- 117_aislamiento_lectura_empleado_test.sql — WF-0.1: el rol Empleado no lee
-- por API los datos de negocio; los demás roles conservan EXACTAMENTE su lectura.
-- Prueba de datos: por cada una de las 24 tablas, lo que ve cada rol se compara
-- con el total real (superusuario). Empleado: 0 filas en todas. Admin,
-- Producción, Ventas, Chofer, Facturación, Almacén Bolsas y Sin asignar: todas.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t117_ids;
CREATE TABLE t117_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t117_ids TO PUBLIC;

CREATE OR REPLACE FUNCTION t117_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM devoluciones WHERE usuario = 'T117';
  DELETE FROM orden_lineas WHERE orden_id = 11751;
  DELETE FROM pagos WHERE referencia = 'T117';
  DELETE FROM cuentas_por_cobrar WHERE cliente_id = 11751;
  DELETE FROM ordenes WHERE id = 11751;
  DELETE FROM precios_esp WHERE cliente_id = 11751;
  DELETE FROM comodatos WHERE negocio = 'Negocio T117';
  DELETE FROM clientes WHERE id = 11751;
  DELETE FROM camiones WHERE nombre = 'Camión T117';
  DELETE FROM rutas WHERE nombre = 'Ruta T117';
  DELETE FROM cierres_diarios WHERE cerrado_por = 'T117';
  DELETE FROM costos_historial WHERE id = 11751;
  DELETE FROM pagos_proveedores WHERE id = 11751;
  DELETE FROM cuentas_por_pagar WHERE id = 11751;
  DELETE FROM costos_fijos WHERE id = 11751;
  DELETE FROM inventario_mov WHERE producto = 'T117-SKU';
  DELETE FROM produccion WHERE sku = 'T117-SKU';
  DELETE FROM umbrales WHERE sku = 'T117-SKU';
  DELETE FROM notificaciones WHERE titulo = 'T117';
  DELETE FROM empleados WHERE id = 11751;
  DELETE FROM usuarios WHERE id BETWEEN 11751 AND 11759;
  DELETE FROM auth.users WHERE id::text LIKE '11750000-%';
END $$;

BEGIN; SELECT t117_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11750000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t117' FROM generate_series(1, 9) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11751, 'Admin 117', 'u1@t117', 'Admin', 'Activo', '11750000-0000-0000-0000-000000000001'),
  (11752, 'Producción 117', 'u2@t117', 'Producción', 'Activo', '11750000-0000-0000-0000-000000000002'),
  (11753, 'Ventas 117', 'u3@t117', 'Ventas', 'Activo', '11750000-0000-0000-0000-000000000003'),
  (11754, 'Chofer 117', 'u4@t117', 'Chofer', 'Activo', '11750000-0000-0000-0000-000000000004'),
  (11755, 'Facturación 117', 'u5@t117', 'Facturación', 'Activo', '11750000-0000-0000-0000-000000000005'),
  (11756, 'Almacén 117', 'u6@t117', 'Almacén Bolsas', 'Activo', '11750000-0000-0000-0000-000000000006'),
  (11757, 'Empleado 117', 'u7@t117', 'Empleado', 'Activo', '11750000-0000-0000-0000-000000000007'),
  (11758, 'Sin asignar 117', 'u8@t117', 'Sin asignar', 'Activo', '11750000-0000-0000-0000-000000000008'),
  (11759, 'Inactivo 117', 'u9@t117', 'Ventas', 'Inactivo', '11750000-0000-0000-0000-000000000009');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id)
  VALUES (11751, 'Empleado T117', 'Ayudante', 'Planta', 300, '2026-01-01', 'Activo', 11757);
-- Al menos una fila en cada tabla de la lista (las que ya tienen datos también suman).
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (11751, 'Cliente T117', 'XAXX010101000', 0);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus) VALUES (11751, 'OV-T117', 11751, 'Cliente T117', 'x', 10, 'Creada');
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (11751, 'T117-SKU', 1, 10, 10);
INSERT INTO pagos (monto, saldo_antes, saldo_despues, referencia) VALUES (10, 10, 0, 'T117');
INSERT INTO cuentas_por_cobrar (cliente_id, monto_original, saldo_pendiente) VALUES (11751, 10, 10);
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (11751, 'T117-SKU', 9);
INSERT INTO comodatos (negocio, cliente_id) VALUES ('Negocio T117', 11751);
INSERT INTO devoluciones (orden_id, cliente_id, motivo, tipo_reembolso, total, items, usuario, disposicion) VALUES (11751, 11751, 'x', 'Efectivo', 1, '[]', 'T117', 'Merma');
INSERT INTO camiones (nombre) VALUES ('Camión T117');
INSERT INTO rutas (nombre) VALUES ('Ruta T117');
INSERT INTO cierres_diarios (fecha, cerrado_por) VALUES ('2001-01-01', 'T117');
INSERT INTO costos_fijos (id, nombre) VALUES (11751, 'Renta T117');
INSERT INTO costos_historial (id, tipo, categoria, concepto) VALUES (11751, 'Fijo', 'Renta', 'T117');
INSERT INTO cuentas_por_pagar (id, proveedor, concepto) VALUES (11751, 'Proveedor T117', 'T117');
INSERT INTO pagos_proveedores (id, cxp_id) VALUES (11751, 11751);
INSERT INTO inventario_mov (tipo, producto, cantidad) VALUES ('Entrada', 'T117-SKU', 1);
INSERT INTO produccion (turno, maquina, sku, cantidad) VALUES ('Turno 1', 'Máquina 30', 'T117-SKU', 1);
INSERT INTO umbrales (sku) VALUES ('T117-SKU');
INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T117', 'T117');
COMMIT;

CREATE OR REPLACE FUNCTION t117_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t117_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 100);
END $$;
CREATE OR REPLACE FUNCTION t117_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11750000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
-- Filas visibles por tabla para quien ejecuta (SECURITY INVOKER: aplica RLS).
CREATE OR REPLACE FUNCTION t117_conteos() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; r JSONB := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['camiones', 'cierres_diarios', 'clientes', 'comodatos', 'configuracion_empresa', 'costos_empaque_historial',
    'costos_fijos', 'costos_historial', 'cuartos_frios', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'devoluciones', 'inventario_mov',
    'notificaciones', 'orden_lineas', 'ordenes', 'pagos', 'pagos_proveedores', 'precios_esp', 'produccion', 'productos', 'rutas',
    'stock_operaciones', 'umbrales'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    r := r || jsonb_build_object(t, n);
  END LOOP;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION t117_assert(BOOLEAN, TEXT), t117_err(TEXT, TEXT, TEXT), t117_auth(INTEGER), t117_conteos() TO PUBLIC;
INSERT INTO t117_ids VALUES ('total', t117_conteos()::text), ('mov', (SELECT count(*) FROM movimientos_contables)::text);

\echo '── 117: superficie'
SELECT t117_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp'
                       AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('public', oid, 'EXECUTE'))
                    FROM pg_proc WHERE oid = 'public.erp_lector_negocio()'::regprocedure),
  '117-00a erp_lector_negocio: SECURITY DEFINER, search_path fijo, sin anon/PUBLIC');
SELECT t117_assert((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual = 'erp_lector_negocio()') = 24
               AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual = 'erp_es_activo()') = 0,
  '117-00b las 24 policies de lectura amplia usan erp_lector_negocio(); ninguna SELECT queda con erp_es_activo()');
SELECT t117_assert((SELECT bool_and(roles = '{authenticated}' AND permissive = 'PERMISSIVE') FROM pg_policies WHERE qual = 'erp_lector_negocio()'),
  '117-00c mismas policies: permisivas, solo authenticated');
SELECT t117_assert((SELECT bool_and(value::bigint > 0) FROM jsonb_each_text((SELECT v::jsonb FROM t117_ids WHERE k = 'total'))),
  '117-00d hay filas en las 24 listas (la prueba de datos no es vacía)');

\echo '── CASO 1: Empleado no lee datos de negocio por API'
BEGIN; SET LOCAL ROLE authenticated; SELECT t117_auth(7);
SELECT t117_assert(NOT erp_lector_negocio() AND erp_rol_activo() = 'Empleado', '117-01a Empleado: erp_lector_negocio() = false');
SELECT t117_assert((SELECT bool_and(value::bigint = 0) FROM jsonb_each_text(t117_conteos())), '117-01b Empleado ve 0 filas en las 24 listas: ' || t117_conteos()::text);
SELECT t117_assert((SELECT count(*) FROM empleados) = 0 AND (SELECT count(*) FROM nomina_recibos) = 0 AND (SELECT count(*) FROM movimientos_contables) = 0
               AND (SELECT count(*) FROM mermas) = 0 AND (SELECT count(*) FROM auditoria) = 0 AND (SELECT count(*) FROM cfdi_operaciones) = 0
               AND (SELECT count(*) FROM chofer_ubicaciones) = 0 AND (SELECT count(*) FROM leads) = 0,
  '117-01c tampoco empleados, nómina, contabilidad, mermas, auditoría, CFDI, ubicaciones ni leads');
SELECT t117_assert((SELECT count(*) FROM usuarios) = 1 AND (SELECT id FROM usuarios) = 11757, '117-01d solo su propio perfil de usuario');
SELECT t117_assert((mi_asistencia() ->> 'estado') IN ('sin_turno', 'fuera_de_horario', 'pendiente'), '117-01e Mi asistencia sigue funcionando');
SELECT t117_err('SELECT reporte_financiero(CURRENT_DATE - 30, CURRENT_DATE)', '117-01f reporte financiero por RPC rechazado', '42501');
SELECT t117_err('SELECT conciliacion_empaque()', '117-01g conciliación de empaque por RPC rechazada', '42501');
SELECT t117_err('SELECT rutas_pendientes_caja()', '117-01h rutas pendientes de caja por RPC rechazadas', '42501');
SELECT t117_err('SELECT asistencia_dia(CURRENT_DATE)', '117-01i asistencia de todos rechazada', '42501');
COMMIT;

\echo '── CASO 2: los demás roles conservan EXACTAMENTE su lectura'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t117_auth(1); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02a Admin ve todo');
SELECT t117_auth(2); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02b Producción: misma lectura');
SELECT t117_auth(3); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02c Ventas: misma lectura');
SELECT t117_auth(4); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02d Chofer: misma lectura');
SELECT t117_auth(5); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02e Facturación: misma lectura');
SELECT t117_auth(6); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02f Almacén Bolsas: misma lectura');
SELECT t117_auth(8); SELECT t117_assert(t117_conteos() = (SELECT v::jsonb FROM t117_ids WHERE k = 'total'), '117-02g Sin asignar: misma lectura');
SELECT t117_auth(9); SELECT t117_assert((SELECT bool_and(value::bigint = 0) FROM jsonb_each_text(t117_conteos())), '117-02h usuario inactivo: nada (sin cambio)');
SELECT t117_auth(1); SELECT t117_assert((SELECT count(*) FROM empleados WHERE id = 11751) = 1 AND (SELECT count(*) FROM usuarios WHERE id BETWEEN 11751 AND 11759) = 9,
  '117-02i Admin sigue leyendo empleados y usuarios');
SELECT t117_auth(5); SELECT t117_assert((SELECT count(*) FROM movimientos_contables) = (SELECT v::bigint FROM t117_ids WHERE k = 'mov'), '117-02j Facturación conserva movimientos (facturacion_read)');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t117_auth(5);
SELECT t117_assert(erp_lector_negocio(), '117-02k erp_lector_negocio() = true para un rol operativo');
RESET ROLE; SELECT set_config('request.jwt.claims', '', true);
SELECT t117_assert(NOT erp_lector_negocio(), '117-02l sin sesión de usuario: false (las policies solo aplican a authenticated)');
COMMIT;

\echo '── 117: limpieza'
BEGIN; SELECT t117_limpiar(); COMMIT;
DROP TABLE t117_ids;
DROP FUNCTION t117_limpiar(); DROP FUNCTION t117_assert(BOOLEAN, TEXT); DROP FUNCTION t117_err(TEXT, TEXT, TEXT); DROP FUNCTION t117_auth(INTEGER); DROP FUNCTION t117_conteos();
\echo '117: OK'
