// transicionesOrden.test.js
// Tests para la máquina de estados de órdenes — sin Supabase.
// Cubre validateTransicionOrden + TRANSICIONES_ORDEN.
import { describe, it, expect } from 'vitest';
import { validateTransicionOrden, TRANSICIONES_ORDEN } from '../data/ordenLogic';

describe('validateTransicionOrden', () => {
  describe('transiciones legales', () => {
    it('Creada → Asignada', () => {
      expect(validateTransicionOrden('Creada', 'Asignada')).toBeNull();
    });

    it('Creada → Cancelada', () => {
      expect(validateTransicionOrden('Creada', 'Cancelada')).toBeNull();
    });

    it('Asignada → En ruta', () => {
      expect(validateTransicionOrden('Asignada', 'En ruta')).toBeNull();
    });

    it('Asignada → Entregada', () => {
      expect(validateTransicionOrden('Asignada', 'Entregada')).toBeNull();
    });

    it('Asignada → Cancelada', () => {
      expect(validateTransicionOrden('Asignada', 'Cancelada')).toBeNull();
    });

    it('En ruta → Entregada', () => {
      expect(validateTransicionOrden('En ruta', 'Entregada')).toBeNull();
    });

    it('En ruta → Cancelada', () => {
      expect(validateTransicionOrden('En ruta', 'Cancelada')).toBeNull();
    });

    it('Entregada → Facturada', () => {
      expect(validateTransicionOrden('Entregada', 'Facturada')).toBeNull();
    });
  });

  describe('transiciones ilegales (estados terminales)', () => {
    it('error: Facturada → Creada (terminal)', () => {
      const r = validateTransicionOrden('Facturada', 'Creada');
      expect(r?.error).toMatch(/Facturada.*Creada/);
    });

    it('error: Facturada → Cancelada (terminal)', () => {
      const r = validateTransicionOrden('Facturada', 'Cancelada');
      expect(r?.error).toMatch(/Facturada.*Cancelada/);
    });

    it('error: Cancelada → Entregada (terminal)', () => {
      const r = validateTransicionOrden('Cancelada', 'Entregada');
      expect(r?.error).toMatch(/Cancelada.*Entregada/);
    });

    it('error: Cancelada → Asignada (terminal)', () => {
      const r = validateTransicionOrden('Cancelada', 'Asignada');
      expect(r?.error).toMatch(/Cancelada.*Asignada/);
    });
  });

  describe('saltos no permitidos', () => {
    it('error: Creada → Entregada (debe pasar por Asignada)', () => {
      const r = validateTransicionOrden('Creada', 'Entregada');
      expect(r?.error).toMatch(/Creada.*Entregada/);
    });

    it('error: Creada → Facturada', () => {
      const r = validateTransicionOrden('Creada', 'Facturada');
      expect(r?.error).toMatch(/Creada.*Facturada/);
    });

    it('error: Asignada → Facturada (debe pasar por Entregada)', () => {
      const r = validateTransicionOrden('Asignada', 'Facturada');
      expect(r?.error).toMatch(/Asignada.*Facturada/);
    });

    it('error: Entregada → Asignada (no se va hacia atrás)', () => {
      const r = validateTransicionOrden('Entregada', 'Asignada');
      expect(r?.error).toMatch(/Entregada.*Asignada/);
    });
  });

  describe('idempotencia y casos borde', () => {
    it('null cuando estatus actual === nuevo (no-op)', () => {
      expect(validateTransicionOrden('Entregada', 'Entregada')).toBeNull();
      expect(validateTransicionOrden('Cancelada', 'Cancelada')).toBeNull();
    });

    it('error: estatus actual desconocido', () => {
      const r = validateTransicionOrden('Marciano', 'Entregada');
      expect(r?.error).toMatch(/desconocido/i);
    });

    it('trim de espacios en ambos parámetros', () => {
      expect(validateTransicionOrden('  Creada  ', '  Asignada  ')).toBeNull();
    });

    it('null/undefined estatus actual → error de desconocido', () => {
      expect(validateTransicionOrden(null, 'Asignada')?.error).toMatch(/desconocido/i);
      expect(validateTransicionOrden(undefined, 'Asignada')?.error).toMatch(/desconocido/i);
    });
  });

  describe('TRANSICIONES_ORDEN structure', () => {
    it('todos los estados están en el mapa', () => {
      const estados = ['Creada', 'Asignada', 'En ruta', 'Entregada', 'Facturada', 'Cancelada'];
      for (const e of estados) {
        expect(TRANSICIONES_ORDEN[e]).toBeDefined();
        expect(Array.isArray(TRANSICIONES_ORDEN[e])).toBe(true);
      }
    });

    it('Facturada y Cancelada son terminales (sin transiciones de salida)', () => {
      expect(TRANSICIONES_ORDEN.Facturada).toEqual([]);
      expect(TRANSICIONES_ORDEN.Cancelada).toEqual([]);
    });
  });
});
