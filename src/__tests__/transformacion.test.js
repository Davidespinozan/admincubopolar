// transformacion.test.js — helpers puros del flujo híbrido de transformación.
// Cubre validateTransformacion (input/output/cuarto), buildTransformacionRow
// (shape para INSERT en `produccion`), buildInsumoChange (RPC productos),
// buildOutputChange (RPC cuartos_frios), buildInsumoRollbackChange.
import { describe, it, expect } from 'vitest';
import {
  validateTransformacion,
  buildTransformacionRow,
  buildInsumoChange,
  buildOutputChange,
  buildInsumoRollbackChange,
} from '../data/transformacionLogic';

const insumoOK = { sku: 'BH-50K', nombre: 'Barra 50 kg', stock: 200, tipo: 'Materia Prima' };
const outputOK = { sku: 'HT-TRITURADO', nombre: 'Hielo triturado', tipo: 'Producto Terminado' };
const cuartos = [{ id: 'CF-1', nombre: 'Cuarto Norte' }, { id: 'CF-2', nombre: 'Cuarto Sur' }];

const payloadOK = {
  input_sku: 'BH-50K',
  input_kg: 100,
  output_sku: 'HT-TRITURADO',
  output_kg: 80,
  cuarto_destino: 'CF-1',
};

// ─── validateTransformacion ────────────────────────────────────
describe('validateTransformacion', () => {
  it('null cuando todo OK', () => {
    expect(validateTransformacion(payloadOK, insumoOK, outputOK, cuartos)).toBeNull();
  });

  it('rechaza input_sku faltante', () => {
    expect(validateTransformacion({ ...payloadOK, input_sku: '' }, insumoOK, outputOK, cuartos)?.error).toMatch(/insumo/i);
  });

  it('rechaza output_sku faltante', () => {
    expect(validateTransformacion({ ...payloadOK, output_sku: '' }, insumoOK, outputOK, cuartos)?.error).toMatch(/destino/i);
  });

  it('rechaza cuarto_destino faltante', () => {
    expect(validateTransformacion({ ...payloadOK, cuarto_destino: '' }, insumoOK, outputOK, cuartos)?.error).toMatch(/cuarto/i);
  });

  it('rechaza input_kg <= 0', () => {
    expect(validateTransformacion({ ...payloadOK, input_kg: 0 }, insumoOK, outputOK, cuartos)?.error).toMatch(/insumo inválida/i);
    expect(validateTransformacion({ ...payloadOK, input_kg: -5 }, insumoOK, outputOK, cuartos)?.error).toMatch(/insumo inválida/i);
  });

  it('rechaza output_kg <= 0', () => {
    expect(validateTransformacion({ ...payloadOK, output_kg: 0 }, insumoOK, outputOK, cuartos)?.error).toMatch(/salida inválida/i);
  });

  it('rechaza output_kg > input_kg (no se puede crear materia)', () => {
    expect(validateTransformacion({ ...payloadOK, output_kg: 150 }, insumoOK, outputOK, cuartos)?.error).toMatch(/no puede superar/i);
  });

  it('rechaza merma negativa', () => {
    expect(validateTransformacion({ ...payloadOK, cantidadMerma: -10 }, insumoOK, outputOK, cuartos)?.error).toMatch(/merma/i);
  });

  it('rechaza producto origen no encontrado', () => {
    expect(validateTransformacion(payloadOK, null, outputOK, cuartos)?.error).toMatch(/Insumo no encontrado/i);
  });

  it('rechaza producto origen con tipo incorrecto (Producto Terminado no es insumo)', () => {
    const productoTerminado = { ...insumoOK, tipo: 'Producto Terminado' };
    expect(validateTransformacion(payloadOK, productoTerminado, outputOK, cuartos)?.error).toMatch(/no es un insumo/i);
  });

  it('acepta tipo "Insumo" además de "Materia Prima"', () => {
    const insumoAlt = { ...insumoOK, tipo: 'Insumo' };
    expect(validateTransformacion(payloadOK, insumoAlt, outputOK, cuartos)).toBeNull();
  });

  it('rechaza producto destino no encontrado', () => {
    expect(validateTransformacion(payloadOK, insumoOK, null, cuartos)?.error).toMatch(/destino no encontrado/i);
  });

  it('rechaza producto destino que NO es Producto Terminado', () => {
    const empaque = { ...outputOK, tipo: 'Empaque' };
    expect(validateTransformacion(payloadOK, insumoOK, empaque, cuartos)?.error).toMatch(/no es Producto Terminado/i);
  });

  it('rechaza cuarto destino inexistente', () => {
    expect(validateTransformacion({ ...payloadOK, cuarto_destino: 'CF-99' }, insumoOK, outputOK, cuartos)?.error).toMatch(/Cuarto destino.*no existe/i);
  });

  it('rechaza stock insuficiente (early validation)', () => {
    const insumoEscaso = { ...insumoOK, stock: 50 };
    expect(validateTransformacion(payloadOK, insumoEscaso, outputOK, cuartos)?.error).toMatch(/Stock insuficiente/i);
  });

  it('payload null/no-objeto rechaza', () => {
    expect(validateTransformacion(null, insumoOK, outputOK, cuartos)?.error).toBeTruthy();
    expect(validateTransformacion(undefined, insumoOK, outputOK, cuartos)?.error).toBeTruthy();
  });
});

// ─── buildTransformacionRow ────────────────────────────────────
describe('buildTransformacionRow', () => {
  it('shape correcto con todos los campos', () => {
    const row = buildTransformacionRow({
      folio: 'TR-007', fecha: '2026-05-05',
      input_sku: 'BH-50K', input_kg: 100,
      output_sku: 'HT-TRITURADO', output_kg: 80,
      merma_kg: 20, notas: 'lote 1',
    });
    expect(row).toMatchObject({
      folio: 'TR-007',
      fecha: '2026-05-05',
      turno: 'Transformación',
      maquina: 'Manual',
      sku: 'HT-TRITURADO',
      cantidad: 80, // round(80)
      estatus: 'Confirmada',
      tipo: 'Transformacion',
      input_sku: 'BH-50K',
      input_kg: 100,
      output_kg: 80,
      merma_kg: 20,
      destino: 'lote 1',
    });
  });

  it('rendimiento calculado a 2 decimales', () => {
    const row = buildTransformacionRow({
      folio: 'TR-1', fecha: '2026-01-01',
      input_sku: 'BH-50K', input_kg: 100,
      output_sku: 'HT-TRITURADO', output_kg: 78.4,
      merma_kg: 21.6,
    });
    expect(row.rendimiento).toBe(78.4);
  });

  it('rendimiento 0 cuando input es 0 (defensivo)', () => {
    const row = buildTransformacionRow({
      folio: 'TR-1', fecha: '2026-01-01',
      input_sku: 'X', input_kg: 0,
      output_sku: 'Y', output_kg: 0,
    });
    expect(row.rendimiento).toBe(0);
  });

  it('notas null se transforma a destino:null', () => {
    const row = buildTransformacionRow({
      folio: 'TR-1', fecha: '2026-01-01',
      input_sku: 'BH-50K', input_kg: 10,
      output_sku: 'HT-TRITURADO', output_kg: 8,
    });
    expect(row.destino).toBeNull();
  });

  it('cantidad redondea outputKg fraccional', () => {
    const row = buildTransformacionRow({
      folio: 'TR-1', fecha: '2026-01-01',
      input_sku: 'BH-50K', input_kg: 50,
      output_sku: 'HT-TRITURADO', output_kg: 39.6,
    });
    expect(row.cantidad).toBe(40);
  });
});

// ─── buildInsumoChange ─────────────────────────────────────────
describe('buildInsumoChange', () => {
  it('delta NEGATIVO (descuento del insumo)', () => {
    const c = buildInsumoChange({ input_sku: 'BH-50K', input_kg: 100, output_sku: 'HT-TRITURADO', folio: 'TR-007', usuario: 'Juan' });
    expect(c.delta).toBe(-100);
    expect(c.tipo).toBe('Salida');
  });

  it('shape para update_productos_stock_atomic (sin cuarto_id)', () => {
    const c = buildInsumoChange({ input_sku: 'BH-50K', input_kg: 50, output_sku: 'HT-TRITURADO', folio: 'TR-1', usuario: 'X' });
    expect(c).not.toHaveProperty('cuarto_id');
    expect(c).toHaveProperty('sku');
    expect(c).toHaveProperty('delta');
    expect(c).toHaveProperty('tipo');
    expect(c).toHaveProperty('origen');
    expect(c).toHaveProperty('usuario');
  });

  it('origen incluye folio y output_sku para trazabilidad', () => {
    const c = buildInsumoChange({ input_sku: 'BH-50K', input_kg: 100, output_sku: 'HT-TRITURADO', folio: 'TR-007', usuario: 'X' });
    expect(c.origen).toContain('TR-007');
    expect(c.origen).toContain('HT-TRITURADO');
  });

  it('usuario default Sistema si no se pasa', () => {
    const c = buildInsumoChange({ input_sku: 'X', input_kg: 1, output_sku: 'Y', folio: 'TR-1', usuario: null });
    expect(c.usuario).toBe('Sistema');
  });
});

// ─── buildOutputChange ─────────────────────────────────────────
describe('buildOutputChange', () => {
  it('delta POSITIVO al cuarto destino', () => {
    const c = buildOutputChange({
      cuarto_destino: 'CF-1', output_sku: 'HT-TRITURADO', output_kg: 80,
      input_sku: 'BH-50K', folio: 'TR-007', usuario: 'X',
    });
    expect(c.delta).toBe(80);
    expect(c.cuarto_id).toBe('CF-1');
    expect(c.tipo).toBe('Entrada');
  });

  it('output_kg fraccional se redondea (RPC espera INTEGER)', () => {
    const c = buildOutputChange({
      cuarto_destino: 'CF-1', output_sku: 'HT-TRITURADO', output_kg: 78.4,
      input_sku: 'BH-50K', folio: 'TR-007', usuario: 'X',
    });
    expect(c.delta).toBe(78);
  });

  it('cuarto_id se coerce a string', () => {
    const c = buildOutputChange({
      cuarto_destino: 1, output_sku: 'X', output_kg: 1,
      input_sku: 'Y', folio: 'TR-1', usuario: 'X',
    });
    expect(typeof c.cuarto_id).toBe('string');
    expect(c.cuarto_id).toBe('1');
  });

  it('origen incluye folio y nombre del cuarto si se pasa', () => {
    const c = buildOutputChange({
      cuarto_destino: 'CF-1', output_sku: 'HT-TRITURADO', output_kg: 80,
      input_sku: 'BH-50K', folio: 'TR-007', usuario: 'X', cuartoNombre: 'Norte',
    });
    expect(c.origen).toContain('TR-007');
    expect(c.origen).toContain('Norte');
  });
});

// ─── buildInsumoRollbackChange ─────────────────────────────────
describe('buildInsumoRollbackChange', () => {
  it('delta POSITIVO (devuelve insumo)', () => {
    const c = buildInsumoRollbackChange({ input_sku: 'BH-50K', input_kg: 100, output_sku: 'HT-TRITURADO', folio: 'TR-007', usuario: 'X' });
    expect(c.delta).toBe(100);
    expect(c.tipo).toBe('Entrada');
    expect(c.origen).toContain('Rollback');
    expect(c.origen).toContain('TR-007');
  });

  it('insumo + rollback suman 0 (conservación)', () => {
    const insumo = buildInsumoChange({ input_sku: 'X', input_kg: 50, output_sku: 'Y', folio: 'TR-1', usuario: 'A' });
    const rollback = buildInsumoRollbackChange({ input_sku: 'X', input_kg: 50, output_sku: 'Y', folio: 'TR-1', usuario: 'A' });
    expect(insumo.delta + rollback.delta).toBe(0);
  });
});

// ─── invariantes integración ───────────────────────────────────
describe('integración: validate + builders', () => {
  it('un payload válido produce changes coherentes', () => {
    expect(validateTransformacion(payloadOK, insumoOK, outputOK, cuartos)).toBeNull();
    const insumo = buildInsumoChange({ ...payloadOK, folio: 'TR-1', usuario: 'X' });
    const output = buildOutputChange({ ...payloadOK, folio: 'TR-1', usuario: 'X' });
    expect(insumo.delta).toBeLessThan(0);
    expect(output.delta).toBeGreaterThan(0);
    expect(insumo.sku).toBe('BH-50K');
    expect(output.sku).toBe('HT-TRITURADO');
  });
});
