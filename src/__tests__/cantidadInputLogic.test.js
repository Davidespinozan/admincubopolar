import { describe, it, expect } from 'vitest';
import { cantidadEnEdicion, cantidadNormalizada } from '../data/cantidadInputLogic';

describe('cantidad de la línea de venta mientras se escribe', () => {
  it('conserva el texto vacío al borrar (no fuerza 1 en cada tecla)', () => {
    expect(cantidadEnEdicion('')).toBe('');
    expect(cantidadEnEdicion('5')).toBe('5');
    expect(cantidadEnEdicion('12')).toBe('12');
  });
  it('solo acepta dígitos', () => {
    expect(cantidadEnEdicion('1e')).toBe('1');
    expect(cantidadEnEdicion('-3')).toBe('3');
    expect(cantidadEnEdicion('2.5')).toBe('25');
    expect(cantidadEnEdicion(null)).toBe('');
    expect(cantidadEnEdicion(7)).toBe('7');
  });
  it('al salir del campo normaliza a un entero >= 1', () => {
    expect(cantidadNormalizada('')).toBe(1);
    expect(cantidadNormalizada('0')).toBe(1);
    expect(cantidadNormalizada('5')).toBe(5);
    expect(cantidadNormalizada('007')).toBe(7);
    expect(cantidadNormalizada(3)).toBe(3);
    expect(cantidadNormalizada(undefined)).toBe(1);
  });
  it('escribir 5 tras borrar el 1 da 5, no 15', () => {
    const tecleado = ['1', '', '5'].map(cantidadEnEdicion);
    expect(tecleado).toEqual(['1', '', '5']);
    expect(cantidadNormalizada(tecleado.at(-1))).toBe(5);
  });
});
