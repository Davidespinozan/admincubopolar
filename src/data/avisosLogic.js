// avisosLogic.js — panel "Avisos" de la cabecera (2026-10-09).
// Dos cosas distintas en la misma campana:
//   · Alertas: condiciones calculadas en vivo (stock bajo, producir, CxC
//     vencida, complemento pendiente, ventas que esperan ruta). No se "leen":
//     desaparecen solas cuando se resuelve la causa. Tocar una lleva al módulo
//     donde se resuelve; se pueden ocultar por hoy (preferencia local del
//     dispositivo, vuelve mañana si la causa sigue).
//   · Notificaciones: eventos guardados en la base (venta nueva, ruta cerrada);
//     se marcan como leídas.

// Módulo donde se resuelve cada alerta, por el prefijo de su id.
export function destinoAlerta(alerta) {
  const id = String(alerta?.id ?? '');
  if (id.startsWith('ruta-')) return 'rutas';
  if (id.startsWith('cxc-')) return 'cobros';
  if (id.startsWith('comp-')) return 'facturacion';
  if (id.startsWith('prod-min-')) return 'produccion';
  return 'inventario';
}

export function tituloAlerta(alerta) {
  const id = String(alerta?.id ?? '');
  if (alerta?.titulo) return alerta.titulo;
  if (id.startsWith('ruta-')) return 'Ventas esperan ruta';
  if (id.startsWith('cxc-')) return 'Cobro vencido';
  if (id.startsWith('comp-')) return 'Complemento de pago';
  if (id.startsWith('prod-min-')) return 'Producir';
  return alerta?.tipo === 'critica' ? 'Stock crítico' : 'Stock bajo';
}

// Clave estable de una alerta para ocultarla hoy (id + mensaje: si la cifra
// cambia, es otra situación y vuelve a aparecer).
export function claveAlerta(alerta) {
  return `${String(alerta?.id ?? '')}|${String(alerta?.msg ?? alerta?.mensaje ?? '')}`;
}

export function alertasVisibles(alertas, ocultas) {
  const set = new Set(ocultas || []);
  return (alertas || []).filter(a => !set.has(claveAlerta(a)));
}

const PREFIJO = 'cp.avisos.ocultas.';

// Lee las claves ocultas del día (localStorage puede fallar: privado, bloqueado).
export function leerOcultas(dia, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PREFIJO + dia);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function guardarOcultas(dia, claves, storage = globalThis.localStorage) {
  try {
    // Solo se conserva el día en curso.
    for (let i = (storage?.length ?? 0) - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIJO) && k !== PREFIJO + dia) storage.removeItem(k);
    }
    storage?.setItem(PREFIJO + dia, JSON.stringify([...new Set(claves)]));
  } catch {
    /* sin almacenamiento: se ocultan solo en esta sesión */
  }
}

// Alerta de la campana para las órdenes que Ventas mandó a reparto sin ruta.
export function alertaEsperanRuta(ordenesSinRuta) {
  const n = (ordenesSinRuta || []).length;
  if (n === 0) return null;
  const folios = ordenesSinRuta.slice(0, 3).map(o => String(o.folio ?? '')).filter(Boolean).join(', ');
  return {
    id: 'ruta-pend',
    tipo: 'critica',
    titulo: n === 1 ? '1 venta espera ruta' : `${n} ventas esperan ruta`,
    msg: `Asígnalas a una ruta para que salgan a reparto${folios ? ` — ${folios}${n > 3 ? '…' : ''}` : ''}.`,
  };
}
