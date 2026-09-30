// empaque.test.js — 092: semántica de empaque (Modelo A) en el frontend.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TIPO_ENTREGA_PRODUCCION, clasificarMovEmpaque, efectoEnTotal, resumenDiaEmpaque, normalizarConciliacion,
} from '../data/empaqueLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('clasificarMovEmpaque', () => {
  it('recepción, entrega canónica y consumo de producción son clases distintas', () => {
    expect(clasificarMovEmpaque({ tipo: 'Entrada', origen: 'Recepción de compra' })).toBe('entrada');
    expect(clasificarMovEmpaque({ tipo: TIPO_ENTREGA_PRODUCCION, referencia: 'salida_empaque/EMP-5', origen: 'Almacén' })).toBe('entrega');
    expect(clasificarMovEmpaque({ tipo: 'Salida', origen: 'Producción OP-125' })).toBe('consumo');
  });
  it('la historia anterior a 092 es legado, nunca entrega canónica', () => {
    expect(clasificarMovEmpaque({ tipo: 'Salida', origen: 'Producción', referencia: null })).toBe('legado_salida');
    expect(clasificarMovEmpaque({ tipo: 'Salida', origen: 'Producción', referencia: 'salida_empaque/EMP-5' })).toBe('legado_salida');
    expect(clasificarMovEmpaque({ tipo: TIPO_ENTREGA_PRODUCCION, referencia: '' })).toBe('otro');
  });
  it('solo recepción suma y solo consumo resta del total; la entrega no mueve el total', () => {
    expect(efectoEnTotal('entrada')).toBe(1);
    expect(efectoEnTotal('entrega')).toBe(0);
    expect(efectoEnTotal('consumo')).toBe(-1);
  });
});

describe('resumenDiaEmpaque', () => {
  it('suma llegadas y entregas del día por SKU; ignora consumo y otros días', () => {
    const movs = [
      { producto: 'EMP-5', tipo: 'Entrada', cantidad: 20, createdAt: '2026-10-01T10:00:00' },
      { producto: 'EMP-5', tipo: TIPO_ENTREGA_PRODUCCION, referencia: 'salida_empaque/EMP-5', cantidad: 30, createdAt: '2026-10-01T11:00:00' },
      { producto: 'EMP-5', tipo: 'Salida', origen: 'Producción OP-9', cantidad: 10, createdAt: '2026-10-01T12:00:00' },
      { producto: 'EMP-5', tipo: 'Entrada', cantidad: 99, createdAt: '2026-09-30T12:00:00' },
    ];
    expect(resumenDiaEmpaque(movs, ['EMP-5', 'EMP-25'], '2026-10-01')).toEqual({ 'EMP-5': { entradas: 20, entregas: 30 }, 'EMP-25': { entradas: 0, entregas: 0 } });
  });
});

describe('normalizarConciliacion (prueba numérica de aceptación)', () => {
  it('100 → +20 → entrega 30 → produce 10: total 110, entregado 30, usado 10, diferencia 20', () => {
    const [x] = normalizarConciliacion([{ sku: 'EMP-5', nombre: 'Bolsa', stock_total: 110, entregado_produccion: 30, consumido_produccion: 10, diferencia: 20 }]);
    expect(x).toMatchObject({ sku: 'EMP-5', stockTotal: 110, entregado: 30, usado: 10, diferencia: 20, estado: 'sin_usar' });
  });
  it('estados de control y legado aparte', () => {
    const r = normalizarConciliacion([
      { sku: 'A', entregado_produccion: 5, consumido_produccion: 5 },
      { sku: 'B', entregado_produccion: 0, consumido_produccion: 4, legado_salidas: 10, legado_salidas_n: 2, legado_consumo: 4, legado_consumo_n: 1 },
    ]);
    expect(r[0].estado).toBe('cuadra');
    expect(r[1]).toMatchObject({ estado: 'uso_sin_entrega', diferencia: -4, legadoSalidas: 10, legadoSalidasN: 2, legadoConsumo: 4, legadoConsumoN: 1 });
    expect(normalizarConciliacion(null)).toEqual([]);
  });
});

describe('092: pantallas y store', () => {
  it('el store expone la conciliación del servidor', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/obtenerConciliacionEmpaque: async/);
    expect(store).toMatch(/rpc\('conciliacion_empaque'\)/);
  });
  it('el almacén no describe el stock como solo almacén y registra la entrega como entrega', () => {
    const v = src('../components/BolsasView.jsx');
    expect(v).not.toMatch(/en almacén/);
    expect(v).toMatch(/total de la empresa/);
    expect(v).toMatch(/resumenDiaEmpaque/);
    expect(v).toMatch(/no descuenta/);
  });
  it('la vista de Admin concilia con el servidor, no por origen = Producción', () => {
    const v = src('../components/views/AlmacenBolsasView.jsx');
    expect(v).toMatch(/obtenerConciliacionEmpaque/);
    expect(v).not.toMatch(/origen\.includes\("producción"\)/);
    expect(v).not.toMatch(/en almacén/);
  });
  it('el kardex permite filtrar las entregas a Producción', () => {
    expect(src('../components/views/KardexView.jsx')).toMatch(/Entrega a Producción/);
  });
});
