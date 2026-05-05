// mejorasMenoresLogic.js — helpers puros de Tanda 6.
// Aislados aquí para que sean testeables sin Supabase ni React.

/**
 * Calcula el precio efectivo de un SKU para un cliente.
 *   1) Si hay un precio especial registrado para ese cliente+SKU → ese.
 *   2) Sino, el precio público del producto.
 *   3) Si nada existe → 0.
 *
 * Acepta tanto camelCase (clienteId) como snake_case (cliente_id) en
 * preciosEsp para tolerar ambas formas que se usan en el codebase.
 *
 * @param {string|number|null} clienteId
 * @param {string} sku
 * @param {Array} productos    — [{ sku, precio }]
 * @param {Array} preciosEsp   — [{ clienteId|cliente_id, sku, precio }]
 * @returns {number}
 */
export function precioParaCliente(clienteId, sku, productos = [], preciosEsp = []) {
  const skuStr = String(sku || '').trim();
  if (!skuStr) return 0;
  if (clienteId !== null && clienteId !== undefined && String(clienteId) !== '') {
    const cidStr = String(clienteId);
    const esp = preciosEsp.find(p =>
      String(p.clienteId ?? p.cliente_id ?? '') === cidStr && String(p.sku || '') === skuStr
    );
    if (esp) return Number(esp.precio) || 0;
  }
  const prod = productos.find(p => String(p.sku || '') === skuStr);
  return prod ? Number(prod.precio) || 0 : 0;
}

/**
 * Aplica los filtros de PreciosView a la lista de precios especiales.
 * `normalizeStr` se inyecta para que el helper sea autocontenido y los
 * tests no dependan del módulo utils/safe.
 *
 * @param {Object} params
 * @param {Array}  params.precios          — preciosEsp
 * @param {string} params.search           — texto libre (cliente o SKU)
 * @param {string} params.filterSku        — '' = todos
 * @param {string} params.filterClienteId  — '' = todos
 * @param {boolean} params.soloDescuentoMayor — solo descuentos > 10%
 * @param {Object}  params.precioBaseMap   — { sku: precioPublico }
 * @param {Function} [params.normalizeStr] — fn a aplicar a search/haystack
 * @returns {Array}
 */
export function filtrarPreciosEsp({
  precios = [],
  search = '',
  filterSku = '',
  filterClienteId = '',
  soloDescuentoMayor = false,
  precioBaseMap = {},
  normalizeStr = (x) => String(x || '').toLowerCase(),
}) {
  const q = normalizeStr(String(search || '').trim());
  return precios.filter(p => {
    if (filterSku && String(p.sku || '') !== filterSku) return false;
    if (filterClienteId && String(p.clienteId ?? p.cliente_id ?? '') !== filterClienteId) return false;
    if (q) {
      const haystack = `${normalizeStr(p.clienteNom || '')} ${normalizeStr(p.sku || '')}`;
      if (!haystack.includes(q)) return false;
    }
    if (soloDescuentoMayor) {
      const base = Number(precioBaseMap[p.sku] || 0);
      const desc = base > 0 ? ((base - Number(p.precio || 0)) / base) * 100 : 0;
      if (desc <= 10) return false;
    }
    return true;
  });
}

/**
 * Valida si un cobro está completo según el método de pago.
 * Tanda 6 🟢-4: Transferencia exige foto del comprobante.
 *
 * @param {Object} params
 * @param {string} params.metodoPago
 * @param {string|null} params.fotoTransf  — dataURL/URL truthy si hay foto
 * @returns {{ error: string }|null}
 */
export function validarCobroTransferencia({ metodoPago, fotoTransf }) {
  if (String(metodoPago || '') === 'Transferencia' && !fotoTransf) {
    return { error: 'Foto del comprobante obligatoria para transferencias' };
  }
  return null;
}

/**
 * Traduce un error Postgres 23505 sobre el índice de camión activo a
 * un mensaje amigable. Devuelve null si el error es de otra naturaleza.
 *
 * @param {Object|null} error  — { code, message }
 * @returns {string|null}
 */
export function traducirErrorCamionRutaActiva(error) {
  if (!error) return null;
  if (error.code !== '23505') return null;
  if (!/idx_camion_ruta_activa/i.test(String(error.message || ''))) return null;
  return 'Este camión ya está asignado a otra ruta activa';
}
