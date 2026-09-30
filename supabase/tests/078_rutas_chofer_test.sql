-- 078_rutas_chofer_test.sql — F3-D: el Chofer solo puede hacer las
-- transiciones y columnas de su flujo real sobre su propia ruta; todo lo
-- demás (columnas de Admin, otras rutas, otros roles, transiciones ajenas)
-- se rechaza por completo. Admin y contratos del servidor intactos.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'P78-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%R-78%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7820 AND 7829;
DELETE FROM ordenes WHERE id BETWEEN 7820 AND 7829;
DO $$ BEGIN IF to_regclass('public.stock_operaciones') IS NOT NULL THEN DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 7801 AND 7899 OR operacion_id::text LIKE '78000000-%'; END IF; END $$;
DELETE FROM rutas WHERE id BETWEEN 7801 AND 7899;
DELETE FROM clientes WHERE id = 7810;
DELETE FROM cuartos_frios WHERE id = 'CF-78';
DELETE FROM productos WHERE sku LIKE 'P78-%';
DELETE FROM auditoria WHERE detalle LIKE '%R-78%';
DELETE FROM usuarios WHERE id BETWEEN 7801 AND 7809;
DELETE FROM auth.users WHERE id::text LIKE '78000000-%';
INSERT INTO auth.users (id, email) VALUES
  ('78000000-0000-0000-0000-000000000001', 'admin78@t'),   ('78000000-0000-0000-0000-000000000002', 'prod78@t'),
  ('78000000-0000-0000-0000-000000000003', 'ventas78@t'),  ('78000000-0000-0000-0000-000000000004', 'chofera78@t'),
  ('78000000-0000-0000-0000-000000000005', 'choferb78@t'), ('78000000-0000-0000-0000-000000000006', 'inchofer78@t'),
  ('78000000-0000-0000-0000-000000000007', 'inadm78@t'),   ('78000000-0000-0000-0000-000000000099', 'noprof78@t');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (7801, 'Admin 78',      'admin78@t',    'Admin',      'Activo',   '78000000-0000-0000-0000-000000000001'),
  (7802, 'Prod 78',       'prod78@t',     'Producción', 'Activo',   '78000000-0000-0000-0000-000000000002'),
  (7803, 'Ventas 78',     'ventas78@t',   'Ventas',     'Activo',   '78000000-0000-0000-0000-000000000003'),
  (7804, 'Chofer A78',    'chofera78@t',  'Chofer',     'Activo',   '78000000-0000-0000-0000-000000000004'),
  (7805, 'Chofer B78',    'choferb78@t',  'Chofer',     'Activo',   '78000000-0000-0000-0000-000000000005'),
  (7806, 'InChofer 78',   'inchofer78@t', 'Chofer',     'Inactivo', '78000000-0000-0000-0000-000000000006'),
  (7807, 'InAdmin 78',    'inadm78@t',    'Admin',      'Inactivo', '78000000-0000-0000-0000-000000000007');
INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('P78-HIELO', 'Hielo 78', 'Producto Terminado', 30, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-78', 'Cuarto 78', '{"P78-HIELO": 100}'::jsonb);
INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (7810, 'Cliente 78', 'XAXX010101000', 0);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
  (7820, 'OV-7820', 7810, 'Cliente 78', '5×P78-HIELO', 150, 'Creada', 'Efectivo', 'Contado', 7803),
  (7821, 'OV-7821', 7810, 'Cliente 78', '5×P78-HIELO', 150, 'Creada', 'Efectivo', 'Contado', 7803);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (7820, 'P78-HIELO', 5, 30, 150), (7821, 'P78-HIELO', 5, 30, 150);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, autorizado_at) VALUES
  (7801, 'R-7801', 'Ruta A78',       7804, 'Chofer A78',  'Programada', CURRENT_DATE, '{"P78-HIELO": 50}', '{"P78-HIELO": 50}', '{"P78-HIELO": 10}', now()),
  (7802, 'R-7802', 'Ruta B78',       7805, 'Chofer B78',  'Programada', CURRENT_DATE, '{"P78-HIELO": 20}', '{"P78-HIELO": 20}', '{}', now()),
  (7803, 'R-7803', 'Ruta sin chofer', NULL, NULL,         'Programada', CURRENT_DATE, '{}', '{}', '{}', now()),
  (7804, 'R-7804', 'Ruta A78 vieja', 7804, 'Chofer A78',  'Cerrada',    CURRENT_DATE - 1, '{"P78-HIELO": 5}', '{"P78-HIELO": 5}', '{}', now() - interval '1 day'),
  (7805, 'R-7805', 'Ruta inactivo',  7806, 'InChofer 78', 'Programada', CURRENT_DATE, '{"P78-HIELO": 1}', '{"P78-HIELO": 1}', '{}', now());
COMMIT;

CREATE OR REPLACE FUNCTION t78_actor(p_role TEXT, p_email TEXT, p_sub TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object('role', p_role)
    || CASE WHEN p_email IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('email', p_email) END
    || CASE WHEN p_sub IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sub', p_sub) END)::text, true);
END $$;
CREATE OR REPLACE FUNCTION t78_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t78_err(p_sql TEXT, p_msg TEXT, p_state TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, v_state;
END $$;
CREATE OR REPLACE FUNCTION t78_rows(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE OR REPLACE FUNCTION t_p087() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION t_p087() TO anon, authenticated, service_role;
-- Huella de negocio: todas las columnas de las rutas 78xx (menos updated_at), stock del cuarto,
-- kardex y órdenes de prueba.
CREATE OR REPLACE FUNCTION t78_huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg((to_jsonb(r) - 'updated_at')::text, ',' ORDER BY id) FROM rutas r WHERE id BETWEEN 7801 AND 7899),
    (SELECT stock::text FROM cuartos_frios WHERE id = 'CF-78'),
    (SELECT count(*)::text FROM inventario_mov WHERE producto LIKE 'P78-%'),
    (SELECT string_agg(concat_ws(':', id, estatus, ruta_id), ',' ORDER BY id) FROM ordenes WHERE id BETWEEN 7820 AND 7829)))
$$;
CREATE OR REPLACE FUNCTION t78_ruta(p_id BIGINT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$ SELECT to_jsonb(r) FROM rutas r WHERE id = p_id $$;
DROP TABLE IF EXISTS t78_ids;
CREATE TEMP TABLE t78_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t78_ids TO anon, authenticated;
INSERT INTO t78_ids VALUES ('h0', t78_huella());

-- Matriz de ataque directo del actor de turno contra una ruta (cada columna de
-- Admin por separado, transiciones ajenas al flujo y payload mixto). El
-- resultado esperado depende de si la policy deja ver la fila (propia → 42501
-- del guard; ajena → 0 filas).
CREATE OR REPLACE FUNCTION t78_ataques(p_tag TEXT, p_ruta BIGINT, p_propia BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s RECORD; v_sql TEXT;
BEGIN
  FOR s IN SELECT * FROM (VALUES
      ('carga_autorizada',       $q$carga_autorizada = '{"P78-HIELO": 999}'$q$),
      ('extra_autorizado',       $q$extra_autorizado = '{"P78-HIELO": 999}'$q$),
      ('chofer_id (reasignar)',  $q$chofer_id = 7805$q$),
      ('chofer_id (soltar)',     $q$chofer_id = NULL$q$),
      ('chofer_nombre',          $q$chofer_nombre = 'Otro'$q$),
      ('folio',                  $q$folio = 'R-9999'$q$),
      ('nombre',                 $q$nombre = 'x'$q$),
      ('carga',                  $q$carga = '{"P78-HIELO": 999}'$q$),
      ('fecha',                  $q$fecha = CURRENT_DATE + 30$q$),
      ('clientes_asignados',     $q$clientes_asignados = '[{"clienteId": 1}]'$q$),
      ('devolucion',             $q$devolucion = '{"P78-HIELO": 1}'$q$),
      ('autorizado_at',          $q$autorizado_at = now()$q$),
      ('ayudante_id',            $q$ayudante_id = 1$q$),
      ('camion_id',              $q$camion_id = 1$q$),
      ('cierre_at',              $q$cierre_at = now()$q$),
      ('total_cobrado',          $q$total_cobrado = 99999$q$),
      ('total_credito',          $q$total_credito = 99999$q$),
      ('cancelada_at',           $q$cancelada_at = now()$q$),
      ('motivo_cancelacion',     $q$motivo_cancelacion = 'x'$q$),
      ('created_at',             $q$created_at = now()$q$),
      ('carga_confirmada_at sola',   $q$carga_confirmada_at = now()$q$),
      ('carga_confirmada_por sola',  $q$carga_confirmada_por = 7801$q$),
      ('firma_excepcion sola',       $q$firma_excepcion = true$q$),
      ('carga_real sin transición',  $q$carga_real = '{"P78-HIELO": 1}'$q$),
      ('estatus → En progreso',  $q$estatus = 'En progreso'$q$),
      ('estatus → Cargada',      $q$estatus = 'Cargada'$q$),
      ('estatus → Completada',   $q$estatus = 'Completada'$q$),
      ('estatus → Cerrada',      $q$estatus = 'Cerrada'$q$),
      ('estatus → Cancelada',    $q$estatus = 'Cancelada'$q$),
      ('estatus → inventado',    $q$estatus = 'Hackeada'$q$),
      ('mixto: solicitud legítima + carga_autorizada', $q$estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 10}', carga_solicitada_at = now(), carga_autorizada = '{"P78-HIELO": 999}'$q$),
      ('mixto: solicitud legítima + extra_autorizado', $q$estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 10}', carga_solicitada_at = now(), extra_autorizado = '{"P78-HIELO": 999}'$q$),
      ('mixto: solicitud legítima + folio',            $q$estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 10}', carga_solicitada_at = now(), folio = 'R-9999'$q$),
      ('solicitud con carga_real > autorizado+extra',  $q$estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 61}', carga_solicitada_at = now()$q$),
      ('solicitud con SKU no autorizado',              $q$estatus = 'Pendiente firma', carga_real = '{"P78-OTRO": 1}', carga_solicitada_at = now()$q$),
      ('solicitud con cantidad no numérica',           $q$estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": "mucho"}', carga_solicitada_at = now()$q$)
    ) x(col, set_clause)
  LOOP
    v_sql := format('UPDATE rutas SET %s WHERE id = %s', s.set_clause, p_ruta);
    IF p_propia THEN
      PERFORM t78_err(v_sql, p_tag || ': ' || s.col || ' → rechazado', '42501');
    ELSE
      PERFORM t78_assert(t78_rows(v_sql) = 0, p_tag || ': ' || s.col || ' → 0 filas');
    END IF;
  END LOOP;
  PERFORM t78_assert(t78_rows(format('DELETE FROM rutas WHERE id = %s', p_ruta)) = 0, p_tag || ': DELETE → 0 filas');
  PERFORM t78_err($q$INSERT INTO rutas (folio, nombre, chofer_id, estatus) VALUES ('R-7890', 'nueva', 7804, 'Programada')$q$, p_tag || ': INSERT → rechazado', '42501');
END $$;
GRANT EXECUTE ON FUNCTION t78_ataques(TEXT, BIGINT, BOOLEAN) TO anon, authenticated;

\echo '── 078: estado físico'
SELECT t78_assert((SELECT qual ~ 'erp_rol_activo\(\) = ''Chofer''' AND qual ~ 'chofer_id = erp_usuario_id\(\)' AND with_check = qual AND qual !~ 'get_my_' AND cmd = 'UPDATE' AND roles::text = '{authenticated}'
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rutas' AND policyname = 'chofer_update_own'), '078-01 chofer_update_own: identidad canónica 071 (actor activo) con WITH CHECK');
SELECT t78_assert((SELECT string_agg(policyname, ',' ORDER BY policyname) = CASE WHEN to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NULL THEN 'admin_all,almacen_update,almacen_write,chofer_update_own,read_all' ELSE 'admin_all,chofer_update_own,read_all' END FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rutas'), '078-02 las demás policies de rutas no cambiaron');
SELECT t78_assert((SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.rutas'::regclass AND tgname = 'trg_rutas_guard_chofer' AND NOT tgisinternal AND tgenabled = 'O'), '078-03 trigger trg_rutas_guard_chofer presente (BEFORE UPDATE)');
SELECT t78_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE oid = 'public.rutas_guard_chofer()'::regprocedure), '078-04 rutas_guard_chofer: search_path fijo y sin EXECUTE para anon/authenticated');
SELECT t78_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rutas'::regclass) AND (SELECT pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) !~ 'fin_ctx|fin_marcar_ctx|get_my_'), '078-05 RLS físico activo; el guard no usa app.fin_ctx ni identidad legacy');

\echo '── 078: ataque directo — Chofer A contra su propia ruta (Programada)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t78_actor('authenticated', 'chofera78@t', '78000000-0000-0000-0000-000000000004');
SELECT t78_ataques('078-10 Chofer A/propia', 7801, true);
SELECT t78_err($q$SELECT asignar_ordenes_a_ruta(7801, ARRAY[7821]::bigint[])$q$, '078-11 Chofer A: asignar_ordenes_a_ruta (RPC sin guardia) no puede cambiar carga de su ruta', '42501');
ROLLBACK;
SELECT t78_assert(t78_huella() = (SELECT v FROM t78_ids WHERE k = 'h0') AND (SELECT estatus = 'Creada' AND ruta_id IS NULL FROM ordenes WHERE id = 7821), '078-12 cero efectos tras la matriz de ataque (ruta, cuarto, kardex, órdenes)');

\echo '── 078: propiedad — otras rutas, otros roles, inactivo, sin perfil, anon'
DO $$
DECLARE a RECORD; r RECORD;
BEGIN
  FOR a IN SELECT * FROM (VALUES
      ('078-20 Chofer A', 'chofera78@t', '78000000-0000-0000-0000-000000000004', ARRAY[7802, 7803, 7805]),
      ('078-21 Chofer B', 'choferb78@t', '78000000-0000-0000-0000-000000000005', ARRAY[7801, 7803, 7805]),
      ('078-22 Chofer INACTIVO', 'inchofer78@t', '78000000-0000-0000-0000-000000000006', ARRAY[7805, 7801]),
      ('078-23 Ventas', 'ventas78@t', '78000000-0000-0000-0000-000000000003', ARRAY[7801, 7803]),
      ('078-24 Producción', 'prod78@t', '78000000-0000-0000-0000-000000000002', ARRAY[7801, 7803]),
      ('078-25 JWT sin perfil', 'noprof78@t', '78000000-0000-0000-0000-000000000099', ARRAY[7801, 7803])) x(tag, email, sub, rutas)
  LOOP
    PERFORM t78_actor('authenticated', a.email, a.sub);
    SET LOCAL ROLE authenticated;
    FOR r IN SELECT unnest(a.rutas) AS id LOOP
      PERFORM t78_assert(t78_rows(format($q$UPDATE rutas SET estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 1}', carga_solicitada_at = now() WHERE id = %s$q$, r.id)) = 0, a.tag || ': solicitud de firma sobre ruta ' || r.id || ' → 0 filas');
      PERFORM t78_ataques(a.tag || ' ruta ' || r.id, r.id, false);
    END LOOP;
    RESET ROLE;
    PERFORM t78_assert(t78_huella() = (SELECT v FROM t78_ids WHERE k = 'h0'), a.tag || ': cero efectos');
  END LOOP;
END $$;
BEGIN; SET LOCAL ROLE anon; SELECT t78_actor('anon', NULL, NULL);
-- 090: anon ya no tiene privilegios sobre rutas: cada intento falla por ACL.
DO $do$ BEGIN
  IF has_table_privilege('anon', 'public.rutas', 'UPDATE') THEN
    PERFORM t78_ataques('078-26 anon', 7801, false);
  ELSE
    PERFORM t78_err($q$UPDATE rutas SET carga_autorizada = '{"P78-HIELO": 999}' WHERE id = 7801$q$, '078-26 anon: UPDATE sin privilegio (090)', '42501');
    PERFORM t78_err($q$DELETE FROM rutas WHERE id = 7801$q$, '078-26 anon: DELETE sin privilegio (090)', '42501');
    PERFORM t78_err($q$INSERT INTO rutas (folio, nombre, chofer_id, estatus) VALUES ('R-7890', 'nueva', 7804, 'Programada')$q$, '078-26 anon: INSERT sin privilegio (090)', '42501');
  END IF;
END $do$;
ROLLBACK;
SELECT t78_assert(t78_huella() = (SELECT v FROM t78_ids WHERE k = 'h0'), '078-27 anon: cero efectos');

\echo '── 078: flujo legítimo completo del Chofer A sobre su ruta'
BEGIN; SET LOCAL ROLE authenticated; SELECT t78_actor('authenticated', 'chofera78@t', '78000000-0000-0000-0000-000000000004');
-- solicitarFirmaCarga (carga_real dentro de autorizado + extra: 50 + 10)
SELECT t78_assert(t78_rows($q$UPDATE rutas SET carga_real = '{"P78-HIELO": 60}', estatus = 'Pendiente firma', carga_solicitada_at = now() WHERE id = 7801$q$) = 1, '078-30 solicitar firma: Programada → Pendiente firma con carga_real ≤ autorizado + extra');
-- en espera: no puede cambiar la solicitud ni saltarse la firma
SELECT t78_err($q$UPDATE rutas SET carga_real = '{"P78-HIELO": 5}' WHERE id = 7801$q$, '078-31 en espera: no puede editar carga_real sin transición', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7801$q$, '078-32 en espera: Pendiente firma → En progreso rechazado (salta la firma)', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Programada' WHERE id = 7801$q$, '078-33 en espera: Pendiente firma → Programada rechazado', '42501');
SELECT t78_err($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7801, estatus = 'Cargada', firma_carga = 'x', firma_excepcion = false WHERE id = 7801 AND carga_confirmada_at IS NULL$q$, '078-34 firma atribuida a otro usuario rechazada', '42501');
SELECT t78_err($q$UPDATE rutas SET carga_confirmada_por = 7804, estatus = 'Cargada', firma_carga = 'x', firma_excepcion = false WHERE id = 7801$q$, '078-35 firma sin carga_confirmada_at rechazada', '42501');
SELECT t78_err($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7804, estatus = 'Cargada', firma_carga = 'x', firma_excepcion = false, carga_real = '{"P78-HIELO": 61}' WHERE id = 7801$q$, '078-36 firma + cambio de carga_real rechazada entera', '42501');
-- firmarCarga: antes de 085 = claim directo + RPC genérico + compensación; tras 085
-- (guard con app.carga_ctx y RPC genérico solo Admin) = únicamente confirmar_carga_ruta.
DO $do$ BEGIN
  IF pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.carga_ctx' THEN
    PERFORM t78_err($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7804, estatus = 'Cargada', firma_carga = 'data:image/png;base64,QQ==', firma_excepcion = false WHERE id = 7801 AND carga_confirmada_at IS NULL$q$, '078-37 (085) claim directo Pendiente firma → Cargada rechazado: solo confirmar_carga_ruta', '42501');
    PERFORM t78_err($q$SELECT update_stocks_atomic('[{"cuarto_id":"CF-78","sku":"P78-HIELO","delta":-60,"tipo":"Salida","origen":"Carga ruta R-7801"}]'::jsonb)$q$, '078-37b (085) Chofer sin RPC genérico', '42501');
    PERFORM confirmar_carga_ruta('78000000-0000-0000-0000-00000000c001', 7801, NULL, true, 'Producción sin celular');
    PERFORM t78_assert((SELECT estatus = 'Cargada' AND firma_excepcion AND carga_confirmada_por::text = '7804' FROM rutas WHERE id = 7801) AND (SELECT (stock ->> 'P78-HIELO')::int = 40 FROM cuartos_frios WHERE id = 'CF-78'), '078-40 (085) carga confirmada por contrato: Cargada, 100 → 40');
    PERFORM t78_err($q$UPDATE rutas SET carga_confirmada_at = NULL, carga_confirmada_por = NULL, firma_carga = NULL, firma_excepcion = false, firma_excepcion_motivo = NULL, estatus = 'Pendiente firma' WHERE id = 7801$q$, '078-38 (085) la compensación Cargada → Pendiente firma ya no existe', '42501');
  ELSE
    PERFORM t78_assert(t78_rows($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7804, estatus = 'Cargada', firma_carga = 'data:image/png;base64,QQ==', firma_excepcion = false WHERE id = 7801 AND carga_confirmada_at IS NULL$q$) = 1, '078-37 firmar carga: Pendiente firma → Cargada (claim)');
    PERFORM update_stocks_atomic('[{"cuarto_id":"CF-78","sku":"P78-HIELO","delta":-60,"tipo":"Salida","origen":"Carga ruta R-7801","usuario":"Chofer A78"}]'::jsonb);
    PERFORM t78_assert(t78_rows($q$UPDATE rutas SET carga_confirmada_at = NULL, carga_confirmada_por = NULL, firma_carga = NULL, firma_excepcion = false, firma_excepcion_motivo = NULL, estatus = 'Pendiente firma' WHERE id = 7801$q$) = 1, '078-38 compensación: Cargada → Pendiente firma limpiando la firma');
    PERFORM update_stocks_atomic('[{"cuarto_id":"CF-78","sku":"P78-HIELO","delta":60,"tipo":"Entrada","origen":"Reversión carga R-7801","usuario":"Chofer A78"}]'::jsonb);
    PERFORM t78_err($q$UPDATE rutas SET carga_confirmada_at = NULL, carga_confirmada_por = NULL, firma_carga = NULL, firma_excepcion = false, firma_excepcion_motivo = NULL, estatus = 'Pendiente firma', carga_real = '{"P78-HIELO": 1}' WHERE id = 7801$q$, '078-39 compensación con otras columnas rechazada', '42501');
    PERFORM t78_assert(t78_rows($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7804, estatus = 'Cargada', firma_excepcion = true, firma_excepcion_motivo = 'Producción sin celular', firma_carga = NULL WHERE id = 7801 AND carga_confirmada_at IS NULL$q$) = 1, '078-40 firmar por excepción: Pendiente firma → Cargada');
    PERFORM update_stocks_atomic('[{"cuarto_id":"CF-78","sku":"P78-HIELO","delta":-60,"tipo":"Salida","origen":"Carga ruta R-7801","usuario":"Chofer A78"}]'::jsonb);
  END IF;
END $do$;
SELECT t78_assert(t78_rows($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7804, estatus = 'Cargada', firma_carga = 'x', firma_excepcion = false WHERE id = 7801 AND carga_confirmada_at IS NULL$q$) = 0, '078-41 doble firma: el claim del cliente no encuentra fila');
SELECT t78_err($q$UPDATE rutas SET carga_confirmada_at = now(), firma_excepcion_motivo = 'otro' WHERE id = 7801$q$, '078-42 cargada: no puede reescribir la firma', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 7801$q$, '078-43 cargada: Cargada → Cerrada rechazado (salta En progreso)', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Programada' WHERE id = 7801$q$, '078-44 cargada: Cargada → Programada rechazado', '42501');
-- updateRutaEstatus('En progreso') — dos veces (doble tap): la segunda no cambia nada
SELECT t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7801$q$) = 1, '078-45 iniciar ruta: Cargada → En progreso');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7801$q$) = 1, '078-46 iniciar ruta repetido: sin cambios, inofensivo');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Completada' WHERE id = 7801$q$, '078-47 en ruta: En progreso → Completada rechazado', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Cancelada', cancelada_at = now(), motivo_cancelacion = 'x' WHERE id = 7801$q$, '078-48 en ruta: cancelación rechazada (solo Admin)', '42501');
SELECT t78_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE, total_cobrado = 1 WHERE id = 7801$q$, '078-49 cierre + total_cobrado rechazado entero', '42501');
-- cerrarRutaCompleta
DO $do$ BEGIN
  IF t_p087() THEN
    PERFORM t78_err($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 7801$q$, '078-50 (087) cierre directo del Chofer denegado: la ruta se cierra con finalizar_inventario_ruta', '42501');
    -- cierre canónico: sin entregas, devuelve las 60 cargadas
    PERFORM cerrar_ruta_financiero('78000000-0000-0000-0000-0000000f7801'::uuid, 7801, '[]'::jsonb, 7804, 'Chofer A78');
    PERFORM t78_assert((finalizar_inventario_ruta('78000000-0000-0000-0000-0000000c7801'::uuid, 7801, '{"P78-HIELO": 60}') ->> 'estatus') = 'Cerrada', '078-50b (087) cierre canónico del Chofer: finalizar_inventario_ruta');
    PERFORM t78_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7801$q$, '078-51 cerrada: reapertura rechazada', '42501');
    PERFORM t78_err($q$UPDATE rutas SET fecha_fin = CURRENT_DATE - 5 WHERE id = 7801$q$, '078-52 cerrada: fecha_fin inmutable', '42501');
  ELSE
    PERFORM t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 7801$q$) = 1, '078-50 cerrar ruta: En progreso → Cerrada con fecha_fin');
    PERFORM t78_err($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7801$q$, '078-51 cerrada: reapertura rechazada', '42501');
    PERFORM t78_err($q$UPDATE rutas SET fecha_fin = CURRENT_DATE - 5 WHERE id = 7801$q$, '078-52 cerrada: fecha_fin inmutable', '42501');
  END IF;
END $do$;
COMMIT;
SELECT t78_assert((SELECT estatus = 'Cerrada' AND (t_p087() OR fecha_fin::date = CURRENT_DATE) AND carga_real = '{"P78-HIELO": 60}'::jsonb AND carga_autorizada = '{"P78-HIELO": 50}'::jsonb AND extra_autorizado = '{"P78-HIELO": 10}'::jsonb
  AND carga_confirmada_por::text = '7804' AND firma_excepcion AND firma_carga IS NULL AND folio = 'R-7801' AND chofer_id = 7804 AND COALESCE(total_cobrado, 0) = 0 FROM rutas WHERE id = 7801), '078-53 ruta cerrada con exactamente los datos del flujo; columnas de Admin intactas');
SELECT t78_assert((SELECT (stock ->> 'P78-HIELO')::int = CASE WHEN t_p087() THEN 100 ELSE 40 END FROM cuartos_frios WHERE id = 'CF-78') AND (SELECT count(*) = CASE WHEN t_p087() THEN 2 WHEN pg_get_functiondef('public.rutas_guard_chofer()'::regprocedure) ~ 'app\.carga_ctx' THEN 1 ELSE 3 END FROM inventario_mov WHERE producto = 'P78-HIELO' AND usuario = 'Chofer A78'), '078-54 stock 40 con kardex atribuido al chofer real (3 filas antes de 085; 1 por contrato; 087: + devolución canónica de 60 → 100)');

\echo '── 078: Admin y contratos del servidor intactos'
BEGIN; SET LOCAL ROLE authenticated; SELECT t78_actor('authenticated', 'admin78@t', '78000000-0000-0000-0000-000000000001');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET carga_autorizada = '{"P78-HIELO": 25}', extra_autorizado = '{"P78-HIELO": 5}', nombre = 'Ruta B78 editada', camion_id = NULL, clientes_asignados = '[{"clienteId": 7810, "orden": 1}]' WHERE id = 7802$q$) = 1, '078-60 Admin: edita autorización, nombre, camión y clientes (updateRuta)');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET chofer_id = 7804, chofer_nombre = 'Chofer A78' WHERE id = 7803$q$) = 1, '078-61 Admin: asigna chofer a ruta sin chofer');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET chofer_id = NULL, chofer_nombre = NULL WHERE id = 7803$q$) = 1, '078-62 Admin: quita chofer');
SELECT asignar_ordenes_a_ruta(7803, ARRAY[7820]::bigint[]);
SELECT t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'En progreso' WHERE id = 7802$q$) = 1, '078-63 Admin: Programada → En progreso (Iniciar desde RutasView)');
DO $$ BEGIN IF NOT t_p087() THEN PERFORM cerrar_ruta_atomic(7802, '{"P78-HIELO": 3}'::jsonb, 'CF-78', '[]'::jsonb, 0, 0, 'Admin 78'); END IF; END $$;  -- 087: retirada
SELECT t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'Cancelada', cancelada_at = now(), motivo_cancelacion = 'Prueba 78' WHERE id = 7803$q$) = 1, '078-64 Admin: cancelación con metadatos');
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, carga, carga_autorizada, extra_autorizado, autorizado_at) VALUES (7806, 'R-7806', 'Ruta nueva 78', 7804, 'Chofer A78', 'Programada', '{"P78-HIELO": 2}', '{"P78-HIELO": 2}', '{}', now());
SELECT t78_assert(t78_rows($q$DELETE FROM rutas WHERE id = 7806$q$) = 1, '078-65 Admin: alta y baja de ruta');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET estatus = 'En progreso', fecha_fin = NULL WHERE id = 7804$q$) = 1, '078-66 Admin: reabre una ruta cerrada (decisión de Admin)');
COMMIT;
SELECT t78_assert(CASE WHEN t_p087() THEN to_regprocedure('public.cerrar_ruta_atomic(bigint,jsonb,text,jsonb,numeric,numeric,text)') IS NULL AND (SELECT estatus <> 'Cerrada' FROM rutas WHERE id = 7802) AND (SELECT (stock ->> 'P78-HIELO')::int = 100 FROM cuartos_frios WHERE id = 'CF-78') ELSE (SELECT estatus = 'Cerrada' AND cierre_at IS NOT NULL AND devolucion = '{"P78-HIELO": 3}'::jsonb FROM rutas WHERE id = 7802) AND (SELECT (stock ->> 'P78-HIELO')::int = 43 FROM cuartos_frios WHERE id = 'CF-78') END, '078-67 cerrar_ruta_atomic (Admin) sigue cerrando y devolviendo stock (087: cerrar_ruta_atomic retirada)');
SELECT t78_assert((SELECT carga = '{"P78-HIELO": 5}'::jsonb FROM rutas WHERE id = 7803) AND (SELECT estatus = 'Asignada' AND ruta_id = 7803 FROM ordenes WHERE id = 7820), '078-68 asignar_ordenes_a_ruta (Admin) recalcula carga');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET carga = '{"P78-HIELO": 7}', carga_autorizada = '{"P78-HIELO": 7}' WHERE id = 7803$q$) = 1, '078-69 SQL sin JWT (service_role/cron): sin restricción');

\echo '── 078: deuda documentada (sin cambios en esta fase)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t78_actor('authenticated', 'prod78@t', '78000000-0000-0000-0000-000000000002');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET carga_confirmada_at = now(), carga_confirmada_por = 7802, estatus = 'Cargada', firma_carga = 'x' WHERE id = 7805 AND carga_confirmada_at IS NULL$q$) = 0, '078-70 Producción no tiene policy de UPDATE en rutas: la firma desde BotonFirmasPendientes sigue sin efecto (D4, fuera de 078)');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t78_actor('authenticated', 'inadm78@t', '78000000-0000-0000-0000-000000000007');
SELECT t78_assert(t78_rows($q$UPDATE rutas SET nombre = nombre WHERE id = 7805$q$) = (CASE WHEN pg_get_functiondef('public.get_my_rol()'::regprocedure) ~ 'erp_rol_activo' THEN 0 ELSE 1 END), '078-71 Admin INACTIVO: escribe rutas vía admin_all con get_my_rol legacy (deuda B3) o 0 filas tras 079 (identidad canónica)');
ROLLBACK;

BEGIN;
DELETE FROM inventario_mov WHERE producto LIKE 'P78-%';
DELETE FROM movimientos_contables WHERE concepto LIKE '%R-78%';
DELETE FROM orden_lineas WHERE orden_id BETWEEN 7820 AND 7829;
DELETE FROM ordenes WHERE id BETWEEN 7820 AND 7829;
DO $$ BEGIN IF to_regclass('public.stock_operaciones') IS NOT NULL THEN DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 7801 AND 7899 OR operacion_id::text LIKE '78000000-%'; END IF; END $$;
DELETE FROM rutas WHERE id BETWEEN 7801 AND 7899;
DELETE FROM clientes WHERE id = 7810;
DELETE FROM cuartos_frios WHERE id = 'CF-78';
DELETE FROM productos WHERE sku LIKE 'P78-%';
DELETE FROM auditoria WHERE detalle LIKE '%R-78%';
DELETE FROM usuarios WHERE id BETWEEN 7801 AND 7809;
DELETE FROM auth.users WHERE id::text LIKE '78000000-%';
COMMIT;
\echo '── 078: TODAS LAS PRUEBAS OK'
