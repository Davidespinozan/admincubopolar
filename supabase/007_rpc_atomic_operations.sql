-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Migration 007: Funciones RPC para transacciones atómicas
-- Resuelve bugs críticos de race conditions
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- FUNCIÓN 1: Actualizar múltiples stocks atómicamente
-- Evita inconsistencias si una actualización falla a mitad
-- ───────────────────────────────────────────────────────────────
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
  v_updated INT := 0;
BEGIN
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := (change->>'cuarto_id')::BIGINT;
    v_sku := change->>'sku';
    v_delta := (change->>'delta')::INT;
    v_tipo := COALESCE(change->>'tipo', 'Ajuste');
    v_origen := COALESCE(change->>'origen', 'Sistema');
    v_usuario := COALESCE(change->>'usuario', 'Sistema');
    
    -- Actualizar stock en cuarto frío (JSONB)
    UPDATE cuartos_frios 
    SET stock = jsonb_set(
      COALESCE(stock, '{}'::jsonb),
      ARRAY[v_sku],
      to_jsonb(GREATEST(0, COALESCE((stock->>v_sku)::int, 0) + v_delta))
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
  -- Todo se revierte automáticamente
  RAISE EXCEPTION 'Error en update_stocks_atomic: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;


-- ───────────────────────────────────────────────────────────────
-- FUNCIÓN 2: Cerrar ruta completa en una sola transacción
-- Incluye: actualizar ruta, devolver stock, procesar órdenes
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cerrar_ruta_atomic(
  p_ruta_id BIGINT,
  p_devoluciones JSONB,     -- {"HC-25K": 10, "HC-5K": 5}
  p_cuarto_frio_id BIGINT,
  p_entregas JSONB,         -- Array de entregas procesadas
  p_total_cobrado NUMERIC,
  p_total_credito NUMERIC,
  p_usuario TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_ruta rutas%ROWTYPE;
  v_sku TEXT;
  v_qty INT;
  v_entrega JSONB;
  v_folio TEXT;
  v_orden_id BIGINT;
BEGIN
  -- 1. Lock y validar la ruta
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  
  IF v_ruta IS NULL THEN
    RAISE EXCEPTION 'Ruta % no encontrada', p_ruta_id;
  END IF;
  
  IF v_ruta.estatus = 'Cerrada' THEN
    RAISE EXCEPTION 'Ruta % ya está cerrada', p_ruta_id;
  END IF;
  
  -- 2. Actualizar estatus de la ruta
  UPDATE rutas SET 
    estatus = 'Cerrada',
    cierre_at = NOW(),
    devolucion = p_devoluciones,
    total_cobrado = p_total_cobrado,
    total_credito = p_total_credito
  WHERE id = p_ruta_id;
  
  -- 3. Devolver productos al cuarto frío
  FOR v_sku, v_qty IN SELECT * FROM jsonb_each_text(p_devoluciones)
  LOOP
    IF v_qty::INT > 0 THEN
      UPDATE cuartos_frios 
      SET stock = jsonb_set(
        COALESCE(stock, '{}'::jsonb),
        ARRAY[v_sku],
        to_jsonb(COALESCE((stock->>v_sku)::int, 0) + v_qty::INT)
      ),
      updated_at = NOW()
      WHERE id = p_cuarto_frio_id;
      
      -- Registrar movimiento de devolución
      INSERT INTO inventario_mov (producto, cantidad, tipo, origen, usuario, created_at)
      VALUES (v_sku, v_qty::INT, 'Entrada', 'Devolución ruta ' || v_ruta.folio, p_usuario, NOW());
    END IF;
  END LOOP;
  
  -- 4. Registrar ingreso contable si hubo cobros
  IF p_total_cobrado > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, created_at)
    VALUES (
      CURRENT_DATE, 
      'Ingreso', 
      'Ventas', 
      'Cobros ruta ' || v_ruta.folio || ' — ' || v_ruta.nombre,
      p_total_cobrado,
      NOW()
    );
  END IF;
  
  -- 5. Registrar en auditoría
  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES (
    'Cerrar',
    'Rutas', 
    v_ruta.folio || ' — Cobrado: $' || p_total_cobrado || ', Crédito: $' || p_total_credito,
    p_usuario,
    NOW()
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'ruta_id', p_ruta_id,
    'folio', v_ruta.folio,
    'total_cobrado', p_total_cobrado,
    'total_credito', p_total_credito
  );
  
EXCEPTION WHEN OTHERS THEN
  -- Si algo falla, TODO se revierte automáticamente
  RAISE EXCEPTION 'Error cerrando ruta: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;


-- ───────────────────────────────────────────────────────────────
-- Permisos RLS para las funciones
-- ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION update_stocks_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION cerrar_ruta_atomic TO authenticated;
