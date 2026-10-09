-- 096_dia_negocio_caja_test.sql — día de negocio canónico (zona del negocio: America/Mazatlan hasta 121; America/Monterrey desde 122)
-- y cierre de caja por contrato: una caja por ruta, fecha = rutas.fecha_fin
-- derivada en el servidor, esperado/snapshot/actor del servidor, idempotencia
-- por operación. La parte de contención (097) se detecta por el privilegio de
-- INSERT sobre cierres_diarios.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t96_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM cierres_diarios WHERE ruta_id BETWEEN 9601 AND 9619;
  DELETE FROM auditoria WHERE detalle LIKE 'R-96%';
  DELETE FROM pagos WHERE orden_id BETWEEN 9621 AND 9649 OR referencia LIKE 'T96%';
  DELETE FROM ordenes WHERE id BETWEEN 9621 AND 9649 OR folio LIKE 'OV-96%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P96-%';
  DELETE FROM produccion WHERE sku LIKE 'P96-%' OR input_sku LIKE 'P96-%';
  DELETE FROM mermas WHERE sku LIKE 'P96-%';
  DELETE FROM rutas WHERE id BETWEEN 9601 AND 9619 OR nombre LIKE 'T96%';
  DELETE FROM cuartos_frios WHERE id = 'CF-96';
  DELETE FROM productos WHERE sku LIKE 'P96-%';
  DELETE FROM usuarios WHERE id BETWEEN 9601 AND 9609;
  DELETE FROM auth.users WHERE id::text LIKE '96000000-%';
END $$;

BEGIN; SELECT t96_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;  -- fixtures de rutas ya cerradas
INSERT INTO auth.users (id, email) SELECT ('96000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t96' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (9601, 'Admin 96',  'u1@t96', 'Admin',      'Activo', '96000000-0000-0000-0000-000000000001'),
  (9602, 'Ventas 96', 'u2@t96', 'Ventas',     'Activo', '96000000-0000-0000-0000-000000000002'),
  (9603, 'Prod 96',   'u3@t96', 'Producción', 'Activo', '96000000-0000-0000-0000-000000000003');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P96-H', 'Hielo 96', 'Producto Terminado', 30, 0, 0, NULL), ('P96-MP', 'Barra 96', 'Materia Prima', 0, 50, 1, NULL);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-96', 'Cuarto 96', '{}'::jsonb);
INSERT INTO rutas (id, folio, nombre, estatus, fecha, fecha_fin, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (9601, 'R-9601', 'T96 A',          'Cerrada',     '2026-09-29', '2026-09-29', '{}', '{}', '{}', '{}'),
  (9602, 'R-9602', 'T96 medianoche', 'Cerrada',     '2026-09-29', '2026-09-30', '{}', '{}', '{}', '{}'),
  (9603, 'R-9603', 'T96 en curso',   'En progreso', '2026-09-29', NULL,         '{}', '{}', '{}', '{}'),
  (9604, 'R-9604', 'T96 sin fin',    'Cerrada',     '2026-09-29', NULL,         '{}', '{}', '{}', '{}'),
  (9605, 'R-9605', 'T96 motivo',     'Completada',  '2026-09-29', '2026-09-29', '{}', '{}', '{}', '{}'),
  (9606, 'R-9606', 'T96 cliente viejo', 'Cerrada',  '2026-09-29', '2026-09-29', '{}', '{}', '{}', '{}');
INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id, fecha) VALUES
  (9621, 'OV-9621', 'Cliente 96', 'x', 100, 'Entregada', 'Efectivo',          'Contado', 9601, '2026-09-29'),
  (9622, 'OV-9622', 'Cliente 96', 'x', 50,  'Entregada', 'Transferencia',     'Contado', 9601, '2026-09-29'),
  (9623, 'OV-9623', 'Cliente 96', 'x', 30,  'Entregada', 'QR / Link de pago', 'Contado', 9601, '2026-09-29'),
  (9624, 'OV-9624', 'Cliente 96', 'x', 70,  'Entregada', 'Crédito',           'Credito', 9601, '2026-09-29'),
  (9625, 'OV-9625', 'Cliente 96', 'x', 10,  'Entregada', 'Efectivo',          'Contado', 9605, '2026-09-29'),
  (9626, 'OV-9626', 'Cliente 96', 'x', 40,  'Entregada', 'Efectivo',          'Contado', 9602, '2026-09-30');
INSERT INTO pagos (orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES
  (9621, 100, 'Efectivo',          '2026-09-29', 'T96-1', 0, 0),
  (9622, 50,  'Transferencia',     '2026-09-29', 'T96-2', 0, 0),
  (9623, 30,  'QR / Link de pago', '2026-09-29', 'T96-3', 0, 0),
  (9624, 70,  'Crédito',           '2026-09-29', 'T96-4', 0, 0),
  (9625, 10,  'Efectivo',          '2026-09-29', 'T96-6', 0, 0),
  (9626, 40,  'Efectivo',          '2026-09-30', 'T96-7', 0, 0);
COMMIT;

CREATE OR REPLACE FUNCTION t96_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '96000000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t96_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t96_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
GRANT EXECUTE ON FUNCTION t96_actor(INTEGER), t96_assert(BOOLEAN, TEXT), t96_err(TEXT, TEXT, TEXT, TEXT) TO PUBLIC;
DROP TABLE IF EXISTS t96_ids;
CREATE TEMP TABLE t96_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t96_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t96_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t96_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t96_j(TEXT) TO PUBLIC;

\echo '── 096: día de negocio canónico (zona del negocio)'
-- 122 cambia la zona a America/Monterrey (Durango); la suite corre antes y después.
SELECT t96_assert(fin_zona_negocio() IN ('America/Mazatlan', 'America/Monterrey') AND fin_hoy() = fin_dia_negocio(now()) AND fin_hoy() = (now() AT TIME ZONE fin_zona_negocio())::date, '096-01 fin_hoy = día de calendario en la zona del negocio');
-- 23:30 del 29 en la zona del negocio: en UTC (y en Madrid) ya es el 30. La suite corre antes y después de 122
-- (Mazatlán → Durango), así que el instante se deriva de fin_zona_negocio().
SELECT t96_assert(fin_dia_negocio(('2026-09-29 23:30'::timestamp AT TIME ZONE fin_zona_negocio())) = '2026-09-29'
                  AND (('2026-09-29 23:30'::timestamp AT TIME ZONE fin_zona_negocio()) AT TIME ZONE 'UTC')::date = '2026-09-30',
  '096-02 instante donde UTC y la zona del negocio son días distintos: el día de negocio sigue a la zona del negocio (29)');
SELECT t96_assert(fin_dia_negocio(('2026-09-30 00:00'::timestamp AT TIME ZONE fin_zona_negocio())) = '2026-09-30'
                  AND fin_dia_negocio(('2026-09-30 00:00'::timestamp AT TIME ZONE fin_zona_negocio()) - interval '1 second') = '2026-09-29',
  '096-03 el día de negocio cambia a medianoche de la zona del negocio');
SELECT t96_assert((SELECT bool_and(column_default ~ 'fin_hoy\(\)') AND count(*) = 11 FROM information_schema.columns WHERE table_schema = 'public'
  AND (table_name, column_name) IN (('pagos','fecha'), ('leads','fecha'), ('movimientos_contables','fecha'), ('cuentas_por_cobrar','fecha_venta'), ('costos_historial','fecha'),
       ('produccion','fecha'), ('mermas','fecha'), ('cuentas_por_pagar','fecha_emision'), ('pagos_proveedores','fecha'), ('ordenes','fecha'), ('rutas','fecha'))), '096-04 las 11 fechas de negocio usan fin_hoy() como default (ya no CURRENT_DATE UTC)');
SELECT t96_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_default ILIKE '%CURRENT_DATE%'), '096-05 ninguna columna queda con default CURRENT_DATE');
SELECT t96_assert(pg_get_functiondef('public.reporte_financiero(date,date)'::regprocedure) ~ 'fin_zona_negocio\(\)'
  AND pg_get_functiondef('public.reporte_financiero(date,date)'::regprocedure) !~ 'Mexico_City', '096-06 el reporte 093 usa la zona canónica');

\echo '── 096: escritores del servidor en el día de negocio'
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(1);
INSERT INTO rutas (folio, nombre, estatus, carga, carga_autorizada, extra_autorizado, clientes_asignados) VALUES ('R-96N', 'T96 nueva', 'Programada', '{}', '{}', '{}', '[]');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(3);
INSERT INTO t96_ids VALUES ('pr', registrar_produccion('96000000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 96', 'P96-H', 5, 'CF-96')::text);
INSERT INTO t96_ids VALUES ('tr', registrar_transformacion('96000000-0000-0000-0000-00000000a002', 'P96-MP', 4, 'P96-H', 3, 'CF-96')::text);
COMMIT;
SELECT t96_assert((SELECT fecha = fin_hoy() AND fecha = fin_dia_negocio(created_at) FROM rutas WHERE nombre = 'T96 nueva'), '096-10 ruta nueva (addRuta sin fecha): fecha = día de negocio de su creación');
SELECT t96_assert((SELECT fecha = fin_hoy() AND fecha = fin_dia_negocio(created_at) FROM produccion WHERE id = (t96_j('pr') ->> 'id')::bigint), '096-11 producción: fecha = día de negocio de su creación');
SELECT t96_assert((SELECT fecha = fin_hoy() AND fecha = fin_dia_negocio(created_at) FROM produccion WHERE id = (t96_j('tr') ->> 'id')::bigint), '096-12 transformación: fecha = día de negocio de su creación');

\echo '── 096: reporte 093 en el día de negocio'
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, fecha, delivered_at) VALUES (9640, 'OV-9640', 'Cliente 96', 'x', 123, 'Entregada', 'Efectivo', 'Contado', '2031-03-10', ('2031-03-10 23:30'::timestamp AT TIME ZONE fin_zona_negocio()));
INSERT INTO pagos (orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, created_at) VALUES (9640, 45, 'Efectivo', '2031-03-10', 'T96-R', 0, 0, ('2031-03-10 23:30'::timestamp AT TIME ZONE fin_zona_negocio()));
COMMIT;
SELECT t96_assert((reporte_financiero('2031-03-10', '2031-03-10') -> 'resultados' ->> 'ventas_entregadas')::numeric = 123
  AND (reporte_financiero('2031-03-11', '2031-03-11') -> 'resultados' ->> 'ventas_entregadas')::numeric = 0, '096-15 entrega a las 23:30 de la zona del negocio (ya día 11 en UTC): ingreso del día 10');
SELECT t96_assert((reporte_financiero('2031-03-10', '2031-03-10') -> 'flujo' ->> 'entradas_pagos')::numeric = 45
  AND (reporte_financiero('2031-03-11', '2031-03-11') -> 'flujo' ->> 'entradas_pagos')::numeric = 0, '096-16 pago a las 23:30 de la zona del negocio: entrada de efectivo del día 10');

\echo '── 096: caja por contrato'
SELECT t96_assert((SELECT count(*) = 1 FROM pg_constraint WHERE conname = 'cierres_diarios_ruta_id_key')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cierres_diarios'::regclass AND contype = 'u' AND array_length(conkey, 1) = 2), '096-20 identidad: UNIQUE(ruta_id); sin UNIQUE(fecha, ruta_id)');
SELECT t96_assert((SELECT prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE oid = 'public.cerrar_caja_ruta(uuid,bigint,numeric,numeric,text,text)'::regprocedure)
  AND pg_get_function_identity_arguments('public.cerrar_caja_ruta(uuid,bigint,numeric,numeric,text,text)'::regprocedure) !~* 'date', '096-21 contrato de caja: SECURITY DEFINER, sin parámetro de fecha (el cliente no la envía)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(1);
INSERT INTO t96_ids VALUES ('pend0', rutas_pendientes_caja()::text);
COMMIT;
SELECT t96_assert((SELECT count(*) FROM jsonb_array_elements(t96_j('pend0')) x WHERE (x ->> 'id')::int IN (9601, 9602, 9604, 9605, 9606)) = 5
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t96_j('pend0')) x WHERE (x ->> 'id')::int = 9603), '096-22 pendientes de caja: rutas cerradas sin caja (la ruta en curso no)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(2);
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9601, 100, 80)$q$, '096-23 Ventas: cierre de caja denegado', '42501');
SELECT t96_err($q$SELECT rutas_pendientes_caja()$q$, '096-24 Ventas: pendientes de caja denegado', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9601, 100, 80)$q$, '096-25 anon: sin EXECUTE', '42501');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(1);
INSERT INTO t96_ids VALUES ('c1', cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9601, 100, 80, '', 'sin novedad')::text);
INSERT INTO t96_ids VALUES ('c1r', cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9601, 100, 80, '', 'sin novedad')::text);
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9601, 90, 80, 'faltan diez pesos', 'sin novedad')$q$, '096-26 misma operación con otro conteo: rechazada', '23505');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c002', 9601, 100, 80)$q$, '096-27 otra operación (otro navegador/zona) sobre la ruta cerrada: rechazada', '22023', '%ya tiene cierre%');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c001', 9605, 10, 0)$q$, '096-28 la misma operación en otra ruta: rechazada', '23505');
COMMIT;
SELECT t96_assert((SELECT count(*) = 1 AND bool_and(fecha = '2026-09-29' AND esperado_efectivo = 100 AND esperado_transferencia = 80 AND esperado_credito = 70 AND esperado_total = 250
  AND contado_total = 180 AND diferencia = 0 AND cerrado_por = 'Admin 96' AND notas = 'sin novedad' AND motivo_diferencia IS NULL AND jsonb_array_length(pagos_snapshot) = 4)
  FROM cierres_diarios WHERE ruta_id = 9601), '096-29 una caja: fecha = fecha_fin (29), esperado y snapshot del servidor, actor canónico');
SELECT t96_assert((t96_j('c1r') ->> 'replay') = 'true' AND (t96_j('c1r') ->> 'cierre_id') = (t96_j('c1') ->> 'cierre_id')
  AND (SELECT count(*) = 1 FROM auditoria WHERE accion = 'Cierre caja' AND detalle LIKE 'R-9601%'), '096-30 respuesta perdida: el reintento es replay con el mismo cierre y sin auditoría duplicada');
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(1);
INSERT INTO t96_ids VALUES ('c2', cerrar_caja_ruta('96000000-0000-0000-0000-00000000c003', 9602, 40, 0)::text);
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c004', 9603, 0, 0)$q$, '096-31 ruta en curso: no se cierra caja', '22023');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c005', 9604, 0, 0)$q$, '096-32 ruta sin fecha de cierre: falla cerrado (sin fecha del navegador)', '22023', '%fecha de cierre%');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c006', 9605, 15, 0)$q$, '096-33 diferencia sin motivo: rechazada', '22023', '%Motivo requerido%');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c006', 9605, 200, 0, 'corto')$q$, '096-34 diferencia > 100 con motivo corto: rechazada', '22023', '%al menos 10%');
SELECT t96_err($q$SELECT cerrar_caja_ruta('96000000-0000-0000-0000-00000000c006', 9605, -1, 0)$q$, '096-35 conteo negativo: rechazado', '22023');
INSERT INTO t96_ids VALUES ('c5', cerrar_caja_ruta('96000000-0000-0000-0000-00000000c006', 9605, 15, 0, 'sobrante del día')::text);
COMMIT;
SELECT t96_assert((t96_j('c2') ->> 'fecha') = '2026-09-30' AND (SELECT fecha = '2026-09-30' FROM cierres_diarios WHERE ruta_id = 9602), '096-36 ruta planeada el 29 y cerrada después de medianoche: la caja es del 30');
SELECT t96_assert((SELECT diferencia = 5 AND motivo_diferencia = 'sobrante del día' FROM cierres_diarios WHERE ruta_id = 9605), '096-37 diferencia con motivo: sobrante 5');

\echo '── 096: frontend anterior (INSERT REST) y contención 097'
DO $do$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.cierres_diarios', 'INSERT') THEN
    PERFORM t96_actor(1); SET LOCAL ROLE authenticated;
    PERFORM t96_err($q$INSERT INTO cierres_diarios (fecha, ruta_id, cerrado_por) VALUES ('2026-09-28', 9606, 'x')$q$, '096-40 INSERT REST de caja sin privilegio (097)', '42501');
    RESET ROLE;
    RETURN;
  END IF;
  PERFORM t96_actor(1); SET LOCAL ROLE authenticated;
  -- El cliente viejo calculaba el 28 en México; el servidor guarda la fecha de la ruta.
  INSERT INTO cierres_diarios (fecha, ruta_id, cerrado_por) VALUES ('2026-09-28', 9606, 'Admin 96');
  PERFORM t96_err($q$INSERT INTO cierres_diarios (fecha, ruta_id, cerrado_por) VALUES ('2026-09-29', 9606, 'Admin 96')$q$, '096-40 segundo INSERT REST para la misma ruta: rechazado (una caja por ruta)', '23505');
  RESET ROLE;
  PERFORM t96_assert((SELECT count(*) = 1 AND bool_and(fecha = '2026-09-29') FROM cierres_diarios WHERE ruta_id = 9606), '096-41 cliente anterior: la fecha guardada es la de la ruta (29), no la del navegador (28)');
END $do$;
SELECT t96_assert((SELECT count(*) FROM cierres_diarios WHERE ruta_id BETWEEN 9601 AND 9619 GROUP BY ruta_id ORDER BY 1 DESC LIMIT 1) = 1, '096-42 nunca más de una caja por ruta');
BEGIN; SET LOCAL ROLE authenticated; SELECT t96_actor(1);
INSERT INTO t96_ids VALUES ('pend1', rutas_pendientes_caja()::text);
COMMIT;
SELECT t96_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t96_j('pend1')) x WHERE (x ->> 'id')::int IN (9601, 9602, 9605))
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(t96_j('pend1')) x WHERE (x ->> 'id')::int = 9604), '096-43 con caja cerrada la ruta deja de estar pendiente (identidad por ruta, sin fechas)');

BEGIN; SELECT t96_limpiar(); COMMIT;
\echo '── 096: TODAS LAS PRUEBAS OK'
