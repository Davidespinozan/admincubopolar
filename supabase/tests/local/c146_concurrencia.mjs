// c146_concurrencia.mjs — Tiendas E4 (mig 146): carreras del POS con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 146; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c146_concurrencia.mjs
// Crea dos tiendas y una tienda de fábrica SOLO para la prueba (enciende el interruptor de 143 y al
// terminar borra todo y lo deja apagado). Cada conexión lleva el token de un usuario distinto: los
// contratos deciden por ese token, igual que por la API.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sub = (n) => `14690000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const op = (n) => `14690000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`;

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM correcciones_venta_tienda WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C146');
  DELETE FROM devoluciones WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699);
  DELETE FROM ventas_tienda WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C146');
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699);
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699);
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699);
  DELETE FROM inventario_mov WHERE producto = 'P146-C';
  DELETE FROM stock_operaciones WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699) OR operacion_id::text LIKE '14690000-%';
  DELETE FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699;
  DELETE FROM turnos_caja_eventos WHERE turno_id IN (SELECT id FROM turnos_caja WHERE cajero_id BETWEEN 14691 AND 14699);
  DELETE FROM turnos_caja WHERE cajero_id BETWEEN 14691 AND 14699;
  DELETE FROM cajas WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave LIKE '%C146');
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-C146-%';
  DELETE FROM usuario_establecimientos WHERE usuario_id BETWEEN 14691 AND 14699;
  DELETE FROM establecimientos WHERE clave LIKE '%C146';
  DELETE FROM productos WHERE sku = 'P146-C';
  DELETE FROM auditoria WHERE usuario LIKE '%C146%';
  DELETE FROM usuarios WHERE id BETWEEN 14691 AND 14699;
  DELETE FROM auth.users WHERE id::text LIKE '14690000-%';
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;

// Tienda X: 2 cajas, congelador con 1 pieza. Tienda Y: 1 caja, congelador con 5. Fábrica: 2 cajas, congelador vacío. CEDIS: 1 pieza.
// Usuarios: 91 y 92 cajeros de X; 93 cajera de Y; 94 y 95 cajeros de la fábrica CON permiso de CEDIS; 96 Admin.
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba C146';
  INSERT INTO establecimientos (clave, nombre, tipo) VALUES ('TEXXC146', 'Tienda X C146', 'tienda'), ('TEYYC146', 'Tienda Y C146', 'tienda'), ('TFABC146', 'Fábrica C146', 'tienda_fabrica');
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) SELECT ('14690000-0000-0000-0000-0000000000' || (90 + n))::uuid, 'c' || n || '@c146' FROM generate_series(1, 6) n;
  INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id)
    SELECT 14690 + n, CASE WHEN n = 6 THEN 'Admin C146' ELSE 'Cajero C146-' || n END, 'c' || n || '@c146', CASE WHEN n = 6 THEN 'Admin' ELSE 'Ventas' END, 'Activo',
           ('14690000-0000-0000-0000-0000000000' || (90 + n))::uuid FROM generate_series(1, 6) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P146-C', 'Hielo C146', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock, establecimiento_id) VALUES
    ('CF-C146-X', 'Congelador X C146', '{"P146-C": 1}', (SELECT id FROM establecimientos WHERE clave = 'TEXXC146')),
    ('CF-C146-Y', 'Congelador Y C146', '{"P146-C": 5}', (SELECT id FROM establecimientos WHERE clave = 'TEYYC146')),
    ('CF-C146-F', 'Congelador fábrica C146', '{}', (SELECT id FROM establecimientos WHERE clave = 'TFABC146')),
    ('CF-C146-C1', 'CEDIS C146', '{"P146-C": 1}', 1);
  SET LOCAL session_replication_role = origin;
  INSERT INTO usuario_establecimientos (usuario_id, establecimiento_id, vende_desde_cedis, asignado_por)
    SELECT 14690 + n, (SELECT id FROM establecimientos WHERE clave = CASE WHEN n <= 2 THEN 'TEXXC146' WHEN n = 3 THEN 'TEYYC146' ELSE 'TFABC146' END), n >= 4, 'prueba C146' FROM generate_series(1, 5) n;
  INSERT INTO cajas (establecimiento_id, nombre)
    SELECT e.id, 'Caja ' || k FROM establecimientos e, generate_series(1, 2) k WHERE e.clave IN ('TEXXC146', 'TFABC146')
    UNION ALL SELECT e.id, 'Caja 1' FROM establecimientos e WHERE e.clave = 'TEYYC146';
  COMMIT;`;

export async function c146({ connect, c, ok }) {
  console.log('── CONCURRENCIA 146 (dos conexiones, cada una con el token de su usuario)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  const a = await connect(); const b = await connect();
  const como = async (cx, n) => cx.query(`SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub(n)}"}', false), set_config('app.fin_ctx', '', false)`);
  const intento = async (cx, sql) => { try { return { ok: true, r: (await cx.query(sql)).rows[0]?.r }; } catch (e) { return { ok: false, code: e.code, msg: e.message, detail: e.detail || '' }; } };
  // A ejecuta dentro de una transacción abierta; B arranca mientras tanto; se mide si B tuvo que esperar a que A terminara.
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
  const caja = async (clave, nombre) => (await uno(`SELECT c.id FROM cajas c JOIN establecimientos e ON e.id = c.establecimiento_id WHERE e.clave = '${clave}' AND c.nombre = '${nombre}'`)).id;
  // Existencia de P146-C: CEDIS|fábrica|X|Y
  const inv = async () => (await uno(`SELECT string_agg(COALESCE(stock ->> 'P146-C', '0'), '|' ORDER BY id) AS s FROM cuartos_frios WHERE id LIKE 'CF-C146-%'`)).s;
  // Todo lo que una venta deja: órdenes|líneas|pagos|kardex|ventas de tienda|ingresos
  const efectos = async () => (await uno(`SELECT concat_ws('|',
      (SELECT count(*) FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699),
      (SELECT count(*) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.vendedor_id BETWEEN 14691 AND 14699),
      (SELECT count(*) FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.vendedor_id BETWEEN 14691 AND 14699),
      (SELECT count(*) FROM inventario_mov WHERE producto = 'P146-C'),
      (SELECT count(*) FROM ventas_tienda v JOIN establecimientos e ON e.id = v.establecimiento_id WHERE e.clave LIKE '%C146'),
      (SELECT count(*) FROM movimientos_contables m JOIN ordenes o ON o.id = m.orden_id WHERE o.vendedor_id BETWEEN 14691 AND 14699 AND m.tipo = 'Ingreso')) AS s`)).s;
  const ABRIR = (o, cajaId, fondo = 0) => `SELECT abrir_turno_caja('${op(o)}'::uuid, ${cajaId}, ${fondo}) AS r`;
  const VENDER = (o, turno, cuarto, q = 1, metodo = 'Efectivo') => `SELECT vender_en_tienda('${op(o)}'::uuid, ${turno}, '[{"sku": "P146-C", "cantidad": ${q}, "cuarto_id": "${cuarto}"}]'::jsonb, '${metodo}') AS r`;
  const CERRAR = (o, turno, contado, motivo = null) => `SELECT cerrar_turno_caja('${op(o)}'::uuid, ${turno}, ${contado}, ${motivo ? `'${motivo}'` : 'NULL'}) AS r`;
  const CORREGIR = (o, orden, extra = '') => `SELECT corregir_venta_tienda('${op(o)}'::uuid, ${orden}, 'Devolución de prueba C146', 'Reintegrar'${extra}) AS r`;
  const cod = (r) => { try { return JSON.parse(r.detail).codigo; } catch { return r.code; } };

  try {
    const [x1, x2, y1, f1, f2] = [await caja('TEXXC146', 'Caja 1'), await caja('TEXXC146', 'Caja 2'), await caja('TEYYC146', 'Caja 1'), await caja('TFABC146', 'Caja 1'), await caja('TFABC146', 'Caja 2')];

    // 3. Dos cajeros abren la MISMA caja a la vez.
    let r = await carrera(91, ABRIR(1, x1, 100), 92, ABRIR(2, x1, 0));
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'CAJA_OCUPADA',
      `C146-3 dos aperturas simultáneas de la misma caja: la segunda espera y se rechaza (${cod(r.rb)}); queda un solo turno abierto en la caja`);
    const tX1 = r.ra.r.turno_id;

    // 4. El MISMO cajero abre dos cajas a la vez (dos pestañas).
    r = await carrera(92, ABRIR(3, x2, 0), 92, ABRIR(4, x1, 0));
    const abiertos92 = (await uno(`SELECT count(*)::int AS n FROM turnos_caja WHERE cajero_id = 14692 AND estado = 'abierto'`)).n;
    ok(r.ra.ok && !r.rb.ok && ['CAJERO_CON_TURNO', 'CAJA_OCUPADA'].includes(cod(r.rb)) && abiertos92 === 1,
      `C146-4 dos aperturas simultáneas del mismo cajero: solo una entra (la otra: ${cod(r.rb)}); el cajero tiene ${abiertos92} turno abierto`);
    const tX2 = r.ra.r.turno_id;
    // Mismo cajero, dos cajas DISTINTAS y libres: lo decide el índice único por cajero.
    r = await carrera(94, ABRIR(5, f1, 0), 94, ABRIR(6, f2, 0));
    const abiertos94 = (await uno(`SELECT count(*)::int AS n FROM turnos_caja WHERE cajero_id = 14694 AND estado = 'abierto'`)).n;
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'CAJERO_CON_TURNO' && abiertos94 === 1,
      `C146-4b el mismo cajero en dos cajas libres a la vez: la segunda espera al índice único y se rechaza (${cod(r.rb)})`);
    const tF1 = r.ra.r.turno_id;
    await como(b, 95); const tF2 = (await intento(b, ABRIR(7, f2, 0))).r.turno_id;
    await como(b, 93); const tY1 = (await intento(b, ABRIR(8, y1, 0))).r.turno_id;
    await c.query(`SELECT set_config('request.jwt.claims', '', false)`);

    // 1. Dos cajas de la misma tienda venden la ÚLTIMA pieza.
    const e0 = await efectos();
    r = await carrera(91, VENDER(10, tX1, 'CF-C146-X'), 92, VENDER(11, tX2, 'CF-C146-X'));
    let s = await inv(); let e = await efectos();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'SIN_EXISTENCIA' && s === '1|0|0|5',
      `C146-1 dos cajas venden la última pieza: la segunda espera el candado del congelador y se rechaza (${cod(r.rb)}); existencias ${s} (nunca negativo)`);
    // 8. La venta que falló no deja nada.
    ok(e0 === '0|0|0|0|0|0' && e === '1|1|1|1|1|1',
      `C146-8 la venta rechazada no dejó orden, línea, pago, kardex ni ingreso huérfanos: quedó exactamente UNA venta completa (${e})`);
    const orden1 = r.ra.r.orden_id;

    // 5 y 6. Reintento tras perder la conexión y doble clic: el MISMO operacion_id.
    await c.query(`UPDATE cuartos_frios SET stock = '{"P146-C": 5}' WHERE id = 'CF-C146-X'`);
    r = await carrera(91, VENDER(12, tX1, 'CF-C146-X'), 91, VENDER(12, tX1, 'CF-C146-X'));
    s = await inv(); e = await efectos();
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.rb.r.orden_id === r.ra.r.orden_id && r.rb.r.folio === r.ra.r.folio && s === '1|0|4|5' && e === '2|2|2|2|2|2',
      `C146-6 doble clic de cobro (mismo operacion_id a la vez): la segunda espera y devuelve la MISMA venta ${r.ra.r.folio}; una sola salida y un solo pago (${e})`);
    await como(b, 91);
    const rr = await intento(b, VENDER(12, tX1, 'CF-C146-X'));
    e = await efectos();
    ok(rr.ok && rr.r.replay === true && rr.r.orden_id === r.ra.r.orden_id && e === '2|2|2|2|2|2' && (await inv()) === '1|0|4|5',
      `C146-5 reintento después de perder la conexión (la venta ya estaba confirmada): devuelve la venta original, sin duplicar (${e})`);

    // 2. Cierre de turno al mismo tiempo que una venta. Primero la venta: el cierre espera y la CUENTA.
    r = await carrera(91, VENDER(13, tX1, 'CF-C146-X'), 91, CERRAR(20, tX1, 190));
    ok(r.ra.ok && r.bloqueado && r.rb.ok && Number(r.rb.r.efectivo_esperado) === 190 && r.rb.r.totales.ventas === 3 && Number(r.rb.r.diferencia) === 0,
      `C146-2a venta en curso y cierre a la vez: el cierre ESPERA a la venta y la incluye (fondo 100 + 3 ventas de 30 = ${r.rb.r?.efectivo_esperado})`);
    // …y al revés: el cierre va primero; la venta espera y encuentra el turno cerrado.
    const eAntes = await efectos();
    r = await carrera(92, CERRAR(21, tX2, 0), 92, VENDER(14, tX2, 'CF-C146-X'));
    e = await efectos();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && cod(r.rb) === 'TURNO_CERRADO' && e === eAntes,
      `C146-2b cierre en curso y venta a la vez: la venta ESPERA y se rechaza (${cod(r.rb)}); no quedó ninguna venta fuera del cierre`);

    // 7. Reintento del cierre: el mismo operacion_id a la vez.
    r = await carrera(93, CERRAR(22, tY1, 0), 93, CERRAR(22, tY1, 0));
    const cierres = (await uno(`SELECT count(*)::int AS n FROM turnos_caja_eventos WHERE turno_id = ${tY1} AND tipo = 'cierre'`)).n;
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && cierres === 1,
      `C146-7 reintento del cierre (mismo operacion_id a la vez): el segundo espera y recibe el mismo cierre; ${cierres} cierre registrado`);

    // 10. Dos tiendas intentan consumir el mismo origen NO autorizado (el CEDIS) a la vez.
    await como(b, 93); const tY2 = (await intento(b, ABRIR(9, y1, 0))).r.turno_id;
    await como(b, 92); const tX3 = (await intento(b, ABRIR(30, x2, 0))).r.turno_id;
    const eCedis = await efectos();
    r = await carrera(92, VENDER(15, tX3, 'CF-C146-C1'), 93, VENDER(16, tY2, 'CF-C146-C1'));
    s = await inv(); e = await efectos();
    ok(!r.ra.ok && !r.rb.ok && cod(r.ra) === 'CEDIS_SIN_PERMISO' && cod(r.rb) === 'CEDIS_SIN_PERMISO' && s === '1|0|3|5' && e === eCedis,
      `C146-10a dos tiendas sin permiso sobre el CEDIS a la vez: las dos rechazadas (${cod(r.ra)}), el CEDIS intacto (${s}) y sin efectos`);
    // …y entre sí: cada una intenta el congelador de la OTRA.
    r = await carrera(92, VENDER(17, tX3, 'CF-C146-Y'), 93, VENDER(18, tY2, 'CF-C146-X'));
    ok(!r.ra.ok && !r.rb.ok && cod(r.ra) === 'INVENTARIO_DE_OTRA_TIENDA' && cod(r.rb) === 'INVENTARIO_DE_OTRA_TIENDA' && (await inv()) === '1|0|3|5',
      `C146-10b dos tiendas intentando el congelador de la otra a la vez: las dos rechazadas (${cod(r.ra)})`);
    // Con permiso (dos cajas de la tienda de fábrica) compiten por la última pieza del CEDIS: una sola la vende.
    r = await carrera(94, VENDER(19, tF1, 'CF-C146-C1'), 95, VENDER(31, tF2, 'CF-C146-C1'));
    s = await inv();
    ok(r.ra.ok && r.ra.r.desde_cedis === true && r.bloqueado && !r.rb.ok && cod(r.rb) === 'SIN_EXISTENCIA' && s === '0|0|3|5',
      `C146-10c dos cajas CON permiso por la última pieza del CEDIS: una la vende y la otra se rechaza (${cod(r.rb)}); existencias ${s}`);

    // 9. Corrección repetida: el mismo operacion_id a la vez, y dos correcciones distintas de la misma venta.
    r = await carrera(96, CORREGIR(40, orden1), 96, CORREGIR(40, orden1));
    let dev = (await uno(`SELECT count(*)::int AS n FROM devoluciones WHERE orden_id = ${orden1}`)).n;
    s = await inv();
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.rb.r.correccion_id === r.ra.r.correccion_id && dev === 1 && s === '0|0|4|5',
      `C146-9a corrección repetida (mismo operacion_id a la vez): la segunda espera y recibe la misma; ${dev} devolución y un solo reingreso (${s})`);
    const orden2 = (await uno(`SELECT orden_id FROM ventas_tienda WHERE operacion_id = '${op(12)}'`)).orden_id;
    r = await carrera(96, CORREGIR(41, orden2), 96, CORREGIR(42, orden2));
    dev = (await uno(`SELECT count(*)::int AS n FROM devoluciones WHERE orden_id = ${orden2}`)).n;
    const corr = (await uno(`SELECT count(*)::int AS n FROM correcciones_venta_tienda WHERE orden_id = ${orden2}`)).n;
    s = await inv();
    ok(r.ra.ok && r.bloqueado && !r.rb.ok && dev === 1 && corr === 1 && s === '0|0|5|5',
      `C146-9b dos correcciones distintas de la misma venta a la vez: solo una entra (la otra: ${cod(r.rb)}); ${dev} devolución, ${corr} corrección (${s})`);

    // Orden de candados: corrección con efectivo de caja + venta + cierre sobre el mismo turno, sin abrazo mortal.
    await como(b, 91); const tX4 = (await intento(b, ABRIR(32, x1, 0))).r.turno_id;
    const v4 = (await intento(b, VENDER(33, tX4, 'CF-C146-X'))).r;
    r = await carrera(96, CORREGIR(43, v4.orden_id, `, NULL, NULL, 'efectivo_caja', true, ${tX4}`), 91, VENDER(34, tX4, 'CF-C146-X'));
    const r2 = await carrera(91, VENDER(35, tX4, 'CF-C146-X'), 96, CORREGIR(44, r.rb.r?.orden_id ?? 0, `, NULL, NULL, 'efectivo_caja', true, ${tX4}`));
    await como(b, 91);
    const z = await intento(b, CERRAR(45, tX4, 30));
    ok(r.ra.ok && r.bloqueado && r.rb.ok && r2.ra.ok && r2.bloqueado && r2.rb.ok && z.ok && Number(z.r.efectivo_esperado) === 30 && z.r.totales.ventas === 3
       && Number(z.r.totales.reembolsos_efectivo_caja) === 60,
      `C146-11 corrección con efectivo de la caja, venta y cierre sobre el mismo turno, en los dos órdenes: todos esperan su turno, sin "deadlock"; esperado ${z.r?.efectivo_esperado} (3 ventas de 30 − 2 reembolsos de caja)`);

    // Invariante global.
    const f = await uno(`SELECT
       (SELECT count(*)::int FROM cuartos_frios q, jsonb_each_text(COALESCE(q.stock, '{}'::jsonb)) x WHERE q.id LIKE 'CF-C146-%' AND x.value::int < 0) AS negativos,
       (SELECT count(*)::int FROM (SELECT caja_id FROM turnos_caja WHERE estado = 'abierto' GROUP BY 1 HAVING count(*) > 1) d) AS cajas_dobles,
       (SELECT count(*)::int FROM (SELECT cajero_id FROM turnos_caja WHERE estado = 'abierto' GROUP BY 1 HAVING count(*) > 1) d) AS cajeros_dobles,
       (SELECT count(*)::int FROM ordenes o WHERE o.vendedor_id BETWEEN 14691 AND 14699
          AND (o.estatus <> 'Entregada' OR o.turno_id IS NULL OR (SELECT COALESCE(sum(p.monto), 0) FROM pagos p WHERE p.orden_id = o.id) <> o.total
               OR NOT EXISTS (SELECT 1 FROM ventas_tienda v WHERE v.orden_id = o.id))) AS ventas_incompletas,
       (SELECT count(*)::int FROM pagos p WHERE NOT EXISTS (SELECT 1 FROM ordenes o WHERE o.id = p.orden_id) AND p.usuario_id BETWEEN 14691 AND 14699) AS pagos_huerfanos,
       (SELECT count(*)::int FROM (SELECT orden_id FROM devoluciones WHERE orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699) GROUP BY 1 HAVING count(*) > 1) d) AS devoluciones_dobles,
       (SELECT count(*)::int FROM cuentas_por_cobrar x WHERE x.orden_id IN (SELECT id FROM ordenes WHERE vendedor_id BETWEEN 14691 AND 14699)) AS cxc`);
    ok(Object.values(f).every(v => v === 0),
      `C146-12 tras todas las carreras: 0 existencias negativas, 0 cajas y 0 cajeros con dos turnos abiertos, 0 ventas incompletas, 0 pagos huérfanos, 0 devoluciones dobles, 0 CxC (${JSON.stringify(f)})`);
  } finally {
    await a.end(); await b.end();
    await c.query(`SELECT set_config('request.jwt.claims', '', false)`);
    await c.query(LIMPIAR);
  }
  const fin = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos) AS n, (SELECT count(*)::int FROM cajas) AS cajas, (SELECT count(*)::int FROM turnos_caja) AS turnos`);
  ok(fin.h === false && fin.n === 1 && fin.cajas === 0 && fin.turnos === 0, `C146-13 limpieza: interruptor de tiendas APAGADO, solo el CEDIS, sin cajas ni turnos (${JSON.stringify(fin)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c146({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C146: TODAS OK' : 'RESULTADO: FALLÓ (146 concurrencia)');
  process.exit(todo ? 0 : 1);
}
