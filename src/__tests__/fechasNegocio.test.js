// fechasNegocio.test.js — 096: día de negocio (America/Mazatlan) y fechas de
// calendario. Estas pruebas deben pasar con el navegador en cualquier zona;
// el gate las corre con TZ=UTC, TZ=America/Mazatlan y TZ=America/Mexico_City.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fmtDate } from '../utils/safe';
import { ZONA_NEGOCIO, esFechaSolo, diaNegocio, mesNegocio, diasEntre, fmtFechaNegocio } from '../utils/fechas';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe(`fechas de calendario (TZ=${globalThis.process?.env?.TZ || 'local'})`, () => {
  it('fmtDate de una fecha DATE no se corre al día anterior', () => {
    expect(fmtDate('2026-09-29')).toBe('29/09/2026');
    expect(fmtDate('2026-01-01')).toBe('01/01/2026');
    expect(fmtFechaNegocio('2026-09-29')).toBe('29/09/2026');
  });
  it('fmtDate de un instante conserva su semántica de instante', () => {
    // Mediodía UTC es el mismo día en UTC, Mazatlán y CDMX.
    expect(fmtDate('2026-09-29T18:00:00Z')).toBe('29/09/2026');
    expect(fmtDate('')).toBe('—');
  });
  it('esFechaSolo solo acepta YYYY-MM-DD exacto', () => {
    expect(esFechaSolo('2026-09-29')).toBe(true);
    expect(esFechaSolo('2026-09-29T00:00:00Z')).toBe(false);
  });
});

describe('día de negocio en America/Mazatlan', () => {
  it('zona canónica', () => {
    expect(ZONA_NEGOCIO).toBe('America/Mazatlan');
  });
  it('23:30 en Mazatlán (00:30 del día siguiente en CDMX) pertenece al día 29', () => {
    expect(diaNegocio(new Date('2026-09-30T06:30:00Z'))).toBe('2026-09-29');
    expect(diaNegocio('2026-09-30T06:30:00Z')).toBe('2026-09-29');
  });
  it('a medianoche de Mazatlán (07:00 UTC) empieza el día siguiente', () => {
    expect(diaNegocio(new Date('2026-09-30T06:59:59Z'))).toBe('2026-09-29');
    expect(diaNegocio(new Date('2026-09-30T07:00:00Z'))).toBe('2026-09-30');
  });
  it('una fecha DATE ya es día de negocio (sin conversión)', () => {
    expect(diaNegocio('2026-09-29')).toBe('2026-09-29');
    expect(mesNegocio('2026-10-01')).toBe('2026-10');
  });
  it('diasEntre cuenta días de calendario', () => {
    expect(diasEntre('2026-09-29', '2026-09-30')).toBe(1);
    expect(diasEntre('2026-08-30', '2026-09-29')).toBe(30);
    expect(diasEntre('2026-09-29', '2026-09-29')).toBe(0);
  });
});

describe('096: caja por contrato del servidor', () => {
  const store = src('../data/supaStore.js');
  it('el store cierra caja con cerrar_caja_ruta y no inserta en cierres_diarios', () => {
    expect(store).toMatch(/rpc\('cerrar_caja_ruta'/);
    expect(store).not.toMatch(/from\('cierres_diarios'\)\s*\.insert\(/);
    expect(store).not.toMatch(/fechaCierreDesdeRuta/);
    expect(store).toMatch(/rpc\('rutas_pendientes_caja'\)/);
  });
  it('Conciliación decide pendientes con el servidor, sin derivar fechas', () => {
    const v = src('../components/views/ConciliacionView.jsx');
    expect(v).toMatch(/obtenerRutasPendientesCaja/);
    expect(v).not.toMatch(/cierresIdx|yaCerrada/);
    expect(v).not.toMatch(/\.slice\(0, 10\);\s*\n\s*const key/);
  });
  it('el modal conserva el UUID de la operación entre reintentos', () => {
    const m = src('../components/CierreCajaModal.jsx');
    expect(m).toMatch(/resolverOperacion\(opRef\.current, claveCierreCaja\(datos\)\)/);
    expect(m).toMatch(/operacionId: op\.id/);
  });
  it('bandeja y exportes usan el día de negocio', () => {
    expect(src('../components/views/BandejaView.jsx')).toMatch(/construirBandeja\(data, diaNegocio\(\)\)/);
    expect(src('../utils/exportReports.js')).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
    expect(src('../components/views/CuentasPorPagarView.jsx')).not.toMatch(/new Date\(s\(p\.fecha\)\)/);
    expect(src('../components/views/MermasView.jsx')).not.toMatch(/new Date\(s\(borrarModal\.fecha\)\)/);
  });
});
