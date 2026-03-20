// ── ordenLogic.js ───────────────────────────────────────────────
// Pure business logic for order creation — no Supabase, no React.
// Extracted so it can be unit-tested without mocking the entire store.
// supaStore.js imports and delegates to these functions.
// ────────────────────────────────────────────────────────────────
import { s, centavos } from '../utils/safe';

/**
 * Parse a productos string into structured items.
 * Accepted formats:
 *   "10×HC-5K, 5×HC-25K"   (unicode ×)
 *   "10xHC-5K,5xHC-25K"    (lowercase x)
 *
 * @param {string} raw
 * @returns {{ qty: number, sku: string }[]}  — empty array if invalid
 */
export function parseProductos(raw) {
  return s(raw)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(item => {
      const m = item.match(/^(\d+)\s*[×x]\s*(.+)$/i);
      return m ? { qty: parseInt(m[1], 10), sku: m[2].trim() } : null;
    })
    .filter(Boolean);
}

/**
 * Validate parsed items before hitting the database.
 * Returns an error message string or null if valid.
 *
 * @param {{ qty: number, sku: string }[]} items
 * @returns {string|null}
 */
export function validateItems(items) {
  if (items.length === 0) return 'Productos inválidos o vacíos';
  if (items.some(i => i.qty <= 0)) return 'Las cantidades deben ser positivas';
  return null;
}

/**
 * Build order lines (lineas) from parsed items + catalog data.
 * Returns { lineas, total } or { error } if a SKU is missing / price is invalid.
 *
 * @param {{ qty: number, sku: string }[]} items
 * @param {{ sku: string, precio: number|string }[]} productos   — from DB
 * @param {{ sku: string, precio: number|string }[]} preciosEsp  — client-specific prices
 * @returns {{ lineas: object[], total: number } | { error: string }}
 */
export function buildLineas(items, productos = [], preciosEsp = []) {
  let total = 0;
  const lineas = [];

  for (const item of items) {
    const prod = productos.find(p => p.sku === item.sku);
    if (!prod) return { error: `SKU ${item.sku} no existe` };

    const pe = preciosEsp.find(p => p.sku === item.sku);
    const unitPrice = centavos(pe ? Number(pe.precio) : Number(prod.precio || 0));

    if (unitPrice < 0) return { error: `Precio inválido para ${item.sku}` };

    const subtotal = centavos(item.qty * unitPrice);
    total += subtotal;
    lineas.push({ sku: item.sku, cantidad: item.qty, precio_unit: unitPrice, subtotal });
  }

  total = centavos(total);
  if (total <= 0) return { error: 'El total de la orden debe ser mayor a 0' };

  return { lineas, total };
}

/**
 * Format a folio number into the canonical OV-XXXX string.
 * @param {number|string} seq
 * @returns {string}
 */
export function formatFolio(seq) {
  return `OV-${String(seq || 1).padStart(4, '0')}`;
}
