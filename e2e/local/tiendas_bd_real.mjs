// tiendas_bd_real.mjs — Tiendas E9: recorrido en un NAVEGADOR real (Chromium) contra la BASE DE DATOS
// LOCAL REAL (el Postgres del gate, con las migraciones 1–150) a través de PostgREST, la misma capa
// que usa Supabase. Se corre a mano, en local; no es parte de la suite de Playwright del repositorio.
//
//   PG_PORT=<puerto del Postgres local> NODE_PATH=<work>/node_modules node e2e/local/tiendas_bd_real.mjs
//
// Qué es REAL: los contratos, los disparadores, RLS y los permisos de la base, la forma exacta de las
// respuestas y de los errores de PostgREST, y la interfaz en el navegador.
// Qué NO es real: el inicio de sesión (Supabase Auth no existe en local: se simula entregando un token
// firmado con el secreto local, con el `sub` del usuario), las Netlify Functions y el realtime.
//
// Seguridad: la aplicación se levanta con VITE_SUPABASE_URL apuntando a una dirección local
// (http://127.0.0.1:54999) y el navegador tiene prohibido salir de 127.0.0.1 / localhost. PostgREST
// se conecta SOLO al Postgres local. Ninguna petición puede llegar a producción.
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const PG_PORT = Number(process.env.PG_PORT) || 5499;
const BACKEND = 'http://127.0.0.1:54999';           // lo que cree la aplicación (no existe: se intercepta)
const API_PUERTO = Number(process.env.TIENDAS_E2E_API) || 54998;
const API = `http://127.0.0.1:${API_PUERTO}`;        // PostgREST real, sobre el Postgres local
const PUERTO = Number(process.env.TIENDAS_E2E_PUERTO) || 5198;
const APP = `http://127.0.0.1:${PUERTO}`;
const CAPTURAS = process.env.TIENDAS_E2E_CAPTURAS || '';
const SECRETO = 'secreto-local-de-prueba-tiendas-e9-0123456789abcdef';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) fallas++; };

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(sub) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}
const UID = (n) => `15100000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = { id: 15101, email: 'admin@e9.local', uid: UID(1), nombre: 'Admin E9' };
const CAJERA = { id: 15106, email: 'cajera@e9.local', uid: UID(6), nombre: 'Cajera E9' };
const POR_EMAIL = { [ADMIN.email]: ADMIN, [CAJERA.email]: CAJERA };

const LIMPIAR = `
  BEGIN; SET LOCAL session_replication_role = replica;
  DELETE FROM correcciones_venta_tienda WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM movimientos_contables WHERE orden_id IN (SELECT id FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM devoluciones WHERE orden_id IN (SELECT id FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM ventas_tienda WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM pagos WHERE orden_id IN (SELECT id FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM stock_operaciones WHERE orden_id IN (SELECT id FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM ordenes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM turnos_caja_eventos WHERE turno_id IN (SELECT id FROM turnos_caja WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM turnos_caja WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM traspaso_eventos WHERE traspaso_id IN (SELECT id FROM traspasos WHERE destino_establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM traspaso_lineas WHERE traspaso_id IN (SELECT id FROM traspasos WHERE destino_establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9'));
  DELETE FROM traspasos WHERE destino_establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM inventario_mov WHERE producto LIKE 'PE9-%';
  DELETE FROM establecimiento_eventos WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM cajas WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE clave = 'TFE9');
  DELETE FROM cuartos_frios WHERE id LIKE 'CF-E9-%';
  DELETE FROM usuario_establecimientos WHERE usuario_id IN (${ADMIN.id}, ${CAJERA.id});
  DELETE FROM establecimientos WHERE clave = 'TFE9';
  DELETE FROM productos WHERE sku LIKE 'PE9-%';
  DELETE FROM bitacora_cambios WHERE tabla = 'usuarios' AND registro_id IN ('${ADMIN.id}', '${CAJERA.id}');
  DELETE FROM usuarios WHERE id IN (${ADMIN.id}, ${CAJERA.id});
  DELETE FROM auth.users WHERE id::text LIKE '15100000-%';
  UPDATE tiendas_activacion SET habilitada = false, habilitada_at = NULL, habilitada_por = NULL;
  COMMIT;`;
const SEMBRAR = `
  BEGIN;
  UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = 'prueba E9 en navegador';
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) VALUES ('${ADMIN.uid}', '${ADMIN.email}'), ('${CAJERA.uid}', '${CAJERA.email}');
  INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id) VALUES
    (${ADMIN.id}, '${ADMIN.nombre}', '${ADMIN.email}', 'Admin', 'Activo', '${ADMIN.uid}'),
    (${CAJERA.id}, '${CAJERA.nombre}', '${CAJERA.email}', 'Ventas', 'Activo', '${CAJERA.uid}');
  INSERT INTO productos (sku, nombre, tipo, precio, stock, costo_unitario) VALUES ('PE9-A', 'Hielo E9 chico', 'Producto Terminado', 30, 0, 0), ('PE9-B', 'Hielo E9 grande', 'Producto Terminado', 90, 0, 0);
  INSERT INTO cuartos_frios (id, nombre, stock) VALUES ('CF-E9-C1', 'Cuarto CEDIS E9', '{"PE9-A": 100, "PE9-B": 40}');
  COMMIT;`;

// Llamada directa a la API real (PostgREST) con el token de un usuario.
async function rpc(usuario, fn, args = {}) {
  const r = await fetch(`${API}/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token(usuario.uid)}` }, body: JSON.stringify(args) });
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, ok: r.ok, cuerpo };
}
const exigir = async (usuario, fn, args) => { const r = await rpc(usuario, fn, args); if (!r.ok) throw new Error(`${fn}: ${r.status} ${JSON.stringify(r.cuerpo).slice(0, 300)}`); return r.cuerpo; };

// Intercepta lo que la aplicación manda a "Supabase": el inicio de sesión se simula; /rest/v1 va a PostgREST real.
function crearPuente() {
  const p = { llamadas: [], cortarProximaVenta: false, sesion: null };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  p.atender = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return json(200, {});
    if (url.pathname === '/auth/v1/token') {
      const datos = req.postDataJSON?.() || {};
      const u = POR_EMAIL[datos.email] || p.sesion;
      if (!u) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      p.sesion = u;
      return json(200, { access_token: token(u.uid), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'local',
        user: { id: u.uid, aud: 'authenticated', role: 'authenticated', email: u.email } });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(200, p.sesion ? { id: p.sesion.uid, aud: 'authenticated', role: 'authenticated', email: p.sesion.email } : {});
    if (!url.pathname.startsWith('/rest/v1/')) return route.abort();
    const ruta = url.pathname.slice('/rest/v1'.length);
    const mRpc = ruta.match(/^\/rpc\/([a-z_]+)$/);
    const h = req.headers();
    const headers = {};
    for (const k of ['content-type', 'accept', 'prefer', 'range', 'range-unit', 'accept-profile', 'content-profile']) if (h[k]) headers[k] = h[k];
    // Antes de iniciar sesión supabase-js manda la llave anónima (no es un token): va como anónimo.
    if (/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(h.authorization || '')) headers.authorization = h.authorization;
    let r;
    try { r = await fetch(`${API}${ruta}${url.search}`, { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() }); }
    catch (e) { p.llamadas.push({ error: String(e.message), ruta }); return route.abort('connectionfailed'); }
    const cuerpo = await r.text();
    const conSesion = !!headers.authorization;
    p.llamadas.push(mRpc ? { fn: mRpc[1], args: req.postDataJSON?.() || {}, status: r.status, conSesion } : { tabla: ruta.slice(1), metodo: req.method(), status: r.status, conSesion, cuerpo: req.method() === 'GET' ? null : (req.postData() || '').slice(0, 400) });
    // "Se cae la red justo después de que el servidor cobró": la base YA registró la venta y la respuesta nunca llega.
    if (mRpc && mRpc[1] === 'vender_en_tienda' && p.cortarProximaVenta && r.ok) { p.cortarProximaVenta = false; return route.abort('connectionfailed'); }
    const out = { ...cors };
    for (const k of ['content-type', 'content-range', 'preference-applied']) if (r.headers.get(k)) out[k] = r.headers.get(k);
    return route.fulfill({ status: r.status, headers: out, body: cuerpo });
  };
  return p;
}

async function esperar(url, veces = 80) {
  for (let i = 0; i < veces; i++) { try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* aún no */ } await sleep(250); }
  return false;
}

const db = new Client({ host: '127.0.0.1', port: PG_PORT, user: 'tester', database: 'cubopolar_test' });
await db.connect();
const uno = async (sql) => (await db.query(sql)).rows[0];
const postgrest = spawn('postgrest', [], { stdio: 'ignore', env: { ...process.env,
  PGRST_DB_URI: `postgres://tester@127.0.0.1:${PG_PORT}/cubopolar_test`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRETO,
  PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(API_PUERTO), PGRST_DB_POOL: '6' } });
const vite = spawn('npx', ['vite', '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], {
  env: { ...process.env, VITE_SUPABASE_URL: BACKEND, VITE_SUPABASE_ANON_KEY: 'local-simulado', VITE_SENTRY_DSN: '', VITE_VAPID_PUBLIC_KEY: '' }, stdio: 'ignore',
});
let browser;
try {
  console.log('── TIENDAS en navegador contra la BASE LOCAL REAL (PostgREST; inicio de sesión simulado)');
  await db.query(LIMPIAR);
  await db.query(SEMBRAR);
  if (!(await esperar(`${API}/`))) throw new Error('PostgREST no levantó');
  if (!(await esperar(APP))) throw new Error('la aplicación local no levantó');
  const prod = await uno(`SELECT current_database() AS d, inet_server_addr()::text AS h, (SELECT to_regprocedure('public.reporte_reembolsos_tiendas(date,date,bigint)') IS NOT NULL) AS m150`);
  ok(prod.d === 'cubopolar_test' && /^(127\.0\.0\.1|::1)/.test(prod.h || '127.0.0.1') && prod.m150, `0. la base es la LOCAL de pruebas (${prod.d} en ${prod.h || 'socket local'}) y tiene la migración 150`);

  // ── Configuración por la API real, como Administración (pasos 1–7) ──
  const sinToken = await fetch(`${API}/rpc/mis_establecimientos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok(sinToken.status === 401 || sinToken.status === 403 || sinToken.status === 404, `0. sin sesión la API no entrega nada de tiendas (HTTP ${sinToken.status})`);
  const tf = await exigir(ADMIN, 'guardar_establecimiento', { p_id: null, p_clave: 'TFE9', p_nombre: 'Tienda E9' });
  await exigir(ADMIN, 'asignar_cuarto_tienda', { p_establecimiento_id: tf.id, p_cuarto_id: 'CF-E9-TF', p_nombre: 'Congelador E9' });
  const caja = await exigir(ADMIN, 'agregar_caja_tienda', { p_establecimiento_id: tf.id, p_nombre: 'Caja 1' });
  await exigir(ADMIN, 'asignar_usuario_tienda', { p_establecimiento_id: tf.id, p_usuario_id: CAJERA.id, p_vende_desde_cedis: false, p_traspasa_con_cedis: false });
  await exigir(ADMIN, 'definir_recepcion_tienda', { p_establecimiento_id: tf.id, p_usuario_id: CAJERA.id, p_recibe: true });
  const act = await exigir(ADMIN, 'activar_tienda', { p_operacion_id: randomUUID(), p_establecimiento_id: tf.id, p_activar: true });
  ok(tf.activo === false && act.activo === true && caja.id > 0, '1–6. alta, congelador, caja, cajera con permiso de recepción y activación explícita: todo por contratos, a través de la API real');
  const tras = await exigir(ADMIN, 'crear_traspaso', { p_operacion_id: randomUUID(), p_origen_establecimiento_id: 1, p_destino_establecimiento_id: tf.id, p_cuarto_origen: 'CF-E9-C1', p_cuarto_destino: 'CF-E9-TF',
    p_items: [{ sku: 'PE9-A', cantidad: 10 }], p_responsable: 'Luis Pérez' });
  await exigir(ADMIN, 'despachar_traspaso', { p_operacion_id: randomUUID(), p_traspaso_id: tras.traspaso_id });
  // Último cajero: forma REAL del rechazo que ve la aplicación.
  const bajaR = await rpc(ADMIN, 'guardar_usuario', { p_usuario_id: CAJERA.id, p_nombre: CAJERA.nombre, p_rol: 'Ventas', p_estatus: 'Inactivo' });
  let codigo = null; try { codigo = JSON.parse(bajaR.cuerpo.details).codigo; } catch { /* noop */ }
  ok(!bajaR.ok && bajaR.cuerpo.code === '22023' && codigo === 'ULTIMO_CAJERO' && /último cajero de la tienda activa "Tienda E9"/.test(bajaR.cuerpo.message || ''),
    `3. dar de baja por guardar_usuario a la única cajera de la tienda activa: la API responde ${bajaR.status} ${bajaR.cuerpo.code} ${codigo}`);
  const cajeraRest = await fetch(`${API}/usuarios?id=eq.${CAJERA.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token(ADMIN.uid)}` }, body: JSON.stringify({ estatus: 'Inactivo' }) });
  ok(!cajeraRest.ok && (await uno(`SELECT estatus FROM usuarios WHERE id = ${CAJERA.id}`)).estatus === 'Activo', `3. y por escritura REST directa tampoco (HTTP ${cajeraRest.status}); la cajera sigue activa`);

  browser = await chromium.launch();
  const fuera = [];
  const abrir = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { window.localStorage.setItem('E2E', '1'); } catch { /* noop */ } });
    const puente = crearPuente();
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BACKEND) return puente.atender(route);
      if (['127.0.0.1', 'localhost'].includes(u.hostname)) return route.continue();
      fuera.push(u.origin);
      return route.abort();
    });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(String(e.message)));
    const t = (id) => page.locator(`[data-testid="${id}"]`);
    const captura = async (n) => { if (CAPTURAS) { mkdirSync(CAPTURAS, { recursive: true }); await page.screenshot({ path: `${CAPTURAS}/${n}.png`, fullPage: true }); } };
    const entrar = async (u) => { await page.goto(APP); await page.fill('#login-email', u.email); await page.fill('#login-password', 'local'); await page.click('button[type="submit"]'); };
    return { ctx, page, puente, errores, t, captura, entrar };
  };

  // ── Cajera en el navegador ──
  const c = await abrir();
  await c.entrar(CAJERA);
  await c.t('pos-tienda').waitFor({ timeout: 30000 });
  const actor = c.puente.llamadas.find(l => l.fn === 'erp_actor');
  const menu = await c.page.locator('body').innerText();
  ok(c.page.url().endsWith('#/pos') && actor?.status === 200 && /Punto de venta/.test(menu) && !/Rutas|Producción|Por cobrar|Clientes|Facturación/.test(menu),
    '8. la cajera (rol guardado "Ventas") entra directo al punto de venta: su perfil efectivo lo decidió la base real (erp_actor)');
  await sleep(1500);
  const leidas = c.puente.llamadas.slice(c.puente.llamadas.indexOf(actor)).filter(l => l.tabla && l.metodo === 'GET');
  ok(leidas.every(l => ['cuartos_frios', 'ordenes'].includes(l.tabla.split('?')[0])), `8. con su perfil de tienda solo leyó sus tablas (${[...new Set(leidas.map(l => l.tabla.split('?')[0]))].join(', ') || 'ninguna'})`);
  const rls = await fetch(`${API}/clientes?select=id&limit=5`, { headers: { authorization: `Bearer ${token(CAJERA.uid)}` } });
  const rlsFilas = rls.ok ? await rls.json() : [];
  const cuartos = await (await fetch(`${API}/cuartos_frios?select=id`, { headers: { authorization: `Bearer ${token(CAJERA.uid)}` } })).json();
  ok(rlsFilas.length === 0 && Array.isArray(cuartos) && cuartos.length === 1 && cuartos[0].id === 'CF-E9-TF',
    `8. RLS real: la cajera no lee clientes centrales (${rlsFilas.length} filas) y de los congeladores solo ve el de su tienda`);

  // Recepción del traspaso (antes de vender: el congelador de la tienda está vacío).
  await c.page.goto(`${APP}/#/pos-recepcion`);
  const fila = c.t(`traspaso-${tras.folio}`);
  await fila.waitFor({ timeout: 15000 });
  await fila.getByRole('button', { name: 'Recibir' }).click();
  await c.t('recibida-PE9-A').fill('9'); await c.t('danada-PE9-A').fill('1');
  await c.page.locator('[data-testid="traspaso-recepcion"] textarea').fill('Una bolsa rota');
  await c.page.getByRole('button', { name: 'Registrar recepción' }).click();
  await c.t('pos-recepcion-historial').waitFor({ timeout: 15000 });
  let st = await uno(`SELECT (SELECT stock ->> 'PE9-A' FROM cuartos_frios WHERE id = 'CF-E9-TF') AS tienda, (SELECT stock ->> 'PE9-A' FROM cuartos_frios WHERE id = 'CF-E9-C1') AS cedis,
                             (SELECT estado || '|' || incidencia FROM traspasos WHERE id = ${tras.traspaso_id}) AS t`);
  ok(st.tienda === '9' && st.cedis === '90' && st.t === 'recibido|true', `7. la cajera recibió el traspaso en pantalla: en la BASE entraron 9 buenas a su congelador (CEDIS 90); 1 dañada = incidencia (${st.t})`);
  await c.captura('e9-01-recepcion');

  // Turno y venta.
  await c.page.goto(`${APP}/#/pos`);
  await c.t('pos-cajas').waitFor({ timeout: 15000 });
  await c.page.getByRole('button', { name: 'Caja 1', exact: true }).click();
  await c.t('pos-fondo').fill('200');
  await c.page.getByRole('button', { name: 'Abrir turno' }).click();
  await c.t('pos-productos').waitFor({ timeout: 15000 });
  const txtProd = await c.t('pos-producto-PE9-A').innerText();
  ok(/\$30\.00/.test(txtProd) && /Hay 9/.test(txtProd), `8. turno abierto; el producto muestra el precio y la existencia de la base (${txtProd.replace(/\n/g, ' · ')})`);
  await c.t('pos-producto-PE9-A').click(); await c.t('pos-producto-PE9-A').click();
  await c.page.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await c.page.getByRole('button', { name: /Sí, cobrar/ }).click();
  await c.t('pos-comprobante').waitFor({ timeout: 15000 });
  let v = await uno(`SELECT count(*)::int AS n, sum(o.total)::text AS total, (SELECT count(*)::int FROM pagos p JOIN ordenes o2 ON o2.id = p.orden_id WHERE o2.establecimiento_id = ${tf.id}) AS pagos,
                            (SELECT stock ->> 'PE9-A' FROM cuartos_frios WHERE id = 'CF-E9-TF') AS stock, bool_and(o.estatus = 'Entregada') AS entregada FROM ordenes o WHERE o.establecimiento_id = ${tf.id}`);
  ok(v.n === 1 && v.total === '60.00' && v.pagos === 1 && v.stock === '7' && v.entregada && (await c.t('pos-comprobante-total').innerText()).includes('60.00'),
    `9. venta cobrada en pantalla: en la BASE hay 1 orden Entregada de $60, 1 pago y el congelador bajó a 7`);
  await c.captura('e9-02-comprobante');
  await c.page.getByRole('button', { name: 'Nueva venta' }).click();

  // Respuesta perdida: la base cobró, la pantalla no lo supo; reintento con la MISMA operación.
  await c.t('pos-producto-PE9-A').click();
  c.puente.cortarProximaVenta = true;
  await c.page.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await c.page.getByRole('button', { name: /Sí, cobrar/ }).click();
  await c.t('pos-cobro-pendiente').waitFor({ timeout: 15000 });
  v = await uno(`SELECT count(*)::int AS n FROM ordenes WHERE establecimiento_id = ${tf.id}`);
  ok(v.n === 2, '10. se cortó la conexión justo después del cobro: la BASE ya tiene la segunda venta y la pantalla la marca "sin confirmar"');
  await c.page.getByRole('button', { name: 'Revisar ese cobro' }).click();
  await c.t('pos-comprobante').waitFor({ timeout: 15000 });
  v = await uno(`SELECT count(*)::int AS n, sum(o.total)::text AS total, (SELECT count(*)::int FROM pagos p JOIN ordenes o2 ON o2.id = p.orden_id WHERE o2.establecimiento_id = ${tf.id}) AS pagos,
                        (SELECT stock ->> 'PE9-A' FROM cuartos_frios WHERE id = 'CF-E9-TF') AS stock FROM ordenes o WHERE o.establecimiento_id = ${tf.id}`);
  const intentos = c.puente.llamadas.filter(l => l.fn === 'vender_en_tienda');
  ok(v.n === 2 && v.total === '90.00' && v.pagos === 2 && v.stock === '6' && intentos.length === 3 && intentos[1].args.p_operacion_id === intentos[2].args.p_operacion_id,
    `10. el reintento mandó la MISMA operación y la base contestó la venta ya registrada: siguen 2 órdenes, 2 pagos ($90) y existencia 6 — no se cobró dos veces`);
  await c.page.getByRole('button', { name: 'Nueva venta' }).click();

  // Devolución con el efectivo entregado desde la caja abierta (Administración, por la API real).
  const orden1 = (await uno(`SELECT min(id) AS id FROM ordenes WHERE establecimiento_id = ${tf.id}`)).id;
  const orden2 = (await uno(`SELECT max(id) AS id FROM ordenes WHERE establecimiento_id = ${tf.id}`)).id;
  const turno = (await uno(`SELECT id FROM turnos_caja WHERE establecimiento_id = ${tf.id} AND estado = 'abierto'`)).id;
  const opDev = randomUUID();
  const argsDev = { p_operacion_id: opDev, p_orden_id: orden1, p_motivo: 'El cliente devolvió las bolsas', p_disposicion: 'Reintegrar', p_reembolso_medio: 'efectivo_caja', p_reembolso_entregado: true, p_turno_reembolso_id: turno };
  const dev = await exigir(ADMIN, 'corregir_venta_tienda', argsDev);
  const dev2 = await exigir(ADMIN, 'corregir_venta_tienda', argsDev);
  const devOtra = await rpc(ADMIN, 'corregir_venta_tienda', { ...argsDev, p_operacion_id: randomUUID() });
  const pend = await exigir(ADMIN, 'corregir_venta_tienda', { p_operacion_id: randomUUID(), p_orden_id: orden2, p_motivo: 'Producto equivocado', p_disposicion: 'Reintegrar', p_reembolso_medio: 'efectivo_administracion', p_reembolso_entregado: false });
  const d = await uno(`SELECT (SELECT count(*)::int FROM devoluciones WHERE orden_id IN (${orden1}, ${orden2})) AS devs,
                              (SELECT count(*)::int || '|' || sum(monto) FROM movimientos_contables WHERE id IN (SELECT egreso_id FROM devoluciones WHERE orden_id IN (${orden1}, ${orden2}))) AS egresos,
                              (SELECT stock ->> 'PE9-A' FROM cuartos_frios WHERE id = 'CF-E9-TF') AS stock`);
  ok(dev.reembolso.estado === 'ejecutado' && dev2.replay === true && !devOtra.ok && pend.reembolso.estado === 'registrado' && d.devs === 2 && d.egresos === '2|90.00' && d.stock === '9',
    `12–13. dos devoluciones por la API real: una con el efectivo ya entregado desde la caja ($60) y otra pendiente ($30); reintento = misma respuesta, segunda devolución de la misma venta rechazada; 2 egresos contables ($90) e inventario reintegrado (9)`);

  // Cierre a ciegas: esperado = 200 + 90 − 60 = 230.
  await c.page.getByRole('button', { name: 'Mi turno y cierre' }).click();
  await c.t('pos-turno').waitFor({ timeout: 15000 });
  const turnoTxt = await c.t('pos-turno').innerText();
  ok(!/230|esperado/i.test(turnoTxt.replace(/El sistema hace la cuenta al cerrar\./, '')), '11. antes de cerrar la cajera NO ve el efectivo esperado (230)');
  await c.t('pos-contado').fill('225');
  await c.page.getByRole('button', { name: 'Cerrar turno' }).click();
  await c.t('pos-motivo').waitFor({ timeout: 15000 });
  await c.t('pos-motivo').fill('Faltó cambio de un billete');
  await c.page.getByRole('button', { name: 'Cerrar turno' }).click();
  await c.t('pos-cierre-resultado').waitFor({ timeout: 15000 });
  const z = await uno(`SELECT estado, efectivo_esperado::text AS e, efectivo_contado::text AS c, diferencia::text AS d, motivo_diferencia AS m FROM turnos_caja WHERE id = ${turno}`);
  ok(z.estado === 'cerrado' && z.e === '230.00' && z.c === '225.00' && z.d === '-5.00' && z.m === 'Faltó cambio de un billete' && /230\.00/.test(await c.t('pos-cierre-resultado').innerText()),
    `11. cierre en pantalla: la BASE guardó esperado ${z.e} (fondo 200 + efectivo 90 − reembolso de caja 60), contado ${z.c}, diferencia ${z.d} y su motivo`);
  await c.captura('e9-03-cierre');
  const escrituras = c.puente.llamadas.filter(l => l.tabla && l.conSesion && !['GET', 'HEAD'].includes(l.metodo));
  const anonimas = c.puente.llamadas.filter(l => l.tabla && !l.conSesion && !['GET', 'HEAD'].includes(l.metodo));
  console.log(`  (informativo) antes de iniciar sesión la aplicación intentó ${anonimas.length} escritura(s) anónimas (${[...new Set(anonimas.map(l => `${l.metodo} ${l.tabla.split('?')[0]}:${l.status}`))].join(', ') || 'ninguna'}): la base las rechazó todas`);
  ok(escrituras.length === 0, `la cajera no intentó ninguna escritura por REST (${[...new Set(escrituras.map(l => `${l.metodo} ${l.tabla.split('?')[0]}:${l.status}`))].join(', ') || 'ninguna'})`);
  ok(c.errores.length === 0, `cajera: sin errores de JavaScript en la página (${c.errores.slice(0, 2).join(' | ') || 'ninguno'})`);
  await c.ctx.close();

  // ── Administración en el navegador: reportes ──
  const a = await abrir();
  await a.entrar(ADMIN);
  await a.page.waitForFunction(() => /#\//.test(window.location.hash), null, { timeout: 30000 });
  await a.page.goto(`${APP}/#/tiendas`);
  await a.t('tiendas-admin').waitFor({ timeout: 30000 });
  await sleep(2500);
  const cargaAdmin = a.puente.llamadas.filter(l => l.conSesion && l.status >= 400);
  const cargaOk = a.puente.llamadas.filter(l => l.conSesion && l.tabla && l.status < 300);
  ok(cargaOk.length >= 10, `14. la carga central de Administración se leyó de la base real con su sesión (${new Set(cargaOk.map(l => l.tabla.split('?')[0])).size} tablas)`);
  await a.page.getByRole('tab', { name: 'Reportes' }).click();
  await a.t('reportes-por-establecimiento').waitFor({ timeout: 20000 });
  const hoy = (await uno(`SELECT fin_hoy()::text AS d`)).d;
  const filaTienda = await a.page.locator('[data-testid="reportes-por-establecimiento"] tr', { hasText: 'Tienda E9' }).innerText();
  ok(/Tienda de fábrica/.test(filaTienda) && /\$90\.00/.test(filaTienda) && /CEDIS/.test(await a.t('reportes-por-establecimiento').innerText()) && !(await a.t('reportes-descuadre').isVisible()),
    `14. Administración → Tiendas → Reportes (${hoy}): la tienda aparece aparte del CEDIS con 2 ventas y $90 devueltos; el consolidado cuadra (${filaTienda.replace(/\s+/g, ' ').slice(0, 110)})`);
  await a.captura('e9-04-reportes-ventas');
  await a.page.locator('[data-testid="reportes-tiendas"]').getByRole('tab', { name: 'Cajas' }).click();
  await a.t('reportes-turnos').waitFor({ timeout: 15000 });
  const turnosTxt = await a.t('reportes-turnos').innerText();
  const reembTxt = await a.t('reportes-reembolsos').innerText();
  const resumenR = await a.t('reportes-reembolsos-resumen').innerText();
  ok(/Faltaron \$5\.00/.test(turnosTxt) && /Faltó cambio de un billete/.test(turnosTxt) && /\$230\.00/.test(turnosTxt),
    '14. sección Cajas: el turno cerrado con su esperado ($230), el faltante de $5 y su motivo, leídos de la base');
  ok(/Entregado el/.test(reembTxt) && /Pendiente/.test(reembTxt) && /Efectivo de la caja/.test(reembTxt) && /Efectivo de Administración/.test(reembTxt) && /\$90\.00/.test(resumenR) && /\$60\.00/.test(resumenR) && /\$30\.00/.test(resumenR),
    '14. conciliación de reembolsos en pantalla: egreso contable $90; dinero entregado $60 (de la caja); $30 pendientes — el hecho contable y el dinero entregado se ven por separado');
  await a.captura('e9-05-reportes-cajas');
  await a.page.locator('[data-testid="reportes-tiendas"]').getByRole('tab', { name: 'Abastecimiento e incidencias' }).click();
  await a.t('reportes-incidencias').waitFor({ timeout: 15000 });
  ok(new RegExp(tras.folio).test(await a.t('reportes-incidencias').innerText()) && /Una bolsa rota/.test(await a.t('reportes-incidencias').innerText()),
    '14. sección Abastecimiento: la incidencia de la recepción (1 dañada) con su nota');
  const errAdmin = a.puente.llamadas.filter(l => l.fn && /^reporte_/.test(l.fn));
  ok(errAdmin.length >= 5 && errAdmin.every(l => l.status === 200), `14. los ${new Set(errAdmin.map(l => l.fn)).size} contratos de reportes respondieron 200 desde la base real`);
  ok(a.errores.length === 0, `Administración: sin errores de JavaScript en la página (${a.errores.slice(0, 2).join(' | ') || 'ninguno'})`);
  console.log(`  (informativo) peticiones CON sesión de Administración que la base local respondió con error: ${[...new Set(cargaAdmin.map(l => `${l.fn || l.tabla?.split('?')[0]}:${l.status}`))].join(', ') || 'ninguna'}`);
  await a.ctx.close();

  // ── Desactivación (API real) ──
  const off = await exigir(ADMIN, 'activar_tienda', { p_operacion_id: randomUUID(), p_establecimiento_id: tf.id, p_activar: false, p_motivo: 'Fin de la prueba E9' });
  const baja = await rpc(ADMIN, 'guardar_usuario', { p_usuario_id: CAJERA.id, p_nombre: CAJERA.nombre, p_rol: 'Ventas', p_estatus: 'Inactivo' });
  const abrirOff = await rpc(CAJERA, 'abrir_turno_caja', { p_operacion_id: randomUUID(), p_caja_id: caja.id, p_fondo_inicial: 100 });
  ok(off.activo === false && baja.ok && !abrirOff.ok, `15. tienda desactivada con motivo; entonces sí se puede dar de baja a su cajera, y ya nadie abre turno ahí (HTTP ${abrirOff.status})`);
  ok(fuera.length === 0 || fuera.every(o => /fonts|gstatic/.test(o)), `seguridad de la prueba: ninguna petición salió hacia servicios externos de datos (${[...new Set(fuera)].join(', ') || 'ninguna'})`);
} catch (e) {
  console.log(`  FAIL: el recorrido se interrumpió: ${e.message.split('\n')[0]}`);
  fallas++;
} finally {
  try { await browser?.close(); } catch { /* noop */ }
  vite.kill('SIGTERM'); postgrest.kill('SIGTERM');
  try { await db.query('ROLLBACK'); } catch { /* noop */ }
  try { await db.query(LIMPIAR); const f = await uno(`SELECT (SELECT habilitada FROM tiendas_activacion) AS h, (SELECT count(*)::int FROM establecimientos WHERE clave = 'TFE9') AS n`);
    ok(f.h === false && f.n === 0, 'limpieza: la base local queda sin la tienda de prueba y con el interruptor APAGADO'); } catch (e) { console.log(`  FAIL: limpieza: ${e.message}`); fallas++; }
  await db.end();
}
console.log(fallas === 0 ? '── TIENDAS EN NAVEGADOR CONTRA BASE REAL: TODO OK' : `RESULTADO: FALLÓ (${fallas})`);
process.exit(fallas === 0 ? 0 : 1);
