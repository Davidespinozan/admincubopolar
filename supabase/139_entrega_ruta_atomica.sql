-- 139_entrega_ruta_atomica.sql — T5-B: una entrega de ruta a crédito nunca queda
-- confirmada sin su cuenta por cobrar.
--
-- Causa raíz (auditoría final 2026-10-10, confirmada en código): la entrega de una
-- orden de ruta eran DOS escrituras independientes del cliente — un UPDATE a
-- `Entregada` y, después, `crear_cxc_orden` (fiado) o `registrar_pago_orden`
-- (contado). Si la segunda fallaba (cliente sin crédito, o con límite 0 o ya en su
-- límite: `fin_validar_credito` lo rechaza), el cliente intentaba regresar el
-- estatus por API y la guarda de 105 lo prohíbe: la orden quedaba Entregada, con
-- método Crédito, sin deuda ni cobro, y el cierre financiero de la ruta abortaba
-- al reintentar el crédito. El teléfono del chofer además trataba límite 0 como
-- "sin límite".
--
-- Regla (decisión del dueño): crédito autorizado explícito; límite 0 = sin
-- capacidad (así lo calcula ya `fin_validar_credito`, que NO cambia); el crédito
-- lo valida el servidor con el cliente bloqueado; crédito insuficiente = rechazo
-- ANTES de confirmar la entrega; nunca se registra un cobro que no ocurrió.
--
--   1. `entregar_orden_ruta(operación, orden, método, nota, referencia)` — NUEVO.
--      Una transacción: candado de la ruta → candado de la orden → Entregada (pasa
--      por la guarda de carga de 138) → `crear_cxc_orden` (fiado, 30 días, valida
--      crédito) o `registrar_pago_orden` (contado) o nada (link: el dinero llega
--      por el webhook). Si cualquier paso falla no queda NADA. Idempotente por el
--      estado de la orden: repetirla no duplica deuda ni cobro. Si la orden ya
--      estaba Entregada SIN registro financiero (estado anterior a 139), la misma
--      llamada lo resuelve con el método elegido — esa es la salida segura, sin
--      SQL. Una entrega ya resuelta no cambia de modalidad por aquí.
--      Admin, o el Chofer de esa ruta. Deja línea en auditoría.
--   2. `ordenes_guard_credito_entrega` — disparador BEFORE UPDATE en `ordenes`:
--      fuera de un contrato, ninguna escritura deja una orden Entregada/Facturada
--      con método de crédito (ni al entregar ni cambiando el método después). Sin
--      exención de rol. Cierra el camino de las dos escrituras para el fiado: un
--      cliente viejo de la app falla cerrado. El contado por la vía anterior no
--      cambia (su cobro lo completa de forma idempotente el cierre de ruta).
--
-- Lo que NO cambia: `fin_validar_credito`, `crear_cxc_orden`, `registrar_pago_orden`,
-- `abonar_cxc`, `cerrar_ruta_financiero` (ya era atómico), la guarda de carga y
-- la recuperación de 138, `completar_venta_directa` (mostrador), saldos y cuentas
-- existentes. No repara ni reinterpreta historia: producción tiene 0 entregas a
-- crédito sin cuenta por cobrar (solo lectura, 2026-10-11).
--
-- Idempotente. Reversión (reabre el P0): DROP TRIGGER trg_ordenes_guard_credito_entrega;
-- DROP FUNCTION ordenes_guard_credito_entrega(), entregar_orden_ruta(...); y
-- volver al frontend anterior (`aef7e1e`), que usa las dos escrituras.

-- ═══ 1. Entrega de ruta: entrega + obligación financiera en una transacción ═══
CREATE OR REPLACE FUNCTION public.entregar_orden_ruta(
  p_operacion_id UUID, p_orden_id BIGINT, p_metodo TEXT, p_folio_nota TEXT DEFAULT NULL, p_referencia TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt      TEXT := fin_jwt_role();
  v_rol      TEXT := fin_mi_rol_activo();
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_metodo   TEXT := btrim(COALESCE(p_metodo, ''));
  v_nota     TEXT := NULLIF(btrim(COALESCE(p_folio_nota, '')), '');
  v_rid      BIGINT;
  v_ruta     rutas%ROWTYPE;
  v_ord      ordenes%ROWTYPE;
  v_ya       BOOLEAN := false;   -- la orden ya estaba Entregada/Facturada
  v_total    NUMERIC;
  v_pagado   NUMERIC;
  v_cxc_id   BIGINT;
  v_via      TEXT;
  v_fin      JSONB := NULL;
  v_err      TEXT;
  v_res      JSONB;
BEGIN
  -- Autorización ANTES de marcar el contexto (dentro de fin_ctx los contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'entregar_orden_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden_id IS NULL THEN
    RAISE EXCEPTION 'entregar_orden_ruta: orden requerida' USING ERRCODE = '22023';
  END IF;
  -- Método: los nombres cortos del sistema; las etiquetas largas de la pantalla de Admin se
  -- normalizan (antes quedaban guardadas tal cual y la caja de ruta no las reconocía).
  v_metodo := CASE lower(v_metodo)
                WHEN 'transferencia spei' THEN 'Transferencia'
                WHEN 'tarjeta (terminal)' THEN 'Tarjeta'
                WHEN 'crédito (fiado)'    THEN 'Crédito'
                WHEN 'credito (fiado)'    THEN 'Crédito'
                ELSE v_metodo END;
  IF v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
    RAISE EXCEPTION 'entregar_orden_ruta: método de pago inválido: %', COALESCE(NULLIF(v_metodo, ''), '(vacío)') USING ERRCODE = '22023';
  END IF;

  -- Candados en el orden del cierre de ruta: ruta → orden.
  SELECT ruta_id INTO v_rid FROM ordenes WHERE id = p_orden_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entregar_orden_ruta: orden no encontrada: %', p_orden_id USING ERRCODE = '22023';
  END IF;
  IF v_rid IS NULL THEN
    RAISE EXCEPTION 'Esta venta no está en una ruta: se entrega y cobra en Ventas (mostrador)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ruta FROM rutas WHERE id = v_rid FOR UPDATE;
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF v_ord.ruta_id IS DISTINCT FROM v_rid THEN
    RAISE EXCEPTION 'La orden % cambió de ruta: vuelve a intentarlo', v_ord.folio USING ERRCODE = '40001';
  END IF;
  IF v_jwt = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'entregar_orden_ruta: la orden no es de una ruta de este chofer' USING ERRCODE = '42501';
  END IF;

  IF v_ord.estatus IN ('Entregada', 'Facturada') THEN
    v_ya := true;
  ELSIF v_ord.estatus NOT IN ('Asignada', 'En ruta') THEN
    RAISE EXCEPTION 'La orden % está % y no se puede entregar', COALESCE(v_ord.folio, p_orden_id::text), v_ord.estatus USING ERRCODE = '22023';
  ELSIF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'La ruta % ya está %: no admite más entregas', COALESCE(v_ruta.folio, v_rid::text), v_ruta.estatus USING ERRCODE = '22023';
  END IF;

  v_total := round(COALESCE(v_ord.total, 0), 2);
  SELECT COALESCE(sum(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
  SELECT id INTO v_cxc_id FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;

  -- Ya entregada Y ya resuelta (con cuenta por cobrar, o cobrada, o sin importe): es un reintento.
  -- No se cambia la modalidad ni se toca ningún cobro o cuenta existente.
  IF v_ya AND (v_cxc_id IS NOT NULL OR v_total <= 0 OR v_pagado >= v_total) THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'orden_id', p_orden_id, 'folio', v_ord.folio, 'estatus', v_ord.estatus,
                              'metodo', v_ord.metodo_pago, 'via', CASE WHEN v_cxc_id IS NOT NULL THEN 'credito' WHEN v_total <= 0 THEN 'sin_total' ELSE 'contado' END,
                              'cxc_id', v_cxc_id, 'pagado', v_pagado, 'metodo_ignorado', v_ord.metodo_pago IS DISTINCT FROM v_metodo);
  END IF;
  -- Ya entregada, esperando un pago por link: repetir "link" no hace nada; elegir otro método lo resuelve abajo.
  IF v_ya AND v_metodo = 'QR / Link de pago' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'orden_id', p_orden_id, 'folio', v_ord.folio, 'estatus', v_ord.estatus,
                              'metodo', v_ord.metodo_pago, 'via', 'link', 'cxc_id', NULL, 'pagado', v_pagado, 'metodo_ignorado', v_ord.metodo_pago IS DISTINCT FROM v_metodo);
  END IF;

  IF v_metodo = 'Crédito' AND v_ord.cliente_id IS NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'No se puede fiar %: el crédito necesita un cliente registrado. Cobra de otra forma.', COALESCE(v_ord.folio, p_orden_id::text)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CREDITO_RECHAZADO', 'orden_id', p_orden_id, 'motivo', 'sin_cliente')::text;
  END IF;

  PERFORM fin_marcar_ctx();

  -- Entrega. La guarda de carga de 138 corre aquí (si no cabe en lo cargado, todo se deshace).
  IF NOT v_ya THEN
    UPDATE ordenes SET estatus = 'Entregada', metodo_pago = v_metodo, folio_nota = COALESCE(v_nota, folio_nota) WHERE id = p_orden_id;
  ELSE
    -- Entregada sin registro financiero (estado anterior a 139): se resuelve con el método elegido.
    UPDATE ordenes SET metodo_pago = v_metodo WHERE id = p_orden_id;
  END IF;

  -- Obligación financiera, en la MISMA transacción.
  IF v_total <= 0 THEN
    v_via := 'sin_total';
  ELSIF v_metodo = 'Crédito' THEN
    v_via := 'credito';
    BEGIN
      v_fin := crear_cxc_orden(p_orden_id, 30);   -- valida autorización y límite con el cliente bloqueado
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
      v_err := SQLERRM;
      RAISE EXCEPTION 'No se puede fiar %: %. No se registró la entrega. Cobra de otra forma o pide a Administración que revise el crédito del cliente.',
        COALESCE(v_ord.folio, p_orden_id::text), regexp_replace(v_err, '^[a-z_]+: ', '')
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CREDITO_RECHAZADO', 'orden_id', p_orden_id, 'motivo', v_err)::text;
    END;
    v_cxc_id := NULLIF(v_fin ->> 'cxc_id', '')::BIGINT;
  ELSIF v_metodo = 'QR / Link de pago' THEN
    v_via := 'link';                               -- el cobro lo registra el webhook; aquí no se inventa
  ELSE
    v_via := 'contado';
    v_fin := registrar_pago_orden(p_orden_id, v_metodo, p_referencia, v_actor_id);
    IF NOT COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false) AND v_fin ->> 'motivo' = 'referencia_existente' THEN
      RAISE EXCEPTION 'La referencia de pago % ya está registrada en otro cobro. No se registró la entrega.', v_fin ->> 'referencia'
        USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'REFERENCIA_REPETIDA', 'orden_id', p_orden_id)::text;
    END IF;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, CASE WHEN v_ya THEN 'Resolver cobro de entrega' ELSE 'Entregar' END, 'Rutas',
          left(COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' (ruta ' || COALESCE(v_ruta.folio, v_rid::text) || ') — ' || v_metodo
               || CASE v_via WHEN 'credito' THEN ' — cuenta por cobrar de $' || COALESCE(v_fin ->> 'monto', v_total::text)
                             WHEN 'link' THEN ' — pago por link pendiente' ELSE '' END, 500));

  v_res := jsonb_build_object('ok', true, 'replay', false, 'resuelta', v_ya, 'orden_id', p_orden_id, 'folio', v_ord.folio,
                              'estatus', CASE WHEN v_ya THEN v_ord.estatus ELSE 'Entregada' END, 'metodo', v_metodo, 'via', v_via,
                              'cxc_id', v_cxc_id, 'cxc_creada', COALESCE((v_fin ->> 'creada')::BOOLEAN, false),
                              'pago_id', NULLIF(v_fin ->> 'pago_id', '')::BIGINT, 'pago_aplicado', COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false),
                              'total', v_total, 'operacion_id', p_operacion_id, 'actor', v_etiqueta);
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.entregar_orden_ruta(UUID, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entregar_orden_ruta(UUID, BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ═══ 2. Guarda: fuera de un contrato, nada queda Entregado a crédito ═══
CREATE OR REPLACE FUNCTION public.ordenes_guard_credito_entrega() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF fin_ctx_activo() THEN
    RETURN NEW;
  END IF;
  IF NEW.estatus IN ('Entregada', 'Facturada') AND fin_es_credito(NEW.metodo_pago)
     AND (OLD.estatus NOT IN ('Entregada', 'Facturada') OR NOT fin_es_credito(OLD.metodo_pago)) THEN
    RAISE EXCEPTION 'ordenes: una entrega a crédito se registra con su contrato (la entrega y la cuenta por cobrar van juntas)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_credito_entrega() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_credito_entrega ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_credito_entrega
  BEFORE UPDATE OF estatus, metodo_pago ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_credito_entrega();
