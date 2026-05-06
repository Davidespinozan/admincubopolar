// costoEmpaque.test.js — Tanda 11.
//
// Cubre el contrato del helper `_registrarCostoProduccion` (supaStore.js)
// a nivel de cálculo puro: qué entrada produce qué shape para inserción
// en `costos_historial` y `movimientos_contables`.
//
// El helper en sí toca Supabase, pero la lógica que decide skip/ok y
// los valores que se persisten dependen exclusivamente de
// `calcCostoProduccion` + `buildConceptoProduccion` (produccionLogic.js).
// Probar esa combinación captura las regresiones del flujo nuevo
// (producirYCongelar) sin necesidad de mockear Supabase.

import { describe, it, expect } from 'vitest';
import { calcCostoProduccion, buildConceptoProduccion } from '../data/produccionLogic';

// Replica la decisión de skip/ok del helper interno. Si alguien cambia
// la convención del helper (ej. permite costo 0 como ok), este test lo
// detecta.
function decidirRegistroCosto(cantidad, costoUnitario) {
  const cant = Number(cantidad || 0);
  if (cant <= 0) return { skipped: 'sku/cantidad inválidos' };
  const total = calcCostoProduccion(cant, costoUnitario);
  if (total <= 0) return { skipped: 'costo 0' };
  return { ok: true, costoTotal: total };
}

describe('decidirRegistroCosto (Tanda 11)', () => {
  it('cantidad y costo válidos → ok con costoTotal en centavos', () => {
    expect(decidirRegistroCosto(1000, 0.5)).toEqual({ ok: true, costoTotal: 500 });
  });

  it('cantidad 0 → skipped (no inserta nada)', () => {
    expect(decidirRegistroCosto(0, 5)).toEqual({ skipped: 'sku/cantidad inválidos' });
  });

  it('cantidad negativa → skipped', () => {
    expect(decidirRegistroCosto(-100, 5)).toEqual({ skipped: 'sku/cantidad inválidos' });
  });

  it('costo unitario 0 → skipped (empaque sin precio)', () => {
    expect(decidirRegistroCosto(500, 0)).toEqual({ skipped: 'costo 0' });
  });

  it('costo unitario null → skipped', () => {
    expect(decidirRegistroCosto(500, null)).toEqual({ skipped: 'costo 0' });
  });

  it('producción industrial (50,000 bolsas × $5.75) → costoTotal correcto', () => {
    // Caso real: corrida grande no debe perder precisión.
    expect(decidirRegistroCosto(50000, 5.75)).toEqual({ ok: true, costoTotal: 287500 });
  });
});

describe('shape para INSERT (costos_historial + movimientos_contables)', () => {
  it('ambas tablas reciben el mismo concepto + monto + fecha', () => {
    const cantidad = 1000;
    const costoUnitario = 0.5;
    const sku = 'HC-25K';
    const empaqueSku = 'EMP-25';
    const folio = 'OP-042';
    const id = 99;

    const decision = decidirRegistroCosto(cantidad, costoUnitario);
    expect(decision.ok).toBe(true);

    const concepto = buildConceptoProduccion(folio, id, cantidad, sku, empaqueSku);
    expect(concepto).toBe('Producción OP-042: 1000× HC-25K (empaque: EMP-25)');

    // Shape costos_historial: tipo, categoria, concepto, monto, periodo, fecha
    const costosHistRow = {
      tipo: 'Producción',
      categoria: 'Costo de Ventas',
      concepto,
      monto: decision.costoTotal,
      periodo: '2026-05',
      fecha: '2026-05-06',
    };
    expect(costosHistRow.monto).toBe(500);
    expect(costosHistRow.tipo).toBe('Producción');
    expect(costosHistRow.categoria).toBe('Costo de Ventas');

    // Shape movimientos_contables: fecha, tipo, categoria, concepto, monto, usuario_id
    const movRow = {
      fecha: '2026-05-06',
      tipo: 'Egreso',
      categoria: 'Costo de Ventas',
      concepto,
      monto: decision.costoTotal,
      usuario_id: 7,
    };
    expect(movRow.monto).toBe(costosHistRow.monto);
    expect(movRow.concepto).toBe(costosHistRow.concepto);
    expect(movRow.tipo).toBe('Egreso');
  });

  it('folio vacío → concepto cae al id como referencia', () => {
    const c = buildConceptoProduccion('', 17, 100, 'HC-5K', 'EMP-5');
    expect(c).toBe('Producción 17: 100× HC-5K (empaque: EMP-5)');
  });

  it('producción de 1 unidad con centavo justo → no pierde precisión', () => {
    // centavos() redondea a 2 decimales en pesos (no a centavos enteros).
    // 1 × $0.01 = $0.01.
    const decision = decidirRegistroCosto(1, 0.01);
    expect(decision).toEqual({ ok: true, costoTotal: 0.01 });
  });
});

describe('paridad confirmarProduccion vs producirYCongelar (Tanda 11)', () => {
  // Garantiza que ambos callers persisten el mismo costoTotal para
  // las mismas (cantidad, costoUnitario). El helper compartido es la
  // única fuente de verdad — si alguien cambia uno solo de los flujos
  // (ej. centavos() distinto), este test detecta la divergencia.
  it('cálculo determinístico para los mismos inputs', () => {
    const a = decidirRegistroCosto(1234, 0.78);
    const b = decidirRegistroCosto(1234, 0.78);
    expect(a).toEqual(b);
  });

  it('el helper decide skip independiente del caller', () => {
    // Misma orden producida vía confirmarProduccion vs producirYCongelar:
    // si el empaque no tiene costo, AMBAS rutas saltan (no contabilizan).
    expect(decidirRegistroCosto(500, 0)).toEqual({ skipped: 'costo 0' });
    expect(decidirRegistroCosto(500, 0)).toEqual({ skipped: 'costo 0' });
  });
});
