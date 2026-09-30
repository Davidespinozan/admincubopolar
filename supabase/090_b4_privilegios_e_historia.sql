-- 090_b4_privilegios_e_historia.sql — B4: superficie de privilegios y
-- ejecución (parte 1 de 2; la 091 retira la escritura directa de
-- cuentas_por_cobrar una vez desplegado el frontend que usa los contratos).
--
-- Frontera de confianza: Admin tiene AUTORIDAD DE NEGOCIO (catálogo, usuarios,
-- ajustes manuales de stock, asientos contables manuales, cierres por
-- contrato) pero su JWT NO puede reescribir historia canónica de eventos.
-- service_role y SQL de confianza siguen siendo autoridad de mantenimiento.
--
-- Mecanismo de las guardas de historia: disparadores SECURITY INVOKER que
-- revisan current_user. Una escritura REST directa corre como
-- 'authenticated'/'anon'; un contrato SECURITY DEFINER corre como su dueño
-- (postgres) y service_role como service_role: ambos quedan fuera de la
-- guarda sin depender de claims del JWT.
--
-- Cambios:
--   1. nextval: solo Admin activo, solo public.folio_r_seq, search_path fijo.
--   2. notificaciones: INSERT solo actor activo; UPDATE solo cambia 'leida'.
--   3. payment_webhook_events / payment_intents / invoice_attempts: lectura
--      solo Admin y Facturación (payloads crudos de proveedores).
--   4. Historia canónica: rutas con historia no se borran; inventario_mov
--      append-only y sin espacios de nombres de contratos; pagos sin DML
--      directo; asientos y costos generados por contratos inmutables;
--      órdenes solo se borran en Creada/Cancelada sin CFDI.
--   5. Contratos acotados de CxC para la cancelación de órdenes y la
--      devolución de clientes (sustituyen la escritura REST directa).
--   6. Privilegios por defecto de postgres: nada automático para anon /
--      authenticated / PUBLIC en tablas, secuencias y funciones nuevas.
--   7. Grants existentes: anon sin acceso a tablas/secuencias; authenticated
--      sin TRUNCATE/REFERENCES/TRIGGER y solo el DML que usa el frontend;
--      secuencias: solo USAGE donde el frontend inserta directo.
--   8. EXECUTE: sin API en funciones de disparador; helpers de solo lectura
--      sin PUBLIC/anon; search_path fijo en helpers invocadores.
--   9. DROP de 8 funciones muertas; sin policy admin_all inutilizable en
--      stock_operaciones.
--  10. Folios OP-/TR-/OV-: el padding es ancho MÍNIMO (sin truncar).
--  11. erp_actor_etiqueta: 'sql' para SQL sin JWT (solo etiqueta forense).

-- ═══ 1. nextval ═══
CREATE OR REPLACE FUNCTION public.nextval(seq_name TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- 090: único uso legítimo = folio de ruta del Admin (addRuta). Nunca
  -- resuelve el texto del llamador a una secuencia arbitraria.
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'nextval: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(seq_name, '')) NOT IN ('folio_r_seq', 'public.folio_r_seq') THEN
    RAISE EXCEPTION 'nextval: secuencia no permitida' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.nextval('public.folio_r_seq'::regclass);
END $$;
REVOKE ALL ON FUNCTION public.nextval(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nextval(TEXT) TO authenticated, service_role;

-- ═══ 2. Guarda común: ¿escritura REST directa? ═══
CREATE OR REPLACE FUNCTION public.b4_escritura_api() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT current_user IN ('authenticated', 'anon')
$$;
REVOKE ALL ON FUNCTION public.b4_escritura_api() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b4_escritura_api() TO authenticated, service_role;

-- ═══ 3. Notificaciones ═══
DROP POLICY IF EXISTS insert_all ON notificaciones;
CREATE POLICY insert_all ON notificaciones FOR INSERT TO authenticated WITH CHECK (erp_es_activo());

CREATE OR REPLACE FUNCTION public.notificaciones_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'leida') IS DISTINCT FROM (to_jsonb(OLD) - 'leida') THEN
    RAISE EXCEPTION 'notificaciones: solo se puede marcar como leída' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notificaciones_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notificaciones_guard ON notificaciones;
CREATE TRIGGER trg_notificaciones_guard BEFORE UPDATE ON notificaciones FOR EACH ROW EXECUTE FUNCTION public.notificaciones_guard();

-- ═══ 4. Payloads de pago: solo Admin y Facturación ═══
DROP POLICY IF EXISTS payment_webhook_events_read_authenticated ON payment_webhook_events;
DROP POLICY IF EXISTS payment_webhook_events_read_fin ON payment_webhook_events;
CREATE POLICY payment_webhook_events_read_fin ON payment_webhook_events FOR SELECT TO authenticated
  USING (erp_rol_activo() IN ('Admin', 'Facturación'));
DROP POLICY IF EXISTS payment_intents_read_authenticated ON payment_intents;
DROP POLICY IF EXISTS payment_intents_read_fin ON payment_intents;
CREATE POLICY payment_intents_read_fin ON payment_intents FOR SELECT TO authenticated
  USING (erp_rol_activo() IN ('Admin', 'Facturación'));
-- invoice_attempts guarda request/response_payload del PAC: mismo principio.
-- Quedan admin_all y facturacion_all.
DROP POLICY IF EXISTS invoice_attempts_read_authenticated ON invoice_attempts;

-- ═══ 5. Historia canónica ═══
-- 5a. Rutas: una ruta con historia de inventario o cierre no se borra por API.
CREATE OR REPLACE FUNCTION public.b4_ruta_con_historia(p_ruta_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM rutas WHERE id = p_ruta_id AND (carga_confirmada_at IS NOT NULL OR estatus IN ('Cargada', 'En progreso', 'Cerrada')))
      OR EXISTS (SELECT 1 FROM stock_operaciones WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM inventario_mov WHERE ruta_id = p_ruta_id)
      OR EXISTS (SELECT 1 FROM mermas WHERE ruta_id = p_ruta_id)
$$;
REVOKE ALL ON FUNCTION public.b4_ruta_con_historia(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b4_ruta_con_historia(BIGINT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rutas_guard_borrado() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() AND b4_ruta_con_historia(OLD.id) THEN
    RAISE EXCEPTION 'rutas: la ruta % tiene historia de inventario o cierre; no se borra (cancélala o ciérrala)', OLD.folio USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.rutas_guard_borrado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rutas_guard_borrado ON rutas;
CREATE TRIGGER trg_rutas_guard_borrado BEFORE DELETE ON rutas FOR EACH ROW EXECUTE FUNCTION public.rutas_guard_borrado();

-- 5b. inventario_mov: append-only por API; el INSERT manual del Admin no
-- puede usar los espacios de nombres de los contratos.
CREATE OR REPLACE FUNCTION public.inventario_mov_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'inventario_mov: el kardex es historia; no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  IF NEW.ruta_id IS NOT NULL OR NEW.operacion_id IS NOT NULL
     OR COALESCE(NEW.referencia, '') ~ '^(carga_ruta/|devolucion_ruta/|no_entrega/|salida_manual/|traspaso/|produccion/|transformacion/|recepcion_compra/|salida_empaque/|MERMA-)'
     OR NEW.tipo IN ('Merma', 'Reverso merma', 'Devolución no entregada', 'Traspaso salida', 'Traspaso entrada') THEN
    RAISE EXCEPTION 'inventario_mov: movimiento reservado a los contratos del servidor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inventario_mov_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_inventario_mov_guard ON inventario_mov;
CREATE TRIGGER trg_inventario_mov_guard BEFORE INSERT OR UPDATE OR DELETE ON inventario_mov FOR EACH ROW EXECUTE FUNCTION public.inventario_mov_guard();

-- 5c. movimientos_contables: los asientos generados por contratos son
-- inmutables por API (Ingreso de Ventas/Cobranza ligado a orden,
-- MERMA-, PROD-, recepcion_compra/). Los asientos manuales del Admin
-- (gastos, costos, pagos a proveedor, devoluciones, nómina) siguen editables.
CREATE OR REPLACE FUNCTION public.b4_asiento_de_contrato(p_tipo TEXT, p_categoria TEXT, p_orden_id BIGINT, p_referencia TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(p_referencia, '') ~ '^(MERMA-|PROD-|recepcion_compra/)'
      OR (p_orden_id IS NOT NULL AND p_tipo = 'Ingreso' AND p_categoria IN ('Ventas', 'Cobranza'))
$$;
REVOKE ALL ON FUNCTION public.b4_asiento_de_contrato(TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b4_asiento_de_contrato(TEXT, TEXT, BIGINT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.movimientos_contables_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND b4_asiento_de_contrato(OLD.tipo, OLD.categoria, OLD.orden_id, OLD.referencia) THEN
    RAISE EXCEPTION 'movimientos_contables: el asiento % lo generó un contrato; no se edita ni se borra', OLD.id USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND b4_asiento_de_contrato(NEW.tipo, NEW.categoria, NEW.orden_id, NEW.referencia) THEN
    RAISE EXCEPTION 'movimientos_contables: ese tipo de asiento solo lo genera un contrato del servidor' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.movimientos_contables_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_movimientos_contables_guard ON movimientos_contables;
CREATE TRIGGER trg_movimientos_contables_guard BEFORE INSERT OR UPDATE OR DELETE ON movimientos_contables FOR EACH ROW EXECUTE FUNCTION public.movimientos_contables_guard();

-- 5d. costos_historial: append-only por API; el INSERT manual no puede
-- hacerse pasar por el costo de producción del contrato 076.
CREATE OR REPLACE FUNCTION public.costos_historial_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'costos_historial: el historial de costos no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(NEW.referencia, '') LIKE 'PROD-%' OR NEW.tipo = 'Producción' THEN
    RAISE EXCEPTION 'costos_historial: el costo de producción lo registra el contrato de producción' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.costos_historial_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_costos_historial_guard ON costos_historial;
CREATE TRIGGER trg_costos_historial_guard BEFORE INSERT OR UPDATE OR DELETE ON costos_historial FOR EACH ROW EXECUTE FUNCTION public.costos_historial_guard();

-- 5e. órdenes: por API solo se borran Creada/Cancelada sin CFDI (las
-- entregadas, en ruta o con historia fiscal se cancelan, no se destruyen;
-- pagos/CxC/asientos ligados ya lo impiden por FK).
CREATE OR REPLACE FUNCTION public.ordenes_guard_borrado() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() AND (OLD.estatus NOT IN ('Creada', 'Cancelada') OR OLD.facturama_uuid IS NOT NULL) THEN
    RAISE EXCEPTION 'ordenes: la orden % (%) no se borra; se cancela', OLD.folio, OLD.estatus USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_borrado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_borrado ON ordenes;
CREATE TRIGGER trg_ordenes_guard_borrado BEFORE DELETE ON ordenes FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_borrado();

-- ═══ 6. Contratos de CxC (sustituyen la escritura REST directa) ═══
-- Cancelación de una orden a crédito sin cobros: la CxC se anula (se borra,
-- como antes) y el saldo del cliente se revierte (inverso exacto de
-- crear_cxc_orden). Solo Admin.
CREATE OR REPLACE FUNCTION public.anular_cxc_orden(p_orden_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cxc cuentas_por_cobrar%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'anular_cxc_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  PERFORM 1 FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'anular_cxc_orden: orden no encontrada: %', p_orden_id USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('anulada', false, 'motivo', 'sin_cxc');
  END IF;
  IF COALESCE(v_cxc.monto_pagado, 0) > 0 OR EXISTS (SELECT 1 FROM pagos WHERE cxc_id = v_cxc.id OR orden_id = p_orden_id) THEN
    RAISE EXCEPTION 'anular_cxc_orden: la cuenta tiene cobros; no se anula' USING ERRCODE = '22023';
  END IF;
  DELETE FROM cuentas_por_cobrar WHERE id = v_cxc.id;
  IF v_cxc.cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo = COALESCE(saldo, 0) - COALESCE(v_cxc.saldo_pendiente, 0) WHERE id = v_cxc.cliente_id;
  END IF;
  RETURN jsonb_build_object('anulada', true, 'cxc_id', v_cxc.id, 'monto', v_cxc.saldo_pendiente);
END $$;
REVOKE ALL ON FUNCTION public.anular_cxc_orden(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_cxc_orden(BIGINT) TO authenticated, service_role;

-- Devolución de cliente sobre una orden a crédito: misma aritmética que el
-- frontend (monto_original − total, saldo = max(0, saldo − total), estatus)
-- y saldo del cliente − total, en UNA transacción. Solo Admin.
CREATE OR REPLACE FUNCTION public.ajustar_cxc_devolucion(p_orden_id BIGINT, p_monto NUMERIC) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cxc   cuentas_por_cobrar%ROWTYPE;
  v_total NUMERIC := round(COALESCE(p_monto, 0), 2);
  v_orig  NUMERIC;
  v_saldo NUMERIC;
  v_pag   NUMERIC;
  v_est   TEXT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'ajustar_cxc_devolucion: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'ajustar_cxc_devolucion: el monto debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  PERFORM fin_marcar_ctx();
  SELECT * INTO v_cxc FROM cuentas_por_cobrar WHERE orden_id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ajustada', false, 'motivo', 'sin_cxc');
  END IF;
  v_orig  := round(COALESCE(v_cxc.monto_original, 0) - v_total, 2);
  v_saldo := round(greatest(0, COALESCE(v_cxc.saldo_pendiente, 0) - v_total), 2);
  v_pag   := COALESCE(v_cxc.monto_pagado, 0);
  v_est   := CASE WHEN v_orig <= 0 THEN 'Pagada' WHEN v_pag >= v_orig THEN 'Pagada' WHEN v_pag > 0 THEN 'Parcial' ELSE 'Pendiente' END;
  UPDATE cuentas_por_cobrar SET monto_original = greatest(0, v_orig), saldo_pendiente = v_saldo, estatus = v_est WHERE id = v_cxc.id;
  IF v_cxc.cliente_id IS NOT NULL THEN
    UPDATE clientes SET saldo = COALESCE(saldo, 0) - v_total WHERE id = v_cxc.cliente_id;
  END IF;
  RETURN jsonb_build_object('ajustada', true, 'cxc_id', v_cxc.id, 'monto_original', greatest(0, v_orig), 'saldo_pendiente', v_saldo, 'estatus', v_est);
END $$;
REVOKE ALL ON FUNCTION public.ajustar_cxc_devolucion(BIGINT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_cxc_devolucion(BIGINT, NUMERIC) TO authenticated, service_role;

-- ═══ 7. Folios sin truncar y etiqueta forense ═══
CREATE OR REPLACE FUNCTION public.registrar_produccion(
  p_operacion_id UUID,
  p_turno        TEXT,
  p_maquina      TEXT,
  p_sku          TEXT,
  p_cantidad     INTEGER,
  p_cuarto_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_turno    TEXT := btrim(COALESCE(p_turno, ''));
  v_maquina  TEXT := btrim(COALESCE(p_maquina, ''));
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_actor    TEXT;
  v_uid      BIGINT;
  v_prod     RECORD;
  v_emp      RECORD;
  v_cf       RECORD;
  v_prev     produccion%ROWTYPE;
  v_id       BIGINT;
  v_folio    TEXT;
  v_empaque  TEXT;
  v_costo_u  NUMERIC := 0;
  v_total    NUMERIC := 0;
  v_mov      BIGINT;
  v_concepto TEXT;
  v_hoy      DATE := fin_hoy();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_produccion: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();
  v_uid   := erp_usuario_id();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_produccion: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_turno = '' OR v_maquina = '' THEN
    RAISE EXCEPTION 'registrar_produccion: turno y máquina son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_produccion: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;

  -- Replay (petición ya confirmada): mismo resultado, cero efectos nuevos.
  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  SELECT id, sku, tipo, empaque_sku INTO v_prod FROM productos WHERE sku = v_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_prod.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_produccion: % no es Producto Terminado', v_sku USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  -- Empaque: resuelto en el servidor; 1 unidad por unidad producida.
  v_empaque := NULLIF(btrim(COALESCE(v_prod.empaque_sku, '')), '');
  IF v_empaque IS NOT NULL THEN
    IF v_empaque = v_sku THEN
      RAISE EXCEPTION 'registrar_produccion: el empaque de % apunta al mismo SKU', v_sku USING ERRCODE = '22023';
    END IF;
    SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_produccion: empaque % no existe en el catálogo', v_empaque USING ERRCODE = '22023';
    END IF;
    v_costo_u := COALESCE(v_emp.costo_unitario, 0);
  END IF;

  v_folio := (SELECT 'OP-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id, empaque_sku, empaque_cantidad)
  VALUES (p_operacion_id, v_folio, v_turno, v_maquina, v_sku, p_cantidad, 'Confirmada', 'Produccion', v_cuarto,
          v_empaque, CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- Otra llamada concurrente con el mismo operacion_id confirmó primero.
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  -- Consumo de empaque por el contrato seguro de 071 (lock, sin negativos,
  -- kardex con el actor real). Si no alcanza, aborta TODO.
  IF v_empaque IS NOT NULL THEN
    PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
      'sku', v_empaque, 'delta', -p_cantidad, 'tipo', 'Salida', 'origen', 'Producción ' || v_folio)));
  END IF;

  -- Entrada del producto terminado al cuarto (contrato seguro de 071).
  -- 085: escritura directa del cuarto vía el primitivo interno (084), no el RPC
  -- genérico: misma cantidad, cuarto, tipo, origen y atribución (v_actor); el
  -- kardex gana cuarto_id y referencia estructurada.
  PERFORM stock_mov_cuarto(v_cuarto, v_sku, p_cantidad, 'Entrada',
    'Entrada a ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_folio,
    NULL, 'produccion/' || v_folio, v_actor, NULL, NULL);

  -- Costo (D6): cantidad × costo unitario del empaque, en el servidor.
  IF v_empaque IS NOT NULL AND v_costo_u > 0 THEN
    v_total := round(p_cantidad * v_costo_u, 2);
    v_concepto := 'Producción ' || v_folio || ': ' || p_cantidad || '× ' || v_sku || ' (empaque: ' || v_empaque || ')';
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
    VALUES (v_hoy, 'Egreso', 'Costo de Ventas', v_concepto, v_total, 'PROD-' || v_id, v_uid)
    RETURNING id INTO v_mov;
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas', v_concepto, v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, v_mov);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total, mov_contable_id = v_mov WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'sku', v_sku, 'cantidad', p_cantidad, 'cuarto_id', v_cuarto,
    'empaque_sku', v_empaque, 'empaque_cantidad', CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END,
    'costo_total', v_total, 'mov_contable_id', v_mov, 'actor', v_actor, 'replay', false);
END $$;
CREATE OR REPLACE FUNCTION public.registrar_transformacion(
  p_operacion_id    UUID,
  p_input_sku       TEXT,
  p_input_cantidad  INTEGER,
  p_output_sku      TEXT,
  p_output_cantidad INTEGER,
  p_cuarto_id       TEXT,
  p_notas           TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_in     TEXT := btrim(COALESCE(p_input_sku, ''));
  v_out    TEXT := btrim(COALESCE(p_output_sku, ''));
  v_cuarto TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_notas  TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_actor  TEXT;
  v_pin    RECORD;
  v_pout   RECORD;
  v_cf     RECORD;
  v_prev   produccion%ROWTYPE;
  v_id     BIGINT;
  v_folio  TEXT;
  v_merma  INTEGER;
  v_merma_id BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_transformacion: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_transformacion: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_input_cantidad IS NULL OR p_input_cantidad <= 0 OR p_output_cantidad IS NULL OR p_output_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_transformacion: las cantidades deben ser mayores a 0' USING ERRCODE = '22023';
  END IF;
  IF p_output_cantidad > p_input_cantidad THEN
    RAISE EXCEPTION 'registrar_transformacion: la salida no puede superar la entrada' USING ERRCODE = '22023';
  END IF;
  IF v_in = v_out THEN
    RAISE EXCEPTION 'registrar_transformacion: insumo y producto destino deben ser distintos' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN registrar_transformacion__replay(v_prev, v_in, p_input_cantidad, v_out, p_output_cantidad, v_cuarto);
  END IF;

  SELECT id, sku, tipo INTO v_pin FROM productos WHERE sku = v_in;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: insumo no encontrado: %', v_in USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pin.tipo, '') NOT IN ('Materia Prima', 'Insumo') THEN
    RAISE EXCEPTION 'registrar_transformacion: % no es un insumo', v_in USING ERRCODE = '22023';
  END IF;
  SELECT id, sku, tipo INTO v_pout FROM productos WHERE sku = v_out;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: producto destino no encontrado: %', v_out USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pout.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_transformacion: % no es Producto Terminado', v_out USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_transformacion: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_merma := p_input_cantidad - p_output_cantidad;
  v_folio := (SELECT 'TR-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo,
                          input_sku, input_kg, output_kg, merma_kg, rendimiento, destino, cuarto_id)
  VALUES (p_operacion_id, v_folio, 'Transformación', 'Manual', v_out, p_output_cantidad, 'Confirmada', 'Transformacion',
          v_in, p_input_cantidad, p_output_cantidad, v_merma, round(p_output_cantidad::numeric / p_input_cantidad * 100, 2),
          v_notas, v_cuarto)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    RETURN registrar_transformacion__replay(v_prev, v_in, p_input_cantidad, v_out, p_output_cantidad, v_cuarto);
  END IF;

  -- Insumo (productos.stock) → contrato seguro de 071; si no alcanza, aborta todo.
  PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
    'sku', v_in, 'delta', -p_input_cantidad, 'tipo', 'Salida', 'origen', 'Transformación ' || v_folio || ' → ' || v_out)));
  -- Output al cuarto frío → contrato seguro de 071.
  -- 085: primitivo interno (084) en lugar del RPC genérico; mismas cantidades.
  PERFORM stock_mov_cuarto(v_cuarto, v_out, p_output_cantidad, 'Entrada',
    'Transformación ' || v_folio || ' de ' || v_in || ' → ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto),
    NULL, 'transformacion/' || v_folio, v_actor, NULL, NULL);
  -- Merma de proceso (072): sin efecto de stock propio; mismas invariantes.
  IF v_merma > 0 THEN
    v_merma_id := (registrar_merma(v_in, v_merma, 'Merma de proceso — transformación', 'Transformación ' || v_folio,
                                   NULL, NULL, false) ->> 'id')::BIGINT;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'input_sku', v_in, 'input_cantidad', p_input_cantidad,
    'output_sku', v_out, 'output_cantidad', p_output_cantidad, 'cuarto_id', v_cuarto,
    'merma', v_merma, 'merma_id', v_merma_id, 'actor', v_actor, 'replay', false);
END $$;
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

CREATE OR REPLACE FUNCTION erp_actor_etiqueta() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    erp_actor_nombre(),
    CASE WHEN fin_jwt_role() IS NULL THEN 'sql'
         WHEN fin_jwt_role() = 'service_role' THEN 'service_role'
         ELSE 'jwt-sin-perfil' END)
$$;

-- ═══ 8. Funciones muertas ═══
DROP FUNCTION IF EXISTS public.registrar_pago(BIGINT, NUMERIC, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.move_stock(CHARACTER VARYING, INTEGER, TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.confirmar_produccion(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.timbrar_orden(CHARACTER VARYING, BIGINT);
DROP FUNCTION IF EXISTS public.check_orden_transition();
DROP FUNCTION IF EXISTS public.check_produccion_transition();
DROP FUNCTION IF EXISTS public.check_stock_positive();
DROP FUNCTION IF EXISTS public.prevent_mutation();
DROP POLICY IF EXISTS admin_all ON stock_operaciones;

-- ═══ 9. EXECUTE y search_path ═══
DO $$
DECLARE f RECORD;
BEGIN
  -- Funciones de disparador de la aplicación: sin EXECUTE de API.
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
              AND p.proname <> 'rls_auto_enable' LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
  -- Helpers invocadores de solo lectura: sin PUBLIC/anon; search_path fijo.
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fin_ctx_activo', 'fin_es_credito', 'fin_hoy', 'fin_jwt_role') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fin_marcar_ctx', 'update_updated_at', 'set_updated_at_payment_intents') LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
  -- Ninguna función de la aplicación queda con EXECUTE para anon/PUBLIC.
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'rls_auto_enable'
              AND (has_function_privilege('anon', p.oid, 'EXECUTE')) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

-- ═══ 10. Grants de tablas y secuencias ═══
DO $$
DECLARE
  r RECORD;
  v_dml TEXT[];
  -- DML directo que usa el frontend (mapa de llamadores 090); el resto de
  -- escrituras va por contratos SECURITY DEFINER o por service_role.
  v_mapa JSONB := '{
    "auditoria": ["INSERT"], "camiones": ["INSERT","UPDATE"], "chofer_ubicaciones": ["INSERT"], "cierres_diarios": ["INSERT"],
    "clientes": ["INSERT","UPDATE","DELETE"], "comodatos": ["INSERT","UPDATE","DELETE"], "configuracion_empresa": ["UPDATE"],
    "costos_fijos": ["INSERT","UPDATE","DELETE"], "costos_historial": ["INSERT"], "cuartos_frios": ["INSERT","UPDATE","DELETE"],
    "cuentas_por_cobrar": ["UPDATE","DELETE"],
    "cuentas_por_pagar": ["INSERT","UPDATE","DELETE"], "devoluciones": ["INSERT","DELETE"], "empleados": ["INSERT","UPDATE","DELETE"],
    "error_log": ["INSERT"], "inventario_mov": ["INSERT"], "leads": ["INSERT","UPDATE","DELETE"],
    "movimientos_contables": ["INSERT","UPDATE","DELETE"], "nomina_periodos": ["INSERT","UPDATE"], "nomina_recibos": ["INSERT"],
    "notificaciones": ["INSERT","UPDATE"], "ordenes": ["UPDATE","DELETE"], "pagos_proveedores": ["INSERT"],
    "precios_esp": ["INSERT","UPDATE","DELETE"], "produccion": ["UPDATE","DELETE"], "productos": ["INSERT","UPDATE","DELETE"],
    "rutas": ["INSERT","UPDATE","DELETE"], "usuarios": ["INSERT","UPDATE","DELETE"]
  }'::jsonb;
  v_seq TEXT;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel, c.relname, c.relkind FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm') LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon', r.rel);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, INSERT, UPDATE, DELETE ON %s FROM authenticated', r.rel);
    SELECT array_agg(x) INTO v_dml FROM jsonb_array_elements_text(v_mapa -> r.relname) x;
    IF v_dml IS NOT NULL AND r.relkind IN ('r', 'p') THEN
      EXECUTE format('GRANT %s ON %s TO authenticated', array_to_string(v_dml, ', '), r.rel);
    END IF;
  END LOOP;
  -- Tablas sin lectura para la API.
  REVOKE SELECT ON push_subscriptions FROM authenticated;

  FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', r.rel);
  END LOOP;
  -- USAGE solo en la secuencia del id de las tablas donde el frontend inserta.
  FOR r IN SELECT key AS t FROM jsonb_each(v_mapa) WHERE value ? 'INSERT' LOOP
    SELECT pg_get_serial_sequence('public.' || quote_ident(r.t), 'id') INTO v_seq;
    IF v_seq IS NOT NULL THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', v_seq);
    END IF;
  END LOOP;
END $$;

-- ═══ 11. Privilegios por defecto (objetos nuevos de postgres en public) ═══
-- Solo el rol dueño de los objetos de la aplicación (postgres en Supabase).
-- Los defaults de supabase_admin y de los esquemas de la plataforma no se tocan.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
    -- El EXECUTE implícito de PUBLIC en funciones es un default global de
    -- PostgreSQL: solo se retira con la forma global (sin IN SCHEMA).
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  END IF;
END $$;
