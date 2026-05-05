-- 059_rutas_tanda3.sql
-- Cierre de pendientes Rutas (auditoría rutas Tanda 3):
--   1. Reemplazar cerrar_ruta_atomic por v2: usa update_stocks_atomic
--      (mig 047) para devolver stock con FOR UPDATE, evitando race
--      condition con producción/traspasos concurrentes.
--   2. Reemplazar UNIQUE INDEX idx_ruta_chofer_activa para incluir
--      'Programada': impide que admin asigne 2 rutas Programadas al
--      mismo chofer (auditoría 🟡-3).
--   3. Agregar columnas cancelada_at + motivo_cancelacion a rutas para
--      el flujo cancelarRutaConDevolucion (🟡-6).

-- ─────────────────────────────────────────────────────────────────
-- PASO 1: cerrar_ruta_atomic v2
-- ─────────────────────────────────────────────────────────────────
-- Diferencias vs versión anterior (007_rpc_atomic_operations.sql):
--   - Devuelve stock vía update_stocks_atomic en lugar de UPDATE
--     jsonb_set directo (gana FOR UPDATE + RAISE en negativo).
--   - update_stocks_atomic ya inserta inventario_mov, así que
--     removemos el INSERT manual para evitar duplicados.
--   - El resto (UPDATE estatus + ingreso contable + auditoría) queda
--     intacto.
--
-- DROP previo: la BD puede tener sobrecargas con firmas distintas
-- (caso histórico con `cuarto_frio_id INTEGER` o sin `p_entregas`),
-- así que limpiamos cualquier variante antes de crear la canónica.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT format('DROP FUNCTION IF EXISTS cerrar_ruta_atomic(%s)',
                  pg_get_function_identity_arguments(oid)) AS sql
      FROM pg_proc
     WHERE proname = 'cerrar_ruta_atomic'
       AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE fn.sql;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION cerrar_ruta_atomic(
  p_ruta_id BIGINT,
  p_devoluciones JSONB,         -- {"HC-25K": 10, "HC-5K": 5}
  p_cuarto_frio_id TEXT,        -- cuartos_frios.id es TEXT desde mig 023
  p_entregas JSONB,             -- Array de entregas (se ignora aquí; cerrarRutaCompleta lo usa)
  p_total_cobrado NUMERIC,
  p_total_credito NUMERIC,
  p_usuario TEXT
) RETURNS JSONB AS $$
DECLARE
  v_ruta rutas%ROWTYPE;
  v_changes JSONB := '[]'::jsonb;
  v_sku TEXT;
  v_qty INT;
BEGIN
  -- 1. Lock + validar ruta
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF v_ruta IS NULL THEN
    RAISE EXCEPTION 'Ruta % no encontrada', p_ruta_id;
  END IF;
  IF v_ruta.estatus = 'Cerrada' THEN
    RAISE EXCEPTION 'Ruta % ya está cerrada', p_ruta_id;
  END IF;

  -- 2. UPDATE rutas (estatus, devolucion, totales)
  UPDATE rutas SET
    estatus       = 'Cerrada',
    cierre_at     = NOW(),
    devolucion    = p_devoluciones,
    total_cobrado = p_total_cobrado,
    total_credito = p_total_credito
  WHERE id = p_ruta_id;

  -- 3. Construir array de changes para update_stocks_atomic.
  IF p_devoluciones IS NOT NULL AND jsonb_typeof(p_devoluciones) = 'object' THEN
    FOR v_sku, v_qty IN
      SELECT key, value::INT
        FROM jsonb_each_text(p_devoluciones)
       WHERE NULLIF(value, '') IS NOT NULL
    LOOP
      IF v_qty > 0 THEN
        v_changes := v_changes || jsonb_build_object(
          'cuarto_id', p_cuarto_frio_id,
          'sku',       v_sku,
          'delta',     v_qty,
          'tipo',      'Entrada',
          'origen',    'Devolución ruta ' || v_ruta.folio,
          'usuario',   p_usuario
        );
      END IF;
    END LOOP;
  END IF;

  -- 4. Devolver stock vía RPC atómica (FOR UPDATE + RAISE en negativo
  --    + INSERT inventario_mov dentro del helper).
  IF jsonb_array_length(v_changes) > 0 THEN
    PERFORM update_stocks_atomic(v_changes);
  END IF;

  -- 5. Ingreso contable si hubo cobros (idéntico a v1)
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

  -- 6. Auditoría
  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES (
    'Cerrar',
    'Rutas',
    v_ruta.folio || ' — Cobrado: $' || p_total_cobrado || ', Crédito: $' || p_total_credito,
    p_usuario,
    NOW()
  );

  RETURN jsonb_build_object(
    'success',       true,
    'ruta_id',       p_ruta_id,
    'folio',         v_ruta.folio,
    'total_cobrado', p_total_cobrado,
    'total_credito', p_total_credito
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error cerrando ruta: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cerrar_ruta_atomic(BIGINT, JSONB, TEXT, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- PASO 2: UNIQUE INDEX que incluye 'Programada'
-- ─────────────────────────────────────────────────────────────────
-- Antes (mig 049): solo (Cargada, En progreso, Pendiente firma).
-- Ahora: agregamos 'Programada' para impedir 2 rutas Programadas al
-- mismo chofer (la 2da queda en limbo cuando la 1ra avanza a Cargada).
--
-- Pre-verificado el 2026-05-05: 0 choferes con duplicados de Programada.

DROP INDEX IF EXISTS idx_ruta_chofer_activa;

CREATE UNIQUE INDEX idx_ruta_chofer_activa
  ON rutas(chofer_id)
  WHERE estatus IN ('Programada', 'Cargada', 'Pendiente firma', 'En progreso')
    AND chofer_id IS NOT NULL;

COMMENT ON INDEX idx_ruta_chofer_activa IS
  'Tanda 3: incluye Programada para impedir asignación duplicada de rutas pre-cargadas al mismo chofer.';

-- ─────────────────────────────────────────────────────────────────
-- PASO 3: columnas de cancelación en rutas
-- ─────────────────────────────────────────────────────────────────
-- cancelarRutaConDevolucion (🟡-6) marca la ruta como 'Cancelada' con
-- timestamp y motivo. La columna estatus ya soporta 'Cancelada' (TEXT
-- desde mig 002). Agregamos los metadatos para auditoría.

ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS cancelada_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion  TEXT;

COMMENT ON COLUMN rutas.cancelada_at IS
  'Timestamp de cancelación (cancelarRutaConDevolucion).';
COMMENT ON COLUMN rutas.motivo_cancelacion IS
  'Motivo capturado por admin al cancelar la ruta.';
