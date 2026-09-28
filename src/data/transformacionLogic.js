// transformacionLogic.js — lógica pura de transformación insumo → producto
// terminado (ej. BH-50K → HT-TRITURADO). Aislada de Supabase para testear
// sin mocks.
//
// Modelo híbrido (post-mig 054):
//   - INSUMO: vive en productos.stock (Santiago confirmó que BH-50K
//     viene de proveedor, no se produce). Descontamos vía RPC
//     update_productos_stock_atomic.
//   - OUTPUT: producto terminado, va a cuartos_frios.stock JSONB. Sumamos
//     vía RPC update_stocks_atomic con el cuarto destino que el operario
//     selecciona en el modal.
//   - MERMA (opcional): registrada en tabla `mermas` + egreso contable
//     'Mermas' (mismo patrón que registrarMerma).

const TIPOS_INSUMO_VALIDOS = new Set(['Materia Prima', 'Insumo']);

/**
 * Valida una transformación antes de ejecutarla. Retorna {error: msg}
 * si hay algún problema, null si OK.
 *
 * Reglas:
 *   - input_sku, output_sku, cuarto_destino requeridos
 *   - input_kg > 0, output_kg > 0
 *   - output_kg <= input_kg (no se puede crear materia)
 *   - producto origen existe y es 'Materia Prima' o 'Insumo'
 *   - producto destino existe y es 'Producto Terminado'
 *   - cuarto destino existe y está activo
 *   - input_kg <= productoOrigen.stock (validación early para mensaje
 *     claro; el RPC también valida con FOR UPDATE + RAISE)
 *
 * @param {Object} payload          - { input_sku, input_kg, output_sku, output_kg, cuarto_destino, cantidadMerma? }
 * @param {Object} productoOrigen   - row de productos para input_sku
 * @param {Object} productoDestino  - row de productos para output_sku
 * @param {Array}  cuartos          - data.cuartosFrios
 * @returns {{error: string}|null}
 */
export function validateTransformacion(payload, productoOrigen, productoDestino, cuartos) {
  const p = payload || {};
  const inputKg = Number(p.input_kg);
  const outputKg = Number(p.output_kg);
  const mermaKg = p.cantidadMerma != null ? Number(p.cantidadMerma) : 0;

  if (!p.input_sku) return { error: 'SKU de insumo requerido' };
  if (!p.output_sku) return { error: 'SKU de producto destino requerido' };
  if (!p.cuarto_destino) return { error: 'Cuarto destino requerido' };

  if (!Number.isFinite(inputKg) || inputKg <= 0) return { error: 'Cantidad de insumo inválida' };
  if (!Number.isFinite(outputKg) || outputKg <= 0) return { error: 'Cantidad de salida inválida' };
  if (outputKg > inputKg) return { error: 'La salida no puede superar la entrada' };
  if (Number.isFinite(mermaKg) && mermaKg < 0) return { error: 'Merma no puede ser negativa' };

  if (!productoOrigen) return { error: `Insumo no encontrado: ${p.input_sku}` };
  const tipoOrigen = String(productoOrigen.tipo || '').trim();
  if (!TIPOS_INSUMO_VALIDOS.has(tipoOrigen)) {
    return { error: `${p.input_sku} no es un insumo (tipo=${tipoOrigen || 'sin tipo'})` };
  }

  if (!productoDestino) return { error: `Producto destino no encontrado: ${p.output_sku}` };
  const tipoDestino = String(productoDestino.tipo || '').trim();
  if (tipoDestino !== 'Producto Terminado') {
    return { error: `${p.output_sku} no es Producto Terminado (tipo=${tipoDestino || 'sin tipo'})` };
  }

  const cuarto = (cuartos || []).find(c => String(c?.id) === String(p.cuarto_destino));
  if (!cuarto) return { error: `Cuarto destino ${p.cuarto_destino} no existe` };

  const stockInsumo = Number(productoOrigen.stock || 0);
  if (inputKg > stockInsumo) {
    return { error: `Stock insuficiente de ${p.input_sku}: tienes ${stockInsumo}, necesitas ${inputKg}` };
  }

  return null;
}

// Los builders del flujo fragmentado (buildTransformacionRow, buildInsumoChange,
// buildOutputChange, buildInsumoRollbackChange) se retiraron con la mig 076:
// la transformación completa ocurre en registrar_transformacion (servidor).
