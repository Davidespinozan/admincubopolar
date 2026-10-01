// fechas.js — 096: día de negocio canónico de CuboPolar.
//
// Zona del negocio: America/Mazatlan (Culiacán, Sinaloa). Espejo del
// servidor: fin_zona_negocio() / fin_hoy().
//
//   - Una FECHA de negocio ('YYYY-MM-DD', columnas DATE) es un día de
//     calendario: nunca pasa por new Date(), porque JavaScript la leería como
//     medianoche UTC y en México se mostraría el día anterior.
//   - Un INSTANTE (timestamptz) se asigna al día de negocio en Mazatlán, no a
//     la zona del navegador.

export const ZONA_NEGOCIO = 'America/Mazatlan';

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es exactamente una fecha de calendario 'YYYY-MM-DD'? */
export function esFechaSolo(v) {
  return typeof v === 'string' && RE_FECHA.test(v);
}

/** Componentes de una fecha 'YYYY-MM-DD' (sin zona). null si no lo es. */
export function partesFecha(v) {
  const m = RE_FECHA.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

let _fmtNegocio = null;
const fmtNegocio = () => {
  if (!_fmtNegocio) {
    _fmtNegocio = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return _fmtNegocio;
};

/**
 * Día de negocio ('YYYY-MM-DD') de un instante, en America/Mazatlan.
 * Sin argumento: el día de negocio de ahora. Una fecha 'YYYY-MM-DD' se
 * devuelve tal cual (ya es un día de negocio).
 */
export function diaNegocio(instante = new Date()) {
  if (esFechaSolo(instante)) return instante;
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(fmtNegocio().formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Mes 'YYYY-MM' de una fecha de negocio o de un instante. */
export function mesNegocio(v = new Date()) {
  return diaNegocio(v).slice(0, 7);
}

/** Días de calendario de la fecha `desde` a la fecha `hasta` (ambas de negocio). */
export function diasEntre(desde, hasta = diaNegocio()) {
  const a = partesFecha(diaNegocio(desde));
  const b = partesFecha(diaNegocio(hasta));
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sin conversión de zona. */
export function fmtFechaNegocio(v) {
  const p = partesFecha(v);
  if (!p) return null;
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/**
 * 098: suma días de calendario a una fecha de negocio 'YYYY-MM-DD' sin pasar
 * por la zona del navegador (ej. "hace 30 días" en filtros).
 */
export function sumarDias(fecha, dias) {
  const p = partesFecha(diaNegocio(fecha));
  if (!p) return '';
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(dias || 0)));
  return d.toISOString().slice(0, 10);
}
