# Dossier técnico — cubopolar-erp

ERP de Cubo Polar (fábrica de hielo). React + Vite + Tailwind, backend Supabase
(Auth + Postgres), serverless en Netlify Functions, despliegue automático desde `main`.

## 1. Stack

**Runtime / framework**
- React `^18.3.1` + react-dom `^18.3.1`
- Vite `^6.0.3` (build tool), `@vitejs/plugin-react` `^4.3.4`
- Tailwind CSS `^3.4.16` + PostCSS `^8.4.49` + autoprefixer `^10.4.20`
- `type: module` (ESM en todo el repo)

**Backend / datos**
- `@supabase/supabase-js` `^2.49.1` (Auth + Postgres + Storage + RPC)

**Pagos / facturación**
- `stripe` `^18.0.0`
- `mercadopago` `^2.8.0`
- Facturama (vía REST, sin SDK — CFDI/SAT)

**Observabilidad**
- `@sentry/react` `^10.51.0` (frontend), `@sentry/node` `^10.51.0` (functions)
- `@sentry/vite-plugin` `^5.2.1` (upload de source maps)

**Utilidades**
- `jspdf` `^4.2.0` + `jspdf-autotable` `^5.0.7` (PDF), `xlsx` `^0.18.5` (Excel)
- `leaflet` `^1.9.4` (mapas), `browser-image-compression` `^2.0.2`

**Tooling (dev)**
- ESLint `^9.39.4` (flat config) + `eslint-plugin-react` + `eslint-plugin-react-hooks`
- Vitest `^4.1.0` + `@vitest/coverage-v8` (unit tests, env node)
- Playwright `^1.59.1` (`@playwright/test`) — smokes E2E

## 2. Estructura de carpetas

```
.
├── src/
│   ├── App.jsx                 # root: auth gate, role routing, scoping de datos
│   ├── main.jsx                # bootstrap React + ErrorBoundary + ToastProvider
│   ├── index.css               # tokens CSS, base styles, font imports
│   ├── components/             # vistas por rol, modales, ErrorBoundary, Login
│   │   ├── views/              # vistas modulares (ModuleViews.jsx ~3000 líneas)
│   │   └── ui/                 # Modal, Toast, Icons, mapas, formularios reutilizables
│   ├── data/                   # supaStore.js (store central) + *Logic.js puros
│   │   └── sat/                # lógica de facturación SAT
│   ├── lib/                    # supabase, sentry, backend (fetch a functions), sessionUser
│   ├── utils/                  # safe, geocoding, exportReports, errorMessages, etc.
│   └── __tests__/              # ~32 suites Vitest
├── netlify/
│   └── functions/              # serverless: billing-*, admin-create-user, leads-intake
│       └── _lib/               # helpers compartidos de functions
├── supabase/                   # migraciones SQL 000-065 + seeds + README
├── public/                     # sw.js, manifest.json, design-system.css, iconos
├── e2e/                        # tests Playwright (fixtures, helpers, tests)
├── docs/                       # documentación técnica y de cutover
├── .github/workflows/          # e2e-smokes.yml
├── vite.config.js  tailwind.config.js  eslint.config.js  netlify.toml
└── index.html
```

## 3. Patrones arquitectónicos clave

### Auth
- `src/lib/supabase.js` — cliente Supabase con `persistSession`, `autoRefreshToken`,
  `detectSessionInUrl` y `storage: localStorage` explícitos (necesario para PWA en iOS Safari ITP).
- `src/components/Login.jsx` — pantalla de login (Supabase Auth, sin usuarios demo).
- `src/lib/sessionUser.js` — `buildUserFromSessionAndProfile(session, profile)`: helper puro
  que mapea sesión de Supabase Auth + fila de tabla `usuarios` → objeto `user` del state.
- `src/App.jsx` — restaura sesión al mount con `supabase.auth.getSession()`, escucha
  `onAuthStateChange` (reacciona solo a `SIGNED_OUT`), muestra splash mientras restaura
  para evitar flash de Login. El perfil se resuelve por **email** (no por auth_id).

### Role-based access (RLS pattern)
- **Doble capa**: scoping en cliente + RLS en Postgres.
- **Cliente** (`App.jsx` → `scopedData`): Admin ve todo; `Chofer` ve solo sus rutas/órdenes/pagos/mermas;
  `Ventas` ve solo sus órdenes/clientes/pagos. El helper `matchOwner` compara contra múltiples
  llaves posibles (`usuario_id`, `vendedor_id`, `chofer_id`, `auth_id`, nombre…). Admin puede
  hacer "view as" otro rol vía `adminViewAs`.
- **Postgres** (`supabase/031_rls_por_rol.sql`): RLS por tabla con funciones
  `SECURITY DEFINER` `get_my_rol()` y `get_my_user_id()` que resuelven el usuario por
  `lower(email) = lower(auth.jwt() ->> 'email')`. Políticas `PERMISSIVE` aditivas:
  `admin_all` + políticas específicas por rol (`self_read`, etc.). Ver también
  `034_fix_rls_rpc_permissions.sql`, `045`, `046`.

### RPCs atómicos
- Definidos como funciones Postgres en `supabase/`, invocados con `supabase.rpc(...)` desde `supaStore.js`.
- Archivos clave:
  - `007_rpc_atomic_operations.sql` — `update_stocks_atomic(p_changes JSONB)`, `cerrar_ruta_atomic(...)`
  - `047_fix_update_stocks_atomic.sql` — fix de `update_stocks_atomic` (cuartos_frios.stock JSONB)
  - `054_update_productos_stock_atomic.sql` — `update_productos_stock_atomic(p_changes JSONB)`
  - `057_rpc_asignar_ordenes_ruta.sql` — `asignar_ordenes_a_ruta(...)`
  - `058_rpc_update_orden_atomic.sql` — `update_orden_atomic(...)`
- Otros RPC en uso: `rename_sku`, `nextval` (secuencias de folio), `asignar_orden`,
  `cancelar_orden_asignada`, `increment_saldo`, `confirmar_produccion`, `registrar_pago`.
- Patrón: la mutación multi-tabla se hace en una función Postgres (transacción única);
  el cliente revierte llamando al RPC inverso si un paso posterior falla.

### Errores Postgres
- `src/utils/errorMessages.js` — `traducirError(err, fallback)`: mapea códigos Postgres
  (`23503`, `23505`, `23514`, `23502`, `22P02`, `42P01`, `PGRST116`…) a mensajes en español;
  fallback a parsing de texto ("duplicate key", "foreign key", "network").
- `src/data/supaStore.js` — `safeRows(query, { critical, operation })`: lee `{ data, error }`,
  loguea, dispara `CustomEvent('supabase-error')`. Reads → `[]` en error; writes críticos → `throw`.
- `src/utils/errorLog.js` — `logErrorToDb()`: inserta en tabla `error_log` (fire-and-forget);
  registra listeners globales `supabase-error` y `unhandledrejection`.
- `src/lib/sentry.js` — captura a Sentry (frontend); `_lib/sentry.js` `withSentry()` envuelve handlers.
- Functions: errores HTTP normalizados vía `netlify/functions/_lib/http.js`
  (`badRequest`, `unauthorized`, `forbidden`, `serverError`…).

### Routing
- **No hay router de URL.** El routing es por **rol**, manejado en `src/App.jsx`:
  `effectiveRole` (rol real o `adminViewAs`) decide qué vista renderizar.
  - `Chofer` → `ChoferView` (lazy)
  - `Almacén Bolsas` → `BolsasView` (lazy)
  - `Producción` → `ProduccionStandaloneView` (lazy)
  - `Ventas` → `VentasStandaloneView` (lazy)
  - default (Admin y otros) → `CuboPolarERP`
- Vistas por rol cargadas con `React.lazy` + `Suspense` (code splitting, ~40% menos bundle inicial admin).
- Navegación interna dentro de `CuboPolarERP` por estado (tabs/módulos), no por URL.
- `netlify.toml` hace SPA fallback (`/* → /index.html`) y redirects de pago.

## 4. Helpers reutilizables

### `src/lib/`
- `supabase.js` — inicializa y exporta el cliente Supabase (auth persistente).
- `sentry.js` — init de Sentry frontend, `shouldSendEvent` (filtros), `setUserContext`, `captureError`.
- `backend.js` — `backendGet` / `backendPost`: fetch a `/.netlify/functions/*` con Bearer token.
- `sessionUser.js` — `buildUserFromSessionAndProfile`: arma el objeto `user` (puro, testeable).
- `facturamaMode.js` — `FACTURAMA_MODE` + `isSandboxMode` / `isProductionMode` (banner modo prueba).

### `src/utils/`
- `safe.js` — núcleo de saneo: `s` (string seguro), `n`/`nStrict` (número), `money`/`fmtMoney`,
  `centavos` (redondeo monetario), `fmtPct`, `todayISO`/`todayLocalISO`, `validarRFC`,
  `normalizeStr`, `eqId`, `arr`, `fmtDate`/`fmtDateTime`, `useDebounce`, `extraerTelefono`.
- `geocoding.js` — geocodificación con Google Maps API, links de Maps, Haversine, agrupar/ordenar por proximidad.
- `exportReports.js` — exportación a Excel/PDF (lazy loaded, ~700KB).
- `errorMessages.js` — `traducirError`: códigos Postgres → mensaje legible en español.
- `errorLog.js` — `logErrorToDb` + listeners globales de errores → tabla `error_log`.
- `stock.js` — `stockDisponiblePorSku`, `stockDisponibleParaEdicion` (fuente: `cuartos_frios.stock` JSONB).
- `tarimas.js` — cálculo de tarimas/capacidad de cuartos fríos (`bolsasATarimas`, `puedeAgregarAlCuarto`…).
- `navegacion.js` — `navUrl` / `abrirNavegacion`: deep links a Google/Apple Maps según dispositivo.
- `compressImage.js` — `compressImage`: comprime imágenes a ~1MB JPEG antes de subir.

> No existe `src/helpers/`. La lógica de negocio pura vive además en `src/data/*Logic.js`
> (`ordenLogic`, `rutasLogic`, `mermasLogic`, `cierreCajaLogic`, `devolucionesLogic`,
> `produccionLogic`, `transformacionLogic`, `direccionLogic`, `leadsIntakeLogic`, etc.).

## 5. Setup de Stripe

**Archivos** (`netlify/functions/`)
- `billing-create-checkout/` — crea checkout de pago (Stripe o MercadoPago según `provider`).
- `billing-webhook-stripe/` — recibe webhooks Stripe; valida firma con `STRIPE_WEBHOOK_SECRET`
  (`stripe.webhooks.constructEvent`); maneja `checkout.session.completed`; journal en tablas
  `webhook_events` + `payment_intents`, sincroniza pago de la orden.
- `billing-pay/` — resuelve `payment_intents.checkout_url` y redirige (`/pagar/:id`).
- `billing-result/` — página HTML de resultado de pago (`/pago-resultado?status=...`).
- `billing-sync-payment/` — sincroniza estado de pago del ERP hacia Facturama.
- `billing-config/` — reporta qué proveedores están configurados (booleans por env var).
- `_lib/providers.js` — clientes singleton de Stripe / MercadoPago.
- `_lib/persistence.js` — `upsertPaymentIntent`, `insertWebhookEvent`, `markWebhookEventProcessed`, `syncOrderPayment`.

**Env vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`.

**Flujo de pago**: frontend → `billing-create-checkout` → `payment_intents` (upsert) →
usuario paga → webhook (`billing-webhook-stripe` / `billing-webhook-mercadopago`) →
journal + `syncOrderPayment` → orden marcada pagada. SQL: `010_billing_integrations.sql`,
`015_harden_access_and_payments.sql`.

> Facturación CFDI/SAT (Facturama) es un flujo aparte: `billing-create-invoice`,
> `billing-create-complemento`, `billing-cancel-invoice`. SQL `060_facturacion_sat.sql`, `061_cancelacion_cfdi.sql`.

## 6. Setup de PWA

- `public/manifest.json` — `name` "Cubo Polar ERP", `display: standalone`, `theme_color #1d4ed8`,
  iconos 192/512 (`any maskable`).
- `public/sw.js` — service worker con `CACHE_VERSION` (bump manual por deploy). Estrategias:
  - `/assets/*` (hashed Vite) → cache-first inmutable.
  - navegación HTML → network-first con fallback al shell cacheado (`/`).
  - resto de estáticos → stale-while-revalidate.
  - **bypass total** para `*.supabase.co` y requests no-GET.
- `index.html` — registra el SW en `window load`; meta tags `apple-mobile-web-app-*`,
  `viewport-fit=cover`, `theme-color`.
- **Install prompt**: no hay componente de prompt custom; se usa el del navegador.
  Detección de modo standalone vía `matchMedia('(display-mode: standalone)')` (telemetría en App.jsx).
- `netlify.toml` fija `Cache-Control: max-age=0, must-revalidate` para `/index.html` y `/sw.js`.

## 7. CI/CD

**GitHub Actions** — `.github/workflows/e2e-smokes.yml`
- Triggers: cron diario `0 9 * * *` UTC, push a `main`, `workflow_dispatch`.
- Job `smokes` (ubuntu-latest, timeout 10 min): Node 20 → `npm ci` →
  `npx playwright install --with-deps chromium` → `npm run test:e2e` contra producción
  (read-only). Sube `playwright-report/` como artifact en fallo (7 días).
- Secrets: `E2E_BASE_URL`, `E2E_{ADMIN,VENTAS,CHOFER}_{EMAIL,PASSWORD}`.

**Despliegue** — Netlify automático desde `main` (`node_bundler = esbuild`).
`netlify.toml` define redirects, headers de seguridad (HSTS, X-Frame-Options,
CSP-lite vía Permissions-Policy) y cache de assets.

**Scripts `package.json`**
- `dev` — `vite` (localhost:5173)
- `dev:full` — `npx netlify dev` (incluye functions)
- `build` — `vite build` (outDir `dist`, sourcemaps, manualChunks vendor-react/vendor-supabase)
- `preview` — `vite preview`
- `test` / `test:watch` — Vitest
- `lint` / `lint:fix` — ESLint sobre `src` y `netlify/functions`
- `test:e2e` / `test:e2e:ui` / `test:e2e:headed` — Playwright

**Sentry en build**: `vite.config.js` sube source maps solo si `SENTRY_AUTH_TOKEN` +
`SENTRY_ORG` + `SENTRY_PROJECT` están presentes y `mode === production`; luego borra los `.map` del bundle.

## 8. Migraciones SQL

Carpeta `supabase/` — convención `NNN_nombre.sql`, aplicadas en orden. `MIGRATIONS_README.md` documenta el proceso.

- `000_reset.sql` — reset de schema (drop de objetos).
- `000_template_migration.sql` — plantilla para nuevas migraciones.
- `001_schema.sql` / `001_schema_completo.sql` — schema base (tablas core del ERP).
- `002_safe_migration.sql` — migración idempotente/segura del schema.
- `002_seed.sql` — datos semilla.
- `003_empleados_nomina_contabilidad.sql` — empleados, nómina y contabilidad.
- `004_control_financiero.sql` — control financiero.
- `004_demo_data.sql` — datos demo.
- `005_cleanup_demo_products.sql` — limpieza de productos demo.
- `005_rutas_mejoradas.sql` — mejoras al modelo de rutas.
- `006_costos_gastos.sql` — costos y gastos.
- `007_rpc_atomic_operations.sql` — RPCs atómicos: `update_stocks_atomic`, `cerrar_ruta_atomic`.
- `008_rutas_clientes.sql` — relación rutas-clientes.
- `009_clientes_geolocalizacion.sql` — geolocalización de clientes.
- `010_billing_integrations.sql` — payment intents, webhook journal, invoice attempts.
- `011_facturama_sync.sql` — referencia de factura Facturama en `ordenes`.
- `012_vendedor_id_ordenes.sql` — `vendedor_id` en `ordenes` (Ventas ve lo suyo).
- `013_fix_vendedor_id_fk.sql` — corrige FK de `vendedor_id` → `usuarios`.
- `014_storage_mermas.sql` — bucket/storage para evidencias de mermas.
- `015_harden_access_and_payments.sql` — endurece acceso público + idempotencia de pagos.
- `016_fix_anon_policies.sql` — quita acceso anónimo de tablas operativas.
- `017_fix_stock_and_status.sql` — fixes de race conditions e integridad.
- `018_facturama_uuid.sql` — columna UUID del CFDI.
- `019_rutas_columnas_faltantes.sql` — columnas faltantes en `rutas`.
- `020_fix_rpc_inventario_mov.sql` — corrige `update_stocks_atomic` (columnas inventario_mov).
- `021_cuartos_frios_stock_jsonb.sql` — columnas faltantes en `cuartos_frios`.
- `022_fix_rpc_sin_fk.sql` — `update_stocks_atomic` sin INSERT con FK.
- `023_fix_rpc_cuarto_id_text.sql` — `cuartos_frios.id` es TEXT, no BIGINT.
- `024_transformacion_hielo.sql` — transformación de hielo (barras → triturado).
- `025_stock_minimo_cuartos.sql` — `stock_minimo` en productos.
- `026_camiones_ayudante_ruta.sql` — tabla `camiones` + ayudante/camión en rutas.
- `027_notificaciones.sql` — sistema de notificaciones.
- `028_credito_clientes.sql` — crédito autorizado por cliente + tipo de cobro.
- `029_nombre_comercial_folio_nota.sql` — `nombre_comercial` en clientes, `folio_nota` en ordenes.
- `030_indexes_performance.sql` — índices de rendimiento.
- `031_rls_por_rol.sql` — Row Level Security por rol (`get_my_rol`, `get_my_user_id`, políticas).
- `032_gps_tracking.sql` — GPS tracking de choferes en tiempo real.
- `033_error_log.sql` — tabla `error_log`.
- `034_fix_rls_rpc_permissions.sql` — corrige permisos RLS/RPC para todos los roles.
- `035_remap_skus_viejos.sql` — remapea SKUs viejos → nuevos en todas las tablas.
- `036_rename_sku_function.sql` — función `rename_sku(id, viejo, nuevo)` con cascade.
- `037_mermas_ruta_id.sql` — `ruta_id` en mermas.
- `039_firma_carga_ruta.sql` — firma de carga de ruta.
- `040_capacidad_tarimas.sql` — capacidad en tarimas de cuartos fríos.
- `041_archivo_columnas_huerfanas_rutas.sql` — archiva columnas huérfanas de rutas.
- `042_direccion_entrega_ordenes.sql` — dirección de entrega en ordenes.
- `043_columnas_cancelacion_ordenes.sql` — columnas de cancelación en ordenes.
- `044_configuracion_empresa.sql` — tabla `configuracion_empresa`.
- `044a_telefono_empleados.sql` — teléfono en empleados.
- `045_rls_configuracion_empresa.sql` — RLS para `configuracion_empresa`.
- `046_rls_chofer_ubicaciones.sql` — RLS para `chofer_ubicaciones`.
- `047_fix_update_stocks_atomic.sql` — fix de `update_stocks_atomic`.
- `048_unique_cxc_orden.sql` — unique en cuentas por cobrar por orden.
- `049_unique_chofer_ruta_activa.sql` — un solo chofer con ruta activa.
- `050_orden_no_entregada.sql` — soporte para orden no entregada.
- `051_devoluciones.sql` — devoluciones.
- `052_cierres_diarios.sql` — cierres diarios de caja.
- `054_update_productos_stock_atomic.sql` — RPC `update_productos_stock_atomic`.
- `055_unique_rfc_nominativos.sql` — unique de RFC en facturación nominativa.
- `056_numero_exterior.sql` — `numero_exterior` en direcciones.
- `057_rpc_asignar_ordenes_ruta.sql` — RPC `asignar_ordenes_a_ruta`.
- `058_rpc_update_orden_atomic.sql` — RPC `update_orden_atomic`.
- `059_rutas_tanda3.sql` — mejoras de rutas (tanda 3).
- `060_facturacion_sat.sql` — facturación SAT/CFDI.
- `061_cancelacion_cfdi.sql` — cancelación de CFDI.
- `062_unique_camion_ruta_activa.sql` — un solo camión con ruta activa.
- `063_test_accounts.sql` — cuentas de prueba.
- `064_e2e_users_setup.sql` — usuarios para tests E2E.
- `065_remove_pass_legacy.sql` — elimina campo de password legacy (post Supabase Auth).

## 9. Netlify Functions

Carpeta `netlify/functions/` (`node_bundler = esbuild`). Todas envueltas en `withSentry`.

- `admin-create-user/` — alta de usuarios desde panel admin (solo rol Admin; valida contra
  catálogo de roles; `supabase.auth.admin.createUser`). Reemplaza la Edge Function rota `hyper-endpoint`.
- `billing-create-checkout/` — crea checkout de pago (Stripe / MercadoPago).
- `billing-create-invoice/` — genera CFDI (factura) en Facturama. Roles: Admin/Facturación/Ventas.
- `billing-create-complemento/` — genera Complemento de Pago (CFDI tipo "P" / REP) para ventas a crédito PPD.
- `billing-cancel-invoice/` — cancela un CFDI timbrado ante el SAT (motivos 01-04, idempotente).
- `billing-config/` — reporta qué proveedores de pago/facturación están configurados.
- `billing-pay/` — resuelve la `checkout_url` de una orden y redirige (ruta pública `/pagar/:id`).
- `billing-result/` — página HTML de resultado de pago (éxito/cancelado).
- `billing-sync-payment/` — sincroniza el estado de pago del ERP hacia Facturama.
- `billing-webhook-stripe/` — recibe y verifica webhooks de Stripe; journal + sync de orden.
- `billing-webhook-mercadopago/` — recibe webhooks de MercadoPago; journal + sync de orden.
- `leads-intake/` — endpoint público para leads de la landing (CORS whitelisted, honeypot,
  dedup por teléfono 5 min, insert con service_role).

**`_lib/` (helpers compartidos)**
- `http.js` — respuestas HTTP normalizadas (`ok`, `badRequest`, `unauthorized`, `forbidden`, `serverError`…).
- `auth.js` — `getAuthenticatedProfile` / `canAccessOrden` (resuelve perfil vía JWT Bearer).
- `env.js` — `requireEnv` / `optionalEnv`.
- `supabaseAdmin.js` — cliente Supabase con `SERVICE_ROLE_KEY` (singleton, sin sesión).
- `providers.js` — clientes singleton Stripe / MercadoPago + config de Facturama.
- `persistence.js` — upserts de payment intents, journal de webhooks, sync de pago de orden.
- `invoiceLogic.js` — lógica pura CFDI (mapas de forma/método de pago, receptor, régimen).
- `translateFacturama.js` — traduce errores crudos de Facturama a mensaje legible.
- `sentry.js` — `withSentry` (wrapper de handlers; passthrough si no hay DSN).

## 10. Decisiones de diseño visual

**Tokens / paleta** — duplicados en `src/index.css` (prefijo `--cp-`) y `public/design-system.css`
(prefijo `--ds-`, archivo portable a otros proyectos Tailwind):

| Token | Valor | Uso |
|---|---|---|
| bg | `#ebf2f4` | fondo base |
| bg-deep | `#07131a` | fondo oscuro |
| panel | `rgba(255,255,255,0.82)` | tarjetas/paneles (glass) |
| panel-strong | `rgba(255,255,255,0.94)` | paneles destacados |
| ink | `#08141b` | texto principal |
| muted | `#59707a` | texto secundario |
| line / line-strong | `rgba(8,20,27,0.08)` / `0.14` | bordes |
| accent / teal | `#0b7798` | color primario |
| cyan | `#7ee7ff` | acento frío |
| warm | `#ffd6aa` | acento cálido (orbe) |
| theme_color (PWA) | `#1d4ed8` | barra de estado / manifest |

- **Fondo característico**: gradiente lineal claro + dos `radial-gradient` (orbe cyan arriba-izq,
  orbe cálido arriba-der). Versión oscura `--ds-shell-dark` para navbars/sidebars.
- **Sombras**: sistema de 3 niveles (`shadow`, `shadow-strong`, `shadow-up`) con tinte azul oscuro.

**Tipografía**
- Cuerpo / UI: **IBM Plex Sans** (`@import` de Google Fonts en `index.css` y `design-system.css`).
  Pesos 400/500/600/700. Fallback `system-ui`.
- Display / títulos: **Space Grotesk** (clase `.font-display` / `.ds-display`),
  `letter-spacing: -0.03em`, weight 700.
- Configurado en `tailwind.config.js` como `font-sans` y `font-display`.
- Nota: `index.html` precarga **DM Sans** (legacy/parcial); las fuentes activas del design system
  son IBM Plex Sans + Space Grotesk.

**Namespace CSS**
- App: clases `erp-*` (ej. `erp-panel`, `erp-kicker`, `erp-shell-blur`) + variables `--cp-*`.
- Design system portable (`public/design-system.css`): clases `ds-*` (`ds-panel`, `ds-btn-primary`,
  `ds-input`, `ds-badge`, `ds-sheet`, `ds-stat`…) + variables `--ds-*`. Pensado para copiarse
  a cualquier proyecto Tailwind v3.

**Tailwind — extensiones** (`tailwind.config.js`)
- Breakpoint custom `xs: 475px` (distinguir celulares chicos de grandes).
- Utilidades de safe-area: `p{t,b,l,r}-safe-*` mapeadas a `env(safe-area-inset-*)` (notch iPhone).
- iOS: `index.css` fuerza `font-size: 16px` en inputs/select/textarea en `≤768px` para evitar
  el zoom automático de Safari al hacer focus.

## 13. Actualización 2026-08-19 (Tandas 21–26)

Cambios posteriores a la redacción original de este dossier:

- **Tanda 21 — Crons + SW automático**: primeras Netlify Scheduled Functions
  (`cron-cxc-vencidas` 13:00 UTC, `cron-rutas-atoradas` 13:30 UTC; dedup diario
  por `referencia` en `notificaciones`). `scripts/swAutoVersion.mjs` inyecta
  `CACHE_VERSION` (commit+timestamp) en `dist/sw.js` en cada build — el bump
  manual del service worker quedó eliminado (el build FALLA si el marcador
  desaparece).
- **Tanda 22 — Chofer offline**: cola de mutaciones (entrega / no-entrega /
  merma) en localStorage por ruta con sync automática al reconectar y reintento
  cada 30s (`src/data/colaOfflineLogic.js` + `useColaOffline.js`). Las entregas
  también persisten en localStorage (antes un reload perdía ventas exprés y
  fotos). El cierre de ruta exige conexión y cola sincronizada.
- **Fix mermas**: la merma de ruta se duplicaba (insert + descuento de cuartos
  en `registrarMerma` Y otra vez en `cerrarRutaCompleta`). Ahora es solo local
  hasta el cierre, que es el único camino a BD.
- **Tanda 23 — Realtime granular**: `fetchAll` partido en `fetchCore` (14
  tablas interdependientes) + `fetchSlice` por tabla (partición en
  `src/data/realtimeLogic.js`, debounce por grupo). Suscripciones nuevas:
  `notificaciones` (campana en vivo) y `chofer_ubicaciones` (GPS en vivo).
- **Tanda 24 — Mi bandeja**: centro de pendientes del admin
  (`src/data/bandejaLogic.js`, 10 detectores) con badge de urgentes en el menú.
- **Tanda 25 — Deep-linking**: el shell admin sincroniza vista ↔ hash
  (`#/modulo`) con botón atrás; la campana navega al módulo de cada
  notificación (`src/data/navegacionShellLogic.js`).
- **Tanda 26 — Docs**: README y CLAUDE.md reescritos al estado real;
  eliminados `src/data/mockData.js` (muerto) y archivos basura de la raíz.

Suite de tests: 870 → 953. Contexto de fondo: estas tandas ejecutan un roadmap
de 16 mejoras derivado de comparar CuboPolar contra sala-studio y
renovacell-sistema (2026-08-19).
