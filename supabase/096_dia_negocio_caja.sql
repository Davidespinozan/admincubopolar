-- 096_dia_negocio_caja.sql — día de negocio canónico (America/Mazatlan) y
-- cierre de caja por contrato del servidor. Parte 1 de 2 (aditiva; el
-- frontend anterior sigue funcionando). La 097 retira el INSERT directo de
-- cierres_diarios una vez desplegado el frontend que usa cerrar_caja_ruta.
--
--   1. Día de negocio: fin_zona_negocio() = 'America/Mazatlan' (Culiacán,
--      Sinaloa); fin_dia_negocio(instante) = fecha de calendario en esa zona;
--      fin_hoy() = fin_dia_negocio(now()). Un DATE guardado no se convierte.
--      Los contratos que ya usaban fin_hoy() solo cambian a qué día local
--      pertenece un instante; su autorización e idempotencia no cambian.
--   2. Defaults: las 11 columnas DATE de negocio que usaban CURRENT_DATE (día
--      UTC de la sesión) pasan a fin_hoy(). Cubre, entre otros, rutas.fecha
--      (addRuta no la envía) y produccion.fecha (registrar_produccion y
--      registrar_transformacion no la envían).
--   3. reporte_financiero (093): los instantes (delivered_at, pagos.created_at,
--      devoluciones.fecha) se asignan al día de negocio en Mazatlán. Sin otro
--      cambio de semántica.
--   4. Caja: un cierre por ruta (UNIQUE(ruta_id)); cerrar_caja_ruta (Admin,
--      UUID, idempotente) con fecha = rutas.fecha_fin derivada en el servidor
--      y esperado, snapshot y actor calculados en el servidor; guarda de
--      compatibilidad: un INSERT REST del frontend anterior recibe la fecha
--      de la ruta, nunca la del navegador; rutas_pendientes_caja().
--
-- Sin reparación histórica: no reescribe fechas existentes (OV-0086 intacta).
-- Idempotente.

-- ═══ 1. Día de negocio canónico ═══
CREATE OR REPLACE FUNCTION public.fin_zona_negocio() RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 'America/Mazatlan'::text $$;
CREATE OR REPLACE FUNCTION public.fin_dia_negocio(p_instante TIMESTAMPTZ) RETURNS DATE
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$ SELECT (p_instante AT TIME ZONE fin_zona_negocio())::date $$;
CREATE OR REPLACE FUNCTION public.fin_hoy() RETURNS DATE
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$ SELECT fin_dia_negocio(now()) $$;
REVOKE ALL ON FUNCTION public.fin_zona_negocio() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fin_dia_negocio(TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fin_hoy() FROM PUBLIC, anon;
-- Los defaults de columna se evalúan con el rol que inserta.
GRANT EXECUTE ON FUNCTION public.fin_zona_negocio(), public.fin_dia_negocio(TIMESTAMPTZ), public.fin_hoy() TO authenticated, service_role;

-- ═══ 2. Defaults de fechas de negocio ═══
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('pagos', 'fecha'), ('leads', 'fecha'), ('movimientos_contables', 'fecha'), ('cuentas_por_cobrar', 'fecha_venta'),
      ('costos_historial', 'fecha'), ('produccion', 'fecha'), ('mermas', 'fecha'), ('cuentas_por_pagar', 'fecha_emision'),
      ('pagos_proveedores', 'fecha'), ('ordenes', 'fecha'), ('rutas', 'fecha')) x(t, c) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c AND data_type = 'date') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT public.fin_hoy()', r.t, r.c);
    END IF;
  END LOOP;
END $$;

-- ═══ 3. Reporte financiero en el día de negocio ═══
CREATE OR REPLACE FUNCTION public.reporte_financiero(p_desde DATE, p_hasta DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tz CONSTANT TEXT := fin_zona_negocio();  -- 096: zona canónica del negocio (America/Mazatlan)
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

-- ═══ 4. Caja: un cierre por ruta, por contrato del servidor ═══
ALTER TABLE cierres_diarios ADD COLUMN IF NOT EXISTS operacion_id UUID;
ALTER TABLE cierres_diarios ADD COLUMN IF NOT EXISTS huella TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS cierres_diarios_operacion_id_key ON cierres_diarios (operacion_id) WHERE operacion_id IS NOT NULL;
DO $$
DECLARE v_con TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM cierres_diarios WHERE ruta_id IS NOT NULL GROUP BY ruta_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '096: cierres_diarios tiene más de un cierre para una ruta; no se cambia la identidad (revisar antes de aplicar)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cierres_diarios_ruta_id_key') THEN
    ALTER TABLE cierres_diarios ADD CONSTRAINT cierres_diarios_ruta_id_key UNIQUE (ruta_id);
  END IF;
  -- La identidad es la ruta; (fecha, ruta_id) queda redundante.
  FOR v_con IN SELECT c.conname FROM pg_constraint c
                WHERE c.conrelid = 'public.cierres_diarios'::regclass AND c.contype = 'u'
                  AND c.conname <> 'cierres_diarios_ruta_id_key' AND array_length(c.conkey, 1) = 2 LOOP
    EXECUTE format('ALTER TABLE cierres_diarios DROP CONSTRAINT %I', v_con);
  END LOOP;
END $$;

-- Compatibilidad con el frontend anterior (hasta 097): un INSERT por la API
-- recibe la fecha de cierre de la ruta; nunca la del navegador.
CREATE OR REPLACE FUNCTION public.cierres_diarios_fecha_ruta() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_ruta RECORD;
BEGIN
  IF NOT b4_escritura_api() THEN RETURN NEW; END IF;
  SELECT estatus, fecha_fin INTO v_ruta FROM rutas WHERE id = NEW.ruta_id;
  IF NOT FOUND OR v_ruta.estatus NOT IN ('Completada', 'Cerrada') OR v_ruta.fecha_fin IS NULL THEN
    RAISE EXCEPTION 'cierres_diarios: la ruta no está cerrada o no tiene fecha de cierre' USING ERRCODE = '22023';
  END IF;
  NEW.fecha := v_ruta.fecha_fin::date;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cierres_diarios_fecha_ruta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cierres_diarios_fecha_ruta ON cierres_diarios;
CREATE TRIGGER trg_cierres_diarios_fecha_ruta BEFORE INSERT ON cierres_diarios FOR EACH ROW EXECUTE FUNCTION public.cierres_diarios_fecha_ruta();

CREATE OR REPLACE FUNCTION public.cerrar_caja_ruta(
  p_operacion_id UUID, p_ruta_id BIGINT, p_contado_efectivo NUMERIC, p_contado_transferencia NUMERIC,
  p_motivo_diferencia TEXT DEFAULT NULL, p_notas TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_ruta     RECORD;
  v_prev     cierres_diarios%ROWTYPE;
  v_cef      NUMERIC := round(COALESCE(p_contado_efectivo, -1), 2);
  v_ctr      NUMERIC := round(COALESCE(p_contado_transferencia, -1), 2);
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo_diferencia, '')), '');
  v_notas    TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_huella   TEXT;
  v_ef       NUMERIC;
  v_tr       NUMERIC;
  v_cr       NUMERIC;
  v_snap     JSONB;
  v_dif      NUMERIC;
  v_id       BIGINT;
  v_dif_txt  TEXT;
  v_fecha    DATE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'cerrar_caja_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_caja_ruta: operación y ruta son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_cef < 0 THEN RAISE EXCEPTION 'Efectivo contado inválido' USING ERRCODE = '22023'; END IF;
  IF v_ctr < 0 THEN RAISE EXCEPTION 'Transferencia contada inválida' USING ERRCODE = '22023'; END IF;
  v_huella := md5(concat_ws('|', p_ruta_id, v_cef, v_ctr, COALESCE(v_motivo, ''), COALESCE(v_notas, '')));

  -- La ruta serializa todo intento de cierre sobre ella.
  SELECT id, folio, chofer_id, estatus, fecha_fin INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cerrar_caja_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023'; END IF;

  -- Idempotencia y un cierre por ruta.
  SELECT * INTO v_prev FROM cierres_diarios WHERE ruta_id = p_ruta_id;
  IF FOUND THEN
    IF v_prev.operacion_id = p_operacion_id AND v_prev.huella = v_huella THEN
      RETURN jsonb_build_object('cierre_id', v_prev.id, 'ruta_id', v_prev.ruta_id, 'folio', v_ruta.folio, 'fecha', v_prev.fecha,
        'esperado_efectivo', v_prev.esperado_efectivo, 'esperado_transferencia', v_prev.esperado_transferencia, 'esperado_credito', v_prev.esperado_credito,
        'esperado_total', v_prev.esperado_total, 'contado_total', v_prev.contado_total, 'diferencia', v_prev.diferencia, 'replay', true);
    ELSIF v_prev.operacion_id = p_operacion_id THEN
      RAISE EXCEPTION 'cerrar_caja_ruta: operacion_id ya usado con otros datos (ruta %)', v_ruta.folio USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'cerrar_caja_ruta: la ruta % ya tiene cierre de caja (%)', v_ruta.folio, v_prev.fecha USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM cierres_diarios WHERE operacion_id = p_operacion_id) THEN
    RAISE EXCEPTION 'cerrar_caja_ruta: operacion_id ya usado en otra ruta' USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus NOT IN ('Completada', 'Cerrada') THEN
    RAISE EXCEPTION 'Solo se cierra caja de rutas Completadas o Cerradas (estatus actual: %)', v_ruta.estatus USING ERRCODE = '22023';
  END IF;
  -- Día de negocio de la caja = fecha real de cierre de la ruta (servidor).
  IF v_ruta.fecha_fin IS NULL THEN
    RAISE EXCEPTION 'cerrar_caja_ruta: la ruta % no tiene fecha de cierre registrada', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  v_fecha := v_ruta.fecha_fin::date;  -- DATE de negocio tal cual (sin conversión de zona)

  -- Esperado desde los pagos de las órdenes de la ruta (misma regla que el
  -- frontend: Efectivo / Crédito-fiado / todo lo demás es transferencia).
  WITH p AS (
    SELECT pg.id, pg.monto, pg.metodo_pago, pg.orden_id, pg.fecha, pg.created_at, o.folio,
           CASE WHEN btrim(COALESCE(pg.metodo_pago, '')) = 'Efectivo' THEN 'efectivo'
                WHEN btrim(COALESCE(pg.metodo_pago, '')) = 'Crédito' OR lower(btrim(COALESCE(pg.metodo_pago, ''))) IN ('credito', 'fiado') THEN 'credito'
                ELSE 'transferencia' END AS cubo
      FROM pagos pg JOIN ordenes o ON o.id = pg.orden_id WHERE o.ruta_id = p_ruta_id)
  SELECT round(COALESCE(sum(monto) FILTER (WHERE monto > 0 AND cubo = 'efectivo'), 0), 2),
         round(COALESCE(sum(monto) FILTER (WHERE monto > 0 AND cubo = 'transferencia'), 0), 2),
         round(COALESCE(sum(monto) FILTER (WHERE monto > 0 AND cubo = 'credito'), 0), 2),
         COALESCE(jsonb_agg(jsonb_build_object('pago_id', id, 'monto', monto, 'metodo', COALESCE(metodo_pago, ''), 'orden_id', orden_id,
                                               'orden_folio', folio, 'fecha', COALESCE(fecha::text, created_at::text)) ORDER BY id), '[]'::jsonb)
    INTO v_ef, v_tr, v_cr, v_snap FROM p;

  v_dif := round(v_cef + v_ctr - (v_ef + v_tr), 2);
  IF abs(v_dif) > 0 AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Motivo requerido cuando hay diferencia' USING ERRCODE = '22023';
  END IF;
  IF abs(v_dif) > 100 AND length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Diferencia mayor a $100 requiere motivo de al menos 10 caracteres' USING ERRCODE = '22023';
  END IF;

  INSERT INTO cierres_diarios (fecha, ruta_id, chofer_id, esperado_efectivo, esperado_transferencia, esperado_credito, esperado_total,
                               contado_efectivo, contado_transferencia, contado_total, diferencia, motivo_diferencia, cerrado_por, notas,
                               pagos_snapshot, operacion_id, huella)
  VALUES (v_fecha, p_ruta_id, v_ruta.chofer_id, v_ef, v_tr, v_cr, round(v_ef + v_tr + v_cr, 2),
          v_cef, v_ctr, round(v_cef + v_ctr, 2), v_dif, v_motivo, v_etiqueta, v_notas, v_snap, p_operacion_id, v_huella)
  RETURNING id INTO v_id;

  v_dif_txt := CASE WHEN v_dif = 0 THEN 'cuadrado' WHEN v_dif > 0 THEN 'sobrante $' || v_dif ELSE 'faltante $' || abs(v_dif) END;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Cierre caja', 'Conciliación', COALESCE(v_ruta.folio, 'Ruta ' || p_ruta_id) || ' (' || v_fecha || ') — ' || v_dif_txt
          || COALESCE(' — ' || v_motivo, ''));

  RETURN jsonb_build_object('cierre_id', v_id, 'ruta_id', p_ruta_id, 'folio', v_ruta.folio, 'fecha', v_fecha,
    'esperado_efectivo', v_ef, 'esperado_transferencia', v_tr, 'esperado_credito', v_cr, 'esperado_total', round(v_ef + v_tr + v_cr, 2),
    'contado_total', round(v_cef + v_ctr, 2), 'diferencia', v_dif, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.cerrar_caja_ruta(UUID, BIGINT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_caja_ruta(UUID, BIGINT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated, service_role;

-- Rutas pendientes de caja: identidad durable (la ruta tiene o no cierre).
CREATE OR REPLACE FUNCTION public.rutas_pendientes_caja() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'rutas_pendientes_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'folio', r.folio, 'nombre', r.nombre, 'chofer_id', r.chofer_id,
                                                      'chofer_nombre', r.chofer_nombre, 'estatus', r.estatus, 'fecha', r.fecha::date, 'fecha_fin', r.fecha_fin::date)
                                   ORDER BY r.fecha_fin DESC NULLS LAST, r.id DESC)
                     FROM rutas r
                    WHERE r.estatus IN ('Completada', 'Cerrada')
                      AND NOT EXISTS (SELECT 1 FROM cierres_diarios c WHERE c.ruta_id = r.id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rutas_pendientes_caja() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rutas_pendientes_caja() TO authenticated, service_role;
