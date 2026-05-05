// sentry.js — observabilidad frontend (Tanda 7).
// Init defensivo: no traquea en development ni cuando falta DSN, así que
// el ERP sigue funcionando idéntico sin Sentry configurado.
//
// Doble destino para errores:
//   - error_log (Supabase, vía utils/errorLog) → audit trail interno permanente.
//   - Sentry → alertas en tiempo real, agrupación, source maps, replay.
// Son canales complementarios; no hay duplicación lógica.

import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

let initialized = false;

/**
 * Filtra errores antes de mandarlos a Sentry. Exportado para tests.
 * Devuelve el event modificado o null si debe descartarse.
 *
 * @param {Object} event   — Sentry event payload
 * @param {Object} hint    — { originalException? }
 * @param {Object} [opts]  — { onLine?: boolean } para inyectar el estado
 *                          de red en tests sin tocar navigator.
 */
export function shouldSendEvent(event, hint, opts = {}) {
  const error = hint?.originalException;
  const message = (error && error.message) || event?.message || '';

  // Errores de extensiones del browser (Chrome/Firefox)
  if (message.includes('chrome-extension://')) return null;
  if (message.includes('moz-extension://')) return null;

  // Warning benigno de Chrome cuando un observer dispara su propio resize.
  if (message.includes('ResizeObserver loop')) return null;

  // El usuario perdió internet — su ErrorBoundary ya muestra el banner offline.
  const onLine = opts.onLine !== undefined
    ? opts.onLine
    : (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (message.includes('NetworkError') && onLine === false) return null;

  return event;
}

export const initSentry = () => {
  if (initialized) return;
  if (!SENTRY_DSN || import.meta.env.MODE === 'development') {
    // Sin DSN o en dev: no-op. Se mantienen las funciones públicas
    // pero todas las llamadas a Sentry quedan inertes.
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || 'unknown',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,    // No leak de datos sensibles (RFC, montos, etc.)
        blockAllMedia: true,
      }),
    ],

    // Performance monitoring (10% de transactions).
    tracesSampleRate: 0.1,

    // Session Replay: 5% normal, 100% cuando hay error.
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,

    // Filtros: ignorar ruido conocido antes de enviar al server de Sentry.
    beforeSend: (event, hint) => shouldSendEvent(event, hint),
  });

  initialized = true;
};

/**
 * Asocia el contexto del usuario actual a las próximas captures.
 * Llamar con `null` en logout para limpiar.
 */
export const setUserContext = (user) => {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id != null ? String(user.id) : undefined,
    username: user.nombre || undefined,
    email: user.email || undefined,
    rol: user.rol || undefined,
  });
};

/**
 * Captura manual de un error con contexto opcional. Usar para errores
 * que ya manejaste (try/catch) y aún quieres reportar a Sentry.
 */
export const captureError = (error, context) => {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

// Re-export para que callers puedan usar primitivas Sentry sin re-importar.
export { Sentry };
