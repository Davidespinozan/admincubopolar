-- 114_referencia_pago_unica.sql — CLOSURE-1 (R-01): una referencia de pago
-- no vacía se registra UNA sola vez.
--
-- Hallazgo (auditoría final de cierre, 2026-10-06, solo lectura): producción
-- NO tiene idx_pagos_ref. 001_schema lo crea y 015 solo lo crea "si los datos
-- están limpios" (si no, lo omite en silencio); en producción quedó ausente.
-- El código sí depende de él:
--   * webhooks Stripe / Mercado Pago (_lib/persistence.js): pre-chequeo
--     SELECT por referencia `${provider}:${id}` y, en la carrera entre dos
--     entregas del mismo evento, "el índice único de pagos.referencia gana"
--     (23505 → duplicate). Sin índice, dos entregas simultáneas insertan dos
--     pagos, ajustan dos veces el saldo del cliente y duplican el cobro.
--   * registrar_pago_orden: IF EXISTS por referencia antes del INSERT (no
--     atómico entre órdenes distintas).
-- Las pruebas locales corrían con el índice presente (desde 001); producción no.
--
-- Escritores de pagos.referencia (inventario completo; authenticated solo
-- tiene SELECT sobre pagos):
--   1. webhook (service role): `stripe:<checkout session id>` /
--      `mercadopago:<payment id>` — identidad del proveedor; NO se transforma.
--   2. registrar_pago_orden (contado; venta directa 109, cierre de ruta 112,
--      entrega del store): referencia manual o, por omisión,
--      `<folio>-<método>`; un pago de contado liquida todo el pendiente con la
--      orden bloqueada, así que la omisión no se repite legítimamente.
--   3. abonar_cxc (cobro de CxC, y registrar_pago_orden cuando la orden tiene
--      CxC): referencia manual o, por omisión,
--      `Abono CxC #<cxc> <YYYYMMDD-HH24MISS de now()>`. now() es el inicio de la
--      TRANSACCIÓN: dos abonos legítimos de la misma CxC en el mismo segundo (o
--      en la misma transacción) generaban la MISMA referencia; con el índice el
--      segundo fallaría. Se corrige aquí.
--
-- Esta migración:
--   1. Pre-chequeo (falla cerrado): si existe CUALQUIER referencia no vacía
--      repetida, aborta ANTES de cambiar nada. No borra, no renombra, no
--      fusiona ni elige ganador. Si ya existe un idx_pagos_ref con otra
--      definición, también aborta.
--   2. abonar_cxc: idéntica a 088 salvo la referencia:
--      * por omisión = `Abono CxC #<cxc> pago <pagos.id>` (el id del pago se
--        toma de la secuencia de pagos.id ANTES del INSERT con
--        pg_catalog.nextval — no el public.nextval(text) de 090 —: único por
--        construcción; sin depender del segundo del reloj ni de azar);
--      * manual repetida (no vacía) → excepción clara 23505 antes de cualquier
--        efecto (no se modifica la referencia del operador).
--      Firma, permisos (CREATE OR REPLACE conserva el ACL), validaciones,
--      montos, saldos, ingreso Cobranza y saldo del cliente: sin cambio.
--   3. CREATE UNIQUE INDEX idx_pagos_ref ON pagos(referencia) WHERE referencia <> ''
--      (misma definición que 001/015). '' es el valor por omisión de la columna
--      (NOT NULL DEFAULT ''): "sin referencia"; varias pueden coexistir.
--      El índice es el respaldo final aunque dos peticiones pasen un
--      pre-chequeo IF EXISTS / SELECT al mismo tiempo. La construcción del
--      índice también falla cerrado si apareciera un duplicado entre el
--      pre-chequeo y el CREATE.
--
-- Orden: pre-chequeo (sin efectos) → función → índice. Si el pre-chequeo
-- aborta no cambió nada; si el índice fallara, la función nueva es inocua sin
-- él (referencias por omisión únicas; manual repetida rechazada).
-- Idempotente: se puede aplicar dos veces.
--
-- Sin cambio: 109–113, webhooks, registrar_pago_orden, cierre de ruta, venta
-- directa, OL-03A/B, OL-04, inventario, contabilidad. Sin reparación histórica.
--
-- Reversión (solo de emergencia; reabre R-01):
--   DROP INDEX IF EXISTS idx_pagos_ref;  y volver a la definición de
--   abonar_cxc de 088_b3_integridad_financiera.sql.

-- ═══ 1. Pre-chequeo: datos limpios y sin índice ajeno ═══
DO $$
DECLARE
  v_dup  INT;
  v_def  TEXT;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT referencia FROM pagos
     WHERE referencia IS NOT NULL AND referencia <> ''
     GROUP BY referencia HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION '114: % referencia(s) de pago no vacía(s) repetida(s); no se crea idx_pagos_ref ni se cambia nada (sin reparación automática)', v_dup
      USING ERRCODE = '23505';
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.idx_pagos_ref');
  IF v_def IS NOT NULL AND v_def <> 'CREATE UNIQUE INDEX idx_pagos_ref ON public.pagos USING btree (referencia) WHERE (referencia <> ''''::text)' THEN
    RAISE EXCEPTION '114: ya existe idx_pagos_ref con otra definición: %', v_def USING ERRCODE = '42P07';
  END IF;
END $$;

-- ═══ 2. abonar_cxc: referencia por omisión única; manual repetida rechazada ═══
CREATE OR REPLACE FUNCTION abonar_cxc(
  p_cxc_id BIGINT, p_monto NUMERIC, p_metodo TEXT, p_referencia TEXT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cxc   cuentas_por_cobrar%ROWTYPE;
  v_monto NUMERIC := round(COALESCE(p_monto, 0), 2);
  v_nuevo_pagado NUMERIC;
  v_nuevo_saldo  NUMERIC;
  v_estatus TEXT;
  v_pago_id BIGINT;
  v_mov_id  BIGINT;
  v_ref TEXT;
  v_uid BIGINT := fin_actor_id(p_usuario_id);
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Facturación']) THEN
    RAISE EXCEPTION 'abonar_cxc: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  IF v_monto <= 0 THEN RAISE EXCEPTION 'Monto debe ser positivo'; END IF;

  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE id = p_cxc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta por cobrar % no existe', p_cxc_id; END IF;
  IF v_cxc.estatus = 'Pagada' OR COALESCE(v_cxc.saldo_pendiente, 0) <= 0 THEN
    RAISE EXCEPTION 'La cuenta % ya está liquidada', p_cxc_id;
  END IF;
  IF v_monto > round(v_cxc.saldo_pendiente, 2) + 0.01 THEN
    RAISE EXCEPTION 'Abono % excede el saldo pendiente %', v_monto, v_cxc.saldo_pendiente;
  END IF;

  -- 114: el id del pago se reserva antes del INSERT; la referencia por omisión
  -- lo incluye (única por construcción). Una referencia manual se respeta tal
  -- cual y, si ya está registrada, se rechaza antes de cualquier efecto.
  -- pg_catalog explícito: public.nextval(text) (090) es otro contrato (folios).
  v_pago_id := pg_catalog.nextval(pg_get_serial_sequence('public.pagos', 'id')::regclass);
  v_ref := NULLIF(btrim(p_referencia), '');
  IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM pagos WHERE referencia = v_ref) THEN
    RAISE EXCEPTION 'abonar_cxc: la referencia de pago "%" ya está registrada', v_ref USING ERRCODE = '23505';
  END IF;
  v_ref := COALESCE(v_ref, 'Abono CxC #' || p_cxc_id || ' pago ' || v_pago_id);

  v_nuevo_pagado := round(COALESCE(v_cxc.monto_pagado, 0) + v_monto, 2);
  v_nuevo_saldo  := greatest(0, round(COALESCE(v_cxc.monto_original, 0) - v_nuevo_pagado, 2));
  v_estatus := CASE WHEN v_nuevo_saldo <= 0 THEN 'Pagada' WHEN v_nuevo_pagado > 0 THEN 'Parcial' ELSE 'Pendiente' END;

  UPDATE cuentas_por_cobrar
     SET monto_pagado = v_nuevo_pagado, saldo_pendiente = v_nuevo_saldo, estatus = v_estatus
   WHERE id = p_cxc_id;

  INSERT INTO pagos (id, cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (v_pago_id, v_cxc.cliente_id, v_cxc.orden_id, p_cxc_id, v_monto, COALESCE(NULLIF(p_metodo, ''), 'Efectivo'), fin_hoy(),
          v_ref, round(v_cxc.saldo_pendiente, 2), v_nuevo_saldo, v_uid);

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id, usuario_id)
  VALUES (fin_hoy(), 'Ingreso', 'Cobranza',
          'Cobro CxC #' || p_cxc_id || ' — ' || COALESCE(v_cxc.concepto, 'Cliente'),
          v_monto, v_cxc.orden_id, v_uid)
  RETURNING id INTO v_mov_id;

  IF v_cxc.cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo = COALESCE(saldo, 0) - v_monto WHERE id = v_cxc.cliente_id;
  END IF;

  RETURN jsonb_build_object('pago_id', v_pago_id, 'movimiento_id', v_mov_id,
                            'saldo_despues', v_nuevo_saldo, 'estatus', v_estatus);
END $$;

-- ═══ 3. Índice único parcial (respaldo final de la idempotencia) ═══
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_ref ON pagos (referencia) WHERE referencia <> '';
