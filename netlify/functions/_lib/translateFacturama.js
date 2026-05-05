// translateFacturama.js — traduce errores crudos de Facturama (ModelState
// con código SAT enredado) a un mensaje legible para el usuario.
//
// El JSON original (ModelState completo) se preserva en el caller dentro
// de invoice_attempts.response_payload para diagnóstico técnico —
// translateFacturamaError solo construye el `message` que ve el admin.
//
// Tanda 4 🟡 I1: antes los errores de Facturama llegaban al usuario como
// `${message} | ${JSON.stringify(ModelState)}` — ilegible. Ahora se
// matchean campos comunes contra mensajes en español.

/**
 * Traduce un error de Facturama a un mensaje friendly.
 *
 * @param {Object} rawError - body del response de Facturama.
 *   Shape esperado: { Message?: string, message?: string, ModelState?: Object }
 * @param {number} [statusCode] - HTTP status code (opcional, para casos
 *   genéricos como 401/500).
 * @returns {string} Mensaje legible para el usuario.
 */
export function translateFacturamaError(rawError, statusCode) {
  // Errores HTTP genéricos sin payload usable
  if (statusCode === 401) {
    return 'Credenciales de Facturama incorrectas. Avisa al admin.';
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return 'Facturama no responde en este momento. Reintenta en unos minutos.';
  }

  const detail = JSON.stringify(rawError?.ModelState || rawError || {});
  const baseMsg = rawError?.Message || rawError?.message || '';

  // Casos específicos por campo (el orden importa: el primer match gana)
  if (/Receiver\.Rfc/i.test(detail)) {
    return 'RFC del cliente inválido o no registrado en SAT. Verifica el RFC en el catálogo de Clientes.';
  }
  if (/Receiver\.FiscalRegime/i.test(detail)) {
    return 'Régimen fiscal del cliente no coincide con su RFC en el SAT. Revisa el régimen en su perfil.';
  }
  if (/Receiver\.CfdiUse/i.test(detail)) {
    return 'Uso de CFDI no es válido para el régimen fiscal del cliente. Pide a Admin que actualice el uso CFDI.';
  }
  if (/Receiver\.(?:Address\.)?(?:Tax)?ZipCode/i.test(detail)) {
    return 'Código postal del cliente inválido en SAT. Captura el CP correcto.';
  }
  if (/Receiver\.Name/i.test(detail)) {
    return 'Nombre/razón social del cliente no coincide con SAT. Verifica que esté escrito tal cual está en su Constancia de Situación Fiscal.';
  }
  if (/Issuer\.Rfc|Emisor\.Rfc/i.test(detail)) {
    return 'RFC de tu empresa inválido o sin certificado activo en Facturama.';
  }
  if (/Issuer\.FiscalRegime/i.test(detail)) {
    return 'Régimen fiscal de tu empresa no es válido en SAT. Revisa Configuración → Datos de la empresa.';
  }
  if (/Issuer\.(?:Address\.)?(?:Tax)?ZipCode|ExpeditionPlace/i.test(detail)) {
    return 'Código postal de la empresa inválido. Revisa Configuración → Datos de la empresa.';
  }
  if (/PaymentForm/i.test(detail)) {
    return 'Forma de pago no soportada por SAT. Cambia el método (Efectivo / Transferencia / Tarjeta).';
  }
  if (/PaymentMethod/i.test(detail)) {
    return 'Método de pago (PUE/PPD) inválido. Verifica si la venta es contado o crédito.';
  }
  if (/Items.*\.ProductCode/i.test(detail)) {
    return 'Clave de producto SAT inválida en alguno de los items. Revisa el campo "Clave SAT" del producto.';
  }
  if (/Items.*\.UnitCode/i.test(detail)) {
    return 'Clave de unidad SAT inválida en alguno de los items. Default: H87 (pieza).';
  }
  if (/Items.*\.Description/i.test(detail)) {
    return 'Descripción de producto vacía o inválida en alguno de los items.';
  }
  if (/Items.*\.UnitPrice|Items.*\.Quantity|Items.*\.Subtotal|Items.*\.Total/i.test(detail)) {
    return 'Cantidad o precio inválido en alguno de los items de la orden.';
  }
  if (/Taxes/i.test(detail)) {
    return 'Configuración de impuestos inválida. Hielo va con IVA tasa 0% (Art. 2-A LIVA).';
  }
  if (/CfdiType/i.test(detail)) {
    return 'Tipo de CFDI inválido (debe ser I = Ingreso, P = Pago, E = Egreso).';
  }
  if (/Currency/i.test(detail)) {
    return 'Moneda inválida (debe ser MXN o XXX para complementos).';
  }
  if (/PacIssue|Timbre|Stamping|sello/i.test(detail)) {
    return 'Error del PAC (proveedor de timbrado) al timbrar. Reintenta en 1-2 minutos.';
  }
  if (/Folio.*duplicad|already exists|UUID.*existe/i.test(detail)) {
    return 'Esta orden ya tiene un CFDI timbrado. Recarga la página para verlo.';
  }
  if (/csd|certificad|expirad/i.test(detail)) {
    return 'Tu certificado de sello digital (CSD) está vencido o no se cargó en Facturama. Avisa al admin.';
  }

  // Fallback: el mensaje de Facturama tal cual (sin el JSON crudo).
  if (baseMsg) return baseMsg;
  return 'Error al timbrar con Facturama. Revisa la auditoría de facturas para más detalle.';
}
