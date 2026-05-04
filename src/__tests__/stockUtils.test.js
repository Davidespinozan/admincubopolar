// stockUtils.test.js
// Tests para stockDisponiblePorSku + stockDisponibleParaEdicion.
// Lógica pura sin Supabase.
import { describe, it, expect } from 'vitest';
import { stockDisponiblePorSku, stockDisponibleParaEdicion } from '../utils/stock';

// ─── stockDisponiblePorSku ────────────────────────────────────
describe('stockDisponiblePorSku', () => {
  it('cuartos vacíos → {}', () => {
    expect(stockDisponiblePorSku([])).toEqual({});
  });

  it('null/undefined → {}', () => {
    expect(stockDisponiblePorSku(null)).toEqual({});
    expect(stockDisponiblePorSku(undefined)).toEqual({});
  });

  it('un cuarto con stock → suma directa', () => {
    const cuartos = [{ id: 'CF-1', stock: { 'HC-25K': 50, 'HC-5K': 20 } }];
    expect(stockDisponiblePorSku(cuartos)).toEqual({
      'HC-25K': 50,
      'HC-5K': 20,
    });
  });

  it('múltiples cuartos suman por SKU', () => {
    const cuartos = [
      { id: 'CF-1', stock: { 'HC-25K': 30, 'HC-5K': 20 } },
      { id: 'CF-2', stock: { 'HC-25K': 50 } },
      { id: 'CF-3', stock: { 'HC-5K': 10, 'HT-25K': 15 } },
    ];
    expect(stockDisponiblePorSku(cuartos)).toEqual({
      'HC-25K': 80,
      'HC-5K': 30,
      'HT-25K': 15,
    });
  });

  it('cuarto con stock null/undefined → ignorado, no crashea', () => {
    const cuartos = [
      { id: 'CF-1', stock: null },
      { id: 'CF-2', stock: undefined },
      { id: 'CF-3', stock: { 'HC-25K': 5 } },
    ];
    expect(stockDisponiblePorSku(cuartos)).toEqual({ 'HC-25K': 5 });
  });

  it('valores NaN/string-no-numérico se ignoran (null → 0)', () => {
    const cuartos = [{
      id: 'CF-1',
      stock: { 'HC-25K': 'abc', 'HC-5K': null, 'HT-25K': 10, 'OTRO': NaN },
    }];
    // Number(null) === 0 → HC-5K se incluye con 0. Solo se ignoran NaN y strings no parseables.
    expect(stockDisponiblePorSku(cuartos)).toEqual({ 'HC-5K': 0, 'HT-25K': 10 });
  });

  it('cuartos sin id pero con stock cuentan igual', () => {
    const cuartos = [{ stock: { 'HC-25K': 5 } }];
    expect(stockDisponiblePorSku(cuartos)).toEqual({ 'HC-25K': 5 });
  });

  it('stock = 0 explícito se incluye', () => {
    const cuartos = [{ stock: { 'HC-25K': 0 } }];
    expect(stockDisponiblePorSku(cuartos)).toEqual({ 'HC-25K': 0 });
  });

  it('stock como string numérico se castea', () => {
    const cuartos = [{ stock: { 'HC-25K': '15' } }];
    expect(stockDisponiblePorSku(cuartos)).toEqual({ 'HC-25K': 15 });
  });
});

// ─── stockDisponibleParaEdicion ───────────────────────────────
describe('stockDisponibleParaEdicion', () => {
  const stockMap = { 'HC-25K': 30, 'HC-5K': 0 };

  it('cantidadOriginal = 0 → retorna stock del cuarto', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-25K', 0)).toBe(30);
  });

  it('cantidadOriginal > 0 → suma a lo del cuarto (orden libera lo que reservaba)', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-25K', 5)).toBe(35);
  });

  it('SKU no existente en cuarto + cantidadOriginal → solo lo original', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-NEW', 3)).toBe(3);
  });

  it('stock cuarto = 0 + cantidadOriginal = 7 → permite hasta 7', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-5K', 7)).toBe(7);
  });

  it('cantidadOriginal undefined → 0 implícito', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-25K', undefined)).toBe(30);
  });

  it('cantidadOriginal null → 0 implícito', () => {
    expect(stockDisponibleParaEdicion(stockMap, 'HC-25K', null)).toBe(30);
  });

  it('stockMap null → solo cantidadOriginal', () => {
    expect(stockDisponibleParaEdicion(null, 'HC-25K', 5)).toBe(5);
  });

  it('stockMap undefined → solo cantidadOriginal', () => {
    expect(stockDisponibleParaEdicion(undefined, 'HC-25K', 5)).toBe(5);
  });

  it('todo vacío → 0', () => {
    expect(stockDisponibleParaEdicion({}, 'HC-25K', 0)).toBe(0);
  });
});
