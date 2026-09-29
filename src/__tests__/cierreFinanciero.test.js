// cierreFinanciero.test.js — F4 (086): ciclo de vida del operacion_id del
// cierre financiero, clave lógica insensible a orden/alias, builders con los
// nombres exactos de la RPC, mensajes y persistencia del UUID.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizarEntregasCierre, claveCierreFinanciero, buildCerrarFinancieroArgs,
  interpretarCierreFinanciero, mensajeErrorCierreFinanciero, resolverOperacion,
  leerOperacionCierre, guardarOperacionCierre, borrarOperacionCierre, claveStorageCierre,
} from '../data/cierreFinancieroLogic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const entregasUI = [
  { ordenId: 8620, folio: 'OV-8620', items: [{ sku: 'P86-A', cant: 2 }], total: 60, pago: 'Efectivo', referencia: '' },
  { ordenId: 8621, items: [{ sku: 'P86-A', cant: 3 }], total: 90, pago: 'Crédito' },
  { express: true, cliente: 'Público en general', pago: 'Tarjeta', referencia: 'TPV-1', items: [{ sku: 'P86-A', cant: 2, precio: 35 }] },
  { express: true, clienteId: 8611, cliente: 'Cliente Crédito 86', pago: 'Crédito', items: [{ sku: 'P86-A', cant: 1, precio: 35 }] },
];

describe('normalizarEntregasCierre', () => {
  it('produce el payload que consume cerrar_ruta_financiero', () => {
    const p = normalizarEntregasCierre(entregasUI);
    expect(p[0]).toMatchObject({ ordenId: 8620, express: false, pago: 'Efectivo', referencia: null, items: [{ sku: 'P86-A', cant: 2, precio: 0 }] });
    expect(p[2]).toMatchObject({ ordenId: null, express: true, cliente: 'Público en general', referencia: 'TPV-1', items: [{ sku: 'P86-A', cant: 2, precio: 35 }] });
    expect(p[3].clienteId).toBe(8611);
    expect(normalizarEntregasCierre(null)).toEqual([]);
  });
});

describe('claveCierreFinanciero', () => {
  const base = normalizarEntregasCierre(entregasUI);
  it('misma petición lógica con otro orden, otras llaves, qty/cant y espacios → misma clave', () => {
    const reordenada = [
      { items: [{ precio: 35.0, qty: 1, sku: 'P86-A' }], pago: 'Crédito', cliente: ' Cliente Crédito 86 ', clienteId: '8611', express: true },
      { pago: 'Crédito', ordenId: '8621' },
      { items: [{ sku: 'P86-A', cant: 2, precio: 35 }], referencia: ' TPV-1 ', pago: 'Tarjeta', cliente: 'Público en general', express: true },
      { ordenId: 8620, pago: 'Efectivo', referencia: null },
    ];
    expect(claveCierreFinanciero(8601, reordenada)).toBe(claveCierreFinanciero('8601', base));
  });
  it('otra ruta, otro método, otra referencia, otro precio/cantidad, una venta más o factura → otra clave', () => {
    const k = claveCierreFinanciero(8601, base);
    expect(claveCierreFinanciero(8602, base)).not.toBe(k);
    const m = structuredClone(base); m[0].pago = 'Tarjeta';
    expect(claveCierreFinanciero(8601, m)).not.toBe(k);
    const r = structuredClone(base); r[0].referencia = 'X';
    expect(claveCierreFinanciero(8601, r)).not.toBe(k);
    const pr = structuredClone(base); pr[2].items[0].precio = 36;
    expect(claveCierreFinanciero(8601, pr)).not.toBe(k);
    const c = structuredClone(base); c[2].items[0].cant = 3;
    expect(claveCierreFinanciero(8601, c)).not.toBe(k);
    const f = structuredClone(base); f[3].factura = true;
    expect(claveCierreFinanciero(8601, f)).not.toBe(k);
    expect(claveCierreFinanciero(8601, [...base, { express: true, pago: 'Efectivo', items: [{ sku: 'P86-A', cant: 1, precio: 35 }] }])).not.toBe(k);
  });
  it('la atribución (usuario) no forma parte de la clave', () => {
    expect(claveCierreFinanciero(8601, base)).not.toMatch(/Chofer|usuario/);
  });
});

describe('ciclo de vida del operacion_id del cierre', () => {
  const storage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), _m: m }; };
  it('UUID creado una vez, conservado en reintentos con la misma petición, nuevo si cambia', () => {
    const st = storage();
    const clave = claveCierreFinanciero(8601, normalizarEntregasCierre(entregasUI));
    const op1 = resolverOperacion(leerOperacionCierre(st, 8601), clave);
    guardarOperacionCierre(st, 8601, op1);
    expect(op1.id).toMatch(UUID_RE);
    // timeout / respuesta perdida / recarga: se relee del storage
    const op2 = resolverOperacion(leerOperacionCierre(st, 8601), clave);
    expect(op2.id).toBe(op1.id);
    const op3 = resolverOperacion(leerOperacionCierre(st, 8601), claveCierreFinanciero(8601, normalizarEntregasCierre([...entregasUI, { express: true, pago: 'Efectivo', items: [{ sku: 'P86-A', cant: 1, precio: 35 }] }])));
    expect(op3.id).not.toBe(op1.id);
    // solo se borra tras el éxito confirmado
    borrarOperacionCierre(st, 8601);
    expect(leerOperacionCierre(st, 8601)).toBeNull();
    expect(resolverOperacion(leerOperacionCierre(st, 8601), clave).id).not.toBe(op1.id);
  });
  it('storage corrupto, ausente o sin espacio no rompe el flujo', () => {
    const st = storage(); st.setItem(claveStorageCierre(8601), '{no json');
    expect(leerOperacionCierre(st, 8601)).toBeNull();
    expect(leerOperacionCierre(null, 8601)).toBeNull();
    expect(() => guardarOperacionCierre({ setItem: () => { throw new Error('quota'); } }, 8601, { id: 'x', clave: 'y' })).not.toThrow();
    expect(() => borrarOperacionCierre(null, 8601)).not.toThrow();
  });
  it('el UUID del cierre es distinto por ruta', () => {
    const st = storage();
    guardarOperacionCierre(st, 1, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clave: 'k' });
    expect(leerOperacionCierre(st, 2)).toBeNull();
  });
});

describe('buildCerrarFinancieroArgs / interpretar / mensajes', () => {
  it('nombres exactos de la RPC; ruta y operación obligatorias', () => {
    const b = buildCerrarFinancieroArgs({ operacionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rutaId: '8601', entregas: normalizarEntregasCierre(entregasUI), usuarioId: 3, usuarioNombre: ' Chofer 86 ' });
    expect(Object.keys(b.args).sort()).toEqual(['p_entregas', 'p_operacion_id', 'p_ruta_id', 'p_usuario_id', 'p_usuario_nombre']);
    expect(b.args.p_ruta_id).toBe(8601);
    expect(b.args.p_usuario_nombre).toBe('Chofer 86');
    expect(buildCerrarFinancieroArgs({ rutaId: 1 }).error).toMatch(/operación/);
    expect(buildCerrarFinancieroArgs({ operacionId: 'x' }).error).toMatch(/Ruta/);
  });
  it('interpretar marca replay y normaliza saltadas', () => {
    expect(interpretarCierreFinanciero({ success: true, replay: true })).toMatchObject({ ok: true, replay: true, saltadas: [] });
    expect(interpretarCierreFinanciero(null)).toMatchObject({ ok: true, replay: false });
  });
  it('mensajes en español para cada rechazo del contrato', () => {
    expect(mensajeErrorCierreFinanciero({ code: '23505', message: 'cerrar_ruta_financiero: operacion_id ya usado con otros datos (ruta R-1)' })).toMatch(/otros datos/);
    expect(mensajeErrorCierreFinanciero({ code: '22023', message: 'cerrar_ruta_financiero: la ruta R-1 ya tiene cierre financiero registrado con otros datos' })).toMatch(/administrador/);
    expect(mensajeErrorCierreFinanciero({ code: '23505', message: 'cerrar_ruta_financiero: operacion_id ya usado en la ruta 5' })).toMatch(/otra ruta/);
    expect(mensajeErrorCierreFinanciero({ code: '42501', message: 'cerrar_ruta_financiero: no autorizado' })).toMatch(/permiso/);
    expect(mensajeErrorCierreFinanciero({ message: 'Ruta 5 ya está Cerrada' })).toMatch(/cerrada/);
    expect(mensajeErrorCierreFinanciero({ message: 'Failed to fetch' })).toMatch(/no se duplicará/);
  });
});

describe('auditoría estática: el store usa el contrato con operacion_id', () => {
  const src = readFileSync(fileURLToPath(new URL('../data/supaStore.js', import.meta.url)), 'utf8');
  const cuerpo = (nombre) => {
    const i = src.indexOf(`      ${nombre}: async`);
    const j = src.indexOf('\n      ', src.indexOf('\n      },', i) + 1);
    return src.slice(i, j);
  };
  it('prepararCierreRuta resuelve el UUID desde el storage y lo persiste; no lo borra', () => {
    const b = cuerpo('prepararCierreRuta');
    expect(b).toMatch(/leerOperacionCierre\(/);
    expect(b).toMatch(/guardarOperacionCierre\(/);
    expect(b).toMatch(/buildCerrarFinancieroArgs\(/);
    expect(b).toMatch(/rpc\('cerrar_ruta_financiero',\s*built\.args\)/);
    expect(b).not.toMatch(/borrarOperacionCierre\(/);
  });
  it('el UUID del cierre financiero se borra solo tras finalizar el inventario (087)', () => {
    const b = cuerpo('finalizarInventarioRuta');
    expect(b.indexOf('borrarOperacionCierre(')).toBeGreaterThan(b.indexOf("rpc('finalizar_inventario_ruta'"));
    expect(src).not.toMatch(/cerrarRutaCompleta: async/);
  });
});
