-- 057_rpc_asignar_ordenes_ruta.sql
-- Bloque urgente Rutas. Cubre:
--   1. RPC atómica para asignar órdenes a una ruta sin riesgo de
--      inconsistencia parcial (bug histórico OV-0078 stuck en Creada
--      con ruta_id, fix dfc8b12 fue parcial).
--   2. DROP del trigger zombie `trg_ruta_state` de 001_schema.sql que
--      bloquearía transiciones modernas (Programada→Cargada, Cargada→
--      En progreso, etc.) si alguien aplica el schema en BD nueva.
--      La FSM de rutas se valida en JS (rutasLogic.js) y no se necesita
--      enforcement en BD.

-- ─────────────────────────────────────────────────────────────────
-- PASO 1: Limpieza del trigger zombie de FSM de rutas
-- ─────────────────────────────────────────────────────────────────
-- Solo permitía:
--   Programada → En progreso/Cancelada
--   En progreso → Completada
--   Completada → Cerrada
-- El código moderno (post-Fase 18) hace:
--   Programada → Cargada / Pendiente firma
--   Pendiente firma → Cargada
--   Cargada → En progreso
--   En progreso → Cerrada (saltando Completada)
-- Producción no tiene el trigger activo (se quedó en limbo tras mig 002),
-- pero un clone del repo + CREATE desde 001_schema.sql lo activaría y
-- rompería todas las operaciones de ruta.

DROP TRIGGER IF EXISTS trg_ruta_state ON rutas;
DROP FUNCTION IF EXISTS check_ruta_transition();

-- ─────────────────────────────────────────────────────────────────
-- PASO 2: RPC atómica para asignación de órdenes a ruta
-- ─────────────────────────────────────────────────────────────────
-- Reemplaza el patrón de 3 UPDATEs secuenciales sin transacción que
-- vivía en supaStore.asignarOrdenesARuta. Acepta órdenes ya asignadas
-- a la misma ruta (idempotencia para flujo de edición), rechaza si
-- están en otra ruta o en estado terminal.
--
-- Estados aceptados: 'Creada' (nueva asignación), 'Asignada' (ya estaba
-- en esta ruta, idempotente — el UPDATE no las modifica). Cualquier otro
-- estado (Entregada, Facturada, Cancelada, En ruta) → RAISE.

CREATE OR REPLACE FUNCTION asignar_ordenes_a_ruta(
  p_ruta_id   BIGINT,
  p_orden_ids BIGINT[]
) RETURNS JSONB AS $$
DECLARE
  v_orden_id      BIGINT;
  v_ord           RECORD;
  v_carga         JSONB := '{}'::jsonb;
  v_linea         RECORD;
  v_count_updated INTEGER := 0;
BEGIN
  -- 1. Validar la ruta: existe y NO está cerrada/completada/cancelada
  IF NOT EXISTS (
    SELECT 1 FROM rutas
     WHERE id = p_ruta_id
       AND estatus NOT IN ('Cerrada', 'Cancelada', 'Completada')
  ) THEN
    RAISE EXCEPTION 'Ruta % no existe o ya está cerrada/completada/cancelada', p_ruta_id;
  END IF;

  -- 2. Validar cada orden: o es nueva (Creada sin ruta) o ya estaba
  --    asignada a esta misma ruta (idempotencia). Cualquier otro caso
  --    (otra ruta, estado terminal) hace RAISE y aborta toda la operación.
  FOREACH v_orden_id IN ARRAY p_orden_ids LOOP
    SELECT estatus, ruta_id INTO v_ord
      FROM ordenes
     WHERE id = v_orden_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Orden % no existe', v_orden_id;
    END IF;
    -- Caso 1: Creada sin ruta → asignable
    -- Caso 2: Asignada con ruta = p_ruta_id → idempotente
    -- Otros → rechazar
    IF NOT (
      (v_ord.estatus = 'Creada' AND v_ord.ruta_id IS NULL)
      OR (v_ord.estatus = 'Asignada' AND v_ord.ruta_id = p_ruta_id)
    ) THEN
      RAISE EXCEPTION 'Orden % no es asignable (estatus=%, ruta_id=%)',
        v_orden_id, v_ord.estatus, COALESCE(v_ord.ruta_id::text, 'NULL');
    END IF;
  END LOOP;

  -- 3. UPDATE atómico: ruta_id + estatus en una sola operación.
  --    Solo afecta las que cambian (las idempotentes ya tenían los
  --    valores correctos).
  UPDATE ordenes
     SET ruta_id    = p_ruta_id,
         estatus    = 'Asignada',
         updated_at = NOW()
   WHERE id = ANY(p_orden_ids)
     AND (ruta_id IS NULL OR estatus = 'Creada');
  GET DIAGNOSTICS v_count_updated = ROW_COUNT;

  -- 4. Calcular carga sumando líneas por SKU de TODAS las órdenes
  --    asignadas a esta ruta (no solo las nuevas — la carga es el total).
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

  -- 5. Reemplazar la carga total de la ruta con el agregado calculado.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION asignar_ordenes_a_ruta(BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION asignar_ordenes_a_ruta IS
  'Asigna órdenes a una ruta atómicamente. Acepta órdenes Creada (sin ruta) o ya Asignadas a la misma ruta (idempotente). RAISE si están en otra ruta o estado terminal. Recalcula la carga JSONB de la ruta sumando líneas.';
