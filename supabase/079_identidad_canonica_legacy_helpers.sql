-- 079_identidad_canonica_legacy_helpers.sql — B3 identidad canónica, fase 1.
--
-- get_my_rol() y get_my_user_id() (031) resolvían la identidad por el email
-- del JWT (lower(email) = lower(auth.jwt()->>'email'), LIMIT 1), ignoraban
-- usuarios.estatus y auth_id, no fijaban search_path y tenían EXECUTE para
-- PUBLIC/anon. 47 policies (31 tablas) y cerrar_ruta_financiero siguen
-- dependiendo de ellas; un Admin INACTIVO seguía pasando admin_all.
--
-- Esta fase conserva nombres, firmas y tipos de retorno y cambia SOLO el
-- interior: ambas delegan en el contrato de actor de 071 (auth_id =
-- auth.uid() AND estatus = 'Activo'). Sin segunda búsqueda por email, sin
-- leer el email del JWT, sin duplicar la lógica de erp_actor().
--   get_my_rol()     → erp_rol_activo()   (NULL si inactivo / sin perfil)
--   get_my_user_id() → erp_usuario_id()   (NULL si inactivo / sin perfil)
-- Compatibilidad: usuarios.email es UNIQUE y en producción cada usuario
-- activo tiene auth_id ↔ auth.users con el mismo email, por lo que todo
-- usuario activo legítimo resuelve al mismo rol e id que antes (auditado
-- read-only en esta fase). Las 47 policies dependientes no se reescriben:
-- heredan la identidad canónica.
--
-- EXECUTE: PUBLIC y anon fuera (todas las policies dependientes son TO
-- authenticated); authenticated lo necesita porque las expresiones de RLS
-- se evalúan con los privilegios del que consulta; service_role se
-- conserva. Mismo patrón que erp_* (071). Sin cambios de policies, 076–078,
-- self_read, auth_id UNIQUE, Netlify ni frontend. Idempotente.

CREATE OR REPLACE FUNCTION get_my_rol() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT erp_rol_activo()
$$;

CREATE OR REPLACE FUNCTION get_my_user_id() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT erp_usuario_id()
$$;

REVOKE ALL ON FUNCTION get_my_rol()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_my_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_rol()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_my_user_id() TO authenticated, service_role;
