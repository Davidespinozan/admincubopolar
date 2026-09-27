-- 072_mermas_test.sql — Fase B / B1: merma como evento inmutable.
-- Matriz de pruebas B1-01 … B1-37 (28/29 = concurrencia, en run_local_db.mjs).
-- Actores: anon · JWT sin perfil · Chofer inactivo · Admin inactivo · Ventas ·
-- Chofer · Chofer 2 · Producción · Admin. Todo corre como `authenticated`/`anon`
-- reales (SET ROLE) con claims tipo PostgREST.

\set ON_ERROR_STOP on
\set QUIET on

-- ─── Fixtures ───────────────────────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos; DELETE FROM mermas;
DELETE FROM storage.objects WHERE bucket_id = 'mermas';
DELETE FROM produccion WHERE folio LIKE 'TR-72%';
DELETE FROM rutas WHERE id BETWEEN 7200 AND 7299;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-72%';
DELETE FROM productos WHERE sku LIKE 'M72-%';
DELETE FROM usuarios WHERE id BETWEEN 101 AND 107;
DELETE FROM auth.users WHERE id::text LIKE '72000000-%';
INSERT INTO storage.buckets (id, name, public) VALUES ('mermas', 'mermas', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('72000000-0000-0000-0000-000000000001', 'admin72@t'),
  ('72000000-0000-0000-0000-000000000002', 'chofer72@t'),
  ('72000000-0000-0000-0000-000000000003', 'prod72@t'),
  ('72000000-0000-0000-0000-000000000004', 'ventas72@t'),
  ('72000000-0000-0000-0000-000000000005', 'inact72@t'),
  ('72000000-0000-0000-0000-000000000006', 'chofer2_72@t'),
  ('72000000-0000-0000-0000-000000000007', 'inactadm72@t'),
  ('72000000-0000-0000-0000-000000000099', 'noprof72@evil');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (101, 'Admin 72',    'admin72@t',     'Admin',      'Activo',   '72000000-0000-0000-0000-000000000001'),
  (102, 'Chofer 72',   'chofer72@t',    'Chofer',     'Activo',   '72000000-0000-0000-0000-000000000002'),
  (103, 'Prod 72',     'prod72@t',      'Producción', 'Activo',   '72000000-0000-0000-0000-000000000003'),
  (104, 'Ventas 72',   'ventas72@t',    'Ventas',     'Activo',   '72000000-0000-0000-0000-000000000004'),
  (105, 'Inact 72',    'inact72@t',     'Chofer',     'Inactivo', '72000000-0000-0000-0000-000000000005'),
  (106, 'Chofer2 72',  'chofer2_72@t',  'Chofer',     'Activo',   '72000000-0000-0000-0000-000000000006'),
  (107, 'InactAdm 72', 'inactadm72@t',  'Admin',      'Inactivo', '72000000-0000-0000-0000-000000000007');
INSERT INTO productos (sku, nombre, precio, stock, costo_unitario) VALUES
  ('M72-A',  'Hielo A', 30, 0, 10),
  ('M72-B',  'Hielo B', 30, 0, 0),
  ('M72-IN', 'Barra',   0,  0, 5);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES
  ('CF-72A', 'Cuarto 72A', '{"M72-A": 8, "M72-B": 5}'::jsonb),
  ('CF-72B', 'Cuarto 72B', '{"M72-A": 5}'::jsonb);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus) VALUES
  (7201, 'R-7201', 'Ruta 72', 102, 'Chofer 72', 'En progreso'),
  (7202, 'R-7202', 'Ruta 72b', 106, 'Chofer2 72', 'En progreso'),
  (7203, 'R-7203', 'Ruta 72c', 102, 'Chofer 72', 'Cerrada');
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus, tipo, input_sku, input_kg, output_kg, merma_kg)
VALUES ('TR-7201', CURRENT_DATE, 'Transformación', 'Manual', 'M72-A', 16, 'Confirmada', 'Transformacion', 'M72-IN', 20, 16, 4);
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('mermas', 'victima/secreto.jpg', NULL),
  ('mermas', '72000000-0000-0000-0000-000000000002/2026-09-27/otra.jpg', '72000000-0000-0000-0000-000000000002');
COMMIT;

CREATE OR REPLACE FUNCTION t72_actor(p_role TEXT, p_sub TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    (jsonb_build_object('role', p_role) || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t72_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
      RAISE NOTICE 'OK: %', p_msg; END $$;
-- Ejecuta SQL y exige que falle (opcional: SQLSTATE o patrón ILIKE del mensaje).
CREATE OR REPLACE FUNCTION t72_err(p_sql TEXT, p_msg TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT; v_state TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; v_state := SQLSTATE; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (no hubo error)', p_msg; END IF;
  IF p_like IS NOT NULL AND v_state <> p_like AND v_err NOT ILIKE p_like THEN
    RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err;
  END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 80);
END $$;
-- Filas afectadas por un DML (para DELETE/UPDATE filtrados por RLS).
CREATE OR REPLACE FUNCTION t72_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t72_count(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;
DROP TABLE IF EXISTS t72_ids;
CREATE TEMP TABLE t72_ids (k TEXT PRIMARY KEY, v BIGINT, j JSONB);
GRANT ALL ON t72_ids TO anon, authenticated;
CREATE OR REPLACE FUNCTION t72_stock(p_cf TEXT, p_sku TEXT) RETURNS INTEGER LANGUAGE sql AS $$
  SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = p_cf $$;

\echo '── B1-35/36/37: RLS físico, grants y search_path'
SELECT t72_assert((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.mermas'::regclass, 'public.mermas_efectos'::regclass)), 'B1-35 RLS físicamente habilitado en mermas y mermas_efectos');
SELECT t72_assert(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('mermas', 'mermas_efectos') AND grantee IN ('anon', 'PUBLIC')), 'B1-36a anon/PUBLIC sin privilegios de tabla');
SELECT t72_assert((SELECT count(*) = 2 AND bool_and(privilege_type::text = 'SELECT') FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('mermas', 'mermas_efectos') AND grantee = 'authenticated'), 'B1-36b authenticated solo SELECT');
SELECT t72_assert(NOT has_sequence_privilege('anon', 'mermas_id_seq', 'USAGE') AND NOT has_sequence_privilege('authenticated', 'mermas_id_seq', 'USAGE') AND NOT has_sequence_privilege('authenticated', 'mermas_efectos_id_seq', 'USAGE'), 'B1-36c secuencias sin USAGE para anon/authenticated');
SELECT t72_assert((SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('registrar_merma', 'registrar_mermas_ruta', 'revertir_merma', 'erp_foto_merma_en_uso')), 'B1-36d RPC: sin EXECUTE para PUBLIC/anon, sí authenticated');
SELECT t72_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('registrar_merma', 'registrar_mermas_ruta', 'revertir_merma', 'erp_foto_merma_en_uso')), 'B1-37 SECURITY DEFINER nuevos con search_path = public, pg_temp');
SELECT t72_assert((SELECT bool_and(array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp') FROM pg_proc p WHERE p.proname IN ('mermas_guard_inmutable', 'mermas_efectos_guard')), 'B1-37b triggers de inmutabilidad con search_path fijo');
SELECT t72_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('mermas', 'mermas_efectos') AND (qual = 'true' OR with_check = 'true' OR cmd <> 'SELECT')), 'B1-36e policies de mermas: solo SELECT, ninguna USING/CHECK true');
SELECT t72_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mermas_authenticated_update'), 'B1-36f Storage: sin policy UPDATE en el bucket mermas');

\echo '── B1-01…04 anon'
BEGIN; SET LOCAL ROLE anon; SELECT t72_actor('anon');
SELECT t72_err('SELECT count(*) FROM mermas', 'B1-01 anon SELECT denegado', '42501');
SELECT t72_err($q$INSERT INTO mermas (sku, cantidad, causa, origen) VALUES ('M72-A', 1, 'x', 'x')$q$, 'B1-02 anon INSERT denegado', '42501');
SELECT t72_err('UPDATE mermas SET cantidad = 1', 'B1-03 anon UPDATE denegado', '42501');
SELECT t72_err('DELETE FROM mermas', 'B1-04 anon DELETE denegado', '42501');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x')$q$, 'B1-04b anon sin EXECUTE de registrar_merma', '42501');
SELECT t72_err($q$SELECT revertir_merma(1)$q$, 'B1-04c anon sin EXECUTE de revertir_merma', '42501');
SELECT t72_err('SELECT count(*) FROM mermas_efectos', 'B1-04d anon SELECT efectos denegado', '42501');
ROLLBACK;

\echo '── B1-05 JWT sin perfil / B1-06 inactivo / B1-07 rol no autorizado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000099');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 0, 'B1-05a sin perfil: no ve mermas');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x')$q$, 'B1-05b sin perfil: registrar_merma denegado', '42501');
SELECT t72_err($q$INSERT INTO mermas (sku, cantidad, causa, origen) VALUES ('M72-A', 1, 'x', 'x')$q$, 'B1-05c sin perfil: INSERT directo denegado', '42501');
SELECT t72_err($q$SELECT registrar_mermas_ruta(7201, '[{"sku":"M72-A","cant":1}]'::jsonb)$q$, 'B1-05d sin perfil: registrar_mermas_ruta denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000005');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 0, 'B1-06a Chofer inactivo: no ve mermas');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, NULL, 7201)$q$, 'B1-06b Chofer inactivo: registrar_merma denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000004');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x')$q$, 'B1-07a Ventas: registrar_merma denegado', '42501');
SELECT t72_err($q$SELECT registrar_mermas_ruta(7201, '[{"sku":"M72-A","cant":1}]'::jsonb)$q$, 'B1-07b Ventas: registrar_mermas_ruta denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000002');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x')$q$, 'B1-07c Chofer sin ruta: denegado', '42501');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, NULL, 7202)$q$, 'B1-07d Chofer en ruta ajena: denegado', '42501');
SELECT t72_err($q$SELECT registrar_mermas_ruta(7202, '[{"sku":"M72-A","cant":1}]'::jsonb)$q$, 'B1-07e Chofer: lote en ruta ajena denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, NULL, 7201)$q$, 'B1-07f Producción con ruta: denegado', '42501');
SELECT t72_err($q$SELECT registrar_mermas_ruta(7201, '[{"sku":"M72-A","cant":1}]'::jsonb)$q$, 'B1-07g Producción: lote de ruta denegado', '42501');
ROLLBACK;
SELECT t72_assert((SELECT count(*) FROM mermas) = 0 AND t72_stock('CF-72A', 'M72-A') = 8 AND t72_stock('CF-72B', 'M72-A') = 5, 'B1-05…07 ningún intento denegado dejó efectos');

\echo '── B1-31 foto legítima: Producción sube a su carpeta'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('mermas', '72000000-0000-0000-0000-000000000003/2026-09-27/1-M72-A.jpg', '72000000-0000-0000-0000-000000000003');
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('mermas', '72000000-0000-0000-0000-000000000003/2026-09-27/2-huerfana.jpg', '72000000-0000-0000-0000-000000000003');
SELECT t72_err($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '72000000-0000-0000-0000-000000000002/2026-09-27/intruso.jpg')$q$, 'B1-31a no se puede subir a la carpeta de otro usuario', '42501');
SELECT t72_err($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', 'raiz.jpg')$q$, 'B1-31b no se puede subir fuera de una carpeta propia', '42501');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000099');
SELECT t72_err($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '72000000-0000-0000-0000-000000000099/x/y.jpg')$q$, 'B1-31c JWT sin perfil no sube fotos', '42501');
ROLLBACK;
SELECT t72_assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'mermas' AND name LIKE '72000000-0000-0000-0000-000000000003/%') = 2, 'B1-31d subidas legítimas en carpeta propia persistidas');

\echo '── B1-10/11/12/16/30 validaciones (Producción)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 0, 'x')$q$, 'B1-10a cantidad 0 rechazada', '22023');
SELECT t72_err($q$SELECT registrar_merma('M72-A', -3, 'x')$q$, 'B1-10b cantidad negativa rechazada', '22023');
SELECT t72_err($q$SELECT registrar_merma('NO-EXISTE', 1, 'x')$q$, 'B1-11 SKU inexistente rechazado', '22023');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 99, 'x')$q$, 'B1-12 stock insuficiente rechazado', '%Stock insuficiente%');
-- 14 > 13 disponibles: descuenta 8 de CF-72A y 5 de CF-72B y falla en el tercer paso
SELECT t72_err($q$SELECT registrar_merma('M72-A', 14, 'x')$q$, 'B1-16a falla a medio camino (tras insertar merma y descontar 2 cuartos)', '%Stock insuficiente%');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, 'victima/secreto.jpg')$q$, 'B1-30a foto de carpeta ajena rechazada', '42501');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, '72000000-0000-0000-0000-000000000002/2026-09-27/otra.jpg')$q$, 'B1-30b foto de otro usuario rechazada', '42501');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, '72000000-0000-0000-0000-000000000003/../victima/secreto.jpg')$q$, 'B1-30c path traversal rechazado', '22023');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, 'https://evil.example/x.jpg')$q$, 'B1-30d URL externa rechazada', '22023');
SELECT t72_err($q$SELECT registrar_merma('M72-A', 1, 'x', NULL, '72000000-0000-0000-0000-000000000003/2026-09-27/no-subida.jpg')$q$, 'B1-30e foto inexistente en Storage rechazada', '22023');
ROLLBACK;
SELECT t72_assert((SELECT count(*) FROM mermas) = 0 AND (SELECT count(*) FROM mermas_efectos) = 0
  AND (SELECT count(*) FROM inventario_mov WHERE referencia LIKE 'MERMA-%') = 0
  AND (SELECT count(*) FROM movimientos_contables WHERE categoria = 'Mermas') = 0
  AND t72_stock('CF-72A', 'M72-A') = 8 AND t72_stock('CF-72B', 'M72-A') = 5, 'B1-16b rollback total: sin merma, sin efectos, sin kardex, sin egreso, stock intacto');

\echo '── B1-08/09/13/14/15/34 registro legítimo (Producción, con foto)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
INSERT INTO t72_ids (k, j) VALUES ('p1', registrar_merma('M72-A', 10, 'Bolsa rota', 'Admin Forjado', '72000000-0000-0000-0000-000000000003/2026-09-27/1-M72-A.jpg'));
SELECT t72_err($q$SELECT registrar_merma('M72-B', 1, 'x', NULL, '72000000-0000-0000-0000-000000000003/2026-09-27/1-M72-A.jpg')$q$, 'B1-31e la misma foto no se liga a dos mermas', '23505');
-- Storage: la foto ligada no se puede borrar; la huérfana propia sí; la ajena no.
SELECT t72_assert(t72_rows($q$DELETE FROM storage.objects WHERE bucket_id = 'mermas' AND name = '72000000-0000-0000-0000-000000000003/2026-09-27/1-M72-A.jpg'$q$) = 0, 'B1-30f foto ligada a merma: el dueño no puede borrarla');
SELECT t72_assert(t72_rows($q$DELETE FROM storage.objects WHERE bucket_id = 'mermas' AND name = 'victima/secreto.jpg'$q$) = 0, 'B1-30g objeto arbitrario del bucket: no se puede borrar');
SELECT t72_assert(t72_rows($q$DELETE FROM storage.objects WHERE bucket_id = 'mermas' AND name = '72000000-0000-0000-0000-000000000003/2026-09-27/2-huerfana.jpg'$q$) = 1, 'B1-31f subida huérfana propia: sí se puede limpiar');
COMMIT;
UPDATE t72_ids SET v = (j ->> 'id')::bigint WHERE k = 'p1';
SELECT t72_assert((SELECT v IS NOT NULL FROM t72_ids WHERE k = 'p1'), 'B1-08 Producción registra merma');
SELECT t72_assert((SELECT usuario_id = 103 AND origen = 'Admin Forjado' AND estatus = 'Activa' AND afecta_stock AND fecha = fin_hoy() FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-09a usuario_id derivado del JWT (103), no del cliente');
SELECT t72_assert((SELECT (j ->> 'actor') = 'Prod 72' FROM t72_ids WHERE k = 'p1'), 'B1-09b actor devuelto = actor real');
SELECT t72_assert(t72_stock('CF-72A', 'M72-A') = 0 AND t72_stock('CF-72B', 'M72-A') = 3, 'B1-13a stock descontado FIFO: 8 de CF-72A + 2 de CF-72B');
SELECT t72_assert((SELECT count(*) = 2 AND sum(cantidad) = 10 FROM mermas_efectos WHERE merma_id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-13b exactamente 10 descontados una vez (2 efectos)');
SELECT t72_assert((SELECT count(*) = 2 FROM mermas_efectos e JOIN inventario_mov i ON i.id = e.inv_mov_id
  WHERE e.merma_id = (SELECT v FROM t72_ids WHERE k = 'p1') AND i.tipo = 'Merma' AND i.producto = 'M72-A' AND i.cantidad = e.cantidad
    AND i.referencia = 'MERMA-' || e.merma_id), 'B1-14 cada efecto ligado a su movimiento de inventario exacto');
SELECT t72_assert((SELECT bool_and(i.usuario = 'Prod 72') FROM mermas_efectos e JOIN inventario_mov i ON i.id = e.inv_mov_id WHERE e.merma_id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-34a kardex atribuido al actor real (Prod 72)');
SELECT t72_assert((SELECT mc.tipo = 'Egreso' AND mc.categoria = 'Mermas' AND mc.monto = 100 AND mc.usuario_id = 103 AND mc.referencia = 'MERMA-' || m.id
  FROM mermas m JOIN movimientos_contables mc ON mc.id = m.mov_contable_id WHERE m.id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-15a egreso contable exacto ligado por id (10 × $10)');

\echo '── B1-17/18 mutación directa denegada (incluso Admin) + guard de inmutabilidad'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 1, 'B1-17a Admin ve la merma');
SELECT t72_err('UPDATE mermas SET cantidad = 999', 'B1-17 UPDATE directo denegado (Admin)', '42501');
SELECT t72_err('DELETE FROM mermas', 'B1-18 DELETE directo denegado (Admin)', '42501');
SELECT t72_err($q$INSERT INTO mermas (sku, cantidad, causa, origen) VALUES ('M72-A', 1, 'x', 'x')$q$, 'B1-18b INSERT directo denegado (Admin)', '42501');
SELECT t72_err('UPDATE mermas_efectos SET cantidad = 999', 'B1-18c UPDATE directo de efectos denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
SELECT t72_err($q$INSERT INTO mermas (sku, cantidad, causa, origen) VALUES ('M72-A', 1, 'x', 'x')$q$, 'B1-18d INSERT directo denegado (Producción)', '42501');
ROLLBACK;
-- Escritor privilegiado (postgres): el trigger protege el evento.
SELECT t72_err($q$UPDATE mermas SET cantidad = 500 WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1')$q$, 'B1-17b guard: cantidad inmutable incluso para escritores privilegiados', '42501');
SELECT t72_err($q$UPDATE mermas SET foto_url = 'victima/secreto.jpg' WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1')$q$, 'B1-17c guard: foto_url inmutable', '42501');
SELECT t72_err($q$UPDATE mermas_efectos SET cuarto_id = 'CF-72B', cantidad = 50 WHERE merma_id = (SELECT v FROM t72_ids WHERE k = 'p1')$q$, 'B1-17d guard: efectos inmutables', '42501');

\echo '── B1-15b merma sin costo: sin egreso'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
INSERT INTO t72_ids (k, j) VALUES ('p2', registrar_merma('M72-B', 1, 'Mal sellado'));
COMMIT;
UPDATE t72_ids SET v = (j ->> 'id')::bigint WHERE k = 'p2';
SELECT t72_assert((SELECT mov_contable_id IS NULL FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'p2')) AND t72_stock('CF-72A', 'M72-B') = 4, 'B1-15b costo 0: descuenta stock, sin egreso contable');

-- Señuelo: egreso manual con EXACTAMENTE el mismo concepto/fecha/categoría.
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto)
SELECT fecha, tipo, categoria, concepto, monto FROM movimientos_contables WHERE id = (SELECT mov_contable_id FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1'));
INSERT INTO t72_ids (k, v) SELECT 'decoy', max(id) FROM movimientos_contables WHERE categoria = 'Mermas';

\echo '── B1-20 reverso por no-Admin denegado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-20a Producción no revierte', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000002');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-20b Chofer no revierte', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000004');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-20c Ventas no revierte', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000099');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-20d JWT sin perfil no revierte', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000007');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-20e Admin INACTIVO no revierte', '42501');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 0, 'B1-20f Admin INACTIVO no lee mermas (sin admin_all por email)');
ROLLBACK;

\echo '── B1-23/24 el reverso no acepta cantidad/SKU del cliente'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
SELECT t72_err(format('SELECT revertir_merma(p_merma_id => %s, p_cantidad => 999)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-23 cantidad forjada: el contrato no la acepta', '42883');
SELECT t72_err(format($q$SELECT revertir_merma(p_merma_id => %s, p_sku => 'M72-B')$q$, (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-24 SKU forjado: el contrato no lo acepta', '42883');
ROLLBACK;

\echo '── B1-19/21/22/25/26 reverso Admin'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
INSERT INTO t72_ids (k, j) SELECT 'rev1', revertir_merma(v, 'error de captura') FROM t72_ids WHERE k = 'p1';
COMMIT;
SELECT t72_assert((SELECT (j ->> 'estatus') = 'Revertida' AND (j ->> 'efectos_revertidos')::int = 2 AND (j ->> 'egreso_borrado')::boolean FROM t72_ids WHERE k = 'rev1'), 'B1-19a Admin revierte');
SELECT t72_assert(t72_stock('CF-72A', 'M72-A') = 8 AND t72_stock('CF-72B', 'M72-A') = 5, 'B1-21/22 stock regresa exacto a los cuartos originales (8 → CF-72A, 2 → CF-72B)');
SELECT t72_assert((SELECT count(*) = 2 AND bool_and(i.tipo = 'Reverso merma' AND i.cantidad = e.cantidad AND i.producto = 'M72-A' AND i.usuario = 'Admin 72')
  FROM mermas_efectos e JOIN inventario_mov i ON i.id = e.reverso_inv_mov_id WHERE e.merma_id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-22b kardex de reverso por efecto, atribuido al Admin real');
SELECT t72_assert((SELECT estatus = 'Revertida' AND revertida_por = 101 AND revertida_at IS NOT NULL AND motivo_reverso = 'error de captura' AND cantidad = 10 AND sku = 'M72-A' AND mov_contable_id IS NOT NULL
  FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-19b historia preservada: merma marcada Revertida (no borrada), rastro del egreso conservado');
SELECT t72_assert(NOT EXISTS (SELECT 1 FROM movimientos_contables WHERE id = (SELECT mov_contable_id FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1'))), 'B1-25 egreso exacto (por id) eliminado');
SELECT t72_assert(EXISTS (SELECT 1 FROM movimientos_contables WHERE id = (SELECT v FROM t72_ids WHERE k = 'decoy')), 'B1-26 señuelo con el mismo concepto NO se borró (sin match por texto)');
SELECT t72_assert((SELECT count(*) = 1 FROM auditoria WHERE modulo = 'Mermas' AND accion = 'Revertir' AND usuario = 'Admin 72' AND detalle LIKE 'Merma #' || (SELECT v FROM t72_ids WHERE k = 'p1') || ' %'), 'B1-19c reverso auditado');
SELECT t72_assert(EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'mermas' AND name = '72000000-0000-0000-0000-000000000003/2026-09-27/1-M72-A.jpg'), 'B1-30h reverso no borra la foto (evidencia preservada)');

\echo '── B1-27 segundo reverso: rechazado sin cambios'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'p1')), 'B1-27a segundo reverso rechazado', '55000');
ROLLBACK;
SELECT t72_assert(t72_stock('CF-72A', 'M72-A') = 8 AND t72_stock('CF-72B', 'M72-A') = 5
  AND (SELECT count(*) FROM inventario_mov WHERE tipo = 'Reverso merma' AND referencia = 'MERMA-' || (SELECT v FROM t72_ids WHERE k = 'p1')) = 2, 'B1-27b stock/kardex restaurados una sola vez');
SELECT t72_err($q$UPDATE mermas SET estatus = 'Activa', revertida_at = NULL WHERE id = (SELECT v FROM t72_ids WHERE k = 'p1')$q$, 'B1-27c guard: Revertida es terminal', '42501');

\echo '── B1-32 flujo de ruta (Chofer, lote atómico e idempotente)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000002');
INSERT INTO t72_ids (k, j) VALUES ('ruta', registrar_mermas_ruta(7201,
  '[{"sku":"M72-A","cant":3,"causa":"Bolsa rota","foto":"data:image/jpeg;base64,AAAA"},{"sku":"M72-B","cant":2,"causa":"Hielo derretido"}]'::jsonb));
INSERT INTO t72_ids (k, j) VALUES ('ruta_retry', registrar_mermas_ruta(7201, '[{"sku":"M72-A","cant":3,"causa":"Bolsa rota"}]'::jsonb));
SELECT t72_err($q$SELECT registrar_mermas_ruta(7203, '[{"sku":"M72-B","cant":1},{"sku":"M72-A","cant":999}]'::jsonb)$q$, 'B1-32a lote con una merma imposible: falla completo', '%Stock insuficiente%');
SELECT t72_err($q$SELECT registrar_mermas_ruta(7203, '[{"sku":"M72-B","cant":1.5}]'::jsonb)$q$, 'B1-32b cantidad no entera rechazada', '22023');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 2, 'B1-32c Chofer ve solo sus mermas (no la de Producción)');
COMMIT;
SELECT t72_assert((SELECT NOT (j ->> 'skipped')::boolean AND jsonb_array_length(j -> 'registradas') = 2 FROM t72_ids WHERE k = 'ruta'), 'B1-32d lote de ruta registra 2 mermas');
SELECT t72_assert((SELECT (j ->> 'skipped')::boolean FROM t72_ids WHERE k = 'ruta_retry') AND (SELECT count(*) FROM mermas WHERE ruta_id = 7201) = 2, 'B1-32e reintento del cierre: idempotente, sin duplicados');
SELECT t72_assert((SELECT count(*) FROM mermas WHERE ruta_id = 7203) = 0 AND t72_stock('CF-72A', 'M72-B') = 2, 'B1-32f lote fallido sin efectos (ni la merma válida del lote)');
SELECT t72_assert((SELECT bool_and(usuario_id = 102 AND origen = 'Ruta Chofer 72' AND estatus = 'Activa') FROM mermas WHERE ruta_id = 7201), 'B1-32g ruta: usuario_id = chofer real, origen derivado de la ruta');
SELECT t72_assert(t72_stock('CF-72A', 'M72-A') = 5 AND t72_stock('CF-72A', 'M72-B') = 2, 'B1-32h ruta: stock descontado');
SELECT t72_assert((SELECT foto_url LIKE 'data:image/jpeg;base64,%' FROM mermas WHERE ruta_id = 7201 AND sku = 'M72-A'), 'B1-31g ruta: foto data URL del chofer aceptada');
SELECT t72_assert((SELECT count(*) = 1 AND bool_and(mc.concepto = 'Merma ruta Chofer 72: 3× M72-A (Hielo A) — Bolsa rota' AND mc.monto = 30)
  FROM mermas m JOIN movimientos_contables mc ON mc.id = m.mov_contable_id WHERE m.ruta_id = 7201), 'B1-32i ruta: egreso solo para el SKU con costo, ligado por id');
SELECT t72_assert((SELECT bool_and(i.usuario = 'Chofer 72' AND i.origen = 'Merma ruta Chofer 72') FROM mermas m JOIN mermas_efectos e ON e.merma_id = m.id JOIN inventario_mov i ON i.id = e.inv_mov_id WHERE m.ruta_id = 7201), 'B1-34b kardex de ruta atribuido al chofer real');

\echo '── B1-33 flujo de producción: merma de proceso (transformación)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
INSERT INTO t72_ids (k, j) VALUES ('tr', registrar_merma('M72-IN', 4, 'Merma de proceso — transformación', 'Transformación TR-7201', NULL, NULL, false));
SELECT t72_err($q$SELECT registrar_merma('M72-IN', 4, 'x', 'Transformación TR-7201', NULL, NULL, false)$q$, 'B1-33a una sola merma por transformación', '23505');
SELECT t72_err($q$SELECT registrar_merma('M72-IN', 1, 'x', 'Transformación TR-9999', NULL, NULL, false)$q$, 'B1-33b transformación inexistente rechazada', '22023');
SELECT t72_err($q$SELECT registrar_merma('M72-IN', 1, 'x', 'lo que sea', NULL, NULL, false)$q$, 'B1-33c merma sin stock requiere folio de transformación', '22023');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000002');
SELECT t72_err($q$SELECT registrar_merma('M72-IN', 1, 'x', 'Transformación TR-7201', NULL, 7201, false)$q$, 'B1-33d Chofer no registra merma de proceso', '%proceso%');
ROLLBACK;
SELECT t72_assert((SELECT NOT afecta_stock AND usuario_id = 103 AND mov_contable_id IS NULL FROM mermas WHERE id = (SELECT (j ->> 'id')::bigint FROM t72_ids WHERE k = 'tr'))
  AND NOT EXISTS (SELECT 1 FROM mermas_efectos WHERE merma_id = (SELECT (j ->> 'id')::bigint FROM t72_ids WHERE k = 'tr')), 'B1-33e merma de proceso: sin efecto de stock ni egreso propio');
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
INSERT INTO t72_ids (k, j) SELECT 'rev_tr', revertir_merma((j ->> 'id')::bigint, 'transformación mal capturada') FROM t72_ids WHERE k = 'tr';
COMMIT;
SELECT t72_assert((SELECT (j ->> 'efectos_revertidos')::int = 0 FROM t72_ids WHERE k = 'rev_tr') AND t72_stock('CF-72A', 'M72-A') = 5, 'B1-33f reverso de merma de proceso: solo cambia estatus');

\echo '── Filas legacy (como las 2 de producción): el reverso falla cerrado'
INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id) VALUES (DATE '2026-08-22', 'M72-A', 10, 'Bolsa rota', 'Legacy', 'x/legacy.jpg', 103);
INSERT INTO t72_ids (k, v) SELECT 'legacy', max(id) FROM mermas WHERE origen = 'Legacy';
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
SELECT t72_err(format('SELECT revertir_merma(%s)', (SELECT v FROM t72_ids WHERE k = 'legacy')), 'B1-L1 merma legacy sin efectos: reverso rechazado (fail closed)', '55000');
ROLLBACK;
SELECT t72_assert((SELECT estatus = 'Activa' AND afecta_stock FROM mermas WHERE id = (SELECT v FROM t72_ids WHERE k = 'legacy')) AND t72_stock('CF-72A', 'M72-A') = 5, 'B1-L2 fila legacy intacta y sin cambios de stock');

\echo '── Lectura por rol'
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000003');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = (SELECT count(*) FROM mermas), 'B1-R1 Producción lee todas las mermas');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas_efectos') = 0, 'B1-R2 Producción no lee efectos');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000004');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 0, 'B1-R3 Ventas no lee mermas');
SELECT t72_assert(t72_count($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'mermas'$q$) = 0, 'B1-R4 Ventas no lee fotos de mermas');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000006');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas') = 0, 'B1-R5 otro Chofer no ve mermas ajenas');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t72_actor('authenticated', '72000000-0000-0000-0000-000000000001');
SELECT t72_assert(t72_count('SELECT count(*) FROM mermas_efectos') = (SELECT count(*) FROM mermas_efectos), 'B1-R6 Admin lee efectos');
SELECT t72_assert(t72_count($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'mermas'$q$) = (SELECT count(*) FROM storage.objects WHERE bucket_id = 'mermas'), 'B1-R7 Admin lee fotos (URL firmada)');
ROLLBACK;

-- ─── Limpieza (como postgres) ───────────────────────────────────
BEGIN;
DELETE FROM mermas_efectos; DELETE FROM mermas;
DELETE FROM movimientos_contables WHERE categoria = 'Mermas';
DELETE FROM inventario_mov WHERE referencia LIKE 'MERMA-%';
DELETE FROM auditoria WHERE modulo = 'Mermas';
DELETE FROM storage.objects WHERE bucket_id = 'mermas';
DELETE FROM produccion WHERE folio LIKE 'TR-72%';
DELETE FROM rutas WHERE id BETWEEN 7200 AND 7299;
DELETE FROM cuartos_frios WHERE id LIKE 'CF-72%';
DELETE FROM productos WHERE sku LIKE 'M72-%';
DELETE FROM usuarios WHERE id BETWEEN 101 AND 107;
DELETE FROM auth.users WHERE id::text LIKE '72000000-%';
COMMIT;
\echo '── 072: TODAS LAS PRUEBAS OK'
