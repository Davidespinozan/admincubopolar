// VentasRapidasRuta — T5-D1 (mig 141), solo Admin. Ventas rápidas que el servidor YA registró
// en una ruta (cada una con su cobro o su cuenta por cobrar), para revisarlas antes de cerrar.
// Lo que un chofer tenga guardado sin señal en su teléfono no está aquí: el servidor no lo conoce.
import { useEffect, useMemo, useState } from 'react';
import { s, fmtMoney, fmtDateTime } from '../utils/safe';
import { filaVentaRapidaAdmin, resumenVentasRapidas } from '../data/ventaRapidaLogic';

export function ListaVentasRapidas({ filas, error }) {
  const res = useMemo(() => resumenVentasRapidas(filas || []), [filas]);
  return (
    <div className="rounded-xl bg-slate-50 p-4" data-testid="ventas-rapidas-ruta">
      <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">Ventas rápidas registradas{filas ? ` (${res.n})` : ''}</h4>
      {error && <p className="text-xs text-amber-700">{error}</p>}
      {!filas && !error && <p className="text-xs text-slate-500">Cargando…</p>}
      {filas && filas.length === 0 && <p className="text-xs text-slate-500">El chofer no ha registrado ventas rápidas en esta ruta.</p>}
      {filas && filas.length > 0 && (<>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
          <span>Total <b>{fmtMoney(res.total)}</b></span>
          <span>Efectivo <b>{fmtMoney(res.efectivo)}</b></span>
          {res.otros > 0 && <span>Transferencia / tarjeta <b>{fmtMoney(res.otros)}</b></span>}
          {res.credito > 0 && <span className="text-amber-700">Crédito <b>{fmtMoney(res.credito)}</b></span>}
        </div>
        {filas.map(f => (
          <div key={f.ordenId} className="flex items-start justify-between gap-2 border-t border-slate-200 py-1.5 text-xs">
            <div className="min-w-0">
              <p><span className="font-mono text-slate-500">{f.folio}</span> <span className="font-semibold text-slate-800">{f.cliente}</span></p>
              <p className="text-slate-500">{f.productos} · {fmtDateTime(f.capturadaAt)} · {f.actor}</p>
              {f.retrasoMin >= 10 && <p className="text-amber-700">Capturada sin señal: llegó al sistema {f.retrasoMin} min después.</p>}
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="font-bold text-slate-800">{fmtMoney(f.total)}</p>
              <p className={f.porCobrar !== null ? 'text-amber-700' : 'text-slate-500'}>{f.porCobrar !== null ? `Crédito · debe ${fmtMoney(f.porCobrar)}` : `${s(f.metodo)} · cobrado ${fmtMoney(f.cobrado)}`}</p>
            </div>
          </div>
        ))}
      </>)}
      <p className="mt-2 text-[11px] text-slate-500">Aquí solo aparece lo que ya llegó al sistema. Si el chofer tiene ventas guardadas sin señal en su teléfono, no se ven hasta que se envían: pregúntale antes de cerrar.</p>
    </div>
  );
}

export default function VentasRapidasRuta({ rutaId, actions }) {
  const [estado, setEstado] = useState({ filas: null, error: null });
  useEffect(() => {
    let vivo = true;
    setEstado({ filas: null, error: null });
    (async () => {
      const r = await actions?.ventasRapidasDeRuta?.(rutaId);
      if (!vivo) return;
      if (!r || r.error) setEstado({ filas: null, error: r?.error || 'No se pudieron leer las ventas rápidas' });
      else setEstado({ filas: (r.data || []).map(filaVentaRapidaAdmin), error: null });
    })();
    return () => { vivo = false; };
  }, [actions, rutaId]);
  return <ListaVentasRapidas filas={estado.filas} error={estado.error} />;
}
