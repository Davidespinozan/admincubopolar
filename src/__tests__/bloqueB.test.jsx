// bloqueB.test.jsx — guías "cómo funciona" (2026-10-09): de dónde sale la
// asistencia y las actividades, y por qué los costos no se capturan a mano.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Guia } from '../components/ui/Components';
import { pasosConfigAsistencia } from '../data/asistenciaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('pasos de puesta en marcha del reloj checador', () => {
  it('sin nada configurado: los tres pendientes', () => {
    const p = pasosConfigAsistencia({ centros: [], turnos: [], empleados: [{ id: 1 }] });
    expect(p.map(x => [x.k, x.hecho])).toEqual([['centro', false], ['turnos', false], ['accesos', false]]);
    expect(p[2].nota).toMatch(/0 de 1 empleados/);
  });
  it('todo listo solo con centro activo, turno activo y TODOS los empleados activos ligados', () => {
    const base = { centros: [{ id: 1, activo: true }], turnos: [{ id: 1, activo: true }] };
    expect(pasosConfigAsistencia({ ...base, empleados: [{ id: 1, usuarioId: 9 }, { id: 2, usuario_id: 8 }, { id: 3, estatus: 'Inactivo' }] }).every(x => x.hecho)).toBe(true);
    expect(pasosConfigAsistencia({ ...base, empleados: [{ id: 1, usuarioId: 9 }, { id: 2 }] })[2].hecho).toBe(false);
    expect(pasosConfigAsistencia({ centros: [{ id: 1, activo: false }], turnos: [{ id: 1, activo: false }], empleados: [] }).slice(0, 2).map(x => x.hecho)).toEqual([false, false]);
  });
});

describe('Guia', () => {
  it('pasos con estado; los pendientes con destino son botones', () => {
    const h = renderToStaticMarkup(<Guia titulo="Pon en marcha" pasos={[
      { label: 'Centro', hecho: true }, { label: 'Turnos', hecho: false, onClick: () => {} },
    ]}>Texto</Guia>);
    expect(h).toMatch(/Pon en marcha/);
    expect(h).toMatch(/bg-emerald-600 text-white/);
    expect(h).toMatch(/<button type="button"[^>]*>.*Turnos/);
  });
});

describe('cada pantalla explica de dónde salen sus datos', () => {
  it.each([
    ['../components/views/AsistenciaView.jsx', /testid="guia-asistencia"/],
    ['../components/MiAsistenciaView.jsx', /testid="guia-mi-asistencia"/],
    ['../components/views/CalendarioView.jsx', /testid="guia-mis-actividades"/],
    ['../components/views/CalendarioView.jsx', /testid="guia-calendario"/],
    ['../components/views/CostosView.jsx', /testid="guia-costos"/],
    ['../components/views/ProductosView.jsx', /testid="guia-catalogo"/],
  ])('%s', (rel, re) => expect(src(rel)).toMatch(re));
});
