import { useState, useMemo, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, n, useToast, PAGE_SIZE, Paginator } from './viewsCommon';

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
              <div className="flex justify-between items-start gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{s(cxp.proveedor)}</p>
                  <p className="text-xs text-slate-400 truncate">{s(cxp.concepto)}</p>
                  <p className="text-xs text-slate-400 truncate">{s(cxp.categoria)} • {s(cxp.referencia)}</p>
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
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700 truncate">{s(cxp.proveedor)}</p>
                <p className="text-xs text-slate-500 truncate">{s(cxp.concepto)}</p>
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
          <div key={p.id} className="bg-red-50 rounded-lg p-3 border border-red-100 overflow-hidden">
            <div className="flex justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700 min-w-0 truncate">{s(p.referencia) || 'Pago a proveedor'}</span>
              <span className="text-sm font-bold text-red-700 flex-shrink-0">-${n(p.monto).toLocaleString()}</span>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400 truncate">{s(p.fecha)} • {s(p.metodoPago)}</span>
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
