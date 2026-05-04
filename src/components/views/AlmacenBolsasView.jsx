import { useMemo, PageHeader, EmptyState, s, n, todayLocalISO } from './viewsCommon';

export function AlmacenBolsasView({ data }) {
  const bolsas = (data.productos || []).filter(p => s(p.tipo) === "Empaque");
  const productosBySku = useMemo(() => {
    const map = {};
    (data.productos || []).forEach(p => { if (p?.sku) map[s(p.sku)] = s(p.nombre); });
    return map;
  }, [data.productos]);
  const movs = useMemo(() => (data.inventarioMov || []).filter(m => bolsas.some(b => s(b.sku) === s(m.producto))).slice(0, 30), [data.inventarioMov, bolsas]);
  const prodHoy = useMemo(() => (data.produccion || []).filter(p => s(p.fecha) === todayLocalISO()), [data.produccion]);

  // Partida doble: entradas vs salidas vs consumo
  const balance = useMemo(() => {
    const result = {};
    for (const b of bolsas) result[s(b.sku)] = { entradas: 0, salidas: 0, consumo: 0 };
    // Movimientos de almacén (registrados por encargada)
    for (const m of (data.inventarioMov || [])) {
      const sku = s(m.producto);
      if (!result[sku]) continue;
      const tipo = s(m.tipo);
      const origen = s(m.origen).toLowerCase();
      const qty = Math.abs(n(m.cantidad));
      const esConsumoProduccion =
        tipo === "Consumo" ||
        (tipo === "Salida" && (
          origen.startsWith("consumo") ||
          origen.includes("producción") ||
          origen.includes("produccion") ||
          origen.startsWith("prod")
        ));

      if (tipo === "Entrada") {
        result[sku].entradas += qty;
      } else if (esConsumoProduccion) {
        // Todo consumo de producción también es salida real de almacén
        result[sku].consumo += qty;
        result[sku].salidas += qty;
      } else if (tipo === "Salida") {
        result[sku].salidas += qty;
      }
    }
    return result;
  }, [data.inventarioMov, bolsas]);

  return (<div>
    <PageHeader title="Insumos (Bolsas)" subtitle="Control cruzado: almacén registra entrada/salida, producción consume" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      {bolsas.map(b => {
        const bal = balance[s(b.sku)] || { salidas: 0, consumo: 0 };
        const dif = bal.salidas - bal.consumo; // si 0: cuadra
        return (
        <div key={b.id} className="bg-white rounded-xl p-5 border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold">{s(b.nombre)}</p>
              <p className="text-3xl font-extrabold text-slate-800 mt-1">{n(b.stock).toLocaleString()}</p>
              <p className="text-xs text-slate-400">en almacén</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${n(b.stock) < 200 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {n(b.stock) < 200 ? "BAJO" : "OK"}
            </div>
          </div>
          {(bal.entradas > 0 || bal.salidas > 0 || bal.consumo > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Partida doble</p>
              <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                <div className="bg-emerald-50 rounded-lg p-2"><p className="text-emerald-400 font-bold">Entró</p><p className="text-emerald-700 font-extrabold">{bal.entradas}</p></div>
                <div className="bg-red-50 rounded-lg p-2"><p className="text-red-400 font-bold">Salió</p><p className="text-red-700 font-extrabold">{bal.salidas}</p></div>
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-blue-400 font-bold">Usó prod.</p><p className="text-blue-700 font-extrabold">{bal.consumo}</p></div>
                <div className={`rounded-lg p-2 ${dif === 0 ? "bg-emerald-50" : "bg-amber-50"}`}><p className={`font-bold ${dif === 0 ? "text-emerald-400" : "text-amber-400"}`}>Dif.</p><p className={`font-extrabold ${dif === 0 ? "text-emerald-700" : "text-amber-700"}`}>{dif === 0 ? "✓ 0" : dif}</p></div>
              </div>
              <p className="text-[10px] text-slate-300 mt-1">Salió (almacén) debe = Usó (producción). Si hay diferencia, investigar.</p>
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
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos de almacén</h3>
        <EmptyState
          message="Aún no hay movimientos de bolsas"
          hint="Cuando producción consuma o el almacén reciba, los movimientos aparecerán aquí."
        />
      </div>
    )}

    {movs.length > 0 && (<div className="bg-white border border-slate-100 rounded-2xl p-4">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos de almacén</h3>
      {movs.map(m => {
        const nom = productosBySku[s(m.producto)];
        return (
        <div key={m.id} className="flex justify-between items-center gap-2 py-2 border-b border-slate-50 last:border-0">
          <div className="min-w-0">
            <div className="truncate"><span className={`text-sm font-bold ${s(m.tipo) === "Entrada" ? "text-emerald-600" : "text-red-600"}`}>{s(m.tipo) === "Entrada" ? "+" : "-"}{n(m.cantidad)}</span> <span className="text-sm text-slate-600 ml-1">{nom || s(m.producto)}</span></div>
            {nom && <div className="font-mono text-[11px] text-slate-400 mt-0.5 truncate">{s(m.producto)}</div>}
          </div>
          <div className="text-right flex-shrink-0"><span className="text-xs text-slate-400">{s(m.origen)} · {s(m.usuario)}</span></div>
        </div>
      );
      })}
    </div>)}
  </div>);
}
