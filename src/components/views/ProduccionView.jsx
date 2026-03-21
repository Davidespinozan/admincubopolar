import { useState, useMemo, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormSelect, FormBtn, s, n, fmtDate, useToast, reporteProduccion } from './viewsCommon';

export function ProduccionView({ data, actions }) {
  const toast = useToast();
  const [tab, setTab] = useState('produccion'); // 'produccion' | 'transformaciones'

  // ── Producción normal ──
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

  const save = async () => {
    const e = {};
    if (!form.cantidad || n(form.cantidad) <= 0) e.cantidad = "Cantidad debe ser mayor a 0";
    if (bolsaNecesaria && n(form.cantidad) > stockBolsa) e.cantidad = "Stock insuficiente de " + bolsaNecesaria + " (" + stockBolsa + " disp.)";
    if (Object.keys(e).length) { setErrors(e); return; }
    const err = await actions.addProduccion(form);
    if (err) { toast?.error("No se pudo crear la orden de producción"); return; }
    toast?.success("Orden creada: " + form.cantidad + " " + form.sku);
    setModal(false); setForm({turno:"Matutino",maquina:"Máquina 30",sku:"HC-25K",cantidad:""}); setErrors({});
  };

  const skuOptions = useMemo(() => data.productos.filter(p=>p.tipo==="Producto Terminado").map(p=>s(p.sku)), [data.productos]);

  // ── Transformación ──
  const [tModal, setTModal] = useState(false);
  const [tErrors, setTErrors] = useState({});
  const TFORM_DEFAULT = { input_sku: "", input_kg: "", output_sku: "", output_kg: "", notas: "" };
  const [tForm, setTForm] = useState(TFORM_DEFAULT);

  // Materias primas (insumos) = productos con tipo "Materia Prima" o "Barra"
  const insumos = useMemo(() =>
    data.productos.filter(p => {
      const tipo = s(p.tipo).toLowerCase();
      return tipo.includes('barra') || tipo.includes('materia') || tipo.includes('insumo') || s(p.sku).toLowerCase().includes('bh-') || s(p.sku).toLowerCase().includes('barra');
    }),
  [data.productos]);

  // Productos derivados para output (Producto Terminado)
  const derivados = useMemo(() =>
    data.productos.filter(p => s(p.tipo) === 'Producto Terminado'),
  [data.productos]);

  // Si no hay insumos separados, mostrar todos los productos como opciones
  const inputOpts = useMemo(() => {
    const list = insumos.length > 0 ? insumos : data.productos;
    return list.map(p => ({ value: s(p.sku), label: `${s(p.sku)} — ${s(p.nombre)} (${n(p.stock)} kg disp.)` }));
  }, [insumos, data.productos]);

  const outputOpts = useMemo(() =>
    derivados.map(p => ({ value: s(p.sku), label: `${s(p.sku)} — ${s(p.nombre)}` })),
  [derivados]);

  const inputKg   = n(tForm.input_kg);
  const outputKg  = n(tForm.output_kg);
  const mermaKg   = inputKg > 0 && outputKg > 0 ? Math.max(0, inputKg - outputKg) : 0;
  const rendPct   = inputKg > 0 && outputKg > 0 ? Math.round((outputKg / inputKg) * 100) : 0;

  const inputStock = useMemo(() => {
    if (!tForm.input_sku) return 0;
    const p = data.productos.find(x => s(x.sku) === tForm.input_sku);
    return n(p?.stock);
  }, [tForm.input_sku, data.productos]);

  const saveTransformacion = async () => {
    const e = {};
    if (!tForm.input_sku)              e.input_sku  = "Selecciona el insumo";
    if (!tForm.output_sku)             e.output_sku = "Selecciona el producto";
    if (inputKg <= 0)                  e.input_kg   = "Ingresa los kg de entrada";
    if (outputKg <= 0)                 e.output_kg  = "Ingresa los kg de salida";
    if (outputKg > inputKg)            e.output_kg  = "La salida no puede superar la entrada";
    if (inputKg > inputStock)          e.input_kg   = `Stock insuficiente (disp: ${inputStock} kg)`;
    if (Object.keys(e).length) { setTErrors(e); return; }

    const err = await actions.addTransformacion({
      input_sku:  tForm.input_sku,
      input_kg:   inputKg,
      output_sku: tForm.output_sku,
      output_kg:  outputKg,
      notas:      tForm.notas,
    });
    if (err) { toast?.error(err.message || "Error al registrar transformación"); return; }
    toast?.success(`Transformación registrada — ${outputKg}kg de ${tForm.output_sku} (merma ${mermaKg}kg)`);
    setTModal(false);
    setTForm(TFORM_DEFAULT);
    setTErrors({});
  };

  // ── Stats ──
  const prodNormal = useMemo(() => data.produccion.filter(p => !p.tipo || p.tipo === 'Produccion'), [data.produccion]);
  const prodTransf = useMemo(() => data.produccion.filter(p => p.tipo === 'Transformacion'), [data.produccion]);

  const { totalProd, enProceso, confirmadas } = useMemo(() => {
    let total = 0, proc = 0, conf = 0;
    for (const p of prodNormal) {
      total += n(p.cantidad);
      if (p.estatus === "En proceso") proc++;
      else if (p.estatus === "Confirmada") conf++;
    }
    return { totalProd: total, enProceso: proc, confirmadas: conf };
  }, [prodNormal]);

  const mermaTotal = useMemo(() =>
    prodTransf.reduce((s, t) => s + n(t.merma_kg), 0),
  [prodTransf]);

  const rendPromedio = useMemo(() => {
    const con = prodTransf.filter(t => n(t.rendimiento) > 0);
    if (con.length === 0) return null;
    return Math.round(con.reduce((s, t) => s + n(t.rendimiento), 0) / con.length);
  }, [prodTransf]);

  const exportBtns = <>
    <button onClick={() => reporteProduccion(data.produccion, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteProduccion(data.produccion, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
  </>;

  return (<div>
    <PageHeader
      title="Producción"
      subtitle="Hielo y transformaciones"
      action={() => tab === 'transformaciones' ? (setTModal(true), setTErrors({})) : (setModal(true), setErrors({}))}
      actionLabel={tab === 'transformaciones' ? "Registrar transformación" : "Nueva orden"}
      extraButtons={exportBtns}
    />

    {/* Tabs */}
    <div className="flex gap-2 mb-5">
      <button onClick={() => setTab('produccion')}
        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === 'produccion' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
        Producción
      </button>
      <button onClick={() => setTab('transformaciones')}
        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === 'transformaciones' ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
        🧊 Transformaciones {prodTransf.length > 0 && <span className="ml-1 text-xs opacity-80">({prodTransf.length})</span>}
      </button>
    </div>

    {/* ═══ TAB: PRODUCCIÓN NORMAL ═══ */}
    {tab === 'produccion' && <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-3 sm:p-5 text-white"><p className="text-[10px] sm:text-xs font-semibold text-blue-100 uppercase mb-1">Producido</p><p className="text-xl sm:text-3xl font-extrabold">{totalProd.toLocaleString()}</p><p className="text-[10px] sm:text-xs text-blue-200 mt-0.5">bolsas</p></div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">En proceso</p><p className="text-xl sm:text-3xl font-extrabold text-amber-600">{enProceso}</p></div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Confirmadas</p><p className="text-xl sm:text-3xl font-extrabold text-emerald-600">{confirmadas}</p></div>
      </div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <DataTable columns={[
          {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-semibold text-blue-600">{s(v)}</span>},
          {key:"fecha",label:"Fecha",render:v=>fmtDate(v),hideOnMobile:true},
          {key:"turno",label:"Turno",hideOnMobile:true},
          {key:"maquina",label:"Máquina",bold:true},
          {key:"sku",label:"SKU",render:v=><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-md">{s(v)}</span>},
          {key:"cantidad",label:"Qty",render:v=><span className="font-semibold">{n(v).toLocaleString()}</span>},
          {key:"estatus",label:"Estatus",badge:true,render:(v,r)=><div className="flex items-center gap-2"><StatusBadge status={v}/><span className="hidden md:inline">{v==="En proceso"&&<button onClick={(e)=>{e.stopPropagation();actions.confirmarProduccion(r.id)}} className="text-xs text-blue-600 font-semibold hover:text-blue-800 px-2.5 py-0.5">Confirmar ✓</button>}</span></div>},
        ]} data={prodNormal}
        cardSubtitle={r => <div>
          <span className="text-xs text-slate-400">{fmtDate(r.fecha)} · {s(r.turno)} · {s(r.sku)}</span>
          {r.estatus==="En proceso"&&<button onClick={(e)=>{e.stopPropagation();actions.confirmarProduccion(r.id)}} className="mt-2 w-full text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg min-h-[44px]">Confirmar producción ✓</button>}
        </div>}
        />
      </div>
    </>}

    {/* ═══ TAB: TRANSFORMACIONES ═══ */}
    {tab === 'transformaciones' && <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl p-3 sm:p-5 text-white">
          <p className="text-[10px] sm:text-xs font-semibold text-orange-100 uppercase mb-1">Lotes</p>
          <p className="text-xl sm:text-3xl font-extrabold">{prodTransf.length}</p>
          <p className="text-[10px] sm:text-xs text-orange-200 mt-0.5">transformaciones</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Merma total</p>
          <p className="text-xl sm:text-3xl font-extrabold text-red-500">{mermaTotal.toLocaleString()}</p>
          <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5">kg perdidos</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Rendimiento</p>
          <p className={`text-xl sm:text-3xl font-extrabold ${rendPromedio >= 80 ? 'text-emerald-600' : rendPromedio >= 65 ? 'text-amber-500' : 'text-red-500'}`}>
            {rendPromedio !== null ? rendPromedio + '%' : '—'}
          </p>
          <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5">promedio</p>
        </div>
      </div>

      {prodTransf.length === 0 ? (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-8 text-center">
          <p className="text-2xl mb-2">🧊</p>
          <p className="font-semibold text-slate-700">Sin transformaciones registradas</p>
          <p className="text-sm text-slate-500 mt-1">Registra cuando trituras o picas barras de hielo para obtener hielo molido o escarchado</p>
          <button onClick={() => { setTModal(true); setTErrors({}); }} className="mt-4 px-5 py-2.5 bg-orange-500 text-white text-sm font-bold rounded-xl">
            Registrar primera transformación
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
          <div className="space-y-3">
            {prodTransf.slice().reverse().map(t => (
              <div key={t.id} className="border border-slate-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-orange-600">{s(t.folio)}</span>
                    <span className="text-xs text-slate-400 ml-2">{fmtDate(t.fecha)}</span>
                  </div>
                  {n(t.rendimiento) > 0 && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${n(t.rendimiento) >= 80 ? 'bg-emerald-100 text-emerald-700' : n(t.rendimiento) >= 65 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {n(t.rendimiento)}% rendimiento
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Entrada</p>
                    <p className="text-sm font-bold text-slate-800">{n(t.input_kg)} kg</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{s(t.input_sku)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-red-400 uppercase mb-1">Merma</p>
                    <p className="text-sm font-bold text-red-600">{n(t.merma_kg)} kg</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">perdidos</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Salida</p>
                    <p className="text-sm font-bold text-emerald-700">{n(t.output_kg)} kg</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{s(t.sku)}</p>
                  </div>
                </div>
                {s(t.destino) && <p className="text-xs text-slate-400 mt-2">Notas: {s(t.destino)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>}

    {/* ═══ MODAL: Nueva orden de producción ═══ */}
    <Modal open={modal} onClose={()=>setModal(false)} title="Nueva orden de producción">
      <div className="space-y-3">
        <FormSelect label="Turno" options={["Matutino","Vespertino"]} value={form.turno} onChange={e=>setForm({...form,turno:e.target.value})} />
        <FormSelect label="Máquina" options={["Máquina 30","Máquina 20","Máquina 15"]} value={form.maquina} onChange={e=>setForm({...form,maquina:e.target.value})} />
        <FormSelect label="SKU" options={skuOptions} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} />
        <FormInput label="Cantidad *" type="number" value={form.cantidad} onChange={e=>setForm({...form,cantidad:e.target.value})} placeholder="Ej: 500" error={errors.cantidad} />
        {bolsaNecesaria && (
          <div className={`p-3 rounded-xl ${n(form.cantidad) > stockBolsa ? "bg-red-50" : "bg-blue-50"}`}>
            <p className="text-xs font-semibold text-slate-700">Consumo de empaque: <span className="font-bold">{form.cantidad || 0} {bolsaNecesaria}</span></p>
            <p className={`text-xs mt-1 ${n(form.cantidad) > stockBolsa ? "text-red-600 font-bold" : "text-slate-500"}`}>
              Stock disponible: {stockBolsa.toLocaleString()}{n(form.cantidad) > stockBolsa ? " — INSUFICIENTE" : ""}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Crear orden</FormBtn></div>
    </Modal>

    {/* ═══ MODAL: Registrar transformación ═══ */}
    <Modal open={tModal} onClose={()=>setTModal(false)} title="Registrar transformación de hielo">
      <div className="space-y-4">
        {/* Explicación */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-800">
          Registra cuántos <strong>kg de barra</strong> entraron y cuántos <strong>kg de hielo procesado</strong> obtuviste. La merma se calcula automáticamente.
        </div>

        {/* Entrada */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Entrada (insumo)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Insumo *</label>
              <select
                value={tForm.input_sku}
                onChange={e => setTForm(f => ({...f, input_sku: e.target.value}))}
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-orange-400 ${tErrors.input_sku ? 'border-red-300' : 'border-slate-200'}`}
              >
                <option value="">Seleccionar…</option>
                {inputOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {tErrors.input_sku && <p className="text-xs text-red-500 mt-1">{tErrors.input_sku}</p>}
            </div>
            <FormInput
              label="Kg de entrada *"
              type="number"
              value={tForm.input_kg}
              onChange={e => setTForm(f => ({...f, input_kg: e.target.value}))}
              placeholder="Ej: 150"
              error={tErrors.input_kg}
            />
          </div>
          {tForm.input_sku && <p className="text-xs text-slate-400 mt-1">Stock disponible: <strong>{inputStock} kg</strong></p>}
        </div>

        {/* Salida */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Salida (producto obtenido)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Producto *</label>
              <select
                value={tForm.output_sku}
                onChange={e => setTForm(f => ({...f, output_sku: e.target.value}))}
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-orange-400 ${tErrors.output_sku ? 'border-red-300' : 'border-slate-200'}`}
              >
                <option value="">Seleccionar…</option>
                {outputOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {tErrors.output_sku && <p className="text-xs text-red-500 mt-1">{tErrors.output_sku}</p>}
            </div>
            <FormInput
              label="Kg obtenidos *"
              type="number"
              value={tForm.output_kg}
              onChange={e => setTForm(f => ({...f, output_kg: e.target.value}))}
              placeholder="Ej: 120"
              error={tErrors.output_kg}
            />
          </div>
        </div>

        {/* Resumen en tiempo real */}
        {inputKg > 0 && outputKg > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Entrada</p>
              <p className="text-lg font-extrabold text-slate-800">{inputKg} kg</p>
            </div>
            <div className={`rounded-xl p-3 ${mermaKg > inputKg * 0.3 ? 'bg-red-50' : 'bg-orange-50'}`}>
              <p className="text-[10px] font-semibold text-red-400 uppercase mb-1">Merma</p>
              <p className={`text-lg font-extrabold ${mermaKg > inputKg * 0.3 ? 'text-red-600' : 'text-orange-500'}`}>{mermaKg} kg</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Rendimiento</p>
              <p className={`text-lg font-extrabold ${rendPct >= 80 ? 'text-emerald-600' : rendPct >= 65 ? 'text-amber-500' : 'text-red-500'}`}>{rendPct}%</p>
            </div>
          </div>
        )}

        <FormInput label="Notas (opcional)" value={tForm.notas} onChange={e => setTForm(f => ({...f, notas: e.target.value}))} placeholder="Ej: lote de la mañana, máquina picadora 2…" />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <FormBtn onClick={() => setTModal(false)}>Cancelar</FormBtn>
        <FormBtn primary onClick={saveTransformacion}>Registrar transformación</FormBtn>
      </div>
    </Modal>
  </div>);
}
