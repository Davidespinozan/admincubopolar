-- 113_complementos_pago.sql — OL-04 (aditiva): complementos de pago (CFDI tipo P)
-- anclados a UN pago, sobre el modelo de operaciones CFDI de 111.
--
-- Antes: billing-create-complemento armaba el CFDI con montos, saldos y método
-- que mandaba el cliente; sin dueño; sin reserva; caché por ORDEN (los pagos
-- parciales posteriores nunca recibían complemento); parcialidad desfasada;
-- aceptaba CFDI cancelados y órdenes PUE; resultado desconocido = reintento.
--
-- Ahora la operación es "complemento del pago X contra el CFDI vigente":
--   * cfdi_operaciones admite tipo 'complemento' con pago_id, el UUID del CFDI
--     relacionado, la parcialidad y los datos fiscales tomados del pago
--     (pagos.monto, saldo_antes, saldo_despues, fecha, método → forma SAT).
--   * reservar_complemento_cfdi (service role): bloquea la orden (misma
--     serialización por orden que timbrado y cancelación de 111), valida actor
--     y dueño, CFDI vigente (Facturada, UUID, no cancelado), CFDI emitido PPD
--     (dato registrado al timbrar: cfdi_operaciones.cfdi_metodo_pago), pago de
--     la CxC de esa orden, datos del pago coherentes, parcialidades anteriores
--     ya complementadas, y reserva ANTES del proveedor.
--   * Parcialidad = posición del pago entre los pagos de la CxC (orden de
--     registro, el mismo de la cadena de saldos de abonar_cxc): pago 1 → 1,
--     pago 2 → 2… Un pago solo se complementa cuando los anteriores ya tienen
--     su complemento para ese CFDI. Cada generación de CFDI (tras cancelar y
--     re-facturar) vuelve a empezar en 1.
--   * Un complemento exitoso por pago y CFDI relacionado (índice único).
--   * Folio y fecha del CFDI P se fijan al reservar y se reutilizan: Facturama
--     identifica la operación por Folio + Date (guía oficial de idempotencia).
--   * Éxito, falla definitiva, incierta, conciliación: la misma máquina de 111;
--     el complemento NUNCA mueve la orden, el pago, la CxC ni la contabilidad.
--   * La emisión de la factura registra cfdi_metodo_pago (PPD / PUE) desde el
--     CFDI que arma el servidor; ordenes.metodo_pago es operativo y mutable.
--
-- Producción tenía 0 CFDI, 0 CxC y 0 complementos: sin respaldo histórico.
--
-- Reversión (solo sin operaciones de complemento activas o sin resolver):
--   DROP FUNCTION IF EXISTS public.reservar_complemento_cfdi(bigint, bigint, integer);
--   volver a aplicar las definiciones de cfdi_aplicar_resultado,
--   finalizar_operacion_cfdi y conciliar_operacion_cfdi de 111;
--   las columnas nuevas y la historia se conservan.

ALTER TABLE public.cfdi_operaciones
  ADD COLUMN IF NOT EXISTS pago_id BIGINT REFERENCES public.pagos(id),
  ADD COLUMN IF NOT EXISTS relacionado_uuid TEXT,
  ADD COLUMN IF NOT EXISTS parcialidad INTEGER,
  ADD COLUMN IF NOT EXISTS importe_pagado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS saldo_anterior NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS saldo_insoluto NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fecha_pago DATE,
  ADD COLUMN IF NOT EXISTS forma_pago TEXT,
  ADD COLUMN IF NOT EXISTS prov_serie TEXT,
  ADD COLUMN IF NOT EXISTS prov_folio TEXT,
  ADD COLUMN IF NOT EXISTS prov_fecha TEXT,
  ADD COLUMN IF NOT EXISTS cfdi_metodo_pago TEXT;

ALTER TABLE public.cfdi_operaciones DROP CONSTRAINT IF EXISTS cfdi_operaciones_tipo_check;
ALTER TABLE public.cfdi_operaciones ADD CONSTRAINT cfdi_operaciones_tipo_check
  CHECK (tipo IN ('emision', 'cancelacion', 'complemento'));
ALTER TABLE public.cfdi_operaciones DROP CONSTRAINT IF EXISTS cfdi_operaciones_complemento;
ALTER TABLE public.cfdi_operaciones ADD CONSTRAINT cfdi_operaciones_complemento
  CHECK (tipo <> 'complemento' OR (pago_id IS NOT NULL AND relacionado_uuid IS NOT NULL AND parcialidad >= 1
                                   AND importe_pagado > 0 AND saldo_anterior IS NOT NULL AND saldo_insoluto IS NOT NULL
                                   AND fecha_pago IS NOT NULL AND forma_pago IS NOT NULL AND prov_folio IS NOT NULL AND prov_fecha IS NOT NULL));
ALTER TABLE public.cfdi_operaciones DROP CONSTRAINT IF EXISTS cfdi_operaciones_metodo_sat;
ALTER TABLE public.cfdi_operaciones ADD CONSTRAINT cfdi_operaciones_metodo_sat
  CHECK (cfdi_metodo_pago IS NULL OR cfdi_metodo_pago IN ('PPD', 'PUE'));

-- Un complemento exitoso por pago y CFDI relacionado (la generación de la factura).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cfdi_operaciones_complemento_exitoso ON public.cfdi_operaciones (pago_id, relacionado_uuid)
  WHERE tipo = 'complemento' AND estado = 'exitosa';
CREATE INDEX IF NOT EXISTS idx_cfdi_operaciones_pago ON public.cfdi_operaciones (pago_id) WHERE pago_id IS NOT NULL;

-- ── Reserva del complemento del pago X (antes del proveedor) ──────────────────
CREATE OR REPLACE FUNCTION public.reservar_complemento_cfdi(p_pago_id BIGINT, p_actor_id BIGINT, p_lease_segundos INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor usuarios%ROWTYPE;
  v_pago  pagos%ROWTYPE;
  v_cxc   cuentas_por_cobrar%ROWTYPE;
  v_ord   ordenes%ROWTYPE;
  v_act   cfdi_operaciones%ROWTYPE;
  v_ok    cfdi_operaciones%ROWTYPE;
  v_metodo TEXT;
  v_forma TEXT;
  v_prev  BIGINT;
  v_k     INTEGER;
  v_gen   INTEGER;
  v_lease INTEGER := LEAST(GREATEST(COALESCE(p_lease_segundos, 120), 30), 900);
  v_folio TEXT;
  v_fecha TEXT;
  v_id    UUID;
BEGIN
  IF p_pago_id IS NULL THEN
    RAISE EXCEPTION 'reservar_complemento_cfdi: pago requerido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM usuarios WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.estatus IS DISTINCT FROM 'Activo' OR v_actor.rol NOT IN ('Admin', 'Facturación', 'Ventas') THEN
    RAISE EXCEPTION 'reservar_complemento_cfdi: actor no autorizado para emitir complementos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservar_complemento_cfdi: el pago % no existe', p_pago_id USING ERRCODE = '22023';
  END IF;
  IF v_pago.cxc_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'PAGO_SIN_CXC');
  END IF;
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE id = v_pago.cxc_id;
  IF NOT FOUND OR v_cxc.orden_id IS NULL OR (v_pago.orden_id IS NOT NULL AND v_pago.orden_id IS DISTINCT FROM v_cxc.orden_id) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'PAGO_SIN_ORDEN');
  END IF;

  -- Misma serialización por orden que timbrado y cancelación (111).
  SELECT * INTO v_ord FROM ordenes WHERE id = v_cxc.orden_id FOR UPDATE;
  IF v_actor.rol = 'Ventas' AND v_ord.vendedor_id IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'reservar_complemento_cfdi: Ventas solo emite complementos de sus propias órdenes' USING ERRCODE = '42501';
  END IF;

  UPDATE cfdi_operaciones
     SET estado = 'incierta', updated_at = now(), detalle = detalle || jsonb_build_object('lease_vencido_at', now())
   WHERE orden_id = v_ord.id AND estado = 'en_curso' AND lease_hasta < now();

  -- CFDI vigente al que se relaciona el pago.
  IF v_ord.facturama_uuid IS NULL OR v_ord.facturama_id IS NULL OR v_ord.cfdi_cancelado_at IS NOT NULL OR v_ord.estatus IS DISTINCT FROM 'Facturada' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'SIN_CFDI_VIGENTE', 'estatus', v_ord.estatus);
  END IF;

  -- Mismo pago ya complementado para este CFDI → devolver el existente (sin proveedor).
  SELECT * INTO v_ok FROM cfdi_operaciones
   WHERE tipo = 'complemento' AND estado = 'exitosa' AND pago_id = v_pago.id AND relacionado_uuid = v_ord.facturama_uuid;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'COMPLEMENTO_EMITIDO', 'operacion_id', v_ok.id,
                              'cfdi_uuid', v_ok.cfdi_uuid, 'proveedor_id', v_ok.proveedor_id, 'parcialidad', v_ok.parcialidad);
  END IF;

  SELECT * INTO v_act FROM cfdi_operaciones
   WHERE orden_id = v_ord.id AND estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_act.id, 'tipo_activo', v_act.tipo, 'estado', v_act.estado, 'pago_activo', v_act.pago_id,
      'codigo', CASE v_act.estado WHEN 'en_curso' THEN 'OPERACION_EN_CURSO' WHEN 'incierta' THEN 'OPERACION_INCIERTA'
                                  WHEN 'cancelacion_pendiente' THEN 'CANCELACION_PENDIENTE' ELSE 'OPERACION_EN_REVISION' END);
  END IF;

  -- Cómo se emitió ESE CFDI (dato registrado al timbrar; no ordenes.metodo_pago).
  SELECT cfdi_metodo_pago INTO v_metodo FROM cfdi_operaciones
   WHERE tipo = 'emision' AND estado = 'exitosa' AND cfdi_uuid = v_ord.facturama_uuid
   ORDER BY finalizada_at DESC LIMIT 1;
  IF v_metodo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'MODO_FISCAL_NO_REGISTRADO');
  END IF;
  IF v_metodo <> 'PPD' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'CFDI_PUE');
  END IF;

  -- Datos fiscales del pago (autoridad: el renglón de pagos).
  IF v_pago.monto IS NULL OR v_pago.monto <= 0 OR v_pago.saldo_antes IS NULL OR v_pago.saldo_despues IS NULL OR v_pago.fecha IS NULL
     OR abs(round(v_pago.saldo_antes - v_pago.monto, 2) - round(v_pago.saldo_despues, 2)) > 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'DATOS_PAGO_INCONSISTENTES');
  END IF;
  v_forma := CASE v_pago.metodo_pago
    WHEN 'Efectivo' THEN '01'
    WHEN 'Transferencia' THEN '03' WHEN 'Transferencia SPEI' THEN '03' WHEN 'QR / Link de pago' THEN '03'
    WHEN 'Tarjeta' THEN '04' WHEN 'Tarjeta (terminal)' THEN '04' END;
  IF v_forma IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'FORMA_PAGO_NO_DETERMINABLE', 'metodo', v_pago.metodo_pago);
  END IF;

  -- Parcialidad = posición del pago en la CxC; las anteriores deben estar complementadas.
  SELECT p.id INTO v_prev FROM pagos p
   WHERE p.cxc_id = v_pago.cxc_id AND p.id < v_pago.id
     AND NOT EXISTS (SELECT 1 FROM cfdi_operaciones o WHERE o.tipo = 'complemento' AND o.estado = 'exitosa'
                      AND o.pago_id = p.id AND o.relacionado_uuid = v_ord.facturama_uuid)
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'COMPLEMENTO_ANTERIOR_PENDIENTE', 'pago_pendiente', v_prev);
  END IF;
  v_k := (SELECT count(*) FROM pagos WHERE cxc_id = v_pago.cxc_id AND id <= v_pago.id);

  v_gen := 1 + (SELECT count(*) FROM cfdi_operaciones WHERE orden_id = v_ord.id AND tipo = 'cancelacion' AND estado = 'exitosa');
  v_folio := 'P' || v_pago.id || 'G' || v_gen;
  v_fecha := to_char(now() AT TIME ZONE fin_zona_negocio(), 'YYYY-MM-DD"T"HH24:MI:SS');

  INSERT INTO cfdi_operaciones (orden_id, tipo, generacion, estado, huella, lease_hasta, actor_id, actor,
                                pago_id, relacionado_uuid, parcialidad, importe_pagado, saldo_anterior, saldo_insoluto,
                                fecha_pago, forma_pago, prov_serie, prov_folio, prov_fecha)
  VALUES (v_ord.id, 'complemento', v_gen, 'en_curso',
          encode(sha256(convert_to(concat_ws('|', 'cfdi', v_ord.id, 'complemento', v_gen, v_pago.id, v_ord.facturama_uuid, v_k,
                                             round(v_pago.monto, 2), round(v_pago.saldo_antes, 2), round(v_pago.saldo_despues, 2),
                                             v_pago.fecha, v_forma), 'UTF8')), 'hex'),
          now() + make_interval(secs => v_lease), v_actor.id, v_actor.nombre,
          v_pago.id, v_ord.facturama_uuid, v_k, round(v_pago.monto, 2), round(v_pago.saldo_antes, 2), round(v_pago.saldo_despues, 2),
          v_pago.fecha, v_forma, 'CP', v_folio, v_fecha)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'operacion_id', v_id, 'tipo', 'complemento', 'generacion', v_gen, 'estado', 'en_curso',
    'orden_id', v_ord.id, 'pago_id', v_pago.id, 'cliente_id', COALESCE(v_cxc.cliente_id, v_ord.cliente_id),
    'relacionado_uuid', v_ord.facturama_uuid, 'relacionado_folio', v_ord.facturama_folio, 'parcialidad', v_k,
    'importe_pagado', round(v_pago.monto, 2), 'saldo_anterior', round(v_pago.saldo_antes, 2), 'saldo_insoluto', round(v_pago.saldo_despues, 2),
    'fecha_pago', to_char(v_pago.fecha, 'YYYY-MM-DD'), 'forma_pago', v_forma, 'serie', 'CP', 'folio', v_folio, 'fecha_cfdi', v_fecha);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'codigo', 'OPERACION_EN_CURSO');
END $$;

-- ── 111, extendidas para complementos (mismo comportamiento para emisión y cancelación) ──
CREATE OR REPLACE FUNCTION public.cfdi_aplicar_resultado(p_operacion_id UUID, p_resultado TEXT, p_datos JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op   cfdi_operaciones%ROWTYPE;
  v_ord  ordenes%ROWTYPE;
  v_n    INTEGER := 0;
  v_d    JSONB := COALESCE(p_datos, '{}'::jsonb);
  v_pid  TEXT := NULLIF(btrim(COALESCE(v_d->>'proveedor_id', '')), '');
  v_uuid TEXT := NULLIF(btrim(COALESCE(v_d->>'cfdi_uuid', '')), '');
  v_pst  TEXT := NULLIF(btrim(COALESCE(v_d->>'proveedor_estatus', '')), '');
  v_det  JSONB := COALESCE(v_d->'detalle', '{}'::jsonb);
BEGIN
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  SELECT * INTO v_ord FROM ordenes WHERE id = v_op.orden_id FOR UPDATE;

  IF p_resultado = 'emitida' THEN
    IF v_pid IS NULL OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'cfdi: una emisión exitosa requiere proveedor_id y cfdi_uuid' USING ERRCODE = '22023';
    END IF;
    -- 113 (OL-04): el complemento de pago es un CFDI propio (tipo P); su éxito
    -- se registra en la operación y NO mueve la orden, el pago ni la CxC.
    IF v_op.tipo = 'complemento' THEN
      BEGIN
        UPDATE cfdi_operaciones
           SET estado = 'exitosa', finalizada_at = now(), proveedor_id = v_pid, cfdi_uuid = v_uuid,
               proveedor_estatus = COALESCE(v_pst, proveedor_estatus), detalle = detalle || v_det, updated_at = now()
         WHERE id = v_op.id;
      EXCEPTION WHEN unique_violation THEN
        UPDATE cfdi_operaciones
           SET estado = 'revision', proveedor_id = v_pid, cfdi_uuid = v_uuid,
               detalle = detalle || v_det || jsonb_build_object('revision', 'ya existe un complemento exitoso para este pago y CFDI'), updated_at = now()
         WHERE id = v_op.id;
        RETURN jsonb_build_object('ok', false, 'operacion_id', v_op.id, 'estado', 'revision', 'pago_id', v_op.pago_id);
      END;
      RETURN jsonb_build_object('ok', true, 'operacion_id', v_op.id, 'estado', 'exitosa', 'pago_id', v_op.pago_id, 'cfdi_uuid', v_uuid);
    END IF;
    IF v_ord.estatus = 'Entregada' AND NOT (v_ord.facturama_uuid IS NOT NULL AND v_ord.cfdi_cancelado_at IS NULL) THEN
      BEGIN
        PERFORM set_config('app.cfdi_ctx', 'emision', true);
        UPDATE ordenes
           SET estatus = 'Facturada', facturama_id = v_pid, facturama_folio = NULLIF(v_d->>'folio', ''), facturama_uuid = v_uuid,
               cfdi_cancelado_at = NULL, cfdi_cancelado_motivo = NULL, cfdi_cancelado_motivo_detalle = NULL,
               cfdi_cancelado_uuid_sustituto = NULL, cfdi_cancelado_por = NULL
         WHERE id = v_ord.id AND estatus = 'Entregada';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        PERFORM set_config('app.cfdi_ctx', '', true);
      EXCEPTION WHEN unique_violation THEN
        PERFORM set_config('app.cfdi_ctx', '', true);
        v_n := 0; v_det := v_det || jsonb_build_object('error_local', 'uuid duplicado en otra orden');
      END;
    END IF;
    UPDATE cfdi_operaciones
       SET estado = CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
           finalizada_at = CASE WHEN v_n = 1 THEN now() END,
           proveedor_id = v_pid, cfdi_uuid = v_uuid, proveedor_estatus = COALESCE(v_pst, proveedor_estatus),
           -- 113 (OL-04): cómo se emitió el CFDI (PPD / PUE), dato fiscal inmutable de la operación.
           cfdi_metodo_pago = COALESCE(NULLIF(v_d->>'metodo_pago_sat', ''), cfdi_metodo_pago),
           detalle = detalle || v_det || CASE WHEN v_n = 1 THEN '{}'::jsonb
                     ELSE jsonb_build_object('revision', 'el proveedor emitió el CFDI pero la orden no estaba Entregada sin CFDI vigente', 'estatus_orden', v_ord.estatus) END,
           updated_at = now()
     WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', v_n = 1, 'operacion_id', v_op.id, 'estado', CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
                              'orden_estatus', CASE WHEN v_n = 1 THEN 'Facturada' ELSE v_ord.estatus END);

  ELSIF p_resultado = 'cancelada' THEN
    IF v_ord.estatus = 'Facturada' AND v_ord.facturama_uuid = v_op.cfdi_uuid AND v_ord.cfdi_cancelado_at IS NULL THEN
      PERFORM set_config('app.cfdi_ctx', 'cancelacion', true);
      UPDATE ordenes
         SET estatus = 'Entregada', cfdi_cancelado_at = now(), cfdi_cancelado_motivo = v_op.motivo,
             cfdi_cancelado_motivo_detalle = NULLIF(btrim(COALESCE(v_d->>'motivo_detalle', '')), ''),
             cfdi_cancelado_uuid_sustituto = v_op.uuid_sustituto,
             cfdi_cancelado_por = COALESCE(NULLIF(v_d->>'cancelado_por', ''), v_op.actor, 'Sistema')
       WHERE id = v_ord.id AND estatus = 'Facturada' AND facturama_uuid = v_op.cfdi_uuid AND cfdi_cancelado_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      PERFORM set_config('app.cfdi_ctx', '', true);
    END IF;
    UPDATE cfdi_operaciones
       SET estado = CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
           finalizada_at = CASE WHEN v_n = 1 THEN now() END,
           proveedor_estatus = COALESCE(v_pst, 'canceled'),
           detalle = detalle || v_det || CASE WHEN v_n = 1 THEN '{}'::jsonb
                     ELSE jsonb_build_object('revision', 'el proveedor confirmó la cancelación pero la orden ya no estaba Facturada con ese CFDI', 'estatus_orden', v_ord.estatus) END,
           updated_at = now()
     WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', v_n = 1, 'operacion_id', v_op.id, 'estado', CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
                              'orden_estatus', CASE WHEN v_n = 1 THEN 'Entregada' ELSE v_ord.estatus END);

  ELSIF p_resultado = 'cancelacion_solicitada' THEN
    UPDATE cfdi_operaciones SET estado = 'cancelacion_pendiente', proveedor_estatus = COALESCE(v_pst, 'requested'),
           detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', true, 'operacion_id', v_op.id, 'estado', 'cancelacion_pendiente', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado IN ('fallida', 'cancelacion_rechazada') THEN
    UPDATE cfdi_operaciones SET estado = 'fallida', finalizada_at = now(),
           proveedor_estatus = COALESCE(v_pst, CASE WHEN p_resultado = 'cancelacion_rechazada' THEN 'rejected' END, proveedor_estatus),
           proveedor_id = COALESCE(v_pid, proveedor_id),
           detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_op.id, 'estado', 'fallida', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado = 'incierta' THEN
    UPDATE cfdi_operaciones SET estado = 'incierta', proveedor_id = COALESCE(v_pid, proveedor_id), cfdi_uuid = COALESCE(cfdi_uuid, v_uuid),
           proveedor_estatus = COALESCE(v_pst, proveedor_estatus), detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_op.id, 'estado', 'incierta', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado = 'descartada' THEN
    UPDATE cfdi_operaciones SET estado = 'descartada', finalizada_at = now(), detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', true, 'operacion_id', v_op.id, 'estado', 'descartada', 'orden_estatus', v_ord.estatus);
  END IF;

  RAISE EXCEPTION 'cfdi: resultado inválido (%)', p_resultado USING ERRCODE = '22023';
END $$;

CREATE OR REPLACE FUNCTION public.finalizar_operacion_cfdi(p_operacion_id UUID, p_resultado TEXT, p_datos JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op cfdi_operaciones%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalizar_operacion_cfdi: operación % no existe', p_operacion_id USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_op.tipo IN ('emision', 'complemento') AND p_resultado IN ('emitida', 'fallida', 'incierta'))
       OR (v_op.tipo = 'cancelacion' AND p_resultado IN ('cancelada', 'cancelacion_solicitada', 'cancelacion_rechazada', 'fallida', 'incierta'))) THEN
    RAISE EXCEPTION 'finalizar_operacion_cfdi: resultado % no aplica a una %', p_resultado, v_op.tipo USING ERRCODE = '22023';
  END IF;
  -- Solo la operación viva (o la que venció mientras su proceso seguía: la
  -- respuesta definitiva del proveedor que llega tarde es la verdad).
  IF v_op.estado NOT IN ('en_curso', 'incierta') THEN
    IF (v_op.estado = 'exitosa' AND p_resultado IN ('emitida', 'cancelada') AND v_op.cfdi_uuid IS NOT DISTINCT FROM COALESCE(NULLIF(p_datos->>'cfdi_uuid', ''), v_op.cfdi_uuid))
       OR (v_op.estado = 'fallida' AND p_resultado IN ('fallida', 'cancelacion_rechazada')) THEN
      RETURN jsonb_build_object('ok', v_op.estado = 'exitosa', 'operacion_id', v_op.id, 'estado', v_op.estado, 'replay', true);
    END IF;
    RAISE EXCEPTION 'finalizar_operacion_cfdi: la operación ya está % (usa la conciliación)', v_op.estado USING ERRCODE = '55000';
  END IF;
  IF v_op.estado = 'incierta' AND p_resultado = 'incierta' THEN
    RETURN cfdi_aplicar_resultado(v_op.id, 'incierta', p_datos);
  END IF;
  RETURN cfdi_aplicar_resultado(v_op.id, p_resultado, p_datos);
END $$;

CREATE OR REPLACE FUNCTION public.conciliar_operacion_cfdi(p_operacion_id UUID, p_resolucion TEXT, p_datos JSONB, p_actor_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op    cfdi_operaciones%ROWTYPE;
  v_actor usuarios%ROWTYPE;
  v_nota  TEXT := NULLIF(btrim(COALESCE(p_datos->>'evidencia', '')), '');
  v_d     JSONB;
BEGIN
  SELECT * INTO v_actor FROM usuarios WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.estatus IS DISTINCT FROM 'Activo' OR v_actor.rol NOT IN ('Admin', 'Facturación') THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: solo Admin o Facturación concilian' USING ERRCODE = '42501';
  END IF;
  IF v_nota IS NULL THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la conciliación requiere evidencia (consulta al proveedor)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: operación % no existe', p_operacion_id USING ERRCODE = '22023';
  END IF;
  IF v_op.estado = 'en_curso' AND v_op.lease_hasta >= now() THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la operación sigue en curso (lease vigente)' USING ERRCODE = '55000';
  END IF;
  IF v_op.estado NOT IN ('en_curso', 'incierta', 'revision', 'cancelacion_pendiente') THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la operación ya está resuelta (%)', v_op.estado USING ERRCODE = '55000';
  END IF;
  IF NOT ((v_op.tipo IN ('emision', 'complemento') AND p_resolucion IN ('emitida', 'no_emitida'))
       OR (v_op.tipo = 'cancelacion' AND p_resolucion IN ('cancelada', 'no_cancelada'))) THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: resolución % no aplica a una %', p_resolucion, v_op.tipo USING ERRCODE = '22023';
  END IF;
  v_d := COALESCE(p_datos, '{}'::jsonb) || jsonb_build_object('detalle', jsonb_build_object('conciliacion',
           jsonb_build_object('resolucion', p_resolucion, 'evidencia', v_nota, 'actor', v_actor.nombre, 'actor_id', v_actor.id, 'at', now(), 'estado_previo', v_op.estado)));
  RETURN cfdi_aplicar_resultado(v_op.id,
    CASE p_resolucion WHEN 'emitida' THEN 'emitida' WHEN 'cancelada' THEN 'cancelada' ELSE 'descartada' END, v_d);
END $$;

REVOKE ALL ON FUNCTION public.reservar_complemento_cfdi(BIGINT, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_complemento_cfdi(BIGINT, BIGINT, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.cfdi_aplicar_resultado(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalizar_operacion_cfdi(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliar_operacion_cfdi(UUID, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_operacion_cfdi(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.conciliar_operacion_cfdi(UUID, TEXT, JSONB, BIGINT) TO service_role;
