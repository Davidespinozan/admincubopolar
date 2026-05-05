import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, fmtMoney, useDebounce, useToast, reporteClientes, PAGE_SIZE, Paginator } from './viewsCommon';
import DireccionForm from '../ui/DireccionForm';
import { validarRFC, normalizeStr, formatDireccion, validateDireccion } from '../../utils/safe';
import { REGIMENES_OPTIONS } from '../../data/sat/regimenesFiscales';

export function ClientesView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterEstatus, setFilterEstatus] = useState("Activos"); // Activos | Inactivos | Todos
  const [filterDireccion, setFilterDireccion] = useState(""); // "" | "incompleta"
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const empty = {
    nombre:"",nombreComercial:"",rfc:"",regimen:"616",usoCfdi:"G03",
    correo:"",tipo:"Tienda",contacto:"",
    // Dirección estructurada (mig 056). cp legacy queda fuera del DireccionForm
    // y se llena vía codigo_postal — ver doc deuda en PENDIENTES_TECNICOS.md.
    calle:"", numero_exterior:"", numero_interior:"",
    colonia:"", ciudad:"Durango", estado:"Durango",
    codigo_postal:"", cp:"",
    zona:"", latitud:null, longitud:null,
    creditoAutorizado:false, limiteCredito:""
  };
  const [form, setForm] = useState(empty);
  const [step, setStep] = useState(1);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setStep(1); setModal("new"); };
  const openEdit = (c) => {
    setForm({
      nombre: s(c.nombre),
      nombreComercial: s(c.nombreComercial || c.nombre_comercial),
      rfc: s(c.rfc),
      regimen: s(c.regimen) || "616",
      usoCfdi: s(c.usoCfdi) || "G03",
      cp: s(c.cp),
      correo: s(c.correo),
      tipo: s(c.tipo),
      contacto: s(c.contacto),
      calle: s(c.calle),
      numero_exterior: s(c.numero_exterior),
      numero_interior: s(c.numero_interior),
      colonia: s(c.colonia),
      ciudad: s(c.ciudad) || "Durango",
      estado: s(c.estado) || "Durango",
      codigo_postal: s(c.codigo_postal) || s(c.cp),
      zona: s(c.zona),
      latitud: c.latitud ?? null,
      longitud: c.longitud ?? null,
      creditoAutorizado: c.credito_autorizado || false,
      limiteCredito: c.limite_credito || "",
    });
    setErrors({});
    setStep(1);
    setModal(c);
  };

  const validateStep = (currentStep) => {
    const e = {};
    if (currentStep === 1) {
      if (!form.nombre.trim()) e.nombre = "Requerido";
      if (!form.rfc.trim()) e.rfc = "Requerido";
      else if (!validarRFC(form.rfc)) e.rfc = "Formato inválido (ej: XAXX010101000)";
      if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = "Email inválido";
    }
    if (currentStep === 2) {
      // Mig 056: número exterior obligatorio para entregas y CFDI 4.0.
      const dirErr = validateDireccion(form);
      if (dirErr) e.numero_exterior = dirErr.error;
      const cpVal = String(form.codigo_postal || form.cp || '').trim();
      if (cpVal && !/^\d{5}$/.test(cpVal)) e.codigo_postal = "CP debe ser 5 dígitos";
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
    const e = { ...validateStep(1), ...validateStep(2) };
    if (Object.keys(e).length) {
      // Si hay error en un campo de otro paso, regresar al paso correcto con el campo en rojo
      if (e.nombre || e.rfc || e.correo) setStep(1);
      else if (e.numero_exterior || e.codigo_postal) setStep(2);
      setErrors(e);
      toast?.error('Revisa los campos marcados en rojo');
      return;
    }
    setSaving(true);
    try {
      // Mantener cp legacy sincronizado con codigo_postal — el resto del
      // sistema sigue leyendo cp para CFDI hasta que se haga la migración
      // de consolidación (ver docs/PENDIENTES_TECNICOS.md).
      const payload = {
        ...form,
        cp: form.codigo_postal || form.cp || '',
      };
      const err = modal === "new"
        ? await actions.addCliente(payload)
        : await actions.updateCliente(modal.id, payload);
      if (err && (err.error || err.message || err.code)) {
        // Si supaStore disparó toast específico (err.error), no duplicar.
        if (!err.error) {
          toast?.error(modal === "new" ? "No se pudo crear el cliente" : "No se pudo actualizar el cliente");
        }
        return;
      }
      toast?.success(modal === "new" ? "Cliente creado" : "Cliente actualizado");
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  // Cuenta movimientos asociados a cada cliente para decidir si se puede DELETE.
  // BD bloquea con FK 23503 si hay órdenes / pagos / CxC / comodatos.
  const clientesConHistorico = useMemo(() => {
    const map = {};
    const bump = (cid) => {
      const k = String(cid || '');
      if (k) map[k] = (map[k] || 0) + 1;
    };
    (data?.ordenes || []).forEach(o => {
      if (!o) return;
      bump(o.clienteId || o.cliente_id);
    });
    (data?.pagos || []).forEach(p => {
      if (!p) return;
      bump(p.clienteId || p.cliente_id);
    });
    (data?.cuentasPorCobrar || []).forEach(c => {
      if (!c) return;
      bump(c.clienteId || c.cliente_id);
    });
    (data?.comodatos || []).forEach(c => {
      if (!c) return;
      bump(c.clienteId || c.cliente_id);
    });
    return map;
  }, [data?.ordenes, data?.pagos, data?.cuentasPorCobrar, data?.comodatos]);

  const puedeEliminarCliente = (id) => !clientesConHistorico[String(id)];

  const eliminarCliente = (c) => {
    askConfirm(
      'Eliminar permanentemente',
      `¿Eliminar a "${s(c.nombre)}" permanentemente? Esta acción no se puede deshacer.`,
      async () => {
        const result = await actions.deleteCliente(c.id);
        if (result?.error) {
          toast?.error(result.error);
          return;
        }
        toast?.success('Cliente eliminado');
      },
      true
    );
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
    // Normaliza diacríticos: "neveria" matchea "Nevería"; "espinoza" → "ESPINÓZA".
    const q = normalizeStr(dSearch);
    return (data.clientes || []).filter(c => {
      const ms = !q
        || normalizeStr(c.nombre).includes(q)
        || normalizeStr(c.nombre_comercial).includes(q)
        || normalizeStr(c.rfc).includes(q);
      const mt = !filterTipo || c.tipo === filterTipo;
      const inactivo = s(c.estatus) === "Inactivo";
      const me = filterEstatus === "Todos"
        || (filterEstatus === "Activos" && !inactivo)
        || (filterEstatus === "Inactivos" && inactivo);
      // Mig 056: filtro "Sin número exterior" para encontrar clientes
      // legacy que necesitan completar su dirección.
      const md = filterDireccion !== "incompleta"
        || !s(c.numero_exterior).trim();
      return ms && mt && me && md;
    });
  }, [data.clientes, dSearch, filterTipo, filterEstatus, filterDireccion]);

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
        <select value={filterDireccion} onChange={e=>{setFilterDireccion(e.target.value);setPage(0)}} className="px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white min-h-[44px]" title="Filtrar por completitud de dirección">
          <option value="">Todas direcciones</option>
          <option value="incompleta">⚠️ Sin número exterior</option>
        </select>
      </div>
      <DataTable columns={[
        {key:"nombre",label:"Cliente",bold:true,render:(_,row)=>{
          const sinNumExt = !s(row.numero_exterior).trim();
          return (
            <div>
              <span className="font-semibold">{s(row.nombre)}</span>
              {sinNumExt && (
                <span
                  className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
                  title="Sin número exterior — entrega o CFDI pueden fallar"
                >⚠️ Sin nº ext.</span>
              )}
              {row.nombre_comercial && <span className="block text-xs text-slate-400">{s(row.nombre_comercial)}</span>}
            </div>
          );
        }},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"tipo",label:"Tipo"},{key:"contacto",label:"Contacto"},
        {key:"direccion",label:"Dirección",hideOnMobile:true,render:(_,row)=>{
          const dir = formatDireccion(row);
          return dir
            ? <span className="text-xs text-slate-500 line-clamp-2">{dir}</span>
            : <span className="text-xs text-slate-300">—</span>;
        }},
        {key:"saldo",label:"Saldo",bold:true,render:v=>v?fmtMoney(v):"$0"},
        {key:"credito_autorizado",label:"Crédito",render:(_,row)=>row.credito_autorizado?<span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{"✓ " + fmtMoney(row.limite_credito)}</span>:<span className="text-xs text-slate-400">—</span>},
        {key:"estatus",label:"Estatus",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"acciones",label:"",render:(_,row)=>{
          const esActivo = s(row.estatus) !== "Inactivo";
          const puedeEliminar = puedeEliminarCliente(row.id);
          const movs = clientesConHistorico[String(row.id)] || 0;
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
            {puedeEliminar ? (
              <button
                onClick={()=>eliminarCliente(row)}
                aria-label="Eliminar permanentemente"
                title="Eliminar permanentemente"
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              >
                <span className="text-base leading-none">🗑</span>
              </button>
            ) : (
              <button
                disabled
                aria-label="No se puede eliminar — tiene histórico"
                title={`No se puede eliminar — tiene ${movs} ${movs === 1 ? 'movimiento' : 'movimientos'}. Usa Desactivar.`}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <span className="text-base leading-none opacity-50">🗑</span>
              </button>
            )}
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
              <FormSelect label="Régimen fiscal SAT" options={REGIMENES_OPTIONS} value={form.regimen} onChange={e=>setForm({...form,regimen:e.target.value})} />
              <FormSelect label="Uso CFDI" options={["G01","G03","S01","P01"]} value={form.usoCfdi} onChange={e=>setForm({...form,usoCfdi:e.target.value})} />
            </div>
          </details>
        </div>
      )}

      {/* PASO 2: Dirección — DireccionForm + zona aparte */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Para que el chofer encuentre al cliente y el CFDI lleve la dirección completa.</p>

          <DireccionForm
            value={form}
            onChange={(dir) => setForm(f => ({ ...f, ...dir }))}
            error={errors.numero_exterior ? { numero_exterior: errors.numero_exterior } : null}
          />
          {errors.codigo_postal && <p className="text-xs text-red-500 -mt-1">{errors.codigo_postal}</p>}

          <FormSelect
            label="Zona (para agrupar rutas)"
            options={["","Centro","Norte","Sur","Oriente","Poniente","Industrial","Periférico Norte","Periférico Sur"]}
            value={form.zona}
            onChange={e=>setForm({...form,zona:e.target.value})}
          />
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
            <FormInput label="Límite de crédito ($)" type="number" min="0" value={form.limiteCredito} onChange={e=>setForm({...form,limiteCredito:e.target.value})} placeholder="0.00" />
          )}

          {modal && modal !== "new" && (() => {
            const esActivo = s(modal?.estatus) !== "Inactivo";
            const puedeEliminar = puedeEliminarCliente(modal.id);
            return (
              <div className="border-t border-slate-200 pt-4 mt-6 space-y-2">
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
                {puedeEliminar && (
                  <button onClick={() => askConfirm(
                      "Eliminar permanentemente",
                      `¿Eliminar a "${s(modal.nombre)}" permanentemente? Esta acción no se puede deshacer.`,
                      async () => {
                        const result = await actions.deleteCliente(modal.id);
                        if (result?.error) {
                          toast?.error(result.error);
                          return;
                        }
                        toast?.success("Cliente eliminado");
                        setModal(null);
                      },
                      true
                    )} className="w-full px-4 py-2.5 text-sm font-bold rounded-xl bg-red-700 text-white hover:bg-red-800 transition-colors">
                    🗑 Eliminar permanentemente
                  </button>
                )}
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
