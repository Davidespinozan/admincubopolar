-- catalogo_huella.sql — SOLO LECTURA. Huella completa del catálogo de producción
-- (esquema public): roles, tablas/vistas con RLS y privilegios, grants de columna,
-- secuencias, privilegios por defecto, funciones (definición + md5 + EXECUTE),
-- triggers, policies, vistas, esquemas, extensiones, conteos y huellas md5 de las
-- tablas de negocio (clave `fp`). Un solo SELECT; no escribe nada.
-- Uso: comparar el resultado ANTES y DESPUÉS de una activación (ignorar `now`).
-- La diferencia debe ser exactamente los objetos de la fase. Ver README.md.
-- Origen: consulta de verificación usada desde B4 (090); recuperada sin cambios.
SELECT jsonb_build_object(
 'roles', (SELECT jsonb_agg(jsonb_build_object('r', rolname, 'login', rolcanlogin, 'super', rolsuper, 'bypass', rolbypassrls, 'inherit', rolinherit, 'createrole', rolcreaterole,
     'member_of', (SELECT jsonb_agg(b.rolname) FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid WHERE m.member = r.oid)) ORDER BY rolname)
   FROM pg_roles r WHERE rolname IN ('anon','authenticated','service_role','postgres','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','dashboard_user','pgbouncer','supabase_realtime_admin','supabase_replication_admin','supabase_read_only_user','supabase_etl_admin') OR rolname NOT LIKE 'pg\_%'),
 'rels', (SELECT jsonb_agg(jsonb_build_object('n', c.relname, 'k', c.relkind, 'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity, 'opts', c.reloptions,
     'pol', (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname),
     'acl', (SELECT jsonb_object_agg(g, (SELECT string_agg(pr, '' ORDER BY pr) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr WHERE has_table_privilege(g, c.oid, pr)))
             FROM unnest(ARRAY['anon','authenticated','service_role']) g),
     'pub', (SELECT string_agg(a.privilege_type, ',') FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0),
     'trig', (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)) ORDER BY c.relname)
   FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p','f')),
 'colgrants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'g', grantee, 'p', privilege_type)), '[]') FROM information_schema.column_privileges cp
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC','service_role')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_privileges tp WHERE tp.table_schema = 'public' AND tp.table_name = cp.table_name AND tp.grantee = cp.grantee AND tp.privilege_type = cp.privilege_type)),
 'seqs', (SELECT jsonb_agg(jsonb_build_object('s', c.relname, 'owner', pg_get_userbyid(c.relowner), 'last', (SELECT last_value FROM pg_sequences ps WHERE ps.schemaname='public' AND ps.sequencename=c.relname),
     'acl', (SELECT jsonb_object_agg(g, (SELECT string_agg(pr, ',') FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) pr WHERE has_sequence_privilege(g, c.oid, pr))) FROM unnest(ARRAY['anon','authenticated','service_role']) g),
     'owned_by', (SELECT d.refobjid::regclass::text || '.' || a.attname FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid WHERE d.objid = c.oid AND d.deptype IN ('a','i') LIMIT 1)) ORDER BY c.relname)
   FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'),
 'defacl', (SELECT jsonb_agg(jsonb_build_object('owner', pg_get_userbyid(defaclrole), 'schema', COALESCE(defaclnamespace::regnamespace::text, '(global)'), 'type', defaclobjtype, 'acl', defaclacl::text)) FROM pg_default_acl),
 'funcs', (SELECT jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'name', p.proname, 'kind', p.prokind, 'owner', pg_get_userbyid(p.proowner), 'sd', p.prosecdef, 'vol', p.provolatile, 'cfg', array_to_string(p.proconfig, ';'),
     'ret', format_type(p.prorettype, NULL), 'lang', l.lanname,
     'pub', EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'svc', has_function_privilege('service_role', p.oid, 'EXECUTE'),
     'md5', md5(pg_get_functiondef(p.oid)), 'def', CASE WHEN l.lanname IN ('plpgsql','sql') AND p.prokind = 'f' THEN pg_get_functiondef(p.oid) END) ORDER BY p.proname)
   FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.pronamespace = 'public'::regnamespace),
 'evtrig', (SELECT COALESCE(jsonb_agg(jsonb_build_object('n', evtname, 'ev', evtevent, 'f', evtfoid::regprocedure::text, 'enabled', evtenabled, 'owner', pg_get_userbyid(evtowner))), '[]') FROM pg_event_trigger),
 'triggers', (SELECT jsonb_agg(jsonb_build_object('t', tgrelid::regclass::text, 'n', tgname, 'f', tgfoid::regprocedure::text, 'def', pg_get_triggerdef(oid))) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE '%.%'),
 'policies', (SELECT jsonb_agg(jsonb_build_object('t', tablename, 'p', policyname, 'cmd', cmd, 'roles', roles::text, 'perm', permissive, 'qual', qual, 'chk', with_check) ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'public'),
 'views', (SELECT COALESCE(jsonb_agg(jsonb_build_object('v', c.relname, 'owner', pg_get_userbyid(c.relowner), 'opts', c.reloptions, 'def', pg_get_viewdef(c.oid))), '[]') FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m')),
 'schemas', (SELECT jsonb_agg(jsonb_build_object('s', nspname, 'owner', pg_get_userbyid(nspowner),
     'create', jsonb_build_object('public', EXISTS (SELECT 1 FROM aclexplode(COALESCE(nspacl, acldefault('n', nspowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'CREATE'), 'anon', has_schema_privilege('anon', oid, 'CREATE'), 'authenticated', has_schema_privilege('authenticated', oid, 'CREATE'), 'service_role', has_schema_privilege('service_role', oid, 'CREATE')),
     'usage', jsonb_build_object('anon', has_schema_privilege('anon', oid, 'USAGE'), 'authenticated', has_schema_privilege('authenticated', oid, 'USAGE'))) ORDER BY nspname)
   FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'),
 'ext', (SELECT jsonb_agg(jsonb_build_object('e', extname, 'schema', extnamespace::regnamespace::text, 'v', extversion)) FROM pg_extension),
 'counts', jsonb_build_object('policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'), 'funcs', (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace),
   'tables', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')), 'seqs', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='S'),
   'views', (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('v','m'))),
 'fp', jsonb_build_object(
    'ordenes', (SELECT md5(string_agg(concat_ws(':', id, folio, estatus, ruta_id, total, metodo_pago, tipo_cobro, vendedor_id, cliente_id), '|' ORDER BY id)) FROM ordenes),
    'orden_lineas', (SELECT md5(string_agg(concat_ws(':', id, orden_id, sku, cantidad, precio_unit, subtotal), '|' ORDER BY id)) FROM orden_lineas),
    'pagos', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, orden_id, monto, metodo_pago, referencia, usuario_id), '|' ORDER BY id), '')) FROM pagos),
    'cxc', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, orden_id, monto_original, saldo_pendiente, estatus), '|' ORDER BY id), '')) FROM cuentas_por_cobrar),
    'movimientos', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, tipo, categoria, monto, orden_id, usuario_id), '|' ORDER BY id), '')) FROM movimientos_contables),
    'clientes', (SELECT md5(string_agg(concat_ws(':', id, nombre, saldo, credito_autorizado, limite_credito), '|' ORDER BY id)) FROM clientes),
    'productos', (SELECT md5(string_agg(concat_ws(':', sku, precio, stock, tipo), '|' ORDER BY sku)) FROM productos),
    'cuartos', (SELECT md5(string_agg(id || '=' || stock::text, '|' ORDER BY id)) FROM cuartos_frios),
    'kardex', (SELECT md5(string_agg(concat_ws(':', id, tipo, producto, cantidad, cuarto_id, ruta_id, operacion_id), '|' ORDER BY id)) FROM inventario_mov),
    'rutas', (SELECT md5(string_agg((to_jsonb(r) - 'updated_at')::text, '|' ORDER BY id)) FROM rutas r),
    'stock_operaciones', (SELECT count(*) FROM stock_operaciones), 'cierres', (SELECT count(*) FROM cierres_financieros_ruta)),
 'error_log_max', (SELECT max(id) FROM error_log), 'now', now()) AS r;
