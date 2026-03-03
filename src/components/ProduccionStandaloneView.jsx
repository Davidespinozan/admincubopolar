import { useState, useMemo } from 'react';
import { s, n } from '../utils/safe';

const empaqueMap = { "HC-25K": "EMP-25", "HC-5K": "EMP-5", "HT-25K": "EMP-25", "BH-50K": null };

export default function ProduccionStandaloneView({ user, data, actions, onLogout }) {
  const [tab, setTab] = useState("producir");
  const [modal, setModal] = useState(false);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [sacarModal, setSacarModal] = useState(null); // { cfId, cfNombre }

  // Producir form — includes destino (congelador)
  const [form, setForm] = useState({ turno: "Matutino", maquina: "Máquina 30", sku: "HC-25K", cantidad: "", destino: "CF-1" });
  const [tForm, setTForm] = useState({ origen: "CF-1", destino: "CF-2", sku: "HC-25K", cantidad: "" });
  const [sacarForm, setSacarForm] = useState({ sku: "HC-25K", cantidad: "", motivo: "Carga a ruta" });

  // Simulated pending cargas from chofers
  const [cargasPendientes, setCargasPendientes] = useState([
    { id: 1, chofer: s(user?.nombre || "Operador"), ruta: "Ruta Norte", items: { "HC-25K": 74, "BH-50K": 5 }, hora: "07:30", estatus: "Pendiente" },
  ]);

  const [mermaModal, setMermaModal] = useState(false);
  const [mForm, setMForm] = useState({ sku: "HC-25K", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
  const [mermas, setMermas] = useState([]);
  const [fotoMerma, setFotoMerma] = useState(null);

  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const MERMA_CAUSAS = ["Bolsa rota", "Mal sellado", "Hielo derretido", "Falla de equipo", "Desmolde fallido", "Contaminación", "Otro"];

  const registrarMerma = () => {
    if (!mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMerma) return;
    const cant = n(mForm.cantidad);
    // Deduct from product stock
    const prod = data.productos.find(x => s(x.sku) === mForm.sku);
    if (prod) actions.updateProducto(prod.id, { stock: Math.max(0, n(prod.stock) - cant) });
    setMermas(prev => [...prev, { id: Date.now(), sku: mForm.sku, cantidad: cant, causa: mForm.causa, congelador: mForm.congelador, foto: fotoMerma, hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) }]);
    showToast("Merma: " + cant + "× " + mForm.sku + " registrada");
    setMermaModal(false);
    setFotoMerma(null);
    setMForm({ sku: "HC-25K", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
  };

  const prodHoy = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return data.produccion.filter(p => p.fecha && p.fecha.slice(0, 10) === hoy);
  }, [data.produccion]);

  const totalHoy = useMemo(() => prodHoy.reduce((s, p) => s + n(p.cantidad), 0), [prodHoy]);

  const mermaHoy = useMemo(() => mermas.reduce((s, m) => s + n(m.cantidad), 0), [mermas]);
  const skuOptions = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);
  const cuartos = data.cuartosFrios || [];

  const totalEnCuartos = useMemo(() => {
    let t = 0;
    for (const cf of cuartos) if (cf.stock) for (const v of Object.values(cf.stock)) t += n(v);
    return t;
  }, [cuartos]);

  const bolsaSku = empaqueMap[form.sku] || null;
  const stockBolsa = useMemo(() => {
    if (!bolsaSku) return 999999;
    const p = data.productos.find(x => x.sku === bolsaSku);
    return p ? n(p.stock) : 0;
  }, [data.productos, bolsaSku]);

  const registrarProduccion = () => {
    if (!form.cantidad || n(form.cantidad) <= 0) return;
    if (bolsaSku && n(form.cantidad) > stockBolsa) return;

    // 1. Create production record (En proceso)
    actions.addProduccion({ turno: form.turno, maquina: form.maquina, sku: form.sku, cantidad: form.cantidad });

    // Stock already handled by addProduccion in store

    // 3. Add to cuarto frío
    if (actions.meterACuartoFrio) {
      actions.meterACuartoFrio(form.destino, form.sku, n(form.cantidad));
    }

    const cfNombre = cuartos.find(cf => s(cf.id) === form.destino)?.nombre || form.destino;
    showToast(form.cantidad + " " + form.sku + " → " + cfNombre);
    setModal(false);
    setForm({ turno: "Matutino", maquina: "Máquina 30", sku: "HC-25K", cantidad: "", destino: "CF-1" });
  };

  const hacerTraspaso = () => {
    if (!tForm.cantidad || n(tForm.cantidad) <= 0 || tForm.origen === tForm.destino) return;
    if (actions.traspasoEntreUbicaciones) actions.traspasoEntreUbicaciones(tForm);
    const origenN = cuartos.find(cf => s(cf.id) === tForm.origen)?.nombre || tForm.origen;
    const destinoN = cuartos.find(cf => s(cf.id) === tForm.destino)?.nombre || tForm.destino;
    showToast(tForm.cantidad + " " + tForm.sku + ": " + origenN + " → " + destinoN);
    setTraspasoModal(false);
    setTForm({ origen: "CF-1", destino: "CF-2", sku: "HC-25K", cantidad: "" });
  };

  const hacerSalida = () => {
    if (!sacarForm.cantidad || n(sacarForm.cantidad) <= 0 || !sacarModal) return;
    if (actions.sacarDeCuartoFrio) {
      actions.sacarDeCuartoFrio(sacarModal.cfId, sacarForm.sku, sacarForm.cantidad, sacarForm.motivo);
    }
    showToast("Salida: " + sacarForm.cantidad + " " + sacarForm.sku + " de " + sacarModal.cfNombre);
    setSacarModal(null);
    setSacarForm({ sku: "HC-25K", cantidad: "", motivo: "Carga a ruta" });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 pb-4" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-lg font-extrabold">Producción</h1>
            <p className="text-xs text-blue-200">{s(user?.nombre)}</p>
          </div>
          <button onClick={onLogout} className="text-xs bg-white/20 px-3 py-1.5 rounded-lg font-semibold">Salir</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <p className="text-xs text-blue-200">Producido hoy</p>
            <p className="text-xl font-extrabold">{totalHoy.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <p className="text-xs text-blue-200">En congeladores</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-extrabold">{mermaHoy}</p>
            <p className="text-xs text-blue-200">Merma hoy</p>
            <p className="text-xl font-extrabold">{totalEnCuartos.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
          {[{ k: "producir", l: "Producción" }, { k: "cuartos", l: "Congeladores" }, { k: "mermas", l: "Mermas" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${tab === t.k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3">

        {/* ═══ TAB: PRODUCCIÓN ═══ */}
        {tab === "producir" && (<>
          <button onClick={() => setModal(true)}
            className="w-full py-5 bg-blue-600 text-white font-extrabold rounded-2xl text-lg shadow-lg shadow-blue-200 active:scale-[0.98] transition-transform">
            + Ya produje hielo
          </button>

          {prodHoy.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Producido hoy</h3>
              {prodHoy.map(p => (
                <div key={p.id} className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{n(p.cantidad).toLocaleString()} × {s(p.sku)}</p>
                      <p className="text-xs text-slate-400">{s(p.maquina)} · {s(p.turno)}</p>
                    </div>
                    <span className="text-xs text-emerald-600 font-bold bg-emerald-100 px-2 py-1 rounded-lg">✓ Congelado</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prodHoy.length === 0 && (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
              <p className="text-3xl mb-2">🧊</p>
              <p className="text-sm text-slate-400">Aún no has registrado producción hoy</p>
            </div>
          )}
        </>)}

        {/* ═══ TAB: CONGELADORES ═══ */}
        {tab === "cuartos" && (<>
          <button onClick={() => setTraspasoModal(true)}
            className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-2xl text-base shadow-lg shadow-blue-200 active:scale-[0.98] transition-transform">
            ↔ Mover entre congeladores
          </button>

          {/* Cargas pendientes de chofers */}
          {cargasPendientes.filter(c => c.estatus === "Pendiente").length > 0 && (
            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
              <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3">Cargas pendientes de chofer</h3>
              {cargasPendientes.filter(c => c.estatus === "Pendiente").map(cg => (
                <div key={cg.id} className="bg-white rounded-xl p-3 mb-2">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{cg.chofer}</p>
                      <p className="text-xs text-slate-400">{cg.ruta} · {cg.hora}</p>
                    </div>
                    <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-1 rounded-lg">Pendiente</span>
                  </div>
                  <div className="flex gap-1 mb-2">
                    {Object.entries(cg.items).map(([sku, cant]) => (
                      <span key={sku} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{cant}× {sku}</span>
                    ))}
                  </div>
                  <button onClick={() => {
                    setCargasPendientes(prev => prev.map(p => p.id === cg.id ? { ...p, estatus: "Entregado" } : p));
                    showToast("Carga entregada a " + cg.chofer + " ✓");
                  }}
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl text-sm active:scale-[0.98] transition-transform">
                    ✓ Entregar carga — sale del congelador
                  </button>
                </div>
              ))}
            </div>
          )}

          {cuartos.map(cf => {
            const stockEntries = cf.stock ? Object.entries(cf.stock) : [];
            const total = stockEntries.reduce((s, [, v]) => s + n(v), 0);
            return (
              <div key={cf.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                      <span className="text-2xl">🧊</span>
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800">{s(cf.nombre)}</p>
                      <p className="text-xs text-slate-400">{n(cf.temp)}°C · {n(cf.capacidad)}%</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-slate-800">{total.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">bolsas</p>
                  </div>
                </div>
                {stockEntries.length > 0 ? (
                  <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                    {stockEntries.map(([sku, qty]) => (
                      <div key={sku} className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-400 font-mono">{sku}</p>
                        <p className="text-lg font-extrabold text-slate-800">{n(qty).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 pb-3"><div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-sm text-slate-400">Vacío</p></div></div>
                )}
                <div className="border-t border-slate-100">
                  <button onClick={() => { setSacarModal({ cfId: s(cf.id), cfNombre: s(cf.nombre) }); setSacarForm({ sku: "HC-25K", cantidad: "", motivo: "Carga a ruta" }); }}
                    className="w-full py-3 text-xs font-bold text-amber-600 active:bg-amber-50">
                    − Sacar hielo (carga a ruta / otro)
                  </button>
                </div>
              </div>
            );
          })}
        </>)}

        <div className="h-8" />
      </div>

      {/* ═══ MODAL: Ya produje hielo ═══ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">¿Qué produjiste?</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-2 gap-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 ${form.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="Ej: 500" autoFocus />
              </div>
              {bolsaSku && (
                <div className={`p-3 rounded-xl ${n(form.cantidad) > stockBolsa ? "bg-red-50" : "bg-blue-50"}`}>
                  <p className="text-xs font-semibold">Consume: {form.cantidad || 0} bolsas {bolsaSku}</p>
                  <p className={`text-xs mt-0.5 ${n(form.cantidad) > stockBolsa ? "text-red-600 font-bold" : "text-slate-500"}`}>
                    Disponibles: {stockBolsa.toLocaleString()}{n(form.cantidad) > stockBolsa ? " — INSUFICIENTE" : ""}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Máquina</label>
                <div className="grid grid-cols-3 gap-2">
                  {["Máquina 30", "Máquina 20", "Máquina 15"].map(m => (
                    <button key={m} onClick={() => setForm(f => ({ ...f, maquina: m }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${form.maquina === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {m.replace("Máquina ", "Máq ")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Turno</label>
                <div className="grid grid-cols-2 gap-2">
                  {["Matutino", "Vespertino"].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, turno: t }))}
                      className={`py-2 rounded-xl text-sm font-semibold border-2 ${form.turno === t ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿A qué congelador va?</label>
                <div className="grid grid-cols-3 gap-2">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setForm(f => ({ ...f, destino: s(cf.id) }))}
                      className={`py-3 rounded-xl text-xs font-bold border-2 ${form.destino === s(cf.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                      <p className="text-[10px] text-slate-400 mt-0.5">{n(cf.temp)}°C</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={registrarProduccion}
              disabled={!form.cantidad || n(form.cantidad) <= 0 || (bolsaSku && n(form.cantidad) > stockBolsa)}
              className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
              Registrar producción
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Mover entre congeladores ═══ */}
      {traspasoModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setTraspasoModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">Mover entre congeladores</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">De</label>
                <div className="grid grid-cols-3 gap-2">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setTForm(f => ({ ...f, origen: s(cf.id) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${tForm.origen === s(cf.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">A</label>
                <div className="grid grid-cols-3 gap-2">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setTForm(f => ({ ...f, destino: s(cf.id) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${tForm.destino === s(cf.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"} ${tForm.origen === s(cf.id) ? "opacity-30" : ""}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-2 gap-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setTForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2 rounded-xl text-xs font-bold border-2 ${tForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" value={tForm.cantidad} onChange={e => setTForm(f => ({ ...f, cantidad: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" />
            </div>
            <button onClick={hacerTraspaso} disabled={!tForm.cantidad || n(tForm.cantidad) <= 0 || tForm.origen === tForm.destino}
              className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">
              Mover
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Sacar hielo ═══ */}
      {sacarModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setSacarModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-1">Sacar hielo</h3>
            <p className="text-sm text-slate-500 mb-4">{sacarModal.cfNombre}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-2 gap-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setSacarForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${sacarForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" value={sacarForm.cantidad} onChange={e => setSacarForm(f => ({ ...f, cantidad: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" autoFocus />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo</label>
                <div className="grid grid-cols-2 gap-2">
                  {["Carga a ruta", "Venta directa", "Merma", "Otro"].map(m => (
                    <button key={m} onClick={() => setSacarForm(f => ({ ...f, motivo: m }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${sacarForm.motivo === m ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={hacerSalida} disabled={!sacarForm.cantidad || n(sacarForm.cantidad) <= 0}
              className="w-full py-3.5 bg-amber-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">
              Sacar del congelador
            </button>
          </div>
        </div>
      )}

      {/* ═══ TAB MERMAS ═══ */}
        {tab === "mermas" && (<>
          <button onClick={() => { setMermaModal(true); setFotoMerma(null); setMForm({ sku: "HC-25K", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" }); }}
            className="w-full py-5 bg-red-500 text-white font-extrabold rounded-2xl text-lg shadow-lg shadow-red-200 active:scale-[0.98] transition-transform">
            + Registrar merma
          </button>

          {mermas.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mermas de hoy ({mermas.length})</h3>
              {mermas.map(m => (
                <div key={m.id} className="bg-red-50 rounded-xl p-3 border border-red-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-red-700">{m.cantidad}× {m.sku}</p>
                      <p className="text-xs text-slate-500">{m.causa} · {m.congelador} · {m.hora}</p>
                    </div>
                    {m.foto && <img src={m.foto} alt="Evidencia" className="w-10 h-10 object-cover rounded-lg border border-red-300" />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-slate-400 py-8">Sin mermas hoy</p>
          )}
        </>)}

      {/* ═══ MODAL MERMA ═══ */}
      {mermaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setMermaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">Registrar merma</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-2 gap-2">
                  {["HC-25K", "HC-5K", "HT-25K", "BH-50K"].map(sku => (
                    <button key={sku} onClick={() => setMForm(f => ({ ...f, sku }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${mForm.sku === sku ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"}`}>
                      {sku}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" value={mForm.cantidad} onChange={e => setMForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="0" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Causa</label>
                <div className="grid grid-cols-2 gap-2">
                  {MERMA_CAUSAS.map(c => (
                    <button key={c} onClick={() => setMForm(f => ({ ...f, causa: c }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${mForm.causa === c ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿De qué congelador?</label>
                <div className="grid grid-cols-3 gap-2">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setMForm(f => ({ ...f, congelador: s(cf.id) }))}
                      className={`py-2 rounded-xl text-xs font-bold border-2 ${mForm.congelador === s(cf.id) ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Evidencia (foto) *</label>
                {fotoMerma ? (
                  <div><img src={fotoMerma} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoMerma(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
                ) : (
                  <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                    <span className="text-lg">📷</span> Tomar foto de evidencia
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setFotoMerma(ev.target.result); r.readAsDataURL(f); }}} />
                  </label>
                )}
              </div>
            </div>
            <button onClick={registrarMerma} disabled={!mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMerma}
              className="w-full py-3.5 bg-red-500 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">
              Registrar merma
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
