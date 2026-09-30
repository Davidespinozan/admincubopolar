-- 093_finanzas_reverso_produccion.sql — separación Flujo de efectivo /
-- Estado de resultados, producción inmutable con reverso compensatorio y
-- trazabilidad del stock de catálogo. Parte 1 de 2 (aditiva: el frontend
-- anterior sigue funcionando). La 094 retira el DELETE directo de producción
-- y el cambio de stock de insumos por UPDATE REST, una vez desplegado el
-- frontend que usa estos contratos.
--
--   1. ordenes.delivered_at: sello del servidor al entrar por primera vez a
--      Entregada/Facturada (reconocimiento de ingreso). No se falsifica ni se
--      rellena la historia: las filas legadas quedan en NULL.
--   2. produccion: estado Revertida + revertir_produccion() (Admin, UUID,
--      atómico, idempotente) usando SOLO los datos históricos guardados
--      (cuarto_id, empaque_sku, empaque_cantidad, costo). Sin borrado físico.
--      produccion_guard: por API solo se editan turno y máquina.
--   3. ajustar_existencia(): ajuste manual acotado (Admin, motivo, kardex,
--      atómico, idempotente). Kardex de existencia inicial de insumos creados
--      por la API.
--   4. conciliacion_empaque: las producciones revertidas no cuentan como uso.
--   5. reporte_financiero(desde, hasta): Estado de resultados (devengado,
--      ingreso a la entrega) y Flujo de efectivo (dinero que entró/salió),
--      calculados en el servidor para el periodo pedido, sin topes de filas.
--
-- Sin reparación histórica: no inserta, corrige ni reinterpreta filas
-- existentes. Idempotente.

-- ═══ 1. Fecha de entrega (reconocimiento de ingreso) ═══
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.ordenes_delivered_at() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  -- Nunca se confía en el valor enviado: el servidor lo deriva.
  IF TG_OP = 'INSERT' THEN
    NEW.delivered_at := CASE WHEN NEW.estatus IN ('Entregada', 'Facturada') THEN now() END;
  ELSE
    NEW.delivered_at := COALESCE(OLD.delivered_at,
      CASE WHEN NEW.estatus IN ('Entregada', 'Facturada') AND COALESCE(OLD.estatus, '') NOT IN ('Entregada', 'Facturada') THEN now() END);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_delivered_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_delivered_at ON ordenes;
CREATE TRIGGER trg_ordenes_delivered_at BEFORE INSERT OR UPDATE ON ordenes FOR EACH ROW EXECUTE FUNCTION public.ordenes_delivered_at();
CREATE INDEX IF NOT EXISTS idx_ordenes_delivered_at ON ordenes (delivered_at) WHERE delivered_at IS NOT NULL;

-- ═══ 2. Producción inmutable + reverso compensatorio ═══
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS revertida_at         TIMESTAMPTZ;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS revertida_por        BIGINT;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS reverso_operacion_id UUID;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS motivo_reverso       TEXT;
ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta', 'recepcion_compra', 'salida_empaque',
                  'reverso_produccion', 'ajuste_existencia'));
CREATE UNIQUE INDEX IF NOT EXISTS produccion_reverso_operacion_id_key ON produccion (reverso_operacion_id) WHERE reverso_operacion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS costos_historial_reverso_prod_key ON costos_historial (referencia) WHERE tipo = 'Reverso producción';

-- Por API solo se corrigen turno y máquina. Cantidad, estado, SKU, cuarto,
-- empaque, costo, operación y reverso los escriben solo los contratos.
CREATE OR REPLACE FUNCTION public.produccion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'turno' - 'maquina') IS DISTINCT FROM (to_jsonb(OLD) - 'turno' - 'maquina') THEN
    RAISE EXCEPTION 'produccion: la producción es un evento inmutable; solo se corrigen turno y máquina (para deshacerla usa el reverso)' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.produccion_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_produccion_guard ON produccion;
CREATE TRIGGER trg_produccion_guard BEFORE UPDATE OR DELETE ON produccion FOR EACH ROW EXECUTE FUNCTION public.produccion_guard();

CREATE OR REPLACE FUNCTION public.revertir_produccion(p_operacion_id UUID, p_produccion_id BIGINT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_p        produccion%ROWTYPE;
  v_folio    TEXT;
  v_emp      INTEGER;
  v_costo    NUMERIC := 0;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_produccion: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_produccion_id IS NULL THEN
    RAISE EXCEPTION 'revertir_produccion: operación y producción son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'revertir_produccion: el motivo es obligatorio' USING ERRCODE = '22023';
  END IF;
  v_clave := 'reverso|' || p_produccion_id || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'reverso_produccion', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_p FROM produccion WHERE id = p_produccion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_produccion: producción no encontrada: %', p_produccion_id USING ERRCODE = '22023';
  END IF;
  v_folio := COALESCE(v_p.folio, 'ID ' || v_p.id);
  IF v_p.tipo = 'Transformacion' THEN
    RAISE EXCEPTION 'revertir_produccion: las transformaciones no se pueden revertir todavía (%)', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.revertida_at IS NOT NULL OR v_p.estatus = 'Revertida' THEN
    RAISE EXCEPTION 'revertir_produccion: la producción % ya fue revertida', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.estatus <> 'Confirmada' OR COALESCE(v_p.tipo, '') <> 'Produccion' THEN
    RAISE EXCEPTION 'revertir_produccion: la producción % no está confirmada (%)', v_folio, v_p.estatus USING ERRCODE = '22023';
  END IF;
  -- Solo con evidencia durable del efecto original (contrato 076+).
  IF v_p.operacion_id IS NULL OR NULLIF(btrim(COALESCE(v_p.cuarto_id, '')), '') IS NULL
     OR (v_p.empaque_sku IS NOT NULL AND v_p.empaque_cantidad IS NULL) THEN
    RAISE EXCEPTION 'revertir_produccion: % es una producción legada sin datos suficientes (cuarto/empaque); no se puede revertir con certeza', v_folio USING ERRCODE = '22023';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'reverso_produccion', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  -- Producto terminado: solo del cuarto ORIGINAL; si no alcanza, falla todo.
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.sku, -v_p.cantidad, 'Salida', 'Reverso producción ' || v_folio,
                           NULL, 'reverso_produccion/' || v_folio, v_etiqueta, NULL, p_operacion_id);

  -- Empaque: exactamente el SKU y la cantidad guardados en la producción.
  v_emp := CASE WHEN v_p.empaque_sku IS NULL THEN 0 ELSE COALESCE(v_p.empaque_cantidad, 0) END;
  IF v_emp > 0 THEN
    PERFORM 1 FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revertir_produccion: el empaque % ya no existe en el catálogo', v_p.empaque_sku USING ERRCODE = '22023';
    END IF;
    UPDATE productos SET stock = COALESCE(stock, 0) + v_emp WHERE sku = v_p.empaque_sku;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
    VALUES ('Entrada', v_p.empaque_sku, v_emp, 'Reverso producción ' || v_folio, v_etiqueta, 'reverso_produccion/' || v_folio, p_operacion_id);
  END IF;

  -- Costo: evento compensatorio ligado a PROD-<id>; el original no se borra.
  v_costo := COALESCE(v_p.costo_total, 0);
  IF v_costo > 0 THEN
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Reverso producción', 'Costo de Ventas', 'Reverso producción ' || v_folio || ': ' || v_p.cantidad || '× ' || v_p.sku,
            v_costo, to_char(fin_hoy(), 'YYYY-MM'), fin_hoy(), 'PROD-' || v_p.id || '/reverso', NULL);
  END IF;

  UPDATE produccion SET estatus = 'Revertida', revertida_at = now(), revertida_por = v_actor_id,
                        reverso_operacion_id = p_operacion_id, motivo_reverso = v_motivo
   WHERE id = v_p.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Revertir', 'Producción', v_folio || ' — ' || v_p.cantidad || '×' || v_p.sku || ' — motivo: ' || v_motivo);

  v_res := jsonb_build_object('id', v_p.id, 'folio', v_folio, 'sku', v_p.sku, 'cantidad', v_p.cantidad, 'cuarto_id', v_p.cuarto_id,
                              'empaque_sku', v_p.empaque_sku, 'empaque_devuelto', v_emp, 'costo_revertido', v_costo,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.revertir_produccion(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_produccion(UUID, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 3. Ajuste manual de existencia (contrato acotado) ═══
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

-- Existencia inicial de un insumo dado de alta por la API: evento de kardex.
CREATE OR REPLACE FUNCTION public.productos_existencia_inicial() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF fin_jwt_role() = 'authenticated' AND COALESCE(NEW.tipo, '') <> 'Producto Terminado' AND COALESCE(NEW.stock, 0) > 0 THEN
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
    VALUES ('Entrada', NEW.sku, NEW.stock, 'Existencia inicial (alta de producto)', erp_actor_etiqueta(), 'existencia_inicial/' || NEW.sku);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.productos_existencia_inicial() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_productos_existencia_inicial ON productos;
CREATE TRIGGER trg_productos_existencia_inicial AFTER INSERT ON productos FOR EACH ROW EXECUTE FUNCTION public.productos_existencia_inicial();

-- ═══ Guardas: nuevos espacios de nombres reservados a contratos ═══
CREATE OR REPLACE FUNCTION public.inventario_mov_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'inventario_mov: el kardex es historia; no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  IF NEW.ruta_id IS NOT NULL OR NEW.operacion_id IS NOT NULL
     OR COALESCE(NEW.referencia, '') ~ '^(carga_ruta/|devolucion_ruta/|no_entrega/|salida_manual/|traspaso/|produccion/|transformacion/|recepcion_compra/|salida_empaque/|MERMA-|reverso_produccion/|ajuste_existencia/|existencia_inicial/)'
     OR NEW.tipo IN ('Merma', 'Reverso merma', 'Devolución no entregada', 'Traspaso salida', 'Traspaso entrada', 'Entrega a Producción') THEN
    RAISE EXCEPTION 'inventario_mov: movimiento reservado a los contratos del servidor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.costos_historial_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'costos_historial: el historial de costos no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(NEW.referencia, '') LIKE 'PROD-%' OR NEW.tipo IN ('Producción', 'Reverso producción') THEN
    RAISE EXCEPTION 'costos_historial: el costo de producción lo registra el contrato de producción' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- ═══ 4. Conciliación de empaque: las producciones revertidas no son uso ═══
CREATE OR REPLACE FUNCTION public.conciliacion_empaque() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'conciliacion_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku', p.sku, 'nombre', p.nombre, 'stock_total', COALESCE(p.stock, 0),
      'entregado_produccion', e.qty, 'entregas', e.n,
      'consumido_produccion', c.qty, 'producciones', c.n,
      'diferencia', e.qty - c.qty,
      'legado_salidas', ls.qty, 'legado_salidas_n', ls.n,
      'legado_consumo', lc.qty, 'legado_consumo_n', lc.n) ORDER BY p.sku)
    FROM productos p
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Entrega a Producción' AND m.referencia LIKE 'salida_empaque/%' AND m.operacion_id IS NOT NULL) e
    -- 093: una producción revertida devolvió su empaque; no cuenta como uso.
    CROSS JOIN LATERAL (SELECT COALESCE(sum(pr.empaque_cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM produccion pr
                         WHERE pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL AND pr.tipo = 'Produccion' AND pr.estatus <> 'Revertida') c
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida'
                           AND (m.referencia LIKE 'salida_empaque/%' OR (m.referencia IS NULL AND m.origen = 'Producción'))) ls
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida' AND m.origen LIKE 'Producción OP-%'
                           AND NOT EXISTS (SELECT 1 FROM produccion pr WHERE 'Producción ' || pr.folio = m.origen
                                            AND pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL)) lc
    WHERE p.tipo = 'Empaque'), '[]'::jsonb);
END $$;

-- ═══ 5. Reporte financiero: Estado de resultados y Flujo de efectivo ═══
-- Egresos que NO son dinero: valuación de mermas y costo de producción legado.
CREATE OR REPLACE FUNCTION public.fin_egreso_no_efectivo(p_id BIGINT, p_categoria TEXT, p_referencia TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(p_categoria, '') IN ('Mermas', 'Costo de Ventas')
      OR COALESCE(p_referencia, '') LIKE 'MERMA-%' OR COALESCE(p_referencia, '') LIKE 'PROD-%'
      OR EXISTS (SELECT 1 FROM mermas WHERE mov_contable_id = p_id)
      OR EXISTS (SELECT 1 FROM produccion WHERE mov_contable_id = p_id)
$$;
REVOKE ALL ON FUNCTION public.fin_egreso_no_efectivo(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reporte_financiero(p_desde DATE, p_hasta DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tz CONSTANT TEXT := 'America/Mexico_City';
  v_res JSONB;
  r JSONB;
  f JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Facturación']) THEN
    RAISE EXCEPTION 'reporte_financiero: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'reporte_financiero: periodo inválido' USING ERRCODE = '22023';
  END IF;

  WITH
  eg AS (  -- egresos del periodo con su clasificación
    SELECT m.id, m.monto, m.categoria, m.referencia,
           fin_egreso_no_efectivo(m.id, m.categoria, m.referencia) AS no_efectivo,
           COALESCE(m.referencia, '') LIKE 'recepcion_compra/%' AS compra_contado,
           EXISTS (SELECT 1 FROM pagos_proveedores pp WHERE pp.movimiento_id = m.id) AS pago_cxp,
           EXISTS (SELECT 1 FROM nomina_periodos np WHERE np.movimiento_id = m.id) AS nomina_pagada,
           EXISTS (SELECT 1 FROM costos_historial ch WHERE ch.movimiento_id = m.id) AS con_costo,
           m.categoria = 'Devoluciones' AS reembolso
      FROM movimientos_contables m WHERE m.tipo = 'Egreso' AND m.fecha BETWEEN p_desde AND p_hasta),
  ing_manual AS (  -- ingresos capturados a mano (sin orden, que no son cobros de CxC)
    SELECT COALESCE(sum(monto), 0) AS total, COALESCE(sum(monto) FILTER (WHERE categoria <> 'Cobranza'), 0) AS no_cobranza
      FROM movimientos_contables WHERE tipo = 'Ingreso' AND orden_id IS NULL AND COALESCE(concepto, '') NOT LIKE 'Cobro CxC #%'
       AND fecha BETWEEN p_desde AND p_hasta)
  SELECT jsonb_build_object(
    'ventas_entregadas', (SELECT COALESCE(sum(total), 0) FROM ordenes WHERE delivered_at IS NOT NULL AND estatus <> 'Cancelada'
                            AND (delivered_at AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    'ventas_entregadas_n', (SELECT count(*) FROM ordenes WHERE delivered_at IS NOT NULL AND estatus <> 'Cancelada'
                            AND (delivered_at AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    'ventas_legado', (SELECT COALESCE(sum(total), 0) FROM ordenes WHERE delivered_at IS NULL AND estatus IN ('Entregada', 'Facturada') AND fecha BETWEEN p_desde AND p_hasta),
    'ventas_legado_n', (SELECT count(*) FROM ordenes WHERE delivered_at IS NULL AND estatus IN ('Entregada', 'Facturada') AND fecha BETWEEN p_desde AND p_hasta),
    'devoluciones', (SELECT COALESCE(sum(total), 0) FROM devoluciones WHERE tipo_reembolso IN ('Efectivo', 'Nota credito')
                       AND (COALESCE(fecha, created_at) AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    'costo_ventas', (SELECT COALESCE(sum(CASE WHEN tipo = 'Producción' THEN monto ELSE -monto END), 0) FROM costos_historial
                       WHERE tipo IN ('Producción', 'Reverso producción') AND fecha BETWEEN p_desde AND p_hasta),
    'costo_ventas_revertido', (SELECT COALESCE(sum(monto), 0) FROM costos_historial WHERE tipo = 'Reverso producción' AND fecha BETWEEN p_desde AND p_hasta),
    'costos_fijos', (SELECT COALESCE(sum(monto), 0) FROM costos_historial WHERE tipo = 'Fijo' AND fecha BETWEEN p_desde AND p_hasta),
    'costos_variables', (SELECT COALESCE(sum(monto), 0) FROM costos_historial WHERE tipo = 'Variable' AND fecha BETWEEN p_desde AND p_hasta),
    'nomina', (SELECT COALESCE(sum(monto), 0) FROM costos_historial WHERE tipo = 'Nómina' AND fecha BETWEEN p_desde AND p_hasta),
    'mermas', (SELECT COALESCE(sum(monto), 0) FROM eg WHERE categoria = 'Mermas' OR COALESCE(referencia, '') LIKE 'MERMA-%'
                  OR EXISTS (SELECT 1 FROM mermas me WHERE me.mov_contable_id = eg.id)),
    'gastos_credito', (SELECT COALESCE(sum(monto_original), 0) FROM cuentas_por_pagar
                         WHERE COALESCE(referencia, '') NOT LIKE 'recepcion_compra/%' AND fecha_emision BETWEEN p_desde AND p_hasta),
    'otros_gastos', (SELECT COALESCE(sum(monto), 0) FROM eg WHERE NOT no_efectivo AND NOT compra_contado AND NOT pago_cxp
                       AND NOT nomina_pagada AND NOT con_costo AND NOT reembolso),
    'otros_ingresos', (SELECT no_cobranza FROM ing_manual)
  ) INTO r;
  r := r || jsonb_build_object(
    'utilidad_bruta', round((r->>'ventas_entregadas')::numeric + (r->>'ventas_legado')::numeric - (r->>'devoluciones')::numeric - (r->>'costo_ventas')::numeric, 2));
  r := r || jsonb_build_object(
    'utilidad', round((r->>'utilidad_bruta')::numeric - (r->>'costos_fijos')::numeric - (r->>'costos_variables')::numeric - (r->>'nomina')::numeric
                      - (r->>'mermas')::numeric - (r->>'gastos_credito')::numeric - (r->>'otros_gastos')::numeric + (r->>'otros_ingresos')::numeric, 2));

  WITH
  eg AS (
    SELECT m.id, m.monto, m.categoria, m.referencia,
           fin_egreso_no_efectivo(m.id, m.categoria, m.referencia) AS no_efectivo,
           COALESCE(m.referencia, '') LIKE 'recepcion_compra/%' AS compra_contado,
           EXISTS (SELECT 1 FROM pagos_proveedores pp WHERE pp.movimiento_id = m.id) AS pago_cxp,
           (EXISTS (SELECT 1 FROM nomina_periodos np WHERE np.movimiento_id = m.id) OR m.categoria = 'Nómina') AS nomina,
           EXISTS (SELECT 1 FROM costos_historial ch WHERE ch.movimiento_id = m.id) AS con_costo,
           m.categoria = 'Devoluciones' AS reembolso
      FROM movimientos_contables m WHERE m.tipo = 'Egreso' AND m.fecha BETWEEN p_desde AND p_hasta),
  sal AS (SELECT * FROM eg WHERE NOT no_efectivo)
  SELECT jsonb_build_object(
    -- Entradas: el pago es el evento canónico (mostrador, ruta, CxC, webhook).
    'entradas_pagos', (SELECT COALESCE(sum(monto), 0) FROM pagos WHERE (created_at AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    'entradas_pagos_n', (SELECT count(*) FROM pagos WHERE (created_at AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    'entradas_cobros_cxc', (SELECT COALESCE(sum(monto), 0) FROM pagos WHERE cxc_id IS NOT NULL AND (created_at AT TIME ZONE tz)::date BETWEEN p_desde AND p_hasta),
    -- Legado: cobros que solo quedaron en contabilidad (orden sin ningún pago).
    'entradas_legado', (SELECT COALESCE(sum(m.monto), 0) FROM movimientos_contables m WHERE m.tipo = 'Ingreso' AND m.orden_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.orden_id = m.orden_id) AND m.fecha BETWEEN p_desde AND p_hasta),
    'entradas_manuales', (SELECT total FROM (SELECT COALESCE(sum(monto), 0) AS total FROM movimientos_contables WHERE tipo = 'Ingreso' AND orden_id IS NULL
                           AND COALESCE(concepto, '') NOT LIKE 'Cobro CxC #%' AND fecha BETWEEN p_desde AND p_hasta) z),
    'salidas_compras_contado', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE compra_contado),
    'salidas_pagos_proveedores', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE pago_cxp),
    'salidas_nomina', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE nomina AND NOT compra_contado AND NOT pago_cxp),
    'salidas_costos', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE con_costo AND NOT nomina AND NOT compra_contado AND NOT pago_cxp),
    'salidas_reembolsos', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE reembolso AND NOT con_costo AND NOT nomina AND NOT compra_contado AND NOT pago_cxp),
    'salidas_otras', (SELECT COALESCE(sum(monto), 0) FROM sal WHERE NOT compra_contado AND NOT pago_cxp AND NOT nomina AND NOT con_costo AND NOT reembolso),
    'excluido_no_efectivo', (SELECT COALESCE(sum(monto), 0) FROM eg WHERE no_efectivo)
  ) INTO f;
  f := f || jsonb_build_object(
    'entradas', round((f->>'entradas_pagos')::numeric + (f->>'entradas_legado')::numeric + (f->>'entradas_manuales')::numeric, 2),
    'salidas', round((f->>'salidas_compras_contado')::numeric + (f->>'salidas_pagos_proveedores')::numeric + (f->>'salidas_nomina')::numeric
                     + (f->>'salidas_costos')::numeric + (f->>'salidas_reembolsos')::numeric + (f->>'salidas_otras')::numeric, 2));
  f := f || jsonb_build_object('neto', round((f->>'entradas')::numeric - (f->>'salidas')::numeric, 2));

  v_res := jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'resultados', r,
    'flujo', f,
    'saldos', jsonb_build_object(
      'cxc_pendiente', (SELECT COALESCE(sum(saldo_pendiente), 0) FROM cuentas_por_cobrar WHERE COALESCE(estatus, '') <> 'Pagada' AND saldo_pendiente > 0),
      'cxc_n', (SELECT count(*) FROM cuentas_por_cobrar WHERE COALESCE(estatus, '') <> 'Pagada' AND saldo_pendiente > 0),
      'cxp_pendiente', (SELECT COALESCE(sum(saldo_pendiente), 0) FROM cuentas_por_pagar WHERE COALESCE(estatus, '') <> 'Pagada' AND saldo_pendiente > 0),
      'cxp_n', (SELECT count(*) FROM cuentas_por_pagar WHERE COALESCE(estatus, '') <> 'Pagada' AND saldo_pendiente > 0)),
    'limitaciones', jsonb_build_array(
      'ventas_legado: órdenes entregadas antes de 093 sin fecha de entrega; se usa la fecha de la orden (aproximado).',
      'entradas_legado: cobros anteriores que solo quedaron como ingreso contable, sin registro de pago.',
      'No es el saldo de caja ni del banco: el sistema no registra saldo inicial.'));
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.reporte_financiero(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporte_financiero(DATE, DATE) TO authenticated, service_role;
