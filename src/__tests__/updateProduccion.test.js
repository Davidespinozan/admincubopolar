// updateProduccion.test.js
// Tests para buildUpdateFieldsProduccion — sin Supabase.
// Cubre el shape del payload editable y bloqueo de SKU.
import { describe, it, expect } from 'vitest';
import { buildUpdateFieldsProduccion } from '../data/produccionLogic';

describe('buildUpdateFieldsProduccion', () => {
  describe('campos editables (whitelist)', () => {
    it('acepta turno, máquina, cantidad, estatus', () => {
      const out = buildUpdateFieldsProduccion({
        turno: 'Turno 2',
        maquina: 'Máquina 20',
        cantidad: '500',
        estatus: 'Confirmada',
      });
      expect(out).toEqual({
        turno: 'Turno 2',
        maquina: 'Máquina 20',
        cantidad: 500,
        estatus: 'Confirmada',
      });
    });

    it('cantidad se convierte a Number', () => {
      const out = buildUpdateFieldsProduccion({ cantidad: '750' });
      expect(out).toEqual({ cantidad: 750 });
      expect(typeof out.cantidad).toBe('number');
    });

    it('cantidad puede ser 0 si admin lo manda explícito (UI valida >0 aparte)', () => {
      const out = buildUpdateFieldsProduccion({ cantidad: '0' });
      expect(out).toEqual({ cantidad: 0 });
    });

    it('permite actualizar solo un campo', () => {
      const out = buildUpdateFieldsProduccion({ turno: 'Turno 3' });
      expect(out).toEqual({ turno: 'Turno 3' });
    });
  });

  describe('SKU bloqueado (no es metadato editable)', () => {
    it('SKU enviado en payload se ignora', () => {
      const out = buildUpdateFieldsProduccion({
        sku: 'HC-25K-NUEVO',
        turno: 'Turno 1',
      });
      expect(out).toEqual({ turno: 'Turno 1' });
      expect(out.sku).toBeUndefined();
    });

    it('si el payload solo trae sku, devuelve null (nada que actualizar)', () => {
      const out = buildUpdateFieldsProduccion({ sku: 'HC-5K' });
      expect(out).toBeNull();
    });
  });

  describe('campos no whitelisteados', () => {
    it('ignora campos arbitrarios (id, fecha, folio, costo, etc.)', () => {
      const out = buildUpdateFieldsProduccion({
        id: 999,
        fecha: '2026-05-01',
        folio: 'OP-EVIL',
        costo_total: 1000000,
        turno: 'Turno 2',
      });
      expect(out).toEqual({ turno: 'Turno 2' });
    });
  });

  describe('payload vacío o inválido', () => {
    it('devuelve null si el payload es {}', () => {
      expect(buildUpdateFieldsProduccion({})).toBeNull();
    });

    it('devuelve null si el payload es null', () => {
      expect(buildUpdateFieldsProduccion(null)).toBeNull();
    });

    it('devuelve null si el payload es undefined', () => {
      expect(buildUpdateFieldsProduccion(undefined)).toBeNull();
    });

    it('devuelve null si el payload no es objeto (string, number, etc.)', () => {
      expect(buildUpdateFieldsProduccion('foo')).toBeNull();
      expect(buildUpdateFieldsProduccion(123)).toBeNull();
    });

    it('devuelve null si todos los campos son undefined', () => {
      const out = buildUpdateFieldsProduccion({
        turno: undefined,
        maquina: undefined,
        cantidad: undefined,
      });
      expect(out).toBeNull();
    });
  });

  describe('manejo de undefined vs falsy', () => {
    it('acepta estatus = "" (string vacío) si el caller lo manda', () => {
      const out = buildUpdateFieldsProduccion({ estatus: '' });
      expect(out).toEqual({ estatus: '' });
    });

    it('ignora explícitamente undefined pero no null', () => {
      const out = buildUpdateFieldsProduccion({
        turno: 'Turno 1',
        maquina: undefined,
        estatus: null,
      });
      expect(out).toEqual({ turno: 'Turno 1', estatus: null });
    });
  });
});
