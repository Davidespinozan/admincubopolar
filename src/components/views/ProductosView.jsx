import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, s, n, useDebounce, useToast, useConfirm, reporteInventario, PAGE_SIZE, Paginator } from './viewsCommon';

export function ProductosView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
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

  const save = async () => {
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
    const err = modal === "new"
      ? await actions.addProducto(payload)
      : await actions.updateProducto(modal.id, payload);
    if (err) {
      toast?.error(modal === "new" ? "No se pudo crear el producto" : "No se pudo actualizar el producto");
      return;
    }
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

  const exportBtns = <>
    <button onClick={() => reporteInventario(data.productos, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteInventario(data.productos, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    {ConfirmEl}
    <PageHeader title="Catálogo de Productos" subtitle="Empaque y producto terminado" action={openNew} actionLabel="Nuevo producto" extraButtons={exportBtns} />
    {hasDemoProducts && (
      <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <span className="text-amber-700 text-sm">Se detectaron productos de demostración (DEMO-*).</span>
        <button onClick={() => askConfirm('Eliminar datos de demo', 'Esta acción borrará TODOS los productos marcados como demo. No se puede deshacer. ¿Continuar?', async () => { await actions.deleteDemoProducts(); }, true)} className="px-3 py-1 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Eliminar datos demo</button>
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
        <FormInput label="SKU *" value={form.sku} onChange={e=>setForm({...form,sku:e.target.value.toUpperCase()})} placeholder="Ej: HPC-25K" error={errors.sku} />
        <FormInput label="Nombre *" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} error={errors.nombre} />
        <FormSelect label="Tipo" options={["Producto Terminado","Empaque"]} value={form.tipo} onChange={e=>{const t=e.target.value;setForm({...form,tipo:t,precio:t==="Empaque"?0:form.precio,costoUnitario:t==="Producto Terminado"?0:form.costoUnitario,empaqueSku:t==="Empaque"?"":form.empaqueSku})}} />
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
      {modal !== "new" && (
        <button onClick={() => askConfirm("Eliminar producto", `¿Eliminar "${s(modal.nombre)}" (${s(modal.sku)})? Esta acción no se puede deshacer.`, async () => {
            const err = await actions.deleteProducto(modal.id);
            if (err) { toast?.error("No se pudo eliminar — puede tener órdenes o inventario asociado"); return; }
            toast?.success("Producto eliminado");
            setModal(null);
          }, true)} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors mt-4">
          Eliminar producto
        </button>
      )}
      <div className="flex justify-end gap-2 mt-3"><FormBtn onClick={()=>setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}
