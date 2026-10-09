import { Icons } from './ui/Icons';
import { useState, useMemo, useRef, useEffect } from 'react';
import { s, n } from '../utils/safe';
import { resolverOperacion, claveCarga } from '../data/stockContratosLogic';
import { useToast } from './views/viewsCommon';
import { useBodyScrollLock } from './ui/Modal';

export default function BotonFirmasPendientes({ user, data, actions, mostrarBannerUrgente = false }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [rutaSeleccionada, setRutaSeleccionada] = useState(null);
  const [firmaTienePuntos, setFirmaTienePuntos] = useState(false);
  const [firmaDibujando, setFirmaDibujando] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [advertenciaAdmin, setAdvertenciaAdmin] = useState(null);
  // Tanda 17 P1: body scroll lock para los 2 modales custom de este componente.
  useBodyScrollLock(!!rutaSeleccionada || !!advertenciaAdmin);

  // Tracking de rutas ya mostradas en popup automático para no repetir
  const rutasYaMostradas = useRef(new Set());
  const inicializado = useRef(false);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const opFirmaRef = useRef(null); // R2 (084): mismo operacion_id por ruta mientras se reintenta
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  const puedeFirmar = user?.rol === 'Producción' || user?.rol === 'Admin';
  const esProduccion = user?.rol === 'Producción';
  const esAdmin = user?.rol === 'Admin';

  const rutasPendientes = useMemo(() => {
    if (!puedeFirmar) return [];
    return (data.rutas || []).filter(r =>
      s(r.estatus).toLowerCase() === 'pendiente firma'
    );
  }, [data.rutas, puedeFirmar]);

  // ── DETECCIÓN AUTOMÁTICA DE RUTAS NUEVAS ──
  // Solo la instancia con mostrarBannerUrgente=true dispara popup automático.
  // Si hay 2 instancias (botón header + banner urgente), evita doble popup.
  useEffect(() => {
    if (!puedeFirmar) return;
    if (!esProduccion) return;
    if (!mostrarBannerUrgente) return;

    // Primera vez que carga: marcar todas las rutas existentes como ya vistas
    // (no abrir popup para rutas que llevan rato esperando)
    if (!inicializado.current) {
      rutasPendientes.forEach(r => rutasYaMostradas.current.add(String(r.id)));
      inicializado.current = true;
      return;
    }

    // Detectar rutas que NO estaban en el set (son nuevas)
    const rutasNuevas = rutasPendientes.filter(
      r => !rutasYaMostradas.current.has(String(r.id))
    );

    if (rutasNuevas.length > 0 && !rutaSeleccionada) {
      // Abrir popup con la primera ruta nueva
      const primeraNueva = rutasNuevas[0];

      // Marcar TODAS las nuevas como ya mostradas (aunque solo abramos una)
      rutasNuevas.forEach(r => rutasYaMostradas.current.add(String(r.id)));

      // Reproducir sonido suave
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRl4HAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YToHAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJOQgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
        audio.volume = 0.3;
        audio.play().catch(() => {}); // Silencioso si el navegador bloquea
      } catch {}

      // Abrir el modal de firma con esta ruta
      setRutaSeleccionada(primeraNueva);
      setFirmaTienePuntos(false);
    }

    // Limpiar del set las rutas que ya no están pendientes (ya firmadas o canceladas)
    const idsActuales = new Set(rutasPendientes.map(r => String(r.id)));
    for (const idGuardado of Array.from(rutasYaMostradas.current)) {
      if (!idsActuales.has(idGuardado)) {
        rutasYaMostradas.current.delete(idGuardado);
      }
    }
  }, [rutasPendientes, puedeFirmar, rutaSeleccionada]);

  // Click fuera del dropdown + Escape → cerrar.
  // Listener se registra en el siguiente frame (rAF) para evitar que el
  // mismo click que abrió el dropdown lo cierre inmediatamente.
  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    const handleClickOutside = (e) => {
      const dd = dropdownRef.current;
      const trigger = triggerRef.current;
      if (!dd) return;
      if (dd.contains(e.target)) return;
      if (trigger && trigger.contains(e.target)) return;
      setAbierto(false);
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    const raf = requestAnimationFrame(() => {
      if (cancelado) return;
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    });
    return () => {
      cancelado = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [abierto]);

  // Escape para los 2 modales internos (advertenciaAdmin + rutaSeleccionada).
  // Cuando hay firma en curso (firmando=true), Escape NO cierra para evitar
  // que el usuario crea que canceló cuando la firma ya está enviándose.
  useEffect(() => {
    const algunoAbierto = !!advertenciaAdmin || !!rutaSeleccionada;
    if (!algunoAbierto) return;
    if (firmando) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (rutaSeleccionada) {
        setRutaSeleccionada(null);
        setFirmaTienePuntos(false);
      } else if (advertenciaAdmin) {
        setAdvertenciaAdmin(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [advertenciaAdmin, rutaSeleccionada, firmando]);

  if (!puedeFirmar) return null;

  const handleAbrirRuta = (ruta) => {
    setAbierto(false);
    if (esAdmin) {
      setAdvertenciaAdmin(ruta);
    } else {
      setRutaSeleccionada(ruta);
      setFirmaTienePuntos(false);
    }
  };

  const limpiarFirma = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (canvas && ctx) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setFirmaTienePuntos(false);
    }
  };

  const confirmarFirma = async () => {
    if (!firmaTienePuntos || firmando) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setFirmando(true);
    try {
      const firmaBase64 = canvas.toDataURL('image/png');
      // Producción/Admin firma con SU sesión: el contrato registra al actor
      // autenticado como firmante (084); no se envía identidad del chofer.
      const op = resolverOperacion(opFirmaRef.current, claveCarga({ rutaId: rutaSeleccionada.id, excepcion: false }));
      opFirmaRef.current = op;
      const result = await actions.firmarCarga?.(rutaSeleccionada.id, firmaBase64, { operacionId: op.id });
      if (result && result.message) {
        toast?.error('Error: ' + result.message);
        return;
      }
      opFirmaRef.current = null;
      setRutaSeleccionada(null);
      setFirmaTienePuntos(false);
    } catch (e) {
      toast?.error('No se pudo firmar: ' + (e.message || 'error'));
    } finally {
      setFirmando(false);
    }
  };

  return (
    <>
      {/* Banner urgente persistente — solo cuando se solicita explícitamente */}
      {mostrarBannerUrgente && esProduccion && rutasPendientes.length > 0 && (
        <button
          onClick={() => {
            const primera = rutasPendientes[0];
            setRutaSeleccionada(primera);
            setFirmaTienePuntos(false);
          }}
          className="flex w-full items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-colors active:bg-amber-100"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><Icons.Pen /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-amber-900">
              {rutasPendientes.length} firma{rutasPendientes.length === 1 ? '' : 's'} pendiente{rutasPendientes.length === 1 ? '' : 's'}
            </p>
            <p className="text-[13px] text-amber-800/80">Tocar para firmar</p>
          </div>
          <span className="flex-shrink-0 text-amber-700"><Icons.ChevronRight /></span>
        </button>
      )}

      {/* Botón en topbar — solo en modo NO banner y solo si hay firmas pendientes
          (mobile-first: la cabecera no muestra íconos sin nada que hacer). */}
      {!mostrarBannerUrgente && rutasPendientes.length > 0 && (
        <>
      <button
        ref={triggerRef}
        onClick={() => setAbierto(!abierto)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 lg:h-11 lg:w-11"
        title="Firmas pendientes" aria-label="Firmas pendientes"
      >
        <Icons.Pen />
        {rutasPendientes.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {rutasPendientes.length}
          </span>
        )}
      </button>

      {/* Dropdown con lista */}
      {abierto && (
        <div ref={dropdownRef} className="absolute right-0 top-full z-50 mt-2 w-[calc(100vw-32px)] overflow-hidden rounded-card border border-line bg-white shadow-pop animate-pop-in sm:w-80">
          <div className="border-b border-line px-4 py-3">
            <p className="erp-kicker text-slate-500">
              {esAdmin ? 'Esperando firma de Producción' : 'Firmas de carga'}
            </p>
            <h3 className="font-display text-[15px] font-bold text-ink">
              {rutasPendientes.length} ruta{rutasPendientes.length === 1 ? '' : 's'} esperando
            </h3>
            {esAdmin && (
              <p className="mt-1 text-[11px] text-slate-500">Solo firma si Producción no está disponible</p>
            )}
          </div>
          {rutasPendientes.length === 0 ? (
            <div className="p-6 text-center">
              <p className="mb-2 flex justify-center text-emerald-600"><Icons.CheckCircle /></p>
              <p className="text-sm font-semibold text-slate-600">Sin firmas pendientes</p>
              <p className="text-xs text-slate-400 mt-1">Todo está al día</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {rutasPendientes.map(r => {
                const choferNombre = s(r.choferNombre || r.chofer_nombre || r.chofer);
                const cargaReal = (r.carga_real && typeof r.carga_real === 'object') ? r.carga_real : {};
                const totalBolsas = Object.values(cargaReal).reduce((a, b) => a + n(b), 0);
                return (
                  <button
                    key={r.id}
                    onClick={() => handleAbrirRuta(r)}
                    className="w-full px-4 py-3 text-left transition-colors active:bg-slate-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold text-ink">{s(r.folio) || `Ruta #${r.id}`}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{choferNombre || 'Sin chofer'} · {totalBolsas} bolsas</p>
                      </div>
                      <span className="ml-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Firmar</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Modal de advertencia para Admin antes de firmar */}
      {advertenciaAdmin && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/40 p-5 animate-fadeIn" onClick={() => setAdvertenciaAdmin(null)}>
          <div className="w-full max-w-md rounded-panel bg-white p-5 shadow-pop animate-pop-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center w-14 h-14 bg-amber-100 text-amber-700 rounded-full mx-auto mb-3">
              <Icons.AlertTriangle />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 text-center mb-2">
              Esta firma le corresponde a Producción
            </h3>
            <p className="text-sm text-slate-600 text-center mb-3">
              El responsable de cuarto frío debe verificar físicamente la carga del camión antes de firmar.
            </p>
            <p className="text-xs text-slate-500 text-center mb-4">
              Solo firma como Admin si Producción no está disponible. Esta acción quedará registrada como firma de Admin.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setAdvertenciaAdmin(null)}
                className="min-h-[48px] flex-1 rounded-field border border-line bg-white text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const ruta = advertenciaAdmin;
                  setAdvertenciaAdmin(null);
                  setRutaSeleccionada(ruta);
                  setFirmaTienePuntos(false);
                }}
                className="min-h-[48px] flex-1 rounded-field bg-amber-600 text-sm font-semibold text-white"
              >
                Firmar como Admin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de firma */}
      {rutaSeleccionada && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-ink/40 animate-fadeIn md:items-center md:p-5" onClick={() => !firmando && setRutaSeleccionada(null)}>
          <div className="w-full max-w-md rounded-t-panel bg-white p-5 shadow-sheet animate-sheet-in md:rounded-panel md:shadow-pop" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }} onClick={e => e.stopPropagation()}>
            <p className="erp-kicker text-slate-500">Firma de Producción</p>
            <h3 className="font-display mb-1 text-[17px] font-bold text-ink">{s(rutaSeleccionada.folio)}</h3>
            <p className="mb-3 text-[13px] text-slate-500">
              Chofer: {s(rutaSeleccionada.choferNombre || rutaSeleccionada.chofer_nombre || rutaSeleccionada.chofer || '—')}
            </p>

            {/* Resumen de carga */}
            <div className="mb-3 max-h-40 overflow-y-auto rounded-field bg-slate-50 p-3 sm:max-h-32">
              <p className="erp-kicker mb-2 text-slate-500">Carga reportada</p>
              {(() => {
                const cargaReal = (rutaSeleccionada.carga_real && typeof rutaSeleccionada.carga_real === 'object') ? rutaSeleccionada.carga_real : {};
                const entries = Object.entries(cargaReal);
                if (entries.length === 0) return <p className="text-xs text-slate-400">Sin datos de carga</p>;
                return entries.map(([sku, qty]) => {
                  const prod = (data.productos || []).find(p => s(p.sku) === sku);
                  return (
                    <div key={sku} className="flex justify-between text-sm py-0.5">
                      <span className="text-slate-700">{prod ? s(prod.nombre) : sku}</span>
                      <span className="tnum font-bold text-ink">{qty}</span>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Canvas de firma */}
            <p className="mb-2 text-[13px] font-medium text-slate-700">Dibuja tu firma</p>
            <canvas
              ref={el => {
                if (el && !ctxRef.current) {
                  canvasRef.current = el;
                  el.width = el.offsetWidth * 2;
                  el.height = el.offsetHeight * 2;
                  const ctx = el.getContext('2d');
                  ctx.scale(2, 2);
                  ctx.fillStyle = 'white';
                  ctx.fillRect(0, 0, el.width, el.height);
                  ctx.strokeStyle = '#0a1929';
                  ctx.lineWidth = 2.5;
                  ctx.lineCap = 'round';
                  ctxRef.current = ctx;
                }
              }}
              className="h-48 w-full touch-none rounded-card border-2 border-slate-300 bg-white sm:h-40"
              onMouseDown={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                ctxRef.current.beginPath();
                ctxRef.current.moveTo(e.clientX - rect.left, e.clientY - rect.top);
                setFirmaDibujando(true);
              }}
              onMouseMove={e => {
                if (!firmaDibujando) return;
                const rect = e.currentTarget.getBoundingClientRect();
                ctxRef.current.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                ctxRef.current.stroke();
                setFirmaTienePuntos(true);
              }}
              onMouseUp={() => setFirmaDibujando(false)}
              onMouseLeave={() => setFirmaDibujando(false)}
              onTouchStart={e => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const t = e.touches[0];
                ctxRef.current.beginPath();
                ctxRef.current.moveTo(t.clientX - rect.left, t.clientY - rect.top);
                setFirmaDibujando(true);
              }}
              onTouchMove={e => {
                e.preventDefault();
                if (!firmaDibujando) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const t = e.touches[0];
                ctxRef.current.lineTo(t.clientX - rect.left, t.clientY - rect.top);
                ctxRef.current.stroke();
                setFirmaTienePuntos(true);
              }}
              onTouchEnd={() => setFirmaDibujando(false)}
            />

            <div className="mt-3 flex gap-2">
              <button onClick={limpiarFirma} className="min-h-[48px] rounded-field bg-slate-100 px-4 text-sm font-semibold text-slate-700">Limpiar</button>
              <button onClick={() => setRutaSeleccionada(null)} className="min-h-[48px] flex-1 rounded-field border border-line bg-white text-sm font-semibold text-slate-700" disabled={firmando}>Cancelar</button>
              <button
                onClick={confirmarFirma}
                disabled={!firmaTienePuntos || firmando}
                className="min-h-[48px] flex-[1.4] rounded-field bg-emerald-600 text-sm font-semibold text-white disabled:opacity-40"
              >
                {firmando ? 'Firmando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
