-- 058_rpc_update_orden_atomic.sql
-- RPC atómica para editar una orden y reemplazar sus líneas en una sola
-- transacción. Cubre el bug histórico donde updateOrden hacía
-- `DELETE orden_lineas` seguido de `INSERT lineas` sin transacción —
-- si el INSERT fallaba a la mitad, la orden quedaba sin líneas (estado
-- inválido, total ya actualizado).
--
-- La RPC valida estatus = 'Creada' (FOR UPDATE) y aplica solo las
-- columnas que vengan en p_update_fields (jsonb_each_text, dynamic SQL
-- evitado preservando whitelist explícita). Si p_lineas es array no
-- vacío, hace DELETE + INSERT atómicos en la misma transacción.
--
-- Validaciones JS-only (cuya complejidad no justifica replicar en SQL):
--   - "ruta tiene carga_confirmada_at" (validateEdicionOrden con 2do arg)
--   - construcción de líneas (buildLineas con productos + precios_esp)
-- Esas siguen ocurriendo en el caller antes de invocar la RPC.

CREATE OR REPLACE FUNCTION update_orden_atomic(
  p_orden_id      BIGINT,
  p_update_fields JSONB,
  p_lineas        JSONB
) RETURNS JSONB AS $$
DECLARE
  v_estatus_actual TEXT;
  v_count_lineas   INTEGER := 0;
BEGIN
  -- 1. Lock + validar estatus
  SELECT estatus INTO v_estatus_actual
    FROM ordenes
   WHERE id = p_orden_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden % no existe', p_orden_id;
  END IF;

  IF v_estatus_actual <> 'Creada' THEN
    RAISE EXCEPTION 'Solo se pueden editar órdenes en estatus Creada (actual: %)', v_estatus_actual;
  END IF;

  -- 2. Aplicar campos del payload. Whitelist explícita: solo las columnas
  --    que `buildUpdateFieldsOrden` (ordenLogic.js) puede emitir. Si llega
  --    otra clave, se ignora silenciosamente (no se refleja como error
  --    porque el caller la podría haber agregado por accidente).
  IF p_update_fields IS NOT NULL AND jsonb_typeof(p_update_fields) = 'object' THEN
    UPDATE ordenes SET
      cliente_nombre      = COALESCE(p_update_fields->>'cliente_nombre',      cliente_nombre),
      cliente_id          = COALESCE((p_update_fields->>'cliente_id')::bigint, cliente_id),
      fecha               = COALESCE((p_update_fields->>'fecha')::date,       fecha),
      tipo_cobro          = COALESCE(p_update_fields->>'tipo_cobro',          tipo_cobro),
      folio_nota          = CASE WHEN p_update_fields ? 'folio_nota'
                                 THEN p_update_fields->>'folio_nota'
                                 ELSE folio_nota END,
      direccion_entrega   = CASE WHEN p_update_fields ? 'direccion_entrega'
                                 THEN p_update_fields->>'direccion_entrega'
                                 ELSE direccion_entrega END,
      referencia_entrega  = CASE WHEN p_update_fields ? 'referencia_entrega'
                                 THEN p_update_fields->>'referencia_entrega'
                                 ELSE referencia_entrega END,
      latitud_entrega     = CASE WHEN p_update_fields ? 'latitud_entrega'
                                 THEN NULLIF(p_update_fields->>'latitud_entrega', '')::numeric
                                 ELSE latitud_entrega END,
      longitud_entrega    = CASE WHEN p_update_fields ? 'longitud_entrega'
                                 THEN NULLIF(p_update_fields->>'longitud_entrega', '')::numeric
                                 ELSE longitud_entrega END,
      total               = COALESCE((p_update_fields->>'total')::numeric,    total),
      productos           = COALESCE(p_update_fields->>'productos',           productos),
      updated_at          = NOW()
    WHERE id = p_orden_id;
  END IF;

  -- 3. Reemplazo atómico de líneas (DELETE + INSERT en la misma TX)
  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' THEN
    DELETE FROM orden_lineas WHERE orden_id = p_orden_id;

    IF jsonb_array_length(p_lineas) > 0 THEN
      INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
      SELECT
        p_orden_id,
        e->>'sku',
        (e->>'cantidad')::int,
        (e->>'precio_unit')::numeric,
        (e->>'subtotal')::numeric
      FROM jsonb_array_elements(p_lineas) AS e;

      GET DIAGNOSTICS v_count_lineas = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lineas_insertadas', v_count_lineas
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_orden_atomic(BIGINT, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION update_orden_atomic IS
  'Edita una orden y reemplaza sus líneas atómicamente. Valida estatus=Creada con FOR UPDATE. Whitelist de columnas: cliente_nombre, cliente_id, fecha, tipo_cobro, folio_nota, direccion/referencia/latitud/longitud_entrega, total, productos. Las claves no listadas se ignoran. Si p_lineas es array (vacío o con elementos), reemplaza todas las orden_lineas; si es null, no toca líneas.';
