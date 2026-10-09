// fakeSupabase.js — cliente Supabase en memoria para probar las Netlify
// Functions financieras SIN red. Implementa el subconjunto del query
// builder que usan persistence.js, billing-create-checkout,
// billing-webhook-*, billing-create-invoice, billing-cancel-invoice y
// admin-create-user, y registra cada escritura.

const TABLAS_FINANCIERAS = new Set(['pagos', 'cuentas_por_cobrar', 'ordenes', 'payment_intents', 'clientes']);

export function makeFakeSupabase(seed = {}, opts = {}) {
  const db = {
    ordenes: [], pagos: [], cuentas_por_cobrar: [], payment_intents: [],
    payment_webhook_events: [], clientes: [], orden_lineas: [], productos: [],
    usuarios: [], rutas: [],
    ...JSON.parse(JSON.stringify(seed)),
  };
  const writes = [];
  const rpcs = [];
  let nextId = 1000;
  const failInsert = opts.failInsert || null; // { table, error }

  const from = (table) => {
    const rows = () => db[table] || (db[table] = []);
    const q = { op: 'select', filters: [], order: null, limit: null, single: null, payload: null, onConflict: null };
    const apply = () => rows().filter(r => q.filters.every(f => f(r)));

    const exec = () => {
      if (q.op === 'select') {
        let out = apply();
        if (q.order) {
          const { col, asc } = q.order;
          out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
        }
        if (q.limit != null) out = out.slice(0, q.limit);
        if (q.single === 'maybe') return { data: out[0] ?? null, error: null };
        if (q.single === 'single') {
          return out[0] ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        }
        return { data: out, error: null };
      }
      if (q.op === 'insert') {
        if (failInsert && failInsert.table === table) {
          return { data: null, error: failInsert.error || { message: 'insert falló (fake)' } };
        }
        const arr = Array.isArray(q.payload) ? q.payload : [q.payload];
        const inserted = [];
        for (const p of arr) {
          if (table === 'pagos' && p.referencia && rows().some(r => r.referencia === p.referencia)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_pagos_ref"' } };
          }
          if (table === 'usuarios' && p.email && rows().some(r => String(r.email).toLowerCase() === String(p.email).toLowerCase())) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "usuarios_email_key"' } };
          }
          const row = { id: nextId++, ...p };
          rows().push(row);
          inserted.push(row);
        }
        writes.push({ table, op: 'insert', payload: q.payload });
        return { data: q.single ? inserted[0] : inserted, error: null };
      }
      if (q.op === 'upsert') {
        const keys = String(q.onConflict || 'id').split(',').map(k => k.trim());
        const p = q.payload;
        const idx = rows().findIndex(r => keys.every(k => String(r[k]) === String(p[k])));
        let row;
        if (idx >= 0) row = Object.assign(rows()[idx], p);
        else { row = { id: nextId++, ...p }; rows().push(row); }
        writes.push({ table, op: 'upsert', payload: p });
        return { data: row, error: null };
      }
      if (q.op === 'update') {
        const targets = apply();
        for (const r of targets) Object.assign(r, q.payload);
        writes.push({ table, op: 'update', payload: q.payload, count: targets.length });
        return { data: targets, error: null };
      }
      if (q.op === 'delete') {
        const targets = apply();
        db[table] = rows().filter(r => !targets.includes(r));
        writes.push({ table, op: 'delete', count: targets.length });
        return { data: targets, error: null };
      }
      throw new Error('op desconocida ' + q.op);
    };

    const b = {
      select() { return b; },
      eq(col, val) { q.filters.push(r => String(r[col]) === String(val)); return b; },
      neq(col, val) { q.filters.push(r => String(r[col]) !== String(val)); return b; },
      ilike(col, val) { q.filters.push(r => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase()); return b; },
      in(col, vals) { const set = new Set((vals || []).map(String)); q.filters.push(r => set.has(String(r[col]))); return b; },
      is(col, val) { q.filters.push(r => (val === null ? (r[col] === null || r[col] === undefined) : r[col] === val)); return b; },
      not(col, op, val) { if (op === 'is' && val === null) q.filters.push(r => r[col] !== null && r[col] !== undefined); return b; },
      order(col, o) { q.order = { col, asc: o?.ascending !== false }; return b; },
      limit(n) { q.limit = n; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.onConflict = o?.onConflict; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      maybeSingle() { q.single = 'maybe'; return b; },
      single() { q.single = 'single'; return b; },
      then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
    };
    return b;
  };

  const rpc = async (name, args) => {
    rpcs.push({ name, args });
    writes.push({ table: `rpc:${name}`, op: 'rpc', payload: args });
    // opts.rpcImpl = { nombre: (args, db) => ({ data, error }) } — dobles de contratos (p. ej. CFDI, OL-03B).
    if (opts.rpcImpl && typeof opts.rpcImpl[name] === 'function') return opts.rpcImpl[name](args, db);
    if (name === 'increment_saldo') {
      const c = (db.clientes || []).find(x => String(x.id) === String(args.p_cli));
      if (c) c.saldo = Number(c.saldo || 0) + Number(args.p_delta || 0);
    }
    return { data: null, error: null };
  };

  const authCalls = { createUser: [], deleteUser: [], updateUserById: [] };
  const auth = {
    // opts.tokens = { '<jwt>': { id, email } } — cualquier otro token es inválido
    async getUser(token) {
      const user = opts.tokens?.[token];
      if (!user) return { data: { user: null }, error: { message: 'invalid JWT' } };
      return { data: { user }, error: null };
    },
    admin: {
      async createUser(params) {
        authCalls.createUser.push(params);
        if (opts.createUserError) return { data: null, error: { message: opts.createUserError } };
        return { data: { user: { id: opts.authId || 'auth-uuid-1', email: params.email } }, error: null };
      },
      // GER-1: restablecer contraseña (opts.updateUserError simula el fallo de Auth)
      async updateUserById(id, attrs) {
        authCalls.updateUserById.push({ id, attrs });
        if (opts.updateUserError) return { data: null, error: { message: opts.updateUserError } };
        return { data: { user: { id } }, error: null };
      },
      async deleteUser(id) {
        authCalls.deleteUser.push(id);
        if (opts.deleteUserError) return { data: null, error: { message: opts.deleteUserError } };
        return { data: {}, error: null };
      },
    },
  };

  const writesFinancieras = () => writes.filter(w => TABLAS_FINANCIERAS.has(w.table) || w.op === 'rpc');

  return { from, rpc, auth, db, writes, rpcs, authCalls, writesFinancieras };
}
