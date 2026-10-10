// cfdiDocumentoLogic.js — lado del cliente para ver, descargar y enviar por
// correo un CFDI ya timbrado (billing-download-invoice / billing-send-invoice).
// El servidor es la autoridad: valida rol, dueño de la orden, CFDI y correo.

/** base64 (lo que entrega el servidor) → Blob del documento. null si no es base64. */
export function base64ABlob(base64, contentType) {
  const limpio = String(base64 ?? '').replace(/\s+/g, '');
  if (!limpio || !/^[A-Za-z0-9+/=]+$/.test(limpio)) return null;
  const bin = atob(limpio);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}

/** Correo válido para enviar la factura (uno solo). Espejo de la regla del servidor. */
export const correoFacturaValido = (email) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(email ?? '').trim());

/** Mensaje para el operador según la respuesta del servidor. */
export function mensajeErrorDocumento(err, accion = 'obtener la factura') {
  const code = err?.status;
  if (code === 401) return 'Tu sesión venció. Vuelve a entrar e inténtalo otra vez.';
  if (code === 403) return 'No tienes permiso sobre la factura de esta venta.';
  if (code === 404) return 'Facturama no encontró esa factura.';
  if (code === 409 || code === 422 || code === 502) return String(err?.message || `No se pudo ${accion}`);
  return `No se pudo ${accion}. Revisa tu conexión e inténtalo otra vez.`;
}
