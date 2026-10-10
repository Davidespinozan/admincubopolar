// facturaDocumento.test.js — enviar por correo y ver / descargar la factura
// oficial (PDF y XML) de un CFDI ya timbrado. Reglas puras, los dos handlers
// con un proveedor simulado, y las garantías de pantalla y store.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatoValido, mimeDeFormato, normalizarEmail, emailValido, resolverEmailDestino, precondicionDocumento, nombreArchivoCfdi,
  urlEnvioCfdi, urlDescargaCfdi, envioExitoso, contenidoDescarga, mensajeProveedor,
} from '../../netlify/functions/_lib/cfdiDocumento.js';
import { createHandler as crearEnvio } from '../../netlify/functions/billing-send-invoice/index.js';
import { createHandler as crearDescarga } from '../../netlify/functions/billing-download-invoice/index.js';
import { base64ABlob, correoFacturaValido, mensajeErrorDocumento } from '../data/cfdiDocumentoLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('CFDI timbrado: reglas', () => {
  it('formatos, correo y nombre de archivo', () => {
    expect([formatoValido('pdf'), formatoValido('XML'), formatoValido('html'), formatoValido('')]).toEqual([true, true, false, false]);
    expect([mimeDeFormato('pdf'), mimeDeFormato('xml')]).toEqual(['application/pdf', 'application/xml']);
    expect(normalizarEmail('  Compras@Cliente.MX ')).toBe('compras@cliente.mx');
    expect(['a@b.mx', 'a@b', 'a b@c.mx', 'a@b.mx,c@d.mx', ''].map(emailValido)).toEqual([true, false, false, false, false]);
    expect(nombreArchivoCfdi({ facturama_folio: 'A 123/9', folio: 'OV-1' }, 'PDF')).toBe('Factura-A-123-9.pdf');
    expect(nombreArchivoCfdi({ folio: 'OV-0101' }, 'xml')).toBe('Factura-OV-0101.xml');
  });

  it('correo de destino: el escrito manda; si no, el del cliente; sin ninguno se pide', () => {
    expect(resolverEmailDestino(' Otro@X.com ', 'cliente@x.com')).toEqual({ ok: true, email: 'otro@x.com' });
    expect(resolverEmailDestino('', 'Cliente@X.com')).toEqual({ ok: true, email: 'cliente@x.com' });
    expect(resolverEmailDestino('mal', 'cliente@x.com')).toMatchObject({ ok: false, status: 422, code: 'EMAIL_INVALIDO' });
    expect(resolverEmailDestino(null, null)).toMatchObject({ ok: false, status: 422, code: 'EMAIL_FALTANTE' });
    expect(resolverEmailDestino('', 'sin-arroba')).toMatchObject({ ok: false, code: 'EMAIL_INVALIDO' });
  });

  it('precondición: sin CFDI no hay documento; uno cancelado se descarga pero no se envía', () => {
    expect(precondicionDocumento({ id: 1 })).toMatchObject({ ok: false, status: 409, code: 'SIN_CFDI' });
    const cancelado = { id: 1, facturama_id: 'abc', cfdi_cancelado_at: '2026-10-01' };
    expect(precondicionDocumento(cancelado)).toEqual({ ok: true });
    expect(precondicionDocumento(cancelado, { paraEnviar: true })).toMatchObject({ ok: false, code: 'CFDI_CANCELADO' });
    expect(precondicionDocumento(null)).toMatchObject({ ok: false, status: 400 });
  });

  it('URLs del proveedor y lectura de su respuesta (un 200 no basta)', () => {
    expect(urlEnvioCfdi('https://api.x/', 'ID 1', 'a+b@c.mx')).toBe('https://api.x/api/Cfdi?cfdiType=issued&cfdiId=ID+1&email=a%2Bb%40c.mx');
    expect(urlDescargaCfdi('https://api.x', 'ID/1', 'PDF')).toBe('https://api.x/api/Cfdi/pdf/issued/ID%2F1');
    expect(envioExitoso({ respondio: true, status: 200, raw: { success: true } })).toBe(true);
    expect([{ respondio: true, status: 200, raw: { success: false } }, { respondio: true, status: 200, raw: {} }, { respondio: true, status: 500, raw: { success: true } }, { respondio: false }].map(envioExitoso)).toEqual([false, false, false, false]);
    expect(contenidoDescarga({ respondio: true, ok: true, raw: { Content: 'QUJD\nRA==' } })).toBe('QUJDRA==');
    expect([{ respondio: true, ok: true, raw: {} }, { respondio: true, ok: false, raw: { Content: 'QUJD' } }, { respondio: true, ok: true, raw: { Content: '<html>' } }, { respondio: false }].map(contenidoDescarga)).toEqual([null, null, null, null]);
    expect(mensajeProveedor({ respondio: false }, 'x')).toMatch(/no respondió/);
    expect(mensajeProveedor({ respondio: true, raw: { Message: ' Correo rechazado ' } }, 'x')).toBe('Correo rechazado');
    expect(mensajeProveedor({ respondio: true, raw: null }, 'por omisión')).toBe('por omisión');
  });
});

// ── Handlers con base en memoria y proveedor FALSO (nada sale a la red) ──
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const usuarios = [
  { id: 1, nombre: 'Admin', email: 'a@t', rol: 'Admin', estatus: 'Activo', auth_id: 'uid-admin' },
  { id: 5, nombre: 'Vendedor A', email: 'va@t', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-va' },
  { id: 6, nombre: 'Vendedor B', email: 'vb@t', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-vb' },
  { id: 9, nombre: 'Chofer', email: 'c@t', rol: 'Chofer', estatus: 'Activo', auth_id: 'uid-chofer' },
];
const tokens = { 'jwt-admin': { id: 'uid-admin' }, 'jwt-va': { id: 'uid-va' }, 'jwt-vb': { id: 'uid-vb' }, 'jwt-chofer': { id: 'uid-chofer' } };
const semilla = () => ({
  usuarios,
  ordenes: [
    { id: 1, folio: 'OV-1', cliente_id: 9, vendedor_id: 5, estatus: 'Facturada', facturama_id: 'F1', facturama_uuid: 'U1', facturama_folio: '101', cfdi_cancelado_at: null },
    { id: 2, folio: 'OV-2', cliente_id: 9, vendedor_id: 5, estatus: 'Entregada', facturama_id: null, facturama_uuid: null, facturama_folio: null, cfdi_cancelado_at: null },
    { id: 3, folio: 'OV-3', cliente_id: 8, vendedor_id: 5, estatus: 'Entregada', facturama_id: 'F3', facturama_uuid: 'U3', facturama_folio: '103', cfdi_cancelado_at: '2026-10-01T00:00:00Z' },
  ],
  clientes: [{ id: 9, nombre: 'Cliente', correo: 'Cliente@Correo.mx' }, { id: 8, nombre: 'Sin correo', correo: '' }],
  invoice_attempts: [],
});
function montar(respuesta) {
  const fake = makeFakeSupabase(semilla(), { tokens });
  const llamadas = [];
  const deps = {
    getSupabase: () => fake,
    getConfig: () => ({ baseUrl: 'https://facturama.invalid', username: 'usuario-x', password: 'clave-secreta' }),
    fetchImpl: async (url, init) => { llamadas.push({ url: String(url), method: init?.method, auth: init?.headers?.authorization });
      const r = respuesta || { status: 200, body: { success: true, Content: 'QUJD' } };
      if (r.lanza) throw new Error('red caída');
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body }; },
    timeoutMs: 300,
  };
  return { fake, llamadas, enviar: crearEnvio(deps), bajar: crearDescarga(deps) };
}
const ev = (quien, body) => ({ httpMethod: 'POST', headers: quien ? { authorization: `Bearer jwt-${quien}` } : {}, body: JSON.stringify(body) });
const leer = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });

describe('Enviar la factura por correo', () => {
  it('Admin: se envía al correo del cliente, una sola llamada, y queda en la bitácora sin credenciales', async () => {
    const m = montar();
    const r = leer(await m.enviar(ev('admin', { ordenId: 1 })));
    expect(r).toEqual({ status: 200, body: { sent: true, email: 'cliente@correo.mx', ordenId: 1, folio: 'OV-1' } });
    expect(m.llamadas).toHaveLength(1);
    expect(m.llamadas[0]).toMatchObject({ method: 'POST', url: 'https://facturama.invalid/api/Cfdi?cfdiType=issued&cfdiId=F1&email=cliente%40correo.mx' });
    const bit = m.fake.db.invoice_attempts;
    expect(bit).toHaveLength(1);
    expect(bit[0]).toMatchObject({ orden_id: 1, provider: 'facturama-email', status: 'sent' });
    expect(JSON.stringify(bit[0])).not.toMatch(/clave-secreta|usuario-x/);
    expect(m.fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', facturama_uuid: 'U1' });   // la orden no cambia
  });

  it('el correo escrito por el operador manda sobre el del cliente', async () => {
    const m = montar();
    expect(leer(await m.enviar(ev('admin', { ordenId: 1, email: ' Compras@Otro.com ' }))).body.email).toBe('compras@otro.com');
    expect(m.llamadas[0].url).toMatch(/email=compras%40otro\.com$/);
  });

  it('Ventas: su orden sí; la de otro vendedor no; Chofer nunca. Sin llamar al proveedor', async () => {
    const m = montar();
    expect(leer(await m.enviar(ev('va', { ordenId: 1 }))).status).toBe(200);
    expect(leer(await m.enviar(ev('vb', { ordenId: 1 }))).status).toBe(403);
    expect(leer(await m.enviar(ev('chofer', { ordenId: 1 }))).status).toBe(403);
    expect(leer(await m.enviar(ev(null, { ordenId: 1 }))).status).toBe(401);
    expect(m.llamadas).toHaveLength(1);
  });

  it('sin factura, factura cancelada, sin correo o correo inválido: rechazo ANTES del proveedor', async () => {
    const m = montar();
    expect(leer(await m.enviar(ev('admin', { ordenId: 2 }))).body.code).toBe('SIN_CFDI');
    expect(leer(await m.enviar(ev('admin', { ordenId: 3, email: 'a@b.mx' }))).body.code).toBe('CFDI_CANCELADO');
    expect(leer(await m.enviar(ev('admin', { ordenId: 1, email: 'no-es-correo' }))).body.code).toBe('EMAIL_INVALIDO');
    expect(leer(await m.enviar(ev('admin', { ordenId: 999 }))).status).toBe(400);
    expect(leer(await m.enviar(ev('admin', {}))).status).toBe(400);
    expect(m.llamadas).toHaveLength(0);
    expect(m.fake.db.invoice_attempts).toHaveLength(0);
  });

  it('un 200 sin success, un error o la red caída NO cuentan como enviado', async () => {
    for (const resp of [{ status: 200, body: { success: false, msj: 'Correo rechazado' } }, { status: 500, body: { Message: 'Falla interna' } }, { lanza: true }]) {
      const m = montar(resp);
      const r = leer(await m.enviar(ev('admin', { ordenId: 1 })));
      expect(r.status).toBe(502);
      expect(r.body.sent).toBeUndefined();
      expect(m.fake.db.invoice_attempts[0]).toMatchObject({ provider: 'facturama-email', status: 'error' });
    }
    expect(leer(await montar({ status: 200, body: { success: false, msj: 'Correo rechazado' } }).enviar(ev('admin', { ordenId: 1 }))).body.error).toBe('Correo rechazado');
  });
});

describe('Ver / descargar la factura oficial', () => {
  it('entrega el PDF y el XML con su nombre y tipo; también de una factura cancelada', async () => {
    const m = montar();
    expect(leer(await m.bajar(ev('admin', { ordenId: 1, formato: 'pdf' })))).toEqual({ status: 200, body: { filename: 'Factura-101.pdf', contentType: 'application/pdf', base64: 'QUJD' } });
    expect(leer(await m.bajar(ev('va', { ordenId: 1, formato: 'XML' }))).body).toMatchObject({ filename: 'Factura-101.xml', contentType: 'application/xml' });
    expect(leer(await m.bajar(ev('admin', { ordenId: 3, formato: 'pdf' }))).body.filename).toBe('Factura-103.pdf');
    expect(m.llamadas.map(l => `${l.method} ${l.url}`)).toEqual([
      'GET https://facturama.invalid/api/Cfdi/pdf/issued/F1', 'GET https://facturama.invalid/api/Cfdi/xml/issued/F1', 'GET https://facturama.invalid/api/Cfdi/pdf/issued/F3']);
    expect(m.fake.writes.filter(w => w.table !== 'invoice_attempts')).toEqual([]);   // no escribe nada
  });

  it('permisos, formato y factura inexistente: sin llamar al proveedor', async () => {
    const m = montar();
    expect(leer(await m.bajar(ev('vb', { ordenId: 1, formato: 'pdf' }))).status).toBe(403);
    expect(leer(await m.bajar(ev('chofer', { ordenId: 1, formato: 'pdf' }))).status).toBe(403);
    expect(leer(await m.bajar(ev('admin', { ordenId: 1, formato: 'html' }))).status).toBe(400);
    expect(leer(await m.bajar(ev('admin', { ordenId: 2, formato: 'pdf' }))).body.code).toBe('SIN_CFDI');
    expect(m.llamadas).toHaveLength(0);
  });

  it('el proveedor no entrega el documento: 404 o 502, nunca un archivo vacío', async () => {
    expect(leer(await montar({ status: 404, body: {} }).bajar(ev('admin', { ordenId: 1, formato: 'pdf' }))).status).toBe(404);
    expect(leer(await montar({ status: 200, body: {} }).bajar(ev('admin', { ordenId: 1, formato: 'pdf' }))).status).toBe(502);
    expect(leer(await montar({ lanza: true }).bajar(ev('admin', { ordenId: 1, formato: 'pdf' }))).status).toBe(502);
  });
});

describe('Funciones de Netlify: mismas reglas de permiso que timbrar y cancelar', () => {
  const envio = src('../../netlify/functions/billing-send-invoice/index.js');
  const descarga = src('../../netlify/functions/billing-download-invoice/index.js');

  it('autorizan antes de llamar al proveedor y exigen el CFDI', () => {
    for (const f of [envio, descarga]) {
      expect(f).toMatch(/if \(!rolPuedeFacturar\(auth\.profile\)\) return json\(403/);
      expect(f).toMatch(/const permiso = autorizarOrdenFacturacion\(auth\.profile, orden\);\s*if \(!permiso\.ok\) return json\(permiso\.status/);
      expect(f.indexOf('autorizarOrdenFacturacion(auth.profile, orden)')).toBeLessThan(f.indexOf('llamarProveedor(fetchImpl'));
      expect(f.indexOf('precondicionDocumento(orden')).toBeLessThan(f.indexOf('llamarProveedor(fetchImpl'));
      expect(f).toMatch(/if \(event\.httpMethod !== 'POST'\) return methodNotAllowed\(\['POST'\]\);/);
      expect(f).not.toMatch(/\.update\(|\.delete\(|rpc\(/);   // no cambian la orden ni el CFDI
    }
    expect(envio).toMatch(/precondicionDocumento\(orden, \{ paraEnviar: true \}\)/);
    expect(envio).toMatch(/provider: 'facturama-email'/);
    expect(envio).not.toMatch(/request_payload: \{[^}]*password/);
  });

});

describe('Pantalla y store', () => {
  it('convierte el documento y valida el correo antes de enviar', () => {
    const b = base64ABlob('QUJD', 'application/pdf');
    expect([b.type, b.size]).toEqual(['application/pdf', 3]);
    expect([base64ABlob('', 'x'), base64ABlob('<html>', 'x'), base64ABlob(null)]).toEqual([null, null, null]);
    expect(['a@b.mx', ' a@b.mx ', 'a@b', ''].map(correoFacturaValido)).toEqual([true, true, false, false]);
    expect(mensajeErrorDocumento({ status: 403 })).toMatch(/No tienes permiso/);
    expect(mensajeErrorDocumento({ status: 502, message: 'Correo rechazado' }, 'enviar la factura')).toBe('Correo rechazado');
    expect(mensajeErrorDocumento({}, 'enviar la factura')).toMatch(/No se pudo enviar la factura/);
  });

  it('Facturación ofrece Ver PDF, XML y Enviar por correo en cada factura timbrada', () => {
    const v = src('../components/views/FacturacionView.jsx');
    const store = src('../data/supaStore.js');
    expect(v).toMatch(/data-testid="factura-pdf"/);
    expect(v).toMatch(/data-testid="factura-xml"/);
    expect(v).toMatch(/\{!cancelado && \(\s*<button type="button" onClick=\{\(\) => abrirCorreo\(o\)\}/);   // una cancelada no se envía
    expect(v).toMatch(/disabled=\{!correoFacturaValido\(correo\)\}/);
    expect(store).toMatch(/backendPost\('billing-download-invoice', \{ ordenId, formato \}\)/);
    expect(store).toMatch(/backendPost\('billing-send-invoice', \{ ordenId, email: email \|\| null \}\)/);
  });
});
