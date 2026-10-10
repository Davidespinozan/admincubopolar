import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import DatosTransferencia from './ui/DatosTransferencia';
import CapturaFoto from './ui/CapturaFoto';
import { diaNegocio } from '../utils/fechas';
import { s, n, fmtMoney, fmtDate, extraerTelefono } from '../utils/safe';
import { resolverEntrega, etiquetaClienteSucursal } from '../data/sucursalLogic';
import { validarVentaExpressFactura, validarClienteNuevoChofer } from '../data/ventaExpressLogic';
import { REGIMENES_OPTIONS } from '../data/sat/regimenesFiscales';
import { supabase } from '../lib/supabase';
import { backendPost } from '../lib/backend';
import { compressImage } from '../utils/compressImage';
import { MOTIVOS_NO_ENTREGA } from '../data/ordenLogic';
import { validarCobroTransferencia } from '../data/mejorasMenoresLogic';
import { mensajeTicket, enlaceWhatsApp, urlMapaParada, urlNavegacionParada } from '../data/ticketLogic';
import { evidenciasPendientes, estadoFotosEntrega } from '../data/evidenciaLogic';
import { rutaActivaDelChofer, motivoSinCredito, mezclarEntregas } from '../data/choferRutaLogic';
import { TIPOS_MUTACION, mutacionesFallidas, mutacionesPendientes, ordenesBloqueadas } from '../data/colaOfflineLogic';
import { resolverOperacion, nuevoOperacionId, claveCarga, claveNoEntrega } from '../data/stockContratosLogic';
import { useColaOffline } from '../data/useColaOffline';
import { conteoInicial, diferenciasConteo, totalesBalance, mensajeNoEntrega } from '../data/inventarioRutaLogic';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel, RoleHeader, ChoiceButton } from './ui/Components';
import { textoSaludo } from '../data/saludoLogic';
import { Icons } from './ui/Icons';
import { useToast } from './ui/Toast';
import { EmptyState } from './ui/Skeleton';
const MapaRuta = lazy(() => import('./ui/MapaRuta'));

// Fase A5 (convergencia visual por rol): el Chofer conserva su flujo de
// enfoque (cargar → firma → cargada → ruta → cierre), la cola offline, el GPS,
// las fotos, la firma, la venta exprés y el cierre por servidor; solo cambia
// la presentación (RoleHeader en modo enfoque, tarjetas, Modal compartido,
// ChoiceButton/FormInput/FormBtn, toast global). Botones grandes y barra de
// acciones fija se mantienen: es la pantalla que se usa manejando.
const PAGOS = ["Efectivo", "Transferencia", "Tarjeta", "QR / Link de pago", "Crédito"];
const MERMA_CAUSAS = ["Bolsa rota", "Hielo derretido", "Daño transporte", "Rechazo cliente"];
const CHOFER_SHELL = "min-h-dvh w-full text-slate-900";
const CONTENIDO = "mx-auto w-full max-w-[640px] px-4 pt-4 md:max-w-3xl lg:max-w-5xl";
const LABEL = "mb-1.5 block text-sm font-medium text-slate-700";

// Igualdad de la lista de entregas por los campos que vienen de la base
// (orden, folio, total, método y piezas); las locales se comparan por identidad.
export function mismasEntregas(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (x === y) return true;
    if (!x || !y || !x.ordenId || String(x.ordenId) !== String(y.ordenId)) return false;
    return x.folio === y.folio && Number(x.total) === Number(y.total) && x.pago === y.pago
      && JSON.stringify(x.items || []) === JSON.stringify(y.items || []);
  });
}

export default function ChoferView({ user, data, actions, onLogout, onMiAsistencia, onMisActividades, onMiCuenta }) {
  const [stepOverride, setStepOverride] = useState(null);
  // PD-01 / PD-02: acceso a "Mi asistencia" y "Mis actividades" desde cualquier paso.
  // Mobile-first (2026-10-09): van en una fila bajo el título (no compiten con él).
  const botonAsistencia = onMiAsistencia ? (
    <button type="button" onClick={onMiAsistencia} data-testid="chofer-mi-asistencia"
      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15">
      <Icons.Clock /> Asistencia
    </button>
  ) : null;
  const botonActividades = onMisActividades ? (
    <button type="button" onClick={onMisActividades} data-testid="chofer-mis-actividades"
      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15">
      <Icons.Calendar /> Actividades
    </button>
  ) : null;
  // GER-1: "Mi cuenta" (cambiar la contraseña propia) también desde cualquier paso.
  const botonCuenta = onMiCuenta ? (
    <button type="button" onClick={onMiCuenta} data-testid="chofer-mi-cuenta" aria-label="Mi cuenta" title="Mi cuenta"
      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15">
      <Icons.Lock /> Cuenta
    </button>
  ) : null;
  const barraPersonal = (botonAsistencia || botonActividades || botonCuenta) ? (
    <div className="mb-3 flex flex-wrap gap-2" data-testid="chofer-barra-personal">{botonAsistencia}{botonActividades}{botonCuenta}</div>
  ) : null;
  const saludo = textoSaludo(user?.nombre);

  // Fase 18 paso 3: Carga real + firma
  const [cargaRealForm, setCargaRealForm] = useState({});
  const [solicitandoFirma, setSolicitandoFirma] = useState(false);
  const [firmaModal, setFirmaModal] = useState(false);
  const [excepcionModal, setExcepcionModal] = useState(false);
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [tiempoEsperaSegs, setTiempoEsperaSegs] = useState(0);
  const firmaCanvasRef = useRef(null);
  const firmaContextRef = useRef(null);
  // R2 (084): operacion_id por intento lógico — mismo UUID mientras se
  // reintenta la misma firma / la misma no-entrega; nuevo si cambian los datos.
  const opFirmaRef = useRef(null);
  const opNoEntregaRef = useRef(null);
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
  const [vForm, setVForm] = useState({ clienteId: "", cliente: "", sku: "", cant: "", pago: "Efectivo", factura: false });
  const [mForm, setMForm] = useState({ sku: "", cant: "", causa: "Bolsa rota" });
  const [fotoMerma, setFotoMerma] = useState(null);
  const [fotoTransf, setFotoTransf] = useState(null);
  const [fotoEntrega, setFotoEntrega] = useState(null);
  const [folioNota, setFolioNota] = useState("");
  const [rutaCerrada, setRutaCerrada] = useState(false);
  const [cerrandoRuta, setCerrandoRuta] = useState(false);
  // 087: cierre en dos pasos contra el servidor — balance canónico del
  // camión y conteo físico (el cliente no calcula la devolución).
  const [preparandoCierre, setPreparandoCierre] = useState(false);
  const [balanceCierre, setBalanceCierre] = useState(null);
  const [conteoForm, setConteoForm] = useState({});
  const [faltanteCierre, setFaltanteCierre] = useState(null);
  const [enviandoFirma, setEnviandoFirma] = useState(false);
  const [noEntregaModal, setNoEntregaModal] = useState(null); // orden o null
  const [noEntregaForm, setNoEntregaForm] = useState({ motivo: MOTIVOS_NO_ENTREGA[0], otroMotivo: '', reagendar: true });
  const [marcandoNoEntrega, setMarcandoNoEntrega] = useState(false);
  // (El bloqueo de scroll y Escape de las hojas los hace el Modal compartido.)
  const toast = useToast();
  const showToast = (msg, tipo = "success") => { (toast?.[tipo] || toast?.info)?.(msg); };

  // Handler compartido: comprime cliente-side, valida 5MB como red de
  // seguridad, y guarda el dataURL en el setter recibido.
  const handleImagePick = (setter) => async (e) => {
    const original = e.target.files?.[0];
    if (!original) return;
    if (original.size > 2 * 1024 * 1024) showToast('Procesando foto…', 'info');
    const file = await compressImage(original);
    if (file.size > 5 * 1024 * 1024) {
      showToast('Foto muy grande, máx 5MB', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setter(ev.target.result);
    reader.readAsDataURL(file);
  };

  // ── READ REAL DATA FROM STORE ──
  const productos = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);
  // 127: clientes que el chofer registró en esta sesión (hasta que el refresco los traiga de la base).
  const [clientesNuevos, setClientesNuevos] = useState([]);
  const [cliNuevoForm, setCliNuevoForm] = useState(null); // null = cerrado
  const [guardandoCli, setGuardandoCli] = useState(false);
  const clientesActivos = useMemo(() => {
    const base = (data.clientes || []).filter(c => s(c.estatus || 'Activo') === 'Activo');
    const ids = new Set(base.map(c => String(c.id)));
    return [...base, ...clientesNuevos.filter(c => !ids.has(String(c.id)))];
  }, [data.clientes, clientesNuevos]);
  const clienteExpressSel = useMemo(() => clientesActivos.find(c => String(c.id) === String(vForm.clienteId)), [clientesActivos, vForm.clienteId]);
  // P0: con factura, la identidad fiscal es la del cliente registrado.
  const errorFacturaExpress = validarVentaExpressFactura({ factura: vForm.factura, cliente: clienteExpressSel })?.error || null;

  // Precio canónico (088, igual que el servidor): precio especial por ID de
  // cliente + SKU si existe; si no, precio de catálogo. Nunca por nombre.
  const getPrice = useCallback((clienteId, sku) => {
    const esp = clienteId ? data.preciosEsp?.find(p => String(p.clienteId ?? p.cliente_id) === String(clienteId) && s(p.sku) === sku) : null;
    if (esp) return n(esp.precio);
    const prod = data.productos.find(p => s(p.sku) === sku);
    return prod ? n(prod.precio) : 0;
  }, [data.preciosEsp, data.productos]);

  // ── MI RUTA ACTIVA (asignada por administración) ──
  const isAdminPreview = user?.rol === 'Admin';
  // La ruta del chofer: la ya empezada manda (aunque cambie el día o le creen otra) y
  // una Programada se ve desde su fecha. Regla en choferRutaLogic.
  const miRutaActiva = useMemo(
    () => rutaActivaDelChofer(data.rutas, user, diaNegocio(), { esAdmin: isAdminPreview }),
    [data.rutas, user?.id, user?.nombre, isAdminPreview]);

  // ── COLA OFFLINE (Tanda 22) ──
  // Sin señal, entrega/no-entrega/merma se encolan en localStorage y se
  // reintentan al reconectar. Los ejecutores traducen cada tipo a su
  // acción de supaStore normalizando la convención de error a truthy.
  const ejecutoresOffline = useMemo(() => ({
    [TIPOS_MUTACION.ENTREGA]: async (p) => {
      const err = await actions.updateOrdenEstatus?.(p.ordenId, 'Entregada', p.metodoPago, { folioNota: p.folioNota || null });
      return err || null;
    },
    [TIPOS_MUTACION.NO_ENTREGA]: async (p) => {
      // El operacion_id viaja en el payload encolado: cada replay del mismo
      // evento reutiliza el mismo UUID (084 lo hace idempotente).
      const r = await actions.marcarNoEntregada?.(p.ordenId, p.motivo, p.reagendar, { operacionId: p.operacionId });
      return (r && r.error) ? r : null;
    },
    // Nota: TIPOS_MUTACION.MERMA no se encola desde ruta — la merma de
    // ruta es local hasta el cierre (ver registrarMerma, Tanda 23 fix).
  }), [actions]);
  const {
    cola: colaOffline,
    online,
    sincronizando,
    agregar: encolarOffline,
    sincronizar: sincronizarCola,
    pendientesActuales: pendientesCola,
    limpiar: limpiarCola,
  } = useColaOffline({ rutaId: miRutaActiva?.id, ejecutores: ejecutoresOffline, avisar: showToast });

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

  // 087: lo que realmente se subió al camión (carga_real, lo que el contrato
  // descontó de los cuartos). Guía local; el servidor calcula el balance.
  const cargaReal = useMemo(() => {
    const src = (miRutaActiva && (miRutaActiva.carga_real || miRutaActiva.cargaReal)) || {};
    const t = {};
    for (const p of productos) {
      const sku = s(p.sku);
      t[sku] = n(src[sku]);
    }
    return t;
  }, [productos, miRutaActiva]);

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
      // 123: dirección efectiva orden → sucursal → cliente, compartida con Rutas y Ventas.
      const entrega = resolverEntrega(o, data.sucursales, data.clientes);
      const clienteNombre = etiquetaClienteSucursal(cli ? s(cli.nombre) : s(o.cliente), entrega.sucursal);
      // Parse productos string "25×HC-25K, 10×HC-5K" into items
      const items = [];
      const prodStr = s(o.productos);
      if (prodStr) {
        prodStr.split(",").forEach(part => {
          const match = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
          if (match) {
            const cant = parseInt(match[1]);
            const sku = match[2];
            // El precio es el de la VENTA (línea guardada); el de hoy solo si la venta no trae líneas.
            const linea = (o.preciosSnapshot || []).find(l => s(l.sku) === sku);
            const precio = linea && Number.isFinite(Number(linea.unitPrice)) ? n(linea.unitPrice) : getPrice(o.clienteId || o.cliente_id, sku);
            items.push({ sku, cant, precio });
          }
        });
      }
      const total = items.reduce((s, it) => s + it.cant * it.precio, 0);
      const entregada = s(o.estatus) === 'Entregada' || entregas.some(e => String(e.ordenId) === String(o.id));
      const { direccion, referencia, contacto } = entrega;
      const latitud = entrega.latitud ?? undefined;
      const longitud = entrega.longitud ?? undefined;
      const esCredito = s(o.tipo_cobro || o.tipoCobro) === 'Credito';
      const nombreComercial = s(cli?.nombre_comercial || cli?.nombreComercial || '');
      // Se cobra el total de la venta tal como quedó registrada (precio por sucursal incluido).
      return { ...o, clienteNombre, items, totalCalc: n(o.total) || total, entregada,
        latitud, longitud, direccion, referencia, esCredito,
        contacto, nombreComercial };
    });
  }, [misOrdenes, data.clientes, data.sucursales, entregas, getPrice]);

  // Cambio de ruta SIN recargar la app (cerró una y le asignaron otra): lo que hay en
  // memoria es de la ruta anterior y no debe pasar a la nueva. Antes las entregas y ventas
  // exprés de la primera se enviaban en el cierre de la segunda (ventas y cobros duplicados).
  // Va antes de los efectos que cargan y guardan por ruta.
  const [rutaDeEntregas, setRutaDeEntregas] = useState(null);
  const ultimaRutaRef = useRef(null);
  useEffect(() => {
    const id = miRutaActiva?.id ?? null;
    if (id == null) return;   // sin ruta activa (p. ej. recién cerrada): se conserva la pantalla de cierre
    if (ultimaRutaRef.current != null && ultimaRutaRef.current !== id) {
      setEntregas([]); setMermas([]); setRutaDeEntregas(null);
      setStepOverride(null); setRutaCerrada(false); setBalanceCierre(null); setConteoForm({}); setFaltanteCierre(null);
      setEntregaModal(null); setVentaModal(false); setMermaModal(false); setTicket(null);
    }
    ultimaRutaRef.current = id;
  }, [miRutaActiva?.id]);

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
        // El servidor manda en total y forma de pago; el teléfono conserva fotos, referencia,
        // contacto y hora (antes la entrada del servidor REEMPLAZABA la local y la foto por
        // subir se perdía). Las ventas exprés (sin ordenId) se quedan como están.
        const merged = mezclarEntregas(prev, dbEntregas);
        // Sin cambios → mismo estado. Antes devolvía siempre un arreglo nuevo:
        // ordenesConDetalle depende de `entregas`, así que con una orden ya
        // Entregada el efecto se re-disparaba sin fin (Maximum update depth).
        if (mismasEntregas(prev, merged)) return prev;
        return merged;
      });
    }
  }, [ordenesConDetalle]);

  // Tanda 22: persistir entregas por ruta (igual que mermas). Antes, un
  // reload a media ruta perdía ventas exprés, referencias de
  // transferencia y fotos de comprobante — la DB solo recupera órdenes
  // ya marcadas Entregada, sin ese detalle local.
  useEffect(() => {
    if (!miRutaActiva?.id) return;
    const clave = 'entregas_ruta_' + miRutaActiva.id;
    const saved = localStorage.getItem(clave);
    if (!saved) { setRutaDeEntregas(miRutaActiva.id); return; }
    try {
      const arr = JSON.parse(saved);
      if (!Array.isArray(arr) || arr.length === 0) return;
      setEntregas(prev => {
        const vistos = new Set(prev.map(e => String(e.ordenId ?? e.id)));
        const nuevos = arr.filter(e => e && !vistos.has(String(e.ordenId ?? e.id)));
        // Lo guardado en el teléfono completa a lo que ya llegó del servidor (fotos por subir).
        const guardadas = new Map(arr.filter(e => e && e.ordenId).map(e => [String(e.ordenId), e]));
        const completadas = prev.map(e => (e.ordenId && guardadas.has(String(e.ordenId)) ? mezclarEntregas([guardadas.get(String(e.ordenId))], [e])[0] : e));
        return [...completadas, ...nuevos];
      });
      setRutaDeEntregas(miRutaActiva.id);
    } catch {
      localStorage.removeItem(clave);
      setRutaDeEntregas(miRutaActiva.id);
    }
  }, [miRutaActiva?.id]);

  useEffect(() => {
    // Solo persistir cuando hay algo — evita que el mount inicial (con
    // estado vacío) pise lo guardado antes de que cargue el effect de
    // arriba. Al cerrar ruta se hace removeItem explícito.
    // Solo cuando las entregas en memoria SON de esta ruta: al cambiar de ruta este efecto
    // corre todavía con las de la anterior y las guardaba bajo la clave de la nueva.
    if (!miRutaActiva?.id || entregas.length === 0 || rutaDeEntregas !== miRutaActiva.id) return;
    const clave = 'entregas_ruta_' + miRutaActiva.id;
    try {
      localStorage.setItem(clave, JSON.stringify(entregas));
    } catch {
      // Quota (fotos base64): persistir sin fotos como degradado — se
      // pierde la evidencia si recarga, pero no los montos ni métodos.
      try {
        localStorage.setItem(clave, JSON.stringify(
          entregas.map(({ foto: _foto, fotoEntrega: _fotoEntrega, ...resto }) => resto)
        ));
      } catch { /* sin espacio ni para eso: la copia en memoria sigue viva */ }
    }
  }, [entregas, miRutaActiva?.id, rutaDeEntregas]);

  // Load mermas from localStorage on mount (persist across reloads)
  useEffect(() => {
    if (miRutaActiva?.id) {
      const saved = localStorage.getItem('mermas_ruta_' + miRutaActiva.id);
      if (saved) {
        try {
          setMermas(JSON.parse(saved));
        } catch (e) {
          console.warn('No se pudieron cargar mermas guardadas:', e);
          showToast('Mermas guardadas no se pudieron recuperar. Por favor regístralas de nuevo.', 'error');
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

  // GPS tracking: enviar ubicación cada 30s cuando step = "ruta".
  // Captura errores de Supabase y muestra una alerta UNA vez por sesión
  // si hay 5 fallos consecutivos (sin spam de toasts).
  useEffect(() => {
    const esEnRuta = step === 'ruta' && miRutaActiva?.id && user?.id;
    if (!esEnRuta || !navigator.geolocation || !supabase) return;

    let fallosConsecutivos = 0;
    let avisoMostrado = false;

    const enviarUbicacion = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          supabase.from('chofer_ubicaciones').insert({
            ruta_id: miRutaActiva.id,
            chofer_id: user.id,
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            precision_m: pos.coords.accuracy,
          }).then(({ error }) => {
            if (error) {
              fallosConsecutivos += 1;
              console.warn('[GPS]', error.message);
              if (fallosConsecutivos >= 5 && !avisoMostrado) {
                avisoMostrado = true;
                showToast('GPS no se está registrando — admin no te ve en el mapa', 'error');
              }
            } else if (fallosConsecutivos > 0) {
              // Recuperación: reset contador para permitir nuevo aviso si vuelve a fallar
              fallosConsecutivos = 0;
              avisoMostrado = false;
            }
          });
        },
        () => {}, // Error silencioso del navegador (GPS off, permiso denegado)
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };

    enviarUbicacion(); // Enviar inmediatamente
    const interval = setInterval(enviarUbicacion, 30000); // Cada 30s
    return () => clearInterval(interval);
  }, [step, miRutaActiva?.id, user?.id]);

  // Tanda 22: excluir de "Por entregar" las órdenes ya atendidas
  // offline (entrega o no-entrega en cola) para no atender dos veces
  // la misma parada mientras se espera señal.
  const ordenesEnColaOffline = useMemo(() => ordenesBloqueadas(colaOffline), [colaOffline]);
  const pendientes = ordenesConDetalle.filter(o => !o.entregada && !ordenesEnColaOffline.has(String(o.id)));
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
      t[sku] = (cargaReal[sku] || 0) - (entregadoTotal[sku] || 0) - (mermaTotal[sku] || 0);
    }
    return t;
  }, [productos, cargaReal, entregadoTotal, mermaTotal]);

  // ── ACTIONS ──
  const solicitarFirma = async () => {
    if (solicitandoFirma) return;

    // Validar que al menos un producto tenga carga real > 0
    const tieneCarga = Object.values(cargaRealForm).some(v => n(v) > 0);
    if (!tieneCarga) {
      showToast('Debes marcar al menos un producto cargado', 'error');
      return;
    }

    // Validar que ningún valor exceda el autorizado
    for (const [sku, qty] of Object.entries(cargaRealForm)) {
      const autorizado = n(cargaTotal[sku]);
      if (n(qty) > autorizado) {
        showToast(`${sku}: máximo autorizado ${autorizado}`, 'error');
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
        showToast('Error: ' + result.message, 'error');
        return;
      }
      showToast('Firma solicitada. Espera a Producción.');
    } catch {
      showToast('No se pudo solicitar firma', 'error');
    } finally {
      setSolicitandoFirma(false);
    }
  };

  // Permite que Producción/Admin firme la carga
  const enviarFirma = async (esExcepcion = false) => {
    if (enviandoFirma) return;
    if (esExcepcion && !motivoExcepcion.trim()) {
      showToast('Captura el motivo de la excepción', 'error');
      return;
    }
    if (!esExcepcion && !firmaTienePuntos) {
      showToast('Dibuja la firma antes de confirmar', 'error');
      return;
    }
    const canvas = !esExcepcion ? firmaCanvasRef.current : null;
    if (!esExcepcion && !canvas) return;

    setEnviandoFirma(true);
    try {
      if (esExcepcion) {
        const op = resolverOperacion(opFirmaRef.current, claveCarga({ rutaId: miRutaActiva.id, excepcion: true, motivo: motivoExcepcion.trim() }));
        opFirmaRef.current = op;
        const result = await actions.firmarCarga?.(miRutaActiva.id, null, {
          excepcion: true,
          motivoExcepcion: motivoExcepcion.trim(),
          operacionId: op.id,
        });
        if (result && result.message) {
          showToast('Error: ' + result.message, 'error');
          return;
        }
        opFirmaRef.current = null;
        showToast('Carga registrada (sin firma, con justificación)');
        setExcepcionModal(false);
        setMotivoExcepcion('');
        return;
      }

      const firmaBase64 = canvas.toDataURL('image/png');
      const op = resolverOperacion(opFirmaRef.current, claveCarga({ rutaId: miRutaActiva.id, excepcion: false }));
      opFirmaRef.current = op;
      const result = await actions.firmarCarga?.(miRutaActiva.id, firmaBase64, { operacionId: op.id });
      if (result && result.message) {
        showToast('Error: ' + result.message, 'error');
        return;
      }
      opFirmaRef.current = null;
      showToast('Firma registrada. Inventario descontado.');
      setFirmaModal(false);
      setFirmaTienePuntos(false);
    } catch (e) {
      console.error('Error enviando firma:', e);
      showToast('Error al firmar. Verifica tu conexión.', 'error');
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
    // Tanda 6 🟢-4: la foto del comprobante es obligatoria para Transferencia.
    // Sin foto el admin no puede conciliar el pago en la cuenta bancaria.
    const validErr = validarCobroTransferencia({ metodoPago: cobroMetodo, fotoTransf });
    if (validErr) {
      showToast(validErr.error, 'error');
      return;
    }
    // Fiado: se revisa ANTES de marcar la entrega. Si el servidor lo rechaza después, la venta
    // quedaba Entregada sin cobro ni deuda y bloqueaba el cierre de la ruta.
    if (cobroMetodo === "Crédito") {
      const cli = (data.clientes || []).find(c => String(c.id) === String(entregaModal.clienteId ?? entregaModal.cliente_id));
      const sinCredito = motivoSinCredito(cli, entregaModal.totalCalc);
      if (sinCredito) { showToast(sinCredito, 'error'); return; }
    }
    // QR / Link de pago → generate checkout
    if (cobroMetodo === "QR / Link de pago") {
      if (!online) {
        showToast('Sin señal — el link de pago necesita conexión. Usa otro método.', 'info');
        return;
      }
      setGenerandoLink(true);
      try {
        const result = await actions.crearCheckoutPago?.(entregaModal.id, checkoutProvider);
        if (result?.checkoutUrl) {
          setCheckoutUrl(result.checkoutUrl);
          setShortUrl(result.shortUrl || result.checkoutUrl);
          showToast('Link de pago generado');
        } else {
          showToast("Error al generar link de pago", 'error');
        }
      } catch (e) {
        showToast('Error: ' + (e.message || 'No se pudo generar el link'), 'error');
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
      contacto: entregaModal.contacto || null,
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
      if (!online) {
        // Tanda 22: sin señal → encolar la mutación y confirmar local.
        // La orden desaparece de "Por entregar" (entregas la marca) y
        // la sincronización corre sola al reconectar.
        encolarOffline(TIPOS_MUTACION.ENTREGA, {
          ordenId: entregaModal.id,
          metodoPago: cobroMetodo,
          folioNota: folioNota || null,
        });
        setEntregas(prev => [...prev, { ...entrega, offline: true }]);
        showToast("Sin señal — entrega guardada en el teléfono", 'info');
        setEntregaModal(null);
        setFotoTransf(null);
        return;
      }
      // Update order status in store
      const err = actions.updateOrdenEstatus
        ? await actions.updateOrdenEstatus(entregaModal.id, "Entregada", cobroMetodo, { folioNota: folioNota || null })
        : null;
      if (err) {
        showToast("No se pudo registrar la entrega", 'error');
        return;
      }
      setEntregas(prev => [...prev, entrega]);
      showToast("Entregado a " + entrega.cliente);
      const contactoCliente = entregaModal.contacto;
      setEntregaModal(null);
      setFotoTransf(null);
      // Al terminar: ticket listo para mandárselo al cliente.
      abrirTicket(entrega, contactoCliente);
    } finally {
      setConfirmandoEntrega(false);
    }
  };

  // Ticket de la entrega: la nota pública firmada (netlify/functions/recibo).
  // Se abre sola al terminar de entregar y desde "Entregadas". El link se pide
  // al abrir; los botones (WhatsApp, compartir, copiar) son toques directos del
  // chofer, así el teléfono no bloquea el compartir. Si algo falla, dice por qué.
  const [ticket, setTicket] = useState(null);   // { entrega, contacto, url, error, cargando }
  const abrirTicket = async (entrega, contacto) => {
    if (!entrega?.ordenId) return;
    setTicket({ entrega, contacto: contacto || null, url: null, error: null, cargando: true });
    try {
      const r = await backendPost('recibo', { ordenId: entrega.ordenId });
      setTicket(t => (t && t.entrega.ordenId === entrega.ordenId ? { ...t, url: window.location.origin + r.url, cargando: false } : t));
    } catch (err) {
      const motivo = err?.status === 501 ? 'Los tickets no están configurados todavía. Avisa a administración.'
        : err?.status === 403 ? 'Esta venta no es de tu ruta: el ticket lo comparte administración.'
        : err?.status === 401 ? 'Tu sesión venció. Cierra sesión, vuelve a entrar e inténtalo otra vez.'
        : !navigator.onLine ? 'Sin señal. El ticket se puede enviar al recuperar la conexión, desde "Entregadas".'
        : `No se pudo generar el ticket${err?.message ? ` (${String(err.message).slice(0, 120)})` : ''}. Inténtalo otra vez.`;
      setTicket(t => (t && t.entrega.ordenId === entrega.ordenId ? { ...t, error: motivo, cargando: false } : t));
    }
  };
  const compartirTicket = async () => {
    if (!ticket?.url) return;
    try {
      if (navigator.share) await navigator.share({ title: `Ticket ${s(ticket.entrega.folio)}`, url: ticket.url });
      else { await navigator.clipboard.writeText(ticket.url); showToast('Link del ticket copiado'); }
    } catch (err) {
      if (err?.name !== 'AbortError') showToast('No se pudo compartir. Usa WhatsApp o copia el link.', 'info');
    }
  };
  const copiarTicket = async () => {
    try { await navigator.clipboard.writeText(ticket.url); showToast('Link del ticket copiado'); }
    catch { showToast('Mantén presionado el link para copiarlo', 'info'); }
  };
  // Mig 134: las fotos del comprobante y de la entrega se suben al sistema en
  // cuanto hay señal (antes se quedaban en el teléfono). Corre al entregar, al
  // recuperar la conexión y al reabrir la app; cada foto se intenta una vez por
  // sesión de conexión y, ya subida, se marca en la entrega para no repetir.
  const subiendoEvidencias = useRef(new Set());
  const [reintentoFotos, setReintentoFotos] = useState(0);
  useEffect(() => { if (online) subiendoEvidencias.current.clear(); }, [online]);
  useEffect(() => {
    if (!online || typeof actions.subirEvidenciaOrden !== 'function') return;
    for (const p of evidenciasPendientes(entregas)) {
      if (subiendoEvidencias.current.has(p.clave)) continue;
      subiendoEvidencias.current.add(p.clave);
      // Si falla (mala señal), se reintenta al minuto: antes solo se reintentaba al perder y
      // recuperar la conexión, y con señal débil eso no pasa.
      const reintentar = () => setTimeout(() => { subiendoEvidencias.current.delete(p.clave); setReintentoFotos(k => k + 1); }, 60_000);
      actions.subirEvidenciaOrden(p).then(r => {
        if (r?.error) { console.warn('[evidencia]', p.clave, r.error); reintentar(); return; }
        setEntregas(prev => prev.map(e => (Number(e.ordenId) === p.ordenId ? { ...e, [p.marca]: true } : e)));
      }).catch(err => { console.warn('[evidencia]', p.clave, err?.message); reintentar(); });
    }
  }, [entregas, online, actions, reintentoFotos]);

  // Mapa de una parada dentro de la app (sin salir).
  const [mapaParada, setMapaParada] = useState(null);

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
      showToast('Captura el motivo', 'error');
      return;
    }
    setMarcandoNoEntrega(true);
    try {
      if (!online) {
        // Tanda 22: sin señal → encolar; la parada sale de "Por
        // entregar" vía ordenesEnColaOffline hasta que sincronice.
        encolarOffline(TIPOS_MUTACION.NO_ENTREGA, {
          ordenId: noEntregaModal.id,
          motivo: motivoFinal,
          reagendar: noEntregaForm.reagendar,
          operacionId: nuevoOperacionId(),
        });
        showToast('Sin señal — se marcará no entregada al reconectar', 'info');
        setNoEntregaModal(null);
        return;
      }
      const op = resolverOperacion(opNoEntregaRef.current, claveNoEntrega({ ordenId: noEntregaModal.id, motivo: motivoFinal, reagendar: noEntregaForm.reagendar }));
      opNoEntregaRef.current = op;
      const result = await actions.marcarNoEntregada?.(
        noEntregaModal.id,
        motivoFinal,
        noEntregaForm.reagendar,
        { operacionId: op.id }
      );
      if (result && result.error) {
        showToast('Error: ' + result.error, 'error');
        return;
      }
      opNoEntregaRef.current = null;
      showToast(mensajeNoEntrega(noEntregaForm.reagendar));
      setNoEntregaModal(null);
    } finally {
      setMarcandoNoEntrega(false);
    }
  };

  const registrarClienteNuevo = async () => {
    if (guardandoCli || !cliNuevoForm) return;
    const err = validarClienteNuevoChofer(cliNuevoForm);
    if (err) { showToast(err.error, 'error'); return; }
    setGuardandoCli(true);
    try {
      const r = await actions.crearClienteChofer?.({ ...cliNuevoForm, rfc: cliNuevoForm.rfc.trim().toUpperCase() });
      if (!r || r.error || r.id == null) return; // el store ya mostró el aviso
      setClientesNuevos(prev => [...prev, { id: r.id, nombre: r.nombre, rfc: r.rfc, regimen: cliNuevoForm.regimen, uso_cfdi: cliNuevoForm.usoCfdi, cp: cliNuevoForm.cp, correo: cliNuevoForm.correo, estatus: 'Activo' }]);
      setVForm(f => ({ ...f, clienteId: String(r.id), cliente: s(r.nombre) }));
      setCliNuevoForm(null);
      showToast(r.existente ? 'Ya existía un cliente con ese RFC: se seleccionó' : 'Cliente registrado');
    } finally {
      setGuardandoCli(false);
    }
  };

  const crearVentaExpress = async () => {
    if (creandoVenta) return;
    if (!vForm.cant || n(vForm.cant) <= 0) return;

    const clienteNombre = s(vForm.cliente) || s(clienteExpressSel?.nombre) || "Público en general";

    const errFactura = validarVentaExpressFactura({ factura: vForm.factura, cliente: clienteExpressSel });
    if (errFactura) { showToast(errFactura.error); return; }
    // Una venta exprés inválida aborta TODO el cierre de la ruta y no se puede quitar: se valida aquí.
    if (vForm.pago === "QR / Link de pago") { showToast('La venta rápida no tiene link de pago: elige efectivo, transferencia o tarjeta.', 'error'); return; }

    const sku = vForm.sku || s(productos[0]?.sku);
    // Check available inventory
    if (n(vForm.cant) > (restante[sku] || 0)) {
      showToast("No tienes suficiente — te quedan " + (restante[sku] || 0), 'error');
      return;
    }
    setCreandoVenta(true);
    try {
      const precio = getPrice(vForm.clienteId || clienteExpressSel?.id || null, sku);
      const subtotal = n(vForm.cant) * precio;
      if (vForm.pago === "Crédito") {
        const sinCredito = motivoSinCredito(clienteExpressSel || (data.clientes || []).find(c => String(c.id) === String(vForm.clienteId)), subtotal);
        if (sinCredito) { showToast(sinCredito, 'error'); return; }
      }
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
      };
      setEntregas(prev => [...prev, venta]);
      showToast("Venta exprés: " + fmtMoney(total) + (vForm.factura ? " (factura)" : ""));
      setVentaModal(false);
      setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false });
    } finally {
      setCreandoVenta(false);
    }
  };

  const registrarMerma = async () => {
    if (registrandoMerma) return;
    if (!mForm.cant || n(mForm.cant) <= 0 || !fotoMerma) return;
    // Validar que no exceda stock disponible
    // Con el cierre preparado, el tope es el balance del servidor (faltante
    // del conteo); antes, la guía local del camión.
    const disponibleSku = balanceCierre
      ? n((balanceCierre.find(b => b.sku === s(mForm.sku)) || {}).restante)
      : (restante[mForm.sku] || 0);
    if (n(mForm.cant) > disponibleSku) {
      showToast(`Solo tienes ${disponibleSku} disponibles de ${mForm.sku}`, "error");
      return;
    }
    setRegistrandoMerma(true);
    try {
      // La merma de ruta es local hasta el cierre: prepararCierreRuta la
      // registra en un lote idempotente (087: descuenta del camión, no de
      // cuartos fríos, y registra el egreso). `registrada` evita reenviarla.
      setMermas(prev => {
        const nuevaMerma = { ...mForm, id: Date.now(), cant: n(mForm.cant), foto: fotoMerma, registrada: false, hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) };
        const updated = [...prev, nuevaMerma];
        if (miRutaActiva?.id) {
          localStorage.setItem('mermas_ruta_' + miRutaActiva.id, JSON.stringify(updated));
        }
        return updated;
      });
      showToast(balanceCierre ? "Merma lista — vuelve a registrar ventas y mermas para actualizar el conteo" : "Merma registrada — se reporta al cerrar la ruta");
      setMermaModal(false);
      setFotoMerma(null);
      setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" });
    } finally {
      setRegistrandoMerma(false);
    }
  };

  const marcarMermasRegistradas = (ids) => {
    if (!ids || ids.length === 0) return;
    const set = new Set(ids.map(String));
    setMermas(prev => {
      const updated = prev.map(m => set.has(String(m.id)) ? { ...m, registrada: true } : m);
      if (miRutaActiva?.id) {
        try { localStorage.setItem('mermas_ruta_' + miRutaActiva.id, JSON.stringify(updated)); } catch { /* sin espacio */ }
      }
      return updated;
    });
  };

  // Paso 1 del cierre (087): ventas/cobros (086) + mermas pendientes → el
  // servidor devuelve el balance canónico del camión para contar.
  const prepararCierre = async () => {
    if (preparandoCierre || rutaCerrada) return;
    // Tanda 22: el cierre necesita conexión y cola sincronizada — las
    // no-entregas encoladas deben llegar antes de calcular el balance.
    if (!online) {
      showToast('Sin señal — busca conexión para cerrar la ruta', 'info');
      return;
    }
    if (pendientesCola().length > 0) {
      showToast('Sincronizando pendientes…', 'info');
      await sincronizarCola();
      if (pendientesCola().length > 0) {
        showToast('Hay operaciones sin sincronizar — reintenta en un momento', 'error');
        return;
      }
    }
    setPreparandoCierre(true);
    try {
      const res = await actions.prepararCierreRuta?.({
        rutaId: miRutaActiva?.id,
        choferNombre: s(user?.nombre),
        entregas,
        mermas,
      });
      if (!res) return;
      if (res.mermasRegistradas) marcarMermasRegistradas(res.mermasRegistradas);
      // Ventas y cobros ya quedaron registrados: las ventas exprés ahora son órdenes del
      // servidor (llegan con la recarga). Se quitan las copias locales para no contarlas dos veces.
      if (res.financiero) setEntregas(prev => prev.filter(e => e.ordenId));
      if (res.error) {
        showToast('No se pudo preparar el cierre: ' + res.error, 'error');
        return;
      }
      setBalanceCierre(res.balance || []);
      setConteoForm(conteoInicial(res.balance || []));
      setFaltanteCierre(null);
      showToast('Cuenta lo que regresa en el camión y confirma');
    } finally {
      setPreparandoCierre(false);
    }
  };

  // Paso 2 del cierre (087): conteo físico → el servidor valida contra el
  // balance, devuelve a los cuartos de origen y cierra la ruta.
  const cerrarRuta = async () => {
    if (cerrandoRuta || rutaCerrada || !balanceCierre) return;
    setCerrandoRuta(true);
    try {
      const res = await actions.finalizarInventarioRuta?.(miRutaActiva?.id, conteoForm);
      if (!res) return;
      if (res.error) {
        setFaltanteCierre(res.faltante || null);
        showToast(res.error, 'error');
        return;
      }
      if (miRutaActiva?.id) {
        localStorage.removeItem('mermas_ruta_' + miRutaActiva.id);
        localStorage.removeItem('entregas_ruta_' + miRutaActiva.id);
      }
      limpiarCola();
      setRutaCerrada(true);
      showToast("Ruta cerrada");
    } catch {
      showToast("No se pudo cerrar la ruta", 'error');
    } finally {
      setCerrandoRuta(false);
    }
  };

  const abrirMermaFaltante = (sku, cant) => {
    setMForm({ sku, cant: String(cant), causa: "Faltante al contar" });
    setFotoMerma(null);
    setMermaModal(true);
  };

  // ═══ STEP 1: CARGAR (chofer marca cuánto cargó realmente) ═══
  if (step === "cargar") return (
    <div className={CHOFER_SHELL} data-testid="chofer-shell">
      <RoleHeader compact kicker="Chofer" title="Cargar camión" subtitle={saludo} accent="cyan" onLogout={onLogout}>
        {barraPersonal}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-white/10 bg-white/10 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Paso 1 de 3</span>
          <span className="text-sm font-semibold text-white">Marca cuánto cargaste</span>
          <span className="text-xs text-slate-300">· Producción debe firmar antes de salir.</span>
        </div>
      </RoleHeader>
      <div className={`${CONTENIDO} space-y-3`}>
        {!miRutaActiva && (
          <Card tone="warning">
            <EmptyState
              icon="Truck"
              message="No tienes ruta asignada para hoy"
              hint="Pide a tu admin que te asigne una ruta para empezar el día"
              secondaryLabel="Recargar"
              onSecondary={() => window.location.reload()}
            />
          </Card>
        )}

        {miRutaActiva && productos.filter(p => n(cargaTotal[s(p.sku)]) > 0).map(p => {
          const sku = s(p.sku);
          const autorizado = n(cargaTotal[sku]);
          const real = cargaRealForm[sku] || '';
          const excede = n(real) > autorizado;
          return (
            <Card key={sku} padding="p-4">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800">{s(p.nombre)}</p>
                  <p className="text-xs text-slate-400">{sku}</p>
                  <p className="mt-1 text-xs font-semibold text-cyan-700">Autorizado: {autorizado}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <FormInput label="Cargado" type="number" min="0" inputMode="numeric" value={real}
                    onChange={e => setCargaRealForm(f => ({ ...f, [sku]: e.target.value }))} placeholder="0"
                    inputClassName="text-center !text-2xl font-extrabold" error={excede ? 'Excede autorizado' : undefined} />
                </div>
                <FormBtn ghost className="mt-[26px]" onClick={() => setCargaRealForm(f => ({ ...f, [sku]: String(autorizado) }))}>Máx</FormBtn>
              </div>
            </Card>
          );
        })}

        {miRutaActiva && (
          <FormBtn primary size="lg" className="mt-4 w-full !text-lg" onClick={solicitarFirma}
            disabled={solicitandoFirma || !Object.values(cargaRealForm).some(v => n(v) > 0)}>
            {solicitandoFirma ? 'Solicitando…' : 'Solicitar firma de Producción'}
          </FormBtn>
        )}
      </div>
    </div>
  );

  // ═══ STEP NUEVO: ESPERANDO FIRMA ═══
  if (step === "esperando-firma") {
    const minutos = Math.floor(tiempoEsperaSegs / 60);
    const puedeFallback = minutos >= 15;
    const puedeExcepcion = minutos >= 30;
    const usuarioPuedeFirmar = user?.rol === 'Producción' || user?.rol === 'Admin';

    return (
      <div className={CHOFER_SHELL} data-testid="chofer-shell">
        <RoleHeader compact kicker="Chofer · Paso 2 de 3" title="Producción debe autorizar" subtitle={saludo} accent="cyan" onLogout={onLogout}>{barraPersonal}</RoleHeader>
        <div className={`${CONTENIDO} space-y-4`}>
          <Card tone="warning" className="text-center">
            <p className="mb-2 flex justify-center text-amber-700 [&>svg]:h-10 [&>svg]:w-10"><Icons.Clock /></p>
            <p className="text-base font-bold text-amber-800">Esperando firma de Producción</p>
            <p className="mt-2 text-sm text-amber-700">
              {minutos < 1 ? 'Recién solicitada' : `Hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`}
            </p>
          </Card>

          <Card>
            <SectionLabel className="mb-3">Carga reportada</SectionLabel>
            {(() => {
              const real = miRutaActiva?.carga_real || {};
              return Object.entries(real).map(([sku, qty]) => {
                const prod = productos.find(p => s(p.sku) === sku);
                return (
                  <div key={sku} className="flex justify-between py-1 text-sm">
                    <span className="text-slate-700">{prod ? s(prod.nombre) : sku}</span>
                    <span className="font-bold">{qty}</span>
                  </div>
                );
              });
            })()}
          </Card>

          {usuarioPuedeFirmar && (
            <FormBtn success size="lg" className="w-full" onClick={() => { setFirmaModal(true); setFirmaTienePuntos(false); }}>
              <Icons.Edit /> Firmar carga ({user?.rol})
            </FormBtn>
          )}

          {puedeFallback && !usuarioPuedeFirmar && (
            <Card tone={undefined} padding="p-4" className="!border-sky-200/80 !bg-sky-50/80">
              <p className="text-sm font-semibold text-sky-800">Avisa a admin que apruebe remoto</p>
              <p className="mt-1 text-xs text-sky-700">Pasaron más de 15 minutos. Admin puede aprobar desde su dispositivo.</p>
            </Card>
          )}

          {puedeExcepcion && (
            <FormBtn className="w-full border-red-200 bg-red-50 text-red-700 hover:bg-red-100" onClick={() => setExcepcionModal(true)}>
              <Icons.AlertTriangle /> Cargar sin firma (excepción)
            </FormBtn>
          )}
        </div>

        {/* Modal de firma */}
        <Modal open={!!firmaModal} onClose={() => setFirmaModal(false)} title="Firma de Producción" kicker="Carga" closeOnEscape={!enviandoFirma}
          footer={<>
            <FormBtn ghost size="lg" onClick={limpiarFirma}>Limpiar</FormBtn>
            <FormBtn size="lg" className="flex-1" onClick={() => setFirmaModal(false)}>Cancelar</FormBtn>
            <FormBtn success size="lg" className="flex-[1.4]" onClick={() => enviarFirma(false)} disabled={enviandoFirma || !firmaTienePuntos}>{enviandoFirma ? 'Enviando…' : 'Confirmar'}</FormBtn>
          </>}>
          <p className="mb-3 text-xs text-slate-500">Dibuja tu firma con el dedo</p>

          <canvas
            ref={el => {
              // Un lienzo nuevo (al reabrir) se prepara otra vez.
              if (el && firmaCanvasRef.current !== el) {
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
            className="h-48 w-full touch-none rounded-card border-2 border-slate-300 bg-white"
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

        </Modal>

        {/* Modal de excepción */}
        <Modal open={!!excepcionModal} onClose={() => setExcepcionModal(false)} title="Carga sin firma" kicker="Excepción" closeOnEscape={!enviandoFirma}
          footer={<>
            <FormBtn size="lg" className="flex-1" onClick={() => { setExcepcionModal(false); setMotivoExcepcion(''); }}>Cancelar</FormBtn>
            <FormBtn danger size="lg" className="flex-[2]" onClick={() => enviarFirma(true)} disabled={enviandoFirma || !motivoExcepcion.trim()}>{enviandoFirma ? 'Enviando…' : 'Confirmar excepción'}</FormBtn>
          </>}>
          <p className="mb-4 text-xs text-slate-600">Esta acción queda registrada en auditoría. Solo úsala si no hay nadie de Producción/Admin disponible.</p>
          <label className={LABEL}>Motivo (obligatorio)</label>
          <textarea
            value={motivoExcepcion}
            onChange={e => setMotivoExcepcion(e.target.value)}
            placeholder="Ej: Producción no llegó a la hora, urgencia de salir..."
            rows={3}
            className="w-full resize-none rounded-field border border-line bg-slate-50 px-3.5 py-3 text-[15px] text-ink focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
        </Modal>
      </div>
    );
  }

  // ═══ STEP NUEVO: CARGADA (lista para salir) ═══
  if (step === "cargada") {
    return (
      <div className={CHOFER_SHELL} data-testid="chofer-shell">
        <RoleHeader compact kicker="Chofer · Lista para salir" title="Carga firmada" subtitle={saludo} accent="cyan" onLogout={onLogout}>{barraPersonal}</RoleHeader>
        <div className={`${CONTENIDO} space-y-4`}>
          <Card tone="success" className="text-center">
            <p className="mb-2 flex justify-center text-emerald-700 [&>svg]:h-10 [&>svg]:w-10"><Icons.Check /></p>
            <p className="text-base font-bold text-emerald-800">Carga autorizada</p>
            <p className="mt-1 text-sm text-emerald-700">
              {miRutaActiva?.firma_excepcion ? 'Sin firma (excepción registrada)' : 'Firmada por Producción'}
            </p>
          </Card>

          <FormBtn primary size="lg" className="w-full !text-lg"
            onClick={async () => {
              if (actions.updateRutaEstatus) {
                await actions.updateRutaEstatus(miRutaActiva.id, 'En progreso');
              }
              setStep('ruta');
            }}>
            <Icons.Truck /> Iniciar ruta
          </FormBtn>
        </div>
      </div>
    );
  }

  // ═══ STEP 2: RUTA ═══
  if (step === "ruta") return (
    <div className={CHOFER_SHELL} data-testid="chofer-shell" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 150px)" }}>
      <BannerColaOffline online={online} cola={colaOffline} sincronizando={sincronizando} onSincronizar={sincronizarCola} />
      <RoleHeader compact kicker="Chofer" title="En ruta" subtitle={saludo} accent="cyan"
        right={<div className="text-right"><p className="font-display text-lg font-bold text-white">{fmtMoney(totalCobrado)}</p><p className="text-xs text-cyan-200/80">cobrado</p></div>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {botonAsistencia}
          {botonActividades}
          <button type="button" onClick={() => setMapaVisible(v => !v)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-[13px] px-3 py-2 text-xs font-bold transition-all ${mapaVisible ? 'bg-blue-500 text-white' : 'bg-white/15 text-cyan-200'}`}>
            <Icons.MapPin /> {mapaVisible ? 'Ocultar mapa' : 'Ver mapa'}
          </button>
        </div>
        <div className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/10 p-3">
          <div className="flex-1"><div className="h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${ordenesConDetalle.length > 0 ? (entregadasList.length / ordenesConDetalle.length) * 100 : 0}%` }} /></div></div>
          <span className="text-sm font-bold text-white">{entregadasList.length}/{ordenesConDetalle.length}</span>
        </div>
      </RoleHeader>
      {/* Mapa embebido — se monta una sola vez para no perder la posición */}
      <div className={`${CONTENIDO} transition-all ${mapaVisible ? 'block' : 'hidden'}`}>
        <Suspense fallback={<div className="flex h-[340px] items-center justify-center rounded-[22px] bg-slate-100 text-sm text-slate-400">Cargando mapa...</div>}>
          <MapaRuta
            paradas={ordenesConDetalle.map(o => ({
              id:        o.id,
              latitud:   o.latitud,
              longitud:  o.longitud,
              nombre:    o.clienteNombre,
              direccion: o.direccion,
              entregada: o.entregada,
            }))}
          />
        </Suspense>
      </div>

      <div className={`${CONTENIDO} space-y-3`}>
        {pendientes.length > 0 && <div>
          <SectionLabel className="mb-2">Por entregar ({pendientes.length})</SectionLabel>
          {pendientes.map(o => (
            <Card key={o.id} padding="p-4" className="mb-2">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs text-slate-400">#{s(o.folio)}</span>
                  <p className="text-base font-bold text-slate-800">{o.clienteNombre}</p>
                  {o.esCredito
                    ? <span className="mt-0.5 inline-block rounded-full border border-violet-200/80 bg-violet-100/80 px-2 py-0.5 text-[10px] font-bold text-violet-900">A crédito</span>
                    : <span className="mt-0.5 inline-block rounded-full border border-emerald-200/80 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-emerald-900">Cobrar</span>
                  }
                </div>
                <p className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900">{fmtMoney(o.totalCalc)}</p>
              </div>
              {(o.direccion || o.contacto || o.referencia) && (
                <div className="mb-3 space-y-1.5">
                  {o.direccion && (
                    <div className="flex items-start gap-1.5 text-xs text-slate-600">
                      <span className="mt-0.5 flex-shrink-0 text-slate-500"><Icons.MapPin /></span>
                      <span className="line-clamp-2">{o.direccion}</span>
                    </div>
                  )}
                  {o.referencia && (
                    <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      <span className="mt-0.5 flex-shrink-0"><Icons.FileText /></span>
                      <span className="line-clamp-2">{o.referencia}</span>
                    </div>
                  )}
                  {o.contacto && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                      <span className="flex-shrink-0"><Icons.Users /></span>
                      <span className="min-w-0 flex-1 truncate">{o.contacto}</span>
                      {(() => {
                        const tel = extraerTelefono(o.contacto);
                        if (!tel) return null;
                        return (
                          <div className="flex gap-1.5">
                            <a
                              href={`tel:${tel}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex min-h-[40px] items-center gap-1.5 rounded-[12px] bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                              aria-label="Llamar"
                            >
                              Llamar
                            </a>
                            <a
                              href={`https://wa.me/52${tel}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex min-h-[40px] items-center gap-1.5 rounded-[12px] bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                              aria-label="WhatsApp"
                            >
                              WA
                            </a>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
              <div className="mb-3 flex flex-wrap gap-1">
                {o.items.map((it, i) => <span key={i} className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{it.cant}× {it.sku} · ${it.precio}</span>)}
              </div>
              {/* Mapa de la parada: se abre dentro de la app */}
              {urlMapaParada(o) && (
                <button type="button" onClick={() => setMapaParada(o)} data-testid="ver-mapa-parada"
                  className="mb-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[14px] bg-blue-600 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98]">
                  <Icons.MapPin /> Ver en el mapa
                </button>
              )}
              <FormBtn primary className="w-full" onClick={() => { setEntregaModal(o); setCobroMetodo(o.esCredito ? "Crédito" : "Efectivo"); setCobroRef(""); setFolioNota(""); setFotoEntrega(null); setCheckoutUrl(null); setShortUrl(null); }}>
                Entregar y cobrar
              </FormBtn>
              <FormBtn className="mt-2 w-full border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => abrirNoEntrega(o)}>
                No entregada
              </FormBtn>
            </Card>
          ))}
        </div>}
        {entregas.length > 0 && <div>
          <SectionLabel className="mb-2">Entregadas ({entregas.length})</SectionLabel>
          {entregas.map(e => (
            <Card key={e.ordenId || e.id} tone="success" padding="p-3" className="mb-2">
              <div className="flex items-center justify-between">
                <div><span className="font-mono text-xs text-emerald-600">#{s(e.folio)}</span>{e.folioNota&&<span className="ml-1 text-[10px] text-slate-400">Nota: {e.folioNota}</span>}<span className="ml-2 text-sm font-semibold text-slate-700">{s(e.cliente)}</span>{e.express && <span className="ml-1 rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] text-emerald-800">Exprés</span>}{e.factura && <span className="ml-1 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] text-violet-800">Factura</span>}</div>
                <div className="flex items-center gap-2 text-right">{estadoFotosEntrega(e) && <span data-testid="estado-fotos" title={estadoFotosEntrega(e) === 'guardadas' ? 'Fotos guardadas en el sistema' : 'Fotos por subir (se suben solas con señal)'} className={`[&>svg]:h-3.5 [&>svg]:w-3.5 ${estadoFotosEntrega(e) === 'guardadas' ? 'text-emerald-500' : 'text-amber-500'}`}><Icons.Camera /></span>}<div><p className="text-sm font-bold">{fmtMoney(e.total)}</p><p className="text-[10px] text-slate-400">{e.pago} · {e.hora}</p></div>{online && e.ordenId && (
                  <button type="button" onClick={() => abrirTicket(e, e.contacto)} className="flex min-h-[40px] flex-shrink-0 items-center rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-700" title="Enviar ticket" aria-label={`Enviar ticket ${s(e.folio)}`}>Ticket</button>
                )}</div>
              </div>
            </Card>
          ))}
        </div>}
        {mermas.length > 0 && <div>
          <SectionLabel className="mb-2 !text-amber-600">Mermas</SectionLabel>
          {mermas.map(m => (<Card key={m.id} tone="warning" padding="p-3" className="mb-2"><div className="flex justify-between text-xs"><span className="font-semibold">{m.cant}× {m.sku}</span><span className="text-amber-700">{m.causa} · {m.hora}</span></div></Card>))}
        </div>}
        <div className="h-20" />
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[640px] -translate-x-1/2 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur-xl md:max-w-3xl lg:max-w-5xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {/* Ver ruta completa en Maps si hay pendientes con coords */}
        {(() => {
          const conCoords = pendientes.filter(o => o.latitud && o.longitud);
          if (conCoords.length < 1) return null;
          const dest   = conCoords[conCoords.length - 1];
          const waypts = conCoords.slice(0, -1).map(o => `${o.latitud},${o.longitud}`).join('|');
          // Ruta completa — siempre usa Google Maps web (soporta waypoints múltiples)
          const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitud},${dest.longitud}${waypts ? `&waypoints=${encodeURIComponent(waypts)}` : ''}&travelmode=driving`;
          return (
            <button type="button" onClick={() => window.open(url, '_blank')}
              className="mb-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-field bg-ink py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              Ver ruta completa ({conCoords.length} paradas)
            </button>
          );
        })()}
        {/* Mobile-first: las 3 acciones en una sola fila (antes se apilaban y tapaban la lista). */}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => { setVentaModal(true); setCliNuevoForm(null); setVForm({ clienteId: "", cliente: "", sku: s(productos[0]?.sku) || "", cant: "", pago: "Efectivo", factura: false }); }} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-card bg-cyan-200 px-2 py-2 text-xs font-bold text-slate-950 transition-transform active:scale-[0.98]"><Icons.ShoppingCart />Venta rápida</button>
          <button type="button" onClick={() => { setMermaModal(true); setMForm({ sku: s(productos[0]?.sku) || "", cant: "", causa: "Bolsa rota" }); }} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-card bg-white/10 px-2 py-2 text-xs font-bold text-amber-200 transition-transform active:scale-[0.98]"><Icons.AlertTriangle />Merma</button>
          <button type="button" onClick={() => setStep("cierre")} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-card bg-white px-2 py-2 text-xs font-bold text-slate-950"><Icons.ClipboardCheck />Cerrar ruta</button>
        </div>
      </div>

      {/* Modal cobro */}
      <Modal open={!!entregaModal} onClose={() => setEntregaModal(null)} kicker="Cobro" safeBottom closeOnEscape={!confirmandoEntrega && !generandoLink}
        title={entregaModal ? `Entregar a ${entregaModal.clienteNombre}` : ""}
        footer={entregaModal && !checkoutUrl && (() => {
          // Tanda 6 🟢-4: deshabilitar confirmar si Transferencia sin foto.
          const faltaFotoTransf = cobroMetodo === "Transferencia" && !fotoTransf;
          const disabled = generandoLink || confirmandoEntrega || faltaFotoTransf;
          return (
            <FormBtn success size="lg" className="w-full" onClick={confirmarEntrega} disabled={disabled}>
              {generandoLink ? 'Generando link…'
                : confirmandoEntrega ? 'Registrando entrega…'
                : faltaFotoTransf ? 'Falta foto del comprobante'
                : cobroMetodo === "QR / Link de pago" ? 'Generar link de pago'
                : 'Confirmar entrega'}
            </FormBtn>
          );
        })()}>
        {entregaModal && (<>
          <div className="my-3 flex flex-wrap gap-1">{entregaModal.items.map((it, i) => <span key={i} className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{it.cant}× {it.sku}</span>)}</div>
          <p className="mb-4 font-display text-3xl font-bold tracking-[-0.04em] text-slate-900">{fmtMoney(entregaModal.totalCalc)}</p>
          <div className="mb-4">
            <FormInput label="Folio de nota (opcional)" value={folioNota} onChange={e=>setFolioNota(e.target.value)} placeholder="Ej: N-0001" />
          </div>
          <label className={LABEL}>¿Cómo paga?</label>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PAGOS.map(m => <ChoiceButton key={m} active={cobroMetodo===m} onClick={() => setCobroMetodo(m)}>{m}</ChoiceButton>)}
          </div>
          {cobroMetodo==="Transferencia" && <div className="mb-4 space-y-2">
            <DatosTransferencia config={data.configEmpresa} total={entregaModal.totalCalc} folio={s(entregaModal.folio)} telefono={extraerTelefono(entregaModal.contacto)} />
            <FormInput label="Referencia" value={cobroRef} onChange={e=>setCobroRef(e.target.value)} placeholder="Referencia (últimos 6 dígitos)" />
            {fotoTransf ? (
              <div><img src={fotoTransf} alt="Comprobante" className="h-32 w-full rounded-field border border-emerald-300 object-cover" /><button type="button" onClick={() => setFotoTransf(null)} className="mt-1 text-xs text-slate-400">Tomar otra</button></div>
            ) : (
              <CapturaFoto etiqueta="Foto del comprobante (obligatoria)" obligatoria onChange={handleImagePick(setFotoTransf)} />
            )}
          </div>}
          {cobroMetodo==="QR / Link de pago" && !checkoutUrl && (
            <Card padding="p-3" className="mb-4 !border-sky-200/80 !bg-sky-50/80">
              <p className="text-xs text-sky-700">Se genera un link de Stripe para que el cliente pague.</p>
            </Card>
          )}
          {cobroMetodo==="QR / Link de pago" && checkoutUrl && (
            <Card tone="success" padding="p-4" className="mb-4 space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Icons.Check /> Link de pago generado</p>
              <p className="break-all rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">{shortUrl || checkoutUrl}</p>
              <div className="grid grid-cols-2 gap-2">
                <FormBtn ghost onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="text-xs">Copiar link</FormBtn>
                {(() => {
                  const tel = extraerTelefono(entregaModal?.contacto);
                  const msg = `Hola, aquí está tu link de pago de Cubo Polar por ${fmtMoney(entregaModal.totalCalc)} MXN:\n${shortUrl || checkoutUrl}`;
                  const href = tel
                    ? `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`
                    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center justify-center rounded-field bg-emerald-600 px-5 py-3 text-sm font-semibold text-white">WhatsApp</a>;
                })()}
              </div>
              <button type="button" onClick={() => { setCheckoutUrl(null); setShortUrl(null); setEntregaModal(null); }} className="w-full py-2 text-xs font-semibold text-slate-500">Cerrar</button>
            </Card>
          )}
          {cobroMetodo==="Crédito" && <Card tone="warning" padding="p-3" className="mb-4"><p className="text-xs font-semibold text-amber-800">Se agrega a la cuenta del cliente</p></Card>}
          <div className="mb-4">
            <label className={`${LABEL} mb-2`}>Evidencia de entrega (opcional)</label>
            {fotoEntrega ? (
              <div><img src={fotoEntrega} alt="Evidencia" className="h-32 w-full rounded-field border border-emerald-300 object-cover" /><button type="button" onClick={() => setFotoEntrega(null)} className="mt-1 text-xs text-slate-400">Tomar otra</button></div>
            ) : (
              <CapturaFoto etiqueta="Foto de nota o entrega" onChange={handleImagePick(setFotoEntrega)} />
            )}
          </div>
        </>)}
      </Modal>

      {/* Mapa de la parada, dentro de la app */}
      <Modal open={!!mapaParada} onClose={() => setMapaParada(null)} kicker="Entrega" title={mapaParada ? s(mapaParada.clienteNombre) : ''} wide
        footer={<>
          {mapaParada && urlNavegacionParada(mapaParada) && (
            <a href={urlNavegacionParada(mapaParada)} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-field border border-line bg-white px-4 text-sm font-semibold text-ink">Navegar paso a paso</a>
          )}
          <FormBtn primary onClick={() => setMapaParada(null)}>Cerrar</FormBtn>
        </>}>
        {mapaParada && (
          <div className="space-y-3" data-testid="mapa-parada">
            {mapaParada.direccion && <p className="flex items-start gap-1.5 text-sm text-slate-700"><span className="mt-0.5 flex-shrink-0 text-slate-500"><Icons.MapPin /></span>{mapaParada.direccion}</p>}
            {mapaParada.referencia && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{mapaParada.referencia}</p>}
            <iframe title="Mapa de la entrega" src={urlMapaParada(mapaParada)} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              className="h-[52dvh] w-full rounded-card border border-line" />
            <p className="text-xs text-slate-500">“Navegar paso a paso” abre la app de mapas del teléfono para las indicaciones con voz.</p>
          </div>
        )}
      </Modal>

      {/* Ticket de la entrega para el cliente */}
      <Modal open={!!ticket} onClose={() => setTicket(null)} kicker="Entregado" title={ticket ? s(ticket.entrega.cliente) : ''} safeBottom
        footer={<FormBtn ghost className="flex-1" onClick={() => setTicket(null)}>Cerrar</FormBtn>}>
        {ticket && (
          <div className="space-y-3" data-testid="ticket-entrega">
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">Venta #{s(ticket.entrega.folio)}</p>
              <p className="font-display text-2xl font-bold text-emerald-900">{fmtMoney(ticket.entrega.total)}</p>
              <p className="text-sm text-emerald-800">{s(ticket.entrega.pago)}{ticket.entrega.hora ? ` · ${ticket.entrega.hora}` : ''}</p>
            </div>
            {ticket.cargando && <p className="text-sm text-slate-500">Preparando el ticket…</p>}
            {ticket.error && (
              <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                <p>{ticket.error}</p>
                <button type="button" onClick={() => abrirTicket(ticket.entrega, ticket.contacto)} className="mt-2 min-h-[40px] rounded-field border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900">Reintentar</button>
              </div>
            )}
            {ticket.url && (() => {
              const msg = mensajeTicket({ empresa: data.configEmpresa?.razonSocial, cliente: ticket.entrega.cliente, folio: ticket.entrega.folio, total: ticket.entrega.total, pago: ticket.entrega.pago, url: ticket.url });
              return (
                <>
                  <a href={enlaceWhatsApp(extraerTelefono(ticket.contacto), msg)} target="_blank" rel="noopener noreferrer"
                    className="flex min-h-[52px] w-full items-center justify-center rounded-field bg-emerald-600 px-5 text-base font-semibold text-white">Enviar ticket por WhatsApp</a>
                  <div className="grid grid-cols-2 gap-2">
                    <FormBtn onClick={compartirTicket}>Compartir</FormBtn>
                    <FormBtn onClick={copiarTicket}>Copiar link</FormBtn>
                  </div>
                  <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="block break-all rounded-field border border-line bg-slate-50 p-2 text-xs text-slate-600">{ticket.url}</a>
                </>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Modal venta express */}
      <Modal open={!!ventaModal} onClose={() => setVentaModal(false)} kicker="Venta rápida" title="Venta exprés" safeBottom closeOnEscape={!creandoVenta}
        footer={
          <FormBtn primary size="lg" className="w-full" onClick={crearVentaExpress} disabled={creandoVenta||!vForm.cant||n(vForm.cant)<=0||n(vForm.cant)>(restante[vForm.sku]||0)||(vForm.factura&&!!errorFacturaExpress)}>
            {creandoVenta ? "Creando venta…" : vForm.factura ? "Crear venta con factura" : "Crear venta"}
          </FormBtn>
        }>
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Cliente de lista</label>
            <select value={vForm.clienteId} onChange={e => {
              const id = e.target.value;
              const cli = clientesActivos.find(c => String(c.id) === String(id));
              setVForm(f => ({ ...f, clienteId: id, cliente: id ? s(cli?.nombre) : f.cliente }));
            }} className="min-h-[48px] w-full rounded-field border border-line bg-slate-50 px-3.5 py-3 text-[15px] text-ink focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15">
              <option value="">Seleccionar cliente...</option>
              {clientesActivos.map(c => <option key={c.id} value={c.id}>{s(c.nombre)}</option>)}
            </select>
          </div>
          <FormInput label="Cliente" value={vForm.cliente} onChange={e => setVForm(f=>({...f,cliente:e.target.value}))} placeholder="Nombre del cliente" />
          {/* Factura toggle */}
          <Card padding="p-3" className="flex items-center justify-between !bg-slate-50">
            <div><p className="text-sm font-semibold text-slate-700">¿Necesita factura?</p><p className="text-[10px] text-slate-400">Capturar datos fiscales completos</p></div>
            <button type="button" onClick={() => setVForm(f=>({...f,factura:!f.factura}))} aria-pressed={vForm.factura}
              className={`relative h-7 w-12 rounded-full transition-all ${vForm.factura ? "bg-violet-600" : "bg-slate-300"}`}>
              <div className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${vForm.factura ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </Card>
          {vForm.factura && (
            <Card padding="p-3" className="space-y-1 !border-violet-200/80 !bg-violet-50/80">
              {errorFacturaExpress ? (
                <>
                  <p className="text-xs font-semibold text-violet-700">{errorFacturaExpress}</p>
                  {!cliNuevoForm ? (
                    <button type="button" onClick={() => setCliNuevoForm({ nombre: s(vForm.cliente), rfc: '', regimen: '601', usoCfdi: 'G03', cp: '', correo: '' })}
                      className="min-h-[44px] w-full rounded-field border border-violet-300 bg-white text-sm font-bold text-violet-700">+ Registrar cliente nuevo</button>
                  ) : (
                    <div className="space-y-2">
                      <FormInput label="Nombre o razón social" value={cliNuevoForm.nombre} onChange={e => setCliNuevoForm(f => ({ ...f, nombre: e.target.value }))} />
                      <FormInput label="RFC" value={cliNuevoForm.rfc} maxLength={13} autoCapitalize="characters" onChange={e => setCliNuevoForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} />
                      <div>
                        <label className={LABEL}>Régimen fiscal</label>
                        <select value={cliNuevoForm.regimen} onChange={e => setCliNuevoForm(f => ({ ...f, regimen: e.target.value }))} className="min-h-[48px] w-full rounded-field border border-line bg-white px-3 text-sm">
                          {REGIMENES_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>Uso de CFDI</label>
                        <select value={cliNuevoForm.usoCfdi} onChange={e => setCliNuevoForm(f => ({ ...f, usoCfdi: e.target.value }))} className="min-h-[48px] w-full rounded-field border border-line bg-white px-3 text-sm">
                          <option value="G01">G01 — Adquisición de mercancías</option>
                          <option value="G03">G03 — Gastos en general</option>
                          <option value="S01">S01 — Sin efectos fiscales</option>
                        </select>
                      </div>
                      <FormInput label="Código postal fiscal" inputMode="numeric" maxLength={5} value={cliNuevoForm.cp} onChange={e => setCliNuevoForm(f => ({ ...f, cp: e.target.value.replace(/\D/g, '') }))} />
                      <FormInput label="Correo para la factura" type="email" value={cliNuevoForm.correo} onChange={e => setCliNuevoForm(f => ({ ...f, correo: e.target.value }))} />
                      <div className="flex gap-2">
                        <FormBtn size="lg" className="flex-1" onClick={() => setCliNuevoForm(null)} disabled={guardandoCli}>Cancelar</FormBtn>
                        <FormBtn primary size="lg" className="flex-[2]" onClick={registrarClienteNuevo} loading={guardandoCli}>Registrar cliente</FormBtn>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[10px] font-bold uppercase text-violet-600">Datos fiscales del cliente</p>
                  <p className="text-sm font-semibold text-slate-800">{s(clienteExpressSel?.nombre)}</p>
                  <p className="font-mono text-xs text-slate-600">RFC {s(clienteExpressSel?.rfc)} · Régimen {s(clienteExpressSel?.regimen) || '—'} · Uso {s(clienteExpressSel?.uso_cfdi) || '—'} · CP {s(clienteExpressSel?.cp) || '—'}</p>
                  <p className="text-[10px] text-slate-400">La factura se emite después desde Facturación con estos datos.</p>
                </>
              )}
            </Card>
          )}
          <div><label className={LABEL}>Producto</label>
            <div className="grid grid-cols-2 gap-2">{productos.map(p => {
              const sku = s(p.sku);
              const disp = restante[sku] || 0;
              return <ChoiceButton key={sku} active={vForm.sku===sku} onClick={() => setVForm(f=>({...f,sku}))} className="text-xs">
                {s(p.nombre)}<br/><span className="text-[10px] font-normal text-slate-400">${n(p.precio)} · quedan {disp}</span>
              </ChoiceButton>;
            })}</div>
          </div>
          <FormInput label="Cantidad" type="number" min="0" inputMode="numeric" value={vForm.cant} onChange={e => setVForm(f=>({...f,cant:e.target.value}))}
            inputClassName="text-center !text-2xl font-extrabold" placeholder="0" autoFocus
            error={vForm.cant && n(vForm.cant) > (restante[vForm.sku] || 0) ? `Solo te quedan ${restante[vForm.sku] || 0}` : undefined} />
          {vForm.cant && n(vForm.cant) > 0 && n(vForm.cant) <= (restante[vForm.sku] || 0) && (
            <Card padding="p-3" className="space-y-0.5 text-center !border-sky-200/80 !bg-sky-50/80">
              {/* 088: mismo precio e IVA 0% que registra el servidor */}
              <p className="text-xs text-slate-500">Precio: {fmtMoney(getPrice(vForm.clienteId || clienteExpressSel?.id || null, vForm.sku))} · IVA 0% (hielo)</p>
              <p className="font-display text-2xl font-bold tracking-[-0.04em] text-slate-900">{fmtMoney(n(vForm.cant) * getPrice(vForm.clienteId || clienteExpressSel?.id || null, vForm.sku))}</p>
            </Card>
          )}
          <div><label className={LABEL}>Pago</label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{PAGOS.filter(m => m !== "QR / Link de pago").map(m => <ChoiceButton key={m} active={vForm.pago===m} onClick={() => setVForm(f=>({...f,pago:m}))} className="text-[11px]">{m==="QR / Link de pago"?"QR/Link":m}</ChoiceButton>)}</div>
          </div>

        </div>
      </Modal>

      {/* Modal merma */}
      <Modal open={!!mermaModal} onClose={() => setMermaModal(false)} kicker="Incidencia" title="Registrar merma" safeBottom closeOnEscape={!registrandoMerma}
        footer={
          <FormBtn warning size="lg" className="w-full" onClick={registrarMerma} disabled={registrandoMerma||!mForm.cant||n(mForm.cant)<=0||!fotoMerma}>
            {registrandoMerma ? "Registrando…" : "Registrar merma"}
          </FormBtn>
        }>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">{productos.map(p => <ChoiceButton key={p.sku} tone="amber" active={mForm.sku===s(p.sku)} onClick={() => setMForm(f=>({...f,sku:s(p.sku)}))} className="text-xs">{s(p.nombre)}</ChoiceButton>)}</div>
          <FormInput label="Cantidad" type="number" min="0" value={mForm.cant} onChange={e => setMForm(f=>({...f,cant:e.target.value}))} inputClassName="text-center !text-xl font-bold" placeholder="Cantidad" />
          <div className="grid grid-cols-2 gap-2">{MERMA_CAUSAS.map(c => <ChoiceButton key={c} tone="amber" active={mForm.causa===c} onClick={() => setMForm(f=>({...f,causa:c}))} className="text-xs">{c}</ChoiceButton>)}</div>
        </div>
        <div className="mt-4">
          <label className={`${LABEL} mb-2`}>Evidencia (foto) *</label>
          {fotoMerma ? (
            <div className="mb-3"><img src={fotoMerma} alt="Evidencia" className="h-32 w-full rounded-field border border-emerald-300 object-cover" /><button type="button" onClick={() => setFotoMerma(null)} className="mt-1 text-xs text-slate-400">Tomar otra</button></div>
          ) : (
            <CapturaFoto etiqueta="Foto de evidencia" onChange={handleImagePick(setFotoMerma)} />
          )}
        </div>
      </Modal>

      {/* Modal No entregada */}
      <Modal open={!!noEntregaModal} onClose={() => !marcandoNoEntrega && setNoEntregaModal(null)} kicker="Incidencia" title="Marcar como no entregada" safeBottom closeOnEscape={!marcandoNoEntrega}
        footer={noEntregaModal && (<>
          <FormBtn size="lg" className="flex-1" onClick={() => setNoEntregaModal(null)} disabled={marcandoNoEntrega}>Cancelar</FormBtn>
          <FormBtn warning size="lg" className="flex-[2]" onClick={confirmarNoEntrega} disabled={marcandoNoEntrega || (noEntregaForm.motivo === 'Otro' && !s(noEntregaForm.otroMotivo).trim())}>
            {marcandoNoEntrega ? 'Guardando…' : 'Confirmar'}
          </FormBtn>
        </>)}>
        {noEntregaModal && (<>
          <p className="mb-4 text-sm text-slate-500">{s(noEntregaModal.clienteNombre || noEntregaModal.cliente)}</p>
          <div className="space-y-3">
            <div>
              <label className={`${LABEL} mb-2`}>Motivo *</label>
              <div className="grid grid-cols-1 gap-2">
                {MOTIVOS_NO_ENTREGA.map(m => (
                  <ChoiceButton key={m} tone="amber" active={noEntregaForm.motivo === m} onClick={() => setNoEntregaForm(f => ({ ...f, motivo: m }))} className="text-left text-xs">
                    {m}
                  </ChoiceButton>
                ))}
              </div>
              {noEntregaForm.motivo === 'Otro' && (
                <div className="mt-2">
                  <FormInput label="Describe el motivo" type="text" value={noEntregaForm.otroMotivo}
                    onChange={e => setNoEntregaForm(f => ({ ...f, otroMotivo: e.target.value }))}
                    placeholder="Describe el motivo" autoFocus />
                </div>
              )}
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-field bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">Reagendar para próxima ruta</p>
                <p className="text-[11px] text-slate-500">El admin verá la marca al armar la próxima ruta.</p>
              </div>
              <input
                type="checkbox"
                checked={noEntregaForm.reagendar}
                onChange={e => setNoEntregaForm(f => ({ ...f, reagendar: e.target.checked }))}
                className="h-5 w-5 rounded border-slate-300 accent-amber-500"
              />
            </label>
          </div>
        </>)}
      </Modal>
    </div>
  );

  // ═══ STEP 3: CIERRE ═══
  if (step === "cierre") {
    const difConteo = balanceCierre ? diferenciasConteo(balanceCierre, conteoForm) : { faltante: {}, sobrante: {} };
    const totBal = totalesBalance(balanceCierre || []);
    const mermasSinRegistrar = mermas.filter(m => !m.registrada).length;
    const cobrosPorMetodo = {};
    for (const e of entregas) cobrosPorMetodo[e.pago] = (cobrosPorMetodo[e.pago]||0) + n(e.total);

    return (
      <div className={CHOFER_SHELL} data-testid="chofer-shell">
        <BannerColaOffline online={online} cola={colaOffline} sincronizando={sincronizando} onSincronizar={sincronizarCola} />
        <RoleHeader compact kicker="Chofer · Paso 3 de 3" title="Cierre de ruta" subtitle={`${saludo} · ${fmtDate(new Date())}`} accent="cyan"
          right={!rutaCerrada && <button type="button" onClick={() => setStep("ruta")} className="inline-flex min-h-[44px] items-center rounded-[13px] border border-white/10 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white">← Volver</button>}>{barraPersonal}</RoleHeader>
        <div className={`${CONTENIDO} space-y-4`}>
          <Card>
            <SectionLabel className="mb-3">Inventario del camión</SectionLabel>
            {!balanceCierre ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Primero registra ventas, cobros{mermasSinRegistrar > 0 ? ` y ${mermasSinRegistrar} ${mermasSinRegistrar === 1 ? 'merma' : 'mermas'}` : ''}. El sistema calcula lo que debe regresar en el camión.</p>
                <FormBtn primary className="w-full" onClick={prepararCierre} disabled={preparandoCierre || rutaCerrada}>{preparandoCierre ? 'Registrando…' : 'Registrar ventas y mermas'}</FormBtn>
              </div>
            ) : (
              <div>
                <div className="mb-1 grid grid-cols-5 gap-1 text-[10px] font-bold uppercase text-slate-400"><span>Producto</span><span className="text-center">Cargó</span><span className="text-center">Entregó</span><span className="text-center">Merma</span><span className="text-center">Contado</span></div>
                {balanceCierre.map(b => {
                  const prod = productos.find(p => s(p.sku) === b.sku);
                  const falta = difConteo.faltante[b.sku] || 0;
                  const sobra = difConteo.sobrante[b.sku] || 0;
                  return (
                    <div key={b.sku} className="grid grid-cols-5 items-center gap-1 py-1 text-sm">
                      <span className="text-xs font-semibold text-slate-700">{prod ? s(prod.nombre) : b.sku}<span className="block text-[10px] font-normal text-slate-400">debe regresar {b.restante}</span></span>
                      <span className="text-center text-slate-500">{b.cargado}</span>
                      <span className="text-center text-slate-500">{b.entregado}</span>
                      <span className={`text-center ${b.merma > 0 ? "font-semibold text-amber-600" : "text-slate-500"}`}>{b.merma}</span>
                      <input type="number" inputMode="numeric" min="0" value={conteoForm[b.sku] ?? ''} disabled={rutaCerrada}
                        onChange={e => { setConteoForm(f => ({ ...f, [b.sku]: e.target.value })); setFaltanteCierre(null); }}
                        className={`min-h-[40px] w-full rounded-lg border px-1 py-1.5 text-center text-base ${falta > 0 || sobra > 0 ? 'border-red-300 text-red-700' : 'border-slate-200'}`} />
                    </div>
                  );
                })}
                <div className="mt-1 grid grid-cols-5 items-center gap-1 border-t border-slate-200 py-1.5 text-xs font-bold text-slate-700">
                  <span>Total</span><span className="text-center">{totBal.cargado}</span><span className="text-center">{totBal.entregado}</span><span className="text-center text-amber-600">{totBal.merma}</span><span className="text-center">{totBal.restante}</span>
                </div>
                {(Object.keys(difConteo.faltante).length > 0 || faltanteCierre) && (
                  <Card tone="danger" padding="p-3" className="mt-3 space-y-2">
                    <p className="text-xs font-bold text-red-700">Falta producto según el sistema. Vuelve a contar o registra la merma (causa y foto):</p>
                    {Object.entries(faltanteCierre || difConteo.faltante).map(([sku, q]) => (
                      <button type="button" key={sku} onClick={() => abrirMermaFaltante(sku, q)} className="min-h-[40px] w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-left text-xs font-semibold text-red-700">Registrar merma de {q}× {sku}</button>
                    ))}
                    {mermasSinRegistrar > 0 && (
                      <FormBtn primary className="w-full text-xs" onClick={prepararCierre} disabled={preparandoCierre}>{preparandoCierre ? 'Registrando…' : 'Registrar mermas y actualizar'}</FormBtn>
                    )}
                  </Card>
                )}
                {Object.keys(difConteo.sobrante).length > 0 && (
                  <p className="mt-2 text-xs font-semibold text-red-600">El conteo supera lo que debe traer el camión: {Object.entries(difConteo.sobrante).map(([sku, q]) => `${q}× ${sku}`).join(', ')}. Vuelve a contar.</p>
                )}
              </div>
            )}
          </Card>
          <Card>
            <SectionLabel className="mb-3">Cobros</SectionLabel>
            {Object.entries(cobrosPorMetodo).map(([m, v]) => <div key={m} className="flex justify-between py-0.5 text-sm"><span className="text-slate-500">{m}</span><span className="font-bold">{fmtMoney(v)}</span></div>)}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2"><span className="text-sm font-bold text-slate-700">Efectivo a entregar</span><span className="text-xl font-extrabold text-emerald-600">{fmtMoney(cobrosPorMetodo["Efectivo"]||0)}</span></div>
            {totalCredito > 0 && <div className="mt-1 flex justify-between text-sm"><span className="font-semibold text-amber-600">Crédito</span><span className="font-bold text-amber-600">{fmtMoney(totalCredito)}</span></div>}
          </Card>
          <Card>
            <SectionLabel className="mb-3">Detalle ({entregas.length})</SectionLabel>
            {entregas.map(e => (
              <div key={e.ordenId||e.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 text-xs">
                <div><span className="font-mono text-slate-400">#{s(e.folio)}</span><span className="ml-1.5 font-semibold text-slate-700">{s(e.cliente)}</span></div>
                <div className="text-right"><span className="font-bold">{fmtMoney(e.total)}</span><span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] ${e.pago==="Crédito"?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-500"}`}>{e.pago}</span></div>
              </div>
            ))}
          </Card>
          {mermas.length > 0 && <Card tone="warning">
            <SectionLabel className="mb-2 !text-amber-700">Mermas</SectionLabel>
            {mermas.map(m => <div key={m.id} className="flex justify-between py-1 text-xs"><span>{m.cant}× {m.sku}</span><span className="text-amber-600">{m.causa}</span></div>)}
          </Card>}
          {pendientes.length > 0 && <Card tone="danger" padding="p-3"><p className="flex items-center gap-1.5 text-xs font-bold text-red-700"><Icons.AlertTriangle /> {pendientes.length} órdenes sin entregar</p></Card>}

          {!rutaCerrada ? (
            <FormBtn primary size="lg" className="w-full !text-lg" onClick={cerrarRuta} disabled={cerrandoRuta || !balanceCierre || Object.keys(difConteo.faltante).length > 0 || Object.keys(difConteo.sobrante).length > 0}>
              {cerrandoRuta ? 'Cerrando ruta…' : (balanceCierre ? 'Confirmar devolución y cerrar ruta' : 'Registra ventas y mermas para contar')}
            </FormBtn>
          ) : (
            <div className="space-y-4 text-center">
              <Card tone="success">
                <p className="mb-2 flex justify-center text-emerald-700 [&>svg]:h-8 [&>svg]:w-8"><Icons.Check /></p>
                <p className="text-base font-bold text-emerald-800">Ruta cerrada</p>
                <p className="mt-1 text-xs text-emerald-700">La devolución quedó registrada en el cuarto frío</p>
              </Card>
              <FormBtn primary size="lg" className="w-full" onClick={onLogout}>Cerrar sesión</FormBtn>
            </div>
          )}
          <div className="h-8" />
        </div>
      </div>
    );
  }
  return null;
}

// Tanda 22: estado de la cola offline. Sin conexión → aviso de que las
// operaciones se guardan en el teléfono; con pendientes y conexión →
// contador + botón de sincronización manual; fallidas → alerta roja.
function BannerColaOffline({ online, cola, sincronizando, onSincronizar }) {
  const pendientes = mutacionesPendientes(cola).length;
  const fallidas = mutacionesFallidas(cola).length;
  if (online && pendientes === 0 && fallidas === 0) return null;
  return (
    <div className={`flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold ${!online ? 'border-b border-amber-200 bg-amber-100 text-amber-800' : 'border-b border-cyan-200 bg-cyan-50 text-cyan-800'}`} role="status" aria-live="polite">
      <span>
        {!online
          ? `Sin conexión — tus operaciones se guardan en el teléfono${pendientes > 0 ? ` (${pendientes} en espera)` : ''}`
          : `${pendientes} ${pendientes === 1 ? 'operación pendiente' : 'operaciones pendientes'} de sincronizar`}
        {fallidas > 0 && <span className="ml-2 inline-flex items-center gap-1 font-bold text-red-700"><Icons.AlertTriangle /> {fallidas} sin poder sincronizar — avisa al admin</span>}
      </span>
      {online && pendientes > 0 && (
        <button
          type="button"
          onClick={onSincronizar}
          disabled={sincronizando}
          className="min-h-[32px] flex-shrink-0 rounded-lg bg-cyan-700 px-3 py-1.5 font-bold text-white disabled:opacity-50"
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      )}
    </div>
  );
}
