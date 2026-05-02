// cancelarOrden.test.js
// Tests para la lógica pura de cancelarOrden — sin Supabase.
// Cubre validateCancelacion + buildAnotacionCancelacion.
import { describe, it, expect } from 'vitest';
import { validateCancelacion, buildAnotacionCancelacion } from '../data/ordenLogic';

// ─── validateCancelacion ─────────────────────────────────────
describe('validateCancelacion', () => {
  const baseOk = {
    estatusActual: 'Creada',
    cxc: null,
    hayPagosDirectos: false,
    motivo: 'Cliente canceló pedido',
  };

  it('null cuando todo está OK (Creada, sin pagos, motivo no vacío)', () => {
    expect(validateCancelacion(baseOk)).toBeNull();
  });

  it('OK cuando estatus es Asignada (regresa stock vía RPC)', () => {
    expect(validateCancelacion({ ...baseOk, estatusActual: 'Asignada' })).toBeNull();
  });

  it('error si motivo está vacío', () => {
    const r = validateCancelacion({ ...baseOk, motivo: '' });
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si motivo es solo whitespace', () => {
    const r = validateCancelacion({ ...baseOk, motivo: '   \n\t  ' });
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si motivo es null/undefined', () => {
    expect(validateCancelacion({ ...baseOk, motivo: null })?.error).toMatch(/motivo/i);
    expect(validateCancelacion({ ...baseOk, motivo: undefined })?.error).toMatch(/motivo/i);
  });

  it('error si la orden ya está cancelada', () => {
    const r = validateCancelacion({ ...baseOk, estatusActual: 'Cancelada' });
    expect(r?.error).toMatch(/ya está cancelada/i);
  });

  it('error si la orden está Entregada', () => {
    const r = validateCancelacion({ ...baseOk, estatusActual: 'Entregada' });
    expect(r?.error).toMatch(/devolución/i);
  });

  it('error si la orden está Facturada', () => {
    const r = validateCancelacion({ ...baseOk, estatusActual: 'Facturada' });
    expect(r?.error).toMatch(/devolución/i);
  });

  it('error si la CxC tiene pagos parciales (monto_pagado > 0)', () => {
    const cxc = { id: 1, monto_original: 1000, monto_pagado: 200 };
    const r = validateCancelacion({ ...baseOk, cxc });
    expect(r?.error).toMatch(/pagos parciales/i);
  });

  it('OK si la CxC existe pero sin pagos (monto_pagado = 0)', () => {
    const cxc = { id: 1, monto_original: 1000, monto_pagado: 0 };
    expect(validateCancelacion({ ...baseOk, cxc })).toBeNull();
  });

  it('soporta CxC en camelCase (montoPagado)', () => {
    const cxc = { id: 1, montoPagado: 500 };
    const r = validateCancelacion({ ...baseOk, cxc });
    expect(r?.error).toMatch(/pagos parciales/i);
  });

  it('error si hay pagos directos sin CxC (venta contado pagada)', () => {
    const r = validateCancelacion({ ...baseOk, hayPagosDirectos: true });
    expect(r?.error).toMatch(/contado.*pagada|devolución/i);
  });

  it('OK si hay pagos directos PERO también hay CxC (no es contado)', () => {
    // Venta a crédito con anticipo: cxc.monto_pagado=0 + pagos=[anticipo].
    // No es bloqueable porque venta a crédito puede tener pagos sin parciales en CxC.
    // (Caso edge — la lógica no bloquea aquí porque cxc≠null.)
    const cxc = { id: 1, monto_pagado: 0 };
    expect(validateCancelacion({ ...baseOk, cxc, hayPagosDirectos: true })).toBeNull();
  });

  it('precedencia: estatus Cancelada gana sobre todo lo demás', () => {
    const cxc = { id: 1, monto_pagado: 500 };
    const r = validateCancelacion({
      estatusActual: 'Cancelada',
      cxc,
      hayPagosDirectos: true,
      motivo: 'X',
    });
    expect(r?.error).toMatch(/ya está cancelada/i);
  });

  it('precedencia: motivo vacío gana sobre estatus válido', () => {
    const r = validateCancelacion({
      estatusActual: 'Creada',
      cxc: null,
      hayPagosDirectos: false,
      motivo: '',
    });
    expect(r?.error).toMatch(/motivo/i);
  });
});

// ─── buildAnotacionCancelacion ──────────────────────────────
describe('buildAnotacionCancelacion', () => {
  it('construye payload con motivo trimeado, usuario y timestamp', () => {
    const fecha = new Date('2026-05-02T15:30:00Z');
    const r = buildAnotacionCancelacion('  Cliente canceló  ', 'Santiago', fecha);
    expect(r).toEqual({
      motivo_cancelacion: 'Cliente canceló',
      cancelada_at: '2026-05-02T15:30:00.000Z',
      cancelada_por: 'Santiago',
    });
  });

  it('default usuario = "Admin" si no se pasa', () => {
    const r = buildAnotacionCancelacion('motivo', null);
    expect(r.cancelada_por).toBe('Admin');
  });

  it('default usuario = "Admin" si pasa string vacío', () => {
    const r = buildAnotacionCancelacion('motivo', '');
    expect(r.cancelada_por).toBe('Admin');
  });

  it('motivo vacío se persiste como string vacío (UI debe validar antes)', () => {
    // Esta función NO valida — solo construye. La validación previa la hace
    // validateCancelacion. Acá solo nos aseguramos que no rompe.
    const r = buildAnotacionCancelacion('', 'Admin');
    expect(r.motivo_cancelacion).toBe('');
  });

  it('usa Date() actual si no se inyecta now', () => {
    const antes = Date.now();
    const r = buildAnotacionCancelacion('x', 'Admin');
    const despues = Date.now();
    const ts = new Date(r.cancelada_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(antes);
    expect(ts).toBeLessThanOrEqual(despues);
  });
});
