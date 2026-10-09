-- 120_ger1_dueno_accesos_test.sql — GER-1: Dueño (Admin + es_dueno), accesos
-- adicionales por persona (Ventas / Almacén Bolsas), contraseña temporal con
-- cambio obligatorio, usuarios por contrato y bitácora de cambios sensibles.
-- Corre tras 120 (antes de 121): la escritura REST de usuarios de Admin aún
-- existe (compatibilidad con el frontend desplegado) y queda en la bitácora.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t120_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM bitacora_cambios WHERE registro_id IN (SELECT id::text FROM usuarios WHERE id BETWEEN 12001 AND 12019)
     OR (tabla = 'productos' AND despues ->> 'sku' LIKE 'P120%') OR (tabla = 'productos' AND antes ->> 'sku' LIKE 'P120%')
     OR (tabla = 'ordenes' AND COALESCE(despues ->> 'folio', antes ->> 'folio') LIKE 'OV-120%')
     OR (tabla = 'leads' AND COALESCE(despues ->> 'nombre', antes ->> 'nombre') LIKE 'Lead 120%');
  DELETE FROM usuarios_password_temporal WHERE usuario_id BETWEEN 12001 AND 12019;
  DELETE FROM leads WHERE nombre LIKE 'Lead 120%';
  DELETE FROM ordenes WHERE id BETWEEN 12001 AND 12009;
  DELETE FROM clientes WHERE id = 12001;
  DELETE FROM productos WHERE sku LIKE 'P120%';
  DELETE FROM usuarios WHERE id BETWEEN 12001 AND 12019;
  DELETE FROM auth.users WHERE id::text LIKE '12000000-%';
END $$;

BEGIN; SELECT t120_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, encrypted_password)
  SELECT ('12000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t120', 'hash-inicial-' || k FROM generate_series(1, 10) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, es_dueno, accesos_extra, debe_cambiar_password) VALUES
  (12001, 'Dueño 120',     'u1@t120',  'Admin',          'Activo', '12000000-0000-0000-0000-000000000001', true,  '{}', false),
  (12002, 'Admin 120',     'u2@t120',  'Admin',          'Activo', '12000000-0000-0000-0000-000000000002', false, '{}', false),
  (12003, 'Admin2 120',    'u3@t120',  'Admin',          'Activo', '12000000-0000-0000-0000-000000000003', false, '{}', false),
  (12004, 'Ventas 120',    'u4@t120',  'Ventas',         'Activo', '12000000-0000-0000-0000-000000000004', false, '{}', false),
  (12005, 'María 120',     'u5@t120',  'Almacén Bolsas', 'Activo', '12000000-0000-0000-0000-000000000005', false, '{Ventas}', false),
  (12006, 'Almacén 120',   'u6@t120',  'Almacén Bolsas', 'Activo', '12000000-0000-0000-0000-000000000006', false, '{}', false),
  (12007, 'Empleado 120',  'u7@t120',  'Empleado',       'Activo', '12000000-0000-0000-0000-000000000007', false, '{}', false),
  (12008, 'Nueva 120',     'u8@t120',  'Ventas',         'Activo', '12000000-0000-0000-0000-000000000008', false, '{}', false),
  (12009, 'Producción 120','u9@t120',  'Producción',     'Activo', '12000000-0000-0000-0000-000000000009', false, '{}', false);
INSERT INTO clientes (id, nombre) VALUES (12001, 'Cliente 120');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (12001, 'OV-12001', 12001, 'Cliente 120', 'x', 100, 'Creada', 'Efectivo', 'Contado', 12004, NULL),
  (12002, 'OV-12002', 12001, 'Cliente 120', 'x', 100, 'Creada', 'Efectivo', 'Contado', 12005, NULL);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P120-PT', 'Hielo 120', 'Producto Terminado', 31, 0, 0);
COMMIT;

CREATE OR REPLACE FUNCTION t120_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t120_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t120_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t120_venta(p_orden BIGINT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT format($q$SELECT completar_venta_directa('%s'::uuid, %s, 'contado', 'Efectivo', '[{"sku":"P120-PT","cuarto_id":"CF-1","cantidad":1}]'::jsonb)$q$, gen_random_uuid(), p_orden)
$$;
GRANT EXECUTE ON FUNCTION t120_assert(BOOLEAN, TEXT), t120_err(TEXT, TEXT, TEXT), t120_auth(INTEGER), t120_venta(BIGINT) TO PUBLIC;

\echo '── 120: superficie'
SELECT t120_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp')
                    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                     AND p.proname IN ('erp_roles_activos', 'erp_tiene_rol', 'erp_es_dueno', 'guardar_usuario', 'fijar_password_temporal',
                                       'confirmar_cambio_password', 'bitacora_actor')),
  '120-00a funciones nuevas: SECURITY DEFINER con search_path fijo');
SELECT t120_assert(NOT has_function_privilege('authenticated', 'public.fijar_password_temporal(bigint,text)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.bitacora_registrar()', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.guardar_usuario(bigint,text,text,text,text[])', 'EXECUTE'),
  '120-00b fijar_password_temporal y bitacora_registrar no se exponen por API; anon sin contratos');
SELECT t120_assert(NOT has_table_privilege('authenticated', 'public.usuarios_password_temporal', 'SELECT')
               AND NOT has_table_privilege('authenticated', 'public.bitacora_cambios', 'UPDATE')
               AND NOT has_table_privilege('authenticated', 'public.bitacora_cambios', 'DELETE'),
  '120-00c huellas de contraseña sin acceso; bitácora sin UPDATE ni DELETE por API');
SELECT t120_assert((SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_bitacora' AND NOT tgisinternal) = 14,
  '120-00d bitácora en las 14 tablas sensibles');

\echo '── CASOS 1–4: accesos adicionales'
BEGIN; SET LOCAL ROLE authenticated;
SELECT t120_auth(5);
SELECT t120_assert(erp_roles_activos() = ARRAY['Almacén Bolsas', 'Ventas'] AND erp_tiene_rol('Ventas') AND erp_rol_activo() = 'Almacén Bolsas',
  '120-01a María: rol principal Almacén Bolsas + acceso Ventas');
SELECT t120_assert(fin_actor_permitido(ARRAY['Admin', 'Ventas']) AND fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas'])
               AND NOT fin_actor_permitido(ARRAY['Admin']) AND NOT fin_actor_permitido(ARRAY['Admin', 'Producción']),
  '120-01b contratos: entra por Ventas y por Almacén; no por Admin ni Producción');
SELECT t120_err(t120_venta(12001), '120-02a venta directa de una orden de OTRO vendedor: rechazada', '42501');
SELECT t120_auth(6);
SELECT t120_assert(NOT erp_tiene_rol('Ventas') AND NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']),
  '120-03 Almacén sin acceso adicional: sigue sin Ventas');
SELECT t120_err(t120_venta(12002), '120-03b Almacén sin acceso adicional no completa ventas', '42501');
SELECT t120_auth(4);
SELECT t120_err(t120_venta(12002), '120-02b Ventas tampoco completa la orden de otro (sin cambio)', '42501');
COMMIT;

-- fin_orden_operable no es ejecutable por API (lo usan las guardas): se evalúa con el JWT simulado.
BEGIN;
SELECT t120_auth(5);
SELECT t120_assert(fin_orden_operable(NULL) AND NOT fin_orden_operable(1), '120-01c con acceso de Ventas: órdenes sin ruta sí, con ruta no');
SELECT t120_auth(6);
SELECT t120_assert(NOT fin_orden_operable(NULL), '120-03c Almacén sin acceso adicional: ninguna orden');
SELECT t120_auth(4);
SELECT t120_assert(fin_orden_operable(NULL) AND NOT fin_orden_operable(1), '120-01d Ventas: sin cambio');
COMMIT;

-- Policies de Ventas por REST: María actualiza su orden sin ruta y crea leads; Almacén solo, no.
BEGIN; SET LOCAL ROLE authenticated; SELECT t120_auth(5);
UPDATE ordenes SET referencia_entrega = 'T120 María' WHERE id = 12002;
INSERT INTO leads (nombre, telefono, estatus) VALUES ('Lead 120 María', '600', 'Nuevo');
SELECT t120_auth(6);
UPDATE ordenes SET referencia_entrega = 'T120 Almacén' WHERE id = 12002;
SELECT t120_err($$INSERT INTO leads (nombre, telefono, estatus) VALUES ('Lead 120 Almacén', '601', 'Nuevo')$$, '120-04b Almacén solo no crea leads', '42501');
RESET ROLE;
SELECT t120_assert((SELECT referencia_entrega FROM ordenes WHERE id = 12002) = 'T120 María', '120-04a policy ventas_update vale para el acceso adicional (y no para Almacén solo)');
SELECT t120_assert((SELECT count(*) FROM leads WHERE nombre = 'Lead 120 María') = 1, '120-04c policy de leads vale para el acceso adicional');
COMMIT;

\echo '── CASOS 5–7: contraseña temporal'
-- Alta con temporal (lo hace la Netlify Function con service role tras crear la cuenta).
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT t120_assert((fijar_password_temporal(12008, 'Admin 120') ->> 'ok')::boolean, '120-05a fijar_password_temporal (service role)');
COMMIT;
SELECT t120_assert((SELECT debe_cambiar_password FROM usuarios WHERE id = 12008)
               AND (SELECT hash FROM usuarios_password_temporal WHERE usuario_id = 12008) = 'hash-inicial-8',
  '120-05b la cuenta queda obligada a cambiarla y con la huella de la temporal');
BEGIN; SET LOCAL ROLE authenticated; SELECT t120_auth(2);
SELECT t120_err($$SELECT fijar_password_temporal(12004, 'x')$$, '120-05c authenticated no fija temporales', '42501');
SELECT t120_auth(8);
SELECT t120_assert(erp_rol_activo() IS NULL AND NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) AND NOT erp_es_activo() AND NOT erp_lector_negocio(),
  '120-06a con la temporal: sin autoridad de negocio');
SELECT t120_assert((SELECT debe_cambiar_password FROM usuarios WHERE id = 12008), '120-06b pero lee su propio perfil (y sabe que debe cambiarla)');
SELECT t120_assert((SELECT count(*) FROM ordenes WHERE id IN (12001, 12002)) = 0, '120-06c y no lee datos de negocio');
SELECT t120_err($$SELECT confirmar_cambio_password()$$, '120-06d no se libera si la contraseña sigue siendo la temporal', '22023');
COMMIT;
-- Auth cambia el hash cuando el usuario elige su contraseña.
UPDATE auth.users SET encrypted_password = 'hash-propio-8' WHERE id = '12000000-0000-0000-0000-000000000008';
BEGIN; SET LOCAL ROLE authenticated; SELECT t120_auth(8);
SELECT t120_assert((confirmar_cambio_password() ->> 'ok')::boolean, '120-07a con contraseña propia: liberada');
SELECT t120_assert(erp_rol_activo() = 'Ventas' AND fin_actor_permitido(ARRAY['Admin', 'Ventas']), '120-07b recupera su rol');
SELECT t120_assert((confirmar_cambio_password() ->> 'replay')::boolean, '120-07c repetir es inofensivo');
COMMIT;
SELECT t120_assert(NOT (SELECT debe_cambiar_password FROM usuarios WHERE id = 12008)
               AND NOT EXISTS (SELECT 1 FROM usuarios_password_temporal WHERE usuario_id = 12008)
               AND EXISTS (SELECT 1 FROM bitacora_cambios WHERE registro_id = '12008' AND detalle LIKE 'contraseña propia establecida por Nueva 120'),
  '120-07d huella borrada y queda en la bitácora');

\echo '── CASOS 8–12: usuarios por contrato'
BEGIN; SET LOCAL ROLE authenticated; SELECT t120_auth(2);  -- Admin (no dueño)
SELECT t120_assert((guardar_usuario(12009, 'Producción 120', 'Chofer', 'Activo') ->> 'rol') = 'Chofer', '120-08a Admin cambia el rol de un operativo');
SELECT t120_err($$SELECT guardar_usuario(12004, 'Ventas 120', 'Admin', 'Activo')$$, '120-08b Admin no asigna el rol Admin', '42501');
SELECT t120_err($$SELECT guardar_usuario(12003, 'Admin2 120', 'Admin', 'Inactivo')$$, '120-08c Admin no desactiva a otro Admin', '42501');
SELECT t120_err($$SELECT guardar_usuario(12003, 'Admin2 120', 'Ventas', 'Activo')$$, '120-08d Admin no le quita el rol a otro Admin', '42501');
SELECT t120_assert((guardar_usuario(12003, 'Admin Dos 120', 'Admin', 'Activo') ->> 'ok')::boolean, '120-08e Admin sí corrige el nombre de otro Admin');
SELECT t120_err($$SELECT guardar_usuario(12002, 'Admin 120', 'Ventas', 'Activo')$$, '120-09a nadie se cambia su propio rol', '42501');
SELECT t120_err($$SELECT guardar_usuario(12002, 'Admin 120', 'Admin', 'Inactivo')$$, '120-09b ni se desactiva', '42501');
SELECT t120_err($$SELECT guardar_usuario(12001, 'Dueño 120', 'Admin', 'Activo')$$, '120-09c Admin no toca la cuenta del Dueño', '42501');
SELECT t120_err($$SELECT guardar_usuario(12006, 'Almacén 120', 'Almacén Bolsas', 'Activo', ARRAY['Ventas'])$$, '120-09d solo el Dueño asigna accesos', '42501');
SELECT t120_auth(4);
SELECT t120_err($$SELECT guardar_usuario(12006, 'x', 'Almacén Bolsas', 'Activo')$$, '120-10a Ventas no administra usuarios', '42501');
SELECT t120_auth(7);
SELECT t120_err($$SELECT guardar_usuario(12006, 'x', 'Almacén Bolsas', 'Activo')$$, '120-10b Empleado tampoco', '42501');
SELECT t120_auth(1);  -- Dueño
SELECT t120_assert((guardar_usuario(12006, 'Almacén 120', 'Almacén Bolsas', 'Activo', ARRAY['Ventas', 'Almacén Bolsas']) -> 'accesos_extra') = '["Ventas"]'::jsonb,
  '120-11a el Dueño asigna accesos (el propio rol se descarta)');
SELECT t120_err($$SELECT guardar_usuario(12006, 'Almacén 120', 'Almacén Bolsas', 'Activo', ARRAY['Producción'])$$, '120-11b acceso fuera de Ventas/Almacén: rechazado', '22023');
SELECT t120_assert((guardar_usuario(12004, 'Ventas 120', 'Admin', 'Activo') -> 'accesos_extra') = '[]'::jsonb, '120-11c el Dueño asigna el rol Admin (sin accesos)');
SELECT t120_assert((guardar_usuario(12003, 'Admin Dos 120', 'Admin', 'Inactivo') ->> 'estatus') = 'Inactivo', '120-11d el Dueño desactiva a un Admin');
SELECT t120_err($$SELECT guardar_usuario(12001, 'Dueño 120', 'Admin', 'Inactivo')$$, '120-11e el Dueño no se desactiva', '42501');
SELECT t120_err($$SELECT guardar_usuario(12001, 'Dueño 120', 'Ventas', 'Activo')$$, '120-11f ni se quita el rol', '42501');
SELECT t120_assert(erp_es_dueno() AND erp_rol_activo() = 'Admin' AND fin_actor_permitido(ARRAY['Admin']), '120-11g el Dueño es Admin para todos los contratos');
COMMIT;
SELECT t120_assert((SELECT accesos_extra FROM usuarios WHERE id = 12006) = '{Ventas}' AND (SELECT rol FROM usuarios WHERE id = 12004) = 'Admin',
  '120-11h cambios aplicados');
SELECT t120_assert((SELECT count(*) FROM bitacora_cambios WHERE tabla = 'usuarios' AND accion = 'CONTRATO' AND detalle = 'guardar_usuario'
                     AND registro_id IN ('12009', '12003', '12006', '12004')) = 5
               AND (SELECT count(*) FROM bitacora_cambios WHERE tabla = 'usuarios' AND accion = 'UPDATE' AND registro_id IN ('12009', '12003', '12006', '12004')) = 0,
  '120-12a cada cambio por contrato queda en la bitácora (sin duplicar por el disparador)');
SELECT t120_assert((SELECT actor FROM bitacora_cambios WHERE registro_id = '12006' AND detalle = 'guardar_usuario' ORDER BY id DESC LIMIT 1) = 'Dueño 120',
  '120-12b actor fijado por el servidor');
-- Un solo dueño, y el dueño es Admin.
SELECT t120_err($$UPDATE usuarios SET es_dueno = true WHERE id = 12002$$, '120-12c no hay dos dueños', '23505');
SELECT t120_err($$UPDATE usuarios SET es_dueno = true, rol = 'Ventas' WHERE id = 12001$$, '120-12d el dueño es Admin', '23514');

\echo '── CASOS 13–15: bitácora de escrituras REST'
BEGIN; SET LOCAL ROLE authenticated; SELECT t120_auth(2);
UPDATE productos SET precio = 25 WHERE sku = 'P120-PT';
UPDATE productos SET precio = 25 WHERE sku = 'P120-PT';   -- sin cambio: no se registra
-- REST de Admin sobre usuarios: existe hasta 121 (y queda en la bitácora); después, rechazada.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'admin_all') THEN
    UPDATE usuarios SET nombre = 'Ventas Uno 120' WHERE id = 12004;
  ELSE
    PERFORM t120_err($q$UPDATE usuarios SET nombre = 'Ventas Uno 120' WHERE id = 12004$q$, '120-14d tras 121: sin escritura REST en usuarios', '42501');
  END IF;
END $$;
SELECT t120_err($$INSERT INTO bitacora_cambios (tabla, accion, detalle) VALUES ('productos', 'UPDATE', 'inventado')$$,
  '120-13a nadie escribe la bitácora directo', '42501');
SELECT t120_assert((SELECT count(*) FROM bitacora_cambios) = 0, '120-13b Admin no lee la bitácora');
SELECT t120_auth(1);
SELECT t120_assert((SELECT cambios FROM bitacora_cambios WHERE tabla = 'productos' AND antes ->> 'sku' = 'P120-PT') = ARRAY['precio']
               AND (SELECT (antes ->> 'precio')::numeric = 31 AND (despues ->> 'precio')::numeric = 25 FROM bitacora_cambios WHERE tabla = 'productos' AND antes ->> 'sku' = 'P120-PT')
               AND (SELECT actor FROM bitacora_cambios WHERE tabla = 'productos' AND antes ->> 'sku' = 'P120-PT') = 'Admin 120',
  '120-14a cambio de precio por REST: antes/después, campo y actor');
SELECT t120_assert((SELECT count(*) FROM bitacora_cambios WHERE tabla = 'productos' AND antes ->> 'sku' = 'P120-PT') = 1, '120-14b una escritura sin cambios no se registra');
SELECT t120_assert((SELECT count(*) FROM bitacora_cambios WHERE tabla = 'usuarios' AND accion = 'UPDATE' AND registro_id = '12004')
                   = CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'admin_all') THEN 1 ELSE 0 END,
  '120-14c la escritura REST de usuarios queda registrada (antes de 121) / no existe (después)');
SELECT t120_err($$UPDATE bitacora_cambios SET detalle = 'x'$$, '120-15a ni el Dueño edita la bitácora', '42501');
SELECT t120_err($$DELETE FROM bitacora_cambios$$, '120-15b ni la borra', '42501');
COMMIT;
-- Escrituras de contratos (corren como su dueño) no pasan por el disparador.
SELECT t120_assert((SELECT count(*) FROM bitacora_cambios WHERE tabla = 'ordenes' AND COALESCE(despues ->> 'folio', antes ->> 'folio') LIKE 'OV-120%' AND accion <> 'UPDATE') = 0,
  '120-15c sin altas ni bajas de órdenes en la bitácora (solo hubo UPDATE por REST)');

BEGIN; SELECT t120_limpiar(); COMMIT;
DROP FUNCTION t120_limpiar(); DROP FUNCTION t120_assert(BOOLEAN, TEXT); DROP FUNCTION t120_err(TEXT, TEXT, TEXT);
DROP FUNCTION t120_auth(INTEGER); DROP FUNCTION t120_venta(BIGINT);
\echo '── 120: PASS'
