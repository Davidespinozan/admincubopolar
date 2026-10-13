-- 149_reportes_establecimientos_test.sql — Tiendas propias, E8: reportes por establecimiento y
-- consolidados (ventas, cajas, inventario, abastecimiento). Operación real con los contratos de
-- 144–148 dentro de la transacción (tienda de fábrica, tienda remota y venta central) y después
-- los reportes. La base local puede traer datos de otras pruebas: lo central se mide por
-- DIFERENCIA contra una foto inicial. Todo se deshace con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t149.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
CREATE TEMP TABLE t149 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t149 TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t149 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.n(p_k TEXT, p_campo TEXT DEFAULT NULL) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT CASE WHEN p_campo IS NULL THEN (v #>> '{}')::bigint ELSE (v ->> p_campo)::bigint END FROM t149 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14900000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t149' FROM generate_series(1, 8) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
  (14901, 'Admin T149',          'u1@t149', 'Admin',      'Activo', '14900000-0000-0000-0000-000000000001'),
  (14902, 'Ventas central T149', 'u2@t149', 'Ventas',     'Activo', '14900000-0000-0000-0000-000000000002'),
  (14903, 'Produccion T149',     'u3@t149', 'Producción', 'Activo', '14900000-0000-0000-0000-000000000003'),
  (14904, 'Chofer T149',         'u4@t149', 'Chofer',     'Activo', '14900000-0000-0000-0000-000000000004'),
  (14905, 'Empleado T149',       'u5@t149', 'Empleado',   'Activo', '14900000-0000-0000-0000-000000000005'),
  (14906, 'Cajera fabrica T149', 'u6@t149', 'Ventas',     'Activo', '14900000-0000-0000-0000-000000000006'),
  (14907, 'Cajero remota T149',  'u7@t149', 'Ventas',     'Activo', '14900000-0000-0000-0000-000000000007'),
  (14908, 'Facturacion T149',    'u8@t149', 'Facturación','Activo', '14900000-0000-0000-0000-000000000008');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P149-A', 'Hielo A149', 'Producto Terminado', 30, 0, 0), ('P149-B', 'Hielo B149', 'Producto Terminado', 90, 0, 0);
INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-149-C1', 'Cuarto CEDIS 149', '{"P149-A": 100, "P149-B": 50}');
INSERT INTO clientes (id, nombre, rfc, regimen, uso_cfdi, cp, correo, direccion, saldo, credito_autorizado, limite_credito, estatus) VALUES
  (14901, 'Cliente Secreto 149', 'SEC010203AB1', '601', 'G03', '34000', 'secreto@t149', 'Calle reservada 149', 0, false, 0, 'Activo');
INSERT INTO sucursales (id, cliente_id, nombre, es_principal, estatus) VALUES (1490101, 14901, 'Principal', true, 'Activa');
SET LOCAL session_replication_role = origin;
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 149 (dueño, SQL)';

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
CREATE OR REPLACE FUNCTION pg_temp.como(p_n INTEGER) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', '', true), set_config('app.traspaso_ctx', '', true),
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"14900000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14900000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.q(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
-- Fila de un establecimiento en un reporte con `por_establecimiento`.
CREATE OR REPLACE FUNCTION pg_temp.fila(p_rep JSONB, p_est BIGINT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT x.value FROM jsonb_array_elements(p_rep -> 'por_establecimiento') x WHERE (x.value ->> 'id')::bigint = p_est $$;
-- ventas|unidades|bruto|devoluciones|neto|cobrado de un objeto (o la diferencia contra otro).
CREATE OR REPLACE FUNCTION pg_temp.cifras(p_a JSONB, p_b JSONB DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('|', (p_a ->> 'ventas')::numeric - COALESCE((p_b ->> 'ventas')::numeric, 0), (p_a ->> 'unidades')::numeric - COALESCE((p_b ->> 'unidades')::numeric, 0),
                   ((p_a ->> 'bruto')::numeric - COALESCE((p_b ->> 'bruto')::numeric, 0))::numeric(12,2), ((p_a ->> 'devoluciones')::numeric - COALESCE((p_b ->> 'devoluciones')::numeric, 0))::numeric(12,2),
                   ((p_a ->> 'neto')::numeric - COALESCE((p_b ->> 'neto')::numeric, 0))::numeric(12,2), ((p_a ->> 'cobrado')::numeric - COALESCE((p_b ->> 'cobrado')::numeric, 0))::numeric(12,2)) $$;
-- Huella de lo que un reporte NO debe cambiar (nada).
CREATE OR REPLACE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT concat_ws('|', (SELECT count(*) FROM public.ordenes), (SELECT count(*) FROM public.pagos), (SELECT count(*) FROM public.inventario_mov), (SELECT count(*) FROM public.movimientos_contables),
                   (SELECT count(*) FROM public.mermas), (SELECT count(*) FROM public.auditoria), (SELECT count(*) FROM public.traspaso_eventos), (SELECT count(*) FROM public.stock_operaciones),
                   (SELECT md5(string_agg(id || stock::text, ',' ORDER BY id)) FROM public.cuartos_frios)) $$;
SELECT set_config('t149.hoy', fin_hoy()::text, true);
CREATE OR REPLACE FUNCTION pg_temp.hoy() RETURNS DATE LANGUAGE sql AS $$ SELECT current_setting('t149.hoy')::date $$;

\echo '── 149: catálogo'
SELECT pg_temp.ok(current_setting('t149.apagado_al_inicio')::boolean, '149-01 el interruptor global estaba APAGADO al empezar (149 no lo toca)');
SELECT pg_temp.ok((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.provolatile = 's' AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('reporte_ventas_establecimientos', 'reporte_cajas_tiendas', 'reporte_inventario_establecimientos', 'reporte_abastecimiento_tiendas'))
  AND NOT has_function_privilege('authenticated', 'public.reporte_tiendas_alcance(text,date,date,bigint,boolean)', 'EXECUTE'),
  '149-02 cuatro reportes de SOLO LECTURA (STABLE), SECURITY DEFINER, sin anon; la función de alcance no se expone');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'reporte\_%' ESCAPE '\'
                                AND p.proname IN ('reporte_ventas_establecimientos', 'reporte_cajas_tiendas', 'reporte_inventario_establecimientos', 'reporte_abastecimiento_tiendas', 'reporte_tiendas_alcance')
                                AND pg_get_functiondef(p.oid) ~* '\m(INSERT|UPDATE|DELETE|set_config|nextval)\M'),
  '149-03 ninguno escribe: sin INSERT, UPDATE, DELETE, banderas de sesión ni secuencias');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.reporte_financiero(date,date)'::regprocedure)) = '32f9086041739353be01995ebf8a6776'
  AND md5(pg_get_functiondef('public.turno_caja_totales(bigint)'::regprocedure)) IS NOT NULL
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = 'e1a9770e1bc5cebd7f565c9cfdc2a880'
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tienda_read') = 7,
  '149-04 [11] el reporte financiero central (reporte_financiero) y los demás contratos históricos conservan su huella; sin policies nuevas');

\echo '── 149: operación del día (contratos reales)'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t149 VALUES ('hoy', to_jsonb(pg_temp.hoy()));
INSERT INTO t149 VALUES ('v0', reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy())), ('i0', reporte_inventario_establecimientos()),
                        ('a0', reporte_abastecimiento_tiendas(pg_temp.hoy(), pg_temp.hoy())), ('c0', reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy()));
INSERT INTO t149 VALUES ('tf', guardar_establecimiento(NULL, 'TF149', 'Tienda de fábrica 149')), ('tr', guardar_establecimiento(NULL, 'TR149', 'Tienda remota 149', 'tienda'));
SELECT asignar_cuarto_tienda(pg_temp.n('tf', 'id'), 'CF-149-TF', 'Congelador fábrica 149'), asignar_cuarto_tienda(pg_temp.n('tr', 'id'), 'CF-149-TR', 'Congelador remota 149');
INSERT INTO t149 VALUES ('kf', agregar_caja_tienda(pg_temp.n('tf', 'id'), 'Caja F')), ('kr', agregar_caja_tienda(pg_temp.n('tr', 'id'), 'Caja R'));
SELECT asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14906, true, false), asignar_usuario_tienda(pg_temp.n('tf', 'id'), 14903, false, true), asignar_usuario_tienda(pg_temp.n('tr', 'id'), 14907, false, false);
SELECT configurar_clientes_tienda(pg_temp.n('tr', 'id'), 'lista', ARRAY[14901]);
SELECT activar_tienda(pg_temp.op(1), pg_temp.n('tf', 'id'), true), activar_tienda(pg_temp.op(2), pg_temp.n('tr', 'id'), true);
-- Abastecimiento: T1 recibido con incidencia (17 buenas, 2 dañadas, 1 faltante de A; 6 de B), T2 queda en tránsito (5), T3 regresa al origen (4).
INSERT INTO t149 VALUES ('t1', crear_traspaso(pg_temp.op(10), 1, pg_temp.n('tr', 'id'), 'CF-149-C1', 'CF-149-TR', '[{"sku": "P149-A", "cantidad": 20}, {"sku": "P149-B", "cantidad": 6}]'::jsonb, 'Luis Pérez'));
INSERT INTO t149 VALUES ('t2', crear_traspaso(pg_temp.op(11), 1, pg_temp.n('tr', 'id'), 'CF-149-C1', 'CF-149-TR', '[{"sku": "P149-A", "cantidad": 5}]'::jsonb, 'Luis Pérez'));
INSERT INTO t149 VALUES ('t3', crear_traspaso(pg_temp.op(12), 1, pg_temp.n('tr', 'id'), 'CF-149-C1', 'CF-149-TR', '[{"sku": "P149-A", "cantidad": 4}]'::jsonb, 'Luis Pérez'));
INSERT INTO t149 VALUES ('t4', crear_traspaso(pg_temp.op(13), 1, pg_temp.n('tr', 'id'), 'CF-149-C1', 'CF-149-TR', '[{"sku": "P149-A", "cantidad": 9}]'::jsonb, 'Luis Pérez'));   -- se queda pendiente: nunca sale
SELECT despachar_traspaso(pg_temp.op(14), pg_temp.n('t1', 'traspaso_id')), despachar_traspaso(pg_temp.op(15), pg_temp.n('t2', 'traspaso_id')), despachar_traspaso(pg_temp.op(16), pg_temp.n('t3', 'traspaso_id'));
SELECT recibir_traspaso(pg_temp.op(17), pg_temp.n('t1', 'traspaso_id'), '[{"sku": "P149-A", "recibida": 17, "danada": 2}, {"sku": "P149-B", "recibida": 6}]'::jsonb, 'Dos bolsas rotas y falta una');
SELECT retornar_traspaso(pg_temp.op(18), pg_temp.n('t3', 'traspaso_id'), '[{"sku": "P149-A", "recibida": 4}]'::jsonb, 'El camión regresó sin entregar');
SELECT pg_temp.como(3);
SELECT traspaso_cuartos(pg_temp.op(19), 'CF-149-C1', 'CF-149-TF', 'P149-A', 10);          -- traspaso DIRECTO de 144 a la tienda de fábrica
-- Ventas de la tienda de fábrica: 2 de su congelador (efectivo, $60) y 3 del CEDIS (tarjeta, $90).
SELECT pg_temp.como(6);
INSERT INTO t149 VALUES ('tuf', abrir_turno_caja(pg_temp.op(20), pg_temp.n('kf', 'id'), 100));
INSERT INTO t149 VALUES ('vf1', vender_en_tienda(pg_temp.op(21), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P149-A", "cantidad": 2, "cuarto_id": "CF-149-TF"}]'::jsonb, 'Efectivo'));
INSERT INTO t149 VALUES ('vf2', vender_en_tienda(pg_temp.op(22), pg_temp.n('tuf', 'turno_id'), '[{"sku": "P149-A", "cantidad": 3, "cuarto_id": "CF-149-C1"}]'::jsonb, 'Tarjeta (terminal)', NULL, 'AUT 1'));
-- Ventas de la tienda remota: 1 B (efectivo, $90) y 2 A al cliente de su lista (transferencia, $60).
SELECT pg_temp.como(7);
INSERT INTO t149 VALUES ('tur', abrir_turno_caja(pg_temp.op(23), pg_temp.n('kr', 'id'), 50));
INSERT INTO t149 VALUES ('vr1', vender_en_tienda(pg_temp.op(24), pg_temp.n('tur', 'turno_id'), '[{"sku": "P149-B", "cantidad": 1}]'::jsonb, 'Efectivo'));
INSERT INTO t149 VALUES ('vr2', vender_en_tienda(pg_temp.op(25), pg_temp.n('tur', 'turno_id'), '[{"sku": "P149-A", "cantidad": 2}]'::jsonb, 'Transferencia SPEI', 14901, 'SPEI 9'));
-- Correcciones: la de fábrica con efectivo YA entregado desde su caja; la de la remota, electrónica y PENDIENTE.
SELECT pg_temp.como(1);
INSERT INTO t149 VALUES ('cf', corregir_venta_tienda(pg_temp.op(26), pg_temp.n('vf1', 'orden_id'), 'El cliente devolvió las dos bolsas', 'Reintegrar', NULL, NULL, 'efectivo_caja', true, pg_temp.n('tuf', 'turno_id')));
INSERT INTO t149 VALUES ('cr', corregir_venta_tienda(pg_temp.op(27), pg_temp.n('vr2', 'orden_id'), 'Transferencia duplicada', 'Reintegrar', NULL, NULL, 'electronico', false));
-- Cierre del turno de fábrica con faltante de 5: esperado 100 + 60 − 60 = 100; contado 95.
SELECT pg_temp.como(6);
INSERT INTO t149 VALUES ('zf', cerrar_turno_caja(pg_temp.op(28), pg_temp.n('tuf', 'turno_id'), 95, 'Faltaron 5 pesos de cambio'));
RESET ROLE;
-- Venta CENTRAL del día (como una entrega de ruta o mostrador central): 10 A, $300 en efectivo. Y un pedido central sin entregar (no cuenta).
SET LOCAL session_replication_role = replica;
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, fecha, delivered_at) VALUES
  (14981, 'OV-14981', 14901, 'Cliente Secreto 149', '10×P149-A', 300, 'Entregada', 'Efectivo', 'Contado', 14902, pg_temp.hoy(), now()),
  (14982, 'OV-14982', 14901, 'Cliente Secreto 149', '33×P149-A', 990, 'Creada',    'Efectivo', 'Contado', 14902, pg_temp.hoy(), NULL);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14981, 'P149-A', 10, 30, 300), (14982, 'P149-A', 33, 30, 990);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (14901, 14981, 300, 'Efectivo', pg_temp.hoy(), 'T149-central', 0, 0);
-- [12] Zona horaria: dos ventas de la tienda remota pegadas a la medianoche DEL NEGOCIO, hace diez días.
INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, fecha, establecimiento_id, delivered_at) VALUES
  (14983, 'OV-14983', 'Público en general', '1×P149-A', 30, 'Entregada', 'Efectivo', 'Contado', 14907, pg_temp.hoy() - 10, pg_temp.n('tr', 'id'), ((pg_temp.hoy() - 10)::timestamp + time '23:59:59') AT TIME ZONE fin_zona_negocio()),
  (14984, 'OV-14984', 'Público en general', '2×P149-A', 60, 'Entregada', 'Efectivo', 'Contado', 14907, pg_temp.hoy() - 9,  pg_temp.n('tr', 'id'), ((pg_temp.hoy() - 9)::timestamp + time '00:00:01') AT TIME ZONE fin_zona_negocio());
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14983, 'P149-A', 1, 30, 30), (14984, 'P149-A', 2, 30, 60);
SET LOCAL session_replication_role = origin;
INSERT INTO t149 VALUES ('h0', to_jsonb(pg_temp.huella()));

\echo '── 149: [1][2] ventas — separación CEDIS / tienda de fábrica / tienda remota y consolidado'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t149 VALUES ('v1', reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy()));
SELECT pg_temp.ok(pg_temp.cifras(pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tf', 'id'))) = '2|5|150.00|60.00|90.00|150.00'
  AND pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tf', 'id')) -> 'cobrado_por_metodo' = '{"Efectivo": 60.00, "Tarjeta (terminal)": 90.00}'::jsonb
  AND pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tf', 'id')) ->> 'tipo' = 'tienda_fabrica',
  '149-10 [1] tienda de fábrica: 2 ventas, 5 unidades, $150 bruto, $60 devueltos, $90 neto; cobrado $60 efectivo y $90 tarjeta (la venta con producto del CEDIS es de la TIENDA)');
SELECT pg_temp.ok(pg_temp.cifras(pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tr', 'id'))) = '2|3|150.00|60.00|90.00|150.00'
  AND pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tr', 'id')) -> 'cobrado_por_metodo' = '{"Efectivo": 90.00, "Transferencia SPEI": 60.00}'::jsonb
  AND pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tr', 'id')) ->> 'tipo' = 'tienda',
  '149-11 [1] tienda remota: 2 ventas, 3 unidades, $150 bruto, $60 devueltos, $90 neto; cobrado $90 efectivo y $60 transferencia');
SELECT pg_temp.ok(pg_temp.cifras(pg_temp.fila(pg_temp.j('v1'), 1), pg_temp.fila(pg_temp.j('v0'), 1)) = '1|10|300.00|0.00|300.00|300.00' AND pg_temp.fila(pg_temp.j('v1'), 1) ->> 'tipo' = 'cedis',
  '149-12 [1] CEDIS (ventas centrales): suma exactamente la venta central entregada (+1 venta, +10 unidades, +$300); el pedido central sin entregar ($990) no cuenta');
SELECT pg_temp.ok((SELECT sum((x.value ->> 'bruto')::numeric) = (pg_temp.j('v1') -> 'consolidado' ->> 'bruto')::numeric
                      AND sum((x.value ->> 'ventas')::numeric) = (pg_temp.j('v1') -> 'consolidado' ->> 'ventas')::numeric
                      AND sum((x.value ->> 'unidades')::numeric) = (pg_temp.j('v1') -> 'consolidado' ->> 'unidades')::numeric
                      AND sum((x.value ->> 'devoluciones')::numeric) = (pg_temp.j('v1') -> 'consolidado' ->> 'devoluciones')::numeric
                      AND sum((x.value ->> 'cobrado')::numeric) = (pg_temp.j('v1') -> 'consolidado' ->> 'cobrado')::numeric
                     FROM jsonb_array_elements(pg_temp.j('v1') -> 'por_establecimiento') x)
  AND pg_temp.cifras(pg_temp.j('v1') -> 'consolidado', pg_temp.j('v0') -> 'consolidado') = '5|18|600.00|120.00|480.00|600.00',
  '149-13 [2] consolidado = suma EXACTA de los establecimientos (+5 ventas, +18 unidades, +$600 bruto, +$120 devoluciones, +$480 neto): sin doble conteo');
SELECT pg_temp.ok((SELECT (sum((r -> 'consolidado' ->> 'bruto')::numeric), sum((r -> 'consolidado' ->> 'ventas')::numeric), sum((r -> 'consolidado' ->> 'cobrado')::numeric))
                          = ((pg_temp.j('v1') -> 'consolidado' ->> 'bruto')::numeric, (pg_temp.j('v1') -> 'consolidado' ->> 'ventas')::numeric, (pg_temp.j('v1') -> 'consolidado' ->> 'cobrado')::numeric)
                     FROM (SELECT reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), e.id) AS r FROM (SELECT (x.value ->> 'id')::bigint AS id FROM jsonb_array_elements(pg_temp.j('v1') -> 'por_establecimiento') x) e) z),
  '149-14 [2] pedir el reporte establecimiento por establecimiento y sumarlo da lo mismo que el consolidado');
SELECT pg_temp.ok(pg_temp.j('v1') -> 'por_tipo' -> 'tienda_fabrica' ->> 'bruto' = '150.00' AND pg_temp.j('v1') -> 'por_tipo' -> 'tienda' ->> 'bruto' = '150.00'
  AND (pg_temp.j('v1') -> 'por_tipo' -> 'cedis' ->> 'bruto')::numeric - (pg_temp.j('v0') -> 'por_tipo' -> 'cedis' ->> 'bruto')::numeric = 300
  AND (SELECT count(*) = 3 FROM jsonb_object_keys(pg_temp.j('v1') -> 'por_tipo')),
  '149-15 [1] resumen por tipo: cedis, tienda_fabrica y tienda, cada uno con lo suyo');
SELECT pg_temp.ok((SELECT string_agg(concat_ws(':', x.value ->> 'caja', x.value ->> 'ventas', x.value ->> 'bruto'), ',' ORDER BY x.value ->> 'caja') FROM jsonb_array_elements(pg_temp.j('v1') -> 'por_caja') x) = 'Caja F:2:150.00,Caja R:2:150.00'
  AND (SELECT string_agg(concat_ws(':', x.value ->> 'cajero', x.value ->> 'ventas', x.value ->> 'bruto'), ',' ORDER BY x.value ->> 'cajero') FROM jsonb_array_elements(pg_temp.j('v1') -> 'por_cajero') x)
      = 'Cajera fabrica T149:2:150.00,Cajero remota T149:2:150.00',
  '149-16 ventas por caja y por cajero: solo las de tienda (la venta central no tiene caja ni cajero de tienda)');
SELECT pg_temp.ok((SELECT concat_ws('|', x.value ->> 'unidades', x.value ->> 'importe') FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_producto') x WHERE x.value ->> 'sku' = 'P149-A') = '2|60.00'
  AND (SELECT concat_ws('|', x.value ->> 'unidades', x.value ->> 'importe', x.value ->> 'nombre') FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_producto') x WHERE x.value ->> 'sku' = 'P149-B') = '1|90.00|Hielo B149'
  AND (SELECT (x.value ->> 'unidades')::int FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')) -> 'por_producto') x WHERE x.value ->> 'sku' = 'P149-A') = 5,
  '149-17 ventas por producto y unidades vendidas, por establecimiento');
SELECT pg_temp.ok(jsonb_array_length(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_establecimiento') = 1
  AND pg_temp.cifras(reporte_ventas_establecimientos(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'consolidado') = '2|3|150.00|60.00|90.00|150.00',
  '149-18 [9] con un establecimiento elegido, el reporte trae SOLO ese establecimiento');

\echo '── 149: [3] devoluciones · [6] los traspasos no son ventas'
SELECT pg_temp.ok((pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tf', 'id')) ->> 'devoluciones')::numeric = 60 AND (pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tr', 'id')) ->> 'devoluciones')::numeric = 60
  AND pg_temp.q(format($q$SELECT concat_ws('|', count(*), sum(d.total)) FROM devoluciones d JOIN ordenes o ON o.id = d.orden_id WHERE o.establecimiento_id IN (%s, %s)$q$, pg_temp.n('tf', 'id'), pg_temp.n('tr', 'id'))) = '2|120.00',
  '149-20 [3] las devoluciones del reporte son las registradas (2, $120), cada una en su tienda; neto = bruto − devoluciones');
SELECT pg_temp.ok((pg_temp.fila(pg_temp.j('v1'), pg_temp.n('tr', 'id')) ->> 'ventas')::int = 2
  AND pg_temp.q(format($q$SELECT count(*) FROM ordenes WHERE establecimiento_id = %s$q$, pg_temp.n('tr', 'id'))) = '4'
  AND pg_temp.q($q$SELECT count(*) FROM traspasos$q$) = '4' AND pg_temp.q($q$SELECT COALESCE(sum(cantidad_despachada), 0) FROM traspaso_lineas$q$) = '35'
  AND pg_temp.j('v1')::text NOT LIKE '%TR-0%',
  '149-21 [6] 35 piezas despachadas en traspasos y NINGUNA aparece como venta ni como cobro: la tienda remota tiene solo sus 2 ventas del día');
SELECT pg_temp.ok(pg_temp.j('v1')::text !~* 'SEC010203|secreto@|Calle reservada|Cliente Secreto|34000|rfc|correo|saldo' AND reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy())::text !~* 'SEC010203|Cliente Secreto|secreto@',
  '149-22 los reportes no exponen datos de clientes (ni nombre, ni RFC, ni correo, ni domicilio)');

\echo '── 149: [4][5] cajas — reembolsos pendientes y entregados, diferencias'
INSERT INTO t149 VALUES ('c1', reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy()));
CREATE OR REPLACE FUNCTION pg_temp.turno(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT x.value FROM jsonb_array_elements(pg_temp.j('c1') -> 'turnos') x WHERE (x.value ->> 'turno_id')::bigint = pg_temp.n(p_k, 'turno_id') $$;
SELECT pg_temp.ok(pg_temp.turno('tuf') @> '{"estado": "cerrado", "caja": "Caja F", "cajero": "Cajera fabrica T149", "ventas": 2, "fondo_inicial": 100.00, "vendido": 150.00, "cobrado_efectivo": 60.00,
                                           "reembolsos_desde_caja": 60.00, "efectivo_esperado": 100.00, "efectivo_contado": 95.00, "diferencia": -5.00, "motivo_diferencia": "Faltaron 5 pesos de cambio"}'::jsonb
  AND pg_temp.turno('tuf') -> 'cobrado_por_metodo' = '{"Efectivo": 60.00, "Tarjeta (terminal)": 90.00}'::jsonb,
  '149-30 [5] turno cerrado de la tienda de fábrica: fondo 100, cobrado por forma de pago, esperado 100 (100 + 60 − 60 de reembolso), contado 95, diferencia −5 con su motivo');
SELECT pg_temp.ok(pg_temp.turno('tuf') @> '{"reembolsos_registrados": 60.00, "reembolsos_entregados": 60.00, "reembolsos_pendientes": 0}'::jsonb
  AND pg_temp.turno('tur') @> '{"reembolsos_registrados": 60.00, "reembolsos_entregados": 0, "reembolsos_pendientes": 60.00}'::jsonb,
  '149-31 [4] reembolsos: en la fábrica $60 registrados y ENTREGADOS; en la remota $60 registrados y PENDIENTES (la devolución electrónica aún no se hace)');
SELECT pg_temp.ok(pg_temp.turno('tur') @> '{"estado": "abierto", "fondo_inicial": 50.00, "ventas": 2, "cobrado_efectivo": 90.00, "efectivo_esperado": 140.00}'::jsonb
  AND pg_temp.turno('tur') -> 'efectivo_contado' = 'null'::jsonb AND pg_temp.turno('tur') -> 'diferencia' = 'null'::jsonb,
  '149-32 Administración ve el efectivo esperado al momento de un turno ABIERTO (50 + 90 = 140; la transferencia no es efectivo)');
SELECT pg_temp.ok(pg_temp.j('c1') -> 'resumen' @> '{"turnos": 2, "abiertos": 1, "cerrados": 1, "fondo_inicial": 150.00, "vendido": 300.00, "cobrado_efectivo": 150.00, "efectivo_esperado_cerrados": 100.00,
                                                    "efectivo_contado": 95.00, "sobrantes": 0, "faltantes": -5.00, "turnos_con_diferencia": 1,
                                                    "reembolsos_registrados": 120.00, "reembolsos_entregados": 60.00, "reembolsos_pendientes": 60.00}'::jsonb,
  '149-33 [4][5] resumen de cajas: 2 turnos, $5 de faltante en 1 turno; reembolsos $120 registrados = $60 entregados + $60 pendientes');
SELECT pg_temp.ok((SELECT string_agg(concat_ws(':', x.value ->> 'caja', x.value ->> 'turnos', x.value ->> 'ventas', x.value ->> 'vendido', x.value ->> 'diferencia', x.value ->> 'turnos_con_diferencia'), ',' ORDER BY x.value ->> 'caja')
                     FROM jsonb_array_elements(pg_temp.j('c1') -> 'por_caja') x) = 'Caja F:1:2:150.00:-5.00:1,Caja R:1:2:150.00:0:0'
  AND jsonb_array_length(reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'turnos') = 1
  AND jsonb_array_length(reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy(), 1) -> 'turnos') = 0,
  '149-34 detalle por caja; con una tienda elegida solo salen sus turnos; el CEDIS no tiene turnos de tienda');
-- Al confirmar el reembolso pendiente, cambia de columna (no se duplica).
SELECT confirmar_reembolso_tienda(pg_temp.op(30), pg_temp.n('cr', 'correccion_id'), 'DEV-BANCO-149');
SELECT pg_temp.ok(reporte_cajas_tiendas(pg_temp.hoy(), pg_temp.hoy()) -> 'resumen' @> '{"reembolsos_registrados": 120.00, "reembolsos_entregados": 120.00, "reembolsos_pendientes": 0}'::jsonb,
  '149-35 [4] al confirmarse la devolución del banco, el reembolso pasa de pendiente a entregado: registrados 120 = entregados 120');

\echo '── 149: [7][8] inventario, tránsito, dañados y faltantes'
INSERT INTO t149 VALUES ('i1', reporte_inventario_establecimientos());
SELECT pg_temp.ok(pg_temp.fila(pg_temp.j('i1'), pg_temp.n('tr', 'id')) -> 'existencia' = '{"P149-A": 17, "P149-B": 5}'::jsonb
  AND pg_temp.fila(pg_temp.j('i1'), pg_temp.n('tf', 'id')) -> 'existencia' = '{"P149-A": 10}'::jsonb
  AND (pg_temp.fila(pg_temp.j('i1'), 1) ->> 'piezas')::int - (pg_temp.fila(pg_temp.j('i0'), 1) ->> 'piezas')::int = (62 + 44) - 150
  AND reporte_inventario_establecimientos(1) -> 'por_cuarto' @> '[{"cuarto_id": "CF-149-C1", "piezas": 106, "existencia": {"P149-A": 62, "P149-B": 44}}]'::jsonb,
  '149-40 existencia por establecimiento y por cuarto: remota 17 A y 5 B; fábrica 10 A; el cuarto del CEDIS pasó de 150 a 106 (62 A y 44 B)');
SELECT pg_temp.ok(pg_temp.fila(pg_temp.j('i1'), pg_temp.n('tr', 'id')) -> 'en_camino_hacia' = '{"P149-A": 5}'::jsonb
  AND (pg_temp.j('i1') -> 'en_transito' ->> 'piezas')::int - (pg_temp.j('i0') -> 'en_transito' ->> 'piezas')::int = 5
  AND pg_temp.j('i1') -> 'en_transito' -> 'traspasos' @> jsonb_build_array(jsonb_build_object('folio', pg_temp.j('t2') ->> 'folio', 'piezas', 5, 'destino', pg_temp.n('tr', 'id'), 'origen', 1)),
  '149-41 [8] producto en tránsito: 5 piezas que ya salieron del CEDIS y todavía no llegan a la tienda remota (no están en ningún cuarto)');
SELECT pg_temp.ok((pg_temp.j('i1') ->> 'total_piezas')::int - (pg_temp.j('i0') ->> 'total_piezas')::int = -(4 + 3)
  AND (pg_temp.j('i1') ->> 'total_piezas')::int = (SELECT sum((x.value ->> 'piezas')::int) FROM jsonb_array_elements(pg_temp.j('i1') -> 'por_establecimiento') x) + (pg_temp.j('i1') -> 'en_transito' ->> 'piezas')::int,
  '149-42 [8] total de la empresa = existencia en cuartos + en tránsito. De las 150 piezas del día faltan exactamente 7: 4 vendidas y no devueltas, y 3 dañadas o faltantes en un traspaso');
INSERT INTO t149 VALUES ('a1', reporte_abastecimiento_tiendas(pg_temp.hoy(), pg_temp.hoy()));
SELECT pg_temp.ok((SELECT string_agg(k || ':' || ((pg_temp.j('a1') -> 'traspasos' ->> k)::int - COALESCE((pg_temp.j('a0') -> 'traspasos' ->> k)::int, 0)), ',' ORDER BY k)
                     FROM unnest(ARRAY['despachados', 'recibidos', 'retornados', 'en_transito', 'incidencias_abiertas', 'incidencias_cerradas']) k)
                  = 'despachados:3,en_transito:1,incidencias_abiertas:1,incidencias_cerradas:0,recibidos:1,retornados:1',
  '149-43 traspasos del día: 3 despachados (1 recibido, 1 retornado, 1 en tránsito), 1 incidencia abierta; el pendiente que nunca salió y el traspaso directo de 144 no cuentan');
SELECT pg_temp.ok((SELECT string_agg(k || ':' || ((pg_temp.j('a1') -> 'unidades' ->> k)::int - COALESCE((pg_temp.j('a0') -> 'unidades' ->> k)::int, 0)), ',' ORDER BY k)
                     FROM unnest(ARRAY['despachadas', 'recibidas_correctamente', 'retornadas', 'danadas', 'faltantes', 'en_transito']) k)
                  = 'danadas:2,despachadas:35,en_transito:5,faltantes:1,recibidas_correctamente:23,retornadas:4',
  '149-44 [7] unidades: 35 despachadas = 23 recibidas correctamente + 4 retornadas + 2 dañadas + 1 faltante + 5 en tránsito');
SELECT pg_temp.ok((SELECT (u ->> 'despachadas')::int = (u ->> 'recibidas_correctamente')::int + (u ->> 'retornadas')::int + (u ->> 'danadas')::int + (u ->> 'faltantes')::int + (u ->> 'en_transito')::int
                     FROM (SELECT pg_temp.j('a1') -> 'unidades' AS u) z)
  AND (SELECT concat_ws('|', x.value ->> 'despachadas', x.value ->> 'recibidas_correctamente', x.value ->> 'danadas', x.value ->> 'faltantes', x.value ->> 'retornadas', x.value ->> 'en_transito', x.value ->> 'incidencias_abiertas', x.value ->> 'tipo')
         FROM jsonb_array_elements(pg_temp.j('a1') -> 'por_tienda') x WHERE (x.value ->> 'establecimiento_id')::bigint = pg_temp.n('tr', 'id')) = '35|23|2|1|4|5|1|tienda'
  AND (SELECT concat_ws('|', x.value ->> 'despachadas', x.value ->> 'recibidas_correctamente', x.value ->> 'danadas', x.value ->> 'faltantes') FROM jsonb_array_elements(pg_temp.j('a1') -> 'por_producto') x WHERE x.value ->> 'sku' = 'P149-A') = '29|17|2|1',
  '149-45 [7] las cuentas cuadran en el total, por tienda y por producto');
SELECT pg_temp.ok(pg_temp.j('a1') -> 'contable' @> '{"merma_registrada": false, "valor": null, "ingreso_comercial": 0}'::jsonb
  AND pg_temp.q($q$SELECT count(*) FROM mermas WHERE sku IN ('P149-A', 'P149-B')$q$) = '0'
  AND pg_temp.q($q$SELECT count(*) FROM movimientos_contables WHERE concepto ILIKE '%traspaso%' OR referencia LIKE 'TR-%'$q$) = '0'
  AND pg_temp.j('a1')::text !~ '"(importe|bruto|precio|total|monto)"',
  '149-46 [7] físico ≠ contable: dañados y faltantes se reportan en PIEZAS; no hay merma contable, ni egreso, ni valor en pesos, ni ingreso por traspasos');
SELECT pg_temp.ok((SELECT concat_ws('|', x.value ->> 'folio', x.value ->> 'abierta', x.value ->> 'danadas', x.value ->> 'faltantes', x.value ->> 'nota') FROM jsonb_array_elements(pg_temp.j('a1') -> 'incidencias') x
                    WHERE x.value ->> 'folio' = pg_temp.j('t1') ->> 'folio') = concat_ws('|', pg_temp.j('t1') ->> 'folio', 'true', '2', '1', 'Dos bolsas rotas y falta una'),
  '149-47 incidencias: la del traspaso recibido, abierta, con sus 2 dañadas, 1 faltante y la nota de quien recibió');
SELECT cerrar_incidencia_traspaso(pg_temp.op(31), pg_temp.n('t1', 'traspaso_id'), 'Se descontó al transportista');
SELECT pg_temp.ok((reporte_abastecimiento_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'traspasos') @> '{"incidencias_abiertas": 0, "incidencias_cerradas": 1, "despachados": 3}'::jsonb
  AND reporte_abastecimiento_tiendas(pg_temp.hoy(), pg_temp.hoy(), pg_temp.n('tf', 'id')) -> 'unidades' ->> 'despachadas' = '0',
  '149-48 al cerrarla pasa a incidencias cerradas; la tienda de fábrica no tiene traspasos con tránsito');

\echo '── 149: [12] fechas y zona horaria del negocio'
SELECT pg_temp.ok(pg_temp.cifras(reporte_ventas_establecimientos(pg_temp.hoy() - 10, pg_temp.hoy() - 10, pg_temp.n('tr', 'id')) -> 'consolidado') = '1|1|30.00|0.00|30.00|0.00'
  AND pg_temp.cifras(reporte_ventas_establecimientos(pg_temp.hoy() - 9, pg_temp.hoy() - 9, pg_temp.n('tr', 'id')) -> 'consolidado') = '1|2|60.00|0.00|60.00|0.00',
  '149-50 [12] una venta a las 23:59:59 (hora del negocio) cuenta en ese día; otra a las 00:00:01 cuenta en el siguiente');
SELECT pg_temp.ok((SELECT (delivered_at AT TIME ZONE 'UTC')::date FROM ordenes WHERE id = 14983) = pg_temp.hoy() - 9
  AND fin_dia_negocio((SELECT delivered_at FROM ordenes WHERE id = 14983)) = pg_temp.hoy() - 10,
  '149-51 [12] …aunque en UTC esa venta de las 23:59 ya sea "mañana": el corte del día es el del negocio, no el del servidor');
SELECT pg_temp.ok(pg_temp.cifras(reporte_ventas_establecimientos(pg_temp.hoy() - 10, pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'consolidado') = '4|6|240.00|60.00|180.00|150.00'
  AND (SELECT string_agg(concat_ws(':', (x.value ->> 'fecha')::date - pg_temp.hoy(), x.value ->> 'ventas', x.value ->> 'bruto'), ',' ORDER BY x.value ->> 'fecha')
         FROM jsonb_array_elements(reporte_ventas_establecimientos(pg_temp.hoy() - 10, pg_temp.hoy(), pg_temp.n('tr', 'id')) -> 'por_dia') x) = '-10:1:30.00,-9:1:60.00,0:2:150.00'
  AND pg_temp.cifras(reporte_ventas_establecimientos(pg_temp.hoy() - 8, pg_temp.hoy() - 1, pg_temp.n('tr', 'id')) -> 'consolidado') = '0|0|0.00|0.00|0.00|0.00',
  '149-52 [12] por periodo y por día: 4 ventas en 11 días, repartidas en sus tres días; un periodo sin ventas da ceros');
SELECT pg_temp.falla($q$SELECT reporte_ventas_establecimientos(NULL, CURRENT_DATE)$q$, '149-53 sin fecha inicial: rechazado', '22023', '%', 'RANGO_INVALIDO');
SELECT pg_temp.falla($q$SELECT reporte_ventas_establecimientos(CURRENT_DATE, CURRENT_DATE - 1)$q$, '149-54 rango invertido: rechazado', '22023', '%', 'RANGO_INVALIDO');
SELECT pg_temp.falla($q$SELECT reporte_cajas_tiendas(CURRENT_DATE - 401, CURRENT_DATE)$q$, '149-55 más de 400 días: rechazado', '22023', '%', 'RANGO_INVALIDO');
SELECT pg_temp.falla($q$SELECT reporte_abastecimiento_tiendas(CURRENT_DATE, CURRENT_DATE, 99999999)$q$, '149-56 establecimiento inexistente: rechazado', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');

\echo '── 149: [10] permisos — solo Administración'
DO $$
DECLARE f TEXT; n INTEGER; v_state TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOREACH n IN ARRAY ARRAY[2, 3, 4, 5, 6, 7, 8] LOOP
    PERFORM pg_temp.como(n);
    FOREACH f IN ARRAY ARRAY[
      $q$SELECT reporte_ventas_establecimientos(CURRENT_DATE - 30, CURRENT_DATE)$q$,
      format($q$SELECT reporte_ventas_establecimientos(CURRENT_DATE - 30, CURRENT_DATE, %s)$q$, pg_temp.n('tr', 'id')),
      format($q$SELECT reporte_ventas_establecimientos(CURRENT_DATE - 30, CURRENT_DATE, %s)$q$, pg_temp.n('tf', 'id')),
      $q$SELECT reporte_cajas_tiendas(CURRENT_DATE - 30, CURRENT_DATE)$q$,
      format($q$SELECT reporte_cajas_tiendas(CURRENT_DATE - 30, CURRENT_DATE, %s)$q$, pg_temp.n('tr', 'id')),
      $q$SELECT reporte_inventario_establecimientos()$q$,
      format($q$SELECT reporte_inventario_establecimientos(%s)$q$, pg_temp.n('tr', 'id')),
      $q$SELECT reporte_abastecimiento_tiendas(CURRENT_DATE - 30, CURRENT_DATE)$q$,
      $q$SELECT reporte_ventas_establecimientos(NULL, NULL, NULL)$q$, $q$SELECT reporte_cajas_tiendas(NULL, NULL, NULL)$q$] LOOP
      v_state := NULL;
      BEGIN EXECUTE f; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
      IF v_state IS DISTINCT FROM '42501' THEN v_mal := v_mal || (n || ': ' || left(f, 45) || ' → ' || COALESCE(v_state, 'ejecutó')); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 149-60 %', v_mal; END IF;
  RAISE NOTICE 'OK: 149-60 [10] Ventas central, Producción, Chofer, Empleado, Facturación y los cajeros de tienda (también pidiendo SU propia tienda): los cuatro reportes responden "no autorizado"';
END $$;
SELECT pg_temp.como(7);
INSERT INTO t149 VALUES ('mt', mi_turno_caja());
SELECT pg_temp.ok(pg_temp.j('mt') -> 'turno' ->> 'turno_id' = (pg_temp.n('tur', 'turno_id'))::text AND pg_temp.j('mt')::text !~* 'esperado|140|contado|diferencia'
  AND (SELECT efectivo_esperado IS NULL AND totales IS NULL FROM turnos_caja WHERE id = pg_temp.n('tur', 'turno_id'))
  AND (SELECT count(*) FROM turnos_caja) = 1 AND (SELECT count(*) FROM correcciones_venta_tienda) = 0 AND (SELECT count(*) FROM ventas_tienda) = 0,
  '149-61 [10] el cajero con turno ABIERTO no obtiene el efectivo esperado por ningún lado: ni en Mi turno, ni en su turno por REST (está vacío hasta cerrar), ni puede leer correcciones o el registro de ventas');
SELECT pg_temp.ok((SELECT count(*) = 4 AND bool_and(establecimiento_id = pg_temp.n('tr', 'id')) FROM ordenes) AND (SELECT count(*) FROM turnos_caja WHERE establecimiento_id <> pg_temp.n('tr', 'id')) = 0,
  '149-62 [9] …y de ventas solo ve las 4 órdenes de SU tienda; ninguna de la tienda de fábrica ni central');
SELECT pg_temp.como(6);
SELECT pg_temp.ok((SELECT efectivo_esperado = 100 AND diferencia = -5 FROM turnos_caja WHERE id = pg_temp.n('tuf', 'turno_id')) AND (SELECT count(*) FROM turnos_caja) = 1,
  '149-63 la cajera de fábrica sí ve el resultado de SU turno ya CERRADO (lo de siempre), y ningún otro turno');
SELECT pg_temp.como(2);
SELECT pg_temp.ok((SELECT count(*) FROM turnos_caja) = 0 AND (SELECT count(*) FROM cajas) = 0, '149-64 [11] Ventas central conserva lo suyo y no gana acceso a cajas ni turnos de tienda');
SELECT pg_temp.como(8);
SELECT pg_temp.ok((reporte_financiero(pg_temp.hoy(), pg_temp.hoy())) IS NOT NULL, '149-65 [11] Facturación sigue usando el reporte financiero central de siempre');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((reporte_financiero(pg_temp.hoy(), pg_temp.hoy())) IS NOT NULL AND jsonb_array_length(reporte_ventas_establecimientos(pg_temp.hoy() - 30, pg_temp.hoy()) -> 'por_establecimiento') >= 3,
  '149-66 [10] Administración: acceso consolidado y detallado');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.huella() = (SELECT concat_ws('|', a[1], a[2], a[3], a[4]::int + 0, a[5], a[6]::int + 2, a[7]::int + 1, a[8], a[9]) FROM (SELECT string_to_array(pg_temp.j('h0') #>> '{}', '|') AS a) z),
  '149-67 después de más de 60 consultas de reportes nada cambió: mismas órdenes, pagos, kardex, contabilidad, mermas y existencias (solo quedaron las 2 auditorías y el evento de las dos acciones reales de Admin)');
ROLLBACK;
