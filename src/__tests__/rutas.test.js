// rutas.test.js — flujo de cierre de ruta / chofer
import { describe, it, expect } from 'vitest';
import {
  formatDevolucion,
  validateDevolucion,
  totalDevuelto,
  normalizeDevolucion,
  calcTotalesCobro,
  validateConfirmarCarga,
  validateFirmarCarga,
  excedeAutorizacion,
  clasificarEntregas,
  agruparMermasPorSku,
} from '../data/rutasLogic';

// ─── formatDevolucion ─────────────────────────────────────────
describe('formatDevolucion', () => {
  it('formatea objeto con varios SKUs', () => {
    expect(formatDevolucion({ 'HC-5K': 10, 'HC-25K': 3 })).toBe('10×HC-5K, 3×HC-25K');
  });

  it('omite SKUs con cantidad 0', () => {
    expect(formatDevolucion({ 'HC-5K': 5, 'HC-25K': 0 })).toBe('5×HC-5K');
  });

  it('devuelve "0" cuando todo es 0', () => {
    expect(formatDevolucion({ 'HC-5K': 0, 'HC-25K': 0 })).toBe('0');
  });

  it('devuelve "0" para objeto vacío', () => {
    expect(formatDevolucion({})).toBe('0');
  });

  it('devuelve "0" para null', () => {
    expect(formatDevolucion(null)).toBe('0');
  });
});

// ─── validateDevolucion ───────────────────────────────────────
describe('validateDevolucion', () => {
  it('acepta objeto válido con cantidades positivas', () => {
    expect(validateDevolucion({ 'HC-5K': 5, 'HC-25K': 0 })).toBeNull();
  });

  it('acepta objeto vacío (sin devoluciones)', () => {
    expect(validateDevolucion({})).toBeNull();
  });

  it('error si la cantidad es negativa', () => {
    expect(validateDevolucion({ 'HC-5K': -1 })).toMatch(/inválida/i);
  });

  it('error si la cantidad no es número', () => {
    expect(validateDevolucion({ 'HC-5K': 'mucho' })).toMatch(/inválida/i);
  });

  it('error si el argumento no es objeto', () => {
    expect(validateDevolucion(null)).toMatch(/objeto/i);
    expect(validateDevolucion('devolucion')).toMatch(/objeto/i);
  });
});

// ─── totalDevuelto ────────────────────────────────────────────
describe('totalDevuelto', () => {
  it('suma todas las unidades devueltas', () => {
    expect(totalDevuelto({ 'HC-5K': 10, 'HC-25K': 5, 'BH-50K': 2 })).toBe(17);
  });

  it('devuelve 0 para objeto vacío', () => {
    expect(totalDevuelto({})).toBe(0);
  });

  it('devuelve 0 para null', () => {
    expect(totalDevuelto(null)).toBe(0);
  });

  it('ignora valores nulos o undefined en las cantidades', () => {
    expect(totalDevuelto({ 'HC-5K': 3, 'HC-25K': null })).toBe(3);
  });
});

// ─── normalizeDevolucion ──────────────────────────────────────
describe('normalizeDevolucion', () => {
  it('devuelve el objeto tal cual si ya es objeto', () => {
    const obj = { 'HC-5K': 5 };
    expect(normalizeDevolucion(obj)).toBe(obj);
  });

  it('convierte número legacy a objeto { bolsas: n }', () => {
    expect(normalizeDevolucion(12)).toEqual({ bolsas: 12 });
  });

  it('convierte 0 a { bolsas: 0 }', () => {
    expect(normalizeDevolucion(0)).toEqual({ bolsas: 0 });
  });

  it('maneja null → { bolsas: 0 }', () => {
    expect(normalizeDevolucion(null)).toEqual({ bolsas: 0 });
  });
});

// ─── calcTotalesCobro ─────────────────────────────────────────
describe('calcTotalesCobro', () => {
  const cobros = [
    { monto: 500,  metodo_pago: 'Efectivo' },
    { monto: 1200, metodo_pago: 'Transferencia SPEI' },
    { monto: 800,  metodo_pago: 'Efectivo' },
    { monto: 2000, metodo_pago: 'Crédito' },
  ];

  it('suma efectivo correctamente', () => {
    expect(calcTotalesCobro(cobros).totalEfectivo).toBe(1300);
  });

  it('suma transferencias correctamente', () => {
    expect(calcTotalesCobro(cobros).totalTransferencia).toBe(1200);
  });

  it('suma crédito correctamente', () => {
    expect(calcTotalesCobro(cobros).totalCredito).toBe(2000);
  });

  it('calcula total cobrado como suma de los tres', () => {
    expect(calcTotalesCobro(cobros).totalCobrado).toBe(4500);
  });

  it('devuelve todos en 0 para lista vacía', () => {
    const r = calcTotalesCobro([]);
    expect(r.totalEfectivo).toBe(0);
    expect(r.totalCobrado).toBe(0);
  });

  it('clasifica como efectivo si el método es desconocido', () => {
    const r = calcTotalesCobro([{ monto: 300, metodo_pago: 'QR' }]);
    expect(r.totalEfectivo).toBe(300);
  });

  it('maneja montos con decimales sin error de floating point', () => {
    const r = calcTotalesCobro([
      { monto: 333.33, metodo_pago: 'Efectivo' },
      { monto: 333.33, metodo_pago: 'Efectivo' },
      { monto: 333.34, metodo_pago: 'Efectivo' },
    ]);
    expect(r.totalEfectivo).toBe(1000);
  });
});

// ─── validateConfirmarCarga ────────────────────────────────────
describe('validateConfirmarCarga', () => {
  it('error si rutaId es falsy', () => {
    expect(validateConfirmarCarga(null, { 'HC-5K': 10 })).toEqual({ error: 'Datos de carga inválidos' });
    expect(validateConfirmarCarga(undefined, { 'HC-5K': 10 })).toEqual({ error: 'Datos de carga inválidos' });
    expect(validateConfirmarCarga(0, { 'HC-5K': 10 })).toEqual({ error: 'Datos de carga inválidos' });
  });

  it('error si cargaReal no es objeto', () => {
    expect(validateConfirmarCarga(1, null)).toEqual({ error: 'Datos de carga inválidos' });
    expect(validateConfirmarCarga(1, 'mucho')).toEqual({ error: 'Datos de carga inválidos' });
    expect(validateConfirmarCarga(1, 42)).toEqual({ error: 'Datos de carga inválidos' });
  });

  it('OK con rutaId numérico y cargaReal objeto válido', () => {
    expect(validateConfirmarCarga(1, { 'HC-5K': 10 })).toBeNull();
  });

  it('OK con rutaId string y cargaReal objeto vacío (refleja comportamiento actual)', () => {
    // El código original permite cargaReal {} — no se arregla aquí.
    expect(validateConfirmarCarga('uuid-abc', {})).toBeNull();
  });
});

// ─── validateFirmarCarga ───────────────────────────────────────
describe('validateFirmarCarga', () => {
  it('error si rutaId es falsy', () => {
    expect(validateFirmarCarga(null, 'data:image/png;base64,xxx')).toEqual({ error: 'Sin ruta' });
  });

  it('error si no hay firma ni excepcion', () => {
    expect(validateFirmarCarga(1, null)).toEqual({ error: 'Sin firma' });
    expect(validateFirmarCarga(1, '', {})).toEqual({ error: 'Sin firma' });
  });

  it('error si excepcion=true pero motivoExcepcion vacío', () => {
    expect(validateFirmarCarga(1, null, { excepcion: true, motivoExcepcion: '' })).toEqual({ error: 'Sin justificación' });
    expect(validateFirmarCarga(1, null, { excepcion: true, motivoExcepcion: '   ' })).toEqual({ error: 'Sin justificación' });
    expect(validateFirmarCarga(1, null, { excepcion: true })).toEqual({ error: 'Sin justificación' });
  });

  it('OK con motivoExcepcion no vacío y sin firma', () => {
    expect(validateFirmarCarga(1, null, { excepcion: true, motivoExcepcion: 'Producción ausente' })).toBeNull();
  });

  it('OK con firmaBase64 y sin opciones', () => {
    expect(validateFirmarCarga(1, 'data:image/png;base64,xxx')).toBeNull();
    expect(validateFirmarCarga('uuid', 'cualquier-string')).toBeNull(); // no valida formato data:image/
  });
});

// ─── excedeAutorizacion ────────────────────────────────────────
describe('excedeAutorizacion', () => {
  it('null si carga dentro de autorizada (sin extra)', () => {
    expect(excedeAutorizacion({ 'HC-5K': 10 }, { 'HC-5K': 20 }, {})).toBeNull();
  });

  it('null si carga dentro de autorizada + extra', () => {
    expect(excedeAutorizacion({ 'HC-5K': 25 }, { 'HC-5K': 20 }, { 'HC-5K': 10 })).toBeNull();
  });

  it('detecta exceso cuando supera autorizada (sin extra)', () => {
    expect(excedeAutorizacion({ 'HC-5K': 30 }, { 'HC-5K': 20 }, {})).toEqual({ sku: 'HC-5K', max: 20, qty: 30 });
  });

  it('detecta exceso cuando supera autorizada + extra', () => {
    expect(excedeAutorizacion({ 'HC-5K': 35 }, { 'HC-5K': 20 }, { 'HC-5K': 10 })).toEqual({ sku: 'HC-5K', max: 30, qty: 35 });
  });

  it('SKU no en autorizada se trata como max=0', () => {
    expect(excedeAutorizacion({ 'NUEVO': 1 }, { 'HC-5K': 20 }, {})).toEqual({ sku: 'NUEVO', max: 0, qty: 1 });
  });

  it('null si autorizada o extra son null/undefined', () => {
    expect(excedeAutorizacion({ 'HC-5K': 0 }, null, undefined)).toBeNull();
  });

  it('devuelve el primer SKU que exceda (early return)', () => {
    const r = excedeAutorizacion({ 'A': 1, 'B': 100, 'C': 1 }, { 'A': 5, 'B': 5, 'C': 5 }, {});
    expect(r.sku).toBe('B');
  });
});

// ─── clasificarEntregas ────────────────────────────────────────
describe('clasificarEntregas', () => {
  it('null → vacíos', () => {
    expect(clasificarEntregas(null)).toEqual({ conOrden: [], ventasExpress: [] });
    expect(clasificarEntregas(undefined)).toEqual({ conOrden: [], ventasExpress: [] });
  });

  it('array vacío → vacíos', () => {
    expect(clasificarEntregas([])).toEqual({ conOrden: [], ventasExpress: [] });
  });

  it('e.express === true → ventasExpress', () => {
    const e = { express: true, ordenId: 99, total: 100 };
    const r = clasificarEntregas([e]);
    expect(r.ventasExpress).toEqual([e]);
    expect(r.conOrden).toEqual([]);
  });

  it('e.ordenId falsy (varios casos) → ventasExpress', () => {
    const cases = [
      { ordenId: null, total: 100 },
      { ordenId: undefined, total: 100 },
      { ordenId: 0, total: 100 },
      { ordenId: '', total: 100 },
      { total: 100 }, // sin ordenId
    ];
    const r = clasificarEntregas(cases);
    expect(r.ventasExpress).toHaveLength(5);
    expect(r.conOrden).toHaveLength(0);
  });

  it('e.ordenId truthy y e.express falsy → conOrden', () => {
    const e = { ordenId: 42, total: 100 };
    const r = clasificarEntregas([e]);
    expect(r.conOrden).toEqual([e]);
    expect(r.ventasExpress).toEqual([]);
  });

  it('mezcla de tipos en mismo array', () => {
    const arr = [
      { ordenId: 1 },                 // conOrden
      { ordenId: 2, express: true },  // ventasExpress (express gana)
      { ordenId: null },              // ventasExpress
      { ordenId: 3 },                 // conOrden
      { express: true },              // ventasExpress
    ];
    const r = clasificarEntregas(arr);
    expect(r.conOrden).toHaveLength(2);
    expect(r.ventasExpress).toHaveLength(3);
    expect(r.conOrden.map(e => e.ordenId)).toEqual([1, 3]);
  });
});

// ─── agruparMermasPorSku ───────────────────────────────────────
describe('agruparMermasPorSku', () => {
  it('null o vacío → {}', () => {
    expect(agruparMermasPorSku(null)).toEqual({});
    expect(agruparMermasPorSku([])).toEqual({});
  });

  it('SKUs únicos → suma trivial', () => {
    const r = agruparMermasPorSku([
      { sku: 'HC-5K', cant: 3 },
      { sku: 'HC-25K', cant: 2 },
    ]);
    expect(r).toEqual({ 'HC-5K': 3, 'HC-25K': 2 });
  });

  it('mismo SKU en múltiples mermas → suma acumulada', () => {
    const r = agruparMermasPorSku([
      { sku: 'HC-5K', cant: 3 },
      { sku: 'HC-5K', cant: 2 },
      { sku: 'HC-5K', cant: 5 },
    ]);
    expect(r).toEqual({ 'HC-5K': 10 });
  });

  it('mermas sin sku se ignoran', () => {
    const r = agruparMermasPorSku([
      { sku: 'HC-5K', cant: 3 },
      { sku: '', cant: 100 },
      { cant: 50 },
      { sku: null, cant: 7 },
    ]);
    expect(r).toEqual({ 'HC-5K': 3 });
  });

  it('cant no numérico o falsy se trata como 0', () => {
    const r = agruparMermasPorSku([
      { sku: 'HC-5K', cant: 3 },
      { sku: 'HC-5K', cant: 'mucho' },
      { sku: 'HC-5K' }, // sin cant
      { sku: 'HC-5K', cant: null },
    ]);
    expect(r).toEqual({ 'HC-5K': 3 });
  });
});

