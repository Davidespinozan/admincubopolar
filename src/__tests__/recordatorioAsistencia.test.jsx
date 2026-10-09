// recordatorioAsistencia.test.jsx — aviso de asistencia en la pantalla de
// inicio de todos los roles (2026-10-09). El servidor decide el estado
// (mi_asistencia); aquí solo se traduce y se muestra. Sin escrituras.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordatorioAsistencia } from '../data/asistenciaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const turno = { id: 1, hora_entrada: '07:00:00', hora_salida: '15:00:00', tolerancia_min: 10, centro: 'Planta' };

describe('recordatorioAsistencia', () => {
  it('entrada pendiente → "Marca tu entrada" con su turno', () => {
    const r = recordatorioAsistencia({ estado: 'pendiente', turno_hoy: turno });
    expect(r).toMatchObject({ clave: 'entrada', tono: 'aviso', titulo: 'Marca tu entrada', cta: 'Marcar entrada' });
    expect(r.detalle).toMatch(/07:00/);
  });
  it('en turno → recuerda la salida (y el retardo si lo hubo)', () => {
    const r = recordatorioAsistencia({ estado: 'en_turno', asistencia: { entrada_at: '2026-10-09T14:20:00Z', entrada_estado: 'retardo', minutos_retardo: 20 } });
    expect(r).toMatchObject({ clave: 'salida', tono: 'ok', cta: 'Marcar salida' });
    expect(r.detalle).toMatch(/retardo de 20 min/);
    expect(r.detalle).toMatch(/No olvides marcar tu salida/);
  });
  it('salida olvidada → aviso para corregir con Administración', () => {
    const r = recordatorioAsistencia({ estado: 'sin_turno', salida_olvidada: { entrada_at: '2026-10-08T14:00:00Z' } });
    expect(r).toMatchObject({ clave: 'olvido', tono: 'error', cta: 'Ver mi asistencia' });
  });
  it('lo accionable de hoy va antes que el olvido de ayer', () => {
    expect(recordatorioAsistencia({ estado: 'pendiente', turno_hoy: turno, salida_olvidada: { entrada_at: '2026-10-08T14:00:00Z' } }).clave).toBe('entrada');
  });
  it('nada que recordar: sin ficha, sin turno, fuera de horario, jornada completa o sin datos', () => {
    for (const estado of ['sin_empleado', 'sin_turno', 'fuera_de_horario', 'completa']) expect(recordatorioAsistencia({ estado }), estado).toBeNull();
    expect(recordatorioAsistencia(null)).toBeNull();
    expect(recordatorioAsistencia(undefined)).toBeNull();
  });
});

describe('dónde aparece', () => {
  const shell = src('../components/CuboPolarERP.jsx');
  it('en la pantalla de inicio de todos los roles, no en "Mi asistencia" ni en "Ver como"', () => {
    expect(shell).toMatch(/\{view === nav\.inicio && view !== MODULO_MI_ASISTENCIA\.id && !viendoComo && \(\s*<RecordatorioAsistencia className="mb-4" actions=\{actions\} onIr=\{\(\) => go\(MODULO_MI_ASISTENCIA\.id\)\} \/>/);
  });
  it('también para el Chofer (modo enfoque), solo en su ruta', () => {
    expect(shell).toMatch(/\{view === MODULO_CHOFER\.id && !viendoComo && \(\s*<RecordatorioAsistencia actions=\{actions\} onIr=\{\(\) => go\(MODULO_MI_ASISTENCIA\.id\)\}/);
  });
  it('el componente solo lee mi_asistencia (sin escrituras ni ubicación)', () => {
    const c = src('../components/RecordatorioAsistencia.jsx');
    expect(c).toMatch(/actions\.miAsistencia\(\)/);
    expect(c).not.toMatch(/registrarEntrada|registrarSalida|geolocation|supabase/);
    expect(c).toMatch(/visibilitychange/);
  });
});
