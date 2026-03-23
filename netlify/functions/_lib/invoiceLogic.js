// invoiceLogic.js — lógica pura de facturación CFDI / Facturama
// Sin dependencias de red — testeable de forma unitaria.

export const PAYMENT_FORM_MAP = {
  'Efectivo':          '01',
  'Transferencia':     '03',
  'Transferencia SPEI':'03',
  'Tarjeta':           '04',
  'Tarjeta (terminal)':'04',
  'QR / Link de pago': '99',
  'Crédito':           '99',
  'Crédito (fiado)':   '99',
};

export const PAYMENT_METHOD_MAP = {
  'Crédito':       'PPD',
  'Crédito (fiado)':'PPD',
};

export const REGIME_CODE_MAP = {
  'Régimen General':                              '601',
  'General de Ley Personas Morales':              '601',
  'Personas Físicas con Actividades Empresariales':'612',
  'Régimen Simplificado de Confianza':            '626',
  'Sueldos y Salarios':                           '605',
  'Incorporación Fiscal':                         '621',
};

const GENERIC_RFCS = new Set(['XAXX010101000', 'XEXX010101000']);

/**
 * Valida si un RFC es real (no genérico ni mal formado).
 * @param {string} rfc
 * @returns {boolean}
 */
export function isValidRfc(rfc) {
  if (!rfc) return false;
  const upper = rfc.toUpperCase().trim();
  if (GENERIC_RFCS.has(upper)) return false;
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(upper);
}

/**
 * Resuelve el código SAT de régimen fiscal.
 * @param {string} rawRegime
 * @returns {string} — código de 3 dígitos
 */
export function resolveRegimeCode(rawRegime) {
  if (!rawRegime) return '616';
  const mapped = REGIME_CODE_MAP[rawRegime];
  if (mapped) return mapped;
  if (/^\d{3}$/.test(rawRegime)) return rawRegime; // ya es código
  return '616'; // público en general fallback
}

/**
 * Determina si una venta es PPD (pago en parcialidades diferidas).
 * @param {string} metodoPago
 * @returns {boolean}
 */
export function isPPD(metodoPago) {
  return (PAYMENT_METHOD_MAP[metodoPago] || 'PUE') === 'PPD';
}

/**
 * Calcula el IVA de un subtotal.
 * Hielo y agua no gasificada: tasa 0% (Art. 2-A LIVA).
 * @param {number} subtotal — precio sin impuesto
 * @returns {number}
 */
export function calcIVA(subtotal) {
  return 0; // Hielo: IVA tasa 0%
}

/**
 * Construye un item de CFDI a partir de una línea de orden.
 * @param {{ sku, cantidad, precio_unit, subtotal, nombre_producto }} linea
 * @param {Record<string, {code: string, name: string}>} catalog
 * @returns {object} — item para el CFDI de Facturama
 */
export function buildCfdiItem(linea, catalog = {}) {
  const unitPrice = Number(linea.precio_unit || 0);
  const quantity  = Number(linea.cantidad || 0);
  const subtotal  = Number(linea.subtotal || unitPrice * quantity);
  const taxAmount = calcIVA(subtotal);
  const cat       = catalog[linea.sku] || {};

  return {
    ProductCode:          cat.code || '50202302',
    IdentificationNumber: linea.sku,
    Description:          linea.nombre_producto || cat.name || linea.sku,
    Unit:                 'Pieza',
    UnitCode:             'H87',
    UnitPrice:            unitPrice,
    Quantity:             quantity,
    Subtotal:             subtotal,
    TaxObject:            '02',
    Taxes: [{
      Name:        'IVA',
      Rate:        0.0,
      Total:       0,
      Base:        subtotal,
      IsRetention: false,
    }],
    Total: subtotal, // IVA tasa 0% — total = subtotal
  };
}
