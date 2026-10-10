-- 128_conceptos_nomina_test.sql — NOM-1: catálogo de conceptos de nómina,
-- desglose por recibo (foto), propuesta al generar, tope acumulado (préstamos),
-- recorte de descuentos al disponible, contrato anterior compatible,
-- inmutabilidad del Pagado y cierre de la API.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t128_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;  -- limpieza de fixtures: sin guardas
  DELETE FROM costos_historial WHERE movimiento_id IN (SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T128');
  CREATE TEMP TABLE IF NOT EXISTS t128_movs (id BIGINT);
  DELETE FROM t128_movs;
  INSERT INTO t128_movs SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T128' AND movimiento_id IS NOT NULL;
  DELETE FROM nomina_recibo_lineas WHERE recibo_id IN (SELECT id FROM nomina_recibos
    WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por = 'Admin T128') OR empleado_id BETWEEN 12801 AND 12809);
  DELETE FROM nomina_recibos WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por = 'Admin T128') OR empleado_id BETWEEN 12801 AND 12809;
  DELETE FROM nomina_periodos WHERE creado_por = 'Admin T128';
  DELETE FROM movimientos_contables WHERE id IN (SELECT id FROM t128_movs);
  DELETE FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id IN (SELECT id::text FROM nomina_conceptos WHERE creado_por = 'Admin T128');
  DELETE FROM nomina_concepto_empleados WHERE concepto_id IN (SELECT id FROM nomina_conceptos WHERE creado_por = 'Admin T128') OR empleado_id BETWEEN 12801 AND 12809;
  DELETE FROM nomina_conceptos WHERE creado_por = 'Admin T128';
  DELETE FROM auditoria WHERE usuario = 'Admin T128';
  DELETE FROM empleados WHERE id BETWEEN 12801 AND 12809;
  IF to_regclass('public.t128_emp_apartados') IS NOT NULL THEN
    UPDATE empleados e SET estatus = a.estatus FROM t128_emp_apartados a WHERE a.id = e.id;
    DROP TABLE t128_emp_apartados;
  END IF;
  IF to_regclass('public.t128_con_apartados') IS NOT NULL THEN
    UPDATE nomina_conceptos c SET activo = true FROM t128_con_apartados a WHERE a.id = c.id;
    DROP TABLE t128_con_apartados;
  END IF;
  DELETE FROM usuarios WHERE id BETWEEN 12801 AND 12809;
  DELETE FROM auth.users WHERE id::text LIKE '12800000-%';
END $$;

BEGIN; SELECT t128_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
-- Empleados y conceptos ajenos a la prueba se apartan para totales exactos.
CREATE TABLE t128_emp_apartados AS SELECT id, estatus FROM empleados WHERE estatus = 'Activo';
UPDATE empleados SET estatus = 'Inactivo' WHERE id IN (SELECT id FROM t128_emp_apartados);
CREATE TABLE t128_con_apartados AS SELECT id FROM nomina_conceptos WHERE activo;
UPDATE nomina_conceptos SET activo = false WHERE id IN (SELECT id FROM t128_con_apartados);
INSERT INTO auth.users (id, email) SELECT ('12800000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t128' FROM generate_series(1, 2) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (12801, 'Admin T128',  'u1@t128', 'Admin',  'Activo', '12800000-0000-0000-0000-000000000001'),
  (12802, 'Ventas T128', 'u2@t128', 'Ventas', 'Activo', '12800000-0000-0000-0000-000000000002');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES
  (12801, 'Emp T128 uno',    'Chofer Vendedor', 'Ventas y Distribución', 100,    '2024-01-01', 'Activo'),
  (12802, 'Emp T128 dos',    'Chofer Vendedor', 'Ventas y Distribución', 318.93, '2024-01-01', 'Activo'),
  (12803, 'Emp T128 tres',   'Ayudante',        'Producción',            200,    '2024-01-01', 'Activo'),
  (12804, 'Emp T128 cuatro', 'Ayudante',        'Producción',            10,     '2024-01-01', 'Activo');
COMMIT;

CREATE OR REPLACE FUNCTION t128_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '12800000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t128_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t128_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
GRANT EXECUTE ON FUNCTION t128_actor(INTEGER), t128_assert(BOOLEAN, TEXT), t128_err(TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t128_ids;
CREATE TEMP TABLE t128_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t128_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t128_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t128_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t128_pid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v::jsonb ->> 'periodo_id')::bigint FROM t128_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t128_cid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v::jsonb ->> 'concepto_id')::bigint FROM t128_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t128_rid(p_per TEXT, p_emp BIGINT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT id FROM nomina_recibos WHERE periodo_id = t128_pid(p_per) AND empleado_id = p_emp $$;
-- Monto de la línea de un concepto en un recibo (NULL si no existe).
CREATE OR REPLACE FUNCTION t128_lin(p_per TEXT, p_emp BIGINT, p_con TEXT) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT monto FROM nomina_recibo_lineas WHERE recibo_id = t128_rid(p_per, p_emp) AND concepto_id = t128_cid(p_con) $$;
-- Línea de catálogo para p_lineas.
CREATE OR REPLACE FUNCTION t128_l(p_con TEXT, p_monto NUMERIC) RETURNS JSONB LANGUAGE sql AS $$ SELECT jsonb_build_object('concepto_id', t128_cid(p_con), 'monto', p_monto) $$;
GRANT EXECUTE ON FUNCTION t128_j(TEXT), t128_pid(TEXT), t128_cid(TEXT), t128_rid(TEXT, BIGINT), t128_lin(TEXT, BIGINT, TEXT), t128_l(TEXT, NUMERIC) TO PUBLIC;

\echo '── 128: esquema y acceso'
SELECT t128_assert((SELECT count(*) = 3 AND bool_and(c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                      AND c.relname IN ('nomina_conceptos', 'nomina_concepto_empleados', 'nomina_recibo_lineas'))
  AND (SELECT count(*) = 3 AND bool_and(cmd = 'SELECT' AND qual = '(erp_rol_activo() = ''Admin''::text)') FROM pg_policies
        WHERE tablename IN ('nomina_conceptos', 'nomina_concepto_empleados', 'nomina_recibo_lineas')),
  '128-01 tres tablas con RLS; única policy: lectura de Admin');
SELECT t128_assert((SELECT bool_and(has_table_privilege('authenticated', t, 'SELECT') AND NOT has_table_privilege('authenticated', t, 'INSERT')
                      AND NOT has_table_privilege('authenticated', t, 'UPDATE') AND NOT has_table_privilege('authenticated', t, 'DELETE')
                      AND NOT has_table_privilege('authenticated', t, 'TRUNCATE') AND NOT has_table_privilege('anon', t, 'SELECT'))
                      FROM unnest(ARRAY['public.nomina_conceptos', 'public.nomina_concepto_empleados', 'public.nomina_recibo_lineas']) t)
  AND NOT has_sequence_privilege('authenticated', 'public.nomina_conceptos_id_seq', 'USAGE') AND NOT has_sequence_privilege('anon', 'public.nomina_conceptos_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.nomina_recibo_lineas_id_seq', 'USAGE') AND NOT has_sequence_privilege('anon', 'public.nomina_recibo_lineas_id_seq', 'USAGE'),
  '128-02 authenticated solo SELECT; anon nada; sin secuencias por API');
SELECT t128_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 6
  FROM pg_proc WHERE oid IN ('public.guardar_concepto_nomina(bigint,jsonb)'::regprocedure, 'public.guardar_recibo_nomina(bigint,integer,boolean,jsonb)'::regprocedure,
                             'public.aplicar_conceptos_nomina(bigint)'::regprocedure, 'public.nomina_acumulados()'::regprocedure, 'public.generar_recibos_nomina(bigint)'::regprocedure,
                             'public.editar_recibo_nomina(bigint,integer,boolean,numeric,numeric,numeric,numeric,numeric,numeric)'::regprocedure)),
  '128-03 contratos SECURITY DEFINER, search_path fijo, sin anon; el contrato anterior conserva su firma');
SELECT t128_assert((SELECT bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                     AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp') AND count(*) = 7
  FROM pg_proc WHERE oid IN ('public.nomina_recalcular_recibo(bigint,integer,boolean)'::regprocedure, 'public.nomina_acumulado_concepto(bigint,bigint,bigint)'::regprocedure,
                             'public.nomina_conceptos_propuestos(bigint,date,date,numeric,bigint)'::regprocedure, 'public.nomina_aplicar_conceptos_recibo(bigint)'::regprocedure,
                             'public.nomina_concepto_json(bigint)'::regprocedure, 'public.nomina_conceptos_guard()'::regprocedure, 'public.nomina_recibo_lineas_guard()'::regprocedure)),
  '128-04 funciones internas y guardas: sin EXECUTE por API');
SELECT t128_assert((SELECT count(*) = 3 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_nomina_conceptos_guard', 'trg_nomina_concepto_empleados_guard', 'trg_nomina_recibo_lineas_guard'))
  AND (SELECT count(*) = 2 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_nomina_periodos_guard', 'trg_nomina_recibos_guard'))
  AND (SELECT count(*) = 20 FROM pg_constraint WHERE contype IN ('c', 'u', 'p', 'f') AND conrelid IN ('public.nomina_recibos'::regclass, 'public.nomina_periodos'::regclass)),
  '128-05 guardas nuevas presentes; guardas y los 20 constraints de 100 intactos');

\echo '── 128: autorización'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(2);
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"todos"}')$q$, '128-06 Ventas: crear concepto denegado', '42501');
SELECT t128_err($q$SELECT guardar_recibo_nomina(1, 6, true, '[]')$q$, '128-07 Ventas: guardar recibo denegado', '42501');
SELECT t128_err($q$SELECT aplicar_conceptos_nomina(1)$q$, '128-08 Ventas: aplicar conceptos denegado', '42501');
SELECT t128_err($q$SELECT nomina_acumulados()$q$, '128-09 Ventas: avance de topes denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{}')$q$, '128-10 anon: sin EXECUTE', '42501');
SELECT t128_err($q$SELECT count(*) FROM nomina_conceptos$q$, '128-11 anon: sin lectura', '42501');
ROLLBACK;

\echo '── 128: catálogo (validaciones)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"  ","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"todos"}')$q$, '128-12 sin nombre', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"bono","categoria":"comisiones","monto":1,"aplica_a":"todos"}')$q$, '128-13 tipo inválido', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"descuento","categoria":"comisiones","monto":1,"aplica_a":"todos"}')$q$, '128-14 clase que no corresponde al tipo', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":-1,"aplica_a":"todos"}')$q$, '128-15 monto negativo', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":"abc","aplica_a":"todos"}')$q$, '128-16 monto no numérico', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"prima_dominical","calculo":"porcentaje_sd","monto":701,"aplica_a":"todos"}')$q$, '128-17 porcentaje mayor a 700', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"departamento"}')$q$, '128-18 por departamento sin departamento', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"equipo"}')$q$, '128-19 alcance inválido', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"todos","vigente_desde":"2026-05-10","vigente_hasta":"2026-05-01"}')$q$, '128-20 vigencia al revés', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"personas","personas":[{"empleado_id":999999999}]}')$q$, '128-21 persona inexistente', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"X","tipo":"descuento","categoria":"prestamo","monto":1,"aplica_a":"personas","personas":[{"empleado_id":12801,"limite_total":0}]}')$q$, '128-22 tope en cero', '22023');
SELECT t128_err($q$SELECT guardar_concepto_nomina(999999999, '{"nombre":"X","tipo":"percepcion","categoria":"comisiones","monto":1,"aplica_a":"todos"}')$q$, '128-23 concepto inexistente', '22023');
ROLLBACK;
SELECT t128_assert(NOT EXISTS (SELECT 1 FROM nomina_conceptos WHERE creado_por = 'Admin T128'), '128-24 ningún rechazo dejó conceptos');

\echo '── 128: catálogo (alta, bitácora, edición)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES
  ('A', guardar_concepto_nomina(NULL, '{"nombre":"T128  Bono de   puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":200,"aplica_a":"todos"}')::text),
  ('B', guardar_concepto_nomina(NULL, '{"nombre":"T128 Prima dominical","tipo":"percepcion","categoria":"prima_dominical","calculo":"porcentaje_sd","monto":25,"aplica_a":"personas",
          "personas":[{"empleado_id":12801},{"empleado_id":12802,"monto":50}]}')::text),
  ('C', guardar_concepto_nomina(NULL, '{"nombre":"T128 Comisión ruta","tipo":"percepcion","categoria":"comisiones","monto":150,"aplica_a":"departamento","departamento":"Ventas y Distribución",
          "personas":[{"empleado_id":12802,"excluido":true},{"empleado_id":12801}]}')::text),
  ('D', guardar_concepto_nomina(NULL, '{"nombre":"T128 IMSS","tipo":"descuento","categoria":"imss","monto":0,"aplica_a":"personas",
          "personas":[{"empleado_id":12801,"monto":80.55},{"empleado_id":12802,"monto":120}]}')::text),
  ('E', guardar_concepto_nomina(NULL, '{"nombre":"T128 Préstamo","tipo":"descuento","categoria":"prestamo","monto":500,"aplica_a":"personas",
          "personas":[{"empleado_id":12801,"limite_total":1200}]}')::text),
  ('K', guardar_concepto_nomina(NULL, '{"nombre":"T128 Descuento grande","tipo":"descuento","categoria":"otras_deducciones","monto":1000,"aplica_a":"personas","personas":[{"empleado_id":12804}]}')::text),
  ('F', guardar_concepto_nomina(NULL, '{"nombre":"T128 Inactivo","tipo":"percepcion","categoria":"otras_percepciones","monto":999,"aplica_a":"todos","activo":false}')::text);
INSERT INTO t128_ids VALUES
  ('G', guardar_concepto_nomina(NULL, jsonb_build_object('nombre', 'T128 Futuro', 'tipo', 'percepcion', 'categoria', 'otras_percepciones', 'monto', 999, 'aplica_a', 'todos', 'vigente_desde', fin_hoy() + 60))::text),
  ('H', guardar_concepto_nomina(NULL, jsonb_build_object('nombre', 'T128 Vencido', 'tipo', 'percepcion', 'categoria', 'otras_percepciones', 'monto', 999, 'aplica_a', 'todos', 'vigente_hasta', fin_hoy() - 200))::text);
SELECT t128_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"t128 bono de puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":1,"aplica_a":"todos"}')$q$,
  '128-25 nombre activo repetido (sin distinguir mayúsculas ni espacios): rechazado', '23505');
COMMIT;
SELECT t128_assert((t128_j('A') ->> 'creado') = 'true' AND (SELECT nombre = 'T128 Bono de puntualidad' AND calculo = 'fijo' AND activo AND vigente_desde IS NULL AND creado_por = 'Admin T128'
                      FROM nomina_conceptos WHERE id = t128_cid('A')),
  '128-26 alta: nombre normalizado, cálculo fijo y sin vigencia por omisión (aplica siempre), autor del servidor');
SELECT t128_assert((SELECT count(*) = 2 FROM nomina_concepto_empleados WHERE concepto_id = t128_cid('B'))
  AND (SELECT monto = 50 FROM nomina_concepto_empleados WHERE concepto_id = t128_cid('B') AND empleado_id = 12802)
  -- En un concepto por departamento solo se guardan las excepciones: la fila sin excepción de 12801 no se guarda.
  AND (SELECT count(*) = 1 AND bool_and(excluido AND empleado_id = 12802) FROM nomina_concepto_empleados WHERE concepto_id = t128_cid('C'))
  AND (SELECT limite_total = 1200 FROM nomina_concepto_empleados WHERE concepto_id = t128_cid('E') AND empleado_id = 12801),
  '128-27 personas: lista, monto propio, exclusión y tope');
SELECT t128_assert((SELECT count(*) = 9 AND bool_and(accion = 'CONTRATO' AND detalle = 'guardar_concepto_nomina' AND antes IS NULL AND actor = 'Admin T128')
                      FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id IN (SELECT id::text FROM nomina_conceptos WHERE creado_por = 'Admin T128'))
  AND (SELECT (despues -> 'personas' -> 0 ->> 'limite_total')::numeric = 1200 FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id = t128_cid('E')::text)
  AND (SELECT count(*) = 9 FROM auditoria WHERE usuario = 'Admin T128' AND accion = 'Crear' AND modulo = 'Nómina' AND detalle LIKE 'Concepto T128%'),
  '128-28 cada alta queda en la bitácora del Dueño (con sus personas) y en auditoría');

BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('A_same', guardar_concepto_nomina(t128_cid('A'), '{"nombre":"T128 Bono de puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":200,"aplica_a":"todos"}')::text);
SELECT t128_err(format($q$SELECT guardar_concepto_nomina(%s, '{"nombre":"T128 Bono de puntualidad","tipo":"descuento","categoria":"prestamo","monto":200,"aplica_a":"todos"}')$q$, t128_cid('A')),
  '128-29 el tipo y la clase de un concepto no cambian', '22023');
COMMIT;
SELECT t128_assert((t128_j('A_same') ->> 'sin_cambios') = 'true'
  AND (SELECT count(*) = 1 FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id = t128_cid('A')::text),
  '128-30 guardar sin cambios no agrega bitácora ni auditoría');

BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(2);
SELECT t128_assert((SELECT count(*) = 0 FROM nomina_conceptos) AND (SELECT count(*) = 0 FROM nomina_concepto_empleados) AND (SELECT count(*) = 0 FROM nomina_recibo_lineas),
  '128-31 Ventas no lee conceptos, asignaciones ni desgloses');
ROLLBACK;

\echo '── 128: generar recibos con la propuesta del catálogo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('p1', crear_periodo_nomina(fin_hoy() - 7)::text), ('p2', crear_periodo_nomina(fin_hoy() - 14)::text),
  ('p3', crear_periodo_nomina(fin_hoy() - 21)::text), ('p4', crear_periodo_nomina(fin_hoy() - 28)::text);
INSERT INTO t128_ids VALUES ('g1', generar_recibos_nomina(t128_pid('p1'))::text);
INSERT INTO t128_ids VALUES ('g1b', generar_recibos_nomina(t128_pid('p1'))::text);
COMMIT;
SELECT t128_assert((t128_j('g1') ->> 'creados')::int = 4 AND (t128_j('g1') ->> 'lineas')::int = 11
  AND (t128_j('g1b') ->> 'creados')::int = 0 AND (t128_j('g1b') ->> 'lineas')::int = 0
  AND (SELECT count(*) = 11 FROM nomina_recibo_lineas l JOIN nomina_recibos r ON r.id = l.recibo_id WHERE r.periodo_id = t128_pid('p1')),
  '128-32 generar propone 11 líneas en 4 recibos; repetir no duplica ni reescribe');
SELECT t128_assert(t128_lin('p1', 12801, 'A') = 200 AND t128_lin('p1', 12801, 'B') = 25 AND t128_lin('p1', 12801, 'C') = 150
  AND t128_lin('p1', 12801, 'D') = 80.55 AND t128_lin('p1', 12801, 'E') = 500
  AND (SELECT (sueldo, septimo_dia, bono_puntualidad, prima_dominical, comisiones, bono_productividad, otras_percepciones, total_percepciones, deducciones, neto_a_pagar)
              = (600, 100, 200, 25, 150, 0, 0, 1075, 580.55, 494.45) FROM nomina_recibos WHERE id = t128_rid('p1', 12801)),
  '128-33 empleado 1: bono fijo, prima 25 % del salario diario, comisión de su departamento, IMSS propio y préstamo; casillas = suma de líneas');
SELECT t128_assert(t128_lin('p1', 12802, 'B') = 159.47 AND t128_lin('p1', 12802, 'C') IS NULL AND t128_lin('p1', 12802, 'D') = 120 AND t128_lin('p1', 12802, 'E') IS NULL
  AND (SELECT (total_percepciones, deducciones, neto_a_pagar) = (2591.98, 120, 2471.98) FROM nomina_recibos WHERE id = t128_rid('p1', 12802)),
  '128-34 empleado 2: porcentaje propio (50 % de 318.93 = 159.47), excluido de la comisión, sin préstamo');
SELECT t128_assert((SELECT count(*) = 1 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12803)) AND t128_lin('p1', 12803, 'A') = 200
  AND t128_lin('p1', 12803, 'F') IS NULL AND t128_lin('p1', 12803, 'G') IS NULL AND t128_lin('p1', 12803, 'H') IS NULL
  AND (SELECT (total_percepciones, neto_a_pagar) = (1600, 1600) FROM nomina_recibos WHERE id = t128_rid('p1', 12803)),
  '128-35 empleado 3 (otro departamento): solo el bono general; el inactivo, el futuro y el vencido no se proponen');
SELECT t128_assert(t128_lin('p1', 12804, 'K') = 270
  AND (SELECT propuesto = 1000 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12804) AND concepto_id = t128_cid('K'))
  AND (SELECT (total_percepciones, deducciones, neto_a_pagar) = (270, 270, 0) FROM nomina_recibos WHERE id = t128_rid('p1', 12804)),
  '128-36 un descuento propuesto se recorta al disponible: el neto nunca queda negativo (se conserva lo propuesto)');
SELECT t128_assert((SELECT (total_percepciones, total_deducciones, total_neto) = (5536.98, 970.55, 4566.43) FROM nomina_periodos WHERE id = t128_pid('p1'))
  AND (t128_j('g1') ->> 'total_neto')::numeric = 4566.43,
  '128-37 totales del periodo = suma de sus recibos');

\echo '── 128: el recibo guarda la foto; el catálogo cambia después'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('A_edit', guardar_concepto_nomina(t128_cid('A'), '{"nombre":"T128 Bono puntual","tipo":"percepcion","categoria":"bono_puntualidad","monto":300,"aplica_a":"todos"}')::text);
COMMIT;
SELECT t128_assert(t128_lin('p1', 12803, 'A') = 200
  AND (SELECT nombre = 'T128 Bono de puntualidad' FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12803) AND concepto_id = t128_cid('A'))
  AND (SELECT cambios @> ARRAY['monto', 'nombre'] AND (antes ->> 'monto')::numeric = 200 AND (despues ->> 'monto')::numeric = 300
         FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id = t128_cid('A')::text AND antes IS NOT NULL),
  '128-38 cambiar nombre y monto del concepto no toca los recibos ya generados; la bitácora guarda antes y después');

\echo '── 128: guardar un recibo con su desglose'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 8, true, '[]')$q$, t128_rid('p1', 12801)), '128-39 días fuera de rango', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, '{}')$q$, t128_rid('p1', 12801)), '128-40 desglose que no es lista', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, %L)$q$, t128_rid('p1', 12801), jsonb_build_array(t128_l('A', -1))), '128-41 importe negativo', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, %L)$q$, t128_rid('p1', 12801), jsonb_build_array(t128_l('A', 1), t128_l('A', 2))), '128-42 concepto repetido', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, %L)$q$, t128_rid('p1', 12801), jsonb_build_array(t128_l('F', 10))), '128-43 agregar un concepto desactivado', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, '[{"concepto_id":999999999,"monto":1}]')$q$, t128_rid('p1', 12801)), '128-44 concepto inexistente', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, '[{"nombre":"X","tipo":"descuento","categoria":"comisiones","monto":1}]')$q$, t128_rid('p1', 12801)), '128-45 renglón manual con clase que no corresponde', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, '[{"nombre":"","tipo":"percepcion","categoria":"comisiones","monto":1}]')$q$, t128_rid('p1', 12801)), '128-46 renglón manual sin nombre', '22023');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 0, false, %L)$q$, t128_rid('p1', 12801), jsonb_build_array(t128_l('D', 80.55))),
  '128-47 deducciones mayores a las percepciones', '22023', '%exceden las percepciones%');
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, %L)$q$, t128_rid('p1', 12801), jsonb_build_array(t128_l('A', 200), t128_l('E', 1300))),
  '128-48 préstamo por encima del tope', '22023', '%solo faltan%');
COMMIT;
SELECT t128_assert((SELECT count(*) = 5 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12801))
  AND (SELECT (dias_pagados, total_percepciones, deducciones, neto_a_pagar) = (6, 1075, 580.55, 494.45) FROM nomina_recibos WHERE id = t128_rid('p1', 12801)),
  '128-49 ningún rechazo cambió el recibo');

BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
-- Préstamo: esta semana se descuentan 800 (dentro del tope de 1,200).
INSERT INTO t128_ids VALUES ('s800', guardar_recibo_nomina(t128_rid('p1', 12801), 6, true,
  jsonb_build_array(t128_l('A', 200), t128_l('B', 25), t128_l('C', 150), t128_l('D', 80.55), t128_l('E', 800)))::text);
COMMIT;
SELECT t128_assert((t128_j('s800') ->> 'neto_a_pagar')::numeric = 194.45 AND t128_lin('p1', 12801, 'E') = 800
  AND (SELECT propuesto = 500 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12801) AND concepto_id = t128_cid('E')),
  '128-50 cambiar el monto de un concepto solo esa semana (se conserva lo propuesto)');

BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
-- 5 días sin séptimo; el bono de puntualidad no viene (no aplicó); un renglón manual; uno manual en 0 se ignora.
INSERT INTO t128_ids VALUES ('s1', guardar_recibo_nomina(t128_rid('p1', 12801), 5, false,
  jsonb_build_array(t128_l('B', 25), t128_l('C', 150), t128_l('D', 80.55), t128_l('E', 500),
    '{"nombre":"  T128 Bono   especial ","tipo":"percepcion","categoria":"otras_percepciones","monto":150}'::jsonb,
    '{"nombre":"T128 En cero","tipo":"percepcion","categoria":"otras_percepciones","monto":0}'::jsonb))::text);
INSERT INTO t128_ids VALUES ('s1b', guardar_recibo_nomina(t128_rid('p1', 12801), 5, false,
  jsonb_build_array(t128_l('B', 25), t128_l('C', 150), t128_l('D', 80.55), t128_l('E', 500),
    '{"nombre":"T128 Bono especial","tipo":"percepcion","categoria":"otras_percepciones","monto":150}'::jsonb))::text);
COMMIT;
SELECT t128_assert((t128_j('s1') - 'periodo_total_neto') = (t128_j('s1b') - 'periodo_total_neto')
  AND (t128_j('s1') ->> 'sueldo')::numeric = 500 AND (t128_j('s1') ->> 'septimo_dia')::numeric = 0 AND (t128_j('s1') ->> 'total_percepciones')::numeric = 825
  AND (t128_j('s1') ->> 'deducciones')::numeric = 580.55 AND (t128_j('s1') ->> 'neto_a_pagar')::numeric = 244.45 AND (t128_j('s1') ->> 'lineas')::int = 6,
  '128-51 días, séptimo y desglose en una operación; repetir la misma captura da el mismo resultado');
SELECT t128_assert(t128_lin('p1', 12801, 'A') = 0
  AND (SELECT count(*) = 1 AND bool_and(nombre = 'T128 Bono especial' AND monto = 150) FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p1', 12801) AND concepto_id IS NULL)
  AND (SELECT (dias_pagados, sueldo, septimo_dia, bono_puntualidad, otras_percepciones, prima_dominical, comisiones, total_percepciones, deducciones, neto_a_pagar)
              = (5, 500, 0, 0, 150, 25, 150, 825, 580.55, 244.45) FROM nomina_recibos WHERE id = t128_rid('p1', 12801))
  AND (SELECT total_neto = 4566.43 - 494.45 + 244.45 FROM nomina_periodos WHERE id = t128_pid('p1')),
  '128-52 el concepto que no vino queda en 0 ("no aplicó"); el manual se guarda normalizado; el periodo se recalcula');

\echo '── 128: aplicar al borrador los conceptos que falten'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('ap0', aplicar_conceptos_nomina(t128_pid('p1'))::text);
INSERT INTO t128_ids VALUES ('V', guardar_concepto_nomina(NULL, '{"nombre":"T128 Vales","tipo":"percepcion","categoria":"otras_percepciones","monto":50,"aplica_a":"todos"}')::text);
INSERT INTO t128_ids VALUES ('ap1', aplicar_conceptos_nomina(t128_pid('p1'))::text);
INSERT INTO t128_ids VALUES ('ap2', aplicar_conceptos_nomina(t128_pid('p1'))::text);
SELECT t128_err($q$SELECT aplicar_conceptos_nomina(999999999)$q$, '128-53 periodo inexistente', '22023');
COMMIT;
SELECT t128_assert((t128_j('ap0') ->> 'lineas')::int = 0 AND t128_lin('p1', 12801, 'A') = 0,
  '128-54 aplicar no revive la línea que Admin dejó en 0 ni cambia montos capturados');
SELECT t128_assert((t128_j('ap1') ->> 'lineas')::int = 4 AND (t128_j('ap1') ->> 'recibos')::int = 4 AND (t128_j('ap2') ->> 'lineas')::int = 0
  AND t128_lin('p1', 12801, 'V') = 50 AND t128_lin('p1', 12804, 'V') = 50 AND t128_lin('p1', 12804, 'K') = 270 AND t128_lin('p1', 12801, 'E') = 500
  AND (SELECT (otras_percepciones, neto_a_pagar) = (200, 294.45) FROM nomina_recibos WHERE id = t128_rid('p1', 12801))
  AND (SELECT neto_a_pagar = 50 FROM nomina_recibos WHERE id = t128_rid('p1', 12804))
  AND (SELECT total_neto = 4516.43 FROM nomina_periodos WHERE id = t128_pid('p1'))
  AND (SELECT count(*) = 1 FROM auditoria WHERE usuario = 'Admin T128' AND accion = 'Editar' AND detalle LIKE 'Conceptos aplicados a %: 4 en 4 recibos'),
  '128-55 un concepto creado después se agrega a los 4 recibos del borrador (una vez); lo demás no cambia');

\echo '── 128: tope acumulado (préstamo)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('g2', generar_recibos_nomina(t128_pid('p2'))::text);
INSERT INTO t128_ids VALUES ('g3', generar_recibos_nomina(t128_pid('p3'))::text);
INSERT INTO t128_ids VALUES ('g4', generar_recibos_nomina(t128_pid('p4'))::text);
INSERT INTO t128_ids VALUES ('acu', nomina_acumulados()::text);
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, %L)$q$, t128_rid('p3', 12801), jsonb_build_array(t128_l('E', 300))),
  '128-56 subir el préstamo de la semana por encima de lo que falta: rechazado', '22023', '%solo faltan $200%');
COMMIT;
SELECT t128_assert(t128_lin('p2', 12801, 'E') = 500 AND t128_lin('p3', 12801, 'E') = 200 AND t128_lin('p4', 12801, 'E') IS NULL
  AND (SELECT propuesto = 200 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p3', 12801) AND concepto_id = t128_cid('E'))
  AND t128_lin('p2', 12801, 'A') = 300 AND t128_lin('p4', 12801, 'D') = 80.55,
  '128-57 préstamo de 1,200 a 500 por semana: 500 + 500 + 200 y deja de proponerse; las semanas nuevas usan el monto vigente del bono');
SELECT t128_assert((SELECT (x ->> 'limite_total')::numeric = 1200 AND (x ->> 'pagado')::numeric = 0 AND (x ->> 'en_borrador')::numeric = 1200 AND (x ->> 'restante')::numeric = 0
                      FROM jsonb_array_elements(t128_j('acu')) x WHERE (x ->> 'concepto_id')::bigint = t128_cid('E') AND (x ->> 'empleado_id')::bigint = 12801),
  '128-58 avance del tope: límite, pagado, en borrador y restante');

\echo '── 128: el contrato anterior sigue funcionando'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
-- El cliente anterior manda el TOTAL de cada casilla (catálogo: bono 300, vales 50).
INSERT INTO t128_ids VALUES ('leg', editar_recibo_nomina(t128_rid('p2', 12803), 6, true, p_bono_puntualidad := 350, p_otras_percepciones := 50, p_deducciones := 40)::text);
SELECT t128_err(format($q$SELECT editar_recibo_nomina(%s, 6, true, p_bono_puntualidad := 100, p_otras_percepciones := 50)$q$, t128_rid('p2', 12803)),
  '128-59 contrato anterior con un total menor a lo que ya puso el catálogo: rechazo claro', '22023', '%actualiza la aplicación%');
COMMIT;
SELECT t128_assert((t128_j('leg') ->> 'total_percepciones')::numeric = 1800 AND (t128_j('leg') ->> 'neto_a_pagar')::numeric = 1760
  AND (SELECT count(*) = 2 AND sum(monto) = 90 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p2', 12803) AND concepto_id IS NULL)
  AND (SELECT monto = 50 FROM nomina_recibo_lineas WHERE recibo_id = t128_rid('p2', 12803) AND concepto_id IS NULL AND categoria = 'bono_puntualidad')
  AND t128_lin('p2', 12803, 'A') = 300 AND t128_lin('p2', 12803, 'V') = 50
  AND (SELECT (bono_puntualidad, otras_percepciones, deducciones, neto_a_pagar) = (350, 50, 40, 1760) FROM nomina_recibos WHERE id = t128_rid('p2', 12803)),
  '128-60 contrato anterior: respeta lo del catálogo y guarda la diferencia como renglón manual; misma respuesta de 100');

\echo '── 128: pago e inmutabilidad'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
INSERT INTO t128_ids VALUES ('pay', pagar_nomina(t128_pid('p1'))::text);
SELECT t128_err(format($q$SELECT guardar_recibo_nomina(%s, 6, true, '[]')$q$, t128_rid('p1', 12801)), '128-61 guardar un recibo de un periodo pagado', '22023', '%ya está pagado%');
SELECT t128_err(format($q$SELECT aplicar_conceptos_nomina(%s)$q$, t128_pid('p1')), '128-62 aplicar conceptos a un periodo pagado', '22023', '%ya está pagado%');
INSERT INTO t128_ids VALUES ('acu2', nomina_acumulados()::text);
COMMIT;
SELECT t128_assert((t128_j('pay') ->> 'total_neto')::numeric = 4516.43 AND (t128_j('pay') ->> 'recibos')::int = 4
  AND (SELECT monto = 4516.43 AND tipo = 'Egreso' AND categoria = 'Nómina' FROM movimientos_contables WHERE id = (t128_j('pay') ->> 'movimiento_id')::bigint)
  AND (SELECT sum(neto_a_pagar) = 4516.43 AND bool_and(estatus = 'Pagado') FROM nomina_recibos WHERE periodo_id = t128_pid('p1')),
  '128-63 pagar_nomina (sin cambio): un egreso por el neto de los recibos con su desglose');
SELECT t128_assert((SELECT (x ->> 'pagado')::numeric = 500 AND (x ->> 'en_borrador')::numeric = 700 AND (x ->> 'restante')::numeric = 0
                      FROM jsonb_array_elements(t128_j('acu2')) x WHERE (x ->> 'concepto_id')::bigint = t128_cid('E') AND (x ->> 'empleado_id')::bigint = 12801),
  '128-64 tras pagar: 500 del préstamo pasan de borrador a pagado');
-- SQL de confianza (sin JWT): el desglose de un periodo Pagado no cambia.
SELECT t128_err(format($q$UPDATE nomina_recibo_lineas SET monto = 1 WHERE recibo_id = %s$q$, t128_rid('p1', 12801)), '128-65 Pagado: UPDATE de una línea (también SQL de confianza)', '42501', '%inmutable%');
SELECT t128_err(format($q$DELETE FROM nomina_recibo_lineas WHERE recibo_id = %s$q$, t128_rid('p1', 12801)), '128-66 Pagado: DELETE de una línea', '42501', '%inmutable%');
SELECT t128_err(format($q$INSERT INTO nomina_recibo_lineas (recibo_id, nombre, tipo, categoria, monto) VALUES (%s, 'X', 'percepcion', 'comisiones', 5)$q$, t128_rid('p1', 12801)),
  '128-67 Pagado: INSERT de una línea', '42501', '%inmutable%');
SELECT t128_err(format($q$UPDATE nomina_recibo_lineas SET recibo_id = %s WHERE recibo_id = %s$q$, t128_rid('p1', 12801), t128_rid('p2', 12801)),
  '128-68 una línea no se mueve de recibo', '42501');

\echo '── 128: la API no escribe directo'
BEGIN; SET LOCAL ROLE authenticated; SELECT t128_actor(1);
SELECT t128_err($q$INSERT INTO nomina_conceptos (nombre, tipo, categoria, monto, aplica_a) VALUES ('X', 'percepcion', 'comisiones', 1, 'todos')$q$, '128-69 Admin por REST: INSERT de concepto', '42501');
SELECT t128_err(format($q$UPDATE nomina_conceptos SET monto = 9999 WHERE id = %s$q$, t128_cid('A')), '128-70 Admin por REST: UPDATE de concepto', '42501');
SELECT t128_err(format($q$UPDATE nomina_concepto_empleados SET limite_total = 99999 WHERE concepto_id = %s$q$, t128_cid('E')), '128-71 Admin por REST: subir el tope de un préstamo', '42501');
SELECT t128_err(format($q$UPDATE nomina_recibo_lineas SET monto = 9999 WHERE recibo_id = %s$q$, t128_rid('p2', 12801)), '128-72 Admin por REST: UPDATE del desglose', '42501');
SELECT t128_err(format($q$DELETE FROM nomina_recibo_lineas WHERE recibo_id = %s$q$, t128_rid('p2', 12801)), '128-73 Admin por REST: DELETE del desglose', '42501');
SELECT t128_err(format($q$SELECT nomina_aplicar_conceptos_recibo(%s)$q$, t128_rid('p2', 12801)), '128-74 Admin por API: función interna sin EXECUTE', '42501');
SELECT t128_assert((SELECT count(*) = 10 FROM nomina_conceptos WHERE creado_por = 'Admin T128') AND (SELECT count(*) > 0 FROM nomina_recibo_lineas),
  '128-75 Admin sí lee el catálogo y los desgloses');
ROLLBACK;

\echo '── 128: invariante — las casillas del recibo son la suma de sus líneas'
SELECT t128_assert((SELECT count(*) = 16 AND bool_and(
      r.comisiones = x.com AND r.prima_dominical = x.prima AND r.bono_puntualidad = x.bpun AND r.bono_productividad = x.bpro AND r.otras_percepciones = x.otras
      AND r.deducciones = x.ded AND r.total_percepciones = r.sueldo + r.septimo_dia + x.com + x.prima + x.bpun + x.bpro + x.otras
      AND r.neto_a_pagar = r.total_percepciones - r.deducciones AND r.neto_a_pagar >= 0)
    FROM nomina_recibos r
    CROSS JOIN LATERAL (SELECT COALESCE(sum(monto) FILTER (WHERE categoria = 'comisiones'), 0) AS com, COALESCE(sum(monto) FILTER (WHERE categoria = 'prima_dominical'), 0) AS prima,
        COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_puntualidad'), 0) AS bpun, COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_productividad'), 0) AS bpro,
        COALESCE(sum(monto) FILTER (WHERE categoria = 'otras_percepciones'), 0) AS otras, COALESCE(sum(monto) FILTER (WHERE tipo = 'descuento'), 0) AS ded
      FROM nomina_recibo_lineas l WHERE l.recibo_id = r.id) x
   WHERE r.periodo_id IN (t128_pid('p1'), t128_pid('p2'), t128_pid('p3'), t128_pid('p4')))
  AND (SELECT bool_and(p.total_neto = (SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = p.id)) FROM nomina_periodos p
        WHERE p.id IN (t128_pid('p1'), t128_pid('p2'), t128_pid('p3'), t128_pid('p4'))),
  '128-76 los 16 recibos de la prueba cuadran con su desglose, y cada periodo con sus recibos');

BEGIN; SELECT t128_limpiar(); COMMIT;
SELECT t128_assert(to_regclass('public.t128_emp_apartados') IS NULL AND to_regclass('public.t128_con_apartados') IS NULL
  AND NOT EXISTS (SELECT 1 FROM empleados WHERE id BETWEEN 12801 AND 12809) AND NOT EXISTS (SELECT 1 FROM nomina_conceptos WHERE creado_por = 'Admin T128')
  AND NOT EXISTS (SELECT 1 FROM nomina_periodos WHERE creado_por = 'Admin T128')
  AND NOT EXISTS (SELECT 1 FROM nomina_recibo_lineas l WHERE NOT EXISTS (SELECT 1 FROM nomina_recibos r WHERE r.id = l.recibo_id)),
  '128-77 limpieza: sin conceptos, periodos ni líneas huérfanas de la prueba');
\echo '── 128: TODAS LAS PRUEBAS OK'
