// deleteProduccion.test.js
// Tests para calcReversoChangesProduccion — sin Supabase.
// Cubre el cálculo del reverso FIFO inverso multi-cuarto y casos borde.
import { describe, it, expect } from 'vitest';
import { calcReversoChangesProduccion } from '../data/produccionLogic';

describe('calcReversoChangesProduccion', () => {
  const cuartos2 = [
    { id: 'CF-1', stock: { 'HC-25K': 60, 'HC-5K': 20 } },
    { id: 'CF-2', stock: { 'HC-25K': 100 } },
  ];

  describe('caso simple: stock concentrado en un cuarto', () => {
    it('descuenta todo del primer cuarto si tiene suficiente', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 50, folio: 'OP-001' },
        cuartos2,
        'Admin'
      );
      expect(faltante).toBe(0);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        cuarto_id: 'CF-1',
        sku: 'HC-25K',
        delta: -50,
        tipo: 'Reverso producción',
        origen: 'Reverso OP-001',
        usuario: 'Admin',
      });
    });
  });

  describe('FIFO inverso multi-cuarto', () => {
    it('reparte entre cuartos cuando uno solo no alcanza', () => {
      // Necesita 100 de HC-25K. CF-1 tiene 60, CF-2 tiene 100.
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 100, folio: 'OP-002' },
        cuartos2,
        'Admin'
      );
      expect(faltante).toBe(0);
      expect(changes).toHaveLength(2);
      expect(changes[0]).toMatchObject({ cuarto_id: 'CF-1', delta: -60 });
      expect(changes[1]).toMatchObject({ cuarto_id: 'CF-2', delta: -40 });
    });

    it('cantidad exacta = stock del primer cuarto, no toca el segundo', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 60, folio: 'OP-003' },
        cuartos2,
        'Admin'
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ cuarto_id: 'CF-1', delta: -60 });
    });

    it('salta cuartos sin stock del SKU', () => {
      const cuartos = [
        { id: 'CF-1', stock: { 'OTRO': 50 } }, // sin HC-25K
        { id: 'CF-2', stock: { 'HC-25K': 80 } },
      ];
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 30, folio: 'OP-004' },
        cuartos,
        'Admin'
      );
      expect(faltante).toBe(0);
      expect(changes).toHaveLength(1);
      expect(changes[0].cuarto_id).toBe('CF-2');
    });
  });

  describe('faltante > 0 cuando no hay stock suficiente', () => {
    it('reporta faltante si stock total < cantidad pedida', () => {
      // Total HC-5K en cuartos: solo 20. Pedimos revertir 50.
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-5K', cantidad: 50, folio: 'OP-005' },
        cuartos2,
        'Admin'
      );
      expect(faltante).toBe(30);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ cuarto_id: 'CF-1', delta: -20 });
    });

    it('faltante = cantidad completa si no hay nada del SKU', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'INEXISTENTE', cantidad: 100, folio: 'OP-006' },
        cuartos2,
        'Admin'
      );
      expect(faltante).toBe(100);
      expect(changes).toHaveLength(0);
    });
  });

  describe('casos borde y defensas', () => {
    it('cantidad = 0 → 0 cambios, faltante 0', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 0, folio: 'OP-007' },
        cuartos2,
        'Admin'
      );
      expect(changes).toEqual([]);
      expect(faltante).toBe(0);
    });

    it('cantidad negativa → 0 cambios, faltante 0', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: -10, folio: 'OP-008' },
        cuartos2,
        'Admin'
      );
      expect(changes).toEqual([]);
      expect(faltante).toBe(0);
    });

    it('SKU vacío → 0 cambios, faltante = cantidad (no se pudo cubrir)', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: '', cantidad: 100, folio: 'OP-009' },
        cuartos2,
        'Admin'
      );
      expect(changes).toEqual([]);
      expect(faltante).toBe(100);
    });

    it('cuartos vacíos → faltante = cantidad pedida', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 80, folio: 'OP-010' },
        [],
        'Admin'
      );
      expect(changes).toEqual([]);
      expect(faltante).toBe(80);
    });

    it('cuartos null/undefined → no crashea', () => {
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 80, folio: 'OP-011' },
        null,
        'Admin'
      );
      expect(changes).toEqual([]);
      expect(faltante).toBe(80);
    });

    it('cuarto con stock null/undefined no crashea', () => {
      const cuartos = [
        { id: 'CF-1', stock: null },
        { id: 'CF-2', stock: { 'HC-25K': 50 } },
      ];
      const { changes, faltante } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 30, folio: 'OP-012' },
        cuartos,
        'Admin'
      );
      expect(faltante).toBe(0);
      expect(changes).toHaveLength(1);
      expect(changes[0].cuarto_id).toBe('CF-2');
    });
  });

  describe('shape del change para update_stocks_atomic', () => {
    it('cada change incluye delta NEGATIVO (es un descuento)', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 100, folio: 'OP-013' },
        cuartos2,
        'Admin'
      );
      for (const c of changes) {
        expect(c.delta).toBeLessThan(0);
      }
    });

    it('tipo = "Reverso producción" en todos los changes', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 100, folio: 'OP-014' },
        cuartos2,
        'Admin'
      );
      for (const c of changes) expect(c.tipo).toBe('Reverso producción');
    });

    it('origen incluye el folio para trazabilidad en kárdex', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 50, folio: 'OP-077' },
        cuartos2,
        'Admin'
      );
      expect(changes[0].origen).toBe('Reverso OP-077');
    });

    it('si folio vacío, origen es "Reverso producción"', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 50, folio: '' },
        cuartos2,
        'Admin'
      );
      expect(changes[0].origen).toBe('Reverso producción');
    });

    it('usuario default "Admin" si no se pasa', () => {
      const { changes } = calcReversoChangesProduccion(
        { sku: 'HC-25K', cantidad: 50, folio: 'OP-015' },
        cuartos2,
        null
      );
      expect(changes[0].usuario).toBe('Admin');
    });
  });
});
