// borrarMerma.test.js
// Tests para la lógica pura del flujo de borrarMermaConReverso — sin Supabase.
// Cubre seleccionarCuartoFIFOInverso + validarMermaParaReverso +
// buildReversoMermaChange + matchConceptoMerma + decidirBorrarMovimientoContable.
import { describe, it, expect } from 'vitest';
import {
  seleccionarCuartoFIFOInverso,
  validarMermaParaReverso,
  buildReversoMermaChange,
  matchConceptoMerma,
  decidirBorrarMovimientoContable,
} from '../data/mermasLogic';

// ─── seleccionarCuartoFIFOInverso ────────────────────────────
describe('seleccionarCuartoFIFOInverso', () => {
  it('devuelve el primer cuarto del array (FIFO inverso simple)', () => {
    const cuartos = [
      { id: 1, nombre: 'CF-1' },
      { id: 2, nombre: 'CF-2' },
      { id: 3, nombre: 'CF-3' },
    ];
    expect(seleccionarCuartoFIFOInverso(cuartos)).toEqual({ id: 1, nombre: 'CF-1' });
  });

  it('null si la lista está vacía', () => {
    expect(seleccionarCuartoFIFOInverso([])).toBeNull();
  });

  it('null si el input no es un array', () => {
    expect(seleccionarCuartoFIFOInverso(null)).toBeNull();
    expect(seleccionarCuartoFIFOInverso(undefined)).toBeNull();
    expect(seleccionarCuartoFIFOInverso({})).toBeNull();
  });

  it('respeta el orden: si hay solo uno, ese gana', () => {
    expect(seleccionarCuartoFIFOInverso([{ id: 99 }])).toEqual({ id: 99 });
  });
});

// ─── validarMermaParaReverso ─────────────────────────────────
describe('validarMermaParaReverso', () => {
  it('null cuando merma es válida', () => {
    expect(validarMermaParaReverso({ sku: 'HC-25K', cantidad: 5 })).toBeNull();
  });

  it('error si merma es null/undefined', () => {
    expect(validarMermaParaReverso(null)?.error).toMatch(/merma/i);
    expect(validarMermaParaReverso(undefined)?.error).toMatch(/merma/i);
  });

  it('error si merma no es objeto', () => {
    expect(validarMermaParaReverso('texto')?.error).toMatch(/merma/i);
    expect(validarMermaParaReverso(42)?.error).toMatch(/merma/i);
  });

  it('error si sku está vacío o ausente', () => {
    expect(validarMermaParaReverso({ cantidad: 5 })?.error).toMatch(/sku/i);
    expect(validarMermaParaReverso({ sku: '', cantidad: 5 })?.error).toMatch(/sku/i);
    expect(validarMermaParaReverso({ sku: '   ', cantidad: 5 })?.error).toMatch(/sku/i);
  });

  it('error si cantidad es 0', () => {
    expect(validarMermaParaReverso({ sku: 'X', cantidad: 0 })?.error).toMatch(/cantidad/i);
  });

  it('error si cantidad es negativa', () => {
    expect(validarMermaParaReverso({ sku: 'X', cantidad: -5 })?.error).toMatch(/cantidad/i);
  });

  it('error si cantidad no es numérica', () => {
    expect(validarMermaParaReverso({ sku: 'X', cantidad: 'abc' })?.error).toMatch(/cantidad/i);
    expect(validarMermaParaReverso({ sku: 'X', cantidad: NaN })?.error).toMatch(/cantidad/i);
  });

  it('OK con cantidad como string numérico', () => {
    expect(validarMermaParaReverso({ sku: 'X', cantidad: '10' })).toBeNull();
  });
});

// ─── buildReversoMermaChange ─────────────────────────────────
describe('buildReversoMermaChange', () => {
  it('construye change con delta positivo (entrada al cuarto)', () => {
    const merma = { id: 42, sku: 'HC-25K', cantidad: 5, causa: 'Bolsa rota' };
    const cuarto = { id: 1, nombre: 'CF-1' };
    const r = buildReversoMermaChange(merma, cuarto, 'Santiago');
    expect(r).toEqual({
      cuarto_id: 1,
      sku: 'HC-25K',
      delta: 5,
      tipo: 'Reverso merma',
      origen: 'Borrado merma id=42 (Bolsa rota)',
      usuario: 'Santiago',
    });
  });

  it('delta es positivo aunque cantidad fue persistida como tal', () => {
    const r = buildReversoMermaChange(
      { id: 1, sku: 'X', cantidad: 100, causa: 'X' },
      { id: 1 },
      'admin'
    );
    expect(r.delta).toBe(100);
    expect(r.delta).toBeGreaterThan(0);
  });

  it('coerce cantidad string a number', () => {
    const r = buildReversoMermaChange(
      { id: 1, sku: 'X', cantidad: '50', causa: 'Y' },
      { id: 1 },
      'admin'
    );
    expect(r.delta).toBe(50);
    expect(typeof r.delta).toBe('number');
  });

  it('causa vacía o ausente → "sin causa" en origen', () => {
    const sinCausa = buildReversoMermaChange(
      { id: 7, sku: 'X', cantidad: 1, causa: '' },
      { id: 1 },
      'admin'
    );
    expect(sinCausa.origen).toBe('Borrado merma id=7 (sin causa)');

    const sinCampo = buildReversoMermaChange(
      { id: 8, sku: 'X', cantidad: 1 },
      { id: 1 },
      'admin'
    );
    expect(sinCampo.origen).toBe('Borrado merma id=8 (sin causa)');
  });

  it('default usuario "Admin" si null/vacío', () => {
    const r1 = buildReversoMermaChange({ id: 1, sku: 'X', cantidad: 1, causa: 'Y' }, { id: 1 }, null);
    expect(r1.usuario).toBe('Admin');
    const r2 = buildReversoMermaChange({ id: 1, sku: 'X', cantidad: 1, causa: 'Y' }, { id: 1 }, '');
    expect(r2.usuario).toBe('Admin');
  });

  it('cuarto_id refleja el cuarto seleccionado', () => {
    const r = buildReversoMermaChange(
      { id: 1, sku: 'X', cantidad: 1, causa: 'Y' },
      { id: 'cf-9', nombre: 'CF-9' },
      'admin'
    );
    expect(r.cuarto_id).toBe('cf-9');
  });
});

// ─── matchConceptoMerma ──────────────────────────────────────
describe('matchConceptoMerma', () => {
  it('genera el patrón estable para LIKE', () => {
    const r = matchConceptoMerma({ sku: 'HC-25K', cantidad: 5 });
    expect(r).toBe('Merma 5× HC-25K');
  });

  it('coerce cantidad string a number antes del template', () => {
    const r = matchConceptoMerma({ sku: 'HC-25K', cantidad: '5' });
    expect(r).toBe('Merma 5× HC-25K');
  });

  it('cantidad decimal se pasa tal cual (Number coerce)', () => {
    const r = matchConceptoMerma({ sku: 'HC-25K', cantidad: 5.5 });
    expect(r).toBe('Merma 5.5× HC-25K');
  });

  it('match es prefijo del concepto guardado por registrarMerma', () => {
    // El concepto real al registrar es:
    //   "Merma 5× HC-25K (Hielo Cubo 25kg) — Bolsa rota"
    // Verificamos que el match esté incluido como prefijo.
    const conceptoReal = 'Merma 5× HC-25K (Hielo Cubo 25kg) — Bolsa rota';
    const match = matchConceptoMerma({ sku: 'HC-25K', cantidad: 5 });
    expect(conceptoReal.includes(match)).toBe(true);
  });
});

// ─── decidirBorrarMovimientoContable ─────────────────────────
describe('decidirBorrarMovimientoContable', () => {
  it('noop cuando no hay matches', () => {
    expect(decidirBorrarMovimientoContable([])).toEqual({ accion: 'noop' });
  });

  it('noop cuando input es null/undefined', () => {
    expect(decidirBorrarMovimientoContable(null)).toEqual({ accion: 'noop' });
    expect(decidirBorrarMovimientoContable(undefined)).toEqual({ accion: 'noop' });
  });

  it('delete cuando match único, devuelve el id', () => {
    const r = decidirBorrarMovimientoContable([{ id: 99 }]);
    expect(r).toEqual({ accion: 'delete', id: 99 });
  });

  it('aviso cuando hay múltiples matches (no se borra automáticamente)', () => {
    const r = decidirBorrarMovimientoContable([{ id: 1 }, { id: 2 }]);
    expect(r).toEqual({ accion: 'aviso' });
  });

  it('aviso cuando hay 5 matches', () => {
    const movs = [1, 2, 3, 4, 5].map(id => ({ id }));
    expect(decidirBorrarMovimientoContable(movs)).toEqual({ accion: 'aviso' });
  });

  it('input no-array → noop', () => {
    expect(decidirBorrarMovimientoContable('texto')).toEqual({ accion: 'noop' });
    expect(decidirBorrarMovimientoContable({})).toEqual({ accion: 'noop' });
  });
});
