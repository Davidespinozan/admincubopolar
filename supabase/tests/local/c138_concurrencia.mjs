// c138_concurrencia.mjs — T5-A (mig 138): carreras con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 138; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c138_concurrencia.mjs
// Sesiones sin JWT (de confianza, como el backend): la guarda de carga no tiene
// exención de rol ni de contexto, así que aplica igual.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM ruta_entregas_revertidas WHERE ruta_id BETWEEN 13891 AND 13899;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 13891 AND 13899;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 13891 AND 13899 OR id BETWEEN 13891 AND 13899);
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 13891 AND 13899 OR id BETWEEN 13891 AND 13899);
  DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 13891 AND 13899 OR id BETWEEN 13891 AND 13899);
  DELETE FROM inventario_mov WHERE producto = 'P138-C';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 13891 AND 13899;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE ruta_id BETWEEN 13891 AND 13899 OR id BETWEEN 13891 AND 13899);
  DELETE FROM ordenes WHERE ruta_id BETWEEN 13891 AND 13899 OR id BETWEEN 13891 AND 13899;
  DELETE FROM rutas WHERE id BETWEEN 13891 AND 13899;
  DELETE FROM auditoria WHERE detalle LIKE 'OV-1389%';
  DELETE FROM clientes WHERE id = 13891;
  DELETE FROM cuartos_frios WHERE id = 'CF-138C';
  DELETE FROM productos WHERE sku = 'P138-C';
  DELETE FROM usuarios WHERE id BETWEEN 13891 AND 13899;
  COMMIT;`;

// Cuatro rutas (un chofer cada una) con 10 de P138-C autorizadas; las órdenes piden 6.
const SEMBRAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  INSERT INTO usuarios (id, nombre, email, rol, estatus) SELECT 13890 + n, 'Chofer C138-' || n, 'c' || n || '@c138', 'Chofer', 'Activo' FROM generate_series(1, 5) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P138-C', 'Hielo C138', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-138C', 'Cuarto C138', '{"P138-C": 500}');
  INSERT INTO clientes (id, nombre, rfc, saldo) VALUES (13891, 'Cliente C138', 'XAXX010101000', 0);
  INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
    SELECT 13890 + n, 'R-1389' || n, 'C138 ' || n, 13890 + n, 'Chofer C138-' || n, 'Pendiente firma', CURRENT_DATE, '{"P138-C": 10}', '{"P138-C": 10}', '{}', '{"P138-C": 10}', now() FROM generate_series(1, 5) n;
  INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
    (13891, 'OV-13891', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13891),
    (13892, 'OV-13892', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13891),
    (13893, 'OV-13893', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13892),
    (13894, 'OV-13894', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13892),
    (13895, 'OV-13895', 13891, 'Cliente C138', '6×C', 180, 'Creada',   'Efectivo', 'Contado', NULL),
    (13896, 'OV-13896', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13894),
    (13897, 'OV-13897', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13895),
    (13898, 'OV-13898', 13891, 'Cliente C138', '6×C', 180, 'Asignada', 'Efectivo', 'Contado', 13895);
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) SELECT id, 'P138-C', 6, 30, 180 FROM ordenes WHERE id BETWEEN 13891 AND 13898;
  COMMIT;`;

const CARGAR = (ruta) => `SELECT confirmar_carga_ruta('13890000-0000-0000-0000-00000000c00${ruta - 13890}'::uuid, ${ruta}, 'data:image/png;base64,QQ==', true, 'Prueba C138')`;
const ENTREGAR = (orden) => `UPDATE ordenes SET estatus = 'Entregada', metodo_pago = 'Efectivo' WHERE id = ${orden}`;

export async function c138({ connect, c, ok }) {
  console.log('── CONCURRENCIA 138 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  for (const r of [13891, 13892, 13894, 13895]) {
    await c.query(CARGAR(r));
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE rutas SET estatus = 'En progreso' WHERE id = ${r}; COMMIT;`);
  }
  const a = await connect(); const b = await connect();
  // A hace su parte dentro de una transacción abierta; B arranca, debe ESPERAR el candado de la
  // ruta y resolverse cuando A confirma.
  const carrera = async (sqlA, sqlB) => {
    await a.query('BEGIN');
    let ra; try { ra = { ok: true, r: (await a.query(sqlA)).rows[0] }; } catch (e) { ra = { ok: false, code: e.code, msg: e.message }; }
    let done = false;
    const prB = b.query(sqlB).then(r => ({ ok: true, r: r.rows[0] }), e => ({ ok: false, code: e.code, msg: e.message, detail: e.detail })).finally(() => { done = true; });
    await sleep(600);
    const bloqueado = !done;
    await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
    const rb = await prB;
    return { ra, rb, bloqueado };
  };
  const uno = async (sql) => (await c.query(sql)).rows[0];

  // a. Dos entregas simultáneas que juntas no caben (6 + 6 > 10).
  let r = await carrera(ENTREGAR(13891), ENTREGAR(13892));
  let f = await uno(`SELECT string_agg(estatus, ',' ORDER BY id) AS e, (SELECT sum(l.cantidad) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = 13891 AND o.estatus = 'Entregada')::int AS ent FROM ordenes WHERE id IN (13891, 13892)`);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /carga del camión no alcanza/.test(r.rb.msg) && /CARGA_INSUFICIENTE/.test(r.rb.detail || '')
     && f.e === 'Entregada,Asignada' && f.ent === 6,
    `C138a dos entregas simultáneas de la misma carga: la segunda espera el candado de la ruta y se rechaza; entregado 6 de 10 (${f.e})`);

  // b. Entrega simultánea con el cierre financiero (que entrega la otra orden).
  r = await carrera(`SELECT cerrar_ruta_financiero('13890000-0000-0000-0000-00000000f001'::uuid, 13892, '[{"ordenId": 13893, "pago": "Efectivo"}]'::jsonb, 13892, 'x') AS r`, ENTREGAR(13894));
  f = await uno(`SELECT string_agg(estatus, ',' ORDER BY id) AS e, (SELECT count(*) FROM cierres_financieros_ruta WHERE ruta_id = 13892)::int AS cf,
                        (SELECT count(*) FROM pagos WHERE orden_id IN (13893, 13894))::int AS p FROM ordenes WHERE id IN (13893, 13894)`);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && f.e === 'Entregada,Asignada' && f.cf === 1 && f.p === 1,
    `C138b entrega y cierre simultáneos: el cierre registra su entrega y su cobro una vez; la entrega que ya no cabe se rechaza (${f.e}, pagos ${f.p})`);

  // c. Agregar un pedido mientras se confirma la carga del camión.
  r = await carrera(CARGAR(13893) + ' AS r', `SELECT asignar_ordenes_a_ruta(13893, ARRAY[13895]::BIGINT[]) AS r`);
  f = await uno(`SELECT estatus AS e, ruta_id AS ruta FROM ordenes WHERE id = 13895`);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /ya tiene su carga capturada/.test(r.rb.msg) && f.e === 'Creada' && f.ruta === null,
    'C138c agregar un pedido mientras se carga el camión: la asignación espera y se rechaza; el pedido sigue Creado y sin ruta');

  // d. Dos reversiones simultáneas de la misma entrega (operaciones distintas) y el reintento.
  await c.query(ENTREGAR(13896));
  const REV = (op) => `SELECT revertir_entrega_ruta('13890000-0000-0000-0000-0000000000${op}'::uuid, 13896, 'Marcada por error (C138)', false) AS r`;
  r = await carrera(REV('b1'), REV('b2'));
  f = await uno(`SELECT (SELECT estatus FROM ordenes WHERE id = 13896) AS e, (SELECT count(*) FROM ruta_entregas_revertidas WHERE orden_id = 13896)::int AS n,
                        (SELECT count(*) FROM auditoria WHERE accion = 'Revertir entrega' AND detalle LIKE 'OV-13896%')::int AS aud`);
  const replay = await uno(REV('b1'));
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && r.rb.code === '22023' && /No está Entregada/.test(r.rb.msg) && f.e === 'Asignada' && f.n === 1 && f.aud === 1 && replay.r.replay === true,
    `C138d dos reversiones simultáneas: una sola surte efecto (1 evidencia, 1 auditoría); la otra se rechaza y el reintento de la primera es replay`);

  // e. Reversión simultánea con una entrega nueva de la misma ruta: nunca se supera la carga.
  await c.query(ENTREGAR(13897));
  r = await carrera(`SELECT revertir_entrega_ruta('13890000-0000-0000-0000-0000000000b3'::uuid, 13897, 'Marcada por error (C138)', false) AS r`, ENTREGAR(13898));
  f = await uno(`SELECT string_agg(estatus, ',' ORDER BY id) AS e FROM ordenes WHERE id IN (13897, 13898)`);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && f.e === 'Asignada,Entregada',
    `C138e reversión y entrega simultáneas: la entrega espera a la reversión y entonces sí cabe (${f.e})`);

  // f. Cierre que quiere entregar la MISMA orden que otra sesión está entregando: candados cruzados.
  //    Postgres resuelve el interbloqueo abortando UNA transacción; nunca quedan dos efectos.
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE ordenes SET estatus = 'Asignada', delivered_at = NULL WHERE id = 13898; COMMIT;`);
  await a.query('BEGIN'); await b.query('BEGIN');
  await a.query(`SELECT 1 FROM rutas WHERE id = 13895 FOR UPDATE`);            // A: candado de la ruta (como el cierre)
  const pB = b.query(ENTREGAR(13898)).then(() => ({ ok: true }), e => ({ ok: false, code: e.code }));   // B: orden → espera la ruta
  await sleep(400);
  const pA = a.query(`SELECT cerrar_ruta_financiero('13890000-0000-0000-0000-00000000f002'::uuid, 13895, '[{"ordenId": 13898, "pago": "Efectivo"}]'::jsonb, 13895, 'x')`)
    .then(() => ({ ok: true }), e => ({ ok: false, code: e.code }));          // A: quiere la orden → interbloqueo
  const [xa, xb] = await Promise.all([pA, pB]);
  await a.query(xa.ok ? 'COMMIT' : 'ROLLBACK'); await b.query(xb.ok ? 'COMMIT' : 'ROLLBACK');
  f = await uno(`SELECT (SELECT estatus FROM ordenes WHERE id = 13898) AS e, (SELECT count(*) FROM pagos WHERE orden_id = 13898)::int AS p,
                        (SELECT COALESCE(sum(l.cantidad), 0) FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id WHERE o.ruta_id = 13895 AND o.estatus = 'Entregada')::int AS ent`);
  ok((xa.ok !== xb.ok || (xa.ok && xb.ok)) && [xa.code, xb.code].filter(Boolean).every(x => x === '40P01') && f.e === 'Entregada' && f.p <= 1 && f.ent === 6,
    `C138f cierre y entrega de la MISMA orden a la vez: una transacción gana, la otra se aborta limpia (40P01); una sola entrega, a lo más un cobro (A ${xa.ok ? 'ok' : xa.code}, B ${xb.ok ? 'ok' : xb.code}, pagos ${f.p})`);

  await a.end(); await b.end();
  await c.query(LIMPIAR);
}

// Ejecución directa.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const connect = async () => { const x = new Client({ host: '127.0.0.1', port: Number(process.env.PG_PORT) || 5499, user: 'tester', database: 'cubopolar_test' }); await x.connect(); return x; };
  const c = await connect();
  let todo = true;
  const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) todo = false; };
  try { await c138({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C138: TODAS OK' : 'RESULTADO: FALLÓ (138 concurrencia)');
  process.exit(todo ? 0 : 1);
}
