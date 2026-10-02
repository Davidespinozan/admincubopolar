-- 074_rename_sku_test.sql — Contención F1: rename_sku solo Admin activo,
-- cascada completa (036 + D2), reemplazo por token exacto, auditoría con el
-- actor real y sin mutaciones parciales para actores no autorizados.

\set ON_ERROR_STOP on
\set QUIET on

-- ─── Fixtures ───────────────────────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'R74-%' OR sku LIKE '%R74-%');
DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku LIKE '%R74-%');
DELETE FROM mermas WHERE sku LIKE '%R74-%';
DELETE FROM inventario_mov WHERE producto LIKE '%R74-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7401 AND 7499;
DELETE FROM ordenes WHERE id BETWEEN 7401 AND 7499;
DELETE FROM produccion WHERE folio LIKE 'P74-%';
DELETE FROM precios_esp WHERE sku LIKE '%R74-%';
DELETE FROM umbrales WHERE sku LIKE '%R74-%';
DELETE FROM rutas WHERE id BETWEEN 7401 AND 7499;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-R74%';
DELETE FROM productos WHERE sku LIKE '%R74-%';
DELETE FROM clientes WHERE id = 7401;
DELETE FROM auditoria WHERE modulo = 'Productos' AND detalle LIKE '%R74-%';
DELETE FROM usuarios WHERE id BETWEEN 7401 AND 7409;
DELETE FROM auth.users WHERE id::text LIKE '74000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('74000000-0000-0000-0000-000000000001', 'admin74@t'),
  ('74000000-0000-0000-0000-000000000002', 'inactadm74@t'),
  ('74000000-0000-0000-0000-000000000003', 'ventas74@t'),
  ('74000000-0000-0000-0000-000000000004', 'chofer74@t'),
  ('74000000-0000-0000-0000-000000000005', 'prod74@t'),
  ('74000000-0000-0000-0000-000000000006', 'bolsas74@t'),
  ('74000000-0000-0000-0000-000000000007', 'fact74@t'),
  ('74000000-0000-0000-0000-000000000099', 'noprof74@evil');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7401, 'Admin 74',      'admin74@t',    'Admin',          'Activo',   '74000000-0000-0000-0000-000000000001'),
  (7402, 'InactAdmin 74', 'inactadm74@t', 'Admin',          'Inactivo', '74000000-0000-0000-0000-000000000002'),
  (7403, 'Ventas 74',     'ventas74@t',   'Ventas',         'Activo',   '74000000-0000-0000-0000-000000000003'),
  (7404, 'Chofer 74',     'chofer74@t',   'Chofer',         'Activo',   '74000000-0000-0000-0000-000000000004'),
  (7405, 'Prod 74',       'prod74@t',     'Producción',     'Activo',   '74000000-0000-0000-0000-000000000005'),
  (7406, 'Bolsas 74',     'bolsas74@t',   'Almacén Bolsas', 'Activo',   '74000000-0000-0000-0000-000000000006'),
  (7407, 'Fact 74',       'fact74@t',     'Facturación',    'Activo',   '74000000-0000-0000-0000-000000000007');
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (7401, 'Cliente 74', 'XAXX010101000', 0);
INSERT INTO productos (sku, nombre, precio, stock, costo_unitario, empaque_sku) VALUES
  ('R74-SKU',       'Objetivo',          30, 0, 10, NULL),
  ('R74-SKU2',      'Subcadena sufijo',  30, 0, 0,  NULL),
  ('2R74-SKU',      'Subcadena prefijo', 30, 0, 0,  NULL),
  ('R74-SKU-OTHER', 'Subcadena guion',   30, 0, 0,  NULL),
  ('R74-X',         'Usa empaque obj',   30, 0, 0,  'R74-SKU'),
  ('R74-Y',         'Usa empaque sufijo',30, 0, 0,  'R74-SKU2');
INSERT INTO umbrales (sku) VALUES ('R74-SKU'), ('R74-SKU2');
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (7401, 'R74-SKU', 25), (7401, 'R74-SKU2', 26);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-R74',  'Cuarto R74',  '{"R74-SKU": 10, "R74-SKU2": 3}'::jsonb),
  ('CF-R74B', 'Cuarto R74B', '{"R74-SKU": 1, "R74-NEW": 2}'::jsonb);     -- llave huérfana: se suma (semántica 036)
INSERT INTO rutas (id, folio, nombre, estatus, carga, carga_autorizada, extra_autorizado) VALUES
  (7401, 'R-7401', 'Ruta 74', 'Cerrada', '{"R74-SKU": 2, "R74-SKU2": 1}'::jsonb, '{"R74-SKU": 2, "R74-SKU2": 1}'::jsonb, '{"R74-SKU": 1}'::jsonb);
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario) VALUES
  ('Entrada', 'R74-SKU', 5, 'fixture', 'x'), ('Entrada', 'R74-SKU2', 5, 'fixture', 'x');
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus) VALUES ('P74-1', CURRENT_DATE, 'T1', 'M1', 'R74-SKU', 10, 'Confirmada');
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus, tipo, input_sku, input_kg, output_kg, merma_kg) VALUES
  ('P74-2', CURRENT_DATE, 'Transformación', 'Manual', 'R74-SKU2', 8, 'Confirmada', 'Transformacion', 'R74-SKU', 10, 8, 2);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES
  (7401, 'OV-7401', 7401, 'Cliente 74', '2×R74-SKU2, 1×R74-SKU',               60, 'Entregada', 'Efectivo', 'Contado'),
  (7402, 'OV-7402', 7401, 'Cliente 74', '3×R74-SKU',                           90, 'Entregada', 'Efectivo', 'Contado'),
  (7403, 'OV-7403', 7401, 'Cliente 74', '1×R74-SKU-OTHER, 4×2R74-SKU',         150,'Entregada', 'Efectivo', 'Contado'),
  (7404, 'OV-7404', 7401, 'Cliente 74', '1.5×R74-SKU',                         45, 'Entregada', 'Efectivo', 'Contado'),
  (7405, 'OV-7405', 7401, 'Cliente 74', '2 × R74-SKU, 1×R74-SKU, 1×R74-SKU2',  120,'Entregada', 'Efectivo', 'Contado');
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (7401, 'R74-SKU', 1, 30, 30), (7401, 'R74-SKU2', 2, 15, 30);
-- Merma legacy (como las 2 de producción) y merma del contrato 072 con efectos
INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url) VALUES (CURRENT_DATE, 'R74-SKU', 1, 'legacy', 'Legacy 74', ''), (CURRENT_DATE, 'R74-SKU2', 1, 'legacy', 'Legacy 74', '');
COMMIT;

CREATE OR REPLACE FUNCTION t74_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    (jsonb_build_object('role', p_role)
     || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
     || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t74_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
      RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t74_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (no hubo error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 70);
END $$;
-- Huella de TODAS las superficies que toca rename_sku (+ auditoría).
CREATE OR REPLACE FUNCTION t74_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(id || ':' || sku || ':' || coalesce(empaque_sku, ''), ',' ORDER BY id) FROM productos WHERE sku LIKE '%R74-%' OR empaque_sku LIKE '%R74-%'),
    (SELECT string_agg(sku, ',' ORDER BY id) FROM umbrales WHERE sku LIKE '%R74-%'),
    (SELECT string_agg(sku, ',' ORDER BY id) FROM precios_esp WHERE sku LIKE '%R74-%'),
    (SELECT string_agg(id || ':' || stock::text, ',' ORDER BY id) FROM cuartos_frios WHERE id LIKE 'CF-R74%'),
    (SELECT string_agg(coalesce(carga::text, '') || coalesce(carga_autorizada::text, '') || coalesce(extra_autorizado::text, ''), ',' ORDER BY id) FROM rutas WHERE id BETWEEN 7401 AND 7499),
    (SELECT string_agg(producto, ',' ORDER BY id) FROM inventario_mov WHERE producto LIKE '%R74-%'),
    (SELECT string_agg(sku, ',' ORDER BY id) FROM mermas WHERE sku LIKE '%R74-%'),
    (SELECT string_agg(sku || ':' || coalesce(input_sku, ''), ',' ORDER BY id) FROM produccion WHERE folio LIKE 'P74-%'),
    (SELECT string_agg(sku, ',' ORDER BY id) FROM orden_lineas WHERE orden_id BETWEEN 7401 AND 7499),
    (SELECT string_agg(productos, ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 7401 AND 7499),
    (SELECT count(*)::text FROM auditoria WHERE modulo = 'Productos' AND accion = 'Renombrar SKU')))
$$;
DROP TABLE IF EXISTS t74_ids;
CREATE TEMP TABLE t74_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t74_ids TO anon, authenticated, service_role;
INSERT INTO t74_ids VALUES ('pid', (SELECT id::text FROM productos WHERE sku = 'R74-SKU'));

\echo '── 074: contrato físico'
SELECT t74_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' FROM pg_proc WHERE oid = 'public.rename_sku(bigint,text,text)'::regprocedure), '074-01 SECURITY DEFINER con search_path = public, pg_temp');
SELECT t74_assert((SELECT NOT has_function_privilege('public', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND has_function_privilege('authenticated', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.rename_sku(bigint,text,text)'::regprocedure), '074-02 EXECUTE: sin PUBLIC/anon, authenticated sí');
SELECT t74_assert((SELECT pg_get_functiondef(oid) ~ 'fin_actor_permitido\(ARRAY\[''Admin''\]\)' AND pg_get_functiondef(oid) ~ 'erp_actor_etiqueta\(\)' AND pg_get_functiondef(oid) !~ 'REPLACE\(productos' FROM pg_proc WHERE oid = 'public.rename_sku(bigint,text,text)'::regprocedure), '074-03 guard Admin canónico + actor canónico + sin REPLACE no anclado');
SELECT t74_assert((SELECT pg_get_function_result(oid) = 'void' FROM pg_proc WHERE oid = 'public.rename_sku(bigint,text,text)'::regprocedure), '074-04 firma y retorno intactos (bigint, text, text) → void');

-- 102/103: la merma de cuarto indica el cuarto (registrar_merma_cuarto) cuando existe.
CREATE OR REPLACE FUNCTION t74_merma_cuarto(p_cuarto TEXT, p_sku TEXT, p_cant INTEGER, p_causa TEXT, p_origen TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $mc$
DECLARE r JSONB;
BEGIN
  IF to_regprocedure('public.registrar_merma_cuarto(uuid,text,text,integer,text,text)') IS NULL THEN
    EXECUTE 'SELECT registrar_merma($1, $2, $3, $4)' INTO r USING p_sku, p_cant, p_causa, p_origen;
  ELSE
    EXECUTE 'SELECT registrar_merma_cuarto(gen_random_uuid(), $1, $2, $3, $4)' INTO r USING p_cuarto, p_sku, p_cant, p_causa;
  END IF;
  RETURN r;
END $mc$;
GRANT EXECUTE ON FUNCTION t74_merma_cuarto(TEXT, TEXT, INTEGER, TEXT, TEXT) TO PUBLIC;
-- Merma del contrato 072 (con efectos y egreso) antes del rename, como Admin
BEGIN; SET LOCAL ROLE authenticated; SELECT t74_actor('authenticated', 'admin74@t', '74000000-0000-0000-0000-000000000001');
INSERT INTO t74_ids VALUES ('merma', (t74_merma_cuarto('CF-R74', 'R74-SKU', 4, 'Bolsa rota', 'QA 074') ->> 'id'));
COMMIT;
INSERT INTO t74_ids SELECT 'merma_efectos', string_agg(cuarto_id || ':' || cantidad || ':' || inv_mov_id, ',' ORDER BY id) FROM mermas_efectos WHERE merma_id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma');
INSERT INTO t74_ids SELECT 'merma_mov', mov_contable_id::text FROM mermas WHERE id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma');
INSERT INTO t74_ids VALUES ('huella0', t74_huella());

\echo '── 074: denegados (sin rastro)'
BEGIN; SET LOCAL ROLE anon; SELECT t74_actor('anon', NULL, NULL);
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74-NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-10 anon: sin EXECUTE', '42501');
ROLLBACK;
DO $$
DECLARE a RECORD; v_pid TEXT := (SELECT v FROM t74_ids WHERE k = 'pid');
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('074-11 Ventas',             'ventas74@t',    '74000000-0000-0000-0000-000000000003'),
      ('074-12 Chofer',             'chofer74@t',    '74000000-0000-0000-0000-000000000004'),
      ('074-13 Producción',         'prod74@t',      '74000000-0000-0000-0000-000000000005'),
      ('074-14 Almacén Bolsas',     'bolsas74@t',    '74000000-0000-0000-0000-000000000006'),
      ('074-15 Facturación',        'fact74@t',      '74000000-0000-0000-0000-000000000007'),
      ('074-16 Admin INACTIVO',     'inactadm74@t',  '74000000-0000-0000-0000-000000000002'),
      ('074-17 JWT sin perfil',     'noprof74@evil', '74000000-0000-0000-0000-000000000099')) x(tag, email, sub)
  LOOP
    PERFORM t74_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    PERFORM t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74-NEW')$q$, v_pid), a.tag || ': denegado', '42501');
    PERFORM t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74-SKU')$q$, v_pid), a.tag || ': denegado también con mismo SKU (autoriza primero)', '42501');
    RESET ROLE;
    PERFORM t74_assert(t74_huella() = (SELECT v FROM t74_ids WHERE k = 'huella0'), a.tag || ': sin cambios en ninguna superficie ni auditoría');
  END LOOP;
END $$;

\echo '── 074: validaciones (Admin activo, sin rastro)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t74_actor('authenticated', 'admin74@t', '74000000-0000-0000-0000-000000000001');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU2', 'R74-NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-20 SKU viejo que no corresponde a p_id', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74-SKU2')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-21 SKU destino ya existe', '23505');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', '')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-22 SKU destino vacío', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, '   ', 'R74-NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-23 SKU actual vacío', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', NULL)$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-24 SKU destino NULL', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74 NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-25 formato inválido (espacio)', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74,NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-26 formato inválido (coma)', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', 'R74×NEW')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-27 formato inválido (×)', '22023');
SELECT t74_err(format($q$SELECT rename_sku(%s, 'R74-SKU', '-R74')$q$, (SELECT v FROM t74_ids WHERE k = 'pid')), '074-28 formato inválido (inicia con guion)', '22023');
SELECT t74_err($q$SELECT rename_sku(-1, 'R74-SKU', 'R74-NEW')$q$, '074-29 producto inexistente', '22023');
SELECT rename_sku((SELECT v::bigint FROM t74_ids WHERE k = 'pid'), 'R74-SKU', 'R74-SKU');
SELECT t74_assert(true, '074-30 mismo SKU: retorna sin error');
COMMIT;
SELECT t74_assert(t74_huella() = (SELECT v FROM t74_ids WHERE k = 'huella0'), '074-31 validaciones y mismo SKU: sin cambios ni auditoría');

\echo '── 074: rename autorizado (Admin activo)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t74_actor('authenticated', 'admin74@t', '74000000-0000-0000-0000-000000000001');
SELECT rename_sku((SELECT v::bigint FROM t74_ids WHERE k = 'pid'), 'R74-SKU', 'R74-NEW');
COMMIT;
SELECT t74_assert((SELECT sku FROM productos WHERE id = (SELECT v::bigint FROM t74_ids WHERE k = 'pid')) = 'R74-NEW'
  AND (SELECT count(*) FROM productos WHERE sku IN ('R74-SKU2', '2R74-SKU', 'R74-SKU-OTHER')) = 3, '074-40 productos.sku renombrado; productos con subcadenas intactos');
SELECT t74_assert((SELECT empaque_sku FROM productos WHERE sku = 'R74-X') = 'R74-NEW' AND (SELECT empaque_sku FROM productos WHERE sku = 'R74-Y') = 'R74-SKU2', '074-41 D2 productos.empaque_sku: exacto (R74-SKU2 intacto)');
SELECT t74_assert((SELECT string_agg(sku, ',' ORDER BY sku) FROM umbrales WHERE sku LIKE '%R74-%') = 'R74-NEW,R74-SKU2', '074-42 D2 umbrales.sku: exacto');
SELECT t74_assert((SELECT string_agg(sku, ',' ORDER BY sku) FROM precios_esp WHERE sku LIKE '%R74-%') = 'R74-NEW,R74-SKU2', '074-43 precios_esp.sku: exacto');
SELECT t74_assert((SELECT stock FROM cuartos_frios WHERE id = 'CF-R74') = '{"R74-NEW": 6, "R74-SKU2": 3}'::jsonb, '074-44 cuartos_frios.stock: llave renombrada (10 − 4 de la merma = 6), R74-SKU2 intacta');
SELECT t74_assert((SELECT stock FROM cuartos_frios WHERE id = 'CF-R74B') = '{"R74-NEW": 3}'::jsonb, '074-45 cuartos_frios.stock: llave huérfana existente se suma (semántica 036)');
SELECT t74_assert((SELECT carga = '{"R74-NEW": 2, "R74-SKU2": 1}'::jsonb AND carga_autorizada = '{"R74-NEW": 2, "R74-SKU2": 1}'::jsonb AND extra_autorizado = '{"R74-NEW": 1}'::jsonb FROM rutas WHERE id = 7401), '074-46 rutas carga / carga_autorizada / extra_autorizado: llaves exactas');
SELECT t74_assert((SELECT count(*) FROM inventario_mov WHERE producto = 'R74-SKU') = 0 AND (SELECT count(*) FROM inventario_mov WHERE producto = 'R74-NEW') >= 2 AND (SELECT count(*) FROM inventario_mov WHERE producto = 'R74-SKU2') = 1, '074-47 inventario_mov.producto: exacto (incluye el kardex de la merma 072)');
SELECT t74_assert((SELECT count(*) FROM mermas WHERE sku = 'R74-SKU') = 0 AND (SELECT count(*) FROM mermas WHERE sku = 'R74-NEW') = 2 AND (SELECT count(*) FROM mermas WHERE sku = 'R74-SKU2') = 1, '074-48 mermas.sku: exacto (legacy + contrato 072)');
SELECT t74_assert((SELECT string_agg(sku || ':' || coalesce(input_sku, ''), ',' ORDER BY folio) FROM produccion WHERE folio LIKE 'P74-%') = 'R74-NEW:,R74-SKU2:R74-NEW', '074-49 produccion.sku e input_sku: exactos');
SELECT t74_assert((SELECT string_agg(sku, ',' ORDER BY sku) FROM orden_lineas WHERE orden_id = 7401) = 'R74-NEW,R74-SKU2', '074-50 orden_lineas.sku: exacto');
SELECT t74_assert((SELECT productos FROM ordenes WHERE id = 7401) = '2×R74-SKU2, 1×R74-NEW', '074-51 TOKEN EXACTO: "2×R74-SKU2, 1×R74-SKU" → "2×R74-SKU2, 1×R74-NEW" (nunca "2×R74-NEW2")');
SELECT t74_assert((SELECT productos FROM ordenes WHERE id = 7402) = '3×R74-NEW', '074-52 token único');
SELECT t74_assert((SELECT productos FROM ordenes WHERE id = 7403) = '1×R74-SKU-OTHER, 4×2R74-SKU', '074-53 SKU-OTHER y 2SKU intactos');
SELECT t74_assert((SELECT productos FROM ordenes WHERE id = 7404) = '1.5×R74-NEW', '074-54 cantidad decimal');
SELECT t74_assert((SELECT productos FROM ordenes WHERE id = 7405) = '2 × R74-NEW, 1×R74-NEW, 1×R74-SKU2', '074-55 espacios alrededor de × y tokens repetidos');
SELECT t74_assert((SELECT count(*) = 1 AND bool_and(usuario = 'Admin 74' AND detalle = 'R74-SKU → R74-NEW') FROM auditoria WHERE modulo = 'Productos' AND accion = 'Renombrar SKU' AND detalle LIKE '%R74-%'), '074-56 auditoría con el actor real (Admin 74), no "sistema"');

\echo '── 074: regresión 072 (mermas)'
SELECT t74_assert((SELECT string_agg(cuarto_id || ':' || cantidad || ':' || inv_mov_id, ',' ORDER BY id) FROM mermas_efectos WHERE merma_id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma')) = (SELECT v FROM t74_ids WHERE k = 'merma_efectos'), '074-60 efectos de la merma sin cambios');
SELECT t74_assert((SELECT mov_contable_id::text = (SELECT v FROM t74_ids WHERE k = 'merma_mov') AND estatus = 'Activa' AND cantidad = 4 FROM mermas WHERE id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma')), '074-61 merma: egreso ligado, estatus y cantidad sin cambios');
SELECT t74_err(format('UPDATE mermas SET cantidad = 99 WHERE id = %s', (SELECT v FROM t74_ids WHERE k = 'merma')), '074-62 guard 072 sigue bloqueando cambios que no sean de SKU', '42501');
BEGIN; SET LOCAL ROLE authenticated; SELECT t74_actor('authenticated', 'admin74@t', '74000000-0000-0000-0000-000000000001');
SELECT revertir_merma((SELECT v::bigint FROM t74_ids WHERE k = 'merma'), 'post-rename');
COMMIT;
SELECT t74_assert((SELECT stock FROM cuartos_frios WHERE id = 'CF-R74') = '{"R74-NEW": 10, "R74-SKU2": 3}'::jsonb
  AND (SELECT estatus FROM mermas WHERE id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma')) = 'Revertida', '074-63 reverso tras rename: devuelve 4 a la llave nueva del cuarto original');
SELECT t74_assert(NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE id = (SELECT v::bigint FROM t74_ids WHERE k = 'merma_mov')), '074-64 reverso tras rename: egreso exacto eliminado');
BEGIN; SET LOCAL ROLE authenticated; SELECT t74_actor('authenticated', 'admin74@t', '74000000-0000-0000-0000-000000000001');
SELECT t74_err(format('SELECT revertir_merma(%s)', (SELECT id FROM mermas WHERE sku = 'R74-NEW' AND origen = 'Legacy 74')), '074-65 merma legacy tras rename: reverso sigue fallando cerrado', '55000');
ROLLBACK;

\echo '── 074: service_role (mantenimiento) sigue permitido'
BEGIN; SET LOCAL ROLE service_role; SELECT t74_actor('service_role', NULL, NULL);
SELECT rename_sku((SELECT v::bigint FROM t74_ids WHERE k = 'pid'), 'R74-NEW', 'R74-SVC');
RESET ROLE;
SELECT t74_assert((SELECT usuario FROM auditoria WHERE modulo = 'Productos' AND detalle = 'R74-NEW → R74-SVC') = 'service_role', '074-70 service_role permitido y atribuido como service_role');
ROLLBACK;

-- ─── Limpieza ───────────────────────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE '%R74-%');
DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku LIKE '%R74-%');
DELETE FROM mermas WHERE sku LIKE '%R74-%';
DELETE FROM inventario_mov WHERE producto LIKE '%R74-%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7401 AND 7499;
DELETE FROM ordenes WHERE id BETWEEN 7401 AND 7499;
DELETE FROM produccion WHERE folio LIKE 'P74-%';
DELETE FROM precios_esp WHERE sku LIKE '%R74-%';
DELETE FROM umbrales WHERE sku LIKE '%R74-%';
DELETE FROM rutas WHERE id BETWEEN 7401 AND 7499;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-R74%';
DELETE FROM productos WHERE sku LIKE '%R74-%';
DELETE FROM clientes WHERE id = 7401;
DELETE FROM auditoria WHERE modulo IN ('Productos', 'Mermas') AND (detalle LIKE '%R74-%' OR usuario = 'Admin 74');
DELETE FROM usuarios WHERE id BETWEEN 7401 AND 7409;
DELETE FROM auth.users WHERE id::text LIKE '74000000-%';
COMMIT;
\echo '── 074: TODAS LAS PRUEBAS OK'
