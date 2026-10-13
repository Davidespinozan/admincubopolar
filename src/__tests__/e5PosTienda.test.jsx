// e5PosTienda.test.jsx — Tiendas E5: punto de venta de tiendas propias.
// Lógica pura (carrito, congeladores, argumentos, errores), el flujo de "una sola vez" de cobro,
// apertura y cierre con un servidor de mentira que sí es idempotente, el perfil efectivo, la
// navegación del perfil de tienda y las garantías de las pantallas (sin precios manuales,
// descuentos ni crédito; cierre a ciegas; sin datos centrales).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROL_VENTAS_TIENDA, METODOS_POS, pantallaPos, establecimientoActivo, agregarAlCarrito, cambiarCantidad, quitarDelCarrito, buscarProductos, totalEstimado,
  existenciasPorSku, asignarCuartos, construirVenta, nuevaOperacionId, guardarPendiente, leerPendiente, limpiarPendiente, ejecutarOperacionPos,
  clasificarErrorPos, leerMonto, ventasDelTurno, mediosParaVenta, construirCorreccion, textoReembolso,
} from '../data/posLogic';
import { aplicarPerfilEfectivo, resolverPerfilEfectivo } from '../lib/perfilEfectivo';
import { rolSinDatosNegocio } from '../data/asistenciaLogic';
import { navParaRol, navParaUsuario, idsModulos, idsVistas, normalizarVista, bottomNavParaRol, AREAS_ADMIN, AREAS_BACKOFFICE, MODULO_POS, MODULO_POS_TURNO, MODULO_TIENDAS } from '../data/navRolLogic';
import PosTiendaView, { Comprobante } from '../components/PosTiendaView';
import PosTurnoView from '../components/PosTurnoView';
import { TiendasAdminView } from '../components/views/TiendasAdminView';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const OP = '11111111-2222-4333-8444-555555555555';
const memoria = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

const TIENDA = { id: 7, nombre: 'Tienda Centro', tipo: 'tienda', vende_desde_cedis: false };
const FABRICA = { id: 8, nombre: 'Tienda de fábrica', tipo: 'tienda_fabrica', vende_desde_cedis: true };
const CUARTOS = [
  { id: 'CF-T2', establecimiento_id: 7, stock: { 'HPC-5K': 3 } },
  { id: 'CF-T1', establecimiento_id: 7, stock: { 'HPC-5K': 2, 'HPC-25K': 1 } },
  { id: 'CF-F1', establecimiento_id: 8, stock: { 'HPC-5K': 1 } },
  { id: 'CF-1', establecimiento_id: 1, stock: { 'HPC-5K': 100 } },
  { id: 'CF-OTRA', establecimiento_id: 9, stock: { 'HPC-5K': 50 } },
];
const PRECIOS = [{ sku: 'HPC-5K', nombre: 'Hielo en cubos 5 kg', precio: 31 }, { sku: 'HPC-25K', nombre: 'Hielo en cubos 25 kg', precio: 92 }];

describe('E5: perfil efectivo (lo decide el servidor)', () => {
  it('Ventas + respuesta "Ventas Tienda" de erp_actor → perfil de tienda, sin accesos adicionales', () => {
    const u = { id: 6, rol: 'Ventas', accesos_extra: ['Almacén Bolsas'] };
    expect(aplicarPerfilEfectivo(u, [{ id: 6, rol: 'Ventas Tienda', nombre: 'X' }])).toMatchObject({ rol: ROL_VENTAS_TIENDA, rol_guardado: 'Ventas', accesos_extra: [] });
    expect(aplicarPerfilEfectivo(u, { rol: 'Ventas Tienda' }).rol).toBe(ROL_VENTAS_TIENDA);
  });
  it('cualquier otra respuesta deja al usuario igual: el navegador no inventa perfiles ni sube privilegios', () => {
    const v = { id: 5, rol: 'Ventas', accesos_extra: [] };
    expect(aplicarPerfilEfectivo(v, [{ rol: 'Ventas' }])).toBe(v);
    expect(aplicarPerfilEfectivo(v, [{ rol: 'Admin' }])).toBe(v);
    expect(aplicarPerfilEfectivo(v, [])).toBe(v);
    expect(aplicarPerfilEfectivo(v, null)).toBe(v);
    const chofer = { id: 9, rol: 'Chofer' };
    expect(aplicarPerfilEfectivo(chofer, [{ rol: 'Ventas Tienda' }])).toBe(chofer);
    expect(aplicarPerfilEfectivo(null, [{ rol: 'Ventas Tienda' }])).toBe(null);
  });
  it('solo se pregunta al servidor para el rol guardado Ventas; si falla, se queda el rol guardado', async () => {
    const llamadas = [];
    const sb = (resp) => ({ rpc: async (fn) => { llamadas.push(fn); return resp; } });
    expect((await resolverPerfilEfectivo(sb({ data: [{ rol: 'Ventas Tienda' }], error: null }), { id: 6, rol: 'Ventas' })).rol).toBe(ROL_VENTAS_TIENDA);
    expect(llamadas).toEqual(['erp_actor']);
    for (const rol of ['Admin', 'Chofer', 'Producción', 'Empleado', 'Facturación', 'Almacén Bolsas']) {
      expect((await resolverPerfilEfectivo(sb({ data: [{ rol: 'Ventas Tienda' }] }), { id: 1, rol })).rol).toBe(rol);
    }
    expect(llamadas).toEqual(['erp_actor']);
    expect((await resolverPerfilEfectivo(sb({ data: null, error: { message: 'x' } }), { id: 6, rol: 'Ventas' })).rol).toBe('Ventas');
    expect((await resolverPerfilEfectivo({ rpc: async () => { throw new Error('Failed to fetch'); } }, { id: 6, rol: 'Ventas' })).rol).toBe('Ventas');
  });
  it('se aplica al restaurar la sesión y al iniciar sesión', () => {
    expect(src('../App.jsx')).toMatch(/await resolverPerfilEfectivo\(supabase, restored\)/);
    expect(src('../components/Login.jsx')).toMatch(/onLogin\(await resolverPerfilEfectivo\(supabase, \{/);
  });
});

describe('E5: navegación del perfil de tienda', () => {
  const nav = navParaRol(ROL_VENTAS_TIENDA);
  it('solo Punto de venta, Mi turno y (E7) Recibir producto; entra directo al punto de venta', () => {
    expect([...idsModulos(nav)]).toEqual([MODULO_POS.id, MODULO_POS_TURNO.id, 'pos-recepcion']);
    expect(nav.inicio).toBe('pos');
    expect(nav.modo).toBe('completo');
    expect(bottomNavParaRol(nav).items.map(i => i.id)).toEqual(['pos', 'pos-turno', 'pos-recepcion']);
  });
  it('sin Resumen, Bandeja, rutas, producción, CxC, finanzas, clientes ni ventas centrales: esos hashes no abren nada', () => {
    const ids = idsVistas(nav);
    for (const v of ['dashboard', 'bandeja', 'rutas', 'produccion', 'inventario', 'cobros', 'contabilidad', 'conciliacion', 'clientes', 'precios', 'ordenes', 'ventas',
      'facturacion', 'nomina', 'empleados', 'usuarios', 'auditoria', 'configuracion', 'tiendas', 'kardex', 'mermas']) {
      expect(ids.has(v)).toBe(false);
      expect(normalizarVista(nav, v)).toBe(null);
    }
    expect(nav.chrome).toMatchObject({ busqueda: false, firmas: false, alertas: false, notificaciones: false, verComo: false });
  });
  it('conserva Mi asistencia, Mis actividades y Mi cuenta (lo que el servidor sí le permite)', () => {
    for (const v of ['mi-asistencia', 'mis-actividades', 'mi-cuenta']) expect(normalizarVista(nav, v)).toBe(v);
  });
  it('el menú es el del perfil efectivo aunque el usuario traiga accesos adicionales', () => {
    expect([...idsModulos(navParaUsuario({ rol: ROL_VENTAS_TIENDA, accesos_extra: [] }))]).toEqual(['pos', 'pos-turno', 'pos-recepcion']);
  });
  it('no carga datos de negocio (igual que el Empleado); los roles centrales sí', () => {
    expect(rolSinDatosNegocio(ROL_VENTAS_TIENDA)).toBe(true);
    for (const r of ['Admin', 'Ventas', 'Chofer', 'Producción', 'Facturación', 'Almacén Bolsas', 'Sin asignar']) expect(rolSinDatosNegocio(r)).toBe(false);
  });
  it('"Tiendas" es un módulo solo de Admin; Ventas central y el back office no lo tienen', () => {
    expect(idsModulos(navParaRol('Admin')).has(MODULO_TIENDAS.id)).toBe(true);
    expect(AREAS_ADMIN.find(a => a.id === 'comercial').items.some(i => i.id === 'tiendas')).toBe(true);
    expect(AREAS_BACKOFFICE.flatMap(a => a.items).some(i => i.id === 'tiendas')).toBe(false);
    for (const r of ['Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Empleado', 'Facturación', 'Sin asignar']) {
      expect(idsVistas(navParaRol(r)).has('tiendas')).toBe(false);
      expect(idsVistas(navParaRol(r)).has('pos')).toBe(false);
    }
  });
});

describe('E5: qué pantalla muestra el POS', () => {
  const base = { cargado: true, tiendasHabilitadas: true, establecimientos: [TIENDA], establecimientoId: null, turno: null };
  it('sigue lo que dijo el servidor', () => {
    expect(pantallaPos({ ...base, cargado: false })).toBe('cargando');
    expect(pantallaPos({ ...base, tiendasHabilitadas: false })).toBe('no_activadas');
    expect(pantallaPos({ ...base, establecimientos: [] })).toBe('sin_tienda');
    expect(pantallaPos(base)).toBe('abrir_turno');
    expect(pantallaPos({ ...base, establecimientos: [TIENDA, FABRICA] })).toBe('elegir_tienda');
    expect(pantallaPos({ ...base, establecimientos: [TIENDA, FABRICA], establecimientoId: 8 })).toBe('abrir_turno');
    expect(pantallaPos({ ...base, turno: { turno_id: 3, establecimiento_id: 7 } })).toBe('vender');
  });
  it('sin turno abierto NUNCA se llega a vender', () => {
    for (const est of [[TIENDA], [TIENDA, FABRICA]]) for (const id of [null, 7, 8, 99]) {
      expect(pantallaPos({ ...base, establecimientos: est, establecimientoId: id, turno: null })).not.toBe('vender');
    }
  });
  it('el establecimiento activo es el del turno abierto', () => {
    expect(establecimientoActivo([TIENDA, FABRICA], 7, { establecimiento_id: 8 })).toBe(FABRICA);
    expect(establecimientoActivo([TIENDA], null, null)).toBe(TIENDA);
    expect(establecimientoActivo([TIENDA, FABRICA], null, null)).toBe(null);
    expect(establecimientoActivo([TIENDA], 99, null)).toBe(null);
  });
});

describe('E5: carrito', () => {
  it('guarda solo sku, nombre y cantidad (nunca precio)', () => {
    let c = agregarAlCarrito([], { sku: 'HPC-5K', nombre: 'Hielo', precio: 1 }, 2);
    c = agregarAlCarrito(c, { sku: 'HPC-5K', nombre: 'Hielo', precio: 999 }, 1);
    expect(c).toEqual([{ sku: 'HPC-5K', nombre: 'Hielo', cantidad: 3 }]);
    expect(Object.keys(c[0])).toEqual(['sku', 'nombre', 'cantidad']);
  });
  it('cantidades enteras; 0 quita la línea; entradas inválidas no agregan', () => {
    let c = agregarAlCarrito([], PRECIOS[0], 1);
    expect(cambiarCantidad(c, 'HPC-5K', 4.9)[0].cantidad).toBe(4);
    expect(cambiarCantidad(c, 'HPC-5K', 0)).toEqual([]);
    expect(cambiarCantidad(c, 'HPC-5K', -3)).toEqual([]);
    expect(quitarDelCarrito(c, 'HPC-5K')).toEqual([]);
    expect(agregarAlCarrito(c, { sku: '' }, 1)).toBe(c);
    expect(agregarAlCarrito(c, PRECIOS[1], 0)).toBe(c);
    expect(agregarAlCarrito(null, PRECIOS[0], 'x')).toEqual([]);
  });
  it('busca por nombre o clave, sin acentos ni mayúsculas', () => {
    expect(buscarProductos(PRECIOS, '25').map(p => p.sku)).toEqual(['HPC-25K']);
    expect(buscarProductos(PRECIOS, 'HIELO').length).toBe(2);
    expect(buscarProductos(PRECIOS, '').length).toBe(2);
    expect(buscarProductos(PRECIOS, 'zzz')).toEqual([]);
  });
  it('el total mostrado usa SOLO precios del servidor y avisa de un SKU sin precio', () => {
    const c = [{ sku: 'HPC-5K', nombre: 'a', cantidad: 2 }, { sku: 'HPC-25K', nombre: 'b', cantidad: 1 }];
    expect(totalEstimado(c, PRECIOS).total).toBe(154);
    expect(totalEstimado(c, [{ sku: 'HPC-5K', precio: 28 }])).toMatchObject({ total: 56, sinPrecio: ['HPC-25K'] });
    expect(totalEstimado([], PRECIOS).total).toBe(0);
  });
});

describe('E5: de qué congelador sale el producto', () => {
  it('la existencia visible es la de la tienda; el CEDIS solo con permiso; nunca otra tienda', () => {
    expect(existenciasPorSku(CUARTOS, 7, false)['HPC-5K']).toEqual({ tienda: 5, cedis: 0, total: 5 });
    expect(existenciasPorSku(CUARTOS, 8, true)['HPC-5K']).toEqual({ tienda: 1, cedis: 100, total: 101 });
    expect(existenciasPorSku(CUARTOS, 8, false)['HPC-5K']).toEqual({ tienda: 1, cedis: 0, total: 1 });
  });
  it('reparte por los congeladores de la tienda en orden; sin permiso no toca el CEDIS', () => {
    const r = asignarCuartos([{ sku: 'HPC-5K', cantidad: 4 }], CUARTOS, 7, false);
    expect(r.asignacion).toEqual([{ sku: 'HPC-5K', cantidad: 2, cuarto_id: 'CF-T1' }, { sku: 'HPC-5K', cantidad: 2, cuarto_id: 'CF-T2' }]);
    expect(r).toMatchObject({ faltantes: [], desdeCedis: false });
    expect(asignarCuartos([{ sku: 'HPC-5K', cantidad: 6 }], CUARTOS, 7, false).faltantes).toEqual([{ sku: 'HPC-5K', falta: 1 }]);
  });
  it('tienda de fábrica con permiso: primero su congelador y luego el CEDIS', () => {
    const r = asignarCuartos([{ sku: 'HPC-5K', cantidad: 3 }], CUARTOS, 8, true);
    expect(r.asignacion).toEqual([{ sku: 'HPC-5K', cantidad: 1, cuarto_id: 'CF-F1' }, { sku: 'HPC-5K', cantidad: 2, cuarto_id: 'CF-1' }]);
    expect(r.desdeCedis).toBe(true);
  });
  it('jamás propone el congelador de otra tienda', () => {
    for (const [est, cedis] of [[7, false], [7, true], [8, true]]) {
      expect(asignarCuartos([{ sku: 'HPC-5K', cantidad: 500 }], CUARTOS, est, cedis).asignacion.some(a => a.cuarto_id === 'CF-OTRA')).toBe(false);
    }
  });
});

describe('E5: argumentos de vender_en_tienda', () => {
  const carrito = [{ sku: 'HPC-5K', nombre: 'Hielo 5', cantidad: 3 }];
  const base = { operacionId: OP, turnoId: 12, carrito, cuartos: CUARTOS, establecimiento: TIENDA, metodo: 'Efectivo' };
  it('cada partida lleva SOLO sku, cantidad y cuarto_id; no viajan precio, descuento, subtotal ni total', () => {
    const { args } = construirVenta(base);
    expect(args).toEqual({ p_operacion_id: OP, p_turno_id: 12, p_metodo: 'Efectivo', p_cliente_id: null, p_referencia: null, p_requiere_factura: false,
      p_items: [{ sku: 'HPC-5K', cantidad: 2, cuarto_id: 'CF-T1' }, { sku: 'HPC-5K', cantidad: 1, cuarto_id: 'CF-T2' }] });
    for (const it of args.p_items) expect(Object.keys(it).sort()).toEqual(['cantidad', 'cuarto_id', 'sku']);
    expect(JSON.stringify(args)).not.toMatch(/precio|descuento|subtotal|total/i);
  });
  it('sin turno abierto no hay venta', () => {
    expect(construirVenta({ ...base, turnoId: null }).error).toMatch(/turno/i);
    expect(construirVenta({ ...base, turnoId: undefined }).args).toBeUndefined();
  });
  it('solo efectivo, tarjeta o transferencia: el crédito y el link de pago no existen en el POS', () => {
    expect(METODOS_POS.map(m => m.id)).toEqual(['Efectivo', 'Tarjeta (terminal)', 'Transferencia SPEI']);
    for (const m of ['Crédito (fiado)', 'Crédito', 'QR / Link de pago', '', null]) expect(construirVenta({ ...base, metodo: m }).error).toMatch(/forma de pago/i);
  });
  it('carrito vacío, faltante o factura sin cliente → no se manda nada', () => {
    expect(construirVenta({ ...base, carrito: [] }).error).toMatch(/producto/i);
    expect(construirVenta({ ...base, carrito: [{ sku: 'HPC-5K', nombre: 'Hielo 5', cantidad: 9 }] }).error).toMatch(/faltan 4/);
    expect(construirVenta({ ...base, requiereFactura: true }).error).toMatch(/cliente/i);
    expect(construirVenta({ ...base, requiereFactura: true, cliente: { id: 3, puede_facturar: false } }).error).toMatch(/datos fiscales/i);
  });
  it('con cliente, referencia y factura', () => {
    const { args } = construirVenta({ ...base, metodo: 'Tarjeta (terminal)', cliente: { id: 3, puede_facturar: true }, referencia: '  AUT   123 ', requiereFactura: true });
    expect(args).toMatchObject({ p_cliente_id: 3, p_referencia: 'AUT 123', p_requiere_factura: true, p_metodo: 'Tarjeta (terminal)' });
  });
  it('cada cobro nuevo tiene su propio operacion_id (UUID)', () => {
    const a = nuevaOperacionId(); const b = nuevaOperacionId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(construirVenta({ ...base, operacionId: undefined }).args.p_operacion_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('E5: clasificación de errores (sin exponer detalles internos)', () => {
  const rechazo = (codigo, extra = {}) => ({ code: '22023', message: 'vender_en_tienda: detalle interno SQL', details: JSON.stringify({ codigo, ...extra }) });
  it('un rechazo con código da un texto para la persona y NUNCA el mensaje interno', () => {
    for (const c of ['SOLO_PAGO_INMEDIATO', 'PRECIO_NO_PERMITIDO', 'CEDIS_SIN_PERMISO', 'INVENTARIO_DE_OTRA_TIENDA', 'CLIENTE_NO_DISPONIBLE', 'TURNO_CERRADO', 'MOTIVO_DIFERENCIA', 'CAJA_OCUPADA', 'YA_CORREGIDA']) {
      const r = clasificarErrorPos(rechazo(c));
      expect(r).toMatchObject({ incierto: false, codigo: c });
      expect(r.mensaje).not.toMatch(/vender_en_tienda|SQL|detalle interno/);
      expect(r.mensaje.length).toBeGreaterThan(10);
    }
    expect(clasificarErrorPos(rechazo('SIN_EXISTENCIA', { sku: 'HPC-5K', disponible: 2, pedido: 5 })).mensaje).toBe('No hay suficiente HPC-5K: hay 2 y se piden 5.');
  });
  it('sin código reconocido: mensaje genérico, nunca el texto del servidor', () => {
    expect(clasificarErrorPos({ code: '42501', message: 'vender_en_tienda: no autorizado' })).toMatchObject({ incierto: false, codigo: 'NO_AUTORIZADO', mensaje: 'No tienes permiso para esta acción.' });
    const g = clasificarErrorPos({ code: '22023', message: 'relation "x" secret' });
    expect(g.incierto).toBe(false);
    expect(g.mensaje).toBe('No se pudo completar la operación. Intenta de nuevo.');
    expect(clasificarErrorPos(rechazo('CODIGO_NUEVO_DESCONOCIDO')).mensaje).toBe('No se pudo completar la operación. Intenta de nuevo.');
  });
  it('el motivo de la diferencia no revela montos', () => {
    expect(clasificarErrorPos(rechazo('MOTIVO_DIFERENCIA')).mensaje).not.toMatch(/\d/);
  });
  it('sin conexión, tiempo agotado o respuesta sin rechazo → INCIERTO (no se sabe si se hizo)', () => {
    expect(clasificarErrorPos({ message: 'TypeError: Failed to fetch' })).toMatchObject({ incierto: true, codigo: 'SIN_CONEXION' });
    expect(clasificarErrorPos({ code: '22023', details: '{"codigo":"TURNO_CERRADO"}' }, false).incierto).toBe(true);
    expect(clasificarErrorPos({ code: 'PGRST301', message: 'JWT expired' }).incierto).toBe(true);
    expect(clasificarErrorPos({ code: '57014', message: 'canceling statement' }).incierto).toBe(true);
    expect(clasificarErrorPos({ message: 'Internal Server Error' }).incierto).toBe(true);
    expect(clasificarErrorPos(null).incierto).toBe(true);
  });
});

describe('E5: una operación no se repite (cobro, apertura y cierre)', () => {
  // Servidor de mentira con la misma garantía que el real: el mismo operacion_id devuelve la venta original.
  const servidor = () => {
    const ventas = new Map(); const llamadas = [];
    return {
      ventas, llamadas,
      vender: (modo) => async (args) => {
        llamadas.push(JSON.parse(JSON.stringify(args)));
        if (modo.value === 'sin_llegar') return { error: 'sin conexión', codigo: 'SIN_CONEXION', incierto: true };
        if (modo.value === 'rechazo') return { error: 'No hay suficiente producto en el congelador.', codigo: 'SIN_EXISTENCIA', incierto: false };
        const ya = ventas.get(args.p_operacion_id);
        const venta = ya ? { ...ya, replay: true } : { orden_id: 100 + ventas.size, folio: 'OV-0' + (100 + ventas.size), total: 93, replay: false };
        if (!ya) ventas.set(args.p_operacion_id, venta);
        if (modo.value === 'llego_sin_respuesta') return { error: 'sin conexión', codigo: 'SIN_CONEXION', incierto: true };
        return { data: venta };
      },
    };
  };
  const args = () => construirVenta({ operacionId: OP, turnoId: 12, carrito: [{ sku: 'HPC-5K', nombre: 'a', cantidad: 3 }], cuartos: CUARTOS, establecimiento: TIENDA, metodo: 'Efectivo' }).args;

  it('venta normal: queda registrada y no deja nada pendiente en el aparato', async () => {
    const s = servidor(); const st = memoria(); const modo = { value: 'ok' };
    const r = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args() }, llamar: s.vender(modo) });
    expect(r).toMatchObject({ estado: 'hecha', data: { folio: 'OV-0100', replay: false } });
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
    expect(s.ventas.size).toBe(1);
  });

  it('se guarda en el aparato ANTES de mandarla', async () => {
    const st = memoria(); let guardadoAlLlamar = null;
    await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args() },
      llamar: async () => { guardadoAlLlamar = leerPendiente(st, 'cobro', 6); return { data: {} }; } });
    expect(guardadoAlLlamar.args.p_operacion_id).toBe(OP);
  });

  it('se pierde la conexión DESPUÉS de que el servidor cobró: queda pendiente y el reintento devuelve la MISMA venta (no cobra dos veces)', async () => {
    const s = servidor(); const st = memoria(); const modo = { value: 'llego_sin_respuesta' };
    const r1 = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args(), resumen: { total: 93 } }, llamar: s.vender(modo) });
    expect(r1.estado).toBe('pendiente');
    const guardado = leerPendiente(st, 'cobro', 6);        // sobrevive a cerrar la app: está en el aparato
    expect(guardado.args).toEqual(args());
    modo.value = 'ok';
    const r2 = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: guardado, llamar: s.vender(modo) });
    expect(r2).toMatchObject({ estado: 'hecha', data: { folio: 'OV-0100', replay: true } });
    expect(s.ventas.size).toBe(1);
    expect(s.llamadas[1]).toEqual(s.llamadas[0]);          // el reintento manda EXACTAMENTE lo mismo
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
  });

  it('se pierde la conexión ANTES de llegar: el reintento con el mismo id la registra una sola vez', async () => {
    const s = servidor(); const st = memoria(); const modo = { value: 'sin_llegar' };
    const r1 = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args() }, llamar: s.vender(modo) });
    expect(r1.estado).toBe('pendiente');
    expect(s.ventas.size).toBe(0);
    modo.value = 'ok';
    const r2 = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: leerPendiente(st, 'cobro', 6), llamar: s.vender(modo) });
    expect(r2).toMatchObject({ estado: 'hecha', data: { replay: false } });
    expect(s.ventas.size).toBe(1);
  });

  it('varios reintentos sin conexión siguen siendo la misma operación', async () => {
    const s = servidor(); const st = memoria(); const modo = { value: 'sin_llegar' };
    for (let i = 0; i < 3; i++) await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: leerPendiente(st, 'cobro', 6) || { args: args() }, llamar: s.vender(modo) });
    expect(new Set(s.llamadas.map(l => l.p_operacion_id)).size).toBe(1);
  });

  it('un rechazo del servidor no deja nada pendiente (la siguiente venta es otra operación)', async () => {
    const s = servidor(); const st = memoria();
    const r = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args() }, llamar: s.vender({ value: 'rechazo' }) });
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'SIN_EXISTENCIA' });
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
  });

  it('una excepción de la llamada se trata como incierta (queda pendiente)', async () => {
    const st = memoria();
    const r = await ejecutarOperacionPos({ tipo: 'cobro', storage: st, usuarioId: 6, pendiente: { args: args() }, llamar: async () => { throw new Error('Failed to fetch'); } });
    expect(r.estado).toBe('pendiente');
    expect(leerPendiente(st, 'cobro', 6)).not.toBe(null);
  });

  it('lo pendiente es por persona y por tipo; lo corrupto se ignora', () => {
    const st = memoria();
    guardarPendiente(st, 'cobro', 6, { args: args() });
    expect(leerPendiente(st, 'cobro', 7)).toBe(null);
    expect(leerPendiente(st, 'cierre', 6)).toBe(null);
    limpiarPendiente(st, 'cobro', 6);
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
    st.setItem('cubopolar_pos_cobro_6', '{{basura');
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
    st.setItem('cubopolar_pos_cobro_6', JSON.stringify({ args: {} }));
    expect(leerPendiente(st, 'cobro', 6)).toBe(null);
    expect(leerPendiente(null, 'cobro', 6)).toBe(null);
    expect(guardarPendiente(null, 'cobro', 6, {})).toBe(false);
  });

  it('apertura y cierre usan el mismo cuidado: un cierre sin respuesta se reintenta con los mismos datos', async () => {
    const st = memoria(); const llamadas = []; let caida = true;
    const cerrar = async (a) => { llamadas.push(a); if (caida) return { error: 'x', incierto: true }; return { data: { estado: 'cerrado', efectivo_esperado: 190, efectivo_contado: 190, diferencia: 0 } }; };
    const a = { p_operacion_id: OP, p_turno_id: 12, p_efectivo_contado: 190, p_motivo_diferencia: null, p_notas: null };
    expect((await ejecutarOperacionPos({ tipo: 'cierre', storage: st, usuarioId: 6, pendiente: { args: a }, llamar: cerrar })).estado).toBe('pendiente');
    caida = false;
    const r = await ejecutarOperacionPos({ tipo: 'cierre', storage: st, usuarioId: 6, pendiente: leerPendiente(st, 'cierre', 6), llamar: cerrar });
    expect(r).toMatchObject({ estado: 'hecha', data: { estado: 'cerrado', diferencia: 0 } });
    expect(llamadas[1]).toEqual(llamadas[0]);
  });
});

describe('E5: turno', () => {
  it('montos: pesos con centavos; texto raro o negativo se rechaza', () => {
    expect(leerMonto('1,250.50')).toEqual({ valor: 1250.5 });
    expect(leerMonto('$ 0')).toEqual({ valor: 0 });
    for (const t of ['', 'abc', '-5', '10.005', '1e3', null]) expect(leerMonto(t).error).toBeTruthy();
  });
  it('ventas del turno: solo las de ese turno, la más reciente primero', () => {
    const o = [{ id: 1, turno_id: 12 }, { id: 3, turno_id: 12 }, { id: 2, turno_id: 13 }, { id: 4, turno_id: null }];
    expect(ventasDelTurno(o, 12).map(x => x.id)).toEqual([3, 1]);
    expect(ventasDelTurno(null, 12)).toEqual([]);
  });
  it('cierre a ciegas: la pantalla del cajero no pide ni muestra el efectivo esperado antes de cerrar, ni suma el efectivo vendido', () => {
    const t = sinComentarios(src('../components/PosTurnoView.jsx'));
    expect(t).not.toMatch(/turno_caja_totales|cobrado_efectivo|resumenVentas|porMetodo/);
    // "esperado" solo aparece al pintar el resultado de un turno YA cerrado.
    const usos = t.split('\n').filter(l => /esperado/i.test(l));
    expect(usos.length).toBeGreaterThan(0);
    for (const l of usos) expect(l).toMatch(/cierre\.efectivo_esperado|Esperado<|sistema hace la cuenta|no coincide/);
    expect(sinComentarios(src('../components/PosTiendaView.jsx'))).not.toMatch(/esperado/i);
    expect(sinComentarios(src('../data/supaStore.js'))).not.toMatch(/turno_caja_totales/);
  });
});

describe('E5: correcciones (Administración)', () => {
  const base = { operacionId: OP, ordenId: 50, motivo: 'El cliente devolvió todo', disposicion: 'Reintegrar', medio: 'efectivo_administracion', entregado: false, metodoVenta: 'Efectivo' };
  it('el reembolso electrónico solo aplica si la venta NO fue en efectivo y nunca nace como entregado', () => {
    expect(mediosParaVenta('Efectivo').map(m => m.id)).toEqual(['efectivo_caja', 'efectivo_administracion']);
    expect(mediosParaVenta('Tarjeta (terminal)').map(m => m.id)).toContain('electronico');
    expect(construirCorreccion({ ...base, medio: 'electronico' }).error).toBeTruthy();
    expect(construirCorreccion({ ...base, metodoVenta: 'Tarjeta (terminal)', medio: 'electronico', entregado: true }).error).toMatch(/terminal o el banco/);
    expect(construirCorreccion({ ...base, metodoVenta: 'Tarjeta (terminal)', medio: 'electronico' }).args).toMatchObject({ p_reembolso_medio: 'electronico', p_reembolso_entregado: false, p_turno_reembolso_id: null });
  });
  it('efectivo de caja ya entregado exige el turno; pendiente no lleva turno', () => {
    expect(construirCorreccion({ ...base, medio: 'efectivo_caja', entregado: true }).error).toMatch(/turno/);
    expect(construirCorreccion({ ...base, medio: 'efectivo_caja', entregado: true, turnoReembolsoId: 12 }).args.p_turno_reembolso_id).toBe(12);
    expect(construirCorreccion({ ...base, medio: 'efectivo_caja', entregado: false, turnoReembolsoId: 12 }).args.p_turno_reembolso_id).toBe(null);
  });
  it('motivo, disposición y partidas', () => {
    expect(construirCorreccion({ ...base, motivo: 'x' }).error).toMatch(/motivo/);
    expect(construirCorreccion({ ...base, disposicion: 'Otra' }).error).toBeTruthy();
    expect(construirCorreccion(base).args).toMatchObject({ p_items: null, p_cuarto_id: null, p_disposicion: 'Reintegrar' });
    expect(construirCorreccion({ ...base, disposicion: 'Merma', cuartoId: 'CF-T1' }).args.p_cuarto_id).toBe(null);
    expect(construirCorreccion({ ...base, items: [{ sku: 'A', cantidad: '2' }, { sku: 'B', cantidad: 0 }] }).args.p_items).toEqual([{ sku: 'A', cantidad: 2 }]);
    expect(construirCorreccion({ ...base, items: [{ sku: 'B', cantidad: 0 }] }).error).toMatch(/devuelve/);
  });
  it('"registrado" nunca se presenta como dinero devuelto', () => {
    expect(textoReembolso({ reembolso_estado: 'ejecutado' }).texto).toBe('Dinero devuelto');
    expect(textoReembolso({ reembolso_estado: 'registrado', reembolso_medio: 'electronico' }).texto).toMatch(/Pendiente.*terminal o el banco/);
    expect(textoReembolso({ reembolso_estado: 'registrado', reembolso_medio: 'efectivo_caja' }).texto).toMatch(/Pendiente.*efectivo/);
    expect(textoReembolso({ reembolso_estado: 'sin_reembolso' }).texto).toBe('Sin reembolso');
    for (const m of ['electronico', 'efectivo_caja', 'efectivo_administracion']) expect(textoReembolso({ reembolso_estado: 'registrado', reembolso_medio: m }).texto).not.toMatch(/devuelto/i);
  });
});

describe('E5: garantías de las pantallas y del store', () => {
  const pos = sinComentarios(src('../components/PosTiendaView.jsx'));
  const store = src('../data/supaStore.js');
  it('el POS no tiene campos de precio manual, descuento ni crédito', () => {
    expect(pos).not.toMatch(/descuento\s*[:=]|setDescuento|setPrecio|precioManual|Crédito \(fiado\)|tipo_cobro|fiado/i);
    expect(pos).not.toMatch(/<input[^>]*precio/i);
  });
  it('el comprobante se pinta SOLO con lo que devolvió el servidor', () => {
    const html = renderToStaticMarkup(<Comprobante tienda={TIENDA} onCerrar={() => {}} venta={{ folio: 'OV-0123', total: 93, metodo: 'Efectivo', cliente_nombre: 'Público en general',
      lineas: [{ sku: 'HPC-5K', cantidad: 3, precio_unit: 31, subtotal: 93 }] }} />);
    expect(html).toMatch(/OV-0123/);
    expect(html).toMatch(/3 × HPC-5K/);
    expect(html).toMatch(/\$93\.00/);
    expect(renderToStaticMarkup(<Comprobante venta={null} />)).toBe('');
  });
  it('las tres pantallas montan sin datos (antes de que responda el servidor) sin mostrar nada central', () => {
    const acciones = new Proxy({}, { get: () => async () => ({ data: null }) });
    const a = renderToStaticMarkup(<PosTiendaView user={{ id: 6 }} actions={acciones} />);
    const b = renderToStaticMarkup(<PosTurnoView user={{ id: 6 }} actions={acciones} />);
    const c = renderToStaticMarkup(<TiendasAdminView actions={acciones} />);
    expect(a).toMatch(/data-testid="pos-tienda"/);
    expect(b).toMatch(/data-testid="pos-turno"/);
    expect(c).toMatch(/data-testid="tiendas-admin"/);
    for (const h of [a, b]) expect(h).not.toMatch(/Rutas|Producción|Por cobrar|CxC|Contabilidad/);
  });
  it('las vistas de tienda solo usan acciones pos*: ninguna acción ni dato central', () => {
    for (const f of ['../components/PosTiendaView.jsx', '../components/PosTurnoView.jsx']) {
      const t = sinComentarios(src(f));
      const usadas = [...t.matchAll(/actions\.([A-Za-z]+)/g)].map(m => m[1]);
      expect(usadas.length).toBeGreaterThan(0);
      for (const a of usadas) expect(a).toMatch(/^pos[A-Z]/);
      expect(t).not.toMatch(/\bdata\.(clientes|ordenes|rutas|pagos|productos|cuentasPorCobrar|movContables)/);
      expect(t).not.toMatch(/supabase/);
    }
  });
  it('el store llama exactamente a los contratos de E3/E4 y a nada inventado', () => {
    const rpcs = ['mis_establecimientos', 'mi_turno_caja', 'precios_pos', 'buscar_clientes_pos', 'abrir_turno_caja', 'vender_en_tienda', 'cerrar_turno_caja',
      'guardar_caja', 'reabrir_turno_caja', 'corregir_venta_tienda', 'confirmar_reembolso_tienda'];
    for (const r of rpcs) expect(store).toMatch(new RegExp(`'${r}'`));
    const bloque = store.slice(store.indexOf('// ── Tiendas E5'), store.indexOf('// ── WF-0 + PD-01 (mig 116): asistencia'));
    expect(bloque.length).toBeGreaterThan(500);
    // Sin escrituras REST: en tiendas todo cambio pasa por un contrato.
    expect(bloque).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    // Lecturas REST solo de tablas que el servidor acota por RLS.
    expect([...new Set([...bloque.matchAll(/\.from\('([a-z_]+)'\)/g)].map(m => m[1]))].sort())
      .toEqual(['cajas', 'correcciones_venta_tienda', 'cuartos_frios', 'ordenes', 'turnos_caja', 'ventas_tienda']);
    // La administración de tiendas exige Admin también en el cliente (además del servidor).
    for (const a of ['tiendasAdminDatos', 'guardarCaja', 'reabrirTurnoCaja', 'corregirVentaTienda', 'confirmarReembolsoTienda']) {
      expect(bloque).toMatch(new RegExp(`${a}: async \\([^)]*\\) => \\{\\s*const guard = requireAdmin\\(\\);`));
    }
  });
  it('el shell pinta las vistas nuevas en sus módulos', () => {
    const shell = src('../components/CuboPolarERP.jsx');
    expect(shell).toMatch(/case MODULO_POS\.id: return <PosTiendaView/);
    expect(shell).toMatch(/case MODULO_POS_TURNO\.id: return <PosTurnoView/);
    expect(shell).toMatch(/case MODULO_TIENDAS\.id: return <TiendasAdminView/);
  });
});
