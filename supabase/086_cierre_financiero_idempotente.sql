-- 086_cierre_financiero_idempotente.sql — F4 prerequisito: el cierre
-- financiero de ruta es replay-safe.
--
-- Problema: cerrar_ruta_financiero (069) es idempotente por orden existente
-- (registrar_pago_orden salta lo ya pagado, crear_cxc_orden por orden), pero
-- cada llamada INSERTA de nuevo las ventas exprés (orden + líneas + pago/CxC +
-- ingreso). Un reintento tras respuesta perdida, o un doble tap, duplica
-- ventas exprés y corrompe el balance de la ruta (entregado inflado). Con
-- 0 rutas no terminales en producción no hay reconciliación histórica.
--
-- Modelo (aditivo, sin tocar rutas ni el guard 078):
--   cierres_financieros_ruta   UNA fila por ruta (PK ruta_id): operacion_id
--                              (UNIQUE), huella canónica del payload, actor
--                              derivado del servidor, resultado almacenado.
--                              RLS activa, sin policies ni grants a la API.
--   fin_huella_cierre(...)     Huella lógica: ruta + entregas normalizadas y
--                              ordenadas (orden, pago, referencia; exprés:
--                              cliente, factura, pago, referencia, items por
--                              sku/cant/precio). NO incluye la atribución
--                              (p_usuario_id / p_usuario_nombre).
--   cerrar_ruta_financiero(p_operacion_id UUID, p_ruta_id, p_entregas,
--                          p_usuario_id, p_usuario_nombre)
--                              Contrato nuevo. Bajo el lock de la ruta:
--                              · misma operación + misma huella → resultado
--                                almacenado (replay=true), cero efectos;
--                              · misma operación + otra huella → 23505;
--                              · otra operación + misma huella → replay (el
--                                cliente perdió su UUID, la petición lógica
--                                es la misma);
--                              · otra operación + otra huella → 22023: la
--                                ruta ya tiene cierre financiero;
--                              · operación usada en otra ruta → 23505.
--                              Todos los efectos y la fila del cierre van en
--                              UNA transacción: si algo falla no queda marca.
--   cerrar_ruta_financiero(p_ruta_id, p_entregas, p_usuario_id, p_usuario_nombre)
--                              Sobrecarga legacy (código desplegado antes de
--                              086): delega con gen_random_uuid(); queda
--                              protegida por la huella. Se retira cuando el
--                              cliente ya no la llame.
--
-- No cambia: autorización (Admin/Chofer dueño), estados de ruta aceptados,
-- proceso de órdenes normales, pagos, CxC, ingresos, folios, 069/079/080/
-- 081/085. Idempotente (CREATE OR REPLACE / IF NOT EXISTS).

-- ═══ 1. Tabla del evento ═══
CREATE TABLE IF NOT EXISTS cierres_financieros_ruta (
  ruta_id       BIGINT PRIMARY KEY REFERENCES rutas(id) ON DELETE CASCADE,
  operacion_id  UUID        NOT NULL,
  huella        TEXT        NOT NULL,
  actor_id      BIGINT,
  actor         TEXT        NOT NULL,
  resultado     JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cierres_financieros_ruta_operacion_key ON cierres_financieros_ruta (operacion_id);
COMMENT ON TABLE cierres_financieros_ruta IS
  '086: una fila por ruta con cierre financiero exitoso (operación, huella lógica del payload, actor y resultado). Solo la escribe cerrar_ruta_financiero; sin escritura por REST.';

-- Sin acceso por REST (ni lectura): RLS activa sin policies y sin grants a
-- anon/authenticated. service_role y las funciones SECURITY DEFINER la usan.
ALTER TABLE cierres_financieros_ruta ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_financieros_ruta FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cierres_financieros_ruta FROM PUBLIC, anon, authenticated;
GRANT ALL ON cierres_financieros_ruta TO service_role;

-- ═══ 2. Huella lógica del cierre ═══
CREATE OR REPLACE FUNCTION fin_huella_cierre(p_ruta_id BIGINT, p_entregas JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH e AS (
    SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_entregas) = 'array' THEN p_entregas ELSE '[]'::jsonb END) AS x
  ), norm AS (
    SELECT CASE
      WHEN COALESCE((x ->> 'express')::boolean, false) = false AND NULLIF(x ->> 'ordenId', '') IS NOT NULL THEN
        jsonb_build_object(
          't', 'o',
          'orden', (x ->> 'ordenId')::bigint,
          'pago', NULLIF(btrim(COALESCE(x ->> 'pago', '')), ''),
          'ref',  NULLIF(btrim(COALESCE(x ->> 'referencia', '')), ''))
      ELSE
        jsonb_build_object(
          't', 'x',
          'cliente_id', NULLIF(x ->> 'clienteId', '')::bigint,
          'cliente', NULLIF(btrim(COALESCE(x ->> 'cliente', '')), ''),
          'factura', COALESCE((x ->> 'factura')::boolean, false),
          'pago', NULLIF(btrim(COALESCE(x ->> 'pago', '')), ''),
          'ref',  NULLIF(btrim(COALESCE(x ->> 'referencia', '')), ''),
          'items', COALESCE((
            SELECT jsonb_agg(it ORDER BY it ->> 'sku', (it ->> 'cant')::numeric, (it ->> 'precio')::numeric)
              FROM (
                SELECT jsonb_build_object(
                  'sku', btrim(COALESCE(i ->> 'sku', '')),
                  'cant', COALESCE((i ->> 'cant')::numeric, (i ->> 'qty')::numeric, 0),
                  'precio', round(COALESCE((i ->> 'precio')::numeric, 0), 2)) AS it
                  FROM jsonb_array_elements(COALESCE(x -> 'items', '[]'::jsonb)) AS i
              ) s), '[]'::jsonb))
      END AS n
    FROM e
  )
  SELECT md5(jsonb_build_object(
    'ruta', p_ruta_id,
    'entregas', COALESCE((SELECT jsonb_agg(n ORDER BY n::text) FROM norm), '[]'::jsonb))::text)
$$;
REVOKE ALL ON FUNCTION fin_huella_cierre(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

-- ═══ 3. Contrato con operación ═══
CREATE OR REPLACE FUNCTION cerrar_ruta_financiero(
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

      UPDATE ordenes
         SET estatus = 'Entregada', metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id;
      n_upd := n_upd + 1;

      v_total := round(COALESCE(v_ord.total, 0), 2);
      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_ord.cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_ord.id, 15);
          IF (v_res->>'creada')::boolean THEN n_cxc := n_cxc + 1; END IF;
        ELSE
          v_res := registrar_pago_orden(v_ord.id, v_metodo, e->>'referencia', p_usuario_id);
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

      SELECT round(COALESCE(SUM(COALESCE((i->>'cant')::numeric, (i->>'qty')::numeric, 0) * COALESCE((i->>'precio')::numeric, 0)), 0), 2),
             string_agg(COALESCE(i->>'cant', i->>'qty', '0') || '×' || COALESCE(i->>'sku', '?'), ', ')
        INTO v_total, v_items_str
        FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) AS i;

      v_folio := 'OV-' || lpad(pg_catalog.nextval('folio_ov_seq'::regclass)::text, 4, '0');

      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, ruta_id, requiere_factura, vendedor_id, tipo_cobro)
      VALUES (v_folio, v_cliente_id, COALESCE(NULLIF(e->>'cliente', ''), 'Público en general'),
              COALESCE(v_items_str, 'Varios'), fin_hoy(), v_total, 'Entregada', v_metodo, p_ruta_id, v_factura, p_usuario_id,
              CASE WHEN fin_es_credito(v_metodo) THEN 'Credito' ELSE 'Contado' END)
      RETURNING id INTO v_nuevo_id;
      n_exp := n_exp + 1;
      v_express := v_express || jsonb_build_object('id', v_nuevo_id, 'folio', v_folio, 'total', v_total);

      FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) LOOP
        INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
        VALUES (v_nuevo_id, it->>'sku',
                COALESCE((it->>'cant')::int, (it->>'qty')::int, 0),
                round(COALESCE((it->>'precio')::numeric, 0), 2),
                round(COALESCE((it->>'cant')::numeric, (it->>'qty')::numeric, 0) * COALESCE((it->>'precio')::numeric, 0), 2));
      END LOOP;

      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_nuevo_id, 15);
          n_cxc := n_cxc + 1;
        ELSE
          v_res := registrar_pago_orden(v_nuevo_id, v_metodo, e->>'referencia', p_usuario_id);
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
REVOKE ALL ON FUNCTION cerrar_ruta_financiero(UUID, BIGINT, JSONB, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cerrar_ruta_financiero(UUID, BIGINT, JSONB, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 4. Sobrecarga legacy: delega (protegida por la huella) ═══
CREATE OR REPLACE FUNCTION cerrar_ruta_financiero(
  p_ruta_id BIGINT, p_entregas JSONB, p_usuario_id BIGINT DEFAULT NULL, p_usuario_nombre TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Código desplegado antes de 086: no trae operacion_id. Una operación nueva
  -- por llamada; si la ruta ya cerró con la misma huella → replay, con otra
  -- huella → 22023. Nunca duplica.
  RETURN cerrar_ruta_financiero(gen_random_uuid(), p_ruta_id, p_entregas, p_usuario_id, p_usuario_nombre);
END $$;
REVOKE ALL ON FUNCTION cerrar_ruta_financiero(BIGINT, JSONB, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cerrar_ruta_financiero(BIGINT, JSONB, BIGINT, TEXT) TO authenticated, service_role;
