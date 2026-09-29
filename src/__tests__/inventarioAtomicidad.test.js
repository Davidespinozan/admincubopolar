// inventarioAtomicidad.test.js — builders puros para RPCs atómicas
// (update_stocks_atomic y update_productos_stock_atomic). Cubre el shape
// del payload que la BD recibe; las garantías de FOR UPDATE + RAISE EXCEPTION
// están en migraciones 047 y 054 y se prueban manualmente con SQL.
import { describe, it, expect } from 'vitest';
import {
  validateTraspaso,
  buildMovimientoBolsaChange,
} from '../data/inventarioLogic';

// ─── validateTraspaso ──────────────────────────────────────────
describe('validateTraspaso', () => {
  it('retorna null si todo OK', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 10 })).toBeNull();
  });

  it('rechaza cantidad 0', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 0 })?.error).toBe('Cantidad inválida');
  });

  it('rechaza cantidad negativa', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: -5 })?.error).toBe('Cantidad inválida');
  });

  it('rechaza cantidad NaN', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 'abc' })?.error).toBe('Cantidad inválida');
  });

  it('rechaza origen=destino (no traspasar al mismo cuarto)', () => {
    const err = validateTraspaso({ origen: 'CF-1', destino: 'CF-1', sku: 'HC-25K', cantidad: 10 });
    expect(err?.error).toBe('Origen y destino deben ser diferentes');
  });

  it('rechaza origen=destino con coerción de tipo', () => {
    // si vienen 1 y "1" del UI, deben tratarse como iguales
    const err = validateTraspaso({ origen: 1, destino: '1', sku: 'X', cantidad: 5 });
    expect(err?.error).toBe('Origen y destino deben ser diferentes');
  });

  it('rechaza origen vacío', () => {
    expect(validateTraspaso({ origen: '', destino: 'CF-2', sku: 'X', cantidad: 5 })?.error).toBe('Origen y destino requeridos');
  });

  it('rechaza destino vacío', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: '', sku: 'X', cantidad: 5 })?.error).toBe('Origen y destino requeridos');
  });

  it('rechaza SKU vacío', () => {
    expect(validateTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: '', cantidad: 5 })?.error).toBe('SKU requerido');
  });
});

// ─── buildMovimientoBolsaChange ────────────────────────────────
describe('buildMovimientoBolsaChange', () => {
  it('Entrada → delta positivo', () => {
    const c = buildMovimientoBolsaChange('EMP-25', 100, 'Entrada', 'Compra proveedor');
    expect(c.delta).toBe(100);
    expect(c.tipo).toBe('Entrada');
  });

  it('Salida → delta negativo', () => {
    const c = buildMovimientoBolsaChange('EMP-25', 50, 'Salida', 'Consumo producción');
    expect(c.delta).toBe(-50);
    expect(c.tipo).toBe('Salida');
  });

  it('shape para update_productos_stock_atomic (sin cuarto_id)', () => {
    const c = buildMovimientoBolsaChange('EMP-25', 100, 'Entrada', 'X');
    expect(c).not.toHaveProperty('cuarto_id');
    expect(c).toMatchObject({
      sku: 'EMP-25', delta: 100, tipo: 'Entrada', origen: 'X',
    });
  });

  it('cantidad 0 retorna null (UI debe rechazar)', () => {
    expect(buildMovimientoBolsaChange('EMP-25', 0, 'Entrada', 'X')).toBeNull();
  });

  it('cantidad negativa retorna null', () => {
    expect(buildMovimientoBolsaChange('EMP-25', -5, 'Entrada', 'X')).toBeNull();
  });

  it('tipo inválido (no Entrada ni Salida) retorna null', () => {
    expect(buildMovimientoBolsaChange('EMP-25', 10, 'Traspaso', 'X')).toBeNull();
    expect(buildMovimientoBolsaChange('EMP-25', 10, 'Ajuste', 'X')).toBeNull();
  });

  it('motivo vacío usa fallback "Movimiento bolsa"', () => {
    const c = buildMovimientoBolsaChange('EMP-25', 100, 'Entrada', '');
    expect(c.origen).toBe('Movimiento bolsa');
  });

  it('opciones.usuario sobrescribe default', () => {
    const c = buildMovimientoBolsaChange('EMP-25', 100, 'Entrada', 'X', { usuario: 'Carla' });
    expect(c.usuario).toBe('Carla');
  });
});

// ─── invariantes globales ──────────────────────────────────────
describe('invariantes de atomicidad', () => {
  it('buildMovimientoBolsaChange tiene los campos requeridos por el RPC de productos', () => {
    const movB = buildMovimientoBolsaChange('X', 1, 'Entrada', 'm');
    for (const k of ['sku', 'delta', 'tipo', 'origen', 'usuario']) expect(movB).toHaveProperty(k);
  });
});
