// ventasCobroLogic.js — OL-01A (contención de honestidad en el cobro del
// vendedor). Lógica pura; no cambia el ciclo de vida, los contratos ni el
// inventario. Solo decide QUÉ acciones de cobro muestra Ventas y CUÁNDO la
// interfaz puede declarar éxito.
//
// Convención del store (supaStore): una acción devuelve `undefined`/`null` si
// tuvo éxito y un objeto de error si falló (el store ya mostró el toast de
// error). Nunca se declara éxito sin confirmarlo.
//
// Pendiente OL-02 (contrato atómico de cobro directo): el cobro de una orden
// 'Asignada' sin ruta sigue usando el flujo existente (estatus y pago en dos
// pasos, sin movimiento de inventario). Aquí solo se vuelve honesto; NO se
// declara seguro.

/** ¿La orden tiene una ruta real? (`ruta_id` o `rutaId`, como en Chofer). */
export function tieneRutaAsignada(orden) {
  if (!orden || typeof orden !== 'object') return false;
  const r = orden.ruta_id ?? orden.rutaId;
  return r !== null && r !== undefined && String(r).trim() !== '';
}

/**
 * Acciones que Ventas puede mostrar para una orden.
 *   Creada                → cobrar (diálogo existente: el link de pago sí
 *                           funciona; los demás métodos los rechaza el ciclo
 *                           de vida hasta OL-02 y el diálogo lo dice sin
 *                           fingir éxito) y enviar a ruta.
 *   Asignada sin ruta     → cobrar entrega (contrato existente).
 *   Asignada con ruta     → ninguna: la cobra el chofer de esa ruta.
 */
export function accionesCobroVentas(orden) {
  const estatus = orden && orden.estatus;
  const conRuta = tieneRutaAsignada(orden);
  return {
    cobrar: estatus === 'Creada',
    enviarARuta: estatus === 'Creada',
    cobrarEntrega: estatus === 'Asignada' && !conRuta,
    enRutaDelChofer: estatus === 'Asignada' && conRuta,
  };
}

/** Resultado del store: éxito solo si no devolvió nada. */
export function esExitoStore(resultado) {
  return resultado === undefined || resultado === null;
}

/**
 * Ejecuta una mutación del store y llama `onExito` SOLO si el resultado
 * confirma éxito. Las excepciones se propagan (la vista las reporta).
 * @returns {Promise<{ok: boolean, error?: any}>}
 */
export async function ejecutarMutacion(fn, { onExito } = {}) {
  const resultado = await fn();
  if (!esExitoStore(resultado)) return { ok: false, error: resultado };
  if (onExito) onExito();
  return { ok: true };
}
