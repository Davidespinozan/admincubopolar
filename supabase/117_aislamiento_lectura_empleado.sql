-- 117_aislamiento_lectura_empleado.sql — WF-0.1: el rol mínimo `Empleado`
-- (116) no lee por API los datos de negocio.
--
-- Causa (verificada en producción, solo lectura, 2026-10-07): 24 policies de
-- SELECT en 23 tablas tenían USING (erp_es_activo()) — "cualquier usuario
-- activo" —, así que un Empleado autenticado podía leer por REST/realtime
-- clientes, órdenes, pagos, CxC/CxP, inventario, producción, rutas, costos,
-- configuración, notificaciones, etc. La interfaz no los cargaba, pero la
-- base sí los entregaba.
--
-- Cambio mínimo: un helper `erp_lector_negocio()` = usuario activo Y rol
-- distinto de 'Empleado', y esas 24 policies pasan a usarlo (ALTER POLICY:
-- mismo nombre, comando y roles). Para Admin, Ventas, Chofer, Producción,
-- Almacén Bolsas, Facturación y Sin asignar la condición es lógicamente
-- idéntica a la anterior: su acceso no cambia. `erp_es_activo()` NO cambia
-- (lo usan también policies de INSERT/UPDATE y de storage).
--
-- Lo que el Empleado conserva: su perfil (`usuarios.self_read`), su asistencia
-- (policies de 116 y contratos SECURITY DEFINER) y, con 118, solo las
-- actividades que le asignen.
--
-- Precondición (falla cerrada): cada policy listada existe con USING
-- (erp_es_activo()) o ya con (erp_lector_negocio()) — reaplicar es inocuo.
--
-- Reversión: ALTER POLICY … USING (erp_es_activo()) en las mismas 24 y DROP
-- FUNCTION erp_lector_negocio() (reabre la lectura amplia del Empleado).

CREATE OR REPLACE FUNCTION public.erp_lector_negocio() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(erp_rol_activo() IS NOT NULL AND erp_rol_activo() <> 'Empleado', false)
$$;
REVOKE ALL ON FUNCTION public.erp_lector_negocio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_lector_negocio() TO authenticated, service_role;

DO $$
DECLARE
  v_lista CONSTANT TEXT[][] := ARRAY[
    ['camiones', 'read_all'], ['cierres_diarios', 'read_all_cierres'], ['clientes', 'read_all'],
    ['comodatos', 'read_all'], ['configuracion_empresa', 'read_all'], ['costos_empaque_historial', 'costos_empaque_historial_read'],
    ['costos_fijos', 'costos_fijos_read'], ['costos_historial', 'costos_historial_read'], ['cuartos_frios', 'read_all'],
    ['cuentas_por_cobrar', 'read_all'], ['cuentas_por_pagar', 'cxp_read'], ['devoluciones', 'read_all_devoluciones'],
    ['inventario_mov', 'read_all'], ['notificaciones', 'read_all'], ['orden_lineas', 'read_all'],
    ['ordenes', 'read_all'], ['pagos', 'read_all'], ['pagos_proveedores', 'pagos_prov_read'],
    ['precios_esp', 'read_all'], ['produccion', 'read_all'], ['productos', 'read_all'],
    ['rutas', 'read_all'], ['stock_operaciones', 'read_all'], ['umbrales', 'read_all']];
  v_qual TEXT;
  v_cmd  TEXT;
  i      INTEGER;
BEGIN
  FOR i IN 1 .. array_length(v_lista, 1) LOOP
    SELECT p.qual, p.cmd INTO v_qual, v_cmd FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = v_lista[i][1] AND p.policyname = v_lista[i][2];
    IF NOT FOUND THEN
      RAISE EXCEPTION '117: falta la policy %.%', v_lista[i][1], v_lista[i][2];
    END IF;
    IF v_cmd <> 'SELECT' OR v_qual NOT IN ('erp_es_activo()', 'erp_lector_negocio()') THEN
      RAISE EXCEPTION '117: la policy %.% no es la esperada (% / %)', v_lista[i][1], v_lista[i][2], v_cmd, v_qual;
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I USING (erp_lector_negocio())', v_lista[i][2], v_lista[i][1]);
  END LOOP;
END $$;
