-- 121_ger1_contencion_usuarios.sql — GER-1, contención (2026-10-09). Se aplica
-- DESPUÉS de que el frontend que usa guardar_usuario (120) esté publicado.
--
-- Hasta 120, Admin escribía `usuarios` por REST (policy admin_all, GRANT
-- INSERT/UPDATE/DELETE a authenticated): podía darse otro rol, crear un Admin o
-- desactivar al dueño. Desde aquí:
--   · alta: Netlify `admin-create-user` (service role) + fijar_password_temporal;
--   · cambios de nombre, rol, estatus y accesos: guardar_usuario (120);
--   · baja: estatus Inactivo (no se borran usuarios: la historia los nombra).
-- La lectura sigue: self_read (cada quien la suya) y admin_read (120).
--
-- Reversión (reabre la escritura REST de Admin): CREATE POLICY admin_all ON
-- usuarios FOR ALL TO authenticated USING (get_my_rol() = 'Admin') WITH CHECK
-- (get_my_rol() = 'Admin'); GRANT INSERT, UPDATE, DELETE ON usuarios TO authenticated.

BEGIN;
DROP POLICY IF EXISTS admin_all ON public.usuarios;
REVOKE INSERT, UPDATE, DELETE ON public.usuarios FROM authenticated;
REVOKE ALL ON SEQUENCE public.usuarios_id_seq FROM authenticated;
COMMIT;
