# Setup de Sentry — observabilidad CuboPolar ERP

Tanda 7 instaló los SDKs de Sentry (frontend + backend) y configuró
source maps. **El código está listo, pero Sentry queda inerte hasta que
configures las env vars** — sin DSN, las llamadas a `Sentry.init` se
saltan y todo sigue funcionando exactamente igual que antes.

Esta guía es para que David termine el setup en sentry.io y Netlify.

---

## ¿Por qué dos canales de error reporting?

El ERP envía errores capturados a **dos destinos**:

| Canal           | Para qué sirve                                     | Dónde lo ves                          |
|-----------------|----------------------------------------------------|---------------------------------------|
| `error_log`     | Audit trail interno permanente                     | Tabla Supabase, dashboard del ERP     |
| **Sentry**      | Alertas en tiempo real, agrupación, replay, source maps | sentry.io                             |

**No hay duplicación lógica** — son canales complementarios:

- `error_log` ya existía pre-Sentry. Se mantiene porque le da control
  permanente sobre los errores históricos sin depender de un servicio
  externo, y es donde el ErrorBoundary copia los stacks largos.
- Sentry agrega lo que `error_log` no puede dar: agrupación inteligente
  (junta los errores idénticos en un solo issue), alertas por email/Slack
  cuando aparece uno nuevo, replay de la sesión hasta el crash, y
  desminificación de stacks vía source maps.

Cuando Sentry esté configurado, los errores irán a **ambos lugares**
sin duplicar trabajo manual.

---

## 1. Crear cuenta y proyectos en sentry.io

1. Crear cuenta gratis en [sentry.io](https://sentry.io). El plan free
   cubre 5 K errores/mes — más que suficiente para CuboPolar.
2. Crear **dos proyectos**:
   - `cubopolar-frontend` — platform: **React**
   - `cubopolar-backend` — platform: **Node.js**
3. De cada proyecto copia el **DSN** (URL larga que empieza con
   `https://...@o123.ingest.sentry.io/456`).

---

## 2. Configurar env vars en Netlify

En el dashboard de Netlify → Site settings → Environment variables,
agregar:

| Variable                | Valor                              | Scope   |
|-------------------------|------------------------------------|---------|
| `VITE_SENTRY_DSN`       | DSN del proyecto frontend          | runtime + build |
| `SENTRY_DSN_BACKEND`    | DSN del proyecto backend           | runtime |
| `SENTRY_ORG`            | Slug de tu org en sentry.io        | build   |
| `SENTRY_PROJECT`        | `cubopolar-frontend`               | build   |
| `SENTRY_AUTH_TOKEN`     | Token con scope `project:releases` | build   |

> **Cómo generar el AUTH_TOKEN**:
> sentry.io → User Settings → Auth Tokens → Create Token con scopes
> `project:releases` y `org:read`. Cópialo, NO se vuelve a mostrar.

> **Importante**: `SENTRY_AUTH_TOKEN` solo se usa durante el build de
> Vite para subir source maps. Nunca se incluye en el bundle.

---

## 3. Configurar alertas en Sentry

En cada proyecto (frontend y backend), Settings → Alerts → New Alert:

1. **Errores nuevos en producción** — issue is first seen → Email
2. **Spike** — issue is seen more than 10 times in 5 minutes → Email
3. **Regresiones** — issue marked as resolved is seen again → Email

Para alertas por Slack/Discord/etc., conecta la integración correspondiente
en Settings → Integrations.

---

## 4. Higiene del dashboard

Los primeros días vas a ver ruido (errores benignos, ciertos navegadores
viejos, extensions). Conforme aparezcan:

- **Ignored**: errores que no se pueden o no se deben arreglar (ej.
  ResizeObserver loop, errores de extensions raras).
- **Resolved**: errores que SÍ arreglaste y no esperas volver a ver.
- **Marked as critical**: errores de facturación, cobranza, pérdida de
  datos. Se les asigna alerta inmediata.

El filtro `beforeSend` en `src/lib/sentry.js` ya descarta los más
comunes (chrome-extension, ResizeObserver, network offline). Si aparecen
otros, agrégalos ahí.

---

## 5. Verificar después del primer deploy

1. Hacer un deploy a Netlify con las env vars configuradas.
2. Abrir la app en producción.
3. En DevTools → Console:
   ```js
   throw new Error('Sentry test desde devtools — ' + new Date().toISOString())
   ```
4. Verificar que aparece en sentry.io con stack trace **del código
   original** (no minificado). Eso confirma que los source maps subieron.
5. Como prueba del backend: hacer un POST a `/.netlify/functions/billing-create-invoice`
   con un body inválido y verificar que aparezca en el proyecto backend.

---

## 6. Variables resumidas

Para referencia, estas son las env vars que añade Tanda 7:

```
# Frontend (sentry.io)
VITE_SENTRY_DSN=https://...@o123.ingest.sentry.io/456

# Backend (sentry.io)
SENTRY_DSN_BACKEND=https://...@o123.ingest.sentry.io/789

# Build-time (subida de source maps)
SENTRY_ORG=cubopolar
SENTRY_PROJECT=cubopolar-frontend
SENTRY_AUTH_TOKEN=sntrys_...
```

Sin estas vars, el código sigue funcionando — Sentry solo queda inerte.

---

## 7. Costos esperados

Plan free: **5 K errores/mes + 50 réplicas/mes**. Con la configuración
actual (`tracesSampleRate: 0.1`, `replaysSessionSampleRate: 0.05`,
`replaysOnErrorSampleRate: 1.0`), un volumen normal de operación de
CuboPolar debería caber holgadamente en el plan free.

Si el volumen sube y hay que pagar, el plan Team es ~$26/mes/usuario.
