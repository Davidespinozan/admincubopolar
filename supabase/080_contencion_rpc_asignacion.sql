-- 080_contencion_rpc_asignacion.sql — B3 / R1: contención de las RPCs de
-- asignación de órdenes (asignar_orden, asignar_ordenes_a_ruta,
-- cancelar_orden_asignada).
--
-- Hasta 079 las tres eran SECURITY DEFINER sin comprobación de actor y sin
-- search_path fijo, ejecutables por cualquier JWT `authenticated` (incluidos
-- perfiles inactivos y JWT sin perfil): cualquiera podía mover una orden
-- Creada a cualquier ruta y reescribir rutas.carga (auditoría B3 residual,
-- probado en paridad local).
--
-- Callers reales (auditoría de 080):
--   asignar_orden(id, NULL, uid)   OrdenesView (shell Admin) y VentasStandaloneView
--                                  ("Enviar a ruta"): Creada → Asignada SIN ruta.
--   asignar_ordenes_a_ruta         RutasView (shell Admin): crear/editar ruta y
--                                  modal "+ Órdenes". Solo Admin.
--   cancelar_orden_asignada        cancelarOrden (requireRol Admin) →
--                                  updateOrdenEstatus('Cancelada') con orden Asignada.
--
-- Cambios (solo autorización + search_path; cuerpos de producción intactos):
--   asignar_orden            actor activo Admin o Ventas (fin_actor_permitido, 071);
--                            si el actor no es Admin, p_ruta_id debe ser NULL.
--   asignar_ordenes_a_ruta   actor activo Admin.
--   cancelar_orden_asignada  actor activo Admin (ordenes_guard_financiero ya lo
--                            exigía en la práctica; ahora es explícito).
--   EXECUTE: PUBLIC y anon fuera; authenticated y service_role se conservan.
-- Se conservan tal cual: validaciones de estado y de ruta, recálculo de carga,
-- el trigger ordenes_guard_financiero (sigue evaluándose dentro de la RPC),
-- el retorno, los errores existentes y la atribución p_usuario_id (solo
-- forense: nunca decide autorización). Idempotente.

CREATE OR REPLACE FUNCTION asignar_orden(p_orden_id BIGINT, p_ruta_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'asignar_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  -- Ventas solo marca "Asignada" sin ruta; la ruta concreta la decide Admin.
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo()
     AND COALESCE(fin_mi_rol_activo(), '') <> 'Admin' AND p_ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'asignar_orden: solo Admin asigna una orden a una ruta concreta' USING ERRCODE = '42501';
  END IF;
  UPDATE ordenes SET estatus = 'Asignada', ruta_id = p_ruta_id WHERE id = p_orden_id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Asignar', 'Órdenes', 'Orden #' || p_orden_id);
END;
$$;

CREATE OR REPLACE FUNCTION cancelar_orden_asignada(p_orden_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'cancelar_orden_asignada: no autorizado' USING ERRCODE = '42501';
  END IF;
  UPDATE ordenes SET estatus = 'Creada', ruta_id = NULL WHERE id = p_orden_id AND estatus = 'Asignada';
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Cancelar asignación', 'Órdenes', 'Orden #' || p_orden_id);
END;
$$;

CREATE OR REPLACE FUNCTION asignar_ordenes_a_ruta(p_ruta_id BIGINT, p_orden_ids BIGINT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_orden_id      BIGINT;
  v_ord           RECORD;
  v_carga         JSONB := '{}'::jsonb;
  v_linea         RECORD;
  v_count_updated INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'asignar_ordenes_a_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;

  -- 1. Validar la ruta: existe y NO está cerrada/completada/cancelada
  IF NOT EXISTS (
    SELECT 1 FROM rutas
     WHERE id = p_ruta_id
       AND estatus NOT IN ('Cerrada', 'Cancelada', 'Completada')
  ) THEN
    RAISE EXCEPTION 'Ruta % no existe o ya está cerrada/completada/cancelada', p_ruta_id;
  END IF;

  -- 2. Validar cada orden: nueva (Creada sin ruta) o idempotente (ya en esta ruta).
  FOREACH v_orden_id IN ARRAY p_orden_ids LOOP
    SELECT estatus, ruta_id INTO v_ord
      FROM ordenes
     WHERE id = v_orden_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Orden % no existe', v_orden_id;
    END IF;
    IF NOT (
      (v_ord.estatus = 'Creada' AND v_ord.ruta_id IS NULL)
      OR (v_ord.estatus = 'Asignada' AND v_ord.ruta_id = p_ruta_id)
    ) THEN
      RAISE EXCEPTION 'Orden % no es asignable (estatus=%, ruta_id=%)',
        v_orden_id, v_ord.estatus, COALESCE(v_ord.ruta_id::text, 'NULL');
    END IF;
  END LOOP;

  -- 3. UPDATE atómico: solo afecta las que cambian.
  UPDATE ordenes
     SET ruta_id    = p_ruta_id,
         estatus    = 'Asignada',
         updated_at = NOW()
   WHERE id = ANY(p_orden_ids)
     AND (ruta_id IS NULL OR estatus = 'Creada');
  GET DIAGNOSTICS v_count_updated = ROW_COUNT;

  -- 4. Calcular carga sumando líneas por SKU de TODAS las órdenes de la ruta.
  FOR v_linea IN
    SELECT ol.sku, SUM(ol.cantidad)::int AS total
      FROM orden_lineas ol
      JOIN ordenes o ON o.id = ol.orden_id
     WHERE o.ruta_id = p_ruta_id
       AND o.estatus = 'Asignada'
     GROUP BY ol.sku
  LOOP
    v_carga := jsonb_set(v_carga, ARRAY[v_linea.sku], to_jsonb(v_linea.total));
  END LOOP;

  -- 5. Actualizar carga total de la ruta.
  UPDATE rutas
     SET carga      = v_carga,
         updated_at = NOW()
   WHERE id = p_ruta_id;

  RETURN jsonb_build_object(
    'success', true,
    'ordenes_asignadas', v_count_updated,
    'carga', v_carga
  );
END;
$$;

REVOKE ALL ON FUNCTION asignar_orden(BIGINT, BIGINT, BIGINT)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cancelar_orden_asignada(BIGINT, BIGINT)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION asignar_ordenes_a_ruta(BIGINT, BIGINT[])        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION asignar_orden(BIGINT, BIGINT, BIGINT)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancelar_orden_asignada(BIGINT, BIGINT)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION asignar_ordenes_a_ruta(BIGINT, BIGINT[])     TO authenticated, service_role;
