// stock.js — helpers puros para calcular stock disponible por SKU.
// Fuente de verdad: cuartos_frios.stock (JSONB).
// productos.stock es campo legacy y queda en 0 cuando se produce vía
// producirYCongelar standalone, así que NUNCA usarlo como fallback aquí.

/**
 * Suma el stock de todos los cuartos fríos por SKU.
 *
 * @param {Array} cuartosFrios — [{ stock: { sku: qty } }, ...]
 * @returns {Object<string, number>} — { sku: cantidadTotal }
 */
export function stockDisponiblePorSku(cuartosFrios) {
  const map = {};
  if (!Array.isArray(cuartosFrios)) return map;
  for (const cf of cuartosFrios) {
    const stock = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
    for (const [sku, qty] of Object.entries(stock)) {
      const num = Number(qty);
      if (!Number.isFinite(num)) continue;
      map[sku] = (map[sku] || 0) + num;
    }
  }
  return map;
}

/**
 * Stock disponible para EDITAR una orden existente.
 *
 * Si la orden ya descontó stock al crearse (flujo legacy o casos edge),
 * la cantidad original ya está fuera del cuarto. Para validar la nueva
 * cantidad, sumamos: lo que hay físicamente + lo que la orden estaba
 * "reservando".
 *
 * En flujo moderno donde Creada NO descuenta stock hasta firmar carga,
 * cantidadOriginal=0 (caller pasa 0) y devuelve igual que stockMap[sku].
 *
 * @param {Object<string, number>} stockMap         — output de stockDisponiblePorSku
 * @param {string} sku
 * @param {number} cantidadOriginal — cuánto tenía esta línea antes de editar
 * @returns {number}
 */
export function stockDisponibleParaEdicion(stockMap, sku, cantidadOriginal) {
  const enCuartos = Number(stockMap?.[sku] || 0);
  const original = Number(cantidadOriginal || 0);
  return enCuartos + original;
}