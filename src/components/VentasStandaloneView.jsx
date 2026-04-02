import { useState, useMemo, useCallback } from 'react';
import { s, n, eqId } from '../utils/safe';

const PAGOS = ["Efectivo", "Transferencia SPEI", "Tarjeta (terminal)", "QR / Link de pago", "Crédito (fiado)"];
const TIPOS_CLIENTE = ["Tienda", "Restaurante", "Nevería", "Hotel", "Cadena", "Particular", "Otro"];
const USOS_CFDI = [
  { val: "G01", label: "G01 — Adquisición de mercancías" },
  { val: "G03", label: "G03 — Gastos en general" },
  { val: "S01", label: "S01 — Sin efectos fiscales" },
];
const VENTAS_SHELL = "min-h-screen w-full max-w-[640px] mx-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef4f7_100%)] text-slate-900 md:max-w-3xl lg:max-w-5xl";

export default function VentasStandaloneView({ user, data, actions, onLogout }) {
  const [tab, setTab] = useState("ventas");
  const [modal, setModal] = useState(false);
  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({ metodo: "Efectivo", referencia: "" });
  const [checkoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [toast, setToast] = useState("");

  // Order form
  const [form, setForm] = useState({ clienteId: "", requiereFactura: false });
  const [lines, setLines] = useState([{ sku: "", qty: 1, precio: 0 }]);

  // New client inline form
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [cliForm, setCliForm] = useState({ nombre: "", contacto: "", tipo: "Tienda", requiereFactura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const isOwnedBy = useCallback((row) => {
    if (!row) return false;
    const ownerId = user?.id;
    const authId = user?.auth_id;
    const ownerName = s(user?.nombre);
    const ownerKeys = ['usuario_id', 'vendedor_id', 'owner_id', 'created_by'];
    if (ownerKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(ownerId))) return true;
    const authKeys = ['auth_id', 'usuario_auth_id', 'vendedor_auth_id'];
    if (authId && authKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(authId))) return true;
    const nameKeys = ['usuario', 'vendedor'];
    if (ownerName && nameKeys.some(k => row[k] !== undefined && row[k] !== null && s(row[k]) === ownerName)) return true;
    return false;
  }, [user]);

  const isAdminPreview = user?.rol === 'Admin';
  const ordenesUsuario = useMemo(() => isAdminPreview ? (data.ordenes || []) : (data.ordenes || []).filter(o => isOwnedBy(o)), [data.ordenes, isOwnedBy, isAdminPreview]);
  const clientes = useMemo(() => (data.clientes || []).filter(c => c.estatus === "Activo"), [data.clientes]);
  const prodTerminados = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);

  const getPrice = useCallback((cId, sku) => {
    if (cId) { const esp = data.preciosEsp.find(p => eqId(p.clienteId, cId) && p.sku === sku); if (esp) return n(esp.precio); }
    const prod = data.productos.find(p => p.sku === sku);
    return prod ? n(prod.precio) : 0;
  }, [data.preciosEsp, data.productos]);

  const getStock = useCallback((sku) => {
    if (!sku) return 0;
    const prod = data.productos.find(p => s(p.sku) === s(sku));
    return prod ? n(prod.stock) : 0;
  }, [data.productos]);

  const handleClientChange = (cId) => {
    setForm(f => ({ ...f, clienteId: cId }));
    setLines(prev => prev.map(l => ({ ...l, precio: getPrice(cId, l.sku) })));
    setNuevoCliente(false);
  };
  const addLine = () => setLines(prev => [...prev, { sku: "", qty: 1, precio: 0 }]);
  const updateLine = (idx, field, val) => setLines(prev => prev.map((l, i) => {
    if (i !== idx) return l;
    const u = { ...l, [field]: val };
    if (field === "sku") u.precio = getPrice(form.clienteId, val);
    return u;
  }));
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  const subtotal = useMemo(() => lines.reduce((s, l) => s + (n(l.qty) * n(l.precio)), 0), [lines]);
  const totalCalc = subtotal; // Hielo: IVA tasa 0%
  const productosStr = useMemo(() => lines.filter(l => l.sku && l.qty > 0).map(l => `${l.qty}×${l.sku}`).join(", "), [lines]);

  // Register new client and select it using the real Supabase-assigned ID
  const registrarCliente = async () => {
    if (!cliForm.nombre.trim()) return;
    const nuevo = {
      nombre: cliForm.nombre.trim(),
      contacto: cliForm.contacto,
      tipo: cliForm.tipo,
      rfc: cliForm.requiereFactura ? cliForm.rfc : "XAXX010101000",
      correo: cliForm.requiereFactura ? cliForm.correo : "",
      regimen: cliForm.requiereFactura ? cliForm.regimen : "Sin obligaciones",
      usoCfdi: cliForm.requiereFactura ? cliForm.usoCfdi : "S01",
      cp: cliForm.cp || "34000",
    };
    const result = await actions.addCliente(nuevo);
    // result is { id } on success or an error object
    const realId = result?.id ? String(result.id) : null;
    if (realId) {
      setForm(f => ({ ...f, clienteId: realId, requiereFactura: cliForm.requiereFactura }));
      setLines(prev => prev.map(l => ({ ...l, precio: getPrice(realId, l.sku) })));
    }
    setNuevoCliente(false);
    showToast("Cliente " + cliForm.nombre + " registrado ✓");
    setCliForm({ nombre: "", contacto: "", tipo: "Tienda", requiereFactura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });
  };

  const crearOrden = async () => {
    if (!form.clienteId) return;
    if (!lines.some(l => l.sku && l.qty > 0)) return;
    const cli = (data.clientes || []).find(c => eqId(c.id, form.clienteId));
    const total = totalCalc;
    const result = await actions.addOrden({
      cliente: s(cli?.nombre), clienteId: form.clienteId,
      fecha: new Date().toISOString().slice(0, 10),
      productos: productosStr, total,
      requiereFactura: form.requiereFactura,
      usuarioId: user?.id,
      authId: user?.auth_id,
    });
    setModal(false);
    setForm({ clienteId: "", requiereFactura: false });
    setLines([{ sku: "", qty: 1, precio: 0 }]);
    // Auto-open payment modal with the newly created order
    if (result?.orden) {
      showToast("Orden creada — ahora cobra");
      cobrar(result.orden);
    } else {
      showToast("Orden creada — $" + total.toLocaleString());
    }
  };

  const cobrar = (ord) => { setPagoModal(ord); setPagoForm({ metodo: "Efectivo", referencia: "" }); setCheckoutUrl(null); setShortUrl(null); };
  const confirmarCobro = async () => {
    if (!pagoModal) return;
    if (pagoForm.metodo === "QR / Link de pago") {
      setGenerandoLink(true);
      try {
        const result = await actions.crearCheckoutPago?.(pagoModal.id, checkoutProvider);
        if (result?.checkoutUrl) {
          setCheckoutUrl(result.checkoutUrl);
          setShortUrl(result.shortUrl || result.checkoutUrl);
          showToast('Link de pago generado');
        } else {
          showToast('Error al generar link de pago');
        }
      } catch (e) {
        showToast('Error: ' + (e.message || 'No se pudo generar el link'));
      } finally {
        setGenerandoLink(false);
      }
      return;
    }
    await actions.updateOrdenEstatus(pagoModal.id, "Entregada", pagoForm.metodo);
    showToast(pagoForm.metodo.includes("Crédito") || pagoForm.metodo.includes("fiado") ? "Venta a crédito registrada" : "Cobrado — " + pagoForm.metodo);
    setPagoModal(null);
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const ordenesHoy = useMemo(() => ordenesUsuario.filter(o => o.fecha && o.fecha.slice(0, 10) === hoy), [ordenesUsuario, hoy]);
  const pendientes = useMemo(() => ordenesUsuario.filter(o => o.estatus === "Creada"), [ordenesUsuario]);
  const ventasHoy = useMemo(() => ordenesHoy.filter(o => o.estatus === "Entregada").reduce((s, o) => s + n(o.total), 0), [ordenesHoy]);

  return (
    <div className={VENTAS_SHELL}>
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 pb-5 text-white shadow-[0_24px_48px_rgba(5,150,105,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-1">
          <div><p className="erp-kicker text-emerald-100/80">Ventas</p><h1 className="font-display text-[1.6rem] font-bold tracking-[-0.04em]">Ventas del día</h1><p className="text-xs text-emerald-100">{s(user?.nombre)}</p></div>
          <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs">Salir</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Vendido hoy</p><p className="mt-1.5 text-[1.8rem] font-extrabold">${ventasHoy.toLocaleString()}</p></div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Pendientes</p><p className="mt-1.5 text-[1.8rem] font-extrabold">{pendientes.length}</p><p className="text-xs text-stone-300">órdenes por cobrar</p></div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        <button onClick={() => { setModal(true); setLines([{ sku: "", qty: 1, precio: 0 }]); setForm({ clienteId: "", requiereFactura: false }); setNuevoCliente(false); }}
          className="w-full rounded-[22px] bg-emerald-600 py-4.5 text-base font-extrabold text-white shadow-[0_20px_34px_rgba(5,150,105,0.16)] transition-transform active:scale-[0.98]">
          + Nueva venta
        </button>

        <div className="grid grid-cols-1 gap-1 rounded-[20px] border border-stone-200/80 bg-white/72 p-1.5 shadow-[0_14px_28px_rgba(22,18,15,0.05)] sm:grid-cols-3">
          {[{ k: "ventas", l: "Por cobrar" }, { k: "hoy", l: "Hoy" }, { k: "todas", l: "Todas" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex-1 rounded-[16px] py-3 text-sm font-semibold transition-all ${tab === t.k ? "bg-emerald-600 text-white shadow-[0_12px_22px_rgba(5,150,105,0.14)]" : "text-slate-600"}`}>
              {t.l}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {(tab === "ventas" ? pendientes : tab === "hoy" ? ordenesHoy : ordenesUsuario).map(o => (
            <div key={o.id} className="rounded-[24px] border border-stone-200/80 bg-white/78 p-4 shadow-[0_14px_28px_rgba(22,18,15,0.05)]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-600">{s(o.folio)}</span>
                    {o.requiereFactura && <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded">FACTURA</span>}
                  </div>
                  <p className="text-sm font-bold text-slate-800 mt-0.5">{s(o.cliente)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s(o.productos)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-slate-800">${n(o.total).toLocaleString()}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    o.estatus === "Creada" ? "bg-blue-100 text-blue-700" :
                    o.estatus === "Asignada" ? "bg-amber-100 text-amber-700" :
                    o.estatus === "Entregada" ? "bg-emerald-100 text-emerald-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>{s(o.estatus)}</span>
                </div>
              </div>
              {o.estatus === "Creada" && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => cobrar(o)} className="flex-1 rounded-[18px] bg-emerald-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]">Cobrar</button>
                  <button onClick={() => { actions.updateOrdenEstatus(o.id, "Asignada"); showToast("Asignada a ruta"); }}
                    className="flex-1 rounded-[18px] border border-amber-200 bg-amber-50 py-3.5 text-sm font-bold text-amber-800">Enviar a ruta</button>
                </div>
              )}
              {o.estatus === "Asignada" && (
                <button onClick={() => cobrar(o)} className="w-full mt-3 rounded-[18px] border border-emerald-200 bg-emerald-50 py-3.5 text-sm font-bold text-emerald-700">Cobrar entrega</button>
              )}
            </div>
          ))}
          {(tab === "ventas" ? pendientes : tab === "hoy" ? ordenesHoy : ordenesUsuario).length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">Sin órdenes</p>
          )}
        </div>
        <div className="h-8" />
      </div>

      {/* ═══ MODAL NUEVA VENTA ═══ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setModal(false)}>
          <div className="w-full max-w-lg rounded-t-[30px] border border-slate-200/80 bg-white p-5 max-h-[90vh] overflow-y-auto shadow-[0_30px_70px_rgba(22,18,15,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Comercial</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Nueva venta</h3>
            <div className="space-y-4">

              {/* ── CLIENTE ── */}
              {!nuevoCliente ? (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cliente</label>
                  <select value={form.clienteId} onChange={e => handleClientChange(e.target.value)}
                    className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm bg-white">
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{s(c.nombre)}{c.rfc && c.rfc !== "XAXX010101000" ? " · " + s(c.rfc) : ""}</option>)}
                  </select>
                  <button onClick={() => setNuevoCliente(true)} className="text-xs text-blue-600 font-bold mt-2">
                    + Registrar cliente nuevo
                  </button>
                </div>
              ) : (
                <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-bold text-blue-800">Nuevo cliente</h4>
                    <button onClick={() => setNuevoCliente(false)} className="text-xs text-blue-500">Cancelar</button>
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

                    {/* Factura toggle */}
                    <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-blue-200">
                      <div>
                        <p className="text-sm font-bold text-slate-800">¿Requiere factura?</p>
                        <p className="text-[10px] text-slate-400">Se pedirán datos fiscales</p>
                      </div>
                      <button onClick={() => setCliForm(f => ({ ...f, requiereFactura: !f.requiereFactura }))}
                        className={`w-12 h-7 rounded-full transition-all relative ${cliForm.requiereFactura ? "bg-blue-600" : "bg-slate-300"}`}>
                        <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${cliForm.requiereFactura ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </div>

                    {/* Datos fiscales (solo si requiere factura) */}
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

                    <button onClick={registrarCliente} disabled={!cliForm.nombre.trim() || (cliForm.requiereFactura && !cliForm.rfc.trim())}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm disabled:opacity-40">
                      Registrar cliente y continuar
                    </button>
                  </div>
                </div>
              )}

              {/* Show selected client info */}
              {form.clienteId && !nuevoCliente && (() => {
                const cli = (data.clientes || []).find(c => eqId(c.id, form.clienteId));
                if (!cli) return null;
                const tieneRfc = cli.rfc && cli.rfc !== "XAXX010101000";
                return (
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{s(cli.nombre)}</p>
                        <p className="text-xs text-slate-500">{tieneRfc ? s(cli.rfc) : "Sin RFC"} {cli.contacto && cli.contacto !== "—" ? " · " + s(cli.contacto) : ""}</p>
                      </div>
                      {n(cli.saldo) > 0 && <span className="min-w-[72px] rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white">Debe ${n(cli.saldo).toLocaleString()}</span>}
                    </div>
                    {/* Factura toggle for this order */}
                    {tieneRfc && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-200">
                        <span className="text-xs text-slate-600 font-semibold">Facturar esta venta</span>
                        <button onClick={() => setForm(f => ({ ...f, requiereFactura: !f.requiereFactura }))}
                          className={`w-10 h-6 rounded-full transition-all relative ${form.requiereFactura ? "bg-purple-600" : "bg-slate-300"}`}>
                          <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.requiereFactura ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── PRODUCTOS ── */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Productos</label>
                {lines.map((l, i) => (
                  <div key={i} className="mb-2">
                    <div className="flex items-center gap-2">
                      <select value={l.sku} onChange={e => updateLine(i, "sku", e.target.value)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                        <option value="">Producto...</option>
                        {prodTerminados.map(p => <option key={p.sku} value={s(p.sku)}>{s(p.nombre)} · ${getPrice(form.clienteId, s(p.sku))}</option>)}
                      </select>
                      <input type="number" min="1" value={l.qty} onChange={e => updateLine(i, "qty", parseInt(e.target.value) || 1)}
                        className="w-14 border border-slate-200 rounded-xl px-2 py-2.5 text-sm text-center" />
                      <span className="text-sm font-bold text-slate-600 w-16 text-right">${(n(l.qty) * n(l.precio)).toLocaleString()}</span>
                      {lines.length > 1 && <button onClick={() => removeLine(i)} className="text-red-400 text-lg w-6">×</button>}
                    </div>
                    {l.sku && <p className="text-[11px] text-slate-500 mt-1 ml-1">Stock: {getStock(l.sku).toLocaleString()} bolsas</p>}
                  </div>
                ))}
                <button onClick={addLine} className="text-xs text-blue-600 font-semibold">+ Agregar producto</button>
              </div>

              {/* ── TOTALES ── */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                <div className="flex justify-between text-base font-bold text-slate-800"><span>Total</span><span>${totalCalc.toLocaleString()}</span></div>
                <div className="flex justify-between text-xs text-slate-400"><span>IVA 0% (hielo)</span></div>
              </div>
            </div>

            <button onClick={crearOrden} disabled={!form.clienteId || !lines.some(l => l.sku)}
              className="w-full mt-4 rounded-[18px] bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:opacity-40">
              {form.requiereFactura ? "Crear venta con factura" : "Crear venta"}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL COBRO ═══ */}
      {pagoModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setPagoModal(null)}>
          <div className="w-full max-w-lg rounded-t-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_30px_70px_rgba(22,18,15,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Cobranza</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-1">Cobrar {s(pagoModal.folio)}</h3>
            <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} — <span className="font-bold text-slate-800">${n(pagoModal.total).toLocaleString()}</span>
              {pagoModal.requiereFactura && <span className="ml-2 text-xs bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded">FACTURA</span>}
            </p>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Método de pago</label>
            <div className="grid grid-cols-1 gap-2 mb-4 sm:grid-cols-2">
              {PAGOS.map(m => (
                <button key={m} onClick={() => setPagoForm(f => ({ ...f, metodo: m }))}
                  className={`py-3 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${pagoForm.metodo === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                  {m}
                </button>
              ))}
            </div>
            {pagoForm.metodo === "Transferencia SPEI" && (
              <div className="mb-4"><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Referencia</label>
                <input value={pagoForm.referencia} onChange={e => setPagoForm(f => ({ ...f, referencia: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Últimos 6 dígitos" /></div>
            )}

            {pagoForm.metodo === "QR / Link de pago" && checkoutUrl && (
              <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
                <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Hola, aquí está tu link de pago de Cubo Polar por $${n(pagoModal.total).toLocaleString()} MXN:\n${shortUrl || checkoutUrl}`)}`} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 Enviar por WhatsApp</a>
                </div>
                <button onClick={() => { setCheckoutUrl(null); setShortUrl(null); setPagoModal(null); }} className="w-full py-2 text-xs text-slate-500 font-semibold">Cerrar</button>
              </div>
            )}
            {pagoForm.metodo === "Crédito (fiado)" && (
              <div className="mb-4 p-3 bg-amber-50 rounded-xl"><p className="text-xs text-amber-700 font-semibold">Se agregará al saldo del cliente</p></div>
            )}
            {!checkoutUrl && <button onClick={confirmarCobro} disabled={generandoLink} className={`w-full py-3.5 text-white font-bold rounded-xl text-sm shadow-lg shadow-emerald-200 ${generandoLink ? 'bg-slate-400' : 'bg-emerald-600'}`}>{generandoLink ? 'Generando link…' : pagoForm.metodo === "QR / Link de pago" ? "Generar link de pago" : "Confirmar cobro"}</button>}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_32px_rgba(5,150,105,0.24)]" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
