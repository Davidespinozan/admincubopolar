-- 063_test_accounts.sql
-- Tanda 10: marca cuentas E2E (Playwright) para filtrarlas de dropdowns
-- y vistas de admin sin afectar la autenticación. Las cuentas marcadas
-- con is_test_account=true PUEDEN hacer login normal — solo se ocultan
-- de:
--   - RutasView: dropdown "choferes" al asignar a ruta
--   - ConciliacionView: filtro por chofer
--   - ConfiguracionView: listado de usuarios admin
--
-- NO se filtran en:
--   - Login.jsx, auth.js, App.jsx (lookup del usuario logueado)
--   - supaStore fetch inicial (App.jsx necesita el row para resolver
--     usuarioActual del login)
--
-- Uso:
--   UPDATE usuarios SET is_test_account = true
--    WHERE email IN ('e2e-admin@cubopolar.com',
--                    'e2e-ventas@cubopolar.com',
--                    'e2e-chofer@cubopolar.com');

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN usuarios.is_test_account IS
  'Cuentas E2E (Playwright) que deben filtrarse de dropdowns/listas de admin pero PUEDEN autenticarse normalmente. Tanda 10.';

-- Index parcial barato para dropdowns/listas que filtran NO-test.
CREATE INDEX IF NOT EXISTS idx_usuarios_visibles
  ON usuarios (id)
  WHERE is_test_account = false;
