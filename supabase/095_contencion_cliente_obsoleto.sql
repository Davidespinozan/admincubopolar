-- 095_contencion_cliente_obsoleto.sql — contención del flujo de borrado de
-- producción del frontend anterior a 094 (pestañas viejas).
--
-- Secuencia vieja (deleteProduccion, bundle 2b37126): 1) rpc
-- update_stocks_atomic con deltas NEGATIVOS por FIFO en los cuartos (tipo
-- 'Reverso producción'); 2) DELETE de produccion (denegado desde 094);
-- 3) rpc update_productos_stock_atomic para devolver empaque. Tras 094 el
-- paso 1 seguía aplicando, dejando existencia movida con la producción
-- activa.
--
-- Contención mínima, sin bandera nueva ni detección de versión:
--   - update_stocks_atomic: por JWT solo deltas positivos (su único llamador
--     vigente es la devolución de cliente, que siempre suma al cuarto). Un
--     lote con cualquier salida se rechaza completo antes de tocar nada.
--   - update_productos_stock_atomic: sin llamadores vigentes → sin EXECUTE
--     para authenticated (service_role y SQL la conservan).
-- Sin cambios en revertir_produccion, ajustar_existencia ni en el reporte
-- financiero. Idempotente.

CREATE OR REPLACE FUNCTION public.update_stocks_atomic(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- 085: solo Admin activo desde la API. Sin JWT (SQL/mantenimiento) y
  -- service_role conservan la semántica previa de fin_actor_permitido. Los
  -- contratos de negocio (076, 069, 084) ya no pasan por aquí: usan
  -- stock_mov_cuarto. Sin bypass por app.fin_ctx.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'update_stocks_atomic: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_usuario := erp_actor_etiqueta();
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'update_stocks_atomic: p_changes debe ser un array';
  END IF;
  -- 085: validación previa de TODOS los SKU (catálogo productos) antes de tocar
  -- nada: un SKU desconocido rechaza la operación completa y nunca crea llaves.
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_sku := change->>'sku';
    IF v_sku IS NULL OR NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'update_stocks_atomic: SKU no encontrado: %', COALESCE(v_sku, '(nulo)') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- 095: desde la aplicación (JWT) este RPC genérico solo AGREGA existencia a
  -- un cuarto (devolución de cliente, único llamador vigente). Ninguna salida
  -- de cuarto pasa por aquí: el borrado de producción del frontend anterior a
  -- 094 (reverso FIFO) queda sin efecto; las salidas usan los contratos
  -- (revertir_produccion, ajustar_existencia, carga, traspaso, merma...).
  -- Se valida TODO el lote antes de tocar nada. SQL y service_role conservan
  -- la semántica previa (mantenimiento de confianza).
  IF COALESCE(fin_jwt_role(), '') NOT IN ('', 'service_role') THEN
    FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
    LOOP
      IF COALESCE(change->>'delta', '') !~ '^[0-9]+$' OR (change->>'delta')::INTEGER <= 0 THEN
        RAISE EXCEPTION 'update_stocks_atomic: desde la aplicación solo se permiten entradas a cuarto (devoluciones); las salidas usan los contratos del servidor' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := change->>'cuarto_id';
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');
    IF v_cuarto_id IS NULL OR v_sku IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'update_stocks_atomic: cuarto_id, sku y delta son obligatorios';
    END IF;
    SELECT COALESCE((stock->>v_sku)::INTEGER, 0)
      INTO v_current
      FROM cuartos_frios
     WHERE id = v_cuarto_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuarto frío no encontrado: %', v_cuarto_id;
    END IF;
    v_new := v_current + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%',
        v_sku, v_cuarto_id, v_current, ABS(v_delta);
    END IF;
    UPDATE cuartos_frios
       SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_sku], to_jsonb(v_new)),
           updated_at = NOW()
     WHERE id = v_cuarto_id;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, cuarto_id)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario, v_cuarto_id);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'actor', v_usuario);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_productos_stock_atomic(jsonb) FROM authenticated;
