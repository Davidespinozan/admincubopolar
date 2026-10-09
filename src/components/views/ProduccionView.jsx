import { useState, useMemo, Icons, StatusBadge, PageHeader, Modal, FormInput, FormSelect, FormBtn, EmptyState, s, n, fmtDate, useToast, useConfirm, reporteProduccion, SegmentedTabs } from './viewsCommon';
import { diaNegocio, sumarDias } from '../../utils/fechas';
import { useRef } from 'react';
import { resolverOperacion } from '../../data/produccionAtomicaLogic';
import { MAQUINAS_PRODUCCION, esPreparacion, reversibilidadPreparacion } from '../../data/preparacionBarraLogic';
import { reversibilidadProduccion } from '../../data/produccionLogic';

export function ProduccionView({ data, actions }) {
  const toast = useToast();
  const [, ConfirmEl] = useConfirm();
  const [tab, setTab] = useState('produccion'); // 'produccion' | 'preparaciones' (OP-01D: reemplaza a transformaciones)

  // ── Editar (admin solo gestiona, NO registra producción nueva) ──
  // Registro de producción ocurre exclusivamente en ProduccionStandaloneView
  // (operario en planta) vía producirYCongelar.
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState({id:null,turno:"",maquina:"",sku:"",cantidad:"",estatus:""});
  // 093: la producción no se borra; se revierte con motivo (contrato del
  // servidor). El UUID de la operación se conserva entre reintentos.
  const [revModal, setRevModal] = useState(null);
  const [revMotivo, setRevMotivo] = useState("");
  const [revirtiendo, setRevirtiendo] = useState(false);
  const opRevRef = useRef(null);
  const confirmarReverso = async () => {
    if (revirtiendo || !revModal) return;
    const motivo = s(revMotivo).trim();
    if (!motivo) { toast?.error("Escribe el motivo del reverso"); return; }
    const op = resolverOperacion(opRevRef.current, `reverso|${revModal.id}|${motivo}`);
    opRevRef.current = op;
    setRevirtiendo(true);
    try {
      const r = await actions.revertirProduccion(revModal.id, motivo, { operacionId: op.id });
      if (r?.error) return;
      opRevRef.current = null;
      toast?.success(`Producción ${s(revModal.folio)} revertida`);
      setRevModal(null);
    } finally {
      setRevirtiendo(false);
    }
  };
  const [, setEditErrors] = useState({});

  const openEdit = (r) => {
    setEditForm({id:r.id, turno:r.turno||"Turno 1", maquina:r.maquina||"Máquina 30", sku:s(r.sku), cantidad:String(r.cantidad||""), estatus:r.estatus||"En proceso"});
    setEditErrors({});
    setEditModal(true);
  };

  const saveEdit = async () => {
    // 093: solo turno y máquina; la producción es un evento inmutable.
    const err = await actions.updateProduccion(editForm.id, {
      turno: editForm.turno, maquina: editForm.maquina,
    });
    if (err) { toast?.error("No se pudo actualizar la orden"); return; }
    toast?.success("Orden actualizada");
    setEditModal(false);
  };

  // ── OP-01D: revertir una preparación desde barra (solo Admin) ──
  const [prepRev, setPrepRev] = useState(null);
  const [prepMotivo, setPrepMotivo] = useState("");
  const [revirtiendoPrep, setRevirtiendoPrep] = useState(false);
  const opPrepRevRef = useRef(null);
  const enVueloPrepRev = useRef(false);   // guard síncrono contra doble click antes del re-render
  const confirmarReversoPreparacion = async () => {
    if (revirtiendoPrep || enVueloPrepRev.current || !prepRev) return;
    const motivo = s(prepMotivo).trim();
    if (!motivo) { toast?.error('Escribe el motivo del reverso'); return; }
    const op = resolverOperacion(opPrepRevRef.current, `reverso_preparacion|${prepRev.id}|${motivo}`);
    opPrepRevRef.current = op;
    enVueloPrepRev.current = true;
    setRevirtiendoPrep(true);
    try {
      const r = await actions.revertirPreparacion(prepRev.id, motivo, { operacionId: op.id });
      if (r?.error) return; // el store ya avisó; se conserva el operacion_id
      opPrepRevRef.current = null;
      toast?.success(`Preparación ${s(prepRev.folio)} revertida`);
      setPrepRev(null);
    } finally {
      enVueloPrepRev.current = false;
      setRevirtiendoPrep(false);
    }
  };

  // ── Stats ──
  const prodNormal = useMemo(() => data.produccion.filter(p => !p.tipo || p.tipo === 'Produccion'), [data.produccion]);
  const prodPrep = useMemo(() => data.produccion.filter(esPreparacion), [data.produccion]);

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
    // 098: días de negocio como fechas de calendario (sin zona del navegador).
    const hoy = diaNegocio();
    const fechasConProd = Object.keys(diasConProduccion).sort();
    const fechaMasAntigua = fechasConProd[0] && fechasConProd[0] < hoy ? fechasConProd[0] : hoy;

    for (let fechaStr = hoy; fechaStr >= fechaMasAntigua; fechaStr = sumarDias(fechaStr, -1)) {
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
        fechaObj: new Date(Number(fechaStr.slice(0, 4)), Number(fechaStr.slice(5, 7)) - 1, Number(fechaStr.slice(8, 10))),
        registros: dataDia.registros,
        porTurno,
        totalDia,
        sinProduccion: dataDia.registros.length === 0,
      });
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

  const exportBtns = <>
    <button onClick={() => reporteProduccion(data.produccion, 'excel')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[14px] border border-emerald-200 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"><Icons.Sheet /> Excel</button>
    <button onClick={() => reporteProduccion(data.produccion, 'pdf')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[14px] border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"><Icons.FilePdf /> PDF</button>
  </>;

  return (<div>
    <PageHeader
      title="Producción"
      subtitle="Hielo y preparaciones desde barra"
      extraButtons={exportBtns}
    />

    {/* Tabs */}
    <SegmentedTabs className="mb-4" value={tab} onChange={setTab} items={[{ k: 'produccion', l: 'Producción', icon: 'Factory' }, { k: 'preparaciones', l: prodPrep.length > 0 ? `Preparaciones (${prodPrep.length})` : 'Preparaciones', icon: 'Snowflake' }]} />

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
                      <div key={turno} className="overflow-hidden rounded-card border border-line bg-white">
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
                                <div key={r.id} className="px-4 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[15px] font-semibold text-ink">{nombreProd}</p>
                                      <p className="mt-0.5 text-[13px] text-slate-500"><span className="font-mono text-slate-400">{s(r.folio)}</span> · {s(r.maquina)}</p>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                      <p className="tnum text-[17px] font-bold text-ink">{n(r.cantidad).toLocaleString()}</p>
                                      <p className="text-[11px] text-slate-400">bolsas</p>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <StatusBadge status={r.estatus} />
                                    <div className="flex items-center gap-1">
                                      {(() => { const rv = reversibilidadProduccion(r); return rv.reversible ? (
                                      <button onClick={() => { setRevModal(r); setRevMotivo(""); opRevRef.current = null; }} title="Revertir producción" className="inline-flex min-h-[36px] items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-50">
                                        <Icons.Undo /> Revertir
                                      </button>
                                      ) : (
                                      <span title={rv.razon || ''} className="px-2 text-[12px] text-slate-400">{s(r.estatus) === 'Revertida' ? 'Revertida' : 'No reversible'}</span>
                                      ); })()}
                                      <button onClick={() => openEdit(r)} title="Editar" aria-label="Editar" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink">
                                        <Icons.Pen />
                                      </button>
                                    </div>
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

    {/* ═══ TAB: PREPARACIONES DESDE BARRA (OP-01D) ═══ */}
    {tab === 'preparaciones' && <>
      {prodPrep.length === 0 ? (
        <EmptyState
          message="Sin preparaciones registradas"
          hint="Producción registra en su vista cuántas barras pica o tritura (cada barra = 2 bolsas)"
        />
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
          <div className="space-y-3">
            {prodPrep.slice().reverse().map(t => {
              const rev = reversibilidadPreparacion(t);
              return (
                <div key={t.id} className="border border-slate-100 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{n(t.input_kg)} {n(t.input_kg) === 1 ? 'barra' : 'barras'} → {n(t.cantidad)} × {s(t.sku)}</p>
                    <p className="text-xs text-slate-400">
                      <span className="font-mono font-bold text-orange-600">{s(t.folio)}</span> · {fmtDate(t.fecha)} · {s(t.cuarto_id)} · empaque {n(t.empaque_cantidad)} {s(t.empaque_sku)}
                    </p>
                  </div>
                  {s(t.estatus) === 'Revertida'
                    ? <StatusBadge status="Revertida" />
                    : rev.reversible && (
                      <button onClick={() => { setPrepRev(t); setPrepMotivo(""); opPrepRevRef.current = null; }} title="Revertir preparación"
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-xs font-semibold">Revertir</button>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>}

    {/* ═══ MODAL: Revertir preparación (OP-01D) ═══ */}
    <Modal open={!!prepRev} onClose={() => setPrepRev(null)} title={"Revertir preparación " + s(prepRev?.folio)}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Salen {n(prepRev?.cantidad).toLocaleString()} × {s(prepRev?.sku)} del cuarto <span className="font-semibold">{s(prepRev?.cuarto_id)}</span>; regresan {n(prepRev?.input_kg).toLocaleString()} barras y {n(prepRev?.empaque_cantidad).toLocaleString()} empaques {s(prepRev?.empaque_sku)}. El registro original se conserva.</p>
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">Si esas bolsas ya no están todas en el cuarto (se vendieron), el reverso se rechaza completo.</p>
        <FormInput label="Motivo *" value={prepMotivo} onChange={e => setPrepMotivo(e.target.value)} placeholder="Ej: se tomó la barra equivocada" />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setPrepRev(null)}>Cancelar</FormBtn><FormBtn primary onClick={confirmarReversoPreparacion} loading={revirtiendoPrep}>Revertir</FormBtn></div>
    </Modal>

    {/* ═══ MODAL: Editar producción ═══ */}
    {/* 093: solo turno y máquina. Para corregir SKU o cantidad se revierte
        la producción (contrato del servidor) y se registra de nuevo. */}
    <Modal open={editModal} onClose={()=>setEditModal(false)} title="Editar producción">
      <div className="space-y-3">
        <FormSelect label="Turno" options={["Turno 1","Turno 2","Turno 3"]} value={editForm.turno} onChange={e=>setEditForm({...editForm,turno:e.target.value})} />
        <FormSelect label="Máquina" options={MAQUINAS_PRODUCCION} value={editForm.maquina} onChange={e=>setEditForm({...editForm,maquina:e.target.value})} />
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SKU (no editable)</label>
          <div className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600 font-mono">{editForm.sku}</div>
          <p className="text-[11px] text-slate-400 mt-1">SKU, cantidad y estatus no se editan: la producción es un registro permanente. Si fue un error, usa <span className="font-semibold">Revertir</span> y registra de nuevo.</p>
        </div>
        <div className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600">Cantidad: {n(editForm.cantidad).toLocaleString()}</div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={()=>setEditModal(false)}>Cancelar</FormBtn><FormBtn primary onClick={saveEdit}>Guardar cambios</FormBtn></div>
    </Modal>

    {/* ═══ MODAL: Revertir producción (093) ═══ */}
    <Modal open={!!revModal} onClose={() => setRevModal(null)} title={"Revertir producción " + s(revModal?.folio)}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Se registrará un reverso: salen {n(revModal?.cantidad).toLocaleString()} × {s(revModal?.sku)} del cuarto <span className="font-semibold">{s(revModal?.cuartoId || revModal?.cuarto_id)}</span>{(revModal?.empaqueSku || revModal?.empaque_sku) ? <> y regresan {n(revModal?.empaqueCantidad ?? revModal?.empaque_cantidad).toLocaleString()} bolsas {s(revModal?.empaqueSku || revModal?.empaque_sku)}</> : null}. El registro original se conserva.</p>
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">Si ese cuarto ya no tiene esa cantidad (se vendió o salió), el reverso se rechaza completo.</p>
        <FormInput label="Motivo *" value={revMotivo} onChange={e => setRevMotivo(e.target.value)} placeholder="Ej: se capturó por error" />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setRevModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={confirmarReverso} loading={revirtiendo}>Revertir</FormBtn></div>
    </Modal>

    {ConfirmEl}
  </div>);
}
