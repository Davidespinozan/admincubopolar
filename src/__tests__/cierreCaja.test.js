// cierreCaja.test.js
// Tests para clasificarMetodo + calcularEsperadoPorRuta + buildPagosSnapshot
// + validateCierre + calcDiferencia + buildCierrePayload + formatDiferencia +
// fechaCierreDesdeRuta. Lógica pura sin Supabase.
import { describe, it, expect } from 'vitest';
import {
  clasificarMetodo,
  calcularEsperadoPorRuta,
  buildPagosSnapshot,
  validateCierre,
  calcDiferencia,
  buildCierrePayload,
  formatDiferencia,
  fechaCierreDesdeRuta,
} from '../data/cierreCajaLogic';

// ─── clasificarMetodo ─────────────────────────────────────────
describe('clasificarMetodo', () => {
  it('Efectivo → efectivo', () => {
    expect(clasificarMetodo('Efectivo')).toBe('efectivo');
  });

  it('Crédito (con acento) → credito', () => {
    expect(clasificarMetodo('Crédito')).toBe('credito');
  });

  it('credito (sin acento) → credito', () => {
    expect(clasificarMetodo('credito')).toBe('credito');
  });

  it('fiado → credito', () => {
    expect(clasificarMetodo('fiado')).toBe('credito');
  });

  it('Transferencia → transferencia', () => {
    expect(clasificarMetodo('Transferencia')).toBe('transferencia');
  });

  it('Tarjeta → transferencia (agrupado)', () => {
    expect(clasificarMetodo('Tarjeta')).toBe('transferencia');
  });

  it('"QR / Link de pago" → transferencia (agrupado)', () => {
    expect(clasificarMetodo('QR / Link de pago')).toBe('transferencia');
  });

  it('método desconocido → transferencia (default conservador)', () => {
    expect(clasificarMetodo('Bitcoin')).toBe('transferencia');
  });

  it('vacío/null → transferencia (default)', () => {
    expect(clasificarMetodo('')).toBe('transferencia');
    expect(clasificarMetodo(null)).toBe('transferencia');
    expect(clasificarMetodo(undefined)).toBe('transferencia');
  });
});

// ─── calcularEsperadoPorRuta ──────────────────────────────────
describe('calcularEsperadoPorRuta', () => {
  it('agrupa correctamente los 3 cubos', () => {
    const pagos = [
      { monto: 100, metodo_pago: 'Efectivo' },
      { monto: 50, metodo_pago: 'Transferencia' },
      { monto: 30, metodo_pago: 'Tarjeta' },
      { monto: 20, metodo_pago: 'QR / Link de pago' },
      { monto: 200, metodo_pago: 'Crédito' },
    ];
    const r = calcularEsperadoPorRuta(pagos);
    expect(r.efectivo).toBe(100);
    expect(r.transferencia).toBe(100); // 50 + 30 + 20
    expect(r.credito).toBe(200);
    expect(r.total).toBe(400);
  });

  it('acepta camelCase metodoPago también', () => {
    const r = calcularEsperadoPorRuta([{ monto: 50, metodoPago: 'Efectivo' }]);
    expect(r.efectivo).toBe(50);
  });

  it('ignora pagos con monto <= 0', () => {
    const r = calcularEsperadoPorRuta([
      { monto: 0, metodo_pago: 'Efectivo' },
      { monto: -10, metodo_pago: 'Efectivo' },
      { monto: 50, metodo_pago: 'Efectivo' },
    ]);
    expect(r.efectivo).toBe(50);
  });

  it('ignora pagos con monto NaN', () => {
    const r = calcularEsperadoPorRuta([
      { monto: 'abc', metodo_pago: 'Efectivo' },
      { monto: 50, metodo_pago: 'Efectivo' },
    ]);
    expect(r.efectivo).toBe(50);
  });

  it('lista vacía → 0 en todos los cubos', () => {
    expect(calcularEsperadoPorRuta([])).toEqual({ efectivo: 0, transferencia: 0, credito: 0, total: 0 });
  });

  it('null/undefined → 0 en todos los cubos', () => {
    expect(calcularEsperadoPorRuta(null)).toEqual({ efectivo: 0, transferencia: 0, credito: 0, total: 0 });
    expect(calcularEsperadoPorRuta(undefined)).toEqual({ efectivo: 0, transferencia: 0, credito: 0, total: 0 });
  });

  it('redondeo a centavos', () => {
    const r = calcularEsperadoPorRuta([
      { monto: 33.333333, metodo_pago: 'Efectivo' },
      { monto: 33.333333, metodo_pago: 'Efectivo' },
      { monto: 33.333333, metodo_pago: 'Efectivo' },
    ]);
    expect(r.efectivo).toBe(100); // 99.999999 → 100
  });
});

// ─── buildPagosSnapshot ───────────────────────────────────────
describe('buildPagosSnapshot', () => {
  it('shape correcto incluyendo orden_folio', () => {
    const pagos = [
      { id: 1, monto: 100, metodo_pago: 'Efectivo', orden_id: 5, fecha: '2026-05-01' },
    ];
    const folios = { '5': 'OV-100' };
    const snap = buildPagosSnapshot(pagos, folios);
    expect(snap).toEqual([{
      pago_id: 1,
      monto: 100,
      metodo: 'Efectivo',
      orden_id: 5,
      orden_folio: 'OV-100',
      fecha: '2026-05-01',
    }]);
  });

  it('orden_folio es null si no hay match', () => {
    const snap = buildPagosSnapshot([{ id: 1, monto: 100, metodo_pago: 'Efectivo', orden_id: 99 }], {});
    expect(snap[0].orden_folio).toBeNull();
  });

  it('lista null/undefined → []', () => {
    expect(buildPagosSnapshot(null)).toEqual([]);
    expect(buildPagosSnapshot(undefined)).toEqual([]);
  });
});

// ─── validateCierre ───────────────────────────────────────────
describe('validateCierre', () => {
  const esp = { efectivo: 500, transferencia: 200 }; // esperado total = 700

  it('null cuando contado === esperado (cuadrado, sin motivo)', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: 500, transferencia: 200 }, motivoDiferencia: '' });
    expect(r).toBeNull();
  });

  it('error si efectivo contado negativo', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: -10, transferencia: 200 }, motivoDiferencia: '' });
    expect(r?.error).toMatch(/Efectivo/);
  });

  it('error si transferencia contada negativa', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: 500, transferencia: -5 }, motivoDiferencia: '' });
    expect(r?.error).toMatch(/Transferencia/);
  });

  it('error si hay diferencia y motivo vacío', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: 450, transferencia: 200 }, motivoDiferencia: '' });
    expect(r?.error).toMatch(/Motivo requerido/);
  });

  it('null si hay diferencia y motivo está', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: 450, transferencia: 200 }, motivoDiferencia: 'falta cambio' });
    expect(r).toBeNull();
  });

  it('error si diferencia > 100 con motivo corto (<10 chars)', () => {
    // diferencia = 700 - 500 = 200 (faltante)
    const r = validateCierre({ esperado: esp, contado: { efectivo: 300, transferencia: 200 }, motivoDiferencia: 'corto' });
    expect(r?.error).toMatch(/al menos 10 caracteres/);
  });

  it('null si diferencia > 100 con motivo de 10+ chars', () => {
    const r = validateCierre({ esperado: esp, contado: { efectivo: 300, transferencia: 200 }, motivoDiferencia: 'Cambio mal entregado a cliente' });
    expect(r).toBeNull();
  });

  it('error si diferencia exactamente -100 con motivo corto pasa (límite estricto >100)', () => {
    // diferencia = 600 - 700 = -100 → abs = 100 (no > 100)
    const r = validateCierre({ esperado: esp, contado: { efectivo: 400, transferencia: 200 }, motivoDiferencia: 'cambio' });
    expect(r).toBeNull(); // motivo corto OK porque la diferencia no rebasa 100
  });

  it('error si diferencia 101 con motivo corto', () => {
    // esperado 700, contado 599 → diff = -101
    const r = validateCierre({ esperado: esp, contado: { efectivo: 399, transferencia: 200 }, motivoDiferencia: 'corto' });
    expect(r?.error).toMatch(/al menos 10 caracteres/);
  });

  it('motivo se trimea para validación de longitud', () => {
    // diferencia 200, motivo "   abc   " → trim "abc" (3 chars) < 10
    const r = validateCierre({ esperado: esp, contado: { efectivo: 300, transferencia: 200 }, motivoDiferencia: '   abc   ' });
    expect(r?.error).toMatch(/al menos 10 caracteres/);
  });

  it('contado === 0 cuando esperado === 0 (sin pagos) → cuadrado', () => {
    const r = validateCierre({
      esperado: { efectivo: 0, transferencia: 0 },
      contado: { efectivo: 0, transferencia: 0 },
      motivoDiferencia: '',
    });
    expect(r).toBeNull();
  });
});

// ─── calcDiferencia ───────────────────────────────────────────
describe('calcDiferencia', () => {
  it('cuadrado → 0', () => {
    expect(calcDiferencia({ efectivo: 500, transferencia: 100 }, { efectivo: 500, transferencia: 100 })).toBe(0);
  });

  it('sobrante → positivo', () => {
    expect(calcDiferencia({ efectivo: 500, transferencia: 100 }, { efectivo: 600, transferencia: 100 })).toBe(100);
  });

  it('faltante → negativo', () => {
    expect(calcDiferencia({ efectivo: 500, transferencia: 100 }, { efectivo: 450, transferencia: 100 })).toBe(-50);
  });

  it('NO suma esperado.credito (crédito no entra en contado)', () => {
    const r = calcDiferencia({ efectivo: 500, transferencia: 100, credito: 1000 }, { efectivo: 500, transferencia: 100 });
    expect(r).toBe(0);
  });

  it('redondeo a centavos', () => {
    const r = calcDiferencia({ efectivo: 100.5, transferencia: 0 }, { efectivo: 100.50, transferencia: 0 });
    expect(r).toBe(0);
  });
});

// ─── buildCierrePayload ───────────────────────────────────────
describe('buildCierrePayload', () => {
  const base = {
    ruta: { id: 42, chofer_id: 7 },
    fechaCierre: '2026-05-01',
    esperado: { efectivo: 500, transferencia: 200, credito: 100, total: 800 },
    contado: { efectivo: 500, transferencia: 200 },
    motivoDiferencia: '',
    notas: '',
    usuario: 'Santiago',
    pagosSnapshot: [{ pago_id: 1, monto: 500 }],
  };

  it('shape correcto cuando cuadrado', () => {
    const p = buildCierrePayload(base);
    expect(p).toEqual({
      fecha: '2026-05-01',
      ruta_id: 42,
      chofer_id: 7,
      esperado_efectivo: 500,
      esperado_transferencia: 200,
      esperado_credito: 100,
      esperado_total: 800,
      contado_efectivo: 500,
      contado_transferencia: 200,
      contado_total: 700,
      diferencia: 0,
      motivo_diferencia: null,
      cerrado_por: 'Santiago',
      notas: null,
      pagos_snapshot: [{ pago_id: 1, monto: 500 }],
    });
  });

  it('diferencia se calcula automáticamente (sobrante)', () => {
    const p = buildCierrePayload({ ...base, contado: { efectivo: 600, transferencia: 200 } });
    expect(p.diferencia).toBe(100);
    expect(p.contado_total).toBe(800);
  });

  it('diferencia se calcula automáticamente (faltante)', () => {
    const p = buildCierrePayload({ ...base, contado: { efectivo: 450, transferencia: 200 } });
    expect(p.diferencia).toBe(-50);
  });

  it('motivo y notas se trimean; vacíos → null', () => {
    const p1 = buildCierrePayload({ ...base, motivoDiferencia: '  Faltante en cambio  ', notas: '' });
    expect(p1.motivo_diferencia).toBe('Faltante en cambio');
    expect(p1.notas).toBeNull();
  });

  it('default usuario "Admin" si vacío', () => {
    const p = buildCierrePayload({ ...base, usuario: null });
    expect(p.cerrado_por).toBe('Admin');
  });

  it('chofer_id acepta camelCase también', () => {
    const p = buildCierrePayload({ ...base, ruta: { id: 1, choferId: 9 } });
    expect(p.chofer_id).toBe(9);
  });

  it('pagos_snapshot vacío si no es array', () => {
    const p = buildCierrePayload({ ...base, pagosSnapshot: null });
    expect(p.pagos_snapshot).toEqual([]);
  });
});

// ─── formatDiferencia ─────────────────────────────────────────
describe('formatDiferencia', () => {
  it('0 → Cuadrado verde', () => {
    expect(formatDiferencia(0)).toEqual({ label: 'Cuadrado', color: 'verde', signo: '' });
  });

  it('positivo → Sobrante azul', () => {
    const r = formatDiferencia(150);
    expect(r.color).toBe('azul');
    expect(r.label).toMatch(/Sobrante/);
    expect(r.signo).toBe('+');
  });

  it('negativo → Faltante rojo (sin signo en el label)', () => {
    const r = formatDiferencia(-75);
    expect(r.color).toBe('rojo');
    expect(r.label).toMatch(/Faltante \$75/);
    expect(r.signo).toBe('-');
  });

  it('valor null/undefined → Cuadrado', () => {
    expect(formatDiferencia(null)).toEqual({ label: 'Cuadrado', color: 'verde', signo: '' });
    expect(formatDiferencia(undefined)).toEqual({ label: 'Cuadrado', color: 'verde', signo: '' });
  });
});

// ─── fechaCierreDesdeRuta ─────────────────────────────────────
describe('fechaCierreDesdeRuta', () => {
  it('prefiere fecha_fin (snake)', () => {
    const r = fechaCierreDesdeRuta({ fecha_fin: '2026-05-15T18:30:00Z', created_at: '2026-05-10T08:00:00Z' });
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('prefiere fechaFin (camel)', () => {
    const r = fechaCierreDesdeRuta({ fechaFin: '2026-04-20T10:00:00Z' });
    expect(r).toMatch(/^2026-04-20$/);
  });

  it('fallback a created_at si no hay fecha_fin', () => {
    const r = fechaCierreDesdeRuta({ created_at: '2026-03-15T12:00:00Z' });
    expect(r).toMatch(/^2026-03-15$/);
  });

  it('fallback a hoy local si no hay nada', () => {
    const r = fechaCierreDesdeRuta({});
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formato YYYY-MM-DD siempre', () => {
    const r = fechaCierreDesdeRuta({ fecha_fin: '2026-01-05' });
    expect(r).toBe('2026-01-05');
  });
});
