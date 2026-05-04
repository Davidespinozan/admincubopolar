// EditarVentaModal — modal separado para editar órdenes en estatus 'Creada'.
// NO permite cambiar cliente ni tipo de cobro (regla de negocio: al cambiar cliente
// se rompe la integridad de CxC futura). Edita solo: productos, fecha, folio nota,
// dirección/referencias de entrega.
//
// Decisión de diseño: NO se reusa NuevaVentaModal porque el modal de creación es
// un wizard de 3 pasos con cliente nuevo inline + auto-cobro + calculadora cambio,
// y mezclar el modo edición ahí agrega ~120 líneas de bifurcaciones que ponen en
// riesgo la creación normal. Este modal es plano y enfocado en edit.

import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { s, n, eqId, fmtMoney } from '../utils/safe';
import { stockDisponiblePorSku, stockDisponibleParaEdicion } from '../utils/stock';

const AddressAutocomplete = lazy(() => import('./ui/AddressAutocomplete'));

export default function EditarVentaModal({
  open,
  onClose,
  orden,
  data,
  actions,
  toast,
  onSuccess,
}) {
  const [form, setForm] = useState({
    fecha: '',
    folioNota: '',
    direccionEntrega: '',
    referenciaEntrega: '',
    latitudEntrega: null,
    longitudEntrega: null,
    direccionTouched: false,
  });
  const [lines, setLines] = useState([{ sku: '', qty: 1, precio: 0 }]);
  const [editandoDireccion, setEditandoDireccion] = useState(false);
  const [saving, setSaving] = useState(false);

  const cliente = useMemo(
    () => (data?.clientes || []).find(c => eqId(c.id, orden?.clienteId || orden?.cliente_id)) || null,
    [data?.clientes, orden]
  );

  const prodTerminados = useMemo(
    () => (data?.productos || []).filter(p => s(p.tipo) === 'Producto Terminado'),
    [data?.productos]
  );

  // Stock real desde cuartos_frios.stock JSONB (productos.stock es legacy).
  const cfStockMap = useMemo(
    () => stockDisponiblePorSku(data?.cuartosFrios || []),
    [data?.cuartosFrios]
  );

  // Cantidad de cada SKU que esta orden tenía ANTES de editar. Si la orden
  // estaba en flujo legacy y ya descontó stock, esta cantidad ya está fuera
  // del cuarto y debe sumarse a lo disponible para validar la nueva qty.
  const cantidadOriginalPorSku = useMemo(() => {
    const map = {};
    if (!orden) return map;
    const snap = Array.isArray(orden.preciosSnapshot) ? orden.preciosSnapshot : null;
    if (snap && snap.length > 0) {
      for (const ln of snap) {
        const sku = s(ln.sku);
        if (!sku) continue;
        map[sku] = (map[sku] || 0) + n(ln.qty || ln.cantidad);
      }
      return map;
    }
    const raw = s(orden.productos);
    if (!raw) return map;
    raw.split(',').forEach(part => {
      const m = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
      if (!m) return;
      const sku = s(m[2]);
      if (!sku) return;
      map[sku] = (map[sku] || 0) + parseInt(m[1] || '0', 10);
    });
    return map;
  }, [orden]);

  const getPrice = useCallback((cId, sku) => {
    if (cId) {
      const esp = (data?.preciosEsp || []).find(p => eqId(p.clienteId, cId) && p.sku === sku);
      if (esp) return n(esp.precio);
    }
    const prod = (data?.productos || []).find(p => p.sku === sku);
    return prod ? n(prod.precio) : 0;
  }, [data?.preciosEsp, data?.productos]);

  // Para EDITAR: stock disponible = lo que hay físicamente en cuartos
  // + lo que esta orden ya tenía reservado (que se "libera" al editar).
  const getStock = useCallback((sku) => {
    if (!sku) return 0;
    return stockDisponibleParaEdicion(cfStockMap, sku, cantidadOriginalPorSku[sku]);
  }, [cfStockMap, cantidadOriginalPorSku]);

  // Pre-cargar form/lines cuando se abre con una orden
  useEffect(() => {
    if (!open || !orden) return;

    setForm({
      fecha: s(orden.fecha) || '',
      folioNota: s(orden.folio_nota || orden.folioNota) || '',
      direccionEntrega: s(orden.direccion_entrega || orden.direccionEntrega) || '',
      referenciaEntrega: s(orden.referencia_entrega || orden.referenciaEntrega) || '',
      latitudEntrega: orden.latitud_entrega ?? orden.latitudEntrega ?? null,
      longitudEntrega: orden.longitud_entrega ?? orden.longitudEntrega ?? null,
      direccionTouched: !!(orden.direccion_entrega || orden.direccionEntrega),
    });
    setEditandoDireccion(false);

    // Parsear líneas desde orden.preciosSnapshot (si existe) o desde productos string
    const snap = Array.isArray(orden.preciosSnapshot) ? orden.preciosSnapshot : null;
    if (snap && snap.length > 0) {
      setLines(snap.map(l => ({ sku: s(l.sku), qty: n(l.qty), precio: n(l.unitPrice) })));
    } else {
      const raw = s(orden.productos);
      const items = [];
      if (raw) {
        raw.split(',').forEach(part => {
          const m = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
          if (m) {
            const qty = parseInt(m[1], 10);
            const sku = m[2];
            const cId = orden.clienteId || orden.cliente_id;
            items.push({ sku, qty, precio: getPrice(cId, sku) });
          }
        });
      }
      setLines(items.length ? items : [{ sku: '', qty: 1, precio: 0 }]);
    }
  }, [open, orden, getPrice]);

  const direccionCliente = useMemo(() => {
    if (!cliente) return '';
    return [s(cliente.calle), s(cliente.colonia), s(cliente.ciudad)].filter(Boolean).join(', ');
  }, [cliente]);

  const direccionEfectiva = form.direccionTouched && form.direccionEntrega
    ? form.direccionEntrega
    : direccionCliente;

  const subtotal = useMemo(
    () => lines.reduce((t, l) => t + (n(l.qty) * n(l.precio)), 0),
    [lines]
  );
  const totalCalc = subtotal;

  const addLine = () => setLines(prev => [...prev, { sku: '', qty: 1, precio: 0 }]);
  const updateLine = (idx, field, val) => setLines(prev => prev.map((l, i) => {
    if (i !== idx) return l;
    const u = { ...l, [field]: val };
    if (field === 'sku') {
      const cId = orden?.clienteId || orden?.cliente_id;
      u.precio = getPrice(cId, val);
    }
    return u;
  }));
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  const prodOpts = useMemo(
    () => [{ value: '', label: 'Seleccionar producto...' }, ...prodTerminados.map(p => ({
      value: s(p.sku),
      label: `${s(p.sku)} — ${s(p.nombre)} (${getStock(p.sku)} disp.)`,
    }))],
    [prodTerminados, getStock]
  );

  const guardar = async () => {
    if (saving) return;
    if (!orden?.id) return;

    // Validación de stock por línea
    for (const l of lines) {
      if (l.sku && n(l.qty) > 0) {
        const stock = getStock(l.sku);
        if (n(l.qty) > stock) {
          toast?.error(`Stock insuficiente de ${l.sku} (disp: ${stock})`);
          return;
        }
      }
    }

    const lineasValidas = lines.filter(l => l.sku && n(l.qty) > 0);
    if (lineasValidas.length === 0) {
      toast?.error('Agrega al menos un producto');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        fecha: form.fecha,
        folioNota: form.folioNota || null,
        direccionEntrega: form.direccionTouched ? s(form.direccionEntrega) : '',
        referenciaEntrega: s(form.referenciaEntrega),
        latitudEntrega: form.direccionTouched ? form.latitudEntrega : null,
        longitudEntrega: form.direccionTouched ? form.longitudEntrega : null,
        lines: lineasValidas.map(l => ({ sku: l.sku, qty: n(l.qty), precio: n(l.precio) })),
      };
      const result = await actions.updateOrden?.(orden.id, payload);
      if (result?.error) {
        toast?.error(result.error);
        return;
      }
      onSuccess?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!open} onClose={() => { if (!saving) onClose?.(); }} title={`Editar orden ${s(orden?.folio)}`} wide>
      {!orden ? null : (
        <div className="space-y-4">
          {/* Cliente y tipo cobro: read-only */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-sm">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400 uppercase font-bold">Cliente</p>
                <p className="font-semibold text-slate-800">{s(orden.cliente)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 uppercase font-bold">Tipo de cobro</p>
                <p className="font-semibold text-slate-800">{s(orden.tipo_cobro || orden.tipoCobro || 'Contado')}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">No se pueden cambiar cliente ni tipo de cobro. Si necesitas cambiarlos, cancela y crea una nueva orden.</p>
          </div>

          {/* Fecha + folio nota */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Fecha de entrega"
              type="date"
              value={form.fecha}
              onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
            />
            <FormInput
              label="Folio de nota"
              value={form.folioNota}
              onChange={e => setForm(f => ({ ...f, folioNota: e.target.value }))}
              placeholder="Ej: N-0001"
            />
          </div>

          {/* Productos */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Productos</label>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={l.sku}
                      onChange={e => updateLine(i, 'sku', e.target.value)}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white min-h-[44px]"
                    >
                      {prodOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={l.qty}
                      onChange={e => updateLine(i, 'qty', parseInt(e.target.value) || 1)}
                      className="w-16 border border-slate-200 rounded-xl px-2 py-2.5 text-sm text-center min-h-[44px] bg-white"
                    />
                    <span className="text-sm font-semibold text-slate-700 w-20 text-right">{fmtMoney(n(l.qty) * n(l.precio))}</span>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-lg min-w-[28px]">×</button>
                    )}
                  </div>
                  {l.sku && <p className="text-[11px] text-slate-500 mt-1.5 ml-1">Stock disponible: {getStock(l.sku).toLocaleString()} bolsas</p>}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="w-full mt-2 py-2.5 border-2 border-dashed border-slate-300 text-slate-600 text-sm font-semibold rounded-xl hover:border-slate-400 hover:text-slate-700 transition-colors"
            >
              + Agregar otro producto
            </button>
          </div>

          {/* Total */}
          <div className="bg-slate-900 rounded-xl p-4">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-medium text-slate-300">Total</span>
              <span className="text-3xl font-bold text-white">{fmtMoney(totalCalc)}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">IVA 0% (hielo)</div>
          </div>

          {/* Dirección */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase">Entrega a</p>
              {!editandoDireccion ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditandoDireccion(true);
                    if (!form.direccionTouched) {
                      setForm(f => ({ ...f, direccionEntrega: direccionCliente, direccionTouched: true }));
                    }
                  }}
                  className="text-xs text-blue-600 font-bold"
                >
                  Cambiar dirección
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditandoDireccion(false);
                    setForm(f => ({
                      ...f,
                      direccionEntrega: '',
                      latitudEntrega: null,
                      longitudEntrega: null,
                      direccionTouched: false,
                    }));
                  }}
                  className="text-xs text-slate-500 font-bold"
                >
                  Usar la del cliente
                </button>
              )}
            </div>

            {!editandoDireccion ? (
              <p className="text-sm text-slate-700">
                {direccionEfectiva || <span className="italic text-slate-400">Sin dirección registrada</span>}
              </p>
            ) : (
              <div className="space-y-2">
                <Suspense fallback={<p className="text-xs text-slate-400">Cargando autocompletar…</p>}>
                  <AddressAutocomplete
                    onSelect={(addr) => {
                      const formatted = addr?.formatted
                        || [addr?.calle, addr?.colonia, addr?.ciudad].filter(Boolean).join(', ');
                      setForm(f => ({
                        ...f,
                        direccionEntrega: formatted,
                        latitudEntrega: addr?.lat ?? null,
                        longitudEntrega: addr?.lng ?? null,
                        direccionTouched: true,
                      }));
                    }}
                  />
                </Suspense>
                <FormInput
                  label="O escribe la dirección manualmente"
                  value={form.direccionEntrega}
                  onChange={e => setForm(f => ({ ...f, direccionEntrega: e.target.value, direccionTouched: true }))}
                  placeholder="Av. Revolución 123, Centro, Durango"
                />
              </div>
            )}

            <FormInput
              label="Referencias para el chofer"
              value={form.referenciaEntrega}
              onChange={e => setForm(f => ({ ...f, referenciaEntrega: e.target.value }))}
              placeholder="Casa azul, frente al parque"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <FormBtn onClick={() => { if (!saving) onClose?.(); }}>Cancelar</FormBtn>
            <FormBtn primary onClick={guardar} loading={saving}>Guardar cambios</FormBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}
