// b3Integridad.test.js — 088: auditoría estática del frontend. La venta normal
// se crea con crear_orden (sin INSERT directo), el almacén de bolsas usa los
// contratos acotados con el rol canónico, y el precio especial se busca por ID
// de cliente (nunca por nombre).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const store = src('../data/supaStore.js');
const accion = (nombre) => {
  const i = store.indexOf(`      ${nombre}: async`);
  if (i < 0) return null;
  const j = store.indexOf('\n      ', store.indexOf('\n      },', i) + 1);
  return store.slice(i, j);
};

describe('088: creación de órdenes', () => {
  it('addOrden usa crear_orden y no inserta en ordenes/orden_lineas', () => {
    const b = accion('addOrden');
    expect(b).toMatch(/rpc\('crear_orden'/);
    expect(b).not.toMatch(/from\('ordenes'\)\.insert|from\('orden_lineas'\)\.insert/);
    expect(b).not.toMatch(/precio|total:/);
    expect(b).toMatch(/requireRol\(\['Admin', 'Ventas'\]\)/);
  });
  it('ninguna acción del store inserta órdenes o líneas directamente', () => {
    expect(store).not.toMatch(/from\('ordenes'\)\.insert\(/);
    expect(store).not.toMatch(/from\('orden_lineas'\)\.insert\(/);
  });
});

describe('088: almacén de bolsas', () => {
  it('movimientoBolsa usa los contratos acotados y el rol canónico', () => {
    const b = accion('movimientoBolsa');
    expect(b).toMatch(/requireRol\(\['Admin', 'Almacén Bolsas'\]\)/);
    expect(b).toMatch(/rpc\('registrar_recepcion_compra'/);
    expect(b).toMatch(/rpc\('registrar_salida_empaque'/);
    expect(b).not.toMatch(/update_productos_stock_atomic|from\('movimientos_contables'\)|from\('cuentas_por_pagar'\)/);
    expect(store).not.toMatch(/requireRol\(\[[^\]]*'Bolsas'/);
  });
  it('la pantalla conserva un operacion_id por movimiento y exige el total de la compra', () => {
    const v = src('../components/BolsasView.jsx');
    expect(v).toMatch(/resolverOperacion\(opRef\.current, clave\)/);
    expect(v).toMatch(/\{ operacionId: op\.id \}/);
    expect(v).toMatch(/modal === "entrada" && !\(n\(form\.costo\) > 0\)/);
  });
});

describe('088: precio especial por ID de cliente', () => {
  it('ChoferView busca el precio por clienteId y muestra IVA 0%', () => {
    const c = src('../components/ChoferView.jsx');
    expect(c).toMatch(/const getPrice = useCallback\(\(clienteId, sku\)/);
    expect(c).not.toMatch(/s\(cli\.nombre\) === clienteNombre/);
    expect(c).not.toMatch(/IVA 16%/);
  });
});
