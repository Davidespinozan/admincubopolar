// enLetras.test.js — importe con número a letras (Tanda 28).
import { describe, it, expect } from 'vitest';
import { enteroALetras, importeEnLetras } from '../data/enLetras';

describe('enteroALetras', () => {
  it('unidades y especiales', () => {
    expect(enteroALetras(0)).toBe('cero');
    expect(enteroALetras(7)).toBe('siete');
    expect(enteroALetras(15)).toBe('quince');
    expect(enteroALetras(16)).toBe('dieciséis');
    expect(enteroALetras(20)).toBe('veinte');
  });

  it('veintis y decenas compuestas', () => {
    expect(enteroALetras(21)).toBe('veintiuno');
    expect(enteroALetras(22)).toBe('veintidós');
    expect(enteroALetras(26)).toBe('veintiséis');
    expect(enteroALetras(35)).toBe('treinta y cinco');
    expect(enteroALetras(99)).toBe('noventa y nueve');
  });

  it('centenas: cien vs ciento, quinientos/setecientos/novecientos', () => {
    expect(enteroALetras(100)).toBe('cien');
    expect(enteroALetras(101)).toBe('ciento uno');
    expect(enteroALetras(555)).toBe('quinientos cincuenta y cinco');
    expect(enteroALetras(700)).toBe('setecientos');
    expect(enteroALetras(999)).toBe('novecientos noventa y nueve');
  });

  it('miles: nunca "un mil", apócope en el multiplicador', () => {
    expect(enteroALetras(1000)).toBe('mil');
    expect(enteroALetras(1200)).toBe('mil doscientos');
    expect(enteroALetras(2000)).toBe('dos mil');
    expect(enteroALetras(21000)).toBe('veintiún mil');
    expect(enteroALetras(31000)).toBe('treinta y un mil');
    expect(enteroALetras(101000)).toBe('ciento un mil');
    expect(enteroALetras(999999)).toBe('novecientos noventa y nueve mil novecientos noventa y nueve');
  });

  it('millones: un millón vs millones', () => {
    expect(enteroALetras(1000000)).toBe('un millón');
    expect(enteroALetras(2000000)).toBe('dos millones');
    expect(enteroALetras(1001000)).toBe('un millón mil');
    expect(enteroALetras(21500300)).toBe('veintiún millones quinientos mil trescientos');
  });

  it('apócope al final cuando se antepone a sustantivo', () => {
    expect(enteroALetras(1, true)).toBe('un');
    expect(enteroALetras(21, true)).toBe('veintiún');
    expect(enteroALetras(31, true)).toBe('treinta y un');
    expect(enteroALetras(101, true)).toBe('ciento un');
  });
});

describe('importeEnLetras — formato fiscal', () => {
  it('el ejemplo canónico', () => {
    expect(importeEnLetras(1200)).toBe('MIL DOSCIENTOS PESOS 00/100 M.N.');
  });

  it('singular con un peso y apócope', () => {
    expect(importeEnLetras(1)).toBe('UN PESO 00/100 M.N.');
    expect(importeEnLetras(21.5)).toBe('VEINTIÚN PESOS 50/100 M.N.');
  });

  it('centavos con padding y redondeo de flotantes', () => {
    expect(importeEnLetras(99.05)).toBe('NOVENTA Y NUEVE PESOS 05/100 M.N.');
    expect(importeEnLetras(0.1 + 0.2)).toBe('CERO PESOS 30/100 M.N.'); // 0.30000000000000004
    expect(importeEnLetras(10.999)).toBe('ONCE PESOS 00/100 M.N.');    // redondea a 11.00
  });

  it('cero, negativos y basura no truenan', () => {
    expect(importeEnLetras(0)).toBe('CERO PESOS 00/100 M.N.');
    expect(importeEnLetras(-50)).toBe('CINCUENTA PESOS 00/100 M.N.');
    expect(importeEnLetras(NaN)).toBe('CERO PESOS 00/100 M.N.');
    expect(importeEnLetras(undefined)).toBe('CERO PESOS 00/100 M.N.');
  });
});
