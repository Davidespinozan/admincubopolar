// cfdiOperacion.js — OL-03B: frontera con el proveedor de CFDI (Facturama).
//
// La concurrencia la resuelve la base de datos (reservar_operacion_cfdi /
// finalizar_operacion_cfdi, migración 111). Aquí solo:
//   - la huella del CFDI que arma el servidor;
//   - la llamada HTTP con tiempo límite explícito;
//   - la CLASIFICACIÓN del resultado. Regla central: un resultado que no
//     excluye que el proveedor haya actuado es 'incierta', nunca 'fallida'.
//     'fallida' solo cuando el proveedor respondió con un rechazo definitivo
//     (la solicitud no se procesó).
// Sin red ni base de datos propias: todo se inyecta.
import { createHash } from 'node:crypto';

// Respuestas HTTP que prueban que el proveedor NO procesó la solicitud.
// 408/409/429, 5xx y cualquier otra: resultado desconocido.
export const HTTP_RECHAZO_DEFINITIVO = Object.freeze([400, 401, 403, 405, 415, 422]);
// Al crear, 404 es una ruta inexistente (nada se emitió). Al cancelar, 404 puede
// significar "ya cancelado / no encontrado": se trata como desconocido.
const HTTP_RECHAZO_EMISION = new Set([...HTTP_RECHAZO_DEFINITIVO, 404]);
const HTTP_RECHAZO_CANCELACION = new Set(HTTP_RECHAZO_DEFINITIVO);

/** Huella sha256 del CFDI armado por el servidor (orden de claves fijo por construcción). */
export function huellaPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/**
 * Llama al proveedor con tiempo límite. Nunca lanza:
 *   { respondio: true, status, ok, raw }    hubo respuesta HTTP
 *   { respondio: false, error }             timeout, red, abortado
 */
export async function llamarProveedor(fetchImpl, url, init, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  const limite = new Promise((resolve) => {
    timer = setTimeout(() => { ctrl?.abort(); resolve({ respondio: false, error: `sin respuesta en ${timeoutMs} ms` }); }, timeoutMs);
  });
  const llamada = (async () => {
    try {
      const response = await fetchImpl(url, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) });
      const raw = await response.json().catch(() => null);
      return { respondio: true, status: response.status, ok: !!response.ok, raw };
    } catch (error) {
      return { respondio: false, error: error?.message || String(error) };
    }
  })();
  try {
    return await Promise.race([llamada, limite]);
  } finally {
    clearTimeout(timer);
  }
}

/** UUID del timbre: nivel superior (forma usada hasta hoy) o Complement.TaxStamp (timbre fiscal). */
export function uuidDeRespuesta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.Uuid || raw.uuid || raw.UUID || raw.Complement?.TaxStamp?.Uuid || raw.complement?.taxStamp?.uuid || null;
}

/**
 * Resultado de una EMISIÓN para finalizar_operacion_cfdi.
 *   emitida   → { resultado:'emitida', datos:{ proveedor_id, cfdi_uuid, folio } }
 *   fallida   → rechazo definitivo (nada se emitió)
 *   incierta  → no se puede excluir que se emitió (incluye 2xx sin Id/UUID)
 */
export function clasificarEmision(r) {
  if (!r || !r.respondio) {
    return { resultado: 'incierta', datos: { detalle: { error: r?.error || 'sin respuesta del proveedor' } } };
  }
  const raw = r.raw && typeof r.raw === 'object' ? r.raw : null;
  if (r.ok) {
    const id = raw?.Id ? String(raw.Id) : null;
    const uuid = uuidDeRespuesta(raw);
    if (id && uuid) return { resultado: 'emitida', datos: { proveedor_id: id, cfdi_uuid: String(uuid), folio: raw?.Folio ? String(raw.Folio) : null } };
    return { resultado: 'incierta', datos: { proveedor_id: id, detalle: { error: 'respuesta exitosa sin Id o UUID del CFDI', http: r.status } } };
  }
  if (HTTP_RECHAZO_EMISION.has(r.status)) {
    return { resultado: 'fallida', datos: { detalle: { http: r.status, proveedor: raw } } };
  }
  return { resultado: 'incierta', datos: { detalle: { http: r.status, proveedor: raw } } };
}

/** Estatus de cancelación del proveedor (Status: canceled / requested / rejected). */
export function estatusCancelacion(raw) {
  if (!raw || typeof raw !== 'object') return '';
  return String(raw.Status ?? raw.status ?? '').trim().toLowerCase();
}

/**
 * Resultado de una CANCELACIÓN. Un HTTP 200 NO basta: se lee el estatus.
 *   canceled / cancelled → cancelada (la orden vuelve a Entregada)
 *   requested            → cancelacion_solicitada (la orden SIGUE Facturada)
 *   rejected             → cancelacion_rechazada (la orden sigue Facturada)
 *   cualquier otro / sin respuesta / 404 / 5xx → incierta
 *   rechazo HTTP definitivo (400/401/403/422…)  → fallida
 */
export function clasificarCancelacion(r) {
  if (!r || !r.respondio) {
    return { resultado: 'incierta', datos: { detalle: { error: r?.error || 'sin respuesta del proveedor' } } };
  }
  const raw = r.raw && typeof r.raw === 'object' ? r.raw : null;
  const st = estatusCancelacion(raw);
  if (r.ok) {
    if (st === 'canceled' || st === 'cancelled') return { resultado: 'cancelada', datos: { proveedor_estatus: st } };
    if (st === 'requested') return { resultado: 'cancelacion_solicitada', datos: { proveedor_estatus: st } };
    if (st === 'rejected') return { resultado: 'cancelacion_rechazada', datos: { proveedor_estatus: st } };
    return { resultado: 'incierta', datos: { proveedor_estatus: st || null, detalle: { error: 'estatus de cancelación no reconocido', http: r.status, proveedor: raw } } };
  }
  if (HTTP_RECHAZO_CANCELACION.has(r.status)) {
    return { resultado: 'fallida', datos: { detalle: { http: r.status, proveedor: raw } } };
  }
  return { resultado: 'incierta', datos: { detalle: { http: r.status, proveedor: raw } } };
}

/** Respuesta HTTP para una reserva que no se concedió (antes del proveedor). */
export function respuestaReservaRechazada(r) {
  const op = r?.operacion_id || null;
  switch (r?.codigo) {
    case 'OPERACION_EN_CURSO':
      return { status: 409, body: { code: 'OPERACION_EN_CURSO', operacionId: op, error: 'Ya hay una operación de CFDI en curso para esta orden. Espera unos segundos y recarga.' } };
    case 'OPERACION_INCIERTA':
      return { status: 409, body: { code: 'OPERACION_INCIERTA', operacionId: op, error: 'Una operación anterior de CFDI de esta orden quedó sin confirmar con Facturama. Requiere conciliación antes de reintentar.' } };
    case 'CANCELACION_PENDIENTE':
      return { status: 409, body: { code: 'CANCELACION_PENDIENTE', operacionId: op, error: 'La cancelación del CFDI está solicitada y pendiente de confirmación del SAT.' } };
    case 'OPERACION_EN_REVISION':
      return { status: 409, body: { code: 'OPERACION_EN_REVISION', operacionId: op, error: 'Hay una operación de CFDI en revisión para esta orden. Revísala en Facturación.' } };
    default:
      return { status: 409, body: { code: r?.codigo || 'RESERVA_RECHAZADA', error: 'La orden ya no está en un estado válido para esta operación. Recarga la página.', estatus: r?.estatus || null } };
  }
}
