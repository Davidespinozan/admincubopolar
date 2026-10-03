// mermasLogic.js — lógica pura del contrato de mermas (Fase B / B1, mig 072).
//
// La merma es un evento server-authoritative e inmutable:
//   registrar_merma        (Admin / Producción; Chofer solo vía ruta)
//   registrar_mermas_ruta  (cierre de ruta: todo o nada, idempotente)
//   revertir_merma         (solo Admin; revierte los efectos persistidos)
// El cliente ya no descuenta stock, no crea egresos contables, no borra filas
// ni fotos de mermas. Estos helpers solo arman argumentos y traducen
// resultados; toda la autoridad vive en el servidor.

export const MERMA_ESTATUS = Object.freeze({ ACTIVA: 'Activa', REVERTIDA: 'Revertida' });

const txt = (v) => (v == null ? '' : String(v)).trim();

/**
 * ¿La merma sigue vigente? Filas sin estatus (caché previa a 072) cuentan
 * como activas.
 */
export function esMermaActiva(merma) {
  if (!merma || typeof merma !== 'object') return false;
  return txt(merma.estatus || MERMA_ESTATUS.ACTIVA) !== MERMA_ESTATUS.REVERTIDA;
}

/** Solo las mermas vigentes (para KPIs, reportes y stock). */
export function mermasActivas(list) {
  return Array.isArray(list) ? list.filter(esMermaActiva) : [];
}

/**
 * ¿Mostrar la acción de revertir? El servidor decide al final (una fila
 * legacy sin efectos registrados se rechaza allá); aquí solo se oculta lo
 * que ya se sabe imposible.
 * @returns {{ok:boolean, motivo?:string}}
 */
export function puedeRevertirMerma(merma) {
  if (!merma || typeof merma !== 'object' || merma.id == null) return { ok: false, motivo: 'Merma requerida' };
  if (!esMermaActiva(merma)) return { ok: false, motivo: 'La merma ya fue revertida' };
  return { ok: true };
}

/** Cantidad válida para el contrato: entero > 0. */
function cantidadEntera(v) {
  const q = Number(v);
  if (!Number.isFinite(q) || q <= 0) return { error: 'La cantidad debe ser mayor a 0' };
  if (!Number.isInteger(q)) return { error: 'La cantidad de merma debe ser un número entero' };
  return { q };
}

/**
 * Argumentos de `registrar_merma` (flujo de Producción / Admin). No existe
 * parámetro de usuario, delta de stock ni monto: el servidor los deriva.
 * @returns {{args:Object}|{error:string}}
 */
export function buildRegistrarMermaArgs({ sku, cantidad, causa, origen, foto } = {}) {
  const skuT = txt(sku);
  if (!skuT) return { error: 'Selecciona el producto de la merma' };
  const c = cantidadEntera(cantidad);
  if (c.error) return { error: c.error };
  const fotoT = txt(foto);
  return {
    args: {
      p_sku: skuT,
      p_cantidad: c.q,
      p_causa: txt(causa) || null,
      p_origen: txt(origen) || null,
      p_foto: fotoT || null,
    },
  };
}

/**
 * Payload de `registrar_mermas_ruta` desde las mermas locales del chofer
 * ({ sku, cant, causa, foto }). Descarta campos locales (id, hora).
 */
export function buildMermasRutaPayload(mermas) {
  return (Array.isArray(mermas) ? mermas : [])
    .filter(m => m && typeof m === 'object')
    .map(m => ({
      sku: txt(m.sku),
      cant: Number(m.cant ?? m.cantidad ?? 0),
      causa: txt(m.causa) || null,
      foto: txt(m.foto) || null,
    }));
}

/**
 * Merma de proceso de una transformación: sin efecto de stock propio (el
 * descuento ya ocurrió al transformar). El servidor valida el folio en
 * `produccion`, una sola merma por folio y cantidad ≤ merma_kg.
 * @returns {{args:Object}|{skip:true}}
 */
export function buildMermaTransformacionArgs({ input_sku, mermaKg, folio } = {}) {
  const q = Math.round(Number(mermaKg) || 0);
  if (q <= 0 || !txt(input_sku) || !txt(folio)) return { skip: true };
  return {
    args: {
      p_sku: txt(input_sku),
      p_cantidad: q,
      p_causa: 'Merma de proceso — transformación',
      p_origen: `Transformación ${txt(folio)}`,
      p_foto: null,
      p_ruta_id: null,
      p_afecta_stock: false,
    },
  };
}

/**
 * Mensaje en español para errores del contrato de mermas.
 * @param {{message?:string, code?:string}|string|null} error
 */
export function mensajeErrorMerma(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(typeof error === 'object' && error ? error.code : '');
  if (/es legacy/i.test(msg)) {
    return 'Esta merma es anterior al registro con efectos exactos y no se puede revertir automáticamente. Ajusta el inventario manualmente.';
  }
  if (/ya fue revertida/i.test(msg)) return 'La merma ya estaba revertida.';
  if (/Stock insuficiente/i.test(msg)) return msg.replace(/^.*?(Stock insuficiente)/i, '$1');
  if (/no pertenece al chofer/i.test(msg)) return 'La ruta no pertenece a este chofer.';
  if (/foto no pertenece|ruta de foto inválida|foto no existe|foto ya está ligada|foto demasiado grande/i.test(msg)) {
    return 'La foto de evidencia no es válida. Tómala de nuevo.';
  }
  if (/SKU no encontrado/i.test(msg)) return 'El producto de la merma no existe.';
  if (/cantidad/i.test(msg) && /mayor a 0|entera|inválida/i.test(msg)) return 'La cantidad de merma debe ser un entero mayor a 0.';
  if (/no autorizado/i.test(msg) || code === '42501') return 'No tienes permiso para esta operación de mermas.';
  if (/cuarto .* ya no existe/i.test(msg)) return 'El cuarto frío original ya no existe; no se puede revertir automáticamente.';
  return msg || 'Error en la operación de mermas';
}

/**
 * 106: costo de empaque ESTIMADO por unidad de un producto terminado, para
 * análisis de mermas (memo). Es el costo promedio ACTUAL del empaque que usa
 * el producto: no es el costo histórico exacto de las unidades perdidas, no
 * es costo completo de manufactura y no genera asiento (el empaque ya se
 * reconoció como costo al producir).
 * @param {string} sku
 * @param {Array} productos — catálogo ({ sku, tipo, empaqueSku|empaque_sku, costoUnitario|costo_unitario })
 * @returns {number}
 */
export function costoEmpaqueEstimado(sku, productos) {
  const lista = Array.isArray(productos) ? productos : [];
  const p = lista.find(x => String(x?.sku ?? '') === String(sku ?? ''));
  const empSku = String(p?.empaqueSku ?? p?.empaque_sku ?? '').trim();
  if (!p || !empSku) return 0;
  const emp = lista.find(x => String(x?.sku ?? '') === empSku && String(x?.tipo ?? '') === 'Empaque');
  const c = Number(emp?.costoUnitario ?? emp?.costo_unitario ?? 0);
  return Number.isFinite(c) && c > 0 ? c : 0;
}
