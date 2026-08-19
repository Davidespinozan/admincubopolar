# CUBOPOLAR ERP

ERP de Cubo Polar (fábrica de productos de hielo). React 18 + Vite + Tailwind,
backend en Supabase (Auth + Postgres + Storage + Realtime), serverless en
Netlify Functions, deploy automático desde `main`.

> Referencia técnica completa: [`DOSSIER.md`](DOSSIER.md) y [`CLAUDE.md`](CLAUDE.md).

## Setup local

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:full     # netlify dev (frontend + functions)
```

Variables de entorno (`.env`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_MAPS_API_KEY=...      # geocodificación de direcciones
VITE_FACTURAMA_MODE=sandbox       # sandbox | production (banner MODO PRUEBA)
VITE_SENTRY_DSN=...               # opcional, telemetría frontend
```

Las functions usan además `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y las
credenciales de Stripe / MercadoPago / Facturama — ver `docs/` (setup de
Sentry, CI, E2E y cutover de Facturama).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (inyecta versión del service worker) |
| `npm test` | Suite Vitest (950+ tests de lógica pura) |
| `npm run lint` | ESLint sobre `src/` y `netlify/functions/` |
| `npm run test:e2e` | Smokes Playwright (ver `docs/E2E_SETUP.md`) |

## Arquitectura (resumen)

- **Vistas por rol** (lazy): Admin/Facturación usan el shell completo
  (`CuboPolarERP.jsx`, 24 módulos en 4 áreas, navegación con hash `#/modulo`);
  Chofer, Producción, Ventas y Almacén Bolsas tienen vistas standalone móviles.
- **Datos**: `src/data/supaStore.js` (hook `useSupaStore`) — fetch por núcleo +
  slices con realtime granular; lógica pura extraída a `src/data/*Logic.js`
  con tests en `src/__tests__/`.
- **Chofer offline**: entregas, no-entregas y mermas se encolan en el teléfono
  sin señal y se sincronizan al reconectar (`colaOfflineLogic.js`).
- **Serverless**: 12 functions de billing/CFDI/leads/usuarios + 2 crons de
  alertas (cartera vencida, rutas sin cerrar) en `netlify/functions/`.
- **Base de datos**: 70 scripts SQL en `supabase/` (ver
  `supabase/MIGRATIONS_README.md`), RLS por rol y RPCs atómicos.
- **PWA**: service worker propio con versión inyectada en build
  (`scripts/swAutoVersion.mjs`) — no requiere bump manual.

## Deploy

Netlify deploya cada push a `main` (`netlify.toml`: SPA fallback, headers de
seguridad, redirects de pago `/pagar/:id`, crons agendados). Requiere realtime
habilitado en Supabase para las tablas suscritas (incluye `notificaciones` y
`chofer_ubicaciones`).

## Notas

- Autenticación real de Supabase; no hay usuarios demo en el código.
- El banner "MODO PRUEBA" aparece mientras Facturama esté en sandbox; el plan
  de cutover a producción está en `docs/CUTOVER_PRODUCCION.md`.
