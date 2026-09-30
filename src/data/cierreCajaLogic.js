// cierreCajaLogic.js — lógica pura de cortes de caja por ruta.
// Sin Supabase: tests viven en src/__tests__/cierreCaja.test.js.
import { centavos } from '../utils/safe';

// Métodos de pago que agrupamos como "Transferencia" en el cierre.
// Decisión: 3 cubos (Efectivo / Transferencia / Crédito). Tarjeta y
// QR/Link de pago son no-efectivo no-crédito → suman en transferencia.
const METODOS_TRANSFERENCIA = ['Transferencia', 'Tarjeta', 'QR / Link de pago'];

/**
 * Clasifica un método de pago en uno de los 3 cubos del cierre.
 * @param {string} metodo
 * @returns {'efectivo'|'transferencia'|'credito'|'otro'}
 */
export function clasificarMetodo(metodo) {
  const m = String(metodo || '').trim();
  if (m === 'Efectivo') return 'efectivo';
  if (m === 'Crédito' || m.toLowerCase() === 'credito' || m.toLowerCase() === 'fiado') return 'credito';
  if (METODOS_TRANSFERENCIA.includes(m)) return 'transferencia';
  // Default conservador: cualquier otro método se considera transferencia
  // (mejor cubrir un pago electrónico desconocido que perderlo).
  return 'transferencia';
}

/**
 * Agrupa los pagos de una ruta en los 3 cubos esperados.
 *
 * @param {Array} pagosDeRuta — [{ monto, metodo_pago | metodoPago, ... }]
 *                              Ya filtrados por orden_id IN (ordenes de la ruta).
 * @returns {{ efectivo: number, transferencia: number, credito: number, total: number }}
 */
export function calcularEsperadoPorRuta(pagosDeRuta) {
  const out = { efectivo: 0, transferencia: 0, credito: 0, total: 0 };
  if (!Array.isArray(pagosDeRuta)) return out;

  for (const p of pagosDeRuta) {
    const monto = Number(p?.monto || 0);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const metodo = String(p?.metodo_pago || p?.metodoPago || '');
    const cubo = clasificarMetodo(metodo);
    if (cubo === 'efectivo') out.efectivo += monto;
    else if (cubo === 'transferencia') out.transferencia += monto;
    else if (cubo === 'credito') out.credito += monto;
  }
  out.efectivo = centavos(out.efectivo);
  out.transferencia = centavos(out.transferencia);
  out.credito = centavos(out.credito);
  out.total = centavos(out.efectivo + out.transferencia + out.credito);
  return out;
}

// 096: el snapshot de pagos, el esperado autoritativo, la fecha de la caja y
// el actor los calcula el servidor (cerrar_caja_ruta). Este módulo solo da la
// vista previa y la validación de captura en el navegador.

/**
 * Valida los datos capturados de un cierre.
 *
 * Reglas:
 *   - contado_efectivo y contado_transferencia >= 0
 *   - Si abs(diferencia) > 0, motivo_diferencia obligatorio (no vacío)
 *   - Si abs(diferencia) > 100, motivo_diferencia debe ser >= 10 caracteres
 *
 * @param {Object} params
 * @param {{ efectivo: number, transferencia: number }} params.esperado
 * @param {{ efectivo: number, transferencia: number }} params.contado
 * @param {string} params.motivoDiferencia
 * @returns {{ error: string }|null}
 */
export function validateCierre({ esperado, contado, motivoDiferencia }) {
  const e = esperado || {};
  const c = contado || {};
  const cef = Number(c.efectivo || 0);
  const ctr = Number(c.transferencia || 0);
  if (!Number.isFinite(cef) || cef < 0) return { error: 'Efectivo contado inválido' };
  if (!Number.isFinite(ctr) || ctr < 0) return { error: 'Transferencia contada inválida' };

  const esperadoNoCredito = Number(e.efectivo || 0) + Number(e.transferencia || 0);
  const contadoTotal = cef + ctr;
  const diferencia = centavos(contadoTotal - esperadoNoCredito);
  const motivo = String(motivoDiferencia || '').trim();

  if (Math.abs(diferencia) > 0 && !motivo) {
    return { error: 'Motivo requerido cuando hay diferencia' };
  }
  if (Math.abs(diferencia) > 100 && motivo.length < 10) {
    return { error: 'Diferencia mayor a $100 requiere motivo de al menos 10 caracteres' };
  }

  return null;
}

/**
 * Calcula la diferencia entre contado y esperado (sin crédito).
 * Positivo = sobrante; negativo = faltante; 0 = cuadrado.
 */
export function calcDiferencia(esperado, contado) {
  const e = Number(esperado?.efectivo || 0) + Number(esperado?.transferencia || 0);
  const c = Number(contado?.efectivo || 0) + Number(contado?.transferencia || 0);
  return centavos(c - e);
}

/**
 * 096: clave lógica de un intento de cierre de caja (para conservar el UUID
 * de la operación entre reintentos con los mismos datos).
 */
export function claveCierreCaja({ rutaId, contadoEfectivo, contadoTransferencia, motivoDiferencia, notas }) {
  return ['caja', String(rutaId ?? ''), centavos(Number(contadoEfectivo || 0)), centavos(Number(contadoTransferencia || 0)),
    String(motivoDiferencia || '').trim(), String(notas || '').trim()].join('|');
}

/**
 * Devuelve un descriptor visual para mostrar la diferencia en UI.
 *
 * @param {number} diferencia
 * @returns {{ label: string, color: 'verde'|'azul'|'rojo', signo: '+'|'-'|'' }}
 */
export function formatDiferencia(diferencia) {
  const d = Number(diferencia || 0);
  if (d === 0) return { label: 'Cuadrado', color: 'verde', signo: '' };
  if (d > 0)  return { label: `Sobrante $${centavos(d).toLocaleString('es-MX')}`, color: 'azul', signo: '+' };
  return { label: `Faltante $${centavos(-d).toLocaleString('es-MX')}`, color: 'rojo', signo: '-' };
}

// 096: fechaCierreDesdeRuta se retiró. La fecha de la caja la deriva el
// servidor de rutas.fecha_fin (DATE de negocio, sin conversión de zona).
