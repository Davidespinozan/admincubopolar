// rutasLogic.js — lógica pura de rutas / cierre de ruta
import { centavos } from '../utils/safe';

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
