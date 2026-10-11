-- 138_recuperacion_cierre_ruta.sql — T5-A: una ruta ya no puede quedar imposible
-- de cerrar, y Admin tiene una recuperación auditada para la que ya lo esté.
--
-- Causa raíz (auditoría final 2026-10-10, confirmada en código): marcar una
-- orden de ruta como Entregada era un UPDATE directo sin revisar lo que traía
-- el camión. Si el producto no se había cargado (o no alcanzaba), el balance
-- canónico de 087 (`balance_ruta_interno`) fallaba cerrado con "entregado
-- supera lo cargado" en el cierre del chofer Y en el de Admin; una ruta cargada
-- no se cancela (087) y una orden Entregada no se revierte (105): solo SQL.
-- Se llegaba fácil: se podían agregar órdenes a una ruta ya cargada, y agregar
-- una orden no sube la carga autorizada. Las ventas exprés del cierre tampoco
-- se revisaban en el servidor (solo en el teléfono).
--
-- Prevención (el servidor es la autoridad; la pantalla solo acompaña):
--   1. `ordenes_guard_carga_ruta` (disparador AFTER UPDATE en `ordenes`): una
--      orden de una ruta CON carga confirmada solo pasa a Entregada si, por cada
--      producto, cargado ≥ entregado + merma + devuelto (contándola a ella).
--      Bloquea la fila de la ruta: dos entregas simultáneas no consumen la misma
--      carga. Vale para toda vía (API directa del chofer o de Admin, cola sin
--      señal, cierre financiero). El rechazo revierte la sentencia completa: la
--      orden no queda Entregada ni a medias.
--   2. `cerrar_ruta_financiero`: al final verifica lo mismo para la ruta entera
--      (cubre las ventas exprés, que nacen Entregadas). Si no cuadra, no se
--      registra NADA del cierre.
--   3. `asignar_ordenes_a_ruta` / `asignar_orden`: no se agregan órdenes a una
--      ruta con carga capturada o confirmada (no existe un flujo de segunda
--      carga: 087 admite una sola). Antes de cargar sí; la respuesta dice qué
--      parte de los pedidos NO cubre la carga autorizada (`sin_cubrir`): la
--      carga autorizada no se sube sola.
--
-- Recuperación (solo Admin, con motivo, auditada, idempotente):
--   4. `diagnostico_ruta(ruta)`: lectura. Por producto: cargado, entregado,
--      merma, devuelto y exceso; por orden: estatus, cobrado, cuenta por cobrar
--      y si su entrega se puede revertir (y por qué no).
--   5. `revertir_entrega_ruta(operación, orden, motivo, conservar_cobro)`: una
--      orden marcada Entregada por error en una ruta abierta vuelve a Asignada
--      (después se marca No entregada o se entrega bien). No inventa carga ni
--      toca inventario (la entrega de ruta no tiene kardex propio: sale del
--      balance). Dinero: una cuenta por cobrar SIN abonos se anula con el
--      contrato de 090; con abonos se rechaza; un cobro registrado NO se borra
--      ni se modifica: se conserva (la orden queda cobrada y pendiente de
--      entrega) y Admin lo tiene que reconocer explícitamente. Se rechaza si la
--      orden está Facturada, tiene devolución, operaciones CFDI sin resolver o
--      comisión ya pagada. Evidencia en `ruta_entregas_revertidas` (antes y
--      después, quién, cuándo, por qué) y en `auditoria`.
--   6. `ordenes_delivered_at` (093): la fecha de entrega se limpia SOLO dentro
--      de esa reversión (si no, la segunda entrega conservaría la fecha de la
--      primera y el ingreso caería en el día equivocado).
--
-- Lo que NO cambia: el balance canónico y la finalización de 087 (md5 iguales),
-- la carga (084/085), cobros y cuentas por cobrar (088/114), las rutas sin carga
-- estructurada (sin operación `carga_ruta`, camino anterior a 087: la guarda y la
-- verificación del cierre no las tocan). No repara ni
-- reinterpreta rutas existentes: producción tiene 1 ruta, Cerrada, y 0 rutas
-- abiertas o con exceso (verificado en solo lectura el 2026-10-10).
--
-- Idempotente. Reversión (reabre el P0): DROP TRIGGER trg_ordenes_guard_carga_ruta;
-- volver a aplicar `cerrar_ruta_financiero` de 136, `asignar_orden` /
-- `asignar_ordenes_a_ruta` de 080 y `ordenes_delivered_at` de 093; DROP de
-- `revertir_entrega_ruta`, `diagnostico_ruta`, `ruta_inventario_resumen` y
-- `ordenes_guard_carga_ruta`. La tabla `ruta_entregas_revertidas` es historia:
-- no se borra si tiene filas.

-- ═══ 1. Inventario de la ruta por producto, SIN fallar ═══
-- Mismas fuentes que el balance canónico (087): kardex de carga, líneas de
-- órdenes Entregada/Facturada, mermas activas y kardex de devolución. A
-- diferencia de `balance_ruta_interno` no lanza excepción: sirve para decidir y
-- para explicar. Interna (sin EXECUTE por API).
CREATE OR REPLACE FUNCTION public.ruta_inventario_resumen(p_ruta_id BIGINT)
RETURNS TABLE (sku TEXT, cargado INTEGER, entregado INTEGER, merma INTEGER, devuelto INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (SELECT i.producto AS s, sum(i.cantidad)::INTEGER AS q FROM inventario_mov i
              WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'carga_ruta/%' GROUP BY 1),
       e AS (SELECT l.sku AS s, sum(l.cantidad)::INTEGER AS q FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id
              WHERE o.ruta_id = p_ruta_id AND o.estatus IN ('Entregada', 'Facturada') GROUP BY 1),
       m AS (SELECT mm.sku AS s, sum(mm.cantidad)::INTEGER AS q FROM mermas mm
              WHERE mm.ruta_id = p_ruta_id AND mm.estatus = 'Activa' GROUP BY 1),
       d AS (SELECT i.producto AS s, sum(i.cantidad)::INTEGER AS q FROM inventario_mov i
              WHERE i.ruta_id = p_ruta_id AND i.tipo = 'Entrada' AND i.referencia LIKE 'devolucion_ruta/%' GROUP BY 1),
       u AS (SELECT s FROM c UNION SELECT s FROM e UNION SELECT s FROM m UNION SELECT s FROM d)
  SELECT u.s, COALESCE(c.q, 0), COALESCE(e.q, 0), COALESCE(m.q, 0), COALESCE(d.q, 0)
    FROM u LEFT JOIN c ON c.s = u.s LEFT JOIN e ON e.s = u.s LEFT JOIN m ON m.s = u.s LEFT JOIN d ON d.s = u.s
   ORDER BY u.s
$$;
REVOKE ALL ON FUNCTION public.ruta_inventario_resumen(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Guarda: una entrega no consume más de lo cargado ═══
CREATE OR REPLACE FUNCTION public.ordenes_guard_carga_ruta() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta   rutas%ROWTYPE;
  v_faltan JSONB;
  v_txt    TEXT;
BEGIN
  -- Solo la transición que hace que la orden EMPIECE a contar como entregada en
  -- esta ruta. Facturada → Entregada (cancelación de CFDI) no cambia el balance.
  IF NEW.estatus <> 'Entregada' OR NEW.ruta_id IS NULL THEN RETURN NULL; END IF;
  IF OLD.estatus IN ('Entregada', 'Facturada') AND OLD.ruta_id IS NOT DISTINCT FROM NEW.ruta_id THEN RETURN NULL; END IF;

  -- Candado de la ruta: serializa entregas, cierre y asignación de la misma ruta.
  SELECT * INTO v_ruta FROM rutas WHERE id = NEW.ruta_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Ruta sin carga estructurada (camino anterior a 087: sin operación `carga_ruta`): sin
  -- cambio. Su inventario nunca pasó por el balance canónico.
  IF v_ruta.carga_confirmada_at IS NULL
     OR NOT EXISTS (SELECT 1 FROM stock_operaciones so WHERE so.ruta_id = v_ruta.id AND so.tipo = 'carga_ruta') THEN
    RETURN NULL;
  END IF;
  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'No se puede entregar %: la ruta % ya está %', COALESCE(NEW.folio, 'la orden ' || NEW.id), COALESCE(v_ruta.folio, v_ruta.id::text), v_ruta.estatus
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_CERRADA', 'orden_id', NEW.id, 'ruta_id', v_ruta.id)::text;
  END IF;

  -- AFTER: la orden ya cuenta en "entregado". Por cada producto SUYO, lo
  -- consumido no puede superar lo cargado.
  SELECT jsonb_agg(jsonb_build_object('sku', b.sku, 'pedido', l.q, 'disponible', GREATEST(b.cargado - (b.entregado - l.q) - b.merma - b.devuelto, 0), 'cargado', b.cargado) ORDER BY b.sku),
         string_agg(l.q || ' de ' || b.sku || ' (en el camión quedan ' || GREATEST(b.cargado - (b.entregado - l.q) - b.merma - b.devuelto, 0) || ')', ', ' ORDER BY b.sku)
    INTO v_faltan, v_txt
    FROM (SELECT ol.sku, sum(ol.cantidad)::INTEGER AS q FROM orden_lineas ol WHERE ol.orden_id = NEW.id GROUP BY 1) l
    JOIN ruta_inventario_resumen(NEW.ruta_id) b ON b.sku = l.sku
   WHERE l.q > 0 AND b.entregado + b.merma + b.devuelto > b.cargado;
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede entregar %: la carga del camión no alcanza. La orden lleva %. Márcala No entregada o avisa a Administración.',
      COALESCE(NEW.folio, 'la orden ' || NEW.id), v_txt
      USING ERRCODE = '22023',
            DETAIL = jsonb_build_object('codigo', 'CARGA_INSUFICIENTE', 'orden_id', NEW.id, 'folio', NEW.folio, 'ruta_id', v_ruta.id, 'faltantes', v_faltan)::text;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_carga_ruta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_carga_ruta ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_carga_ruta
  AFTER UPDATE OF estatus, ruta_id ON public.ordenes
  FOR EACH ROW WHEN (NEW.estatus = 'Entregada' AND NEW.ruta_id IS NOT NULL)
  EXECUTE FUNCTION public.ordenes_guard_carga_ruta();

-- ═══ 3. Asignar órdenes: no a una ruta con carga capturada ═══
CREATE OR REPLACE FUNCTION asignar_orden(p_orden_id BIGINT, p_ruta_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta rutas%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'asignar_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  -- Ventas solo marca "Asignada" sin ruta; la ruta concreta la decide Admin.
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo()
     AND COALESCE(fin_mi_rol_activo(), '') <> 'Admin' AND p_ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'asignar_orden: solo Admin asigna una orden a una ruta concreta' USING ERRCODE = '42501';
  END IF;
  -- 138: a una ruta concreta solo antes de que tenga carga (misma regla que asignar_ordenes_a_ruta).
  IF p_ruta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ordenes WHERE id = p_orden_id AND ruta_id = p_ruta_id AND estatus = 'Asignada') THEN
    SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
    IF NOT FOUND OR v_ruta.estatus IN ('Cerrada', 'Cancelada', 'Completada') THEN
      RAISE EXCEPTION 'Ruta % no existe o ya está cerrada/completada/cancelada', p_ruta_id USING ERRCODE = '22023';
    END IF;
    IF v_ruta.carga_confirmada_at IS NOT NULL OR v_ruta.estatus = 'Pendiente firma' THEN
      RAISE EXCEPTION 'La ruta % ya tiene su carga capturada: no se le agregan pedidos. Asígnalo a otra ruta.', COALESCE(v_ruta.folio, p_ruta_id::text)
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_CON_CARGA', 'ruta_id', p_ruta_id)::text;
    END IF;
  END IF;
  UPDATE ordenes SET estatus = 'Asignada', ruta_id = p_ruta_id WHERE id = p_orden_id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Asignar', 'Órdenes', 'Orden #' || p_orden_id);
END;
$$;

CREATE OR REPLACE FUNCTION asignar_ordenes_a_ruta(p_ruta_id BIGINT, p_orden_ids BIGINT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_orden_id      BIGINT;
  v_ord           RECORD;
  v_carga         JSONB := '{}'::jsonb;
  v_linea         RECORD;
  v_count_updated INTEGER := 0;
  v_ruta          rutas%ROWTYPE;
  v_nuevas        INTEGER := 0;
  v_sin_cubrir    JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'asignar_ordenes_a_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;

  -- 1. Validar la ruta: existe y NO está cerrada/completada/cancelada.
  --    138: con candado (la asignación no se cruza con la carga ni con el cierre).
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND OR v_ruta.estatus IN ('Cerrada', 'Cancelada', 'Completada') THEN
    RAISE EXCEPTION 'Ruta % no existe o ya está cerrada/completada/cancelada', p_ruta_id;
  END IF;

  -- 2. Validar cada orden: nueva (Creada sin ruta) o idempotente (ya en esta ruta).
  FOREACH v_orden_id IN ARRAY p_orden_ids LOOP
    SELECT estatus, ruta_id INTO v_ord
      FROM ordenes
     WHERE id = v_orden_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Orden % no existe', v_orden_id;
    END IF;
    IF NOT (
      (v_ord.estatus = 'Creada' AND v_ord.ruta_id IS NULL)
      OR (v_ord.estatus = 'Asignada' AND v_ord.ruta_id = p_ruta_id)
    ) THEN
      RAISE EXCEPTION 'Orden % no es asignable (estatus=%, ruta_id=%)',
        v_orden_id, v_ord.estatus, COALESCE(v_ord.ruta_id::text, 'NULL');
    END IF;
    IF NOT (v_ord.estatus = 'Asignada' AND v_ord.ruta_id IS NOT DISTINCT FROM p_ruta_id) THEN
      v_nuevas := v_nuevas + 1;
    END IF;
  END LOOP;

  -- 138: a una ruta con carga capturada (Pendiente firma) o confirmada ya no se le agregan
  -- pedidos: el camión solo se carga una vez (087) y lo nuevo no iría a bordo. Repetir la
  -- asignación de órdenes que ya son de la ruta sigue siendo un no-op permitido.
  IF v_nuevas > 0 AND (v_ruta.carga_confirmada_at IS NOT NULL OR v_ruta.estatus = 'Pendiente firma') THEN
    RAISE EXCEPTION 'La ruta % ya tiene su carga capturada: no se le agregan pedidos. Asígnalos a otra ruta.', COALESCE(v_ruta.folio, p_ruta_id::text)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_CON_CARGA', 'ruta_id', p_ruta_id)::text;
  END IF;

  -- 3. UPDATE atómico: solo afecta las que cambian.
  UPDATE ordenes
     SET ruta_id    = p_ruta_id,
         estatus    = 'Asignada',
         updated_at = NOW()
   WHERE id = ANY(p_orden_ids)
     AND (ruta_id IS NULL OR estatus = 'Creada');
  GET DIAGNOSTICS v_count_updated = ROW_COUNT;

  -- 4. Calcular carga sumando líneas por SKU de TODAS las órdenes de la ruta.
  FOR v_linea IN
    SELECT ol.sku, SUM(ol.cantidad)::int AS total
      FROM orden_lineas ol
      JOIN ordenes o ON o.id = ol.orden_id
     WHERE o.ruta_id = p_ruta_id
       AND o.estatus = 'Asignada'
     GROUP BY ol.sku
  LOOP
    v_carga := jsonb_set(v_carga, ARRAY[v_linea.sku], to_jsonb(v_linea.total));
  END LOOP;

  -- 5. Actualizar carga total de la ruta.
  UPDATE rutas
     SET carga      = v_carga,
         updated_at = NOW()
   WHERE id = p_ruta_id;

  -- 138: lo que piden los pedidos y NO cubre la carga autorizada (base + extra). La carga
  -- autorizada no se sube sola: Admin decide (Editar ruta). Solo informa.
  SELECT jsonb_agg(jsonb_build_object('sku', d.key, 'pedido', d.value::INTEGER,
                                      'autorizado', aut.q, 'falta', d.value::INTEGER - aut.q) ORDER BY d.key)
    INTO v_sin_cubrir
    FROM jsonb_each_text(v_carga) d
    CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(v_ruta.carga_autorizada ->> d.key, '')::NUMERIC, 0)::INTEGER
                             + COALESCE(NULLIF(v_ruta.extra_autorizado ->> d.key, '')::NUMERIC, 0)::INTEGER AS q) aut
   WHERE d.value::INTEGER > aut.q;

  RETURN jsonb_build_object(
    'success', true,
    'ordenes_asignadas', v_count_updated,
    'carga', v_carga,
    'sin_cubrir', COALESCE(v_sin_cubrir, '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION asignar_orden(BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION asignar_ordenes_a_ruta(BIGINT, BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION asignar_orden(BIGINT, BIGINT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION asignar_ordenes_a_ruta(BIGINT, BIGINT[]) TO authenticated, service_role;

-- ═══ 4. Cierre financiero: lo registrado no supera lo cargado (incluye ventas exprés) ═══
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
  v_exc      JSONB;   -- 138: productos cuyo consumo supera lo cargado
  v_exc_txt  TEXT;
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
      -- 136: una orden que ya es de OTRA ruta no se cierra en esta. Antes bastaba su id.
      IF v_ord.ruta_id IS NOT NULL AND v_ord.ruta_id <> p_ruta_id THEN
        RAISE EXCEPTION 'La orden % es de otra ruta y no puede cerrarse en esta', v_ord.folio USING ERRCODE = '22023';
      END IF;
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

  -- 138: nada de lo registrado puede superar lo cargado. Las órdenes ya las revisó la guarda
  -- (ordenes_guard_carga_ruta); esto cubre las ventas exprés, que nacen Entregadas. Si no
  -- cuadra, no se registra NADA del cierre: antes pasaba y la ruta ya no se podía cerrar.
  IF v_ruta.carga_confirmada_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM stock_operaciones so WHERE so.ruta_id = p_ruta_id AND so.tipo = 'carga_ruta') THEN
    SELECT jsonb_agg(jsonb_build_object('sku', b.sku, 'cargado', b.cargado, 'entregado', b.entregado, 'merma', b.merma, 'devuelto', b.devuelto,
                                        'exceso', b.entregado + b.merma + b.devuelto - b.cargado) ORDER BY b.sku),
           string_agg(b.sku || ' (cargado ' || b.cargado || ', vendido y entregado ' || b.entregado
                      || CASE WHEN b.merma > 0 THEN ', merma ' || b.merma ELSE '' END || ')', ', ' ORDER BY b.sku)
      INTO v_exc, v_exc_txt
      FROM ruta_inventario_resumen(p_ruta_id) b
     WHERE b.entregado + b.merma + b.devuelto > b.cargado;
    IF v_exc IS NOT NULL THEN
      RAISE EXCEPTION 'Lo vendido y entregado en la ruta % supera lo que se cargó: %. No se registró nada. Quita la venta o entrega que no corresponde, o pide a Administración que revise el inventario de la ruta.',
        COALESCE(v_ruta.folio, p_ruta_id::text), v_exc_txt
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CARGA_INSUFICIENTE', 'ruta_id', p_ruta_id, 'excesos', v_exc)::text;
    END IF;
  END IF;

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

-- ═══ 5. Evidencia de las entregas revertidas ═══
CREATE TABLE IF NOT EXISTS public.ruta_entregas_revertidas (
  id            BIGSERIAL PRIMARY KEY,
  operacion_id  UUID NOT NULL UNIQUE,
  orden_id      BIGINT NOT NULL REFERENCES public.ordenes(id),
  ruta_id       BIGINT NOT NULL REFERENCES public.rutas(id),
  motivo        TEXT NOT NULL CHECK (length(btrim(motivo)) >= 5),
  actor_id      BIGINT,
  actor         TEXT NOT NULL,
  antes         JSONB NOT NULL,
  resultado     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ruta_entregas_revertidas_ruta ON public.ruta_entregas_revertidas (ruta_id);
CREATE INDEX IF NOT EXISTS ruta_entregas_revertidas_orden ON public.ruta_entregas_revertidas (orden_id);
ALTER TABLE public.ruta_entregas_revertidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read ON public.ruta_entregas_revertidas;
CREATE POLICY admin_read ON public.ruta_entregas_revertidas FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin');
REVOKE ALL ON public.ruta_entregas_revertidas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ruta_entregas_revertidas TO authenticated;
GRANT ALL ON public.ruta_entregas_revertidas TO service_role;
REVOKE ALL ON SEQUENCE public.ruta_entregas_revertidas_id_seq FROM PUBLIC, anon, authenticated;

-- ═══ 6. Fecha de entrega: se limpia solo dentro de la reversión ═══
CREATE OR REPLACE FUNCTION public.ordenes_delivered_at() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  -- Nunca se confía en el valor enviado: el servidor lo deriva.
  IF TG_OP = 'INSERT' THEN
    NEW.delivered_at := CASE WHEN NEW.estatus IN ('Entregada', 'Facturada') THEN now() END;
  ELSIF COALESCE(current_setting('app.reversa_entrega_ctx', true), '') = NEW.id::text
        AND NEW.estatus NOT IN ('Entregada', 'Facturada') THEN
    -- 138: solo `revertir_entrega_ruta` pone esta marca (transacción local, una orden).
    NEW.delivered_at := NULL;
  ELSE
    NEW.delivered_at := COALESCE(OLD.delivered_at,
      CASE WHEN NEW.estatus IN ('Entregada', 'Facturada') AND COALESCE(OLD.estatus, '') NOT IN ('Entregada', 'Facturada') THEN now() END);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_delivered_at() FROM PUBLIC, anon, authenticated;

-- ═══ 7. Diagnóstico de una ruta (lectura, solo Admin) ═══
-- ¿Por qué una orden entregada no se puede revertir? NULL = sí se puede.
CREATE OR REPLACE FUNCTION public.ruta_entrega_no_reversible(p_orden_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ord  ordenes%ROWTYPE;
  v_ruta rutas%ROWTYPE;
  v_cxc  cuentas_por_cobrar%ROWTYPE;
BEGIN
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id;
  IF NOT FOUND THEN RETURN 'La orden no existe'; END IF;
  IF v_ord.estatus = 'Facturada' THEN RETURN 'Está facturada: primero cancela su CFDI'; END IF;
  IF v_ord.estatus <> 'Entregada' THEN RETURN 'No está Entregada (está ' || v_ord.estatus || ')'; END IF;
  IF v_ord.ruta_id IS NULL THEN RETURN 'No es una entrega de ruta'; END IF;
  SELECT * INTO v_ruta FROM rutas WHERE id = v_ord.ruta_id;
  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN RETURN 'Su ruta ya está ' || v_ruta.estatus || ': usa una devolución'; END IF;
  IF v_ruta.carga_confirmada_at IS NULL OR NOT EXISTS (SELECT 1 FROM stock_operaciones so WHERE so.ruta_id = v_ruta.id AND so.tipo = 'carga_ruta') THEN
    RETURN 'Su ruta no tiene carga confirmada por contrato';
  END IF;
  IF COALESCE(v_ord.tiene_devolucion, false) OR EXISTS (SELECT 1 FROM devoluciones d WHERE d.orden_id = p_orden_id) THEN
    RETURN 'Tiene una devolución registrada';
  END IF;
  IF EXISTS (SELECT 1 FROM cfdi_operaciones c WHERE c.orden_id = p_orden_id AND c.estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision')) THEN
    RETURN 'Tiene una operación de factura sin resolver';
  END IF;
  IF EXISTS (SELECT 1 FROM nomina_linea_ordenes n JOIN nomina_recibo_lineas l ON l.id = n.linea_id
               JOIN nomina_recibos r ON r.id = l.recibo_id JOIN nomina_periodos p ON p.id = r.periodo_id
              WHERE n.orden_id = p_orden_id AND p.estatus = 'Pagado') THEN
    RETURN 'Ya se pagó una comisión de nómina por esta entrega';
  END IF;
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;
  IF FOUND AND (COALESCE(v_cxc.monto_pagado, 0) > 0 OR EXISTS (SELECT 1 FROM pagos WHERE cxc_id = v_cxc.id OR orden_id = p_orden_id)) THEN
    RETURN 'Su cuenta por cobrar ya tiene abonos';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ruta_entrega_no_reversible(BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.diagnostico_ruta(p_ruta_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta  rutas%ROWTYPE;
  v_inv   JSONB;
  v_ord   JSONB;
  v_exc   INTEGER;
  v_pend  INTEGER;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'diagnostico_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'diagnostico_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', b.sku, 'cargado', b.cargado, 'entregado', b.entregado, 'merma', b.merma, 'devuelto', b.devuelto,
                                               'restante', b.cargado - b.entregado - b.merma - b.devuelto,
                                               'exceso', GREATEST(b.entregado + b.merma + b.devuelto - b.cargado, 0)) ORDER BY b.sku), '[]'::jsonb),
         COALESCE(sum(GREATEST(b.entregado + b.merma + b.devuelto - b.cargado, 0)), 0)::INTEGER
    INTO v_inv, v_exc
    FROM ruta_inventario_resumen(p_ruta_id) b;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'folio', o.folio, 'cliente', o.cliente_nombre, 'estatus', o.estatus, 'total', o.total, 'metodo_pago', o.metodo_pago,
           'lineas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', l.sku, 'cantidad', l.q) ORDER BY l.sku), '[]'::jsonb)
                        FROM (SELECT ol.sku, sum(ol.cantidad)::INTEGER AS q FROM orden_lineas ol WHERE ol.orden_id = o.id GROUP BY 1) l),
           'cobrado', (SELECT COALESCE(sum(p.monto), 0) FROM pagos p WHERE p.orden_id = o.id),
           'cxc_saldo', (SELECT c.saldo_pendiente FROM cuentas_por_cobrar c WHERE c.orden_id = o.id),
           'no_reversible', CASE WHEN o.estatus IN ('Entregada', 'Facturada') THEN ruta_entrega_no_reversible(o.id) END
         ) ORDER BY o.id), '[]'::jsonb),
         count(*) FILTER (WHERE o.estatus IN ('Asignada', 'En ruta'))::INTEGER
    INTO v_ord, v_pend
    FROM ordenes o WHERE o.ruta_id = p_ruta_id;

  RETURN jsonb_build_object(
    'ruta_id', v_ruta.id, 'folio', v_ruta.folio, 'estatus', v_ruta.estatus,
    'carga_confirmada', v_ruta.carga_confirmada_at IS NOT NULL
                        AND EXISTS (SELECT 1 FROM stock_operaciones so WHERE so.ruta_id = p_ruta_id AND so.tipo = 'carga_ruta'),
    'cierre_financiero', EXISTS (SELECT 1 FROM cierres_financieros_ruta c WHERE c.ruta_id = p_ruta_id),
    'consistente', v_exc = 0, 'exceso_total', v_exc, 'pendientes', v_pend,
    'inventario', v_inv, 'ordenes', v_ord,
    'revertidas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('orden_id', r.orden_id, 'folio', r.antes ->> 'folio', 'motivo', r.motivo, 'actor', r.actor, 'fecha', r.created_at) ORDER BY r.id), '[]'::jsonb)
                     FROM ruta_entregas_revertidas r WHERE r.ruta_id = p_ruta_id));
END $$;
REVOKE ALL ON FUNCTION public.diagnostico_ruta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnostico_ruta(BIGINT) TO authenticated, service_role;

-- ═══ 8. Revertir una entrega de ruta marcada por error (solo Admin) ═══
CREATE OR REPLACE FUNCTION public.revertir_entrega_ruta(
  p_operacion_id UUID, p_orden_id BIGINT, p_motivo TEXT, p_conservar_cobro BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_motivo   TEXT := btrim(COALESCE(p_motivo, ''));
  v_prev     ruta_entregas_revertidas%ROWTYPE;
  v_rid      BIGINT;
  v_ruta     rutas%ROWTYPE;
  v_ord      ordenes%ROWTYPE;
  v_no       TEXT;
  v_cobrado  NUMERIC;
  v_cxc      cuentas_por_cobrar%ROWTYPE;
  v_cxc_res  JSONB := NULL;
  v_antes    JSONB;
  v_exc      INTEGER;
  v_res      JSONB;
  v_etiqueta TEXT := erp_actor_etiqueta();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_entrega_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'revertir_entrega_ruta: operación y orden son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribe el motivo de la reversión (por qué esa entrega no ocurrió)' USING ERRCODE = '22023';
  END IF;

  -- Reintento con la misma operación: misma respuesta, sin volver a tocar nada.
  SELECT * INTO v_prev FROM ruta_entregas_revertidas WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.orden_id <> p_orden_id THEN
      RAISE EXCEPTION 'revertir_entrega_ruta: operacion_id ya usado con otra orden' USING ERRCODE = '23505';
    END IF;
    RETURN v_prev.resultado || jsonb_build_object('replay', true);
  END IF;

  -- Candados en el mismo orden que el cierre: ruta → orden.
  SELECT ruta_id INTO v_rid FROM ordenes WHERE id = p_orden_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_entrega_ruta: orden no encontrada: %', p_orden_id USING ERRCODE = '22023';
  END IF;
  IF v_rid IS NULL THEN
    RAISE EXCEPTION 'No es una entrega de ruta: una venta de mostrador se corrige con una devolución' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ruta FROM rutas WHERE id = v_rid FOR UPDATE;
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF v_ord.ruta_id IS DISTINCT FROM v_rid THEN
    RAISE EXCEPTION 'La orden % cambió de ruta mientras se revertía: vuelve a intentarlo', v_ord.folio USING ERRCODE = '40001';
  END IF;

  -- Con los candados tomados: ¿otra operación ya la revirtió o dejó de ser reversible?
  v_no := ruta_entrega_no_reversible(p_orden_id);
  IF v_no IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede revertir la entrega de %: %', COALESCE(v_ord.folio, 'la orden ' || p_orden_id), v_no
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NO_REVERSIBLE', 'orden_id', p_orden_id, 'motivo', v_no)::text;
  END IF;

  -- Dinero. Un cobro registrado NO se borra ni se modifica: se conserva, y Admin
  -- lo reconoce explícitamente. Una cuenta por cobrar sin abonos se anula (090).
  SELECT COALESCE(sum(monto), 0) INTO v_cobrado FROM pagos WHERE orden_id = p_orden_id;
  IF v_cobrado > 0 AND NOT COALESCE(p_conservar_cobro, false) THEN
    RAISE EXCEPTION 'La orden % tiene $% cobrados. La reversión NO borra ese cobro: la orden quedará cobrada y pendiente de entrega. Confírmalo para continuar.',
      v_ord.folio, v_cobrado
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'COBRO_REGISTRADO', 'orden_id', p_orden_id, 'cobrado', v_cobrado)::text;
  END IF;
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id FOR UPDATE;

  v_antes := jsonb_build_object(
    'folio', v_ord.folio, 'estatus', v_ord.estatus, 'delivered_at', v_ord.delivered_at, 'metodo_pago', v_ord.metodo_pago, 'total', v_ord.total,
    'cliente_id', v_ord.cliente_id, 'cobrado', v_cobrado,
    'cxc', CASE WHEN v_cxc.id IS NULL THEN NULL ELSE to_jsonb(v_cxc) END,
    'lineas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', sku, 'cantidad', cantidad) ORDER BY sku), '[]'::jsonb) FROM orden_lineas WHERE orden_id = p_orden_id),
    'inventario_ruta', (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.sku), '[]'::jsonb) FROM ruta_inventario_resumen(v_rid) b));

  INSERT INTO ruta_entregas_revertidas (operacion_id, orden_id, ruta_id, motivo, actor_id, actor, antes)
  VALUES (p_operacion_id, p_orden_id, v_rid, v_motivo, erp_usuario_id(), v_etiqueta, v_antes);

  PERFORM fin_marcar_ctx();
  IF v_cxc.id IS NOT NULL THEN
    v_cxc_res := anular_cxc_orden(p_orden_id);
  END IF;

  -- La orden vuelve a Asignada en la MISMA ruta: el producto sigue en el camión
  -- (la entrega de ruta no tiene kardex: sale del balance). No se toca inventario.
  PERFORM set_config('app.reversa_entrega_ctx', p_orden_id::text, true);
  UPDATE ordenes SET estatus = 'Asignada' WHERE id = p_orden_id;
  PERFORM set_config('app.reversa_entrega_ctx', '', true);

  SELECT COALESCE(sum(GREATEST(b.entregado + b.merma + b.devuelto - b.cargado, 0)), 0)::INTEGER INTO v_exc FROM ruta_inventario_resumen(v_rid) b;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Revertir entrega', 'Rutas',
          left(COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' (ruta ' || COALESCE(v_ruta.folio, v_rid::text) || '): ' || v_motivo
               || CASE WHEN v_cobrado > 0 THEN ' — cobro de $' || v_cobrado || ' conservado' ELSE '' END
               || CASE WHEN (v_cxc_res ->> 'anulada')::BOOLEAN THEN ' — cuenta por cobrar de $' || (v_cxc_res ->> 'monto') || ' anulada' ELSE '' END, 500));

  v_res := jsonb_build_object('ok', true, 'orden_id', p_orden_id, 'folio', v_ord.folio, 'ruta_id', v_rid, 'estatus', 'Asignada',
                              'cobro_conservado', v_cobrado, 'cxc_anulada', COALESCE((v_cxc_res ->> 'anulada')::BOOLEAN, false),
                              'cxc_monto', v_cxc_res -> 'monto', 'ruta_consistente', v_exc = 0, 'exceso_restante', v_exc,
                              'actor', v_etiqueta, 'replay', false);
  UPDATE ruta_entregas_revertidas SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.revertir_entrega_ruta(UUID, BIGINT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_ruta(UUID, BIGINT, TEXT, BOOLEAN) TO authenticated, service_role;
