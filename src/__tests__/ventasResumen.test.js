// ventasResumen.test.js — B3.4: contexto propio de cada módulo de Ventas,
// derivado SOLO de las órdenes ya cargadas. Estatus persistidos tal cual:
// 'Creada' = por cobrar directo, 'Asignada' = en ruta por cobrar.
import { describe, it, expect } from 'vitest';
import { esOrdenDelDia, resumenPorCobrar, resumenVentasHoy, resumenHistorial, textoDesglose, ESTATUS_DIRECTO, ESTATUS_EN_RUTA } from '../data/ventasResumenLogic';
import { TRANSICIONES_ORDEN } from '../data/ordenLogic';
import { n } from '../utils/safe';

const HOY = '2026-10-05';
const o = (id, estatus, total, fecha = HOY, extra = {}) => ({ id, folio: `OV-${String(id).padStart(4, '0')}`, cliente: `Cliente ${id}`, estatus, total, fecha, ...extra });

describe('esOrdenDelDia: misma regla que la vista', () => {
  it('fecha DATE o ISO del día de negocio; rechaza otro día, sin fecha u orden nula', () => {
    expect(esOrdenDelDia(o(1, 'Creada', 1), HOY)).toBe(true);
    expect(esOrdenDelDia(o(1, 'Creada', 1, '2026-10-05T23:00:00Z'), HOY)).toBe(true);
    expect(esOrdenDelDia(o(1, 'Creada', 1, '2026-10-04'), HOY)).toBe(false);
    expect(esOrdenDelDia(o(1, 'Creada', 1, ''), HOY)).toBe(false);
    expect(esOrdenDelDia(null, HOY)).toBe(false);
  });
});

describe('resumenPorCobrar: Creada y Asignada separados', () => {
  it('constantes = estatus persistidos existentes en el ciclo de vida', () => {
    expect(ESTATUS_DIRECTO).toBe('Creada');
    expect(ESTATUS_EN_RUTA).toBe('Asignada');
    expect(Object.keys(TRANSICIONES_ORDEN)).toEqual(expect.arrayContaining(['Creada', 'Asignada']));
  });
  it('ambos grupos: conteo y Σ total por grupo; otros estatus fuera', () => {
    const ords = [o(1, 'Creada', 100), o(2, 'Creada', '250.5'), o(3, 'Asignada', 400), o(4, 'Entregada', 999), o(5, 'En ruta', 50), o(6, 'Cancelada', 70), o(7, 'Facturada', 80)];
    const r = resumenPorCobrar(ords);
    expect(r.directo.count).toBe(2);
    expect(r.directo.monto).toBeCloseTo(350.5, 6);
    expect(r.directo.ordenes.map(x => x.id)).toEqual([1, 2]);
    expect(r.enRuta.count).toBe(1);
    expect(r.enRuta.monto).toBe(400);
    expect(r.enRuta.ordenes.map(x => x.id)).toEqual([3]);
    expect(r.vacio).toBe(false);
    expect(r).not.toHaveProperty('total');   // sin cifra combinada ni saldo
  });
  it('solo Creada, solo Asignada y ninguno', () => {
    expect(resumenPorCobrar([o(1, 'Creada', 10)])).toMatchObject({ directo: { count: 1, monto: 10 }, enRuta: { count: 0, monto: 0 }, vacio: false });
    expect(resumenPorCobrar([o(1, 'Asignada', 10)])).toMatchObject({ directo: { count: 0, monto: 0 }, enRuta: { count: 1, monto: 10 }, vacio: false });
    expect(resumenPorCobrar([o(1, 'Entregada', 10)]).vacio).toBe(true);
    expect(resumenPorCobrar(undefined)).toMatchObject({ directo: { count: 0 }, enRuta: { count: 0 }, vacio: true });
  });
  it('el estatus se compara exacto (no se reinterpreta)', () => {
    expect(resumenPorCobrar([o(1, 'creada', 10), o(2, 'Asignada ', 10)]).vacio).toBe(true);
  });
});

describe('resumenVentasHoy: Vendido hoy existente, desglose por estatus y última venta', () => {
  const ords = [
    o(10, 'Entregada', 300), o(12, 'Entregada', '200'), o(11, 'Creada', 150), o(13, 'Asignada', 80),
    o(14, 'Facturada', 500), o(9, 'Entregada', 1000, '2026-10-04'),
  ];
  it('Vendido hoy = Σ total de las de hoy en Entregada (misma fórmula de siempre)', () => {
    const r = resumenVentasHoy(ords, HOY);
    const hoy = ords.filter(x => x.fecha && x.fecha.slice(0, 10) === HOY);
    expect(r.vendidoHoy).toBe(hoy.filter(x => x.estatus === 'Entregada').reduce((s, x) => s + n(x.total), 0));
    expect(r.vendidoHoy).toBe(500);   // Facturada y la de ayer no cuentan (semántica existente)
    expect(r.count).toBe(5);
    expect(r.ordenesHoy.map(x => x.id)).toEqual([10, 12, 11, 13, 14]);
  });
  it('desglose con los estatus persistidos en el orden del ciclo de vida', () => {
    const r = resumenVentasHoy(ords, HOY);
    expect(r.porEstatus).toEqual([{ estatus: 'Creada', count: 1 }, { estatus: 'Asignada', count: 1 }, { estatus: 'Entregada', count: 2 }, { estatus: 'Facturada', count: 1 }]);
    expect(textoDesglose(r.porEstatus)).toBe('1 Creada · 1 Asignada · 2 Entregada · 1 Facturada');
    expect(resumenVentasHoy([o(1, 'Raro', 1), o(2, '', 1), o(3, 'Creada', 1)], HOY).porEstatus.map(x => x.estatus)).toEqual(['Creada', 'Raro', 'Sin estatus']);
  });
  it('última venta de hoy = id mayor, con campos ya cargados', () => {
    expect(resumenVentasHoy(ords, HOY).ultima).toEqual({ id: 14, folio: 'OV-0014', cliente: 'Cliente 14', total: 500, estatus: 'Facturada' });
    expect(resumenVentasHoy([{ id: 3, estatus: 'Creada', total: 5, fecha: HOY }], HOY).ultima.folio).toBe('3');
  });
  it('sin órdenes hoy: todo en cero y última null', () => {
    expect(resumenVentasHoy(ords, '2026-10-06')).toEqual({ ordenesHoy: [], count: 0, vendidoHoy: 0, porEstatus: [], ultima: null });
    expect(resumenVentasHoy(null, HOY).count).toBe(0);
  });
});

describe('resumenHistorial: conteo y fecha más antigua', () => {
  it('cuenta todas y toma la fecha mínima válida', () => {
    expect(resumenHistorial([o(1, 'Creada', 1, '2026-09-30'), o(2, 'Entregada', 1, '2026-08-01T10:00:00Z'), o(3, 'Cancelada', 1, '')])).toEqual({ count: 3, desde: '2026-08-01' });
  });
  it('sin órdenes o sin fechas', () => {
    expect(resumenHistorial([])).toEqual({ count: 0, desde: null });
    expect(resumenHistorial([{ id: 1 }])).toEqual({ count: 1, desde: null });
    expect(resumenHistorial(undefined)).toEqual({ count: 0, desde: null });
  });
});
