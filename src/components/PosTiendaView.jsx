// PosTiendaView — Tiendas E5: punto de venta de una tienda propia (tablet y escritorio).
//
// Todo lo decide el servidor (migraciones 143–146): en qué tiendas trabaja la persona, qué
// cajas hay, el precio de cada producto, qué clientes puede usar la tienda, de qué congelador
// puede salir el producto y si la venta se registró. Esta pantalla:
//   · no calcula precios ni totales que cuenten (el total que se cobra es el que devuelve la venta);
//   · no ofrece precios manuales, descuentos ni crédito;
//   · no deja vender sin un turno abierto;
//   · guarda cada cobro en el aparato ANTES de mandarlo y, si se pierde la conexión, primero
//     pregunta al servidor por ESE cobro (mismo operacion_id) antes de permitir otro.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, SectionLabel, ChoiceButton, Guia } from './ui/Components';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import {
  METODOS_POS, pantallaPos, establecimientoActivo, agregarAlCarrito, cambiarCantidad, quitarDelCarrito, buscarProductos, totalEstimado,
  existenciasPorSku, construirVenta, nuevaOperacionId, leerPendiente, ejecutarOperacionPos, leerMonto, pesos,
} from '../data/posLogic';

export const TONOS_POS = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  aviso: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  neutro: 'border-slate-200 bg-slate-50 text-slate-800',
};
export const AvisoPos = ({ tono = 'neutro', children, testid }) => (
  <div className={`rounded-[16px] border p-3 text-sm ${TONOS_POS[tono] || TONOS_POS.neutro}`} role={tono === 'error' ? 'alert' : 'status'} data-testid={testid}>{children}</div>
);

const almacen = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
const horaCorta = (iso) => { try { return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

export default function PosTiendaView({ user, actions, onNavigate }) {
  const uid = user?.id;
  const [estado, setEstado] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [establecimientoId, setEstablecimientoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ precios: [], cuartos: [] });
  const [errorCatalogo, setErrorCatalogo] = useState(null);
  const [carrito, setCarrito] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cliente, setCliente] = useState(null);
  const [textoCliente, setTextoCliente] = useState('');
  const [clientes, setClientes] = useState(null);         // null = sin buscar
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [metodo, setMetodo] = useState('Efectivo');
  const [referencia, setReferencia] = useState('');
  const [factura, setFactura] = useState(false);
  const [aviso, setAviso] = useState(null);                // { tono, texto }
  const [ocupado, setOcupado] = useState(false);
  const [pendiente, setPendiente] = useState(() => leerPendiente(almacen(), 'cobro', uid));
  const [primerEnvio, setPrimerEnvio] = useState(false);   // el cobro va en camino por primera vez: todavía no es un "cobro sin confirmar"
  const [comprobante, setComprobante] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  // Apertura de turno
  const [cajaId, setCajaId] = useState(null);
  const [fondo, setFondo] = useState('');
  const aperturaPendiente = useRef(leerPendiente(almacen(), 'apertura', uid));

  const cargarEstado = useCallback(async () => {
    const r = await actions.posEstado();
    if (r?.error) { setErrorCarga(r.error); return null; }
    setErrorCarga(null);
    setEstado(r.data);
    return r.data;
  }, [actions]);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  const tienda = useMemo(() => establecimientoActivo(estado?.establecimientos, establecimientoId, estado?.turno), [estado, establecimientoId]);
  const pantalla = pantallaPos({ cargado: !!estado, tiendasHabilitadas: estado?.tiendasHabilitadas, establecimientos: estado?.establecimientos,
    establecimientoId: tienda?.id ?? establecimientoId, turno: estado?.turno });
  const turno = estado?.turno || null;

  const cargarCatalogo = useCallback(async (estId, clienteId) => {
    if (!estId) return;
    const r = await actions.posCatalogo(estId, clienteId ?? null);
    if (r?.error) { setErrorCatalogo(r.error); return; }
    setErrorCatalogo(null);
    setCatalogo(r.data);
  }, [actions]);
  // Los precios SIEMPRE vienen del servidor: se piden al abrir el POS y cada vez que cambia el cliente.
  useEffect(() => { if (pantalla === 'vender' && tienda?.id) cargarCatalogo(tienda.id, cliente?.id); }, [pantalla, tienda?.id, cliente?.id, cargarCatalogo]);

  const existencias = useMemo(() => existenciasPorSku(catalogo.cuartos, tienda?.id, !!tienda?.vende_desde_cedis), [catalogo.cuartos, tienda]);
  const productos = useMemo(() => buscarProductos(catalogo.precios, busqueda), [catalogo.precios, busqueda]);
  const estimado = useMemo(() => totalEstimado(carrito, catalogo.precios), [carrito, catalogo.precios]);
  const metodoSel = METODOS_POS.find(m => m.id === metodo) || METODOS_POS[0];
  const bloqueado = !!pendiente || ocupado;

  // ── Clientes: solo por el buscador del servidor (mínimo 3 letras, datos mínimos) ──
  const buscarCliente = async () => {
    const t = textoCliente.trim();
    if (t.length < 3) { setAviso({ tono: 'aviso', texto: 'Escribe al menos 3 letras del nombre del cliente.' }); return; }
    setBuscandoCliente(true);
    const r = await actions.posBuscarClientes(tienda.id, t);
    setBuscandoCliente(false);
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setAviso(null);
    setClientes({ lista: r.data?.clientes || [], hayMas: !!r.data?.hay_mas });
  };
  const elegirCliente = (c) => { setCliente(c); setClientes(null); setTextoCliente(''); if (!c?.puede_facturar) setFactura(false); };
  const quitarCliente = () => { setCliente(null); setFactura(false); };

  // ── Cobro ──
  const enviarCobro = useCallback(async (p, { revision = false } = {}) => {
    setOcupado(true);
    setPrimerEnvio(!revision);
    setPendiente(p);
    // Se guarda ANTES de mandarlo: si la app se cierra o se cae la red, el cobro no se pierde ni se repite.
    const r = await ejecutarOperacionPos({ tipo: 'cobro', storage: almacen(), usuarioId: uid, pendiente: p, llamar: actions.posVender });
    setOcupado(false);
    setPrimerEnvio(false);
    if (r.estado === 'pendiente') {
      // No se sabe si el servidor la registró: el cobro queda guardado y la pantalla bloqueada.
      setAviso({ tono: 'error', texto: 'No hubo respuesta del servidor. Este cobro quedó sin confirmar: revísalo antes de hacer otra venta.' });
      return;
    }
    setPendiente(null);
    if (r.estado === 'rechazada') {
      setAviso({ tono: 'error', texto: r.mensaje });
      if (r.codigo === 'TURNO_CERRADO' || r.codigo === 'TIENDA_NO_DISPONIBLE' || r.codigo === 'NO_AUTORIZADO') cargarEstado();
      else cargarCatalogo(tienda?.id, cliente?.id);
      return;
    }
    setAviso(null);
    setComprobante(r.data);
    setCarrito([]); setReferencia(''); setFactura(false); setCliente(null);
    cargarCatalogo(tienda?.id, null);
  }, [actions, uid, tienda?.id, cliente?.id, cargarEstado, cargarCatalogo]);

  const pedirCobro = () => {
    if (bloqueado) return;
    const built = construirVenta({ operacionId: nuevaOperacionId(), turnoId: turno?.turno_id, carrito, cuartos: catalogo.cuartos, establecimiento: tienda,
      metodo, cliente, referencia, requiereFactura: factura });
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    setAviso(null);
    setConfirmar(built);
  };
  const confirmarCobro = async () => {
    const built = confirmar;
    setConfirmar(false);
    if (!built?.args) return;
    const p = { args: built.args, creadoAt: new Date().toISOString(), resumen: { total: estimado.total, piezas: carrito.reduce((s, l) => s + l.cantidad, 0), metodo } };
    await enviarCobro(p);
  };

  // ── Apertura de turno ──
  const abrirTurno = async () => {
    if (ocupado) return;
    const m = leerMonto(fondo, 'el fondo inicial');
    if (m.error) { setAviso({ tono: 'error', texto: m.error }); return; }
    if (!cajaId) { setAviso({ tono: 'error', texto: 'Elige la caja en la que vas a trabajar.' }); return; }
    const previa = aperturaPendiente.current;
    const args = previa && previa.args.p_caja_id === cajaId && Number(previa.args.p_fondo_inicial) === m.valor
      ? previa.args
      : { p_operacion_id: nuevaOperacionId(), p_caja_id: cajaId, p_fondo_inicial: m.valor };
    aperturaPendiente.current = { args };
    setOcupado(true);
    const r = await ejecutarOperacionPos({ tipo: 'apertura', storage: almacen(), usuarioId: uid, pendiente: { args }, llamar: actions.posAbrirTurno });
    setOcupado(false);
    if (r.estado === 'pendiente') {
      setAviso({ tono: 'error', texto: 'No hubo respuesta del servidor. Toca "Abrir turno" otra vez: no se abrirá dos veces.' });
      return;
    }
    aperturaPendiente.current = null;
    if (r.estado === 'rechazada') { setAviso({ tono: 'error', texto: r.mensaje }); cargarEstado(); return; }
    setAviso(null); setFondo(''); setCajaId(null);
    cargarEstado();
  };

  // ── Pantallas ──
  if (errorCarga && !estado) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3" data-testid="pos-tienda">
        <AvisoPos tono="error">{errorCarga} <button type="button" onClick={cargarEstado} className="ml-2 font-semibold underline">Reintentar</button></AvisoPos>
      </div>
    );
  }
  if (pantalla === 'cargando') return <div className="mx-auto w-full max-w-lg" data-testid="pos-tienda"><Card><p className="text-sm text-slate-500">Cargando tu tienda…</p></Card></div>;
  if (pantalla === 'no_activadas') {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3" data-testid="pos-tienda">
        <Guia titulo="Las tiendas todavía no están activadas" testid="pos-no-activadas">Cuando Administración active las tiendas propias, aquí aparecerá tu punto de venta.</Guia>
      </div>
    );
  }
  if (pantalla === 'sin_tienda') {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3" data-testid="pos-tienda">
        <Guia titulo="No tienes una tienda asignada" testid="pos-sin-tienda">Pide a Administración que te asigne a tu tienda. Mientras tanto no puedes abrir caja ni vender.</Guia>
      </div>
    );
  }
  if (pantalla === 'elegir_tienda') {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3" data-testid="pos-tienda">
        <Card>
          <SectionLabel>¿En qué tienda trabajas hoy?</SectionLabel>
          <div className="mt-3 grid gap-2" data-testid="pos-elegir-tienda">
            {estado.establecimientos.map(e => (
              <ChoiceButton key={e.id} tone="emerald" onClick={() => setEstablecimientoId(e.id)} className="text-left">{e.nombre}</ChoiceButton>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (pantalla === 'abrir_turno') {
    const cajas = (estado.cajas || []).filter(c => String(c.establecimiento_id) === String(tienda?.id) && c.activa !== false);
    return (
      <div className="mx-auto w-full max-w-lg space-y-3" data-testid="pos-tienda">
        <Card>
          <SectionLabel>{tienda?.nombre || 'Tu tienda'}</SectionLabel>
          <p className="mt-1 font-display text-lg font-bold tracking-[-0.03em] text-slate-900">Abre tu turno de caja</p>
          <p className="text-sm text-slate-500">Sin un turno abierto no se puede vender.</p>
          {estado.establecimientos.length > 1 && (
            <button type="button" onClick={() => setEstablecimientoId(null)} className="mt-2 text-sm font-semibold text-slate-600 underline">Cambiar de tienda</button>
          )}
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">Caja</p>
            {cajas.length === 0
              ? <AvisoPos tono="aviso" testid="pos-sin-cajas">Esta tienda todavía no tiene cajas. Administración las da de alta en Tiendas → Cajas.</AvisoPos>
              : (
                <div className="grid grid-cols-2 gap-2" data-testid="pos-cajas">
                  {cajas.map(c => (
                    <ChoiceButton key={c.id} tone="emerald" active={cajaId === c.id} disabled={c.ocupada} onClick={() => setCajaId(c.id)}>
                      {c.nombre}{c.ocupada ? ' · en uso' : ''}
                    </ChoiceButton>
                  ))}
                </div>
              )}
          </div>
          <div className="mt-4">
            <FormInput label="Fondo inicial (efectivo con el que empiezas)" inputMode="decimal" placeholder="0.00" value={fondo}
              onChange={e => setFondo(e.target.value)} data-testid="pos-fondo" />
          </div>
          {aviso && <div className="mt-3"><AvisoPos tono={aviso.tono} testid="pos-aviso">{aviso.texto}</AvisoPos></div>}
          <FormBtn primary size="lg" className="mt-4 w-full" onClick={abrirTurno} disabled={ocupado || cajas.length === 0}>
            {ocupado ? 'Abriendo…' : 'Abrir turno'}
          </FormBtn>
        </Card>
      </div>
    );
  }

  // pantalla === 'vender'
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3" data-testid="pos-tienda">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900">{tienda?.nombre || 'Tienda'}</p>
          <p className="text-sm text-slate-500" data-testid="pos-turno-activo">{turno?.caja} · turno abierto {horaCorta(turno?.abierto_at)}</p>
        </div>
        {onNavigate && <FormBtn onClick={() => onNavigate('pos-turno')}>Mi turno y cierre</FormBtn>}
      </div>

      {pendiente && !primerEnvio && (
        <AvisoPos tono="aviso" testid="pos-cobro-pendiente">
          <p className="font-semibold">Hay un cobro sin confirmar ({pesos(pendiente.resumen?.total)}, {pendiente.resumen?.metodo}).</p>
          <p className="mt-1">Se perdió la conexión antes de saber si se registró. Tócalo para preguntarle al servidor: si ya estaba registrado te mostramos su comprobante, y si no, se registra ahora una sola vez. No se puede hacer otra venta hasta resolverlo.</p>
          <FormBtn warning className="mt-2" onClick={() => enviarCobro(pendiente, { revision: true })} disabled={ocupado}>{ocupado ? 'Revisando…' : 'Revisar ese cobro'}</FormBtn>
        </AvisoPos>
      )}
      {aviso && <AvisoPos tono={aviso.tono} testid="pos-aviso">{aviso.texto}</AvisoPos>}
      {errorCatalogo && <AvisoPos tono="error">{errorCatalogo} <button type="button" onClick={() => cargarCatalogo(tienda?.id, cliente?.id)} className="ml-2 font-semibold underline">Reintentar</button></AvisoPos>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Productos */}
        <Card>
          <FormInput label="Buscar producto" placeholder="Nombre o clave" value={busqueda} onChange={e => setBusqueda(e.target.value)} data-testid="pos-buscar-producto" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="pos-productos">
            {productos.map(p => {
              const ex = existencias[p.sku]?.total || 0;
              const enCarrito = carrito.find(l => l.sku === p.sku)?.cantidad || 0;
              const agotado = ex - enCarrito <= 0;
              return (
                <button key={p.sku} type="button" disabled={bloqueado || agotado} data-testid={`pos-producto-${p.sku}`}
                  onClick={() => setCarrito(c => agregarAlCarrito(c, p, 1))}
                  className={`min-h-[92px] rounded-[16px] border p-3 text-left transition-colors ${bloqueado || agotado ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50'}`}>
                  <p className="text-sm font-semibold leading-tight text-slate-900">{p.nombre}</p>
                  <p className="mt-1 font-display text-base font-bold text-slate-900">{pesos(p.precio)}</p>
                  <p className={`text-xs ${ex > 0 ? 'text-slate-500' : 'text-red-600'}`}>{ex > 0 ? `Hay ${ex}` : 'Sin existencia'}</p>
                </button>
              );
            })}
            {productos.length === 0 && <p className="col-span-full text-sm text-slate-500">No hay productos con ese nombre.</p>}
          </div>
        </Card>

        {/* Venta */}
        <div className="space-y-3">
          <Card>
            <SectionLabel>Cliente</SectionLabel>
            {cliente ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-[14px] bg-slate-50 p-3" data-testid="pos-cliente">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{cliente.nombre}</p>
                  {cliente.nombre_comercial && <p className="text-xs text-slate-500">{cliente.nombre_comercial}</p>}
                </div>
                <button type="button" onClick={quitarCliente} disabled={bloqueado} className="text-sm font-semibold text-slate-600 underline">Quitar</button>
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-500">Público en general. Para un cliente con precio propio o factura, búscalo.</p>
                <div className="mt-2 flex gap-2">
                  <div className="flex-1"><FormInput placeholder="Nombre del cliente (3 letras o más)" value={textoCliente} onChange={e => setTextoCliente(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') buscarCliente(); }} data-testid="pos-buscar-cliente" disabled={bloqueado} /></div>
                  <FormBtn onClick={buscarCliente} disabled={bloqueado || buscandoCliente}>{buscandoCliente ? 'Buscando…' : 'Buscar'}</FormBtn>
                </div>
                {clientes && (
                  <div className="mt-2 space-y-1" data-testid="pos-clientes">
                    {clientes.lista.map(c => (
                      <button key={c.id} type="button" onClick={() => elegirCliente(c)} className="block w-full rounded-[12px] border border-slate-200 bg-white p-2 text-left text-sm hover:bg-slate-50">
                        <span className="font-semibold text-slate-900">{c.nombre}</span>
                        {c.nombre_comercial && <span className="text-slate-500"> · {c.nombre_comercial}</span>}
                      </button>
                    ))}
                    {clientes.lista.length === 0 && <p className="text-sm text-slate-500">Ningún cliente de esta tienda coincide.</p>}
                    {clientes.hayMas && <p className="text-xs text-slate-500">Hay más resultados: escribe más letras.</p>}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card>
            <SectionLabel>Venta</SectionLabel>
            <div className="mt-2 space-y-2" data-testid="pos-carrito">
              {estimado.lineas.map(l => (
                <div key={l.sku} className="flex items-center gap-2 rounded-[14px] bg-slate-50 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{l.nombre}</p>
                    <p className="text-xs text-slate-500">{pesos(l.precio)} c/u</p>
                  </div>
                  <button type="button" disabled={bloqueado} onClick={() => setCarrito(c => cambiarCantidad(c, l.sku, l.cantidad - 1))} aria-label="Menos"
                    className="h-11 w-11 rounded-[12px] border border-slate-200 bg-white text-lg font-bold text-slate-700">-</button>
                  <span className="w-8 text-center text-sm font-bold text-slate-900" data-testid={`pos-cantidad-${l.sku}`}>{l.cantidad}</span>
                  <button type="button" disabled={bloqueado || (existencias[l.sku]?.total || 0) <= l.cantidad} onClick={() => setCarrito(c => cambiarCantidad(c, l.sku, l.cantidad + 1))} aria-label="Más"
                    className="h-11 w-11 rounded-[12px] border border-slate-200 bg-white text-lg font-bold text-slate-700 disabled:opacity-40">+</button>
                  <span className="w-20 text-right text-sm font-semibold text-slate-900">{pesos(l.subtotal)}</span>
                  <button type="button" disabled={bloqueado} onClick={() => setCarrito(c => quitarDelCarrito(c, l.sku))} aria-label="Quitar" className="px-1 text-xs font-semibold text-slate-500 underline hover:text-red-600">Quitar</button>
                </div>
              ))}
              {carrito.length === 0 && <p className="text-sm text-slate-500">Toca un producto para agregarlo.</p>}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">Forma de pago</p>
              <div className="grid grid-cols-3 gap-2" data-testid="pos-metodos">
                {METODOS_POS.map(m => <ChoiceButton key={m.id} tone="emerald" active={metodo === m.id} disabled={bloqueado} onClick={() => setMetodo(m.id)}>{m.label}</ChoiceButton>)}
              </div>
              {metodoSel.referencia && (
                <div className="mt-2"><FormInput label="Referencia (opcional)" placeholder="Autorización o folio" value={referencia} onChange={e => setReferencia(e.target.value)} disabled={bloqueado} maxLength={60} /></div>
              )}
              {cliente && (
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={factura} disabled={bloqueado || !cliente.puede_facturar} onChange={e => setFactura(e.target.checked)} />
                  {cliente.puede_facturar ? 'El cliente pide factura' : 'A este cliente le faltan datos fiscales para facturar'}
                </label>
              )}
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-slate-200 pt-3">
              <span className="text-sm text-slate-500">Total</span>
              <span className="font-display text-2xl font-bold tracking-[-0.03em] text-slate-900" data-testid="pos-total">{pesos(estimado.total)}</span>
            </div>
            <FormBtn success size="lg" className="mt-3 w-full" onClick={pedirCobro} disabled={bloqueado || carrito.length === 0}>
              {ocupado ? 'Registrando…' : 'Cobrar'}
            </FormBtn>
            <p className="mt-2 text-xs text-slate-400">El precio y el total los confirma el sistema al registrar la venta. No hay descuentos ni ventas a crédito en tienda.</p>
          </Card>
        </div>
      </div>

      <Modal open={!!confirmar} onClose={() => setConfirmar(false)} title="Confirmar cobro" kicker="Punto de venta"
        footer={<><FormBtn onClick={() => setConfirmar(false)}>Volver</FormBtn><FormBtn success onClick={confirmarCobro}>Sí, cobrar {pesos(estimado.total)}</FormBtn></>}>
        <p className="text-sm text-slate-700">Vas a registrar una venta por <strong>{pesos(estimado.total)}</strong> con pago en <strong>{metodoSel.label.toLowerCase()}</strong>{cliente ? <> a <strong>{cliente.nombre}</strong></> : null}.</p>
        <p className="mt-2 text-sm text-slate-500">Cobra primero y confirma: la venta descuenta el producto del congelador y queda en tu turno.</p>
      </Modal>

      <Comprobante venta={comprobante} tienda={tienda} onCerrar={() => setComprobante(null)} />
    </div>
  );
}

/** Comprobante de la venta: SOLO con lo que devolvió el servidor (folio, líneas, precios y total reales). */
export function Comprobante({ venta, tienda, onCerrar }) {
  if (!venta) return null;
  return (
    <Modal open onClose={onCerrar} title={`Venta ${venta.folio || ''}`} kicker={venta.replay ? 'Ya estaba registrada' : 'Venta registrada'}
      footer={<><FormBtn onClick={() => { try { window.print(); } catch { /* sin impresora */ } }}>Imprimir</FormBtn><FormBtn primary onClick={onCerrar}>Nueva venta</FormBtn></>}>
      <div className="space-y-3 text-sm" data-testid="pos-comprobante">
        <div>
          <p className="font-semibold text-slate-900">{tienda?.nombre || 'Cubo Polar'}</p>
          <p className="text-slate-500">{venta.cliente_nombre || 'Público en general'}{venta.requiere_factura ? ' · con factura' : ''}</p>
        </div>
        <div className="divide-y divide-slate-100 rounded-[14px] border border-slate-200">
          {(venta.lineas || []).map(l => (
            <div key={l.sku} className="flex items-center justify-between gap-2 p-2">
              <span className="text-slate-700">{l.cantidad} × {l.sku} <span className="text-slate-400">({pesos(l.precio_unit)})</span></span>
              <span className="font-semibold text-slate-900">{pesos(l.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-end justify-between">
          <span className="text-slate-500">{venta.metodo}{venta.referencia ? ` · ${venta.referencia}` : ''}</span>
          <span className="font-display text-2xl font-bold text-slate-900" data-testid="pos-comprobante-total">{pesos(venta.total)}</span>
        </div>
      </div>
    </Modal>
  );
}
