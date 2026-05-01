import { useState, useMemo, useCallback, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, s, n, eqId, fmtDate, fmtMoney, useDebounce, useToast, reporteVentas, PAGE_SIZE, Paginator } from './viewsCommon';

export function OrdenesView({ data, actions, user }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("");
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({clienteId:"",fecha:"",tipoCobro:"Contado",folioNota:""});
  const [lines, setLines] = useState([]);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const dSearch = useDebounce(search);

  const clienteOpts = useMemo(() => [{value:"",label:"Seleccionar..."},...(data.clientes || []).filter(c=>c.estatus==="Activo").map(c=>({value:String(c.id),label:s(c.nombre)}))], [data.clientes]);
  const prodTerminados = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);

  // Stock efectivo = suma de cuartos_frios (fuente de verdad), fallback a productos.stock
  const cfStockMap = useMemo(() => {
    const map = {};
    for (const cf of data.cuartosFrios || []) {
      for (const [sku, qty] of Object.entries(cf.stock || {})) {
        map[sku] = (map[sku] || 0) + n(qty);
      }
    }
    return map;
  }, [data.cuartosFrios]);

  const prodOpts = useMemo(() => [{value:"",label:"Seleccionar producto..."},...prodTerminados.map(p=>({value:s(p.sku),label:`${s(p.sku)} — ${s(p.nombre)} (${cfStockMap[p.sku] ?? n(p.stock)} disp.)`}))], [prodTerminados, cfStockMap]);

  const getPrice = useCallback((cId, sku) => {
    if (cId) { const esp = data.preciosEsp.find(p => eqId(p.clienteId, cId) && p.sku === sku); if (esp) return n(esp.precio); }
    const prod = data.productos.find(p => p.sku === sku);
    return prod ? n(prod.precio) : 0;
  }, [data.preciosEsp, data.productos]);

  const handleClientChange = (cId) => {
    const cli = data.clientes.find(c => String(c.id) === String(cId));
    const tipoCobro = cli?.credito_autorizado ? "Credito" : "Contado";
    setForm(f=>({...f,clienteId:cId,tipoCobro}));
    setLines(prev=>prev.map(l=>({...l,precio:getPrice(cId,l.sku)})));
  };
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
    if (cfStockMap[sku] !== undefined) return cfStockMap[sku];
    const p = data.productos.find(x => s(x.sku) === s(sku));
    return p ? n(p.stock) : 0;
  }, [data.productos, cfStockMap]);

  const subtotal = useMemo(()=>lines.reduce((s,l)=>s+(n(l.qty)*n(l.precio)),0),[lines]);
  const totalCalc = subtotal; // Hielo: IVA tasa 0%
  const productosStr = useMemo(()=>lines.filter(l=>l.sku&&l.qty>0).map(l=>`${l.qty}×${l.sku}`).join(", "),[lines]);

  const validateStep = (currentStep) => {
    const e = {};
    if (currentStep === 1) {
      if (!form.clienteId) e.clienteId = "Selecciona un cliente";
    }
    if (currentStep === 2) {
      if (lines.length === 0 || !lines.some(l => l.sku && l.qty > 0)) {
        e.productos = "Agrega al menos un producto";
      } else {
        for (const l of lines) {
          if (l.sku && l.qty > 0) {
            const stock = getStock(l.sku);
            if (n(l.qty) > stock) {
              e.productos = `Stock insuficiente de ${l.sku} (disp: ${stock})`;
              break;
            }
          }
        }
      }
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
    setSaving(true);
    try {
      const err = await actions.addOrden({cliente:s(cli?.nombre),clienteId:form.clienteId,fecha:form.fecha||new Date().toISOString().slice(0,10),productos:productosStr,total:totalCalc,usuarioId:user?.id||null,tipoCobro:form.tipoCobro||"Contado",folioNota:form.folioNota||null});
      if (err) {
        toast?.error(err.message || "No se pudo crear la orden");
        return;
      }
      toast?.success("Orden creada");
      setModal(false); setForm({clienteId:"",fecha:"",tipoCobro:"Contado",folioNota:""}); setLines([]); setErrors({});
    } finally {
      setSaving(false);
    }
  };
  const openModal = () => { setStep(1); setModal(true); setErrors({}); setForm({clienteId:"",fecha:"",tipoCobro:"Contado",folioNota:""}); setLines([{sku:"",qty:1,precio:0}]); };

  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({metodo:"Efectivo",referencia:""});
  const [checkoutProvider] = useState('stripe');

  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const cobrarOrden = (ord, tipo) => { setPagoModal({...ord, tipoCobro: tipo || "oficina"}); setPagoForm({metodo:"Efectivo",referencia:""}); setCheckoutUrl(null); setShortUrl(null); };
  const confirmarCobro = async () => {
    if (!pagoModal) return;
    if (pagoForm.metodo === "QR / Link de pago") {
      setGenerandoLink(true);
      try {
        const result = await actions.crearCheckoutPago?.(pagoModal.id, checkoutProvider);
        if (result?.checkoutUrl) {
          setCheckoutUrl(result.checkoutUrl);
          setShortUrl(result.shortUrl || result.checkoutUrl);
          toast?.success('Link de pago generado');
        } else {
          toast?.error('Error al generar link de pago');
        }
      } catch (e) {
        toast?.error('Error: ' + (e.message || 'No se pudo generar el link'));
      } finally {
        setGenerandoLink(false);
      }
      return;
    }
    const err = await actions.updateOrdenEstatus(pagoModal.id, "Entregada", pagoForm.metodo);
    if (err) {
      toast?.error("No se pudo registrar el cobro");
      return;
    }
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

  const exportBtns = <>
    <button onClick={() => reporteVentas(data.ordenes, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteVentas(data.ordenes, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    <PageHeader title="Ventas" subtitle="Crear venta, cobrar y asignar entregas" action={openModal} actionLabel="Nueva orden" extraButtons={exportBtns} />
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar folio o cliente..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterEst} onChange={e=>{setFilterEst(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos</option>{["Creada","Asignada","Entregada","Facturada"].map(st=><option key={st}>{st}</option>)}</select>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5">
      <DataTable columns={[
        {key:"folio",label:"Folio",render:(_,row)=><div><span className="font-mono text-xs font-bold text-blue-600">{s(row.folio)}</span>{row.folio_nota&&<span className="block text-[10px] text-slate-400">Nota: {s(row.folio_nota)}</span>}</div>},
        {key:"cliente",label:"Cliente",bold:true},{key:"fecha",label:"Fecha",render:v=>fmtDate(v),hideOnMobile:true},
        {key:"productos",label:"Productos",hideOnMobile:true,render:v=>{
          const raw = s(v);
          if (!raw) return <span className="text-xs text-slate-400">—</span>;
          const partes = raw.split(',').map(part => {
            const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
            if (!mt) return part.trim();
            const qty = mt[1];
            const sku = mt[2];
            const prod = (data.productos || []).find(p => s(p.sku) === s(sku));
            return prod ? `${qty}× ${s(prod.nombre)}` : `${qty}× ${sku}`;
          });
          return <span className="text-xs text-slate-600">{partes.join(', ')}</span>;
        }},
        {key:"total",label:"Total",bold:true,render:v=>fmtMoney(v)},
        {key:"estatus",label:"Estatus",badge:true,render:(v,r)=><div className="flex items-center gap-2 flex-wrap"><StatusBadge status={v}/><span className="hidden md:inline">{v==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">Asignar ruta</button></>}{v==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"entrega")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar entrega</button>}{v==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">→ Facturar</button>}</span></div>},
        {key:"ruta",label:"Ruta",hideOnMobile:true},
      ]} data={paginated}
      cardSubtitle={r => {
        const est = r.estatus;
        const btn = (label, color, next) => <button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,next)}} className={`mt-2 w-full text-xs font-semibold ${color} px-3 py-2.5 rounded-lg min-h-[44px]`}>{label}</button>;
        const prodsLegibles = (() => {
          const raw = s(r.productos);
          if (!raw) return '';
          return raw.split(',').map(part => {
            const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
            if (!mt) return part.trim();
            const prod = (data.productos || []).find(p => s(p.sku) === s(mt[2]));
            return prod ? `${mt[1]}× ${s(prod.nombre)}` : `${mt[1]}× ${mt[2]}`;
          }).join(', ');
        })();
        return <div>
          <span className="text-xs text-slate-400">{fmtDate(r.fecha)} · {prodsLegibles}</span>
          {est==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="mt-2 w-full text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2.5 rounded-lg min-h-[44px]">Asignar a ruta</button></>}
          {est==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"entrega")}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar entrega</button>}
          {est==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="mt-2 w-full text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2.5 rounded-lg min-h-[44px]">→ Facturar</button>}
        </div>;
      }}
        emptyMessage={(search?.trim() || filterEst) ? "Sin resultados" : "Aún no tienes ventas"}
        emptyHint={(search?.trim() || filterEst) ? "Intenta con otra búsqueda o limpia los filtros" : "Crea tu primera venta con el botón de arriba"}
        emptyCta={(search?.trim() || filterEst) ? "Limpiar filtros" : "+ Nueva orden"}
        onEmptyCta={(search?.trim() || filterEst) ? () => { setSearch(''); setFilterEst(''); setPage(0); } : openModal}
      />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
    <Modal open={modal} onClose={()=>setModal(false)} title="Nueva orden de venta" wide>
      {/* Indicador de pasos */}
      <div className="flex items-center gap-2 mb-5">
        {[1, 2, 3].map(num => (
          <div key={num} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              step === num ? 'bg-slate-900 text-white' :
              step > num ? 'bg-emerald-500 text-white' :
              'bg-slate-100 text-slate-400'
            }`}>
              {step > num ? '✓' : num}
            </div>
            <div className="flex-1">
              <p className={`text-xs font-semibold ${step === num ? 'text-slate-900' : 'text-slate-400'}`}>
                {num === 1 ? 'Cliente' : num === 2 ? 'Productos' : 'Detalles'}
              </p>
              <p className="text-[10px] text-slate-400">{num === 3 ? 'Opcional' : 'Requerido'}</p>
            </div>
            {num < 3 && <div className={`h-0.5 flex-1 ${step > num ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* PASO 1: Cliente */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 mb-2">¿A quién le estás vendiendo?</p>
          <FormSelect label="Cliente *" options={clienteOpts} value={form.clienteId} onChange={e=>handleClientChange(e.target.value)} error={errors.clienteId} />

          {form.clienteId && (() => {
            const cli = data.clientes.find(c => String(c.id) === String(form.clienteId));
            if (!cli?.credito_autorizado) return null;
            return <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 text-xs text-purple-700 font-semibold">💳 Crédito autorizado · Límite {fmtMoney(cli.limite_credito)} · Saldo pendiente {fmtMoney(cli.saldo)}</div>;
          })()}

          {form.clienteId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de cobro</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={()=>setForm(f=>({...f,tipoCobro:"Contado"}))}
                  className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${form.tipoCobro==="Contado"?"border-emerald-500 bg-emerald-50 text-emerald-700":"border-slate-200 text-slate-500"}`}>
                  💵 Cobrar al entregar
                </button>
                {(() => {
                  const cli = data.clientes.find(c => String(c.id) === String(form.clienteId));
                  const tieneCredito = cli?.credito_autorizado;
                  return (
                    <button type="button" disabled={!tieneCredito} onClick={()=>tieneCredito && setForm(f=>({...f,tipoCobro:"Credito"}))}
                      className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                        !tieneCredito ? "border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50" :
                        form.tipoCobro==="Credito"?"border-purple-500 bg-purple-50 text-purple-700":"border-slate-200 text-slate-500"
                      }`}>
                      📋 A crédito
                      {!tieneCredito && <span className="block text-[10px] text-slate-400 mt-0.5 font-normal">Cliente sin crédito</span>}
                    </button>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PASO 2: Productos */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 mb-2">¿Qué le vas a vender? Puedes agregar varios productos.</p>

          {errors.productos && <div className="bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-xs text-red-700 font-semibold">⚠️ {errors.productos}</p></div>}

          {lines.map((l,i)=>(
            <div key={i} className="bg-slate-50 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <select value={l.sku} onChange={e=>updateLine(i,"sku",e.target.value)} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white min-h-[44px]">
                  {prodOpts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="number" min="1" value={l.qty} onChange={e=>updateLine(i,"qty",parseInt(e.target.value)||1)} className="w-16 border border-slate-200 rounded-xl px-2 py-2.5 text-sm text-center min-h-[44px] bg-white" />
                <span className="text-sm font-semibold text-slate-700 w-20 text-right">{fmtMoney(n(l.qty) * n(l.precio))}</span>
                {lines.length>1&&<button onClick={()=>removeLine(i)} className="text-red-400 hover:text-red-600 text-lg min-w-[28px]">×</button>}
              </div>
              {l.sku && <p className="text-[11px] text-slate-500 mt-1.5 ml-1">Stock disponible: {getStock(l.sku).toLocaleString()} bolsas</p>}
            </div>
          ))}

          <button onClick={addLine} className="w-full py-2.5 border-2 border-dashed border-slate-300 text-slate-600 text-sm font-semibold rounded-xl hover:border-slate-400 hover:text-slate-700 transition-colors">
            + Agregar otro producto
          </button>

          <div className="bg-slate-900 rounded-xl p-4 mt-2">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-medium text-slate-300">Total</span>
              <span className="text-2xl font-bold text-white">{fmtMoney(totalCalc)}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">IVA 0% (hielo)</div>
          </div>
        </div>
      )}

      {/* PASO 3: Detalles */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 mb-2">Últimos detalles. Ambos son opcionales.</p>

          <FormInput label="Fecha de entrega" type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})} />
          <FormInput label="Folio de nota" value={form.folioNota} onChange={e=>setForm({...form,folioNota:e.target.value})} placeholder="Ej: N-0001" />

          {/* Resumen final */}
          <div className="bg-slate-50 rounded-xl p-4 mt-2">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Resumen</h4>

            {(() => {
              const cli = data.clientes.find(c => String(c.id) === String(form.clienteId));
              return (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cliente</span>
                    <span className="font-semibold text-slate-800">{s(cli?.nombre)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tipo de cobro</span>
                    <span className="font-semibold text-slate-800">{form.tipoCobro === "Contado" ? "💵 Cobrar al entregar" : "📋 A crédito"}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 mt-2">
                    <div className="text-xs text-slate-500 mb-1">Productos</div>
                    {lines.filter(l => l.sku && l.qty > 0).map((l, i) => {
                      const prod = (data.productos || []).find(p => s(p.sku) === s(l.sku));
                      return (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-slate-700">{n(l.qty)}× {prod ? s(prod.nombre) : s(l.sku)}</span>
                          <span className="font-mono text-slate-600">{fmtMoney(n(l.qty) * n(l.precio))}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between">
                    <span className="font-semibold text-slate-700">Total</span>
                    <span className="font-bold text-slate-900 text-base">{fmtMoney(totalCalc)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Footer con navegación */}
      <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-slate-100">
        <FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn>
        <div className="flex gap-2">
          {step > 1 && <FormBtn onClick={prevStep}>← Atrás</FormBtn>}
          {step < 3 && <FormBtn primary onClick={nextStep}>Siguiente →</FormBtn>}
          {step === 3 && <FormBtn primary onClick={save} loading={saving}>Crear orden</FormBtn>}
        </div>
      </div>
    </Modal>

    {/* MODAL DE COBRO - VENTAS */}
    {pagoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>setPagoModal(null)}>
        <div className="bg-white w-full max-w-md rounded-2xl p-5" onClick={e=>e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-1">Cobrar orden {s(pagoModal.folio)}</h3>
          <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} &mdash; <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span></p>
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

          {pagoForm.metodo==="QR / Link de pago" && checkoutUrl && (
            <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
              <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
              <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); toast?.success('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Hola, aquí está tu link de pago de Cubo Polar por ${fmtMoney(pagoModal.total)} MXN:\n${shortUrl || checkoutUrl}`)}`} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 Enviar por WhatsApp</a>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={()=>{setCheckoutUrl(null);setShortUrl(null);setPagoModal(null)}} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600">{checkoutUrl ? 'Cerrar' : 'Cancelar'}</button>
            {!checkoutUrl && <button onClick={confirmarCobro} disabled={generandoLink} className={`flex-1 py-2.5 text-white rounded-xl text-sm font-bold ${generandoLink ? 'bg-slate-400' : 'bg-emerald-600'}`}>{generandoLink ? 'Generando link…' : pagoForm.metodo==="QR / Link de pago" ? 'Generar link de pago' : 'Confirmar cobro'}</button>}
          </div>
        </div>
      </div>
    )}
  </div>);
}
