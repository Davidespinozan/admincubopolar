import { useEffect } from 'react';
import { useMemo, useState, PageHeader, EmptyState, s, n, todayLocalISO } from './viewsCommon';
import { clasificarMovEmpaque, efectoEnTotal, normalizarConciliacion } from '../../data/empaqueLogic';

export function AlmacenBolsasView({ data, actions }) {
  const bolsas = (data.productos || []).filter(p => s(p.tipo) === "Empaque");
  const productosBySku = useMemo(() => {
    const map = {};
    (data.productos || []).forEach(p => { if (p?.sku) map[s(p.sku)] = s(p.nombre); });
    return map;
  }, [data.productos]);
  const movs = useMemo(() => (data.inventarioMov || []).filter(m => bolsas.some(b => s(b.sku) === s(m.producto))).slice(0, 30), [data.inventarioMov, bolsas]);
  const prodHoy = useMemo(() => (data.produccion || []).filter(p => s(p.fecha) === todayLocalISO()), [data.produccion]);

  // 092: control "Salió a Producción vs Usó Producción" calculado en el
  // servidor desde fuentes independientes (eventos de entrega canónicos vs
  // consumo del contrato de producción). La historia anterior es ambigua y se
  // muestra aparte. Es una métrica de control, no un segundo inventario.
  const [conc, setConc] = useState({ filas: [], error: null, cargando: true });
  const refrescoKey = `${(data.inventarioMov || [])[0]?.id || 0}|${(data.produccion || [])[0]?.id || 0}`;
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await actions?.obtenerConciliacionEmpaque?.();
      if (!vivo) return;
      if (!r || r.error) setConc({ filas: [], error: r?.error || 'Conciliación no disponible', cargando: false });
      else setConc({ filas: normalizarConciliacion(r.data), error: null, cargando: false });
    })();
    return () => { vivo = false; };
  }, [actions, refrescoKey]);
  const concBySku = useMemo(() => Object.fromEntries(conc.filas.map(f => [f.sku, f])), [conc.filas]);

  return (<div>
    <PageHeader title="Insumos (Bolsas)" subtitle="Inventario total de la empresa. Control: lo entregado a Producción contra lo que Producción usó." />
    {conc.error && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">No se pudo cargar la conciliación: {conc.error}</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      {bolsas.map(b => {
        const f = concBySku[s(b.sku)];
        return (
        <div key={b.id} className="bg-white rounded-xl p-5 border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold">{s(b.nombre)}</p>
              <p className="text-3xl font-extrabold text-slate-800 mt-1">{n(b.stock).toLocaleString()}</p>
              <p className="text-xs text-slate-400">total de la empresa (almacén + Producción sin usar)</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${n(b.stock) < 200 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {n(b.stock) < 200 ? "BAJO" : "OK"}
            </div>
          </div>
          {f && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Control de entregas</p>
              <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                <div className="bg-amber-50 rounded-lg p-2"><p className="text-amber-500 font-bold">Entregado a prod.</p><p className="text-amber-700 font-extrabold">{f.entregado.toLocaleString()}</p></div>
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-blue-400 font-bold">Usó prod.</p><p className="text-blue-700 font-extrabold">{f.usado.toLocaleString()}</p></div>
                <div className={`rounded-lg p-2 ${f.estado === 'uso_sin_entrega' ? "bg-red-50" : "bg-emerald-50"}`}><p className={`font-bold ${f.estado === 'uso_sin_entrega' ? "text-red-500" : "text-emerald-500"}`}>Dif.</p><p className={`font-extrabold ${f.estado === 'uso_sin_entrega' ? "text-red-700" : "text-emerald-700"}`}>{f.diferencia === 0 ? "✓ 0" : f.diferencia.toLocaleString()}</p></div>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                {f.estado === 'sin_usar' ? "Positivo: bolsas entregadas que Producción aún no usa (siguen en el total)."
                  : f.estado === 'uso_sin_entrega' ? "Negativo: Producción usó más de lo entregado. Investigar."
                  : "Cuadra: lo entregado es igual a lo usado."}
              </p>
              {(f.legadoSalidasN > 0 || f.legadoConsumoN > 0) && (
                <p className="text-[10px] text-slate-400 mt-1">Historia anterior (no conciliable): {f.legadoSalidasN} salida(s) por {f.legadoSalidas.toLocaleString()} y {f.legadoConsumoN} consumo(s) por {f.legadoConsumo.toLocaleString()}.</p>
              )}
            </div>
          )}
        </div>);
      })}
    </div>

    {prodHoy.length > 0 && (<div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
      <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">Producción hoy ({prodHoy.length} lotes)</h3>
      {prodHoy.map(p => (
        <div key={p.id} className="flex justify-between items-center gap-2 py-2 border-b border-slate-50 last:border-0">
          <div className="min-w-0 truncate"><span className="text-sm font-bold text-slate-700">{n(p.cantidad)}× {s(p.sku)}</span> <span className="text-xs text-slate-400 ml-1">{s(p.turno)} · {s(p.maquina)}</span></div>
          <span className="text-xs font-mono text-slate-400 flex-shrink-0">{s(p.folio)}</span>
        </div>
      ))}
    </div>)}

    {movs.length === 0 && (
      <div className="bg-white border border-slate-100 rounded-2xl p-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos de bolsas</h3>
        <EmptyState
          message="Aún no hay movimientos de bolsas"
          hint="Cuando producción consuma o el almacén reciba, los movimientos aparecerán aquí."
        />
      </div>
    )}

    {movs.length > 0 && (<div className="bg-white border border-slate-100 rounded-2xl p-4">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos de bolsas</h3>
      {movs.map(m => {
        const nom = productosBySku[s(m.producto)];
        return (
        <div key={m.id} className="flex justify-between items-center gap-2 py-2 border-b border-slate-50 last:border-0">
          <div className="min-w-0">
            {(() => { const ef = efectoEnTotal(clasificarMovEmpaque(m)); return (
            <div className="truncate"><span className={`text-sm font-bold ${ef > 0 ? "text-emerald-600" : ef < 0 ? "text-red-600" : "text-amber-700"}`}>{ef > 0 ? "+" : ef < 0 ? "-" : "→ "}{n(m.cantidad)}</span> <span className="text-sm text-slate-600 ml-1">{nom || s(m.producto)}</span></div>
            ); })()}
            {nom && <div className="font-mono text-[11px] text-slate-400 mt-0.5 truncate">{s(m.producto)}</div>}
          </div>
          <div className="text-right flex-shrink-0"><span className="text-xs text-slate-400">{s(m.origen)} · {s(m.usuario)}</span></div>
        </div>
      );
      })}
    </div>)}
  </div>);
}
