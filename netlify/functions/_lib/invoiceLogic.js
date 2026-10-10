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
 * Detecta si el RFC es el genérico SAT para extranjero sin RFC mexicano.
 * Tanda 4 🔴-8: el SAT NO permite confundir XEXX con XAXX. Cliente
 * extranjero debe timbrar con XEXX010101000 + Name='PUBLICO EN GENERAL
 * EXTRANJERO'; cliente nacional sin RFC con XAXX010101000.
 */
export function isRfcExtranjero(rfc) {
  if (!rfc) return false;
  return String(rfc).toUpperCase().trim() === 'XEXX010101000';
}

/**
 * Detecta si el RFC es el genérico SAT para público en general (nacional
 * sin RFC).
 */
export function isRfcPublicoGeneral(rfc) {
  if (!rfc) return false;
  return String(rfc).toUpperCase().trim() === 'XAXX010101000';
}

/**
 * Construye el shape del Receiver del CFDI según el tipo de RFC.
 * Centraliza la decisión nacional vs extranjero vs nominativo.
 *
 *   - XEXX → cliente extranjero: Name fijo, CfdiUse='S01', Régimen 616
 *   - XAXX → público general nacional: Name fijo, CfdiUse='S01', Régimen 616
 *   - RFC nominativo válido → datos del cliente, fallbacks razonables
 *   - RFC inválido → tratado como público general nacional (XAXX)
 *
 * @param {Object} cliente - { rfc, nombre, regimen, uso_cfdi, cp, correo }
 * @param {string} fallbackZip - CP del emisor como fallback si cliente sin CP
 * @returns {{ rfc, name, fiscalRegime, cfdiUse, zipCode, email, isPublicoGeneral, isExtranjero }}
 */
export function buildCfdiReceiver(cliente, fallbackZip) {
  const rfc = String(cliente?.rfc || '').toUpperCase().trim();
  const fallbackZipStr = String(fallbackZip || '').trim();

  if (isRfcExtranjero(rfc)) {
    return {
      rfc: 'XEXX010101000',
      name: 'PUBLICO EN GENERAL EXTRANJERO',
      fiscalRegime: '616',
      cfdiUse: 'S01',
      // Receptor genérico: su domicilio fiscal ES el lugar de expedición (regla del SAT).
      zipCode: fallbackZipStr,
      email: cliente?.correo || undefined,
      isPublicoGeneral: false,
      isExtranjero: true,
    };
  }

  const valido = isValidRfc(rfc);
  if (valido) {
    return {
      rfc,
      name: cliente?.nombre || 'CLIENTE',
      fiscalRegime: resolveRegimeCode(cliente?.regimen),
      cfdiUse: cliente?.uso_cfdi || 'G03',
      zipCode: cliente?.cp || fallbackZipStr,
      email: cliente?.correo || undefined,
      isPublicoGeneral: false,
      isExtranjero: false,
    };
  }

  // Caso default: nacional sin RFC válido o sin RFC → público general
  return {
    rfc: 'XAXX010101000',
    name: 'PUBLICO EN GENERAL',
    fiscalRegime: '616',
    cfdiUse: 'S01',
    zipCode: fallbackZipStr,
    email: cliente?.correo || undefined,
    isPublicoGeneral: true,
    isExtranjero: false,
  };
}

// Whitelist completa del catálogo SAT c_RegimenFiscal (mismo set que
// src/data/sat/regimenesFiscales.js — duplicado consciente porque el
// backend no puede importar src/ y Netlify functions corren standalone).
const CODIGOS_REGIMEN_SAT = new Set([
  '601', '603', '605', '606', '607', '608', '610', '611', '612', '614',
  '615', '616', '620', '621', '622', '623', '624', '625', '626',
]);

/**
 * Resuelve el código SAT de régimen fiscal. Tanda 4 🔴-10: la UI ahora
 * guarda códigos directos (post-mig 060). Esta función:
 *   1. Si es un código válido del catálogo SAT → devuelve tal cual.
 *   2. Si es un código de 3 dígitos NO válido → devuelve 616 con warning.
 *   3. Si es un string legacy ("Régimen General") → mapea por
 *      REGIME_CODE_MAP (compat con datos pre-mig 060).
 *   4. Vacío/null/no reconocido → 616 (sin obligaciones, default seguro).
 *
 * @param {string} rawRegime
 * @returns {string} — código de 3 dígitos
 */
export function resolveRegimeCode(rawRegime) {
  if (!rawRegime) return '616';
  const trimmed = String(rawRegime).trim();
  // Caso normal post-mig 060: ya es código SAT válido.
  if (CODIGOS_REGIMEN_SAT.has(trimmed)) return trimmed;
  // Código 3 dígitos pero no es del catálogo → fallback con warning.
  if (/^\d{3}$/.test(trimmed)) {
    console.warn(`[invoiceLogic] Código de régimen ${trimmed} no está en catálogo SAT, usando 616`);
    return '616';
  }
  // Compat con strings legacy.
  const mapped = REGIME_CODE_MAP[trimmed];
  if (mapped) return mapped;
  return '616';
}

/**
 * Código SAT del régimen SOLO si es reconocible (código del catálogo o texto
 * heredado). A diferencia de resolveRegimeCode no inventa 616: sirve para saber
 * si a un cliente con RFC le falta el régimen.
 * @param {string} rawRegime
 * @returns {string|null}
 */
export function regimenReconocido(rawRegime) {
  const t = String(rawRegime ?? '').trim();
  if (!t) return null;
  if (CODIGOS_REGIMEN_SAT.has(t)) return t;
  return REGIME_CODE_MAP[t] || null;
}

const USOS_CFDI = new Set(['G01', 'G02', 'G03', 'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'S01', 'CP01', 'CN01']);

/**
 * A quién se le timbra. Nunca cambia de receptor en silencio:
 *   - `publicoGeneral` (decisión explícita del operador) → público en general.
 *   - Cliente sin RFC o con RFC genérico → público en general (no hay otro receptor posible).
 *   - Cliente con RFC nominativo → a su nombre, y solo si sus datos fiscales están
 *     completos (régimen, CP fiscal de 5 dígitos, uso de CFDI del catálogo). Si falta
 *     algo se rechaza ANTES de llamar al proveedor, diciendo qué falta.
 * @returns {{ok:true, cliente:Object|null, publicoGeneral:boolean} | {ok:false, status:number, code:string, error:string}}
 */
export function decidirReceptor(cliente, { publicoGeneral = false } = {}) {
  if (publicoGeneral) return { ok: true, cliente: null, publicoGeneral: true };
  const rfc = String(cliente?.rfc || '').toUpperCase().trim();
  if (isRfcExtranjero(rfc)) return { ok: true, cliente, publicoGeneral: false };
  if (!rfc || isRfcPublicoGeneral(rfc)) return { ok: true, cliente: null, publicoGeneral: true };
  const faltan = [];
  if (!isValidRfc(rfc)) faltan.push('un RFC con formato válido');
  const regimen = regimenReconocido(cliente?.regimen);
  if (!regimen) faltan.push('el régimen fiscal');
  // 616 es solo para público en general: con RFC propio el SAT lo rechaza.
  else if (regimen === '616') faltan.push('su régimen fiscal real (tiene 616 "Sin obligaciones fiscales")');
  if (!/^\d{5}$/.test(String(cliente?.cp || '').trim())) faltan.push('el código postal fiscal (5 dígitos)');
  const uso = String(cliente?.uso_cfdi || '').trim();
  if (uso && !USOS_CFDI.has(uso)) faltan.push(`un uso de CFDI válido (tiene "${uso}")`);
  if (faltan.length) {
    return {
      ok: false, status: 422, code: 'DATOS_FISCALES_INCOMPLETOS',
      error: `No se timbró: a ${cliente?.nombre || 'el cliente'} le falta ${faltan.join(', ')}. Corrígelo en Clientes, o factura esta venta a público en general.`,
    };
  }
  return { ok: true, cliente, publicoGeneral: false };
}

/** Mes y año de la factura global, en la zona del negocio (no en la del servidor, que es UTC). */
export function periodoGlobal(ahora = new Date(), zona = 'America/Monterrey') {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit' }).formatToParts(ahora).map((x) => [x.type, x.value]));
  return { Months: partes.month, Year: partes.year };
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
 * El parámetro queda en la firma para que la API funcione si en el
 * futuro la tasa deja de ser 0; hoy se ignora intencionalmente.
 *
 * @param {number} _subtotal — precio sin impuesto (sin uso hoy: tasa 0%)
 * @returns {number}
 */
export function calcIVA(_subtotal) {
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
