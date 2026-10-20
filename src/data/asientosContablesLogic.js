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

/**
 * 156: ids de los asientos LIGADOS a otro registro (pago a proveedor, nómina pagada, devolución, costo aplicado). El servidor
 * ya no deja editarlos ni borrarlos por la API (movimiento_ligado); la UI los muestra como "Sistema".
 */
export function idsAsientosLigados(data = {}) {
  const ids = new Set();
  const add = (v) => { if (v != null && v !== '') ids.add(String(v)); };
  for (const p of data.pagosProveedores || []) add(p.movimientoId ?? p.movimiento_id);
  for (const p of data.nominaPeriodos || []) add(p.movimientoId ?? p.movimiento_id);
  for (const d of data.devoluciones || []) add(d.egresoId ?? d.egreso_id);
  for (const c of data.costosHistorial || []) add(c.movimientoId ?? c.movimiento_id);
  return ids;
}

/** ¿El asiento lo generó o lo usa otro registro? (contrato por referencia, o ligado por llave). */
export function esAsientoProtegido(m, ligados) {
  return esAsientoDeContrato(m) || (!!m && !!ligados && ligados.has(String(m.id)));
}
