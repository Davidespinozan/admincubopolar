// c141_concurrencia.mjs — T5-D1 (mig 141): carreras de la venta rápida con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 141; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c141_concurrencia.mjs
// Sesiones sin JWT (de confianza): los candados, la carga y el crédito son los mismos.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  CREATE TEMP TABLE c141_o ON COMMIT DROP AS SELECT id FROM ordenes WHERE ruta_id BETWEEN 14191 AND 14199 OR id BETWEEN 14160 AND 14169;
  DELETE FROM ventas_rapidas_ruta WHERE ruta_id BETWEEN 14191 AND 14199;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 14191 AND 14199;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM c141_o);
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM c141_o);
  DELETE FROM cuentas_por_cobrar WHERE cliente_id BETWEEN 14191 AND 14199 OR orden_id IN (SELECT id FROM c141_o);
  DELETE FROM inventario_mov WHERE producto = 'P141-C';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 14191 AND 14199;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM c141_o);
  DELETE FROM ordenes WHERE id IN (SELECT id FROM c141_o);
  DELETE FROM auditoria WHERE detalle LIKE '%(ruta R-1419%';
  DELETE FROM rutas WHERE id BETWEEN 14191 AND 14199;
  DELETE FROM clientes WHERE id BETWEEN 14191 AND 14199;
  DELETE FROM cuartos_frios WHERE id = 'CF-141C';
  DELETE FROM productos WHERE sku = 'P141-C';
  DELETE FROM usuarios WHERE id BETWEEN 14191 AND 14199;
  COMMIT;`;

// Cinco rutas con 10 de P141-C ($30). Cliente 14191: crédito con límite 100 (cabe UNA venta de 90).
const SEMBRAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  INSERT INTO usuarios (id, nombre, email, rol, estatus) SELECT 14190 + n, 'Chofer C141-' || n, 'c' || n || '@c141', 'Chofer', 'Activo' FROM generate_series(1, 5) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P141-C', 'Hielo C141', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-141C', 'Cuarto C141', '{"P141-C": 500}');
  INSERT INTO clientes (id, nombre, rfc, saldo, credito_autorizado, limite_credito) VALUES (14191, 'Fiado C141', 'XAXX010101000', 0, true, 100);
  INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
    SELECT 14190 + n, 'R-1419' || n, 'C141 ' || n, 14190 + n, 'Chofer C141-' || n, 'Pendiente firma', CURRENT_DATE, '{"P141-C": 10}', '{"P141-C": 10}', '{}', '{"P141-C": 10}', now() FROM generate_series(1, 5) n;
  INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
    (14161, 'OV-14161', NULL, 'Público', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 14195);
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14161, 'P141-C', 6, 30, 180);
  COMMIT;`;

const CARGAR = (ruta) => `SELECT confirmar_carga_ruta('14190000-0000-0000-0000-00000000c00${ruta - 14190}'::uuid, ${ruta}, 'data:image/png;base64,QQ==', true, 'Prueba C141')`;
const VENDER = (op, ruta, cant, metodo = 'Efectivo', cliente = 'NULL') =>
  `SELECT registrar_venta_rapida_ruta('14190000-0000-0000-0000-0000000000${op}'::uuid, ${ruta}, ${cliente}, NULL, '[{"sku": "P141-C", "cant": ${cant}}]'::jsonb, '${metodo}') AS r`;

export async function c141({ connect, c, ok }) {
  console.log('── CONCURRENCIA 141 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  for (const r of [14191, 14192, 14193, 14194, 14195]) {
    await c.query(CARGAR(r));
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE rutas SET estatus = 'En progreso' WHERE id = ${r}; COMMIT;`);
  }
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
  const ruta = (id) => uno(`SELECT (SELECT estatus FROM rutas WHERE id = ${id}) AS estatus,
     (SELECT count(*)::int FROM ordenes WHERE ruta_id = ${id} AND estatus = 'Entregada') AS ordenes,
     (SELECT count(*)::int FROM ventas_rapidas_ruta WHERE ruta_id = ${id}) AS ventas,
     (SELECT count(*)::int FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = ${id}) AS pagos,
     (SELECT COALESCE(sum(p.monto), 0)::int FROM pagos p JOIN ordenes o ON o.id = p.orden_id WHERE o.ruta_id = ${id}) AS cobrado,
     (SELECT COALESCE(sum(l.cantidad), 0)::int FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = ${id} AND o.estatus = 'Entregada') AS vendido`);

  // a. La MISMA venta dos veces a la vez (doble toque, cola y pantalla a la vez): un solo efecto.
  let r = await carrera(VENDER('a1', 14191, 2), VENDER('a1', 14191, 2));
  let f = await ruta(14191);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.ra.r.replay === false && r.rb.r.replay === true && r.rb.r.orden_id === r.ra.r.orden_id
     && f.ordenes === 1 && f.ventas === 1 && f.pagos === 1 && f.cobrado === 60,
    `C141a la misma venta dos veces a la vez: la segunda espera el candado de la ruta y es replay; una orden, un pago de $60 (${JSON.stringify(f)})`);

  // b. Dos teléfonos venden lo último del camión (quedan 8; cada uno quiere 6).
  r = await carrera(VENDER('b1', 14191, 6), VENDER('b2', 14191, 6));
  f = await ruta(14191);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /CARGA_INSUFICIENTE/.test(r.rb.detail || '') && f.vendido === 8 && f.ventas === 2 && f.cobrado === 240,
    `C141b dos dispositivos compiten por lo que queda: la segunda espera, ve la primera y se rechaza; vendido 8 de 10, sin exceso (${JSON.stringify(f)})`);

  // c. Cierre final primero, venta después: la venta espera y se rechaza con la ruta cerrada.
  await c.query(`SELECT cerrar_ruta_financiero('14190000-0000-0000-0000-00000000f002'::uuid, 14192, '[]'::jsonb, 14192, 'x')`);
  r = await carrera(`SELECT finalizar_inventario_ruta('14190000-0000-0000-0000-00000000f012'::uuid, 14192, '{"P141-C": 10}'::jsonb) AS r`, VENDER('c1', 14192, 2));
  f = await ruta(14192);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /RUTA_CERRADA/.test(r.rb.detail || '') && f.estatus === 'Cerrada' && f.ordenes === 0 && f.ventas === 0 && f.pagos === 0,
    `C141c cierre y venta a la vez (gana el cierre): la venta espera y se rechaza para revisión; la ruta cerrada queda sin ventas ni cobros (${JSON.stringify(f)})`);

  // d. Venta primero, cierre después con un conteo que la ignora: el cierre espera y NO cierra.
  await c.query(`SELECT cerrar_ruta_financiero('14190000-0000-0000-0000-00000000f003'::uuid, 14193, '[]'::jsonb, 14193, 'x')`);
  r = await carrera(VENDER('d1', 14193, 3), `SELECT finalizar_inventario_ruta('14190000-0000-0000-0000-00000000f013'::uuid, 14193, '{"P141-C": 10}'::jsonb) AS r`);
  f = await ruta(14193);
  const cierra = await uno(`SELECT finalizar_inventario_ruta('14190000-0000-0000-0000-00000000f023'::uuid, 14193, '{"P141-C": 7}'::jsonb) AS r`).then(x => x.r, e => ({ error: e.message }));
  const g = await ruta(14193);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /supera el inventario del camión/.test(r.rb.msg) && f.estatus === 'En progreso' && f.ventas === 1 && f.cobrado === 90
     && cierra.estatus === 'Cerrada' && g.estatus === 'Cerrada' && g.cobrado === 90,
    `C141d venta y cierre a la vez (gana la venta, después del cierre financiero): el cierre espera y rechaza el conteo viejo; con el conteo real (7) cierra y los $90 están (${JSON.stringify(g)})`);

  // e. Dos choferes fían al mismo cliente por venta rápida; el límite alcanza para una.
  r = await carrera(VENDER('e1', 14191, 2, 'Crédito', 14191), VENDER('e2', 14194, 3, 'Crédito', 14191));
  const cli = await uno(`SELECT (SELECT saldo::int FROM clientes WHERE id = 14191) AS saldo,
     (SELECT COALESCE(sum(saldo_pendiente), 0)::int FROM cuentas_por_cobrar WHERE cliente_id = 14191) AS cxc, (SELECT count(*)::int FROM cuentas_por_cobrar WHERE cliente_id = 14191) AS n`);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /CREDITO_RECHAZADO/.test(r.rb.detail || '') && cli.saldo === 60 && cli.cxc === 60 && cli.n === 1 && (await ruta(14194)).ordenes === 0,
    `C141e dos choferes fían al mismo cliente (60 + 90 > 100): la segunda espera el candado del cliente y se rechaza sin dejar orden; deuda 60, una cuenta (${JSON.stringify(cli)})`);

  // f. Entrega de una orden (139) y venta rápida compiten por la carga de la misma ruta (10; 6 + 6).
  r = await carrera(`SELECT entregar_orden_ruta('14190000-0000-0000-0000-00000000f105'::uuid, 14161, 'Efectivo') AS r`, VENDER('f1', 14195, 6));
  f = await ruta(14195);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /CARGA_INSUFICIENTE/.test(r.rb.detail || '') && f.vendido === 6 && f.ventas === 0 && f.pagos === 1 && f.cobrado === 180,
    `C141f entrega de orden y venta rápida a la vez: sin interbloqueo; la venta espera y se rechaza por carga (${JSON.stringify(f)})`);

  // Invariante global tras todas las carreras.
  f = await uno(`SELECT
     (SELECT count(*)::int FROM rutas r WHERE r.id BETWEEN 14191 AND 14195 AND EXISTS (SELECT 1 FROM ruta_inventario_resumen(r.id) b WHERE b.entregado + b.merma + b.devuelto > b.cargado)) AS excesos,
     (SELECT count(*)::int FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id WHERE v.ruta_id BETWEEN 14191 AND 14195
        AND o.total <> COALESCE((SELECT sum(p.monto) FROM pagos p WHERE p.orden_id = o.id), 0) + COALESCE((SELECT sum(x.monto_original) FROM cuentas_por_cobrar x WHERE x.orden_id = o.id), 0)) AS descuadres,
     (SELECT count(*)::int FROM (SELECT orden_id FROM pagos WHERE orden_id IN (SELECT orden_id FROM ventas_rapidas_ruta WHERE ruta_id BETWEEN 14191 AND 14195) GROUP BY 1 HAVING count(*) > 1) d) AS pagos_dobles,
     (SELECT count(*)::int FROM ordenes o WHERE o.ruta_id BETWEEN 14191 AND 14195 AND o.id <> 14161 AND NOT EXISTS (SELECT 1 FROM ventas_rapidas_ruta v WHERE v.orden_id = o.id)) AS sin_registro,
     (SELECT count(*)::int FROM ventas_rapidas_ruta WHERE ruta_id BETWEEN 14191 AND 14195) AS ventas`);
  ok(f.excesos === 0 && f.descuadres === 0 && f.pagos_dobles === 0 && f.sin_registro === 0 && f.ventas === 4,
    `C141g tras todas las carreras: 0 rutas con exceso, 0 ventas sin su cobro o cuenta exactos, 0 pagos dobles, 4 ventas de 9 intentos (${JSON.stringify(f)})`);

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
  try { await c141({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C141: TODAS OK' : 'RESULTADO: FALLÓ (141 concurrencia)');
  process.exit(todo ? 0 : 1);
}
