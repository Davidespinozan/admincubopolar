// nomina.test.js — 100: nómina canónica (sábado → viernes, Mazatlán). El gate
// corre este archivo con TZ=UTC, America/Mazatlan, America/Mexico_City y
// Europe/Madrid: la semana mostrada no depende de la zona del navegador.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diaNegocio } from '../utils/fechas';
import { inicioSemanaNomina, periodoNominaDe, etiquetaPeriodoNomina, buildEditarReciboArgs, previewRecibo, camposDeRecibo } from '../data/nominaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const TZ = globalThis.process?.env?.TZ || 'local';

describe(`semana de nómina (TZ=${TZ})`, () => {
  afterEach(() => { vi.useRealTimers(); });

  it('instante frontera: viernes 23:30 en Durango (sábado en UTC/Madrid) muestra la misma semana', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T05:30:00Z'));
    expect(diaNegocio()).toBe('2026-10-02');
    expect(periodoNominaDe(diaNegocio())).toEqual({ fechaInicio: '2026-09-26', fechaFin: '2026-10-02', fechaPago: '2026-10-02' });
  });

  it('sábado → viernes, pago viernes (NOMINA08: 21/02 → 27/02/2026)', () => {
    for (const d of ['2026-02-21', '2026-02-22', '2026-02-25', '2026-02-27']) expect(inicioSemanaNomina(d)).toBe('2026-02-21');
    expect(inicioSemanaNomina('2026-02-28')).toBe('2026-02-28');
    expect(etiquetaPeriodoNomina(periodoNominaDe('2026-02-24'))).toBe('Sáb 21/02/2026 – Vie 27/02/2026');
  });

  it('fin de año: un solo periodo por rango de fechas, sin número de semana', () => {
    expect(periodoNominaDe('2026-12-31')).toEqual({ fechaInicio: '2026-12-26', fechaFin: '2027-01-01', fechaPago: '2027-01-01' });
    expect(periodoNominaDe('2027-01-01').fechaInicio).toBe('2026-12-26');
    expect(periodoNominaDe('2027-01-02').fechaInicio).toBe('2027-01-02');
  });
});

describe('recibo: captura y vista previa', () => {
  it('componentes reales sin deducción automática (NOMINA08: 4990.24)', () => {
    const campos = { diasPagados: '6', conSeptimo: true, comisiones: '2465', primaDominical: '79.73', bonoPuntualidad: '213', bonoProductividad: '', otrasPercepciones: '', deducciones: '' };
    expect(previewRecibo(318.93, campos)).toEqual({ sueldo: 1913.58, septimoDia: 318.93, totalPercepciones: 4990.24, deducciones: 0, netoAPagar: 4990.24 });
    expect(previewRecibo(318.93, { ...campos, bonoProductividad: '50', otrasPercepciones: '30', deducciones: '100' }).netoAPagar).toBe(4970.24);
  });

  it('los parámetros del contrato no llevan salario ni totales', () => {
    const r = buildEditarReciboArgs(7, { diasPagados: '5', conSeptimo: false, comisiones: '10.005', primaDominical: '', bonoPuntualidad: '0', bonoProductividad: '0', otrasPercepciones: '0', deducciones: '1' });
    expect(r.args).toEqual({ p_recibo_id: 7, p_dias_pagados: 5, p_con_septimo: false, p_comisiones: 10.01, p_prima_dominical: 0, p_bono_puntualidad: 0,
      p_bono_productividad: 0, p_otras_percepciones: 0, p_deducciones: 1 });
    expect(Object.keys(r.args).some(k => /total|neto|salario|sueldo/.test(k))).toBe(false);
  });

  it('valida días y negativos', () => {
    expect(buildEditarReciboArgs(1, { diasPagados: '8' }).error).toBeTruthy();
    expect(buildEditarReciboArgs(1, { diasPagados: '' }).error).toBeTruthy();
    expect(buildEditarReciboArgs(1, { diasPagados: '2.5' }).error).toBeTruthy();
    expect(buildEditarReciboArgs(1, { diasPagados: '6', comisiones: '-1' }).error).toBeTruthy();
    expect(buildEditarReciboArgs(0, { diasPagados: '6' }).error).toBeTruthy();
  });

  it('campos editables desde el recibo del servidor', () => {
    expect(camposDeRecibo({ diasPagados: 6, septimoDia: '100.00', comisiones: '5.50', deducciones: '0' })).toMatchObject({ diasPagados: '6', conSeptimo: true, comisiones: '5.5', deducciones: '0' });
    expect(camposDeRecibo({ diasPagados: 5, septimoDia: 0 }).conSeptimo).toBe(false);
  });
});

describe('100: nómina por contrato', () => {
  const store = src('../data/supaStore.js');
  const vista = src('../components/views/NominaView.jsx');
  it('el store usa los contratos y no escribe nómina por REST', () => {
    for (const rpc of ['crear_periodo_nomina', 'generar_recibos_nomina', 'editar_recibo_nomina', 'pagar_nomina']) expect(store).toMatch(new RegExp(`rpc\\('${rpc}'`));
    expect(store).not.toMatch(/from\('nomina_(periodos|recibos)'\)\s*\.(insert|update|delete|upsert)\(/);
    expect(store).not.toMatch(/addNominaPeriodo|addNominaRecibo/);
  });
  it('la vista no calcula la semana con el reloj del navegador ni deduce IMSS', () => {
    expect(vista).not.toMatch(/getDay\(\)|getFullYear\(\)|numeroSemana|numero_semana|todayLocalISO/);
    expect(vista).not.toMatch(/0\.02|imss/i);
    expect(vista).toMatch(/crearPeriodoNomina\(fecha \|\| null\)/);
  });
});
