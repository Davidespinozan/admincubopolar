-- 130_nomina_automatica_test.sql — NOM-2: comisiones calculadas con ventas o
-- entregas (una orden se comisiona una sola vez), percepciones condicionadas a
-- la asistencia, recálculo del borrador que respeta lo editado a mano, e
-- inmutabilidad del Pagado.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t130_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;  -- limpieza de fixtures: sin guardas
  DELETE FROM costos_historial WHERE movimiento_id IN (SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T130');
  CREATE TEMP TABLE IF NOT EXISTS t130_movs (id BIGINT);
  DELETE FROM t130_movs;
  INSERT INTO t130_movs SELECT movimiento_id FROM nomina_periodos WHERE creado_por = 'Admin T130' AND movimiento_id IS NOT NULL;
  DELETE FROM nomina_linea_ordenes WHERE empleado_id BETWEEN 13001 AND 13009 OR orden_id BETWEEN 13001 AND 13099;
  DELETE FROM nomina_recibo_lineas WHERE recibo_id IN (SELECT id FROM nomina_recibos
    WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por = 'Admin T130') OR empleado_id BETWEEN 13001 AND 13009);
  DELETE FROM nomina_recibos WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por = 'Admin T130') OR empleado_id BETWEEN 13001 AND 13009;
  DELETE FROM nomina_periodos WHERE creado_por = 'Admin T130';
  DELETE FROM movimientos_contables WHERE id IN (SELECT id FROM t130_movs);
  DELETE FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id IN (SELECT id::text FROM nomina_conceptos WHERE creado_por = 'Admin T130');
  DELETE FROM nomina_concepto_empleados WHERE concepto_id IN (SELECT id FROM nomina_conceptos WHERE creado_por = 'Admin T130') OR empleado_id BETWEEN 13001 AND 13009;
  DELETE FROM nomina_conceptos WHERE creado_por = 'Admin T130';
  DELETE FROM auditoria WHERE usuario = 'Admin T130';
  DELETE FROM asistencia_correcciones WHERE asistencia_id IN (SELECT id FROM asistencias WHERE empleado_id BETWEEN 13001 AND 13009);
  DELETE FROM asistencias WHERE empleado_id BETWEEN 13001 AND 13009;
  DELETE FROM turnos WHERE empleado_id BETWEEN 13001 AND 13009;
  DELETE FROM centros_trabajo WHERE id = 13001;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 13001 AND 13099;
  DELETE FROM ordenes WHERE id BETWEEN 13001 AND 13099;
  DELETE FROM rutas WHERE id BETWEEN 13001 AND 13009;
  DELETE FROM productos WHERE sku IN ('T130-A', 'T130-B');
  DELETE FROM empleados WHERE id BETWEEN 13001 AND 13009;
  IF to_regclass('public.t130_emp_apartados') IS NOT NULL THEN
    UPDATE empleados e SET estatus = a.estatus FROM t130_emp_apartados a WHERE a.id = e.id;
    DROP TABLE t130_emp_apartados;
  END IF;
  IF to_regclass('public.t130_con_apartados') IS NOT NULL THEN
    UPDATE nomina_conceptos c SET activo = true FROM t130_con_apartados a WHERE a.id = c.id;
    DROP TABLE t130_con_apartados;
  END IF;
  DELETE FROM usuarios WHERE id BETWEEN 13001 AND 13009;
  DELETE FROM auth.users WHERE id::text LIKE '13000000-%';
END $$;

-- Instante local (zona del negocio) de un día de la semana p_sem (1 = hace dos
-- semanas, 2 = la semana pasada, 3 = la actual), p_dia días después del sábado.
CREATE OR REPLACE FUNCTION t130_ts(p_sem INTEGER, p_dia INTEGER, p_hora TIME) RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT ((nomina_inicio_semana(fin_hoy() - (3 - p_sem) * 7) + p_dia + p_hora)::timestamp AT TIME ZONE fin_zona_negocio())
$$;
CREATE OR REPLACE FUNCTION t130_dia(p_sem INTEGER, p_dia INTEGER) RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT nomina_inicio_semana(fin_hoy() - (3 - p_sem) * 7) + p_dia
$$;
-- Orden entregada con una o dos líneas (fixture directo: sin contratos de venta).
CREATE OR REPLACE FUNCTION t130_orden(p_id BIGINT, p_vendedor BIGINT, p_ruta BIGINT, p_estatus TEXT, p_entrega TIMESTAMPTZ, p_a INTEGER, p_b INTEGER) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO ordenes (id, folio, cliente_nombre, productos, fecha, total, estatus, vendedor_id, ruta_id, tipo_cobro, delivered_at)
  VALUES (p_id, 'T130-' || p_id, 'Cliente T130', 'fixture', COALESCE((p_entrega AT TIME ZONE fin_zona_negocio())::date, fin_hoy()),
          p_a * 30 + p_b * 100, p_estatus, p_vendedor, p_ruta, 'Contado', p_entrega);
  IF p_a > 0 THEN INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (p_id, 'T130-A', p_a, 30, p_a * 30); END IF;
  IF p_b > 0 THEN INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (p_id, 'T130-B', p_b, 100, p_b * 100); END IF;
  SET LOCAL session_replication_role = origin;
END $$;
-- Marca de entrada de un día (fixture directo).
CREATE OR REPLACE FUNCTION t130_marca(p_emp BIGINT, p_usuario BIGINT, p_turno BIGINT, p_sem INTEGER, p_dia INTEGER, p_min_tarde INTEGER) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min, radio_m, precision_max_m,
                           entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m, entrada_estado, minutos_retardo, operacion_entrada)
  VALUES (p_emp, p_usuario, p_turno, 13001, t130_dia(p_sem, p_dia), t130_ts(p_sem, p_dia, '08:00'), t130_ts(p_sem, p_dia, '16:00'), 10, 100, 50,
          t130_ts(p_sem, p_dia, '08:00') + make_interval(mins => p_min_tarde), 24, -104, 10, 5,
          CASE WHEN p_min_tarde > 10 THEN 'retardo' ELSE 'a_tiempo' END, CASE WHEN p_min_tarde > 10 THEN p_min_tarde ELSE 0 END, gen_random_uuid());
  SET LOCAL session_replication_role = origin;
END $$;

BEGIN; SELECT t130_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE t130_emp_apartados AS SELECT id, estatus FROM empleados WHERE estatus = 'Activo';
UPDATE empleados SET estatus = 'Inactivo' WHERE id IN (SELECT id FROM t130_emp_apartados);
CREATE TABLE t130_con_apartados AS SELECT id FROM nomina_conceptos WHERE activo;
UPDATE nomina_conceptos SET activo = false WHERE id IN (SELECT id FROM t130_con_apartados);
INSERT INTO auth.users (id, email) SELECT ('13000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t130' FROM generate_series(1, 6) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13001, 'Admin T130',    'u1@t130', 'Admin',    'Activo', '13000000-0000-0000-0000-000000000001'),
  (13002, 'Vendedor T130', 'u2@t130', 'Ventas',   'Activo', '13000000-0000-0000-0000-000000000002'),
  (13003, 'Chofer T130',   'u3@t130', 'Chofer',   'Activo', '13000000-0000-0000-0000-000000000003'),
  (13004, 'Vendedor2 T130','u4@t130', 'Ventas',   'Activo', '13000000-0000-0000-0000-000000000004'),
  (13005, 'Puntual T130',  'u5@t130', 'Empleado', 'Activo', '13000000-0000-0000-0000-000000000005'),
  (13006, 'Exacto T130',   'u6@t130', 'Empleado', 'Activo', '13000000-0000-0000-0000-000000000006');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id) VALUES
  (13001, 'Emp T130 vendedor', 'Vendedor', 'Ventas y Distribución', 100, '2024-01-01', 'Activo', 13002),
  (13002, 'Emp T130 chofer',   'Chofer',   'Ventas y Distribución', 100, '2024-01-01', 'Activo', 13003),
  (13003, 'Emp T130 ayudante', 'Ayudante', 'Ventas y Distribución', 100, '2024-01-01', 'Activo', NULL),
  (13004, 'Emp T130 tarde',    'Operador', 'Producción',            100, '2024-01-01', 'Activo', 13005),
  (13005, 'Emp T130 sinlink',  'Vendedor', 'Ventas y Distribución', 100, '2024-01-01', 'Activo', NULL),
  (13006, 'Emp T130 exacto',   'Operador', 'Producción',            100, '2024-01-01', 'Activo', 13006);
INSERT INTO productos (sku, nombre, tipo, precio) VALUES ('T130-A', 'Producto T130 A', 'Producto Terminado', 30), ('T130-B', 'Producto T130 B', 'Producto Terminado', 100);
INSERT INTO rutas (id, folio, nombre, chofer_id, ayudante_id, estatus) VALUES (13001, 'RT130', 'Ruta T130', 13003, 13003, 'Cerrada');
INSERT INTO centros_trabajo (id, nombre, latitud, longitud, radio_m) VALUES (13001, 'Centro T130', 24, -104, 100);
-- Turnos lunes a viernes 08:00–16:00, tolerancia 10 min (chofer, tarde y exacto).
INSERT INTO turnos (id, empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde) VALUES
  (13002, 13002, 13001, ARRAY[1,2,3,4,5]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13004, 13004, 13001, ARRAY[1,2,3,4,5]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01'),
  (13006, 13006, 13001, ARRAY[1,2,3,4,5]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01');
COMMIT;

-- Órdenes de la semana 2 (la pasada): sábado = día 0 … viernes = día 6.
BEGIN;
SELECT t130_orden(13001, 13002, NULL,  'Entregada', t130_ts(2, 1, '12:00'), 10, 2);   -- 500, 10 A
SELECT t130_orden(13002, 13002, 13001, 'Facturada', t130_ts(2, 3, '12:00'), 20, 0);   -- 600, 20 A, con ruta
SELECT t130_orden(13003, 13002, NULL,  'Cancelada', t130_ts(2, 2, '12:00'), 5, 0);    -- cancelada: no cuenta
SELECT t130_orden(13004, 13002, NULL,  'Creada',    NULL,                   5, 0);    -- sin entregar: no cuenta
SELECT t130_orden(13005, 13004, 13001, 'Entregada', t130_ts(2, 2, '12:00'), 0, 5);    -- otro vendedor, con ruta
SELECT t130_orden(13006, 13002, NULL,  'Entregada', t130_ts(1, 2, '12:00'), 10, 0);   -- semana 1: fuera de la ventana inicial
SELECT t130_orden(13007, 13002, NULL,  'Entregada', t130_ts(3, 0, '00:30'), 0, 1);    -- sábado siguiente 00:30: semana 3
SELECT t130_orden(13008, 13002, NULL,  'Entregada', t130_ts(2, 0, '00:30'), 1, 0);    -- sábado 00:30 local: semana 2 (30, 1 A)
SELECT t130_orden(13009, 13002, NULL,  'Entregada', t130_ts(2, 6, '23:30'), 0, 1);    -- viernes 23:30 local: semana 2 (100)
-- Asistencia de la semana 2 (lunes = día 2 … viernes = día 6).
SELECT t130_marca(13004, 13005, 13004, 2, d, CASE WHEN d = 3 THEN 25 ELSE 0 END) FROM generate_series(2, 6) d;  -- un retardo (martes)
SELECT t130_marca(13002, 13003, 13002, 2, d, 0) FROM generate_series(2, 5) d;                                    -- falta el viernes
SELECT t130_marca(13006, 13006, 13006, 2, d, 10) FROM generate_series(2, 6) d;                                   -- justo en la tolerancia
COMMIT;

CREATE OR REPLACE FUNCTION t130_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '13000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t130_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t130_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
GRANT EXECUTE ON FUNCTION t130_actor(INTEGER), t130_assert(BOOLEAN, TEXT), t130_err(TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t130_ids;
CREATE TEMP TABLE t130_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t130_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t130_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t130_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t130_pid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v::jsonb ->> 'periodo_id')::bigint FROM t130_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t130_cid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v::jsonb ->> 'concepto_id')::bigint FROM t130_ids WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t130_rid(p_per TEXT, p_emp BIGINT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT id FROM nomina_recibos WHERE periodo_id = t130_pid(p_per) AND empleado_id = p_emp $$;
-- Línea de un concepto en un recibo.
CREATE OR REPLACE FUNCTION t130_lin(p_per TEXT, p_emp BIGINT, p_con TEXT) RETURNS nomina_recibo_lineas LANGUAGE sql AS $$
  SELECT l FROM nomina_recibo_lineas l WHERE recibo_id = t130_rid(p_per, p_emp) AND concepto_id = t130_cid(p_con) $$;
-- Órdenes que cubre esa línea, como texto ordenado.
CREATE OR REPLACE FUNCTION t130_ords(p_per TEXT, p_emp BIGINT, p_con TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(orden_id::text, ',' ORDER BY orden_id), '') FROM nomina_linea_ordenes WHERE linea_id = (t130_lin(p_per, p_emp, p_con)).id $$;
GRANT EXECUTE ON FUNCTION t130_j(TEXT), t130_pid(TEXT), t130_cid(TEXT), t130_rid(TEXT, BIGINT), t130_lin(TEXT, BIGINT, TEXT), t130_ords(TEXT, BIGINT, TEXT),
  t130_ts(INTEGER, INTEGER, TIME), t130_dia(INTEGER, INTEGER) TO PUBLIC;

\echo '── 130: esquema y acceso'
SELECT t130_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nomina_linea_ordenes'::regclass)
  AND (SELECT count(*) = 1 AND bool_and(cmd = 'SELECT' AND qual = '(erp_rol_activo() = ''Admin''::text)') FROM pg_policies WHERE tablename = 'nomina_linea_ordenes')
  AND has_table_privilege('authenticated', 'public.nomina_linea_ordenes', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.nomina_linea_ordenes', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.nomina_linea_ordenes', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.nomina_linea_ordenes', 'DELETE') AND NOT has_table_privilege('anon', 'public.nomina_linea_ordenes', 'SELECT'),
  '130-01 nomina_linea_ordenes: RLS, lectura solo de Admin, sin escritura por API, anon nada');
SELECT t130_assert((SELECT bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                     AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp') AND count(*) = 6
  FROM pg_proc WHERE oid IN ('public.nomina_asistencia_semana(bigint,date,date,timestamptz)'::regprocedure, 'public.nomina_conceptos_propuestos(bigint,date,date,numeric,bigint)'::regprocedure,
                             'public.nomina_comision_linea(bigint,numeric)'::regprocedure, 'public.nomina_proponer_recibo(bigint,boolean)'::regprocedure,
                             'public.nomina_aplicar_conceptos_recibo(bigint)'::regprocedure, 'public.nomina_linea_ordenes_guard()'::regprocedure)),
  '130-02 funciones internas y guarda: sin EXECUTE por API, search_path fijo');
SELECT t130_assert((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 2
  FROM pg_proc WHERE oid IN ('public.guardar_concepto_nomina(bigint,jsonb)'::regprocedure, 'public.aplicar_conceptos_nomina(bigint)'::regprocedure)),
  '130-03 contratos redefinidos: SECURITY DEFINER, search_path fijo, sin anon');
SELECT t130_assert(md5(pg_get_functiondef('public.generar_recibos_nomina(bigint)'::regprocedure)) = 'ab1723f5b1d0c63082469ad31e73588b'
  AND md5(pg_get_functiondef('public.guardar_recibo_nomina(bigint,integer,boolean,jsonb)'::regprocedure)) = 'bd8d67c86c3b2caced7191207bc191cc'
  AND md5(pg_get_functiondef('public.editar_recibo_nomina(bigint,integer,boolean,numeric,numeric,numeric,numeric,numeric,numeric)'::regprocedure)) = 'ff72121e92018ceea6aade9ed5ec6a12'
  AND md5(pg_get_functiondef('public.pagar_nomina(bigint)'::regprocedure)) = 'c4504312dd00137c00d570e4bb66ed1d'
  AND md5(pg_get_functiondef('public.nomina_recalcular_recibo(bigint,integer,boolean)'::regprocedure)) = '65f494174e9677cd7228801235cb09bc',
  '130-04 generar, guardar recibo, editar recibo, pagar y recalcular recibo: definición idéntica a 128');

\echo '── 130: catálogo (validaciones nuevas)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(2);
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":2,"aplica_a":"todos","base_rol":"vendedor"}')$q$,
  '130-05 Ventas no crea conceptos', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":2,"aplica_a":"todos"}')$q$,
  '130-06 comisión sin decir de quién son las ventas: rechazada', '22023', '%de quién%');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"por_entrega","monto":2,"aplica_a":"todos","base_rol":"gerente"}')$q$,
  '130-07 base desconocida: rechazada', '22023');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"descuento","categoria":"otras_deducciones","calculo":"por_unidad","monto":2,"aplica_a":"todos","base_rol":"vendedor"}')$q$,
  '130-08 un descuento no se calcula con ventas', '22023', '%solo aplica a una percepción%');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":101,"aplica_a":"todos","base_rol":"vendedor"}')$q$,
  '130-09 más de 100 % sobre ventas: rechazado', '22023', '%no puede pasar de 100%');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"por_unidad","monto":1,"aplica_a":"todos","base_rol":"vendedor","skus":["NO-EXISTE"]}')$q$,
  '130-10 producto inexistente en la comisión: rechazado', '22023', '%no existe%');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"descuento","categoria":"otras_deducciones","monto":10,"aplica_a":"todos","regla_asistencia":true}')$q$,
  '130-11 condición de asistencia en un descuento: rechazada', '22023');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"bono_puntualidad","monto":10,"aplica_a":"todos","regla_asistencia":true,"max_retardos":9}')$q$,
  '130-12 retardos permitidos fuera de 0 a 7: rechazado', '22023');
SELECT t130_err($q$SELECT guardar_concepto_nomina(NULL, '{"nombre":"T130 x","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":2,"aplica_a":"personas","base_rol":"vendedor","personas":[{"empleado_id":13001,"monto":150}]}')$q$,
  '130-13 tasa propia de una persona mayor a 100 %: rechazada', '22023');

-- Catálogo de la prueba.
INSERT INTO t130_ids VALUES ('CV', guardar_concepto_nomina(NULL, '{"nombre":"T130 Comisión venta","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":2,"aplica_a":"personas","base_rol":"vendedor","personas":[{"empleado_id":13001},{"empleado_id":13005}]}')::text);
INSERT INTO t130_ids VALUES ('CU', guardar_concepto_nomina(NULL, '{"nombre":"T130 Por bolsa A","tipo":"percepcion","categoria":"comisiones","calculo":"por_unidad","monto":0.5,"aplica_a":"personas","base_rol":"vendedor","skus":["T130-A"," T130-A "],"personas":[{"empleado_id":13001,"monto":1}]}')::text);
INSERT INTO t130_ids VALUES ('CE', guardar_concepto_nomina(NULL, '{"nombre":"T130 Por entrega","tipo":"percepcion","categoria":"comisiones","calculo":"por_entrega","monto":5,"aplica_a":"personas","base_rol":"chofer","personas":[{"empleado_id":13002}]}')::text);
INSERT INTO t130_ids VALUES ('CA', guardar_concepto_nomina(NULL, '{"nombre":"T130 Ayudante","tipo":"percepcion","categoria":"comisiones","calculo":"por_entrega","monto":3,"aplica_a":"personas","base_rol":"ayudante","personas":[{"empleado_id":13003}]}')::text);
INSERT INTO t130_ids VALUES ('BP', guardar_concepto_nomina(NULL, '{"nombre":"T130 Puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":200,"aplica_a":"todos","regla_asistencia":true}')::text);
INSERT INTO t130_ids VALUES ('B1', guardar_concepto_nomina(NULL, '{"nombre":"T130 Puntualidad flexible","tipo":"percepcion","categoria":"bono_puntualidad","monto":100,"aplica_a":"personas","regla_asistencia":true,"max_retardos":1,"personas":[{"empleado_id":13004}]}')::text);
INSERT INTO t130_ids VALUES ('FJ', guardar_concepto_nomina(NULL, '{"nombre":"T130 Vales","tipo":"percepcion","categoria":"otras_percepciones","monto":50,"aplica_a":"todos","base_rol":"vendedor","skus":["T130-A"],"max_retardos":3}')::text);
COMMIT;
SELECT t130_assert((SELECT (calculo, base_rol, skus, regla_asistencia) = ('por_unidad', 'vendedor', ARRAY['T130-A'], false) FROM nomina_conceptos WHERE id = t130_cid('CU'))
  AND (SELECT (calculo, base_rol, skus, regla_asistencia, max_retardos) IS NOT DISTINCT FROM ('fijo', NULL, NULL, false, 0) FROM nomina_conceptos WHERE id = t130_cid('FJ'))
  AND (SELECT (regla_asistencia, max_retardos, max_faltas) = (true, 1, 0) FROM nomina_conceptos WHERE id = t130_cid('B1')),
  '130-14 el catálogo guarda base, productos (sin repetir) y condición; un concepto fijo ignora base, productos y límites');
SELECT t130_assert((SELECT despues ->> 'base_rol' = 'vendedor' AND despues ->> 'calculo' = 'porcentaje_ventas' AND accion = 'CONTRATO'
                      FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id = t130_cid('CV')::text)
  AND (SELECT (despues ->> 'regla_asistencia')::boolean AND despues ->> 'max_retardos' = '1' FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id = t130_cid('B1')::text),
  '130-15 la bitácora del Dueño registra la forma de cálculo y la condición de asistencia');

\echo '── 130: generar la semana pasada con comisiones y asistencia'
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
INSERT INTO t130_ids VALUES ('s2', crear_periodo_nomina(fin_hoy() - 7)::text);
INSERT INTO t130_ids VALUES ('g2', generar_recibos_nomina(t130_pid('s2'))::text);
COMMIT;
SELECT t130_assert((t130_lin('s2', 13001, 'CV')).monto = 24.60 AND (t130_lin('s2', 13001, 'CV')).propuesto = 24.60
  AND (t130_lin('s2', 13001, 'CV')).detalle = '4 ventas · $1,230.00 × 2%' AND t130_ords('s2', 13001, 'CV') = '13001,13002,13008,13009',
  '130-16 % sobre ventas: solo lo ENTREGADO del vendedor en la semana (bordes de sábado 00:30 y viernes 23:30 locales); ni cancelada, ni sin entregar, ni de otra semana');
SELECT t130_assert((t130_lin('s2', 13001, 'CU')).monto = 31 AND (t130_lin('s2', 13001, 'CU')).detalle = '3 ventas · 31 bolsas × $1.00' AND t130_ords('s2', 13001, 'CU') = '13001,13002,13008',
  '130-17 $ por bolsa: solo el producto elegido y con la tasa propia de la persona');
SELECT t130_assert((t130_lin('s2', 13002, 'CE')).monto = 10 AND (t130_lin('s2', 13002, 'CE')).detalle = '2 entregas × $5.00' AND t130_ords('s2', 13002, 'CE') = '13002,13005'
  AND (t130_lin('s2', 13003, 'CA')).monto = 6 AND t130_ords('s2', 13003, 'CA') = '13002,13005',
  '130-18 $ por entrega: el chofer y el ayudante de la ruta (sin importar quién vendió)');
SELECT t130_assert((t130_lin('s2', 13005, 'CV')).monto = 0 AND (t130_lin('s2', 13005, 'CV')).detalle LIKE 'Sin usuario ligado%' AND t130_ords('s2', 13005, 'CV') = '',
  '130-19 vendedor sin usuario ligado: renglón en 0 con el motivo');
SELECT t130_assert((t130_lin('s2', 13004, 'BP')).monto = 0 AND (t130_lin('s2', 13004, 'BP')).propuesto = 0
  AND (t130_lin('s2', 13004, 'BP')).detalle = 'No aplica: 1 retardo y 0 faltas (se permiten 0 y 0)'
  AND (t130_lin('s2', 13002, 'BP')).monto = 0 AND (t130_lin('s2', 13002, 'BP')).detalle = 'No aplica: 0 retardos y 1 falta (se permiten 0 y 0)',
  '130-20 bono de puntualidad: un retardo o una falta en la semana lo dejan en 0, con el motivo');
SELECT t130_assert((t130_lin('s2', 13006, 'BP')).monto = 200 AND (t130_lin('s2', 13006, 'BP')).detalle = 'Asistencia: 0 retardos, 0 faltas'
  AND (t130_lin('s2', 13001, 'BP')).monto = 200 AND (t130_lin('s2', 13001, 'BP')).detalle LIKE 'Sin turno esta semana%'
  AND (t130_lin('s2', 13004, 'B1')).monto = 100 AND (t130_lin('s2', 13004, 'B1')).detalle = 'Asistencia: 1 retardo, 0 faltas',
  '130-21 entrada justo en la tolerancia = a tiempo; sin turno no se evalúa (se propone completo); la regla flexible tolera un retardo');
SELECT t130_assert((SELECT (comisiones, bono_puntualidad, otras_percepciones, total_percepciones, neto_a_pagar) = (55.60, 200, 50, 1005.60, 1005.60)
                      FROM nomina_recibos WHERE id = t130_rid('s2', 13001))
  AND (SELECT (comisiones, bono_puntualidad, otras_percepciones, neto_a_pagar) = (0, 100, 50, 850) FROM nomina_recibos WHERE id = t130_rid('s2', 13004))
  AND (t130_lin('s2', 13001, 'FJ')).monto = 50 AND (t130_lin('s2', 13001, 'FJ')).detalle IS NULL,
  '130-22 las casillas del recibo son la suma de sus renglones; el concepto fijo se propone igual que en 128');

\echo '── 130: recalcular el borrador'
BEGIN; SELECT t130_orden(13010, 13002, NULL, 'Entregada', t130_ts(2, 4, '12:00'), 0, 4); COMMIT;   -- 400 más en la misma semana
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
INSERT INTO t130_ids VALUES ('r1', aplicar_conceptos_nomina(t130_pid('s2'))::text);
INSERT INTO t130_ids VALUES ('r1b', aplicar_conceptos_nomina(t130_pid('s2'))::text);
COMMIT;
SELECT t130_assert((t130_lin('s2', 13001, 'CV')).monto = 32.60 AND (t130_lin('s2', 13001, 'CV')).propuesto = 32.60 AND (t130_lin('s2', 13001, 'CV')).detalle = '5 ventas · $1,630.00 × 2%'
  AND (t130_j('r1') ->> 'lineas')::int = 1 AND (t130_j('r1') ->> 'recibos')::int = 1 AND (t130_j('r1b') ->> 'lineas')::int = 0
  AND (t130_lin('s2', 13001, 'CU')).monto = 31 AND (t130_lin('s2', 13001, 'FJ')).monto = 50
  AND (SELECT comisiones = 63.60 FROM nomina_recibos WHERE id = t130_rid('s2', 13001)),
  '130-23 una entrega nueva en la semana: al recalcular, el renglón intacto sigue al cálculo; repetir no cambia nada');
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
-- Admin fija la comisión en 50 y deja el bono de puntualidad de 13006 en 0.
SELECT guardar_recibo_nomina(t130_rid('s2', 13001), 6, true, jsonb_build_array(
  jsonb_build_object('concepto_id', t130_cid('CV'), 'monto', 50), jsonb_build_object('concepto_id', t130_cid('CU'), 'monto', 31),
  jsonb_build_object('concepto_id', t130_cid('BP'), 'monto', 200), jsonb_build_object('concepto_id', t130_cid('FJ'), 'monto', 50)));
SELECT guardar_recibo_nomina(t130_rid('s2', 13006), 6, true, jsonb_build_array(jsonb_build_object('concepto_id', t130_cid('FJ'), 'monto', 50)));
COMMIT;
BEGIN; SELECT t130_orden(13011, 13002, NULL, 'Entregada', t130_ts(2, 5, '12:00'), 0, 1); COMMIT;   -- 100 más
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
INSERT INTO t130_ids VALUES ('r2', aplicar_conceptos_nomina(t130_pid('s2'))::text);
COMMIT;
SELECT t130_assert((t130_lin('s2', 13001, 'CV')).monto = 50 AND (t130_lin('s2', 13001, 'CV')).propuesto = 34.60 AND (t130_lin('s2', 13001, 'CV')).detalle = '6 ventas · $1,730.00 × 2%'
  AND t130_ords('s2', 13001, 'CV') = '13001,13002,13008,13009,13010,13011'
  AND (t130_lin('s2', 13006, 'BP')).monto = 0 AND (t130_lin('s2', 13006, 'BP')).propuesto = 200
  AND (t130_j('r2') ->> 'lineas')::int = 0,
  '130-24 importe cambiado a mano: se respeta; solo se actualizan el sugerido, la explicación y las órdenes cubiertas');

\echo '── 130: la asistencia cambia (corrección de Admin y cambio de la regla)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
SELECT corregir_asistencia(gen_random_uuid(), (SELECT id FROM asistencias WHERE empleado_id = 13004 AND fecha_laboral = t130_dia(2, 3)), 'entrada',
                           t130_ts(2, 3, '08:05'), 'El reloj falló, llegó a tiempo');
SELECT guardar_concepto_nomina(t130_cid('BP'), '{"nombre":"T130 Puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":250,"aplica_a":"todos","regla_asistencia":true,"max_faltas":1}');
INSERT INTO t130_ids VALUES ('r3', aplicar_conceptos_nomina(t130_pid('s2'))::text);
COMMIT;
SELECT t130_assert((t130_lin('s2', 13004, 'BP')).monto = 250 AND (t130_lin('s2', 13004, 'BP')).detalle = 'Asistencia: 0 retardos, 0 faltas'
  AND (t130_lin('s2', 13002, 'BP')).monto = 250 AND (t130_lin('s2', 13002, 'BP')).detalle = 'Asistencia: 0 retardos, 1 falta'
  AND (t130_lin('s2', 13004, 'B1')).detalle = 'Asistencia: 0 retardos, 0 faltas'
  AND (t130_lin('s2', 13001, 'BP')).monto = 250 AND (t130_lin('s2', 13006, 'BP')).monto = 0 AND (t130_lin('s2', 13006, 'BP')).propuesto = 250,
  '130-25 corregir un retardo o cambiar la regla y el monto: el borrador se recalcula; lo editado a mano se queda');
SELECT t130_assert((SELECT (r.retardos, r.faltas, r.dias_programados, r.asistencias) = (0, 0, 2, 4)
                      FROM nomina_asistencia_semana(13002, t130_dia(2, 0), t130_dia(2, 6), t130_ts(2, 3, '10:00')) r)
  AND (SELECT (r.retardos, r.faltas, r.dias_programados) = (0, 1, 5) FROM nomina_asistencia_semana(13002, t130_dia(2, 0), t130_dia(2, 6), t130_ts(2, 6, '16:00')) r)
  AND (SELECT (r.faltas, r.dias_programados) = (0, 5) FROM nomina_asistencia_semana(13002, t130_dia(2, 0), t130_dia(2, 6), t130_ts(2, 6, '15:59')) r),
  '130-26 falta = turno ya TERMINADO sin marca: un turno en curso o futuro no cuenta todavía');

\echo '── 130: una orden se comisiona una sola vez'
SELECT t130_err(format($q$INSERT INTO nomina_linea_ordenes (linea_id, concepto_id, empleado_id, orden_id, base, unidades) VALUES (%s, %s, 13001, 13001, 1, 1)$q$,
    (t130_lin('s2', 13002, 'CE')).id, t130_cid('CV')), '130-27 la misma orden, concepto y persona en otro renglón: rechazada por el índice único', '23505', '%nomina_linea_ordenes_una_vez%');
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
INSERT INTO t130_ids VALUES ('pay', pagar_nomina(t130_pid('s2'))::text);
COMMIT;
SELECT t130_assert((SELECT estatus = 'Pagado' AND total_neto = (SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = t130_pid('s2')) FROM nomina_periodos WHERE id = t130_pid('s2'))
  AND (SELECT neto_a_pagar = 700 + 50 + 31 + 250 + 50 FROM nomina_recibos WHERE id = t130_rid('s2', 13001)),
  '130-28 pagar_nomina (sin cambio) paga el neto con las comisiones y bonos del desglose');
SELECT t130_err(format($q$DELETE FROM nomina_linea_ordenes WHERE linea_id = %s$q$, (t130_lin('s2', 13001, 'CV')).id),
  '130-29 periodo pagado: las órdenes que cubrió la comisión son inmutables (también sin JWT)', '42501', '%ya está pagado%');
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
SELECT t130_err(format($q$SELECT aplicar_conceptos_nomina(%s)$q$, t130_pid('s2')), '130-30 periodo pagado: no se recalcula', '22023', '%ya está pagado%');
SELECT t130_err(format($q$INSERT INTO nomina_linea_ordenes (linea_id, concepto_id, empleado_id, orden_id, base, unidades) VALUES (%s, %s, 13001, 13004, 1, 1)$q$,
    (t130_lin('s2', 13001, 'CV')).id, t130_cid('CV')), '130-31 Admin por API: no escribe el detalle de la comisión', '42501');
SELECT t130_assert((SELECT count(*) = 6 FROM nomina_linea_ordenes WHERE linea_id = (t130_lin('s2', 13001, 'CV')).id), '130-32 Admin sí lee el detalle de la comisión');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(2);
SELECT t130_assert((SELECT count(*) = 0 FROM nomina_linea_ordenes), '130-33 Ventas no lee el detalle de las comisiones');
SELECT t130_err($q$SELECT nomina_proponer_recibo(1, true)$q$, '130-34 función interna sin EXECUTE por API', '42501');
ROLLBACK;

-- Entrega tardía de la semana ya pagada + una de esta semana; la semana actual las recoge una vez.
BEGIN; SELECT t130_orden(13012, 13002, NULL, 'Entregada', t130_ts(2, 6, '18:00'), 0, 2); COMMIT;   -- 200, semana pagada
BEGIN; SET LOCAL ROLE authenticated; SELECT t130_actor(1);
INSERT INTO t130_ids VALUES ('s3', crear_periodo_nomina(NULL)::text);
INSERT INTO t130_ids VALUES ('g3', generar_recibos_nomina(t130_pid('s3'))::text);
INSERT INTO t130_ids VALUES ('s1', crear_periodo_nomina(fin_hoy() - 14)::text);
INSERT INTO t130_ids VALUES ('g1', generar_recibos_nomina(t130_pid('s1'))::text);
COMMIT;
SELECT t130_assert(t130_ords('s3', 13001, 'CV') = '13007,13012' AND (t130_lin('s3', 13001, 'CV')).monto = 6
  AND (t130_lin('s3', 13001, 'CV')).detalle = '2 ventas · $300.00 × 2% (incluye 1 de semanas anteriores)'
  AND t130_ords('s2', 13001, 'CV') = '13001,13002,13008,13009,13010,13011',
  '130-35 lo entregado después de pagar la semana entra a la siguiente, una sola vez; lo ya pagado no se repite');
SELECT t130_assert(t130_ords('s1', 13001, 'CV') = '13006' AND (t130_lin('s1', 13001, 'CV')).monto = 6
  AND (SELECT count(*) = count(DISTINCT orden_id) FROM nomina_linea_ordenes WHERE concepto_id = t130_cid('CV') AND empleado_id = 13001),
  '130-36 una semana anterior generada después solo toma lo suyo; ninguna orden aparece dos veces en el mismo concepto');
SELECT t130_assert((t130_lin('s3', 13004, 'BP')).detalle IS NOT NULL AND (t130_lin('s3', 13004, 'BP')).monto IN (0, 250),
  '130-37 la semana en curso se evalúa con lo que lleva (turnos terminados)');

\echo '── 130: invariante — las casillas del recibo son la suma de sus líneas'
SELECT t130_assert((SELECT count(*) = 18 AND bool_and(
      r.comisiones = x.com AND r.bono_puntualidad = x.bpun AND r.otras_percepciones = x.otras AND r.deducciones = x.ded
      AND r.total_percepciones = r.sueldo + r.septimo_dia + x.com + x.prima + x.bpun + x.bpro + x.otras
      AND r.neto_a_pagar = r.total_percepciones - r.deducciones AND r.neto_a_pagar >= 0)
    FROM nomina_recibos r
    CROSS JOIN LATERAL (SELECT COALESCE(sum(monto) FILTER (WHERE categoria = 'comisiones'), 0) AS com, COALESCE(sum(monto) FILTER (WHERE categoria = 'prima_dominical'), 0) AS prima,
        COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_puntualidad'), 0) AS bpun, COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_productividad'), 0) AS bpro,
        COALESCE(sum(monto) FILTER (WHERE categoria = 'otras_percepciones'), 0) AS otras, COALESCE(sum(monto) FILTER (WHERE tipo = 'descuento'), 0) AS ded
      FROM nomina_recibo_lineas l WHERE l.recibo_id = r.id) x
   WHERE r.periodo_id IN (t130_pid('s1'), t130_pid('s2'), t130_pid('s3')))
  AND (SELECT bool_and(p.total_neto = (SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = p.id)) FROM nomina_periodos p
        WHERE p.id IN (t130_pid('s1'), t130_pid('s2'), t130_pid('s3'))),
  '130-38 los 18 recibos cuadran con su desglose y cada periodo con sus recibos');

BEGIN; SELECT t130_limpiar(); COMMIT;
SELECT t130_assert(to_regclass('public.t130_emp_apartados') IS NULL AND to_regclass('public.t130_con_apartados') IS NULL
  AND NOT EXISTS (SELECT 1 FROM empleados WHERE id BETWEEN 13001 AND 13009) AND NOT EXISTS (SELECT 1 FROM nomina_conceptos WHERE creado_por = 'Admin T130')
  AND NOT EXISTS (SELECT 1 FROM nomina_periodos WHERE creado_por = 'Admin T130') AND NOT EXISTS (SELECT 1 FROM ordenes WHERE id BETWEEN 13001 AND 13099)
  AND NOT EXISTS (SELECT 1 FROM nomina_linea_ordenes lo WHERE NOT EXISTS (SELECT 1 FROM nomina_recibo_lineas l WHERE l.id = lo.linea_id)),
  '130-39 limpieza: sin fixtures ni detalle huérfano de la prueba');
DROP FUNCTION t130_limpiar(), t130_ts(INTEGER, INTEGER, TIME), t130_dia(INTEGER, INTEGER), t130_orden(BIGINT, BIGINT, BIGINT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER),
  t130_marca(BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, INTEGER), t130_actor(INTEGER), t130_assert(BOOLEAN, TEXT), t130_err(TEXT, TEXT, TEXT, TEXT),
  t130_j(TEXT), t130_pid(TEXT), t130_cid(TEXT), t130_rid(TEXT, BIGINT), t130_lin(TEXT, BIGINT, TEXT), t130_ords(TEXT, BIGINT, TEXT);
\echo '── 130: TODAS LAS PRUEBAS OK'
