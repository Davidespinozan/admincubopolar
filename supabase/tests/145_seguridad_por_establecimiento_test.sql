-- 145_seguridad_por_establecimiento_test.sql — Tiendas propias, E3: perfil efectivo
-- «Ventas Tienda», lectura acotada por establecimiento, clientes y precios del POS solo
-- por contrato, guarda de existencias por lista de quién SÍ puede, y cierre de lo que heredaba
-- como «usuario activo» (auditoría, avisos, bucket de mermas y 4 ayudantes de historia).
-- Escenario aislado: el interruptor de tiendas se enciende DENTRO de la transacción y todo
-- se deshace con ROLLBACK.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
SELECT set_config('t145.apagado_al_inicio', (NOT tiendas_habilitadas())::text, true);
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba 145';
INSERT INTO establecimientos (clave, nombre, tipo, clientes_pos) VALUES
  ('TFAB145', 'Tienda de fábrica 145', 'tienda_fabrica', 'todos'), ('TEXT145', 'Tienda X 145', 'tienda', 'lista'),
  ('TEYY145', 'Tienda Y 145', 'tienda', 'lista'), ('TEIN145', 'Tienda inactiva 145', 'tienda', 'todos');
CREATE TEMP TABLE t145 (k TEXT PRIMARY KEY, v JSONB);
GRANT ALL ON t145 TO authenticated;
INSERT INTO t145 SELECT lower(substr(clave, 1, 4)), to_jsonb(id) FROM establecimientos WHERE clave LIKE '%145';   -- tfab, text, teyy, tein
CREATE OR REPLACE FUNCTION pg_temp.j(p_k TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT v FROM t145 WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION pg_temp.eid(p_k TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT (v #>> '{}')::bigint FROM t145 WHERE k = p_k $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email)
  SELECT ('14500000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t145' FROM generate_series(1, 15) n;
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, accesos_extra) VALUES
  (14501, 'Admin T145',            'u1@t145',  'Admin',          'Activo', '14500000-0000-0000-0000-000000000001', '{}'),
  (14502, 'Ventas central T145',   'u2@t145',  'Ventas',         'Activo', '14500000-0000-0000-0000-000000000002', '{}'),
  (14503, 'Produccion T145',       'u3@t145',  'Producción',     'Activo', '14500000-0000-0000-0000-000000000003', '{}'),
  (14504, 'Chofer T145',           'u4@t145',  'Chofer',         'Activo', '14500000-0000-0000-0000-000000000004', '{}'),
  (14505, 'Empleado T145',         'u5@t145',  'Empleado',       'Activo', '14500000-0000-0000-0000-000000000005', '{}'),
  (14506, 'Tienda X T145',         'u6@t145',  'Ventas',         'Activo', '14500000-0000-0000-0000-000000000006', '{}'),
  (14507, 'Tienda Y T145',         'u7@t145',  'Ventas',         'Activo', '14500000-0000-0000-0000-000000000007', '{}'),
  (14508, 'Fabrica con CEDIS T145','u8@t145',  'Ventas',         'Activo', '14500000-0000-0000-0000-000000000008', '{}'),
  (14509, 'Fabrica sin CEDIS T145','u9@t145',  'Ventas',         'Activo', '14500000-0000-0000-0000-000000000009', '{}'),
  (14510, 'Bolsas + Ventas T145',  'u10@t145', 'Almacén Bolsas', 'Activo', '14500000-0000-0000-0000-000000000010', '{Ventas}'),
  (14511, 'Tienda X + extra T145', 'u11@t145', 'Ventas',         'Activo', '14500000-0000-0000-0000-000000000011', '{Almacén Bolsas}'),
  (14512, 'Facturacion T145',      'u12@t145', 'Facturación',    'Activo', '14500000-0000-0000-0000-000000000012', '{}'),
  (14513, 'Admin en tienda T145',  'u13@t145', 'Admin',          'Activo', '14500000-0000-0000-0000-000000000013', '{}'),
  (14514, 'Tienda inactiva T145',  'u14@t145', 'Ventas',         'Activo', '14500000-0000-0000-0000-000000000014', '{}'),
  (14515, 'Ventas sin tienda T145','u15@t145', 'Ventas',         'Activo', '14500000-0000-0000-0000-000000000015', '{Almacén Bolsas}');
INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES
  ('P145-A', 'Hielo A145', 'Producto Terminado', 30, 0, 7), ('P145-B', 'Hielo B145', 'Producto Terminado', 90, 0, 9),
  ('E145-X', 'Bolsa 145', 'Empaque', 2, 0, 1);
INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES
  ('CF-145-TF', 'Congelador fábrica 145',  '{"P145-A": 50}', pg_temp.eid('tfab')),
  ('CF-145-TX', 'Congelador tienda X 145', '{"P145-A": 50}', pg_temp.eid('text')),
  ('CF-145-TY', 'Congelador tienda Y 145', '{"P145-A": 50}', pg_temp.eid('teyy')),
  ('CF-145-TI', 'Congelador inactiva 145', '{"P145-A": 50}', pg_temp.eid('tein')),
  ('CF-145-C1', 'Cuarto CEDIS 145',        '{"P145-A": 50}', 1);
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, destino, usuario, referencia, cuarto_id)
  SELECT 'Entrada', 'P145-A', 50, 'T145', c.id, 'prueba 145', 'T145-' || c.id, c.id FROM cuartos_frios c WHERE c.id LIKE 'CF-145-%';
INSERT INTO clientes (id, nombre, nombre_comercial, rfc, regimen, uso_cfdi, cp, correo, direccion, saldo, credito_autorizado, limite_credito, estatus, fusionado_en) VALUES
  (14501, 'Abarrotes Lupita 145',      'La Lupita', 'ALU010203AB1',  '601', 'G03', '34000', 'lupita@t145',  'Calle secreta 1', 111.11, true,  9999, 'Activo',   NULL),
  (14502, 'Abarrotes Lupe Centro 145', NULL,        'XAXX010101000', '616', 'S01', '34000', 'lupe@t145',    'Calle secreta 2', 0,      false, 0,    'Activo',   NULL),
  (14503, 'Abarrotes Inactivo 145',    NULL,        'XAXX010101000', '616', 'S01', '34000', 'inac@t145',    'x',               0,      false, 0,    'Inactivo', NULL),
  (14504, 'Abarrotes Fusionado 145',   NULL,        'XAXX010101000', '616', 'S01', '34000', 'fus@t145',     'x',               0,      false, 0,    'Inactivo', 14501),
  (14505, 'Reservado Central 145',     'ZETA145',   'RCE010203AB2',  '601', 'G03', '34000', 'central@t145', 'Calle secreta 5', 500,    true,  5000, 'Activo',   NULL),
  (14506, 'Cien%_Raro 145',            NULL,        'XAXX010101000', '616', 'S01', '34000', 'raro@t145',    'x',               0,      false, 0,    'Activo',   NULL);
INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito, estatus)
  SELECT 14520 + n, 'Masivo 145 ' || lpad(n::text, 2, '0'), 'XAXX010101000', 0, false, 0, 'Activo' FROM generate_series(1, 12) n;
INSERT INTO sucursales (id, cliente_id, nombre, es_principal, estatus) VALUES
  (1450101, 14501, 'Principal', true, 'Activa'), (1450201, 14502, 'Principal', true, 'Activa'), (1450501, 14505, 'Principal', true, 'Activa');
INSERT INTO precios_esp (cliente_id, sku, precio, sucursal_id) VALUES
  (14501, 'P145-A', 25, NULL),                                   -- precio del cliente (cadena)
  (14502, 'P145-A', 24, NULL), (14502, 'P145-A', 22, 1450201),   -- la sucursal principal manda sobre el del cliente
  (14505, 'P145-A', 11, NULL);                                   -- cliente fuera del alcance de la tienda X
INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id, establecimiento_id) VALUES
  (14501, 'OV-14501', 14505, 'Reservado Central 145', 'x', 60, 'Creada',    'Efectivo', 'Contado', 14502, NULL, NULL),
  (14502, 'OV-14502', 14501, 'Abarrotes Lupita 145',  'x', 30, 'Entregada', 'Efectivo', 'Contado', 14506, NULL, pg_temp.eid('text')),
  (14503, 'OV-14503', 14502, 'Abarrotes Lupe 145',    'x', 30, 'Entregada', 'Efectivo', 'Contado', 14507, NULL, pg_temp.eid('teyy')),
  (14504, 'OV-14504', 14505, 'Reservado Central 145', 'x', 30, 'Entregada', 'Efectivo', 'Contado', 14502, NULL, NULL),
  (14505, 'OV-14505', 14505, 'Reservado Central 145', 'x', 60, 'Creada',    'Efectivo', 'Contado', 14502, NULL, NULL),
  (14506, 'OV-14506', 14505, 'Reservado Central 145', 'x', 30, 'Entregada', 'Efectivo', 'Contado', 14502, NULL, 1);
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (14501, 'P145-A', 2, 30, 60), (14502, 'P145-A', 1, 30, 30), (14503, 'P145-A', 1, 30, 30),
  (14504, 'P145-A', 1, 30, 30), (14505, 'P145-A', 2, 30, 60), (14506, 'P145-A', 1, 30, 30);
INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES
  (14501, 14502, 30, 'Efectivo', CURRENT_DATE, 'T145-pago-tx', 0, 0), (14502, 14503, 30, 'Efectivo', CURRENT_DATE, 'T145-pago-ty', 0, 0),
  (14505, 14504, 30, 'Efectivo', CURRENT_DATE, 'T145-pago-central', 0, 0), (14505, 14506, 30, 'Efectivo', CURRENT_DATE, 'T145-pago-cedis', 0, 0);
INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
  (14501, 'R-14501', 'ruta 145', 14504, 'Chofer T145', 'Programada', CURRENT_DATE, '{}', '{}', '{}', '{}');
INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T145 fija', 'x');
INSERT INTO storage.buckets (id, name) VALUES ('mermas', 'mermas') ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('mermas', '14500000-0000-0000-0000-000000000006/2026-10-12/t145-tienda.jpg'), ('mermas', '14500000-0000-0000-0000-000000000002/2026-10-12/t145-central.jpg');
SET LOCAL session_replication_role = origin;

INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis, traspasa_con_cedis, asignado_por) VALUES
  (14506, pg_temp.eid('text'), false, false, 'prueba 145'),
  (14507, pg_temp.eid('teyy'), false, false, 'prueba 145'),
  (14508, pg_temp.eid('tfab'), true,  false, 'prueba 145'),
  (14509, pg_temp.eid('tfab'), false, false, 'prueba 145'),
  (14510, pg_temp.eid('text'), false, false, 'prueba 145'),   -- rol guardado Almacén Bolsas: la asignación no le da perfil de tienda
  (14511, pg_temp.eid('text'), true,  false, 'prueba 145'),   -- vende_desde_cedis en una tienda que NO es de fábrica: no vale
  (14513, pg_temp.eid('text'), false, false, 'prueba 145'),   -- Admin asignado: sigue siendo Admin
  (14514, pg_temp.eid('tein'), true,  false, 'prueba 145'),
  (14503, pg_temp.eid('tfab'), false, true,  'prueba 145'),   -- Producción con traspaso (144): sigue siendo Producción
  (14502, 1, false, false, 'prueba 145');                     -- Ventas central asignado SOLO al CEDIS: sigue siendo central
INSERT INTO establecimiento_clientes (establecimiento_id, cliente_id, asignado_por)
  SELECT pg_temp.eid('text'), c, 'prueba 145' FROM unnest(ARRAY[14501, 14502, 14503, 14504, 14506]) c;
UPDATE establecimientos SET activo = false WHERE id = pg_temp.eid('tein');

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
         set_config('request.jwt.claims', '{"role":"authenticated","sub":"14500000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0') || '"}', true)::void $$;
CREATE OR REPLACE FUNCTION pg_temp.op(p_n INTEGER) RETURNS UUID LANGUAGE sql AS $$ SELECT ('14500000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid $$;
-- Perfil efectivo que ve el servidor: rol|roles|lector|tiene Ventas|contrato Admin/Ventas
CREATE OR REPLACE FUNCTION pg_temp.perfil() RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('|', COALESCE((SELECT rol FROM erp_actor()), '-'), COALESCE(array_to_string(erp_roles_activos(), ','), '-'),
                   erp_lector_negocio(), erp_tiene_rol('Ventas'), fin_actor_permitido(ARRAY['Admin', 'Ventas'])) $$;
-- Existencia de P145-A: CEDIS|fábrica|inactiva|X|Y
CREATE OR REPLACE FUNCTION pg_temp.inv() RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(COALESCE(stock ->> 'P145-A', '0'), '|' ORDER BY id) FROM public.cuartos_frios WHERE id LIKE 'CF-145-%' $$;
CREATE OR REPLACE FUNCTION pg_temp.ids(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT; BEGIN EXECUTE 'SELECT COALESCE(string_agg(x::text, '','' ORDER BY x::text), '''') FROM (' || p_sql || ') q(x)' INTO v; RETURN v; END $$;
-- Tablas de public con SELECT para authenticated y su total real de filas (se llena como dueño).
CREATE TEMP TABLE t145_tot (tabla TEXT PRIMARY KEY, n BIGINT, lector BOOLEAN);
GRANT SELECT ON t145_tot TO authenticated;
DO $$
DECLARE r RECORD; v BIGINT;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
              AND has_table_privilege('authenticated', c.oid, 'SELECT') AND c.relname !~ '^(t_|t[0-9]+)' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO v;
    INSERT INTO t145_tot VALUES (r.relname, v, EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = r.relname
                                                         AND p.cmd = 'SELECT' AND p.qual LIKE '%erp_lector_negocio()%'));
  END LOOP;
END $$;
-- Filas que ve el usuario actual en cada una de esas tablas.
CREATE OR REPLACE FUNCTION pg_temp.visibles() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD; v BIGINT; o JSONB := '{}';
BEGIN
  FOR r IN SELECT tabla FROM t145_tot ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tabla) INTO v;
    o := o || jsonb_build_object(r.tabla, v);
  END LOOP;
  RETURN o;
END $$;
-- Escrituras a ciegas (sin WHERE, sin leer columnas) sobre cada tabla: devuelve las tablas donde
-- el usuario actual alcanzó alguna fila (la cambió, la borró o chocó con algo que no es el permiso).
CREATE OR REPLACE FUNCTION pg_temp.escrituras_ciegas() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n BIGINT; v_col TEXT; v_mal TEXT[] := '{}';
BEGIN
  FOR r IN SELECT t.tabla FROM t145_tot t WHERE t.n > 0 ORDER BY 1 LOOP
    SELECT a.attname INTO v_col FROM pg_attribute a WHERE a.attrelid = ('public.' || quote_ident(r.tabla))::regclass
       AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnotnull, a.attnum DESC LIMIT 1;
    BEGIN
      EXECUTE format('UPDATE public.%I SET %I = NULL', r.tabla, v_col);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION 'alcanzó' USING ERRCODE = 'P0098'; END IF;
    EXCEPTION WHEN OTHERS THEN
      -- "permission denied" (sin grant) y RLS = no la alcanzó. Cualquier otro error (también el 42501 de una
      -- guarda de la tabla) significa que la fila SÍ estaba a su alcance.
      IF SQLERRM !~ '^(permission denied|new row violates row-level security)' THEN v_mal := v_mal || ('UPDATE ' || r.tabla); END IF;
    END;
    BEGIN
      EXECUTE format('DELETE FROM public.%I', r.tabla);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION 'alcanzó' USING ERRCODE = 'P0098'; END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM !~ '^(permission denied|new row violates row-level security)' THEN v_mal := v_mal || ('DELETE ' || r.tabla); END IF;
    END;
  END LOOP;
  RETURN array_to_string(v_mal, ', ');
END $$;
-- Guarda de existencias a solas: UPDATE directo del dueño de la sesión con el token de p_n (así
-- solo opina el disparador del actor, no las policies ni los contratos). 'ok' o el código del rechazo.
CREATE OR REPLACE FUNCTION pg_temp.mueve(p_n INTEGER, p_cuarto TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_det TEXT;
BEGIN
  PERFORM pg_temp.como(p_n);
  BEGIN
    UPDATE public.cuartos_frios SET stock = stock || '{"P145-B": 1}'::jsonb WHERE id = p_cuarto;
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN v_det := 'ok';
            WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL; v_det := (v_det::jsonb ->> 'codigo');
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_det;
END $$;

-- Lo que el usuario actual tiene por ser «usuario activo» (119): activo|auditoría|aviso|marcar avisos|bucket mermas|4 ayudantes.
-- Cada intento se deshace. t = puede, f = rechazado; en los ayudantes, x = mezcla (no debe ocurrir).
CREATE OR REPLACE FUNCTION pg_temp.heredado() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_sub TEXT := current_setting('request.jwt.claims')::jsonb ->> 'sub'; v_aud TEXT; v_avi TEXT; v_mar TEXT; v_sto TEXT; v_lee TEXT; v_bor TEXT; v_n BIGINT; v_ok INT := 0; v_no INT := 0; q TEXT;
BEGIN
  BEGIN INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('T145', 'Falsa', 'X', 'T145 inventada'); RAISE EXCEPTION 'd' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN v_aud := 't'; WHEN insufficient_privilege THEN v_aud := 'f'; END;
  BEGIN INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T145 falsa', 'x'); RAISE EXCEPTION 'd' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN v_avi := 't'; WHEN insufficient_privilege THEN v_avi := 'f'; END;
  BEGIN UPDATE notificaciones SET leida = true; GET DIAGNOSTICS v_n = ROW_COUNT; v_mar := CASE WHEN v_n > 0 THEN 't' ELSE 'f' END; RAISE EXCEPTION 'd' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN NULL; WHEN insufficient_privilege THEN v_mar := 'f'; END;
  BEGIN INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', v_sub || '/2026-10-12/t145-nueva.jpg'); RAISE EXCEPTION 'd' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN v_sto := 't'; WHEN insufficient_privilege THEN v_sto := 'f'; END;
  SELECT CASE WHEN count(*) > 0 THEN 't' ELSE 'f' END INTO v_lee FROM storage.objects WHERE bucket_id = 'mermas' AND name LIKE v_sub || '/%';
  BEGIN DELETE FROM storage.objects WHERE bucket_id = 'mermas'; GET DIAGNOSTICS v_n = ROW_COUNT; v_bor := CASE WHEN v_n > 0 THEN 't' ELSE 'f' END; RAISE EXCEPTION 'd' USING ERRCODE = 'P0097';
  EXCEPTION WHEN SQLSTATE 'P0097' THEN NULL; WHEN insufficient_privilege THEN v_bor := 'f'; END;
  FOREACH q IN ARRAY ARRAY[$q$SELECT cuarto_tiene_historia('CF-145-C1')$q$, $q$SELECT empaque_tiene_dependencias(1, 'E145-X')$q$,
                           $q$SELECT b4_ruta_con_historia(14501)$q$, $q$SELECT erp_foto_merma_en_uso('t145.jpg')$q$] LOOP
    BEGIN EXECUTE q; v_ok := v_ok + 1; EXCEPTION WHEN insufficient_privilege THEN v_no := v_no + 1; END;
  END LOOP;
  RETURN concat_ws('|', erp_es_activo(), v_aud, v_avi, v_mar, v_sto || v_lee || v_bor, CASE WHEN v_ok = 4 THEN 't' WHEN v_no = 4 THEN 'f' ELSE 'x' END);
END $$;

\echo '── 145: catálogo'
SELECT pg_temp.ok(current_setting('t145.apagado_al_inicio')::boolean, '145-01 el interruptor de tiendas estaba APAGADO al empezar (145 no lo toca); se encendió solo dentro de esta prueba');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.erp_actor()'::regprocedure)) = 'e1a9770e1bc5cebd7f565c9cfdc2a880'
  AND md5(pg_get_functiondef('public.erp_roles_activos()'::regprocedure)) = '5da5963d56554336793351384f018d74'
  AND md5(pg_get_functiondef('public.erp_lector_negocio()'::regprocedure)) = '858e98ff65b09e80477dde7298b164d2',
  '145-02 las tres funciones de identidad son las de 145');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.erp_es_activo()'::regprocedure)) = '9b87432b5056856944453a60c4e97ff2'
  AND md5(pg_get_functiondef('public.erp_exigir_no_empleado(text)'::regprocedure)) = 'd87bc09bf29e8c06dcedff936e13c12f'
  AND (SELECT count(*) = 2 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND p.provolatile = 's' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
         FROM pg_proc p WHERE p.oid IN ('public.erp_es_activo()'::regprocedure, 'public.erp_exigir_no_empleado(text)'::regprocedure))
  AND has_function_privilege('authenticated', 'public.erp_es_activo()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.erp_exigir_no_empleado(text)', 'EXECUTE'),
  '145-02b erp_es_activo() y erp_exigir_no_empleado() son las de 145, con la firma, SECURITY DEFINER, search_path y permisos de 119');
SELECT pg_temp.ok((SELECT count(*) = 6 AND count(*) FILTER (WHERE schemaname = 'storage' AND tablename = 'objects') = 3
                     FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%erp_es_activo()%')
  AND (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) = 'mermas_authenticated_delete:DELETE,mermas_authenticated_insert:INSERT,mermas_authenticated_read:SELECT'
         FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')
  AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND pg_get_functiondef(p.oid) LIKE '%erp_exigir_no_empleado(%')
         FROM pg_proc p WHERE p.oid IN ('public.b4_ruta_con_historia(bigint)'::regprocedure, 'public.cuarto_tiene_historia(text)'::regprocedure,
           'public.empaque_tiene_dependencias(bigint,text)'::regprocedure, 'public.erp_foto_merma_en_uso(text)'::regprocedure)),
  '145-02c las 6 policies que usan erp_es_activo() (3 de Storage) y los 4 ayudantes de historia NO cambian de texto: los protege la función');
SELECT pg_temp.ok((SELECT count(*) = 3 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND p.provolatile = 's'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.oid IN ('public.erp_actor()'::regprocedure, 'public.erp_roles_activos()'::regprocedure, 'public.erp_lector_negocio()'::regprocedure)),
  '145-03 conservan SECURITY DEFINER, search_path, estabilidad y permisos (authenticated sí, anon no)');
SELECT pg_temp.ok(md5(pg_get_functiondef('public.fin_actor_permitido(text[])'::regprocedure)) = '87a92520544d6b06fca4aa95bbecd7db'
  AND md5(pg_get_functiondef('public.erp_tiene_rol(text)'::regprocedure)) = 'b65845d7ca3adf2607a19e766ed85a8c'
  AND md5(pg_get_functiondef('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)'::regprocedure)) = '2107586c1f5b8b59d7a4ff039a1fd0d6'
  AND md5(pg_get_functiondef('public.stock_mov_cuarto(text,text,integer,text,text,text,text,text,bigint,uuid)'::regprocedure)) = '3591d07446854c4a682cd41f88489ec6'
  AND md5(pg_get_functiondef('public.cuartos_frios_guard()'::regprocedure)) = '2974531ebf77425705492a8efde55c73',
  '145-04 NO cambian: fin_actor_permitido, erp_tiene_rol, completar_venta_directa, stock_mov_cuarto ni la guarda de cuartos de 103');
SELECT pg_temp.ok((SELECT count(*) = 5 AND bool_and(cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE' AND qual LIKE '%''Ventas Tienda''%')
                         AND string_agg(tablename, ',' ORDER BY tablename) = 'cuartos_frios,inventario_mov,orden_lineas,ordenes,pagos'
                     FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tienda_read' AND tablename NOT IN ('cajas', 'turnos_caja', 'turnos_caja_eventos', 'ventas_tienda', 'correcciones_venta_tienda', 'establecimiento_eventos')),   -- las de cajas y turnos son de 146 (E4); establecimiento_eventos, de 147 (E6)
  '145-05 cinco policies nuevas, todas de LECTURA y solo para el perfil de tienda: cuartos, kardex, órdenes, líneas y pagos');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND qual LIKE '%erp_lector_negocio()%') = 26
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname <> 'tienda_read' AND tablename NOT IN ('cajas', 'turnos_caja', 'turnos_caja_eventos', 'ventas_tienda', 'correcciones_venta_tienda', 'establecimiento_eventos')) = 96,
  '145-06 las 96 policies anteriores siguen ahí (26 de lectura amplia con erp_lector_negocio)');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.establecimiento_clientes'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('establecimiento_clientes', 'establecimientos', 'usuario_establecimientos', 'tiendas_activacion'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
                    AND table_name IN ('establecimiento_clientes', 'establecimientos', 'usuario_establecimientos', 'tiendas_activacion')),
  '145-07 las tablas de tiendas siguen sin acceso por API (RLS activa, sin policies, sin grants), también establecimiento_clientes');
SELECT pg_temp.ok((SELECT count(*) = 4 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.oid IN ('public.erp_usuario_de_tienda(bigint)'::regprocedure, 'public.pos_exigir_establecimiento(text,bigint)'::regprocedure,
                       'public.pos_cliente_disponible(bigint,text,bigint)'::regprocedure, 'public.cuartos_frios_guard_actor()'::regprocedure)),
  '145-08 las funciones internas no se exponen por API');
SELECT pg_temp.ok((SELECT count(*) = 6 AND bool_and(p.prosecdef AND array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp' AND p.provolatile = 's'
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.oid IN ('public.mis_establecimientos()'::regprocedure, 'public.buscar_clientes_pos(bigint,text)'::regprocedure,
                       'public.precios_pos(bigint,bigint,text[])'::regprocedure, 'public.erp_tienda_asignada(bigint,boolean)'::regprocedure,
                       'public.erp_tienda_ve_cuarto(text)'::regprocedure, 'public.erp_tienda_ve_orden(bigint)'::regprocedure)),
  '145-09 los 3 contratos del POS y los 3 ayudantes de alcance: solo lectura (STABLE), SECURITY DEFINER, sin anon');
SELECT pg_temp.ok((SELECT column_default = 'false' AND is_nullable = 'NO' FROM information_schema.columns WHERE table_name = 'usuario_establecimientos' AND column_name = 'vende_desde_cedis')
  AND (SELECT column_default LIKE '''lista''%' AND is_nullable = 'NO' FROM information_schema.columns WHERE table_name = 'establecimientos' AND column_name = 'clientes_pos')
  AND (SELECT clientes_pos = 'lista' FROM establecimientos WHERE id = 1),
  '145-10 por omisión: sin permiso de vender desde el CEDIS y clientes del POS en modo lista');
-- Toda policy que permite leer debe estar atada a un perfil que NO es el de tienda (o ser una de las 5 nuevas).
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL') AND policyname <> 'tienda_read'
                     AND qual !~ 'erp_lector_negocio\(\)|= ''Admin''|ARRAY\[''Admin''|''Facturación''|''Producción''|''Chofer''|erp_tiene_rol\(''Ventas''|erp_es_dueno\(\)|asistencia_empleado_actual\(\)|auth_id = auth\.uid\(\)') = 0,
  '145-11 no hay ninguna policy de lectura sin perfil: todas piden un perfil central, la identidad propia o son las 5 de tienda');

\echo '── 145: identidad — los perfiles centrales no cambian'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(1);  SELECT pg_temp.ok(pg_temp.perfil() = 'Admin|Admin|t|f|t', '145-20 Admin: igual que antes');
SELECT pg_temp.como(2);  SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas|Ventas|t|t|t', '145-21 Ventas central (asignado solo al CEDIS): sigue siendo Ventas');
SELECT pg_temp.como(15); SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas|Ventas,Almacén Bolsas|t|t|t', '145-22 Ventas sin ninguna asignación conserva su rol y sus accesos adicionales');
SELECT pg_temp.como(3);  SELECT pg_temp.ok(pg_temp.perfil() = 'Producción|Producción|t|f|f', '145-23 Producción asignado a la tienda de fábrica (traspasos de 144): sigue siendo Producción');
SELECT pg_temp.como(4);  SELECT pg_temp.ok(pg_temp.perfil() = 'Chofer|Chofer|t|f|f', '145-24 Chofer: igual que antes');
SELECT pg_temp.como(5);  SELECT pg_temp.ok(pg_temp.perfil() = 'Empleado|Empleado|f|f|f', '145-25 Empleado: igual que antes');
SELECT pg_temp.como(12); SELECT pg_temp.ok(pg_temp.perfil() = 'Facturación|Facturación|t|f|f', '145-26 Facturación: igual que antes');
SELECT pg_temp.como(13); SELECT pg_temp.ok(pg_temp.perfil() = 'Admin|Admin|t|f|t', '145-27 un Admin asignado a una tienda sigue siendo Admin (ve todo)');
SELECT pg_temp.como(10); SELECT pg_temp.ok(pg_temp.perfil() = 'Almacén Bolsas|Almacén Bolsas,Ventas|t|t|t',
  '145-28 el perfil de tienda es solo para el rol guardado Ventas: Almacén Bolsas con acceso de Ventas no cambia aunque esté asignado');

\echo '── 145: identidad — perfil efectivo de tienda'
SELECT pg_temp.como(6);  SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas Tienda|Ventas Tienda|f|f|f', '145-30 Ventas asignado a una tienda = «Ventas Tienda»: sin lectura amplia, sin Ventas, sin contratos centrales');
SELECT pg_temp.ok((SELECT rol = 'Ventas' FROM usuarios WHERE id = 14506) AND erp_usuario_id() = 14506 AND erp_rol_activo() = 'Ventas Tienda' AND get_my_rol() = 'Ventas Tienda'
  AND fin_mi_rol_activo() = 'Ventas Tienda' AND NOT erp_es_dueno(),
  '145-31 el rol guardado sigue siendo Ventas; el perfil lo decide el servidor en todas sus entradas (erp_rol_activo, get_my_rol, fin_mi_rol_activo)');
SELECT pg_temp.como(11); SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas Tienda|Ventas Tienda|f|f|f', '145-32 el usuario de tienda pierde sus accesos adicionales (Almacén Bolsas)');
SELECT pg_temp.ok(NOT fin_actor_permitido(ARRAY['Almacén Bolsas']) AND NOT erp_tiene_rol('Almacén Bolsas'), '145-33 …y ningún contrato de Almacén de Bolsas lo acepta');
SELECT pg_temp.como(14); SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas Tienda|Ventas Tienda|f|f|f',
  '145-34 si su tienda se desactiva NO regresa a Ventas central: sigue restringido');
SELECT pg_temp.como(8);  SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas Tienda|Ventas Tienda|f|f|f', '145-35 el permiso de vender desde el CEDIS no lo vuelve central');
RESET ROLE;
-- La asignación es lo único que decide, y solo se escribe con SQL de confianza.
SAVEPOINT s_asig;
DELETE FROM usuario_establecimientos WHERE usuario_id = 14506;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);
SELECT pg_temp.ok(pg_temp.perfil() = 'Ventas|Ventas|t|t|t', '145-36 sin asignación (la quita el dueño con SQL) vuelve a ser Ventas central');
RESET ROLE;
ROLLBACK TO s_asig;
SAVEPOINT s_inactivo;
SET LOCAL session_replication_role = replica;
UPDATE usuarios SET estatus = 'Inactivo' WHERE id = 14506; UPDATE usuarios SET debe_cambiar_password = true WHERE id = 14507;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(6); SELECT pg_temp.ok(pg_temp.perfil() = '-|-|f|f|f' AND NOT erp_tienda_asignada(pg_temp.eid('text')), '145-37 usuario de tienda inactivo: sin perfil ni alcance');
SELECT pg_temp.como(7); SELECT pg_temp.ok(pg_temp.perfil() = '-|-|f|f|f' AND NOT erp_tienda_asignada(pg_temp.eid('teyy')), '145-38 con contraseña temporal pendiente: sin perfil ni alcance');
RESET ROLE;
ROLLBACK TO s_inactivo;

\echo '── 145: lectura por REST — perfiles centrales sin cambio'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(2);
SELECT pg_temp.ok((SELECT count(*) = 26 AND bool_and((pg_temp.visibles() ->> t.tabla)::bigint = t.n) AND sum(t.n) > 0 FROM t145_tot t WHERE t.lector),
  '145-40 Ventas central lee TODAS las filas de las 26 tablas de lectura amplia (incluidos los cuartos y órdenes de las tiendas)');
SELECT pg_temp.como(3);
SELECT pg_temp.ok((SELECT bool_and((pg_temp.visibles() ->> t.tabla)::bigint = t.n) FROM t145_tot t WHERE t.lector), '145-41 Producción: igual');
SELECT pg_temp.como(4);
SELECT pg_temp.ok((SELECT bool_and((pg_temp.visibles() ->> t.tabla)::bigint = t.n) FROM t145_tot t WHERE t.lector), '145-42 Chofer: igual');
SELECT pg_temp.como(12);
SELECT pg_temp.ok((SELECT bool_and((pg_temp.visibles() ->> t.tabla)::bigint = t.n) FROM t145_tot t WHERE t.lector), '145-43 Facturación: igual');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((SELECT bool_and((pg_temp.visibles() ->> t.tabla)::bigint = t.n) FROM t145_tot t WHERE t.lector), '145-44 Admin: igual');
SELECT pg_temp.como(5);
SELECT pg_temp.ok((SELECT bool_and((pg_temp.visibles() ->> t.tabla)::bigint = 0) FROM t145_tot t WHERE t.lector), '145-45 Empleado: sigue sin leer ninguna (117)');

\echo '── 145: lectura por REST — usuario de tienda'
SELECT pg_temp.como(6);
INSERT INTO t145 VALUES ('v6', pg_temp.visibles());
SELECT pg_temp.ok((SELECT string_agg(e.key, ',' ORDER BY e.key) FROM jsonb_each_text(pg_temp.j('v6')) e WHERE e.value::bigint > 0)
                  = 'cuartos_frios,inventario_mov,orden_lineas,ordenes,pagos,usuarios',
  '145-50 la tienda X solo ve filas en 6 tablas: sus cuartos, su kardex, sus órdenes, líneas y pagos, y su propio usuario');
SELECT pg_temp.ok((SELECT count(*) >= 15 FROM t145_tot t WHERE t.n > 0 AND (pg_temp.j('v6') ->> t.tabla)::bigint = 0)
  AND (SELECT bool_and(t.n > 0 AND (pg_temp.j('v6') ->> t.tabla)::bigint = 0) FROM t145_tot t
        WHERE t.tabla IN ('clientes', 'productos', 'precios_esp', 'sucursales', 'rutas', 'notificaciones')),
  '145-51 con datos reales en ellas, ve 0 filas de clientes, productos, precios especiales, sucursales, rutas, avisos y de todas las demás tablas');
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM cuartos_frios') = 'CF-145-TX' AND pg_temp.ids('SELECT cuarto_id FROM inventario_mov') = 'CF-145-TX',
  '145-52 inventario: solo el congelador y el kardex de SU tienda (ni otra tienda, ni la de fábrica, ni el CEDIS)');
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM ordenes') = '14502' AND pg_temp.ids('SELECT orden_id FROM orden_lineas') = '14502'
  AND pg_temp.ids('SELECT referencia FROM pagos') = 'T145-pago-tx',
  '145-53 órdenes, líneas y pagos: solo los de SU tienda (ni centrales, ni del CEDIS, ni de otra tienda)');
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM usuarios') = '14506', '145-54 de usuarios solo ve el suyo');
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(c.reloptions @> ARRAY['security_invoker=true']) FROM pg_class c
                     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm') AND has_table_privilege('authenticated', c.oid, 'SELECT'))
  AND (SELECT count(*) FROM chofer_ubicacion_actual) = 0,
  '145-54b la única vista legible por API (ubicación de choferes) respeta los permisos del que consulta: la tienda no ve nada');
SELECT pg_temp.como(7);
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM cuartos_frios') = 'CF-145-TY' AND pg_temp.ids('SELECT id FROM ordenes') = '14503'
  AND pg_temp.ids('SELECT referencia FROM pagos') = 'T145-pago-ty' AND pg_temp.ids('SELECT cuarto_id FROM inventario_mov') = 'CF-145-TY',
  '145-55 la tienda Y ve lo suyo y nada de la tienda X (aislamiento entre tiendas)');
SELECT pg_temp.como(8);
SELECT pg_temp.ok((SELECT string_agg(c.id, ',' ORDER BY c.id) = 'CF-145-TF' FROM cuartos_frios c WHERE c.establecimiento_id <> 1)
  AND (SELECT count(*) > 0 AND count(*) = (SELECT count(*) FROM cuartos_frios WHERE establecimiento_id = 1) FROM cuartos_frios c WHERE c.id = 'CF-145-C1' OR c.establecimiento_id = 1)
  AND pg_temp.ids('SELECT cuarto_id FROM inventario_mov') = 'CF-145-TF' AND pg_temp.ids('SELECT id FROM ordenes') = '',
  '145-56 tienda de fábrica CON permiso: ve su congelador y la existencia de los cuartos del CEDIS; no el kardex ni las órdenes del CEDIS');
SELECT pg_temp.como(9);
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM cuartos_frios') = 'CF-145-TF', '145-57 tienda de fábrica SIN permiso: no ve el inventario del CEDIS');
SELECT pg_temp.como(11);
SELECT pg_temp.ok(pg_temp.ids('SELECT id FROM cuartos_frios') = 'CF-145-TX', '145-58 el permiso de vender desde el CEDIS no vale en una tienda que no es de fábrica');
SELECT pg_temp.como(14);
SELECT pg_temp.ok((SELECT bool_and(e.value::bigint = 0 OR e.key = 'usuarios') FROM jsonb_each_text(pg_temp.visibles()) e),
  '145-59 usuario de una tienda desactivada: no ve nada (ni su congelador)');

\echo '── 145: escritura por REST — usuario de tienda'
SELECT pg_temp.como(6);
SELECT pg_temp.falla($q$SELECT count(*) FROM establecimientos$q$, '145-60 no lee establecimientos por REST', '42501');
SELECT pg_temp.falla($q$SELECT count(*) FROM usuario_establecimientos$q$, '145-61 no lee las asignaciones', '42501');
SELECT pg_temp.falla($q$DELETE FROM usuario_establecimientos WHERE usuario_id = 14506$q$, '145-62 no puede quitarse su asignación para volverse Ventas central', '42501');
SELECT pg_temp.falla(format($q$INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis) VALUES (14506, %s, true)$q$, pg_temp.eid('teyy')),
  '145-63 no puede asignarse otra tienda ni darse permisos', '42501');
SELECT pg_temp.falla($q$UPDATE usuario_establecimientos SET vende_desde_cedis = true$q$, '145-64 no puede darse el permiso de vender desde el CEDIS', '42501');
SELECT pg_temp.falla($q$INSERT INTO establecimiento_clientes (establecimiento_id, cliente_id) VALUES (1, 14505)$q$, '145-65 no puede agregarse clientes a su lista', '42501');
SELECT pg_temp.falla($q$UPDATE establecimientos SET clientes_pos = 'todos'$q$, '145-66 no puede abrir su tienda a todos los clientes', '42501');
SELECT pg_temp.falla($q$UPDATE tiendas_activacion SET habilitada = false$q$, '145-67 no toca el interruptor', '42501');
SELECT pg_temp.falla($q$INSERT INTO clientes (nombre, rfc) VALUES ('T145 falso', 'XAXX010101000')$q$, '145-68 no da de alta clientes por REST', '42501');
SELECT pg_temp.falla($q$INSERT INTO ordenes (folio, cliente_nombre, total, estatus) VALUES ('OV-T145', 'x', 1, 'Creada')$q$, '145-69 no inserta órdenes por REST', '42501');
SELECT pg_temp.falla($q$INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia) VALUES (14501, 14502, 1, 'Efectivo', CURRENT_DATE, 'T145-falso')$q$, '145-70 no inserta pagos por REST', '42501');
SELECT pg_temp.falla($q$INSERT INTO leads (nombre) VALUES ('T145')$q$, '145-71 no escribe prospectos (policy de Ventas)', '42501');
INSERT INTO t145 VALUES ('ciegas6', to_jsonb(pg_temp.escrituras_ciegas()));
SELECT pg_temp.ok(pg_temp.j('ciegas6') #>> '{}' = '',
  '145-72 UPDATE y DELETE a ciegas sobre TODAS las tablas con datos: no alcanza ninguna fila (tampoco los avisos)');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '50|50|50|50|50' AND (SELECT count(*) FROM clientes WHERE nombre = 'T145 falso') = 0
  AND (SELECT estatus = 'Entregada' AND establecimiento_id = pg_temp.eid('text') FROM ordenes WHERE id = 14502), '145-73 nada cambió');

\echo '── 145: lo que se heredaba como «usuario activo» (erp_es_activo / erp_exigir_no_empleado, 119)'
-- activo|auditoría|aviso|marcar avisos|bucket mermas (subir, leer, borrar)|4 ayudantes de historia
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(6);
SELECT pg_temp.ok(pg_temp.heredado() = 'f|f|f|f|fff|f',
  '145-75 Ventas Tienda: no inserta auditoría ni avisos, no marca avisos, no sube, lee ni borra en el bucket de mermas (ni en su carpeta) y los 4 ayudantes lo rechazan');
SELECT pg_temp.falla($q$INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('Tienda 145', 'Falsa', 'X', 'T145 inventada')$q$, '145-75a auditoría directa: rechazada', '42501');
SELECT pg_temp.falla($q$INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('info', 'T145 falsa', 'x')$q$, '145-75b aviso directo: rechazado', '42501');
SELECT pg_temp.falla($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '14500000-0000-0000-0000-000000000006/2026-10-12/x.jpg')$q$, '145-75c subir al bucket de mermas en su propia carpeta: rechazado', '42501');
SELECT pg_temp.falla($q$SELECT cuarto_tiene_historia('CF-145-TX')$q$, '145-75d cuarto_tiene_historia (también sobre SU congelador): rechazado', '42501', '%no autorizado%');
SELECT pg_temp.falla($q$SELECT empaque_tiene_dependencias(1, 'E145-X')$q$, '145-75e empaque_tiene_dependencias: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.falla($q$SELECT b4_ruta_con_historia(14501)$q$, '145-75f b4_ruta_con_historia: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.falla($q$SELECT erp_foto_merma_en_uso('t145.jpg')$q$, '145-75g erp_foto_merma_en_uso: rechazado', '42501', '%no autorizado%');
SELECT pg_temp.ok((SELECT count(*) FROM notificaciones) = 0 AND (SELECT count(*) FROM auditoria) = 0 AND (SELECT count(*) FROM storage.objects) = 0, '145-76 tampoco LEE avisos, auditoría ni archivos');
SELECT pg_temp.como(8);  SELECT pg_temp.ok(pg_temp.heredado() = 'f|f|f|f|fff|f', '145-77 igual el de la tienda de fábrica con permiso de CEDIS');
SELECT pg_temp.como(11); SELECT pg_temp.ok(pg_temp.heredado() = 'f|f|f|f|fff|f', '145-77b …el que tenía accesos adicionales');
SELECT pg_temp.como(14); SELECT pg_temp.ok(pg_temp.heredado() = 'f|f|f|f|fff|f', '145-77c …y el de una tienda desactivada');
-- Los perfiles centrales conservan exactamente lo que tenían (leer/borrar del bucket dependen de tener archivos propios o de ser Admin/Producción).
SELECT pg_temp.como(2);  SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|ttt|t', '145-78 Ventas central: todo igual (auditoría, avisos, marcar, su carpeta del bucket, ayudantes)');
SELECT pg_temp.como(1);  SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78a Admin: igual (sin archivos en su carpeta)');
SELECT pg_temp.como(3);  SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78b Producción (asignado a la tienda de fábrica): igual');
SELECT pg_temp.como(4);  SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78c Chofer: igual');
SELECT pg_temp.como(12); SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78d Facturación: igual');
SELECT pg_temp.como(10); SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78e Almacén Bolsas con acceso de Ventas (asignado a una tienda): igual');
SELECT pg_temp.como(15); SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78f Ventas sin asignación: igual');
SELECT pg_temp.como(13); SELECT pg_temp.ok(pg_temp.heredado() = 't|t|t|t|tff|t', '145-78g Admin asignado a una tienda: igual');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((SELECT count(*) = 2 FROM storage.objects WHERE name LIKE '%t145-%'), '145-78h Admin sigue leyendo los archivos de mermas de todos');
SELECT pg_temp.como(5);  SELECT pg_temp.ok(pg_temp.heredado() = 'f|f|f|f|fff|f', '145-79 Empleado: conserva sus restricciones de 119');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM auditoria WHERE detalle LIKE '%T145 inventada%') = 0 AND (SELECT count(*) FROM notificaciones WHERE titulo = 'T145 falsa') = 0
  AND (SELECT NOT leida FROM notificaciones WHERE titulo = 'T145 fija') AND (SELECT count(*) = 2 FROM storage.objects WHERE name LIKE '%t145-%'), '145-79b ninguno de los intentos dejó nada escrito');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(6);

\echo '── 145: superficie de funciones — sondeo completo con un usuario de tienda'
DO $$
DECLARE
  f RECORD; v_state TEXT; v_msg TEXT; v_mal TEXT[] := '{}'; v_n INTEGER := 0; v_tot INTEGER := 0;
  v_perm TEXT[] := ARRAY[
    -- A. lo mismo que el Empleado (119): sesión, Mi asistencia, Mis actividades
    'mi_asistencia()', 'registrar_entrada(uuid,double precision,double precision,numeric)',
    'registrar_salida(uuid,double precision,double precision,numeric)', 'asistencia_empleado_actual()',
    'calendario(date,date,boolean,boolean)', 'completar_ocurrencia(uuid,bigint,date,text)',
    -- B. identidad propia (la evalúan las policies) y cálculo puro
    'erp_actor()', 'erp_actor_nombre()', 'erp_actor_etiqueta()', 'erp_es_activo()', 'erp_lector_negocio()', 'erp_rol_activo()',
    'erp_usuario_id()', 'get_my_rol()', 'get_my_user_id()', 'fin_mi_rol_activo()', 'fin_actor_permitido(text[])', 'fin_jwt_role()',
    'fin_ctx_activo()', 'fin_hoy()', 'fin_zona_negocio()', 'fin_dia_negocio(timestamp with time zone)', 'fin_es_credito(text)',
    'nomina_inicio_semana(date)', 'asistencia_distancia_m(double precision,double precision,double precision,double precision)',
    'asistencia_clasificar_entrada(timestamp with time zone,integer,timestamp with time zone)', 'b4_escritura_api()',
    'b4_asiento_de_contrato(text,text,bigint,text)', 'erp_roles_activos()', 'erp_tiene_rol(text)', 'erp_es_dueno()', 'confirmar_cambio_password()',
    -- C. 145: su alcance (sí/no sobre lo suyo) y en qué tiendas trabaja
    'erp_tienda_asignada(bigint,boolean)', 'erp_tienda_ve_cuarto(text)', 'erp_tienda_ve_orden(bigint)', 'mis_establecimientos()',
    -- D. 146 (E4): su turno abierto y las cajas de su tienda (lectura). Los 7 contratos de escritura del POS sí se sondean: sin caja ni turno propios responden 42501.
    'mi_turno_caja()',
    -- E. 148 (E7): los traspasos de SUS tiendas (lectura). Recibir, con argumentos vacíos, responde 42501 y sí se sondea.
    'traspasos_consulta(bigint,text,integer)'];
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text AS sig, p.proname, oidvectortypes(p.proargtypes) AS args
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND p.prorettype <> 'event_trigger'::regtype AND p.proname !~ '^(t_|t[0-9]+_|op3_)' ORDER BY 1 LOOP
    v_tot := v_tot + 1;
    CONTINUE WHEN f.sig = ANY (v_perm);
    v_n := v_n + 1;
    v_state := NULL;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I(%s)', f.proname,
                     (SELECT string_agg('NULL::' || t, ', ') FROM unnest(string_to_array(NULLIF(f.args, ''), ', ')) t));
      RAISE EXCEPTION 'ejecutó' USING ERRCODE = 'P0099';
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
    END;
    IF v_state <> '42501' THEN v_mal := v_mal || (f.sig || ' → ' || v_state || ' ' || left(v_msg, 60)); END IF;
  END LOOP;
  IF cardinality(v_mal) > 0 THEN RAISE EXCEPTION 'FAIL: 145-80 funciones que no rechazan al usuario de tienda: %', v_mal; END IF;
  RAISE NOTICE 'OK: 145-80 de las % funciones ejecutables por API, las % de negocio rechazan al usuario de tienda (42501), incluidos los 4 ayudantes de historia; las % restantes son identidad propia, asistencia, actividades y su alcance',
    v_tot, v_n, v_tot - v_n;
END $$;
-- Con argumentos reales, los contratos centrales que más importan.
SELECT pg_temp.falla($q$SELECT crear_orden('{"cliente_id": 14501, "metodo_pago": "Efectivo", "permitir_sin_stock": true}'::jsonb, '[{"sku": "P145-A", "cantidad": 1}]'::jsonb)$q$,
  '145-81 no crea pedidos centrales', '42501');
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(1), 14502, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-TX","cantidad":1}]'::jsonb, NULL, NULL)$q$,
  '145-82 no usa la venta directa central, ni sobre una orden y un congelador de SU tienda (su camino será el POS de E4)', '42501');
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(2), 14501, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-C1","cantidad":2}]'::jsonb, NULL, NULL)$q$,
  '145-83 …ni sobre una orden central con inventario del CEDIS', '42501');
SELECT pg_temp.falla($q$SELECT registrar_pago_orden(14501, 'Efectivo', 'T145-x', NULL)$q$, '145-84 no registra pagos de órdenes centrales', '42501');
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(3), 'CF-145-C1', 'CF-145-TX', 'P145-A', 5)$q$, '145-85 no se trae producto del CEDIS con un traspaso', '42501');
SELECT pg_temp.falla($q$SELECT ajustar_existencia_cuarto(pg_temp.op(4), 'CF-145-TX', 'P145-A', 500, 'me subo la existencia')$q$, '145-86 no ajusta la existencia de su propio congelador', '42501');
SELECT pg_temp.falla($q$SELECT registrar_merma_cuarto(pg_temp.op(5), 'CF-145-TX', 'P145-A', 1, 'Bolsa rota', NULL)$q$, '145-87 no registra mermas con el contrato central', '42501');
SELECT pg_temp.falla($q$SELECT guardar_sucursal(NULL, 14501, '{"nombre": "T145"}'::jsonb)$q$, '145-88 no crea sucursales de clientes', '42501');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '50|50|50|50|50', '145-89 ninguna existencia cambió');

\echo '── 145: mis_establecimientos'
SET LOCAL ROLE authenticated;
SELECT pg_temp.como(6);
SELECT pg_temp.ok((SELECT e = jsonb_build_array(jsonb_build_object('id', pg_temp.eid('text'), 'clave', 'TEXT145', 'nombre', 'Tienda X 145', 'tipo', 'tienda',
                     'clientes_pos', 'lista', 'vende_desde_cedis', false, 'traspasa_con_cedis', false)) AND r ->> 'perfil' = 'Ventas Tienda' AND (r -> 'tiendas_habilitadas')::boolean
                     FROM (SELECT mis_establecimientos() r) q, LATERAL (SELECT q.r -> 'establecimientos' e) x),
  '145-90 la tienda X: solo su tienda (ni el CEDIS ni las demás)');
SELECT pg_temp.como(8);
SELECT pg_temp.ok((SELECT jsonb_array_length(r) = 1 AND r -> 0 ->> 'clave' = 'TFAB145' AND (r -> 0 -> 'vende_desde_cedis')::boolean FROM (SELECT mis_establecimientos() -> 'establecimientos' r) q),
  '145-91 tienda de fábrica con permiso: su tienda, marcada con vende_desde_cedis');
SELECT pg_temp.como(11);
SELECT pg_temp.ok((SELECT NOT (r -> 0 -> 'vende_desde_cedis')::boolean FROM (SELECT mis_establecimientos() -> 'establecimientos' r) q), '145-92 en una tienda normal el permiso aparece apagado aunque esté marcado');
SELECT pg_temp.como(14);
SELECT pg_temp.ok(mis_establecimientos() -> 'establecimientos' = '[]'::jsonb, '145-93 tienda desactivada: lista vacía');
SELECT pg_temp.como(1);
SELECT pg_temp.ok((SELECT count(*) = (SELECT count(*) FROM t145_tot WHERE false) + 4 AND bool_or(e ->> 'tipo' = 'cedis') FROM jsonb_array_elements(mis_establecimientos() -> 'establecimientos') e
                    WHERE e ->> 'clave' IN ('TFAB145', 'TEXT145', 'TEYY145', 'TEIN145') OR e ->> 'tipo' = 'cedis'),
  '145-94 Admin: todos los establecimientos activos (CEDIS y las 3 tiendas activas)');
SELECT pg_temp.como(2);  SELECT pg_temp.falla($q$SELECT mis_establecimientos()$q$, '145-95 Ventas central: no autorizado', '42501');
SELECT pg_temp.como(3);  SELECT pg_temp.falla($q$SELECT mis_establecimientos()$q$, '145-96 Producción: no autorizado', '42501');
SELECT pg_temp.como(5);  SELECT pg_temp.falla($q$SELECT mis_establecimientos()$q$, '145-97 Empleado: no autorizado', '42501');

\echo '── 145: buscar_clientes_pos'
SELECT pg_temp.como(6);
INSERT INTO t145 VALUES ('b1', buscar_clientes_pos(pg_temp.eid('text'), '  abarrotes  '));
SELECT pg_temp.ok(pg_temp.ids($q$SELECT (e ->> 'id') FROM jsonb_array_elements(pg_temp.j('b1') -> 'clientes') e$q$) = '14501,14502' AND NOT (pg_temp.j('b1') -> 'hay_mas')::boolean,
  '145-100 modo lista: encuentra solo a los clientes vigentes de la lista de la tienda (ni el inactivo ni el fusionado)');
SELECT pg_temp.ok((SELECT bool_and((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(e) k) = 'id,nombre,nombre_comercial,puede_facturar')
                     FROM jsonb_array_elements(pg_temp.j('b1') -> 'clientes') e)
  AND pg_temp.j('b1')::text !~* 'ALU010203|XAXX|secreta|@t145|111\.11|9999|34000|601|G03|saldo|credito|rfc|correo|direccion',
  '145-101 de cada cliente SOLO id, nombre, nombre comercial y puede_facturar: sin RFC, domicilio, correo, CP, régimen, saldo, crédito ni límite');
SELECT pg_temp.ok((SELECT (e -> 'puede_facturar')::boolean AND e ->> 'nombre_comercial' = 'La Lupita' FROM jsonb_array_elements(pg_temp.j('b1') -> 'clientes') e WHERE e ->> 'id' = '14501')
  AND (SELECT NOT (e -> 'puede_facturar')::boolean AND e -> 'nombre_comercial' = 'null'::jsonb FROM jsonb_array_elements(pg_temp.j('b1') -> 'clientes') e WHERE e ->> 'id' = '14502'),
  '145-102 puede_facturar: sí con datos fiscales nominativos completos, no con RFC genérico');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('text'), 'la lupi') -> 'clientes' -> 0 ->> 'id' = '14501', '145-103 también busca por nombre comercial');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('text'), 'reservado') -> 'clientes' = '[]'::jsonb AND buscar_clientes_pos(pg_temp.eid('text'), 'ZETA145') -> 'clientes' = '[]'::jsonb
  AND buscar_clientes_pos(pg_temp.eid('text'), 'masivo') -> 'clientes' = '[]'::jsonb,
  '145-104 un cliente fuera de la lista de la tienda no aparece (ni por nombre ni por nombre comercial)');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('text'), 'ALU010203AB1') -> 'clientes' = '[]'::jsonb AND buscar_clientes_pos(pg_temp.eid('text'), 'lupita@t145') -> 'clientes' = '[]'::jsonb
  AND buscar_clientes_pos(pg_temp.eid('text'), 'secreta') -> 'clientes' = '[]'::jsonb,
  '145-105 no se puede buscar (ni confirmar) por RFC, correo o domicilio');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'ab')$q$, pg_temp.eid('text')), '145-106 menos de 3 letras: rechazado', '22023', '%al menos 3 letras%', 'BUSQUEDA_CORTA');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, '      a      ')$q$, pg_temp.eid('text')), '145-107 los espacios no cuentan como letras', '22023', '%', 'BUSQUEDA_CORTA');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, NULL)$q$, pg_temp.eid('text')), '145-108 sin texto: rechazado (no hay "listar todos")', '22023', '%', 'BUSQUEDA_CORTA');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('text'), '%%%') -> 'clientes' = '[]'::jsonb AND buscar_clientes_pos(pg_temp.eid('text'), '___') -> 'clientes' = '[]'::jsonb
  AND buscar_clientes_pos(pg_temp.eid('text'), 'a%s') -> 'clientes' = '[]'::jsonb,
  '145-109 % y _ no son comodines: no sirven para listar a todos');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('text'), 'en%_ra') -> 'clientes' -> 0 ->> 'id' = '14506', '145-110 …se buscan como texto literal');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'abarrotes')$q$, pg_temp.eid('teyy')), '145-111 no busca clientes a nombre de OTRA tienda', '42501');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'masivo')$q$, pg_temp.eid('tfab')), '145-112 …ni de la tienda de fábrica (que ve a todos)', '42501');
SELECT pg_temp.falla($q$SELECT buscar_clientes_pos(1, 'abarrotes')$q$, '145-113 …ni a nombre del CEDIS', '42501');
SELECT pg_temp.falla($q$SELECT buscar_clientes_pos(NULL, 'abarrotes')$q$, '145-114 sin establecimiento: no autorizado', '42501');
SELECT pg_temp.como(7);
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('teyy'), 'abarrotes') = '{"clientes": [], "hay_mas": false}'::jsonb AND buscar_clientes_pos(pg_temp.eid('teyy'), 'masivo') -> 'clientes' = '[]'::jsonb,
  '145-115 una tienda en modo lista con la lista vacía (como nace) no ve a NINGÚN cliente');
SELECT pg_temp.como(8);
INSERT INTO t145 VALUES ('b2', buscar_clientes_pos(pg_temp.eid('tfab'), 'masivo 145'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('b2') -> 'clientes') = 10 AND (pg_temp.j('b2') -> 'hay_mas')::boolean
  AND pg_temp.j('b2') -> 'clientes' -> 0 ->> 'nombre' = 'Masivo 145 01' AND pg_temp.j('b2') -> 'clientes' -> 9 ->> 'nombre' = 'Masivo 145 10',
  '145-116 modo todos: máximo 10 resultados por búsqueda, en orden, y avisa que hay más (12 coinciden)');
SELECT pg_temp.ok(buscar_clientes_pos(pg_temp.eid('tfab'), 'reservado') -> 'clientes' -> 0 ->> 'id' = '14505'
  AND buscar_clientes_pos(pg_temp.eid('tfab'), 'abarrotes inactivo') -> 'clientes' = '[]'::jsonb AND buscar_clientes_pos(pg_temp.eid('tfab'), 'abarrotes fusionado') -> 'clientes' = '[]'::jsonb,
  '145-117 modo todos: cualquier cliente vigente; nunca inactivos ni fusionados');
SELECT pg_temp.como(14);
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'masivo')$q$, pg_temp.eid('tein')), '145-118 tienda desactivada (aunque esté en modo todos): no autorizado', '42501');
SELECT pg_temp.como(2);  SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'abarrotes')$q$, pg_temp.eid('text')), '145-119 Ventas central no usa el buscador del POS', '42501');
SELECT pg_temp.como(10); SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'abarrotes')$q$, pg_temp.eid('text')), '145-120 Almacén Bolsas asignado a la tienda: tampoco (no es perfil de tienda)', '42501');
SELECT pg_temp.como(5);  SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'abarrotes')$q$, pg_temp.eid('text')), '145-121 Empleado: no autorizado', '42501');
SELECT pg_temp.como(1);
SELECT pg_temp.ok(jsonb_array_length(buscar_clientes_pos(pg_temp.eid('text'), 'abarrotes') -> 'clientes') = 2, '145-122 Admin puede consultar como cualquier tienda (mismo alcance que la tienda)');
SELECT pg_temp.falla($q$SELECT buscar_clientes_pos(1, 'abarrotes')$q$, '145-123 el CEDIS no es una tienda: rechazado también para Admin', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'masivo')$q$, pg_temp.eid('tein')), '145-124 tienda desactivada: rechazado también para Admin', '22023', '%', 'ESTABLECIMIENTO_NO_VALIDO');

\echo '── 145: precios_pos'
SELECT pg_temp.como(6);
INSERT INTO t145 VALUES ('p0', precios_pos(pg_temp.eid('text'), NULL, ARRAY['P145-A', 'P145-B', 'E145-X', 'NOEXISTE']));
SELECT pg_temp.ok(pg_temp.j('p0') -> 'precios' = '[{"sku": "P145-A", "nombre": "Hielo A145", "precio": 30.00}, {"sku": "P145-B", "nombre": "Hielo B145", "precio": 90.00}]'::jsonb,
  '145-130 sin cliente: precio de lista, solo producto terminado (sin empaques) y solo sku, nombre y precio (sin costo ni existencias)');
SELECT pg_temp.ok((SELECT count(*) >= 2 AND bool_and((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(e) k) = 'nombre,precio,sku') AND NOT bool_or(e ->> 'sku' = 'E145-X')
                     FROM jsonb_array_elements(precios_pos(pg_temp.eid('text')) -> 'precios') e), '145-131 sin lista de SKUs: todo el producto terminado');
SELECT pg_temp.ok(precios_pos(pg_temp.eid('text'), 14501, ARRAY['P145-A', 'P145-B']) -> 'precios' = '[{"sku": "P145-A", "nombre": "Hielo A145", "precio": 25.00}, {"sku": "P145-B", "nombre": "Hielo B145", "precio": 90.00}]'::jsonb,
  '145-132 con cliente: el servidor aplica su precio especial (25) y la lista donde no tiene (90)');
SELECT pg_temp.ok(precios_pos(pg_temp.eid('text'), 14502, ARRAY['P145-A']) -> 'precios' -> 0 -> 'precio' = '22.00'::jsonb, '145-133 el precio de su sucursal principal manda sobre el del cliente (22, no 24): igual que un pedido');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14505, ARRAY['P145-A'])$q$, pg_temp.eid('text')), '145-134 no consulta el precio especial de un cliente fuera de su lista', '22023', '%no está disponible%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 99999999, ARRAY['P145-A'])$q$, pg_temp.eid('text')), '145-135 …mismo rechazo si el cliente no existe (no revela si existe)', '22023', '%no está disponible%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14503, NULL)$q$, pg_temp.eid('text')), '145-136 cliente inactivo: no disponible', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14504, NULL)$q$, pg_temp.eid('text')), '145-137 cliente fusionado: no disponible', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14501, NULL)$q$, pg_temp.eid('teyy')), '145-138 no pide precios a nombre de otra tienda', '42501');
SELECT pg_temp.falla($q$SELECT precios_pos(1, NULL, NULL)$q$, '145-139 …ni a nombre del CEDIS', '42501');
SELECT pg_temp.como(7);
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, 14501, NULL)$q$, pg_temp.eid('teyy')), '145-140 la tienda Y (lista vacía) no obtiene precios de ningún cliente', '22023', '%', 'CLIENTE_NO_DISPONIBLE');
SELECT pg_temp.ok(precios_pos(pg_temp.eid('teyy'), NULL, ARRAY['P145-A']) -> 'precios' -> 0 -> 'precio' = '30.00'::jsonb, '145-141 …pero sí el precio de lista (venta al público)');
SELECT pg_temp.como(8);
SELECT pg_temp.ok(precios_pos(pg_temp.eid('tfab'), 14505, ARRAY['P145-A']) -> 'precios' -> 0 -> 'precio' = '11.00'::jsonb, '145-142 modo todos: precio especial de cualquier cliente vigente');
SELECT pg_temp.como(2);  SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, NULL, NULL)$q$, pg_temp.eid('text')), '145-143 Ventas central: no autorizado', '42501');
SELECT pg_temp.como(4);  SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, NULL, NULL)$q$, pg_temp.eid('text')), '145-144 Chofer: no autorizado', '42501');
RESET ROLE;
-- Con el interruptor apagado los contratos del POS no responden (también para Admin).
SAVEPOINT s_apagado;
SET LOCAL session_replication_role = replica;
UPDATE tiendas_activacion SET habilitada = false;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
SELECT pg_temp.falla(format($q$SELECT buscar_clientes_pos(%s, 'abarrotes')$q$, pg_temp.eid('text')), '145-145 interruptor apagado: el buscador no responde', '22023', '%no están activadas%', 'TIENDAS_NO_ACTIVADAS');
SELECT pg_temp.falla(format($q$SELECT precios_pos(%s, NULL, NULL)$q$, pg_temp.eid('text')), '145-146 interruptor apagado: los precios del POS no responden', '22023', '%no están activadas%', 'TIENDAS_NO_ACTIVADAS');
RESET ROLE;
ROLLBACK TO s_apagado;

\echo '── 145: guarda de existencias — quién SÍ mueve el inventario de una tienda'
-- matriz: actor × cuarto (ok o el código del rechazo)
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(1, 'CF-145-TX'), pg_temp.mueve(13, 'CF-145-TY'), pg_temp.mueve(1, 'CF-145-C1')) = 'ok ok ok',
  '145-150 Administración mueve cualquier cuarto (tienda o CEDIS)');
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(6, 'CF-145-TX'), pg_temp.mueve(7, 'CF-145-TY'), pg_temp.mueve(8, 'CF-145-TF'), pg_temp.mueve(9, 'CF-145-TF')) = 'ok ok ok ok',
  '145-151 el usuario de tienda mueve el congelador de SU tienda');
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(6, 'CF-145-TY'), pg_temp.mueve(7, 'CF-145-TX'), pg_temp.mueve(6, 'CF-145-TF'), pg_temp.mueve(8, 'CF-145-TX'), pg_temp.mueve(14, 'CF-145-TI'))
  = 'INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA',
  '145-152 …y NUNCA el de otra tienda (ni el de una tienda desactivada)');
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(6, 'CF-145-C1'), pg_temp.mueve(9, 'CF-145-C1'), pg_temp.mueve(11, 'CF-145-C1'), pg_temp.mueve(14, 'CF-145-C1'))
  = 'INVENTARIO_DEL_CEDIS INVENTARIO_DEL_CEDIS INVENTARIO_DEL_CEDIS INVENTARIO_DEL_CEDIS',
  '145-153 el usuario de tienda no mueve el CEDIS sin permiso (tampoco con el permiso marcado en una tienda normal o desactivada)');
SELECT pg_temp.ok(pg_temp.mueve(8, 'CF-145-C1') = 'ok', '145-154 tienda de fábrica CON permiso: sí puede mover existencia del CEDIS (D-S4)');
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(2, 'CF-145-TX'), pg_temp.mueve(15, 'CF-145-TF'), pg_temp.mueve(10, 'CF-145-TX'), pg_temp.mueve(12, 'CF-145-TX'), pg_temp.mueve(5, 'CF-145-TX'),
                             pg_temp.mueve(3, 'CF-145-TF'), pg_temp.mueve(4, 'CF-145-TX'))
  = 'INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA INVENTARIO_DE_TIENDA',
  '145-155 ningún perfil central que no sea Administración mueve un cuarto de tienda: Ventas, Almacén Bolsas (aun asignado), Facturación, Empleado, Producción, Chofer');
SELECT pg_temp.ok(concat_ws(' ', pg_temp.mueve(2, 'CF-145-C1'), pg_temp.mueve(3, 'CF-145-C1'), pg_temp.mueve(4, 'CF-145-C1'), pg_temp.mueve(10, 'CF-145-C1'), pg_temp.mueve(12, 'CF-145-C1')) = 'ok ok ok ok ok',
  '145-156 en el CEDIS la guarda no restringe a ningún perfil central (todo sigue como hoy; ahí mandan los contratos)');
UPDATE cuartos_frios SET stock = stock WHERE id = 'CF-145-TX';
SAVEPOINT s_conf; UPDATE cuartos_frios SET stock = stock || '{"P145-B": 1}'::jsonb WHERE id IN ('CF-145-TX', 'CF-145-C1'); ROLLBACK TO s_conf;
SELECT pg_temp.ok(true, '145-157 una sesión de confianza (servidor, SQL del dueño) no tiene actor que restringir');
SELECT pg_temp.ok(pg_temp.inv() = '50|50|50|50|50', '145-158 la matriz no dejó cambios');

\echo '── 145: residual de E2 cerrado — Ventas central y el congelador de una tienda'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(10), 14501, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-TX","cantidad":2}]'::jsonb, NULL, NULL)$q$,
  '145-160 Ventas central NO puede entregar su venta desde el congelador de una tienda', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.falla($q$SELECT completar_venta_directa(pg_temp.op(11), 14501, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-C1","cantidad":1},{"sku":"P145-A","cuarto_id":"CF-145-TF","cantidad":1}]'::jsonb, NULL, NULL)$q$,
  '145-161 …ni repartiendo la salida entre el CEDIS y una tienda', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '50|50|50|50|50' AND (SELECT estatus = 'Creada' FROM ordenes WHERE id = 14501) AND (SELECT count(*) FROM pagos WHERE orden_id = 14501) = 0
  AND (SELECT count(*) FROM inventario_mov WHERE producto = 'P145-A' AND referencia NOT LIKE 'T145-%' AND cuarto_id LIKE 'CF-145-%') = 0,
  '145-162 la operación completa se deshizo: sin salida, sin kardex, sin pago, la orden sigue Creada');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(2);
INSERT INTO t145 VALUES ('vd1', completar_venta_directa(pg_temp.op(12), 14501, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-C1","cantidad":2}]'::jsonb, NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '48|50|50|50|50' AND (SELECT estatus = 'Entregada' FROM ordenes WHERE id = 14501) AND (SELECT sum(monto) = 60 FROM pagos WHERE orden_id = 14501),
  '145-163 la MISMA venta desde un cuarto del CEDIS funciona como siempre (el contrato no cambió)');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t145 VALUES ('vd2', completar_venta_directa(pg_temp.op(13), 14505, 'contado', 'Efectivo', '[{"sku":"P145-A","cuarto_id":"CF-145-TX","cantidad":2}]'::jsonb, NULL, NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '48|50|50|48|50' AND (SELECT estatus = 'Entregada' FROM ordenes WHERE id = 14505), '145-164 Administración sí puede (ve y opera todos los establecimientos)');

\echo '── 145: otros contratos centrales sobre un cuarto de tienda'
SET LOCAL ROLE authenticated; SELECT pg_temp.como(3);
SELECT pg_temp.falla($q$SELECT registrar_merma_cuarto(pg_temp.op(20), 'CF-145-TX', 'P145-A', 1, 'Bolsa rota', NULL)$q$, '145-170 Producción no registra merma en el congelador de una tienda', '42501', '%es de una tienda%', 'INVENTARIO_DE_TIENDA');
SELECT pg_temp.falla($q$SELECT traspaso_cuartos(pg_temp.op(21), 'CF-145-TX', 'CF-145-TY', 'P145-A', 1)$q$, '145-171 Producción no traspasa entre tiendas', '22023|42501');
INSERT INTO t145 VALUES ('tr1', traspaso_cuartos(pg_temp.op(22), 'CF-145-C1', 'CF-145-TF', 'P145-A', 5));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '43|55|50|48|50', '145-172 el traspaso autorizado de 144 (CEDIS → tienda de fábrica, Producción con permiso) sigue funcionando');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(1);
INSERT INTO t145 VALUES ('aj1', ajustar_existencia_cuarto(pg_temp.op(23), 'CF-145-TY', 'P145-A', 49, 'Conteo de prueba 145'));
INSERT INTO t145 VALUES ('me1', registrar_merma_cuarto(pg_temp.op(24), 'CF-145-TY', 'P145-A', 1, 'Bolsa rota', NULL));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.inv() = '43|55|50|48|48', '145-173 Administración ajusta y registra merma en una tienda con los contratos de siempre');
SET LOCAL ROLE authenticated; SELECT pg_temp.como(7);
SELECT pg_temp.ok(pg_temp.ids($q$SELECT cantidad FROM inventario_mov WHERE referencia NOT LIKE 'T145-%'$q$) <> '' AND pg_temp.ids('SELECT DISTINCT cuarto_id FROM inventario_mov') = 'CF-145-TY',
  '145-174 la tienda Y ve en su kardex el ajuste y la merma de su congelador, y solo eso');
RESET ROLE;

\echo '── 145: nada quedó escrito fuera de la prueba'
SELECT pg_temp.ok((SELECT count(*) FROM auditoria WHERE detalle LIKE '%T145 inventada%') = 0 AND (SELECT count(*) FROM notificaciones WHERE titulo = 'T145 falsa') = 0
  AND (SELECT NOT leida FROM notificaciones WHERE titulo = 'T145 fija'), '145-180 los intentos del usuario de tienda no dejaron auditoría ni avisos');
ROLLBACK;
