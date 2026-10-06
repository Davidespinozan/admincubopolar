-- 109_venta_directa_atomica.sql — OL-02B: venta directa de planta (mostrador)
-- como UN contrato atómico. Aditiva: no cambia contratos, guardas, RLS, ni el
-- flujo de ruta/chofer; no repara historia.
--
-- Decisiones del dueño (OL-02):
--   * La venta directa es de mostrador/planta: completarla significa que el
--     hielo sale físicamente, baja la existencia del cuarto, se registra el
--     pago o la CxC y la orden queda Entregada. Todo o nada.
--   * Fuente física de producto terminado: cuartos_frios.stock. El cliente
--     manda la asignación EXPLÍCITA por SKU y cuarto (puede repartir un SKU
--     entre cuartos); el servidor la valida y NUNCA elige el cuarto (sin FIFO,
--     sin orden por id, sin cuarto por defecto). productos.stock no se toca.
--   * Ventas completa SOLO sus órdenes (ordenes.vendedor_id, que fija
--     crear_orden con el actor canónico); Admin, cualquier orden elegible.
--   * Elegibles: Creada o Asignada, SIEMPRE sin ruta (ruta_id IS NULL tras
--     bloquear la orden). Con ruta, la entrega y el cobro son del chofer.
--   * Modos:
--       contado      Efectivo | Transferencia SPEI | Tarjeta (terminal):
--                    registrar_pago_orden (pago + ingreso, sus reglas).
--       credito      Crédito (fiado): crear_cxc_orden a 30 días (la ruta
--                    conserva sus 15 en cerrar_ruta_financiero).
--       pagado_link  QR / Link de pago: NO crea pago; exige que el pago del
--                    proveedor (webhook) ya cubra el total. El webhook nunca
--                    entrega ni mueve inventario.
--   * Creada → Entregada solo dentro de este contrato (contexto fin_ctx): el
--     guard de ordenes y la FSM REST NO se relajan.
--   * La salida manual 'Venta directa' (salida_cuarto_manual) queda igual.
--     Regla operativa: una venta ligada a una orden se completa con
--     completar_venta_directa y NO se descuenta además a mano.
--
-- Idempotencia: stock_operaciones (tipo 'venta_directa'). La huella (clave) es
-- el JSON canónico de: orden, modo, método, referencia, folio de nota y la
-- asignación normalizada (ordenada por SKU y cuarto). Mismo UUID + misma
-- huella → replay del resultado original; mismo UUID + otra huella → 23505.
-- Una transacción fallida no deja registro de operación.
--
-- Orden de bloqueo: orden (FOR UPDATE) → candado de la operación → cuartos de
-- la asignación por id (FOR UPDATE; mismo orden que carga de ruta y traspaso)
-- → cliente (solo crédito, dentro de fin_validar_credito).

-- ═══ 0. Tipo de operación ═══
ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta', 'recepcion_compra', 'salida_empaque',
                  'reverso_produccion', 'ajuste_existencia', 'ajuste_cuarto', 'merma_cuarto', 'devolucion_cliente', 'venta_directa'));

-- ═══ 1. Contrato ═══
CREATE OR REPLACE FUNCTION public.completar_venta_directa(
  p_operacion_id UUID,
  p_orden_id     BIGINT,
  p_modo         TEXT,
  p_metodo       TEXT,
  p_asignacion   JSONB,
  p_referencia   TEXT DEFAULT NULL,
  p_folio_nota   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt        TEXT := fin_jwt_role();
  v_rol        TEXT;
  v_actor_id   BIGINT := erp_usuario_id();
  v_etiqueta   TEXT := erp_actor_etiqueta();
  v_modo       TEXT := btrim(COALESCE(p_modo, ''));
  v_metodo     TEXT := btrim(COALESCE(p_metodo, ''));
  v_ref        TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
  v_nota       TEXT := NULLIF(btrim(COALESCE(p_folio_nota, '')), '');
  v_el         JSONB;
  v_sku        TEXT;
  v_cuarto     TEXT;
  v_cant       NUMERIC;
  v_asig       JSONB;
  v_clave      TEXT;
  v_prev       JSONB;
  v_ord        ordenes%ROWTYPE;
  v_faltan     TEXT;
  v_sobran     TEXT;
  v_desc       TEXT;
  v_rooms      TEXT[];
  v_n_rooms    INTEGER;
  v_a          RECORD;
  v_disp       INTEGER;
  v_pagado     NUMERIC;
  v_pend       NUMERIC;
  v_fin        JSONB;
  v_pago       JSONB := NULL;
  v_cxc        JSONB := NULL;
  v_ord_fin    ordenes%ROWTYPE;
  v_res        JSONB;
BEGIN
  -- 1. Autorización ANTES de marcar el contexto (dentro de fin_ctx los
  --    contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'completar_venta_directa: no autorizado' USING ERRCODE = '42501';
  END IF;
  v_rol := CASE WHEN v_jwt = 'authenticated' THEN COALESCE(fin_mi_rol_activo(), '') ELSE 'Sistema' END;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: operación y orden requeridas' USING ERRCODE = '22023';
  END IF;

  -- 2. Modo y método (las cadenas que ya usan Ventas y Admin).
  IF v_modo NOT IN ('contado', 'credito', 'pagado_link') THEN
    RAISE EXCEPTION 'completar_venta_directa: modo inválido (contado, credito, pagado_link)' USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_modo = 'contado' AND v_metodo IN ('Efectivo', 'Transferencia SPEI', 'Tarjeta (terminal)'))
       OR (v_modo = 'credito' AND v_metodo = 'Crédito (fiado)')
       OR (v_modo = 'pagado_link' AND v_metodo = 'QR / Link de pago')) THEN
    RAISE EXCEPTION 'completar_venta_directa: el método % no corresponde al modo %', v_metodo, v_modo USING ERRCODE = '22023';
  END IF;

  -- 3. Asignación: arreglo de {sku, cuarto_id, cantidad}; cantidades enteras
  --    > 0; sin pares (sku, cuarto) repetidos. Otras llaves se ignoran.
  IF p_asignacion IS NULL OR jsonb_typeof(p_asignacion) <> 'array' OR jsonb_array_length(p_asignacion) = 0 THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación debe ser una lista de {sku, cuarto_id, cantidad}' USING ERRCODE = '22023';
  END IF;
  v_asig := '[]'::jsonb;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_asignacion) LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR jsonb_typeof(v_el -> 'sku') IS DISTINCT FROM 'string' OR jsonb_typeof(v_el -> 'cuarto_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_el -> 'cantidad') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'completar_venta_directa: cada partida requiere sku, cuarto_id y cantidad' USING ERRCODE = '22023';
    END IF;
    v_sku := btrim(v_el ->> 'sku'); v_cuarto := btrim(v_el ->> 'cuarto_id'); v_cant := (v_el ->> 'cantidad')::NUMERIC;
    IF v_sku = '' OR v_cuarto = '' THEN
      RAISE EXCEPTION 'completar_venta_directa: sku y cuarto_id no pueden estar vacíos' USING ERRCODE = '22023';
    END IF;
    IF v_cant <= 0 OR v_cant <> trunc(v_cant) OR v_cant > 2147483647 THEN
      RAISE EXCEPTION 'completar_venta_directa: cantidad inválida para % en % (entero mayor a 0)', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = v_sku AND e.value ->> 'cuarto_id' = v_cuarto) THEN
      RAISE EXCEPTION 'completar_venta_directa: % en % aparece más de una vez', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    v_asig := v_asig || jsonb_build_array(jsonb_build_object('sku', v_sku, 'cuarto_id', v_cuarto, 'cantidad', v_cant::INTEGER));
  END LOOP;
  -- Forma canónica (ordenada por SKU y cuarto): base de la huella y del recorrido.
  SELECT jsonb_agg(e.value ORDER BY e.value ->> 'sku', e.value ->> 'cuarto_id') INTO v_asig FROM jsonb_array_elements(v_asig) e;
  v_clave := jsonb_build_object('orden', p_orden_id, 'modo', v_modo, 'metodo', v_metodo, 'referencia', v_ref, 'folio_nota', v_nota, 'asignacion', v_asig)::text;

  -- 4. Orden bloqueada; propiedad (Ventas: solo sus órdenes).
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'completar_venta_directa: orden % no existe', p_orden_id USING ERRCODE = '22023';
  END IF;
  IF v_rol = 'Ventas' AND v_ord.vendedor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no es de este vendedor', v_ord.folio USING ERRCODE = '42501';
  END IF;

  -- 5. Idempotencia (mismo UUID + misma huella → resultado original).
  v_prev := stock_op_replay(p_operacion_id, 'venta_directa', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- 6. Elegibilidad con la orden ya bloqueada.
  IF v_ord.ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % tiene ruta; la entrega y el cobro son del chofer', v_ord.folio USING ERRCODE = '22023';
  END IF;
  IF v_ord.estatus NOT IN ('Creada', 'Asignada') THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % está % (se requiere Creada o Asignada sin ruta)', v_ord.folio, v_ord.estatus USING ERRCODE = '22023';
  END IF;

  -- 7. La asignación cubre EXACTAMENTE las líneas de la orden.
  IF NOT EXISTS (SELECT 1 FROM orden_lineas WHERE orden_id = p_orden_id AND cantidad > 0) THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no tiene líneas', v_ord.folio USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(l.sku || ' (' || l.q || ')', ', ' ORDER BY l.sku) INTO v_faltan
    FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku HAVING SUM(cantidad) > 0) l
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: falta asignar %', v_faltan USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(DISTINCT e.value ->> 'sku', ', ') INTO v_sobran FROM jsonb_array_elements(v_asig) e
   WHERE NOT EXISTS (SELECT 1 FROM orden_lineas l WHERE l.orden_id = p_orden_id AND l.sku = e.value ->> 'sku' AND l.cantidad > 0);
  IF v_sobran IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: % no está en la orden', v_sobran USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(x.sku || ': asignado ' || x.asig || ', orden ' || x.q, '; ' ORDER BY x.sku) INTO v_desc
    FROM (SELECT l.sku, l.q, (SELECT SUM((e.value ->> 'cantidad')::INTEGER) FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku) AS asig
            FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku) l) x
   WHERE x.asig IS DISTINCT FROM x.q;
  IF v_desc IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación no coincide con la orden (%)', v_desc USING ERRCODE = '22023';
  END IF;

  -- 8. Cuartos de la asignación, bloqueados en orden de id; existencia.
  SELECT array_agg(DISTINCT e.value ->> 'cuarto_id' ORDER BY e.value ->> 'cuarto_id') INTO v_rooms FROM jsonb_array_elements(v_asig) e;
  SELECT count(*) INTO v_n_rooms FROM (SELECT 1 FROM cuartos_frios WHERE id = ANY (v_rooms) ORDER BY id FOR UPDATE) k;
  IF v_n_rooms <> array_length(v_rooms, 1) THEN
    RAISE EXCEPTION 'completar_venta_directa: cuarto inexistente en la asignación (%)',
      (SELECT string_agg(r, ', ') FROM unnest(v_rooms) r WHERE NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = r)) USING ERRCODE = '22023';
  END IF;
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    SELECT COALESCE((stock ->> v_a.sku)::INTEGER, 0) INTO v_disp FROM cuartos_frios WHERE id = v_a.cuarto_id;
    IF v_disp < v_a.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%', v_a.sku, v_a.cuarto_id, v_disp, v_a.cantidad USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 9. pagado_link: el pago del proveedor ya cubre el total (sin pago nuevo).
  IF v_modo = 'pagado_link' THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
    v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
    IF COALESCE(v_ord.total, 0) <= 0 OR v_pend > 0 THEN
      RAISE EXCEPTION 'completar_venta_directa: el link de pago de % no cubre el total (pendiente %)', v_ord.folio, greatest(v_pend, 0) USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 10. Registro de la operación (la FK del kardex lo exige antes del movimiento).
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, orden_id, resultado)
  VALUES (p_operacion_id, 'venta_directa', v_clave, v_actor_id, v_etiqueta, p_orden_id, '{}'::jsonb);

  PERFORM fin_marcar_ctx();

  -- 11. Salida física: SOLO de los cuartos asignados, con kardex ligado a la orden.
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    PERFORM stock_mov_cuarto(v_a.cuarto_id, v_a.sku, -v_a.cantidad, 'Salida', 'Venta directa ' || COALESCE(v_ord.folio, 'Orden ' || p_orden_id),
                             COALESCE(NULLIF(v_ord.cliente_nombre, ''), 'Cliente'), 'venta_directa/' || p_orden_id, v_etiqueta, NULL, p_operacion_id);
  END LOOP;

  -- 12. Entregada (fecha de entrega e ingreso devengado por el trigger 093).
  UPDATE ordenes
     SET estatus = 'Entregada', metodo_pago = v_metodo, folio_nota = COALESCE(v_nota, folio_nota)
   WHERE id = p_orden_id;

  -- 13. Dinero: pago o CxC por los contratos existentes; un resultado no
  --     aplicado revierte TODO (nunca Entregada sin pago ni CxC).
  IF v_modo = 'contado' THEN
    v_fin := registrar_pago_orden(p_orden_id, v_metodo, v_ref, v_actor_id);
    IF COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: el pago no se aplicó (%)', COALESCE(v_fin ->> 'motivo', 'sin motivo') USING ERRCODE = '22023';
    END IF;
    v_pago := v_fin;
  ELSIF v_modo = 'credito' THEN
    v_fin := crear_cxc_orden(p_orden_id, 30);
    IF COALESCE((v_fin ->> 'creada')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: la CxC no se creó (%)', COALESCE(v_fin ->> 'motivo', 'ya existía') USING ERRCODE = '22023';
    END IF;
    v_cxc := v_fin;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Venta directa', 'Órdenes', COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || v_modo || ' (' || v_metodo || '). Salida: '
          || (SELECT string_agg((e.value ->> 'cantidad') || '×' || (e.value ->> 'sku') || ' de ' || (e.value ->> 'cuarto_id'), ', ' ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku') FROM jsonb_array_elements(v_asig) e));

  SELECT * INTO v_ord_fin FROM ordenes WHERE id = p_orden_id;
  v_res := jsonb_build_object('orden_id', p_orden_id, 'folio', v_ord.folio, 'estatus', v_ord_fin.estatus, 'estatus_anterior', v_ord.estatus,
                              'modo', v_modo, 'metodo', v_metodo, 'total', v_ord.total, 'pago', v_pago, 'cxc', v_cxc, 'asignacion', v_asig,
                              'delivered_at', v_ord_fin.delivered_at, 'actor', v_etiqueta, 'actor_id', v_actor_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;
