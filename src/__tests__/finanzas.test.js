// finanzas.test.js — análisis financiero (estado de resultados, liquidez)
import { describe, it, expect } from 'vitest';
import {
  filtrarPorFecha,
  calcEstadoResultados,
  calcPosicionFinanciera,
  efectivoDelDia,
  saldoPendienteTotal,
} from '../data/finanzasLogic';

// ─── filtrarPorFecha ──────────────────────────────────────────
describe('filtrarPorFecha', () => {
  const movs = [
    { fecha: '2026-03-01', monto: 100 },
    { fecha: '2026-03-15', monto: 200 },
    { fecha: '2026-03-20', monto: 300 },
  ];

  it('filtra desde fecha inclusive', () => {
    const r = filtrarPorFecha(movs, '2026-03-15');
    expect(r).toHaveLength(2);
    expect(r[0].monto).toBe(200);
  });

  it('devuelve todos si la fecha es muy antigua', () => {
    expect(filtrarPorFecha(movs, '2000-01-01')).toHaveLength(3);
  });

  it('devuelve vacío si la fecha es futura', () => {
    expect(filtrarPorFecha(movs, '2030-01-01')).toHaveLength(0);
  });

  it('maneja array vacío', () => {
    expect(filtrarPorFecha([], '2026-01-01')).toHaveLength(0);
  });

  it('maneja null', () => {
    expect(filtrarPorFecha(null, '2026-01-01')).toHaveLength(0);
  });
});

// ─── calcEstadoResultados ─────────────────────────────────────
describe('calcEstadoResultados', () => {
  const ingresos = [
    { categoria: 'Ventas',    monto: 50000 },
    { categoria: 'Cobranza',  monto: 10000 },
    { categoria: 'Otro',      monto: 500   }, // no cuenta como venta
  ];

  const egresos = [
    { categoria: 'Costo de Ventas', monto: 20000 },
    { categoria: 'Nómina',          monto: 8000  },
    { categoria: 'Gastos',          monto: 2000  },
  ];

  it('calcula ventas (Ventas + Cobranza)', () => {
    const r = calcEstadoResultados(ingresos, egresos);
    expect(r.ventas).toBe(60000);
  });

  it('calcula costo de ventas (solo categoría Costo de Ventas)', () => {
    const r = calcEstadoResultados(ingresos, egresos);
    expect(r.costoDeVentas).toBe(20000);
  });

  it('calcula utilidad bruta = ventas − costo de ventas', () => {
    const r = calcEstadoResultados(ingresos, egresos);
    expect(r.utilidadBruta).toBe(40000);
  });

  it('calcula gastos operativos (todo excepto Costo de Ventas)', () => {
    const r = calcEstadoResultados(ingresos, egresos);
    expect(r.gastosOp).toBe(10000); // 8000 + 2000
  });

  it('calcula utilidad neta = utilidad bruta − gastos op', () => {
    const r = calcEstadoResultados(ingresos, egresos);
    expect(r.utilidad).toBe(30000);
  });

  it('utilidad negativa cuando gastos > ventas', () => {
    const r = calcEstadoResultados(
      [{ categoria: 'Ventas', monto: 1000 }],
      [{ categoria: 'Nómina', monto: 5000 }]
    );
    expect(r.utilidad).toBeLessThan(0);
  });

  it('todo en 0 para listas vacías', () => {
    const r = calcEstadoResultados([], []);
    expect(r.ventas).toBe(0);
    expect(r.utilidad).toBe(0);
  });
});

// ─── calcPosicionFinanciera ───────────────────────────────────
describe('calcPosicionFinanciera', () => {
  it('posición positiva: más activos que pasivos', () => {
    const r = calcPosicionFinanciera(5000, 10000, 3000);
    expect(r.posicion).toBe(12000); // 5000 + 10000 - 3000
  });

  it('posición negativa cuando cxp > efectivo + cxc', () => {
    const r = calcPosicionFinanciera(1000, 2000, 8000);
    expect(r.posicion).toBe(-5000);
  });

  it('liquidez neta = efectivo − cxp', () => {
    const r = calcPosicionFinanciera(5000, 10000, 3000);
    expect(r.liquidezNeta).toBe(2000); // 5000 - 3000
  });

  it('todo en 0 cuando no hay nada', () => {
    const r = calcPosicionFinanciera(0, 0, 0);
    expect(r.posicion).toBe(0);
    expect(r.liquidezNeta).toBe(0);
  });

  it('maneja decimales correctamente', () => {
    const r = calcPosicionFinanciera(1000.50, 2000.25, 500.75);
    expect(r.posicion).toBe(2500); // 1000.50 + 2000.25 - 500.75
  });
});

// ─── efectivoDelDia ───────────────────────────────────────────
describe('efectivoDelDia', () => {
  const hoy = '2026-03-20';
  const pagos = [
    { fecha: hoy,         monto: 500,  metodo_pago: 'Efectivo' },
    { fecha: hoy,         monto: 300,  metodo_pago: 'Efectivo' },
    { fecha: hoy,         monto: 1000, metodo_pago: 'Transferencia' }, // no efectivo
    { fecha: '2026-03-19',monto: 200,  metodo_pago: 'Efectivo' },     // otro día
  ];

  it('suma solo cobros en efectivo del día', () => {
    expect(efectivoDelDia(pagos, hoy)).toBe(800);
  });

  it('excluye pagos de otros días', () => {
    expect(efectivoDelDia(pagos, '2026-03-19')).toBe(200);
  });

  it('devuelve 0 si no hay cobros', () => {
    expect(efectivoDelDia([], hoy)).toBe(0);
  });

  it('acepta metodo_pago en camelCase (metodoPago)', () => {
    const pagosCC = [{ fecha: hoy, monto: 750, metodoPago: 'Efectivo' }];
    expect(efectivoDelDia(pagosCC, hoy)).toBe(750);
  });
});

// ─── saldoPendienteTotal ──────────────────────────────────────
describe('saldoPendienteTotal', () => {
  const cuentas = [
    { estatus: 'Pendiente', saldo_pendiente: 5000 },
    { estatus: 'Parcial',   saldo_pendiente: 1500 },
    { estatus: 'Pagada',    saldo_pendiente: 0    }, // no suma
    { estatus: 'Pendiente', saldo_pendiente: 3000 },
  ];

  it('suma solo cuentas no pagadas', () => {
    expect(saldoPendienteTotal(cuentas)).toBe(9500);
  });

  it('excluye cuentas Pagadas', () => {
    const soloPagadas = [{ estatus: 'Pagada', saldo_pendiente: 9999 }];
    expect(saldoPendienteTotal(soloPagadas)).toBe(0);
  });

  it('devuelve 0 para lista vacía', () => {
    expect(saldoPendienteTotal([])).toBe(0);
  });

  it('maneja null', () => {
    expect(saldoPendienteTotal(null)).toBe(0);
  });

  it('maneja saldo_pendiente null en fila individual', () => {
    const c = [{ estatus: 'Pendiente', saldo_pendiente: null }];
    expect(saldoPendienteTotal(c)).toBe(0);
  });
});
