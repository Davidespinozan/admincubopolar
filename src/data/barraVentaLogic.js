// barraVentaLogic.js — la venta de barra se captura como "barra entera / media barra" más
// cómo se entrega (sin preparar, picada o triturada). Lo que se vende es la barra; la picada y
// la triturada son solo la presentación de la entrega. Las líneas de la orden siguen siendo por
// SKU (crear_orden y completar_venta_directa no cambian): esta lógica traduce la elección a
// SKU y cantidad de bolsas.
// 133: la media barra, la picada y la triturada se venden contra la BARRA ENTERA. Lo ya partido
// o preparado se usa primero; lo que falte lo saca el servidor de la barra al entregar
// (parte / prepara en el mismo cuarto). `faltanteBarra` es el espejo de barra_exigir_disponible.
//
//   entera + sin preparar → HIB-50K × cantidad
//   entera + picada       → HIP-25K × 2·cantidad   (una barra rinde 2 bolsas)
//   entera + triturada    → HIT-25K × 2·cantidad
//   media  + picada       → HIP-25K × cantidad     (una bolsa = media barra)
//   media  + triturada    → HIT-25K × cantidad
//   media  + sin preparar → HIB-25K × cantidad     (media barra, 129; sin la migración no existe)
import { s, n } from '../utils/safe';
import { BARRA_SKU, SALIDAS_BARRA, BOLSAS_POR_BARRA, MEDIA_BARRA_SKU } from './preparacionBarraLogic.js';

export const SKU_PICADA = SALIDAS_BARRA[0];
export const SKU_TRITURADA = SALIDAS_BARRA[1];
export const MEDIDAS = Object.freeze(['entera', 'media']);
export const ENTREGAS = Object.freeze(['sin', 'picada', 'triturada']);

/** ¿Este SKU es parte de la familia de la barra (la barra y sus dos presentaciones)? */
export const esSkuBarra = (sku) => s(sku) === BARRA_SKU || s(sku) === MEDIA_BARRA_SKU || SALIDAS_BARRA.includes(s(sku));

/** Productos que se ofrecen en el selector de venta: sin la picada ni la triturada como productos sueltos. */
export const productosParaVenta = (productos) =>
  (Array.isArray(productos) ? productos : []).filter(p => !SALIDAS_BARRA.includes(s(p?.sku)) && s(p?.sku) !== MEDIA_BARRA_SKU);

/** ¿El catálogo ya tiene la media barra (migración 129)? */
export const hayMediaBarra = (productos) => (Array.isArray(productos) ? productos : []).some(p => s(p?.sku) === MEDIA_BARRA_SKU);

export const barraPorOmision = () => ({ medida: 'entera', entrega: 'sin', cant: 1 });

/**
 * Traduce la elección a la línea real de la orden.
 * @returns {{ sku: string|null, qty: number, bloqueo: string|null }}
 */
export function resolverBarra({ medida, entrega, cant } = {}, { hayMedia = true } = {}) {
  const c = Math.max(1, Math.floor(n(cant)) || 1);
  if (!MEDIDAS.includes(medida) || !ENTREGAS.includes(entrega)) return { sku: null, qty: 0, bloqueo: 'Elige la medida y la entrega' };
  if (entrega === 'sin') {
    if (medida === 'media') {
      if (!hayMedia) return { sku: null, qty: 0, bloqueo: 'La media barra sin preparar aún no está disponible: elige picada o triturada' };
      return { sku: MEDIA_BARRA_SKU, qty: c, bloqueo: null };
    }
    return { sku: BARRA_SKU, qty: c, bloqueo: null };
  }
  const sku = entrega === 'picada' ? SKU_PICADA : SKU_TRITURADA;
  return { sku, qty: medida === 'entera' ? c * BOLSAS_POR_BARRA : c, bloqueo: null };
}

/** Texto para el vendedor: "2 bolsas de picada (1 barra)". */
export function resumenBarra({ medida, entrega, cant } = {}) {
  const r = resolverBarra({ medida, entrega, cant });
  if (r.bloqueo || !r.sku) return '';
  const c = Math.max(1, Math.floor(n(cant)) || 1);
  if (r.sku === BARRA_SKU) return `${c} ${c === 1 ? 'barra entera' : 'barras enteras'}`;
  if (r.sku === MEDIA_BARRA_SKU) return `${c} ${c === 1 ? 'media barra' : 'medias barras'} sin preparar`;
  const tipo = r.sku === SKU_PICADA ? 'picada' : 'triturada';
  const bolsas = `${r.qty} ${r.qty === 1 ? 'bolsa' : 'bolsas'} de ${tipo}`;
  return medida === 'entera' ? `${bolsas} (${c} ${c === 1 ? 'barra' : 'barras'})` : `${bolsas} (${c === 1 ? 'media barra' : c + ' medias barras'})`;
}

export const SKUS_DERIVADOS = Object.freeze([MEDIA_BARRA_SKU, SKU_PICADA, SKU_TRITURADA]);
/** ¿Sale de partir o preparar una barra? (media, picada o triturada) */
export const esDerivadoBarra = (sku) => SKUS_DERIVADOS.includes(s(sku));

const cant = (v) => Math.max(0, Math.floor(n(v)) || 0);
/**
 * Medias barras que FALTAN para surtir un pedido con una existencia (0 = alcanza).
 * 1 barra = 2 medias; 1 media = 1 bolsa de picada o de triturada. La barra que se
 * vende entera no se puede partir además.
 * @param {Object<string, number>} pedido  { sku: cantidad }
 * @param {(sku:string)=>number} getStock  existencia (de un cuarto o de toda la planta)
 */
export function faltanteBarra(pedido, getStock) {
  const p = pedido || {};
  const m = cant(p[MEDIA_BARRA_SKU]); const pi = cant(p[SKU_PICADA]); const tr = cant(p[SKU_TRITURADA]);
  if (m + pi + tr === 0) return 0;
  const barrasLibres = Math.max(cant(getStock(BARRA_SKU)) - cant(p[BARRA_SKU]), 0);
  const falta = Math.max(pi - cant(getStock(SKU_PICADA)), 0) + Math.max(tr - cant(getStock(SKU_TRITURADA)), 0) + m
    - cant(getStock(MEDIA_BARRA_SKU)) - BOLSAS_POR_BARRA * barrasLibres;
  return Math.max(falta, 0);
}

/** Cuántas unidades de un derivado puede dar una existencia: lo ya hecho + medias sueltas + 2 por barra entera. */
export function disponibleDerivado(sku, getStock) {
  const k = s(sku);
  if (!esDerivadoBarra(k)) return cant(getStock(k));
  const medias = cant(getStock(MEDIA_BARRA_SKU));
  return (k === MEDIA_BARRA_SKU ? 0 : cant(getStock(k))) + medias + BOLSAS_POR_BARRA * cant(getStock(BARRA_SKU));
}

/** Aviso para el vendedor cuando la barra no alcanza para el pedido completo; null si alcanza. */
export function avisoFaltaBarra(pedido, getStock, donde = '') {
  const falta = faltanteBarra(pedido, getStock);
  if (falta === 0) return null;
  const b = cant(getStock(BARRA_SKU)); const m = cant(getStock(MEDIA_BARRA_SKU));
  return `No hay barra suficiente${donde ? ` en ${donde}` : ''}: hay ${b} ${b === 1 ? 'barra entera' : 'barras enteras'}${m ? ` y ${m} ${m === 1 ? 'media' : 'medias'}` : ''}; `
    + `faltan ${falta} ${falta === 1 ? 'media' : 'medias'} para este pedido.`;
}

/**
 * Aviso de una sola línea de barra (compatibilidad). Con 133 ya no pide "preparado":
 * alcanza mientras haya barra entera (o algo ya partido / preparado).
 * @param {{ sku, qty }} r  resultado de resolverBarra
 * @param {(sku:string)=>number} getStock
 */
export function faltaPreparado(r, getStock) {
  if (!r?.sku || r.sku === BARRA_SKU) return null;
  return avisoFaltaBarra({ [r.sku]: r.qty }, getStock);
}
