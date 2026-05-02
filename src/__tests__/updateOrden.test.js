// updateOrden.test.js
// Tests para la lógica pura de updateOrden — sin Supabase.
// Cubre validateEdicionOrden + parseLineasEdicion + buildUpdateFieldsOrden.
import { describe, it, expect } from 'vitest';
import { validateEdicionOrden, parseLineasEdicion, buildUpdateFieldsOrden } from '../data/ordenLogic';

// ─── validateEdicionOrden ────────────────────────────────────
describe('validateEdicionOrden', () => {
  it('null cuando estatus es Creada', () => {
    expect(validateEdicionOrden('Creada')).toBeNull();
  });

  it('error cuando estatus es Asignada', () => {
    const r = validateEdicionOrden('Asignada');
    expect(r?.error).toMatch(/Creada/);
  });

  it('error cuando estatus es Entregada', () => {
    const r = validateEdicionOrden('Entregada');
    expect(r?.error).toMatch(/Creada/);
  });

  it('error cuando estatus es Facturada', () => {
    const r = validateEdicionOrden('Facturada');
    expect(r?.error).toMatch(/Creada/);
  });

  it('error cuando estatus es Cancelada', () => {
    const r = validateEdicionOrden('Cancelada');
    expect(r?.error).toMatch(/Creada/);
  });

  it('error cuando estatus es null/undefined/string vacío', () => {
    expect(validateEdicionOrden(null)?.error).toBeTruthy();
    expect(validateEdicionOrden(undefined)?.error).toBeTruthy();
    expect(validateEdicionOrden('')?.error).toBeTruthy();
  });

  it('trim del estatus no afecta validación', () => {
    expect(validateEdicionOrden('  Creada  ')).toBeNull();
  });
});

// ─── parseLineasEdicion ──────────────────────────────────────
describe('parseLineasEdicion', () => {
  it('parsea líneas válidas con qty', () => {
    const r = parseLineasEdicion([
      { sku: 'HC-25K', qty: 10 },
      { sku: 'HC-5K', qty: 5 },
    ]);
    expect(r).toEqual([
      { qty: 10, sku: 'HC-25K' },
      { qty: 5, sku: 'HC-5K' },
    ]);
  });

  it('acepta cantidad como alternativa a qty', () => {
    const r = parseLineasEdicion([{ sku: 'HC-25K', cantidad: 8 }]);
    expect(r).toEqual([{ qty: 8, sku: 'HC-25K' }]);
  });

  it('filtra líneas sin sku', () => {
    const r = parseLineasEdicion([
      { sku: 'HC-25K', qty: 10 },
      { sku: '', qty: 5 },
      { qty: 5 },
    ]);
    expect(r).toHaveLength(1);
  });

  it('filtra líneas con qty <= 0', () => {
    const r = parseLineasEdicion([
      { sku: 'HC-25K', qty: 10 },
      { sku: 'HC-5K', qty: 0 },
      { sku: 'BH-50K', qty: -3 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('HC-25K');
  });

  it('coerce strings numéricos a number', () => {
    const r = parseLineasEdicion([{ sku: 'HC-25K', qty: '10' }]);
    expect(r[0].qty).toBe(10);
    expect(typeof r[0].qty).toBe('number');
  });

  it('devuelve [] para input null/undefined', () => {
    expect(parseLineasEdicion(null)).toEqual([]);
    expect(parseLineasEdicion(undefined)).toEqual([]);
  });

  it('devuelve [] para input no-array', () => {
    expect(parseLineasEdicion('texto')).toEqual([]);
    expect(parseLineasEdicion({})).toEqual([]);
    expect(parseLineasEdicion(42)).toEqual([]);
  });

  it('skipea elementos null o undefined dentro del array', () => {
    const r = parseLineasEdicion([
      { sku: 'HC-25K', qty: 10 },
      null,
      undefined,
      { sku: 'HC-5K', qty: 5 },
    ]);
    expect(r).toHaveLength(2);
  });

  it('coerce sku a string', () => {
    const r = parseLineasEdicion([{ sku: 12345, qty: 1 }]);
    expect(r[0].sku).toBe('12345');
    expect(typeof r[0].sku).toBe('string');
  });
});

// ─── buildUpdateFieldsOrden ─────────────────────────────────
describe('buildUpdateFieldsOrden', () => {
  it('mapea camelCase del UI a snake_case de BD', () => {
    const r = buildUpdateFieldsOrden({
      cliente: 'Acme S.A.',
      clienteId: 7,
      fecha: '2026-05-15',
      tipoCobro: 'Credito',
      folioNota: 'N-0042',
    });
    expect(r).toEqual({
      cliente_nombre: 'Acme S.A.',
      cliente_id: 7,
      fecha: '2026-05-15',
      tipo_cobro: 'Credito',
      folio_nota: 'N-0042',
    });
  });

  it('NO setea campos que NO vinieron en payload', () => {
    const r = buildUpdateFieldsOrden({ cliente: 'Acme' });
    expect(Object.keys(r)).toEqual(['cliente_nombre']);
    // Sin fecha, sin tipoCobro, etc.
    expect('fecha' in r).toBe(false);
    expect('tipo_cobro' in r).toBe(false);
  });

  it('mapea dirección de entrega completa', () => {
    const r = buildUpdateFieldsOrden({
      direccionEntrega: 'Av. Revolución 123',
      referenciaEntrega: 'Casa azul',
      latitudEntrega: 24.0277,
      longitudEntrega: -107.5089,
    });
    expect(r).toEqual({
      direccion_entrega: 'Av. Revolución 123',
      referencia_entrega: 'Casa azul',
      latitud_entrega: 24.0277,
      longitud_entrega: -107.5089,
    });
  });

  it('strings vacíos en optionales se persisten como null', () => {
    const r = buildUpdateFieldsOrden({
      folioNota: '',
      direccionEntrega: '',
      referenciaEntrega: '',
    });
    expect(r.folio_nota).toBeNull();
    expect(r.direccion_entrega).toBeNull();
    expect(r.referencia_entrega).toBeNull();
  });

  it('clienteId 0/null/undefined se persisten como null', () => {
    expect(buildUpdateFieldsOrden({ clienteId: null }).cliente_id).toBeNull();
    expect(buildUpdateFieldsOrden({ clienteId: 0 }).cliente_id).toBeNull();
    // No incluido si es undefined
    expect('cliente_id' in buildUpdateFieldsOrden({})).toBe(false);
  });

  it('lat/lng usa ?? null (acepta 0 como válido)', () => {
    const r = buildUpdateFieldsOrden({ latitudEntrega: 0, longitudEntrega: 0 });
    expect(r.latitud_entrega).toBe(0);
    expect(r.longitud_entrega).toBe(0);
  });

  it('lat/lng undefined o null se persisten como null', () => {
    expect(buildUpdateFieldsOrden({ latitudEntrega: null }).latitud_entrega).toBeNull();
  });

  it('agrega total + productos string cuando vienen líneas nuevas', () => {
    const lineas = [
      { sku: 'HC-25K', cantidad: 10 },
      { sku: 'HC-5K', cantidad: 3 },
    ];
    const r = buildUpdateFieldsOrden({ cliente: 'Acme' }, lineas, 1500);
    expect(r.cliente_nombre).toBe('Acme');
    expect(r.total).toBe(1500);
    expect(r.productos).toBe('10×HC-25K, 3×HC-5K');
  });

  it('NO agrega total/productos si lineasNuevas es null o []', () => {
    expect('total' in buildUpdateFieldsOrden({ cliente: 'Acme' })).toBe(false);
    expect('total' in buildUpdateFieldsOrden({ cliente: 'Acme' }, null, 100)).toBe(false);
    expect('total' in buildUpdateFieldsOrden({ cliente: 'Acme' }, [], 100)).toBe(false);
  });

  it('total se coerciona a number', () => {
    const lineas = [{ sku: 'X', cantidad: 1 }];
    const r = buildUpdateFieldsOrden({ cliente: 'Acme' }, lineas, '500');
    expect(r.total).toBe(500);
    expect(typeof r.total).toBe('number');
  });

  it('payload vacío produce objeto vacío', () => {
    expect(buildUpdateFieldsOrden({})).toEqual({});
  });
});
