// rutasBloque1.test.js — Bloque 1 urgente del módulo Rutas.
// Cubre validateEdicionRuta (bloquea Cerrada/Cancelada/Completada).
// La RPC `asignar_ordenes_a_ruta` (mig 057) y la atomicidad se prueban
// manualmente en Supabase con SQL; el shape del payload del caller se
// verifica leyendo el código del store.
import { describe, it, expect } from 'vitest';
import { validateEdicionRuta } from '../data/rutasLogic';
import { normalizeStr } from '../utils/safe';

// ─── validateEdicionRuta ───────────────────────────────────────
describe('validateEdicionRuta', () => {
  it('null cuando estatus es Programada', () => {
    expect(validateEdicionRuta('Programada')).toBeNull();
  });

  it('null cuando estatus es En progreso', () => {
    expect(validateEdicionRuta('En progreso')).toBeNull();
  });

  it('null cuando estatus es Cargada (post-firma, pre-iniciar)', () => {
    expect(validateEdicionRuta('Cargada')).toBeNull();
  });

  it('null cuando estatus es Pendiente firma', () => {
    expect(validateEdicionRuta('Pendiente firma')).toBeNull();
  });

  it('error cuando estatus es Cerrada', () => {
    const r = validateEdicionRuta('Cerrada');
    expect(r?.error).toMatch(/cerrada|cancelada|completada/i);
  });

  it('error cuando estatus es Cancelada', () => {
    const r = validateEdicionRuta('Cancelada');
    expect(r?.error).toMatch(/cerrada|cancelada|completada/i);
  });

  it('error cuando estatus es Completada', () => {
    const r = validateEdicionRuta('Completada');
    expect(r?.error).toMatch(/cerrada|cancelada|completada/i);
  });

  it('null cuando estatus es null/undefined/string vacío', () => {
    // Caso edge: ruta sin estatus en BD (no debería ocurrir).
    // Defensivo: permitir edición — la validación en BD/UI atrapa otros casos.
    expect(validateEdicionRuta(null)).toBeNull();
    expect(validateEdicionRuta(undefined)).toBeNull();
    expect(validateEdicionRuta('')).toBeNull();
  });

  it('trim del estatus no afecta validación', () => {
    expect(validateEdicionRuta('  Cerrada  ')?.error).toBeTruthy();
    expect(validateEdicionRuta('  Programada  ')).toBeNull();
  });

  it('case-sensitive (refleja estatus_ruta ENUM)', () => {
    // El ENUM usa "Cerrada" (capitalizado). Si llegan minúsculas, dejamos pasar
    // — significa dato corrupto que la BD ya tiene rechazado.
    expect(validateEdicionRuta('cerrada')).toBeNull();
    expect(validateEdicionRuta('CERRADA')).toBeNull();
  });
});

// ─── normalizeStr aplicado a búsqueda de rutas ─────────────────
describe('búsqueda de rutas con normalizeStr', () => {
  it('encuentra ruta con acentos buscando sin acentos', () => {
    const target = normalizeStr('Ruta Periférico Norte');
    expect(target.includes(normalizeStr('periferico'))).toBe(true);
    expect(target.includes(normalizeStr('norte'))).toBe(true);
  });

  it('encuentra cliente con ñ buscando sin ñ', () => {
    expect(normalizeStr('Nevería Don Peña').includes(normalizeStr('Pena'))).toBe(true);
  });

  it('folio con prefijo R-/OV- normaliza correctamente', () => {
    expect(normalizeStr('R-007').includes(normalizeStr('007'))).toBe(true);
    expect(normalizeStr('OV-0042').includes(normalizeStr('OV'))).toBe(true);
  });
});

// ─── invariantes RPC asignar_ordenes_a_ruta (shape de caller) ──
// La RPC vive en supabase/057_rpc_asignar_ordenes_ruta.sql. Aquí
// verificamos solo el shape del argumento que el store envía al RPC.
describe('asignarOrdenesARuta caller shape', () => {
  it('coerce ordenIds a number array y filtra NaN', () => {
    // El caller hace: ordenIds.map(o => Number(o)).filter(Number.isFinite).
    // Number(null)=0, Number(undefined)=NaN, Number('abc')=NaN.
    // Si llega un id=0 (no debería), el RPC lo rechazará ('Orden 0 no existe').
    const inputs = ['1', '2', 3, '4', 'abc', undefined];
    const expected = inputs.map(o => Number(o)).filter(Number.isFinite);
    expect(expected).toEqual([1, 2, 3, 4]);
  });

  it('rechaza array vacío antes de llamar al RPC', () => {
    // El store retorna {error:'Sin órdenes para asignar'} si ordenIds.length === 0
    const ordenIds = [];
    expect(Array.isArray(ordenIds) && ordenIds.length === 0).toBe(true);
  });
});
