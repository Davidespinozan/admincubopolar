-- MIGRACIÓN 023: Corregir update_stocks_atomic — cuartos_frios.id es TEXT no BIGINT

CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB AS $$
DECLARE
  change      JSONB;
  v_cuarto_id TEXT;
  v_sku       TEXT;
  v_delta     INT;
  v_updated   INT := 0;
BEGIN
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := change->>'cuarto_id';
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INT;

    UPDATE cuartos_frios
    SET stock = jsonb_set(
      COALESCE(stock, '{}'::jsonb),
      ARRAY[v_sku],
      to_jsonb(GREATEST(0, COALESCE((stock->>v_sku)::int, 0) + v_delta))
    ),
    updated_at = NOW()
    WHERE id = v_cuarto_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en update_stocks_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_stocks_atomic TO authenticated;
