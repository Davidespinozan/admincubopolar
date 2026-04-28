import { lazy, Suspense } from 'react';
import { useState, useMemo, Icons, StatusBadge, PageHeader, CapacityBar, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, n, eqId, useDebounce, useToast, reporteRutas } from './viewsCommon';
import { ordenarPorProximidad } from '../../utils/geocoding';
const MapaPedidos = lazy(() => import('../ui/MapaPedidos'));

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
  // Carga por producto: objeto con SKU como key; ordenesIds: array de IDs de órdenes seleccionadas
  const [form, setForm] = useState({nombre:"",choferId:"",ayudanteId:"",camionId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},ordenesIds:[]});
  const [searchOrden, setSearchOrden] = useState("");
  const [asignarModal, setAsignarModal] = useState(null);
  const [cierreModal, setCierreModal] = useState(null);
  const [detalleModal, setDetalleModal] = useState(null);
  const [cierreForm, setCierreForm] = useState({devolucionPorProducto:{}});
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("");
  const [nuevoCamion, setNuevoCamion] = useState(false);
  const [camionForm, setCamionForm] = useState({nombre:"",placas:"",modelo:""});
  const [mapaVisible, setMapaVisible] = useState(false);
  const dSearch = useDebounce(search);

  // Productos terminados para mostrar en formulario de carga
  const prodTerminados = useMemo(() =>
    (data.productos || []).filter(p => s(p.tipo) === "Producto Terminado"),
    [data.productos]
  );

  // Stock real en cuartos fríos por SKU
  const stockPorSku = useMemo(() => {
    const acc = {};
    for (const p of prodTerminados) acc[s(p.sku)] = 0;
    for (const cf of (data.cuartosFrios || [])) {
      const st = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
      for (const [sku, qty] of Object.entries(st)) {
        const k = s(sku);
        if (k) acc[k] = (acc[k] || 0) + n(qty);
      }
    }
    return acc;
  }, [data.cuartosFrios, prodTerminados]);

  // Demanda calculada de los clientes seleccionados (sus órdenes pendientes)
  const estatusPendientesSet = useMemo(() => new Set(["creada","asignada","pendiente","en proceso","en_proceso","enprogreso"]), []);
  const demandaSeleccionados = useMemo(() => {
    const acc = {};
    for (const p of prodTerminados) acc[s(p.sku)] = 0;
    for (const ordenId of form.ordenesIds) {
      const ord = (data.ordenes || []).find(o => String(o.id) === String(ordenId));
      if (!ord) continue;
      if (Array.isArray(ord.preciosSnapshot) && ord.preciosSnapshot.length > 0) {
        for (const ln of ord.preciosSnapshot) {
          const sku = s(ln.sku);
          if (sku in acc) acc[sku] += n(ln.qty || ln.cantidad);
        }
      } else {
        s(ord.productos).split(',').forEach(part => {
          const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
          if (!mt) return;
          const sku = s(mt[2]);
          if (sku in acc) acc[sku] += Number(mt[1] || 0);
        });
      }
    }
    return acc;
  }, [form.ordenesIds, data.ordenes, prodTerminados]);

  // Órdenes disponibles para asignar (Creada o Asignada sin ruta, o ya en esta ruta al editar)
  const ordenesDisponibles = useMemo(() => {
    return (data.ordenes || []).filter(o => {
      const est = s(o.estatus).toLowerCase();
      const tieneRuta = o.rutaId || o.ruta_id;
      // Al editar: incluir las que ya están en esta ruta
      if (editingRuta && String(tieneRuta) === String(editingRuta.id)) return true;
      return (est === 'creada' || est === 'asignada') && !tieneRuta;
    });
  }, [data.ordenes, editingRuta]);

  // Con info de cliente y dirección
  const ordenesConInfo = useMemo(() => {
    return ordenesDisponibles.map(o => {
      const cli = (data.clientes || []).find(c => String(c.id) === String(o.clienteId || o.cliente_id));
      const dir = cli ? [s(cli.calle), s(cli.colonia), s(cli.ciudad)].filter(Boolean).join(', ') : '';
      return { ...o, clienteNombre: s(o.cliente || o.cliente_nombre || cli?.nombre), dir };
    });
  }, [ordenesDisponibles, data.clientes]);

  const ordenesFiltradas = useMemo(() => {
    const q = s(searchOrden).toLowerCase();
    if (!q) return ordenesConInfo;
    return ordenesConInfo.filter(o =>
      s(o.folio).toLowerCase().includes(q) ||
      s(o.clienteNombre).toLowerCase().includes(q) ||
      s(o.dir).toLowerCase().includes(q) ||
      s(o.productos).toLowerCase().includes(q)
    );
  }, [ordenesConInfo, searchOrden]);

  const toggleOrden = (ordenId) => {
    const id = String(ordenId);
    setForm(prev => ({
      ...prev,
      ordenesIds: prev.ordenesIds.includes(id)
        ? prev.ordenesIds.filter(oid => oid !== id)
        : [...prev.ordenesIds, id],
    }));
  };

  // Órdenes sin asignar a ruta
  const ordenesSinRuta = useMemo(() => data.ordenes.filter(o => o.estatus === "Asignada" && !o.rutaId), [data.ordenes]);
  const choferes = useMemo(() => (data.usuarios || [])
    .filter(u => s(u.rol) === "Chofer")
    .map(u => ({ value: String(u.id), label: s(u.nombre) })), [data.usuarios]);

  const ayudantes = useMemo(() => (data.empleados || [])
    .filter(e => s(e.puesto).toLowerCase().includes('ayudante') && s(e.estatus) === 'Activo')
    .map(e => ({ value: String(e.id), label: s(e.nombre) })), [data.empleados]);

  const camiones = useMemo(() => (data.camiones || [])
    .filter(c => s(c.estatus) === 'Activo')
    .map(c => ({ value: String(c.id), label: s(c.nombre) + (c.placas ? ` (${c.placas})` : '') })), [data.camiones]);

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
          const stockDisp = n(stockPorSku[sku]);
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

    // Derivar clientes asignados de las órdenes seleccionadas (sin duplicados)
    const clientesVistos = new Set();
    const clientesAsignados = [];
    form.ordenesIds.forEach((oid, idx) => {
      const ord = (data.ordenes || []).find(o => String(o.id) === String(oid));
      const cid = ord?.clienteId || ord?.cliente_id;
      if (cid && !clientesVistos.has(String(cid))) {
        clientesVistos.add(String(cid));
        clientesAsignados.push({ clienteId: Number(cid), orden: clientesAsignados.length + 1 });
      }
    });

    let err;
    if (editingRuta) {
      err = await actions.updateRuta(editingRuta.id, {
        nombre: form.nombre,
        choferId: Number(form.choferId),
        ayudanteId: form.ayudanteId ? Number(form.ayudanteId) : null,
        camionId: form.camionId ? Number(form.camionId) : null,
        estatus: form.estatus,
        carga: cargaTotal,
        cargaAutorizada,
        extraAutorizado,
        clientesAsignados,
      });
      if (!err && form.ordenesIds.length > 0) {
        await actions.asignarOrdenesARuta(editingRuta.id, form.ordenesIds, 0);
      }
    } else {
      const result = await actions.addRuta({
        nombre: form.nombre,
        choferId: Number(form.choferId),
        ayudanteId: form.ayudanteId ? Number(form.ayudanteId) : null,
        camionId: form.camionId ? Number(form.camionId) : null,
        ordenes: 0,
        carga: cargaTotal,
        cargaAutorizada,
        extraAutorizado,
        clientesAsignados,
      });
      err = result instanceof Error ? result : null;
      // Link selected orders to the new route
      if (!err && form.ordenesIds.length > 0 && result?.id) {
        await actions.asignarOrdenesARuta(result.id, form.ordenesIds, 0);
      }
    }
    if (err) {
      toast?.error(editingRuta ? "No se pudo actualizar la ruta" : "No se pudo crear la ruta");
      return;
    }
    toast?.success(editingRuta ? "Ruta actualizada" : "Ruta creada y carga autorizada");
    setModal(false);
    setEditingRuta(null);
    setForm({nombre:"",choferId:"",ayudanteId:"",camionId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},ordenesIds:[]});
    setSearchOrden("");
    setErrors({});
  };

  const abrirEdicion = (ruta) => {
    setEditingRuta(ruta);
    // Parsear carga existente a objeto por producto
    const cargaObj = (ruta.carga && typeof ruta.carga === 'object') ? ruta.carga : {};
    const extraObj = (ruta.extraAutorizado && typeof ruta.extraAutorizado === 'object') ? ruta.extraAutorizado : {};
    const cargaAutObj = (ruta.cargaAutorizada && typeof ruta.cargaAutorizada === 'object') ? ruta.cargaAutorizada : cargaObj;
    // Restaurar órdenes ya asignadas a esta ruta
    const ordenesAsig = (data.ordenes || [])
      .filter(o => String(o.rutaId || o.ruta_id) === String(ruta.id))
      .map(o => String(o.id));
    setForm({
      nombre: s(ruta.nombre),
      choferId: String(ruta.choferId || ruta.chofer_id || ""),
      ayudanteId: String(ruta.ayudanteId || ruta.ayudante_id || ""),
      camionId: String(ruta.camionId || ruta.camion_id || ""),
      estatus: s(ruta.estatus) || "Programada",
      cargaPorProducto: cargaAutObj,
      extraPorProducto: extraObj,
      ordenesIds: ordenesAsig,
    });
    setSearchOrden("");
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
    <PageHeader title="Entregas" subtitle="Rutas de distribución" action={()=>{setEditingRuta(null);setForm({nombre:"",choferId:"",ayudanteId:"",camionId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},ordenesIds:[]});setSearchOrden("");setModal(true);setErrors({})}} actionLabel="Autorizar ruta" extraButtons={exportBtns} />

    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar ruta, folio o chofer..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterEst} onChange={e=>setFilterEst(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos</option>{["Programada","En progreso","Completada","Cerrada"].map(st=><option key={st}>{st}</option>)}</select>
    </div>

    {ordenesSinRuta.length > 0 && (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center justify-between">
        <p className="text-xs text-amber-700 font-semibold">{ordenesSinRuta.length} órdenes sin asignar a ruta</p>
        <button
          onClick={() => setMapaVisible(v => !v)}
          className="text-xs font-semibold text-amber-700 underline"
        >
          {mapaVisible ? 'Ocultar mapa' : 'Ver mapa de pedidos'}
        </button>
      </div>
    )}

    {mapaVisible && (() => {
      const ordenesParaMapa = (data.ordenes || [])
        .filter(o => {
          const est = s(o.estatus).toLowerCase();
          return est === 'creada' || est === 'asignada';
        })
        .map(o => {
          const cli = (data.clientes || []).find(c => String(c.id) === String(o.clienteId || o.cliente_id));
          return {
            ...o,
            clienteNombre: s(o.cliente || o.cliente_nombre || cli?.nombre),
            dir: cli ? [s(cli.calle), s(cli.colonia), s(cli.ciudad)].filter(Boolean).join(', ') : '',
            latitud: cli?.latitud,
            longitud: cli?.longitud,
          };
        });
      return (
        <div className="mb-5">
          <Suspense fallback={<div className="h-48 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center text-sm text-slate-400">Cargando mapa…</div>}>
            <MapaPedidos ordenes={ordenesParaMapa} choferUbicaciones={(() => {
              const ubicaciones = data.choferUbicaciones || [];
              const seen = new Set();
              return ubicaciones.filter(u => {
                if (seen.has(u.rutaId || u.ruta_id)) return false;
                seen.add(u.rutaId || u.ruta_id);
                return true;
              }).map(u => {
                const usr = (data.usuarios || []).find(x => String(x.id) === String(u.choferId || u.chofer_id));
                const ruta = (data.rutas || []).find(r => String(r.id) === String(u.rutaId || u.ruta_id));
                return { ...u, chofer_nombre: s(usr?.nombre), ruta_folio: s(ruta?.folio) };
              });
            })()} />
          </Suspense>
        </div>
      );
    })()}

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
          <p className="text-xs text-slate-500 mb-1 truncate">{choferLabel(r)}{r.ayudanteNombre ? ` + ${r.ayudanteNombre}` : ''} · {rutaOrdenes.length} órdenes · {cargaLabel(r)}</p>
          {r.camionNombre && <p className="text-xs text-slate-400 mb-2 truncate">🚛 {r.camionNombre}{r.camionPlacas ? ` — ${r.camionPlacas}` : ''}</p>}
          {!r.camionNombre && <div className="mb-2" />}
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
          <FormSelect label="Ayudante" options={[{value:"",label:"Sin ayudante"}, ...ayudantes]} value={form.ayudanteId} onChange={e=>setForm({...form,ayudanteId:e.target.value})} />
          <div>
            <FormSelect label="Camión" options={[{value:"",label:"Seleccionar camión..."}, ...camiones]} value={form.camionId} onChange={e=>setForm({...form,camionId:e.target.value})} />
            {!nuevoCamion && <button type="button" onClick={()=>setNuevoCamion(true)} className="text-xs text-blue-600 font-semibold mt-1">+ Nuevo camión</button>}
            {nuevoCamion && (
              <div className="mt-2 bg-blue-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-blue-700">Registrar camión</p>
                <input value={camionForm.nombre} onChange={e=>setCamionForm({...camionForm,nombre:e.target.value})} placeholder="Nombre (ej: Camión 1)" className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={camionForm.placas} onChange={e=>setCamionForm({...camionForm,placas:e.target.value})} placeholder="Placas" className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white" />
                  <input value={camionForm.modelo} onChange={e=>setCamionForm({...camionForm,modelo:e.target.value})} placeholder="Modelo" className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={async()=>{
                    if(!camionForm.nombre.trim()){toast?.error('Nombre requerido');return;}
                    await actions.addCamion(camionForm);
                    toast?.success('Camión registrado');
                    setCamionForm({nombre:"",placas:"",modelo:""});
                    setNuevoCamion(false);
                  }} className="flex-1 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg">Guardar</button>
                  <button type="button" onClick={()=>{setNuevoCamion(false);setCamionForm({nombre:"",placas:"",modelo:""})}} className="flex-1 py-2 bg-slate-200 text-slate-600 text-xs font-semibold rounded-lg">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
        {editingRuta && <FormSelect label="Estatus" options={["Programada","En progreso","Completada","Cerrada","Cancelada"]} value={form.estatus} onChange={e=>setForm({...form,estatus:e.target.value})} />}

        {/* Carga autorizada por producto */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs">1</span>
            Carga base autorizada
          </h4>
          {errors.carga && <p className="text-xs text-red-500 mb-2">{errors.carga}</p>}
          {form.ordenesIds.length > 0 && Object.values(demandaSeleccionados).some(v => v > 0) && (
            <button
              type="button"
              onClick={() => setForm(prev => ({ ...prev, cargaPorProducto: {...prev.cargaPorProducto, ...Object.fromEntries(Object.entries(demandaSeleccionados).map(([k,v]) => [k, v]))} }))}
              className="mb-3 w-full py-2 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              Llenar con demanda de clientes seleccionados ({Object.values(demandaSeleccionados).reduce((a,b)=>a+b,0)} bolsas)
            </button>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {prodTerminados.map(p => {
              const sku = s(p.sku);
              const disp = n(stockPorSku[sku]);
              const demanda = n(demandaSeleccionados[sku]);
              const solicitado = n(form.cargaPorProducto[sku]) + n(form.extraPorProducto[sku]);
              const sinStock = solicitado > disp;
              return (
                <div key={sku} className={`rounded-xl p-3 ${sinStock ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">{p.nombre}</label>
                  <span className="text-[10px] text-slate-400 block">{sku}</span>
                  <div className="flex justify-between text-[10px] mt-1 mb-2">
                    <span className={`font-semibold ${disp === 0 ? 'text-red-500' : 'text-emerald-600'}`}>Disp: {disp}</span>
                    {demanda > 0 && <span className="font-semibold text-blue-600">Dem: {demanda}</span>}
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={form.cargaPorProducto[sku] || ""}
                    onChange={e => setForm({...form, cargaPorProducto: {...form.cargaPorProducto, [sku]: e.target.value}})}
                    placeholder={demanda > 0 ? String(demanda) : "0"}
                    className={`w-full px-3 py-2 border rounded-lg text-sm text-center focus:outline-none ${sinStock ? 'border-red-300 bg-white focus:border-red-400' : 'border-slate-200 focus:border-blue-400'}`}
                  />
                  {sinStock && <p className="text-[10px] text-red-500 text-center mt-1">Excede stock</p>}
                </div>
              );
            })}
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
                    {base + extra}× {s(p.nombre)}
                    {extra > 0 && <span className="text-amber-600 ml-1">(+{extra})</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Órdenes a entregar */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs">3</span>
            Órdenes a entregar
            {form.ordenesIds.length > 0 && <span className="text-xs font-normal text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">{form.ordenesIds.length} seleccionadas</span>}
          </h4>

          <input
            type="text"
            value={searchOrden}
            onChange={e => setSearchOrden(e.target.value)}
            placeholder="Buscar por folio, cliente o dirección..."
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-2 focus:outline-none focus:border-purple-400"
          />

          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
            {ordenesFiltradas.length === 0 && (
              <p className="px-3 py-4 text-xs text-slate-400 text-center">No hay órdenes pendientes sin ruta asignada</p>
            )}
            {ordenesFiltradas.map(o => {
              const sel = form.ordenesIds.includes(String(o.id));
              return (
                <button
                  key={o.id}
                  onClick={() => toggleOrden(o.id)}
                  className={`w-full px-3 py-2.5 text-left flex items-start gap-3 transition-colors ${sel ? 'bg-purple-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${sel ? 'border-purple-500 bg-purple-500 text-white' : 'border-slate-300'}`}>
                    {sel ? '✓' : ''}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-blue-600">{s(o.folio)}</span>
                      <span className="text-xs font-semibold text-slate-700">{s(o.clienteNombre)}</span>
                      <span className="text-xs text-slate-400">{s(o.fecha)}</span>
                    </div>
                    {o.dir && <p className="text-xs text-slate-500 truncate mt-0.5">📍 {o.dir}</p>}
                    <p className="text-xs text-slate-400 truncate">{s(o.productos)}</p>
                  </div>
                  <span className="text-xs font-bold text-slate-700 flex-shrink-0">${n(o.total).toLocaleString()}</span>
                </button>
              );
            })}
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
                  .map(([sku, v]) => {
                    const p = (data.productos || []).find(x => s(x.sku) === s(sku));
                    return `${n(v)}× ${p ? s(p.nombre) : sku}`;
                  })
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
              <div><span className="text-slate-400">Ayudante:</span> <span className="font-semibold">{detalleModal.ayudanteNombre || '—'}</span></div>
              <div><span className="text-slate-400">Camión:</span> <span className="font-semibold">{detalleModal.camionNombre ? `${detalleModal.camionNombre}${detalleModal.camionPlacas ? ` (${detalleModal.camionPlacas})` : ''}` : '—'}</span></div>
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
