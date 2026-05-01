import { useMemo, StatusBadge, PageHeader, s, n, eqId, fmtDate, fmtMoney } from './viewsCommon';

export function ConciliacionView({ data }) {
  // Auto-calculated: group orders and mermas by ruta
  const rutasCompletas = useMemo(() => {
    return (data.rutas || []).filter(r => r.estatus === "Completada" || r.estatus === "Cerrada").map(ruta => {
      const rutaOrdenes = data.ordenes.filter(o => eqId(o.rutaId, ruta.id));
      const entregadas = rutaOrdenes.filter(o => o.estatus === "Entregada");
      const esCredito = (orden) => {
        const metodo = s(orden.metodoPago || orden.metodo_pago).toLowerCase();
        return metodo.includes("crédito") || metodo.includes("fiado");
      };
      const totalVendido = entregadas.reduce((s, o) => s + n(o.total), 0);
      const totalCobrado = entregadas.filter(o => !esCredito(o)).reduce((s, o) => s + n(o.total), 0);
      const totalCredito = entregadas.filter(esCredito).reduce((s, o) => s + n(o.total), 0);
      return { ...ruta, rutaOrdenes, entregadas, totalVendido, totalCobrado, totalCredito };
    });
  }, [data.rutas, data.ordenes]);

  return (<div>
    <PageHeader title="Cortes de Caja" subtitle="Conciliación automática de rutas" />
    {rutasCompletas.length === 0 ? (
      <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
        <p className="text-sm text-slate-400">Sin rutas completadas aún. Cuando un chofer cierre su ruta desde la app, aparecerá aquí automáticamente.</p>
      </div>
    ) : rutasCompletas.map(ruta => (
      <div key={ruta.id} className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{s(ruta.nombre)} — {s(ruta.folio)}</h3>
            <p className="text-xs text-slate-400">{s(ruta.choferNombre || ruta.chofer)} · {fmtDate(ruta.fecha)}</p>
          </div>
          <StatusBadge status={ruta.estatus} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] text-blue-500 uppercase font-bold">Órdenes</p><p className="text-lg font-extrabold text-blue-700">{ruta.entregadas.length}/{ruta.rutaOrdenes.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] text-emerald-500 uppercase font-bold">Vendido</p><p className="text-lg font-extrabold text-emerald-700">{fmtMoney(ruta.totalVendido)}</p></div>
          <div className="bg-purple-50 rounded-xl p-3"><p className="text-[10px] text-purple-500 uppercase font-bold">Cobrado</p><p className="text-lg font-extrabold text-purple-700">{fmtMoney(ruta.totalCobrado)}</p></div>
          <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] text-amber-500 uppercase font-bold">Crédito</p><p className="text-lg font-extrabold text-amber-700">{fmtMoney(ruta.totalCredito)}</p></div>
        </div>
        {ruta.entregadas.length > 0 && (
          <div className="space-y-1.5">
            {ruta.entregadas.map(o => (
              <div key={o.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg">
                <div className="min-w-0 flex-1"><span className="font-mono text-xs text-blue-600 font-bold">{s(o.folio)}</span> <span className="text-sm text-slate-700 ml-1 truncate">{s(o.clienteNombre || o.cliente)}</span></div>
                <div className="text-right flex-shrink-0"><span className="text-sm font-bold">{fmtMoney(o.total)}</span> <span className="text-xs text-slate-400 ml-1">{s(o.metodoPago) || "—"}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>);
}
