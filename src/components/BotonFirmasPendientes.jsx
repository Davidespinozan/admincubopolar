import { useState, useMemo, useRef, useEffect } from 'react';
import { s, n } from '../utils/safe';

export default function BotonFirmasPendientes({ user, data, actions }) {
  const [abierto, setAbierto] = useState(false);
  const [rutaSeleccionada, setRutaSeleccionada] = useState(null);
  const [firmaTienePuntos, setFirmaTienePuntos] = useState(false);
  const [firmaDibujando, setFirmaDibujando] = useState(false);
  const [firmando, setFirmando] = useState(false);

  // Tracking de rutas ya mostradas en popup automático para no repetir
  const rutasYaMostradas = useRef(new Set());
  const inicializado = useRef(false);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  const puedeFirmar = user?.rol === 'Producción' || user?.rol === 'Admin';

  const rutasPendientes = useMemo(() => {
    if (!puedeFirmar) return [];
    return (data.rutas || []).filter(r =>
      s(r.estatus).toLowerCase() === 'pendiente firma'
    );
  }, [data.rutas, puedeFirmar]);

  // ── DETECCIÓN AUTOMÁTICA DE RUTAS NUEVAS ──
  useEffect(() => {
    if (!puedeFirmar) return;

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

  if (!puedeFirmar) return null;

  const handleAbrirRuta = (ruta) => {
    setRutaSeleccionada(ruta);
    setAbierto(false);
    setFirmaTienePuntos(false);
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
      const result = await actions.firmarCarga?.(rutaSeleccionada.id, firmaBase64);
      if (result && result.message) {
        alert('Error: ' + result.message);
        return;
      }
      setRutaSeleccionada(null);
      setFirmaTienePuntos(false);
    } catch (e) {
      alert('No se pudo firmar: ' + (e.message || 'error'));
    } finally {
      setFirmando(false);
    }
  };

  return (
    <>
      {/* Botón en topbar */}
      <button
        onClick={() => setAbierto(!abierto)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/8 border border-white/10 text-cyan-200 hover:bg-white/12 transition-colors"
        title="Firmas pendientes"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
          <path d="M2 2l7.586 7.586"/>
          <circle cx="11" cy="11" r="2"/>
        </svg>
        {rutasPendientes.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-400 text-slate-900 text-[10px] font-extrabold rounded-full flex items-center justify-center border-2 border-slate-900">
            {rutasPendientes.length}
          </span>
        )}
      </button>

      {/* Dropdown con lista */}
      {abierto && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-[20px] shadow-[0_20px_50px_rgba(3,14,19,0.18)] border border-slate-200 overflow-hidden z-50">
          <div className="bg-slate-900 px-4 py-3 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200">Firmas de carga</p>
            <h3 className="font-display text-base font-bold tracking-tight">{rutasPendientes.length} ruta{rutasPendientes.length === 1 ? '' : 's'} esperando</h3>
          </div>
          {rutasPendientes.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-3xl mb-2">✓</p>
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
                    className="w-full text-left px-4 py-3 hover:bg-amber-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">{s(r.folio) || `Ruta #${r.id}`}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{choferNombre || 'Sin chofer'} · {totalBolsas} bolsas</p>
                      </div>
                      <span className="text-amber-600 text-xs font-bold ml-2">Firmar →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal de firma */}
      {rutaSeleccionada && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => !firmando && setRutaSeleccionada(null)}>
          <div className="bg-white w-full max-w-md rounded-[24px] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Firma de Producción</p>
            <h3 className="font-display text-lg font-bold text-slate-900 mb-1">{s(rutaSeleccionada.folio)}</h3>
            <p className="text-xs text-slate-500 mb-3">
              Chofer: {s(rutaSeleccionada.choferNombre || rutaSeleccionada.chofer_nombre || rutaSeleccionada.chofer || '—')}
            </p>

            {/* Resumen de carga */}
            <div className="bg-slate-50 rounded-xl p-3 mb-3 max-h-32 overflow-y-auto">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Carga reportada</p>
              {(() => {
                const cargaReal = (rutaSeleccionada.carga_real && typeof rutaSeleccionada.carga_real === 'object') ? rutaSeleccionada.carga_real : {};
                const entries = Object.entries(cargaReal);
                if (entries.length === 0) return <p className="text-xs text-slate-400">Sin datos de carga</p>;
                return entries.map(([sku, qty]) => {
                  const prod = (data.productos || []).find(p => s(p.sku) === sku);
                  return (
                    <div key={sku} className="flex justify-between text-sm py-0.5">
                      <span className="text-slate-700">{prod ? s(prod.nombre) : sku}</span>
                      <span className="font-bold text-slate-800">{qty}</span>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Canvas de firma */}
            <p className="text-xs font-semibold text-slate-600 mb-2">Dibuja tu firma:</p>
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
              className="w-full h-40 border-2 border-slate-300 rounded-xl bg-white touch-none"
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

            <div className="flex gap-2 mt-3">
              <button onClick={limpiarFirma} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl">Limpiar</button>
              <button onClick={() => setRutaSeleccionada(null)} className="flex-1 py-2.5 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl" disabled={firmando}>Cancelar</button>
              <button
                onClick={confirmarFirma}
                disabled={!firmaTienePuntos || firmando}
                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-40"
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
