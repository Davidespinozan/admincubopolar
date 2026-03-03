import { useState, useCallback, useMemo } from 'react';
import { Icons } from './ui/Icons';
import DashboardView from './views/DashboardView';
import {
  ClientesView, ProductosView, PreciosView, ProduccionView,
  InventarioView, OrdenesView, RutasView, FacturacionView,
  ConciliacionView, AuditoriaView, ConfiguracionView, AlmacenBolsasView,
  EmpleadosView, NominaView, ContabilidadView
} from './views/ModuleViews';

/*
  ADMIN: 4 áreas — Operación, Comercial, Finanzas, Equipo
  Mobile: bottom nav 5 items + "Más" overflow
  Desktop: sidebar grouped by area with section headers
*/

const AREAS = [
  { id: "operacion", label: "Operación", icon: "Factory", color: "blue",
    items: [
      { id: "dashboard", label: "Resumen", icon: "Dashboard" },
      { id: "produccion", label: "Producción", icon: "Factory" },
      { id: "inventario", label: "Congeladores", icon: "Warehouse" },
      { id: "comodatos", label: "Comodatos", icon: "Truck" },
      { id: "rutas", label: "Rutas", icon: "Truck" },
      { id: "bolsas", label: "Insumos", icon: "Box" },
    ]
  },
  { id: "comercial", label: "Comercial", icon: "ShoppingCart", color: "emerald",
    items: [
      { id: "ordenes", label: "Ventas", icon: "ShoppingCart" },
      { id: "clientes", label: "Clientes", icon: "Users" },
      { id: "leads", label: "Leads", icon: "UserCheck" },
      { id: "precios", label: "Precios", icon: "DollarSign" },
      { id: "productos", label: "Catálogo", icon: "Package" },
    ]
  },
  { id: "finanzas", label: "Finanzas", icon: "Wallet", color: "amber",
    items: [
      { id: "contabilidad", label: "Ingresos / Egresos", icon: "Calculator" },
      { id: "facturacion", label: "Facturación", icon: "FileText" },
      { id: "conciliacion", label: "Cortes de caja", icon: "ClipboardCheck" },
      { id: "nomina", label: "Nómina", icon: "Wallet" },
    ]
  },
  { id: "equipo", label: "Equipo", icon: "Users", color: "purple",
    items: [
      { id: "empleados", label: "Empleados", icon: "UserCheck" },
      { id: "auditoria", label: "Historial", icon: "Shield" },
      { id: "configuracion", label: "Ajustes", icon: "Settings" },
    ]
  },
];

const ALL_ITEMS = AREAS.flatMap(a => a.items);
const BOTTOM_PRIMARY = ["dashboard", "ordenes", "produccion", "contabilidad"];

export default function CuboPolarERP({ user, data, actions, onLogout, onViewAs }) {
  const [view, setView] = useState('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [alertasOpen, setAlertasOpen] = useState(false);

  const vp = useMemo(() => ({ data, actions }), [data, actions]);

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView data={data} />;
      case 'clientes': return <ClientesView {...vp} />;
      case 'productos': return <ProductosView {...vp} />;
      case 'bolsas': return <AlmacenBolsasView {...vp} />;
      case 'precios': return <PreciosView {...vp} />;
      case 'produccion': return <ProduccionView {...vp} />;
      case 'inventario': return <InventarioView {...vp} />;
      case 'ordenes': return <OrdenesView {...vp} />;
      case 'rutas': return <RutasView {...vp} />;
      case 'facturacion': return <FacturacionView {...vp} />;
      case 'conciliacion': return <ConciliacionView data={data} />;
      case 'auditoria': return <AuditoriaView data={data} />;
      case 'nomina': return <NominaView data={data} />;
      case 'contabilidad': return <ContabilidadView {...vp} />;
      case 'empleados': return <EmpleadosView {...vp} />;
      case 'configuracion': return <ConfiguracionView {...vp} />;
      case 'comodatos': return <ComodatosView {...vp} />;
      case 'leads': return <LeadsView {...vp} />;
      default: return <DashboardView data={data} />;
    }
  };

  const go = useCallback((id) => { setView(id); setMoreOpen(false); }, []);
  const current = ALL_ITEMS.find(n => n.id === view);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* ═══ SIDEBAR — desktop ═══ */}
      <aside className="hidden md:flex fixed top-0 left-0 h-full w-[240px] bg-white border-r border-slate-100 z-40 flex-col">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white"><Icons.Snowflake /></div>
          <div><span className="text-sm font-extrabold text-slate-800 tracking-tight">CUBOPOLAR</span><span className="text-[10px] text-slate-400 block -mt-0.5">ERP v2.0</span></div>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          {AREAS.map(area => (
            <div key={area.id} className="mb-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-1">{area.label}</p>
              <div className="space-y-0.5">
                {area.items.map(item => {
                  const Ic = Icons[item.icon] || Icons.Package;
                  const active = view === item.id;
                  return (
                    <button key={item.id} onClick={() => go(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                      <span className={`flex-shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`}><Ic /></span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {onViewAs && (
          <div className="flex-shrink-0 border-t border-slate-100 px-3 py-2">
            <p className="text-[10px] font-bold text-purple-500 uppercase mb-1.5 px-1">👁 Ver como...</p>
            <div className="grid grid-cols-2 gap-1">
              {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                <button key={r} onClick={()=>onViewAs(r)} className="py-1.5 px-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-[10px] font-semibold text-purple-700 transition-all">{r}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex-shrink-0 h-[60px] border-t border-slate-100 flex items-center justify-between px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">{user?.nombre?.[0] || "A"}</div>
            <div className="min-w-0"><p className="text-xs font-semibold text-slate-700 truncate">{user?.nombre || "Admin"}</p><p className="text-xs text-slate-400 truncate">{user?.rol}</p></div>
          </div>
          {onLogout && <button onClick={onLogout} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 flex-shrink-0" title="Cerrar sesión"><Icons.X /></button>}
        </div>
      </aside>

      {/* ═══ TOPBAR ═══ */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-100 md:ml-[240px]" style={{paddingTop: "env(safe-area-inset-top, 0px)"}}>
        <div className="flex items-center justify-between h-14 md:h-16 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="md:hidden w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white flex-shrink-0"><Icons.Snowflake /></div>
            <div className="md:hidden"><p className="text-sm font-bold text-slate-800">{current?.label || "Resumen"}</p></div>
            <div className="hidden md:flex relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span>
              <input type="text" placeholder="Buscar..." className="pl-10 pr-4 py-2 w-64 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:border-blue-300 focus:bg-white transition-all" />
            </div>
          </div>
          <div className="flex items-center gap-2 relative">
            <button onClick={() => setAlertasOpen(!alertasOpen)} className="relative p-2.5 rounded-xl hover:bg-slate-100 transition-colors text-slate-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
              <Icons.Bell /><span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            {alertasOpen && (
              <div className="absolute top-12 right-0 bg-white border border-slate-100 rounded-xl shadow-lg w-80 max-h-96 overflow-y-auto z-50">
                <div className="p-3 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-800">Alertas</p>
                </div>
                {(data.alertas || []).length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400">Sin alertas activas</div>
                ) : (
                  <div className="space-y-1">
                    {(data.alertas || []).map((a, i) => (
                      <div key={i} className="px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                        <p className="text-sm font-semibold text-slate-800">{a.titulo || 'Alerta'}</p>
                        <p className="text-xs text-slate-500 mt-1">{a.mensaje || a.detalle}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {alertasOpen && <div className="fixed inset-0 z-40" onClick={() => setAlertasOpen(false)} />}
            <div className="hidden md:flex items-center gap-2 ml-2 pl-3 border-l border-slate-100">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600">{user?.nombre?.[0] || "A"}</div>
              <span className="text-sm font-semibold text-slate-700">{user?.nombre || "Admin"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MAIN ═══ */}
      <main className="md:ml-[240px] px-4 py-4 md:px-6 md:py-6 pb-24 md:pb-6">
        {renderView()}
      </main>

      {/* ═══ BOTTOM NAV — mobile ═══ */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100 safe-bottom">
        <div className="flex items-stretch">
          {BOTTOM_PRIMARY.map(id => {
            const item = ALL_ITEMS.find(n => n.id === id);
            if (!item) return null;
            const Ic = Icons[item.icon] || Icons.Package;
            const active = view === id && !moreOpen;
            return (
              <button key={id} onClick={() => go(id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] transition-colors ${active ? 'text-blue-600' : 'text-slate-400 active:text-slate-600'}`}>
                <Ic />
                <span className="text-[10px] font-semibold mt-0.5 leading-none truncate max-w-full px-0.5">{
                  id === "dashboard" ? "Inicio" :
                  id === "contabilidad" ? "Dinero" :
                  id === "produccion" ? "Prod." :
                  item.label.split(" ")[0]
                }</span>
              </button>
            );
          })}
          <button onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] transition-colors ${moreOpen || !BOTTOM_PRIMARY.includes(view) ? 'text-blue-600' : 'text-slate-400 active:text-slate-600'}`}>
            <Icons.MoreH />
            <span className="text-[10px] font-semibold mt-0.5 leading-none">Más</span>
          </button>
        </div>
      </nav>

      {/* ═══ "MÁS" OVERFLOW — mobile ═══ */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl safe-bottom max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-2" />
            <div className="px-4 pb-4">
              {AREAS.map(area => (
                <div key={area.id} className="mb-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{area.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {area.items.filter(i => !BOTTOM_PRIMARY.includes(i.id)).map(item => {
                      const Ic = Icons[item.icon] || Icons.Package;
                      const active = view === item.id;
                      return (
                        <button key={item.id} onClick={() => go(item.id)}
                          className={`flex flex-col items-center justify-center py-3 rounded-xl min-h-[64px] transition-colors ${active ? 'bg-blue-50 text-blue-600' : 'text-slate-500 active:bg-slate-50'}`}>
                          <Ic />
                          <span className="text-[10px] font-semibold mt-1.5 leading-tight text-center truncate max-w-full px-1">{item.label.split(" ")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {onViewAs && (
                <div className="border-t border-slate-100 pt-3 mt-1">
                  <p className="text-[10px] font-bold text-purple-500 uppercase mb-2 px-1">👁 Ver como...</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                      <button key={r} onClick={()=>{onViewAs(r);setMoreOpen(false)}} className="py-2.5 px-2 bg-purple-50 active:bg-purple-100 border border-purple-200 rounded-xl text-xs font-semibold text-purple-700">{r}</button>
                    ))}
                  </div>
                </div>
              )}
              {onLogout && (
                <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-red-500 active:bg-red-50 mt-2 border border-red-100">
                  <Icons.X /><span className="text-xs font-semibold">Cerrar sesión</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ PLACEHOLDER VIEWS for new modules ═══

function ComodatosView({ data, actions }) {
  const [modal, setModal] = useState(false);
  const empty = { negocio: "", direccion: "", contacto: "", congeladorModelo: "", capacidad: "60", stockMaximo: "60", frecuencia: "Diario" };
  const [form, setForm] = useState(empty);
  const comodatos = data.comodatos || [];

  const save = async () => {
    if (!form.negocio.trim()) return;
    await actions.addComodato({ ...form, capacidad: parseInt(form.capacidad), stockMaximo: parseInt(form.stockMaximo), stockActual: 0 });
    setModal(false); setForm(empty);
  };

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Comodatos</h2><p className="text-xs text-slate-400">Congeladores en negocios. El chofer repone y cobra.</p></div>
      <button onClick={() => { setForm(empty); setModal(true); }} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo</button>
    </div>
    {comodatos.length > 0 ? comodatos.map(c => (
      <div key={c.id} className="bg-white rounded-xl p-4 border border-slate-100">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-bold text-slate-800">{c.negocio}</p>
            <p className="text-xs text-slate-400">{c.direccion} · {c.contacto}</p>
          </div>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${c.estatus === "Activo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.estatus}</span>
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          {c.congeladorModelo && <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-1 rounded-lg">{c.congeladorModelo}</span>}
          <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">Cap: {c.capacidad}</span>
          <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-2 py-1 rounded-lg">Stock: {c.stockActual || 0}</span>
          <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2 py-1 rounded-lg">{c.frecuencia}</span>
        </div>
      </div>
    )) : <p className="text-sm text-slate-400 text-center py-8">Sin comodatos. Usa + Nuevo para registrar.</p>}
    {modal && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={() => setModal(false)}>
        <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-4">Nuevo comodato</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Negocio *</label><input value={form.negocio} onChange={e => setForm({...form, negocio: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" placeholder="OXXO Centro" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dirección</label><input value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono contacto</label><input value={form.contacto} onChange={e => setForm({...form, contacto: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Modelo congelador</label><input value={form.congeladorModelo} onChange={e => setForm({...form, congeladorModelo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" placeholder="Imbera VR-17" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad</label><input type="number" value={form.capacidad} onChange={e => setForm({...form, capacidad: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Frecuencia</label><select value={form.frecuencia} onChange={e => setForm({...form, frecuencia: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Diario</option><option>Cada 2 días</option><option>Cada 3 días</option><option>Semanal</option></select></div>
            </div>
          </div>
          <button onClick={save} disabled={!form.negocio.trim()} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">Guardar comodato</button>
        </div>
      </div>
    )}
  </div>);
}

function LeadsView({ data, actions }) {
  const [modal, setModal] = useState(false);
  const empty = { nombre: "", telefono: "", correo: "", mensaje: "", origen: "Landing page" };
  const [form, setForm] = useState(empty);
  const leads = data.leads || [];

  const save = async () => {
    if (!form.nombre.trim()) return;
    await actions.addLead(form);
    setModal(false); setForm(empty);
  };

  const cambiarEstatus = async (id, est) => {
    await actions.updateLead(id, { estatus: est });
  };

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Leads ({leads.length})</h2><p className="text-xs text-slate-400">Contactos de landing page y otros canales</p></div>
      <button onClick={() => { setForm(empty); setModal(true); }} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo</button>
    </div>
    {leads.length > 0 ? leads.map(l => (
      <div key={l.id} className="bg-white rounded-xl p-4 border border-slate-100">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-bold text-slate-800">{l.nombre}</p>
            <p className="text-xs text-slate-400">{l.telefono}{l.correo ? ` · ${l.correo}` : ""}</p>
          </div>
          <select value={l.estatus} onChange={e => cambiarEstatus(l.id, e.target.value)}
            className={`text-xs font-bold px-2 py-1 rounded-full border-0 cursor-pointer ${
              l.estatus === "Nuevo" ? "bg-blue-100 text-blue-700" :
              l.estatus === "Contactado" ? "bg-amber-100 text-amber-700" :
              l.estatus === "Convertido" ? "bg-emerald-100 text-emerald-700" :
              "bg-slate-100 text-slate-500"
            }`}>
            <option>Nuevo</option><option>Contactado</option><option>Convertido</option><option>Descartado</option>
          </select>
        </div>
        {l.mensaje && <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg p-2">{l.mensaje}</p>}
        <p className="text-[10px] text-slate-400 mt-1">{l.origen} · {l.fecha}</p>
      </div>
    )) : <p className="text-sm text-slate-400 text-center py-8">Sin leads. Usa + Nuevo para registrar uno manual.</p>}
    {modal && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={() => setModal(false)}>
        <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5" onClick={e => e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-4">Nuevo lead</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre *</label><input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono</label><input value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Correo</label><input value={form.correo} onChange={e => setForm({...form, correo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            </div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mensaje</label><textarea value={form.mensaje} onChange={e => setForm({...form, mensaje: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" rows={2} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Origen</label><select value={form.origen} onChange={e => setForm({...form, origen: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Landing page</option><option>WhatsApp</option><option>Teléfono</option><option>Referido</option><option>Redes sociales</option></select></div>
          </div>
          <button onClick={save} disabled={!form.nombre.trim()} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">Guardar lead</button>
        </div>
      </div>
    )}
  </div>);
}
