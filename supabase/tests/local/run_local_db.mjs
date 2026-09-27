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
const files = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => f.endsWith('.sql') && !skip.has(f) && !f.startsWith('069_')).sort((a, b) => {
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
  DROP INDEX IF EXISTS idx_clientes_rfc;
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

const after = await catalogo();
fs.writeFileSync(path.join(WORK, 'policies_after.txt'), after.join('\n'));
console.log('── policies DESPUÉS:', after.length);
console.log(after.map(x => '  ' + x).join('\n'));
console.log('── grants anon ledger:', (await c.query(`SELECT table_name||': '||string_agg(privilege_type, ',') AS g FROM information_schema.role_table_grants WHERE grantee='anon' AND table_name IN ('pagos','cuentas_por_cobrar','movimientos_contables') GROUP BY table_name`)).rows.map(x => x.g).join(' | ') || '(ninguno)');
console.log('── EXECUTE funciones:');
for (const row of (await c.query(`SELECT p.proname AS n, COALESCE(p.proacl::text,'NULL') AS acl FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('timbrar_orden','registrar_pago','increment_saldo','move_stock','check_orden_transition','crear_cxc_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','cerrar_ruta_atomic','fin_marcar_ctx','asignar_orden') ORDER BY 1`)).rows) console.log('  ' + row.n.padEnd(26), row.acl);
console.log('── triggers:', (await c.query(`SELECT tgrelid::regclass||':'||tgname AS t FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('ordenes','pagos','cuentas_por_cobrar')`)).rows.map(x => x.t).join(', '));

// ── search_path de las funciones SECURITY DEFINER de 069 (catálogo real)
const F069 = ['fin_mi_rol_activo','fin_actor_permitido','increment_saldo','crear_cxc_orden','registrar_ingreso_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','cerrar_ruta_atomic','ordenes_guard_financiero'];
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
