// alcancePagosLogic.js — OL-02C.1: qué pagos ve un vendedor (Ventas) en su
// alcance del cliente (scopedData de App.jsx).
//
// pagos.usuario_id = QUIÉN REGISTRÓ el pago (procedencia): el actor del
// contrato, el chofer o Admin en cierres de ruta, o NULL cuando lo registra
// el webhook del proveedor del link (service role). El dueño comercial del
// pago es la ORDEN: pagos.orden_id → ordenes.vendedor_id.
//
// Un vendedor conserva un pago si:
//   A. ya coincidía con la regla existente (lo registró él: matchOwner), o
//   B. su orden_id pertenece a una de las órdenes propias del vendedor (las que
//      el mismo scopedData ya le asignó).
// Así el pago del webhook, de Admin o del chofer sobre SU orden cuenta para
// saber si esa orden está pagada, sin reasignar quién lo registró y sin abrir
// pagos de otras órdenes. No muta los pagos. No es una regla de la base de
// datos (la política de lectura de pagos es otro tema: backlog de seguridad).

const idTexto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Conjunto de ids (texto) de las órdenes propias; ignora ids vacíos. */
export function idsDeOrdenes(ordenes) {
  const set = new Set();
  for (const o of Array.isArray(ordenes) ? ordenes : []) {
    const id = idTexto(o?.id);
    if (id) set.add(id);
  }
  return set;
}

/**
 * Pagos visibles para el vendedor.
 * @param {Array} pagos           pagos cargados (camelCase: ordenId; también acepta orden_id)
 * @param {Array} ordenesPropias  órdenes que el alcance del vendedor ya le asignó
 * @param {(pago) => boolean} coincideRegistro  regla existente (matchOwner del vendedor)
 */
export function pagosVisiblesVendedor(pagos, ordenesPropias, coincideRegistro) {
  const propias = idsDeOrdenes(ordenesPropias);
  const regla = typeof coincideRegistro === 'function' ? coincideRegistro : () => false;
  return (Array.isArray(pagos) ? pagos : []).filter(p => {
    if (!p || typeof p !== 'object') return false;
    if (regla(p)) return true;
    const oid = idTexto(p.ordenId ?? p.orden_id);
    return oid !== '' && propias.has(oid);
  });
}
