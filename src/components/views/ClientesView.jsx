import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, fmtMoney, useDebounce, useToast, reporteClientes, PAGE_SIZE, Paginator } from './viewsCommon';
import AddressAutocomplete from '../ui/AddressAutocomplete';

export function ClientesView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterEstatus, setFilterEstatus] = useState("Activos"); // Activos | Inactivos | Todos
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [geocoding, setGeocoding] = useState(false);
  const empty = { nombre:"",nombreComercial:"",rfc:"",regimen:"Régimen General",usoCfdi:"G03",cp:"",correo:"",tipo:"Tienda",contacto:"",calle:"",colonia:"",ciudad:"Durango",zona:"",latitud:"",longitud:"",creditoAutorizado:false,limiteCredito:"" };
  const [form, setForm] = useState(empty);
  const [step, setStep] = useState(1);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setStep(1); setModal("new"); };
  const openEdit = (c) => { setForm({ nombre:s(c.nombre),nombreComercial:s(c.nombreComercial||c.nombre_comercial),rfc:s(c.rfc),regimen:s(c.regimen)||"Régimen General",usoCfdi:s(c.usoCfdi)||"G03",cp:s(c.cp),correo:s(c.correo),tipo:s(c.tipo),contacto:s(c.contacto),calle:s(c.calle),colonia:s(c.colonia),ciudad:s(c.ciudad)||"Durango",zona:s(c.zona),latitud:c.latitud||"",longitud:c.longitud||"",creditoAutorizado:c.credito_autorizado||false,limiteCredito:c.limite_credito||"" }); setErrors({}); setStep(1); setModal(c); };

  const validateStep = (currentStep) => {
    const e = {};
    if (currentStep === 1) {
      if (!form.nombre.trim()) e.nombre = "Requerido";
      if (!form.rfc.trim()) e.rfc = "Requerido";
      if (form.rfc.trim() && (form.rfc.length < 12 || form.rfc.length > 13)) e.rfc = "RFC debe tener 12-13 caracteres";
    }
    if (currentStep === 2) {
      if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = "Email inválido";
      if (form.cp.trim() && !/^\d{5}$/.test(form.cp)) e.cp = "CP debe ser 5 dígitos";
    }
    return e;
  };

  const nextStep = () => {
    const e = validateStep(step);
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setStep(step + 1);
  };

  const prevStep = () => {
    setErrors({});
    setStep(step - 1);
  };

    const save = async () => {
    if (saving) return;
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.rfc.trim()) e.rfc = "Requerido";
    if (form.rfc.trim() && (form.rfc.length < 12 || form.rfc.length > 13)) e.rfc = "RFC debe tener 12-13 caracteres";
    if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = "Email inválido";
    if (form.cp.trim() && !/^\d{5}$/.test(form.cp)) e.cp = "CP debe ser 5 dígitos";
    if (Object.keys(e).length) {
      // Si hay error en un campo de otro paso, regresar al paso correcto con el campo en rojo
      if (e.nombre || e.rfc || e.correo) setStep(1);
      else if (e.cp) setStep(2);
      setErrors(e);
      toast?.error('Revisa los campos marcados en rojo');
      return;
    }
    setSaving(true);
    try {
      const err = modal === "new"
        ? await actions.addCliente(form)
        : await actions.updateCliente(modal.id, form);
      if (err && (err.message || err.code)) {
        toast?.error(modal === "new" ? "No se pudo crear el cliente" : "No se pudo actualizar el cliente");
        return;
      }
      toast?.success(modal === "new" ? "Cliente creado" : "Cliente actualizado");
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const toggleEstatus = (c) => {
    const esActivo = s(c.estatus) !== "Inactivo";
    askConfirm(
      esActivo ? "Desactivar cliente" : "Activar cliente",
      esActivo
        ? `¿Desactivar a "${s(c.nombre)}"? Su histórico se conserva, ya no aparecerá en listas activas.`
        : `¿Activar a "${s(c.nombre)}"?`,
      async () => {
        const err = await actions.updateCliente(c.id, { estatus: esActivo ? "Inactivo" : "Activo" });
        if (err && (err.message || err.code)) {
          toast?.error(esActivo ? "No se pudo desactivar" : "No se pudo activar");
          return;
        }
        toast?.success(esActivo ? "Cliente desactivado" : "Cliente activado");
      },
      esActivo
    );
  };

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return (data.clientes || []).filter(c => {
      const ms = !q || s(c.nombre).toLowerCase().includes(q) || s(c.nombre_comercial).toLowerCase().includes(q) || s(c.rfc).toLowerCase().includes(q);
      const mt = !filterTipo || c.tipo === filterTipo;
      const inactivo = s(c.estatus) === "Inactivo";
      const me = filterEstatus === "Todos"
        || (filterEstatus === "Activos" && !inactivo)
        || (filterEstatus === "Inactivos" && inactivo);
      return ms && mt && me;
    });
  }, [data.clientes, dSearch, filterTipo, filterEstatus]);

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
        <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar nombre, comercial o RFC..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
        <select value={filterTipo} onChange={e=>{setFilterTipo(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 focus:outline-none focus:border-blue-400 min-h-[44px] min-w-[140px] sm:min-w-0"><option value="">Todos los tipos</option>{["Tienda","Restaurante","Cadena","Hotel","Nevería","General"].map(t=><option key={t}>{t}</option>)}</select>
        <select value={filterEstatus} onChange={e=>{setFilterEstatus(e.target.value);setPage(0)}} className="px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white min-h-[44px]">
          <option value="Activos">Activos</option>
          <option value="Inactivos">Inactivos</option>
          <option value="Todos">Todos</option>
        </select>
      </div>
      <DataTable columns={[
        {key:"nombre",label:"Cliente",bold:true,render:(_,row)=><div><span className="font-semibold">{s(row.nombre)}</span>{row.nombre_comercial&&<span className="block text-xs text-slate-400">{s(row.nombre_comercial)}</span>}</div>},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"tipo",label:"Tipo"},{key:"contacto",label:"Contacto"},
        {key:"saldo",label:"Saldo",bold:true,render:v=>v?fmtMoney(v):"$0"},
        {key:"credito_autorizado",label:"Crédito",render:(_,row)=>row.credito_autorizado?<span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{"✓ " + fmtMoney(row.limite_credito)}</span>:<span className="text-xs text-slate-400">—</span>},
        {key:"estatus",label:"Estatus",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"acciones",label:"",render:(_,row)=>{
          const esActivo = s(row.estatus) !== "Inactivo";
          return <div className="flex gap-1 justify-end" onClick={(e)=>e.stopPropagation()}>
            <button
              onClick={()=>openEdit(row)}
              aria-label="Editar cliente"
              title="Editar"
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
            >
              <Icons.Edit />
            </button>
            <button
              onClick={()=>toggleEstatus(row)}
              aria-label={esActivo ? "Desactivar cliente" : "Activar cliente"}
              title={esActivo ? "Desactivar" : "Activar"}
              className={`p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg transition-colors ${esActivo ? "text-red-500 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"}`}
            >
              {esActivo ? <span className="text-base leading-none">⏸</span> : <Icons.UserCheck />}
            </button>
          </div>;
        }},
      ]} data={paginated} onRowClick={r=>openEdit(r)}
        emptyMessage={(search?.trim() || filterTipo) ? "Sin resultados" : "Aún no tienes clientes"}
        emptyHint={(search?.trim() || filterTipo) ? "Intenta con otra búsqueda o limpia los filtros" : "Crea tu primer cliente con el botón de arriba"}
        emptyCta={(search?.trim() || filterTipo) ? "Limpiar filtros" : "+ Nuevo cliente"}
        onEmptyCta={(search?.trim() || filterTipo) ? () => { setSearch(''); setFilterTipo(''); setPage(0); } : openNew}
      />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
    <Modal open={!!modal} onClose={()=>setModal(null)} title={modal==="new"?"Nuevo Cliente":"Editar Cliente"} wide>
      {/* Indicador de pasos */}
      <div className="flex items-center gap-2 mb-5">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              step === n ? 'bg-slate-900 text-white' :
              step > n ? 'bg-emerald-500 text-white' :
              'bg-slate-100 text-slate-400'
            }`}>
              {step > n ? '✓' : n}
            </div>
            <div className="flex-1">
              <p className={`text-xs font-semibold ${step === n ? 'text-slate-900' : 'text-slate-400'}`}>
                {n === 1 ? 'Datos básicos' : n === 2 ? 'Dirección' : 'Crédito'}
              </p>
              {n === 1 && <p className="text-[10px] text-slate-400">Requerido</p>}
              {n !== 1 && <p className="text-[10px] text-slate-400">Opcional</p>}
            </div>
            {n < 3 && <div className={`h-0.5 flex-1 ${step > n ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* PASO 1: Datos básicos */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput label="Razón social *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} error={errors.nombre} />
            <FormInput label="Nombre comercial" value={form.nombreComercial} onChange={e=>setForm({...form,nombreComercial:e.target.value})} placeholder="Ej: Nevería Don Pedro" />
            <FormInput label="RFC *" value={form.rfc} onChange={e=>setForm({...form,rfc:e.target.value.toUpperCase()})} maxLength={13} error={errors.rfc} />
            <FormSelect label="Tipo" options={["Tienda","Restaurante","Cadena","Hotel","Nevería","General","Otro"]} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})} />
            <FormInput label="Teléfono" value={form.contacto} onChange={e=>setForm({...form,contacto:e.target.value})} />
            <FormInput label="Correo" type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 font-semibold hover:text-slate-700">
              ⚙️ Datos fiscales avanzados (opcional)
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
              <FormSelect label="Régimen fiscal" options={["Régimen General","Régimen Simplificado","Sin obligaciones"]} value={form.regimen} onChange={e=>setForm({...form,regimen:e.target.value})} />
              <FormSelect label="Uso CFDI" options={["G01","G03","S01","P01"]} value={form.usoCfdi} onChange={e=>setForm({...form,usoCfdi:e.target.value})} />
            </div>
          </details>
        </div>
      )}

      {/* PASO 2: Dirección */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Para que el chofer encuentre al cliente y se pueda mostrar en el mapa de rutas.</p>

          <AddressAutocomplete onSelect={(addr) => {
            setForm(f => ({
              ...f,
              calle: addr.calle || f.calle,
              colonia: addr.colonia || f.colonia,
              ciudad: addr.ciudad || f.ciudad,
              cp: addr.cp || f.cp,
              latitud: addr.lat ?? f.latitud,
              longitud: addr.lng ?? f.longitud,
            }));
            toast?.success('Dirección capturada');
          }} />

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 font-semibold hover:text-slate-700">
              ✏️ Editar campos manualmente
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
              <FormInput label="Calle y número" value={form.calle} onChange={e=>setForm({...form,calle:e.target.value})} placeholder="Av. Revolución #123" />
              <FormInput label="Colonia" value={form.colonia} onChange={e=>setForm({...form,colonia:e.target.value})} placeholder="Centro" />
              <FormInput label="Ciudad" value={form.ciudad} onChange={e=>setForm({...form,ciudad:e.target.value})} />
              <FormSelect label="Zona" options={["","Centro","Norte","Sur","Oriente","Poniente","Industrial","Periférico Norte","Periférico Sur"]} value={form.zona} onChange={e=>setForm({...form,zona:e.target.value})} />
              <FormInput label="Código postal" value={form.cp} onChange={e=>setForm({...form,cp:e.target.value})} maxLength={5} error={errors.cp} />
            </div>
          </details>

          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
            <span className="text-xs text-slate-500">📍 Ubicación GPS:</span>
            <span className="text-xs font-mono bg-white px-2 py-1 rounded">{form.latitud && form.longitud ? `${Number(form.latitud).toFixed(5)}, ${Number(form.longitud).toFixed(5)}` : "Sin coordenadas"}</span>
            {form.calle && form.colonia && !form.latitud && (
              <button type="button" disabled={geocoding} onClick={async()=>{
                setGeocoding(true);
                const geo=await import('../../utils/geocoding.js').then(m=>m.geocodeDireccion(`${form.calle}, ${form.colonia}, ${form.ciudad||'Durango'}, Durango, México`));
                if(geo){ setForm(f=>({...f,latitud:geo.lat,longitud:geo.lng})); toast?.success('Ubicación obtenida'); }
                else { toast?.error('No se pudo geocodificar'); }
                setGeocoding(false);
              }} className="ml-auto text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg disabled:opacity-50">
                {geocoding?'Buscando...':'Obtener'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* PASO 3: Crédito */}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 mb-2">Si autorizas crédito, podrás vender al cliente sin cobro inmediato y se llevará registro de saldo.</p>
          <div className="flex items-center justify-between bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-700">Crédito autorizado</p>
              <p className="text-xs text-slate-400 mt-0.5">Permite marcar pedidos "a crédito"</p>
            </div>
            <button type="button" onClick={()=>setForm(f=>({...f,creditoAutorizado:!f.creditoAutorizado}))}
              className={`w-12 h-7 rounded-full transition-all relative flex-shrink-0 ${form.creditoAutorizado?"bg-emerald-500":"bg-slate-300"}`}>
              <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${form.creditoAutorizado?"left-[22px]":"left-0.5"}`} />
            </button>
          </div>
          {form.creditoAutorizado && (
            <FormInput label="Límite de crédito ($)" type="number" value={form.limiteCredito} onChange={e=>setForm({...form,limiteCredito:e.target.value})} placeholder="0.00" />
          )}

          {modal !== "new" && (() => {
            const esActivo = s(modal?.estatus) !== "Inactivo";
            return (
              <div className="border-t border-slate-200 pt-4 mt-6">
                <button onClick={() => askConfirm(
                    esActivo ? "Desactivar cliente" : "Activar cliente",
                    esActivo
                      ? `¿Desactivar "${s(modal.nombre)}"? Su histórico se conserva.`
                      : `¿Activar "${s(modal.nombre)}"?`,
                    async () => {
                      const err = await actions.updateCliente(modal.id, { estatus: esActivo ? "Inactivo" : "Activo" });
                      if (err && (err.message || err.code)) {
                        toast?.error(esActivo ? "No se pudo desactivar el cliente" : "No se pudo activar el cliente");
                        return;
                      }
                      toast?.success(esActivo ? "Cliente desactivado" : "Cliente activado");
                      setModal(null);
                    },
                    esActivo
                  )} className={`w-full px-4 py-2.5 text-sm font-bold rounded-xl border transition-colors ${esActivo ? "bg-red-50 hover:bg-red-100 text-red-600 border-red-200" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"}`}>
                  {esActivo ? "⏸ Desactivar cliente" : "✓ Activar cliente"}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Footer con navegación */}
      <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-slate-100">
        <FormBtn onClick={()=>setModal(null)}>Cancelar</FormBtn>
        <div className="flex gap-2">
          {step > 1 && <FormBtn onClick={prevStep}>← Atrás</FormBtn>}
          {step < 3 && <FormBtn primary onClick={nextStep}>Siguiente →</FormBtn>}
          {step === 3 && <FormBtn primary onClick={save} loading={saving}>{modal === "new" ? "Crear cliente" : "Guardar cambios"}</FormBtn>}
          {step === 1 && modal === "new" && (
            <FormBtn primary onClick={async () => {
              const e = validateStep(1);
              if (Object.keys(e).length) { setErrors(e); return; }
              await save();
            }}>Crear y terminar</FormBtn>
          )}
        </div>
      </div>
    </Modal>
  </div>);
}
