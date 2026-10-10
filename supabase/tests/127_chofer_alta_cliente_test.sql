-- 127_chofer_alta_cliente_test.sql — el Chofer registra un cliente con datos fiscales por
-- `crear_cliente_chofer`: solo Chofer, validación fiscal, sin crédito, idempotente por RFC,
-- auditado, y sin abrir escritura REST de `clientes` para el Chofer.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t127_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM sucursales WHERE cliente_id IN (SELECT id FROM clientes WHERE rfc LIKE 'TTT127%' OR nombre LIKE '%T127%');
  DELETE FROM bitacora_cambios WHERE tabla = 'clientes' AND registro_id IN (SELECT id::text FROM clientes WHERE rfc LIKE 'TTT127%' OR nombre LIKE '%T127%');
  DELETE FROM clientes WHERE rfc LIKE 'TTT127%' OR nombre LIKE '%T127%';
  DELETE FROM auditoria WHERE accion = 'Crear cliente (chofer)' AND detalle LIKE '%T127%';
  DELETE FROM usuarios WHERE id BETWEEN 12701 AND 12709;
  DELETE FROM auth.users WHERE id::text LIKE '12700000-%';
END $$;
BEGIN; SELECT t127_limpiar(); COMMIT;

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('12700000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t127' FROM generate_series(1, 4) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (12701, 'Chofer 127',   'u1@t127', 'Chofer',   'Activo', '12700000-0000-0000-0000-000000000001'),
  (12702, 'Ventas 127',   'u2@t127', 'Ventas',   'Activo', '12700000-0000-0000-0000-000000000002'),
  (12703, 'Empleado 127', 'u3@t127', 'Empleado', 'Activo', '12700000-0000-0000-0000-000000000003'),
  (12704, 'Chofer baja 127', 'u4@t127', 'Chofer', 'Inactivo', '12700000-0000-0000-0000-000000000004');
COMMIT;

CREATE OR REPLACE FUNCTION t127_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t127_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t127_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12700000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE TABLE IF NOT EXISTS t127_ids (k TEXT PRIMARY KEY, v TEXT);
CREATE OR REPLACE FUNCTION t127_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t127_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t127_assert(BOOLEAN, TEXT), t127_err(TEXT, TEXT, TEXT, TEXT), t127_auth(INTEGER), t127_j(TEXT) TO PUBLIC;
GRANT ALL ON t127_ids TO PUBLIC;
DELETE FROM t127_ids;

\echo '── 127: catálogo'
SELECT t127_assert((SELECT p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      FROM pg_proc p WHERE p.oid = 'public.crear_cliente_chofer(jsonb)'::regprocedure),
  '127-01 crear_cliente_chofer: SECURITY DEFINER, search_path fijo, authenticated sí, anon no');

\echo '── 127: alta por el Chofer'
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(1);
INSERT INTO t127_ids VALUES ('a', crear_cliente_chofer('{"nombre":" Cliente T127 ","rfc":"ttt127010ab1","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"fact@t127.mx","contacto":"Ana"}')::text);
COMMIT;
SELECT t127_assert((t127_j('a') ->> 'existente') = 'false' AND (t127_j('a') ->> 'rfc') = 'TTT127010AB1' AND (t127_j('a') ->> 'nombre') = 'Cliente T127',
  '127-02a el Chofer registra el cliente (nombre sin espacios, RFC en mayúsculas)');
SELECT t127_assert((SELECT estatus = 'Activo' AND saldo = 0 AND NOT credito_autorizado AND limite_credito = 0 AND regimen = '601' AND uso_cfdi = 'G03'
                           AND cp = '34000' AND correo = 'fact@t127.mx' AND contacto = 'Ana'
                      FROM clientes WHERE id = (t127_j('a') ->> 'id')::bigint),
  '127-02b nace Activo, sin saldo ni crédito, con sus datos fiscales');
SELECT t127_assert((SELECT count(*) FROM sucursales WHERE cliente_id = (t127_j('a') ->> 'id')::bigint AND es_principal) = 1,
  '127-02c el cliente tiene su sucursal principal (sincronía de 123)');
SELECT t127_assert((SELECT count(*) FROM auditoria WHERE accion = 'Crear cliente (chofer)' AND modulo = 'Clientes' AND detalle LIKE '%T127%') = 1,
  '127-02d queda rastro en auditoría');

\echo '── 127: idempotencia por RFC'
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(1);
INSERT INTO t127_ids VALUES ('b', crear_cliente_chofer('{"nombre":"Otro nombre T127","rfc":"TTT127010AB1","regimen":"612","uso_cfdi":"S01","cp":"34100","correo":"otro@t127.mx"}')::text);
COMMIT;
SELECT t127_assert((t127_j('b') ->> 'existente') = 'true' AND (t127_j('b') ->> 'id') = (t127_j('a') ->> 'id'),
  '127-03a el mismo RFC devuelve el cliente existente');
SELECT t127_assert((SELECT count(*) = 1 AND bool_and(nombre = 'Cliente T127' AND regimen = '601' AND cp = '34000') FROM clientes WHERE rfc = 'TTT127010AB1'),
  '127-03b no se crea otro cliente ni se modifican los datos del existente');
SELECT t127_assert((SELECT count(*) FROM auditoria WHERE accion = 'Crear cliente (chofer)' AND detalle LIKE '%T127%') = 1,
  '127-03c el reintento no duplica la auditoría');

\echo '── 127: validaciones'
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(1);
SELECT t127_err($q$SELECT crear_cliente_chofer('{"rfc":"TTT127010AB2","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-04a sin nombre', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"XAXX010101000","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-04b RFC genérico rechazado', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"ABC","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-04c RFC mal formado', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"TTT127010AB3","regimen":"Sin obligaciones","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-04d régimen que no es código SAT', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"TTT127010AB3","regimen":"601","uso_cfdi":"","cp":"34000","correo":"a@b.mx"}')$q$, '127-04e sin uso de CFDI', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"TTT127010AB3","regimen":"601","uso_cfdi":"G03","cp":"340","correo":"a@b.mx"}')$q$, '127-04f código postal inválido', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"X T127","rfc":"TTT127010AB3","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"sin-arroba"}')$q$, '127-04g correo inválido', '22023');
SELECT t127_err($q$SELECT crear_cliente_chofer(NULL)$q$, '127-04h sin datos', '22023');
ROLLBACK;
SELECT t127_assert((SELECT count(*) FROM clientes WHERE rfc LIKE 'TTT127%') = 1, '127-04i ninguna validación fallida dejó un cliente');

\echo '── 127: quién puede'
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(2);
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"V T127","rfc":"TTT127010AB4","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-05a Ventas no usa el contrato del Chofer', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(3);
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"E T127","rfc":"TTT127010AB4","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-05b el Empleado no puede', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(4);
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"B T127","rfc":"TTT127010AB4","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-05c un Chofer inactivo no puede', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t127_err($q$SELECT crear_cliente_chofer('{"nombre":"A T127","rfc":"TTT127010AB4","regimen":"601","uso_cfdi":"G03","cp":"34000","correo":"a@b.mx"}')$q$, '127-05d anon sin acceso', '42501');
ROLLBACK;

\echo '── 127: el Chofer sigue sin escritura REST en clientes'
BEGIN; SET LOCAL ROLE authenticated; SELECT t127_auth(1);
SELECT t127_err($q$INSERT INTO clientes (nombre, rfc) VALUES ('REST T127', 'TTT127010AB5')$q$, '127-06a INSERT directo del Chofer rechazado', '42501|P0001');
-- 127-06b: el UPDATE directo del Chofer no da error (RLS lo deja en 0 filas); 127-06c comprueba que nada cambió.
UPDATE clientes SET nombre = 'Cambiado T127' WHERE rfc = 'TTT127010AB1';
ROLLBACK;
SELECT t127_assert((SELECT nombre = 'Cliente T127' FROM clientes WHERE rfc = 'TTT127010AB1'), '127-06b/c el UPDATE directo del Chofer no cambió nada: el cliente conserva su nombre');

BEGIN; SELECT t127_limpiar(); COMMIT;
DROP TABLE t127_ids;
DROP FUNCTION t127_limpiar(); DROP FUNCTION t127_assert(BOOLEAN, TEXT); DROP FUNCTION t127_err(TEXT, TEXT, TEXT, TEXT); DROP FUNCTION t127_auth(INTEGER); DROP FUNCTION t127_j(TEXT);
\echo '── 127: PASS'
