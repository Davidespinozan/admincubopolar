// inventarioAtomicidad.test.js — builders puros para RPCs atómicas
// (update_stocks_atomic y update_productos_stock_atomic). Cubre el shape
// del payload que la BD recibe; las garantías de FOR UPDATE + RAISE EXCEPTION
// están en migraciones 047 y 054 y se prueban manualmente con SQL.
import { describe, it, expect } from 'vitest';
import {
  buildMeterChange,
  buildSacarChange,
  buildTraspasoChanges,
  validateTraspaso,
  buildMovimientoBolsaChange,
} from '../data/inventarioLogic';

// ─── buildMeterChange ──────────────────────────────────────────
describe('buildMeterChange', () => {
  it('genera change con delta POSITIVO (es entrada)', () => {
    const c = buildMeterChange('CF-1', 'HC-25K', 100);
    expect(c.delta).toBe(100);
    expect(c.delta).toBeGreaterThan(0);
  });

  it('shape completo con valores default', () => {
    const c = buildMeterChange('CF-1', 'HC-25K', 50);
    expect(c).toMatchObject({
      cuarto_id: 'CF-1',
      sku: 'HC-25K',
      delta: 50,
      tipo: 'Entrada',
      usuario: 'Sistema',
    });
    expect(c.origen).toContain('CF-1');
  });

  it('usa cuartoNombre en origen si se pasa', () => {
    const c = buildMeterChange('CF-1', 'HC-25K', 50, { cuartoNombre: 'Cuarto Norte' });
    expect(c.origen).toBe('Entrada a Cuarto Norte');
  });

  it('respeta opciones.tipo, opciones.origen, opciones.usuario', () => {
    const c = buildMeterChange('CF-1', 'HC-5K', 30, {
      tipo: 'Producción', origen: 'Producción OP-001', usuario: 'Juan',
    });
    expect(c.tipo).toBe('Producción');
    expect(c.origen).toBe('Producción OP-001');
    expect(c.usuario).toBe('Juan');
  });

  it('coerce cuarto_id y sku a string', () => {
    const c = buildMeterChange(123, 456, 10);
    expect(typeof c.cuarto_id).toBe('string');
    expect(typeof c.sku).toBe('string');
  });
});

// ─── buildSacarChange ──────────────────────────────────────────
describe('buildSacarChange', () => {
  it('genera change con delta NEGATIVO (es salida)', () => {
    const c = buildSacarChange('CF-1', 'HC-25K', 80, 'Carga ruta');
    expect(c.delta).toBe(-80);
    expect(c.delta).toBeLessThan(0);
  });

  it('usa motivo como origen', () => {
    const c = buildSacarChange('CF-1', 'HC-25K', 80, 'Carga ruta R-007');
    expect(c.origen).toBe('Carga ruta R-007');
  });

  it('si no hay motivo, fallback a cfId como origen', () => {
    const c = buildSacarChange('CF-2', 'HC-5K', 10, '');
    expect(c.origen).toBe('CF-2');
  });

  it('tipo default = "Salida"', () => {
    const c = buildSacarChange('CF-1', 'HC-25K', 50, 'algo');
    expect(c.tipo).toBe('Salida');
  });
});

// ─── buildTraspasoChanges ──────────────────────────────────────
describe('buildTraspasoChanges', () => {
  it('genera EXACTAMENTE 2 changes (salida + entrada)', () => {
    const changes = buildTraspasoChanges({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 50 });
    expect(changes).toHaveLength(2);
  });

  it('change[0] = salida (delta negativo en origen)', () => {
    const changes = buildTraspasoChanges({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 50 });
    expect(changes[0]).toMatchObject({
      cuarto_id: 'CF-1',
      delta: -50,
      tipo: 'Traspaso salida',
    });
  });

  it('change[1] = entrada (delta positivo en destino)', () => {
    const changes = buildTraspasoChanges({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 50 });
    expect(changes[1]).toMatchObject({
      cuarto_id: 'CF-2',
      delta: 50,
      tipo: 'Traspaso entrada',
    });
  });

  it('deltas suman 0 (conservación de stock)', () => {
    const changes = buildTraspasoChanges({ origen: 'A', destino: 'B', sku: 'HC-5K', cantidad: 100 });
    const total = changes.reduce((s, c) => s + c.delta, 0);
    expect(total).toBe(0);
  });

  it('mismo SKU en ambos changes', () => {
    const changes = buildTraspasoChanges({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 50 });
    expect(changes[0].sku).toBe(changes[1].sku);
  });

  it('origen textual incluye ambos cuartos para trazabilidad', () => {
    const changes = buildTraspasoChanges({ origen: 'CF-1', destino: 'CF-2', sku: 'HC-25K', cantidad: 50 });
    expect(changes[0].origen).toBe('CF-1 → CF-2');
    expect(changes[1].origen).toBe('CF-1 → CF-2');
  });

  it('usuario default y override', () => {
    const def = buildTraspasoChanges({ origen: 'A', destino: 'B', sku: 'X', cantidad: 1 });
    expect(def[0].usuario).toBe('Sistema');
    const custom = buildTraspasoChanges({ origen: 'A', destino: 'B', sku: 'X', cantidad: 1 }, { usuario: 'María' });
    expect(custom[0].usuario).toBe('María');
  });
});

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
  it('NUNCA hay clamp silencioso a 0 (Math.max removido)', () => {
    // En el patrón viejo: Math.max(0, prev - qty) escondía over-selling.
    // Ahora la BD hace RAISE EXCEPTION. El builder genera delta negativo
    // sin importar el stock disponible; la BD valida.
    const c = buildSacarChange('CF-1', 'HC-25K', 99999, 'extremo');
    expect(c.delta).toBe(-99999);
  });

  it('todos los changes tienen los 5 campos requeridos por el RPC', () => {
    const meter = buildMeterChange('CF-1', 'X', 1);
    const sacar = buildSacarChange('CF-1', 'X', 1, 'm');
    const trasp = buildTraspasoChanges({ origen: 'A', destino: 'B', sku: 'X', cantidad: 1 });
    const movB = buildMovimientoBolsaChange('X', 1, 'Entrada', 'm');
    for (const c of [meter, sacar, ...trasp]) {
      expect(c).toHaveProperty('cuarto_id');
      expect(c).toHaveProperty('sku');
      expect(c).toHaveProperty('delta');
      expect(c).toHaveProperty('tipo');
      expect(c).toHaveProperty('origen');
      expect(c).toHaveProperty('usuario');
    }
    // movimiento bolsa no tiene cuarto_id (productos.stock es escalar)
    expect(movB).toHaveProperty('sku');
    expect(movB).toHaveProperty('delta');
    expect(movB).toHaveProperty('tipo');
    expect(movB).toHaveProperty('origen');
    expect(movB).toHaveProperty('usuario');
  });
});
