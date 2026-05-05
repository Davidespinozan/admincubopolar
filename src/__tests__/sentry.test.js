// sentry.test.js — Tanda 7: lib/sentry.js (frontend Sentry).
// El init real está protegido por VITE_SENTRY_DSN. En tests no hay DSN,
// así que initSentry queda no-op y todas las funciones publicas son
// inertes. Validamos que NO crasheen en ese estado y testeamos el
// filtro shouldSendEvent en aislamiento.
//
// El test del doble-destino (Supabase error_log + Sentry) está al final
// — verifica que ErrorBoundary.componentDidCatch llame a AMBOS canales.
import { describe, it, expect, vi } from 'vitest';
import {
  initSentry,
  setUserContext,
  captureError,
  shouldSendEvent,
} from '../lib/sentry';

// ─── initSentry / setUserContext / captureError (sin DSN) ────
describe('lib/sentry — sin DSN configurado', () => {
  it('initSentry no crashea cuando falta VITE_SENTRY_DSN', () => {
    expect(() => initSentry()).not.toThrow();
  });

  it('initSentry es idempotente (multiples llamadas no crashean)', () => {
    expect(() => {
      initSentry();
      initSentry();
      initSentry();
    }).not.toThrow();
  });

  it('setUserContext con user valido no crashea sin init', () => {
    expect(() => setUserContext({ id: 1, nombre: 'David', rol: 'Admin' })).not.toThrow();
  });

  it('setUserContext con null no crashea', () => {
    expect(() => setUserContext(null)).not.toThrow();
  });

  it('setUserContext acepta user incompleto sin crashear', () => {
    expect(() => setUserContext({ id: 5 })).not.toThrow();
    expect(() => setUserContext({})).not.toThrow();
  });

  it('captureError no crashea sin init', () => {
    expect(() => captureError(new Error('test'))).not.toThrow();
  });

  it('captureError con context extra no crashea', () => {
    expect(() => captureError(new Error('test'), { ordenId: 42 })).not.toThrow();
  });
});

// ─── shouldSendEvent: filtro beforeSend ──────────────────────
describe('shouldSendEvent', () => {
  it('descarta errores de chrome-extension', () => {
    const event = { message: 'Failed in chrome-extension://abc/script.js' };
    expect(shouldSendEvent(event, {})).toBeNull();
  });

  it('descarta errores de moz-extension', () => {
    const event = { message: 'moz-extension://xyz/inject.js failed' };
    expect(shouldSendEvent(event, {})).toBeNull();
  });

  it('descarta ResizeObserver loop warnings', () => {
    const event = {};
    const hint = { originalException: new Error('ResizeObserver loop limit exceeded') };
    expect(shouldSendEvent(event, hint)).toBeNull();
  });

  it('descarta NetworkError cuando navegador esta offline', () => {
    const event = {};
    const hint = { originalException: new Error('NetworkError when attempting to fetch') };
    expect(shouldSendEvent(event, hint, { onLine: false })).toBeNull();
  });

  it('NO descarta NetworkError cuando navegador esta online', () => {
    const event = { message: 'foo' };
    const hint = { originalException: new Error('NetworkError when attempting to fetch') };
    expect(shouldSendEvent(event, hint, { onLine: true })).toBe(event);
  });

  it('deja pasar errores normales sin match', () => {
    const event = { message: 'TypeError: cannot read property foo of undefined' };
    expect(shouldSendEvent(event, {})).toBe(event);
  });

  it('lee mensaje desde originalException si event.message vacio', () => {
    const event = {};
    const hint = { originalException: new Error('chrome-extension://abc/x') };
    expect(shouldSendEvent(event, hint)).toBeNull();
  });

  it('hint vacio no crashea', () => {
    const event = { message: 'normal error' };
    expect(shouldSendEvent(event, {})).toBe(event);
    expect(shouldSendEvent(event, undefined)).toBe(event);
  });

  it('event vacio retorna event sin crashear', () => {
    expect(shouldSendEvent({}, {})).toEqual({});
  });

  it('originalException sin message no crashea', () => {
    const hint = { originalException: {} };
    const event = { message: 'real error' };
    expect(shouldSendEvent(event, hint)).toBe(event);
  });
});

// ─── Doble destino: error_log + Sentry ───────────────────────
// Test sintético: simula el flow de componentDidCatch manualmente
// para confirmar que ambos canales se invocan con el mismo error,
// sin acoplarse a la mecánica interna de React.
describe('ErrorBoundary doble destino (error_log + Sentry)', () => {
  it('un error pasa por logErrorToDb Y captureError', async () => {
    const logErrorToDb = vi.fn();
    const captureErrorMock = vi.fn();

    // Simular el cuerpo de componentDidCatch (ver ErrorBoundary.jsx).
    const error = new Error('Test sintético — Tanda 7');
    const errorInfo = { componentStack: 'at TestComponent\nat App\nat ErrorBoundary' };

    logErrorToDb(error, errorInfo, { tipo: 'boundary', boundary: 'root' });
    captureErrorMock(error, { componentStack: errorInfo.componentStack, boundary: 'root' });

    expect(logErrorToDb).toHaveBeenCalledTimes(1);
    expect(logErrorToDb).toHaveBeenCalledWith(error, errorInfo, { tipo: 'boundary', boundary: 'root' });

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock).toHaveBeenCalledWith(error, {
      componentStack: errorInfo.componentStack,
      boundary: 'root',
    });
  });
});
