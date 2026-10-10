// cierreFinancieroLogic.js — lógica pura del cierre financiero de ruta
// (mig 086): una operación lógica = UN operacion_id estable, conservado
// entre timeouts, respuestas perdidas, recargas y reintentos, y borrado
// solo cuando el cierre completo confirmó.
//
// El servidor calcula su propia huella del payload (fin_huella_cierre). La
// clave del cliente solo decide si un reintento reutiliza el UUID: misma
// petición lógica → mismo UUID; otra petición → UUID nuevo. Si el cliente
// pierde el UUID, el servidor reconoce la misma petición por su huella.

import { nuevoOperacionId, resolverOperacion } from './produccionAtomicaLogic.js';

export { nuevoOperacionId, resolverOperacion };

const txt = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const q = Number(v); return Number.isFinite(q) ? q : 0; };

// El cierre de ruta solo acepta los nombres cortos. Si Administración cobró la orden desde
// Órdenes ("Transferencia SPEI", "Tarjeta (terminal)", "Crédito (fiado)"), ese texto volvía en
// el reporte del chofer y el servidor rechazaba TODO el cierre por "método de pago inválido".
const METODOS_CIERRE = { 'transferencia spei': 'Transferencia', 'tarjeta (terminal)': 'Tarjeta', 'crédito (fiado)': 'Crédito', 'credito (fiado)': 'Crédito' };
export function metodoDeCierre(pago) {
  const t = txt(pago);
  return METODOS_CIERRE[t.toLowerCase()] || t || null;
}

/** Payload de entregas exactamente como lo consume cerrar_ruta_financiero. */
export function normalizarEntregasCierre(entregas) {
  return (Array.isArray(entregas) ? entregas : []).map(e => ({
    ordenId: e?.ordenId || null,
    express: Boolean(e?.express) || !e?.ordenId,
    pago: metodoDeCierre(e?.pago),
    referencia: txt(e?.referencia) || null,
    clienteId: e?.clienteId || null,
    cliente: txt(e?.cliente) || null,
    factura: e?.factura === true,
    items: (e?.items || []).map(it => ({
      sku: txt(it?.sku),
      cant: num(it?.cant ?? it?.qty),
      precio: num(it?.precio),
    })),
  }));
}

/**
 * Clave estable de la petición lógica (espejo de fin_huella_cierre): ruta +
 * entradas normalizadas y ordenadas; ignora el orden de entradas/llaves y la
 * atribución (usuario). Misma clave ⇒ mismo UUID en el reintento.
 */
export function claveCierreFinanciero(rutaId, entregasPayload) {
  const entradas = (Array.isArray(entregasPayload) ? entregasPayload : []).map(e => {
    if (!e?.express && e?.ordenId) {
      return { t: 'o', orden: Number(e.ordenId), pago: txt(e.pago) || null, ref: txt(e.referencia) || null };
    }
    const items = (e?.items || [])
      .map(it => ({ sku: txt(it?.sku), cant: num(it?.cant ?? it?.qty), precio: Math.round(num(it?.precio) * 100) / 100 }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.cant - b.cant || a.precio - b.precio);
    return {
      t: 'x',
      cliente_id: e?.clienteId ? Number(e.clienteId) : null,
      cliente: txt(e?.cliente) || null,
      factura: e?.factura === true,
      pago: metodoDeCierre(e?.pago),
      ref: txt(e?.referencia) || null,
      items,
    };
  }).map(n => JSON.stringify(n)).sort();
  return `CIERREFIN|${txt(rutaId)}|${entradas.join(';')}`;
}

/**
 * Parámetros de cerrar_ruta_financiero (nombres exactos de la RPC).
 * @returns {{args:Object}|{error:string}}
 */
export function buildCerrarFinancieroArgs({ operacionId, rutaId, entregas, usuarioId, usuarioNombre } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(rutaId)) return { error: 'Ruta requerida para el cierre financiero' };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_ruta_id: Number(rutaId),
      p_entregas: Array.isArray(entregas) ? entregas : [],
      p_usuario_id: usuarioId ?? null,
      p_usuario_nombre: txt(usuarioNombre) || null,
    },
  };
}

/** Resultado del contrato; replay=true cuando el servidor devolvió el resultado almacenado. */
export function interpretarCierreFinanciero(data) {
  const r = data && typeof data === 'object' ? data : {};
  return { ok: true, ...r, replay: r.replay === true, saltadas: Array.isArray(r.saltadas) ? r.saltadas : [] };
}

/** Mensaje en español. Un error significa que el servidor no aplicó NADA. */
export function mensajeErrorCierreFinanciero(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(typeof error === 'object' && error ? error.code : '');
  if (/operacion_id ya usado en la ruta/i.test(msg)) return 'Esta operación pertenece a otra ruta. Recarga la aplicación e intenta de nuevo.';
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Este cierre ya se registró con otros datos. Revisa el reporte antes de volver a intentar.';
  if (/ya tiene cierre financiero registrado con otros datos/i.test(msg)) return 'La ruta ya tiene un cierre financiero con otras entregas. Pide a un administrador que revise el reporte.';
  if (/no pertenece a este chofer/i.test(msg)) return 'La ruta no pertenece a este chofer.';
  if (/ya está (Cerrada|Cancelada)/i.test(msg)) return 'La ruta ya está cerrada.';
  if (/no puede cerrarse como entregada/i.test(msg)) return 'Una de las órdenes ya no puede marcarse como entregada. No se registró nada.';
  if (/operacion_id es obligatorio/i.test(msg)) return 'Falta el identificador de la operación.';
  if (/no autorizado/i.test(msg) || code === '42501') return 'No tienes permiso para cerrar esta ruta.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión con el servidor. Reintenta: el cierre no se duplicará.';
  return msg || 'No se pudo registrar el cierre financiero. No se aplicó ningún cambio.';
}

// ── Persistencia del operacion_id del cierre (sobrevive recargas) ────
export const claveStorageCierre = (rutaId) => `cierre_fin_op_${txt(rutaId)}`;

export function leerOperacionCierre(storage, rutaId) {
  try {
    const raw = storage?.getItem?.(claveStorageCierre(rutaId));
    if (!raw) return null;
    const op = JSON.parse(raw);
    return op && typeof op === 'object' && txt(op.id) && typeof op.clave === 'string' ? { id: txt(op.id), clave: op.clave } : null;
  } catch {
    return null;
  }
}

export function guardarOperacionCierre(storage, rutaId, op) {
  try { storage?.setItem?.(claveStorageCierre(rutaId), JSON.stringify({ id: op.id, clave: op.clave })); } catch { /* sin espacio: el UUID sigue en memoria */ }
}

export function borrarOperacionCierre(storage, rutaId) {
  try { storage?.removeItem?.(claveStorageCierre(rutaId)); } catch { /* nada que borrar */ }
}
