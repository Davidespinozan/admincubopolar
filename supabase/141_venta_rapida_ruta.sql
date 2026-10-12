-- 141_venta_rapida_ruta.sql — T5-D1: la venta rápida del chofer se registra en el
-- servidor cuando ocurre, no al cerrar la ruta.
--
-- Causa raíz (auditoría T5-D1, 2026-10-11, confirmada en código): una venta rápida
-- vivía SOLO en el teléfono hasta "Registrar ventas y mermas", y el servidor acepta
-- ese registro (`cerrar_ruta_financiero`) UNA vez por ruta. Una venta capturada
-- después no tenía por dónde entrar: el teléfono la borraba al volver a registrar,
-- o el faltante del conteo la convertía en merma, o se destruía al cerrar. El
-- efectivo cobrado no existía para el sistema. Lo mismo pasaba con todas las ventas
-- del teléfono si Administración cerraba la ruta antes que el chofer.
--
--   1. `ventas_rapidas_ruta` — una fila por venta rápida aceptada: operación (la
--      llave de idempotencia que nace en el teléfono), ruta, orden creada, huella
--      de lo pedido, hora de captura, actor y resultado. Sin acceso por API.
--   2. `registrar_venta_rapida_ruta(operación, ruta, cliente, nombre, productos,
--      método, factura, referencia, capturada)` — Admin o el Chofer de esa ruta.
--      Una transacción: candado de la ruta → ruta En progreso y con carga
--      confirmada → precio del servidor → orden Entregada con sus líneas → pago
--      (contado) o cuenta por cobrar a 30 días con el crédito validado (fiado) →
--      lo vendido no supera lo cargado (regla de 138). Si algo falla no queda nada.
--      Reintento de la misma operación = misma respuesta, también con la ruta ya
--      cerrada; la misma operación con otros datos se rechaza.
--      Ruta cerrada o cancelada → rechazo `RUTA_CERRADA`: no se crean ventas ni
--      cobros fuera de la ruta (el teléfono conserva la operación para revisión).
--   3. `ventas_rapidas_de_ruta(ruta)` — lectura, solo Admin: las ventas rápidas
--      registradas de la ruta con su cobro o su cuenta por cobrar.
--
-- Convivencia con el cierre financiero (que NO cambia): una venta registrada aquí
-- es una orden Entregada de la ruta con su pago o su cuenta. El balance del camión
-- y el conteo final ya se calculan desde las órdenes: la incluyen sin volver a
-- consolidar, antes o después del cierre financiero. Si el cierre la recibe como
-- orden ya entregada, `registrar_pago_orden` y `crear_cxc_orden` no repiten nada.
-- Un teléfono con la versión anterior sigue usando el camino viejo (ventas rápidas
-- dentro del cierre).
--
-- Fecha de la venta: el día de negocio (zona de `fin_zona_negocio()`) de la hora
-- de captura, acotada entre la salida de la ruta y la hora del servidor; el pago
-- lleva la fecha en que el servidor lo recibió.
--
-- Lo que NO cambia: `cerrar_ruta_financiero`, `finalizar_inventario_ruta`,
-- `entregar_orden_ruta`, `crear_cxc_orden`, `registrar_pago_orden`,
-- `fin_validar_credito`, las guardas de 138/139, rutas y órdenes existentes.
-- No crea, mueve ni repara datos.
--
-- Idempotente. Reversión (sin ventas registradas): DROP de las dos funciones y de
-- la tabla, y frontend anterior. Con ventas registradas: no borrar la tabla (es el
-- rastro); basta el frontend anterior.

-- ═══ 1. Registro de ventas rápidas aceptadas ═══
CREATE TABLE IF NOT EXISTS public.ventas_rapidas_ruta (
  operacion_id  UUID PRIMARY KEY,
  ruta_id       BIGINT NOT NULL REFERENCES public.rutas(id),
  orden_id      BIGINT NOT NULL UNIQUE REFERENCES public.ordenes(id),
  huella        TEXT NOT NULL,
  capturada_at  TIMESTAMPTZ NOT NULL,
  actor_id      BIGINT,
  actor         TEXT NOT NULL,
  resultado     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_rapidas_ruta_ruta ON public.ventas_rapidas_ruta (ruta_id);
COMMENT ON TABLE public.ventas_rapidas_ruta IS
  '141: una fila por venta rápida de ruta aceptada por el servidor (operación idempotente, orden creada, hora de captura, actor). Solo la escribe registrar_venta_rapida_ruta; sin acceso por API.';
ALTER TABLE public.ventas_rapidas_ruta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ventas_rapidas_ruta FROM PUBLIC, anon, authenticated;

-- ═══ 2. Registrar una venta rápida (Admin o el Chofer de la ruta) ═══
CREATE OR REPLACE FUNCTION public.registrar_venta_rapida_ruta(
  p_operacion_id UUID, p_ruta_id BIGINT, p_cliente_id BIGINT, p_cliente_nombre TEXT, p_items JSONB,
  p_metodo TEXT, p_factura BOOLEAN DEFAULT false, p_referencia TEXT DEFAULT NULL, p_capturada_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt      TEXT := fin_jwt_role();
  v_rol      TEXT := fin_mi_rol_activo();
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_metodo   TEXT := btrim(COALESCE(p_metodo, ''));
  v_factura  BOOLEAN := COALESCE(p_factura, false);
  v_ref      TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
  v_items    JSONB;
  v_huella   TEXT;
  v_prev     ventas_rapidas_ruta%ROWTYPE;
  v_ruta     rutas%ROWTYPE;
  v_lin      JSONB;
  v_it       JSONB;
  v_total    NUMERIC;
  v_capt     TIMESTAMPTZ;
  v_folio    TEXT;
  v_orden_id BIGINT;
  v_fin      JSONB := NULL;
  v_via      TEXT;
  v_err      TEXT;
  v_exc      JSONB;
  v_exc_txt  TEXT;
  v_res      JSONB;
BEGIN
  -- Autorización ANTES de marcar el contexto (dentro de fin_ctx los contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta rápida no tiene productos' USING ERRCODE = '22023';
  END IF;
  -- La venta rápida no tiene link de pago (no hay orden previa que cobrar por link).
  IF v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito']) THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: método de pago inválido: %', COALESCE(NULLIF(v_metodo, ''), '(vacío)') USING ERRCODE = '22023';
  END IF;

  -- Productos normalizados (sku + cantidad, y el precio que el teléfono mostró como aserción).
  SELECT jsonb_agg(jsonb_build_object('sku', btrim(COALESCE(i ->> 'sku', '')), 'cantidad', COALESCE(i -> 'cantidad', i -> 'cant', i -> 'qty'),
                                      'precio', NULLIF(i ->> 'precio', '')) ORDER BY btrim(COALESCE(i ->> 'sku', '')))
    INTO v_items FROM jsonb_array_elements(p_items) i;
  -- Huella de lo pedido: misma operación + misma huella = reintento. La hora de captura y el
  -- nombre libre no cuentan (un reintento no los cambia de fondo).
  v_huella := md5(jsonb_build_object('ruta', p_ruta_id, 'cliente', p_cliente_id, 'metodo', v_metodo, 'factura', v_factura, 'ref', v_ref,
                                     'items', (SELECT jsonb_agg(jsonb_build_object('sku', x ->> 'sku', 'cantidad', (x ->> 'cantidad')) ORDER BY x ->> 'sku')
                                                 FROM jsonb_array_elements(v_items) x))::text);

  -- Candado de la ruta: serializa ventas rápidas, entregas, cierre financiero y cierre final.
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF v_jwt = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  -- Reintento (doble toque, respuesta perdida, cola sin señal): se evalúa ANTES del estado de
  -- la ruta, para que el reintento de una venta ya aceptada responda igual con la ruta cerrada.
  SELECT * INTO v_prev FROM ventas_rapidas_ruta WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella AND v_prev.ruta_id = p_ruta_id THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true);
    END IF;
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: operacion_id ya usado con otra venta' USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'La ruta % ya está %: esta venta rápida no se registró. Requiere revisión de Administración.', COALESCE(v_ruta.folio, p_ruta_id::text), lower(v_ruta.estatus)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_CERRADA', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;
  IF v_ruta.estatus <> 'En progreso' OR v_ruta.carga_confirmada_at IS NULL THEN
    RAISE EXCEPTION 'La ruta % todavía no sale (está %): la venta rápida se registra con la carga confirmada.', COALESCE(v_ruta.folio, p_ruta_id::text), v_ruta.estatus
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_NO_INICIADA', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;

  -- Validación completa ANTES de cualquier efecto (las reglas de 088 para la venta exprés).
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'registrar_venta_rapida_ruta: cliente no encontrado: %', p_cliente_id USING ERRCODE = '22023';
  END IF;
  IF v_factura THEN
    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'Venta rápida marcada con factura sin cliente registrado' USING ERRCODE = '22023';
    END IF;
    IF (SELECT upper(btrim(COALESCE(rfc, ''))) FROM clientes WHERE id = p_cliente_id) IN ('', 'XAXX010101000', 'XEXX010101000') THEN
      RAISE EXCEPTION 'El cliente de la venta rápida no tiene RFC nominativo para facturar' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_lin := lineas_canonicas(p_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', x ->> 'sku', 'cantidad', x -> 'cantidad')) FROM jsonb_array_elements(v_items) x));
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    IF v_it ->> 'precio' IS NOT NULL AND round((v_it ->> 'precio')::numeric, 2) IS DISTINCT FROM precio_canonico(p_cliente_id, v_it ->> 'sku') THEN
      RAISE EXCEPTION 'El precio de % cambió (el teléfono tenía %, el vigente es %). Actualiza y vuelve a capturar la venta.',
        v_it ->> 'sku', v_it ->> 'precio', precio_canonico(p_cliente_id, v_it ->> 'sku')
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PRECIO_CAMBIO', 'sku', v_it ->> 'sku')::text;
    END IF;
  END LOOP;
  v_total := (v_lin ->> 'total')::numeric;
  IF v_metodo = 'Crédito' AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'No se puede fiar esta venta: el crédito necesita un cliente registrado. Cobra de otra forma.'
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CREDITO_RECHAZADO', 'motivo', 'sin_cliente')::text;
  END IF;

  -- Hora de captura: la del teléfono, acotada entre la salida de la ruta y la hora del servidor.
  v_capt := LEAST(GREATEST(COALESCE(p_capturada_at, now()), v_ruta.carga_confirmada_at), now());

  PERFORM fin_marcar_ctx();

  v_folio := (SELECT 'OV-' || lpad(q.s, greatest(4, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_ov_seq'::regclass)::text AS s) q);
  INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, ruta_id, requiere_factura, vendedor_id, tipo_cobro)
  VALUES (v_folio, p_cliente_id, COALESCE(NULLIF(btrim(COALESCE(p_cliente_nombre, '')), ''), 'Público en general'),
          COALESCE(v_lin ->> 'productos', 'Varios'), fin_dia_negocio(v_capt), v_total, 'Entregada', v_metodo, p_ruta_id, v_factura, v_actor_id,
          CASE WHEN v_metodo = 'Crédito' THEN 'Credito' ELSE 'Contado' END)
  RETURNING id INTO v_orden_id;
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT v_orden_id, l ->> 'sku', (l ->> 'cantidad')::int, (l ->> 'precio_unit')::numeric, (l ->> 'subtotal')::numeric
    FROM jsonb_array_elements(v_lin -> 'lineas') l;

  -- Obligación financiera, en la MISMA transacción.
  IF v_metodo = 'Crédito' THEN
    v_via := 'credito';
    BEGIN
      v_fin := crear_cxc_orden(v_orden_id, 30);   -- valida autorización y límite con el cliente bloqueado
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
      v_err := SQLERRM;
      RAISE EXCEPTION 'No se puede fiar esta venta: %. No se registró nada. Cobra de otra forma o pide a Administración que revise el crédito del cliente.',
        regexp_replace(v_err, '^[a-z_]+: ', '')
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CREDITO_RECHAZADO', 'motivo', v_err)::text;
    END;
  ELSE
    v_via := 'contado';
    v_fin := registrar_pago_orden(v_orden_id, v_metodo, v_ref, v_actor_id);
    IF NOT COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false) THEN
      IF v_fin ->> 'motivo' = 'referencia_existente' THEN
        RAISE EXCEPTION 'La referencia de pago % ya está registrada en otro cobro. No se registró la venta.', v_fin ->> 'referencia'
          USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'REFERENCIA_REPETIDA')::text;
      END IF;
      RAISE EXCEPTION 'registrar_venta_rapida_ruta: no se pudo registrar el cobro (%)', COALESCE(v_fin ->> 'motivo', 'sin motivo') USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 138: lo vendido y entregado no puede superar lo cargado (misma regla que el cierre financiero).
  IF EXISTS (SELECT 1 FROM stock_operaciones so WHERE so.ruta_id = p_ruta_id AND so.tipo = 'carga_ruta') THEN
    SELECT jsonb_agg(jsonb_build_object('sku', b.sku, 'cargado', b.cargado, 'entregado', b.entregado, 'merma', b.merma, 'devuelto', b.devuelto,
                                        'exceso', b.entregado + b.merma + b.devuelto - b.cargado) ORDER BY b.sku),
           string_agg(b.sku || ' (sobran ' || (b.entregado + b.merma + b.devuelto - b.cargado) || ' sobre lo cargado)', ', ' ORDER BY b.sku)
      INTO v_exc, v_exc_txt
      FROM ruta_inventario_resumen(p_ruta_id) b
     WHERE b.entregado + b.merma + b.devuelto > b.cargado
       AND b.sku IN (SELECT l ->> 'sku' FROM jsonb_array_elements(v_lin -> 'lineas') l);
    IF v_exc IS NOT NULL THEN
      RAISE EXCEPTION 'La venta rápida no cabe en lo que queda en el camión: %. No se registró nada.', v_exc_txt
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CARGA_INSUFICIENTE', 'ruta_id', p_ruta_id, 'excesos', v_exc)::text;
    END IF;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Venta rápida', 'Rutas',
          left(v_folio || ' (ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text) || ') — ' || COALESCE(v_lin ->> 'productos', '') || ' — $' || v_total || ' ' || v_metodo
               || CASE WHEN v_via = 'credito' THEN ' — cuenta por cobrar a 30 días' ELSE '' END, 500));

  v_res := jsonb_build_object('ok', true, 'replay', false, 'orden_id', v_orden_id, 'folio', v_folio, 'ruta_id', p_ruta_id, 'total', v_total,
                              'metodo', v_metodo, 'via', v_via, 'fecha', fin_dia_negocio(v_capt), 'capturada_at', v_capt,
                              'cxc_id', NULLIF(v_fin ->> 'cxc_id', '')::BIGINT, 'pago_id', NULLIF(v_fin ->> 'pago_id', '')::BIGINT,
                              'operacion_id', p_operacion_id, 'actor', v_etiqueta, 'registrada_at', now());
  -- La marca de idempotencia vive en la MISMA transacción que los efectos.
  INSERT INTO ventas_rapidas_ruta (operacion_id, ruta_id, orden_id, huella, capturada_at, actor_id, actor, resultado)
  VALUES (p_operacion_id, p_ruta_id, v_orden_id, v_huella, v_capt, v_actor_id, v_etiqueta, v_res);
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.registrar_venta_rapida_ruta(UUID, BIGINT, BIGINT, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_venta_rapida_ruta(UUID, BIGINT, BIGINT, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ═══ 3. Ventas rápidas de una ruta (lectura, solo Admin) ═══
CREATE OR REPLACE FUNCTION public.ventas_rapidas_de_ruta(p_ruta_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'ventas_rapidas_de_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'operacion_id', v.operacion_id, 'orden_id', o.id, 'folio', o.folio, 'cliente', o.cliente_nombre, 'productos', o.productos,
             'total', o.total, 'metodo', o.metodo_pago, 'estatus', o.estatus, 'fecha', o.fecha,
             'capturada_at', v.capturada_at, 'registrada_at', v.created_at, 'actor', v.actor,
             'cobrado', (SELECT COALESCE(sum(p.monto), 0) FROM pagos p WHERE p.orden_id = o.id),
             'cxc_saldo', (SELECT x.saldo_pendiente FROM cuentas_por_cobrar x WHERE x.orden_id = o.id)
           ) ORDER BY v.created_at)
      FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id
     WHERE v.ruta_id = p_ruta_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.ventas_rapidas_de_ruta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ventas_rapidas_de_ruta(BIGINT) TO authenticated, service_role;
