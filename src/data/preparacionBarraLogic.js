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
    .filter(p => s(p?.tipo) === 'Producto Terminado' && !esSoloPreparacion(p?.sku));
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

/** ¿Esta fila es una preparación desde barra? */
export function esPreparacion(r) {
  return s(r?.tipo) === 'Preparacion';
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
  if (/Stock insuficiente/i.test(msg)) return 'No hay empaque suficiente para preparar esas bolsas.';
  if (/no tiene empaque configurado/i.test(msg)) return 'El producto preparado no tiene empaque configurado. Pídele a Admin que se lo asigne.';
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Esta preparación ya se registró con otros datos. Revisa el historial antes de repetirla.';
  if (/no autorizado/i.test(msg)) return 'Tu rol no puede preparar desde barra.';
  return msg || 'No se pudo registrar la preparación';
}
