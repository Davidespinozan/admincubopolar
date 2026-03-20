-- Fix race conditions and data integrity issues.

-- 1) Normalize inconsistent route status strings in existing data.
UPDATE rutas
SET estatus = 'En progreso'
WHERE lower(trim(estatus)) IN ('en progreso', 'en_progreso', 'enprogreso')
  AND estatus <> 'En progreso';

-- 2) Update update_stocks_atomic to reject deductions that would result in negative stock.
--    Previously used GREATEST(0, ...) which silently allowed over-selling.
--    Now raises an exception so the calling transaction rolls back cleanly.
DROP FUNCTION IF EXISTS update_stocks_atomic(JSONB);
CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB AS $$
DECLARE
  change JSONB;
  v_cuarto_id BIGINT;
  v_sku TEXT;
  v_delta INT;
  v_tipo TEXT;
  v_origen TEXT;
  v_usuario TEXT;
  v_current INT;
  v_updated INT := 0;
BEGIN
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := (change->>'cuarto_id')::BIGINT;
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INT;
    v_tipo      := COALESCE(change->>'tipo', 'Ajuste');
    v_origen    := COALESCE(change->>'origen', 'Sistema');
    v_usuario   := COALESCE(change->>'usuario', 'Sistema');

    -- For deductions: lock the row and verify there is enough stock.
    IF v_delta < 0 THEN
      SELECT COALESCE((stock->>v_sku)::int, 0) INTO v_current
      FROM cuartos_frios WHERE id = v_cuarto_id FOR UPDATE;

      IF (v_current + v_delta) < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente en cuarto %: disponible=%, requerido=%',
          v_cuarto_id, v_current, -v_delta;
      END IF;
    END IF;

    -- Actualizar stock en cuarto frío (JSONB)
    UPDATE cuartos_frios
    SET stock = jsonb_set(
      COALESCE(stock, '{}'::jsonb),
      ARRAY[v_sku],
      to_jsonb(COALESCE((stock->>v_sku)::int, 0) + v_delta)
    ),
    updated_at = NOW()
    WHERE id = v_cuarto_id;

    -- Registrar movimiento de inventario
    INSERT INTO inventario_mov (producto, cantidad, tipo, origen, usuario, created_at)
    VALUES (v_sku, v_delta, v_tipo, v_origen, v_usuario, NOW());

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en update_stocks_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
