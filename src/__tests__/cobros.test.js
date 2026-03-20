// cobros.test.js — flujo de cobro de Cuentas por Cobrar
import { describe, it, expect } from 'vitest';
import { calcNuevaSaldoCxC } from '../data/cobrosLogic';

describe('calcNuevaSaldoCxC', () => {
  // ── Pago total ────────────────────────────────────────────────
  it('liquida la CxC cuando el pago cubre el saldo completo', () => {
    const r = calcNuevaSaldoCxC(1000, 0, 1000);
    expect(r.nuevoMontoPagado).toBe(1000);
    expect(r.nuevoSaldo).toBe(0);
    expect(r.nuevoEstatus).toBe('Pagada');
  });

  it('marca Pagada si el pago supera la deuda (sobrepago)', () => {
    const r = calcNuevaSaldoCxC(1000, 0, 1200);
    expect(r.nuevoSaldo).toBe(0);       // nunca negativo
    expect(r.nuevoEstatus).toBe('Pagada');
  });

  // ── Pago parcial ──────────────────────────────────────────────
  it('primer abono parcial → estatus Parcial', () => {
    const r = calcNuevaSaldoCxC(1000, 0, 400);
    expect(r.nuevoMontoPagado).toBe(400);
    expect(r.nuevoSaldo).toBe(600);
    expect(r.nuevoEstatus).toBe('Parcial');
  });

  it('segundo abono que aún no liquida → sigue Parcial', () => {
    const r = calcNuevaSaldoCxC(1000, 400, 300);
    expect(r.nuevoMontoPagado).toBe(700);
    expect(r.nuevoSaldo).toBe(300);
    expect(r.nuevoEstatus).toBe('Parcial');
  });

  it('segundo abono que liquida exactamente → Pagada', () => {
    const r = calcNuevaSaldoCxC(1000, 600, 400);
    expect(r.nuevoSaldo).toBe(0);
    expect(r.nuevoEstatus).toBe('Pagada');
  });

  // ── Cero pagado previo ─────────────────────────────────────────
  it('sin pagos previos y pago 0 → sigue Pendiente', () => {
    const r = calcNuevaSaldoCxC(500, 0, 0);
    expect(r.nuevoEstatus).toBe('Pendiente');
    expect(r.nuevoSaldo).toBe(500);
  });

  // ── Precisión monetaria ───────────────────────────────────────
  it('maneja decimales sin error de floating point', () => {
    // 333.33 + 333.33 + 333.34 = 1000.00 — no debe ser 999.9999...
    const r1 = calcNuevaSaldoCxC(1000, 0, 333.33);
    const r2 = calcNuevaSaldoCxC(1000, 333.33, 333.33);
    const r3 = calcNuevaSaldoCxC(1000, 666.66, 333.34);
    expect(r1.nuevoSaldo).toBe(666.67);
    expect(r2.nuevoSaldo).toBe(333.34);
    expect(r3.nuevoSaldo).toBe(0);
    expect(r3.nuevoEstatus).toBe('Pagada');
  });

  it('saldo nunca es negativo aunque el pago exceda la deuda', () => {
    const r = calcNuevaSaldoCxC(500, 400, 200); // pagaría 100 de más
    expect(r.nuevoSaldo).toBeGreaterThanOrEqual(0);
  });

  // ── Acumulación correcta ──────────────────────────────────────
  it('acumula correctamente montoPagado con pagos anteriores', () => {
    const r = calcNuevaSaldoCxC(2000, 800, 500);
    expect(r.nuevoMontoPagado).toBe(1300);
    expect(r.nuevoSaldo).toBe(700);
  });
});
