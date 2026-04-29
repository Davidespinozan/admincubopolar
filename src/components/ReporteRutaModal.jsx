import { useState, useMemo } from 'react';
import { Modal, FormBtn, s, n } from './views/viewsCommon';
import { reporteRutaDiaria } from '../utils/exportReports';

export default function ReporteRutaModal({ ruta, data, onClose }) {
  const [notas, setNotas] = useState('');

  if (!ruta) return null;

  const productos = data.productos || [];
  const clientes = data.clientes || [];
  const ordenes = data.ordenes || [];
  const mermas = data.mermas || [];

  const findProd = (sku) => productos.find(p => s(p.sku) === s(sku));
  const findCli = (id) => clientes.find(c => String(c.id) === String(id));

  // Datos derivados
  const carga = (ruta.carga && typeof ruta.carga === 'object') ? ruta.carga : {};
  const cargaAuth = (ruta.carga_autorizada && typeof ruta.carga_autorizada === 'object') ? ruta.carga_autorizada : carga;
  const devolucion = (ruta.devolucion && typeof ruta.devolucion === 'object') ? ruta.devolucion : {};

  const rutaOrdenes = useMemo(() =>
    ordenes.filter(o => String(o.rutaId || o.ruta_id) === String(ruta.id)),
    [ordenes, ruta.id]
  );

  const vendidoPorSku = useMemo(() => {
    const acc = {};
    for (const o of rutaOrdenes) {
      if (s(o.estatus).toLowerCase() !== 'entregada') continue;
      if (Array.isArray(o.preciosSnapshot) && o.preciosSnapshot.length > 0) {
        for (const ln of o.preciosSnapshot) {
          const sku = s(ln.sku);
          acc[sku] = (acc[sku] || 0) + n(ln.qty || ln.cantidad);
        }
      } else {
        s(o.productos).split(',').forEach(part => {
          const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
          if (!mt) return;
          const sku = s(mt[2]);
          acc[sku] = (acc[sku] || 0) + Number(mt[1] || 0);
        });
      }
    }
    return acc;
  }, [rutaOrdenes]);

  const choferNombre = s(ruta.choferNombre || ruta.chofer_nombre || ruta.chofer);
  const mermasRuta = useMemo(() =>
    mermas.filter(m => String(m.ruta_id || m.rutaId || '') === String(ruta.id)),
    [mermas, ruta.id]
  );

  const mermaPorSku = useMemo(() => {
    const acc = {};
    for (const m of mermasRuta) {
      const sku = s(m.sku);
      acc[sku] = (acc[sku] || 0) + n(m.cantidad || m.cant);
    }
    return acc;
  }, [mermasRuta]);

  const totalCobrado = n(ruta.total_cobrado || ruta.totalCobrado);
  const totalCredito = n(ruta.total_credito || ruta.totalCredito);
  const totalGeneral = totalCobrado + totalCredito;

  const skusUnicos = Array.from(new Set([
    ...Object.keys(carga),
    ...Object.keys(cargaAuth),
    ...Object.keys(vendidoPorSku),
    ...Object.keys(devolucion),
    ...Object.keys(mermaPorSku),
  ]));

  const fechaShow = s(ruta.fecha_fin || ruta.cierre_at || ruta.fecha || '').slice(0, 10);

  const handleDescargarPDF = () => {
    try {
      reporteRutaDiaria(ruta, ordenes, mermas, productos, clientes, notas);
    } catch (err) {
      console.error('[ReporteRuta] Error al generar PDF:', err);
      alert('No se pudo generar el PDF: ' + (err?.message || err));
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={`Reporte de ruta · ${s(ruta.folio)}`} wide>
      <div className="space-y-5">
        {/* Encabezado */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Ruta</p>
              <p className="font-bold text-slate-800">{s(ruta.nombre)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{fechaShow}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Chofer</p>
              <p className="font-semibold text-slate-700">{choferNombre || '—'}</p>
              {(ruta.ayudanteNombre || ruta.ayudante_nombre) && (
                <p className="text-xs text-slate-500 mt-0.5">+ {s(ruta.ayudanteNombre || ruta.ayudante_nombre)}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Camión</p>
              <p className="font-semibold text-slate-700">{s(ruta.camionNombre || ruta.camion_nombre) || '—'}</p>
              {(ruta.camionPlacas || ruta.camion_placas) && (
                <p className="text-xs text-slate-500 mt-0.5">Placas {s(ruta.camionPlacas || ruta.camion_placas)}</p>
              )}
            </div>
          </div>
        </div>

        {/* Resumen económico */}
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">💰 Resumen económico</h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">Cobrado</p>
              <p className="text-xl font-extrabold text-emerald-700">${totalCobrado.toLocaleString('es-MX')}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-amber-600 uppercase mb-1">Crédito</p>
              <p className="text-xl font-extrabold text-amber-700">${totalCredito.toLocaleString('es-MX')}</p>
            </div>
            <div className="bg-slate-900 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-slate-300 uppercase mb-1">Total general</p>
              <p className="text-xl font-extrabold text-white">${totalGeneral.toLocaleString('es-MX')}</p>
            </div>
          </div>
        </div>

        {/* Carga y movimiento */}
        {skusUnicos.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">📦 Carga y movimiento</h4>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Producto</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Cargó</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Devolvió</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Merma</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Vendió</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {skusUnicos.map(sku => {
                    const prod = findProd(sku);
                    const cargado = n(carga[sku] || cargaAuth[sku]);
                    const dev = n(devolucion[sku]);
                    const merma = n(mermaPorSku[sku]);
                    const vendido = n(vendidoPorSku[sku]);
                    return (
                      <tr key={sku} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{prod ? s(prod.nombre) : sku}</p>
                          <p className="text-[10px] font-mono text-slate-400">{sku}</p>
                        </td>
                        <td className="text-center px-3 py-2.5 text-sm font-semibold text-slate-700">{cargado.toLocaleString()}</td>
                        <td className="text-center px-3 py-2.5 text-sm text-slate-600">{dev.toLocaleString()}</td>
                        <td className={`text-center px-3 py-2.5 text-sm ${merma > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{merma.toLocaleString()}</td>
                        <td className="text-center px-3 py-2.5 text-sm font-bold text-emerald-700">{vendido.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Entregas */}
        {rutaOrdenes.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">🚚 Entregas del día · {rutaOrdenes.length}</h4>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 w-12">#</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Folio</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Cliente</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Pago</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-600">Total</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rutaOrdenes.map((o, i) => {
                    const cli = findCli(o.clienteId || o.cliente_id);
                    const metodoPago = s(o.metodoPago || o.metodo_pago || 'Efectivo');
                    const colorPago = metodoPago.toLowerCase().includes('crédito') || metodoPago.toLowerCase().includes('credito') ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
                    return (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-xs text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-600">{s(o.folio || `ORD-${o.id}`)}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{s(o.cliente || o.cliente_nombre || cli?.nombre || 'Público')}</td>
                        <td className="px-3 py-2"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorPago}`}>{metodoPago}</span></td>
                        <td className="text-right px-3 py-2 text-sm font-bold text-slate-800">${n(o.total).toLocaleString('es-MX')}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{s(o.estatus)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Mermas */}
        {mermasRuta.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-red-500 uppercase tracking-wide mb-2">⚠️ Mermas reportadas · {mermasRuta.length}</h4>
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3 space-y-2">
              {mermasRuta.map((m, i) => {
                const prod = findProd(m.sku);
                return (
                  <div key={i} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-red-100">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{prod ? s(prod.nombre) : s(m.sku)}</p>
                      <p className="text-xs text-slate-500">{s(m.causa) || 'Sin causa registrada'}</p>
                    </div>
                    <span className="text-sm font-bold text-red-600">{n(m.cantidad || m.cant)}× perdidas</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notas adicionales */}
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">📝 Notas adicionales (opcional)</h4>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Agrega cualquier observación que quieras incluir en el PDF descargado..."
            rows={3}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-slate-400 resize-none"
          />
          <p className="text-[10px] text-slate-400 mt-1">Las notas solo aparecen en el PDF. No se guardan en el sistema.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-slate-100">
        <FormBtn onClick={onClose}>Cerrar</FormBtn>
        <FormBtn primary onClick={handleDescargarPDF}>📄 Descargar PDF</FormBtn>
      </div>
    </Modal>
  );
}
