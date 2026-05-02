-- 046_rls_chofer_ubicaciones.sql
-- Restringe lectura de GPS de choferes: Admin ve todo, Chofer solo
-- ve sus propias ubicaciones.
-- La policy original (en 032) era read_all USING (true), lo que permitía
-- a cualquier authenticated (Bolsas, Ventas, Producción) consultar el
-- track histórico GPS de cualquier chofer → riesgo de privacidad.
-- La columna real de la tabla es chofer_id (no usuario_id).

DROP POLICY IF EXISTS "read_all" ON chofer_ubicaciones;
DROP POLICY IF EXISTS "admin_or_self_read" ON chofer_ubicaciones;

CREATE POLICY "admin_or_self_read" ON chofer_ubicaciones FOR SELECT TO authenticated
  USING (
    get_my_rol() = 'Admin'
    OR chofer_id = get_my_user_id()
  );
