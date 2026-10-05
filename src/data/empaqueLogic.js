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

// ── 107/108: base de costo del empaque ──
// Ninguna unidad de empaque entra fuera de una recepción de compra: el ajuste
// manual solo baja (el promedio no cambia), un empaque nuevo nace sin
// existencia ni costo, y un empaque con existencia, uso o historia no se
// elimina. El servidor es la autoridad; esto solo guía la captura.

export const REGLA_ENTRADA_EMPAQUE = 'Las entradas de empaque se registran con la recepción de compra.';

export function esEmpaque(producto) {
  return txt(producto?.tipo) === 'Empaque';
}

/**
 * Validación de captura del ajuste manual de existencia (UX).
 * @returns {{existencia?: string, motivo?: string}} vacío = sin errores
 */
export function validarAjusteExistencia({ tipo, existenciaActual, nuevaExistencia, motivo } = {}) {
  const e = {};
  const capturada = txt(nuevaExistencia).trim();
  const nueva = Number(capturada);
  if (capturada === '' || !Number.isInteger(nueva) || nueva < 0) {
    e.existencia = 'Debe ser un entero de 0 o mayor';
  } else if (txt(tipo) === 'Empaque' && nueva > (Number(existenciaActual) || 0)) {
    e.existencia = `El empaque solo se ajusta a la baja (actual: ${(Number(existenciaActual) || 0).toLocaleString('es-MX')}). ${REGLA_ENTRADA_EMPAQUE}`;
  }
  if (!txt(motivo).trim()) e.motivo = 'Motivo requerido';
  return e;
}

/**
 * Existencia y costo con los que se da de alta un producto. El empaque nace
 * en 0 y sin costo (la primera compra fija ambos); el producto terminado no
 * tiene costo unitario.
 */
export function camposAltaProducto({ tipo, stock } = {}) {
  if (txt(tipo) === 'Empaque') return { stock: 0, costo_unitario: 0 };
  return { stock: Number(stock) || 0, costo_unitario: 0 };
}

/** Mensaje en español para los rechazos del servidor sobre empaque (107/108). */
export function mensajeErrorEmpaque(error, porDefecto = '') {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  if (/no se aumenta con un ajuste manual/i.test(msg)) return `El empaque solo se ajusta a la baja. ${REGLA_ENTRADA_EMPAQUE}`;
  if (/nace sin existencia/i.test(msg)) return `Un empaque nuevo se da de alta sin existencia. ${REGLA_ENTRADA_EMPAQUE}`;
  if (/nace sin costo/i.test(msg)) return 'Un empaque nuevo se da de alta sin costo: lo fija la primera recepción de compra.';
  if (/tiene existencia; no se elimina/i.test(msg)) return 'Este empaque tiene existencia; no se puede eliminar.';
  if (/está en uso o tiene historia/i.test(msg)) return 'Este empaque está en uso o tiene compras, producciones o movimientos; no se puede eliminar.';
  if (/productos_empaque_stock_no_negativo/i.test(msg)) return 'La existencia de empaque no puede ser negativa.';
  return porDefecto || msg;
}
