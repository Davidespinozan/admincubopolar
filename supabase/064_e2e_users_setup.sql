-- 064_e2e_users_setup.sql
-- Tanda 10: agrega usuarios.auth_id (UUID) a la tabla.
--
-- ─────────────────────────────────────────────────────────────────
-- DOBLE PROPÓSITO de esta migración:
-- ─────────────────────────────────────────────────────────────────
--
-- 1) Setup E2E: el INSERT de las 3 cuentas Playwright (Admin/Ventas/
--    Chofer) requiere ligar el row de `usuarios` con el UUID real
--    de `auth.users`. Sin esta columna no podemos persistir esa liga
--    al crear las cuentas.
--
-- 2) Fix de bug pre-existente descubierto en Tanda 10: el código
--    frontend (ConfiguracionView.jsx, supaStore.addUsuario) y el
--    backend (auth.js de netlify functions) asumen que `auth_id`
--    existe. La columna estaba prevista en `002_safe_migration.sql`
--    pero NO se aplicó en la BD de producción de Cubo Polar.
--
--    Síntoma latente: cualquier intento de crear un usuario nuevo
--    desde Configuración fallaba con "column auth_id does not exist".
--    Nadie lo notó porque no se han creado usuarios desde hace tiempo.
--
-- Esta migración es idempotente: si la columna ya existe (porque
--002_safe_migration.sql sí corrió en el environment), no hace nada.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS auth_id UUID;

COMMENT ON COLUMN usuarios.auth_id IS
  'UUID de auth.users (Supabase Auth). NULL para usuarios legacy pre-Supabase-Auth o aún no migrados. Tanda 10: agregada defensivamente — el código asumía que existía.';

-- Index parcial: lookups por auth_id (auth.js backend, App.jsx) sólo
-- aplican a filas con auth_id no nulo. Index parcial es más barato.
CREATE INDEX IF NOT EXISTS idx_usuarios_auth_id
  ON usuarios (auth_id)
  WHERE auth_id IS NOT NULL;
