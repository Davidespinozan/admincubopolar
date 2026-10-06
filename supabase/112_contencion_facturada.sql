-- 112_contencion_facturada.sql — OL-03B (contención; se aplica DESPUÉS de que las
-- Netlify Functions que usan 111 estén publicadas).
--
-- 1. Guarda de base de datos ordenes_guard_facturada, SIN exención de rol (ni
--    service role, ni sesión sin JWT, ni el contexto financiero app.fin_ctx):
--      * INSERT directo como 'Facturada': rechazado.
--      * cualquier estatus → 'Facturada': solo desde 'Entregada', dentro del
--        contexto estrecho app.cfdi_ctx = 'emision' (que solo fija
--        cfdi_aplicar_resultado, 111) y con facturama_id y facturama_uuid.
--      * 'Facturada' → 'Entregada': solo dentro de app.cfdi_ctx = 'cancelacion'
--        y fijando cfdi_cancelado_at (cancelación confirmada del CFDI).
--      * 'Facturada' → cualquier otro estatus: rechazado (no hay camino
--        legítimo evidenciado).
--    No reutiliza app.fin_ctx: lo fijan diez contratos financieros (incluido el
--    cierre de ruta) que no deben poder facturar ni desfacturar.
-- 2. cerrar_ruta_financiero (definición vigente de 090, cambio mínimo): una
--    orden ya Facturada conserva Facturada al cerrar la ruta (antes se
--    regresaba a 'Entregada' con su CFDI vigente). Método de pago, ruta, pago o
--    CxC, validaciones, idempotencia y venta exprés: sin cambio.
--
-- Reversión:
--   DROP TRIGGER IF EXISTS trg_ordenes_guard_facturada ON public.ordenes;
--   DROP FUNCTION IF EXISTS public.ordenes_guard_facturada();
--   y volver a aplicar la definición de cerrar_ruta_financiero de 090.
--   (La contención del servidor de OL-03A y las reservas de 111 siguen vigentes.)

CREATE OR REPLACE FUNCTION public.ordenes_guard_facturada() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx TEXT := COALESCE(current_setting('app.cfdi_ctx', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estatus = 'Facturada' THEN
      RAISE EXCEPTION 'ordenes: una orden no se crea Facturada (se timbra una orden Entregada)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estatus = 'Facturada' AND OLD.estatus IS DISTINCT FROM 'Facturada' THEN
    IF OLD.estatus IS DISTINCT FROM 'Entregada' OR v_ctx <> 'emision'
       OR NEW.facturama_uuid IS NULL OR NEW.facturama_id IS NULL OR NEW.cfdi_cancelado_at IS NOT NULL THEN
      RAISE EXCEPTION 'ordenes: % → Facturada solo por el contrato de timbrado (desde Entregada, con CFDI)', OLD.estatus
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Facturada' AND NEW.estatus IS DISTINCT FROM 'Facturada' THEN
    IF NEW.estatus IS DISTINCT FROM 'Entregada' OR v_ctx <> 'cancelacion'
       OR NEW.cfdi_cancelado_at IS NULL OR OLD.cfdi_cancelado_at IS NOT NULL THEN
      RAISE EXCEPTION 'ordenes: Facturada → % solo por la cancelación confirmada del CFDI', NEW.estatus
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_facturada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ordenes_guard_facturada ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_facturada
  BEFORE INSERT OR UPDATE OF estatus ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_facturada();

CREATE OR REPLACE FUNCTION public.cerrar_ruta_financiero(
  p_operacion_id UUID, p_ruta_id BIGINT, p_entregas JSONB, p_usuario_id BIGINT DEFAULT NULL, p_usuario_nombre TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta    rutas%ROWTYPE;
  v_rol     TEXT;
  v_prev    cierres_financieros_ruta%ROWTYPE;
  v_otra    BIGINT;
  v_huella  TEXT;
  v_actor_id BIGINT;
  v_etiqueta TEXT;
  e         JSONB;
  it        JSONB;
  v_ord     ordenes%ROWTYPE;
  v_metodo  TEXT;
  v_total   NUMERIC;
  v_folio   TEXT;
  v_nuevo_id BIGINT;
  v_cliente_id BIGINT;
  v_factura BOOLEAN;
  v_res     JSONB;
  v_items_str TEXT;
  n_upd INT := 0; n_exp INT := 0; n_pagos INT := 0; n_cxc INT := 0;
  v_saltadas JSONB := '[]'::jsonb;
  v_express  JSONB := '[]'::jsonb;
  v_lin      JSONB;   -- 088: líneas canónicas de la venta exprés
  v_attr     BIGINT := fin_actor_id(p_usuario_id);  -- 088: atribución del servidor
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: ruta requerida' USING ERRCODE = '22023';
  END IF;

  -- Lock de la ruta: serializa cierres concurrentes (misma u otra operación).
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ruta % no existe', p_ruta_id; END IF;

  v_rol := fin_mi_rol_activo();
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer'
     AND v_ruta.chofer_id IS DISTINCT FROM get_my_user_id() THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  IF p_entregas IS NULL OR jsonb_typeof(p_entregas) <> 'array' THEN
    p_entregas := '[]'::jsonb;
  END IF;
  v_huella := fin_huella_cierre(p_ruta_id, p_entregas);

  -- Replay / conflicto: se evalúa ANTES del estado de la ruta, para que un
  -- reintento después de que el JS ya la cerró siga devolviendo el resultado.
  SELECT * INTO v_prev FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true, 'operacion_original', v_prev.operacion_id);
    END IF;
    IF v_prev.operacion_id = p_operacion_id THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado con otros datos (ruta %)', v_ruta.folio USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta % ya tiene cierre financiero registrado con otros datos', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  SELECT ruta_id INTO v_otra FROM cierres_financieros_ruta WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado en la ruta %', v_otra USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'Ruta % ya está %', p_ruta_id, v_ruta.estatus;
  END IF;

  -- 088: validación completa de TODAS las entradas ANTES de cualquier efecto
  -- financiero. Precio canónico (el enviado es solo una aserción), cantidades
  -- enteras positivas, cliente, factura, método de pago y crédito.
  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    v_metodo := NULLIF(btrim(COALESCE(e->>'pago', '')), '');
    IF v_metodo IS NOT NULL AND v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      CONTINUE;
    END IF;
    v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
    IF v_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cliente_id) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: cliente no encontrado: %', v_cliente_id USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'factura')::boolean, false) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado' USING ERRCODE = '22023';
      END IF;
      IF (SELECT upper(btrim(COALESCE(rfc, ''))) FROM clientes WHERE id = v_cliente_id) IN ('', 'XAXX010101000', 'XEXX010101000') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el cliente de la venta exprés no tiene RFC nominativo para facturar' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                               FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
    FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) LOOP
      IF NULLIF(it->>'precio', '') IS NOT NULL
         AND round((it->>'precio')::numeric, 2) IS DISTINCT FROM precio_canonico(v_cliente_id, it->>'sku') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el precio de % (%) no coincide con el precio vigente (%)', it->>'sku', it->>'precio', precio_canonico(v_cliente_id, it->>'sku')
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF fin_es_credito(COALESCE(v_metodo, 'Efectivo')) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: la venta exprés a crédito requiere un cliente registrado' USING ERRCODE = '22023';
      END IF;
      PERFORM fin_validar_credito(v_cliente_id, (v_lin->>'total')::numeric);
    END IF;
  END LOOP;

  v_actor_id := erp_usuario_id();
  v_etiqueta := erp_actor_etiqueta();
  PERFORM fin_marcar_ctx();

  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      -- ── Entrega de una orden existente ──
      SELECT * INTO v_ord FROM ordenes WHERE id = (e->>'ordenId')::bigint FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Orden % de la entrega no existe', e->>'ordenId'; END IF;
      IF v_ord.estatus IN ('Cancelada', 'No entregada') THEN
        RAISE EXCEPTION 'Orden % está % y no puede cerrarse como entregada', v_ord.folio, v_ord.estatus;
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), v_ord.metodo_pago, 'Efectivo');

      -- 112 (OL-03B): una orden ya Facturada CONSERVA Facturada (y su CFDI);
      -- el resto del cierre (método, ruta, pago o CxC) no cambia.
      UPDATE ordenes
         SET estatus = 'Entregada', metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id AND estatus <> 'Facturada';
      UPDATE ordenes
         SET metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id AND estatus = 'Facturada';
      n_upd := n_upd + 1;

      v_total := round(COALESCE(v_ord.total, 0), 2);
      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_ord.cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_ord.id, 15);
          IF (v_res->>'creada')::boolean THEN n_cxc := n_cxc + 1; END IF;
        ELSE
          v_res := registrar_pago_orden(v_ord.id, v_metodo, e->>'referencia', v_attr);
          IF (v_res->>'aplicado')::boolean THEN
            n_pagos := n_pagos + 1;
          ELSE
            v_saltadas := v_saltadas || jsonb_build_object('orden_id', v_ord.id, 'folio', v_ord.folio, 'motivo', v_res->>'motivo');
          END IF;
        END IF;
      END IF;
    ELSE
      -- ── Venta exprés ──
      v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
      v_factura := COALESCE((e->>'factura')::boolean, false);
      IF v_factura AND v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado';
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), 'Efectivo');

      -- 088: líneas, precios y total del servidor (validados arriba).
      v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                                 FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
      v_total := (v_lin->>'total')::numeric;
      v_items_str := v_lin->>'productos';

      v_folio := (SELECT 'OV-' || lpad(q.s, greatest(4, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_ov_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, ruta_id, requiere_factura, vendedor_id, tipo_cobro)
      VALUES (v_folio, v_cliente_id, COALESCE(NULLIF(e->>'cliente', ''), 'Público en general'),
              COALESCE(v_items_str, 'Varios'), fin_hoy(), v_total, 'Entregada', v_metodo, p_ruta_id, v_factura, v_attr,
              CASE WHEN fin_es_credito(v_metodo) THEN 'Credito' ELSE 'Contado' END)
      RETURNING id INTO v_nuevo_id;
      n_exp := n_exp + 1;
      v_express := v_express || jsonb_build_object('id', v_nuevo_id, 'folio', v_folio, 'total', v_total);

      INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
      SELECT v_nuevo_id, l->>'sku', (l->>'cantidad')::int, (l->>'precio_unit')::numeric, (l->>'subtotal')::numeric
        FROM jsonb_array_elements(v_lin->'lineas') l;

      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_nuevo_id, 15);
          n_cxc := n_cxc + 1;
        ELSE
          v_res := registrar_pago_orden(v_nuevo_id, v_metodo, e->>'referencia', v_attr);
          n_pagos := n_pagos + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  v_res := jsonb_build_object(
    'success', true, 'ruta_id', p_ruta_id, 'folio', v_ruta.folio,
    'ordenes_entregadas', n_upd, 'ventas_express', n_exp, 'ordenes_express', v_express,
    'pagos', n_pagos, 'cxc', n_cxc, 'saltadas', v_saltadas,
    'operacion_id', p_operacion_id, 'huella', v_huella, 'actor', v_etiqueta, 'cerrado_at', now(), 'replay', false
  );
  -- La marca de idempotencia vive en la MISMA transacción que los efectos:
  -- si algo falló arriba, no existe.
  INSERT INTO cierres_financieros_ruta (ruta_id, operacion_id, huella, actor_id, actor, resultado)
  VALUES (p_ruta_id, p_operacion_id, v_huella, v_actor_id, v_etiqueta, v_res);

  RETURN v_res;
END $$;
