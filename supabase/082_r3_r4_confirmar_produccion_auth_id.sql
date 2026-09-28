-- 082_r3_r4_confirmar_produccion_auth_id.sql — B3: dos invariantes pequeños
-- e independientes (R3 y R4). Sin cambios de cuerpos, policies ni frontend.
--
-- R3 — confirmar_produccion(bigint, bigint): función legacy (001/034),
-- SECURITY DEFINER sin search_path ni comprobación de actor. Sube
-- productos.stock y escribe kardex saltándose la arquitectura 076 (que
-- inserta producción ya Confirmada). Auditoría 082 (read-only): sin
-- llamadores en funciones, triggers, cron, Netlify ni pantallas (la acción
-- confirmarProduccion del store es código muerto); 0 filas Pendiente en
-- producción. Contención mínima: retirar EXECUTE a los roles de API. La
-- función queda físicamente presente (sin reescritura ni borrado). Tampoco
-- hay razón de mantenimiento para service_role (ningún servidor la usa), así
-- que se retira también; el owner (postgres) conserva la ejecución.
--
-- R4 — usuarios.auth_id: la identidad canónica (071/079) resuelve con
-- auth_id = auth.uid() LIMIT 1, pero nada impedía dos perfiles con el mismo
-- auth_id. Producción: 0 duplicados, 0 NULL, 0 huérfanos, 7 ↔ 7. Invariante
-- físico: UNIQUE NULLS DISTINCT (auth_id) — un UID de Auth identifica a lo
-- sumo un perfil; varios NULL siguen permitidos (perfil sin vincular durante
-- el alta, lo revisa R5). El índice parcial idx_usuarios_auth_id
-- (btree (auth_id) WHERE auth_id IS NOT NULL, 0 lecturas registradas) queda
-- cubierto por el índice único: mismo predicado de búsqueda, sin uso especial,
-- se elimina para no duplicar. No se toca la nulabilidad ni ningún dato.
-- Idempotente.

-- R3
REVOKE ALL ON FUNCTION confirmar_produccion(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated, service_role;

-- R4
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.usuarios'::regclass AND conname = 'usuarios_auth_id_key') THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_auth_id_key UNIQUE NULLS DISTINCT (auth_id);
  END IF;
END $$;
DROP INDEX IF EXISTS public.idx_usuarios_auth_id;
