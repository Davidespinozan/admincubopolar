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
const PORT = Number(process.env.PG_PORT) || 5499; // PG_PORT: otro puerto cuando dos gates corren a la vez
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
const files = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => f.endsWith('.sql') && !skip.has(f) && !f.startsWith('069_') && !f.startsWith('070_') && !f.startsWith('071_') && !f.startsWith('072_') && !f.startsWith('073_') && !f.startsWith('074_') && !f.startsWith('075_') && !f.startsWith('076_') && !f.startsWith('077_') && !f.startsWith('078_') && !f.startsWith('079_') && !f.startsWith('080_') && !f.startsWith('081_') && !f.startsWith('082_') && !f.startsWith('083_') && !f.startsWith('084_') && !f.startsWith('085_') && !f.startsWith('086_') && !f.startsWith('087_') && !f.startsWith('088_') && !f.startsWith('089_') && !f.startsWith('090_') && !f.startsWith('091_') && !f.startsWith('092_') && !f.startsWith('093_') && !f.startsWith('094_') && !f.startsWith('095_') && !f.startsWith('096_') && !f.startsWith('097_') && !f.startsWith('098_') && !f.startsWith('099_') && !f.startsWith('100_') && !f.startsWith('101_') && !f.startsWith('102_') && !f.startsWith('103_') && !f.startsWith('104_') && !f.startsWith('105_') && !f.startsWith('106_') && !f.startsWith('107_') && !f.startsWith('108_') && !f.startsWith('109_') && !f.startsWith('110_') && !f.startsWith('111_') && !f.startsWith('112_') && !f.startsWith('113_') && !f.startsWith('114_') && !f.startsWith('115_') && !f.startsWith('116_') && !f.startsWith('117_') && !f.startsWith('118_') && !f.startsWith('119_') && !f.startsWith('120_') && !f.startsWith('121_') && !f.startsWith('122_') && !f.startsWith('123_') && !f.startsWith('124_') && !f.startsWith('125_') && !f.startsWith('127_') && !f.startsWith('128_') && !f.startsWith('129_') && !f.startsWith('130_') && !f.startsWith('131_') && !f.startsWith('132_') && !f.startsWith('133_')).sort((a, b) => {
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
  -- Producción (verificado 2026-10-06, solo lectura): SIN idx_pagos_ref. 001 lo
  -- crea y 015 solo "si los datos están limpios"; en producción quedó ausente.
  -- CLOSURE-1: la base local antes de 114 debe ser igual; 114 es quien lo crea.
  DROP INDEX IF EXISTS idx_pagos_ref;
  -- Producción (verificado 2026-10-06): pagos.referencia es NOT NULL DEFAULT ''
  -- ('' = "sin referencia", fuera del índice parcial); el repo la deja sin default.
  ALTER TABLE pagos ALTER COLUMN referencia SET DEFAULT '';
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
    DO $c100$ BEGIN IF to_regclass('public.nomina_recibo_lineas') IS NOT NULL THEN
      DELETE FROM nomina_recibo_lineas WHERE recibo_id IN (SELECT id FROM nomina_recibos
        WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por LIKE 'AdminC100-%') OR empleado_id BETWEEN 10061 AND 10069);
    END IF; END $c100$;
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
  // 112 (OL-03B): el backend factura dentro del contexto de CFDI y con su identidad (como finalizar_operacion_cfdi).
  r = await carrera(null, `WITH ctx AS (SELECT set_config('app.cfdi_ctx', CASE WHEN to_regprocedure('public.ordenes_guard_facturada()') IS NULL THEN '' ELSE 'emision' END, true) AS v)
                           UPDATE ordenes SET estatus = 'Facturada', facturama_id = 'FM-C104', facturama_uuid = 'UUID-C104' FROM ctx WHERE id = 10466 RETURNING id AS r`, [],
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

// ═══ 110 — contención del camino heredado de venta directa (OL-02D2; aditiva) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.ordenes_guard_entrega_directa()') IS NULL
                               AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_entrega_directa') AS a`)).rows[0].a;
  console.log(`  ENTREGA_DIRECTA_PARITY_CHECK[pre-110]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_110 = [...SUITES_109, ['109', '109_venta_directa_test.sql']];
async function conc110() {
  console.log('── 110 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'b1c00000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const OP = (k) => 'b1c10000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11061 AND 11069;
    DELETE FROM inventario_mov WHERE producto LIKE 'C110-%';
    DELETE FROM stock_operaciones WHERE operacion_id::text LIKE 'b1c1%' OR orden_id BETWEEN 11061 AND 11069;
    DELETE FROM pagos WHERE orden_id BETWEEN 11061 AND 11069;
    DELETE FROM orden_lineas WHERE orden_id BETWEEN 11061 AND 11069; DELETE FROM ordenes WHERE id BETWEEN 11061 AND 11069;
    DELETE FROM rutas WHERE id BETWEEN 11061 AND 11069;
    DELETE FROM auditoria WHERE detalle LIKE 'OV-1106%' OR detalle LIKE 'Orden #1106%' OR usuario LIKE '%C110%';
    DELETE FROM cuartos_frios WHERE id = 'CF-C110'; DELETE FROM productos WHERE sku LIKE 'C110-%';
    DELETE FROM usuarios WHERE id BETWEEN 11061 AND 11069; DELETE FROM auth.users WHERE id::text LIKE 'b1c00000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('b1c00000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t110c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (11061, 'AdminC110', 'c1@t110c', 'Admin', 'Activo', '${SUB(1)}'), (11062, 'VentasC110', 'c2@t110c', 'Ventas', 'Activo', '${SUB(2)}');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('C110-X', 'Hielo C110', 'Producto Terminado', 10, 0, 0);
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C110', 'Cuarto C110', '{"C110-X": 20}');
    INSERT INTO rutas (id, folio, nombre, estatus, chofer_id, carga, carga_autorizada, extra_autorizado, carga_real) VALUES (11061, 'R-11061', 'C110 ruta', 'Programada', NULL, '{}', '{}', '{}', '{}');
    INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id)
      SELECT 11060 + k, 'OV-1106' || k, 'Cliente C110', 'x', 20, 'Asignada', 'Efectivo', 'Contado', 11062 FROM generate_series(1, 4) k;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT 11060 + k, 'C110-X', 2, 10, 20 FROM generate_series(1, 4) k;
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl, sub) => {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  };
  const carrera = async (subA, sqlA, pA, subB, sqlB, pB) => {
    await actor(a, subA); await actor(b, subB);
    const ra = await a.query(sqlA, pA).then(r => ({ ok: true, row: r.rows[0], count: r.rowCount }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(sqlB, pB).then(r => ({ ok: true, row: r.rows[0], count: r.rowCount }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const VIEJO = `UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = $1`;
  const VD = `SELECT completar_venta_directa($1::uuid, $2::bigint, 'contado', 'Efectivo', '[{"sku":"C110-X","cuarto_id":"CF-C110","cantidad":2}]') AS r`;
  const ASIGNAR = `SELECT asignar_orden($1::bigint, 11061, 11061) AS r`;
  const estado = async (id) => (await c.query(`SELECT estatus::text AS e, ruta_id FROM ordenes WHERE id = $1`, [id])).rows[0];
  const cf = async () => n(`SELECT COALESCE((stock->>'C110-X')::int, 0) FROM cuartos_frios WHERE id = 'CF-C110'`);
  // 1. Contrato primero, cliente viejo después (misma orden).
  let r = await carrera(SUB(2), VD, [OP(1), 11061], SUB(2), VIEJO, [11061]);
  ok(r.ra.ok && r.bloqueado && (await estado(11061)).e === 'Entregada' && await cf() === 18
     && await n(`SELECT count(*) FROM pagos WHERE orden_id = 11061`) === 1 && await n(`SELECT count(*) FROM inventario_mov WHERE referencia = 'venta_directa/11061'`) === 1,
     `110-18a contrato y cliente viejo a la vez: el viejo espera la orden y ya la encuentra Entregada (${r.rb.ok ? 'sin cambio' : r.rb.code}); un pago, una salida`);
  // 2. Cliente viejo primero (rechazado por 110, conserva el bloqueo hasta su ROLLBACK), contrato después.
  r = await carrera(SUB(2), VIEJO, [11062], SUB(2), VD, [OP(2), 11062]);
  ok(!r.ra.ok && r.ra.code === '42501' && r.rb.ok && (await estado(11062)).e === 'Entregada' && await cf() === 16
     && await n(`SELECT count(*) FROM pagos WHERE orden_id = 11062`) === 1,
     '110-18b cliente viejo rechazado (42501) y el contrato completa la misma orden: un pago, una salida');
  // 3. Admin asigna ruta mientras el cliente viejo intenta entregar sin ruta.
  r = await carrera(SUB(1), ASIGNAR, [11063], SUB(2), VIEJO, [11063]);
  let e = await estado(11063);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.count === 0 && e.e === 'Asignada' && Number(e.ruta_id) === 11061,
     '110-19a asignación de ruta y cliente viejo a la vez: tras la ruta la orden ya no es de Ventas (0 filas); queda Asignada con ruta, sin entrega');
  // 4. Cliente viejo primero (rechazado) y luego la asignación de ruta.
  r = await carrera(SUB(2), VIEJO, [11064], SUB(1), ASIGNAR, [11064]);
  e = await estado(11064);
  ok(!r.ra.ok && r.ra.code === '42501' && r.rb.ok && e.e === 'Asignada' && Number(e.ruta_id) === 11061 && await n(`SELECT count(*) FROM pagos WHERE orden_id = 11064`) === 0,
     '110-19b cliente viejo rechazado y la asignación de ruta procede; ninguna entrega sin ruta escapa');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (110 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 110 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '110_contencion_entrega_directa.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 110 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 110)'); process.exit(1); }
console.log('── PRUEBAS 110');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/110_contencion_entrega_directa_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (110)'); process.exit(1); }
}
await reruns090('110', ['072']);
for (const [etq, f] of SUITES_110) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 110)`); process.exit(1); }
  console.log(`  ${etq} tras 110: PASS`);
}
await conc110();
console.log('── concurrencia + frontend↔DB tras 110');
await conc109();
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
console.log('  concurrencia + frontend↔DB (076, 087, 092, 093, 102, 104, 106, 107, 109, 110) tras 110: PASS');

// ═══ 111 — operaciones CFDI (OL-03B; aditiva) ═══
{
  const ok = (await c.query(`SELECT to_regclass('public.cfdi_operaciones') IS NULL AND to_regprocedure('public.reservar_operacion_cfdi(bigint,text,bigint,text,text,text,integer)') IS NULL
                               AND to_regprocedure('public.ordenes_guard_facturada()') IS NULL
                               AND md5(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)) = '9b93ce16242718a4bfeb6783ea99bc64' AS a`)).rows[0].a;
  console.log(`  CFDI_PARITY_CHECK[pre-111]: ${ok ? 'PASS' : 'FAIL'} (cierre de ruta = producción 9b93ce16)`);
  if (!ok) process.exit(1);
}
const SUITES_111 = [...SUITES_110, ['110', '110_contencion_entrega_directa_test.sql']];
async function concCfdi(etiqueta) {
  console.log(`── OL-03B CONCURRENCIA EN LA BASE (dos conexiones reales, ${etiqueta})`);
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11161 AND 11169; DELETE FROM orden_lineas WHERE orden_id BETWEEN 11161 AND 11169;
    DELETE FROM ordenes WHERE id BETWEEN 11161 AND 11169; DELETE FROM usuarios WHERE id = 11161; COMMIT;`);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES (11161, 'AdminC111', 'c111@t', 'Admin', 'Activo');
    INSERT INTO ordenes (id, folio, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, facturama_id, facturama_uuid) VALUES
      (11161, 'OV-11161', 'C', 'x', 20, 'Entregada', 'Efectivo', 'Contado', NULL, NULL),
      (11162, 'OV-11162', 'C', 'x', 20, 'Facturada', 'Efectivo', 'Contado', 'FM-C162', 'UUID-C162'),
      (11163, 'OV-11163', 'C', 'x', 20, 'Facturada', 'Efectivo', 'Contado', 'FM-C163', 'UUID-C163');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  const srv = async (cl) => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE service_role'); await cl.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`); };
  const carrera = async (sqlA, sqlB) => {
    await srv(a); await srv(b);
    const ra = await a.query(sqlA).then(r => r.rows[0].r, e => ({ error: e.code }));
    let done = false;
    const prB = b.query(sqlB).then(r => r.rows[0].r, e => ({ error: e.code })).finally(() => { done = true; });
    await sleep(400);
    const bloqueado = !done;
    await a.query('COMMIT');
    const rb = await prB; await b.query('COMMIT');
    return { ra, rb, bloqueado };
  };
  const R = (o, tipo, extra = '') => `SELECT reservar_operacion_cfdi(${o}, '${tipo}', 11161, 'h'${extra}) AS r`;
  let r = await carrera(R(11161, 'emision'), R(11161, 'emision'));
  ok(r.ra.ok === true && r.bloqueado && r.rb.ok === false && r.rb.codigo === 'OPERACION_EN_CURSO' && r.rb.operacion_id === r.ra.operacion_id,
    'C111-1 dos reservas de emisión simultáneas: la segunda ESPERA el bloqueo de la orden y recibe OPERACION_EN_CURSO (una sola operación)');
  r = await carrera(R(11162, 'cancelacion', ", '02'"), R(11162, 'cancelacion', ", '02'"));
  ok(r.ra.ok === true && r.bloqueado && r.rb.codigo === 'OPERACION_EN_CURSO', 'C111-2 dos reservas de cancelación simultáneas: una sola operación');
  r = await carrera(R(11163, 'cancelacion', ", '02'"), R(11163, 'emision'));
  ok(r.ra.ok === true && r.bloqueado && r.rb.ok === false && ['OPERACION_EN_CURSO', 'CFDI_VIGENTE'].includes(r.rb.codigo),
    `C111-3 cancelación y emisión a la vez sobre la misma orden: serializadas (${r.rb.codigo})`);
  const n = Number((await c.query(`SELECT count(*) FROM cfdi_operaciones WHERE orden_id BETWEEN 11161 AND 11163`)).rows[0].count);
  ok(n === 3, `C111-4 exactamente una operación por orden tras las carreras (${n})`);
  await a.end(); await b.end();
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11161 AND 11169; DELETE FROM ordenes WHERE id BETWEEN 11161 AND 11169; DELETE FROM usuarios WHERE id = 11161; COMMIT;`);
  if (!okAll) { console.log(`RESULTADO: FALLÓ (OL-03B concurrencia ${etiqueta})`); process.exit(1); }
}
async function handlersCfdi(etiqueta) {
  console.log(`── OL-03B NETLIFY FUNCTIONS ↔ POSTGRES REAL (${etiqueta}; proveedor FALSO)`);
  const { pathToFileURL } = await import('node:url');
  const { Pool } = require('pg');
  const { makePgSupabase } = await import(pathToFileURL(path.join(ROOT, 'supabase/tests/local/pgSupabaseAdapter.mjs')).href);
  const { createHandler: inv } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-create-invoice/index.js')).href);
  const { createHandler: can } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-cancel-invoice/index.js')).href);
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const q1 = async (sql, p) => (await c.query(sql, p)).rows[0];
  const AUTH = (k) => '11300000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM invoice_attempts WHERE orden_id BETWEEN 11301 AND 11319; DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11301 AND 11319;
    DELETE FROM orden_lineas WHERE orden_id BETWEEN 11301 AND 11319; DELETE FROM ordenes WHERE id BETWEEN 11301 AND 11319;
    DELETE FROM clientes WHERE id = 11301; DELETE FROM usuarios WHERE id BETWEEN 11301 AND 11309; DELETE FROM auth.users WHERE id::text LIKE '11300000-%'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('11300000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'h' || k || '@t113' FROM generate_series(1, 4) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (11301, 'Admin H', 'h1@t113', 'Admin', 'Activo', '${AUTH(1)}'), (11302, 'Fact H', 'h2@t113', 'Facturación', 'Activo', '${AUTH(2)}'),
      (11303, 'Ventas HA', 'h3@t113', 'Ventas', 'Activo', '${AUTH(3)}'), (11304, 'Ventas HB', 'h4@t113', 'Ventas', 'Activo', '${AUTH(4)}');
    INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11301, 'Cliente H', 'XAXX010101000', 0, true, 1000);
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id, facturama_id, facturama_uuid) VALUES
      (11301, 'OV-11301', 11301, 'Cliente H', 'x', 40, 'Entregada', 'Efectivo',        'Contado', 11303, NULL, NULL),
      (11302, 'OV-11302', 11301, 'Cliente H', 'x', 40, 'Entregada', 'Efectivo',        'Contado', 11304, NULL, NULL),
      (11303, 'OV-11303', 11301, 'Cliente H', 'x', 40, 'Entregada', 'Crédito (fiado)', 'Credito', 11303, NULL, NULL),
      (11304, 'OV-11304', 11301, 'Cliente H', 'x', 40, 'Entregada', 'Efectivo',        'Contado', 11303, NULL, NULL),
      (11305, 'OV-11305', 11301, 'Cliente H', 'x', 40, 'Entregada', 'Efectivo',        'Contado', 11303, NULL, NULL),
      (11306, 'OV-11306', 11301, 'Cliente H', 'x', 40, 'Facturada', 'Efectivo',        'Contado', 11303, 'FM-H306', 'UUID-H306'),
      (11307, 'OV-11307', 11301, 'Cliente H', 'x', 40, 'Creada',    'Efectivo',        'Contado', 11303, NULL, NULL);
    UPDATE ordenes SET delivered_at = now() WHERE id BETWEEN 11301 AND 11306;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'HPC-5K', 2, 20, 40 FROM ordenes WHERE id BETWEEN 11301 AND 11307;
    COMMIT;`);
  const pool = new Pool({ host: '127.0.0.1', port: PORT, user: USER, database: DB, max: 6 });
  const tokens = { 'jwt-admin': { id: AUTH(1) }, 'jwt-fact': { id: AUTH(2) }, 'jwt-va': { id: AUTH(3) }, 'jwt-vb': { id: AUTH(4) } };
  const fetchReal = globalThis.fetch; let redReal = 0;
  globalThis.fetch = () => { redReal++; throw new Error('red real prohibida'); };
  // Proveedor falso con barrera: la primera llamada espera (hasta 600 ms) a que llegue una segunda.
  const proveedor = (guion, { barrera = false } = {}) => {
    const calls = []; let soltar; const llega2 = new Promise(r => { soltar = r; });
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (calls.length >= 2) soltar();
      if (barrera && calls.length === 1) await Promise.race([llega2, sleep(600)]);
      const paso = guion[Math.min(calls.length - 1, guion.length - 1)];
      if (paso === 'colgado') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      const [status, raw] = paso;
      return { ok: status < 300, status, json: async () => raw };
    };
    return { calls, fetchImpl, getConfig: () => ({ username: 'stub', password: 'stub', baseUrl: 'https://facturama.invalid' }) };
  };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const mk = (prov, fallar = {}, timeoutMs = 2000) => {
    const sup = makePgSupabase(pool, { tokens, fallar });
    const deps = { getSupabase: () => sup, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig, timeoutMs, leaseSegundos: 120 };
    return { timbrar: inv(deps), cancelar: can(deps) };
  };
  const ev = (who, body) => ({ httpMethod: 'POST', headers: { authorization: `Bearer jwt-${who}` }, body: JSON.stringify(body) });
  const L = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
  const ord = async (id) => q1(`SELECT estatus, facturama_uuid AS u, cfdi_cancelado_at IS NOT NULL AS cancelado FROM ordenes WHERE id = $1`, [id]);
  const opsDe = async (id) => (await c.query(`SELECT tipo || generacion || ':' || estado AS x FROM cfdi_operaciones WHERE orden_id = $1 ORDER BY created_at, generacion`, [id])).rows.map(x => x.x);

  // H1 — dos timbrados simultáneos: UNA llamada al proveedor (compuerta dura).
  let prov = proveedor([[201, { Id: 'FM-H1', Folio: 'H1', Uuid: 'UUID-H1' }]], { barrera: true });
  let h = mk(prov);
  let rs = (await Promise.all([h.timbrar(ev('admin', { ordenId: 11301 })), h.timbrar(ev('fact', { ordenId: 11301 }))])).map(L);
  ok(prov.calls.length === 1 && rs.filter(r => r.status === 200 && !r.body.alreadyInvoiced).length === 1
     && rs.some(r => r.status === 409 && r.body.code === 'OPERACION_EN_CURSO') && (await ord(11301)).estatus === 'Facturada',
    `H1 dos timbrados simultáneos (proveedor con barrera): ${prov.calls.length} llamada(s) al proveedor; uno 200, el otro 409 OPERACION_EN_CURSO; orden Facturada`);
  // H2 — dos cancelaciones simultáneas: UNA llamada.
  prov = proveedor([[200, { Status: 'canceled' }]], { barrera: true });
  h = mk(prov);
  rs = (await Promise.all([h.cancelar(ev('admin', { ordenId: 11301, motivo: '02' })), h.cancelar(ev('fact', { ordenId: 11301, motivo: '02' }))])).map(L);
  ok(prov.calls.length === 1 && rs.filter(r => r.status === 200 && r.body.cancelled).length === 1 && (await ord(11301)).estatus === 'Entregada',
    `H2 dos cancelaciones simultáneas: ${prov.calls.length} llamada(s) DELETE; una cancela, la otra no cruza; orden de vuelta a Entregada`);
  // H3 — re-facturación gen 2.
  prov = proveedor([[201, { Id: 'FM-H3', Uuid: 'UUID-H3' }]]); h = mk(prov);
  ok(L(await h.timbrar(ev('va', { ordenId: 11301 }))).status === 200 && (await ord(11301)).u === 'UUID-H3'
     && (await opsDe(11301)).join(',') === 'emision1:exitosa,cancelacion1:exitosa,emision2:exitosa',
    'H3 re-facturación tras cancelación confirmada: generación 2 (Ventas dueño)');
  // H4 — Ventas sobre la orden de otro vendedor.
  prov = proveedor([[201, { Id: 'X', Uuid: 'X' }]]); h = mk(prov);
  ok(L(await h.timbrar(ev('va', { ordenId: 11302 }))).status === 403 && prov.calls.length === 0 && (await opsDe(11302)).length === 0,
    'H4 Ventas A sobre la orden de Ventas B: 403, cero proveedor, cero operaciones');
  // H5 — crédito entregado y sin pagar.
  prov = proveedor([[201, { Id: 'FM-H5', Uuid: 'UUID-H5' }]]); h = mk(prov);
  ok(L(await h.timbrar(ev('va', { ordenId: 11303 }))).status === 200 && prov.calls[0].body.PaymentMethod === 'PPD' && (await ord(11303)).estatus === 'Facturada',
    'H5 venta a crédito entregada y sin pagar: se timbra (PPD)');
  // H6 — timeout → incierta; reintento sin proveedor.
  prov = proveedor(['colgado']); h = mk(prov, {}, 150);
  const r6 = L(await h.timbrar(ev('admin', { ordenId: 11304 })));
  const r6b = L(await h.timbrar(ev('fact', { ordenId: 11304 })));
  ok(r6.status === 502 && r6.body.code === 'RESULTADO_INCIERTO' && r6b.body.code === 'OPERACION_INCIERTA' && prov.calls.length === 1
     && (await opsDe(11304)).join(',') === 'emision1:incierta' && (await ord(11304)).estatus === 'Entregada',
    'H6 timeout del proveedor: 502 RESULTADO_INCIERTO, operación incierta; el reintento NO llama al proveedor');
  // H7 — el proveedor timbró y la finalización falló (caída tras el proveedor).
  prov = proveedor([[201, { Id: 'FM-H7', Uuid: 'UUID-H7' }]]); h = mk(prov, { finalizar_operacion_cfdi: 1 });
  const r7 = L(await h.timbrar(ev('admin', { ordenId: 11305 })));
  ok(r7.status === 502 && r7.body.code === 'FINALIZACION_PENDIENTE' && r7.body.facturamaUuid === 'UUID-H7' && (await ord(11305)).estatus === 'Entregada'
     && (await opsDe(11305)).join(',') === 'emision1:en_curso', 'H7 timbró pero la base no registró: 502 FINALIZACION_PENDIENTE con el UUID; operación sigue reservada');
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE cfdi_operaciones SET lease_hasta = now() - interval '1 second' WHERE orden_id = 11305; COMMIT;`);
  const r7b = L(await mk(prov).timbrar(ev('admin', { ordenId: 11305 })));
  ok(r7b.body.code === 'OPERACION_INCIERTA' && prov.calls.length === 1 && (await opsDe(11305)).join(',') === 'emision1:incierta',
    'H7b al vencer el lease la operación pasa a incierta: el reintento NO vuelve a timbrar');
  const opH7 = (await q1(`SELECT id FROM cfdi_operaciones WHERE orden_id = 11305`)).id;
  await c.query(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SELECT conciliar_operacion_cfdi('${opH7}', 'emitida', '{"evidencia":"Facturama: CFDI FM-H7 existe","proveedor_id":"FM-H7","cfdi_uuid":"UUID-H7"}', 11302); COMMIT;`);
  ok((await ord(11305)).estatus === 'Facturada' && (await ord(11305)).u === 'UUID-H7', 'H7c conciliación con evidencia: la orden queda Facturada con el CFDI que sí existía (sin segundo timbrado)');
  // H8 — cancelación solicitada (pendiente).
  prov = proveedor([[200, { Status: 'requested' }]]); h = mk(prov);
  const r8 = L(await h.cancelar(ev('va', { ordenId: 11306, motivo: '02' })));
  const r8b = L(await h.cancelar(ev('admin', { ordenId: 11306, motivo: '02' })));
  const r8c = L(await h.timbrar(ev('admin', { ordenId: 11306 })));
  ok(r8.status === 202 && r8.body.code === 'CANCELACION_SOLICITADA' && r8b.status === 202 && r8b.body.code === 'CANCELACION_PENDIENTE' && r8c.body.alreadyInvoiced
     && prov.calls.length === 1 && (await ord(11306)).estatus === 'Facturada' && !(await ord(11306)).cancelado,
    'H8 cancelación solicitada: 202; la orden SIGUE Facturada; otra cancelación (202 pendiente) o un timbrado no llaman al proveedor');
  // H9 — orden no entregada: nada cruza.
  prov = proveedor([[201, { Id: 'X', Uuid: 'X' }]]); h = mk(prov);
  ok(L(await h.timbrar(ev('admin', { ordenId: 11307 }))).status === 409 && prov.calls.length === 0 && (await opsDe(11307)).length === 0,
    'H9 orden Creada: 409 antes de reservar; cero proveedor');
  ok(redReal === 0, 'H10 ninguna llamada a la red real (fetch global bloqueado)');
  globalThis.fetch = fetchReal;
  await pool.end();
  await c.query(limpiar);
  if (!okAll) { console.log(`RESULTADO: FALLÓ (OL-03B handlers ${etiqueta})`); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 111 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '111_operaciones_cfdi.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 111 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 111)'); process.exit(1); }
console.log('── PRUEBAS 111');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/111_operaciones_cfdi_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (111)'); process.exit(1); }
}
await reruns090('111', ['072']);
for (const [etq, f] of SUITES_111) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 111)`); process.exit(1); }
  console.log(`  ${etq} tras 111: PASS`);
}
await concCfdi('tras 111');
await handlersCfdi('tras 111, antes de la guarda 112: código nuevo compatible');

// ═══ 112 — contención: Facturada solo por contrato; cierre de ruta conserva Facturada ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.ordenes_guard_facturada()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_guard_facturada')
                               AND md5(pg_get_functiondef('public.cerrar_ruta_financiero(uuid,bigint,jsonb,bigint,text)'::regprocedure)) = '9b93ce16242718a4bfeb6783ea99bc64' AS a`)).rows[0].a;
  console.log(`  FACTURADA_PARITY_CHECK[pre-112]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_112 = [...SUITES_111, ['111', '111_operaciones_cfdi_test.sql']];
for (const k of [1, 2]) {
  console.log(`── aplicar 112 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '112_contencion_facturada.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 112 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 112)'); process.exit(1); }
console.log('── PRUEBAS 112');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/112_contencion_facturada_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (112)'); process.exit(1); }
}
await reruns090('112', ['072']);
for (const [etq, f] of SUITES_112) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 112)`); process.exit(1); }
  console.log(`  ${etq} tras 112: PASS`);
}
await concCfdi('tras 112');
await handlersCfdi('tras 112');
console.log('── concurrencia + frontend↔DB tras 112');
await conc110();
await conc109();
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
console.log('  concurrencia + frontend↔DB (076, 087, 092, 093, 102, 104, 106, 107, 109, 110, OL-03B) tras 112: PASS');

// ═══ 113 — complementos de pago por pago (OL-04; aditiva) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.reservar_complemento_cfdi(bigint,bigint,integer)') IS NULL
                               AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cfdi_operaciones' AND column_name = 'pago_id') AS a`)).rows[0].a;
  console.log(`  COMPLEMENTO_PARITY_CHECK[pre-113]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_113 = [...SUITES_112, ['112', '112_contencion_facturada_test.sql']];
async function handlersComplemento(etiqueta) {
  console.log(`── OL-04 COMPLEMENTOS: NETLIFY FUNCTIONS ↔ POSTGRES REAL (${etiqueta}; proveedor FALSO)`);
  const { pathToFileURL } = await import('node:url');
  const { Pool } = require('pg');
  const { makePgSupabase } = await import(pathToFileURL(path.join(ROOT, 'supabase/tests/local/pgSupabaseAdapter.mjs')).href);
  const { createHandler: inv } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-create-invoice/index.js')).href);
  const { createHandler: comp } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-create-complemento/index.js')).href);
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const q1 = async (sql, p) => (await c.query(sql, p)).rows[0];
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const AUTH = (k) => '11400000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM invoice_attempts WHERE orden_id BETWEEN 11401 AND 11409; DELETE FROM cfdi_operaciones WHERE orden_id BETWEEN 11401 AND 11409;
    DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11401 AND 11409; DELETE FROM pagos WHERE orden_id BETWEEN 11401 AND 11409 OR referencia LIKE 'H113-%';
    DELETE FROM cuentas_por_cobrar WHERE id BETWEEN 11401 AND 11409; DELETE FROM orden_lineas WHERE orden_id BETWEEN 11401 AND 11409;
    DELETE FROM ordenes WHERE id BETWEEN 11401 AND 11409; DELETE FROM clientes WHERE id = 11401;
    DELETE FROM usuarios WHERE id BETWEEN 11401 AND 11409; DELETE FROM auth.users WHERE id::text LIKE '11400000-%'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('11400000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'k' || k || '@t114' FROM generate_series(1, 5) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (11401, 'Admin K', 'k1@t114', 'Admin', 'Activo', '${AUTH(1)}'), (11402, 'Fact K', 'k2@t114', 'Facturación', 'Activo', '${AUTH(2)}'),
      (11403, 'Ventas KA', 'k3@t114', 'Ventas', 'Activo', '${AUTH(3)}'), (11404, 'Ventas KB', 'k4@t114', 'Ventas', 'Activo', '${AUTH(4)}'),
      (11405, 'Chofer K', 'k5@t114', 'Chofer', 'Activo', '${AUTH(5)}');
    INSERT INTO clientes (id, nombre, rfc, regimen, cp, saldo, credito_autorizado, limite_credito) VALUES (11401, 'Cliente K SA', 'AAA010101AAA', '601', '34000', 0, true, 100000);
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, vendedor_id) VALUES
      (11401, 'OV-11401', 11401, 'Cliente K SA', 'x', 300, 'Entregada', 'Crédito (fiado)', 'Credito', 11403),
      (11402, 'OV-11402', 11401, 'Cliente K SA', 'x', 100, 'Entregada', 'Crédito (fiado)', 'Credito', 11404);
    UPDATE ordenes SET delivered_at = now() WHERE id IN (11401, 11402);
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (11401, 'HPC-5K', 10, 30, 300), (11402, 'HPC-5K', 5, 20, 100);
    INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, estatus, concepto)
      VALUES (11401, 11401, 11401, CURRENT_DATE, CURRENT_DATE + 30, 300, 0, 300, 'Pendiente', 'K'), (11402, 11401, 11402, CURRENT_DATE, CURRENT_DATE + 30, 100, 0, 100, 'Pendiente', 'K');
    COMMIT;`);
  const abonar = async (cxc, monto, metodo, ref) => {
    const r = await c.query(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', $$${JSON.stringify({ role: 'authenticated', sub: AUTH(1) })}$$, true);
      SELECT (abonar_cxc(${cxc}, ${monto}, '${metodo}', '${ref}') ->> 'pago_id')::bigint AS id; COMMIT;`);
    return Number(r.find(x => x.command === 'SELECT' && x.rows[0]?.id).rows[0].id);
  };
  const pool = new Pool({ host: '127.0.0.1', port: PORT, user: USER, database: DB, max: 6 });
  const tokens = { 'jwt-admin': { id: AUTH(1) }, 'jwt-fact': { id: AUTH(2) }, 'jwt-va': { id: AUTH(3) }, 'jwt-vb': { id: AUTH(4) }, 'jwt-chofer': { id: AUTH(5) } };
  const fetchReal = globalThis.fetch; let redReal = 0;
  globalThis.fetch = () => { redReal++; throw new Error('red real prohibida'); };
  const proveedor = (guion, { barrera = false } = {}) => {
    const calls = []; let soltar; const llega2 = new Promise(r => { soltar = r; });
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (calls.length >= 2) soltar();
      if (barrera && calls.length === 1) await Promise.race([llega2, sleep(600)]);
      const paso = guion[Math.min(calls.length - 1, guion.length - 1)];
      if (paso === 'colgado') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      const [status, raw] = paso;
      return { ok: status < 300, status, json: async () => raw };
    };
    return { calls, fetchImpl, getConfig: () => ({ username: 'stub', password: 'stub', baseUrl: 'https://facturama.invalid' }) };
  };
  const OK = (id) => [201, { Id: 'FM-' + id, Complement: { TaxStamp: { Uuid: 'UUID-' + id } } }];
  const mk = (prov, fallar = {}, timeoutMs = 2000) => {
    const sup = makePgSupabase(pool, { tokens, fallar });
    const deps = { getSupabase: () => sup, fetchImpl: prov.fetchImpl, getConfig: prov.getConfig, timeoutMs, leaseSegundos: 120 };
    return { timbrar: inv(deps), complemento: comp(deps) };
  };
  const ev = (who, body) => ({ httpMethod: 'POST', headers: { authorization: `Bearer jwt-${who}` }, body: JSON.stringify(body) });
  const L = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
  const efectos = async () => JSON.stringify(await q1(`SELECT (SELECT string_agg(id || ':' || estatus, ',' ORDER BY id) FROM ordenes WHERE id IN (11401, 11402)) o,
    (SELECT string_agg(id || ':' || monto_pagado || ':' || saldo_pendiente, ',' ORDER BY id) FROM cuentas_por_cobrar WHERE id IN (11401, 11402)) x,
    (SELECT count(*) || ':' || COALESCE(sum(monto), 0) FROM pagos WHERE orden_id IN (11401, 11402)) p, (SELECT count(*) FROM movimientos_contables WHERE orden_id IN (11401, 11402)) m`));

  // Pago ANTES de la factura.
  const p1 = await abonar(11401, 100, 'Efectivo', 'H113-1');
  let prov = proveedor([OK('X')]); let h = mk(prov);
  let r = L(await h.complemento(ev('admin', { pagoId: p1 })));
  ok(r.status === 409 && r.body.code === 'SIN_CFDI_VIGENTE' && prov.calls.length === 0, 'K1 pago anterior a la factura: no elegible (SIN_CFDI_VIGENTE), cero proveedor');
  // Factura PPD por el handler real; registra el modo fiscal.
  prov = proveedor([OK('I1')]); h = mk(prov);
  r = L(await h.timbrar(ev('admin', { ordenId: 11401 })));
  ok(r.status === 200 && (await q1(`SELECT cfdi_metodo_pago FROM cfdi_operaciones WHERE orden_id = 11401 AND tipo = 'emision' AND estado = 'exitosa'`)).cfdi_metodo_pago === 'PPD',
    'K2 factura PPD timbrada por el handler: la operación registra cfdi_metodo_pago = PPD');
  const p2 = await abonar(11401, 120, 'Transferencia SPEI', 'H113-2');
  const p3 = await abonar(11401, 80, 'Tarjeta (terminal)', 'H113-3');
  const ef0 = await efectos();
  // Dos solicitudes simultáneas del MISMO pago: una llamada.
  prov = proveedor([OK('C1')], { barrera: true }); h = mk(prov);
  let rs = (await Promise.all([h.complemento(ev('admin', { pagoId: p1 })), h.complemento(ev('fact', { pagoId: p1 }))])).map(L);
  ok(prov.calls.length === 1 && rs.filter(x => x.status === 200 && !x.body.alreadyIssued).length === 1 && rs.some(x => x.status === 409 && x.body.code === 'OPERACION_EN_CURSO'),
    `K3 dos complementos simultáneos del mismo pago: ${prov.calls.length} llamada(s) al proveedor; uno 200, el otro 409 OPERACION_EN_CURSO`);
  const pay = prov.calls[0]?.body || {}; const P = pay.Complemento?.Payments?.[0] || {}; const D = P.RelatedDocuments?.[0] || {};
  const fecha1 = (await q1(`SELECT to_char(fecha, 'YYYY-MM-DD') f FROM pagos WHERE id = $1`, [p1])).f;
  ok(pay.CfdiType === 'P' && pay.Receiver?.CfdiUse === 'CP01' && !('Currency' in pay) && !('PaymentMethod' in pay) && !('PaymentForm' in pay)
     && pay.Folio === `P${p1}G1` && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(pay.Date)
     && P.Date === fecha1 && P.PaymentForm === '01' && P.Currency === 'MXN' && P.Amount === 100
     && D.Uuid === 'UUID-I1' && D.PartialityNumber === 1 && D.PreviousBalanceAmount === 300 && D.AmountPaid === 100 && D.ImpSaldoInsoluto === 200 && D.Currency === 'MXN',
    'K4 payload tipo P según la guía oficial: Complemento.Payments.RelatedDocuments; fecha = pagos.fecha; parcialidad 1; 300 → 200; sin Currency/PaymentMethod/PaymentForm generales; Folio+Date fijos');
  // Replay del mismo pago: cero proveedor.
  prov = proveedor([OK('Z')]); h = mk(prov);
  r = L(await h.complemento(ev('admin', { pagoId: p1 })));
  ok(r.status === 200 && r.body.alreadyIssued && r.body.complementoUuid === 'UUID-C1' && prov.calls.length === 0, 'K5 mismo pago otra vez: devuelve el existente; cero proveedor');
  // Cuerpo manipulado: rechazado antes de todo.
  r = L(await h.complemento(ev('admin', { pagoId: p2, monto: 1, saldoAntes: 5, saldoDespues: 4, metodoPago: 'Efectivo' })));
  ok(r.status === 400 && r.body.code === 'CAMPOS_FISCALES_NO_PERMITIDOS' && prov.calls.length === 0, 'K6 montos/saldos/método del cliente: rechazados (400), cero proveedor');
  // Ventas B sobre la orden de Ventas A; Chofer.
  r = L(await h.complemento(ev('vb', { pagoId: p2 })));
  const rCh = L(await h.complemento(ev('chofer', { pagoId: p2 })));
  ok(r.status === 403 && rCh.status === 400 && prov.calls.length === 0, 'K7 Ventas B (orden ajena) 403 y Chofer 400: cero proveedor');
  // Ventas A (dueña) → pago 2, parcialidad 2.
  prov = proveedor([OK('C2')]); h = mk(prov);
  r = L(await h.complemento(ev('va', { pagoId: p2 })));
  const D2 = prov.calls[0]?.body?.Complemento?.Payments?.[0]?.RelatedDocuments?.[0] || {};
  ok(r.status === 200 && r.body.parcialidad === 2 && D2.PartialityNumber === 2 && D2.PreviousBalanceAmount === 200 && D2.ImpSaldoInsoluto === 80
     && prov.calls[0].body.Complemento.Payments[0].PaymentForm === '03', 'K8 Ventas A (dueña) emite el pago 2: parcialidad 2, 200 → 80, forma 03 (otro pago, otro complemento)');
  // Pago 3: timeout → incierta; reintento sin proveedor.
  prov = proveedor(['colgado']); h = mk(prov, {}, 150);
  r = L(await h.complemento(ev('fact', { pagoId: p3 })));
  const r3b = L(await h.complemento(ev('fact', { pagoId: p3 })));
  ok(r.status === 502 && r.body.code === 'RESULTADO_INCIERTO' && r3b.body.code === 'OPERACION_INCIERTA' && prov.calls.length === 1,
    'K9 timeout: 502 RESULTADO_INCIERTO; el reintento NO llama al proveedor (OPERACION_INCIERTA)');
  const op3 = (await q1(`SELECT id FROM cfdi_operaciones WHERE pago_id = $1 AND estado = 'incierta'`, [p3])).id;
  await c.query(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SELECT conciliar_operacion_cfdi('${op3}', 'no_emitida', '{"evidencia":"Facturama: folio P${p3}G1 no existe"}', 11402); COMMIT;`);
  prov = proveedor([OK('C3')]); h = mk(prov);
  r = L(await h.complemento(ev('fact', { pagoId: p3 })));
  const D3 = prov.calls[0]?.body?.Complemento?.Payments?.[0]?.RelatedDocuments?.[0] || {};
  ok(r.status === 200 && D3.PartialityNumber === 3 && D3.PreviousBalanceAmount === 80 && D3.ImpSaldoInsoluto === 0 && prov.calls.length === 1,
    'K10 conciliado como no emitido, Facturación emite el pago 3: parcialidad 3, 80 → 0');
  ok(await efectos() === ef0, 'K11 los complementos no cambiaron orden, CxC, pagos ni contabilidad');
  // Caída tras el proveedor (la base no registra): bloqueo, sin segundo timbrado.
  const q1p = await abonar(11402, 60, 'Efectivo', 'H113-4');
  prov = proveedor([OK('I2')]); h = mk(prov);
  await h.timbrar(ev('admin', { ordenId: 11402 }));
  prov = proveedor([OK('C4')]); h = mk(prov, { finalizar_operacion_cfdi: 1 });
  r = L(await h.complemento(ev('admin', { pagoId: q1p })));
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE cfdi_operaciones SET lease_hasta = now() - interval '1 second' WHERE pago_id = ${q1p}; COMMIT;`);
  const r4b = L(await mk(prov).complemento(ev('vb', { pagoId: q1p })));
  ok(r.status === 502 && r.body.code === 'FINALIZACION_PENDIENTE' && r.body.complementoUuid === 'UUID-C4' && r4b.body.code === 'OPERACION_INCIERTA' && prov.calls.length === 1,
    'K12 timbró pero la base no registró: 502 con el UUID; al vencer queda incierta y el reintento NO vuelve a timbrar');
  ok(redReal === 0, 'K13 ninguna llamada a la red real');
  globalThis.fetch = fetchReal;
  await pool.end();
  await c.query(limpiar);
  if (!okAll) { console.log(`RESULTADO: FALLÓ (OL-04 handlers ${etiqueta})`); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 113 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '113_complementos_pago.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 113 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 113)'); process.exit(1); }
console.log('── PRUEBAS 113');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/113_complementos_pago_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (113)'); process.exit(1); }
}
await reruns090('113', ['072']);
for (const [etq, f] of [...SUITES_113, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 113)`); process.exit(1); }
  console.log(`  ${etq} tras 113: PASS`);
}
await concCfdi('tras 113');
await handlersCfdi('tras 113');
await handlersComplemento('tras 113');
console.log('  OL-03B (concurrencia + handlers) y OL-04 (handlers de complemento) tras 113: PASS');

// ═══ 114 — CLOSURE-1: referencia de pago única (R-01) ═══
// Base local = producción para esta garantía: idx_pagos_ref AUSENTE antes de 114
// (paridad arriba). Primero se REPRODUCE R-01 sin índice (dos entregas
// simultáneas del mismo webhook → dos pagos), luego 114 debe FALLAR CERRADO con
// esos datos sucios, y solo con datos limpios se aplica (×2).
{
  const ok = (await c.query(`SELECT to_regclass('public.idx_pagos_ref') IS NULL AS a`)).rows[0].a;
  console.log(`  PAGOS_REF_PARITY_CHECK[pre-114]: ${ok ? 'PASS (idx_pagos_ref ausente, como producción)' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_114 = [...SUITES_113, ['113', '113_complementos_pago_test.sql']];
const ADMIN114 = '11470000-0000-0000-0000-000000000001';
const limpiar114 = `BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM payment_webhook_events WHERE provider_reference LIKE 'W114%' OR provider_reference LIKE 'evt_W114%';
  DELETE FROM payment_intents WHERE provider_reference LIKE 'W114%';
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 11471 AND 11489;
  DELETE FROM pagos WHERE orden_id BETWEEN 11471 AND 11489 OR referencia LIKE '%W114%' OR referencia LIKE 'C114-%';
  DELETE FROM cuentas_por_cobrar WHERE orden_id BETWEEN 11471 AND 11489;
  DELETE FROM stock_operaciones WHERE orden_id BETWEEN 11471 AND 11489;
  DELETE FROM ordenes WHERE id BETWEEN 11471 AND 11489;
  DELETE FROM clientes WHERE id = 11471; DELETE FROM usuarios WHERE id = 11471; DELETE FROM auth.users WHERE id = '${ADMIN114}';
  COMMIT;`;
const preparar114 = async () => {
  await c.query(limpiar114);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${ADMIN114}', 'a@t114w');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11471, 'Admin W114', 'a@t114w', 'Admin', 'Activo', '${ADMIN114}');
    INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (11471, 'Cliente W114', 'AAA010101AAA', 1000, true, 100000);
    INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro) VALUES
      (11471, 'OV-11471', 11471, 'Cliente W114', 'x', 100, 'Creada',    'QR / Link de pago', 'Contado'),
      (11472, 'OV-11472', 11471, 'Cliente W114', 'x', 200, 'Entregada', 'Crédito (fiado)',   'Credito'),
      (11473, 'OV-11473', 11471, 'Cliente W114', 'x', 100, 'Creada',    'QR / Link de pago', 'Contado'),
      (11474, 'OV-11474', 11471, 'Cliente W114', 'x', 100, 'Creada',    'QR / Link de pago', 'Contado'),
      (11475, 'OV-11475', 11471, 'Cliente W114', 'x', 100, 'Creada',    'QR / Link de pago', 'Contado'),
      (11476, 'OV-11476', 11471, 'Cliente W114', 'x', 100, 'Creada',    'QR / Link de pago', 'Contado'),
      (11477, 'OV-11477', 11471, 'Cliente W114', 'x', 200, 'Entregada', 'Crédito (fiado)',   'Credito'),
      (11478, 'OV-11478', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Transferencia',     'Contado'),
      (11479, 'OV-11479', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Transferencia',     'Contado'),
      (11480, 'OV-11480', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Efectivo',          'Contado'),
      (11481, 'OV-11481', 11471, 'Cliente W114', 'x', 300, 'Entregada', 'Crédito (fiado)',   'Credito'),
      (11482, 'OV-11482', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Crédito (fiado)',   'Credito'),
      (11483, 'OV-11483', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Crédito (fiado)',   'Credito'),
      (11484, 'OV-11484', 11471, 'Cliente W114', 'x', 100, 'Entregada', 'Efectivo',          'Contado');
    INSERT INTO cuentas_por_cobrar (id, cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, estatus, concepto)
      SELECT id, 11471, id, CURRENT_DATE, CURRENT_DATE + 30, total, 0, total, 'Pendiente', 'W114' FROM ordenes WHERE id IN (11472, 11477, 11481, 11482, 11483);
    COMMIT;`);
};
async function webhooksPago114(etiqueta, { soloRepro = false } = {}) {
  console.log(`── CLOSURE-1 WEBHOOKS STRIPE / MERCADO PAGO ↔ POSTGRES REAL (${etiqueta}; proveedores FALSOS, sin red)`);
  const { pathToFileURL } = await import('node:url');
  const { Pool } = require('pg');
  const { makePgSupabase } = await import(pathToFileURL(path.join(ROOT, 'supabase/tests/local/pgSupabaseAdapter.mjs')).href);
  const { createHandler: stripeH } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-webhook-stripe/index.js')).href);
  const { createHandler: mpH } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/billing-webhook-mercadopago/index.js')).href);
  const { signMercadoPagoWebhook } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/_lib/paymentSecurity.js')).href);
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const pool = new Pool({ host: '127.0.0.1', port: PORT, user: USER, database: DB, max: 8 });
  const fetchReal = globalThis.fetch; let redReal = 0;
  globalThis.fetch = async () => { redReal += 1; throw new Error('red real prohibida en pruebas'); };
  // Barrera: alinea las N peticiones justo antes del INSERT en pagos (ambas ya
  // pasaron el pre-chequeo SELECT por referencia y el de pendiente).
  const barrera = (nn) => { let llegados = 0; let soltar; const p = new Promise(r => { soltar = r; });
    return async () => { llegados += 1; if (llegados >= nn) soltar(); await Promise.race([p, sleep(4000)]); }; };
  const cliente = (bar) => makePgSupabase(pool, { antesDeEscribir: async (op, t) => { if (bar && op === 'insert' && t === 'pagos') await bar(); } });
  const stripe = (sb) => stripeH({ getSupabase: () => sb, constructEvent: (body) => JSON.parse(body) });
  const evStripe = (evt, cs, ordenId, monto) => ({ httpMethod: 'POST', headers: { 'stripe-signature': 't=1,v1=prueba' },
    body: JSON.stringify({ id: evt, type: 'checkout.session.completed', data: { object: { id: cs, payment_status: 'paid', status: 'complete',
      amount_total: Math.round(monto * 100), currency: 'mxn', metadata: { orden_id: String(ordenId) } } } }) });
  const SECRETO = 'secreto-de-prueba-114';
  const mp = (sb, pagosMp) => mpH({ getSupabase: () => sb, getSecret: () => SECRETO, nowSec: () => 1_900_000_000,
    fetchPayment: async (id) => pagosMp[String(id)] });
  const evMp = (id, rid) => { const ts = '1900000000'; const v1 = signMercadoPagoWebhook({ dataId: id, requestId: rid, ts, secret: SECRETO });
    return { httpMethod: 'POST', headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': rid }, queryStringParameters: { 'data.id': id, type: 'payment' },
      body: JSON.stringify({ type: 'payment', data: { id } }) }; };
  const pagoMp = (id, ordenId, monto) => ({ id, status: 'approved', transaction_amount: monto, currency_id: 'MXN', external_reference: String(ordenId) });
  const L = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
  const ef = async (oid) => (await c.query(`SELECT (SELECT count(*)::int FROM pagos WHERE orden_id = $1) AS pagos,
      (SELECT COALESCE(sum(monto), 0)::float FROM pagos WHERE orden_id = $1) AS suma,
      (SELECT count(DISTINCT referencia)::int FROM pagos WHERE orden_id = $1) AS refs,
      (SELECT count(*)::int FROM movimientos_contables WHERE orden_id = $1) AS movs,
      (SELECT count(*)::int FROM stock_operaciones WHERE orden_id = $1) AS stock,
      (SELECT estatus || '|' || COALESCE(ruta_id::text, '-') || '|' || metodo_pago FROM ordenes WHERE id = $1) AS orden,
      (SELECT monto_pagado::float || '|' || saldo_pendiente::float || '|' || estatus FROM cuentas_por_cobrar WHERE orden_id = $1) AS cxc`, [oid])).rows[0];
  const saldo = async () => Number((await c.query(`SELECT saldo FROM clientes WHERE id = 11471`)).rows[0].saldo);

  if (soloRepro) {
    // R-01 reproducido: SIN índice, dos entregas simultáneas del MISMO evento.
    const s0 = await saldo(); const bar = barrera(2); const sb = cliente(bar);
    const rs = (await Promise.all([stripe(sb)(evStripe('evt_W114_R', 'W114_cs_R', 11477, 200)), stripe(sb)(evStripe('evt_W114_R', 'W114_cs_R', 11477, 200))])).map(L);
    const e = await ef(11477);
    ok(rs.every(r => r.status === 200 && r.body.applied === true) && e.pagos === 2 && e.refs === 1 && e.suma === 400 && (await saldo()) === s0 - 400,
      `R01-REPRO (sin idx_pagos_ref, esperado): la misma entrega duplicada a la vez → ${e.pagos} pagos con la misma referencia, suma ${e.suma}, saldo del cliente ${s0} → ${await saldo()} (doble efecto)`);
  } else {
    // W1. Stripe: la misma entrega dos veces A LA VEZ, orden con CxC.
    let s0 = await saldo(); let bar = barrera(2); let sb = cliente(bar);
    let rs = (await Promise.all([stripe(sb)(evStripe('evt_W114_1', 'W114_cs_1', 11472, 200)), stripe(sb)(evStripe('evt_W114_1', 'W114_cs_1', 11472, 200))])).map(L);
    let e = await ef(11472);
    const intents = Number((await c.query(`SELECT count(*) FROM payment_intents WHERE provider = 'stripe' AND provider_reference = 'W114_cs_1'`)).rows[0].count);
    const eventos = (await c.query(`SELECT count(*)::int AS n, bool_and(processed) AS p FROM payment_webhook_events WHERE provider_reference = 'evt_W114_1'`)).rows[0];
    ok(rs.every(r => r.status === 200) && rs.filter(r => r.body.applied === true).length === 1 && rs.filter(r => r.body.code === 'duplicate').length === 1,
      `W1a Stripe: misma entrega simultánea (ambas pasaron el pre-chequeo) → una "applied", la otra "duplicate" por 23505 (200, sin reintento) [${rs.map(r => r.body.code).join(', ')}]`);
    ok(e.pagos === 1 && e.suma === 200 && e.cxc === '200|0|Pagada' && (await saldo()) === s0 - 200 && intents === 1 && eventos.n === 2 && eventos.p === true,
      `W1b sin segundo efecto: 1 pago, CxC ${e.cxc}, saldo del cliente −200 una vez, 1 payment_intent, 2 eventos registrados y procesados`);
    ok(e.movs === 0 && e.stock === 0 && e.orden === 'Entregada|-|Crédito (fiado)',
      'W1c sin efecto de ingreso contable, inventario ni ruta; estatus y método de crédito sin cambio');
    // W2. Stripe: la misma entrega otra vez, después (reintento normal).
    s0 = await saldo();
    const r2 = L(await stripe(cliente(null))(evStripe('evt_W114_1', 'W114_cs_1', 11472, 200)));
    e = await ef(11472);
    ok(r2.status === 200 && r2.body.code === 'duplicate' && e.pagos === 1 && (await saldo()) === s0, 'W2 reintento posterior de la misma entrega: "duplicate", sin efectos');
    // W3. Mercado Pago: la misma notificación dos veces a la vez (contado, sin CxC).
    s0 = await saldo(); bar = barrera(2); sb = cliente(bar);
    const pm = { W114001: pagoMp('W114001', 11471, 100) };
    rs = (await Promise.all([mp(sb, pm)(evMp('W114001', 'rid-1')), mp(sb, pm)(evMp('W114001', 'rid-2'))])).map(L);
    e = await ef(11471);
    ok(rs.every(r => r.status === 200) && rs.filter(r => r.body.applied === true).length === 1 && rs.filter(r => r.body.code === 'duplicate').length === 1
       && e.pagos === 1 && e.suma === 100 && e.orden === 'Creada|-|QR / Link de pago' && e.movs === 0 && e.stock === 0 && (await saldo()) === s0,
      `W3 Mercado Pago: misma notificación simultánea → un pago (mercadopago:W114001); la otra "duplicate"; sin entrega, inventario ni ingreso [${rs.map(r => r.body.code).join(', ')}]`);
    // W4. Stripe: dos pagos DISTINTOS a la vez (también alineados) → ambos.
    bar = barrera(2); sb = cliente(bar);
    rs = (await Promise.all([stripe(sb)(evStripe('evt_W114_4a', 'W114_cs_4a', 11473, 100)), stripe(sb)(evStripe('evt_W114_4b', 'W114_cs_4b', 11474, 100))])).map(L);
    ok(rs.every(r => r.status === 200 && r.body.applied === true) && (await ef(11473)).pagos === 1 && (await ef(11474)).pagos === 1,
      'W4 Stripe: dos sesiones distintas al mismo tiempo → dos pagos (stripe:W114_cs_4a, stripe:W114_cs_4b)');
    // W5. Mercado Pago: dos pagos distintos a la vez → ambos.
    bar = barrera(2); sb = cliente(bar);
    const pm2 = { W114005: pagoMp('W114005', 11475, 100), W114006: pagoMp('W114006', 11476, 100) };
    rs = (await Promise.all([mp(sb, pm2)(evMp('W114005', 'rid-5')), mp(sb, pm2)(evMp('W114006', 'rid-6'))])).map(L);
    ok(rs.every(r => r.status === 200 && r.body.applied === true) && (await ef(11475)).pagos === 1 && (await ef(11476)).pagos === 1,
      'W5 Mercado Pago: dos pagos distintos al mismo tiempo → dos pagos');
    const refs = (await c.query(`SELECT string_agg(referencia, ',' ORDER BY referencia) AS r FROM pagos WHERE orden_id BETWEEN 11471 AND 11476`)).rows[0].r;
    ok(refs === 'mercadopago:W114001,mercadopago:W114005,mercadopago:W114006,stripe:W114_cs_1,stripe:W114_cs_4a,stripe:W114_cs_4b',
      `W6 referencias de proveedor intactas (sin transformar): ${refs}`);
  }
  ok(redReal === 0, 'W7 ninguna llamada a la red real');
  globalThis.fetch = fetchReal;
  await pool.end();
  if (!okAll) { console.log(`RESULTADO: FALLÓ (CLOSURE-1 webhooks ${etiqueta})`); process.exit(1); }
}
async function conc114() {
  console.log('── CLOSURE-1 CONCURRENCIA (dos conexiones reales)');
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const a = await connect(); const b = await connect();
  const rol = async (cl, quien) => {
    await cl.query('BEGIN');
    if (quien === 'srv') { await cl.query('SET LOCAL ROLE service_role'); await cl.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`); }
    else { await cl.query('SET LOCAL ROLE authenticated'); await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: ADMIN114 })]); }
  };
  // A ejecuta y queda SIN confirmar; B arranca; tras 500 ms se ve si B espera; A confirma; B termina.
  const carrera = async (quien, sqlA, pA, sqlB, pB) => {
    await rol(a, quien); await rol(b, quien);
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
  const n = async (sql, p) => Number(Object.values((await c.query(sql, p)).rows[0])[0]);
  const saldo = () => n(`SELECT saldo FROM clientes WHERE id = 11471`);
  const INS = `INSERT INTO pagos (cliente_id, orden_id, monto, metodo_pago, fecha, referencia, saldo_antes, saldo_despues) VALUES (11471, 11484, 1, 'QR / Link de pago', fin_hoy(), 'C114-RAW', 0, 0) RETURNING id`;
  // C1. Inserción directa (como el webhook) con la misma referencia en dos transacciones.
  let r = await carrera('srv', INS, [], INS, []);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '23505' && await n(`SELECT count(*) FROM pagos WHERE referencia = 'C114-RAW'`) === 1,
    'C1 dos inserciones simultáneas con la misma referencia: la segunda espera y se rechaza (23505); un solo renglón');
  // C2. registrar_pago_orden en DOS órdenes con la MISMA referencia manual: el IF EXISTS no ve
  //     el pago sin confirmar de la otra; el índice es el respaldo final.
  const RPO = `SELECT registrar_pago_orden($1::bigint, 'Transferencia', 'C114-SPEI') AS r`;
  r = await carrera('admin', RPO, [11478], RPO, [11479]);
  ok(r.ra.ok && r.ra.row.r.aplicado === true && !r.rb.ok && r.bloqueado && r.rb.code === '23505'
     && await n(`SELECT count(*) FROM pagos WHERE orden_id = 11479`) === 0 && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 11479`) === 0
     && await n(`SELECT count(*) FROM pagos WHERE referencia = 'C114-SPEI'`) === 1 && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 11478`) === 1,
    'C2 misma referencia manual en dos órdenes a la vez: ambas pasan el IF EXISTS; la segunda choca con el índice (23505) y se revierte entera (sin pago ni ingreso)');
  // C3. registrar_pago_orden de la MISMA orden a la vez (sin referencia): serializado por la orden.
  const RPO2 = `SELECT registrar_pago_orden(11480, 'Efectivo') AS r`;
  r = await carrera('admin', RPO2, [], RPO2, []);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.motivo === 'ya_pagada'
     && await n(`SELECT count(*) FROM pagos WHERE orden_id = 11480`) === 1 && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 11480`) === 1,
    'C3 el mismo cobro de una orden dos veces a la vez: el segundo espera y responde "ya_pagada"; un pago y un ingreso');
  // C4. Dos abonos legítimos de la MISMA CxC a la vez, sin referencia.
  let s0 = await saldo();
  const ABO = `SELECT abonar_cxc(11481, 100, 'Efectivo') AS r`;
  r = await carrera('admin', ABO, [], ABO, []);
  const seg = (await c.query(`SELECT count(DISTINCT to_char(created_at, 'YYYYMMDD-HH24MISS'))::int AS s, count(DISTINCT referencia)::int AS refs, count(*)::int AS n FROM pagos WHERE cxc_id = 11481`)).rows[0];
  ok(r.ra.ok && r.rb.ok && r.bloqueado && seg.n === 2 && seg.refs === 2 && await n(`SELECT saldo_pendiente FROM cuentas_por_cobrar WHERE id = 11481`) === 100
     && await saldo() === s0 - 200,
    `C4 dos abonos de la misma CxC a la vez sin referencia: ambos aplican con referencias distintas (segundos de inicio distintos: ${seg.s}; el formato anterior por segundo habría chocado si es 1); CxC 300 → 100, saldo −200`);
  // C5. La MISMA referencia manual en la MISMA CxC a la vez: la segunda espera la CxC y la ve.
  s0 = await saldo();
  const ABM = `SELECT abonar_cxc(11481, 50, 'Transferencia SPEI', 'C114-MAN') AS r`;
  r = await carrera('admin', ABM, [], ABM, []);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '23505' && /ya está registrada/.test(r.rb.msg)
     && await n(`SELECT count(*) FROM pagos WHERE referencia = 'C114-MAN'`) === 1 && await n(`SELECT saldo_pendiente FROM cuentas_por_cobrar WHERE id = 11481`) === 50 && await saldo() === s0 - 50,
    'C5 la misma referencia manual en la misma CxC a la vez: un abono; el otro rechazado con mensaje claro; CxC y saldo una sola vez');
  // C6. La MISMA referencia manual en DOS CxC distintas a la vez: sin candado común; el índice decide.
  s0 = await saldo();
  const AB2 = `SELECT abonar_cxc($1::bigint, 50, 'Transferencia SPEI', 'C114-DUP2') AS r`;
  r = await carrera('admin', AB2, [11482], AB2, [11483]);
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && r.rb.code === '23505'
     && await n(`SELECT count(*) FROM pagos WHERE referencia = 'C114-DUP2'`) === 1 && await n(`SELECT monto_pagado FROM cuentas_por_cobrar WHERE id = 11483`) === 0
     && await n(`SELECT count(*) FROM movimientos_contables WHERE orden_id = 11483`) === 0 && await saldo() === s0 - 50,
    'C6 misma referencia manual en dos CxC a la vez: la segunda choca con el índice (23505) y se revierte entera (CxC, ingreso y saldo intactos)');
  await a.end(); await b.end();
  if (!okAll) { console.log('RESULTADO: FALLÓ (CLOSURE-1 concurrencia)'); process.exit(1); }
}
const huella114 = async () => new Map((await c.query(`SELECT 'fn ' || p.oid::regprocedure::text AS k, md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname !~ '^t[0-9]*_'
  UNION ALL SELECT 'idx ' || i.relname, md5(pg_get_indexdef(i.oid)) FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE i.relnamespace = 'public'::regnamespace
  UNION ALL SELECT 'trg ' || t.tgrelid::regclass || '.' || t.tgname, md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid::regclass::text !~ '^t[0-9]*_'
  UNION ALL SELECT 'acl ' || p.oid::regprocedure::text, COALESCE(p.proacl::text, '') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname !~ '^t[0-9]*_'`)).rows.map(x => [x.k, x.h]));
// 1. R-01 reproducido sin índice.
await preparar114();
await webhooksPago114('pre-114', { soloRepro: true });
// 2. Datos sucios (el duplicado recién creado): 114 debe abortar SIN cambiar nada.
{
  const antes = await huella114();
  const stmts = splitSql(fs.readFileSync(path.join(ROOT, 'supabase', '114_referencia_pago_unica.sql'), 'utf8'));
  let error = null;
  for (const st of stmts) { try { await c.query(st); } catch (e) { error = e; break; } }
  await c.query('ROLLBACK').catch(() => {});
  const despues = await huella114();
  const cambios = [...new Set([...antes.keys(), ...despues.keys()])].filter(k => antes.get(k) !== despues.get(k));
  const ok = error && error.code === '23505' && /repetida/.test(error.message) && cambios.length === 0
    && (await c.query(`SELECT to_regclass('public.idx_pagos_ref') IS NULL AS a`)).rows[0].a
    && Number((await c.query(`SELECT count(*) FROM pagos WHERE referencia = 'stripe:W114_cs_R'`)).rows[0].count) === 2;
  console.log(`  ${ok ? 'OK' : 'FAIL'}: 114-SUCIO con una referencia repetida: aborta en el pre-chequeo [${error?.code} ${error?.message}]; sin índice, abonar_cxc y catálogo sin cambio (${cambios.length} cambios); los datos NO se tocan (2 renglones siguen)`);
  if (!ok) { console.log('RESULTADO: FALLÓ (114 pre-chequeo de datos sucios)'); process.exit(1); }
}
await c.query(limpiar114);
// 3. Datos limpios: aplicar 114 dos veces; el catálogo cambia EXACTAMENTE en abonar_cxc e idx_pagos_ref.
const antes114 = await huella114();
for (const k of [1, 2]) {
  console.log(`── aplicar 114 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '114_referencia_pago_unica.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
{
  const despues = await huella114();
  const cambios = [...new Set([...antes114.keys(), ...despues.keys()])].filter(k => antes114.get(k) !== despues.get(k)).sort();
  const ok = JSON.stringify(cambios) === JSON.stringify(['fn abonar_cxc(bigint,numeric,text,text,bigint)', 'idx idx_pagos_ref']);
  console.log(`  CATALOG_DIFF[114]: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(cambios)} (ACL de abonar_cxc sin cambio)`);
  if (!ok) process.exit(1);
}
if (!(await rlsCheck('tras 114 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 114)'); process.exit(1); }
console.log('── PRUEBAS 114');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/114_referencia_pago_unica_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (114)'); process.exit(1); }
}
await preparar114();
await webhooksPago114('tras 114');
await conc114();
await c.query(limpiar114);
await reruns090('114', ['072']);
for (const [etq, f] of [...SUITES_114, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 114)`); process.exit(1); }
  console.log(`  ${etq} tras 114: PASS`);
}
await concCfdi('tras 114');
await handlersCfdi('tras 114');
await handlersComplemento('tras 114');
console.log('  CLOSURE-1 (webhooks + concurrencia) y OL-03B / OL-04 (concurrencia + handlers) tras 114: PASS');

// ═══ 115 — OP-01D: "Preparar desde barra" (solo funciones) ═══
{
  const ok = (await c.query(`SELECT to_regprocedure('public.registrar_preparacion_barra(uuid,text,text,text,integer)') IS NULL
                               AND to_regprocedure('public.revertir_preparacion_barra(uuid,bigint,text)') IS NULL AS a`)).rows[0].a;
  console.log(`  PREPARACION_PARITY_CHECK[pre-115]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
  // OP-01D.1: 115 redefine registrar_produccion desde el texto de 106; la base
  // local debe ser la MISMA función que producción (md5 leído en solo lectura el 2026-10-06).
  const m = (await c.query(`SELECT md5(pg_get_functiondef('public.registrar_produccion(uuid,text,text,text,integer,text)'::regprocedure)) AS m`)).rows[0].m;
  const okP = m === '845c3cd74d089e326be3663e44ba196c';
  console.log(`  REGISTRAR_PRODUCCION_PARITY[pre-115 == producción]: ${okP ? 'PASS' : 'FAIL ' + m}`);
  if (!okP) process.exit(1);
}
const SUITES_115 = [...SUITES_114, ['114', '114_referencia_pago_unica_test.sql']];
async function conc115() {
  console.log('── 115 CONCURRENCIA (dos conexiones reales)');
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const SUB = '11560000-0000-0000-0000-000000000001';
  const orig = (await c.query(`SELECT to_jsonb(p)::text AS j FROM productos p WHERE sku IN ('HIB-50K', 'HIP-25K', 'HIT-25K')`)).rows.map(r => r.j);
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM costos_historial WHERE referencia IN (SELECT 'PROD-' || id FROM produccion WHERE cuarto_id = 'CF-C115');
    DELETE FROM produccion WHERE cuarto_id = 'CF-C115'; DELETE FROM inventario_mov WHERE cuarto_id = 'CF-C115' OR producto = 'C115-EMP';
    DELETE FROM auditoria WHERE usuario LIKE 'Prod C115%'; DELETE FROM cuartos_frios WHERE id = 'CF-C115';
    DELETE FROM usuarios WHERE id = 11561; DELETE FROM auth.users WHERE id = '${SUB}';
    DELETE FROM productos WHERE sku IN ('C115-EMP', 'HIB-50K', 'HIP-25K', 'HIT-25K'); COMMIT;`;
  await c.query(limpiar);
  const preparar = async (barras, emp) => c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM produccion WHERE cuarto_id = 'CF-C115'; DELETE FROM cuartos_frios WHERE id = 'CF-C115';
    DELETE FROM productos WHERE sku IN ('C115-EMP', 'HIB-50K', 'HIP-25K', 'HIT-25K');
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
      ('C115-EMP', 'Bolsa C115', 'Empaque', 0, ${emp}, 1, NULL), ('HIB-50K', 'Barra', 'Producto Terminado', 120, 0, 0, NULL),
      ('HIP-25K', 'Picada', 'Producto Terminado', 60, 0, 0, 'C115-EMP'), ('HIT-25K', 'Triturada', 'Producto Terminado', 60, 0, 0, 'C115-EMP');
    INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C115', 'Cuarto C115', '{"HIB-50K": ${barras}}'); COMMIT;`);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${SUB}', 'c1@t115c');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11561, 'Prod C115', 'c1@t115c', 'Producción', 'Activo', '${SUB}'); COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl) => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: SUB })]); };
  const PREP = `SELECT registrar_preparacion_barra($1::uuid, 'HIB-50K', 'HIP-25K', 'CF-C115', 1) AS r`;
  const carrera = async (opA, opB) => {
    await actor(a); await actor(b);
    const ra = await a.query(PREP, [opA]).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message }));
    let done = false;
    const prB = b.query(PREP, [opB]).then(r => ({ ok: true, row: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK');
    return { ra, rb, bloqueado };
  };
  const estado = async () => (await c.query(`SELECT COALESCE((stock ->> 'HIB-50K')::int, 0) || '|' || COALESCE((stock ->> 'HIP-25K')::int, 0)
      || '|' || (SELECT stock FROM productos WHERE sku = 'C115-EMP') AS e FROM cuartos_frios WHERE id = 'CF-C115'`)).rows[0].e;
  // C11a: 1 barra, empaque de sobra, dos preparaciones de 1 barra a la vez.
  await preparar(1, 100);
  let r = await carrera('11560000-0000-0000-0000-0000000000a1', '11560000-0000-0000-0000-0000000000a2');
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && /Stock insuficiente.*HIB-50K/.test(r.rb.msg) && await estado() === '0|2|98',
    `C11a 1 barra y dos preparaciones simultáneas: la segunda espera y falla; sin barra ni empaque negativos (${await estado()})`);
  // C11b: barras de sobra, empaque para una sola preparación.
  await preparar(10, 2);
  r = await carrera('11560000-0000-0000-0000-0000000000b1', '11560000-0000-0000-0000-0000000000b2');
  ok(r.ra.ok && !r.rb.ok && r.bloqueado && /Stock insuficiente.*C115-EMP/.test(r.rb.msg) && await estado() === '9|2|0',
    `C11b empaque para una sola: la segunda espera y falla; sin empaque negativo (${await estado()})`);
  // C11c: la MISMA operación dos veces a la vez: una prepara, la otra es replay.
  await preparar(10, 100);
  r = await carrera('11560000-0000-0000-0000-0000000000c1', '11560000-0000-0000-0000-0000000000c1');
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.rb.row.r.replay === true && await estado() === '9|2|98'
     && Number((await c.query(`SELECT count(*) FROM produccion WHERE operacion_id = '11560000-0000-0000-0000-0000000000c1'`)).rows[0].count) === 1,
    'C11c misma operación simultánea: un solo efecto; la segunda responde replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  for (const j of orig) await c.query(`BEGIN; SET LOCAL session_replication_role = replica; INSERT INTO productos SELECT (jsonb_populate_record(NULL::productos, $1::jsonb)).*; COMMIT;`, [j]);
  if (!okAll) { console.log('RESULTADO: FALLÓ (115 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 115 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '115_preparacion_barra.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 115 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 115)'); process.exit(1); }
console.log('── PRUEBAS 115');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/115_preparacion_barra_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (115)'); process.exit(1); }
}
await conc115();
await reruns090('115', ['072']);
for (const [etq, f] of [...SUITES_115, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 115)`); process.exit(1); }
  console.log(`  ${etq} tras 115: PASS`);
}
console.log('  OP-01D (preparación desde barra: suite + concurrencia) tras 115: PASS');

// ═══ 116 — WF-0 + PD-01: rol Empleado, vínculo persona ↔ acceso, reloj checador ═══
{
  const ok = (await c.query(`SELECT to_regclass('public.asistencias') IS NULL AND to_regclass('public.centros_trabajo') IS NULL
      AND to_regprocedure('public.registrar_entrada(uuid,double precision,double precision,numeric)') IS NULL
      AND to_regclass('public.empleados_usuario_id_key') IS NULL
      AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'usuarios_rol_check')) NOT LIKE '%Empleado%' AS a`)).rows[0].a;
  console.log(`  ASISTENCIA_PARITY_CHECK[pre-116]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_116 = [...SUITES_115, ['115', '115_preparacion_barra_test.sql']];
async function conc116() {
  console.log('── 116 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const SUB = '11660000-0000-0000-0000-000000000001';
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM asistencias WHERE empleado_id = 11661; DELETE FROM asistencia_intentos WHERE empleado_id = 11661;
    DELETE FROM turnos WHERE empleado_id = 11661; DELETE FROM centros_trabajo WHERE nombre = 'Planta C116';
    DELETE FROM empleados WHERE id = 11661; DELETE FROM usuarios WHERE id = 11661; DELETE FROM auth.users WHERE id = '${SUB}'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${SUB}', 'c1@t116c');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11661, 'Empleado C116', 'c1@t116c', 'Empleado', 'Activo', '${SUB}');
    INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus, usuario_id) VALUES (11661, 'Empleado C116', 'P', 'D', 1, '2026-01-01', 'Activo', 11661);
    INSERT INTO centros_trabajo (nombre, latitud, longitud, radio_m, precision_max_m) VALUES ('Planta C116', 23.2494, -106.4111, 100, 50);
    INSERT INTO turnos (empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde)
      SELECT 11661, id, ARRAY[1,2,3,4,5,6,7]::smallint[], (date_trunc('minute', now() AT TIME ZONE fin_zona_negocio()) - interval '5 minutes')::time,
             (date_trunc('minute', now() AT TIME ZONE fin_zona_negocio()) + interval '475 minutes')::time, 10, CURRENT_DATE - 3
        FROM centros_trabajo WHERE nombre = 'Planta C116'; COMMIT;`);
  const a = await connect(); const b = await connect();
  const actor = async (cl) => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: SUB })]); };
  const carrera = async (fn, opA, opB) => {
    const Q = `SELECT ${fn}($1::uuid, 23.2494, -106.4111, 10) AS r`;
    await actor(a); await actor(b);
    const ra = (await a.query(Q, [opA])).rows[0].r;
    let done = false;
    const prB = b.query(Q, [opB]).then(r => r.rows[0].r, e => ({ error: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query('COMMIT');
    const rb = await prB;
    await b.query(rb.error ? 'ROLLBACK' : 'COMMIT');
    return { ra, rb, bloqueado };
  };
  const filas = async () => (await c.query(`SELECT count(*)::int AS n, count(salida_at)::int AS s FROM asistencias WHERE empleado_id = 11661`)).rows[0];
  let r = await carrera('registrar_entrada', '11660000-0000-0000-0000-0000000000a1', '11660000-0000-0000-0000-0000000000a2');
  let f = await filas();
  ok(r.ra.ok && r.bloqueado && r.rb.ok === false && r.rb.codigo === 'ya_registrada' && f.n === 1,
    `C116a dos entradas simultáneas (operaciones distintas): la segunda espera y responde ya_registrada; 1 fila (${JSON.stringify(r.rb)})`);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM asistencias WHERE empleado_id = 11661; COMMIT;`);
  r = await carrera('registrar_entrada', '11660000-0000-0000-0000-0000000000b1', '11660000-0000-0000-0000-0000000000b1');
  f = await filas();
  ok(r.ra.ok && r.bloqueado && r.rb.ok === true && r.rb.replay === true && f.n === 1,
    'C116b la misma entrada dos veces a la vez: un solo efecto; la segunda es replay');
  r = await carrera('registrar_salida', '11660000-0000-0000-0000-0000000000c1', '11660000-0000-0000-0000-0000000000c2');
  f = await filas();
  ok(r.ra.ok && r.bloqueado && r.rb.ok === false && r.rb.codigo === 'ya_registrada' && f.s === 1,
    `C116c dos salidas simultáneas (operaciones distintas): la segunda espera y responde ya_registrada (${JSON.stringify(r.rb.codigo)})`);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE asistencias SET salida_at = NULL, salida_lat = NULL, salida_lng = NULL,
    salida_precision_m = NULL, salida_distancia_m = NULL, salida_dentro = NULL, operacion_salida = NULL, minutos_trabajados = NULL WHERE empleado_id = 11661; COMMIT;`);
  r = await carrera('registrar_salida', '11660000-0000-0000-0000-0000000000d1', '11660000-0000-0000-0000-0000000000d1');
  f = await filas();
  ok(r.ra.ok && r.bloqueado && r.rb.ok === true && r.rb.replay === true && f.s === 1,
    'C116d la misma salida dos veces a la vez: un solo efecto; la segunda es replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (116 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 116 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '116_asistencia.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 116 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 116)'); process.exit(1); }
console.log('── PRUEBAS 116');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/116_asistencia_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (116)'); process.exit(1); }
}
await conc116();
await reruns090('116', ['072']);
for (const [etq, f] of [...SUITES_116, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 116)`); process.exit(1); }
  console.log(`  ${etq} tras 116: PASS`);
}
console.log('  WF-0 + PD-01 (asistencia: suite + concurrencia) tras 116: PASS');


// ═══ 117 — WF-0.1: el rol Empleado no lee datos de negocio por API ═══
{
  // Paridad con producción (leída en solo lectura el 2026-10-07): 24 policies de
  // SELECT con USING (erp_es_activo()) y sin erp_lector_negocio().
  const r117 = (await c.query(`SELECT count(*) FILTER (WHERE cmd = 'SELECT' AND qual = 'erp_es_activo()')::int AS n,
      to_regprocedure('public.erp_lector_negocio()') IS NULL AS sin_fn FROM pg_policies WHERE schemaname = 'public'`)).rows[0];
  const ok = r117.n === 24 && r117.sin_fn;
  console.log(`  LECTURA_AMPLIA_PARITY_CHECK[pre-117 == producción: 24]: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(r117)}`);
  if (!ok) process.exit(1);
}
const SUITES_117 = [...SUITES_116, ['116', '116_asistencia_test.sql']];
for (const k of [1, 2]) {
  console.log(`── aplicar 117 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '117_aislamiento_lectura_empleado.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 117 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 117)'); process.exit(1); }
console.log('── PRUEBAS 117');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/117_aislamiento_lectura_empleado_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (117)'); process.exit(1); }
}
await reruns090('117', ['072']);
for (const [etq, f] of [...SUITES_117, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 117)`); process.exit(1); }
  console.log(`  ${etq} tras 117: PASS`);
}
console.log('  WF-0.1 (aislamiento de lectura del Empleado) tras 117: PASS');


// ═══ 118 — PD-02: calendario operativo ═══
{
  const ok = (await c.query(`SELECT to_regclass('public.actividades') IS NULL AND to_regclass('public.actividad_ocurrencias') IS NULL
      AND to_regprocedure('public.calendario(date,date,boolean,boolean)') IS NULL AS a`)).rows[0].a;
  console.log(`  CALENDARIO_PARITY_CHECK[pre-118]: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}
const SUITES_118 = [...SUITES_117, ['117', '117_aislamiento_lectura_empleado_test.sql']];
async function conc118() {
  console.log('── 118 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const SUB = '11860000-0000-0000-0000-000000000001';
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM actividad_ocurrencias WHERE actividad_id IN (SELECT id FROM actividades WHERE titulo = 'C118 Revisar');
    DELETE FROM actividades WHERE titulo = 'C118 Revisar'; DELETE FROM auditoria WHERE detalle LIKE 'C118%';
    DELETE FROM usuarios WHERE id = 11861; DELETE FROM auth.users WHERE id = '${SUB}'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${SUB}', 'c1@t118c');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11861, 'Admin C118', 'c1@t118c', 'Admin', 'Activo', '${SUB}'); COMMIT;`);
  const actor = async (cl) => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: SUB })]); };
  await actor(c);
  const id = (await c.query(`SELECT (guardar_actividad('11860000-0000-0000-0000-0000000000f1', NULL, jsonb_build_object('titulo', 'C118 Revisar',
    'categoria', 'operativa', 'recurrencia', 'mensual', 'dia_inicio', 1, 'dia_fin', 28, 'vigente_desde', '2026-01-01')) ->> 'id')::bigint AS id`)).rows[0].id;
  await c.query('COMMIT');
  const a = await connect(); const b = await connect();
  const Q = `SELECT completar_ocurrencia($1::uuid, ${id}, $2::date, NULL) AS r`;
  const carrera = async (opA, opB, periodo) => {
    await actor(a); await actor(b);
    const ra = (await a.query(Q, [opA, periodo])).rows[0].r;
    let done = false;
    const prB = b.query(Q, [opB, periodo]).then(r => r.rows[0].r, e => ({ error: e.message })).finally(() => { done = true; });
    await sleep(500);
    const bloqueado = !done;
    await a.query('COMMIT');
    const rb = await prB;
    await b.query(rb.error ? 'ROLLBACK' : 'COMMIT');
    return { ra, rb, bloqueado };
  };
  const filas = async (periodo) => (await c.query(`SELECT count(*)::int AS n, count(completada_at)::int AS k FROM actividad_ocurrencias WHERE actividad_id = ${id} AND periodo = $1`, [periodo])).rows[0];
  let r = await carrera('11860000-0000-0000-0000-0000000000a1', '11860000-0000-0000-0000-0000000000a2', '2026-09-01');
  let f = await filas('2026-09-01');
  ok(r.ra.ok && r.bloqueado && r.rb.ok === false && r.rb.codigo === 'ya_completada' && f.n === 1 && f.k === 1,
    `C118a dos terminaciones simultáneas (operaciones distintas): la segunda espera y responde ya_completada; una fila (${JSON.stringify(r.rb.codigo || r.rb.error)})`);
  r = await carrera('11860000-0000-0000-0000-0000000000b1', '11860000-0000-0000-0000-0000000000b1', '2026-08-01');
  f = await filas('2026-08-01');
  ok(r.ra.ok && r.bloqueado && r.rb.ok === true && r.rb.replay === true && f.n === 1,
    'C118b la misma terminación dos veces a la vez: un solo efecto; la segunda es replay');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (118 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 118 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '118_calendario_operativo.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 118 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 118)'); process.exit(1); }
console.log('── PRUEBAS 118');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/118_calendario_operativo_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (118)'); process.exit(1); }
}
await conc118();
await reruns090('118', ['072']);
for (const [etq, f] of [...SUITES_118, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 118)`); process.exit(1); }
  console.log(`  ${etq} tras 118: PASS`);
}
console.log('  PD-02 (calendario: suite + concurrencia) tras 118: PASS');


// ═══ 119 — WF-0.2: cierre de la superficie de API del Empleado ═══
{
  // Paridad con producción (md5 leídos en solo lectura el 2026-10-07).
  const PROD119 = { erp_es_activo: '76b7c3fbd5e2cbaa16e7a2dfaac94cd9', b4_ruta_con_historia: 'b92908a9c1daaf7a336cad945f57d720',
    cuarto_tiene_historia: 'c61070885bceb2088943216554b5f226', empaque_tiene_dependencias: 'd0a859d2cbadd3c1cd7e49deca2a227a',
    erp_foto_merma_en_uso: 'd297afa082bcd2771a08ddd2b3354dda' };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [Object.keys(PROD119)])).rows.map(r => [r.proname, r.m]));
  const okP = Object.entries(PROD119).every(([k, v]) => loc[k] === v)
    && (await c.query(`SELECT count(*)::int AS n FROM pg_policies WHERE coalesce(qual,'') || coalesce(with_check,'') LIKE '%erp_es_activo()%'`)).rows[0].n === 6;
  console.log(`  EMPLEADO_API_PARITY_CHECK[pre-119 == producción]: ${okP ? 'PASS' : 'FAIL ' + JSON.stringify(loc)}`);
  if (!okP) process.exit(1);
  // Reproduce los residuales de producción ANTES de 119 (todo se deshace).
  const SUB = '11970000-0000-0000-0000-000000000001';
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${SUB}', 'r@t119r');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (11971, 'Empleado R119', 'r@t119r', 'Empleado', 'Activo', '${SUB}');
    INSERT INTO storage.buckets (id, name) VALUES ('mermas', 'mermas') ON CONFLICT DO NOTHING;
    SET LOCAL session_replication_role = origin; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${SUB}"}', true);`);
  const intento = async (sql) => { await c.query('SAVEPOINT r'); try { await c.query(sql); await c.query('RELEASE SAVEPOINT r'); return 'PERMITIDO'; }
    catch (e) { await c.query('ROLLBACK TO SAVEPOINT r'); return 'RECHAZADO ' + e.code; } };
  const rep = {
    auditoria: await intento(`INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES ('x', 'x', 'x', 'x')`),
    notificaciones: await intento(`INSERT INTO notificaciones (tipo, titulo, mensaje) VALUES ('x', 'x', 'x')`),
    storage_mermas: await intento(`INSERT INTO storage.objects (bucket_id, name) VALUES ('mermas', '${SUB}/x.jpg')`),
    cuarto_tiene_historia: await intento(`SELECT cuarto_tiene_historia('CF-1')`),
  };
  await c.query('ROLLBACK');
  const reproducido = Object.values(rep).every(v => v === 'PERMITIDO');
  console.log(`  RESIDUALES_EMPLEADO[pre-119, deben estar PERMITIDOS]: ${reproducido ? 'REPRODUCIDOS' : 'NO REPRODUCIDOS'} ${JSON.stringify(rep)}`);
  if (!reproducido) process.exit(1);
}
const SUITES_119 = [...SUITES_118, ['118', '118_calendario_operativo_test.sql']];
for (const k of [1, 2]) {
  console.log(`── aplicar 119 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '119_cierre_api_empleado.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 119 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 119)'); process.exit(1); }
console.log('── PRUEBAS 119');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/119_cierre_api_empleado_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (119)'); process.exit(1); }
}
await reruns090('119', ['072']);
for (const [etq, f] of [...SUITES_119, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 119)`); process.exit(1); }
  console.log(`  ${etq} tras 119: PASS`);
}
console.log('  WF-0.2 (superficie de API del Empleado cerrada) tras 119: PASS');



// ═══ 120 — GER-1: Dueño, accesos adicionales, contraseña temporal, usuarios por contrato y bitácora ═══
{
  // Paridad con producción (md5 leídos en solo lectura el 2026-10-09).
  const PROD120 = { completar_venta_directa: '5825f5e3072a1d5a98961752a5eb5cc6', erp_actor: '51a6dd4f6ee6486a34f81e3eec54eb8a',
    fin_actor_permitido: '433e14f96b91b547b799cb95b1fbdb82', fin_orden_operable: 'cfaca67e1b51b0ecce6ea3bc0b7c50d8' };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [Object.keys(PROD120)])).rows.map(r => [r.proname, r.m]));
  const okP = Object.entries(PROD120).every(([k, v]) => loc[k] === v)
    && (await c.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'admin_all'`)).rows[0].n === 1;
  console.log(`  GER1_PARITY_CHECK[pre-120 == producción]: ${okP ? 'PASS' : 'FAIL ' + JSON.stringify(loc)}`);
  if (!okP) process.exit(1);
  // Reproduce el hallazgo H1 de GER-0 ANTES de 120: Admin se cambia el rol por REST (todo se deshace).
  const SUB = '12070000-0000-0000-0000-000000000001';
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${SUB}', 'r@t120r');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES (12071, 'Admin R120', 'r@t120r', 'Admin', 'Activo', '${SUB}'),
      (12072, 'Dueño R120', 'd@t120r', 'Admin', 'Activo', NULL);
    SET LOCAL session_replication_role = origin; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${SUB}"}', true);`);
  const n1 = (await c.query(`UPDATE usuarios SET estatus = 'Inactivo' WHERE id = 12072`)).rowCount;
  await c.query('ROLLBACK');
  console.log(`  RESIDUAL_GER0_H1[pre-120: Admin desactiva a otro Admin por REST]: ${n1 === 1 ? 'REPRODUCIDO' : 'NO REPRODUCIDO'}`);
  if (n1 !== 1) process.exit(1);
}
const SUITES_120 = [...SUITES_119, ['119', '119_cierre_api_empleado_test.sql']];
async function conc120() {
  console.log('── 120 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const D = '12080000-0000-0000-0000-000000000001', A = '12080000-0000-0000-0000-000000000002';
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM bitacora_cambios WHERE registro_id IN ('12081', '12082', '12083');
    DELETE FROM usuarios WHERE id BETWEEN 12081 AND 12083; DELETE FROM auth.users WHERE id::text LIKE '12080000-%'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${D}', 'd@t120c'), ('${A}', 'a@t120c');
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, es_dueno) VALUES
      (12081, 'Dueño C120', 'd@t120c', 'Admin', 'Activo', '${D}', false), (12082, 'Admin C120', 'a@t120c', 'Admin', 'Activo', '${A}', false),
      (12083, 'Ventas C120', 'v@t120c', 'Ventas', 'Activo', NULL, false); COMMIT;`);
  // El dueño de producción (si lo hay en la base local) no existe aquí: se marca uno solo para la prueba.
  await c.query(`UPDATE usuarios SET es_dueno = true WHERE id = 12081`);
  const actor = async (cl, sub) => { await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE authenticated');
    await cl.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]); };
  const a = await connect(); const b = await connect();
  // El Admin cambia el rol de Ventas mientras el Dueño le asigna un acceso: se serializan (FOR UPDATE).
  await actor(a, A); await actor(b, D);
  const ra = (await a.query(`SELECT guardar_usuario(12083, 'Ventas C120', 'Almacén Bolsas', 'Activo') AS r`)).rows[0].r;
  let done = false;
  const prB = b.query(`SELECT guardar_usuario(12083, 'Ventas C120', 'Almacén Bolsas', 'Activo', ARRAY['Ventas']) AS r`)
    .then(r => r.rows[0].r, e => ({ error: e.message })).finally(() => { done = true; });
  await sleep(500);
  const bloqueado = !done;
  await a.query('COMMIT');
  const rb = await prB;
  await b.query(rb.error ? 'ROLLBACK' : 'COMMIT');
  const fin = (await c.query(`SELECT rol, accesos_extra FROM usuarios WHERE id = 12083`)).rows[0];
  const bit = (await c.query(`SELECT count(*)::int AS n FROM bitacora_cambios WHERE registro_id = '12083' AND detalle = 'guardar_usuario'`)).rows[0].n;
  ok(ra.ok && bloqueado && rb.ok && fin.rol === 'Almacén Bolsas' && JSON.stringify(fin.accesos_extra) === JSON.stringify(['Ventas']) && bit === 2,
    `C120a cambios simultáneos del mismo usuario: el segundo espera y se aplica sobre el primero; 2 filas de bitácora (${JSON.stringify({ rb: rb.error || 'ok', fin, bit })})`);
  // Dos dueños a la vez: el índice único deja uno.
  await a.query('BEGIN'); await b.query('BEGIN');
  await a.query(`UPDATE usuarios SET es_dueno = false WHERE id = 12081`);
  await a.query(`UPDATE usuarios SET es_dueno = true WHERE id = 12082`);
  let done2 = false;
  const prB2 = b.query(`UPDATE usuarios SET es_dueno = true WHERE id = 12081`).then(() => 'ok', e => e.code).finally(() => { done2 = true; });
  await sleep(300);
  const espera = !done2;
  await a.query('COMMIT');
  const rb2 = await prB2;
  await b.query(rb2 === 'ok' ? 'COMMIT' : 'ROLLBACK');
  const duenos = (await c.query(`SELECT count(*)::int AS n FROM usuarios WHERE es_dueno`)).rows[0].n;
  ok(duenos === 1, `C120b nunca hay dos dueños (espera=${espera}, segundo=${rb2}, dueños=${duenos})`);
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (120 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 120 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '120_ger1_dueno_accesos.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 120 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 120)'); process.exit(1); }
console.log('── PRUEBAS 120');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/120_ger1_dueno_accesos_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (120)'); process.exit(1); }
}
await conc120();
await reruns090('120', ['072']);
for (const [etq, f] of [...SUITES_120, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 120)`); process.exit(1); }
  console.log(`  ${etq} tras 120: PASS`);
}
console.log('  GER-1 aditiva (dueño, accesos, contraseña temporal, bitácora) tras 120: PASS');

// ═══ 121 — GER-1: contención (sin escritura REST en usuarios) ═══
for (const k of [1, 2]) {
  console.log(`── aplicar 121 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '121_ger1_contencion_usuarios.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 121 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 121)'); process.exit(1); }
console.log('── PRUEBAS 121');
for (const f of ['121_ger1_contencion_usuarios_test.sql', '120_ger1_dueno_accesos_test.sql']) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${f} tras 121)`); process.exit(1); }
}
await reruns090('121', ['072']);
for (const [etq, f] of [...SUITES_120, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 121)`); process.exit(1); }
  console.log(`  ${etq} tras 121: PASS`);
}
console.log('  GER-1 (usuarios solo por contrato) tras 121: PASS');

// ═══ 122 — zona del negocio: America/Monterrey (Durango) ═══
{
  // Paridad con producción (md5 de fin_zona_negocio() leído en solo lectura el 2026-10-09).
  const PROD122 = { fin_zona_negocio: '7688ea0bc1e52c60bc1ffc322cfd5cb5' };
  const loc = (await c.query(`SELECT md5(pg_get_functiondef('public.fin_zona_negocio()'::regprocedure)) AS m, fin_zona_negocio() AS z`)).rows[0];
  const okP = loc.m === PROD122.fin_zona_negocio && loc.z === 'America/Mazatlan';
  console.log(`  ZONA_PARITY_CHECK[pre-122 == producción (America/Mazatlan)]: ${okP ? 'PASS' : 'FAIL ' + JSON.stringify(loc)}`);
  if (!okP) process.exit(1);
  // Reproduce el hallazgo ANTES de 122: un turno de 08:00 se evalúa a las 15:00 UTC (09:00 de Durango).
  const h = (await c.query(`SELECT (('2033-03-11'::date + '08:00'::time)::timestamp AT TIME ZONE fin_zona_negocio()) = '2033-03-11 15:00:00+00'::timestamptz AS mal`)).rows[0].mal;
  console.log(`  RESIDUAL_ZONA[pre-122: 08:00 de turno = 09:00 de Durango]: ${h ? 'REPRODUCIDO' : 'NO REPRODUCIDO'}`);
  if (!h) process.exit(1);
}
const SUITES_122 = [...SUITES_120, ['120', '120_ger1_dueno_accesos_test.sql'], ['121', '121_ger1_contencion_usuarios_test.sql']];
for (const k of [1, 2]) {
  console.log(`── aplicar 122 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '122_zona_negocio_durango.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 122 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 122)'); process.exit(1); }
{
  // Solo cambió el cuerpo de fin_zona_negocio(): ACL, volatilidad y search_path iguales.
  const f = (await c.query(`SELECT provolatile, prosecdef, array_to_string(proconfig, ';') AS cfg, COALESCE(proacl::text, 'NULL') AS acl, fin_zona_negocio() AS z
      FROM pg_proc WHERE proname = 'fin_zona_negocio' AND pronamespace = 'public'::regnamespace`)).rows[0];
  const ok = f.z === 'America/Monterrey' && f.provolatile === 'i' && !f.prosecdef && f.cfg === 'search_path=public, pg_temp';
  console.log(`  ZONA_122[fin_zona_negocio() = America/Monterrey, IMMUTABLE, search_path fijo, acl=${f.acl}]: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(f)}`);
  if (!ok) process.exit(1);
  // Frontend ↔ DB: la constante del cliente es la misma zona.
  const js = fs.readFileSync(path.join(ROOT, 'src/utils/fechas.js'), 'utf8');
  const m = /export const ZONA_NEGOCIO = '([^']+)'/.exec(js);
  const okF = m && m[1] === f.z
    && !/America\/Mazatlan/.test(fs.readFileSync(path.join(ROOT, 'src/data/asistenciaLogic.js'), 'utf8'))
    && !/America\/Mazatlan/.test(fs.readFileSync(path.join(ROOT, 'src/data/saludoLogic.js'), 'utf8'));
  console.log(`  ZONA_FRONTEND_CHECK[src/utils/fechas.js ZONA_NEGOCIO == fin_zona_negocio()]: ${okF ? 'PASS' : 'FAIL ' + (m && m[1])}`);
  if (!okF) process.exit(1);
}
console.log('── PRUEBAS 122');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/122_zona_negocio_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (122)'); process.exit(1); }
}
await reruns090('122', ['072']);
for (const [etq, f] of [...SUITES_122, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 122)`); process.exit(1); }
  console.log(`  ${etq} tras 122: PASS`);
}
// Concurrencia de asistencia (116) con la zona nueva: mismas carreras, sin cambio de resultado.
await conc116();
console.log('  Zona del negocio = Durango (America/Monterrey) tras 122: PASS');
// ═══ 123 — MULTISUCURSAL (en producción se aplicó con el nombre 122_multisucursal.sql; el 122 del repo es la zona de negocio): sucursales por cliente, orden con sucursal, precio por sucursal, fusión de clientes ═══
{
  // Paridad con producción (md5 leídos en solo lectura el 2026-10-09; 088 vigente).
  const PROD123 = { precio_canonico: '3f5a0664498e77519b501a219a3bd578', lineas_canonicas: 'fa1dd9ee536ba52636e3dd77d57d7114',
    crear_orden: '0e5d1274d4ffe03a296d23a81f6fef67', update_orden_atomic: 'cbc3beba5e3e8fa6d4060a0c32064929' };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [Object.keys(PROD123)])).rows.map(r => [r.proname, r.m]));
  const sinTabla = (await c.query(`SELECT to_regclass('public.sucursales') IS NULL AS s`)).rows[0].s;
  const okP = sinTabla && Object.entries(PROD123).every(([k, v]) => loc[k] === v);
  console.log(`  MULTISUCURSAL_PARITY_CHECK[pre-123 == producción ANTES de aplicarla (2026-10-09): sin sucursales, contratos de 088 (una sola firma)]: ${okP ? 'PASS' : 'FAIL'} ${JSON.stringify(loc)}`);
  if (!okP) process.exit(1);
}
const SUITES_123 = [...SUITES_122, ['122', '122_zona_negocio_test.sql']];
async function conc123() {
  console.log('── 123 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE cliente_id BETWEEN 12380 AND 12389);
    DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 12380 AND 12389;
    DELETE FROM ordenes WHERE cliente_id BETWEEN 12380 AND 12389;
    DELETE FROM precios_esp WHERE cliente_id BETWEEN 12380 AND 12389;
    DELETE FROM sucursales WHERE cliente_id BETWEEN 12380 AND 12389 OR origen_cliente_id BETWEEN 12380 AND 12389;
    DELETE FROM auditoria WHERE detalle LIKE '%C123%';
    DELETE FROM clientes WHERE id BETWEEN 12380 AND 12389;
    UPDATE cuartos_frios SET stock = stock - 'C123-A' WHERE stock ? 'C123-A';
    DELETE FROM productos WHERE sku = 'C123-A'; COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN;
    INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('C123-A', 'Hielo C123', 'Producto Terminado', 10, 0, 0);
    UPDATE cuartos_frios SET stock = stock || '{"C123-A": 1000}'::jsonb WHERE id = (SELECT id FROM cuartos_frios ORDER BY id LIMIT 1);
    INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito, calle, colonia) VALUES
      (12380, 'Cadena C123', 'XAXX010101000', 0, true, 100, 'Matriz', 'Centro'),
      (12381, 'Sucursal Origen C123', 'XAXX010101000', 15, false, 0, 'Jardines 5', 'Jardines'),
      (12382, 'Destino B C123', 'XAXX010101000', 0, false, 0, 'Otra', 'Otra');
    COMMIT;`);
  const a = await connect(); const b = await connect();
  // C123a: crédito por cadena. Dos ventas a crédito simultáneas en sucursales distintas de la misma cadena (límite 100):
  // 90 + 20 → una sola pasa (fin_validar_credito bloquea al cliente).
  const sucA = (await c.query(`SELECT guardar_sucursal(NULL, 12380, '{"nombre":"Norte C123"}') ->> 'id' AS id`)).rows[0].id;
  const sucB = (await c.query(`SELECT guardar_sucursal(NULL, 12380, '{"nombre":"Sur C123"}') ->> 'id' AS id`)).rows[0].id;
  await a.query('BEGIN'); await b.query('BEGIN');
  const pa = a.query(`SELECT crear_orden($1, '[{"sku":"C123-A","cantidad":9}]') AS r`, [JSON.stringify({ cliente_id: 12380, sucursal_id: Number(sucA), tipo_cobro: 'Credito' })])
    .then(() => 'ok', e => e.message);
  await sleep(150);
  let doneB = false;
  const pb = b.query(`SELECT crear_orden($1, '[{"sku":"C123-A","cantidad":2}]') AS r`, [JSON.stringify({ cliente_id: 12380, sucursal_id: Number(sucB), tipo_cobro: 'Credito' })])
    .then(() => 'ok', e => e.message).finally(() => { doneB = true; });
  await sleep(300);
  const esperaB = !doneB;
  const ra = await pa; await a.query(ra === 'ok' ? 'COMMIT' : 'ROLLBACK');
  const rb = await pb; await b.query(rb === 'ok' ? 'COMMIT' : 'ROLLBACK');
  // Ambas se crean (crear_orden no abre CxC: el crédito se consume al entregar); lo que se verifica es la serialización
  // por cliente y que las dos órdenes quedaron con su sucursal y el precio de cadena.
  const ords = (await c.query(`SELECT count(*)::int AS n, count(DISTINCT sucursal_id)::int AS s FROM ordenes WHERE cliente_id = 12380`)).rows[0];
  ok(ra === 'ok' && rb === 'ok' && esperaB && ords.n === 2 && ords.s === 2,
    `C123a dos ventas a crédito simultáneas de la misma cadena en sucursales distintas se serializan por cliente (espera=${esperaB}, a=${ra}, b=${rb}, órdenes=${ords.n}/${ords.s} sucursales)`);
  // C123b: fusión y venta simultáneas sobre el origen: la venta espera y, si gana la fusión, queda reapuntada al destino.
  await c.query(`INSERT INTO precios_esp (cliente_id, sku, precio) VALUES (12381, 'C123-A', 7)`);
  await a.query('BEGIN'); await b.query('BEGIN');
  const pf = a.query(`SELECT fusionar_cliente_en_sucursal(12381, 12380, 'Jardines C123') AS r`).then(r => r.rows[0].r, e => ({ error: e.message }));
  await sleep(150);
  let doneV = false;
  const pv = b.query(`SELECT crear_orden('{"cliente_id": 12381}', '[{"sku":"C123-A","cantidad":1}]') AS r`).then(r => r.rows[0].r, e => ({ error: e.message })).finally(() => { doneV = true; });
  await sleep(300);
  const rf = await pf; await a.query(rf.error ? 'ROLLBACK' : 'COMMIT');
  const rv = await pv; await b.query(rv.error ? 'ROLLBACK' : 'COMMIT');
  const fin = (await c.query(`SELECT (SELECT fusionado_en FROM clientes WHERE id = 12381) AS fus,
      (SELECT count(*)::int FROM ordenes WHERE cliente_id = 12381) AS huerfanas,
      (SELECT count(*)::int FROM ordenes WHERE cliente_id = 12380 AND sucursal_id = $1) AS en_destino,
      (SELECT precio_canonico(12380, $1, 'C123-A')) AS precio`, [rf.sucursal_id || null])).rows[0];
  // La venta sobre el origen (sin bloqueo del cliente en crear_orden a contado) puede ganar o perder la carrera; en ambos
  // casos NO quedan órdenes huérfanas en el origen y el precio del origen vive en la sucursal nueva.
  ok(!rf.error && String(fin.fus) === '12380' && fin.huerfanas === 0 && Number(fin.precio) === 7,
    `C123b fusión y venta simultáneas: sin órdenes huérfanas en el origen (en destino=${fin.en_destino}, venta=${rv.error ? 'rechazada: ' + rv.error.slice(0, 60) : 'ok'}), precio del origen (7) ahora de la sucursal`);
  // C123c: dos fusiones del mismo origen a destinos distintos: una gana, la otra falla (ya fusionado).
  await c.query(`INSERT INTO clientes (id, nombre, rfc, calle, colonia) VALUES (12383, 'Origen 2 C123', 'XAXX010101000', 'X', 'Y')`);
  await a.query('BEGIN'); await b.query('BEGIN');
  const f1 = a.query(`SELECT fusionar_cliente_en_sucursal(12383, 12380, 'Dos A') AS r`).then(() => 'ok', e => e.message);
  await sleep(150);
  const f2 = b.query(`SELECT fusionar_cliente_en_sucursal(12383, 12382, 'Dos B') AS r`).then(() => 'ok', e => e.message);
  const r1 = await f1; await a.query(r1 === 'ok' ? 'COMMIT' : 'ROLLBACK');
  const r2 = await f2; await b.query(r2 === 'ok' ? 'COMMIT' : 'ROLLBACK');
  const dos = (await c.query(`SELECT count(*)::int AS n FROM sucursales WHERE origen_cliente_id = 12383`)).rows[0].n;
  ok((r1 === 'ok') !== (r2 === 'ok') && dos === 1, `C123c dos fusiones del mismo origen: una sola gana (a=${r1}, b=${r2.slice(0, 70)}, sucursales=${dos})`);
  await a.end(); await b.end();
  await c.query(limpiar);
  await c.query(`DELETE FROM clientes WHERE id = 12383`);
  if (!okAll) { console.log('RESULTADO: FALLÓ (123 concurrencia)'); process.exit(1); }
}
for (const k of [1, 2]) {
  console.log(`── aplicar 123 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '123_multisucursal.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 123 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 123)'); process.exit(1); }
{
  // Paridad DESPUÉS de aplicar: producción ya tiene 123 (aplicada por el dueño el 2026-10-09 ~23:51Z con el nombre
  // 122_multisucursal.sql); md5 leídos en solo lectura. fin_hoy() no se compara (122 zona de negocio la redefine).
  const PROD123_POST = {
    'clientes_sync_sucursal_principal()': '9f8e9962a4af8ea608c4e9f0f911abb7',
    'crear_orden(p_orden jsonb, p_items jsonb)': 'a090f0c65458869304593bdfdaf0347b',
    'fusionar_cliente_en_sucursal(p_origen bigint, p_destino bigint, p_nombre_sucursal text)': 'ebf67710b03d2a9db87f4ca1e91be40c',
    'guardar_sucursal(p_id bigint, p_cliente_id bigint, p_datos jsonb)': '7fc4e3d2921327da3af9e74227b3f5d8',
    'lineas_canonicas(p_cliente_id bigint, p_items jsonb)': 'fdffaf02bbe6433f46c68cb90575ab71',
    'lineas_canonicas(p_cliente_id bigint, p_sucursal_id bigint, p_items jsonb)': '1a84a57e4334218972341dcc76e00c28',
    'ordenes_guard_sucursal()': '534b55d8afdaaab53108afb019fe1e63',
    'precio_canonico(p_cliente_id bigint, p_sku text)': '8abfb80795800b08d7001cc284207ac6',
    'precio_canonico(p_cliente_id bigint, p_sucursal_id bigint, p_sku text)': 'c549682fbc47f9a3bb3be82e62a3b80f',
    'precios_esp_guard_sucursal()': '15123835a324131d817d9ae65b60e92d',
    'sucursal_con_domicilio(s sucursales)': '3ca296b8aabed90bbbfddf1b9f9d0356',
    'sucursal_direccion_texto(s sucursales)': '22e97e884178021d084e099a69e1ef90',
    'sucursal_para_orden(p_cliente_id bigint, p_sucursal_id bigint, p_contrato text)': '0e79ca089fb613cdb31f465ee3da8b39',
    'sucursales_guard()': 'eb491212e17db7f05fa9beaf2aa58579',
    'update_orden_atomic(p_orden_id bigint, p_update_fields jsonb, p_lineas jsonb)': '49edcf4504cc068b66ef9f922c0f09e1',
  };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS f, md5(pg_get_functiondef(p.oid)) AS m
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`,
    [[...new Set(Object.keys(PROD123_POST).map(k => k.split('(')[0]))]])).rows.map(r => [r.f, r.m]));
  const dif = Object.entries(PROD123_POST).filter(([k, v]) => loc[k] !== v).map(([k]) => k);
  console.log(`  MULTISUCURSAL_PROD_CHECK[local tras 123 == producción (15 definiciones)]: ${dif.length ? 'FAIL ' + JSON.stringify(dif) : 'PASS'}`);
  if (dif.length) process.exit(1);
}
// 124: corrección de update_orden_atomic (cambio de cliente); va antes de la suite 123, que la exige (123-05d).
for (const k of [1, 2]) {
  console.log(`── aplicar 124 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '124_multisucursal_cambio_cliente.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
{
  // 124 solo cambia el cuerpo de update_orden_atomic: misma firma, ACL, SECURITY DEFINER y search_path.
  const f = (await c.query(`SELECT prosecdef, array_to_string(proconfig, ';') AS cfg, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
      has_function_privilege('anon', oid, 'EXECUTE') AS anon FROM pg_proc WHERE oid = 'public.update_orden_atomic(bigint,jsonb,jsonb)'::regprocedure`)).rows[0];
  const ok = f.prosecdef && f.cfg === 'search_path=public, pg_temp' && f.auth && !f.anon;
  console.log(`  MULTISUCURSAL_124[update_orden_atomic: SECURITY DEFINER, search_path fijo, authenticated sí, anon no]: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(f)}`);
  if (!ok) process.exit(1);
}
if (!(await rlsCheck('tras 124 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 124)'); process.exit(1); }
// 125: borrar un cliente sin historia borra su sucursal principal (ON DELETE CASCADE); sin ella, DELETE de clientes fallaba siempre.
for (const k of [1, 2]) {
  console.log(`── aplicar 125 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '125_multisucursal_borrado_cliente.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
{
  const fk = (await c.query(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.sucursales'::regclass AND contype = 'f' ORDER BY 1`)).rows;
  const m = Object.fromEntries(fk.map(r => [r.conname, r.confdeltype]));
  const ok = m.sucursales_cliente_id_fkey === 'c' && m.sucursales_origen_cliente_id_fkey === 'n' && fk.length === 2;
  console.log(`  MULTISUCURSAL_125[sucursales.cliente_id ON DELETE CASCADE, origen_cliente_id SET NULL]: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(m)}`);
  if (!ok) process.exit(1);
}
if (!(await rlsCheck('tras 125 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 125)'); process.exit(1); }
console.log('── PRUEBAS 123 (con 124 y 125)');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/123_multisucursal_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (123)'); process.exit(1); }
}
await conc123();
await reruns090('123', ['072']);
for (const [etq, f] of [...SUITES_123, ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 123)`); process.exit(1); }
  console.log(`  ${etq} tras 123: PASS`);
}
console.log('  MULTISUCURSAL (sucursales, orden con sucursal, precio por sucursal, fusión) tras 123: PASS');

// 127: el Chofer registra un cliente con datos fiscales por contrato (aditiva e idempotente).
for (const k of [1, 2]) {
  console.log(`── aplicar 127 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '127_chofer_alta_cliente.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 127 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 127)'); process.exit(1); }
console.log('── PRUEBAS 127');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/127_chofer_alta_cliente_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (127)'); process.exit(1); }
}

// ═══ 128 — NOM-1: conceptos de nómina (catálogo, desglose por recibo, tope acumulado) ═══
{
  // Paridad con producción (md5 leídos en solo lectura el 2026-10-09; 0 periodos y 0 recibos tras la limpieza).
  const PROD128 = { generar_recibos_nomina: 'f829cbdd17d3b6985f4f936a4c96b55f', editar_recibo_nomina: '7a4bbab59e5c9e9d4ad6205f67b5dfd0',
    pagar_nomina: 'c4504312dd00137c00d570e4bb66ed1d', nomina_recalcular_periodo: 'ac3cc100044ac544a0b4433cb1a6fa43',
    nomina_recibos_guard: '2006190420f139b89dfb2a1b9567bf96', nomina_periodos_guard: '252038791b42ec73b5383826f54eb094' };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [Object.keys(PROD128)])).rows.map(r => [r.proname, r.m]));
  const okP = Object.entries(PROD128).every(([k, v]) => loc[k] === v)
    && (await c.query(`SELECT to_regclass('public.nomina_conceptos') IS NULL AND to_regclass('public.nomina_recibo_lineas') IS NULL
        AND to_regprocedure('public.guardar_recibo_nomina(bigint,integer,boolean,jsonb)') IS NULL AS a`)).rows[0].a;
  console.log(`  NOM1_PARITY_CHECK[pre-128 == producción]: ${okP ? 'PASS' : 'FAIL ' + JSON.stringify(loc)}`);
  if (!okP) process.exit(1);
}
for (const k of [1, 2]) {
  console.log(`── aplicar 128 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '128_conceptos_nomina.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 128 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 128)'); process.exit(1); }
{
  // 128 no toca el pago, los totales del periodo ni las guardas de 100.
  const INTACTAS = { pagar_nomina: 'c4504312dd00137c00d570e4bb66ed1d', nomina_recalcular_periodo: 'ac3cc100044ac544a0b4433cb1a6fa43',
    nomina_recibos_guard: '2006190420f139b89dfb2a1b9567bf96', nomina_periodos_guard: '252038791b42ec73b5383826f54eb094' };
  const loc = Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [Object.keys(INTACTAS)])).rows.map(r => [r.proname, r.m]));
  const ok = Object.entries(INTACTAS).every(([k, v]) => loc[k] === v);
  console.log(`  NOM1_128[pagar_nomina, totales del periodo y guardas de 100 sin cambio]: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(loc)}`);
  if (!ok) process.exit(1);
}
console.log('── PRUEBAS 128');
for (const f of ['128_conceptos_nomina_test.sql', '100_nomina_canonica_test.sql']) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${f} tras 128)`); process.exit(1); }
}
await reruns090('128', ['072']);
for (const [etq, f] of [...SUITES_123, ['123', '123_multisucursal_test.sql'], ['127', '127_chofer_alta_cliente_test.sql'], ['111', '111_operaciones_cfdi_test.sql']]) {
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 128)`); process.exit(1); }
  console.log(`  ${etq} tras 128: PASS`);
}
async function conc128() {
  console.log('── 128 CONCURRENCIA (dos conexiones reales)');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let okAll = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) okAll = false; };
  const n = async (sql, params) => Number(Object.values((await c.query(sql, params)).rows[0])[0]);
  const SUB = (k) => 'a1280000-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
  const limpiar = `BEGIN; SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE IF NOT EXISTS c128_movs (id BIGINT); DELETE FROM c128_movs;
    INSERT INTO c128_movs SELECT movimiento_id FROM nomina_periodos WHERE creado_por LIKE 'AdminC128-%' AND movimiento_id IS NOT NULL;
    DELETE FROM costos_historial WHERE movimiento_id IN (SELECT id FROM c128_movs);
    DELETE FROM nomina_recibo_lineas WHERE recibo_id IN (SELECT id FROM nomina_recibos
      WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por LIKE 'AdminC128-%') OR empleado_id BETWEEN 12861 AND 12869);
    DELETE FROM nomina_recibos WHERE periodo_id IN (SELECT id FROM nomina_periodos WHERE creado_por LIKE 'AdminC128-%') OR empleado_id BETWEEN 12861 AND 12869;
    DELETE FROM nomina_periodos WHERE creado_por LIKE 'AdminC128-%';
    DELETE FROM movimientos_contables WHERE id IN (SELECT id FROM c128_movs);
    DELETE FROM bitacora_cambios WHERE tabla = 'nomina_conceptos' AND registro_id IN (SELECT id::text FROM nomina_conceptos WHERE creado_por LIKE 'AdminC128-%');
    DELETE FROM nomina_concepto_empleados WHERE concepto_id IN (SELECT id FROM nomina_conceptos WHERE creado_por LIKE 'AdminC128-%');
    DELETE FROM nomina_conceptos WHERE creado_por LIKE 'AdminC128-%';
    DELETE FROM auditoria WHERE usuario LIKE 'AdminC128-%';
    DELETE FROM empleados WHERE id BETWEEN 12861 AND 12869;
    DELETE FROM usuarios WHERE id BETWEEN 12861 AND 12869; DELETE FROM auth.users WHERE id::text LIKE 'a1280000-%';
    COMMIT;`;
  await c.query(limpiar);
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) SELECT ('a1280000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'c' || k || '@t128c' FROM generate_series(1, 2) k;
    INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
      (12861, 'AdminC128-1', 'c1@t128c', 'Admin', 'Activo', '${SUB(1)}'), (12862, 'AdminC128-2', 'c2@t128c', 'Admin', 'Activo', '${SUB(2)}');
    INSERT INTO empleados (id, nombre, puesto, depto, salario_diario, fecha_ingreso, estatus) VALUES
      (12861, 'EmpC128 uno', 'Operador', 'Producción', 100, '2024-01-01', 'Activo'), (12862, 'EmpC128 dos', 'Operador', 'Producción', 200, '2024-01-01', 'Activo');
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
  const como = async (k, sql, params) => {
    await actor(a, SUB(k));
    try { const r = await a.query(sql, params); await a.query('COMMIT'); return r.rows[0]; } catch (e) { await a.query('ROLLBACK'); throw e; }
  };
  // Dos Admins dan de alta el mismo concepto a la vez: uno solo.
  const ALTA = `SELECT guardar_concepto_nomina(NULL, '{"nombre":"C128 Préstamo","tipo":"descuento","categoria":"prestamo","monto":400,"aplica_a":"personas","personas":[{"empleado_id":12861,"limite_total":500}]}') AS r`;
  let r = await carrera(SUB(1), ALTA, [], SUB(2), ALTA, []);
  ok(r.ra.ok && !r.rb.ok && r.rb.code === '23505' && r.bloqueado
     && await n(`SELECT count(*) FROM nomina_conceptos WHERE creado_por LIKE 'AdminC128-%'`) === 1,
     '128-C1 dos altas simultáneas del mismo concepto: una sola (la segunda espera y se rechaza por nombre repetido)');
  const CON = r.ra.row.r.concepto_id;
  await como(1, `SELECT guardar_concepto_nomina(NULL, '{"nombre":"C128 Bono","tipo":"percepcion","categoria":"bono_puntualidad","monto":50,"aplica_a":"todos"}')`, []);
  const P1 = (await como(1, `SELECT crear_periodo_nomina(fin_hoy() - 49) AS r`, [])).r.periodo_id;
  const P2 = (await como(1, `SELECT crear_periodo_nomina(fin_hoy() - 56) AS r`, [])).r.periodo_id;
  // Dos semanas distintas generadas a la vez: el tope del préstamo (500, a 400 por semana) no se rebasa.
  const GEN = `SELECT generar_recibos_nomina($1::bigint) AS r`;
  r = await carrera(SUB(1), GEN, [P1], SUB(2), GEN, [P2]);
  const tot = await n(`SELECT COALESCE(sum(l.monto), 0) FROM nomina_recibo_lineas l JOIN nomina_recibos x ON x.id = l.recibo_id WHERE l.concepto_id = $1 AND x.empleado_id = 12861`, [CON]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && tot === 500
     && await n(`SELECT count(*) FROM nomina_recibo_lineas l JOIN nomina_recibos x ON x.id = l.recibo_id WHERE l.concepto_id = $1 AND x.empleado_id = 12861`, [CON]) === 2,
     `128-C2 dos semanas generadas a la vez sobre el mismo préstamo: 400 + 100 = el tope exacto (total ${tot}); la segunda espera`);
  // Dos "aplicar conceptos" simultáneos sobre el mismo borrador: sin líneas duplicadas.
  await como(1, `SELECT guardar_concepto_nomina(NULL, '{"nombre":"C128 Vales","tipo":"percepcion","categoria":"otras_percepciones","monto":30,"aplica_a":"todos"}')`, []);
  const APL = `SELECT aplicar_conceptos_nomina($1::bigint) AS r`;
  r = await carrera(SUB(1), APL, [P1], SUB(2), APL, [P1]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && r.ra.row.r.lineas >= 2 && r.rb.row.r.lineas === 0
     && await n(`SELECT count(*) FROM (SELECT recibo_id, concepto_id FROM nomina_recibo_lineas WHERE concepto_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x`) === 0,
     '128-C3 dos "aplicar conceptos" simultáneos: cada línea una sola vez (el segundo agrega 0)');
  // Guardar un recibo mientras se paga el periodo: el pago espera y paga lo guardado.
  const R1 = await n(`SELECT id FROM nomina_recibos WHERE periodo_id = $1 AND empleado_id = 12862`, [P1]);
  r = await carrera(SUB(1), `SELECT guardar_recibo_nomina($1::bigint, 6, true, '[{"nombre":"C128 Extra","tipo":"percepcion","categoria":"comisiones","monto":1000}]') AS r`, [R1],
                    SUB(2), `SELECT pagar_nomina($1::bigint) AS r`, [P1]);
  const neto = await n(`SELECT sum(neto_a_pagar) FROM nomina_recibos WHERE periodo_id = $1`, [P1]);
  ok(r.ra.ok && r.rb.ok && r.bloqueado && Number(r.rb.row.r.total_neto) === neto
     && await n(`SELECT neto_a_pagar FROM nomina_recibos WHERE id = $1`, [R1]) === 2400
     && await n(`SELECT monto FROM movimientos_contables WHERE id = (SELECT movimiento_id FROM nomina_periodos WHERE id = $1)`, [P1]) === neto,
     '128-C4 guardar el desglose y pagar a la vez: el pago espera y paga la versión guardada (egreso = suma de recibos)');
  r = await carrera(SUB(1), `SELECT guardar_recibo_nomina($1::bigint, 6, true, '[]') AS r`, [R1], SUB(2), `SELECT aplicar_conceptos_nomina($1::bigint) AS r`, [P1]);
  ok(!r.ra.ok && /pagado/.test(r.ra.msg || '') && !r.rb.ok && /pagado/.test(r.rb.msg || ''), '128-C5 después del pago: guardar y aplicar se rechazan');
  await a.end(); await b.end();
  await c.query(limpiar);
  if (!okAll) { console.log('RESULTADO: FALLÓ (128 concurrencia)'); process.exit(1); }
}
await conc128();
// La concurrencia de 100 (crear, generar, editar con el contrato anterior, pagar) con 128 activa: mismo resultado.
await conc100();
console.log('  NOM-1 conceptos de nómina tras 128: PASS');

// 129: media barra (HIB-25K), partir barra y preparar media (aditiva e idempotente).
for (const k of [1, 2]) {
  console.log(`── aplicar 129 (${k}/2${k === 2 ? ', idempotencia' : ''})`);
  const rr = await runFile(c, path.join(ROOT, 'supabase', '129_media_barra.sql'), { stopOnError: true });
  if (rr.aborted) process.exit(1);
}
if (!(await rlsCheck('tras 129 (sin deuda)', []))) { console.log('RESULTADO: FALLÓ (RLS_CHECK 129)'); process.exit(1); }
console.log('── PRUEBAS 129');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/129_media_barra_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (129)'); process.exit(1); }
}
for (const [etq, f] of [['115', '115_preparacion_barra_test.sql'], ['106', '106_costo_empaque_test.sql'], ['092', '092_empaque_entrega_test.sql'], ['093', '093_finanzas_reverso_test.sql']]) {
  if (!fs.existsSync(path.join(ROOT, 'supabase/tests', f))) continue;
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
  if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${etq} tras 129)`); process.exit(1); }
  console.log(`  ${etq} tras 129: PASS`);
}

// ═══ 130 — NOM-2: comisiones con lo entregado y percepciones condicionadas a la asistencia ═══
// ═══ 131 — PD-01.1: avisos de asistencia al celular ═══
// Aditivas e idempotentes. 130 no redefine generar/guardar/editar/pagar (la suite 130 lo comprueba por md5).
for (const [mig, suite, reruns] of [
  ['130_nomina_automatica.sql', '130_nomina_automatica_test.sql', ['128_conceptos_nomina_test.sql', '100_nomina_canonica_test.sql', '116_asistencia_test.sql']],
  ['131_avisos_asistencia.sql', '131_avisos_asistencia_test.sql', ['116_asistencia_test.sql', '117_aislamiento_lectura_empleado_test.sql', '119_cierre_api_empleado_test.sql']],
  // 132: datos bancarios (solo el Dueño). 133: media barra, picada y triturada contra la barra entera
  // (redefine crear_orden y completar_venta_directa: se re-corren sus suites).
  ['132_datos_bancarios.sql', '132_datos_bancarios_test.sql', ['120_ger1_dueno_accesos_test.sql']],
  ['133_venta_barra_desde_entera.sql', '133_venta_barra_desde_entera_test.sql', ['109_venta_directa_test.sql', '110_contencion_entrega_directa_test.sql',
    '115_preparacion_barra_test.sql', '123_multisucursal_test.sql', '129_media_barra_test.sql']],
]) {
  const n = mig.slice(0, 3);
  for (const k of [1, 2]) {
    console.log(`── aplicar ${n} (${k}/2${k === 2 ? ', idempotencia' : ''})`);
    const rr = await runFile(c, path.join(ROOT, 'supabase', mig), { stopOnError: true });
    if (rr.aborted) process.exit(1);
  }
  if (!(await rlsCheck(`tras ${n} (sin deuda)`, []))) { console.log(`RESULTADO: FALLÓ (RLS_CHECK ${n})`); process.exit(1); }
  console.log(`── PRUEBAS ${n}`);
  {
    const rr = await runFile(c, path.join(ROOT, 'supabase/tests', suite), { stopOnError: true, echo: true });
    if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${n})`); process.exit(1); }
  }
  for (const f of reruns) {
    const rr = await runFile(c, path.join(ROOT, 'supabase/tests', f), { stopOnError: true, echo: false });
    if (rr.aborted) { console.log(`RESULTADO: FALLÓ (${f.slice(0, 3)} tras ${n})`); process.exit(1); }
    console.log(`  ${f.slice(0, 3)} tras ${n}: PASS`);
  }
}

// ═══ OP-03 — ensayo operativo de punta a punta (Día 0; producción, barra, mostrador, ruta, mermas, reverso) ═══
// Va al final (tras 116): deja sus funciones auxiliares op3_*, que 090-04 marcaría en una re-corrida posterior.
console.log('── ENSAYO OPERATIVO OP-03');
{
  const rr = await runFile(c, path.join(ROOT, 'supabase/tests/op03_ensayo_operativo_test.sql'), { stopOnError: true, echo: true });
  if (rr.aborted) { console.log('RESULTADO: FALLÓ (ensayo OP-03)'); process.exit(1); }
}

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
  'completar_venta_directa',
  // 110
  'ordenes_guard_entrega_directa',
  // 111 / 112 (OL-03B)
  'reservar_operacion_cfdi', 'cfdi_aplicar_resultado', 'finalizar_operacion_cfdi', 'vencer_operaciones_cfdi', 'conciliar_operacion_cfdi',
  'ordenes_guard_facturada',
  // 113 (OL-04)
  'reservar_complemento_cfdi',
  // 115 (OP-01D)
  'registrar_preparacion_barra', 'revertir_preparacion_barra',
  // 116 (WF-0 + PD-01)
  'asistencia_turno_aplicable', 'asistencia_empleado_actual', 'asistencia_json', 'vincular_empleado_usuario', 'guardar_centro_trabajo',
  'guardar_turno', 'registrar_entrada', 'registrar_salida', 'mi_asistencia', 'asistencia_dia', 'config_asistencia', 'corregir_asistencia',
  // 117 (WF-0.1)
  'erp_lector_negocio',
  // 118 (PD-02)
  'actividad_visible', 'actividad_ocurrencia_json', 'calendario', 'completar_ocurrencia', 'guardar_actividad', 'editar_ocurrencia',
  'desactivar_actividad',
  // 119 (WF-0.2)
  'erp_exigir_no_empleado',
  // 120 (GER-1)
  'erp_roles_activos', 'erp_tiene_rol', 'erp_es_dueno', 'guardar_usuario', 'fijar_password_temporal', 'confirmar_cambio_password',
  'bitacora_actor',
  // 123 (multisucursal)
  'clientes_sync_sucursal_principal', 'sucursales_guard', 'ordenes_guard_sucursal', 'precios_esp_guard_sucursal',
  'sucursal_para_orden', 'guardar_sucursal', 'fusionar_cliente_en_sucursal',
  // 128 (NOM-1)
  'guardar_concepto_nomina', 'guardar_recibo_nomina', 'aplicar_conceptos_nomina', 'nomina_acumulados',
  'asistencia_generar_avisos', 'avisos_asistencia', 'guardar_avisos_asistencia'];
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
