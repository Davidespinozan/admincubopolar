// produccionAtomica.test.js — frontend de los contratos atómicos 076
// (registrar_produccion / registrar_transformacion): parámetros exactos,
// ciclo de vida del operacion_id, errores, resultados y auditoría estática de
// callers (compuerta para 077: ningún flujo de Producción escribe directo).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nuevoOperacionId,
  claveProduccion,
  claveTransformacion,
  resolverOperacion,
  buildRegistrarProduccionArgs,
  buildRegistrarTransformacionArgs,
  interpretarResultadoProduccion,
  interpretarResultadoTransformacion,
  mensajeErrorProduccion,
} from '../data/produccionAtomicaLogic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('operacion_id: ciclo de vida del intento lógico', () => {
  const gen = (() => { let i = 0; return () => `id-${++i}`; })();
  const datos = { turno: 'Turno 1', maquina: 'Máquina 30', sku: 'HPC-5K', cantidad: 10, destino: 'CF-1' };

  it('UUID v4 válido', () => {
    expect(nuevoOperacionId()).toMatch(UUID_RE);
    expect(nuevoOperacionId()).not.toBe(nuevoOperacionId());
  });
  it('primer submit crea un id', () => {
    const op = resolverOperacion(null, claveProduccion(datos), gen);
    expect(op.id).toMatch(/^id-/);
  });
  it('reintento o doble click con los mismos datos reutiliza el mismo id', () => {
    const op1 = resolverOperacion(null, claveProduccion(datos), gen);
    const op2 = resolverOperacion(op1, claveProduccion({ ...datos }), gen);
    const op3 = resolverOperacion(op2, claveProduccion({ ...datos, sku: ' HPC-5K ' }), gen);
    expect(op2).toBe(op1);
    expect(op3.id).toBe(op1.id);
  });
  it('datos distintos (nueva operación) generan id nuevo', () => {
    const op1 = resolverOperacion(null, claveProduccion(datos), gen);
    const op2 = resolverOperacion(op1, claveProduccion({ ...datos, cantidad: 11 }), gen);
    expect(op2.id).not.toBe(op1.id);
  });
  it('tras un éxito (ref en null) la siguiente producción es nueva aunque los datos coincidan', () => {
    const op1 = resolverOperacion(null, claveProduccion(datos), gen);
    const op2 = resolverOperacion(null, claveProduccion(datos), gen);
    expect(op2.id).not.toBe(op1.id);
  });
  it('clave de transformación estable y sensible a los datos de negocio', () => {
    const t = { input_sku: 'BH-50K', input_kg: 10, output_sku: 'HT-T', output_kg: 8, cuarto_destino: 'CF-1' };
    expect(claveTransformacion(t)).toBe(claveTransformacion({ ...t, notas: 'x' }));
    expect(claveTransformacion(t)).not.toBe(claveTransformacion({ ...t, output_kg: 7 }));
  });
});

describe('buildRegistrarProduccionArgs', () => {
  it('nombres exactos de la RPC; sin actor, folio, costo ni empaque', () => {
    const r = buildRegistrarProduccionArgs({ operacionId: 'u-1', turno: ' Turno 1 ', maquina: 'M30', sku: 'HPC-5K', cantidad: '10', destino: 'CF-1' });
    expect(r.args).toEqual({ p_operacion_id: 'u-1', p_turno: 'Turno 1', p_maquina: 'M30', p_sku: 'HPC-5K', p_cantidad: 10, p_cuarto_id: 'CF-1' });
    expect(Object.keys(r.args).some(k => /usuario|folio|costo|empaque|monto/.test(k))).toBe(false);
  });
  it('validaciones mínimas', () => {
    const base = { operacionId: 'u', turno: 'T', maquina: 'M', sku: 'X', cantidad: 1, destino: 'CF-1' };
    expect(buildRegistrarProduccionArgs({ ...base, operacionId: '' }).error).toMatch(/operación/);
    expect(buildRegistrarProduccionArgs({ ...base, cantidad: 0 }).error).toMatch(/mayor a 0/);
    expect(buildRegistrarProduccionArgs({ ...base, cantidad: 1.5 }).error).toMatch(/entero/);
    expect(buildRegistrarProduccionArgs({ ...base, destino: '' }).error).toMatch(/cuarto/);
    expect(buildRegistrarProduccionArgs({ ...base, turno: ' ' }).error).toMatch(/Turno/);
  });
});

describe('buildRegistrarTransformacionArgs', () => {
  const base = { operacionId: 'u', input_sku: 'BH-50K', input_kg: 10, output_sku: 'HT-T', output_kg: 8, cuarto_destino: 'CF-1', notas: ' lote ' };
  it('nombres exactos de la RPC', () => {
    expect(buildRegistrarTransformacionArgs(base).args).toEqual({
      p_operacion_id: 'u', p_input_sku: 'BH-50K', p_input_cantidad: 10, p_output_sku: 'HT-T', p_output_cantidad: 8, p_cuarto_id: 'CF-1', p_notas: 'lote',
    });
  });
  it('validaciones mínimas', () => {
    expect(buildRegistrarTransformacionArgs({ ...base, output_kg: 11 }).error).toMatch(/superar/);
    expect(buildRegistrarTransformacionArgs({ ...base, output_sku: 'BH-50K' }).error).toMatch(/distintos/);
    expect(buildRegistrarTransformacionArgs({ ...base, input_kg: 2.5 }).error).toMatch(/entero/);
    expect(buildRegistrarTransformacionArgs({ ...base, cuarto_destino: '' }).error).toMatch(/cuarto/);
  });
});

describe('resultados del servidor', () => {
  it('producción: usa folio/id/replay del servidor', () => {
    expect(interpretarResultadoProduccion({ id: 9, folio: 'OP-128', sku: 'HPC-5K', cantidad: 10, costo_total: 20, replay: true }))
      .toMatchObject({ ok: true, id: 9, folio: 'OP-128', replay: true, costoTotal: 20 });
    expect(interpretarResultadoProduccion({ id: 1, folio: 'OP-1' }).replay).toBe(false);
  });
  it('transformación', () => {
    expect(interpretarResultadoTransformacion({ id: 3, folio: 'TR-9', input_sku: 'B', input_cantidad: 10, output_sku: 'T', output_cantidad: 8, merma: 2, replay: false }))
      .toMatchObject({ ok: true, folio: 'TR-9', inputCantidad: 10, outputCantidad: 8, merma: 2, replay: false });
  });
});

describe('mensajeErrorProduccion', () => {
  it('traduce los errores de las RPCs 076', () => {
    expect(mensajeErrorProduccion({ message: 'Stock insuficiente de HPC-BOLSA: disponible=3, requerido=10' })).toMatch(/Stock insuficiente de HPC-BOLSA .*No se registró nada/);
    expect(mensajeErrorProduccion({ message: 'registrar_produccion: operacion_id ya usado con otros datos', code: '23505' })).toMatch(/otros datos/);
    expect(mensajeErrorProduccion({ message: 'registrar_produccion: SKU no encontrado: X' })).toMatch(/no existe/);
    expect(mensajeErrorProduccion({ message: 'registrar_produccion: cuarto frío CF-9 no existe' })).toMatch(/cuarto frío/);
    expect(mensajeErrorProduccion({ message: 'registrar_produccion: actor no autorizado', code: '42501' })).toMatch(/permiso/);
    expect(mensajeErrorProduccion({ message: 'TypeError: Failed to fetch' })).toMatch(/no se duplicará/);
    expect(mensajeErrorProduccion(null)).toMatch(/ningún cambio/);
  });
});

// ─── Auditoría estática (frontend) ───────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const store = leer('src/data/supaStore.js');
const STORE_LINES = store.split('\n');
const cuerpo = nombre => {
  const i = store.indexOf(`      ${nombre}: async`);
  if (i < 0) return null;
  const resto = store.slice(i + 10);
  const j = resto.search(/\n {6}[A-Za-z_]+: async/);
  return store.slice(i, i + 10 + (j < 0 ? resto.length : j));
};
function archivosSrc(dir = 'src') {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...archivosSrc(rel)); }
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(rel);
  }
  return out;
}
// Acción del store que contiene la línea i (acciones a 6 espacios).
const accionEn = i => { for (let j = i; j >= 0; j--) { const m = STORE_LINES[j].match(/^ {6}(\w+):\s*async/); if (m) return m[1]; } return '?'; };
const escrituras = tabla => {
  const out = [];
  STORE_LINES.forEach((l, i) => {
    if (!new RegExp(`from\\(\\s*'${tabla}'\\s*\\)`).test(l)) return;
    const win = STORE_LINES.slice(i, i + 4).join(' ');
    const op = (win.match(/\.(insert|update|upsert|delete)\s*\(/) || [])[1];
    if (op) out.push(`${accionEn(i)}:${op}`);
  });
  return [...new Set(out)].sort();
};

describe('frontend 076: una sola RPC por operación', () => {
  it('producirYCongelar: solo registrar_produccion, sin escrituras ni RPCs auxiliares', () => {
    const b = cuerpo('producirYCongelar');
    expect(b).toMatch(/rpc\('registrar_produccion'/);
    expect(b).not.toMatch(/\.from\(/);
    expect(b).not.toMatch(/rpc\('(nextval|update_stocks_atomic|update_productos_stock_atomic|registrar_merma)'/);
    expect(b).not.toMatch(/meterACuartoFrio|_registrarCostoProduccion|addProduccion/);
  });
  it('addTransformacion: solo registrar_transformacion, sin escrituras, rollbacks ni merma separada', () => {
    const b = cuerpo('addTransformacion');
    expect(b).toMatch(/rpc\('registrar_transformacion'/);
    expect(b).not.toMatch(/\.from\(/);
    expect(b).not.toMatch(/rpc\('(nextval|update_stocks_atomic|update_productos_stock_atomic|registrar_merma)'/);
    expect(b).not.toMatch(/Rollback|delete\(/i);
  });
  it('addProduccion y folio_op_seq ya no existen en el frontend', () => {
    expect(cuerpo('addProduccion')).toBeNull();
    const fuentes = archivosSrc().map(leer).join('\n');
    expect(fuentes).not.toMatch(/folio_op_seq/);
    expect(fuentes).not.toMatch(/actions\??\.addProduccion/);
  });
  it('las vistas envían operacion_id, usan guard síncrono y no manejan estados parciales', () => {
    for (const f of ['src/components/ProduccionStandaloneView.jsx', 'src/components/views/ProduccionView.jsx']) {
      const v = leer(f);
      expect(v).toMatch(/resolverOperacion\(/);
      expect(v).toMatch(/operacionId: op\.id/);
      expect(v).toMatch(/enVuelo\w+\.current = true/);
      expect(v).not.toMatch(/\.partial\b/);
    }
  });
});

describe('auditoría de callers (compuerta 077): escrituras directas restantes', () => {
  // 090: resetSistema se retiró de producción; ya no queda ninguna escritura
  // con nombre de tabla dinámico en el store.
  it('ninguna escritura con nombre de tabla dinámico', () => {
    const dinamicas = STORE_LINES.map((l, i) => (/from\(\s*tabla\s*\)/.test(l) ? accionEn(i) : null)).filter(Boolean);
    expect(dinamicas).toEqual([]);
  });
  it('productos: solo acciones de Admin', () => {
    expect(escrituras('productos')).toEqual([
      // 093: ajustarExistenciaManual usa el contrato ajustar_existencia.
      'addProducto:insert', 'deleteDemoProducts:delete',
      'deleteProducto:delete', 'updateProducto:update', 'updateStockMinimo:update',
    ]);
  });
  it('inventario_mov: ninguna escritura directa (102: el kardex lo escriben los contratos)', () => {
    expect(escrituras('inventario_mov')).toEqual([]);
    expect(escrituras('cuartos_frios').filter(x => /ajustar/i.test(x))).toEqual([]);
  });
  it('produccion: solo Admin corrige turno/máquina; sin borrado físico (093); sin helper de costo desde 085', () => {
    expect(escrituras('produccion')).toEqual(['updateProduccion:update']);
  });
});
