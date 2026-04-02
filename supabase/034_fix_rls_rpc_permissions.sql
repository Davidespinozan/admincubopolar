-- 034: Corregir permisos RLS y RPC para que todos los roles funcionen
-- Sin esto, Chofer, Producción y Ventas están bloqueados en operaciones críticas

-- ═══════════════════════════════════════════════════════════
-- 1. RPCs con SECURITY DEFINER (bypasan RLS para operaciones atómicas)
-- ═══════════════════════════════════════════════════════════

-- increment_saldo: usado por Chofer al entregar y cerrar ruta
CREATE OR REPLACE FUNCTION increment_saldo(p_cli BIGINT, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE clientes SET saldo = COALESCE(saldo, 0) + p_delta WHERE id = p_cli;
END;
$$;
GRANT EXECUTE ON FUNCTION increment_saldo TO authenticated;

-- move_stock: usado por Producción al confirmar
CREATE OR REPLACE FUNCTION move_stock(
  p_sku VARCHAR(20), p_cantidad INTEGER,
  p_tipo TEXT, p_origen TEXT, p_usuario_id BIGINT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE productos SET stock = GREATEST(0, stock + p_cantidad) WHERE sku = p_sku;
  INSERT INTO inventario_mov (producto, cantidad, tipo, origen, usuario)
    VALUES (p_sku, ABS(p_cantidad), p_tipo, p_origen, COALESCE(p_usuario_id::TEXT, 'sistema'));
END;
$$;
GRANT EXECUTE ON FUNCTION move_stock TO authenticated;

-- confirmar_produccion: usado por Producción
CREATE OR REPLACE FUNCTION confirmar_produccion(p_produccion_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sku TEXT;
  v_cantidad INTEGER;
BEGIN
  SELECT sku, cantidad INTO v_sku, v_cantidad
  FROM produccion WHERE id = p_produccion_id AND estatus = 'Pendiente';

  IF v_sku IS NULL THEN
    RAISE EXCEPTION 'Producción no encontrada o ya confirmada';
  END IF;

  UPDATE produccion SET estatus = 'Confirmada' WHERE id = p_produccion_id;
  UPDATE productos SET stock = stock + v_cantidad WHERE sku = v_sku;

  INSERT INTO inventario_mov (producto, cantidad, tipo, origen, usuario)
    VALUES (v_sku, v_cantidad, 'Entrada', 'Producción #' || p_produccion_id, p_usuario_id::TEXT);

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Confirmar', 'Producción', v_sku || ' x' || v_cantidad);
END;
$$;
GRANT EXECUTE ON FUNCTION confirmar_produccion TO authenticated;

-- asignar_orden: usado por Admin/Almacén
CREATE OR REPLACE FUNCTION asignar_orden(p_orden_id BIGINT, p_ruta_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ordenes SET estatus = 'Asignada', ruta_id = p_ruta_id WHERE id = p_orden_id;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Asignar', 'Órdenes', 'Orden #' || p_orden_id || ' → Ruta #' || COALESCE(p_ruta_id::TEXT, 'sin ruta'));
END;
$$;
GRANT EXECUTE ON FUNCTION asignar_orden TO authenticated;

-- cancelar_orden_asignada
CREATE OR REPLACE FUNCTION cancelar_orden_asignada(p_orden_id BIGINT, p_usuario_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ordenes SET estatus = 'Creada', ruta_id = NULL WHERE id = p_orden_id AND estatus = 'Asignada';

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (p_usuario_id::TEXT, 'Cancelar asignación', 'Órdenes', 'Orden #' || p_orden_id);
END;
$$;
GRANT EXECUTE ON FUNCTION cancelar_orden_asignada TO authenticated;

-- registrar_pago: usado por Ventas/Chofer/Facturación
CREATE OR REPLACE FUNCTION registrar_pago(
  p_cliente_id BIGINT, p_monto NUMERIC, p_metodo TEXT,
  p_referencia TEXT, p_usuario_id BIGINT
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_saldo_antes NUMERIC;
  v_pago_id BIGINT;
BEGIN
  SELECT COALESCE(saldo, 0) INTO v_saldo_antes FROM clientes WHERE id = p_cliente_id;

  INSERT INTO pagos (cliente_id, monto, metodo_pago, referencia, usuario_id, saldo_antes, saldo_despues)
    VALUES (p_cliente_id, p_monto, p_metodo, p_referencia, p_usuario_id, v_saldo_antes, v_saldo_antes - p_monto)
    RETURNING id INTO v_pago_id;

  UPDATE clientes SET saldo = GREATEST(0, COALESCE(saldo, 0) - p_monto) WHERE id = p_cliente_id;

  RETURN v_pago_id;
END;
$$;
GRANT EXECUTE ON FUNCTION registrar_pago TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2. Políticas faltantes en tablas
-- ═══════════════════════════════════════════════════════════

-- PRODUCTOS: Producción y Almacén necesitan UPDATE (para transformaciones y ajustes)
CREATE POLICY "produccion_update" ON productos FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Producción', 'Almacén'));

-- CLIENTES: Chofer necesita UPDATE (para saldo vía increment_saldo — ahora es SECURITY DEFINER,
-- pero por si se llama directo en algún flujo futuro)
CREATE POLICY "chofer_update_saldo" ON clientes FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Chofer');

-- ═══════════════════════════════════════════════════════════
-- 3. Políticas DELETE para rollback en cerrarRutaCompleta
-- Sin estas, si el cierre falla a mitad, el rollback manual también falla
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "rollback_delete" ON mermas FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

CREATE POLICY "rollback_delete" ON pagos FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

CREATE POLICY "rollback_delete" ON cuentas_por_cobrar FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

CREATE POLICY "rollback_delete" ON movimientos_contables FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

-- Ordenes: Chofer puede necesitar revertir estatus en rollback
CREATE POLICY "rollback_delete" ON ordenes FOR DELETE TO authenticated
  USING (get_my_rol() = 'Admin');

-- ═══════════════════════════════════════════════════════════
-- 4. Tablas que faltan en 031 (podrían no existir en todos los envs)
-- ═══════════════════════════════════════════════════════════

-- leads, comodatos, cuarto_frio_stock — si existen, proteger
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads' AND table_schema = 'public') THEN
    ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY "admin_all" ON leads FOR ALL TO authenticated USING (get_my_rol() = ''Admin'') WITH CHECK (get_my_rol() = ''Admin'')';
    EXECUTE 'CREATE POLICY "ventas_all" ON leads FOR ALL TO authenticated USING (get_my_rol() = ''Ventas'') WITH CHECK (get_my_rol() = ''Ventas'')';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comodatos' AND table_schema = 'public') THEN
    ALTER TABLE comodatos ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY "admin_all" ON comodatos FOR ALL TO authenticated USING (get_my_rol() = ''Admin'') WITH CHECK (get_my_rol() = ''Admin'')';
    EXECUTE 'CREATE POLICY "read_all" ON comodatos FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
