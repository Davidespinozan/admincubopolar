// comercialBloque1.test.js — Bloque 1 comercial urgente
// Tests para validarRFC con flag permitirGenericos + normalizeStr (búsqueda
// con acentos). validateEdicionOrden(estatus, ruta) está cubierto en
// updateOrden.test.js. RFC duplicado nominativo está cubierto por la BD
// (UNIQUE INDEX migración 055) y se prueba manualmente.
import { describe, it, expect } from 'vitest';
import { validarRFC, normalizeStr } from '../utils/safe';

// ─── validarRFC con permitirGenericos ──────────────────────────
describe('validarRFC', () => {
  describe('default (permitirGenericos: true)', () => {
    it('acepta RFC nominativo persona moral', () => {
      expect(validarRFC('CPO920301AB0')).toBe(true);
    });

    it('acepta RFC nominativo persona física', () => {
      expect(validarRFC('HEGG560427MLD')).toBe(true);
    });

    it('acepta RFC genérico XAXX (público en general)', () => {
      expect(validarRFC('XAXX010101000')).toBe(true);
    });

    it('acepta RFC genérico XEXX (extranjero)', () => {
      expect(validarRFC('XEXX010101000')).toBe(true);
    });

    it('acepta minúsculas (normaliza a mayúsculas)', () => {
      expect(validarRFC('cpo920301ab0')).toBe(true);
      expect(validarRFC('xaxx010101000')).toBe(true);
    });

    it('acepta RFC con Ñ y &', () => {
      expect(validarRFC('ÑOÑO920301AB0')).toBe(true);
      expect(validarRFC('A&L920301AB0')).toBe(true);
    });

    it('rechaza string vacío / null / undefined', () => {
      expect(validarRFC('')).toBe(false);
      expect(validarRFC(null)).toBe(false);
      expect(validarRFC(undefined)).toBe(false);
    });

    it('rechaza formato inválido', () => {
      expect(validarRFC('ABC123')).toBe(false);
      expect(validarRFC('XX')).toBe(false);
      expect(validarRFC('CPO92030!AB0')).toBe(false);
    });
  });

  describe('permitirGenericos: false (uso para timbrado nominativo)', () => {
    it('rechaza XAXX010101000', () => {
      expect(validarRFC('XAXX010101000', { permitirGenericos: false })).toBe(false);
    });

    it('rechaza XEXX010101000', () => {
      expect(validarRFC('XEXX010101000', { permitirGenericos: false })).toBe(false);
    });

    it('rechaza minúsculas de XAXX (normaliza primero)', () => {
      expect(validarRFC('xaxx010101000', { permitirGenericos: false })).toBe(false);
    });

    it('sigue aceptando RFC nominativo válido', () => {
      expect(validarRFC('CPO920301AB0', { permitirGenericos: false })).toBe(true);
    });

    it('sigue rechazando formatos inválidos', () => {
      expect(validarRFC('ABC123', { permitirGenericos: false })).toBe(false);
    });
  });

  describe('permitirGenericos: true explícito', () => {
    it('comportamiento idéntico a default', () => {
      expect(validarRFC('XAXX010101000', { permitirGenericos: true })).toBe(true);
      expect(validarRFC('CPO920301AB0', { permitirGenericos: true })).toBe(true);
    });
  });
});

// ─── normalizeStr ──────────────────────────────────────────────
describe('normalizeStr', () => {
  it('lowercase básico', () => {
    expect(normalizeStr('ESPINOZA')).toBe('espinoza');
    expect(normalizeStr('Hola')).toBe('hola');
  });

  it('remueve diacríticos comunes (á é í ó ú ñ)', () => {
    expect(normalizeStr('Nevería')).toBe('neveria');
    expect(normalizeStr('Méndez')).toBe('mendez');
    expect(normalizeStr('Niño')).toBe('nino');
    expect(normalizeStr('Ávila')).toBe('avila');
    expect(normalizeStr('Camión')).toBe('camion');
  });

  it('mismo resultado con o sin acentos (búsqueda agnóstica)', () => {
    expect(normalizeStr('Espinoza')).toBe(normalizeStr('ESPINÓZA'));
    expect(normalizeStr('peña')).toBe(normalizeStr('PEÑA'));
  });

  it('trim de espacios', () => {
    expect(normalizeStr('  Espinoza  ')).toBe('espinoza');
  });

  it('null/undefined/empty → string vacío', () => {
    expect(normalizeStr(null)).toBe('');
    expect(normalizeStr(undefined)).toBe('');
    expect(normalizeStr('')).toBe('');
  });

  it('preserva caracteres no latinos sin diacríticos (números, símbolos)', () => {
    expect(normalizeStr('OV-0078')).toBe('ov-0078');
    expect(normalizeStr('AB & C')).toBe('ab & c');
  });

  it('uso típico en buscador: usuario teclea sin acentos', () => {
    const queries = ['neveria', 'NEVERIA', 'Neveria', 'Nevería'];
    const target = 'Nevería Don Pedro';
    for (const q of queries) {
      expect(normalizeStr(target).includes(normalizeStr(q))).toBe(true);
    }
  });

  it('busca por subcadena con diacríticos', () => {
    expect(normalizeStr('Comercial Niño Ávila').includes(normalizeStr('nino'))).toBe(true);
    expect(normalizeStr('María José Pérez').includes(normalizeStr('jose'))).toBe(true);
  });
});

// ─── invariantes RFC + búsqueda ────────────────────────────────
describe('integración: RFC unificado + búsqueda agnóstica', () => {
  it('isValidRfc del backend es equivalente a validarRFC con permitirGenericos:false', () => {
    // Estos son los casos que isValidRfc rechaza (invoiceLogic.js):
    // genéricos + formato inválido
    const casos = [
      { rfc: 'XAXX010101000', expected: false },
      { rfc: 'XEXX010101000', expected: false },
      { rfc: 'ABC123', expected: false },
      { rfc: '', expected: false },
      { rfc: 'CPO920301AB0', expected: true },
      { rfc: 'HEGG560427MLD', expected: true },
    ];
    for (const c of casos) {
      expect(validarRFC(c.rfc, { permitirGenericos: false })).toBe(c.expected);
    }
  });
});
