import { useEffect, useMemo, useRef, useState } from 'react';
import { diaNegocio } from '../utils/fechas';
import { resolverOperacion, claveProduccion } from '../data/produccionAtomicaLogic';
import { MAQUINAS_PRODUCCION, SALIDAS_BARRA, seProduceSinEmpaque, skusProducibles, esPreparacion, vistaPreviaPreparacion, clavePreparacion } from '../data/preparacionBarraLogic';
import { claveSalida, claveTraspaso, claveMermaCuarto, MOTIVOS_SALIDA_MANUAL, motivoSalidaManual } from '../data/stockContratosLogic';
import { mermasActivas } from '../data/mermasLogic';
import { resumenCongeladores, resumenMermas } from '../data/produccionResumenLogic';
import { supabase } from '../lib/supabase';
import { s, n, fmtDate, fmtPct, todayLocalISO } from '../utils/safe';
import { compressImage } from '../utils/compressImage';
import { puedeAgregarAlCuarto, tarimasOcupadasEnCuarto, colorTarimasUso } from '../utils/tarimas';
import BotonFirmasPendientes from './BotonFirmasPendientes';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel, StatusBadge, RoleHeader, HeaderStat, SegmentedTabs, ChoiceButton, KpiTile, CapacityBar } from './ui/Components';
import { Icons } from './ui/Icons';
import { useToast } from './ui/Toast';
import { EmptyState } from './ui/Skeleton';

// Fase A4 (convergencia visual por rol): esta vista usa las primitivas del
// shell de Administración (cabecera, pestañas segmentadas, tarjetas, Modal,
// FormInput/FormBtn, ChoiceButton, toast global). Los flujos (producir,
// congeladores, mermas, preparar desde barra), sus validaciones, fotos, firmas,
// UUIDs de operación y llamadas al store no cambian.
//   embedded: la vista vive dentro del shell compartido (sin cabecera propia).
//   tab/onTab: pestaña controlada por el shell (menú por rol); sin ellas, estado interno.
// empaqueMap se deriva dinámicamente de data.productos.empaque_sku
const TABS = [{ k: "producir", l: "Producción", icon: "Factory" }, { k: "cuartos", l: "Congeladores", icon: "Warehouse" }, { k: "mermas", l: "Mermas", icon: "AlertTriangle" }, { k: "preparar", l: "Preparar", icon: "Snowflake" }];
// B2: dentro del shell el contenido ocupa el workspace como las vistas de Admin.
const CONTENIDO = "mx-auto w-full max-w-[640px] space-y-3 md:max-w-3xl lg:max-w-5xl";
const CONTENIDO_SHELL = "w-full space-y-3";
// B3.2: rejilla del resumen de cada módulo (misma familia KpiTile; el número de piezas varía por módulo).
const RESUMEN = "grid grid-cols-1 gap-3 sm:grid-cols-3";
const LABEL = "mb-1.5 block text-sm font-medium text-slate-700";

export default function ProduccionStandaloneView({ user, data, actions, onLogout, embedded = false, tab: tabProp, onTab }) {
  const [tabLocal, setTabLocal] = useState("producir");
  const tab = tabProp ?? tabLocal;
  const setTab = (k) => { if (onTab) onTab(k); else setTabLocal(k); };
  const [modal, setModal] = useState(false);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [sacarModal, setSacarModal] = useState(null); // { cfId, cfNombre }
  // OP-01D: "Preparar desde barra" (reemplaza a las Transformaciones de agosto).
  const [prepForm, setPrepForm] = useState({ cuarto: "CF-1", salida: SALIDAS_BARRA[0], barras: "" });
  const [guardandoPrep, setGuardandoPrep] = useState(false);

  // Producir form — includes destino (congelador) + merma inline opcional
  const [form, setForm] = useState({ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" });
  const [fotoMermaProdFile, setFotoMermaProdFile] = useState(null);
  const [fotoMermaProdPreview, setFotoMermaProdPreview] = useState('');
  const [guardandoProd, setGuardandoProd] = useState(false);
  const [tForm, setTForm] = useState({ origen: "CF-1", destino: "CF-2", sku: "", cantidad: "" });
  const [haciendoTraspaso, setHaciendoTraspaso] = useState(false);
  const [sacarForm, setSacarForm] = useState({ sku: "", cantidad: "", motivo: "", detalle: "" }); // R2 (084): sin motivo por defecto; la carga de ruta ya no es una salida manual
  const [haciendoSalida, setHaciendoSalida] = useState(false);

  // Simulated pending cargas from chofers (vacío — no usar mock data con SKUs hardcodeados)
  const [cargasPendientes, setCargasPendientes] = useState([]);

  const [mermaModal, setMermaModal] = useState(false);
  const [mForm, setMForm] = useState({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
  // (El bloqueo de scroll y Escape de las 5 hojas los hace el Modal compartido.)
  const [fotoMermaFile, setFotoMermaFile] = useState(null);
  const [fotoMermaPreview, setFotoMermaPreview] = useState('');
  const [guardandoMerma, setGuardandoMerma] = useState(false);
  // Mig 076: operacion_id del intento lógico (reintento/doble click = mismo
  // UUID) + guard síncrono contra submits paralelos antes del re-render.
  const opProdRef = useRef(null);
  const opPrepRef = useRef(null);
  const opSalidaRef = useRef(null);   // R2 (084)
  // 102: merma de cuarto — UUID del intento y foto ya subida se conservan entre
  // reintentos (una respuesta perdida no duplica la pérdida).
  const opMermaRef = useRef(null);
  const fotoMermaSubidaRef = useRef(null);
  const opTraspasoRef = useRef(null); // R2 (084)
  const enVueloProd = useRef(false);
  const enVueloPrep = useRef(false);

  const toast = useToast();
  const showToast = (msg, tipo = "success") => { (toast?.[tipo] || toast?.info)?.(msg); };

  // Handler compartido: comprime cliente-side, valida 5MB como red de
  // seguridad, y guarda el File comprimido + un objectURL para preview.
  const handleImagePickFile = (clearFn, setFile, setPreview) => async (e) => {
    const original = e.target.files?.[0];
    if (!original) return;
    if (original.size > 2 * 1024 * 1024) showToast('Procesando foto…', 'info');
    const file = await compressImage(original);
    if (file.size > 5 * 1024 * 1024) {
      showToast('Foto muy grande, máx 5MB', 'error');
      e.target.value = '';
      return;
    }
    clearFn();
    setFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const MERMA_CAUSAS = ["Bolsa rota", "Mal sellado", "Hielo derretido", "Falla de equipo", "Desmolde fallido", "Contaminación", "Otro"];

  useEffect(() => {
    return () => {
      if (fotoMermaPreview && fotoMermaPreview.startsWith('blob:')) {
        URL.revokeObjectURL(fotoMermaPreview);
      }
    };
  }, [fotoMermaPreview]);

  useEffect(() => {
    return () => {
      if (fotoMermaProdPreview && fotoMermaProdPreview.startsWith('blob:')) {
        URL.revokeObjectURL(fotoMermaProdPreview);
      }
    };
  }, [fotoMermaProdPreview]);

  // Escape: lo gestiona el Modal compartido (closeOnEscape bloqueado mientras
  // hay un guardado en curso; "Ya produje hielo" limpia la foto al cerrar).

  const clearFotoMerma = () => {
    if (fotoMermaPreview && fotoMermaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(fotoMermaPreview);
    }
    setFotoMermaFile(null);
    setFotoMermaPreview('');
  };

  const clearFotoMermaProd = () => {
    if (fotoMermaProdPreview && fotoMermaProdPreview.startsWith('blob:')) {
      URL.revokeObjectURL(fotoMermaProdPreview);
    }
    setFotoMermaProdFile(null);
    setFotoMermaProdPreview('');
  };

  const resetFormProd = () => {
    opProdRef.current = null;
    setForm({ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" });
    clearFotoMermaProd();
  };

  const registrarMerma = async () => {
    if (!mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile) return;
    if (!s(mForm.congelador)) { showToast('Selecciona el congelador donde ocurrió la merma', 'error'); return; }
    if (fotoMermaFile.size > 5 * 1024 * 1024) {
      showToast('Foto muy grande, máx 5MB', 'error');
      return;
    }
    const cant = n(mForm.cantidad);

    setGuardandoMerma(true);
    try {
      let filePath = fotoMermaSubidaRef.current?.file === fotoMermaFile ? fotoMermaSubidaRef.current.path : null;
      if (!filePath) {
        const authOwner = s(user?.auth_id || user?.id || 'usuario');
        const ext = (fotoMermaFile.name?.split('.').pop() || 'jpg').toLowerCase();
        const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg';
        filePath = `${authOwner}/${todayLocalISO()}/${Date.now()}-${mForm.sku}.${safeExt}`;
        const { error: uploadErr } = await supabase.storage
          .from('mermas')
          .upload(filePath, fotoMermaFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: fotoMermaFile.type || 'image/jpeg',
          });
        if (uploadErr) {
          showToast('No se pudo subir la foto', 'error');
          return;
        }
        fotoMermaSubidaRef.current = { file: fotoMermaFile, path: filePath };
      }

      // 102: solo el congelador elegido (registrar_merma_cuarto). Si falla se
      // conservan la foto y el UUID: reintentar no registra otra pérdida.
      const datos = { cuartoId: s(mForm.congelador), sku: mForm.sku, cantidad: cant, causa: mForm.causa, foto: filePath };
      const op = resolverOperacion(opMermaRef.current, claveMermaCuarto(datos));
      opMermaRef.current = op;
      const mermaErr = await actions.registrarMermaCuarto({ ...datos, operacionId: op.id });
      if (mermaErr) {
        showToast(mermaErr.error || 'No se pudo registrar la merma. Intenta de nuevo.', 'error');
        return;
      }
      opMermaRef.current = null;
      fotoMermaSubidaRef.current = null;

      const cfNom = s(cuartos.find(c => s(c.id) === s(mForm.congelador))?.nombre) || s(mForm.congelador);
      showToast("Merma: " + cant + "× " + mForm.sku + " en " + cfNom + " registrada");
      setMermaModal(false);
      clearFotoMerma();
      setMForm({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
    } finally {
      setGuardandoMerma(false);
    }
  };

  const prodHoy = useMemo(() => {
    const hoy = diaNegocio();
    return data.produccion.filter(p => p.fecha && p.fecha.slice(0, 10) === hoy && !esPreparacion(p));
  }, [data.produccion]);

  const totalHoy = useMemo(() => prodHoy.reduce((s, p) => s + n(p.cantidad), 0), [prodHoy]);

  const mermasHoyList = useMemo(() => {
    const hoy = diaNegocio();
    return mermasActivas(data.mermas).filter(m => s(m.fecha).slice(0, 10) === hoy);
  }, [data.mermas]);

  const mermaHoy = useMemo(() => mermasHoyList.reduce((sum, item) => sum + n(item.cantidad), 0), [mermasHoyList]);
  // OP-01D: las bolsas de picada/triturada de barra solo nacen de "Preparar desde barra".
  const skuOptions = useMemo(() => skusProducibles(data.productos), [data.productos]);

  // ───────────── PANEL "QUÉ NECESITAS PRODUCIR" ─────────────
  // Mismo cálculo que el dashboard de admin para mantener consistencia total.
  const productosHielo = useMemo(
    () => (data.productos || []).filter(p => s(p.tipo) === "Producto Terminado"),
    [data.productos]
  );

  const estatusPendientes = useMemo(() => new Set(["creada", "asignada", "pendiente", "en proceso", "en_proceso", "enprogreso"]), []);

  const pedidosPendPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    for (const ord of (data.ordenes || [])) {
      const est = s(ord.estatus).toLowerCase();
      if (!estatusPendientes.has(est)) continue;
      if (Array.isArray(ord.preciosSnapshot) && ord.preciosSnapshot.length > 0) {
        for (const ln of ord.preciosSnapshot) {
          const sku = s(ln.sku);
          if (!sku) continue;
          acc[sku] = (acc[sku] || 0) + n(ln.qty || ln.cantidad);
        }
        continue;
      }
      const raw = s(ord.productos);
      if (!raw) continue;
      raw.split(',').forEach(part => {
        const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
        if (!mt) return;
        const qty = Number(mt[1] || 0);
        const sku = s(mt[2]);
        if (!sku) return;
        acc[sku] = (acc[sku] || 0) + qty;
      });
    }
    return acc;
  }, [data.ordenes, productosHielo, estatusPendientes]);

  const stockCuartosPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    for (const cf of (data.cuartosFrios || [])) {
      const st = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
      for (const [sku, qty] of Object.entries(st)) {
        acc[s(sku)] = (acc[s(sku)] || 0) + n(qty);
      }
    }
    return acc;
  }, [data.cuartosFrios, productosHielo]);

  const reservadoEnRutasPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    const rutasActivas = (data.rutas || []).filter(r => {
      const est = s(r.estatus).toLowerCase();
      return est === 'programada' || est === 'en progreso' || est === 'en_progreso';
    });
    for (const ruta of rutasActivas) {
      const carga = ruta.carga_autorizada || ruta.cargaAutorizada || ruta.carga || {};
      for (const [sku, qty] of Object.entries(carga)) {
        acc[s(sku)] = (acc[s(sku)] || 0) + Number(qty || 0);
      }
    }
    return acc;
  }, [data.rutas, productosHielo]);

  const producidoHoyPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    const hoy = diaNegocio();
    for (const pr of (data.produccion || [])) {
      if (!s(pr.fecha).startsWith(hoy) || esPreparacion(pr)) continue;
      const sku = s(pr.sku);
      acc[sku] = (acc[sku] || 0) + n(pr.cantidad);
    }
    return acc;
  }, [data.produccion, productosHielo]);

  const tableroDemanda = useMemo(() => {
    return productosHielo.map(p => {
      const sku = s(p.sku);
      const pendientes = n(pedidosPendPorSku[sku]);
      const stockBruto = n(stockCuartosPorSku[sku]);
      const reservado = n(reservadoEnRutasPorSku[sku]);
      const stock = Math.max(0, stockBruto - reservado);
      const producidoHoy = n(producidoHoyPorSku[sku]);
      const stockMinimo = n(p.stock_minimo);
      const faltante = Math.max(0, pendientes + stockMinimo - stock);
      const bajoMinimo = stockMinimo > 0 && stock < stockMinimo;
      return { sku, producto: s(p.nombre), pendientes, stock, stockMinimo, faltante, producidoHoy, bajoMinimo };
    });
  }, [productosHielo, pedidosPendPorSku, stockCuartosPorSku, reservadoEnRutasPorSku, producidoHoyPorSku]);

  const hayFaltante = useMemo(() => tableroDemanda.some(r => r.faltante > 0), [tableroDemanda]);

  // OP-01D: preparar N barras enteras → 2N bolsas (picada o triturada); el
  // servidor consume la barra y el empaque configurado en un solo paso.
  const preparacionesHoy = useMemo(() => {
    const hoy = diaNegocio();
    return (data.produccion || []).filter(p => esPreparacion(p) && s(p.fecha).slice(0, 10) === hoy && s(p.estatus) !== 'Revertida');
  }, [data.produccion]);
  const resumenPrep = useMemo(() => ({
    preparaciones: preparacionesHoy.length,
    barras: preparacionesHoy.reduce((t, p) => t + n(p.input_kg ?? p.inputKg), 0),
    bolsas: preparacionesHoy.reduce((t, p) => t + n(p.cantidad), 0),
  }), [preparacionesHoy]);
  const vistaPrep = useMemo(() => vistaPreviaPreparacion({
    productos: data.productos, cuartos: data.cuartosFrios, cuartoId: prepForm.cuarto, salidaSku: prepForm.salida, barras: prepForm.barras,
  }), [data.productos, data.cuartosFrios, prepForm]);

  const registrarPreparacion = async () => {
    if (guardandoPrep || enVueloPrep.current) return;
    if (vistaPrep.bloqueo) { showToast(vistaPrep.bloqueo.mensaje, 'error'); return; }
    const datos = { cuartoId: prepForm.cuarto, salidaSku: prepForm.salida, barras: Number(prepForm.barras) };
    const op = resolverOperacion(opPrepRef.current, clavePreparacion(datos));
    opPrepRef.current = op;
    enVueloPrep.current = true;
    setGuardandoPrep(true);
    try {
      const result = await actions.prepararDesdeBarra({ ...datos, operacionId: op.id });
      if (result?.error) {
        showToast(result.error, 'error');
        return; // se conserva el operacion_id: reintentar no duplica
      }
      opPrepRef.current = null;
      const r = result?.data || {};
      showToast(`${r.replay ? 'Ya estaba registrada — ' : ''}${s(r.folio)}: ${n(r.barras)} ${n(r.barras) === 1 ? 'barra' : 'barras'} → ${n(r.bolsas)} bolsas`);
      setPrepForm(f => ({ ...f, barras: "" }));
    } catch (e) {
      console.error('Error preparación:', e);
      showToast('Error al preparar. Verifica tu conexión y reintenta.', 'error');
    } finally {
      enVueloPrep.current = false;
      setGuardandoPrep(false);
    }
  };
  const cuartos = data.cuartosFrios || [];

  const totalEnCuartos = useMemo(() => {
    let t = 0;
    for (const cf of cuartos) if (cf.stock) for (const v of Object.values(cf.stock)) t += n(v);
    return t;
  }, [cuartos]);

  const bolsaSku = useMemo(() => {
    const prod = (data.productos || []).find(p => s(p.sku) === s(form.sku));
    return s(prod?.empaqueSku || prod?.empaque_sku) || null;
  }, [data.productos, form.sku]);
  const stockBolsa = useMemo(() => {
    if (!bolsaSku) return 999999;
    const p = data.productos.find(x => x.sku === bolsaSku);
    return p ? n(p.stock) : 0;
  }, [data.productos, bolsaSku]);

  const registrarProduccion = async () => {
    if (guardandoProd || enVueloProd.current) return;
    if (!form.cantidad || n(form.cantidad) <= 0) {
      showToast('Captura una cantidad válida', 'error');
      return;
    }
    if (bolsaSku && n(form.cantidad) > stockBolsa) {
      showToast(`Stock insuficiente de ${bolsaSku} (disp: ${stockBolsa}, pediste ${n(form.cantidad)}). Compra empaque desde Insumos.`, 'error');
      return;
    }
    if (!bolsaSku && !seProduceSinEmpaque(form.sku)) {
      showToast(`${form.sku} no tiene empaque configurado. Configurarlo en Catálogo antes de producir.`, 'error');
      return;
    }

    const cant = n(form.cantidad);
    const cfNombre = cuartos.find(cf => s(cf.id) === form.destino)?.nombre || form.destino;

    // Validar capacidad de tarimas del cuarto destino (Fase 19)
    const cuartoDestino = (data.cuartosFrios || []).find(c => String(c.id) === String(form.destino));
    if (cuartoDestino && n(cuartoDestino.capacidad_tarimas) > 0) {
      const { puede, ocupadoActual, ocupadoFuturo, capacidad } = puedeAgregarAlCuarto(
        cuartoDestino,
        data.productos,
        form.sku,
        cant
      );
      if (!puede) {
        const exceso = (ocupadoFuturo - capacidad).toFixed(1);
        const mensaje = `${cfNombre} no tiene espacio. Ocupado ${ocupadoActual.toFixed(1)}/${capacidad} tarimas. Faltan ${exceso} tarimas. Elige otro cuarto.`;
        showToast(mensaje, 'error');
        return;
      }
    }

    // Datos de negocio y operacion_id del intento lógico (mig 076).
    const datosProd = { turno: form.turno, maquina: form.maquina, sku: form.sku, cantidad: cant, destino: form.destino };
    const op = resolverOperacion(opProdRef.current, claveProduccion(datosProd));
    opProdRef.current = op;

    // Sin merma: una sola RPC atómica (registrar_produccion)
    if (!form.conMerma) {
      enVueloProd.current = true;
      setGuardandoProd(true);
      try {
        const result = await actions.producirYCongelar({ ...datosProd, operacionId: op.id });
        if (result?.error) {
          showToast(result.error, 'error');
          return; // se conserva el operacion_id: reintentar no duplica
        }
        opProdRef.current = null;
        showToast(`${result.replay ? 'Ya estaba registrada — ' : ''}${result.folio}: ${result.cantidad} ${result.sku} → ${cfNombre}`);
        setModal(false);
        resetFormProd();
      } catch (e) {
        console.error('Error registrando producción:', e);
        showToast('Error al registrar producción. Verifica tu conexión y reintenta.', 'error');
      } finally {
        enVueloProd.current = false;
        setGuardandoProd(false);
      }
      return;
    }

    // Con merma: validaciones extra
    const merma = n(form.mermaCantidad);
    if (merma <= 0 || merma > cant) return;
    if (!fotoMermaProdFile) return;
    if (fotoMermaProdFile.size > 5 * 1024 * 1024) {
      showToast('Foto muy grande, máx 5MB', 'error');
      return;
    }

    enVueloProd.current = true;
    setGuardandoProd(true);
    try {
      // 1. Subir foto a Storage
      const authOwner = s(user?.auth_id || user?.id || 'usuario');
      const ext = (fotoMermaProdFile.name?.split('.').pop() || 'jpg').toLowerCase();
      const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg';
      const filePath = `${authOwner}/${todayLocalISO()}/${Date.now()}-${form.sku}-prod.${safeExt}`;

      const { error: uploadErr } = await supabase.storage
        .from('mermas')
        .upload(filePath, fotoMermaProdFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: fotoMermaProdFile.type || 'image/jpeg',
        });
      if (uploadErr) {
        showToast('No se pudo subir la foto de merma', 'error');
        return;
      }

      // 2. Producción atómica (registrar_produccion). Si falla, el servidor
      // no dejó nada: no registramos merma (D11: son dos acciones).
      const prodResult = await actions.producirYCongelar({ ...datosProd, operacionId: op.id });
      if (prodResult?.error) {
        // Limpiar la foto subida (propia y sin ligar) ya que no se va a usar
        await supabase.storage.from('mermas').remove([filePath]);
        showToast(prodResult.error, 'error');
        return; // se conserva el operacion_id: reintentar no duplica
      }
      opProdRef.current = null;

      // 3. Merma en el mismo congelador de destino de la producción (102).
      const datosMerma = { cuartoId: s(form.destino), sku: form.sku, cantidad: merma, causa: form.mermaCausa, foto: filePath };
      const opMerma = resolverOperacion(null, claveMermaCuarto(datosMerma));
      const mermaErr = await actions.registrarMermaCuarto({ ...datosMerma, operacionId: opMerma.id });
      if (mermaErr) {
        showToast('Producción OK, pero la merma no se registró. Hazlo desde Mermas.', 'error');
        setModal(false);
        resetFormProd();
        return;
      }

      showToast(`${prodResult.folio}: ${cant} producidas, ${merma} mermadas → ${cfNombre}`);
      setModal(false);
      resetFormProd();
    } finally {
      enVueloProd.current = false;
      setGuardandoProd(false);
    }
  };

  const hacerTraspaso = async () => {
    if (haciendoTraspaso) return;
    if (!tForm.cantidad || n(tForm.cantidad) <= 0 || tForm.origen === tForm.destino) return;
    const origenN = cuartos.find(cf => s(cf.id) === tForm.origen)?.nombre || tForm.origen;
    const destinoN = cuartos.find(cf => s(cf.id) === tForm.destino)?.nombre || tForm.destino;
    setHaciendoTraspaso(true);
    try {
      const op = resolverOperacion(opTraspasoRef.current, claveTraspaso(tForm));
      opTraspasoRef.current = op;
      const r = actions.traspasoEntreUbicaciones ? await actions.traspasoEntreUbicaciones({ ...tForm, operacionId: op.id }) : null;
      if (r && (r.error || r.message)) {
        showToast('Error: ' + (r.error || r.message), 'error');
        return;
      }
      opTraspasoRef.current = null;
      showToast(tForm.cantidad + " " + tForm.sku + ": " + origenN + " → " + destinoN);
      setTraspasoModal(false);
      setTForm({ origen: "CF-1", destino: "CF-2", sku: "", cantidad: "" });
    } catch (e) {
      console.error('Error en traspaso:', e);
      showToast('Error en traspaso. Verifica tu conexión.', 'error');
    } finally {
      setHaciendoTraspaso(false);
    }
  };

  const hacerSalida = async () => {
    if (haciendoSalida) return;
    if (!sacarForm.cantidad || n(sacarForm.cantidad) <= 0 || !sacarModal) return;
    // 103: motivos cerrados; "Otro" lleva detalle. Merma y conteo tienen su propio registro.
    const mot = motivoSalidaManual(sacarForm.motivo, sacarForm.detalle);
    if (mot.error) { showToast(mot.error, 'error'); return; }
    setHaciendoSalida(true);
    try {
      const op = resolverOperacion(opSalidaRef.current, claveSalida({ cuartoId: sacarModal.cfId, sku: sacarForm.sku, cantidad: sacarForm.cantidad, motivo: mot.motivo }));
      opSalidaRef.current = op;
      const r = actions.sacarDeCuartoFrio
        ? await actions.sacarDeCuartoFrio(sacarModal.cfId, sacarForm.sku, sacarForm.cantidad, mot.motivo, { operacionId: op.id })
        : null;
      if (r && (r.error || r.message)) {
        showToast('Error: ' + (r.error || r.message), 'error');
        return;
      }
      opSalidaRef.current = null;
      showToast("Salida: " + sacarForm.cantidad + " " + sacarForm.sku + " de " + sacarModal.cfNombre);
      setSacarModal(null);
      setSacarForm({ sku: "", cantidad: "", motivo: "", detalle: "" });
    } catch (e) {
      console.error('Error en salida:', e);
      showToast('Error al sacar del congelador. Verifica tu conexión.', 'error');
    } finally {
      setHaciendoSalida(false);
    }
  };

  const cerrarProd = () => { setModal(false); clearFotoMermaProd(); };
  const kpis = [
    { label: "Producido hoy", value: totalHoy.toLocaleString() },
    { label: "En congeladores", value: totalEnCuartos.toLocaleString() },
    { label: "Merma hoy", value: mermaHoy },
  ];
  const cfCorto = (cf) => s(cf.nombre).replace("Cuarto Frío ", "CF-");
  // B3.2: cada módulo abre con SU resumen (derivado de datos ya cargados; sin
  // consultas nuevas). Producción conserva el resumen general (kpis); los
  // otros tres dejan de repetirlo. Orden por módulo: resumen → acción → contenido.
  const resumenCuartos = useMemo(() => resumenCongeladores(data.cuartosFrios, data.productos), [data.cuartosFrios, data.productos]);
  const resumenMer = useMemo(() => resumenMermas(data.mermas, diaNegocio()), [data.mermas]);

  return (
    <div className={embedded ? "text-slate-900" : "min-h-dvh w-full text-slate-900"} data-testid="produccion-shell">
      {/* B2: el shell pone el título de página. B3.2: dentro del shell cada
          módulo abre con su propio resumen (abajo, por pestaña); la cabecera
          suelta conserva el resumen general. */}
      {!embedded && (
        <RoleHeader kicker="Producción" title="Producción del día" subtitle={s(user?.nombre)} accent="sky" onLogout={onLogout}
          right={<BotonFirmasPendientes user={user} data={data} actions={actions} />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {kpis.map(k => <HeaderStat key={k.label} label={k.label} value={k.value} className="text-center" />)}
          </div>
        </RoleHeader>
      )}

      {/* Banner urgente de firmas pendientes (solo Producción) */}
      <BotonFirmasPendientes
        user={user}
        data={data}
        actions={actions}
        mostrarBannerUrgente={true}
      />

      <div className={embedded ? CONTENIDO_SHELL : `${CONTENIDO} px-4 pt-3`}>
        {/* B3: dentro del shell navegan el sidebar (lg+) y la barra inferior (móvil); las pestañas solo en la vista suelta. */}
        {!embedded && <SegmentedTabs items={TABS} value={tab} onChange={setTab} accent="blue" className="mb-1" />}

        {/* ═══ TAB: PRODUCCIÓN ═══ */}
        {tab === "producir" && (<>
          {embedded && (
            <div className={RESUMEN} data-testid="resumen-produccion">
              {kpis.map((k, i) => <KpiTile key={k.label} label={k.label} value={k.value} hint={i === 0 ? s(user?.nombre) : undefined} />)}
            </div>
          )}
          <FormBtn primary size="lg" className="w-full" onClick={() => { resetFormProd(); setModal(true); }}>
            <Icons.Plus /> Ya produje hielo
          </FormBtn>

          {/* ═══ PANEL: Qué necesitas producir ═══ */}
          <Card tone={hayFaltante ? "warning" : undefined}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Qué necesitas producir</h3>
                <p className="text-[11px] text-slate-500">Pedidos pendientes + mínimo de stock − lo que ya hay</p>
              </div>
              {hayFaltante && <StatusBadge status="Atención" />}
            </div>

            {tableroDemanda.length === 0 ? (
              <EmptyState
                icon="Package"
                message="Sin productos terminados configurados"
                hint="Pide a Admin que agregue productos terminados al catálogo"
              />
            ) : (
              <div className="space-y-2">
                {tableroDemanda.map(r => (
                  <div key={r.sku} className={`rounded-[16px] border p-3 ${r.faltante > 0 ? 'border-amber-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{r.producto}</p>
                      {r.faltante > 0 ? (
                        <span className="flex-shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Faltan {r.faltante.toLocaleString()}</span>
                      ) : (
                        <StatusBadge status="Cubierto" />
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-[10px] uppercase text-slate-400">Pedidos</p>
                        <p className={`text-sm font-bold ${r.pendientes > 0 ? 'text-blue-600' : 'text-slate-400'}`}>{r.pendientes.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-400">Stock</p>
                        <p className={`text-sm font-bold ${r.bajoMinimo ? 'text-red-600' : 'text-slate-700'}`}>{r.stock.toLocaleString()}{r.bajoMinimo && <span className="ml-0.5 text-[10px] text-red-400">▼</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-400">Mínimo</p>
                        <p className="text-sm font-bold text-slate-500">{r.stockMinimo > 0 ? r.stockMinimo.toLocaleString() : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-400">Hecho hoy</p>
                        <p className={`text-sm font-bold ${r.producidoHoy > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.producidoHoy.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {prodHoy.length > 0 && (
            <div>
              <SectionLabel className="mb-2">Producido hoy</SectionLabel>
              {prodHoy.map(p => (
                <Card key={p.id} tone="success" padding="p-3" className="mb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{n(p.cantidad).toLocaleString()} × {s(p.sku)}</p>
                      <p className="text-xs text-slate-500">{s(p.maquina)} · {s(p.turno)}</p>
                    </div>
                    <StatusBadge status="Congelado" />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {prodHoy.length === 0 && (
            <Card>
              <EmptyState
                message="Aún no has registrado producción hoy"
                icon="Snowflake"
                hint="Cuando produzcas hielo en el día, aparecerá aquí el detalle"
                cta="+ Ya produje hielo"
                onCta={() => { resetFormProd(); setModal(true); }}
              />
            </Card>
          )}
        </>)}

        {/* ═══ TAB: CONGELADORES ═══ */}
        {tab === "cuartos" && (<>
          <div className={RESUMEN} data-testid="resumen-congeladores">
            <KpiTile label="Existencia total" value={resumenCuartos.existencia.toLocaleString()}
              hint={`bolsas en ${resumenCuartos.congeladores} ${resumenCuartos.congeladores === 1 ? 'congelador' : 'congeladores'}`} />
            <KpiTile label="Tarimas ocupadas"
              value={resumenCuartos.tarimasCapacidad > 0 ? `${resumenCuartos.tarimasOcupadas.toFixed(1)} / ${resumenCuartos.tarimasCapacidad}` : '—'}
              hint={resumenCuartos.tarimasCapacidad > 0 ? `${fmtPct(resumenCuartos.tarimasOcupadas, resumenCuartos.tarimasCapacidad)} de la capacidad configurada` : 'Sin capacidad configurada'}>
              {resumenCuartos.tarimasCapacidad > 0 && <CapacityBar pct={resumenCuartos.pct} />}
            </KpiTile>
            <KpiTile label="Tarimas libres" value={resumenCuartos.tarimasLibres === null ? '—' : resumenCuartos.tarimasLibres.toFixed(1)}
              hint={resumenCuartos.sinCapacidad.length > 0
                ? `${resumenCuartos.sinCapacidad.length} sin capacidad configurada: ${resumenCuartos.sinCapacidad.join(', ')}`
                : (resumenCuartos.congeladores > 0 ? 'capacidad configurada en todos' : 'sin congeladores')} />
          </div>
          <FormBtn primary size="lg" className="w-full" onClick={() => setTraspasoModal(true)}>
            <Icons.Truck /> Mover entre congeladores
          </FormBtn>

          {/* Cargas pendientes de chofers */}
          {cargasPendientes.filter(c => c.estatus === "Pendiente").length > 0 && (
            <Card tone="warning">
              <SectionLabel className="mb-1 !text-amber-700">Cargas pendientes</SectionLabel>
              <p className="mb-3 text-sm font-semibold text-slate-700">Choferes listos para salida</p>
              {cargasPendientes.filter(c => c.estatus === "Pendiente").map(cg => (
                <Card key={cg.id} padding="p-3" className="mb-2">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{cg.chofer}</p>
                      <p className="text-xs text-slate-400">{cg.ruta} · {cg.hora}</p>
                    </div>
                    <StatusBadge status="Pendiente" />
                  </div>
                  <div className="mb-2 flex gap-1">
                    {Object.entries(cg.items).map(([sku, cant]) => (
                      <span key={sku} className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{cant}× {sku}</span>
                    ))}
                  </div>
                  <FormBtn success className="w-full" onClick={() => {
                    setCargasPendientes(prev => prev.map(p => p.id === cg.id ? { ...p, estatus: "Entregado" } : p));
                    showToast("Carga entregada a " + cg.chofer);
                  }}>
                    Entregar carga
                  </FormBtn>
                </Card>
              ))}
            </Card>
          )}

          <div className={embedded ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "space-y-3"}>
          {cuartos.map(cf => {
            const stockEntries = cf.stock ? Object.entries(cf.stock) : [];
            const total = stockEntries.reduce((s, [, v]) => s + n(v), 0);
            return (
              <Card key={cf.id} padding="p-0" className="overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-slate-900 text-cyan-200">
                      <Icons.Snowflake />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800">{s(cf.nombre)}</p>
                      <p className="text-xs text-slate-500">{n(cf.temp, -50, 10)}°C</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl font-bold tracking-[-0.04em] text-slate-900">{total.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">bolsas</p>
                  </div>
                </div>

                {(() => {
                  const ocupado = tarimasOcupadasEnCuarto(cf, data.productos);
                  const capacidad = n(cf.capacidad_tarimas);
                  if (capacidad <= 0) return null;
                  const pct = Math.round((ocupado / capacidad) * 100);
                  const color = colorTarimasUso(ocupado, capacidad);
                  const textColorClass = color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-emerald-700';
                  return (
                    <div className="px-4 pb-3">
                      <div className="mb-1 flex items-center justify-between">
                        <SectionLabel>Tarimas</SectionLabel>
                        <span className={`text-xs font-bold ${textColorClass}`}>
                          {ocupado.toFixed(1)}/{capacidad} ({fmtPct(ocupado, capacidad)})
                        </span>
                      </div>
                      <CapacityBar pct={pct} />
                    </div>
                  );
                })()}

                {stockEntries.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                    {stockEntries.map(([sku, qty]) => (
                      <div key={sku} className="rounded-[18px] bg-slate-50 p-3">
                        <p className="font-mono text-xs text-slate-400">{sku}</p>
                        <p className="text-lg font-extrabold text-slate-800">{n(qty).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 pb-3"><div className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-sm text-slate-400">Vacío</p></div></div>
                )}
                <div className="border-t border-slate-100">
                  <button type="button" onClick={() => { setSacarModal({ cfId: s(cf.id), cfNombre: s(cf.nombre) }); setSacarForm({ sku: "", cantidad: "", motivo: "", detalle: "" }); }}
                    className="min-h-[44px] w-full py-3 text-xs font-bold text-amber-700 active:bg-amber-50">
                    − Sacar hielo (carga a ruta / otro)
                  </button>
                </div>
              </Card>
            );
          })}
          </div>
        </>)}

        {/* ═══ TAB: PREPARAR DESDE BARRA (OP-01D) ═══ */}
        {tab === "preparar" && (<>
          <div className={RESUMEN} data-testid="resumen-preparacion">
            <KpiTile label="Preparaciones hoy" value={resumenPrep.preparaciones} />
            <KpiTile label="Barras usadas hoy" value={resumenPrep.barras.toLocaleString()} />
            <KpiTile label="Bolsas preparadas hoy" value={resumenPrep.bolsas.toLocaleString()} />
          </div>
          <Card padding="p-4">
            <div className="space-y-4">
              <div>
                <label className={LABEL}>¿Qué vas a preparar?</label>
                <div className="grid grid-cols-2 gap-2">
                  {SALIDAS_BARRA.map(sku => {
                    const p = (data.productos || []).find(x => s(x.sku) === sku);
                    return (
                      <ChoiceButton key={sku} active={prepForm.salida === sku} onClick={() => setPrepForm(f => ({ ...f, salida: sku }))} className="text-left text-xs">
                        {s(p?.nombre) || sku}
                      </ChoiceButton>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className={LABEL}>¿De qué cuarto frío?</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <ChoiceButton key={cf.id} active={String(prepForm.cuarto) === String(cf.id)} onClick={() => setPrepForm(f => ({ ...f, cuarto: String(cf.id) }))} className="text-left text-xs">
                      {s(cf.nombre)}
                    </ChoiceButton>
                  ))}
                </div>
              </div>
              <FormInput label="Barras enteras a preparar" type="number" min="1" step="1" inputMode="numeric" value={prepForm.barras}
                onChange={e => setPrepForm(f => ({ ...f, barras: e.target.value }))} inputClassName="text-center !text-lg font-bold" placeholder="Ej: 3"
                hint={`Hay ${vistaPrep.barrasDisponibles.toLocaleString()} barras en este cuarto`} />
              {vistaPrep.resumen && (
                <div data-testid="vista-previa-preparacion">
                  <Card tone={vistaPrep.bloqueo ? "danger" : "success"} padding="p-3">
                    <p className="text-sm font-bold">{vistaPrep.resumen}</p>
                    {vistaPrep.consumo && <p className="mt-0.5 text-xs">{vistaPrep.consumo}</p>}
                    {vistaPrep.bloqueo && <p className="mt-1 text-xs font-bold">{vistaPrep.bloqueo.mensaje}</p>}
                  </Card>
                </div>
              )}
              {!vistaPrep.resumen && vistaPrep.bloqueo?.codigo === 'sin_empaque' && (
                <Card tone="danger" padding="p-3"><p className="text-xs font-bold">{vistaPrep.bloqueo.mensaje}</p></Card>
              )}
            </div>
            <FormBtn primary size="lg" className="mt-4 w-full" onClick={registrarPreparacion} disabled={guardandoPrep || !!vistaPrep.bloqueo}>
              {guardandoPrep ? 'Guardando...' : 'Preparar'}
            </FormBtn>
          </Card>
          {preparacionesHoy.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Preparado hoy ({preparacionesHoy.length})</SectionLabel>
              {preparacionesHoy.slice().reverse().map(p => (
                <Card key={p.id} padding="p-3">
                  <p className="text-sm font-bold text-slate-800">{n(p.input_kg ?? p.inputKg)} {n(p.input_kg ?? p.inputKg) === 1 ? 'barra' : 'barras'} → {n(p.cantidad)} × {s(p.sku)}</p>
                  <p className="text-xs text-slate-500">{s(p.folio)} · {s(p.cuarto_id ?? p.cuartoId)}</p>
                </Card>
              ))}
            </div>
          )}
        </>)}

        {/* ═══ TAB MERMAS ═══ */}
        {tab === "mermas" && (<>
          <div className={RESUMEN} data-testid="resumen-mermas">
            <KpiTile label="Merma hoy" value={resumenMer.mermaHoy.toLocaleString()} hint="bolsas (mermas vigentes de hoy)" />
            <KpiTile label="Registros hoy" value={resumenMer.registrosHoy} hint="mermas registradas hoy" />
            <KpiTile label="Última merma de hoy" compact
              value={resumenMer.ultima ? `${resumenMer.ultima.cantidad.toLocaleString()}× ${resumenMer.ultima.sku}` : 'Sin mermas hoy'}
              hint={resumenMer.ultima ? [resumenMer.ultima.causa, resumenMer.ultima.origen].filter(Boolean).join(' · ') : 'Buen turno'} />
          </div>
          <FormBtn danger size="lg" className="w-full" onClick={() => { setMermaModal(true); clearFotoMerma(); setMForm({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" }); }}>
            <Icons.AlertTriangle /> Registrar merma
          </FormBtn>

          {mermasHoyList.length > 0 ? (
            <div className="space-y-2">
              <SectionLabel>Mermas de hoy ({mermasHoyList.length})</SectionLabel>
              {mermasHoyList.map(m => (
                <Card key={m.id} tone="danger" padding="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-red-700">{m.cantidad}× {m.sku}</p>
                      <p className="text-xs text-slate-500">{m.causa} · {m.origen} · {m.fecha ? fmtDate(m.fecha) : 'Hoy'}</p>
                    </div>
                    {m.fotoUrl && <img src={m.fotoUrl} alt="Evidencia" className="h-10 w-10 rounded-lg border border-red-300 object-cover" />}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                message="Buen turno"
                icon="Check"
                hint="No has registrado mermas hoy"
              />
            </Card>
          )}
        </>)}

        <div className="h-8" />
      </div>

      {/* ═══ MODAL: Ya produje hielo ═══ */}
      <Modal open={!!modal} onClose={cerrarProd} kicker="Producción" title="¿Qué produjiste?" safeBottom closeOnEscape={!guardandoProd}>
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Producto</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {skuOptions.map(p => (
                <ChoiceButton key={p.sku} active={form.sku === s(p.sku)} onClick={() => setForm(f => ({ ...f, sku: s(p.sku) }))} className="text-xs">
                  {s(p.nombre)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <FormInput label="Cantidad" type="number" min="0" inputMode="numeric" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
            inputClassName="text-center !text-lg font-bold" placeholder="Ej: 500" autoFocus />
          {bolsaSku ? (
            <Card tone={n(form.cantidad) > stockBolsa ? "danger" : undefined} padding="p-3">
              <p className="text-xs font-semibold">Consume: {form.cantidad || 0} bolsas {bolsaSku}</p>
              <p className={`mt-0.5 text-xs ${n(form.cantidad) > stockBolsa ? "font-bold text-red-600" : "text-slate-500"}`}>
                Disponibles (total empresa): {stockBolsa.toLocaleString()}{n(form.cantidad) > stockBolsa ? " — INSUFICIENTE" : ""}
              </p>
            </Card>
          ) : form.sku && seProduceSinEmpaque(form.sku) ? (
            <Card padding="p-3">
              <p className="text-xs font-semibold">La barra se produce sin bolsa: no consume empaque.</p>
              <p className="mt-0.5 text-xs text-slate-500">Cada barra física cuenta como 1.</p>
            </Card>
          ) : form.sku ? (
            <Card tone="warning" padding="p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800"><Icons.AlertTriangle /> {form.sku} no tiene empaque configurado</p>
              <p className="mt-0.5 text-xs text-amber-700">Pídele a Admin que enlace un empaque a este producto en Catálogo. No se puede producir sin empaque definido.</p>
            </Card>
          ) : null}
          <div>
            <label className={LABEL}>Máquina</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MAQUINAS_PRODUCCION.map(m => (
                <ChoiceButton key={m} active={form.maquina === m} onClick={() => setForm(f => ({ ...f, maquina: m }))} className="text-xs">
                  {m.replace("Máquina ", "Máq ")}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>Turno</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {["Turno 1", "Turno 2", "Turno 3"].map(t => (
                <ChoiceButton key={t} active={form.turno === t} onClick={() => setForm(f => ({ ...f, turno: t }))}>
                  {t}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>¿A qué congelador va?</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cuartos.map(cf => (
                <ChoiceButton key={cf.id} active={form.destino === s(cf.id)} onClick={() => setForm(f => ({ ...f, destino: s(cf.id) }))} className="text-xs">
                  {cfCorto(cf)}
                  <p className="mt-0.5 text-[10px] font-normal text-slate-400">{n(cf.temp, -50, 10)}°C</p>
                </ChoiceButton>
              ))}
            </div>
          </div>

          {/* ═══ Merma inline opcional ═══ */}
          <div className="border-t border-slate-200 pt-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.conMerma}
                onChange={e => {
                  const checked = e.target.checked;
                  setForm(f => ({ ...f, conMerma: checked }));
                  if (!checked) clearFotoMermaProd();
                }}
                className="h-5 w-5 rounded border-slate-300 accent-red-500"
              />
              <span className="text-sm font-semibold text-slate-700">¿Hubo merma en este lote?</span>
            </label>
          </div>

          {form.conMerma && (
            <Card tone="danger" padding="p-3" className="space-y-3">
              <FormInput label="Cantidad de merma" type="number" min="0" inputMode="numeric" value={form.mermaCantidad}
                onChange={e => setForm(f => ({ ...f, mermaCantidad: e.target.value }))}
                inputClassName="text-center !text-lg font-bold" placeholder="0"
                error={form.mermaCantidad && n(form.mermaCantidad) > n(form.cantidad) ? `No puede ser mayor a la cantidad producida (${n(form.cantidad)})` : undefined} />
              <div>
                <label className={LABEL}>Causa</label>
                <div className="grid grid-cols-2 gap-2">
                  {MERMA_CAUSAS.map(c => (
                    <ChoiceButton key={c} tone="red" active={form.mermaCausa === c} onClick={() => setForm(f => ({ ...f, mermaCausa: c }))} className="text-xs">
                      {c}
                    </ChoiceButton>
                  ))}
                </div>
              </div>
              <div>
                <label className={`${LABEL} mb-2`}>Evidencia (foto) *</label>
                {fotoMermaProdPreview ? (
                  <div>
                    <img src={fotoMermaProdPreview} alt="Evidencia" className="h-32 w-full rounded-xl border border-emerald-300 object-cover" />
                    <button type="button" onClick={clearFotoMermaProd} className="mt-1 text-xs text-slate-400">Tomar otra</button>
                  </div>
                ) : (
                  <label className="flex min-h-[56px] w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-slate-300 py-4 text-xs font-semibold text-slate-500">
                    <Icons.Camera /> Tomar foto de evidencia
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePickFile(clearFotoMermaProd, setFotoMermaProdFile, setFotoMermaProdPreview)} />
                  </label>
                )}
              </div>
            </Card>
          )}
        </div>
        <FormBtn primary size="lg" className="mt-4 w-full" onClick={registrarProduccion}
          disabled={
            guardandoProd ||
            !form.sku ||
            !form.cantidad || n(form.cantidad) <= 0 ||
            !bolsaSku ||
            n(form.cantidad) > stockBolsa ||
            (form.conMerma && (
              !form.mermaCantidad || n(form.mermaCantidad) <= 0 ||
              n(form.mermaCantidad) > n(form.cantidad) ||
              !fotoMermaProdFile
            ))
          }>
          {guardandoProd ? 'Guardando...' : 'Registrar producción'}
        </FormBtn>
      </Modal>

      {/* ═══ MODAL: Mover entre congeladores ═══ */}
      <Modal open={!!traspasoModal} onClose={() => setTraspasoModal(false)} kicker="Movimiento" title="Mover entre congeladores" safeBottom closeOnEscape={!haciendoTraspaso}>
        <div className="space-y-3">
          <div>
            <label className={LABEL}>De</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cuartos.map(cf => (
                <ChoiceButton key={cf.id} active={tForm.origen === s(cf.id)} onClick={() => setTForm(f => ({ ...f, origen: s(cf.id) }))} className="text-xs">
                  {cfCorto(cf)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>A</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cuartos.map(cf => (
                <ChoiceButton key={cf.id} tone="emerald" active={tForm.destino === s(cf.id)} disabled={tForm.origen === s(cf.id)} onClick={() => setTForm(f => ({ ...f, destino: s(cf.id) }))} className="text-xs">
                  {cfCorto(cf)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>Producto</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {skuOptions.map(p => (
                <ChoiceButton key={p.sku} active={tForm.sku === s(p.sku)} onClick={() => setTForm(f => ({ ...f, sku: s(p.sku) }))} className="text-xs">
                  {s(p.sku)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <FormInput label="Cantidad" type="number" min="0" inputMode="numeric" value={tForm.cantidad} onChange={e => setTForm(f => ({ ...f, cantidad: e.target.value }))}
            inputClassName="text-center !text-xl font-bold" placeholder="Cantidad" />
        </div>
        <FormBtn primary size="lg" className="mt-4 w-full" onClick={hacerTraspaso} disabled={haciendoTraspaso || !tForm.cantidad || n(tForm.cantidad) <= 0 || tForm.origen === tForm.destino}>
          {haciendoTraspaso ? 'Trasladando…' : 'Mover'}
        </FormBtn>
      </Modal>

      {/* ═══ MODAL: Sacar hielo ═══ */}
      <Modal open={!!sacarModal} onClose={() => setSacarModal(null)} kicker="Salida" title="Sacar hielo" safeBottom closeOnEscape={!haciendoSalida}>
        {sacarModal && (<>
          <p className="mb-4 text-sm text-slate-500">{sacarModal.cfNombre}</p>
          <div className="space-y-3">
            <div>
              <label className={LABEL}>Producto</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {skuOptions.map(p => (
                  <ChoiceButton key={p.sku} active={sacarForm.sku === s(p.sku)} onClick={() => setSacarForm(f => ({ ...f, sku: s(p.sku) }))} className="text-xs">
                    {s(p.sku)}
                  </ChoiceButton>
                ))}
              </div>
            </div>
            <FormInput label="Cantidad" type="number" min="0" inputMode="numeric" value={sacarForm.cantidad} onChange={e => setSacarForm(f => ({ ...f, cantidad: e.target.value }))}
              inputClassName="text-center !text-xl font-bold" placeholder="Cantidad" autoFocus />
            <div>
              <label className={LABEL}>Motivo</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {MOTIVOS_SALIDA_MANUAL.map(m => (
                  <ChoiceButton key={m} tone="amber" active={sacarForm.motivo === m} onClick={() => setSacarForm(f => ({ ...f, motivo: m }))} className="text-xs">
                    {m}
                  </ChoiceButton>
                ))}
              </div>
              {sacarForm.motivo === 'Otro' && (
                <div className="mt-2">
                  <FormInput label="Detalle" value={sacarForm.detalle || ''} onChange={e => setSacarForm(f => ({ ...f, detalle: e.target.value }))}
                    placeholder="¿Para qué sale? (mínimo 5 caracteres)" />
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Producto dañado o perdido: usa <b>Merma</b>. Diferencia de conteo: la ajusta Admin en Inventario.</p>
            </div>
          </div>
          <FormBtn warning size="lg" className="mt-4 w-full" onClick={hacerSalida} disabled={haciendoSalida || !sacarForm.cantidad || n(sacarForm.cantidad) <= 0 || !s(sacarForm.motivo)}>
            {haciendoSalida ? 'Sacando…' : 'Sacar del congelador'}
          </FormBtn>
        </>)}
      </Modal>

      {/* ═══ MODAL MERMA ═══ */}
      <Modal open={!!mermaModal} onClose={() => setMermaModal(false)} kicker="Merma" title="Registrar merma" safeBottom closeOnEscape={!guardandoMerma}>
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Producto</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(data.productos || []).filter(p => s(p.tipo) === "Producto Terminado").map(p => (
                <ChoiceButton key={p.sku} tone="red" active={mForm.sku === s(p.sku)} onClick={() => setMForm(f => ({ ...f, sku: s(p.sku) }))} className="text-xs">
                  {s(p.nombre)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <FormInput label="Cantidad" type="number" min="0" value={mForm.cantidad} onChange={e => setMForm(f => ({ ...f, cantidad: e.target.value }))}
            inputClassName="text-center !text-xl font-bold" placeholder="0" />
          <div>
            <label className={LABEL}>Causa</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MERMA_CAUSAS.map(c => (
                <ChoiceButton key={c} tone="red" active={mForm.causa === c} onClick={() => setMForm(f => ({ ...f, causa: c }))} className="text-xs">
                  {c}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>¿De qué congelador?</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cuartos.map(cf => (
                <ChoiceButton key={cf.id} tone="red" active={mForm.congelador === s(cf.id)} onClick={() => setMForm(f => ({ ...f, congelador: s(cf.id) }))} className="text-xs">
                  {s(cf.nombre)}
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <label className={`${LABEL} mb-2`}>Evidencia (foto) *</label>
            {fotoMermaPreview ? (
              <div><img src={fotoMermaPreview} alt="Evidencia" className="h-32 w-full rounded-xl border border-emerald-300 object-cover" /><button type="button" onClick={clearFotoMerma} className="mt-1 text-xs text-slate-400">Tomar otra</button></div>
            ) : (
              <label className="flex min-h-[56px] w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-slate-300 py-4 text-xs font-semibold text-slate-500">
                <Icons.Camera /> Tomar foto de evidencia
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePickFile(clearFotoMerma, setFotoMermaFile, setFotoMermaPreview)} />
              </label>
            )}
          </div>
        </div>
        <FormBtn danger size="lg" className="mt-4 w-full" onClick={registrarMerma} disabled={guardandoMerma || !mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile}>
          {guardandoMerma ? 'Guardando...' : 'Registrar merma'}
        </FormBtn>
      </Modal>

    </div>
  );
}
