// reciboNota.test.js — token firmado y HTML de la nota pública (Tanda 28).
import { describe, it, expect } from 'vitest';
import { firmarRecibo, verificarRecibo } from '../../netlify/functions/_lib/reciboToken.js';
import { buildNotaHtml } from '../../netlify/functions/_lib/notaHtml.js';

const SECRET = 'secreto-de-prueba';

describe('reciboToken', () => {
  it('firma determinista de 32 hex por orden', () => {
    const t1 = firmarRecibo(47, SECRET);
    expect(t1).toMatch(/^[0-9a-f]{32}$/);
    expect(firmarRecibo(47, SECRET)).toBe(t1);
    expect(firmarRecibo(48, SECRET)).not.toBe(t1);
  });

  it('verifica el token correcto y rechaza los incorrectos', () => {
    const token = firmarRecibo(47, SECRET);
    expect(verificarRecibo(47, token, SECRET)).toBe(true);
    expect(verificarRecibo(48, token, SECRET)).toBe(false);
    expect(verificarRecibo(47, token, 'otro-secret')).toBe(false);
    expect(verificarRecibo(47, token.slice(0, 31) + 'x', SECRET)).toBe(false);
  });

  it('malformaciones → false, nunca throw', () => {
    expect(verificarRecibo(47, '', SECRET)).toBe(false);
    expect(verificarRecibo(47, null, SECRET)).toBe(false);
    expect(verificarRecibo(47, 'corto', SECRET)).toBe(false);
    expect(verificarRecibo(47, firmarRecibo(47, SECRET), '')).toBe(false);
  });

  it('firmar sin secret lanza (el handler responde 501 antes de llegar aquí)', () => {
    expect(() => firmarRecibo(47, '')).toThrow(/RECIBO_SECRET/);
  });
});

describe('buildNotaHtml', () => {
  const base = {
    empresa: { razon_social: 'Cubo Polar S.A. de C.V.', rfc: 'CPO000000XX0', telefono: '618-000-0000' },
    orden: { id: 47, folio: 'OV-0047', folio_nota: 'N-0012', fecha: '2026-08-19', total: 1200, estatus: 'Entregada', metodo_pago: 'Efectivo', cliente_nombre: 'Abarrotes López' },
    lineas: [
      { sku: 'HC-5K', cantidad: 20, precio_unit: 30, subtotal: 600 },
      { sku: 'HC-25K', cantidad: 6, precio_unit: 100, subtotal: 600 },
    ],
    cliente: { nombre: 'Abarrotes López' },
    letras: 'MIL DOSCIENTOS PESOS 00/100 M.N.',
  };

  it('incluye folio, cliente, partidas, total, letras y membrete', () => {
    const html = buildNotaHtml(base);
    expect(html).toContain('OV-0047');
    expect(html).toContain('N-0012');
    expect(html).toContain('Abarrotes López');
    expect(html).toContain('HC-5K');
    expect(html).toContain('HC-25K');
    expect(html).toContain('1,200');
    expect(html).toContain('MIL DOSCIENTOS PESOS 00/100 M.N.');
    expect(html).toContain('Cubo Polar S.A. de C.V.');
    expect(html).toContain('CPO000000XX0');
    expect(html).toContain('no es comprobante fiscal');
    expect(html).toContain('noindex');
  });

  it('escapa HTML en datos del cliente (sin XSS en la página pública)', () => {
    const html = buildNotaHtml({
      ...base,
      cliente: { nombre: '<script>alert(1)</script>' },
      orden: { ...base.orden, folio: 'OV-<img src=x>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('estatus Entregada/Facturada marcan la nota como pagada', () => {
    expect(buildNotaHtml(base)).toContain('✓ Entregada');
    const pendiente = buildNotaHtml({ ...base, orden: { ...base.orden, estatus: 'Asignada' } });
    expect(pendiente).toContain('estado pendiente');
    expect(pendiente).toContain('Asignada');
  });

  it('tolera datos faltantes (sin líneas, sin cliente, sin empresa)', () => {
    const html = buildNotaHtml({ orden: { id: 9, total: 0 }, lineas: [], cliente: null, empresa: null, letras: '' });
    expect(html).toContain('Sin partidas');
    expect(html).toContain('Público en general');
    expect(html).toContain('#9');
  });
});
