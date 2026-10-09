import { useState, Icons, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, n, useToast, fmtMoney, fmtDate, reporteFinanciero, PAGE_SIZE, PageHeader } from './viewsCommon';
import { diaNegocio } from '../../utils/fechas';
import { traducirError } from '../../utils/errorMessages';
import { esAsientoDeContrato } from '../../data/asientosContablesLogic';
import { useEffect } from 'react';
import { rangoDeMes, lineasEstadoResultados, lineasFlujoEfectivo } from '../../data/finanzasLogic';

export function ContabilidadView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [showAll, setShowAll] = useState(false);
  const [modal, setModal] = useState(null);
  const empty = { tipo: "Egreso", categoria: "Proveedores", concepto: "", monto: "", fecha: diaNegocio() };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const cont = data.contabilidad || { ingresos: [], egresos: [] };

  // 093: los totales NO salen de esta lista (mezcla efectivo y no efectivo y
  // trae solo los movimientos más recientes). Vienen del reporte del
  // servidor para el mes elegido: Flujo de efectivo y Estado de resultados.
  const [mes, setMes] = useState(() => diaNegocio().slice(0, 7));
  const [reporte, setReporte] = useState(null);
  const [reporteError, setReporteError] = useState(null);
  const refrescoFin = `${(cont.egresos || [])[0]?.id || 0}|${(cont.ingresos || [])[0]?.id || 0}|${(data.pagos || [])[0]?.id || 0}`;
  useEffect(() => {
    let vivo = true;
    const { desde, hasta } = rangoDeMes(mes);
    (async () => {
      const r = await actions?.obtenerReporteFinanciero?.(desde, hasta);
      if (!vivo) return;
      if (!r || r.error) { setReporteError(r?.error || 'No disponible'); setReporte(null); return; }
      setReporteError(null);
      setReporte(r.data);
    })();
    return () => { vivo = false; };
  }, [actions, mes, refrescoFin]);
  const lineasFE = lineasFlujoEfectivo(reporte);
  const lineasER = lineasEstadoResultados(reporte);

  const CATS_INGRESO = ["Ventas", "Cobranza", "Otro ingreso"];
  const CATS_EGRESO = ["Proveedores", "Combustible", "Servicios", "Mantenimiento", "Nómina", "Impuestos", "Renta", "Otro gasto"];

  const openNew = (tipo) => { setForm({ ...empty, tipo }); setErrors({}); setModal("new"); };

  const openEdit = (m) => {
    const tipo = s(m._tipo) || s(m.tipo) || 'Egreso';
    setForm({
      tipo,
      categoria: s(m.categoria) || (tipo === 'Ingreso' ? 'Ventas' : 'Proveedores'),
      concepto: s(m.concepto),
      monto: String(n(m.monto)),
      fecha: s(m.fecha) || diaNegocio(),
    });
    setErrors({});
    setModal(m);
  };

  const save = async () => {
    if (saving) return;
    const e = {};
    if (!form.concepto.trim()) e.concepto = "Requerido";
    if (!form.monto || parseFloat(form.monto) <= 0) e.monto = "Mayor a 0";
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const payload = { ...form, monto: parseFloat(form.monto) };
      let err;
      if (modal === "new") {
        err = await actions.addMovContable(payload);
      } else {
        err = await actions.updateMovContable(modal.id, payload);
      }
      if (err && (err.error || err.message || err.code)) {
        toast?.error(traducirError(err, 'No se pudo guardar el movimiento contable'));
        return;
      }
      toast?.success(modal === "new"
        ? (form.tipo === "Ingreso" ? "Ingreso registrado" : "Gasto registrado")
        : "Movimiento actualizado");
      setModal(null);
    } catch(ex) {
      toast?.error('Error: ' + (ex?.message || 'No se pudo guardar'));
    } finally {
      setSaving(false);
    }
  };

  const todos = [...cont.ingresos.map(i => ({ ...i, _tipo: "Ingreso" })), ...cont.egresos.map(e => ({ ...e, _tipo: "Egreso" }))].sort((a, b) => (b.id || 0) - (a.id || 0));

  return (<div className="space-y-3">
    {ConfirmEl}
    <PageHeader title="Movimientos" subtitle="Ingresos y gastos del mes" extraButtons={<>
      <button onClick={() => reporteFinanciero(cont, 'excel')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-emerald-200 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"><Icons.Sheet /> Excel</button>
      <button onClick={() => reporteFinanciero(cont, 'pdf')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"><Icons.FilePdf /> PDF</button>
    </>} />
    <div className="grid grid-cols-2 gap-2">
      <FormBtn success onClick={() => openNew("Ingreso")}><Icons.Plus /> Ingreso</FormBtn>
      <FormBtn danger onClick={() => openNew("Egreso")}><Icons.Plus /> Gasto</FormBtn>
    </div>

    <div className="flex items-center gap-3">
      <label className="text-[13px] font-medium text-slate-700">Mes</label>
      <input type="month" value={mes} onChange={e => setMes(e.target.value || diaNegocio().slice(0, 7))} className="min-h-[44px] rounded-field border border-line bg-slate-50 px-3 py-2 text-[15px] text-ink focus:bg-white focus:outline-none" />
    </div>
    {reporteError && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">No se pudo cargar el reporte: {reporteError}</p>}

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="bg-white rounded-xl p-4 border border-slate-100">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Flujo de efectivo</h3>
        <p className="text-[11px] text-slate-400 mb-2">Dinero que realmente entró y salió en el mes. No incluye mermas ni costo de producción; no es el saldo del banco.</p>
        {lineasFE.map(l => (
          <div key={l.clave} className={`flex justify-between items-center py-1.5 ${l.total ? 'font-bold border-t border-slate-100' : 'border-b border-slate-50'}`}>
            <span className="text-sm text-slate-600">{l.etiqueta}</span>
            <span className={`text-sm font-bold ${l.total ? (l.clave === 'neto' ? (n(l.monto) >= 0 ? 'text-blue-700' : 'text-red-600') : 'text-slate-800') : (l.signo > 0 ? 'text-emerald-600' : 'text-red-500')}`}>{l.total ? fmtMoney(l.monto) : (l.signo > 0 ? '+' : '-') + fmtMoney(l.monto)}</span>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl p-4 border border-slate-100">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Estado de resultados / Utilidad</h3>
        <p className="text-[11px] text-slate-400 mb-2">Ventas entregadas en el mes menos costo del hielo y gastos (cada uno una vez).</p>
        {lineasER.map(l => (
          <div key={l.clave} className={`flex justify-between items-center py-1.5 ${l.total ? 'font-bold border-t border-slate-100' : 'border-b border-slate-50'}`}>
            <span className="text-sm text-slate-600">{l.etiqueta}</span>
            <span className={`text-sm font-bold ${l.total ? (n(l.monto) >= 0 ? 'text-emerald-700' : 'text-red-600') : (l.signo > 0 ? 'text-emerald-600' : 'text-red-500')}`}>{l.total ? fmtMoney(l.monto) : (l.signo > 0 ? '+' : '-') + fmtMoney(l.monto)}</span>
          </div>
        ))}
      </div>
    </div>

    <div>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Bitácora de movimientos (más recientes)</h3>
      <p className="text-[11px] text-slate-400 mb-2">Registro de asientos. Incluye movimientos que no son dinero (mermas, costos anteriores); los totales de arriba ya los separan.</p>
      {todos.length === 0 && (
        <EmptyState
          message="Aún no hay movimientos contables"
          hint="Registra ingresos o gastos con los botones de arriba"
        />
      )}
      <div className="space-y-1.5">
        {(showAll ? todos : todos.slice(0, PAGE_SIZE)).map(m => (
          <div key={m.id} className={`rounded-lg p-3 border overflow-hidden ${m._tipo === "Ingreso" ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
            <div className="flex justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700 min-w-0 truncate">{s(m.concepto)}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-sm font-bold ${m._tipo === "Ingreso" ? "text-emerald-700" : "text-red-600"}`}>{(m._tipo === "Ingreso" ? "+" : "-") + fmtMoney(m.monto)}</span>
                {esAsientoDeContrato(m) ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1" title="Asiento generado por el sistema; no se edita ni se borra">Sistema</span>
                ) : (
                  <>
                    <button onClick={() => openEdit(m)} title="Editar" aria-label="Editar movimiento" className="text-slate-500 hover:text-blue-600 rounded-lg min-w-[40px] min-h-[40px] inline-flex items-center justify-center"><Icons.Edit /></button>
                    <button onClick={() => askConfirm('Eliminar movimiento','¿Eliminar este movimiento contable?',()=>actions.deleteMovContable(m.id),true)} className="text-red-400 hover:text-red-600 rounded-lg min-w-[40px] min-h-[40px] inline-flex items-center justify-center" title="Eliminar" aria-label="Eliminar movimiento"><Icons.Trash /></button>
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400">{fmtDate(m.fecha)}</span>
              <span className={`text-xs ${m._tipo === "Ingreso" ? "text-emerald-600" : "text-red-500"}`}>{s(m.categoria)}</span>
            </div>
          </div>
        ))}
      </div>
      {!showAll && todos.length > PAGE_SIZE && <button onClick={() => setShowAll(true)} className="mt-2 w-full text-center text-xs text-blue-600 font-semibold py-2">Ver todos ({todos.length} movimientos)</button>}
    </div>

    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "new" ? (form.tipo === "Ingreso" ? "Registrar ingreso" : "Registrar gasto") : `Editar ${form.tipo === "Ingreso" ? "ingreso" : "gasto"}`}>
      <div className="space-y-3">
        <FormInput label="Fecha" type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
        <FormSelect label="Categoría" options={form.tipo === "Ingreso" ? CATS_INGRESO : CATS_EGRESO} value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
        <FormInput label="Concepto *" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} placeholder="Ej: Pago de diesel ruta norte" error={errors.concepto} />
        <FormInput label="Monto *" type="number" min="0" step="0.01" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} placeholder="0.00" error={errors.monto} />
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save} loading={saving}>{modal === "new" ? (form.tipo === "Ingreso" ? "Registrar ingreso" : "Registrar gasto") : "Guardar cambios"}</FormBtn></div>
    </Modal>
  </div>);
}
