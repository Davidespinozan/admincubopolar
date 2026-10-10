// choferRutaLogic.js — reglas puras de la app del Chofer que no dependen de la
// pantalla: qué ruta es la suya ahora, si un cliente puede llevarse fiado y
// cómo se mezclan las entregas guardadas en el teléfono con las del servidor.
// El servidor sigue siendo la autoridad; esto evita que el chofer llegue a un
// rechazo que ya no puede corregir desde la calle.

const txt = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Una ruta ya empezada va primero: no se le cambia al chofer a media ruta.
const PRIORIDAD = { 'en progreso': 0, 'en_progreso': 0, cargada: 1, 'pendiente firma': 2, programada: 3 };

/**
 * La ruta del chofer en este momento.
 *  - Una ruta ya EMPEZADA (carga pedida, cargada o en progreso) se muestra aunque
 *    haya cambiado el día: antes desaparecía a medianoche y lo que solo vivía en
 *    el teléfono (ventas exprés, mermas) no llegaba al servidor.
 *  - Una ruta Programada se muestra desde su fecha en adelante (creada la noche
 *    anterior, se ve al día siguiente), nunca una con fecha futura.
 *  - Con varias, gana la más avanzada y, entre iguales, la más antigua.
 * @param {{ esAdmin?: boolean }} opciones  Admin en vista previa: sin filtrar por chofer.
 */
export function rutaActivaDelChofer(rutas, usuario, hoy, { esAdmin = false } = {}) {
  const candidatas = (Array.isArray(rutas) ? rutas : []).filter(r => {
    const est = txt(r?.estatus).toLowerCase();
    if (!(est in PRIORIDAD)) return false;
    const fecha = txt(r?.fecha).slice(0, 10);
    if (PRIORIDAD[est] === 3 && fecha && hoy && fecha > hoy) return false;
    if (esAdmin) return true;
    const chofer = r.choferId ?? r.chofer_id;
    return !!chofer && (String(chofer) === String(usuario?.id) || (txt(r.choferNombre) !== '' && txt(r.choferNombre) === txt(usuario?.nombre)));
  });
  candidatas.sort((a, b) => (PRIORIDAD[txt(a.estatus).toLowerCase()] - PRIORIDAD[txt(b.estatus).toLowerCase()]) || (num(a.id) - num(b.id)));
  return candidatas[0] || null;
}

/**
 * ¿Se le puede entregar FIADO a este cliente por este importe? (espejo de
 * fin_validar_credito: crédito autorizado y saldo + importe dentro del límite).
 * @returns {string|null} motivo para el chofer, o null si sí puede.
 */
export function motivoSinCredito(cliente, importe) {
  if (!cliente) return 'El crédito necesita un cliente registrado. Cobra de otra forma.';
  if (!(cliente.credito_autorizado ?? cliente.creditoAutorizado)) return `${txt(cliente.nombre) || 'Este cliente'} no tiene crédito autorizado. Cobra de otra forma o avisa a administración.`;
  const limite = num(cliente.limite_credito ?? cliente.limiteCredito);
  const saldo = num(cliente.saldo);
  if (limite > 0 && saldo + num(importe) > limite + 0.004) {
    const disp = Math.max(Math.round((limite - saldo) * 100) / 100, 0);
    return `${txt(cliente.nombre) || 'El cliente'} ya no tiene crédito suficiente (le quedan $${disp.toLocaleString('es-MX')}). Cobra de otra forma o avisa a administración.`;
  }
  return null;
}

// Lo que solo existe en el teléfono y el servidor no devuelve.
const SOLO_LOCAL = ['foto', 'fotoEntrega', 'fotoSubida', 'fotoEntregaSubida', 'referencia', 'contacto', 'folioNota', 'hora', 'offline'];

/**
 * Mezcla las entregas del teléfono con las órdenes ya entregadas que trae el
 * servidor. El servidor manda en cliente, productos, total y forma de pago; el
 * teléfono conserva fotos, referencia, contacto y hora. Mantiene el orden en que
 * se entregó y agrega al final lo que el teléfono no tenía.
 */
export function mezclarEntregas(locales, delServidor) {
  const prev = Array.isArray(locales) ? locales : [];
  const db = new Map((Array.isArray(delServidor) ? delServidor : []).map(e => [String(e.ordenId), e]));
  const vistos = new Set();
  const out = prev.map(e => {
    const k = e?.ordenId != null ? String(e.ordenId) : null;
    if (!k || !db.has(k)) return e;
    vistos.add(k);
    const local = {};
    for (const campo of SOLO_LOCAL) if (e[campo] !== undefined && e[campo] !== null && e[campo] !== '') local[campo] = e[campo];
    return { ...db.get(k), ...local };
  });
  for (const [k, e] of db) if (!vistos.has(k)) out.push(e);
  return out;
}
