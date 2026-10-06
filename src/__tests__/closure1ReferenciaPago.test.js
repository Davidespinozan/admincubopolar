// closure1ReferenciaPago.test.js — CLOSURE-1 (R-01): una referencia de pago no
// vacía se registra una sola vez. Pruebas puras / de fuente: el webhook trata
// el 23505 del índice como entrega repetida SIN efectos financieros, la
// referencia del proveedor no se transforma y la migración 114 falla cerrado.
// La carrera real con Postgres (dos entregas a la vez, dos conexiones) se prueba
// en el runner local (bloque 114).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncOrderPayment } from '../../netlify/functions/_lib/persistence.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const seed = () => ({
  clientes: [{ id: 32, nombre: 'Cliente', saldo: 350 }],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Asignada', cliente_id: 32, metodo_pago: 'Crédito (fiado)' }],
  cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
});
const pago = { ordenId: 46, status: 'paid', amount: 350, currency: 'MXN' };

describe('CLOSURE-1 webhook: el índice único gana la carrera sin segundo efecto', () => {
  it('INSERT rechazado con 23505 → "duplicate"; sin CxC, saldo del cliente ni orden', async () => {
    const fake = makeFakeSupabase(seed(), { failInsert: { table: 'pagos', error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_pagos_ref"' } } });
    const r = await syncOrderPayment({ provider: 'stripe', providerReference: 'cs_1', payment: pago, rawPayload: {} }, { supabase: fake });
    expect(r).toMatchObject({ applied: false, code: 'duplicate' });
    expect(fake.writes.filter(w => ['cuentas_por_cobrar', 'ordenes', 'clientes'].includes(w.table))).toEqual([]);
    expect(fake.rpcs.filter(x => x.name === 'increment_saldo')).toEqual([]);
    expect(fake.db.cuentas_por_cobrar[0]).toMatchObject({ monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' });
  });
  it('otro error del INSERT NO se convierte en éxito ni en duplicado', async () => {
    const fake = makeFakeSupabase(seed(), { failInsert: { table: 'pagos', error: { code: '23503', message: 'fk' } } });
    await expect(syncOrderPayment({ provider: 'stripe', providerReference: 'cs_1', payment: pago, rawPayload: {} }, { supabase: fake })).rejects.toMatchObject({ code: '23503' });
    expect(fake.rpcs.filter(x => x.name === 'increment_saldo')).toEqual([]);
  });
  it('la referencia es la identidad del proveedor, sin transformar', async () => {
    const fake = makeFakeSupabase(seed());
    await syncOrderPayment({ provider: 'mercadopago', providerReference: '123456', payment: { ...pago, status: 'approved' }, rawPayload: {} }, { supabase: fake });
    expect(fake.db.pagos.map(p => p.referencia)).toEqual(['mercadopago:123456']);
  });
});

describe('CLOSURE-1 migración 114', () => {
  const m = src('../../supabase/114_referencia_pago_unica.sql');
  const sinComentarios = m.replace(/--[^\n]*/g, '');
  it('orden: pre-chequeo (aborta con duplicados, sin reparar) → abonar_cxc → índice único parcial', () => {
    const iPre = sinComentarios.indexOf('HAVING count(*) > 1');
    const iFn = sinComentarios.indexOf('CREATE OR REPLACE FUNCTION abonar_cxc(');
    const iIdx = sinComentarios.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_ref ON pagos (referencia) WHERE referencia <> ''");
    expect(iPre).toBeGreaterThan(0);
    expect(iFn).toBeGreaterThan(iPre);
    expect(iIdx).toBeGreaterThan(iFn);
    expect(sinComentarios).toMatch(/RAISE EXCEPTION '114: % referencia\(s\) de pago no vacía\(s\) repetida\(s\)/);
    expect(sinComentarios).not.toMatch(/DELETE\s+FROM\s+pagos|UPDATE\s+pagos/i);
  });
  it('abonar_cxc: referencia por omisión con el id del pago (pg_catalog.nextval, no public.nextval); manual repetida → 23505', () => {
    expect(sinComentarios).toMatch(/v_pago_id := pg_catalog\.nextval\(pg_get_serial_sequence\('public\.pagos', 'id'\)::regclass\);/);
    expect(sinComentarios).toMatch(/'Abono CxC #' \|\| p_cxc_id \|\| ' pago ' \|\| v_pago_id/);
    expect(sinComentarios).not.toMatch(/to_char\(now\(\)/);
    expect(sinComentarios).toMatch(/ya está registrada', v_ref USING ERRCODE = '23505'/);
  });
});
