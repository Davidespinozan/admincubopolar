-- 135_correcciones_tanda1_test.sql — correcciones de la revisión del 2026-10-10:
-- (1) la semana nueva no se lleva las comisiones de otra semana en borrador,
-- (2) recalcular no deja el neto negativo: recorta el descuento,
-- (3) un renglón que fue automático se recalcula al quitarle la regla,
-- (4) evidencias: lectura de Admin o de quien subió.
-- Todo en UNA transacción con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE empleados SET estatus = 'Inactivo' WHERE estatus = 'Activo';
UPDATE nomina_conceptos SET activo = false WHERE activo;
DELETE FROM nomina_linea_ordenes; DELETE FROM nomina_recibo_lineas; DELETE FROM nomina_recibos; DELETE FROM nomina_periodos;
INSERT INTO auth.users (id, email) VALUES ('13500000-0000-0000-0000-000000000001', 'a@t135'), ('13500000-0000-0000-0000-000000000002', 'v@t135'), ('13500000-0000-0000-0000-000000000003', 'f@t135');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13501, 'Admin T135', 'a@t135', 'Admin', 'Activo', '13500000-0000-0000-0000-000000000001'),
  (13502, 'Vendedor T135', 'v@t135', 'Ventas', 'Activo', '13500000-0000-0000-0000-000000000002'),
  (13503, 'Fact T135', 'f@t135', 'Facturación', 'Activo', '13500000-0000-0000-0000-000000000003');
INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id) VALUES
  (13501, 'Emp T135 vendedor', 'Vendedor', 'Ventas', 100, '2024-01-01', 'Activo', 13502),
  (13502, 'Emp T135 prestamo', 'Operador', 'Producción', 250, '2024-01-01', 'Activo', NULL);
INSERT INTO centros_trabajo (id, nombre, latitud, longitud, radio_m) VALUES (13501, 'Centro T135', 24, -104, 100);
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.como(p_k INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '13500000-0000-0000-0000-00000000000' || p_k)::text, true)::void $$;
-- Orden entregada del vendedor, p_dias días después del sábado de la semana pasada.
CREATE OR REPLACE FUNCTION pg_temp.orden(p_id BIGINT, p_dias INTEGER, p_total NUMERIC) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, vendedor_id, tipo_cobro, delivered_at)
  VALUES (p_id, 'T135-' || p_id, 'Cliente', 'x', p_total, 'Entregada', 13502, 'Contado',
          ((nomina_inicio_semana(fin_hoy() - 7) + p_dias + time '12:00')::timestamp AT TIME ZONE fin_zona_negocio()));
  SET LOCAL session_replication_role = origin;
END $$;
CREATE TEMP TABLE t135 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t135 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.lin(p_per TEXT, p_emp BIGINT, p_con TEXT) RETURNS nomina_recibo_lineas LANGUAGE sql AS $$
  SELECT l FROM nomina_recibo_lineas l JOIN nomina_recibos r ON r.id = l.recibo_id
   WHERE r.periodo_id = (SELECT (v ->> 'periodo_id')::bigint FROM t135 WHERE k = p_per) AND r.empleado_id = p_emp
     AND l.concepto_id = (SELECT (v ->> 'concepto_id')::bigint FROM t135 WHERE k = p_con) $$;
CREATE OR REPLACE FUNCTION pg_temp.ords(p_per TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(orden_id::text, ',' ORDER BY orden_id), '') FROM nomina_linea_ordenes WHERE linea_id = (pg_temp.lin(p_per, 13501, 'CV')).id $$;
CREATE OR REPLACE FUNCTION pg_temp.pid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v ->> 'periodo_id')::bigint FROM t135 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.rid(p_k TEXT, p_emp BIGINT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT id FROM nomina_recibos WHERE periodo_id = pg_temp.pid(p_k) AND empleado_id = p_emp $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como(1);

\echo '── 135: la semana nueva no se lleva las comisiones de la anterior en borrador'
INSERT INTO t135 VALUES ('CV', guardar_concepto_nomina(NULL, '{"nombre":"T135 Comisión","tipo":"percepcion","categoria":"comisiones","calculo":"porcentaje_ventas","monto":2,"aplica_a":"personas","base_rol":"vendedor","personas":[{"empleado_id":13501}]}'));
INSERT INTO t135 VALUES ('s1', crear_periodo_nomina(fin_hoy() - 7));
SELECT generar_recibos_nomina(pg_temp.pid('s1'));
RESET ROLE; SELECT pg_temp.orden(13501, 2, 300); SELECT pg_temp.orden(13502, 4, 200); SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
-- Nadie tocó "Actualizar" en la semana 1 y se crea la semana en curso.
INSERT INTO t135 VALUES ('s2', crear_periodo_nomina(NULL));
SELECT generar_recibos_nomina(pg_temp.pid('s2'));
SELECT pg_temp.ok(pg_temp.ords('s2') = '' AND (pg_temp.lin('s2', 13501, 'CV')).monto = 0,
  '135-01 la semana nueva NO toma lo entregado en la anterior, que sigue en borrador');
SELECT aplicar_conceptos_nomina(pg_temp.pid('s1'));
SELECT pg_temp.ok(pg_temp.ords('s1') = '13501,13502' AND (pg_temp.lin('s1', 13501, 'CV')).monto = 10 AND (pg_temp.lin('s1', 13501, 'CV')).detalle = '2 ventas · $500.00 × 2%',
  '135-02 al recalcular (o al pagar) la semana anterior, su comisión queda completa');
SELECT pagar_nomina(pg_temp.pid('s1'));
RESET ROLE; SELECT pg_temp.orden(13503, 5, 150); SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT aplicar_conceptos_nomina(pg_temp.pid('s2'));
SELECT pg_temp.ok(pg_temp.ords('s2') = '13503' AND (pg_temp.lin('s2', 13501, 'CV')).monto = 3
  AND (pg_temp.lin('s2', 13501, 'CV')).detalle LIKE '%incluye 1 de semanas anteriores%' AND pg_temp.ords('s1') = '13501,13502',
  '135-03 lo entregado DESPUÉS de pagar la semana sí pasa a la siguiente, una sola vez');

\echo '── 135: recalcular no deja el neto negativo'
INSERT INTO t135 VALUES ('BP', guardar_concepto_nomina(NULL, '{"nombre":"T135 Puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":300,"aplica_a":"personas","regla_asistencia":true,"personas":[{"empleado_id":13502}]}'));
INSERT INTO t135 VALUES ('PR', guardar_concepto_nomina(NULL, '{"nombre":"T135 Préstamo","tipo":"descuento","categoria":"prestamo","monto":500,"aplica_a":"personas","personas":[{"empleado_id":13502}]}'));
INSERT INTO t135 VALUES ('s0', crear_periodo_nomina(fin_hoy() - 14));
SELECT generar_recibos_nomina(pg_temp.pid('s0'));
SELECT pg_temp.ok((pg_temp.lin('s0', 13502, 'BP')).monto = 300 AND (pg_temp.lin('s0', 13502, 'PR')).monto = 500, '135-04 sin turno la asistencia no se evalúa: bono completo y préstamo completo');
-- Admin deja 1 día pagado, sin séptimo: 250 + 300 − 500 = 50.
SELECT guardar_recibo_nomina(pg_temp.rid('s0', 13502), 1, false, jsonb_build_array(
  jsonb_build_object('concepto_id', (SELECT (v ->> 'concepto_id')::bigint FROM t135 WHERE k = 'BP'), 'monto', 300),
  jsonb_build_object('concepto_id', (SELECT (v ->> 'concepto_id')::bigint FROM t135 WHERE k = 'PR'), 'monto', 500)));
SELECT pg_temp.ok((SELECT neto_a_pagar = 50 FROM nomina_recibos WHERE id = pg_temp.rid('s0', 13502)), '135-05 recibo guardado con neto $50');
-- Aparece su turno (lunes a viernes, ya pasados): 5 faltas → pierde el bono.
RESET ROLE;
INSERT INTO turnos (empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde) VALUES (13502, 13501, ARRAY[1,2,3,4,5]::SMALLINT[], '08:00', '16:00', 10, '2024-01-01');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t135 VALUES ('r0', aplicar_conceptos_nomina(pg_temp.pid('s0')));
SELECT pg_temp.ok((pg_temp.lin('s0', 13502, 'BP')).monto = 0 AND (pg_temp.lin('s0', 13502, 'BP')).detalle LIKE 'No aplica: 0 retardos y 5 faltas%'
  AND (pg_temp.lin('s0', 13502, 'PR')).monto = 250 AND (pg_temp.lin('s0', 13502, 'PR')).propuesto = 500
  AND (pg_temp.lin('s0', 13502, 'PR')).detalle LIKE 'Recortado:%'
  AND (SELECT (neto_a_pagar, deducciones, bono_puntualidad) = (0, 250, 0) FROM nomina_recibos WHERE id = pg_temp.rid('s0', 13502))
  AND (SELECT total_neto = (SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = pg_temp.pid('s0')) FROM nomina_periodos WHERE id = pg_temp.pid('s0')),
  '135-06 al perder el bono, el préstamo se recorta a lo disponible (neto $0) y la semana SÍ se recalcula');

\echo '── 135: quitar la regla a un concepto devuelve el renglón'
SELECT guardar_concepto_nomina((SELECT (v ->> 'concepto_id')::bigint FROM t135 WHERE k = 'BP'),
  '{"nombre":"T135 Puntualidad","tipo":"percepcion","categoria":"bono_puntualidad","monto":300,"aplica_a":"personas","regla_asistencia":false,"personas":[{"empleado_id":13502}]}');
SELECT aplicar_conceptos_nomina(pg_temp.pid('s0'));
SELECT pg_temp.ok((pg_temp.lin('s0', 13502, 'BP')).monto = 300 AND (pg_temp.lin('s0', 13502, 'BP')).detalle IS NULL
  AND (SELECT neto_a_pagar = 250 + 300 - 250 FROM nomina_recibos WHERE id = pg_temp.rid('s0', 13502)),
  '135-07 sin la regla, el bono vuelve a su monto (antes se quedaba en $0 con el motivo viejo)');
SELECT aplicar_conceptos_nomina(pg_temp.pid('s0'));
SELECT pg_temp.ok((pg_temp.lin('s0', 13502, 'BP')).monto = 300 AND (pg_temp.lin('s0', 13502, 'PR')).monto = 250, '135-08 repetir el recálculo no cambia nada');

\echo '── 135: evidencias — Admin o quien subió'
SELECT pg_temp.ok((SELECT qual = '((erp_rol_activo() = ''Admin''::text) OR (erp_lector_negocio() AND (subido_por = erp_usuario_id())))' FROM pg_policies WHERE tablename = 'orden_evidencias' AND policyname = 'evidencias_read'),
  '135-09 la policy de lectura ya no incluye a Facturación (no puede abrir el archivo)');
SELECT pg_temp.ok(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure) LIKE '%8a (135)%ORDER BY sku FOR UPDATE%8. Cuartos de la asignación%',
  '135-10 la venta bloquea la bolsa antes que los cuartos');

ROLLBACK;
\echo '── 135: TODAS LAS PRUEBAS OK'
