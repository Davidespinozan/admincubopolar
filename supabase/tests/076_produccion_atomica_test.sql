-- 076_produccion_atomica_test.sql — registrar_produccion / registrar_transformacion:
-- todo o nada, actor canónico, idempotencia por operacion_id, costo en el
-- servidor; rename_sku + produccion.empaque_sku (D12). Fase aditiva.
-- (La concurrencia real con dos conexiones está en run_local_db.mjs.)

\set ON_ERROR_STOP on
\set QUIET on

-- ─── Fixtures ───────────────────────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P76-%');
DELETE FROM mermas WHERE sku LIKE 'P76-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P76-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P76-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P76-%';
DELETE FROM produccion WHERE sku LIKE 'P76-%';
DELETE FROM cuartos_frios WHERE id LIKE 'CF-76%';
DELETE FROM productos WHERE sku LIKE 'P76-%';
DELETE FROM auditoria WHERE detalle LIKE '%P76-%';
DELETE FROM usuarios WHERE id BETWEEN 7601 AND 7609;
DELETE FROM auth.users WHERE id::text LIKE '76000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('76000000-0000-0000-0000-000000000001', 'admin76@t'), ('76000000-0000-0000-0000-000000000002', 'prod76@t'),
  ('76000000-0000-0000-0000-000000000003', 'ventas76@t'), ('76000000-0000-0000-0000-000000000004', 'chofer76@t'),
  ('76000000-0000-0000-0000-000000000005', 'bolsas76@t'), ('76000000-0000-0000-0000-000000000006', 'fact76@t'),
  ('76000000-0000-0000-0000-000000000007', 'inadm76@t'), ('76000000-0000-0000-0000-000000000008', 'inprod76@t'),
  ('76000000-0000-0000-0000-000000000099', 'noprof76@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7601, 'Admin 76',   'admin76@t',  'Admin',          'Activo',   '76000000-0000-0000-0000-000000000001'),
  (7602, 'Prod 76',    'prod76@t',   'Producción',     'Activo',   '76000000-0000-0000-0000-000000000002'),
  (7603, 'Ventas 76',  'ventas76@t', 'Ventas',         'Activo',   '76000000-0000-0000-0000-000000000003'),
  (7604, 'Chofer 76',  'chofer76@t', 'Chofer',         'Activo',   '76000000-0000-0000-0000-000000000004'),
  (7605, 'Bolsas 76',  'bolsas76@t', 'Almacén Bolsas', 'Activo',   '76000000-0000-0000-0000-000000000005'),
  (7606, 'Fact 76',    'fact76@t',   'Facturación',    'Activo',   '76000000-0000-0000-0000-000000000006'),
  (7607, 'InAdmin 76', 'inadm76@t',  'Admin',          'Inactivo', '76000000-0000-0000-0000-000000000007'),
  (7608, 'InProd 76',  'inprod76@t', 'Producción',     'Inactivo', '76000000-0000-0000-0000-000000000008');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P76-HIELO',   'Hielo 76',          'Producto Terminado', 30, 0,  0,   'P76-BOLSA'),
  ('P76-BOLSA',   'Bolsa 76',          'Empaque',            0,  20, 2.5, NULL),
  ('P76-SINEMP',  'Sin empaque 76',    'Producto Terminado', 30, 0,  0,   NULL),
  ('P76-EMPCERO', 'Empaque costo 0',   'Producto Terminado', 30, 0,  0,   'P76-BOLSA0'),
  ('P76-BOLSA0',  'Bolsa costo 0',     'Empaque',            0,  50, 0,   NULL),
  ('P76-ROTO',    'Empaque inexist.',  'Producto Terminado', 30, 0,  0,   'P76-NOEXISTE'),
  ('P76-BARRA',   'Barra 76',          'Materia Prima',      0,  30, 4,   NULL),
  ('P76-TRIT',    'Triturado 76',      'Producto Terminado', 40, 0,  0,   NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-76', 'Cuarto 76', '{}'::jsonb);
COMMIT;

CREATE OR REPLACE FUNCTION t76_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t76_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t76_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 70);
END $$;
-- Huella de todos los efectos de negocio posibles de ambas RPCs.
CREATE OR REPLACE FUNCTION t76_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(id || ':' || coalesce(operacion_id::text, '') || ':' || sku || ':' || cantidad || ':' || coalesce(costo_total::text, ''), ',' ORDER BY id) FROM produccion WHERE sku LIKE 'P76-%'),
    (SELECT string_agg(sku || ':' || stock || ':' || coalesce(empaque_sku, ''), ',' ORDER BY sku) FROM productos WHERE sku LIKE 'P76-%'),
    (SELECT string_agg(id || stock::text, ',' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-76%'),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P76-%'),
    (SELECT count(*)::text FROM movimientos_contables WHERE concepto LIKE '%P76-%'),
    (SELECT count(*)::text FROM costos_historial WHERE concepto LIKE '%P76-%'),
    (SELECT count(*)::text FROM mermas WHERE sku LIKE 'P76-%')))
$$;
DROP TABLE IF EXISTS t76_ids;
CREATE TEMP TABLE t76_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t76_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t76_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t76_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t76_stock(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t76_cf(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = 'CF-76' $$;
INSERT INTO t76_ids VALUES ('h0', t76_huella());

\echo '── 076: contrato físico (fase aditiva)'
SELECT t76_assert((SELECT count(*) = 5 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produccion' AND column_name IN ('operacion_id', 'cuarto_id', 'empaque_sku', 'empaque_cantidad', 'mov_contable_id')), '076-01 produccion: 5 columnas de referencia (D8)');
SELECT t76_assert(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produccion_operacion_id_key' AND contype = 'u'), '076-02 UNIQUE(operacion_id)');
SELECT t76_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('registrar_produccion', 'registrar_transformacion', 'registrar_produccion__replay', 'registrar_transformacion__replay')), '076-03 SECURITY DEFINER con search_path = public, pg_temp');
SELECT t76_assert((SELECT bool_and(NOT has_function_privilege('public', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('registrar_produccion', 'registrar_transformacion')), '076-04 RPCs: sin PUBLIC/anon, authenticated sí');
SELECT t76_assert((SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('registrar_produccion__replay', 'registrar_transformacion__replay')), '076-05 helpers de replay no expuestos');
SELECT t76_assert((SELECT bool_and(pg_get_functiondef(p.oid) ~ 'fin_actor_permitido\(ARRAY\[''Admin'', ''Producción''\]\)' AND pg_get_functiondef(p.oid) !~ 'fin_marcar_ctx' AND pg_get_functiondef(p.oid) !~ 'get_my_(rol|user_id)') FROM pg_proc p WHERE p.proname IN ('registrar_produccion', 'registrar_transformacion')), '076-06 actor canónico; sin fin_marcar_ctx ni helpers legacy');
SELECT t76_assert((SELECT pg_get_functiondef(oid) ~ 'UPDATE produccion SET empaque_sku = v_new WHERE empaque_sku = v_old' AND pg_get_functiondef(oid) ~ 'fin_actor_permitido\(ARRAY\[''Admin''\]\)' FROM pg_proc WHERE oid = 'public.rename_sku(bigint,text,text)'::regprocedure), '076-07 rename_sku: + produccion.empaque_sku, sigue solo Admin');
SELECT t76_assert((SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'public' AND ((tablename = 'produccion' AND policyname IN ('produccion_update', 'produccion_write')) OR (tablename = 'productos' AND policyname = 'produccion_update') OR (tablename = 'inventario_mov' AND policyname = 'insert_roles'))), '076-08 fase aditiva: policies actuales sin cambios (el frontend actual sigue funcionando)');

\echo '── 076: denegados (sin efectos)'
BEGIN; SET LOCAL ROLE anon; SELECT t76_actor('anon', NULL, NULL);
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-HIELO', 1, 'CF-76')$q$, '076-10 anon: sin EXECUTE (producción)', '42501');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 2, 'P76-TRIT', 1, 'CF-76')$q$, '076-11 anon: sin EXECUTE (transformación)', '42501');
ROLLBACK;
DO $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('076-12 Ventas', 'ventas76@t', '76000000-0000-0000-0000-000000000003'),
      ('076-13 Chofer', 'chofer76@t', '76000000-0000-0000-0000-000000000004'),
      ('076-14 Almacén Bolsas', 'bolsas76@t', '76000000-0000-0000-0000-000000000005'),
      ('076-15 Facturación', 'fact76@t', '76000000-0000-0000-0000-000000000006'),
      ('076-16 Admin INACTIVO', 'inadm76@t', '76000000-0000-0000-0000-000000000007'),
      ('076-17 Producción INACTIVO', 'inprod76@t', '76000000-0000-0000-0000-000000000008'),
      ('076-18 JWT sin perfil', 'noprof76@t', '76000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t76_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-HIELO', 1, 'CF-76')$q$, a.tag || ': producción denegada', '42501');
    PERFORM t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 2, 'P76-TRIT', 1, 'CF-76')$q$, a.tag || ': transformación denegada', '42501');
    RESET ROLE;
    PERFORM t76_assert(t76_huella() = (SELECT v FROM t76_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;

\echo '── 076: producción exitosa (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
INSERT INTO t76_ids VALUES ('p1', registrar_produccion('76000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 30', 'P76-HIELO', 8, 'CF-76')::text);
SELECT t76_assert(NOT fin_ctx_activo(), '076-20 la RPC no deja activo el contexto interno en la transacción');
COMMIT;
INSERT INTO t76_ids SELECT 'p1_id', (t76_j('p1') ->> 'id');
SELECT t76_assert((SELECT folio ~ '^OP-[0-9]{3,}$' AND operacion_id = '76000000-0000-0000-0000-00000000a001' AND tipo = 'Produccion' AND estatus = 'Confirmada'
  AND turno = 'Turno 1' AND maquina = 'Máquina 30' AND cantidad = 8 AND cuarto_id = 'CF-76' AND empaque_sku = 'P76-BOLSA' AND empaque_cantidad = 8
  AND costo_empaque = 2.5 AND costo_total = 20 AND mov_contable_id IS NOT NULL FROM produccion WHERE id = (SELECT v::bigint FROM t76_ids WHERE k = 'p1_id')), '076-21 fila de producción completa (folio del servidor, referencias D8, costo)');
SELECT t76_assert(t76_stock('P76-BOLSA') = 12, '076-22 empaque descontado exacto (20 → 12)');
SELECT t76_assert(t76_cf('P76-HIELO') = 8, '076-23 producto terminado en el cuarto (0 → 8)');
SELECT t76_assert((SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P76-BOLSA' AND tipo = 'Salida' AND cantidad = 8 AND usuario = 'Prod 76' AND origen = 'Producción ' || (t76_j('p1') ->> 'folio')), '076-24 kardex del empaque por el contrato seguro, actor real');
SELECT t76_assert((SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P76-HIELO' AND tipo = 'Entrada' AND cantidad = 8 AND usuario = 'Prod 76'), '076-25 kardex de la entrada al cuarto, actor real');
SELECT t76_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Egreso' AND categoria = 'Costo de Ventas' AND monto = 20 AND usuario_id = 7602 AND referencia = 'PROD-' || (SELECT v FROM t76_ids WHERE k = 'p1_id')
  AND concepto = 'Producción ' || (t76_j('p1') ->> 'folio') || ': 8× P76-HIELO (empaque: P76-BOLSA)') FROM movimientos_contables WHERE concepto LIKE '%P76-HIELO%'), '076-26 egreso Costo de Ventas exacto, referencia PROD-<id>');
SELECT t76_assert((SELECT count(*) = 1 AND bool_and(tipo = 'Producción' AND categoria = 'Costo de Ventas' AND monto = 20 AND movimiento_id = (SELECT mov_contable_id FROM produccion WHERE id = (SELECT v::bigint FROM t76_ids WHERE k = 'p1_id'))
  AND referencia = 'PROD-' || (SELECT v FROM t76_ids WHERE k = 'p1_id') AND periodo = to_char(fin_hoy(), 'YYYY-MM')) FROM costos_historial WHERE concepto LIKE '%P76-HIELO%'), '076-27 costos_historial ligado al egreso');
SELECT t76_assert((t76_j('p1') ->> 'actor') = 'Prod 76' AND NOT (t76_j('p1') ->> 'replay')::boolean, '076-28 resultado: actor real, no replay');
INSERT INTO t76_ids VALUES ('h1', t76_huella());

\echo '── 076: idempotencia secuencial'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
INSERT INTO t76_ids VALUES ('p1r', registrar_produccion('76000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 30', 'P76-HIELO', 8, 'CF-76')::text);
SELECT t76_err($q$SELECT registrar_produccion('76000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 30', 'P76-HIELO', 9, 'CF-76')$q$, '076-31 mismo operacion_id con otra cantidad: rechazado', '23505');
SELECT t76_err($q$SELECT registrar_produccion('76000000-0000-0000-0000-00000000a001', 'Turno 2', 'Máquina 30', 'P76-HIELO', 8, 'CF-76')$q$, '076-32 mismo operacion_id con otro turno: rechazado', '23505');
COMMIT;
SELECT t76_assert((t76_j('p1r') ->> 'replay')::boolean AND (t76_j('p1r') ->> 'id') = (t76_j('p1') ->> 'id') AND (t76_j('p1r') ->> 'folio') = (t76_j('p1') ->> 'folio'), '076-30 reintento: replay con el mismo id y folio');
SELECT t76_assert(t76_huella() = (SELECT v FROM t76_ids WHERE k = 'h1'), '076-33 replay y rechazos: cero efectos nuevos');

\echo '── 076: variantes de empaque y validaciones (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
SELECT registrar_produccion('76000000-0000-0000-0000-00000000a002', 'T1', 'M1', 'P76-SINEMP', 5, 'CF-76');
SELECT registrar_produccion('76000000-0000-0000-0000-00000000a003', 'T1', 'M1', 'P76-EMPCERO', 5, 'CF-76');
COMMIT;
SELECT t76_assert((SELECT empaque_sku IS NULL AND empaque_cantidad IS NULL AND costo_total = 0 AND mov_contable_id IS NULL FROM produccion WHERE operacion_id = '76000000-0000-0000-0000-00000000a002') AND t76_cf('P76-SINEMP') = 5
  AND NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%P76-SINEMP%'), '076-40 sin empaque: entra al cuarto, sin consumo ni contabilidad');
SELECT t76_assert(t76_stock('P76-BOLSA0') = 45 AND (SELECT costo_total = 0 AND mov_contable_id IS NULL FROM produccion WHERE operacion_id = '76000000-0000-0000-0000-00000000a003')
  AND NOT EXISTS (SELECT 1 FROM costos_historial WHERE concepto LIKE '%P76-EMPCERO%'), '076-41 empaque con costo 0: consume empaque, sin contabilidad (igual que hoy)');
INSERT INTO t76_ids VALUES ('h2', t76_huella()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-HIELO', 13, 'CF-76')$q$, '076-42 empaque insuficiente (12 < 13): rechazo completo (D1)', 'P0001');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-ROTO', 1, 'CF-76')$q$, '076-43 empaque inexistente en el catálogo', '22023');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-HIELO', 0, 'CF-76')$q$, '076-44 cantidad 0', '22023');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'NO-EXISTE', 1, 'CF-76')$q$, '076-45 SKU inexistente', '22023');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-BOLSA', 1, 'CF-76')$q$, '076-46 SKU que no es Producto Terminado', '22023');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), 'T', 'M', 'P76-HIELO', 1, 'CF-NOEXISTE')$q$, '076-47 cuarto inexistente', '22023');
SELECT t76_err($q$SELECT registrar_produccion(gen_random_uuid(), '  ', 'M', 'P76-HIELO', 1, 'CF-76')$q$, '076-48 turno vacío', '22023');
SELECT t76_err($q$SELECT registrar_produccion(NULL, 'T', 'M', 'P76-HIELO', 1, 'CF-76')$q$, '076-49 operacion_id nulo', '22023');
COMMIT;
SELECT t76_assert(t76_huella() = (SELECT v FROM t76_ids WHERE k = 'h2'), '076-50 fallos: CERO efectos (sin fila, stock, kardex, costo ni egreso)');

\echo '── 076: Admin'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'admin76@t', '76000000-0000-0000-0000-000000000001');
INSERT INTO t76_ids VALUES ('pa', registrar_produccion(gen_random_uuid(), 'T1', 'M1', 'P76-HIELO', 2, 'CF-76')::text);
COMMIT;
SELECT t76_assert((t76_j('pa') ->> 'actor') = 'Admin 76' AND t76_stock('P76-BOLSA') = 10 AND t76_cf('P76-HIELO') = 10, '076-51 Admin registra producción (actor Admin 76)');

\echo '── 076: transformación (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
INSERT INTO t76_ids VALUES ('t1', registrar_transformacion('76000000-0000-0000-0000-00000000b001', 'P76-BARRA', 10, 'P76-TRIT', 8, 'CF-76', 'lote 1')::text);
SELECT t76_assert(NOT fin_ctx_activo(), '076-60 la RPC no deja activo el contexto interno');
COMMIT;
SELECT t76_assert((SELECT folio ~ '^TR-[0-9]{3,}$' AND tipo = 'Transformacion' AND input_sku = 'P76-BARRA' AND input_kg = 10 AND output_kg = 8 AND merma_kg = 2 AND rendimiento = 80
  AND sku = 'P76-TRIT' AND cantidad = 8 AND cuarto_id = 'CF-76' AND destino = 'lote 1' AND turno = 'Transformación' AND maquina = 'Manual' AND costo_total = 0 AND mov_contable_id IS NULL
  FROM produccion WHERE operacion_id = '76000000-0000-0000-0000-00000000b001'), '076-61 fila de transformación completa');
SELECT t76_assert(t76_stock('P76-BARRA') = 20 AND t76_cf('P76-TRIT') = 8, '076-62 insumo 30 → 20; output al cuarto 0 → 8');
SELECT t76_assert((SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P76-BARRA' AND tipo = 'Salida' AND cantidad = 10 AND usuario = 'Prod 76')
  AND (SELECT count(*) = 1 FROM inventario_mov WHERE producto = 'P76-TRIT' AND tipo = 'Entrada' AND cantidad = 8 AND usuario = 'Prod 76'), '076-63 kardex de insumo y output, actor real');
SELECT t76_assert((SELECT count(*) = 1 AND bool_and(cantidad = 2 AND NOT afecta_stock AND origen = 'Transformación ' || (t76_j('t1') ->> 'folio') AND usuario_id = 7602) FROM mermas WHERE sku = 'P76-BARRA'), '076-64 merma de proceso registrada (072, sin efecto de stock)');
SELECT t76_assert(NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE concepto LIKE '%P76-TRIT%' OR concepto LIKE '%P76-BARRA%') AND NOT EXISTS (SELECT 1 FROM costos_historial WHERE concepto LIKE '%P76-BARRA%'), '076-65 transformación sin contabilidad (D9)');
INSERT INTO t76_ids VALUES ('h3', t76_huella());
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
INSERT INTO t76_ids VALUES ('t1r', registrar_transformacion('76000000-0000-0000-0000-00000000b001', 'P76-BARRA', 10, 'P76-TRIT', 8, 'CF-76', 'lote 1')::text);
SELECT t76_err($q$SELECT registrar_transformacion('76000000-0000-0000-0000-00000000b001', 'P76-BARRA', 10, 'P76-TRIT', 7, 'CF-76')$q$, '076-67 mismo operacion_id con otro output: rechazado', '23505');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 25, 'P76-TRIT', 20, 'CF-76')$q$, '076-68 insumo insuficiente (20 < 25): rechazo completo', 'P0001');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 5, 'P76-TRIT', 6, 'CF-76')$q$, '076-69 salida mayor a la entrada', '22023');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-TRIT', 5, 'P76-TRIT', 5, 'CF-76')$q$, '076-70 insumo = destino', '22023');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-HIELO', 5, 'P76-TRIT', 5, 'CF-76')$q$, '076-71 insumo que no es Materia Prima/Insumo', '22023');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 5, 'P76-BOLSA', 5, 'CF-76')$q$, '076-72 destino que no es Producto Terminado', '22023');
SELECT t76_err($q$SELECT registrar_transformacion(gen_random_uuid(), 'P76-BARRA', 0, 'P76-TRIT', 0, 'CF-76')$q$, '076-73 cantidades 0', '22023');
COMMIT;
SELECT t76_assert((t76_j('t1r') ->> 'replay')::boolean AND (t76_j('t1r') ->> 'id') = (t76_j('t1') ->> 'id'), '076-66 reintento de transformación: replay');
SELECT t76_assert(t76_huella() = (SELECT v FROM t76_ids WHERE k = 'h3'), '076-74 replay y fallos de transformación: CERO efectos (ni fila ni merma)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
SELECT registrar_transformacion('76000000-0000-0000-0000-00000000b002', 'P76-BARRA', 5, 'P76-TRIT', 5, 'CF-76');
COMMIT;
SELECT t76_assert((SELECT count(*) = 1 FROM mermas WHERE sku = 'P76-BARRA') AND t76_stock('P76-BARRA') = 15 AND t76_cf('P76-TRIT') = 13, '076-75 entrada = salida: sin merma');

\echo '── 076: rename_sku + produccion.empaque_sku (D12)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'admin76@t', '76000000-0000-0000-0000-000000000001');
SELECT rename_sku((SELECT id FROM productos WHERE sku = 'P76-BOLSA'), 'P76-BOLSA', 'P76-BOLSA2');
COMMIT;
SELECT t76_assert((SELECT count(*) = 2 FROM produccion WHERE empaque_sku = 'P76-BOLSA2') AND NOT EXISTS (SELECT 1 FROM produccion WHERE empaque_sku = 'P76-BOLSA')
  AND (SELECT empaque_sku FROM productos WHERE sku = 'P76-HIELO') = 'P76-BOLSA2' AND (SELECT empaque_sku FROM produccion WHERE operacion_id = '76000000-0000-0000-0000-00000000a003') = 'P76-BOLSA0', '076-80 rename_sku actualiza produccion.empaque_sku (exacto; P76-BOLSA0 intacto)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t76_actor('authenticated', 'prod76@t', '76000000-0000-0000-0000-000000000002');
SELECT registrar_produccion(gen_random_uuid(), 'T1', 'M1', 'P76-HIELO', 1, 'CF-76');
COMMIT;
SELECT t76_assert(t76_stock('P76-BOLSA2') = 9, '076-81 tras el rename, la producción consume el empaque renombrado');

-- ─── Limpieza ───────────────────────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'P76-%');
DELETE FROM mermas WHERE sku LIKE 'P76-%';
DELETE FROM costos_historial WHERE concepto LIKE '%P76-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%P76-%';
DELETE FROM inventario_mov WHERE producto LIKE 'P76-%';
DELETE FROM produccion WHERE sku LIKE 'P76-%';
DELETE FROM cuartos_frios WHERE id LIKE 'CF-76%';
DELETE FROM productos WHERE sku LIKE 'P76-%';
DELETE FROM auditoria WHERE detalle LIKE '%P76-%';
DELETE FROM usuarios WHERE id BETWEEN 7601 AND 7609;
DELETE FROM auth.users WHERE id::text LIKE '76000000-%';
COMMIT;
\echo '── 076: TODAS LAS PRUEBAS OK'
