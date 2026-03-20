// finanzasLogic.js — lógica pura de análisis financiero
import { centavos } from '../utils/safe';

/**
 * Filtra movimientos contables por rango de fecha ISO (YYYY-MM-DD).
 * @param {Array<{fecha: string, tipo: string, monto: number, categoria: string}>} movs
 * @param {string} desde — fecha ISO inicio (inclusive)
 * @returns {Array}
 */
export function filtrarPorFecha(movs, desde) {
  return (movs || []).filter(m => (m.fecha || '') >= desde);
}

/**
 * Calcula estado de resultados simplificado para un período.
 *
 * @param {Array} ingresos  — movimientos tipo 'Ingreso' del período
 * @param {Array} egresos   — movimientos tipo 'Egreso' del período
 * @returns {{ ventas, costoDeVentas, utilidadBruta, gastosOp, utilidad }}
 */
export function calcEstadoResultados(ingresos = [], egresos = []) {
  const ventas = centavos(
    ingresos
      .filter(i => i.categoria === 'Ventas' || i.categoria === 'Cobranza')
      .reduce((sum, i) => sum + Number(i.monto || 0), 0)
  );

  const costoDeVentas = centavos(
    egresos
      .filter(e => e.categoria === 'Costo de Ventas')
      .reduce((sum, e) => sum + Number(e.monto || 0), 0)
  );

  const gastosOp = centavos(
    egresos
      .filter(e => e.categoria !== 'Costo de Ventas')
      .reduce((sum, e) => sum + Number(e.monto || 0), 0)
  );

  const utilidadBruta = centavos(ventas - costoDeVentas);
  const utilidad      = centavos(utilidadBruta - gastosOp);

  return { ventas, costoDeVentas, utilidadBruta, gastosOp, utilidad };
}

/**
 * Calcula posición financiera simplificada (liquidez).
 *
 * @param {number} efectivoHoy    — cobrado en efectivo hoy
 * @param {number} cxcPendiente   — cuentas por cobrar pendientes
 * @param {number} cxpPendiente   — cuentas por pagar pendientes
 * @returns {{ posicion, liquidezNeta }}
 */
export function calcPosicionFinanciera(efectivoHoy, cxcPendiente, cxpPendiente) {
  const posicion     = centavos(Number(efectivoHoy) + Number(cxcPendiente) - Number(cxpPendiente));
  const liquidezNeta = centavos(Number(efectivoHoy) - Number(cxpPendiente));
  return { posicion, liquidezNeta };
}

/**
 * Suma el monto cobrado en efectivo de una lista de pagos del día.
 * @param {Array<{fecha: string, monto: number, metodo_pago: string}>} pagos
 * @param {string} fechaHoy — YYYY-MM-DD
 * @returns {number}
 */
export function efectivoDelDia(pagos = [], fechaHoy) {
  return centavos(
    pagos
      .filter(p => p.fecha === fechaHoy &&
        (p.metodo_pago === 'Efectivo' || p.metodoPago === 'Efectivo'))
      .reduce((sum, p) => sum + Number(p.monto || 0), 0)
  );
}

/**
 * Suma saldo pendiente de cuentas no liquidadas.
 * @param {Array<{estatus: string, saldo_pendiente: number}>} cuentas
 * @returns {number}
 */
export function saldoPendienteTotal(cuentas = []) {
  return centavos(
    (cuentas || [])
      .filter(c => c.estatus !== 'Pagada')
      .reduce((sum, c) => sum + Number(c.saldo_pendiente || 0), 0)
  );
}
