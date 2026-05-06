-- e2e-users-setup.sql
-- Tanda 10: instructivo + SQL para que David cree las 3 cuentas E2E
-- en Supabase Auth + tabla `usuarios`. Estas cuentas son las que usa
-- Playwright para correr los smoke tests contra producción.
--
-- ─────────────────────────────────────────────────────────────────
-- PRECONDICIONES
-- ─────────────────────────────────────────────────────────────────
-- 1) Migración 063_test_accounts.sql ya corrió:
--      ALTER TABLE usuarios ADD COLUMN is_test_account BOOLEAN ...
-- 2) Migración 064_e2e_users_setup.sql ya corrió:
--      ALTER TABLE usuarios ADD COLUMN auth_id UUID ...
--
--    Verifica con:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'usuarios'
--         AND column_name IN ('is_test_account', 'auth_id');
--    Debe devolver 2 filas.
-- 3) Migración 065_remove_pass_legacy.sql ya corrió:
--      ALTER TABLE usuarios DROP COLUMN pass;
-- ─────────────────────────────────────────────────────────────────
--
-- PASO 1 — Crear las cuentas en Supabase Auth (UI dashboard)
-- ─────────────────────────────────────────────────────────────────
-- Abrir: Supabase Dashboard → Authentication → Users → Add user.
--
-- Crear las 3 cuentas con estos datos EXACTOS (las contraseñas se
-- generaron con crypto.randomBytes — guárdalas en tu password manager):
--
--   Email:     e2e-admin@cubopolar.com
--   Password:  2Ul9pEO3TKEtaz3Pb9W4pIg0
--   ✅ Auto-confirm user: SÍ
--
--   Email:     e2e-ventas@cubopolar.com
--   Password:  f36va1qsjlHVUXYYGkADkuIt
--   ✅ Auto-confirm user: SÍ
--
--   Email:     e2e-chofer@cubopolar.com
--   Password:  KRIe5oH5FUQdoVX5xSmR0vkQ
--   ✅ Auto-confirm user: SÍ
--
-- Después de crearlas, los UUIDs reales que David capturó son:
--   e2e-admin@cubopolar.com   →  76e1d265-514f-44a2-b665-c348333c2319
--   e2e-ventas@cubopolar.com  →  4c8fca98-503d-4f6d-8ef8-80f42d0adf37
--   e2e-chofer@cubopolar.com  →  012fb66c-f6d6-43d2-adfd-85c1113be583
--
-- (Si David creó nuevamente las cuentas y los UUIDs cambiaron, copiar
-- los nuevos con:
--   SELECT id, email FROM auth.users
--    WHERE email LIKE 'e2e-%@cubopolar.com';
-- y reemplazar abajo.)
--
-- ─────────────────────────────────────────────────────────────────
-- PASO 2 — Insertar perfiles en tabla `usuarios`
-- ─────────────────────────────────────────────────────────────────
-- Notas:
--  • Pre-Tanda 12 incluíamos `pass = ''` para esquivar el NOT NULL
--    DEFAULT '1234' del schema legacy. La migración 065 eliminó la
--    columna; el INSERT ya no la incluye.
--  • is_test_account = true las oculta de dropdowns admin (RutasView,
--    ConciliacionView, ConfiguracionView).
--  • ON CONFLICT (email) permite re-correr la migración si David necesita
--    rotar UUIDs o resetear las cuentas.

INSERT INTO usuarios (nombre, email, rol, estatus, auth_id, is_test_account)
VALUES
  ('E2E Admin',  'e2e-admin@cubopolar.com',  'Admin',  'Activo',
   '76e1d265-514f-44a2-b665-c348333c2319', true),
  ('E2E Ventas', 'e2e-ventas@cubopolar.com', 'Ventas', 'Activo',
   '4c8fca98-503d-4f6d-8ef8-80f42d0adf37', true),
  ('E2E Chofer', 'e2e-chofer@cubopolar.com', 'Chofer', 'Activo',
   '012fb66c-f6d6-43d2-adfd-85c1113be583', true)
ON CONFLICT (email) DO UPDATE SET
  rol             = EXCLUDED.rol,
  estatus         = EXCLUDED.estatus,
  auth_id         = EXCLUDED.auth_id,
  is_test_account = EXCLUDED.is_test_account;

-- ─────────────────────────────────────────────────────────────────
-- PASO 3 — Verificación
-- ─────────────────────────────────────────────────────────────────

-- 3.1 Las 3 cuentas existen y están marcadas como test:
SELECT email, rol, estatus, is_test_account, auth_id
  FROM usuarios
 WHERE is_test_account = true;
-- Esperado: 3 filas (Admin, Ventas, Chofer), todas estatus=Activo,
-- auth_id no NULL.

-- 3.2 Los IDs de auth.users coinciden con usuarios.auth_id:
SELECT u.email, u.rol, (au.id IS NOT NULL) AS auth_match
  FROM usuarios u
  LEFT JOIN auth.users au ON au.id = u.auth_id
 WHERE u.is_test_account = true;
-- Esperado: 3 filas, auth_match = true en las 3.

-- 3.3 NO aparecen en el dropdown de RutasView (verificación lógica):
SELECT COUNT(*) AS choferes_visibles
  FROM usuarios
 WHERE rol = 'Chofer' AND is_test_account = false AND estatus = 'Activo';
-- Esperado: el conteo de choferes "reales" (no incluye al e2e-chofer).

-- ─────────────────────────────────────────────────────────────────
-- PASO 4 — Configurar env vars locales (en la máquina dev)
-- ─────────────────────────────────────────────────────────────────
-- En .env.local (NO versionado) o como export en tu shell:
--
--   E2E_BASE_URL=https://sistema.cubopolar.com
--   E2E_ADMIN_EMAIL=e2e-admin@cubopolar.com
--   E2E_ADMIN_PASSWORD=2Ul9pEO3TKEtaz3Pb9W4pIg0
--   E2E_VENTAS_EMAIL=e2e-ventas@cubopolar.com
--   E2E_VENTAS_PASSWORD=f36va1qsjlHVUXYYGkADkuIt
--   E2E_CHOFER_EMAIL=e2e-chofer@cubopolar.com
--   E2E_CHOFER_PASSWORD=KRIe5oH5FUQdoVX5xSmR0vkQ
--
-- Después correr:
--   npm run test:e2e
--
-- Los 3 smokes deben pasar verdes.

-- ─────────────────────────────────────────────────────────────────
-- BONUS — Si una contraseña se compromete
-- ─────────────────────────────────────────────────────────────────
-- 1. Ir a Supabase Auth → Users → seleccionar la cuenta → Reset password.
-- 2. Generar nueva contraseña con:
--      node -e "console.log(require('crypto').randomBytes(18).toString('base64').replace(/[+/=]/g, x => ({'+':'A','/':'B','=':''}[x])))"
-- 3. Actualizar la env var local + en cualquier CI que tenga acceso.
-- 4. Considerar también cambiar `estatus` a 'Inactivo' temporalmente
--    para invalidar la sesión inmediatamente:
--      UPDATE usuarios SET estatus = 'Inactivo' WHERE email = 'e2e-admin@cubopolar.com';
--    (auth.js rechaza login si estatus != 'Activo')
