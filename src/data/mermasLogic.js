// mermasLogic.js — lógica pura para flujo de mermas (sin Supabase).
// Extraída de actions.borrarMermaConReverso (supaStore.js) para que sea
// testeable sin mocks. Las partes I/O del store consumen estos helpers.

/**
 * Decide a qué cuarto frío regresar el stock de una merma borrada.
 * Estrategia FIFO inverso: el primer cuarto activo en el orden recibido.
 * Asume que `cuartos` viene ordenado por id (como retorna supabase).
 *
 * @param {Array<{id:any, nombre?:string}>} cuartos - Lista de cuartos disponibles
 * @returns {{id:any, nombre?:string}|null}  El cuarto destino o null si no hay
 */
export function seleccionarCuartoFIFOInverso(cuartos) {
  if (!Array.isArray(cuartos) || cuartos.length === 0) return null;
  return cuartos[0];
}

/**
 * Valida si una merma puede revertirse (cantidad > 0, sku presente).
 * Defensivo: la BD tiene CHECK cantidad > 0 pero validamos por si llega
 * un row corrupto o de una versión vieja.
 *
 * @param {Object} merma - Row de tabla mermas (sku, cantidad)
 * @returns {{error:string}|null}  null si puede revertirse
 */
export function validarMermaParaReverso(merma) {
  if (!merma || typeof merma !== 'object') {
    return { error: 'Merma requerida' };
  }
  if (!merma.sku || !String(merma.sku).trim()) {
    return { error: 'SKU de merma faltante' };
  }
  const cant = Number(merma.cantidad);
  if (!Number.isFinite(cant) || cant <= 0) {
    return { error: 'Cantidad de merma inválida' };
  }
  return null;
}

/**
 * Construye el objeto change para la RPC `update_stocks_atomic`.
 * El delta es POSITIVO (entrada) porque estamos revirtiendo una merma.
 *
 * @param {Object} merma           Row con sku, cantidad, causa, id
 * @param {Object} cuartoDestino   Cuarto seleccionado por FIFO inverso
 * @param {string} usuario         Usuario que ejecuta el reverso
 * @returns {Object}               Change para p_changes del RPC
 */
export function buildReversoMermaChange(merma, cuartoDestino, usuario) {
  const cant = Number(merma.cantidad);
  const causa = String(merma.causa || '').trim() || 'sin causa';
  return {
    cuarto_id: cuartoDestino.id,
    sku: String(merma.sku),
    delta: cant,
    tipo: 'Reverso merma',
    origen: `Borrado merma id=${merma.id} (${causa})`,
    usuario: String(usuario || 'Admin'),
  };
}

/**
 * Genera el patrón LIKE para encontrar el egreso contable asociado a
 * una merma. El concepto al registrarse es: "Merma {qty}× {sku} (...) — ..."
 * Buscamos el prefijo que es estable entre registros distintos.
 *
 * @param {Object} merma - Row con sku, cantidad
 * @returns {string}     Substring para usar en `.ilike(concepto, '%...%')`
 */
export function matchConceptoMerma(merma) {
  const cant = Number(merma.cantidad);
  return `Merma ${cant}× ${String(merma.sku)}`;
}

/**
 * Decide qué hacer con los movimientos contables que matchean una merma:
 *   - 0 matches → no borrar nada (no había egreso registrado)
 *   - 1 match  → borrar (limpieza completa)
 *   - 2+ matches → NO borrar automáticamente, avisar al usuario
 *
 * @param {Array} movs - Resultado de la query de movimientos_contables filtrados
 * @returns {{accion:'noop'|'delete'|'aviso', id?:any}}
 */
export function decidirBorrarMovimientoContable(movs) {
  const arr = Array.isArray(movs) ? movs : [];
  if (arr.length === 0) return { accion: 'noop' };
  if (arr.length === 1) return { accion: 'delete', id: arr[0].id };
  return { accion: 'aviso' };
}
