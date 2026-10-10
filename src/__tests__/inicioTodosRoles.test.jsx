// inicioTodosRoles.test.jsx — "Resumen" y "Mi bandeja" para todos los roles
// (2026-10-09). La bandeja de cada persona = lo de su rol y accesos + lo
// personal (asistencia y actividades asignadas); urgentes primero.
import { describe, it, expect } from 'vitest';
import { construirBandejaUsuario, tareasPersonales, tareasVentas, tareasProduccion, tareasAlmacen, construirBandeja } from '../data/bandejaLogic';
import { cifrasResumen, accesosDeTrabajo } from '../data/resumenRolLogic';
import { navParaRol, navParaUsuario } from '../data/navRolLogic';

const HOY = '2026-10-09';
const ids = (t) => t.map(x => x.id);

describe('lo personal (todos los roles)', () => {
  it('entrada por marcar → urgente; en turno → no es pendiente; olvido → cuando puedas', () => {
    expect(tareasPersonales({ asistencia: { clave: 'entrada', titulo: 'Marca tu entrada', detalle: 'x' } })[0]).toMatchObject({ id: 'mi-asistencia-entrada', prioridad: 'alta', modulo: 'mi-asistencia' });
    expect(tareasPersonales({ asistencia: { clave: 'salida', titulo: 'Estás en turno', detalle: 'x' } })).toEqual([]);
    expect(tareasPersonales({ asistencia: { clave: 'olvido', titulo: 'Te faltó marcar', detalle: 'x' } })[0].prioridad).toBe('media');
  });
  it('actividades asignadas: vencidas urgentes, pendientes después; las próximas no cuentan', () => {
    const t = tareasPersonales({ actividades: [{ estado: 'vencida', titulo: 'Lavar camión' }, { estado: 'pendiente', titulo: 'Revisar filtros' }, { estado: 'proxima', titulo: 'Pago' }] });
    expect(t.map(x => [x.id, x.prioridad, x.count])).toEqual([['mis-actividades-vencidas', 'alta', 1], ['mis-actividades-pendientes', 'media', 1]]);
    expect(t[0].detalle).toMatch(/Lavar camión/);
    expect(t.every(x => x.modulo === 'mis-actividades')).toBe(true);
    expect(tareasPersonales(null)).toEqual([]);
  });
});

describe('por rol', () => {
  it('Ventas: sus ventas creadas; las de días anteriores son urgentes', () => {
    const d = { ordenes: [{ estatus: 'Creada', fecha: '2026-10-08' }, { estatus: 'Creada', fecha: HOY }, { estatus: 'Creada', fecha: HOY }, { estatus: 'Entregada', fecha: HOY }] };
    expect(tareasVentas(d, HOY).map(x => [x.id, x.prioridad, x.count, x.modulo])).toEqual([['ventas-atrasadas', 'alta', 1, 'ventas'], ['ventas-por-cobrar', 'media', 2, 'ventas']]);
    expect(tareasVentas({ ordenes: [] }, HOY)).toEqual([]);
  });
  it('Producción: firmas de carga urgentes y lo que falta producir', () => {
    const d = { rutas: [{ estatus: 'Pendiente firma' }, { estatus: 'En progreso' }], alertas: [{ id: 'prod-min-HPC-5K' }, { id: 'cxc-1' }] };
    expect(tareasProduccion(d).map(x => [x.id, x.prioridad, x.modulo])).toEqual([['firmas', 'alta', 'prod-producir'], ['por-producir', 'media', 'prod-producir']]);
  });
  it('Almacén: bolsas sin existencia (urgente) y bajo mínimo', () => {
    const d = { productos: [{ tipo: 'Empaque', nombre: 'Bolsa 5 kg', stock: 0 }, { tipo: 'Empaque', nombre: 'Bolsa 25 kg', stock: 50, stock_minimo: 100 }, { tipo: 'Empaque', nombre: 'Sin logo', stock: 500, stock_minimo: 100 }, { tipo: 'Producto Terminado', stock: 0 }] };
    const t = tareasAlmacen(d);
    expect(t.map(x => [x.id, x.prioridad, x.count])).toEqual([['bolsas-sin-existencia', 'alta', 1], ['bolsas-bajas', 'media', 1]]);
    expect(t[0].detalle).toMatch(/Sin bolsas no se puede producir/);
  });
});

describe('construirBandejaUsuario', () => {
  const data = {
    ordenes: [{ estatus: 'Creada', fecha: HOY }],
    rutas: [{ estatus: 'Pendiente firma' }],
    productos: [{ tipo: 'Empaque', nombre: 'Bolsa 5 kg', stock: 0 }],
    alertas: [],
  };
  const personales = { asistencia: { clave: 'entrada', titulo: 'Marca tu entrada', detalle: 'x' }, actividades: [{ estado: 'pendiente', titulo: 'A' }] };
  it('cada rol ve lo suyo + lo personal, urgentes primero', () => {
    expect(ids(construirBandejaUsuario({ rol: 'Ventas' }, data, HOY, personales))).toEqual(['mi-asistencia-entrada', 'ventas-por-cobrar', 'mis-actividades-pendientes']);
    expect(ids(construirBandejaUsuario({ rol: 'Producción' }, data, HOY, personales))).toEqual(['firmas', 'mi-asistencia-entrada', 'mis-actividades-pendientes']);
    expect(ids(construirBandejaUsuario({ rol: 'Empleado' }, data, HOY, personales))).toEqual(['mi-asistencia-entrada', 'mis-actividades-pendientes']);
    expect(construirBandejaUsuario({ rol: 'Ventas' }, data, HOY, personales).map(x => x.prioridad)).toEqual(['alta', 'media', 'media']);
  });
  it('acceso adicional: María (Almacén + Ventas) ve los dos', () => {
    expect(ids(construirBandejaUsuario({ rol: 'Almacén Bolsas', accesos_extra: ['Ventas'] }, data, HOY, null))).toEqual(['bolsas-sin-existencia', 'ventas-por-cobrar']);
    expect(ids(construirBandejaUsuario({ rol: 'Almacén Bolsas' }, data, HOY, null))).toEqual(['bolsas-sin-existencia']);
  });
  it('back office: la bandeja de negocio de siempre + su asistencia (sin duplicar actividades)', () => {
    const negocio = ids(construirBandeja(data, HOY));
    const admin = ids(construirBandejaUsuario({ rol: 'Admin' }, data, HOY, personales));
    expect(admin.filter(x => x !== 'mi-asistencia-entrada').sort()).toEqual([...negocio].sort());
    expect(admin).toContain('mi-asistencia-entrada');
    expect(admin).not.toContain('mis-actividades-pendientes');
    expect(ids(construirBandejaUsuario({ rol: 'Admin' }, data, HOY)).sort()).toEqual([...negocio].sort());
  });
  it('sin datos ni usuario no truena', () => {
    expect(construirBandejaUsuario(null, null, HOY)).toEqual([]);
    expect(construirBandejaUsuario({ rol: 'Chofer' }, {}, HOY, {})).toEqual([]);
  });
});

describe('Resumen por rol', () => {
  const data = {
    ordenes: [{ id: 1, estatus: 'Entregada', fecha: HOY, total: 500 }, { id: 2, estatus: 'Creada', fecha: HOY, total: 300 }],
    pagos: [], produccion: [{ fecha: HOY, cantidad: 400, estatus: 'Confirmada' }, { fecha: HOY, cantidad: 50, estatus: 'Revertida' }],
    cuartosFrios: [{ id: 'CF-1', stock: { 'HPC-5K': 120 } }], mermas: [],
    productos: [{ tipo: 'Empaque', nombre: 'Bolsa 5 kg', stock: 0 }, { tipo: 'Empaque', nombre: 'Bolsa 25 kg', stock: 800 }],
  };
  it('Ventas: vendido hoy y por cobrar', () => {
    const c = cifrasResumen(['Ventas'], data, HOY);
    expect(c.map(x => x.label)).toEqual(['Vendido hoy', 'Por cobrar o entregar']);
    expect(c[0].value).toBe('$500');
    expect(c[1]).toMatchObject({ value: '1', tone: 'warning', modulo: 'ventas' });
  });
  it('Producción: producido hoy (sin lo revertido), congeladores y merma', () => {
    const c = cifrasResumen(['Producción'], data, HOY);
    expect(c.map(x => [x.label, x.value])).toEqual([['Producido hoy', '400'], ['En congeladores', '120'], ['Merma hoy', '0']]);
  });
  it('Almacén: una cifra por tipo de bolsa; sin existencia en rojo', () => {
    const c = cifrasResumen(['Almacén Bolsas'], data, HOY);
    expect(c.map(x => [x.label, x.value, x.tone])).toEqual([['Bolsa 5 kg', '0', 'danger'], ['Bolsa 25 kg', '800', undefined]]);
  });
  it('accesos adicionales suman cifras; Empleado no tiene cifras de negocio', () => {
    expect(cifrasResumen(['Almacén Bolsas', 'Ventas'], data, HOY)).toHaveLength(4);
    expect(cifrasResumen(['Empleado'], data, HOY)).toEqual([]);
    expect(cifrasResumen(['Ventas'], null, HOY)).toHaveLength(2);
  });
  it('"Ir a": los módulos de trabajo del menú, sin Inicio ni lo personal', () => {
    expect(accesosDeTrabajo(navParaRol('Producción')).map(m => m.id)).toEqual(['prod-producir', 'prod-cuartos', 'prod-mermas', 'prod-preparar']);
    expect(accesosDeTrabajo(navParaUsuario({ rol: 'Almacén Bolsas', accesos_extra: ['Ventas'] })).map(m => m.id)).toEqual(['bolsas-almacen', 'ventas']);
    expect(accesosDeTrabajo(navParaRol('Empleado'))).toEqual([]);
  });
});
