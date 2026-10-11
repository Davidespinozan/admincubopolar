// c140_concurrencia.mjs — T5-C (mig 140): conteo de empaques con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 140; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c140_concurrencia.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM mermas WHERE sku LIKE 'P140C-%';
  DELETE FROM produccion WHERE sku LIKE 'P140C-%';
  DELETE FROM costos_empaque_historial WHERE sku LIKE 'P140C-%';
  DELETE FROM cuentas_por_pagar WHERE concepto LIKE '%P140C-%' OR proveedor = 'Prov C140';
  DELETE FROM movimientos_contables WHERE concepto LIKE '%P140C-%' OR concepto LIKE '%Prov C140%';
  DELETE FROM inventario_mov WHERE producto LIKE 'P140C-%';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '14090000-%';
  DELETE FROM auditoria WHERE detalle LIKE 'P140C-%' OR detalle LIKE '%P140C-%';
  DELETE FROM cuartos_frios WHERE id = 'CF-140C';
  DELETE FROM productos WHERE sku LIKE 'P140C-%';
  COMMIT;`;
const SEMBRAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-140C', 'Cuarto C140', '{}');
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario, empaque_sku) VALUES
    ('P140C-E', 'Bolsa C140', 'Empaque', 0, 0, 0, NULL), ('P140C-H', 'Hielo C140', 'Producto Terminado', 30, 0, 0, 'P140C-E');
  COMMIT;`;
const OP = (n) => `'14090000-0000-0000-0000-0000000000${n}'::uuid`;

export async function c140({ connect, c, ok }) {
  console.log('── CONCURRENCIA 140 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  await c.query(`SELECT registrar_recepcion_compra(${OP('c0')}, 'P140C-E', 10000, 5000, 'Prov C140', false)`);
  const a = await connect(); const b = await connect();
  const vista = async () => (await c.query(`SELECT (SELECT stock::int FROM productos WHERE sku = 'P140C-E') AS ex, (SELECT COALESCE(max(id), 0)::bigint FROM inventario_mov WHERE producto = 'P140C-E') AS rev`)).rows[0];
  const CONTEO = (op, v, n, motivo = 'Conteo C140') => `SELECT registrar_conteo_empaque(${OP(op)}, 'P140C-E', ${v.ex}, ${v.rev}, ${n}, '${motivo}') AS r`;
  const carrera = async (sqlA, sqlB) => {
    await a.query('BEGIN');
    let ra; try { ra = { ok: true, r: (await a.query(sqlA)).rows[0]?.r }; } catch (e) { ra = { ok: false, code: e.code, msg: e.message }; }
    let done = false;
    const prB = b.query(sqlB).then(r => ({ ok: true, r: r.rows[0]?.r }), e => ({ ok: false, code: e.code, msg: e.message, detail: e.detail })).finally(() => { done = true; });
    await sleep(600);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    return { ra, rb, bloqueado };
  };
  const kardex = async () => (await c.query(`SELECT count(*)::int AS n, COALESCE(sum(CASE WHEN tipo = 'Entrada' THEN cantidad ELSE -cantidad END), 0)::int AS neto FROM inventario_mov WHERE producto = 'P140C-E'`)).rows[0];

  // a. Dos administradores confirman un conteo a la vez, los dos preparados sobre 10,000.
  let v = await vista();
  let r = await carrera(CONTEO('a1', v, 9900), CONTEO('a2', v, 9800));
  let f = await vista(); let k = await kardex();
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /CONTEO_OBSOLETO/.test(r.rb.detail || '') && f.ex === 9900 && k.neto === 9900,
    `C140a dos conteos simultáneos sobre la misma existencia: el segundo espera el candado y se rechaza por obsoleto; existencia 9,900 = kardex (${f.ex})`);

  // b. Producción consume mientras Admin confirma un conteo preparado antes.
  v = await vista();
  r = await carrera(`SELECT registrar_produccion(${OP('b1')}, 'Turno 1', 'Máquina C140', 'P140C-H', 100, 'CF-140C') AS r`, CONTEO('b2', v, 9850));
  f = await vista(); k = await kardex();
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /CONTEO_OBSOLETO/.test(r.rb.detail || '') && f.ex === 9800 && k.neto === 9800,
    `C140b producción y conteo a la vez: el conteo espera, ve el consumo y se rechaza; NO pisa las 100 bolsas usadas (existencia ${f.ex})`);

  // c. Al revés: el conteo confirma primero y Producción espera; consume sobre el inventario ya ajustado.
  v = await vista();
  r = await carrera(CONTEO('c1', v, 9700), `SELECT registrar_produccion(${OP('c2')}, 'Turno 1', 'Máquina C140', 'P140C-H', 50, 'CF-140C') AS r`);
  f = await vista(); k = await kardex();
  ok(r.ra.ok && r.bloqueado && r.rb.ok && f.ex === 9650 && k.neto === 9650,
    `C140c conteo y después producción: Producción espera y consume del inventario ajustado (9,700 − 50 = ${f.ex})`);

  // d. La MISMA operación dos veces a la vez (doble clic real): un solo ajuste.
  v = await vista();
  const antes = (await kardex()).n;
  r = await carrera(CONTEO('d1', v, 9600), CONTEO('d1', v, 9600));
  f = await vista(); k = await kardex();
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.ra.r.replay === false && f.ex === 9600 && k.n === antes + 1,
    'C140d el mismo conteo dos veces a la vez: la segunda espera y es replay; un solo movimiento de kardex');

  // e. Recepción de compra mientras se confirma un conteo preparado antes.
  v = await vista();
  r = await carrera(`SELECT registrar_recepcion_compra(${OP('e1')}, 'P140C-E', 400, 200, 'Prov C140', false) AS r`, CONTEO('e2', v, 9500));
  f = await vista(); k = await kardex();
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /CONTEO_OBSOLETO/.test(r.rb.detail || '') && f.ex === 10000 && k.neto === 10000,
    `C140e compra recibida y conteo a la vez: el conteo se rechaza; la compra no se pierde (existencia ${f.ex})`);

  // Invariante: existencia = entradas − salidas del kardex; un ajuste por operación.
  const dup = (await c.query(`SELECT count(*)::int AS n FROM (SELECT operacion_id FROM inventario_mov WHERE producto = 'P140C-E' AND operacion_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`)).rows[0].n;
  const ops = (await c.query(`SELECT count(*)::int AS n FROM stock_operaciones WHERE tipo = 'ajuste_existencia' AND resultado ->> 'sku' = 'P140C-E'`)).rows[0].n;
  f = await vista(); k = await kardex();
  ok(f.ex === k.neto && dup === 0 && ops === 3, `C140f tras todas las carreras: existencia = kardex (${f.ex}), 0 movimientos duplicados, 3 conteos aplicados de 8 intentos`);

  await a.end(); await b.end();
  await c.query(LIMPIAR);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c140({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C140: TODAS OK' : 'RESULTADO: FALLÓ (140 concurrencia)');
  process.exit(todo ? 0 : 1);
}
