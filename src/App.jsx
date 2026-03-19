import { useMemo, useState, lazy, Suspense } from 'react'
import LoginScreen from './components/Login'
import CuboPolarERP from './components/CuboPolarERP'
import { useSupaStore } from './data/supaStore'

// Lazy-load role-specific views — reduces initial bundle for admin by ~40%
const ChoferView = lazy(() => import('./components/ChoferView'))
const BolsasView = lazy(() => import('./components/BolsasView'))
const ProduccionStandaloneView = lazy(() => import('./components/ProduccionStandaloneView'))
const VentasStandaloneView = lazy(() => import('./components/VentasStandaloneView'))

function RoleFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #f2f8fa 0%, #e7eff2 100%)' }}>
      <div className="erp-panel erp-shell-blur w-full max-w-sm rounded-[30px] px-8 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-cyan-200 animate-pulse shadow-[0_16px_30px_rgba(8,20,27,0.22)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </div>
        <p className="erp-kicker text-slate-400">Inicializando modulo</p>
        <p className="mt-2 text-sm font-medium text-slate-600">Cargando vista...</p>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [adminViewAs, setAdminViewAs] = useState(null)
  const { data, actions, loading } = useSupaStore(user?.id, user?.nombre)

  const authUserId = user?.authUserId || user?.auth_id || null

  const usuarioActual = useMemo(() => {
    const usuarios = data?.usuarios || []
    if (!usuarios.length) return null
    if (authUserId) {
      const byAuth = usuarios.find(u => u?.auth_id && String(u.auth_id) === String(authUserId))
      if (byAuth) return byAuth
    }
    if (user?.id !== undefined && user?.id !== null) {
      const byId = usuarios.find(u => String(u?.id) === String(user.id))
      if (byId) return byId
    }
    if (user?.email) {
      const byEmail = usuarios.find(u => (u?.email || '').toLowerCase() === String(user.email).toLowerCase())
      if (byEmail) return byEmail
    }
    return null
  }, [data?.usuarios, authUserId, user?.id, user?.email])

  const usuarioActualId = usuarioActual?.id || user?.id || null

  const matchOwner = (row, ownerId, ownerAuthId, ownerName) => {
    if (!row || ownerId == null) return false
    const ownerKeys = ['usuario_id', 'vendedor_id', 'chofer_id', 'asignado_a', 'owner_id', 'created_by']
    const directMatch = ownerKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(ownerId))
    if (directMatch) return true
    if (ownerAuthId) {
      const authKeys = ['auth_id', 'usuario_auth_id', 'vendedor_auth_id', 'chofer_auth_id']
      if (authKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(ownerAuthId))) return true
    }
    if (ownerName) {
      const nameKeys = ['usuario', 'vendedor', 'chofer_nombre', 'chofer']
      if (nameKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(ownerName))) return true
    }
    return false
  }

  const scopedData = useMemo(() => {
    if (!data) return data
    if (user?.rol === 'Admin' || adminViewAs) return data
    if (!usuarioActualId) return data

    if (user?.rol === 'Chofer') {
      const rutasPropias = (data.rutas || []).filter(r => matchOwner(r, usuarioActualId, authUserId, usuarioActual?.nombre))
      const rutaIds = new Set(rutasPropias.map(r => String(r.id)))
      const ordenesPropias = (data.ordenes || []).filter(o => o?.ruta_id != null && rutaIds.has(String(o.ruta_id)))
      const pagosPropios = (data.pagos || []).filter(p => matchOwner(p, usuarioActualId, authUserId, usuarioActual?.nombre))
      const mermasPropias = (data.mermas || []).filter(m => matchOwner(m, usuarioActualId, authUserId, usuarioActual?.nombre))
      const invMovPropios = (data.inventarioMov || []).filter(m => matchOwner(m, usuarioActualId, authUserId, usuarioActual?.nombre))

      return {
        ...data,
        rutas: rutasPropias,
        ordenes: ordenesPropias,
        pagos: pagosPropios,
        mermas: mermasPropias,
        inventarioMov: invMovPropios,
      }
    }

    if (user?.rol === 'Ventas') {
      const ordenesPropias = (data.ordenes || []).filter(o => matchOwner(o, usuarioActualId, authUserId, usuarioActual?.nombre))
      const clienteIds = new Set(ordenesPropias.map(o => String(o.clienteId || o.cliente_id)).filter(Boolean))
      const clientesPropios = (data.clientes || []).filter(c => {
        if (matchOwner(c, usuarioActualId, authUserId, usuarioActual?.nombre)) return true
        return clienteIds.has(String(c.id))
      })
      const pagosPropios = (data.pagos || []).filter(p => matchOwner(p, usuarioActualId, authUserId, usuarioActual?.nombre))
      return {
        ...data,
        ordenes: ordenesPropias,
        clientes: clientesPropios,
        pagos: pagosPropios,
      }
    }

    return data
  }, [data, user?.rol, usuarioActualId, authUserId, usuarioActual?.nombre, adminViewAs])

  if (!user) return <LoginScreen onLogin={setUser} />

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #f2f8fa 0%, #e7eff2 100%)' }}>
      <div className="erp-panel erp-shell-blur w-full max-w-sm rounded-[32px] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-900 text-cyan-200 animate-pulse shadow-[0_18px_34px_rgba(8,20,27,0.24)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </div>
        <p className="erp-kicker text-slate-400">Sincronizando datos</p>
        <p className="mt-2 text-sm font-medium text-slate-600">Cargando datos...</p>
      </div>
    </div>
  )

  const isAdmin = user.rol === 'Admin'
  const effectiveRole = adminViewAs || user.rol
  const handleLogout = () => isAdmin && adminViewAs ? setAdminViewAs(null) : setUser(null)

  const adminBar = isAdmin && adminViewAs ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between border-b border-white/10 bg-slate-950/92 px-4 py-2 text-cyan-50 erp-shell-blur shadow-[0_14px_30px_rgba(8,20,27,0.28)]">
      <span className="text-xs font-bold tracking-[0.14em] uppercase">Viendo como: {adminViewAs}</span>
      <button onClick={() => setAdminViewAs(null)} className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/14">
        ← Volver a Admin
      </button>
    </div>
  ) : null

  const withAdminBar = (view) => adminBar
    ? <>{adminBar}<div style={{ paddingTop: '44px' }}>{view}</div></>
    : view

  const roleUser = { ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }

  if (effectiveRole === 'Chofer')
    return withAdminBar(<Suspense fallback={<RoleFallback />}><ChoferView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Almacén Bolsas')
    return withAdminBar(<Suspense fallback={<RoleFallback />}><BolsasView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Producción')
    return withAdminBar(<Suspense fallback={<RoleFallback />}><ProduccionStandaloneView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Ventas')
    return withAdminBar(<Suspense fallback={<RoleFallback />}><VentasStandaloneView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  return (
    <CuboPolarERP
      user={user}
      data={data}
      actions={actions}
      onLogout={() => setUser(null)}
      onViewAs={isAdmin ? setAdminViewAs : null}
    />
  )
}

export default App
