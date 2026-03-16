import { useState, useMemo, useCallback, useEffect } from 'react';
import { s, n } from '../utils/safe';

const PAGOS = ["Efectivo", "Transferencia", "Tarjeta", "QR / Link de pago", "Crédito"];
const MERMA_CAUSAS = ["Bolsa rota", "Hielo derretido", "Daño transporte", "Rechazo cliente"];
const REGIMENES = ["Régimen General", "Régimen Simplificado", "Sin obligaciones"];
const USOS_CFDI = ["G01", "G03", "S01", "P01"];

export default function ChoferView({ user, data, actions, onLogout }) {
  const [step, setStep] = useState("cargar");
  const [confirmadoCarga, setConfirmadoCarga] = useState(false);
  const [entregas, setEntregas] = useState([]);
  const [mermas, setMermas] = useState([]);
  const [entregaModal, setEntregaModal] = useState(null);
  const [ventaModal, setVentaModal] = useState(false);
  const [mermaModal, setMermaModal] = useState(false);
  const [cobroMetodo, setCobroMetodo] = useState("Efectivo");
  const [cobroRef, setCobroRef] = useState("");
  const [checkoutProvider, setCheckoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [vForm, setVForm] = useState({ clienteId: "", cliente: "", sku: "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });
  const [mForm, setMForm] = useState({ sku: "", cant: "", causa: "Bolsa rota" });
  const [fotoMerma, setFotoMerma] = useState(null);
  const [fotoTransf, setFotoTransf] = useState(null);
  const [rutaCerrada, setRutaCerrada] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // ── READ REAL DATA FROM STORE ──
  const productos = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);
  const clientesActivos = useMemo(() => (data.clientes || []).filter(c => s(c.estatus || 'Activo') === 'Activo'), [data.clientes]);
  const clienteExpressSel = useMemo(() => (data.clientes || []).find(c => String(c.id) === String(vForm.clienteId)), [data.clientes, vForm.clienteId]);

  // Get price for a client+sku (special price or default)
  const getPrice = useCallback((clienteNombre, sku) => {
    const esp = data.preciosEsp?.find(p => {
      const cli = data.clientes.find(c => c.id === p.clienteId || String(c.id) === String(p.clienteId));
      return cli && s(cli.nombre) === clienteNombre && s(p.sku) === sku;
    });
    if (esp) return n(esp.precio);
    const prod = data.productos.find(p => s(p.sku) === sku);
    return prod ? n(prod.precio) : 0;
  }, [data.preciosEsp, data.clientes, data.productos]);

  // ── MI RUTA ACTIVA (asignada por administración) ──
  const miRutaActiva = useMemo(() => {
    const hoyStr = new Date().toISOString().slice(0, 10);
    return (data.rutas || []).find(r => {
      const choferId = r.choferId || r.chofer_id;
      const esDelChofer = choferId && (String(choferId) === String(user?.id) || s(r.choferNombre) === s(user?.nombre));
      const estatus = s(r.estatus).toLowerCase();
      const estaActiva = estatus === 'programada' || estatus === 'en progreso' || estatus === 'en_progreso';
      const esFechaHoy = !r.fecha || s(r.fecha).startsWith(hoyStr);
      return esDelChofer && estaActiva && esFechaHoy;
    }) || null;
  }, [data.rutas, user]);

  // Carga autorizada por administración (SOLO LECTURA)
  const cargaAutorizada = useMemo(() => {
    if (!miRutaActiva) return {};
    return miRutaActiva.carga_autorizada || miRutaActiva.cargaAutorizada || {};
  }, [miRutaActiva]);

  const extraAutorizado = useMemo(() => {
    if (!miRutaActiva) return {};
    return miRutaActiva.extra_autorizado || miRutaActiva.extraAutorizado || {};
  }, [miRutaActiva]);

  // Clientes asignados a la ruta (con info de contacto)
  const clientesAsignados = useMemo(() => {
    if (!miRutaActiva) return [];
    const asignados = miRutaActiva.clientes_asignados || miRutaActiva.clientesAsignados || [];
    if (!Array.isArray(asignados)) return [];
    return asignados.map((item, idx) => {
      const clienteId = item.clienteId || item;
      const cliente = (data.clientes || []).find(c => String(c.id) === String(clienteId));
      return {
        id: clienteId,
        orden: item.orden || idx + 1,
        nombre: cliente ? s(cliente.nombre) : `Cliente #${clienteId}`,
        contacto: cliente ? s(cliente.contacto) : "",
        correo: cliente ? s(cliente.correo) : "",
        tipo: cliente ? s(cliente.tipo) : "",
        calle: cliente ? s(cliente.calle) : "",
        colonia: cliente ? s(cliente.colonia) : "",
        ciudad: cliente ? s(cliente.ciudad) : "",
        latitud: cliente?.latitud,
        longitud: cliente?.longitud,
      };
    }).sort((a, b) => a.orden - b.orden);
  }, [miRutaActiva, data.clientes]);

  // Carga total = autorizada + extra (lo que administración aprobó)
  const cargaTotal = useMemo(() => {
    const t = {};
    for (const p of productos) {
      const sku = s(p.sku);
      t[sku] = n(cargaAutorizada[sku]) + n(extraAutorizado[sku]);
    }
    return t;
  }, [productos, cargaAutorizada, extraAutorizado]);

  // My route orders — only orders assigned to routes for THIS chofer
  const misOrdenes = useMemo(() => {
    if (!miRutaActiva) return [];
    return (data.ordenes || []).filter(o => {
      const est = s(o.estatus);
      if (est !== "Asignada" && est !== "Creada") return false;
      const rid = o.rutaId || o.ruta_id;
      return rid && (String(rid) === String(miRutaActiva.id));
    });
  }, [data.ordenes, miRutaActiva]);

  // Build order items with real prices
  const ordenesConDetalle = useMemo(() => {
    return misOrdenes.map(o => {
      const cli = data.clientes.find(c => String(c.id) === String(o.clienteId));
      const clienteNombre = cli ? s(cli.nombre) : s(o.cliente);
      // Parse productos string "25×HC-25K, 10×HC-5K" into items
      const items = [];
      const prodStr = s(o.productos);
      if (prodStr) {
        prodStr.split(",").forEach(part => {
          const match = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
          if (match) {
            const cant = parseInt(match[1]);
            const sku = match[2];
            const precio = getPrice(clienteNombre, sku);
            items.push({ sku, cant, precio });
          }
        });
      }
      const total = items.reduce((s, it) => s + it.cant * it.precio, 0);
      const entregada = entregas.some(e => String(e.ordenId) === String(o.id));
      return { ...o, clienteNombre, items, totalCalc: total || n(o.total), entregada };
    });
  }, [misOrdenes, data.clientes, entregas, getPrice]);

  const pendientes = ordenesConDetalle.filter(o => !o.entregada);
  const entregadasList = ordenesConDetalle.filter(o => o.entregada);

  // Necesita por SKU (for loading screen)
  const necesitaPorSku = useMemo(() => {
    const t = {};
    for (const p of productos) t[s(p.sku)] = 0;
    for (const o of pendientes) for (const it of o.items) t[it.sku] = (t[it.sku] || 0) + it.cant;
    return t;
  }, [pendientes, productos]);



  const entregadoTotal = useMemo(() => {
    const t = {};
    for (const p of productos) t[s(p.sku)] = 0;
    for (const e of entregas) for (const it of (e.items || [])) t[it.sku] = (t[it.sku] || 0) + n(it.cant);
    return t;
  }, [entregas, productos]);

  const mermaTotal = useMemo(() => {
    const t = {};
    for (const m of mermas) t[m.sku] = (t[m.sku] || 0) + n(m.cant);
    return t;
  }, [mermas]);

  const totalCobrado = useMemo(() => entregas.reduce((s, e) => s + (e.pago !== "Crédito" ? n(e.total) : 0), 0), [entregas]);
  const totalCredito = useMemo(() => entregas.reduce((s, e) => s + (e.pago === "Crédito" ? n(e.total) : 0), 0), [entregas]);

  // Remaining inventory (what chofer still has)
  const restante = useMemo(() => {
    const t = {};
    for (const p of productos) {
      const sku = s(p.sku);
      t[sku] = (cargaTotal[sku] || 0) - (entregadoTotal[sku] || 0) - (mermaTotal[sku] || 0);
    }
    return t;
  }, [productos, cargaTotal, entregadoTotal, mermaTotal]);

  // ── ACTIONS ──
  const iniciarRuta = () => {
    // Usa la carga autorizada por administración, no input del chofer
    if (!Object.values(cargaTotal).some(v => n(v) > 0)) {
      showToast("No hay carga autorizada. Contacte a administración.", "error");
      return;
    }
    setConfirmadoCarga(true);
    setStep("ruta");
    showToast("Carga confirmada. Ruta iniciada.");
  };

  const confirmarEntrega = async () => {
    if (!entregaModal) return;
    // QR / Link de pago → generate checkout
    if (cobroMetodo === "QR / Link de pago") {
      const result = await actions.crearCheckoutPago?.(entregaModal.id, checkoutProvider);
      if (result?.checkoutUrl) {
        setCheckoutUrl(result.checkoutUrl);
        setShortUrl(result.shortUrl || result.checkoutUrl);
        showToast('Link de pago generado');
      } else {
        showToast("Error al generar link de pago");
      }
      return;
    }
    const entrega = {
      ordenId: entregaModal.id,
      folio: s(entregaModal.folio),
      cliente: entregaModal.clienteNombre,
      items: entregaModal.items,
      total: entregaModal.totalCalc,
      pago: cobroMetodo,
      referencia: cobroRef,
      foto: cobroMetodo === "Transferencia" ? fotoTransf : null,
      hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
    };
    // Update order status in store
    const err = actions.updateOrdenEstatus
      ? await actions.updateOrdenEstatus(entregaModal.id, "Entregada", cobroMetodo)
      : null;
    if (err) {
      showToast("No se pudo registrar la entrega");
      return;
    }
    setEntregas(prev => [...prev, entrega]);
    showToast("Entregado a " + entrega.cliente);
    setEntregaModal(null);
    setFotoTransf(null);
  };

  const crearVentaExpress = () => {
    if (!vForm.cant || n(vForm.cant) <= 0) return;

    const clienteNombre = s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general";

    if (vForm.factura) {
      if (!clienteNombre.trim()) { showToast("Captura razón social para facturar"); return; }
      if (!vForm.rfc.trim()) { showToast("RFC requerido para factura"); return; }
      if (vForm.rfc.trim().length < 12 || vForm.rfc.trim().length > 13) { showToast("RFC debe tener 12-13 caracteres"); return; }
      if (!vForm.correo.trim()) { showToast("Correo requerido para factura"); return; }
      if (!vForm.regimen) { showToast("Selecciona régimen fiscal"); return; }
      if (!vForm.usoCfdi) { showToast("Selecciona uso CFDI"); return; }
      if (!vForm.cp.trim() || vForm.cp.trim().length !== 5) { showToast("CP fiscal debe tener 5 dígitos"); return; }
    }

    const sku = vForm.sku || s(productos[0]?.sku);
    // Check available inventory
    if (n(vForm.cant) > (restante[sku] || 0)) {
      showToast("No tienes suficiente — te quedan " + (restante[sku] || 0));
      return;
    }
    const precio = getPrice(clienteNombre, sku);
    const subtotal = n(vForm.cant) * precio;
    const iva = Math.round(subtotal * 16) / 100;
    const total = subtotal + iva;
    const venta = {
      id: Date.now(), folio: "EX-" + String(Date.now()).slice(-4),
      clienteId: vForm.clienteId || clienteExpressSel?.id || null,
      cliente: clienteNombre,
      items: [{ sku, cant: n(vForm.cant), precio }],
      subtotal, iva,
      total, pago: vForm.pago,
      hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
      express: true,
      factura: vForm.factura,
      rfc: vForm.factura ? vForm.rfc : "",
      correo: vForm.factura ? vForm.correo : "",
      regimen: vForm.factura ? vForm.regimen : "",
      usoCfdi: vForm.factura ? vForm.usoCfdi : "",
      cp: vForm.factura ? vForm.cp : "",
    };
    setEntregas(prev => [...prev, venta]);
    showToast("Venta exprés: $" + total.toLocaleString() + " (incluye IVA)" + (vForm.factura ? " (factura)" : ""));
    setVentaModal(false);
    setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });
  };

  const registrarMerma = () => {
    if (!mForm.cant || n(mForm.cant) <= 0 || !fotoMerma) return;
    // Validar que no exceda stock disponible
    const disponibleSku = disponible[mForm.sku] || 0;
    if (n(mForm.cant) > disponibleSku) {
      showToast(`Solo tienes ${disponibleSku} disponibles de ${mForm.sku}`, "error");
      return;
    }
    // Save to store with audit trail
    if (actions.registrarMerma) {
      actions.registrarMerma(mForm.sku, n(mForm.cant), mForm.causa, s(user?.nombre), fotoMerma);
    }
    setMermas(prev => [...prev, { ...mForm, id: Date.now(), cant: n(mForm.cant), foto: fotoMerma, hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) }]);
    showToast("Merma registrada");
    setMermaModal(false);
    setFotoMerma(null);
    setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" });
  };

  const cerrarRuta = async () => {
    // Save complete route report to store
    if (actions.cerrarRutaCompleta) {
      const cobrosPorMetodo = {};
      for (const e of entregas) cobrosPorMetodo[e.pago] = (cobrosPorMetodo[e.pago]||0) + n(e.total);
      await actions.cerrarRutaCompleta({
        rutaId: miRutaActiva?.id, // ID de la ruta activa
        choferId: user?.id,
        choferNombre: s(user?.nombre),
        entregas,
        mermas,
        carga: cargaTotal,
        cobros: cobrosPorMetodo,
      });
    }
    setRutaCerrada(true);
    showToast("Reporte enviado ✓");
  };

  // ═══ STEP 1: CARGAR ═══
  if (step === "cargar") return (
    <div className="min-h-screen bg-slate-50 max-w-[640px] mx-auto w-full">
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 pb-6" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-4">
          <div><h1 className="text-lg font-extrabold">CUBOPOLAR</h1><p className="text-xs text-blue-100">{s(user?.nombre)}</p></div>
          <button onClick={onLogout} className="text-xs bg-white/20 px-3 py-1.5 rounded-lg font-semibold">Salir</button>
        </div>
        <div className="bg-white/10 rounded-2xl p-4">
          <p className="text-sm font-bold text-blue-100 mb-1">Paso 1 de 3</p>
          <h2 className="text-xl font-extrabold">¿Cuánto llevas?</h2>
          <p className="text-xs text-blue-200 mt-1">Registra las bolsas que cargas al camión</p>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-3">
        <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
          <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">Tu ruta — {pendientes.length} entregas</h3>
          {productos.filter(p => necesitaPorSku[s(p.sku)] > 0).map(p => (
            <div key={p.sku} className="flex justify-between text-sm">
              <span className="text-slate-600">{s(p.nombre)}</span>
              <span className="font-bold text-blue-700">{necesitaPorSku[s(p.sku)]} necesarias</span>
            </div>
          ))}
          {pendientes.length === 0 && <p className="text-xs text-blue-400">No hay órdenes asignadas</p>}
          <p className="text-xs text-blue-500 mt-2">Carga extra para ventas en el camino</p>
        </div>

        {/* Clientes asignados a visitar */}
        {clientesAsignados.length > 0 && (
          <div className="bg-purple-50 rounded-2xl p-4 border border-purple-200">
            <h3 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-3">
              📍 Clientes a visitar ({clientesAsignados.length})
            </h3>
            <div className="space-y-2">
              {clientesAsignados.map((c, idx) => (
                <div key={c.id} className="bg-white rounded-xl p-3 border border-purple-100 flex items-center gap-3">
                  <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{c.nombre}</p>
                    {c.contacto && (
                      <a href={`tel:${c.contacto.replace(/\D/g, '')}`} className="text-xs text-purple-600 flex items-center gap-1">
                        📞 {c.contacto}
                      </a>
                    )}
                  </div>
                  {c.contacto && (
                    <a href={`tel:${c.contacto.replace(/\D/g, '')}`} 
                       className="px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg">
                      Llamar
                    </a>
                  )}
                  {c.latitud && c.longitud && (
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitud},${c.longitud}`}
                       target="_blank" rel="noopener noreferrer"
                       className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg">
                      🗺️ Maps
                    </a>
                  )}
                </div>
              ))}
            </div>
            {/* Botón ver ruta completa en Maps */}
            {clientesAsignados.filter(c => c.latitud && c.longitud).length >= 2 && (
              <a href={(() => {
                const coords = clientesAsignados.filter(c => c.latitud && c.longitud);
                if (coords.length < 2) return '#';
                const dest = coords[coords.length - 1];
                const waypoints = coords.slice(0, -1).map(c => `${c.latitud},${c.longitud}`).join('|');
                return `https://www.google.com/maps/dir/?api=1&destination=${dest.latitud},${dest.longitud}&waypoints=${waypoints}`;
              })()}
                 target="_blank" rel="noopener noreferrer"
                 className="mt-3 block w-full text-center py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors">
                🗺️ Ver ruta completa en Maps
              </a>
            )}
          </div>
        )}

        {productos.map(p => (
          <div key={p.sku} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">{s(p.nombre)}</p>
                <p className="text-xs text-slate-400">${n(p.precio)} c/u</p>
                {necesitaPorSku[s(p.sku)] > 0 && <p className="text-xs text-blue-600 font-semibold mt-0.5">Pedidos: {necesitaPorSku[s(p.sku)]}</p>}
              </div>
              {/* Cantidad autorizada por administración (SOLO LECTURA) */}
              <div className="text-center">
                <div className="w-24 text-center text-2xl font-extrabold bg-slate-100 rounded-xl py-3 text-slate-700">
                  {n(cargaTotal[s(p.sku)])}
                </div>
                <p className="text-xs text-green-600 font-medium mt-1">Autorizado</p>
              </div>
            </div>
            {n(cargaAutorizada[s(p.sku)]) > 0 && n(extraAutorizado[s(p.sku)]) > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                {n(cargaAutorizada[s(p.sku)])} pedidos + {n(extraAutorizado[s(p.sku)])} extra
              </p>
            )}
            {n(cargaTotal[s(p.sku)]) > 0 && n(cargaTotal[s(p.sku)]) < (necesitaPorSku[s(p.sku)] || 0) && (
              <p className="text-xs text-amber-600 font-semibold mt-2">⚠ Autorizado menos de lo pedido</p>
            )}
          </div>
        ))}
        <button onClick={iniciarRuta} disabled={!miRutaActiva || !Object.values(cargaTotal).some(v => n(v) > 0)}
          className="w-full py-5 bg-blue-600 text-white font-extrabold rounded-2xl text-lg shadow-lg shadow-blue-200 disabled:opacity-40 active:scale-[0.98] transition-transform mt-4">
          {miRutaActiva ? "Confirmar carga e iniciar ruta →" : "Sin ruta asignada"}
        </button>
        {!miRutaActiva && (
          <p className="text-center text-sm text-amber-600 font-medium mt-2">
            No tienes una ruta asignada para hoy. Contacta a administración.
          </p>
        )}
      </div>
      {toast && <Toast msg={toast} />}
    </div>
  );

  // ═══ STEP 2: RUTA ═══
  if (step === "ruta") return (
    <div className="min-h-screen bg-slate-50 max-w-[640px] mx-auto w-full" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 pb-4" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-base font-extrabold">🚚 En ruta</h1><p className="text-xs text-blue-100">{s(user?.nombre)}</p></div>
          <div className="text-right"><p className="text-lg font-extrabold">${totalCobrado.toLocaleString()}</p><p className="text-xs text-blue-200">cobrado</p></div>
        </div>
        <div className="bg-white/10 rounded-xl p-2.5 flex items-center gap-3">
          <div className="flex-1"><div className="h-2 bg-white/20 rounded-full overflow-hidden"><div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${ordenesConDetalle.length > 0 ? (entregadasList.length / ordenesConDetalle.length) * 100 : 0}%` }} /></div></div>
          <span className="text-sm font-bold">{entregadasList.length}/{ordenesConDetalle.length}</span>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-3">
        {pendientes.length > 0 && <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Por entregar ({pendientes.length})</h3>
          {pendientes.map(o => (
            <div key={o.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm mb-2">
              <div className="flex justify-between items-start mb-2">
                <div><span className="font-mono text-xs text-slate-400">#{s(o.folio)}</span><p className="text-base font-bold text-slate-800">{o.clienteNombre}</p></div>
                <p className="text-lg font-extrabold text-slate-800">${o.totalCalc.toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {o.items.map((it, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{it.cant}× {it.sku} · ${it.precio}</span>)}
              </div>
              <button onClick={() => { setEntregaModal(o); setCobroMetodo("Efectivo"); setCobroRef(""); setCheckoutUrl(null); setShortUrl(null); }}
                className="w-full py-3.5 bg-emerald-600 text-white font-bold rounded-xl text-sm active:scale-[0.98] transition-transform shadow-sm">
                Entregar y cobrar
              </button>
            </div>
          ))}
        </div>}
        {entregas.length > 0 && <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Entregadas ({entregas.length})</h3>
          {entregas.map(e => (
            <div key={e.ordenId || e.id} className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-2">
              <div className="flex justify-between items-center">
                <div><span className="font-mono text-xs text-emerald-600">#{s(e.folio)}</span><span className="text-sm font-semibold text-slate-700 ml-2">{s(e.cliente)}</span>{e.express && <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded ml-1">Exprés</span>}{e.factura && <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded ml-1">Factura</span>}</div>
                <div className="text-right"><p className="text-sm font-bold">${n(e.total).toLocaleString()}</p><p className="text-[10px] text-slate-400">{e.pago} · {e.hora}</p></div>
              </div>
            </div>
          ))}
        </div>}
        {mermas.length > 0 && <div>
          <h3 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2">Mermas</h3>
          {mermas.map(m => (<div key={m.id} className="bg-amber-50 rounded-xl p-3 border border-amber-200 mb-2"><div className="flex justify-between text-xs"><span className="font-semibold">{m.cant}× {m.sku}</span><span className="text-amber-600">{m.causa}</span></div></div>))}
        </div>}
        <div className="h-20" />
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[640px] bg-white border-t border-slate-200 px-4 py-3 flex gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        <button onClick={() => { setVentaModal(true); setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" }); }} className="flex-1 py-4 bg-emerald-600 text-white text-sm font-bold rounded-xl">+ Venta</button>
        <button onClick={() => { setMermaModal(true); setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" }); }} className="py-4 px-5 bg-amber-100 text-amber-700 text-sm font-bold rounded-xl">⚠️ Merma</button>
        <button onClick={() => setStep("cierre")} className="py-4 px-5 bg-slate-700 text-white text-sm font-bold rounded-xl">🏁 Cerrar ruta</button>
      </div>

      {/* Modal cobro */}
      {entregaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setEntregaModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800">Entregar a {entregaModal.clienteNombre}</h3>
            <div className="flex flex-wrap gap-1 my-3">{entregaModal.items.map((it, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{it.cant}× {it.sku} · ${it.precio}</span>)}</div>
            <p className="text-3xl font-extrabold text-slate-800 mb-4">${entregaModal.totalCalc.toLocaleString()}</p>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">¿Cómo paga?</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {PAGOS.map(m => <button key={m} onClick={() => setCobroMetodo(m)} className={`py-3.5 rounded-xl text-sm font-bold border-2 transition-all ${cobroMetodo===m?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600"}`}>{m==="Efectivo"?"💵 Efectivo":m==="Transferencia"?"📱 Transferencia":m==="Tarjeta"?"💳 Tarjeta":m==="QR / Link de pago"?"🔗 QR / Link":"📋 Crédito"}</button>)}
            </div>
            {cobroMetodo==="Transferencia" && <div className="mb-4 space-y-2">
              <input value={cobroRef} onChange={e=>setCobroRef(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Referencia (últimos 6 dígitos)" />
              {fotoTransf ? (
                <div><img src={fotoTransf} alt="Comprobante" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoTransf(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
              ) : (
                <label className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                  <span className="text-lg">📷</span> Foto del comprobante
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(f){const r=new FileReader();r.onload=ev=>setFotoTransf(ev.target.result);r.readAsDataURL(f)}}} />
                </label>
              )}
            </div>}
            {cobroMetodo==="QR / Link de pago" && (
              <div className="mb-4 p-3 bg-blue-50 rounded-xl">
                <p className="text-xs text-blue-700 font-semibold mb-2">Proveedor de checkout</p>
                <div className="grid grid-cols-2 gap-2">
                  {[{ value: 'stripe', label: '💳 Stripe' }, { value: 'mercadopago', label: '🟢 Mercado Pago' }].map(opt => (
                    <button key={opt.value} onClick={() => setCheckoutProvider(opt.value)}
                      className={`py-2.5 px-3 rounded-lg text-xs font-bold border-2 ${checkoutProvider === opt.value ? 'border-blue-500 bg-white text-blue-700' : 'border-blue-100 text-blue-600'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-blue-600 mt-2">Se abre un link para que el cliente pague.</p>
              </div>
            )}
            {cobroMetodo==="QR / Link de pago" && checkoutUrl && (
              <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
                <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Hola, aquí está tu link de pago de Cubo Polar por $${entregaModal.totalCalc.toLocaleString()} MXN:\n${shortUrl || checkoutUrl}`)}`} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 WhatsApp</a>
                </div>
                <button onClick={() => { setCheckoutUrl(null); setShortUrl(null); setEntregaModal(null); }} className="w-full py-2 text-xs text-slate-500 font-semibold">Cerrar</button>
              </div>
            )}
            {cobroMetodo==="Crédito" && <div className="bg-amber-50 rounded-xl p-3 mb-4"><p className="text-xs text-amber-700 font-semibold">Se agrega a la cuenta del cliente</p></div>}
            {!checkoutUrl && <button onClick={confirmarEntrega} className="w-full py-4 bg-emerald-600 text-white font-extrabold rounded-xl text-base shadow-lg shadow-emerald-200 active:scale-[0.98] transition-transform">{cobroMetodo === "QR / Link de pago" ? "Generar link de pago" : "✓ Confirmar entrega"}</button>}
          </div>
        </div>
      )}

      {/* Modal venta express */}
      {ventaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setVentaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">Venta exprés</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cliente de lista</label>
                <select value={vForm.clienteId} onChange={e => {
                  const id = e.target.value;
                  const cli = clientesActivos.find(c => String(c.id) === String(id));
                  setVForm(f => ({ ...f, clienteId: id, cliente: id ? s(cli?.nombre) : f.cliente }));
                }} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
                  <option value="">Seleccionar cliente...</option>
                  {clientesActivos.map(c => <option key={c.id} value={c.id}>{s(c.nombre)}</option>)}
                </select>
              </div>
              <input value={vForm.cliente} onChange={e => setVForm(f=>({...f,cliente:e.target.value}))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Nombre del cliente" />
              {/* Factura toggle */}
              <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div><p className="text-sm font-semibold text-slate-700">¿Necesita factura?</p><p className="text-[10px] text-slate-400">Capturar datos fiscales completos</p></div>
                <button onClick={() => setVForm(f=>({...f,factura:!f.factura}))}
                  className={`w-12 h-7 rounded-full transition-all relative ${vForm.factura ? "bg-purple-600" : "bg-slate-300"}`}>
                  <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${vForm.factura ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              {vForm.factura && (
                <div className="bg-purple-50 rounded-xl p-3 border border-purple-200 space-y-2">
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">Razón social *</label>
                    <input value={vForm.cliente} onChange={e => setVForm(f=>({...f,cliente:e.target.value}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm bg-white" placeholder="Nombre o razón social" /></div>
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">RFC *</label>
                    <input value={vForm.rfc} onChange={e => setVForm(f=>({...f,rfc:e.target.value.toUpperCase()}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm font-mono bg-white" placeholder="XAXX010101000" maxLength={13} /></div>
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">Régimen fiscal *</label>
                    <select value={vForm.regimen} onChange={e => setVForm(f=>({...f,regimen:e.target.value}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm bg-white">{REGIMENES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">Uso CFDI *</label>
                    <select value={vForm.usoCfdi} onChange={e => setVForm(f=>({...f,usoCfdi:e.target.value}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm bg-white">{USOS_CFDI.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">CP fiscal *</label>
                    <input value={vForm.cp} onChange={e => setVForm(f=>({...f,cp:e.target.value.replace(/\D/g, "").slice(0,5)}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm bg-white" placeholder="34000" maxLength={5} /></div>
                  <div><label className="block text-[10px] font-bold text-purple-600 uppercase mb-0.5">Correo para factura</label>
                    <input value={vForm.correo} onChange={e => setVForm(f=>({...f,correo:e.target.value}))}
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-sm bg-white" placeholder="correo@ejemplo.com" type="email" /></div>
                </div>
              )}
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-2 gap-2">{productos.map(p => {
                  const sku = s(p.sku);
                  const disp = restante[sku] || 0;
                  return <button key={sku} onClick={() => setVForm(f=>({...f,sku}))} className={`py-2.5 rounded-xl text-xs font-bold border-2 ${vForm.sku===sku?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600"}`}>
                    {s(p.nombre)}<br/><span className="text-[10px] text-slate-400">${n(p.precio)} · quedan {disp}</span>
                  </button>;
                })}</div>
              </div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" inputMode="numeric" value={vForm.cant} onChange={e => setVForm(f=>({...f,cant:e.target.value}))} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-2xl font-extrabold text-center" placeholder="0" autoFocus />
                {vForm.cant && n(vForm.cant) > (restante[vForm.sku] || 0) && <p className="text-xs text-red-600 font-semibold mt-1">⚠ Solo te quedan {restante[vForm.sku] || 0}</p>}
              </div>
              {vForm.cant && n(vForm.cant) > 0 && n(vForm.cant) <= (restante[vForm.sku] || 0) && (
                <div className="bg-blue-50 rounded-xl p-3 text-center space-y-0.5">
                  <p className="text-xs text-slate-500">Subtotal: ${(n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">IVA 16%: ${((Math.round((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) * 16) / 100)).toLocaleString()}</p>
                  <p className="text-2xl font-extrabold text-slate-800">${((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) + (Math.round((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) * 16) / 100)).toLocaleString()}</p>
                </div>
              )}
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pago</label>
                <div className="grid grid-cols-3 gap-1.5">{PAGOS.map(m => <button key={m} onClick={() => setVForm(f=>({...f,pago:m}))} className={`py-2 rounded-lg text-[11px] font-bold border-2 ${vForm.pago===m?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-500"}`}>{m==="QR / Link de pago"?"🔗 QR/Link":m}</button>)}</div>
              </div>
              {vForm.pago === "QR / Link de pago" && (
                <div className="p-3 bg-blue-50 rounded-xl">
                  <p className="text-xs text-blue-700 font-semibold mb-2">Proveedor</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ value: 'stripe', label: '💳 Stripe' }, { value: 'mercadopago', label: '🟢 Mercado Pago' }].map(opt => (
                      <button key={opt.value} onClick={() => setCheckoutProvider(opt.value)}
                        className={`py-2 px-3 rounded-lg text-xs font-bold border-2 ${checkoutProvider === opt.value ? 'border-blue-500 bg-white text-blue-700' : 'border-blue-100 text-blue-600'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={crearVentaExpress} disabled={!vForm.cant||n(vForm.cant)<=0||n(vForm.cant)>(restante[vForm.sku]||0)||(vForm.factura&&(!vForm.cliente.trim()||!vForm.rfc.trim()||!vForm.correo.trim()||!vForm.regimen||!vForm.usoCfdi||vForm.cp.trim().length!==5||vForm.rfc.trim().length<12||vForm.rfc.trim().length>13))} className="w-full py-4 bg-emerald-600 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40">{vForm.factura ? "Crear venta con factura" : "Crear venta"}</button>
          </div>
        </div>
      )}

      {/* Modal merma */}
      {mermaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setMermaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-slate-800 mb-4">Registrar merma</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">{productos.map(p => <button key={p.sku} onClick={() => setMForm(f=>({...f,sku:s(p.sku)}))} className={`py-2.5 rounded-xl text-xs font-bold border-2 ${mForm.sku===s(p.sku)?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-600"}`}>{s(p.nombre)}</button>)}</div>
              <input type="number" value={mForm.cant} onChange={e => setMForm(f=>({...f,cant:e.target.value}))} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" />
              <div className="grid grid-cols-2 gap-2">{MERMA_CAUSAS.map(c => <button key={c} onClick={() => setMForm(f=>({...f,causa:c}))} className={`py-2 rounded-xl text-xs font-semibold border-2 ${mForm.causa===c?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-500"}`}>{c}</button>)}</div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Evidencia (foto) *</label>
              {fotoMerma ? (
                <div className="mb-3"><img src={fotoMerma} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoMerma(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
              ) : (
                <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer mb-3">
                  <span className="text-lg">📷</span> Tomar foto de evidencia
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(f){const r=new FileReader();r.onload=ev=>setFotoMerma(ev.target.result);r.readAsDataURL(f)}}} />
                </label>
              )}
            </div>
            <button onClick={registrarMerma} disabled={!mForm.cant||n(mForm.cant)<=0||!fotoMerma} className="w-full py-3.5 bg-amber-600 text-white font-bold rounded-xl text-sm disabled:opacity-40">Registrar merma</button>
          </div>
        </div>
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );

  // ═══ STEP 3: CIERRE ═══
  if (step === "cierre") {
    const devuelto = {};
    for (const p of productos) { const sku = s(p.sku); devuelto[sku] = (cargaTotal[sku]||0) - (entregadoTotal[sku]||0) - (mermaTotal[sku]||0); }
    const cobrosPorMetodo = {};
    for (const e of entregas) cobrosPorMetodo[e.pago] = (cobrosPorMetodo[e.pago]||0) + n(e.total);

    return (
      <div className="min-h-screen bg-slate-50 max-w-[640px] mx-auto w-full">
        <div className="bg-gradient-to-r from-slate-700 to-slate-900 text-white px-4 pb-4" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
          <div className="flex items-center justify-between">
            <div><h1 className="text-lg font-extrabold">Cierre de ruta</h1><p className="text-xs text-slate-300">{s(user?.nombre)} · {new Date().toLocaleDateString("es-MX")}</p></div>
            {!rutaCerrada && <button onClick={() => setStep("ruta")} className="text-xs bg-white/20 px-3 py-1.5 rounded-lg">← Volver</button>}
          </div>
        </div>
        <div className="px-4 pt-4 space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Cuadre de bolsas</h3>
            <div className="grid grid-cols-4 gap-1 text-[10px] font-bold text-slate-400 uppercase mb-1"><span>Producto</span><span className="text-center">Cargó</span><span className="text-center">Salió</span><span className="text-center">Devuelve</span></div>
            {productos.filter(p => cargaTotal[s(p.sku)] > 0).map(p => { const sku = s(p.sku); return (
              <div key={sku} className="grid grid-cols-4 gap-1 text-sm items-center py-1">
                <span className="font-semibold text-slate-700 text-xs">{s(p.nombre)}</span>
                <span className="text-center text-slate-500">{cargaTotal[sku]}</span>
                <span className="text-center text-slate-500">{(entregadoTotal[sku]||0)+(mermaTotal[sku]||0)}</span>
                <span className={`text-center font-bold ${devuelto[sku]===0?"text-emerald-600":devuelto[sku]>0?"text-blue-600":"text-red-600"}`}>{devuelto[sku]}</span>
              </div>
            );})}
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Cobros</h3>
            {Object.entries(cobrosPorMetodo).map(([m, v]) => <div key={m} className="flex justify-between text-sm py-0.5"><span className="text-slate-500">{m}</span><span className="font-bold">${v.toLocaleString()}</span></div>)}
            <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between"><span className="text-sm font-bold text-slate-700">Efectivo a entregar</span><span className="text-xl font-extrabold text-emerald-600">${(cobrosPorMetodo["Efectivo"]||0).toLocaleString()}</span></div>
            {totalCredito > 0 && <div className="flex justify-between text-sm mt-1"><span className="text-amber-600 font-semibold">Crédito</span><span className="font-bold text-amber-600">${totalCredito.toLocaleString()}</span></div>}
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Detalle ({entregas.length})</h3>
            {entregas.map(e => (
              <div key={e.ordenId||e.id} className="flex justify-between text-xs items-center py-1.5 border-b border-slate-50">
                <div><span className="font-mono text-slate-400">#{s(e.folio)}</span><span className="ml-1.5 text-slate-700 font-semibold">{s(e.cliente)}</span></div>
                <div className="text-right"><span className="font-bold">${n(e.total).toLocaleString()}</span><span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${e.pago==="Crédito"?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-500"}`}>{e.pago}</span></div>
              </div>
            ))}
          </div>
          {mermas.length > 0 && <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">Mermas</h3>
            {mermas.map(m => <div key={m.id} className="flex justify-between text-xs py-1"><span>{m.cant}× {m.sku}</span><span className="text-amber-600">{m.causa}</span></div>)}
          </div>}
          {pendientes.length > 0 && <div className="bg-red-50 rounded-xl p-3 border border-red-200"><p className="text-xs text-red-600 font-bold">⚠ {pendientes.length} órdenes sin entregar</p></div>}

          {!rutaCerrada ? (
            <button onClick={cerrarRuta} className="w-full py-4 bg-slate-800 text-white font-extrabold rounded-2xl text-base shadow-lg active:scale-[0.98] transition-transform">Cerrar ruta y enviar reporte</button>
          ) : (
            <div className="text-center space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <p className="text-2xl mb-2">✓</p>
                <p className="text-base font-bold text-emerald-700">Reporte enviado</p>
                <p className="text-xs text-emerald-600 mt-1">Ruta cerrada correctamente</p>
              </div>
              <button onClick={onLogout} className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-2xl text-base shadow-lg active:scale-[0.98] transition-transform">Cerrar sesión</button>
            </div>
          )}
          <div className="h-8" />
        </div>
        {toast && <Toast msg={toast} />}
      </div>
    );
  }
  return null;
}

function Toast({ msg }) {
  return <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }}>{msg}</div>;
}
