-- 071_actor_activo_test.sql — Fase B P0: un JWT `authenticated` sin perfil
-- ACTIVO del ERP no tiene autoridad; los RPC de stock verifican actor y rol
-- server-side y no aceptan atribución del cliente.
--
-- Actores: A anon · B JWT sin perfil · C perfil Inactivo · D rol no
-- autorizado (Ventas para stock) · E Ventas · F Chofer · G Producción ·
-- H Admin · I Almacén Bolsas.  Cada bloque corre en una transacción que
-- se revierte.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM inventario_mov; DELETE FROM pagos; DELETE FROM cuentas_por_cobrar; DELETE FROM movimientos_contables;
DELETE FROM orden_lineas; DELETE FROM ordenes; DELETE FROM rutas; DELETE FROM clientes; DELETE FROM usuarios; DELETE FROM auth.users;
DELETE FROM cuentas_por_pagar; DELETE FROM pagos_proveedores; DELETE FROM costos_fijos; DELETE FROM costos_historial; DELETE FROM notificaciones; DELETE FROM camiones;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@t'),
  ('00000000-0000-0000-0000-000000000002', 'ventas@t'),
  ('00000000-0000-0000-0000-000000000003', 'chofer@t'),
  ('00000000-0000-0000-0000-000000000004', 'prod@t'),
  ('00000000-0000-0000-0000-000000000005', 'inactivo@t'),
  ('00000000-0000-0000-0000-000000000006', 'bolsas@t'),
  ('00000000-0000-0000-0000-000000000007', 'legacy@t'),
  ('00000000-0000-0000-0000-000000000008', 'inactadmin@t'),
  ('00000000-0000-0000-0000-000000000099', 'autoregistro@evil');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (1, 'Admin T',    'admin@t',    'Admin',          'Activo',   '00000000-0000-0000-0000-000000000001'),
  (2, 'Ventas T',   'ventas@t',   'Ventas',         'Activo',   '00000000-0000-0000-0000-000000000002'),
  (3, 'Chofer T',   'chofer@t',   'Chofer',         'Activo',   '00000000-0000-0000-0000-000000000003'),
  (4, 'Prod T',     'prod@t',     'Producción',     'Activo',   '00000000-0000-0000-0000-000000000004'),
  (5, 'Inact T',    'inactivo@t', 'Ventas',         'Inactivo', '00000000-0000-0000-0000-000000000005'),
  (8, 'InactAdm T',  'inactadmin@t','Admin',         'Inactivo', '00000000-0000-0000-0000-000000000008'),
  (6, 'Bolsas T',   'bolsas@t',   'Almacén Bolsas', 'Activo',   '00000000-0000-0000-0000-000000000006'),
  (7, 'Legacy T',   'legacy@t',   'Chofer',         'Activo',   NULL);   -- sin auth_id: lo rellena el backfill de 071
-- Replay del backfill de 071 (la migración corrió antes de estos fixtures): liga el perfil legacy #7.
UPDATE usuarios u SET auth_id = au.id FROM auth.users au WHERE u.auth_id IS NULL AND lower(au.email) = lower(u.email);
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (10, 'Cliente T', 'XAXX010101000', 0);
INSERT INTO productos (sku, nombre, precio, stock) SELECT 'HPC-5K', 'Hielo 5kg', 35, 100 WHERE NOT EXISTS (SELECT 1 FROM productos WHERE sku = 'HPC-5K');
UPDATE productos SET stock = 100 WHERE sku = 'HPC-5K';
INSERT INTO productos (sku, nombre, precio, stock) SELECT 'EMP-5', 'Bolsa 5kg', 0, 50 WHERE NOT EXISTS (SELECT 1 FROM productos WHERE sku = 'EMP-5');
UPDATE productos SET stock = 50 WHERE sku = 'EMP-5';
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-T', 'Cuarto T', '{"HPC-5K": 20}'::jsonb) ON CONFLICT (id) DO UPDATE SET stock = '{"HPC-5K": 20}'::jsonb;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
  (200, 'OV-0200', 10, 'Cliente T', '1×HPC-5K', 100, 'Entregada', 'Efectivo', 'Contado', 2);
INSERT INTO pagos (id, cliente_id, orden_id, monto, metodo_pago, referencia, saldo_antes, saldo_despues, fecha) VALUES (300, 10, 200, 100, 'Efectivo', 'OV-0200-Efectivo', 0, 0, CURRENT_DATE);
INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, monto_original, monto_pagado, saldo_pendiente, estatus) VALUES (400, 10, NULL, 50, 0, 50, 'Pendiente');
INSERT INTO movimientos_contables (id, fecha, tipo, categoria, concepto, monto) VALUES (500, CURRENT_DATE, 'Ingreso', 'Ventas', 'Cobro OV-0200', 100);
INSERT INTO payment_webhook_events (id, provider, event_type, provider_reference, raw_payload) VALUES (600, 'stripe', 'checkout.session.completed', 'evt_t', '{"customer_email":"cliente@t"}'::jsonb);
INSERT INTO configuracion_empresa (id, razon_social, rfc) VALUES (1, 'Cubo T', 'CPO000000XX0') ON CONFLICT (id) DO NOTHING;
INSERT INTO cuentas_por_pagar (id, proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, categoria, estatus) VALUES (700, 'Prov T', 'Bolsas', 1000, 0, 1000, CURRENT_DATE, 'Proveedores', 'Pendiente');
INSERT INTO costos_fijos (id, nombre, monto, categoria) VALUES (800, 'Renta', 5000, 'Renta') ON CONFLICT DO NOTHING;
INSERT INTO notificaciones (id, tipo, titulo, mensaje) VALUES (900, 'venta', 'Venta', 'OV-0200 — Cliente T');
COMMIT;

-- Actor: rol JWT + email; `sub` = auth_id del perfil si existe. Para un JWT
-- sin perfil se pasa el uuid de auth.users que no tiene fila en usuarios.
CREATE OR REPLACE FUNCTION t_actor2(p_jwt_role TEXT, p_email TEXT, p_sub UUID DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub UUID := COALESCE(p_sub, (SELECT auth_id FROM usuarios WHERE lower(email) = lower(p_email)), (SELECT id FROM auth.users WHERE lower(email) = lower(p_email)));
BEGIN
  PERFORM set_config('request.jwt.claims',
    (jsonb_build_object('role', p_jwt_role, 'email', p_email) || CASE WHEN v_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', v_sub::text) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
      RAISE NOTICE 'OK: %', p_msg; END $$;
-- Cuenta filas visibles de una tabla como el actor actual (dentro de SET ROLE).
CREATE OR REPLACE FUNCTION t_count(p_tabla TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE format('SELECT count(*) FROM %I', p_tabla) INTO n; RETURN n; END $$;

\set QUIET off
\echo
\echo '════════ CONTRATO DE ACTOR ════════'
BEGIN;
SELECT t_assert((SELECT auth_id = '00000000-0000-0000-0000-000000000007' FROM usuarios WHERE id = 7), 'backfill: perfil legacy sin auth_id quedó ligado por email');
SELECT t_actor2('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
SELECT t_assert(erp_rol_activo() = 'Admin' AND erp_usuario_id() = 1 AND fin_mi_rol_activo() = 'Admin', 'H. Admin resuelve por auth.uid()');
SELECT t_actor2('authenticated', 'autoregistro@evil');
SELECT t_assert(erp_rol_activo() IS NULL AND erp_es_activo() = false AND fin_mi_rol_activo() IS NULL, 'B. JWT sin perfil → sin actor');
SELECT t_actor2('authenticated', 'inactivo@t');
SELECT t_assert(erp_rol_activo() IS NULL AND fin_mi_rol_activo() IS NULL, 'C. perfil Inactivo → sin actor');
SELECT t_actor2('authenticated', 'inactadmin@t');
SELECT t_assert(erp_rol_activo() IS NULL AND get_my_rol() IS NOT DISTINCT FROM (CASE WHEN pg_get_functiondef('public.get_my_rol()'::regprocedure) ~ 'erp_rol_activo' THEN NULL ELSE 'Admin' END), 'C bis. Admin Inactivo: sin actor en el contrato nuevo; get_my_rol() devuelve Admin (legacy por email) o NULL (canónico tras 079)');
-- JWT con el email de un perfil pero sub distinto (cuenta de Auth ajena): no hereda el perfil
SELECT t_actor2('authenticated', 'admin@t', '00000000-0000-0000-0000-000000000099');
SELECT t_assert(erp_rol_activo() IS NULL, 'B bis. email de Admin con sub ajeno → sin actor (no hay herencia por email)');
RESET ROLE;
ROLLBACK;

\echo
\echo '════════ LECTURA — sin perfil / inactivo / anon ════════'
BEGIN;
SELECT t_actor2('authenticated', 'autoregistro@evil'); SET LOCAL ROLE authenticated;
SELECT t_assert(t_count('clientes') = 0, '1. sin perfil no lee clientes');
SELECT t_assert(t_count('ordenes') = 0, '2. sin perfil no lee ordenes');
SELECT t_assert(t_count('pagos') = 0, '3. sin perfil no lee pagos');
SELECT t_assert(t_count('payment_webhook_events') = 0, '4. sin perfil no lee payment_webhook_events');
SELECT t_assert(t_count('cuentas_por_cobrar') = 0 AND t_count('movimientos_contables') = 0, '5. sin perfil no lee ledger');
SELECT t_assert(t_count('configuracion_empresa') = 0, '6. sin perfil no lee configuracion_empresa');
SELECT t_assert(t_count('productos') = 0 AND t_count('orden_lineas') = 0 AND t_count('rutas') = 0 AND t_count('notificaciones') = 0 AND t_count('payment_intents') = 0 AND t_count('cuentas_por_pagar') = 0 AND t_count('costos_fijos') = 0 AND t_count('inventario_mov') = 0, '6b. sin perfil no lee productos/líneas/rutas/notificaciones/intents/cxp/costos/kardex');
SELECT t_actor2('authenticated', 'inactivo@t');
SELECT t_assert(t_count('clientes') = 0 AND t_count('ordenes') = 0 AND t_count('pagos') = 0 AND t_count('cuentas_por_cobrar') = 0 AND t_count('movimientos_contables') = 0 AND t_count('configuracion_empresa') = 0 AND t_count('payment_webhook_events') = 0, '11. inactivo: mismas denegaciones de lectura');
RESET ROLE;
SELECT t_actor2('anon', NULL); SET LOCAL ROLE anon;
-- 090: anon ya no tiene SELECT (más estricto que cero filas).
DO $do$ DECLARE n BIGINT; BEGIN
  BEGIN n := t_count('clientes') + t_count('ordenes') + t_count('productos') + t_count('configuracion_empresa'); EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  PERFORM t_assert(n = 0, 'A. anon no lee nada');
END $do$;
RESET ROLE;
ROLLBACK;

\echo
\echo '════════ ESCRITURA — sin perfil / inactivo / rol no autorizado ════════'
BEGIN;
SELECT t_actor2('authenticated', 'autoregistro@evil'); SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, saldo_pendiente, fecha_emision, categoria) VALUES ('X', 'falso', 1, 1, CURRENT_DATE, 'Proveedores'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '7 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE cuentas_por_pagar SET saldo_pendiente = 0, estatus = 'Pagada' WHERE id = 700; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '7b denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO pagos_proveedores (cxp_id, monto, metodo_pago, fecha) VALUES (700, 1000, 'Efectivo', CURRENT_DATE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '8 denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO costos_fijos (nombre, monto, categoria) VALUES ('falso', 1, 'X'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '9 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE costos_fijos SET monto = 1 WHERE id = 800; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '9b denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha) VALUES ('X', 'X', 'falso', 1, '2026-09', CURRENT_DATE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '10 denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE notificaciones SET leida = true WHERE id = 900; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '10b denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO camiones (nombre, placas) VALUES ('Falso', 'FAKE-1'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '10c denied: %', SQLERRM; END $$;
SELECT t_actor2('authenticated', 'inactivo@t');
DO $$ BEGIN UPDATE cuentas_por_pagar SET saldo_pendiente = 0 WHERE id = 700; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '11b denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO costos_fijos (nombre, monto, categoria) VALUES ('falso-inactivo', 1, 'X'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '11c denied: %', SQLERRM; END $$;
-- D/E. Ventas (rol activo no autorizado para finanzas de proveedor/costos)
SELECT t_actor2('authenticated', 'ventas@t');
DO $$ BEGIN INSERT INTO costos_fijos (nombre, monto, categoria) VALUES ('falso-ventas', 1, 'X'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '12a denied: %', SQLERRM; END $$;
DO $$ BEGIN INSERT INTO pagos_proveedores (cxp_id, monto, metodo_pago, fecha) VALUES (700, 1000, 'Efectivo', CURRENT_DATE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE '12b denied: %', SQLERRM; END $$;
DO $$ BEGIN UPDATE cuentas_por_pagar SET saldo_pendiente = 0 WHERE id = 700; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '12c denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT count(*) = 1 FROM cuentas_por_pagar) AND (SELECT saldo_pendiente = 1000 AND estatus = 'Pendiente' FROM cuentas_por_pagar WHERE id = 700), '7/11/12. cuentas_por_pagar intacta');
SELECT t_assert((SELECT count(*) = 0 FROM pagos_proveedores), '8/12. pagos_proveedores sin filas');
SELECT t_assert((SELECT count(*) = 1 FROM costos_fijos) AND (SELECT monto = 5000 FROM costos_fijos WHERE id = 800), '9/11/12. costos_fijos intacto');
SELECT t_assert((SELECT count(*) = 0 FROM costos_historial), '10. costos_historial sin filas');
SELECT t_assert((SELECT NOT leida FROM notificaciones WHERE id = 900) AND (SELECT count(*) = 0 FROM camiones), '10b/10c. notificaciones y camiones intactos');
ROLLBACK;

\echo
\echo '════════ STOCK RPC ════════'
BEGIN;
SELECT t_actor2('authenticated', 'autoregistro@evil'); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":1000,"usuario":"Admin T"}]'::jsonb); RAISE EXCEPTION 'FAIL: sin perfil movió stock'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '13 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM update_productos_stock_atomic('[{"sku":"HPC-5K","delta":1000}]'::jsonb); RAISE EXCEPTION 'FAIL: sin perfil movió stock productos'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '13b denied: %', SQLERRM; END $$;
SELECT t_actor2('authenticated', 'inactivo@t');
DO $$ BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":1000}]'::jsonb); RAISE EXCEPTION 'FAIL: inactivo movió stock'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '14 denied: %', SQLERRM; END $$;
SELECT t_actor2('authenticated', 'ventas@t');
DO $$ BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":1000}]'::jsonb); RAISE EXCEPTION 'FAIL: Ventas movió stock'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '15 denied: %', SQLERRM; END $$;
DO $$ BEGIN PERFORM update_productos_stock_atomic('[{"sku":"HPC-5K","delta":1000}]'::jsonb); RAISE EXCEPTION 'FAIL: Ventas movió stock productos'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '15b denied: %', SQLERRM; END $$;
-- Chofer NO puede usar el RPC de productos (solo Admin/Producción/Bolsas)
SELECT t_actor2('authenticated', 'chofer@t');
DO $$ BEGIN PERFORM update_productos_stock_atomic('[{"sku":"HPC-5K","delta":1}]'::jsonb); RAISE EXCEPTION 'FAIL: Chofer movió stock productos'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '15c denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_actor2('anon', NULL); SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":1000}]'::jsonb); RAISE EXCEPTION 'FAIL: anon movió stock'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE 'A denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = 20 FROM cuartos_frios WHERE id = 'CF-T') AND (SELECT stock = 100 FROM productos WHERE sku = 'HPC-5K') AND (SELECT count(*) = 0 FROM inventario_mov), '13-15. stock y kardex intactos tras intentos no autorizados');

-- 16/18/19. Chofer legítimo: merma en ruta descuenta; atribución = actor real aunque el cliente mande otro nombre
CREATE OR REPLACE FUNCTION t_contenido() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'ARRAY\[''Admin''\]' $$;
GRANT EXECUTE ON FUNCTION t_contenido() TO anon, authenticated, service_role;
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
CREATE OR REPLACE FUNCTION t_p087() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION t_p087() TO anon, authenticated, service_role;
SELECT t_actor2('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
-- 085: contenido → el Chofer ya no ejecuta el RPC genérico (42501); antes, descuento legítimo.
DO $$ BEGIN IF t_contenido() THEN BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":-5,"tipo":"Merma","origen":"Merma ruta","usuario":"Admin T"}]'::jsonb); RAISE EXCEPTION 'FAIL: Chofer movió stock con el RPC genérico (085)'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '16 denied (085): %', SQLERRM; END; ELSE PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":-5,"tipo":"Merma","origen":"Merma ruta","usuario":"Admin T"}]'::jsonb); END IF; END $$;
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = CASE WHEN t_contenido() THEN 20 ELSE 15 END FROM cuartos_frios WHERE id = 'CF-T'), '16. Chofer: merma descuenta 5 (o 42501 tras 085)');
SELECT t_assert(t_contenido() OR (SELECT usuario = 'Chofer T' AND cantidad = 5 AND tipo = 'Merma' FROM inventario_mov ORDER BY id DESC LIMIT 1), '18/19. kardex registra al actor real (Chofer T), no "Admin T" del cliente');
-- 17. stock no negativo
SELECT t_actor2('authenticated', 'chofer@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":-500}]'::jsonb); RAISE EXCEPTION 'FAIL: stock negativo aceptado'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '17 denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = CASE WHEN t_contenido() THEN 20 ELSE 15 END FROM cuartos_frios WHERE id = 'CF-T'), '17. stock no puede ir a negativo');
-- 24. Producción: entrada a cuarto + traspaso a productos
SELECT t_actor2('authenticated', 'prod@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN IF t_contenido() THEN BEGIN PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":10,"tipo":"Entrada","origen":"Producción"}]'::jsonb); RAISE EXCEPTION 'FAIL: Producción movió stock con el RPC genérico (085)'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE NOTICE '24 denied (085): %', SQLERRM; END; ELSE PERFORM update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":10,"tipo":"Entrada","origen":"Producción"}]'::jsonb); END IF; END $$;
SELECT t88_retirada($q$SELECT update_productos_stock_atomic('[{"sku":"HPC-5K","delta":-3,"tipo":"Salida","origen":"Transformación"}]'::jsonb)$q$, '24. Producción: stock genérico de producto');
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = CASE WHEN t_contenido() THEN 20 ELSE 25 END FROM cuartos_frios WHERE id = 'CF-T') AND (SELECT stock = CASE WHEN t88_fase() THEN 100 ELSE 97 END FROM productos WHERE sku = 'HPC-5K'), '24. Producción: cuarto +10 (o 42501 tras 085), productos -3');
SELECT t_assert(t88_fase() OR (SELECT bool_and(usuario = 'Prod T') FROM (SELECT usuario FROM inventario_mov ORDER BY id DESC LIMIT CASE WHEN t_contenido() THEN 1 ELSE 2 END) x), '24. atribución Producción real (088: sin movimiento genérico)');
-- I. Almacén Bolsas: entrada de empaques
SELECT t_actor2('authenticated', 'bolsas@t'); SET LOCAL ROLE authenticated;
SELECT t88_retirada($q$SELECT update_productos_stock_atomic('[{"sku":"EMP-5","delta":100,"tipo":"Entrada","origen":"Compra bolsas"}]'::jsonb)$q$, 'I. Almacén Bolsas: stock genérico');
SELECT t88_retirada($q$INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, categoria, estatus) VALUES ('Prov T', 'Compra empaques', 200, 0, 200, CURRENT_DATE, 'Proveedores', 'Pendiente')$q$, 'I. Almacén Bolsas: CxP directa');
DO $$ BEGIN INSERT INTO cuentas_por_pagar (proveedor, concepto, monto_original, saldo_pendiente, fecha_emision, categoria) VALUES ('Prov T', 'otra categoría', 1, 1, CURRENT_DATE, 'Nómina'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'I denied: %', SQLERRM; END $$;
RESET ROLE;
SELECT t_assert((SELECT stock = CASE WHEN t88_fase() THEN 50 ELSE 150 END FROM productos WHERE sku = 'EMP-5') AND (SELECT count(*) = CASE WHEN t88_fase() THEN 1 ELSE 2 END FROM cuentas_por_pagar) AND (SELECT count(*) = 0 FROM cuentas_por_pagar WHERE categoria = 'Nómina'), 'I. Almacén Bolsas: stock de empaques y CxP de compra; otra categoría denegada');
-- H. Admin: reverso de merma (flujo borrarMermaConReverso) y devolución de ruta
SELECT t_actor2('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
SELECT update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":5,"tipo":"Entrada","origen":"Reverso merma"}]'::jsonb);
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = CASE WHEN t_contenido() THEN 25 ELSE 30 END FROM cuartos_frios WHERE id = 'CF-T') AND (SELECT usuario = 'Admin T' FROM inventario_mov ORDER BY id DESC LIMIT 1), 'H. Admin: entrada y atribución real');
-- Anidado: cerrar_ruta_atomic (Admin) → update_stocks_atomic en contexto rpc conserva auth.uid()
INSERT INTO rutas (id, folio, nombre, chofer_id, estatus, fecha) VALUES (100, 'R-T', 'Ruta T', 3, 'En progreso', CURRENT_DATE);
SELECT t_actor2('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT t_p087() THEN PERFORM cerrar_ruta_atomic(100, '{"HPC-5K": 2}'::jsonb, 'CF-T', '[]'::jsonb, 0, 0, 'Admin T'); END IF; END $$;  -- 087: retirada
RESET ROLE;
SELECT t_assert((SELECT (stock->>'HPC-5K')::int = CASE WHEN t_contenido() THEN 27 ELSE 32 END - CASE WHEN t_p087() THEN 2 ELSE 0 END FROM cuartos_frios WHERE id = 'CF-T') AND (SELECT usuario = 'Admin T' FROM inventario_mov ORDER BY id DESC LIMIT 1) AND (SELECT estatus = CASE WHEN t_p087() THEN 'En progreso' ELSE 'Cerrada' END FROM rutas WHERE id = 100), 'anidado: cerrar_ruta_atomic devuelve stock con actor real (087: retirada, sin efecto)');
-- service_role (backend): permitido y etiquetado explícitamente
SELECT t_actor2('service_role', NULL); SET LOCAL ROLE service_role;
SELECT update_stocks_atomic('[{"cuarto_id":"CF-T","sku":"HPC-5K","delta":1,"origen":"backend","usuario":"Admin T"}]'::jsonb);
RESET ROLE;
SELECT t_assert((SELECT usuario = 'service_role' FROM inventario_mov ORDER BY id DESC LIMIT 1), 'service_role: atribución explícita, no suplanta a un usuario');
ROLLBACK;

\echo
\echo '════════ LECTURAS Y FLUJOS LEGÍTIMOS ════════'
BEGIN;
SELECT t_actor2('authenticated', 'admin@t'); SET LOCAL ROLE authenticated;
SELECT t_assert(t_count('clientes') = 1 AND t_count('ordenes') = 1 AND t_count('pagos') = 1 AND t_count('cuentas_por_cobrar') = 1 AND t_count('movimientos_contables') = 1 AND t_count('payment_webhook_events') = 1 AND t_count('configuracion_empresa') = 1 AND t_count('cuentas_por_pagar') = 1 AND t_count('costos_fijos') = 1, '21. Admin lee todo');
INSERT INTO costos_fijos (nombre, monto, categoria) VALUES ('Luz', 100, 'Servicios');
DO $do$ BEGIN
  IF has_table_privilege('authenticated', 'public.pagos_proveedores', 'INSERT') THEN
    UPDATE cuentas_por_pagar SET saldo_pendiente = 900, monto_pagado = 100, estatus = 'Parcial' WHERE id = 700;
    INSERT INTO pagos_proveedores (cxp_id, monto, metodo_pago, fecha) VALUES (700, 100, 'Efectivo', CURRENT_DATE);
  ELSE
    -- 099: el pago a proveedor se registra con el contrato (fecha del servidor).
    PERFORM pagar_cuenta_por_pagar('71000000-0000-0000-0000-0000000000a1', 700, 100, 'Efectivo', '');
  END IF;
END $do$;
UPDATE notificaciones SET leida = true WHERE id = 900;
SELECT t_assert(t_count('costos_fijos') = 2 AND t_count('pagos_proveedores') = 1 AND (SELECT leida FROM notificaciones WHERE id = 900), '21. Admin escribe costos, paga CxP y marca notificación');
SELECT t_actor2('authenticated', 'ventas@t');
SELECT t_assert(t_count('clientes') = 1 AND t_count('ordenes') = 1 AND t_count('cuentas_por_cobrar') = 1 AND t_count('productos') >= 1 AND t_count('pagos') = 1, '22. Ventas lee clientes, órdenes, CxC, productos y pagos');
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes' AND policyname = 'ventas_insert') THEN
    -- 089: Ventas ya no inserta órdenes por REST (usa crear_orden); la fila se
    -- crea como fixture y se comprueba la denegación.
    BEGIN
      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES ('OV-V', 10, 'Cliente T', '1×HPC-5K', 35, 'Creada', 'Efectivo', 'Contado', 2);
      RAISE EXCEPTION 'FAIL: 22. (089) INSERT directo de orden no fue denegado';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 22. (089) INSERT directo de orden denegado';
    END;
    RESET ROLE;
    INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES ('OV-V', 10, 'Cliente T', '1×HPC-5K', 35, 'Creada', 'Efectivo', 'Contado', 2);
    SET LOCAL ROLE authenticated;
  ELSE
    INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES ('OV-V', 10, 'Cliente T', '1×HPC-5K', 35, 'Creada', 'Efectivo', 'Contado', 2);
  END IF;
END $do$;
UPDATE notificaciones SET leida = false WHERE id = 900;
SELECT t_assert((SELECT count(*) = 1 FROM ordenes WHERE folio = 'OV-V'), '22. Ventas crea pedido');
SELECT t_actor2('authenticated', 'chofer@t');
SELECT t_assert(t_count('ordenes') = 2 AND t_count('rutas') = 0 AND t_count('clientes') = 1 AND t_count('cuartos_frios') >= 1, '23. Chofer lee órdenes, clientes y cuartos');
SELECT t_actor2('authenticated', 'prod@t');
SELECT t_assert(t_count('productos') >= 1 AND t_count('cuartos_frios') >= 1 AND t_count('produccion') >= 0 AND t_count('inventario_mov') >= 0, '24. Producción lee productos, cuartos, producción y kardex');
SELECT t88_retirada($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha) VALUES ('Costo de Ventas', 'Costo de Ventas', 'Producción OP-1: empaque', 10, '2026-09', CURRENT_DATE)$q$, '24. Producción: costos_historial directo');
SELECT t_assert(t_count('costos_historial') = CASE WHEN t88_fase() THEN 0 ELSE 1 END, '24. Producción registra costo de empaque (088: solo por contrato)');
SELECT t_actor2('authenticated', 'legacy@t');
SELECT t_assert(t_count('ordenes') = 2, 'legacy: perfil ligado por backfill lee como Chofer');
RESET ROLE;
ROLLBACK;

\echo
\echo '════════ REALTIME (mismo predicado que evalúa postgres_changes) ════════'
-- Supabase Realtime evalúa la policy SELECT de cada tabla con las claims del
-- suscriptor. Verificamos que para las tablas publicadas sensibles el
-- predicado sea erp_es_activo() (no `true`).
BEGIN;
SELECT t_assert(NOT EXISTS (
  SELECT 1 FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.cmd = 'SELECT' AND p.qual = 'true'
     AND p.tablename IN (SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
), '20. ninguna tabla publicada en realtime tiene SELECT USING (true)');
SELECT t_assert(NOT EXISTS (
  SELECT 1 FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.cmd IN ('SELECT','ALL') AND p.qual = 'true'
     AND p.tablename IN ('clientes','ordenes','orden_lineas','pagos','cuentas_por_cobrar','movimientos_contables','payment_intents','payment_webhook_events','invoice_attempts','configuracion_empresa','rutas','productos','notificaciones','cuentas_por_pagar','pagos_proveedores','costos_fijos','costos_historial','camiones')
), 'B1. ninguna tabla sensible conserva lectura/escritura USING (true)');
ROLLBACK;

\echo
\echo '════════ TODAS LAS PRUEBAS 071 PASARON ════════'
