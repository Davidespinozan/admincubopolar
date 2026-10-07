-- 119_cierre_api_empleado.sql — WF-0.2: cierre de la superficie de API del rol
-- mínimo `Empleado` (116). Después de 117 (lectura) quedaban, verificado en
-- producción en solo lectura el 2026-10-07:
--
--   A. Escritura directa por policies con erp_es_activo() ("cualquier usuario
--      activo"): INSERT en `auditoria` (insert_all), INSERT y UPDATE en
--      `notificaciones` (insert_all, notificaciones_update_activo) y subir,
--      leer y borrar en su carpeta del bucket `mermas` (3 policies de
--      storage.objects). Esas 6 policies son los ÚNICOS consumidores de
--      erp_es_activo() (sin funciones ni frontend). Las de storage.objects no
--      se pueden alterar desde una migración (dueño supabase_storage_admin).
--   B. Cuatro helpers SECURITY DEFINER sin control de rol que responden sí/no
--      sobre historia del negocio: b4_ruta_con_historia, cuarto_tiene_historia,
--      empaque_tiene_dependencias, erp_foto_merma_en_uso. Se usan en triggers
--      de protección (borrado de rutas, cuartos y empaques), en la policy de
--      borrado de mermas y dentro de contratos: su EXECUTE para authenticated
--      se conserva (quitarlo rompería a Admin).
--
-- Cambio mínimo:
--   1. erp_es_activo() = usuario activo Y rol distinto de 'Empleado' (misma
--      definición que erp_lector_negocio de 117). Para Admin, Ventas, Chofer,
--      Producción, Almacén Bolsas, Facturación y Sin asignar el valor no
--      cambia; las 6 policies NO se tocan (mismo texto) y dejan de valer para
--      el Empleado.
--   2. erp_exigir_no_empleado(fn): rechaza (42501) solo al rol Empleado; los 4
--      helpers lo llaman antes de su cuerpo, que queda idéntico.
--
-- Los contratos SECURITY DEFINER escriben `auditoria` como dueño (sin RLS):
-- la auditoría de asistencia y calendario sigue igual. Todos los demás
-- contratos de negocio ya rechazan al Empleado (fin_actor_permitido / rol).
--
-- Reversión: erp_es_activo() de 071 (SELECT erp_rol_activo() IS NOT NULL) y
-- los 4 helpers sin la primera sentencia; DROP FUNCTION erp_exigir_no_empleado.

BEGIN;

CREATE OR REPLACE FUNCTION public.erp_es_activo() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT erp_rol_activo() IS NOT NULL AND erp_rol_activo() <> 'Empleado'
$$;

CREATE OR REPLACE FUNCTION public.erp_exigir_no_empleado(p_fn TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF erp_rol_activo() = 'Empleado' THEN
    RAISE EXCEPTION '%: no autorizado', p_fn USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erp_exigir_no_empleado(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_exigir_no_empleado(TEXT) TO service_role;

-- Cuerpos idénticos a producción (md5 verificados antes de 119), con la guarda primero.
CREATE OR REPLACE FUNCTION public.b4_ruta_con_historia(p_ruta_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_exigir_no_empleado('b4_ruta_con_historia');
  SELECT EXISTS (SELECT 1 FROM rutas WHERE id = p_ruta_id AND (carga_confirmada_at IS NOT NULL OR estatus IN ('Cargada', 'En progreso', 'Cerrada')))
      OR EXISTS (SELECT 1 FROM stock_operaciones WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM inventario_mov WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM mermas WHERE ruta_id = p_ruta_id)
$function$;

CREATE OR REPLACE FUNCTION public.cuarto_tiene_historia(p_cuarto_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_exigir_no_empleado('cuarto_tiene_historia');
  SELECT EXISTS (SELECT 1 FROM inventario_mov WHERE cuarto_id = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM produccion WHERE cuarto_id = p_cuarto_id OR destino = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM mermas_efectos WHERE cuarto_id = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM devoluciones WHERE cuarto_destino = p_cuarto_id)
$function$;

CREATE OR REPLACE FUNCTION public.empaque_tiene_dependencias(p_id bigint, p_sku text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_exigir_no_empleado('empaque_tiene_dependencias');
  SELECT EXISTS (SELECT 1 FROM productos WHERE empaque_sku = p_sku)
      OR EXISTS (SELECT 1 FROM produccion WHERE empaque_sku = p_sku)
      OR EXISTS (SELECT 1 FROM inventario_mov WHERE producto = p_sku)
      -- Historia de costo: compras, reversos o una apertura declarada (106).
      -- La apertura en ceros de un empaque recién creado no cuenta.
      OR EXISTS (SELECT 1 FROM costos_empaque_historial
                  WHERE producto_id = p_id AND (evento <> 'Apertura' OR cantidad_nueva <> 0 OR costo_nuevo <> 0))
$function$;

CREATE OR REPLACE FUNCTION public.erp_foto_merma_en_uso(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_exigir_no_empleado('erp_foto_merma_en_uso');
  SELECT COALESCE(p_name, '') <> '' AND EXISTS (SELECT 1 FROM mermas WHERE foto_url = p_name)
$function$;

COMMIT;
