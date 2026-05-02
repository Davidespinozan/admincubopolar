import { useEffect, useMemo, useState } from 'react';
import Modal, { FormInput, FormSelect, FormBtn } from './ui/Modal';
import { s, n, fmtMoney } from '../utils/safe';
import { useToast } from './ui/Toast';
import { supabase } from '../lib/supabase';
import { TIPOS_REEMBOLSO, calcTotalDevolucion } from '../data/devolucionesLogic';

// Modal de captura de devolución. Recibe la orden ya seleccionada
// (estatus 'Entregada' o 'Facturada' validado por el caller).
export default function DevolucionModal({ open, orden, actions, data, onClose, onSuccess }) {
  const toast = useToast();
  const [lineas, setLineas] = useState([]);            // [{ sku, nombre, cantidadOriginal, precio_unitario }]
  const [cantidades, setCantidades] = useState({});    // { sku: cantidadADevolver }
  const [motivo, setMotivo] = useState('');
  const [tipoReembolso, setTipoReembolso] = useState('Efectivo');
  const [cuartoDestino, setCuartoDestino] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [loadingLineas, setLoadingLineas] = useState(false);

  const cuartos = useMemo(() => (data?.cuartosFrios || []).filter(c => s(c.estatus || 'Activo') === 'Activo'), [data?.cuartosFrios]);
  const productos = data?.productos || [];

  useEffect(() => {
    if (!open || !orden?.id) return;
    setMotivo('');
    setTipoReembolso('Efectivo');
    setNotas('');
    setErrors({});
    setCantidades({});
    setCuartoDestino(s(cuartos[0]?.id) || '');
    setLoadingLineas(true);
    (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('orden_lineas')
          .select('sku, cantidad, precio_unit')
          .eq('orden_id', orden.id);
        if (error) {
          toast?.error('No se pudieron leer las líneas de la orden');
          return;
        }
        const enriched = (rows || []).map(r => {
          const prod = productos.find(p => s(p.sku) === s(r.sku));
          return {
            sku: s(r.sku),
            nombre: s(prod?.nombre) || s(r.sku),
            cantidadOriginal: Number(r.cantidad),
            precio_unitario: Number(r.precio_unit),
          };
        });
        setLineas(enriched);
      } finally {
        setLoadingLineas(false);
      }
    })();
  }, [open, orden?.id, cuartos, productos, toast]);

  const itemsAGuardar = useMemo(() => {
    const out = [];
    for (const l of lineas) {
      const qty = n(cantidades[l.sku] || 0);
      if (qty > 0) out.push({ sku: l.sku, cantidad: qty, precio_unitario: l.precio_unitario });
    }
    return out;
  }, [lineas, cantidades]);

  const totalDevolver = useMemo(() => {
    return calcTotalDevolucion(itemsAGuardar, lineas);
  }, [itemsAGuardar, lineas]);

  const facturada = s(orden?.estatus) === 'Facturada';

  const guardar = async () => {
    if (saving) return;
    const e = {};
    if (itemsAGuardar.length === 0) e.items = 'Captura al menos una cantidad a devolver';
    if (!motivo.trim()) e.motivo = 'Motivo requerido';
    if (!cuartoDestino) e.cuartoDestino = 'Selecciona cuarto frío';
    // Validar que ninguna cantidad exceda lo entregado
    for (const l of lineas) {
      const qty = n(cantidades[l.sku] || 0);
      if (qty > l.cantidadOriginal) {
        e.items = `${l.sku}: máximo ${l.cantidadOriginal} (entregado originalmente)`;
        break;
      }
    }
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setSaving(true);
    try {
      const result = await actions.registrarDevolucion?.({
        ordenId: orden.id,
        items: itemsAGuardar,
        motivo: motivo.trim(),
        tipoReembolso,
        cuartoDestino,
        notas: notas.trim() || null,
      });
      if (result?.error && !result?.partial) {
        toast?.error(result.error);
        return;
      }
      if (result?.partial) {
        toast?.error(result.error);
      } else {
        toast?.success('Devolución registrada');
      }
      onSuccess?.(result?.devolucionId);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  if (!orden) return null;

  return (
    <Modal open={open} onClose={() => !saving && onClose?.()} title={`Registrar devolución — ${s(orden.folio) || `Orden #${orden.id}`}`}>
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-sm font-semibold text-slate-800">{s(orden.clienteNombre || orden.cliente) || 'Cliente'}</p>
          <p className="text-xs text-slate-500">Total original: <strong>{fmtMoney(orden.total)}</strong> · {s(orden.metodoPago || orden.metodo_pago) || 'Efectivo'}</p>
        </div>

        {facturada && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-800">
            Esta orden está facturada. Si eliges <strong>Nota crédito</strong>, quedará pendiente generar el CFDI tipo E (integración futura). Por ahora se marca como pendiente.
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Productos a devolver *</label>
          {loadingLineas ? (
            <p className="text-xs text-slate-400 italic">Cargando…</p>
          ) : lineas.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Sin líneas en la orden.</p>
          ) : (
            <div className="space-y-2">
              {lineas.map(l => (
                <div key={l.sku} className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{l.nombre}</p>
                    <p className="text-[11px] text-slate-400">{l.sku} · entregado: {l.cantidadOriginal} · {fmtMoney(l.precio_unitario, { decimals: 2 })} c/u</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={l.cantidadOriginal}
                    value={cantidades[l.sku] || ''}
                    onChange={ev => setCantidades(c => ({ ...c, [l.sku]: ev.target.value }))}
                    placeholder="0"
                    className="w-20 px-2 py-2 border border-slate-200 rounded-lg text-sm text-center"
                  />
                </div>
              ))}
            </div>
          )}
          {errors.items && <p className="text-xs text-red-600 font-semibold mt-1">{errors.items}</p>}
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex justify-between items-baseline">
          <span className="text-xs font-semibold text-emerald-700 uppercase">Total a devolver</span>
          <span className="text-xl font-extrabold text-emerald-700">{fmtMoney(totalDevolver, { decimals: 2 })}</span>
        </div>

        <FormSelect
          label="Cuarto frío destino *"
          options={[{ value: '', label: 'Seleccionar…' }, ...cuartos.map(c => ({ value: s(c.id), label: s(c.nombre) || s(c.id) }))]}
          value={cuartoDestino}
          onChange={e => setCuartoDestino(e.target.value)}
          error={errors.cuartoDestino}
        />

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de reembolso *</label>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS_REEMBOLSO.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoReembolso(t)}
                className={`py-2.5 rounded-xl text-xs font-bold border-2 ${tipoReembolso === t ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
              >
                {t === 'Nota credito' ? 'Nota crédito' : t === 'Reposicion' ? 'Reposición' : t}
              </button>
            ))}
          </div>
          {tipoReembolso === 'Reposicion' && (
            <p className="text-[11px] text-slate-500 mt-1.5">No ajusta finanzas — solo regresa stock al cuarto.</p>
          )}
          {tipoReembolso === 'Efectivo' && (
            <p className="text-[11px] text-slate-500 mt-1.5">Genera egreso contable en categoría &quot;Devoluciones&quot;{s(orden.metodoPago || orden.metodo_pago).toLowerCase().includes('crédito') ? ' y reduce la CxC del cliente.' : '.'}</p>
          )}
          {tipoReembolso === 'Nota credito' && (
            <p className="text-[11px] text-slate-500 mt-1.5">{facturada ? 'Marca pendiente de emitir CFDI tipo E.' : 'La orden no está facturada — se trata como nota interna.'}</p>
          )}
        </div>

        <FormInput
          label="Motivo *"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Ej: Hielo derretido, bolsas dañadas en transporte"
          error={errors.motivo}
        />
        <FormInput
          label="Notas (opcional)"
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Información adicional"
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <FormBtn onClick={onClose} disabled={saving}>Cancelar</FormBtn>
          <FormBtn primary onClick={guardar} disabled={saving || itemsAGuardar.length === 0 || !motivo.trim() || !cuartoDestino} loading={saving}>
            {saving ? 'Registrando…' : 'Registrar devolución'}
          </FormBtn>
        </div>
      </div>
    </Modal>
  );
}
