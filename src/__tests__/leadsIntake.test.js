// leadsIntake.test.js — Tanda 19. Helpers puros del endpoint público
// de leads (netlify/functions/leads-intake). Cubre normalización de
// teléfono mexicano, validación con honeypot, formato del mensaje
// concatenado, y construcción del row final para INSERT.

import { describe, it, expect } from 'vitest';
import {
  normalizarTelefono,
  validateLeadIntake,
  formatLeadMensaje,
  buildLeadRow,
} from '../data/leadsIntakeLogic';

// ─── normalizarTelefono ──────────────────────────────────────
describe('normalizarTelefono', () => {
  it('teléfono limpio de 10 dígitos pasa', () => {
    expect(normalizarTelefono('6188405561')).toBe('6188405561');
  });

  it('quita espacios', () => {
    expect(normalizarTelefono('618 840 5561')).toBe('6188405561');
  });

  it('quita guiones', () => {
    expect(normalizarTelefono('618-840-5561')).toBe('6188405561');
  });

  it('quita paréntesis', () => {
    expect(normalizarTelefono('(618) 840-5561')).toBe('6188405561');
  });

  it('prefijo +52 (12 dígitos) se elimina', () => {
    expect(normalizarTelefono('+52 618 840 5561')).toBe('6188405561');
    expect(normalizarTelefono('526188405561')).toBe('6188405561');
  });

  it('prefijo +521 móvil legacy (13 dígitos) se elimina', () => {
    expect(normalizarTelefono('+521 618 840 5561')).toBe('6188405561');
    expect(normalizarTelefono('5216188405561')).toBe('6188405561');
  });

  it('lada empezando en 0 o 1 → null (inválida)', () => {
    expect(normalizarTelefono('0188405561')).toBeNull();
    expect(normalizarTelefono('1188405561')).toBeNull();
  });

  it('menos de 10 dígitos → null', () => {
    expect(normalizarTelefono('618840556')).toBeNull();
    expect(normalizarTelefono('123')).toBeNull();
  });

  it('más de 10 dígitos sin prefijo MX conocido → null', () => {
    expect(normalizarTelefono('11618840556100')).toBeNull();
  });

  it('null/undefined/vacío → null', () => {
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono(undefined)).toBeNull();
    expect(normalizarTelefono('')).toBeNull();
    expect(normalizarTelefono('   ')).toBeNull();
  });

  it('texto sin dígitos → null', () => {
    expect(normalizarTelefono('no-soy-un-numero')).toBeNull();
  });
});

// ─── validateLeadIntake ──────────────────────────────────────
describe('validateLeadIntake', () => {
  it('payload válido mínimo', () => {
    const r = validateLeadIntake({ nombre: 'Juan Pérez', telefono: '6188405561' });
    expect(r).toEqual({ ok: true, nombre: 'Juan Pérez', telefono: '6188405561' });
  });

  it('honeypot lleno → flag honeypot (caller responde 200 silencioso)', () => {
    const r = validateLeadIntake({
      nombre: 'Bot Spammer',
      telefono: '6188405561',
      company_url: 'http://spam.example.com',
    });
    expect(r).toEqual({ honeypot: true });
  });

  it('honeypot vacío string no dispara', () => {
    const r = validateLeadIntake({
      nombre: 'Juan',
      telefono: '6188405561',
      company_url: '',
    });
    expect(r.ok).toBe(true);
  });

  it('honeypot whitespace no dispara', () => {
    const r = validateLeadIntake({
      nombre: 'Juan',
      telefono: '6188405561',
      company_url: '   ',
    });
    expect(r.ok).toBe(true);
  });

  it('payload null → error', () => {
    expect(validateLeadIntake(null)).toEqual({ error: 'Payload vacío' });
  });

  it('payload no-objeto → error', () => {
    expect(validateLeadIntake('foo')).toEqual({ error: 'Payload vacío' });
  });

  it('nombre vacío → error', () => {
    expect(validateLeadIntake({ telefono: '6188405561' }))
      .toEqual({ error: 'Nombre requerido (mínimo 2 caracteres)' });
  });

  it('nombre 1 char → error', () => {
    expect(validateLeadIntake({ nombre: 'A', telefono: '6188405561' }))
      .toEqual({ error: 'Nombre requerido (mínimo 2 caracteres)' });
  });

  it('nombre demasiado largo → error', () => {
    const long = 'A'.repeat(150);
    expect(validateLeadIntake({ nombre: long, telefono: '6188405561' }))
      .toEqual({ error: 'Nombre demasiado largo' });
  });

  it('teléfono inválido → error', () => {
    expect(validateLeadIntake({ nombre: 'Juan', telefono: '123' }))
      .toEqual({ error: 'Teléfono mexicano de 10 dígitos requerido' });
  });

  it('teléfono ausente → error', () => {
    expect(validateLeadIntake({ nombre: 'Juan' }))
      .toEqual({ error: 'Teléfono mexicano de 10 dígitos requerido' });
  });

  it('nombre con whitespace lo trimea', () => {
    const r = validateLeadIntake({ nombre: '  Juan Pérez  ', telefono: '6188405561' });
    expect(r.nombre).toBe('Juan Pérez');
  });
});

// ─── formatLeadMensaje ───────────────────────────────────────
describe('formatLeadMensaje', () => {
  it('payload mínimo retorna string vacío (sin campos opcionales)', () => {
    expect(formatLeadMensaje({})).toBe('');
  });

  it('producto + cantidad + recurrente=Sí + frecuencia', () => {
    const m = formatLeadMensaje({
      producto: 'Bolsa 25 kg',
      cantidad: '10 bolsas',
      recurrente: 'Sí',
      frecuencia: '2-3 sem',
    });
    expect(m).toBe('Producto: Bolsa 25 kg\nCantidad: 10 bolsas\nRecurrente: Sí (2-3 sem)');
  });

  it('recurrente=No NO incluye frecuencia aunque venga', () => {
    const m = formatLeadMensaje({ recurrente: 'No', frecuencia: 'Diario' });
    expect(m).toBe('Recurrente: No');
  });

  it('comentarios separados con línea en blanco', () => {
    const m = formatLeadMensaje({
      negocio: 'Restaurante La Mesa',
      comentarios: 'Necesito entrega después de las 9 AM',
    });
    expect(m).toBe('Negocio: Restaurante La Mesa\n\nComentarios: Necesito entrega después de las 9 AM');
  });

  it('UTM + cta_origen aparecen al final como sección Tracking', () => {
    const m = formatLeadMensaje({
      nombre: 'Juan',
      cta_origen: 'hero',
      utm_source: 'facebook',
      utm_campaign: 'verano',
    });
    expect(m).toBe('─── Tracking ───\nCTA: hero\nutm_source: facebook\nutm_campaign: verano');
  });

  it('cta_origen=directo se omite (no aporta info)', () => {
    const m = formatLeadMensaje({ cta_origen: 'directo' });
    expect(m).toBe('');
  });

  it('payload completo se formatea correctamente', () => {
    const m = formatLeadMensaje({
      nombre: 'Juan',
      telefono: '6188405561',
      negocio: 'Hotel Plaza',
      zona: 'Centro',
      producto: 'Bolsa 5 kg',
      cantidad: '50 bolsas',
      recurrente: 'Sí',
      frecuencia: 'Diario',
      comentarios: 'Recibo de 7am a 11am',
      cta_origen: 'card_principal',
      utm_source: 'instagram',
    });
    const lines = m.split('\n');
    expect(lines).toContain('Producto: Bolsa 5 kg');
    expect(lines).toContain('Cantidad: 50 bolsas');
    expect(lines).toContain('Recurrente: Sí (Diario)');
    expect(lines).toContain('Negocio: Hotel Plaza');
    expect(lines).toContain('Zona: Centro');
    expect(lines).toContain('Comentarios: Recibo de 7am a 11am');
    expect(lines).toContain('─── Tracking ───');
    expect(lines).toContain('CTA: card_principal');
    expect(lines).toContain('utm_source: instagram');
  });

  it('campos vacíos / whitespace se omiten', () => {
    const m = formatLeadMensaje({
      producto: '',
      cantidad: '   ',
      negocio: 'Hotel',
    });
    expect(m).toBe('Negocio: Hotel');
  });
});

// ─── buildLeadRow ────────────────────────────────────────────
describe('buildLeadRow', () => {
  it('row con campos básicos', () => {
    const row = buildLeadRow({
      nombre: 'Juan',
      telefono: '6188405561',
      body: { producto: 'Bolsa 5 kg' },
      todayISO: '2026-05-06',
    });
    expect(row).toEqual({
      nombre: 'Juan',
      telefono: '6188405561',
      correo: null,
      mensaje: 'Producto: Bolsa 5 kg',
      origen: 'Landing page',
      estatus: 'Nuevo',
      fecha: '2026-05-06',
    });
  });

  it('UTM source aparece en origen', () => {
    const row = buildLeadRow({
      nombre: 'Juan',
      telefono: '6188405561',
      body: { utm_source: 'facebook' },
      todayISO: '2026-05-06',
    });
    expect(row.origen).toBe('Landing - facebook');
  });

  it('sin UTM source → origen default', () => {
    const row = buildLeadRow({
      nombre: 'Juan',
      telefono: '6188405561',
      body: {},
      todayISO: '2026-05-06',
    });
    expect(row.origen).toBe('Landing page');
  });

  it('correo siempre null (la landing no captura email)', () => {
    const row = buildLeadRow({
      nombre: 'Juan',
      telefono: '6188405561',
      body: { correo: 'spam@test.com' }, // si lo manda, lo ignoramos
      todayISO: '2026-05-06',
    });
    expect(row.correo).toBeNull();
  });

  it('estatus siempre Nuevo', () => {
    const row = buildLeadRow({
      nombre: 'Juan',
      telefono: '6188405561',
      body: {},
      todayISO: '2026-05-06',
    });
    expect(row.estatus).toBe('Nuevo');
  });
});
