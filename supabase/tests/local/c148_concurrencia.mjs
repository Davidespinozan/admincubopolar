// c148_concurrencia.mjs — Tiendas E7 (mig 148): carreras de traspasos con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 148; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c148_concurrencia.mjs
// Enciende el interruptor de 143 SOLO para la prueba; al terminar borra todo y lo deja apagado.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sub = (n) => `14890000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const op = (n) => `14890000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`;

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM traspaso_eventos WHERE traspaso_id IN (SELECT id FROM traspasos WHERE cuarto_origen LIKE 'CF-C148-%' OR cuarto_destino LIKE 'CF-C148-%');
  DELETE FROM traspaso_lineas WHERE sku = 'P148-C';
  DELETE FROM traspasos WHERE cuarto_origen LIKE 'CF-C148-%' OR cuarto_destino LIKE 'CF-C148-%';
  DELETE FROM ventas_tienda WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C148');
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14891 AND 14899);
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14891 AND 14899);
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14891 AND 14899);
  DELETE FROM inventario_mov WHERE producto = 'P148-C';
  DELETE FROM stock_operaciones WHERE operacion_id::text LIKE '14890000-%' OR orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14891 AND 14899);
  DELETE FROM ordenes WHERE vendedor_id BETWEEN 14891 AND 14899;
  DELETE FROM turnos_caja_eventos WHERE turno_id IN (SELECT id FROM turnos_caja WHERE cajero_id BETWEEN 14891 AND 14899);
  DELETE FROM turnos_caja WHERE cajero_id BETWEEN 14891 AND 14899;
  DELETE FROM cajas WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C148');
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-C148-%';
  DELETE FROM usuario_establecimientos WHERE usuario_id BETWEEN 14891 AND 14899;
  DELETE FROM establecimiento_eventos WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C148');
  DELETE FROM establecimientos WHERE clave LIKE '%C148';
  DELETE FROM productos WHERE sku = 'P148-C';
  DELETE FROM auditoria WHERE usuario LIKE '%C148%';
  DELETE FROM usuarios WHERE id BETWEEN 14891 AND 14899;
  DELETE FROM auth.users WHERE id::text LIKE '14890000-%';
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;
// 91 y 92: Administración. 93: cajera de la tienda remota (con permiso de recibir).
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba C148';
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) SELECT ('14890000-0000-0000-0000-0000000000' || (90 + n))::uuid, 'c' || n || '@c148' FROM generate_series(1, 3) n;
  INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
    SELECT 14890 + n, CASE WHEN n <= 2 THEN 'Admin C148-' ELSE 'Cajera C148-' END || n, 'c' || n || '@c148', CASE WHEN n <= 2 THEN 'Admin' ELSE 'Ventas' END, 'Activo',
           ('14890000-0000-0000-0000-0000000000' || (90 + n))::uuid FROM generate_series(1, 3) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P148-C', 'Hielo C148', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-C148-C1', 'CEDIS C148', '{"P148-C": 10}');
  COMMIT;`;

export async function c148({ connect, c, ok }) {
  console.log('── CONCURRENCIA 148 (dos conexiones, cada una con el token de su usuario)');
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
  // Existencia de P148-C: CEDIS|tienda
  const inv = async () => (await uno(`SELECT string_agg(COALESCE(stock ->> 'P148-C', '0'), '|' ORDER BY id) AS s FROM cuartos_frios WHERE id LIKE 'CF-C148-%'`)).s;
  let nOp = 100;
  const sig = () => op(++nOp);

  try {
    await como(a, 91);
    const est = (await intento(a, `SELECT guardar_establecimiento(NULL, 'TRC148', 'Remota C148', 'tienda') AS r`)).r.id;
    await a.query(`SELECT asignar_cuarto_tienda(${est}, 'CF-C148-T', 'Congelador remota C148'), agregar_caja_tienda(${est}, 'Caja 1'), asignar_usuario_tienda(${est}, 14893, false, false)`);
    await a.query(`SELECT activar_tienda('${op(1)}'::uuid, ${est}, true), definir_recepcion_tienda(${est}, 14893, true)`);
    const CREAR = (q) => `SELECT crear_traspaso('${sig()}'::uuid, 1, ${est}, 'CF-C148-C1', 'CF-C148-T', '[{"sku": "P148-C", "cantidad": ${q}}]'::jsonb, 'Chofer de prueba C148') AS r`;
    // Las carreras cambian el usuario de cada conexión: lo administrativo vuelve a fijar a Administración.
    const admin = async (sql) => { await como(a, 91); return intento(a, sql); };
    const crear = async (q) => (await admin(CREAR(q))).r.traspaso_id;
    const DESP = (o, t) => `SELECT despachar_traspaso('${o}'::uuid, ${t}) AS r`;
    const RECIBIR = (o, t, q, d = 0, nota = null) => `SELECT recibir_traspaso('${o}'::uuid, ${t}, '[{"sku": "P148-C", "recibida": ${q}, "danada": ${d}}]'::jsonb, ${nota ? `'${nota}'` : 'NULL'}) AS r`;

    // 9. Dos traspasos compiten por el mismo inventario (10 en el CEDIS; cada uno pide 8).
    let t1 = await crear(8); let t2 = await crear(8);
    let r = await carrera(91, DESP(sig(), t1), 92, DESP(sig(), t2));
    let s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'SIN_EXISTENCIA' && s === '2|0',
      `C148-9 dos despachos por el mismo producto: el segundo espera el candado del cuarto y se rechaza (${cod(r.rb)}); CEDIS ${s.split('|')[0]} (nunca negativo), la tienda aún en 0`);

    // 3. Doble despacho del MISMO traspaso: mismo operacion_id (doble clic) y operaciones distintas (dos administradores).
    await c.query(`UPDATE cuartos_frios SET stock = '{"P148-C": 20}' WHERE id = 'CF-C148-C1'`);
    const o3 = sig();
    r = await carrera(91, DESP(o3, t2), 91, DESP(o3, t2));
    const mismo = r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true;
    const t3 = await crear(1);
    const r3 = await carrera(91, DESP(sig(), t3), 92, DESP(sig(), t3));
    s = await inv();
    const salidas = (await uno(`SELECT count(*)::int AS n FROM inventario_mov WHERE producto = 'P148-C' AND tipo = 'Traspaso salida'`)).n;
    ok(mismo && r3.ra.ok && r3.bloqueado && !r3.rb.ok && cod(r3.rb) === 'TRASPASO_YA_DESPACHADO' && s === '11|0' && salidas === 3,
      `C148-3 doble despacho: con el mismo operacion_id la segunda recibe la misma respuesta; con otro, se rechaza (${cod(r3.rb)}); ${salidas} salidas para 3 traspasos (CEDIS ${s.split('|')[0]})`);

    // 4. Recepción duplicada a la vez: Administración y la cajera de la tienda reciben el mismo traspaso.
    r = await carrera(93, RECIBIR(sig(), t1, 8), 91, RECIBIR(sig(), t1, 8));
    s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TRASPASO_NO_EN_TRANSITO' && s === '11|8',
      `C148-4 dos recepciones del mismo traspaso a la vez: la segunda espera y se rechaza (${cod(r.rb)}); la tienda subió UNA vez (${s.split('|')[1]})`);
    const o4 = sig();
    r = await carrera(93, RECIBIR(o4, t2, 7, 1, 'Una bolsa rota'), 93, RECIBIR(o4, t2, 7, 1, 'Una bolsa rota'));
    s = await inv();
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && s === '11|15',
      `C148-4b la misma recepción dos veces (doble clic): misma respuesta; entraron 7 buenas una sola vez (tienda ${s.split('|')[1]})`);

    // 10. Venta del POS al mismo tiempo que una recepción en el mismo congelador.
    await como(b, 93);
    const turno = (await intento(b, `SELECT abrir_turno_caja('${sig()}'::uuid, (SELECT id FROM cajas WHERE establecimiento_id = ${est} LIMIT 1), 0) AS r`)).r.turno_id;
    const VENDER = (q) => `SELECT vender_en_tienda('${sig()}'::uuid, ${turno}, '[{"sku": "P148-C", "cantidad": ${q}}]'::jsonb, 'Efectivo') AS r`;
    r = await carrera(91, RECIBIR(sig(), t3, 1), 93, VENDER(5));
    s = await inv();
    const a10 = r.ra.ok && r.bloqueado && r.rb.ok && s === '11|11';
    const t4 = await crear(4);
    await admin(DESP(sig(), t4));
    const r10 = await carrera(93, VENDER(11), 91, RECIBIR(sig(), t4, 4));
    s = await inv();
    ok(a10 && r10.ra.ok && r10.bloqueado && r10.rb.ok && s === '7|4',
      `C148-10 venta del POS y recepción a la vez, en los dos órdenes: la segunda espera a la primera y las dos se aplican; existencia final exacta (CEDIS ${s.split('|')[0]}, tienda ${s.split('|')[1]}), sin "deadlock"`);
    // …y la venta que necesita lo que viene en camino NO se adelanta: sin recibir, no hay producto.
    const t5 = await crear(3);
    await admin(DESP(sig(), t5));
    await como(b, 93);
    const sinRecibir = await intento(b, VENDER(5));
    ok(!sinRecibir.ok && cod(sinRecibir) === 'SIN_EXISTENCIA' && (await inv()) === '4|4', `C148-10b el producto en tránsito todavía no se puede vender (${cod(sinRecibir)}): solo cuenta lo recibido`);

    // 8. Cancelar y despachar a la vez; recibir y retornar a la vez.
    const t6 = await crear(2);
    r = await carrera(91, DESP(sig(), t6), 92, `SELECT cancelar_traspaso('${sig()}'::uuid, ${t6}, 'Cancelación en carrera') AS r`);
    const e6 = (await uno(`SELECT estado FROM traspasos WHERE id = ${t6}`)).estado;
    const a8 = r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TRASPASO_EN_TRANSITO' && e6 === 'en_transito';
    const t7 = await crear(1);
    const r8 = await carrera(91, `SELECT cancelar_traspaso('${sig()}'::uuid, ${t7}, 'Cancelación en carrera') AS r`, 92, DESP(sig(), t7));
    s = await inv();
    ok(a8 && r8.ra.ok && r8.bloqueado && !r8.rb.ok && cod(r8.rb) === 'TRASPASO_YA_DESPACHADO' && s === '2|4',
      `C148-8 cancelar y despachar a la vez: si el despacho gana, la cancelación se rechaza (${cod(r.rb)}) y el producto sigue en tránsito; si la cancelación gana, no sale nada (${cod(r8.rb)})`);
    r = await carrera(93, RECIBIR(sig(), t5, 3), 91, `SELECT retornar_traspaso('${sig()}'::uuid, ${t5}, '[{"sku": "P148-C", "recibida": 3}]'::jsonb, 'Retorno en carrera') AS r`);
    s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TRASPASO_NO_EN_TRANSITO' && s === '2|7',
      `C148-8b recibir en la tienda y retornar al origen a la vez: solo una ocurre (${cod(r.rb)}); el producto no queda en los dos lados (${s})`);

    // Invariante global: lo que salió del CEDIS está en la tienda, vendido, en tránsito o registrado como dañado/faltante.
    const f = await uno(`SELECT
       (SELECT count(*)::int FROM cuartos_frios q, jsonb_each_text(COALESCE(q.stock, '{}'::jsonb)) x WHERE q.id LIKE 'CF-C148-%' AND x.value::int < 0) AS negativos,
       (SELECT count(*)::int FROM (SELECT operacion_id, cuarto_id, tipo FROM inventario_mov WHERE producto = 'P148-C' AND referencia LIKE 'traspaso/%' GROUP BY 1, 2, 3 HAVING count(*) > 1) d) AS duplicados,
       (SELECT count(*)::int FROM traspaso_lineas WHERE sku = 'P148-C' AND cantidad_recibida IS NOT NULL AND cantidad_recibida + cantidad_danada + cantidad_faltante <> cantidad_despachada) AS descuadres,
       (SELECT COALESCE(sum(cantidad_despachada), 0)::int FROM traspaso_lineas l JOIN traspasos t ON t.id = l.traspaso_id WHERE l.sku = 'P148-C' AND t.estado = 'en_transito') AS en_camino,
       (SELECT COALESCE(sum(cantidad_danada + cantidad_faltante), 0)::int FROM traspaso_lineas WHERE sku = 'P148-C') AS perdidas,
       (SELECT COALESCE(sum(l.cantidad), 0)::int FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE l.sku = 'P148-C' AND o.vendedor_id = 14893) AS vendidas`);
    // 30 piezas pasaron por el CEDIS (10 iniciales + 20 que se le pusieron): 2 quedan ahí, 7 en la tienda, 16 vendidas, 2 en camino (t6), 1 dañada … y 2 nunca salieron (t7 cancelado).
    ok(f.negativos === 0 && f.duplicados === 0 && f.descuadres === 0 && f.en_camino === 2 && f.perdidas === 1 && f.vendidas === 16 && 2 + 7 + f.vendidas + f.en_camino + f.perdidas === 28,
      `C148-12 tras todas las carreras: 0 existencias negativas, 0 movimientos duplicados, 0 líneas descuadradas; cuentas completas (${JSON.stringify(f)})`);
  } finally {
    await a.end(); await b.end();
    await c.query(`SELECT set_config('request.jwt.claims', '', false)`);
    await c.query(LIMPIAR);
  }
  const fin = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos) AS n, (SELECT count(*)::int FROM traspasos) AS t`);
  ok(fin.h === false && fin.n === 1 && fin.t === 0, `C148-13 limpieza: interruptor de tiendas APAGADO, solo el CEDIS y sin traspasos (${JSON.stringify(fin)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c148({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C148: TODAS OK' : 'RESULTADO: FALLÓ (148 concurrencia)');
  process.exit(todo ? 0 : 1);
}
