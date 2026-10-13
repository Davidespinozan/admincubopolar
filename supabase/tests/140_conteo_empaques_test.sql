-- 140_conteo_empaques_test.sql — T5-C: conteo físico de empaques. Lectura solo
-- de Admin, conteo igual / menor / mayor / cero, conteo obsoleto (Producción
-- consumió entre abrir y confirmar), idempotencia, kardex, auditoría, costo
-- intacto e historial. Todo dentro de UNA transacción con ROLLBACK.
-- (La concurrencia con dos conexiones corre en el runner: C140a–d.)

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('14000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t140' FROM generate_series(1, 6) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14001, 'Admin T140',    'u1@t140', 'Admin',          'Activo', '14000000-0000-0000-0000-000000000001'),
  (14002, 'Bolsas T140',   'u2@t140', 'Almacén Bolsas', 'Activo', '14000000-0000-0000-0000-000000000002'),
  (14003, 'Prod T140',     'u3@t140', 'Producción',     'Activo', '14000000-0000-0000-0000-000000000003'),
  (14004, 'Ventas T140',   'u4@t140', 'Ventas',         'Activo', '14000000-0000-0000-0000-000000000004'),
  (14005, 'Empleado T140', 'u5@t140', 'Empleado',       'Activo', '14000000-0000-0000-0000-000000000005'),
  (14006, 'Chofer T140',   'u6@t140', 'Chofer',         'Activo', '14000000-0000-0000-0000-000000000006');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-140', 'Cuarto 140', '{}');
-- Empaques: nacen en 0 y sin costo (108); la existencia entra por recepción de compra.
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P140-A', 'Bolsa A 140', 'Empaque', 0, 0, 0, NULL),
  ('P140-B', 'Bolsa B 140 (sin movimientos)', 'Empaque', 0, 0, 0, NULL),
  ('P140-C', 'Bolsa C 140', 'Empaque', 0, 0, 0, NULL),
  ('P140-H', 'Hielo 140', 'Producto Terminado', 30, 0, 0, 'P140-A');
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.falla(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT '%', p_detalle TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_err TEXT; v_state TEXT; v_det TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, v_det = PG_EXCEPTION_DETAIL; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR v_err NOT ILIKE p_like OR (p_detalle IS NOT NULL AND COALESCE(v_det, '') NOT LIKE '%' || p_detalle || '%') THEN
    RAISE EXCEPTION 'FAIL: % (error inesperado % % / %)', p_msg, v_state, v_err, v_det;
  END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 105);
END $$;
-- En la API cada llamada es su propia transacción; aquí todo corre en una: la marca de contrato se limpia.
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-0000-0000-00000000000' || p_n || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14000000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Estado de un empaque: existencia|movimientos de kardex|revisión|costo
CREATE OR REPLACE FUNCTION pg_temp.st(p_sku TEXT) RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT stock FROM public.productos WHERE sku = p_sku), (SELECT count(*) FROM public.inventario_mov WHERE producto = p_sku),
                        ((SELECT COALESCE(max(id), 0) FROM public.inventario_mov WHERE producto = p_sku) > 0)::text, (SELECT costo_unitario::float8::text FROM public.productos WHERE sku = p_sku)) $$;
CREATE OR REPLACE FUNCTION pg_temp.rev(p_sku TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE(max(id), 0) FROM public.inventario_mov WHERE producto = p_sku $$;
CREATE OR REPLACE FUNCTION pg_temp.ex(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock::int FROM public.productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION pg_temp.aud(p_sku TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.auditoria WHERE modulo = 'Inventario' AND accion = 'Ajustar' AND detalle LIKE p_sku || ':%Conteo físico:%' $$;
CREATE OR REPLACE FUNCTION pg_temp.ops(p_sku TEXT) RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.stock_operaciones WHERE tipo = 'ajuste_existencia' AND resultado ->> 'sku' = p_sku $$;
CREATE TEMP TABLE t140 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t140 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t140 WHERE k = p_k $$;

\echo '── 140: catálogo'
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND array_to_string(proconfig, ';') = 'search_path=public, pg_temp' AND has_function_privilege('authenticated', oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', oid, 'EXECUTE')) AND count(*) = 3
                     FROM pg_proc WHERE oid IN ('public.empaques_para_conteo()'::regprocedure, 'public.historial_empaque(text,integer)'::regprocedure,
                                                'public.registrar_conteo_empaque(uuid,text,integer,bigint,numeric,text)'::regprocedure)),
  '140-01 tres contratos: SECURITY DEFINER, search_path fijo, sin anon');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.ajustar_existencia(uuid,text,integer,text)'::regprocedure)) IN ('def11d269c049c7301dfa568a96c529f', '0a5f9c2c95b89c0deb8a38bca5dd7f8a'),   -- la de 108, o la de 144 (solo acota el producto terminado al CEDIS; la rama de empaque es idéntica)
  '140-02 ajustar_existencia NO cambia (md5 = producción): sigue siendo quien mueve el inventario');

\echo '── 140: existencias por recepción de compra'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
SELECT registrar_recepcion_compra(pg_temp.op(1), 'P140-A', 1000, 500, 'Prov 140', false);
SELECT registrar_recepcion_compra(pg_temp.op(2), 'P140-C', 300, 300, 'Prov 140', false);
SELECT pg_temp.ok(pg_temp.st('P140-A') = '1000|1|true|0.5' AND pg_temp.st('P140-C') = '300|1|true|1' AND pg_temp.st('P140-B') = '0|0|false|0',
  '140-03 A: 1000 @ $0.50 · C: 300 @ $1 · B: sin existencia ni movimientos');
RESET ROLE;
INSERT INTO t140 VALUES ('ch0', to_jsonb((SELECT count(*) FROM costos_empaque_historial WHERE sku LIKE 'P140-%')));

\echo '── 140: lectura (solo Admin)'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('l0', empaques_para_conteo());
SELECT pg_temp.ok((SELECT e ->> 'existencia' = '1000' AND (e ->> 'costo_unitario')::numeric = 0.5 AND (e ->> 'revision')::bigint = pg_temp.rev('P140-A') AND (e ->> 'revision')::bigint > 0
                          AND e ->> 'unidad' = 'piezas' AND e -> 'ultimo_movimiento' ->> 'tipo' = 'Entrada' AND e -> 'ultimo_movimiento' ->> 'origen' LIKE 'Recepción de compra%'
                          AND (e ->> 'usado_por')::int = 1 FROM jsonb_array_elements(pg_temp.j('l0')) e WHERE e ->> 'sku' = 'P140-A')
  AND (SELECT e ->> 'existencia' = '0' AND (e ->> 'revision')::bigint = 0 AND e -> 'ultimo_movimiento' = 'null'::jsonb FROM jsonb_array_elements(pg_temp.j('l0')) e WHERE e ->> 'sku' = 'P140-B')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('l0')) e WHERE e ->> 'sku' = 'P140-H'),
  '140-04 lista los empaques (no el producto terminado) con existencia, costo, último movimiento y revisión; sin movimientos = revisión 0');
DO $do$
DECLARE k INTEGER;
BEGIN
  FOREACH k IN ARRAY ARRAY[2, 3, 4, 5, 6] LOOP
    PERFORM pg_temp.como(k);
    PERFORM pg_temp.falla($q$SELECT empaques_para_conteo()$q$, '140-05 rol ' || k || ': sin lectura de empaques con costo', '42501');
    PERFORM pg_temp.falla($q$SELECT historial_empaque('P140-A', 10)$q$, '140-06 rol ' || k || ': sin historial', '42501');
    PERFORM pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(90), 'P140-A', 1000, pg_temp.rev('P140-A'), 900, 'Conteo de apertura')$q$, '140-07 rol ' || k || ': no registra conteos', '42501');
  END LOOP;
END $do$;
SELECT pg_temp.ok(pg_temp.st('P140-A') = '1000|1|true|0.5' AND pg_temp.ops('P140-A') = 0, '140-08 los intentos no autorizados (Almacén Bolsas, Producción, Ventas, Empleado, Chofer) no cambiaron nada');

\echo '── 140: conteo igual, menor, doble clic, obsoleto'
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('c1', registrar_conteo_empaque(pg_temp.op(10), 'P140-A', 1000, pg_temp.rev('P140-A'), 1000, 'Conteo de apertura'));
SELECT pg_temp.ok((pg_temp.j('c1') ->> 'delta')::int = 0 AND (pg_temp.j('c1') ->> 'diferencia')::int = 0 AND (pg_temp.j('c1') ->> 'anterior')::int = 1000 AND (pg_temp.j('c1') ->> 'nueva')::int = 1000
  AND pg_temp.st('P140-A') = '1000|1|true|0.5' AND pg_temp.ops('P140-A') = 1 AND pg_temp.aud('P140-A') = 1,
  '140-09 conteo IGUAL al registrado: sin movimiento de kardex, pero el conteo queda registrado (operación y auditoría)');
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('r0', to_jsonb(pg_temp.rev('P140-A')));
INSERT INTO t140 VALUES ('c2', registrar_conteo_empaque(pg_temp.op(11), 'P140-A', 1000, pg_temp.rev('P140-A'), 940, 'Conteo de apertura'));
SELECT pg_temp.ok((pg_temp.j('c2') ->> 'anterior')::int = 1000 AND (pg_temp.j('c2') ->> 'nueva')::int = 940 AND (pg_temp.j('c2') ->> 'delta')::int = -60 AND (pg_temp.j('c2') ->> 'diferencia')::int = -60
  AND (pg_temp.j('c2') ->> 'conteo')::int = 940 AND NOT (pg_temp.j('c2') ->> 'replay')::boolean AND pg_temp.j('c2') ->> 'actor' LIKE '%Admin T140%'
  AND pg_temp.st('P140-A') = '940|2|true|0.5',
  '140-10 conteo MENOR: existencia 1000 → 940, un movimiento de kardex; el costo promedio NO cambia; quedan anterior, conteo, diferencia, resultante y actor');
RESET ROLE;
SELECT pg_temp.ok((SELECT tipo = 'Salida' AND cantidad = 60 AND origen = 'Ajuste manual: Conteo físico: Conteo de apertura' AND referencia = 'ajuste_existencia/P140-A'
                          AND operacion_id = pg_temp.op(11) AND usuario LIKE '%Admin T140%' FROM inventario_mov WHERE producto = 'P140-A' ORDER BY id DESC LIMIT 1)
  AND (SELECT count(*) = 1 FROM auditoria WHERE modulo = 'Inventario' AND accion = 'Ajustar' AND detalle = 'P140-A: 1000 → 940. Motivo: Conteo físico: Conteo de apertura'),
  '140-11 kardex (Salida 60, origen y referencia del ajuste, operación) y auditoría ("1000 → 940", motivo) por el mecanismo de siempre');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('c2b', registrar_conteo_empaque(pg_temp.op(11), 'P140-A', 1000, (pg_temp.j('r0') #>> '{}')::bigint, 940, 'Conteo de apertura'));
SELECT pg_temp.ok((pg_temp.j('c2b') ->> 'replay')::boolean AND (pg_temp.j('c2b') ->> 'nueva')::int = 940 AND pg_temp.st('P140-A') = '940|2|true|0.5' AND pg_temp.ops('P140-A') = 2,
  '140-12 doble clic / reintento con la misma operación: misma respuesta, sin segundo ajuste ni segundo kardex');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(11), 'P140-A', 1000, 0, 900, 'Conteo de apertura')$q$, '140-13 la misma operación con OTRO conteo: rechazada', '23505');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(12), 'P140-A', 1000, (pg_temp.j('r0') #>> '{}')::bigint, 900, 'Segundo conteo con datos viejos')$q$,
  '140-14 otra operación preparada con la existencia ANTERIOR (1000): conteo obsoleto', '22023', '%cambió desde que abriste el conteo (ahora hay 940 registradas; tú viste 1000)%', 'CONTEO_OBSOLETO');
SELECT pg_temp.ok(pg_temp.st('P140-A') = '940|2|true|0.5' AND pg_temp.ops('P140-A') = 2 AND pg_temp.aud('P140-A') = 2, '140-15 el rechazo no aplicó nada ni dejó operación, kardex o auditoría (fallo transaccional sin efectos)');

\echo '── 140: Producción consume bolsas entre abrir el conteo y confirmarlo'
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('v1', jsonb_build_object('ex', pg_temp.ex('P140-A'), 'rev', pg_temp.rev('P140-A')));   -- Admin abre el conteo: ve 940
SELECT pg_temp.como(3);
SELECT registrar_produccion(pg_temp.op(20), 'Turno 1', 'Máquina 140', 'P140-H', 100, 'CF-140');             -- Producción usa 100 bolsas
SELECT pg_temp.ok(pg_temp.ex('P140-A') = 840, '140-16 Producción consumió 100: existencia registrada 840');
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(21), 'P140-A', (pg_temp.j('v1') ->> 'ex')::int, (pg_temp.j('v1') ->> 'rev')::bigint, 930, 'Conteo preparado antes de producir')$q$,
  '140-17 el conteo preparado sobre 940 ya no se aplica: NO pisa el consumo de Producción', '22023', '%ahora hay 840 registradas; tú viste 940%', 'CONTEO_OBSOLETO');
SELECT pg_temp.ok(pg_temp.ex('P140-A') = 840, '140-18 la existencia sigue en 840 (antes, el ajuste absoluto la habría regresado a 930: 90 bolsas fantasma)');
-- Mismo número, otra revisión: salen 10 y entran 10 → la existencia vuelve a 840 pero hubo movimientos.
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('v2', jsonb_build_object('ex', pg_temp.ex('P140-A'), 'rev', pg_temp.rev('P140-A')));
SELECT pg_temp.como(3);
SELECT registrar_produccion(pg_temp.op(22), 'Turno 1', 'Máquina 140', 'P140-H', 10, 'CF-140');
SELECT pg_temp.como(2);
SELECT registrar_recepcion_compra(pg_temp.op(23), 'P140-A', 10, 5, 'Prov 140', false);
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(24), 'P140-A', (pg_temp.j('v2') ->> 'ex')::int, (pg_temp.j('v2') ->> 'rev')::bigint, 800, 'Conteo con la misma cifra')$q$,
  '140-19 misma existencia (840) pero con movimientos en medio: también es obsoleto (la revisión cambió)', '22023', '%cambió desde que abriste el conteo%', 'CONTEO_OBSOLETO');
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('c3', registrar_conteo_empaque(pg_temp.op(25), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), 835, 'Conteo actualizado'));
SELECT pg_temp.ok((pg_temp.j('c3') ->> 'anterior')::int = 840 AND (pg_temp.j('c3') ->> 'nueva')::int = 835 AND pg_temp.ex('P140-A') = 835, '140-20 con el conteo actualizado sí se aplica: 840 → 835');

\echo '── 140: conteo mayor, cero, cantidades y motivo inválidos'
SELECT pg_temp.como(1);
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(30), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), 900, 'Sobran bolsas')$q$,
  '140-21 conteo MAYOR: rechazado; las bolsas entran por recepción de compra (base de costo, 107/108)', '22023', '%sobran 65%compra recibida%', 'CONTEO_MAYOR');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(31), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), -1, 'Negativo')$q$, '140-22 cantidad negativa: rechazada', '22023', '%0 o mayor%');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(32), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), 800.5, 'Decimal')$q$, '140-23 cantidad decimal: rechazada (son piezas)', '22023', '%número entero de piezas%');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(33), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), 800, ' ')$q$, '140-24 sin motivo: rechazado', '22023', '%motivo del conteo%');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(34), 'P140-A', pg_temp.ex('P140-A'), pg_temp.rev('P140-A'), NULL, 'Sin cantidad')$q$, '140-25 sin cantidad: rechazado', '22023');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(35), 'P140-ZZ', 0, 0, 0, 'No existe')$q$, '140-26 empaque inexistente: rechazado', '22023', '%no encontrado%');
SELECT pg_temp.falla($q$SELECT registrar_conteo_empaque(pg_temp.op(36), 'P140-H', 0, 0, 0, 'Producto terminado')$q$, '140-27 producto terminado: no se cuenta aquí', '22023', '%no es un empaque%');
SELECT pg_temp.ok(pg_temp.ex('P140-A') = 835 AND pg_temp.ops('P140-A') = 3, '140-28 ningún rechazo cambió la existencia ni dejó operación');
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('c4', registrar_conteo_empaque(pg_temp.op(40), 'P140-C', 300, pg_temp.rev('P140-C'), 0, 'No queda ninguna bolsa de este tipo'));
SELECT pg_temp.ok((pg_temp.j('c4') ->> 'nueva')::int = 0 AND (pg_temp.j('c4') ->> 'delta')::int = -300 AND pg_temp.st('P140-C') = '0|2|true|1', '140-29 conteo CERO: 300 → 0 (nunca negativo); el costo se conserva');
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('c5', registrar_conteo_empaque(pg_temp.op(41), 'P140-B', 0, 0, 0, 'Conteo de apertura: no hay'));
SELECT pg_temp.ok((pg_temp.j('c5') ->> 'delta')::int = 0 AND pg_temp.st('P140-B') = '0|0|false|0' AND pg_temp.ops('P140-B') = 1, '140-30 empaque SIN movimientos anteriores (revisión 0): el conteo en 0 queda registrado, sin kardex');

\echo '── 140: historial, costos y producción posterior'
SELECT pg_temp.como(1);
INSERT INTO t140 VALUES ('h1', historial_empaque('P140-A', 50));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('h1') -> 'movimientos') = 6
  AND (SELECT m ->> 'tipo' = 'Salida' AND (m ->> 'cantidad')::int = 60 AND (m ->> 'existencia_anterior')::int = 1000 AND (m ->> 'existencia_resultante')::int = 940 AND m ->> 'usuario' LIKE '%Admin T140%'
         FROM jsonb_array_elements(pg_temp.j('h1') -> 'movimientos') m WHERE m ->> 'origen' = 'Ajuste manual: Conteo físico: Conteo de apertura')
  AND (SELECT count(*) = 2 AND bool_and(m ->> 'existencia_anterior' IS NULL) FROM jsonb_array_elements(pg_temp.j('h1') -> 'movimientos') m WHERE m ->> 'origen' LIKE 'Producción %')
  AND (SELECT count(*) = 2 FROM jsonb_array_elements(pg_temp.j('h1') -> 'movimientos') m WHERE m ->> 'origen' LIKE 'Recepción de compra%'),
  '140-31 historial: 2 compras, 2 consumos de Producción y 2 ajustes; solo los ajustes traen existencia anterior y resultante (no se inventa lo que el kardex no guarda)');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('h1') -> 'conteos') = 3
  AND (SELECT (c ->> 'diferencia')::int = 0 AND c ->> 'motivo' = 'Conteo físico: Conteo de apertura' AND c ->> 'actor' LIKE '%Admin T140%'
         FROM jsonb_array_elements(pg_temp.j('h1') -> 'conteos') c WHERE (c ->> 'existencia_resultante')::int = 1000),
  '140-32 los conteos quedan listados (también el que no tuvo diferencia), con motivo y responsable');
SELECT pg_temp.falla($q$SELECT historial_empaque('P140-H', 10)$q$, '140-33 historial de algo que no es empaque: rechazado', '22023');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM costos_empaque_historial WHERE sku LIKE 'P140-%') = (pg_temp.j('ch0') #>> '{}')::bigint + 1
  AND (SELECT costo_unitario = 0.5 FROM productos WHERE sku = 'P140-A') AND (SELECT costo_unitario = 1 FROM productos WHERE sku = 'P140-C'),
  '140-34 costos: ningún conteo tocó el costo promedio ni agregó historial de costo (el único renglón nuevo es la compra de 10)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
SELECT registrar_produccion(pg_temp.op(50), 'Turno 2', 'Máquina 140', 'P140-H', 35, 'CF-140');
RESET ROLE;
SELECT pg_temp.ok((SELECT stock = 800 FROM productos WHERE sku = 'P140-A') AND (SELECT (stock ->> 'P140-H')::int = 145 FROM cuartos_frios WHERE id = 'CF-140'),
  '140-35 producción posterior al ajuste: consume del inventario ajustado (835 → 800) como siempre');
SELECT pg_temp.ok((SELECT stock FROM productos WHERE sku = 'P140-A')
    = (SELECT COALESCE(sum(CASE WHEN tipo = 'Entrada' THEN cantidad ELSE -cantidad END), 0) FROM inventario_mov WHERE producto = 'P140-A')
  AND (SELECT stock FROM productos WHERE sku = 'P140-C') = (SELECT COALESCE(sum(CASE WHEN tipo = 'Entrada' THEN cantidad ELSE -cantidad END), 0) FROM inventario_mov WHERE producto = 'P140-C'),
  '140-36 integridad: la existencia de cada empaque = entradas − salidas de su kardex (un solo ledger)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM inventario_mov WHERE producto LIKE 'P140-%' AND operacion_id IS NOT NULL GROUP BY operacion_id, producto HAVING count(*) > 1)
  AND (SELECT count(*) FROM stock_operaciones WHERE tipo = 'ajuste_existencia' AND resultado ->> 'sku' LIKE 'P140-%') = 5,
  '140-37 sin duplicados: 5 conteos aplicados (A ×3, C, B), una operación cada uno');

ROLLBACK;
\echo '── 140: TODAS LAS PRUEBAS OK'
