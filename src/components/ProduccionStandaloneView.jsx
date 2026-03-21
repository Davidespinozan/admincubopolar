import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { s, n } from '../utils/safe';

const empaqueMap = { "HC-25K": "EMP-25", "HC-5K": "EMP-5", "HT-25K": "EMP-25", "BH-50K": null };
const PRODUCCION_SHELL = "min-h-screen w-full max-w-[640px] mx-auto bg-[linear-gradient(180deg,#edf3f6_0%,#e5edf1_100%)] text-slate-900 md:max-w-3xl lg:max-w-5xl";

export default function ProduccionStandaloneView({ user, data, actions, onLogout }) {
  const [tab, setTab] = useState("producir");
  const [modal, setModal] = useState(false);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [sacarModal, setSacarModal] = useState(null); // { cfId, cfNombre }
  const [transModal, setTransModal] = useState(false);
  const [transForm, setTransForm] = useState({ input_sku: "", input_kg: "", output_sku: "", output_kg: "", notas: "" });
  const [guardandoTrans, setGuardandoTrans] = useState(false);

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
  const [fotoMermaFile, setFotoMermaFile] = useState(null);
  const [fotoMermaPreview, setFotoMermaPreview] = useState('');
  const [guardandoMerma, setGuardandoMerma] = useState(false);

  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const MERMA_CAUSAS = ["Bolsa rota", "Mal sellado", "Hielo derretido", "Falla de equipo", "Desmolde fallido", "Contaminación", "Otro"];

  useEffect(() => {
    return () => {
      if (fotoMermaPreview && fotoMermaPreview.startsWith('blob:')) {
        URL.revokeObjectURL(fotoMermaPreview);
      }
    };
  }, [fotoMermaPreview]);

  const clearFotoMerma = () => {
    if (fotoMermaPreview && fotoMermaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(fotoMermaPreview);
    }
    setFotoMermaFile(null);
    setFotoMermaPreview('');
  };

  const registrarMerma = async () => {
    if (!mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile) return;
    const cant = n(mForm.cantidad);
    const authOwner = s(user?.auth_id || user?.id || 'usuario');
    const ext = (fotoMermaFile.name?.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg';
    const filePath = `${authOwner}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${mForm.sku}.${safeExt}`;

    setGuardandoMerma(true);
    try {
      const { error: uploadErr } = await supabase.storage
        .from('mermas')
        .upload(filePath, fotoMermaFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: fotoMermaFile.type || 'image/jpeg',
        });
      if (uploadErr) {
        showToast('No se pudo subir la foto');
        return;
      }

      let stockErr = null;
      if (mForm.congelador && actions.sacarDeCuartoFrio) {
        stockErr = await actions.sacarDeCuartoFrio(mForm.congelador, mForm.sku, cant, `Merma: ${mForm.causa}`);
      }
      if (stockErr) {
        await supabase.storage.from('mermas').remove([filePath]);
        return;
      }

      const mermaErr = await actions.registrarMerma(mForm.sku, cant, mForm.causa, s(user?.nombre), filePath);
      if (mermaErr) {
        if (mForm.congelador && actions.meterACuartoFrio) {
          await actions.meterACuartoFrio(mForm.congelador, mForm.sku, cant);
        }
        await supabase.storage.from('mermas').remove([filePath]);
        return;
      }

      showToast("Merma: " + cant + "× " + mForm.sku + " registrada");
      setMermaModal(false);
      clearFotoMerma();
      setMForm({ sku: "HC-25K", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
    } finally {
      setGuardandoMerma(false);
    }
  };

  const prodHoy = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return data.produccion.filter(p => p.fecha && p.fecha.slice(0, 10) === hoy);
  }, [data.produccion]);

  const totalHoy = useMemo(() => prodHoy.reduce((s, p) => s + n(p.cantidad), 0), [prodHoy]);

  const mermasHoyList = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return (data.mermas || []).filter(m => s(m.fecha).slice(0, 10) === hoy);
  }, [data.mermas]);

  const mermaHoy = useMemo(() => mermasHoyList.reduce((sum, item) => sum + n(item.cantidad), 0), [mermasHoyList]);
  const skuOptions = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);

  const insumos = useMemo(() => data.productos.filter(p => {
    const t = s(p.tipo).toLowerCase(); const sk = s(p.sku).toLowerCase();
    return t.includes('barra') || t.includes('insumo') || t.includes('materia') || sk.includes('bh-') || sk.includes('barra');
  }), [data.productos]);

  const transformaciones = useMemo(() => (data.produccion || []).filter(p => p.tipo === 'Transformacion'), [data.produccion]);

  const transInputKg  = Number(transForm.input_kg  || 0);
  const transOutputKg = Number(transForm.output_kg || 0);
  const transMermaKg  = Math.max(0, transInputKg - transOutputKg);
  const transRendimiento = transInputKg > 0 ? Math.round((transOutputKg / transInputKg) * 100) : 0;
  const transStockInput = useMemo(() => {
    const p = data.productos.find(x => x.sku === transForm.input_sku);
    return p ? Number(p.stock || 0) : null;
  }, [data.productos, transForm.input_sku]);

  const registrarTransformacion = async () => {
    if (!transForm.input_sku || !transForm.output_sku || transInputKg <= 0 || transOutputKg <= 0) return;
    setGuardandoTrans(true);
    const err = await actions.addTransformacion({ ...transForm, input_kg: transInputKg, output_kg: transOutputKg });
    setGuardandoTrans(false);
    if (err && err.message) { showToast('Error: ' + err.message); return; }
    showToast(`Transformación: ${transInputKg}kg ${transForm.input_sku} → ${transOutputKg}kg ${transForm.output_sku}`);
    setTransModal(false);
    setTransForm({ input_sku: "", input_kg: "", output_sku: "", output_kg: "", notas: "" });
  };
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

    // Atomic: producción + descontar empaques + meter a cuarto frío
    actions.producirYCongelar({
      turno: form.turno, maquina: form.maquina, sku: form.sku,
      cantidad: form.cantidad, destino: form.destino,
    });

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
    <div className={PRODUCCION_SHELL}>
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-4 pb-5 text-white shadow-[0_24px_48px_rgba(37,99,235,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="erp-kicker text-cyan-200/70">Producción</p>
            <h1 className="font-display text-[1.6rem] font-bold tracking-[-0.04em]">Producción del día</h1>
            <p className="text-xs text-cyan-100/80">{s(user?.nombre)}</p>
          </div>
          <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold">Salir</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Producido hoy</p>
            <p className="mt-1.5 text-2xl font-extrabold">{totalHoy.toLocaleString()}</p>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">En congeladores</p>
            <p className="mt-1.5 text-2xl font-extrabold">{totalEnCuartos.toLocaleString()}</p>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl sm:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Merma hoy</p>
            <p className="mt-1.5 text-2xl font-extrabold">{mermaHoy}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-[20px] border border-slate-200/80 bg-white/72 p-1.5 shadow-[0_14px_28px_rgba(8,19,27,0.05)] sm:grid-cols-4">
          {[{ k: "producir", l: "Producción" }, { k: "cuartos", l: "Congeladores" }, { k: "mermas", l: "Mermas" }, { k: "trans", l: "🧊 Trans." }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex-1 py-3 text-sm font-bold rounded-[16px] transition-all ${tab === t.k ? "bg-blue-600 text-white shadow-[0_12px_22px_rgba(37,99,235,0.14)]" : "text-slate-600"}`}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3">

        {/* ═══ TAB: PRODUCCIÓN ═══ */}
        {tab === "producir" && (<>
          <button onClick={() => setModal(true)}
            className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(37,99,235,0.16)] active:scale-[0.98] transition-transform">
            + Ya produje hielo
          </button>

          {prodHoy.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Producido hoy</h3>
              {prodHoy.map(p => (
                <div key={p.id} className="bg-emerald-50/90 rounded-[20px] p-3 border border-emerald-200 mb-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{n(p.cantidad).toLocaleString()} × {s(p.sku)}</p>
                      <p className="text-xs text-slate-500">{s(p.maquina)} · {s(p.turno)}</p>
                    </div>
                    <span className="text-xs text-emerald-600 font-bold bg-emerald-100 px-2 py-1 rounded-lg">✓ Congelado</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prodHoy.length === 0 && (
            <div className="bg-white/78 rounded-[28px] p-8 text-center border border-slate-200/80 shadow-[0_14px_28px_rgba(8,19,27,0.05)]">
              <p className="text-3xl mb-2">🧊</p>
              <p className="text-sm text-slate-400">Aún no has registrado producción hoy</p>
            </div>
          )}
        </>)}

        {/* ═══ TAB: CONGELADORES ═══ */}
        {tab === "cuartos" && (<>
          <button onClick={() => setTraspasoModal(true)}
            className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(37,99,235,0.16)] active:scale-[0.98] transition-transform">
            Mover entre congeladores
          </button>

          {/* Cargas pendientes de chofers */}
          {cargasPendientes.filter(c => c.estatus === "Pendiente").length > 0 && (
            <div className="bg-amber-50/90 rounded-[24px] p-4 border border-amber-200 shadow-[0_14px_28px_rgba(8,19,27,0.05)]">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-600">Cargas pendientes</h3>
              <p className="mb-3 text-sm font-semibold text-slate-700">Choferes listos para salida</p>
              {cargasPendientes.filter(c => c.estatus === "Pendiente").map(cg => (
                <div key={cg.id} className="bg-white/84 rounded-[20px] p-3 mb-2 border border-white/80">
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
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-[18px] text-sm active:scale-[0.98] transition-transform">
                    Entregar carga
                  </button>
                </div>
              ))}
            </div>
          )}

          {cuartos.map(cf => {
            const stockEntries = cf.stock ? Object.entries(cf.stock) : [];
            const total = stockEntries.reduce((s, [, v]) => s + n(v), 0);
            return (
              <div key={cf.id} className="bg-white/78 rounded-[24px] border border-slate-200/80 shadow-[0_14px_28px_rgba(8,19,27,0.05)] overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                      <span className="text-2xl">🧊</span>
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800">{s(cf.nombre)}</p>
                      <p className="text-xs text-slate-500">{n(cf.temp, -50, 10)}°C · {n(cf.capacidad)}%</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-slate-800">{total.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">bolsas</p>
                  </div>
                </div>
                {stockEntries.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                    {stockEntries.map(([sku, qty]) => (
                      <div key={sku} className="bg-slate-50 rounded-[18px] p-3">
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

        {/* ═══ TAB: TRANSFORMACIONES ═══ */}
        {tab === "trans" && (<>
          <button onClick={() => setTransModal(true)}
            className="w-full py-4 bg-cyan-700 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(14,116,144,0.16)] active:scale-[0.98] transition-transform">
            + Nueva transformación
          </button>

          {transformaciones.length === 0 ? (
            <div className="bg-white/78 rounded-[28px] p-8 text-center border border-slate-200/80">
              <p className="text-3xl mb-2">🧊</p>
              <p className="text-sm text-slate-400">Sin transformaciones registradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historial ({transformaciones.length})</h3>
              {transformaciones.slice().reverse().map(t => {
                const rend = Number(t.rendimiento || 0);
                const rendColor = rend >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : rend >= 65 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
                return (
                  <div key={t.id} className="bg-white/84 rounded-[22px] p-4 border border-slate-200/80 shadow-[0_8px_18px_rgba(8,19,27,0.04)]">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-slate-500">{t.folio || t.id} · {s(t.fecha).slice(0, 10)}</p>
                      <span className={`text-xs font-extrabold px-2 py-0.5 rounded-lg border ${rendColor}`}>{rend}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-slate-50 rounded-xl p-2">
                        <p className="text-slate-400 mb-0.5">Entrada</p>
                        <p className="font-extrabold text-slate-800">{Number(t.input_kg || 0)} kg</p>
                        <p className="text-slate-500 font-mono">{t.input_sku}</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-2">
                        <p className="text-red-400 mb-0.5">Merma</p>
                        <p className="font-extrabold text-red-700">{Number(t.merma_kg || 0)} kg</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-2">
                        <p className="text-emerald-600 mb-0.5">Salida</p>
                        <p className="font-extrabold text-emerald-800">{Number(t.output_kg || 0)} kg</p>
                        <p className="text-emerald-600 font-mono">{t.output_sku}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>)}

        <div className="h-8" />
      </div>

      {/* ═══ MODAL: Ya produje hielo ═══ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[90vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Producción</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">¿Qué produjiste?</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                <input type="number" inputMode="numeric" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setForm(f => ({ ...f, destino: s(cf.id) }))}
                      className={`py-3 rounded-xl text-xs font-bold border-2 ${form.destino === s(cf.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                      <p className="text-[10px] text-slate-400 mt-0.5">{n(cf.temp, -50, 10)}°C</p>
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
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Movimiento</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Mover entre congeladores</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">De</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setTForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2 rounded-xl text-xs font-bold border-2 ${tForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" inputMode="numeric" value={tForm.cantidad} onChange={e => setTForm(f => ({ ...f, cantidad: e.target.value }))}
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
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Salida</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-1">Sacar hielo</h3>
            <p className="text-sm text-slate-500 mb-4">{sacarModal.cfNombre}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setSacarForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${sacarForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" inputMode="numeric" value={sacarForm.cantidad} onChange={e => setSacarForm(f => ({ ...f, cantidad: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" autoFocus />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          <button onClick={() => { setMermaModal(true); clearFotoMerma(); setMForm({ sku: "HC-25K", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" }); }}
            className="w-full py-4 bg-[#8f2d22] text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(143,45,34,0.18)] active:scale-[0.98] transition-transform">
            Registrar merma
          </button>

          {mermasHoyList.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mermas de hoy ({mermasHoyList.length})</h3>
              {mermasHoyList.map(m => (
                <div key={m.id} className="bg-red-50/90 rounded-[20px] p-3 border border-red-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-red-700">{m.cantidad}× {m.sku}</p>
                      <p className="text-xs text-slate-500">{m.causa} · {m.origen} · {s(m.fecha) || 'Hoy'}</p>
                    </div>
                    {m.fotoUrl && <img src={m.fotoUrl} alt="Evidencia" className="w-10 h-10 object-cover rounded-lg border border-red-300" />}
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
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[85vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Merma</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Registrar merma</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                {fotoMermaPreview ? (
                  <div><img src={fotoMermaPreview} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={clearFotoMerma} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
                ) : (
                  <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                    <span className="text-lg">📷</span> Tomar foto de evidencia
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { clearFotoMerma(); setFotoMermaFile(f); setFotoMermaPreview(URL.createObjectURL(f)); } }} />
                  </label>
                )}
              </div>
            </div>
            <button onClick={registrarMerma} disabled={guardandoMerma || !mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile}
              className="w-full py-3.5 bg-red-500 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">
              {guardandoMerma ? 'Guardando...' : 'Registrar merma'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Transformación ═══ */}
      {transModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setTransModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[90vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Transformación</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Barras → Hielo triturado</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Qué entró? (Insumo)</label>
                {insumos.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Sin insumos registrados en el catálogo</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {insumos.map(p => (
                      <button key={p.sku} onClick={() => setTransForm(f => ({ ...f, input_sku: s(p.sku) }))}
                        className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 text-left ${transForm.input_sku === s(p.sku) ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-600"}`}>
                        <p>{s(p.nombre)}</p>
                        <p className="font-mono text-[10px] opacity-70">{s(p.sku)} · {Number(p.stock || 0)} kg stock</p>
                      </button>
                    ))}
                  </div>
                )}
                <input type="number" inputMode="decimal" value={transForm.input_kg} onChange={e => setTransForm(f => ({ ...f, input_kg: e.target.value }))}
                  className="w-full mt-2 px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="kg a transformar" />
                {transStockInput !== null && transInputKg > transStockInput && (
                  <p className="text-xs text-red-600 font-semibold mt-1 text-center">Stock insuficiente ({transStockInput} kg disponibles)</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Qué salió? (Producto)</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setTransForm(f => ({ ...f, output_sku: s(p.sku) }))}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 text-left ${transForm.output_sku === s(p.sku) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                    </button>
                  ))}
                </div>
                <input type="number" inputMode="decimal" value={transForm.output_kg} onChange={e => setTransForm(f => ({ ...f, output_kg: e.target.value }))}
                  className="w-full mt-2 px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="kg obtenidos" />
              </div>
              {transInputKg > 0 && transOutputKg > 0 && (
                <div className={`rounded-[18px] p-3 border ${transRendimiento >= 80 ? 'bg-emerald-50 border-emerald-200' : transRendimiento >= 65 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="text-slate-400">Entrada</p><p className="font-extrabold text-slate-800">{transInputKg} kg</p></div>
                    <div><p className="text-red-400">Merma</p><p className="font-extrabold text-red-700">{transMermaKg.toFixed(1)} kg</p></div>
                    <div><p className="text-slate-400">Rendimiento</p><p className={`font-extrabold ${transRendimiento >= 80 ? 'text-emerald-700' : transRendimiento >= 65 ? 'text-amber-700' : 'text-red-700'}`}>{transRendimiento}%</p></div>
                  </div>
                </div>
              )}
              <input type="text" value={transForm.notas} onChange={e => setTransForm(f => ({ ...f, notas: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm" placeholder="Notas (opcional)" />
            </div>
            <button onClick={registrarTransformacion}
              disabled={guardandoTrans || !transForm.input_sku || !transForm.output_sku || transInputKg <= 0 || transOutputKg <= 0 || transOutputKg > transInputKg || (transStockInput !== null && transInputKg > transStockInput)}
              className="w-full py-4 bg-cyan-700 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
              {guardandoTrans ? 'Guardando...' : 'Registrar transformación'}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-4 py-2.5 rounded-full text-sm font-semibold shadow-[0_18px_32px_rgba(5,150,105,0.24)]" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
