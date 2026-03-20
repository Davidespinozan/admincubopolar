import { useState, useMemo, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, s, n, fmtDate, useToast, reporteProduccion } from './viewsCommon';

export function ProduccionView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({turno:"Matutino",maquina:"Máquina 30",sku:"HC-25K",cantidad:""});

  const empaqueMap = {"HC-25K":"EMP-25","HC-5K":"EMP-5","HT-25K":"EMP-25","BH-50K":null};
  const bolsaNecesaria = empaqueMap[form.sku] || null;
  const stockBolsa = useMemo(() => {
    if (!bolsaNecesaria) return 999999;
    const p = data.productos.find(x => x.sku === bolsaNecesaria);
    return p ? n(p.stock) : 0;
  }, [data.productos, bolsaNecesaria]);

  const save = async () => {
    const e = {};
    if (!form.cantidad || n(form.cantidad) <= 0) e.cantidad = "Cantidad debe ser mayor a 0";
    if (bolsaNecesaria && n(form.cantidad) > stockBolsa) e.cantidad = "Stock insuficiente de " + bolsaNecesaria + " (" + stockBolsa + " disp.)";
    if (Object.keys(e).length) { setErrors(e); return; }
    const err = await actions.addProduccion(form);
    if (err) {
      toast?.error("No se pudo crear la orden de producción");
      return;
    }
    toast?.success("Orden creada: " + form.cantidad + " " + form.sku + " (consume " + form.cantidad + " " + (bolsaNecesaria||"N/A") + ")");
    setModal(false); setForm({turno:"Matutino",maquina:"Máquina 30",sku:"HC-25K",cantidad:""}); setErrors({});
  };

  // FIX P12: SKU options recreated every render
  const skuOptions = useMemo(() => data.productos.filter(p=>p.tipo==="Producto Terminado").map(p=>s(p.sku)), [data.productos]);
  const { totalProd, enProceso, confirmadas } = useMemo(() => {
    let total = 0, proc = 0, conf = 0;
    for (const p of data.produccion) {
      total += n(p.cantidad);
      if (p.estatus === "En proceso") proc++;
      else if (p.estatus === "Confirmada") conf++;
    }
    return { totalProd: total, enProceso: proc, confirmadas: conf };
  }, [data.produccion]);

  const exportBtns = <>
    <button onClick={() => reporteProduccion(data.produccion, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteProduccion(data.produccion, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    <PageHeader title="Producir hielo" subtitle="Crear y confirmar producción" action={()=>{setModal(true);setErrors({})}} actionLabel="Nueva orden" extraButtons={exportBtns} />
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
      <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-3 sm:p-5 text-white"><p className="text-[10px] sm:text-xs font-semibold text-blue-100 uppercase mb-1">Producido</p><p className="text-xl sm:text-3xl font-extrabold">{totalProd.toLocaleString()}</p><p className="text-[10px] sm:text-xs text-blue-200 mt-0.5">bolsas</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">En proceso</p><p className="text-xl sm:text-3xl font-extrabold text-amber-600">{enProceso}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Confirmadas</p><p className="text-xl sm:text-3xl font-extrabold text-emerald-600">{confirmadas}</p></div>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <DataTable columns={[
        {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-semibold text-blue-600">{s(v)}</span>},
        {key:"fecha",label:"Fecha",render:v=>fmtDate(v),hideOnMobile:true},{key:"turno",label:"Turno",hideOnMobile:true},{key:"maquina",label:"Máquina",bold:true},
        {key:"sku",label:"SKU",render:v=><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-md">{s(v)}</span>},
        {key:"cantidad",label:"Qty",render:v=><span className="font-semibold">{n(v).toLocaleString()}</span>},
        {key:"estatus",label:"Estatus",badge:true,render:(v,r)=><div className="flex items-center gap-2"><StatusBadge status={v}/><span className="hidden md:inline">{v==="En proceso"&&<button onClick={(e)=>{e.stopPropagation();actions.confirmarProduccion(r.id)}} className="text-xs text-blue-600 font-semibold hover:text-blue-800 px-2.5 py-0.5">Confirmar ✓</button>}</span></div>},
      ]} data={data.produccion}
      cardSubtitle={r => <div>
        <span className="text-xs text-slate-400">{fmtDate(r.fecha)} · {s(r.turno)} · {s(r.sku)}</span>
        {r.estatus==="En proceso"&&<button onClick={(e)=>{e.stopPropagation();actions.confirmarProduccion(r.id)}} className="mt-2 w-full text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg min-h-[44px]">Confirmar producción ✓</button>}
      </div>}
      />
    </div>
    <Modal open={modal} onClose={()=>setModal(false)} title="Nueva orden de producción">
      <div className="space-y-3">
        <FormSelect label="Turno" options={["Matutino","Vespertino"]} value={form.turno} onChange={e=>setForm({...form,turno:e.target.value})} />
        <FormSelect label="Máquina" options={["Máquina 30","Máquina 20","Máquina 15"]} value={form.maquina} onChange={e=>setForm({...form,maquina:e.target.value})} />
        <FormSelect label="SKU" options={skuOptions} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} />
        <FormInput label="Cantidad *" type="number" value={form.cantidad} onChange={e=>setForm({...form,cantidad:e.target.value})} placeholder="Ej: 500" error={errors.cantidad} />
        {bolsaNecesaria && (
          <div className={`p-3 rounded-xl ${n(form.cantidad) > stockBolsa ? "bg-red-50" : "bg-blue-50"}`}>
            <p className="text-xs font-semibold text-slate-700">Consumo de empaque:</p>
            <p className="text-sm font-bold mt-1">{form.cantidad || 0} {bolsaNecesaria}</p>
            <p className={`text-xs mt-1 ${n(form.cantidad) > stockBolsa ? "text-red-600 font-bold" : "text-slate-500"}`}>
              Stock disponible: {stockBolsa.toLocaleString()} {n(form.cantidad) > stockBolsa ? " — INSUFICIENTE" : ""}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Crear orden</FormBtn></div>
    </Modal>
  </div>);
}
