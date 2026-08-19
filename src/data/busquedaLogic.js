// busquedaLogic.js — búsqueda global del shell admin (Tanda 27,
// roadmap item 9, patrón tomado de renovacell).
//
// Busca sobre el `data` del store YA scopeado por rol en App.jsx —
// un usuario solo encuentra lo que su rol puede ver, sin RBAC extra
// aquí. Devuelve resultados uniformes que la UI enruta al módulo
// correspondiente.

const normalizar = (v) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const money = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v) || 0);

// score 0 = empieza con el query (mejor), 1 = lo contiene.
const coincide = (query, ...campos) => {
  let mejor = null;
  for (const campo of campos) {
    const c = normalizar(campo);
    if (!c) continue;
    if (c.startsWith(query)) return 0;
    if (c.includes(query)) mejor = 1;
  }
  return mejor;
};

/**
 * Busca en clientes, órdenes, rutas, productos, leads y empleados.
 *
 * @param {object} data el `data` del store (camelCase, scopeado por rol)
 * @param {string} query texto del usuario (mínimo 2 caracteres útiles)
 * @param {{ limite?: number }} [opts]
 * @returns {Array<{tipo,id,icono,titulo,subtitulo,modulo,score}>}
 */
export function buscarGlobal(data, query, { limite = 8 } = {}) {
  const q = normalizar(query);
  if (q.length < 2) return [];
  const d = data || {};
  const resultados = [];
  const agregar = (score, r) => {
    if (score !== null) resultados.push({ ...r, score });
  };

  for (const c of d.clientes || []) {
    agregar(coincide(q, c.nombre, c.nombreComercial, c.nombre_comercial, c.rfc, c.contacto), {
      tipo: 'cliente', id: c.id, icono: '👤', modulo: 'clientes',
      titulo: String(c.nombre || ''),
      subtitulo: [c.nombreComercial || c.nombre_comercial, c.rfc].filter(Boolean).join(' · ') || 'Cliente',
    });
  }

  for (const o of d.ordenes || []) {
    agregar(coincide(q, o.folio, o.folioNota, o.folio_nota, o.cliente), {
      tipo: 'orden', id: o.id, icono: '🛒', modulo: 'ordenes',
      titulo: `${String(o.folio || `#${o.id}`)} — ${String(o.cliente || '')}`.trim(),
      subtitulo: [o.estatus, o.total !== undefined ? money(o.total) : null].filter(Boolean).join(' · '),
    });
  }

  for (const r of d.rutas || []) {
    agregar(coincide(q, r.folio, r.nombre, r.chofer), {
      tipo: 'ruta', id: r.id, icono: '🚚', modulo: 'rutas',
      titulo: String(r.folio || r.nombre || `Ruta #${r.id}`),
      subtitulo: [r.chofer, r.estatus].filter(Boolean).join(' · '),
    });
  }

  for (const p of d.productos || []) {
    agregar(coincide(q, p.sku, p.nombre), {
      tipo: 'producto', id: p.sku || p.id, icono: '🧊', modulo: 'productos',
      titulo: String(p.nombre || p.sku || ''),
      subtitulo: [p.sku, p.tipo].filter(Boolean).join(' · '),
    });
  }

  for (const l of d.leads || []) {
    agregar(coincide(q, l.nombre, l.telefono, l.correo), {
      tipo: 'lead', id: l.id, icono: '📞', modulo: 'leads',
      titulo: String(l.nombre || l.telefono || `Lead #${l.id}`),
      subtitulo: [l.telefono, l.estatus].filter(Boolean).join(' · '),
    });
  }

  for (const e of d.empleados || []) {
    agregar(coincide(q, e.nombre, e.puesto), {
      tipo: 'empleado', id: e.id, icono: '🧑‍🏭', modulo: 'empleados',
      titulo: String(e.nombre || ''),
      subtitulo: String(e.puesto || 'Empleado'),
    });
  }

  // startsWith antes que includes; a igual score, el orden de fuentes
  // (clientes → órdenes → rutas → productos → leads → empleados) es
  // estable porque sort es stable en JS moderno.
  return resultados.sort((a, b) => a.score - b.score).slice(0, limite);
}
