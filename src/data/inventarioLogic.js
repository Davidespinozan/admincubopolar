// inventarioLogic.js — builders puros para llamadas a las RPCs atómicas
// `update_stocks_atomic` (CF, JSONB) y `update_productos_stock_atomic`
// (productos.stock, escalar). Aislar el shape del payload aquí permite
// testear sin mockear Supabase.

const DEFAULT_USUARIO = 'Sistema';

/**
 * Construye el `change` para meterACuartoFrio. Delta positivo (entrada).
 * @returns {Object} payload listo para `update_stocks_atomic` (1 elemento)
 */
export function buildMeterChange(cfId, sku, cantidad, opciones = {}) {
  return {
    cuarto_id: String(cfId),
    sku: String(sku),
    delta: Number(cantidad),
    tipo: opciones.tipo || 'Entrada',
    origen: opciones.origen || `Entrada a ${opciones.cuartoNombre || cfId}`,
    usuario: opciones.usuario || DEFAULT_USUARIO,
  };
}

/**
 * Construye el `change` para sacarDeCuartoFrio. Delta negativo (salida).
 * El RPC con FOR UPDATE + RAISE EXCEPTION ya cubre stock insuficiente,
 * así que no validamos aquí (la BD es la fuente de verdad transaccional).
 */
export function buildSacarChange(cfId, sku, cantidad, motivo, opciones = {}) {
  return {
    cuarto_id: String(cfId),
    sku: String(sku),
    delta: -Number(cantidad),
    tipo: opciones.tipo || 'Salida',
    origen: motivo || opciones.origen || String(cfId),
    usuario: opciones.usuario || DEFAULT_USUARIO,
  };
}

/**
 * Construye el array de 2 changes para un traspaso CF→CF. Ambos changes
 * van en el mismo `p_changes` para garantizar atomicidad en plpgsql.
 * Si la salida hace RAISE (stock insuficiente), la entrada nunca ocurre.
 */
export function buildTraspasoChanges({ origen, destino, sku, cantidad }, opciones = {}) {
  const usuario = opciones.usuario || DEFAULT_USUARIO;
  const qty = Number(cantidad);
  const origenTxt = `${origen} → ${destino}`;
  return [
    {
      cuarto_id: String(origen),
      sku: String(sku),
      delta: -qty,
      tipo: 'Traspaso salida',
      origen: origenTxt,
      usuario,
    },
    {
      cuarto_id: String(destino),
      sku: String(sku),
      delta: qty,
      tipo: 'Traspaso entrada',
      origen: origenTxt,
      usuario,
    },
  ];
}

/**
 * Validaciones síncronas para traspaso. Retorna {error} si inválido,
 * null si OK. La validación de existencia de cuartos requiere DB y queda
 * fuera de este helper (la action la hace antes del RPC).
 */
export function validateTraspaso({ origen, destino, sku, cantidad }) {
  const qty = Number(cantidad);
  if (!Number.isFinite(qty) || qty <= 0) return { error: 'Cantidad inválida', message: 'Cantidad inválida' };
  if (!origen || !destino) return { error: 'Origen y destino requeridos', message: 'Origen y destino requeridos' };
  if (String(origen) === String(destino)) {
    return { error: 'Origen y destino deben ser diferentes', message: 'Origen y destino deben ser diferentes' };
  }
  if (!sku) return { error: 'SKU requerido', message: 'SKU requerido' };
  return null;
}

/**
 * Construye el `change` para movimientoBolsa (productos.stock, no CF).
 * Delta positivo si tipo='Entrada', negativo si 'Salida'. Cualquier otro
 * tipo retorna null (UI debe rechazar).
 */
export function buildMovimientoBolsaChange(sku, cantidad, tipo, motivo, opciones = {}) {
  const qty = Number(cantidad);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (tipo !== 'Entrada' && tipo !== 'Salida') return null;
  return {
    sku: String(sku),
    delta: tipo === 'Entrada' ? qty : -qty,
    tipo,
    origen: motivo || 'Movimiento bolsa',
    usuario: opciones.usuario || DEFAULT_USUARIO,
  };
}
