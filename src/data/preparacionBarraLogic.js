// preparacionBarraLogic.js — OP-01D: modelo de barra de septiembre 2026.
//
// Operación física (dueño): la Máquina Barra produce barras de ~50 kg; 1 barra
// física = 1 unidad de inventario (sin empaque). Una barra se vende completa o
// se pica / tritura: 1 barra rinde 2 bolsas y consume 2 empaques del producto
// preparado (el empaque CONFIGURADO en el catálogo, no uno fijo). Se prepara
// siempre por barras enteras; vender después lo ya preparado no vuelve a
// consumir barra ni empaque. Las Transformaciones de agosto quedaron
// reemplazadas por este flujo. El servidor (registrar_preparacion_barra,
// migración 115) decide; aquí solo se arma la petición y la vista previa.
import { n, s } from '../utils/safe';
import { nuevoOperacionId, resolverOperacion } from './produccionAtomicaLogic.js';

export { nuevoOperacionId, resolverOperacion };

/** Barra de hielo ~50 kg: la unidad física base. Mismas constantes que la migración 115. */
export const BARRA_SKU = 'HIB-50K';
/** Preparaciones permitidas desde barra (bolsas): picada y triturada. */
export const SALIDAS_BARRA = Object.freeze(['HIP-25K', 'HIT-25K']);
export const BOLSAS_POR_BARRA = 2;
/** Media barra (129): solo nace de partir una barra entera; no se produce por máquina. */
export const MEDIA_BARRA_SKU = 'HIB-25K';
export const MEDIAS_POR_BARRA = 2;
/** Qué puede quedar de cada mitad al desglosar una barra. */
export const DESTINOS_MITAD = Object.freeze(['media', 'picada', 'triturada']);
/** Máquinas de la planta (texto libre en produccion.maquina). */
export const MAQUINAS_PRODUCCION = Object.freeze(['Máquina 30', 'Máquina 20', 'Máquina 15', 'Máquina Barra']);

/** ¿Este SKU se produce intencionalmente SIN empaque? (solo la barra). */
export function seProduceSinEmpaque(sku) {
  return s(sku) === BARRA_SKU;
}

/** ¿Este SKU solo nace de "Preparar desde barra" (no de una máquina)? */
export function esSoloPreparacion(sku) {
  return SALIDAS_BARRA.includes(s(sku));
}

/** Productos que se registran en Producción: terminados, sin las bolsas preparadas desde barra. */
export function skusProducibles(productos) {
  return (Array.isArray(productos) ? productos : [])
    .filter(p => s(p?.tipo) === 'Producto Terminado' && !esSoloPreparacion(p?.sku) && s(p?.sku) !== MEDIA_BARRA_SKU);
}

const prod = (productos, sku) => (Array.isArray(productos) ? productos : []).find(p => s(p?.sku) === s(sku)) || null;
const empaqueDe = (p) => s(p?.empaqueSku ?? p?.empaque_sku) || null;

/**
 * Vista previa ANTES de confirmar: "3 barras → 6 bolsas de Picada de barra"
 * y "Se consumirán 6 empaques EMP-25". Bloquea si falta empaque configurado,
 * empaque en existencia o barras en el cuarto.
 */
export function vistaPreviaPreparacion({ productos, cuartos, cuartoId, salidaSku, barras } = {}) {
  const nBarras = Number.isInteger(Number(barras)) ? Number(barras) : NaN;
  const bolsas = nBarras * BOLSAS_POR_BARRA;
  const salida = prod(productos, salidaSku);
  const empaqueSku = empaqueDe(salida);
  const empaque = empaqueSku ? prod(productos, empaqueSku) : null;
  const empaqueStock = empaque ? n(empaque.stock) : 0;
  const cuarto = (Array.isArray(cuartos) ? cuartos : []).find(c => s(c?.id) === s(cuartoId)) || null;
  const barrasDisponibles = cuarto ? n(cuarto.stock?.[BARRA_SKU]) : 0;
  const nombreSalida = s(salida?.nombre) || s(salidaSku);
  let bloqueo = null;
  if (!esSoloPreparacion(salidaSku) || !salida) bloqueo = { codigo: 'salida', mensaje: 'Elige picada o triturada' };
  else if (!cuarto) bloqueo = { codigo: 'cuarto', mensaje: 'Elige el cuarto frío' };
  else if (!Number.isInteger(nBarras) || nBarras < 1) bloqueo = { codigo: 'barras', mensaje: 'Captura cuántas barras enteras vas a preparar' };
  else if (!empaqueSku) bloqueo = { codigo: 'sin_empaque', mensaje: `${nombreSalida} no tiene empaque configurado. Pídele a Admin que se lo asigne en el catálogo.` };
  else if (bolsas > empaqueStock) bloqueo = { codigo: 'empaque_insuficiente', mensaje: `No hay empaque suficiente: se necesitan ${bolsas} ${empaqueSku} y hay ${empaqueStock}.` };
  else if (nBarras > barrasDisponibles) bloqueo = { codigo: 'barras_insuficientes', mensaje: `No hay barras suficientes en ese cuarto: pides ${nBarras} y hay ${barrasDisponibles}.` };
  const listo = Number.isInteger(nBarras) && nBarras >= 1;
  return {
    barras: listo ? nBarras : 0,
    bolsas: listo ? bolsas : 0,
    salidaSku: s(salidaSku),
    nombreSalida,
    empaqueSku,
    empaqueStock,
    barrasDisponibles,
    resumen: listo ? `${nBarras} ${nBarras === 1 ? 'barra' : 'barras'} → ${bolsas} bolsas de ${nombreSalida}` : '',
    consumo: listo && empaqueSku ? `Se consumirán ${bolsas} empaques ${empaqueSku}` : '',
    bloqueo,
  };
}

/** Clave estable de la petición lógica: mismo intento → mismo operacion_id. */
export function clavePreparacion({ cuartoId, salidaSku, barras } = {}) {
  return ['PB', BARRA_SKU, s(salidaSku), s(cuartoId), Number(barras)].join('|');
}

/** Argumentos de registrar_preparacion_barra (o un error de validación local). */
export function buildPreparacionArgs({ operacionId, cuartoId, salidaSku, barras } = {}) {
  const nBarras = Number(barras);
  if (!operacionId) return { error: 'Falta el identificador de la operación' };
  if (!esSoloPreparacion(salidaSku)) return { error: 'Elige picada o triturada' };
  if (!s(cuartoId)) return { error: 'Elige el cuarto frío' };
  if (!Number.isInteger(nBarras) || nBarras < 1) return { error: 'Se prepara al menos 1 barra entera' };
  return {
    args: { p_operacion_id: operacionId, p_barra_sku: BARRA_SKU, p_salida_sku: s(salidaSku), p_cuarto_id: s(cuartoId), p_barras: nBarras },
  };
}

/** ¿Esta fila es una preparación (desde barra o desde media barra)? */
export function esPreparacion(r) {
  return s(r?.tipo) === 'Preparacion';
}

/** ¿Esta fila es una barra partida en dos medias (129)? */
export function esPartido(r) {
  return s(r?.tipo) === 'Partido';
}

/** Filas que transforman inventario ya producido: no son "producido hoy" ni cuentan como producción de máquina. */
export function esFilaDerivada(r) {
  return esPreparacion(r) || esPartido(r);
}

const inputSkuDe = (r) => s(r?.input_sku ?? r?.inputSku);
/** Barras enteras que consumió una fila (preparación de barra entera o partido). */
export function barrasUsadasFila(r) {
  if (!esFilaDerivada(r) || inputSkuDe(r) !== BARRA_SKU) return 0;
  return n(r?.input_kg ?? r?.inputKg);
}

/** Texto de una fila derivada para el historial. */
export function textoFilaDerivada(r) {
  const q = n(r?.input_kg ?? r?.inputKg);
  const nom = s(r?.sku);
  if (esPartido(r)) return `${q} ${q === 1 ? 'barra' : 'barras'} → ${n(r?.cantidad)} × ${nom} (partida)`;
  if (inputSkuDe(r) === MEDIA_BARRA_SKU) return `${q} ${q === 1 ? 'media barra' : 'medias barras'} → ${n(r?.cantidad)} × ${nom}`;
  return `${q} ${q === 1 ? 'barra' : 'barras'} → ${n(r?.cantidad)} × ${nom}`;
}

/**
 * Plan al desglosar N barras: cada barra son dos mitades y cada mitad queda como media barra,
 * picada o triturada. Devuelve cuántas medias se parten, cuántas se preparan a cada bolsa y
 * cuántas quedan como media barra.
 */
export function planDesglose({ barras, mitadA, mitadB } = {}) {
  const nb = Number(barras);
  const ok = Number.isInteger(nb) && nb >= 1 && DESTINOS_MITAD.includes(mitadA) && DESTINOS_MITAD.includes(mitadB);
  if (!ok) return { valido: false, barras: 0, medias: 0, picada: 0, triturada: 0, quedanMedias: 0 };
  const cuenta = (d) => nb * ((mitadA === d ? 1 : 0) + (mitadB === d ? 1 : 0));
  return { valido: true, barras: nb, medias: nb * MEDIAS_POR_BARRA, picada: cuenta('picada'), triturada: cuenta('triturada'), quedanMedias: cuenta('media') };
}

/**
 * Vista previa del desglose. Bloquea si falta el producto media barra, empaque o barras.
 * El empaque se suma por SKU (picada y triturada pueden compartir empaque).
 */
export function vistaPreviaDesglose({ productos, cuartos, cuartoId, barras, mitadA, mitadB } = {}) {
  const plan = planDesglose({ barras, mitadA, mitadB });
  const cuarto = (Array.isArray(cuartos) ? cuartos : []).find(c => s(c?.id) === s(cuartoId)) || null;
  const barrasDisponibles = cuarto ? n(cuarto.stock?.[BARRA_SKU]) : 0;
  const hayMedia = !!prod(productos, MEDIA_BARRA_SKU);
  const partes = [];
  if (plan.quedanMedias) partes.push(`${plan.quedanMedias} ${plan.quedanMedias === 1 ? 'media barra' : 'medias barras'}`);
  if (plan.picada) partes.push(`${plan.picada} ${plan.picada === 1 ? 'bolsa' : 'bolsas'} de picada`);
  if (plan.triturada) partes.push(`${plan.triturada} ${plan.triturada === 1 ? 'bolsa' : 'bolsas'} de triturada`);
  const empaques = {};
  for (const [sku, q] of [['HIP-25K', plan.picada], ['HIT-25K', plan.triturada]]) {
    if (!q) continue;
    const e = empaqueDe(prod(productos, sku));
    if (!e) return { plan, barrasDisponibles, resumen: '', bloqueo: { codigo: 'sin_empaque', mensaje: `${sku} no tiene empaque configurado. Pídele a Admin que se lo asigne en el catálogo.` } };
    empaques[e] = (empaques[e] || 0) + q;
  }
  let bloqueo = null;
  if (!plan.valido) bloqueo = { codigo: 'datos', mensaje: 'Elige las barras y qué queda de cada mitad' };
  else if (!cuarto) bloqueo = { codigo: 'cuarto', mensaje: 'Elige el cuarto frío' };
  else if (!hayMedia) bloqueo = { codigo: 'sin_media', mensaje: 'El producto "Media barra" aún no está en el catálogo (falta aplicar la migración 129).' };
  else if (plan.barras > barrasDisponibles) bloqueo = { codigo: 'barras_insuficientes', mensaje: `No hay barras suficientes en ese cuarto: pides ${plan.barras} y hay ${barrasDisponibles}.` };
  else {
    for (const [e, q] of Object.entries(empaques)) {
      const st = n(prod(productos, e)?.stock);
      if (q > st) { bloqueo = { codigo: 'empaque_insuficiente', mensaje: `No hay empaque suficiente: se necesitan ${q} ${e} y hay ${st}.` }; break; }
    }
  }
  return {
    plan, barrasDisponibles, empaques, bloqueo,
    resumen: plan.valido ? `${plan.barras} ${plan.barras === 1 ? 'barra' : 'barras'} → ${partes.join(' + ')}` : '',
    consumo: plan.valido && Object.keys(empaques).length ? `Se consumirán ${Object.entries(empaques).map(([e, q]) => `${q} ${e}`).join(' y ')}` : '',
  };
}

/** Argumentos de partir_barra. */
export function buildPartirArgs({ operacionId, cuartoId, barras } = {}) {
  const nb = Number(barras);
  if (!operacionId) return { error: 'Falta el identificador de la operación' };
  if (!s(cuartoId)) return { error: 'Elige el cuarto frío' };
  if (!Number.isInteger(nb) || nb < 1) return { error: 'Se parte al menos 1 barra entera' };
  return { args: { p_operacion_id: operacionId, p_cuarto_id: s(cuartoId), p_barras: nb } };
}

/** Argumentos de registrar_preparacion_media. */
export function buildPreparacionMediaArgs({ operacionId, cuartoId, salidaSku, medias } = {}) {
  const nm = Number(medias);
  if (!operacionId) return { error: 'Falta el identificador de la operación' };
  if (!SALIDAS_BARRA.includes(s(salidaSku))) return { error: 'Elige picada o triturada' };
  if (!s(cuartoId)) return { error: 'Elige el cuarto frío' };
  if (!Number.isInteger(nm) || nm < 1) return { error: 'Se prepara al menos 1 media barra' };
  return { args: { p_operacion_id: operacionId, p_salida_sku: s(salidaSku), p_cuarto_id: s(cuartoId), p_medias: nm } };
}

/** Clave estable del desglose: mismo intento → mismos operacion_id. */
export function claveDesglose({ cuartoId, barras, mitadA, mitadB } = {}) {
  return ['DG', s(cuartoId), Number(barras), s(mitadA), s(mitadB)].join('|');
}

/** Reversibilidad de una preparación (espejo de revertir_preparacion_barra; el servidor decide). */
export function reversibilidadPreparacion(r) {
  if (!esPreparacion(r)) return { reversible: false, razon: 'No es una preparación desde barra' };
  if (s(r.estatus) === 'Revertida' || r.revertidaAt || r.revertida_at) return { reversible: false, razon: 'Ya fue revertida' };
  if (s(r.estatus) !== 'Confirmada') return { reversible: false, razon: `No está confirmada (${s(r.estatus) || 'sin estatus'})` };
  return { reversible: true, razon: null };
}

/** Mensaje entendible para el empleado a partir del error del servidor. */
export function mensajeErrorPreparacion(error) {
  const msg = s(error?.message ?? error);
  if (/Stock insuficiente.*HIB-50K/i.test(msg)) return 'No hay barras suficientes en ese cuarto.';
  if (/Stock insuficiente.*HIB-25K/i.test(msg)) return 'No hay medias barras suficientes en ese cuarto.';
  if (/Stock insuficiente/i.test(msg)) return 'No hay empaque suficiente para preparar esas bolsas.';
  if (/no tiene empaque configurado/i.test(msg)) return 'El producto preparado no tiene empaque configurado. Pídele a Admin que se lo asigne.';
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Esta preparación ya se registró con otros datos. Revisa el historial antes de repetirla.';
  if (/no autorizado/i.test(msg)) return 'Tu rol no puede preparar desde barra.';
  return msg || 'No se pudo registrar la preparación';
}
