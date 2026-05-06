-- 065_remove_pass_legacy.sql
-- Tanda 12: elimina la columna usuarios.pass que conservaba contraseñas
-- legacy del sistema pre-Supabase-Auth en TEXTO PLANO. Cualquier admin
-- con SELECT sobre la tabla podía leerlas.
--
-- ─────────────────────────────────────────────────────────────────
-- Auditoría exhaustiva (Tanda 12) confirmó CERO consumidores en código:
--   src/           → 0 referencias
--   netlify/       → 0 referencias
--   src/__tests__/ → 0 referencias
--
-- Login.jsx usa supabase.auth.signInWithPassword contra auth.users —
-- nunca toca esta columna. La autenticación NO se ve afectada.
-- ─────────────────────────────────────────────────────────────────
--
-- 100% idempotente: si la columna ya no existe (re-run), el bloque
-- DO no ejecuta nada y la migración termina sin error.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'usuarios'
       AND column_name = 'pass'
  ) THEN
    -- 1. Quitar restricciones para permitir el UPDATE/DROP que sigue.
    ALTER TABLE usuarios ALTER COLUMN pass DROP NOT NULL;
    ALTER TABLE usuarios ALTER COLUMN pass DROP DEFAULT;

    -- 2. Limpiar valores existentes ANTES del DROP. Defensa en
    --    profundidad: si la siguiente sentencia falla por permisos
    --    o lock, al menos los valores quedan en NULL.
    UPDATE usuarios SET pass = NULL WHERE pass IS NOT NULL;

    -- 3. DROP estructural.
    ALTER TABLE usuarios DROP COLUMN pass;
  END IF;
END $$;
