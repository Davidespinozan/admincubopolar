// stockContratosLogic.js — lógica pura del frontend para los contratos de
// stock de cuartos fríos (mig 084): confirmar_carga_ruta, registrar_no_entrega,
// salida_cuarto_manual y traspaso_cuartos.
//
// El servidor decide todo lo autoritativo (actor, cantidades de la ruta,
// cuartos, kardex, transición de estado, idempotencia). El cliente solo arma
// los parámetros de negocio, conserva el operacion_id del intento lógico y
// traduce resultados/errores. Mismo ciclo de vida de operacion_id que 076
// (resolverOperacion): mismos datos → mismo UUID en cada reintento; datos
// distintos → UUID nuevo.

import { nuevoOperacionId, resolverOperacion } from './produccionAtomicaLogic.js';

export { nuevoOperacionId, resolverOperacion };

const txt = (v) => (v == null ? '' : String(v)).trim();

/** Motivos neutros para la salida manual de Producción. Ninguno es una carga
 *  de ruta: eso lo registra confirmar_carga_ruta al firmar. */
export const MOTIVOS_SALIDA_MANUAL = ['Venta directa', 'Consumo interno', 'Ajuste físico', 'Otro'];

/** Motivo que el servidor rechaza porque corresponde a la firma de carga. */
export function esMotivoDeRuta(motivo) {
  return /ruta/i.test(txt(motivo));
}

// ── Claves de intento lógico (una por acción de usuario) ─────────────
export function claveCarga({ rutaId, excepcion, motivo } = {}) {
  return ['CARGA', txt(rutaId), excepcion ? 'exc' : 'firma', excepcion ? txt(motivo) : ''].join('|');
}
export function claveNoEntrega({ ordenId, motivo, reagendar } = {}) {
  return ['NOENT', txt(ordenId), txt(motivo), reagendar ? '1' : '0'].join('|');
}
export function claveSalida({ cuartoId, sku, cantidad, motivo } = {}) {
  return ['SALIDA', txt(cuartoId), txt(sku), Number(cantidad), txt(motivo)].join('|');
}
export function claveTraspaso({ origen, destino, sku, cantidad } = {}) {
  return ['TRASP', txt(origen), txt(destino), txt(sku), Number(cantidad)].join('|');
}

function entero(v, etiqueta) {
  const q = Number(v);
  if (!Number.isFinite(q) || q <= 0) return { error: `${etiqueta} debe ser mayor a 0` };
  if (!Number.isInteger(q)) return { error: `${etiqueta} debe ser un número entero` };
  return { q };
}

/**
 * Parámetros de confirmar_carga_ruta. La firma o la excepción con motivo son
 * obligatorias; las cantidades y cuartos NO se envían: los deriva el servidor.
 * @returns {{args:Object}|{error:string}}
 */
export function buildConfirmarCargaArgs({ operacionId, rutaId, firma, excepcion, motivo } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(rutaId)) return { error: 'Ruta inválida' };
  const exc = excepcion === true;
  if (exc && !txt(motivo)) return { error: 'Justificación requerida para carga sin firma' };
  if (!exc && !txt(firma)) return { error: 'Firma requerida' };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_ruta_id: Number(rutaId),
      p_firma: exc ? null : txt(firma),
      p_excepcion: exc,
      p_motivo: exc ? txt(motivo) : null,
    },
  };
}

/** Parámetros de registrar_no_entrega. */
export function buildNoEntregaArgs({ operacionId, ordenId, motivo, reagendar } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(ordenId)) return { error: 'Orden requerida' };
  if (!txt(motivo)) return { error: 'Motivo requerido' };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_orden_id: Number(ordenId),
      p_motivo: txt(motivo),
      p_reagendar: reagendar === true,
    },
  };
}

/** Parámetros de salida_cuarto_manual. Refleja la regla del servidor sobre
 *  motivos de ruta para dar un mensaje claro; no la sustituye ni la rodea. */
export function buildSalidaManualArgs({ operacionId, cuartoId, sku, cantidad, motivo } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(cuartoId)) return { error: 'Cuarto frío requerido' };
  if (!txt(sku)) return { error: 'SKU requerido' };
  const c = entero(cantidad, 'La cantidad');
  if (c.error) return { error: c.error };
  if (!txt(motivo)) return { error: 'Motivo requerido' };
  if (esMotivoDeRuta(motivo)) return { error: 'La carga a ruta se registra al firmar la carga, no como salida manual' };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_cuarto_id: txt(cuartoId),
      p_sku: txt(sku),
      p_cantidad: c.q,
      p_motivo: txt(motivo),
    },
  };
}

/** Parámetros de traspaso_cuartos. */
export function buildTraspasoArgs({ operacionId, origen, destino, sku, cantidad } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(origen) || !txt(destino)) return { error: 'Origen y destino requeridos' };
  if (txt(origen) === txt(destino)) return { error: 'Origen y destino deben ser diferentes' };
  if (!txt(sku)) return { error: 'SKU requerido' };
  const c = entero(cantidad, 'La cantidad');
  if (c.error) return { error: c.error };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_origen: txt(origen),
      p_destino: txt(destino),
      p_sku: txt(sku),
      p_cantidad: c.q,
    },
  };
}

/** Resultado de cualquiera de los cuatro contratos tal como lo devuelve el servidor. */
export function interpretarResultadoStock(data) {
  const r = data && typeof data === 'object' ? data : {};
  return { ok: true, ...r, replay: r.replay === true };
}

/**
 * Mensaje en español para errores de los contratos 084. Un error significa
 * que el servidor revirtió TODO: no hay nada que compensar en el cliente.
 */
export function mensajeErrorStock(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(typeof error === 'object' && error ? error.code : '');
  let m;
  if ((m = msg.match(/Stock insuficiente para ([^ ]+) en cuarto ([^:]+): disponible=(-?\d+), requerido=(\d+)/i))) {
    return `Stock insuficiente de ${m[1]} en ${m[2]} (disponible ${m[3]}, se requieren ${m[4]}). No se registró nada.`;
  }
  if ((m = msg.match(/Inventario insuficiente para cargar (\d+) de ([^ ]+) \(faltan (\d+)\)/i))) {
    return `Inventario insuficiente para cargar ${m[1]} de ${m[2]} (faltan ${m[3]}). No se registró nada.`;
  }
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Esta operación ya se registró con otros datos. Revisa antes de volver a intentar.';
  if (/ya tiene carga confirmada/i.test(msg)) return 'Esta carga ya fue confirmada.';
  if (/se requiere Pendiente firma/i.test(msg)) return 'La ruta no está esperando firma.';
  if (/no tiene carga real registrada/i.test(msg)) return 'No hay carga real registrada.';
  if (/supera lo autorizado/i.test(msg)) return 'La carga real supera lo autorizado.';
  if (/no pertenece a este chofer/i.test(msg)) return 'La ruta no pertenece a este chofer.';
  if (/ya está No entregada/i.test(msg)) return 'La orden ya estaba marcada como no entregada.';
  if (/no se puede marcar desde/i.test(msg)) return 'La orden no está en ruta.';
  if (/no está en una ruta/i.test(msg)) return 'La orden no está asignada a una ruta.';
  if (/carga a ruta se registra al firmar/i.test(msg)) return 'La carga a ruta se registra al firmar la carga, no como salida manual.';
  if (/SKU no encontrado/i.test(msg)) return 'El producto no existe.';
  if (/cuarto fr[ií]o no encontrado/i.test(msg)) return 'El cuarto frío no existe.';
  if (/origen y destino deben ser distintos/i.test(msg)) return 'Origen y destino deben ser diferentes.';
  if (/cantidad debe ser mayor a 0/i.test(msg)) return 'La cantidad debe ser mayor a 0.';
  if (/motivo requerido/i.test(msg)) return 'Captura el motivo.';
  if (/firma requerida/i.test(msg)) return 'Firma requerida.';
  if (/excepci[oó]n requiere motivo/i.test(msg)) return 'Justificación requerida para carga sin firma.';
  if (/no autorizado/i.test(msg) || code === '42501') return 'No tienes permiso para esta operación.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión con el servidor. Reintenta: la operación no se duplicará.';
  return msg || 'No se pudo registrar la operación. No se aplicó ningún cambio.';
}
