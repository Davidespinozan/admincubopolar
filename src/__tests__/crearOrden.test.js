// crearOrden.test.js
// Tests para el flujo de creación de órdenes — lógica pura (sin Supabase)
import { describe, it, expect } from 'vitest';
import { parseProductos, validateItems, buildLineas, formatFolio } from '../data/ordenLogic';

// ─── CATÁLOGO DE PRUEBA ───────────────────────────────────────
const PRODUCTOS = [
  { sku: 'HC-5K',  precio: 50 },
  { sku: 'HC-25K', precio: 200 },
  { sku: 'BH-50K', precio: 400 },
];

// ─── parseProductos ──────────────────────────────────────────
describe('parseProductos', () => {
  it('parsea formato estándar con ×', () => {
    const result = parseProductos('10×HC-5K, 5×HC-25K');
    expect(result).toEqual([
      { qty: 10, sku: 'HC-5K' },
      { qty: 5,  sku: 'HC-25K' },
    ]);
  });

  it('parsea formato con x minúscula', () => {
    const result = parseProductos('3xHC-5K');
    expect(result).toEqual([{ qty: 3, sku: 'HC-5K' }]);
  });

  it('ignora espacios extra alrededor de la x', () => {
    const result = parseProductos('2 × HC-25K');
    expect(result).toEqual([{ qty: 2, sku: 'HC-25K' }]);
  });

  it('omite entradas con formato incorrecto', () => {
    // "HC-5K" sin cantidad → se descarta
    const result = parseProductos('HC-5K, 5×HC-25K');
    expect(result).toEqual([{ qty: 5, sku: 'HC-25K' }]);
  });

  it('devuelve [] para string vacío', () => {
    expect(parseProductos('')).toEqual([]);
  });

  it('devuelve [] para null/undefined', () => {
    expect(parseProductos(null)).toEqual([]);
    expect(parseProductos(undefined)).toEqual([]);
  });

  it('parsea múltiples productos sin espacios después de la coma', () => {
    const result = parseProductos('10×HC-5K,5×HC-25K,2×BH-50K');
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ qty: 2, sku: 'BH-50K' });
  });
});

// ─── validateItems ───────────────────────────────────────────
describe('validateItems', () => {
  it('devuelve null si los items son válidos', () => {
    expect(validateItems([{ qty: 5, sku: 'HC-5K' }])).toBeNull();
  });

  it('error si el array está vacío', () => {
    expect(validateItems([])).toMatch(/inválidos|vacíos/i);
  });

  it('error si alguna cantidad es 0', () => {
    expect(validateItems([{ qty: 0, sku: 'HC-5K' }])).toMatch(/positivas/i);
  });

  it('error si alguna cantidad es negativa', () => {
    expect(validateItems([{ qty: -1, sku: 'HC-5K' }])).toMatch(/positivas/i);
  });

  it('acepta múltiples items válidos', () => {
    expect(validateItems([
      { qty: 1, sku: 'HC-5K' },
      { qty: 100, sku: 'HC-25K' },
    ])).toBeNull();
  });
});

// ─── buildLineas ─────────────────────────────────────────────
describe('buildLineas', () => {
  it('calcula totales correctamente para un producto', () => {
    const { lineas, total } = buildLineas([{ qty: 10, sku: 'HC-5K' }], PRODUCTOS, []);
    expect(lineas).toHaveLength(1);
    expect(lineas[0].subtotal).toBe(500); // 10 × $50
    expect(total).toBe(500);
  });

  it('calcula totales para múltiples productos', () => {
    const items = [
      { qty: 10, sku: 'HC-5K' },   // 10 × 50  = 500
      { qty: 5,  sku: 'HC-25K' },  //  5 × 200 = 1000
    ];
    const { total } = buildLineas(items, PRODUCTOS, []);
    expect(total).toBe(1500);
  });

  it('usa precios especiales del cliente cuando existen', () => {
    const preciosEsp = [{ sku: 'HC-5K', precio: 40 }]; // descuento $10
    const { lineas, total } = buildLineas([{ qty: 10, sku: 'HC-5K' }], PRODUCTOS, preciosEsp);
    expect(lineas[0].precio_unit).toBe(40);
    expect(total).toBe(400);
  });

  it('usa precio del catálogo cuando NO hay precio especial', () => {
    const preciosEsp = [{ sku: 'HC-25K', precio: 180 }]; // solo para otro SKU
    const { lineas } = buildLineas([{ qty: 1, sku: 'HC-5K' }], PRODUCTOS, preciosEsp);
    expect(lineas[0].precio_unit).toBe(50);
  });

  it('devuelve error si el SKU no existe en catálogo', () => {
    const result = buildLineas([{ qty: 5, sku: 'INEXISTENTE' }], PRODUCTOS, []);
    expect(result.error).toMatch(/no existe/i);
  });

  it('devuelve error si el total es 0 (producto gratuito)', () => {
    const prodsGratis = [{ sku: 'HC-5K', precio: 0 }];
    const result = buildLineas([{ qty: 10, sku: 'HC-5K' }], prodsGratis, []);
    expect(result.error).toMatch(/mayor a 0/i);
  });

  it('devuelve error si el precio es negativo', () => {
    const prodsNegativo = [{ sku: 'HC-5K', precio: -10 }];
    const result = buildLineas([{ qty: 5, sku: 'HC-5K' }], prodsNegativo, []);
    expect(result.error).toMatch(/inválido/i);
  });

  it('maneja precios con decimales sin errores de floating point', () => {
    const prods = [{ sku: 'HC-5K', precio: 33.33 }];
    const { total } = buildLineas([{ qty: 3, sku: 'HC-5K' }], prods, []);
    // 3 × 33.33 = 99.99 — sin el bug de JS: 99.99000000000001
    expect(total).toBe(99.99);
  });

  it('devuelve precio_unit, cantidad y subtotal en cada línea', () => {
    const { lineas } = buildLineas([{ qty: 2, sku: 'BH-50K' }], PRODUCTOS, []);
    expect(lineas[0]).toMatchObject({
      sku: 'BH-50K',
      cantidad: 2,
      precio_unit: 400,
      subtotal: 800,
    });
  });
});

// ─── formatFolio ─────────────────────────────────────────────
describe('formatFolio', () => {
  it('formatea número corto con ceros a la izquierda', () => {
    expect(formatFolio(1)).toBe('OV-0001');
    expect(formatFolio(42)).toBe('OV-0042');
  });

  it('formatea números de 4 dígitos sin padding', () => {
    expect(formatFolio(1234)).toBe('OV-1234');
  });

  it('formatea números grandes (más de 4 dígitos)', () => {
    expect(formatFolio(10000)).toBe('OV-10000');
  });

  it('maneja null/undefined usando 1 como fallback', () => {
    expect(formatFolio(null)).toBe('OV-0001');
    expect(formatFolio(undefined)).toBe('OV-0001');
  });
});

// ─── FLUJO COMPLETO (integración sin DB) ─────────────────────
describe('flujo completo crearOrden — integración lógica', () => {
  it('flujo feliz: parsing → validación → cálculo → folio', () => {
    const raw = '10×HC-5K, 3×HC-25K';
    const items = parseProductos(raw);
    expect(validateItems(items)).toBeNull();

    const { lineas, total } = buildLineas(items, PRODUCTOS, []);
    expect(lineas).toHaveLength(2);
    expect(total).toBe(1100); // 500 + 600

    const folio = formatFolio(7);
    expect(folio).toBe('OV-0007');
  });

  it('rechaza orden con productos inválidos antes de tocar la DB', () => {
    const items = parseProductos('sin-cantidad, texto-libre');
    const validationError = validateItems(items);
    expect(validationError).toBeTruthy(); // debe fallar antes del DB call
  });

  it('rechaza SKU desconocido antes de insertar en ordenes', () => {
    const items = parseProductos('5×SKU-FALSO');
    expect(validateItems(items)).toBeNull(); // formato OK
    const result = buildLineas(items, PRODUCTOS, []);
    expect(result.error).toBeTruthy(); // pero SKU no existe en catálogo
  });

  it('aplica precio especial de cliente en flujo completo', () => {
    const raw = '20×HC-5K';
    const preciosEsp = [{ sku: 'HC-5K', precio: 45 }]; // precio especial
    const items = parseProductos(raw);
    const { total } = buildLineas(items, PRODUCTOS, preciosEsp);
    expect(total).toBe(900); // 20 × 45, NO 20 × 50
  });
});
