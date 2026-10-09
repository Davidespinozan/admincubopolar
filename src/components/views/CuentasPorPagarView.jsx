import { useState, useMemo, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, n, fmtDate, fmtMoney, fmtPct, useToast, PAGE_SIZE, Paginator, PageHeader, KpiTile, SegmentedTabs } from './viewsCommon';
import { diaNegocio, mesNegocio } from '../../utils/fechas';
import { useRef } from 'react';
import { resolverOperacion } from '../../data/produccionAtomicaLogic';
import { claveAbonoCxP } from '../../data/fechaNegocioLogic';

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
  const [saving, setSaving] = useState(false);
  const [pagando, setPagando] = useState(false);

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
    // 096: p.fecha es DATE de negocio; se compara el mes como calendario.
    const mes = mesNegocio();
    return (data.pagosProveedores || []).filter(p => mesNegocio(s(p.fecha)) === mes).reduce((s, p) => s + n(p.monto), 0);
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
    if (saving) return;
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

    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  };

  const pagoOpRef = useRef(null);
  const openPago = (cxp) => {
    pagoOpRef.current = null;
    setPagoModal(cxp);
    setPagoForm({ monto: String(n(cxp.saldoPendiente)), metodo: 'Transferencia', referencia: '' });
    setErrors({});
  };

  const pagar = async () => {
    if (pagando) return;
    const e = {};
    if (!pagoForm.monto || parseFloat(pagoForm.monto) <= 0) e.monto = 'Monto inválido';
    if (parseFloat(pagoForm.monto) > n(pagoModal.saldoPendiente)) e.monto = 'Excede el saldo pendiente';
    if (Object.keys(e).length) { setErrors(e); return; }
    setPagando(true);
    try {
      // 098: mismo intento (reintento, respuesta perdida) → mismo UUID; la
      // fecha del pago la pone el servidor.
      const datos = { cxpId: pagoModal.id, monto: parseFloat(pagoForm.monto), metodoPago: pagoForm.metodo, referencia: pagoForm.referencia };
      const op = resolverOperacion(pagoOpRef.current, claveAbonoCxP(datos));
      pagoOpRef.current = op;
      const err = await actions.pagarCuentaPorPagar(datos.cxpId, datos.monto, datos.metodoPago, datos.referencia, { operacionId: op.id });
      if (err) return; // el store ya mostró el error; el UUID se conserva para el reintento
      pagoOpRef.current = null;
      setPagoModal(null);
    } catch (ex) {
      toast?.error('Error: ' + (ex?.message || ''));
    } finally {
      setPagando(false);
    }
  };

  const paginatedPendientes = useMemo(() => cxpPendientes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [cxpPendientes, page]);
  const paginatedPagadas = useMemo(() => cxpPagadas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [cxpPagadas, page]);

  return (<div className="space-y-3">
    {ConfirmEl}
    <PageHeader title="Por pagar" subtitle="Deudas con proveedores y sus pagos" action={openNew} actionLabel="Nueva deuda" />
    <div className="grid grid-cols-2 gap-3">
      <KpiTile label="Por pagar" value={fmtMoney(totalPorPagar)} hint={`${cxpPendientes.length} ${cxpPendientes.length === 1 ? 'cuenta pendiente' : 'cuentas pendientes'}`} tone="danger" />
      <KpiTile label="Pagado este mes" value={fmtMoney(pagadoEsteMes)} tone="success" />
    </div>
    <SegmentedTabs value={tab} onChange={(k) => { setTab(k); setPage(0); }} items={[{ k: 'pendientes', l: `Pendientes (${cxpPendientes.length})` }, { k: 'pagadas', l: `Pagadas (${cxpPagadas.length})` }, { k: 'pagos', l: 'Pagos' }]} />

    {tab === 'pendientes' && (
      <div className="space-y-2">
        {paginatedPendientes.length === 0 && (
          <EmptyState
            message="Sin cuentas por pagar"
            hint="No tienes deudas pendientes con proveedores"
          />
        )}
        {paginatedPendientes.map(cxp => {
          const pctPagado = n(cxp.montoOriginal) > 0 ? (n(cxp.montoPagado) / n(cxp.montoOriginal)) * 100 : 0;
          const vencida = !!cxp.fechaVencimiento && diaNegocio(s(cxp.fechaVencimiento)) < diaNegocio();
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
                <span className="text-slate-500">Total: {fmtMoney(cxp.montoOriginal)}</span>
                <span className="font-bold text-red-700">Saldo: {fmtMoney(cxp.saldoPendiente)}</span>
              </div>
              {n(cxp.montoPagado) > 0 && (
                <div className="mb-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, pctPagado)}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Pagado: {fmtMoney(cxp.montoPagado)} ({fmtPct(cxp.montoPagado, cxp.montoOriginal)})</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Vence: {cxp.fechaVencimiento ? fmtDate(cxp.fechaVencimiento) : 'Sin fecha'}</span>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(cxp)} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg min-h-[36px]">Editar</button>
                  <FormBtn success onClick={() => openPago(cxp)}>Pagar</FormBtn>
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
        {paginatedPagadas.length === 0 && (
          <EmptyState
            message="Sin cuentas pagadas todavía"
            hint="El historial de pagos a proveedores aparecerá aquí"
          />
        )}
        {paginatedPagadas.map(cxp => (
          <div key={cxp.id} className="bg-emerald-50 rounded-lg p-3.5 border border-emerald-100">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700 truncate">{s(cxp.proveedor)}</p>
                <p className="text-xs text-slate-500 truncate">{s(cxp.concepto)}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold bg-emerald-200 text-emerald-700">Pagada</span>
            </div>
            <p className="text-sm font-bold text-emerald-700 mt-1">{fmtMoney(cxp.montoOriginal)}</p>
          </div>
        ))}
        <Paginator page={page} total={cxpPagadas.length} onPage={setPage} />
      </div>
    )}

    {tab === 'pagos' && (
      <div className="space-y-1.5">
        {pagosRecientes.length === 0 && (
          <EmptyState
            message="Sin pagos registrados"
            hint="Los pagos a proveedores se mostrarán aquí cuando se hagan"
          />
        )}
        {pagosRecientes.map(p => (
          <div key={p.id} className="bg-red-50 rounded-lg p-3 border border-red-100 overflow-hidden">
            <div className="flex justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700 min-w-0 truncate">{s(p.referencia) || 'Pago a proveedor'}</span>
              <span className="text-sm font-bold text-red-700 flex-shrink-0">{"-" + fmtMoney(p.monto)}</span>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-slate-400 truncate">{fmtDate(p.fecha)} • {s(p.metodoPago)}</span>
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
          <FormInput label="Monto *" type="number" min="0" step="0.01" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
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
        <FormBtn primary onClick={save} loading={saving}>{modal === 'new' ? 'Crear cuenta' : 'Guardar cambios'}</FormBtn>
      </div>
    </Modal>

    {/* Modal Pagar CxP */}
    <Modal open={!!pagoModal} onClose={() => setPagoModal(null)} title="Registrar pago a proveedor">
      {pagoModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(pagoModal.proveedor)}</p>
            <p className="text-xs text-slate-500">{s(pagoModal.concepto)}</p>
            <p className="text-lg font-bold text-red-700 mt-1">Saldo: {fmtMoney(pagoModal.saldoPendiente)}</p>
          </div>
          <FormInput label="Monto a pagar *" type="number" min="0" step="0.01" value={pagoForm.monto} onChange={e => setPagoForm({ ...pagoForm, monto: e.target.value })} error={errors.monto} />
          <FormSelect label="Método de pago" options={METODOS_PAGO} value={pagoForm.metodo} onChange={e => setPagoForm({ ...pagoForm, metodo: e.target.value })} />
          <FormInput label="Referencia" value={pagoForm.referencia} onChange={e => setPagoForm({ ...pagoForm, referencia: e.target.value })} placeholder="No. transferencia, cheque, etc." />
          <p className="text-xs text-slate-400">Este pago se registrará automáticamente como egreso en contabilidad.</p>
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setPagoModal(null)}>Cancelar</FormBtn>
            <FormBtn primary onClick={pagar} loading={pagando}>Registrar pago</FormBtn>
          </div>
        </div>
      )}
    </Modal>
  </div>);
}
