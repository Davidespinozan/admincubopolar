import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, n, eqId, useDebounce, useToast, reporteClientes, PAGE_SIZE, Paginator } from './viewsCommon';

export function ClientesView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [geocoding, setGeocoding] = useState(false);
  const empty = { nombre:"",rfc:"",regimen:"Régimen General",usoCfdi:"G03",cp:"",correo:"",tipo:"Tienda",contacto:"",calle:"",colonia:"",ciudad:"Hermosillo",zona:"",latitud:"",longitud:"",creditoAutorizado:false,limiteCredito:"" };
  const [form, setForm] = useState(empty);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (c) => { setForm({ nombre:s(c.nombre),rfc:s(c.rfc),regimen:s(c.regimen)||"Régimen General",usoCfdi:s(c.usoCfdi)||"G03",cp:s(c.cp),correo:s(c.correo),tipo:s(c.tipo),contacto:s(c.contacto),calle:s(c.calle),colonia:s(c.colonia),ciudad:s(c.ciudad)||"Hermosillo",zona:s(c.zona),latitud:c.latitud||"",longitud:c.longitud||"",creditoAutorizado:c.credito_autorizado||false,limiteCredito:c.limite_credito||"" }); setErrors({}); setModal(c); };

    const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.rfc.trim()) e.rfc = "Requerido";
    if (form.rfc.trim() && (form.rfc.length < 12 || form.rfc.length > 13)) e.rfc = "RFC debe tener 12-13 caracteres";
    if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = "Email inválido";
    if (form.cp.trim() && !/^\d{5}$/.test(form.cp)) e.cp = "CP debe ser 5 dígitos";
    if (Object.keys(e).length) { setErrors(e); return; }
    const err = modal === "new"
      ? await actions.addCliente(form)
      : await actions.updateCliente(modal.id, form);
    if (err) {
      toast?.error(modal === "new" ? "No se pudo crear el cliente" : "No se pudo actualizar el cliente");
      return;
    }
    toast?.success(modal === "new" ? "Cliente creado" : "Cliente actualizado");
    setModal(null);
  };

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return (data.clientes || []).filter(c => {
      const ms = !q || s(c.nombre).toLowerCase().includes(q) || s(c.rfc).toLowerCase().includes(q);
      const mt = !filterTipo || c.tipo === filterTipo;
      return ms && mt;
    });
  }, [data.clientes, dSearch, filterTipo]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const exportBtns = <>
    <button onClick={() => reporteClientes(data.clientes, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteClientes(data.clientes, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    {ConfirmEl}
    <PageHeader title="Clientes" subtitle={`${(data.clientes || []).length} registrados`} action={openNew} actionLabel="Nuevo cliente" extraButtons={exportBtns} />
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5 md:p-5">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 mb-4">
        <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar nombre o RFC..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
        <select value={filterTipo} onChange={e=>{setFilterTipo(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 focus:outline-none focus:border-blue-400 min-h-[44px] min-w-[140px] sm:min-w-0"><option value="">Todos los tipos</option>{["Tienda","Restaurante","Cadena","Hotel","Nevería","General"].map(t=><option key={t}>{t}</option>)}</select>
      </div>
      <DataTable columns={[
        {key:"nombre",label:"Cliente",bold:true},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"tipo",label:"Tipo"},{key:"contacto",label:"Contacto"},
        {key:"saldo",label:"Saldo",bold:true,render:v=>v?`$${n(v).toLocaleString()}`:"$0"},
        {key:"credito_autorizado",label:"Crédito",render:(_,row)=>row.credito_autorizado?<span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">✓ ${n(row.limite_credito).toLocaleString()}</span>:<span className="text-xs text-slate-400">—</span>},
        {key:"estatus",label:"Estatus",badge:true,render:v=><StatusBadge status={v}/>},
      ]} data={paginated} onRowClick={r=>openEdit(r)} />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
    <Modal open={!!modal} onClose={()=>setModal(null)} title={modal==="new"?"Nuevo Cliente":"Editar Cliente"} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormInput label="Razón social *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} error={errors.nombre} />
        <FormInput label="RFC *" value={form.rfc} onChange={e=>setForm({...form,rfc:e.target.value.toUpperCase()})} maxLength={13} error={errors.rfc} />
        <FormSelect label="Régimen fiscal" options={["Régimen General","Régimen Simplificado","Sin obligaciones"]} value={form.regimen} onChange={e=>setForm({...form,regimen:e.target.value})} />
        <FormSelect label="Uso CFDI" options={["G01","G03","S01","P01"]} value={form.usoCfdi} onChange={e=>setForm({...form,usoCfdi:e.target.value})} />
        <FormInput label="Código postal" value={form.cp} onChange={e=>setForm({...form,cp:e.target.value})} maxLength={5} />
        <FormInput label="Correo" type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} />
        <FormSelect label="Tipo" options={["Tienda","Restaurante","Cadena","Hotel","Nevería","General","Otro"]} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})} />
        <FormInput label="Teléfono" value={form.contacto} onChange={e=>setForm({...form,contacto:e.target.value})} />
      </div>
      <div className="border-t border-slate-200 pt-4 mt-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">📍 Dirección para rutas</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput label="Calle y número" value={form.calle} onChange={e=>setForm({...form,calle:e.target.value})} placeholder="Av. Revolución #123" />
          <FormInput label="Colonia" value={form.colonia} onChange={e=>setForm({...form,colonia:e.target.value})} placeholder="Centro" />
          <FormInput label="Ciudad" value={form.ciudad} onChange={e=>setForm({...form,ciudad:e.target.value})} />
          <FormSelect label="Zona" options={["","Centro","Norte","Sur","Oriente","Poniente","Industrial","Periférico Norte","Periférico Sur"]} value={form.zona} onChange={e=>setForm({...form,zona:e.target.value})} />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-slate-500">Coordenadas:</span>
          <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{form.latitud && form.longitud ? `${form.latitud}, ${form.longitud}` : "Sin geocodificar"}</span>
          {form.calle && form.colonia && <button type="button" disabled={geocoding} onClick={async()=>{ setGeocoding(true); const geo=await import('../../utils/geocoding.js').then(m=>m.geocodeDireccion(`${form.calle}, ${form.colonia}, ${form.ciudad||'Hermosillo'}, Sonora, México`)); if(geo){ setForm(f=>({...f,latitud:geo.lat,longitud:geo.lng})); toast?.success('Ubicación obtenida'); } else { toast?.error('No se pudo geocodificar'); } setGeocoding(false); }} className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg disabled:opacity-50">{geocoding?'Buscando...':'📍 Obtener ubicación'}</button>}
        </div>
      </div>
      <div className="border-t border-slate-200 pt-4 mt-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">💳 Crédito</h4>
        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-200 mb-3">
          <div><p className="text-sm font-semibold text-slate-700">Crédito autorizado</p><p className="text-xs text-slate-400">Permite marcar pedidos "a crédito" sin cobro inmediato</p></div>
          <button type="button" onClick={()=>setForm(f=>({...f,creditoAutorizado:!f.creditoAutorizado}))}
            className={`w-12 h-7 rounded-full transition-all relative flex-shrink-0 ${form.creditoAutorizado?"bg-emerald-500":"bg-slate-300"}`}>
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${form.creditoAutorizado?"left-[22px]":"left-0.5"}`} />
          </button>
        </div>
        {form.creditoAutorizado && (
          <FormInput label="Límite de crédito ($)" type="number" value={form.limiteCredito} onChange={e=>setForm({...form,limiteCredito:e.target.value})} placeholder="0.00" />
        )}
      </div>
      <div className="space-y-3 border-t border-slate-200 pt-4 mt-5">
        {modal !== "new" && (
          <button onClick={() => askConfirm("Desactivar cliente", `¿Desactivar "${s(modal.nombre)}"?`, async () => {
              const err = await actions.updateCliente(modal.id, { estatus: "Inactivo" });
              if (err) { toast?.error("No se pudo desactivar el cliente"); return; }
              toast?.success("Cliente desactivado");
              setModal(null);
            }, true)} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors">
            🗑 Desactivar cliente
          </button>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}
