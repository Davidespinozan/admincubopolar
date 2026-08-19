// swAutoVersion.mjs — bump automático de CACHE_VERSION del service
// worker (Tanda 21).
//
// Contexto: el SW invalida caches comparando CACHE_NAME, y hasta la
// Tanda 19 la versión se bumpeaba A MANO en public/sw.js. Las tandas
// 14-18 lo olvidaron y dejaron assets stale en producción. Este plugin
// elimina el paso manual: en cada build reescribe dist/sw.js con una
// versión única (commit + timestamp), así cada deploy invalida el
// cache anterior sin intervención humana.
//
// public/sw.js queda con CACHE_VERSION = 'dev' (valor de desarrollo);
// si la línea marcador desaparece, el build FALLA a propósito — es
// preferible a publicar un SW que nunca invalida su cache.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MARCADOR = /^const CACHE_VERSION = .*$/m;

/**
 * Normaliza una versión a [a-z0-9-] para poder inyectarla dentro de
 * comillas simples sin riesgo de romper el JS del SW.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeVersion(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

/**
 * Construye la versión de cache: commit corto de Netlify (COMMIT_REF)
 * + timestamp base36. El timestamp garantiza unicidad aunque se
 * redeploye el mismo commit (retry de deploy, clear cache & deploy).
 *
 * @param {{ commitRef?: string, now?: number }} opts
 * @returns {string}
 */
export function buildCacheVersion({ commitRef, now = Date.now() } = {}) {
  const commit = sanitizeVersion(String(commitRef || '').slice(0, 8)) || 'local';
  return `${commit}-${now.toString(36)}`;
}

/**
 * Reemplaza la línea `const CACHE_VERSION = ...;` del código fuente
 * del SW por la versión inyectada. Lanza si el marcador no existe:
 * un SW sin versión inyectada nunca invalidaría su cache en deploys.
 *
 * @param {string} source contenido de sw.js
 * @param {string} version ya sanitizada o sanitizable
 * @returns {string}
 */
export function applyCacheVersion(source, version) {
  if (!MARCADOR.test(source)) {
    throw new Error(
      'sw-auto-version: no se encontró la línea `const CACHE_VERSION = ...` en sw.js. ' +
      'Sin ella el cache nunca se invalida en deploys; restaura el marcador.'
    );
  }
  const v = sanitizeVersion(version);
  if (!v) throw new Error('sw-auto-version: versión vacía tras sanitizar');
  return source.replace(
    MARCADOR,
    `const CACHE_VERSION = '${v}'; // Inyectado por build (scripts/swAutoVersion.mjs) — NO editar a mano`
  );
}

/**
 * Plugin de Vite: tras generar dist/, reescribe dist/sw.js con la
 * versión del build. Va en closeBundle porque Vite copia public/ a
 * dist/ durante writeBundle.
 * @returns {import('vite').Plugin}
 */
export function swAutoVersionPlugin() {
  return {
    name: 'sw-auto-version',
    apply: 'build',
    closeBundle() {
      const swPath = resolve('dist/sw.js');
      if (!existsSync(swPath)) {
        throw new Error('sw-auto-version: dist/sw.js no existe tras el build');
      }
      const version = buildCacheVersion({ commitRef: process.env.COMMIT_REF });
      writeFileSync(swPath, applyCacheVersion(readFileSync(swPath, 'utf8'), version));
      console.info(`[sw-auto-version] CACHE_VERSION = ${version}`);
    },
  };
}
