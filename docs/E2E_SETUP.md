# Setup E2E con Playwright — Cubo Polar ERP

Tanda 10 montó la **Fase A** de tests E2E: smoke read-only contra
producción. Esta guía explica cómo correrlos, cómo agregar tests, y
qué se planea para Fase B mutativa.

---

## ¿Qué cubre Fase A?

3 smoke tests, todos **read-only** (cero mutaciones a la BD):

1. **smoke-admin** — login Admin → shell renderiza → role-badge dice
   "Admin" → sin errores de consola no whitelisted.
2. **smoke-ventas** — login Ventas → shell standalone (o admin filtrado)
   renderiza → sin errores de consola.
3. **smoke-chofer** — login Chofer → ChoferView renderiza → EmptyState
   "No tienes ruta asignada" visible (porque la cuenta E2E no tiene
   ruta) → sin errores de consola.

Estos tests cubren ~70% del valor de E2E con **cero riesgo de contaminar
producción**: si cualquier rol no puede loguear o el shell crashea, el
test falla.

### Lo que Fase A NO cubre

- Mutaciones (crear orden, asignar ruta, cobrar, facturar).
- Mapa Leaflet pintado (requiere ruta activa, Fase B).
- Flujo CFDI/Facturama (requiere mutación + cliente real).
- Race conditions multi-usuario.

Estos quedan para Fase B (ver final del documento).

---

## Setup local — primera vez

```bash
# 1. Instalar deps + browser
npm install
npx playwright install chromium

# 2. Variables de entorno (mejor en .env.local que NO está versionado)
export E2E_BASE_URL=https://sistema.cubopolar.com   # default si se omite
export E2E_ADMIN_EMAIL=e2e-admin@cubopolar.com
export E2E_ADMIN_PASSWORD=<la que generaste con docs/e2e-users-setup.sql>
export E2E_VENTAS_EMAIL=e2e-ventas@cubopolar.com
export E2E_VENTAS_PASSWORD=<...>
export E2E_CHOFER_EMAIL=e2e-chofer@cubopolar.com
export E2E_CHOFER_PASSWORD=<...>

# 3. Correr smokes
npm run test:e2e

# 4. Inspeccionar fallos
npm run test:e2e:ui          # modo UI interactivo
npx playwright show-report   # abre el HTML report del último run
```

> Si las env vars no están definidas, los tests **se saltan con `skip`**
> en lugar de fallar — útil para que el comando no rompa CI mientras
> el setup se completa.

---

## Cuentas de prueba

Las 3 cuentas E2E viven en producción (decisión Tanda 10) pero están
marcadas con `usuarios.is_test_account = true` (mig 063 + 064), lo que
las oculta de:

- Dropdown "choferes" en `RutasView` al asignar a ruta.
- Filtro por chofer en `ConciliacionView`.
- Listado de usuarios en `ConfiguracionView` (admin).

Esas cuentas **sí pueden hacer login** — Login.jsx, auth.js y App.jsx
no filtran `is_test_account`. La idea es que sean invisibles para el
admin operativo pero funcionales para Playwright.

Para crearlas, sigue [docs/e2e-users-setup.sql](./e2e-users-setup.sql).

---

## Doble destino vs Sentry

Cuando un smoke test corre, hace `localStorage.setItem('E2E', '1')`
antes de cualquier navegación. `src/lib/sentry.js:initSentry` lee ese
flag y se salta el init — así los `console.error` legítimos del flujo
de prueba **no contaminan** el dashboard de Sentry.

Si querés depurar Sentry en un test específico, comenta esa línea en
`e2e/fixtures/auth.js` temporalmente. **No la borres.**

---

## Whitelist de errores de consola

`e2e/helpers/selectors.js` exporta `WHITELISTED_CONSOLE_ERRORS`. Son
strings que aparecen en console en operación normal y NO deben fallar
un smoke. Si encuentras un error legítimo nuevo:

1. Abre `npm run test:e2e:ui`, reproduce, copia el mensaje exacto.
2. Confirma que NO es un bug real (revisa el código que lo emite).
3. Agrégalo al array.

Reglas:

- ✅ Mensajes de Supabase tolerados (lecturas opcionales con RLS).
- ✅ Mensajes del Service Worker / PWA.
- ❌ Errores de TypeError, ReferenceError, "Cannot read property X" — son
  bugs reales, NO whitelistar.

---

## Cadencia de ejecución recomendada

| Frecuencia | Quién dispara | Acción si falla |
|---|---|---|
| **Manual pre-release** | David antes de mergear cambios sensibles | Bloquea release |
| **Cron diario** (futuro Tanda 11) | GitHub Actions a las 7am MX | Email a David |
| **Pre-merge CI** | Pendiente; requiere acceso a env vars en GHA | — |

Por ahora **NO hay CI automático**. Los smokes se corren manualmente.

---

## Roadmap Fase B (futura)

Cuando se quiera cubrir flujos mutativos, hay 2 caminos:

### Opción 1 — BD de staging dedicada
- Crear segundo proyecto Supabase (`cubopolar-staging`).
- Correr todas las migraciones + seeds básicos.
- `E2E_BASE_URL=https://staging.cubopolar.com` apunta al deploy de Netlify
  con vars de staging.
- Tests pueden mutar libremente; cleanup opcional.
- **Costo**: ~25 USD/mes (Supabase Pro), 2-3 hrs de setup inicial.

### Opción 2 — Namespacing en producción
- Prefijo `E2E-TEST-` en todos los datos creados (folio, nombres).
- Fechas en futuro lejano (`9999-12-31`) para que no aparezcan en
  reportes de cierre/contabilidad.
- `afterEach` con cleanup explícito + script global de fallback que
  borre cualquier registro con prefijo `E2E-TEST-` y fecha 9999.
- **Costo**: 0 USD; **riesgo medio** (cleanup falla → basura).

Recomendación: ir por **Opción 1** cuando el ERP tenga ≥ 5 clientes en
producción. Hasta entonces, Fase A smoke es suficiente.

---

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| Test se salta con "E2E_*_EMAIL no configurado" | Falta export de env vars |
| Login timeout 20s | Cuenta no existe, contraseña errónea, o `is_test_account=true` no impide login (verifica que NO se filtre en Login/auth) |
| "Console errors no esperados: ..." | Bug real **o** mensaje benigno nuevo (whitelistar) |
| Test pasa local pero falla en CI | Diferencia de timing — sube `timeout` en `playwright.config.js` |
| El usuario E2E aparece en dropdown admin | `is_test_account` no está en `true` para esa cuenta |
