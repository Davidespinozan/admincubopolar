-- 104_devolucion_canonica.sql — parte 1 de 2 (aditiva). La parte 2
-- (105_contencion_devoluciones.sql) se aplica DESPUÉS de desplegar el
-- frontend que usa registrar_devolucion.
--
-- Devolución de cliente por contrato (no había historia: 0 devoluciones):
--   - UNA devolución por orden (UNIQUE(orden_id)), con cantidades parciales
--     por SKU. Solo órdenes Entregada/Facturada. Solo Admin.
--   - El cliente manda solo SKU y cantidad; precio (de la línea original de
--     la orden), total, cliente, cobrado, CxC y reembolso los deriva el
--     servidor.
--   - Disposición física: 'Reintegrar' (entra SOLO al cuarto elegido, vía
--     stock_mov_cuarto, kardex devolucion/<id>) o 'Merma' (producto dañado:
--     no entra a inventario ni descuenta ningún cuarto; queda registrado en
--     la devolución). Sin ida y vuelta artificial de inventario.
--   - Tipos: 'Efectivo' (reembolso real, tope = dinero cobrado de la orden)
--     y 'Nota credito' (solo ventas a crédito: reduce la CxC; en contado se
--     niega porque no existe saldo a favor). 'Reposicion' bloqueada hasta
--     que exista el flujo de reposición.
--   - CxC: se reduce min(valor, pendiente); clientes.saldo baja exactamente
--     lo mismo (corrige la sobre-reducción de ajustar_cxc_devolucion).
--   - Un solo egreso de reembolso (categoría Devoluciones, DEVOL-<id>,
--     fin_hoy()). Orden facturada: requiere_nota_credito (nota fiscal
--     pendiente; nunca un UUID ficticio).
--   - Idempotente por operación (stock_operaciones + devoluciones.operacion_id).
-- Idempotente. No modifica datos existentes.

-- ═══ 0. Precondición: sin historia de devoluciones ═══
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devoluciones' AND column_name = 'operacion_id')
     AND EXISTS (SELECT 1 FROM devoluciones) THEN
    RAISE EXCEPTION '104: hay devoluciones previas; no se aplica sin revisión' USING ERRCODE = '55000';
  END IF;
END $$;

-- ═══ 1. Esquema ═══
ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta', 'recepcion_compra', 'salida_empaque',
                  'reverso_produccion', 'ajuste_existencia', 'ajuste_cuarto', 'merma_cuarto', 'devolucion_cliente'));

ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS operacion_id UUID;
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS disposicion TEXT NOT NULL DEFAULT 'Reintegrar';
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS cobrado NUMERIC(12,2);
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS cxc_reducido NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS reembolso NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS egreso_id BIGINT REFERENCES movimientos_contables(id) ON DELETE RESTRICT;
ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS usuario_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_orden_key ON devoluciones (orden_id);
CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_operacion_key ON devoluciones (operacion_id) WHERE operacion_id IS NOT NULL;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('devoluciones_disposicion', $c$CHECK (disposicion IN ('Reintegrar', 'Merma'))$c$),
    ('devoluciones_destino', $c$CHECK ((disposicion = 'Reintegrar') = (cuarto_destino IS NOT NULL))$c$),
    ('devoluciones_montos', 'CHECK (cxc_reducido >= 0 AND reembolso >= 0 AND cxc_reducido + reembolso <= total)')
  ) x(n, d) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.n) THEN
      EXECUTE format('ALTER TABLE public.devoluciones ADD CONSTRAINT %I %s', r.n, r.d);
    END IF;
  END LOOP;
END $$;

-- ═══ 2. Contrato ═══
CREATE OR REPLACE FUNCTION public.registrar_devolucion(
  p_operacion_id UUID, p_orden_id BIGINT, p_items JSONB, p_tipo_reembolso TEXT, p_disposicion TEXT,
  p_cuarto_id TEXT DEFAULT NULL, p_motivo TEXT DEFAULT NULL, p_notas TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_tipo     TEXT := btrim(COALESCE(p_tipo_reembolso, ''));
  v_disp     TEXT := btrim(COALESCE(p_disposicion, ''));
  v_cuarto   TEXT := NULLIF(btrim(COALESCE(p_cuarto_id, '')), '');
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_notas    TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_ord      RECORD;
  v_cf       RECORD;
  v_it       RECORD;
  v_items    JSONB := '[]'::jsonb;
  v_clave    TEXT;
  v_prev     JSONB;
  v_total    NUMERIC := 0;
  v_cxc      cuentas_por_cobrar%ROWTYPE;
  v_tiene_cxc BOOLEAN := false;
  v_cobrado  NUMERIC;
  v_metodos  TEXT;
  v_red_cxc  NUMERIC := 0;
  v_red_cli  NUMERIC := 0;
  v_reemb    NUMERIC := 0;
  v_saldo_cli NUMERIC;
  v_dev_id   BIGINT;
  v_mov_id   BIGINT;
  v_fiscal   BOOLEAN;
  v_manual   BOOLEAN := false;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'registrar_devolucion: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'registrar_devolucion: operación y orden son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'Reposicion' THEN
    RAISE EXCEPTION 'La reposición está bloqueada hasta que exista el flujo de reposición (salida del producto de reemplazo)' USING ERRCODE = '22023';
  END IF;
  IF v_tipo NOT IN ('Efectivo', 'Nota credito') THEN
    RAISE EXCEPTION 'Tipo de reembolso inválido' USING ERRCODE = '22023';
  END IF;
  IF v_disp NOT IN ('Reintegrar', 'Merma') THEN
    RAISE EXCEPTION 'Disposición inválida (Reintegrar o Merma)' USING ERRCODE = '22023';
  END IF;
  IF v_disp = 'Reintegrar' AND v_cuarto IS NULL THEN
    RAISE EXCEPTION 'Selecciona el cuarto frío donde se reintegra el producto' USING ERRCODE = '22023';
  END IF;
  IF v_disp = 'Merma' THEN v_cuarto := NULL; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Motivo requerido' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Captura al menos un producto a devolver' USING ERRCODE = '22023';
  END IF;

  -- Partidas: solo SKU y cantidad entera > 0, sin SKU repetido.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
              WHERE jsonb_typeof(e) <> 'object' OR btrim(COALESCE(e ->> 'sku', '')) = ''
                 OR COALESCE(e ->> 'cantidad', '') !~ '^[0-9]+$' OR (e ->> 'cantidad')::INTEGER <= 0) THEN
    RAISE EXCEPTION 'Cada partida necesita SKU y una cantidad entera mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT btrim(e ->> 'sku')) FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'SKU repetido en la devolución' USING ERRCODE = '22023';
  END IF;
  v_clave := 'devolucion|' || p_orden_id || '|' || v_tipo || '|' || v_disp || '|' || COALESCE(v_cuarto, '') || '|' || v_motivo || '|' || COALESCE(v_notas, '') || '|'
             || (SELECT string_agg(btrim(e ->> 'sku') || ':' || (e ->> 'cantidad')::INTEGER, ',' ORDER BY btrim(e ->> 'sku')) FROM jsonb_array_elements(p_items) e);

  -- Orden primero (serializa toda devolución sobre ella), luego replay.
  SELECT id, folio, estatus, cliente_id, total INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE = '22023'; END IF;
  v_prev := stock_op_replay(p_operacion_id, 'devolucion_cliente', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  IF EXISTS (SELECT 1 FROM devoluciones WHERE orden_id = p_orden_id) THEN
    RAISE EXCEPTION 'La orden % ya tiene una devolución registrada (una por orden)', COALESCE(v_ord.folio, p_orden_id::text) USING ERRCODE = '23505';
  END IF;
  IF v_ord.estatus NOT IN ('Entregada', 'Facturada') THEN
    RAISE EXCEPTION 'Solo se devuelven órdenes Entregadas o Facturadas (estatus actual: %)', v_ord.estatus USING ERRCODE = '22023';
  END IF;

  -- Cantidades y precio desde las líneas originales de la orden.
  FOR v_it IN
    SELECT btrim(e ->> 'sku') AS sku, (e ->> 'cantidad')::INTEGER AS q, l.entregado, l.subtotal
      FROM jsonb_array_elements(p_items) e
      LEFT JOIN (SELECT sku, sum(cantidad)::INTEGER AS entregado, sum(COALESCE(subtotal, cantidad * precio_unit)) AS subtotal
                   FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku) l ON l.sku = btrim(e ->> 'sku')
     ORDER BY 1
  LOOP
    IF v_it.entregado IS NULL OR v_it.entregado <= 0 THEN
      RAISE EXCEPTION '% no estaba en la orden', v_it.sku USING ERRCODE = '22023';
    END IF;
    IF v_it.q > v_it.entregado THEN
      RAISE EXCEPTION '%: máximo % (entregado), pediste %', v_it.sku, v_it.entregado, v_it.q USING ERRCODE = '22023';
    END IF;
    v_items := v_items || jsonb_build_object('sku', v_it.sku, 'cantidad', v_it.q,
                 'precio_unitario', round(v_it.subtotal / v_it.entregado, 2), 'subtotal', round(v_it.q * v_it.subtotal / v_it.entregado, 2));
    v_total := v_total + round(v_it.q * v_it.subtotal / v_it.entregado, 2);
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total devuelto debe ser mayor a 0' USING ERRCODE = '22023'; END IF;

  IF v_disp = 'Reintegrar' THEN
    SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuarto frío no encontrado: %', v_cuarto USING ERRCODE = '22023'; END IF;
  END IF;

  -- Dinero: CxC (crédito) y lo realmente cobrado de la orden (pagos reales).
  PERFORM fin_marcar_ctx();
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id FOR UPDATE;
  v_tiene_cxc := FOUND;
  SELECT round(COALESCE(sum(monto), 0), 2), string_agg(DISTINCT metodo_pago, ', ')
    INTO v_cobrado, v_metodos
    FROM pagos WHERE orden_id = p_orden_id AND lower(COALESCE(metodo_pago, '')) NOT IN ('crédito', 'credito', 'fiado');

  IF v_tiene_cxc THEN
    v_red_cxc := least(v_total, round(GREATEST(COALESCE(v_cxc.saldo_pendiente, 0), 0), 2));
    IF v_tipo = 'Nota credito' AND v_total > v_red_cxc THEN
      RAISE EXCEPTION 'La nota de crédito (%) excede lo pendiente de la cuenta (%): la parte ya cobrada solo se puede reembolsar en efectivo', v_total, v_red_cxc
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_tipo = 'Nota credito' THEN
    RAISE EXCEPTION 'Nota de crédito no disponible en ventas de contado: no existe saldo a favor del cliente' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'Efectivo' THEN
    v_reemb := least(v_total - v_red_cxc, v_cobrado);
    v_manual := v_reemb > 0 AND EXISTS (SELECT 1 FROM pagos WHERE orden_id = p_orden_id AND metodo_pago IS DISTINCT FROM 'Efectivo'
                                          AND lower(COALESCE(metodo_pago, '')) NOT IN ('crédito', 'credito', 'fiado'));
  END IF;
  v_fiscal := v_ord.estatus = 'Facturada';

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado, orden_id)
  VALUES (p_operacion_id, 'devolucion_cliente', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb, p_orden_id);

  INSERT INTO devoluciones (orden_id, cliente_id, motivo, tipo_reembolso, total, items, cuarto_destino, usuario, notas, requiere_nota_credito,
                            operacion_id, disposicion, cobrado, cxc_reducido, reembolso, usuario_id)
  VALUES (p_orden_id, v_ord.cliente_id, v_motivo, v_tipo, v_total, v_items, v_cuarto, v_etiqueta, v_notas, v_fiscal,
          p_operacion_id, v_disp, v_cobrado, v_red_cxc, v_reemb, v_actor_id)
  RETURNING id INTO v_dev_id;

  -- Físico: solo el cuarto elegido; la merma no toca ningún cuarto.
  IF v_disp = 'Reintegrar' THEN
    FOR v_it IN SELECT e ->> 'sku' AS sku, (e ->> 'cantidad')::INTEGER AS q FROM jsonb_array_elements(v_items) e ORDER BY 1 LOOP
      PERFORM stock_mov_cuarto(v_cuarto, v_it.sku, v_it.q, 'Devolución cliente', 'Devolución ' || COALESCE(v_ord.folio, p_orden_id::text), NULL,
                               'devolucion/' || v_dev_id, v_etiqueta, NULL, p_operacion_id);
    END LOOP;
  END IF;

  -- CxC y saldo del cliente: exactamente lo que baja la cuenta.
  IF v_tiene_cxc AND v_red_cxc > 0 THEN
    UPDATE cuentas_por_cobrar
       SET monto_original = greatest(0, round(COALESCE(monto_original, 0) - v_red_cxc - v_reemb, 2)),
           monto_pagado   = greatest(0, round(COALESCE(monto_pagado, 0) - v_reemb, 2)),
           saldo_pendiente = round(COALESCE(saldo_pendiente, 0) - v_red_cxc, 2),
           estatus = CASE WHEN round(COALESCE(saldo_pendiente, 0) - v_red_cxc, 2) <= 0 THEN 'Pagada'
                          WHEN COALESCE(monto_pagado, 0) - v_reemb > 0 THEN 'Parcial' ELSE 'Pendiente' END
     WHERE id = v_cxc.id;
    IF v_cxc.cliente_id IS NOT NULL THEN
      SELECT COALESCE(saldo, 0) INTO v_saldo_cli FROM clientes WHERE id = v_cxc.cliente_id FOR UPDATE;
      v_red_cli := least(v_red_cxc, greatest(v_saldo_cli, 0));
      UPDATE clientes SET saldo = round(COALESCE(saldo, 0) - v_red_cli, 2) WHERE id = v_cxc.cliente_id;
    END IF;
  ELSIF v_tiene_cxc AND v_reemb > 0 THEN
    UPDATE cuentas_por_cobrar
       SET monto_original = greatest(0, round(COALESCE(monto_original, 0) - v_reemb, 2)),
           monto_pagado   = greatest(0, round(COALESCE(monto_pagado, 0) - v_reemb, 2))
     WHERE id = v_cxc.id;
  END IF;

  -- Reembolso real (un egreso), registrado por CuboPolar; si el cobro fue
  -- electrónico, se etiqueta como registrado manualmente (sin reembolso del procesador).
  IF v_reemb > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, orden_id, usuario_id)
    VALUES (fin_hoy(), 'Egreso', 'Devoluciones',
            'Reembolso devolución ' || COALESCE(v_ord.folio, p_orden_id::text)
              || CASE WHEN v_manual THEN ' — registrado manualmente (cobro original: ' || COALESCE(v_metodos, '?') || '; sin reembolso en el procesador)' ELSE '' END,
            v_reemb, 'DEVOL-' || v_dev_id, p_orden_id, v_actor_id)
    RETURNING id INTO v_mov_id;
    UPDATE devoluciones SET egreso_id = v_mov_id WHERE id = v_dev_id;
  END IF;

  UPDATE ordenes SET tiene_devolucion = true WHERE id = p_orden_id;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Devolución', 'Órdenes', COALESCE(v_ord.folio, p_orden_id::text) || ' — ' || v_tipo || ' — ' || v_disp
          || COALESCE(' a ' || v_cuarto, '') || ' — $' || v_total || ' (CxC −' || v_red_cxc || ', reembolso ' || v_reemb || ') — ' || v_motivo);

  v_res := jsonb_build_object('devolucion_id', v_dev_id, 'orden_id', p_orden_id, 'folio', v_ord.folio, 'total', v_total, 'items', v_items,
    'tipo_reembolso', v_tipo, 'disposicion', v_disp, 'cuarto_id', v_cuarto, 'cobrado', v_cobrado, 'cxc_reducido', v_red_cxc,
    'saldo_cliente_reducido', v_red_cli, 'reembolso', v_reemb, 'reembolso_manual', v_manual, 'egreso_id', v_mov_id,
    'requiere_nota_credito', v_fiscal, 'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.registrar_devolucion(UUID, BIGINT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion(UUID, BIGINT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
