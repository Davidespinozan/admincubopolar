-- 107_base_costo_empaque_reverso.sql — integridad de la base de costo del
-- empaque, parte 1 de 2 (aditiva: el frontend desplegado sigue funcionando).
-- Solo hacia adelante: no toca existencias, promedios ni filas históricas.
--   1. costos_empaque_historial admite el evento 'Reverso producción' y guarda
--      el costo unitario histórico que reingresa (columna nueva, solo para ese
--      evento: las columnas de 106 no pueden guardar un costo unitario exacto).
--   2. revertir_produccion: el empaque devuelto reingresa al promedio
--      ponderado al costo unitario GUARDADO en esa producción:
--        nuevo = (existencia × promedio + devuelto × costo histórico)
--                ÷ (existencia + devuelto)      (6 decimales)
--      Con existencia 0 el promedio es el costo histórico. El reintento no
--      recalcula. El reverso en resultados (093/094) no cambia: compensa el
--      costo_total guardado.
--   3. Orden de bloqueo del reverso: empaque → cuarto (igual que producción).
--      Antes era cuarto → empaque, inverso al de registrar_produccion.
-- La 108 (contención) se aplica después de desplegar el frontend.
-- Idempotente.

-- ═══ 1. Historial: evento de reverso ═══
ALTER TABLE public.costos_empaque_historial ADD COLUMN IF NOT EXISTS costo_unitario_reingreso NUMERIC(14,6);
ALTER TABLE public.costos_empaque_historial DROP CONSTRAINT IF EXISTS costos_empaque_historial_evento_check;
ALTER TABLE public.costos_empaque_historial ADD CONSTRAINT costos_empaque_historial_evento_check
  CHECK (evento IN ('Apertura', 'Compra', 'Reverso producción'));
-- El reverso explica su transición completa: existencia y promedio anteriores,
-- unidades devueltas, costo unitario histórico, existencia nueva y operación.
-- (La restricción de 106 sobre 'Compra' queda intacta: un reverso no lleva factura.)
ALTER TABLE public.costos_empaque_historial DROP CONSTRAINT IF EXISTS costos_empaque_historial_reverso_check;
ALTER TABLE public.costos_empaque_historial ADD CONSTRAINT costos_empaque_historial_reverso_check
  CHECK ((evento = 'Reverso producción') = (costo_unitario_reingreso IS NOT NULL)
     AND (evento <> 'Reverso producción'
          OR (operacion_id IS NOT NULL AND total_factura IS NULL
              AND COALESCE(costo_unitario_reingreso >= 0, false)
              AND COALESCE(cantidad_recibida > 0, false)
              AND COALESCE(cantidad_anterior >= 0, false)
              AND costo_anterior IS NOT NULL
              AND COALESCE(cantidad_nueva = cantidad_anterior + cantidad_recibida, false))));

-- ═══ 2. Reverso de producción: reingreso al costo histórico ═══
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
  v_ins      RECORD;
  v_old_qty  INTEGER;
  v_old_avg  NUMERIC;
  v_hist     NUMERIC;
  v_new_avg  NUMERIC;
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

  -- Empaque: exactamente el SKU y la cantidad guardados en la producción.
  -- 107: el empaque se bloquea ANTES de mover el cuarto (mismo orden que
  -- registrar_produccion: empaque → cuarto); con él bloqueado se leen la
  -- existencia y el promedio vigentes (se serializa con compras, producciones
  -- y ajustes del mismo empaque).
  v_emp := CASE WHEN v_p.empaque_sku IS NULL THEN 0 ELSE COALESCE(v_p.empaque_cantidad, 0) END;
  IF v_emp > 0 THEN
    SELECT id, tipo, COALESCE(stock, 0) AS stock, COALESCE(costo_unitario, 0) AS costo INTO v_ins
      FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revertir_produccion: el empaque % ya no existe en el catálogo', v_p.empaque_sku USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'reverso_produccion', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  -- Producto terminado: solo del cuarto ORIGINAL; si no alcanza, falla todo.
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.sku, -v_p.cantidad, 'Salida', 'Reverso producción ' || v_folio,
                           NULL, 'reverso_produccion/' || v_folio, v_etiqueta, NULL, p_operacion_id);

  IF v_emp > 0 THEN
    IF v_ins.tipo = 'Empaque' THEN
      -- 107: las unidades reingresan a la base de costo al costo unitario
      -- histórico de ESTA producción (no al promedio vigente).
      v_old_qty := v_ins.stock;
      v_old_avg := v_ins.costo;
      v_hist    := COALESCE(v_p.costo_empaque, 0);
      IF v_old_qty < 0 THEN
        RAISE EXCEPTION 'revertir_produccion: el empaque % tiene existencia negativa (%); estado inválido, no se recalcula el costo', v_p.empaque_sku, v_old_qty USING ERRCODE = '22023';
      END IF;
      IF v_hist < 0 THEN
        RAISE EXCEPTION 'revertir_produccion: la producción % tiene un costo de empaque inválido', v_folio USING ERRCODE = '22023';
      END IF;
      v_new_avg := round((v_old_qty * v_old_avg + v_emp * v_hist) / (v_old_qty + v_emp), 6);
      UPDATE productos SET stock = v_old_qty + v_emp, costo_unitario = v_new_avg WHERE sku = v_p.empaque_sku;
      INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida,
                                            costo_unitario_reingreso, cantidad_nueva, costo_nuevo, actor, actor_id)
      VALUES (v_ins.id, v_p.empaque_sku, 'Reverso producción', p_operacion_id, v_old_qty, v_old_avg, v_emp,
              v_hist, v_old_qty + v_emp, v_new_avg, v_etiqueta, v_actor_id);
    ELSE
      UPDATE productos SET stock = COALESCE(stock, 0) + v_emp WHERE sku = v_p.empaque_sku;
    END IF;
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
                              'costo_empaque_historico', v_hist, 'costo_promedio_anterior', v_old_avg, 'costo_promedio', v_new_avg,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.revertir_produccion(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_produccion(UUID, BIGINT, TEXT) TO authenticated, service_role;
