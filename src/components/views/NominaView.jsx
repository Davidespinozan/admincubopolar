import { useState, useMemo, Modal, EmptyState, s, n, fmtMoney, fmtDate, useConfirm, PageHeader, FormBtn, Icons } from './viewsCommon';
import { diaNegocio } from '../../utils/fechas';
import { periodoNominaDe, etiquetaPeriodoNomina, previewRecibo, camposDeRecibo } from '../../data/nominaLogic';

// 100: nómina canónica. La semana es sábado → viernes (pago el viernes) en días
// de negocio de Mazatlán; el servidor crea el periodo, toma el snapshot del
// salario, recalcula los recibos y paga. Un periodo Pagado no se edita.
const etiqueta = (p) => s(p.periodo) || etiquetaPeriodoNomina(p);

function ReciboEditor({ recibo, empleado, editable, onGuardar }) {
  const [campos, setCampos] = useState(() => camposDeRecibo(recibo));
  const [guardando, setGuardando] = useState(false);
  const prev = previewRecibo(recibo.salarioDiario, campos);
  const sucio = JSON.stringify(campos) !== JSON.stringify(camposDeRecibo(recibo));
  const set = (k) => (e) => setCampos(c => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const input = (k, label, extra = {}) => (
    <label className="text-xs text-slate-500">
      {label}
      <input type="number" inputMode="decimal" min="0" step="0.01" value={campos[k]} onChange={set(k)} disabled={!editable}
        className="mt-1 w-full px-2 py-2 border border-slate-200 rounded-lg text-base sm:text-sm min-h-[44px] disabled:bg-slate-100" {...extra} />
    </label>
  );
  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try { await onGuardar(recibo.id, campos); } finally { setGuardando(false); }
  };
  const mostrado = sucio ? prev : {
    sueldo: n(recibo.sueldo), septimoDia: n(recibo.septimoDia), totalPercepciones: n(recibo.totalPercepciones),
    deducciones: n(recibo.deducciones), netoAPagar: n(recibo.netoAPagar),
  };
  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-semibold text-slate-800">{empleado ? s(empleado.nombre) : `Empleado #${recibo.empleadoId}`}</p>
          <p className="text-xs text-slate-400">{empleado ? s(empleado.puesto) : ''} · {fmtMoney(recibo.salarioDiario, { decimals: 2 })}/día (al generar)</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-600">{fmtMoney(mostrado.netoAPagar, { decimals: 2 })}</p>
          <p className="text-[10px] text-slate-400">{sucio ? 'Vista previa — sin guardar' : 'Neto a pagar'}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <label className="text-xs text-slate-500">
          Días trabajados
          <input type="number" inputMode="numeric" min="0" max="7" step="1" value={campos.diasPagados} onChange={set('diasPagados')} disabled={!editable}
            className="mt-1 w-full px-2 py-2 border border-slate-200 rounded-lg text-base sm:text-sm min-h-[44px] disabled:bg-slate-100" />
        </label>
        <label className="text-xs text-slate-500 flex items-center gap-2 min-h-[44px] mt-4">
          <input type="checkbox" checked={campos.conSeptimo} onChange={set('conSeptimo')} disabled={!editable} className="w-5 h-5" />
          Séptimo día
        </label>
        {input('comisiones', 'Comisiones')}
        {input('primaDominical', 'Prima dominical')}
        {input('bonoPuntualidad', 'Bono puntualidad')}
        {input('bonoProductividad', 'Bono productividad')}
        {input('otrasPercepciones', 'Otras percepciones')}
        {input('deducciones', 'Deducciones')}
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
        <div className="bg-white rounded-lg p-2 text-center"><p className="text-slate-400">Sueldo</p><p className="font-bold text-slate-700">{fmtMoney(mostrado.sueldo, { decimals: 2 })}</p></div>
        <div className="bg-white rounded-lg p-2 text-center"><p className="text-slate-400">Séptimo</p><p className="font-bold text-slate-700">{fmtMoney(mostrado.septimoDia, { decimals: 2 })}</p></div>
        <div className="bg-white rounded-lg p-2 text-center"><p className="text-slate-400">Percepciones</p><p className="font-bold text-blue-600">{fmtMoney(mostrado.totalPercepciones, { decimals: 2 })}</p></div>
        <div className="bg-white rounded-lg p-2 text-center"><p className="text-slate-400">Deducciones</p><p className="font-bold text-red-600">{fmtMoney(mostrado.deducciones, { decimals: 2 })}</p></div>
      </div>
      {editable && (
        <div className="flex gap-2 mt-3">
          <button onClick={guardar} disabled={!sucio || guardando} className="flex-1 min-h-[44px] bg-blue-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {guardando ? 'Guardando…' : 'Guardar recibo'}
          </button>
          {sucio && <button onClick={() => setCampos(camposDeRecibo(recibo))} className="min-h-[44px] px-4 bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold">Descartar</button>}
        </div>
      )}
    </div>
  );
}

export function NominaView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
  const emps = data.empleados || [];
  const periodos = useMemo(() => [...(data.nominaPeriodos || [])].sort((a, b) => s(b.fechaInicio).localeCompare(s(a.fechaInicio))), [data.nominaPeriodos]);
  const recibos = data.nominaRecibos || [];
  const deptos = ["Ventas y Distribución", "Producción", "Administración", "Staff"];
  const [periodoId, setPeriodoId] = useState(null);
  const [otraFecha, setOtraFecha] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Solo para mostrar: la semana actual en Mazatlán. El servidor la decide al crear.
  const semanaActual = useMemo(() => periodoNominaDe(diaNegocio()), []);

  const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
  const empsPorDepto = {};
  for (const d of deptos) empsPorDepto[d] = empsActivos.filter(e => s(e.depto) === d);
  const totalSemanal = empsActivos.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);

  const periodosBorrador = periodos.filter(p => s(p.estatus) !== "Pagado");
  const periodosPagados = periodos.filter(p => s(p.estatus) === "Pagado").slice(0, 10);
  const periodoSel = periodos.find(p => n(p.id) === n(periodoId)) || null;
  const recibosDe = (pid) => recibos.filter(r => n(r.periodoId) === n(pid));
  const recibosSel = useMemo(() => (periodoSel ? recibos.filter(r => n(r.periodoId) === n(periodoSel.id)) : []), [recibos, periodoSel]);

  const correr = async (fn) => {
    if (ocupado) return;
    setOcupado(true);
    try { await fn(); } finally { setOcupado(false); }
  };
  const crear = (fecha) => correr(async () => { await actions.crearPeriodoNomina(fecha || null); });
  const generar = (p) => correr(async () => { await actions.generarRecibosNomina(p.id); });
  const pagar = (p) => {
    askConfirm('Pagar nómina',
      `${etiqueta(p)} — se registrará un egreso de ${fmtMoney(p.totalNeto, { decimals: 2 })} con fecha de hoy. El periodo quedará cerrado y sus recibos ya no se podrán editar.`,
      () => correr(async () => { await actions.pagarNomina(p.id); }));
  };
  // El store ya avisa del resultado (éxito o error traducido).
  const guardarRecibo = (reciboId, campos) => actions.editarReciboNomina(reciboId, campos);

  return (<div className="space-y-4">
    {ConfirmEl}
    <PageHeader title="Nómina" subtitle={semanaActual ? `Semana actual: ${etiquetaPeriodoNomina(semanaActual)} · pago el viernes` : 'Periodos y recibos'} />
    {semanaActual && <p className="text-[13px] text-slate-500 sm:hidden">Semana actual: {etiquetaPeriodoNomina(semanaActual)} · pago el viernes</p>}
    <FormBtn primary className="w-full" onClick={() => crear(null)} disabled={ocupado}><Icons.Plus /> Nómina de esta semana</FormBtn>
    <details className="bg-white rounded-xl p-3 border border-slate-100">
      <summary className="text-xs text-slate-500 cursor-pointer min-h-[32px]">Crear la nómina de otra semana</summary>
      <div className="flex flex-wrap gap-2 mt-2 items-end">
        <label className="text-xs text-slate-500">
          Cualquier día de esa semana
          <input type="date" value={otraFecha} onChange={e => setOtraFecha(e.target.value)} className="block mt-1 px-3 py-2 border border-slate-200 rounded-lg text-base sm:text-sm min-h-[44px]" />
        </label>
        <button onClick={() => otraFecha && crear(otraFecha)} disabled={!otraFecha || ocupado} className="bg-slate-700 disabled:bg-slate-300 text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold">Crear</button>
        {otraFecha && periodoNominaDe(otraFecha) && <p className="text-xs text-slate-400 w-full">Se creará: {etiquetaPeriodoNomina(periodoNominaDe(otraFecha))}</p>}
      </div>
    </details>
    <div className="bg-white rounded-xl p-5 border border-slate-100">
      <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Total semanal estimado</p>
      <p className="text-3xl font-extrabold text-slate-800">{fmtMoney(totalSemanal, { decimals: 2 })}</p>
      <p className="text-xs text-slate-400 mt-1">{empsActivos.length} empleados activos · Salario × 7 días (6 + séptimo). Referencia; el pago usa los recibos.</p>
    </div>

    {periodosBorrador.length > 0 && (<div>
      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mt-4 mb-2">Borradores pendientes de pago</h3>
      <div className="space-y-2">
        {periodosBorrador.map(p => {
          const recP = recibosDe(p.id);
          return (
          <div key={p.id} className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{etiqueta(p)}</p>
                <p className="text-xs text-slate-500">Pago: {fmtDate(p.fechaPago)} · Neto {fmtMoney(p.totalNeto, { decimals: 2 })}
                  {n(p.totalDeducciones) > 0 ? ` (deducciones ${fmtMoney(p.totalDeducciones, { decimals: 2 })})` : ''}</p>
                <p className="text-xs text-slate-400 mt-1">{recP.length} recibo{recP.length === 1 ? '' : 's'} · {empsActivos.length} empleados activos</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => generar(p)} disabled={ocupado} className="bg-blue-600 disabled:bg-slate-300 text-white px-3 min-h-[44px] rounded-lg text-xs font-semibold">Generar recibos</button>
                <button onClick={() => setPeriodoId(p.id)} className="bg-slate-600 text-white px-3 min-h-[44px] rounded-lg text-xs font-semibold">Capturar</button>
                <button onClick={() => pagar(p)} disabled={ocupado || recP.length === 0 || n(p.totalNeto) <= 0} className="bg-emerald-600 disabled:bg-slate-300 text-white px-3 min-h-[44px] rounded-lg text-xs font-semibold">Pagar</button>
              </div>
            </div>
          </div>
        );})}
      </div>
    </div>)}

    {periodosPagados.length > 0 && (<div>
      <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mt-4 mb-2">Pagados recientemente</h3>
      <div className="space-y-1.5">
        {periodosPagados.map(p => (
          <button key={p.id} onClick={() => setPeriodoId(p.id)} className="w-full text-left bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex justify-between items-center min-h-[44px]">
            <div>
              <p className="text-sm font-semibold text-slate-800">{etiqueta(p)}</p>
              <p className="text-xs text-slate-400">Pagado · {recibosDe(p.id).length} recibos</p>
            </div>
            <p className="text-sm font-bold text-emerald-700">{fmtMoney(p.totalNeto, { decimals: 2 })}</p>
          </button>
        ))}
      </div>
    </div>)}

    {deptos.map(d => {
      const dEmps = empsPorDepto[d] || [];
      if (dEmps.length === 0) return null;
      const totalDepto = dEmps.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);
      return (<div key={d}>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">{d} — {dEmps.length} empleados · {fmtMoney(totalDepto)}/sem</h3>
        <div className="space-y-1.5">
          {dEmps.map(e => (
            <div key={e.id} className="bg-white rounded-lg p-3 border border-slate-100 flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-slate-800">{s(e.nombre)}</p>
                <p className="text-xs text-slate-400">{s(e.puesto)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-800">{fmtMoney(n(e.salarioDiario) * 7)}</p>
                <p className="text-[10px] text-slate-400">{fmtMoney(e.salarioDiario, { decimals: 2 })}/día</p>
              </div>
            </div>
          ))}
        </div>
      </div>);
    })}

    {periodoSel && (
      <Modal onClose={() => setPeriodoId(null)} title={`Recibos — ${etiqueta(periodoSel)}`}>
        <p className="text-xs text-slate-500 mb-3">
          {s(periodoSel.estatus) === 'Pagado'
            ? 'Periodo pagado: los recibos son históricos y no se editan.'
            : 'Captura los valores reales de la semana. El servidor recalcula percepciones, deducciones y neto con el salario del recibo.'}
        </p>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {recibosSel.length === 0 ? (
            <EmptyState message="Aún no hay recibos" hint="Usa 'Generar recibos' para crear los de los empleados activos" />
          ) : (
            recibosSel.map(r => (
              <ReciboEditor key={`${r.id}-${s(r.updatedAt)}`} recibo={r} empleado={emps.find(e => n(e.id) === n(r.empleadoId))}
                editable={s(periodoSel.estatus) === 'Borrador'} onGuardar={guardarRecibo} />
            ))
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="bg-slate-50 rounded-lg p-2 text-center"><p className="text-slate-400">Percepciones</p><p className="font-bold">{fmtMoney(periodoSel.totalPercepciones, { decimals: 2 })}</p></div>
          <div className="bg-slate-50 rounded-lg p-2 text-center"><p className="text-slate-400">Deducciones</p><p className="font-bold">{fmtMoney(periodoSel.totalDeducciones, { decimals: 2 })}</p></div>
          <div className="bg-slate-50 rounded-lg p-2 text-center"><p className="text-slate-400">Neto (servidor)</p><p className="font-bold text-emerald-700">{fmtMoney(periodoSel.totalNeto, { decimals: 2 })}</p></div>
        </div>
        <div className="flex gap-2 mt-4">
          {s(periodoSel.estatus) === 'Borrador' && (
            <button onClick={() => generar(periodoSel)} disabled={ocupado} className="flex-1 min-h-[44px] bg-blue-600 disabled:bg-slate-300 text-white font-semibold rounded-xl">Generar faltantes</button>
          )}
          <button onClick={() => setPeriodoId(null)} className="flex-1 min-h-[44px] bg-slate-200 text-slate-700 font-semibold rounded-xl">Cerrar</button>
        </div>
      </Modal>
    )}
  </div>);
}
