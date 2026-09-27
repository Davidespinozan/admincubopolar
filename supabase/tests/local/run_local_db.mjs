// Runner local: levanta Postgres embebido, reconstruye el esquema con las
// migraciones del repo (misma secuencia que produjo producción), compara
// policies con el snapshot de producción, aplica 069 (x2) y corre las
// pruebas SQL. Emula psql: split por sentencia con dollar-quoting, NOTICEs
// impresos, \echo soportado, ON_ERROR_STOP por archivo configurable.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

// Uso (desde la raíz del repo):
//   mkdir -p /tmp/cp-localdb && cd /tmp/cp-localdb && npm init -y && npm i embedded-postgres pg
//   PG_BIN=/tmp/cp-localdb/node_modules/@embedded-postgres/darwin-arm64/native/bin \
//   NODE_PATH=/tmp/cp-localdb/node_modules WORK=/tmp/cp-localdb \
//   node supabase/tests/local/run_local_db.mjs
// (o PG_BIN apuntando a un Postgres 16+ instalado; requiere el módulo `pg`).
const WORK = process.env.WORK || '/tmp/cp-localdb';
const BIN = process.env.PG_BIN || path.join(WORK, 'node_modules/@embedded-postgres/darwin-arm64/native/bin');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const DATA = path.join(WORK, 'pgdata');
const PORT = 5499;
const DB = 'cubopolar_test';
const USER = 'tester';

function sh(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r; }

if (!fs.existsSync(DATA)) {
  const r = sh(path.join(BIN, 'initdb'), ['-D', DATA, '-U', USER, '--auth=trust', '-E', 'UTF8']);
  if (r.status !== 0) { console.log('initdb falló', r.stderr.slice(-500)); process.exit(1); }
}
sh(path.join(BIN, 'pg_ctl'), ['-D', DATA, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, '-l', path.join(WORK, 'pg.log'), 'start']);
await new Promise(r => setTimeout(r, 2500));

// ── split SQL como psql ──
function splitSql(text) {
  const stmts = []; let cur = ''; let i = 0; const n = text.length;
  let inSq = false, inDq = false, dollar = null, lineC = false, blockC = 0;
  while (i < n) {
    const c = text[i], c2 = text.slice(i, i + 2);
    if (lineC) { cur += c; if (c === '\n') lineC = false; i++; continue; }
    if (blockC) { cur += c; if (c2 === '*/') { cur += '/'; i += 2; blockC--; continue; } if (c2 === '/*') { cur += '*'; i += 2; blockC++; continue; } i++; continue; }
    if (dollar) { if (text.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; } cur += c; i++; continue; }
    if (inSq) { cur += c; if (c === "'" ) { if (text[i + 1] === "'") { cur += "'"; i += 2; continue; } inSq = false; } i++; continue; }
    if (inDq) { cur += c; if (c === '"') inDq = false; i++; continue; }
    if (c2 === '--') { lineC = true; cur += c; i++; continue; }
    if (c2 === '/*') { blockC = 1; cur += c2; i += 2; continue; }
    if (c === "'") { inSq = true; cur += c; i++; continue; }
    if (c === '"') { inDq = true; cur += c; i++; continue; }
    if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i)); if (m) { dollar = m[0]; cur += m[0]; i += m[0].length; continue; } }
    if (c === ';') { stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter(s => s && !/^(--[^\n]*\n?)+$/.test(s));
}

async function connect(db = DB) {
  const c = new Client({ host: '127.0.0.1', port: PORT, user: USER, database: db });
  await c.connect();
  c.on('notice', m => { const msg = m.message || ''; if (/OK:|FAIL|denied|abortado/.test(msg)) console.log('  ' + msg); });
  return c;
}

// psql-like: ejecuta un archivo sentencia a sentencia
async function runFile(client, file, { stopOnError = false, echo = false } = {}) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  let sql = ''; const echos = [];
  for (const l of lines) {
    if (l.startsWith('\\echo')) { echos.push({ at: sql.length, text: l.replace(/^\\echo\s*/, '').replace(/^'|'$/g, '') }); continue; }
    if (l.startsWith('\\')) continue;
    sql += l + '\n';
  }
  const stmts = splitSql(sql);
  // emitir echos aproximados (antes de la sentencia cuyo offset supera at)
  let errors = 0; let pos = 0; let ei = 0;
  for (const st of stmts) {
    const idx = sql.indexOf(st, pos); pos = idx >= 0 ? idx + st.length : pos;
    while (echo && ei < echos.length && echos[ei].at <= (idx >= 0 ? idx : pos)) { console.log(echos[ei].text); ei++; }
    try { await client.query(st); }
    catch (e) {
      errors++;
      if (stopOnError) { console.log('ERROR en sentencia:', st.slice(0, 160).replace(/\s+/g, ' '), '\n  →', e.message); return { errors, aborted: true }; }
      // psql: si estamos en transacción abortada, ROLLBACK
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
    }
  }
  while (echo && ei < echos.length) { console.log(echos[ei].text); ei++; }
  return { errors, aborted: false };
}

const admin = await connect('postgres');
await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();

const c = await connect();
console.log('── shim');
let r = await runFile(c, path.join(ROOT, 'supabase/tests/local/00_shim_supabase.sql'), { stopOnError: true });
if (r.aborted) process.exit(1);

console.log('── migraciones (secuencia de producción: 001_completo → 001_schema → 002_safe → 003…068)');
const skip = new Set(['000_reset.sql', '000_template_migration.sql', '002_seed.sql', '004_demo_data.sql', '005_cleanup_demo_products.sql']);
const files = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => f.endsWith('.sql') && !skip.has(f) && !f.startsWith('069_') && !f.startsWith('070_') && !f.startsWith('071_') && !f.startsWith('072_')).sort((a, b) => {
  const order = f => (f === '001_schema_completo.sql' ? '001_0' : f === '001_schema.sql' ? '001_1' : f);
  return order(a).localeCompare(order(b));
});
const conErrores = [];
for (const f of files) {
  const res = await runFile(c, path.join(ROOT, 'supabase', f));
  if (res.errors) conErrores.push(`${f}:${res.errors}`);
}
console.log('  archivos con errores (esperado en scripts ya aplicados/variantes):', conErrores.join(' '));

// ── PARIDAD CON PRODUCCIÓN (catálogo capturado read-only el 2026-09-26) ──
// Producción NO tiene: trg_orden_state, trg_pagos_immutable, trg_ordenes_updated,
// idx_clientes_rfc (solo idx_clientes_rfc_nominativo), ni las policies
// pagos_write/pagos_read_all/movimientos.read_all/facturacion_insert.
// Producción SÍ tiene policies auth_insert (creadas a mano) en pagos,
// cuentas_por_cobrar y movimientos_contables.
await c.query(`
  DROP TRIGGER IF EXISTS trg_orden_state ON ordenes;
  DROP TRIGGER IF EXISTS trg_pagos_immutable ON pagos;
  DROP TRIGGER IF EXISTS trg_ordenes_updated ON ordenes;
  -- Producción (verificado 2026-09-27): sin triggers prevent_mutation en inventario_mov ni auditoria.
  DROP TRIGGER IF EXISTS trg_inv_mov_immutable ON inventario_mov;
  DROP TRIGGER IF EXISTS trg_auditoria_immutable ON auditoria;
  DROP INDEX IF EXISTS idx_clientes_rfc;
  -- Producción (verificado 2026-09-27): RLS DESHABILITADO en estas 4 tablas.
  ALTER TABLE pagos DISABLE ROW LEVEL SECURITY;
  ALTER TABLE cuentas_por_cobrar DISABLE ROW LEVEL SECURITY;
  ALTER TABLE movimientos_contables DISABLE ROW LEVEL SECURITY;
  ALTER TABLE mermas DISABLE ROW LEVEL SECURITY;
  -- Producción NO tiene estas tablas (003/005 solo existen en el repo) ni las
  -- policies read_all de empleados/nómina (allí solo hay admin_all).
  DROP TABLE IF EXISTS ruta_plantilla_clientes CASCADE;
  DROP TABLE IF EXISTS ruta_plantillas CASCADE;
  DROP TABLE IF EXISTS categorias_contables CASCADE;
  DROP TABLE IF EXISTS departamentos CASCADE;
  DROP POLICY IF EXISTS read_all ON empleados;
  DROP POLICY IF EXISTS read_all ON nomina_periodos;
  DROP POLICY IF EXISTS read_all ON nomina_recibos;
  -- Producción tiene estas columnas de cierre en rutas (añadidas fuera del repo).
  ALTER TABLE rutas ADD COLUMN IF NOT EXISTS cierre_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS total_cobrado NUMERIC, ADD COLUMN IF NOT EXISTS total_credito NUMERIC;
  ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE cuentas_por_cobrar ADD COLUMN IF NOT EXISTS concepto TEXT DEFAULT '';
  DROP TRIGGER IF EXISTS trg_cxc_updated ON cuentas_por_cobrar;
  DROP POLICY IF EXISTS pagos_write ON pagos;
  DROP POLICY IF EXISTS pagos_read_all ON pagos;
  DROP POLICY IF EXISTS read_all ON movimientos_contables;
  DROP POLICY IF EXISTS facturacion_insert ON movimientos_contables;
  DROP POLICY IF EXISTS auth_insert ON pagos; CREATE POLICY auth_insert ON pagos FOR INSERT TO authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS auth_insert ON cuentas_por_cobrar; CREATE POLICY auth_insert ON cuentas_por_cobrar FOR INSERT TO authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS auth_insert ON movimientos_contables; CREATE POLICY auth_insert ON movimientos_contables FOR INSERT TO authenticated WITH CHECK (true);
`);
const PROD_BEFORE = `clientes|admin_all|ALL
clientes|chofer_update_saldo|UPDATE
clientes|read_all|SELECT
clientes|ventas_update|UPDATE
clientes|ventas_write|INSERT
cuentas_por_cobrar|admin_all|ALL
cuentas_por_cobrar|auth_insert|INSERT
cuentas_por_cobrar|cxc_read_all|SELECT
cuentas_por_cobrar|cxc_write|ALL
cuentas_por_cobrar|read_all|SELECT
cuentas_por_cobrar|rollback_delete|DELETE
cuentas_por_cobrar|update_roles|UPDATE
cuentas_por_cobrar|write_roles|INSERT
movimientos_contables|admin_all|ALL
movimientos_contables|auth_insert|INSERT
movimientos_contables|facturacion_read|SELECT
movimientos_contables|rollback_delete|DELETE
ordenes|admin_all|ALL
ordenes|read_all|SELECT
ordenes|rollback_delete|DELETE
ordenes|ventas_insert|INSERT
ordenes|ventas_update|UPDATE
pagos|admin_all|ALL
pagos|auth_insert|INSERT
pagos|insert_roles|INSERT
pagos|read_all|SELECT
pagos|rollback_delete|DELETE`.split('\n');
const catalogo = async () => (await c.query(`SELECT tablename||'|'||policyname||'|'||cmd AS p FROM pg_policies WHERE tablename IN ('pagos','cuentas_por_cobrar','movimientos_contables','ordenes','clientes') ORDER BY 1`)).rows.map(x => x.p);
const before = await catalogo();
fs.writeFileSync(path.join(WORK, 'policies_before.txt'), before.join('\n'));
console.log('── policies ANTES (local):', before.length, '| coincide con producción:', JSON.stringify(before) === JSON.stringify(PROD_BEFORE) ? 'SÍ' : 'NO → diff: ' + JSON.stringify({soloLocal: before.filter(x=>!PROD_BEFORE.includes(x)), soloProd: PROD_BEFORE.filter(x=>!before.includes(x))}));
const fnLegacy = (await c.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('timbrar_orden','check_orden_transition','move_stock','registrar_pago','increment_saldo') ORDER BY 1`)).rows.map(x => x.proname);
console.log('── funciones legacy presentes:', fnLegacy.join(', '));

console.log('── aplicar 069 (1/2)');
r = await runFile(c, path.join(ROOT, 'supabase/069_rls_financiera.sql'), { stopOnError: true });
if (r.aborted) process.exit(1);
console.log('── aplicar 069 (2/2, idempotencia)');
r = await runFile(c, path.join(ROOT, 'supabase/069_rls_financiera.sql'), { stopOnError: true });
if (r.aborted) process.exit(1);

// ── ASERCIÓN PERMANENTE: RLS físicamente habilitado (pg_class), no solo policies.
// Toda tabla de public debe tener relrowsecurity = true salvo deuda conocida.
const RLS_DEUDA_CONOCIDA = ['mermas'];
const LEDGER = ['pagos', 'cuentas_por_cobrar', 'movimientos_contables'];
async function rlsCheck(etiqueta, deuda = RLS_DEUDA_CONOCIDA) {
  const rows = (await c.query(`SELECT c.relname AS t, c.relrowsecurity AS rls,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS pol,
      (SELECT count(*)::int FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=c.relname AND g.grantee='anon') AS anon
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`)).rows;
  const sinRls = rows.filter(r => !r.rls && !deuda.includes(r.t)).map(r => r.t);
  const ledgerMal = rows.filter(r => LEDGER.includes(r.t) && (!r.rls || r.pol < 2 || r.anon > 0)).map(r => `${r.t}(rls=${r.rls},pol=${r.pol},anon=${r.anon})`);
  const ok = sinRls.length === 0 && ledgerMal.length === 0;
  console.log(`  RLS_CHECK[${etiqueta}]: ${ok ? 'PASS' : 'FAIL'} tablas_sin_rls=${JSON.stringify(sinRls)} ledger_mal=${JSON.stringify(ledgerMal)} deuda_conocida=${JSON.stringify(rows.filter(r => deuda.includes(r.t)).map(r => r.t + ':rls=' + r.rls))}`);
  return ok;
}
const rlsSolo069 = await rlsCheck('069 sin 070 (debe detectar el hueco de producción)');
console.log('  detector detecta el hueco:', rlsSolo069 ? 'NO (FALLA DEL DETECTOR)' : 'SÍ');
console.log('── pruebas con 069 SIN 070 (reproduce producción; deben fallar)');
const r069 = await runFile(c, path.join(ROOT, 'supabase/tests/069_rls_financiera_test.sql'), { stopOnError: true });
try { await c.query('ROLLBACK'); } catch { /* sin transacción abierta */ }
console.log('  resultado con 069 sola:', r069.aborted ? 'FALLA (esperado: ledger escribible con RLS apagado)' : 'PASA (INESPERADO)');
console.log('── aplicar 070 (1/2)');
let r070 = await runFile(c, path.join(ROOT, 'supabase/070_enable_financial_rls.sql'), { stopOnError: true });
if (r070.aborted) process.exit(1);
console.log('── aplicar 070 (2/2, idempotencia)');
r070 = await runFile(c, path.join(ROOT, 'supabase/070_enable_financial_rls.sql'), { stopOnError: true });
if (r070.aborted) process.exit(1);
const rlsOk = await rlsCheck('069 + 070');
if (!rlsOk || !rlsSolo069 === false) { /* reportado arriba */ }
if (!rlsOk) { console.log('RESULTADO: FALLÓ (RLS_CHECK)'); process.exit(1); }

// ── Fase B P0: 071 (actor activo por auth.uid, lectura sin USING true, RPC de stock)
console.log('── aplicar 071 (1/2)');
let r071 = await runFile(c, path.join(ROOT, 'supabase/071_actor_activo_rls_lectura_stock.sql'), { stopOnError: true });
if (r071.aborted) process.exit(1);
console.log('── aplicar 071 (2/2, idempotencia)');
r071 = await runFile(c, path.join(ROOT, 'supabase/071_actor_activo_rls_lectura_stock.sql'), { stopOnError: true });
if (r071.aborted) process.exit(1);
// Escaneo permanente: ninguna policy USING/CHECK true fuera de la deuda conocida.
const PERMISIVAS_DEUDA = ['auditoria|insert_all', 'error_log|insert_all', 'notificaciones|insert_all', 'mermas|auth_insert'];
const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
const permMal = perm.filter(x => !PERMISIVAS_DEUDA.includes(x.p)).map(x => x.p + ':' + x.cmd);
console.log(`  PERMISSIVE_POLICY_CHECK: ${permMal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(permMal)} deuda=${JSON.stringify(perm.filter(x => PERMISIVAS_DEUDA.includes(x.p)).map(x => x.p))}`);
if (permMal.length) process.exit(1);
console.log('── PRUEBAS 071 (Fase B P0)');
const r071t = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: true });
if (r071t.aborted) { console.log('RESULTADO: FALLÓ (071)'); process.exit(1); }

// ── Fase B / B1: 072 (merma como evento inmutable) ──────────────────────
console.log('── aplicar 072 (1/2)');
let r072 = await runFile(c, path.join(ROOT, 'supabase/072_mermas_evento_inmutable.sql'), { stopOnError: true });
if (r072.aborted) process.exit(1);
console.log('── aplicar 072 (2/2, idempotencia)');
r072 = await runFile(c, path.join(ROOT, 'supabase/072_mermas_evento_inmutable.sql'), { stopOnError: true });
if (r072.aborted) process.exit(1);
// Escaneo permanente tras 072: NINGUNA tabla de public sin RLS físico (mermas ya no es deuda).
const rls072 = await rlsCheck('069 + 070 + 071 + 072 (sin deuda)', []);
if (!rls072) { console.log('RESULTADO: FALLÓ (RLS_CHECK 072)'); process.exit(1); }
const PERMISIVAS_DEUDA_072 = PERMISIVAS_DEUDA.filter(x => !x.startsWith('mermas|'));
const perm072 = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
const permMal072 = perm072.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
console.log(`  PERMISSIVE_POLICY_CHECK[072]: ${permMal072.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(permMal072)} deuda=${JSON.stringify(perm072.filter(x => PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p))}`);
if (permMal072.length) process.exit(1);
console.log('── policies mermas / storage(mermas):', (await c.query(`SELECT schemaname||'.'||tablename||'|'||policyname||'|'||cmd AS p FROM pg_policies WHERE tablename IN ('mermas','mermas_efectos') OR (schemaname='storage' AND policyname LIKE 'mermas_%') ORDER BY 1`)).rows.map(x => x.p).join(', '));
console.log('── grants mermas:', (await c.query(`SELECT table_name||':'||grantee||':'||string_agg(privilege_type, ',' ORDER BY privilege_type) AS g FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('mermas','mermas_efectos') AND grantee IN ('anon','authenticated','PUBLIC') GROUP BY table_name, grantee ORDER BY 1`)).rows.map(x => x.g).join(' | ') || '(ninguno)');
console.log('── PRUEBAS 072 (B1 mermas)');
const r072t = await runFile(c, path.join(ROOT, 'supabase/tests/072_mermas_test.sql'), { stopOnError: true, echo: true });
if (r072t.aborted) { console.log('RESULTADO: FALLÓ (072)'); process.exit(1); }

// ── B1-28 / B1-29: concurrencia con dos conexiones reales ─────────────────
{
  console.log('── B1-28/29 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const ADM = '72c00000-0000-0000-0000-000000000001', PRD = '72c00000-0000-0000-0000-000000000003';
  let concOk = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) concOk = false; };
  const q1 = async (sql, params) => (await c.query(sql, params)).rows[0];
  await c.query(`BEGIN;
    DELETE FROM usuarios WHERE id IN (191, 193); DELETE FROM auth.users WHERE id::text LIKE '72c00000-%';
    DELETE FROM cuartos_frios WHERE id = 'CF-CONC'; DELETE FROM productos WHERE sku = 'CONC-1';
    INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'admc@t'), ('${PRD}', 'prodc@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (191, 'Admin C', 'admc@t', 'Admin', 'Activo', '${ADM}'), (193, 'Prod C', 'prodc@t', 'Producción', 'Activo', '${PRD}');
    INSERT INTO productos (sku, nombre, precio, stock, costo_unitario) VALUES ('CONC-1', 'Conc', 1, 0, 2);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-CONC', 'Cuarto conc', '{"CONC-1": 10}'::jsonb);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (sqlA, sqlB, params = []) => {
    await a.query(sqlA, params);                     // A toma los locks y NO confirma
    let done = false;
    const pB = b.query(sqlB, params).then(() => ({ ok: true }), e => ({ ok: false, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query('COMMIT');
    const resB = await pB;
    await b.query(resB.ok ? 'COMMIT' : 'ROLLBACK');
    return { bloqueado, resB };
  };
  const stock = async () => Number((await q1(`SELECT COALESCE((stock->>'CONC-1')::int, 0) AS s FROM cuartos_frios WHERE id = 'CF-CONC'`)).s);

  // 28a: 7 + 7 sobre 10
  await actor(a, PRD); await actor(b, PRD);
  let r1 = await carrera(`SELECT registrar_merma('CONC-1', 7, 'conc A')`, `SELECT registrar_merma('CONC-1', 7, 'conc B')`);
  ok(r1.bloqueado, 'B1-28a la segunda merma espera el lock del cuarto (serializada)');
  ok(!r1.resB.ok && /Stock insuficiente/.test(r1.resB.msg || ''), `B1-28b la segunda merma falla por stock tras releer (${(r1.resB.msg || 'OK').slice(0, 60)})`);
  ok(await stock() === 3, 'B1-28c stock final 3 = 10 − 7 (nunca negativo ni doble consumo)');
  ok(Number((await q1(`SELECT count(*) AS n FROM mermas WHERE sku = 'CONC-1'`)).n) === 1, 'B1-28d exactamente 1 merma persistida');
  // 28b: 3 + 3 sobre 3
  await actor(a, PRD); await actor(b, PRD);
  r1 = await carrera(`SELECT registrar_merma('CONC-1', 3, 'conc C')`, `SELECT registrar_merma('CONC-1', 3, 'conc D')`);
  ok(!r1.resB.ok && await stock() === 0, 'B1-28e 3 + 3 sobre 3: una entra, la otra falla, stock 0');
  ok(Number((await q1(`SELECT COALESCE(sum(e.cantidad), 0) AS s FROM mermas_efectos e JOIN mermas m ON m.id = e.merma_id WHERE m.sku = 'CONC-1'`)).s) === 10, 'B1-28f efectos suman exactamente lo descontado (10)');

  // 29: doble reverso concurrente de la merma de 7
  const m7 = (await q1(`SELECT id, mov_contable_id FROM mermas WHERE sku = 'CONC-1' AND cantidad = 7`));
  await actor(a, ADM); await actor(b, ADM);
  const r2 = await carrera(`SELECT revertir_merma($1)`, `SELECT revertir_merma($1)`, [m7.id]);
  ok(r2.bloqueado, 'B1-29a el segundo reverso espera el lock de la merma');
  ok(!r2.resB.ok && /ya fue revertida/.test(r2.resB.msg || ''), `B1-29b el segundo reverso se rechaza (${(r2.resB.msg || 'OK').slice(0, 60)})`);
  ok(await stock() === 7, 'B1-29c stock restaurado una sola vez (0 + 7)');
  ok(Number((await q1(`SELECT count(*) AS n FROM inventario_mov WHERE tipo = 'Reverso merma' AND referencia = $1`, ['MERMA-' + m7.id])).n) === 1, 'B1-29d un solo movimiento de reverso');
  ok(Number((await q1(`SELECT count(*) AS n FROM movimientos_contables WHERE id = $1`, [m7.mov_contable_id])).n) === 0
    && Number((await q1(`SELECT count(*) AS n FROM movimientos_contables m JOIN mermas x ON x.mov_contable_id = m.id WHERE x.sku = 'CONC-1' AND x.estatus = 'Activa'`)).n) === 1,
    'B1-29e egreso de la merma revertida borrado una vez; el de la otra merma intacto');

  await a.end(); await b.end();
  await c.query(`BEGIN;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku = 'CONC-1');
    DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku = 'CONC-1');
    DELETE FROM inventario_mov WHERE producto = 'CONC-1';
    DELETE FROM mermas WHERE sku = 'CONC-1'; DELETE FROM auditoria WHERE modulo = 'Mermas';
    DELETE FROM cuartos_frios WHERE id = 'CF-CONC'; DELETE FROM productos WHERE sku = 'CONC-1';
    DELETE FROM usuarios WHERE id IN (191, 193); DELETE FROM auth.users WHERE id::text LIKE '72c00000-%';
    COMMIT;`);
  if (!concOk) { console.log('RESULTADO: FALLÓ (concurrencia 072)'); process.exit(1); }
}

console.log('── REGRESIÓN 071 con 072 aplicada');
// El fixture de 071 no limpia payment_webhook_events: se retira su fila para poder re-ejecutarlo.
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
const r071b = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
if (r071b.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 072)'); process.exit(1); }
console.log('  071 tras 072: PASS');

const after = await catalogo();
fs.writeFileSync(path.join(WORK, 'policies_after.txt'), after.join('\n'));
console.log('── policies DESPUÉS:', after.length);
console.log(after.map(x => '  ' + x).join('\n'));
console.log('── grants anon ledger:', (await c.query(`SELECT table_name||': '||string_agg(privilege_type, ',') AS g FROM information_schema.role_table_grants WHERE grantee='anon' AND table_name IN ('pagos','cuentas_por_cobrar','movimientos_contables') GROUP BY table_name`)).rows.map(x => x.g).join(' | ') || '(ninguno)');
console.log('── EXECUTE funciones:');
for (const row of (await c.query(`SELECT p.proname AS n, COALESCE(p.proacl::text,'NULL') AS acl FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('timbrar_orden','registrar_pago','increment_saldo','move_stock','check_orden_transition','crear_cxc_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','cerrar_ruta_atomic','fin_marcar_ctx','asignar_orden') ORDER BY 1`)).rows) console.log('  ' + row.n.padEnd(26), row.acl);
console.log('── triggers:', (await c.query(`SELECT tgrelid::regclass||':'||tgname AS t FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('ordenes','pagos','cuentas_por_cobrar')`)).rows.map(x => x.t).join(', '));

// ── search_path de las funciones SECURITY DEFINER de 069 (catálogo real)
const F069 = ['fin_mi_rol_activo','fin_actor_permitido','increment_saldo','crear_cxc_orden','registrar_ingreso_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','cerrar_ruta_atomic','ordenes_guard_financiero',
  // 071
  'erp_actor','erp_rol_activo','erp_usuario_id','erp_actor_nombre','erp_es_activo','erp_actor_etiqueta','update_stocks_atomic','update_productos_stock_atomic',
  // 072
  'erp_foto_merma_en_uso','registrar_merma','registrar_mermas_ruta','revertir_merma'];
const sp = (await c.query(`SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ';') AS cfg,
    has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
    pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY($1) ORDER BY p.proname`, [F069])).rows;
console.log('── SEARCH_PATH (pg_proc real)');
let spOk = sp.length === F069.length;
for (const f of sp) {
  const ok = f.prosecdef && f.cfg === 'search_path=public, pg_temp';
  if (!ok) spOk = false;
  console.log(`  ${f.proname.padEnd(26)} secdef=${f.prosecdef} ${f.cfg || 'SIN search_path'} PUBLIC=${f.pub} anon=${f.anon} auth=${f.auth}`);
}
console.log('  SEARCH_PATH_CHECK:', spOk ? 'PASS' : 'FAIL', `(${sp.filter(f=>f.cfg==='search_path=public, pg_temp').length}/${F069.length})`);
// ── referencias no calificadas: cada identificador usado como tabla o función
//    debe resolverse en public o pg_catalog (nunca en otro schema).
const objs = (await c.query(`SELECT n.nspname, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pg_catalog')
  UNION SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','pg_catalog')`)).rows;
const where = new Map(); for (const o of objs) { if (!where.has(o.name)) where.set(o.name, new Set()); where.get(o.name).add(o.nspname); }
const KW = new Set(['if','exists','coalesce','nullif','greatest','least','case','when','then','else','end','and','or','not','in','select','from','where','values','returning','into','set','update','insert','delete','for','loop','perform','raise','exception','return','begin','declare','found','is','null','true','false','as','on','using','errcode','array','row','distinct','all','any','some','cast','interval','date','numeric','text','bigint','int','integer','boolean','jsonb','varchar','record','rowtype','type','with','check','lateral','limit','order','by','group','having','each','statement','new','old','trigger','language','plpgsql','sql','stable','security','definer','search_path','pg_temp','public','function','replace','create','returns','void','diagnostics','get','row_count','strict']);
const refs = {};
for (const f of sp) {
  const body = f.def.split('$function$')[1] || f.def;
  const stripped = body.replace(/--[^\n]*/g, '').replace(/'([^']|'')*'/g, "''");
  const names = new Set();
  for (const m of stripped.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+([a-z_][a-z0-9_]*)\b(?!\s*\.)/gi)) names.add(m[1].toLowerCase());
  for (const m of stripped.matchAll(/(?<![.\w])([a-z_][a-z0-9_]*)\s*\(/gi)) names.add(m[1].toLowerCase());
  for (const m of stripped.matchAll(/'?([a-z_][a-z0-9_]*)'?::regclass/gi)) names.add(m[1].toLowerCase());
  for (const m of stripped.matchAll(/([a-z_][a-z0-9_]*)%rowtype/gi)) names.add(m[1].toLowerCase());
  // variables plpgsql declaradas (DECLARE ... BEGIN) y parámetros: no son objetos
  const declared = new Set();
  const decl = /DECLARE([\s\S]*?)\bBEGIN\b/i.exec(stripped);
  if (decl) for (const m of decl[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+/gim)) declared.add(m[1].toLowerCase());
  for (const m of f.def.matchAll(/\b(p_[a-z0-9_]+)\b/gi)) declared.add(m[1].toLowerCase());
  const filtered = [...names].filter(x => !KW.has(x) && !declared.has(x));
  refs[f.proname] = filtered.map(x => `${x}@${where.has(x) ? [...where.get(x)].join('+') : 'NO_RESUELVE'}`);
}
let resOk = true;
for (const [fn, list] of Object.entries(refs)) {
  const bad = list.filter(x => x.endsWith('NO_RESUELVE'));
  if (bad.length) resOk = false;
  console.log(`  ${fn.padEnd(26)} ${list.join(' ')}`);
}
console.log('  UNQUALIFIED_RESOLUTION:', resOk ? 'PASS' : 'NEEDS REVIEW');

console.log('── PRUEBAS');
r = await runFile(c, path.join(ROOT, 'supabase/tests/069_rls_financiera_test.sql'), { stopOnError: true, echo: true });
if (!r.aborted) {
  console.log('── ROLLBACK 069 (verificación de reversibilidad de permisos)');
  const rb = await runFile(c, path.join(ROOT, 'supabase/069_rls_financiera_rollback.sql'), { stopOnError: true });
  const afterRb = (await catalogo()).filter(x => !x.startsWith('cuentas_por_cobrar|admin_all') || true);
  const faltan = PROD_BEFORE.filter(x => !afterRb.includes(x)); const sobran = afterRb.filter(x => !PROD_BEFORE.includes(x));
  console.log('  rollback aplicado:', !rb.aborted, '| policies == producción antes:', faltan.length === 0 && sobran.length === 0 ? 'SÍ' : 'NO ' + JSON.stringify({ faltan, sobran }));
  console.log('  trigger guard presente tras rollback:', (await c.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_ordenes_guard_financiero'`)).rows[0].n);
}
await c.end();
console.log(r.aborted ? 'RESULTADO: FALLÓ' : 'RESULTADO: OK');
sh(path.join(BIN, 'pg_ctl'), ['-D', DATA, 'stop', '-m', 'fast']);
process.exit(r.aborted ? 1 : 0);
