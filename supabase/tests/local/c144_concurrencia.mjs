// c144_concurrencia.mjs — Tiendas E2 (mig 144): carreras de inventario con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 144; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c144_concurrencia.mjs
// Crea una tienda de fábrica y una externa SOLO para la prueba (enciende el interruptor de 143,
// y al terminar borra todo y lo deja apagado). Sesiones sin JWT (de confianza): los candados son los mismos.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM inventario_mov WHERE producto = 'P144-C';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 14491 AND 14499 OR operacion_id::text LIKE '14490000-%';
  DELETE FROM rutas WHERE id BETWEEN 14491 AND 14499;
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-C144-%';
  DELETE FROM usuario_establecimientos WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave IN ('TFABC144', 'TEXTC144'));
  DELETE FROM establecimientos WHERE clave IN ('TFABC144', 'TEXTC144');
  DELETE FROM productos WHERE sku = 'P144-C';
  DELETE FROM usuarios WHERE id BETWEEN 14491 AND 14499;
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;

// CEDIS: C1 = 10, C2 = 0. Tienda de fábrica: 20. Tienda externa: 30. Cuatro rutas de 8 (cuatro choferes).
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba C144';
  INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('TFABC144', 'Tienda de fábrica C144', 'tienda_fabrica'), ('TEXTC144', 'Tienda externa C144', 'tienda');
  SET LOCAL session_replication_role = replica;
  INSERT INTO usuarios (id, nombre, email, rol, estatus) SELECT 14490 + n, 'Chofer C144-' || n, 'c' || n || '@c144', 'Chofer', 'Activo' FROM generate_series(1, 4) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P144-C', 'Hielo C144', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES
    ('CF-C144-A-TF', 'Congelador fábrica C144', '{"P144-C": 20}', (SELECT id FROM establecimientos WHERE clave = 'TFABC144')),
    ('CF-C144-B-TX', 'Congelador externa C144', '{"P144-C": 30}', (SELECT id FROM establecimientos WHERE clave = 'TEXTC144')),
    ('CF-C144-C1', 'CEDIS C144 uno', '{"P144-C": 10}', 1), ('CF-C144-C2', 'CEDIS C144 dos', '{}', 1);
  INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
    SELECT 14490 + n, 'R-1449' || n, 'C144 ' || n, 14490 + n, 'Chofer C144-' || n, 'Pendiente firma', CURRENT_DATE, '{"P144-C": 8}', '{"P144-C": 8}', '{}', '{"P144-C": 8}', now() FROM generate_series(1, 4) n;
  COMMIT;`;

const CARGAR = (ruta) => `SELECT confirmar_carga_ruta('14490000-0000-0000-0000-00000000c00${ruta - 14490}'::uuid, ${ruta}, 'data:image/png;base64,QQ==', true, 'Prueba C144') AS r`;
const AJUSTE_CUARTO = (op, cuarto, q) => `SELECT ajustar_existencia_cuarto('14490000-0000-0000-0000-0000000000${op}'::uuid, '${cuarto}', 'P144-C', ${q}, 'Conteo de prueba C144') AS r`;
const TRASPASO = (op, o, d, q) => `SELECT traspaso_cuartos('14490000-0000-0000-0000-0000000000${op}'::uuid, '${o}', '${d}', 'P144-C', ${q}) AS r`;

export async function c144({ connect, c, ok }) {
  console.log('── CONCURRENCIA 144 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  const a = await connect(); const b = await connect();
  const carrera = async (sqlA, sqlB) => {
    await a.query('BEGIN');
    let ra; try { ra = { ok: true, r: (await a.query(sqlA)).rows[0]?.r }; } catch (e) { ra = { ok: false, code: e.code, msg: e.message, detail: e.detail }; }
    let done = false;
    const prB = b.query(sqlB).then(r => ({ ok: true, r: r.rows[0]?.r }), e => ({ ok: false, code: e.code, msg: e.message, detail: e.detail })).finally(() => { done = true; });
    await sleep(600);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    return { ra, rb, bloqueado };
  };
  const uno = async (sql) => (await c.query(sql)).rows[0];
  // Existencia: fábrica|externa|CEDIS 1|CEDIS 2
  const inv = async () => (await uno(`SELECT string_agg(COALESCE(stock ->> 'P144-C', '0'), '|' ORDER BY id) AS s FROM cuartos_frios WHERE id LIKE 'CF-C144-%'`)).s;

  try {
    // a. Dos camiones compiten por lo que hay en el CEDIS (10; cada uno 8). Las tiendas tienen 50 y NO cuentan.
    let r = await carrera(CARGAR(14491), CARGAR(14492));
    let s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && /Inventario insuficiente para cargar 8 de P144-C \(faltan 6\)/.test(r.rb.msg) && s === '20|30|2|0',
      `C144a dos cargas de ruta a la vez: la segunda espera el candado del CEDIS y se rechaza (faltan 6) aunque las tiendas tengan 50; existencias ${s}`);

    // b. Mientras una carga de ruta tiene bloqueado el CEDIS, una operación sobre el congelador de una tienda NO espera:
    //    la carga ya no bloquea cuartos que no son del CEDIS.
    await c.query(AJUSTE_CUARTO('b0', 'CF-C144-C1', 10));
    r = await carrera(CARGAR(14492), AJUSTE_CUARTO('b1', 'CF-C144-B-TX', 25));
    s = await inv();
    ok(r.ra.ok && !r.bloqueado && r.rb.ok && s === '20|25|2|0',
      `C144b carga de ruta y ajuste del congelador de una tienda a la vez: el ajuste de la tienda NO espera a la carga (cuartos independientes); existencias ${s}`);

    // c. Traspaso autorizado CEDIS → tienda de fábrica y carga de ruta por el mismo producto del CEDIS (10: 6 + 8).
    await c.query(AJUSTE_CUARTO('c0', 'CF-C144-C1', 10));
    r = await carrera(TRASPASO('c1', 'CF-C144-C1', 'CF-C144-A-TF', 6), CARGAR(14493));
    s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && /Inventario insuficiente/.test(r.rb.msg) && s === '26|25|4|0',
      `C144c traspaso a la tienda de fábrica y carga de ruta a la vez: la carga espera, ve lo que quedó y se rechaza; el producto no se usó dos veces; existencias ${s}`);

    // d. El MISMO traspaso dos veces a la vez: un solo movimiento.
    r = await carrera(TRASPASO('d1', 'CF-C144-A-TF', 'CF-C144-C2', 5), TRASPASO('d1', 'CF-C144-A-TF', 'CF-C144-C2', 5));
    s = await inv();
    const movs = (await uno(`SELECT count(*)::int AS n FROM inventario_mov WHERE operacion_id = '14490000-0000-0000-0000-0000000000d1'`)).n;
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && s === '21|25|4|5' && movs === 2,
      `C144d el mismo traspaso dos veces a la vez: la segunda espera y es replay; 2 movimientos de kardex (salida y entrada); existencias ${s}`);

    // e. Ajuste central del CEDIS a 0 y carga de ruta a la vez: el ajuste no toca tiendas y la carga ve el CEDIS vacío.
    r = await carrera(`SELECT ajustar_existencia('14490000-0000-0000-0000-0000000000e1'::uuid, 'P144-C', 0, 'Conteo en cero C144') AS r`, CARGAR(14493));
    s = await inv();
    ok(r.ra.ok && r.ra.r.anterior === 9 && r.bloqueado && !r.rb.ok && /Inventario insuficiente/.test(r.rb.msg) && s === '21|25|0|0',
      `C144e ajuste central a 0 (existencia anterior 9 = solo CEDIS) y carga a la vez: el ajuste no tocó las tiendas y la carga se rechaza; existencias ${s}`);

    // Invariante global.
    const f = await uno(`SELECT
       (SELECT count(*)::int FROM cuartos_frios q, jsonb_each_text(COALESCE(q.stock, '{}'::jsonb)) x WHERE q.id LIKE 'CF-C144-%' AND x.value::int < 0) AS negativos,
       (SELECT count(*)::int FROM rutas WHERE id BETWEEN 14491 AND 14494 AND estatus = 'Cargada') AS cargadas,
       (SELECT count(*)::int FROM inventario_mov WHERE producto = 'P144-C' AND referencia LIKE 'carga_ruta/%' AND cuarto_id NOT IN ('CF-C144-C1', 'CF-C144-C2')) AS cargas_de_tienda,
       (SELECT count(*)::int FROM (SELECT operacion_id, cuarto_id, tipo FROM inventario_mov WHERE producto = 'P144-C' AND operacion_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1) d) AS duplicados`);
    ok(f.negativos === 0 && f.cargadas === 2 && f.cargas_de_tienda === 0 && f.duplicados === 0,
      `C144f tras todas las carreras: 0 existencias negativas, 2 rutas cargadas de 5 intentos, 0 cargas tomadas de una tienda, 0 movimientos duplicados (${JSON.stringify(f)})`);
  } finally {
    await a.end(); await b.end();
    await c.query(LIMPIAR);
  }
  const fin = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos) AS n`);
  ok(fin.h === false && fin.n === 1, `C144g limpieza: interruptor de tiendas APAGADO y solo el CEDIS (${JSON.stringify(fin)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c144({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C144: TODAS OK' : 'RESULTADO: FALLÓ (144 concurrencia)');
  process.exit(todo ? 0 : 1);
}
