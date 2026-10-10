-- 133_venta_barra_desde_entera_test.sql — la media barra, la picada y la triturada
-- se venden contra la barra entera: regla de disponibilidad, alta de la orden y
-- entrega directa que parte / prepara lo que falta en el mismo cuarto.
-- Todo dentro de UNA transacción con ROLLBACK: no deja nada en la base.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
-- Solo cuenta el inventario de la prueba.
UPDATE cuartos_frios SET stock = COALESCE(stock, '{}'::jsonb) - 'HIB-50K' - 'HIB-25K' - 'HIP-25K' - 'HIT-25K';
DELETE FROM productos WHERE sku IN ('HIB-50K', 'HIB-25K', 'HIP-25K', 'HIT-25K', 'T133-EMP', 'T133-X');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('T133-EMP', 'Bolsa 133', 'Empaque', 0, 5, 2, NULL),
  ('T133-X',   'Otro 133', 'Producto Terminado', 30, 0, 0, NULL),
  ('HIB-50K', 'Barra de hielo ~50 kg', 'Producto Terminado', 120, 0, 0, NULL),
  ('HIB-25K', 'Media barra de hielo ~25 kg', 'Producto Terminado', 60, 0, 0, NULL),
  ('HIP-25K', 'Picada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T133-EMP'),
  ('HIT-25K', 'Triturada de barra (bolsa)', 'Producto Terminado', 60, 0, 0, 'T133-EMP');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-T133', 'Cuarto 133', '{"HIB-50K": 4, "T133-X": 10}'), ('CF-T133B', 'Cuarto 133 B', '{"HIB-50K": 1}');
INSERT INTO auth.users (id, email) VALUES ('13300000-0000-0000-0000-000000000001', 'a@t133'), ('13300000-0000-0000-0000-000000000002', 'v@t133');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (13301, 'Admin T133', 'a@t133', 'Admin', 'Activo', '13300000-0000-0000-0000-000000000001'),
  (13302, 'Ventas T133', 'v@t133', 'Ventas', 'Activo', '13300000-0000-0000-0000-000000000002');
INSERT INTO clientes (id, nombre, rfc, calle, colonia) VALUES (13301, 'Cliente T133', 'XAXX010101000', 'Calle', 'Col');
SET LOCAL session_replication_role = origin;
-- El alta del cliente por contrato/disparador crea su sucursal principal (123); en modo réplica no corrió.
INSERT INTO sucursales (cliente_id, nombre, es_principal) SELECT 13301, 'Principal', true WHERE NOT EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = 13301);

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_like TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_err NOT ILIKE p_like THEN RAISE EXCEPTION 'FAIL: % (error inesperado: %)', p_msg, v_err; END IF;
  RAISE NOTICE 'OK: % [%]', p_msg, left(v_err, 110);
END $$;
-- Existencias del cuarto como "barras|medias|picada|triturada".
CREATE OR REPLACE FUNCTION pg_temp.st(p_cf TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('|', COALESCE((stock ->> 'HIB-50K')::int, 0), COALESCE((stock ->> 'HIB-25K')::int, 0), COALESCE((stock ->> 'HIP-25K')::int, 0), COALESCE((stock ->> 'HIT-25K')::int, 0))
    FROM cuartos_frios WHERE id = p_cf $$;

\echo '── 133: la regla'
SELECT pg_temp.ok((SELECT NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.barra_exigir_disponible(jsonb,jsonb,text)'::regprocedure)
  AND (SELECT NOT has_function_privilege('authenticated', oid, 'EXECUTE') FROM pg_proc WHERE oid = 'public.barra_surtir_cuarto(uuid,text,jsonb)'::regprocedure)
  AND (SELECT bool_and(prosecdef AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc
        WHERE oid IN ('public.crear_orden(jsonb,jsonb)'::regprocedure, 'public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)),
  '133-01 funciones internas sin EXECUTE por API; los dos contratos conservan firma y permisos');
SELECT barra_exigir_disponible('{"HIB-25K":2}', '{"HIB-50K":1}', NULL);
SELECT barra_exigir_disponible('{"HIP-25K":3,"HIT-25K":1}', '{"HIB-50K":2}', NULL);
SELECT barra_exigir_disponible('{"HIP-25K":3}', '{"HIB-50K":1,"HIP-25K":1}', NULL);
SELECT barra_exigir_disponible('{"HIB-50K":1,"HIB-25K":1,"HIT-25K":1}', '{"HIB-50K":2}', NULL);
SELECT barra_exigir_disponible('{"HIP-25K":1}', '{"HIB-25K":1}', NULL);
SELECT barra_exigir_disponible('{"T133-X":99}', '{}', NULL);
SELECT pg_temp.ok(true, '133-02 con barra entera alcanza: 1 barra = 2 medias = 2 bolsas; lo ya partido o preparado cuenta');
SELECT pg_temp.falla($q$SELECT barra_exigir_disponible('{"HIB-25K":3}', '{"HIB-50K":1}', NULL)$q$, '133-03 tres medias con una barra: no alcanza', '%faltan 1 media%');
SELECT pg_temp.falla($q$SELECT barra_exigir_disponible('{"HIB-50K":2,"HIP-25K":1}', '{"HIB-50K":2}', 'CF-1')$q$, '133-04 la barra que se vende entera no se puede partir además', '%en cuarto CF-1%faltan 1 media%');
SELECT pg_temp.falla($q$SELECT barra_exigir_disponible('{"HIT-25K":1}', '{"HIP-25K":5}', NULL)$q$, '133-05 la picada no sirve para surtir triturada', '%faltan 1 media%');

\echo '── 133: alta de la orden (Ventas)'
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"13300000-0000-0000-0000-000000000002"}', true);
CREATE TEMP TABLE t133 (k TEXT PRIMARY KEY, v JSONB);
INSERT INTO t133 VALUES ('o1', crear_orden('{"cliente_id": 13301}', '[{"sku":"HIB-25K","cantidad":1},{"sku":"HIP-25K","cantidad":3},{"sku":"HIT-25K","cantidad":2}]'));
SELECT pg_temp.ok((SELECT (v ->> 'total')::numeric = 360 FROM t133 WHERE k = 'o1'), '133-06 sin nada partido ni preparado, con 5 barras en planta: la venta de media, picada y triturada SÍ se crea');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13301}', '[{"sku":"HIP-25K","cantidad":11}]')$q$, '133-07 más de lo que rinden las barras de toda la planta: rechazada', '%Stock insuficiente de barra%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13301}', '[{"sku":"HIB-50K","cantidad":5},{"sku":"HIB-25K","cantidad":1}]')$q$, '133-08 todas las barras enteras más una media: rechazada', '%Stock insuficiente de barra%');
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 13301}', '[{"sku":"T133-X","cantidad":11}]')$q$, '133-09 los demás productos se validan igual que antes', '%Stock insuficiente para T133-X%');

\echo '── 133: entrega directa — parte y prepara lo que falta, en el cuarto asignado'
INSERT INTO t133 VALUES ('e1', completar_venta_directa('13300000-0000-0000-0000-00000000e001', (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o1'), 'contado', 'Efectivo',
  '[{"sku":"HIB-25K","cuarto_id":"CF-T133","cantidad":1},{"sku":"HIP-25K","cuarto_id":"CF-T133","cantidad":3},{"sku":"HIT-25K","cuarto_id":"CF-T133","cantidad":2}]', NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st('CF-T133') = '1|0|0|0', '133-10 6 medias equivalentes = 3 barras: queda 1 barra entera y nada suelto');
SELECT pg_temp.ok((SELECT estatus = 'Entregada' FROM ordenes WHERE id = (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o1'))
  AND (SELECT stock = 0 FROM productos WHERE sku = 'T133-EMP')
  AND (SELECT count(*) FILTER (WHERE tipo = 'Preparacion') >= 2 AND count(*) FILTER (WHERE tipo = 'Partido') >= 1 FROM produccion WHERE cuarto_id = 'CF-T133'),
  '133-11 la orden queda Entregada; se consumieron las 5 bolsas y quedaron las filas de Partido y Preparación de Producción');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM inventario_mov WHERE cuarto_id = 'CF-T133' AND tipo = 'Salida' AND referencia = 'venta_directa/' || (SELECT v ->> 'id' FROM t133 WHERE k = 'o1')),
  '133-12 la salida de la venta queda en el kardex por cada producto vendido');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"13300000-0000-0000-0000-000000000002"}', true);
-- Reintento con la misma operación: misma respuesta, sin volver a partir.
INSERT INTO t133 VALUES ('e1b', completar_venta_directa('13300000-0000-0000-0000-00000000e001', (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o1'), 'contado', 'Efectivo',
  '[{"sku":"HIB-25K","cuarto_id":"CF-T133","cantidad":1},{"sku":"HIP-25K","cuarto_id":"CF-T133","cantidad":3},{"sku":"HIT-25K","cuarto_id":"CF-T133","cantidad":2}]', NULL, NULL));
INSERT INTO t133 VALUES ('o2', crear_orden('{"cliente_id": 13301}', '[{"sku":"HIB-25K","cantidad":1}]'));
INSERT INTO t133 VALUES ('e2', completar_venta_directa('13300000-0000-0000-0000-00000000e002', (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o2'), 'contado', 'Efectivo',
  '[{"sku":"HIB-25K","cuarto_id":"CF-T133","cantidad":1}]', NULL, NULL));
-- Ya no hay bolsas: la picada no se puede entregar y NADA se mueve.
INSERT INTO t133 VALUES ('o3', crear_orden('{"cliente_id": 13301}', '[{"sku":"HIP-25K","cantidad":1}]'));
SELECT pg_temp.falla(format($q$SELECT completar_venta_directa('13300000-0000-0000-0000-00000000e003', %s, 'contado', 'Efectivo', '[{"sku":"HIP-25K","cuarto_id":"CF-T133","cantidad":1}]', NULL, NULL)$q$,
  (SELECT v ->> 'id' FROM t133 WHERE k = 'o3')), '133-15 sin bolsas para picar: la entrega falla completa (sin negativos)', '%T133-EMP%');
-- Cuarto sin barra suficiente.
INSERT INTO t133 VALUES ('o4', crear_orden('{"cliente_id": 13301}', '[{"sku":"HIB-25K","cantidad":3}]'));
SELECT pg_temp.falla(format($q$SELECT completar_venta_directa('13300000-0000-0000-0000-00000000e004', %s, 'contado', 'Efectivo', '[{"sku":"HIB-25K","cuarto_id":"CF-T133B","cantidad":3}]', NULL, NULL)$q$,
  (SELECT v ->> 'id' FROM t133 WHERE k = 'o4')), '133-16 el cuarto elegido no tiene barra suficiente: rechazado antes de mover nada', '%Stock insuficiente de barra en cuarto CF-T133B%');
INSERT INTO t133 VALUES ('e4', completar_venta_directa('13300000-0000-0000-0000-00000000e005', (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o4'), 'contado', 'Efectivo',
  '[{"sku":"HIB-25K","cuarto_id":"CF-T133B","cantidad":2},{"sku":"HIB-25K","cuarto_id":"CF-T133","cantidad":1}]', NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok((SELECT (v ->> 'replay')::boolean FROM t133 WHERE k = 'e1b'), '133-13 reintento de la misma entrega: respuesta original, sin partir otra barra');
SELECT pg_temp.ok(pg_temp.st('CF-T133') = '0|0|0|0' AND pg_temp.st('CF-T133B') = '0|0|0|0',
  '133-14 media barra: se parte una barra, se entrega una mitad y la otra queda en el cuarto; la siguiente venta usa esa mitad antes de partir otra (repartida entre dos cuartos)');
SELECT pg_temp.ok((SELECT estatus = 'Creada' FROM ordenes WHERE id = (SELECT (v ->> 'id')::bigint FROM t133 WHERE k = 'o3'))
  AND NOT EXISTS (SELECT 1 FROM stock_operaciones WHERE operacion_id IN ('13300000-0000-0000-0000-00000000e003', '13300000-0000-0000-0000-00000000e004')),
  '133-17 las entregas rechazadas no dejaron operación, salida ni preparación');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM cuartos_frios cf, jsonb_each_text(cf.stock) s WHERE cf.id LIKE 'CF-T133%' AND s.value::int < 0)
  AND (SELECT stock >= 0 FROM productos WHERE sku = 'T133-EMP'), '133-18 sin existencias negativas de producto ni de bolsas');

ROLLBACK;
\echo '── 133: TODAS LAS PRUEBAS OK'
