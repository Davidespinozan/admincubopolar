import { useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Icons } from '../ui/Icons';
import { StatusBadge, DataTable, PageHeader, CapacityBar } from '../ui/Components';
import Modal, { FormInput, FormSelect, FormBtn, useConfirm } from '../ui/Modal';
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
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [geocoding, setGeocoding] = useState(false);
  const empty = { nombre:"",rfc:"",regimen:"Régimen General",usoCfdi:"G03",cp:"",correo:"",tipo:"Tienda",contacto:"",calle:"",colonia:"",ciudad:"Hermosillo",zona:"",latitud:"",longitud:"" };
  const [form, setForm] = useState(empty);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (c) => { setForm({ nombre:s(c.nombre),rfc:s(c.rfc),regimen:s(c.regimen)||"Régimen General",usoCfdi:s(c.usoCfdi)||"G03",cp:s(c.cp),correo:s(c.correo),tipo:s(c.tipo),contacto:s(c.contacto),calle:s(c.calle),colonia:s(c.colonia),ciudad:s(c.ciudad)||"Hermosillo",zona:s(c.zona),latitud:c.latitud||"",longitud:c.longitud||"" }); setErrors({}); setModal(c); };

  const save = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.rfc.trim()) e.rfc = "Requerido";
    if (form.rfc.trim() && (form.rfc.length < 12 || form.rfc.length > 13)) e.rfc = "RFC debe tener 12-13 caracteres";
    if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = "Email inválido";
    if (form.cp.trim() && !/^\d{5}$/.test(form.cp)) e.cp = "CP debe ser 5 dígitos";
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
    {ConfirmEl}
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

// ═══════════════════════════════════════════════
// PRODUCTOS
// ═══════════════════════════════════════════════
export function ProductosView({ data, actions }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const empty = {sku:"",nombre:"",tipo:"Producto Terminado",stock:0,ubicacion:"CF-1",precio:0,costoUnitario:0,proveedor:"",empaqueSku:""};
  const [form, setForm] = useState(empty);

  const dSearch = useDebounce(search);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (p) => { setForm({sku:s(p.sku),nombre:s(p.nombre),tipo:s(p.tipo),stock:n(p.stock),ubicacion:s(p.ubicacion),precio:n(p.precio),costoUnitario:n(p.costo_unitario||p.costoUnitario),proveedor:s(p.proveedor),empaqueSku:s(p.empaque_sku||p.empaqueSku)}); setErrors({}); setModal(p); };

  const save = () => {
    const e = {};
    if (!form.sku.trim()) e.sku = "Requerido";
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (Object.keys(e).length) { setErrors(e); return; }
    const payload = {
      sku: form.sku,
      nombre: form.nombre,
      tipo: form.tipo,
      stock: Number(form.stock) || 0,
      ubicacion: form.ubicacion,
      precio: form.tipo === "Producto Terminado" ? Number(form.precio) || 0 : 0,
      costo_unitario: form.tipo === "Empaque" ? Number(form.costoUnitario) || 0 : 0,
      proveedor: form.proveedor || null,
      empaque_sku: form.tipo === "Producto Terminado" ? form.empaqueSku || null : null,
    };
    if (modal === "new") actions.addProducto(payload); else actions.updateProducto(modal.id, payload);
    toast?.success(modal === "new" ? "Producto creado" : "Producto actualizado");
    setModal(null);
  };

  // Empaques disponibles para vincular
  const empaques = useMemo(() => data.productos.filter(p => s(p.tipo) === "Empaque"), [data.productos]);

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.productos.filter(p => {
      const matchTipo = !filterTipo || s(p.tipo) === filterTipo;
      const ms = !q || s(p.nombre).toLowerCase().includes(q) || s(p.sku).toLowerCase().includes(q);
      return matchTipo && ms;
    });
  }, [data.productos, dSearch, filterTipo]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const hasDemoProducts = useMemo(() => data.productos.some(p => s(p.sku).startsWith('DEMO-')), [data.productos]);

  return (<div>
    <PageHeader title="Catálogo de Productos" subtitle="Empaque y producto terminado" action={openNew} actionLabel="Nuevo producto" />
    {hasDemoProducts && (
      <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <span className="text-amber-700 text-sm">Se detectaron productos de demostración (DEMO-*).</span>
        <button onClick={() => { actions.deleteDemoProducts(); }} className="px-3 py-1 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Eliminar datos demo</button>
      </div>
    )}
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar producto o SKU..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
        <select value={filterTipo} onChange={e=>{setFilterTipo(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:border-blue-400 min-h-[44px]">
          <option value="">Todos los tipos</option>
          <option value="Producto Terminado">Producto Terminado</option>
          <option value="Empaque">Empaque</option>
        </select>
      </div>
      <DataTable columns={[
        {key:"sku",label:"SKU",render:v=><span className="font-mono text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{s(v)}</span>},
        {key:"nombre",label:"Producto",bold:true},
        {key:"tipo",label:"Tipo",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"stock",label:"Stock",render:(v,r)=><span className={`font-semibold ${s(r.tipo)==="Empaque"&&n(v)<200?"text-red-600":"text-slate-800"}`}>{n(v).toLocaleString()}</span>},
        {key:"costo_unitario",label:"Costo",render:(v,r)=>s(r.tipo)==="Empaque" && n(v)>0?<span className="text-amber-600 font-semibold">${n(v).toFixed(2)}</span>:"—"},
        {key:"precio",label:"Precio",render:(v,r)=>s(r.tipo)==="Producto Terminado" && n(v)>0?`$${n(v).toFixed(2)}`:"—"},
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
        {form.tipo==="Producto Terminado" && (
          <>
            <FormInput label="Precio público ($)" type="number" value={form.precio} onChange={e=>setForm({...form,precio:e.target.value})} />
            <FormSelect label="Empaque que usa" options={["", ...empaques.map(e => e.sku)]} value={form.empaqueSku} onChange={e=>setForm({...form,empaqueSku:e.target.value})} />
            <p className="text-xs text-slate-400 -mt-2">Selecciona el empaque para calcular costos automáticamente</p>
          </>
        )}
        {form.tipo==="Empaque" && (
          <>
            <FormInput label="Costo unitario ($)" type="number" step="0.01" value={form.costoUnitario} onChange={e=>setForm({...form,costoUnitario:e.target.value})} placeholder="Costo por unidad" />
            <FormInput label="Proveedor" value={form.proveedor} onChange={e=>setForm({...form,proveedor:e.target.value})} placeholder="Ej: Bolsas del Norte" />
            <p className="text-xs text-slate-400 -mt-2">Este costo se usa para calcular el costo de producción</p>
          </>
        )}
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
  const [askConfirm, ConfirmEl] = useConfirm();
  const [pageExist, setPageExist] = useState(0);
  const [pageKardex, setPageKardex] = useState(0);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [traspasoForm, setTraspasoForm] = useState({origen:"CF-1",destino:"CF-2",sku:"HC-25K",cantidad:""});
  const [traspasoErrors, setTraspasoErrors] = useState({});
  const [cfModal, setCfModal] = useState(null);
  const [cfForm, setCfForm] = useState({nombre:"",temp:"-10",capacidad:"0"});
  const [ajusteModal, setAjusteModal] = useState(null);
  const [ajusteForm, setAjusteForm] = useState({ existencia: "", motivo: "" });
  const [ajusteErrors, setAjusteErrors] = useState({});

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

  const abrirAjuste = (prod) => {
    setAjusteModal(prod);
    setAjusteForm({ existencia: String(n(prod.stock)), motivo: "" });
    setAjusteErrors({});
  };

  const confirmarAjuste = async () => {
    if (!ajusteModal) return;
    const e = {};
    const nueva = n(ajusteForm.existencia, -1);
    if (nueva < 0) e.existencia = "Debe ser 0 o mayor";
    if (!s(ajusteForm.motivo).trim()) e.motivo = "Motivo requerido";
    if (Object.keys(e).length) { setAjusteErrors(e); return; }

    const err = await actions.ajustarExistenciaManual?.({
      sku: s(ajusteModal.sku),
      nuevaExistencia: nueva,
      motivo: s(ajusteForm.motivo).trim(),
    });

    if (err) {
      toast?.error("No se pudo ajustar la existencia");
      return;
    }

    toast?.success("Existencia ajustada");
    setAjusteModal(null);
  };

  return (<div>
    {ConfirmEl}
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
            <button onClick={e=>{e.stopPropagation();askConfirm('Eliminar cuarto frío', '¿Eliminar ' + s(cf.nombre) + '?', async()=>{await actions.deleteCuartoFrio(cf.id); toast?.success('Cuarto frío eliminado');}, true)}} className="p-1 text-red-500 hover:text-red-700">
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
        {key:"acciones",label:"Acciones",render:(_,r)=><button onClick={(e)=>{e.stopPropagation();abrirAjuste(r);}} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 min-h-[36px]">Ajustar</button>},
      ]} data={paginatedProd} />
      <Paginator page={pageExist} total={prodConStock.length} onPage={setPageExist} />
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
        {cfModal && cfModal !== "new" && cfModal.id && <button onClick={()=> askConfirm('Eliminar cuarto frío', '¿Eliminar ' + s(cfModal.nombre) + '?', async()=>{await actions.deleteCuartoFrio(cfModal.id); toast?.success('Cuarto frío eliminado'); setCfModal(null);}, true)} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
        <div className="flex gap-2 ml-auto">
          <FormBtn onClick={()=>setCfModal(null)}>Cancelar</FormBtn>
          <FormBtn primary onClick={async ()=>{
            const e = {};
            if (!cfForm.nombre || !cfForm.nombre.trim()) { toast?.error('Nombre requerido'); return; }
            const payload = { nombre: cfForm.nombre, temp: Number(cfForm.temp), capacidad: Number(cfForm.capacidad) };
            try {
              if (cfModal === "new") { await actions.addCuartoFrio(payload); toast?.success('Cuarto frío creado'); }
              else { await actions.updateCuartoFrio(cfModal.id, payload); toast?.success('Cuarto frío actualizado'); }
              setCfModal(null);
            } catch(ex) { toast?.error('Error: ' + (ex?.message || 'No se pudo guardar')); }
          }}>Guardar</FormBtn>
        </div>
      </div>
    </Modal>

    {/* Modal: Ajuste manual de existencia */}
    <Modal open={!!ajusteModal} onClose={()=>setAjusteModal(null)} title={"Ajustar existencia — " + s(ajusteModal?.sku)}>
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-700">Este ajuste corrige inventario cuando hay una diferencia operativa.</p>
          <p className="text-xs text-amber-700 mt-1">Stock actual: <span className="font-bold">{n(ajusteModal?.stock).toLocaleString()}</span></p>
        </div>
        <FormInput
          label="Nueva existencia total *"
          type="number"
          value={ajusteForm.existencia}
          onChange={e=>setAjusteForm({...ajusteForm, existencia:e.target.value})}
          error={ajusteErrors.existencia}
        />
        <FormInput
          label="Motivo del ajuste *"
          value={ajusteForm.motivo}
          onChange={e=>setAjusteForm({...ajusteForm, motivo:e.target.value})}
          error={ajusteErrors.motivo}
          placeholder="Ej: Error de conteo de chofer en ruta norte"
        />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <FormBtn onClick={()=>setAjusteModal(null)}>Cancelar</FormBtn>
        <FormBtn primary onClick={confirmarAjuste}>Guardar ajuste</FormBtn>
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
  const getStock = useCallback((sku) => {
    if (!sku) return 0;
    const p = data.productos.find(x => s(x.sku) === s(sku));
    return p ? n(p.stock) : 0;
  }, [data.productos]);

  const subtotal = useMemo(()=>lines.reduce((s,l)=>s+(n(l.qty)*n(l.precio)),0),[lines]);
  const iva = useMemo(()=>Math.round(subtotal*16)/100,[subtotal]);
  const totalCalc = subtotal+iva;
  const productosStr = useMemo(()=>lines.filter(l=>l.sku&&l.qty>0).map(l=>`${l.qty}×${l.sku}`).join(", "),[lines]);

  const save = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = "Requerido";
    if (lines.length===0||!lines.some(l=>l.sku&&l.qty>0)) e.productos = "Agrega al menos un producto";
    // Validar stock disponible
    for (const l of lines) {
      if (l.sku && l.qty > 0) {
        const stock = getStock(l.sku);
        if (n(l.qty) > stock) {
          e.productos = `Stock insuficiente de ${l.sku} (disp: ${stock})`;
          break;
        }
      }
    }
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
            <div key={i} className="mb-2">
              <div className="flex items-center gap-2">
                <select value={l.sku} onChange={e=>updateLine(i,"sku",e.target.value)} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white min-h-[44px]">
                  {prodOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="number" min="1" value={l.qty} onChange={e=>updateLine(i,"qty",parseInt(e.target.value)||1)} className="w-16 border border-slate-200 rounded-xl px-2 py-2.5 text-sm text-center min-h-[44px]" />
                <span className="text-sm font-semibold text-slate-600 w-20 text-right">${(n(l.qty)*n(l.precio)).toLocaleString()}</span>
                {lines.length>1&&<button onClick={()=>removeLine(i)} className="text-red-400 hover:text-red-600 text-lg min-w-[28px]">×</button>}
              </div>
              {l.sku && <p className="text-[11px] text-slate-500 mt-1 ml-1">Stock: {getStock(l.sku).toLocaleString()} bolsas</p>}
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

  return (<div>
    {ConfirmEl}
    <PageHeader title="Entregas" subtitle="Rutas de distribución" action={()=>{setEditingRuta(null);setForm({nombre:"",choferId:"",estatus:"Programada",cargaPorProducto:{},extraPorProducto:{},clientesIds:[]});setSearchCliente("");setModal(true);setErrors({})}} actionLabel="Autorizar ruta" />

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
          <p className="text-xs text-slate-500 mb-3">{choferLabel(r)} · {rutaOrdenes.length} órdenes · {cargaLabel(r)}</p>
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
  const handleTimbrar = useCallback(async (folio) => {
    const err = await actions.timbrar(folio);
    if (!err) toast?.success(`CFDI timbrado: ${folio}`);
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
  const [filterMod, setFilterMod] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const dSearch = useDebounce(search);

  const users = useMemo(() => [...new Set(data.auditoria.map(a => s(a.usuario)).filter(Boolean))], [data.auditoria]);
  const modulos = useMemo(() => [...new Set(data.auditoria.map(a => s(a.modulo)).filter(Boolean))], [data.auditoria]);
  
  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.auditoria.filter(a => {
      const mu = !filterUsr || s(a.usuario) === filterUsr;
      const mm = !filterMod || s(a.modulo) === filterMod;
      const ms = !q || s(a.accion).toLowerCase().includes(q) || s(a.modulo).toLowerCase().includes(q) || s(a.detalle).toLowerCase().includes(q);
      return mu && mm && ms;
    });
  }, [data.auditoria, filterUsr, filterMod, dSearch]);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  // Estadísticas rápidas
  const stats = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    const accionesHoy = data.auditoria.filter(a => s(a.fecha).startsWith(hoy)).length;
    const usuariosActivos = new Set(data.auditoria.filter(a => s(a.fecha).startsWith(hoy)).map(a => s(a.usuario))).size;
    return { accionesHoy, usuariosActivos, total: data.auditoria.length };
  }, [data.auditoria]);

  return (<div>
    <PageHeader title="Auditoría" subtitle="Historial de acciones" />
    
    {/* Estadísticas */}
    <div className="grid grid-cols-3 gap-3 mb-4">
      <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
        <p className="text-2xl font-bold text-blue-600">{stats.accionesHoy}</p>
        <p className="text-xs text-blue-500">Acciones hoy</p>
      </div>
      <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
        <p className="text-2xl font-bold text-emerald-600">{stats.usuariosActivos}</p>
        <p className="text-xs text-emerald-500">Usuarios activos</p>
      </div>
      <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
        <p className="text-2xl font-bold text-slate-600">{stats.total}</p>
        <p className="text-xs text-slate-500">Total registros</p>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar acción o detalle..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterUsr} onChange={e=>{setFilterUsr(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos los usuarios</option>{users.map(u=><option key={u}>{u}</option>)}</select>
      <select value={filterMod} onChange={e=>{setFilterMod(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos los módulos</option>{modulos.map(m=><option key={m}>{m}</option>)}</select>
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
      const tipo = s(m.tipo);
      const origen = s(m.origen).toLowerCase();
      const qty = Math.abs(n(m.cantidad));
      const esConsumoProduccion =
        tipo === "Consumo" ||
        (tipo === "Salida" && (
          origen.startsWith("consumo") ||
          origen.includes("producción") ||
          origen.includes("produccion") ||
          origen.startsWith("prod")
        ));

      if (tipo === "Entrada") {
        result[sku].entradas += qty;
      } else if (esConsumoProduccion) {
        // Todo consumo de producción también es salida real de almacén
        result[sku].consumo += qty;
        result[sku].salidas += qty;
      } else if (tipo === "Salida") {
        result[sku].salidas += qty;
      }
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
  const [askConfirm, ConfirmEl] = useConfirm();
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
      // Create user via secure Edge Function (validates rol server-side)
      const { data: fnData, error: fnError } = await supabase.functions.invoke('hyper-endpoint', {
        body: {
          email: form.email.trim().toLowerCase(),
          password: form.password,
          nombre: form.nombre.trim(),
          rol: form.rol,
        }
      });

      if (fnError) {
        setErrors({ email: fnError.message || 'Error al crear usuario' });
        return;
      }

      if (fnData?.error) {
        setErrors({ email: fnData.error });
        return;
      }

      // Create profile in usuarios table with auth_id from Edge Function
      const authId = fnData?.user?.id;
      if (!authId) {
        setErrors({ email: 'No se obtuvo ID del usuario creado' });
        return;
      }

      const insertError = await actions.addUsuario({ 
        nombre: form.nombre.trim(), 
        email: form.email.trim().toLowerCase(), 
        rol: form.rol, 
        auth_id: authId,
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
    {ConfirmEl}
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
        {modal !== "new" && modal?.id && <button onClick={()=> askConfirm('Eliminar usuario','¿Eliminar ' + s(modal.nombre) + '?', async()=>{await actions.deleteUsuario(modal.id); toast?.success('Usuario eliminado'); setModal(null);}, true)} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
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
  const [askConfirm, ConfirmEl] = useConfirm();
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
    try {
      const payload = { ...form, salarioDiario: parseFloat(form.salarioDiario) };
      if (modal === "new") await actions.addEmpleado(payload);
      else await actions.updateEmpleado(modal.id, payload);
      toast?.success(modal === "new" ? "Empleado registrado" : "Empleado actualizado");
      setModal(null);
    } catch(ex) { toast?.error('Error: ' + (ex?.message || 'No se pudo guardar')); }
  };

  const filtered = emps.filter(e => {
    const q = search.toLowerCase();
    return !q || s(e.nombre).toLowerCase().includes(q) || s(e.puesto).toLowerCase().includes(q) || s(e.depto).toLowerCase().includes(q);
  });
  const deptos = [...new Set(emps.map(e => s(e.depto)))];

  return (<div className="space-y-4">
    {ConfirmEl}
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
          <button onClick={() => askConfirm('Desactivar empleado', `¿Desactivar "${s(modal.nombre)}"?`, async()=>{
              await actions.updateEmpleado(modal.id, { estatus: "Inactivo" });
              toast?.success("Empleado desactivado");
              setModal(null);
            }, true)} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors">
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
export function NominaView({ data, actions }) {
  const toast = useToast();
  const emps = data.empleados || [];
  const periodos = data.nominaPeriodos || [];
  const recibos = data.nominaRecibos || [];
  const deptos = ["Ventas y Distribución", "Producción", "Administración", "Staff"];
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState(null);

  const empsPorDepto = {};
  for (const d of deptos) empsPorDepto[d] = emps.filter(e => s(e.depto) === d && s(e.estatus) === "Activo");
  const totalSemanal = emps.filter(e => s(e.estatus) === "Activo").reduce((s, e) => s + n(e.salarioDiario) * 7, 0);

  const periodosPendientes = periodos.filter(p => s(p.estatus) !== "Pagado");
  const periodosPagados = periodos.filter(p => s(p.estatus) === "Pagado").slice(0, 10);

  // Recibos del período seleccionado
  const recibosPeriodo = useMemo(() => {
    if (!periodoSeleccionado) return [];
    return recibos.filter(r => n(r.periodoId) === n(periodoSeleccionado.id));
  }, [recibos, periodoSeleccionado]);

  const empsConRecibo = useMemo(() => {
    const ids = new Set(recibosPeriodo.map(r => n(r.empleadoId)));
    return ids;
  }, [recibosPeriodo]);

  const generarNuevaSemana = async () => {
    const hoy = new Date();
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - hoy.getDay()); // Domingo
    const finSemana = new Date(inicioSemana);
    finSemana.setDate(inicioSemana.getDate() + 6); // Sábado

    // Calcular número de semana y ejercicio (año)
    const startOfYear = new Date(hoy.getFullYear(), 0, 1);
    const daysSinceStart = Math.floor((inicioSemana - startOfYear) / (24 * 60 * 60 * 1000));
    const numeroSemana = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
    const ejercicio = hoy.getFullYear();
    
    // Verificar si ya existe período de esta semana
    const existente = periodos.find(p => n(p.numeroSemana) === numeroSemana && n(p.ejercicio) === ejercicio);
    if (existente) {
      toast?.error("Ya existe un período para esta semana");
      return;
    }

    // Crear período de nómina con empleados activos
    const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
    const nuevoTotal = empsActivos.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);
    const result = await actions.addNominaPeriodo({
      numero_semana: numeroSemana,
      ejercicio: ejercicio,
      fecha_inicio: inicioSemana.toISOString().slice(0, 10),
      fecha_fin: finSemana.toISOString().slice(0, 10),
      fecha_pago: finSemana.toISOString().slice(0, 10), // Pagas el sábado
      dias_pago: 7,
      total_percepciones: nuevoTotal,
      total_deducciones: 0,
      total_neto: nuevoTotal,
      estatus: "Borrador", // Enum: Borrador, Calculada, Pagado
    });
    if (result !== null) return; // Error toast ya mostrado en store
    toast?.success(`Nómina semana ${numeroSemana} generada: $${nuevoTotal.toLocaleString()}`);
  };

  const pagarPeriodo = async (p) => {
    await actions.pagarNomina(p.id);
  };

  const generarRecibosEmpleados = async (periodo) => {
    const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
    let generados = 0;
    for (const emp of empsActivos) {
      // Verificar si ya tiene recibo para este período
      const yaExiste = recibos.some(r => n(r.periodoId) === n(periodo.id) && n(r.empleadoId) === n(emp.id));
      if (yaExiste) continue;
      
      const dias = n(periodo.diasPago) || 7;
      const percepciones = n(emp.salarioDiario) * dias;
      const deducciones = Math.round(percepciones * 0.02 * 100) / 100; // 2% IMSS estimado
      const neto = percepciones - deducciones;
      
      await actions.addNominaRecibo({
        periodo_id: periodo.id,
        empleado_id: emp.id,
        dias_pagados: dias,
        salario_base: n(emp.salarioDiario),
        percepciones: percepciones,
        isr: 0,
        imss: deducciones,
        otras_deducciones: 0,
        neto_a_pagar: neto,
      });
      generados++;
    }
    if (generados > 0) {
      toast?.success(`${generados} recibos generados`);
    } else {
      toast?.info("Todos los empleados ya tienen recibo");
    }
  };

  return (<div className="space-y-4">
    <div className="flex justify-between items-center">
      <h2 className="text-lg font-bold text-slate-800">Nómina</h2>
      <button onClick={generarNuevaSemana} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-semibold">+ Generar nómina semana</button>
    </div>
    <div className="bg-white rounded-xl p-5 border border-slate-100">
      <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Total semanal estimado</p>
      <p className="text-3xl font-extrabold text-slate-800">${totalSemanal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
      <p className="text-xs text-slate-400 mt-1">{emps.filter(e => s(e.estatus) === "Activo").length} empleados activos · Salario × 7 días</p>
    </div>

    {/* Períodos pendientes de pago */}
    {periodosPendientes.length > 0 && (<div>
      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mt-4 mb-2">Períodos pendientes de pago</h3>
      <div className="space-y-2">
        {periodosPendientes.map(p => {
          const recibosP = recibos.filter(r => n(r.periodoId) === n(p.id));
          const empsActivos = emps.filter(e => s(e.estatus) === "Activo").length;
          return (
          <div key={p.id} className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-slate-800">Semana {n(p.numeroSemana)} — {n(p.ejercicio)}</p>
                <p className="text-xs text-slate-500">{s(p.fechaInicio)} al {s(p.fechaFin)} · ${n(p.totalNeto).toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">{recibosP.length}/{empsActivos} recibos generados</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => generarRecibosEmpleados(p)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Generar recibos</button>
                <button onClick={() => setPeriodoSeleccionado(p)} className="bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Ver</button>
                <button onClick={() => pagarPeriodo(p)} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Pagar</button>
              </div>
            </div>
          </div>
        );})}
      </div>
    </div>)}

    {/* Períodos pagados recientes */}
    {periodosPagados.length > 0 && (<div>
      <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mt-4 mb-2">Pagados recientemente</h3>
      <div className="space-y-1.5">
        {periodosPagados.map(p => (
          <div key={p.id} className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-slate-800">Semana {n(p.numeroSemana)} — {n(p.ejercicio)}</p>
              <p className="text-xs text-slate-400">{s(p.fechaInicio)} al {s(p.fechaFin)}</p>
            </div>
            <p className="text-sm font-bold text-emerald-700">${n(p.totalNeto).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>)}

    {/* Empleados por departamento */}
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

    {/* Modal de recibos del período */}
    {periodoSeleccionado && (
      <Modal onClose={() => setPeriodoSeleccionado(null)} title={`Recibos Semana ${n(periodoSeleccionado.numeroSemana)}`}>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {recibosPeriodo.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No hay recibos generados. Presiona "Generar recibos" para crearlos.</p>
          ) : (
            recibosPeriodo.map(r => {
              const emp = emps.find(e => n(e.id) === n(r.empleadoId));
              return (
                <div key={r.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{emp ? s(emp.nombre) : `Empleado #${r.empleadoId}`}</p>
                      <p className="text-xs text-slate-400">{emp ? s(emp.puesto) : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-600">${n(r.netoAPagar || r.neto_a_pagar).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">Neto a pagar</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Días</p>
                      <p className="font-bold text-slate-700">{n(r.diasPagados || r.dias_pagados)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Percepciones</p>
                      <p className="font-bold text-blue-600">${n(r.percepciones).toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Deducciones</p>
                      <p className="font-bold text-red-600">${n(r.imss).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => generarRecibosEmpleados(periodoSeleccionado)} className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl">Generar faltantes</button>
          <button onClick={() => setPeriodoSeleccionado(null)} className="flex-1 py-3 bg-slate-200 text-slate-700 font-semibold rounded-xl">Cerrar</button>
        </div>
      </Modal>
    )}
  </div>);
}

// ═══════════════════════════════════════════════════
// CONTABILIDAD CRUD (captura ingresos/egresos)
// ═══════════════════════════════════════════════════
export function ContabilidadView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
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
// ══════════════════════════════════════════════════════════════
// COBROS / CUENTAS POR COBRAR VIEW
// ══════════════════════════════════════════════════════════════
export function CobrosView({ data, actions }) {
  const toast = useToast();
  const [tab, setTab] = useState('pendientes'); // pendientes | pagos
  const [cobroModal, setCobroModal] = useState(null);
  const [form, setForm] = useState({ monto: '', metodo: 'Efectivo', referencia: '' });
  const [errors, setErrors] = useState({});

  const cxcPendientes = useMemo(() => 
    (data.cuentasPorCobrar || []).filter(c => c.estatus !== 'Pagada'),
    [data.cuentasPorCobrar]
  );
  const cxcPagadas = useMemo(() => 
    (data.cuentasPorCobrar || []).filter(c => c.estatus === 'Pagada'),
    [data.cuentasPorCobrar]
  );
  const pagosRecientes = useMemo(() => 
    (data.pagos || []).slice(0, 50),
    [data.pagos]
  );

  const totalPendiente = useMemo(() => 
    cxcPendientes.reduce((s, c) => s + n(c.saldoPendiente), 0),
    [cxcPendientes]
  );
  const totalCobradoHoy = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return (data.pagos || []).filter(p => s(p.fecha) === hoy).reduce((s, p) => s + n(p.monto), 0);
  }, [data.pagos]);

  const clientes = useMemo(() => {
    const map = {};
    for (const c of (data.clientes || [])) map[c.id] = c;
    return map;
  }, [data.clientes]);

  const openCobro = (cxc) => {
    setCobroModal(cxc);
    setForm({ monto: String(cxc.saldoPendiente), metodo: 'Efectivo', referencia: '' });
    setErrors({});
  };

  const cobrar = async () => {
    const e = {};
    if (!form.monto || parseFloat(form.monto) <= 0) e.monto = 'Monto inválido';
    if (parseFloat(form.monto) > cobroModal.saldoPendiente) e.monto = 'Excede el saldo pendiente';
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      await actions.cobrarCxC(cobroModal.id, parseFloat(form.monto), form.metodo, form.referencia);
      toast?.success('Cobro registrado');
      setCobroModal(null);
    } catch (ex) { toast?.error('Error: ' + (ex?.message || '')); }
  };

  const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta'];

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold text-slate-800">Cobros y Cuentas por Cobrar</h2>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
        <p className="text-[10px] text-amber-500 uppercase font-bold">Por cobrar</p>
        <p className="text-xl font-extrabold text-amber-700">${totalPendiente.toLocaleString()}</p>
        <p className="text-xs text-amber-600 mt-1">{cxcPendientes.length} cuentas pendientes</p>
      </div>
      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
        <p className="text-[10px] text-emerald-500 uppercase font-bold">Cobrado hoy</p>
        <p className="text-xl font-extrabold text-emerald-700">${totalCobradoHoy.toLocaleString()}</p>
      </div>
    </div>

    <div className="flex gap-2 border-b border-slate-200">
      <button onClick={() => setTab('pendientes')} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pendientes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
        Pendientes ({cxcPendientes.length})
      </button>
      <button onClick={() => setTab('pagos')} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pagos' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
        Pagos recientes
      </button>
    </div>

    {tab === 'pendientes' && (
      <div className="space-y-2">
        {cxcPendientes.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin cuentas pendientes de cobro</p>}
        {cxcPendientes.map(cxc => {
          const cli = clientes[cxc.clienteId];
          const pctPagado = (n(cxc.montoPagado) / n(cxc.montoOriginal)) * 100;
          return (
            <div key={cxc.id} className="bg-white rounded-xl p-4 border border-slate-100">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-slate-800">{s(cli?.nombre) || 'Cliente'}</p>
                  <p className="text-xs text-slate-400">{s(cxc.concepto)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cxc.estatus === 'Parcial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {cxc.estatus}
                </span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-500">Total: ${n(cxc.montoOriginal).toLocaleString()}</span>
                <span className="font-bold text-amber-700">Saldo: ${n(cxc.saldoPendiente).toLocaleString()}</span>
              </div>
              {n(cxc.montoPagado) > 0 && (
                <div className="mb-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, pctPagado)}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Pagado: ${n(cxc.montoPagado).toLocaleString()} ({Math.round(pctPagado)}%)</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Vence: {s(cxc.fechaVencimiento)}</span>
                <button onClick={() => openCobro(cxc)} className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg min-h-[36px]">Cobrar</button>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {tab === 'pagos' && (
      <div className="space-y-1.5">
        {pagosRecientes.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin pagos registrados</p>}
        {pagosRecientes.map(p => {
          const cli = clientes[p.clienteId];
          return (
            <div key={p.id} className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-slate-700">{s(cli?.nombre) || 'Cliente'}</span>
                <span className="text-sm font-bold text-emerald-700">+${n(p.monto).toLocaleString()}</span>
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-xs text-slate-400">{s(p.fecha)} • {s(p.metodoPago) || 'Efectivo'}</span>
                <span className="text-xs text-emerald-600">{s(p.referencia)}</span>
              </div>
            </div>
          );
        })}
      </div>
    )}

    <Modal open={!!cobroModal} onClose={() => setCobroModal(null)} title="Registrar cobro">
      {cobroModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(clientes[cobroModal.clienteId]?.nombre) || 'Cliente'}</p>
            <p className="text-xs text-slate-500">{s(cobroModal.concepto)}</p>
            <p className="text-lg font-bold text-amber-700 mt-1">Saldo: ${n(cobroModal.saldoPendiente).toLocaleString()}</p>
          </div>
          <FormInput label="Monto a cobrar *" type="number" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} />
          <FormSelect label="Método de pago" options={METODOS} value={form.metodo} onChange={e => setForm({ ...form, metodo: e.target.value })} />
          <FormInput label="Referencia" value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="No. transferencia, voucher, etc." />
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setCobroModal(null)}>Cancelar</FormBtn>
            <FormBtn primary onClick={cobrar}>Registrar cobro</FormBtn>
          </div>
        </div>
      )}
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// COSTOS Y GASTOS
// ═══════════════════════════════════════════════
const CATEGORIAS_COSTO = ['Nómina', 'Renta', 'Servicios', 'Gasolina', 'Mantenimiento', 'Empaque', 'Materia Prima', 'Administrativo', 'Otro'];
const FRECUENCIAS = ['Mensual', 'Quincenal', 'Semanal', 'Único'];

export function CostosView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [tab, setTab] = useState('fijos');
  const [modal, setModal] = useState(null);
  const [aplicarModal, setAplicarModal] = useState(null);
  const [gastoModal, setGastoModal] = useState(false); // Para gastos directos
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [filterCat, setFilterCat] = useState('');

  const empty = { nombre: '', categoria: 'Servicios', monto: '', frecuencia: 'Mensual', diaCargo: '1', proveedor: '', activo: true };
  const [form, setForm] = useState(empty);
  const [aplicarForm, setAplicarForm] = useState({ fecha: today(), referencia: '' });
  const emptyGasto = { concepto: '', categoria: 'Gasolina', monto: '', fecha: today(), referencia: '' };
  const [gastoForm, setGastoForm] = useState(emptyGasto);

  const costosFijos = useMemo(() => (data.costosFijos || []), [data.costosFijos]);
  const costosHistorial = useMemo(() => (data.costosHistorial || []).sort((a, b) => new Date(b.fecha || b.createdAt) - new Date(a.fecha || a.createdAt)), [data.costosHistorial]);

  // Map costo_fijo_id to nombre
  const costosFijosMap = useMemo(() => {
    const m = {};
    costosFijos.forEach(c => { m[c.id] = c; });
    return m;
  }, [costosFijos]);

  const filteredFijos = useMemo(() => {
    return costosFijos.filter(c => !filterCat || c.categoria === filterCat);
  }, [costosFijos, filterCat]);

  const filteredHistorial = useMemo(() => {
    return costosHistorial.filter(c => !filterCat || c.categoria === filterCat);
  }, [costosHistorial, filterCat]);

  const paginatedFijos = useMemo(() => filteredFijos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredFijos, page]);
  const paginatedHistorial = useMemo(() => filteredHistorial.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredHistorial, page]);

  const openNew = () => { setForm(empty); setErrors({}); setModal('new'); };
  const openEdit = (c) => {
    setForm({
      nombre: s(c.nombre),
      categoria: s(c.categoria) || 'Servicios',
      monto: String(n(c.monto)),
      frecuencia: s(c.frecuencia) || 'Mensual',
      diaCargo: String(c.diaCargo || 1),
      proveedor: s(c.proveedor),
      activo: c.activo !== false
    });
    setErrors({});
    setModal(c);
  };

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (!form.monto || Number(form.monto) <= 0) e.monto = 'Monto inválido';
    if (Object.keys(e).length) { setErrors(e); return; }

    const payload = {
      nombre: form.nombre.trim(),
      categoria: form.categoria,
      monto: Number(form.monto),
      frecuencia: form.frecuencia,
      diaCargo: Number(form.diaCargo) || 1,
      proveedor: form.proveedor.trim() || null,
      activo: form.activo
    };

    if (modal === 'new') {
      await actions.addCostoFijo(payload);
      toast?.success('Costo fijo creado');
    } else {
      await actions.updateCostoFijo(modal.id, payload);
      toast?.success('Costo actualizado');
    }
    setModal(null);
  };

  const openAplicar = (c) => {
    setAplicarForm({ fecha: today(), referencia: '' });
    setAplicarModal(c);
  };

  const aplicar = async () => {
    if (!aplicarModal) return;
    await actions.aplicarCostoFijo(aplicarModal.id, aplicarForm.fecha, aplicarForm.referencia);
    toast?.success('Costo aplicado y registrado como egreso');
    setAplicarModal(null);
  };

  // Registrar gasto directo/variable
  const openGasto = () => { setGastoForm(emptyGasto); setErrors({}); setGastoModal(true); };
  const guardarGasto = async () => {
    const e = {};
    if (!gastoForm.concepto.trim()) e.concepto = 'Requerido';
    if (!gastoForm.monto || Number(gastoForm.monto) <= 0) e.monto = 'Monto inválido';
    if (Object.keys(e).length) { setErrors(e); return; }
    
    await actions.registrarCostoVariable(
      gastoForm.categoria,
      gastoForm.concepto.trim(),
      Number(gastoForm.monto),
      gastoForm.referencia.trim() || null,
      gastoForm.fecha
    );
    toast?.success('Gasto registrado y egreso generado');
    setGastoModal(false);
  };

  // Calculate totals by category
  const totalesPorCategoria = useMemo(() => {
    const t = {};
    costosHistorial.forEach(c => {
      const cat = s(c.categoria) || 'Otro';
      t[cat] = (t[cat] || 0) + n(c.monto);
    });
    return t;
  }, [costosHistorial]);

  const totalMes = useMemo(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();
    return costosHistorial.filter(c => {
      const f = new Date(c.fecha || c.createdAt);
      return f.getMonth() === mesActual && f.getFullYear() === anioActual;
    }).reduce((sum, c) => sum + n(c.monto), 0);
  }, [costosHistorial]);

  return (<div>
    {ConfirmEl}
    <PageHeader title="Costos y Gastos" subtitle="Gestión de costos fijos y variables" />

    {/* Summary Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Total mes actual</p>
        <p className="text-xl font-bold text-slate-800">${totalMes.toLocaleString()}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Costos fijos</p>
        <p className="text-xl font-bold text-slate-800">{costosFijos.filter(c => c.activo).length}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Registros historial</p>
        <p className="text-xl font-bold text-slate-800">{costosHistorial.length}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Mayor gasto</p>
        <p className="text-sm font-semibold text-red-600">
          {Object.entries(totalesPorCategoria).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
        </p>
      </div>
    </div>

    {/* Tabs */}
    <div className="flex gap-2 mb-4">
      <button onClick={() => { setTab('fijos'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold rounded-lg min-h-[44px] ${tab === 'fijos' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Costos Fijos</button>
      <button onClick={() => { setTab('historial'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold rounded-lg min-h-[44px] ${tab === 'historial' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Historial</button>
    </div>

    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      {/* Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mb-4">
        <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:border-blue-400 min-h-[44px]">
          <option value="">Todas las categorías</option>
          {CATEGORIAS_COSTO.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          {tab === 'fijos' && (
            <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 min-h-[44px]">+ Nuevo costo fijo</button>
          )}
          {tab === 'historial' && (
            <button onClick={openGasto} className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 min-h-[44px]">+ Registrar gasto</button>
          )}
        </div>
      </div>

      {tab === 'fijos' && (
        <>
          {paginatedFijos.length === 0 && <EmptyState icon="Calculator" message="Sin costos fijos registrados" hint="Agrega costos recurrentes como renta, luz, etc." />}
          <div className="space-y-2">
            {paginatedFijos.map(c => (
              <div key={c.id} className={`rounded-lg p-3.5 border ${c.activo ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-slate-800">{s(c.nombre)}</p>
                    <p className="text-xs text-slate-400">{s(c.categoria)} • {s(c.frecuencia)} • Día {c.diaCargo || 1}</p>
                    {c.proveedor && <p className="text-xs text-slate-400">Proveedor: {s(c.proveedor)}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-red-600">${n(c.monto).toLocaleString()}</p>
                    {!c.activo && <span className="text-xs text-slate-400">Inactivo</span>}
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                  <button onClick={() => openEdit(c)} className="px-3 py-1.5 text-xs bg-slate-100 rounded-lg hover:bg-slate-200">Editar</button>
                  {c.activo && (
                    <button onClick={() => openAplicar(c)} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Aplicar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Paginator page={page} total={filteredFijos.length} onPage={setPage} />
        </>
      )}

      {tab === 'historial' && (
        <>
          {paginatedHistorial.length === 0 && <EmptyState icon="List" message="Sin registros de costos" hint="Los costos aplicados aparecerán aquí" />}
          <div className="space-y-1.5">
            {paginatedHistorial.map(c => {
              const costoFijo = costosFijosMap[c.costoFijoId];
              return (
                <div key={c.id} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{s(c.concepto) || s(costoFijo?.nombre) || 'Costo'}</p>
                      <p className="text-xs text-slate-400">{s(c.categoria)} • {s(c.tipo) || 'Fijo'}</p>
                      {c.referencia && <p className="text-xs text-slate-400">Ref: {s(c.referencia)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600">-${n(c.monto).toLocaleString()}</p>
                      <p className="text-xs text-slate-400">{fmtDate(c.fecha || c.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Paginator page={page} total={filteredHistorial.length} onPage={setPage} />
        </>
      )}
    </div>

    {/* Modal Nuevo/Editar Costo Fijo */}
    <Modal open={!!modal && modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'Nuevo Costo Fijo' : 'Editar Costo Fijo'}>
      <div className="space-y-3">
        <FormInput label="Nombre *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} placeholder="Ej: Renta local" />
        <FormSelect label="Categoría" options={CATEGORIAS_COSTO} value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
        <FormInput label="Monto *" type="number" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
        <FormSelect label="Frecuencia" options={FRECUENCIAS} value={form.frecuencia} onChange={e => setForm({ ...form, frecuencia: e.target.value })} />
        <FormInput label="Día de cargo" type="number" value={form.diaCargo} onChange={e => setForm({ ...form, diaCargo: e.target.value })} min="1" max="31" />
        <FormInput label="Proveedor (opcional)" value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} placeholder="Nombre del proveedor" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-sm text-slate-600">Activo</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        {modal !== 'new' && (
          <button onClick={() => askConfirm('Eliminar costo', '¿Eliminar este costo fijo?', async () => {
            await actions.deleteCostoFijo(modal.id);
            toast?.success('Costo eliminado');
            setModal(null);
          })} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg mr-auto">Eliminar</button>
        )}
        <FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn>
        <FormBtn primary onClick={save}>Guardar</FormBtn>
      </div>
    </Modal>

    {/* Modal Aplicar Costo */}
    <Modal open={!!aplicarModal} onClose={() => setAplicarModal(null)} title="Aplicar Costo">
      {aplicarModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(aplicarModal.nombre)}</p>
            <p className="text-xs text-slate-500">{s(aplicarModal.categoria)}</p>
            <p className="text-lg font-bold text-red-600 mt-1">${n(aplicarModal.monto).toLocaleString()}</p>
          </div>
          <FormInput label="Fecha" type="date" value={aplicarForm.fecha} onChange={e => setAplicarForm({ ...aplicarForm, fecha: e.target.value })} />
          <FormInput label="Referencia / Notas" value={aplicarForm.referencia} onChange={e => setAplicarForm({ ...aplicarForm, referencia: e.target.value })} placeholder="Número de factura, recibo, etc." />
          <p className="text-xs text-slate-400">Al aplicar, se registrará automáticamente como egreso en movimientos contables.</p>
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setAplicarModal(null)}>Cancelar</FormBtn>
            <FormBtn primary onClick={aplicar}>Aplicar y registrar egreso</FormBtn>
          </div>
        </div>
      )}
    </Modal>

    {/* Modal Registrar Gasto Directo */}
    <Modal open={gastoModal} onClose={() => setGastoModal(false)} title="Registrar Gasto">
      <div className="space-y-3">
        <FormInput label="Concepto *" value={gastoForm.concepto} onChange={e => setGastoForm({ ...gastoForm, concepto: e.target.value })} error={errors.concepto} placeholder="Ej: Gasolina ruta norte, Reparación compresor" />
        <FormSelect label="Categoría" options={CATEGORIAS_COSTO} value={gastoForm.categoria} onChange={e => setGastoForm({ ...gastoForm, categoria: e.target.value })} />
        <FormInput label="Monto *" type="number" value={gastoForm.monto} onChange={e => setGastoForm({ ...gastoForm, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
        <FormInput label="Fecha" type="date" value={gastoForm.fecha} onChange={e => setGastoForm({ ...gastoForm, fecha: e.target.value })} />
        <FormInput label="Referencia (opcional)" value={gastoForm.referencia} onChange={e => setGastoForm({ ...gastoForm, referencia: e.target.value })} placeholder="# Factura, ticket, voucher" />
        <p className="text-xs text-slate-400">Este gasto se registrará como egreso en contabilidad automáticamente.</p>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        <FormBtn onClick={() => setGastoModal(false)}>Cancelar</FormBtn>
        <FormBtn primary onClick={guardarGasto}>Registrar gasto</FormBtn>
      </div>
    </Modal>
  </div>);
}

// ═══════════════════════════════════════════════
// CUENTAS POR PAGAR (Proveedores)
// ═══════════════════════════════════════════════
const CATEGORIAS_CXP = ['Proveedores', 'Servicios', 'Renta', 'Otro'];
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta'];

export function CuentasPorPagarView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [tab, setTab] = useState('pendientes');
  const [modal, setModal] = useState(null);
  const [pagoModal, setPagoModal] = useState(null);
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});

  const empty = { proveedor: '', concepto: '', monto: '', categoria: 'Proveedores', fechaVencimiento: '', referencia: '', notas: '' };
  const [form, setForm] = useState(empty);
  const [pagoForm, setPagoForm] = useState({ monto: '', metodo: 'Transferencia', referencia: '' });

  const cxpPendientes = useMemo(() => 
    (data.cuentasPorPagar || []).filter(c => c.estatus !== 'Pagada'),
    [data.cuentasPorPagar]
  );
  const cxpPagadas = useMemo(() => 
    (data.cuentasPorPagar || []).filter(c => c.estatus === 'Pagada'),
    [data.cuentasPorPagar]
  );
  const pagosRecientes = useMemo(() => 
    (data.pagosProveedores || []).slice(0, 50),
    [data.pagosProveedores]
  );

  const totalPorPagar = useMemo(() => 
    cxpPendientes.reduce((s, c) => s + n(c.saldoPendiente), 0),
    [cxpPendientes]
  );
  const pagadoEsteMes = useMemo(() => {
    const hoy = new Date();
    const mes = hoy.getMonth();
    const anio = hoy.getFullYear();
    return (data.pagosProveedores || []).filter(p => {
      const f = new Date(s(p.fecha));
      return f.getMonth() === mes && f.getFullYear() === anio;
    }).reduce((s, p) => s + n(p.monto), 0);
  }, [data.pagosProveedores]);

  const openNew = () => { setForm(empty); setErrors({}); setModal('new'); };
  const openEdit = (cxp) => {
    setForm({
      proveedor: s(cxp.proveedor),
      concepto: s(cxp.concepto),
      monto: String(n(cxp.montoOriginal)),
      categoria: s(cxp.categoria) || 'Proveedores',
      fechaVencimiento: s(cxp.fechaVencimiento) || '',
      referencia: s(cxp.referencia),
      notas: s(cxp.notas),
    });
    setErrors({});
    setModal(cxp);
  };

  const save = async () => {
    const e = {};
    if (!form.proveedor.trim()) e.proveedor = 'Requerido';
    if (!form.concepto.trim()) e.concepto = 'Requerido';
    if (!form.monto || parseFloat(form.monto) <= 0) e.monto = 'Monto inválido';
    if (Object.keys(e).length) { setErrors(e); return; }

    const payload = {
      proveedor: form.proveedor.trim(),
      concepto: form.concepto.trim(),
      montoOriginal: parseFloat(form.monto),
      categoria: form.categoria,
      fechaVencimiento: form.fechaVencimiento || null,
      referencia: form.referencia.trim() || null,
      notas: form.notas.trim() || null,
    };

    if (modal === 'new') {
      const err = await actions.addCuentaPorPagar(payload);
      if (err) return; // error toast ya se mostró en store
      toast?.success('Cuenta por pagar creada');
    } else {
      const err = await actions.updateCuentaPorPagar(modal.id, payload);
      if (err) return;
      toast?.success('Cuenta actualizada');
    }
    setModal(null);
  };

  const openPago = (cxp) => {
    setPagoModal(cxp);
    setPagoForm({ monto: String(n(cxp.saldoPendiente)), metodo: 'Transferencia', referencia: '' });
    setErrors({});
  };

  const pagar = async () => {
    const e = {};
    if (!pagoForm.monto || parseFloat(pagoForm.monto) <= 0) e.monto = 'Monto inválido';
    if (parseFloat(pagoForm.monto) > n(pagoModal.saldoPendiente)) e.monto = 'Excede el saldo pendiente';
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      await actions.pagarCuentaPorPagar(pagoModal.id, parseFloat(pagoForm.monto), pagoForm.metodo, pagoForm.referencia);
      toast?.success('Pago registrado');
      setPagoModal(null);
    } catch (ex) { toast?.error('Error: ' + (ex?.message || '')); }
  };

  const paginatedPendientes = useMemo(() => cxpPendientes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [cxpPendientes, page]);
  const paginatedPagadas = useMemo(() => cxpPagadas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [cxpPagadas, page]);

  return (<div className="space-y-4">
    {ConfirmEl}
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold text-slate-800">Cuentas por Pagar</h2>
      <button onClick={openNew} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 min-h-[44px]">
        + Nueva deuda
      </button>
    </div>

    {/* Summary */}
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-red-50 rounded-xl p-4 border border-red-200">
        <p className="text-[10px] text-red-500 uppercase font-bold">Por pagar</p>
        <p className="text-xl font-extrabold text-red-700">${totalPorPagar.toLocaleString()}</p>
        <p className="text-xs text-red-600 mt-1">{cxpPendientes.length} cuentas pendientes</p>
      </div>
      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
        <p className="text-[10px] text-emerald-500 uppercase font-bold">Pagado este mes</p>
        <p className="text-xl font-extrabold text-emerald-700">${pagadoEsteMes.toLocaleString()}</p>
      </div>
    </div>

    {/* Tabs */}
    <div className="flex gap-2 border-b border-slate-200">
      <button onClick={() => { setTab('pendientes'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pendientes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
        Pendientes ({cxpPendientes.length})
      </button>
      <button onClick={() => { setTab('pagadas'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pagadas' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
        Pagadas ({cxpPagadas.length})
      </button>
      <button onClick={() => { setTab('pagos'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pagos' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
        Pagos recientes
      </button>
    </div>

    {tab === 'pendientes' && (
      <div className="space-y-2">
        {paginatedPendientes.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin cuentas pendientes de pago</p>}
        {paginatedPendientes.map(cxp => {
          const pctPagado = n(cxp.montoOriginal) > 0 ? (n(cxp.montoPagado) / n(cxp.montoOriginal)) * 100 : 0;
          const vencida = cxp.fechaVencimiento && new Date(cxp.fechaVencimiento) < new Date();
          return (
            <div key={cxp.id} className={`bg-white rounded-xl p-4 border ${vencida ? 'border-red-300 bg-red-50' : 'border-slate-100'}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-slate-800">{s(cxp.proveedor)}</p>
                  <p className="text-xs text-slate-400">{s(cxp.concepto)}</p>
                  <p className="text-xs text-slate-400">{s(cxp.categoria)} • {s(cxp.referencia)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cxp.estatus === 'Parcial' ? 'bg-amber-100 text-amber-700' : vencida ? 'bg-red-200 text-red-800' : 'bg-slate-100 text-slate-600'}`}>
                  {vencida ? 'Vencida' : cxp.estatus}
                </span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-500">Total: ${n(cxp.montoOriginal).toLocaleString()}</span>
                <span className="font-bold text-red-700">Saldo: ${n(cxp.saldoPendiente).toLocaleString()}</span>
              </div>
              {n(cxp.montoPagado) > 0 && (
                <div className="mb-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, pctPagado)}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Pagado: ${n(cxp.montoPagado).toLocaleString()} ({Math.round(pctPagado)}%)</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Vence: {s(cxp.fechaVencimiento) || 'Sin fecha'}</span>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(cxp)} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg min-h-[36px]">Editar</button>
                  <button onClick={() => openPago(cxp)} className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg min-h-[36px]">Pagar</button>
                </div>
              </div>
            </div>
          );
        })}
        <Paginator page={page} total={cxpPendientes.length} onPage={setPage} />
      </div>
    )}

    {tab === 'pagadas' && (
      <div className="space-y-2">
        {paginatedPagadas.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin cuentas pagadas</p>}
        {paginatedPagadas.map(cxp => (
          <div key={cxp.id} className="bg-emerald-50 rounded-lg p-3.5 border border-emerald-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-slate-700">{s(cxp.proveedor)}</p>
                <p className="text-xs text-slate-500">{s(cxp.concepto)}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold bg-emerald-200 text-emerald-700">Pagada</span>
            </div>
            <p className="text-sm font-bold text-emerald-700 mt-1">${n(cxp.montoOriginal).toLocaleString()}</p>
          </div>
        ))}
        <Paginator page={page} total={cxpPagadas.length} onPage={setPage} />
      </div>
    )}

    {tab === 'pagos' && (
      <div className="space-y-1.5">
        {pagosRecientes.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin pagos registrados</p>}
        {pagosRecientes.map(p => (
          <div key={p.id} className="bg-red-50 rounded-lg p-3 border border-red-100">
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-slate-700">{s(p.referencia) || 'Pago a proveedor'}</span>
              <span className="text-sm font-bold text-red-700">-${n(p.monto).toLocaleString()}</span>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400">{s(p.fecha)} • {s(p.metodoPago)}</span>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Modal Nueva/Editar CxP */}
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'new' ? 'Nueva cuenta por pagar' : 'Editar cuenta'} wide>
      <div className="space-y-3">
        <FormInput label="Proveedor *" value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} error={errors.proveedor} placeholder="Nombre del proveedor" />
        <FormInput label="Concepto *" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} error={errors.concepto} placeholder="Descripción de la deuda" />
        {modal === 'new' && (
          <FormInput label="Monto *" type="number" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormSelect label="Categoría" options={CATEGORIAS_CXP} value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
          <FormInput label="Fecha de vencimiento" type="date" value={form.fechaVencimiento} onChange={e => setForm({ ...form, fechaVencimiento: e.target.value })} />
        </div>
        <FormInput label="Referencia (factura, contrato)" value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="# Factura, contrato, etc." />
        <FormInput label="Notas" value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Notas adicionales" />
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        {modal !== 'new' && (
          <button onClick={() => askConfirm('Eliminar cuenta', '¿Eliminar esta cuenta por pagar?', async () => {
            await actions.deleteCuentaPorPagar(modal.id);
            toast?.success('Cuenta eliminada');
            setModal(null);
          })} className="px-4 py-2 text-red-600 text-sm font-semibold hover:bg-red-50 rounded-lg mr-auto">Eliminar</button>
        )}
        <FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn>
        <FormBtn primary onClick={save}>{modal === 'new' ? 'Crear cuenta' : 'Guardar cambios'}</FormBtn>
      </div>
    </Modal>

    {/* Modal Pagar CxP */}
    <Modal open={!!pagoModal} onClose={() => setPagoModal(null)} title="Registrar pago a proveedor">
      {pagoModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(pagoModal.proveedor)}</p>
            <p className="text-xs text-slate-500">{s(pagoModal.concepto)}</p>
            <p className="text-lg font-bold text-red-700 mt-1">Saldo: ${n(pagoModal.saldoPendiente).toLocaleString()}</p>
          </div>
          <FormInput label="Monto a pagar *" type="number" value={pagoForm.monto} onChange={e => setPagoForm({ ...pagoForm, monto: e.target.value })} error={errors.monto} />
          <FormSelect label="Método de pago" options={METODOS_PAGO} value={pagoForm.metodo} onChange={e => setPagoForm({ ...pagoForm, metodo: e.target.value })} />
          <FormInput label="Referencia" value={pagoForm.referencia} onChange={e => setPagoForm({ ...pagoForm, referencia: e.target.value })} placeholder="No. transferencia, cheque, etc." />
          <p className="text-xs text-slate-400">Este pago se registrará automáticamente como egreso en contabilidad.</p>
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setPagoModal(null)}>Cancelar</FormBtn>
            <FormBtn primary onClick={pagar}>Registrar pago</FormBtn>
          </div>
        </div>
      )}
    </Modal>
  </div>);
}