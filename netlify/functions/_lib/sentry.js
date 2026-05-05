// sentry.js — observabilidad backend (Tanda 7).
// Captura excepciones no manejadas en handlers de Netlify Functions.
//
// Init defensivo: si no hay SENTRY_DSN_BACKEND, withSentry actúa como
// passthrough (solo invoca el handler) — el ERP sigue funcionando.

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const SENTRY_DSN = process.env.SENTRY_DSN_BACKEND;
let initialized = false;

export function initSentry() {
  if (initialized || !SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    // En Netlify, CONTEXT identifica el deploy: production / deploy-preview / branch-deploy.
    environment: process.env.CONTEXT || 'production',
    release: process.env.COMMIT_REF || 'unknown',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
  });

  initialized = true;
}

/**
 * HOC que envuelve un handler de Netlify Function. Si el handler arroja,
 * la excepción se reporta a Sentry (con flush) ANTES de propagar el throw.
 *
 * Patrón estándar Netlify: `(event, context) => Promise<{ statusCode, body }>`
 *
 * @param {Function} handler
 * @returns {Function}
 */
export function withSentry(handler) {
  return async (event, context) => {
    initSentry();
    try {
      return await handler(event, context);
    } catch (err) {
      if (initialized) {
        Sentry.captureException(err, {
          extra: {
            path: event?.path,
            httpMethod: event?.httpMethod,
            // No incluir event.body por privacidad (puede contener
            // RFCs, tarjetas en pago, payloads de Facturama, etc.).
          },
        });
        // flush con timeout de 2s — Netlify functions cortan a los ~10s en
        // background, esto da margen sin bloquear demasiado el response.
        await Sentry.flush(2000);
      }
      throw err;
    }
  };
}

export { Sentry };
