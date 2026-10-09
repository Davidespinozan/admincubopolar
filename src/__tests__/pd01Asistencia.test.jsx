// pd01Asistencia.test.jsx — WF-0 + PD-01 (mig 116): reloj checador geolocalizado.
// Lógica pura (argumentos, mensajes, zona horaria de Mazatlán) y garantías de
// las pantallas: una sola lectura de ubicación por toque, sin rastreo continuo,
// sin cola offline, el rol Empleado sin datos de negocio ni back office.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GEO_OPCIONES, rolSinDatosNegocio, buildRegistroArgs, mensajeErrorGeo, mensajeRegistro, esErrorDeRed, mensajeErrorLlamada,
  pantallaMiAsistencia, estadoDia, horaNegocio, fechaHoraNegocio, datetimeLocalNegocio, desfaseNegocio, isoDesdeLocalNegocio,
  textoTurno, textoDias, buildCorreccionArgs, buildCentroArgs, buildTurnoArgs, enlaceMapa,
} from '../data/asistenciaLogic';
import { ROLES_VALIDOS } from '../data/adminUserLogic';
import MiAsistenciaView from '../components/MiAsistenciaView';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const OP = '11111111-2222-4333-8444-555555555555';

describe('PD-01: argumentos de marcación', () => {
  it('una lectura válida → p_operacion_id, lat, lng y precisión (redondeada a 0.1 m)', () => {
    const r = buildRegistroArgs({ operacionId: OP, coords: { latitude: 23.2494, longitude: -106.4111, accuracy: 12.345 } });
    expect(r).toEqual({ args: { p_operacion_id: OP, p_lat: 23.2494, p_lng: -106.4111, p_precision_m: 12.3 } });
  });
  it('sin operación genera una nueva (uuid)', () => {
    const r = buildRegistroArgs({ coords: { latitude: 1, longitude: 2, accuracy: 3 } });
    expect(r.args.p_operacion_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('rechaza coordenadas fuera de rango, ausentes o sin precisión (no se envía nada)', () => {
    expect(buildRegistroArgs({ coords: { latitude: 91, longitude: 0, accuracy: 5 } }).error).toBeTruthy();
    expect(buildRegistroArgs({ coords: { latitude: 0, longitude: -181, accuracy: 5 } }).error).toBeTruthy();
    expect(buildRegistroArgs({ coords: { latitude: null, longitude: 0, accuracy: 5 } }).error).toBeTruthy();
    expect(buildRegistroArgs({ coords: { latitude: 1, longitude: 1, accuracy: 0 } }).error).toMatch(/precisión/);
    expect(buildRegistroArgs({}).error).toBeTruthy();
  });
  it('lectura única, fresca y de alta precisión (sin caché)', () => {
    expect(GEO_OPCIONES).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    expect(Object.isFrozen(GEO_OPCIONES)).toBe(true);
  });
});

describe('PD-01: mensajes para el empleado', () => {
  it('errores de geolocalización: permiso denegado, sin señal, tiempo agotado, no soportado', () => {
    expect(mensajeErrorGeo({ code: 1 })).toMatch(/Permiso de ubicación denegado/);
    expect(mensajeErrorGeo({ code: 2 })).toMatch(/GPS/);
    expect(mensajeErrorGeo({ code: 3 })).toMatch(/tardó demasiado/);
    expect(mensajeErrorGeo('no_soportado')).toMatch(/no permite/);
  });
  it('entrada a tiempo / con retardo', () => {
    expect(mensajeRegistro('entrada', { ok: true, asistencia: { entrada_at: '2026-10-07T13:03:00Z', entrada_estado: 'a_tiempo' } }))
      .toEqual({ tono: 'ok', texto: 'Entrada registrada a las 07:03. ¡A tiempo!' });   // 13:03 UTC = 07:03 en Durango
    expect(mensajeRegistro('entrada', { ok: true, asistencia: { entrada_at: '2026-10-07T13:31:00Z', entrada_estado: 'retardo', minutos_retardo: 31 } }))
      .toEqual({ tono: 'aviso', texto: 'Entrada registrada a las 07:31 con retardo de 31 min.' });
  });
  it('salida fuera del centro: aceptada y señalada (con distancia)', () => {
    const m = mensajeRegistro('salida', { ok: true, fuera_de_ubicacion: true, distancia_m: 1112, asistencia: { salida_at: '2026-10-07T22:00:00Z' } });
    expect(m.tono).toBe('aviso');
    expect(m.texto).toMatch(/FUERA del centro de trabajo \(a 1,112 m\)/);
    expect(mensajeRegistro('salida', { ok: true, fuera_de_ubicacion: false, asistencia: { salida_at: '2026-10-07T22:00:00Z' } }).tono).toBe('ok');
  });
  it('rechazos del servidor: fuera de rango, precisión, sin turno, sin empleado, duplicado, sin entrada, fuera de horario', () => {
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'fuera_de_rango', distancia_m: 1112, radio_m: 100, centro: 'Planta' }).texto)
      .toBe('Estás a 1,112 m de Planta (máximo 100 m). La entrada solo se marca dentro del centro de trabajo.');
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'precision_insuficiente', precision_m: 80, precision_max_m: 50 }).texto).toMatch(/±80 m.*±50 m/);
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'sin_turno' }).texto).toMatch(/configuración pendiente/);
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'sin_empleado' }).texto).toMatch(/no está ligado/);
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'ya_registrada' })).toEqual({ tono: 'info', texto: 'Tu entrada de este turno ya estaba registrada.' });
    expect(mensajeRegistro('salida', { ok: false, codigo: 'ya_registrada' }).texto).toMatch(/salida ya estaba/);
    expect(mensajeRegistro('salida', { ok: false, codigo: 'sin_entrada' }).texto).toMatch(/avisa a Admin/);
    expect(mensajeRegistro('entrada', { ok: false, codigo: 'fuera_de_horario' }).texto).toMatch(/60 min antes/);
    expect(mensajeRegistro('entrada', null).tono).toBe('error');
  });
  it('sin conexión: se explica que no se guarda para después; el error de red es reintentable', () => {
    expect(esErrorDeRed(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(esErrorDeRed({ message: 'cualquier cosa' }, false)).toBe(true);
    expect(esErrorDeRed({ message: 'registrar_entrada: operacion_id ya usado' })).toBe(false);
    expect(mensajeErrorLlamada(new Error('Failed to fetch'))).toMatch(/Sin conexión.*no se guarda para después/);
    expect(mensajeErrorLlamada({ message: 'asistencia_dia: no autorizado' })).toMatch(/no tiene permiso/);
  });
});

describe('PD-01: pantalla "Mi asistencia" (estado → botón contextual)', () => {
  it('sin vínculo, sin turno y fuera de horario: sin botón', () => {
    for (const estado of ['sin_empleado', 'sin_turno', 'fuera_de_horario']) expect(pantallaMiAsistencia({ estado }).boton, estado).toBeNull();
    expect(pantallaMiAsistencia({ estado: 'sin_turno' }).detalle).toMatch(/configuración pendiente/);
  });
  it('pendiente → Marcar entrada; en turno → Marcar salida (con retardo visible); completa → sin botón', () => {
    expect(pantallaMiAsistencia({ estado: 'pendiente' }).boton).toEqual({ accion: 'entrada', label: 'Marcar entrada' });
    const t = pantallaMiAsistencia({ estado: 'en_turno', asistencia: { entrada_at: '2026-10-07T14:31:00Z', entrada_estado: 'retardo', minutos_retardo: 31 } });
    expect(t.boton).toEqual({ accion: 'salida', label: 'Marcar salida' });
    expect(t.titulo).toBe('En turno · retardo de 31 min');
    expect(pantallaMiAsistencia({ estado: 'completa', asistencia: {} }).boton).toBeNull();
  });
  it('estados del día para Admin', () => {
    expect(estadoDia('fuera_de_ubicacion')).toEqual({ label: 'Fuera de ubicación', tono: 'error' });
    expect(estadoDia('sin_salida').label).toBe('Sin salida');
    expect(estadoDia('falta').tono).toBe('error');
    expect(estadoDia('desconocido').label).toBe('desconocido');
  });
});

describe('PD-01: hora del negocio (America/Monterrey, Durango, UTC-6) sin depender de la zona del navegador', () => {
  it('hora y fecha locales', () => {
    expect(horaNegocio('2026-10-08T04:30:00Z')).toBe('22:30');          // jueves 22:30 en Durango = viernes 04:30 UTC
    expect(fechaHoraNegocio('2026-10-08T04:30:00Z')).toBe('2026-10-07 22:30');
    expect(fechaHoraNegocio('2026-10-08T06:00:00Z')).toBe('2026-10-08 00:00');
    expect(horaNegocio(null)).toBe('—');
    expect(datetimeLocalNegocio('2026-10-08T04:30:00Z')).toBe('2026-10-07T22:30');
  });
  it('datetime-local de Admin → ISO con el desfase de Durango (ida y vuelta exacta)', () => {
    expect(desfaseNegocio(new Date('2026-10-07T12:00:00Z'))).toBe('-06:00');
    expect(desfaseNegocio(new Date('2026-06-15T12:00:00Z'))).toBe('-06:00');   // sin horario de verano
    const iso = isoDesdeLocalNegocio('2026-10-07T22:30');
    expect(iso).toBe('2026-10-07T22:30:00-06:00');
    expect(new Date(iso).toISOString()).toBe('2026-10-08T04:30:00.000Z');
    expect(datetimeLocalNegocio(iso)).toBe('2026-10-07T22:30');
    expect(isoDesdeLocalNegocio('ayer')).toBeNull();
  });
  it('texto de turno (nocturno = +1 día) y días', () => {
    expect(textoTurno({ hora_entrada: '07:00:00', hora_salida: '15:00:00' })).toBe('07:00–15:00');
    expect(textoTurno({ hora_entrada: '22:00:00', hora_salida: '06:00:00' })).toBe('22:00–06:00 (+1 día)');
    expect(textoTurno(null)).toBe('Sin turno');
    expect(textoDias([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días');
    expect(textoDias([5, 1])).toBe('Lun, Vie');
  });
});

describe('PD-01: Admin — corrección, centro y turnos', () => {
  it('corrección: motivo obligatorio, campo válido, hora con desfase del negocio', () => {
    expect(buildCorreccionArgs({ asistenciaId: 9, campo: 'entrada', local: '2026-10-07T07:00', motivo: 'abc' }).error).toMatch(/motivo/);
    expect(buildCorreccionArgs({ asistenciaId: 9, campo: 'otro', local: '2026-10-07T07:00', motivo: 'Motivo válido' }).error).toBeTruthy();
    expect(buildCorreccionArgs({ campo: 'entrada', local: '2026-10-07T07:00', motivo: 'Motivo válido' }).error).toBeTruthy();
    expect(buildCorreccionArgs({ operacionId: OP, asistenciaId: '9', campo: 'salida', local: '2026-10-07T15:05', motivo: '  Olvidó marcar  ' }))
      .toEqual({ args: { p_operacion_id: OP, p_asistencia_id: 9, p_campo: 'salida', p_valor: '2026-10-07T15:05:00-06:00', p_motivo: 'Olvidó marcar' } });
  });
  it('centro de trabajo: rangos de radio y precisión; sin inventar coordenadas', () => {
    expect(buildCentroArgs({ nombre: 'Planta', latitud: '', longitud: '-106.4', radio_m: 100, precision_max_m: 50 }).error).toMatch(/Latitud/);
    expect(buildCentroArgs({ nombre: 'Planta', latitud: '23.2', longitud: '-106.4', radio_m: 5, precision_max_m: 50 }).error).toMatch(/Radio/);
    expect(buildCentroArgs({ nombre: 'Planta', latitud: '23.2', longitud: '-106.4', radio_m: 100, precision_max_m: 1000 }).error).toMatch(/Precisión/);
    expect(buildCentroArgs({ nombre: ' Planta ', latitud: '23.2494', longitud: '-106.4111', radio_m: '100', precision_max_m: '50' }).args)
      .toEqual({ p_id: null, p_nombre: 'Planta', p_latitud: 23.2494, p_longitud: -106.4111, p_radio_m: 100, p_precision_max_m: 50, p_activo: true });
  });
  it('turno: días, horas distintas, tolerancia, vigencia; nocturno permitido', () => {
    const base = { empleado_id: 3, centro_id: 1, dias: [5, 1, 5], hora_entrada: '22:00', hora_salida: '06:00', tolerancia_min: '10', vigente_desde: '2026-10-07' };
    expect(buildTurnoArgs(base).args).toEqual({
      p_id: null, p_empleado_id: 3, p_centro_id: 1, p_dias: [1, 5], p_hora_entrada: '22:00', p_hora_salida: '06:00',
      p_tolerancia_min: 10, p_vigente_desde: '2026-10-07', p_vigente_hasta: null, p_activo: true,
    });
    expect(buildTurnoArgs({ ...base, dias: [] }).error).toMatch(/día/);
    expect(buildTurnoArgs({ ...base, hora_salida: '22:00' }).error).toMatch(/distinta/);
    expect(buildTurnoArgs({ ...base, tolerancia_min: 200 }).error).toMatch(/Tolerancia/);
    expect(buildTurnoArgs({ ...base, vigente_hasta: '2026-10-01' }).error).toMatch(/vigencia/);
    expect(buildTurnoArgs({ ...base, empleado_id: '' }).error).toMatch(/Empleado/);
  });
  it('evidencia: enlace a mapa solo con coordenadas', () => {
    expect(enlaceMapa(23.25, -106.41)).toBe('https://www.google.com/maps?q=23.25,-106.41');
    expect(enlaceMapa(null, 1)).toBeNull();
  });
});

describe('WF-0: rol Empleado aislado', () => {
  it('Empleado es un rol válido y el único sin datos de negocio', () => {
    expect(ROLES_VALIDOS).toContain('Empleado');
    expect(ROLES_VALIDOS.filter(rolSinDatosNegocio)).toEqual(['Empleado']);
  });
  it('el store no carga datos de negocio ni abre realtime para Empleado', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/const fetchAll = useCallback\(async \(\) => \{\s*\/\/[^\n]*\n\s*if \(rolSinDatosNegocio\(userRolRef\.current\)\) \{ setLoading\(false\); return; \}/);
    expect(store).toMatch(/useEffect\(\(\) => \{\s*if \(rolSinDatosNegocio\(userRol\)\) return undefined;\s*const timers = new Map\(\);/);
  });
  it('acciones de Admin con guarda de rol; la marcación nunca manda empleado, usuario ni hora', () => {
    const store = src('../data/supaStore.js');
    for (const a of ['asistenciaDia', 'configAsistencia', 'guardarCentroTrabajo', 'guardarTurno', 'corregirAsistencia', 'vincularEmpleadoUsuario']) {
      expect(store, a).toMatch(new RegExp(`${a}: async \\([^)]*\\) => \\{\\s*const guard = requireAdmin\\(\\);`));
    }
    const logica = src('../data/asistenciaLogic.js');
    const registro = logica.slice(logica.indexOf('export function buildRegistroArgs'), logica.indexOf('/** Mensaje para el error de navigator'));
    expect(registro).not.toMatch(/p_empleado|p_usuario|p_fecha|p_hora|p_ahora/);
  });
  it('el Chofer (modo enfoque) tiene acceso a "Mi asistencia" en todos sus pasos', () => {
    const chofer = sinComentarios(src('../components/ChoferView.jsx'));
    expect(chofer).toMatch(/export default function ChoferView\(\{ user, data, actions, onLogout, onMiAsistencia, onMisActividades, onMiCuenta \}\)/);
    // Mobile-first: fila bajo el título (barraPersonal) en 4 pasos; en "En ruta" junto a "Ver mapa".
    // GER-1: la misma fila suma "Cuenta" (cambiar su contraseña).
    expect(chofer).toMatch(/const barraPersonal = \(botonAsistencia \|\| botonActividades \|\| botonCuenta\) \? \(\s*<div[^>]*>\{botonAsistencia\}\{botonActividades\}\{botonCuenta\}<\/div>/);
    expect((chofer.match(/\{barraPersonal\}/g) || []).length).toBe(4);
    expect(chofer).toMatch(/\{botonAsistencia\}\s*\{botonActividades\}\s*<button type="button" onClick=\{\(\) => setMapaVisible/);
  });
});

describe('PD-01: pantalla del empleado — una lectura por toque, sin rastreo ni cola offline', () => {
  const v = sinComentarios(src('../components/MiAsistenciaView.jsx'));
  it('getCurrentPosition una sola vez y solo dentro de la acción del botón; nunca watchPosition', () => {
    expect(v).not.toMatch(/watchPosition/);
    expect((v.match(/getCurrentPosition/g) || []).length).toBe(1);
    expect(v).toMatch(/function leerUbicacion\(\)/);
    expect((v.match(/leerUbicacion\(\)/g) || []).length).toBe(2);   // definición + el único uso, dentro de marcar()
    const marcar = v.slice(v.indexOf('const marcar = async'), v.indexOf('const p = pantallaMiAsistencia'));
    expect(marcar).toMatch(/coords = await leerUbicacion\(\);/);
    expect(v).not.toMatch(/setInterval|useColaOffline|localStorage|indexedDB/);
  });
  it('sin conexión no se intenta marcar; tras un error de red el reintento reusa la operación', () => {
    expect(v).toMatch(/navigator\.onLine === false/);
    expect(v).toMatch(/pendiente\.current = r\.red \? \{ tipo, operacionId: r\.operacionId \} : null;/);
    expect(v).toMatch(/const op = pendiente\.current\?\.tipo === tipo \? pendiente\.current\.operacionId : undefined;/);
  });
  it('render inicial (antes de leer el servidor): sin botón de marcar', () => {
    const h = renderToStaticMarkup(<MiAsistenciaView actions={{ miAsistencia: async () => ({}) }} />);
    expect(h).toMatch(/data-testid="mi-asistencia"/);
    expect(h).not.toMatch(/mi-asistencia-boton/);
    expect(h).toMatch(/Tu ubicación se lee una sola vez/);
  });
});

describe('116: el contrato SQL aplica la regla de ubicación del dueño', () => {
  const sql = src('../../supabase/116_asistencia.sql');
  it('precisión <= máxima Y distancia <= radio; nunca distancia - precisión', () => {
    expect(sql).toMatch(/IF p_precision_m > v_c\.precision_max_m THEN/);
    expect(sql).toMatch(/IF v_dist > v_c\.radio_m THEN/);
    expect(sql).not.toMatch(/v_dist\s*-\s*p_precision_m|distancia\s*-\s*precision/i);
  });
  it('los intentos rechazados no guardan coordenadas; la salida fuera queda marcada', () => {
    const intentos = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS asistencia_intentos'), sql.indexOf('CREATE INDEX IF NOT EXISTS idx_asistencia_intentos_fecha'));
    expect(intentos).not.toMatch(/lat|lng/);
    expect(sql).toMatch(/v_dentro := v_dist <= v_c\.radio_m;/);
  });
  it('sin escritura directa: authenticated solo SELECT; contratos SECURITY DEFINER con search_path fijo', () => {
    expect(sql).toMatch(/GRANT SELECT ON centros_trabajo, turnos, asistencias, asistencia_intentos, asistencia_correcciones TO authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    const defs = sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+\([^]*?AS \$\$/g) || [];
    for (const d of defs.filter(x => /SECURITY DEFINER/.test(x))) expect(d).toMatch(/SET search_path = public, pg_temp/);
    expect(defs.filter(x => /SECURITY DEFINER/.test(x)).length).toBe(12);
  });
  it('no toca nómina', () => {
    expect(sql).not.toMatch(/nomina|recibos_nomina|percepcion/i);
  });
});
