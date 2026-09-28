// transformacion.test.js — validateTransformacion (input/output/cuarto).
// Los builders del flujo fragmentado se retiraron con la mig 076; el
// contrato atómico se prueba en produccionAtomica.test.js y en SQL (076).
import { describe, it, expect } from 'vitest';
import { validateTransformacion } from '../data/transformacionLogic';

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
