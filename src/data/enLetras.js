// enLetras.js — importe con número a letras, formato fiscal mexicano
// (Tanda 28, roadmap item 12; patrón tomado de renovacell).
//
// importeEnLetras(1200) → "MIL DOSCIENTOS PESOS 00/100 M.N."
// Reglas que importan: apócope ("VEINTIÚN PESOS", "TREINTA Y UN MIL",
// "CIENTO UN"), "CIEN" vs "CIENTO", "UN MILLÓN" vs "DOS MILLONES",
// "MIL" sin "UN". Sin dependencias — se usa en la nota pública
// (netlify/functions) y puede usarse en exports del frontend.

const UNIDADES = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

// 0-99. apocope: "uno"→"un", "veintiuno"→"veintiún", "treinta y uno"→"treinta y un".
function decenasALetras(n, apocope) {
  if (n <= 20) {
    if (n === 1 && apocope) return 'un';
    return UNIDADES[n];
  }
  if (n < 30) {
    if (n === 21) return apocope ? 'veintiún' : 'veintiuno';
    if (n === 22) return 'veintidós';
    if (n === 23) return 'veintitrés';
    if (n === 26) return 'veintiséis';
    return 'veinti' + UNIDADES[n - 20];
  }
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return DECENAS[d];
  return `${DECENAS[d]} y ${decenasALetras(u, apocope)}`;
}

// 0-999
function centenasALetras(n, apocope) {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const parteCentena = CENTENAS[c];
  if (!parteCentena) return decenasALetras(resto, apocope);
  if (resto === 0) return parteCentena;
  return `${parteCentena} ${decenasALetras(resto, apocope)}`;
}

/**
 * Entero (0 – 999,999,999) a letras en minúsculas. apocope aplica al
 * final del número (para anteponerlo a un sustantivo: pesos, mil…).
 */
export function enteroALetras(n, apocope = false) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return 'cero';

  const millones = Math.floor(num / 1_000_000);
  const miles = Math.floor((num % 1_000_000) / 1000);
  const resto = num % 1000;
  const partes = [];

  if (millones === 1) partes.push('un millón');
  else if (millones > 1) partes.push(`${centenasALetras(millones, true)} millones`);

  if (miles === 1) partes.push('mil'); // nunca "un mil"
  else if (miles > 1) partes.push(`${centenasALetras(miles, true)} mil`);

  if (resto > 0) partes.push(centenasALetras(resto, apocope));

  return partes.join(' ');
}

/**
 * Importe monetario a letras, formato fiscal mexicano:
 * importeEnLetras(1200)     → 'MIL DOSCIENTOS PESOS 00/100 M.N.'
 * importeEnLetras(21.5)     → 'VEINTIÚN PESOS 50/100 M.N.'
 * importeEnLetras(1)        → 'UN PESO 00/100 M.N.'
 *
 * Negativos se tratan como su valor absoluto (una nota no cobra en
 * negativo). Redondeo a centavos con corrección de flotantes.
 *
 * @param {number} monto
 * @returns {string}
 */
export function importeEnLetras(monto) {
  const centavosTotales = Math.round((Math.abs(Number(monto) || 0) + Number.EPSILON) * 100);
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;
  const sustantivo = entero === 1 ? 'PESO' : 'PESOS';
  const letras = enteroALetras(entero, true).toUpperCase();
  return `${letras} ${sustantivo} ${String(centavos).padStart(2, '0')}/100 M.N.`;
}
