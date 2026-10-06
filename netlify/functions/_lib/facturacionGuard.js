// facturacionGuard.js — OL-03A: autorización y precondiciones de timbrado y
// cancelación de CFDI, evaluadas ANTES de contactar al proveedor.
//
// Las funciones de facturación usan service role: la base de datos no aplica
// RLS ni la guarda 105 a esas escrituras, y 110 no vigila 'Facturada'. Por
// eso la regla vive aquí, en el servidor, y no en la visibilidad de la UI.
//
// Dueño (Ventas): ordenes.vendedor_id = usuarios.id del actor (identidad
// canónica por auth_id, 083), la misma regla que completar_venta_directa
// (109). Una orden SIN vendedor no es de ningún vendedor: no se acepta aquí
// (canAccessOrden la permite a cualquier vendedor; esa holgura no se hereda).
//
// Cumplimiento físico: solo una orden 'Entregada' se timbra. Tras 109/110 una
// orden llega a 'Entregada' solo por un camino con salida física (contrato de
// venta directa, entrega del chofer o cierre de ruta, entrega con ruta de
// Admin) o por la cancelación de un CFDI de una orden que ya estaba entregada.
// El pago NO se exige: la venta a crédito se timbra como PPD antes de cobrarse.
// Lógica pura: sin red ni base de datos.

export const ROLES_FACTURACION = Object.freeze(['Admin', 'Facturación', 'Ventas']);
const ROLES_EMPRESA = new Set(['Admin', 'Facturación']);

const rechazo = (status, code, error) => ({ ok: false, status, code, error });

/** ¿El rol puede usar timbrado/cancelación? (antes de leer la orden). */
export function rolPuedeFacturar(profile) {
  return !!profile && ROLES_FACTURACION.includes(profile.rol);
}

/**
 * ¿Este actor puede timbrar/cancelar ESTA orden?
 * Admin y Facturación: cualquier orden de la empresa. Ventas: solo la suya.
 */
export function autorizarOrdenFacturacion(profile, orden) {
  if (!rolPuedeFacturar(profile)) return rechazo(403, 'ROL_NO_AUTORIZADO', 'Tu rol no puede timbrar ni cancelar facturas');
  if (!orden) return rechazo(400, 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada');
  if (ROLES_EMPRESA.has(profile.rol)) return { ok: true };
  const vendedor = orden.vendedor_id;
  if (vendedor === null || vendedor === undefined || String(vendedor) === '' || profile.id === null || profile.id === undefined) {
    return rechazo(403, 'ORDEN_AJENA', 'Solo puedes facturar tus propias órdenes');
  }
  if (String(vendedor) !== String(profile.id)) return rechazo(403, 'ORDEN_AJENA', 'Solo puedes facturar tus propias órdenes');
  return { ok: true };
}

/** CFDI vigente: timbrado (UUID) y no cancelado. */
export function tieneCfdiVigente(orden) {
  return !!(orden && orden.facturama_uuid && !orden.cfdi_cancelado_at);
}

/**
 * Precondición de timbrado (tras autorizar).
 *   'ya_timbrada' → idempotencia existente: responde el CFDI vigente, sin proveedor.
 *   'timbrar'     → orden Entregada sin CFDI vigente: puede ir al proveedor.
 *   rechazo 409   → cualquier otro estatus (incluida Facturada sin CFDI vigente).
 */
export function precondicionTimbrado(orden) {
  if (!orden) return rechazo(400, 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada');
  if (tieneCfdiVigente(orden)) return { ok: true, accion: 'ya_timbrada' };
  if (orden.estatus !== 'Entregada') {
    return rechazo(409, 'ESTATUS_NO_FACTURABLE', `Solo se factura una orden Entregada (la orden ${orden.folio || orden.id} está ${orden.estatus || 'sin estatus'})`);
  }
  return { ok: true, accion: 'timbrar' };
}

/**
 * Precondición de cancelación (tras autorizar).
 *   rechazo 400       → la orden no tiene CFDI timbrado (comportamiento existente).
 *   'ya_cancelada'    → idempotencia existente, sin proveedor.
 *   'cancelar'        → Facturada con CFDI vigente: puede ir al proveedor.
 *   rechazo 409       → CFDI vigente pero la orden no está Facturada.
 */
export function precondicionCancelacion(orden) {
  if (!orden) return rechazo(400, 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada');
  if (!orden.facturama_uuid || !orden.facturama_id) return rechazo(400, 'SIN_CFDI', 'La orden no tiene un CFDI timbrado para cancelar');
  if (orden.cfdi_cancelado_at) return { ok: true, accion: 'ya_cancelada' };
  if (orden.estatus !== 'Facturada') {
    return rechazo(409, 'ESTATUS_NO_CANCELABLE', `Solo se cancela el CFDI de una orden Facturada (la orden ${orden.folio || orden.id} está ${orden.estatus || 'sin estatus'})`);
  }
  return { ok: true, accion: 'cancelar' };
}

/**
 * Campos del cuerpo que el timbrado acepta. Todo dato fiscal (receptor,
 * conceptos, montos, forma y método de pago, lugar de expedición) lo deriva el
 * servidor de la orden, sus líneas, el cliente, el catálogo y la configuración.
 * Un CFDI armado por quien llama (`facturamaPayload`) se rechaza.
 */
export function validarCuerpoTimbrado(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (Object.prototype.hasOwnProperty.call(b, 'facturamaPayload')) {
    return rechazo(400, 'PAYLOAD_NO_PERMITIDO', 'El CFDI lo arma el servidor con los datos de la orden; no se acepta un CFDI enviado por el cliente');
  }
  if (!b.ordenId && !b.folio) return rechazo(400, 'ORDEN_REQUERIDA', 'ordenId or folio is required');
  return { ok: true, ordenId: b.ordenId || null, folio: b.folio || null };
}

/** Resultado de un UPDATE condicional (`.select('id')`): éxito solo si tocó exactamente la orden. */
export function updateCondicionalOk(res, ordenId) {
  if (!res || res.error) return false;
  const filas = Array.isArray(res.data) ? res.data : [];
  return filas.length === 1 && String(filas[0]?.id) === String(ordenId);
}
