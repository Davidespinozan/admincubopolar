// swAutoVersion.test.js — bump automático de CACHE_VERSION (Tanda 21).
// Protege contra el incidente de assets stale de las Tandas 14-18.
import { describe, it, expect } from 'vitest';
import {
  applyCacheVersion,
  buildCacheVersion,
  sanitizeVersion,
} from '../../scripts/swAutoVersion.mjs';

const SW_SOURCE = `const CACHE_VERSION = 'dev'; // NO bumpear a mano
const CACHE_NAME = \`cubopolar-v\${CACHE_VERSION}\`;
self.addEventListener('install', () => {});`;

describe('sanitizeVersion', () => {
  it('deja solo [a-z0-9-] en minúsculas', () => {
    expect(sanitizeVersion('ABC-123')).toBe('abc-123');
    expect(sanitizeVersion("x'); alert(1); ('")).toBe('xalert1');
  });

  it('recorta a 40 caracteres', () => {
    expect(sanitizeVersion('a'.repeat(60))).toHaveLength(40);
  });

  it('vacío/null → string vacío', () => {
    expect(sanitizeVersion(null)).toBe('');
    expect(sanitizeVersion('')).toBe('');
  });
});

describe('buildCacheVersion', () => {
  it('combina commit corto (8 chars) + timestamp base36', () => {
    const v = buildCacheVersion({ commitRef: 'ec5ff4f9abcdef00', now: 1000000 });
    expect(v).toBe(`ec5ff4f9-${(1000000).toString(36)}`);
  });

  it('sin COMMIT_REF (build local) usa "local"', () => {
    expect(buildCacheVersion({ now: 1 })).toBe('local-1');
  });

  it('dos builds del mismo commit generan versiones distintas', () => {
    const a = buildCacheVersion({ commitRef: 'abc', now: 100 });
    const b = buildCacheVersion({ commitRef: 'abc', now: 200 });
    expect(a).not.toBe(b);
  });
});

describe('applyCacheVersion', () => {
  it('reemplaza la línea CACHE_VERSION y conserva el resto del SW', () => {
    const out = applyCacheVersion(SW_SOURCE, 'abc-123');
    expect(out).toContain("const CACHE_VERSION = 'abc-123';");
    expect(out).not.toContain("'dev'");
    expect(out).toContain('CACHE_NAME');
    expect(out).toContain("addEventListener('install'");
  });

  it('sanitiza la versión antes de inyectarla (sin inyección de código)', () => {
    const out = applyCacheVersion(SW_SOURCE, "x'; fetch('evil')//");
    expect(out).toContain("const CACHE_VERSION = 'xfetchevil';");
    expect(out).not.toContain('evil)');
  });

  it('FALLA si el marcador no existe — mejor romper el build que publicar un SW que nunca invalida', () => {
    expect(() => applyCacheVersion('const OTRA_COSA = 1;', 'v1')).toThrow(/CACHE_VERSION/);
  });

  it('falla con versión vacía tras sanitizar', () => {
    expect(() => applyCacheVersion(SW_SOURCE, '¡¡¡')).toThrow(/vacía/);
  });
});
