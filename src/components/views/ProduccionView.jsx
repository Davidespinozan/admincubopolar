import { useState, useMemo, StatusBadge, PageHeader, Modal, FormInput, FormSelect, FormBtn, EmptyState, s, n, fmtDate, useToast, useConfirm, reporteProduccion, todayLocalISO } from './viewsCommon';
import { traducirError } from '../../utils/errorMessages';

export function ProduccionView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [tab, setTab] = useState('produccion'); // 'produccion' | 'transformaciones'

  // ── Editar (admin solo gestiona, NO registra producción nueva) ──
  // Registro de producción ocurre exclusivamente en ProduccionStandaloneView
  // (operario en planta) vía producirYCongelar.
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState({id:null,turno:"",maquina:"",sku:"",cantidad:"",estatus:""});
  const [editErrors, setEditErrors] = useState({});

  const openEdit = (r) => {
    setEditForm({id:r.id, turno:r.turno||"Turno 1", maquina:r.maquina||"Máquina 30", sku:s(r.sku), cantidad:String(r.cantidad||""), estatus:r.estatus||"En proceso"});
    setEditErrors({});
    setEditModal(true);
  };

  const saveEdit = async () => {
    const e = {};
    if (!editForm.cantidad || n(editForm.cantidad) <= 0) e.cantidad = "Cantidad debe ser mayor a 0";
    if (Object.keys(e).length) { setEditErrors(e); return; }
    // SKU NO se envía: updateProduccion lo bloquea (ver supaStore.js).
    // Si la cantidad cambia, NO se ajusta stock automáticamente — admin
    // debe corregir el stock manualmente desde InventarioView si aplica.
    const err = await actions.updateProduccion(editForm.id, {
      turno: editForm.turno, maquina: editForm.maquina,
      cantidad: editForm.cantidad, estatus: editForm.estatus,
    });
    if (err) { toast?.error("No se pudo actualizar la orden"); return; }
    toast?.success("Orden actualizada");
    setEditModal(false);
  };

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
    if (err) { toast?.error(traducirError(err, "Error al registrar transformación")); return; }
    toast?.success(`Transformación registrada — ${outputKg}kg de ${tForm.output_sku} (merma ${mermaKg}kg)`);
    setTModal(false);
    setTForm(TFORM_DEFAULT);
    setTErrors({});
  };

  // ── Stats ──
  const prodNormal = useMemo(() => data.produccion.filter(p => !p.tipo || p.tipo === 'Produccion'), [data.produccion]);
  const prodTransf = useMemo(() => data.produccion.filter(p => p.tipo === 'Transformacion'), [data.produccion]);

  // ── Fase 12: Agrupación por día con turnos ──
  const [paginaActual, setPaginaActual] = useState(0);
  const [diasExpandidos, setDiasExpandidos] = useState({});

  // Helper: normalizar turno legacy a nuevo
  const normalizarTurno = (t) => {
    const v = s(t).toLowerCase();
    if (v === 'matutino' || v === 'turno 1') return 'Turno 1';
    if (v === 'vespertino' || v === 'turno 2') return 'Turno 2';
    if (v === 'turno 3') return 'Turno 3';
    return s(t) || 'Sin turno';
  };

  // Agrupar producciones por día
  const diasConProduccion = useMemo(() => {
    const mapa = {};
    for (const p of prodNormal) {
      const fecha = s(p.fecha).slice(0, 10);
      if (!fecha) continue;
      if (!mapa[fecha]) mapa[fecha] = { fecha, registros: [] };
      mapa[fecha].registros.push(p);
    }
    return mapa;
  }, [prodNormal]);

  // Generar lista completa de días (incluyendo sin producción) desde hoy hacia atrás
  const todosLosDias = useMemo(() => {
    const dias = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechasConProd = Object.keys(diasConProduccion).sort();
    const fechaMasAntigua = fechasConProd[0] ? new Date(fechasConProd[0]) : hoy;

    const cursor = new Date(hoy);
    while (cursor >= fechaMasAntigua) {
      const fechaStr = todayLocalISO(cursor);
      const dataDia = diasConProduccion[fechaStr] || { fecha: fechaStr, registros: [] };

      const porTurno = { 'Turno 1': [], 'Turno 2': [], 'Turno 3': [] };
      for (const reg of dataDia.registros) {
        const t = normalizarTurno(reg.turno);
        if (porTurno[t]) porTurno[t].push(reg);
        else porTurno['Turno 1'].push(reg);
      }

      const totalDia = dataDia.registros.reduce((sum, r) => sum + n(r.cantidad), 0);

      dias.push({
        fecha: fechaStr,
        fechaObj: new Date(cursor),
        registros: dataDia.registros,
        porTurno,
        totalDia,
        sinProduccion: dataDia.registros.length === 0,
      });

      cursor.setDate(cursor.getDate() - 1);
    }
    return dias;
  }, [diasConProduccion]);

  const DIAS_POR_PAGINA = 7;
  const totalPaginas = Math.ceil(todosLosDias.length / DIAS_POR_PAGINA);
  const diasPagina = useMemo(() =>
    todosLosDias.slice(paginaActual * DIAS_POR_PAGINA, (paginaActual + 1) * DIAS_POR_PAGINA),
  [todosLosDias, paginaActual]);

  const toggleDia = (fecha) => {
    setDiasExpandidos(prev => ({ ...prev, [fecha]: !prev[fecha] }));
  };

  const formatearFechaDia = (fechaStr) => {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${diasSemana[dt.getDay()]} ${d} de ${meses[dt.getMonth()]}`;
  };

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
      action={tab === 'transformaciones' ? () => { setTModal(true); setTErrors({}); } : null}
      actionLabel={tab === 'transformaciones' ? "Registrar transformación" : null}
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
      <div className="space-y-3">
        {diasPagina.map(dia => {
          const expandido = diasExpandidos[dia.fecha];
          const fechaLegible = formatearFechaDia(dia.fecha);

          return (
            <div key={dia.fecha} className={`bg-white border rounded-2xl overflow-hidden ${dia.sinProduccion ? 'border-slate-100' : 'border-slate-200'}`}>
              {/* Header del día - clickeable */}
              <button
                onClick={() => toggleDia(dia.fecha)}
                className={`w-full px-4 sm:px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors ${dia.sinProduccion ? 'cursor-default opacity-70' : ''}`}
                disabled={dia.sinProduccion}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${expandido ? 'rotate-90' : ''} ${dia.sinProduccion ? 'opacity-30' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{fechaLegible}</p>
                    {dia.sinProduccion ? (
                      <p className="text-xs text-slate-400">Sin producción este día</p>
                    ) : (
                      <p className="text-xs text-slate-500">{dia.registros.length} {dia.registros.length === 1 ? 'registro' : 'registros'} · {dia.totalDia.toLocaleString()} bolsas</p>
                    )}
                  </div>
                </div>
                {!dia.sinProduccion && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-slate-900">{dia.totalDia.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">bolsas</p>
                  </div>
                )}
              </button>

              {/* Contenido expandido: 3 turnos */}
              {expandido && !dia.sinProduccion && (
                <div className="border-t border-slate-100 bg-slate-50/50 p-3 sm:p-4 space-y-3">
                  {['Turno 1', 'Turno 2', 'Turno 3'].map(turno => {
                    const registros = dia.porTurno[turno] || [];
                    const totalTurno = registros.reduce((sum, r) => sum + n(r.cantidad), 0);

                    return (
                      <div key={turno} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                          <p className="text-xs font-semibold text-slate-700">{turno}</p>
                          {registros.length > 0 ? (
                            <p className="text-xs text-slate-500">{registros.length} {registros.length === 1 ? 'registro' : 'registros'} · <span className="font-semibold text-slate-700">{totalTurno.toLocaleString()} bolsas</span></p>
                          ) : (
                            <p className="text-xs text-slate-400 italic">Sin producción</p>
                          )}
                        </div>
                        {registros.length > 0 && (
                          <div className="divide-y divide-slate-100">
                            {registros.map(r => {
                              const prod = (data.productos || []).find(p => s(p.sku) === s(r.sku));
                              const nombreProd = prod ? s(prod.nombre) : s(r.sku);
                              return (
                                <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span className="font-mono text-xs font-semibold text-blue-600 flex-shrink-0">{s(r.folio)}</span>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-slate-800 truncate">{nombreProd}</p>
                                      <p className="text-xs text-slate-400">{s(r.maquina)} · {n(r.cantidad).toLocaleString()} bolsas</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <StatusBadge status={r.estatus} />
                                    <button onClick={() => openEdit(r)} title="Editar" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    </button>
                                    <button onClick={() => askConfirm('Eliminar registro de producción', `¿Eliminar este registro de producción de ${fmtDate(r.fecha)}? Esto reverterá el inventario asociado.`, async () => { const err = await actions.deleteProduccion(r.id); if (err) { toast?.error("No se pudo eliminar la orden"); return; } toast?.success("Orden eliminada"); }, true)} title="Eliminar" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Paginador */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Página {paginaActual + 1} de {totalPaginas} · Mostrando 7 días
            </p>
            <div className="flex gap-2">
              <button
                disabled={paginaActual === 0}
                onClick={() => setPaginaActual(paginaActual - 1)}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 disabled:opacity-30 hover:bg-slate-50 disabled:cursor-not-allowed"
              >
                ← Anterior
              </button>
              <button
                disabled={paginaActual >= totalPaginas - 1}
                onClick={() => setPaginaActual(paginaActual + 1)}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 disabled:opacity-30 hover:bg-slate-50 disabled:cursor-not-allowed"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
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
        <EmptyState
          message="Sin transformaciones registradas"
          hint="Registra cuando tritures o piques barras de hielo para obtener hielo molido o escarchado"
          cta="Registrar primera transformación"
          onCta={() => { setTModal(true); setTErrors({}); }}
        />
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
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {(() => {
                        const p = (data.productos || []).find(x => s(x.sku) === s(t.input_sku));
                        return p ? s(p.nombre) : s(t.input_sku);
                      })()}
                    </p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-red-400 uppercase mb-1">Merma</p>
                    <p className="text-sm font-bold text-red-600">{n(t.merma_kg)} kg</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">perdidos</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Salida</p>
                    <p className="text-sm font-bold text-emerald-700">{n(t.output_kg)} kg</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {(() => {
                        const p = (data.productos || []).find(x => s(x.sku) === s(t.sku));
                        return p ? s(p.nombre) : s(t.sku);
                      })()}
                    </p>
                  </div>
                </div>
                {s(t.destino) && <p className="text-xs text-slate-400 mt-2">Notas: {s(t.destino)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>}

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
              min="0"
              step="0.01"
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
              min="0"
              step="0.01"
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

    {/* ═══ MODAL: Editar producción ═══ */}
    {/* SKU se muestra como referencia pero NO es editable: cambiar SKU
        requeriría reverso de stock. Para corregir SKU mal capturado:
        Eliminar (con reverso) y registrar de nuevo desde Standalone. */}
    <Modal open={editModal} onClose={()=>setEditModal(false)} title="Editar producción">
      <div className="space-y-3">
        <FormSelect label="Estatus" options={["En proceso","Confirmada","Cancelada"]} value={editForm.estatus} onChange={e=>setEditForm({...editForm,estatus:e.target.value})} />
        <FormSelect label="Turno" options={["Turno 1","Turno 2","Turno 3"]} value={editForm.turno} onChange={e=>setEditForm({...editForm,turno:e.target.value})} />
        <FormSelect label="Máquina" options={["Máquina 30","Máquina 20","Máquina 15"]} value={editForm.maquina} onChange={e=>setEditForm({...editForm,maquina:e.target.value})} />
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SKU (no editable)</label>
          <div className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600 font-mono">{editForm.sku}</div>
          <p className="text-[11px] text-slate-400 mt-1">Para cambiar SKU: elimina este registro (con reverso de stock) y registra de nuevo.</p>
        </div>
        <FormInput label="Cantidad *" type="number" min="0" value={editForm.cantidad} onChange={e=>setEditForm({...editForm,cantidad:e.target.value})} placeholder="Ej: 500" error={editErrors.cantidad} />
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">⚠ Cambiar la cantidad NO ajusta el stock automáticamente. Si necesitas corregir el inventario, hazlo desde Inventario → Ajustar.</p>
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setEditModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={saveEdit}>Guardar cambios</FormBtn></div>
    </Modal>

    {ConfirmEl}
  </div>);
}
