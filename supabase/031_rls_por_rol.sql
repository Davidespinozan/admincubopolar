-- 031: Row Level Security por rol
-- Protege datos a nivel fila según el rol del usuario autenticado

-- Helper: obtener rol del usuario actual
-- Busca por email del JWT de Supabase Auth (la tabla usuarios no tiene auth_id)
CREATE OR REPLACE FUNCTION get_my_rol()
RETURNS TEXT AS $$
  SELECT rol::TEXT FROM usuarios
  WHERE lower(email) = lower(auth.jwt() ->> 'email')
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: obtener id del usuario actual
CREATE OR REPLACE FUNCTION get_my_user_id()
RETURNS BIGINT AS $$
  SELECT id FROM usuarios
  WHERE lower(email) = lower(auth.jwt() ->> 'email')
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_my_rol TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_user_id TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- Eliminar políticas viejas (permiso total)
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "anon_all" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', tbl, tbl);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- ADMIN: acceso total a todas las tablas
-- Se aplica como política base en cada tabla
-- ═══════════════════════════════════════════════════════════

-- Macro: para cada tabla, Admin tiene acceso completo
-- Las demás políticas son aditivas (OR) gracias a PERMISSIVE

-- ═══════════════════════════════════════════════════════════
-- USUARIOS
-- ═══════════════════════════════════════════════════════════
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON usuarios FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "self_read" ON usuarios FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));

-- ═══════════════════════════════════════════════════════════
-- CLIENTES — Admin/Ventas/Facturación escriben, todos leen
-- ═══════════════════════════════════════════════════════════
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON clientes FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON clientes FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "ventas_write" ON clientes FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Facturación'));
CREATE POLICY "ventas_update" ON clientes FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Ventas', 'Facturación'));

-- ═══════════════════════════════════════════════════════════
-- PRODUCTOS — Admin escribe, todos leen
-- ═══════════════════════════════════════════════════════════
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON productos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON productos FOR SELECT TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════
-- PRECIOS_ESP — Admin/Ventas escriben, todos leen
-- ═══════════════════════════════════════════════════════════
ALTER TABLE precios_esp ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON precios_esp FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON precios_esp FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "ventas_write" ON precios_esp FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Ventas');

-- ═══════════════════════════════════════════════════════════
-- ORDENES — Admin/Ventas crean, Chofer solo lee sus rutas
-- ═══════════════════════════════════════════════════════════
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON ordenes FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON ordenes FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "ventas_insert" ON ordenes FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Chofer'));
CREATE POLICY "ventas_update" ON ordenes FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Ventas', 'Chofer', 'Facturación', 'Almacén'));

-- ═══════════════════════════════════════════════════════════
-- ORDEN_LINEAS
-- ═══════════════════════════════════════════════════════════
ALTER TABLE orden_lineas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON orden_lineas FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON orden_lineas FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "write_roles" ON orden_lineas FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Chofer'));

-- ═══════════════════════════════════════════════════════════
-- RUTAS — Admin/Almacén escriben, Chofer solo sus rutas
-- ═══════════════════════════════════════════════════════════
ALTER TABLE rutas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON rutas FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON rutas FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "almacen_write" ON rutas FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Almacén');
CREATE POLICY "almacen_update" ON rutas FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Almacén');
CREATE POLICY "chofer_update_own" ON rutas FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Chofer' AND chofer_id = get_my_user_id());

-- ═══════════════════════════════════════════════════════════
-- PRODUCCION — Admin/Producción escriben
-- ═══════════════════════════════════════════════════════════
ALTER TABLE produccion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON produccion FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON produccion FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "produccion_write" ON produccion FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Producción');
CREATE POLICY "produccion_update" ON produccion FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Producción');

-- ═══════════════════════════════════════════════════════════
-- INVENTARIO_MOV — Append-only, múltiples roles insertan
-- ═══════════════════════════════════════════════════════════
ALTER TABLE inventario_mov ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON inventario_mov FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON inventario_mov FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_roles" ON inventario_mov FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Producción', 'Almacén', 'Chofer', 'Ventas'));

-- ═══════════════════════════════════════════════════════════
-- PAGOS — Append-only
-- ═══════════════════════════════════════════════════════════
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON pagos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON pagos FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_roles" ON pagos FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Chofer', 'Facturación'));

-- ═══════════════════════════════════════════════════════════
-- CUARTOS_FRIOS — Admin/Producción/Almacén escriben
-- ═══════════════════════════════════════════════════════════
ALTER TABLE cuartos_frios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON cuartos_frios FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON cuartos_frios FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "write_roles" ON cuartos_frios FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Producción', 'Almacén'));
CREATE POLICY "update_roles" ON cuartos_frios FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Producción', 'Almacén', 'Chofer'));

-- ═══════════════════════════════════════════════════════════
-- AUDITORIA — Append-only, todos insertan, solo Admin lee
-- ═══════════════════════════════════════════════════════════
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read" ON auditoria FOR SELECT TO authenticated
  USING (get_my_rol() = 'Admin');
CREATE POLICY "insert_all" ON auditoria FOR INSERT TO authenticated
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- UMBRALES — Admin escribe, lectura general
-- ═══════════════════════════════════════════════════════════
ALTER TABLE umbrales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON umbrales FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON umbrales FOR SELECT TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════
-- EMPLEADOS / NÓMINA — Solo Admin
-- ═══════════════════════════════════════════════════════════
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON empleados FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

ALTER TABLE nomina_periodos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON nomina_periodos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

ALTER TABLE nomina_recibos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON nomina_recibos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

-- ═══════════════════════════════════════════════════════════
-- CONTABILIDAD — Solo Admin + Facturación
-- ═══════════════════════════════════════════════════════════
ALTER TABLE movimientos_contables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON movimientos_contables FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "facturacion_read" ON movimientos_contables FOR SELECT TO authenticated
  USING (get_my_rol() = 'Facturación');
CREATE POLICY "facturacion_insert" ON movimientos_contables FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Facturación', 'Chofer', 'Ventas'));

-- ═══════════════════════════════════════════════════════════
-- CUENTAS POR COBRAR — Admin/Ventas/Facturación/Chofer
-- ═══════════════════════════════════════════════════════════
ALTER TABLE cuentas_por_cobrar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON cuentas_por_cobrar FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON cuentas_por_cobrar FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "write_roles" ON cuentas_por_cobrar FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Ventas', 'Facturación', 'Chofer'));
CREATE POLICY "update_roles" ON cuentas_por_cobrar FOR UPDATE TO authenticated
  USING (get_my_rol() IN ('Ventas', 'Facturación', 'Chofer'));

-- ═══════════════════════════════════════════════════════════
-- COSTOS — Solo Admin
-- ═══════════════════════════════════════════════════════════
ALTER TABLE costos_fijos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON costos_fijos FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_produccion" ON costos_fijos FOR SELECT TO authenticated
  USING (get_my_rol() = 'Producción');

ALTER TABLE costos_historial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON costos_historial FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_produccion" ON costos_historial FOR SELECT TO authenticated
  USING (get_my_rol() = 'Producción');

-- ═══════════════════════════════════════════════════════════
-- CUENTAS POR PAGAR / PROVEEDORES — Solo Admin
-- ═══════════════════════════════════════════════════════════
ALTER TABLE cuentas_por_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON cuentas_por_pagar FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

ALTER TABLE pagos_proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON pagos_proveedores FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

-- ═══════════════════════════════════════════════════════════
-- MERMAS — Admin/Chofer/Producción/Almacén
-- ═══════════════════════════════════════════════════════════
ALTER TABLE mermas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON mermas FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON mermas FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_roles" ON mermas FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Chofer', 'Producción', 'Almacén'));

-- ═══════════════════════════════════════════════════════════
-- CAMIONES — Admin escribe, Chofer/Almacén leen
-- ═══════════════════════════════════════════════════════════
ALTER TABLE camiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON camiones FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON camiones FOR SELECT TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICACIONES — Todos leen, sistema inserta
-- ═══════════════════════════════════════════════════════════
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON notificaciones FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_all" ON notificaciones FOR INSERT TO authenticated
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- INVOICE_ATTEMPTS — Admin/Facturación
-- ═══════════════════════════════════════════════════════════
ALTER TABLE invoice_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON invoice_attempts FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "facturacion_all" ON invoice_attempts FOR ALL TO authenticated
  USING (get_my_rol() = 'Facturación') WITH CHECK (get_my_rol() = 'Facturación');
