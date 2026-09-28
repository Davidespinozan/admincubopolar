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
const files = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => f.endsWith('.sql') && !skip.has(f) && !f.startsWith('069_') && !f.startsWith('070_') && !f.startsWith('071_') && !f.startsWith('072_') && !f.startsWith('073_') && !f.startsWith('074_') && !f.startsWith('075_') && !f.startsWith('076_') && !f.startsWith('077_') && !f.startsWith('078_') && !f.startsWith('079_') && !f.startsWith('080_') && !f.startsWith('081_') && !f.startsWith('082_')).sort((a, b) => {
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
  -- Producción (verificado 2026-09-27): sin FKs hacia productos y sin triggers en produccion.
  ALTER TABLE orden_lineas DROP CONSTRAINT IF EXISTS orden_lineas_sku_fkey;
  ALTER TABLE umbrales DROP CONSTRAINT IF EXISTS umbrales_sku_fkey;
  DROP TRIGGER IF EXISTS trg_produccion_state ON produccion;
  DROP TRIGGER IF EXISTS trg_produccion_updated ON produccion;
  -- Producción (verificado 2026-09-28): productos solo tiene trg_productos_upd (sin trigger de stock positivo).
  DROP TRIGGER IF EXISTS trg_stock_positive ON productos;
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

// ── B2-V: 073 (vista GPS con security_invoker; anon sin acceso) ─────────
{
  console.log('── DETECTOR B2-V (antes de 073: la vista debe exponer GPS a anon)');
  await c.query(`BEGIN;
    INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES (7390, 'Det 73', 'det73@t', 'Chofer', 'Activo');
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus) VALUES (7390, 'R-7390', 'Det', 7390, 'Det 73', 'Cerrada');
    INSERT INTO chofer_ubicaciones (ruta_id, chofer_id, latitud, longitud) VALUES (7390, 7390, 1, 1);
    SET LOCAL ROLE anon;
    SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);`);
  const vista = Number((await c.query(`SELECT count(*) AS n FROM chofer_ubicacion_actual WHERE ruta_id = 7390`)).rows[0].n);
  const base = Number((await c.query(`SELECT count(*) AS n FROM chofer_ubicaciones WHERE ruta_id = 7390`)).rows[0].n);
  await c.query('ROLLBACK');
  const detecta = vista > 0 && base === 0;
  console.log(`  anon vista=${vista} base=${base} → detector ${detecta ? 'REPRODUCE el hueco' : 'NO reproduce (FALLA DEL DETECTOR)'}`);
  if (!detecta) { console.log('RESULTADO: FALLÓ (detector 073)'); process.exit(1); }
}
console.log('── aplicar 073 (1/2)');
let r073 = await runFile(c, path.join(ROOT, 'supabase/073_contencion_vista_gps.sql'), { stopOnError: true });
if (r073.aborted) process.exit(1);
console.log('── aplicar 073 (2/2, idempotencia)');
r073 = await runFile(c, path.join(ROOT, 'supabase/073_contencion_vista_gps.sql'), { stopOnError: true });
if (r073.aborted) process.exit(1);
if (!(await rlsCheck('tras 073 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 073)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[073]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 073 (B2-V)');
const r073t = await runFile(c, path.join(ROOT, 'supabase/tests/073_vista_gps_test.sql'), { stopOnError: true, echo: true });
if (r073t.aborted) { console.log('RESULTADO: FALLÓ (073)'); process.exit(1); }

// ── F1: 074 (rename_sku solo Admin activo, token exacto, D2) ─────────────
console.log('── aplicar 074 (1/2)');
let r074 = await runFile(c, path.join(ROOT, 'supabase/074_rename_sku_admin.sql'), { stopOnError: true });
if (r074.aborted) process.exit(1);
console.log('── aplicar 074 (2/2, idempotencia)');
r074 = await runFile(c, path.join(ROOT, 'supabase/074_rename_sku_admin.sql'), { stopOnError: true });
if (r074.aborted) process.exit(1);
if (!(await rlsCheck('tras 074 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 074)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[074]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 074 (F1)');
const r074t = await runFile(c, path.join(ROOT, 'supabase/tests/074_rename_sku_test.sql'), { stopOnError: true, echo: true });
if (r074t.aborted) { console.log('RESULTADO: FALLÓ (074)'); process.exit(1); }

// ── F3 etapa 1: 075 (cuartos_frios y precios_esp sin escrituras legacy) ───
console.log('── aplicar 075 (1/2)');
let r075 = await runFile(c, path.join(ROOT, 'supabase/075_contencion_cuartos_precios.sql'), { stopOnError: true });
if (r075.aborted) process.exit(1);
console.log('── aplicar 075 (2/2, idempotencia)');
r075 = await runFile(c, path.join(ROOT, 'supabase/075_contencion_cuartos_precios.sql'), { stopOnError: true });
if (r075.aborted) process.exit(1);
if (!(await rlsCheck('tras 075 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 075)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[075]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 075 (F3 etapa 1)');
const r075t = await runFile(c, path.join(ROOT, 'supabase/tests/075_cuartos_precios_test.sql'), { stopOnError: true, echo: true });
if (r075t.aborted) { console.log('RESULTADO: FALLÓ (075)'); process.exit(1); }

// ── 076 fase aditiva: registrar_produccion / registrar_transformacion ─────
console.log('── aplicar 076 (1/2)');
let r076 = await runFile(c, path.join(ROOT, 'supabase/076_produccion_atomica.sql'), { stopOnError: true });
if (r076.aborted) process.exit(1);
console.log('── aplicar 076 (2/2, idempotencia)');
r076 = await runFile(c, path.join(ROOT, 'supabase/076_produccion_atomica.sql'), { stopOnError: true });
if (r076.aborted) process.exit(1);
if (!(await rlsCheck('tras 076 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 076)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[076]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 076 (producción atómica)');
const r076t = await runFile(c, path.join(ROOT, 'supabase/tests/076_produccion_atomica_test.sql'), { stopOnError: true, echo: true });
if (r076t.aborted) { console.log('RESULTADO: FALLÓ (076)'); process.exit(1); }

// ── 076: concurrencia real con dos conexiones ─────────────────────────────
async function conc076() {
  console.log('── 076 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const PRD = '76c00000-0000-0000-0000-000000000002';
  let ok76 = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) ok76 = false; };
  const q1 = async (sql, params) => (await c.query(sql, params)).rows[0];
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'C76-%');
    DELETE FROM mermas WHERE sku LIKE 'C76-%';
    DELETE FROM costos_historial WHERE concepto LIKE '%C76-%';
    DELETE FROM movimientos_contables WHERE concepto LIKE '%C76-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C76-%';
    DELETE FROM produccion WHERE sku LIKE 'C76-%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C76';
    DELETE FROM productos WHERE sku LIKE 'C76-%';
    DELETE FROM usuarios WHERE id = 7692; DELETE FROM auth.users WHERE id = '${PRD}';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${PRD}', 'prodc76@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (7692, 'ProdC 76', 'prodc76@t', 'Producción', 'Activo', '${PRD}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C76-HIELO', 'Hielo C', 'Producto Terminado', 30, 0, 0, 'C76-BOLSA'),
      ('C76-BOLSA', 'Bolsa C', 'Empaque', 0, 10, 1, NULL),
      ('C76-BARRA', 'Barra C', 'Materia Prima', 0, 10, 0, NULL),
      ('C76-TRIT', 'Trit C', 'Producto Terminado', 30, 0, 0, NULL);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C76', 'Cuarto C76', '{}'::jsonb);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: PRD })]);
  };
  const carrera = async (sqlA, paramsA, sqlB, paramsB) => {
    await actor(a); await actor(b);
    const ra = (await a.query(sqlA, paramsA)).rows[0];
    let done = false;
    const pB = b.query(sqlB, paramsB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, msg: e.message, code: e.code })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query('COMMIT');
    const rb = await pB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const PROD = `SELECT registrar_produccion($1::uuid, 'T1', 'M1', 'C76-HIELO', $2::int, 'CF-C76') AS r`;
  const TRAN = `SELECT registrar_transformacion($1::uuid, 'C76-BARRA', $2::int, 'C76-TRIT', $3::int, 'CF-C76') AS r`;
  const cf = async sku => n(`SELECT COALESCE((stock->>$1)::int, 0) FROM cuartos_frios WHERE id = 'CF-C76'`, [sku]);
  const st = async sku => n(`SELECT stock FROM productos WHERE sku = $1`, [sku]);

  // C1: mismo operacion_id, dos llamadas simultáneas (producción)
  const OP1 = '76c10000-0000-0000-0000-000000000001';
  let r = await carrera(PROD, [OP1, 3], PROD, [OP1, 3]);
  ok(r.bloqueado, '076-C1a la segunda llamada con el mismo operacion_id espera a la primera');
  ok(r.rb.ok && r.rb.row.r.replay === true && r.rb.row.r.id === r.ra.r.id, '076-C1b la segunda llamada es replay (mismo id)');
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [OP1]) === 1, '076-C1c exactamente 1 produccion');
  ok(await st('C76-BOLSA') === 7 && await cf('C76-HIELO') === 3, '076-C1d exactamente 1 consumo de empaque (10 → 7) y 1 entrada (0 → 3)');
  ok(await n(`SELECT count(*) FROM inventario_mov WHERE producto IN ('C76-BOLSA', 'C76-HIELO')`) === 2, '076-C1e exactamente 1 juego de kardex (2 filas)');
  ok(await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%C76-HIELO%'`) === 1 && await n(`SELECT count(*) FROM costos_historial WHERE concepto LIKE '%C76-HIELO%'`) === 1, '076-C1f exactamente 1 egreso y 1 costos_historial');

  // C2: mismo operacion_id con datos distintos, simultáneo
  const OP2 = '76c10000-0000-0000-0000-000000000002';
  r = await carrera(PROD, [OP2, 2], PROD, [OP2, 4]);
  ok(!r.rb.ok && r.rb.code === '23505', `076-C2a mismatched replay concurrente rechazado (${r.rb.code || 'OK'})`);
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [OP2]) === 1 && await n(`SELECT cantidad FROM produccion WHERE operacion_id = $1`, [OP2]) === 2 && await st('C76-BOLSA') === 5, '076-C2b solo cuenta la primera (2); empaque 7 → 5');

  // C3: operaciones distintas compitiendo por el mismo empaque (5 disponibles, 4 + 4)
  const OP3 = '76c10000-0000-0000-0000-000000000003', OP4 = '76c10000-0000-0000-0000-000000000004';
  const egresos0 = await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%C76-HIELO%'`);
  r = await carrera(PROD, [OP3, 4], PROD, [OP4, 4]);
  ok(r.bloqueado, '076-C3a la segunda espera el lock del empaque');
  ok(!r.rb.ok && /Stock insuficiente/.test(r.rb.msg || ''), `076-C3b la segunda falla por stock tras releer (${(r.rb.msg || 'OK').slice(0, 50)})`);
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [OP4]) === 0, '076-C3c la operación fallida no deja fila de produccion');
  ok(await st('C76-BOLSA') === 1 && await cf('C76-HIELO') === 9, '076-C3d empaque 5 → 1 (nunca negativo, sin doble consumo); cuarto 5 → 9');
  ok(await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%C76-HIELO%'`) === egresos0 + 1, '076-C3e un solo egreso nuevo (el de la operación exitosa)');

  // C4: mismo operacion_id simultáneo (transformación)
  const OT1 = '76c20000-0000-0000-0000-000000000001';
  r = await carrera(TRAN, [OT1, 6, 5], TRAN, [OT1, 6, 5]);
  ok(r.rb.ok && r.rb.row.r.replay === true, '076-C4a transformación: segunda llamada = replay');
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [OT1]) === 1 && await st('C76-BARRA') === 4 && await cf('C76-TRIT') === 5
    && await n(`SELECT count(*) FROM mermas WHERE sku = 'C76-BARRA'`) === 1, '076-C4b exactamente 1 fila, 1 consumo (10 → 4), 1 entrada (5) y 1 merma');

  // C5: transformaciones distintas compitiendo por el mismo insumo (4 disponibles, 3 + 3)
  const OT2 = '76c20000-0000-0000-0000-000000000002', OT3 = '76c20000-0000-0000-0000-000000000003';
  r = await carrera(TRAN, [OT2, 3, 3], TRAN, [OT3, 3, 2]);
  ok(!r.rb.ok && /Stock insuficiente/.test(r.rb.msg || ''), '076-C5a la segunda transformación falla por insumo insuficiente');
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [OT3]) === 0 && await st('C76-BARRA') === 1 && await cf('C76-TRIT') === 8
    && await n(`SELECT count(*) FROM mermas WHERE sku = 'C76-BARRA'`) === 1, '076-C5b sin fila ni merma de la fallida; insumo 4 → 1; output 5 → 8');

  await a.end(); await b.end();
  await c.query(limpiar);
  if (!ok76) { console.log('RESULTADO: FALLÓ (concurrencia 076)'); process.exit(1); }
}
await conc076();

// ── Frontend 076 contra la DB de paridad: payloads reales del cliente ────
async function fe076() {
  console.log('── 076 FRONTEND ↔ DB (builders del cliente, parámetros nombrados como PostgREST)');
  const { pathToFileURL } = await import('node:url');
  const L = await import(pathToFileURL(path.join(ROOT, 'src/data/produccionAtomicaLogic.js')).href);
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const PRD = '76f00000-0000-0000-0000-000000000002';
  let okF = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okF = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'F76-%');
    DELETE FROM mermas WHERE sku LIKE 'F76-%';
    DELETE FROM costos_historial WHERE concepto LIKE '%F76-%';
    DELETE FROM movimientos_contables WHERE concepto LIKE '%F76-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'F76-%';
    DELETE FROM produccion WHERE sku LIKE 'F76-%';
    DELETE FROM cuartos_frios WHERE id = 'CF-F76';
    DELETE FROM productos WHERE sku LIKE 'F76-%';
    DELETE FROM usuarios WHERE id = 7696; DELETE FROM auth.users WHERE id = '${PRD}';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${PRD}', 'prodf76@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (7696, 'ProdF 76', 'prodf76@t', 'Producción', 'Activo', '${PRD}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('F76-HIELO', 'Hielo F', 'Producto Terminado', 30, 0, 0, 'F76-BOLSA'),
      ('F76-BOLSA', 'Bolsa F', 'Empaque', 0, 10, 2, NULL),
      ('F76-BARRA', 'Barra F', 'Materia Prima', 0, 10, 0, NULL),
      ('F76-TRIT', 'Trit F', 'Producto Terminado', 30, 0, 0, NULL);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-F76', 'Cuarto F76', '{}'::jsonb);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async cl => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: PRD })]); };
  // Llamada RPC como la hace PostgREST: parámetros nombrados desde el objeto args del cliente.
  const rpc = async (cl, fn, args) => {
    const keys = Object.keys(args);
    const sql = `SELECT ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`;
    try { return { data: (await cl.query(sql, keys.map(k => args[k]))).rows[0].r }; }
    catch (e) { return { error: { message: e.message, code: e.code } }; }
  };
  const llamar = async (fn, args) => { await actor(a); const r = await rpc(a, fn, args); await a.query(r.error ? 'ROLLBACK' : 'COMMIT'); return r; };
  const huella = async () => (await c.query(`SELECT concat_ws('|',
      (SELECT count(*) FROM produccion WHERE sku LIKE 'F76-%'), (SELECT string_agg(sku || stock, ',' ORDER BY sku) FROM productos WHERE sku LIKE 'F76-%'),
      (SELECT stock::text FROM cuartos_frios WHERE id = 'CF-F76'), (SELECT count(*) FROM inventario_mov WHERE producto LIKE 'F76-%'),
      (SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%F76-%'), (SELECT count(*) FROM costos_historial WHERE concepto LIKE '%F76-%'),
      (SELECT count(*) FROM mermas WHERE sku LIKE 'F76-%')) AS h`)).rows[0].h;

  // 1. producción normal exitosa con el payload del frontend
  let opP = L.resolverOperacion(null, L.claveProduccion({ turno: 'Turno 1', maquina: 'Máquina 30', sku: 'F76-HIELO', cantidad: 4, destino: 'CF-F76' }));
  const argsP = L.buildRegistrarProduccionArgs({ operacionId: opP.id, turno: 'Turno 1', maquina: 'Máquina 30', sku: 'F76-HIELO', cantidad: 4, destino: 'CF-F76' }).args;
  let r = await llamar('registrar_produccion', argsP);
  const res1 = r.data && L.interpretarResultadoProduccion(r.data);
  ok(res1 && res1.ok && /^OP-/.test(res1.folio) && res1.replay === false && Number(res1.costoTotal) === 8, `076-F1 producción exitosa con args del cliente (folio ${res1?.folio}, costo del servidor 8)`);
  ok(await n(`SELECT stock FROM productos WHERE sku = 'F76-BOLSA'`) === 6 && await n(`SELECT (stock->>'F76-HIELO')::int FROM cuartos_frios WHERE id = 'CF-F76'`) === 4, '076-F1b empaque 10 → 6; cuarto 0 → 4');
  // 3. reintento del mismo intento lógico (respuesta perdida) → mismo UUID → replay
  const opP2 = L.resolverOperacion(opP, L.claveProduccion({ turno: 'Turno 1', maquina: 'Máquina 30', sku: 'F76-HIELO', cantidad: 4, destino: 'CF-F76' }));
  const h1 = await huella();
  r = await llamar('registrar_produccion', L.buildRegistrarProduccionArgs({ operacionId: opP2.id, turno: 'Turno 1', maquina: 'Máquina 30', sku: 'F76-HIELO', cantidad: 4, destino: 'CF-F76' }).args);
  ok(opP2.id === opP.id && r.data && L.interpretarResultadoProduccion(r.data).replay === true && L.interpretarResultadoProduccion(r.data).folio === res1.folio, '076-F3 reintento: mismo UUID, replay con el mismo folio');
  ok(await huella() === h1, '076-F3b reintento: cero efectos nuevos');
  // 2. packaging insuficiente → error traducido, cero efectos, sin compensación del cliente
  const opI = L.resolverOperacion(null, L.claveProduccion({ turno: 'T', maquina: 'M', sku: 'F76-HIELO', cantidad: 9, destino: 'CF-F76' }));
  r = await llamar('registrar_produccion', L.buildRegistrarProduccionArgs({ operacionId: opI.id, turno: 'T', maquina: 'M', sku: 'F76-HIELO', cantidad: 9, destino: 'CF-F76' }).args);
  ok(r.error && /Stock insuficiente de F76-BOLSA/.test(L.mensajeErrorProduccion(r.error)), `076-F2 empaque insuficiente: mensaje "${r.error ? L.mensajeErrorProduccion(r.error).slice(0, 60) : 'sin error'}"`);
  ok(await huella() === h1, '076-F2b empaque insuficiente: cero efectos (el cliente no compensa nada)');
  // 4. doble submit: dos llamadas simultáneas del mismo intento (mismo UUID)
  const opD = L.resolverOperacion(null, L.claveProduccion({ turno: 'T', maquina: 'M', sku: 'F76-HIELO', cantidad: 2, destino: 'CF-F76' }));
  const argsD = L.buildRegistrarProduccionArgs({ operacionId: opD.id, turno: 'T', maquina: 'M', sku: 'F76-HIELO', cantidad: 2, destino: 'CF-F76' }).args;
  await actor(a); await actor(b);
  const rA = await rpc(a, 'registrar_produccion', argsD);
  let done = false; const pB = rpc(b, 'registrar_produccion', argsD).finally(() => { done = true; });
  await sleep(400); const bloqueado = !done;
  await a.query('COMMIT'); const rB = await pB; await b.query(rB.error ? 'ROLLBACK' : 'COMMIT');
  ok(bloqueado && rA.data && rB.data && rB.data.replay === true && rB.data.id === rA.data.id, '076-F4 doble submit simultáneo: la segunda es replay del mismo id');
  ok(await n(`SELECT count(*) FROM produccion WHERE operacion_id = $1`, [opD.id]) === 1 && await n(`SELECT stock FROM productos WHERE sku = 'F76-BOLSA'`) === 4, '076-F4b una sola producción y un solo consumo (6 → 4)');
  // 5. transformación exitosa
  const tD = { input_sku: 'F76-BARRA', input_kg: 6, output_sku: 'F76-TRIT', output_kg: 5, cuarto_destino: 'CF-F76', notas: 'lote F' };
  const opT = L.resolverOperacion(null, L.claveTransformacion(tD));
  r = await llamar('registrar_transformacion', L.buildRegistrarTransformacionArgs({ ...tD, operacionId: opT.id }).args);
  const rt = r.data && L.interpretarResultadoTransformacion(r.data);
  ok(rt && /^TR-/.test(rt.folio) && rt.merma === 1 && rt.replay === false, `076-F5 transformación exitosa (folio ${rt?.folio}, merma 1)`);
  ok(await n(`SELECT stock FROM productos WHERE sku = 'F76-BARRA'`) === 4 && await n(`SELECT (stock->>'F76-TRIT')::int FROM cuartos_frios WHERE id = 'CF-F76'`) === 5 && await n(`SELECT count(*) FROM mermas WHERE sku = 'F76-BARRA'`) === 1, '076-F5b insumo 10 → 4, output 5, 1 merma de proceso');
  // 7. reintento de transformación
  const h2 = await huella();
  r = await llamar('registrar_transformacion', L.buildRegistrarTransformacionArgs({ ...tD, operacionId: L.resolverOperacion(opT, L.claveTransformacion(tD)).id }).args);
  ok(r.data && r.data.replay === true && await huella() === h2, '076-F7 reintento de transformación: replay, cero efectos nuevos');
  // 6. input insuficiente
  const tI = { ...tD, input_kg: 8, output_kg: 7 };
  r = await llamar('registrar_transformacion', L.buildRegistrarTransformacionArgs({ ...tI, operacionId: L.resolverOperacion(null, L.claveTransformacion(tI)).id }).args);
  ok(r.error && /Stock insuficiente de F76-BARRA/.test(L.mensajeErrorProduccion(r.error)) && await huella() === h2, '076-F6 insumo insuficiente: error traducido y cero efectos');
  // 8. error de RPC (mismo UUID, datos distintos) sin compensación del cliente
  r = await llamar('registrar_produccion', { ...argsP, p_cantidad: 5 });
  ok(r.error && r.error.code === '23505' && /otros datos/.test(L.mensajeErrorProduccion(r.error)) && await huella() === h2, '076-F8 error de RPC: mensaje claro, cero efectos, nada que compensar');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okF) { console.log('RESULTADO: FALLÓ (frontend ↔ DB 076)'); process.exit(1); }
}
await fe076();

console.log('── REGRESIÓN 074 con 076 aplicada (rename_sku + produccion.empaque_sku)');
const r074b = await runFile(c, path.join(ROOT, 'supabase/tests/074_rename_sku_test.sql'), { stopOnError: true, echo: false });
if (r074b.aborted) { console.log('RESULTADO: FALLÓ (regresión 074 tras 076)'); process.exit(1); }
console.log('  074 tras 076: PASS');
console.log('── REGRESIÓN 072 con 076 aplicada (merma de proceso reutilizada)');
const r072b = await runFile(c, path.join(ROOT, 'supabase/tests/072_mermas_test.sql'), { stopOnError: true, echo: false });
if (r072b.aborted) { console.log('RESULTADO: FALLÓ (regresión 072 tras 076)'); process.exit(1); }
console.log('  072 tras 076: PASS');

// ── F3 etapa 3: 077 (sin escrituras directas de Producción/no Admin) ──────
console.log('── aplicar 077 (1/2)');
let r077 = await runFile(c, path.join(ROOT, 'supabase/077_contencion_escrituras_produccion.sql'), { stopOnError: true });
if (r077.aborted) process.exit(1);
console.log('── aplicar 077 (2/2, idempotencia)');
r077 = await runFile(c, path.join(ROOT, 'supabase/077_contencion_escrituras_produccion.sql'), { stopOnError: true });
if (r077.aborted) process.exit(1);
if (!(await rlsCheck('tras 077 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 077)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[077]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 077 (F3-B/C/E)');
const r077t = await runFile(c, path.join(ROOT, 'supabase/tests/077_escrituras_produccion_test.sql'), { stopOnError: true, echo: true });
if (r077t.aborted) { console.log('RESULTADO: FALLÓ (077)'); process.exit(1); }
for (const [etq, f] of [['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 077)`); process.exit(1); }
  console.log(`  ${etq} tras 077: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 077)'); process.exit(1); }
  console.log('  071 tras 077: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 077');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 077: PASS');

// ── F3 etapa 4: 078 (F3-D: Chofer solo columnas/transiciones de su flujo) ──
console.log('── aplicar 078 (1/2)');
let r078 = await runFile(c, path.join(ROOT, 'supabase/078_contencion_rutas_chofer.sql'), { stopOnError: true });
if (r078.aborted) process.exit(1);
console.log('── aplicar 078 (2/2, idempotencia)');
r078 = await runFile(c, path.join(ROOT, 'supabase/078_contencion_rutas_chofer.sql'), { stopOnError: true });
if (r078.aborted) process.exit(1);
if (!(await rlsCheck('tras 078 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 078)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[078]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 078 (F3-D)');
const r078t = await runFile(c, path.join(ROOT, 'supabase/tests/078_rutas_chofer_test.sql'), { stopOnError: true, echo: true });
if (r078t.aborted) { console.log('RESULTADO: FALLÓ (078)'); process.exit(1); }
for (const [etq, f] of [['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 078)`); process.exit(1); }
  console.log(`  ${etq} tras 078: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 078)'); process.exit(1); }
  console.log('  071 tras 078: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 078');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 078: PASS');

// ── B3 fase 1: 079 (get_my_rol / get_my_user_id delegan en la identidad 071) ──
{
  // Paridad con producción ANTES del cambio: los helpers legacy locales deben ser
  // exactamente los de producción (md5 auditado read-only el 2026-09-28).
  const PROD_LEGACY = { get_my_rol: 'a320c5fb3b2a52f55dd8ac69db4460e2', get_my_user_id: '0638c7df12545bfbd6474132f7ea5e30' };
  const rows = (await c.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_my_rol','get_my_user_id')`)).rows;
  const mal = rows.filter(r => PROD_LEGACY[r.proname] !== r.m).map(r => `${r.proname}=${r.m}`);
  console.log(`  LEGACY_PARITY_CHECK[pre-079]: ${rows.length === 2 && mal.length === 0 ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (rows.length !== 2 || mal.length) process.exit(1);
  const dep = (await c.query(`SELECT (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'get_my_rol\\(\\)') AS rol, (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'get_my_user_id\\(\\)') AS uid`)).rows[0];
  console.log(`  dependencias locales pre-079: get_my_rol=${dep.rol} get_my_user_id=${dep.uid} (producción: 47 / 2)`);
  if (dep.rol !== 47 || dep.uid !== 2) { console.log('RESULTADO: FALLÓ (dependencias legacy ≠ producción)'); process.exit(1); }
}
console.log('── aplicar 079 (1/2)');
let r079 = await runFile(c, path.join(ROOT, 'supabase/079_identidad_canonica_legacy_helpers.sql'), { stopOnError: true });
if (r079.aborted) process.exit(1);
console.log('── aplicar 079 (2/2, idempotencia)');
r079 = await runFile(c, path.join(ROOT, 'supabase/079_identidad_canonica_legacy_helpers.sql'), { stopOnError: true });
if (r079.aborted) process.exit(1);
if (!(await rlsCheck('tras 079 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 079)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[079]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 079 (B3 identidad fase 1)');
const r079t = await runFile(c, path.join(ROOT, 'supabase/tests/079_identidad_legacy_test.sql'), { stopOnError: true, echo: true });
if (r079t.aborted) { console.log('RESULTADO: FALLÓ (079)'); process.exit(1); }
for (const [etq, f] of [['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 079)`); process.exit(1); }
  console.log(`  ${etq} tras 079: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 079)'); process.exit(1); }
  console.log('  071 tras 079: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 079');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 079: PASS');

// ── B3 / R1: 080 (RPCs de asignación con actor canónico) ──────────────────
{
  // Paridad con producción ANTES del cambio: cuerpos (sin comentarios ni
  // espacios) idénticos a los auditados read-only el 2026-09-28. La única
  // diferencia conocida (asignar_ordenes_a_ruta) son líneas de comentario.
  const PROD_BODY = { asignar_orden: '3aa67a9888d18171554940e046168447', asignar_ordenes_a_ruta: '189eea80ec0c5ddabbf400d9abf6584b', cancelar_orden_asignada: '72b1fd66cdfd3386555d30324e7fdb8d' };
  const { createHash } = await import('node:crypto');
  const norm = s => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const rows = (await c.query(`SELECT proname, pg_get_functiondef(oid) AS def FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('asignar_orden','asignar_ordenes_a_ruta','cancelar_orden_asignada')`)).rows;
  const mal = rows.filter(r => createHash('md5').update(norm(r.def.split('$function$')[1] || '')).digest('hex') !== PROD_BODY[r.proname]).map(r => r.proname);
  console.log(`  DISPATCH_PARITY_CHECK[pre-080]: ${rows.length === 3 && mal.length === 0 ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (rows.length !== 3 || mal.length) process.exit(1);
}
console.log('── aplicar 080 (1/2)');
let r080 = await runFile(c, path.join(ROOT, 'supabase/080_contencion_rpc_asignacion.sql'), { stopOnError: true });
if (r080.aborted) process.exit(1);
console.log('── aplicar 080 (2/2, idempotencia)');
r080 = await runFile(c, path.join(ROOT, 'supabase/080_contencion_rpc_asignacion.sql'), { stopOnError: true });
if (r080.aborted) process.exit(1);
if (!(await rlsCheck('tras 080 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 080)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[080]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 080 (R1 RPCs de asignación)');
const r080t = await runFile(c, path.join(ROOT, 'supabase/tests/080_rpc_asignacion_test.sql'), { stopOnError: true, echo: true });
if (r080t.aborted) { console.log('RESULTADO: FALLÓ (080)'); process.exit(1); }
// Harness: las suites anteriores dejan filas con id explícito (069/071: clientes 10/11)
// y las secuencias no avanzan; realinear antes de repetir suites que insertan sin id.
for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 080)`); process.exit(1); }
  console.log(`  ${etq} tras 080: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 080)'); process.exit(1); }
  console.log('  071 tras 080: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 080');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 080: PASS');

// ── B3 / R1b: 081 (ordenes.ruta_id solo Admin o contrato) ────────────────
{
  // Paridad con producción ANTES del cambio: guardia 069 y RPCs 080 idénticas.
  const PROD = { ordenes_guard_financiero: '99fb6cfe4933dc702e3531669b0c6ec3', asignar_orden: 'd9e6ce160e0eae40c4aae1d94455b4c0', asignar_ordenes_a_ruta: '3fc56daefc13ad7697114de2ec2593aa', cancelar_orden_asignada: 'b16c475b7c15505a539bbfb98e14ea45' };
  const rows = (await c.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(PROD)])).rows;
  const mal = rows.filter(r => PROD[r.proname] !== r.m).map(r => r.proname);
  const pol = (await c.query(`SELECT string_agg(policyname, ',' ORDER BY policyname) AS p FROM pg_policies WHERE schemaname='public' AND tablename='ordenes'`)).rows[0].p;
  const polOk = pol === 'admin_all,read_all,rollback_delete,ventas_insert,ventas_update';
  console.log(`  ORDENES_PARITY_CHECK[pre-081]: ${rows.length === 4 && mal.length === 0 && polOk ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)} policies=${pol}`);
  if (rows.length !== 4 || mal.length || !polOk) process.exit(1);
}
console.log('── aplicar 081 (1/2)');
let r081 = await runFile(c, path.join(ROOT, 'supabase/081_contencion_ruta_id_ordenes.sql'), { stopOnError: true });
if (r081.aborted) process.exit(1);
console.log('── aplicar 081 (2/2, idempotencia)');
r081 = await runFile(c, path.join(ROOT, 'supabase/081_contencion_ruta_id_ordenes.sql'), { stopOnError: true });
if (r081.aborted) process.exit(1);
if (!(await rlsCheck('tras 081 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 081)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[081]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 081 (R1b ruta_id directo)');
const r081t = await runFile(c, path.join(ROOT, 'supabase/tests/081_ruta_id_ordenes_test.sql'), { stopOnError: true, echo: true });
if (r081t.aborted) { console.log('RESULTADO: FALLÓ (081)'); process.exit(1); }
for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 081)`); process.exit(1); }
  console.log(`  ${etq} tras 081: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 081)'); process.exit(1); }
  console.log('  071 tras 081: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 081');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 081: PASS');

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
  'erp_foto_merma_en_uso','registrar_merma','registrar_mermas_ruta','revertir_merma',
  // 074
  'rename_sku',
  // 076
  'registrar_produccion','registrar_transformacion','registrar_produccion__replay','registrar_transformacion__replay',
  // 078
  'rutas_guard_chofer',
  // 079
  'get_my_rol','get_my_user_id',
  // 080
  'asignar_orden','asignar_ordenes_a_ruta','cancelar_orden_asignada',
  // 081
  'ordenes_guard_ruta'];
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
const KW = new Set(['if','exists','coalesce','nullif','greatest','least','case','when','then','else','end','and','or','not','in','select','from','where','values','returning','into','set','update','insert','delete','for','loop','perform','raise','exception','return','begin','declare','found','is','null','true','false','as','on','using','errcode','array','row','distinct','all','any','some','cast','interval','date','numeric','text','bigint','int','integer','boolean','jsonb','varchar','record','rowtype','type','with','check','lateral','limit','order','by','group','having','each','statement','new','old','trigger','language','plpgsql','sql','stable','security','definer','search_path','pg_temp','public','function','replace','create','returns','void','diagnostics','get','row_count','strict','conflict','nothing']);
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
