// empaqueLogic.js — 092: semántica de empaque (Modelo A).
//
// productos.stock de un Empaque = inventario TOTAL de la empresa (almacén +
// lo que ya está en Producción sin usar). No hay saldo de Producción.
//   - Recepción de compra: suma al total.
//   - Entrega a Producción: evento de traslado ('Entrega a Producción'); NO
//     cambia el total.
//   - Producción: único consumo (Salida 'Producción OP-…').
// La conciliación "Salió a Producción vs Usó Producción" viene del servidor
// (conciliacion_empaque) desde fuentes independientes; aquí solo se
// normaliza para la vista. La historia anterior a 092 es ambigua y se muestra
// aparte, nunca como entrega canónica.

export const TIPO_ENTREGA_PRODUCCION = 'Entrega a Producción';

const txt = (v) => (v == null ? '' : String(v));

/**
 * Clasifica un movimiento de kardex de empaque.
 * @returns {'entrada'|'entrega'|'consumo'|'legado_salida'|'otro'}
 */
export function clasificarMovEmpaque(m) {
  if (!m) return 'otro';
  const tipo = txt(m.tipo);
  const ref = txt(m.referencia);
  const origen = txt(m.origen);
  if (tipo === 'Entrada') return 'entrada';
  if (tipo === TIPO_ENTREGA_PRODUCCION && ref.startsWith('salida_empaque/')) return 'entrega';
  if (tipo === 'Salida' && origen.startsWith('Producción OP-')) return 'consumo';
  if (tipo === 'Salida' && (ref.startsWith('salida_empaque/') || (ref === '' && origen === 'Producción'))) return 'legado_salida';
  return 'otro';
}

/** Efecto del movimiento sobre el total de la empresa (solo para mostrar el signo). */
export function efectoEnTotal(clase) {
  if (clase === 'entrada') return 1;
  if (clase === 'entrega') return 0;
  if (clase === 'consumo' || clase === 'legado_salida') return -1;
  return 0;
}

/**
 * Totales del día por SKU para la pantalla del almacén: lo que llegó y lo
 * que se entregó a Producción (la entrega no resta del total).
 */
export function resumenDiaEmpaque(movs, skus, hoyISO) {
  const r = {};
  for (const sku of skus || []) r[sku] = { entradas: 0, entregas: 0 };
  for (const m of movs || []) {
    const sku = txt(m.producto || m.sku);
    if (!r[sku]) continue;
    const fecha = txt(m.createdAt || m.created_at || m.fecha);
    if (!fecha.startsWith(hoyISO)) continue;
    const clase = clasificarMovEmpaque(m);
    const qty = Math.abs(Number(m.cantidad) || 0);
    if (clase === 'entrada') r[sku].entradas += qty;
    else if (clase === 'entrega') r[sku].entregas += qty;
  }
  return r;
}

/**
 * Normaliza la respuesta de conciliacion_empaque() para la vista.
 * diferencia = entregado − usado: positivo = bolsas entregadas aún sin usar
 * (normal mientras Producción las tiene); negativo = se usó más de lo
 * entregado (investigar). Es una métrica de control, no un saldo.
 */
export function normalizarConciliacion(rows) {
  return (Array.isArray(rows) ? rows : []).map(x => {
    const entregado = Number(x?.entregado_produccion) || 0;
    const usado = Number(x?.consumido_produccion) || 0;
    const diferencia = entregado - usado;
    return {
      sku: txt(x?.sku),
      nombre: txt(x?.nombre),
      stockTotal: Number(x?.stock_total) || 0,
      entregado,
      usado,
      diferencia,
      estado: diferencia === 0 ? 'cuadra' : diferencia > 0 ? 'sin_usar' : 'uso_sin_entrega',
      legadoSalidas: Number(x?.legado_salidas) || 0,
      legadoSalidasN: Number(x?.legado_salidas_n) || 0,
      legadoConsumo: Number(x?.legado_consumo) || 0,
      legadoConsumoN: Number(x?.legado_consumo_n) || 0,
    };
  });
}
