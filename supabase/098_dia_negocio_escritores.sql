-- 098_dia_negocio_escritores.sql — parte 1 de 2 (aditiva). La parte 2
-- (099_contencion_pagos_proveedores.sql) se aplica DESPUÉS de desplegar el
-- frontend que paga cuentas por pagar con pagar_cuenta_por_pagar.
--
-- Residual de 096: escritores donde el navegador todavía decidía el día de
-- negocio ("hoy") de un hecho que ocurre al registrarlo. El día lo pone el
-- servidor con fin_hoy() (America/Mazatlan); las fechas que el usuario elige
-- (costo fijo, gasto, emisión de CxP, asiento manual) se conservan.
--
--   1. pagar_cuenta_por_pagar (Admin): abono a CxP + egreso + pago a
--      proveedor ligados en UNA transacción, fecha = fin_hoy(). Misma
--      aritmética de saldo/estatus que el frontend anterior. Idempotente por
--      operación (pagos_proveedores.operacion_id + huella).
--   2. pagar_nomina (Admin): egreso + costo de nómina + periodo Pagado en UNA
--      transacción, fecha y periodo = fin_hoy(). Un periodo se paga una vez:
--      un costo P&L y una salida de efectivo.
--   3. Egreso de reembolso de devolución (INSERT por API, categoría
--      Devoluciones ligada a orden): fecha = fin_hoy() aunque el cliente
--      envíe otra.
--   4. costos_historial.periodo: si no viene, se deriva de la fecha.
-- Idempotente. No modifica datos existentes.

-- ═══ 1. Cuentas por pagar: pago por contrato ═══
ALTER TABLE pagos_proveedores ADD COLUMN IF NOT EXISTS operacion_id UUID;
ALTER TABLE pagos_proveedores ADD COLUMN IF NOT EXISTS huella TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pagos_proveedores_operacion_key ON pagos_proveedores (operacion_id) WHERE operacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pagar_cuenta_por_pagar(
  p_operacion_id UUID, p_cxp_id BIGINT, p_monto NUMERIC, p_metodo_pago TEXT DEFAULT NULL, p_referencia TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_monto   NUMERIC := round(COALESCE(p_monto, 0), 2);
  v_metodo  TEXT := COALESCE(NULLIF(btrim(COALESCE(p_metodo_pago, '')), ''), 'Transferencia');
  v_ref     TEXT := COALESCE(btrim(p_referencia), '');
  v_huella  TEXT;
  v_cxp     cuentas_por_pagar%ROWTYPE;
  v_prev    pagos_proveedores%ROWTYPE;
  v_pagado  NUMERIC;
  v_saldo   NUMERIC;
  v_estatus TEXT;
  v_fecha   DATE := fin_hoy();
  v_mov     BIGINT;
  v_pago    BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'pagar_cuenta_por_pagar: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_cxp_id IS NULL THEN
    RAISE EXCEPTION 'pagar_cuenta_por_pagar: operación y cuenta son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido' USING ERRCODE = '22023';
  END IF;
  v_huella := md5(concat_ws('|', p_cxp_id, v_monto, v_metodo, v_ref));

  -- La cuenta serializa todo abono sobre ella.
  SELECT * INTO v_cxp FROM cuentas_por_pagar WHERE id = p_cxp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta por pagar no encontrada' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_prev FROM pagos_proveedores WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.cxp_id = p_cxp_id AND v_prev.huella = v_huella THEN
      RETURN jsonb_build_object('pago_id', v_prev.id, 'cxp_id', p_cxp_id, 'movimiento_id', v_prev.movimiento_id, 'fecha', v_prev.fecha,
        'monto', v_prev.monto, 'monto_pagado', v_cxp.monto_pagado, 'saldo_pendiente', v_cxp.saldo_pendiente, 'estatus', v_cxp.estatus, 'replay', true);
    END IF;
    RAISE EXCEPTION 'pagar_cuenta_por_pagar: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
  END IF;

  -- Misma aritmética que el frontend anterior.
  v_pagado  := round(COALESCE(v_cxp.monto_pagado, 0) + v_monto, 2);
  v_saldo   := round(COALESCE(v_cxp.monto_original, 0) - v_pagado, 2);
  v_estatus := CASE WHEN v_saldo <= 0 THEN 'Pagada' WHEN v_pagado > 0 THEN 'Parcial' ELSE 'Pendiente' END;

  UPDATE cuentas_por_pagar SET monto_pagado = v_pagado, saldo_pendiente = GREATEST(0, v_saldo), estatus = v_estatus WHERE id = p_cxp_id;

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia)
  VALUES (v_fecha, 'Egreso', 'Proveedores', 'Pago a ' || COALESCE(v_cxp.proveedor, '') || ' — ' || COALESCE(v_cxp.concepto, ''), v_monto, v_ref)
  RETURNING id INTO v_mov;

  INSERT INTO pagos_proveedores (cxp_id, monto, fecha, metodo_pago, referencia, movimiento_id, operacion_id, huella)
  VALUES (p_cxp_id, v_monto, v_fecha, v_metodo, v_ref, v_mov, p_operacion_id, v_huella)
  RETURNING id INTO v_pago;

  RETURN jsonb_build_object('pago_id', v_pago, 'cxp_id', p_cxp_id, 'movimiento_id', v_mov, 'fecha', v_fecha, 'monto', v_monto,
    'monto_pagado', v_pagado, 'saldo_pendiente', GREATEST(0, v_saldo), 'estatus', v_estatus, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.pagar_cuenta_por_pagar(UUID, BIGINT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_cuenta_por_pagar(UUID, BIGINT, NUMERIC, TEXT, TEXT) TO authenticated, service_role;

-- ═══ 2. Nómina: pago por contrato ═══
CREATE OR REPLACE FUNCTION public.pagar_nomina(p_periodo_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_per      nomina_periodos%ROWTYPE;
  v_total    NUMERIC;
  v_fecha    DATE := fin_hoy();
  v_concepto TEXT;
  v_mov      BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'pagar_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_periodo_id IS NULL THEN
    RAISE EXCEPTION 'pagar_nomina: periodo obligatorio' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no encontrado' USING ERRCODE = '22023'; END IF;

  -- Un periodo se paga una sola vez (un costo y una salida de efectivo).
  IF v_per.movimiento_id IS NOT NULL THEN
    RETURN jsonb_build_object('periodo_id', p_periodo_id, 'movimiento_id', v_per.movimiento_id,
      'fecha', (SELECT fecha FROM movimientos_contables WHERE id = v_per.movimiento_id), 'total_neto', v_per.total_neto, 'replay', true);
  END IF;
  IF v_per.estatus = 'Pagado' THEN
    RAISE EXCEPTION 'pagar_nomina: el periodo % ya está pagado', COALESCE(v_per.periodo, p_periodo_id::text) USING ERRCODE = '22023';
  END IF;

  SELECT round(COALESCE(sum(neto_a_pagar), 0), 2) INTO v_total FROM nomina_recibos WHERE periodo_id = p_periodo_id;
  IF v_total <= 0 THEN RAISE EXCEPTION 'No hay neto a pagar' USING ERRCODE = '22023'; END IF;

  v_concepto := 'Pago nómina ' || COALESCE(NULLIF(v_per.periodo, ''), p_periodo_id::text);
  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto)
  VALUES (v_fecha, 'Egreso', 'Nómina', v_concepto, v_total)
  RETURNING id INTO v_mov;

  UPDATE nomina_periodos SET total_neto = v_total, estatus = 'Pagado', pagado_at = now(), movimiento_id = v_mov WHERE id = p_periodo_id;

  INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, movimiento_id)
  VALUES ('Nómina', 'Nómina', v_concepto, v_total, to_char(v_fecha, 'YYYY-MM'), v_fecha, v_mov);

  RETURN jsonb_build_object('periodo_id', p_periodo_id, 'movimiento_id', v_mov, 'fecha', v_fecha, 'total_neto', v_total, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.pagar_nomina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_nomina(BIGINT) TO authenticated, service_role;

-- ═══ 3. Reembolso de devolución: el día lo pone el servidor ═══
CREATE OR REPLACE FUNCTION public.movimientos_contables_fecha_negocio() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() AND NEW.tipo = 'Egreso' AND NEW.categoria = 'Devoluciones' AND NEW.orden_id IS NOT NULL THEN
    NEW.fecha := fin_hoy();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.movimientos_contables_fecha_negocio() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_movimientos_contables_fecha_negocio ON movimientos_contables;
CREATE TRIGGER trg_movimientos_contables_fecha_negocio BEFORE INSERT ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_contables_fecha_negocio();

-- ═══ 4. costos_historial: periodo derivado de la fecha ═══
CREATE OR REPLACE FUNCTION public.costos_historial_periodo() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.periodo, '')), '') IS NULL AND NEW.fecha IS NOT NULL THEN
    NEW.periodo := to_char(NEW.fecha, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.costos_historial_periodo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_costos_historial_periodo ON costos_historial;
CREATE TRIGGER trg_costos_historial_periodo BEFORE INSERT ON costos_historial
  FOR EACH ROW EXECUTE FUNCTION public.costos_historial_periodo();
