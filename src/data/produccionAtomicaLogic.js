// produccionAtomicaLogic.js — lógica pura del frontend para los contratos
// atómicos de producción (mig 076): registrar_produccion y
// registrar_transformacion.
//
// El servidor decide todo lo autoritativo (actor, folio, empaque, costo,
// kardex, contabilidad). El cliente solo arma los parámetros de negocio,
// mantiene el operacion_id del intento lógico y traduce resultados/errores.

const txt = (v) => (v == null ? '' : String(v)).trim();

/** UUID v4 para un intento lógico de negocio. */
export function nuevoOperacionId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Clave estable de los datos de negocio de una producción. */
export function claveProduccion({ turno, maquina, sku, cantidad, destino } = {}) {
  return ['P', txt(turno), txt(maquina), txt(sku), Number(cantidad), txt(destino)].join('|');
}

/** Clave estable de los datos de negocio de una transformación. */
export function claveTransformacion({ input_sku, input_kg, output_sku, output_kg, cuarto_destino } = {}) {
  return ['T', txt(input_sku), Number(input_kg), txt(output_sku), Number(output_kg), txt(cuarto_destino)].join('|');
}

/**
 * Ciclo de vida del operacion_id: el UUID pertenece al intento lógico, no a
 * cada llamada HTTP. Mismos datos (reintento, doble click, respuesta
 * perdida) → mismo UUID; datos distintos → UUID nuevo. El componente lo
 * guarda en un ref y lo limpia tras un éxito o al reiniciar el formulario.
 * @returns {{clave:string, id:string}}
 */
export function resolverOperacion(prev, clave, gen = nuevoOperacionId) {
  if (prev && prev.clave === clave && prev.id) return prev;
  return { clave, id: gen() };
}

function entero(v, etiqueta) {
  const q = Number(v);
  if (!Number.isFinite(q) || q <= 0) return { error: `${etiqueta} debe ser mayor a 0` };
  if (!Number.isInteger(q)) return { error: `${etiqueta} debe ser un número entero` };
  return { q };
}

/**
 * Parámetros de registrar_produccion (nombres exactos de la RPC).
 * @returns {{args:Object}|{error:string}}
 */
export function buildRegistrarProduccionArgs({ operacionId, turno, maquina, sku, cantidad, destino } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(sku)) return { error: 'Selecciona el producto' };
  if (!txt(destino)) return { error: 'Selecciona el cuarto destino' };
  if (!txt(turno) || !txt(maquina)) return { error: 'Turno y máquina son obligatorios' };
  const c = entero(cantidad, 'La cantidad');
  if (c.error) return { error: c.error };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_turno: txt(turno),
      p_maquina: txt(maquina),
      p_sku: txt(sku),
      p_cantidad: c.q,
      p_cuarto_id: txt(destino),
    },
  };
}

/**
 * Parámetros de registrar_transformacion (nombres exactos de la RPC).
 * @returns {{args:Object}|{error:string}}
 */
export function buildRegistrarTransformacionArgs({ operacionId, input_sku, input_kg, output_sku, output_kg, cuarto_destino, notas } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (!txt(input_sku)) return { error: 'Selecciona el insumo' };
  if (!txt(output_sku)) return { error: 'Selecciona el producto destino' };
  if (txt(input_sku) === txt(output_sku)) return { error: 'El insumo y el producto destino deben ser distintos' };
  if (!txt(cuarto_destino)) return { error: 'Selecciona el cuarto destino' };
  const i = entero(input_kg, 'La entrada');
  if (i.error) return { error: i.error };
  const o = entero(output_kg, 'La salida');
  if (o.error) return { error: o.error };
  if (o.q > i.q) return { error: 'La salida no puede superar la entrada' };
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_input_sku: txt(input_sku),
      p_input_cantidad: i.q,
      p_output_sku: txt(output_sku),
      p_output_cantidad: o.q,
      p_cuarto_id: txt(cuarto_destino),
      p_notas: txt(notas) || null,
    },
  };
}

/** Resultado de registrar_produccion tal como lo devuelve el servidor. */
export function interpretarResultadoProduccion(data) {
  const r = data && typeof data === 'object' ? data : {};
  return {
    ok: true,
    id: r.id ?? null,
    folio: r.folio ?? null,
    sku: r.sku ?? null,
    cantidad: r.cantidad ?? null,
    cuartoId: r.cuarto_id ?? null,
    empaqueSku: r.empaque_sku ?? null,
    costoTotal: r.costo_total ?? null,
    replay: r.replay === true,
  };
}

/** Resultado de registrar_transformacion tal como lo devuelve el servidor. */
export function interpretarResultadoTransformacion(data) {
  const r = data && typeof data === 'object' ? data : {};
  return {
    ok: true,
    id: r.id ?? null,
    folio: r.folio ?? null,
    inputSku: r.input_sku ?? null,
    inputCantidad: r.input_cantidad ?? null,
    outputSku: r.output_sku ?? null,
    outputCantidad: r.output_cantidad ?? null,
    merma: r.merma ?? null,
    replay: r.replay === true,
  };
}

/**
 * Mensaje en español para errores de las RPCs 076. Un error significa que
 * el servidor revirtió TODO: no hay nada que compensar en el cliente.
 */
export function mensajeErrorProduccion(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(typeof error === 'object' && error ? error.code : '');
  let m;
  if ((m = msg.match(/Stock insuficiente de ([^:]+): disponible=(-?\d+), requerido=(\d+)/i))) {
    return `Stock insuficiente de ${m[1]} (disponible ${m[2]}, se requieren ${m[3]}). No se registró nada.`;
  }
  if (/operacion_id ya usado con otros datos/i.test(msg)) {
    return 'Esta operación ya se registró con otros datos. Revisa el historial antes de volver a intentar.';
  }
  if (/empaque .* no existe en el cat[aá]logo/i.test(msg)) return 'El empaque configurado para este producto no existe en el catálogo.';
  if (/empaque de .* apunta al mismo SKU/i.test(msg)) return 'El producto tiene configurado como empaque su propio SKU.';
  if (/cuarto fr[ií]o .* no existe/i.test(msg)) return 'El cuarto frío destino no existe.';
  if (/SKU no encontrado|no encontrado:/i.test(msg)) return 'El producto seleccionado no existe.';
  if (/no es Producto Terminado/i.test(msg)) return 'El producto destino debe ser Producto Terminado.';
  if (/no es un insumo/i.test(msg)) return 'El insumo debe ser Materia Prima o Insumo.';
  if (/salida no puede superar la entrada/i.test(msg)) return 'La salida no puede superar la entrada.';
  if (/deben ser distintos/i.test(msg)) return 'El insumo y el producto destino deben ser distintos.';
  if (/turno y m[aá]quina/i.test(msg)) return 'Turno y máquina son obligatorios.';
  if (/cantidad(es)? deben? ser mayor/i.test(msg)) return 'La cantidad debe ser mayor a 0.';
  if (/no autorizado/i.test(msg) || code === '42501') return 'No tienes permiso para registrar producción.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión con el servidor. Reintenta: la operación no se duplicará.';
  return msg || 'No se pudo registrar la operación. No se aplicó ningún cambio.';
}
