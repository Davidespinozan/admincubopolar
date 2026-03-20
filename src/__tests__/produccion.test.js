// produccion.test.js — flujo de producción de hielo
import { describe, it, expect } from 'vitest';
import { calcCostoProduccion, buildConceptoProduccion } from '../data/produccionLogic';

describe('calcCostoProduccion', () => {
  it('calcula costo correcto: 500 bolsas × $3.50 empaque', () => {
    expect(calcCostoProduccion(500, 3.50)).toBe(1750);
  });

  it('calcula costo con decimales sin error de floating point', () => {
    // 100 × 1.16 = 116.00 (no 115.99999...)
    expect(calcCostoProduccion(100, 1.16)).toBe(116);
  });

  it('devuelve 0 si la cantidad es 0', () => {
    expect(calcCostoProduccion(0, 5)).toBe(0);
  });

  it('devuelve 0 si la cantidad es negativa', () => {
    expect(calcCostoProduccion(-10, 5)).toBe(0);
  });

  it('devuelve 0 si el costo unitario es 0 (empaque sin precio)', () => {
    expect(calcCostoProduccion(1000, 0)).toBe(0);
  });

  it('devuelve 0 si el costo unitario es null/undefined', () => {
    expect(calcCostoProduccion(500, null)).toBe(0);
    expect(calcCostoProduccion(500, undefined)).toBe(0);
  });

  it('no registra costo si el costo unitario es negativo', () => {
    // precio negativo = dato corrupto → no registrar egreso
    expect(calcCostoProduccion(100, -2)).toBe(0);
  });

  it('maneja producciones grandes sin overflow', () => {
    // 50,000 bolsas × $5.75
    expect(calcCostoProduccion(50000, 5.75)).toBe(287500);
  });

  it('redondea a centavos correctamente', () => {
    // 3 × 33.333 = 99.999 → 100.00
    expect(calcCostoProduccion(3, 33.333)).toBe(100);
  });
});

describe('buildConceptoProduccion', () => {
  it('construye concepto con folio', () => {
    const c = buildConceptoProduccion('PROD-0012', 42, 500, 'HC-5K', 'BOL-5K');
    expect(c).toBe('Producción PROD-0012: 500× HC-5K (empaque: BOL-5K)');
  });

  it('usa el ID como fallback cuando no hay folio', () => {
    const c = buildConceptoProduccion(null, 99, 200, 'HC-25K', 'BOL-25K');
    expect(c).toContain('99');
    expect(c).toContain('HC-25K');
    expect(c).toContain('BOL-25K');
  });

  it('incluye siempre el SKU de empaque (clave para contabilidad)', () => {
    const c = buildConceptoProduccion('P-001', 1, 100, 'HC-5K', 'BOL-5K');
    expect(c).toContain('BOL-5K');
  });
});
