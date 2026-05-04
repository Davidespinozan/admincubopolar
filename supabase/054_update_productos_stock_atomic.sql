-- 054_update_productos_stock_atomic.sql
-- RPC atómica para actualizar productos.stock con FOR UPDATE + RAISE EXCEPTION
-- en stock negativo. Reemplaza el patrón SELECT → JS → UPDATE en
-- movimientoBolsa (insumos/empaques) que sufría race conditions y clamp
-- silencioso a 0 con Math.max.
--
-- Mismo shape que update_stocks_atomic (migración 047) pero opera sobre
-- productos.stock (campo escalar) en lugar de cuartos_frios.stock (JSONB).
-- Empaques y materias primas viven en productos.stock; productos terminados
-- viven en cuartos_frios.stock JSONB y usan update_stocks_atomic.
--
-- Audita en inventario_mov con columnas producto/usuario (text), igual que 047.

CREATE OR REPLACE FUNCTION update_productos_stock_atomic(p_changes JSONB)
RETURNS JSONB AS $$
DECLARE
  change      JSONB;
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
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');
    v_usuario   := COALESCE(change->>'usuario', 'Sistema');

    -- Bloquea la fila del producto y lee stock actual
    SELECT COALESCE(stock, 0)
      INTO v_current
      FROM productos
     WHERE sku = v_sku
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU no encontrado: %', v_sku;
    END IF;

    v_new := v_current + v_delta;

    -- Defensa: descuento que llevaría a negativo aborta toda la operación
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente de %: disponible=%, requerido=%',
        v_sku, v_current, ABS(v_delta);
    END IF;

    -- Aplica el cambio
    UPDATE productos
       SET stock = v_new
     WHERE sku = v_sku;

    -- Auditoría: cada cambio queda en inventario_mov (append-only)
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en update_productos_stock_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_productos_stock_atomic TO authenticated;
