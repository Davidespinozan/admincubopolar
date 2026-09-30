// asientosContablesLogic.js — 090 (B4): qué asientos de movimientos_contables
// generó un contrato del servidor. Espejo exacto de b4_asiento_de_contrato():
// esos asientos son inmutables para cualquier JWT (incluido Admin), así que la
// UI no ofrece editarlos ni borrarlos. Los asientos manuales siguen editables.

const PREFIJOS_CONTRATO = /^(MERMA-|PROD-|recepcion_compra\/)/;
const CATEGORIAS_ORDEN = new Set(['Ventas', 'Cobranza']);

export function esAsientoDeContrato(m) {
  if (!m) return false;
  const referencia = typeof m.referencia === 'string' ? m.referencia : '';
  if (PREFIJOS_CONTRATO.test(referencia)) return true;
  const ordenId = m.ordenId ?? m.orden_id ?? null;
  const tipo = m.tipo ?? m._tipo;
  return ordenId != null && tipo === 'Ingreso' && CATEGORIAS_ORDEN.has(m.categoria);
}
