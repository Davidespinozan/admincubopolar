-- 047_fix_update_stocks_atomic.sql
-- Restaura tres garantías que se perdieron en migraciones 022/023:
--   1) FOR UPDATE explícito sobre la fila del cuarto frío.
--   2) RAISE EXCEPTION cuando el descuento dejaría stock negativo
--      (antes silenciosamente clampeaba a 0 con GREATEST → over-selling).
--   3) INSERT en inventario_mov para auditoría/kárdex.
--
-- Las columnas reales de inventario_mov (producto, usuario textos) se
-- confirman con los inserts directos en supaStore.js (línea 1259, 1822)
-- y migración 007/020. cuartos_frios.id es TEXT (migración 023).

CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB AS $$
DECLARE
  change      JSONB;
  v_cuarto_id TEXT;
  v_sku       TEXT;
  v_delta     INTEGER;
  v_tipo      TEXT;
  v_origen    TEXT;
  v_usuario   TEXT;
  v_current   INTEGER;
  v_new       INTEGER;
  v_updated   INTEGER := 0;
BEGIN
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := change->>'cuarto_id';
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');
    v_usuario   := COALESCE(change->>'usuario', 'Sistema');

    -- Bloquea la fila del cuarto y lee el stock actual del SKU
    SELECT COALESCE((stock->>v_sku)::INTEGER, 0)
      INTO v_current
      FROM cuartos_frios
     WHERE id = v_cuarto_id
     FOR UPDATE;

    v_new := v_current + v_delta;

    -- Defensa: descuento que llevaría a negativo aborta toda la operación
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%',
        v_sku, v_cuarto_id, v_current, ABS(v_delta);
    END IF;

    -- Aplica el cambio al JSONB de stock
    UPDATE cuartos_frios
       SET stock = jsonb_set(
             COALESCE(stock, '{}'::jsonb),
             ARRAY[v_sku],
             to_jsonb(v_new)
           ),
           updated_at = NOW()
     WHERE id = v_cuarto_id;

    -- Auditoría: cada cambio queda en inventario_mov (append-only)
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en update_stocks_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_stocks_atomic TO authenticated;
