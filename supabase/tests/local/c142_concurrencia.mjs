// c142_concurrencia.mjs — T5-D2 (mig 142): carreras del cierre de Administración con DOS conexiones reales.
// Lo llama run_local_db.mjs tras aplicar 142; también corre solo:
//   PG_PORT=5499 NODE_PATH=<work>/node_modules node supabase/tests/local/c142_concurrencia.mjs
// Sesiones sin JWT (de confianza): los candados y las validaciones son los mismos.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  CREATE TEMP TABLE c142_o ON COMMIT DROP AS SELECT id FROM ordenes WHERE ruta_id BETWEEN 14291 AND 14299 OR id BETWEEN 14270 AND 14279;
  DELETE FROM ruta_faltantes WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM ruta_intervenciones WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM ventas_rapidas_ruta WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM c142_o);
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM c142_o);
  DELETE FROM cuentas_por_cobrar WHERE orden_id IN (SELECT id FROM c142_o);
  DELETE FROM mermas WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM inventario_mov WHERE producto = 'P142-C';
  DELETE FROM stock_operaciones WHERE ruta_id BETWEEN 14291 AND 14299;
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM c142_o);
  DELETE FROM ordenes WHERE id IN (SELECT id FROM c142_o);
  DELETE FROM auditoria WHERE detalle LIKE 'Ruta R-1429%' OR detalle LIKE '%(ruta R-1429%';
  DELETE FROM rutas WHERE id BETWEEN 14291 AND 14299;
  DELETE FROM cuartos_frios WHERE id = 'CF-142C';
  DELETE FROM productos WHERE sku = 'P142-C';
  DELETE FROM usuarios WHERE id BETWEEN 14291 AND 14299;
  COMMIT;`;

// Siete rutas En progreso con 10 de P142-C ($30). La 14296 lleva una orden de 4 por entregar.
const SEMBRAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  INSERT INTO usuarios (id, nombre, email, rol, estatus) SELECT 14290 + n, 'Chofer C142-' || n, 'c' || n || '@c142', 'Chofer', 'Activo' FROM generate_series(1, 7) n;
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('P142-C', 'Hielo C142', 'Producto Terminado', 30, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-142C', 'Cuarto C142', '{"P142-C": 500}');
  INSERT INTO rutas (id, folio, nombre, chofer_id, chofer_nombre, estatus, fecha, carga, carga_autorizada, extra_autorizado, carga_real, carga_solicitada_at)
    SELECT 14290 + n, 'R-1429' || n, 'C142 ' || n, 14290 + n, 'Chofer C142-' || n, 'Pendiente firma', CURRENT_DATE, '{"P142-C": 10}', '{"P142-C": 10}', '{}', '{"P142-C": 10}', now() FROM generate_series(1, 7) n;
  INSERT INTO ordenes (id, folio, cliente_id, cliente_nombre, productos, total, estatus, metodo_pago, tipo_cobro, ruta_id) VALUES
    (14271, 'OV-14271', NULL, 'Público', '4×C', 120, 'Asignada', 'Efectivo', 'Contado', 14296);
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES (14271, 'P142-C', 4, 30, 120);
  COMMIT;`;

const CARGAR = (ruta) => `SELECT confirmar_carga_ruta('14290000-0000-0000-0000-00000000c00${ruta - 14290}'::uuid, ${ruta}, 'data:image/png;base64,QQ==', true, 'Prueba C142')`;
const CERRAR = (op, ruta, conteo, falt = 'NULL', motivo = 'El chofer no regresó a cerrar la ruta') =>
  `SELECT cerrar_ruta_admin('14290000-0000-0000-0000-0000000000${op}'::uuid, ${ruta}, 'cierre_admin', '{"P142-C": ${conteo}}'::jsonb, ${falt}, '${motivo}') AS r`;

export async function c142({ connect, c, ok }) {
  console.log('── CONCURRENCIA 142 (dos conexiones)');
  await c.query(LIMPIAR);
  await c.query(SEMBRAR);
  for (const r of [14291, 14292, 14293, 14294, 14295, 14296, 14297]) {
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
     (SELECT count(*)::int FROM cierres_financieros_ruta WHERE ruta_id = ${id}) AS marcas,
     (SELECT count(*)::int FROM stock_operaciones WHERE ruta_id = ${id} AND tipo = 'cierre_ruta') AS cierres,
     (SELECT count(*)::int FROM ruta_intervenciones WHERE ruta_id = ${id}) AS intervenciones,
     (SELECT count(*)::int FROM inventario_mov WHERE ruta_id = ${id} AND tipo = 'Entrada' AND referencia LIKE 'devolucion_ruta/%') AS devoluciones,
     (SELECT COALESCE(sum(cantidad), 0)::int FROM inventario_mov WHERE ruta_id = ${id} AND tipo = 'Entrada' AND referencia LIKE 'devolucion_ruta/%') AS devuelto,
     (SELECT count(*)::int FROM ruta_faltantes WHERE ruta_id = ${id}) AS faltantes`);

  // a. Dos administradores, operaciones distintas, mismo conteo: uno cierra; el otro ve la ruta cerrada.
  let r = await carrera(CERRAR('a1', 14291, 10), CERRAR('a2', 14291, 10));
  let f = await ruta(14291);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /RUTA_YA_CERRADA/.test(r.rb.detail || '') && f.estatus === 'Cerrada' && f.marcas === 1 && f.cierres === 1 && f.intervenciones === 1 && f.devuelto === 10,
    `C142a dos administradores a la vez: el segundo espera el candado y se rechaza; una marca, un cierre, una intervención, una devolución de 10 (${JSON.stringify(f)})`);

  // b. La MISMA operación dos veces a la vez (doble clic): la segunda es replay.
  r = await carrera(CERRAR('b1', 14292, 10), CERRAR('b1', 14292, 10));
  f = await ruta(14292);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.ra.r.replay === false && r.rb.r.replay === true && f.intervenciones === 1 && f.cierres === 1 && f.devuelto === 10,
    `C142b el mismo cierre dos veces a la vez: la segunda espera y es replay; sin segunda devolución (${JSON.stringify(f)})`);

  // c. Administración contra el chofer (que ya consolidó y cuenta lo mismo).
  await c.query(`SELECT cerrar_ruta_financiero('14290000-0000-0000-0000-00000000f003'::uuid, 14293, '[]'::jsonb, 14293, 'x')`);
  r = await carrera(CERRAR('c1', 14293, 10), `SELECT finalizar_inventario_ruta('14290000-0000-0000-0000-00000000f013'::uuid, 14293, '{"P142-C": 10}'::jsonb) AS r`);
  f = await ruta(14293);
  ok(r.ra.ok && r.bloqueado && r.rb.ok && r.rb.r.replay === true && r.ra.r.marca_financiera === 'reutilizada' && f.estatus === 'Cerrada' && f.marcas === 1 && f.cierres === 1 && f.devoluciones === 1 && f.devuelto === 10,
    `C142c Administración y chofer cierran a la vez (gana Administración): el chofer espera y recibe el cierre ya hecho; UNA devolución (${JSON.stringify(f)})`);
  await c.query(`SELECT cerrar_ruta_financiero('14290000-0000-0000-0000-00000000f004'::uuid, 14294, '[]'::jsonb, 14294, 'x')`);
  r = await carrera(`SELECT finalizar_inventario_ruta('14290000-0000-0000-0000-00000000f014'::uuid, 14294, '{"P142-C": 10}'::jsonb) AS r`, CERRAR('c2', 14294, 10));
  f = await ruta(14294);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /RUTA_YA_CERRADA/.test(r.rb.detail || '') && f.estatus === 'Cerrada' && f.intervenciones === 0 && f.cierres === 1 && f.devuelto === 10,
    `C142c2 (gana el chofer): Administración espera y se rechaza; no queda intervención ni segunda devolución (${JSON.stringify(f)})`);

  // d. Cierre contra venta rápida. Venta primero: el cierre con el conteo viejo espera y NO deja marca.
  r = await carrera(`SELECT registrar_venta_rapida_ruta('14290000-0000-0000-0000-0000000000d1'::uuid, 14295, NULL, NULL, '[{"sku": "P142-C", "cant": 3}]'::jsonb, 'Efectivo') AS r`, CERRAR('d2', 14295, 10));
  f = await ruta(14295);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /supera el inventario del camión/.test(r.rb.msg) && f.estatus === 'En progreso' && f.marcas === 0 && f.intervenciones === 0,
    `C142d venta rápida y cierre a la vez (gana la venta): el cierre espera, su conteo ya no cuadra y se deshace entero: SIN marca financiera (${JSON.stringify(f)})`);
  // Cierre primero: la venta espera y se rechaza para revisión.
  r = await carrera(CERRAR('d3', 14295, 7), `SELECT registrar_venta_rapida_ruta('14290000-0000-0000-0000-0000000000d4'::uuid, 14295, NULL, NULL, '[{"sku": "P142-C", "cant": 1}]'::jsonb, 'Efectivo') AS r`);
  f = await ruta(14295);
  const ventas = (await uno(`SELECT count(*)::int AS n FROM ventas_rapidas_ruta WHERE ruta_id = 14295`)).n;
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /RUTA_CERRADA/.test(r.rb.detail || '') && f.estatus === 'Cerrada' && f.devuelto === 7 && ventas === 1,
    `C142d2 (gana el cierre): la venta espera y se rechaza; la ruta cerró con 7 y una sola venta (${JSON.stringify(f)})`);

  // e. Cierre contra entrega: la entrega gana, el cierre con el conteo viejo se deshace.
  r = await carrera(`SELECT entregar_orden_ruta('14290000-0000-0000-0000-0000000000e1'::uuid, 14271, 'Efectivo') AS r`, CERRAR('e2', 14296, 10));
  f = await ruta(14296);
  const cierraE = await uno(CERRAR('e3', 14296, 6)).then(x => x.r, e => ({ error: e.message }));
  const g = await ruta(14296);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && f.estatus === 'En progreso' && f.marcas === 0 && cierraE.estatus === 'Cerrada' && g.devuelto === 6
     && (await uno(`SELECT count(*)::int AS n FROM pagos WHERE orden_id = 14271`)).n === 1,
    `C142e entrega y cierre a la vez (gana la entrega): el cierre espera y se rechaza sin dejar marca; con el conteo real (6) cierra; un solo cobro (${JSON.stringify(g)})`);

  // f. Cierre contra merma: la merma gana; el cierre que no la consideraba se deshace.
  r = await carrera(`SELECT registrar_mermas_ruta('14290000-0000-0000-0000-0000000000f1'::uuid, 14297, '[{"sku": "P142-C", "cant": 2, "causa": "Bolsa rota"}]'::jsonb) AS r`, CERRAR('f2', 14297, 10));
  f = await ruta(14297);
  // Con el conteo real y un faltante: 10 = 2 merma + 1 faltante + 7 devueltas.
  const cierraF = await uno(CERRAR('f3', 14297, 7, `'[{"sku": "P142-C", "cantidad": 1}]'::jsonb`)).then(x => x.r, e => ({ error: e.message }));
  const h = await ruta(14297);
  ok(r.ra.ok && r.bloqueado && !r.rb.ok && /supera el inventario del camión/.test(r.rb.msg) && f.estatus === 'En progreso' && f.marcas === 0 && f.faltantes === 0
     && cierraF.estatus === 'Cerrada' && h.faltantes === 1 && h.devuelto === 7,
    `C142f merma y cierre a la vez (gana la merma): el cierre se deshace; después cierra con 7 devueltas + 1 faltante no justificado, sin confundirse con la merma (${JSON.stringify(h)})`);

  // Invariante global tras todas las carreras.
  f = await uno(`SELECT
     (SELECT count(*)::int FROM rutas r WHERE r.id BETWEEN 14291 AND 14297 AND r.estatus <> 'Cerrada') AS abiertas,
     (SELECT count(*)::int FROM rutas r WHERE r.id BETWEEN 14291 AND 14297 AND EXISTS (SELECT 1 FROM ruta_inventario_resumen(r.id) b WHERE b.cargado <> b.entregado + b.merma + b.devuelto)) AS descuadres,
     (SELECT count(*)::int FROM (SELECT ruta_id FROM cierres_financieros_ruta WHERE ruta_id BETWEEN 14291 AND 14297 GROUP BY 1 HAVING count(*) <> 1) d) AS marcas_mal,
     (SELECT count(*)::int FROM (SELECT ruta_id FROM stock_operaciones WHERE ruta_id BETWEEN 14291 AND 14297 AND tipo = 'cierre_ruta' GROUP BY 1 HAVING count(*) <> 1) d) AS cierres_mal,
     (SELECT count(*)::int FROM ruta_intervenciones WHERE ruta_id BETWEEN 14291 AND 14297) AS intervenciones,
     (SELECT (stock ->> 'P142-C')::int FROM cuartos_frios WHERE id = 'CF-142C') AS cuarto`);
  ok(f.abiertas === 0 && f.descuadres === 0 && f.marcas_mal === 0 && f.cierres_mal === 0 && f.intervenciones === 6 && f.cuarto === 500 - 70 + 10 + 10 + 10 + 10 + 7 + 6 + 7,
    `C142g tras todas las carreras: 7 rutas cerradas y cuadradas, una marca y un cierre por ruta, 6 intervenciones (una la cerró el chofer), existencia del cuarto exacta (${JSON.stringify(f)})`);

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
  try { await c142({ connect, c, ok }); } finally { await c.end(); }
  console.log(todo ? '── C142: TODAS OK' : 'RESULTADO: FALLÓ (142 concurrencia)');
  process.exit(todo ? 0 : 1);
}
