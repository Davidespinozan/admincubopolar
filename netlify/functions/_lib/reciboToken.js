// reciboToken.js — firma HMAC de los links públicos de nota (Tanda 28).
//
// El link /nota/:id?t=<token> es público (el cliente lo abre sin
// login), así que el token es lo único que protege la orden: HMAC-SHA256
// de la orden con RECIBO_SECRET, truncado a 32 hex. Sin el secret no se
// pueden ni generar ni verificar links (la function responde 501 —
// patrón seam: la feature se apaga limpia si falta la credencial).

import { createHmac, timingSafeEqual } from 'node:crypto';

export const getReciboSecret = () => process.env.RECIBO_SECRET || '';

/**
 * Token para una orden. Determinista: el mismo link sirve siempre
 * (reenviar la nota no invalida la anterior).
 * @param {string|number} ordenId
 * @param {string} secret
 * @returns {string} 32 hex chars
 */
export function firmarRecibo(ordenId, secret) {
  if (!secret) throw new Error('RECIBO_SECRET no configurado');
  return createHmac('sha256', secret).update(`recibo:${ordenId}`).digest('hex').slice(0, 32);
}

/**
 * Verificación en tiempo constante (evita timing attacks sobre el
 * token). Cualquier malformación → false, nunca throw.
 * @param {string|number} ordenId
 * @param {string} token
 * @param {string} secret
 * @returns {boolean}
 */
export function verificarRecibo(ordenId, token, secret) {
  try {
    if (!secret || !token) return false;
    const esperado = Buffer.from(firmarRecibo(ordenId, secret), 'utf8');
    const recibido = Buffer.from(String(token), 'utf8');
    if (esperado.length !== recibido.length) return false;
    return timingSafeEqual(esperado, recibido);
  } catch {
    return false;
  }
}
