// AvisosPush — toggle de Web Push dentro del panel de notificaciones
// (Tanda 30). Estados: sin soporte del navegador o backend sin VAPID →
// no se renderiza nada (seam); soportado → botón activar/desactivar
// con el estado real de la suscripción de ESTE dispositivo.
import { useEffect, useState } from 'react';
import { activarPush, desactivarPush, obtenerConfigPush, soportaPush, suscripcionActual } from '../../lib/push';

export default function AvisosPush() {
  const [config, setConfig] = useState(null);      // null = cargando
  const [suscrito, setSuscrito] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    let cancelado = false;
    if (!soportaPush()) { setConfig({ enabled: false }); return undefined; }
    (async () => {
      const cfg = await obtenerConfigPush();
      if (cancelado) return;
      setConfig(cfg);
      if (cfg.enabled) {
        try {
          setSuscrito(Boolean(await suscripcionActual()));
        } catch { /* SW aún no listo: el botón queda en "activar" */ }
      }
    })();
    return () => { cancelado = true; };
  }, []);

  if (!config?.enabled) return null;

  const alternar = async () => {
    if (ocupado) return;
    setOcupado(true);
    setMensaje('');
    try {
      if (suscrito) {
        await desactivarPush();
        setSuscrito(false);
        setMensaje('Avisos desactivados en este dispositivo');
      } else {
        await activarPush(config.publicKey);
        setSuscrito(true);
        setMensaje('Listo — recibirás avisos aunque la app esté cerrada');
      }
    } catch (e) {
      setMensaje(e?.message || 'No se pudo cambiar el estado de los avisos');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="border-b border-slate-200/80 px-4 py-2.5 bg-slate-50/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          {suscrito ? '🔔 Avisos activos en este dispositivo' : '🔕 Recibe avisos con la app cerrada'}
        </p>
        <button
          onClick={alternar}
          disabled={ocupado}
          className={`flex-shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg min-h-[32px] disabled:opacity-50 ${suscrito ? 'bg-slate-200 text-slate-600' : 'bg-blue-600 text-white'}`}
        >
          {ocupado ? '…' : suscrito ? 'Desactivar' : 'Activar'}
        </button>
      </div>
      {mensaje && <p className="mt-1 text-[11px] text-slate-500">{mensaje}</p>}
    </div>
  );
}
