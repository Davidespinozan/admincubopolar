# Proyecto CuboPolar ERP

ERP de Cubo Polar, fábrica de productos de hielo. React 18 + Vite + Tailwind,
Supabase como backend (Auth + Postgres + Storage + Realtime), Netlify Functions
para serverless y deploy automático desde `main`.

> El documento técnico exhaustivo es `DOSSIER.md` (stack, patrones, migraciones
> una por una, functions, decisiones de diseño). Este archivo es el contexto
> rápido para asistentes de IA. La deuda técnica viva está en
> `docs/PENDIENTES_TECNICOS.md` y `docs/STANDALONE_DEUDA_TECNICA.md`.

## Estructura principal

- `src/App.jsx` — auth gate, routing por rol, scoping de datos por rol
- `src/components/`
  - `CuboPolarERP.jsx` — shell admin: 24 módulos en 4 áreas, sidebar +
    bottom-nav, navegación con hash (`#/modulo`), campana de notificaciones
  - `ChoferView.jsx`, `ProduccionStandaloneView.jsx`, `VentasStandaloneView.jsx`,
    `BolsasView.jsx` — vistas standalone móviles por rol (lazy)
  - `views/` — un archivo por módulo del shell (lazy); `ModuleViews.jsx` es un
    shim de re-export, el split YA está hecho
  - `ui/` — Modal, Toast, Icons, mapas Leaflet, Skeleton, etc.
- `src/data/`
  - `supaStore.js` — hook `useSupaStore`: fetch núcleo + slices, realtime
    granular por grupos (`realtimeLogic.js`), ~110 acciones. Sigue siendo el
    archivo más grande del repo (partir las acciones es deuda conocida)
  - `*Logic.js` — lógica pura testeada (orden, rutas, cierre de caja, mermas,
    devoluciones, cola offline, bandeja, crons, navegación…)
- `src/utils/` — `safe.js` (s, n, money, fmtDate), `geocoding.js`,
  `exportReports.js` (lazy ~300KB), `errorLog.js`, `errorMessages.js`
- `src/__tests__/` — 950+ tests Vitest, todos de lógica pura (sin red)
- `netlify/functions/` — 12 functions (billing Stripe/MercadoPago, CFDI
  Facturama completo, leads-intake público, admin-create-user) + 2 crons
  (`cron-cxc-vencidas`, `cron-rutas-atoradas`); helpers en `_lib/`
- `supabase/` — 70 scripts SQL `NNN_nombre.sql` (ver `MIGRATIONS_README.md`)
- `scripts/swAutoVersion.mjs` — inyecta CACHE_VERSION en `dist/sw.js` en cada
  build; NUNCA bumpear el service worker a mano

## Flujo de trabajo

1. `npm install` && `npm run dev` (o `npm run dev:full` con functions)
2. Antes de dar por buena una tanda: `npm test` (todos verdes), `npm run lint`
   (0 errores) y `npm run build`
3. Convención de commits: `feat(tandaNN): ...` / `fix(...)`, mensaje en español
4. `main` es producción; Netlify deploya cada push

## Convenciones del código

- **Lógica pura en `src/data/*Logic.js` + tests** — las vistas y el store solo
  orquestan. Toda tanda nueva sigue este patrón.
- **Convención de retorno del data layer**: `undefined` = éxito, `{ error }` =
  fallo con rollback, `{ error, partial: true }` = side-effect secundario falló
  (documentado en `docs/STANDALONE_DEUDA_TECNICA.md`).
- **Errores a español** con `traducirError` (`utils/errorMessages.js`);
  telemetría con Sentry + tabla `error_log`.
- Mobile-first: tap targets ≥44px, safe-area, `h-dvh`, inputs 16px en móvil.
- Roles (`ROLES_VALIDOS` en `adminUserLogic.js`): Admin, Ventas, Chofer,
  Producción, Almacén Bolsas, Facturación, Sin asignar.

## Configuración requerida (.env)

```
VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
VITE_GOOGLE_MAPS_API_KEY      # geocodificación
VITE_FACTURAMA_MODE           # sandbox | production
VITE_SENTRY_DSN               # opcional
```

## Estado actual y deuda conocida

- Tests: 950+ en verde. E2E: 3 smokes read-only (falta E2E de escritura).
- El chofer opera offline: cola de mutaciones en localStorage por ruta
  (`colaOfflineLogic.js` + `useColaOffline.js`); el cierre de ruta exige cola
  sincronizada.
- Realtime granular: núcleo (7 tablas con joins) vs slices (1-2 queries);
  requiere realtime habilitado en Supabase para `notificaciones` y
  `chofer_ubicaciones`.
- Deuda mayor: partir las ~110 acciones de `supaStore.js` por dominio;
  TypeScript gradual (empezar por `*Logic.js`); revisar si el descuento de
  cuartos fríos por mermas en `cerrarRutaCompleta` es correcto cuando la carga
  ya se descontó al firmar.
- Roadmap activo de mejoras: comparativa con los otros sistemas del autor y
  16 items priorizados (sesión 2026-08-19, tandas 21-26).
