import { useState, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, n, useToast, today, reporteFinanciero, PAGE_SIZE } from './viewsCommon';

export function ContabilidadView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [showAll, setShowAll] = useState(false);
  const [modal, setModal] = useState(null);
  const empty = { tipo: "Egreso", categoria: "Proveedores", concepto: "", monto: "", fecha: today() };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});

  const cont = data.contabilidad || { ingresos: [], egresos: [] };
  const totalIngresos = cont.ingresos.reduce((s, i) => s + n(i.monto), 0);
  const totalEgresos = cont.egresos.reduce((s, e) => s + n(e.monto), 0);
  const balance = totalIngresos - totalEgresos;

  const CATS_INGRESO = ["Ventas", "Cobranza", "Otro ingreso"];
  const CATS_EGRESO = ["Proveedores", "Combustible", "Servicios", "Mantenimiento", "Nómina", "Impuestos", "Renta", "Otro gasto"];

  const openNew = (tipo) => { setForm({ ...empty, tipo }); setErrors({}); setModal("new"); };

  const save = async () => {
    const e = {};
    if (!form.concepto.trim()) e.concepto = "Requerido";
    if (!form.monto || parseFloat(form.monto) <= 0) e.monto = "Mayor a 0";
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      await actions.addMovContable({ ...form, monto: parseFloat(form.monto) });
      toast?.success(form.tipo === "Ingreso" ? "Ingreso registrado" : "Gasto registrado");
      setModal(null);
    } catch(ex) { toast?.error('Error: ' + (ex?.message || 'No se pudo guardar')); }
  };

  const egresosPorCat = {};
  for (const e of cont.egresos) {
    const cat = s(e.categoria) || "Otro";
    egresosPorCat[cat] = (egresosPorCat[cat] || 0) + n(e.monto);
  }

  const todos = [...cont.ingresos.map(i => ({ ...i, _tipo: "Ingreso" })), ...cont.egresos.map(e => ({ ...e, _tipo: "Egreso" }))].sort((a, b) => (b.id || 0) - (a.id || 0));

  return (<div className="space-y-4">
    {ConfirmEl}
    <div className="flex items-center justify-between flex-wrap gap-2">
      <h2 className="text-lg font-bold text-slate-800">Ingresos / Egresos</h2>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => reporteFinanciero(cont, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
        <button onClick={() => reporteFinanciero(cont, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
        <button onClick={() => openNew("Ingreso")} className="px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Ingreso</button>
        <button onClick={() => openNew("Egreso")} className="px-3 py-2 bg-red-500 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Gasto</button>
      </div>
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div className="bg-emerald-50 rounded-xl p-3 sm:p-4 border border-emerald-200">
        <p className="text-[10px] text-emerald-500 uppercase font-bold">Ingresos</p>
        <p className="text-lg sm:text-xl font-extrabold text-emerald-700">${totalIngresos.toLocaleString()}</p>
      </div>
      <div className="bg-red-50 rounded-xl p-3 sm:p-4 border border-red-200">
        <p className="text-[10px] text-red-500 uppercase font-bold">Egresos</p>
        <p className="text-lg sm:text-xl font-extrabold text-red-600">${totalEgresos.toLocaleString()}</p>
      </div>
      <div className={`col-span-2 sm:col-span-1 rounded-xl p-3 sm:p-4 border ${balance >= 0 ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}`}>
        <p className="text-[10px] text-slate-500 uppercase font-bold">Balance</p>
        <p className={`text-xl font-extrabold ${balance >= 0 ? "text-blue-700" : "text-red-600"}`}>${balance.toLocaleString()}</p>
      </div>
    </div>

    {Object.keys(egresosPorCat).length > 0 && (
      <div className="bg-white rounded-xl p-4 border border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Egresos por categoría</h3>
        {Object.entries(egresosPorCat).sort((a, b) => b[1] - a[1]).map(([cat, monto]) => (
          <div key={cat} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
            <span className="text-sm text-slate-600">{cat}</span>
            <span className="text-sm font-bold text-slate-800">${monto.toLocaleString()}</span>
          </div>
        ))}
      </div>
    )}

    <div>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Movimientos recientes</h3>
      {todos.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin movimientos. Usa los botones + Ingreso o + Gasto para registrar.</p>}
      <div className="space-y-1.5">
        {(showAll ? todos : todos.slice(0, PAGE_SIZE)).map(m => (
          <div key={m.id} className={`rounded-lg p-3 border overflow-hidden ${m._tipo === "Ingreso" ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
            <div className="flex justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700 min-w-0 truncate">{s(m.concepto)}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-sm font-bold ${m._tipo === "Ingreso" ? "text-emerald-700" : "text-red-600"}`}>{m._tipo === "Ingreso" ? "+" : "-"}${n(m.monto).toLocaleString()}</span>
                <button onClick={() => askConfirm('Eliminar movimiento','¿Eliminar este movimiento contable?',()=>actions.deleteMovContable(m.id),true)} className="text-red-400 hover:text-red-600 text-xs p-1">✕</button>
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400">{s(m.fecha)}</span>
              <span className={`text-xs ${m._tipo === "Ingreso" ? "text-emerald-600" : "text-red-500"}`}>{s(m.categoria)}</span>
            </div>
          </div>
        ))}
      </div>
      {!showAll && todos.length > PAGE_SIZE && <button onClick={() => setShowAll(true)} className="mt-2 w-full text-center text-xs text-blue-600 font-semibold py-2">Ver todos ({todos.length} movimientos)</button>}
    </div>

    <Modal open={!!modal} onClose={() => setModal(null)} title={form.tipo === "Ingreso" ? "Registrar ingreso" : "Registrar gasto"}>
      <div className="space-y-3">
        <FormInput label="Fecha" type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
        <FormSelect label="Categoría" options={form.tipo === "Ingreso" ? CATS_INGRESO : CATS_EGRESO} value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
        <FormInput label="Concepto *" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} placeholder="Ej: Pago de diesel ruta norte" error={errors.concepto} />
        <FormInput label="Monto *" type="number" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} placeholder="0.00" error={errors.monto} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>{form.tipo === "Ingreso" ? "Registrar ingreso" : "Registrar gasto"}</FormBtn></div>
    </Modal>
  </div>);
}
