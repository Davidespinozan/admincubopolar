import { useState, useMemo, Icons, StatusBadge, PageHeader, CapacityBar, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, n, eqId, useDebounce, useToast, reporteRutas } from './viewsCommon';

function AsignarOrdenesModal({ ruta, ordenes, onClose, onConfirm }) {
  const [selected, setSelected] = useState([]);
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  const toggleAll = () => setSelected(prev => prev.length === ordenes.length ? [] : ordenes.map(o=>o.id));

  return (
    <Modal open={true} onClose={onClose} title={"Asignar órdenes a " + s(ruta.nombre)} wide>
      {ordenes.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No hay órdenes pendientes de asignar</p>
      ) : (
        <div>
          <button onClick={toggleAll} className="text-xs text-blue-600 font-semibold mb-3">
            {selected.length === ordenes.length ? "Deseleccionar todo" : "Seleccionar todo (" + ordenes.length + ")"}
          </button>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {ordenes.map(o => (
              <div key={o.id} onClick={()=>toggle(o.id)}
                className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${selected.includes(o.id) ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue-600">{s(o.folio)}</span>
                    <span className="text-sm font-semibold text-slate-700 ml-2">{s(o.cliente)}</span>
                  </div>
                  <span className="text-sm font-bold">${n(o.total).toLocaleString()}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{s(o.productos)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">{selected.length} órdenes seleccionadas</p>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <FormBtn onClick={onClose}>Cancelar</FormBtn>
        <FormBtn primary onClick={()=>onConfirm(selected)}>Asignar {selected.length} órdenes</FormBtn>
      </div>
    </Modal>
  );
}

export function RutasView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(false);
  const [editingRuta, setEditingRuta] = useState(null);
  const [errors, setErrors] = useState({});
  // Carga por producto: objeto con SKU como key; clientesIds: array de IDs de clientes
  const [form, setForm] = useState({nombre:"",choferId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},clientesIds:[]});
  const [searchCliente, setSearchCliente] = useState("");
  const [asignarModal, setAsignarModal] = useState(null);
  const [cierreModal, setCierreModal] = useState(null);
  const [detalleModal, setDetalleModal] = useState(null);
  const [cierreForm, setCierreForm] = useState({devolucionPorProducto:{}});
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("");
  const dSearch = useDebounce(search);

  // Productos terminados para mostrar en formulario de carga
  const prodTerminados = useMemo(() =>
    (data.productos || []).filter(p => s(p.tipo) === "Producto Terminado"),
    [data.productos]
  );

  // Clientes para asignar a ruta
  const clientesFiltrados = useMemo(() => {
    const q = searchCliente.toLowerCase();
    return (data.clientes || []).filter(c =>
      !q || s(c.nombre).toLowerCase().includes(q) || s(c.contacto).toLowerCase().includes(q)
    ).slice(0, 50);
  }, [data.clientes, searchCliente]);

  // Clientes seleccionados con su info
  const clientesSeleccionados = useMemo(() => {
    return form.clientesIds.map(id => {
      const c = (data.clientes || []).find(cli => String(cli.id) === String(id));
      return c || { id, nombre: `Cliente #${id}` };
    });
  }, [form.clientesIds, data.clientes]);

  // Agrupar clientes disponibles por zona para sugerencias inteligentes
  const clientesPorZona = useMemo(() => {
    const zonas = {};
    (data.clientes || []).forEach(c => {
      const zona = s(c.zona) || 'Sin zona';
      if (!zonas[zona]) zonas[zona] = [];
      zonas[zona].push(c);
    });
    return zonas;
  }, [data.clientes]);

  // Sugerir clientes de la misma zona que los ya seleccionados
  const zonasSeleccionadas = useMemo(() => {
    const z = new Set();
    clientesSeleccionados.forEach(c => { if (c.zona) z.add(c.zona); });
    return Array.from(z);
  }, [clientesSeleccionados]);

  const [filterZona, setFilterZona] = useState('');

  const toggleCliente = (clienteId) => {
    const id = String(clienteId);
    setForm(prev => ({
      ...prev,
      clientesIds: prev.clientesIds.includes(id)
        ? prev.clientesIds.filter(cid => cid !== id)
        : [...prev.clientesIds, id]
    }));
  };

  // Órdenes sin asignar a ruta
  const ordenesSinRuta = useMemo(() => data.ordenes.filter(o => o.estatus === "Asignada" && !o.rutaId), [data.ordenes]);
  const choferes = useMemo(() => (data.usuarios || [])
    .filter(u => s(u.rol) === "Chofer")
    .map(u => ({ value: String(u.id), label: s(u.nombre) })), [data.usuarios]);

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.choferId) e.choferId = "Requerido";
    // Validar que al menos un producto tenga carga
    const totalCarga = Object.values(form.cargaPorProducto).reduce((s, v) => s + n(v), 0);
    const totalExtra = Object.values(form.extraPorProducto).reduce((s, v) => s + n(v), 0);
    if ((totalCarga + totalExtra) === 0 && !editingRuta) e.carga = "Debe autorizar al menos 1 producto";

    // Validar stock disponible en cuartos fríos
    if (!editingRuta) {
      for (const [sku, qty] of Object.entries(form.cargaPorProducto)) {
        const extraQty = n(form.extraPorProducto[sku]);
        const totalReq = n(qty) + extraQty;
        if (totalReq > 0) {
          const prod = prodTerminados.find(p => s(p.sku) === sku);
          const stockDisp = prod ? n(prod.stock) : 0;
          if (totalReq > stockDisp) {
            e.carga = `Stock insuficiente de ${sku} (disp: ${stockDisp}, sol: ${totalReq})`;
            break;
          }
        }
      }
    }
    if (Object.keys(e).length) { setErrors(e); return; }

    // Convertir cargaPorProducto a JSONB limpio (sin valores 0)
    const cargaAutorizada = {};
    const extraAutorizado = {};
    for (const [sku, qty] of Object.entries(form.cargaPorProducto)) {
      if (n(qty) > 0) cargaAutorizada[sku] = n(qty);
    }
    for (const [sku, qty] of Object.entries(form.extraPorProducto)) {
      if (n(qty) > 0) extraAutorizado[sku] = n(qty);
    }
    // Carga total = carga + extra
    const cargaTotal = {};
    for (const sku of Object.keys({...cargaAutorizada, ...extraAutorizado})) {
      cargaTotal[sku] = (cargaAutorizada[sku] || 0) + (extraAutorizado[sku] || 0);
    }

    // Preparar clientes asignados con orden
    const clientesAsignados = form.clientesIds.map((id, idx) => ({ clienteId: Number(id), orden: idx + 1 }));

    let err;
    if (editingRuta) {
      err = await actions.updateRuta(editingRuta.id, {
        nombre: form.nombre,
        choferId: Number(form.choferId),
        estatus: form.estatus,
        carga: cargaTotal,
        cargaAutorizada,
        extraAutorizado,
        clientesAsignados,
      });
    } else {
      err = await actions.addRuta({
        nombre: form.nombre,
        choferId: Number(form.choferId),
        ordenes: 0,
        carga: cargaTotal,
        cargaAutorizada,
        extraAutorizado,
        clientesAsignados,
      });
    }
    if (err) {
      toast?.error(editingRuta ? "No se pudo actualizar la ruta" : "No se pudo crear la ruta");
      return;
    }
    toast?.success(editingRuta ? "Ruta actualizada" : "Ruta creada y carga autorizada");
    setModal(false);
    setEditingRuta(null);
    setForm({nombre:"",choferId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},clientesIds:[]});
    setSearchCliente("");
    setErrors({});
  };

  const abrirEdicion = (ruta) => {
    setEditingRuta(ruta);
    // Parsear carga existente a objeto por producto
    const cargaObj = (ruta.carga && typeof ruta.carga === 'object') ? ruta.carga : {};
    const extraObj = (ruta.extraAutorizado && typeof ruta.extraAutorizado === 'object') ? ruta.extraAutorizado : {};
    const cargaAutObj = (ruta.cargaAutorizada && typeof ruta.cargaAutorizada === 'object') ? ruta.cargaAutorizada : cargaObj;
    // Parsear clientes asignados
    const clientesAsig = Array.isArray(ruta.clientesAsignados)
      ? ruta.clientesAsignados.map(c => String(c.clienteId || c))
      : [];
    setForm({
      nombre: s(ruta.nombre),
      choferId: String(ruta.choferId || ruta.chofer_id || ""),
      estatus: s(ruta.estatus) || "Programada",
      cargaPorProducto: cargaAutObj,
      extraPorProducto: extraObj,
      clientesIds: clientesAsig,
    });
    setSearchCliente("");
    setErrors({});
    setModal(true);
  };

  const asignarOrdenes = (ruta) => { setAsignarModal(ruta); };
  const confirmarAsignacion = (ordenIds) => {
    if (!asignarModal || ordenIds.length === 0) return;
    // Count items for carga
    let totalBolsas = 0;
    for (const oid of ordenIds) {
      const ord = data.ordenes.find(o => eqId(o.id, oid));
      if (ord) {
        const prods = s(ord.productos);
        const matches = prods.match(/(\d+)/g);
        if (matches) totalBolsas += matches.reduce((s,v) => s + parseInt(v), 0);
      }
    }
    if (actions.asignarOrdenesARuta) {
      actions.asignarOrdenesARuta(asignarModal.id, ordenIds, totalBolsas);
    }
    toast?.success(ordenIds.length + " órdenes asignadas a " + s(asignarModal.nombre));
    setAsignarModal(null);
  };

  const abrirCierre = (ruta) => {
    setCierreModal(ruta);
    // Inicializar devolución por producto a 0
    const devInit = {};
    prodTerminados.forEach(p => devInit[p.sku] = 0);
    setCierreForm({devolucionPorProducto: devInit});
  };
  const confirmarCierre = () => {
    if (!cierreModal) return;
    // Filtrar solo productos con devolución > 0
    const devolucion = {};
    for (const [sku, qty] of Object.entries(cierreForm.devolucionPorProducto)) {
      if (n(qty) > 0) devolucion[sku] = n(qty);
    }
    if (actions.cerrarRuta) {
      actions.cerrarRuta(cierreModal.id, devolucion);
    }
    toast?.success("Ruta " + s(cierreModal.nombre) + " cerrada");
    setCierreModal(null);
  };

  const choferLabel = (r) => {
    const raw = r?.chofer;
    const fromRaw = raw && typeof raw === 'object' ? s(raw.nombre) : s(raw);
    const fromField = s(r?.choferNombre) || s(r?.chofer_nombre);
    const rid = r?.choferId || r?.chofer_id;
    const fromUsuario = rid
      ? s((data.usuarios || []).find(u => String(u.id) === String(rid))?.nombre)
      : '';
    return fromRaw || fromField || fromUsuario || '—';
  };

  const cargaLabel = (r) => {
    const raw = r?.carga;
    if (raw && typeof raw === 'object') {
      if (raw.bolsas !== undefined) return `${n(raw.bolsas)} bolsas`;
      const vals = Object.values(raw).map(v => n(v));
      const total = vals.reduce((a, b) => a + b, 0);
      return `${total} bolsas`;
    }
    return s(raw);
  };

  const filteredRutas = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.rutas.filter(r => {
      const ms = !q || s(r.nombre).toLowerCase().includes(q) || s(r.folio).toLowerCase().includes(q) || choferLabel(r).toLowerCase().includes(q);
      const me = !filterEst || s(r.estatus).toLowerCase() === filterEst.toLowerCase();
      return ms && me;
    });
  }, [data.rutas, dSearch, filterEst]);

  const exportBtns = <>
    <button onClick={() => reporteRutas(data.rutas, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteRutas(data.rutas, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    {ConfirmEl}
    <PageHeader title="Entregas" subtitle="Rutas de distribución" action={()=>{setEditingRuta(null);setForm({nombre:"",choferId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},clientesIds:[]});setSearchCliente("");setModal(true);setErrors({})}} actionLabel="Autorizar ruta" extraButtons={exportBtns} />

    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar ruta, folio o chofer..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterEst} onChange={e=>setFilterEst(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos</option>{["Programada","En progreso","Completada","Cerrada"].map(st=><option key={st}>{st}</option>)}</select>
    </div>

    {ordenesSinRuta.length > 0 && (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center justify-between">
        <p className="text-xs text-amber-700 font-semibold">{ordenesSinRuta.length} órdenes sin asignar a ruta</p>
      </div>
    )}

    {filteredRutas.length === 0
      ? <EmptyState message="Sin rutas" />
      : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
      {filteredRutas.map(r => {
        const est = s(r.estatus).trim().toLowerCase();
        const isProgramada = est === "programada" || est === "pendiente";
        const isEnProgreso = est === "en progreso" || est === "en_progreso" || est === "enprogreso";
        const isCompletada = est === "completada";
        const rutaOrdenes = data.ordenes.filter(o => o.rutaId === r.id || eqId(o.rutaId, r.id));
        const entregadas = rutaOrdenes.filter(o => o.estatus === "Entregada").length;
        return (
        <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 hover:shadow-md hover:border-blue-200 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs text-slate-400">{s(r.folio)}</span>
            <div className="flex items-center gap-2">
              <button onClick={()=>abrirEdicion(r)} className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 rounded-lg border border-blue-200">Editar</button>
              <StatusBadge status={r.estatus}/>
            </div>
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">{s(r.nombre)}</h3>
          <p className="text-xs text-slate-500 mb-3 truncate">{choferLabel(r)} · {rutaOrdenes.length} órdenes · {cargaLabel(r)}</p>
          <div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-400">Entregas</span><span className="font-semibold">{entregadas}/{rutaOrdenes.length}</span></div>
          <CapacityBar pct={rutaOrdenes.length>0?(entregadas/rutaOrdenes.length)*100:0}/>

          {isProgramada&&<div className="space-y-2 mt-3">
            <div className="flex gap-2">
              <button onClick={()=>asignarOrdenes(r)} className="flex-1 py-2.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded-xl min-h-[44px]">+ Asignar órdenes</button>
              <button onClick={()=>actions.updateRutaEstatus(r.id,"En progreso")} className="flex-1 py-2.5 bg-blue-600 text-white text-xs font-semibold rounded-xl min-h-[44px]">Iniciar</button>
            </div>
            <button onClick={() => askConfirm('Eliminar ruta','¿Eliminar ruta ' + s(r.nombre) + '?',()=>actions.deleteRuta(r.id),true)} className="w-full py-2 text-red-500 text-xs font-semibold hover:bg-red-50 rounded-xl">Eliminar ruta</button>
          </div>}
          {isEnProgreso&&<div className="space-y-2 mt-3">
            <div className="flex gap-2">
              <button onClick={()=>abrirCierre(r)} className="flex-1 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl min-h-[44px]">Cerrar ruta</button>
              <button onClick={() => askConfirm('Eliminar ruta','¿Eliminar ruta ' + s(r.nombre) + '?',()=>actions.deleteRuta(r.id),true)} className="flex-1 py-2.5 bg-red-50 text-red-600 text-xs font-semibold rounded-xl min-h-[44px]">Eliminar</button>
            </div>
          </div>}
          {isCompletada&&<div className="space-y-2 mt-3">
            <button onClick={()=>setDetalleModal(r)} className="w-full py-2.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-xl min-h-[44px]">Ver resumen</button>
            <button onClick={() => askConfirm('Eliminar ruta','¿Eliminar ruta ' + s(r.nombre) + '?',()=>actions.deleteRuta(r.id),true)} className="w-full py-2 text-red-500 text-xs font-semibold hover:bg-red-50 rounded-xl">Eliminar</button>
          </div>}
          {r.estatus==="Cerrada"&&<p className="mt-3 text-xs text-slate-400 text-center">Ruta cerrada ✓</p>}
        </div>);
      })}
    </div>}

    {/* Modal crear/editar ruta */}
    <Modal open={modal} onClose={()=>{setModal(false);setEditingRuta(null)}} title={editingRuta ? "Editar ruta" : "Autorizar carga de ruta"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput label="Nombre de ruta *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Ej: Ruta Norte" error={errors.nombre} />
          <FormSelect label="Chofer *" options={[{value:"",label:"Seleccionar..."}, ...choferes]} value={form.choferId} onChange={e=>setForm({...form,choferId:e.target.value})} error={errors.choferId} />
        </div>
        {editingRuta && <FormSelect label="Estatus" options={["Programada","En progreso","Completada","Cerrada","Cancelada"]} value={form.estatus} onChange={e=>setForm({...form,estatus:e.target.value})} />}

        {/* Carga autorizada por producto */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs">1</span>
            Carga base autorizada
          </h4>
          {errors.carga && <p className="text-xs text-red-500 mb-2">{errors.carga}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {prodTerminados.map(p => (
              <div key={p.sku} className="bg-slate-50 rounded-xl p-3">
                <label className="text-xs font-semibold text-slate-600 block mb-1">{p.nombre}</label>
                <span className="text-[10px] text-slate-400 block mb-2">{p.sku}</span>
                <input
                  type="number"
                  min="0"
                  value={form.cargaPorProducto[p.sku] || ""}
                  onChange={e => setForm({...form, cargaPorProducto: {...form.cargaPorProducto, [p.sku]: e.target.value}})}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:border-blue-400"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Extra autorizado */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-xs">2</span>
            Extra autorizado <span className="text-xs font-normal text-slate-400">(adicional a carga base)</span>
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {prodTerminados.map(p => (
              <div key={p.sku} className="bg-amber-50 rounded-xl p-3">
                <label className="text-xs font-semibold text-amber-700 block mb-1">{p.nombre}</label>
                <span className="text-[10px] text-amber-500 block mb-2">+ Extra</span>
                <input
                  type="number"
                  min="0"
                  value={form.extraPorProducto[p.sku] || ""}
                  onChange={e => setForm({...form, extraPorProducto: {...form.extraPorProducto, [p.sku]: e.target.value}})}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm text-center focus:outline-none focus:border-amber-400 bg-white"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de carga total */}
        {Object.values(form.cargaPorProducto).some(v => n(v) > 0) && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <h4 className="text-xs font-bold text-emerald-700 uppercase mb-2">Carga total autorizada</h4>
            <div className="flex flex-wrap gap-2">
              {prodTerminados.filter(p => n(form.cargaPorProducto[p.sku]) > 0 || n(form.extraPorProducto[p.sku]) > 0).map(p => {
                const base = n(form.cargaPorProducto[p.sku]);
                const extra = n(form.extraPorProducto[p.sku]);
                return (
                  <span key={p.sku} className="px-3 py-1 bg-white border border-emerald-200 rounded-full text-xs font-semibold text-emerald-700">
                    {base + extra}× {p.sku}
                    {extra > 0 && <span className="text-amber-600 ml-1">(+{extra})</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Clientes asignados a la ruta */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs">3</span>
            Clientes a visitar <span className="text-xs font-normal text-slate-400">(opcional)</span>
          </h4>

          {/* Clientes seleccionados */}
          {clientesSeleccionados.length > 0 && (
            <div className="mb-3 space-y-2">
              {clientesSeleccionados.map((c, idx) => (
                <div key={c.id} className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-content text-xs font-bold">{idx + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{s(c.nombre)}</p>
                      {s(c.zona) && <span className="inline-block text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full mr-1">📍 {s(c.zona)}</span>}
                      {c.latitud && c.longitud && <span className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🗺️ GPS</span>}
                      {s(c.contacto) && <p className="text-xs text-purple-600 mt-0.5">📞 {s(c.contacto)}</p>}
                    </div>
                  </div>
                  <button onClick={() => toggleCliente(c.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Icons.X />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Buscar y agregar clientes */}
          <div className="flex gap-2 items-center">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchCliente}
                onChange={e => setSearchCliente(e.target.value)}
                placeholder="Filtrar clientes..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-purple-400"
              />
            </div>
            <select
              value={filterZona}
              onChange={e => setFilterZona(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-purple-400"
            >
              <option value="">Todas zonas</option>
              {Object.keys(clientesPorZona).sort().map(z => <option key={z} value={z}>{z} ({clientesPorZona[z].length})</option>)}
            </select>
          </div>
          {zonasSeleccionadas.length > 0 && filterZona === '' && (
            <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs text-green-700 font-medium">Sugerencia: Clientes ya seleccionados están en zona {zonasSeleccionadas.join(', ')}</p>
              <button
                onClick={() => setFilterZona(zonasSeleccionadas[0])}
                className="text-xs text-green-600 underline mt-1"
              >
                Filtrar por {zonasSeleccionadas[0]}
              </button>
            </div>
          )}
          {/* Lista de clientes disponibles - siempre visible */}
          <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white">
            {clientesFiltrados
              .filter(c => !form.clientesIds.includes(String(c.id)))
              .filter(c => !filterZona || s(c.zona) === filterZona)
              .slice(0, 15).map(c => (
              <button
                key={c.id}
                onClick={() => { toggleCliente(c.id); }}
                className="w-full px-3 py-2 text-left hover:bg-purple-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="w-5 h-5 border-2 border-slate-300 rounded flex items-center justify-center text-xs flex-shrink-0"></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {s(c.nombre)}
                    {s(c.zona) && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{s(c.zona)}</span>}
                    {c.latitud && c.longitud && <span className="ml-1 text-xs">🗺️</span>}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{s(c.tipo)} {s(c.contacto) ? `• ${s(c.contacto)}` : ""}</p>
                </div>
              </button>
            ))}
            {clientesFiltrados.filter(c => !form.clientesIds.includes(String(c.id))).filter(c => !filterZona || s(c.zona) === filterZona).length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">No hay más clientes disponibles</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        {(errors.nombre || errors.choferId) && (
          <p className="text-sm text-red-500 flex-1">⚠️ Completa el nombre de ruta y selecciona un chofer</p>
        )}
        <FormBtn onClick={()=>{setModal(false);setEditingRuta(null)}}>Cancelar</FormBtn>
        <FormBtn primary onClick={save}>{editingRuta ? "Guardar cambios" : "Autorizar carga"}</FormBtn>
      </div>
    </Modal>

    {/* Modal asignar órdenes */}
    {asignarModal && <AsignarOrdenesModal ruta={asignarModal} ordenes={ordenesSinRuta} onClose={()=>setAsignarModal(null)} onConfirm={confirmarAsignacion} />}

    {/* Modal cierre */}
    {cierreModal && (
      <Modal open={true} onClose={()=>setCierreModal(null)} title={"Cerrar " + s(cierreModal.nombre)} wide>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Resumen de ruta</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-400">Chofer:</span> <span className="font-semibold">{s(cierreModal.chofer)}</span></div>
              <div><span className="text-slate-400">Carga:</span> <span className="font-semibold">{cargaLabel(cierreModal)}</span></div>
              <div><span className="text-slate-400">Órdenes:</span> <span className="font-semibold">{n(cierreModal.ordenes)}</span></div>
              <div><span className="text-slate-400">Entregadas:</span> <span className="font-semibold">{n(cierreModal.entregadas)}</span></div>
            </div>
          </div>

          {/* Devolución por producto */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-bold text-slate-700 mb-3">Devolución por producto (sobrante)</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {prodTerminados.map(p => (
                <div key={p.sku} className="bg-blue-50 rounded-xl p-3">
                  <label className="text-xs font-semibold text-blue-700 block mb-1">{p.nombre}</label>
                  <span className="text-[10px] text-blue-500 block mb-2">{p.sku}</span>
                  <input
                    type="number"
                    min="0"
                    value={cierreForm.devolucionPorProducto[p.sku] || ""}
                    onChange={e => setCierreForm({devolucionPorProducto: {...cierreForm.devolucionPorProducto, [p.sku]: e.target.value}})}
                    placeholder="0"
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm text-center focus:outline-none focus:border-blue-400 bg-white"
                  />
                </div>
              ))}
            </div>
          </div>

          {Object.values(cierreForm.devolucionPorProducto).some(v => n(v) > 0) && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-blue-700 font-semibold">
                Regresa a cuarto frío: {Object.entries(cierreForm.devolucionPorProducto)
                  .filter(([_, v]) => n(v) > 0)
                  .map(([sku, v]) => `${n(v)}× ${sku}`)
                  .join(', ')}
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setCierreModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={confirmarCierre}>Cerrar ruta</FormBtn></div>
      </Modal>
    )}

    {/* Modal detalle / resumen */}
    {detalleModal && (
      <Modal open={true} onClose={()=>setDetalleModal(null)} title={"Detalle " + s(detalleModal.nombre)} wide>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Resumen de ruta</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-400">Chofer:</span> <span className="font-semibold">{choferLabel(detalleModal)}</span></div>
              <div><span className="text-slate-400">Carga:</span> <span className="font-semibold">{cargaLabel(detalleModal)}</span></div>
              <div><span className="text-slate-400">Órdenes:</span> <span className="font-semibold">{n(detalleModal.ordenes)}</span></div>
              <div><span className="text-slate-400">Entregadas:</span> <span className="font-semibold">{n(detalleModal.entregadas)}</span></div>
            </div>
          </div>
          <div className="flex justify-end">
            <FormBtn onClick={()=>setDetalleModal(null)}>Cerrar</FormBtn>
          </div>
        </div>
      </Modal>
    )}
  </div>);
}
