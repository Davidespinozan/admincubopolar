// produccionLogic.js — lógica pura de producción de hielo
import { centavos } from '../utils/safe';

/**
 * Whitelist de campos editables en updateProduccion. SKU NO está incluido:
 * cambiar el SKU requeriría revertir stock y volverse a registrar — es más
 * seguro forzar al admin a Eliminar (con reverso) y crear nueva.
 *
 * @param {Object} fields — payload del UI
 * @returns {Object|null} — objeto a UPDATE en BD, o null si no hay nada que
 *                          actualizar (UI debe rechazar).
 */
export function buildUpdateFieldsProduccion(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const allowed = ['turno', 'maquina', 'cantidad', 'estatus'];
  const upd = {};
  for (const k of allowed) {
    if (fields[k] !== undefined) upd[k] = fields[k];
  }
  if (upd.cantidad !== undefined) upd.cantidad = Number(upd.cantidad);
  return Object.keys(upd).length === 0 ? null : upd;
}

/**
 * Calcula la distribución FIFO inverso para revertir el stock de una
 * producción al eliminarla. Reparte el descuento entre los cuartos fríos
 * que tengan stock disponible del SKU, en orden de id (los primeros se
 * descuentan primero).
 *
 * @param {Object} prod          — { sku, cantidad, folio } de la producción
 * @param {Array}  cuartos       — [{ id, stock: { sku: qty } }, ...] activos
 * @param {string} usuario       — nombre quien ejecuta el reverso (para audit)
 * @returns {{ changes: Array, faltante: number }}
 *          changes: lista para `update_stocks_atomic` con delta negativo
 *          faltante: unidades sin cubrir (>0 → no se puede revertir todo)
 */
export function calcReversoChangesProduccion(prod, cuartos, usuario) {
  const sku = String(prod?.sku || '');
  const cant = Number(prod?.cantidad || 0);
  const folio = String(prod?.folio || '');
  const user = String(usuario || 'Admin');

  if (!sku || cant <= 0) return { changes: [], faltante: cant > 0 ? cant : 0 };

  const changes = [];
  let remaining = cant;
  for (const cf of (cuartos || [])) {
    if (remaining <= 0) break;
    const available = Number((cf?.stock || {})[sku] || 0);
    if (available > 0) {
      const toTake = Math.min(available, remaining);
      remaining -= toTake;
      changes.push({
        cuarto_id: cf.id,
        sku,
        delta: -toTake,
        tipo: 'Reverso producción',
        origen: `Reverso ${folio || 'producción'}`,
        usuario: user,
      });
    }
  }
  return { changes, faltante: remaining };
}

/**
 * Calcula el costo total de una corrida de producción.
 *
 * @param {number} cantidad      — bolsas producidas
 * @param {number} costoUnitario — costo por bolsa de empaque
 * @returns {number}             — costo total redondeado a centavos
 */
export function calcCostoProduccion(cantidad, costoUnitario) {
  const cant = Number(cantidad  || 0);
  const cost = Number(costoUnitario || 0);
  if (cant <= 0 || cost < 0) return 0;
  return centavos(cant * cost);
}

/**
 * Construye el concepto textual para el registro contable.
 *
 * @param {string} folio       — folio de la corrida (e.g. "PROD-0012")
 * @param {string|number} id   — ID de la corrida (fallback)
 * @param {number} cantidad
 * @param {string} sku         — SKU del producto terminado
 * @param {string} empaqueSku  — SKU del empaque consumido
 * @returns {string}
 */
export function buildConceptoProduccion(folio, id, cantidad, sku, empaqueSku) {
  const ref = folio || id;
  return `Producción ${ref}: ${cantidad}× ${sku} (empaque: ${empaqueSku})`;
}
