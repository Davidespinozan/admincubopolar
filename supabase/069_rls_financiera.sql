-- 069_rls_financiera.sql — P1 Fase A: cierre de P0-1, P0-2 y P0-3.
--
-- PRINCIPIO: ningún actor altera dinero escribiendo tablas financieras
-- por REST. Las operaciones financieras legítimas pasan por contratos
-- explícitos (RPC SECURITY DEFINER con verificación de rol) o por el
-- backend (service_role).
--
-- Contenido:
--   0. Helpers de autorización financiera (fin_actor_permitido, contexto rpc).
--   1. increment_saldo con autorización; legacy timbrar_orden /
--      registrar_pago / move_stock / check_orden_transition sin EXECUTE.
--   2. Contratos: crear_cxc_orden, registrar_ingreso_orden,
--      registrar_pago_orden (P0-1: nunca cobra más que el pendiente),
--      abonar_cxc (atómico, monto <= saldo), cerrar_ruta_financiero
--      (cierre de ruta financiero en UNA transacción).
--   3. update_orden_atomic y cerrar_ruta_atomic con verificación de rol.
--   4. Trigger guard en ordenes: total, cliente_id, tipo_cobro,
--      requiere_factura, facturama_*, cfdi_* inmutables por REST; estatus
--      solo por transiciones permitidas; metodo_pago solo al cobrar.
--   5. Políticas: se eliminan cxc_write, auth_insert, insert_roles,
--      write_roles, update_roles, rollback_delete (pagos/cxc/movimientos),
--      chofer_update_saldo. Queda admin_all como capacidad de reparación
--      documentada. INSERT operativo de egresos (mermas, costo de ventas,
--      proveedores) para Chofer/Producción/Almacén Bolsas con WITH CHECK.
--   6. REVOKE a anon sobre pagos / cuentas_por_cobrar / movimientos_contables.
--
-- Sin cambios de datos financieros. Idempotente (CREATE OR REPLACE,
-- DROP POLICY IF EXISTS, REVOKE tolerante).

-- ═══════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═══════════════════════════════════════════════════════════════

-- Rol JWT tal como lo ve PostgREST: 'anon' | 'authenticated' |
-- 'service_role' | NULL (sesión directa a Postgres / SQL Editor).
CREATE OR REPLACE FUNCTION fin_jwt_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;

-- Verdadero dentro de un contrato financiero (RPC de esta migración).
-- El GUC es transaction-local y solo lo fijan las RPC; PostgREST no
-- permite a un cliente fijar GUCs app.*.
CREATE OR REPLACE FUNCTION fin_ctx_activo() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.fin_ctx', true), '') = 'rpc'
$$;

CREATE OR REPLACE FUNCTION fin_marcar_ctx() RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('app.fin_ctx', 'rpc', true)
$$;

-- ¿El actor actual puede ejecutar una operación financiera?
--   - service_role (backend) o sesión sin JWT (postgres): sí.
--   - dentro de un contrato rpc: sí.
--   - usuario del ERP con rol en p_roles: sí.
-- Rol del usuario del ERP SOLO si su perfil está Activo (get_my_rol ignora
-- estatus; un JWT de un usuario desactivado sigue siendo válido en Auth).
CREATE OR REPLACE FUNCTION fin_mi_rol_activo() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rol::TEXT FROM usuarios
   WHERE lower(email) = lower(auth.jwt() ->> 'email')
     AND COALESCE(estatus, 'Activo') = 'Activo'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fin_actor_permitido(p_roles TEXT[]) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN RETURN TRUE; END IF;
  IF fin_ctx_activo() THEN RETURN TRUE; END IF;
  IF v_jwt <> 'authenticated' THEN RETURN FALSE; END IF;
  RETURN COALESCE(fin_mi_rol_activo(), '') = ANY (p_roles);
END $$;

CREATE OR REPLACE FUNCTION fin_hoy() RETURNS DATE
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Mexico_City')::date
$$;

-- Definición única de "crédito" (antes había tres distintas en JS).
CREATE OR REPLACE FUNCTION fin_es_credito(p_metodo TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(COALESCE(p_metodo, '')) LIKE '%crédito%'
      OR lower(COALESCE(p_metodo, '')) LIKE '%credito%'
      OR lower(COALESCE(p_metodo, '')) LIKE '%fiado%'
$$;

REVOKE EXECUTE ON FUNCTION fin_marcar_ctx() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 1. increment_saldo AUTORIZADO + LEGACY SIN EXECUTE
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_saldo(p_cli BIGINT, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'increment_saldo: operación financiera no autorizada para este actor'
      USING ERRCODE = '42501';
  END IF;
  UPDATE clientes SET saldo = COALESCE(saldo, 0) + p_delta WHERE id = p_cli;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  -- Legacy peligrosas: sin EXECUTE para nadie salvo el owner.
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('timbrar_orden', 'registrar_pago', 'move_stock', 'check_orden_transition')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
  END LOOP;

  -- Mutaciones que la app sí usa: nunca desde anon / PUBLIC.
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('increment_saldo', 'asignar_orden', 'cancelar_orden_asignada',
                         'asignar_ordenes_a_ruta', 'cerrar_ruta_atomic', 'update_orden_atomic',
                         'update_stocks_atomic', 'update_productos_stock_atomic',
                         'confirmar_produccion', 'rename_sku', 'nextval')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. CONTRATOS FINANCIEROS
-- ═══════════════════════════════════════════════════════════════

-- 2a. CxC de una orden a crédito. Idempotente (idx_cxc_orden_unique).
--     Inserta la CxC y sube clientes.saldo en la misma transacción.
CREATE OR REPLACE FUNCTION crear_cxc_orden(p_orden_id BIGINT, p_dias_vencimiento INT DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ord   ordenes%ROWTYPE;
  v_cli   RECORD;
  v_cxc_id BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'crear_cxc_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada', p_orden_id; END IF;
  IF v_ord.cliente_id IS NULL THEN RAISE EXCEPTION 'Orden % sin cliente: no puede ir a crédito', p_orden_id; END IF;
  IF COALESCE(v_ord.total, 0) <= 0 THEN RAISE EXCEPTION 'Orden % sin total', p_orden_id; END IF;

  SELECT id INTO v_cxc_id FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;
  IF FOUND THEN
    RETURN jsonb_build_object('creada', false, 'cxc_id', v_cxc_id);
  END IF;

  SELECT nombre INTO v_cli FROM clientes WHERE id = v_ord.cliente_id;

  INSERT INTO cuentas_por_cobrar
    (cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, concepto, estatus)
  VALUES
    (v_ord.cliente_id, p_orden_id, fin_hoy(), fin_hoy() + COALESCE(p_dias_vencimiento, 30),
     round(v_ord.total, 2), 0, round(v_ord.total, 2),
     COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || COALESCE(v_cli.nombre, 'Cliente'), 'Pendiente')
  RETURNING id INTO v_cxc_id;

  UPDATE clientes SET saldo = COALESCE(saldo, 0) + round(v_ord.total, 2) WHERE id = v_ord.cliente_id;

  RETURN jsonb_build_object('creada', true, 'cxc_id', v_cxc_id, 'monto', round(v_ord.total, 2));
END $$;

-- 2b. Ingreso contable "Ventas" de una orden de contado. Idempotente.
CREATE OR REPLACE FUNCTION registrar_ingreso_orden(p_orden_id BIGINT, p_usuario_id BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ord ordenes%ROWTYPE;
  v_id  BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_ingreso_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada', p_orden_id; END IF;
  IF COALESCE(v_ord.total, 0) <= 0 THEN RETURN jsonb_build_object('creado', false, 'motivo', 'sin_total'); END IF;

  SELECT id INTO v_id FROM movimientos_contables
   WHERE orden_id = p_orden_id AND tipo = 'Ingreso' AND categoria = 'Ventas' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('creado', false, 'movimiento_id', v_id); END IF;

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id, usuario_id)
  VALUES (fin_hoy(), 'Ingreso', 'Ventas',
          'Cobro ' || COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || COALESCE(v_ord.cliente_nombre, 'Cliente'),
          round(v_ord.total, 2), p_orden_id, p_usuario_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('creado', true, 'movimiento_id', v_id);
END $$;

-- 2c. Abono a una CxC: atómico, monto <= saldo pendiente. Sustituye la
--     cadena de 4 escrituras con compensaciones manuales de cobrarCxC.
CREATE OR REPLACE FUNCTION abonar_cxc(
  p_cxc_id BIGINT, p_monto NUMERIC, p_metodo TEXT, p_referencia TEXT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cxc   cuentas_por_cobrar%ROWTYPE;
  v_monto NUMERIC := round(COALESCE(p_monto, 0), 2);
  v_nuevo_pagado NUMERIC;
  v_nuevo_saldo  NUMERIC;
  v_estatus TEXT;
  v_pago_id BIGINT;
  v_mov_id  BIGINT;
  v_ref TEXT;
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

  v_nuevo_pagado := round(COALESCE(v_cxc.monto_pagado, 0) + v_monto, 2);
  v_nuevo_saldo  := greatest(0, round(COALESCE(v_cxc.monto_original, 0) - v_nuevo_pagado, 2));
  v_estatus := CASE WHEN v_nuevo_saldo <= 0 THEN 'Pagada' WHEN v_nuevo_pagado > 0 THEN 'Parcial' ELSE 'Pendiente' END;
  v_ref := COALESCE(NULLIF(btrim(p_referencia), ''),
                    'Abono CxC #' || p_cxc_id || ' ' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  UPDATE cuentas_por_cobrar
     SET monto_pagado = v_nuevo_pagado, saldo_pendiente = v_nuevo_saldo, estatus = v_estatus
   WHERE id = p_cxc_id;

  INSERT INTO pagos (cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (v_cxc.cliente_id, v_cxc.orden_id, p_cxc_id, v_monto, COALESCE(NULLIF(p_metodo, ''), 'Efectivo'), fin_hoy(),
          v_ref, round(v_cxc.saldo_pendiente, 2), v_nuevo_saldo, p_usuario_id)
  RETURNING id INTO v_pago_id;

  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, orden_id, usuario_id)
  VALUES (fin_hoy(), 'Ingreso', 'Cobranza',
          'Cobro CxC #' || p_cxc_id || ' — ' || COALESCE(v_cxc.concepto, 'Cliente'),
          v_monto, v_cxc.orden_id, p_usuario_id)
  RETURNING id INTO v_mov_id;

  IF v_cxc.cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo = COALESCE(saldo, 0) - v_monto WHERE id = v_cxc.cliente_id;
  END IF;

  RETURN jsonb_build_object('pago_id', v_pago_id, 'movimiento_id', v_mov_id,
                            'saldo_despues', v_nuevo_saldo, 'estatus', v_estatus);
END $$;

-- 2d. Cobro de contado de una orden (entrega / mostrador / cierre de ruta).
--     P0-1: cobra SOLO el pendiente = total - SUM(pagos). Si la orden ya
--     fue pagada (por link, por abono o por otra captura) no inserta nada.
--     Si la orden tiene CxC, el cobro es un abono a esa CxC.
CREATE OR REPLACE FUNCTION registrar_pago_orden(
  p_orden_id BIGINT, p_metodo TEXT, p_referencia TEXT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ord     ordenes%ROWTYPE;
  v_cxc     cuentas_por_cobrar%ROWTYPE;
  v_pagado  NUMERIC;
  v_pend    NUMERIC;
  v_ref     TEXT;
  v_metodo  TEXT := COALESCE(NULLIF(p_metodo, ''), 'Efectivo');
  v_pago_id BIGINT;
  v_res     JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_pago_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_ord.estatus = 'Cancelada' THEN RAISE EXCEPTION 'Orden % cancelada: no se puede cobrar', p_orden_id; END IF;

  SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
  v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
  IF v_pend <= 0 THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ya_pagada', 'pagado', v_pagado, 'total', v_ord.total);
  END IF;

  -- Orden con CxC viva: el cobro es un abono (mantiene CxC y saldo coherentes).
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id;
  IF FOUND THEN
    IF v_cxc.estatus = 'Pagada' OR COALESCE(v_cxc.saldo_pendiente, 0) <= 0 THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'cxc_liquidada', 'cxc_id', v_cxc.id);
    END IF;
    v_res := abonar_cxc(v_cxc.id, least(v_pend, round(v_cxc.saldo_pendiente, 2)), v_metodo, p_referencia, p_usuario_id);
    RETURN v_res || jsonb_build_object('aplicado', true, 'via', 'cxc');
  END IF;

  v_ref := COALESCE(NULLIF(btrim(p_referencia), ''), COALESCE(v_ord.folio, 'ORD-' || p_orden_id) || '-' || v_metodo);
  IF EXISTS (SELECT 1 FROM pagos WHERE referencia = v_ref) THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'referencia_existente', 'referencia', v_ref);
  END IF;

  INSERT INTO pagos (cliente_id, orden_id, cxc_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (v_ord.cliente_id, p_orden_id, NULL, v_pend, v_metodo, fin_hoy(), v_ref, 0, 0, p_usuario_id)
  RETURNING id INTO v_pago_id;

  PERFORM registrar_ingreso_orden(p_orden_id, p_usuario_id);

  RETURN jsonb_build_object('aplicado', true, 'via', 'contado', 'pago_id', v_pago_id, 'monto', v_pend, 'referencia', v_ref);
END $$;

-- 2e. Cierre financiero de ruta en UNA transacción (chofer dueño o Admin).
--     p_entregas: [{ ordenId, pago, referencia, express, clienteId, cliente,
--                    items:[{sku,cant|qty,precio}], factura }]
--     Sustituye la sección financiera de cerrarRutaCompleta y su rollback
--     por DELETE. Usa ordenes.total del servidor (nunca e.total).
CREATE OR REPLACE FUNCTION cerrar_ruta_financiero(
  p_ruta_id BIGINT, p_entregas JSONB, p_usuario_id BIGINT DEFAULT NULL, p_usuario_nombre TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ruta    rutas%ROWTYPE;
  v_rol     TEXT;
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
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ruta % no existe', p_ruta_id; END IF;
  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'Ruta % ya está %', p_ruta_id, v_ruta.estatus;
  END IF;

  v_rol := fin_mi_rol_activo();
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer'
     AND v_ruta.chofer_id IS DISTINCT FROM get_my_user_id() THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  IF p_entregas IS NULL OR jsonb_typeof(p_entregas) <> 'array' THEN
    p_entregas := '[]'::jsonb;
  END IF;

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

  RETURN jsonb_build_object(
    'success', true, 'ruta_id', p_ruta_id,
    'ordenes_entregadas', n_upd, 'ventas_express', n_exp,
    'pagos', n_pagos, 'cxc', n_cxc, 'saltadas', v_saltadas
  );
END $$;

-- Contratos: solo authenticated (verifican rol adentro) y service_role.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('crear_cxc_orden', 'registrar_ingreso_orden', 'abonar_cxc',
                         'registrar_pago_orden', 'cerrar_ruta_financiero', 'fin_actor_permitido')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.fn);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. RPC EXISTENTES CON VERIFICACIÓN DE ROL
-- ═══════════════════════════════════════════════════════════════

-- 3a. update_orden_atomic (058) — Admin/Ventas; marca contexto para que
--     el trigger guard permita cambiar total/cliente en Creada.
CREATE OR REPLACE FUNCTION update_orden_atomic(
  p_orden_id      BIGINT,
  p_update_fields JSONB,
  p_lineas        JSONB
) RETURNS JSONB AS $$
DECLARE
  v_estatus_actual TEXT;
  v_count_lineas   INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'update_orden_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT estatus INTO v_estatus_actual
    FROM ordenes
   WHERE id = p_orden_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden % no existe', p_orden_id;
  END IF;

  IF v_estatus_actual <> 'Creada' THEN
    RAISE EXCEPTION 'Solo se pueden editar órdenes en estatus Creada (actual: %)', v_estatus_actual;
  END IF;

  IF p_update_fields IS NOT NULL AND jsonb_typeof(p_update_fields) = 'object' THEN
    UPDATE ordenes SET
      cliente_nombre      = COALESCE(p_update_fields->>'cliente_nombre',      cliente_nombre),
      cliente_id          = COALESCE((p_update_fields->>'cliente_id')::bigint, cliente_id),
      fecha               = COALESCE((p_update_fields->>'fecha')::date,       fecha),
      tipo_cobro          = COALESCE(p_update_fields->>'tipo_cobro',          tipo_cobro),
      folio_nota          = CASE WHEN p_update_fields ? 'folio_nota'
                                 THEN p_update_fields->>'folio_nota'
                                 ELSE folio_nota END,
      direccion_entrega   = CASE WHEN p_update_fields ? 'direccion_entrega'
                                 THEN p_update_fields->>'direccion_entrega'
                                 ELSE direccion_entrega END,
      referencia_entrega  = CASE WHEN p_update_fields ? 'referencia_entrega'
                                 THEN p_update_fields->>'referencia_entrega'
                                 ELSE referencia_entrega END,
      latitud_entrega     = CASE WHEN p_update_fields ? 'latitud_entrega'
                                 THEN NULLIF(p_update_fields->>'latitud_entrega', '')::numeric
                                 ELSE latitud_entrega END,
      longitud_entrega    = CASE WHEN p_update_fields ? 'longitud_entrega'
                                 THEN NULLIF(p_update_fields->>'longitud_entrega', '')::numeric
                                 ELSE longitud_entrega END,
      total               = COALESCE((p_update_fields->>'total')::numeric,    total),
      productos           = COALESCE(p_update_fields->>'productos',           productos),
      updated_at          = NOW()
    WHERE id = p_orden_id;
  END IF;

  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' THEN
    DELETE FROM orden_lineas WHERE orden_id = p_orden_id;
    IF jsonb_array_length(p_lineas) > 0 THEN
      INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
      SELECT
        p_orden_id,
        e->>'sku',
        (e->>'cantidad')::int,
        (e->>'precio_unit')::numeric,
        (e->>'subtotal')::numeric
      FROM jsonb_array_elements(p_lineas) AS e;
      GET DIAGNOSTICS v_count_lineas = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'orden_id', p_orden_id, 'lineas_insertadas', v_count_lineas);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3b. cerrar_ruta_atomic (059) — inserta un Ingreso agregado: solo Admin.
--     (cerrarRutaCompleta no la usa; cerrarRuta administrativo sí.)
CREATE OR REPLACE FUNCTION cerrar_ruta_atomic(
  p_ruta_id BIGINT,
  p_devoluciones JSONB,
  p_cuarto_frio_id TEXT,
  p_entregas JSONB,
  p_total_cobrado NUMERIC,
  p_total_credito NUMERIC,
  p_usuario TEXT
) RETURNS JSONB AS $$
DECLARE
  v_ruta rutas%ROWTYPE;
  v_changes JSONB := '[]'::jsonb;
  v_sku TEXT;
  v_qty INT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'cerrar_ruta_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF v_ruta IS NULL THEN
    RAISE EXCEPTION 'Ruta % no encontrada', p_ruta_id;
  END IF;
  IF v_ruta.estatus = 'Cerrada' THEN
    RAISE EXCEPTION 'Ruta % ya está cerrada', p_ruta_id;
  END IF;

  UPDATE rutas SET
    estatus       = 'Cerrada',
    cierre_at     = NOW(),
    devolucion    = p_devoluciones,
    total_cobrado = p_total_cobrado,
    total_credito = p_total_credito
  WHERE id = p_ruta_id;

  IF p_devoluciones IS NOT NULL AND jsonb_typeof(p_devoluciones) = 'object' THEN
    FOR v_sku, v_qty IN
      SELECT key, value::INT
        FROM jsonb_each_text(p_devoluciones)
       WHERE NULLIF(value, '') IS NOT NULL
    LOOP
      IF v_qty > 0 THEN
        v_changes := v_changes || jsonb_build_object(
          'cuarto_id', p_cuarto_frio_id,
          'sku',       v_sku,
          'delta',     v_qty,
          'tipo',      'Entrada',
          'origen',    'Devolución ruta ' || v_ruta.folio,
          'usuario',   p_usuario
        );
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    PERFORM update_stocks_atomic(v_changes);
  END IF;

  IF p_total_cobrado > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, created_at)
    VALUES (
      CURRENT_DATE,
      'Ingreso',
      'Ventas',
      'Cobros ruta ' || v_ruta.folio || ' — ' || v_ruta.nombre,
      p_total_cobrado,
      NOW()
    );
  END IF;

  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES (
    'Cerrar',
    'Rutas',
    v_ruta.folio || ' — Cobrado: $' || p_total_cobrado || ', Crédito: $' || p_total_credito,
    p_usuario,
    NOW()
  );

  RETURN jsonb_build_object(
    'success',       true,
    'ruta_id',       p_ruta_id,
    'folio',         v_ruta.folio,
    'total_cobrado', p_total_cobrado,
    'total_credito', p_total_credito
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error cerrando ruta: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- 4. TRIGGER GUARD EN ordenes (compara OLD vs NEW; RLS no puede)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ordenes_guard_financiero() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_rol TEXT;
  v_ok  BOOLEAN;
BEGIN
  -- Backend (service_role), sesión directa (postgres) y contratos rpc:
  -- sin restricción aquí (ya autorizados).
  IF v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo() THEN
    RETURN NEW;
  END IF;

  v_rol := COALESCE(fin_mi_rol_activo(), '');

  -- Campos financieros/fiscales: inmutables por REST para cualquier rol.
  IF NEW.total            IS DISTINCT FROM OLD.total
     OR NEW.cliente_id    IS DISTINCT FROM OLD.cliente_id
     OR NEW.tipo_cobro    IS DISTINCT FROM OLD.tipo_cobro
     OR NEW.requiere_factura IS DISTINCT FROM OLD.requiere_factura
     OR NEW.facturama_id  IS DISTINCT FROM OLD.facturama_id
     OR NEW.facturama_folio IS DISTINCT FROM OLD.facturama_folio
     OR NEW.facturama_uuid IS DISTINCT FROM OLD.facturama_uuid
     OR NEW.cfdi_cancelado_at IS DISTINCT FROM OLD.cfdi_cancelado_at
     OR NEW.cfdi_cancelado_motivo IS DISTINCT FROM OLD.cfdi_cancelado_motivo
     OR NEW.cfdi_cancelado_motivo_detalle IS DISTINCT FROM OLD.cfdi_cancelado_motivo_detalle
     OR NEW.cfdi_cancelado_uuid_sustituto IS DISTINCT FROM OLD.cfdi_cancelado_uuid_sustituto
     OR NEW.cfdi_cancelado_por IS DISTINCT FROM OLD.cfdi_cancelado_por
  THEN
    RAISE EXCEPTION 'ordenes: campo financiero/fiscal inmutable por REST (usa el flujo autorizado)'
      USING ERRCODE = '42501';
  END IF;

  -- ruta_id: Admin, o asignación Creada→Asignada (RPC asignar_ordenes_a_ruta).
  IF NEW.ruta_id IS DISTINCT FROM OLD.ruta_id AND v_rol <> 'Admin'
     AND NOT (OLD.estatus = 'Creada' AND NEW.estatus = 'Asignada') THEN
    RAISE EXCEPTION 'ordenes: ruta_id solo lo cambia Admin o la asignación de ruta' USING ERRCODE = '42501';
  END IF;

  -- metodo_pago: solo al registrar la entrega/cobro, o Admin.
  IF NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago AND v_rol <> 'Admin'
     AND NOT (NEW.estatus = 'Entregada' AND OLD.estatus IS DISTINCT FROM 'Entregada') THEN
    RAISE EXCEPTION 'ordenes: metodo_pago solo cambia al cobrar' USING ERRCODE = '42501';
  END IF;

  -- estatus: transiciones de la FSM del ERP. Facturada/Entregada←Facturada
  -- son exclusivas del backend.
  IF NEW.estatus IS DISTINCT FROM OLD.estatus THEN
    v_ok := CASE OLD.estatus
      WHEN 'Creada'   THEN NEW.estatus IN ('Asignada', 'Cancelada')
      WHEN 'Asignada' THEN NEW.estatus IN ('En ruta', 'Entregada', 'No entregada', 'Cancelada')
                           OR (NEW.estatus = 'Creada' AND v_rol = 'Admin')
      WHEN 'En ruta'  THEN NEW.estatus IN ('Entregada', 'No entregada', 'Cancelada')
      ELSE FALSE
    END;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'ordenes: transición % → % no permitida por REST', OLD.estatus, NEW.estatus
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ordenes_guard_financiero ON ordenes;
CREATE TRIGGER trg_ordenes_guard_financiero
  BEFORE UPDATE ON ordenes
  FOR EACH ROW EXECUTE FUNCTION ordenes_guard_financiero();

-- ═══════════════════════════════════════════════════════════════
-- 5. POLÍTICAS
-- ═══════════════════════════════════════════════════════════════

-- cuentas_por_cobrar: solo lectura para roles; escritura Admin (reparación
-- documentada) + contratos + backend.
DROP POLICY IF EXISTS "cxc_write"       ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "auth_insert"     ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "write_roles"     ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "update_roles"    ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "rollback_delete" ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "admin_write"     ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "cxc_read_all"    ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "auth_all_cuentas_por_cobrar" ON cuentas_por_cobrar;
DROP POLICY IF EXISTS "read_all"        ON cuentas_por_cobrar;
CREATE POLICY "read_all" ON cuentas_por_cobrar FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin_all"       ON cuentas_por_cobrar;
CREATE POLICY "admin_all" ON cuentas_por_cobrar FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

-- pagos: idem.
DROP POLICY IF EXISTS "auth_insert"     ON pagos;
DROP POLICY IF EXISTS "insert_roles"    ON pagos;
DROP POLICY IF EXISTS "rollback_delete" ON pagos;
DROP POLICY IF EXISTS "pagos_write"     ON pagos;
DROP POLICY IF EXISTS "pagos_read_all"  ON pagos;
DROP POLICY IF EXISTS "auth_all_pagos"  ON pagos;
DROP POLICY IF EXISTS "read_all"        ON pagos;
CREATE POLICY "read_all" ON pagos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin_all"       ON pagos;
CREATE POLICY "admin_all" ON pagos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

-- movimientos_contables: Admin todo; Facturación lee; egresos operativos
-- (mermas, costo de ventas, proveedores) por Chofer/Producción/Almacén
-- Bolsas con WITH CHECK; ingresos SOLO por contratos/backend/Admin.
DROP POLICY IF EXISTS "auth_insert"        ON movimientos_contables;
DROP POLICY IF EXISTS "rollback_delete"    ON movimientos_contables;
DROP POLICY IF EXISTS "facturacion_insert" ON movimientos_contables;
DROP POLICY IF EXISTS "admin_write"        ON movimientos_contables;
DROP POLICY IF EXISTS "read_all"           ON movimientos_contables;
DROP POLICY IF EXISTS "auth_all_movimientos_contables" ON movimientos_contables;
DROP POLICY IF EXISTS "egreso_operativo_insert" ON movimientos_contables;
CREATE POLICY "egreso_operativo_insert" ON movimientos_contables FOR INSERT TO authenticated
  WITH CHECK (
    get_my_rol() IN ('Chofer', 'Producción', 'Almacén Bolsas', 'Bolsas')
    AND tipo = 'Egreso'
    AND categoria IN ('Mermas', 'Costo de Ventas', 'Proveedores')
    AND orden_id IS NULL
  );
DROP POLICY IF EXISTS "admin_all" ON movimientos_contables;
CREATE POLICY "admin_all" ON movimientos_contables FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
DROP POLICY IF EXISTS "facturacion_read" ON movimientos_contables;
CREATE POLICY "facturacion_read" ON movimientos_contables FOR SELECT TO authenticated
  USING (get_my_rol() = 'Facturación');

-- clientes: el saldo ya solo cambia por contratos; Chofer no edita clientes.
DROP POLICY IF EXISTS "chofer_update_saldo" ON clientes;

-- ═══════════════════════════════════════════════════════════════
-- 6. anon fuera del ledger
-- ═══════════════════════════════════════════════════════════════
REVOKE ALL ON TABLE pagos, cuentas_por_cobrar, movimientos_contables FROM anon;

COMMENT ON FUNCTION registrar_pago_orden(BIGINT, TEXT, TEXT, BIGINT) IS
  'P1 Fase A: cobro de contado; cobra solo el pendiente (total - SUM(pagos)); con CxC viva delega en abonar_cxc.';
COMMENT ON FUNCTION cerrar_ruta_financiero(BIGINT, JSONB, BIGINT, TEXT) IS
  'P1 Fase A: sección financiera del cierre de ruta en una transacción; usa ordenes.total del servidor.';
COMMENT ON POLICY "admin_all" ON cuentas_por_cobrar IS
  'Capacidad de reparación de Admin (documentada en docs/PENDIENTES_TECNICOS.md). Flujos normales: contratos RPC.';
