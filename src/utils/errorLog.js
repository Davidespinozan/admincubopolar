// Helper compartido para enviar errores a la tabla error_log de Supabase.
// Usado por ErrorBoundary (root) y ChunkErrorBoundary (CuboPolarERP).
// Fire-and-forget: si el insert falla, se silencia (evitar loops).

import { supabase } from '../lib/supabase';

/**
 * @param {Error|object} error  Error con .message y .stack, o string
 * @param {object|null}   info  React errorInfo con .componentStack, o null
 * @param {object}        context  { tipo?, boundary?, view? } — metadata extra
 */
export function logErrorToDb(error, info, context = {}) {
  if (!supabase) return;
  const tipo = context?.tipo || 'boundary';
  const mensaje = String(error?.message || error || '').slice(0, 2000);
  const stack = String(error?.stack || '').slice(0, 5000);
  const componente = info?.componentStack?.slice(0, 500)
    || context?.boundary
    || context?.view
    || null;
  const url = typeof window !== 'undefined' ? window.location.href : null;

  supabase.from('error_log').insert({
    tipo,
    mensaje,
    stack,
    componente,
    url,
  }).then(() => {}).catch(() => {});
}

// Listeners globales para errores fuera del árbol React.
// Se registran una sola vez al cargar el módulo (mismo patrón que ErrorBoundary
// original — el módulo solo se importa desde boundaries, así que no hay riesgo
// de doble registro).
if (typeof window !== 'undefined' && !window.__errorLogListenersAttached) {
  window.__errorLogListenersAttached = true;

  // Errores de Supabase dispatched por safeRows
  window.addEventListener('supabase-error', (e) => {
    const { operation, error, code } = e.detail || {};
    logErrorToDb(
      { message: `${operation}: ${error}`, stack: `code: ${code}` },
      null,
      { tipo: 'supabase' }
    );
  });

  // Promesas rechazadas no manejadas
  window.addEventListener('unhandledrejection', (e) => {
    logErrorToDb(
      { message: e.reason?.message || String(e.reason), stack: e.reason?.stack },
      null,
      { tipo: 'unhandled' }
    );
  });
}
