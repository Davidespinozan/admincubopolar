import { useState, useMemo, Icons, StatusBadge, DataTable, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, n, fmtPct, useToast, PAGE_SIZE, Paginator } from './viewsCommon';
import { tarimasOcupadasEnCuarto, colorTarimasUso } from '../../utils/tarimas';

export function InventarioView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [pageExist, setPageExist] = useState(0);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [traspasoForm, setTraspasoForm] = useState({origen:"",destino:"",sku:"",cantidad:""});
  const [traspasoErrors, setTraspasoErrors] = useState({});
  const [cfModal, setCfModal] = useState(null);
  const [cfForm, setCfForm] = useState({nombre:"",temp:"-10",capacidad_tarimas:""});
  const [ajusteModal, setAjusteModal] = useState(null);
  const [ajusteForm, setAjusteForm] = useState({ existencia: "", motivo: "" });
  const [ajusteErrors, setAjusteErrors] = useState({});
  const [editMinId, setEditMinId] = useState(null);
  const [editMinVal, setEditMinVal] = useState('');
  const [traspasando, setTraspasando] = useState(false);
  const [savingCf, setSavingCf] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [stockModal, setStockModal] = useState(null);
  const [stockForm, setStockForm] = useState({ cantidades: {}, motivo: '' });
  const [stockErrors, setStockErrors] = useState({});
  const [savingStock, setSavingStock] = useState(false);

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

  const cfOptions = useMemo(() => data.cuartosFrios.map(cf => ({value: s(cf.id), label: s(cf.nombre)})), [data.cuartosFrios]);
  const skuProd = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado").map(p => s(p.sku)), [data.productos]);

  const hacerTraspaso = async () => {
    if (traspasando) return;
    const e = {};
    if (!traspasoForm.cantidad || n(traspasoForm.cantidad) <= 0) e.cantidad = "Requerido";
    if (traspasoForm.origen === traspasoForm.destino) e.destino = "Debe ser diferente al origen";
    const cfOrigen = data.cuartosFrios.find(cf => cf.id === traspasoForm.origen);
    if (cfOrigen && cfOrigen.stock && (cfOrigen.stock[traspasoForm.sku] || 0) < n(traspasoForm.cantidad)) e.cantidad = "Stock insuficiente en origen";
    if (Object.keys(e).length) { setTraspasoErrors(e); return; }
    setTraspasando(true);
    try {
      if (actions.traspasoEntreUbicaciones) {
        await actions.traspasoEntreUbicaciones(traspasoForm);
      }
      toast?.success(traspasoForm.cantidad + " " + traspasoForm.sku + " de " + traspasoForm.origen + " a " + traspasoForm.destino);
      setTraspasoModal(false); setTraspasoForm({origen:"",destino:"",sku:"",cantidad:""}); setTraspasoErrors({});
    } finally {
      setTraspasando(false);
    }
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

  const abrirAjusteStock = (cf) => {
    const cantidades = {};
    for (const p of prodTerminados) {
      const sku = s(p.sku);
      const qty = cf.stock ? n(cf.stock[sku]) : 0;
      cantidades[sku] = String(qty);
    }
    setStockModal(cf);
    setStockForm({ cantidades, motivo: '' });
    setStockErrors({});
  };

  const confirmarAjusteStock = async () => {
    if (savingStock) return;
    if (!stockModal) return;

    const e = {};
    if (!s(stockForm.motivo).trim()) e.motivo = 'Motivo requerido';

    const ajustes = [];
    const stockActual = stockModal.stock || {};
    for (const p of prodTerminados) {
      const sku = s(p.sku);
      const raw = stockForm.cantidades[sku];
      if (raw === '' || raw === undefined || raw === null) continue;
      const nueva = Number(raw);
      if (!Number.isFinite(nueva) || nueva < 0) {
        e[`q_${sku}`] = 'Inválido';
        continue;
      }
      const actual = n(stockActual[sku]);
      if (nueva !== actual) ajustes.push({ sku, nuevaCantidad: nueva });
    }

    if (Object.keys(e).length) { setStockErrors(e); return; }
    if (ajustes.length === 0) { toast?.error('No hay cambios para guardar'); return; }

    setSavingStock(true);
    try {
      const err = await actions.ajustarStockCuarto?.({
        cuartoId: stockModal.id,
        ajustes,
        motivo: s(stockForm.motivo).trim(),
      });
      if (err) {
        toast?.error(err.message || 'No se pudo ajustar el stock');
        return;
      }
      toast?.success(`Stock actualizado (${ajustes.length} ${ajustes.length === 1 ? 'cambio' : 'cambios'})`);
      setStockModal(null);
    } finally {
      setSavingStock(false);
    }
  };

  const confirmarAjuste = async () => {
    if (ajustando) return;
    if (!ajusteModal) return;
    const e = {};
    const nueva = n(ajusteForm.existencia, -1);
    if (nueva < 0) e.existencia = "Debe ser 0 o mayor";
    if (!s(ajusteForm.motivo).trim()) e.motivo = "Motivo requerido";
    if (Object.keys(e).length) { setAjusteErrors(e); return; }

    setAjustando(true);
    try {
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
    } finally {
      setAjustando(false);
    }
  };

  return (<div>
    {ConfirmEl}
    <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Inventario</h2><p className="text-xs text-slate-400">Cuartos fríos, existencias y movimientos</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>{setCfForm({nombre:"",temp:"-10",capacidad:"0"});setCfModal("new")}} className="flex-1 sm:flex-none px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl min-h-[44px]">+ Cuarto Frío</button>
        <button onClick={()=>{
          const cfs = (data.cuartosFrios || []).map(c => s(c.id));
          const firstSku = (data.productos || []).filter(p => s(p.tipo) === "Producto Terminado")[0]?.sku || "";
          setTraspasoForm({origen: cfs[0] || "", destino: cfs[1] || cfs[0] || "", sku: s(firstSku), cantidad:""});
          setTraspasoModal(true); setTraspasoErrors({});
        }} className="flex-1 sm:flex-none px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl min-h-[44px]">Traspaso</button>
      </div>
    </div>
    <div className="flex sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6 overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
      {totalStockByCF.length === 0 ? <EmptyState message="Sin cuartos fríos" /> :
      totalStockByCF.map(cf=><div key={cf.id} className="min-w-[220px] sm:min-w-0 flex-shrink-0 sm:flex-shrink bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 snap-start">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 cursor-pointer" onClick={()=>{setCfForm({nombre:s(cf.nombre),temp:String(n(cf.temp, -50, 10)),capacidad_tarimas:String(n(cf.capacidad_tarimas) || '')});setCfModal(cf)}}>
            <h3 className="text-sm font-bold text-slate-700">{s(cf.nombre)}</h3>
            <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">{n(cf.temp, -50, 10)}°C</span>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Ajustar stock del cuarto frío" onClick={e=>{e.stopPropagation();abrirAjusteStock(cf);}} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:bg-slate-50 rounded-lg transition-colors">
              <Icons.Package />
            </button>
            <button aria-label="Editar cuarto frío" onClick={e=>{e.stopPropagation();setCfForm({nombre:s(cf.nombre),temp:String(n(cf.temp, -50, 10)),capacidad_tarimas:String(n(cf.capacidad_tarimas) || '')});setCfModal(cf);}} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors">
              <Icons.Edit />
            </button>
            <button aria-label="Eliminar cuarto frío" onClick={e=>{e.stopPropagation();askConfirm('Eliminar cuarto frío', '¿Eliminar ' + s(cf.nombre) + '? El cuarto debe estar vacío.', async()=>{const r=await actions.deleteCuartoFrio(cf.id); if (r?.error) { toast?.error(r.error); return; } toast?.success('Cuarto frío eliminado');}, true)}} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
              <Icons.X />
            </button>
          </div>
        </div>
        {(() => {
          const ocupado = tarimasOcupadasEnCuarto(cf, data.productos);
          const capacidad = n(cf.capacidad_tarimas);
          if (capacidad <= 0) {
            return <p className="text-xs text-slate-400 mt-2">Sin capacidad configurada</p>;
          }
          const pct = Math.round((ocupado / capacidad) * 100);
          const color = colorTarimasUso(ocupado, capacidad);
          const colorClass = color === 'red' ? 'bg-red-500' : color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
          const textColorClass = color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-emerald-700';
          return (
            <div className="mt-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Tarimas</span>
                <span className={`text-xs font-bold ${textColorClass}`}>
                  {ocupado.toFixed(1)}/{capacidad} ({fmtPct(ocupado, capacidad)})
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${colorClass} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          );
        })()}

        <div className="mt-3 space-y-1">
          {cf.stockEntries.map(([sku, qty]) => (
            <div key={sku} className="flex justify-between text-xs">
              <span className="text-slate-500">
                {(() => {
                  const p = (data.productos || []).find(x => s(x.sku) === s(sku));
                  return p ? s(p.nombre) : sku;
                })()}
              </span>
              <span className="font-bold text-slate-700">{n(qty).toLocaleString()}</span>
            </div>
          ))}
          {cf.stockEntries.length === 0 && <p className="text-xs text-slate-400 italic">Cuarto vacío</p>}
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
        {key:"nombre",label:"Producto",render:(v,r)=>(
          <div>
            <div className="font-semibold text-slate-800">{s(v)}</div>
            <div className="font-mono text-[11px] text-slate-400 mt-0.5">{s(r.sku)}</div>
          </div>
        )},
        {key:"tipo",label:"Tipo",badge:true,render:v=><StatusBadge status={v}/>},
        {key:"stock",label:"Existencia",render:(v,r)=>{
          const min = n(r.stock_minimo);
          const bajo = min > 0 && n(v) < min;
          return <span className={`font-bold ${bajo ? 'text-red-600' : s(r.tipo)==="Empaque"&&n(v)<200?"text-red-600":"text-slate-800"}`}>{n(v).toLocaleString()}{bajo && <span className="text-[10px] text-red-400 ml-1">▼</span>}</span>;
        }},
        {key:"stock_minimo",label:"Mín.",render:(_,r)=>{
          if (editMinId === r.id) return <div className="flex items-center gap-1"><input type="number" min="0" className="w-16 px-1.5 py-0.5 text-xs border border-slate-200 rounded-md" value={editMinVal} onChange={e=>setEditMinVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){actions.updateStockMinimo?.(r.id,Math.max(0,Number(editMinVal)||0));setEditMinId(null);toast?.success('Mínimo actualizado');}if(e.key==='Escape')setEditMinId(null);}} autoFocus /><button onClick={()=>{actions.updateStockMinimo?.(r.id,Math.max(0,Number(editMinVal)||0));setEditMinId(null);toast?.success('Mínimo actualizado');}} className="text-emerald-600 hover:text-emerald-800"><Icons.Check /></button><button onClick={()=>setEditMinId(null)} className="text-slate-400 hover:text-slate-600"><Icons.X /></button></div>;
          return <button onClick={(e)=>{e.stopPropagation();setEditMinId(r.id);setEditMinVal(String(n(r.stock_minimo)));}} className="text-xs text-slate-500 hover:text-blue-600 font-mono">{n(r.stock_minimo) > 0 ? n(r.stock_minimo).toLocaleString() : <span className="text-slate-300">—</span>}</button>;
        }},
        {key:"ubicacion",label:"Ubicación"},
        {key:"acciones",label:"Acciones",render:(_,r)=><button onClick={(e)=>{e.stopPropagation();abrirAjuste(r);}} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 min-h-[36px]">Ajustar</button>},
      ]} data={paginatedProd} />
      <Paginator page={pageExist} total={prodConStock.length} onPage={setPageExist} />
    </div>

    <Modal open={traspasoModal} onClose={()=>setTraspasoModal(false)} title="Traspaso entre ubicaciones">
      <div className="space-y-3">
        <FormSelect label="Origen *" options={cfOptions} value={traspasoForm.origen} onChange={e=>setTraspasoForm({...traspasoForm,origen:e.target.value})} />
        <FormSelect label="Destino *" options={cfOptions} value={traspasoForm.destino} onChange={e=>setTraspasoForm({...traspasoForm,destino:e.target.value})} error={traspasoErrors.destino} />
        <FormSelect label="Producto" options={skuProd} value={traspasoForm.sku} onChange={e=>setTraspasoForm({...traspasoForm,sku:e.target.value})} />
        <FormInput label="Cantidad *" type="number" value={traspasoForm.cantidad} onChange={e=>setTraspasoForm({...traspasoForm,cantidad:e.target.value})} placeholder="Ej: 100" error={traspasoErrors.cantidad} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setTraspasoModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={hacerTraspaso} loading={traspasando}>Traspasar</FormBtn></div>
    </Modal>

    {/* Modal: Crear / Editar Cuarto Frío */}
    <Modal open={!!cfModal} onClose={()=>setCfModal(null)} title={cfModal==="new"?"Nuevo cuarto frío":"Editar cuarto frío"}>
      <div className="space-y-3">
        <FormInput label="Nombre *" value={cfForm.nombre} onChange={e=>setCfForm({...cfForm,nombre:e.target.value})} />
        <FormInput label="Temperatura (°C)" type="number" value={cfForm.temp} onChange={e=>setCfForm({...cfForm,temp:e.target.value})} />
        <FormInput label="Capacidad (tarimas)" type="number" value={cfForm.capacidad_tarimas || ''} onChange={e=>setCfForm({...cfForm,capacidad_tarimas:e.target.value})} placeholder="ej: 8, 15, 13" />
      </div>
      <div className="flex justify-between mt-5">
        {cfModal && cfModal !== "new" && cfModal.id && <button onClick={()=> askConfirm('Eliminar cuarto frío', '¿Eliminar ' + s(cfModal.nombre) + '? El cuarto debe estar vacío.', async()=>{const r=await actions.deleteCuartoFrio(cfModal.id); if (r?.error) { toast?.error(r.error); return; } toast?.success('Cuarto frío eliminado'); setCfModal(null);}, true)} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
        <div className="flex gap-2 ml-auto">
          <FormBtn onClick={()=>setCfModal(null)}>Cancelar</FormBtn>
          <FormBtn primary loading={savingCf} onClick={async ()=>{
            if (savingCf) return;
            if (!cfForm.nombre || !cfForm.nombre.trim()) { toast?.error('Nombre requerido'); return; }
            const payload = { nombre: cfForm.nombre, temp: Number(cfForm.temp), capacidad_tarimas: Number(cfForm.capacidad_tarimas) || 0 };
            setSavingCf(true);
            try {
              if (cfModal === "new") { await actions.addCuartoFrio(payload); toast?.success('Cuarto frío creado'); }
              else { await actions.updateCuartoFrio(cfModal.id, payload); toast?.success('Cuarto frío actualizado'); }
              setCfModal(null);
            } catch(ex) {
              toast?.error('Error: ' + (ex?.message || 'No se pudo guardar'));
            } finally {
              setSavingCf(false);
            }
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
        <FormBtn primary onClick={confirmarAjuste} loading={ajustando}>Guardar ajuste</FormBtn>
      </div>
    </Modal>

    {/* Modal: Ajuste granular de stock por cuarto frío */}
    <Modal open={!!stockModal} onClose={()=>setStockModal(null)} title={"Ajustar stock — " + s(stockModal?.nombre)}>
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs text-blue-700">Edita la cantidad de cada SKU en este cuarto frío. Solo se guardan los cambios.</p>
        </div>
        <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
          {prodTerminados.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No hay productos terminados configurados.</p>
          ) : prodTerminados.map(p => {
            const sku = s(p.sku);
            const actual = n(stockModal?.stock?.[sku]);
            const raw = stockForm.cantidades[sku];
            const nueva = raw === '' || raw === undefined || raw === null ? actual : Number(raw);
            const delta = Number.isFinite(nueva) ? nueva - actual : 0;
            const errKey = `q_${sku}`;
            return (
              <div key={sku} className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-700 truncate">{s(p.nombre)}</div>
                  <div className="font-mono text-[10px] text-slate-400">{sku} · actual: {actual.toLocaleString()}</div>
                </div>
                <input
                  type="number"
                  min="0"
                  value={stockForm.cantidades[sku] ?? ''}
                  onChange={ev=>setStockForm(f=>({...f, cantidades: {...f.cantidades, [sku]: ev.target.value}}))}
                  className={`w-20 px-2 py-1.5 text-sm text-right border rounded-lg ${stockErrors[errKey] ? 'border-red-400' : 'border-slate-200'}`}
                />
                <div className="w-14 text-right">
                  {delta !== 0 && Number.isFinite(delta) && (
                    <span className={`text-xs font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <FormInput
          label="Motivo del ajuste *"
          value={stockForm.motivo}
          onChange={e=>setStockForm({...stockForm, motivo: e.target.value})}
          error={stockErrors.motivo}
          placeholder="Ej: Conteo físico semanal"
        />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <FormBtn onClick={()=>setStockModal(null)}>Cancelar</FormBtn>
        <FormBtn primary onClick={confirmarAjusteStock} loading={savingStock}>Guardar cambios</FormBtn>
      </div>
    </Modal>
  </div>);
}
