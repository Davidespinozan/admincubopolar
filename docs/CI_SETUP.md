# Setup CI — GitHub Actions para smokes E2E

Tanda 13 montó un workflow de GitHub Actions que corre los 3 smokes
Playwright en 3 escenarios:

1. **Cron diario** a las `0 9 * * *` UTC.
2. **Post-deploy**: cada `push` a `main`.
3. **Manual dispatch** desde la UI de GitHub.

El workflow vive en
[.github/workflows/e2e-smokes.yml](../.github/workflows/e2e-smokes.yml).

---

## Conversión del cron a horarios locales

| TZ | Hora | Notas |
|---|---|---|
| **UTC** | 09:00 | Hora del cron |
| **Durango (CST)** | **03:00** | UTC-6 todo el año (México eliminó DST en 2022, salvo zona fronteriza norte) |
| **Valencia, España (CEST)** | **11:00** | UTC+2 — verano, marzo a octubre |
| **Valencia, España (CET)** | **10:00** | UTC+1 — invierno |

Si quieres ajustar el horario, modifica la línea `cron: '0 9 * * *'`
en el workflow. Formato: `minuto hora día_mes mes día_semana`.

Ejemplos útiles:
- `0 7 * * *` = 7 AM UTC = 1 AM Durango / 9 AM Valencia (CEST).
- `0 14 * * 1-5` = 2 PM UTC, lunes a viernes (~8 AM Durango / 4 PM Valencia).

---

## Configurar GitHub Secrets (obligatorio)

Sin estos secrets, el workflow falla en el step "Run E2E smokes"
porque el fixture `auth.js` salta los tests con `skip` cuando no
encuentra las env vars.

### Pasos

1. Ir al repo en GitHub: [Davidespinozan/admincubopolar](https://github.com/Davidespinozan/admincubopolar).
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Crear los siguientes **7 secrets** uno por uno:

| Secret | Valor |
|---|---|
| `E2E_BASE_URL` | `https://sistema.cubopolar.com` |
| `E2E_ADMIN_EMAIL` | `e2e-admin@cubopolar.com` |
| `E2E_ADMIN_PASSWORD` | (la del password manager — generada con `crypto.randomBytes` en Tanda 10) |
| `E2E_VENTAS_EMAIL` | `e2e-ventas@cubopolar.com` |
| `E2E_VENTAS_PASSWORD` | (idem) |
| `E2E_CHOFER_EMAIL` | `e2e-chofer@cubopolar.com` |
| `E2E_CHOFER_PASSWORD` | (idem) |

> **Recordatorio**: las contraseñas están en
> [docs/e2e-users-setup.sql](./e2e-users-setup.sql) PASO 1, comentadas
> con los UUIDs reales. Cópialas tal cual de ahí.

4. Después de guardar los 7 secrets, verifica que aparecen en la lista
   (los valores no se muestran, solo los nombres).

---

## Correr el workflow manualmente

Útil para validar el setup post-secrets sin esperar al cron.

1. GitHub repo → tab **Actions**.
2. En el sidebar izquierdo: **E2E Smoke Tests**.
3. Botón **Run workflow** (esquina superior derecha de la lista).
4. Branch: `main` (default).
5. **Run workflow**.

Tarda ~3-4 minutos. Verás el progreso en tiempo real.

---

## Cuando un run falla

### Notificación
GitHub envía **email automático** al owner del repo. Configurable en:
- GitHub → User settings → Notifications → Actions.

### Diagnóstico
1. Click en el run fallido en la tab **Actions**.
2. Expand del step "Run E2E smokes" para ver qué assertion falló.
3. Scroll hasta el final del run → **Artifacts** → descargar
   `playwright-report-XXXX.zip`.
4. Abrir el archivo `index.html` adentro: tienes screenshots, video,
   trace y stack del fallo.

Los artifacts se conservan **7 días** (configurable en el workflow
con `retention-days`).

### Causas comunes

| Síntoma | Causa probable | Acción |
|---|---|---|
| `E2E_*_EMAIL no configurados` (skip) | Falta algún secret | Agregar el faltante en GitHub Secrets |
| Login timeout 20s | Cuenta E2E desactivada en `usuarios.estatus` | `UPDATE usuarios SET estatus='Activo' WHERE email LIKE 'e2e-%'` |
| `Console errors no esperados` | Bug real **o** mensaje benigno nuevo | Revisar el mensaje; si es benigno, agregar a `WHITELISTED_CONSOLE_ERRORS` en `e2e/helpers/selectors.js` |
| Network timeout al cargar / | Netlify lento o caído | Reintentar manual; el workflow ya tiene `retries: 1` en `playwright.config.js` |
| `data-testid X no visible` | Cambio de UI sin actualizar el testid | Verificar que el componente sigue exponiendo el testid |

---

## Costo en GitHub Actions free tier

- **Repos públicos**: ilimitado.
- **Repos privados**: 2,000 minutos/mes free tier.
- Cada run de smokes: ~3-4 minutos.
- Cron diario = ~30 runs/mes = ~120 minutos.
- Push a main: ~1-2 runs/día = ~60 minutos extra.
- **Total estimado**: ~180-200 minutos/mes. Muy cómodo.

Si más adelante el costo importa, opciones:
- Cambiar cron a `0 9 * * 1-5` (solo días laborales) → ~80 min/mes.
- Quitar trigger `push` → solo cron diario.
