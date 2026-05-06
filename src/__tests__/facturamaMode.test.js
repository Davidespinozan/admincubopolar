// facturamaMode.test.js — Tanda 14.
// Cubre el helper que decide si la app está en sandbox o producción.
// El helper lee `import.meta.env.VITE_FACTURAMA_MODE`. En tests Vitest
// expone `import.meta.env` mutable, así que podemos forzar valores y
// re-importar con `vi.resetModules()` para validar cada caso.

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  // Limpiamos el valor antes de cada test para no contaminar.
  delete import.meta.env.VITE_FACTURAMA_MODE;
});

describe('facturamaMode', () => {
  it('default sandbox cuando VITE_FACTURAMA_MODE no está definida (fail-safe)', async () => {
    const mod = await import('../lib/facturamaMode');
    expect(mod.FACTURAMA_MODE).toBe('sandbox');
    expect(mod.isSandboxMode()).toBe(true);
    expect(mod.isProductionMode()).toBe(false);
  });

  it('"production" → modo production', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = 'production';
    const mod = await import('../lib/facturamaMode');
    expect(mod.FACTURAMA_MODE).toBe('production');
    expect(mod.isProductionMode()).toBe(true);
    expect(mod.isSandboxMode()).toBe(false);
  });

  it('"sandbox" explícito → modo sandbox', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = 'sandbox';
    const mod = await import('../lib/facturamaMode');
    expect(mod.FACTURAMA_MODE).toBe('sandbox');
    expect(mod.isSandboxMode()).toBe(true);
  });

  it('valor desconocido (typo) → cae a sandbox (fail-safe)', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = 'prodution';
    const mod = await import('../lib/facturamaMode');
    expect(mod.FACTURAMA_MODE).toBe('sandbox');
    expect(mod.isSandboxMode()).toBe(true);
  });

  it('case-insensitive: "PRODUCTION" → production', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = 'PRODUCTION';
    const mod = await import('../lib/facturamaMode');
    expect(mod.isProductionMode()).toBe(true);
  });

  it('whitespace tolerado: "  production  " → production', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = '  production  ';
    const mod = await import('../lib/facturamaMode');
    expect(mod.isProductionMode()).toBe(true);
  });

  it('string vacío → sandbox (fail-safe)', async () => {
    import.meta.env.VITE_FACTURAMA_MODE = '';
    const mod = await import('../lib/facturamaMode');
    expect(mod.isSandboxMode()).toBe(true);
  });
});
