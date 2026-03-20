// produccionLogic.js — lógica pura de producción de hielo
import { centavos } from '../utils/safe';

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
