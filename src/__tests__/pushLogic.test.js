// pushLogic.test.js — Web Push (Tanda 30).
import { describe, it, expect } from 'vitest';
import { buildPushPayload, urlBase64ToUint8Array } from '../data/pushLogic';

describe('buildPushPayload', () => {
  it('usa titulo/mensaje y deep link del mismo mapeo que la campana', () => {
    const p = buildPushPayload({
      tipo: 'alerta',
      titulo: 'Cartera vencida',
      mensaje: 'Tienes 3 cuentas vencidas',
      referencia: 'cron-cxc:2026-08-20',
    });
    expect(p.title).toBe('Cartera vencida');
    expect(p.body).toBe('Tienes 3 cuentas vencidas');
    expect(p.url).toBe('/#/cobros');
  });

  it('cron de rutas → /#/rutas, venta → /#/ordenes', () => {
    expect(buildPushPayload({ tipo: 'alerta', referencia: 'cron-rutas:2026-08-20' }).url).toBe('/#/rutas');
    expect(buildPushPayload({ tipo: 'venta', titulo: 'Nueva venta' }).url).toBe('/#/ordenes');
  });

  it('sin mapeo cae a Mi bandeja; sin textos usa defaults', () => {
    const p = buildPushPayload({ tipo: 'desconocido' });
    expect(p.url).toBe('/#/bandeja');
    expect(p.title).toBe('CuboPolar');
    expect(p.body).toBe('');
    expect(buildPushPayload(null).url).toBe('/#/bandeja');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64 estándar', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });

  it('decodifica base64url (- y _ en lugar de + y /) sin padding', () => {
    // 0xfb 0xff => base64 estándar '+/8' con padding; url-safe '-_8'
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
    expect(Array.from(urlBase64ToUint8Array('-_8='))).toEqual([251, 255]);
  });

  it('llave vacía lanza', () => {
    expect(() => urlBase64ToUint8Array('')).toThrow(/vacía/);
    expect(() => urlBase64ToUint8Array('   ')).toThrow(/vacía/);
  });
});
