// rutas.test.js — flujo de cierre de ruta / chofer
import { describe, it, expect } from 'vitest';
import {
  formatDevolucion,
  validateDevolucion,
  totalDevuelto,
  normalizeDevolucion,
  calcTotalesCobro,
} from '../data/rutasLogic';

// ─── formatDevolucion ─────────────────────────────────────────
describe('formatDevolucion', () => {
  it('formatea objeto con varios SKUs', () => {
    expect(formatDevolucion({ 'HC-5K': 10, 'HC-25K': 3 })).toBe('10×HC-5K, 3×HC-25K');
  });

  it('omite SKUs con cantidad 0', () => {
    expect(formatDevolucion({ 'HC-5K': 5, 'HC-25K': 0 })).toBe('5×HC-5K');
  });

  it('devuelve "0" cuando todo es 0', () => {
    expect(formatDevolucion({ 'HC-5K': 0, 'HC-25K': 0 })).toBe('0');
  });

  it('devuelve "0" para objeto vacío', () => {
    expect(formatDevolucion({})).toBe('0');
  });

  it('devuelve "0" para null', () => {
    expect(formatDevolucion(null)).toBe('0');
  });
});

// ─── validateDevolucion ───────────────────────────────────────
describe('validateDevolucion', () => {
  it('acepta objeto válido con cantidades positivas', () => {
    expect(validateDevolucion({ 'HC-5K': 5, 'HC-25K': 0 })).toBeNull();
  });

  it('acepta objeto vacío (sin devoluciones)', () => {
    expect(validateDevolucion({})).toBeNull();
  });

  it('error si la cantidad es negativa', () => {
    expect(validateDevolucion({ 'HC-5K': -1 })).toMatch(/inválida/i);
  });

  it('error si la cantidad no es número', () => {
    expect(validateDevolucion({ 'HC-5K': 'mucho' })).toMatch(/inválida/i);
  });

  it('error si el argumento no es objeto', () => {
    expect(validateDevolucion(null)).toMatch(/objeto/i);
    expect(validateDevolucion('devolucion')).toMatch(/objeto/i);
  });
});

// ─── totalDevuelto ────────────────────────────────────────────
describe('totalDevuelto', () => {
  it('suma todas las unidades devueltas', () => {
    expect(totalDevuelto({ 'HC-5K': 10, 'HC-25K': 5, 'BH-50K': 2 })).toBe(17);
  });

  it('devuelve 0 para objeto vacío', () => {
    expect(totalDevuelto({})).toBe(0);
  });

  it('devuelve 0 para null', () => {
    expect(totalDevuelto(null)).toBe(0);
  });

  it('ignora valores nulos o undefined en las cantidades', () => {
    expect(totalDevuelto({ 'HC-5K': 3, 'HC-25K': null })).toBe(3);
  });
});

// ─── normalizeDevolucion ──────────────────────────────────────
describe('normalizeDevolucion', () => {
  it('devuelve el objeto tal cual si ya es objeto', () => {
    const obj = { 'HC-5K': 5 };
    expect(normalizeDevolucion(obj)).toBe(obj);
  });

  it('convierte número legacy a objeto { bolsas: n }', () => {
    expect(normalizeDevolucion(12)).toEqual({ bolsas: 12 });
  });

  it('convierte 0 a { bolsas: 0 }', () => {
    expect(normalizeDevolucion(0)).toEqual({ bolsas: 0 });
  });

  it('maneja null → { bolsas: 0 }', () => {
    expect(normalizeDevolucion(null)).toEqual({ bolsas: 0 });
  });
});

// ─── calcTotalesCobro ─────────────────────────────────────────
describe('calcTotalesCobro', () => {
  const cobros = [
    { monto: 500,  metodo_pago: 'Efectivo' },
    { monto: 1200, metodo_pago: 'Transferencia SPEI' },
    { monto: 800,  metodo_pago: 'Efectivo' },
    { monto: 2000, metodo_pago: 'Crédito' },
  ];

  it('suma efectivo correctamente', () => {
    expect(calcTotalesCobro(cobros).totalEfectivo).toBe(1300);
  });

  it('suma transferencias correctamente', () => {
    expect(calcTotalesCobro(cobros).totalTransferencia).toBe(1200);
  });

  it('suma crédito correctamente', () => {
    expect(calcTotalesCobro(cobros).totalCredito).toBe(2000);
  });

  it('calcula total cobrado como suma de los tres', () => {
    expect(calcTotalesCobro(cobros).totalCobrado).toBe(4500);
  });

  it('devuelve todos en 0 para lista vacía', () => {
    const r = calcTotalesCobro([]);
    expect(r.totalEfectivo).toBe(0);
    expect(r.totalCobrado).toBe(0);
  });

  it('clasifica como efectivo si el método es desconocido', () => {
    const r = calcTotalesCobro([{ monto: 300, metodo_pago: 'QR' }]);
    expect(r.totalEfectivo).toBe(300);
  });

  it('maneja montos con decimales sin error de floating point', () => {
    const r = calcTotalesCobro([
      { monto: 333.33, metodo_pago: 'Efectivo' },
      { monto: 333.33, metodo_pago: 'Efectivo' },
      { monto: 333.34, metodo_pago: 'Efectivo' },
    ]);
    expect(r.totalEfectivo).toBe(1000);
  });
});
