// PosTurnoView — Tiendas E5: "Mi turno" del cajero: su turno abierto, las ventas del turno y el cierre.
//
// El cierre es A CIEGAS: la pantalla nunca muestra cuánto efectivo se espera (ni lo pide al
// servidor) antes de cerrar; tampoco suma el efectivo vendido. La persona cuenta, escribe lo que
// contó y el servidor calcula. Solo si no coincide pide el motivo, sin decir cuánto falta o sobra.
// El resultado (esperado, contado, diferencia) se muestra DESPUÉS de cerrar.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, SectionLabel, Guia } from './ui/Components';
import { FormInput, FormTextarea, FormBtn } from './ui/Modal';
import { AvisoPos } from './PosTiendaView';
import { nuevaOperacionId, leerPendiente, ejecutarOperacionPos, leerMonto, pesos } from '../data/posLogic';

const almacen = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
const hora = (iso) => { try { return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

export default function PosTurnoView({ user, actions, onNavigate }) {
  const uid = user?.id;
  const [estado, setEstado] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [errorCarga, setErrorCarga] = useState(null);
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pideMotivo, setPideMotivo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [cierre, setCierre] = useState(null);          // resultado del cierre (ya cerrado)
  // Cierre sin confirmar (se perdió la conexión): se reintenta con los MISMOS datos y el mismo operacion_id.
  const pendiente = useRef(leerPendiente(almacen(), 'cierre', uid));
  const [hayPendiente, setHayPendiente] = useState(!!pendiente.current);

  const cargar = useCallback(async () => {
    const r = await actions.posEstado();
    if (r?.error) { setErrorCarga(r.error); return; }
    setErrorCarga(null);
    setEstado(r.data);
    const t = r.data?.turno;
    if (t?.turno_id) {
      const v = await actions.posVentasTurno(t.turno_id);
      if (!v?.error) setVentas(v.data || []);
    } else setVentas([]);
  }, [actions]);
  useEffect(() => { cargar(); }, [cargar]);

  const turno = estado?.turno || null;

  const enviarCierre = async (args) => {
    setOcupado(true);
    pendiente.current = { args };
    const r = await ejecutarOperacionPos({ tipo: 'cierre', storage: almacen(), usuarioId: uid, pendiente: { args }, llamar: actions.posCerrarTurno });
    setOcupado(false);
    if (r.estado === 'pendiente') {
      setHayPendiente(true);
      setAviso({ tono: 'error', texto: 'No hubo respuesta del servidor. El cierre quedó sin confirmar: tócalo otra vez para revisarlo (no se cerrará dos veces).' });
      return;
    }
    pendiente.current = null; setHayPendiente(false);
    if (r.estado === 'rechazada') {
      if (r.codigo === 'MOTIVO_DIFERENCIA') setPideMotivo(true);
      setAviso({ tono: 'error', texto: r.mensaje });
      if (r.codigo === 'TURNO_CERRADO' || r.codigo === 'NO_AUTORIZADO') cargar();
      return;
    }
    setAviso(null); setCierre(r.data); setContado(''); setMotivo(''); setPideMotivo(false);
    cargar();
  };

  const cerrar = () => {
    if (ocupado || !turno) return;
    if (pendiente.current) { enviarCierre(pendiente.current.args); return; }
    const m = leerMonto(contado, 'el efectivo que contaste');
    if (m.error) { setAviso({ tono: 'error', texto: m.error }); return; }
    if (pideMotivo && motivo.trim().length < 3) { setAviso({ tono: 'error', texto: 'Escribe el motivo de la diferencia.' }); return; }
    const args = { p_operacion_id: nuevaOperacionId(), p_turno_id: turno.turno_id, p_efectivo_contado: m.valor,
      p_motivo_diferencia: pideMotivo ? motivo.trim() : null, p_notas: null };
    enviarCierre(args);
  };

  if (errorCarga && !estado) {
    return <div className="mx-auto w-full max-w-lg" data-testid="pos-turno"><AvisoPos tono="error">{errorCarga} <button type="button" onClick={cargar} className="ml-2 font-semibold underline">Reintentar</button></AvisoPos></div>;
  }
  if (!estado) return <div className="mx-auto w-full max-w-lg" data-testid="pos-turno"><Card><p className="text-sm text-slate-500">Cargando tu turno…</p></Card></div>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3" data-testid="pos-turno">
      {cierre && (
        <Card tone={Number(cierre.diferencia) === 0 ? 'success' : 'warning'}>
          <SectionLabel>Turno cerrado</SectionLabel>
          <div className="mt-2 grid grid-cols-3 gap-2 text-sm" data-testid="pos-cierre-resultado">
            <div><p className="text-xs text-slate-500">Esperado</p><p className="font-semibold text-slate-900">{pesos(cierre.efectivo_esperado)}</p></div>
            <div><p className="text-xs text-slate-500">Contado</p><p className="font-semibold text-slate-900">{pesos(cierre.efectivo_contado)}</p></div>
            <div><p className="text-xs text-slate-500">Diferencia</p><p className="font-semibold text-slate-900">{pesos(cierre.diferencia)}</p></div>
          </div>
          {cierre.motivo_diferencia && <p className="mt-2 text-sm text-slate-700">Motivo: {cierre.motivo_diferencia}</p>}
        </Card>
      )}

      {!turno ? (
        <Guia titulo="No tienes un turno abierto" testid="pos-turno-sin-turno">
          Abre tu turno desde Punto de venta para empezar a vender.
          {onNavigate && <div className="mt-2"><FormBtn primary onClick={() => onNavigate('pos')}>Ir al punto de venta</FormBtn></div>}
        </Guia>
      ) : (
        <>
          <Card>
            <SectionLabel>Mi turno</SectionLabel>
            <p className="mt-1 font-display text-lg font-bold tracking-[-0.03em] text-slate-900">{turno.caja}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-[14px] bg-slate-50 p-3"><p className="text-xs text-slate-500">Abierto</p><p className="font-semibold text-slate-900">{hora(turno.abierto_at)}</p></div>
              <div className="rounded-[14px] bg-slate-50 p-3"><p className="text-xs text-slate-500">Fondo inicial</p><p className="font-semibold text-slate-900">{pesos(turno.fondo_inicial)}</p></div>
              <div className="rounded-[14px] bg-slate-50 p-3"><p className="text-xs text-slate-500">Ventas</p><p className="font-semibold text-slate-900" data-testid="pos-turno-ventas-n">{turno.ventas ?? ventas.length}</p></div>
            </div>
          </Card>

          <Card>
            <SectionLabel>Cerrar turno</SectionLabel>
            <p className="mt-1 text-sm text-slate-500">Cuenta el efectivo del cajón (incluye el fondo) y escribe lo que contaste. El sistema hace la cuenta al cerrar.</p>
            <div className="mt-3"><FormInput label="Efectivo contado" inputMode="decimal" placeholder="0.00" value={contado} onChange={e => setContado(e.target.value)}
              disabled={ocupado || hayPendiente} data-testid="pos-contado" /></div>
            {pideMotivo && (
              <div className="mt-3"><FormTextarea label="Motivo de la diferencia" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={ocupado || hayPendiente} data-testid="pos-motivo" /></div>
            )}
            {aviso && <div className="mt-3"><AvisoPos tono={aviso.tono} testid="pos-turno-aviso">{aviso.texto}</AvisoPos></div>}
            <FormBtn primary size="lg" className="mt-4 w-full" onClick={cerrar} disabled={ocupado}>
              {ocupado ? 'Cerrando…' : hayPendiente ? 'Revisar el cierre pendiente' : 'Cerrar turno'}
            </FormBtn>
          </Card>

          <Card padding="p-0">
            <div className="p-4 pb-2"><SectionLabel>Ventas de este turno</SectionLabel></div>
            <div className="divide-y divide-slate-100" data-testid="pos-turno-ventas">
              {ventas.map(v => (
                <div key={v.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{v.folio} <span className="font-normal text-slate-500">· {hora(v.created_at)}</span></p>
                    <p className="truncate text-slate-500">{v.cliente_nombre} · {v.productos}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">{pesos(v.total)}</p>
                    <p className="text-xs text-slate-500">{v.metodo_pago}{v.tiene_devolucion ? ' · corregida' : ''}</p>
                  </div>
                </div>
              ))}
              {ventas.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Aún no hay ventas en este turno.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
