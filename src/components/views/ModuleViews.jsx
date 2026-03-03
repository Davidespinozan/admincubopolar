import { useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Icons } from '../ui/Icons';
import { StatusBadge, DataTable, PageHeader, CapacityBar } from '../ui/Components';
import Modal, { FormInput, FormSelect, FormBtn } from '../ui/Modal';
import { EmptyState } from '../ui/Skeleton';
import { s, n, money, eqId, fmtDate, fmtDateTime, useDebounce, today } from '../../utils/safe';
import { useToast } from '../ui/Toast';

const PAGE_SIZE = 50;

// ── Pagination helper ──
function Paginator({ page, total, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 gap-2">
      <span className="text-xs text-slate-400 truncate min-w-0">{total} reg. · {page + 1}/{pages}</span>
      <div className="flex gap-1 flex-shrink-0">
        <button disabled={page === 0} onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50 min-h-[44px] md:min-h-0">←</button>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50 min-h-[44px] md:min-h-0">→</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════
export function ClientesView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const empty = { nombre:"",rfc:"",regimen:"Régimen General",usoCfdi:"G03",cp:"",correo:"",tipo:"Tienda",contacto:"" };
  const [form, setForm] = useState(empty);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (c) => { setForm({ nombre:s(c.nombre),rfc:s(c.rfc),regimen:s(c.regimen)||"Régimen General",usoCfdi:s(c.usoCfdi)||"G03",cp:s(c.cp),correo:s(c.correo),tipo:s(c.tipo),contacto:s(c.contacto) }); setErrors({}); setModal(c); };

  const save = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.rfc.trim()) e.rfc = "Requerido";
    if (form.rfc.trim() && (form.rfc.length < 12 || form.rfc.length > 13)) e.rfc = "RFC debe tener 12-13 caracteres";
    if (Object.keys(e).length) { setErrors(e); return; }
    if (modal === "new") actions.addCliente(form); else actions.updateCliente(modal.id, form);
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

  return (<div>
    <PageHeader title="Clientes" subtitle={`${(data.clientes || []).length} registrados`} action={openNew} actionLabel="Nuevo cliente" />
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
      <div className="space-y-3 border-t border-slate-200 pt-4 mt-5">
        {modal !== "new" && (
          <button onClick={async () => {
            if (window.confirm(`¿Desactivar cliente "${s(modal.nombre)}"?`)) {
              const err = await actions.updateCliente(modal.id, { estatus: "Inactivo" });
              if (err) {
                toast?.error("No se pudo desactivar el cliente");
                return;
              }
              toast?.success("Cliente desactivado");
              setModal(null);
            }
          }} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors">
            🗑 Desactivar cliente
          </button>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// PRODUCTOS
// ═══════════════════════════════════════════════
export function ProductosView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const empty = {sku:"",nombre:"",tipo:"Producto Terminado",stock:0,ubicacion:"CF-1",precio:0};
  const [form, setForm] = useState(empty);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (p) => { setForm({sku:s(p.sku),nombre:s(p.nombre),tipo:s(p.tipo),stock:n(p.stock),ubicacion:s(p.ubicacion),precio:n(p.precio)}); setErrors({}); setModal(p); };

  const save = () => {
    const e = {};
    if (!form.sku.trim()) e.sku = "Requerido";
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (Object.keys(e).length) { setErrors(e); return; }
    if (modal === "new") actions.addProducto(form); else actions.updateProducto(modal.id, form);
    toast?.success(modal === "new" ? "Producto creado" : "Producto actualizado");
    setModal(null);
  };

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.productos.filter(p => {
      if (s(p.tipo) !== "Producto Terminado") return false;
      const ms = !q || s(p.nombre).toLowerCase().includes(q) || s(p.sku).toLowerCase().includes(q);
      return ms;
    });
  }, [data.productos, dSearch]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  return (<div>
    <PageHeader title="Catálogo de Productos" subtitle="Empaque y producto terminado" action={openNew} actionLabel="Nuevo producto" />
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar producto o SKU..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      </div>
      <DataTable columns={[
        {key:"sku",label:"SKU",render:v=><span className="font-mono text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{s(v)}</span>},
        {key:"nombre",label:"Producto",bold:true},
        {key:"tipo",label:"Tipo",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"stock",label:"Stock",render:(v,r)=><span className={`font-semibold ${s(r.tipo)==="Empaque"&&n(v)<200?"text-red-600":"text-slate-800"}`}>{n(v).toLocaleString()}</span>},
        {key:"ubicacion",label:"Ubicación"},
        {key:"precio",label:"Precio",render:v=>n(v)>0?`$${n(v).toFixed(2)}`:"—"},
      ]} data={paginated} onRowClick={r=>openEdit(r)} />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
    <Modal open={!!modal} onClose={()=>setModal(null)} title={modal==="new"?"Nuevo Producto":"Editar Producto"}>
      <div className="space-y-3">
        <FormInput label="SKU *" value={form.sku} onChange={e=>setForm({...form,sku:e.target.value.toUpperCase()})} placeholder="Ej: HC-25K" error={errors.sku} />
        <FormInput label="Nombre *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} error={errors.nombre} />
        <FormSelect label="Tipo" options={["Producto Terminado","Empaque"]} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})} />
        <FormInput label="Stock inicial" type="number" value={form.stock} onChange={e=>setForm({...form,stock:e.target.value})} />
        <FormSelect label="Ubicación" options={["CF-1","CF-2","CF-3","Almacén"]} value={form.ubicacion} onChange={e=>setForm({...form,ubicacion:e.target.value})} />
        {form.tipo==="Producto Terminado"&&<FormInput label="Precio público ($)" type="number" value={form.precio} onChange={e=>setForm({...form,precio:e.target.value})} />}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// PRECIOS
// ═══════════════════════════════════════════════
export function PreciosView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({clienteId:"",sku:"",precio:""});

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

  const save = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = "Requerido";
    if (!form.sku) e.sku = "Requerido";
    if (!form.precio || n(form.precio) <= 0) e.precio = "Precio debe ser mayor a 0";
    if (Object.keys(e).length) { setErrors(e); return; }
    const cli = data.clientes.find(c => eqId(c.id, form.clienteId));
    actions.addPrecioEsp({clienteId:form.clienteId,clienteNom:s(cli?.nombre),sku:form.sku,precio:form.precio});
    toast?.success("Precio especial creado");
    setModal(false); setForm({clienteId:"",sku:"",precio:""}); setErrors({});
  };

  return (<div>
    <PageHeader title="Precios por Cliente" subtitle="Precio público + overrides" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">Precio público general</h3>
        {prodTerminados.length === 0
          ? <EmptyState message="Sin productos terminados" />
          : prodTerminados.map(p=><div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2"><div><span className="text-sm font-semibold text-slate-700">{s(p.nombre)}</span><span className="text-xs text-slate-400 ml-2">{s(p.sku)}</span></div><span className="text-sm font-bold">${n(p.precio).toFixed(2)}</span></div>)}
      </div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">Precios especiales</h3>
        {(data.preciosEsp || []).length === 0 && <EmptyState message="Sin precios especiales" />}
        {data.preciosEsp.map(p=>{const base=precioBaseMap[p.sku]||0;const desc=base>0?Math.round(((base-n(p.precio))/base)*100):0;
          return<div key={p.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><span className="text-sm font-semibold text-slate-700 truncate block">{s(p.clienteNom)}</span><span className="text-xs text-slate-400">{s(p.sku)}</span></div><div className="flex items-center gap-2 flex-shrink-0"><span className="text-sm font-bold text-blue-600">${n(p.precio).toFixed(2)}</span>{desc>0&&<span className="text-xs text-emerald-600">-{desc}%</span>}<button onClick={()=>actions.deletePrecioEsp(p.id)} className="text-xs text-red-400 hover:text-red-600 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center">✕</button></div></div></div>})}
        <button onClick={()=>{setModal(true);setErrors({})}} className="mt-3 w-full py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-400 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-1 min-h-[44px]"><Icons.Plus /> Agregar</button>
      </div>
    </div>
    <Modal open={modal} onClose={()=>setModal(false)} title="Nuevo precio especial">
      <div className="space-y-3">
        <FormSelect label="Cliente *" options={clienteOptions} value={form.clienteId} onChange={e=>setForm({...form,clienteId:e.target.value})} error={errors.clienteId} />
        <FormSelect label="Producto *" options={prodOptions} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} error={errors.sku} />
        <FormInput label="Precio especial ($) *" type="number" value={form.precio} onChange={e=>setForm({...form,precio:e.target.value})} placeholder="Ej: 78" error={errors.precio} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// PRODUCCIÓN
// ═══════════════════════════════════════════════
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

  const save = () => {
    const e = {};
    if (!form.cantidad || n(form.cantidad) <= 0) e.cantidad = "Cantidad debe ser mayor a 0";
    if (bolsaNecesaria && n(form.cantidad) > stockBolsa) e.cantidad = "Stock insuficiente de " + bolsaNecesaria + " (" + stockBolsa + " disp.)";
    if (Object.keys(e).length) { setErrors(e); return; }
    actions.addProduccion(form);
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

  return (<div>
    <PageHeader title="Producir hielo" subtitle="Crear y confirmar producción" action={()=>{setModal(true);setErrors({})}} actionLabel="Nueva orden" />
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

// ═══════════════════════════════════════════════
// INVENTARIO
// ═══════════════════════════════════════════════
export function InventarioView({ data, actions }) {
  const toast = useToast();
  const [pageExist, setPageExist] = useState(0);
  const [pageKardex, setPageKardex] = useState(0);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [traspasoForm, setTraspasoForm] = useState({origen:"CF-1",destino:"CF-2",sku:"HC-25K",cantidad:""});
  const [traspasoErrors, setTraspasoErrors] = useState({});
  const [cfModal, setCfModal] = useState(null);
  const [cfForm, setCfForm] = useState({nombre:"",temp:"-10",capacidad:"0"});

  const prodTerminados = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);
  
    // Compute stock por producto sumando de todos los cuartos fríos + ubicaciones
    const prodConStock = useMemo(() => {
      return prodTerminados.map(p => {
        let totalStock = 0;
        const ubicaciones = [];
        for (const cf of data.cuartosFrios) {
          const qty = cf.stock ? cf.stock[s(p.sku)] : 0;
          if (qty && qty > 0) {
            totalStock += qty;
            ubicaciones.push(`${s(cf.nombre)} (${qty})`);
          }
        }
        return {
          ...p,
          stock: totalStock,
          ubicacion: ubicaciones.length > 0 ? ubicaciones.join(', ') : 'Sin stock'
        };
      });
    }, [prodTerminados, data.cuartosFrios]);
  
    const paginatedProd = useMemo(() => prodConStock.slice(pageExist * PAGE_SIZE, (pageExist + 1) * PAGE_SIZE), [prodConStock, pageExist]);
  const paginatedMov = useMemo(() => data.inventarioMov.slice(pageKardex * PAGE_SIZE, (pageKardex + 1) * PAGE_SIZE), [data.inventarioMov, pageKardex]);

  const cfOptions = useMemo(() => data.cuartosFrios.map(cf => ({value: s(cf.id), label: s(cf.nombre)})), [data.cuartosFrios]);
  const skuProd = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado").map(p => s(p.sku)), [data.productos]);

  const hacerTraspaso = () => {
    const e = {};
    if (!traspasoForm.cantidad || n(traspasoForm.cantidad) <= 0) e.cantidad = "Requerido";
    if (traspasoForm.origen === traspasoForm.destino) e.destino = "Debe ser diferente al origen";
    const cfOrigen = data.cuartosFrios.find(cf => cf.id === traspasoForm.origen);
    if (cfOrigen && cfOrigen.stock && (cfOrigen.stock[traspasoForm.sku] || 0) < n(traspasoForm.cantidad)) e.cantidad = "Stock insuficiente en origen";
    if (Object.keys(e).length) { setTraspasoErrors(e); return; }
    if (actions.traspasoEntreUbicaciones) {
      actions.traspasoEntreUbicaciones(traspasoForm);
    }
    toast?.success(traspasoForm.cantidad + " " + traspasoForm.sku + " de " + traspasoForm.origen + " a " + traspasoForm.destino);
    setTraspasoModal(false); setTraspasoForm({origen:"CF-1",destino:"CF-2",sku:"HC-25K",cantidad:""}); setTraspasoErrors({});
  };

  const totalStockByCF = useMemo(() => {
    return data.cuartosFrios.map(cf => {
      const stockEntries = cf.stock ? Object.entries(cf.stock) : [];
      const total = stockEntries.reduce((s, [, v]) => s + n(v), 0);
      return { ...cf, stockEntries, total };
    });
  }, [data.cuartosFrios]);

  return (<div>
    <div className="flex items-center justify-between mb-4">
      <div><h2 className="text-lg font-bold text-slate-800">Inventario</h2><p className="text-xs text-slate-400">Cuartos fríos, existencias y movimientos</p></div>
      <div className="flex gap-2">
        <button onClick={()=>{setCfForm({nombre:"",temp:"-10",capacidad:"0"});setCfModal("new")}} className="px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Cuarto Frío</button>
        <button onClick={()=>{setTraspasoModal(true);setTraspasoErrors({})}} className="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl min-h-[44px]">Traspaso</button>
      </div>
    </div>
    <div className="flex sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6 overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
      {totalStockByCF.length === 0 ? <EmptyState message="Sin cuartos fríos" /> :
      totalStockByCF.map(cf=><div key={cf.id} className="min-w-[220px] sm:min-w-0 flex-shrink-0 sm:flex-shrink bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 snap-start">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 cursor-pointer" onClick={()=>{setCfForm({nombre:s(cf.nombre),temp:String(n(cf.temp, -50, 10)),capacidad:String(n(cf.capacidad))});setCfModal(cf)}}>
            <h3 className="text-sm font-bold text-slate-700">{s(cf.nombre)}</h3>
            <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">{n(cf.temp, -50, 10)}°C</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={e=>{e.stopPropagation();setCfForm({nombre:s(cf.nombre),temp:String(n(cf.temp, -50, 10)),capacidad:String(n(cf.capacidad))});setCfModal(cf);}} className="p-1 text-slate-500 hover:text-blue-600">
              <Icons.Edit />
            </button>
            <button onClick={async e=>{e.stopPropagation();if(confirm('¿Eliminar ' + s(cf.nombre) + '?')){await actions.deleteCuartoFrio(cf.id); toast?.success('Cuarto frío eliminado');}}} className="p-1 text-red-500 hover:text-red-700">
              <Icons.X />
            </button>
          </div>
        </div>
        <CapacityBar pct={n(cf.capacidad)}/>
        <p className="text-xs text-slate-400 mt-2">{n(cf.capacidad)}% capacidad</p>
        <div className="mt-3 space-y-1">
          {cf.stockEntries.map(([sku, qty]) => (
            <div key={sku} className="flex justify-between text-xs">
              <span className="font-mono text-slate-500">{sku}</span>
              <span className="font-bold text-slate-700">{n(qty).toLocaleString()}</span>
            </div>
          ))}
          {cf.stockEntries.length === 0 && <p className="text-xs text-slate-400">Vacío</p>}
        </div>
        <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs">
          <span className="text-slate-400">Total</span>
          <span className="font-extrabold text-slate-800">{cf.total.toLocaleString()} bolsas</span>
        </div>
      </div>)}
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-5 mb-6">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Existencias</h3>
      <DataTable columns={[
        {key:"sku",label:"SKU",render:v=><span className="font-mono text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{s(v)}</span>},
        {key:"nombre",label:"Producto",bold:true},{key:"tipo",label:"Tipo",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"stock",label:"Existencia",render:(v,r)=><span className={`font-bold ${s(r.tipo)==="Empaque"&&n(v)<200?"text-red-600":"text-slate-800"}`}>{n(v).toLocaleString()}</span>},
        {key:"ubicacion",label:"Ubicación"},
      ]} data={paginatedProd} />
      <Paginator page={pageExist} total={data.productos.length} onPage={setPageExist} />
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Kardex</h3>
      <DataTable columns={[
        {key:"fecha",label:"Fecha",render:v=>fmtDateTime(v)},{key:"tipo",label:"Tipo",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"producto",label:"Producto",bold:true},
        {key:"cantidad",label:"Qty",render:v=>{const num=n(v,-999999);return<span className={`font-mono font-semibold ${num>0?"text-emerald-600":num<0?"text-red-500":"text-slate-600"}`}>{num>0?`+${num}`:num}</span>}},
        {key:"origen",label:"Referencia"},{key:"usuario",label:"Usuario"},
      ]} data={paginatedMov} />
      <Paginator page={pageKardex} total={data.inventarioMov.length} onPage={setPageKardex} />
    </div>

    <Modal open={traspasoModal} onClose={()=>setTraspasoModal(false)} title="Traspaso entre ubicaciones">
      <div className="space-y-3">
        <FormSelect label="Origen *" options={cfOptions} value={traspasoForm.origen} onChange={e=>setTraspasoForm({...traspasoForm,origen:e.target.value})} />
        <FormSelect label="Destino *" options={cfOptions} value={traspasoForm.destino} onChange={e=>setTraspasoForm({...traspasoForm,destino:e.target.value})} error={traspasoErrors.destino} />
        <FormSelect label="Producto" options={skuProd} value={traspasoForm.sku} onChange={e=>setTraspasoForm({...traspasoForm,sku:e.target.value})} />
        <FormInput label="Cantidad *" type="number" value={traspasoForm.cantidad} onChange={e=>setTraspasoForm({...traspasoForm,cantidad:e.target.value})} placeholder="Ej: 100" error={traspasoErrors.cantidad} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setTraspasoModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={hacerTraspaso}>Traspasar</FormBtn></div>
    </Modal>

    {/* Modal: Crear / Editar Cuarto Frío */}
    <Modal open={!!cfModal} onClose={()=>setCfModal(null)} title={cfModal==="new"?"Nuevo cuarto frío":"Editar cuarto frío"}>
      <div className="space-y-3">
        <FormInput label="Nombre *" value={cfForm.nombre} onChange={e=>setCfForm({...cfForm,nombre:e.target.value})} />
        <FormInput label="Temperatura (°C)" type="number" value={cfForm.temp} onChange={e=>setCfForm({...cfForm,temp:e.target.value})} />
        <FormInput label="Capacidad (%)" type="number" value={cfForm.capacidad} onChange={e=>setCfForm({...cfForm,capacidad:e.target.value})} />
      </div>
      <div className="flex justify-between mt-5">
        {cfModal && cfModal !== "new" && cfModal.id && <button onClick={async ()=>{ if(confirm("¿Eliminar cuarto frío " + s(cfModal.nombre) + "?")) { await actions.deleteCuartoFrio(cfModal.id); toast?.success("Cuarto frío eliminado"); setCfModal(null); } }} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
        <div className="flex gap-2 ml-auto">
          <FormBtn onClick={()=>setCfModal(null)}>Cancelar</FormBtn>
          <FormBtn primary onClick={async ()=>{
            const e = {};
            if (!cfForm.nombre || !cfForm.nombre.trim()) { toast?.error('Nombre requerido'); return; }
            const payload = { nombre: cfForm.nombre, temp: Number(cfForm.temp), capacidad: Number(cfForm.capacidad) };
            if (cfModal === "new") { await actions.addCuartoFrio(payload); toast?.success('Cuarto frío creado'); }
            else { await actions.updateCuartoFrio(cfModal.id, payload); toast?.success('Cuarto frío actualizado'); }
            setCfModal(null);
          }}>Guardar</FormBtn>
        </div>
      </div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// ÓRDENES
// ═══════════════════════════════════════════════
export function OrdenesView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({clienteId:"",fecha:""});
  const [lines, setLines] = useState([]);

  const dSearch = useDebounce(search);

  const clienteOpts = useMemo(() => [{value:"",label:"Seleccionar..."},...(data.clientes || []).filter(c=>c.estatus==="Activo").map(c=>({value:String(c.id),label:s(c.nombre)}))], [data.clientes]);
  const prodTerminados = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);
  const prodOpts = useMemo(() => [{value:"",label:"Seleccionar producto..."},...prodTerminados.map(p=>({value:s(p.sku),label:`${s(p.sku)} — ${s(p.nombre)} (${n(p.stock)} disp.)`}))], [prodTerminados]);

  const getPrice = useCallback((cId, sku) => {
    if (cId) { const esp = data.preciosEsp.find(p => eqId(p.clienteId, cId) && p.sku === sku); if (esp) return n(esp.precio); }
    const prod = data.productos.find(p => p.sku === sku);
    return prod ? n(prod.precio) : 0;
  }, [data.preciosEsp, data.productos]);

  const handleClientChange = (cId) => { setForm(f=>({...f,clienteId:cId})); setLines(prev=>prev.map(l=>({...l,precio:getPrice(cId,l.sku)}))); };
  const addLine = () => setLines(prev=>[...prev,{sku:"",qty:1,precio:0}]);
  const updateLine = (idx, field, val) => setLines(prev=>prev.map((l,i)=>{
    if(i!==idx) return l;
    const u={...l,[field]:val};
    if(field==="sku") u.precio=getPrice(form.clienteId,val);
    return u;
  }));
  const removeLine = (idx) => setLines(prev=>prev.filter((_,i)=>i!==idx));

  const subtotal = useMemo(()=>lines.reduce((s,l)=>s+(n(l.qty)*n(l.precio)),0),[lines]);
  const iva = useMemo(()=>Math.round(subtotal*16)/100,[subtotal]);
  const totalCalc = subtotal+iva;
  const productosStr = useMemo(()=>lines.filter(l=>l.sku&&l.qty>0).map(l=>`${l.qty}×${l.sku}`).join(", "),[lines]);

  const save = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = "Requerido";
    if (lines.length===0||!lines.some(l=>l.sku&&l.qty>0)) e.productos = "Agrega al menos un producto";
    for(const l of lines){if(l.sku){const p=data.productos.find(x=>x.sku===l.sku);if(p&&l.qty>p.stock){e.productos=`Stock insuficiente: ${l.sku} (${p.stock} disp.)`;break;}}}
    if (Object.keys(e).length) { setErrors(e); return; }
    const cli = data.clientes.find(c => eqId(c.id, form.clienteId));
    actions.addOrden({cliente:s(cli?.nombre),clienteId:form.clienteId,fecha:form.fecha||new Date().toISOString().slice(0,10),productos:productosStr,total:totalCalc});
    toast?.success("Orden creada");
    setModal(false); setForm({clienteId:"",fecha:""}); setLines([]); setErrors({});
  };
  const openModal = () => { setModal(true); setErrors({}); setLines([{sku:"",qty:1,precio:0}]); };

  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({metodo:"Efectivo",referencia:""});

  const cobrarOrden = (ord, tipo) => { setPagoModal({...ord, tipoCobro: tipo || "oficina"}); setPagoForm({metodo:"Efectivo",referencia:""}); };
  const confirmarCobro = () => {
    if (!pagoModal) return;
    actions.updateOrdenEstatus(pagoModal.id, "Entregada");
    toast?.success("Orden " + s(pagoModal.folio) + " cobrada - " + pagoForm.metodo);
    setPagoModal(null);
  };

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.ordenes.filter(o => {
      const ms = !q || s(o.folio).toLowerCase().includes(q) || s(o.cliente).toLowerCase().includes(q);
      const me = !filterEst || o.estatus === filterEst; return ms && me;
    });
  }, [data.ordenes, dSearch, filterEst]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  return (<div>
    <PageHeader title="Ventas" subtitle="Crear venta, cobrar y asignar entregas" action={openModal} actionLabel="Nueva orden" />
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar folio o cliente..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterEst} onChange={e=>{setFilterEst(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos</option>{["Creada","Asignada","Entregada","Facturada"].map(st=><option key={st}>{st}</option>)}</select>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5">
      <DataTable columns={[
        {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span>},
        {key:"cliente",label:"Cliente",bold:true},{key:"fecha",label:"Fecha",render:v=>fmtDate(v),hideOnMobile:true},
        {key:"productos",label:"Productos",render:v=><span className="text-xs text-slate-500 font-mono">{s(v)}</span>,hideOnMobile:true},
        {key:"total",label:"Total",bold:true,render:v=>`$${n(v).toLocaleString()}`},
        {key:"estatus",label:"Estatus",badge:true,render:(v,r)=><div className="flex items-center gap-2 flex-wrap"><StatusBadge status={v}/><span className="hidden md:inline">{v==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"oficina")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="text-xs text-blue-600 font-semibold px-2 py-0.5">Asignar ruta</button></>}{v==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"ruta")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar entrega</button>}{v==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="text-xs text-purple-600 font-semibold px-2 py-0.5">→ Facturar</button>}</span></div>},
        {key:"ruta",label:"Ruta",hideOnMobile:true},
      ]} data={paginated}
      cardSubtitle={r => {
        const est = r.estatus;
        const btn = (label, color, next) => <button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,next)}} className={`mt-2 w-full text-xs font-semibold ${color} px-3 py-2.5 rounded-lg min-h-[44px]`}>{label}</button>;
        return <div>
          <span className="text-xs text-slate-400">{fmtDate(r.fecha)} · {s(r.productos)}</span>
          {est==="Creada"&&<div className="flex gap-2 mt-2"><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"oficina")}} className="flex-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar en tienda</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="flex-1 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg min-h-[44px]">Asignar a ruta</button></div>}
          {est==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"ruta")}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar entrega</button>}
          {est==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="mt-2 w-full text-xs font-semibold text-purple-600 bg-purple-50 px-3 py-2.5 rounded-lg min-h-[44px]">→ Facturar</button>}
        </div>;
      }}
      />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
    <Modal open={modal} onClose={()=>setModal(false)} title="Nueva orden de venta" wide>
      <div className="space-y-3">
        <FormSelect label="Cliente *" options={clienteOpts} value={form.clienteId} onChange={e=>handleClientChange(e.target.value)} error={errors.clienteId} />
        <FormInput label="Fecha entrega" type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})} />
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Productos *</label>
          {lines.map((l,i)=>(
            <div key={i} className="flex items-center gap-2 mb-2">
              <select value={l.sku} onChange={e=>updateLine(i,"sku",e.target.value)} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white min-h-[44px]">
                {prodOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="number" min="1" value={l.qty} onChange={e=>updateLine(i,"qty",parseInt(e.target.value)||1)} className="w-16 border border-slate-200 rounded-xl px-2 py-2.5 text-sm text-center min-h-[44px]" />
              <span className="text-sm font-semibold text-slate-600 w-20 text-right">${(n(l.qty)*n(l.precio)).toLocaleString()}</span>
              {lines.length>1&&<button onClick={()=>removeLine(i)} className="text-red-400 hover:text-red-600 text-lg min-w-[28px]">×</button>}
            </div>
          ))}
          <button onClick={addLine} className="text-xs text-blue-600 font-semibold mt-1">+ Agregar producto</button>
          {errors.productos&&<p className="text-xs text-red-500 mt-1">{errors.productos}</p>}
        </div>
        <div className="bg-slate-50 rounded-xl p-3 mt-2 space-y-1">
          <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>${subtotal.toLocaleString()}</span></div>
          <div className="flex justify-between text-sm text-slate-500"><span>IVA 16%</span><span>${iva.toLocaleString()}</span></div>
          <div className="flex justify-between text-sm font-bold text-slate-800 border-t border-slate-200 pt-1"><span>Total</span><span>${totalCalc.toLocaleString()}</span></div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Crear orden</FormBtn></div>
    </Modal>

    {/* MODAL DE COBRO - VENTAS */}
    {pagoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>setPagoModal(null)}>
        <div className="bg-white w-full max-w-md rounded-2xl p-5" onClick={e=>e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-1">Cobrar orden {s(pagoModal.folio)}</h3>
          <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} &mdash; <span className="font-bold text-slate-800">${n(pagoModal.total).toLocaleString()}</span></p>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">M&eacute;todo de pago</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {["Efectivo","Transferencia SPEI","Tarjeta (terminal)","QR / Link de pago","Crédito (fiado)"].map(m=>(
              <button key={m} onClick={()=>setPagoForm(f=>({...f,metodo:m}))}
                className={`py-3 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${pagoForm.metodo===m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                {m}
              </button>
            ))}
          </div>
          {pagoForm.metodo==="Transferencia SPEI" && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Referencia SPEI</label>
              <input value={pagoForm.referencia} onChange={e=>setPagoForm(f=>({...f,referencia:e.target.value}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Últimos 6 dígitos"/>
            </div>
          )}
          {pagoForm.metodo==="QR / Link de pago" && (
            <div className="mb-4 p-3 bg-blue-50 rounded-xl">
              <p className="text-xs text-blue-700 font-semibold mb-1">Próximamente</p>
              <p className="text-xs text-blue-600">Se generará QR de Mercado Pago / Stripe.</p>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={()=>setPagoModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600">Cancelar</button>
            <button onClick={confirmarCobro} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold">Confirmar cobro</button>
          </div>
        </div>
      </div>
    )}
  </div>);
}

// ═══════════════════════════════════════════════
// RUTAS
// ═══════════════════════════════════════════════
export function RutasView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({nombre:"",chofer:""});
  const [asignarModal, setAsignarModal] = useState(null);
  const [cierreModal, setCierreModal] = useState(null);
  const [cierreForm, setCierreForm] = useState({devuelto:""});

  // Órdenes sin asignar a ruta
  const ordenesSinRuta = useMemo(() => data.ordenes.filter(o => o.estatus === "Asignada" && !o.rutaId), [data.ordenes]);
  const choferes = useMemo(() => (data.usuarios || []).filter(u => s(u.rol) === "Chofer").map(u => s(u.nombre)), [data.usuarios]);

  const save = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.chofer) e.chofer = "Requerido";
    if (Object.keys(e).length) { setErrors(e); return; }
    actions.addRuta({...form, ordenes: 0, carga: "0 bolsas"});
    toast?.success("Ruta creada");
    setModal(false); setForm({nombre:"",chofer:""}); setErrors({});
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
    setCierreForm({devuelto:""});
  };
  const confirmarCierre = () => {
    if (!cierreModal) return;
    if (actions.cerrarRuta) {
      actions.cerrarRuta(cierreModal.id, n(cierreForm.devuelto));
    }
    toast?.success("Ruta " + s(cierreModal.nombre) + " cerrada");
    setCierreModal(null);
  };

  return (<div>
    <PageHeader title="Entregas" subtitle="Rutas de distribución" action={()=>{setModal(true);setErrors({})}} actionLabel="Crear ruta" />
    
    {ordenesSinRuta.length > 0 && (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center justify-between">
        <p className="text-xs text-amber-700 font-semibold">{ordenesSinRuta.length} órdenes sin asignar a ruta</p>
      </div>
    )}

    {data.rutas.length === 0
      ? <EmptyState message="Sin rutas programadas" />
      : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
      {data.rutas.map(r => {
        const rutaOrdenes = data.ordenes.filter(o => o.rutaId === r.id || eqId(o.rutaId, r.id));
        const entregadas = rutaOrdenes.filter(o => o.estatus === "Entregada").length;
        return (
        <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 hover:shadow-md hover:border-blue-200 transition-all">
          <div className="flex items-center justify-between mb-2"><span className="font-mono text-xs text-slate-400">{s(r.folio)}</span><StatusBadge status={r.estatus}/></div>
          <h3 className="text-base font-bold text-slate-800 mb-1">{s(r.nombre)}</h3>
          <p className="text-xs text-slate-500 mb-3">{s(r.chofer)} · {rutaOrdenes.length} órdenes · {s(r.carga)}</p>
          <div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-400">Entregas</span><span className="font-semibold">{entregadas}/{rutaOrdenes.length}</span></div>
          <CapacityBar pct={rutaOrdenes.length>0?(entregadas/rutaOrdenes.length)*100:0}/>
          
          {r.estatus==="Programada"&&<div className="space-y-2 mt-3">
            <div className="flex gap-2">
              <button onClick={()=>asignarOrdenes(r)} className="flex-1 py-2.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded-xl min-h-[44px]">+ Asignar órdenes</button>
              <button onClick={()=>actions.updateRutaEstatus(r.id,"En progreso")} className="flex-1 py-2.5 bg-blue-600 text-white text-xs font-semibold rounded-xl min-h-[44px]">Iniciar</button>
            </div>
            <button onClick={() => { if(confirm("¿Eliminar ruta " + s(r.nombre) + "?")) actions.deleteRuta(r.id); }} className="w-full py-2 text-red-500 text-xs font-semibold hover:bg-red-50 rounded-xl">Eliminar ruta</button>
          </div>}
          {r.estatus==="En progreso"&&<p className="mt-3 text-xs text-blue-600 text-center font-semibold">🚛 En camino — el chofer cierra desde su app</p>}
          {r.estatus==="Completada"&&<p className="mt-3 text-xs text-emerald-600 text-center font-semibold">✓ Completada por el chofer</p>}
          {r.estatus==="Cerrada"&&<p className="mt-3 text-xs text-slate-400 text-center">Ruta cerrada ✓</p>}
        </div>);
      })}
    </div>}

    {/* Modal crear ruta */}
    <Modal open={modal} onClose={()=>setModal(false)} title="Crear ruta">
      <div className="space-y-3">
        <FormInput label="Nombre *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Ej: Ruta Norte" error={errors.nombre} />
        <FormSelect label="Chofer *" options={["", ...choferes]} value={form.chofer} onChange={e=>setForm({...form,chofer:e.target.value})} error={errors.chofer} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Crear ruta</FormBtn></div>
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
              <div><span className="text-slate-400">Carga:</span> <span className="font-semibold">{s(cierreModal.carga)}</span></div>
              <div><span className="text-slate-400">Órdenes:</span> <span className="font-semibold">{n(cierreModal.ordenes)}</span></div>
              <div><span className="text-slate-400">Entregadas:</span> <span className="font-semibold">{n(cierreModal.entregadas)}</span></div>
            </div>
          </div>
          <FormInput label="Bolsas devueltas (sobrante)" type="number" value={cierreForm.devuelto} onChange={e=>setCierreForm({devuelto:e.target.value})} placeholder="Ej: 15" />
          {cierreForm.devuelto && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-blue-700">{cierreForm.devuelto} bolsas regresan a cuarto frío</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setCierreModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={confirmarCierre}>Cerrar ruta</FormBtn></div>
      </Modal>
    )}
  </div>);
}

// Component: Asignar órdenes modal
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

// ═══════════════════════════════════════════════
export function FacturacionView({ data, actions }) {
  const toast = useToast();

  // FIX P5a: Two separate .filter() on ordenes ran every render = 2×1000 iterations
  // Now single pass, memoized
  const { timbradas, totalFact } = useMemo(() => {
    let count = 0, sum = 0;
    for (const o of data.ordenes) {
      if (o.estatus === "Facturada") { count++; sum += n(o.total); }
    }
    return { timbradas: count, totalFact: sum };
  }, [data.ordenes]);

  // FIX P5b: handleTimbrar recreated every render, passed to every row button
  const handleTimbrar = useCallback((folio) => {
    actions.timbrar(folio);
    toast?.success(`CFDI timbrado: ${folio}`);
  }, [actions, toast]);

  return (<div>
    <PageHeader title="Facturación CFDI" subtitle="Timbrado manual" />
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Por facturar</p><p className="text-xl sm:text-3xl font-extrabold text-amber-600 mt-1 sm:mt-2">{(data.facturacionPendiente || []).length}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturadas</p><p className="text-xl sm:text-3xl font-extrabold text-emerald-600 mt-1 sm:mt-2">{timbradas}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturado</p><p className="text-xl sm:text-3xl font-extrabold text-slate-800 mt-1 sm:mt-2">${totalFact.toLocaleString("es-MX",{minimumFractionDigits:0})}</p></div>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Pendientes de factura</h3>
      {(data.facturacionPendiente || []).length===0?<p className="text-sm text-slate-400 text-center py-6">Todo facturado ✓</p>:
      <DataTable columns={[
        {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span>},
        {key:"cliente",label:"Cliente",bold:true},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"fecha",label:"Entrega",render:v=>fmtDate(v)},{key:"total",label:"Total",bold:true,render:v=>`$${n(v).toLocaleString()}`},
        {key:"folio",label:"Acción",hideOnMobile:true,render:(v)=><button onClick={(e)=>{e.stopPropagation();handleTimbrar(v)}} className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 min-h-[44px]">Timbrar CFDI</button>},
      ]} data={data.facturacionPendiente}
      cardSubtitle={r => <button onClick={(e)=>{e.stopPropagation();handleTimbrar(r.folio)}} className="mt-2 w-full text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg hover:bg-blue-100 min-h-[44px]">Timbrar CFDI</button>}
      />}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════
// CONCILIACIÓN
// ═══════════════════════════════════════════════
export function ConciliacionView({ data }) {
  // Auto-calculated: group orders and mermas by ruta
  const rutasCompletas = useMemo(() => {
    return (data.rutas || []).filter(r => r.estatus === "Completada" || r.estatus === "Cerrada").map(ruta => {
      const rutaOrdenes = data.ordenes.filter(o => eqId(o.rutaId, ruta.id));
      const entregadas = rutaOrdenes.filter(o => o.estatus === "Entregada");
      const totalVendido = entregadas.reduce((s, o) => s + n(o.total), 0);
      const totalCobrado = entregadas.filter(o => o.metodoPago !== "Crédito").reduce((s, o) => s + n(o.total), 0);
      const totalCredito = entregadas.filter(o => o.metodoPago === "Crédito").reduce((s, o) => s + n(o.total), 0);
      return { ...ruta, rutaOrdenes, entregadas, totalVendido, totalCobrado, totalCredito };
    });
  }, [data.rutas, data.ordenes]);

  return (<div>
    <PageHeader title="Cortes de Caja" subtitle="Conciliación automática de rutas" />
    {rutasCompletas.length === 0 ? (
      <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
        <p className="text-sm text-slate-400">Sin rutas completadas aún. Cuando un chofer cierre su ruta desde la app, aparecerá aquí automáticamente.</p>
      </div>
    ) : rutasCompletas.map(ruta => (
      <div key={ruta.id} className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{s(ruta.nombre)} — {s(ruta.folio)}</h3>
            <p className="text-xs text-slate-400">{s(ruta.choferNombre || ruta.chofer)} · {s(ruta.fecha)}</p>
          </div>
          <StatusBadge status={ruta.estatus} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] text-blue-500 uppercase font-bold">Órdenes</p><p className="text-lg font-extrabold text-blue-700">{ruta.entregadas.length}/{ruta.rutaOrdenes.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] text-emerald-500 uppercase font-bold">Vendido</p><p className="text-lg font-extrabold text-emerald-700">${ruta.totalVendido.toLocaleString()}</p></div>
          <div className="bg-purple-50 rounded-xl p-3"><p className="text-[10px] text-purple-500 uppercase font-bold">Cobrado</p><p className="text-lg font-extrabold text-purple-700">${ruta.totalCobrado.toLocaleString()}</p></div>
          <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] text-amber-500 uppercase font-bold">Crédito</p><p className="text-lg font-extrabold text-amber-700">${ruta.totalCredito.toLocaleString()}</p></div>
        </div>
        {ruta.entregadas.length > 0 && (
          <div className="space-y-1.5">
            {ruta.entregadas.map(o => (
              <div key={o.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg">
                <div><span className="font-mono text-xs text-blue-600 font-bold">{s(o.folio)}</span> <span className="text-sm text-slate-700 ml-1">{s(o.clienteNombre || o.cliente)}</span></div>
                <div className="text-right"><span className="text-sm font-bold">${n(o.total).toLocaleString()}</span> <span className="text-xs text-slate-400 ml-1">{s(o.metodoPago) || "—"}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>);
}

// ═══════════════════════════════════════════════
// AUDITORÍA
// ═══════════════════════════════════════════════
export function AuditoriaView({ data }) {
  const [filterUsr, setFilterUsr] = useState("");
  const [page, setPage] = useState(0);

  // FIX P6: filter + Set + map + filter(Boolean) ran every render.
  // With 500 audit entries: 500 iterations for filter + 500 for Set + 500 for map = 1500 ops per render.
  const users = useMemo(() => [...new Set(data.auditoria.map(a => s(a.usuario)).filter(Boolean))], [data.auditoria]);
  const filtered = useMemo(() => data.auditoria.filter(a => !filterUsr || s(a.usuario) === filterUsr), [data.auditoria, filterUsr]);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  return (<div>
    <PageHeader title="Auditoría" subtitle="Historial de acciones" />
    <div className="flex items-center gap-3 mb-4">
      <select value={filterUsr} onChange={e=>{setFilterUsr(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos los usuarios</option>{users.map(u=><option key={u}>{u}</option>)}</select>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <DataTable columns={[
        {key:"fecha",label:"Fecha",render:v=>fmtDateTime(v)},{key:"usuario",label:"Usuario",bold:true},
        {key:"accion",label:"Acción"},{key:"modulo",label:"Módulo"},{key:"detalle",label:"Detalle"},
      ]} data={paginated} />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
  </div>);
}

// ═══════════════════════════════════════════════
// ALMACÉN DE BOLSAS
// ═══════════════════════════════════════════════
export function AlmacenBolsasView({ data }) {
  const bolsas = (data.productos || []).filter(p => s(p.tipo) === "Empaque");
  const movs = useMemo(() => (data.inventarioMov || []).filter(m => bolsas.some(b => s(b.sku) === s(m.producto))).slice(0, 30), [data.inventarioMov, bolsas]);
  const prodHoy = useMemo(() => (data.produccion || []).filter(p => s(p.fecha) === new Date().toISOString().slice(0, 10)), [data.produccion]);

  // Partida doble: entradas vs salidas vs consumo
  const balance = useMemo(() => {
    const result = {};
    for (const b of bolsas) result[s(b.sku)] = { entradas: 0, salidas: 0, consumo: 0 };
    // Movimientos de almacén (registrados por encargada)
    for (const m of (data.inventarioMov || [])) {
      const sku = s(m.producto);
      if (!result[sku]) continue;
      if (s(m.tipo) === "Entrada") result[sku].entradas += n(m.cantidad);
      else if (s(m.tipo) === "Salida") result[sku].salidas += n(m.cantidad);
      else if (s(m.tipo) === "Consumo") result[sku].consumo += n(m.cantidad);
    }
    return result;
  }, [data.inventarioMov, bolsas]);

  return (<div>
    <PageHeader title="Insumos (Bolsas)" subtitle="Control cruzado: almacén registra entrada/salida, producción consume" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      {bolsas.map(b => {
        const bal = balance[s(b.sku)] || { salidas: 0, consumo: 0 };
        const dif = bal.salidas - bal.consumo; // si 0: cuadra
        return (
        <div key={b.id} className="bg-white rounded-xl p-5 border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold">{s(b.nombre)}</p>
              <p className="text-3xl font-extrabold text-slate-800 mt-1">{n(b.stock).toLocaleString()}</p>
              <p className="text-xs text-slate-400">en almacén</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${n(b.stock) < 200 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {n(b.stock) < 200 ? "BAJO" : "OK"}
            </div>
          </div>
          {(bal.entradas > 0 || bal.salidas > 0 || bal.consumo > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Partida doble</p>
              <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                <div className="bg-emerald-50 rounded-lg p-2"><p className="text-emerald-400 font-bold">Entró</p><p className="text-emerald-700 font-extrabold">{bal.entradas}</p></div>
                <div className="bg-red-50 rounded-lg p-2"><p className="text-red-400 font-bold">Salió</p><p className="text-red-700 font-extrabold">{bal.salidas}</p></div>
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-blue-400 font-bold">Usó prod.</p><p className="text-blue-700 font-extrabold">{bal.consumo}</p></div>
                <div className={`rounded-lg p-2 ${dif === 0 ? "bg-emerald-50" : "bg-amber-50"}`}><p className={`font-bold ${dif === 0 ? "text-emerald-400" : "text-amber-400"}`}>Dif.</p><p className={`font-extrabold ${dif === 0 ? "text-emerald-700" : "text-amber-700"}`}>{dif === 0 ? "✓ 0" : dif}</p></div>
              </div>
              <p className="text-[10px] text-slate-300 mt-1">Salió (almacén) debe = Usó (producción). Si hay diferencia, investigar.</p>
            </div>
          )}
        </div>);
      })}
    </div>

    {prodHoy.length > 0 && (<div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
      <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">Producción hoy ({prodHoy.length} lotes)</h3>
      {prodHoy.map(p => (
        <div key={p.id} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
          <div><span className="text-sm font-bold text-slate-700">{n(p.cantidad)}× {s(p.sku)}</span> <span className="text-xs text-slate-400 ml-1">{s(p.turno)} · {s(p.maquina)}</span></div>
          <span className="text-xs font-mono text-slate-400">{s(p.folio)}</span>
        </div>
      ))}
    </div>)}

    {movs.length > 0 && (<div className="bg-white border border-slate-100 rounded-2xl p-4">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos de almacén</h3>
      {movs.map(m => (
        <div key={m.id} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
          <div><span className={`text-sm font-bold ${s(m.tipo) === "Entrada" ? "text-emerald-600" : "text-red-600"}`}>{s(m.tipo) === "Entrada" ? "+" : "-"}{n(m.cantidad)}</span> <span className="text-sm text-slate-600 ml-1">{s(m.producto)}</span></div>
          <div className="text-right"><span className="text-xs text-slate-400">{s(m.origen)} · {s(m.usuario)}</span></div>
        </div>
      ))}
    </div>)}
  </div>);
}

// ═══════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// CONFIGURACIÓN (USUARIOS)
// ═══════════════════════════════════════════════
export function ConfiguracionView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const empty = { nombre: "", email: "", rol: "Ventas", password: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (u) => { setForm({ nombre: s(u.nombre), email: s(u.email), rol: s(u.rol), password: "" }); setErrors({}); setModal(u); };

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.email.trim()) e.email = "Requerido";
    if (modal === "new" && !form.password) e.password = "Requerido para nuevo usuario";
    if (modal === "new" && form.password && form.password.length < 6) e.password = "Mínimo 6 caracteres";
    if (Object.keys(e).length) { setErrors(e); return; }

    if (modal === "new") {
      // Create in Supabase Auth using signUp (no service_role key needed)
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      if (signUpError) {
        if (signUpError.message && signUpError.message.includes('rate limit')) {
          setErrors({ email: "⏳ Demasiados intentos. Espera unos minutos e intenta de nuevo" });
        } else {
          setErrors({ email: signUpError.message });
        }
        return;
      }

      // Then create profile in usuarios table with auth_id
      const insertError = await actions.addUsuario({ 
        nombre: form.nombre, 
        email: form.email.trim().toLowerCase(), 
        rol: form.rol, 
        auth_id: authData.user.id,
        estatus: "Activo" 
      });
      
      if (insertError) {
        setErrors({ email: `Error al guardar en base de datos: ${insertError.message}` });
        return;
      }
      
      toast?.success("Usuario creado — ya puede iniciar sesión");
    } else {
      // Edit — only update profile (nombre, rol), not auth
      await actions.updateUsuario(modal.id, { nombre: form.nombre, rol: form.rol });
      toast?.success("Usuario actualizado");
    }
    setModal(null);
  };

  const usuarios = data.usuarios || [];

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Usuarios del sistema</h2><p className="text-xs text-slate-400">{usuarios.length} usuarios · Cada usuario entra con su correo y contraseña</p></div>
      <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo usuario</button>
    </div>
    {usuarios.length === 0 && (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm text-blue-700">Aún no hay usuarios registrados. Usa el botón "+ Nuevo usuario" para dar de alta empleados.</p>
        <p className="text-xs text-blue-500 mt-1">Cada usuario necesita un correo y contraseña para entrar al sistema.</p>
      </div>
    )}
    <div className="space-y-2">
      {usuarios.map(u => (
        <div key={u.id} onClick={() => openEdit(u)} className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between cursor-pointer hover:border-blue-300 transition-all">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">{s(u.nombre)[0] || "?"}</div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{s(u.nombre)}</p>
              <p className="text-xs text-slate-400 truncate">{s(u.email)}</p>
            </div>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full flex-shrink-0 ${
            s(u.rol) === "Admin" ? "bg-purple-100 text-purple-700" :
            s(u.rol) === "Chofer" ? "bg-blue-100 text-blue-700" :
            s(u.rol) === "Ventas" ? "bg-emerald-100 text-emerald-700" :
            s(u.rol) === "Producción" ? "bg-amber-100 text-amber-700" :
            s(u.rol) === "Almacén Bolsas" ? "bg-orange-100 text-orange-700" :
            s(u.rol) === "Sin asignar" ? "bg-red-100 text-red-600" :
            "bg-slate-100 text-slate-600"
          }`}>{s(u.rol)}</span>
        </div>
      ))}
    </div>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "new" ? "Nuevo Usuario" : "Editar Usuario"}>
      <div className="space-y-3">
        <FormInput label="Nombre completo *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} />
        {modal === "new" ? (
          <>
            <FormInput label="Correo electrónico *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} error={errors.email} placeholder="empleado@correo.com" />
            <FormInput label="Contraseña *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} error={errors.password} placeholder="Mínimo 6 caracteres" />
            <p className="text-[10px] text-slate-400">Esta contraseña la usará el empleado para entrar al sistema</p>
          </>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-500">{s(form.email)}</p>
            <p className="text-[10px] text-slate-400 mt-1">El correo y contraseña se manejan en Supabase Auth</p>
          </div>
        )}
        <FormSelect label="Rol — define qué módulo ve al entrar" options={["Admin", "Ventas", "Chofer", "Producción", "Almacén Bolsas", "Facturación", "Sin asignar"]} value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })} />
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 font-semibold mb-1">¿Qué ve cada rol?</p>
          <p className="text-[10px] text-slate-400">Admin → Todo el sistema</p>
          <p className="text-[10px] text-slate-400">Ventas → Captura de pedidos y clientes</p>
          <p className="text-[10px] text-slate-400">Chofer → Carga, entregas y cierre de ruta</p>
          <p className="text-[10px] text-slate-400">Producción → Registro de lotes y congeladores</p>
          <p className="text-[10px] text-slate-400">Almacén Bolsas → Entrada de bolsas</p>
          <p className="text-[10px] text-slate-400">Facturación → Timbrado CFDI</p>
        </div>
      </div>
      <div className="flex justify-between mt-5">
        {modal !== "new" && modal?.id && <button onClick={async () => { if(confirm("¿Eliminar usuario " + s(modal.nombre) + "?")) { await actions.deleteUsuario(modal.id); toast?.success("Usuario eliminado"); setModal(null); }}} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
        <div className="flex gap-2 ml-auto"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>{modal === "new" ? "Crear usuario" : "Guardar"}</FormBtn></div>
      </div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════════
// EMPLEADOS CRUD
// ═══════════════════════════════════════════════════
export function EmpleadosView({ data, actions }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const empty = { nombre: "", rfc: "", curp: "", nss: "", puesto: "", depto: "Ventas y Distribución", salarioDiario: "", fechaIngreso: today(), jornada: "Diurna" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const emps = data.empleados || [];

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (e) => {
    setForm({ nombre: s(e.nombre), rfc: s(e.rfc), curp: s(e.curp), nss: s(e.nss), puesto: s(e.puesto), depto: s(e.depto), salarioDiario: String(n(e.salarioDiario)), fechaIngreso: s(e.fechaIngreso), jornada: s(e.jornada) || "Diurna" });
    setErrors({}); setModal(e);
  };

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.puesto.trim()) e.puesto = "Requerido";
    if (!form.salarioDiario) e.salarioDiario = "Requerido";
    if (Object.keys(e).length) { setErrors(e); return; }
    const payload = { ...form, salarioDiario: parseFloat(form.salarioDiario) };
    if (modal === "new") await actions.addEmpleado(payload);
    else await actions.updateEmpleado(modal.id, payload);
    toast?.success(modal === "new" ? "Empleado registrado" : "Empleado actualizado");
    setModal(null);
  };

  const filtered = emps.filter(e => {
    const q = search.toLowerCase();
    return !q || s(e.nombre).toLowerCase().includes(q) || s(e.puesto).toLowerCase().includes(q) || s(e.depto).toLowerCase().includes(q);
  });
  const deptos = [...new Set(emps.map(e => s(e.depto)))];

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Empleados ({emps.length})</h2></div>
      <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo empleado</button>
    </div>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, puesto o departamento..." className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm min-h-[44px]" />

    {deptos.map(d => {
      const dEmps = filtered.filter(e => s(e.depto) === d);
      if (dEmps.length === 0) return null;
      return (<div key={d}>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">{d} ({dEmps.length})</h3>
        <div className="space-y-2">
          {dEmps.map(e => (
            <div key={e.id} onClick={() => openEdit(e)}
              className="bg-white rounded-xl p-4 border border-slate-100 cursor-pointer hover:border-blue-300 transition-all">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-bold text-slate-800">{s(e.nombre)}</p>
                  <p className="text-xs text-slate-500">{s(e.puesto)} · ${n(e.salarioDiario).toFixed(2)}/día</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${s(e.estatus) === "Activo" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{s(e.estatus)}</span>
              </div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {e.rfc && <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">RFC: {s(e.rfc)}</span>}
                {e.nss && <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">NSS: {s(e.nss)}</span>}
                {e.fechaIngreso && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Ingreso: {s(e.fechaIngreso)}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>);
    })}

    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "new" ? "Nuevo Empleado" : "Editar Empleado"} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormInput label="Nombre completo *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} />
        <FormInput label="RFC" value={form.rfc} onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} maxLength={13} />
        <FormInput label="CURP" value={form.curp} onChange={e => setForm({ ...form, curp: e.target.value.toUpperCase() })} maxLength={18} />
        <FormInput label="NSS" value={form.nss} onChange={e => setForm({ ...form, nss: e.target.value })} />
        <FormInput label="Puesto *" value={form.puesto} onChange={e => setForm({ ...form, puesto: e.target.value })} error={errors.puesto} />
        <FormSelect label="Departamento" options={["Ventas y Distribución", "Producción", "Administración", "Staff"]} value={form.depto} onChange={e => setForm({ ...form, depto: e.target.value })} />
        <FormInput label="Salario diario *" type="number" value={form.salarioDiario} onChange={e => setForm({ ...form, salarioDiario: e.target.value })} error={errors.salarioDiario} />
        <FormInput label="Fecha ingreso" type="date" value={form.fechaIngreso} onChange={e => setForm({ ...form, fechaIngreso: e.target.value })} />
        <FormSelect label="Jornada" options={["Diurna", "Nocturna", "Mixta"]} value={form.jornada} onChange={e => setForm({ ...form, jornada: e.target.value })} />
      </div>
      <div className="space-y-3 border-t border-slate-200 pt-4 mt-5">
        {modal !== "new" && (
          <button onClick={() => {
            if (window.confirm(`¿Desactivar empleado "${s(modal.nombre)}"?`)) {
              actions.updateEmpleado(modal.id, { estatus: "Inactivo" });
              toast?.success("Empleado desactivado");
              setModal(null);
            }
          }} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors">
            🗑 Desactivar empleado
          </button>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════════
// NÓMINA (read for now, shows real employee data)
// ═══════════════════════════════════════════════════
export function NominaView({ data }) {
  const emps = data.empleados || [];
  const deptos = ["Ventas y Distribución", "Producción", "Administración", "Staff"];

  const empsPorDepto = {};
  for (const d of deptos) empsPorDepto[d] = emps.filter(e => s(e.depto) === d && s(e.estatus) === "Activo");
  const totalSemanal = emps.filter(e => s(e.estatus) === "Activo").reduce((s, e) => s + n(e.salarioDiario) * 7, 0);

  return (<div className="space-y-4">
    <h2 className="text-lg font-bold text-slate-800">Nómina</h2>
    <div className="bg-white rounded-xl p-5 border border-slate-100">
      <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Total semanal estimado</p>
      <p className="text-3xl font-extrabold text-slate-800">${totalSemanal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
      <p className="text-xs text-slate-400 mt-1">{emps.filter(e => s(e.estatus) === "Activo").length} empleados activos · Salario × 7 días</p>
    </div>

    {deptos.map(d => {
      const dEmps = empsPorDepto[d] || [];
      if (dEmps.length === 0) return null;
      const totalDepto = dEmps.reduce((s, e) => s + n(e.salarioDiario) * 7, 0);
      return (<div key={d}>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">{d} — {dEmps.length} empleados · ${totalDepto.toLocaleString()}/sem</h3>
        <div className="space-y-1.5">
          {dEmps.map(e => (
            <div key={e.id} className="bg-white rounded-lg p-3 border border-slate-100 flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-slate-800">{s(e.nombre)}</p>
                <p className="text-xs text-slate-400">{s(e.puesto)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-800">${(n(e.salarioDiario) * 7).toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">${n(e.salarioDiario).toFixed(2)}/día</p>
              </div>
            </div>
          ))}
        </div>
      </div>);
    })}
  </div>);
}

// ═══════════════════════════════════════════════════
// CONTABILIDAD CRUD (captura ingresos/egresos)
// ═══════════════════════════════════════════════════
export function ContabilidadView({ data, actions }) {
  const toast = useToast();
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
    await actions.addMovContable({ ...form, monto: parseFloat(form.monto) });
    toast?.success(form.tipo === "Ingreso" ? "Ingreso registrado" : "Gasto registrado");
    setModal(null);
  };

  const egresosPorCat = {};
  for (const e of cont.egresos) {
    const cat = s(e.categoria) || "Otro";
    egresosPorCat[cat] = (egresosPorCat[cat] || 0) + n(e.monto);
  }

  const todos = [...cont.ingresos.map(i => ({ ...i, _tipo: "Ingreso" })), ...cont.egresos.map(e => ({ ...e, _tipo: "Egreso" }))].sort((a, b) => (b.id || 0) - (a.id || 0));

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold text-slate-800">Ingresos / Egresos</h2>
      <div className="flex gap-2">
        <button onClick={() => openNew("Ingreso")} className="px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Ingreso</button>
        <button onClick={() => openNew("Egreso")} className="px-3 py-2 bg-red-500 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Gasto</button>
      </div>
    </div>

    <div className="grid grid-cols-3 gap-3">
      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
        <p className="text-[10px] text-emerald-500 uppercase font-bold">Ingresos</p>
        <p className="text-xl font-extrabold text-emerald-700">${totalIngresos.toLocaleString()}</p>
      </div>
      <div className="bg-red-50 rounded-xl p-4 border border-red-200">
        <p className="text-[10px] text-red-500 uppercase font-bold">Egresos</p>
        <p className="text-xl font-extrabold text-red-600">${totalEgresos.toLocaleString()}</p>
      </div>
      <div className={`rounded-xl p-4 border ${balance >= 0 ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}`}>
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
        {todos.slice(0, 30).map(m => (
          <div key={m.id} className={`rounded-lg p-3 border ${m._tipo === "Ingreso" ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-slate-700">{s(m.concepto)}</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${m._tipo === "Ingreso" ? "text-emerald-700" : "text-red-600"}`}>{m._tipo === "Ingreso" ? "+" : "-"}${n(m.monto).toLocaleString()}</span>
                <button onClick={() => { if(confirm("¿Eliminar este movimiento?")) actions.deleteMovContable(m.id); }} className="text-red-400 hover:text-red-600 text-xs p-1">✕</button>
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400">{s(m.fecha)}</span>
              <span className={`text-xs ${m._tipo === "Ingreso" ? "text-emerald-600" : "text-red-500"}`}>{s(m.categoria)}</span>
            </div>
          </div>
        ))}
      </div>
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
