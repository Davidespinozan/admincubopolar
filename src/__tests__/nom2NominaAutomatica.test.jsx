// nom2NominaAutomatica.test.jsx — NOM-2 (mig 130) y PD-01.1 (mig 131).
// Comisiones calculadas con lo entregado, percepciones condicionadas a la
// asistencia y avisos de asistencia al celular: lógica pura, paridad con las
// migraciones y garantías de pantalla, store y funciones programadas.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FORMAS_CALCULO, BASES_COMISION, esComision, esAutomatico, formasDeTipo, campoDeCalculo, describirRegla, describirMonto, montoConcepto,
  lineasEditables, lineaDeConcepto, formDeConcepto, buildGuardarConceptoArgs, recibosConFaltantes, recibosConAutomaticos, AYUDA_CONCEPTOS,
} from '../data/nominaLogic';
import {
  armarEnviosAvisos, AVISOS_POR_OMISION, AVISOS_CON_MINUTOS, AVISOS_SI_NO, formDeAvisos, buildGuardarAvisosArgs, etiquetaTipoAviso,
} from '../data/avisosAsistenciaLogic';
import { describirCambio } from '../data/usuariosLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sql130 = src('../../supabase/130_nomina_automatica.sql');
const sql131 = src('../../supabase/131_avisos_asistencia.sql');

const EMPS = [
  { id: 1, nombre: 'Jorge Luis', puesto: 'Chofer Vendedor', depto: 'Ventas y Distribución', salarioDiario: 100, estatus: 'Activo' },
  { id: 2, nombre: 'Martín', puesto: 'Ayudante', depto: 'Ventas y Distribución', salarioDiario: 200, estatus: 'Activo' },
];
const COMISION = { id: 20, nombre: 'Comisión de venta', tipo: 'percepcion', categoria: 'comisiones', calculo: 'porcentaje_ventas', monto: 2, baseRol: 'vendedor', skus: null, aplicaA: 'todos', activo: true };
const POR_BOLSA = { id: 21, nombre: 'Por bolsa', tipo: 'percepcion', categoria: 'comisiones', calculo: 'por_unidad', monto: 0.5, baseRol: 'chofer', skus: ['HPC-5K'], aplicaA: 'todos', activo: true };
const POR_ENTREGA = { id: 22, nombre: 'Por entrega', tipo: 'percepcion', categoria: 'comisiones', calculo: 'por_entrega', monto: 5, baseRol: 'ayudante', aplicaA: 'todos', activo: true };
const PUNTUAL = { id: 23, nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad', calculo: 'fijo', monto: 200, reglaAsistencia: true, maxRetardos: 0, maxFaltas: 0, aplicaA: 'todos', activo: true };
const FIJO = { id: 24, nombre: 'Vales', tipo: 'percepcion', categoria: 'otras_percepciones', calculo: 'fijo', monto: 50, aplicaA: 'todos', activo: true };

describe('NOM-2: formas de cálculo', () => {
  it('las formas de cálculo y las bases del cliente son las de la migración', () => {
    const calc = /CONSTRAINT nomina_conceptos_calculo\s+CHECK \(calculo IN \(([^)]+)\)\)/.exec(sql130);
    expect(calc[1].split(',').map(x => x.trim().replace(/'/g, '')).sort()).toEqual(FORMAS_CALCULO.map(f => f.id).sort());
    const base = /base_rol IN \(([^)]+)\) AND tipo = 'percepcion'/.exec(sql130);
    expect(base[1].split(',').map(x => x.trim().replace(/'/g, '')).sort()).toEqual(BASES_COMISION.map(b => b.id).sort());
    expect(sql130).toMatch(/calculo <> 'porcentaje_ventas' OR monto <= 100/);
    expect(sql130).toMatch(/max_retardos BETWEEN 0 AND 7 AND max_faltas BETWEEN 0 AND 7/);
  });

  it('comisión = se calcula con ventas; automático = comisión o condición de asistencia', () => {
    expect(FORMAS_CALCULO.filter(f => esComision(f.id)).map(f => f.id)).toEqual(['porcentaje_ventas', 'por_unidad', 'por_entrega']);
    expect([COMISION, POR_BOLSA, POR_ENTREGA, PUNTUAL, FIJO, null].map(esAutomatico)).toEqual([true, true, true, true, false, false]);
    expect(formasDeTipo('percepcion')).toHaveLength(5);
    expect(formasDeTipo('descuento').map(f => f.id)).toEqual(['fijo', 'porcentaje_sd']);   // un descuento no se calcula con ventas
    expect(campoDeCalculo('por_unidad')).toEqual({ label: 'Pesos por bolsa', ejemplo: '0.50' });
    expect(campoDeCalculo('x').label).toBe('Monto por semana');
  });

  it('el cliente no inventa el importe de una comisión: lo calcula el servidor', () => {
    expect(montoConcepto(COMISION, null, 100)).toBe(0);
    expect(montoConcepto(POR_BOLSA, { monto: 1 }, 100)).toBe(0);
    expect(montoConcepto(PUNTUAL, null, 100)).toBe(200);   // la condición la evalúa el servidor
    expect(lineaDeConcepto(COMISION, null, 100).monto).toBe('0');
  });

  it('describe el concepto en palabras: de qué, cuánto y con qué condición', () => {
    expect(describirMonto(COMISION)).toBe('2 % de sus ventas');
    expect(describirMonto(POR_BOLSA)).toBe('$0.50 por bolsa de sus entregas (HPC-5K)');
    expect(describirMonto(POR_ENTREGA)).toBe('$5 por cada una de sus entregas de ayudante');
    expect(describirMonto(PUNTUAL)).toBe('$200 por semana · solo si no falta ni llega tarde');
    expect(describirMonto({ ...PUNTUAL, maxRetardos: 1, maxFaltas: 2 })).toBe('$200 por semana · permite 1 retardo y 2 faltas');
    expect(describirRegla(FIJO)).toBe('');
    expect(describirMonto(FIJO)).toBe('$50 por semana');   // sin cambio para los conceptos de 128
  });

  it('el renglón trae la explicación del servidor', () => {
    const ls = lineasEditables({ id: 7 }, [
      { id: 1, reciboId: 7, conceptoId: 20, nombre: 'Comisión de venta', tipo: 'percepcion', categoria: 'comisiones', monto: 24.6, propuesto: 24.6, detalle: '4 ventas · $1,230.00 × 2%' },
      { id: 2, reciboId: 7, conceptoId: 23, nombre: 'Bono de puntualidad', tipo: 'percepcion', categoria: 'bono_puntualidad', monto: 0, propuesto: 0, detalle: 'No aplica: 1 retardo y 0 faltas (se permiten 0 y 0)' },
      { id: 3, reciboId: 7, conceptoId: 24, nombre: 'Vales', tipo: 'percepcion', categoria: 'otras_percepciones', monto: 50, propuesto: 50, detalle: null },
    ]);
    expect(ls.map(l => l.detalle)).toEqual(['4 ventas · $1,230.00 × 2%', 'No aplica: 1 retardo y 0 faltas (se permiten 0 y 0)', '']);
  });

  it('formulario: una comisión manda su base y sus productos; un concepto fijo no', () => {
    const f = { ...formDeConcepto(null, []), nombre: 'Comisión', categoria: 'comisiones', calculo: 'por_unidad', monto: '0.5', baseRol: 'chofer', skus: ['HPC-5K', ' HPC-5K ', ''] };
    const d = buildGuardarConceptoArgs(null, f, EMPS).args.p_datos;
    expect(d).toMatchObject({ calculo: 'por_unidad', monto: 0.5, base_rol: 'chofer', skus: ['HPC-5K'], regla_asistencia: false, max_retardos: 0, max_faltas: 0 });
    const fijo = buildGuardarConceptoArgs(null, { ...f, calculo: 'fijo', monto: '10' }, EMPS).args.p_datos;
    expect(fijo).toMatchObject({ calculo: 'fijo', base_rol: null, skus: [] });
    expect(formDeConcepto(POR_BOLSA, [])).toMatchObject({ calculo: 'por_unidad', baseRol: 'chofer', skus: ['HPC-5K'], monto: '0.5' });
  });

  it('formulario: valida antes de enviar (el servidor valida otra vez)', () => {
    const f = { ...formDeConcepto(null, []), nombre: 'C', categoria: 'comisiones', calculo: 'porcentaje_ventas', monto: '2' };
    expect(buildGuardarConceptoArgs(null, { ...f, monto: '101' }, EMPS).error).toMatch(/no puede pasar de 100/);
    expect(buildGuardarConceptoArgs(null, { ...f, baseRol: 'gerente' }, EMPS).error).toMatch(/de quién/);
    expect(buildGuardarConceptoArgs(null, { ...f, tipo: 'descuento', categoria: 'prestamo' }, EMPS).error).toMatch(/no se calcula con ventas/);
    expect(buildGuardarConceptoArgs(null, { ...f, personas: { 1: { incluida: true, monto: '150', limite: '' } } }, EMPS).error).toMatch(/Monto inválido para Jorge Luis/);
    const b = { ...formDeConcepto(null, []), nombre: 'Bono', monto: '200', reglaAsistencia: true, maxRetardos: '1', maxFaltas: '0' };
    expect(buildGuardarConceptoArgs(null, b, EMPS).args.p_datos).toMatchObject({ regla_asistencia: true, max_retardos: 1, max_faltas: 0 });
    expect(buildGuardarConceptoArgs(null, { ...b, maxRetardos: '9' }, EMPS).error).toMatch(/van de 0 a 7/);
    expect(buildGuardarConceptoArgs(null, { ...b, maxFaltas: '1.5' }, EMPS).error).toMatch(/van de 0 a 7/);
    // En un descuento la condición no viaja aunque el formulario la traiga marcada.
    expect(buildGuardarConceptoArgs(null, { ...b, tipo: 'descuento', categoria: 'prestamo' }, EMPS).args.p_datos).toMatchObject({ regla_asistencia: false, max_retardos: 0 });
  });

  it('un automático que falta en un recibo cuenta como faltante; "actualizar" se ofrece si el borrador tiene automáticos', () => {
    const recibos = [{ id: 7, empleadoId: 1, salarioDiario: 100 }, { id: 8, empleadoId: 2, salarioDiario: 200 }];
    const lineas = [{ id: 1, reciboId: 7, conceptoId: 20, monto: 10 }, { id: 2, reciboId: 7, conceptoId: 24, monto: 50 }, { id: 3, reciboId: 8, conceptoId: 24, monto: 50 }];
    expect(recibosConFaltantes(recibos, lineas, [COMISION, FIJO], [], EMPS)).toBe(1);   // al recibo 8 le falta la comisión
    expect(recibosConAutomaticos(recibos, lineas, [COMISION, FIJO])).toBe(1);
    expect(recibosConAutomaticos(recibos, lineas, [FIJO])).toBe(0);
    expect(recibosConAutomaticos([], lineas, [COMISION])).toBe(0);
  });

  it('pantalla y store: recalcular antes de pagar, explicar el número, sin REST', () => {
    const vista = src('../components/views/NominaView.jsx');
    const store = src('../data/supaStore.js');
    expect(vista).toMatch(/Actualizar cálculos/);
    expect(vista).toMatch(/actions\.aplicarConceptosNomina\(p\.id, \{ silencioso: true \}\)/);
    expect(vista).toMatch(/linea\.detalle/);
    expect(vista).toMatch(/Solo si cumple con su asistencia/);
    expect(vista).toMatch(/formasDeTipo\(form\.tipo\)/);
    expect(store).not.toMatch(/from\('nomina_linea_ordenes'\)/);
    expect(AYUDA_CONCEPTOS).toMatch(/tú lo puedes cambiar en el recibo/);
  });

  it('la migración conserva los contratos de 128 que no debe tocar', () => {
    for (const f of ['generar_recibos_nomina', 'guardar_recibo_nomina', 'editar_recibo_nomina', 'pagar_nomina', 'nomina_recalcular_recibo']) {
      expect(sql130).not.toMatch(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${f}\\(`));
    }
    expect(sql130).toMatch(/CONSTRAINT nomina_linea_ordenes_una_vez UNIQUE \(concepto_id, empleado_id, orden_id\)/);
    expect(sql130).toMatch(/REVOKE ALL ON FUNCTION public\.nomina_proponer_recibo\(BIGINT, BOOLEAN\) FROM PUBLIC, anon, authenticated/);
  });

  it('la bitácora del Dueño nombra los campos nuevos', () => {
    const c = describirCambio({ id: 3, tabla: 'nomina_conceptos', accion: 'CONTRATO', detalle: 'guardar_concepto_nomina', actor: 'Jessica', cambios: ['max_faltas', 'regla_asistencia', 'skus'],
      antes: { nombre: 'Bono', regla_asistencia: false, max_faltas: 0, skus: null }, despues: { nombre: 'Bono', regla_asistencia: true, max_faltas: 1, skus: ['HPC-5K'] } });
    expect(c.cambios).toEqual([{ campo: 'faltas permitidas', antes: '0', despues: '1' }, { campo: 'condición de asistencia', antes: 'no', despues: 'sí' }, { campo: 'productos', antes: '—', despues: 'HPC-5K' }]);
  });
});

describe('PD-01.1: avisos de asistencia', () => {
  const resp = {
    activo: true, jefes: [45, 78],
    avisos: [
      { id: 1, tipo: 'entrada_proxima', destino: 'empleado', usuario_id: 71, titulo: 'Tu turno empieza a las 08:00', mensaje: 'Marca tu entrada al llegar.' },
      { id: 2, tipo: 'entrada_tarde', destino: 'empleado', usuario_id: null, titulo: 'No has marcado tu entrada', mensaje: 'x' },
      { id: 3, tipo: 'jefes_sin_marcar', destino: 'jefes', usuario_id: null, titulo: 'Juan no ha marcado entrada', mensaje: 'Su turno empezó a las 08:00.' },
    ],
  };

  it('a la persona: solo a su usuario, con enlace a Mi asistencia; sin usuario no se manda', () => {
    const e = armarEnviosAvisos(resp);
    expect(e[0]).toEqual({ usuarioIds: [71], payload: { title: 'Tu turno empieza a las 08:00', body: 'Marca tu entrada al llegar.', url: '/#/mi-asistencia' } });
    expect(e.filter(x => x.payload.url === '/#/mi-asistencia')).toHaveLength(1);
  });

  it('a los jefes: uno solo va tal cual; varios se juntan en un aviso', () => {
    expect(armarEnviosAvisos(resp)[1]).toEqual({ usuarioIds: [45, 78], payload: { title: 'Juan no ha marcado entrada', body: 'Su turno empezó a las 08:00.', url: '/#/asistencia' } });
    const varios = { jefes: [45], avisos: ['Ana', 'Beto', 'Caro', 'Dani', 'Eva', 'Fer'].map((nombre, i) => ({ id: i, tipo: 'jefes_sin_marcar', destino: 'jefes', titulo: `${nombre} no ha marcado entrada`, mensaje: '' })) };
    const e = armarEnviosAvisos(varios);
    expect(e).toHaveLength(1);
    expect(e[0].payload.title).toBe('Asistencia: 6 avisos');
    expect(e[0].payload.body).toBe('Ana no ha marcado entrada · Beto no ha marcado entrada · Caro no ha marcado entrada · Dani no ha marcado entrada · y 2 más');
  });

  it('sin jefes, sin avisos o respuesta rara: no se manda nada', () => {
    expect(armarEnviosAvisos({ ...resp, jefes: [] })).toHaveLength(1);
    expect(armarEnviosAvisos({ activo: false, avisos: [], jefes: [45] })).toEqual([]);
    expect(armarEnviosAvisos(null)).toEqual([]);
    expect(armarEnviosAvisos({ avisos: 'x' })).toEqual([]);
  });

  it('los valores por omisión y los límites del cliente son los de la migración', () => {
    for (const a of AVISOS_CON_MINUTOS) {
      expect(sql131).toMatch(new RegExp(`${a.campo}\\s+INTEGER DEFAULT ${a.omision} CHECK \\(${a.campo} IS NULL OR ${a.campo} BETWEEN ${a.min} AND ${a.max}\\)`));
      expect(AVISOS_POR_OMISION[a.campo]).toBe(a.omision);
    }
    for (const a of AVISOS_SI_NO) expect(sql131).toMatch(new RegExp(`${a.campo}\\s+BOOLEAN NOT NULL DEFAULT true`));
    expect(sql131).toMatch(/jefes\s+TEXT NOT NULL DEFAULT 'admins' CHECK \(jefes IN \('admins', 'dueno'\)\)/);
  });

  it('formulario: apagado = null; minutos fuera de rango se rechazan antes de enviar', () => {
    const f = formDeAvisos({ activo: true, empleado_antes_min: null, empleado_tarde: true, empleado_salida_min: 5, jefes_sin_marcar_min: 15, jefes_retardo: false, jefes_sin_salida_min: 60, jefes: 'dueno' });
    expect(f.empleado_antes_min).toEqual({ encendido: false, minutos: '10' });   // apagado: recuerda el valor sugerido
    expect(f.jefes).toBe('dueno');
    expect(buildGuardarAvisosArgs(f).datos).toEqual({ activo: true, jefes: 'dueno', empleado_antes_min: null, empleado_salida_min: 5, jefes_sin_marcar_min: 15, jefes_sin_salida_min: 60, empleado_tarde: true, jefes_retardo: false });
    expect(buildGuardarAvisosArgs({ ...f, empleado_antes_min: { encendido: true, minutos: '3' } }).error).toMatch(/entre 5 y 60/);
    expect(buildGuardarAvisosArgs({ ...f, empleado_salida_min: { encendido: true, minutos: '' } }).error).toMatch(/entre 0 y 120/);
    expect(buildGuardarAvisosArgs({ ...f, jefes_sin_salida_min: { encendido: true, minutos: '12.5' } }).error).toMatch(/entre 10 y 240/);
    expect(formDeAvisos(null)).toMatchObject({ activo: true, jefes: 'admins', empleado_antes_min: { encendido: true, minutos: '10' }, empleado_tarde: true });
    expect(etiquetaTipoAviso('jefes_retardo')).toBe('A jefes: retardo');
    expect(etiquetaTipoAviso('x')).toBe('Aviso');
  });

  it('el envío: a la persona solo sus dispositivos; las notificaciones del negocio solo a quien ve la campana', () => {
    const cron = src('../../netlify/functions/cron-avisos-asistencia/index.js');
    const cronPush = src('../../netlify/functions/cron-push/index.js');
    const lib = src('../../netlify/functions/_lib/push.js');
    const toml = src('../../netlify.toml');
    expect(cron).toMatch(/rpc\('asistencia_generar_avisos'\)/);
    expect(cron).toMatch(/enviarPush\(supabase, envio\.payload, \{ usuarioIds: envio\.usuarioIds \}\)/);
    expect(cron).not.toMatch(/from\('asistencias'\)|\.insert\(|\.update\(/);   // avisar no registra asistencia
    expect(cronPush).toMatch(/usuariosDeCampana\(supabase\)/);
    expect(cronPush).not.toMatch(/enviarPushATodas/);
    expect(lib).toMatch(/\.in\('usuario_id', usuarioIds\)/);
    expect(lib).toMatch(/usuarioIds\.length === 0\) return \{ enviadas: 0/);   // lista vacía = a nadie, nunca a todos
    expect(toml).toMatch(/\[functions\."cron-avisos-asistencia"\]\s+schedule = "\*\/5 \* \* \* \*"/);
    expect(sql131).toMatch(/GRANT EXECUTE ON FUNCTION public\.asistencia_generar_avisos\(TIMESTAMPTZ\) TO service_role;/);
    expect(sql131).toMatch(/REVOKE ALL ON FUNCTION public\.asistencia_generar_avisos\(TIMESTAMPTZ\) FROM PUBLIC, anon, authenticated;/);
  });

  it('pantallas: Admin configura en Asistencia → Avisos; cada quien activa los avisos en Mi asistencia', () => {
    const admin = src('../components/views/AsistenciaView.jsx');
    const mia = src('../components/MiAsistenciaView.jsx');
    const store = src('../data/supaStore.js');
    expect(admin).toMatch(/\{ k: 'avisos', l: 'Avisos' \}/);
    expect(admin).toMatch(/actions\.guardarAvisosAsistencia\(form\)/);
    expect(mia).toMatch(/<AvisosPush \/>/);
    expect(store).toMatch(/rpc\('avisos_asistencia'\)/);
    expect(store).toMatch(/rpc\('guardar_avisos_asistencia', \{ p_datos: built\.datos \}\)/);
    expect(store).not.toMatch(/from\('asistencia_avisos(_config)?'\)/);
  });
});
