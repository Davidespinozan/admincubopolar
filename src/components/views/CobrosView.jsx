import { useState, useMemo, Modal, FormInput, FormSelect, FormBtn, EmptyState, s, n, fmtDate, fmtMoney, fmtPct, useToast, PageHeader, KpiTile, SegmentedTabs } from './viewsCommon';
import { useEffect } from 'react';
import { diaNegocio } from '../../utils/fechas';
import { pagosEnRevision } from '../../data/pagosRevisionLogic';

export function CobrosView({ data, actions }) {
  const toast = useToast();
  const [tab, setTab] = useState('pendientes'); // pendientes | pagos
  const [cobroModal, setCobroModal] = useState(null);
  const [form, setForm] = useState({ monto: '', metodo: 'Efectivo', referencia: '' });
  const [errors, setErrors] = useState({});
  const [savingCobro, setSavingCobro] = useState(false);

  // Pagos por link cobrados por el proveedor que el sistema NO registró (no cuadraban con la
  // venta). Antes no se veían en ninguna parte. Se leen al abrir; si el rol no puede, no hay tarjeta.
  const [intentsRevision, setIntentsRevision] = useState([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await actions.pagosLinkEnRevision?.();
      if (vivo && r?.data) setIntentsRevision(r.data);
    })();
    return () => { vivo = false; };
  }, [actions]);
  const enRevision = useMemo(() => pagosEnRevision(intentsRevision, data.ordenes), [intentsRevision, data.ordenes]);

  const cxcPendientes = useMemo(() =>
    (data.cuentasPorCobrar || []).filter(c => c.estatus !== 'Pagada'),
    [data.cuentasPorCobrar]
  );
  const pagosRecientes = useMemo(() =>
    (data.pagos || []).slice(0, 50),
    [data.pagos]
  );

  const totalPendiente = useMemo(() =>
    cxcPendientes.reduce((s, c) => s + n(c.saldoPendiente), 0),
    [cxcPendientes]
  );
  const totalCobradoHoy = useMemo(() => {
    const hoy = diaNegocio();
    return (data.pagos || []).filter(p => s(p.fecha) === hoy).reduce((s, p) => s + n(p.monto), 0);
  }, [data.pagos]);

  const clientes = useMemo(() => {
    const map = {};
    for (const c of (data.clientes || [])) map[c.id] = c;
    return map;
  }, [data.clientes]);

  const openCobro = (cxc) => {
    setCobroModal(cxc);
    setForm({ monto: String(cxc.saldoPendiente), metodo: 'Efectivo', referencia: '' });
    setErrors({});
  };

  const cobrar = async () => {
    if (savingCobro) return;
    const e = {};
    if (!form.monto || parseFloat(form.monto) <= 0) e.monto = 'Monto inválido';
    if (parseFloat(form.monto) > cobroModal.saldoPendiente) e.monto = 'Excede el saldo pendiente';
    if (Object.keys(e).length) { setErrors(e); return; }
    setSavingCobro(true);
    try {
      // La acción devuelve el error (no lanza): sin revisarlo, la pantalla decía "Cobro
      // registrado" aunque el servidor lo hubiera rechazado (p. ej. referencia repetida).
      const r = await actions.cobrarCxC(cobroModal.id, parseFloat(form.monto), form.metodo, form.referencia);
      if (r?.error || r instanceof Error) return;
      toast?.success('Cobro registrado');
      setCobroModal(null);
    } catch (ex) { toast?.error('Error: ' + (ex?.message || '')); }
    finally { setSavingCobro(false); }
  };

  const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta'];

  return (<div className="space-y-3">
    <PageHeader title="Por cobrar" subtitle="Cuentas por cobrar y pagos recientes" />
    <div className="grid grid-cols-2 gap-3">
      <KpiTile label="Por cobrar" value={fmtMoney(totalPendiente)} hint={`${cxcPendientes.length} ${cxcPendientes.length === 1 ? 'cuenta pendiente' : 'cuentas pendientes'}`} tone="warning" />
      <KpiTile label="Cobrado hoy" value={fmtMoney(totalCobradoHoy)} tone="success" />
    </div>
    {enRevision.length > 0 && (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert" data-testid="pagos-en-revision">
        <p className="text-sm font-bold text-red-800">{enRevision.length === 1 ? '1 pago por link necesita revisión' : `${enRevision.length} pagos por link necesitan revisión`}</p>
        <p className="mt-0.5 text-xs text-red-700">El cliente SÍ pagó, pero el sistema no registró el cobro porque no cuadraba con la venta. Hay que resolverlos a mano.</p>
        <ul className="mt-2 space-y-2">
          {enRevision.map(p => (
            <li key={p.id} className="rounded-lg border border-red-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-slate-800">{p.folio}{p.cliente ? ` · ${p.cliente}` : ''}</p>
                <p className="font-bold text-slate-900">{fmtMoney(p.monto, { decimals: 2 })}</p>
              </div>
              <p className="mt-1 text-xs text-slate-600">{p.motivo}{p.totalVenta != null ? ` Total de la venta: ${fmtMoney(p.totalVenta, { decimals: 2 })}.` : ''}</p>
              <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">Qué hacer:</span> {p.queHacer}</p>
              <p className="mt-1 break-all text-[11px] text-slate-400">{p.proveedor} · {p.referencia}{p.fecha ? ` · ${fmtDate(p.fecha)}` : ''}</p>
            </li>
          ))}
        </ul>
      </div>
    )}
    <SegmentedTabs value={tab} onChange={setTab} items={[{ k: 'pendientes', l: `Pendientes (${cxcPendientes.length})` }, { k: 'pagos', l: 'Pagos recientes' }]} />

    {tab === 'pendientes' && (
      <div className="space-y-2">
        {cxcPendientes.length === 0 && (
          <EmptyState
            message="Sin cuentas pendientes de cobro"
            hint="Todas las ventas a crédito están al corriente"
          />
        )}
        {cxcPendientes.map(cxc => {
          const cli = clientes[cxc.clienteId];
          const pctPagadoNum = n(cxc.montoOriginal) > 0 ? (n(cxc.montoPagado) / n(cxc.montoOriginal)) * 100 : 0;
          return (
            <div key={cxc.id} className="bg-white rounded-xl p-4 border border-slate-100">
              <div className="flex justify-between items-start gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{s(cli?.nombre) || 'Cliente'}</p>
                  <p className="text-xs text-slate-400 truncate">{s(cxc.concepto)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cxc.estatus === 'Parcial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {cxc.estatus}
                </span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-500">Total: {fmtMoney(cxc.montoOriginal)}</span>
                <span className="font-bold text-amber-700">Saldo: {fmtMoney(cxc.saldoPendiente)}</span>
              </div>
              {n(cxc.montoPagado) > 0 && (
                <div className="mb-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, pctPagadoNum)}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Pagado: {fmtMoney(cxc.montoPagado)} ({fmtPct(cxc.montoPagado, cxc.montoOriginal)})</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Vence: {fmtDate(cxc.fechaVencimiento)}</span>
                <FormBtn success onClick={() => openCobro(cxc)}>Cobrar</FormBtn>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {tab === 'pagos' && (
      <div className="space-y-1.5">
        {pagosRecientes.length === 0 && (
          <EmptyState
            message="Sin pagos registrados"
            hint="Los pagos aparecerán aquí cuando se cobren cuentas"
          />
        )}
        {pagosRecientes.map(p => {
          const cli = clientes[p.clienteId];
          return (
            <div key={p.id} className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 overflow-hidden">
              <div className="flex justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700 min-w-0 truncate">{s(cli?.nombre) || 'Cliente'}</span>
                <span className="text-sm font-bold text-emerald-700 flex-shrink-0">{"+" + fmtMoney(p.monto)}</span>
              </div>
              <div className="flex justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-400 truncate">{fmtDate(p.fecha)} • {s(p.metodoPago) || 'Efectivo'}</span>
                <span className="text-xs text-emerald-600 truncate max-w-[120px] text-right flex-shrink-0">{s(p.referencia)}</span>
              </div>
            </div>
          );
        })}
      </div>
    )}

    <Modal open={!!cobroModal} onClose={() => setCobroModal(null)} title="Registrar cobro">
      {cobroModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(clientes[cobroModal.clienteId]?.nombre) || 'Cliente'}</p>
            <p className="text-xs text-slate-500">{s(cobroModal.concepto)}</p>
            <p className="text-lg font-bold text-amber-700 mt-1">Saldo: {fmtMoney(cobroModal.saldoPendiente)}</p>
          </div>
          <FormInput label="Monto a cobrar *" type="number" min="0" step="0.01" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} />
          <FormSelect label="Método de pago" options={METODOS} value={form.metodo} onChange={e => setForm({ ...form, metodo: e.target.value })} />
          <FormInput label="Referencia" value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="No. transferencia, voucher, etc." />
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setCobroModal(null)} disabled={savingCobro}>Cancelar</FormBtn>
            <FormBtn primary onClick={cobrar} disabled={savingCobro} loading={savingCobro}>
              {savingCobro ? 'Registrando…' : 'Registrar cobro'}
            </FormBtn>
          </div>
        </div>
      )}
    </Modal>
  </div>);
}
