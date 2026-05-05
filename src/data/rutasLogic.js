// rutasLogic.js — lógica pura de rutas / cierre de ruta
import { centavos } from '../utils/safe';

/**
 * Estados terminales de una ruta. No se puede editar/cancelar/reasignar.
 * Mantener en sync con el ENUM `estatus_ruta` (mig 001/002 + 039).
 */
const ESTADOS_TERMINALES_RUTA = new Set(['Cerrada', 'Cancelada', 'Completada']);

/**
 * Valida si una ruta puede editarse según su estatus actual.
 * Bloquea si está en estado terminal (cerrada, cancelada, completada) —
 * editar carga/chofer/camión a una ruta histórica corrompe los datos
 * del cierre y los reportes.
 *
 * @param {string} estatusActual
 * @returns {{ error: string }|null}
 */
export function validateEdicionRuta(estatusActual) {
  const est = String(estatusActual || '').trim();
  if (ESTADOS_TERMINALES_RUTA.has(est)) {
    return {
      error: 'No se puede editar una ruta cerrada, cancelada o completada',
    };
  }
  return null;
}

/**
 * Convierte el objeto de devoluciones en texto legible para el log.
 * @param {Record<string, number>} devolucionObj — { "HC-5K": 3, "HC-25K": 0 }
 * @returns {string} — "3×HC-5K" | "0" si todo es 0
 */
export function formatDevolucion(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') return '0';
  const parts = Object.entries(devolucionObj)
    .filter(([, v]) => Number(v) > 0)
    .map(([sku, qty]) => `${qty}×${sku}`);
  return parts.length > 0 ? parts.join(', ') : '0';
}

/**
 * Valida que un objeto de devoluciones sea coherente:
 * - Todos los valores deben ser números >= 0
 * - Al menos un SKU reconocido (no vacío)
 * @param {Record<string, number>} devolucionObj
 * @returns {string|null} — mensaje de error o null si es válido
 */
export function validateDevolucion(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') {
    return 'Devolución debe ser un objeto';
  }
  for (const [sku, qty] of Object.entries(devolucionObj)) {
    if (!sku || typeof sku !== 'string') return 'SKU inválido en devolución';
    if (!Number.isFinite(Number(qty)) || Number(qty) < 0) {
      return `Cantidad inválida para ${sku}: ${qty}`;
    }
  }
  return null;
}

/**
 * Calcula el total de unidades devueltas al cuarto frío.
 * @param {Record<string, number>} devolucionObj
 * @returns {number}
 */
export function totalDevuelto(devolucionObj) {
  if (!devolucionObj || typeof devolucionObj !== 'object') return 0;
  return Object.values(devolucionObj).reduce((sum, v) => sum + Number(v || 0), 0);
}

/**
 * Normaliza el argumento de devolución — acepta número legacy o objeto nuevo.
 * @param {number|Record<string, number>} devolucion
 * @returns {Record<string, number>}
 */
export function normalizeDevolucion(devolucion) {
  if (typeof devolucion === 'object' && devolucion !== null) return devolucion;
  return { bolsas: Number(devolucion) || 0 };
}

/**
 * Calcula totales de cobro de un reporte de cierre de ruta.
 * @param {Array<{monto: number, metodo_pago: string}>} cobros
 * @returns {{ totalEfectivo, totalTransferencia, totalCredito, totalCobrado }}
 */
export function calcTotalesCobro(cobros = []) {
  let totalEfectivo = 0;
  let totalTransferencia = 0;
  let totalCredito = 0;

  for (const c of cobros) {
    const monto = Number(c.monto || 0);
    const metodo = (c.metodo_pago || c.metodoPago || '').toLowerCase();
    if (metodo.includes('efectivo'))       totalEfectivo      = centavos(totalEfectivo + monto);
    else if (metodo.includes('transfer') || metodo.includes('spei')) totalTransferencia = centavos(totalTransferencia + monto);
    else if (metodo.includes('crédito') || metodo.includes('credito')) totalCredito = centavos(totalCredito + monto);
    else                                   totalEfectivo      = centavos(totalEfectivo + monto);
  }

  const totalCobrado = centavos(totalEfectivo + totalTransferencia + totalCredito);
  return { totalEfectivo, totalTransferencia, totalCredito, totalCobrado };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para confirmarCargaRuta / firmarCarga / solicitarFirmaCarga
//
// Estos helpers reflejan EXACTAMENTE el comportamiento actual del store.
// Si una validación parece floja (ej. permitir cargaReal {}) es a propósito:
// el código original lo permite y no se arregla aquí (fuera de scope de la
// fase Bloque 4 PR 4a).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida los argumentos de entrada de confirmarCargaRuta / solicitarFirmaCarga.
 * @param {string|number} rutaId
 * @param {Record<string, number>} cargaReal
 * @returns {{error: string} | null}
 */
export function validateConfirmarCarga(rutaId, cargaReal) {
  if (!rutaId) return { error: 'Datos de carga inválidos' };
  if (!cargaReal || typeof cargaReal !== 'object') return { error: 'Datos de carga inválidos' };
  return null;
}

/**
 * Valida los argumentos de entrada de firmarCarga.
 * Refleja los 3 checks actuales: rutaId, firma o motivoExcepcion, justificación.
 * @param {string|number} rutaId
 * @param {string|null} firmaBase64
 * @param {{excepcion?: boolean, motivoExcepcion?: string}} opciones
 * @returns {{error: string} | null}
 */
export function validateFirmarCarga(rutaId, firmaBase64, opciones = {}) {
  if (!rutaId) return { error: 'Sin ruta' };
  if (!firmaBase64 && !opciones?.excepcion) return { error: 'Sin firma' };
  if (opciones?.excepcion && !String(opciones?.motivoExcepcion || '').trim()) {
    return { error: 'Sin justificación' };
  }
  return null;
}

/**
 * Determina si una ruta puede ser firmada.
 * Refleja exactamente los checks de firmarCarga (líneas 1648-1666 en supaStore.js):
 * - ruta existe
 * - carga_confirmada_at no truthy (cubre firma normal y excepción previas)
 * - carga_real existe y tiene al menos un SKU
 * @param {object|null} ruta
 * @returns {{ ok: true, cargaReal: object } | { ok: false, razon: string }}
 */
export function puedeFirmarRuta(ruta) {
  if (!ruta) return { ok: false, razon: 'No encontrada' };
  if (ruta.carga_confirmada_at) return { ok: false, razon: 'Ya confirmada' };
  const cargaReal = (ruta.carga_real && typeof ruta.carga_real === 'object') ? ruta.carga_real : {};
  if (Object.keys(cargaReal).length === 0) return { ok: false, razon: 'Sin carga' };
  return { ok: true, cargaReal };
}

/**
 * Verifica si cargaReal excede la suma de carga_autorizada + extra_autorizado.
 * Devuelve el primer SKU que exceda (early return) o null si todo OK.
 * Refleja la lógica usada en confirmarCargaRuta y solicitarFirmaCarga.
 * @param {Record<string, number>} cargaReal
 * @param {Record<string, number>|null|undefined} autorizada
 * @param {Record<string, number>|null|undefined} extra
 * @returns {{ sku: string, max: number, qty: number } | null}
 */
export function excedeAutorizacion(cargaReal, autorizada, extra) {
  const aut = (autorizada && typeof autorizada === 'object') ? autorizada : {};
  const ext = (extra && typeof extra === 'object') ? extra : {};
  for (const [sku, qty] of Object.entries(cargaReal || {})) {
    const max = Number(aut[sku] || 0) + Number(ext[sku] || 0);
    const q = Number(qty);
    if (q > max) {
      return { sku, max, qty: q };
    }
  }
  return null;
}

/**
 * Calcula los `changes` para descontar inventario de cuartos fríos al cargar
 * una ruta, distribuyendo entre los cuartos en orden y respetando el stock
 * disponible por SKU. Si algún SKU no tiene suficiente stock total, lo
 * acumula en `faltantes` (con cantidad restante por descontar).
 *
 * @param {Record<string, number>} cargaReal — { sku: cantidadACargar }
 * @param {Array<{id, stock: Record<string, number>}>} cuartos — ordenados por prioridad
 * @param {{folio: string, usuario: string, origenSuffix?: string}} contexto
 * @returns {{ changes: Array, faltantes: Array<{sku, falta}> }}
 */
export function calcularChangesInventario(cargaReal, cuartos, contexto = {}) {
  const folio = contexto.folio || '';
  const usuario = contexto.usuario || 'Sistema';
  const origenSuffix = contexto.origenSuffix || '';
  const origen = `Carga ruta ${folio}${origenSuffix}`;

  const changes = [];
  const faltantes = [];

  for (const [sku, qtyNeeded] of Object.entries(cargaReal || {})) {
    let remaining = Number(qtyNeeded);
    if (remaining <= 0) continue;
    for (const cf of (cuartos || [])) {
      if (remaining <= 0) break;
      const stockObj = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
      const available = Number(stockObj[sku] || 0);
      if (available > 0) {
        const toTake = Math.min(available, remaining);
        remaining -= toTake;
        changes.push({
          cuarto_id: cf.id,
          sku,
          delta: -toTake,
          tipo: 'Salida',
          origen,
          usuario,
        });
      }
    }
    if (remaining > 0) {
      faltantes.push({ sku, falta: remaining });
    }
  }

  return { changes, faltantes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para cerrarRutaCompleta
//
// Reflejan el comportamiento actual del store. agruparMermasPorSku NO se usa
// en el refactor del store (extraído como utility testeada para uso futuro
// si se decide mergear duplicados; hoy el código inserta una fila de mermas
// por cada item del array sin agrupar).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica las entregas según sean ventas express u órdenes existentes.
 * Refleja exactamente la regla de cerrarRutaCompleta:
 *   const esVentaExpress = Boolean(e?.express) || !e?.ordenId;
 *
 * @param {Array<object>|null|undefined} entregas
 * @returns {{ conOrden: object[], ventasExpress: object[] }}
 */
export function clasificarEntregas(entregas) {
  const conOrden = [];
  const ventasExpress = [];
  for (const e of (entregas || [])) {
    const esVentaExpress = Boolean(e?.express) || !e?.ordenId;
    if (esVentaExpress) ventasExpress.push(e);
    else conOrden.push(e);
  }
  return { conOrden, ventasExpress };
}

/**
 * Agrupa mermas por SKU sumando cantidades.
 *
 * NOTA: hoy cerrarRutaCompleta NO agrupa — registra cada merma individual
 * como una fila distinta en `mermas` table. Este helper es utility para
 * casos donde haga falta agregar (ej. cálculo de devolución legacy o
 * decisión futura de mergear). NO cambia el comportamiento del store.
 *
 * @param {Array<{sku, cant}>|null|undefined} mermas
 * @returns {Record<string, number>}
 */
export function agruparMermasPorSku(mermas) {
  const result = {};
  for (const m of (mermas || [])) {
    const sku = m?.sku;
    if (!sku) continue;
    const cant = Number(m?.cant);
    const safe = Number.isFinite(cant) ? cant : 0;
    result[sku] = (result[sku] || 0) + safe;
  }
  return result;
}

/**
 * Calcula la devolución al cuarto frío para rutas legacy (creadas antes del
 * modelo "carga real" donde el inventario se descontaba al autorizar).
 *
 * Para cada SKU en `carga`, devuelto = cargado - entregado - mermado.
 * Solo se incluyen SKUs con sobrante > 0 (negativos y ceros se omiten).
 *
 * Refleja exactamente las líneas 2991-3009 de cerrarRutaCompleta. NO se
 * llama si la ruta es moderna — el caller decide eso vía select previo.
 *
 * @param {Record<string, number>|null|undefined} carga
 * @param {Array<{items: Array<{sku, cant, qty?}>}>|null|undefined} entregas
 * @param {Array<{sku, cant}>|null|undefined} mermas
 * @returns {Record<string, number>}  // solo SKUs con sobrante positivo
 */
export function calcDevolucionLegacy(carga, entregas, mermas) {
  const result = {};
  if (!carga || typeof carga !== 'object') return result;

  // Sumar entregado por SKU
  const entregadoPorSku = {};
  for (const e of (entregas || [])) {
    for (const it of (e?.items || [])) {
      const sku = it?.sku;
      if (!sku) continue;
      const cant = Number(it?.cant ?? it?.qty);
      const safe = Number.isFinite(cant) ? cant : 0;
      entregadoPorSku[sku] = (entregadoPorSku[sku] || 0) + safe;
    }
  }

  // Sumar mermado por SKU
  const mermaPorSku = agruparMermasPorSku(mermas);

  // Calcular sobrante por SKU
  for (const [sku, cargado] of Object.entries(carga)) {
    const c = Number(cargado);
    if (!Number.isFinite(c)) continue;
    const entregado = entregadoPorSku[sku] || 0;
    const merma = mermaPorSku[sku] || 0;
    const sobrante = c - entregado - merma;
    if (sobrante > 0) result[sku] = sobrante;
  }

  return result;
}
