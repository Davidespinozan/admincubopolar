// inventarioLogic.js — builders puros para llamadas a las RPCs atómicas
// `update_stocks_atomic` (CF, JSONB) y `update_productos_stock_atomic`
// (productos.stock, escalar). Aislar el shape del payload aquí permite
// testear sin mockear Supabase.

const DEFAULT_USUARIO = 'Sistema';




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
