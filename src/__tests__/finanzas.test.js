// finanzas.test.js — 093: reportes financieros separados (flujo de efectivo
// vs estado de resultados). Las cifras vienen del servidor; aquí se prueban
// la normalización, las líneas y que las vistas ya no mezclan conceptos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rangoMes, rangoDeMes, normalizarReporteFinanciero, lineasEstadoResultados, lineasFlujoEfectivo } from '../data/finanzasLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Respuesta del servidor para el escenario de aceptación del 093.
const ACEPTACION = {
  desde: '2026-10-01', hasta: '2026-10-31',
  resultados: { ventas_entregadas: 1500, costo_ventas: 150, costos_fijos: 400, nomina: 600, mermas: 50, utilidad_bruta: 1350, utilidad: 300 },
  flujo: { entradas_pagos: 1300, entradas: 1300, salidas_compras_contado: 200, salidas_costos: 400, salidas_nomina: 600, salidas: 1200, excluido_no_efectivo: 50, neto: 100 },
  saldos: { cxc_pendiente: 200, cxc_n: 1, cxp_pendiente: 0, cxp_n: 0 },
  limitaciones: ['No es el saldo de caja ni del banco'],
};

describe('rangoMes / rangoDeMes', () => {
  it('mes calendario completo', () => {
    expect(rangoMes(new Date(2026, 1, 10))).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDeMes('2026-10')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  });
});

describe('normalizarReporteFinanciero', () => {
  it('llaves estables y números', () => {
    const r = normalizarReporteFinanciero(ACEPTACION);
    expect(r.resultados.utilidad).toBe(300);
    expect(r.resultados.otros_gastos).toBe(0);
    expect(r.flujo.neto).toBe(100);
    expect(r.saldos.cxc_pendiente).toBe(200);
    expect(r.limitaciones).toHaveLength(1);
  });
  it('respuesta vacía no rompe', () => {
    const r = normalizarReporteFinanciero(null);
    expect(r.resultados.utilidad).toBe(0);
    expect(r.flujo.entradas).toBe(0);
  });
});

describe('líneas: la compra no es gasto y el cobro no es ingreso', () => {
  const r = normalizarReporteFinanciero(ACEPTACION);
  it('estado de resultados: ventas 1500, costo 150, fijos 400, nómina 600, mermas 50 → 300', () => {
    const l = Object.fromEntries(lineasEstadoResultados(r).map(x => [x.clave, x.monto]));
    expect(l).toMatchObject({ ventas_entregadas: 1500, costo_ventas: 150, costos_fijos: 400, nomina: 600, mermas: 50, utilidad: 300 });
    expect(l).not.toHaveProperty('salidas_compras_contado');
  });
  it('flujo: entró 1300, salió 1200 (compra 200 + renta 400 + nómina 600), sin merma', () => {
    const l = Object.fromEntries(lineasFlujoEfectivo(r).map(x => [x.clave, x.monto]));
    expect(l).toMatchObject({ entradas: 1300, salidas_compras_contado: 200, salidas_costos: 400, salidas_nomina: 600, salidas: 1200, neto: 100 });
    expect(Object.keys(l)).not.toContain('mermas');
  });
});

describe('093: las vistas usan el reporte del servidor', () => {
  it('Dashboard: sin fórmula mezclada; utilidad y flujo por separado', () => {
    const v = src('../components/views/DashboardView.jsx');
    expect(v).toMatch(/obtenerReporteFinanciero/);
    expect(v).not.toMatch(/egresosSinVinculo|Costo fijo|costo_historial'\)/);
    expect(v).not.toMatch(/Saldo a favor/);
    expect(v).toMatch(/Flujo de efectivo/);
    expect(v).toMatch(/Estado de resultados/);
  });
  it('Contabilidad: sin "Balance" ambiguo', () => {
    const v = src('../components/views/ContabilidadView.jsx');
    expect(v).toMatch(/obtenerReporteFinanciero/);
    expect(v).not.toMatch(/>Balance</);
    expect(v).toMatch(/Flujo de efectivo/);
  });
  it('el store expone el reporte del servidor', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/obtenerReporteFinanciero: async/);
    expect(store).toMatch(/rpc\('reporte_financiero'/);
  });
});

describe('093: la entrega de mostrador registra el cobro como pago canónico', () => {
  it('esPagoEnLinea: QR / link esperan al webhook; lo demás se cobra al entregar', async () => {
    const { esPagoEnLinea } = await import('../data/ordenLogic');
    expect(esPagoEnLinea('QR / Link de pago')).toBe(true);
    expect(esPagoEnLinea('Efectivo')).toBe(false);
    expect(esPagoEnLinea('Transferencia')).toBe(false);
    expect(esPagoEnLinea('Tarjeta')).toBe(false);
  });
  it('updateOrdenEstatus usa registrar_pago_orden (no un ingreso contable suelto)', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/else if \(!esPagoEnLinea\(mPago\)\)[\s\S]{0,700}rpc\('registrar_pago_orden'/);
    expect(store).not.toMatch(/rpc\('registrar_ingreso_orden'/);
  });
});
