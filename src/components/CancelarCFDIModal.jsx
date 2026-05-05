import { useEffect, useMemo, useState } from 'react';
import Modal, { FormSelect, FormInput, FormTextarea, FormBtn } from './ui/Modal';
import { s, fmtMoney } from '../utils/safe';
import { useToast } from './ui/Toast';
import {
  MOTIVOS_OPTIONS,
  motivoPorCodigo,
  requiereUuidSustituto,
} from '../data/sat/motivosCancelacionCFDI';

// Modal para cancelar un CFDI ya timbrado.
// Tanda 5: la cancelación es irreversible ante el SAT — confirmamos con
// summary del CFDI vigente antes de disparar la action.
export default function CancelarCFDIModal({ open, orden, actions, onClose, onSuccess }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [motivoDetalle, setMotivoDetalle] = useState('');
  const [uuidSustituto, setUuidSustituto] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setMotivo('');
    setMotivoDetalle('');
    setUuidSustituto('');
    setErrors({});
    setSaving(false);
  }, [open, orden?.id]);

  const motivoInfo = useMemo(() => motivoPorCodigo(motivo), [motivo]);
  const necesitaSustituto = useMemo(() => requiereUuidSustituto(motivo), [motivo]);

  const guardar = async () => {
    if (saving) return;
    const e = {};
    if (!motivo) e.motivo = 'Selecciona el motivo SAT de cancelación';
    if (necesitaSustituto && !uuidSustituto.trim()) {
      e.uuidSustituto = 'Para motivo 01 captura el UUID del CFDI sustituto';
    }
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    try {
      const result = await actions.cancelarCFDI({
        ordenId: orden.id,
        motivo,
        motivoDetalle: motivoDetalle.trim() || null,
        uuidSustituto: necesitaSustituto ? uuidSustituto.trim() : null,
      });
      if (result?.error || result instanceof Error) {
        return;
      }
      toast?.success(`CFDI ${s(orden.facturama_folio || orden.facturamaFolio || '')} cancelado`);
      onSuccess?.();
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  if (!open || !orden) return null;

  return (
    <Modal open={open} onClose={onClose} title="Cancelar CFDI ante SAT">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <p className="font-bold mb-1">⚠ Acción irreversible</p>
          <p>La cancelación se reporta al SAT vía Facturama. La orden volverá a estatus <b>Entregada</b> y podrás re-timbrar si así se requiere.</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-400 uppercase font-bold text-[10px]">Folio orden</p>
            <p className="font-mono font-bold">{s(orden.folio)}</p>
          </div>
          <div>
            <p className="text-slate-400 uppercase font-bold text-[10px]">CFDI Folio</p>
            <p className="font-mono font-bold">{s(orden.facturama_folio || orden.facturamaFolio || '—')}</p>
          </div>
          <div className="col-span-2">
            <p className="text-slate-400 uppercase font-bold text-[10px]">UUID</p>
            <p className="font-mono text-[11px] break-all">{s(orden.facturama_uuid || orden.facturamaUuid || '—')}</p>
          </div>
          <div>
            <p className="text-slate-400 uppercase font-bold text-[10px]">Cliente</p>
            <p className="font-semibold truncate">{s(orden.cliente_nombre || orden.cliente)}</p>
          </div>
          <div>
            <p className="text-slate-400 uppercase font-bold text-[10px]">Total</p>
            <p className="font-bold">{fmtMoney(orden.total)}</p>
          </div>
        </div>

        <FormSelect
          label="Motivo SAT *"
          value={motivo}
          onChange={(e) => { setMotivo(e.target.value); setErrors({ ...errors, motivo: null }); }}
          options={[{ value: '', label: 'Selecciona un motivo…' }, ...MOTIVOS_OPTIONS]}
          error={errors.motivo}
        />

        {motivoInfo && (
          <div className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
            {motivoInfo.descripcion}
          </div>
        )}

        {necesitaSustituto && (
          <FormInput
            label="UUID del CFDI sustituto *"
            placeholder="Ej. 12345678-1234-1234-1234-123456789012"
            value={uuidSustituto}
            onChange={(e) => { setUuidSustituto(e.target.value); setErrors({ ...errors, uuidSustituto: null }); }}
            error={errors.uuidSustituto}
          />
        )}

        <FormTextarea
          label="Notas internas (opcional)"
          placeholder="Razón interna o referencia, no se manda al SAT"
          value={motivoDetalle}
          onChange={(e) => setMotivoDetalle(e.target.value)}
          rows={2}
        />

        <div className="flex justify-end gap-2 pt-2">
          <FormBtn ghost onClick={onClose} disabled={saving}>Cancelar</FormBtn>
          <FormBtn danger onClick={guardar} disabled={saving} loading={saving}>
            Cancelar CFDI ante SAT
          </FormBtn>
        </div>
      </div>
    </Modal>
  );
}
