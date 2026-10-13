// PosRecepcionView — Tiendas E7: "Recibir producto" del personal de una tienda.
// Lista los traspasos que vienen en camino a SU tienda y registra su llegada: cuánto llegó bien y
// cuánto dañado, por producto. Es un módulo aparte del punto de venta: aquí no se cobra nada.
// Quién puede recibir lo decide el servidor (permiso explícito por persona y tienda).
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, SectionLabel, Guia, ChoiceButton } from './ui/Components';
import { FormBtn } from './ui/Modal';
import { AvisoPos } from './PosTiendaView';
import { FilaTraspaso, RecepcionTraspaso } from './views/TraspasosPanel';
import { nuevaOperacionId, accionesTraspaso, construirRecepcion, establecimientoActivo } from '../data/posLogic';

export default function PosRecepcionView({ actions }) {
  const [estado, setEstado] = useState(null);
  const [establecimientoId, setEstablecimientoId] = useState(null);
  const [c, setC] = useState(null);
  const [sel, setSel] = useState(null);
  const [capturas, setCapturas] = useState({});
  const [notas, setNotas] = useState('');
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  // Mismo operacion_id mientras no haya una respuesta definitiva: un reintento no recibe dos veces.
  const op = useRef(null);

  const cargarEstado = useCallback(async () => {
    const r = await actions.posEstado();
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setEstado(r.data);
  }, [actions]);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  const tienda = establecimientoActivo(estado?.establecimientos, establecimientoId, estado?.turno);
  const cargar = useCallback(async () => {
    if (!tienda?.id) return;
    const r = await actions.posTraspasos(tienda.id);
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setC(r.data);
  }, [actions, tienda?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const elegir = (t) => { op.current = nuevaOperacionId(); setSel(t); setCapturas({}); setNotas(''); setAviso(null); };
  const recibir = async () => {
    if (ocupado || !sel) return;
    const built = construirRecepcion(sel, capturas, notas);
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    setOcupado(true);
    const r = await actions.posRecibirTraspaso({ p_operacion_id: op.current, p_traspaso_id: sel.traspaso_id, p_items: built.items, p_notas: built.notas });
    setOcupado(false);
    if (r?.error) {
      setAviso({ tono: 'error', texto: r.incierto ? 'No hubo respuesta del servidor. Toca "Registrar recepción" otra vez: no se recibirá dos veces.' : r.error });
      if (!r.incierto) { op.current = nuevaOperacionId(); cargar(); }
      return;
    }
    setSel(null);
    setAviso({ tono: built.incidencia ? 'aviso' : 'ok', texto: built.incidencia ? 'Recepción registrada con incidencia. Administración la revisará.' : 'Recepción registrada. El producto ya está en tu congelador.' });
    cargar();
  };

  if (!estado) return <div className="mx-auto w-full max-w-2xl" data-testid="pos-recepcion"><Card><p className="text-sm text-slate-500">Cargando…</p></Card></div>;
  if (!estado.tiendasHabilitadas || (estado.establecimientos || []).length === 0) {
    return <div className="mx-auto w-full max-w-2xl" data-testid="pos-recepcion"><Guia titulo="No tienes una tienda asignada">Cuando Administración te asigne a tu tienda, aquí verás el producto que viene en camino.</Guia></div>;
  }
  if (!tienda) {
    return (
      <div className="mx-auto w-full max-w-lg" data-testid="pos-recepcion">
        <Card><SectionLabel>¿De qué tienda?</SectionLabel>
          <div className="mt-3 grid gap-2">{estado.establecimientos.map(e => <ChoiceButton key={e.id} tone="emerald" onClick={() => setEstablecimientoId(e.id)} className="text-left">{e.nombre}</ChoiceButton>)}</div>
        </Card>
      </div>
    );
  }

  const puede = !!c?.puede_recibir;
  const enCamino = (c?.traspasos || []).filter(t => t.estado === 'en_transito' && String(t.destino?.id) === String(tienda.id));
  const historial = (c?.traspasos || []).filter(t => !enCamino.includes(t)).slice(0, 20);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3" data-testid="pos-recepcion">
      <div>
        <p className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900">Recibir producto</p>
        <p className="text-sm text-slate-500">{tienda.nombre}</p>
      </div>
      {aviso && <AvisoPos tono={aviso.tono} testid="pos-recepcion-aviso">{aviso.texto}</AvisoPos>}
      {c && !puede && <AvisoPos tono="aviso" testid="pos-recepcion-sin-permiso">Puedes ver lo que viene en camino, pero no tienes permiso para registrar la recepción. Pídelo a Administración.</AvisoPos>}

      {sel ? (
        <Card>
          <SectionLabel>Recibir {sel.folio}</SectionLabel>
          <p className="mt-1 text-sm text-slate-500">Cuenta lo que llegó. Solo lo que llegó bien entra a tu congelador ({sel.destino?.cuarto_id}).</p>
          <div className="mt-3"><RecepcionTraspaso traspaso={sel} capturas={capturas} onCapturas={setCapturas} notas={notas} onNotas={setNotas} /></div>
          <div className="mt-3 flex gap-2"><FormBtn onClick={() => setSel(null)} disabled={ocupado}>Volver</FormBtn><FormBtn success onClick={recibir} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar recepción'}</FormBtn></div>
        </Card>
      ) : (
        <>
          <Card padding="p-0">
            <div className="p-4 pb-2"><SectionLabel>En camino a tu tienda</SectionLabel></div>
            <div className="divide-y divide-slate-100" data-testid="pos-recepcion-en-camino">
              {enCamino.map(t => <FilaTraspaso key={t.traspaso_id} t={t} acciones={accionesTraspaso(t, { puedeRecibir: puede })} onAccion={(_, x) => elegir(x)} />)}
              {c && enCamino.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">No hay producto en camino.</p>}
            </div>
          </Card>
          {historial.length > 0 && (
            <Card padding="p-0">
              <div className="p-4 pb-2"><SectionLabel>Historial de abastecimiento</SectionLabel></div>
              <div className="divide-y divide-slate-100" data-testid="pos-recepcion-historial">
                {historial.map(t => <FilaTraspaso key={t.traspaso_id} t={t} acciones={{}} onAccion={() => {}} />)}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
