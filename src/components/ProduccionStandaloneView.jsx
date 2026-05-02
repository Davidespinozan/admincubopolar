import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { s, n, fmtDate, fmtPct } from '../utils/safe';
import { puedeAgregarAlCuarto, tarimasOcupadasEnCuarto, colorTarimasUso } from '../utils/tarimas';
import BotonFirmasPendientes from './BotonFirmasPendientes';
import { EmptyState } from './ui/Skeleton';

// empaqueMap se deriva dinámicamente de data.productos.empaque_sku
const PRODUCCION_SHELL = "min-h-screen w-full max-w-[640px] mx-auto bg-[linear-gradient(180deg,#edf3f6_0%,#e5edf1_100%)] text-slate-900 md:max-w-3xl lg:max-w-5xl";

export default function ProduccionStandaloneView({ user, data, actions, onLogout }) {
  const [tab, setTab] = useState("producir");
  const [modal, setModal] = useState(false);
  const [traspasoModal, setTraspasoModal] = useState(false);
  const [sacarModal, setSacarModal] = useState(null); // { cfId, cfNombre }
  const [transModal, setTransModal] = useState(false);
  const [transForm, setTransForm] = useState({ input_sku: "", input_kg: "", output_sku: "", output_kg: "", notas: "" });
  const [guardandoTrans, setGuardandoTrans] = useState(false);

  // Producir form — includes destino (congelador) + merma inline opcional
  const [form, setForm] = useState({ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" });
  const [fotoMermaProdFile, setFotoMermaProdFile] = useState(null);
  const [fotoMermaProdPreview, setFotoMermaProdPreview] = useState('');
  const [guardandoProd, setGuardandoProd] = useState(false);
  const [tForm, setTForm] = useState({ origen: "CF-1", destino: "CF-2", sku: "", cantidad: "" });
  const [haciendoTraspaso, setHaciendoTraspaso] = useState(false);
  const [sacarForm, setSacarForm] = useState({ sku: "", cantidad: "", motivo: "Carga a ruta" });
  const [haciendoSalida, setHaciendoSalida] = useState(false);

  // Simulated pending cargas from chofers (vacío — no usar mock data con SKUs hardcodeados)
  const [cargasPendientes, setCargasPendientes] = useState([]);

  const [mermaModal, setMermaModal] = useState(false);
  const [mForm, setMForm] = useState({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
  const [fotoMermaFile, setFotoMermaFile] = useState(null);
  const [fotoMermaPreview, setFotoMermaPreview] = useState('');
  const [guardandoMerma, setGuardandoMerma] = useState(false);

  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

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

  // Escape para los 2 modales ad-hoc principales: "Ya produje hielo" y
  // "Mover entre congeladores". Si hay un guardado en curso (guardandoProd
  // o haciendoTraspaso), Escape NO cierra para evitar perder contexto.
  useEffect(() => {
    const algunoAbierto = !!modal || !!traspasoModal;
    if (!algunoAbierto) return;
    if (guardandoProd || haciendoTraspaso) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (modal) {
        setModal(false);
        // mantener consistencia con el click-fuera existente
        if (typeof clearFotoMermaProd === 'function') clearFotoMermaProd();
      } else if (traspasoModal) {
        setTraspasoModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, traspasoModal, guardandoProd, haciendoTraspaso]);

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
    setForm({ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" });
    clearFotoMermaProd();
  };

  const registrarMerma = async () => {
    if (!mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile) return;
    const cant = n(mForm.cantidad);
    const authOwner = s(user?.auth_id || user?.id || 'usuario');
    const ext = (fotoMermaFile.name?.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg';
    const filePath = `${authOwner}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${mForm.sku}.${safeExt}`;

    setGuardandoMerma(true);
    try {
      const { error: uploadErr } = await supabase.storage
        .from('mermas')
        .upload(filePath, fotoMermaFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: fotoMermaFile.type || 'image/jpeg',
        });
      if (uploadErr) {
        showToast('No se pudo subir la foto');
        return;
      }

      // registrarMerma descuenta del CF internamente (vía update_stocks_atomic)
      // — NO llamar sacarDeCuartoFrio antes o se descontaría dos veces.
      const mermaErr = await actions.registrarMerma(mForm.sku, cant, mForm.causa, s(user?.nombre), filePath);
      if (mermaErr) {
        await supabase.storage.from('mermas').remove([filePath]);
        showToast('No se pudo registrar la merma. Intenta de nuevo.');
        return;
      }

      showToast("Merma: " + cant + "× " + mForm.sku + " registrada");
      setMermaModal(false);
      clearFotoMerma();
      setMForm({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" });
    } finally {
      setGuardandoMerma(false);
    }
  };

  const prodHoy = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return data.produccion.filter(p => p.fecha && p.fecha.slice(0, 10) === hoy);
  }, [data.produccion]);

  const totalHoy = useMemo(() => prodHoy.reduce((s, p) => s + n(p.cantidad), 0), [prodHoy]);

  const mermasHoyList = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    return (data.mermas || []).filter(m => s(m.fecha).slice(0, 10) === hoy);
  }, [data.mermas]);

  const mermaHoy = useMemo(() => mermasHoyList.reduce((sum, item) => sum + n(item.cantidad), 0), [mermasHoyList]);
  const skuOptions = useMemo(() => data.productos.filter(p => s(p.tipo) === "Producto Terminado"), [data.productos]);

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
    const hoy = new Date().toISOString().slice(0, 10);
    for (const pr of (data.produccion || [])) {
      if (!s(pr.fecha).startsWith(hoy)) continue;
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

  const insumos = useMemo(() => data.productos.filter(p => {
    const t = s(p.tipo).toLowerCase(); const sk = s(p.sku).toLowerCase();
    return t.includes('barra') || t.includes('insumo') || t.includes('materia') || sk.includes('bh-') || sk.includes('barra');
  }), [data.productos]);

  const transformaciones = useMemo(() => (data.produccion || []).filter(p => p.tipo === 'Transformacion'), [data.produccion]);

  const transInputKg  = Number(transForm.input_kg  || 0);
  const transOutputKg = Number(transForm.output_kg || 0);
  const transMermaKg  = Math.max(0, transInputKg - transOutputKg);
  const transRendimiento = transInputKg > 0 ? Math.round((transOutputKg / transInputKg) * 100) : 0;
  const transStockInput = useMemo(() => {
    const p = data.productos.find(x => x.sku === transForm.input_sku);
    return p ? Number(p.stock || 0) : null;
  }, [data.productos, transForm.input_sku]);

  const registrarTransformacion = async () => {
    if (guardandoTrans) return;
    if (!transForm.input_sku || !transForm.output_sku || transInputKg <= 0 || transOutputKg <= 0) return;
    setGuardandoTrans(true);
    try {
      const err = await actions.addTransformacion({ ...transForm, input_kg: transInputKg, output_kg: transOutputKg });
      if (err && err.message) { showToast('Error: ' + err.message); return; }
      showToast(`Transformación: ${transInputKg}kg ${transForm.input_sku} → ${transOutputKg}kg ${transForm.output_sku}`);
      setTransModal(false);
      setTransForm({ input_sku: "", input_kg: "", output_sku: "", output_kg: "", notas: "" });
    } catch (e) {
      console.error('Error transformación:', e);
      showToast('Error en transformación. Verifica tu conexión.');
    } finally {
      setGuardandoTrans(false);
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
    if (guardandoProd) return;
    if (!form.cantidad || n(form.cantidad) <= 0) return;
    if (bolsaSku && n(form.cantidad) > stockBolsa) return;

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
        showToast(mensaje);
        return;
      }
    }

    // Sin merma: comportamiento original (atómico)
    if (!form.conMerma) {
      setGuardandoProd(true);
      try {
        await actions.producirYCongelar({
          turno: form.turno, maquina: form.maquina, sku: form.sku,
          cantidad: form.cantidad, destino: form.destino,
        });
        showToast(cant + " " + form.sku + " → " + cfNombre);
        setModal(false);
        resetFormProd();
      } catch (e) {
        console.error('Error registrando producción:', e);
        showToast('Error al registrar producción. Verifica tu conexión.');
      } finally {
        setGuardandoProd(false);
      }
      return;
    }

    // Con merma: validaciones extra
    const merma = n(form.mermaCantidad);
    if (merma <= 0 || merma > cant) return;
    if (!fotoMermaProdFile) return;

    setGuardandoProd(true);
    try {
      // 1. Subir foto a Storage
      const authOwner = s(user?.auth_id || user?.id || 'usuario');
      const ext = (fotoMermaProdFile.name?.split('.').pop() || 'jpg').toLowerCase();
      const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg';
      const filePath = `${authOwner}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${form.sku}-prod.${safeExt}`;

      const { error: uploadErr } = await supabase.storage
        .from('mermas')
        .upload(filePath, fotoMermaProdFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: fotoMermaProdFile.type || 'image/jpeg',
        });
      if (uploadErr) {
        showToast('No se pudo subir la foto de merma');
        return;
      }

      // 2. Producción + meter al cuarto frío (no retorna error; asume OK)
      await actions.producirYCongelar({
        turno: form.turno, maquina: form.maquina, sku: form.sku,
        cantidad: form.cantidad, destino: form.destino,
      });

      // 3. Registrar merma (descuenta del CF internamente)
      const mermaErr = await actions.registrarMerma(form.sku, merma, form.mermaCausa, s(user?.nombre), filePath);
      if (mermaErr) {
        showToast('Producción OK, pero la merma no se registró. Hazlo desde Mermas.');
        setModal(false);
        resetFormProd();
        return;
      }

      showToast(`${cant} producidas, ${merma} mermadas → ${cfNombre}`);
      setModal(false);
      resetFormProd();
    } finally {
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
      if (actions.traspasoEntreUbicaciones) await actions.traspasoEntreUbicaciones(tForm);
      showToast(tForm.cantidad + " " + tForm.sku + ": " + origenN + " → " + destinoN);
      setTraspasoModal(false);
      setTForm({ origen: "CF-1", destino: "CF-2", sku: "", cantidad: "" });
    } catch (e) {
      console.error('Error en traspaso:', e);
      showToast('Error en traspaso. Verifica tu conexión.');
    } finally {
      setHaciendoTraspaso(false);
    }
  };

  const hacerSalida = async () => {
    if (haciendoSalida) return;
    if (!sacarForm.cantidad || n(sacarForm.cantidad) <= 0 || !sacarModal) return;
    setHaciendoSalida(true);
    try {
      if (actions.sacarDeCuartoFrio) {
        await actions.sacarDeCuartoFrio(sacarModal.cfId, sacarForm.sku, sacarForm.cantidad, sacarForm.motivo);
      }
      showToast("Salida: " + sacarForm.cantidad + " " + sacarForm.sku + " de " + sacarModal.cfNombre);
      setSacarModal(null);
      setSacarForm({ sku: "", cantidad: "", motivo: "Carga a ruta" });
    } catch (e) {
      console.error('Error en salida:', e);
      showToast('Error al sacar del congelador. Verifica tu conexión.');
    } finally {
      setHaciendoSalida(false);
    }
  };

  return (
    <div className={PRODUCCION_SHELL}>
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-4 pb-5 text-white shadow-[0_24px_48px_rgba(37,99,235,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="erp-kicker text-cyan-200/70">Producción</p>
            <h1 className="font-display text-[1.6rem] font-bold tracking-[-0.04em]">Producción del día</h1>
            <p className="text-xs text-cyan-100/80">{s(user?.nombre)}</p>
          </div>
          <div className="flex items-center gap-2 relative">
            <BotonFirmasPendientes user={user} data={data} actions={actions} />
            <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold">Salir</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Producido hoy</p>
            <p className="mt-1.5 text-2xl font-extrabold">{totalHoy.toLocaleString()}</p>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">En congeladores</p>
            <p className="mt-1.5 text-2xl font-extrabold">{totalEnCuartos.toLocaleString()}</p>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-3.5 text-center backdrop-blur-xl sm:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Merma hoy</p>
            <p className="mt-1.5 text-2xl font-extrabold">{mermaHoy}</p>
          </div>
        </div>
      </div>

      {/* Banner urgente de firmas pendientes (solo Producción) */}
      <BotonFirmasPendientes
        user={user}
        data={data}
        actions={actions}
        mostrarBannerUrgente={true}
      />

      {/* Tabs */}
      <div className="px-4 pt-3">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-[20px] border border-slate-200/80 bg-white/72 p-1.5 shadow-[0_14px_28px_rgba(8,19,27,0.05)] sm:grid-cols-4">
          {[{ k: "producir", l: "Producción" }, { k: "cuartos", l: "Congeladores" }, { k: "mermas", l: "Mermas" }, { k: "trans", l: "🧊 Trans." }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex-1 py-3 text-sm font-bold rounded-[16px] transition-all ${tab === t.k ? "bg-blue-600 text-white shadow-[0_12px_22px_rgba(37,99,235,0.14)]" : "text-slate-600"}`}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3">

        {/* ═══ TAB: PRODUCCIÓN ═══ */}
        {tab === "producir" && (<>
          <button onClick={() => { resetFormProd(); setModal(true); }}
            className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(37,99,235,0.16)] active:scale-[0.98] transition-transform">
            + Ya produje hielo
          </button>

          {/* ═══ PANEL: Qué necesitas producir ═══ */}
          <div className={`rounded-[24px] p-4 border shadow-[0_14px_28px_rgba(8,19,27,0.06)] ${hayFaltante ? 'bg-amber-50 border-amber-200' : 'bg-white/90 border-slate-200/80'}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Qué necesitas producir</h3>
                <p className="text-[11px] text-slate-500">Pedidos pendientes + mínimo de stock − lo que ya hay</p>
              </div>
              {hayFaltante && <span className="text-[10px] font-bold uppercase bg-amber-500 text-white px-2 py-1 rounded-full">Atención</span>}
            </div>

            {tableroDemanda.length === 0 ? (
              <EmptyState
                message="Sin productos terminados configurados"
                hint="Pide a Admin que agregue productos terminados al catálogo"
              />
            ) : (
              <div className="space-y-2">
                {tableroDemanda.map(r => (
                  <div key={r.sku} className={`rounded-[16px] p-3 ${r.faltante > 0 ? 'bg-white border border-amber-200' : 'bg-slate-50 border border-slate-100'}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">{r.producto}</p>
                      {r.faltante > 0 ? (
                        <span className="text-xs font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full flex-shrink-0">Faltan {r.faltante.toLocaleString()}</span>
                      ) : (
                        <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">✓ Cubierto</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase">Pedidos</p>
                        <p className={`text-sm font-bold ${r.pendientes > 0 ? 'text-blue-600' : 'text-slate-400'}`}>{r.pendientes.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase">Stock</p>
                        <p className={`text-sm font-bold ${r.bajoMinimo ? 'text-red-600' : 'text-slate-700'}`}>{r.stock.toLocaleString()}{r.bajoMinimo && <span className="text-[10px] text-red-400 ml-0.5">▼</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase">Mínimo</p>
                        <p className="text-sm font-bold text-slate-500">{r.stockMinimo > 0 ? r.stockMinimo.toLocaleString() : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase">Hecho hoy</p>
                        <p className={`text-sm font-bold ${r.producidoHoy > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.producidoHoy.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {prodHoy.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Producido hoy</h3>
              {prodHoy.map(p => (
                <div key={p.id} className="bg-emerald-50/90 rounded-[20px] p-3 border border-emerald-200 mb-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{n(p.cantidad).toLocaleString()} × {s(p.sku)}</p>
                      <p className="text-xs text-slate-500">{s(p.maquina)} · {s(p.turno)}</p>
                    </div>
                    <span className="text-xs text-emerald-600 font-bold bg-emerald-100 px-2 py-1 rounded-lg">✓ Congelado</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prodHoy.length === 0 && (
            <EmptyState
              message="Aún no has registrado producción hoy"
              icon={<span className="text-4xl">🧊</span>}
              hint="Cuando produzcas hielo en el día, aparecerá aquí el detalle"
              cta="+ Ya produje hielo"
              onCta={() => { resetFormProd(); setModal(true); }}
            />
          )}
        </>)}

        {/* ═══ TAB: CONGELADORES ═══ */}
        {tab === "cuartos" && (<>
          <button onClick={() => setTraspasoModal(true)}
            className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(37,99,235,0.16)] active:scale-[0.98] transition-transform">
            Mover entre congeladores
          </button>

          {/* Cargas pendientes de chofers */}
          {cargasPendientes.filter(c => c.estatus === "Pendiente").length > 0 && (
            <div className="bg-amber-50/90 rounded-[24px] p-4 border border-amber-200 shadow-[0_14px_28px_rgba(8,19,27,0.05)]">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-600">Cargas pendientes</h3>
              <p className="mb-3 text-sm font-semibold text-slate-700">Choferes listos para salida</p>
              {cargasPendientes.filter(c => c.estatus === "Pendiente").map(cg => (
                <div key={cg.id} className="bg-white/84 rounded-[20px] p-3 mb-2 border border-white/80">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{cg.chofer}</p>
                      <p className="text-xs text-slate-400">{cg.ruta} · {cg.hora}</p>
                    </div>
                    <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-1 rounded-lg">Pendiente</span>
                  </div>
                  <div className="flex gap-1 mb-2">
                    {Object.entries(cg.items).map(([sku, cant]) => (
                      <span key={sku} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">{cant}× {sku}</span>
                    ))}
                  </div>
                  <button onClick={() => {
                    setCargasPendientes(prev => prev.map(p => p.id === cg.id ? { ...p, estatus: "Entregado" } : p));
                    showToast("Carga entregada a " + cg.chofer + " ✓");
                  }}
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-[18px] text-sm active:scale-[0.98] transition-transform">
                    Entregar carga
                  </button>
                </div>
              ))}
            </div>
          )}

          {cuartos.map(cf => {
            const stockEntries = cf.stock ? Object.entries(cf.stock) : [];
            const total = stockEntries.reduce((s, [, v]) => s + n(v), 0);
            return (
              <div key={cf.id} className="bg-white/78 rounded-[24px] border border-slate-200/80 shadow-[0_14px_28px_rgba(8,19,27,0.05)] overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                      <span className="text-2xl">🧊</span>
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800">{s(cf.nombre)}</p>
                      <p className="text-xs text-slate-500">{n(cf.temp, -50, 10)}°C</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-slate-800">{total.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">bolsas</p>
                  </div>
                </div>

                {(() => {
                  const ocupado = tarimasOcupadasEnCuarto(cf, data.productos);
                  const capacidad = n(cf.capacidad_tarimas);
                  if (capacidad <= 0) return null;
                  const pct = Math.round((ocupado / capacidad) * 100);
                  const color = colorTarimasUso(ocupado, capacidad);
                  const colorClass = color === 'red' ? 'bg-red-500' : color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
                  const textColorClass = color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-emerald-700';
                  return (
                    <div className="px-4 pb-3">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Tarimas</span>
                        <span className={`text-xs font-bold ${textColorClass}`}>
                          {ocupado.toFixed(1)}/{capacidad} ({fmtPct(ocupado, capacidad)})
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${colorClass} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  );
                })()}

                {stockEntries.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                    {stockEntries.map(([sku, qty]) => (
                      <div key={sku} className="bg-slate-50 rounded-[18px] p-3">
                        <p className="text-xs text-slate-400 font-mono">{sku}</p>
                        <p className="text-lg font-extrabold text-slate-800">{n(qty).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 pb-3"><div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-sm text-slate-400">Vacío</p></div></div>
                )}
                <div className="border-t border-slate-100">
                  <button onClick={() => { setSacarModal({ cfId: s(cf.id), cfNombre: s(cf.nombre) }); setSacarForm({ sku: "", cantidad: "", motivo: "Carga a ruta" }); }}
                    className="w-full py-3 text-xs font-bold text-amber-600 active:bg-amber-50">
                    − Sacar hielo (carga a ruta / otro)
                  </button>
                </div>
              </div>
            );
          })}
        </>)}

        {/* ═══ TAB: TRANSFORMACIONES ═══ */}
        {tab === "trans" && (<>
          <button onClick={() => setTransModal(true)}
            className="w-full py-4 bg-cyan-700 text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(14,116,144,0.16)] active:scale-[0.98] transition-transform">
            + Nueva transformación
          </button>

          {transformaciones.length === 0 ? (
            <EmptyState
              message="Sin transformaciones registradas"
              icon={<span className="text-4xl">🧊</span>}
              hint="Las transformaciones de barras a triturado quedan aquí"
              cta="+ Nueva transformación"
              onCta={() => setTransModal(true)}
            />
          ) : (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historial ({transformaciones.length})</h3>
              {transformaciones.slice().reverse().map(t => {
                const rend = Number(t.rendimiento || 0);
                const rendColor = rend >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : rend >= 65 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
                return (
                  <div key={t.id} className="bg-white/84 rounded-[22px] p-4 border border-slate-200/80 shadow-[0_8px_18px_rgba(8,19,27,0.04)]">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-slate-500">{t.folio || t.id} · {fmtDate(t.fecha)}</p>
                      <span className={`text-xs font-extrabold px-2 py-0.5 rounded-lg border ${rendColor}`}>{rend}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-slate-50 rounded-xl p-2">
                        <p className="text-slate-400 mb-0.5">Entrada</p>
                        <p className="font-extrabold text-slate-800">{Number(t.input_kg || 0)} kg</p>
                        <p className="text-slate-500 font-mono">{t.input_sku}</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-2">
                        <p className="text-red-400 mb-0.5">Merma</p>
                        <p className="font-extrabold text-red-700">{Number(t.merma_kg || 0)} kg</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-2">
                        <p className="text-emerald-600 mb-0.5">Salida</p>
                        <p className="font-extrabold text-emerald-800">{Number(t.output_kg || 0)} kg</p>
                        <p className="text-emerald-600 font-mono">{t.output_sku}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>)}

        <div className="h-8" />
      </div>

      {/* ═══ MODAL: Ya produje hielo ═══ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => { setModal(false); clearFotoMermaProd(); }}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[90vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Producción</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">¿Qué produjiste?</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 ${form.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" min="0" inputMode="numeric" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="Ej: 500" autoFocus />
              </div>
              {bolsaSku && (
                <div className={`p-3 rounded-xl ${n(form.cantidad) > stockBolsa ? "bg-red-50" : "bg-blue-50"}`}>
                  <p className="text-xs font-semibold">Consume: {form.cantidad || 0} bolsas {bolsaSku}</p>
                  <p className={`text-xs mt-0.5 ${n(form.cantidad) > stockBolsa ? "text-red-600 font-bold" : "text-slate-500"}`}>
                    Disponibles: {stockBolsa.toLocaleString()}{n(form.cantidad) > stockBolsa ? " — INSUFICIENTE" : ""}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Máquina</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {["Máquina 30", "Máquina 20", "Máquina 15"].map(m => (
                    <button key={m} onClick={() => setForm(f => ({ ...f, maquina: m }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${form.maquina === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {m.replace("Máquina ", "Máq ")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Turno</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {["Turno 1", "Turno 2", "Turno 3"].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, turno: t }))}
                      className={`py-2 rounded-xl text-sm font-semibold border-2 ${form.turno === t ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿A qué congelador va?</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setForm(f => ({ ...f, destino: s(cf.id) }))}
                      className={`py-3 rounded-xl text-xs font-bold border-2 ${form.destino === s(cf.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                      <p className="text-[10px] text-slate-400 mt-0.5">{n(cf.temp, -50, 10)}°C</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* ═══ Merma inline opcional ═══ */}
              <div className="border-t border-slate-200 pt-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.conMerma}
                    onChange={e => {
                      const checked = e.target.checked;
                      setForm(f => ({ ...f, conMerma: checked }));
                      if (!checked) clearFotoMermaProd();
                    }}
                    className="w-5 h-5 rounded border-slate-300 accent-red-500"
                  />
                  <span className="text-sm font-semibold text-slate-700">¿Hubo merma en este lote?</span>
                </label>
              </div>

              {form.conMerma && (
                <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad de merma</label>
                    <input type="number" min="0" inputMode="numeric" value={form.mermaCantidad}
                      onChange={e => setForm(f => ({ ...f, mermaCantidad: e.target.value }))}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="0" />
                    {form.mermaCantidad && n(form.mermaCantidad) > n(form.cantidad) && (
                      <p className="text-xs text-red-600 font-bold mt-1 text-center">No puede ser mayor a la cantidad producida ({n(form.cantidad)})</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Causa</label>
                    <div className="grid grid-cols-2 gap-2">
                      {MERMA_CAUSAS.map(c => (
                        <button key={c} onClick={() => setForm(f => ({ ...f, mermaCausa: c }))}
                          className={`py-2 rounded-xl text-xs font-semibold border-2 ${form.mermaCausa === c ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Evidencia (foto) *</label>
                    {fotoMermaProdPreview ? (
                      <div>
                        <img src={fotoMermaProdPreview} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" />
                        <button onClick={clearFotoMermaProd} className="text-xs text-slate-400 mt-1">Tomar otra</button>
                      </div>
                    ) : (
                      <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                        <span className="text-lg">📷</span> Tomar foto de evidencia
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { clearFotoMermaProd(); setFotoMermaProdFile(f); setFotoMermaProdPreview(URL.createObjectURL(f)); } }} />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button onClick={registrarProduccion}
              disabled={
                guardandoProd ||
                !form.cantidad || n(form.cantidad) <= 0 ||
                (bolsaSku && n(form.cantidad) > stockBolsa) ||
                (form.conMerma && (
                  !form.mermaCantidad || n(form.mermaCantidad) <= 0 ||
                  n(form.mermaCantidad) > n(form.cantidad) ||
                  !fotoMermaProdFile
                ))
              }
              className="w-full py-4 bg-blue-600 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
              {guardandoProd ? 'Guardando...' : 'Registrar producción'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Mover entre congeladores ═══ */}
      {traspasoModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setTraspasoModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Movimiento</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Mover entre congeladores</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">De</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setTForm(f => ({ ...f, origen: s(cf.id) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${tForm.origen === s(cf.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">A</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setTForm(f => ({ ...f, destino: s(cf.id) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${tForm.destino === s(cf.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"} ${tForm.origen === s(cf.id) ? "opacity-30" : ""}`}>
                      {s(cf.nombre).replace("Cuarto Frío ", "CF-")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setTForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2 rounded-xl text-xs font-bold border-2 ${tForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" min="0" inputMode="numeric" value={tForm.cantidad} onChange={e => setTForm(f => ({ ...f, cantidad: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" />
            </div>
            <button onClick={hacerTraspaso} disabled={haciendoTraspaso || !tForm.cantidad || n(tForm.cantidad) <= 0 || tForm.origen === tForm.destino}
              className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40 disabled:cursor-not-allowed">
              {haciendoTraspaso ? 'Trasladando…' : 'Mover'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Sacar hielo ═══ */}
      {sacarModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setSacarModal(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Salida</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-1">Sacar hielo</h3>
            <p className="text-sm text-slate-500 mb-4">{sacarModal.cfNombre}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setSacarForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${sacarForm.sku === s(p.sku) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.sku)}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" min="0" inputMode="numeric" value={sacarForm.cantidad} onChange={e => setSacarForm(f => ({ ...f, cantidad: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="Cantidad" autoFocus />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {["Carga a ruta", "Venta directa", "Merma", "Otro"].map(m => (
                    <button key={m} onClick={() => setSacarForm(f => ({ ...f, motivo: m }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${sacarForm.motivo === m ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={hacerSalida} disabled={haciendoSalida || !sacarForm.cantidad || n(sacarForm.cantidad) <= 0}
              className="w-full py-3.5 bg-amber-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40 disabled:cursor-not-allowed">
              {haciendoSalida ? 'Sacando…' : 'Sacar del congelador'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ TAB MERMAS ═══ */}
        {tab === "mermas" && (<>
          <button onClick={() => { setMermaModal(true); clearFotoMerma(); setMForm({ sku: "", cantidad: "", causa: "Bolsa rota", congelador: "CF-1" }); }}
            className="w-full py-4 bg-[#8f2d22] text-white font-extrabold rounded-[22px] text-base shadow-[0_20px_34px_rgba(143,45,34,0.18)] active:scale-[0.98] transition-transform">
            Registrar merma
          </button>

          {mermasHoyList.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mermas de hoy ({mermasHoyList.length})</h3>
              {mermasHoyList.map(m => (
                <div key={m.id} className="bg-red-50/90 rounded-[20px] p-3 border border-red-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-red-700">{m.cantidad}× {m.sku}</p>
                      <p className="text-xs text-slate-500">{m.causa} · {m.origen} · {m.fecha ? fmtDate(m.fecha) : 'Hoy'}</p>
                    </div>
                    {m.fotoUrl && <img src={m.fotoUrl} alt="Evidencia" className="w-10 h-10 object-cover rounded-lg border border-red-300" />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              message="Buen turno"
              icon={<span className="text-4xl">✅</span>}
              hint="No has registrado mermas hoy"
            />
          )}
        </>)}

      {/* ═══ MODAL MERMA ═══ */}
      {mermaModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setMermaModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[85vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Merma</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Registrar merma</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Producto</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(data.productos || []).filter(p => s(p.tipo) === "Producto Terminado").map(p => (
                    <button key={p.sku} onClick={() => setMForm(f => ({ ...f, sku: s(p.sku) }))}
                      className={`py-2.5 rounded-xl text-xs font-bold border-2 ${mForm.sku === s(p.sku) ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" min="0" value={mForm.cantidad} onChange={e => setMForm(f => ({ ...f, cantidad: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xl font-bold text-center" placeholder="0" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Causa</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MERMA_CAUSAS.map(c => (
                    <button key={c} onClick={() => setMForm(f => ({ ...f, causa: c }))}
                      className={`py-2 rounded-xl text-xs font-semibold border-2 ${mForm.causa === c ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿De qué congelador?</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cuartos.map(cf => (
                    <button key={cf.id} onClick={() => setMForm(f => ({ ...f, congelador: s(cf.id) }))}
                      className={`py-2 rounded-xl text-xs font-bold border-2 ${mForm.congelador === s(cf.id) ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"}`}>
                      {s(cf.nombre)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Evidencia (foto) *</label>
                {fotoMermaPreview ? (
                  <div><img src={fotoMermaPreview} alt="Evidencia" className="w-full h-32 object-cover rounded-xl border border-emerald-300" /><button onClick={clearFotoMerma} className="text-xs text-slate-400 mt-1">Tomar otra</button></div>
                ) : (
                  <label className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-500 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                    <span className="text-lg">📷</span> Tomar foto de evidencia
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { clearFotoMerma(); setFotoMermaFile(f); setFotoMermaPreview(URL.createObjectURL(f)); } }} />
                  </label>
                )}
              </div>
            </div>
            <button onClick={registrarMerma} disabled={guardandoMerma || !mForm.cantidad || n(mForm.cantidad) <= 0 || !fotoMermaFile}
              className="w-full py-3.5 bg-red-500 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">
              {guardandoMerma ? 'Guardando...' : 'Registrar merma'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Transformación ═══ */}
      {transModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setTransModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-[30px] border border-slate-200/80 p-5 max-h-[90vh] overflow-y-auto shadow-[0_30px_70px_rgba(8,19,27,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Transformación</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-4">Barras → Hielo triturado</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Qué entró? (Insumo)</label>
                {insumos.length === 0 ? (
                  <EmptyState
                    message="Sin insumos en el catálogo"
                    hint="Pide a Admin que agregue barras (kg) al catálogo"
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {insumos.map(p => (
                      <button key={p.sku} onClick={() => setTransForm(f => ({ ...f, input_sku: s(p.sku) }))}
                        className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 text-left ${transForm.input_sku === s(p.sku) ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-600"}`}>
                        <p>{s(p.nombre)}</p>
                        <p className="font-mono text-[10px] opacity-70">{s(p.sku)} · {Number(p.stock || 0)} kg stock</p>
                      </button>
                    ))}
                  </div>
                )}
                <input type="number" min="0" step="0.01" inputMode="decimal" value={transForm.input_kg} onChange={e => setTransForm(f => ({ ...f, input_kg: e.target.value }))}
                  className="w-full mt-2 px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="kg a transformar" />
                {transStockInput !== null && transInputKg > transStockInput && (
                  <p className="text-xs text-red-600 font-semibold mt-1 text-center">Stock insuficiente ({transStockInput} kg disponibles)</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">¿Qué salió? (Producto)</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {skuOptions.map(p => (
                    <button key={p.sku} onClick={() => setTransForm(f => ({ ...f, output_sku: s(p.sku) }))}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 text-left ${transForm.output_sku === s(p.sku) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                      {s(p.nombre)}
                    </button>
                  ))}
                </div>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={transForm.output_kg} onChange={e => setTransForm(f => ({ ...f, output_kg: e.target.value }))}
                  className="w-full mt-2 px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold text-center" placeholder="kg obtenidos" />
              </div>
              {transInputKg > 0 && transOutputKg > 0 && (
                <div className={`rounded-[18px] p-3 border ${transRendimiento >= 80 ? 'bg-emerald-50 border-emerald-200' : transRendimiento >= 65 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="text-slate-400">Entrada</p><p className="font-extrabold text-slate-800">{transInputKg} kg</p></div>
                    <div><p className="text-red-400">Merma</p><p className="font-extrabold text-red-700">{transMermaKg.toFixed(1)} kg</p></div>
                    <div><p className="text-slate-400">Rendimiento</p><p className={`font-extrabold ${transRendimiento >= 80 ? 'text-emerald-700' : transRendimiento >= 65 ? 'text-amber-700' : 'text-red-700'}`}>{transRendimiento}%</p></div>
                  </div>
                </div>
              )}
              <input type="text" value={transForm.notas} onChange={e => setTransForm(f => ({ ...f, notas: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm" placeholder="Notas (opcional)" />
            </div>
            <button onClick={registrarTransformacion}
              disabled={guardandoTrans || !transForm.input_sku || !transForm.output_sku || transInputKg <= 0 || transOutputKg <= 0 || transOutputKg > transInputKg || (transStockInput !== null && transInputKg > transStockInput)}
              className="w-full py-4 bg-cyan-700 text-white font-extrabold rounded-xl text-sm mt-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
              {guardandoTrans ? 'Guardando...' : 'Registrar transformación'}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-4 py-2.5 rounded-full text-sm font-semibold shadow-[0_18px_32px_rgba(5,150,105,0.24)]" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
