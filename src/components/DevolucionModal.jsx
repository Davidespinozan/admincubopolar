import { useEffect, useMemo, useRef, useState } from 'react';
import Modal, { FormInput, FormSelect, FormBtn } from './ui/Modal';
import { s, n, fmtMoney } from '../utils/safe';
import { useToast } from './ui/Toast';
import { supabase } from '../lib/supabase';
import { TIPOS_REEMBOLSO, DISPOSICIONES, calcTotalDevolucion, claveDevolucion, esVentaCredito, validateDevolucion } from '../data/devolucionesLogic';
import { resolverOperacion } from '../data/produccionAtomicaLogic';

// Modal de captura de devolución. Recibe la orden ya seleccionada
// (estatus 'Entregada' o 'Facturada' validado por el caller).
export default function DevolucionModal({ open, orden, actions, data, onClose, onSuccess }) {
  const toast = useToast();
  const [lineas, setLineas] = useState([]);            // [{ sku, nombre, cantidadOriginal, precio_unitario }]
  const [cantidades, setCantidades] = useState({});    // { sku: cantidadADevolver }
  const [motivo, setMotivo] = useState('');
  const [tipoReembolso, setTipoReembolso] = useState('Efectivo');
  const [cuartoDestino, setCuartoDestino] = useState('');
  const [disposicion, setDisposicion] = useState('Reintegrar');
  // 104: UUID del intento lógico (mismo intento → mismo UUID en reintentos).
  const opRef = useRef(null);
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
    setDisposicion('Reintegrar');
    opRef.current = null;
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
      if (qty > 0) out.push({ sku: l.sku, cantidad: qty });
    }
    return out;
  }, [lineas, cantidades]);

  const totalDevolver = useMemo(() => {
    return calcTotalDevolucion(itemsAGuardar, lineas);
  }, [itemsAGuardar, lineas]);

  const facturada = s(orden?.estatus) === 'Facturada';
  const credito = esVentaCredito(orden);

  const guardar = async () => {
    if (saving) return;
    const datos = { ordenId: orden.id, items: itemsAGuardar, tipoReembolso, disposicion, cuartoDestino, motivo: motivo.trim(), notas: notas.trim() || null };
    const v = validateDevolucion({ orden, items: itemsAGuardar, lineasOriginales: lineas.map(l => ({ sku: l.sku, cantidad: l.cantidadOriginal })),
      motivo, tipoReembolso, disposicion, cuartoDestino });
    if (v) { setErrors({ items: v.error }); return; }
    setErrors({});
    setSaving(true);
    try {
      const op = resolverOperacion(opRef.current, claveDevolucion(datos));
      opRef.current = op;
      const result = await actions.registrarDevolucion?.({ ...datos, operacionId: op.id });
      if (result?.error) {
        toast?.error(result.error);
        return; // se conserva el UUID: reintentar no duplica
      }
      opRef.current = null;
      const d = result?.data || {};
      const partes = [`Devolución ${fmtMoney(d.total, { decimals: 2 })}`];
      if (Number(d.cxc_reducido) > 0) partes.push(`CxC −${fmtMoney(d.cxc_reducido, { decimals: 2 })}`);
      if (Number(d.reembolso) > 0) partes.push(`reembolso ${fmtMoney(d.reembolso, { decimals: 2 })}${d.reembolso_manual ? ' (registrado manualmente)' : ''}`);
      if (d.requiere_nota_credito) partes.push('nota de crédito fiscal PENDIENTE');
      toast?.success(partes.join(' · '));
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
            Esta orden está facturada: la devolución queda con <strong>nota de crédito fiscal pendiente</strong> (el CFDI de egreso aún no se emite desde el sistema).
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
          <span className="text-xs font-semibold text-emerald-700 uppercase">Valor devuelto (vista previa)</span>
          <span className="text-xl font-extrabold text-emerald-700">{fmtMoney(totalDevolver, { decimals: 2 })}</span>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Qué pasa con el producto? *</label>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSICIONES.map(d => (
              <button key={d.value} type="button" onClick={() => setDisposicion(d.value)}
                className={`py-2.5 min-h-[44px] rounded-xl text-xs font-bold border-2 ${disposicion === d.value ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
                {d.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">{disposicion === 'Merma'
            ? 'No entra a inventario ni descuenta ningún cuarto: queda registrado como producto dañado en la devolución.'
            : 'El producto regresa como inventario vendible solo al cuarto que elijas.'}</p>
        </div>

        {disposicion === 'Reintegrar' && (
          <FormSelect
            label="Cuarto frío destino *"
            options={[{ value: '', label: 'Seleccionar…' }, ...cuartos.map(c => ({ value: s(c.id), label: s(c.nombre) || s(c.id) }))]}
            value={cuartoDestino}
            onChange={e => setCuartoDestino(e.target.value)}
            error={errors.cuartoDestino}
          />
        )}

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de reembolso *</label>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_REEMBOLSO.map(t => {
              const bloqueado = t === 'Nota credito' && !credito;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={bloqueado}
                  onClick={() => setTipoReembolso(t)}
                  className={`py-2.5 min-h-[44px] rounded-xl text-xs font-bold border-2 disabled:opacity-40 ${tipoReembolso === t ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
                >
                  {t === 'Nota credito' ? 'Nota crédito' : t}
                </button>
              );
            })}
          </div>
          {tipoReembolso === 'Efectivo' && (
            <p className="text-[11px] text-slate-500 mt-1.5">{credito
              ? 'Primero baja lo pendiente de la cuenta por cobrar; solo lo ya cobrado se reembolsa.'
              : 'Se reembolsa como máximo lo que realmente se cobró de esta orden.'} El sistema calcula el monto.</p>
          )}
          {tipoReembolso === 'Nota credito' && (
            <p className="text-[11px] text-slate-500 mt-1.5">Reduce lo pendiente de la cuenta por cobrar; no sale dinero.</p>
          )}
          {!credito && <p className="text-[11px] text-slate-400 mt-1">Nota crédito solo aplica a ventas a crédito. La reposición aún no está disponible.</p>}
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
          <FormBtn primary onClick={guardar} disabled={saving || itemsAGuardar.length === 0 || !motivo.trim() || (disposicion === 'Reintegrar' && !cuartoDestino)} loading={saving}>
            {saving ? 'Registrando…' : 'Registrar devolución'}
          </FormBtn>
        </div>
      </div>
    </Modal>
  );
}
