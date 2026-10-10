// barraVentaLogic.js — la venta de barra se captura como "barra entera / media barra" más
// cómo se entrega (sin preparar, picada o triturada). Lo que se vende es la barra; la picada y
// la triturada son solo la presentación de la entrega. Las líneas de la orden siguen siendo por
// SKU (crear_orden y completar_venta_directa no cambian): esta lógica traduce la elección a
// SKU y cantidad de bolsas. Las bolsas solo salen de "Preparar barra" (Producción / Admin); la
// venta nunca las prepara.
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

/**
 * Aviso cuando falta stock preparado. La venta no prepara: se lo pide a Producción.
 * @param {{ sku, qty }} r  resultado de resolverBarra
 * @param {(sku:string)=>number} getStock
 */
export function faltaPreparado(r, getStock) {
  if (!r?.sku || r.sku === BARRA_SKU) return null;
  const hay = n(getStock(r.sku));
  if (r.qty <= hay) return null;
  if (r.sku === MEDIA_BARRA_SKU) return `No hay media barra suficiente (hay ${hay}, se necesitan ${r.qty}). Pide a Producción que parta una barra.`;
  const tipo = r.sku === SKU_PICADA ? 'picada' : 'triturada';
  return `No hay ${tipo} preparada suficiente (hay ${hay}, se necesitan ${r.qty}). Pide a Producción que prepare la barra.`;
}
