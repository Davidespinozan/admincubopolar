// rutasLogic.js — lógica pura de rutas / cierre de ruta
import { centavos } from '../utils/safe';

/**
 * Estados terminales de una ruta. No se puede editar/cancelar/reasignar.
 * Mantener en sync con el ENUM `estatus_ruta` (mig 001/002 + 039).
 */
export const ESTADOS_TERMINALES_RUTA = new Set(['Cerrada', 'Cancelada', 'Completada']);

/**
 * Valida si una ruta puede editarse según su estatus actual.
 * Bloquea si está en estado terminal (cerrada, cancelada, completada) —
 * editar carga/chofer/camión a una ruta histórica corrompe los datos
 * del cierre y los reportes.
 *
 * @param {string} estatusActual
 * @returns {{ error: string }|null}
 */
export function validateEdicionRuta(estatusActual) {
  const est = String(estatusActual || '').trim();
  if (ESTADOS_TERMINALES_RUTA.has(est)) {
    return {
      error: 'No se puede editar una ruta cerrada, cancelada o completada',
    };
  }
  return null;
}

/**
 * Estados de una ruta donde la carga ya descontó stock de cuartos
 * (mig 047: confirmarCargaRuta y firmarCarga descuentan al pasar a
 * 'Cargada'/'Pendiente firma'/'En progreso'). Cancelar una ruta en
 * estos estados requiere devolver el stock al cuarto origen.
 */
const ESTADOS_CON_STOCK_FUERA = new Set(['Cargada', 'Pendiente firma', 'En progreso']);

/**
 * Valida si una ruta puede cancelarse y reporta si requiere devolver
 * stock al cuarto frío.
 *
 * @param {{ estatus: string }} ruta
 * @returns {{ error: string }|{ requiereDevolucion: boolean }}
 */
export function validateCancelacionRuta(ruta) {
  const est = String(ruta?.estatus || '').trim();
  if (!est) return { error: 'Ruta no encontrada' };
  if (ESTADOS_TERMINALES_RUTA.has(est)) {
    return { error: `Ruta ya está en estado terminal: ${est}` };
  }
  return { requiereDevolucion: ESTADOS_CON_STOCK_FUERA.has(est) };
}

/**
 * Convierte el objeto de devoluciones en texto legible para el log.
 * @param {Record<string, number>} devolucionObj — { "HC-5K": 3, "HC-25K": 0 }
 * @returns {string} — "3×HC-5K" | "0" si todo es 0
 */
export function formatDevolucion(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') return '0';
  const parts = Object.entries(devolucionObj)
    .filter(([, v]) => Number(v) > 0)
    .map(([sku, qty]) => `${qty}×${sku}`);
  return parts.length > 0 ? parts.join(', ') : '0';
}

/**
 * Valida que un objeto de devoluciones sea coherente:
 * - Todos los valores deben ser números >= 0
 * - Al menos un SKU reconocido (no vacío)
 * @param {Record<string, number>} devolucionObj
 * @returns {string|null} — mensaje de error o null si es válido
 */
export function validateDevolucion(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') {
    return 'Devolución debe ser un objeto';
  }
  for (const [sku, qty] of Object.entries(devolucionObj)) {
    if (!sku || typeof sku !== 'string') return 'SKU inválido en devolución';
    if (!Number.isFinite(Number(qty)) || Number(qty) < 0) {
      return `Cantidad inválida para ${sku}: ${qty}`;
    }
  }
  return null;
}

/**
 * Calcula el total de unidades devueltas al cuarto frío.
 * @param {Record<string, number>} devolucionObj
 * @returns {number}
 */
export function totalDevuelto(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') return 0;
  return Object.values(devolucionObj).reduce((sum, v) => sum + Number(v || 0), 0);
}

/**
 * Normaliza el argumento de devolución — acepta número legacy o objeto nuevo.
 * @param {number|Record<string, number>} devolucion
 * @returns {Record<string, number>}
 */
export function normalizeDevolucion(devolucion) {
  if (typeof devolucion === 'object' && devolucion !== null) return devolucion;
  return { bolsas: Number(devolucion) || 0 };
}

/**
 * Calcula totales de cobro de un reporte de cierre de ruta.
 * @param {Array<{monto: number, metodo_pago: string}>} cobros
 * @returns {{ totalEfectivo, totalTransferencia, totalCredito, totalCobrado }}
 */
export function calcTotalesCobro(cobros = []) {
  let totalEfectivo = 0;
  let totalTransferencia = 0;
  let totalCredito = 0;

  for (const c of cobros) {
    const monto = Number(c.monto || 0);
    const metodo = (c.metodo_pago || c.metodoPago || '').toLowerCase();
    if (metodo.includes('efectivo'))       totalEfectivo      = centavos(totalEfectivo + monto);
    else if (metodo.includes('transfer') || metodo.includes('spei')) totalTransferencia = centavos(totalTransferencia + monto);
    else if (metodo.includes('crédito') || metodo.includes('credito')) totalCredito = centavos(totalCredito + monto);
    else                                   totalEfectivo      = centavos(totalEfectivo + monto);
  }

  const totalCobrado = centavos(totalEfectivo + totalTransferencia + totalCredito);
  return { totalEfectivo, totalTransferencia, totalCredito, totalCobrado };
}

/** ¿La orden ya salió a la calle? (entregada o ya facturada). */
export const ordenEntregada = (o) => ['entregada', 'facturada'].includes(String(o?.estatus ?? '').trim().toLowerCase());

/**
 * Resumen económico de una ruta, calculado de SUS órdenes entregadas (incluye
 * la venta exprés, que al cierre ya es una orden de la ruta).
 * `rutas.total_cobrado` / `total_credito` dejaron de escribirse con el cierre
 * canónico (087): leerlas daba $0 aunque hubiera cobros. Solo se usan como
 * respaldo de rutas antiguas sin órdenes cargadas.
 * Crédito = método de pago o tipo de cobro "Crédito"; lo demás es cobrado.
 * @returns {{ cobrado: number, credito: number, total: number, entregas: number, porMetodo: Object<string, number> }}
 */
export function resumenEconomicoRuta(ruta, ordenes = []) {
  const propias = (ordenes || []).filter(o => ruta?.id != null && String(o.rutaId ?? o.ruta_id) === String(ruta.id) && ordenEntregada(o));
  let cobrado = 0;
  let credito = 0;
  const porMetodo = {};
  for (const o of propias) {
    const monto = Number(o.total) || 0;
    const metodo = String(o.metodoPago ?? o.metodo_pago ?? '').trim();
    const esCredito = /cr[eé]dito/i.test(metodo) || /^cr[eé]dito$/i.test(String(o.tipoCobro ?? o.tipo_cobro ?? '').trim());
    if (esCredito) credito = centavos(credito + monto);
    else cobrado = centavos(cobrado + monto);
    const clave = esCredito ? 'Crédito' : (metodo || 'Sin método');
    porMetodo[clave] = centavos((porMetodo[clave] || 0) + monto);
  }
  if (propias.length === 0) {
    cobrado = Number(ruta?.totalCobrado ?? ruta?.total_cobrado) || 0;
    credito = Number(ruta?.totalCredito ?? ruta?.total_credito) || 0;
  }
  return { cobrado, credito, total: centavos(cobrado + credito), entregas: propias.length, porMetodo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para confirmarCargaRuta / firmarCarga / solicitarFirmaCarga
//
// Estos helpers reflejan EXACTAMENTE el comportamiento actual del store.
// Si una validación parece floja (ej. permitir cargaReal {}) es a propósito:
// el código original lo permite y no se arregla aquí (fuera de scope de la
// fase Bloque 4 PR 4a).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida los argumentos de entrada de confirmarCargaRuta / solicitarFirmaCarga.
 * @param {string|number} rutaId
 * @param {Record<string, number>} cargaReal
 * @returns {{error: string} | null}
 */
export function validateConfirmarCarga(rutaId, cargaReal) {
  if (!rutaId) return { error: 'Datos de carga inválidos' };
  if (!cargaReal || typeof cargaReal !== 'object') return { error: 'Datos de carga inválidos' };
  return null;
}

/**
 * Valida los argumentos de entrada de firmarCarga.
 * Refleja los 3 checks actuales: rutaId, firma o motivoExcepcion, justificación.
 * @param {string|number} rutaId
 * @param {string|null} firmaBase64
 * @param {{excepcion?: boolean, motivoExcepcion?: string}} opciones
 * @returns {{error: string} | null}
 */
export function validateFirmarCarga(rutaId, firmaBase64, opciones = {}) {
  if (!rutaId) return { error: 'Sin ruta' };
  if (!firmaBase64 && !opciones?.excepcion) return { error: 'Sin firma' };
  if (opciones?.excepcion && !String(opciones?.motivoExcepcion || '').trim()) {
    return { error: 'Sin justificación' };
  }
  return null;
}


/**
 * Verifica si cargaReal excede la suma de carga_autorizada + extra_autorizado.
 * Devuelve el primer SKU que exceda (early return) o null si todo OK.
 * Refleja la lógica usada en confirmarCargaRuta y solicitarFirmaCarga.
 * @param {Record<string, number>} cargaReal
 * @param {Record<string, number>|null|undefined} autorizada
 * @param {Record<string, number>|null|undefined} extra
 * @returns {{ sku: string, max: number, qty: number } | null}
 */
export function excedeAutorizacion(cargaReal, autorizada, extra) {
  const aut = (autorizada && typeof autorizada === 'object') ? autorizada : {};
  const ext = (extra && typeof extra === 'object') ? extra : {};
  for (const [sku, qty] of Object.entries(cargaReal || {})) {
    const max = Number(aut[sku] || 0) + Number(ext[sku] || 0);
    const q = Number(qty);
    if (q > max) {
      return { sku, max, qty: q };
    }
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// Helpers para cerrarRutaCompleta
//
// Reflejan el comportamiento actual del store. agruparMermasPorSku NO se usa
// en el refactor del store (extraído como utility testeada para uso futuro
// si se decide mergear duplicados; hoy el código inserta una fila de mermas
// por cada item del array sin agrupar).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica las entregas según sean ventas express u órdenes existentes.
 * Refleja exactamente la regla de cerrarRutaCompleta:
 *   const esVentaExpress = Boolean(e?.express) || !e?.ordenId;
 *
 * @param {Array<object>|null|undefined} entregas
 * @returns {{ conOrden: object[], ventasExpress: object[] }}
 */
export function clasificarEntregas(entregas) {
  const conOrden = [];
  const ventasExpress = [];
  for (const e of (entregas || [])) {
    const esVentaExpress = Boolean(e?.express) || !e?.ordenId;
    if (esVentaExpress) ventasExpress.push(e);
    else conOrden.push(e);
  }
  return { conOrden, ventasExpress };
}

/**
 * Agrupa mermas por SKU sumando cantidades.
 *
 * NOTA: hoy cerrarRutaCompleta NO agrupa — registra cada merma individual
 * como una fila distinta en `mermas` table. Este helper es utility para
 * casos donde haga falta agregar (ej. cálculo de devolución legacy o
 * decisión futura de mergear). NO cambia el comportamiento del store.
 *
 * @param {Array<{sku, cant}>|null|undefined} mermas
 * @returns {Record<string, number>}
 */
export function agruparMermasPorSku(mermas) {
  const result = {};
  for (const m of (mermas || [])) {
    const sku = m?.sku;
    if (!sku) continue;
    const cant = Number(m?.cant);
    const safe = Number.isFinite(cant) ? cant : 0;
    result[sku] = (result[sku] || 0) + safe;
  }
  return result;
}

