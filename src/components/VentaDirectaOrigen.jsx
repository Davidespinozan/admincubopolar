// VentaDirectaOrigen — OL-02C: origen físico de una venta directa de planta,
// compartido por Ventas y Admin (mismo contrato: completar_venta_directa).
//   useVentaDirecta: estado del intento (repartos por línea y cuarto, UUID de
//     operación, envío en curso). Un intento = un UUID; un reintento con los
//     MISMOS datos reutiliza el UUID (el servidor responde replay, no duplica);
//     datos distintos → UUID nuevo; se limpia tras éxito o al cerrar.
//   VentaDirectaOrigen: por línea, los cuartos que tienen ESE SKU con su
//     existencia física (cuartos_frios.stock) y la cantidad que sale de cada
//     uno. Preselecciona solo si exactamente un cuarto cubre la línea.
import { useMemo, useRef, useState } from 'react';
import {
  planVentaDirecta, repartosIniciales, validarVentaDirecta, validarLinea, construirAsignacion, claveVentaDirecta,
} from '../data/ventaDirectaLogic';
import { resolverOperacion } from '../data/produccionAtomicaLogic';

export function useVentaDirecta({ actions, cuartosFrios }) {
  const [orden, setOrden] = useState(null);
  const [repartos, setRepartos] = useState({});
  const [enviando, setEnviando] = useState(false);
  const opRef = useRef(null);
  const enVuelo = useRef(false);
  // Existencia en vivo: si el inventario cambia mientras el diálogo está
  // abierto, las opciones se recalculan (el servidor vuelve a validar).
  const planes = useMemo(() => (orden ? planVentaDirecta(orden, cuartosFrios) : []), [orden, cuartosFrios]);
  const validacion = useMemo(() => validarVentaDirecta(planes, repartos, cuartosFrios), [planes, repartos, cuartosFrios]);

  const iniciar = (o) => {
    opRef.current = null;
    setOrden(o);
    setRepartos(repartosIniciales(planVentaDirecta(o, cuartosFrios)));
  };
  const terminar = () => { opRef.current = null; setOrden(null); setRepartos({}); };
  const setCantidad = (sku, cuartoId, valor) => setRepartos(r => ({ ...r, [sku]: { ...(r[sku] || {}), [cuartoId]: valor } }));
  const todoDe = (sku, cuartoId, cantidad) => setRepartos(r => ({ ...r, [sku]: { [cuartoId]: String(cantidad) } }));

  /** Envía al contrato. Devuelve el resultado del store tal cual ({data} o {error}). */
  const completar = async ({ modo, metodo, referencia, folioNota }) => {
    if (!orden || enVuelo.current) return { error: 'en_curso' };
    if (!validacion.ok) return { error: 'asignacion_invalida' };
    const asignacion = construirAsignacion(planes, repartos);
    const op = resolverOperacion(opRef.current, claveVentaDirecta({ ordenId: orden.id, modo, metodo, referencia, folioNota, asignacion }));
    opRef.current = op;
    enVuelo.current = true;
    setEnviando(true);
    try {
      const r = await actions.completarVentaDirecta({ operacionId: op.id, ordenId: orden.id, modo, metodo, asignacion, referencia, folioNota });
      if (!r || r.error) return r || { error: 'sin_respuesta' };
      opRef.current = null;
      return r;
    } finally {
      enVuelo.current = false;
      setEnviando(false);
    }
  };

  return { orden, planes, repartos, validacion, enviando, iniciar, terminar, setCantidad, todoDe, completar };
}

const INPUT = "w-20 rounded-[10px] border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-semibold text-slate-800 focus:border-blue-400 focus:outline-none";

export default function VentaDirectaOrigen({ venta, disabled = false }) {
  const { planes, repartos, setCantidad, todoDe } = venta;
  if (!planes.length) {
    return <p className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">La orden no tiene productos para entregar.</p>;
  }
  return (
    <div className="space-y-2" data-testid="venta-directa-origen">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Origen físico</p>
      {planes.map(p => {
        const rep = repartos[p.sku] || {};
        const v = validarLinea(p, rep);
        const bloqueada = p.caso === 'sin_existencia' || p.caso === 'insuficiente';
        return (
          <div key={p.sku} className={`rounded-[14px] border p-3 ${v.ok ? 'border-emerald-200 bg-emerald-50/50' : bloqueada ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`} data-testid={`origen-${p.sku}`}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-bold text-slate-800"><span className="font-mono">{p.sku}</span> · {p.cantidad.toLocaleString()} bolsas</p>
              <p className={`text-xs font-bold ${v.ok ? 'text-emerald-700' : 'text-slate-500'}`}>Asignado: {v.asignado.toLocaleString()} / {p.cantidad.toLocaleString()}</p>
            </div>
            {p.caso === 'sin_existencia' && <p className="text-xs font-semibold text-red-700">No hay {p.sku} en ningún cuarto.</p>}
            {p.caso === 'insuficiente' && <p className="mb-2 text-xs font-semibold text-red-700">Existencia insuficiente: hay {p.total.toLocaleString()} de {p.cantidad.toLocaleString()}.</p>}
            {p.caso === 'elegir' && Object.values(rep).every(x => !x) && <p className="mb-2 text-xs text-slate-500">Varios cuartos alcanzan: elige de cuál sale.</p>}
            {p.caso === 'dividir' && <p className="mb-2 text-xs text-slate-500">Ningún cuarto alcanza solo: reparte entre cuartos.</p>}
            {p.opciones.length > 0 && (
              <div className="space-y-1.5">
                {p.opciones.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-700">{c.nombre}</p>
                      <p className="text-[11px] text-slate-500">Disponible: {c.disponible.toLocaleString()}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {c.disponible >= p.cantidad && !bloqueada && (
                        <button type="button" disabled={disabled} onClick={() => todoDe(p.sku, c.id, p.cantidad)}
                          className="rounded-[10px] border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Todo aquí</button>
                      )}
                      <input type="number" inputMode="numeric" min="0" max={c.disponible} aria-label={`${p.sku} desde ${c.nombre}`} disabled={disabled || bloqueada}
                        value={rep[c.id] ?? ''} onChange={e => setCantidad(p.sku, c.id, e.target.value)} placeholder="0" className={INPUT} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!v.ok && !bloqueada && v.error && v.asignado > 0 && <p className="mt-1.5 text-xs font-semibold text-amber-700">{v.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
