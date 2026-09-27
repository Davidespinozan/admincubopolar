// mermasContrato.test.js — Fase B / B1 (mig 072): la merma es un evento
// server-authoritative e inmutable. Cubre los helpers puros del contrato y
// una revisión estática de que ningún caller del cliente conserva una ruta
// directa de INSERT/UPDATE/DELETE sobre `mermas` ni borra fotos del bucket.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MERMA_ESTATUS,
  esMermaActiva,
  mermasActivas,
  puedeRevertirMerma,
  buildRegistrarMermaArgs,
  buildMermasRutaPayload,
  buildMermaTransformacionArgs,
  mensajeErrorMerma,
} from '../data/mermasLogic';

describe('esMermaActiva / mermasActivas', () => {
  it('Activa y filas sin estatus (caché previa a 072) cuentan como vigentes', () => {
    expect(esMermaActiva({ id: 1, estatus: 'Activa' })).toBe(true);
    expect(esMermaActiva({ id: 1 })).toBe(true);
  });
  it('Revertida no cuenta', () => {
    expect(esMermaActiva({ id: 1, estatus: MERMA_ESTATUS.REVERTIDA })).toBe(false);
  });
  it('entradas inválidas no cuentan', () => {
    expect(esMermaActiva(null)).toBe(false);
    expect(esMermaActiva('x')).toBe(false);
  });
  it('mermasActivas filtra revertidas y tolera null', () => {
    const l = [{ id: 1, estatus: 'Activa' }, { id: 2, estatus: 'Revertida' }, { id: 3 }];
    expect(mermasActivas(l).map(m => m.id)).toEqual([1, 3]);
    expect(mermasActivas(null)).toEqual([]);
  });
});

describe('puedeRevertirMerma', () => {
  it('merma activa con id → sí', () => {
    expect(puedeRevertirMerma({ id: 5, estatus: 'Activa' })).toEqual({ ok: true });
  });
  it('revertida → no (el servidor la rechazaría)', () => {
    expect(puedeRevertirMerma({ id: 5, estatus: 'Revertida' }).ok).toBe(false);
  });
  it('sin id → no', () => {
    expect(puedeRevertirMerma({}).ok).toBe(false);
    expect(puedeRevertirMerma(null).ok).toBe(false);
  });
});

describe('buildRegistrarMermaArgs', () => {
  it('arma solo los parámetros del contrato (sin usuario, delta ni monto)', () => {
    const r = buildRegistrarMermaArgs({ sku: ' HPC-5K ', cantidad: '3', causa: 'Bolsa rota', origen: 'Planta', foto: 'uid/2026-09-27/1-HPC-5K.jpg' });
    expect(r.args).toEqual({ p_sku: 'HPC-5K', p_cantidad: 3, p_causa: 'Bolsa rota', p_origen: 'Planta', p_foto: 'uid/2026-09-27/1-HPC-5K.jpg' });
    expect(Object.keys(r.args).some(k => /usuario|delta|monto|mov/i.test(k))).toBe(false);
  });
  it('foto/causa/origen vacíos → null', () => {
    const r = buildRegistrarMermaArgs({ sku: 'X', cantidad: 1 });
    expect(r.args).toMatchObject({ p_causa: null, p_origen: null, p_foto: null });
  });
  it('rechaza cantidad ≤ 0, no numérica o fraccionaria', () => {
    expect(buildRegistrarMermaArgs({ sku: 'X', cantidad: 0 }).error).toMatch(/mayor a 0/);
    expect(buildRegistrarMermaArgs({ sku: 'X', cantidad: -2 }).error).toMatch(/mayor a 0/);
    expect(buildRegistrarMermaArgs({ sku: 'X', cantidad: 'abc' }).error).toMatch(/mayor a 0/);
    expect(buildRegistrarMermaArgs({ sku: 'X', cantidad: 1.5 }).error).toMatch(/entero/);
  });
  it('rechaza SKU vacío', () => {
    expect(buildRegistrarMermaArgs({ sku: '  ', cantidad: 1 }).error).toMatch(/producto/i);
  });
});

describe('buildMermasRutaPayload', () => {
  it('normaliza las mermas locales del chofer y descarta campos locales', () => {
    const r = buildMermasRutaPayload([
      { id: 171, sku: 'HPC-5K', cant: '2', causa: 'Bolsa rota', foto: 'data:image/jpeg;base64,AA', hora: '10:00' },
      { sku: 'HIT-25K', cant: 1 },
    ]);
    expect(r).toEqual([
      { sku: 'HPC-5K', cant: 2, causa: 'Bolsa rota', foto: 'data:image/jpeg;base64,AA' },
      { sku: 'HIT-25K', cant: 1, causa: null, foto: null },
    ]);
  });
  it('tolera null y basura', () => {
    expect(buildMermasRutaPayload(null)).toEqual([]);
    expect(buildMermasRutaPayload([null, 'x'])).toEqual([]);
  });
});

describe('buildMermaTransformacionArgs', () => {
  it('merma de proceso: sin efecto de stock y con folio de transformación', () => {
    const r = buildMermaTransformacionArgs({ input_sku: 'HT-BARRA', mermaKg: 3.6, folio: 'TR-007' });
    expect(r.args).toEqual({
      p_sku: 'HT-BARRA', p_cantidad: 4, p_causa: 'Merma de proceso — transformación',
      p_origen: 'Transformación TR-007', p_foto: null, p_ruta_id: null, p_afecta_stock: false,
    });
  });
  it('merma que redondea a 0 no se registra', () => {
    expect(buildMermaTransformacionArgs({ input_sku: 'X', mermaKg: 0.4, folio: 'TR-1' })).toEqual({ skip: true });
    expect(buildMermaTransformacionArgs({ input_sku: 'X', mermaKg: 0, folio: 'TR-1' })).toEqual({ skip: true });
  });
});

describe('mensajeErrorMerma', () => {
  it('traduce los errores del contrato', () => {
    expect(mensajeErrorMerma({ message: 'revertir_merma: la merma 6 es legacy (sin efectos registrados); no se revierte automáticamente' })).toMatch(/manualmente/);
    expect(mensajeErrorMerma({ message: 'revertir_merma: la merma 3 ya fue revertida' })).toMatch(/ya estaba revertida/);
    expect(mensajeErrorMerma({ message: 'Stock insuficiente para registrar merma de 9×HPC-5K: disponible=3' })).toBe('Stock insuficiente para registrar merma de 9×HPC-5K: disponible=3');
    expect(mensajeErrorMerma({ message: 'registrar_merma: la foto no pertenece al actor' })).toMatch(/foto/i);
    expect(mensajeErrorMerma({ message: 'registrar_merma: actor no autorizado', code: '42501' })).toMatch(/permiso/);
    expect(mensajeErrorMerma({ message: 'registrar_merma: la ruta no pertenece al chofer' })).toMatch(/ruta/);
  });
  it('mensaje desconocido pasa tal cual; vacío → genérico', () => {
    expect(mensajeErrorMerma({ message: 'otra cosa' })).toBe('otra cosa');
    expect(mensajeErrorMerma(null)).toMatch(/mermas/);
  });
});

// ─── Migración de callers: revisión estática del código fuente ───────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function archivosSrc(dir = 'src') {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...archivosSrc(rel)); }
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('callers de mermas (072)', () => {
  const fuentes = archivosSrc().map(f => ({ f, src: leer(f) }));

  it('ningún archivo del cliente escribe directo en la tabla mermas', () => {
    const directos = fuentes.filter(({ src }) =>
      /from\(\s*['"]mermas(_efectos)?['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/.test(src.replace(/\s+/g, ' ')));
    expect(directos.map(x => x.f)).toEqual([]);
  });

  it('el store usa los RPC del contrato', () => {
    const store = leer('src/data/supaStore.js');
    expect(store).toMatch(/rpc\('registrar_merma'/);
    expect(store).toMatch(/rpc\('registrar_mermas_ruta'/);
    expect(store).toMatch(/rpc\('revertir_merma'/);
    expect(store).not.toMatch(/borrarMermaConReverso|deleteMerma/);
  });

  it('el store ya no borra fotos del bucket ni busca egresos por texto', () => {
    const store = leer('src/data/supaStore.js');
    expect(store).not.toMatch(/storage\s*\.from\(\s*'mermas'\s*\)\s*\.remove/);
    expect(store).not.toMatch(/ilike\(\s*'concepto'/);
  });

  it('solo ProduccionStandaloneView borra fotos: su propia subida huérfana', () => {
    const conRemove = fuentes.filter(({ src }) => /storage\s*\.from\(\s*'mermas'\s*\)\s*\.remove/.test(src)).map(x => x.f);
    expect(conRemove).toEqual([path.join('src', 'components', 'ProduccionStandaloneView.jsx')]);
  });

  it('MermasView revierte (no borra) vía revertirMerma', () => {
    const v = leer('src/components/views/MermasView.jsx');
    expect(v).toMatch(/actions\.revertirMerma/);
    expect(v).not.toMatch(/borrarMermaConReverso/);
  });

  it('el reset del sistema no borra mermas (historia inmutable)', () => {
    const store = leer('src/data/supaStore.js');
    const bloque = store.slice(store.indexOf('resetSistema:'), store.indexOf('resetSistema:') + 1500);
    expect(bloque).not.toMatch(/^\s*'mermas',/m);
  });
});
