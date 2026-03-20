// cobrosLogic.js — lógica pura de cobros / CxC
import { centavos } from '../utils/safe';

/**
 * Calcula el nuevo estado de una CxC tras aplicar un pago.
 *
 * @param {number} montoOriginal   — deuda total inicial
 * @param {number} montoPagadoAnt  — cuánto ya había sido pagado
 * @param {number} nuevoPago       — monto del pago actual
 * @returns {{ nuevoMontoPagado, nuevoSaldo, nuevoEstatus }}
 */
export function calcNuevaSaldoCxC(montoOriginal, montoPagadoAnt, nuevoPago) {
  const nuevoMontoPagado = centavos(Number(montoPagadoAnt) + Number(nuevoPago));
  const nuevoSaldo       = centavos(Number(montoOriginal) - nuevoMontoPagado);
  const nuevoEstatus =
    nuevoSaldo <= 0          ? 'Pagada'   :
    nuevoMontoPagado > 0     ? 'Parcial'  :
                               'Pendiente';
  return { nuevoMontoPagado, nuevoSaldo: Math.max(0, nuevoSaldo), nuevoEstatus };
}
