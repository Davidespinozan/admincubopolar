-- 100_nomina_canonica_test.sql — nómina canónica: semana sábado→viernes en
-- día de negocio de Mazatlán, identidad por fecha_inicio, recibos con snapshot
-- de salario y componentes reales, totales del servidor, pago único (098),
-- inmutabilidad del Pagado. La contención (101) se nota en el privilegio; las
-- escrituras directas se niegan (42501) antes y después de 101.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t100_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;  -- limpieza de fixtures: sin guardas
  DELETE FROM costos_historial WHERE movimiento_id IN (SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T100');
  CREATE TEMP TABLE IF NOT EXISTS t100_movs (id BIGINT);
  DELETE FROM t100_movs;
  INSERT INTO t100_movs SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T100' AND movimiento_id IS NOT NULL;
  DELETE FROM nomina_recibos WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por = 'Admin T100') OR empleado_id BETWEEN 10001 AND 10009;
  DELETE FROM nomina_periodos WHERE creado_por = 'Admin T100';
  DELETE FROM movimientos_contables WHERE id IN (SELECT id FROM t100_movs) OR concepto LIKE 'T100%';
  DELETE FROM costos_historial WHERE concepto LIKE 'T100%';
  DELETE FROM auditoria WHERE usuario = 'Admin T100';
  DELETE FROM empleados WHERE id BETWEEN 10001 AND 10009;
  -- Empleados ajenos a la prueba que se apartaron para totales exactos.
  IF to_regclass('public.t100_emp_apartados') IS NOT NULL THEN
    UPDATE empleados e SET estatus = a.estatus FROM t100_emp_apartados a WHERE a.id = e.id;
    DROP TABLE t100_emp_apartados;
  END IF;
  DELETE FROM usuarios WHERE id BETWEEN 10001 AND 10009;
  DELETE FROM auth.users WHERE id::text LIKE '10000000-%';
END $$;

BEGIN; SELECT t100_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE t100_emp_apartados AS SELECT id, estatus FROM empleados WHERE estatus = 'Activo';
UPDATE empleados SET estatus = 'Inactivo' WHERE id IN (SELECT id FROM t100_emp_apartados);
INSERT INTO auth.users (id, email) SELECT ('10000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t100' FROM generate_series(1, 2) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10001, 'Admin T100',  'u1@t100', 'Admin',  'Activo', '10000000-0000-0000-0000-000000000001'),
  (10002, 'Ventas T100', 'u2@t100', 'Ventas', 'Activo', '10000000-0000-0000-0000-000000000002');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES
  (10001, 'Emp T100 uno',    'Chofer Vendedor',  'Ventas y Distribución', 100,    '2024-01-01', 'Activo'),
  (10002, 'Emp T100 dos',    'Chofer Vendedor',  'Ventas y Distribución', 318.93, '2024-01-01', 'Activo'),
  (10003, 'Emp T100 baja',   'Ayudante',         'Producción',            200,    '2024-01-01', 'Inactivo'),
  (10004, 'Emp T100 futuro', 'Ayudante',         'Producción',            200,    '2099-01-01', 'Activo');
COMMIT;

CREATE OR REPLACE FUNCTION t100_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t100_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t100_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
GRANT EXECUTE ON FUNCTION t100_actor(INTEGER), t100_assert(BOOLEAN, TEXT), t100_err(TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t100_ids;
CREATE TEMP TABLE t100_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t100_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t100_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t100_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t100_pid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v::jsonb ->> 'periodo_id')::bigint FROM t100_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t100_rid(p_pid BIGINT, p_emp BIGINT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT id FROM nomina_recibos WHERE periodo_id = p_pid AND empleado_id = p_emp $$;
GRANT EXECUTE ON FUNCTION t100_j(TEXT), t100_pid(TEXT), t100_rid(BIGINT, BIGINT) TO PUBLIC;

\echo '── 100: esquema canónico'
SELECT t100_assert((SELECT count(*) = 10 FROM pg_constraint WHERE conname IN ('nomina_periodos_fecha_inicio_key', 'nomina_periodos_movimiento_key', 'nomina_periodos_inicia_sabado',
  'nomina_periodos_rango', 'nomina_periodos_pago_viernes', 'nomina_periodos_estatus', 'nomina_periodos_pago_coherente', 'nomina_periodos_totales',
  'nomina_recibos_periodo_empleado_key', 'nomina_recibos_totales'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nomina_periodos' AND column_name IN ('numero_semana', 'ejercicio')),
  '100-01 identidad = fecha_inicio (UNIQUE), sábado→viernes, pago el viernes, estados Borrador/Pagado; sin numero_semana/ejercicio');
SELECT t100_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 4
  FROM pg_proc WHERE oid IN ('public.crear_periodo_nomina(date)'::regprocedure, 'public.generar_recibos_nomina(bigint)'::regprocedure, 'public.pagar_nomina(bigint)'::regprocedure,
                             'public.editar_recibo_nomina(bigint,integer,boolean,numeric,numeric,numeric,numeric,numeric,numeric)'::regprocedure))
  AND pg_get_function_identity_arguments('public.editar_recibo_nomina(bigint,integer,boolean,numeric,numeric,numeric,numeric,numeric,numeric)'::regprocedure) !~* 'total|neto|salario',
  '100-02 contratos SECURITY DEFINER, search_path fijo, sin anon; editar no recibe totales ni salario');
SELECT t100_assert(NOT has_function_privilege('authenticated', 'public.nomina_recalcular_periodo(bigint)', 'EXECUTE'), '100-03 recalcular totales: interno (sin EXECUTE de la API)');
SELECT t100_assert(nomina_inicio_semana('2026-02-21') = '2026-02-21' AND nomina_inicio_semana('2026-02-27') = '2026-02-21' AND nomina_inicio_semana('2026-02-22') = '2026-02-21'
  AND nomina_inicio_semana('2026-02-28') = '2026-02-28' AND nomina_inicio_semana('2027-01-01') = '2026-12-26' AND nomina_inicio_semana('2026-12-26') = '2026-12-26',
  '100-04 semana sábado→viernes (NOMINA08: 21/02→27/02); fin de año: 26/12/2026→01/01/2027 es un solo periodo');

\echo '── 100: autorización'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(2);
SELECT t100_err($q$SELECT crear_periodo_nomina(NULL)$q$, '100-05 Ventas: crear periodo denegado', '42501');
SELECT t100_err($q$SELECT generar_recibos_nomina(1)$q$, '100-06 Ventas: generar recibos denegado', '42501');
SELECT t100_err($q$SELECT editar_recibo_nomina(1, 6, true)$q$, '100-07 Ventas: editar recibo denegado', '42501');
SELECT t100_err($q$SELECT pagar_nomina(1)$q$, '100-08 Ventas: pagar denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t100_err($q$SELECT crear_periodo_nomina(NULL)$q$, '100-09 anon: sin EXECUTE', '42501');
ROLLBACK;

\echo '── 100: crear periodo (servidor)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('hoy', crear_periodo_nomina(NULL)::text);
INSERT INTO t100_ids VALUES ('hoy_r', crear_periodo_nomina(NULL)::text);
INSERT INTO t100_ids VALUES ('hoy_dia', crear_periodo_nomina((t100_j('hoy') ->> 'fecha_inicio')::date + 4)::text);
SELECT t100_err($q$SELECT crear_periodo_nomina(fin_hoy() + 30)$q$, '100-10 semana futura fuera de rango: rechazada', '22023');
SELECT t100_err($q$SELECT crear_periodo_nomina(fin_hoy() - 400)$q$, '100-11 semana de hace más de un año: rechazada', '22023');
INSERT INTO t100_ids VALUES ('p1', crear_periodo_nomina(fin_hoy() - 7)::text), ('p2', crear_periodo_nomina(fin_hoy() - 14)::text),
  ('p3', crear_periodo_nomina(fin_hoy() - 21)::text), ('p4', crear_periodo_nomina(fin_hoy() - 28)::text);
COMMIT;
SELECT t100_assert((t100_j('hoy') ->> 'fecha_inicio')::date = nomina_inicio_semana(fin_hoy()) AND (t100_j('hoy') ->> 'fecha_fin')::date = nomina_inicio_semana(fin_hoy()) + 6
  AND (t100_j('hoy') ->> 'fecha_pago') = (t100_j('hoy') ->> 'fecha_fin') AND (t100_j('hoy') ->> 'estatus') = 'Borrador'
  AND extract(isodow FROM (t100_j('hoy') ->> 'fecha_inicio')::date) = 6 AND (t100_j('hoy') ->> 'periodo') LIKE 'Sáb % – Vie %',
  '100-12 sin fecha: el servidor deriva la semana sábado→viernes de fin_hoy() (zona del negocio), pago el viernes');
SELECT t100_assert((t100_j('hoy_r') ->> 'replay') = 'true' AND t100_pid('hoy_r') = t100_pid('hoy') AND (t100_j('hoy_dia') ->> 'replay') = 'true' AND t100_pid('hoy_dia') = t100_pid('hoy')
  AND (SELECT count(*) = 1 FROM nomina_periodos WHERE fecha_inicio = (t100_j('hoy') ->> 'fecha_inicio')::date)
  AND (SELECT count(*) = 1 FROM auditoria WHERE usuario = 'Admin T100' AND accion = 'Crear' AND detalle = 'Periodo ' || (t100_j('hoy') ->> 'periodo')),
  '100-13 idempotente: repetir o elegir otro día de la misma semana devuelve el mismo periodo (una auditoría)');

\echo '── 100: instante frontera desde cuatro zonas'
-- Viernes 02/10 23:30 en la zona del negocio (Mazatlán hasta 121, Durango desde 122); ya sábado 03/10 en UTC y Madrid.
-- El instante se deriva de fin_zona_negocio() porque la suite corre antes y después de 122.
BEGIN;
CREATE OR REPLACE FUNCTION public.fin_hoy() RETURNS DATE LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $f$ SELECT fin_dia_negocio(('2026-10-02 23:30'::timestamp AT TIME ZONE fin_zona_negocio())) $f$;
SELECT t100_assert(fin_hoy() = '2026-10-02'
  AND (('2026-10-02 23:30'::timestamp AT TIME ZONE fin_zona_negocio()) AT TIME ZONE 'UTC')::date = '2026-10-03'
  AND (('2026-10-02 23:30'::timestamp AT TIME ZONE fin_zona_negocio()) AT TIME ZONE 'Europe/Madrid')::date = '2026-10-03', '100-15 instante frontera: viernes en la zona del negocio, sábado (otra semana de nómina) en UTC/Madrid');
SET LOCAL TimeZone = 'UTC'; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('f_utc', crear_periodo_nomina(NULL)::text);
RESET ROLE; SET LOCAL TimeZone = 'America/Mazatlan'; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('f_mzt', crear_periodo_nomina(NULL)::text);
RESET ROLE; SET LOCAL TimeZone = 'America/Mexico_City'; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('f_cdmx', crear_periodo_nomina(NULL)::text);
RESET ROLE; SET LOCAL TimeZone = 'Europe/Madrid'; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('f_mad', crear_periodo_nomina(NULL)::text);
RESET ROLE;
SELECT t100_assert((SELECT count(DISTINCT v::jsonb ->> 'periodo_id') = 1 AND bool_and(v::jsonb ->> 'fecha_inicio' = '2026-09-26' AND v::jsonb ->> 'fecha_pago' = '2026-10-02')
                      FROM t100_ids WHERE k IN ('f_utc', 'f_mzt', 'f_cdmx', 'f_mad'))
  AND (SELECT count(*) = 1 FROM nomina_periodos WHERE fecha_inicio = '2026-09-26'),
  '100-16 UTC, Mazatlán, CDMX y Madrid (zonas de sesión) resuelven el mismo periodo (sáb 26/09 → vie 02/10), uno solo');
ROLLBACK;
SELECT t100_assert(fin_hoy() = fin_dia_negocio(now()), '100-17 fin_hoy() restaurado');

\echo '── 100: recibos con snapshot del salario'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('g1', generar_recibos_nomina(t100_pid('p1'))::text);
UPDATE empleados SET salario_diario = 120 WHERE id = 10001;   -- el catálogo cambia después
INSERT INTO t100_ids VALUES ('g1b', generar_recibos_nomina(t100_pid('p1'))::text);
COMMIT;
SELECT t100_assert((t100_j('g1') ->> 'creados')::int = 2 AND (SELECT count(*) = 2 FROM nomina_recibos WHERE periodo_id = t100_pid('p1'))
  AND NOT EXISTS (SELECT 1 FROM nomina_recibos WHERE periodo_id = t100_pid('p1') AND empleado_id IN (10003, 10004)),
  '100-20 elegibles: activos dados de alta a más tardar el viernes (ni la baja ni el de alta futura)');
SELECT t100_assert((SELECT salario_diario = 100 AND dias_pagados = 6 AND sueldo = 600 AND septimo_dia = 100 AND total_percepciones = 700 AND deducciones = 0 AND neto_a_pagar = 700
                     FROM nomina_recibos WHERE id = t100_rid(t100_pid('p1'), 10001)),
  '100-21 snapshot 100/día; semana completa por omisión = 6 días + séptimo; sin deducción automática (sin IMSS 2%)');
SELECT t100_assert((t100_j('g1b') ->> 'creados')::int = 0 AND (SELECT salario_diario = 100 AND neto_a_pagar = 700 FROM nomina_recibos WHERE id = t100_rid(t100_pid('p1'), 10001)),
  '100-22 salario del catálogo a 120: el recibo sigue en 100 y regenerar no lo reescribe');
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES (10005, 'Emp T100 nuevo', 'Cajera', 'Administración', 150, '2024-01-01', 'Activo');
INSERT INTO t100_ids VALUES ('g1c', generar_recibos_nomina(t100_pid('p1'))::text);
INSERT INTO t100_ids VALUES ('e1', editar_recibo_nomina(t100_rid(t100_pid('p1'), 10001), 5, false)::text);
COMMIT;
SELECT t100_assert((t100_j('g1c') ->> 'creados')::int = 1 AND (SELECT salario_diario = 150 FROM nomina_recibos WHERE id = t100_rid(t100_pid('p1'), 10005))
  AND (SELECT salario_diario = 100 AND sueldo = 500 AND septimo_dia = 0 AND neto_a_pagar = 500 FROM nomina_recibos WHERE id = t100_rid(t100_pid('p1'), 10001)),
  '100-23 generar crea solo el faltante (nuevo empleado a su salario); editar usa el snapshot (5 días × 100, sin séptimo)');

\echo '── 100: componentes reales y totales del servidor'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
-- NOMINA08 (Ángel, 318.93/día): 6 días + séptimo + comisión 2465 + prima dominical 79.73 + puntualidad 213 = 4990.24;
-- aquí además productividad 50, otra percepción 30 y una deducción explícita de 100.
INSERT INTO t100_ids VALUES ('e2', editar_recibo_nomina(t100_rid(t100_pid('p1'), 10002), 6, true, 2465, 79.73, 213, 50, 30, 100)::text);
SELECT t100_err(format('SELECT editar_recibo_nomina(%s, 6, true, -1)', t100_rid(t100_pid('p1'), 10002)), '100-30 importe negativo: rechazado', '22023');
SELECT t100_err(format('SELECT editar_recibo_nomina(%s, 8, true)', t100_rid(t100_pid('p1'), 10002)), '100-31 más de 7 días: rechazado', '22023');
SELECT t100_err(format('SELECT editar_recibo_nomina(%s, 1, false, 0, 0, 0, 0, 0, 500)', t100_rid(t100_pid('p1'), 10002)), '100-32 deducciones mayores que percepciones: rechazado', '22023', '%exceden%');
SELECT t100_err(format('SELECT editar_recibo_nomina(%s, NULL, true)', t100_rid(t100_pid('p1'), 10002)), '100-33 días nulos: rechazado', '22023');
SELECT t100_err(format('UPDATE nomina_recibos SET neto_a_pagar = 1, total_percepciones = 1, sueldo = 1 WHERE id = %s', t100_rid(t100_pid('p1'), 10002)), '100-34 UPDATE directo de totales del recibo: denegado', '42501');
SELECT t100_err(format('UPDATE nomina_periodos SET total_neto = 1, total_percepciones = 1 WHERE id = %s', t100_pid('p1')), '100-35 UPDATE directo de totales del periodo (Borrador): denegado', '42501');
COMMIT;
SELECT t100_assert((SELECT sueldo = 1913.58 AND septimo_dia = 318.93 AND comisiones = 2465 AND prima_dominical = 79.73 AND bono_puntualidad = 213 AND bono_productividad = 50
                      AND otras_percepciones = 30 AND total_percepciones = 5070.24 AND deducciones = 100 AND neto_a_pagar = 4970.24
                     FROM nomina_recibos WHERE id = t100_rid(t100_pid('p1'), 10002)) AND (t100_j('e2') ->> 'neto_a_pagar')::numeric = 4970.24,
  '100-36 recibo real: el servidor calcula percepciones 5070.24 (4990.24 de NOMINA08 + 80) y neto 4970.24');
SELECT t100_assert((SELECT total_percepciones = 500 + 5070.24 + 1050 AND total_deducciones = 100 AND total_neto = 500 + 4970.24 + 1050 FROM nomina_periodos WHERE id = t100_pid('p1')),
  '100-37 totales del periodo = suma de sus recibos (servidor)');

\echo '── 100: pago'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
SELECT t100_err(format('SELECT pagar_nomina(%s)', t100_pid('p2')), '100-40 periodo sin recibos: no se paga', '22023', '%No hay neto%');
INSERT INTO t100_ids VALUES ('g3', generar_recibos_nomina(t100_pid('p3'))::text);
SELECT editar_recibo_nomina(id, 0, false) FROM nomina_recibos WHERE periodo_id = t100_pid('p3');
SELECT t100_err(format('SELECT pagar_nomina(%s)', t100_pid('p3')), '100-41 recibos en cero: no se paga', '22023', '%No hay neto%');
COMMIT;
-- Totales que no concilian (alterados fuera de la API): el pago se niega.
BEGIN; SET LOCAL ROLE service_role;
UPDATE nomina_periodos SET total_percepciones = total_percepciones + 1, total_neto = total_neto + 1 WHERE id = t100_pid('p1');
SELECT t100_err(format('SELECT pagar_nomina(%s)', t100_pid('p1')), '100-42 totales del periodo que no concilian con los recibos: no se paga', '22023', '%no concilian%');
ROLLBACK;
INSERT INTO t100_ids VALUES ('r0', reporte_financiero(fin_hoy(), fin_hoy())::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('pay', pagar_nomina(t100_pid('p1'))::text);
INSERT INTO t100_ids VALUES ('pay_r', pagar_nomina(t100_pid('p1'))::text);
COMMIT;
INSERT INTO t100_ids VALUES ('r1', reporte_financiero(fin_hoy(), fin_hoy())::text);
SELECT t100_assert((t100_j('pay') ->> 'total_neto')::numeric = 6520.24 AND (t100_j('pay') ->> 'recibos')::int = 3 AND (t100_j('pay') ->> 'fecha')::date = fin_hoy()
  AND (t100_j('pay_r') ->> 'replay') = 'true' AND (t100_j('pay_r') ->> 'movimiento_id') = (t100_j('pay') ->> 'movimiento_id'),
  '100-43 pago: neto del servidor (500 + 4970.24 + 1050) con fecha fin_hoy(); el reintento es replay');
SELECT t100_assert((SELECT count(*) = 1 AND bool_and(monto = 6520.24 AND categoria = 'Nómina' AND tipo = 'Egreso' AND fecha = fin_hoy()) FROM movimientos_contables WHERE id = (t100_j('pay') ->> 'movimiento_id')::bigint)
  AND (SELECT count(*) = 1 AND bool_and(monto = 6520.24 AND tipo = 'Nómina' AND fecha = fin_hoy()) FROM costos_historial WHERE movimiento_id = (t100_j('pay') ->> 'movimiento_id')::bigint)
  AND (SELECT estatus = 'Pagado' AND pagado_at IS NOT NULL AND pagado_por = 'Admin T100' AND total_neto = 6520.24 FROM nomina_periodos WHERE id = t100_pid('p1'))
  AND (SELECT bool_and(estatus = 'Pagado') FROM nomina_recibos WHERE periodo_id = t100_pid('p1')),
  '100-44 exactamente un egreso, un costo de nómina y un periodo Pagado (recibos Pagado)');
SELECT t100_assert(((t100_j('r1') -> 'resultados' ->> 'nomina')::numeric - (t100_j('r0') -> 'resultados' ->> 'nomina')::numeric) = 6520.24
  AND ((t100_j('r1') -> 'flujo' ->> 'salidas_nomina')::numeric - (t100_j('r0') -> 'flujo' ->> 'salidas_nomina')::numeric) = 6520.24
  AND (t100_j('r1') -> 'resultados' ->> 'otros_gastos') = (t100_j('r0') -> 'resultados' ->> 'otros_gastos')
  AND (t100_j('r1') -> 'flujo' ->> 'salidas_otras') = (t100_j('r0') -> 'flujo' ->> 'salidas_otras')
  AND (t100_j('r1') -> 'flujo' ->> 'salidas_costos') = (t100_j('r0') -> 'flujo' ->> 'salidas_costos'),
  '100-45 reporte 093: +6520.24 en Nómina (resultados) y en Nómina pagada (flujo), una vez; nada en otros rubros');
SELECT t100_assert(NOT EXISTS (SELECT 1 FROM costos_historial ch JOIN nomina_periodos p ON p.movimiento_id = ch.movimiento_id WHERE p.estatus = 'Borrador')
  AND (SELECT total_neto > 0 FROM nomina_periodos WHERE id = t100_pid('p4')) IS NOT TRUE, '100-46 Borrador sin pago: sin costo, sin salida, sin pasivo');

\echo '── 100: inmutabilidad del Pagado'
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
SELECT t100_err(format('UPDATE nomina_periodos SET total_neto = 1, total_percepciones = 1 WHERE id = %s', t100_pid('p1')), '100-50 UPDATE de totales del pagado: denegado', '42501');
SELECT t100_err(format($q$UPDATE nomina_periodos SET estatus = 'Borrador' WHERE id = %s$q$, t100_pid('p1')), '100-51 regresar a Borrador: denegado', '42501');
SELECT t100_err(format('UPDATE nomina_periodos SET movimiento_id = NULL WHERE id = %s', t100_pid('p1')), '100-52 limpiar movimiento_id: denegado', '42501');
SELECT t100_err(format($q$UPDATE nomina_periodos SET fecha_pago = fecha_pago + 7 WHERE id = %s$q$, t100_pid('p1')), '100-53 cambiar fechas: denegado', '42501');
SELECT t100_err(format($q$INSERT INTO nomina_periodos (periodo, fecha_inicio, fecha_fin, fecha_pago) SELECT 'dup', fecha_inicio, fecha_fin, fecha_pago FROM nomina_periodos WHERE id = %s$q$, t100_pid('p1')),
  '100-54 INSERT directo de un periodo duplicado: denegado', '42501');
SELECT t100_err(format('INSERT INTO nomina_recibos (periodo_id, empleado_id, salario_diario) VALUES (%s, 10003, 1)', t100_pid('p1')), '100-55 INSERT de recibo en el pagado: denegado', '42501');
SELECT t100_err(format('UPDATE nomina_recibos SET comisiones = 1 WHERE periodo_id = %s', t100_pid('p1')), '100-56 UPDATE de recibo pagado: denegado', '42501');
SELECT t100_err(format('DELETE FROM nomina_recibos WHERE periodo_id = %s', t100_pid('p1')), '100-57 DELETE de recibo pagado: denegado', '42501');
SELECT t100_err(format('DELETE FROM nomina_periodos WHERE id = %s', t100_pid('p1')), '100-58 DELETE del periodo pagado: denegado', '42501');
SELECT t100_err(format('SELECT generar_recibos_nomina(%s)', t100_pid('p1')), '100-59 generar recibos en el pagado: rechazado', '22023', '%pagado%');
SELECT t100_err(format('SELECT editar_recibo_nomina(%s, 6, true)', t100_rid(t100_pid('p1'), 10002)), '100-60 editar recibo del pagado: rechazado', '22023', '%pagado%');
SELECT t100_err(format('UPDATE movimientos_contables SET monto = 1 WHERE id = %s', (t100_j('pay') ->> 'movimiento_id')), '100-61 editar el egreso del pago de nómina: denegado', '42501');
SELECT t100_err(format('DELETE FROM movimientos_contables WHERE id = %s', (t100_j('pay') ->> 'movimiento_id')), '100-62 borrar el egreso del pago de nómina: denegado', '42501');
SELECT t100_err($q$INSERT INTO costos_historial (tipo, categoria, concepto, monto) VALUES ('Nómina', 'Nómina', 'T100 costo', 1)$q$, '100-63 costo de nómina por API: denegado', '42501');
-- Cliente anterior a 098: su primer paso era este egreso; se niega antes de escribir nada.
SELECT t100_err($q$INSERT INTO movimientos_contables (tipo, categoria, concepto, monto) VALUES ('Egreso', 'Nómina', 'Pago nómina T100', 5)$q$, '100-64 egreso "Pago nómina …" por API (cliente anterior): denegado', '42501');
INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto) VALUES ('2026-08-15', 'Egreso', 'Nómina', 'T100 manual nómina', 5);
COMMIT;
SELECT t100_assert((SELECT fecha = '2026-08-15' FROM movimientos_contables WHERE concepto = 'T100 manual nómina'), '100-65 asiento manual de categoría Nómina (otro concepto): se conserva');
BEGIN; SET LOCAL ROLE service_role;
SELECT t100_err(format('UPDATE nomina_periodos SET total_neto = 1, total_percepciones = 1 WHERE id = %s', t100_pid('p1')), '100-66 service_role tampoco reescribe un pagado', '42501');
SELECT t100_err(format('DELETE FROM nomina_recibos WHERE periodo_id = %s', t100_pid('p1')), '100-67 service_role tampoco borra recibos de un pagado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t100_actor(1);
INSERT INTO t100_ids VALUES ('p1_again', crear_periodo_nomina((SELECT fecha_inicio FROM nomina_periodos WHERE id = t100_pid('p1')))::text);
COMMIT;
SELECT t100_assert((t100_j('p1_again') ->> 'replay') = 'true' AND (t100_j('p1_again') ->> 'estatus') = 'Pagado' AND t100_pid('p1_again') = t100_pid('p1'),
  '100-68 crear la semana ya pagada devuelve el mismo periodo (Pagado), sin duplicar');
SELECT t100_assert((SELECT count(*) = 1 FROM movimientos_contables WHERE categoria = 'Nómina' AND concepto LIKE 'Pago nómina %' AND id = (t100_j('pay') ->> 'movimiento_id')::bigint)
  AND (SELECT total_neto = 6520.24 AND estatus = 'Pagado' FROM nomina_periodos WHERE id = t100_pid('p1')), '100-69 tras los intentos: el periodo y su egreso siguen intactos');

\echo '── 100: privilegios (101)'
DO $do$
BEGIN
  IF has_table_privilege('authenticated', 'public.nomina_periodos', 'INSERT') THEN
    RAISE NOTICE 'OK: 100-70 antes de 101: las guardas niegan la escritura directa';
  ELSE
    PERFORM t100_assert(NOT has_table_privilege('authenticated', 'public.nomina_periodos', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.nomina_periodos', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.nomina_recibos', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.nomina_recibos', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.nomina_recibos', 'DELETE') AND has_table_privilege('authenticated', 'public.nomina_periodos', 'SELECT')
      AND has_table_privilege('authenticated', 'public.nomina_recibos', 'SELECT')
      AND NOT has_sequence_privilege('authenticated', pg_get_serial_sequence('public.nomina_periodos', 'id'), 'USAGE')
      AND NOT has_sequence_privilege('authenticated', pg_get_serial_sequence('public.nomina_recibos', 'id'), 'USAGE'),
      '100-70 tras 101: authenticated solo SELECT en periodos y recibos');
  END IF;
END $do$;

BEGIN; SELECT t100_limpiar(); COMMIT;
SELECT t100_assert(to_regclass('public.t100_emp_apartados') IS NULL AND NOT EXISTS (SELECT 1 FROM empleados WHERE id BETWEEN 10001 AND 10009)
  AND NOT EXISTS (SELECT 1 FROM nomina_periodos WHERE creado_por = 'Admin T100'), '100-71 limpieza: empleados ajenos restaurados, sin periodos de prueba');
\echo '── 100: TODAS LAS PRUEBAS OK'
