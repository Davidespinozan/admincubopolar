-- 069_rls_financiera_rollback.sql — reversión de PERMISOS de 069.
--
-- Restaura exactamente el catálogo de políticas/grants/EXECUTE que tenía
-- producción antes de 069 (capturado read-only el 2026-09-26) y quita el
-- trigger guard. NO borra las funciones nuevas (crear_cxc_orden,
-- abonar_cxc, registrar_pago_orden, cerrar_ruta_financiero): son
-- inertes si el frontend vuelve al deploy anterior, y así el código
-- nuevo puede republicarse sin re-aplicar 069 completa.
--
-- ¡ADVERTENCIA! Reabre P0-3 (cualquier authenticated puede escribir CxC).
-- Solo usar si un flujo legítimo quedó bloqueado y no hay hotfix rápido.
-- Sin cambios de datos.

DROP TRIGGER IF EXISTS trg_ordenes_guard_financiero ON ordenes;

-- cuentas_por_cobrar
DROP POLICY IF EXISTS "read_all" ON cuentas_por_cobrar;
CREATE POLICY "read_all"     ON cuentas_por_cobrar FOR SELECT TO authenticated USING (true);
CREATE POLICY "cxc_read_all" ON cuentas_por_cobrar FOR SELECT TO authenticated USING (true);
CREATE POLICY "cxc_write"    ON cuentas_por_cobrar FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_insert"  ON cuentas_por_cobrar FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "write_roles"  ON cuentas_por_cobrar FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Facturación', 'Chofer'));
CREATE POLICY "update_roles" ON cuentas_por_cobrar FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Ventas', 'Facturación', 'Chofer'));
CREATE POLICY "rollback_delete" ON cuentas_por_cobrar FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

-- pagos
CREATE POLICY "auth_insert"  ON pagos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "insert_roles" ON pagos FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Chofer', 'Facturación'));
CREATE POLICY "rollback_delete" ON pagos FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

-- movimientos_contables
DROP POLICY IF EXISTS "egreso_operativo_insert" ON movimientos_contables;
CREATE POLICY "auth_insert" ON movimientos_contables FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "rollback_delete" ON movimientos_contables FOR DELETE TO authenticated
  USING (get_my_rol() IN ('Chofer', 'Admin'));

-- clientes
CREATE POLICY "chofer_update_saldo" ON clientes FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Chofer');

-- grants anon (estado previo: todos los privilegios, aunque sin policies anon)
GRANT ALL ON TABLE pagos, cuentas_por_cobrar, movimientos_contables TO anon;

-- EXECUTE previo (todo el mundo)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('timbrar_orden', 'registrar_pago', 'move_stock', 'check_orden_transition',
                         'increment_saldo', 'asignar_orden', 'cancelar_orden_asignada',
                         'asignar_ordenes_a_ruta', 'cerrar_ruta_atomic', 'update_orden_atomic',
                         'update_stocks_atomic', 'update_productos_stock_atomic',
                         'confirmar_produccion', 'rename_sku', 'nextval')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.fn);
  END LOOP;
END $$;

-- increment_saldo sin verificación (versión 034)
CREATE OR REPLACE FUNCTION increment_saldo(p_cli BIGINT, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE clientes SET saldo = COALESCE(saldo, 0) + p_delta WHERE id = p_cli;
END $$;
