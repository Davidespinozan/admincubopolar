// saludoLogic.js — bienvenida por rol (mobile-first, 2026-10-09).
// Pura: hora local del negocio (Durango, ver utils/fechas) → saludo; nombre → primer nombre.

import { ZONA_NEGOCIO } from '../utils/fechas';

export const ZONA_SALUDO = ZONA_NEGOCIO;

/** Hora (0–23) en la zona del negocio, sin depender de la del navegador. */
export function horaNegocio(instante = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_SALUDO, hour: 'numeric', hour12: false }).format(instante);
  return Number(h) % 24;
}

/** 'Buenos días' (5–11) · 'Buenas tardes' (12–18) · 'Buenas noches' (19–4). */
export function saludoPorHora(hora) {
  if (hora >= 5 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Primer nombre si parece nombre de persona (no un usuario tipo "santy_mier_21"). */
export function primerNombre(nombre) {
  const t = String(nombre || '').trim();
  if (!t || /[_\d@.]/.test(t)) return '';
  const p = t.split(/\s+/)[0];
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function textoSaludo(nombre, instante = new Date()) {
  const n = primerNombre(nombre);
  return `${saludoPorHora(horaNegocio(instante))}${n ? `, ${n}` : ''}`;
}

/** Subtítulo de la bienvenida según el rol. */
export const SUBTITULO_ROL = {
  Admin: 'Esto es lo que necesitas atender hoy',
  'Facturación': 'Esto es lo que necesitas atender hoy',
  'Sin asignar': 'Esto es lo que necesitas atender hoy',
  Ventas: 'Tus ventas y cobros de hoy',
  'Producción': 'Lo que toca producir y cuidar en planta hoy',
  'Almacén Bolsas': 'Entradas y entregas de bolsas',
  Chofer: 'Tu ruta de hoy',
  Empleado: 'Tu asistencia y tus actividades',
};
export function subtituloRol(rol) {
  return SUBTITULO_ROL[rol] || 'Bienvenido a CUBOPOLAR';
}
