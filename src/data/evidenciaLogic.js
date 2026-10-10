// evidenciaLogic.js — evidencias de una venta (mig 134): la foto del
// comprobante de transferencia y la foto de la entrega que toma el Chofer.
// Antes se quedaban en su teléfono; ahora se suben al almacenamiento privado y
// se ligan a la orden con registrar_evidencia_orden. Aquí solo hay lógica pura.

export const TIPOS_EVIDENCIA = Object.freeze({ comprobante_pago: 'Comprobante de pago', entrega: 'Foto de entrega' });
export const etiquetaEvidencia = (tipo) => TIPOS_EVIDENCIA[tipo] || 'Foto';

/**
 * Ruta del archivo: <uid>/ordenes/<orden>/<tipo>.jpg. Es fija por venta y tipo:
 * un reintento vuelve a la misma ruta (el servidor exige esa forma y no duplica).
 */
export function rutaEvidencia(authId, ordenId, tipo) {
  const uid = String(authId ?? '').trim();
  const orden = Number(ordenId);
  if (!uid || !Number.isInteger(orden) || orden <= 0 || !TIPOS_EVIDENCIA[tipo]) return null;
  return `${uid}/ordenes/${orden}/${tipo}.jpg`;
}

/** dataURL (lo que guarda el Chofer tras comprimir) → Blob para subir. null si no es una imagen válida. */
export function dataUrlABlob(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl ?? '').trim());
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1].toLowerCase() });
}

/**
 * Fotos de las entregas que todavía no están en el sistema.
 * Solo entregas con orden (la venta exprés no tiene orden hasta el cierre).
 * @returns {{ clave: string, ordenId: number, tipo: string, dataUrl: string, referencia: string|null, marca: string }[]}
 */
export function evidenciasPendientes(entregas) {
  const out = [];
  for (const e of Array.isArray(entregas) ? entregas : []) {
    const ordenId = Number(e?.ordenId);
    if (!Number.isInteger(ordenId) || ordenId <= 0) continue;
    if (e.foto && !e.fotoSubida) out.push({ clave: `${ordenId}|comprobante_pago`, ordenId, tipo: 'comprobante_pago', dataUrl: e.foto, referencia: String(e.referencia ?? '').trim() || null, marca: 'fotoSubida' });
    if (e.fotoEntrega && !e.fotoEntregaSubida) out.push({ clave: `${ordenId}|entrega`, ordenId, tipo: 'entrega', dataUrl: e.fotoEntrega, referencia: null, marca: 'fotoEntregaSubida' });
  }
  return out;
}

/** Estado de las fotos de una entrega para mostrarlo al Chofer: null (sin fotos), 'guardadas' o 'pendientes'. */
export function estadoFotosEntrega(e) {
  const hay = Boolean(e?.foto) || Boolean(e?.fotoEntrega);
  if (!hay) return null;
  return (!e.foto || e.fotoSubida) && (!e.fotoEntrega || e.fotoEntregaSubida) ? 'guardadas' : 'pendientes';
}

/** "ya existe" del almacenamiento: la foto se subió en un intento anterior (se sigue con el registro). */
export const yaExisteEnAlmacen = (error) => /already exists|duplicate|resource already/i.test(String(error?.message ?? error ?? '')) || String(error?.statusCode ?? '') === '409';
