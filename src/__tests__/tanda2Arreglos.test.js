// tanda2Arreglos.test.js — correcciones de la revisión profunda del 2026-10-10 (tanda 2):
// cancelar una venta asignada, accesos adicionales, clientes para vendedores, cobro rechazado,
// "Hecho hoy", exportación de Movimientos, tablero de producción, link de pago viejo,
// renglones repetidos, método de pago en el cierre de ruta y lectura por páginas.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unirLineasPorSku } from '../data/ordenLogic';
import { metodoDeCierre, normalizarEntregasCierre } from '../data/cierreFinancieroLogic';
import { mensajeErrorVentaDirecta } from '../data/ventaDirectaLogic';
import { estadoDelLink, createHandler as crearPagar } from '../../netlify/functions/billing-pay/index.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const store = src('../data/supaStore.js');

describe('Ventas', () => {
  it('cancelar una venta Asignada la cancela de verdad (quitarla de la ruta era solo el primer paso)', () => {
    expect(store).toMatch(/rpc\('cancelar_orden_asignada', \{ p_orden_id: id, p_usuario_id: uid\(\) \}\)\);\s*if \(!error\) \(\{ error \} = await supabase\.from\('ordenes'\)\.update\(\{ estatus: nuevoEst \}\)\.eq\('id', id\)\.eq\('estatus', 'Creada'\)\);/);
    expect(src('../components/views/OrdenesView.jsx')).not.toMatch(/El stock se regresará al cuarto frío/);
  });

  it('renglones del mismo producto se juntan antes de enviar (el servidor rechaza el SKU repetido)', () => {
    expect(unirLineasPorSku([{ sku: 'HIP-25K', qty: 2, precio: 60 }, { sku: 'HPC-5K', qty: 10 }, { sku: ' HIP-25K ', qty: '1', precio: 99 }, { sku: '', qty: 5 }, { sku: 'X', qty: 0 }]))
      .toEqual([{ sku: 'HIP-25K', qty: 3, precio: 60 }, { sku: 'HPC-5K', qty: 10 }]);
    expect(unirLineasPorSku(null)).toEqual([]);
    expect(src('../components/NuevaVentaModal.jsx')).toMatch(/unirLineasPorSku\(lines\)\.map\(l => `\$\{l\.qty\}×\$\{l\.sku\}`\)/);
    expect(src('../components/EditarVentaModal.jsx')).toMatch(/lines: unirLineasPorSku\(/);
  });

  it('referencia de pago repetida: mensaje claro y el campo pide la referencia completa', () => {
    expect(mensajeErrorVentaDirecta('completar_venta_directa: el pago no se aplicó (referencia_existente)')).toMatch(/ya se usó en otro cobro/);
    expect(mensajeErrorVentaDirecta('completar_venta_directa: el pago no se aplicó (ya_pagada)')).toMatch(/ya tiene su pago registrado/);
    for (const f of ['../components/VentasStandaloneView.jsx', '../components/views/OrdenesView.jsx', '../components/ChoferView.jsx']) expect(src(f)).not.toMatch(/[Úú]ltimos 6 dígitos/);
  });
});

describe('Permisos', () => {
  it('el acceso adicional (p. ej. Almacén Bolsas + Ventas) vale en las acciones, como en el servidor', () => {
    expect(store).toMatch(/export function useSupaStore\(userId, userName, userRol, userAccesos\)/);
    expect(store).toMatch(/if \(Array\.isArray\(rolesPermitidos\) && userAccesosRef\.current\.some\(a => rolesPermitidos\.includes\(a\)\)\) return null;/);
    expect(src('../App.jsx')).toMatch(/user\?\.rol, user\?\.accesos_extra\)/);
  });
  it('un vendedor ve todos los clientes para poder venderles; sus órdenes y pagos siguen siendo los suyos', () => {
    const app = src('../App.jsx');
    expect(app).not.toMatch(/clientes: clientesPropios/);
    expect(app).toMatch(/ordenes: ordenesPropias,\s*pagos: pagosPropios,/);
  });
});

describe('Cobros y finanzas', () => {
  it('"Cobro registrado" solo si el servidor lo aceptó', () => {
    const v = src('../components/views/CobrosView.jsx');
    expect(v.indexOf('if (r?.error || r instanceof Error) return;')).toBeGreaterThan(-1);
    expect(v.indexOf('if (r?.error || r instanceof Error) return;')).toBeLessThan(v.indexOf("toast?.success('Cobro registrado')"));
  });
  it('la exportación de Movimientos recibe los datos en la forma que espera', () => {
    const v = src('../components/views/ContabilidadView.jsx');
    expect(v).toMatch(/contabilidad: todos\.map\(m => \(\{ \.\.\.m, tipo: m\._tipo \}\)\),/);
    expect(v).toMatch(/reporteFinanciero\(datosExport, 'excel'\)/);
    expect(v).not.toMatch(/reporteFinanciero\(cont, /);
  });
  it('link de pago: solo sirve si la venta sigue cobrable y por el mismo importe', () => {
    const intent = { checkout_url: 'https://pago/x', amount: 310 };
    expect(estadoDelLink({ orden: { estatus: 'Creada', total: 310 }, pagado: 0, intent })).toBe('vigente');
    expect(estadoDelLink({ orden: { estatus: 'Creada', total: 620 }, pagado: 0, intent })).toBe('importe_cambio');   // la venta se editó
    expect(estadoDelLink({ orden: { estatus: 'Cancelada', total: 310 }, pagado: 0, intent })).toBe('cancelada');
    expect(estadoDelLink({ orden: { estatus: 'Entregada', total: 310 }, pagado: 310, intent })).toBe('pagada');
    expect(estadoDelLink({ orden: { estatus: 'Creada', total: 310 }, pagado: 0, intent: null })).toBe('sin_link');
    expect(estadoDelLink({ orden: null, pagado: 0, intent })).toBe('sin_link');
  });
  it('/pagar/:id redirige solo el link vigente; el viejo muestra un aviso y no cobra', async () => {
    const fake = (orden, intent, pagos = []) => ({ from: (t) => { const q = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: t === 'ordenes' ? orden : intent }), then: (ok) => Promise.resolve({ data: pagos }).then(ok) }; return q; } });
    const ir = (orden, intent, pagos) => crearPagar({ getSupabase: () => fake(orden, intent, pagos) })({ path: '/pagar/9', queryStringParameters: {} });
    const vigente = await ir({ id: 9, estatus: 'Creada', total: 310 }, { checkout_url: 'https://pago/x', amount: 310 });
    expect([vigente.statusCode, vigente.headers.Location]).toEqual([302, 'https://pago/x']);
    const viejo = await ir({ id: 9, estatus: 'Creada', total: 620 }, { checkout_url: 'https://pago/x', amount: 310 });
    expect(viejo.statusCode).toBe(410);
    expect(viejo.body).toMatch(/El importe de tu compra cambió/);
    expect(viejo.headers.Location).toBeUndefined();
    expect((await ir({ id: 9, estatus: 'Entregada', total: 310 }, { checkout_url: 'https://pago/x', amount: 310 }, [{ monto: 310 }])).body).toMatch(/ya está pagada/);
    expect((await crearPagar({ getSupabase: () => fake(null, null) })({ path: '/pagar/abc', queryStringParameters: {} })).statusCode).toBe(400);
  });
});

describe('Rutas y producción', () => {
  it('el cierre del chofer traduce el método con que Administración cobró', () => {
    expect(['Transferencia SPEI', 'Tarjeta (terminal)', 'Crédito (fiado)', 'Efectivo', ' transferencia spei ', '', null].map(metodoDeCierre))
      .toEqual(['Transferencia', 'Tarjeta', 'Crédito', 'Efectivo', 'Transferencia', null, null]);
    expect(normalizarEntregasCierre([{ ordenId: 5, pago: 'Transferencia SPEI', items: [] }])[0].pago).toBe('Transferencia');
  });
  it('"Qué necesitas producir" solo resta lo que aún no sale del cuarto; "Hecho hoy" usa el día de negocio', () => {
    for (const f of ['../components/ProduccionStandaloneView.jsx', '../components/views/DashboardView.jsx']) {
      expect(src(f)).toMatch(/return est === 'programada' \|\| est === 'pendiente firma';/);
      expect(src(f)).not.toMatch(/est === 'programada' \|\| est === 'en progreso' \|\| est === 'en_progreso';\s*\}\);\s*for \(const ruta of rutasActivas\)/);
    }
    expect(src('../components/views/DashboardView.jsx')).toMatch(/if \(!String\(pr\.fecha \|\| ''\)\.startsWith\(diaNegocio\(\)\)\) continue;/);
  });
});

describe('Carga de datos', () => {
  it('clientes, sucursales y líneas de venta se leen por páginas (la API corta en 1,000 filas)', () => {
    expect(store).toMatch(/const filasPaginadas = async \(crear, \{ pagina = 1000, maxPaginas = 10/);
    expect(store).toMatch(/filasPaginadas\(\(\) => supabase\.from\('orden_lineas'\)\.select\('\*'\)\.order\('orden_id', \{ ascending: false \}\)/);
    expect(store).toMatch(/filasPaginadas\(\(\) => supabase\.from\('clientes'\)/);
    expect(store).not.toMatch(/safeRows\(supabase\.from\('orden_lineas'\)\.select\('\*'\)\.order\('orden_id'\)\)/);
  });
});
