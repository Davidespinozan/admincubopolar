// ol03aFacturacion.test.js — OL-03A: contención del timbrado y la cancelación
// de CFDI en el servidor. Todo con proveedor FALSO (fetchImpl inyectado) y
// base en memoria: ningún SAT/PAC/Stripe/Mercado Pago real. Un `fetch` global
// que lanza prueba que nada sale a la red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHandler as crearTimbrado } from '../../netlify/functions/billing-create-invoice/index.js';
import { createHandler as crearCancelacion } from '../../netlify/functions/billing-cancel-invoice/index.js';
import {
  autorizarOrdenFacturacion, precondicionTimbrado, precondicionCancelacion, validarCuerpoTimbrado, updateCondicionalOk, rolPuedeFacturar,
} from '../../netlify/functions/_lib/facturacionGuard.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const ROLES = { admin: 'Admin', fact: 'Facturación', va: 'Ventas', vb: 'Ventas', chofer: 'Chofer', prod: 'Producción', bolsas: 'Almacén Bolsas', sin: 'Sin asignar' };
const IDS = { admin: 1, fact: 2, va: 5, vb: 6, chofer: 9, prod: 3, bolsas: 4, sin: 7 };
const usuarios = Object.keys(ROLES).map(k => ({ id: IDS[k], nombre: 'U ' + k, email: k + '@t', rol: ROLES[k], estatus: 'Activo', auth_id: 'uid-' + k }));
const tokens = Object.fromEntries(Object.keys(ROLES).map(k => ['jwt-' + k, { id: 'uid-' + k, email: k + '@t' }]));

const ORDEN = (o = {}) => ({
  id: 900, folio: 'OV-0900', cliente_id: 32, cliente_nombre: 'CLIENTE', productos: '10x HPC-5K', total: 350,
  metodo_pago: 'Efectivo', estatus: 'Entregada', vendedor_id: IDS.va, ruta_id: null,
  facturama_id: null, facturama_uuid: null, facturama_folio: null, cfdi_cancelado_at: null, ...o,
});
const CFDI = { facturama_id: 'FM-1', facturama_uuid: 'UUID-VIGENTE', facturama_folio: 'A1' };
const seed = (orden, extra = {}) => ({
  usuarios,
  ordenes: [orden],
  orden_lineas: [{ orden_id: 900, sku: 'HPC-5K', cantidad: 10, precio_unit: 35, subtotal: 350 }],
  clientes: [{ id: 32, nombre: 'CLIENTE SA', rfc: 'XAXX010101000', regimen: '616', uso_cfdi: 'S01', cp: '34000', correo: '' }],
  productos: [{ sku: 'HPC-5K', nombre: 'Hielo 5kg', clave_prod_serv: '50202302', clave_unidad: 'H87' }],
  configuracion_empresa: [{ id: 1, codigo_postal: '34186' }],
  invoice_attempts: [],
  ...extra,
});

// Proveedor falso: registra la llamada y responde como Facturama (stub explícito).
function proveedorFalso({ antes } = {}) {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    if (antes) await antes(calls.length);
    n += 1;
    const raw = init?.method === 'DELETE' ? { Status: 'canceled' } : { Id: 'FM-NEW-' + n, Folio: 'F' + n, Uuid: 'UUID-STUB-' + n };
    return { ok: true, status: 200, json: async () => raw };
  };
  const getConfig = () => ({ username: 'stub', password: 'stub', baseUrl: 'https://facturama.invalid' });
  return { calls, fetchImpl, getConfig };
}

const ev = (who, body) => ({ httpMethod: 'POST', headers: who ? { authorization: `Bearer jwt-${who}` } : {}, body: JSON.stringify(body) });
const leer = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
const montar = (orden, extra, provOpts) => {
  const fake = makeFakeSupabase(seed(orden, extra), { tokens });
  const prov = proveedorFalso(provOpts);
  const deps = { getSupabase: () => fake, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig };
  return { fake, prov, timbrar: crearTimbrado(deps), cancelar: crearCancelacion(deps) };
};
const NEGOCIO = ['ordenes', 'pagos', 'cuentas_por_cobrar', 'movimientos_contables', 'inventario_mov', 'stock_operaciones', 'cuartos_frios', 'clientes', 'rutas', 'invoice_attempts'];
const sinEscrituras = (fake) => expect(fake.writes.filter(w => NEGOCIO.includes(w.table) || w.op === 'rpc')).toEqual([]);

let fetchReal;
beforeEach(() => { fetchReal = globalThis.fetch; globalThis.fetch = () => { throw new Error('red real prohibida en OL-03A'); }; });
afterEach(() => { globalThis.fetch = fetchReal; });

describe('OL-03A guard puro', () => {
  it('roles y dueño: Admin/Facturación empresa; Ventas solo la suya; sin vendedor no es de nadie', () => {
    const o = ORDEN();
    expect(autorizarOrdenFacturacion({ rol: 'Admin', id: 1 }, ORDEN({ vendedor_id: 6 })).ok).toBe(true);
    expect(autorizarOrdenFacturacion({ rol: 'Facturación', id: 2 }, ORDEN({ vendedor_id: null })).ok).toBe(true);
    expect(autorizarOrdenFacturacion({ rol: 'Ventas', id: 5 }, o).ok).toBe(true);
    expect(autorizarOrdenFacturacion({ rol: 'Ventas', id: '5' }, o).ok).toBe(true);
    expect(autorizarOrdenFacturacion({ rol: 'Ventas', id: 6 }, o)).toMatchObject({ ok: false, status: 403, code: 'ORDEN_AJENA' });
    expect(autorizarOrdenFacturacion({ rol: 'Ventas', id: 5 }, ORDEN({ vendedor_id: null })).code).toBe('ORDEN_AJENA');
    expect(autorizarOrdenFacturacion({ rol: 'Ventas', id: null }, o).code).toBe('ORDEN_AJENA');
    for (const rol of ['Chofer', 'Producción', 'Almacén Bolsas', 'Sin asignar', undefined]) {
      expect(rolPuedeFacturar({ rol })).toBe(false);
      expect(autorizarOrdenFacturacion({ rol, id: 5 }, o).code).toBe('ROL_NO_AUTORIZADO');
    }
  });
  it('timbrado: solo Entregada; CFDI vigente = idempotente; el resto 409', () => {
    expect(precondicionTimbrado(ORDEN())).toEqual({ ok: true, accion: 'timbrar' });
    expect(precondicionTimbrado(ORDEN({ estatus: 'Facturada', ...CFDI }))).toEqual({ ok: true, accion: 'ya_timbrada' });
    expect(precondicionTimbrado(ORDEN({ estatus: 'Entregada', ...CFDI, cfdi_cancelado_at: '2026-10-01T00:00:00Z' }))).toEqual({ ok: true, accion: 'timbrar' });
    for (const e of ['Creada', 'Asignada', 'En ruta', 'No entregada', 'Cancelada', 'Facturada', '', null]) {
      expect(precondicionTimbrado(ORDEN({ estatus: e }))).toMatchObject({ ok: false, status: 409, code: 'ESTATUS_NO_FACTURABLE' });
    }
  });
  it('cancelación: solo Facturada con CFDI vigente', () => {
    expect(precondicionCancelacion(ORDEN({ estatus: 'Facturada', ...CFDI }))).toEqual({ ok: true, accion: 'cancelar' });
    expect(precondicionCancelacion(ORDEN({ estatus: 'Facturada' }))).toMatchObject({ ok: false, status: 400, code: 'SIN_CFDI' });
    expect(precondicionCancelacion(ORDEN({ estatus: 'Entregada', ...CFDI, cfdi_cancelado_at: 'x' }))).toEqual({ ok: true, accion: 'ya_cancelada' });
    for (const e of ['Creada', 'Asignada', 'En ruta', 'Entregada', 'No entregada', 'Cancelada']) {
      expect(precondicionCancelacion(ORDEN({ estatus: e, ...CFDI }))).toMatchObject({ ok: false, status: 409, code: 'ESTATUS_NO_CANCELABLE' });
    }
  });
  it('cuerpo: un CFDI armado por el cliente se rechaza; ordenId o folio', () => {
    expect(validarCuerpoTimbrado({ ordenId: 1, facturamaPayload: {} }).code).toBe('PAYLOAD_NO_PERMITIDO');
    expect(validarCuerpoTimbrado({ folio: 'OV-1', facturamaPayload: null }).code).toBe('PAYLOAD_NO_PERMITIDO');
    expect(validarCuerpoTimbrado({}).code).toBe('ORDEN_REQUERIDA');
    expect(validarCuerpoTimbrado({ folio: 'OV-1' })).toEqual({ ok: true, ordenId: null, folio: 'OV-1' });
  });
  it('update condicional: éxito solo si tocó exactamente la orden', () => {
    expect(updateCondicionalOk({ data: [{ id: 900 }], error: null }, 900)).toBe(true);
    expect(updateCondicionalOk({ data: [], error: null }, 900)).toBe(false);
    expect(updateCondicionalOk({ data: null, error: { message: 'x' } }, 900)).toBe(false);
    expect(updateCondicionalOk({ data: [{ id: 900 }, { id: 901 }], error: null }, 900)).toBe(false);
    expect(updateCondicionalOk(null, 900)).toBe(false);
  });
});

describe('OL-03A timbrado: matriz de estatus (antes del proveedor)', () => {
  const noFacturables = [
    ['A Creada sin ruta', { estatus: 'Creada' }],
    ['B Asignada sin ruta', { estatus: 'Asignada' }],
    ['C Asignada con ruta', { estatus: 'Asignada', ruta_id: 7 }],
    ['C En ruta', { estatus: 'En ruta', ruta_id: 7 }],
    ['No entregada', { estatus: 'No entregada', ruta_id: 7 }],
    ['D Cancelada', { estatus: 'Cancelada' }],
    ['Facturada sin CFDI vigente', { estatus: 'Facturada', ...CFDI, cfdi_cancelado_at: '2026-10-01T00:00:00Z' }],
  ];
  for (const who of ['admin', 'fact', 'va']) {
    for (const [nombre, o] of noFacturables) {
      it(`${who}: ${nombre} → 409, cero llamadas al proveedor, cero escrituras`, async () => {
        const { fake, prov, timbrar } = montar(ORDEN(o));
        const r = leer(await timbrar(ev(who, { ordenId: 900 })));
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('ESTATUS_NO_FACTURABLE');
        expect(prov.calls).toHaveLength(0);
        sinEscrituras(fake);
        expect(fake.db.ordenes[0]).toMatchObject({ estatus: o.estatus, ruta_id: o.ruta_id ?? null });
        expect(fake.db.ordenes[0].delivered_at).toBeUndefined();
      });
    }
  }
  it('Facturada con CFDI vigente → alreadyInvoiced (idempotencia existente), sin proveedor', async () => {
    const { fake, prov, timbrar } = montar(ORDEN({ estatus: 'Facturada', ...CFDI }));
    const r = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r).toMatchObject({ status: 200, body: { alreadyInvoiced: true, facturamaUuid: 'UUID-VIGENTE' } });
    expect(prov.calls).toHaveLength(0);
    sinEscrituras(fake);
  });
  it('Entregada → proveedor alcanzado una vez; orden Facturada con el CFDI; bitácora success', async () => {
    const { fake, prov, timbrar } = montar(ORDEN());
    const r = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r.status).toBe(200);
    expect(prov.calls).toHaveLength(1);
    expect(prov.calls[0]).toMatchObject({ method: 'POST', url: 'https://facturama.invalid/3/cfdis' });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', facturama_id: 'FM-NEW-1', facturama_uuid: 'UUID-STUB-1', cfdi_cancelado_at: null });
    expect(fake.db.invoice_attempts).toHaveLength(1);
    expect(fake.db.invoice_attempts[0]).toMatchObject({ orden_id: 900, status: 'success' });
    // Nada fuera de la orden y la bitácora: ni pagos, CxC, contabilidad, inventario ni rutas.
    expect(fake.writes.map(w => w.table).sort()).toEqual(['invoice_attempts', 'ordenes']);
  });
});

describe('OL-03A timbrado: autorización y dueño', () => {
  it('Ventas A timbra SU orden Entregada → proveedor alcanzado', async () => {
    const { prov, fake, timbrar } = montar(ORDEN({ vendedor_id: IDS.va }));
    expect(leer(await timbrar(ev('va', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.ordenes[0].estatus).toBe('Facturada');
  });
  it('E: Ventas A sobre la orden Entregada de Ventas B → 403 antes del proveedor (también por folio)', async () => {
    for (const body of [{ ordenId: 900 }, { folio: 'OV-0900' }]) {
      const { prov, fake, timbrar } = montar(ORDEN({ vendedor_id: IDS.vb }));
      const r = leer(await timbrar(ev('va', body)));
      expect(r).toMatchObject({ status: 403, body: { code: 'ORDEN_AJENA' } });
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
      expect(fake.db.ordenes[0].estatus).toBe('Entregada');
    }
  });
  it('Ventas A sobre la orden YA facturada de B → 403 (no revela el CFDI ajeno)', async () => {
    const { prov, timbrar } = montar(ORDEN({ vendedor_id: IDS.vb, estatus: 'Facturada', ...CFDI }));
    const r = leer(await timbrar(ev('va', { ordenId: 900 })));
    expect(r.status).toBe(403);
    expect(r.body.facturamaUuid).toBeUndefined();
    expect(prov.calls).toHaveLength(0);
  });
  it('Ventas sobre una orden sin vendedor → 403 (misma regla que 109)', async () => {
    const { prov, timbrar } = montar(ORDEN({ vendedor_id: null }));
    expect(leer(await timbrar(ev('va', { ordenId: 900 }))).status).toBe(403);
    expect(prov.calls).toHaveLength(0);
  });
  it('Admin y Facturación: toda la empresa (orden de B y orden sin vendedor)', async () => {
    for (const who of ['admin', 'fact']) {
      for (const vendedor of [IDS.vb, null]) {
        const { prov, fake, timbrar } = montar(ORDEN({ vendedor_id: vendedor }));
        expect(leer(await timbrar(ev(who, { ordenId: 900 }))).status).toBe(200);
        expect(prov.calls).toHaveLength(1);
        expect(fake.db.ordenes[0].estatus).toBe('Facturada');
      }
    }
  });
  it('otros roles → rechazados antes de leer la orden y del proveedor', async () => {
    for (const who of ['chofer', 'prod', 'bolsas', 'sin']) {
      const { prov, fake, timbrar } = montar(ORDEN());
      const r = leer(await timbrar(ev(who, { ordenId: 900 })));
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/rol no puede timbrar/);
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
    }
  });
  it('sin token / token inválido → 401, sin proveedor', async () => {
    for (const e of [ev(null, { ordenId: 900 }), { ...ev(null, { ordenId: 900 }), headers: { authorization: 'Bearer jwt-falso' } }]) {
      const { prov, timbrar } = montar(ORDEN());
      expect(leer(await timbrar(e)).status).toBe(401);
      expect(prov.calls).toHaveLength(0);
    }
  });
  it('sin configuración del servidor → 503 (falla cerrada), sin proveedor, en timbrado y cancelación', async () => {
    const prov = proveedorFalso();
    const deps = { getSupabase: () => { throw new Error('Missing required environment variable: SUPABASE_URL'); }, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig };
    for (const h of [crearTimbrado(deps), crearCancelacion(deps)]) {
      const r = leer(await h(ev('admin', { ordenId: 900, motivo: '02' })));
      expect(r).toMatchObject({ status: 503, body: { code: 'AUTH_NOT_CONFIGURED' } });
    }
    expect(prov.calls).toHaveLength(0);
  });
  it('orden inexistente → 400, sin proveedor', async () => {
    const { prov, timbrar } = montar(ORDEN());
    expect(leer(await timbrar(ev('admin', { ordenId: 12345 }))).status).toBe(400);
    expect(prov.calls).toHaveLength(0);
  });
});

describe('OL-03A timbrado: datos fiscales los deriva el servidor', () => {
  it('un facturamaPayload del cliente se rechaza (400) aun para Admin; cero proveedor', async () => {
    const { prov, fake, timbrar } = montar(ORDEN());
    const r = leer(await timbrar(ev('admin', { ordenId: 900, facturamaPayload: { Receiver: { Rfc: 'ZZZ' }, Items: [{ Total: 1 }] } })));
    expect(r).toMatchObject({ status: 400, body: { code: 'PAYLOAD_NO_PERMITIDO' } });
    expect(prov.calls).toHaveLength(0);
    sinEscrituras(fake);
  });
  it('el CFDI enviado sale de la orden, sus líneas, el cliente, el catálogo y la configuración', async () => {
    const { prov, timbrar } = montar(ORDEN());
    await timbrar(ev('admin', { ordenId: 900, folio: 'otro' }));
    const p = prov.calls[0].body;
    expect(p).toMatchObject({ CfdiType: 'I', PaymentForm: '01', PaymentMethod: 'PUE', Currency: 'MXN', ExpeditionPlace: '34186' });
    expect(p.Receiver.Rfc).toBe('XAXX010101000');
    expect(p.Items).toHaveLength(1);
    expect(p.Items[0]).toMatchObject({ ProductCode: '50202302', Quantity: 10, UnitPrice: 35, Total: 350 });
  });
});

describe('OL-03A crédito: entregada y sin pagar sigue siendo facturable', () => {
  it('Entregada a crédito con CxC pendiente y cero pagos → proveedor alcanzado como PPD/99', async () => {
    const { prov, fake, timbrar } = montar(ORDEN({ metodo_pago: 'Crédito (fiado)' }), {
      cuentas_por_cobrar: [{ id: 9, orden_id: 900, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
      pagos: [],
    });
    expect(leer(await timbrar(ev('va', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls).toHaveLength(1);
    expect(prov.calls[0].body).toMatchObject({ PaymentForm: '99', PaymentMethod: 'PPD' });
    expect(fake.db.cuentas_por_cobrar[0]).toMatchObject({ saldo_pendiente: 350, estatus: 'Pendiente' });
    expect(fake.db.pagos).toEqual([]);
  });
});

describe('OL-03A timbrado: escritura posterior al proveedor', () => {
  it('la orden cambió mientras se timbraba → 409, NO se pisa el estado nuevo, bitácora en revisión', async () => {
    let fakeRef;
    const { fake, prov, timbrar } = montar(ORDEN(), {}, { antes: () => { fakeRef.db.ordenes[0].estatus = 'Cancelada'; } });
    fakeRef = fake;
    const r = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r).toMatchObject({ status: 409, body: { code: 'ORDEN_CAMBIO_TRAS_TIMBRAR', facturamaUuid: 'UUID-STUB-1' } });
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Cancelada', facturama_uuid: null });
    expect(fake.db.invoice_attempts[0]).toMatchObject({ status: 'review:orden_no_actualizada' });
  });
  it('error de la base al actualizar → 409 (nunca éxito silencioso)', async () => {
    const { fake } = montar(ORDEN());
    const from = fake.from;
    const roto = { ...fake, from: (t) => { const b = from(t); if (t !== 'ordenes') return b; const upd = b.update; b.update = (p) => { upd(p); b.then = (res) => Promise.resolve({ data: null, error: { message: 'guarda rechazó' } }).then(res); return b; }; return b; } };
    const prov = proveedorFalso();
    const h = crearTimbrado({ getSupabase: () => roto, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig });
    const r = leer(await h(ev('admin', { ordenId: 900 })));
    expect(r.status).toBe(409);
    expect(r.body.details).toBe('guarda rechazó');
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
  });
  it('reintento tras el éxito → alreadyInvoiced; una sola llamada al proveedor', async () => {
    const { prov, timbrar } = montar(ORDEN());
    expect(leer(await timbrar(ev('admin', { ordenId: 900 }))).status).toBe(200);
    const r2 = leer(await timbrar(ev('admin', { ordenId: 900 })));
    expect(r2.body).toMatchObject({ alreadyInvoiced: true, facturamaUuid: 'UUID-STUB-1' });
    expect(prov.calls).toHaveLength(1);
  });
  it('dos solicitudes simultáneas: a lo más una gana; la otra NO pisa el CFDI ganador ni declara éxito', async () => {
    const { fake, prov, timbrar } = montar(ORDEN());
    const rs = (await Promise.all([timbrar(ev('admin', { ordenId: 900 })), timbrar(ev('fact', { ordenId: 900 }))])).map(leer);
    const exitos = rs.filter(r => r.status === 200 && !r.body.alreadyInvoiced);
    expect(exitos).toHaveLength(1);
    const ganador = exitos[0].body.invoice.Uuid;
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', facturama_uuid: ganador });
    // Sin candado previo al proveedor ambos pueden llegar a Facturama (residual
    // documentado); el perdedor responde 409 con el UUID para revisión.
    expect(prov.calls.length).toBeLessThanOrEqual(2);
    for (const r of rs.filter(x => x.status !== 200)) expect(r).toMatchObject({ status: 409, body: { code: 'ORDEN_CAMBIO_TRAS_TIMBRAR' } });
  });
  it('re-facturación de una orden Entregada con CFDI cancelado → nuevo CFDI vigente, anotaciones limpias', async () => {
    const { prov, fake, timbrar } = montar(ORDEN({ ...CFDI, cfdi_cancelado_at: '2026-10-01T00:00:00Z', cfdi_cancelado_motivo: '02' }));
    expect(leer(await timbrar(ev('fact', { ordenId: 900 }))).status).toBe(200);
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', facturama_uuid: 'UUID-STUB-1', cfdi_cancelado_at: null, cfdi_cancelado_motivo: null });
  });
});

describe('OL-03A cancelación', () => {
  const F = (o = {}) => ORDEN({ estatus: 'Facturada', ...CFDI, ...o });
  it('Admin y Facturación: Facturada con CFDI vigente → proveedor (DELETE) y Facturada → Entregada', async () => {
    for (const who of ['admin', 'fact']) {
      const { prov, fake, cancelar } = montar(F({ vendedor_id: IDS.vb }));
      const r = leer(await cancelar(ev(who, { ordenId: 900, motivo: '02' })));
      expect(r).toMatchObject({ status: 200, body: { cancelled: true } });
      expect(prov.calls).toHaveLength(1);
      expect(prov.calls[0].method).toBe('DELETE');
      expect(prov.calls[0].url).toContain('/3/cfdis/FM-1?type=issued&motive=02');
      expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Entregada', cfdi_cancelado_motivo: '02', facturama_uuid: 'UUID-VIGENTE' });
      expect(fake.db.ordenes[0].cfdi_cancelado_at).toBeTruthy();
      expect(fake.db.invoice_attempts[0]).toMatchObject({ provider: 'facturama-cancel', status: 'success' });
    }
  });
  it('Ventas A cancela SU orden facturada → proveedor alcanzado', async () => {
    const { prov, fake, cancelar } = montar(F());
    expect(leer(await cancelar(ev('va', { ordenId: 900, motivo: '02' }))).status).toBe(200);
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
  });
  it('Ventas A sobre la orden de B (o sin vendedor) → 403 antes del proveedor', async () => {
    for (const vendedor of [IDS.vb, null]) {
      const { prov, fake, cancelar } = montar(F({ vendedor_id: vendedor }));
      expect(leer(await cancelar(ev('va', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 403, body: { code: 'ORDEN_AJENA' } });
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
    }
  });
  it('F: con CFDI pero la orden NO está Facturada → 409 antes del proveedor (sin trampolín)', async () => {
    for (const estatus of ['Creada', 'Asignada', 'En ruta', 'Entregada', 'No entregada', 'Cancelada']) {
      const { prov, fake, cancelar } = montar(F({ estatus }));
      expect(leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' })))).toMatchObject({ status: 409, body: { code: 'ESTATUS_NO_CANCELABLE' } });
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
      expect(fake.db.ordenes[0].estatus).toBe(estatus);
    }
  });
  it('sin CFDI → 400; ya cancelado → alreadyCancelled; ambos sin proveedor', async () => {
    let m = montar(ORDEN({ estatus: 'Facturada' }));
    expect(leer(await m.cancelar(ev('admin', { ordenId: 900, motivo: '02' }))).status).toBe(400);
    expect(m.prov.calls).toHaveLength(0);
    m = montar(ORDEN({ ...CFDI, cfdi_cancelado_at: '2026-10-01T00:00:00Z' }));
    expect(leer(await m.cancelar(ev('admin', { ordenId: 900, motivo: '02' }))).body).toMatchObject({ alreadyCancelled: true });
    expect(m.prov.calls).toHaveLength(0);
  });
  it('otros roles → rechazados antes del proveedor', async () => {
    for (const who of ['chofer', 'prod', 'bolsas', 'sin']) {
      const { prov, fake, cancelar } = montar(F());
      expect(leer(await cancelar(ev(who, { ordenId: 900, motivo: '02' }))).status).toBe(400);
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
    }
  });
  it('la orden cambió mientras se cancelaba → 409, no se escribe Entregada a ciegas', async () => {
    let fakeRef;
    const { fake, prov, cancelar } = montar(F(), {}, { antes: () => { fakeRef.db.ordenes[0].estatus = 'Cancelada'; } });
    fakeRef = fake;
    const r = leer(await cancelar(ev('admin', { ordenId: 900, motivo: '02' })));
    expect(r).toMatchObject({ status: 409, body: { code: 'ORDEN_CAMBIO_TRAS_CANCELAR' } });
    expect(prov.calls).toHaveLength(1);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Cancelada', cfdi_cancelado_at: null });
    expect(fake.db.invoice_attempts[0]).toMatchObject({ status: 'review:orden_no_actualizada' });
  });
});

describe('OL-03A: la cadena estatus arbitrario → Facturada → Entregada ya no es alcanzable', () => {
  for (const [nombre, o, who] of [
    ['A Creada sin ruta', { estatus: 'Creada' }, 'admin'],
    ['B Asignada sin ruta', { estatus: 'Asignada' }, 'fact'],
    ['C con ruta sin entregar', { estatus: 'En ruta', ruta_id: 7 }, 'va'],
    ['D Cancelada', { estatus: 'Cancelada' }, 'admin'],
    ['E orden ajena entregada', { estatus: 'Entregada', vendedor_id: IDS.vb }, 'va'],
  ]) {
    it(`${nombre}: timbrado rechazado y la cancelación no tiene de qué partir`, async () => {
      const { fake, prov, timbrar, cancelar } = montar(ORDEN(o));
      const t = leer(await timbrar(ev(who, { ordenId: 900 })));
      expect([403, 409]).toContain(t.status);
      const c = leer(await cancelar(ev(who, { ordenId: 900, motivo: '02' })));
      expect([400, 403]).toContain(c.status);
      expect(prov.calls).toHaveLength(0);
      sinEscrituras(fake);
      expect(fake.db.ordenes[0]).toMatchObject({ estatus: o.estatus, facturama_uuid: null });
      expect(fake.db.ordenes[0].delivered_at).toBeUndefined();
    });
  }
});
