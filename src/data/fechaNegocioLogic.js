// fechaNegocioLogic.js — 098: escritores de "hoy" con el día de negocio del
// servidor. Lógica pura (sin Supabase); tests en
// src/__tests__/fechaNegocioEscritores.test.js.
//
// Regla: si la fecha significa "el día de negocio en que ocurre esta
// operación", el navegador NO la manda — la pone el servidor con fin_hoy()
// (America/Mazatlan), sea por el contrato o por el default de la columna.
// Si el usuario eligió la fecha (costo fijo, gasto, emisión de una CxP,
// asiento manual), se conserva y se valida como DATE.
import { centavos } from '../utils/safe';
import { partesFecha } from '../utils/fechas';

const txt = (v) => (v == null ? '' : String(v)).trim();

/**
 * Fecha elegida por el usuario.
 *   - vacía/ausente → { fecha: null } (la decide el servidor: fin_hoy())
 *   - 'YYYY-MM-DD' de calendario real → { fecha }
 *   - cualquier otra cosa → { error }
 * @returns {{fecha: string|null}|{error: string}}
 */
export function fechaElegida(v) {
  const f = txt(v);
  if (!f) return { fecha: null };
  const p = partesFecha(f);
  if (!p) return { error: 'Fecha inválida' };
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (d.getUTCFullYear() !== p.y || d.getUTCMonth() !== p.m - 1 || d.getUTCDate() !== p.d) return { error: 'Fecha inválida' };
  return { fecha: f };
}

/**
 * Campos de fecha de un costo (fijo o variable): con fecha elegida, fecha y
 * periodo de esa fecha; sin fecha, nada (el servidor pone fin_hoy() y deriva
 * el periodo).
 */
export function camposFechaCosto(fecha) {
  return fecha ? { fecha, periodo: fecha.slice(0, 7) } : {};
}

/** Clave estable de un abono a CxP (mismo intento → mismo UUID). */
export function claveAbonoCxP({ cxpId, monto, metodoPago, referencia } = {}) {
  return ['cxp', String(cxpId ?? ''), centavos(Number(monto || 0)), txt(metodoPago), txt(referencia)].join('|');
}

/**
 * Parámetros de pagar_cuenta_por_pagar (sin fecha: la pone el servidor).
 * @returns {{args: Object}|{error: string}}
 */
export function buildPagarCxPArgs({ operacionId, cxpId, monto, metodoPago, referencia } = {}) {
  if (!operacionId) return { error: 'Falta el identificador de la operación' };
  const id = Number(cxpId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Cuenta por pagar inválida' };
  const m = centavos(Number(monto));
  if (!Number.isFinite(m) || m <= 0) return { error: 'Monto inválido' };
  return {
    args: {
      p_operacion_id: operacionId,
      p_cxp_id: id,
      p_monto: m,
      p_metodo_pago: txt(metodoPago) || 'Transferencia',
      p_referencia: txt(referencia),
    },
  };
}
