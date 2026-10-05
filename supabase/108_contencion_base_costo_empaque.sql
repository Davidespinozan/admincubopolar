-- 108_contencion_base_costo_empaque.sql — integridad de la base de costo del
-- empaque, parte 2 de 2 (contención). Se aplica DESPUÉS de desplegar el
-- frontend que ya no ofrece subir el empaque por ajuste ni darlo de alta con
-- existencia. Solo hacia adelante: no toca existencias, promedios ni historia
-- (las aperturas de 106 quedan como evidencia). Idempotente.
-- Invariante: ninguna unidad de empaque entra fuera de una recepción de compra
-- (o del reverso de una producción, al costo histórico: 107).
--   1. ajustar_existencia: un Empaque solo se ajusta a la baja (el promedio no
--      cambia); el alza se rechaza. Producto terminado: sin cambio.
--   2. productos: la existencia de un Empaque nunca es negativa (CHECK; vale
--      también para SQL de confianza y service_role).
--   3. Alta por API: un Empaque nace con existencia 0 y sin costo; la primera
--      compra fija existencia y promedio (sustituye, hacia adelante, la
--      apertura declarada al dar de alta de 106).
--   4. Borrado por API: un Empaque con existencia, usado por un producto o con
--      historia (compras, reversos, producciones, kardex) no se elimina: no se
--      puede borrar y recrear para reiniciar su base de costo.

-- ═══ 1. Ajuste manual: el empaque solo baja ═══
CREATE OR REPLACE FUNCTION public.ajustar_existencia(p_operacion_id UUID, p_sku TEXT, p_nueva_existencia INTEGER, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_prod     RECORD;
  v_actual   INTEGER;
  v_delta    INTEGER;
  v_rest     INTEGER;
  v_take     INTEGER;
  v_room     RECORD;
  v_origen   TEXT;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'ajustar_existencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'ajustar_existencia: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'ajustar_existencia: el motivo es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_nueva_existencia IS NULL OR p_nueva_existencia < 0 THEN
    RAISE EXCEPTION 'ajustar_existencia: la existencia debe ser 0 o mayor' USING ERRCODE = '22023';
  END IF;
  v_clave := 'ajuste|' || v_sku || '|' || p_nueva_existencia || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'ajuste_existencia', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT sku, tipo, COALESCE(stock, 0) AS stock INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ajustar_existencia: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  -- 108: el empaque no entra por ajuste (no hay costo conocido para esas
  -- unidades y no heredan el promedio). Con el producto bloqueado: la
  -- existencia comparada es la vigente.
  IF v_prod.tipo = 'Empaque' AND p_nueva_existencia > v_prod.stock THEN
    RAISE EXCEPTION 'ajustar_existencia: el empaque % no se aumenta con un ajuste manual (existencia actual: %); las entradas de empaque se registran con la recepción de compra', v_sku, v_prod.stock
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'ajuste_existencia', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  v_origen := 'Ajuste manual: ' || v_motivo;

  IF v_prod.tipo = 'Producto Terminado' THEN
    -- Producto terminado: los cuartos fríos son el inventario (misma regla
    -- que el ajuste anterior: sube en el primer cuarto con existencia o el
    -- primero; baja FIFO por id). productos.stock queda como espejo.
    PERFORM 1 FROM cuartos_frios ORDER BY id FOR UPDATE;
    SELECT COALESCE(sum(COALESCE((stock ->> v_sku)::INTEGER, 0)), 0)::INTEGER INTO v_actual FROM cuartos_frios;
    v_delta := p_nueva_existencia - v_actual;
    IF v_delta > 0 THEN
      SELECT id INTO v_room FROM cuartos_frios ORDER BY (COALESCE((stock ->> v_sku)::INTEGER, 0) > 0) DESC, id LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ajustar_existencia: no hay cuartos fríos para aplicar el ajuste' USING ERRCODE = '22023';
      END IF;
      PERFORM stock_mov_cuarto(v_room.id, v_sku, v_delta, 'Entrada', v_origen, NULL, 'ajuste_existencia/' || v_sku, v_etiqueta, NULL, p_operacion_id);
    ELSIF v_delta < 0 THEN
      v_rest := -v_delta;
      FOR v_room IN SELECT id, COALESCE((stock ->> v_sku)::INTEGER, 0) AS q FROM cuartos_frios WHERE COALESCE((stock ->> v_sku)::INTEGER, 0) > 0 ORDER BY id LOOP
        EXIT WHEN v_rest <= 0;
        v_take := least(v_room.q, v_rest);
        PERFORM stock_mov_cuarto(v_room.id, v_sku, -v_take, 'Salida', v_origen, NULL, 'ajuste_existencia/' || v_sku, v_etiqueta, NULL, p_operacion_id);
        v_rest := v_rest - v_take;
      END LOOP;
    END IF;
    UPDATE productos SET stock = p_nueva_existencia WHERE sku = v_sku;
  ELSE
    -- Insumos (empaque, materia prima): productos.stock ES el inventario total.
    -- Empaque: solo a la baja (108); el costo promedio no cambia.
    v_actual := v_prod.stock;
    v_delta := p_nueva_existencia - v_actual;
    IF v_delta <> 0 THEN
      UPDATE productos SET stock = p_nueva_existencia WHERE sku = v_sku;
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
      VALUES (CASE WHEN v_delta > 0 THEN 'Entrada' ELSE 'Salida' END, v_sku, abs(v_delta), v_origen, v_etiqueta, 'ajuste_existencia/' || v_sku, p_operacion_id);
    END IF;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Ajustar', 'Inventario', v_sku || ': ' || v_actual || ' → ' || p_nueva_existencia || '. Motivo: ' || v_motivo);
  v_res := jsonb_build_object('sku', v_sku, 'anterior', v_actual, 'nueva', p_nueva_existencia, 'delta', v_delta,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.ajustar_existencia(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_existencia(UUID, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- ═══ 2. Existencia negativa de empaque: estado inválido ═══
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM productos WHERE tipo = 'Empaque' AND stock < 0) THEN
    RAISE EXCEPTION '108: hay empaques con existencia negativa; no se repara historia en esta migración (revisar antes de aplicar)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.productos'::regclass AND conname = 'productos_empaque_stock_no_negativo') THEN
    ALTER TABLE public.productos ADD CONSTRAINT productos_empaque_stock_no_negativo CHECK (tipo <> 'Empaque' OR stock >= 0);
  END IF;
END $$;

-- ═══ 3. Alta por API: el empaque nace sin existencia ni costo ═══
CREATE OR REPLACE FUNCTION public.productos_guard_costo() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.tipo, '') = 'Empaque' THEN
      -- 108: ninguna unidad entra fuera de una recepción de compra; con
      -- existencia 0 un costo declarado no tiene uso (la primera compra fija
      -- el promedio: factura ÷ recibido).
      IF COALESCE(NEW.stock, 0) <> 0 THEN
        RAISE EXCEPTION 'productos: un empaque nuevo nace sin existencia; las entradas de empaque se registran con la recepción de compra' USING ERRCODE = '42501';
      END IF;
      IF COALESCE(NEW.costo_unitario, 0) <> 0 THEN
        RAISE EXCEPTION 'productos: un empaque nuevo nace sin costo; el costo lo fija la primera recepción de compra (promedio ponderado)' USING ERRCODE = '42501';
      END IF;
    ELSE
      -- Producto terminado: sin costo unitario.
      NEW.costo_unitario := 0;
    END IF;
    NEW.ultimo_costo_fecha := NULL;
    RETURN NEW;
  END IF;
  IF NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario OR NEW.ultimo_costo_fecha IS DISTINCT FROM OLD.ultimo_costo_fecha THEN
    RAISE EXCEPTION 'productos: el costo del empaque lo fija la recepción de compra (promedio ponderado); el producto terminado no tiene costo unitario'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo AND 'Empaque' IN (COALESCE(NEW.tipo, ''), COALESCE(OLD.tipo, '')) THEN
    RAISE EXCEPTION 'productos: un empaque no cambia de tipo (tiene historial de costo)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.productos_guard_costo() FROM PUBLIC, anon, authenticated;

-- ═══ 4. Borrado por API: un empaque con existencia, uso o historia no se elimina ═══
CREATE OR REPLACE FUNCTION public.empaque_tiene_dependencias(p_id BIGINT, p_sku TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM productos WHERE empaque_sku = p_sku)
      OR EXISTS (SELECT 1 FROM produccion WHERE empaque_sku = p_sku)
      OR EXISTS (SELECT 1 FROM inventario_mov WHERE producto = p_sku)
      -- Historia de costo: compras, reversos o una apertura declarada (106).
      -- La apertura en ceros de un empaque recién creado no cuenta.
      OR EXISTS (SELECT 1 FROM costos_empaque_historial
                  WHERE producto_id = p_id AND (evento <> 'Apertura' OR cantidad_nueva <> 0 OR costo_nuevo <> 0))
$$;
REVOKE ALL ON FUNCTION public.empaque_tiene_dependencias(BIGINT, TEXT) FROM PUBLIC, anon;
-- La guarda (invocador) la usa al borrar por API; solo responde sí/no.
GRANT EXECUTE ON FUNCTION public.empaque_tiene_dependencias(BIGINT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.productos_guard_borrado() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() OR COALESCE(OLD.tipo, '') <> 'Empaque' THEN
    RETURN OLD;
  END IF;
  IF COALESCE(OLD.stock, 0) <> 0 THEN
    RAISE EXCEPTION 'productos: el empaque % tiene existencia; no se elimina', OLD.sku USING ERRCODE = '42501';
  END IF;
  IF empaque_tiene_dependencias(OLD.id, OLD.sku) THEN
    RAISE EXCEPTION 'productos: el empaque % está en uso o tiene historia (compras, producciones o movimientos); no se elimina', OLD.sku USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.productos_guard_borrado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_productos_guard_borrado ON productos;
CREATE TRIGGER trg_productos_guard_borrado BEFORE DELETE ON productos FOR EACH ROW EXECUTE FUNCTION public.productos_guard_borrado();
