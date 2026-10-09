// fechaNegocioEscritores.test.js — 098: los escritores de "hoy" no dejan que
// la zona del navegador elija el día de negocio. El gate corre este archivo
// con TZ=UTC, America/Mazatlan, America/Mexico_City y Europe/Madrid.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diaNegocio, sumarDias } from '../utils/fechas';
import { fechaElegida, camposFechaCosto, claveAbonoCxP, buildPagarCxPArgs } from '../data/fechaNegocioLogic';
import { buildLeadRow } from '../data/leadsIntakeLogic';
import { buildOrdenPayload } from '../data/ordenLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const TZ = globalThis.process?.env?.TZ || 'local';

// 2026-09-30 05:30 UTC: 23:30 del 29 en Durango (y CDMX); día 30 en UTC y Madrid; 22:30 del 29 en Mazatlán.
const FRONTERA = new Date('2026-09-30T05:30:00Z');

describe(`instante frontera (TZ=${TZ})`, () => {
  afterEach(() => { vi.useRealTimers(); });

  it('el día de negocio de "ahora" es el de Durango (29) en cualquier zona del navegador', () => {
    vi.useFakeTimers(); vi.setSystemTime(FRONTERA);
    expect(diaNegocio()).toBe('2026-09-29');
    expect(sumarDias(diaNegocio(), -30)).toBe('2026-08-30');
    expect(sumarDias(diaNegocio(), -7)).toBe('2026-09-22');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('los payloads de escritura no llevan fecha del navegador', () => {
    vi.useFakeTimers(); vi.setSystemTime(FRONTERA);
    const cxp = buildPagarCxPArgs({ operacionId: 'u-1', cxpId: 7, monto: 100.005, metodoPago: '', referencia: ' R ' });
    expect(cxp.args).toEqual({ p_operacion_id: 'u-1', p_cxp_id: 7, p_monto: 100.01, p_metodo_pago: 'Transferencia', p_referencia: 'R' });
    expect(JSON.stringify(cxp.args)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const lead = buildLeadRow({ nombre: 'Ana', telefono: '6671234567', body: {} });
    expect('fecha' in lead).toBe(false);
    const orden = buildOrdenPayload({ clienteId: 1 }, { folio: 'OV-1', clienteNombre: 'x', productosStr: 'x', total: 1 });
    expect(orden.fecha).toBeNull();
    expect(camposFechaCosto(null)).toEqual({});
  });
});

describe('fechas elegidas por el usuario', () => {
  it('se conservan y se validan como DATE', () => {
    expect(fechaElegida('2026-08-15')).toEqual({ fecha: '2026-08-15' });
    expect(fechaElegida('')).toEqual({ fecha: null });
    expect(fechaElegida(undefined)).toEqual({ fecha: null });
    expect(fechaElegida('2026-02-30').error).toBeTruthy();
    expect(fechaElegida('15/08/2026').error).toBeTruthy();
    expect(fechaElegida('2026-08-15T00:00:00Z').error).toBeTruthy();
    expect(camposFechaCosto('2026-08-15')).toEqual({ fecha: '2026-08-15', periodo: '2026-08' });
  });
  it('el abono a CxP valida monto, cuenta y operación', () => {
    expect(buildPagarCxPArgs({ operacionId: 'u', cxpId: 1, monto: 0 }).error).toBeTruthy();
    expect(buildPagarCxPArgs({ operacionId: 'u', cxpId: 'x', monto: 5 }).error).toBeTruthy();
    expect(buildPagarCxPArgs({ cxpId: 1, monto: 5 }).error).toBeTruthy();
    expect(claveAbonoCxP({ cxpId: 1, monto: 5, metodoPago: 'Efectivo', referencia: ' a ' })).toBe(claveAbonoCxP({ cxpId: 1, monto: 5.001, metodoPago: 'Efectivo', referencia: 'a' }));
  });
});

describe('098: escritores con fecha del servidor', () => {
  const store = src('../data/supaStore.js');
  it('CxP y nómina se pagan por contrato; ningún escritor del store usa la fecha del navegador', () => {
    expect(store).toMatch(/rpc\('pagar_cuenta_por_pagar', built\.args\)/);
    expect(store).toMatch(/rpc\('pagar_nomina', \{ p_periodo_id: Number\(periodoId\) \}\)/);
    expect(store).not.toMatch(/from\('pagos_proveedores'\)\s*\.insert\(/);
    expect(store).not.toMatch(/todayLocalISO|todayISO/);
  });
  it('venta, lead del landing y pago en línea no mandan el día del navegador ni el UTC', () => {
    expect(src('../components/NuevaVentaModal.jsx')).not.toMatch(/todayLocalISO|todayISO/);
    expect(src('../data/ordenLogic.js')).not.toMatch(/todayLocalISO/);
    expect(src('../data/leadsIntakeLogic.js')).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
    expect(src('../../netlify/functions/_lib/persistence.js')).not.toMatch(/fecha: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });
  it('el modal de CxP conserva el UUID del abono entre reintentos', () => {
    const v = src('../components/views/CuentasPorPagarView.jsx');
    expect(v).toMatch(/resolverOperacion\(pagoOpRef\.current, claveAbonoCxP\(datos\)\)/);
    expect(v).toMatch(/\{ operacionId: op\.id \}/);
  });
  it('filtros "hoy" usan el día de negocio; el navegador solo queda en rutas de archivos', () => {
    for (const f of ['../components/views/MermasView.jsx', '../components/views/DevolucionesView.jsx', '../components/views/DashboardView.jsx',
      '../components/views/ProduccionView.jsx', '../components/views/AuditoriaView.jsx', '../components/views/CobrosView.jsx',
      '../components/views/AlmacenBolsasView.jsx', '../components/views/ContabilidadView.jsx', '../components/views/CostosView.jsx',
      '../components/BolsasView.jsx', '../components/ChoferView.jsx', '../components/VentasStandaloneView.jsx']) {
      expect(src(f), f).not.toMatch(/todayLocalISO|todayISO\(\)/);
    }
    const ps = src('../components/ProduccionStandaloneView.jsx');
    expect(ps.match(/todayLocalISO\(\)/g)).toHaveLength(2); // solo carpeta de fotos en Storage
    expect(ps).toMatch(/const hoy = diaNegocio\(\);/);
  });
});
