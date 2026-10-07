// pd02Calendario.test.jsx — PD-02 (mig 118): calendario operativo.
// Lógica pura (etiquetas, recurrencia, rangos, resumen, argumentos) y garantías
// de las pantallas: el estado lo da el servidor, crear/editar es de Admin, "Mis
// actividades" no expone el calendario completo, sin notificaciones.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  estadoActividad, textoClasificacion, textoRecurrencia, textoResponsable, fechaCorta, sumarDiasISO, rangoDeMes, mesSiguiente,
  celdasDeMes, rangoVista, filtrarVista, resumenActividades, buildActividadDatos, buildCompletarArgs, buildEditarOcurrenciaArgs,
  mensajeCompletar, formDesdeOcurrencia, claveOcurrencia,
} from '../data/calendarioLogic';
import { construirBandeja, contarUrgentes } from '../data/bandejaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const OP = '11111111-2222-4333-8444-555555555555';
const dias = (a, b) => (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000;

describe('PD-02: estado semántico → interfaz (el color no es estado de la base)', () => {
  it('próxima neutral, pendiente amarillo, vencida rojo, completada verde', () => {
    expect(estadoActividad('proxima')).toEqual({ label: 'Próxima', tono: 'neutro' });
    expect(estadoActividad('pendiente')).toEqual({ label: 'Pendiente', tono: 'amarillo' });
    expect(estadoActividad('vencida')).toEqual({ label: 'Vencida', tono: 'rojo' });
    expect(estadoActividad('completada')).toEqual({ label: 'Completada', tono: 'verde' });
  });
  it('clasificación de la terminación: anticipada / a tiempo / tarde', () => {
    expect(textoClasificacion('anticipada')).toMatch(/antes/);
    expect(textoClasificacion('en_ventana')).toMatch(/a tiempo/);
    expect(textoClasificacion('tardia')).toMatch(/tarde/);
  });
  it('mensaje al completar: tarde = aviso; ya completada = quién', () => {
    expect(mensajeCompletar({ ok: true, ocurrencia: { clasificacion: 'tardia' } }).tono).toBe('aviso');
    expect(mensajeCompletar({ ok: true, ocurrencia: { clasificacion: 'en_ventana' } }).tono).toBe('ok');
    expect(mensajeCompletar({ ok: false, codigo: 'ya_completada', ocurrencia: { completada_por: 'Ana' } }).texto).toMatch(/Ana/);
  });
});

describe('PD-02: recurrencia y fechas (sin depender de la zona del navegador)', () => {
  it('texto de recurrencia, incluido el cruce al periodo siguiente', () => {
    expect(textoRecurrencia({ recurrencia: 'mensual', dia_inicio: 1, dia_fin: 5 })).toBe('Cada mes: día 1 → 5');
    expect(textoRecurrencia({ recurrencia: 'mensual', dia_inicio: 28, dia_fin: 3 })).toBe('Cada mes: día 28 → 3 del mes siguiente');
    expect(textoRecurrencia({ recurrencia: 'semanal', dia_semana_inicio: 5, dia_semana_fin: 1 })).toBe('Cada semana: vie → lun (semana siguiente)');
    expect(textoRecurrencia({ recurrencia: 'anual', mes: 2, dia_inicio: 29, dia_fin: 29 })).toBe('Cada año: 29 feb → 29 feb');
    expect(textoRecurrencia({ recurrencia: 'anual', mes: 12, dia_inicio: 28, dia_fin: 3 })).toBe('Cada año: 28 dic → 3 ene');
    expect(textoRecurrencia({ recurrencia: 'unica', fecha_inicio: '2026-10-28', fecha_fin: '2026-11-03' })).toBe('Una vez: 28 oct → 3 nov');
  });
  it('mes: rango, año bisiesto, celdas lunes-primero y navegación', () => {
    expect(rangoDeMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(rangoDeMes('2027-02')).toEqual({ desde: '2027-02-01', hasta: '2027-02-28' });
    const c = celdasDeMes('2026-10');                 // 1 oct 2026 es jueves → 3 huecos
    expect(c.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(c.filter(Boolean)).toHaveLength(31);
    expect(mesSiguiente('2026-12')).toBe('2027-01');
    expect(mesSiguiente('2026-01', -1)).toBe('2025-12');
    expect(sumarDiasISO('2026-10-28', 6)).toBe('2026-11-03');
    expect(fechaCorta('2026-11-03')).toBe('3 nov');
  });
  it('rangos de cada vista dentro del máximo del servidor (1,100 días)', () => {
    for (const v of ['mes', 'proximas', 'vencidas', 'completadas', 'resumen']) {
      const r = rangoVista(v, '2026-10-07', '2026-10');
      expect(dias(r.desde, r.hasta), v).toBeLessThanOrEqual(1100);
      expect(r.hasta >= r.desde).toBe(true);
    }
    expect(rangoVista('vencidas', '2026-10-07').hasta).toBe('2026-10-07');
  });
});

describe('PD-02: vistas y resumen a partir del estado del servidor', () => {
  const H = '2026-10-07';
  const L = [
    { actividad_id: 1, periodo: '2026-10-01', estado: 'pendiente', ventana_inicio: '2026-10-05', ventana_fin: '2026-10-09' },
    { actividad_id: 2, periodo: '2026-10-01', estado: 'proxima', ventana_inicio: '2026-10-09', ventana_fin: '2026-10-10' },
    { actividad_id: 3, periodo: '2026-09-01', estado: 'vencida', ventana_inicio: '2026-09-01', ventana_fin: '2026-09-05' },
    { actividad_id: 4, periodo: '2026-10-01', estado: 'completada', ventana_inicio: '2026-10-01', ventana_fin: '2026-10-03', completada_at: '2026-10-02T15:00:00Z' },
    { actividad_id: 5, periodo: '2026-10-01', estado: 'proxima', ventana_inicio: '2026-10-20', ventana_fin: '2026-10-25' },
  ];
  it('filtros: próximas (próxima + pendiente), vencidas, completadas', () => {
    expect(filtrarVista(L, 'proximas').map(o => o.actividad_id)).toEqual([1, 2, 5]);
    expect(filtrarVista(L, 'vencidas').map(o => o.actividad_id)).toEqual([3]);
    expect(filtrarVista(L, 'completadas').map(o => o.actividad_id)).toEqual([4]);
  });
  it('resumen del Dashboard: pendientes hoy, por vencer (≤ 3 días) y vencidas; las completadas no cuentan', () => {
    expect(resumenActividades(L, H)).toEqual({ pendientesHoy: 1, porVencer: 2, vencidas: 1 });
    expect(resumenActividades([], H)).toEqual({ pendientesHoy: 0, porVencer: 0, vencidas: 0 });
  });
  it('Bandeja: un detector de actividades vencidas (prioridad alta → al Calendario)', () => {
    const t = construirBandeja({ actividadesAbiertas: L }, H).find(x => x.id === 'actividades-vencidas');
    expect(t).toMatchObject({ prioridad: 'alta', modulo: 'calendario', count: 1, titulo: '1 actividad vencida' });
    expect(construirBandeja({ actividadesAbiertas: L.filter(o => o.estado !== 'vencida') }, H).some(x => x.id === 'actividades-vencidas')).toBe(false);
    expect(contarUrgentes(construirBandeja({ actividadesAbiertas: L }, H))).toBe(1);
  });
  it('clave de ocurrencia = actividad + periodo', () => {
    expect(claveOcurrencia(L[0])).toBe('1|2026-10-01');
  });
});

describe('PD-02: argumentos (la base vuelve a validar)', () => {
  const base = { titulo: ' Mantenimiento Máquina 30 ', categoria: 'mantenimiento', recurrencia: 'mensual', dia_inicio: '1', dia_fin: '5',
    responsable_tipo: 'usuario', responsable_usuario_id: '7', relacionado_tipo: 'maquina', relacionado_ref: 'Máquina 30', visibilidad: 'asignado' };
  it('mensual 1 → 5 con máquina y responsable', () => {
    expect(buildActividadDatos(base).datos).toEqual({
      titulo: 'Mantenimiento Máquina 30', descripcion: '', categoria: 'mantenimiento', recurrencia: 'mensual', visibilidad: 'asignado',
      asignado_puede_completar: true, responsable_usuario_id: 7, relacionado_tipo: 'maquina', relacionado_ref: 'Máquina 30', dia_inicio: 1, dia_fin: 5,
    });
  });
  it('validaciones: título, categoría, días, fechas, responsable y relacionado', () => {
    expect(buildActividadDatos({ ...base, titulo: ' ' }).error).toMatch(/Título/);
    expect(buildActividadDatos({ ...base, categoria: 'x' }).error).toMatch(/Categoría/);
    expect(buildActividadDatos({ ...base, dia_fin: '32' }).error).toMatch(/1–31/);
    expect(buildActividadDatos({ ...base, responsable_usuario_id: '' }).error).toMatch(/usuario/);
    expect(buildActividadDatos({ ...base, relacionado_ref: '' }).error).toMatch(/relacionado/);
    expect(buildActividadDatos({ ...base, recurrencia: 'unica', fecha_inicio: '2026-10-10', fecha_fin: '2026-10-01' }).error).toMatch(/anterior/);
    expect(buildActividadDatos({ ...base, recurrencia: 'semanal', dia_semana_inicio: '8', dia_semana_fin: '1' }).error).toMatch(/semana/);
    expect(buildActividadDatos({ ...base, recurrencia: 'anual', mes: '13' }).error).toMatch(/Mes/);
  });
  it('cruce de mes (28 → 3), pago solo-Admin por rol, sin completar por el asignado', () => {
    const d = buildActividadDatos({ ...base, dia_inicio: '28', dia_fin: '3', categoria: 'pago', visibilidad: 'admin', responsable_tipo: 'rol',
      responsable_rol: 'Facturación', asignado_puede_completar: false, relacionado_tipo: 'costo_fijo', relacionado_ref: 4 }).datos;
    expect(d).toMatchObject({ dia_inicio: 28, dia_fin: 3, visibilidad: 'admin', responsable_rol: 'Facturación', asignado_puede_completar: false, relacionado_ref: '4' });
    expect(d.responsable_usuario_id).toBeUndefined();
  });
  it('completar y editar una ocurrencia', () => {
    expect(buildCompletarArgs({ operacionId: OP, actividadId: '3', periodo: '2026-10-01', notas: '  ' }))
      .toEqual({ args: { p_operacion_id: OP, p_actividad_id: 3, p_periodo: '2026-10-01', p_notas: null } });
    expect(buildCompletarArgs({ actividadId: 3 }).error).toBeTruthy();
    expect(buildEditarOcurrenciaArgs({ actividadId: 3, periodo: '2026-11-01', inicio: '2026-11-10', fin: '2026-11-12', motivo: 'abc' }).error).toMatch(/motivo/);
    expect(buildEditarOcurrenciaArgs({ actividadId: 3, periodo: '2026-11-01', inicio: '2026-11-12', fin: '2026-11-10', motivo: 'Reparación' }).error).toMatch(/anterior/);
    expect(buildEditarOcurrenciaArgs({ operacionId: OP, actividadId: 3, periodo: '2026-11-01', inicio: '2026-11-10', fin: '2026-11-12', motivo: ' Reparación ' }).args)
      .toEqual({ p_operacion_id: OP, p_actividad_id: 3, p_periodo: '2026-11-01', p_ventana_inicio: '2026-11-10', p_ventana_fin: '2026-11-12', p_motivo: 'Reparación' });
  });
  it('"editar de aquí en adelante" parte de la versión vigente y vuelve a armar los mismos datos', () => {
    const o = { actividad_id: 9, titulo: 'Pagar renta', descripcion: '', categoria: 'pago', recurrencia: 'mensual', dia_inicio: 1, dia_fin: 5,
      visibilidad: 'admin', asignado_puede_completar: true, responsable_rol: 'Facturación', relacionado_tipo: 'costo_fijo', relacionado_ref: '4' };
    const f = formDesdeOcurrencia(o);
    expect(f.id).toBe(9);
    expect(buildActividadDatos(f).datos).toMatchObject({ titulo: 'Pagar renta', dia_inicio: 1, dia_fin: 5, responsable_rol: 'Facturación', visibilidad: 'admin' });
  });
  it('responsable: persona inactiva marcada; rol; sin responsable = Admin', () => {
    expect(textoResponsable({ responsable_usuario_id: 1, responsable_nombre: 'Ana', responsable_activo: false })).toBe('Ana (sin responsable activo)');
    expect(textoResponsable({ responsable_rol: 'Producción' })).toBe('Rol Producción');
    expect(textoResponsable({})).toBe('Sin responsable (Admin)');
  });
});

describe('PD-02: garantías de las pantallas y del store', () => {
  const store = src('../data/supaStore.js');
  const vista = src('../components/views/CalendarioView.jsx');
  it('crear, editar y desactivar exigen Admin; completar no manda usuario, fecha ni estado', () => {
    for (const a of ['guardarActividad', 'editarOcurrencia', 'desactivarActividad']) {
      expect(store, a).toMatch(new RegExp(`${a}: async \\([^)]*\\) => \\{\\s*const guard = requireAdmin\\(\\);`));
    }
    const logica = src('../data/calendarioLogic.js');
    const completar = logica.slice(logica.indexOf('export function buildCompletarArgs'), logica.indexOf('/** Argumentos de editar_ocurrencia'));
    expect(completar).not.toMatch(/p_usuario|p_fecha|p_estado|p_clasificacion|completada_at/);
  });
  it('la interfaz no calcula estados: los pinta desde calendario()', () => {
    expect(vista).toMatch(/estadoActividad\(o\.estado\)/);
    expect(vista).not.toMatch(/new Date\(\)/);
    expect(src('../data/calendarioLogic.js')).not.toMatch(/new Date\(\)/);
  });
  it('"Mis actividades" pide solo lo asignado y no ofrece crear ni editar', () => {
    expect(vista).toMatch(/actions\.calendario\(desde, hasta, \{ soloMias: personal \}\)/);
    expect(vista).toMatch(/const esAdmin = !!res\?\.es_admin && !personal;/);
    expect(vista).toMatch(/action=\{esAdmin \?/);
    expect(vista).toMatch(/\{esAdmin && !edit && \(/);
  });
  it('el resumen del Dashboard y la Bandeja usan las ocurrencias abiertas del servidor; sin notificaciones', () => {
    expect(store).toMatch(/supabase\.rpc\('calendario', \{ p_desde: sumarDiasISO\(hoy, -1095\), p_hasta: sumarDiasISO\(hoy, 4\), p_solo_mias: false, p_solo_abiertas: true \}\)/);
    expect(src('../components/views/DashboardView.jsx')).toMatch(/resumenActividades\(data\.actividadesAbiertas, diaNegocio\(\)\)/);
    for (const t of [vista, src('../data/calendarioLogic.js')]) expect(t).not.toMatch(/notificaciones|push_subscriptions|notify\(|sendEmail|whatsapp/i);
  });
  it('completar no toca dinero ni máquinas (la base solo registra la terminación)', () => {
    const sql = src('../../supabase/118_calendario_operativo.sql');
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.completar_ocurrencia'), sql.indexOf('-- ═══ Crear o "editar las futuras"'));
    expect(fn).not.toMatch(/INSERT INTO (pagos|movimientos_contables|costos_historial|cuentas_por_pagar)|UPDATE (camiones|costos_fijos|produccion|cuartos_frios)/);
    expect(fn).toMatch(/INSERT INTO actividad_ocurrencias/);
  });
});

describe('118 / 117: el SQL cumple el diseño', () => {
  const sql = src('../../supabase/118_calendario_operativo.sql');
  it('dos tablas con RLS, solo SELECT para authenticated, historia protegida por triggers', () => {
    expect(sql).toMatch(/GRANT SELECT ON actividades, actividad_ocurrencias TO authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(sql).toMatch(/CREATE TRIGGER trg_actividades_guard BEFORE UPDATE OR DELETE ON actividades/);
    expect(sql).toMatch(/CREATE TRIGGER trg_actividad_ocurrencias_guard BEFORE UPDATE OR DELETE ON actividad_ocurrencias/);
    expect(sql).toMatch(/UNIQUE \(actividad_id, periodo\)/);
  });
  it('contratos SECURITY DEFINER con search_path fijo', () => {
    const defs = sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+\([^]*?AS \$\$/g) || [];
    const sd = defs.filter(x => /SECURITY DEFINER/.test(x));
    expect(sd.length).toBe(7);
    for (const d of sd) expect(d).toMatch(/SET search_path = public, pg_temp/);
  });
  it('117: solo cambia las 24 policies de lectura amplia y no toca erp_es_activo()', () => {
    const s117 = src('../../supabase/117_aislamiento_lectura_empleado.sql');
    expect((s117.match(/\['[a-z_]+', '[a-z_]+'\]/g) || []).length).toBe(24);
    expect(s117).toMatch(/ALTER POLICY %I ON public\.%I USING \(erp_lector_negocio\(\)\)/);
    expect(s117).not.toMatch(/CREATE OR REPLACE FUNCTION public\.erp_es_activo/);
    expect(s117).toMatch(/erp_rol_activo\(\) <> 'Empleado'/);
  });
});
