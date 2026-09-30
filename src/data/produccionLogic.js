// produccionLogic.js — lógica pura de producción de hielo
import { centavos } from '../utils/safe';

/**
 * Whitelist de campos editables en updateProduccion. SKU NO está incluido:
 * cambiar el SKU requeriría revertir stock y volverse a registrar — es más
 * seguro forzar al admin a Eliminar (con reverso) y crear nueva.
 *
 * @param {Object} fields — payload del UI
 * @returns {Object|null} — objeto a UPDATE en BD, o null si no hay nada que
 *                          actualizar (UI debe rechazar).
 */
export function buildUpdateFieldsProduccion(fields) {
  if (!fields || typeof fields !== 'object') return null;
  // 093: la producción es inmutable; solo se corrigen turno y máquina.
  const allowed = ['turno', 'maquina'];
  const upd = {};
  for (const k of allowed) {
    if (fields[k] !== undefined) upd[k] = fields[k];
  }
  return Object.keys(upd).length === 0 ? null : upd;
}


/**
 * Calcula el costo total de una corrida de producción.
 *
 * @param {number} cantidad      — bolsas producidas
 * @param {number} costoUnitario — costo por bolsa de empaque
 * @returns {number}             — costo total redondeado a centavos
 */
export function calcCostoProduccion(cantidad, costoUnitario) {
  const cant = Number(cantidad  || 0);
  const cost = Number(costoUnitario || 0);
  if (cant <= 0 || cost < 0) return 0;
  return centavos(cant * cost);
}

/**
 * Construye el concepto textual para el registro contable.
 *
 * @param {string} folio       — folio de la corrida (e.g. "PROD-0012")
 * @param {string|number} id   — ID de la corrida (fallback)
 * @param {number} cantidad
 * @param {string} sku         — SKU del producto terminado
 * @param {string} empaqueSku  — SKU del empaque consumido
 * @returns {string}
 */
export function buildConceptoProduccion(folio, id, cantidad, sku, empaqueSku) {
  const ref = folio || id;
  return `Producción ${ref}: ${cantidad}× ${sku} (empaque: ${empaqueSku})`;
}

/**
 * 093: ¿esta producción se puede revertir? Espejo de las reglas de
 * revertir_produccion (el servidor decide; esto solo guía la vista).
 * Requiere evidencia durable del efecto original: operación, cuarto y, si
 * consumió empaque, la cantidad guardada. Transformaciones: aún no.
 * @param {Object} r — fila de producción (camelCase o snake_case)
 * @returns {{ reversible: boolean, razon: string|null }}
 */
export function reversibilidadProduccion(r) {
  if (!r) return { reversible: false, razon: 'Sin datos' };
  const tipo = String(r.tipo || '');
  const estatus = String(r.estatus || '');
  const op = r.operacionId ?? r.operacion_id;
  const cuarto = r.cuartoId ?? r.cuarto_id;
  const empSku = r.empaqueSku ?? r.empaque_sku;
  const empCant = r.empaqueCantidad ?? r.empaque_cantidad;
  if (tipo === 'Transformacion') return { reversible: false, razon: 'Las transformaciones no se pueden revertir todavía' };
  if (estatus === 'Revertida' || r.revertidaAt || r.revertida_at) return { reversible: false, razon: 'Ya fue revertida' };
  if (estatus !== 'Confirmada') return { reversible: false, razon: `No está confirmada (${estatus || 'sin estatus'})` };
  if (!op || !String(cuarto || '').trim() || (empSku && (empCant === null || empCant === undefined))) {
    return { reversible: false, razon: 'Producción anterior sin datos suficientes: no se puede revertir con certeza' };
  }
  return { reversible: true, razon: null };
}
