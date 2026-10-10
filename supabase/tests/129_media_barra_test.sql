-- 129_media_barra_test.sql — MEDIA BARRA: producto HIB-25K, partir_barra / revertir_partir_barra,
-- registrar_preparacion_media (y su reverso por revertir_preparacion_barra de 115) y el rechazo de
-- producir la media barra por máquina. Solo Admin / Producción; Ventas y anon, no.

\set ON_ERROR_STOP on
\set QUIET on

DROP TABLE IF EXISTS t129_ids;
CREATE TABLE t129_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t129_ids TO PUBLIC;

CREATE OR REPLACE FUNCTION t129_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_historial WHERE referencia IN (SELECT 'PROD-' || id FROM produccion WHERE cuarto_id = 'CF-T129')
                                  OR referencia IN (SELECT 'PROD-' || id || '/reverso' FROM produccion WHERE cuarto_id = 'CF-T129');
  DELETE FROM costos_empaque_historial WHERE sku = 'T129-EMP';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '12900000-%';
  DELETE FROM produccion WHERE cuarto_id = 'CF-T129';
  DELETE FROM inventario_mov WHERE cuarto_id = 'CF-T129' OR producto = 'T129-EMP';
  DELETE FROM auditoria WHERE detalle LIKE '%CF-T129%' OR usuario LIKE '%129%';
  DELETE FROM cuartos_frios WHERE id = 'CF-T129';
  DELETE FROM usuarios WHERE id BETWEEN 12951 AND 12959;
  DELETE FROM auth.users WHERE id::text LIKE '12950000-%';
  DELETE FROM productos WHERE sku IN ('T129-EMP', 'HIB-50K', 'HIP-25K', 'HIT-25K');
END $$;

BEGIN; SELECT t129_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('12950000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t129' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (12951, 'Admin 129', 'u1@t129', 'Admin', 'Activo', '12950000-0000-0000-0000-000000000001'),
  (12952, 'Prod 129', 'u2@t129', 'Producción', 'Activo', '12950000-0000-0000-0000-000000000002'),
  (12953, 'Ventas 129', 'u3@t129', 'Ventas', 'Activo', '12950000-0000-0000-0000-000000000003');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('T129-EMP', 'Bolsa 129', 'Empaque', 0, 20, 1.5, NULL),
  ('HIB-50K', 'Barra de hielo ~50 kg', 'Producto Terminado', 120, 0, 0, NULL),
  ('HIP-25K', 'Picada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T129-EMP'),
  ('HIT-25K', 'Triturada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T129-EMP');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-T129', 'Cuarto 129', '{"HIB-50K": 5}');
COMMIT;

CREATE OR REPLACE FUNCTION t129_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t129_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t129_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12950000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
-- Estado: barras | medias | picada | triturada | empaque — en el cuarto de la suite.
CREATE OR REPLACE FUNCTION t129_e() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE((stock ->> 'HIB-50K')::int, 0) || '|' || COALESCE((stock ->> 'HIB-25K')::int, 0) || '|' || COALESCE((stock ->> 'HIP-25K')::int, 0)
      || '|' || COALESCE((stock ->> 'HIT-25K')::int, 0) || '|' || (SELECT stock FROM productos WHERE sku = 'T129-EMP')
    FROM cuartos_frios WHERE id = 'CF-T129' $$;
CREATE OR REPLACE FUNCTION t129_op(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT ('12900000-0000-0000-0000-0000000000' || p_k)::uuid $$;
CREATE OR REPLACE FUNCTION t129_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t129_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t129_assert(BOOLEAN, TEXT), t129_err(TEXT, TEXT, TEXT, TEXT), t129_auth(INTEGER), t129_e(), t129_op(TEXT), t129_j(TEXT) TO PUBLIC;

\echo '── 129: producto y superficie'
SELECT t129_assert((SELECT tipo = 'Producto Terminado' AND precio = 60 AND empaque_sku IS NULL FROM productos WHERE sku = 'HIB-25K'),
  '129-00a el producto HIB-25K existe: Producto Terminado, $60, sin empaque');
SELECT t129_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                       AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                    FROM pg_proc p WHERE p.oid IN ('public.partir_barra(uuid,text,integer)'::regprocedure,
                                                   'public.revertir_partir_barra(uuid,bigint,text)'::regprocedure,
                                                   'public.registrar_preparacion_media(uuid,text,text,integer)'::regprocedure)),
  '129-00b contratos SECURITY DEFINER, search_path fijo, sin anon/PUBLIC');

\echo '── 129-01: partir una barra'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('p1', partir_barra(t129_op('01'), 'CF-T129', 2)::text);
COMMIT;
SELECT t129_assert(t129_e() = '3|4|0|0|20', '129-01a partir 2 barras: barras 5→3, medias 0→4, sin empaque');
SELECT t129_assert((t129_j('p1') ->> 'medias') = '4' AND (t129_j('p1') ->> 'replay') = 'false'
  AND (SELECT tipo = 'Partido' AND sku = 'HIB-25K' AND cantidad = 4 AND input_sku = 'HIB-50K' AND input_kg = 2 AND empaque_sku IS NULL AND COALESCE(costo_total, 0) = 0
         FROM produccion WHERE id = (t129_j('p1') ->> 'id')::bigint), '129-01b fila Partido con su trazabilidad y sin costo');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('p1r', partir_barra(t129_op('01'), 'CF-T129', 2)::text);
COMMIT;
SELECT t129_assert((t129_j('p1r') ->> 'replay') = 'true' AND (t129_j('p1r') ->> 'id') = (t129_j('p1') ->> 'id') AND t129_e() = '3|4|0|0|20',
  '129-01c reintento con el mismo operacion_id: replay, cero efectos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
SELECT t129_err($q$SELECT partir_barra(t129_op('01'), 'CF-T129', 1)$q$, '129-01d mismo operacion_id con otros datos', '23505');
SELECT t129_err($q$SELECT partir_barra(t129_op('02'), 'CF-T129', 0)$q$, '129-01e 0 barras rechazado', '22023');
SELECT t129_err($q$SELECT partir_barra(t129_op('02'), 'CF-NOEXISTE', 1)$q$, '129-01f cuarto inexistente', '22023');
SELECT t129_err($q$SELECT partir_barra(t129_op('02'), 'CF-T129', 9)$q$, '129-01g más barras de las que hay: falla y no deja efectos', 'P0001|22023');
ROLLBACK;
SELECT t129_assert(t129_e() = '3|4|0|0|20', '129-01h los rechazos no dejaron efectos');

\echo '── 129-02: quién puede'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(3);
SELECT t129_err($q$SELECT partir_barra(t129_op('03'), 'CF-T129', 1)$q$, '129-02a Ventas no parte barras', '42501');
SELECT t129_err($q$SELECT registrar_preparacion_media(t129_op('03'), 'HIT-25K', 'CF-T129', 1)$q$, '129-02b Ventas no prepara', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t129_err($q$SELECT partir_barra(t129_op('03'), 'CF-T129', 1)$q$, '129-02c anon sin acceso', '42501');
ROLLBACK;

\echo '── 129-03: preparar media barra'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('m1', registrar_preparacion_media(t129_op('11'), 'HIT-25K', 'CF-T129', 1)::text);
COMMIT;
SELECT t129_assert(t129_e() = '3|3|0|1|19', '129-03a 1 media → 1 triturada: media 4→3, triturada +1, empaque −1');
SELECT t129_assert((SELECT tipo = 'Preparacion' AND input_sku = 'HIB-25K' AND sku = 'HIT-25K' AND cantidad = 1 AND empaque_sku = 'T129-EMP' AND empaque_cantidad = 1 AND costo_total = 1.5
         FROM produccion WHERE id = (t129_j('m1') ->> 'id')::bigint), '129-03b fila Preparacion desde media barra con el costo del empaque');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('m1r', registrar_preparacion_media(t129_op('11'), 'HIT-25K', 'CF-T129', 1)::text);
COMMIT;
SELECT t129_assert((t129_j('m1r') ->> 'replay') = 'true' AND t129_e() = '3|3|0|1|19', '129-03c reintento: replay sin efectos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
SELECT t129_err($q$SELECT registrar_preparacion_media(t129_op('12'), 'HIB-50K', 'CF-T129', 1)$q$, '129-03d salida que no es picada ni triturada', '22023');
SELECT t129_err($q$SELECT registrar_preparacion_media(t129_op('12'), 'HIP-25K', 'CF-T129', 9)$q$, '129-03e más medias de las que hay', 'P0001|22023');
ROLLBACK;
SELECT t129_assert(t129_e() = '3|3|0|1|19', '129-03f los rechazos no dejaron efectos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('m2', registrar_preparacion_media(t129_op('13'), 'HIP-25K', 'CF-T129', 1)::text);
COMMIT;
SELECT t129_assert(t129_e() = '3|2|1|1|18', '129-03g la otra mitad queda como picada: media 3→2, picada +1');

\echo '── 129-04: reversos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
INSERT INTO t129_ids VALUES ('rm', revertir_preparacion_barra(t129_op('21'), (t129_j('m1') ->> 'id')::bigint, 'error de captura')::text);
COMMIT;
SELECT t129_assert(t129_e() = '3|3|1|0|19', '129-04a revertir la preparación de media: triturada −1, media +1, empaque +1');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
SELECT t129_err(format($q$SELECT revertir_partir_barra(t129_op('22'), %s, 'prueba')$q$, (t129_j('p1') ->> 'id')), '129-04b no se revierte el partido si las medias ya se usaron', 'P0001|22023');
ROLLBACK;
SELECT t129_assert(t129_e() = '3|3|1|0|19', '129-04c el rechazo no dejó efectos');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
INSERT INTO t129_ids VALUES ('rm2', revertir_preparacion_barra(t129_op('23'), (t129_j('m2') ->> 'id')::bigint, 'prueba')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
SELECT t129_err(format($q$SELECT revertir_partir_barra(t129_op('24'), %s, 'prueba')$q$, (t129_j('p1') ->> 'id')), '129-04d Producción no revierte (solo Admin)', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
INSERT INTO t129_ids VALUES ('rp', revertir_partir_barra(t129_op('25'), (t129_j('p1') ->> 'id')::bigint, 'prueba')::text);
COMMIT;
SELECT t129_assert(t129_e() = '5|0|0|0|20', '129-04e con las medias intactas el partido se revierte: barras 5, medias 0, empaque 20');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
SELECT t129_err(format($q$SELECT revertir_partir_barra(t129_op('26'), %s, 'otra vez')$q$, (t129_j('p1') ->> 'id')), '129-04f un partido se revierte una sola vez', '22023');
ROLLBACK;

\echo '── 129-05: la media barra no se produce por máquina'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
SELECT t129_err($q$SELECT registrar_produccion(t129_op('31'), 'Mañana', 'Máquina Barra', 'HIB-25K', 5, 'CF-T129')$q$, '129-05a registrar_produccion rechaza HIB-25K', '22023');
ROLLBACK;
SELECT t129_assert(t129_e() = '5|0|0|0|20', '129-05b sin efectos');

\echo '── 129-06: conciliación de empaque cuenta las preparaciones de media'
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(2);
INSERT INTO t129_ids VALUES ('p2', partir_barra(t129_op('41'), 'CF-T129', 1)::text);
INSERT INTO t129_ids VALUES ('m3', registrar_preparacion_media(t129_op('42'), 'HIP-25K', 'CF-T129', 2)::text);
COMMIT;
SELECT t129_assert(t129_e() = '4|0|2|0|18', '129-06a barra → 2 medias → 2 picadas: empaque −2');
BEGIN; SET LOCAL ROLE authenticated; SELECT t129_auth(1);
SELECT t129_assert((SELECT (e ->> 'consumido_produccion')::int FROM jsonb_array_elements(conciliacion_empaque()) e WHERE e ->> 'sku' = 'T129-EMP') = 2,
  '129-06b la conciliación cuenta el empaque de las preparaciones de media barra (2)');
ROLLBACK;

BEGIN; SELECT t129_limpiar(); COMMIT;
DROP TABLE t129_ids;
DROP FUNCTION t129_limpiar(); DROP FUNCTION t129_assert(BOOLEAN, TEXT); DROP FUNCTION t129_err(TEXT, TEXT, TEXT, TEXT); DROP FUNCTION t129_auth(INTEGER);
DROP FUNCTION t129_e(); DROP FUNCTION t129_op(TEXT); DROP FUNCTION t129_j(TEXT);
\echo '── 129: PASS'
