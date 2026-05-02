import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { s, n, fmtMoney, fmtDate, extraerTelefono } from '../utils/safe';
import { supabase } from '../lib/supabase';
import { abrirNavegacion } from '../utils/navegacion';
import { compressImage } from '../utils/compressImage';
import { MOTIVOS_NO_ENTREGA } from '../data/ordenLogic';
import { EmptyState } from './ui/Skeleton';
const MapaRuta = lazy(() => import('./ui/MapaRuta'));

const PAGOS = ["Efectivo", "Transferencia", "Tarjeta", "QR / Link de pago", "Crédito"];
const MERMA_CAUSAS = ["Bolsa rota", "Hielo derretido", "Daño transporte", "Rechazo cliente"];
const REGIMENES = ["Régimen General", "Régimen Simplificado", "Sin obligaciones"];
const USOS_CFDI = ["G01", "G03", "S01", "P01"];
const CHOFER_SHELL = "min-h-screen w-full max-w-[640px] mx-auto bg-[linear-gradient(180deg,#edf4f6_0%,#e3eef1_100%)] text-slate-900 md:max-w-3xl lg:max-w-5xl";

export default function ChoferView({ user, data, actions, onLogout }) {
  const [stepOverride, setStepOverride] = useState(null);

  // Fase 18 paso 3: Carga real + firma
  const [cargaRealForm, setCargaRealForm] = useState({});
  const [solicitandoFirma, setSolicitandoFirma] = useState(false);
  const [firmaModal, setFirmaModal] = useState(false);
  const [excepcionModal, setExcepcionModal] = useState(false);
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [tiempoEsperaSegs, setTiempoEsperaSegs] = useState(0);
  const firmaCanvasRef = useRef(null);
  const firmaContextRef = useRef(null);
  const [firmaDibujando, setFirmaDibujando] = useState(false);
  const [firmaTienePuntos, setFirmaTienePuntos] = useState(false);
  const [mapaVisible, setMapaVisible] = useState(false);
  const [entregas, setEntregas] = useState([]);
  const [mermas, setMermas] = useState([]);
  const [entregaModal, setEntregaModal] = useState(null);
  const [ventaModal, setVentaModal] = useState(false);
  const [mermaModal, setMermaModal] = useState(false);
  const [cobroMetodo, setCobroMetodo] = useState("Efectivo");
  const [cobroRef, setCobroRef] = useState("");
  const [checkoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false);
  const [creandoVenta, setCreandoVenta] = useState(false);
  const [registrandoMerma, setRegistrandoMerma] = useState(false);
  const [vForm, setVForm] = useState({ clienteId: "", cliente: "", sku: "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });
  const [mForm, setMForm] = useState({ sku: "", cant: "", causa: "Bolsa rota" });
  const [fotoMerma, setFotoMerma] = useState(null);
  const [fotoTransf, setFotoTransf] = useState(null);
  const [fotoEntrega, setFotoEntrega] = useState(null);
  const [folioNota, setFolioNota] = useState("");
  const [rutaCerrada, setRutaCerrada] = useState(false);
  const [cerrandoRuta, setCerrandoRuta] = useState(false);
  const [enviandoFirma, setEnviandoFirma] = useState(false);
  const [noEntregaModal, setNoEntregaModal] = useState(null); // orden o null
  const [noEntregaForm, setNoEntregaForm] = useState({ motivo: MOTIVOS_NO_ENTREGA[0], otroMotivo: '', reagendar: true });
  const [marcandoNoEntrega, setMarcandoNoEntrega] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Handler compartido: comprime cliente-side, valida 5MB como red de
  // seguridad, y guarda el dataURL en el setter recibido.
  const handleImagePick = (setter) => async (e) => {
    const original = e.target.files?.[0];
    if (!original) return;
    if (original.size > 2 * 1024 * 1024) showToast('Procesando foto…');
    const file = await compressImage(original);
    if (file.size > 5 * 1024 * 1024) {
      showToast('Foto muy grande, máx 5MB');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setter(ev.target.result);
    reader.readAsDataURL(file);
  };

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
  const isAdminPreview = user?.rol === 'Admin';
  const miRutaActiva = useMemo(() => {
    const hoyStr = new Date().toISOString().slice(0, 10);
    return (data.rutas || []).find(r => {
      const estatus = s(r.estatus).toLowerCase();
      const estaActiva = estatus === 'programada' || estatus === 'en progreso' || estatus === 'en_progreso' || estatus === 'pendiente firma' || estatus === 'cargada';
      const esFechaHoy = !r.fecha || s(r.fecha).startsWith(hoyStr);
      if (!estaActiva || !esFechaHoy) return false;
      // Admin preview: mostrar primera ruta activa (sin filtrar por chofer)
      if (isAdminPreview) return true;
      const choferId = r.choferId || r.chofer_id;
      return choferId && (String(choferId) === String(user?.id) || s(r.choferNombre) === s(user?.nombre));
    }) || null;
  }, [data.rutas, user, isAdminPreview]);

  // Derivar step desde el estado real de la ruta — si ya está "En progreso" saltar directo a ruta
  const rutaEnProgreso = miRutaActiva && (s(miRutaActiva.estatus).toLowerCase() === 'en progreso' || s(miRutaActiva.estatus).toLowerCase() === 'en_progreso');
  const rutaPendienteFirma = miRutaActiva && s(miRutaActiva.estatus).toLowerCase() === 'pendiente firma';
  const rutaCargada = miRutaActiva && s(miRutaActiva.estatus).toLowerCase() === 'cargada';
  const step = stepOverride ?? (rutaEnProgreso ? 'ruta' : (rutaPendienteFirma ? 'esperando-firma' : (rutaCargada ? 'cargada' : 'cargar')));
  const setStep = (v) => setStepOverride(v);

  // Carga autorizada por administración (SOLO LECTURA)
  const cargaAutorizada = useMemo(() => {
    if (!miRutaActiva) return {};
    return miRutaActiva.carga_autorizada || miRutaActiva.cargaAutorizada || {};
  }, [miRutaActiva]);

  const extraAutorizado = useMemo(() => {
    if (!miRutaActiva) return {};
    return miRutaActiva.extra_autorizado || miRutaActiva.extraAutorizado || {};
  }, [miRutaActiva]);

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
      if (!["Asignada","Creada","Entregada"].includes(est)) return false;
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
      const entregada = s(o.estatus) === 'Entregada' || entregas.some(e => String(e.ordenId) === String(o.id));
      const direccionCustom = s(o.direccion_entrega || o.direccionEntrega || '');
      const direccionCliente = cli ? [s(cli.calle), s(cli.colonia), s(cli.ciudad)].filter(Boolean).join(', ') : '';
      const direccion = direccionCustom || direccionCliente;
      const referencia = s(o.referencia_entrega || o.referenciaEntrega || '');
      // Coords: si la orden trae custom (lat/lng_entrega), úsalas; fallback al cliente.
      const ordLat = o.latitud_entrega ?? o.latitudEntrega;
      const ordLng = o.longitud_entrega ?? o.longitudEntrega;
      const latitud = (ordLat !== null && ordLat !== undefined && ordLat !== '') ? Number(ordLat) : cli?.latitud;
      const longitud = (ordLng !== null && ordLng !== undefined && ordLng !== '') ? Number(ordLng) : cli?.longitud;
      const esCredito = s(o.tipo_cobro || o.tipoCobro) === 'Credito';
      const contacto = s(cli?.contacto || '');
      const nombreComercial = s(cli?.nombre_comercial || cli?.nombreComercial || '');
      return { ...o, clienteNombre, items, totalCalc: total || n(o.total), entregada,
        latitud, longitud, direccion, referencia, esCredito,
        contacto, nombreComercial };
    });
  }, [misOrdenes, data.clientes, entregas, getPrice]);

  // Sync entregas from DB on load (so reloads don't lose delivered orders)
  useEffect(() => {
    const dbEntregas = ordenesConDetalle
      .filter(o => s(o.estatus) === 'Entregada')
      .map(o => ({
        ordenId: o.id,
        folio: s(o.folio),
        cliente: o.clienteNombre,
        items: o.items,
        total: o.totalCalc,
        pago: s(o.metodo_pago) || s(o.metodoPago) || 'Efectivo',
        hora: '',
      }));
    if (dbEntregas.length > 0) {
      setEntregas(prev => {
        // Merge: keep local entries not in DB, add DB entries
        const dbIds = new Set(dbEntregas.map(e => String(e.ordenId)));
        const localOnly = prev.filter(e => e.ordenId && !dbIds.has(String(e.ordenId)));
        return [...dbEntregas, ...localOnly];
      });
    }
  }, [ordenesConDetalle]);

  // Load mermas from localStorage on mount (persist across reloads)
  useEffect(() => {
    if (miRutaActiva?.id) {
      const saved = localStorage.getItem('mermas_ruta_' + miRutaActiva.id);
      if (saved) {
        try {
          setMermas(JSON.parse(saved));
        } catch (e) {
          console.warn('No se pudieron cargar mermas guardadas:', e);
          showToast('Mermas guardadas no se pudieron recuperar. Por favor regístralas de nuevo.');
          localStorage.removeItem('mermas_ruta_' + miRutaActiva.id);
        }
      }
    }
  }, [miRutaActiva?.id]);

  // Inicializar cargaRealForm con los máximos autorizados
  useEffect(() => {
    if (miRutaActiva && Object.keys(cargaTotal).length > 0) {
      const inicial = {};
      for (const [sku, qty] of Object.entries(cargaTotal)) {
        inicial[sku] = String(n(qty));
      }
      setCargaRealForm(inicial);
    }
  }, [miRutaActiva?.id]);

  // Timer para fallbacks (15 min admin remoto, 30 min excepción)
  useEffect(() => {
    if (step !== 'esperando-firma' || !miRutaActiva?.carga_solicitada_at) {
      setTiempoEsperaSegs(0);
      return;
    }
    const calcular = () => {
      const inicio = new Date(miRutaActiva.carga_solicitada_at).getTime();
      const ahora = Date.now();
      setTiempoEsperaSegs(Math.floor((ahora - inicio) / 1000));
    };
    calcular();
    const interval = setInterval(calcular, 1000);
    return () => clearInterval(interval);
  }, [step, miRutaActiva?.carga_solicitada_at]);

  // GPS tracking: enviar ubicación cada 30s cuando step = "ruta"
  useEffect(() => {
    const esEnRuta = step === 'ruta' && miRutaActiva?.id && user?.id;
    if (!esEnRuta || !navigator.geolocation || !supabase) return;

    const enviarUbicacion = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          supabase.from('chofer_ubicaciones').insert({
            ruta_id: miRutaActiva.id,
            chofer_id: user.id,
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            precision_m: pos.coords.accuracy,
          }).then(() => {});
        },
        () => {}, // Error silencioso — GPS no disponible
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };

    enviarUbicacion(); // Enviar inmediatamente
    const interval = setInterval(enviarUbicacion, 30000); // Cada 30s
    return () => clearInterval(interval);
  }, [step, miRutaActiva?.id, user?.id]);

  const pendientes = ordenesConDetalle.filter(o => !o.entregada);
  const entregadasList = ordenesConDetalle.filter(o => o.entregada);



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
  const solicitarFirma = async () => {
    if (solicitandoFirma) return;

    // Validar que al menos un producto tenga carga real > 0
    const tieneCarga = Object.values(cargaRealForm).some(v => n(v) > 0);
    if (!tieneCarga) {
      showToast('Debes marcar al menos un producto cargado');
      return;
    }

    // Validar que ningún valor exceda el autorizado
    for (const [sku, qty] of Object.entries(cargaRealForm)) {
      const autorizado = n(cargaTotal[sku]);
      if (n(qty) > autorizado) {
        showToast(`${sku}: máximo autorizado ${autorizado}`);
        return;
      }
    }

    setSolicitandoFirma(true);
    try {
      const cargaRealNum = {};
      for (const [sku, qty] of Object.entries(cargaRealForm)) {
        if (n(qty) > 0) cargaRealNum[sku] = n(qty);
      }
      const result = await actions.solicitarFirmaCarga?.(miRutaActiva.id, cargaRealNum);
      if (result && result.message) {
        showToast('Error: ' + result.message);
        return;
      }
      showToast('Firma solicitada. Espera a Producción.');
    } catch {
      showToast('No se pudo solicitar firma');
    } finally {
      setSolicitandoFirma(false);
    }
  };

  // Permite que Producción/Admin firme la carga
  const enviarFirma = async (esExcepcion = false) => {
    if (enviandoFirma) return;
    if (esExcepcion && !motivoExcepcion.trim()) {
      showToast('Captura el motivo de la excepción');
      return;
    }
    if (!esExcepcion && !firmaTienePuntos) {
      showToast('Dibuja la firma antes de confirmar');
      return;
    }
    const canvas = !esExcepcion ? firmaCanvasRef.current : null;
    if (!esExcepcion && !canvas) return;

    setEnviandoFirma(true);
    try {
      if (esExcepcion) {
        const result = await actions.firmarCarga?.(miRutaActiva.id, null, {
          excepcion: true,
          motivoExcepcion: motivoExcepcion.trim(),
        });
        if (result && result.message) {
          showToast('Error: ' + result.message);
          return;
        }
        showToast('Carga registrada (sin firma, con justificación)');
        setExcepcionModal(false);
        setMotivoExcepcion('');
        return;
      }

      const firmaBase64 = canvas.toDataURL('image/png');
      const result = await actions.firmarCarga?.(miRutaActiva.id, firmaBase64);
      if (result && result.message) {
        showToast('Error: ' + result.message);
        return;
      }
      showToast('Firma registrada. Inventario descontado.');
      setFirmaModal(false);
      setFirmaTienePuntos(false);
    } catch (e) {
      console.error('Error enviando firma:', e);
      showToast('Error al firmar. Verifica tu conexión.');
    } finally {
      setEnviandoFirma(false);
    }
  };

  const limpiarFirma = () => {
    const canvas = firmaCanvasRef.current;
    const ctx = firmaContextRef.current;
    if (canvas && ctx) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setFirmaTienePuntos(false);
    }
  };

  const confirmarEntrega = async () => {
    if (confirmandoEntrega || generandoLink) return;
    if (!entregaModal) return;
    // QR / Link de pago → generate checkout
    if (cobroMetodo === "QR / Link de pago") {
      setGenerandoLink(true);
      try {
        const result = await actions.crearCheckoutPago?.(entregaModal.id, checkoutProvider);
        if (result?.checkoutUrl) {
          setCheckoutUrl(result.checkoutUrl);
          setShortUrl(result.shortUrl || result.checkoutUrl);
          showToast('Link de pago generado');
        } else {
          showToast("Error al generar link de pago");
        }
      } catch (e) {
        showToast('Error: ' + (e.message || 'No se pudo generar el link'));
      } finally {
        setGenerandoLink(false);
      }
      return;
    }
    const entrega = {
      ordenId: entregaModal.id,
      folio: s(entregaModal.folio),
      folioNota: folioNota || null,
      cliente: entregaModal.clienteNombre,
      items: entregaModal.items,
      total: entregaModal.totalCalc,
      pago: cobroMetodo,
      referencia: cobroRef,
      foto: cobroMetodo === "Transferencia" ? fotoTransf : null,
      fotoEntrega: fotoEntrega || null,
      hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
    };
    setConfirmandoEntrega(true);
    try {
      // Update order status in store
      const err = actions.updateOrdenEstatus
        ? await actions.updateOrdenEstatus(entregaModal.id, "Entregada", cobroMetodo, { folioNota: folioNota || null })
        : null;
      if (err) {
        showToast("No se pudo registrar la entrega");
        return;
      }
      setEntregas(prev => [...prev, entrega]);
      showToast("Entregado a " + entrega.cliente);
      setEntregaModal(null);
      setFotoTransf(null);
    } finally {
      setConfirmandoEntrega(false);
    }
  };

  const abrirNoEntrega = (orden) => {
    setNoEntregaModal(orden);
    setNoEntregaForm({ motivo: MOTIVOS_NO_ENTREGA[0], otroMotivo: '', reagendar: true });
  };

  const confirmarNoEntrega = async () => {
    if (marcandoNoEntrega) return;
    if (!noEntregaModal) return;
    const motivoFinal = noEntregaForm.motivo === 'Otro'
      ? s(noEntregaForm.otroMotivo).trim()
      : noEntregaForm.motivo;
    if (!motivoFinal) {
      showToast('Captura el motivo');
      return;
    }
    setMarcandoNoEntrega(true);
    try {
      const result = await actions.marcarNoEntregada?.(
        noEntregaModal.id,
        motivoFinal,
        noEntregaForm.reagendar
      );
      if (result && result.error) {
        showToast('Error: ' + result.error);
        return;
      }
      showToast(noEntregaForm.reagendar
        ? 'Marcada como no entregada (reagendar)'
        : 'Marcada como no entregada');
      setNoEntregaModal(null);
    } finally {
      setMarcandoNoEntrega(false);
    }
  };

  const crearVentaExpress = async () => {
    if (creandoVenta) return;
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
    setCreandoVenta(true);
    try {
      const precio = getPrice(clienteNombre, sku);
      const subtotal = n(vForm.cant) * precio;
      const total = subtotal; // Hielo: IVA tasa 0%
      const venta = {
        id: Date.now(), folio: "EX-" + String(Date.now()).slice(-4),
        clienteId: vForm.clienteId || clienteExpressSel?.id || null,
        cliente: clienteNombre,
        items: [{ sku, cant: n(vForm.cant), precio }],
        subtotal, iva: 0,
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
      showToast("Venta exprés: " + fmtMoney(total) + (vForm.factura ? " (factura)" : ""));
      setVentaModal(false);
      setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" });
    } finally {
      setCreandoVenta(false);
    }
  };

  const registrarMerma = async () => {
    if (registrandoMerma) return;
    if (!mForm.cant || n(mForm.cant) <= 0 || !fotoMerma) return;
    // Validar que no exceda stock disponible
    const disponibleSku = restante[mForm.sku] || 0;
    if (n(mForm.cant) > disponibleSku) {
      showToast(`Solo tienes ${disponibleSku} disponibles de ${mForm.sku}`, "error");
      return;
    }
    setRegistrandoMerma(true);
    try {
      // Save to store with audit trail
      if (actions.registrarMerma) {
        await actions.registrarMerma(mForm.sku, n(mForm.cant), mForm.causa, s(user?.nombre), fotoMerma);
      }
      setMermas(prev => {
        const nuevaMerma = { ...mForm, id: Date.now(), cant: n(mForm.cant), foto: fotoMerma, hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) };
        const updated = [...prev, nuevaMerma];
        if (miRutaActiva?.id) {
          localStorage.setItem('mermas_ruta_' + miRutaActiva.id, JSON.stringify(updated));
        }
        return updated;
      });
      showToast("Merma registrada");
      setMermaModal(false);
      setFotoMerma(null);
      setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" });
    } finally {
      setRegistrandoMerma(false);
    }
  };

  const cerrarRuta = async () => {
    if (cerrandoRuta || rutaCerrada) return;

    // Validar que no haya inventario negativo (entregó más de lo que cargó)
    for (const p of productos) {
      const sku = s(p.sku);
      const carga = cargaTotal[sku] || 0;
      if (carga <= 0) continue;
      const dev = carga - (entregadoTotal[sku] || 0) - (mermaTotal[sku] || 0);
      if (dev < 0) {
        showToast(`Error: ${s(p.nombre)} tiene ${Math.abs(dev)} unidades de más (entregó más de lo cargado)`);
        return;
      }
    }

    setCerrandoRuta(true);

    // Save complete route report to store
    try {
      if (actions.cerrarRutaCompleta) {
        const cobrosPorMetodo = {};
        for (const e of entregas) cobrosPorMetodo[e.pago] = (cobrosPorMetodo[e.pago]||0) + n(e.total);
        const result = await actions.cerrarRutaCompleta({
          rutaId: miRutaActiva?.id,
          choferId: user?.id,
          choferNombre: s(user?.nombre),
          entregas,
          mermas,
          carga: cargaTotal,
          cobros: cobrosPorMetodo,
        });
        // cerrarRutaCompleta returns the error object on failure instead of throwing
        if (result && result.message) {
          showToast("No se pudo cerrar la ruta: " + result.message);
          return;
        }
      }
      if (miRutaActiva?.id) {
        localStorage.removeItem('mermas_ruta_' + miRutaActiva.id);
      }
      setRutaCerrada(true);
      showToast("Reporte enviado ✓");
    } catch {
      showToast("No se pudo cerrar la ruta");
    } finally {
      setCerrandoRuta(false);
    }
  };

  // ═══ STEP 1: CARGAR (chofer marca cuánto cargó realmente) ═══
  if (step === "cargar") return (
    <div className={CHOFER_SHELL}>
      <div className="bg-[#07131a] px-4 pb-5 text-white shadow-[0_24px_48px_rgba(3,14,19,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-4">
          <div><p className="erp-kicker text-cyan-200/70">Chofer</p><h1 className="font-display text-[1.55rem] font-bold tracking-[-0.04em]">Cargar camión</h1><p className="text-xs text-slate-300">{s(user?.nombre)}</p></div>
          <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white">Salir</button>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Paso 1 de 3</p>
          <h2 className="font-display mt-2 text-[1.55rem] font-bold tracking-[-0.04em]">Marca cuánto cargaste</h2>
          <p className="mt-1.5 text-sm text-slate-300">Producción debe firmar antes de salir.</p>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-3">
        {!miRutaActiva && (
          <div className="bg-amber-50 border border-amber-200 rounded-[20px]">
            <EmptyState
              icon={<span className="text-4xl">🚚</span>}
              message="No tienes ruta asignada para hoy"
              hint="Pide a tu admin que te asigne una ruta para empezar el día"
              secondaryLabel="Recargar"
              onSecondary={() => window.location.reload()}
            />
          </div>
        )}

        {miRutaActiva && productos.filter(p => n(cargaTotal[s(p.sku)]) > 0).map(p => {
          const sku = s(p.sku);
          const autorizado = n(cargaTotal[sku]);
          const real = cargaRealForm[sku] || '';
          const excede = n(real) > autorizado;
          return (
            <div key={sku} className="bg-white/78 rounded-[22px] border border-slate-200/80 p-4 shadow-[0_12px_24px_rgba(8,20,27,0.06)]">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800">{s(p.nombre)}</p>
                  <p className="text-xs text-slate-400">{sku}</p>
                  <p className="text-xs text-cyan-700 font-semibold mt-1">Autorizado: {autorizado}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={real}
                  onChange={e => setCargaRealForm(f => ({ ...f, [sku]: e.target.value }))}
                  placeholder="0"
                  className={`flex-1 px-4 py-3 border-2 rounded-xl text-2xl font-extrabold text-center ${excede ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                />
                <button
                  onClick={() => setCargaRealForm(f => ({ ...f, [sku]: String(autorizado) }))}
                  className="px-3 py-2 bg-slate-100 text-xs font-bold text-slate-700 rounded-xl"
                >
                  Máx
                </button>
              </div>
              {excede && <p className="text-xs text-red-600 font-semibold mt-1">Excede autorizado</p>}
            </div>
          );
        })}

        {miRutaActiva && (
          <button
            onClick={solicitarFirma}
            disabled={solicitandoFirma || !Object.values(cargaRealForm).some(v => n(v) > 0)}
            className="mt-4 w-full rounded-[22px] bg-slate-900 py-5 text-lg font-extrabold text-white shadow-[0_20px_34px_rgba(8,20,27,0.16)] active:scale-[0.98] disabled:opacity-40"
          >
            {solicitandoFirma ? 'Solicitando…' : 'Solicitar firma de Producción'}
          </button>
        )}
      </div>
      {toast && <Toast msg={toast} />}
    </div>
  );

  // ═══ STEP NUEVO: ESPERANDO FIRMA ═══
  if (step === "esperando-firma") {
    const minutos = Math.floor(tiempoEsperaSegs / 60);
    const puedeFallback = minutos >= 15;
    const puedeExcepcion = minutos >= 30;
    const usuarioPuedeFirmar = user?.rol === 'Producción' || user?.rol === 'Admin';

    return (
      <div className={CHOFER_SHELL}>
        <div className="bg-[#07131a] px-4 pb-5 text-white" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
          <div className="flex items-center justify-between mb-4">
            <div><p className="erp-kicker text-cyan-200/70">Esperando firma</p><h1 className="font-display text-[1.4rem] font-bold tracking-[-0.04em]">Producción debe autorizar</h1></div>
            <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white">Salir</button>
          </div>
        </div>
        <div className="px-4 pt-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-[24px] p-5 text-center">
            <p className="text-5xl mb-2">⏳</p>
            <p className="text-base font-bold text-amber-800">Esperando firma de Producción</p>
            <p className="text-sm text-amber-700 mt-2">
              {minutos < 1 ? 'Recién solicitada' : `Hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`}
            </p>
          </div>

          <div className="bg-white/78 rounded-[24px] p-4 border border-slate-200/80">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Carga reportada</h3>
            {(() => {
              const real = miRutaActiva?.carga_real || {};
              return Object.entries(real).map(([sku, qty]) => {
                const prod = productos.find(p => s(p.sku) === sku);
                return (
                  <div key={sku} className="flex justify-between text-sm py-1">
                    <span className="text-slate-700">{prod ? s(prod.nombre) : sku}</span>
                    <span className="font-bold">{qty}</span>
                  </div>
                );
              });
            })()}
          </div>

          {usuarioPuedeFirmar && (
            <button
              onClick={() => { setFirmaModal(true); setFirmaTienePuntos(false); }}
              className="w-full py-4 bg-emerald-600 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(8,20,27,0.16)] active:scale-[0.98]"
            >
              ✍️ Firmar carga ({user?.rol})
            </button>
          )}

          {puedeFallback && !usuarioPuedeFirmar && (
            <div className="bg-blue-50 border border-blue-200 rounded-[20px] p-4">
              <p className="text-sm text-blue-700 font-semibold">Avisa a admin que apruebe remoto</p>
              <p className="text-xs text-blue-600 mt-1">Pasaron más de 15 minutos. Admin puede aprobar desde su dispositivo.</p>
            </div>
          )}

          {puedeExcepcion && (
            <button
              onClick={() => setExcepcionModal(true)}
              className="w-full py-3 bg-red-50 text-red-700 border-2 border-red-200 font-bold rounded-[20px] text-sm"
            >
              🚨 Cargar sin firma (excepción)
            </button>
          )}
        </div>

        {/* Modal de firma */}
        {firmaModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setFirmaModal(false)}>
            <div className="bg-white w-full max-w-md rounded-[24px] p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-display text-lg font-bold mb-3">Firma de Producción</h3>
              <p className="text-xs text-slate-500 mb-3">Dibuja tu firma con el dedo</p>

              <canvas
                ref={el => {
                  if (el && !firmaContextRef.current) {
                    firmaCanvasRef.current = el;
                    el.width = el.offsetWidth * 2;
                    el.height = el.offsetHeight * 2;
                    el.getContext('2d').scale(2, 2);
                    const ctx = el.getContext('2d');
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, el.width, el.height);
                    ctx.strokeStyle = '#0a1929';
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = 'round';
                    firmaContextRef.current = ctx;
                  }
                }}
                className="w-full h-48 border-2 border-slate-300 rounded-xl bg-white touch-none"
                onMouseDown={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  firmaContextRef.current.beginPath();
                  firmaContextRef.current.moveTo(e.clientX - rect.left, e.clientY - rect.top);
                  setFirmaDibujando(true);
                }}
                onMouseMove={e => {
                  if (!firmaDibujando) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  firmaContextRef.current.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                  firmaContextRef.current.stroke();
                  setFirmaTienePuntos(true);
                }}
                onMouseUp={() => setFirmaDibujando(false)}
                onMouseLeave={() => setFirmaDibujando(false)}
                onTouchStart={e => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const t = e.touches[0];
                  firmaContextRef.current.beginPath();
                  firmaContextRef.current.moveTo(t.clientX - rect.left, t.clientY - rect.top);
                  setFirmaDibujando(true);
                }}
                onTouchMove={e => {
                  e.preventDefault();
                  if (!firmaDibujando) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const t = e.touches[0];
                  firmaContextRef.current.lineTo(t.clientX - rect.left, t.clientY - rect.top);
                  firmaContextRef.current.stroke();
                  setFirmaTienePuntos(true);
                }}
                onTouchEnd={() => setFirmaDibujando(false)}
              />

              <div className="flex gap-2 mt-3">
                <button onClick={limpiarFirma} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl">Limpiar</button>
                <button onClick={() => setFirmaModal(false)} className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl">Cancelar</button>
                <button onClick={() => enviarFirma(false)} disabled={enviandoFirma || !firmaTienePuntos} className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">{enviandoFirma ? 'Firmando…' : 'Confirmar'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de excepción */}
        {excepcionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setExcepcionModal(false)}>
            <div className="bg-white w-full max-w-md rounded-[24px] p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-display text-lg font-bold text-red-700 mb-1">⚠️ Carga sin firma</h3>
              <p className="text-xs text-slate-600 mb-4">Esta acción queda registrada en auditoría. Solo úsala si no hay nadie de Producción/Admin disponible.</p>
              <label className="block text-xs font-bold text-slate-600 mb-1">Motivo (obligatorio)</label>
              <textarea
                value={motivoExcepcion}
                onChange={e => setMotivoExcepcion(e.target.value)}
                placeholder="Ej: Producción no llegó a la hora, urgencia de salir..."
                rows={3}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm resize-none"
              />
              <div className="flex gap-2 mt-4">
                <button onClick={() => { setExcepcionModal(false); setMotivoExcepcion(''); }} className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl">Cancelar</button>
                <button onClick={() => enviarFirma(true)} disabled={enviandoFirma || !motivoExcepcion.trim()} className="flex-1 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">{enviandoFirma ? 'Firmando…' : 'Cargar sin firma'}</button>
              </div>
            </div>
          </div>
        )}

        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  // ═══ STEP NUEVO: CARGADA (lista para salir) ═══
  if (step === "cargada") {
    return (
      <div className={CHOFER_SHELL}>
        <div className="bg-[#07131a] px-4 pb-5 text-white" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
          <div className="flex items-center justify-between mb-4">
            <div><p className="erp-kicker text-cyan-200/70">Lista para salir</p><h1 className="font-display text-[1.55rem] font-bold tracking-[-0.04em]">Carga firmada ✓</h1></div>
            <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white">Salir</button>
          </div>
        </div>
        <div className="px-4 pt-4 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-[24px] p-5 text-center">
            <p className="text-5xl mb-2">✓</p>
            <p className="text-base font-bold text-emerald-700">Carga autorizada</p>
            <p className="text-sm text-emerald-600 mt-1">
              {miRutaActiva?.firma_excepcion ? 'Sin firma (excepción registrada)' : 'Firmada por Producción'}
            </p>
          </div>

          <button
            onClick={async () => {
              if (actions.updateRutaEstatus) {
                await actions.updateRutaEstatus(miRutaActiva.id, 'En progreso');
              }
              setStep('ruta');
            }}
            className="w-full py-5 bg-slate-900 text-white font-extrabold rounded-[22px] text-lg shadow-[0_20px_34px_rgba(8,20,27,0.16)] active:scale-[0.98]"
          >
            🚛 Iniciar ruta
          </button>
        </div>
        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  // ═══ STEP 2: RUTA ═══
  if (step === "ruta") return (
    <div className={CHOFER_SHELL} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <div className="bg-[#07131a] px-4 pb-4 text-white shadow-[0_24px_48px_rgba(3,14,19,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-2">
          <div><p className="erp-kicker text-cyan-200/70">Chofer</p><h1 className="font-display text-[1.4rem] font-bold tracking-[-0.04em]">En ruta</h1><p className="text-xs text-slate-300">{s(user?.nombre)}</p></div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMapaVisible(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${mapaVisible ? 'bg-blue-500 text-white' : 'bg-white/15 text-cyan-200'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/></svg>
              {mapaVisible ? 'Ocultar mapa' : 'Ver mapa'}
            </button>
            <div className="text-right"><p className="text-lg font-extrabold">{fmtMoney(totalCobrado)}</p><p className="text-xs text-cyan-200/80">cobrado</p></div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/8 p-3">
          <div className="flex-1"><div className="h-2 bg-white/20 rounded-full overflow-hidden"><div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${ordenesConDetalle.length > 0 ? (entregadasList.length / ordenesConDetalle.length) * 100 : 0}%` }} /></div></div>
          <span className="text-sm font-bold">{entregadasList.length}/{ordenesConDetalle.length}</span>
        </div>
      </div>
      {/* Mapa embebido — se monta una sola vez para no perder la posición */}
      <div className={`px-4 pt-4 transition-all ${mapaVisible ? 'block' : 'hidden'}`}>
        <Suspense fallback={<div className="h-[340px] rounded-[22px] bg-slate-100 flex items-center justify-center text-sm text-slate-400">Cargando mapa...</div>}>
          <MapaRuta
            paradas={ordenesConDetalle.map(o => ({
              latitud:   o.latitud,
              longitud:  o.longitud,
              nombre:    o.clienteNombre,
              direccion: o.direccion,
              entregada: o.entregada,
            }))}
          />
        </Suspense>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {pendientes.length > 0 && <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Por entregar ({pendientes.length})</h3>
          {pendientes.map(o => (
            <div key={o.id} className="bg-white/78 rounded-[24px] p-4 border border-slate-200/80 shadow-[0_14px_28px_rgba(8,20,27,0.06)] mb-2">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <span className="font-mono text-xs text-slate-400">#{s(o.folio)}</span>
                  <p className="text-base font-bold text-slate-800">{o.clienteNombre}</p>
                  {o.esCredito
                    ? <span className="inline-block text-[10px] font-bold text-purple-700 bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-full mt-0.5">📋 A crédito</span>
                    : <span className="inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mt-0.5">💵 Cobrar</span>
                  }
                </div>
                <p className="text-lg font-extrabold text-slate-800">{fmtMoney(o.totalCalc)}</p>
              </div>
              {(o.direccion || o.contacto || o.referencia) && (
                <div className="space-y-1.5 mb-3">
                  {o.direccion && (
                    <div className="flex items-start gap-1.5 text-xs text-slate-600">
                      <span className="mt-0.5 flex-shrink-0 text-slate-500">📍</span>
                      <span className="line-clamp-2">{o.direccion}</span>
                    </div>
                  )}
                  {o.referencia && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                      <span className="mt-0.5 flex-shrink-0">📝</span>
                      <span className="line-clamp-2">{o.referencia}</span>
                    </div>
                  )}
                  {o.contacto && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 flex-wrap">
                      <span className="flex-shrink-0">👤</span>
                      <span className="flex-1 min-w-0 truncate">{o.contacto}</span>
                      {(() => {
                        const tel = extraerTelefono(o.contacto);
                        if (!tel) return null;
                        return (
                          <div className="flex gap-1.5">
                            <a
                              href={`tel:${tel}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2 py-1 bg-slate-900 text-white text-[10px] font-bold rounded-md flex items-center gap-1"
                              aria-label="Llamar"
                            >
                              📞 Llamar
                            </a>
                            <a
                              href={`https://wa.me/52${tel}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="px-2 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-md flex items-center gap-1"
                              aria-label="WhatsApp"
                            >
                              💬 WA
                            </a>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mb-3">
                {o.items.map((it, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{it.cant}× {it.sku} · ${it.precio}</span>)}
              </div>
              {/* Botón de navegación */}
              {(o.latitud && o.longitud) ? (
                <button onClick={() => abrirNavegacion(o.latitud, o.longitud)}
                  className="mb-2 flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 text-white font-semibold rounded-[14px] text-sm active:scale-[0.98] transition-transform">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  Navegar
                </button>
              ) : o.direccion ? (
                <button onClick={() => window.location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.direccion)}`}
                  className="mb-2 flex items-center justify-center gap-2 w-full py-2.5 bg-blue-500/80 text-white font-semibold rounded-[14px] text-sm active:scale-[0.98] transition-transform">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  Buscar dirección
                </button>
              ) : null}
              <button onClick={() => { setEntregaModal(o); setCobroMetodo(o.esCredito ? "Crédito" : "Efectivo"); setCobroRef(""); setFolioNota(""); setFotoEntrega(null); setCheckoutUrl(null); setShortUrl(null); }}
                className="w-full py-3.5 bg-slate-900 text-white font-bold rounded-[18px] text-sm active:scale-[0.98] transition-transform shadow-[0_18px_30px_rgba(8,20,27,0.14)]">
                Entregar y cobrar
              </button>
              <button onClick={() => abrirNoEntrega(o)}
                className="w-full mt-2 py-2.5 bg-white border border-amber-300 text-amber-700 font-semibold rounded-[14px] text-xs active:scale-[0.98] transition-transform">
                No entregada
              </button>
            </div>
          ))}
        </div>}
        {entregas.length > 0 && <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Entregadas ({entregas.length})</h3>
          {entregas.map(e => (
            <div key={e.ordenId || e.id} className="bg-emerald-50/90 rounded-[20px] p-3 border border-emerald-200 mb-2">
              <div className="flex justify-between items-center">
                <div><span className="font-mono text-xs text-emerald-600">#{s(e.folio)}</span>{e.folioNota&&<span className="text-[10px] text-slate-400 ml-1">Nota: {e.folioNota}</span>}<span className="text-sm font-semibold text-slate-700 ml-2">{s(e.cliente)}</span>{e.express && <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded ml-1">Exprés</span>}{e.factura && <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded ml-1">Factura</span>}</div>
                <div className="text-right flex items-center gap-2">{e.fotoEntrega && <span className="text-emerald-500 text-xs">📷</span>}<div><p className="text-sm font-bold">{fmtMoney(e.total)}</p><p className="text-[10px] text-slate-400">{e.pago} · {e.hora}</p></div></div>
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
      <div className="fixed bottom-0 left-1/2 z-40 -translate-x-1/2 w-full max-w-[640px] bg-slate-950/92 border-t border-white/10 px-4 py-3 backdrop-blur-xl md:max-w-3xl lg:max-w-5xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {/* Ver ruta completa en Maps si hay pendientes con coords */}
        {(() => {
          const conCoords = pendientes.filter(o => o.latitud && o.longitud);
          if (conCoords.length < 1) return null;
          const dest   = conCoords[conCoords.length - 1];
          const waypts = conCoords.slice(0, -1).map(o => `${o.latitud},${o.longitud}`).join('|');
          // Ruta completa — siempre usa Google Maps web (soporta waypoints múltiples)
          const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitud},${dest.longitud}${waypts ? `&waypoints=${encodeURIComponent(waypts)}` : ''}&travelmode=driving`;
          return (
            <button onClick={() => window.open(url, '_blank')}
              className="mb-2 flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 text-white font-semibold rounded-[16px] text-sm active:scale-[0.98] transition-transform">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              Ver ruta completa ({conCoords.length} paradas)
            </button>
          );
        })()}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <button onClick={() => { setVentaModal(true); setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false, rfc: "", correo: "", regimen: "Régimen General", usoCfdi: "G03", cp: "" }); }} className="w-full py-4 bg-cyan-200 text-slate-950 text-sm font-bold rounded-[18px]">Venta rápida</button>
          <button onClick={() => { setMermaModal(true); setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" }); }} className="w-full py-4 px-5 bg-white/10 text-amber-200 text-sm font-bold rounded-[18px]">Registrar merma</button>
          <button onClick={() => setStep("cierre")} className="w-full py-4 px-5 bg-white text-slate-950 text-sm font-bold rounded-[18px]">Cerrar ruta</button>
        </div>
      </div>

      {/* Modal cobro */}
      {entregaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setEntregaModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(3,14,19,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Cobro</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900">Entregar a {entregaModal.clienteNombre}</h3>
            <div className="flex flex-wrap gap-1 my-3">{entregaModal.items.map((it, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{it.cant}× {it.sku} · ${it.precio}</span>)}</div>
            <p className="text-3xl font-extrabold text-slate-800 mb-4">{fmtMoney(entregaModal.totalCalc)}</p>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Folio de nota (opcional)</label>
              <input value={folioNota} onChange={e=>setFolioNota(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Ej: N-0001" />
            </div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">¿Cómo paga?</label>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PAGOS.map(m => <button key={m} onClick={() => setCobroMetodo(m)} className={`py-3.5 rounded-xl text-sm font-bold border-2 transition-all ${cobroMetodo===m?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-600"}`}>{m==="Efectivo"?"💵 Efectivo":m==="Transferencia"?"📱 Transferencia":m==="Tarjeta"?"💳 Tarjeta":m==="QR / Link de pago"?"🔗 QR / Link":"📋 Crédito"}</button>)}
            </div>
            {cobroMetodo==="Transferencia" && <div className="mb-4 space-y-2">
              <input value={cobroRef} onChange={e=>setCobroRef(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Referencia (últimos 6 dígitos)" />
              {fotoTransf ? (
                <div><img src={fotoTransf} alt="Comprobante" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoTransf(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
              ) : (
                <label className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                  <span className="text-lg">📷</span> Foto del comprobante
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePick(setFotoTransf)} />
                </label>
              )}
            </div>}
            {cobroMetodo==="QR / Link de pago" && !checkoutUrl && (
              <div className="mb-4 p-3 bg-blue-50 rounded-xl">
                <p className="text-xs text-blue-600">Se genera un link de Stripe para que el cliente pague.</p>
              </div>
            )}
            {cobroMetodo==="QR / Link de pago" && checkoutUrl && (
              <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
                <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
                  {(() => {
                    const tel = extraerTelefono(entregaModal?.contacto);
                    const msg = `Hola, aquí está tu link de pago de Cubo Polar por ${fmtMoney(entregaModal.totalCalc)} MXN:\n${shortUrl || checkoutUrl}`;
                    const href = tel
                      ? `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`
                      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                    return <a href={href} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 WhatsApp</a>;
                  })()}
                </div>
                <button onClick={() => { setCheckoutUrl(null); setShortUrl(null); setEntregaModal(null); }} className="w-full py-2 text-xs text-slate-500 font-semibold">Cerrar</button>
              </div>
            )}
            {cobroMetodo==="Crédito" && <div className="bg-amber-50 rounded-xl p-3 mb-4"><p className="text-xs text-amber-700 font-semibold">Se agrega a la cuenta del cliente</p></div>}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Evidencia de entrega (opcional)</label>
              {fotoEntrega ? (
                <div><img src={fotoEntrega} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoEntrega(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
              ) : (
                <label className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                  <span className="text-lg">📷</span> Foto de nota o entrega
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePick(setFotoEntrega)} />
                </label>
              )}
            </div>
            {!checkoutUrl && <button onClick={confirmarEntrega} disabled={generandoLink || confirmandoEntrega} className={`w-full py-4 text-white font-extrabold rounded-xl text-base shadow-lg shadow-emerald-200 active:scale-[0.98] transition-transform ${(generandoLink || confirmandoEntrega) ? 'bg-slate-400' : 'bg-emerald-600'}`}>{generandoLink ? 'Generando link…' : confirmandoEntrega ? 'Registrando entrega…' : cobroMetodo === "QR / Link de pago" ? "Generar link de pago" : "✓ Confirmar entrega"}</button>}
          </div>
        </div>
      )}

      {/* Modal venta express */}
      {ventaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setVentaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(3,14,19,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Venta rapida</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Venta exprés</h3>
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
                <input type="number" min="0" inputMode="numeric" value={vForm.cant} onChange={e => setVForm(f=>({...f,cant:e.target.value}))} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-2xl font-extrabold text-center" placeholder="0" autoFocus />
                {vForm.cant && n(vForm.cant) > (restante[vForm.sku] || 0) && <p className="text-xs text-red-600 font-semibold mt-1">⚠ Solo te quedan {restante[vForm.sku] || 0}</p>}
              </div>
              {vForm.cant && n(vForm.cant) > 0 && n(vForm.cant) <= (restante[vForm.sku] || 0) && (
                <div className="bg-blue-50 rounded-xl p-3 text-center space-y-0.5">
                  <p className="text-xs text-slate-500">Subtotal: {fmtMoney(n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku))}</p>
                  <p className="text-xs text-slate-500">IVA 16%: {fmtMoney(Math.round((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) * 16) / 100)}</p>
                  <p className="text-2xl font-extrabold text-slate-800">{fmtMoney((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) + (Math.round((n(vForm.cant) * getPrice((s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general"), vForm.sku)) * 16) / 100))}</p>
                </div>
              )}
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pago</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{PAGOS.map(m => <button key={m} onClick={() => setVForm(f=>({...f,pago:m}))} className={`py-2 rounded-lg text-[11px] font-bold border-2 ${vForm.pago===m?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-500"}`}>{m==="QR / Link de pago"?"🔗 QR/Link":m}</button>)}</div>
              </div>

            </div>
            <button onClick={crearVentaExpress} disabled={creandoVenta||!vForm.cant||n(vForm.cant)<=0||n(vForm.cant)>(restante[vForm.sku]||0)||(vForm.factura&&(!vForm.cliente.trim()||!vForm.rfc.trim()||!vForm.correo.trim()||!vForm.regimen||!vForm.usoCfdi||vForm.cp.trim().length!==5||vForm.rfc.trim().length<12||vForm.rfc.trim().length>13))} className="w-full py-4 bg-emerald-600 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40">{creandoVenta ? "Creando venta…" : vForm.factura ? "Crear venta con factura" : "Crear venta"}</button>
          </div>
        </div>
      )}

      {/* Modal merma */}
      {mermaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setMermaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(3,14,19,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Incidencia</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Registrar merma</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">{productos.map(p => <button key={p.sku} onClick={() => setMForm(f=>({...f,sku:s(p.sku)}))} className={`py-2.5 rounded-xl text-xs font-bold border-2 ${mForm.sku===s(p.sku)?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-600"}`}>{s(p.nombre)}</button>)}</div>
              <input type="number" min="0" value={mForm.cant} onChange={e => setMForm(f=>({...f,cant:e.target.value}))} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" />
              <div className="grid grid-cols-2 gap-2">{MERMA_CAUSAS.map(c => <button key={c} onClick={() => setMForm(f=>({...f,causa:c}))} className={`py-2 rounded-xl text-xs font-semibold border-2 ${mForm.causa===c?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-500"}`}>{c}</button>)}</div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Evidencia (foto) *</label>
              {fotoMerma ? (
                <div className="mb-3"><img src={fotoMerma} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={() => setFotoMerma(null)} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
              ) : (
                <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer mb-3">
                  <span className="text-lg">📷</span> Tomar foto de evidencia
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePick(setFotoMerma)} />
                </label>
              )}
            </div>
            <button onClick={registrarMerma} disabled={registrandoMerma||!mForm.cant||n(mForm.cant)<=0||!fotoMerma} className="w-full py-3.5 bg-amber-600 text-white font-bold rounded-xl text-sm disabled:opacity-40">{registrandoMerma ? "Registrando…" : "Registrar merma"}</button>
          </div>
        </div>
      )}

      {/* Modal No entregada */}
      {noEntregaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => !marcandoNoEntrega && setNoEntregaModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Incidencia</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-1">Marcar como no entregada</h3>
            <p className="text-sm text-slate-500 mb-4">{s(noEntregaModal.clienteNombre || noEntregaModal.cliente)}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Motivo *</label>
                <div className="grid grid-cols-1 gap-2">
                  {MOTIVOS_NO_ENTREGA.map(m => (
                    <button key={m} onClick={() => setNoEntregaForm(f => ({ ...f, motivo: m }))}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold border-2 text-left ${noEntregaForm.motivo === m ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                {noEntregaForm.motivo === 'Otro' && (
                  <input
                    type="text"
                    value={noEntregaForm.otroMotivo}
                    onChange={e => setNoEntregaForm(f => ({ ...f, otroMotivo: e.target.value }))}
                    placeholder="Describe el motivo"
                    autoFocus
                    className="w-full mt-2 px-4 py-3 border border-slate-200 rounded-xl text-sm"
                  />
                )}
              </div>
              <label className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-4 py-3 cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Reagendar para próxima ruta</p>
                  <p className="text-[11px] text-slate-500">El admin verá la marca al armar la próxima ruta.</p>
                </div>
                <input
                  type="checkbox"
                  checked={noEntregaForm.reagendar}
                  onChange={e => setNoEntregaForm(f => ({ ...f, reagendar: e.target.checked }))}
                  className="w-5 h-5 rounded border-slate-300 accent-amber-500"
                />
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setNoEntregaModal(null)}
                disabled={marcandoNoEntrega}
                className="flex-1 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl text-sm disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarNoEntrega}
                disabled={marcandoNoEntrega || (noEntregaForm.motivo === 'Otro' && !s(noEntregaForm.otroMotivo).trim())}
                className="flex-1 py-3 bg-amber-600 text-white font-bold rounded-xl text-sm disabled:opacity-40"
              >
                {marcandoNoEntrega ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
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
      <div className={CHOFER_SHELL}>
        <div className="bg-[#07131a] px-4 pb-4 text-white shadow-[0_24px_48px_rgba(3,14,19,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
          <div className="flex items-center justify-between">
            <div><p className="erp-kicker text-cyan-200/70">Paso 3 de 3</p><h1 className="font-display text-[1.55rem] font-bold tracking-[-0.04em]">Cierre de ruta</h1><p className="text-xs text-slate-300">{s(user?.nombre)} · {fmtDate(new Date())}</p></div>
            {!rutaCerrada && <button onClick={() => setStep("ruta")} className="text-xs bg-white/8 border border-white/10 px-3 py-1.5 rounded-full">← Volver</button>}
          </div>
        </div>
        <div className="px-4 pt-4 space-y-4">
          <div className="bg-white/78 rounded-[24px] p-4 border border-slate-200/80 shadow-[0_14px_28px_rgba(8,20,27,0.06)]">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Cuadre de bolsas</h3>
            <div className="grid grid-cols-5 gap-1 text-[10px] font-bold text-slate-400 uppercase mb-1"><span>Producto</span><span className="text-center">Cargó</span><span className="text-center">Entregó</span><span className="text-center">Merma</span><span className="text-center">Devuelve</span></div>
            {productos.filter(p => cargaTotal[s(p.sku)] > 0).map(p => { const sku = s(p.sku); return (
              <div key={sku} className="grid grid-cols-5 gap-1 text-sm items-center py-1">
                <span className="font-semibold text-slate-700 text-xs">{s(p.nombre)}</span>
                <span className="text-center text-slate-500">{cargaTotal[sku]}</span>
                <span className="text-center text-slate-500">{entregadoTotal[sku]||0}</span>
                <span className={`text-center ${(mermaTotal[sku]||0)>0?"text-amber-600 font-semibold":"text-slate-500"}`}>{mermaTotal[sku]||0}</span>
                <span className={`text-center font-bold ${devuelto[sku]===0?"text-emerald-600":devuelto[sku]>0?"text-blue-600":"text-red-600"}`}>{devuelto[sku]}</span>
              </div>
            );})}
            {(() => { const totalCarga = Object.values(cargaTotal).reduce((a,b)=>a+b,0); const totalEntr = Object.values(entregadoTotal).reduce((a,b)=>a+b,0); const totalMerma = Object.values(mermaTotal).reduce((a,b)=>a+b,0); const totalDev = Object.values(devuelto).reduce((a,b)=>a+b,0); return (
              <div className="grid grid-cols-5 gap-1 text-xs items-center py-1.5 border-t border-slate-200 mt-1 font-bold text-slate-700">
                <span>Total</span>
                <span className="text-center">{totalCarga}</span>
                <span className="text-center">{totalEntr}</span>
                <span className="text-center text-amber-600">{totalMerma}</span>
                <span className={`text-center ${totalDev===0?"text-emerald-600":totalDev>0?"text-blue-600":"text-red-600"}`}>{totalDev}</span>
              </div>
            );})()}
          </div>
          <div className="bg-white/78 rounded-[24px] p-4 border border-slate-200/80 shadow-[0_14px_28px_rgba(8,20,27,0.06)]">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Cobros</h3>
            {Object.entries(cobrosPorMetodo).map(([m, v]) => <div key={m} className="flex justify-between text-sm py-0.5"><span className="text-slate-500">{m}</span><span className="font-bold">{fmtMoney(v)}</span></div>)}
            <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between"><span className="text-sm font-bold text-slate-700">Efectivo a entregar</span><span className="text-xl font-extrabold text-emerald-600">{fmtMoney(cobrosPorMetodo["Efectivo"]||0)}</span></div>
            {totalCredito > 0 && <div className="flex justify-between text-sm mt-1"><span className="text-amber-600 font-semibold">Crédito</span><span className="font-bold text-amber-600">{fmtMoney(totalCredito)}</span></div>}
          </div>
          <div className="bg-white/78 rounded-[24px] p-4 border border-slate-200/80 shadow-[0_14px_28px_rgba(8,20,27,0.06)]">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Detalle ({entregas.length})</h3>
            {entregas.map(e => (
              <div key={e.ordenId||e.id} className="flex justify-between text-xs items-center py-1.5 border-b border-slate-50">
                <div><span className="font-mono text-slate-400">#{s(e.folio)}</span><span className="ml-1.5 text-slate-700 font-semibold">{s(e.cliente)}</span></div>
                <div className="text-right"><span className="font-bold">{fmtMoney(e.total)}</span><span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${e.pago==="Crédito"?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-500"}`}>{e.pago}</span></div>
              </div>
            ))}
          </div>
          {mermas.length > 0 && <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">Mermas</h3>
            {mermas.map(m => <div key={m.id} className="flex justify-between text-xs py-1"><span>{m.cant}× {m.sku}</span><span className="text-amber-600">{m.causa}</span></div>)}
          </div>}
          {pendientes.length > 0 && <div className="bg-red-50 rounded-xl p-3 border border-red-200"><p className="text-xs text-red-600 font-bold">⚠ {pendientes.length} órdenes sin entregar</p></div>}

          {!rutaCerrada ? (
            <button onClick={cerrarRuta} disabled={cerrandoRuta} className="w-full py-4 bg-slate-900 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(8,20,27,0.16)] active:scale-[0.98] transition-transform disabled:cursor-not-allowed disabled:opacity-50">{cerrandoRuta ? 'Enviando reporte...' : 'Cerrar ruta y enviar reporte'}</button>
          ) : (
            <div className="text-center space-y-4">
              <div className="bg-emerald-50/90 border border-emerald-200 rounded-[24px] p-5">
                <p className="text-2xl mb-2">✓</p>
                <p className="text-base font-bold text-emerald-700">Reporte enviado</p>
                <p className="text-xs text-emerald-600 mt-1">Ruta cerrada correctamente</p>
              </div>
              <button onClick={onLogout} className="w-full py-4 bg-slate-900 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(8,20,27,0.16)] active:scale-[0.98] transition-transform">Cerrar sesión</button>
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
  return <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-950 text-cyan-100 px-4 py-2.5 rounded-full text-sm font-semibold shadow-[0_18px_32px_rgba(3,14,19,0.28)]" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }} role="status" aria-live="polite">{msg}</div>;
}
