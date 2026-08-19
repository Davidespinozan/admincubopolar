// navegacionShellLogic.test.js — deep-linking del shell admin (Tanda 25).
import { describe, it, expect } from 'vitest';
import { viewDesdeHash, hashDesdeView, moduloParaNotificacion } from '../data/navegacionShellLogic';

const IDS = new Set(['dashboard', 'bandeja', 'rutas', 'cobros', 'ordenes', 'facturacion', 'produccion', 'leads']);

describe('viewDesdeHash', () => {
  it('parsea el formato canónico #/vista', () => {
    expect(viewDesdeHash('#/rutas', IDS)).toBe('rutas');
    expect(viewDesdeHash('#/bandeja', IDS)).toBe('bandeja');
  });

  it('tolera hash sin slash (#rutas)', () => {
    expect(viewDesdeHash('#rutas', IDS)).toBe('rutas');
  });

  it('rechaza vistas inexistentes y basura → null (el shell cae a dashboard)', () => {
    expect(viewDesdeHash('#/loquesea', IDS)).toBeNull();
    expect(viewDesdeHash('#/', IDS)).toBeNull();
    expect(viewDesdeHash('', IDS)).toBeNull();
    expect(viewDesdeHash(null, IDS)).toBeNull();
    expect(viewDesdeHash('#/RUTAS', IDS)).toBeNull(); // ids son case-sensitive
  });

  it('acepta arrays además de Sets como idsValidos', () => {
    expect(viewDesdeHash('#/cobros', ['cobros'])).toBe('cobros');
  });

  it('round-trip con hashDesdeView', () => {
    for (const id of IDS) {
      expect(viewDesdeHash(hashDesdeView(id), IDS)).toBe(id);
    }
  });
});

describe('hashDesdeView', () => {
  it('genera el formato canónico', () => {
    expect(hashDesdeView('rutas')).toBe('#/rutas');
  });

  it('vista vacía cae a dashboard', () => {
    expect(hashDesdeView('')).toBe('#/dashboard');
    expect(hashDesdeView(null)).toBe('#/dashboard');
  });
});

describe('moduloParaNotificacion', () => {
  it('los crons de Tanda 21 navegan por prefijo de referencia', () => {
    expect(moduloParaNotificacion({ tipo: 'alerta', referencia: 'cron-cxc:2026-08-19' })).toBe('cobros');
    expect(moduloParaNotificacion({ tipo: 'alerta', referencia: 'cron-rutas:2026-08-19' })).toBe('rutas');
  });

  it('mapea por tipo del catálogo de mig 027', () => {
    expect(moduloParaNotificacion({ tipo: 'venta' })).toBe('ordenes');
    expect(moduloParaNotificacion({ tipo: 'cobro' })).toBe('cobros');
    expect(moduloParaNotificacion({ tipo: 'credito' })).toBe('cobros');
    expect(moduloParaNotificacion({ tipo: 'factura' })).toBe('facturacion');
    expect(moduloParaNotificacion({ tipo: 'complemento' })).toBe('facturacion');
    expect(moduloParaNotificacion({ tipo: 'produccion' })).toBe('produccion');
    expect(moduloParaNotificacion({ tipo: 'alerta' })).toBe('bandeja');
  });

  it('tipo desconocido o notif nula → null (no navega)', () => {
    expect(moduloParaNotificacion({ tipo: 'otro' })).toBeNull();
    expect(moduloParaNotificacion({})).toBeNull();
    expect(moduloParaNotificacion(null)).toBeNull();
  });
});
