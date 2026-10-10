-- 124_multisucursal_cambio_cliente.sql — MULTISUCURSAL, corrección (2026-10-09).
-- Solo redefine update_orden_atomic (misma firma, mismo ACL). Aditiva e idempotente.
--
-- Defecto de 123 (detectado por la suite 123-05d, no por producción): al editar una
-- orden cambiando `cliente_id`, el primer UPDATE escribía el cliente nuevo con la
-- sucursal del cliente anterior y la guarda `ordenes_guard_sucursal` lo rechazaba
-- ("la sucursal X no pertenece al cliente Y"). El frontend desplegado no cambia el
-- cliente al editar (EditarVentaModal lo tiene bloqueado), así que en producción
-- ninguna orden quedó afectada; 123 sigue aplicada tal cual.
--
-- Arreglo: la sucursal destino se resuelve ANTES del UPDATE (la pedida, o la
-- principal del cliente nuevo) y se escribe en la misma sentencia que `cliente_id`.
-- Si la sucursal cambió y no vino dirección propia, se copia la de la sucursal nueva
-- (igual que 123). Lo demás no cambia.
--
-- Reversión: volver a la definición de 123 (reabre el rechazo al cambiar de cliente).

CREATE OR REPLACE FUNCTION public.update_orden_atomic(p_orden_id BIGINT, p_update_fields JSONB, p_lineas JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estatus TEXT;
  v_cli     BIGINT;
  v_suc     BIGINT;
  v_suc_old BIGINT;
  v_suc_row sucursales%ROWTYPE;
  v_items   JSONB;
  v_lin     JSONB;
  v_n       INTEGER := 0;
  v_toca_suc   BOOLEAN := false;
  v_cambia_suc BOOLEAN := false;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'update_orden_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT estatus, cliente_id, sucursal_id INTO v_estatus, v_cli, v_suc_old FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_estatus <> 'Creada' THEN
    RAISE EXCEPTION 'Solo se pueden editar órdenes en estatus Creada (actual: %)', v_estatus;
  END IF;

  -- Campos no financieros. total y productos del cliente se ignoran (088):
  -- los deriva el servidor de las líneas.
  IF p_update_fields IS NOT NULL AND jsonb_typeof(p_update_fields) = 'object' THEN
    IF NULLIF(p_update_fields ->> 'cliente_id', '') IS NOT NULL THEN
      PERFORM 1 FROM clientes WHERE id = (p_update_fields ->> 'cliente_id')::BIGINT FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'update_orden_atomic: cliente no encontrado' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM clientes WHERE id = (p_update_fields ->> 'cliente_id')::BIGINT AND fusionado_en IS NOT NULL) THEN
        RAISE EXCEPTION 'update_orden_atomic: el cliente fue fusionado como sucursal de otro; usa el cliente destino' USING ERRCODE = '22023';
      END IF;
      v_cli := (p_update_fields ->> 'cliente_id')::BIGINT;
    END IF;

    -- Sucursal (124): se resuelve ANTES del UPDATE y se escribe junto con cliente_id.
    -- La pedida, o la principal del cliente (nuevo) si no se pidió otra.
    v_toca_suc := (p_update_fields ? 'sucursal_id') OR (p_update_fields ? 'cliente_id');
    IF v_toca_suc THEN
      v_suc := sucursal_para_orden(v_cli,
                 CASE WHEN p_update_fields ? 'sucursal_id' THEN NULLIF(p_update_fields ->> 'sucursal_id', '')::BIGINT ELSE NULL END,
                 'update_orden_atomic');
      v_cambia_suc := v_suc IS DISTINCT FROM v_suc_old;
    ELSE
      v_suc := v_suc_old;
    END IF;

    UPDATE ordenes SET
      cliente_nombre     = COALESCE(p_update_fields ->> 'cliente_nombre', cliente_nombre),
      cliente_id         = v_cli,
      sucursal_id        = v_suc,
      fecha              = COALESCE((p_update_fields ->> 'fecha')::DATE, fecha),
      tipo_cobro         = COALESCE(p_update_fields ->> 'tipo_cobro', tipo_cobro),
      folio_nota         = CASE WHEN p_update_fields ? 'folio_nota' THEN p_update_fields ->> 'folio_nota' ELSE folio_nota END,
      direccion_entrega  = CASE WHEN p_update_fields ? 'direccion_entrega' THEN p_update_fields ->> 'direccion_entrega' ELSE direccion_entrega END,
      referencia_entrega = CASE WHEN p_update_fields ? 'referencia_entrega' THEN p_update_fields ->> 'referencia_entrega' ELSE referencia_entrega END,
      latitud_entrega    = CASE WHEN p_update_fields ? 'latitud_entrega' THEN NULLIF(p_update_fields ->> 'latitud_entrega', '')::NUMERIC ELSE latitud_entrega END,
      longitud_entrega   = CASE WHEN p_update_fields ? 'longitud_entrega' THEN NULLIF(p_update_fields ->> 'longitud_entrega', '')::NUMERIC ELSE longitud_entrega END,
      updated_at         = NOW()
    WHERE id = p_orden_id;

    -- Cambió la sucursal y no vino dirección propia: se copia la de la sucursal nueva (123).
    IF v_cambia_suc AND v_suc IS NOT NULL AND NOT (p_update_fields ? 'direccion_entrega') THEN
      SELECT * INTO v_suc_row FROM sucursales WHERE id = v_suc;
      UPDATE ordenes SET
        direccion_entrega = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN sucursal_direccion_texto(v_suc_row) ELSE NULL END,
        latitud_entrega   = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN v_suc_row.latitud ELSE NULL END,
        longitud_entrega  = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN v_suc_row.longitud ELSE NULL END
      WHERE id = p_orden_id;
    END IF;
  END IF;

  SELECT cliente_id, sucursal_id INTO v_cli, v_suc FROM ordenes WHERE id = p_orden_id;
  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('sku', e ->> 'sku', 'cantidad', e -> 'cantidad')) INTO v_items FROM jsonb_array_elements(p_lineas) e;
    IF v_items IS NULL THEN v_items := '[]'::jsonb; END IF;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('sku', sku, 'cantidad', cantidad) ORDER BY id) INTO v_items FROM orden_lineas WHERE orden_id = p_orden_id;
  END IF;

  IF v_items IS NOT NULL THEN
    v_lin := lineas_canonicas(v_cli, v_suc, v_items);
    DELETE FROM orden_lineas WHERE orden_id = p_orden_id;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
    SELECT p_orden_id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
      FROM jsonb_array_elements(v_lin -> 'lineas') l;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE ordenes SET total = (v_lin ->> 'total')::NUMERIC, productos = v_lin ->> 'productos', updated_at = NOW() WHERE id = p_orden_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'orden_id', p_orden_id, 'sucursal_id', v_suc, 'lineas_insertadas', v_n, 'total', (v_lin ->> 'total')::NUMERIC);
END $$;
