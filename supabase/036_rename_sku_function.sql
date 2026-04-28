-- 036: Función rename_sku(id, viejo, nuevo) — cascade automático cuando cambia un SKU
-- Se ejecuta como SECURITY DEFINER para tener permisos de actualizar todas las tablas
-- Toda la operación corre en una transacción implícita (función plpgsql) — si algo falla, se revierte

CREATE OR REPLACE FUNCTION rename_sku(p_id BIGINT, p_old_sku TEXT, p_new_sku TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Validaciones
  IF p_old_sku IS NULL OR p_new_sku IS NULL THEN
    RAISE EXCEPTION 'old_sku y new_sku no pueden ser NULL';
  END IF;
  IF p_old_sku = p_new_sku THEN
    RETURN; -- Sin cambio, no hacer nada
  END IF;
  IF TRIM(p_new_sku) = '' THEN
    RAISE EXCEPTION 'new_sku no puede estar vacío';
  END IF;

  -- ═══════════════════════════════════════════════════════════
  -- 1. Tablas con SKU como TEXT (referencias directas)
  -- ═══════════════════════════════════════════════════════════
  UPDATE inventario_mov SET producto = p_new_sku WHERE producto = p_old_sku;
  UPDATE mermas SET sku = p_new_sku WHERE sku = p_old_sku;
  UPDATE produccion SET sku = p_new_sku WHERE sku = p_old_sku;
  UPDATE produccion SET input_sku = p_new_sku WHERE input_sku = p_old_sku;
  UPDATE precios_esp SET sku = p_new_sku WHERE sku = p_old_sku;
  UPDATE orden_lineas SET sku = p_new_sku WHERE sku = p_old_sku;

  -- ═══════════════════════════════════════════════════════════
  -- 2. ordenes.productos — string con formato "25×HC-25K, 10×HC-5K"
  -- ═══════════════════════════════════════════════════════════
  UPDATE ordenes
  SET productos = REPLACE(productos, p_old_sku, p_new_sku)
  WHERE productos LIKE '%' || p_old_sku || '%';

  -- ═══════════════════════════════════════════════════════════
  -- 3. cuartos_frios.stock — JSONB con keys SKU
  --    Si la nueva ya existe, suma los valores
  -- ═══════════════════════════════════════════════════════════
  UPDATE cuartos_frios
  SET stock = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = p_old_sku THEN p_new_sku ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(stock)
      GROUP BY new_key
    ) sub
  )
  WHERE stock ? p_old_sku;

  -- ═══════════════════════════════════════════════════════════
  -- 4. rutas — JSONB en carga, carga_autorizada, extra_autorizado
  -- ═══════════════════════════════════════════════════════════
  UPDATE rutas
  SET carga = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = p_old_sku THEN p_new_sku ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga)
      GROUP BY new_key
    ) sub
  )
  WHERE carga IS NOT NULL AND carga ? p_old_sku;

  UPDATE rutas
  SET carga_autorizada = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = p_old_sku THEN p_new_sku ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga_autorizada)
      GROUP BY new_key
    ) sub
  )
  WHERE carga_autorizada IS NOT NULL AND carga_autorizada ? p_old_sku;

  UPDATE rutas
  SET extra_autorizado = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = p_old_sku THEN p_new_sku ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(extra_autorizado)
      GROUP BY new_key
    ) sub
  )
  WHERE extra_autorizado IS NOT NULL AND extra_autorizado ? p_old_sku;

  -- ═══════════════════════════════════════════════════════════
  -- 5. Finalmente, actualizar el catálogo (productos.sku)
  -- ═══════════════════════════════════════════════════════════
  UPDATE productos SET sku = p_new_sku WHERE id = p_id;

  -- Log en auditoria
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES ('sistema', 'Renombrar SKU', 'Productos', p_old_sku || ' → ' || p_new_sku);
END;
$$;

GRANT EXECUTE ON FUNCTION rename_sku(BIGINT, TEXT, TEXT) TO authenticated;
