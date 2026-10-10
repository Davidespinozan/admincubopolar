-- 123_multisucursal_test.sql — MULTISUCURSAL: una principal por cliente (backfill y
-- sincronía), sucursales por contrato (Admin/Ventas), precio sucursal → cliente →
-- lista, orden con sucursal y dirección copiada, crédito por cadena, sucursal
-- inmutable por REST, fusión de clientes con historia reapuntada e idempotente.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t123_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM pagos WHERE cliente_id BETWEEN 12340 AND 12349 OR orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 12340 AND 12349);
  DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 12340 AND 12349;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 12340 AND 12349 OR id BETWEEN 12360 AND 12369);
  DELETE FROM ordenes WHERE cliente_id BETWEEN 12340 AND 12349 OR id BETWEEN 12360 AND 12369;
  DELETE FROM precios_esp WHERE cliente_id BETWEEN 12340 AND 12349;
  DELETE FROM comodatos WHERE cliente_id BETWEEN 12340 AND 12349;
  DELETE FROM sucursales WHERE cliente_id BETWEEN 12340 AND 12349 OR origen_cliente_id BETWEEN 12340 AND 12349;
  DELETE FROM bitacora_cambios WHERE tabla IN ('clientes', 'precios_esp') AND registro_id IN (SELECT id::text FROM clientes WHERE id BETWEEN 12340 AND 12349);
  DELETE FROM auditoria WHERE detalle LIKE '%123%' AND modulo = 'Clientes';
  DELETE FROM clientes WHERE id BETWEEN 12340 AND 12349;
  UPDATE cuartos_frios SET stock = stock - 'P123-A' - 'P123-B' WHERE stock ?| ARRAY['P123-A', 'P123-B'];
  DELETE FROM cuartos_frios WHERE id = 'CF-123';
  DELETE FROM productos WHERE sku LIKE 'P123-%';
  DELETE FROM usuarios WHERE id BETWEEN 12301 AND 12309;
  DELETE FROM auth.users WHERE id::text LIKE '12300000-%';
END $$;
BEGIN; SELECT t123_limpiar(); COMMIT;

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('12300000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t123' FROM generate_series(1, 5) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (12301, 'Admin 123',    'u1@t123', 'Admin',    'Activo', '12300000-0000-0000-0000-000000000001'),
  (12302, 'Ventas 123',   'u2@t123', 'Ventas',   'Activo', '12300000-0000-0000-0000-000000000002'),
  (12303, 'Chofer 123',   'u3@t123', 'Chofer',   'Activo', '12300000-0000-0000-0000-000000000003'),
  (12304, 'Empleado 123', 'u4@t123', 'Empleado', 'Activo', '12300000-0000-0000-0000-000000000004'),
  (12305, 'Prod 123',     'u5@t123', 'Producción', 'Activo', '12300000-0000-0000-0000-000000000005');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P123-A', 'Hielo A123', 'Producto Terminado', 30, 0, 0),
  ('P123-B', 'Hielo B123', 'Producto Terminado', 50, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-123', 'Cuarto 123', '{"P123-A": 1000, "P123-B": 1000}');
COMMIT;
-- Clientes con los disparadores activos (la sincronía crea la principal).
BEGIN;
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito, calle, numero_exterior, colonia, ciudad, estado, cp, latitud, longitud, zona, contacto) VALUES
  (12340, 'LEVIN 123',          'XAXX010101000', 0,  true,  100, 'Blvd Durango', '100', 'Centro',   'Durango', 'Durango', '34000', 24.0277, -104.6532, 'Centro', 'Gerente'),
  (12341, 'LEVIN JARDINES 123', 'XAXX010101000', 40, false, 0,   'Jardines',     '5',   'Jardines', 'Durango', 'Durango', '34200', 24.0400, -104.6600, 'Norte',  'Encargado'),
  (12342, 'Nominativo 123',     'NOM123010AB1',  0,  false, 0,   'Fiscal 1',     NULL,  'Fiscal',   'Durango', 'Durango', '34100', NULL,    NULL,      NULL,     NULL),
  (12343, 'Sin domicilio 123',  'XAXX010101000', 0,  false, 0,   NULL,           NULL,  NULL,       'Durango', 'Durango', '34000', NULL,    NULL,      NULL,     NULL),
  (12344, 'Inactivo 123',       'XAXX010101000', 0,  false, 0,   'Calle I',      NULL,  'Col I',    'Durango', 'Durango', '34000', NULL,    NULL,      NULL,     NULL);
UPDATE clientes SET estatus = 'Inactivo' WHERE id = 12344;
COMMIT;

CREATE OR REPLACE FUNCTION t123_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t123_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t123_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12300000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE TABLE IF NOT EXISTS t123_ids (k TEXT PRIMARY KEY, v TEXT);
CREATE OR REPLACE FUNCTION t123_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t123_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t123_suc(p_cli BIGINT, p_nombre TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT id FROM sucursales WHERE cliente_id = p_cli AND lower(nombre) = lower(p_nombre) $$;
GRANT EXECUTE ON FUNCTION t123_assert(BOOLEAN, TEXT), t123_err(TEXT, TEXT, TEXT, TEXT), t123_auth(INTEGER), t123_j(TEXT), t123_suc(BIGINT, TEXT) TO PUBLIC;
GRANT ALL ON t123_ids TO PUBLIC;
DELETE FROM t123_ids;

\echo '── 123: catálogo'
SELECT t123_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sucursales'::regclass)
  AND has_table_privilege('authenticated', 'public.sucursales', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.sucursales', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.sucursales', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.sucursales', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.sucursales', 'SELECT')
  AND NOT has_sequence_privilege('authenticated', 'public.sucursales_id_seq', 'USAGE')
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'sucursales') = 1,
  '123-00a sucursales: RLS, solo SELECT para authenticated (una policy de lectura), nada para anon');
SELECT t123_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                    FROM pg_proc p WHERE p.oid IN ('public.guardar_sucursal(bigint,bigint,jsonb)'::regprocedure, 'public.fusionar_cliente_en_sucursal(bigint,bigint,text)'::regprocedure, 'public.crear_orden(jsonb,jsonb)'::regprocedure))
  AND NOT has_function_privilege('authenticated', 'public.precio_canonico(bigint,bigint,text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.lineas_canonicas(bigint,bigint,jsonb)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sucursal_para_orden(bigint,bigint,text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sucursal_direccion_texto(sucursales)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sucursal_con_domicilio(sucursales)'::regprocedure, 'EXECUTE'),
  '123-00b contratos: SECURITY DEFINER, search_path fijo, authenticated sí, anon no; primitivas sin EXECUTE');
SELECT t123_assert((SELECT count(*) FROM pg_indexes WHERE indexname IN ('precios_esp_cliente_sku_key', 'precios_esp_sucursal_sku_key', 'sucursales_principal_key', 'sucursales_cliente_nombre_key')) = 4
  AND (SELECT count(*) FROM pg_constraint WHERE conname = 'precios_esp_cliente_sku_key') = 0,
  '123-00c índices únicos: precio por cliente (sin sucursal), precio por sucursal, una principal por cliente, nombre único por cliente');

\echo '── 123: principal por cliente (backfill y sincronía)'
SELECT t123_assert((SELECT count(*) FROM clientes c WHERE fusionado_en IS NULL AND NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.cliente_id = c.id AND s.es_principal)) = 0
  AND (SELECT count(*) FROM clientes c WHERE (SELECT count(*) FROM sucursales s WHERE s.cliente_id = c.id AND s.es_principal) > 1) = 0,
  '123-01a todo cliente (no fusionado) tiene exactamente una sucursal principal');
SELECT t123_assert((SELECT nombre = 'Principal' AND calle = 'Blvd Durango' AND numero_exterior = '100' AND colonia = 'Centro' AND ciudad = 'Durango'
                           AND codigo_postal = '34000' AND latitud = 24.0277 AND longitud = -104.6532 AND zona = 'Centro' AND contacto = 'Gerente'
                           AND sucursal_direccion_texto(s) = 'Blvd Durango 100, Centro, Durango, Durango, C.P. 34000' AND sucursal_con_domicilio(s)
                      FROM sucursales s WHERE cliente_id = 12340 AND es_principal),
  '123-01b la principal copia el domicilio del cliente (cp legado → codigo_postal) y se formatea como el frontend');
SELECT t123_assert((SELECT ciudad IS NULL AND codigo_postal IS NULL AND NOT sucursal_con_domicilio(s) AND sucursal_direccion_texto(s) IS NULL
                      FROM sucursales s WHERE cliente_id = 12343 AND es_principal),
  '123-01c cliente sin calle ni colonia: principal sin domicilio (no se copia "Durango, C.P. 34000" a las órdenes)');
BEGIN; UPDATE clientes SET calle = 'Blvd Durango Nuevo', latitud = 24.1, longitud = -104.7 WHERE id = 12340; COMMIT;
SELECT t123_assert((SELECT calle = 'Blvd Durango Nuevo' AND latitud = 24.1 FROM sucursales WHERE cliente_id = 12340 AND es_principal),
  '123-01d editar el domicilio del cliente actualiza su principal (sentido clientes → principal)');
BEGIN; INSERT INTO clientes (id, nombre, rfc, calle, colonia) VALUES (12345, 'Nuevo 123', 'XAXX010101000', 'Calle N', 'Col N'); COMMIT;
SELECT t123_assert((SELECT count(*) = 1 AND bool_and(es_principal AND calle = 'Calle N') FROM sucursales WHERE cliente_id = 12345),
  '123-01e un cliente nuevo nace con su principal');

\echo '── 123: borrar un cliente (125)'
BEGIN; INSERT INTO clientes (id, nombre, rfc, calle, colonia) VALUES (12347, 'Borrable 123', 'XAXX010101000', 'B', 'B'); COMMIT;
SELECT t123_assert((SELECT count(*) FROM sucursales WHERE cliente_id = 12347) = 1, '123-01f el cliente nuevo tiene su principal antes de borrarlo');
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(1);
DELETE FROM clientes WHERE id = 12347;
COMMIT;
SELECT t123_assert(NOT EXISTS (SELECT 1 FROM clientes WHERE id = 12347) AND NOT EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = 12347),
  '123-01g (125) Admin borra un cliente sin historia y su principal se va con él (antes: 23503 siempre)');

\echo '── 123: guardar_sucursal'
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
INSERT INTO t123_ids VALUES ('jar', guardar_sucursal(NULL, 12340, '{"nombre":"Jardines","calle":"Av. Jardines","numero_exterior":"12","colonia":"Jardines","ciudad":"Durango","estado":"Durango","codigo_postal":"34200","latitud":"24.05","longitud":"-104.66","zona":"Norte","contacto":"Enc. Jardines","telefono":"6181234567","referencia":"Frente al parque"}')::text);
SELECT t123_assert((t123_j('jar') ->> 'direccion') = 'Av. Jardines 12, Jardines, Durango, Durango, C.P. 34200' AND (t123_j('jar') ->> 'es_principal') = 'false'
  AND (t123_j('jar') ->> 'estatus') = 'Activa' AND (SELECT telefono = '6181234567' AND referencia = 'Frente al parque' FROM sucursales WHERE id = (t123_j('jar') ->> 'id')::bigint),
  '123-02a Ventas crea una sucursal con domicilio, coordenadas, zona, contacto y referencia');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"nombre":" jardines "}')$q$, '123-02b nombre repetido en el mismo cliente (sin distinguir mayúsculas) rechazado', '23505');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"calle":"X"}')$q$, '123-02c sin nombre rechazado', '22023');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12399, '{"nombre":"X"}')$q$, '123-02d cliente inexistente rechazado', '22023');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"nombre":"Coord","latitud":"24.0"}')$q$, '123-02e coordenadas a medias rechazadas', '22023');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"nombre":"Coord","latitud":"95","longitud":"0"}')$q$, '123-02f latitud fuera de rango rechazada', '22023');
SELECT t123_err(format($q$SELECT guardar_sucursal(%s, 12340, '{"estatus":"Inactiva"}')$q$, t123_suc(12340, 'Principal')), '123-02g la principal no se desactiva', '22023');
SELECT t123_err(format($q$SELECT guardar_sucursal(%s, 12341, '{"nombre":"Robada"}')$q$, t123_j('jar') ->> 'id'), '123-02h editar una sucursal con otro cliente rechazado', '22023');
-- (la llamada y la lectura van en sentencias distintas: una misma sentencia leería la instantánea previa)
INSERT INTO t123_ids VALUES ('pri', guardar_sucursal(t123_suc(12340, 'Principal'), 12340, '{"nombre":"Matriz","telefono":"618000"}')::text);
SELECT t123_assert((t123_j('pri') ->> 'nombre') = 'Matriz'
  AND (SELECT calle = 'Blvd Durango Nuevo' AND telefono = '618000' FROM sucursales WHERE cliente_id = 12340 AND es_principal),
  '123-02i la principal acepta nombre y teléfono; su domicilio sigue siendo el del cliente');
INSERT INTO t123_ids VALUES ('jar2', guardar_sucursal((t123_j('jar') ->> 'id')::bigint, 12340, '{"colonia":"Jardines Norte","latitud":"","longitud":""}')::text);
SELECT t123_assert((t123_j('jar2') ->> 'direccion') = 'Av. Jardines 12, Jardines Norte, Durango, Durango, C.P. 34200'
  AND (SELECT latitud IS NULL AND longitud IS NULL AND zona = 'Norte' FROM sucursales WHERE id = (t123_j('jar') ->> 'id')::bigint),
  '123-02j edición parcial: solo cambian los campos enviados (coordenadas vacías → NULL; zona intacta)');
SELECT t123_assert((guardar_sucursal((t123_j('jar') ->> 'id')::bigint, 12340, '{"latitud":"24.05","longitud":"-104.66"}') ->> 'latitud')::numeric = 24.05, '123-02k coordenadas restauradas');
INSERT INTO t123_ids VALUES ('sur', guardar_sucursal(NULL, 12340, '{"nombre":"Sur","calle":"Sur 1","colonia":"Sur"}')::text);
SELECT t123_assert((guardar_sucursal((t123_j('sur') ->> 'id')::bigint, 12340, '{"estatus":"Inactiva"}') ->> 'estatus') = 'Inactiva', '123-02l una sucursal no principal se desactiva');
SELECT t123_err($q$INSERT INTO sucursales (cliente_id, nombre) VALUES (12340, 'REST')$q$, '123-02n INSERT REST en sucursales denegado', '42501');
SELECT t123_err(format($q$UPDATE sucursales SET nombre = 'REST' WHERE id = %s$q$, t123_j('jar') ->> 'id'), '123-02o UPDATE REST denegado', '42501');
SELECT t123_err(format($q$DELETE FROM sucursales WHERE id = %s$q$, t123_j('jar') ->> 'id'), '123-02p DELETE REST denegado', '42501');
-- Transacción nueva: fin_marcar_ctx() de los contratos anteriores es local a la transacción (en PostgREST cada RPC es una).
COMMIT; BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(3);
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"nombre":"Chofer"}')$q$, '123-02q Chofer no crea sucursales', '42501');
SELECT t123_assert((SELECT count(*) FROM sucursales WHERE cliente_id = 12340) = 3, '123-02r Chofer lee sucursales (lector de negocio)');
SELECT t123_auth(4);
SELECT t123_assert((SELECT count(*) FROM sucursales) = 0, '123-02s Empleado no lee sucursales');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12340, '{"nombre":"Emp"}')$q$, '123-02t Empleado no crea sucursales', '42501');
COMMIT;
-- (fuera del bloque: auditoria solo la lee Admin)
SELECT t123_assert((SELECT count(*) FROM auditoria WHERE modulo = 'Clientes' AND accion IN ('Crear sucursal', 'Editar sucursal') AND usuario = 'Ventas 123' AND detalle LIKE 'LEVIN 123 · %') >= 5,
  '123-02m cada alta/edición deja auditoría con el actor del servidor');

\echo '── 123: precio por sucursal → cliente → lista'
BEGIN;
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (12340, 'P123-A', 25.5);
INSERT INTO precios_esp (cliente_id, sucursal_id, sku, precio) VALUES (12340, t123_suc(12340, 'Jardines'), 'P123-A', 22);
COMMIT;
SELECT t123_assert(precio_canonico(12340, t123_suc(12340, 'Jardines'), 'P123-A') = 22
  AND precio_canonico(12340, t123_suc(12340, 'Matriz'), 'P123-A') = 25.5
  AND precio_canonico(12340, NULL, 'P123-A') = 25.5 AND precio_canonico(12340, 'P123-A') = 25.5
  AND precio_canonico(12340, t123_suc(12340, 'Jardines'), 'P123-B') = 50
  AND precio_canonico(12343, t123_suc(12343, 'Principal'), 'P123-A') = 30
  AND precio_canonico(NULL, NULL, 'P123-A') = 30 AND precio_canonico(12340, t123_suc(12340, 'Jardines'), 'P123-ZZ') IS NULL,
  '123-03a precio: sucursal (22) → cliente (25.50) → lista (50/30); la firma de 088 = sin sucursal; SKU inexistente → NULL');
SELECT t123_err($q$INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (12340, 'P123-A', 1)$q$, '123-03b segundo precio de cliente para el mismo SKU rechazado', '23505');
SELECT t123_err(format($q$INSERT INTO precios_esp (cliente_id, sucursal_id, sku, precio) VALUES (12340, %s, 'P123-A', 1)$q$, t123_suc(12340, 'Jardines')), '123-03c segundo precio de la misma sucursal y SKU rechazado', '23505');
SELECT t123_err(format($q$INSERT INTO precios_esp (cliente_id, sucursal_id, sku, precio) VALUES (12341, %s, 'P123-A', 1)$q$, t123_suc(12340, 'Jardines')), '123-03d precio con sucursal de otro cliente rechazado', '22023');
SELECT t123_assert((SELECT (lineas_canonicas(12340, t123_suc(12340, 'Jardines'), '[{"sku":"P123-A","cantidad":2},{"sku":"P123-B","cantidad":1}]') ->> 'total')::numeric) = 94
  AND (SELECT (lineas_canonicas(12340, '[{"sku":"P123-A","cantidad":2}]') ->> 'total')::numeric) = 51,
  '123-03e líneas canónicas: con sucursal 2×22 + 50 = 94; firma de 088 2×25.50 = 51');

\echo '── 123: crear_orden con sucursal'
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
INSERT INTO t123_ids VALUES ('o1', crear_orden(format('{"cliente_id": 12340, "sucursal_id": %s}', t123_suc(12340, 'Jardines'))::jsonb, '[{"sku":"P123-A","cantidad":2}]')::text);
SELECT t123_assert((t123_j('o1') ->> 'sucursal_id')::bigint = t123_suc(12340, 'Jardines') AND (t123_j('o1') ->> 'total')::numeric = 44
  AND (t123_j('o1') ->> 'direccion_entrega') = 'Av. Jardines 12, Jardines Norte, Durango, Durango, C.P. 34200'
  AND (t123_j('o1') ->> 'latitud_entrega')::numeric = 24.05 AND (t123_j('o1') ->> 'longitud_entrega')::numeric = -104.66
  AND (t123_j('o1') ->> 'cliente_nombre') = 'LEVIN 123',
  '123-04a orden en Jardines: precio de la sucursal (2×22), dirección y coordenadas copiadas de la sucursal, nombre del cliente');
INSERT INTO t123_ids VALUES ('o2', crear_orden('{"cliente_id": 12340}', '[{"sku":"P123-A","cantidad":1}]')::text);
SELECT t123_assert((t123_j('o2') ->> 'sucursal_id')::bigint = t123_suc(12340, 'Matriz') AND (t123_j('o2') ->> 'total')::numeric = 25.5
  AND (t123_j('o2') ->> 'direccion_entrega') = 'Blvd Durango Nuevo 100, Centro, Durango, Durango, C.P. 34000' AND (t123_j('o2') ->> 'latitud_entrega')::numeric = 24.1,
  '123-04b sin sucursal: la principal (precio del cliente 25.50, domicilio del cliente copiado)');
INSERT INTO t123_ids VALUES ('o3', crear_orden(format('{"cliente_id": 12340, "sucursal_id": %s, "direccion_entrega": "Entrega especial 7", "latitud_entrega": "24.2", "longitud_entrega": "-104.8"}', t123_suc(12340, 'Jardines'))::jsonb, '[{"sku":"P123-A","cantidad":1}]')::text);
SELECT t123_assert((t123_j('o3') ->> 'direccion_entrega') = 'Entrega especial 7' AND (t123_j('o3') ->> 'latitud_entrega')::numeric = 24.2 AND (t123_j('o3') ->> 'total')::numeric = 22,
  '123-04c dirección propia en el payload: se respeta (texto y coordenadas); el precio sigue siendo el de la sucursal');
INSERT INTO t123_ids VALUES ('o4', crear_orden('{"cliente_id": 12343}', '[{"sku":"P123-A","cantidad":1}]')::text);
SELECT t123_assert((t123_j('o4') ->> 'sucursal_id')::bigint = t123_suc(12343, 'Principal') AND (t123_j('o4') ->> 'direccion_entrega') IS NULL AND (t123_j('o4') ->> 'latitud_entrega') IS NULL,
  '123-04d cliente sin domicilio: sucursal principal, sin dirección copiada');
INSERT INTO t123_ids VALUES ('o5', crear_orden('{"cliente_nombre": "Mostrador"}', '[{"sku":"P123-A","cantidad":1}]')::text);
SELECT t123_assert((t123_j('o5') ->> 'sucursal_id') IS NULL AND (t123_j('o5') ->> 'total')::numeric = 30, '123-04e público en general: sin sucursal, precio de lista');
SELECT t123_err(format($q$SELECT crear_orden('{"cliente_id": 12341, "sucursal_id": %s}', '[{"sku":"P123-A","cantidad":1}]')$q$, t123_suc(12340, 'Jardines')), '123-04f sucursal de otro cliente rechazada', '22023', '%no pertenece%');
SELECT t123_err(format($q$SELECT crear_orden('{"cliente_id": 12340, "sucursal_id": %s}', '[{"sku":"P123-A","cantidad":1}]')$q$, t123_suc(12340, 'Sur')), '123-04g sucursal inactiva rechazada', '22023', '%inactiva%');
SELECT t123_err(format($q$SELECT crear_orden('{"sucursal_id": %s}', '[{"sku":"P123-A","cantidad":1}]')$q$, t123_suc(12340, 'Jardines')), '123-04h sucursal sin cliente rechazada', '22023');
SELECT t123_err($q$SELECT crear_orden('{"cliente_id": 12340, "sucursal_id": 999999999}', '[{"sku":"P123-A","cantidad":1}]')$q$, '123-04i sucursal inexistente rechazada', '22023');
COMMIT;
SELECT t123_assert((SELECT bool_and(precio_unit = 22) FROM orden_lineas WHERE orden_id = (t123_j('o1') ->> 'id')::bigint)
  AND (SELECT sucursal_id = t123_suc(12340, 'Jardines') FROM ordenes WHERE id = (t123_j('o1') ->> 'id')::bigint),
  '123-04j la orden y sus líneas quedaron con la sucursal y el precio de sucursal');

\echo '── 123: edición y sucursal inmutable por REST'
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
INSERT INTO t123_ids VALUES ('u1', update_orden_atomic((t123_j('o1') ->> 'id')::bigint, format('{"sucursal_id": %s}', t123_suc(12340, 'Matriz'))::jsonb, NULL)::text);
SELECT t123_assert((t123_j('u1') ->> 'total')::numeric = 51
  AND (SELECT sucursal_id = t123_suc(12340, 'Matriz') AND direccion_entrega = 'Blvd Durango Nuevo 100, Centro, Durango, Durango, C.P. 34000' AND latitud_entrega = 24.1
         FROM ordenes WHERE id = (t123_j('o1') ->> 'id')::bigint),
  '123-05a cambiar la sucursal reprecia (2×25.50) y copia el domicilio de la sucursal nueva');
INSERT INTO t123_ids VALUES ('u2', update_orden_atomic((t123_j('o1') ->> 'id')::bigint, format('{"sucursal_id": %s, "direccion_entrega": "Propia 9"}', t123_suc(12340, 'Jardines'))::jsonb, NULL)::text);
SELECT t123_assert((t123_j('u2') ->> 'total')::numeric = 44
  AND (SELECT direccion_entrega = 'Propia 9' FROM ordenes WHERE id = (t123_j('o1') ->> 'id')::bigint),
  '123-05b cambiar sucursal con dirección propia: se respeta la propia');
INSERT INTO t123_ids VALUES ('u3', update_orden_atomic((t123_j('o1') ->> 'id')::bigint, '{"referencia_entrega": "ref"}', NULL)::text);
SELECT t123_assert((t123_j('u3') ->> 'sucursal_id')::bigint = t123_suc(12340, 'Jardines')
  AND (SELECT direccion_entrega = 'Propia 9' FROM ordenes WHERE id = (t123_j('o1') ->> 'id')::bigint),
  '123-05c editar otro campo no toca sucursal ni dirección');
INSERT INTO t123_ids VALUES ('u4', update_orden_atomic((t123_j('o1') ->> 'id')::bigint, '{"cliente_id": 12343}', NULL)::text);
SELECT t123_assert((t123_j('u4') ->> 'sucursal_id')::bigint = t123_suc(12343, 'Principal')
  AND (SELECT total = 60 FROM ordenes WHERE id = (t123_j('o1') ->> 'id')::bigint),
  '123-05d (124) cambiar de cliente sin sucursal: principal del cliente nuevo y precio de lista (2×30)');
SELECT t123_err(format($q$SELECT update_orden_atomic(%s, '{"sucursal_id": %s}', NULL)$q$, t123_j('o1') ->> 'id', t123_suc(12340, 'Jardines')), '123-05e sucursal de otro cliente en edición rechazada', '22023');
-- Transacción nueva (sin el contexto de contrato de las ediciones anteriores).
COMMIT; BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
SELECT t123_err(format($q$UPDATE ordenes SET sucursal_id = %s WHERE id = %s$q$, t123_suc(12343, 'Principal'), t123_j('o5') ->> 'id'), '123-05f Ventas no cambia la sucursal por REST', '42501');
SELECT t123_auth(1);
SELECT t123_err(format($q$UPDATE ordenes SET sucursal_id = NULL WHERE id = %s$q$, t123_j('o1') ->> 'id'), '123-05g ni Admin', '42501');
COMMIT;

\echo '── 123: crédito por cadena'
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
INSERT INTO t123_ids VALUES ('c1', crear_orden(format('{"cliente_id": 12340, "sucursal_id": %s, "tipo_cobro": "Credito"}', t123_suc(12340, 'Jardines'))::jsonb, '[{"sku":"P123-A","cantidad":4}]')::text);
COMMIT;
-- La CxC se abre al entregar; la entrega sin ruta es otro contrato (109). Para consumir el crédito de la cadena, la orden se
-- marca Entregada como fixture (disparadores apagados) y la CxC se abre con el contrato de 088.
BEGIN; SET LOCAL session_replication_role = replica; UPDATE ordenes SET estatus = 'Entregada' WHERE id = (t123_j('c1') ->> 'id')::bigint; COMMIT;
INSERT INTO t123_ids VALUES ('cxc', crear_cxc_orden((t123_j('c1') ->> 'id')::bigint, 30)::text);
SELECT t123_assert(t123_j('cxc') IS NOT NULL AND (SELECT saldo = 88 FROM clientes WHERE id = 12340)
  AND (SELECT count(*) = 1 AND bool_and(cliente_id = 12340 AND saldo_pendiente = 88) FROM cuentas_por_cobrar WHERE orden_id = (t123_j('c1') ->> 'id')::bigint),
  '123-06a la CxC de una venta en Jardines (4×22 = 88) es del cliente LEVIN (saldo por cadena)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
SELECT t123_err(format($q$SELECT crear_orden('{"cliente_id": 12340, "sucursal_id": %s, "tipo_cobro": "Credito"}', '[{"sku":"P123-A","cantidad":1}]')$q$, t123_suc(12340, 'Matriz')),
  '123-06b otra sucursal de la misma cadena a crédito: el límite (100) ya está consumido por la cadena (88 + 25.50) → rechazada', '22023', '%Excede límite%');
SELECT t123_assert((crear_orden(format('{"cliente_id": 12340, "sucursal_id": %s}', t123_suc(12340, 'Matriz'))::jsonb, '[{"sku":"P123-A","cantidad":1}]') ->> 'tipo_cobro') = 'Contado',
  '123-06c la misma venta de contado sí pasa');
COMMIT;

\echo '── 123: fusionar un cliente como sucursal'
BEGIN;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, fecha) VALUES
  (12360, 'OV-12360', 12341, 'LEVIN JARDINES 123', '1×P123-A', 40, 'Entregada', 'Crédito', 'Credito', 12302, CURRENT_DATE),
  (12361, 'OV-12361', 12341, 'LEVIN JARDINES 123', '1×P123-A', 30, 'Entregada', 'Efectivo', 'Contado', 12302, CURRENT_DATE);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (12360, 'P123-A', 1, 40, 40), (12361, 'P123-A', 1, 30, 30);
INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, estatus, concepto)
  VALUES (12360, 12341, 12360, CURRENT_DATE, CURRENT_DATE + 30, 40, 0, 40, 'Pendiente', 'T123 CxC origen');
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, referencia, saldo_antes, saldo_despues, fecha) VALUES (12341, 12361, 30, 'Efectivo', 'T123-pago-origen', 0, 0, CURRENT_DATE);
INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (12341, 'P123-A', 20);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(2);
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12341, 12340, NULL)$q$, '123-07a Ventas no fusiona clientes', '42501');
SELECT t123_auth(1);
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12341, 12341, NULL)$q$, '123-07b origen = destino rechazado', '22023');
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12342, 12340, NULL)$q$, '123-07c RFC nominativo del origen distinto del destino: razones sociales distintas', '22023', '%RFC%');
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12345, 12344, NULL)$q$, '123-07d destino inactivo rechazado', '22023', '%inactivo%');
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12345, 12340, 'Jardines')$q$, '123-07e nombre de sucursal ya usado en el destino rechazado', '23505');
INSERT INTO t123_ids VALUES ('fus', fusionar_cliente_en_sucursal(12341, 12340, NULL)::text);
COMMIT;
SELECT t123_assert((t123_j('fus') ->> 'ok')::boolean AND NOT (t123_j('fus') ->> 'repetida')::boolean AND (t123_j('fus') ->> 'sucursal') = 'LEVIN JARDINES 123'
  AND (t123_j('fus') ->> 'ordenes')::int = 2 AND (t123_j('fus') ->> 'cxc')::int = 1 AND (t123_j('fus') ->> 'pagos')::int = 1 AND (t123_j('fus') ->> 'precios')::int = 1
  AND (t123_j('fus') ->> 'sucursales')::int = 0 AND (t123_j('fus') ->> 'saldo_sumado')::numeric = 40,
  '123-07f fusión: respuesta con la sucursal nueva y los conteos reapuntados (2 órdenes, 1 CxC, 1 pago, 1 precio, 0 sucursales adicionales, saldo 40)');
SELECT t123_assert((SELECT cliente_id = 12340 AND NOT es_principal AND origen_cliente_id = 12341 AND calle = 'Jardines' AND numero_exterior = '5' AND latitud = 24.04 AND zona = 'Norte'
                           AND contacto = 'Encargado' AND estatus = 'Activa'
                      FROM sucursales WHERE id = (t123_j('fus') ->> 'sucursal_id')::bigint)
  AND (SELECT count(*) FROM sucursales WHERE cliente_id = 12341) = 0,
  '123-07g la principal del origen es ahora una sucursal del destino con su domicilio, coordenadas y zona; el origen no conserva sucursales');
SELECT t123_assert((SELECT bool_and(cliente_id = 12340 AND sucursal_id = (t123_j('fus') ->> 'sucursal_id')::bigint AND cliente_nombre = 'LEVIN JARDINES 123') FROM ordenes WHERE id IN (12360, 12361))
  AND (SELECT total = 40 AND estatus = 'Entregada' FROM ordenes WHERE id = 12360)
  AND (SELECT cliente_id = 12340 AND saldo_pendiente = 40 FROM cuentas_por_cobrar WHERE id = 12360)
  AND (SELECT cliente_id = 12340 AND monto = 30 FROM pagos WHERE referencia = 'T123-pago-origen'),
  '123-07h órdenes, CxC y pago reapuntados al destino con la sucursal; montos, estatus y la foto del nombre intactos');
SELECT t123_assert((SELECT saldo = 128 AND estatus = 'Activo' AND fusionado_en IS NULL FROM clientes WHERE id = 12340)
  AND (SELECT saldo = 0 AND estatus = 'Inactivo' AND fusionado_en = 12340 FROM clientes WHERE id = 12341),
  '123-07i saldo por cadena: 88 + 40 = 128 en el destino; el origen queda en 0, Inactivo y marcado como fusionado');
SELECT t123_assert((SELECT count(*) = 1 AND bool_and(cliente_id = 12340 AND sucursal_id = (t123_j('fus') ->> 'sucursal_id')::bigint AND precio = 20) FROM precios_esp WHERE sku = 'P123-A' AND sucursal_id = (t123_j('fus') ->> 'sucursal_id')::bigint)
  AND precio_canonico(12340, (t123_j('fus') ->> 'sucursal_id')::bigint, 'P123-A') = 20 AND precio_canonico(12340, NULL, 'P123-A') = 25.5,
  '123-07j el precio de cliente del origen (20) es ahora precio de la sucursal; el precio de cadena (25.50) no cambia');
SELECT t123_assert((SELECT count(*) FROM auditoria WHERE modulo = 'Clientes' AND accion = 'Fusionar cliente' AND usuario = 'Admin 123' AND detalle LIKE 'LEVIN JARDINES 123 (#12341) → sucursal "LEVIN JARDINES 123"%') = 1,
  '123-07k la fusión deja auditoría con el actor del servidor');
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(1);
INSERT INTO t123_ids VALUES ('fusr', fusionar_cliente_en_sucursal(12341, 12340, 'Otro nombre')::text);
SELECT t123_assert((t123_j('fusr') ->> 'repetida')::boolean
  AND (t123_j('fusr') ->> 'sucursal_id')::bigint = (t123_j('fus') ->> 'sucursal_id')::bigint
  AND (SELECT saldo = 128 FROM clientes WHERE id = 12340),
  '123-07l reintento: misma sucursal, sin segundo efecto (el saldo no se suma dos veces)');
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12341, 12343, NULL)$q$, '123-07m un origen ya fusionado no se fusiona en otro destino', '22023', '%ya fue fusionado%');
SELECT t123_err($q$SELECT fusionar_cliente_en_sucursal(12343, 12341, NULL)$q$, '123-07n un cliente fusionado no sirve de destino', '22023', '%fue fusionado%');
SELECT t123_err($q$SELECT guardar_sucursal(NULL, 12341, '{"nombre":"X"}')$q$, '123-07o ni recibe sucursales nuevas', '22023', '%fusionado%');
SELECT t123_err($q$SELECT crear_orden('{"cliente_id": 12341}', '[{"sku":"P123-A","cantidad":1}]')$q$, '123-07p ni ventas nuevas (vende al destino)', '22023', '%fusionado%');
SELECT t123_err(format($q$SELECT update_orden_atomic(%s, '{"cliente_id": 12341}', NULL)$q$, t123_j('o5') ->> 'id'), '123-07q ni se le reasigna una orden', '22023', '%fusionado%');
SELECT t123_assert((crear_orden(format('{"cliente_id": 12340, "sucursal_id": %s}', t123_j('fus') ->> 'sucursal_id')::jsonb, '[{"sku":"P123-A","cantidad":1}]') ->> 'total')::numeric = 20,
  '123-07r vender al destino en la sucursal fusionada usa el precio heredado (20) y su domicilio');
COMMIT;
BEGIN; UPDATE clientes SET calle = 'Ya no' WHERE id = 12341; COMMIT;
SELECT t123_assert((SELECT count(*) FROM sucursales WHERE cliente_id = 12341) = 0, '123-07s editar el domicilio de un cliente fusionado no le crea otra principal');
-- Fusión de un cliente con sucursales propias y un nombre repetido en el destino.
BEGIN; SET LOCAL ROLE authenticated; SELECT t123_auth(1);
INSERT INTO clientes (id, nombre, rfc, calle, colonia) VALUES (12346, 'VENEGAS CENTRO 123', 'XAXX010101000', 'Centro 1', 'Centro');
SELECT guardar_sucursal(NULL, 12346, '{"nombre":"Jardines","calle":"Jardines V","colonia":"Jardines"}');
INSERT INTO t123_ids VALUES ('fus2', fusionar_cliente_en_sucursal(12346, 12340, NULL)::text);
COMMIT;
SELECT t123_assert((t123_j('fus2') ->> 'sucursales')::int = 1
  AND (SELECT count(*) FROM sucursales WHERE cliente_id = 12340 AND origen_cliente_id = 12346 AND nombre IN ('VENEGAS CENTRO 123', 'VENEGAS CENTRO 123 · Jardines')) = 2
  AND (SELECT count(*) FROM sucursales WHERE cliente_id = 12340 AND lower(nombre) = 'jardines') = 1,
  '123-07t un origen con sucursales propias las lleva al destino (1 adicional en la respuesta); el nombre repetido ("Jardines") se prefija con el origen');

BEGIN; SELECT t123_limpiar(); COMMIT;
DROP TABLE t123_ids;
DROP FUNCTION t123_limpiar(); DROP FUNCTION t123_assert(BOOLEAN, TEXT); DROP FUNCTION t123_err(TEXT, TEXT, TEXT, TEXT); DROP FUNCTION t123_auth(INTEGER);
DROP FUNCTION t123_j(TEXT); DROP FUNCTION t123_suc(BIGINT, TEXT);
\echo '── 123: PASS'
