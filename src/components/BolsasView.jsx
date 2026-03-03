import { useState, useMemo } from 'react';
import { s, n } from '../utils/safe';

export default function BolsasView({ user, data, actions, onLogout }) {
  const [modal, setModal] = useState(null); // "entrada" | "salida"
  const [form, setForm] = useState({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false });
  const [historial, setHistorial] = useState([]);
  const [toast, setToast] = useState("");

  const empaques = useMemo(() => data.productos.filter(p => s(p.tipo) === "Empaque"), [data.productos]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const movHoy = useMemo(() => {
    const r = {};
    for (const e of empaques) r[s(e.sku)] = { entradas: 0, salidas: 0 };
    for (const h of historial) {
      if (!r[h.sku]) r[h.sku] = { entradas: 0, salidas: 0 };
      if (h.tipo === "entrada") r[h.sku].entradas += h.cantidad;
      else r[h.sku].salidas += h.cantidad;
    }
    return r;
  }, [historial, empaques]);

  const registrar = () => {
    if (!form.cantidad || n(form.cantidad) <= 0) return;
    const esEntrada = modal === "entrada";
    const motivo = esEntrada ? "Recepción de compra" : (form.destino || "Producción");

    actions.movimientoBolsa(
      form.sku, 
      n(form.cantidad), 
      esEntrada ? "Entrada" : "Salida", 
      motivo, 
      esEntrada ? n(form.costo) : 0,
      form.proveedor || null,
      form.esCredito
    );

    setHistorial(prev => [{
      id: Date.now(), tipo: esEntrada ? "entrada" : "salida", sku: form.sku,
      cantidad: n(form.cantidad), motivo,
      hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    }, ...prev]);

    showToast((esEntrada ? "+" : "-") + form.cantidad + " " + form.sku + (form.esCredito ? " (crédito)" : ""));
    setModal(null);
    setForm({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false });
  };

  const stockActual = (sku) => n(empaques.find(p => s(p.sku) === sku)?.stock || 0);

  return (
    <div className="min-h-screen bg-slate-50 max-w-[640px] mx-auto w-full">
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 text-white px-4 pb-4" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-extrabold">Almacén de Bolsas</h1>
            <p className="text-xs text-amber-100">{s(user?.nombre)}</p>
          </div>
          <button onClick={onLogout} className="text-xs bg-white/20 px-3 py-1.5 rounded-lg">Salir</button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {empaques.map(p => {
          const mov = movHoy[s(p.sku)] || { entradas: 0, salidas: 0 };
          return (
            <div key={p.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800">{s(p.nombre)}</p>
                  <p className="text-xs text-slate-400 font-mono">{s(p.sku)}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${n(p.stock) < 200 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {n(p.stock) < 200 ? "BAJO" : "OK"}
                </div>
              </div>
              <p className="text-4xl font-extrabold text-slate-800">{n(p.stock).toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">en almacén</p>
              {(mov.entradas > 0 || mov.salidas > 0) && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {mov.entradas > 0 && <div className="bg-emerald-50 rounded-xl p-2.5"><p className="text-xs text-emerald-600">Entradas hoy</p><p className="text-lg font-extrabold text-emerald-700">+{mov.entradas.toLocaleString()}</p></div>}
                  {mov.salidas > 0 && <div className="bg-red-50 rounded-xl p-2.5"><p className="text-xs text-red-500">Salidas hoy</p><p className="text-lg font-extrabold text-red-600">-{mov.salidas.toLocaleString()}</p></div>}
                </div>
              )}
              {n(p.stock) < 200 && (
                <div className="mt-3 bg-red-50 rounded-xl p-2.5">
                  <p className="text-xs text-red-600 font-semibold">⚠ Pedir más bolsas</p>
                </div>
              )}
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => { setModal("entrada"); setForm({ sku: "EMP-25", cantidad: "", destino: "", costo: "", proveedor: "", esCredito: false }); }}
            className="py-5 bg-emerald-600 text-white font-extrabold rounded-2xl text-base shadow-lg shadow-emerald-200 active:scale-[0.98] transition-transform">
            + Llegaron
          </button>
          <button onClick={() => { setModal("salida"); setForm({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false }); }}
            className="py-5 bg-red-500 text-white font-extrabold rounded-2xl text-base shadow-lg shadow-red-200 active:scale-[0.98] transition-transform">
            − Entregué a prod.
          </button>
        </div>

        {historial.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Movimientos de hoy</h3>
            <div className="space-y-2">
              {historial.map(h => (
                <div key={h.id} className={`rounded-xl p-3 border ${h.tipo === "entrada" ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                  <div className="flex justify-between items-center">
                    <span className={`text-sm font-bold ${h.tipo === "entrada" ? "text-emerald-600" : "text-red-600"}`}>
                      {h.tipo === "entrada" ? "+" : "-"}{h.cantidad.toLocaleString()} {h.sku}
                    </span>
                    <span className="text-xs text-slate-400">{h.hora}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{h.motivo}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">
              {modal === "entrada" ? "¿Cuántas llegaron?" : "¿Cuántas entregaste a producción?"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de bolsa</label>
                <div className="grid grid-cols-2 gap-2">
                  {empaques.map(p => (
                    <button key={p.sku} onClick={() => setForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-3 px-3 rounded-xl text-sm font-semibold border-2 ${form.sku === s(p.sku) ? (modal === "entrada" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-700") : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                      <p className="text-xs text-slate-400 mt-0.5">Hay: {n(p.stock).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Cuántas? *</label>
                <input type="number" inputMode="numeric" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-4 py-4 border border-slate-200 rounded-xl text-2xl font-bold text-center" placeholder="0" autoFocus />
              </div>

              {modal === "entrada" && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Proveedor</label>
                    <input type="text" value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base" placeholder="Ej: Bolsas del Norte" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Costo total (opcional)</label>
                    <input type="number" inputMode="decimal" value={form.costo} onChange={e => setForm(f => ({ ...f, costo: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base text-center" placeholder="$0.00" />
                  </div>
                  {n(form.costo) > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Forma de pago</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setForm(f => ({ ...f, esCredito: false }))}
                          className={`py-3 rounded-xl text-sm font-semibold border-2 ${!form.esCredito ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                          💵 Contado
                        </button>
                        <button onClick={() => setForm(f => ({ ...f, esCredito: true }))}
                          className={`py-3 rounded-xl text-sm font-semibold border-2 ${form.esCredito ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600"}`}>
                          📅 Crédito
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 text-center">
                        {form.esCredito ? "Se creará cuenta por pagar (deuda)" : "Se registra egreso en contabilidad"}
                      </p>
                    </div>
                  )}
                </>
              )}

              {modal === "salida" && form.cantidad && n(form.cantidad) > stockActual(form.sku) && (
                <div className="bg-red-50 rounded-xl p-3">
                  <p className="text-xs text-red-600 font-bold">⚠ No hay tantas — solo hay {stockActual(form.sku).toLocaleString()}</p>
                </div>
              )}
            </div>
            <button onClick={registrar}
              disabled={!form.cantidad || n(form.cantidad) <= 0 || (modal === "salida" && n(form.cantidad) > stockActual(form.sku))}
              className={`w-full py-4 text-white font-bold rounded-xl text-base mt-4 disabled:opacity-40 ${modal === "entrada" ? "bg-emerald-600" : "bg-red-500"}`}>
              {modal === "entrada" ? "✓ Registrar entrada" : "✓ Registrar salida"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
