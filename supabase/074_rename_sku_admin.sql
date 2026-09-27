-- 074_rename_sku_admin.sql — Contención F1 (rename_sku).
--
-- Causa raíz: rename_sku (036) es SECURITY DEFINER, sin search_path, sin
-- control de actor ni de rol, y authenticated tiene EXECUTE. Cualquier login
-- (Ventas, Chofer, inactivo o sin perfil) podía renombrar un SKU en todo el
-- sistema. Además:
--   - ordenes.productos se reescribía con REPLACE sin anclar: renombrar
--     B3-SKU convertía "2×B3-SKU2" en "2×B3-NEW2" (reproducido);
--   - p_old_sku no se verificaba contra el producto p_id;
--   - productos.empaque_sku y umbrales.sku quedaban apuntando al SKU viejo.
--
-- Contención (misma firma y contrato para el frontend):
--   - Solo Admin ACTIVO, vía el contrato canónico (fin_actor_permitido → 071).
--   - search_path fijo; lock del producto; p_old_sku debe ser el SKU de p_id;
--     destino no vacío, con el formato actual de SKU y sin existir.
--   - Cascada idéntica a la definición física capturada en producción el
--     2026-09-27 (cuerpo = 036), más empaque_sku y umbrales (D2). La historia
--     se sigue re-etiquetando (D1).
--   - ordenes.productos: reemplazo por TOKEN exacto "N×SKU" dentro de la lista
--     "N×SKU, N×SKU"; nunca subcadenas.
--   - Auditoría con el actor real (erp_actor_etiqueta), no 'sistema'.
--   - Mismo SKU → sin cambios ni auditoría (tras autorizar).
-- Idempotente (CREATE OR REPLACE + grants).

CREATE OR REPLACE FUNCTION public.rename_sku(p_id BIGINT, p_old_sku TEXT, p_new_sku TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old    TEXT := btrim(COALESCE(p_old_sku, ''));
  v_new    TEXT := btrim(COALESCE(p_new_sku, ''));
  v_actual TEXT;
  v_re     TEXT;
  v_token  TEXT;
  v_actor  TEXT;
BEGIN
  -- Autorización primero: un actor no autorizado no deja ningún rastro.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'rename_sku: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();

  IF v_old = '' OR v_new = '' THEN
    RAISE EXCEPTION 'rename_sku: el SKU actual y el nuevo son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_old = v_new THEN
    RETURN;  -- sin cambio: no se toca nada ni se audita
  END IF;
  IF v_new !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' THEN
    RAISE EXCEPTION 'rename_sku: formato de SKU inválido: %', v_new USING ERRCODE = '22023';
  END IF;

  SELECT sku INTO v_actual FROM productos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_sku: producto % no existe', p_id USING ERRCODE = '22023';
  END IF;
  IF v_actual IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'rename_sku: el SKU % no corresponde al producto %', v_old, p_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM productos WHERE sku = v_new) THEN
    RAISE EXCEPTION 'rename_sku: el SKU % ya existe', v_new USING ERRCODE = '23505';
  END IF;

  -- SKU viejo escapado para regex (token exacto en ordenes.productos).
  v_re := regexp_replace(v_old, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
  v_token := '(^|,\s*)([0-9]+(?:\.[0-9]+)?\s*×\s*)' || v_re || '(?=\s*(?:,|$))';

  -- ═══════════════════════════════════════════════════════════
  -- 1. Tablas con SKU como TEXT (referencias directas) — igual que 036
  -- ═══════════════════════════════════════════════════════════
  UPDATE inventario_mov SET producto = v_new WHERE producto = v_old;
  UPDATE mermas SET sku = v_new WHERE sku = v_old;              -- 072: el guard permite solo este cambio
  UPDATE produccion SET sku = v_new WHERE sku = v_old;
  UPDATE produccion SET input_sku = v_new WHERE input_sku = v_old;
  UPDATE precios_esp SET sku = v_new WHERE sku = v_old;
  UPDATE orden_lineas SET sku = v_new WHERE sku = v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 2. ordenes.productos — "25×HC-25K, 10×HC-5K": solo el token exacto
  -- ═══════════════════════════════════════════════════════════
  UPDATE ordenes
     SET productos = regexp_replace(productos, v_token, '\1\2' || v_new, 'g')
   WHERE productos ~ v_token;

  -- ═══════════════════════════════════════════════════════════
  -- 3. cuartos_frios.stock — JSONB con keys SKU (si la nueva existe, suma)
  -- ═══════════════════════════════════════════════════════════
  UPDATE cuartos_frios
  SET stock = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(stock)
      GROUP BY new_key
    ) sub
  )
  WHERE stock ? v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 4. rutas — JSONB en carga, carga_autorizada, extra_autorizado
  -- ═══════════════════════════════════════════════════════════
  UPDATE rutas
  SET carga = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga)
      GROUP BY new_key
    ) sub
  )
  WHERE carga IS NOT NULL AND carga ? v_old;

  UPDATE rutas
  SET carga_autorizada = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(carga_autorizada)
      GROUP BY new_key
    ) sub
  )
  WHERE carga_autorizada IS NOT NULL AND carga_autorizada ? v_old;

  UPDATE rutas
  SET extra_autorizado = (
    SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
    FROM (
      SELECT
        CASE WHEN key = v_old THEN v_new ELSE key END AS new_key,
        SUM((value)::numeric) AS total_value
      FROM jsonb_each(extra_autorizado)
      GROUP BY new_key
    ) sub
  )
  WHERE extra_autorizado IS NOT NULL AND extra_autorizado ? v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 5. Referencias vivas adicionales (D2)
  -- ═══════════════════════════════════════════════════════════
  UPDATE productos SET empaque_sku = v_new WHERE empaque_sku = v_old;
  UPDATE umbrales SET sku = v_new WHERE sku = v_old;

  -- ═══════════════════════════════════════════════════════════
  -- 6. Finalmente, el catálogo (productos.sku)
  -- ═══════════════════════════════════════════════════════════
  UPDATE productos SET sku = v_new WHERE id = p_id;

  -- Auditoría con el actor real derivado en el servidor.
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_actor, 'Renombrar SKU', 'Productos', v_old || ' → ' || v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rename_sku(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_sku(BIGINT, TEXT, TEXT) TO authenticated, service_role;
