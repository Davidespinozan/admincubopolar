import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import Modal, { FormInput, FormSelect, FormBtn } from './ui/Modal';
import { s, n, eqId, fmtMoney } from '../utils/safe';

const AddressAutocomplete = lazy(() => import('./ui/AddressAutocomplete'));

const TIPOS_CLIENTE = ["Tienda", "Restaurante", "Nevería", "Hotel", "Cadena", "Particular", "Otro"];
const USOS_CFDI = [
  { val: "G01", label: "G01 — Adquisición de mercancías" },
  { val: "G03", label: "G03 — Gastos en general" },
  { val: "S01", label: "S01 — Sin efectos fiscales" },
];

const DEFAULTS_ADMIN = {
  wizard: true,
  fechaEntrega: true,
  folioNota: true,
  tipoCobro: true,
  clienteNuevoInline: true,
  toggleFactura: false,
  autoOpenCobro: false,
  calculadoraCambio: false,
  totalGrande: true,
};

const DEFAULTS_STANDALONE = {
  wizard: true,
  fechaEntrega: true,
  folioNota: true,
  tipoCobro: true,
  clienteNuevoInline: true,
  toggleFactura: true,
  autoOpenCobro: true,
  calculadoraCambio: true,
  totalGrande: true,
};

const cliFormEmpty = {
  nombre: "",
  contacto: "",
  tipo: "Tienda",
  requiereFactura: false,
  rfc: "",
  correo: "",
  regimen: "Régimen General",
  usoCfdi: "G03",
  cp: "",
};

export default function NuevaVentaModal({
  open,
  onClose,
  onSuccess,
  data,
  actions,
  user,
  toast,
  variant = 'admin',
  features,
  clienteIdInicial = '',
}) {
  const ft = useMemo(() => ({
    ...(variant === 'admin' ? DEFAULTS_ADMIN : DEFAULTS_STANDALONE),
    ...(features || {}),
  }), [variant, features]);

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    clienteId: clienteIdInicial || '',
    fecha: '',
    tipoCobro: 'Contado',
    folioNota: '',
    requiereFactura: false,
    recibido: '',
    direccionEntrega: '',
    referenciaEntrega: '',
    latitudEntrega: null,
    longitudEntrega: null,
    direccionTouched: false, // false = sigue heredando del cliente
  });
  const [editandoDireccion, setEditandoDireccion] = useState(false);
  const [lines, setLines] = useState([{ sku: '', qty: 1, precio: 0 }]);

  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [cliForm, setCliForm] = useState(cliFormEmpty);
  const [registrandoCliente, setRegistrandoCliente] = useState(false);

  const clientesActivos = useMemo(
    () => (data?.clientes || []).filter(c => s(c.estatus) === 'Activo'),
    [data?.clientes]
  );

  const prodTerminados = useMemo(
    () => (data?.productos || []).filter(p => s(p.tipo) === 'Producto Terminado'),
    [data?.productos]
  );

  const cfStockMap = useMemo(() => {
    const map = {};
    for (const cf of (data?.cuartosFrios || [])) {
      for (const [sku, qty] of Object.entries(cf?.stock || {})) {
        map[sku] = (map[sku] || 0) + n(qty);
      }
    }
    return map;
  }, [data?.cuartosFrios]);

  const getPrice = useCallback((cId, sku) => {
    if (cId) {
      const esp = (data?.preciosEsp || []).find(p => eqId(p.clienteId, cId) && p.sku === sku);
      if (esp) return n(esp.precio);
    }
    const prod = (data?.productos || []).find(p => p.sku === sku);
    return prod ? n(prod.precio) : 0;
  }, [data?.preciosEsp, data?.productos]);

  const getStock = useCallback((sku) => {
    if (!sku) return 0;
    if (cfStockMap[sku] !== undefined) return cfStockMap[sku];
    const p = (data?.productos || []).find(x => s(x.sku) === s(sku));
    return p ? n(p.stock) : 0;
  }, [cfStockMap, data?.productos]);

  const clienteSeleccionado = useMemo(
    () => (data?.clientes || []).find(c => eqId(c.id, form.clienteId)) || null,
    [data?.clientes, form.clienteId]
  );

  const direccionCliente = useMemo(() => {
    if (!clienteSeleccionado) return '';
    return [s(clienteSeleccionado.calle), s(clienteSeleccionado.colonia), s(clienteSeleccionado.ciudad)]
      .filter(Boolean)
      .join(', ');
  }, [clienteSeleccionado]);

  const direccionEfectiva = form.direccionTouched && form.direccionEntrega
    ? form.direccionEntrega
    : direccionCliente;

  const subtotal = useMemo(
    () => lines.reduce((t, l) => t + (n(l.qty) * n(l.precio)), 0),
    [lines]
  );
  const totalCalc = subtotal; // IVA 0% (hielo)

  const productosStr = useMemo(
    () => lines.filter(l => l.sku && l.qty > 0).map(l => `${l.qty}×${l.sku}`).join(', '),
    [lines]
  );

  const reset = useCallback(() => {
    setStep(1);
    setErrors({});
    setSaving(false);
    setForm({
      clienteId: clienteIdInicial || '',
      fecha: '',
      tipoCobro: 'Contado',
      folioNota: '',
      requiereFactura: false,
      recibido: '',
      direccionEntrega: '',
      referenciaEntrega: '',
      latitudEntrega: null,
      longitudEntrega: null,
      direccionTouched: false,
    });
    setLines([{ sku: '', qty: 1, precio: 0 }]);
    setNuevoCliente(false);
    setCliForm(cliFormEmpty);
    setRegistrandoCliente(false);
    setEditandoDireccion(false);
  }, [clienteIdInicial]);

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    if (saving || registrandoCliente) return;
    onClose?.();
  };

  const handleClientChange = (cId) => {
    const cli = (data?.clientes || []).find(c => String(c.id) === String(cId));
    const tipoCobro = cli?.credito_autorizado ? 'Credito' : 'Contado';
    setForm(f => ({
      ...f,
      clienteId: cId,
      tipoCobro,
      requiereFactura: ft.toggleFactura ? (f.requiereFactura && !!cli?.rfc && cli.rfc !== 'XAXX010101000') : f.requiereFactura,
    }));
    setLines(prev => prev.map(l => ({ ...l, precio: getPrice(cId, l.sku) })));
    setNuevoCliente(false);
  };

  const addLine = () => setLines(prev => [...prev, { sku: '', qty: 1, precio: 0 }]);
  const updateLine = (idx, field, val) => setLines(prev => prev.map((l, i) => {
    if (i !== idx) return l;
    const u = { ...l, [field]: val };
    if (field === 'sku') u.precio = getPrice(form.clienteId, val);
    return u;
  }));
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  const registrarCliente = async () => {
    if (registrandoCliente) return;
    if (!cliForm.nombre.trim()) {
      toast?.error?.('Nombre requerido');
      return;
    }
    if (cliForm.requiereFactura && !cliForm.rfc.trim()) {
      toast?.error?.('RFC requerido para factura');
      return;
    }
    const payload = {
      nombre: cliForm.nombre.trim(),
      contacto: cliForm.contacto,
      tipo: cliForm.tipo,
      rfc: cliForm.requiereFactura ? cliForm.rfc : 'XAXX010101000',
      correo: cliForm.requiereFactura ? cliForm.correo : '',
      regimen: cliForm.requiereFactura ? cliForm.regimen : 'Sin obligaciones',
      usoCfdi: cliForm.requiereFactura ? cliForm.usoCfdi : 'S01',
      cp: cliForm.cp || '34000',
    };
    setRegistrandoCliente(true);
    try {
      const result = await actions.addCliente?.(payload);
      const realId = result?.id ? String(result.id) : null;
      if (!realId) {
        toast?.error?.('No se pudo registrar el cliente');
        return;
      }
      setForm(f => ({ ...f, clienteId: realId, requiereFactura: cliForm.requiereFactura }));
      setLines(prev => prev.map(l => ({ ...l, precio: getPrice(realId, l.sku) })));
      setNuevoCliente(false);
      setCliForm(cliFormEmpty);
      toast?.success?.(`Cliente ${payload.nombre} registrado`);
    } finally {
      setRegistrandoCliente(false);
    }
  };

  const validateStep = (currentStep) => {
    const e = {};
    if (currentStep === 1) {
      if (!form.clienteId) e.clienteId = 'Selecciona un cliente';
    }
    if (currentStep === 2) {
      if (lines.length === 0 || !lines.some(l => l.sku && l.qty > 0)) {
        e.productos = 'Agrega al menos un producto';
      } else {
        for (const l of lines) {
          if (l.sku && l.qty > 0) {
            const stock = getStock(l.sku);
            if (n(l.qty) > stock) {
              e.productos = `Stock insuficiente de ${l.sku} (disp: ${stock})`;
              break;
            }
          }
        }
      }
    }
    return e;
  };

  const nextStep = () => {
    const e = validateStep(step);
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setStep(s => s + 1);
  };
  const prevStep = () => {
    setErrors({});
    setStep(s => s - 1);
  };

  const save = async () => {
    if (saving) return;
    const e = { ...validateStep(1), ...validateStep(2) };
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    try {
      const cli = clienteSeleccionado;
      // Solo persistir dirección custom si el usuario explícitamente la cambió.
      // Si direccionTouched=false → null en BD → chofer hereda del cliente.
      const payload = {
        cliente: s(cli?.nombre),
        clienteId: form.clienteId,
        fecha: form.fecha || new Date().toISOString().slice(0, 10),
        productos: productosStr,
        total: totalCalc,
        usuarioId: user?.id || null,
        authId: user?.auth_id || null,
        tipoCobro: form.tipoCobro || 'Contado',
        folioNota: form.folioNota || null,
        requiereFactura: ft.toggleFactura ? !!form.requiereFactura : undefined,
        direccionEntrega: form.direccionTouched ? s(form.direccionEntrega) : '',
        referenciaEntrega: s(form.referenciaEntrega),
        latitudEntrega: form.direccionTouched ? form.latitudEntrega : null,
        longitudEntrega: form.direccionTouched ? form.longitudEntrega : null,
      };
      const result = await actions.addOrden?.(payload);
      if (result?.error || result?.message) {
        toast?.error?.(result.error || result.message || 'No se pudo crear la orden');
        return;
      }
      onSuccess?.(result?.orden || null);
    } finally {
      setSaving(false);
    }
  };

  const recibido = n(form.recibido);
  const cambio = recibido - totalCalc;

  // ── Sub-views por paso ─────────────────────────────────────────

  const wizardHeader = (
    <div className="flex items-center gap-2 mb-5">
      {[1, 2, 3].map(num => (
        <div key={num} className="flex items-center gap-2 flex-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
            step === num ? 'bg-slate-900 text-white' :
            step > num ? 'bg-emerald-500 text-white' :
            'bg-slate-100 text-slate-400'
          }`}>
            {step > num ? '✓' : num}
          </div>
          <div className="flex-1">
            <p className={`text-xs font-semibold ${step === num ? 'text-slate-900' : 'text-slate-400'}`}>
              {num === 1 ? 'Cliente' : num === 2 ? 'Productos' : 'Detalles'}
            </p>
            <p className="text-[10px] text-slate-400">{num === 3 ? 'Opcional' : 'Requerido'}</p>
          </div>
          {num < 3 && <div className={`h-0.5 flex-1 ${step > num ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );

  const clienteOpts = useMemo(
    () => [{ value: '', label: 'Seleccionar...' }, ...clientesActivos.map(c => ({
      value: String(c.id),
      label: c.rfc && c.rfc !== 'XAXX010101000' ? `${s(c.nombre)} · ${s(c.rfc)}` : s(c.nombre),
    }))],
    [clientesActivos]
  );

  const prodOpts = useMemo(
    () => [{ value: '', label: 'Seleccionar producto...' }, ...prodTerminados.map(p => ({
      value: s(p.sku),
      label: `${s(p.sku)} — ${s(p.nombre)} (${cfStockMap[p.sku] ?? n(p.stock)} disp.)`,
    }))],
    [prodTerminados, cfStockMap]
  );

  const stepCliente = (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">¿A quién le estás vendiendo?</p>

      {!nuevoCliente && (
        <FormSelect
          label="Cliente *"
          options={clienteOpts}
          value={form.clienteId}
          onChange={e => handleClientChange(e.target.value)}
          error={errors.clienteId}
        />
      )}

      {!nuevoCliente && ft.clienteNuevoInline && (
        <button
          type="button"
          onClick={() => setNuevoCliente(true)}
          className="text-xs text-blue-600 font-bold mt-1"
        >
          + Registrar cliente nuevo
        </button>
      )}

      {nuevoCliente && (
        <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-blue-800">Nuevo cliente</h4>
            <button type="button" onClick={() => setNuevoCliente(false)} className="text-xs text-blue-500">Cancelar</button>
          </div>
          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] font-bold text-blue-600 uppercase mb-0.5">Nombre *</label>
              <input value={cliForm.nombre} onChange={e => setCliForm(f => ({ ...f, nombre: e.target.value }))}
                className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white" placeholder="Nombre o razón social" autoFocus />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-bold text-blue-600 uppercase mb-0.5">Teléfono</label>
                <input value={cliForm.contacto} onChange={e => setCliForm(f => ({ ...f, contacto: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white" placeholder="618 123 4567" type="tel" inputMode="tel" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-blue-600 uppercase mb-0.5">Tipo</label>
                <select value={cliForm.tipo} onChange={e => setCliForm(f => ({ ...f, tipo: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white">
                  {TIPOS_CLIENTE.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-blue-200">
              <div>
                <p className="text-sm font-bold text-slate-800">¿Requiere factura?</p>
                <p className="text-[10px] text-slate-400">Se pedirán datos fiscales</p>
              </div>
              <button type="button" onClick={() => setCliForm(f => ({ ...f, requiereFactura: !f.requiereFactura }))}
                className={`w-12 h-7 rounded-full transition-all relative ${cliForm.requiereFactura ? 'bg-blue-600' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${cliForm.requiereFactura ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>

            {cliForm.requiereFactura && (
              <div className="bg-white rounded-xl p-3 border border-blue-200 space-y-2">
                <p className="text-[10px] font-bold text-purple-600 uppercase">Datos fiscales</p>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">RFC *</label>
                  <input value={cliForm.rfc} onChange={e => setCliForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="XAXX010101000" maxLength={13} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Correo para factura</label>
                  <input value={cliForm.correo} onChange={e => setCliForm(f => ({ ...f, correo: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="correo@empresa.com" type="email" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Uso CFDI</label>
                    <select value={cliForm.usoCfdi} onChange={e => setCliForm(f => ({ ...f, usoCfdi: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs bg-white">
                      {USOS_CFDI.map(u => <option key={u.val} value={u.val}>{u.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">C.P.</label>
                    <input value={cliForm.cp} onChange={e => setCliForm(f => ({ ...f, cp: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="34000" maxLength={5} />
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={registrarCliente}
              disabled={registrandoCliente || !cliForm.nombre.trim() || (cliForm.requiereFactura && !cliForm.rfc.trim())}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {registrandoCliente ? 'Registrando…' : 'Registrar cliente y continuar'}
            </button>
          </div>
        </div>
      )}

      {form.clienteId && !nuevoCliente && clienteSeleccionado && (
        <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-bold text-slate-800">{s(clienteSeleccionado.nombre)}</p>
              <p className="text-xs text-slate-500">
                {clienteSeleccionado.rfc && clienteSeleccionado.rfc !== 'XAXX010101000' ? s(clienteSeleccionado.rfc) : 'Sin RFC'}
                {clienteSeleccionado.contacto ? ` · ${s(clienteSeleccionado.contacto)}` : ''}
              </p>
            </div>
            {n(clienteSeleccionado.saldo) > 0 && (
              <span className="min-w-[72px] rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white">
                Debe {fmtMoney(clienteSeleccionado.saldo)}
              </span>
            )}
          </div>

          {clienteSeleccionado.credito_autorizado && (
            <div className="mt-2 pt-2 border-t border-emerald-200 text-xs text-purple-700 font-semibold">
              💳 Crédito autorizado · Límite {fmtMoney(clienteSeleccionado.limite_credito)} · Saldo pendiente {fmtMoney(clienteSeleccionado.saldo)}
            </div>
          )}

          {ft.toggleFactura && clienteSeleccionado.rfc && clienteSeleccionado.rfc !== 'XAXX010101000' && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-200">
              <span className="text-xs text-slate-600 font-semibold">Facturar esta venta</span>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, requiereFactura: !f.requiereFactura }))}
                className={`w-10 h-6 rounded-full transition-all relative ${form.requiereFactura ? 'bg-purple-600' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.requiereFactura ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
          )}
        </div>
      )}

      {form.clienteId && !nuevoCliente && ft.tipoCobro && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de cobro</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, tipoCobro: 'Contado' }))}
              className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${form.tipoCobro === 'Contado' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
            >
              💵 Cobrar al entregar
            </button>
            {(() => {
              const tieneCredito = !!clienteSeleccionado?.credito_autorizado;
              return (
                <button
                  type="button"
                  disabled={!tieneCredito}
                  onClick={() => tieneCredito && setForm(f => ({ ...f, tipoCobro: 'Credito' }))}
                  className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                    !tieneCredito ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50' :
                    form.tipoCobro === 'Credito' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  📋 A crédito
                  {!tieneCredito && <span className="block text-[10px] text-slate-400 mt-0.5 font-normal">Cliente sin crédito</span>}
                </button>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );

  const stepProductos = (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">¿Qué le vas a vender? Puedes agregar varios productos.</p>

      {errors.productos && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs text-red-700 font-semibold">⚠️ {errors.productos}</p>
        </div>
      )}

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

      <button
        type="button"
        onClick={addLine}
        className="w-full py-2.5 border-2 border-dashed border-slate-300 text-slate-600 text-sm font-semibold rounded-xl hover:border-slate-400 hover:text-slate-700 transition-colors"
      >
        + Agregar otro producto
      </button>

      {ft.totalGrande && (
        <div className="bg-slate-900 rounded-xl p-4 mt-2">
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-medium text-slate-300">Total</span>
            <span className="text-3xl font-bold text-white">{fmtMoney(totalCalc)}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">IVA 0% (hielo)</div>
        </div>
      )}
    </div>
  );

  const stepDetalles = (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 mb-2">Últimos detalles. Todos opcionales.</p>

      {ft.fechaEntrega && (
        <FormInput
          label="Fecha de entrega"
          type="date"
          value={form.fecha}
          onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
        />
      )}

      {ft.folioNota && (
        <FormInput
          label="Folio de nota"
          value={form.folioNota}
          onChange={e => setForm(f => ({ ...f, folioNota: e.target.value }))}
          placeholder="Ej: N-0001"
        />
      )}

      {/* Dirección de entrega: hereda del cliente, override opcional */}
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

      {ft.calculadoraCambio && form.tipoCobro === 'Contado' && (
        <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
          <p className="text-xs font-bold text-emerald-700 uppercase mb-2">Calculadora de cambio</p>
          <FormInput
            label="¿Cuánto recibió?"
            type="number"
            value={form.recibido}
            onChange={e => setForm(f => ({ ...f, recibido: e.target.value }))}
            placeholder="0"
          />
          {form.recibido !== '' && Number.isFinite(recibido) && (
            <div className="mt-2 flex justify-between items-baseline">
              <span className="text-sm text-slate-600">Cambio</span>
              <span className={`text-2xl font-extrabold ${cambio < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {cambio < 0 ? `Falta ${fmtMoney(Math.abs(cambio))}` : fmtMoney(cambio)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-50 rounded-xl p-4 mt-2">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Resumen</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Cliente</span>
            <span className="font-semibold text-slate-800">{s(clienteSeleccionado?.nombre)}</span>
          </div>
          {ft.tipoCobro && (
            <div className="flex justify-between">
              <span className="text-slate-500">Tipo de cobro</span>
              <span className="font-semibold text-slate-800">{form.tipoCobro === 'Contado' ? '💵 Cobrar al entregar' : '📋 A crédito'}</span>
            </div>
          )}
          <div className="border-t border-slate-200 pt-2 mt-2">
            <div className="text-xs text-slate-500 mb-1">Productos</div>
            {lines.filter(l => l.sku && l.qty > 0).map((l, i) => {
              const prod = (data?.productos || []).find(p => s(p.sku) === s(l.sku));
              return (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-slate-700">{n(l.qty)}× {prod ? s(prod.nombre) : s(l.sku)}</span>
                  <span className="font-mono text-slate-600">{fmtMoney(n(l.qty) * n(l.precio))}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {ft.totalGrande && (
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-medium text-slate-300">Total</span>
            <span className="text-3xl font-bold text-white">{fmtMoney(totalCalc)}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Modal open={!!open} onClose={handleClose} title="Nueva venta" wide>
      {ft.wizard && wizardHeader}

      {ft.wizard ? (
        <>
          {step === 1 && stepCliente}
          {step === 2 && stepProductos}
          {step === 3 && stepDetalles}
        </>
      ) : (
        <>
          {stepCliente}
          {stepProductos}
          {stepDetalles}
        </>
      )}

      <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-slate-100">
        <FormBtn onClick={handleClose}>Cancelar</FormBtn>
        <div className="flex gap-2">
          {ft.wizard && step > 1 && <FormBtn onClick={prevStep}>← Atrás</FormBtn>}
          {ft.wizard && step < 3 && <FormBtn primary onClick={nextStep}>Siguiente →</FormBtn>}
          {(!ft.wizard || step === 3) && (
            <FormBtn primary onClick={save} loading={saving}>
              {form.requiereFactura ? 'Crear venta con factura' : 'Crear venta'}
            </FormBtn>
          )}
        </div>
      </div>
    </Modal>
  );
}
