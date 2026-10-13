// c150_concurrencia.mjs — Tiendas E9 (mig 150): último cajero de una tienda activa, con DOS conexiones.
// Lo llama run_local_db.mjs tras aplicar 150; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c150_concurrencia.mjs
// Enciende el interruptor de 143 SOLO para la prueba; al terminar borra todo y lo deja apagado.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sub = (n) => `15090000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const op = (n) => `15090000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`;

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM establecimiento_eventos WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C150');
  DELETE FROM cajas WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C150');
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-C150-%';
  DELETE FROM usuario_establecimientos WHERE usuario_id BETWEEN 15091 AND 15099;
  DELETE FROM establecimientos WHERE clave LIKE '%C150';
  DELETE FROM auditoria WHERE usuario LIKE '%C150%';
  DELETE FROM bitacora_cambios WHERE tabla = 'usuarios' AND registro_id IN ('15091', '15092', '15093', '15094');
  DELETE FROM usuarios WHERE id BETWEEN 15091 AND 15099;
  DELETE FROM auth.users WHERE id::text LIKE '15090000-%';
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;
// 91 y 92: Administración. 93 y 94: cajeros (rol Ventas).
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba C150';
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) SELECT ('15090000-0000-0000-0000-0000000000' || (90 + n))::uuid, 'c' || n || '@c150' FROM generate_series(1, 4) n;
  INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
    SELECT 15090 + n, CASE WHEN n <= 2 THEN 'Admin C150-' ELSE 'Cajero C150-' END || n, 'c' || n || '@c150', CASE WHEN n <= 2 THEN 'Admin' ELSE 'Ventas' END, 'Activo',
           ('15090000-0000-0000-0000-0000000000' || (90 + n))::uuid FROM generate_series(1, 4) n;
  COMMIT;`;

export async function c150({ connect, c, ok }) {
  console.log('── CONCURRENCIA 150 (dos conexiones, cada una con el token de su usuario)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  const a = await connect(); const b = await connect();
  const como = async (cx, n) => cx.query(`SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub(n)}"}', false), set_config('app.fin_ctx', '', false)`);
  const intento = async (cx, sql) => { try { return { ok: true, r: (await cx.query(sql)).rows[0]?.r }; } catch (e) { return { ok: false, code: e.code, msg: e.message, detail: e.detail || '' }; } };
  const carrera = async (nA, sqlA, nB, sqlB) => {
    await como(a, nA); await como(b, nB);
    await a.query('BEGIN');
    const ra = await intento(a, sqlA);
    let done = false;
    const prB = intento(b, sqlB).finally(() => { done = true; });
    await sleep(600);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    return { ra, rb, bloqueado };
  };
  const uno = async (sql) => (await c.query(sql)).rows[0];
  const cod = (r) => { try { return JSON.parse(r.detail).codigo; } catch { return r.code; } };
  const admin = async (sql) => { await como(a, 91); return a.query(sql); };
  const baja = (id, n) => `SELECT guardar_usuario(${id}, 'Cajero C150-${n}', 'Ventas', 'Inactivo') AS r`;
  const alta = (id, n) => `SELECT guardar_usuario(${id}, 'Cajero C150-${n}', 'Ventas', 'Activo') AS r`;
  let est;
  // Cajeros habilitados de la tienda y su estado.
  const foto = async () => uno(`SELECT e.activo, (SELECT count(*)::int FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                                   WHERE ue.establecimiento_id = e.id AND u.rol = 'Ventas' AND u.estatus = 'Activo') AS cajeros,
                                   (SELECT string_agg(u.id || ':' || u.estatus, ',' ORDER BY u.id) FROM usuarios u WHERE u.id IN (15093, 15094)) AS u
                                  FROM establecimientos e WHERE e.id = ${est}`);
  const reponer = async () => {       // los dos cajeros activos y asignados, tienda activa
    await admin(alta(15093, 3)); await admin(alta(15094, 4));
    await admin(`SELECT asignar_usuario_tienda(${est}, 15093, false, false), asignar_usuario_tienda(${est}, 15094, false, false)`);
    await admin(`SELECT activar_tienda(gen_random_uuid(), ${est}, true, 'Reponer C150')`);
  };

  try {
    await como(a, 91);
    est = (await a.query(`SELECT guardar_establecimiento(NULL, 'TFC150', 'Fábrica C150') AS r`)).rows[0].r.id;
    await a.query(`SELECT asignar_cuarto_tienda(${est}, 'CF-C150-TF', 'Congelador C150'), agregar_caja_tienda(${est}, 'Caja 1')`);
    await reponer();

    // a. Dos administradores dan de baja A LA VEZ a los dos únicos cajeros (uno cada uno).
    let r = await carrera(91, baja(15093, 3), 92, baja(15094, 4));
    let f = await foto();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'ULTIMO_CAJERO' && f.activo === true && f.cajeros === 1 && f.u === '15093:Inactivo,15094:Activo',
      `C150a dos bajas simultáneas de los dos únicos cajeros: la segunda espera y se rechaza (${cod(r.rb)}); la tienda sigue activa con 1 cajero`);

    // b. Baja de un cajero (guardar_usuario) y retiro del otro (contrato) a la vez.
    await reponer();
    r = await carrera(91, baja(15093, 3), 92, `SELECT retirar_usuario_tienda(${est}, 15094, true) AS r`);
    f = await foto();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'ULTIMO_CAJERO' && f.cajeros === 1,
      `C150b baja de un cajero y retiro del otro a la vez: el retiro espera y se rechaza (${cod(r.rb)}); queda 1 cajero`);

    // c. Al revés: primero el retiro por contrato, y a la vez la baja del otro.
    await reponer();
    r = await carrera(91, `SELECT retirar_usuario_tienda(${est}, 15093, true) AS r`, 92, baja(15094, 4));
    f = await foto();
    ok(r.ra.ok && r.ra.r.retirado === true && r.bloqueado && !r.rb.ok && cod(r.rb) === 'ULTIMO_CAJERO' && f.cajeros === 1 && f.u === '15093:Activo,15094:Activo',
      `C150c retiro de un cajero y baja del otro a la vez: la baja espera y se rechaza (${cod(r.rb)}); queda 1 cajero`);

    // d. Activar la tienda mientras otro administrador da de baja a su único cajero (y al revés).
    await reponer();
    await admin(`SELECT retirar_usuario_tienda(${est}, 15094, true)`);
    await admin(`SELECT activar_tienda('${op(1)}'::uuid, ${est}, false, 'Preparar la carrera d')`);
    r = await carrera(91, `SELECT activar_tienda('${op(2)}'::uuid, ${est}, true, 'Activar') AS r`, 92, baja(15093, 3));
    f = await foto();
    ok(r.ra.ok && r.ra.r.activo === true && r.bloqueado && !r.rb.ok && cod(r.rb) === 'ULTIMO_CAJERO' && f.activo === true && f.cajeros === 1,
      `C150d activar y dar de baja al único cajero a la vez: la baja espera, ve la tienda ya ACTIVA y se rechaza (${cod(r.rb)})`);
    await admin(`SELECT activar_tienda('${op(3)}'::uuid, ${est}, false, 'Preparar la carrera d2')`);
    r = await carrera(92, baja(15093, 3), 91, `SELECT activar_tienda('${op(4)}'::uuid, ${est}, true, 'Activar sin cajero') AS r`);
    f = await foto();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TIENDA_INCOMPLETA' && f.activo === false && f.cajeros === 0,
      `C150d2 al revés (tienda inactiva: la baja pasa) y la activación simultánea espera, vuelve a verificar y se rechaza (${cod(r.rb)})`);

    // e. La MISMA persona, candados cruzados: una sesión ya tiene la tienda y pide a la persona; la otra
    //    tiene a la persona y pide la tienda. Postgres aborta una (40P01) y no queda nada a medias.
    await reponer();
    await como(a, 91); await como(b, 92);
    await a.query('BEGIN');
    await a.query(`SELECT 1 FROM establecimientos WHERE id = ${est} FOR UPDATE`);
    const prB = intento(b, baja(15093, 3));                      // toma a la persona y espera la tienda
    await sleep(500);
    const ra = await intento(a, `SELECT retirar_usuario_tienda(${est}, 15093, true) AS r`);   // tiene la tienda y pide a la persona
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    f = await foto();
    const asignado = (await uno(`SELECT count(*)::int AS n FROM usuario_establecimientos WHERE establecimiento_id = ${est} AND usuario_id = 15093`)).n;
    const limpio = [ra, rb].filter(x => !x.ok).every(x => x.code === '40P01');
    ok(limpio && (ra.ok || rb.ok) && f.activo === true && f.cajeros >= 1 && ((ra.ok && asignado === 0) || (!ra.ok && asignado === 1)),
      `C150e retiro y baja de la MISMA persona con candados cruzados: ${ra.ok && rb.ok ? 'las dos pasan en orden' : 'Postgres aborta una (40P01) y la otra queda completa'}; la tienda conserva ${f.cajeros} cajero(s)`);

    // f. Invariante global.
    const inv = await uno(`SELECT count(*)::int AS n FROM establecimientos e WHERE e.tipo <> 'cedis' AND e.activo
                             AND NOT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                                              WHERE ue.establecimiento_id = e.id AND u.rol = 'Ventas' AND u.estatus = 'Activo')`);
    ok(inv.n === 0, `C150f invariante: ninguna tienda ACTIVA sin cajero habilitado (${inv.n})`);
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await a.end(); await b.end();
    await c.query(`SELECT set_config('request.jwt.claims', '', false)`);
    await c.query(LIMPIAR);
  }
  const fin = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos) AS n, (SELECT count(*)::int FROM usuario_establecimientos) AS a`);
  ok(fin.h === false && fin.n === 1 && fin.a === 0, `C150g limpieza: interruptor de tiendas APAGADO, solo el CEDIS y sin asignaciones (${JSON.stringify(fin)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c150({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C150: TODAS OK' : 'RESULTADO: FALLÓ (150 concurrencia)');
  process.exit(todo ? 0 : 1);
}
