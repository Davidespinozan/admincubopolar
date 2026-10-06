// pgSupabaseAdapter.mjs — cliente mínimo con la forma de supabase-js sobre
// Postgres REAL, para correr las Netlify Functions de facturación contra la
// base local (OL-03B). Cada consulta o RPC es su propia transacción como
// service_role (igual que PostgREST: una petición = una transacción); usa un
// pool para que dos handlers simultáneos tengan conexiones distintas.
// Solo el subconjunto que usan billing-create-invoice / billing-cancel-invoice,
// _lib/auth.js y, desde CLOSURE-1 (114), los webhooks de pago
// (_lib/persistence.js: order/limit, update, upsert onConflict, delete).
// `antesDeEscribir(op, tabla)` (opcional) se espera antes de cada escritura:
// permite a una prueba alinear dos peticiones justo antes del INSERT.
// Solo pruebas locales; nunca producción.
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identificador no permitido: ' + s);
  return s;
};

export function makePgSupabase(pool, { tokens = {}, fallar = {}, antesDeEscribir = null } = {}) {
  const enServicio = async (sql, params) => {
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query('SET LOCAL ROLE service_role');
      await cl.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      const r = await cl.query(sql, params);
      await cl.query('COMMIT');
      return r;
    } catch (e) {
      await cl.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      cl.release();
    }
  };
  const from = (table) => {
    const q = { op: 'select', cols: '*', where: [], params: [], single: null, payload: null, orden: null, limite: null, conflicto: null };
    const valor = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
    const filtro = () => (q.where.length ? ' WHERE ' + q.where.join(' AND ') : '');
    const exec = async () => {
      try {
        if (q.op !== 'select' && antesDeEscribir) await antesDeEscribir(q.op, table);
        if (q.op === 'update') {
          const keys = Object.keys(q.payload).map(ident);
          const r = await enServicio(`UPDATE ${ident(table)} SET ${keys.map((k, i) => `${k} = $${q.params.length + i + 1}`).join(', ')}${filtro()} RETURNING *`,
            [...q.params, ...keys.map(k => valor(q.payload[k]))]);
          return { data: q.single ? r.rows[0] : r.rows, error: null };
        }
        if (q.op === 'delete') {
          const r = await enServicio(`DELETE FROM ${ident(table)}${filtro()} RETURNING *`, q.params);
          return { data: r.rows, error: null };
        }
        if (q.op === 'upsert') {
          const keys = Object.keys(q.payload).map(ident);
          const conf = q.conflicto.split(',').map(s => ident(s.trim()));
          const r = await enServicio(`INSERT INTO ${ident(table)} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')})
            ON CONFLICT (${conf.join(', ')}) DO UPDATE SET ${keys.map(k => `${k} = EXCLUDED.${k}`).join(', ')} RETURNING *`, keys.map(k => valor(q.payload[k])));
          return { data: q.single ? r.rows[0] : r.rows, error: null };
        }
        if (q.op === 'insert') {
          const keys = Object.keys(q.payload).map(ident);
          const vals = keys.map((k) => { const v = q.payload[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
          const r = await enServicio(`INSERT INTO ${ident(table)} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, vals);
          return { data: q.single ? r.rows[0] : r.rows, error: null };
        }
        const cols = q.cols === '*' ? '*' : q.cols.split(',').map(s => ident(s.trim())).join(', ');
        const r = await enServicio(`SELECT ${cols} FROM ${ident(table)}${filtro()}${q.orden || ''}${q.limite ? ' LIMIT ' + q.limite : ''}`, q.params);
        if (q.single === 'maybe') return { data: r.rows[0] ?? null, error: null };
        if (q.single === 'single') return r.rows.length === 1 ? { data: r.rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: r.rows, error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    };
    const b = {
      select(cols) { if (q.op === 'select' && cols) q.cols = cols; return b; },
      eq(col, val) { q.params.push(val); q.where.push(`${ident(col)}::text = $${q.params.length}::text`); return b; },
      in(col, vals) { q.params.push((vals || []).map(String)); q.where.push(`${ident(col)}::text = ANY($${q.params.length}::text[])`); return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      upsert(p, { onConflict } = {}) { q.op = 'upsert'; q.payload = p; q.conflicto = onConflict; return b; },
      delete() { q.op = 'delete'; return b; },
      order(col, { ascending = true } = {}) { q.orden = ` ORDER BY ${ident(col)} ${ascending ? 'ASC' : 'DESC'}`; return b; },
      limit(nn) { q.limite = Math.max(1, Number.parseInt(nn, 10) || 1); return b; },
      single() { q.single = 'single'; return b; },
      maybeSingle() { q.single = 'maybe'; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    return b;
  };
  const rpc = async (name, args = {}) => {
    if (fallar[name] > 0) { fallar[name] -= 1; return { data: null, error: { code: '08006', message: 'conexión perdida (simulada)' } }; }
    const keys = Object.keys(args).map(ident);
    const vals = keys.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    try {
      const r = await enServicio(`SELECT ${ident(name)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, vals);
      return { data: r.rows[0].r, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };
  const auth = {
    async getUser(token) {
      const user = tokens[token];
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
    },
  };
  return { from, rpc, auth };
}
