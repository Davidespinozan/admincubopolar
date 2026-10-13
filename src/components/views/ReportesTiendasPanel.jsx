// ReportesTiendasPanel — Tiendas E8: reportes por establecimiento y consolidados (solo Admin).
//
// Todo lo que se ve aquí lo calcula el servidor (migración 149, cuatro funciones de solo lectura):
// esta pantalla no suma ventas ni decide qué cuenta. Lo único que comprueba por su cuenta es que el
// consolidado sea la suma de los establecimientos y que las unidades de traspaso cuadren, para
// avisar si alguna vez no fuera así.
//   · Vendido (entregado en el periodo) y cobrado (pagos con fecha en el periodo) van aparte.
//   · Un traspaso no es una venta. Dañados y faltantes son piezas, no pesos ni merma contable.
//   · Reembolso registrado ≠ entregado ≠ pendiente.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, SectionLabel, Chips, KpiTile } from '../ui/Components';
import { FormInput, FormSelect, FormBtn } from '../ui/Modal';
import { AvisoPos } from '../PosTiendaView';
import { diaNegocio } from '../../utils/fechas';
import { rangoReportePorOmision, validarRangoReporte, opcionesEstablecimiento, TIPO_ESTABLECIMIENTO, consolidadoCuadra, unidadesCuadran, textoDiferencia, textoConciliacionReembolso, MEDIO_REEMBOLSO, pesos } from '../../data/posLogic';

const SECCIONES = [{ k: 'ventas', l: 'Ventas' }, { k: 'cajas', l: 'Cajas' }, { k: 'inventario', l: 'Inventario' }, { k: 'abasto', l: 'Abastecimiento e incidencias' }];
const TONO = { ok: 'text-emerald-700', aviso: 'text-amber-700', error: 'font-semibold text-red-700', neutro: 'text-slate-500' };
const n = (v) => Number(v || 0).toLocaleString('es-MX');
const objeto = (o) => Object.entries(o || {}).filter(([, v]) => Number(v) !== 0);
const Tabla = ({ cabeceras, filas, testid }) => (
  <div className="overflow-x-auto" data-testid={testid}>
    <table className="w-full min-w-[520px] text-sm">
      <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">{cabeceras.map((c, i) => <th key={i} className={`px-3 py-2 font-semibold ${i > 0 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
      <tbody>
        {filas.map((f, i) => <tr key={i} className="border-b border-slate-100">{f.map((c, k) => <td key={k} className={`px-3 py-2 ${k > 0 ? 'text-right tabular-nums' : 'text-slate-900'}`}>{c}</td>)}</tr>)}
        {filas.length === 0 && <tr><td colSpan={cabeceras.length} className="px-3 py-4 text-slate-500">Sin datos en este periodo.</td></tr>}
      </tbody>
    </table>
  </div>
);

/** `inicial` y `seccionInicial` permiten dibujar un reporte ya cargado (pruebas de render). */
export function ReportesTiendasPanel({ actions, establecimientos, inicial = null, seccionInicial = 'ventas' }) {
  const [rango, setRango] = useState(() => rangoReportePorOmision(diaNegocio()));
  const [estId, setEstId] = useState('');
  const [seccion, setSeccion] = useState(seccionInicial);
  const [r, setR] = useState(inicial);
  const [lista, setLista] = useState(establecimientos || []);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const consultar = useCallback(async (rg, est) => {
    const v = validarRangoReporte(rg.desde, rg.hasta);
    if (v.error) { setAviso({ tono: 'error', texto: v.error }); return; }
    setOcupado(true);
    const res = await actions.reportesTiendas({ desde: v.desde, hasta: v.hasta, establecimientoId: est ? Number(est) : null });
    setOcupado(false);
    if (res?.error) { setAviso({ tono: 'error', texto: res.error }); return; }
    setAviso(null);
    setR(res.data);
    // El consolidado trae TODOS los establecimientos (también el CEDIS): de ahí sale el selector.
    if (!est && Array.isArray(res.data?.ventas?.por_establecimiento)) setLista(res.data.ventas.por_establecimiento);
  }, [actions]);
  useEffect(() => { consultar(rangoReportePorOmision(diaNegocio()), ''); }, [consultar]);

  const opciones = useMemo(() => opcionesEstablecimiento(lista), [lista]);
  const nombreEst = useCallback((id) => lista.find(e => String(e.id) === String(id))?.nombre || `Establecimiento ${id}`, [lista]);
  const v = r?.ventas; const c = r?.cajas; const inv = r?.inventario; const ab = r?.abastecimiento; const re = r?.reembolsos;
  const cuadra = v ? consolidadoCuadra(v) : true;

  return (
    <div className="space-y-3" data-testid="reportes-tiendas">
      <Card>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
          <FormSelect label="Establecimiento" value={estId} onChange={e => setEstId(e.target.value)} options={opciones} />
          <FormInput label="Desde" type="date" value={rango.desde} onChange={e => setRango(x => ({ ...x, desde: e.target.value }))} />
          <FormInput label="Hasta" type="date" value={rango.hasta} onChange={e => setRango(x => ({ ...x, hasta: e.target.value }))} />
          <div className="self-end"><FormBtn primary onClick={() => consultar(rango, estId)} disabled={ocupado}>{ocupado ? 'Consultando…' : 'Consultar'}</FormBtn></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Las fechas son días de negocio (hora de Durango). Una venta cuenta el día en que se entregó.</p>
      </Card>
      {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
      {!cuadra && <AvisoPos tono="error" testid="reportes-descuadre">El consolidado no coincide con la suma de los establecimientos. No uses estos totales y avisa a sistemas.</AvisoPos>}
      <Chips items={SECCIONES} value={seccion} onChange={setSeccion} />
      {!r && <Card><p className="text-sm text-slate-500">Cargando reportes…</p></Card>}

      {r && seccion === 'ventas' && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="reportes-ventas-resumen">
            <KpiTile label="Ventas" value={n(v.consolidado?.ventas)} hint={`${n(v.consolidado?.unidades)} unidades`} />
            <KpiTile label="Vendido (bruto)" value={pesos(v.consolidado?.bruto)} />
            <KpiTile label="Devoluciones" value={pesos(v.consolidado?.devoluciones)} />
            <KpiTile label="Venta neta" value={pesos(v.consolidado?.neto)} hint={`Cobrado en el periodo: ${pesos(v.consolidado?.cobrado)}`} />
          </div>
          <Card padding="p-0">
            <div className="p-4 pb-1"><SectionLabel>Por establecimiento</SectionLabel></div>
            <Tabla testid="reportes-por-establecimiento" cabeceras={['Establecimiento', 'Ventas', 'Unidades', 'Bruto', 'Devoluciones', 'Neto', 'Cobrado']}
              filas={(v.por_establecimiento || []).map(f => [<span key="e">{f.nombre} <span className="text-xs text-slate-500">· {TIPO_ESTABLECIMIENTO[f.tipo] || f.tipo}</span></span>,
                n(f.ventas), n(f.unidades), pesos(f.bruto), pesos(f.devoluciones), pesos(f.neto), pesos(f.cobrado)])} />
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <SectionLabel>Cobrado por forma de pago</SectionLabel>
              <div className="mt-2 space-y-1" data-testid="reportes-metodos">
                {objeto(v.cobrado_por_metodo).map(([m, monto]) => <p key={m} className="flex justify-between text-sm text-slate-700"><span>{m}</span><span className="tabular-nums">{pesos(monto)}</span></p>)}
                {objeto(v.cobrado_por_metodo).length === 0 && <p className="text-sm text-slate-500">Sin cobros en el periodo.</p>}
              </div>
              <p className="mt-2 text-xs text-slate-500">Cobrado son los pagos con fecha en el periodo; puede diferir de lo vendido.</p>
            </Card>
            <Card>
              <SectionLabel>Por tipo de establecimiento</SectionLabel>
              <div className="mt-2 space-y-1">
                {Object.entries(v.por_tipo || {}).map(([t, x]) => <p key={t} className="flex justify-between text-sm text-slate-700"><span>{TIPO_ESTABLECIMIENTO[t] || t}</span><span className="tabular-nums">{n(x.ventas)} ventas · {pesos(x.neto)} neto</span></p>)}
              </div>
            </Card>
          </div>
          <Card padding="p-0">
            <div className="p-4 pb-1"><SectionLabel>Por producto</SectionLabel></div>
            <Tabla testid="reportes-por-producto" cabeceras={['Producto', 'Unidades', 'Importe']} filas={(v.por_producto || []).map(p => [p.nombre || p.sku, n(p.unidades), pesos(p.importe)])} />
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Ventas de tienda por caja</SectionLabel></div>
              <Tabla cabeceras={['Caja', 'Ventas', 'Bruto']} filas={(v.por_caja || []).map(x => [`${nombreEst(x.establecimiento_id)} · ${x.caja}`, n(x.ventas), pesos(x.bruto)])} /></Card>
            <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Ventas de tienda por cajero</SectionLabel></div>
              <Tabla cabeceras={['Cajero', 'Ventas', 'Bruto']} filas={(v.por_cajero || []).map(x => [`${x.cajero} · ${nombreEst(x.establecimiento_id)}`, n(x.ventas), pesos(x.bruto)])} /></Card>
          </div>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Por día</SectionLabel></div>
            <Tabla cabeceras={['Día', 'Establecimiento', 'Ventas', 'Bruto']} filas={(v.por_dia || []).map(x => [x.fecha, nombreEst(x.establecimiento_id), n(x.ventas), pesos(x.bruto)])} /></Card>
          <p className="px-1 text-xs text-slate-500">Los traspasos entre el CEDIS y las tiendas no son ventas y no aparecen aquí.</p>
        </>
      )}

      {r && seccion === 'cajas' && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="reportes-cajas-resumen">
            <KpiTile label="Turnos" value={n(c.resumen?.turnos)} hint={`${n(c.resumen?.abiertos)} abiertos · ${n(c.resumen?.cerrados)} cerrados`} />
            <KpiTile label="Faltantes" value={pesos(-(c.resumen?.faltantes || 0))} hint={`Sobrantes ${pesos(c.resumen?.sobrantes)} · ${n(c.resumen?.turnos_con_diferencia)} turnos con diferencia`} />
            <KpiTile label="Reembolsos entregados" value={pesos(c.resumen?.reembolsos_entregados)} hint={`Registrados ${pesos(c.resumen?.reembolsos_registrados)}`} />
            <KpiTile label="Reembolsos pendientes" value={pesos(c.resumen?.reembolsos_pendientes)} hint="Se deben y aún no se entregan" />
          </div>
          <Card padding="p-0">
            <div className="p-4 pb-1"><SectionLabel>Turnos</SectionLabel></div>
            <Tabla testid="reportes-turnos" cabeceras={['Turno', 'Fondo', 'Ventas', 'Efectivo cobrado', 'Esperado', 'Contado', 'Diferencia', 'Reemb. pendientes']}
              filas={(c.turnos || []).map(t => { const d = textoDiferencia(t); return [
                <span key="t">{t.tienda} · {t.caja}<span className="block text-xs text-slate-500">{t.cajero} · {t.fecha} · {t.estado}</span></span>,
                pesos(t.fondo_inicial), n(t.ventas), pesos(t.cobrado_efectivo),
                <span key="e">{pesos(t.efectivo_esperado)}{t.estado === 'abierto' ? <span className="block text-xs text-slate-500">al momento</span> : null}</span>,
                t.estado === 'cerrado' ? pesos(t.efectivo_contado) : '—',
                <span key="d" className={TONO[d.tono]}>{d.texto}{t.motivo_diferencia ? <span className="block text-xs font-normal text-slate-500">{t.motivo_diferencia}</span> : null}</span>,
                pesos(t.reembolsos_pendientes)]; })} />
          </Card>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Por caja</SectionLabel></div>
            <Tabla cabeceras={['Caja', 'Turnos', 'Ventas', 'Vendido', 'Diferencia acumulada']} filas={(c.por_caja || []).map(x => [`${x.tienda} · ${x.caja}`, n(x.turnos), n(x.ventas), pesos(x.vendido), pesos(x.diferencia)])} /></Card>
          {re && (
            <>
              {(re.inconsistencias || []).length > 0 && <AvisoPos tono="error" testid="reportes-reembolsos-inconsistencias">Hay {re.inconsistencias.length} devolución(es) cuyo egreso contable no coincide con su reembolso ({re.inconsistencias.map(i => i.folio).join(', ')}). Avisa a sistemas antes de conciliar.</AvisoPos>}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="reportes-reembolsos-resumen">
                <KpiTile label="Egreso contable del periodo" value={pesos(re.resumen?.egreso_contable_en_periodo)} hint="Devoluciones registradas en estas fechas" />
                <KpiTile label="Dinero entregado en el periodo" value={pesos(re.resumen?.dinero_entregado_en_periodo)} hint={`Caja ${pesos(re.resumen?.entregado_desde_caja)} · Administración ${pesos(re.resumen?.entregado_por_administracion)} · Electrónico ${pesos(re.resumen?.entregado_electronico)}`} />
                <KpiTile label="Pendiente al corte" value={pesos(re.resumen?.pendiente_al_corte)} hint={`${n(re.resumen?.pendientes_al_corte)} reembolso(s) sin entregar`} />
                <KpiTile label="Electrónico pendiente" value={pesos(re.resumen?.pendiente_electronico_al_corte)} hint="Falta hacerlo en la terminal o el banco" />
              </div>
              <Card padding="p-0">
                <div className="p-4 pb-1"><SectionLabel>Devoluciones y reembolsos</SectionLabel></div>
                <Tabla testid="reportes-reembolsos" cabeceras={['Venta', 'Devuelto', 'Egreso contable', 'Reembolso', 'Cómo', 'Dinero']}
                  filas={(re.reembolsos || []).map(x => { const t = textoConciliacionReembolso(x); return [
                    <span key="v">{x.folio} · {x.tienda}<span className="block text-xs text-slate-500">Venta {x.dia_venta} · devolución {x.dia_devolucion}</span></span>,
                    pesos(x.total_devuelto), x.egreso_contable ? <span key="e">{pesos(x.egreso_contable.monto)}<span className="block text-xs text-slate-500">{x.egreso_contable.fecha}</span></span> : '—',
                    pesos(x.monto), MEDIO_REEMBOLSO[x.medio] || '—', <span key="d" className={TONO[t.tono]}>{t.texto}</span>]; })} />
              </Card>
              <p className="px-1 text-xs text-slate-500">El egreso contable se registra el día de la devolución; el dinero puede entregarse después. Son dos fechas distintas y aquí se ven por separado.</p>
            </>
          )}
          <p className="px-1 text-xs text-slate-500">Reembolso registrado = se le debe al cliente; entregado = el dinero ya salió; pendiente = registrado y todavía no entregado. El efectivo esperado de un turno abierto solo se muestra aquí, a Administración.</p>
        </>
      )}

      {r && seccion === 'inventario' && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <KpiTile label="Piezas en cuartos" value={n((inv.total_piezas || 0) - (inv.establecimiento_id ? 0 : (inv.en_transito?.piezas || 0)))} />
            <KpiTile label="En tránsito" value={n(inv.en_transito?.piezas)} hint="Ya salió y aún no llega" />
            {!inv.establecimiento_id && <KpiTile label="Total de la empresa" value={n(inv.total_piezas)} hint="Cuartos + en tránsito" />}
          </div>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Existencia por establecimiento</SectionLabel></div>
            <Tabla testid="reportes-inventario" cabeceras={['Establecimiento', 'Piezas', 'Detalle', 'En camino hacia aquí']}
              filas={(inv.por_establecimiento || []).map(e => [<span key="e">{e.nombre} <span className="text-xs text-slate-500">· {TIPO_ESTABLECIMIENTO[e.tipo] || e.tipo}</span></span>, n(e.piezas),
                objeto(e.existencia).map(([sku, q]) => `${q} ${sku}`).join(' · ') || '—', objeto(e.en_camino_hacia).map(([sku, q]) => `${q} ${sku}`).join(' · ') || '—'])} /></Card>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Existencia por cuarto</SectionLabel></div>
            <Tabla cabeceras={['Cuarto', 'Piezas', 'Detalle']} filas={(inv.por_cuarto || []).map(q => [`${nombreEst(q.establecimiento_id)} · ${q.cuarto} (${q.cuarto_id})`, n(q.piezas), objeto(q.existencia).map(([sku, x]) => `${x} ${sku}`).join(' · ') || '—'])} /></Card>
        </>
      )}

      {r && seccion === 'abasto' && (
        <>
          {!unidadesCuadran(ab.unidades) && <AvisoPos tono="error">Las unidades de los traspasos no cuadran. Avisa a sistemas.</AvisoPos>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="reportes-abasto-resumen">
            <KpiTile label="Traspasos despachados" value={n(ab.traspasos?.despachados)} hint={`${n(ab.traspasos?.recibidos)} recibidos · ${n(ab.traspasos?.retornados)} retornados · ${n(ab.traspasos?.en_transito)} en tránsito`} />
            <KpiTile label="Piezas recibidas bien" value={n(ab.unidades?.recibidas_correctamente)} hint={`de ${n(ab.unidades?.despachadas)} despachadas`} />
            <KpiTile label="Dañadas / faltantes" value={`${n(ab.unidades?.danadas)} / ${n(ab.unidades?.faltantes)}`} hint="Piezas, no pesos" />
            <KpiTile label="Incidencias abiertas" value={n(ab.traspasos?.incidencias_abiertas)} hint={`${n(ab.traspasos?.incidencias_cerradas)} cerradas`} />
          </div>
          <AvisoPos tono="neutro" testid="reportes-fisico-contable">{ab.contable?.explicacion}</AvisoPos>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Por tienda</SectionLabel></div>
            <Tabla cabeceras={['Tienda', 'Traspasos', 'Despachadas', 'Recibidas bien', 'Retornadas', 'Dañadas', 'Faltantes', 'En tránsito']}
              filas={(ab.por_tienda || []).map(x => [x.tienda, n(x.traspasos), n(x.despachadas), n(x.recibidas_correctamente), n(x.retornadas), n(x.danadas), n(x.faltantes), n(x.en_transito)])} /></Card>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Por producto</SectionLabel></div>
            <Tabla cabeceras={['Producto', 'Despachadas', 'Recibidas bien', 'Retornadas', 'Dañadas', 'Faltantes', 'En tránsito']}
              filas={(ab.por_producto || []).map(x => [x.nombre || x.sku, n(x.despachadas), n(x.recibidas_correctamente), n(x.retornadas), n(x.danadas), n(x.faltantes), n(x.en_transito)])} /></Card>
          <Card padding="p-0"><div className="p-4 pb-1"><SectionLabel>Incidencias</SectionLabel></div>
            <Tabla testid="reportes-incidencias" cabeceras={['Traspaso', 'Estado', 'Dañadas', 'Faltantes', 'Qué pasó']}
              filas={(ab.incidencias || []).map(i => [`${i.folio} · ${nombreEst(i.establecimiento_id)}`, <span key="s" className={i.abierta ? TONO.error : TONO.ok}>{i.abierta ? 'Abierta' : 'Cerrada'}</span>, n(i.danadas), n(i.faltantes),
                `${i.nota || ''}${i.resolucion ? ` — Resolución: ${i.resolucion}` : ''}`])} /></Card>
        </>
      )}
    </div>
  );
}
