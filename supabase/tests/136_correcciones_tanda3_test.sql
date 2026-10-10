-- 136_correcciones_tanda3_test.sql — tanda 3 de la revisión del 2026-10-10:
-- Mi asistencia tras la salida y con una salida olvidada, captura manual de
-- asistencia, avisos (medianoche, usuario inactivo), faltas para la nómina de
-- quien no puede marcar y cierre de ruta con una orden de otra ruta.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t136_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM asistencia_avisos WHERE empleado_id BETWEEN 13601 AND 13609;
  DELETE FROM asistencia_correcciones WHERE asistencia_id IN (SELECT id FROM asistencias WHERE empleado_id BETWEEN 13601 AND 13609);
  DELETE FROM asistencia_intentos WHERE empleado_id BETWEEN 13601 AND 13609;
  DELETE FROM asistencias WHERE empleado_id BETWEEN 13601 AND 13609;
  DELETE FROM turnos WHERE empleado_id BETWEEN 13601 AND 13609;
  DELETE FROM centros_trabajo WHERE id = 13601;
  DELETE FROM empleados WHERE id BETWEEN 13601 AND 13609;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id IN (13601, 13602);
  DELETE FROM movimientos_contables WHERE orden_id IN (13601, 13602);
  DELETE FROM pagos WHERE orden_id IN (13601, 13602);
  DELETE FROM orden_lineas WHERE orden_id IN (13601, 13602);
  DELETE FROM ordenes WHERE id IN (13601, 13602);
  DELETE FROM rutas WHERE id IN (13601, 13602);
  DELETE FROM clientes WHERE id = 13601;
  DELETE FROM auditoria WHERE usuario = 'Admin T136' OR detalle LIKE '%T136%' OR detalle LIKE 'OV-136%';
  DELETE FROM usuarios WHERE id BETWEEN 13601 AND 13609;
  DELETE FROM auth.users WHERE id::text LIKE '13600000-%';
  IF to_regclass('public.t136_cfg') IS NOT NULL THEN
    UPDATE asistencia_avisos_config c SET (activo, empleado_antes_min, empleado_tarde, empleado_salida_min, jefes_sin_marcar_min, jefes_retardo, jefes_sin_salida_min, jefes, actualizado_por, updated_at)
      = (SELECT activo, empleado_antes_min, empleado_tarde, empleado_salida_min, jefes_sin_marcar_min, jefes_retardo, jefes_sin_salida_min, jefes, actualizado_por, updated_at FROM t136_cfg);
    DROP TABLE t136_cfg;
  END IF;
  IF to_regclass('public.t136_turnos_apartados') IS NOT NULL THEN
    UPDATE turnos t SET activo = true FROM t136_turnos_apartados a WHERE a.id = t.id;
    DROP TABLE t136_turnos_apartados;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION t136_ts(p_hora TIME, p_dias INTEGER DEFAULT 0) RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT ((fin_hoy() + p_dias + p_hora)::timestamp AT TIME ZONE fin_zona_negocio())
$$;
-- Hora local de ahora + minutos (para turnos alrededor del instante real: mi_asistencia usa now()).
CREATE OR REPLACE FUNCTION t136_hora(p_min INTEGER) RETURNS TIME LANGUAGE sql STABLE AS $$
  SELECT date_trunc('minute', (now() AT TIME ZONE fin_zona_negocio()) + make_interval(mins => p_min))::time
$$;
CREATE OR REPLACE FUNCTION t136_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t136_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t136_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '13600000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
GRANT EXECUTE ON FUNCTION t136_ts(TIME, INTEGER), t136_hora(INTEGER), t136_assert(BOOLEAN, TEXT), t136_err(TEXT, TEXT, TEXT, TEXT), t136_actor(INTEGER) TO PUBLIC;
DROP TABLE IF EXISTS t136_ids;
CREATE TEMP TABLE t136_ids (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t136_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t136_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t136_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t136_j(TEXT) TO PUBLIC;

BEGIN; SELECT t136_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE t136_cfg AS SELECT * FROM asistencia_avisos_config WHERE id = 1;
CREATE TABLE t136_turnos_apartados AS SELECT id FROM turnos WHERE activo;
UPDATE turnos SET activo = false WHERE id IN (SELECT id FROM t136_turnos_apartados);
UPDATE asistencia_avisos_config SET activo = true, empleado_antes_min = 10, empleado_tarde = true, empleado_salida_min = 5,
       jefes_sin_marcar_min = 15, jefes_retardo = true, jefes_sin_salida_min = 60, jefes = 'admins' WHERE id = 1;
INSERT INTO auth.users (id, email) SELECT ('13600000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t136' FROM generate_series(1, 8) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, es_dueno) VALUES
  (13601, 'Admin T136',    'u1@t136', 'Admin',    'Activo',   '13600000-0000-0000-0000-000000000001', false),
  (13602, 'Terminó T136',  'u2@t136', 'Empleado', 'Activo',   '13600000-0000-0000-0000-000000000002', false),
  (13603, 'Olvidó T136',   'u3@t136', 'Empleado', 'Activo',   '13600000-0000-0000-0000-000000000003', false),
  (13604, 'Noche T136',    'u4@t136', 'Empleado', 'Activo',   '13600000-0000-0000-0000-000000000004', false),
  (13605, 'Baja T136',     'u5@t136', 'Empleado', 'Inactivo', '13600000-0000-0000-0000-000000000005', false),
  (13606, 'Chofer T136',   'u6@t136', 'Chofer',   'Activo',   '13600000-0000-0000-0000-000000000006', false),
  (13607, 'Ventas T136',   'u7@t136', 'Ventas',   'Activo',   '13600000-0000-0000-0000-000000000007', false),
  (13608, 'Chofer B T136', 'u8@t136', 'Chofer',   'Activo',   '13600000-0000-0000-0000-000000000008', false);
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id) VALUES
  (13601, 'Terminó T136', 'Operador', 'Producción', 100, '2024-01-01', 'Activo', 13602),
  (13602, 'Olvidó T136',  'Operador', 'Producción', 100, '2024-01-01', 'Activo', 13603),
  (13603, 'Sinlink T136', 'Operador', 'Producción', 100, '2024-01-01', 'Activo', NULL),
  (13604, 'Noche T136',   'Operador', 'Producción', 100, '2024-01-01', 'Activo', 13604),
  (13605, 'Baja T136',    'Operador', 'Producción', 100, '2024-01-01', 'Activo', 13605),
  (13606, 'Día T136',     'Operador', 'Producción', 100, '2024-01-01', 'Activo', 13607);
INSERT INTO centros_trabajo (id, nombre, latitud, longitud, radio_m, precision_max_m, activo) VALUES (13601, 'Centro T136', 24, -104, 100, 50, true);
INSERT INTO turnos (id, empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde) VALUES
  -- Terminó: su turno de hoy acabó hace una hora.
  (13601, 13601, 13601, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], t136_hora(-180), t136_hora(-60), 10, '2024-01-01'),
  -- Olvidó: ayer tuvo un turno (solo ese día de la semana) y hoy tiene otro que ya empezó.
  (13602, 13602, 13601, ARRAY[EXTRACT(ISODOW FROM fin_hoy() - 1)::int]::SMALLINT[], t136_hora(60), t136_hora(120), 10, '2024-01-01'),
  (13603, 13602, 13601, ARRAY[EXTRACT(ISODOW FROM fin_hoy())::int]::SMALLINT[], t136_hora(-30), t136_hora(120), 10, '2024-01-01'),
  -- Sinlink (sin usuario) y Día: 08:00–16:00 toda la semana.
  (13604, 13603, 13601, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13607, 13606, 13601, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  -- Noche y Baja: entran a las 00:05.
  (13605, 13604, 13601, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '00:05', '08:00', 10, '2024-01-01'),
  (13606, 13605, 13601, ARRAY[1,2,3,4,5,6,7]::SMALLINT[], '00:05', '08:00', 10, '2024-01-01');
-- Terminó: entrada y salida de hoy. Olvidó: entrada de ayer (hace 23 h) sin salida.
INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min, radio_m, precision_max_m,
                         entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m, entrada_estado, minutos_retardo, operacion_entrada,
                         salida_at, salida_lat, salida_lng, salida_precision_m, salida_distancia_m, salida_dentro, operacion_salida, minutos_trabajados)
VALUES (13601, 13602, 13601, 13601, fin_hoy(), now() - interval '180 minutes', now() - interval '60 minutes', 10, 100, 50,
        now() - interval '179 minutes', 24, -104, 10, 5, 'a_tiempo', 0, gen_random_uuid(),
        now() - interval '59 minutes', 24, -104, 10, 5, true, gen_random_uuid(), 120),
       (13602, 13603, 13602, 13601, fin_hoy() - 1, now() - interval '23 hours', now() - interval '22 hours', 10, 100, 50,
        now() - interval '23 hours', 24, -104, 10, 5, 'a_tiempo', 0, gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
-- Cierre de ruta: dos rutas (un chofer cada una); la orden 13602 es de la OTRA ruta.
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (13601, 'Cliente T136', 'XAXX010101000', 0, false, 0);
INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (13601, 'R-13601', 'T136 ruta A', 'En progreso', 13606, '{}', '{}', '{}', '{}'),
  (13602, 'R-13602', 'T136 ruta B', 'En progreso', 13608, '{}', '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
  (13601, 'OV-13601', 13601, 'Cliente T136', 'x', 40, 'En ruta', 'Efectivo', 'Contado', 13601),
  (13602, 'OV-13602', 13601, 'Cliente T136', 'x', 40, 'En ruta', 'Efectivo', 'Contado', 13602);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'HPC-5K', 2, 20, 40 FROM ordenes WHERE id IN (13601, 13602);
COMMIT;

\echo '── 136: Mi asistencia'
-- Las dos pruebas de Mi asistencia dependen de la hora real; cerca de la medianoche los turnos
-- de la prueba cruzarían de día y no dicen nada: se omiten (el resto de la suite sí corre).
CREATE OR REPLACE FUNCTION t136_de_dia() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE fin_zona_negocio())::time BETWEEN '03:30' AND '21:30' $$;
GRANT EXECUTE ON FUNCTION t136_de_dia() TO PUBLIC;
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(2);
INSERT INTO t136_ids VALUES ('m1', mi_asistencia());
COMMIT;
SELECT t136_assert(NOT t136_de_dia() OR t136_j('m1') ->> 'estado' = 'completa' AND t136_j('m1') ->> 'accion' IS NULL
  AND t136_j('m1') -> 'asistencia' ->> 'empleado_id' = '13601' AND t136_j('m1') -> 'asistencia' ->> 'salida_at' IS NOT NULL AND t136_j('m1') -> 'turno_aplicable' = 'null'::jsonb,
  '136-01 al terminar el turno la pantalla conserva la entrada y la salida de hoy (antes: fuera de horario, en blanco)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(3);
INSERT INTO t136_ids VALUES ('m2', mi_asistencia());
COMMIT;
SELECT t136_assert(NOT t136_de_dia() OR t136_j('m2') ->> 'estado' = 'pendiente' AND t136_j('m2') ->> 'accion' = 'entrada' AND t136_j('m2') -> 'asistencia' = 'null'::jsonb
  AND t136_j('m2') -> 'salida_olvidada' ->> 'fecha_laboral' = (fin_hoy() - 1)::text,
  '136-02 la salida olvidada de ayer no bloquea la entrada de hoy: toca marcar ENTRADA y la de ayer queda como olvidada');
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(3);
INSERT INTO t136_ids SELECT 'e2', registrar_entrada('13600000-bbbb-0000-0000-000000000001'::uuid, 24, -104, 10) WHERE t136_de_dia();
INSERT INTO t136_ids VALUES ('m3', mi_asistencia());
COMMIT;
SELECT t136_assert(NOT t136_de_dia() OR ((t136_j('e2') ->> 'ok')::boolean AND t136_j('m3') ->> 'accion' = 'salida' AND t136_j('m3') -> 'asistencia' ->> 'fecha_laboral' = fin_hoy()::text)
  AND (SELECT salida_at IS NULL FROM asistencias WHERE empleado_id = 13602 AND fecha_laboral = fin_hoy() - 1),
  '136-03 marca la entrada de hoy; ahora toca la salida de HOY y la de ayer sigue abierta para Administración');

\echo '── 136: captura manual de una asistencia'
SELECT t136_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                      FROM pg_proc WHERE oid = 'public.registrar_asistencia_manual(uuid,bigint,date,timestamptz,timestamptz,text)'::regprocedure),
  '136-04 contrato SECURITY DEFINER con search_path fijo, sin anon');
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(7);
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('08:20', -1), NULL, 'No tenía señal')$q$,
  '136-05 Ventas no captura asistencias', '42501');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(1);
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('08:20', -1), NULL, 'x')$q$,
  '136-06 sin motivo: rechazo', '22023', '%motivo%');
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() + 1, t136_ts('08:20', 1), NULL, 'No tenía señal')$q$,
  '136-07 día futuro: rechazo', '22023', '%aún no llega%');
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('20:00', -1), NULL, 'No tenía señal')$q$,
  '136-08 hora fuera del turno: rechazo', '22023', '%no corresponde al turno%');
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('08:20', -1), t136_ts('08:10', -1), 'No tenía señal')$q$,
  '136-09 salida antes de la entrada: rechazo', '22023', '%posterior a la entrada%');
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13602, fin_hoy() - 3, t136_ts('08:20', -3), NULL, 'No tenía señal')$q$,
  '136-10 día sin turno: rechazo', '22023', '%no tiene turno ese día%');
INSERT INTO t136_ids VALUES ('c1', registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('08:20', -1), t136_ts('16:05', -1), 'No tenía señal en el teléfono'));
INSERT INTO t136_ids VALUES ('c1b', registrar_asistencia_manual('13600000-cccc-0000-0000-000000000001', 13603, fin_hoy() - 1, t136_ts('08:20', -1), t136_ts('16:05', -1), 'No tenía señal en el teléfono'));
SELECT t136_err($q$SELECT registrar_asistencia_manual('13600000-cccc-0000-0000-000000000002', 13603, fin_hoy() - 1, t136_ts('08:00', -1), NULL, 'Otra vez el mismo día')$q$,
  '136-11 ya tiene asistencia ese día: se corrige, no se captura otra', '22023', '%ya tiene asistencia%');
COMMIT;
SELECT t136_assert((t136_j('c1') ->> 'ok')::boolean AND NOT (t136_j('c1') ->> 'replay')::boolean AND (t136_j('c1b') ->> 'replay')::boolean
  AND t136_j('c1') -> 'asistencia' ->> 'id' = t136_j('c1b') -> 'asistencia' ->> 'id'
  AND (SELECT count(*) = 1 FROM asistencias WHERE empleado_id = 13603),
  '136-12 captura con entrada y salida; el reintento con la misma operación devuelve lo mismo, sin duplicar');
SELECT t136_assert((SELECT entrada_estado = 'retardo' AND minutos_retardo = 20 AND minutos_trabajados = 465 AND entrada_corregida_at = t136_ts('08:20', -1)
                           AND salida_corregida_at = t136_ts('16:05', -1) AND salida_at IS NULL AND usuario_id = 13601 AND entrada_distancia_m = 0
                      FROM asistencias WHERE empleado_id = 13603),
  '136-13 08:20 con tolerancia de 10 = retardo de 20 min; 465 min trabajados; horas marcadas como corregidas');
SELECT t136_assert((SELECT count(*) = 2 AND bool_and(motivo = 'Captura manual: No tenía señal en el teléfono' AND actor_id = 13601 AND valor_anterior IS NULL)
                      FROM asistencia_correcciones WHERE asistencia_id = (t136_j('c1') -> 'asistencia' ->> 'id')::bigint)
  AND (SELECT count(*) = 1 FROM auditoria WHERE modulo = 'Asistencia' AND accion = 'Capturar' AND detalle LIKE 'Sinlink T136%'),
  '136-14 queda en el historial inmutable (entrada y salida, motivo y quién) y en auditoría');

\echo '── 136: faltas para la nómina'
SELECT t136_assert((SELECT dias_programados = 0 AND faltas = 0 AND asistencias = 1 FROM nomina_asistencia_semana(13603, fin_hoy() - 3, fin_hoy() - 1, t136_ts('23:00', -1))),
  '136-15 sin usuario ligado no puede marcar: no se le cuentan faltas (antes 2); su captura manual sí cuenta');
SELECT t136_assert((SELECT dias_programados = 3 AND faltas = 3 AND asistencias = 0 FROM nomina_asistencia_semana(13606, fin_hoy() - 3, fin_hoy() - 1, t136_ts('23:00', -1))),
  '136-16 quien sí puede marcar y no marcó: 3 faltas (sin cambio)');

\echo '── 136: avisos'
INSERT INTO t136_ids VALUES ('a1', asistencia_generar_avisos(t136_ts('23:57')));
SELECT t136_assert((SELECT count(*) = 1 FROM asistencia_avisos WHERE empleado_id = 13604 AND tipo = 'entrada_proxima' AND fecha_laboral = fin_hoy() + 1 AND destino = 'empleado')
  AND (SELECT a ->> 'usuario_id' = '13604' FROM jsonb_array_elements(t136_j('a1') -> 'avisos') a WHERE a ->> 'tipo' = 'entrada_proxima' LIMIT 1),
  '136-17 turno de las 00:05: el aviso "antes de tu entrada" sale a las 23:57 del día anterior (antes nunca salía)');
SELECT t136_assert(NOT EXISTS (SELECT 1 FROM asistencia_avisos WHERE empleado_id = 13605 AND destino = 'empleado'),
  '136-18 persona con usuario dado de baja: no recibe avisos');
INSERT INTO t136_ids VALUES ('a2', asistencia_generar_avisos(t136_ts('00:03', 1)));
SELECT t136_assert((SELECT count(*) = 1 FROM asistencia_avisos WHERE empleado_id = 13604 AND tipo = 'entrada_proxima'),
  '136-19 el aviso no se repite al cruzar la medianoche');

\echo '── 136: cierre de ruta'
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(6);
SELECT t136_err($q$SELECT cerrar_ruta_financiero('13600000-dddd-0000-0000-000000000001'::uuid, 13601, '[{"ordenId":13601,"pago":"Efectivo"},{"ordenId":13602,"pago":"Efectivo"}]'::jsonb)$q$,
  '136-20 una orden de OTRA ruta no se cierra en esta', '22023', '%es de otra ruta%');
COMMIT;
SELECT t136_assert((SELECT bool_and(estatus = 'En ruta') FROM ordenes WHERE id IN (13601, 13602)) AND NOT EXISTS (SELECT 1 FROM pagos WHERE orden_id IN (13601, 13602))
  AND NOT EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = 13601),
  '136-21 el rechazo no deja nada a medias (ni órdenes entregadas, ni pagos, ni cierre)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t136_actor(6);
SELECT t136_assert((cerrar_ruta_financiero('13600000-dddd-0000-0000-000000000002'::uuid, 13601, '[{"ordenId":13601,"pago":"Efectivo"}]'::jsonb) ->> 'success')::boolean,
  '136-22 la orden de la propia ruta se cierra igual que antes');
COMMIT;
SELECT t136_assert((SELECT estatus = 'Entregada' FROM ordenes WHERE id = 13601) AND (SELECT estatus = 'En ruta' AND ruta_id = 13602 FROM ordenes WHERE id = 13602)
  AND (SELECT count(*) = 1 AND sum(monto) = 40 FROM pagos WHERE orden_id = 13601),
  '136-23 entregada y cobrada; la orden de la otra ruta, intacta');

BEGIN; SELECT t136_limpiar(); COMMIT;
SELECT t136_assert(to_regclass('public.t136_cfg') IS NULL AND to_regclass('public.t136_turnos_apartados') IS NULL
  AND NOT EXISTS (SELECT 1 FROM empleados WHERE id BETWEEN 13601 AND 13609) AND NOT EXISTS (SELECT 1 FROM ordenes WHERE id IN (13601, 13602)),
  '136-24 limpieza: sin fixtures; la configuración de avisos vuelve a como estaba');
DROP FUNCTION t136_limpiar(), t136_ts(TIME, INTEGER), t136_hora(INTEGER), t136_assert(BOOLEAN, TEXT), t136_err(TEXT, TEXT, TEXT, TEXT), t136_actor(INTEGER), t136_j(TEXT), t136_de_dia();
\echo '── 136: TODAS LAS PRUEBAS OK'
