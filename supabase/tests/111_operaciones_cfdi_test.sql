-- 111_operaciones_cfdi_test.sql — OL-03B: operaciones CFDI (reserva, una activa
-- por orden, finalización, lease → incierta, conciliación, generaciones).
-- No hay proveedor: los resultados del proveedor se simulan con finalizar_*.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t111_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11101 AND 11139;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 11101 AND 11139;
  DELETE FROM ordenes WHERE id BETWEEN 11101 AND 11139;
  DELETE FROM clientes WHERE id = 11101;
  DELETE FROM usuarios WHERE id BETWEEN 11101 AND 11109;
  DELETE FROM auth.users WHERE id::text LIKE '11100000-0000-0000-0000-0000000000%';
END $$;

BEGIN; SELECT t111_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('11100000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t111' FROM generate_series(1, 6) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (11101, 'Admin 111',  'u1@t111', 'Admin',       'Activo',   '11100000-0000-0000-0000-000000000001'),
  (11102, 'Ventas A',   'u2@t111', 'Ventas',      'Activo',   '11100000-0000-0000-0000-000000000002'),
  (11103, 'Ventas B',   'u3@t111', 'Ventas',      'Activo',   '11100000-0000-0000-0000-000000000003'),
  (11104, 'Chofer 111', 'u4@t111', 'Chofer',      'Activo',   '11100000-0000-0000-0000-000000000004'),
  (11105, 'Fact 111',   'u5@t111', 'Facturación', 'Activo',   '11100000-0000-0000-0000-000000000005'),
  (11106, 'Ventas baja','u6@t111', 'Ventas',      'Inactivo', '11100000-0000-0000-0000-000000000006');
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11101, 'Cliente 111', 'XAXX010101000', 0, true, 1000);
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id, facturama_id, facturama_uuid, cfdi_cancelado_at) VALUES
  (11101, 'OV-11101', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11102, 'OV-11102', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Crédito (fiado)', 'Credito', 11102, NULL, NULL, NULL, NULL),
  (11103, 'OV-11103', 11101, 'Cliente 111', 'x', 40, 'Creada',       'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11104, 'OV-11104', 11101, 'Cliente 111', 'x', 40, 'Asignada',     'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11105, 'OV-11105', 11101, 'Cliente 111', 'x', 40, 'En ruta',      'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11106, 'OV-11106', 11101, 'Cliente 111', 'x', 40, 'Cancelada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11107, 'OV-11107', 11101, 'Cliente 111', 'x', 40, 'No entregada', 'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11108, 'OV-11108', 11101, 'Cliente 111', 'x', 40, 'Facturada',    'Efectivo',        'Contado', 11102, NULL, 'FM-11108', 'UUID-11108', NULL),
  (11109, 'OV-11109', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11103, NULL, NULL, NULL, NULL),
  (11110, 'OV-11110', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', NULL,  NULL, NULL, NULL, NULL),
  (11111, 'OV-11111', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11112, 'OV-11112', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11113, 'OV-11113', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11114, 'OV-11114', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, NULL, NULL, NULL),
  (11115, 'OV-11115', 11101, 'Cliente 111', 'x', 40, 'Entregada',    'Efectivo',        'Contado', 11102, NULL, 'FM-OLD', 'UUID-OLD', now());
COMMIT;

CREATE OR REPLACE FUNCTION t111_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t111_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 110);
END $$;
CREATE OR REPLACE FUNCTION t111_srv() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
CREATE OR REPLACE FUNCTION t111_auth(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '11100000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true); END $$;
CREATE OR REPLACE FUNCTION t111_ord(p_id BIGINT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT estatus || '|' || COALESCE(facturama_uuid, '-') || '|' || CASE WHEN cfdi_cancelado_at IS NULL THEN 'vigente' ELSE 'cancelado' END FROM ordenes WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t111_op(p_id UUID) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT tipo || '|' || generacion || '|' || estado FROM cfdi_operaciones WHERE id = p_id $$;
CREATE TABLE IF NOT EXISTS t111_ids (k TEXT PRIMARY KEY, v UUID);
GRANT EXECUTE ON FUNCTION t111_assert(BOOLEAN, TEXT), t111_err(TEXT, TEXT, TEXT, TEXT), t111_srv(), t111_auth(INTEGER), t111_ord(BIGINT), t111_op(UUID) TO PUBLIC;
GRANT ALL ON t111_ids TO PUBLIC;
TRUNCATE t111_ids;

\echo '── 111: superficie de seguridad'
SELECT t111_assert((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                      AND NOT has_function_privilege('public', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                     AND p.proname IN ('reservar_operacion_cfdi', 'finalizar_operacion_cfdi', 'conciliar_operacion_cfdi', 'vencer_operaciones_cfdi', 'cfdi_aplicar_resultado'))
  AND has_function_privilege('service_role', 'public.reservar_operacion_cfdi(bigint,text,bigint,text,text,text,integer)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finalizar_operacion_cfdi(uuid,text,jsonb)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('service_role', 'public.conciliar_operacion_cfdi(uuid,text,jsonb,bigint)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.cfdi_aplicar_resultado(uuid,text,jsonb)'::regprocedure, 'EXECUTE'),
  '111-00 contratos SECURITY DEFINER con search_path fijo; EXECUTE solo service_role; el aplicador interno no se expone');
SELECT t111_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cfdi_operaciones'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.cfdi_operaciones', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.cfdi_operaciones', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.cfdi_operaciones', 'INSERT') AND NOT has_table_privilege('service_role', 'public.cfdi_operaciones', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.cfdi_operaciones', 'DELETE') AND NOT has_table_privilege('anon', 'public.cfdi_operaciones', 'SELECT'),
  '111-01 cfdi_operaciones: RLS; nadie la escribe directamente (ni service role); anon no lee');
BEGIN; SET LOCAL ROLE authenticated; SELECT t111_auth(1);
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11101, 'emision', 11101, 'h')$q$, '111-02 un usuario autenticado (Admin) no puede invocar la reserva', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t111_auth(1);
SELECT t111_err($q$SELECT finalizar_operacion_cfdi(gen_random_uuid(), 'fallida', '{}')$q$, '111-03 ni la finalización', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_err($q$INSERT INTO cfdi_operaciones (orden_id, tipo, generacion, huella, lease_hasta) VALUES (11101, 'emision', 1, 'x', now())$q$, '111-04 service role no inserta operaciones a mano', '42501');
ROLLBACK;

\echo '── 111: actor y dueño (defensa en profundidad)'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11109, 'emision', 11102, 'h')$q$, '111-05 Ventas A no reserva la orden de Ventas B', '42501', '%propias%');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11110, 'emision', 11102, 'h')$q$, '111-06 Ventas no reserva una orden sin vendedor', '42501');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11101, 'emision', 11104, 'h')$q$, '111-07 Chofer no factura', '42501');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11101, 'emision', 11106, 'h')$q$, '111-08 un vendedor inactivo no factura', '42501');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11101, 'emision', 999999, 'h')$q$, '111-09 actor inexistente', '42501');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11101, 'emision', 11101, '')$q$, '111-10 la emisión exige la huella del CFDI del servidor', '22023');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11108, 'cancelacion', 11101, NULL, '05')$q$, '111-11 motivo SAT inválido', '22023');
SELECT t111_err($q$SELECT reservar_operacion_cfdi(11108, 'cancelacion', 11101, NULL, '01', NULL)$q$, '111-12 motivo 01 exige UUID sustituto', '22023');
ROLLBACK;

\echo '── 111: elegibilidad (se devuelve, no se reserva)'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_assert((SELECT bool_and((reservar_operacion_cfdi(o, 'emision', 11101, 'h') ->> 'codigo') = 'ESTATUS_NO_FACTURABLE') FROM unnest(ARRAY[11103, 11104, 11105, 11106, 11107]::bigint[]) o),
  '111-13 emisión: Creada / Asignada / En ruta / Cancelada / No entregada → ESTATUS_NO_FACTURABLE');
SELECT t111_assert((reservar_operacion_cfdi(11108, 'emision', 11101, 'h') ->> 'codigo') = 'CFDI_VIGENTE', '111-14 emisión de una orden con CFDI vigente → CFDI_VIGENTE');
SELECT t111_assert((SELECT bool_and((reservar_operacion_cfdi(o, 'cancelacion', 11101, NULL, '02') ->> 'codigo') = 'SIN_CFDI') FROM unnest(ARRAY[11101, 11103]::bigint[]) o)
  AND (reservar_operacion_cfdi(11115, 'cancelacion', 11101, NULL, '02') ->> 'codigo') = 'YA_CANCELADA',
  '111-15 cancelación: sin CFDI → SIN_CFDI; CFDI ya cancelado → YA_CANCELADA');
SELECT t111_assert((SELECT count(*) = 0 FROM cfdi_operaciones WHERE orden_id BETWEEN 11101 AND 11139), '111-16 ninguna de esas solicitudes creó operación');
COMMIT;

\echo '── 111: una operación activa por orden; emisión exitosa'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'e1', (reservar_operacion_cfdi(11101, 'emision', 11102, 'hash-a') ->> 'operacion_id')::uuid;
SELECT t111_assert(t111_op((SELECT v FROM t111_ids WHERE k = 'e1')) = 'emision|1|en_curso', '111-17 Ventas A reserva SU orden Entregada: emisión gen 1 en curso');
SELECT t111_assert((reservar_operacion_cfdi(11101, 'emision', 11101, 'hash-b') ->> 'codigo') = 'OPERACION_EN_CURSO'
  AND (reservar_operacion_cfdi(11101, 'emision', 11105, 'hash-c') ->> 'operacion_id')::uuid = (SELECT v FROM t111_ids WHERE k = 'e1'),
  '111-18 segunda reserva (Admin o Facturación) mientras hay una en curso → OPERACION_EN_CURSO con la misma operación');
SELECT t111_assert((SELECT huella = encode(sha256(convert_to('cfdi|11101|emision|1|hash-a', 'UTF8')), 'hex') AND payload_hash = 'hash-a' AND actor_id = 11102 AND actor = 'Ventas A'
                    AND lease_hasta > now() + interval '100 seconds' AND lease_hasta < now() + interval '130 seconds' FROM cfdi_operaciones WHERE id = (SELECT v FROM t111_ids WHERE k = 'e1')),
  '111-19 huella canónica (orden|tipo|generación|hash del CFDI), actor y lease por defecto 120 s');
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'e1'), 'emitida', '{"proveedor_id":"FM-1","cfdi_uuid":"UUID-1","folio":"A1"}') ->> 'estado') = 'exitosa',
  '111-20 finalizar emitida → exitosa');
SELECT t111_assert(t111_ord(11101) = 'Facturada|UUID-1|vigente' AND (SELECT facturama_id = 'FM-1' AND facturama_folio = 'A1' FROM ordenes WHERE id = 11101),
  '111-21 la orden pasa Entregada → Facturada con el CFDI del proveedor');
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'e1'), 'emitida', '{"proveedor_id":"FM-1","cfdi_uuid":"UUID-1"}') ->> 'replay')::boolean,
  '111-22 repetir la misma finalización → replay sin efecto');
SELECT t111_err($q$SELECT finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'e1'), 'fallida', '{}')$q$, '111-23 una operación exitosa no se reescribe como fallida', '55000');
SELECT t111_assert((reservar_operacion_cfdi(11101, 'emision', 11101, 'hash-d') ->> 'codigo') = 'CFDI_VIGENTE', '111-24 tras emitir, una nueva emisión ve el CFDI vigente');
COMMIT;

\echo '── 111: falla definitiva libera; crédito sin pagar es facturable'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'c1', (reservar_operacion_cfdi(11102, 'emision', 11105, 'hash-cred') ->> 'operacion_id')::uuid;
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'c1'), 'fallida', '{"detalle":{"http":400}}') ->> 'estado') = 'fallida'
  AND t111_ord(11102) = 'Entregada|-|vigente', '111-25 rechazo definitivo del proveedor → fallida; la orden sigue Entregada');
INSERT INTO t111_ids SELECT 'c2', (reservar_operacion_cfdi(11102, 'emision', 11105, 'hash-cred') ->> 'operacion_id')::uuid;
SELECT t111_assert(t111_op((SELECT v FROM t111_ids WHERE k = 'c2')) = 'emision|1|en_curso', '111-26 tras una falla definitiva se reserva una NUEVA operación (misma generación)');
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'c2'), 'emitida', '{"proveedor_id":"FM-2","cfdi_uuid":"UUID-2"}') ->> 'estado') = 'exitosa'
  AND t111_ord(11102) = 'Facturada|UUID-2|vigente', '111-27 venta a crédito Entregada y sin pagar → se factura (sin requisito de pago)');
COMMIT;

\echo '── 111: resultado incierto bloquea; lease vencido → incierta (nunca fallida)'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'u1', (reservar_operacion_cfdi(11111, 'emision', 11101, 'hash-u') ->> 'operacion_id')::uuid;
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u1'), 'incierta', '{"detalle":{"error":"timeout"}}') ->> 'estado') = 'incierta',
  '111-28 timeout tras la frontera del proveedor → incierta');
SELECT t111_assert((reservar_operacion_cfdi(11111, 'emision', 11101, 'hash-u') ->> 'codigo') = 'OPERACION_INCIERTA', '111-29 con una operación incierta NO se puede reservar otra (sin reintento automático)');
INSERT INTO t111_ids SELECT 'l1', (reservar_operacion_cfdi(11112, 'emision', 11101, 'hash-l', NULL, NULL, 5) ->> 'operacion_id')::uuid;
SELECT t111_assert((SELECT lease_hasta > now() + interval '25 seconds' FROM cfdi_operaciones WHERE id = (SELECT v FROM t111_ids WHERE k = 'l1')), '111-30 el lease mínimo es 30 s');
COMMIT;
-- Caída antes del proveedor: la reserva quedó y nadie finalizó. Se simula el paso del tiempo.
BEGIN; SET LOCAL session_replication_role = replica; UPDATE cfdi_operaciones SET lease_hasta = now() - interval '1 second' WHERE id = (SELECT v FROM t111_ids WHERE k = 'l1'); COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_assert((reservar_operacion_cfdi(11112, 'emision', 11101, 'hash-l') ->> 'codigo') = 'OPERACION_INCIERTA'
  AND t111_op((SELECT v FROM t111_ids WHERE k = 'l1')) = 'emision|1|incierta' AND t111_ord(11112) = 'Entregada|-|vigente',
  '111-31 caída antes del proveedor: al vencer el lease la reserva pasa a INCIERTA (no fallida) y bloquea una nueva emisión');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'l1'), 'emitida', '{"proveedor_id":"FM-L","cfdi_uuid":"UUID-L"}') ->> 'estado') = 'exitosa'
  AND t111_ord(11112) = 'Facturada|UUID-L|vigente', '111-32 la respuesta definitiva que llega tarde del MISMO proceso todavía finaliza (vencida → exitosa)');
COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'v1', (reservar_operacion_cfdi(11113, 'emision', 11101, 'hash-v') ->> 'operacion_id')::uuid;
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE cfdi_operaciones SET lease_hasta = now() - interval '1 second' WHERE id = (SELECT v FROM t111_ids WHERE k = 'v1'); COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_assert(vencer_operaciones_cfdi() >= 1 AND t111_op((SELECT v FROM t111_ids WHERE k = 'v1')) = 'emision|1|incierta', '111-33 vencer_operaciones_cfdi: en_curso vencida → incierta');
COMMIT;

\echo '── 111: conciliación (solo Admin / Facturación, con evidencia)'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_err($q$SELECT conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u1'), 'no_emitida', '{"evidencia":"x"}', 11102)$q$, '111-34 Ventas no concilia', '42501');
SELECT t111_err($q$SELECT conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u1'), 'no_emitida', '{}', 11101)$q$, '111-35 conciliar exige evidencia', '22023');
SELECT t111_err($q$SELECT conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u1'), 'cancelada', '{"evidencia":"x"}', 11101)$q$, '111-36 resolución que no aplica al tipo', '22023');
SELECT t111_assert((conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u1'), 'no_emitida', '{"evidencia":"consulta Facturama: no existe CFDI"}', 11105) ->> 'estado') = 'descartada',
  '111-37 Facturación confirma que NO se emitió → descartada');
SELECT t111_assert((SELECT detalle -> 'conciliacion' ->> 'actor' = 'Fact 111' AND detalle -> 'conciliacion' ->> 'evidencia' LIKE 'consulta Facturama%'
                    FROM cfdi_operaciones WHERE id = (SELECT v FROM t111_ids WHERE k = 'u1')),
  '111-37b la conciliación guarda evidencia y actor');
INSERT INTO t111_ids SELECT 'u2', (reservar_operacion_cfdi(11111, 'emision', 11101, 'hash-u2') ->> 'operacion_id')::uuid;
SELECT t111_assert(t111_op((SELECT v FROM t111_ids WHERE k = 'u2')) = 'emision|1|en_curso', '111-38 tras conciliar como no emitida se puede reservar de nuevo');
SELECT t111_err($q$SELECT conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u2'), 'no_emitida', '{"evidencia":"x"}', 11101)$q$, '111-39 no se concilia una operación en curso con lease vigente', '55000');
SELECT t111_assert((conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'v1'), 'emitida', '{"evidencia":"Facturama: CFDI encontrado","proveedor_id":"FM-V","cfdi_uuid":"UUID-V"}', 11101) ->> 'estado') = 'exitosa'
  AND t111_ord(11113) = 'Facturada|UUID-V|vigente', '111-40 Admin confirma que SÍ se emitió → exitosa y la orden queda Facturada con ese UUID');
SELECT t111_err($q$SELECT conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'v1'), 'no_emitida', '{"evidencia":"x"}', 11101)$q$, '111-41 una operación resuelta no se reconcilia otra vez', '55000');
SELECT finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'u2'), 'fallida', '{}');
COMMIT;

\echo '── 111: el proveedor emitió pero la orden cambió → revision'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'r1', (reservar_operacion_cfdi(11114, 'emision', 11101, 'hash-r') ->> 'operacion_id')::uuid;
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE ordenes SET estatus = 'Cancelada' WHERE id = 11114; COMMIT;
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'r1'), 'emitida', '{"proveedor_id":"FM-R","cfdi_uuid":"UUID-R"}') ->> 'estado') = 'revision'
  AND t111_ord(11114) = 'Cancelada|-|vigente', '111-42 emitido pero la orden ya no estaba Entregada: la orden NO se mueve; operación en revisión');
SELECT t111_assert((SELECT cfdi_uuid = 'UUID-R' AND proveedor_id = 'FM-R' AND finalizada_at IS NULL FROM cfdi_operaciones WHERE id = (SELECT v FROM t111_ids WHERE k = 'r1')),
  '111-42b la revisión conserva proveedor_id y UUID del proveedor');
SELECT t111_err($q$SELECT finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'r1'), 'emitida', '{"proveedor_id":"FM-R","cfdi_uuid":"UUID-R"}')$q$, '111-43 revisión solo se resuelve por conciliación', '55000');
COMMIT;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE ordenes SET estatus = 'Entregada' WHERE id = 11114; COMMIT;

\echo '── 111: cancelación — solicitada (pendiente), rechazada, confirmada; re-facturación gen 2'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'k1', (reservar_operacion_cfdi(11101, 'cancelacion', 11102, NULL, '02') ->> 'operacion_id')::uuid;
SELECT t111_assert(t111_op((SELECT v FROM t111_ids WHERE k = 'k1')) = 'cancelacion|1|en_curso'
  AND (SELECT cfdi_uuid = 'UUID-1' AND proveedor_id = 'FM-1' AND motivo = '02' FROM cfdi_operaciones WHERE id = (SELECT v FROM t111_ids WHERE k = 'k1')),
  '111-44 Ventas A reserva la cancelación de SU CFDI (gen 1, UUID y motivo de la orden)');
SELECT t111_assert((reservar_operacion_cfdi(11101, 'cancelacion', 11101, NULL, '02') ->> 'codigo') = 'OPERACION_EN_CURSO'
  AND (reservar_operacion_cfdi(11101, 'emision', 11101, 'hash') ->> 'codigo') = 'OPERACION_EN_CURSO',
  '111-45 cancelación en curso: ni otra cancelación ni una emisión se reservan');
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k1'), 'cancelacion_solicitada', '{"proveedor_estatus":"requested"}') ->> 'estado') = 'cancelacion_pendiente'
  AND t111_ord(11101) = 'Facturada|UUID-1|vigente', '111-46 SAT acepta la solicitud sin confirmar → cancelacion_pendiente; la orden SIGUE Facturada');
SELECT t111_assert((reservar_operacion_cfdi(11101, 'cancelacion', 11101, NULL, '02') ->> 'codigo') = 'CANCELACION_PENDIENTE'
  AND (reservar_operacion_cfdi(11101, 'emision', 11101, 'hash') ->> 'codigo') = 'CANCELACION_PENDIENTE',
  '111-47 con la cancelación pendiente: nueva cancelación o emisión → CANCELACION_PENDIENTE');
SELECT t111_err($q$SELECT finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k1'), 'cancelada', '{}')$q$, '111-48 la pendiente se resuelve por conciliación, no por una finalización suelta', '55000');
SELECT t111_assert((conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k1'), 'no_cancelada', '{"evidencia":"SAT: el receptor rechazó"}', 11101) ->> 'estado') = 'descartada'
  AND t111_ord(11101) = 'Facturada|UUID-1|vigente', '111-49 cancelación rechazada por el receptor (conciliada) → descartada; la orden sigue Facturada');
INSERT INTO t111_ids SELECT 'k2', (reservar_operacion_cfdi(11101, 'cancelacion', 11101, NULL, '02') ->> 'operacion_id')::uuid;
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k2'), 'cancelacion_rechazada', '{"proveedor_estatus":"rejected"}') ->> 'estado') = 'fallida'
  AND t111_ord(11101) = 'Facturada|UUID-1|vigente', '111-50 el proveedor responde rejected → fallida; la orden sigue Facturada');
INSERT INTO t111_ids SELECT 'k3', (reservar_operacion_cfdi(11101, 'cancelacion', 11105, NULL, '01', 'UUID-SUST') ->> 'operacion_id')::uuid;
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k3'), 'cancelada', '{"proveedor_estatus":"canceled","motivo_detalle":"error en RFC"}') ->> 'estado') = 'exitosa'
  AND t111_ord(11101) = 'Entregada|UUID-1|cancelado', '111-51 cancelación CONFIRMADA → Facturada → Entregada');
SELECT t111_assert((SELECT cfdi_cancelado_motivo = '01' AND cfdi_cancelado_uuid_sustituto = 'UUID-SUST' AND cfdi_cancelado_por = 'Fact 111' AND cfdi_cancelado_motivo_detalle = 'error en RFC' FROM ordenes WHERE id = 11101),
  '111-51b la orden guarda motivo, sustituto, detalle y quién canceló');
INSERT INTO t111_ids SELECT 'e2', (reservar_operacion_cfdi(11101, 'emision', 11101, 'hash-gen2') ->> 'operacion_id')::uuid;
SELECT t111_assert(t111_op((SELECT v FROM t111_ids WHERE k = 'e2')) = 'emision|2|en_curso', '111-52 tras la cancelación confirmada la siguiente emisión es generación 2');
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'e2'), 'emitida', '{"proveedor_id":"FM-3","cfdi_uuid":"UUID-3"}') ->> 'estado') = 'exitosa'
  AND t111_ord(11101) = 'Facturada|UUID-3|vigente', '111-53 re-facturación gen 2: Facturada con el CFDI nuevo');
SELECT t111_assert((SELECT cfdi_cancelado_motivo IS NULL AND cfdi_cancelado_por IS NULL FROM ordenes WHERE id = 11101), '111-53b anotaciones de cancelación limpias tras re-facturar');
SELECT t111_assert((SELECT string_agg(tipo || generacion || ':' || estado, ',' ORDER BY generacion, tipo, estado) FROM cfdi_operaciones WHERE orden_id = 11101)
  = 'cancelacion1:descartada,cancelacion1:exitosa,cancelacion1:fallida,emision1:exitosa,emision2:exitosa', '111-54 historia completa de la orden por generación');
COMMIT;

\echo '── 111: cancelación incierta; confirmación tardía por conciliación'
BEGIN; SET LOCAL ROLE service_role; SELECT t111_srv();
INSERT INTO t111_ids SELECT 'k4', (reservar_operacion_cfdi(11102, 'cancelacion', 11101, NULL, '02') ->> 'operacion_id')::uuid;
SELECT t111_assert((finalizar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k4'), 'incierta', '{"detalle":{"error":"timeout"}}') ->> 'estado') = 'incierta'
  AND t111_ord(11102) = 'Facturada|UUID-2|vigente', '111-55 cancelación con resultado desconocido → incierta; la orden sigue Facturada');
SELECT t111_assert((conciliar_operacion_cfdi((SELECT v FROM t111_ids WHERE k = 'k4'), 'cancelada', '{"evidencia":"Facturama: canceled"}', 11105) ->> 'estado') = 'exitosa'
  AND t111_ord(11102) = 'Entregada|UUID-2|cancelado', '111-56 conciliación confirma la cancelación → Entregada');
COMMIT;

BEGIN; SELECT t111_limpiar(); COMMIT;
DROP TABLE IF EXISTS t111_ids;
\echo '── 111: TODAS LAS PRUEBAS OK'
