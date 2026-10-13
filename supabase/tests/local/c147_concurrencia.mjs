// c147_concurrencia.mjs — Tiendas E6 (mig 147): carreras de configuración y activación con DOS conexiones.
// Lo llama run_local_db.mjs tras aplicar 147; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c147_concurrencia.mjs
// Enciende el interruptor de 143 SOLO para la prueba; al terminar borra todo y lo deja apagado.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sub = (n) => `14790000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const op = (n) => `14790000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`;

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM establecimiento_eventos WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C147');
  DELETE FROM cajas WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C147');
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-C147-%';
  DELETE FROM usuario_establecimientos WHERE usuario_id BETWEEN 14791 AND 14799;
  DELETE FROM establecimientos WHERE clave LIKE '%C147';
  DELETE FROM auditoria WHERE usuario LIKE '%C147%';
  DELETE FROM usuarios WHERE id BETWEEN 14791 AND 14799;
  DELETE FROM auth.users WHERE id::text LIKE '14790000-%';
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;
// 91 y 92: Administración. 93 y 94: cajeros (rol Ventas).
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba C147';
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) SELECT ('14790000-0000-0000-0000-0000000000' || (90 + n))::uuid, 'c' || n || '@c147' FROM generate_series(1, 4) n;
  INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
    SELECT 14790 + n, CASE WHEN n <= 2 THEN 'Admin C147-' ELSE 'Cajero C147-' END || n, 'c' || n || '@c147', CASE WHEN n <= 2 THEN 'Admin' ELSE 'Ventas' END, 'Activo',
           ('14790000-0000-0000-0000-0000000000' || (90 + n))::uuid FROM generate_series(1, 4) n;
  COMMIT;`;

export async function c147({ connect, c, ok }) {
  console.log('── CONCURRENCIA 147 (dos conexiones, cada una con el token de su usuario)');
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

  try {
    // a. Dos administradores dan de alta la MISMA clave a la vez.
    let r = await carrera(91, `SELECT guardar_establecimiento(NULL, 'TFC147', 'Fábrica C147') AS r`, 92, `SELECT guardar_establecimiento(NULL, 'TFC147', 'Fábrica C147 bis') AS r`);
    const n = (await uno(`SELECT count(*)::int AS n FROM establecimientos WHERE clave = 'TFC147'`)).n;
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'CLAVE_REPETIDA' && n === 1 && r.ra.r.activo === false,
      `C147a dos altas simultáneas con la misma clave: una sola tienda (la otra: ${cod(r.rb)}), y nace inactiva`);
    const est = r.ra.r.id;
    await como(a, 91);
    await a.query(`SELECT asignar_cuarto_tienda(${est}, 'CF-C147-TF', 'Congelador C147'), agregar_caja_tienda(${est}, 'Caja 1'), asignar_usuario_tienda(${est}, 14793, false, false)`);

    // b. La misma activación dos veces a la vez (doble clic): una sola activación.
    r = await carrera(91, `SELECT activar_tienda('${op(1)}'::uuid, ${est}, true, 'Apertura C147') AS r`, 91, `SELECT activar_tienda('${op(1)}'::uuid, ${est}, true, 'Apertura C147') AS r`);
    let ev = (await uno(`SELECT count(*)::int AS n FROM establecimiento_eventos WHERE establecimiento_id = ${est} AND tipo = 'activacion'`)).n;
    ok(r.ra.ok && r.ra.r.activo === true && r.bloqueado && r.rb.ok && r.rb.r.replay === true && ev === 1,
      `C147b la misma activación dos veces a la vez: la segunda espera y recibe la misma; ${ev} activación registrada`);

    // c. Dos administradores: uno desactiva y el otro activa (otra operación) a la vez → van uno tras otro, estado final coherente.
    r = await carrera(91, `SELECT activar_tienda('${op(2)}'::uuid, ${est}, false, 'Cierre temporal C147') AS r`, 92, `SELECT activar_tienda('${op(3)}'::uuid, ${est}, true, 'Reapertura C147') AS r`);
    const fin = await uno(`SELECT activo, (SELECT string_agg(tipo, ',' ORDER BY id) FROM establecimiento_eventos WHERE establecimiento_id = ${est}) AS h FROM establecimientos WHERE id = ${est}`);
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.activo === true && fin.activo === true && fin.h === 'alta,activacion,desactivacion,activacion',
      `C147c desactivar y activar a la vez (dos administradores): la segunda espera a la primera; historia ${fin.h}`);

    // d. Activar mientras otro administrador quita al único cajero: nunca queda ACTIVA por una verificación vieja.
    await como(a, 91); await a.query(`SELECT activar_tienda('${op(4)}'::uuid, ${est}, false, 'Preparar la carrera d')`);
    r = await carrera(92, `SELECT retirar_usuario_tienda(${est}, 14793, true) AS r`, 91, `SELECT activar_tienda('${op(5)}'::uuid, ${est}, true, 'Activar sin cajero') AS r`);
    const d = await uno(`SELECT activo FROM establecimientos WHERE id = ${est}`);
    ok(r.ra.ok && r.ra.r.retirado === true && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TIENDA_INCOMPLETA' && d.activo === false,
      `C147d retirar al único cajero y activar a la vez: la activación espera, vuelve a verificar y se rechaza (${cod(r.rb)}); la tienda sigue inactiva`);

    // e. Dos asignaciones simultáneas de la misma persona con permisos distintos: una fila, gana la última.
    r = await carrera(91, `SELECT asignar_usuario_tienda(${est}, 14794, false, false) AS r`, 92, `SELECT asignar_usuario_tienda(${est}, 14794, true, false) AS r`);
    const e = await uno(`SELECT count(*)::int AS n, bool_or(vende_desde_cedis) AS v FROM usuario_establecimientos WHERE establecimiento_id = ${est} AND usuario_id = 14794`);
    ok(r.ra.ok && r.bloqueado && r.rb.ok && e.n === 1 && e.v === true && r.rb.r.nueva === false,
      `C147e dos asignaciones simultáneas de la misma persona: una sola fila; la segunda espera y deja el último permiso`);
  } finally {
    await a.end(); await b.end();
    await c.query(`SELECT set_config('request.jwt.claims', '', false)`);
    await c.query(LIMPIAR);
  }
  const fin = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos) AS n, (SELECT count(*)::int FROM usuario_establecimientos) AS a`);
  ok(fin.h === false && fin.n === 1 && fin.a === 0, `C147f limpieza: interruptor de tiendas APAGADO, solo el CEDIS y sin asignaciones (${JSON.stringify(fin)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c147({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C147: TODAS OK' : 'RESULTADO: FALLÓ (147 concurrencia)');
  process.exit(todo ? 0 : 1);
}
