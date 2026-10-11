// c139_concurrencia.mjs — T5-B (mig 139): carreras de crédito con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 139; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c139_concurrencia.mjs
// Sesiones sin JWT (de confianza): la validación de crédito y los candados son los mismos.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 13991 AND 13999;
  DELETE FROM pagos WHERE cliente_id BETWEEN 13991 AND 13999 OR orden_id BETWEEN 13960 AND 13989;
  DELETE FROM movimientos_contables WHERE orden_id BETWEEN 13960 AND 13989 OR concepto LIKE '%C139%';
  DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 13991 AND 13999;
  DELETE FROM inventario_mov WHERE producto = 'P139-C';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 13991 AND 13999;
  DELETE FROM orden_lineas WHERE orden_id BETWEEN 13960 AND 13989;
  DELETE FROM ordenes WHERE id BETWEEN 13960 AND 13989;
  DELETE FROM rutas WHERE id BETWEEN 13991 AND 13999;
  DELETE FROM auditoria WHERE detalle LIKE 'OV-1396%' OR detalle LIKE 'OV-1397%' OR detalle LIKE 'OV-1398%';
  DELETE FROM clientes WHERE id BETWEEN 13991 AND 13999;
  DELETE FROM cuartos_frios WHERE id = 'CF-139C';
  DELETE FROM productos WHERE sku = 'P139-C';
  DELETE FROM usuarios WHERE id BETWEEN 13991 AND 13999;
  COMMIT;`;

// Dos rutas (dos choferes) con 40 de P139-C cada una. Cada orden: 4 × $30 = $120.
// Cliente 13991: límite 150 (cabe UNA de 120). 13992: límite 150 y ya debe 120 (le quedan 30).
// 13993 y 13994: límite 1000.
const SEMBRAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  INSERT INTO usuarios (id, nombre, email, rol, estatus) VALUES (13991, 'Chofer C139-1', 'c1@c139', 'Chofer', 'Activo'), (13992, 'Chofer C139-2', 'c2@c139', 'Chofer', 'Activo');
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P139-C', 'Hielo C139', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-139C', 'Cuarto C139', '{"P139-C": 500}');
  INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES
    (13991, 'Dos choferes C139', 'XAXX010101000', 0, true, 150), (13992, 'Abono C139', 'XAXX010101000', 120, true, 150),
    (13993, 'Reintento C139', 'XAXX010101000', 0, true, 1000), (13994, 'Cierre C139', 'XAXX010101000', 0, true, 1000);
  INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, delivered_at) VALUES
    (13960, 'OV-13960', 13992, 'Abono C139', '4×C', 120, 'Entregada', 'Crédito', 'Credito', now() - interval '2 days');
  INSERT INTO cuentas_por_cobrar (cliente_id, orden_id, fecha_venta, fecha_vencimiento, monto_original, monto_pagado, saldo_pendiente, concepto, estatus)
    VALUES (13992, 13960, CURRENT_DATE - 2, CURRENT_DATE + 28, 120, 0, 120, 'OV-13960 — Abono C139', 'Pendiente');
  INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at) VALUES
    (13991, 'R-13991', 'C139 uno', 13991, 'Chofer C139-1', 'Pendiente firma', CURRENT_DATE, '{"P139-C": 40}', '{"P139-C": 40}', '{}', '{"P139-C": 40}', now()),
    (13992, 'R-13992', 'C139 dos', 13992, 'Chofer C139-2', 'Pendiente firma', CURRENT_DATE, '{"P139-C": 40}', '{"P139-C": 40}', '{}', '{"P139-C": 40}', now());
  INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
    (13961, 'OV-13961', 13991, 'Dos choferes C139', '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13991),
    (13962, 'OV-13962', 13991, 'Dos choferes C139', '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13992),
    (13963, 'OV-13963', 13992, 'Abono C139',        '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13991),
    (13964, 'OV-13964', 13993, 'Reintento C139',    '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13991),
    (13965, 'OV-13965', 13993, 'Reintento C139',    '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13992),
    (13966, 'OV-13966', 13994, 'Cierre C139',       '4×C', 120, 'Asignada', 'Crédito', 'Credito', 13992);
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'P139-C', 4, 30, 120 FROM ordenes WHERE id BETWEEN 13960 AND 13966;
  COMMIT;`;

const CARGAR = (ruta) => `SELECT confirmar_carga_ruta('13990000-0000-0000-0000-00000000c00${ruta - 13990}'::uuid, ${ruta}, 'data:image/png;base64,QQ==', true, 'Prueba C139')`;
const ENTREGAR = (op, orden, metodo) => `SELECT entregar_orden_ruta('13990000-0000-0000-0000-0000000000${op}'::uuid, ${orden}, '${metodo}') AS r`;

export async function c139({ connect, c, ok }) {
  console.log('── CONCURRENCIA 139 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  for (const r of [13991, 13992]) {
    await c.query(CARGAR(r));
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE rutas SET estatus = 'En progreso' WHERE id = ${r}; COMMIT;`);
  }
  const a = await connect(); const b = await connect();
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
  const uno = async (sql) => (await c.query(sql)).rows[0];
  const cliente = (id) => uno(`SELECT (SELECT saldo::int FROM clientes WHERE id = ${id}) AS saldo, (SELECT limite_credito::int FROM clientes WHERE id = ${id}) AS limite,
     (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM cuentas_por_cobrar WHERE cliente_id = ${id} AND estatus IS DISTINCT FROM 'Pagada') AS cxc,
     (SELECT count(*)::int FROM cuentas_por_cobrar WHERE cliente_id = ${id}) AS n`);
  const estatus = async (...ids) => (await uno(`SELECT string_agg(estatus, ',' ORDER BY id) AS e FROM ordenes WHERE id IN (${ids.join(',')})`)).e;

  // a. Dos choferes (rutas distintas, operaciones distintas) fían al MISMO cliente; el límite alcanza para una.
  let r = await carrera(ENTREGAR('a1', 13961, 'Crédito'), ENTREGAR('a2', 13962, 'Crédito'));
  let f = await cliente(13991);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /CREDITO_RECHAZADO/.test(r.rb.detail || '') && /Disponible: 30/.test(r.rb.msg)
     && f.saldo === 120 && f.cxc === 120 && f.n === 1 && (await estatus(13961, 13962)) === 'Entregada,Asignada',
    `C139a dos choferes y un solo crédito disponible: la segunda espera el candado del cliente y se rechaza; deuda 120 de 150, una cuenta (${JSON.stringify(f)})`);

  // b. Abono concurrente con una venta nueva: nunca se supera el límite y el saldo cuadra.
  const cxcId = (await uno(`SELECT id FROM cuentas_por_cobrar WHERE orden_id = 13960`)).id;
  r = await carrera(`SELECT abonar_cxc(${cxcId}, 100, 'Efectivo', 'C139-ABONO', NULL) AS r`, ENTREGAR('b1', 13963, 'Crédito'));
  f = await cliente(13992);
  const tras = r.rb.ok ? null : await uno(ENTREGAR('b2', 13963, 'Crédito')).then(x => ({ ok: true, r: x.r }), e => ({ ok: false, msg: e.message }));
  const g = await cliente(13992);
  ok(r.ra.ok && (r.rb.ok || /CREDITO_RECHAZADO/.test(r.rb.detail || '')) && f.saldo === f.cxc && f.cxc <= f.limite
     && g.saldo === 140 && g.cxc === 140 && g.n === 2 && (await estatus(13963)) === 'Entregada',
    `C139b abono y venta a la vez: la venta ${r.rb.ok ? 'esperó y pasó' : 'se rechazó (vio la deuda sin el abono) y el reintento pasó'}; saldo = cuentas = 140 ≤ 150 (${JSON.stringify(g)})`);

  // c. La MISMA operación dos veces a la vez: un solo efecto, la segunda es replay.
  r = await carrera(ENTREGAR('c1', 13964, 'Crédito'), ENTREGAR('c1', 13964, 'Crédito'));
  f = await cliente(13993);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.ra.r.replay === false && f.saldo === 120 && f.n === 1,
    'C139c la misma entrega dos veces a la vez: la segunda espera y es replay; una sola cuenta por cobrar');

  // d. Dos solicitudes distintas sobre la misma orden con modalidades distintas (fiado vs efectivo).
  r = await carrera(ENTREGAR('d1', 13965, 'Crédito'), ENTREGAR('d2', 13965, 'Efectivo'));
  f = await cliente(13993);
  const pagos = (await uno(`SELECT count(*)::int AS n FROM pagos WHERE orden_id = 13965`)).n;
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.rb.r.metodo_ignorado === true && f.saldo === 240 && f.n === 2 && pagos === 0
     && (await uno(`SELECT metodo_pago AS m FROM ordenes WHERE id = 13965`)).m === 'Crédito',
    'C139d fiado y efectivo compitiendo por la misma orden: gana la primera; la segunda NO agrega un cobro ni cambia la modalidad');

  // e. Entrega concurrente con el cierre financiero que incluye la misma orden a crédito:
  //    el contrato toma primero el candado de la ruta (como el cierre) → sin interbloqueo.
  r = await carrera(`SELECT cerrar_ruta_financiero('13990000-0000-0000-0000-00000000f001'::uuid, 13992, '[{"ordenId": 13966, "pago": "Crédito"}]'::jsonb, 13992, 'x') AS r`,
                    ENTREGAR('e1', 13966, 'Crédito'));
  f = await cliente(13994);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && f.saldo === 120 && f.n === 1 && (await estatus(13966)) === 'Entregada',
    'C139e entrega y cierre de ruta con la misma orden a crédito: la entrega espera (sin interbloqueo) y es replay; una sola cuenta por cobrar');

  // Invariante global tras todas las carreras.
  f = await uno(`SELECT (SELECT count(*)::int FROM ordenes o WHERE o.id BETWEEN 13961 AND 13966 AND o.estatus = 'Entregada' AND fin_es_credito(o.metodo_pago)
                          AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar x WHERE x.orden_id = o.id)) AS huerfanas,
                        (SELECT count(*)::int FROM clientes k WHERE k.id BETWEEN 13991 AND 13994
                          AND k.saldo IS DISTINCT FROM COALESCE((SELECT sum(x.saldo_pendiente) FROM cuentas_por_cobrar x WHERE x.cliente_id = k.id AND x.estatus IS DISTINCT FROM 'Pagada'), 0)) AS descuadres,
                        (SELECT count(*)::int FROM (SELECT orden_id FROM cuentas_por_cobrar WHERE orden_id BETWEEN 13960 AND 13966 GROUP BY 1 HAVING count(*) > 1) d) AS duplicadas`);
  ok(f.huerfanas === 0 && f.descuadres === 0 && f.duplicadas === 0,
    `C139f tras todas las carreras: 0 entregas a crédito sin cuenta, 0 saldos descuadrados, 0 cuentas duplicadas (${JSON.stringify(f)})`);

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
  try { await c139({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C139: TODAS OK' : 'RESULTADO: FALLÓ (139 concurrencia)');
  process.exit(todo ? 0 : 1);
}
