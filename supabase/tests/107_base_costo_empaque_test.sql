-- 107_base_costo_empaque_test.sql — integridad de la base de costo del empaque
-- (107 + 108). El reverso de producción reingresa el empaque al promedio al
-- costo unitario histórico; el ajuste manual de empaque solo baja; la
-- existencia de empaque nunca es negativa; un empaque nuevo nace en 0 y entra
-- por compra; un empaque con existencia, uso o historia no se borra por API.
-- La misma suite corre tras 107 (sin contención) y tras 108.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION t107_limpiar() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM costos_empaque_historial WHERE sku LIKE 'P107-%';
  DELETE FROM costos_historial WHERE concepto LIKE '%P107-%';
  DELETE FROM movimientos_contables WHERE concepto LIKE '%P107-%' OR referencia IN (SELECT 'recepcion_compra/' || operacion_id FROM stock_operaciones WHERE operacion_id::text LIKE '10700000-%');
  DELETE FROM cuentas_por_pagar WHERE proveedor = 'Prov 107';
  DELETE FROM inventario_mov WHERE producto LIKE 'P107-%';
  DELETE FROM produccion WHERE sku LIKE 'P107-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '10700000-%' OR clave LIKE '%P107-%';
  DELETE FROM auditoria WHERE usuario LIKE '% 107';
  DELETE FROM cuartos_frios WHERE id = 'CF-107';
  DELETE FROM productos WHERE sku LIKE 'P107-%';
  DELETE FROM usuarios WHERE id BETWEEN 10701 AND 10709;
  DELETE FROM auth.users WHERE id::text LIKE '10700000-%';
END $$;

BEGIN; SELECT t107_limpiar(); COMMIT;
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT ('10700000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'u' || k || '@t107' FROM generate_series(1, 3) k;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (10701, 'Admin 107',  'u1@t107', 'Admin',          'Activo', '10700000-0000-0000-0000-000000000001'),
  (10702, 'Bolsas 107', 'u2@t107', 'Almacén Bolsas', 'Activo', '10700000-0000-0000-0000-000000000002'),
  (10703, 'Prod 107',   'u3@t107', 'Producción',     'Activo', '10700000-0000-0000-0000-000000000003');
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-107', 'Cuarto 107', '{}');
COMMIT;
-- Altas por SQL de confianza (con triggers): cada empaque deja su apertura.
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P107-EMP',  'Bolsa 107',            'Empaque', 0, 50, 4, NULL),
  ('P107-EMPZ', 'Bolsa Z 107',          'Empaque', 0, 10, 5, NULL),
  ('P107-D1',   'Bolsa en uso 107',     'Empaque', 0, 0,  0, NULL),
  ('P107-D2',   'Bolsa con stock 107',  'Empaque', 0, 5,  2, NULL),
  ('P107-D3',   'Bolsa declarada 107',  'Empaque', 0, 0,  3, NULL);
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
  ('P107-HIELO', 'Hielo 107',    'Producto Terminado', 30, 0, 0, 'P107-EMP'),
  ('P107-HZ',    'Hielo Z 107',  'Producto Terminado', 30, 0, 0, 'P107-EMPZ'),
  ('P107-HV',    'Hielo V 107',  'Producto Terminado', 30, 0, 0, NULL),
  ('P107-D1H',   'Hielo D1 107', 'Producto Terminado', 30, 0, 0, 'P107-D1');

CREATE OR REPLACE FUNCTION t107_actor(p_k INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '10700000-0000-0000-0000-0000000000' || lpad(p_k::text, 2, '0'))::text, true);
END $$;
CREATE OR REPLACE FUNCTION t107_assert(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; RAISE NOTICE 'OK: %', p_msg; END $$;
CREATE OR REPLACE FUNCTION t107_err(p_sql TEXT, p_msg TEXT, p_state TEXT, p_like TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_err TEXT;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_err := SQLERRM; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'FAIL: % (sin error)', p_msg; END IF;
  IF v_state !~ ('^(' || p_state || ')$') OR (p_like IS NOT NULL AND v_err NOT ILIKE p_like) THEN RAISE EXCEPTION 'FAIL: % (error inesperado % %)', p_msg, v_state, v_err; END IF;
  RAISE NOTICE 'OK: % [% %]', p_msg, v_state, left(v_err, 90);
END $$;
CREATE OR REPLACE FUNCTION t107_st(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT stock FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t107_avg(p_sku TEXT) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER AS $$ SELECT costo_unitario FROM productos WHERE sku = p_sku $$;
CREATE OR REPLACE FUNCTION t107_cf(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT COALESCE((stock ->> p_sku)::int, 0) FROM cuartos_frios WHERE id = 'CF-107' $$;
CREATE OR REPLACE FUNCTION t107_hist(p_sku TEXT) RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM costos_empaque_historial WHERE sku = p_sku $$;
-- ¿Ya está la contención (108)?
CREATE OR REPLACE FUNCTION t107_c108() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.productos'::regclass AND conname = 'productos_empaque_stock_no_negativo') $$;
GRANT EXECUTE ON FUNCTION t107_actor(INTEGER), t107_assert(BOOLEAN, TEXT), t107_err(TEXT, TEXT, TEXT, TEXT), t107_st(TEXT), t107_avg(TEXT), t107_cf(TEXT), t107_hist(TEXT), t107_c108() TO PUBLIC;
DROP TABLE IF EXISTS t107_ids;
CREATE TEMP TABLE t107_ids (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t107_ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t107_j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v::jsonb FROM t107_ids WHERE k = p_k $$;
GRANT EXECUTE ON FUNCTION t107_j(TEXT) TO PUBLIC;

\echo '── 107: historial (evento de reverso)'
SELECT t107_assert(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.costos_empaque_historial'::regclass AND conname = 'costos_empaque_historial_evento_check')) ~ 'Reverso producción'
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'costos_empaque_historial' AND column_name = 'costo_unitario_reingreso' AND numeric_scale = 6)
  AND has_table_privilege('authenticated', 'public.costos_empaque_historial', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.costos_empaque_historial', 'DELETE') AND NOT has_table_privilege('anon', 'public.costos_empaque_historial', 'SELECT'),
  '107-01 historial: admite Reverso producción con costo unitario de 6 decimales; sigue de solo lectura para la API');
SELECT t107_err($q$INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida, cantidad_nueva, costo_nuevo, actor)
                   VALUES (1, 'P107-X', 'Reverso producción', gen_random_uuid(), 10, 1, 5, 15, 1, 't107')$q$, '107-02 un reverso sin costo unitario histórico no es un evento válido', '23514');
SELECT t107_err($q$INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida, costo_unitario_reingreso, cantidad_nueva, costo_nuevo, actor)
                   VALUES (1, 'P107-X', 'Reverso producción', gen_random_uuid(), 10, 1, 5, 2, 16, 1, 't107')$q$, '107-03 un reverso cuya existencia nueva no cuadra con anterior + devuelto no es válido', '23514');
SELECT t107_err($q$INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida, total_factura, costo_unitario_reingreso, cantidad_nueva, costo_nuevo, actor)
                   VALUES (1, 'P107-X', 'Compra', gen_random_uuid(), 10, 1, 5, 20, 2, 15, 1, 't107')$q$, '107-04 una compra no lleva costo unitario de reingreso', '23514');
SELECT t107_assert((SELECT count(*) = 5 AND bool_and(evento = 'Apertura' AND operacion_id IS NULL AND costo_unitario_reingreso IS NULL) FROM costos_empaque_historial WHERE sku LIKE 'P107-%')
  AND (SELECT cantidad_nueva = 50 AND costo_nuevo = 4 FROM costos_empaque_historial WHERE sku = 'P107-EMP'),
  '107-05 fixtures: cada empaque con su apertura declarada (P107-EMP 50 @ 4)');

\echo '── 107: producción (consume cantidad, conserva el promedio, snapshot)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
INSERT INTO t107_ids VALUES ('p1', registrar_produccion('10700000-0000-0000-0000-00000000a001', 'Turno 1', 'Máquina 107', 'P107-HIELO', 10, 'CF-107')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 40 AND t107_avg('P107-EMP') = 4 AND t107_cf('P107-HIELO') = 10
  AND (SELECT costo_empaque = 4 AND costo_total = 40 AND empaque_cantidad = 10 FROM produccion WHERE id = (t107_j('p1') ->> 'id')::bigint)
  AND (SELECT count(*) = 1 AND bool_and(monto = 40 AND tipo = 'Producción') FROM costos_historial WHERE referencia = 'PROD-' || (t107_j('p1') ->> 'id'))
  AND t107_hist('P107-EMP') = 1 AND t107_avg('P107-HIELO') = 0,
  '107-10 producción de 10: empaque 50 → 40, promedio sigue en 4, snapshot 4 / 40, sin evento de costo; el producto terminado no adquiere costo');

\echo '── 107: compra (promedio ponderado sin cambio: 40 @ 4 + 50 por 380 → 90 @ 6)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(2);
INSERT INTO t107_ids VALUES ('c1', registrar_recepcion_compra('10700000-0000-0000-0000-00000000c001', 'P107-EMP', 50, 380, 'Prov 107', false)::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 90 AND t107_avg('P107-EMP') = 6 AND (t107_j('c1') ->> 'costo_promedio_anterior')::numeric = 4 AND (t107_j('c1') ->> 'costo_promedio')::numeric = 6
  AND (SELECT costo_empaque = 4 AND costo_total = 40 FROM produccion WHERE id = (t107_j('p1') ->> 'id')::bigint),
  '107-11 compra: (40×4 + 380) ÷ 90 = 6; la producción anterior conserva 4 / 40');

\echo '── 107: reverso al costo histórico (90 @ 6 + 10 @ 4 → 100 @ 5.8)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
SELECT t107_err(format($q$SELECT revertir_produccion('10700000-0000-0000-0000-00000000b009', %s, 'no soy admin')$q$, (t107_j('p1') ->> 'id')), '107-19 Producción: revertir denegado', '42501');
ROLLBACK;
INSERT INTO t107_ids VALUES ('ch0', (SELECT count(*) FROM costos_historial)::text), ('km0', (SELECT count(*) FROM inventario_mov WHERE producto = 'P107-EMP')::text);
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('rv', revertir_produccion('10700000-0000-0000-0000-00000000b001', (t107_j('p1') ->> 'id')::bigint, 'prueba de reverso 107')::text);
INSERT INTO t107_ids VALUES ('rvr', revertir_produccion('10700000-0000-0000-0000-00000000b001', (t107_j('p1') ->> 'id')::bigint, 'prueba de reverso 107')::text);
SELECT t107_err(format($q$SELECT revertir_produccion('10700000-0000-0000-0000-00000000b001', %s, 'otro motivo')$q$, (t107_j('p1') ->> 'id')), '107-24 misma operación con otro motivo: rechazada', '23505');
SELECT t107_err(format($q$SELECT revertir_produccion('10700000-0000-0000-0000-00000000b00a', %s, 'segunda vez')$q$, (t107_j('p1') ->> 'id')), '107-25 otra operación sobre la misma producción: ya fue revertida', '22023', '%ya fue revertida%');
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 100 AND t107_avg('P107-EMP') = 5.8
  AND (t107_j('rv') ->> 'empaque_devuelto')::int = 10 AND (t107_j('rv') ->> 'costo_empaque_historico')::numeric = 4
  AND (t107_j('rv') ->> 'costo_promedio_anterior')::numeric = 6 AND (t107_j('rv') ->> 'costo_promedio')::numeric = 5.8 AND (t107_j('rv') ->> 'replay') = 'false',
  '107-20 reverso: (90×6 + 10×4) ÷ 100 = 5.8; el empaque reingresa al costo histórico (4), no al promedio vigente (6)');
SELECT t107_assert((SELECT count(*) = 1 AND bool_and(cantidad_anterior = 90 AND costo_anterior = 6 AND cantidad_recibida = 10 AND costo_unitario_reingreso = 4 AND total_factura IS NULL
                      AND cantidad_nueva = 100 AND costo_nuevo = 5.8 AND actor = 'Admin 107' AND actor_id = 10701 AND sku = 'P107-EMP')
                    FROM costos_empaque_historial WHERE evento = 'Reverso producción' AND operacion_id = '10700000-0000-0000-0000-00000000b001'),
  '107-21 historial: una transición 6 → 5.8 con existencia anterior, devuelto, costo histórico, existencia nueva, operación y actor');
SELECT t107_assert((SELECT count(*) = 1 AND bool_and(monto = 40) FROM costos_historial WHERE tipo = 'Reverso producción' AND referencia = 'PROD-' || (t107_j('p1') ->> 'id') || '/reverso')
  AND (SELECT count(*) FROM costos_historial)::text = (SELECT (v::int + 1)::text FROM t107_ids WHERE k = 'ch0')
  AND (t107_j('rv') ->> 'costo_revertido')::numeric = 40
  AND (SELECT estatus = 'Revertida' AND reverso_operacion_id = '10700000-0000-0000-0000-00000000b001' AND costo_empaque = 4 AND costo_total = 40 FROM produccion WHERE id = (t107_j('p1') ->> 'id')::bigint)
  AND t107_cf('P107-HIELO') = 0
  AND (SELECT count(*) = 1 AND bool_and(tipo = 'Entrada' AND cantidad = 10) FROM inventario_mov WHERE producto = 'P107-EMP' AND operacion_id = '10700000-0000-0000-0000-00000000b001'),
  '107-22 resultados sin cambio (093/094): un costo compensatorio de 40 (el guardado); producción Revertida con su snapshot; cuarto −10; un kardex de entrada');
SELECT t107_assert((t107_j('rvr') ->> 'replay') = 'true' AND (t107_j('rvr') ->> 'costo_promedio')::numeric = 5.8 AND t107_st('P107-EMP') = 100 AND t107_avg('P107-EMP') = 5.8
  AND (SELECT count(*) = 1 FROM costos_empaque_historial WHERE operacion_id = '10700000-0000-0000-0000-00000000b001')
  AND (SELECT count(*) FROM inventario_mov WHERE producto = 'P107-EMP')::text = (SELECT (v::int + 1)::text FROM t107_ids WHERE k = 'km0')
  AND (SELECT count(*) = 1 FROM costos_historial WHERE referencia = 'PROD-' || (t107_j('p1') ->> 'id') || '/reverso'),
  '107-23 reintento: replay; sin segunda entrada, sin segundo evento de costo, sin segundo costo compensatorio');

\echo '── 107: existencia 0 (promedio de referencia; compra y reverso fijan el promedio nuevo)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
INSERT INTO t107_ids VALUES ('p2', registrar_produccion('10700000-0000-0000-0000-00000000a002', 'Turno 1', 'Máquina 107', 'P107-HZ', 10, 'CF-107')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMPZ') = 0 AND t107_avg('P107-EMPZ') = 5, '107-30 al llegar a 0 el último promedio (5) queda como referencia');
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(2);
INSERT INTO t107_ids VALUES ('c2', registrar_recepcion_compra('10700000-0000-0000-0000-00000000c002', 'P107-EMPZ', 10, 90, 'Prov 107', false)::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMPZ') = 10 AND t107_avg('P107-EMPZ') = 9 AND (t107_j('c2') ->> 'costo_promedio_anterior')::numeric = 5,
  '107-31 compra con existencia 0: promedio nuevo = factura ÷ recibido (90 ÷ 10 = 9), sin arrastrar el 5');
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
INSERT INTO t107_ids VALUES ('p3', registrar_produccion('10700000-0000-0000-0000-00000000a003', 'Turno 1', 'Máquina 107', 'P107-HZ', 10, 'CF-107')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('rv2', revertir_produccion('10700000-0000-0000-0000-00000000b002', (t107_j('p2') ->> 'id')::bigint, 'reverso con existencia 0')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMPZ') = 10 AND t107_avg('P107-EMPZ') = 5
  AND (SELECT cantidad_anterior = 0 AND costo_anterior = 9 AND cantidad_recibida = 10 AND costo_unitario_reingreso = 5 AND cantidad_nueva = 10 AND costo_nuevo = 5
       FROM costos_empaque_historial WHERE operacion_id = '10700000-0000-0000-0000-00000000b002'),
  '107-32 reverso con existencia 0: el promedio es el costo histórico (5), no la referencia vigente (9)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('rv3', revertir_produccion('10700000-0000-0000-0000-00000000b003', (t107_j('p3') ->> 'id')::bigint, 'segundo reverso')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMPZ') = 20 AND t107_avg('P107-EMPZ') = 7 AND t107_cf('P107-HZ') = 0, '107-33 segundo reverso: (10×5 + 10×9) ÷ 20 = 7');

\echo '── 107: el historial explica cada cambio del promedio; orden de bloqueo'
SELECT t107_assert((SELECT bool_and(costo_nuevo = round((cantidad_anterior * costo_anterior + COALESCE(total_factura, cantidad_recibida * costo_unitario_reingreso)) / (cantidad_anterior + cantidad_recibida), 6)
                                    AND cantidad_nueva = cantidad_anterior + cantidad_recibida)
                    FROM costos_empaque_historial WHERE sku LIKE 'P107-%' AND evento IN ('Compra', 'Reverso producción'))
  AND (SELECT bool_and(costo_anterior IS NOT DISTINCT FROM previo)
       FROM (SELECT evento, costo_anterior, lag(costo_nuevo) OVER (PARTITION BY producto_id ORDER BY id) AS previo FROM costos_empaque_historial WHERE sku LIKE 'P107-%') x WHERE evento <> 'Apertura')
  AND (SELECT bool_and(p.costo_unitario = h.costo_nuevo) FROM productos p
        JOIN LATERAL (SELECT costo_nuevo FROM costos_empaque_historial WHERE producto_id = p.id ORDER BY id DESC LIMIT 1) h ON true WHERE p.sku IN ('P107-EMP', 'P107-EMPZ')),
  '107-40 compras y reversos: cada promedio nuevo se recalcula desde su fila; cada fila parte del promedio anterior; el promedio vigente es el de la última fila');
SELECT t107_assert(position('FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE' IN d) > 0 AND position('PERFORM stock_mov_cuarto' IN d) > position('FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE' IN d)
                   AND position('FROM produccion WHERE id = p_produccion_id FOR UPDATE' IN d) < position('FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE' IN d),
  '107-41 orden de bloqueo del reverso: producción → empaque → cuarto (el mismo empaque → cuarto de registrar_produccion)')
  FROM (SELECT pg_get_functiondef('public.revertir_produccion(uuid,bigint,text)'::regprocedure) AS d) f;

\echo '── 107/108: ajuste manual de empaque (solo a la baja; el promedio no cambia)'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('aj1', ajustar_existencia('10700000-0000-0000-0000-00000000d001', 'P107-EMP', 80, 'conteo físico 107')::text);
SELECT t107_err($q$SELECT ajustar_existencia('10700000-0000-0000-0000-00000000d009', 'P107-EMP', -1, 'conteo')$q$, '107-51 ajuste por debajo de cero rechazado', '22023');
INSERT INTO t107_ids VALUES ('aj2', ajustar_existencia('10700000-0000-0000-0000-00000000d002', 'P107-EMP', 80, 'conteo sin diferencia 107')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 80 AND t107_avg('P107-EMP') = 5.8 AND (t107_j('aj1') ->> 'delta')::int = -20 AND (t107_j('aj2') ->> 'delta')::int = 0
  AND (SELECT count(*) = 1 AND bool_and(tipo = 'Salida' AND cantidad = 20 AND usuario = 'Admin 107' AND referencia = 'ajuste_existencia/P107-EMP') FROM inventario_mov WHERE operacion_id = '10700000-0000-0000-0000-00000000d001')
  AND (SELECT count(*) >= 1 FROM auditoria WHERE modulo = 'Inventario' AND detalle LIKE 'P107-EMP: 100 → 80%')
  AND t107_hist('P107-EMP') = 3,
  '107-50 baja manual 100 → 80: promedio sigue en 5.8; un kardex de salida y auditoría; sin evento de costo');
DO $do$
BEGIN
  IF NOT t107_c108() THEN
    RAISE NOTICE 'OK: 107-52 (108 aún no aplicada: el alza manual de empaque sigue como en 093)';
    RETURN;
  END IF;
  PERFORM t107_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t107_err($q$SELECT ajustar_existencia('10700000-0000-0000-0000-00000000d00a', 'P107-EMP', 81, 'encontré una caja')$q$, '107-52 alza manual de empaque rechazada (entra por recepción de compra)', '22023', '%recepción de compra%');
  PERFORM t107_err($q$SELECT ajustar_existencia('10700000-0000-0000-0000-00000000d00b', 'P107-D1', 1, 'empaque en cero')$q$, '107-53 alza manual desde existencia 0 rechazada', '22023', '%no se aumenta%');
  RESET ROLE;
  PERFORM t107_assert(t107_st('P107-EMP') = 80 AND t107_avg('P107-EMP') = 5.8 AND t107_st('P107-D1') = 0
    AND NOT EXISTS (SELECT 1 FROM stock_operaciones WHERE operacion_id IN ('10700000-0000-0000-0000-00000000d00a', '10700000-0000-0000-0000-00000000d00b')),
    '107-54 tras el rechazo: existencia y promedio intactos, sin operación registrada');
END $do$;
-- Producto terminado: el ajuste por cuartos no cambia (sube y baja).
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
INSERT INTO t107_ids VALUES ('p4', registrar_produccion('10700000-0000-0000-0000-00000000a004', 'Turno 1', 'Máquina 107', 'P107-HV', 6, 'CF-107')::text);
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('aj3', ajustar_existencia('10700000-0000-0000-0000-00000000d003', 'P107-HV', 9, 'conteo cuartos 107')::text);
COMMIT;
SELECT t107_assert(t107_cf('P107-HV') = 9 AND (t107_j('aj3') ->> 'delta')::int = 3
  AND (SELECT count(*) = 1 AND bool_and(tipo = 'Entrada' AND cantidad = 3 AND cuarto_id = 'CF-107') FROM inventario_mov WHERE operacion_id = '10700000-0000-0000-0000-00000000d003'),
  '107-55 producto terminado: el ajuste al alza sigue permitido (cuarto 6 → 9 con kardex por cuarto)');
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('aj4', ajustar_existencia('10700000-0000-0000-0000-00000000d004', 'P107-HV', 4, 'conteo cuartos 107 b')::text);
COMMIT;
SELECT t107_assert(t107_cf('P107-HV') = 4 AND t107_st('P107-HV') = 4 AND t107_avg('P107-HV') = 0, '107-56 producto terminado: ajuste a la baja (9 → 4), espejo en productos, sin costo');
-- A cero y compra nueva.
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(1);
INSERT INTO t107_ids VALUES ('aj5', ajustar_existencia('10700000-0000-0000-0000-00000000d005', 'P107-EMP', 0, 'baja total 107')::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 0 AND t107_avg('P107-EMP') = 5.8, '107-57 ajuste a 0: el promedio (5.8) queda como referencia');
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(2);
INSERT INTO t107_ids VALUES ('c3', registrar_recepcion_compra('10700000-0000-0000-0000-00000000c003', 'P107-EMP', 10, 30, 'Prov 107', false)::text);
COMMIT;
SELECT t107_assert(t107_st('P107-EMP') = 10 AND t107_avg('P107-EMP') = 3 AND (t107_j('c3') ->> 'costo_promedio_anterior')::numeric = 5.8,
  '107-58 la siguiente compra fija el promedio nuevo: 30 ÷ 10 = 3');

\echo '── 107/108: existencia negativa de empaque'
BEGIN; SET LOCAL ROLE authenticated; SELECT t107_actor(3);
SELECT t107_err($q$SELECT registrar_produccion('10700000-0000-0000-0000-00000000a009', 'Turno 1', 'Máquina 107', 'P107-HIELO', 11, 'CF-107')$q$, '107-60 producir más que el empaque disponible (11 > 10): rechazado, sin negativos', 'P0001|22023', '%insuficiente%');
ROLLBACK;
DO $do$
BEGIN
  IF NOT t107_c108() THEN
    RAISE NOTICE 'OK: 107-61 (108 aún no aplicada: sin restricción de existencia no negativa)';
    RETURN;
  END IF;
  -- También para SQL de confianza: es integridad del dato, no un permiso.
  PERFORM t107_err($q$UPDATE productos SET stock = -1 WHERE sku = 'P107-EMP'$q$, '107-61 existencia negativa de empaque: imposible también por SQL de confianza', '23514');
  PERFORM t107_err($q$INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P107-NEG', 'Bolsa negativa', 'Empaque', 0, -5, 1)$q$, '107-62 alta de empaque con existencia negativa: imposible', '23514');
  PERFORM t107_assert(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.productos'::regclass AND conname = 'productos_empaque_stock_no_negativo')) ~ 'Empaque' AND t107_st('P107-EMP') = 10,
    '107-63 la restricción solo aplica al Empaque; existencia intacta');
END $do$;

\echo '── 108: empaque nuevo (nace en 0; entra por compra)'
DO $do$
BEGIN
  IF NOT t107_c108() THEN
    RAISE NOTICE 'OK: 107-70 (108 aún no aplicada: el alta de empaque sigue como en 106)';
    RETURN;
  END IF;
  PERFORM t107_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t107_err($q$INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P107-NEW', 'Bolsa nueva 107', 'Empaque', 0, 40, 1)$q$, '107-70 alta de empaque con existencia inicial: rechazada', '42501', '%nace sin existencia%');
  PERFORM t107_err($q$INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P107-NEW', 'Bolsa nueva 107', 'Empaque', 0, -3, 0)$q$, '107-71 alta de empaque con existencia negativa: rechazada', '42501|23514');
  PERFORM t107_err($q$INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P107-NEW', 'Bolsa nueva 107', 'Empaque', 0, 0, 3)$q$, '107-72 alta de empaque con costo declarado: rechazada (sin existencia no tiene uso)', '42501', '%nace sin costo%');
  INSERT INTO productos (sku, nombre, tipo, precio) VALUES ('P107-NEW', 'Bolsa nueva 107', 'Empaque', 0);
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P107-PTN', 'Hielo nuevo 107', 'Producto Terminado', 10, 0, 55);
  RESET ROLE;
  PERFORM t107_assert(t107_st('P107-NEW') = 0 AND t107_avg('P107-NEW') = 0 AND (SELECT ultimo_costo_fecha IS NULL FROM productos WHERE sku = 'P107-NEW')
    AND (SELECT count(*) = 1 AND bool_and(evento = 'Apertura' AND cantidad_nueva = 0 AND costo_nuevo = 0) FROM costos_empaque_historial WHERE sku = 'P107-NEW')
    AND NOT EXISTS (SELECT 1 FROM inventario_mov WHERE producto = 'P107-NEW') AND t107_avg('P107-PTN') = 0,
    '107-73 el empaque nace 0 @ 0 (apertura en ceros, sin kardex); el producto terminado sigue naciendo sin costo');
  PERFORM t107_actor(2); SET LOCAL ROLE authenticated;
  PERFORM registrar_recepcion_compra('10700000-0000-0000-0000-00000000c004', 'P107-NEW', 20, 50, 'Prov 107', false);
  RESET ROLE;
  PERFORM t107_assert(t107_st('P107-NEW') = 20 AND t107_avg('P107-NEW') = 2.5
    AND (SELECT cantidad_anterior = 0 AND costo_anterior = 0 AND cantidad_recibida = 20 AND total_factura = 50 AND costo_nuevo = 2.5 FROM costos_empaque_historial WHERE operacion_id = '10700000-0000-0000-0000-00000000c004'),
    '107-74 la primera compra fija existencia y promedio (50 ÷ 20 = 2.5)');
END $do$;

\echo '── 108: borrado de empaque (no se borra y recrea para reiniciar la base)'
DO $do$
BEGIN
  IF NOT t107_c108() THEN
    RAISE NOTICE 'OK: 107-80 (108 aún no aplicada: el borrado de productos sigue como antes)';
    RETURN;
  END IF;
  PERFORM t107_actor(1); SET LOCAL ROLE authenticated;
  PERFORM t107_err($q$DELETE FROM productos WHERE sku = 'P107-EMP'$q$, '107-80 empaque con existencia, uso e historia: no se elimina', '42501', '%tiene existencia%');
  PERFORM t107_err($q$DELETE FROM productos WHERE sku = 'P107-D2'$q$, '107-81 empaque con existencia: no se elimina', '42501', '%tiene existencia%');
  PERFORM t107_err($q$DELETE FROM productos WHERE sku = 'P107-D1'$q$, '107-82 empaque en 0 usado por un producto: no se elimina', '42501', '%en uso o tiene historia%');
  PERFORM t107_err($q$DELETE FROM productos WHERE sku = 'P107-D3'$q$, '107-83 empaque en 0 con apertura declarada (106): no se elimina', '42501', '%en uso o tiene historia%');
  -- Con compras: ni dejándolo en 0 se puede eliminar.
  PERFORM ajustar_existencia('10700000-0000-0000-0000-00000000d006', 'P107-NEW', 0, 'vaciar para eliminar 107');
  PERFORM t107_err($q$DELETE FROM productos WHERE sku = 'P107-NEW'$q$, '107-84 empaque en 0 con compras: no se elimina', '42501', '%en uso o tiene historia%');
  PERFORM t107_err($q$DELETE FROM productos WHERE sku LIKE 'P107-%' AND tipo = 'Empaque'$q$, '107-85 borrado en bloque de empaques: rechazado', '42501');
  -- Sí se elimina: un empaque recién creado, sin uso ni movimientos, y un producto terminado.
  INSERT INTO productos (sku, nombre, tipo, precio) VALUES ('P107-D4', 'Bolsa capturada por error 107', 'Empaque', 0);
  DELETE FROM productos WHERE sku = 'P107-D4';
  DELETE FROM productos WHERE sku = 'P107-PTN';
  RESET ROLE;
  PERFORM t107_assert((SELECT count(*) = 6 FROM productos WHERE sku IN ('P107-EMP', 'P107-EMPZ', 'P107-D1', 'P107-D2', 'P107-D3', 'P107-NEW'))
    AND NOT EXISTS (SELECT 1 FROM productos WHERE sku IN ('P107-D4', 'P107-PTN'))
    AND t107_st('P107-EMP') = 10 AND t107_avg('P107-EMP') = 3 AND t107_avg('P107-NEW') = 2.5,
    '107-86 los empaques protegidos siguen con su existencia y promedio; un empaque sin uso y un producto terminado sí se eliminan');
  PERFORM t107_assert(NOT has_function_privilege('anon', 'public.empaque_tiene_dependencias(bigint,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.productos_guard_borrado()', 'EXECUTE')
    AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.empaque_tiene_dependencias(bigint,text)'::regprocedure)
    AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.productos_guard_borrado()'::regprocedure),
    '107-87 guarda de borrado: invocador; la consulta de dependencias no es accesible para anon');
END $do$;

\echo '── 107/108: la historia no se reescribe'
SELECT t107_assert((SELECT count(*) = 1 AND bool_and(cantidad_nueva = 50 AND costo_nuevo = 4 AND operacion_id IS NULL AND actor IS NOT NULL) FROM costos_empaque_historial WHERE sku = 'P107-EMP' AND evento = 'Apertura')
  AND (SELECT count(*) = 1 AND bool_and(cantidad_nueva = 10 AND costo_nuevo = 5) FROM costos_empaque_historial WHERE sku = 'P107-EMPZ' AND evento = 'Apertura')
  AND (SELECT count(*) = 2 FROM produccion WHERE sku = 'P107-HZ' AND estatus = 'Revertida' AND costo_empaque IN (5, 9)),
  '107-90 aperturas declaradas intactas (50 @ 4 y 10 @ 5); las producciones revertidas conservan su snapshot');

BEGIN; SELECT t107_limpiar(); COMMIT;
\echo '── 107: TODAS LAS PRUEBAS OK'
