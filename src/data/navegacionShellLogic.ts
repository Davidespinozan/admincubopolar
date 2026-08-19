// navegacionShellLogic.js — deep-linking del shell admin (Tanda 25).
//
// El shell navegaba solo con useState: sin URLs, sin botón atrás, sin
// poder mandar un link a "revisa Por cobrar". Esta lógica pura mapea
// hash ↔ vista (#/rutas ↔ 'rutas') y decide a qué módulo lleva cada
// notificación de la campana. El wiring con window vive en
// CuboPolarERP.jsx; aquí solo funciones testeables.

/**
 * Extrae el id de vista desde un hash de URL, validándolo contra los
 * ids reales del menú. Cualquier basura (#/loquesea, #foo, vacío)
 * devuelve null y el shell cae a 'dashboard'.
 *
 * @param {string} hash p.ej. '#/rutas'
 * @param {Iterable<string>} idsValidos ids de módulos del shell
 * @returns {string|null}
 */
export function viewDesdeHash(hash: string | null | undefined, idsValidos: Iterable<string>): string | null {
  const limpio = String(hash || '').replace(/^#\/?/, '').trim();
  if (!limpio) return null;
  const ids = idsValidos instanceof Set ? idsValidos : new Set(idsValidos || []);
  return ids.has(limpio) ? limpio : null;
}

/** Hash canónico para una vista: 'rutas' → '#/rutas'. */
export function hashDesdeView(view: string | null | undefined): string {
  return `#/${String(view || 'dashboard')}`;
}

/**
 * Módulo destino al tocar una notificación de la campana. Primero por
 * prefijo de `referencia` (los crons de Tanda 21 usan cron-cxc:/
 * cron-rutas:), luego por `tipo` (el catálogo de mig 027). null = la
 * notificación no navega (solo se marca leída).
 *
 * @param notif fila camelCase de notificaciones
 * @returns id de vista del shell
 */
export function moduloParaNotificacion(notif: { tipo?: string; referencia?: string } | null | undefined): string | null {
  if (!notif) return null;
  const ref = String(notif.referencia || '');
  if (ref.startsWith('cron-cxc:')) return 'cobros';
  if (ref.startsWith('cron-rutas:')) return 'rutas';
  switch (String(notif.tipo || '')) {
    case 'venta': return 'ordenes';
    case 'cobro': return 'cobros';
    case 'credito': return 'cobros';
    case 'factura': return 'facturacion';
    case 'complemento': return 'facturacion';
    case 'produccion': return 'produccion';
    case 'alerta': return 'bandeja';
    default: return null;
  }
}
