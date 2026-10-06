// ol03bCfdiOperacion.test.js — OL-03B: frontera con el proveedor (clasificación,
// tiempo límite) y flujo reserva → proveedor → finalización en las Netlify
// Functions, con proveedor FALSO y el doble en memoria de los contratos 111.
// La semántica real de la base (bloqueos, índice único, guarda 112) se prueba
// en Postgres: suites 111/112 y la integración de handlers del runner local.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHandler as crearTimbrado } from '../../netlify/functions/billing-create-invoice/index.js';
import { createHandler as crearCancelacion } from '../../netlify/functions/billing-cancel-invoice/index.js';
import {
  clasificarEmision, clasificarCancelacion, llamarProveedor, huellaPayload, uuidDeRespuesta, respuestaReservaRechazada,
} from '../../netlify/functions/_lib/cfdiOperacion.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';
import { makeCfdiRpc } from './helpers/fakeCfdiRpc.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const usuarios = [
  { id: 1, nombre: 'Admin', email: 'a@t', rol: 'Admin', estatus: 'Activo', auth_id: 'uid-admin' },
  { id: 2, nombre: 'Fact', email: 'f@t', rol: 'Facturación', estatus: 'Activo', auth_id: 'uid-fact' },
  { id: 5, nombre: 'Ventas A', email: 'va@t', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-va' },
  { id: 6, nombre: 'Ventas B', email: 'vb@t', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-vb' },
];
const tokens = { 'jwt-admin': { id: 'uid-admin' }, 'jwt-fact': { id: 'uid-fact' }, 'jwt-va': { id: 'uid-va' }, 'jwt-vb': { id: 'uid-vb' } };
const ORDEN = (o = {}) => ({ id: 900, folio: 'OV-0900', cliente_id: 32, cliente_nombre: 'C', productos: 'x', total: 350, metodo_pago: 'Efectivo',
  estatus: 'Entregada', vendedor_id: 5, ruta_id: null, facturama_id: null, facturama_uuid: null, facturama_folio: null, cfdi_cancelado_at: null, ...o });
const FACT = (o = {}) => ORDEN({ estatus: 'Facturada', facturama_id: 'FM-1', facturama_uuid: 'UUID-1', ...o });
const seed = (orden) => ({ usuarios, ordenes: [orden], invoice_attempts: [], cfdi_operaciones: [],
  orden_lineas: [{ orden_id: 900, sku: 'HPC-5K', cantidad: 10, precio_unit: 35, subtotal: 350 }],
  clientes: [{ id: 32, nombre: 'C SA', rfc: 'AAA010101AAA', regimen: '601', uso_cfdi: 'G03', cp: '34000', correo: '' }],
  productos: [{ sku: 'HPC-5K', nombre: 'Hielo', clave_prod_serv: '50202302', clave_unidad: 'H87' }], configuracion_empresa: [{ id: 1, codigo_postal: '34186' }] });

// Proveedor falso guionizado: cada llamada consume la siguiente respuesta.
function proveedor(guion) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    const paso = guion[Math.min(calls.length - 1, guion.length - 1)];
    if (paso === 'colgado') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    if (paso === 'red') throw new Error('ECONNRESET');
    const [status, raw] = paso;
    return { ok: status >= 200 && status < 300, status, json: async () => raw };
  };
  return { calls, fetchImpl, getConfig: () => ({ username: 'stub', password: 'stub', baseUrl: 'https://facturama.invalid' }) };
}
const OK_EMISION = (n = 1) => [201, { Id: 'FM-N' + n, Folio: 'F' + n, Uuid: 'UUID-N' + n }];
const montar = (orden, guion, opts = {}) => {
  const fake = makeFakeSupabase(seed(orden), { tokens, rpcImpl: makeCfdiRpc(opts.rpc) });
  const prov = proveedor(guion);
  const deps = { getSupabase: () => fake, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig, timeoutMs: opts.timeoutMs || 200, leaseSegundos: 120 };
  return { fake, prov, timbrar: crearTimbrado(deps), cancelar: crearCancelacion(deps) };
};
const ev = (who, body) => ({ httpMethod: 'POST', headers: { authorization: `Bearer jwt-${who}` }, body: JSON.stringify(body) });
const leer = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
const ops = (fake) => fake.db.cfdi_operaciones.map(o => `${o.tipo}${o.generacion}:${o.estado}`);

let fetchReal;
beforeEach(() => { fetchReal = globalThis.fetch; globalThis.fetch = () => { throw new Error('red real prohibida en OL-03B'); }; });
afterEach(() => { globalThis.fetch = fetchReal; });

describe('OL-03B clasificación del proveedor (puro)', () => {
  it('emisión: 2xx con Id y UUID = emitida; UUID también en Complement.TaxStamp', () => {
    expect(clasificarEmision({ respondio: true, ok: true, status: 201, raw: { Id: 'A', Uuid: 'U', Folio: '7' } }))
      .toEqual({ resultado: 'emitida', datos: { proveedor_id: 'A', cfdi_uuid: 'U', folio: '7' } });
    expect(uuidDeRespuesta({ Complement: { TaxStamp: { Uuid: 'U2' } } })).toBe('U2');
    expect(clasificarEmision({ respondio: true, ok: true, status: 200, raw: { Id: 'A', Complement: { TaxStamp: { Uuid: 'U2' } } } }).resultado).toBe('emitida');
  });
  it('emisión: 2xx sin Id o sin UUID = incierta (no se puede excluir que se timbró); conserva el Id', () => {
    const r = clasificarEmision({ respondio: true, ok: true, status: 201, raw: { Id: 'A' } });
    expect(r.resultado).toBe('incierta');
    expect(r.datos.proveedor_id).toBe('A');
    expect(clasificarEmision({ respondio: true, ok: true, status: 201, raw: null }).resultado).toBe('incierta');
  });
  it('emisión: rechazo definitivo solo con 400/401/403/404/405/415/422; 408/409/429/5xx/red/timeout = incierta', () => {
    for (const s of [400, 401, 403, 404, 405, 415, 422]) expect(clasificarEmision({ respondio: true, ok: false, status: s, raw: {} }).resultado).toBe('fallida');
    for (const s of [408, 409, 429, 500, 502, 503, 504]) expect(clasificarEmision({ respondio: true, ok: false, status: s, raw: {} }).resultado).toBe('incierta');
    expect(clasificarEmision({ respondio: false, error: 'timeout' }).resultado).toBe('incierta');
  });
  it('cancelación: el estatus manda (canceled / requested / rejected); 200 sin estatus = incierta; 404 = incierta', () => {
    const c = (status, raw) => clasificarCancelacion({ respondio: true, ok: status < 300, status, raw }).resultado;
    expect(c(200, { Status: 'canceled' })).toBe('cancelada');
    expect(c(200, { status: 'Cancelled' })).toBe('cancelada');
    expect(c(200, { Status: 'requested' })).toBe('cancelacion_solicitada');
    expect(c(200, { Status: 'rejected' })).toBe('cancelacion_rechazada');
    expect(c(200, {})).toBe('incierta');
    expect(c(200, { Status: 'active' })).toBe('incierta');
    expect(c(404, {})).toBe('incierta');
    expect(c(400, {})).toBe('fallida');
    expect(c(503, {})).toBe('incierta');
    expect(clasificarCancelacion({ respondio: false, error: 'x' }).resultado).toBe('incierta');
  });
  it('llamarProveedor: tiempo límite → sin respuesta (nunca lanza); huella estable', async () => {
    const r = await llamarProveedor((u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))), 'https://x.invalid', {}, 30);
    expect(r).toMatchObject({ respondio: false });
    expect(await llamarProveedor(async () => { throw new Error('ECONNRESET'); }, 'u', {}, 100)).toMatchObject({ respondio: false, error: 'ECONNRESET' });
    expect(huellaPayload({ a: 1 })).toBe(huellaPayload({ a: 1 }));
    expect(huellaPayload({ a: 1 })).not.toBe(huellaPayload({ a: 2 }));
  });
  it('códigos de reserva rechazada', () => {
    expect(respuestaReservaRechazada({ codigo: 'OPERACION_INCIERTA' })).toMatchObject({ status: 409, body: { code: 'OPERACION_INCIERTA' } });
    expect(respuestaReservaRechazada({ codigo: 'ESTATUS_NO_FACTURABLE' })).toMatchObject({ status: 409, body: { code: 'ESTATUS_NO_FACTURABLE' } });
  });
});

describe('OL-03B timbrado: reserva → proveedor → finalización', () => {
  it('se reserva con la huella del CFDI del servidor y el actor; luego se finaliza', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), [OK_EMISION()]);
    expect(leer(await timbrar(ev('va', { ordenId: 900 }))).status).toBe(200);
    const res = fake.rpcs.find(r => r.name === 'reservar_operacion_cfdi').args;
    expect(res).toMatchObject({ p_orden_id: 900, p_tipo: 'emision', p_actor_id: 5, p_lease_segundos: 120, p_payload_hash: huellaPayload(prov.calls[0].body) });
    expect(fake.rpcs.map(r => r.name)).toEqual(['reservar_operacion_cfdi', 'finalizar_operacion_cfdi']);
    expect(ops(fake)).toEqual(['emision1:exitosa']);
  });
  it('rechazo definitivo (400) → 422; operación fallida; un reintento posterior SÍ puede timbrar (nueva operación)', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), [[400, { Message: 'Receptor inválido' }], OK_EMISION()]);
    const r = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r).toMatchObject({ status: 422, body: { code: 'PROVEEDOR_RECHAZO' } });
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls).toHaveLength(2);
    expect(ops(fake)).toEqual(['emision1:fallida', 'emision1:exitosa']);
  });
  it('RFC rechazado → un segundo intento como público general DENTRO de la misma operación', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), [[400, { Message: 'El RFC del receptor no es válido' }], OK_EMISION()]);
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls).toHaveLength(2);
    expect(prov.calls[1].body.Receiver.Rfc).toBe('XAXX010101000');
    expect(ops(fake)).toEqual(['emision1:exitosa']);
  });
  it('timeout → 502 RESULTADO_INCIERTO; operación incierta; un reintento NO llama al proveedor', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), ['colgado'], { timeoutMs: 30 });
    const r = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r).toMatchObject({ status: 502, body: { code: 'RESULTADO_INCIERTO' } });
    expect(ops(fake)).toEqual(['emision1:incierta']);
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
    const r2 = leer(await timbrar(ev('fact', { ordenId: 900 })));
    expect(r2).toMatchObject({ status: 409, body: { code: 'OPERACION_INCIERTA' } });
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.invoice_attempts.map(a => a.status)).toEqual(['uncertain']);
  });
  it('error de red, 5xx y 2xx sin UUID → incierta (bloquea), nunca fallida', async () => {
    for (const paso of ['red', [503, {}], [201, { Id: 'FM-X' }]]) {
      const { fake, prov, timbrar } = montar(ORDEN(), [paso]);
      expect(leer(await timbrar(ev('admin', { ordenId: 900 })))).toMatchObject({ status: 502, body: { code: 'RESULTADO_INCIERTO' } });
      expect(ops(fake)).toEqual(['emision1:incierta']);
      expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).body.code).toBe('OPERACION_INCIERTA');
      expect(prov.calls).toHaveLength(1);
    }
  });
  it('caída antes del proveedor: reserva sin finalizar; al vencer el lease la siguiente solicitud ve INCIERTA y no llama', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), [OK_EMISION()]);
    await makeCfdiRpc().reservar_operacion_cfdi({ p_orden_id: 900, p_tipo: 'emision', p_actor_id: 1, p_payload_hash: 'h' }, fake.db);
    fake.db.cfdi_operaciones[0].lease_hasta = Date.now() - 1;
    expect(leer(await timbrar(ev('admin', { ordenId: 900 })))).toMatchObject({ status: 409, body: { code: 'OPERACION_INCIERTA' } });
    expect(prov.calls).toHaveLength(0);
  });
  it('la reserva falla (base caída) → 500 SIN llamar al proveedor', async () => {
    const fake = makeFakeSupabase(seed(ORDEN()), { tokens, rpcImpl: { reservar_operacion_cfdi: () => ({ data: null, error: { message: 'down' } }) } });
    const prov = proveedor([OK_EMISION()]);
    const h = crearTimbrado({ getSupabase: () => fake, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig });
    expect(leer(await h(ev('admin', { ordenId: 900 }))).status).toBe(500);
    expect(prov.calls).toHaveLength(0);
  });
  it('la base revalida: una orden que dejó de ser Entregada entre la lectura y la reserva → 409 sin proveedor', async () => {
    const { fake, prov, timbrar } = montar(ORDEN(), [OK_EMISION()]);
    const rpc = fake.rpc;
    const conCambio = { ...fake, rpc: async (n, a) => { if (n === 'reservar_operacion_cfdi') fake.db.ordenes[0].estatus = 'Cancelada'; return rpc(n, a); } };
    const h = crearTimbrado({ getSupabase: () => conCambio, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig });
    expect(leer(await h(ev('admin', { ordenId: 900 })))).toMatchObject({ status: 409, body: { code: 'ESTATUS_NO_FACTURABLE' } });
    expect(prov.calls).toHaveLength(0);
    expect(timbrar).toBeTypeOf('function');
  });
  it('Ventas sobre la orden de otro vendedor: 403 antes de reservar (cero contratos, cero proveedor)', async () => {
    const { fake, prov, timbrar } = montar(ORDEN({ vendedor_id: 6 }), [OK_EMISION()]);
    expect(leer(await timbrar(ev('va', { ordenId: 900 }))).status).toBe(403);
    expect(fake.rpcs).toEqual([]);
    expect(prov.calls).toHaveLength(0);
  });
});

describe('OL-03B cancelación', () => {
  it('canceled → 200; la orden vuelve a Entregada por el contrato', async () => {
    const { fake, prov, cancelar } = montar(FACT(), [[200, { Status: 'canceled' }]]);
    expect(leer(await cancelar(ev('va', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 200, body: { cancelled: true } });
    expect(prov.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://facturama.invalid/3/cfdis/FM-1?type=issued&motive=02' });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Entregada', cfdi_cancelado_motivo: '02', cfdi_cancelado_por: 'Ventas A' });
    expect(ops(fake)).toEqual(['cancelacion1:exitosa']);
  });
  it('requested → 202 pendiente; la orden SIGUE Facturada; otra cancelación → 202 sin proveedor; timbrar → ya timbrada', async () => {
    const { fake, prov, cancelar, timbrar } = montar(FACT(), [[200, { Status: 'requested' }]]);
    expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 202, body: { pending: true, code: 'CANCELACION_SOLICITADA' } });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', cfdi_cancelado_at: null });
    expect(leer(await cancelar(ev('fact', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 202, body: { pending: true, code: 'CANCELACION_PENDIENTE' } });
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).body.alreadyInvoiced).toBe(true);
    expect(prov.calls).toHaveLength(1);
    expect(ops(fake)).toEqual(['cancelacion1:cancelacion_pendiente']);
  });
  it('rejected → 409 CANCELACION_RECHAZADA; la orden sigue Facturada; operación fallida', async () => {
    const { fake, cancelar } = montar(FACT(), [[200, { Status: 'rejected' }]]);
    expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 409, body: { code: 'CANCELACION_RECHAZADA' } });
    expect(fake.db.ordenes[0].estatus).toBe('Facturada');
    expect(ops(fake)).toEqual(['cancelacion1:fallida']);
  });
  it('200 sin estatus, 404, 5xx o timeout → incierta; la orden sigue Facturada; reintento sin proveedor', async () => {
    for (const paso of [[200, {}], [404, {}], [500, {}], 'colgado']) {
      const { fake, prov, cancelar } = montar(FACT(), [paso], { timeoutMs: 30 });
      expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 502, body: { code: 'RESULTADO_INCIERTO' } });
      expect(fake.db.ordenes[0].estatus).toBe('Facturada');
      expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' }))).body.code).toBe('OPERACION_INCIERTA');
      expect(prov.calls).toHaveLength(1);
    }
  });
  it('dos cancelaciones simultáneas → UNA sola llamada al proveedor', async () => {
    const { prov, cancelar, fake } = montar(FACT(), [[200, { Status: 'canceled' }]]);
    const rs = (await Promise.all([cancelar(ev('admin', { ordenId: 900, motivo: '02' })), cancelar(ev('fact', { ordenId: 900, motivo: '02' }))])).map(leer);
    expect(prov.calls).toHaveLength(1);
    expect(rs.filter(r => r.status === 200 && r.body.cancelled)).toHaveLength(1);
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
  });
  it('emisión y cancelación de la misma orden a la vez: la reserva única las serializa (una sola llamada)', async () => {
    const { prov, cancelar, timbrar, fake } = montar(FACT({ estatus: 'Facturada' }), [[200, { Status: 'canceled' }], OK_EMISION(2)]);
    const rs = (await Promise.all([cancelar(ev('admin', { ordenId: 900, motivo: '02' })), timbrar(ev('fact', { ordenId: 900 }))])).map(leer);
    expect(prov.calls).toHaveLength(1);
    expect(rs[0].body.cancelled).toBe(true);
    expect(rs[1].body.alreadyInvoiced || rs[1].body.code === 'OPERACION_EN_CURSO').toBe(true);
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
  });
  it('re-facturación: gen 1 timbrado → cancelación confirmada → gen 2 timbrado', async () => {
    const { prov, cancelar, timbrar, fake } = montar(ORDEN(), [OK_EMISION(1), [200, { Status: 'canceled' }], OK_EMISION(2)]);
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).status).toBe(200);
    expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' }))).status).toBe(200);
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls.map(c => c.method)).toEqual(['POST', 'DELETE', 'POST']);
    expect(ops(fake)).toEqual(['emision1:exitosa', 'cancelacion1:exitosa', 'emision2:exitosa']);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', facturama_uuid: 'UUID-N2', cfdi_cancelado_at: null });
  });
});

describe('OL-03B frontend: una cancelación solicitada no se anuncia como cancelada', () => {
  it('cancelarCFDI distingue la respuesta pendiente', () => {
    const store = src('../data/supaStore.js');
    const bloque = store.slice(store.indexOf('cancelarCFDI: async'), store.indexOf('reintentarComplemento: async'));
    expect(bloque).toMatch(/if \(resp\?\.pending\) \{[\s\S]*?Cancelación solicitada al SAT; el CFDI sigue vigente hasta que se confirme[\s\S]*?return undefined;\s*\}/);
    expect(bloque.indexOf('resp?.pending')).toBeLessThan(bloque.indexOf('CFDI cancelado (motivo'));
  });
});
