// pos_tienda_simulado.mjs — Tiendas E6: recorrido del punto de venta en un NAVEGADOR real (Chromium),
// contra un servidor SIMULADO. No es parte de la suite de Playwright del repositorio (esa apunta a
// producción y es de solo lectura): se corre a mano, en local.
//
//   node e2e/local/pos_tienda_simulado.mjs
//
// Seguridad: la aplicación se levanta con VITE_SUPABASE_URL apuntando a una dirección local que no
// existe (http://127.0.0.1:54999) y el navegador tiene prohibido salir de 127.0.0.1 / localhost.
// Ninguna petición puede llegar a producción ni a servicios externos.
//
// Qué prueba (interfaz ↔ forma de los contratos de 145–147): sesión de un cajero de tienda, menú
// propio, apertura de turno, precios del servidor, carrito, cobro, pérdida de conexión a medio cobro
// y recuperación con el MISMO operacion_id, comprobante, cierre a ciegas con motivo de diferencia.
// Qué NO prueba: las reglas del servidor (eso es la suite SQL 145–147, contra Postgres real).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BACKEND = 'http://127.0.0.1:54999';
const PUERTO = Number(process.env.POS_E2E_PUERTO) || 5197;
const APP = `http://127.0.0.1:${PUERTO}`;
const CAPTURAS = process.env.POS_E2E_CAPTURAS || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`); if (!cond) fallas++; };

// ── Servidor simulado: mismo comportamiento que los contratos (idempotencia incluida) ──
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'uid-cajera', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
const USUARIO = { id: 6, nombre: 'Cajera de prueba', email: 'cajera@local.test', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-cajera', accesos_extra: [], debe_cambiar_password: false, es_dueno: false };
const TIENDA = { id: 7, clave: 'TF1', nombre: 'Tienda de fábrica (simulada)', tipo: 'tienda_fabrica', clientes_pos: 'lista', vende_desde_cedis: false, traspasa_con_cedis: false };
const PRECIOS = [{ sku: 'HPC-5K', nombre: 'Hielo en cubos 5 kg', precio: 31 }, { sku: 'HPC-25K', nombre: 'Hielo en cubos 25 kg', precio: 92 }];

function crearServidor() {
  const s = { turno: null, ventas: new Map(), stock: { 'HPC-5K': 10, 'HPC-25K': 4 }, llamadas: [], cortarProximaVenta: false, seq: 100, recepciones: new Map(),
    traspaso: { traspaso_id: 7, folio: 'TR-0007', estado: 'en_transito', incidencia: false, incidencia_cerrada: false, responsable: 'Luis Pérez', created_at: new Date().toISOString(), despachado_at: new Date().toISOString(),
      origen: { id: 1, nombre: 'CEDIS', tipo: 'cedis', cuarto_id: 'CF-1' }, destino: { id: 7, nombre: TIENDA.nombre, tipo: 'tienda_fabrica', cuarto_id: 'CF-TF1' },
      lineas: [{ sku: 'HPC-5K', nombre: 'Hielo en cubos 5 kg', cantidad: 10, despachada: 10, recibida: null, danada: null, faltante: null }] } };
  const rechazo = (codigo, mensaje, code = '22023') => ({ status: 400, body: { code, message: mensaje, details: JSON.stringify({ codigo }), hint: null } });
  const rpc = {
    erp_actor: () => [{ id: 6, rol: 'Ventas Tienda', nombre: USUARIO.nombre }],
    mis_establecimientos: () => ({ tiendas_habilitadas: true, perfil: 'Ventas Tienda', establecimientos: [TIENDA] }),
    mi_turno_caja: () => ({ tiendas_habilitadas: true, turno: s.turno && s.turno.estado === 'abierto'
      ? { turno_id: s.turno.id, caja_id: 1, caja: 'Caja 1', establecimiento_id: 7, abierto_at: s.turno.abierto_at, fecha_negocio: '2026-10-12', fondo_inicial: s.turno.fondo, ventas: s.ventas.size } : null,
      cajas: [{ id: 1, nombre: 'Caja 1', establecimiento_id: 7, activa: true, ocupada: !!(s.turno && s.turno.estado === 'abierto') }, { id: 2, nombre: 'Caja 2', establecimiento_id: 7, activa: true, ocupada: true }] }),
    precios_pos: () => ({ cliente_id: null, precios: PRECIOS }),
    buscar_clientes_pos: (a) => (String(a.p_texto || '').trim().length < 3 ? rechazo('BUSQUEDA_CORTA', 'interno') : { clientes: [], hay_mas: false }),
    abrir_turno_caja: (a) => { s.turno = { id: 55, estado: 'abierto', fondo: Number(a.p_fondo_inicial), abierto_at: new Date().toISOString(), op: a.p_operacion_id };
      return { turno_id: 55, estado: 'abierto', caja_id: a.p_caja_id, caja: 'Caja 1', establecimiento_id: 7, fondo_inicial: s.turno.fondo, replay: false }; },
    vender_en_tienda: (a) => {
      if (!s.turno || s.turno.estado !== 'abierto') return rechazo('TURNO_CERRADO', 'interno');
      if (a.p_items.some(i => Object.keys(i).some(k => !['sku', 'cantidad', 'cuarto_id'].includes(k)))) return rechazo('PRECIO_NO_PERMITIDO', 'interno');
      const ya = s.ventas.get(a.p_operacion_id);
      if (ya) return { ...ya, replay: true };
      for (const i of a.p_items) if ((s.stock[i.sku] || 0) < i.cantidad) return rechazo('SIN_EXISTENCIA', 'interno');
      const lineas = a.p_items.map(i => { const p = PRECIOS.find(x => x.sku === i.sku).precio; s.stock[i.sku] -= i.cantidad; return { sku: i.sku, cantidad: i.cantidad, precio_unit: p, subtotal: p * i.cantidad }; });
      const total = lineas.reduce((t, l) => t + l.subtotal, 0);
      s.seq += 1;
      const venta = { orden_id: s.seq, folio: `OV-0${s.seq}`, estatus: 'Entregada', total, metodo: a.p_metodo, pago_id: s.seq, referencia: `OV-0${s.seq}-${a.p_metodo}`, lineas,
        asignacion: a.p_items, desde_cedis: false, cliente_id: null, cliente_nombre: 'Público en general', requiere_factura: false, turno_id: 55, caja_id: 1, establecimiento_id: 7, cajero_id: 6, replay: false };
      s.ventas.set(a.p_operacion_id, venta);
      return venta;
    },
    cerrar_turno_caja: (a) => {
      if (!s.turno || s.turno.estado !== 'abierto') return rechazo('TURNO_CERRADO', 'interno');
      const efectivo = [...s.ventas.values()].filter(v => v.metodo === 'Efectivo').reduce((t, v) => t + v.total, 0);
      const esperado = s.turno.fondo + efectivo; const dif = Number(a.p_efectivo_contado) - esperado;
      if (dif !== 0 && !(a.p_motivo_diferencia && a.p_motivo_diferencia.length >= 3)) return rechazo('MOTIVO_DIFERENCIA', 'interno');
      s.turno.estado = 'cerrado';
      return { turno_id: 55, estado: 'cerrado', efectivo_esperado: esperado, efectivo_contado: Number(a.p_efectivo_contado), diferencia: dif, motivo_diferencia: dif !== 0 ? a.p_motivo_diferencia : null, totales: {}, replay: false };
    },
    mi_asistencia: () => ({ estado: 'sin_empleado' }),
    // E7: traspasos de la tienda y su recepción (idempotente, una sola vez).
    traspasos_consulta: () => ({ puede_recibir: true, resumen: {}, en_camino: s.traspaso.estado === 'en_transito' ? { 'HPC-5K': 10 } : {}, traspasos: [s.traspaso], receptores: null, movimientos: null }),
    recibir_traspaso: (a) => {
      const ya = s.recepciones.get(a.p_operacion_id);
      if (ya) return { ...ya, replay: true };
      if (s.traspaso.estado !== 'en_transito') return rechazo('TRASPASO_NO_EN_TRANSITO', 'interno');
      const i = a.p_items[0]; const faltante = 10 - i.recibida - i.danada;
      if (faltante < 0) return rechazo('RECEPCION_EXCEDE', 'interno');
      const inc = i.danada > 0 || faltante > 0;
      if (inc && !(a.p_notas && a.p_notas.length >= 5)) return rechazo('NOTA_INCIDENCIA_REQUERIDA', 'interno');
      s.stock['HPC-5K'] += i.recibida;
      s.traspaso = { ...s.traspaso, estado: 'recibido', incidencia: inc, recibido_at: new Date().toISOString(), recibido_por: 'Cajera de prueba', notas_recepcion: a.p_notas,
        lineas: [{ ...s.traspaso.lineas[0], recibida: i.recibida, danada: i.danada, faltante }] };
      s.recepciones.set(a.p_operacion_id, s.traspaso);
      return { ...s.traspaso, replay: false };
    },
  };
  const rest = {
    usuarios: () => [USUARIO],
    cuartos_frios: () => [{ id: 'CF-TF1', nombre: 'Congelador de la tienda', establecimiento_id: 7, stock: { ...s.stock } }],
    ordenes: () => [...s.ventas.values()].reverse().map(v => ({ id: v.orden_id, folio: v.folio, total: v.total, metodo_pago: v.metodo, cliente_nombre: v.cliente_nombre, productos: v.lineas.map(l => `${l.cantidad}×${l.sku}`).join(', '),
      estatus: 'Entregada', tiene_devolucion: false, requiere_factura: false, turno_id: 55, created_at: new Date().toISOString() })),
  };
  return { s, rpc, rest };
}

async function atender(route, srv) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return json(200, {});
  if (url.pathname === '/auth/v1/token') {
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'local',
      user: { id: 'uid-cajera', aud: 'authenticated', role: 'authenticated', email: USUARIO.email } });
  }
  if (url.pathname.startsWith('/auth/v1/')) return json(200, { id: 'uid-cajera', aud: 'authenticated', role: 'authenticated', email: USUARIO.email });
  const mRpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (mRpc) {
    const args = req.postDataJSON?.() || {};
    srv.s.llamadas.push({ fn: mRpc[1], args });
    const f = srv.rpc[mRpc[1]];
    if (!f) return json(404, { code: 'PGRST202', message: 'no existe (simulado)' });
    const r = f(args);
    // "Se cae la red justo después de que el servidor cobró": la venta queda registrada y la respuesta nunca llega.
    if (mRpc[1] === 'vender_en_tienda' && srv.s.cortarProximaVenta) { srv.s.cortarProximaVenta = false; return route.abort('connectionfailed'); }
    if (r && r.status) return json(r.status, r.body);
    return json(200, r);
  }
  const mRest = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (mRest) {
    srv.s.llamadas.push({ tabla: mRest[1], metodo: req.method() });
    if (req.method() !== 'GET') return json(403, { code: '42501', message: 'permission denied (simulado: el POS no escribe por REST)' });
    const filas = srv.rest[mRest[1]] ? srv.rest[mRest[1]]() : [];
    const unObjeto = (req.headers().accept || '').includes('vnd.pgrst.object');
    return json(200, unObjeto ? (filas[0] ?? null) : filas);
  }
  return route.abort();
}

async function esperarApp() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(APP); if (r.ok) return true; } catch { /* aún no */ } await sleep(250); }
  return false;
}

const vite = spawn('npx', ['vite', '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], {
  env: { ...process.env, VITE_SUPABASE_URL: BACKEND, VITE_SUPABASE_ANON_KEY: 'local-simulado', VITE_SENTRY_DSN: '', VITE_VAPID_PUBLIC_KEY: '' }, stdio: 'ignore',
});
let browser;
try {
  if (!(await esperarApp())) throw new Error('la aplicación local no levantó');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('E2E', '1'); } catch { /* noop */ } });
  const srv = crearServidor();
  const fuera = [];
  // Candado: nada sale de esta máquina.
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === BACKEND) return atender(route, srv);
    if (['127.0.0.1', 'localhost'].includes(u.hostname)) return route.continue();
    fuera.push(u.origin);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.message)));
  const captura = async (n) => { if (CAPTURAS) { mkdirSync(CAPTURAS, { recursive: true }); await page.screenshot({ path: `${CAPTURAS}/${n}.png`, fullPage: true }); } };
  const t = (id) => page.locator(`[data-testid="${id}"]`);

  console.log('── POS de tienda en navegador (servidor simulado)');
  await page.goto(APP);
  await page.fill('#login-email', USUARIO.email);
  await page.fill('#login-password', 'local');
  await page.click('button[type="submit"]');

  // 1–2. Sesión del vendedor de tienda y su establecimiento.
  await t('pos-tienda').waitFor({ timeout: 20000 });
  ok(page.url().endsWith('#/pos'), `1. el cajero (rol guardado "Ventas") entra directo al punto de venta por su perfil efectivo: ${page.url().split('#')[1]}`);
  ok(srv.s.llamadas.some(l => l.fn === 'erp_actor'), '1. el perfil se le preguntó al servidor (erp_actor)');
  const menu = await page.locator('body').innerText();
  ok(/Punto de venta/.test(menu) && /Mi turno/.test(menu) && /Recibir producto/.test(menu) && !/Rutas|Producción|Por cobrar|Clientes|Congeladores|Facturación|Cortes/.test(menu),
    '2. menú propio: Punto de venta y Mi turno; sin rutas, producción, CxC, clientes ni finanzas');
  // Antes de iniciar sesión la aplicación hace su carga anónima de siempre (el servidor real no le devuelve nada).
  // Lo que importa: DESPUÉS de saber que es un cajero de tienda no pide ninguna tabla central.
  const desde = srv.s.llamadas.findIndex(l => l.fn === 'erp_actor');
  await sleep(1500);
  const cargas = srv.s.llamadas.slice(desde).filter(l => l.tabla).map(l => l.tabla);
  ok(cargas.every(x => ['cuartos_frios', 'ordenes'].includes(x)), `2. ya con su perfil de tienda no pidió ninguna tabla central (pidió: ${[...new Set(cargas)].join(', ') || 'ninguna'})`);
  await captura('01-abrir-turno');

  // 3. Apertura de turno.
  ok(await t('pos-cajas').isVisible() && await page.getByText('Sin un turno abierto no se puede vender.').isVisible(), '3. sin turno abierto no hay pantalla de venta: pide abrir caja');
  ok(await page.getByRole('button', { name: /Caja 2 · en uso/ }).isDisabled(), '3. la caja ocupada por otro cajero aparece "en uso" y no se puede elegir');
  await page.getByRole('button', { name: 'Caja 1', exact: true }).click();
  await t('pos-fondo').fill('200');
  await page.getByRole('button', { name: 'Abrir turno' }).click();
  await t('pos-productos').waitFor({ timeout: 10000 });
  const abrir = srv.s.llamadas.find(l => l.fn === 'abrir_turno_caja');
  ok(abrir && abrir.args.p_caja_id === 1 && abrir.args.p_fondo_inicial === 200 && /^[0-9a-f-]{36}$/.test(abrir.args.p_operacion_id), '3. abrió el turno con el contrato (caja, fondo 200 y operacion_id)');

  // 4. Precios y existencias del servidor.
  const prod = await t('pos-producto-HPC-5K').innerText();
  ok(/\$31\.00/.test(prod) && /Hay 10/.test(prod), `4. producto con el precio y la existencia que dio el servidor (${prod.replace(/\n/g, ' · ')})`);
  const metodos = await t('pos-metodos').innerText();
  ok(await page.locator('input[name*="precio" i], input[placeholder*="precio" i], input[placeholder*="descuento" i]').count() === 0
     && /Efectivo/.test(metodos) && /Tarjeta/.test(metodos) && /Transferencia/.test(metodos) && !/Crédito|Fiado|Link/i.test(metodos),
    '4. no hay campo de precio manual ni de descuento; formas de pago: efectivo, tarjeta y transferencia (sin crédito ni link)');
  await captura('02-punto-de-venta');

  // 5, 8. Venta con cobro inmediato.
  await t('pos-producto-HPC-5K').click(); await t('pos-producto-HPC-5K').click(); await t('pos-producto-HPC-25K').click();
  ok((await t('pos-total').innerText()).includes('154.00'), `5. carrito 2 × 31 + 1 × 92: total mostrado ${await t('pos-total').innerText()}`);
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await page.getByRole('button', { name: /Sí, cobrar/ }).click();
  await t('pos-comprobante').waitFor({ timeout: 10000 });
  const v1 = srv.s.llamadas.filter(l => l.fn === 'vender_en_tienda')[0];
  ok(v1.args.p_metodo === 'Efectivo' && v1.args.p_items.every(i => Object.keys(i).sort().join() === 'cantidad,cuarto_id,sku') && !/precio|total|descuento/.test(JSON.stringify(v1.args)),
    '8. la venta viajó solo con sku, cantidad y congelador: sin precio, total ni descuento');
  // 10. Comprobante.
  const comp = await t('pos-comprobante').innerText();
  ok(/2 × HPC-5K/.test(comp) && (await t('pos-comprobante-total').innerText()).includes('154.00') && /OV-0101/.test(await page.locator('body').innerText()),
    '10. comprobante con el folio, las líneas y el total que devolvió el servidor');
  await captura('03-comprobante');
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  // 9. Se pierde la conexión a medio cobro → recuperación con el MISMO operacion_id.
  await t('pos-producto-HPC-5K').click();
  srv.s.cortarProximaVenta = true;
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await page.getByRole('button', { name: /Sí, cobrar/ }).click();
  await t('pos-cobro-pendiente').waitFor({ timeout: 10000 });
  ok(await page.getByRole('button', { name: 'Cobrar', exact: true }).isDisabled() && await t('pos-producto-HPC-25K').isDisabled(),
    '9. sin respuesta del servidor: el cobro queda "sin confirmar" y la pantalla NO deja hacer otra venta');
  await captura('04-cobro-pendiente');
  await page.reload();
  await t('pos-cobro-pendiente').waitFor({ timeout: 20000 });
  ok(true, '9. al recargar la página el cobro pendiente sigue ahí (está guardado en el aparato)');
  await page.getByRole('button', { name: 'Revisar ese cobro' }).click();
  await t('pos-comprobante').waitFor({ timeout: 10000 });
  const ventas = srv.s.llamadas.filter(l => l.fn === 'vender_en_tienda');
  ok(ventas.length === 3 && ventas[1].args.p_operacion_id === ventas[2].args.p_operacion_id && JSON.stringify(ventas[1].args) === JSON.stringify(ventas[2].args) && srv.s.ventas.size === 2,
    `9. el reintento mandó EXACTAMENTE la misma operación; el servidor tiene ${srv.s.ventas.size} ventas (no 3): no se cobró dos veces`);
  ok(/Ya estaba registrada/i.test(await page.locator('body').innerText()), '9. el comprobante avisa que esa venta ya estaba registrada');
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  ok(!(await t('pos-cobro-pendiente').isVisible()), '9. resuelto el cobro, la pantalla vuelve a vender');

  // 11. Cierre de caja a ciegas.
  await page.getByRole('button', { name: 'Mi turno y cierre' }).click();
  await t('pos-turno').waitFor({ timeout: 10000 });
  await t('pos-turno-ventas').getByText('OV-0102').waitFor({ timeout: 10000 });
  const turnoTxt = await t('pos-turno').innerText();
  ok(/OV-0101/.test(turnoTxt) && /OV-0102/.test(turnoTxt), '11. Mi turno lista las ventas del turno');
  ok(!/385|esperado/i.test(turnoTxt.replace(/El sistema hace la cuenta al cerrar\./, '')), '11. antes de cerrar NO se muestra el efectivo esperado (385) ni la palabra "esperado"');
  await t('pos-contado').fill('300');
  await page.getByRole('button', { name: 'Cerrar turno' }).click();
  await t('pos-motivo').waitFor({ timeout: 10000 });
  const avisoCierre = await t('pos-turno-aviso').innerText();
  ok(/no coincide/i.test(avisoCierre) && !/\d/.test(avisoCierre), `11. si no coincide pide el motivo SIN decir cuánto: "${avisoCierre}"`);
  await captura('05-cierre-motivo');
  await t('pos-motivo').fill('Faltó cambio de un billete');
  await page.getByRole('button', { name: 'Cerrar turno' }).click();
  await t('pos-cierre-resultado').waitFor({ timeout: 10000 });
  const res = await t('pos-cierre-resultado').innerText();
  ok(/385\.00/.test(res) && /300\.00/.test(res) && /-\$?85\.00|−85/.test(res.replace(/\s/g, '')), `11. después de cerrar sí muestra esperado, contado y diferencia (${res.replace(/\n/g, ' ')})`);
  const cierres = srv.s.llamadas.filter(l => l.fn === 'cerrar_turno_caja');
  ok(cierres.length === 2 && cierres[0].args.p_operacion_id !== cierres[1].args.p_operacion_id && cierres[1].args.p_motivo_diferencia === 'Faltó cambio de un billete',
    '11. el cierre rechazado no dejó nada pendiente: el segundo intento es una operación nueva con su motivo');
  ok(/No tienes un turno abierto/.test(await t('pos-turno').innerText()), '11. cerrado el turno, ya no hay turno abierto');
  await captura('06-turno-cerrado');

  // E7. Recibir producto: módulo aparte del punto de venta.
  await page.goto(`${APP}/#/pos-recepcion`);
  await t('pos-recepcion-en-camino').waitFor({ timeout: 10000 });
  const fila = t('traspaso-TR-0007');
  ok(/En tránsito/.test(await fila.innerText()) && /CEDIS/.test(await fila.innerText()) && /Luis Pérez/.test(await fila.innerText()),
    'E7. Recibir producto muestra el traspaso que viene en camino a la tienda (origen, transportista y estado)');
  ok(await fila.getByRole('button', { name: 'Cancelar' }).count() === 0 && await fila.getByRole('button', { name: 'Despachar' }).count() === 0,
    'E7. el personal de la tienda no tiene botones de despachar ni cancelar: solo recibir');
  await fila.getByRole('button', { name: 'Recibir' }).click();
  await t('recibida-HPC-5K').fill('7'); await t('danada-HPC-5K').fill('2');
  ok(/Faltan 1/.test(await t('traspaso-recepcion').innerText()), 'E7. al capturar 7 buenas y 2 dañadas de 10, la pantalla dice que falta 1');
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await t('pos-recepcion-aviso').waitFor({ timeout: 10000 });
  ok(/qué pasó/i.test(await t('pos-recepcion-aviso').innerText()) && srv.s.llamadas.filter(l => l.fn === 'recibir_traspaso').length === 0,
    'E7. con dañados o faltantes exige la nota ANTES de mandar nada al servidor');
  await page.locator('[data-testid="traspaso-recepcion"] textarea').fill('Dos bolsas rotas y falta una');
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await t('pos-recepcion-historial').waitFor({ timeout: 10000 });
  const rec = srv.s.llamadas.filter(l => l.fn === 'recibir_traspaso');
  ok(rec.length === 1 && JSON.stringify(rec[0].args.p_items) === '[{"sku":"HPC-5K","recibida":7,"danada":2}]' && rec[0].args.p_notas === 'Dos bolsas rotas y falta una' && srv.s.stock['HPC-5K'] === 14,
    `E7. la recepción viajó con lo capturado (7 buenas, 2 dañadas) y solo las 7 buenas entraron al congelador (existencia ${srv.s.stock['HPC-5K']})`);
  ok(/con incidencia/i.test(await t('pos-recepcion-historial').innerText()) && /No hay producto en camino/.test(await t('pos-recepcion').innerText()),
    'E7. el traspaso pasa al historial como recibido con incidencia y ya no hay nada en camino');
  await captura('07-recepcion');

  // 14. Aislamiento (lado del navegador).
  for (const modulo of ['rutas', 'tiendas', 'cobros', 'clientes', 'dashboard']) {
    await page.goto(`${APP}/#/${modulo}`); await sleep(500);
    const cuerpo = await page.locator('body').innerText();
    ok(await t('pos-tienda').isVisible() && !(await t('tiendas-admin').isVisible()) && /Abre tu turno de caja/.test(cuerpo),
      `14. un enlace a un módulo que no es suyo (#/${modulo}) no abre nada: sigue en su punto de venta`);
  }
  const escrituras = srv.s.llamadas.filter(l => l.tabla && l.metodo !== 'GET');
  ok(escrituras.length === 0, '14. en todo el recorrido el navegador no intentó NINGUNA escritura por REST');
  const rpcs = [...new Set(srv.s.llamadas.filter(l => l.fn).map(l => l.fn))].sort();
  ok(rpcs.every(f => ['erp_actor', 'mis_establecimientos', 'mi_turno_caja', 'precios_pos', 'buscar_clientes_pos', 'abrir_turno_caja', 'vender_en_tienda', 'cerrar_turno_caja', 'mi_asistencia', 'calendario', 'traspasos_consulta', 'recibir_traspaso'].includes(f)),
    `14. solo llamó contratos de tienda (${rpcs.join(', ')})`);
  ok(fuera.length === 0 || fuera.every(o => /fonts|gstatic/.test(o)), `seguridad de la prueba: ninguna petición salió hacia servicios externos de datos (${[...new Set(fuera)].join(', ') || 'ninguna'})`);
  ok(errores.length === 0, `sin errores de JavaScript en la página (${errores.slice(0, 2).join(' | ') || 'ninguno'})`);
} catch (e) {
  console.log(`  FAIL: el recorrido se interrumpió: ${e.message}`);
  fallas++;
} finally {
  try { await browser?.close(); } catch { /* noop */ }
  vite.kill('SIGTERM');
}
console.log(fallas === 0 ? '── POS EN NAVEGADOR: TODO OK' : `RESULTADO: FALLÓ (${fallas})`);
process.exit(fallas === 0 ? 0 : 1);
