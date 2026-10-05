-- conteos.sql — SOLO LECTURA. Revisión rápida (un SELECT, sin escrituras):
-- conteos del catálogo, exposición de la API y centinelas de datos. Sirve para
-- detectar en segundos si docs/STATUS.md está desactualizado respecto de producción.
-- Escrita en la reestructura de contexto (2026-10-05); no es una consulta histórica.
SELECT jsonb_build_object(
 'conteos', jsonb_build_object(
   'funciones', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace),
   'policies',  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
   'tablas',    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')),
   'secuencias',(SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'),
   'vistas',    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v','m'))),
 'exposicion', jsonb_build_object(
   'funciones_ejecutables_por_anon', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname <> 'rls_auto_enable' AND has_function_privilege('anon', p.oid, 'EXECUTE')),
   'tablas_con_acceso_anon', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m')
        AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))),
   'tablas_sin_rls', (SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]') FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
   'security_definer_sin_search_path', (SELECT COALESCE(jsonb_agg(p.oid::regprocedure::text ORDER BY p.proname), '[]') FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND COALESCE(array_to_string(p.proconfig, ';'), '') !~ 'search_path=')),
 'centinelas', jsonb_build_object(
   'error_log_max', (SELECT max(id) FROM error_log),
   'ov0086_md5', (SELECT md5(row_to_json(o)::text) FROM ordenes o WHERE folio = 'OV-0086'),
   'cuartos', (SELECT jsonb_object_agg(id, stock) FROM cuartos_frios),
   'empaque', (SELECT jsonb_object_agg(sku, jsonb_build_object('existencia', stock, 'costo_promedio', costo_unitario)) FROM productos WHERE tipo = 'Empaque'),
   'zona_negocio', fin_zona_negocio(), 'hoy_negocio', fin_hoy()),
 'filas', jsonb_build_object(
   'ordenes', (SELECT count(*) FROM ordenes), 'pagos', (SELECT count(*) FROM pagos),
   'cxc', (SELECT count(*) FROM cuentas_por_cobrar), 'cxp', (SELECT count(*) FROM cuentas_por_pagar),
   'movimientos_contables', (SELECT count(*) FROM movimientos_contables), 'costos_historial', (SELECT count(*) FROM costos_historial),
   'kardex', (SELECT count(*) FROM inventario_mov), 'stock_operaciones', (SELECT count(*) FROM stock_operaciones),
   'produccion', (SELECT count(*) FROM produccion), 'mermas', (SELECT count(*) FROM mermas),
   'devoluciones', (SELECT count(*) FROM devoluciones), 'nomina_periodos', (SELECT count(*) FROM nomina_periodos),
   'costos_empaque_historial', (SELECT count(*) FROM costos_empaque_historial), 'cierres_diarios', (SELECT count(*) FROM cierres_diarios))
) AS r;
