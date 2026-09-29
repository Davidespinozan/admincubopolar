// inventarioRutaLogic.js — lógica pura del inventario canónico de ruta
// (mig 087): balance del camión, lote de mermas de ruta con operación y
// finalización del inventario (conteo físico → devolución → ruta Cerrada).
//
// El servidor es la única autoridad: calcula el balance (cargado, entregado,
// merma, devuelto, restante), valida el conteo físico contra él, elige los
// cuartos de destino y cierra la ruta. El cliente solo muestra el balance,
// captura el conteo y conserva un operacion_id estable por operación lógica
// (mismo ciclo de vida que 076/084/086).

import { nuevoOperacionId, resolverOperacion } from './produccionAtomicaLogic.js';
import { buildMermasRutaPayload } from './mermasLogic.js';

export { nuevoOperacionId, resolverOperacion };

const txt = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const q = Number(v); return Number.isFinite(q) ? q : 0; };

// ── Persistencia de operaciones por ruta (sobreviven recargas) ───────
export const claveStorageMermasRuta = (rutaId) => `mermas_ruta_op_${txt(rutaId)}`;
export const claveStorageCierreInventario = (rutaId) => `cierre_inv_op_${txt(rutaId)}`;

export function leerOperacion(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    const op = JSON.parse(raw);
    return op && typeof op === 'object' && txt(op.id) && typeof op.clave === 'string' ? { id: txt(op.id), clave: op.clave } : null;
  } catch {
    return null;
  }
}
export function guardarOperacion(storage, key, op) {
  try { storage?.setItem?.(key, JSON.stringify({ id: op.id, clave: op.clave })); } catch { /* el UUID sigue en memoria */ }
}
export function borrarOperacion(storage, key) {
  try { storage?.removeItem?.(key); } catch { /* nada que borrar */ }
}

// ── Balance canónico ─────────────────────────────────────────────────
/** Filas de calcular_balance_ruta → arreglo numérico ordenado por SKU. */
export function interpretarBalance(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => ({
      sku: txt(r?.sku),
      cargado: num(r?.cargado),
      entregado: num(r?.entregado),
      merma: num(r?.merma),
      devuelto: num(r?.devuelto),
      restante: num(r?.restante),
    }))
    .filter(r => r.sku)
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Totales del balance para el pie de la tabla. */
export function totalesBalance(balance) {
  return (balance || []).reduce((t, r) => ({
    cargado: t.cargado + r.cargado, entregado: t.entregado + r.entregado, merma: t.merma + r.merma,
    devuelto: t.devuelto + r.devuelto, restante: t.restante + r.restante,
  }), { cargado: 0, entregado: 0, merma: 0, devuelto: 0, restante: 0 });
}

/** Conteo sugerido: lo que el servidor dice que queda en el camión. */
export function conteoInicial(balance) {
  const c = {};
  for (const r of balance || []) c[r.sku] = String(r.restante);
  return c;
}

/**
 * Conteo físico normalizado {sku: entero > 0}. Vacío o 0 se omite (el
 * servidor trata un SKU cargado ausente como 0).
 * @returns {{conteo:Object}|{error:string}}
 */
export function normalizarConteo(conteo) {
  const out = {};
  for (const [k, v] of Object.entries(conteo && typeof conteo === 'object' ? conteo : {})) {
    const sku = txt(k);
    const raw = txt(v);
    if (!sku) continue;
    if (raw === '') continue;
    if (!/^[0-9]+$/.test(raw)) return { error: `Cantidad inválida para ${sku}` };
    const q = Number(raw);
    if (q > 0) out[sku] = (out[sku] || 0) + q;
  }
  return { conteo: out };
}

/** Vista previa (no autoritativa) de faltantes/sobrantes contra el balance. */
export function diferenciasConteo(balance, conteo) {
  const faltante = {};
  const sobrante = {};
  const norm = normalizarConteo(conteo).conteo || {};
  const skus = new Set((balance || []).map(r => r.sku));
  for (const r of balance || []) {
    const q = norm[r.sku] || 0;
    if (q < r.restante) faltante[r.sku] = r.restante - q;
    if (q > r.restante) sobrante[r.sku] = q - r.restante;
  }
  for (const [sku, q] of Object.entries(norm)) if (!skus.has(sku)) sobrante[sku] = q;
  return { faltante, sobrante };
}

// ── Lote de mermas de ruta ───────────────────────────────────────────
function firmaFoto(f) {
  const s = txt(f);
  return s ? `${s.length}:${s.slice(0, 24)}:${s.slice(-24)}` : '';
}

/** Clave del lote: mismas mermas (sin importar el orden) ⇒ mismo UUID. */
export function claveMermasRuta(rutaId, mermas) {
  const items = buildMermasRutaPayload(mermas)
    .map(m => JSON.stringify({ sku: m.sku, cant: m.cant, causa: m.causa || '', foto: firmaFoto(m.foto) }))
    .sort();
  return `MERMASRUTA|${txt(rutaId)}|${items.join(';')}`;
}

/** Parámetros de registrar_mermas_ruta(p_operacion_id, p_ruta_id, p_mermas). */
export function buildMermasRutaArgs({ operacionId, rutaId, mermas } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(rutaId)) return { error: 'Ruta requerida' };
  const payload = buildMermasRutaPayload(mermas);
  if (payload.length === 0) return { error: 'No hay mermas que registrar' };
  for (const m of payload) {
    if (!m.sku) return { error: 'Cada merma necesita producto' };
    if (!Number.isInteger(m.cant) || m.cant <= 0) return { error: `Cantidad inválida para ${m.sku}` };
  }
  return { args: { p_operacion_id: txt(operacionId), p_ruta_id: Number(rutaId), p_mermas: payload } };
}

// ── Finalización del inventario ──────────────────────────────────────
export function claveCierreInventario(rutaId, conteoNormalizado) {
  const pares = Object.entries(conteoNormalizado || {}).filter(([, q]) => q > 0).map(([k, q]) => `${k}=${q}`).sort();
  return `CIERREINV|${txt(rutaId)}|${pares.join(';')}`;
}

/** Parámetros de finalizar_inventario_ruta(p_operacion_id, p_ruta_id, p_conteo). */
export function buildFinalizarInventarioArgs({ operacionId, rutaId, conteo } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(rutaId)) return { error: 'Ruta requerida' };
  const norm = normalizarConteo(conteo);
  if (norm.error) return { error: norm.error };
  return { args: { p_operacion_id: txt(operacionId), p_ruta_id: Number(rutaId), p_conteo: norm.conteo } };
}

/** {faltante} / {sobrante} estructurados del DETAIL de PostgREST. */
export function detalleErrorInventario(error) {
  const raw = typeof error === 'object' && error ? error.details : null;
  if (!raw) return {};
  try {
    const d = JSON.parse(raw);
    return {
      faltante: d && typeof d.faltante === 'object' ? d.faltante : undefined,
      sobrante: d && typeof d.sobrante === 'object' ? d.sobrante : undefined,
    };
  } catch {
    return {};
  }
}

const lista = (obj) => Object.entries(obj || {}).map(([sku, q]) => `${q}×${sku}`).join(', ');

/** Mensaje en español. Un error significa que el servidor no aplicó NADA. */
export function mensajeErrorInventarioRuta(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(typeof error === 'object' && error ? error.code : '');
  const det = detalleErrorInventario(error);
  if (det.faltante) return `Faltan ${lista(det.faltante)} según el sistema. Registra la merma del faltante (causa y foto) o vuelve a contar.`;
  if (det.sobrante || /supera el inventario del camión/i.test(msg)) {
    return det.sobrante ? `El conteo supera lo que debe traer el camión (${lista(det.sobrante)}). Vuelve a contar.` : 'La merma supera lo que queda en el camión.';
  }
  if (/no tiene cierre financiero/i.test(msg)) return 'Primero registra las ventas y cobros de la ruta.';
  if (/órdenes pendientes/i.test(msg)) return 'Hay órdenes sin resolver (entregar o marcar no entregada) antes de cerrar.';
  if (/ya tiene inventario finalizado/i.test(msg)) return 'Esta ruta ya se cerró con otro conteo. Pide a un administrador que revise.';
  if (/se requiere En progreso/i.test(msg)) return 'La ruta no está en curso.';
  if (/no tiene carga confirmada/i.test(msg)) return 'La ruta no tiene carga confirmada.';
  if (/Cargada o En progreso/i.test(msg)) return 'La ruta ya no admite mermas.';
  if (/balance_ruta:/i.test(msg)) return 'El inventario de la ruta no cuadra con lo registrado (producto no cargado o fuera de catálogo). Pide a un administrador que lo revise; no se aplicó ningún cambio.';
  if (/operacion_id ya usado/i.test(msg)) return 'Esta operación ya se registró con otros datos. Revisa antes de volver a intentar.';
  if (/SKU no encontrado/i.test(msg)) return 'Uno de los productos no existe.';
  if (/cantidad inválida/i.test(msg)) return 'Hay una cantidad inválida en el conteo.';
  if (/no pertenece/i.test(msg)) return 'La ruta no pertenece a este chofer.';
  if (/no autorizado/i.test(msg) || code === '42501') return 'No tienes permiso para esta operación.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión con el servidor. Reintenta: la operación no se duplicará.';
  return msg || 'No se pudo completar la operación. No se aplicó ningún cambio.';
}

/** Texto para el chofer tras marcar no entregada (087: el producto sigue en el camión). */
export function mensajeNoEntrega(reagendar) {
  return reagendar
    ? 'Marcada como no entregada (reagendar) — el producto sigue en el camión hasta el cierre'
    : 'Marcada como no entregada — el producto sigue en el camión hasta el cierre';
}
