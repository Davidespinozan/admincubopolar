-- 085_contencion_stock_test.sql — R2 contención de seguridad.
-- Estado físico; RPC genérico solo Admin (matriz con huella); SKU desconocido
-- rechazado por completo; contratos 076/069/084 sin dependencia del genérico y
-- funcionando como Producción/Chofer/Admin; carga confirmada solo por contrato
-- (bypass directo denegado); compensación 078 eliminada.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P85-%');
DELETE FROM mermas WHERE sku LIKE 'P85-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P85-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P85-%' OR concepto LIKE '%R-85%';
DELETE FROM inventario_mov WHERE producto LIKE 'P85-%';
DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '85000000-%' OR ruta_id BETWEEN 8501 AND 8509 OR orden_id BETWEEN 8520 AND 8529;
DELETE FROM produccion WHERE sku LIKE 'P85-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8520 AND 8529;
DELETE FROM ordenes WHERE id BETWEEN 8520 AND 8529;
DELETE FROM auditoria WHERE detalle LIKE '%R-85%';
DELETE FROM rutas WHERE id BETWEEN 8501 AND 8509;
DELETE FROM clientes WHERE id = 8510;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-85%';
DELETE FROM productos WHERE sku LIKE 'P85-%';
DELETE FROM usuarios WHERE id BETWEEN 8501 AND 8519;
DELETE FROM auth.users WHERE id::text LIKE '85000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('85000000-0000-0000-0000-000000000001', 'admin85@t'),  ('85000000-0000-0000-0000-000000000002', 'prod85@t'),
  ('85000000-0000-0000-0000-000000000003', 'chofer85@t'), ('85000000-0000-0000-0000-000000000004', 'bolsas85@t'),
  ('85000000-0000-0000-0000-000000000005', 'ventas85@t'), ('85000000-0000-0000-0000-000000000006', 'fact85@t'),
  ('85000000-0000-0000-0000-000000000007', 'inadm85@t'),  ('85000000-0000-0000-0000-000000000099', 'noprof85@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (8501, 'Admin 85',   'admin85@t',  'Admin',          'Activo',   '85000000-0000-0000-0000-000000000001'),
  (8502, 'Prod 85',    'prod85@t',   'Producción',     'Activo',   '85000000-0000-0000-0000-000000000002'),
  (8503, 'Chofer 85',  'chofer85@t', 'Chofer',         'Activo',   '85000000-0000-0000-0000-000000000003'),
  (8504, 'Bolsas 85',  'bolsas85@t', 'Almacén Bolsas', 'Activo',   '85000000-0000-0000-0000-000000000004'),
  (8505, 'Ventas 85',  'ventas85@t', 'Ventas',         'Activo',   '85000000-0000-0000-0000-000000000005'),
  (8506, 'Fact 85',    'fact85@t',   'Facturación',    'Activo',   '85000000-0000-0000-0000-000000000006'),
  (8507, 'InAdmin 85', 'inadm85@t',  'Admin',          'Inactivo', '85000000-0000-0000-0000-000000000007');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P85-HIELO', 'Hielo 85', 'Producto Terminado', 30, 0,  0, 'P85-BOLSA'),
  ('P85-BOLSA', 'Bolsa 85', 'Empaque',            0,  20, 1, NULL),
  ('P85-BARRA', 'Barra 85', 'Materia Prima',      0,  20, 0, NULL),
  ('P85-TRIT',  'Trit 85',  'Producto Terminado', 40, 0,  0, NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-85A', 'Cuarto 85A', '{"P85-HIELO": 30}'), ('CF-85B', 'Cuarto 85B', '{}');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8510, 'Cliente 85', 'XAXX010101000', 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
  (8501, 'R-8501', 'Ruta 85',       8503, 'Chofer 85', 'Pendiente firma', CURRENT_DATE, '{"P85-HIELO": 8}', '{}', '{"P85-HIELO": 8}', now()),
  (8502, 'R-8502', 'Ruta 85 cierre', NULL, NULL,       'En progreso',     CURRENT_DATE, '{"P85-HIELO": 5}', '{}', '{"P85-HIELO": 5}', now());
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
  (8520, 'OV-8520', 8510, 'Cliente 85', '2×P85-HIELO', 60, 'Asignada', 'Efectivo', 'Contado', 8505, 8501);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8520, 'P85-HIELO', 2, 30, 60);
COMMIT;

CREATE OR REPLACE FUNCTION t85_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t85_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t_p087() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION t_p087() TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t85_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t85_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t85_cf(p_id TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t85_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(id || '=' || stock::text, ' ' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-85%'),
    (SELECT string_agg(sku || '=' || stock, ' ' ORDER BY sku) FROM productos WHERE sku LIKE 'P85-%'),
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 8501 AND 8509),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P85-%'),
    (SELECT count(*)::text FROM produccion WHERE sku LIKE 'P85-%'),
    (SELECT count(*)::text FROM stock_operaciones WHERE operacion_id::text LIKE '85000000-%')))
$$;
DROP TABLE IF EXISTS t85_ids;
CREATE TEMP TABLE t85_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t85_ids TO anon, authenticated, service_role;
INSERT INTO t85_ids VALUES ('h0', t85_huella());
CREATE OR REPLACE FUNCTION t85_generico(p_tag TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-HIELO","delta":99999}]'::jsonb)$q$, p_tag || ': +99999 denegado', '42501');
  PERFORM t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-HIELO","delta":-30}]'::jsonb)$q$, p_tag || ': −30 denegado', '42501');
  PERFORM t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85B","sku":"P85-HIELO","delta":1}]'::jsonb)$q$, p_tag || ': otro cuarto denegado', '42501');
  PERFORM t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-FANTASMA","delta":1}]'::jsonb)$q$, p_tag || ': SKU desconocido denegado', '42501');
END $$;
GRANT EXECUTE ON FUNCTION t85_generico(TEXT) TO anon, authenticated;

\echo '── 085: estado físico'
SELECT t85_assert(pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'fin_actor_permitido\(ARRAY\[''Admin''\]\)'
  AND pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) ~ 'SKU no encontrado'
  AND pg_get_functiondef('public.update_stocks_atomic(jsonb)'::regprocedure) !~ 'fin_marcar_ctx|current_setting\(''app\.fin_ctx''|get_my_', '085-01 update_stocks_atomic: solo Admin en la API, validación de SKU, sin bypass de contexto');
SELECT t85_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.update_stocks_atomic(jsonb)'::regprocedure), '085-02 update_stocks_atomic: search_path fijo y ACL intacta (authenticated/service_role)');
SELECT t85_assert((SELECT bool_and(pg_get_functiondef(oid) !~ 'update_stocks_atomic' AND pg_get_functiondef(oid) ~ 'PERFORM stock_mov_cuarto\(') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('registrar_produccion', 'registrar_transformacion', 'cerrar_ruta_atomic')), '085-03 registrar_produccion / registrar_transformacion / cerrar_ruta_atomic: sin dependencia del RPC genérico (usan stock_mov_cuarto)');
SELECT t85_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'update_stocks_atomic' AND p.proname !~ '^t[0-9]*_' AND pg_get_functiondef(p.oid) ~ 'update_stocks_atomic\('), '085-04 ninguna función de la base de datos invoca ya el RPC genérico');
SELECT t85_assert(pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.carga_ctx' AND pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) !~ 'OLD\.estatus = ''Cargada'' AND NEW\.estatus = ''Pendiente firma''', '085-05 guard 078: exige app.carga_ctx en Pendiente firma → Cargada y ya no tiene la compensación Cargada → Pendiente firma');
SELECT t85_assert(pg_get_functiondef('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)'::regprocedure) ~ 'set_config\(''app\.carga_ctx''', '085-06 confirmar_carga_ruta fija la marca de contexto');
SELECT t85_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('public', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure), '085-07 stock_mov_cuarto: primitivo interno sin EXECUTE de API');
SELECT t85_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('registrar_produccion', 'registrar_transformacion', 'cerrar_ruta_atomic', 'confirmar_carga_ruta', 'rutas_guard_chofer')), '085-08 contratos re-creados con search_path fijo');

\echo '── 085: RPC genérico — matriz de actores (cero efectos)'
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('085-10 Chofer',          'chofer85@t', '85000000-0000-0000-0000-000000000003'),
      ('085-11 Producción',      'prod85@t',   '85000000-0000-0000-0000-000000000002'),
      ('085-12 Almacén Bolsas',  'bolsas85@t', '85000000-0000-0000-0000-000000000004'),
      ('085-13 Ventas',          'ventas85@t', '85000000-0000-0000-0000-000000000005'),
      ('085-14 Facturación',     'fact85@t',   '85000000-0000-0000-0000-000000000006'),
      ('085-15 Admin INACTIVO',  'inadm85@t',  '85000000-0000-0000-0000-000000000007'),
      ('085-16 JWT sin perfil',  'noprof85@t', '85000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t85_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t85_generico(a.tag);
    RESET ROLE;
    PERFORM t85_assert(t85_huella() = (SELECT v FROM t85_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;
BEGIN; SET LOCAL ROLE anon; SELECT t85_actor('anon', NULL, NULL);
SELECT t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-HIELO","delta":1}]'::jsonb)$q$, '085-17 anon: sin EXECUTE', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'admin85@t', '85000000-0000-0000-0000-000000000001');
SELECT t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-FANTASMA","delta":1}]'::jsonb)$q$, '085-20 Admin: SKU desconocido rechazado', '22023');
SELECT t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-HIELO","delta":1},{"cuarto_id":"CF-85A","sku":"P85-FANTASMA","delta":1}]'::jsonb)$q$, '085-21 Admin: lote con un SKU desconocido rechazado completo', '22023');
SELECT t85_assert(t85_cf('CF-85A', 'P85-HIELO') = 30 AND (SELECT NOT (stock ? 'P85-FANTASMA') FROM cuartos_frios WHERE id = 'CF-85A'), '085-22 sin mutación parcial ni llave nueva');
SELECT t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-85A","sku":"P85-HIELO","delta":-31}]'::jsonb)$q$, '085-23 Admin: negativo sigue rechazado', 'P0001');
SELECT t85_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-NO","sku":"P85-HIELO","delta":1}]'::jsonb)$q$, '085-24 Admin: cuarto inexistente sigue rechazado', 'P0001');
SELECT t85_assert((update_stocks_atomic('[{"cuarto_id":"CF-85B","sku":"P85-HIELO","delta":4,"tipo":"Entrada","origen":"Devolución cliente 85"}]'::jsonb) ->> 'actor') = 'Admin 85' AND t85_cf('CF-85B', 'P85-HIELO') = 4, '085-25 Admin: ajuste genérico legítimo (registrarDevolucion / cancelación / reverso) funciona');
SELECT t85_assert((SELECT cuarto_id = 'CF-85B' AND usuario = 'Admin 85' FROM inventario_mov WHERE producto = 'P85-HIELO' ORDER BY id DESC LIMIT 1), '085-26 kardex del genérico ahora lleva cuarto_id');
ROLLBACK;
SELECT t85_assert((update_stocks_atomic('[{"cuarto_id":"CF-85B","sku":"P85-HIELO","delta":1}]'::jsonb) ->> 'success') = 'true' AND t85_cf('CF-85B', 'P85-HIELO') = 1, '085-27 SQL sin JWT (mantenimiento): conservado');
UPDATE cuartos_frios SET stock = '{}'::jsonb WHERE id = 'CF-85B'; DELETE FROM inventario_mov WHERE producto = 'P85-HIELO';
BEGIN; SET LOCAL ROLE service_role; SELECT t85_actor('service_role', NULL, NULL);
SELECT t85_assert((update_stocks_atomic('[{"cuarto_id":"CF-85B","sku":"P85-HIELO","delta":1}]'::jsonb) ->> 'actor') = 'service_role', '085-28 service_role (backend): conservado con atribución explícita');
ROLLBACK;

\echo '── 085: contratos internos sin el RPC genérico'
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'prod85@t', '85000000-0000-0000-0000-000000000002');
INSERT INTO t85_ids VALUES ('p1', registrar_produccion('85000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 1', 'P85-HIELO', 6, 'CF-85B')::text);
INSERT INTO t85_ids VALUES ('t1', registrar_transformacion('85000000-0000-0000-0000-00000000b001', 'P85-BARRA', 8, 'P85-TRIT', 6, 'CF-85B')::text);
COMMIT;
SELECT t85_assert(((SELECT v FROM t85_ids WHERE k = 'p1')::jsonb ->> 'actor') = 'Prod 85' AND t85_cf('CF-85B', 'P85-HIELO') = 6 AND (SELECT stock = 14 FROM productos WHERE sku = 'P85-BOLSA') AND (SELECT count(*) = 1 FROM produccion WHERE sku = 'P85-HIELO' AND estatus = 'Confirmada'), '085-30 registrar_produccion como Producción: cuarto +6, empaque 20 → 14, fila Confirmada');
SELECT t85_assert((SELECT count(*) = 1 AND bool_and(cuarto_id = 'CF-85B' AND usuario = 'Prod 85' AND referencia ~ '^produccion/OP-') FROM inventario_mov WHERE producto = 'P85-HIELO' AND tipo = 'Entrada'), '085-31 kardex de producción con cuarto_id y referencia, actor real');
SELECT t85_assert((SELECT count(*) = CASE WHEN to_regprocedure('public.conciliacion_empaque()') IS NOT NULL THEN 0 ELSE 1 END AND bool_and(monto = 6 AND categoria = 'Costo de Ventas') IS NOT FALSE FROM movimientos_contables WHERE concepto LIKE '%P85-HIELO%') AND (SELECT count(*) = 1 FROM costos_historial WHERE concepto LIKE '%P85-HIELO%'), '085-32 egreso y costos_historial de 076 intactos');
SELECT t85_assert(t85_cf('CF-85B', 'P85-TRIT') = 6 AND (SELECT stock = 12 FROM productos WHERE sku = 'P85-BARRA') AND (SELECT count(*) = 1 FROM mermas WHERE sku = 'P85-BARRA' AND cantidad = 2 AND NOT afecta_stock), '085-33 registrar_transformacion como Producción: insumo 20 → 12, salida 6, merma de proceso 2');
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'prod85@t', '85000000-0000-0000-0000-000000000002');
SELECT t85_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P85-HIELO', 99, 'CF-85B')$q$, '085-34 empaque insuficiente: rechazo completo (rollback intacto)', 'P0001');
ROLLBACK;
SELECT t85_assert(t85_cf('CF-85B', 'P85-HIELO') = 6 AND (SELECT stock = 14 FROM productos WHERE sku = 'P85-BOLSA'), '085-35 nada cambió tras el rechazo');
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'admin85@t', '85000000-0000-0000-0000-000000000001');
DO $$ BEGIN IF NOT t_p087() THEN INSERT INTO t85_ids VALUES ('c1', cerrar_ruta_atomic(8502, '{"P85-HIELO": 3}'::jsonb, 'CF-85B', '[]'::jsonb, 0, 0, 'Admin 85')::text); END IF; END $$;  -- 087: retirada
COMMIT;
SELECT t85_assert(CASE WHEN t_p087() THEN to_regprocedure('public.cerrar_ruta_atomic(bigint,jsonb,text,jsonb,numeric,numeric,text)') IS NULL AND t85_cf('CF-85B', 'P85-HIELO') = 6 AND (SELECT estatus <> 'Cerrada' FROM rutas WHERE id = 8502) ELSE (SELECT estatus = 'Cerrada' AND devolucion = '{"P85-HIELO": 3}'::jsonb FROM rutas WHERE id = 8502) AND t85_cf('CF-85B', 'P85-HIELO') = 9 END, '085-36 cerrar_ruta_atomic (Admin): cierra y devuelve stock (087: cerrar_ruta_atomic retirada)');
SELECT t85_assert(CASE WHEN t_p087() THEN (SELECT count(*) = 0 FROM inventario_mov WHERE producto = 'P85-HIELO' AND origen LIKE 'Devolución ruta%%') ELSE (SELECT count(*) = 1 AND bool_and(cuarto_id = 'CF-85B' AND ruta_id = 8502 AND usuario = 'Admin 85' AND referencia = 'devolucion_ruta/R-8502' AND cantidad = 3 AND tipo = 'Entrada') FROM inventario_mov WHERE producto = 'P85-HIELO' AND origen LIKE 'Devolución ruta%') END, '085-37 kardex de la devolución con cuarto, ruta y referencia; actor real (087: cerrar_ruta_atomic retirada)');

\echo '── 085: la carga solo se confirma por contrato (bypass directo denegado)'
INSERT INTO t85_ids VALUES ('h1', t85_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'chofer85@t', '85000000-0000-0000-0000-000000000003');
SELECT t85_err($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 8503, estatus = 'Cargada', firma_carga = 'data:x', firma_excepcion = false WHERE id = 8501$q$, '085-40 Chofer: Pendiente firma → Cargada por UPDATE directo (forma completa de firma) rechazado', '42501');
SELECT t85_err($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 8503, estatus = 'Cargada', firma_excepcion = true, firma_excepcion_motivo = 'x' WHERE id = 8501$q$, '085-41 Chofer: forma de excepción por UPDATE directo rechazada', '42501');
SELECT t85_err($q$UPDATE rutas SET estatus = 'Cargada' WHERE id = 8501$q$, '085-42 Chofer: solo estatus → rechazado', '42501');
SELECT t85_err($q$UPDATE rutas SET carga_confirmada_at = now() WHERE id = 8501$q$, '085-43 Chofer: carga_confirmada_at sola rechazada', '42501');
SELECT t85_err($q$UPDATE rutas SET carga_confirmada_por = 8503 WHERE id = 8501$q$, '085-44 Chofer: carga_confirmada_por sola rechazada', '42501');
SELECT t85_err($q$UPDATE rutas SET firma_carga = 'x' WHERE id = 8501$q$, '085-45 Chofer: firma_carga sola rechazada', '42501');
SELECT t85_err($q$UPDATE rutas SET firma_excepcion = true, firma_excepcion_motivo = 'x' WHERE id = 8501$q$, '085-46 Chofer: firma_excepcion/motivo solos rechazados', '42501');
ROLLBACK;
SELECT t85_assert(t85_huella() = (SELECT v FROM t85_ids WHERE k = 'h1') AND (SELECT estatus = 'Pendiente firma' AND carga_confirmada_at IS NULL FROM rutas WHERE id = 8501) AND t85_cf('CF-85A', 'P85-HIELO') = 30, '085-47 cero efectos: la ruta sigue Pendiente firma y el cuarto intacto');
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'chofer85@t', '85000000-0000-0000-0000-000000000003');
INSERT INTO t85_ids VALUES ('l1', confirmar_carga_ruta('85000000-0000-0000-0000-00000000c001', 8501, 'data:image/png;base64,QQ==')::text);
INSERT INTO t85_ids VALUES ('l1r', confirmar_carga_ruta('85000000-0000-0000-0000-00000000c001', 8501, 'data:image/png;base64,QQ==')::text);
SELECT t85_err($q$UPDATE rutas SET carga_confirmada_at = NULL, carga_confirmada_por = NULL, firma_carga = NULL, firma_excepcion = false, firma_excepcion_motivo = NULL, estatus = 'Pendiente firma' WHERE id = 8501$q$, '085-50 compensación Cargada → Pendiente firma ya no es una transición del Chofer', '42501');
SELECT t85_assert(t85_rows($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 8501$q$) = 1, '085-51 Cargada → En progreso sigue funcionando');
INSERT INTO t85_ids VALUES ('n1', registrar_no_entrega('85000000-0000-0000-0000-00000000d001', 8520, 'Local cerrado')::text);
DO $do$ BEGIN
  IF t_p087() THEN
    PERFORM t85_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8501$q$, '085-52 (087) En progreso → Cerrada solo por finalizar_inventario_ruta', '42501');
  ELSE
    PERFORM t85_assert(t85_rows($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8501$q$) = 1, '085-52 En progreso → Cerrada sigue funcionando');
  END IF;
END $do$;
COMMIT;
SELECT t85_assert(((SELECT v FROM t85_ids WHERE k = 'l1')::jsonb ->> 'replay') = 'false' AND ((SELECT v FROM t85_ids WHERE k = 'l1r')::jsonb ->> 'replay') = 'true' AND t85_cf('CF-85A', 'P85-HIELO') = 22 AND (SELECT carga_confirmada_por::text = '8503' AND firma_carga IS NOT NULL FROM rutas WHERE id = 8501), '085-53 confirmar_carga_ruta (Chofer dueño): PASS, 30 → 22 una sola vez, firmante = actor');
SELECT t85_assert(((SELECT v FROM t85_ids WHERE k = 'n1')::jsonb ->> 'estatus') = 'No entregada' AND (SELECT estatus = 'No entregada' FROM ordenes WHERE id = 8520), '085-54 registrar_no_entrega: PASS');
SELECT t85_assert(COALESCE(current_setting('app.carga_ctx', true), '') = '', '085-55 la marca de contexto no persiste fuera de la transacción del contrato');
BEGIN; SET LOCAL ROLE authenticated; SELECT t85_actor('authenticated', 'prod85@t', '85000000-0000-0000-0000-000000000002');
INSERT INTO t85_ids VALUES ('s1', salida_cuarto_manual('85000000-0000-0000-0000-00000000e001', 'CF-85A', 'P85-HIELO', 2, 'Venta directa')::text);
INSERT INTO t85_ids VALUES ('tr1', traspaso_cuartos('85000000-0000-0000-0000-00000000f001', 'CF-85A', 'CF-85B', 'P85-HIELO', 5)::text);
COMMIT;
SELECT t85_assert(t85_cf('CF-85A', 'P85-HIELO') = 15 AND t85_cf('CF-85B', 'P85-HIELO') = CASE WHEN t_p087() THEN 11 ELSE 14 END, '085-56 salida_cuarto_manual y traspaso_cuartos (Producción): PASS (22 → 20 → 15; 9 → 14)');
SELECT t85_assert((SELECT count(*) = CASE WHEN t_p087() THEN 6 ELSE 8 END AND bool_and(cuarto_id IS NOT NULL) FROM inventario_mov WHERE producto IN ('P85-HIELO', 'P85-TRIT')) AND (SELECT count(*) = 2 AND bool_and(cuarto_id IS NULL) FROM inventario_mov WHERE producto IN ('P85-BOLSA', 'P85-BARRA')), '085-57 todo el kardex de cuartos lleva cuarto_id (8 filas); empaque/insumo de 076 siguen a nivel producto (2 filas)');

BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P85-%');
DELETE FROM mermas WHERE sku LIKE 'P85-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P85-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P85-%' OR concepto LIKE '%R-85%';
DELETE FROM inventario_mov WHERE producto LIKE 'P85-%';
DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '85000000-%' OR ruta_id BETWEEN 8501 AND 8509 OR orden_id BETWEEN 8520 AND 8529;
DELETE FROM produccion WHERE sku LIKE 'P85-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 8520 AND 8529;
DELETE FROM ordenes WHERE id BETWEEN 8520 AND 8529;
DELETE FROM auditoria WHERE detalle LIKE '%R-85%';
DELETE FROM rutas WHERE id BETWEEN 8501 AND 8509;
DELETE FROM clientes WHERE id = 8510;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-85%';
UPDATE cuartos_frios SET stock = stock - 'P85-HIELO' - 'P85-TRIT' WHERE stock ? 'P85-HIELO' OR stock ? 'P85-TRIT';
DELETE FROM productos WHERE sku LIKE 'P85-%';
DELETE FROM usuarios WHERE id BETWEEN 8501 AND 8519;
DELETE FROM auth.users WHERE id::text LIKE '85000000-%';
COMMIT;
\echo '── 085: TODAS LAS PRUEBAS OK'
