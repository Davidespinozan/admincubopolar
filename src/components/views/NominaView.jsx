import { useState, useMemo, Modal, EmptyState, s, n, fmtMoney, fmtDate, useConfirm, PageHeader, FormBtn, FormInput, FormSelect, Icons,
  Card, SectionLabel, ListRow, SegmentedTabs, KpiTile, Guia, StatusBadge, IconButton } from './viewsCommon';
import { ChoiceButton } from '../ui/Components';
import { diaNegocio } from '../../utils/fechas';
import {
  periodoNominaDe, etiquetaPeriodoNomina, camposDeRecibo,
  clasesDeTipo, etiquetaClase, asignacionDe, montoConcepto, describirMonto, describirAlcance,
  lineasEditables, lineaManualNueva, lineaDeConcepto, conceptosParaAgregar, previewDesglose,
  formDeConcepto, personasDelForm, personaIncluida, avanceTope, recibosConFaltantes, AYUDA_CONCEPTOS,
  BASES_COMISION, formasDeTipo, campoDeCalculo, esComision, esAutomatico, recibosConAutomaticos,
} from '../../data/nominaLogic';

// 100: nómina canónica. La semana es sábado → viernes (pago el viernes) en días
// de negocio; el servidor crea el periodo, toma el snapshot del salario,
// recalcula los recibos y paga. Un periodo Pagado no se edita.
// 128 (NOM-1): los bonos, comisiones y descuentos salen del catálogo de
// conceptos; cada recibo guarda su desglose y Admin lo ajusta por semana.
// 130 (NOM-2): comisiones calculadas con lo entregado y bonos condicionados a
// la asistencia; el servidor propone el número y explica de dónde salió.
const etiqueta = (p) => s(p.periodo) || etiquetaPeriodoNomina(p);
const $ = (v) => fmtMoney(v, { decimals: 2 });
const CAMPO_CHICO = 'min-h-[44px] w-full rounded-field border border-line bg-slate-50 px-3 text-right text-[15px] text-ink tnum focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-slate-100 disabled:text-slate-500';

// ── Renglón del desglose ──
function Renglon({ linea, editable, sugerido, tope, onChange, onQuitar }) {
  const deCatalogo = linea.conceptoId != null;
  const enCero = deCatalogo && !(Number(linea.monto) > 0);
  const cambiado = deCatalogo && linea.propuesto != null && Number(linea.monto) !== Number(linea.propuesto) && !enCero;
  return (
    <div className={`flex items-center gap-2 py-2 ${enCero ? 'opacity-60' : ''}`} data-testid="renglon-recibo">
      <div className="min-w-0 flex-1">
        {deCatalogo ? (
          <>
            <p className="truncate text-[15px] font-medium text-ink">{linea.nombre}</p>
            <p className={`text-[12px] text-slate-500 ${linea.detalle ? 'leading-snug' : 'truncate'}`} data-testid="renglon-detalle">
              {enCero ? (linea.detalle || 'No aplica esta semana')
                : tope ? `Lleva ${fmtMoney(tope.pagado + tope.enBorrador)} de ${fmtMoney(tope.limite)}`
                : cambiado ? `Cambiado · se propuso ${$(linea.propuesto)}${linea.detalle ? ` · ${linea.detalle}` : ''}`
                : linea.detalle ? linea.detalle
                : etiquetaClase(linea.categoria) !== linea.nombre ? etiquetaClase(linea.categoria) : 'Del catálogo'}
            </p>
          </>
        ) : editable ? (
          <div className="flex gap-2">
            <input value={linea.nombre} onChange={e => onChange({ nombre: e.target.value })} placeholder="Concepto" maxLength={60} aria-label="Nombre del renglón"
              className="min-h-[44px] min-w-0 flex-1 rounded-field border border-line bg-slate-50 px-3 text-[15px] text-ink focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15" />
            <select value={linea.categoria} onChange={e => onChange({ categoria: e.target.value })} aria-label="Clase del renglón"
              className="min-h-[44px] w-[38%] flex-shrink-0 rounded-field border border-line bg-slate-50 px-2 text-[13px] text-ink">
              {clasesDeTipo(linea.tipo).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        ) : (
          <>
            <p className="truncate text-[15px] font-medium text-ink">{linea.nombre}</p>
            <p className="truncate text-[12px] text-slate-500">{etiquetaClase(linea.categoria)} · capturado a mano</p>
          </>
        )}
      </div>
      {editable ? (
        <>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={linea.monto} onChange={e => onChange({ monto: e.target.value })}
            aria-label={`Importe de ${linea.nombre || 'renglón'}`} className={`${CAMPO_CHICO} !w-[104px] flex-shrink-0`} />
          {deCatalogo
            ? <IconButton icon={enCero ? 'Plus' : 'X'} label={enCero ? `Volver a poner ${linea.nombre}` : `Quitar ${linea.nombre} esta semana`}
                onClick={() => onChange({ monto: enCero ? String(sugerido || '') : '0' })} />
            : <IconButton icon="Trash" tone="danger" label="Borrar renglón" onClick={onQuitar} />}
        </>
      ) : (
        <p className="flex-shrink-0 text-[15px] font-semibold text-ink tnum">{$(linea.monto)}</p>
      )}
    </div>
  );
}

function Agregar({ tipo, conceptos, onConcepto, onManual }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="mt-1 inline-flex min-h-[40px] items-center gap-1.5 rounded-field px-2 text-[13px] font-semibold text-accent hover:bg-accent-soft">
        <Icons.Plus /> {tipo === 'descuento' ? 'Agregar descuento' : 'Agregar pago'}
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-field border border-line bg-slate-50 p-2">
      <div className="flex flex-wrap gap-2">
        {conceptos.map(c => (
          <button key={c.id} type="button" onClick={() => { onConcepto(c); setAbierto(false); }}
            className="min-h-[40px] rounded-full border border-line bg-white px-3 text-[13px] font-semibold text-ink hover:bg-slate-100">{s(c.nombre)}</button>
        ))}
        <button type="button" onClick={() => { onManual(); setAbierto(false); }}
          className="min-h-[40px] rounded-full border border-dashed border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-100">Otro (escribir)</button>
        <button type="button" onClick={() => setAbierto(false)} className="min-h-[40px] px-2 text-[13px] font-semibold text-slate-500">Cancelar</button>
      </div>
    </div>
  );
}

// ── Recibo de una persona ──
function ReciboEditor({ recibo, editable, data, onGuardar }) {
  const lineasServidor = useMemo(() => lineasEditables(recibo, data.nominaReciboLineas), [recibo, data.nominaReciboLineas]);
  const inicial = useMemo(() => { const c = camposDeRecibo(recibo); return { diasPagados: c.diasPagados, conSeptimo: c.conSeptimo }; }, [recibo]);
  const [campos, setCampos] = useState(inicial);
  const [lineas, setLineas] = useState(lineasServidor);
  const [guardando, setGuardando] = useState(false);
  const firma = (c, ls) => JSON.stringify([c, ls.map(l => [l.conceptoId, l.nombre, l.tipo, l.categoria, String(Number(l.monto) || 0)])]);
  const sucio = firma(campos, lineas) !== firma(inicial, lineasServidor);
  const prev = previewDesglose(recibo.salarioDiario, campos, lineas);
  const conceptos = data.nominaConceptos || [];
  const asignaciones = data.nominaConceptoEmpleados || [];

  const cambiar = (key, parche) => setLineas(ls => ls.map(l => (l.key === key ? { ...l, ...parche } : l)));
  const sugeridoDe = (l) => {
    if (l.propuesto != null && Number(l.propuesto) > 0) return Number(l.propuesto);
    const c = conceptos.find(x => n(x.id) === n(l.conceptoId));
    return c ? montoConcepto(c, asignacionDe(asignaciones, c.id, recibo.empleadoId), recibo.salarioDiario) : 0;
  };
  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try { await onGuardar(recibo.id, campos, lineas, recibo.salarioDiario); } finally { setGuardando(false); }
  };
  const bloque = (tipo) => {
    const propias = lineas.filter(l => l.tipo === tipo);
    return (
      <>
        {propias.map(l => (
          <Renglon key={l.key} linea={l} editable={editable} sugerido={sugeridoDe(l)}
            tope={l.conceptoId != null ? avanceTope(data.nominaAcumulados, l.conceptoId, recibo.empleadoId) : null}
            onChange={(parche) => cambiar(l.key, parche)} onQuitar={() => setLineas(ls => ls.filter(x => x.key !== l.key))} />
        ))}
        {!editable && propias.length === 0 && tipo === 'descuento' && <p className="py-2 text-[13px] text-slate-500">Sin descuentos.</p>}
        {editable && (
          <Agregar tipo={tipo} conceptos={conceptosParaAgregar(conceptos, lineas, tipo)}
            onConcepto={(c) => setLineas(ls => [...ls, lineaDeConcepto(c, asignacionDe(asignaciones, c.id, recibo.empleadoId), recibo.salarioDiario)])}
            onManual={() => setLineas(ls => [...ls, lineaManualNueva(tipo)])} />
        )}
      </>
    );
  };

  return (
    <div className="border-t border-line px-4 pb-4 pt-3" data-testid="recibo-editor">
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Días trabajados" type="number" inputMode="numeric" min="0" max="7" step="1" value={campos.diasPagados} disabled={!editable}
          onChange={e => setCampos(c => ({ ...c, diasPagados: e.target.value }))} />
        <div>
          <p className="mb-1.5 block text-[13px] font-medium text-slate-700">Séptimo día</p>
          <ChoiceButton active={campos.conSeptimo} tone="emerald" disabled={!editable} className="w-full"
            onClick={() => setCampos(c => ({ ...c, conSeptimo: !c.conSeptimo }))}>{campos.conSeptimo ? 'Sí se paga' : 'No se paga'}</ChoiceButton>
        </div>
      </div>

      <SectionLabel className="mb-1 mt-4">Se paga</SectionLabel>
      <div className="divide-y divide-line">
        <div className="flex items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">Sueldo</p>
            <p className="text-[12px] text-slate-500">{n(campos.diasPagados)} días × {$(recibo.salarioDiario)} (salario al generar)</p>
          </div>
          <p className="text-[15px] font-semibold text-ink tnum">{$(prev.sueldo)}</p>
        </div>
        {prev.septimoDia > 0 && (
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-[15px] font-medium text-ink">Séptimo día</p>
            <p className="text-[15px] font-semibold text-ink tnum">{$(prev.septimoDia)}</p>
          </div>
        )}
        {bloque('percepcion')}
      </div>

      <SectionLabel className="mb-1 mt-4">Se descuenta</SectionLabel>
      <div className="divide-y divide-line">{bloque('descuento')}</div>

      <div className={`mt-4 rounded-card p-3 ${prev.excede ? 'bg-red-50' : 'bg-slate-50'}`}>
        <div className="flex justify-between text-[13px] text-slate-600"><span>Total que gana</span><span className="tnum">{$(prev.totalPercepciones)}</span></div>
        <div className="flex justify-between text-[13px] text-slate-600"><span>Descuentos</span><span className="tnum">− {$(prev.deducciones)}</span></div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-ink">Se le entrega</span>
          <span className={`font-display text-xl font-bold tnum ${prev.excede ? 'text-red-700' : 'text-emerald-700'}`}>{$(prev.netoAPagar)}</span>
        </div>
        {prev.excede && <p className="mt-1 text-[13px] font-medium text-red-700">Los descuentos son mayores que lo que gana esta semana.</p>}
        {sucio && !prev.excede && <p className="mt-1 text-[12px] text-slate-500">Vista previa: falta guardar.</p>}
      </div>

      {editable && (
        <div className="mt-3 flex gap-2">
          <FormBtn primary className="flex-1" onClick={guardar} disabled={!sucio || prev.excede} loading={guardando}>Guardar recibo</FormBtn>
          {sucio && <FormBtn ghost onClick={() => { setCampos(inicial); setLineas(lineasServidor); }}>Descartar</FormBtn>}
        </div>
      )}
    </div>
  );
}

// ── Catálogo: alta y edición de un concepto ──
function ConceptoModal({ concepto, data, onClose, onGuardar }) {
  const emps = data.empleados || [];
  const [form, setForm] = useState(() => formDeConcepto(concepto, data.nominaConceptoEmpleados));
  const [verAjuste, setVerAjuste] = useState({});
  const [guardando, setGuardando] = useState(false);
  const esNuevo = !concepto?.id;
  const set = (parche) => setForm(f => ({ ...f, ...parche }));
  const setPersona = (id, parche) => setForm(f => ({ ...f, personas: { ...f.personas, [String(id)]: { incluida: personaIncluida(f, id), monto: '', limite: '', ...f.personas[String(id)], ...parche } } }));
  const deptos = useMemo(() => [...new Set(emps.filter(e => s(e.estatus) === 'Activo').map(e => s(e.depto)).filter(Boolean))].sort(), [emps]);
  const personas = personasDelForm(form, emps);
  const esPorcentaje = form.calculo === 'porcentaje_sd' || form.calculo === 'porcentaje_ventas';
  const comision = esComision(form.calculo);
  const campo = campoDeCalculo(form.calculo);
  const productos = useMemo(() => (data.productos || []).filter(p => s(p.tipo) === 'Producto Terminado').sort((a, b) => s(a.nombre).localeCompare(s(b.nombre))), [data.productos]);
  const alternarSku = (sku) => set({ skus: form.skus.includes(sku) ? form.skus.filter(x => x !== sku) : [...form.skus, sku] });
  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try { const r = await onGuardar(concepto?.id ?? null, form, emps); if (!r?.error) onClose(); } finally { setGuardando(false); }
  };

  return (
    <Modal open onClose={onClose} title={esNuevo ? 'Nuevo concepto' : s(concepto.nombre)} kicker="Concepto de nómina" wide
      footer={<><FormBtn ghost onClick={onClose}>Cancelar</FormBtn><FormBtn primary className="flex-1" onClick={guardar} loading={guardando}>Guardar concepto</FormBtn></>}>
      <div className="space-y-4" data-testid="concepto-form">
        <FormInput label="Nombre" value={form.nombre} maxLength={60} placeholder="Bono de puntualidad" onChange={e => set({ nombre: e.target.value })} />
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-slate-700">¿Qué hace?</p>
          <div className="grid grid-cols-2 gap-2">
            <ChoiceButton active={form.tipo === 'percepcion'} tone="emerald" disabled={!esNuevo} onClick={() => set({ tipo: 'percepcion', categoria: 'bono_puntualidad' })}>Se le paga</ChoiceButton>
            <ChoiceButton active={form.tipo === 'descuento'} tone="amber" disabled={!esNuevo} onClick={() => set({ tipo: 'descuento', categoria: 'prestamo', calculo: comision ? 'fijo' : form.calculo, reglaAsistencia: false })}>Se le descuenta</ChoiceButton>
          </div>
          {!esNuevo && <p className="mt-1 text-xs text-slate-500">El tipo y la clase no se cambian. Si ya no sirve, desactívalo y crea otro.</p>}
        </div>
        <FormSelect label="Clase" value={form.categoria} disabled={!esNuevo} onChange={e => set({ categoria: e.target.value })}
          options={clasesDeTipo(form.tipo).map(c => ({ value: c.id, label: c.label }))} />
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-slate-700">¿Cómo se calcula?</p>
          <div className="grid grid-cols-2 gap-2" data-testid="concepto-calculo">
            {formasDeTipo(form.tipo).map(f => (
              <ChoiceButton key={f.id} active={form.calculo === f.id} tone="slate" onClick={() => set({ calculo: f.id })}>{f.label}</ChoiceButton>
            ))}
          </div>
        </div>
        {comision && (
          <div data-testid="concepto-comision">
            <p className="mb-1.5 text-[13px] font-medium text-slate-700">¿Qué cuenta?</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {BASES_COMISION.map(b => (
                <ChoiceButton key={b.id} active={form.baseRol === b.id} tone="slate" onClick={() => set({ baseRol: b.id })}>{b.label}</ChoiceButton>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{BASES_COMISION.find(b => b.id === form.baseRol)?.ayuda} Cuenta lo ya entregado en la semana; una venta cancelada no cuenta y ninguna se paga dos veces.</p>
            <details className="mt-2 rounded-card border border-line px-3 py-2" open={form.skus.length > 0}>
              <summary className="min-h-[32px] cursor-pointer text-[13px] font-medium text-slate-600">
                {form.skus.length ? `Solo ${form.skus.length} producto${form.skus.length === 1 ? '' : 's'}` : 'Todos los productos (toca para elegir solo algunos)'}
              </summary>
              <div className="mt-1 divide-y divide-line">
                {productos.map(p => (
                  <label key={p.sku} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px] text-ink">
                    <input type="checkbox" className="h-5 w-5 flex-shrink-0 accent-[#0E7490]" checked={form.skus.includes(s(p.sku))} onChange={() => alternarSku(s(p.sku))} />
                    <span className="min-w-0 truncate">{s(p.nombre)}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        )}
        <FormInput label={campo.label} type="number" inputMode="decimal" min="0" step="0.01" value={form.monto}
          placeholder={campo.ejemplo} onChange={e => set({ monto: e.target.value })}
          hint={form.calculo === 'porcentaje_sd' ? 'Ejemplo: 25 = la cuarta parte de un día de salario.'
            : form.calculo === 'porcentaje_ventas' ? 'Ejemplo: 2 = dos pesos por cada cien vendidos.'
            : 'Si cambia por persona, déjalo en 0 y escribe el de cada quien abajo.'} />
        {form.tipo === 'percepcion' && (
          <div className="rounded-card border border-line px-3 py-2" data-testid="concepto-regla">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] text-ink">
              <input type="checkbox" className="h-5 w-5 flex-shrink-0 accent-[#0E7490]" checked={form.reglaAsistencia} onChange={e => set({ reglaAsistencia: e.target.checked })} />
              Solo si cumple con su asistencia
            </label>
            {form.reglaAsistencia && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormInput label="Retardos permitidos" type="number" inputMode="numeric" min="0" max="7" step="1" value={form.maxRetardos} onChange={e => set({ maxRetardos: e.target.value })} />
                  <FormInput label="Faltas permitidas" type="number" inputMode="numeric" min="0" max="7" step="1" value={form.maxFaltas} onChange={e => set({ maxFaltas: e.target.value })} />
                </div>
                <p className="mt-1 text-xs text-slate-500">Usa el reloj checador de la semana. Si se pasa, el renglón llega en 0 con el motivo; quien no tiene turno no se evalúa. Siempre lo puedes cambiar en el recibo.</p>
              </>
            )}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-slate-700">¿A quién aplica?</p>
          <div className="grid grid-cols-3 gap-2">
            <ChoiceButton active={form.aplicaA === 'todos'} tone="slate" onClick={() => set({ aplicaA: 'todos' })}>Todos</ChoiceButton>
            <ChoiceButton active={form.aplicaA === 'departamento'} tone="slate" onClick={() => set({ aplicaA: 'departamento', departamento: form.departamento || deptos[0] || '' })}>Un área</ChoiceButton>
            <ChoiceButton active={form.aplicaA === 'personas'} tone="slate" onClick={() => set({ aplicaA: 'personas' })}>Personas</ChoiceButton>
          </div>
        </div>
        {form.aplicaA === 'departamento' && (
          <FormSelect label="Área" value={form.departamento} onChange={e => set({ departamento: e.target.value })} options={deptos.length ? deptos : ['']} />
        )}

        <div>
          <SectionLabel className="mb-1">{form.aplicaA === 'personas' ? 'Elige a las personas' : 'Personas (quita a quien no le toque)'}</SectionLabel>
          <div className="divide-y divide-line rounded-card border border-line">
            {personas.length === 0 && <p className="px-4 py-3 text-[13px] text-slate-500">No hay empleados activos en esta área.</p>}
            {personas.map(e => {
              const p = form.personas[String(e.id)] || {};
              const incluida = personaIncluida(form, e.id);
              const conAjuste = incluida && (form.aplicaA === 'personas' || verAjuste[e.id] || p.monto || p.limite);
              const tope = !esNuevo ? avanceTope(data.nominaAcumulados, concepto.id, e.id) : null;
              return (
                <div key={e.id} className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <label className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-5 w-5 flex-shrink-0 accent-[#0E7490]" checked={incluida} onChange={ev => setPersona(e.id, { incluida: ev.target.checked })} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium text-ink">{s(e.nombre)}</span>
                        <span className="block truncate text-[12px] text-slate-500">{s(e.puesto)}{s(e.estatus) !== 'Activo' ? ' · baja' : ''}</span>
                      </span>
                    </label>
                    {incluida && form.aplicaA !== 'personas' && !conAjuste && (
                      <button type="button" onClick={() => setVerAjuste(v => ({ ...v, [e.id]: true }))} className="min-h-[40px] flex-shrink-0 px-2 text-[13px] font-semibold text-accent">Monto distinto</button>
                    )}
                  </div>
                  {conAjuste && (
                    <div className="mb-1 ml-8 grid grid-cols-2 gap-2">
                      <label className="text-[12px] text-slate-500">{esPorcentaje ? '% propio' : comision ? 'Pesos propios' : 'Monto propio'}
                        <input type="number" inputMode="decimal" min="0" step="0.01" value={p.monto || ''} placeholder={form.monto || '0'} onChange={ev => setPersona(e.id, { monto: ev.target.value })} className={`${CAMPO_CHICO} mt-1`} />
                      </label>
                      {form.tipo === 'descuento' && (
                        <label className="text-[12px] text-slate-500">Total a descontar
                          <input type="number" inputMode="decimal" min="0" step="0.01" value={p.limite || ''} placeholder="Sin tope" onChange={ev => setPersona(e.id, { limite: ev.target.value })} className={`${CAMPO_CHICO} mt-1`} />
                        </label>
                      )}
                      {tope && <p className="col-span-2 text-[12px] text-slate-500">Lleva {$(tope.pagado)} pagados{tope.enBorrador > 0 ? ` y ${$(tope.enBorrador)} en borradores` : ''}; faltan {$(tope.restante)}.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {form.tipo === 'descuento' && <p className="mt-1 text-xs text-slate-500">"Total a descontar" sirve para préstamos: al llegar a ese total, el sistema deja de descontarlo solo.</p>}
        </div>

        <details className="rounded-card border border-line px-3 py-2">
          <summary className="min-h-[32px] cursor-pointer text-[13px] font-medium text-slate-600">Fechas y estado (opcional)</summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <FormInput label="Desde" type="date" value={form.vigenteDesde} onChange={e => set({ vigenteDesde: e.target.value })} />
            <FormInput label="Hasta" type="date" value={form.vigenteHasta} onChange={e => set({ vigenteHasta: e.target.value })} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Sin fechas aplica siempre.</p>
          <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] text-ink">
            <input type="checkbox" className="h-5 w-5 accent-[#0E7490]" checked={form.activo} onChange={e => set({ activo: e.target.checked })} />
            Activo (se propone en las nóminas nuevas)
          </label>
        </details>
      </div>
    </Modal>
  );
}

export function NominaView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
  const emps = data.empleados || [];
  const periodos = useMemo(() => [...(data.nominaPeriodos || [])].sort((a, b) => s(b.fechaInicio).localeCompare(s(a.fechaInicio))), [data.nominaPeriodos]);
  const recibos = data.nominaRecibos || [];
  const conceptos = data.nominaConceptos || [];
  const asignaciones = data.nominaConceptoEmpleados || [];
  const deptos = ["Ventas y Distribución", "Producción", "Administración", "Staff"];
  const [tab, setTab] = useState('semanas');
  const [periodoId, setPeriodoId] = useState(null);
  const [reciboAbierto, setReciboAbierto] = useState(null);
  const [conceptoSel, setConceptoSel] = useState(null);   // null | 'nuevo' | concepto
  const [otraFecha, setOtraFecha] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Solo para mostrar: la semana actual del negocio. El servidor la decide al crear.
  const semanaActual = useMemo(() => periodoNominaDe(diaNegocio()), []);

  const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
  const totalSemanal = empsActivos.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);
  const periodosBorrador = periodos.filter(p => s(p.estatus) !== "Pagado");
  const periodosPagados = periodos.filter(p => s(p.estatus) === "Pagado").slice(0, 10);
  const periodoSel = periodos.find(p => n(p.id) === n(periodoId)) || null;
  const recibosDe = (pid) => recibos.filter(r => n(r.periodoId) === n(pid));
  const nombreDe = (r) => s(emps.find(e => n(e.id) === n(r.empleadoId))?.nombre) || `Empleado #${r.empleadoId}`;
  const recibosSel = useMemo(() => (periodoSel ? recibos.filter(r => n(r.periodoId) === n(periodoSel.id)) : [])
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b))), [recibos, periodoSel, emps]);
  const esBorrador = periodoSel ? s(periodoSel.estatus) === 'Borrador' : false;
  const faltantes = useMemo(() => (esBorrador ? recibosConFaltantes(recibosSel, data.nominaReciboLineas, conceptos, asignaciones, emps) : 0),
    [esBorrador, recibosSel, data.nominaReciboLineas, conceptos, asignaciones, emps]);
  const automaticos = useMemo(() => (esBorrador ? recibosConAutomaticos(recibosSel, data.nominaReciboLineas, conceptos) : 0),
    [esBorrador, recibosSel, data.nominaReciboLineas, conceptos]);
  const porPagar = periodosBorrador.reduce((sum, p) => sum + n(p.totalNeto), 0);

  const correr = async (fn) => {
    if (ocupado) return;
    setOcupado(true);
    try { await fn(); } finally { setOcupado(false); }
  };
  const crear = (fecha) => correr(async () => { await actions.crearPeriodoNomina(fecha || null); });
  const generar = (p) => correr(async () => { await actions.generarRecibosNomina(p.id); });
  const aplicar = (p) => correr(async () => { await actions.aplicarConceptosNomina(p.id); });
  // Con comisiones o bonos automáticos, primero se recalcula (ventas y asistencia
  // cambian durante la semana) y se confirma el total YA actualizado.
  const pagar = (p) => correr(async () => {
    let total = n(p.totalNeto);
    let nota = '';
    // También cuando el concepto automático se creó DESPUÉS de generar los recibos (aún no
    // hay renglones): si no, la semana se pagaba sin esas comisiones.
    if (conceptos.some(c => c.activo !== false && esAutomatico(c)) || recibosConAutomaticos(recibosDe(p.id), data.nominaReciboLineas, conceptos) > 0) {
      const r = await actions.aplicarConceptosNomina(p.id, { silencioso: true });
      if (r?.error) return;
      const nuevo = n(r.data?.total_neto);
      if (nuevo !== total) nota = ' Se actualizaron las comisiones y bonos automáticos.';
      total = nuevo;
    }
    askConfirm('Pagar nómina',
      `${etiqueta(p)} — se registrará un egreso de ${$(total)} con fecha de hoy.${nota} El periodo quedará cerrado y sus recibos ya no se podrán editar.`,
      () => correr(async () => { await actions.pagarNomina(p.id); }));
  });
  const abrir = (p) => { setPeriodoId(p.id); setReciboAbierto(null); };
  const conceptosDe = (tipo) => conceptos.filter(c => c.tipo === tipo).sort((a, b) => (b.activo !== false) - (a.activo !== false) || s(a.nombre).localeCompare(s(b.nombre)));

  return (<div className="space-y-4">
    {ConfirmEl}
    <PageHeader title="Nómina" subtitle={semanaActual ? `Semana actual: ${etiquetaPeriodoNomina(semanaActual)} · pago el viernes` : 'Periodos y recibos'} />
    <SegmentedTabs value={tab} onChange={setTab} items={[{ k: 'semanas', l: 'Semanas' }, { k: 'conceptos', l: 'Conceptos' }, { k: 'equipo', l: 'Sueldos' }]} />

    {tab === 'semanas' && (<>
      {semanaActual && <p className="text-[13px] text-slate-500 sm:hidden">Semana actual: {etiquetaPeriodoNomina(semanaActual)} · pago el viernes</p>}
      <FormBtn primary className="w-full" onClick={() => crear(null)} disabled={ocupado}><Icons.Plus /> Nómina de esta semana</FormBtn>
      <details className="rounded-card border border-line bg-white px-3 py-2">
        <summary className="min-h-[32px] cursor-pointer text-[13px] font-medium text-slate-600">Crear la nómina de otra semana</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1"><FormInput label="Cualquier día de esa semana" type="date" value={otraFecha} onChange={e => setOtraFecha(e.target.value)} /></div>
          <FormBtn onClick={() => otraFecha && crear(otraFecha)} disabled={!otraFecha || ocupado}>Crear</FormBtn>
          {otraFecha && periodoNominaDe(otraFecha) && <p className="w-full text-xs text-slate-500">Se creará: {etiquetaPeriodoNomina(periodoNominaDe(otraFecha))}</p>}
        </div>
      </details>
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="Por pagar" value={$(porPagar)} hint={`${periodosBorrador.length} semana${periodosBorrador.length === 1 ? '' : 's'} en borrador`} tone={porPagar > 0 ? 'warning' : undefined} />
        <KpiTile label="Sueldos por semana" value={fmtMoney(totalSemanal)} hint={`${empsActivos.length} empleados · sin bonos ni descuentos`} />
      </div>

      {periodos.length === 0 && <EmptyState message="Aún no hay nóminas" hint="Toca “Nómina de esta semana” para crear la primera con los recibos de todos" />}

      {periodosBorrador.length > 0 && (<div>
        <SectionLabel className="mb-2 mt-2">Borradores por pagar</SectionLabel>
        <div className="space-y-2">
          {periodosBorrador.map(p => {
            const recP = recibosDe(p.id);
            return (
              <Card key={p.id} tone="warning">
                <p className="text-[15px] font-semibold text-ink">{etiqueta(p)}</p>
                <p className="mt-0.5 text-[13px] text-slate-600">Pago: {fmtDate(p.fechaPago)} · {recP.length} recibo{recP.length === 1 ? '' : 's'}</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-[13px] text-slate-600">Se entrega{n(p.totalDeducciones) > 0 ? ` (descuentos ${$(p.totalDeducciones)})` : ''}</span>
                  <span className="font-display text-xl font-bold text-ink tnum">{$(p.totalNeto)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {recP.length === 0
                    ? <FormBtn primary className="flex-1" onClick={() => generar(p)} disabled={ocupado}>Generar recibos</FormBtn>
                    : <FormBtn primary className="flex-1" onClick={() => abrir(p)}>Revisar recibos</FormBtn>}
                  <FormBtn success onClick={() => pagar(p)} disabled={ocupado || recP.length === 0 || n(p.totalNeto) <= 0}>Pagar</FormBtn>
                </div>
              </Card>
            );
          })}
        </div>
      </div>)}

      {periodosPagados.length > 0 && (<div>
        <SectionLabel className="mb-2 mt-2">Pagadas</SectionLabel>
        <Card padding="p-0" className="divide-y divide-line overflow-hidden">
          {periodosPagados.map(p => (
            <ListRow key={p.id} icon="Check" title={etiqueta(p)} subtitle={`Pagada · ${recibosDe(p.id).length} recibos`} value={$(p.totalNeto)} chevron onClick={() => abrir(p)} />
          ))}
        </Card>
      </div>)}
    </>)}

    {tab === 'conceptos' && (<div className="space-y-4" data-testid="nomina-conceptos">
      <Guia titulo="Bonos, comisiones y descuentos">{AYUDA_CONCEPTOS}</Guia>
      <FormBtn primary className="w-full" onClick={() => setConceptoSel('nuevo')}><Icons.Plus /> Nuevo concepto</FormBtn>
      {conceptos.length === 0 && <EmptyState message="Aún no hay conceptos" hint="Crea el primero, por ejemplo “Bono de puntualidad” de $200 por semana para todos" />}
      {[['percepcion', 'Se pagan'], ['descuento', 'Se descuentan']].map(([tipo, titulo]) => {
        const lista = conceptosDe(tipo);
        if (lista.length === 0) return null;
        return (
          <div key={tipo}>
            <SectionLabel className="mb-2">{titulo}</SectionLabel>
            <Card padding="p-0" className="divide-y divide-line overflow-hidden">
              {lista.map(c => (
                <ListRow key={c.id} title={s(c.nombre)} chevron onClick={() => setConceptoSel(c)}
                  subtitle={`${etiquetaClase(c.categoria)} · ${describirMonto(c)} · ${describirAlcance(c, asignaciones)}`}
                  badge={c.activo === false ? <StatusBadge status="Inactivo" /> : undefined} />
              ))}
            </Card>
          </div>
        );
      })}
    </div>)}

    {tab === 'equipo' && (<div>
      <p className="text-[13px] text-slate-500">Salario × 7 días (6 trabajados + séptimo). Es referencia: el pago usa los recibos de cada semana. El salario se cambia en Empleados.</p>
      {deptos.map(d => {
        const dEmps = empsActivos.filter(e => s(e.depto) === d);
        if (dEmps.length === 0) return null;
        const totalDepto = dEmps.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);
        return (<div key={d}>
          <SectionLabel className="mb-2 mt-4">{d} · {dEmps.length} · {fmtMoney(totalDepto)} por semana</SectionLabel>
          <Card padding="p-0" className="divide-y divide-line overflow-hidden">
            {dEmps.map(e => (
              <ListRow key={e.id} avatar={s(e.nombre)} title={s(e.nombre)} subtitle={s(e.puesto)} value={fmtMoney(n(e.salarioDiario) * 7)} valueHint={`${$(e.salarioDiario)} por día`} />
            ))}
          </Card>
        </div>);
      })}
    </div>)}

    {periodoSel && (
      <Modal open onClose={() => setPeriodoId(null)} title={etiqueta(periodoSel)} kicker={esBorrador ? 'Nómina en borrador' : 'Nómina pagada'} wide
        footer={<>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Se entrega</p>
            <p className="font-display text-lg font-bold text-ink tnum">{$(periodoSel.totalNeto)}</p>
          </div>
          {esBorrador && <FormBtn success onClick={() => pagar(periodoSel)} disabled={ocupado || recibosSel.length === 0 || n(periodoSel.totalNeto) <= 0}>Pagar</FormBtn>}
          <FormBtn ghost onClick={() => setPeriodoId(null)}>Cerrar</FormBtn>
        </>}>
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500">
            {esBorrador
              ? 'Toca a una persona para ver y ajustar lo de esta semana. Los bonos y descuentos del catálogo ya vienen puestos.'
              : 'Nómina pagada: los recibos quedan como historia y no se editan.'}
          </p>
          {esBorrador && faltantes > 0 && (
            <Card tone="warning" padding="p-3">
              <p className="text-[14px] font-semibold text-ink">{faltantes} recibo{faltantes === 1 ? ' no tiene' : 's no tienen'} todos los bonos y descuentos</p>
              <p className="text-[13px] text-slate-600">Se crearon o cambiaron después de generar esta nómina. Lo que ya capturaste no se toca.</p>
              <FormBtn className="mt-2" onClick={() => aplicar(periodoSel)} disabled={ocupado}>Agregar lo que falta</FormBtn>
            </Card>
          )}
          {esBorrador && automaticos > 0 && faltantes === 0 && (
            <Card padding="p-3" data-testid="nomina-automaticos">
              <p className="text-[14px] font-semibold text-ink">Comisiones y bonos automáticos</p>
              <p className="text-[13px] text-slate-600">Se calculan con lo entregado y la asistencia hasta este momento. Lo que cambiaste a mano se respeta.</p>
              <FormBtn className="mt-2" onClick={() => aplicar(periodoSel)} disabled={ocupado}>Actualizar cálculos</FormBtn>
            </Card>
          )}
          {recibosSel.length === 0 ? (
            <EmptyState message="Aún no hay recibos" hint="Genera los recibos de los empleados activos" />
          ) : (
            <Card padding="p-0" className="overflow-hidden">
              {recibosSel.map(r => {
                const emp = emps.find(e => n(e.id) === n(r.empleadoId));
                const abierto = n(reciboAbierto) === n(r.id);
                return (
                  <div key={r.id} className="border-b border-line last:border-b-0" data-testid={`recibo-${r.id}`}>
                    <ListRow avatar={nombreDe(r)} title={nombreDe(r)} subtitle={`${emp ? s(emp.puesto) : ''}${n(r.deducciones) > 0 ? ` · descuentos ${$(r.deducciones)}` : ''}`}
                      value={$(r.netoAPagar)} onClick={() => setReciboAbierto(abierto ? null : r.id)}
                      trailing={<span className={`flex-shrink-0 text-slate-400 transition-transform ${abierto ? 'rotate-90' : ''}`}><Icons.ChevronRight /></span>} />
                    {abierto && (
                      <ReciboEditor key={`${r.id}-${s(r.updatedAt)}-${(data.nominaReciboLineas || []).length}`} recibo={r} editable={esBorrador} data={data}
                        onGuardar={actions.guardarReciboNomina} />
                    )}
                  </div>
                );
              })}
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3">
            <KpiTile compact label="Total que ganan" value={$(periodoSel.totalPercepciones)} />
            <KpiTile compact label="Descuentos" value={$(periodoSel.totalDeducciones)} />
          </div>
          {esBorrador && recibosSel.length > 0 && recibosSel.length < empsActivos.length && (
            <FormBtn className="w-full" onClick={() => generar(periodoSel)} disabled={ocupado}>Generar los recibos que faltan</FormBtn>
          )}
        </div>
      </Modal>
    )}

    {conceptoSel && (
      <ConceptoModal concepto={conceptoSel === 'nuevo' ? null : conceptoSel} data={data} onClose={() => setConceptoSel(null)} onGuardar={actions.guardarConceptoNomina} />
    )}
  </div>);
}
