-- MIGRACIÓN 020: Corregir update_stocks_atomic — columnas incorrectas en inventario_mov
-- La versión anterior usaba "producto" y "usuario" que no existen.
-- La tabla real usa "sku" y "usuario_id" (BIGINT).

CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB AS $$
DECLARE
  change     JSONB;
  v_cuarto_id BIGINT;
  v_sku       TEXT;
  v_delta     INT;
  v_tipo      tipo_movimiento;
  v_origen    TEXT;
  v_updated   INT := 0;
BEGIN
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := (change->>'cuarto_id')::BIGINT;
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INT;
    v_tipo      := COALESCE(change->>'tipo', 'Salida')::tipo_movimiento;
    v_origen    := COALESCE(change->>'origen', 'Sistema');

    -- Actualizar stock en cuarto frío (JSONB)
    UPDATE cuartos_frios
    SET stock = jsonb_set(
      COALESCE(stock, '{}'::jsonb),
      ARRAY[v_sku],
      to_jsonb(GREATEST(0, COALESCE((stock->>v_sku)::int, 0) + v_delta))
    ),
    updated_at = NOW()
    WHERE id = v_cuarto_id;

    -- Registrar movimiento con columnas correctas
    INSERT INTO inventario_mov (sku, cantidad, tipo, origen)
    VALUES (v_sku, v_delta, v_tipo, v_origen);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en update_stocks_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_stocks_atomic TO authenticated;
