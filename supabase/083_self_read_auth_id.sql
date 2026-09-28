-- 083_self_read_auth_id.sql — B3 / R5: el email deja de ser clave de
-- identidad en la base de datos.
--
-- usuarios.self_read (031) autorizaba la lectura del propio perfil con
--   lower(email) = lower(auth.jwt() ->> 'email')
-- es decir, por el email del JWT: era la última policy que usaba el email
-- como identidad (079 ya canonicalizó get_my_rol/get_my_user_id). Quien
-- lograra un JWT con el email de otro perfil leía ese perfil.
--
-- Nueva condición: auth_id = auth.uid() (identidad canónica 071, única por
-- 082). Se conserva el propósito original de la policy: cualquier usuario
-- autenticado lee SOLO su propia fila, esté Activo o Inactivo (Login y la
-- restauración de sesión cargan el perfil antes de que RLS/erp_es_activo
-- decidan el resto). No es active-only a propósito. Un perfil sin vincular
-- (auth_id NULL) no es legible por nadie salvo Admin. admin_all intacta.
-- Sin cambios de grants, helpers, constraint 082 ni datos. Idempotente.

DROP POLICY IF EXISTS self_read ON public.usuarios;
CREATE POLICY self_read ON public.usuarios FOR SELECT TO authenticated
  USING (auth_id IS NOT NULL AND auth_id = auth.uid());
