-- 045_rls_configuracion_empresa.sql
-- Restringe escritura de configuracion_empresa a rol Admin.
-- La policy original (en 044) usaba auth.role() = 'authenticated', lo que
-- permitía a CUALQUIER usuario autenticado (incluido Chofer/Bolsas) cambiar
-- razón social, RFC y dirección fiscal vía API directa.
-- Lectura sigue abierta a todos los authenticated (la app la usa para
-- mostrar datos en facturas, tickets y headers).

DROP POLICY IF EXISTS "Admin lee/escribe config empresa" ON configuracion_empresa;
DROP POLICY IF EXISTS "admin_all" ON configuracion_empresa;
DROP POLICY IF EXISTS "read_all" ON configuracion_empresa;

CREATE POLICY "admin_all" ON configuracion_empresa FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin')
  WITH CHECK (get_my_rol() = 'Admin');

CREATE POLICY "read_all" ON configuracion_empresa FOR SELECT TO authenticated
  USING (true);
