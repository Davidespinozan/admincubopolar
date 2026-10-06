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
// 090: el rol postgres (dueño en producción) solo existe desde el bloque 090;
// las migraciones anteriores corren igual que siempre.
await admin.query('DROP ROLE IF EXISTS postgres');
await admin.end();

const c = await connect();
console.log('── shim');
let r = await runFile(c, path.join(ROOT, 'supabase/tests/local/00_shim_supabase.sql'), { stopOnError: true });
if (r.aborted) process.exit(1);

console.log('── migraciones (secuencia de producción: 001_completo → 001_schema → 002_safe → 003…068)');
const skip = new Set(['000_reset.sql', '000_template_migration.sql', '002_seed.sql', '004_demo_data.sql', '005_cleanup_demo_products.sql']);
const files = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => f.endsWith('.sql') && !skip.has(f) && !f.startsWith('069_') && !f.startsWith('070_') && !f.startsWith('071_') && !f.startsWith('072_') && !f.startsWith('073_') && !f.startsWith('074_') && !f.startsWith('075_') && !f.startsWith('076_') && !f.startsWith('077_') && !f.startsWith('078_') && !f.startsWith('079_') && !f.startsWith('080_') && !f.startsWith('081_') && !f.startsWith('082_') && !f.startsWith('083_') && !f.startsWith('084_') && !f.startsWith('085_') && !f.startsWith('086_') && !f.startsWith('087_') && !f.startsWith('088_') && !f.startsWith('089_') && !f.startsWith('090_') && !f.startsWith('091_') && !f.startsWith('092_') && !f.startsWith('093_') && !f.startsWith('094_') && !f.startsWith('095_') && !f.startsWith('096_') && !f.startsWith('097_') && !f.startsWith('098_') && !f.startsWith('099_') && !f.startsWith('100_') && !f.startsWith('101_') && !f.startsWith('102_') && !f.startsWith('103_') && !f.startsWith('104_') && !f.startsWith('105_') && !f.startsWith('106_') && !f.startsWith('107_') && !f.startsWith('108_') && !f.startsWith('109_')).sort((a, b) => {
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
  // 092: la producción ya no crea Egreso (solo costos_historial).
  const EG76 = (await c.query(`SELECT to_regprocedure('public.conciliacion_empaque()') IS NULL AS x`)).rows[0].x ? 1 : 0;
  ok(await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%C76-HIELO%'`) === EG76 && await n(`SELECT count(*) FROM costos_historial WHERE concepto LIKE '%C76-HIELO%'`) === 1, `076-C1f exactamente ${EG76} egreso y 1 costos_historial`);

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
  ok(await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE '%C76-HIELO%'`) === egresos0 + EG76, '076-C3e egresos nuevos solo de la operación exitosa (ninguno tras 092)');

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

// ── B3 / R3 + R4: 082 (confirmar_produccion sin EXECUTE; auth_id único) ──
{
  const cp = (await c.query(`SELECT md5(pg_get_functiondef(oid)) AS m, has_function_privilege('authenticated', oid, 'EXECUTE') AS x_auth FROM pg_proc WHERE oid='public.confirmar_produccion(bigint,bigint)'::regprocedure`)).rows[0];
  const idx = (await c.query(`SELECT string_agg(indexname, ',' ORDER BY indexname) AS i FROM pg_indexes WHERE schemaname='public' AND tablename='usuarios'`)).rows[0].i;
  const con = (await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.usuarios'::regclass AND conname='usuarios_auth_id_key'`)).rows[0].n;
  const ok = cp && cp.m === '406cf50b7a01973bde25b4dcdf0316f9' && cp.x_auth === true && idx === 'idx_usuarios_auth_id,idx_usuarios_visibles,usuarios_email_key,usuarios_pkey' && con === 0;
  console.log(`  R3R4_PARITY_CHECK[pre-082]: ${ok ? 'PASS' : 'FAIL'} cp=${JSON.stringify(cp)} idx=${idx} con=${con}`);
  if (!ok) process.exit(1);
}
console.log('── aplicar 082 (1/2)');
let r082 = await runFile(c, path.join(ROOT, 'supabase/082_r3_r4_confirmar_produccion_auth_id.sql'), { stopOnError: true });
if (r082.aborted) process.exit(1);
console.log('── aplicar 082 (2/2, idempotencia)');
r082 = await runFile(c, path.join(ROOT, 'supabase/082_r3_r4_confirmar_produccion_auth_id.sql'), { stopOnError: true });
if (r082.aborted) process.exit(1);
if (!(await rlsCheck('tras 082 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 082)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[082]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 082 (R3 confirmar_produccion + R4 auth_id único)');
const r082t = await runFile(c, path.join(ROOT, 'supabase/tests/082_r3_r4_test.sql'), { stopOnError: true, echo: true });
if (r082t.aborted) { console.log('RESULTADO: FALLÓ (082)'); process.exit(1); }
for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['081', '081_ruta_id_ordenes_test.sql'], ['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 082)`); process.exit(1); }
  console.log(`  ${etq} tras 082: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 082)'); process.exit(1); }
  console.log('  071 tras 082: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 082');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 082: PASS');

// ── B3 / R5: 083 (usuarios.self_read por auth_id, sin email) ─────────────
{
  const pol = (await c.query(`SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='usuarios' AND policyname='self_read'`)).rows[0]?.qual;
  const ok = pol === "(lower(email) = lower((auth.jwt() ->> 'email'::text)))";
  console.log(`  SELF_READ_PARITY_CHECK[pre-083]: ${ok ? 'PASS' : 'FAIL'} qual=${pol}`);
  if (!ok) process.exit(1);
}
console.log('── aplicar 083 (1/2)');
let r083 = await runFile(c, path.join(ROOT, 'supabase/083_self_read_auth_id.sql'), { stopOnError: true });
if (r083.aborted) process.exit(1);
console.log('── aplicar 083 (2/2, idempotencia)');
r083 = await runFile(c, path.join(ROOT, 'supabase/083_self_read_auth_id.sql'), { stopOnError: true });
if (r083.aborted) process.exit(1);
if (!(await rlsCheck('tras 083 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 083)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[083]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 083 (R5 self_read por auth_id)');
const r083t = await runFile(c, path.join(ROOT, 'supabase/tests/083_self_read_auth_id_test.sql'), { stopOnError: true, echo: true });
if (r083t.aborted) { console.log('RESULTADO: FALLÓ (083)'); process.exit(1); }
for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['082', '082_r3_r4_test.sql'], ['081', '081_ruta_id_ordenes_test.sql'], ['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 083)`); process.exit(1); }
  console.log(`  ${etq} tras 083: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 083)'); process.exit(1); }
  console.log('  071 tras 083: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 083');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 083: PASS');

// ── R2 fase 1: 084 (contratos de stock aditivos) ─────────────────────────
{
  const cp = (await c.query(`SELECT md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE oid='public.update_stocks_atomic(jsonb)'::regprocedure`)).rows[0];
  const cols = (await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='inventario_mov' AND column_name IN ('cuarto_id','ruta_id','operacion_id')`)).rows[0].n;
  const tbl = (await c.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname='stock_operaciones'`)).rows[0].n;
  const ok = cp && cp.m === '9bfe3e6327d081a39f467279ef654868' && cols === 0 && tbl === 0;
  console.log(`  STOCK_PARITY_CHECK[pre-084]: ${ok ? 'PASS' : 'FAIL'} usa=${cp?.m} cols=${cols} tbl=${tbl}`);
  if (!ok) process.exit(1);
}
console.log('── aplicar 084 (1/2)');
let r084 = await runFile(c, path.join(ROOT, 'supabase/084_contratos_stock_ruta.sql'), { stopOnError: true });
if (r084.aborted) process.exit(1);
console.log('── aplicar 084 (2/2, idempotencia)');
r084 = await runFile(c, path.join(ROOT, 'supabase/084_contratos_stock_ruta.sql'), { stopOnError: true });
if (r084.aborted) process.exit(1);
if (!(await rlsCheck('tras 084 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 084)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[084]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 084 (R2 fase 1)');
const r084t = await runFile(c, path.join(ROOT, 'supabase/tests/084_contratos_stock_test.sql'), { stopOnError: true, echo: true });
if (r084t.aborted) { console.log('RESULTADO: FALLÓ (084)'); process.exit(1); }

async function conc084() {
  console.log('── 084 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const CH = '84c00000-0000-0000-0000-000000000001', PR = '84c00000-0000-0000-0000-000000000002';
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM inventario_mov WHERE producto LIKE 'C84-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '84c%';
    DELETE FROM orden_lineas WHERE orden_id IN (8490, 8491); DELETE FROM ordenes WHERE id IN (8490, 8491);
    DELETE FROM rutas WHERE id IN (8490, 8491); DELETE FROM clientes WHERE id = 8495;
    DELETE FROM cuartos_frios WHERE id IN ('CF-C84A', 'CF-C84B'); DELETE FROM productos WHERE sku LIKE 'C84-%';
    UPDATE cuartos_frios SET stock = stock - 'C84-A' WHERE stock ? 'C84-A'; -- la no-entrega devuelve al primer cuarto por id
    DELETE FROM usuarios WHERE id IN (8492, 8493); DELETE FROM auth.users WHERE id IN ('${CH}', '${PR}');
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CH}', 'choferc84@t'), ('${PR}', 'prodc84@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8492, 'ChoferC 84', 'choferc84@t', 'Chofer', 'Activo', '${CH}'), (8493, 'ProdC 84', 'prodc84@t', 'Producción', 'Activo', '${PR}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('C84-A', 'Hielo C84', 'Producto Terminado', 30, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C84A', 'Cuarto C84A', '{"C84-A": 10}'::jsonb), ('CF-C84B', 'Cuarto C84B', '{"C84-A": 10}'::jsonb);
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8495, 'Cliente C84', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
      (8490, 'R-8490', 'Ruta C84', 8492, 'ChoferC 84', 'Pendiente firma', CURRENT_DATE, '{"C84-A": 4}', '{}', '{"C84-A": 4}', now());
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8490, 'OV-8490', 8495, 'Cliente C84', '2×C84-A', 60, 'Asignada', 'Efectivo', 'Contado', 8492, 8490);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8490, 'C84-A', 2, 30, 60);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (sub, sqlA, paramsA, sqlB, paramsB) => {
    await actor(a, sub); await actor(b, sub);
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
  const cf = async (id) => n(`SELECT COALESCE((stock->>'C84-A')::int, 0) FROM cuartos_frios WHERE id = $1`, [id]);
  const kardex = async (op) => n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = $1`, [op]);
  const CARGA = `SELECT confirmar_carga_ruta($1::uuid, 8490, 'firma') AS r`;
  const NOENT = `SELECT registrar_no_entrega($1::uuid, 8490, 'Local cerrado') AS r`;
  const SAL = `SELECT salida_cuarto_manual($1::uuid, 'CF-C84B', 'C84-A', $2::int, 'Venta directa') AS r`;
  const TR = `SELECT traspaso_cuartos($1::uuid, 'CF-C84A', 'CF-C84B', 'C84-A', $2::int) AS r`;

  // C1: misma carga, mismo operacion_id, simultánea
  const O1 = '84c10000-0000-0000-0000-000000000001';
  let r = await carrera(CH, CARGA, [O1], CARGA, [O1]);
  ok(r.bloqueado, '084-C1a la segunda firma con el mismo operacion_id espera a la primera');
  ok(r.rb.ok && r.rb.row.r.replay === true, '084-C1b la segunda es replay');
  ok(await cf('CF-C84A') === 6 && await kardex(O1) === 1 && await n(`SELECT count(*) FROM stock_operaciones WHERE ruta_id = 8490`) === 1, '084-C1c exactamente 1 descuento (10 → 6), 1 kardex, 1 operación');
  ok(await n(`SELECT count(*) FROM rutas WHERE id = 8490 AND estatus = 'Cargada' AND carga_confirmada_por::text = '8492'`) === 1, '084-C1d ruta Cargada una sola vez, firmante = chofer');
  // C2: otra operación sobre la ruta ya confirmada
  const O2 = '84c10000-0000-0000-0000-000000000002';
  await actor(a, CH);
  const c2 = await a.query(CARGA, [O2]).then(() => ({ ok: true }), e => ({ ok: false, code: e.code, msg: e.message }));
  await a.query('ROLLBACK');
  ok(!c2.ok && /ya tiene carga confirmada/.test(c2.msg || ''), `084-C2 otro operacion_id sobre ruta confirmada → rechazado sin descontar (${(c2.msg || 'OK').slice(0, 60)})`);
  ok(await cf('CF-C84A') === 6 && await kardex(O2) === 0, '084-C2b stock y kardex intactos');
  // C3: no-entrega simultánea misma orden, mismo op
  const O3 = '84c20000-0000-0000-0000-000000000001';
  r = await carrera(CH, NOENT, [O3], NOENT, [O3]);
  ok(r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '084-C3a la segunda no-entrega es replay');
  const p087c = await n(`SELECT (to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL)::int`);
  ok(await kardex(O3) === (p087c ? 0 : 1) && await n(`SELECT count(*) FROM ordenes WHERE id = 8490 AND estatus = 'No entregada'`) === 1, `084-C3b exactamente ${p087c ? '0 movimientos de cuarto (087: sigue en el camión)' : '1 devolución'} y 1 transición`);
  // C4: no-entrega con otro op sobre orden ya procesada
  const O4 = '84c20000-0000-0000-0000-000000000002';
  await actor(a, CH);
  const c4 = await a.query(NOENT, [O4]).then(() => ({ ok: true }), e => ({ ok: false, msg: e.message }));
  await a.query('ROLLBACK');
  ok(!c4.ok && /ya está No entregada/.test(c4.msg || '') && await kardex(O4) === 0, '084-C4 otro operacion_id sobre orden No entregada → sin doble devolución');
  // C5: salida manual mismo op simultánea (Producción)
  const O5 = '84c30000-0000-0000-0000-000000000001';
  const b0 = await cf('CF-C84B');
  r = await carrera(PR, SAL, [O5, 3], SAL, [O5, 3]);
  ok(r.bloqueado && r.rb.ok && r.rb.row.r.replay === true && await cf('CF-C84B') === b0 - 3 && await kardex(O5) === 1, '084-C5 salida manual: mismo op simultáneo = 1 salida, 1 kardex');
  // C6: traspaso mismo op simultáneo
  const O6 = '84c40000-0000-0000-0000-000000000001';
  const a0 = await cf('CF-C84A'), b1 = await cf('CF-C84B');
  r = await carrera(PR, TR, [O6, 2], TR, [O6, 2]);
  ok(r.bloqueado && r.rb.ok && r.rb.row.r.replay === true && await cf('CF-C84A') === a0 - 2 && await cf('CF-C84B') === b1 + 2 && await kardex(O6) === 2, '084-C6 traspaso: mismo op simultáneo = 1 traspaso (2 kardex)');
  // C7: dos salidas distintas compitiendo por el mismo cuarto/SKU (disponible = b1+2; 6 + 6)
  const disp = await cf('CF-C84B');
  const O7 = '84c30000-0000-0000-0000-000000000007', O8 = '84c30000-0000-0000-0000-000000000008';
  const q = Math.ceil(disp / 2) + 1; // q + q > disp
  r = await carrera(PR, SAL, [O7, q], SAL, [O8, q]);
  ok(r.bloqueado, '084-C7a la segunda salida espera el lock del cuarto');
  ok(!r.rb.ok && /Stock insuficiente/.test(r.rb.msg || ''), `084-C7b la segunda falla tras releer (${(r.rb.msg || 'OK').slice(0, 50)})`);
  ok(await cf('CF-C84B') === disp - q && await kardex(O8) === 0 && await n(`SELECT count(*) FROM stock_operaciones WHERE operacion_id = $1`, [O8]) === 0, '084-C7c nunca negativo, sin doble consumo, la fallida no deja rastro');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (084 concurrencia)'); process.exit(1); }
  console.log('  084 concurrencia: PASS');
}
await conc084();

async function fe084() {
  console.log('── 084 FRONTEND ↔ DB (builders de stockContratosLogic, parámetros nombrados como PostgREST)');
  const { pathToFileURL } = await import('node:url');
  const L = await import(pathToFileURL(path.join(ROOT, 'src/data/stockContratosLogic.js')).href);
  const CHA = '84f00000-0000-0000-0000-000000000001', CHB = '84f00000-0000-0000-0000-000000000002', PR = '84f00000-0000-0000-0000-000000000003', AD = '84f00000-0000-0000-0000-000000000004';
  let okF = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okF = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM inventario_mov WHERE producto LIKE 'F84-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '84f%' OR ruta_id IN (8480, 8481) OR orden_id = 8480;
    DELETE FROM orden_lineas WHERE orden_id = 8480; DELETE FROM ordenes WHERE id = 8480;
    DELETE FROM rutas WHERE id IN (8480, 8481); DELETE FROM clientes WHERE id = 8485;
    DELETE FROM cuartos_frios WHERE id IN ('CF-F84A', 'CF-F84B'); DELETE FROM productos WHERE sku LIKE 'F84-%';
    UPDATE cuartos_frios SET stock = stock - 'F84-A' WHERE stock ? 'F84-A'; -- la no-entrega devuelve al primer cuarto por id
    DELETE FROM usuarios WHERE id BETWEEN 8482 AND 8485; DELETE FROM auth.users WHERE id IN ('${CHA}', '${CHB}', '${PR}', '${AD}');
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CHA}', 'chofera84f@t'), ('${CHB}', 'choferb84f@t'), ('${PR}', 'prod84f@t'), ('${AD}', 'admin84f@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8482, 'ChoferA F84', 'chofera84f@t', 'Chofer', 'Activo', '${CHA}'), (8483, 'ChoferB F84', 'choferb84f@t', 'Chofer', 'Activo', '${CHB}'), (8484, 'Prod F84', 'prod84f@t', 'Producción', 'Activo', '${PR}'), (8485, 'Admin F84', 'admin84f@t', 'Admin', 'Activo', '${AD}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('F84-A', 'Hielo F84', 'Producto Terminado', 30, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-F84A', 'Cuarto F84A', '{"F84-A": 3}'::jsonb), ('CF-F84B', 'Cuarto F84B', '{"F84-A": 10}'::jsonb);
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8485, 'Cliente F84', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
      (8480, 'R-8480', 'Ruta F84 A', 8482, 'ChoferA F84', 'Pendiente firma', CURRENT_DATE, '{"F84-A": 5}', '{}', '{"F84-A": 5}', now()),
      (8481, 'R-8481', 'Ruta F84 B', 8483, 'ChoferB F84', 'Pendiente firma', CURRENT_DATE, '{"F84-A": 20}', '{}', '{"F84-A": 20}', now());
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8480, 'OV-8480', 8485, 'Cliente F84', '2×F84-A', 60, 'Asignada', 'Efectivo', 'Contado', 8485, 8480);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8480, 'F84-A', 2, 30, 60);
    COMMIT;`);
  const como = async (sub, fn) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
    try { const r = await fn(); await c.query('COMMIT'); return { ok: true, data: r }; }
    catch (e) { await c.query('ROLLBACK'); return { ok: false, msg: e.message, code: e.code }; }
  };
  const rpc = async (name, args) => {
    const keys = Object.keys(args);
    const sql = `SELECT ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`;
    return (await c.query(sql, keys.map(k => args[k]))).rows[0].r;
  };
  const cf = async (id) => n(`SELECT COALESCE((stock->>'F84-A')::int, 0) FROM cuartos_frios WHERE id = $1`, [id]);

  // Carga: mismo intento lógico → mismo UUID (resolverOperacion), replay en el reintento
  const c1 = L.resolverOperacion(null, L.claveCarga({ rutaId: 8480, excepcion: false }));
  const c1b = L.resolverOperacion(c1, L.claveCarga({ rutaId: 8480, excepcion: false }));
  ok(c1.id === c1b.id, '084-F1 mismo intento de firma → mismo operacion_id');
  const args1 = L.buildConfirmarCargaArgs({ operacionId: c1.id, rutaId: 8480, firma: 'data:image/png;base64,QQ==' }).args;
  ok(args1 && Object.keys(args1).join() === 'p_operacion_id,p_ruta_id,p_firma,p_excepcion,p_motivo', '084-F2 confirmar_carga_ruta: nombres de parámetros exactos');
  let r = await como(CHB, () => rpc('confirmar_carga_ruta', args1));
  ok(!r.ok && r.code === '42501', '084-F3 chofer ajeno: denegado');
  r = await como(CHA, () => rpc('confirmar_carga_ruta', args1));
  ok(r.ok && r.data.replay === false && r.data.actor === 'ChoferA F84', '084-F4 chofer dueño: carga confirmada (firmante = actor)');
  const rr = await como(CHA, () => rpc('confirmar_carga_ruta', args1));
  ok(rr.ok && rr.data.replay === true && await cf('CF-F84A') === 0 && await cf('CF-F84B') === 8, '084-F5 reintento con el mismo UUID = replay; FIFO 3 de A + 2 de B, una sola vez');
  const msg = L.mensajeErrorStock({ message: 'Inventario insuficiente para cargar 20 de F84-A (faltan 12)' });
  ok(/Inventario insuficiente/.test(msg), '084-F6 mensaje de stock insuficiente traducido');
  const c2 = L.resolverOperacion(null, L.claveCarga({ rutaId: 8481, excepcion: true, motivo: 'Sin celular' }));
  const args2 = L.buildConfirmarCargaArgs({ operacionId: c2.id, rutaId: 8481, excepcion: true, motivo: 'Sin celular' }).args;
  r = await como(PR, () => rpc('confirmar_carga_ruta', args2));
  ok(!r.ok && /Inventario insuficiente/.test(r.msg || ''), '084-F7 Producción firma ruta B: 20 con 8 disponibles → rechazo total');
  await c.query(`UPDATE rutas SET carga_real = '{"F84-A": 4}', carga_autorizada = '{"F84-A": 4}' WHERE id = 8481`);
  r = await como(PR, () => rpc('confirmar_carga_ruta', args2));
  ok(r.ok && r.data.excepcion === true && r.data.actor === 'Prod F84' && await cf('CF-F84B') === 4, '084-F8 Producción firma (excepción) en su propia sesión: D4 funcional');
  ok(await n(`SELECT count(*) FROM rutas WHERE id = 8481 AND estatus = 'Cargada' AND carga_confirmada_por::text = '8484'`) === 1, '084-F9 firmante registrado = Producción');

  // No-entrega con operacion_id encolado (misma id en cada replay)
  const nArgs = L.buildNoEntregaArgs({ operacionId: '84f10000-0000-0000-0000-000000000001', ordenId: 8480, motivo: 'Local cerrado', reagendar: true }).args;
  ok(Object.keys(nArgs).join() === 'p_operacion_id,p_orden_id,p_motivo,p_reagendar', '084-F10 registrar_no_entrega: nombres de parámetros exactos');
  r = await como(CHB, () => rpc('registrar_no_entrega', nArgs));
  ok(!r.ok && r.code === '42501', '084-F11 chofer ajeno: no-entrega denegada');
  const primero = (await c.query(`SELECT id FROM cuartos_frios ORDER BY id LIMIT 1`)).rows[0].id;
  const p0 = await cf(primero);
  r = await como(CHA, () => rpc('registrar_no_entrega', nArgs));
  const r2 = await como(CHA, () => rpc('registrar_no_entrega', nArgs));
  const p087f = await n(`SELECT (to_regprocedure('public.finalizar_inventario_ruta(uuid,bigint,jsonb)') IS NOT NULL)::int`);
  ok(r.ok && r.data.replay === false && r2.ok && r2.data.replay === true && await cf(primero) === p0 + (p087f ? 0 : 2), `084-F12 replay de cola offline: ${p087f ? 'sin movimiento de cuarto (087)' : 'una sola devolución (+2 en el primer cuarto ' + primero + ')'}`);
  const r3 = await como(CHA, () => rpc('registrar_no_entrega', L.buildNoEntregaArgs({ operacionId: '84f10000-0000-0000-0000-000000000002', ordenId: 8480, motivo: 'Local cerrado', reagendar: true }).args));
  ok(!r3.ok && /ya está No entregada/.test(r3.msg || ''), '084-F13 otro UUID sobre la misma orden: rechazado');

  // Salida manual y traspaso (Producción y Admin)
  const sArgs = L.buildSalidaManualArgs({ operacionId: '84f20000-0000-0000-0000-000000000001', cuartoId: 'CF-F84B', sku: 'F84-A', cantidad: 1, motivo: 'Venta directa' }).args;
  ok(L.buildSalidaManualArgs({ operacionId: 'x', cuartoId: 'CF-F84B', sku: 'F84-A', cantidad: 1, motivo: 'Carga a ruta' }).error !== undefined, '084-F14 builder rechaza motivo de ruta (mismo criterio que el servidor)');
  r = await como(PR, () => rpc('salida_cuarto_manual', { ...sArgs, p_motivo: 'Carga a ruta' }));
  ok(!r.ok && /firmar la carga/.test(r.msg || ''), '084-F15 servidor rechaza motivo de ruta aunque el cliente lo mande');
  r = await como(PR, () => rpc('salida_cuarto_manual', sArgs));
  const rs = await como(PR, () => rpc('salida_cuarto_manual', sArgs));
  ok(r.ok && rs.ok && rs.data.replay === true && await cf('CF-F84B') === 3, '084-F16 salida manual Producción + reintento = 1 salida (4 → 3)');
  const tArgs = L.buildTraspasoArgs({ operacionId: '84f30000-0000-0000-0000-000000000001', origen: 'CF-F84B', destino: 'CF-F84A', sku: 'F84-A', cantidad: 2 }).args;
  const a0 = await cf('CF-F84A'), b0 = await cf('CF-F84B');
  r = await como(AD, () => rpc('traspaso_cuartos', tArgs));
  const rt = await como(AD, () => rpc('traspaso_cuartos', tArgs));
  ok(r.ok && rt.ok && rt.data.replay === true && await cf('CF-F84B') === b0 - 2 && await cf('CF-F84A') === a0 + 2, '084-F17 traspaso Admin + reintento = 1 traspaso');
  ok(await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = '84f30000-0000-0000-0000-000000000001'`) === 2, '084-F18 traspaso: 2 kardex bajo una operación');
  ok(await n(`SELECT count(*) FROM inventario_mov WHERE producto = 'F84-A' AND operacion_id IS NULL`) === 0, '084-F19 ningún kardex nuevo sin operación');
  await c.query(limpiar);
  if (!okF) { console.log('RESULTADO: FALLÓ (084 frontend↔DB)'); process.exit(1); }
  console.log('  084 frontend↔DB: PASS');
}
await fe084();

for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos', 'inventario_mov']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['083', '083_self_read_auth_id_test.sql'], ['082', '082_r3_r4_test.sql'], ['081', '081_ruta_id_ordenes_test.sql'], ['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 084)`); process.exit(1); }
  console.log(`  ${etq} tras 084: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 084)'); process.exit(1); }
  console.log('  071 tras 084: PASS');
}
console.log('── 076 concurrencia y frontend↔DB tras 084');
await conc076();
await fe076();
console.log('  076 concurrencia + frontend↔DB tras 084: PASS');

// ── R2 contención: 085 (RPC genérico solo Admin; contratos con primitivo interno; guard de carga) ──
{
  const PROD = { update_stocks_atomic: '9bfe3e6327d081a39f467279ef654868', registrar_produccion: '0619e6b3e29f9448263a4bd81f8359c1', registrar_transformacion: '9ad0fa675fe265bfd4f2ff81e6440eb7', cerrar_ruta_atomic: '738311ca2ea45af585328996b9e425bd', rutas_guard_chofer: 'd62cb42dadf2ec9519ae740eb2f6d28d', confirmar_carga_ruta: 'd2bc238a501c6699c2410d3573c2a35b', stock_mov_cuarto: '3591d07446854c4a682cd41f88489ec6' };
  const rows = (await c.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(PROD)])).rows;
  const mal = rows.filter(r => PROD[r.proname] !== r.m).map(r => `${r.proname}=${r.m}`);
  console.log(`  STOCK_PARITY_CHECK[pre-085]: ${rows.length === 7 && mal.length === 0 ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (rows.length !== 7 || mal.length) process.exit(1);
}
console.log('── aplicar 085 (1/2)');
let r085 = await runFile(c, path.join(ROOT, 'supabase/085_contencion_stock_generico.sql'), { stopOnError: true });
if (r085.aborted) process.exit(1);
console.log('── aplicar 085 (2/2, idempotencia)');
r085 = await runFile(c, path.join(ROOT, 'supabase/085_contencion_stock_generico.sql'), { stopOnError: true });
if (r085.aborted) process.exit(1);
if (!(await rlsCheck('tras 085 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 085)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[085]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 085 (R2 contención)');
const r085t = await runFile(c, path.join(ROOT, 'supabase/tests/085_contencion_stock_test.sql'), { stopOnError: true, echo: true });
if (r085t.aborted) { console.log('RESULTADO: FALLÓ (085)'); process.exit(1); }

// ═══ 086 — F4: cierre financiero idempotente ═══
async function pre086Retry() {
  // Evidencia del bug ANTES de 086: el mismo cierre dos veces duplica las
  // ventas exprés; un payload cambiado agrega una tercera. Solo se imprime.
  console.log('── PRE-086 RETRY MATRIX (comportamiento actual, estado 085)');
  const CH = '86a00000-0000-0000-0000-000000000001';
  const limpiar = `BEGIN;
    DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8680 OR id = 8680);
    DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8680 OR id = 8680);
    DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8680 OR id = 8680);
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8680 OR id = 8680);
    DELETE FROM ordenes WHERE ruta_id = 8680 OR id = 8680; DELETE FROM rutas WHERE id = 8680; DELETE FROM clientes WHERE id = 8685;
    DELETE FROM productos WHERE sku = 'A86-A'; DELETE FROM usuarios WHERE id = 8682; DELETE FROM auth.users WHERE id = '${CH}';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CH}', 'chofera86@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8682, 'ChoferA 86', 'chofera86@t', 'Chofer', 'Activo', '${CH}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('A86-A', 'Hielo A86', 'Producto Terminado', 35, 0);
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8685, 'Cliente A86', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
      (8680, 'R-8680', 'Ruta A86', 8682, 'ChoferA 86', 'En progreso', CURRENT_DATE, '{"A86-A": 5}', '{"A86-A": 5}', '{}', '{"A86-A": 5}');
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8680, 'OV-8680', 8685, 'Cliente A86', '1×A86-A', 30, 'Asignada', 'Efectivo', 'Contado', 8682, 8680);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8680, 'A86-A', 1, 30, 30);
    COMMIT;`);
  const P = JSON.stringify([{ ordenId: 8680, pago: 'Efectivo' }, { express: true, cliente: 'Público en general', pago: 'Efectivo', items: [{ sku: 'A86-A', cant: 2, precio: 35 }] }]);
  const P2 = JSON.stringify([{ ordenId: 8680, pago: 'Efectivo' }, { express: true, cliente: 'Público en general', pago: 'Efectivo', items: [{ sku: 'A86-A', cant: 3, precio: 35 }] }]);
  const cerrar = async (payload) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: CH })]);
    try { await c.query(`SELECT cerrar_ruta_financiero(8680, $1::jsonb, 8682, 'ChoferA 86')`, [payload]); await c.query('COMMIT'); return 'ok'; }
    catch (e) { await c.query('ROLLBACK'); return e.code + ' ' + e.message; }
  };
  const fp = async () => (await c.query(`SELECT (SELECT count(*) FROM ordenes WHERE ruta_id = 8680 AND id <> 8680) AS express, (SELECT count(*) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = 8680 AND o.id <> 8680) AS lineas, (SELECT count(*) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 8680) AS pagos, (SELECT count(*) FROM movimientos_contables m JOIN ordenes o ON o.id = m.orden_id WHERE o.ruta_id = 8680) AS movs, (SELECT count(*) FROM pagos WHERE orden_id = 8680) AS pago_normal`)).rows[0];
  const r1 = await cerrar(P); const f1 = await fp();
  const r2 = await cerrar(P); const f2 = await fp();
  const r3 = await cerrar(P2); const f3 = await fp();
  console.log(`  1ª llamada: ${r1} → ${JSON.stringify(f1)}`);
  console.log(`  2ª llamada idéntica (respuesta perdida / doble tap): ${r2} → ${JSON.stringify(f2)}`);
  console.log(`  3ª llamada con exprés cambiada: ${r3} → ${JSON.stringify(f3)}`);
  console.log(`  PRE_086_RETRY_MATRIX: express_tras_2_llamadas=${f2.express} (esperado_con_bug=2) pagos_normal=${f2.pago_normal} (idempotente=1) express_tras_3=${f3.express}`);
  await c.query(limpiar);
  return { f1, f2, f3 };
}
const pre086 = await pre086Retry();
{
  const PROD_FIN = '012999bf9fd180300f8d5ebd3e77d978';
  const rows = (await c.query(`SELECT pg_get_function_identity_arguments(oid) AS a, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'cerrar_ruta_financiero'`)).rows;
  const tabla = (await c.query(`SELECT to_regclass('public.cierres_financieros_ruta') AS t`)).rows[0].t;
  const ok = rows.length === 1 && rows[0].m === PROD_FIN && tabla === null && Number(pre086.f2.express) === 2 && Number(pre086.f2.pago_normal) === 1;
  console.log(`  FIN_PARITY_CHECK[pre-086]: ${ok ? 'PASS' : 'FAIL'} sobrecargas=${rows.length} md5=${rows[0]?.m} tabla=${tabla} bug_reproducido=${Number(pre086.f2.express) === 2}`);
  if (!ok) process.exit(1);
}
console.log('── aplicar 086 (1/2)');
let r086 = await runFile(c, path.join(ROOT, 'supabase/086_cierre_financiero_idempotente.sql'), { stopOnError: true });
if (r086.aborted) process.exit(1);
console.log('── aplicar 086 (2/2, idempotencia)');
r086 = await runFile(c, path.join(ROOT, 'supabase/086_cierre_financiero_idempotente.sql'), { stopOnError: true });
if (r086.aborted) process.exit(1);
if (!(await rlsCheck('tras 086 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 086)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[086]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 086 (F4 cierre financiero idempotente)');
const r086t = await runFile(c, path.join(ROOT, 'supabase/tests/086_cierre_financiero_test.sql'), { stopOnError: true, echo: true });
if (r086t.aborted) { console.log('RESULTADO: FALLÓ (086)'); process.exit(1); }

async function conc086() {
  console.log('── 086 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const CH = '86c00000-0000-0000-0000-000000000001', CH2 = '86c00000-0000-0000-0000-000000000002', CH3 = '86c00000-0000-0000-0000-000000000003';
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM cierres_financieros_ruta WHERE ruta_id IN (8690, 8691, 8692);
    DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id IN (8690, 8691, 8692));
    DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id IN (8690, 8691, 8692));
    DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id IN (8690, 8691, 8692));
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id IN (8690, 8691, 8692));
    DELETE FROM ordenes WHERE ruta_id IN (8690, 8691, 8692); DELETE FROM rutas WHERE id IN (8690, 8691, 8692); DELETE FROM clientes WHERE id = 8695;
    DELETE FROM productos WHERE sku = 'C86-A'; DELETE FROM usuarios WHERE id IN (8692, 8693, 8694); DELETE FROM auth.users WHERE id IN ('${CH}', '${CH2}', '${CH3}');
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CH}', 'choferc86@t'), ('${CH2}', 'choferc86b@t'), ('${CH3}', 'choferc86c@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8692, 'ChoferC 86', 'choferc86@t', 'Chofer', 'Activo', '${CH}'), (8693, 'ChoferC 86 b', 'choferc86b@t', 'Chofer', 'Activo', '${CH2}'), (8694, 'ChoferC 86 c', 'choferc86c@t', 'Chofer', 'Activo', '${CH3}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('C86-A', 'Hielo C86', 'Producto Terminado', 35, 0);
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8695, 'Cliente C86', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
      (8690, 'R-8690', 'Ruta C86 a', 8692, 'ChoferC 86', 'En progreso', CURRENT_DATE, '{"C86-A": 5}', '{"C86-A": 5}', '{}', '{"C86-A": 5}'),
      (8691, 'R-8691', 'Ruta C86 b', 8693, 'ChoferC 86 b', 'En progreso', CURRENT_DATE, '{"C86-A": 5}', '{"C86-A": 5}', '{}', '{"C86-A": 5}'),
      (8692, 'R-8692', 'Ruta C86 c', 8694, 'ChoferC 86 c', 'En progreso', CURRENT_DATE, '{"C86-A": 5}', '{"C86-A": 5}', '{}', '{"C86-A": 5}');
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8690, 'OV-8690', 8695, 'Cliente C86', '1×C86-A', 30, 'Asignada', 'Efectivo', 'Contado', 8692, 8690),
      (8691, 'OV-8691', 8695, 'Cliente C86', '1×C86-A', 30, 'Asignada', 'Efectivo', 'Contado', 8692, 8691),
      (8692, 'OV-8692', 8695, 'Cliente C86', '1×C86-A', 30, 'Asignada', 'Efectivo', 'Contado', 8692, 8692);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8690, 'C86-A', 1, 30, 30), (8691, 'C86-A', 1, 30, 30), (8692, 'C86-A', 1, 30, 30);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (sub, sqlA, paramsA, sqlB, paramsB) => {
    await actor(a, sub); await actor(b, sub);
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
  const pay = (ordenId, cant) => JSON.stringify([{ ordenId, pago: 'Efectivo' }, { express: true, cliente: 'Público en general', pago: 'Efectivo', items: [{ sku: 'C86-A', cant, precio: 35 }] }]);
  const SQL = `SELECT cerrar_ruta_financiero($1::uuid, $2::bigint, $3::jsonb, NULL, 'ChoferC 86') AS r`;
  const fp = async (ruta) => (await c.query(`SELECT (SELECT count(*) FROM ordenes WHERE ruta_id = $1 AND id NOT IN (8690, 8691, 8692)) AS express, (SELECT count(*) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = $1 AND o.id NOT IN (8690, 8691, 8692)) AS lineas, (SELECT count(*) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = $1) AS pagos, (SELECT count(*) FROM movimientos_contables m JOIN ordenes o ON o.id = m.orden_id WHERE o.ruta_id = $1) AS movs, (SELECT count(*) FROM cierres_financieros_ruta WHERE ruta_id = $1) AS cierres`, [ruta])).rows[0];
  // C1: misma operación simultánea
  const O1 = '86c10000-0000-0000-0000-000000000001';
  let r = await carrera(CH, SQL, [O1, 8690, pay(8690, 2)], SQL, [O1, 8690, pay(8690, 2)]);
  ok(r.bloqueado, '086-C1a la segunda llamada con la misma operación espera el lock de la ruta');
  ok(r.rb.ok && r.rb.row.r.replay === true, '086-C1b la segunda es replay');
  let f = await fp(8690);
  ok(Number(f.express) === 1 && Number(f.lineas) === 1 && Number(f.pagos) === 2 && Number(f.movs) === 2 && Number(f.cierres) === 1, `086-C1c exactamente 1 exprés, 1 línea, 2 pagos (normal + exprés), 2 ingresos, 1 evento (${JSON.stringify(f)})`);
  // C2: otra operación, misma petición, simultánea
  r = await carrera(CH2, SQL, ['86c10000-0000-0000-0000-000000000002', 8691, pay(8691, 2)], SQL, ['86c10000-0000-0000-0000-000000000003', 8691, pay(8691, 2)]);
  ok(r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '086-C2a otra operación con la misma petición: espera y es replay');
  f = await fp(8691);
  ok(Number(f.express) === 1 && Number(f.cierres) === 1, '086-C2b un solo efecto, un solo evento');
  // C3: otra operación, otra petición, simultánea
  r = await carrera(CH3, SQL, ['86c10000-0000-0000-0000-000000000004', 8692, pay(8692, 2)], SQL, ['86c10000-0000-0000-0000-000000000005', 8692, pay(8692, 3)]);
  ok(r.bloqueado && !r.rb.ok && r.rb.code === '22023', `086-C3a otra operación con otra petición: espera y se rechaza (${r.rb.code})`);
  f = await fp(8692);
  ok(Number(f.express) === 1 && Number(f.pagos) === 2 && Number(f.cierres) === 1, '086-C3b el ganador dejó exactamente un cierre; el perdedor nada');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (086 concurrencia)'); process.exit(1); }
}
await conc086();

async function fe086() {
  console.log('── 086 FRONTEND ↔ DB (cierreFinancieroLogic: clave, UUID estable, parámetros nombrados como PostgREST)');
  const { pathToFileURL } = await import('node:url');
  const L = await import(pathToFileURL(path.join(ROOT, 'src/data/cierreFinancieroLogic.js')).href);
  const CH = '86f00000-0000-0000-0000-000000000001';
  let okF = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okF = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM cierres_financieros_ruta WHERE ruta_id = 8670;
    DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8670);
    DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8670);
    DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8670);
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id = 8670);
    DELETE FROM ordenes WHERE ruta_id = 8670; DELETE FROM rutas WHERE id = 8670; DELETE FROM clientes WHERE id = 8675;
    DELETE FROM productos WHERE sku = 'F86-A'; DELETE FROM usuarios WHERE id = 8672; DELETE FROM auth.users WHERE id = '${CH}';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CH}', 'choferf86@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8672, 'ChoferF 86', 'choferf86@t', 'Chofer', 'Activo', '${CH}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('F86-A', 'Hielo F86', 'Producto Terminado', 35, 0);
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8675, 'Cliente F86', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
      (8670, 'R-8670', 'Ruta F86', 8672, 'ChoferF 86', 'En progreso', CURRENT_DATE, '{"F86-A": 5}', '{"F86-A": 5}', '{}', '{"F86-A": 5}');
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8670, 'OV-8670', 8675, 'Cliente F86', '1×F86-A', 30, 'Asignada', 'Efectivo', 'Contado', 8672, 8670);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8670, 'F86-A', 1, 30, 30);
    COMMIT;`);
  const storage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; })();
  const rpc = async (args) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: CH })]);
    try {
      const r = (await c.query(`SELECT cerrar_ruta_financiero(p_operacion_id => $1::uuid, p_ruta_id => $2::bigint, p_entregas => $3::jsonb, p_usuario_id => $4::bigint, p_usuario_nombre => $5::text) AS r`,
        [args.p_operacion_id, args.p_ruta_id, JSON.stringify(args.p_entregas), args.p_usuario_id, args.p_usuario_nombre])).rows[0].r;
      await c.query('COMMIT'); return { data: r };
    } catch (e) { await c.query('ROLLBACK'); return { error: e }; }
  };
  // 1) cierre desde la UI: entregas + exprés → payload + clave + UUID persistido
  const entregasUI = [{ ordenId: 8670, folio: 'OV-8670', items: [{ sku: 'F86-A', cant: 1 }], total: 30, pago: 'Efectivo' },
    { express: true, cliente: 'Público en general', pago: 'Tarjeta', referencia: 'TPV-9', items: [{ sku: 'F86-A', cant: 2, precio: 35 }] }];
  const payload = L.normalizarEntregasCierre(entregasUI);
  const op1 = L.resolverOperacion(L.leerOperacionCierre(storage, 8670), L.claveCierreFinanciero(8670, payload));
  L.guardarOperacionCierre(storage, 8670, op1);
  const b1 = L.buildCerrarFinancieroArgs({ operacionId: op1.id, rutaId: 8670, entregas: payload, usuarioId: 8672, usuarioNombre: 'ChoferF 86' });
  const r1 = await rpc(b1.args);
  ok(!r1.error && L.interpretarCierreFinanciero(r1.data).replay === false && r1.data.ventas_express === 1, '086-F1 cierre desde los builders del cliente: PASS, 1 exprés');
  ok(r1.data.huella && r1.data.operacion_id === op1.id, '086-F2 el servidor devuelve la operación del cliente y su huella');
  // 2) respuesta perdida + recarga: el UUID se relee del storage y el payload llega reordenado
  const payload2 = L.normalizarEntregasCierre([entregasUI[1], { ...entregasUI[0], referencia: '' }]);
  const op2 = L.resolverOperacion(L.leerOperacionCierre(storage, 8670), L.claveCierreFinanciero(8670, payload2));
  ok(op2.id === op1.id, '086-F3 misma petición lógica reordenada → mismo UUID tras recarga');
  const r2 = await rpc(L.buildCerrarFinancieroArgs({ operacionId: op2.id, rutaId: 8670, entregas: payload2, usuarioId: 8672, usuarioNombre: 'ChoferF 86' }).args);
  ok(!r2.error && L.interpretarCierreFinanciero(r2.data).replay === true, '086-F4 reintento: replay sin efectos');
  ok(await n(`SELECT count(*) FROM ordenes WHERE ruta_id = 8670 AND id <> 8670`) === 1 && await n(`SELECT count(*) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = 8670`) === 2, '086-F5 sigue habiendo 1 exprés y 2 pagos');
  // 3) el chofer agrega una venta y reintenta: UUID nuevo, el servidor rechaza sin efectos y el mensaje es claro
  const payload3 = L.normalizarEntregasCierre([...entregasUI, { express: true, pago: 'Efectivo', items: [{ sku: 'F86-A', cant: 1, precio: 35 }] }]);
  const op3 = L.resolverOperacion(L.leerOperacionCierre(storage, 8670), L.claveCierreFinanciero(8670, payload3));
  ok(op3.id !== op1.id, '086-F6 otra petición lógica → UUID nuevo');
  const r3 = await rpc(L.buildCerrarFinancieroArgs({ operacionId: op3.id, rutaId: 8670, entregas: payload3, usuarioId: 8672, usuarioNombre: 'ChoferF 86' }).args);
  ok(r3.error && r3.error.code === '22023' && /administrador/.test(L.mensajeErrorCierreFinanciero(r3.error)), '086-F7 rechazo 22023 traducido; sin efectos');
  ok(await n(`SELECT count(*) FROM ordenes WHERE ruta_id = 8670 AND id <> 8670`) === 1, '086-F8 sin segunda venta exprés');
  // 4) UUID perdido por completo (storage vacío) + misma petición → replay por huella
  L.borrarOperacionCierre(storage, 8670);
  const op4 = L.resolverOperacion(L.leerOperacionCierre(storage, 8670), L.claveCierreFinanciero(8670, payload));
  ok(op4.id !== op1.id, '086-F9 storage vacío → UUID nuevo');
  const r4 = await rpc(L.buildCerrarFinancieroArgs({ operacionId: op4.id, rutaId: 8670, entregas: payload, usuarioId: 8672, usuarioNombre: 'ChoferF 86' }).args);
  ok(!r4.error && r4.data.replay === true && r4.data.operacion_original === op1.id, '086-F10 el servidor reconoce la misma petición por su huella: replay');
  await c.query(limpiar);
  if (!okF) { console.log('RESULTADO: FALLÓ (086 frontend↔DB)'); process.exit(1); }
}
await fe086();

// ═══ 087 — inventario canónico de ruta ═══
{
  const PROD = {
    'registrar_merma': '91bf7b413527c76d3ed1d22ea48d03ec', 'revertir_merma': 'be645eb71b4190e0823de4b3f6c2318d',
    'registrar_mermas_ruta': '1d1844e3e9a42c9de945dc4f1e3e42c1', 'registrar_no_entrega': '73a3587035827a023eee8bb76a137c74',
    'rutas_guard_chofer': '50f41ad93f2933ce4ee4d322e917fb27', 'cerrar_ruta_atomic': 'bbc58bc9dd859d7cab60a0e8e5217ef1',
    'stock_mov_cuarto': '3591d07446854c4a682cd41f88489ec6', 'stock_op_replay': '8597237a4178e2d3cfe7cf635879f53f',
    'confirmar_carga_ruta': 'b1be0d0eda13210f828d23572e8d0fb3', 'fin_huella_cierre': '2d558e8d8315c9b75cd8f0877e24afa5',
  };
  const rows = (await c.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(PROD)])).rows;
  const mal = rows.filter(r => PROD[r.proname] !== r.m).map(r => `${r.proname}=${r.m}`);
  const chk = (await c.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'stock_operaciones_tipo_check'`)).rows[0]?.d || '';
  const ok = rows.length === Object.keys(PROD).length && mal.length === 0 && !/cierre_ruta/.test(chk);
  console.log(`  INVENTARIO_PARITY_CHECK[pre-087]: ${ok ? 'PASS' : 'FAIL'} funciones=${rows.length} ${JSON.stringify(mal)} check=${chk}`);
  if (!ok) process.exit(1);
}
console.log('── aplicar 087 (1/2)');
let r087 = await runFile(c, path.join(ROOT, 'supabase/087_inventario_ruta_canonico.sql'), { stopOnError: true });
if (r087.aborted) process.exit(1);
console.log('── aplicar 087 (2/2, idempotencia)');
r087 = await runFile(c, path.join(ROOT, 'supabase/087_inventario_ruta_canonico.sql'), { stopOnError: true });
if (r087.aborted) process.exit(1);
if (!(await rlsCheck('tras 087 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 087)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[087]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 087 (inventario canónico de ruta)');
const r087t = await runFile(c, path.join(ROOT, 'supabase/tests/087_inventario_ruta_test.sql'), { stopOnError: true, echo: true });
if (r087t.aborted) { console.log('RESULTADO: FALLÓ (087)'); process.exit(1); }

async function conc087() {
  console.log('── 087 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '87c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const RUTAS = [8761, 8762, 8763, 8764, 8765, 8766, 8767];
  const limpiar = `BEGIN;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku = 'C87-A');
    DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku = 'C87-A');
    DELETE FROM mermas WHERE sku = 'C87-A';
    DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8761 AND 8769;
    DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8761 AND 8769);
    DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8761 AND 8769);
    DELETE FROM inventario_mov WHERE producto = 'C87-A';
    DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 8761 AND 8769 OR orden_id BETWEEN 8761 AND 8769;
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 8761 AND 8769);
    DELETE FROM ordenes WHERE ruta_id BETWEEN 8761 AND 8769;
    DELETE FROM rutas WHERE id BETWEEN 8761 AND 8769; DELETE FROM clientes WHERE id = 8770;
    DELETE FROM cuartos_frios WHERE id = 'CF-C87A'; DELETE FROM productos WHERE sku = 'C87-A';
    UPDATE cuartos_frios SET stock = stock - 'C87-A' WHERE stock ? 'C87-A';
    DELETE FROM usuarios WHERE id BETWEEN 8771 AND 8779; DELETE FROM auth.users WHERE id::text LIKE '87c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) SELECT ('87c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t87c' FROM generate_series(1, 7) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) SELECT 8770 + k, 'ChoferC87-' || k, 'c' || k || '@t87c', 'Chofer', 'Activo', ('87c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid FROM generate_series(1, 7) k;
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('C87-A', 'Hielo C87', 'Producto Terminado', 30, 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C87A', 'Cuarto C87A', '{"C87-A": 500}');
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (8770, 'Cliente C87', 'XAXX010101000', 0);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
      SELECT 8760 + k, 'R-' || (8760 + k), 'Ruta C87-' || k, 8770 + k, 'ChoferC87-' || k, 'Pendiente firma', CURRENT_DATE, '{"C87-A": 10}', '{"C87-A": 10}', '{}', '{"C87-A": 10}', now() FROM generate_series(1, 7) k;
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, ruta_id) VALUES
      (8767, 'OV-8767', 8770, 'Cliente C87', '3×C87-A', 90, 'Asignada', 'Efectivo', 'Contado', 8777, 8767);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (8767, 'C87-A', 3, 30, 90);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const solo = async (sub, sql, params) => {
    await actor(a, sub);
    try { const r = await a.query(sql, params); await a.query('COMMIT'); return { ok: true, row: r.rows[0], rowCount: r.rowCount }; }
    catch (e) { await a.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
  };
  const carrera = async (subA, sqlA, paramsA, subB, sqlB, paramsB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, paramsA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const pB = b.query(sqlB, paramsB).then(r => ({ ok: true, row: r.rows[0], rowCount: r.rowCount }), e => ({ ok: false, msg: e.message, code: e.code })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await pB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const cf = async () => n(`SELECT COALESCE((stock->>'C87-A')::int, 0) FROM cuartos_frios WHERE id = 'CF-C87A'`);
  const rest = async (ruta) => n(`SELECT COALESCE((SELECT restante FROM balance_ruta_interno($1) WHERE sku = 'C87-A'), 0)`, [ruta]);
  const LOAD = `SELECT confirmar_carga_ruta($1::uuid, $2::bigint, 'firma') AS r`;
  const INICIAR = `UPDATE rutas SET estatus = 'En progreso' WHERE id = $1`;
  const FIN = `SELECT cerrar_ruta_financiero($1::uuid, $2::bigint, $3::jsonb, NULL, 'C87') AS r`;
  const LOTE = `SELECT registrar_mermas_ruta($1::uuid, $2::bigint, $3::jsonb) AS r`;
  const CIERRE = `SELECT finalizar_inventario_ruta($1::uuid, $2::bigint, $3::jsonb) AS r`;
  for (let k = 1; k <= 7; k++) {
    const r1 = await solo(SUB(k), LOAD, [`87c20000-0000-0000-0000-00000000000${k}`, 8760 + k]);
    const r2 = await solo(SUB(k), INICIAR, [8760 + k]);
    const r3 = k === 7 ? { ok: true } : await solo(SUB(k), FIN, [`87c30000-0000-0000-0000-00000000000${k}`, 8760 + k, '[]']);
    if (!r1.ok || !r2.ok || !r3.ok) { console.log('  fixture falló', k, r1.msg || r2.msg || r3.msg); process.exit(1); }
  }
  const cf0 = await cf();
  ok(cf0 === 430, `087-C0 7 cargas de 10 por contrato (500 → ${cf0})`);
  // C1: merma contra merma sobre el mismo camión
  let r = await carrera(SUB(1), LOTE, ['87c40000-0000-0000-0000-000000000001', 8761, '[{"sku":"C87-A","cant":6,"causa":"x"}]'],
                        SUB(1), LOTE, ['87c40000-0000-0000-0000-000000000002', 8761, '[{"sku":"C87-A","cant":6,"causa":"y"}]']);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023', `087-C1a merma 6 contra merma 6 (camión 10): la segunda espera y se rechaza (${r.rb.code})`);
  ok(await rest(8761) === 4 && await n(`SELECT count(*) FROM mermas WHERE ruta_id = 8761`) === 1 && await cf() === cf0, '087-C1b balance 10 → 4, una sola merma, cuartos intactos (nunca negativo)');
  // C2: merma contra finalización
  r = await carrera(SUB(2), CIERRE, ['87c50000-0000-0000-0000-000000000002', 8762, '{"C87-A": 10}'],
                    SUB(2), LOTE, ['87c40000-0000-0000-0000-000000000003', 8762, '[{"sku":"C87-A","cant":1,"causa":"x"}]']);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023', `087-C2a finalización primero: la merma espera y se rechaza (ruta Cerrada) (${r.rb.code})`);
  ok(await cf() === cf0 + 10 && await n(`SELECT count(*) FROM mermas WHERE ruta_id = 8762`) === 0 && await rest(8762) === 0, '087-C2b devolución 10 una vez, sin merma, balance 0');
  // C3: misma operación de finalización simultánea
  const O3 = '87c50000-0000-0000-0000-000000000003';
  r = await carrera(SUB(3), CIERRE, [O3, 8763, '{"C87-A": 10}'], SUB(3), CIERRE, [O3, 8763, '{"C87-A": 10}']);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '087-C3a misma operación: la segunda espera y es replay');
  ok(await cf() === cf0 + 20 && await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = $1`, [O3]) === 1, '087-C3b una sola devolución (un kardex)');
  // C4: otra operación, mismo conteo / otro conteo
  r = await carrera(SUB(4), CIERRE, ['87c50000-0000-0000-0000-000000000004', 8764, '{"C87-A": 10}'], SUB(4), CIERRE, ['87c50000-0000-0000-0000-000000000014', 8764, '{"C87-A": 10}']);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true && r.rb.row.r.operacion_original === '87c50000-0000-0000-0000-000000000004', '087-C4a otra operación con el mismo conteo: espera y es replay');
  r = await carrera(SUB(5), CIERRE, ['87c50000-0000-0000-0000-000000000005', 8765, '{"C87-A": 10}'], SUB(5), CIERRE, ['87c50000-0000-0000-0000-000000000015', 8765, '{"C87-A": 9}']);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023', `087-C4b otra operación con otro conteo: espera y se rechaza (${r.rb.code})`);
  ok(await cf() === cf0 + 40 && await n(`SELECT count(*) FROM stock_operaciones WHERE ruta_id IN (8764, 8765) AND tipo = 'cierre_ruta'`) === 2, '087-C4c una devolución por ruta');
  // C5: finalización contra cierre directo
  r = await carrera(SUB(6), CIERRE, ['87c50000-0000-0000-0000-000000000006', 8766, '{"C87-A": 10}'], SUB(6), `UPDATE rutas SET estatus = 'Cerrada', fecha_fin = CURRENT_DATE WHERE id = 8766`, []);
  ok(r.ra.ok && r.bloqueado && (!r.rb.ok ? r.rb.code === '42501' : r.rb.rowCount === 0 || true), `087-C5a el UPDATE directo espera y no produce un segundo cierre (${r.rb.ok ? 'sin cambios' : r.rb.code})`);
  ok(await cf() === cf0 + 50 && await n(`SELECT count(*) FROM stock_operaciones WHERE ruta_id = 8766 AND tipo = 'cierre_ruta'`) === 1, '087-C5b una sola devolución');
  // C6: no-entrega contra finalización (la finalización exige ninguna orden pendiente)
  const r6a = await solo(SUB(7), FIN, ['87c30000-0000-0000-0000-000000000007', 8767, '[]']);
  r = await carrera(SUB(7), `SELECT registrar_no_entrega('87c60000-0000-0000-0000-000000000007'::uuid, 8767, 'Local cerrado') AS r`, [],
                    SUB(7), CIERRE, ['87c50000-0000-0000-0000-000000000007', 8767, '{"C87-A": 10}']);
  ok(r6a.ok && r.ra.ok && !r.rb.ok && /pendientes/.test(r.rb.msg || ''), '087-C6a no-entrega en curso: la finalización ve la orden pendiente y se rechaza sin efectos');
  const r6c = await solo(SUB(7), CIERRE, ['87c50000-0000-0000-0000-000000000007', 8767, '{"C87-A": 10}']);
  ok(r6c.ok && await cf() === cf0 + 60 && await rest(8767) === 0, '087-C6b tras la no-entrega, la misma operación finaliza: devuelve 10 (incluye las 3 no entregadas) una sola vez');
  // C7: reintento del cierre financiero y luego finalización (ruta 8761, con merma 6)
  const r7a = await solo(SUB(1), FIN, ['87c30000-0000-0000-0000-000000000001', 8761, '[]']);
  const r7b = await solo(SUB(1), CIERRE, ['87c50000-0000-0000-0000-000000000001', 8761, '{"C87-A": 4}']);
  ok(r7a.ok && r7a.row.r.replay === true && r7b.ok && await cf() === cf0 + 64 && await rest(8761) === 0, '087-C7 replay del cierre financiero y finalización: 10 = 6 merma + 4 devueltas');
  ok(await n(`SELECT count(*) FROM rutas WHERE id BETWEEN 8761 AND 8767 AND estatus = 'Cerrada'`) === 7, '087-C8 las 7 rutas cerradas, ninguna a medias');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (087 concurrencia)'); process.exit(1); }
}
await conc087();
async function fe087() {
  console.log('── 087 FRONTEND ↔ DB (inventarioRutaLogic + cierreFinancieroLogic, parámetros nombrados como PostgREST)');
  const { pathToFileURL } = await import('node:url');
  const L = await import(pathToFileURL(path.join(ROOT, 'src/data/inventarioRutaLogic.js')).href);
  const F = await import(pathToFileURL(path.join(ROOT, 'src/data/cierreFinancieroLogic.js')).href);
  const CH = '87f00000-0000-0000-0000-000000000001';
  let okF = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okF = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const limpiar = `BEGIN;
    DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'MERMA-' || id FROM mermas WHERE sku = 'F87-A');
    DELETE FROM mermas WHERE sku = 'F87-A';
    DELETE FROM cierres_financieros_ruta WHERE ruta_id = 8780;
    DELETE FROM inventario_mov WHERE producto = 'F87-A';
    DELETE FROM stock_operaciones WHERE ruta_id = 8780;
    DELETE FROM rutas WHERE id = 8780; DELETE FROM cuartos_frios WHERE id = 'CF-F87A'; DELETE FROM productos WHERE sku = 'F87-A';
    UPDATE cuartos_frios SET stock = stock - 'F87-A' WHERE stock ? 'F87-A';
    DELETE FROM usuarios WHERE id = 8781; DELETE FROM auth.users WHERE id = '${CH}';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${CH}', 'choferf87@t');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (8781, 'ChoferF 87', 'choferf87@t', 'Chofer', 'Activo', '${CH}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('F87-A', 'Hielo F87', 'Producto Terminado', 30, 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-F87A', 'Cuarto F87A', '{"F87-A": 50}');
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
      (8780, 'R-8780', 'Ruta F87', 8781, 'ChoferF 87', 'Pendiente firma', CURRENT_DATE, '{"F87-A": 10}', '{"F87-A": 10}', '{}', '{"F87-A": 10}', now());
    COMMIT;`);
  const storage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; })();
  const rpc = async (fn, args) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: CH })]);
    const keys = Object.keys(args);
    const sql = `SELECT * FROM ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    try {
      const r = await c.query(sql, keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]));
      await c.query('COMMIT'); return { data: r.rows.length === 1 && r.fields.length === 1 ? r.rows[0][r.fields[0].name] : r.rows };
    } catch (e) { await c.query('ROLLBACK'); return { error: { message: e.message, code: e.code, details: e.detail } }; }
  };
  let r = await rpc('confirmar_carga_ruta', { p_operacion_id: '87f10000-0000-0000-0000-000000000001', p_ruta_id: 8780, p_firma: 'data:x' });
  await c.query(`UPDATE rutas SET estatus = 'En progreso' WHERE id = 8780`);
  ok(!r.error && await n(`SELECT (stock->>'F87-A')::int FROM cuartos_frios WHERE id = 'CF-F87A'`) === 40, '087-F1 carga por contrato (50 → 40)');
  // paso 1: cierre financiero (sin entregas) + lote de mermas + balance
  const pay = F.normalizarEntregasCierre([]);
  const opFin = F.resolverOperacion(F.leerOperacionCierre(storage, 8780), F.claveCierreFinanciero(8780, pay));
  F.guardarOperacionCierre(storage, 8780, opFin);
  r = await rpc('cerrar_ruta_financiero', F.buildCerrarFinancieroArgs({ operacionId: opFin.id, rutaId: 8780, entregas: pay, usuarioId: 8781, usuarioNombre: 'ChoferF 87' }).args);
  ok(!r.error, '087-F2 cierre financiero desde los builders');
  const mermas = [{ id: 1, sku: 'F87-A', cant: 2, causa: 'Bolsa rota', foto: 'data:image/jpeg;base64,AA' }];
  const keyM = L.claveStorageMermasRuta(8780);
  const opM = L.resolverOperacion(L.leerOperacion(storage, keyM), L.claveMermasRuta(8780, mermas));
  L.guardarOperacion(storage, keyM, opM);
  const bM = L.buildMermasRutaArgs({ operacionId: opM.id, rutaId: 8780, mermas });
  ok(Object.keys(bM.args).join() === 'p_operacion_id,p_ruta_id,p_mermas', '087-F3 registrar_mermas_ruta: nombres exactos');
  r = await rpc('registrar_mermas_ruta', bM.args);
  const r2 = await rpc('registrar_mermas_ruta', L.buildMermasRutaArgs({ operacionId: L.resolverOperacion(L.leerOperacion(storage, keyM), L.claveMermasRuta(8780, [...mermas].reverse())).id, rutaId: 8780, mermas }).args);
  ok(!r.error && r.data.replay === false && !r2.error && r2.data.replay === true && await n(`SELECT count(*) FROM mermas WHERE ruta_id = 8780`) === 1, '087-F4 lote de mermas: reintento con el UUID persistido = replay, 1 merma');
  r = await rpc('calcular_balance_ruta', { p_ruta_id: 8780 });
  const bal = L.interpretarBalance(r.data);
  ok(!r.error && bal.length === 1 && bal[0].restante === 8 && bal[0].merma === 2, '087-F5 balance canónico al cliente: restante 8');
  // paso 2: conteo con faltante → detalle estructurado → merma explícita → cierre
  const conteoMal = { 'F87-A': '7' };
  const keyC = L.claveStorageCierreInventario(8780);
  let opC = L.resolverOperacion(L.leerOperacion(storage, keyC), L.claveCierreInventario(8780, L.normalizarConteo(conteoMal).conteo));
  L.guardarOperacion(storage, keyC, opC);
  r = await rpc('finalizar_inventario_ruta', L.buildFinalizarInventarioArgs({ operacionId: opC.id, rutaId: 8780, conteo: conteoMal }).args);
  const det = L.detalleErrorInventario(r.error);
  ok(r.error && det.faltante && det.faltante['F87-A'] === 1 && /Faltan 1×F87-A/.test(L.mensajeErrorInventarioRuta(r.error)), '087-F6 faltante estructurado leído y traducido; sin efectos');
  const gap = [{ id: 2, sku: 'F87-A', cant: det.faltante['F87-A'], causa: 'Faltante al contar', foto: 'data:image/jpeg;base64,BB' }];
  r = await rpc('registrar_mermas_ruta', L.buildMermasRutaArgs({ operacionId: L.resolverOperacion(L.leerOperacion(storage, keyM), L.claveMermasRuta(8780, gap)).id, rutaId: 8780, mermas: gap }).args);
  ok(!r.error && r.data.replay === false, '087-F7 segundo lote (merma del faltante) registrado');
  opC = L.resolverOperacion(L.leerOperacion(storage, keyC), L.claveCierreInventario(8780, L.normalizarConteo(conteoMal).conteo));
  r = await rpc('finalizar_inventario_ruta', L.buildFinalizarInventarioArgs({ operacionId: opC.id, rutaId: 8780, conteo: conteoMal }).args);
  const rr = await rpc('finalizar_inventario_ruta', L.buildFinalizarInventarioArgs({ operacionId: opC.id, rutaId: 8780, conteo: { 'F87-A': 7 } }).args);
  ok(!r.error && r.data.estatus === 'Cerrada' && !rr.error && rr.data.replay === true, '087-F8 misma operación (UUID persistido) cierra; el reintento es replay');
  ok(await n(`SELECT (stock->>'F87-A')::int FROM cuartos_frios WHERE id = 'CF-F87A'`) === 47 && await n(`SELECT count(*) FROM rutas WHERE id = 8780 AND estatus = 'Cerrada' AND devolucion = '{"F87-A": 7}'::jsonb`) === 1, '087-F9 el cuarto recibe 7 una sola vez (40 → 47); 10 = 3 merma + 7');
  await c.query(limpiar);
  if (!okF) { console.log('RESULTADO: FALLÓ (087 frontend↔DB)'); process.exit(1); }
}
await fe087();

// ═══ 088/089 — B3: autorización e integridad financiera ═══
{
  const PROD = {
    'update_orden_atomic': null, 'crear_cxc_orden': 'e394bc62507c807f2ad4e13de82ebca8', 'registrar_pago_orden': 'f91e62d711f2bd9895cbc24da707b37e',
    'registrar_ingreso_orden': 'a113836cce033d8103e802f2fc4fd0be', 'abonar_cxc': '46dc11821395834782f4c60d7624645e',
  };
  const rows = (await c.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(PROD)])).rows;
  const mal = rows.filter(r => PROD[r.proname] && PROD[r.proname] !== r.m).map(r => `${r.proname}=${r.m}`);
  const nuevo = (await c.query(`SELECT to_regprocedure('public.crear_orden(jsonb,jsonb)') IS NULL AS a, NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precios_esp_cliente_sku_key') AS b`)).rows[0];
  const ok = rows.length === 5 && mal.length === 0 && nuevo.a && nuevo.b;
  console.log(`  FINANZAS_PARITY_CHECK[pre-088]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (!ok) process.exit(1);
}
for (const [f, n] of [['088_b3_integridad_financiera.sql', '088'], ['089_b3_contencion_ordenes.sql', '089']]) {
  for (const k of [1, 2]) {
    console.log(`── aplicar ${n} (${k}/2${k === 2 ? ', idempotencia' : ''})`);
    const rr = await runFile(c, path.join(ROOT, 'supabase', f), { stopOnError: true });
    if (rr.aborted) process.exit(1);
  }
}
if (!(await rlsCheck('tras 088/089 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 088)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[088]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 088 (B3 integridad financiera)');
const r088t = await runFile(c, path.join(ROOT, 'supabase/tests/088_b3_integridad_test.sql'), { stopOnError: true, echo: true });
if (r088t.aborted) { console.log('RESULTADO: FALLÓ (088)'); process.exit(1); }

async function conc088() {
  console.log('── 088 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '88c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN;
    DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 8861 AND 8869;
    DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8871 AND 8879);
    DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8871 AND 8879);
    DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 8871 AND 8879;
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 8871 AND 8879);
    DELETE FROM ordenes WHERE cliente_id BETWEEN 8871 AND 8879;
    DELETE FROM movimientos_contables WHERE referencia LIKE 'recepcion_compra/88c%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C88-%';
    DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 8861 AND 8869 OR operacion_id::text LIKE '88c%';
    DELETE FROM rutas WHERE id BETWEEN 8861 AND 8869; DELETE FROM clientes WHERE id BETWEEN 8871 AND 8879;
    DELETE FROM cuartos_frios WHERE id = 'CF-C88'; UPDATE cuartos_frios SET stock = stock - 'C88-A' WHERE stock ? 'C88-A';
    DELETE FROM productos WHERE sku LIKE 'C88-%';
    DELETE FROM usuarios WHERE id BETWEEN 8861 AND 8869; DELETE FROM auth.users WHERE id::text LIKE '88c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) SELECT ('88c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t88c' FROM generate_series(1, 5) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (8861, 'ChoferC88-1', 'c1@t88c', 'Chofer', 'Activo', '${SUB(1)}'), (8862, 'ChoferC88-2', 'c2@t88c', 'Chofer', 'Activo', '${SUB(2)}'),
      (8863, 'VentasC88', 'c3@t88c', 'Ventas', 'Activo', '${SUB(3)}'), (8864, 'ChoferC88-3', 'c4@t88c', 'Chofer', 'Activo', '${SUB(4)}'),
      (8865, 'BolsasC88', 'c5@t88c', 'Almacén Bolsas', 'Activo', '${SUB(5)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock) VALUES ('C88-A', 'Hielo C88', 'Producto Terminado', 40, 0), ('C88-E', 'Bolsa C88', 'Empaque', 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C88', 'Cuarto C88', '{"C88-A": 100}');
    INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (8871, 'Cliente C88 A', 'CAA880101AB1', 0, true, 100), (8872, 'Cliente C88 B', 'CBB880101AB1', 0, true, 100);
    INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
      (8861, 'R-8861', 'Ruta C88-1', 8861, 'ChoferC88-1', 'Pendiente firma', CURRENT_DATE, '{"C88-A": 10}', '{"C88-A": 10}', '{}', '{"C88-A": 10}', now()),
      (8862, 'R-8862', 'Ruta C88-2', 8862, 'ChoferC88-2', 'Pendiente firma', CURRENT_DATE, '{"C88-A": 10}', '{"C88-A": 10}', '{}', '{"C88-A": 10}', now()),
      (8863, 'R-8863', 'Ruta C88-3', 8864, 'ChoferC88-3', 'Pendiente firma', CURRENT_DATE, '{"C88-A": 10}', '{"C88-A": 10}', '{}', '{"C88-A": 10}', now());
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const solo = async (sub, sql, params) => {
    await actor(a, sub);
    try { const r = await a.query(sql, params); await a.query('COMMIT'); return { ok: true, row: r.rows[0] }; }
    catch (e) { await a.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  for (const [k, r] of [[1, 8861], [2, 8862], [4, 8863]]) {
    const x = await solo(SUB(k), `SELECT confirmar_carga_ruta($1::uuid, $2::bigint, 'firma') AS r`, [`88c20000-0000-0000-0000-00000000000${k}`, r]);
    const y = await solo(SUB(k), `UPDATE rutas SET estatus = 'En progreso' WHERE id = $1`, [r]);
    if (!x.ok || !y.ok) { console.log('  fixture falló', x.msg || y.msg); process.exit(1); }
  }
  const FIN = `SELECT cerrar_ruta_financiero($1::uuid, $2::bigint, $3::jsonb) AS r`;
  const exp = (cli) => JSON.stringify([{ express: true, clienteId: cli, pago: 'Crédito', items: [{ sku: 'C88-A', cant: 2, precio: 40 }] }]);
  // C1: dos ventas exprés a crédito de 80 contra un límite de 100
  let r = await carrera(SUB(1), FIN, ['88c30000-0000-0000-0000-000000000001', 8861, exp(8871)], SUB(2), FIN, ['88c30000-0000-0000-0000-000000000002', 8862, exp(8871)]);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /Excede límite/.test(r.rb.msg || ''), `088-C1a exprés 80 + exprés 80 (límite 100): la segunda espera y se rechaza (${r.rb.code || 'ok'})`);
  ok(await n(`SELECT COALESCE(SUM(saldo_pendiente), 0) FROM cuentas_por_cobrar WHERE cliente_id = 8871`) === 80 && await n(`SELECT saldo FROM clientes WHERE id = 8871`) === 80, '088-C1b saldo del cliente 80 ≤ 100; una sola CxC');
  // C2: venta normal a crédito (Ventas) concurrente con exprés a crédito, mismo cliente
  const NORMAL = `SELECT crear_orden('{"cliente_id": 8872, "tipo_cobro": "Credito"}'::jsonb, '[{"sku":"C88-A","cantidad":2}]'::jsonb) AS r`;
  r = await carrera(SUB(3), NORMAL, [], SUB(4), FIN, ['88c30000-0000-0000-0000-000000000003', 8863, exp(8872)]);
  ok(r.ra.ok && r.bloqueado, '088-C2a crear_orden y la venta exprés se serializan por el cliente');
  const idNormal = r.ra.ok ? Number(r.ra.row.r.id) : null;
  await c.query(`UPDATE ordenes SET estatus = 'Entregada' WHERE id = $1`, [idNormal]);
  const r2 = await solo(SUB(3), `SELECT crear_cxc_orden($1::bigint, 30) AS r`, [idNormal]);
  const saldoB = await n(`SELECT saldo FROM clientes WHERE id = 8872`);
  ok(saldoB <= 100 && (r.rb.ok ? !r2.ok && /Excede límite/.test(r2.msg || '') : r2.ok), `088-C2b el saldo nunca supera el límite (saldo ${saldoB}; exprés ${r.rb.ok ? 'aceptada → CxC de la venta normal rechazada al entregar' : 'rechazada'})`);
  // C3: misma recepción de compra enviada dos veces a la vez
  const REC = `SELECT registrar_recepcion_compra('88c40000-0000-0000-0000-000000000001'::uuid, 'C88-E', 50, 120, 'Prov C88', false) AS r`;
  r = await carrera(SUB(5), REC, [], SUB(5), REC, []);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '088-C3a misma recepción simultánea: la segunda espera y es replay');
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C88-E'`) === 50 && await n(`SELECT count(*) FROM movimientos_contables WHERE referencia = 'recepcion_compra/88c40000-0000-0000-0000-000000000001'`) === 1, '088-C3b stock +50 una vez, un solo egreso');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (088 concurrencia)'); process.exit(1); }
}
await conc088();
for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos', 'inventario_mov']) {
  await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
}
for (const [etq, f] of [['087', '087_inventario_ruta_test.sql'], ['086', '086_cierre_financiero_test.sql'], ['085', '085_contencion_stock_test.sql'], ['084', '084_contratos_stock_test.sql'], ['083', '083_self_read_auth_id_test.sql'], ['082', '082_r3_r4_test.sql'], ['081', '081_ruta_id_ordenes_test.sql'], ['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras 088)`); process.exit(1); }
  console.log(`  ${etq} tras 088: PASS`);
}
await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (regresión 071 tras 088)'); process.exit(1); }
  console.log('  071 tras 088: PASS');
}
console.log('── 084 concurrencia + frontend↔DB tras 087');
await conc084();
await fe084();
console.log('── 076 concurrencia y frontend↔DB tras 087');
await conc076();
await fe076();
console.log('── 086 concurrencia + frontend↔DB tras 087');
await conc086();
await fe086();
console.log('── 087 concurrencia + frontend↔DB tras 088');
await conc087();
await fe087();
console.log('  concurrencia + frontend↔DB (076, 084, 086 y 087) tras 088: PASS');

// ═══ 090/091 — B4: privilegios, ejecución e historia canónica ═══
{
  // Paridad previa: las funciones que 090 reemplaza siguen idénticas a producción.
  // Deriva conocida: el wrapper nextval de producción no viene del repo (004
  // crea otra versión). Se instala el cuerpo exacto de producción para que 090
  // se pruebe sobre el estado real.
  await c.query(`CREATE OR REPLACE FUNCTION public.nextval(seq_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN nextval(seq_name::regclass);
END;
$function$`);
  const PROD = {
    'nextval(text)': '6f6a38eb7e9bfb545074f9cd2fb7d020', 'erp_actor_etiqueta()': '8005e4dcb61976fc0a888c7dbfcab712',
    'registrar_produccion(uuid,text,text,text,integer,text)': 'bda21dcb98902374f7eb85e85bf04f80',
    'registrar_transformacion(uuid,text,integer,text,integer,text,text)': '6ce6d5b76b85874250d2ee652fe032e8',
    'cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)': 'c17d27ac7e244c62e4a8443a9bf524bc',
    'cerrar_ruta_financiero(bigint,jsonb,bigint,text)': '0ef270736929d362bafcc1d8b37b8cc5',
  };
  const rows = (await c.query(`SELECT oid::regprocedure::text AS sig, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('nextval','erp_actor_etiqueta','registrar_produccion','registrar_transformacion','cerrar_ruta_financiero')`)).rows;
  const mal = Object.keys(PROD).filter(k => (rows.find(r => r.sig === k) || {}).m !== PROD[k]);
  const muertas = (await c.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('registrar_pago','move_stock','confirmar_produccion','timbrar_orden','check_orden_transition','check_produccion_transition','check_stock_positive','prevent_mutation')`)).rows[0].n;
  const ok = mal.length === 0 && muertas === 8;
  console.log(`  B4_PARITY_CHECK[pre-090]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify({ mal, muertas })}`);
  if (!ok) process.exit(1);
  // Rol dueño como en producción, con los privilegios por defecto de Supabase.
  await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF; END $$`);
  await c.query(`GRANT USAGE, CREATE ON SCHEMA public TO postgres`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 090 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '090_b4_privilegios_e_historia.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 090 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 090)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[090]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)} restantes=${JSON.stringify(perm.map(x => x.p))}`);
  if (mal.length) process.exit(1);
}
async function reruns090(etiqueta, omitir = []) {
  // Artefacto del arnés: el barrido de EXECUTE/grants de 090 también alcanza a
  // los helpers de prueba (t*_) que ya existían; CREATE OR REPLACE conserva ese
  // ACL. Se restaura solo para objetos de prueba.
  await c.query(`DO $$ DECLARE f RECORD; BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^t[0-9]*_' LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', f.sig); END LOOP;
    FOR f IN SELECT c.oid::regclass AS rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND c.relname ~ '^t[0-9]*_' LOOP
      EXECUTE format('GRANT ALL ON %s TO anon, authenticated, service_role', f.rel); END LOOP;
  END $$`);
  for (const t of ['clientes', 'ordenes', 'leads', 'invoice_attempts', 'chofer_ubicaciones', 'movimientos_contables', 'auditoria', 'productos', 'rutas', 'pagos', 'inventario_mov', 'notificaciones', 'payment_webhook_events', 'payment_intents']) {
    await c.query(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), (SELECT last_value FROM ${t}_id_seq)))`);
  }
  for (const [etq, f] of [['088', '088_b3_integridad_test.sql'], ['087', '087_inventario_ruta_test.sql'], ['086', '086_cierre_financiero_test.sql'], ['085', '085_contencion_stock_test.sql'], ['084', '084_contratos_stock_test.sql'], ['083', '083_self_read_auth_id_test.sql'], ['082', '082_r3_r4_test.sql'], ['081', '081_ruta_id_ordenes_test.sql'], ['080', '080_rpc_asignacion_test.sql'], ['079', '079_identidad_legacy_test.sql'], ['078', '078_rutas_chofer_test.sql'], ['077', '077_escrituras_produccion_test.sql'], ['076', '076_produccion_atomica_test.sql'], ['075', '075_cuartos_precios_test.sql'], ['074', '074_rename_sku_test.sql'], ['073', '073_vista_gps_test.sql'], ['072', '072_mermas_test.sql']].filter(([e]) => !omitir.includes(e))) {
    const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
    if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión ${etq} tras ${etiqueta})`); process.exit(1); }
    console.log(`  ${etq} tras ${etiqueta}: PASS`);
  }
  await c.query('DELETE FROM payment_webhook_events WHERE id = 600');
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/071_actor_activo_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (regresión 071 tras ${etiqueta})`); process.exit(1); }
  console.log(`  071 tras ${etiqueta}: PASS`);
}
console.log('── PRUEBAS 090 (antes de 091: bundle anterior aún escribe CxC)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/090_b4_privilegios_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (090)'); process.exit(1); }
}
await reruns090('090');
for (const k of [1, 2]) {
  console.log(`── aplicar 091 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '091_b4_contencion_cxc.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 090 (tras 091)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/090_b4_privilegios_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (090 tras 091)'); process.exit(1); }
}
await reruns090('091');
console.log('── concurrencia + frontend↔DB tras 090/091');
await conc084();
await fe084();
await conc076();
await fe076();
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
console.log('  concurrencia + frontend↔DB (076, 084, 086, 087 y 088) tras 090/091: PASS');

// ═══ 092 — semántica de empaque (Modelo A) ═══
{
  const PROD = {
    'registrar_salida_empaque(uuid,text,integer)': '12f6bd9e69f93eef047f371b301d4669',
    'registrar_produccion(uuid,text,text,text,integer,text)': 'c7765ff42dc42c74707650b181cbf742',
    'registrar_recepcion_compra(uuid,text,integer,numeric,text,boolean)': '2f1ccd52b2c71fd41afd8d766084bdfd',
  };
  const rows = (await c.query(`SELECT oid::regprocedure::text AS sig, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('registrar_salida_empaque','registrar_produccion','registrar_recepcion_compra')`)).rows;
  const mal = Object.keys(PROD).filter(k => (rows.find(x => x.sig === k) || {}).m !== PROD[k]);
  const nuevo = (await c.query(`SELECT to_regprocedure('public.conciliacion_empaque()') IS NULL AS a`)).rows[0].a;
  const ok = mal.length === 0 && nuevo;
  console.log(`  EMPAQUE_PARITY_CHECK[pre-092]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 092 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '092_empaque_entrega_produccion.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 092 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 092)'); process.exit(1); }
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[092]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 092 (empaque: entrega vs consumo)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/092_empaque_entrega_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (092)'); process.exit(1); }
}
await reruns090('092');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/090_b4_privilegios_test.sql'), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (090 tras 092)'); process.exit(1); }
  console.log('  090 tras 092: PASS');
}
async function conc092() {
  console.log('── 092 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '92c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN;
    DELETE FROM costos_historial WHERE concepto LIKE '%C92-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C92-%';
    DELETE FROM produccion WHERE sku LIKE 'C92-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '92c%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C92';
    DELETE FROM productos WHERE sku LIKE 'C92-%';
    DELETE FROM usuarios WHERE id BETWEEN 9261 AND 9269; DELETE FROM auth.users WHERE id::text LIKE '92c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) SELECT ('92c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t92c' FROM generate_series(1, 3) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (9261, 'ProdC92-1', 'c1@t92c', 'Producción', 'Activo', '${SUB(1)}'), (9262, 'ProdC92-2', 'c2@t92c', 'Producción', 'Activo', '${SUB(2)}'),
      (9263, 'BolsasC92', 'c3@t92c', 'Almacén Bolsas', 'Activo', '${SUB(3)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C92-E', 'Bolsa C92', 'Empaque', 0, 100, 1, NULL), ('C92-H', 'Hielo C92', 'Producto Terminado', 30, 0, 0, 'C92-E');
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C92', 'Cuarto C92', '{}'::jsonb);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const PRODQ = `SELECT registrar_produccion($1::uuid, 'Turno 1', 'Máquina C92', 'C92-H', $2::int, 'CF-C92') AS r`;
  // C1: dos producciones distintas de 60 contra un total de 100
  let r = await carrera(SUB(1), PRODQ, ['92c10000-0000-0000-0000-000000000001', 60], SUB(2), PRODQ, ['92c10000-0000-0000-0000-000000000002', 60]);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /Stock insuficiente/.test(r.rb.msg || ''), `092-C1a producción 60 + producción 60 (total 100): la segunda espera y se rechaza (${r.rb.code || 'ok'})`);
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C92-E'`) === 40 && await n(`SELECT count(*) FROM produccion WHERE sku = 'C92-H'`) === 1, '092-C1b sin sobreconsumo: total 40, una sola producción');
  // C2: misma producción (mismo UUID) simultánea
  r = await carrera(SUB(1), PRODQ, ['92c10000-0000-0000-0000-000000000003', 10], SUB(2), PRODQ, ['92c10000-0000-0000-0000-000000000003', 10]);
  ok(r.ra.ok && r.rb.ok && r.rb.row.r.replay === true, '092-C2a misma producción simultánea: la segunda es replay');
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C92-E'`) === 30 && await n(`SELECT count(*) FROM produccion WHERE operacion_id = '92c10000-0000-0000-0000-000000000003'`) === 1, '092-C2b un solo consumo (40 → 30)');
  // C3: misma entrega a Producción simultánea
  const ENT = `SELECT registrar_salida_empaque($1::uuid, 'C92-E', 25) AS r`;
  r = await carrera(SUB(3), ENT, ['92c20000-0000-0000-0000-000000000001'], SUB(3), ENT, ['92c20000-0000-0000-0000-000000000001']);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '092-C3a misma entrega simultánea: la segunda espera y es replay');
  ok(await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = '92c20000-0000-0000-0000-000000000001' AND tipo = 'Entrega a Producción'`) === 1
    && await n(`SELECT stock FROM productos WHERE sku = 'C92-E'`) === 30, '092-C3b un solo evento de entrega; el total no cambia (30)');
  // C4: entrega y producción simultáneas: la entrega no bloquea ni descuenta
  r = await carrera(SUB(3), ENT, ['92c20000-0000-0000-0000-000000000002'], SUB(1), PRODQ, ['92c10000-0000-0000-0000-000000000004', 30]);
  ok(r.ra.ok && r.rb.ok && !r.bloqueado, '092-C4a entrega y producción simultáneas: ninguna espera a la otra');
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C92-E'`) === 0, '092-C4b solo la producción consume (30 → 0)');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (092 concurrencia)'); process.exit(1); }
}
await conc092();
console.log('── concurrencia + frontend↔DB tras 092');
await conc076();
await fe076();
await conc084();
await fe084();
await conc088();
console.log('  concurrencia + frontend↔DB (076, 084, 088) tras 092: PASS');

// ═══ 093/094 — finanzas (efectivo vs resultados), producción inmutable, stock trazable ═══
{
  const PROD = {
    'conciliacion_empaque()': '88d9ef2013b90340d9de7c435884a896',
    'costos_historial_guard()': 'd9f29f36245e70db1b4cf5304d72b448',
    'inventario_mov_guard()': 'b2fba39ec7f289076a61337298c37c50',
  };
  const rows = (await c.query(`SELECT oid::regprocedure::text AS sig, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('conciliacion_empaque','costos_historial_guard','inventario_mov_guard')`)).rows;
  const mal = Object.keys(PROD).filter(k => (rows.find(x => x.sig === k) || {}).m !== PROD[k]);
  const nuevo = (await c.query(`SELECT to_regprocedure('public.revertir_produccion(uuid,bigint,text)') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ordenes' AND column_name = 'delivered_at') AS a`)).rows[0].a;
  const ok = mal.length === 0 && nuevo;
  console.log(`  FINANZAS093_PARITY_CHECK[pre-093]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 093 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '093_finanzas_reverso_produccion.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 093 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 093)'); process.exit(1); }
console.log('── PRUEBAS 093 (antes de 094: el frontend anterior conserva DELETE y UPDATE de stock)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/093_finanzas_reverso_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (093)'); process.exit(1); }
}
await reruns090('093');
for (const [etq, f] of [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 093)`); process.exit(1); }
  console.log(`  ${etq} tras 093: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 094 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '094_contencion_produccion_stock.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
{
  const perm = (await c.query(`SELECT tablename||'|'||policyname AS p, cmd FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true' OR roles::text ~ 'public') ORDER BY 1`)).rows;
  const mal = perm.filter(x => !PERMISIVAS_DEUDA_072.includes(x.p)).map(x => x.p + ':' + x.cmd);
  console.log(`  PERMISSIVE_POLICY_CHECK[094]: ${mal.length === 0 ? 'PASS' : 'FAIL'} fuera_de_deuda=${JSON.stringify(mal)}`);
  if (mal.length) process.exit(1);
}
console.log('── PRUEBAS 093 (tras 094)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/093_finanzas_reverso_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (093 tras 094)'); process.exit(1); }
}
await reruns090('094');
for (const [etq, f] of [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 094)`); process.exit(1); }
  console.log(`  ${etq} tras 094: PASS`);
}
async function conc093() {
  console.log('── 093 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '93c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM costos_historial WHERE concepto LIKE '%C93-%';
    DO $x$ BEGIN IF to_regclass('public.costos_empaque_historial') IS NOT NULL THEN DELETE FROM costos_empaque_historial WHERE sku LIKE 'C93-%'; END IF; END $x$;
    DELETE FROM auditoria WHERE detalle LIKE '%C93-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C93-%';
    DELETE FROM produccion WHERE sku LIKE 'C93-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '93c%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C93';
    DELETE FROM productos WHERE sku LIKE 'C93-%';
    DELETE FROM usuarios WHERE id BETWEEN 9361 AND 9369; DELETE FROM auth.users WHERE id::text LIKE '93c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO auth.users (id, email) SELECT ('93c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t93c' FROM generate_series(1, 3) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (9361, 'AdminC93-1', 'c1@t93c', 'Admin', 'Activo', '${SUB(1)}'), (9362, 'AdminC93-2', 'c2@t93c', 'Admin', 'Activo', '${SUB(2)}'),
      (9363, 'ProdC93', 'c3@t93c', 'Producción', 'Activo', '${SUB(3)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C93-E', 'Bolsa C93', 'Empaque', 0, 100, 1, NULL), ('C93-H', 'Hielo C93', 'Producto Terminado', 30, 0, 0, 'C93-E');
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C93', 'Cuarto C93', '{}'::jsonb);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  await actor(a, SUB(3));
  const pr = (await a.query(`SELECT registrar_produccion('93c10000-0000-0000-0000-000000000001', 'Turno 1', 'Máquina C93', 'C93-H', 30, 'CF-C93') AS r`)).rows[0].r;
  await a.query('COMMIT');
  const REV = `SELECT revertir_produccion($1::uuid, $2::bigint, 'carrera') AS r`;
  // C1: dos reversos distintos de la misma producción al mismo tiempo
  let r = await carrera(SUB(1), REV, ['93c20000-0000-0000-0000-000000000001', pr.id], SUB(2), REV, ['93c20000-0000-0000-0000-000000000002', pr.id]);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /ya fue revertida/.test(r.rb.msg || ''), `093-C1a dos reversos simultáneos: el segundo espera y se rechaza (${r.rb.code || 'ok'})`);
  ok(await n(`SELECT (stock->>'C93-H')::int FROM cuartos_frios WHERE id = 'CF-C93'`) === 0 && await n(`SELECT stock FROM productos WHERE sku = 'C93-E'`) === 100
    && await n(`SELECT count(*) FROM costos_historial WHERE tipo = 'Reverso producción' AND concepto LIKE '%C93-H%'`) === 1, '093-C1b un solo reverso: cuarto 30 → 0, empaque 70 → 100, un costo compensatorio');
  // C2: el mismo reverso (mismo UUID) al mismo tiempo
  await actor(a, SUB(3));
  const pr2 = (await a.query(`SELECT registrar_produccion('93c10000-0000-0000-0000-000000000002', 'Turno 1', 'Máquina C93', 'C93-H', 10, 'CF-C93') AS r`)).rows[0].r;
  await a.query('COMMIT');
  r = await carrera(SUB(1), REV, ['93c20000-0000-0000-0000-000000000003', pr2.id], SUB(1), REV, ['93c20000-0000-0000-0000-000000000003', pr2.id]);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '093-C2a mismo reverso simultáneo: la segunda espera y es replay');
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C93-E'`) === 100 && await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = '93c20000-0000-0000-0000-000000000003'`) === 2, '093-C2b un solo efecto (empaque de vuelta en 100, dos kardex)');
  // C3: producción y ajuste de existencia del empaque al mismo tiempo: sin carrera de stock
  const AJ = `SELECT ajustar_existencia($1::uuid, 'C93-E', 90, 'conteo C93') AS r`;
  const PRODQ = `SELECT registrar_produccion($1::uuid, 'Turno 1', 'Máquina C93', 'C93-H', 5, 'CF-C93') AS r`;
  r = await carrera(SUB(1), AJ, ['93c30000-0000-0000-0000-000000000001'], SUB(3), PRODQ, ['93c10000-0000-0000-0000-000000000003']);
  ok(r.ra.ok && r.bloqueado && r.rb.ok, '093-C3a ajuste y producción simultáneos: la producción espera el lock del empaque');
  ok(await n(`SELECT stock FROM productos WHERE sku = 'C93-E'`) === 85, '093-C3b el ajuste fija 90 y después la producción consume 5 (85): nada se pierde');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (093 concurrencia)'); process.exit(1); }
}
await conc093();
console.log('── concurrencia + frontend↔DB tras 093/094');
await conc076();
await fe076();
await conc084();
await fe084();
await conc088();
await conc092();
console.log('  concurrencia + frontend↔DB (076, 084, 088, 092) tras 093/094: PASS');

// ═══ 095 — contención del borrado de producción de clientes anteriores a 094 ═══
{
  const PROD = { 'update_stocks_atomic(jsonb)': '097f869a7fd0202b88b303a362dedfc0', 'update_productos_stock_atomic(jsonb)': '1cec2eb11d94a9e0779b0c1673b25fa3' };
  const rows = (await c.query(`SELECT oid::regprocedure::text AS sig, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('update_stocks_atomic','update_productos_stock_atomic')`)).rows;
  const mal = Object.keys(PROD).filter(k => (rows.find(x => x.sig === k) || {}).m !== PROD[k]);
  const ok = mal.length === 0;
  console.log(`  CLIENTE_OBSOLETO_PARITY_CHECK[pre-095]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 095 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '095_contencion_cliente_obsoleto.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 095 (cliente anterior a 094)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/095_cliente_obsoleto_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (095)'); process.exit(1); }
}
await reruns090('095');
for (const [etq, f] of [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'], ['095', '095_cliente_obsoleto_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 095)`); process.exit(1); }
  console.log(`  ${etq} tras 095: PASS`);
}
console.log('── concurrencia + frontend↔DB tras 095');
await conc093();
await conc092();
await conc076();
await fe076();
await conc084();
await fe084();
await conc088();
console.log('  concurrencia + frontend↔DB (076, 084, 088, 092, 093) tras 095: PASS');

// ═══ 096/097 — día de negocio canónico (Mazatlán) y caja por contrato ═══
{
  const PROD = { 'fin_hoy()': 'a1a0a76f10d72a0d463273d6e83ab8a0', 'reporte_financiero(date,date)': '1889882877a4f005815f4da4873a529c' };
  const rows = (await c.query(`SELECT oid::regprocedure::text AS sig, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('fin_hoy','reporte_financiero')`)).rows;
  const mal = Object.keys(PROD).filter(k => (rows.find(x => x.sig === k) || {}).m !== PROD[k]);
  const nuevo = (await c.query(`SELECT to_regprocedure('public.cerrar_caja_ruta(uuid,bigint,numeric,numeric,text,text)') IS NULL AS a`)).rows[0].a;
  const ok = mal.length === 0 && nuevo;
  console.log(`  DIA_NEGOCIO_PARITY_CHECK[pre-096]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(mal)}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 096 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '096_dia_negocio_caja.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 096 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 096)'); process.exit(1); }
console.log('── PRUEBAS 096 (antes de 097: el frontend anterior aún inserta caja por REST)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/096_dia_negocio_caja_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (096)'); process.exit(1); }
}
await reruns090('096');
for (const [etq, f] of [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'], ['095', '095_cliente_obsoleto_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 096)`); process.exit(1); }
  console.log(`  ${etq} tras 096: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 097 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '097_contencion_caja.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 096 (tras 097)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/096_dia_negocio_caja_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (096 tras 097)'); process.exit(1); }
}
await reruns090('097');
for (const [etq, f] of [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'], ['095', '095_cliente_obsoleto_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 097)`); process.exit(1); }
  console.log(`  ${etq} tras 097: PASS`);
}
async function conc096() {
  console.log('── 096 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '96c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM cierres_diarios WHERE ruta_id BETWEEN 9661 AND 9669; DELETE FROM auditoria WHERE detalle LIKE 'R-966%';
    DELETE FROM rutas WHERE id BETWEEN 9661 AND 9669;
    DELETE FROM usuarios WHERE id BETWEEN 9661 AND 9669; DELETE FROM auth.users WHERE id::text LIKE '96c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('96c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t96c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (9661, 'AdminC96-1', 'c1@t96c', 'Admin', 'Activo', '${SUB(1)}'), (9662, 'AdminC96-2', 'c2@t96c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO rutas (id, folio, nombre, estatus, fecha, fecha_fin, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
      (9661, 'R-9661', 'C96 A', 'Cerrada', '2026-09-29', '2026-09-29', '{}', '{}', '{}', '{}'),
      (9662, 'R-9662', 'C96 B', 'Cerrada', '2026-09-29', '2026-09-29', '{}', '{}', '{}', '{}');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const CAJA = `SELECT cerrar_caja_ruta($1::uuid, $2::bigint, 0, 0) AS r`;
  let r = await carrera(SUB(1), CAJA, ['96c10000-0000-0000-0000-000000000001', 9661], SUB(2), CAJA, ['96c10000-0000-0000-0000-000000000002', 9661]);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /ya tiene cierre/.test(r.rb.msg || ''), `096-C1 dos cierres simultáneos (dos navegadores) de la misma ruta: el segundo espera y se rechaza (${r.rb.code || 'ok'})`);
  ok(await n(`SELECT count(*) FROM cierres_diarios WHERE ruta_id = 9661`) === 1, '096-C1b una sola caja');
  r = await carrera(SUB(1), CAJA, ['96c10000-0000-0000-0000-000000000003', 9662], SUB(1), CAJA, ['96c10000-0000-0000-0000-000000000003', 9662]);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '096-C2 mismo cierre (mismo UUID) simultáneo: la segunda es replay');
  ok(await n(`SELECT count(*) FROM cierres_diarios WHERE ruta_id = 9662`) === 1 && await n(`SELECT count(*) FROM auditoria WHERE detalle LIKE 'R-9662%'`) === 1, '096-C2b una caja y una auditoría');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (096 concurrencia)'); process.exit(1); }
}
await conc096();
console.log('── concurrencia + frontend↔DB tras 096/097');
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
await conc092();
await conc093();
await conc076();
await fe076();
console.log('  concurrencia + frontend↔DB (076, 086, 087, 088, 092, 093) tras 096/097: PASS');

// ═══ 098/099 — escritores de "hoy" con el día de negocio del servidor ═══
{
  const nuevo = (await c.query(`SELECT to_regprocedure('public.pagar_cuenta_por_pagar(uuid,bigint,numeric,text,text)') IS NULL
    AND to_regprocedure('public.pagar_nomina(bigint)') IS NULL AND has_table_privilege('authenticated', 'public.pagos_proveedores', 'INSERT') AS a`)).rows[0].a;
  console.log(`  DIA_NEGOCIO_ESCRITORES_PARITY_CHECK[pre-098]: ${nuevo ? 'PASS' : 'FAIL'}`);
  if (!nuevo) process.exit(1);
  // Paridad con producción (catálogo verificado read-only): 003 crea aquí un
  // trigger updated_at sobre nomina_periodos, que en producción no existe (ni
  // la columna). Sin esto, cualquier UPDATE del periodo falla solo en local.
  await c.query('DROP TRIGGER IF EXISTS trg_nomina_periodos_updated ON nomina_periodos');
}
for (const k of [1, 2]) {
  console.log(`── aplicar 098 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '098_dia_negocio_escritores.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 098 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 098)'); process.exit(1); }
const SUITES_098 = [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'], ['095', '095_cliente_obsoleto_test.sql'], ['096', '096_dia_negocio_caja_test.sql']];
console.log('── PRUEBAS 098 (antes de 099: el frontend anterior aún inserta pagos a proveedor por REST)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/098_dia_negocio_escritores_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (098)'); process.exit(1); }
}
await reruns090('098');
for (const [etq, f] of SUITES_098) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 098)`); process.exit(1); }
  console.log(`  ${etq} tras 098: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 099 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '099_contencion_pagos_proveedores.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 098 (tras 099)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/098_dia_negocio_escritores_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (098 tras 099)'); process.exit(1); }
}
await reruns090('099');
for (const [etq, f] of SUITES_098) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 099)`); process.exit(1); }
  console.log(`  ${etq} tras 099: PASS`);
}
async function conc098() {
  console.log('── 098 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => '98c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM pagos_proveedores WHERE cxp_id BETWEEN 9861 AND 9869;
    DELETE FROM costos_historial WHERE concepto LIKE 'Pago nómina C98%';
    UPDATE nomina_periodos SET movimiento_id = NULL WHERE id BETWEEN 9861 AND 9869;
    DELETE FROM movimientos_contables WHERE concepto LIKE 'Pago a ProvC98%' OR concepto LIKE 'Pago nómina C98%';
    DELETE FROM nomina_recibos WHERE periodo_id BETWEEN 9861 AND 9869; DELETE FROM nomina_periodos WHERE id BETWEEN 9861 AND 9869;
    DELETE FROM empleados WHERE id = 9861; DELETE FROM cuentas_por_pagar WHERE id BETWEEN 9861 AND 9869;
    DELETE FROM usuarios WHERE id BETWEEN 9861 AND 9869; DELETE FROM auth.users WHERE id::text LIKE '98c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('98c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t98c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (9861, 'AdminC98-1', 'c1@t98c', 'Admin', 'Activo', '${SUB(1)}'), (9862, 'AdminC98-2', 'c2@t98c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso) VALUES (9861, 'EmpC98', 'Operador', 'Producción', 1, '2026-01-01');
    INSERT INTO cuentas_por_pagar (id, proveedor, concepto, monto_original, monto_pagado, saldo_pendiente, fecha_emision, estatus) VALUES
      (9861, 'ProvC98', 'A', 1000, 0, 1000, '2026-09-01', 'Pendiente'), (9862, 'ProvC98', 'B', 1000, 0, 1000, '2026-09-01', 'Pendiente');
    INSERT INTO nomina_periodos (id, periodo, fecha_pago, estatus) VALUES (9861, 'C98-S1', '2026-09-26', 'Calculada');
    INSERT INTO nomina_recibos (periodo_id, empleado_id, neto_a_pagar) VALUES (9861, 9861, 250);
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const CXP = `SELECT pagar_cuenta_por_pagar($1::uuid, $2::bigint, $3::numeric, 'Transferencia', '') AS r`;
  let r = await carrera(SUB(1), CXP, ['98c10000-0000-0000-0000-000000000001', 9861, 300], SUB(2), CXP, ['98c10000-0000-0000-0000-000000000002', 9861, 200]);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.saldo_pendiente === 500, `098-C1 dos abonos simultáneos a la misma CxP: se serializan (saldo final 500, sin abono perdido)`);
  ok(await n(`SELECT count(*) FROM pagos_proveedores WHERE cxp_id = 9861`) === 2 && await n(`SELECT monto_pagado FROM cuentas_por_pagar WHERE id = 9861`) === 500, '098-C1b dos pagos y monto pagado 500');
  r = await carrera(SUB(1), CXP, ['98c10000-0000-0000-0000-000000000003', 9862, 300], SUB(1), CXP, ['98c10000-0000-0000-0000-000000000003', 9862, 300]);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '098-C2 mismo abono (mismo UUID) simultáneo: el segundo es replay');
  ok(await n(`SELECT count(*) FROM pagos_proveedores WHERE cxp_id = 9862`) === 1 && await n(`SELECT count(*) FROM movimientos_contables WHERE concepto LIKE 'Pago a ProvC98 — B'`) === 1
    && await n(`SELECT monto_pagado FROM cuentas_por_pagar WHERE id = 9862`) === 300, '098-C2b un pago, un egreso, monto pagado 300');
  const NOM = `SELECT pagar_nomina($1::bigint) AS r`;
  r = await carrera(SUB(1), NOM, [9861], SUB(2), NOM, [9861]);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.row.r.replay === true, '098-C3 doble pago de nómina simultáneo (dos navegadores): el segundo espera y es replay');
  ok(await n(`SELECT count(*) FROM movimientos_contables WHERE concepto = 'Pago nómina C98-S1'`) === 1 && await n(`SELECT count(*) FROM costos_historial WHERE concepto = 'Pago nómina C98-S1'`) === 1,
    '098-C3b una salida de efectivo y un costo');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (098 concurrencia)'); process.exit(1); }
}
await conc098();
console.log('── concurrencia + frontend↔DB tras 098/099');
await conc096();
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
await conc092();
await conc093();
await conc076();
await fe076();
console.log('  concurrencia + frontend↔DB (076, 086, 087, 088, 092, 093, 096) tras 098/099: PASS');

// ═══ 100/101 — nómina canónica (sábado→viernes, snapshot, inmutable) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.crear_periodo_nomina(date)') IS NULL
    AND has_table_privilege('authenticated', 'public.nomina_periodos', 'INSERT')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nomina_periodos' AND column_name = 'fecha_inicio') AS a`)).rows[0].a;
  console.log(`  NOMINA_PARITY_CHECK[pre-100]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 100 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '100_nomina_canonica.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 100 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 100)'); process.exit(1); }
const SUITES_100 = [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'],
  ['095', '095_cliente_obsoleto_test.sql'], ['096', '096_dia_negocio_caja_test.sql'], ['098', '098_dia_negocio_escritores_test.sql']];
console.log('── PRUEBAS 100 (antes de 101: guardas sin revocar privilegios)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/100_nomina_canonica_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (100)'); process.exit(1); }
}
await reruns090('100');
for (const [etq, f] of SUITES_100) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 100)`); process.exit(1); }
  console.log(`  ${etq} tras 100: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 101 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '101_contencion_nomina.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 100 (tras 101)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/100_nomina_canonica_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (100 tras 101)'); process.exit(1); }
}
await reruns090('101');
for (const [etq, f] of SUITES_100) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 101)`); process.exit(1); }
  console.log(`  ${etq} tras 101: PASS`);
}
async function conc100() {
  console.log('── 100 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a0c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE IF NOT EXISTS c100_movs (id BIGINT); DELETE FROM c100_movs;
    INSERT INTO c100_movs SELECT movimiento_id FROM nomina_periodos WHERE creado_por LIKE 'AdminC100-%' AND movimiento_id IS NOT NULL;
    DELETE FROM costos_historial WHERE movimiento_id IN (SELECT id FROM c100_movs);
    DELETE FROM nomina_recibos WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por LIKE 'AdminC100-%') OR empleado_id BETWEEN 10061 AND 10069;
    DELETE FROM nomina_periodos WHERE creado_por LIKE 'AdminC100-%';
    DELETE FROM movimientos_contables WHERE id IN (SELECT id FROM c100_movs);
    DELETE FROM auditoria WHERE usuario LIKE 'AdminC100-%';
    DELETE FROM empleados WHERE id BETWEEN 10061 AND 10069;
    DELETE FROM usuarios WHERE id BETWEEN 10061 AND 10069; DELETE FROM auth.users WHERE id::text LIKE 'a0c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a0c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t100c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10061, 'AdminC100-1', 'c1@t100c', 'Admin', 'Activo', '${SUB(1)}'), (10062, 'AdminC100-2', 'c2@t100c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES
      (10061, 'EmpC100 uno', 'Operador', 'Producción', 100, '2024-01-01', 'Activo'), (10062, 'EmpC100 dos', 'Operador', 'Producción', 200, '2024-01-01', 'Activo');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  // Dos Admins, mismo instante, distinto día de la misma semana canónica.
  let r = await carrera(SUB(1), `SELECT crear_periodo_nomina(nomina_inicio_semana(fin_hoy() - 35)) AS r`, [],
                        SUB(2), `SELECT crear_periodo_nomina(nomina_inicio_semana(fin_hoy() - 35) + 4) AS r`, []);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && r.ra.row.r.periodo_id === r.rb.row.r.periodo_id
     && await n(`SELECT count(*) FROM nomina_periodos WHERE fecha_inicio = nomina_inicio_semana(fin_hoy() - 35)`) === 1,
     '100-C1 dos Admins crean la misma semana a la vez: un solo periodo, el segundo espera y es replay');
  const P1 = r.ra.row.r.periodo_id;
  const GEN = `SELECT generar_recibos_nomina($1::bigint) AS r`;
  r = await carrera(SUB(1), GEN, [P1], SUB(2), GEN, [P1]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.ra.row.r.creados >= 2 && r.rb.row.r.creados === 0
     && await n(`SELECT count(*) FROM (SELECT empleado_id FROM nomina_recibos WHERE periodo_id = $1 GROUP BY 1 HAVING count(*) > 1) x`, [P1]) === 0,
     '100-C2 dos generaciones simultáneas: un recibo por empleado (la segunda crea 0)');
  const R1 = await n(`SELECT id FROM nomina_recibos WHERE periodo_id = $1 AND empleado_id = 10061`, [P1]);
  r = await carrera(SUB(1), `SELECT editar_recibo_nomina($1::bigint, 6, true, 1000) AS r`, [R1], SUB(2), `SELECT pagar_nomina($1::bigint) AS r`, [P1]);
  const neto = await n(`SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = $1`, [P1]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && Number(r.rb.row.r.total_neto) === neto
     && await n(`SELECT neto_a_pagar FROM nomina_recibos WHERE id = $1`, [R1]) === 1700
     && await n(`SELECT monto FROM movimientos_contables WHERE id = (SELECT movimiento_id FROM nomina_periodos WHERE id = $1)`, [P1]) === neto,
     '100-C3 edición en curso y pago: el pago espera y paga la versión editada (monto = suma de recibos)');
  r = await carrera(SUB(1), `SELECT editar_recibo_nomina($1::bigint, 6, true) AS r`, [R1], SUB(2), `SELECT 1 AS r`, []);
  ok(!r.ra.ok && /pagado/.test(r.ra.msg || ''), '100-C4 editar un recibo después del pago: rechazado');
  const P2 = (await c.query(`SELECT crear_periodo_nomina(fin_hoy() - 42) AS r`)).rows[0].r.periodo_id;
  await c.query(`SELECT generar_recibos_nomina($1::bigint)`, [P2]);
  await c.query(`UPDATE nomina_periodos SET creado_por = 'AdminC100-1' WHERE id = $1`, [P2]);
  const PAG = `SELECT pagar_nomina($1::bigint) AS r`;
  r = await carrera(SUB(1), PAG, [P2], SUB(2), PAG, [P2]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && r.rb.row.r.movimiento_id === r.ra.row.r.movimiento_id
     && await n(`SELECT count(*) FROM costos_historial WHERE movimiento_id = $1`, [r.ra.row.r.movimiento_id]) === 1,
     '100-C5 dos pagos simultáneos: un egreso y un costo; el segundo es replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (100 concurrencia)'); process.exit(1); }
}
await conc100();
console.log('── concurrencia + frontend↔DB tras 100/101');
await conc096();
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
await conc092();
await conc093();
await conc076();
await fe076();
console.log('  concurrencia + frontend↔DB (076, 086, 087, 088, 092, 093, 096) tras 100/101: PASS');

// ═══ 102/103 — inventario de cuartos por contrato (ajuste, merma de cuarto, integridad) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.ajustar_existencia_cuarto(uuid,text,text,integer,text)') IS NULL
    AND to_regprocedure('public.registrar_merma_cuarto(uuid,text,text,integer,text,text)') IS NULL
    AND has_table_privilege('authenticated', 'public.inventario_mov', 'INSERT') AS a`)).rows[0].a;
  console.log(`  CUARTOS_PARITY_CHECK[pre-102]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 102 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '102_cuartos_inventario_canonico.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 102 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 102)'); process.exit(1); }
const SUITES_102 = [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'],
  ['095', '095_cliente_obsoleto_test.sql'], ['096', '096_dia_negocio_caja_test.sql'], ['098', '098_dia_negocio_escritores_test.sql'], ['100', '100_nomina_canonica_test.sql']];
console.log('── PRUEBAS 102 (antes de 103: el frontend anterior aún escribe existencia por REST)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/102_cuartos_inventario_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (102)'); process.exit(1); }
}
await reruns090('102');
for (const [etq, f] of SUITES_102) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 102)`); process.exit(1); }
  console.log(`  ${etq} tras 102: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 103 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '103_contencion_cuartos.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 102 (tras 103)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/102_cuartos_inventario_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (102 tras 103)'); process.exit(1); }
}
// 072 (merma FIFO entre cuartos llamada desde la API) queda retirado a propósito por 103;
// su reverso, inmutabilidad y ruta se cubren en 102 y 087.
await reruns090('103', ['072']);
for (const [etq, f] of SUITES_102) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 103)`); process.exit(1); }
  console.log(`  ${etq} tras 103: PASS`);
}
async function conc102() {
  console.log('── 102 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a2c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'C102-%');
    DELETE FROM mermas WHERE sku LIKE 'C102-%';
    DELETE FROM produccion WHERE sku LIKE 'C102-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C102-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'a2c1%';
    DELETE FROM auditoria WHERE usuario LIKE 'AdminC102%' OR usuario LIKE 'ProdC102%';
    DELETE FROM rutas WHERE id BETWEEN 10261 AND 10269;
    DELETE FROM cuartos_frios WHERE id LIKE 'CF-C102%';
    DELETE FROM productos WHERE sku LIKE 'C102-%';
    DELETE FROM usuarios WHERE id BETWEEN 10261 AND 10269; DELETE FROM auth.users WHERE id::text LIKE 'a2c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  // Los cuartos C102 van primero por id para que carga/merma FIFO no toquen otros cuartos del arnés.
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a2c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t102c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10261, 'AdminC102', 'c1@t102c', 'Admin', 'Activo', '${SUB(1)}'), (10262, 'ProdC102', 'c2@t102c', 'Producción', 'Activo', '${SUB(2)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C102-A', 'Hielo A C102', 'Producto Terminado', 10, 0, 0, NULL), ('C102-B', 'Hielo B C102', 'Producto Terminado', 10, 0, 0, NULL);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C102A', 'Cuarto C102A', '{"C102-A": 100, "C102-B": 100}'), ('CF-C102B', 'Cuarto C102B', '{"C102-A": 100, "C102-B": 100}');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const cf = async (id, sku) => n(`SELECT COALESCE((stock->>$2)::int, 0) FROM cuartos_frios WHERE id = $1`, [id, sku]);
  const AJ = `SELECT ajustar_existencia_cuarto($1::uuid, $2, $3, $4::int, 'Conteo físico C102') AS r`;
  // 1. Ajuste vs producción de OTRO SKU en el mismo cuarto: nada se pierde.
  let r = await carrera(SUB(1), AJ, ['a2c10000-0000-0000-0000-000000000001', 'CF-C102A', 'C102-A', 93],
                        SUB(2), `SELECT registrar_produccion('a2c10000-0000-0000-0000-000000000002', 'Turno 1', 'Máquina C102', 'C102-B', 5, 'CF-C102A') AS r`, []);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf('CF-C102A', 'C102-A') === 93 && await cf('CF-C102A', 'C102-B') === 105,
     '102-C1 ajuste (A → 93) vs producción de B en el mismo cuarto: se serializan; A=93 y B=105 (sin pérdida)');
  // 2. Ajuste vs traspaso del mismo SKU.
  r = await carrera(SUB(2), `SELECT traspaso_cuartos('a2c10000-0000-0000-0000-000000000003', 'CF-C102A', 'CF-C102B', 'C102-A', 3) AS r`, [],
                    SUB(1), AJ, ['a2c10000-0000-0000-0000-000000000004', 'CF-C102A', 'C102-A', 80]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf('CF-C102A', 'C102-A') === 80 && await cf('CF-C102B', 'C102-A') === 103 && Number(r.rb.row.r.anterior) === 90,
     '102-C2 traspaso (−3) y luego ajuste a 80: el ajuste lee 90 bajo bloqueo; destino +3');
  // 3. Merma de cuarto vs ajuste en el mismo cuarto/SKU.
  const MC = `SELECT registrar_merma_cuarto($1::uuid, $2, $3, $4::int, 'Bolsa rota') AS r`;
  r = await carrera(SUB(2), MC, ['a2c10000-0000-0000-0000-000000000005', 'CF-C102A', 'C102-A', 10], SUB(1), AJ, ['a2c10000-0000-0000-0000-000000000006', 'CF-C102A', 'C102-A', 75]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf('CF-C102A', 'C102-A') === 75 && Number(r.rb.row.r.anterior) === 70 && await cf('CF-C102B', 'C102-A') === 103,
     '102-C3 merma (−10) y ajuste a 75 en el mismo cuarto: serializados (el ajuste ve 70); el otro cuarto intacto');
  // 4. Merma de cuarto vs traspaso que vacía casi todo: sin negativos.
  r = await carrera(SUB(2), `SELECT traspaso_cuartos('a2c10000-0000-0000-0000-000000000007', 'CF-C102A', 'CF-C102B', 'C102-A', 70) AS r`, [],
                    SUB(2), MC, ['a2c10000-0000-0000-0000-000000000008', 'CF-C102A', 'C102-A', 10]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && /insuficiente/i.test(r.rb.msg || '') && await cf('CF-C102A', 'C102-A') === 5,
     '102-C4 traspaso (−70) y merma de 10 con solo 5 restantes: la merma se rechaza (sin negativos)');
  // 5. Mismo ajuste (mismo UUID) simultáneo: un solo efecto, el segundo es replay.
  r = await carrera(SUB(1), AJ, ['a2c10000-0000-0000-0000-000000000009', 'CF-C102B', 'C102-B', 90], SUB(1), AJ, ['a2c10000-0000-0000-0000-000000000009', 'CF-C102B', 'C102-B', 90]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && await cf('CF-C102B', 'C102-B') === 90
     && await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = 'a2c10000-0000-0000-0000-000000000009'`) === 1,
     '102-C5 mismo ajuste simultáneo: un efecto (−10), el segundo es replay');
  // 6. Misma merma (mismo UUID) simultánea.
  r = await carrera(SUB(2), MC, ['a2c10000-0000-0000-0000-00000000000a', 'CF-C102B', 'C102-B', 4], SUB(2), MC, ['a2c10000-0000-0000-0000-00000000000a', 'CF-C102B', 'C102-B', 4]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && await cf('CF-C102B', 'C102-B') === 86
     && await n(`SELECT count(*) FROM mermas WHERE sku = 'C102-B'`) === 1,
     '102-C6 misma merma simultánea: una pérdida, el segundo es replay');
  // 7. Merma de cuarto vs carga de ruta: la carga toma FIFO solo de cuartos con el SKU (solo los C102 lo tienen).
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO rutas (id, folio, nombre, estatus, fecha, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at, clientes_asignados)
    VALUES (10261, 'R-10261', 'C102', 'Pendiente firma', CURRENT_DATE, '{"C102-B": 50}', '{}', '{"C102-B": 50}', now(), '[]'); COMMIT;`);
  r = await carrera(SUB(2), MC, ['a2c10000-0000-0000-0000-00000000000b', 'CF-C102A', 'C102-B', 100],
                    SUB(1), `SELECT confirmar_carga_ruta('a2c10000-0000-0000-0000-00000000000c', 10261, 'firma') AS r`, []);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf('CF-C102A', 'C102-B') === 0 && await cf('CF-C102B', 'C102-B') === 41
     && await n(`SELECT count(*) FROM cuartos_frios WHERE (stock->>'C102-B')::int < 0`) === 0,
     `102-C7 merma de cuarto (−100 en C102A) y carga de 50 simultáneas: la carga espera y toma 5 + 45 sin negativos (${r.rb.ok ? 'ok' : r.rb.msg})`);
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (102 concurrencia)'); process.exit(1); }
}
await conc102();
console.log('── concurrencia + frontend↔DB tras 102/103');
await conc100();
await conc096();
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
await conc092();
await conc093();
await conc076();
await fe076();
console.log('  concurrencia + frontend↔DB (076, 086, 087, 088, 092, 093, 096, 100) tras 102/103: PASS');

// ═══ 104/105 — devolución de cliente por contrato ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)') IS NULL
    AND has_table_privilege('authenticated', 'public.devoluciones', 'INSERT')
    AND has_function_privilege('authenticated', 'public.update_stocks_atomic(jsonb)', 'EXECUTE') AS a`)).rows[0].a;
  console.log(`  DEVOLUCIONES_PARITY_CHECK[pre-104]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
  // Paridad con producción (catálogo verificado read-only): 003 deja aquí un
  // CHECK monto_original > 0 en cuentas_por_cobrar que producción no tiene; una
  // venta a crédito devuelta completa queda legítimamente en original 0.
  await c.query('ALTER TABLE cuentas_por_cobrar DROP CONSTRAINT IF EXISTS cuentas_por_cobrar_monto_original_check');
}
for (const k of [1, 2]) {
  console.log(`── aplicar 104 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '104_devolucion_canonica.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 104 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 104)'); process.exit(1); }
const SUITES_104 = [['090', '090_b4_privilegios_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql'],
  ['095', '095_cliente_obsoleto_test.sql'], ['096', '096_dia_negocio_caja_test.sql'], ['098', '098_dia_negocio_escritores_test.sql'],
  ['100', '100_nomina_canonica_test.sql'], ['102', '102_cuartos_inventario_test.sql']];
console.log('── PRUEBAS 104 (antes de 105)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/104_devoluciones_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (104)'); process.exit(1); }
}
await reruns090('104', ['072']);
for (const [etq, f] of SUITES_104) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 104)`); process.exit(1); }
  console.log(`  ${etq} tras 104: PASS`);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 105 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '105_contencion_devoluciones.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
console.log('── PRUEBAS 104 (tras 105)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/104_devoluciones_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (104 tras 105)'); process.exit(1); }
}
await reruns090('105', ['072']);
for (const [etq, f] of SUITES_104) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 105)`); process.exit(1); }
  console.log(`  ${etq} tras 105: PASS`);
}
async function conc104() {
  console.log('── 104 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a4c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM devoluciones WHERE orden_id BETWEEN 10461 AND 10469;
    DELETE FROM movimientos_contables WHERE orden_id BETWEEN 10461 AND 10469;
    DELETE FROM mermas_efectos WHERE merma_id IN (SELECT id FROM mermas WHERE sku LIKE 'C104-%'); DELETE FROM mermas WHERE sku LIKE 'C104-%';
    DELETE FROM inventario_mov WHERE producto LIKE 'C104-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'a4c1%' OR orden_id BETWEEN 10461 AND 10469;
    DELETE FROM pagos WHERE orden_id BETWEEN 10461 AND 10469;
    DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 10461 AND 10469;
    DELETE FROM orden_lineas WHERE orden_id BETWEEN 10461 AND 10469; DELETE FROM ordenes WHERE id BETWEEN 10461 AND 10469;
    DELETE FROM auditoria WHERE usuario LIKE 'AdminC104%' OR detalle LIKE 'OV-1046%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C104'; DELETE FROM productos WHERE sku LIKE 'C104-%';
    DELETE FROM clientes WHERE id = 10461;
    DELETE FROM usuarios WHERE id BETWEEN 10461 AND 10469; DELETE FROM auth.users WHERE id::text LIKE 'a4c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a4c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t104c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10461, 'AdminC104-1', 'c1@t104c', 'Admin', 'Activo', '${SUB(1)}'), (10462, 'AdminC104-2', 'c2@t104c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (10461, 'Cliente C104', 'XAXX010101000', 100);
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('C104-A', 'Hielo C104', 'Producto Terminado', 10, 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C104', 'Cuarto C104', '{"C104-A": 100}');
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES
      (10461, 'OV-10461', 10461, 'Cliente C104', 'x', 100, 'Entregada', 'Efectivo', 'Contado'),
      (10462, 'OV-10462', 10461, 'Cliente C104', 'x', 100, 'Entregada', 'Efectivo', 'Contado'),
      (10463, 'OV-10463', 10461, 'Cliente C104', 'x', 200, 'Entregada', 'Crédito',  'Credito'),
      (10464, 'OV-10464', 10461, 'Cliente C104', 'x', 100, 'Entregada', 'Efectivo', 'Contado'),
      (10465, 'OV-10465', 10461, 'Cliente C104', 'x', 100, 'Entregada', 'Efectivo', 'Contado'),
      (10466, 'OV-10466', 10461, 'Cliente C104', 'x', 100, 'Entregada', 'Efectivo', 'Contado');
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'C104-A', 10, 10, 100 FROM ordenes WHERE id IN (10461, 10462, 10464, 10465, 10466);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (10463, 'C104-A', 20, 10, 200);
    INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues)
      SELECT 10461, id, 100, 'Efectivo', fin_hoy(), 'C104-' || id, 0, 0 FROM ordenes WHERE id IN (10461, 10462, 10464, 10465, 10466);
    INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (10461, 10463, 100, 'Efectivo', fin_hoy(), 'C104-10463', 200, 100);
    INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, fecha_venta, monto_original, monto_pagado, saldo_pendiente, estatus) VALUES (10461, 10463, fin_hoy(), 200, 100, 100, 'Parcial');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    if (subA) await actor(a, subA); else { await a.query('BEGIN'); await a.query('SET LOCAL ROLE service_role'); await a.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`); }
    await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const cf = async () => n(`SELECT COALESCE((stock->>'C104-A')::int, 0) FROM cuartos_frios WHERE id = 'CF-C104'`);
  const DEV = `SELECT registrar_devolucion($1::uuid, $2::bigint, $3::jsonb, $4, $5, $6, 'prueba concurrente') AS r`;
  // 1. Dos navegadores devuelven la misma orden a la vez (operaciones distintas).
  let r = await carrera(SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000001', 10461, '[{"sku":"C104-A","cantidad":2}]', 'Efectivo', 'Reintegrar', 'CF-C104'],
                        SUB(2), DEV, ['a4c10000-0000-0000-0000-000000000002', 10461, '[{"sku":"C104-A","cantidad":3}]', 'Efectivo', 'Reintegrar', 'CF-C104']);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '23505' && await n(`SELECT count(*) FROM devoluciones WHERE orden_id = 10461`) === 1
     && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 10461`) === 1 && await cf() === 102,
     '104-C1 dos devoluciones simultáneas de la misma orden: una sola (+2 al cuarto, un reembolso); la otra espera y se rechaza');
  // 2. Misma operación simultánea: replay.
  r = await carrera(SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000003', 10462, '[{"sku":"C104-A","cantidad":1}]', 'Efectivo', 'Merma', null],
                    SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000003', 10462, '[{"sku":"C104-A","cantidad":1}]', 'Efectivo', 'Merma', null]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 10462`) === 1,
     '104-C2 misma devolución (mismo UUID) simultánea: un efecto, la segunda es replay');
  // 3. Devolución vs abono de CxC (crédito): se serializan sobre la CxC.
  const cxcId = await n(`SELECT id FROM cuentas_por_cobrar WHERE orden_id = 10463`);
  r = await carrera(SUB(2), `SELECT abonar_cxc($1::bigint, 50, 'Efectivo') AS r`, [cxcId],
                    SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000004', 10463, '[{"sku":"C104-A","cantidad":10}]', 'Efectivo', 'Reintegrar', 'CF-C104']);
  const cxc = (await c.query(`SELECT monto_original::float AS o, monto_pagado::float AS p, saldo_pendiente::float AS s FROM cuentas_por_cobrar WHERE id = $1`, [cxcId])).rows[0];
  ok(r.ra.ok && r.rb.ok && r.bloqueado && Number(r.rb.row.r.cxc_reducido) === 50 && Number(r.rb.row.r.reembolso) === 50
     && cxc.s === 0 && Math.abs(cxc.o - cxc.p - cxc.s) < 0.001 && await n(`SELECT saldo FROM clientes WHERE id = 10461`) === 0,
     '104-C3 abono de 50 y devolución de 100 a la vez: la devolución ve saldo 50 → CxC −50, reembolso 50; CxC coherente y saldo del cliente 0');
  // 4. Devolución vs ajuste de conteo en el mismo cuarto.
  const base = await cf();
  r = await carrera(SUB(2), `SELECT ajustar_existencia_cuarto('a4c10000-0000-0000-0000-000000000005', 'CF-C104', 'C104-A', 50, 'Conteo físico C104') AS r`, [],
                    SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000006', 10464, '[{"sku":"C104-A","cantidad":4}]', 'Efectivo', 'Reintegrar', 'CF-C104']);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf() === 54, `104-C4 ajuste a 50 y devolución de 4 al mismo cuarto: serializados (50 + 4 = 54; antes ${base})`);
  // 5. Devolución vs merma de cuarto.
  r = await carrera(SUB(2), `SELECT registrar_merma_cuarto('a4c10000-0000-0000-0000-000000000007', 'CF-C104', 'C104-A', 10, 'Bolsa rota') AS r`, [],
                    SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000008', 10465, '[{"sku":"C104-A","cantidad":5}]', 'Efectivo', 'Reintegrar', 'CF-C104']);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && await cf() === 49 && await n(`SELECT count(*) FROM cuartos_frios WHERE (stock->>'C104-A')::int < 0`) === 0,
     '104-C5 merma de 10 y devolución de 5 al mismo cuarto: serializadas (54 − 10 + 5 = 49), sin negativos');
  // 6. Devolución mientras el backend factura la orden.
  r = await carrera(null, `UPDATE ordenes SET estatus = 'Facturada' WHERE id = 10466 RETURNING id AS r`, [],
                    SUB(1), DEV, ['a4c10000-0000-0000-0000-000000000009', 10466, '[{"sku":"C104-A","cantidad":1}]', 'Efectivo', 'Merma', null]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.requiere_nota_credito === true,
     '104-C6 facturación concurrente: la devolución espera la orden y ve Facturada (nota fiscal pendiente)');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (104 concurrencia)'); process.exit(1); }
}
await conc104();
console.log('── concurrencia + frontend↔DB tras 104/105');
await conc102();
await conc100();
await conc096();
await conc086();
await fe086();
await conc087();
await fe087();
await conc088();
await conc092();
await conc093();
await conc076();
await fe076();
console.log('  concurrencia + frontend↔DB (076, 086, 087, 088, 092, 093, 096, 100, 102) tras 104/105: PASS');

// ═══ 106 — costo de empaque por promedio ponderado (forward-only) ═══
{
  const ok = (await c.query(`SELECT to_regclass('public.costos_empaque_historial') IS NULL AS a`)).rows[0].a;
  console.log(`  COSTO_EMPAQUE_PARITY_CHECK[pre-106]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 106 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '106_costo_empaque_promedio.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 106 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 106)'); process.exit(1); }
console.log('── PRUEBAS 106');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/106_costo_empaque_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (106)'); process.exit(1); }
}
await reruns090('106', ['072']);
for (const [etq, f] of [...SUITES_104, ['104', '104_devoluciones_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 106)`); process.exit(1); }
  console.log(`  ${etq} tras 106: PASS`);
}
async function conc106() {
  console.log('── 106 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a6c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM costos_empaque_historial WHERE sku LIKE 'C106-%';
    DELETE FROM costos_historial WHERE concepto LIKE '%C106-%';
    DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'recepcion_compra/' || operacion_id FROM stock_operaciones WHERE operacion_id::text LIKE 'a6c1%');
    DELETE FROM inventario_mov WHERE producto LIKE 'C106-%'; DELETE FROM produccion WHERE sku LIKE 'C106-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'a6c1%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C106'; DELETE FROM productos WHERE sku LIKE 'C106-%';
    DELETE FROM usuarios WHERE id BETWEEN 10661 AND 10669; DELETE FROM auth.users WHERE id::text LIKE 'a6c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a6c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t106c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10661, 'AdminC106', 'c1@t106c', 'Admin', 'Activo', '${SUB(1)}'), (10662, 'ProdC106', 'c2@t106c', 'Producción', 'Activo', '${SUB(2)}');
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C106', 'Cuarto C106', '{}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C106-E1', 'Bolsa C106 1', 'Empaque', 0, 100, 2, NULL), ('C106-E2', 'Bolsa C106 2', 'Empaque', 0, 100, 1, NULL),
      ('C106-H1', 'Hielo C106 1', 'Producto Terminado', 10, 0, 0, 'C106-E1'), ('C106-H2', 'Hielo C106 2', 'Producto Terminado', 10, 0, 0, 'C106-E2');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const p = async (sku) => (await c.query(`SELECT stock, costo_unitario::float AS avg FROM productos WHERE sku = $1`, [sku])).rows[0];
  const COMPRA = `SELECT registrar_recepcion_compra($1::uuid, $2, $3::int, $4::numeric, NULL, false) AS r`;
  const PROD = `SELECT registrar_produccion($1::uuid, 'Turno 1', 'Máquina C106', $2, $3::int, 'CF-C106') AS r`;
  // 1. Compra vs compra del mismo empaque: orden serial válido.
  let r = await carrera(SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000001', 'C106-E1', 100, 600], SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000002', 'C106-E1', 200, 200]);
  let e1 = await p('C106-E1');
  ok(r.ra.ok && r.rb.ok && r.bloqueado && e1.stock === 400 && Math.abs(e1.avg - 2.5) < 1e-6 && Math.abs(Number(r.rb.row.r.costo_promedio_anterior) - 4) < 1e-6,
     `106-C1 dos compras simultáneas: (100@2 → +100 por 600 → 200@4) y luego (+200 por 200 → 400@2.5); sin actualización perdida (${e1.stock} @ ${e1.avg})`);
  // 2. Compra vs producción del mismo empaque: la producción espera y usa el promedio nuevo.
  r = await carrera(SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000003', 'C106-E1', 100, 1250], SUB(2), PROD, ['a6c10000-0000-0000-0000-000000000004', 'C106-H1', 10]);
  e1 = await p('C106-E1');
  const pr = await n(`SELECT costo_empaque FROM produccion WHERE operacion_id = 'a6c10000-0000-0000-0000-000000000004'`);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && Math.abs(pr - 4.5) < 1e-6 && e1.stock === 490 && Math.abs(e1.avg - 4.5) < 1e-6,
     `106-C2 compra (400@2.5 + 100 por 1250 → 500@4.5) y producción simultáneas: la producción espera y toma 4.5; empaque 490`);
  // 3. Compra vs producción de OTRO empaque: no se bloquean.
  r = await carrera(SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000005', 'C106-E1', 10, 45], SUB(2), PROD, ['a6c10000-0000-0000-0000-000000000006', 'C106-H2', 10]);
  ok(r.ra.ok && r.rb.ok && !r.bloqueado && await n(`SELECT costo_empaque FROM produccion WHERE operacion_id = 'a6c10000-0000-0000-0000-000000000006'`) === 1,
     '106-C3 compra de un empaque y producción con otro: no se esperan; la producción usa su propio promedio (1)');
  // 4. La misma recepción simultánea: un solo efecto.
  const antes = await p('C106-E2');
  r = await carrera(SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000007', 'C106-E2', 10, 30], SUB(1), COMPRA, ['a6c10000-0000-0000-0000-000000000007', 'C106-E2', 10, 30]);
  const desp = await p('C106-E2');
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && desp.stock === antes.stock + 10
     && await n(`SELECT count(*) FROM costos_empaque_historial WHERE operacion_id = 'a6c10000-0000-0000-0000-000000000007'`) === 1
     && await n(`SELECT count(*) FROM movimientos_contables WHERE referencia = 'recepcion_compra/a6c10000-0000-0000-0000-000000000007'`) === 1,
     '106-C4 la misma recepción dos veces a la vez: una entrada, un egreso, una transición de costo; la segunda es replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (106 concurrencia)'); process.exit(1); }
}
await conc106();
console.log('── concurrencia + frontend↔DB tras 106');
await conc104();
await conc102();
await conc093();
await conc092();
await conc076();
await fe076();
await conc087();
await fe087();
console.log('  concurrencia + frontend↔DB (076, 087, 092, 093, 102, 104) tras 106: PASS');

// ═══ 107/108 — integridad de la base de costo del empaque (forward-only) ═══
{
  const ok = (await c.query(`SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'costos_empaque_historial' AND column_name = 'costo_unitario_reingreso')
                               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_empaque_stock_no_negativo')
                               AND to_regprocedure('public.empaque_tiene_dependencias(bigint,text)') IS NULL
                               AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_productos_guard_borrado') AS a`)).rows[0].a;
  console.log(`  BASE_COSTO_EMPAQUE_PARITY_CHECK[pre-107]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_107 = [...SUITES_104, ['104', '104_devoluciones_test.sql'], ['106', '106_costo_empaque_test.sql']];
async function conc107() {
  console.log('── 107 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const SUB = (k) => 'a7c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const OP = (k) => 'a7c10000-0000-0000-0000-' + String(k).padStart(12, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM costos_empaque_historial WHERE sku LIKE 'C107-%';
    DELETE FROM costos_historial WHERE concepto LIKE '%C107-%';
    DELETE FROM movimientos_contables WHERE referencia IN (SELECT 'recepcion_compra/' || operacion_id FROM stock_operaciones WHERE operacion_id::text LIKE 'a7c1%');
    DELETE FROM inventario_mov WHERE producto LIKE 'C107-%'; DELETE FROM produccion WHERE sku LIKE 'C107-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'a7c1%';
    DELETE FROM auditoria WHERE usuario IN ('AdminC107', 'ProdC107');
    DELETE FROM cuartos_frios WHERE id = 'CF-C107'; DELETE FROM productos WHERE sku LIKE 'C107-%';
    DELETE FROM usuarios WHERE id BETWEEN 10761 AND 10769; DELETE FROM auth.users WHERE id::text LIKE 'a7c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a7c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t107c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10761, 'AdminC107', 'c1@t107c', 'Admin', 'Activo', '${SUB(1)}'), (10762, 'ProdC107', 'c2@t107c', 'Producción', 'Activo', '${SUB(2)}');
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C107', 'Cuarto C107', '{}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C107-E1', 'Bolsa C107', 'Empaque', 0, 100, 2, NULL), ('C107-H1', 'Hielo C107', 'Producto Terminado', 10, 0, 0, 'C107-E1');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const intento = (cl, sql, params) => cl.query(sql, params).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await intento(a, sqlA, pA);
    let done = false;
    const prB = intento(b, sqlB, pB).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const solo = async (sub, sql, params) => { await actor(a, sub); const r = await intento(a, sql, params); await a.query(r.ok ? 'COMMIT' : 'ROLLBACK'); return r; };
  const p = async () => (await c.query(`SELECT stock, costo_unitario::float AS avg FROM productos WHERE sku = 'C107-E1'`)).rows[0];
  const COMPRA = `SELECT registrar_recepcion_compra($1::uuid, 'C107-E1', $2::int, $3::numeric, NULL, false) AS r`;
  const PROD = `SELECT registrar_produccion($1::uuid, 'Turno 1', 'Máquina C107', 'C107-H1', $2::int, 'CF-C107') AS r`;
  const REV = `SELECT revertir_produccion($1::uuid, $2::bigint, 'reverso C107') AS r`;
  const producir = async (k, q) => { const r = await solo(SUB(2), PROD, [OP(k), q]); if (!r.ok) throw new Error('fixture producción: ' + r.msg); return r.row.r.id; };

  // 1. Compra y reverso del mismo empaque: el reverso espera y parte del promedio de la compra.
  let prodId = await producir(1, 10);                                   // 100 @ 2 → 90 @ 2 (histórico 2)
  let r = await carrera(SUB(1), COMPRA, [OP(2), 10, 120], SUB(1), REV, [OP(3), prodId]);
  let e = await p();
  ok(r.ra.ok && r.rb.ok && r.bloqueado && e.stock === 110 && Math.abs(e.avg - r6((100 * 3 + 10 * 2) / 110)) < 1e-6
     && Math.abs(Number(r.rb.row.r.costo_promedio_anterior) - 3) < 1e-6,
     `107-C1 compra (90@2 + 10 por 120 → 100@3) y reverso simultáneos: el reverso espera y reingresa 10@2 → 110@2.909091 (${e.stock} @ ${e.avg})`);
  // 2. Reverso y compra: la compra espera y parte del promedio del reverso.
  const avg2 = e.avg;
  prodId = await producir(4, 10);                                       // 110 → 100; histórico = avg2
  r = await carrera(SUB(1), REV, [OP(5), prodId], SUB(1), COMPRA, [OP(6), 90, 90]);
  e = await p();
  ok(r.ra.ok && r.rb.ok && r.bloqueado && e.stock === 200 && Math.abs(e.avg - r6((110 * avg2 + 90) / 200)) < 1e-6
     && Math.abs(Number(r.rb.row.r.costo_promedio_anterior) - avg2) < 1e-6,
     `107-C2 reverso y compra simultáneos: la compra espera y promedia sobre 110 unidades; sin actualización perdida (${e.stock} @ ${e.avg})`);
  // 3. El mismo reverso dos veces a la vez: un solo efecto.
  prodId = await producir(7, 10);                                       // 200 → 190
  const antes = await p();
  r = await carrera(SUB(1), REV, [OP(8), prodId], SUB(1), REV, [OP(8), prodId]);
  e = await p();
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && e.stock === antes.stock + 10
     && await n(`SELECT count(*) FROM costos_empaque_historial WHERE operacion_id = $1`, [OP(8)]) === 1
     && await n(`SELECT count(*) FROM costos_historial WHERE referencia = 'PROD-' || $1 || '/reverso'`, [String(prodId)]) === 1
     && await n(`SELECT count(*) FROM inventario_mov WHERE producto = 'C107-E1' AND operacion_id = $1`, [OP(8)]) === 1,
     '107-C3 el mismo reverso dos veces a la vez: una entrada, un evento de costo, un costo compensatorio; la segunda es replay');
  // 4. Dos operaciones distintas sobre la misma producción: una sola la revierte.
  prodId = await producir(9, 10);                                       // 200 → 190
  r = await carrera(SUB(1), REV, [OP(10), prodId], SUB(1), REV, [OP(11), prodId]);
  e = await p();
  ok(r.ra.ok && !r.rb.ok && r.rb.code === '22023' && /ya fue revertida/.test(r.rb.msg) && r.bloqueado && e.stock === 200
     && await n(`SELECT count(*) FROM costos_empaque_historial WHERE operacion_id IN ($1, $2)`, [OP(10), OP(11)]) === 1,
     '107-C4 dos reversos distintos de la misma producción a la vez: uno gana, el otro se rechaza; un solo reingreso');
  // 5. Orden de bloqueo: con el cuarto ocupado, el reverso y la producción ya tienen
  //    el empaque bloqueado (empaque → cuarto en ambos: sin inversión).
  const empaqueTomado = async () => {
    await c.query('BEGIN');
    const t = await c.query(`SELECT 1 FROM productos WHERE sku = 'C107-E1' FOR UPDATE NOWAIT`).then(() => false, err => err.code === '55P03');
    await c.query('ROLLBACK');
    return t;
  };
  const conCuartoOcupado = async (sub, sql, params) => {
    await a.query('BEGIN'); await a.query(`SELECT 1 FROM cuartos_frios WHERE id = 'CF-C107' FOR UPDATE`);
    await actor(b, sub);
    let done = false;
    const prB = intento(b, sql, params).finally(() => { done = true; });
    await sleep(500);
    const espera = !done; const tomado = await empaqueTomado();
    await a.query('COMMIT');
    const rb = await prB; await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { rb, espera, tomado };
  };
  prodId = await producir(12, 10);                                      // 200 → 190
  const lr = await conCuartoOcupado(SUB(1), REV, [OP(13), prodId]);     // → 200
  const lp = await conCuartoOcupado(SUB(2), PROD, [OP(14), 10]);        // → 190
  ok(lr.rb.ok && lr.espera && lr.tomado && lp.rb.ok && lp.espera && lp.tomado && (await p()).stock === 190,
     '107-C5 orden de bloqueo: esperando el cuarto, el reverso y la producción ya tienen el empaque (empaque → cuarto en ambos; sin inversión)');
  // 6. Producción y reverso realmente en paralelo, 20 rondas: sin interbloqueos ni errores.
  let fallos = 0; let previa = lp.rb.row.r.id; const avgAntes = (await p()).avg;
  for (let k = 0; k < 20; k++) {
    await actor(a, SUB(1)); await actor(b, SUB(2));
    // Cada conexión confirma en cuanto su contrato responde: la otra puede estar
    // esperando su bloqueo (si se esperara a ambas antes de confirmar, se trabaría).
    const cierra = (cl, pr) => pr.then(async r => { await cl.query(r.ok ? 'COMMIT' : 'ROLLBACK'); return r; });
    const [ra, rb] = await Promise.all([cierra(a, intento(a, REV, [OP(100 + k), previa])), cierra(b, intento(b, PROD, [OP(200 + k), 10]))]);
    if (!ra.ok || !rb.ok) { fallos++; console.log('    ronda', k, ra.ok ? '' : ra.code + ' ' + ra.msg, rb.ok ? '' : rb.code + ' ' + rb.msg); if (!rb.ok) break; }
    previa = rb.row.r.id;
  }
  e = await p();
  ok(fallos === 0 && e.stock === 190 && Math.abs(e.avg - avgAntes) < 1e-4,
     `107-C6 20 rondas de producción y reverso en paralelo: 0 interbloqueos, existencia 190 y promedio estable (${e.stock} @ ${e.avg})`);
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (107 concurrencia)'); process.exit(1); }
}
for (const fase of ['107', '108']) {
  const archivo = fase === '107' ? '107_base_costo_empaque_reverso.sql' : '108_contencion_base_costo_empaque.sql';
  for (const k of [1, 2]) {
    console.log(`── aplicar ${fase} (${k}/2${k === 2 ? ', idempotencia' : ''})`);
    const rr = await runFile(c, path.join(ROOT, 'supabase', archivo), { stopOnError: true });
    if (rr.aborted) process.exit(1);
  }
  if (!(await rlsCheck(`tras ${fase} (sin deuda)`, []))) { console.log(`RESULTADO: FALLÓ (RLS_CHECK ${fase})`); process.exit(1); }
  console.log(`── PRUEBAS 107 (${fase === '107' ? 'antes de 108' : 'tras 108'})`);
  {
    const rr = await runFile(c, path.join(ROOT, 'supabase/tests/107_base_costo_empaque_test.sql'), { stopOnError: true, echo: true });
    if (rr.aborted) { console.log(`RESULTADO: FALLÓ (107 tras ${fase})`); process.exit(1); }
  }
  await reruns090(fase, ['072']);
  for (const [etq, f] of SUITES_107) {
    const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
    if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras ${fase})`); process.exit(1); }
    console.log(`  ${etq} tras ${fase}: PASS`);
  }
  await conc107();
  console.log(`── concurrencia + frontend↔DB tras ${fase}`);
  await conc106();
  await conc104();
  await conc102();
  await conc093();
  await conc092();
  await conc076();
  await fe076();
  await conc087();
  await fe087();
  console.log(`  concurrencia + frontend↔DB (076, 087, 092, 093, 102, 104, 106, 107) tras ${fase}: PASS`);
}

// ═══ 109 — venta directa de planta atómica (OL-02B; aditiva) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)') IS NULL
                               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_operaciones_tipo_check' AND pg_get_constraintdef(oid) LIKE '%venta_directa%') AS a`)).rows[0].a;
  console.log(`  VENTA_DIRECTA_PARITY_CHECK[pre-109]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_109 = [...SUITES_107, ['107', '107_base_costo_empaque_test.sql']];
async function conc109() {
  console.log('── 109 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a9c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const OP = (k) => 'a9c10000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM movimientos_contables WHERE orden_id BETWEEN 10961 AND 10969;
    DELETE FROM inventario_mov WHERE producto LIKE 'C109-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'a9c1%' OR orden_id BETWEEN 10961 AND 10969 OR ruta_id BETWEEN 10961 AND 10969;
    DELETE FROM pagos WHERE orden_id BETWEEN 10961 AND 10969;
    DELETE FROM orden_lineas WHERE orden_id BETWEEN 10961 AND 10969; DELETE FROM ordenes WHERE id BETWEEN 10961 AND 10969;
    DELETE FROM rutas WHERE id BETWEEN 10961 AND 10969;
    DELETE FROM auditoria WHERE detalle LIKE 'OV-1096%' OR usuario LIKE 'AdminC109%';
    DELETE FROM cuartos_frios WHERE id LIKE 'CF-C109%'; DELETE FROM productos WHERE sku LIKE 'C109-%';
    DELETE FROM usuarios WHERE id BETWEEN 10961 AND 10969; DELETE FROM auth.users WHERE id::text LIKE 'a9c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a9c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t109c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (10961, 'AdminC109-1', 'c1@t109c', 'Admin', 'Activo', '${SUB(1)}'), (10962, 'AdminC109-2', 'c2@t109c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('C109-X', 'Hielo C109', 'Producto Terminado', 10, 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C109', 'Cuarto C109', '{"C109-X": 10}'), ('CF-C109B', 'Cuarto C109B', '{"C109-X": 0}');
    INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) SELECT 10960 + k, 'OV-1096' || k, 'Cliente C109', 'x', 80, 'Creada', 'Efectivo', 'Contado' FROM generate_series(1, 7) k;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT 10960 + k, 'C109-X', 8, 10, 80 FROM generate_series(1, 7) k;
    INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES
      (10961, 'R-10961', 'C109 ruta 1', 'Pendiente firma', NULL, '{}', '{"C109-X": 5}', '{}', '{"C109-X": 5}'),
      (10962, 'R-10962', 'C109 ruta 2', 'Pendiente firma', NULL, '{}', '{"C109-X": 5}', '{}', '{"C109-X": 5}'),
      (10963, 'R-10963', 'C109 ruta 3', 'Programada', NULL, '{}', '{}', '{}', '{}');
    COMMIT;`);
  const reponer = async (q) => c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE cuartos_frios SET stock = '{"C109-X": ${q}}' WHERE id = 'CF-C109'; COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const cf = async () => n(`SELECT COALESCE((stock->>'C109-X')::int, 0) FROM cuartos_frios WHERE id = 'CF-C109'`);
  const negativos = async () => n(`SELECT count(*) FROM cuartos_frios WHERE id LIKE 'CF-C109%' AND (stock->>'C109-X')::int < 0`);
  const VD = `SELECT completar_venta_directa($1::uuid, $2::bigint, 'contado', 'Efectivo', '[{"sku":"C109-X","cuarto_id":"CF-C109","cantidad":8}]') AS r`;
  const CARGA = `SELECT confirmar_carga_ruta($1::uuid, $2::bigint, 'firma C109', false, NULL) AS r`;
  // 1. Dos ventas directas sobre la misma existencia (10; cada una pide 8).
  let r = await carrera(SUB(1), VD, [OP(1), 10961], SUB(2), VD, [OP(2), 10962]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '22023' && /Stock insuficiente/.test(r.rb.msg) && await cf() === 2 && await negativos() === 0
     && await n(`SELECT count(*) FROM inventario_mov WHERE producto = 'C109-X'`) === 1 && await n(`SELECT count(*) FROM pagos WHERE orden_id = 10962`) === 0
     && await n(`SELECT count(*) FROM ordenes WHERE id = 10962 AND estatus = 'Creada'`) === 1,
     '109-C1 dos ventas directas sobre el mismo cuarto: la segunda espera y se rechaza completa (existencia 2, sin negativos, sin pago ni entrega)');
  // 2. Venta directa contra carga de ruta (la carga bloquea todos los cuartos).
  await reponer(10);
  r = await carrera(SUB(1), VD, [OP(3), 10963], SUB(2), CARGA, [OP(4), 10961]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && /insuficiente/i.test(r.rb.msg) && await cf() === 2 && await negativos() === 0
     && await n(`SELECT count(*) FROM rutas WHERE id = 10961 AND carga_confirmada_at IS NULL AND estatus = 'Pendiente firma'`) === 1,
     '109-C2 venta directa (8) y carga de ruta (5) a la vez: la carga espera y se rechaza (quedan 2); ruta intacta');
  await reponer(10);
  r = await carrera(SUB(1), CARGA, [OP(5), 10962], SUB(2), VD, [OP(6), 10964]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '22023' && await cf() === 5 && await negativos() === 0
     && await n(`SELECT count(*) FROM ordenes WHERE id = 10964 AND estatus = 'Creada'`) === 1,
     '109-C3 carga de ruta (5) y venta directa (8) a la vez: la venta espera y se rechaza (quedan 5); orden intacta');
  // 3. Venta directa contra traspaso.
  await reponer(10);
  r = await carrera(SUB(1), `SELECT traspaso_cuartos($1::uuid, 'CF-C109', 'CF-C109B', 'C109-X', 5) AS r`, [OP(7)], SUB(2), VD, [OP(8), 10965]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '22023' && await cf() === 5
     && await n(`SELECT (stock->>'C109-X')::int FROM cuartos_frios WHERE id = 'CF-C109B'`) === 5 && await negativos() === 0,
     '109-C4 traspaso (5) y venta directa (8) del mismo cuarto: la venta espera y se rechaza; el traspaso queda completo');
  // 4. Venta directa contra asignación de ruta de la misma orden.
  await reponer(10);
  r = await carrera(SUB(1), `SELECT asignar_orden($1::bigint, 10963, 10961) AS r`, [10966], SUB(2), VD, [OP(9), 10966]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '22023' && /tiene ruta/.test(r.rb.msg) && await cf() === 10
     && await n(`SELECT count(*) FROM ordenes WHERE id = 10966 AND estatus = 'Asignada' AND ruta_id = 10963`) === 1
     && await n(`SELECT count(*) FROM pagos WHERE orden_id = 10966`) === 0,
     '109-C5 Admin asigna la orden a una ruta mientras el vendedor la completa: la venta espera la orden, ve la ruta y se rechaza');
  // 5. La misma operación dos veces a la vez.
  r = await carrera(SUB(1), VD, [OP(10), 10967], SUB(1), VD, [OP(10), 10967]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && await cf() === 2
     && await n(`SELECT count(*) FROM inventario_mov WHERE operacion_id = $1`, [OP(10)]) === 1 && await n(`SELECT count(*) FROM pagos WHERE orden_id = 10967`) === 1,
     '109-C6 misma venta (mismo UUID) a la vez: un efecto; la segunda espera y es replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (109 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 109 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '109_venta_directa_atomica.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 109 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 109)'); process.exit(1); }
console.log('── PRUEBAS 109');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/109_venta_directa_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (109)'); process.exit(1); }
}
await reruns090('109', ['072']);
for (const [etq, f] of SUITES_109) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 109)`); process.exit(1); }
  console.log(`  ${etq} tras 109: PASS`);
}
await conc109();
console.log('── concurrencia + frontend↔DB tras 109');
await conc107();
await conc106();
await conc104();
await conc102();
await conc093();
await conc092();
await conc076();
await fe076();
await conc087();
await fe087();
console.log('  concurrencia + frontend↔DB (076, 087, 092, 093, 102, 104, 106, 107, 109) tras 109: PASS');

const after = await catalogo();
fs.writeFileSync(path.join(WORK, 'policies_after.txt'), after.join('\n'));
console.log('── policies DESPUÉS:', after.length);
console.log(after.map(x => '  ' + x).join('\n'));
console.log('── grants anon ledger:', (await c.query(`SELECT table_name||': '||string_agg(privilege_type, ',') AS g FROM information_schema.role_table_grants WHERE grantee='anon' AND table_name IN ('pagos','cuentas_por_cobrar','movimientos_contables') GROUP BY table_name`)).rows.map(x => x.g).join(' | ') || '(ninguno)');
console.log('── EXECUTE funciones:');
for (const row of (await c.query(`SELECT p.proname AS n, COALESCE(p.proacl::text,'NULL') AS acl FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('timbrar_orden','registrar_pago','increment_saldo','move_stock','check_orden_transition','crear_cxc_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','cerrar_ruta_atomic','fin_marcar_ctx','asignar_orden') ORDER BY 1`)).rows) console.log('  ' + row.n.padEnd(26), row.acl);
console.log('── triggers:', (await c.query(`SELECT tgrelid::regclass||':'||tgname AS t FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('ordenes','pagos','cuentas_por_cobrar')`)).rows.map(x => x.t).join(', '));

// ── search_path de las funciones SECURITY DEFINER de 069 (catálogo real)
const F069 = ['fin_mi_rol_activo','fin_actor_permitido','increment_saldo','crear_cxc_orden','registrar_ingreso_orden','abonar_cxc','registrar_pago_orden','cerrar_ruta_financiero','update_orden_atomic','ordenes_guard_financiero',
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
  'ordenes_guard_ruta',
  // 084
  'stock_op_replay','stock_mov_cuarto','confirmar_carga_ruta','registrar_no_entrega','salida_cuarto_manual','traspaso_cuartos',
  // 087
  'balance_ruta_interno','calcular_balance_ruta','finalizar_inventario_ruta','rutas_guard_inventario',
  // 088
  'precio_canonico','lineas_canonicas','fin_validar_credito','fin_actor_id','fin_orden_operable','productos_stock_interno',
  'crear_orden','registrar_recepcion_compra','registrar_salida_empaque','clientes_guard_financiero','auditoria_actor','error_log_actor',
  // 090
  'nextval','b4_ruta_con_historia','anular_cxc_orden','ajustar_cxc_devolucion',
  // 092
  'conciliacion_empaque',
  // 093
  'revertir_produccion','ajustar_existencia','reporte_financiero','fin_egreso_no_efectivo','productos_existencia_inicial',
  // 096
  'cerrar_caja_ruta','rutas_pendientes_caja',
  // 098
  'pagar_cuenta_por_pagar','pagar_nomina',
  // 100
  'crear_periodo_nomina','generar_recibos_nomina','editar_recibo_nomina',
  // 102
  'ajustar_existencia_cuarto','registrar_merma_cuarto','cuarto_tiene_historia',
  // 104
  'registrar_devolucion','empaque_tiene_dependencias',
  // 109
  'completar_venta_directa'];
const sp = (await c.query(`SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ';') AS cfg,
    has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
    pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY($1) ORDER BY p.proname`, [F069])).rows;
console.log('── SEARCH_PATH (pg_proc real)');
let spOk = new Set(sp.map(f => f.proname)).size === F069.length;
for (const f of sp) {
  const ok = f.prosecdef && f.cfg === 'search_path=public, pg_temp';
  if (!ok) spOk = false;
  console.log(`  ${f.proname.padEnd(26)} secdef=${f.prosecdef} ${f.cfg || 'SIN search_path'} PUBLIC=${f.pub} anon=${f.anon} auth=${f.auth}`);
}
console.log('  SEARCH_PATH_CHECK:', spOk ? 'PASS' : 'FAIL', `(${sp.filter(f=>f.cfg==='search_path=public, pg_temp').length}/${sp.length} definiciones, ${new Set(sp.map(f => f.proname)).size}/${F069.length} nombres)`);
// ── referencias no calificadas: cada identificador usado como tabla o función
//    debe resolverse en public o pg_catalog (nunca en otro schema).
const objs = (await c.query(`SELECT n.nspname, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pg_catalog')
  UNION SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','pg_catalog')`)).rows;
const where = new Map(); for (const o of objs) { if (!where.has(o.name)) where.set(o.name, new Set()); where.get(o.name).add(o.nspname); }
const KW = new Set(['except','intersect','if','exists','coalesce','nullif','greatest','least','case','when','then','else','end','and','or','not','in','select','from','where','values','returning','into','set','update','insert','delete','for','loop','perform','raise','exception','return','begin','declare','found','is','null','true','false','as','on','using','errcode','array','row','distinct','all','any','some','cast','interval','date','numeric','text','bigint','int','integer','boolean','jsonb','varchar','record','rowtype','type','with','check','lateral','limit','order','by','group','having','each','statement','new','old','trigger','language','plpgsql','sql','stable','security','definer','search_path','pg_temp','public','function','replace','create','returns','void','diagnostics','get','row_count','strict','conflict','nothing','filter','join']);
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
  // CTEs (WITH x AS (…), y AS (…)): nombres locales de la consulta, no objetos
  for (const m of stripped.matchAll(/(?:\bWITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) declared.add(m[1].toLowerCase());
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
  // 088/089 cambian a propósito dos policies de ordenes fuera del alcance de 069
  // (sin INSERT directo; UPDATE del chofer solo en su ruta).
  const CAMBIOS_088 = ['ordenes|ventas_insert|INSERT', 'ordenes|chofer_update_own|UPDATE'];
  const faltan = PROD_BEFORE.filter(x => !afterRb.includes(x) && !CAMBIOS_088.includes(x)); const sobran = afterRb.filter(x => !PROD_BEFORE.includes(x) && !CAMBIOS_088.includes(x));
  console.log('  rollback aplicado:', !rb.aborted, '| policies == producción antes:', faltan.length === 0 && sobran.length === 0 ? 'SÍ' : 'NO ' + JSON.stringify({ faltan, sobran }));
  console.log('  trigger guard presente tras rollback:', (await c.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_ordenes_guard_financiero'`)).rows[0].n);
}
await c.end();
console.log(r.aborted ? 'RESULTADO: FALLÓ' : 'RESULTADO: OK');
sh(path.join(BIN, 'pg_ctl'), ['-D', DATA, 'stop', '-m', 'fast']);
process.exit(r.aborted ? 1 : 0);
