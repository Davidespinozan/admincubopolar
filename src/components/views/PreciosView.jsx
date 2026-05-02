import { useState, useMemo, PageHeader, EmptyState, Modal, FormInput, FormSelect, FormBtn, s, n, eqId, fmtMoney, fmtPct, useToast, useConfirm, Icons } from './viewsCommon';

export function PreciosView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(false); // false | "new" | <preciosEsp obj>
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({clienteId:"",sku:"",precio:""});
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setForm({ clienteId: "", sku: "", precio: "" });
    setErrors({});
    setModal("new");
  };

  const openEdit = (p) => {
    setForm({
      clienteId: String(p.clienteId || p.cliente_id || ""),
      sku: s(p.sku),
      precio: String(n(p.precio)),
    });
    setErrors({});
    setModal(p);
  };

  // FIX P10: data.productos.filter(p=>p.tipo==="Producto Terminado") was called 3 times
  // in render: once for empty check, once for list, once for modal select options.
  // With 200 productos: 600 iterations per render.
  const prodTerminados = useMemo(() => data.productos.filter(p => p.tipo === "Producto Terminado"), [data.productos]);
  // Build select options once
  const prodOptions = useMemo(() => [{value:"",label:"Seleccionar..."},...prodTerminados.map(p=>({value:s(p.sku),label:`${s(p.sku)} — $${n(p.precio)}`}))], [prodTerminados]);
  const clienteOptions = useMemo(() => [{value:"",label:"Seleccionar..."},...(data.clientes || []).filter(c=>c.tipo!=="General").map(c=>({value:String(c.id),label:s(c.nombre)}))], [data.clientes]);

  // P16: data.productos.find() inside data.preciosEsp.map() = O(n×m)
  // With 200 preciosEsp × 200 productos = 40,000 .find iterations per render.
  // Build a lookup map: O(n) + O(m) = O(n+m)
  const precioBaseMap = useMemo(() => {
    const m = {};
    for (const p of data.productos) m[p.sku] = n(p.precio);
    return m;
  }, [data.productos]);

  const save = async () => {
    if (saving) return;
    const e = {};
    if (modal === "new" && !form.clienteId) e.clienteId = "Requerido";
    if (modal === "new" && !form.sku) e.sku = "Requerido";
    if (!form.precio || n(form.precio) <= 0) e.precio = "Precio debe ser mayor a 0";
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      let err;
      if (modal === "new") {
        const cli = data.clientes.find(c => eqId(c.id, form.clienteId));
        err = await actions.addPrecioEsp({clienteId:form.clienteId,clienteNom:s(cli?.nombre),sku:form.sku,precio:form.precio});
      } else {
        err = await actions.updatePrecioEsp(modal.id, { precio: form.precio });
      }
      if (err && (err.error || err.message || err.code)) {
        toast?.error(err.error || err.message || (modal === "new" ? "No se pudo crear el precio especial" : "No se pudo actualizar el precio"));
        return;
      }
      toast?.success(modal === "new" ? "Precio especial creado" : "Precio actualizado");
      setModal(false); setForm({clienteId:"",sku:"",precio:""}); setErrors({});
    } finally {
      setSaving(false);
    }
  };

  return (<div>
    {ConfirmEl}
    <PageHeader title="Precios por Cliente" subtitle="Precio público + overrides" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">Precio público general</h3>
        {prodTerminados.length === 0
          ? <EmptyState message="Sin productos terminados" />
          : prodTerminados.map(p=><div key={p.id} className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2"><div className="min-w-0"><span className="text-sm font-semibold text-slate-700 truncate block">{s(p.nombre)}</span><span className="text-xs text-slate-400 ml-0">{s(p.sku)}</span></div><span className="text-sm font-bold flex-shrink-0">{fmtMoney(p.precio, { decimals: 2 })}</span></div>)}
      </div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">Precios especiales</h3>
        {(data.preciosEsp || []).length === 0 && <EmptyState message="Sin precios especiales" />}
        {data.preciosEsp.map(p=>{const base=precioBaseMap[p.sku]||0;const desc=base>0?Math.round(((base-n(p.precio))/base)*100):0;
          return<div key={p.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><span className="text-sm font-semibold text-slate-700 truncate block">{s(p.clienteNom)}</span><span className="text-xs text-slate-400">{s(p.sku)}</span></div><div className="flex items-center gap-2 flex-shrink-0"><span className="text-sm font-bold text-blue-600">{fmtMoney(p.precio, { decimals: 2 })}</span>{desc>0&&<span className="text-xs text-emerald-600">{"-" + fmtPct(desc, 100)}</span>}<button onClick={()=>openEdit(p)} title="Editar precio" aria-label="Editar precio especial" className="text-sm text-slate-500 hover:text-blue-600 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center">✏️</button><button onClick={()=>askConfirm('Eliminar precio especial', `¿Seguro que quieres eliminar el precio especial de ${s(p.clienteNom || 'este cliente')} para ${s(p.sku)}?`, async () => { await actions.deletePrecioEsp(p.id); }, true)} className="text-xs text-red-400 hover:text-red-600 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center" title="Eliminar" aria-label="Eliminar precio especial">✕</button></div></div></div>})}
        <button onClick={openNew} className="mt-3 w-full py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-400 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-1 min-h-[44px]"><Icons.Plus /> Agregar</button>
      </div>
    </div>
    <Modal open={!!modal} onClose={()=>setModal(false)} title={modal === "new" ? "Nuevo precio especial" : "Editar precio especial"}>
      <div className="space-y-3">
        <FormSelect label="Cliente *" options={clienteOptions} value={form.clienteId} onChange={e=>setForm({...form,clienteId:e.target.value})} error={errors.clienteId} disabled={modal !== "new"} />
        <FormSelect label="Producto *" options={prodOptions} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} error={errors.sku} disabled={modal !== "new"} />
        {modal !== "new" && (
          <p className="text-xs text-slate-500 -mt-2">
            Para cambiar cliente o producto, borra este precio y agrega uno nuevo.
          </p>
        )}
        <FormInput label="Precio especial ($) *" type="number" value={form.precio} onChange={e=>setForm({...form,precio:e.target.value})} placeholder="Ej: 78" error={errors.precio} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save} loading={saving}>{modal === "new" ? "Guardar" : "Guardar cambios"}</FormBtn></div>
    </Modal>
  </div>);
}
