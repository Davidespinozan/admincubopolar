// cfdiDocumento.js — lógica pura para ENVIAR por correo y DESCARGAR un CFDI ya
// timbrado (billing-send-invoice / billing-download-invoice). Sin red ni base de
// datos. Ninguna de las dos acciones cambia la orden, el CFDI ni dinero: solo
// leen el documento que Facturama ya tiene.

export const FORMATOS_CFDI = Object.freeze(['pdf', 'xml']);
const MIME = { pdf: 'application/pdf', xml: 'application/xml' };

export const formatoValido = (f) => FORMATOS_CFDI.includes(String(f || '').toLowerCase());
export const mimeDeFormato = (f) => MIME[String(f || '').toLowerCase()] || 'application/octet-stream';

/** Correo en minúsculas y sin espacios alrededor. */
export const normalizarEmail = (raw) => String(raw ?? '').trim().toLowerCase();
/** Formato básico (uno solo, sin listas): Facturama valida el resto. */
export const emailValido = (email) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(email || '')) && String(email).length <= 120;

/**
 * Correo de destino: el que escribió el operador o, si no, el del cliente.
 * @returns {{ ok: true, email: string } | { ok: false, status: number, code: string, error: string }}
 */
export function resolverEmailDestino(override, correoCliente) {
  const escrito = normalizarEmail(override);
  if (escrito) {
    return emailValido(escrito) ? { ok: true, email: escrito } : { ok: false, status: 422, code: 'EMAIL_INVALIDO', error: 'El correo no es válido' };
  }
  const delCliente = normalizarEmail(correoCliente);
  if (!delCliente) return { ok: false, status: 422, code: 'EMAIL_FALTANTE', error: 'El cliente no tiene correo: escríbelo para enviar la factura' };
  return emailValido(delCliente) ? { ok: true, email: delCliente } : { ok: false, status: 422, code: 'EMAIL_INVALIDO', error: 'El correo del cliente no es válido: corrígelo o escribe otro' };
}

/**
 * ¿La orden tiene un CFDI que se pueda enviar o descargar?
 * Descargar: cualquier CFDI timbrado (también cancelado: es histórico).
 * Enviar: solo uno vigente (no se le manda al cliente una factura cancelada).
 */
export function precondicionDocumento(orden, { paraEnviar = false } = {}) {
  if (!orden) return { ok: false, status: 400, code: 'ORDEN_NO_ENCONTRADA', error: 'Orden no encontrada' };
  if (!orden.facturama_id) return { ok: false, status: 409, code: 'SIN_CFDI', error: 'Esta venta todavía no tiene factura timbrada' };
  if (paraEnviar && orden.cfdi_cancelado_at) return { ok: false, status: 409, code: 'CFDI_CANCELADO', error: 'La factura está cancelada: no se envía al cliente' };
  return { ok: true };
}

/** Nombre del archivo: Factura-<folio CFDI o folio de la venta>.<ext> (solo caracteres seguros). */
export function nombreArchivoCfdi(orden, formato) {
  const base = String(orden?.facturama_folio || orden?.folio || orden?.id || 'cfdi').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cfdi';
  return `Factura-${base}.${String(formato).toLowerCase()}`;
}

/** URL de Facturama para enviar el CFDI emitido por correo. */
export function urlEnvioCfdi(baseUrl, facturamaId, email) {
  const qs = new URLSearchParams({ cfdiType: 'issued', cfdiId: String(facturamaId), email });
  return `${String(baseUrl).replace(/\/+$/, '')}/api/Cfdi?${qs.toString()}`;
}
/** URL de Facturama para bajar el PDF o el XML del CFDI emitido (responde { Content: base64 }). */
export function urlDescargaCfdi(baseUrl, facturamaId, formato) {
  return `${String(baseUrl).replace(/\/+$/, '')}/api/Cfdi/${String(formato).toLowerCase()}/issued/${encodeURIComponent(String(facturamaId))}`;
}

/** El envío se da por hecho solo con 2xx Y success === true (un 200 no basta). */
export function envioExitoso(respuesta) {
  return !!respuesta?.respondio && respuesta.status >= 200 && respuesta.status < 300 && respuesta.raw?.success === true;
}
/** Contenido base64 del documento, o null si Facturama no lo entregó. */
export function contenidoDescarga(respuesta) {
  if (!respuesta?.respondio || !respuesta.ok) return null;
  const c = respuesta.raw?.Content;
  return typeof c === 'string' && c.length > 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(c) ? c.replace(/\s+/g, '') : null;
}
/** Mensaje del proveedor para el operador (sin credenciales ni contenido del documento). */
export function mensajeProveedor(respuesta, porOmision) {
  if (!respuesta?.respondio) return 'Facturama no respondió. Inténtalo otra vez.';
  const r = respuesta.raw || {};
  const m = r.msj || r.Message || r.message;
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 200) : porOmision;
}
