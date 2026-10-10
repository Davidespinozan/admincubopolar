// nom1ConceptosNomina.test.jsx — NOM-1 (mig 128): conceptos de nómina.
// Lógica pura (a quién aplica, monto, desglose, argumentos de los contratos),
// paridad con la migración y garantías de pantalla y store: el servidor
// calcula, el cliente no manda totales ni escribe por REST.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CLASES_CONCEPTO, clasesDeTipo, etiquetaClase, asignacionDe, conceptoAplica, montoConcepto, describirMonto, describirAlcance, personasDeConcepto,
  lineasEditables, lineaManualNueva, lineaDeConcepto, conceptosParaAgregar, previewDesglose, buildGuardarReciboArgs,
  formDeConcepto, personasDelForm, personaIncluida, buildGuardarConceptoArgs, avanceTope, recibosConFaltantes, AYUDA_CONCEPTOS,
} from '../data/nominaLogic';
import { NominaView } from '../components/views/NominaView';
import { describirCambio } from '../data/usuariosLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const EMPS = [
  { id: 1, nombre: 'Jorge Luis', puesto: 'Chofer Vendedor', depto: 'Ventas y Distribución', salarioDiario: 100, estatus: 'Activo' },
  { id: 2, nombre: 'Martín', puesto: 'Ayudante de Chofer', depto: 'Ventas y Distribución', salarioDiario: 318.93, estatus: 'Activo' },
  { id: 3, nombre: 'Marcela', puesto: 'Ayudante General', depto: 'Producción', salarioDiario: 200, estatus: 'Activo' },
  { id: 4, nombre: 'Baja', puesto: 'Ayudante', depto: 'Producción', salarioDiario: 200, estatus: 'Inactivo' },
];
const BONO = { id: 10, nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad', calculo: 'fijo', monto: 200, aplicaA: 'todos', activo: true };
const PRIMA = { id: 11, nombre: 'Prima dominical', tipo: 'percepcion', categoria: 'prima_dominical', calculo: 'porcentaje_sd', monto: 25, aplicaA: 'personas', activo: true };
const COMISION = { id: 12, nombre: 'Comisión ruta', tipo: 'percepcion', categoria: 'comisiones', calculo: 'fijo', monto: 150, aplicaA: 'departamento', departamento: 'Ventas y Distribución', activo: true };
const SEGURO = { id: 13, nombre: 'Seguro social', tipo: 'descuento', categoria: 'imss', calculo: 'fijo', monto: 0, aplicaA: 'personas', activo: true };
const PRESTAMO = { id: 14, nombre: 'Préstamo', tipo: 'descuento', categoria: 'prestamo', calculo: 'fijo', monto: 500, aplicaA: 'personas', activo: true };
const CONCEPTOS = [BONO, PRIMA, COMISION, SEGURO, PRESTAMO];
const ASIG = [
  { conceptoId: 11, empleadoId: 1, excluido: false, monto: null, limiteTotal: null },
  { conceptoId: 11, empleadoId: 2, excluido: false, monto: 50, limiteTotal: null },
  { conceptoId: 12, empleadoId: 2, excluido: true, monto: null, limiteTotal: null },
  { conceptoId: 13, empleadoId: 1, excluido: false, monto: 80.55, limiteTotal: null },
  { conceptoId: 14, empleadoId: 1, excluido: false, monto: null, limiteTotal: 1200 },
];

describe('NOM-1: catálogo', () => {
  it('las clases del cliente son exactamente las del CHECK de la migración (y de las casillas del recibo)', () => {
    const sql = src('../../supabase/128_conceptos_nomina.sql');
    const m = /CONSTRAINT nomina_conceptos_categoria CHECK \(\s*\(tipo = 'percepcion' AND categoria IN \(([^)]+)\)\)\s*OR \(tipo = 'descuento' AND categoria IN \(([^)]+)\)\)\)/.exec(sql);
    const lista = (t) => t.split(',').map(x => x.trim().replace(/'/g, '')).sort();
    expect(lista(m[1])).toEqual(clasesDeTipo('percepcion').map(c => c.id).sort());
    expect(lista(m[2])).toEqual(clasesDeTipo('descuento').map(c => c.id).sort());
    expect(CLASES_CONCEPTO).toHaveLength(9);
    expect(etiquetaClase('prestamo')).toBe('Préstamo');
    expect(etiquetaClase('x')).toBe('');
  });

  it('a quién aplica: todos, un área (con excepciones) o personas elegidas', () => {
    const a = (c, e) => conceptoAplica(c, EMPS[e - 1], asignacionDe(ASIG, c.id, e));
    expect([1, 2, 3].map(e => a(BONO, e))).toEqual([true, true, true]);
    expect([1, 2, 3].map(e => a(COMISION, e))).toEqual([true, false, false]);   // 2 está excluido; 3 es de otra área
    expect([1, 2, 3].map(e => a(PRIMA, e))).toEqual([true, true, false]);
    expect([1, 2, 3].map(e => a(PRESTAMO, e))).toEqual([true, false, false]);
    expect(personasDeConcepto(BONO, EMPS, ASIG).map(e => e.id)).toEqual([1, 2, 3]);   // sin las bajas
    expect(conceptoAplica(null, EMPS[0], null)).toBe(false);
  });

  it('monto: fijo, propio por persona y % del salario diario con el redondeo del servidor', () => {
    expect(montoConcepto(BONO, null, 100)).toBe(200);
    expect(montoConcepto(SEGURO, asignacionDe(ASIG, 13, 1), 100)).toBe(80.55);
    expect(montoConcepto(PRIMA, asignacionDe(ASIG, 11, 1), 100)).toBe(25);
    expect(montoConcepto(PRIMA, asignacionDe(ASIG, 11, 2), 318.93)).toBe(159.47);   // 50 % propio; el servidor da 159.47
    expect(montoConcepto(PRIMA, null, 315.04)).toBe(78.76);
    expect(montoConcepto(null, null, 100)).toBe(0);
  });

  it('descripciones para la lista', () => {
    expect(describirMonto(BONO)).toBe('$200 por semana');
    expect(describirMonto(PRIMA)).toBe('25 % del salario diario');
    expect(describirMonto(SEGURO)).toBe('Monto por persona');
    expect(describirAlcance(BONO, ASIG)).toBe('Todos');
    expect(describirAlcance(COMISION, ASIG)).toBe('Ventas y Distribución, menos 1');
    expect(describirAlcance(PRIMA, ASIG)).toBe('2 personas');
    expect(describirAlcance(PRESTAMO, ASIG)).toBe('1 persona');
  });
});

describe('NOM-1: desglose del recibo', () => {
  const RECIBO = { id: 7, empleadoId: 1, salarioDiario: 100, diasPagados: 6, septimoDia: 100 };
  const LINEAS = [
    { id: 5, reciboId: 7, conceptoId: 14, nombre: 'Préstamo', tipo: 'descuento', categoria: 'prestamo', monto: 500, propuesto: 500 },
    { id: 6, reciboId: 7, conceptoId: null, nombre: 'Bono especial', tipo: 'percepcion', categoria: 'otras_percepciones', monto: 150, propuesto: null },
    { id: 3, reciboId: 7, conceptoId: 10, nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad', monto: 200, propuesto: 200 },
    { id: 4, reciboId: 7, conceptoId: 13, nombre: 'Seguro social', tipo: 'descuento', categoria: 'imss', monto: 80.55, propuesto: 80.55 },
    { id: 9, reciboId: 8, conceptoId: 10, nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad', monto: 200, propuesto: 200 },
  ];

  it('renglones del recibo: pagos primero, catálogo antes que lo manual; solo los de ese recibo', () => {
    const ls = lineasEditables(RECIBO, LINEAS);
    expect(ls.map(l => l.nombre)).toEqual(['Bono de puntualidad', 'Bono especial', 'Seguro social', 'Préstamo']);
    expect(ls[0]).toMatchObject({ conceptoId: 10, monto: '200', propuesto: 200, tipo: 'percepcion' });
    expect(ls[1].conceptoId).toBeNull();
    expect(new Set(ls.map(l => l.key)).size).toBe(4);
  });

  it('vista previa: sueldo + séptimo + pagos − descuentos (NOMINA08: 4990.24)', () => {
    const p = previewDesglose(100, { diasPagados: '6', conSeptimo: true }, lineasEditables(RECIBO, LINEAS));
    expect(p).toEqual({ sueldo: 600, septimoDia: 100, extras: 350, totalPercepciones: 1050, deducciones: 580.55, netoAPagar: 469.45, excede: false });
    expect(previewDesglose(318.93, { diasPagados: '6', conSeptimo: true }, [{ tipo: 'percepcion', monto: '2465' }, { tipo: 'percepcion', monto: '79.73' }, { tipo: 'percepcion', monto: '213' }]).netoAPagar).toBe(4990.24);
    expect(previewDesglose(100, { diasPagados: '0', conSeptimo: false }, [{ tipo: 'descuento', monto: '10' }])).toMatchObject({ netoAPagar: -10, excede: true });
  });

  it('agregar: solo conceptos activos del mismo tipo que el recibo aún no tiene', () => {
    const ls = lineasEditables(RECIBO, LINEAS);
    expect(conceptosParaAgregar([...CONCEPTOS, { ...BONO, id: 20, nombre: 'Viejo', activo: false }], ls, 'percepcion').map(c => c.id)).toEqual([11, 12]);
    expect(conceptosParaAgregar(CONCEPTOS, ls, 'descuento')).toEqual([]);
    expect(lineaDeConcepto(PRIMA, asignacionDe(ASIG, 11, 2), 318.93)).toMatchObject({ conceptoId: 11, nombre: 'Prima dominical', categoria: 'prima_dominical', monto: '159.47', propuesto: null });
    expect(lineaManualNueva('descuento')).toMatchObject({ conceptoId: null, tipo: 'descuento', categoria: 'otras_deducciones', monto: '' });
    expect(lineaManualNueva().key).not.toBe(lineaManualNueva().key);
  });

  it('argumentos de guardar_recibo_nomina: desglose completo, sin salario ni totales', () => {
    const ls = lineasEditables(RECIBO, LINEAS).map(l => (l.conceptoId === 10 ? { ...l, monto: '0' } : l));   // el bono no aplicó
    const r = buildGuardarReciboArgs(7, { diasPagados: '5', conSeptimo: false }, [...ls, lineaManualNueva('percepcion')], 100);
    expect(r.args).toEqual({ p_recibo_id: 7, p_dias_pagados: 5, p_con_septimo: false, p_lineas: [
      { concepto_id: 10, monto: 0 },
      { nombre: 'Bono especial', tipo: 'percepcion', categoria: 'otras_percepciones', monto: 150 },
      { concepto_id: 13, monto: 80.55 },
      { concepto_id: 14, monto: 500 },
    ] });
    expect(JSON.stringify(r.args)).not.toMatch(/total|neto|salario|sueldo/);
  });

  it('valida la captura antes de enviarla', () => {
    const c = { diasPagados: '6', conSeptimo: true };
    expect(buildGuardarReciboArgs(0, c, []).error).toBeTruthy();
    expect(buildGuardarReciboArgs(7, { diasPagados: '8' }, []).error).toMatch(/Días/);
    expect(buildGuardarReciboArgs(7, { diasPagados: '2.5' }, []).error).toBeTruthy();
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: 10, nombre: 'Bono', monto: '-1' }]).error).toMatch(/negativos/);
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: 10, nombre: 'Bono', monto: 'abc' }]).error).toMatch(/inválido/);
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: 10, nombre: 'Bono', monto: '1' }, { conceptoId: 10, nombre: 'Bono', monto: '2' }]).error).toMatch(/dos veces/);
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: null, nombre: '', tipo: 'percepcion', categoria: 'comisiones', monto: '50' }]).error).toMatch(/nombre/);
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: null, nombre: 'X', tipo: 'descuento', categoria: 'comisiones', monto: '50' }]).error).toMatch(/inválido/);
    expect(buildGuardarReciboArgs(7, { diasPagados: '0', conSeptimo: false }, [{ conceptoId: 14, nombre: 'Préstamo', tipo: 'descuento', monto: '500' }], 100).error).toMatch(/mayores/);
    // Un manual con nombre y en 0 no viaja; sin salario no se valida el neto (lo hace el servidor).
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: null, nombre: 'X', tipo: 'percepcion', categoria: 'comisiones', monto: '0' }]).args.p_lineas).toEqual([]);
    expect(buildGuardarReciboArgs(7, c, [{ conceptoId: null, nombre: '  Bono   extra ', tipo: 'percepcion', categoria: 'comisiones', monto: '10.005' }]).args.p_lineas)
      .toEqual([{ nombre: 'Bono extra', tipo: 'percepcion', categoria: 'comisiones', monto: 10.01 }]);
  });

  it('avance del préstamo y recibos a los que les falta un concepto', () => {
    const acu = [{ conceptoId: 14, empleadoId: 1, limiteTotal: 1200, pagado: 500, enBorrador: 700, restante: 0 }];
    expect(avanceTope(acu, 14, 1)).toEqual({ limite: 1200, pagado: 500, enBorrador: 700, restante: 0, terminado: false });
    expect(avanceTope([{ concepto_id: 14, empleado_id: 1, limite_total: 1200, pagado: 1200, en_borrador: 0 }], 14, 1).terminado).toBe(true);
    expect(avanceTope(acu, 14, 2)).toBeNull();
    const recibos = [RECIBO, { id: 8, empleadoId: 3, salarioDiario: 200 }];
    // Al recibo 7 le falta la comisión (aplica a su área); el préstamo (con tope) y la prima no cuentan como "faltante" seguro.
    expect(recibosConFaltantes(recibos, LINEAS, CONCEPTOS, ASIG, EMPS)).toBe(1);
    expect(recibosConFaltantes(recibos, LINEAS, [BONO], ASIG, EMPS)).toBe(0);
    expect(recibosConFaltantes(recibos, [], [BONO], ASIG, EMPS)).toBe(2);
    expect(recibosConFaltantes(recibos, [], [{ ...BONO, activo: false }], ASIG, EMPS)).toBe(0);
  });
});

describe('NOM-1: formulario de un concepto', () => {
  it('nuevo: se paga, monto fijo, para todos, activo y sin fechas', () => {
    expect(formDeConcepto(null, ASIG)).toEqual({ nombre: '', tipo: 'percepcion', categoria: 'bono_puntualidad', calculo: 'fijo', monto: '', aplicaA: 'todos', departamento: '',
      baseRol: 'vendedor', skus: [], reglaAsistencia: false, maxRetardos: '0', maxFaltas: '0',
      activo: true, vigenteDesde: '', vigenteHasta: '', notas: '', personas: {} });
  });

  it('bono para todos: no manda personas; quitar a alguien manda su exclusión', () => {
    const f = { ...formDeConcepto(null, []), nombre: '  Bono de   puntualidad ', monto: '200' };
    expect(buildGuardarConceptoArgs(null, f, EMPS).args).toEqual({ p_concepto_id: null, p_datos: { nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad',
      calculo: 'fijo', monto: 200, aplica_a: 'todos', departamento: null, activo: true, vigente_desde: null, vigente_hasta: null, notas: null, personas: [],
      base_rol: null, skus: [], regla_asistencia: false, max_retardos: 0, max_faltas: 0 } });
    const g = { ...f, personas: { 2: { incluida: false, monto: '', limite: '' }, 3: { incluida: true, monto: '300', limite: '' } } };
    expect(buildGuardarConceptoArgs(10, g, EMPS).args.p_datos.personas).toEqual([{ empleado_id: 2, excluido: true }, { empleado_id: 3, monto: 300 }]);
    expect(buildGuardarConceptoArgs(10, g, EMPS).args.p_concepto_id).toBe(10);
  });

  it('por área: solo lista y manda a la gente de esa área', () => {
    const f = { ...formDeConcepto(COMISION, ASIG) };
    expect(personasDelForm(f, EMPS).map(e => e.id)).toEqual([1, 2]);
    expect(personaIncluida(f, 1)).toBe(true);
    expect(personaIncluida(f, 2)).toBe(false);
    expect(buildGuardarConceptoArgs(12, f, EMPS).args.p_datos).toMatchObject({ aplica_a: 'departamento', departamento: 'Ventas y Distribución', personas: [{ empleado_id: 2, excluido: true }] });
    expect(buildGuardarConceptoArgs(12, { ...f, departamento: '' }, EMPS).error).toMatch(/departamento/);
  });

  it('préstamo por persona: monto del concepto y total a descontar', () => {
    const f = formDeConcepto(PRESTAMO, ASIG);
    expect(f.personas).toEqual({ 1: { incluida: true, monto: '', limite: '1200' } });
    expect(personaIncluida(f, 1)).toBe(true);
    expect(personaIncluida(f, 3)).toBe(false);   // en "personas" hay que elegirla
    expect(buildGuardarConceptoArgs(14, f, EMPS).args.p_datos.personas).toEqual([{ empleado_id: 1, limite_total: 1200 }]);
  });

  it('descuento con monto por persona (monto general en 0)', () => {
    const f = formDeConcepto(SEGURO, ASIG);
    expect(buildGuardarConceptoArgs(13, f, EMPS).args.p_datos).toMatchObject({ monto: 0, personas: [{ empleado_id: 1, monto: 80.55 }] });
  });

  it('valida antes de enviar', () => {
    const f = { ...formDeConcepto(null, []), nombre: 'Bono', monto: '200' };
    expect(buildGuardarConceptoArgs(null, { ...f, nombre: ' ' }, EMPS).error).toMatch(/nombre/);
    expect(buildGuardarConceptoArgs(null, { ...f, nombre: 'x'.repeat(61) }, EMPS).error).toMatch(/60/);
    expect(buildGuardarConceptoArgs(null, { ...f, categoria: 'prestamo' }, EMPS).error).toMatch(/clase/);
    expect(buildGuardarConceptoArgs(null, { ...f, monto: '-5' }, EMPS).error).toMatch(/Monto/);
    expect(buildGuardarConceptoArgs(null, { ...f, monto: '' }, EMPS).error).toMatch(/monto/);
    expect(buildGuardarConceptoArgs(null, { ...f, calculo: 'porcentaje_sd', monto: '701' }, EMPS).error).toMatch(/700/);
    expect(buildGuardarConceptoArgs(null, { ...f, aplicaA: 'personas' }, EMPS).error).toMatch(/persona/);
    expect(buildGuardarConceptoArgs(null, { ...f, vigenteDesde: '2026-05-10', vigenteHasta: '2026-05-01' }, EMPS).error).toMatch(/fecha/);
    expect(buildGuardarConceptoArgs(null, { ...f, personas: { 1: { incluida: true, monto: '-1', limite: '' } } }, EMPS).error).toMatch(/Jorge Luis/);
    expect(buildGuardarConceptoArgs(null, { ...f, tipo: 'descuento', categoria: 'prestamo', personas: { 1: { incluida: true, monto: '', limite: '0' } } }, EMPS).error).toMatch(/préstamo/);
    // Desactivar no exige monto ni personas.
    expect(buildGuardarConceptoArgs(10, { ...f, monto: '0', activo: false }, EMPS).args.p_datos.activo).toBe(false);
  });
});

describe('NOM-1: store y pantalla', () => {
  const store = src('../data/supaStore.js');
  const vista = src('../components/views/NominaView.jsx');

  it('el store usa los contratos; nada de escritura REST en el catálogo ni en el desglose', () => {
    for (const rpc of ['guardar_recibo_nomina', 'aplicar_conceptos_nomina', 'guardar_concepto_nomina', 'nomina_acumulados']) expect(store).toMatch(new RegExp(`rpc\\('${rpc}'`));
    expect(store).not.toMatch(/from\('nomina_(conceptos|concepto_empleados|recibo_lineas)'\)\s*\.(insert|update|delete|upsert)\(/);
    expect(store).toMatch(/buildGuardarReciboArgs\(reciboId, campos, lineas, salarioDiario\)/);
    expect(store).toMatch(/buildGuardarConceptoArgs\(conceptoId, form, empleados\)/);
  });

  it('la vista guarda por el contrato nuevo y muestra la vista previa como vista previa', () => {
    expect(vista).toMatch(/onGuardar=\{actions\.guardarReciboNomina\}/);
    expect(vista).toMatch(/onGuardar=\{actions\.guardarConceptoNomina\}/);
    expect(vista).toMatch(/actions\.aplicarConceptosNomina\(p\.id\)/);
    expect(vista).not.toMatch(/editarReciboNomina/);
    expect(vista).toMatch(/Vista previa: falta guardar/);
    // Sistema de diseño: primitivas, sin botones de color a mano.
    expect(vista).not.toMatch(/bg-(blue|green|emerald)-600/);
    expect(vista).toMatch(/SegmentedTabs/);
    expect(AYUDA_CONCEPTOS).toMatch(/no calcula impuestos/);
  });

  it('pantalla inicial: pestañas, borrador con su neto y nóminas pagadas', () => {
    const data = {
      empleados: EMPS, nominaConceptos: CONCEPTOS, nominaConceptoEmpleados: ASIG, nominaReciboLineas: [], nominaAcumulados: [],
      nominaPeriodos: [
        { id: 1, periodo: 'Sáb 03/10/2026 – Vie 09/10/2026', fechaInicio: '2026-10-03', fechaFin: '2026-10-09', fechaPago: '2026-10-09', estatus: 'Borrador', totalNeto: 4516.43, totalPercepciones: 5486.98, totalDeducciones: 970.55 },
        { id: 2, periodo: 'Sáb 26/09/2026 – Vie 02/10/2026', fechaInicio: '2026-09-26', fechaFin: '2026-10-02', fechaPago: '2026-10-02', estatus: 'Pagado', totalNeto: 3000, totalPercepciones: 3000, totalDeducciones: 0 },
      ],
      nominaRecibos: [{ id: 7, periodoId: 1, empleadoId: 1, salarioDiario: 100, diasPagados: 6, septimoDia: 100, netoAPagar: 494.45, deducciones: 580.55 }],
    };
    const html = renderToStaticMarkup(<NominaView data={data} actions={{}} />);
    expect(html).toMatch(/Semanas/);
    expect(html).toMatch(/Conceptos/);
    expect(html).toMatch(/Nómina de esta semana/);
    expect(html).toMatch(/\$4,516\.43/);
    expect(html).toMatch(/descuentos \$970\.55/);
    expect(html).toMatch(/Revisar recibos/);
    expect(html).toMatch(/Pagadas/);
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it('la bitácora del Dueño describe el alta y el cambio de un concepto', () => {
    const alta = describirCambio({ id: 1, tabla: 'nomina_conceptos', registro_id: '14', accion: 'CONTRATO', detalle: 'guardar_concepto_nomina', actor: 'Jessica', antes: null,
      despues: { id: 14, nombre: 'Préstamo', monto: 500, aplica_a: 'personas', activo: true, personas: [{ empleado_id: 2, nombre: 'Martín', excluido: false, monto: null, limite_total: 3000 }] } });
    expect(alta).toMatchObject({ modulo: 'Conceptos de nómina', titulo: 'Jessica creó Préstamo', detalle: null, importante: true });
    expect(alta.cambios).toEqual([{ campo: 'monto', antes: '—', despues: '500' }, { campo: 'a quién aplica', antes: '—', despues: 'personas' }, { campo: 'personas', antes: '—', despues: 'Martín (tope 3000)' }]);
    const cambio = describirCambio({ id: 2, tabla: 'nomina_conceptos', accion: 'CONTRATO', detalle: 'guardar_concepto_nomina', actor: 'Jessica', cambios: ['activo', 'monto'],
      antes: { nombre: 'Bono', monto: 200, activo: true }, despues: { nombre: 'Bono', monto: 300, activo: false } });
    expect(cambio.titulo).toBe('Jessica cambió Bono');
    expect(cambio.cambios).toEqual([{ campo: 'activo', antes: 'sí', despues: 'no' }, { campo: 'monto', antes: '200', despues: '300' }]);
  });
});
