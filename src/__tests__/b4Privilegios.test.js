// b4Privilegios.test.js — 090 (B4): auditoría estática del frontend y regla
// pura de asientos de contrato. El reset del sistema está retirado, ningún JWT
// escribe cuentas_por_cobrar por REST y la contabilidad no ofrece editar ni
// borrar asientos que generó un contrato del servidor.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esAsientoDeContrato } from '../data/asientosContablesLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const store = src('../data/supaStore.js');
const accion = (nombre) => {
  const i = store.indexOf(`      ${nombre}: async`);
  if (i < 0) return null;
  const j = store.indexOf('\n      ', store.indexOf('\n      },', i) + 1);
  return store.slice(i, j);
};

describe('090: reset del sistema retirado', () => {
  it('el store no expone resetSistema ni registrarPago', () => {
    expect(store).not.toMatch(/resetSistema/);
    expect(accion('registrarPago')).toBeNull();
    expect(store).not.toMatch(/rpc\('registrar_pago'/);
  });
  it('Configuración no tiene la zona de peligro ni el modal de reseteo', () => {
    const v = src('../components/views/ConfiguracionView.jsx');
    expect(v).not.toMatch(/resetSistema|RESETEAR|Zona de peligro|ejecutarReset/);
  });
});

describe('090: cuentas por cobrar solo por contrato', () => {
  it('ninguna acción escribe cuentas_por_cobrar por REST', () => {
    expect(store).not.toMatch(/from\('cuentas_por_cobrar'\)\s*\.(insert|update|delete|upsert)\(/);
  });
  it('cancelarOrden anula la CxC con anular_cxc_orden', () => {
    const b = accion('cancelarOrden');
    expect(b).toMatch(/rpc\('anular_cxc_orden', \{ p_orden_id: Number\(ordenId\) \}\)/);
  });
  it('registrarDevolucion ajusta la CxC con ajustar_cxc_devolucion y no toca el saldo aparte', () => {
    const b = accion('registrarDevolucion');
    expect(b).toMatch(/rpc\('ajustar_cxc_devolucion', \{ p_orden_id: Number\(ordenId\), p_monto: total \}\)/);
    expect(b).not.toMatch(/increment_saldo/);
  });
  it('addRuta sigue pidiendo solo folio_r_seq', () => {
    const usos = store.match(/rpc\('nextval', \{ seq_name: '[^']+' \}\)/g) || [];
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).toMatch(/'folio_r_seq'/);
  });
  it('las notificaciones solo actualizan leida', () => {
    const updates = store.match(/from\('notificaciones'\)\s*\.update\(\{[^}]*\}\)/g) || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toMatch(/\.update\(\{\s*leida: true\s*\}\)/);
  });
});

describe('090: asientos de contrato (espejo de b4_asiento_de_contrato)', () => {
  it('prefijos reservados de referencia', () => {
    expect(esAsientoDeContrato({ tipo: 'Egreso', referencia: 'MERMA-12' })).toBe(true);
    expect(esAsientoDeContrato({ tipo: 'Egreso', referencia: 'PROD-7' })).toBe(true);
    expect(esAsientoDeContrato({ tipo: 'Egreso', referencia: 'recepcion_compra/abc' })).toBe(true);
  });
  it('ingresos de venta o cobranza ligados a una orden', () => {
    expect(esAsientoDeContrato({ tipo: 'Ingreso', categoria: 'Ventas', ordenId: 5 })).toBe(true);
    expect(esAsientoDeContrato({ _tipo: 'Ingreso', categoria: 'Cobranza', orden_id: 5 })).toBe(true);
  });
  it('asientos manuales siguen editables', () => {
    expect(esAsientoDeContrato({ tipo: 'Ingreso', categoria: 'Ventas', ordenId: null })).toBe(false);
    expect(esAsientoDeContrato({ tipo: 'Egreso', categoria: 'Devoluciones', ordenId: 5 })).toBe(false);
    expect(esAsientoDeContrato({ tipo: 'Egreso', categoria: 'Proveedores', referencia: 'factura 12' })).toBe(false);
    expect(esAsientoDeContrato({ tipo: 'Egreso', referencia: 'x MERMA-1' })).toBe(false);
    expect(esAsientoDeContrato(null)).toBe(false);
  });
  it('la vista oculta editar y borrar en asientos de contrato', () => {
    const v = src('../components/views/ContabilidadView.jsx');
    expect(v).toMatch(/esAsientoDeContrato\(m\) \?/);
  });
});

describe('090: el mapa de grants cubre exactamente las escrituras directas del frontend', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : walk(p);
    return /\.(js|jsx|ts|tsx)$/.test(d.name) ? [p] : [];
  });
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const escrituras = {};
  for (const f of walk(raiz)) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/from\(\s*['"]([a-z_]+)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)\(/g)) {
      const ops = m[2] === 'upsert' ? ['INSERT', 'UPDATE'] : [m[2].toUpperCase()];
      escrituras[m[1]] = [...new Set([...(escrituras[m[1]] || []), ...ops])].sort();
    }
  }
  const sql = src('../../supabase/090_b4_privilegios_e_historia.sql');
  const mapa = JSON.parse(sql.match(/v_mapa JSONB := '(\{[\s\S]*?\})'::jsonb/)[1]);
  delete mapa.cuentas_por_cobrar; // 091 retira el DML directo restante de CxC
  mapa.produccion = mapa.produccion.filter(op => op !== 'DELETE'); // 094: la producción se revierte, no se borra
  delete mapa.cierres_diarios; // 097: la caja se cierra con cerrar_caja_ruta
  delete mapa.pagos_proveedores; // 099: el pago a proveedor se registra con pagar_cuenta_por_pagar
  delete mapa.nomina_periodos; // 101: la nómina se escribe con sus contratos (100)
  delete mapa.nomina_recibos;
  delete mapa.inventario_mov; // 103: el kardex lo escriben los contratos (102)
  const normal = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]).sort(([a], [b]) => a.localeCompare(b)));

  it('cada tabla y operación escrita por el frontend tiene su grant, y no sobra ninguno', () => {
    expect(normal(escrituras)).toEqual(normal(mapa));
  });
  it('ninguna escritura con nombre de tabla dinámico', () => {
    for (const f of walk(raiz)) expect(readFileSync(f, 'utf8')).not.toMatch(/from\(\s*[a-zA-Z_]+\s*\)\s*\.\s*(insert|update|delete|upsert)\(/);
  });
});
