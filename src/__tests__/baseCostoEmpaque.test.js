// baseCostoEmpaque.test.js — 107/108: integridad de la base de costo del
// empaque. El servidor es la autoridad (suite SQL 107); aquí se prueba la guía
// de captura (el empaque solo baja por ajuste, nace sin existencia ni costo),
// los mensajes y que el frontend usa esa lógica.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  esEmpaque, validarAjusteExistencia, camposAltaProducto, mensajeErrorEmpaque, REGLA_ENTRADA_EMPAQUE,
} from '../data/empaqueLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('validarAjusteExistencia (UX)', () => {
  const emp = { tipo: 'Empaque', existenciaActual: 100, motivo: 'conteo físico' };
  it('empaque: baja y sin diferencia permitidas; hasta 0', () => {
    expect(validarAjusteExistencia({ ...emp, nuevaExistencia: '80' })).toEqual({});
    expect(validarAjusteExistencia({ ...emp, nuevaExistencia: 100 })).toEqual({});
    expect(validarAjusteExistencia({ ...emp, nuevaExistencia: '0' })).toEqual({});
  });
  it('empaque: el alza no se envía y explica la regla', () => {
    const e = validarAjusteExistencia({ ...emp, nuevaExistencia: '101' });
    expect(e.existencia).toMatch(/solo se ajusta a la baja/);
    expect(e.existencia).toMatch(/recepción de compra/);
    expect(validarAjusteExistencia({ tipo: 'Empaque', existenciaActual: 0, nuevaExistencia: 1, motivo: 'x' }).existencia).toMatch(/a la baja/);
  });
  it('negativos, decimales y vacío: inválidos para cualquier tipo', () => {
    for (const v of ['-1', '1.5', '', '  ', 'abc', null, undefined]) {
      expect(validarAjusteExistencia({ ...emp, nuevaExistencia: v }).existencia).toMatch(/entero de 0 o mayor/);
      expect(validarAjusteExistencia({ tipo: 'Producto Terminado', existenciaActual: 5, nuevaExistencia: v, motivo: 'x' }).existencia).toMatch(/entero de 0 o mayor/);
    }
  });
  it('producto terminado: el ajuste al alza sigue permitido', () => {
    expect(validarAjusteExistencia({ tipo: 'Producto Terminado', existenciaActual: 5, nuevaExistencia: '9', motivo: 'conteo' })).toEqual({});
  });
  it('motivo obligatorio', () => {
    expect(validarAjusteExistencia({ ...emp, nuevaExistencia: '80', motivo: '  ' })).toEqual({ motivo: 'Motivo requerido' });
    expect(validarAjusteExistencia()).toEqual({ existencia: 'Debe ser un entero de 0 o mayor', motivo: 'Motivo requerido' });
  });
});

describe('alta de producto', () => {
  it('el empaque nace sin existencia ni costo, aunque el formulario traiga valores', () => {
    expect(camposAltaProducto({ tipo: 'Empaque', stock: 500, costoUnitario: 3 })).toEqual({ stock: 0, costo_unitario: 0 });
    expect(camposAltaProducto({ tipo: 'Empaque', stock: -5 })).toEqual({ stock: 0, costo_unitario: 0 });
  });
  it('el producto terminado conserva su existencia inicial y no tiene costo', () => {
    expect(camposAltaProducto({ tipo: 'Producto Terminado', stock: '12' })).toEqual({ stock: 12, costo_unitario: 0 });
    expect(camposAltaProducto({ tipo: 'Producto Terminado', stock: '' })).toEqual({ stock: 0, costo_unitario: 0 });
    expect(camposAltaProducto()).toEqual({ stock: 0, costo_unitario: 0 });
  });
  it('esEmpaque', () => {
    expect(esEmpaque({ tipo: 'Empaque' })).toBe(true);
    expect(esEmpaque({ tipo: 'Producto Terminado' })).toBe(false);
    expect(esEmpaque(null)).toBe(false);
  });
});

describe('mensajeErrorEmpaque', () => {
  it('traduce los rechazos del servidor (107/108)', () => {
    expect(mensajeErrorEmpaque({ message: 'ajustar_existencia: el empaque EMP-5 no se aumenta con un ajuste manual (existencia actual: 10); las entradas…' })).toBe(`El empaque solo se ajusta a la baja. ${REGLA_ENTRADA_EMPAQUE}`);
    expect(mensajeErrorEmpaque({ message: 'productos: un empaque nuevo nace sin existencia; las entradas…' })).toMatch(/sin existencia/);
    expect(mensajeErrorEmpaque({ message: 'productos: un empaque nuevo nace sin costo; el costo lo fija…' })).toMatch(/primera recepción de compra/);
    expect(mensajeErrorEmpaque({ message: 'productos: el empaque EMP-5 tiene existencia; no se elimina' })).toMatch(/tiene existencia; no se puede eliminar/);
    expect(mensajeErrorEmpaque({ message: 'productos: el empaque EMP-5 está en uso o tiene historia (compras, producciones o movimientos); no se elimina' })).toMatch(/en uso o tiene compras/);
    expect(mensajeErrorEmpaque({ message: 'new row for relation "productos" violates check constraint "productos_empaque_stock_no_negativo"' })).toMatch(/no puede ser negativa/);
  });
  it('otros errores: el texto por defecto o el del servidor', () => {
    expect(mensajeErrorEmpaque({ message: 'otra cosa' }, 'Error al crear producto')).toBe('Error al crear producto');
    expect(mensajeErrorEmpaque({ message: 'otra cosa' })).toBe('otra cosa');
    expect(mensajeErrorEmpaque('texto plano')).toBe('texto plano');
    expect(mensajeErrorEmpaque(null, 'x')).toBe('x');
  });
});

describe('107/108: el frontend usa la lógica y los contratos', () => {
  const store = src('../data/supaStore.js');
  it('alta: existencia y costo salen de camposAltaProducto; errores traducidos', () => {
    const add = store.slice(store.indexOf('addProducto: async'), store.indexOf('updateProducto: async'));
    expect(add).toMatch(/camposAltaProducto\(\{ tipo: p\.tipo, stock: p\.stock \}\)/);
    expect(add).toMatch(/stock: alta\.stock/);
    expect(add).toMatch(/mensajeErrorEmpaque\(error, 'Error al crear producto'\)/);
    expect(store).toMatch(/mensajeErrorEmpaque\(error, 'Error al eliminar producto'\)/);
  });
  it('ajuste manual: sigue por el contrato del servidor y muestra el rechazo traducido', () => {
    const aj = store.slice(store.indexOf('ajustarExistenciaManual: async'), store.indexOf('// ── RUTAS ──'));
    expect(aj).toMatch(/supabase\.rpc\('ajustar_existencia'/);
    expect(aj).toMatch(/mensajeErrorEmpaque\(error, error\.message/);
    expect(aj).not.toMatch(/from\('productos'\)/);
  });
  it('Inventario: el modal valida con la lógica y explica la regla del empaque', () => {
    const v = src('../components/views/InventarioView.jsx');
    expect(v).toMatch(/validarAjusteExistencia\(\{/);
    expect(v).toMatch(/esEmpaque\(ajusteModal\) && \(/);
    expect(v).toMatch(/REGLA_ENTRADA_EMPAQUE/);
    expect(v).toMatch(/max=\{esEmpaque\(ajusteModal\) \? n\(ajusteModal\?\.stock\) : undefined\}/);
  });
  it('Productos: un empaque nuevo no captura existencia ni costo', () => {
    const v = src('../components/views/ProductosView.jsx');
    expect(v).toMatch(/camposAltaProducto\(\{ tipo: form\.tipo, stock: form\.stock \}\)/);
    expect(v).toMatch(/Un empaque nuevo se da de alta sin existencia/);
    expect(v).not.toMatch(/Costo de apertura/);
  });
});

describe('107/108: migraciones (forma)', () => {
  const m107 = src('../../supabase/107_base_costo_empaque_reverso.sql');
  const m108 = src('../../supabase/108_contencion_base_costo_empaque.sql');
  // Sentencias fuera de los cuerpos de función y de los comentarios.
  const sinCuerpos = (sql) => sql.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/--[^\n]*/g, '');
  it('107: reingreso al costo histórico, evento de historial y orden de bloqueo empaque → cuarto', () => {
    expect(m107).toMatch(/round\(\(v_old_qty \* v_old_avg \+ v_emp \* v_hist\) \/ \(v_old_qty \+ v_emp\), 6\)/);
    expect(m107).toMatch(/v_hist\s+:= COALESCE\(v_p\.costo_empaque, 0\)/);
    expect(m107).toMatch(/'Reverso producción', p_operacion_id/);
    expect(m107.indexOf('FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE')).toBeLessThan(m107.indexOf('PERFORM stock_mov_cuarto'));
    // Resultados (093/094): el costo compensatorio sigue siendo el costo_total guardado.
    expect(m107).toMatch(/v_costo := COALESCE\(v_p\.costo_total, 0\)/);
    // Sin reparación histórica: fuera del cuerpo de la función no hay escrituras de datos.
    expect(sinCuerpos(m107)).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO)\b/);
  });
  it('108: contención sin tocar datos', () => {
    expect(m108).toMatch(/CHECK \(tipo <> 'Empaque' OR stock >= 0\)/);
    expect(m108).toMatch(/v_prod\.tipo = 'Empaque' AND p_nueva_existencia > v_prod\.stock/);
    expect(m108).toMatch(/BEFORE DELETE ON productos/);
    expect(m108).toMatch(/un empaque nuevo nace sin existencia/);
    expect(sinCuerpos(m108)).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO)\b/);
  });
});
