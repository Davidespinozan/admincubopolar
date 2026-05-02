import { useEffect, useMemo, useState } from 'react';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { s, n, fmtMoney } from '../utils/safe';
import { useToast } from './ui/Toast';
import { calcularEsperadoPorRuta, calcDiferencia, formatDiferencia } from '../data/cierreCajaLogic';

// Modal de captura de cierre de caja por ruta. El caller pasa la ruta
// (Completada o Cerrada) ya seleccionada.
export default function CierreCajaModal({ open, ruta, data, actions, onClose, onSuccess }) {
  const toast = useToast();
  const [contadoEfectivo, setContadoEfectivo] = useState('');
  const [contadoTransferencia, setContadoTransferencia] = useState('');
  const [motivoDiferencia, setMotivoDiferencia] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Pagos asociados a la ruta (filtrados localmente del store).
  const pagosDeRuta = useMemo(() => {
    if (!ruta?.id) return [];
    const ordenIds = new Set(
      (data?.ordenes || [])
        .filter(o => String(o.rutaId || o.ruta_id) === String(ruta.id))
        .map(o => String(o.id))
    );
    return (data?.pagos || []).filter(p => {
      const oid = String(p.ordenId || p.orden_id || '');
      return oid && ordenIds.has(oid);
    });
  }, [ruta?.id, data?.ordenes, data?.pagos]);

  const esperado = useMemo(() => calcularEsperadoPorRuta(pagosDeRuta), [pagosDeRuta]);

  // Default contado = esperado al abrir
  useEffect(() => {
    if (!open) return;
    setContadoEfectivo(String(esperado.efectivo || 0));
    setContadoTransferencia(String(esperado.transferencia || 0));
    setMotivoDiferencia('');
    setNotas('');
    setErrors({});
  }, [open, esperado.efectivo, esperado.transferencia]);

  const contado = {
    efectivo: n(contadoEfectivo, -1e12),
    transferencia: n(contadoTransferencia, -1e12),
  };
  const contadoTotal = (Number.isFinite(contado.efectivo) ? contado.efectivo : 0)
                    + (Number.isFinite(contado.transferencia) ? contado.transferencia : 0);
  const diferencia = calcDiferencia(esperado, contado);
  const dif = formatDiferencia(diferencia);
  const requiereMotivo = Math.abs(diferencia) > 0;
  const requiereMotivoLargo = Math.abs(diferencia) > 100;

  const guardar = async () => {
    if (saving) return;
    const e = {};
    if (!Number.isFinite(contado.efectivo) || contado.efectivo < 0) e.efectivo = 'Efectivo inválido';
    if (!Number.isFinite(contado.transferencia) || contado.transferencia < 0) e.transferencia = 'Transferencia inválida';
    if (requiereMotivo && !motivoDiferencia.trim()) e.motivo = 'Motivo requerido cuando hay diferencia';
    if (requiereMotivoLargo && motivoDiferencia.trim().length < 10) e.motivo = 'Diferencia mayor a $100 requiere motivo de al menos 10 caracteres';
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setSaving(true);
    try {
      const result = await actions.cerrarCajaRuta?.({
        rutaId: ruta.id,
        contadoEfectivo: contado.efectivo,
        contadoTransferencia: contado.transferencia,
        motivoDiferencia: motivoDiferencia.trim() || null,
        notas: notas.trim() || null,
      });
      if (result?.error) {
        toast?.error(result.error);
        return;
      }
      toast?.success(diferencia === 0 ? 'Caja cuadrada ✓' : `Cierre registrado (${dif.label.toLowerCase()})`);
      onSuccess?.(result?.cierreId);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  if (!ruta) return null;

  const colorBadge = dif.color === 'verde' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : dif.color === 'azul' ? 'bg-blue-100 text-blue-800 border-blue-200'
                  : 'bg-red-100 text-red-800 border-red-200';

  return (
    <Modal open={open} onClose={() => !saving && onClose?.()} title={`Corte de caja — ${s(ruta.folio) || `Ruta #${ruta.id}`}`}>
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-sm font-semibold text-slate-800">Chofer: {s(ruta.choferNombre || ruta.chofer) || '—'}</p>
          <p className="text-xs text-slate-500">{pagosDeRuta.length} {pagosDeRuta.length === 1 ? 'pago' : 'pagos'} registrados en la ruta</p>
        </div>

        {/* Esperado */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">Esperado del sistema</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase">Efectivo</p>
              <p className="text-base font-bold text-slate-800">{fmtMoney(esperado.efectivo)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase">Transferencia</p>
              <p className="text-base font-bold text-slate-800">{fmtMoney(esperado.transferencia)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Incluye Tarjeta + QR</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <p className="text-[10px] text-amber-500 uppercase">Crédito</p>
              <p className="text-base font-bold text-amber-700">{fmtMoney(esperado.credito)}</p>
              <p className="text-[10px] text-amber-500 mt-0.5">No entra en contado</p>
            </div>
          </div>
        </div>

        {/* Contado */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">Contado físico (capturado por admin)</p>
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Efectivo *"
              type="number"
              min="0"
              step="0.01"
              value={contadoEfectivo}
              onChange={e => setContadoEfectivo(e.target.value)}
              error={errors.efectivo}
            />
            <FormInput
              label="Transferencia + Tarjeta + QR *"
              type="number"
              min="0"
              step="0.01"
              value={contadoTransferencia}
              onChange={e => setContadoTransferencia(e.target.value)}
              error={errors.transferencia}
            />
          </div>
          <div className="mt-2 flex justify-between items-baseline bg-slate-50 rounded-xl px-3 py-2">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total contado</span>
            <span className="text-lg font-extrabold text-slate-800">{fmtMoney(contadoTotal)}</span>
          </div>
        </div>

        {/* Diferencia */}
        <div className={`rounded-xl border px-3 py-3 flex justify-between items-center ${colorBadge}`}>
          <div>
            <p className="text-[10px] font-bold uppercase opacity-70">Diferencia</p>
            <p className="text-lg font-extrabold">{dif.label}</p>
          </div>
          {diferencia !== 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/60">
              {Math.abs(diferencia) > 100 ? 'Diferencia significativa' : 'Diferencia menor'}
            </span>
          )}
        </div>

        {/* Motivo (obligatorio si hay diferencia) */}
        {requiereMotivo && (
          <FormInput
            label={requiereMotivoLargo ? 'Motivo * (mínimo 10 caracteres)' : 'Motivo *'}
            value={motivoDiferencia}
            onChange={e => setMotivoDiferencia(e.target.value)}
            placeholder="Ej: Cambio mal entregado, billete falso devuelto, etc."
            error={errors.motivo}
          />
        )}

        <FormInput
          label="Notas (opcional)"
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Observaciones del corte"
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <FormBtn onClick={onClose} disabled={saving}>Cancelar</FormBtn>
          <FormBtn primary onClick={guardar} disabled={saving} loading={saving}>
            {saving ? 'Cerrando…' : 'Cerrar caja'}
          </FormBtn>
        </div>
      </div>
    </Modal>
  );
}
