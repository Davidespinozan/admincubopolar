import { useMemo, useState } from 'react'
import LoginScreen from './components/Login'
import CuboPolarERP from './components/CuboPolarERP'
import ChoferView from './components/ChoferView'
import BolsasView from './components/BolsasView'
import ProduccionStandaloneView from './components/ProduccionStandaloneView'
import VentasStandaloneView from './components/VentasStandaloneView'
import { useSupaStore } from './data/supaStore'

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white mx-auto mb-3 animate-pulse">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </div>
        <p className="text-sm text-slate-500 font-medium">Cargando datos...</p>
      </div>
    </div>
  )

  const isAdmin = user.rol === 'Admin'
  const effectiveRole = adminViewAs || user.rol
  const handleLogout = () => isAdmin && adminViewAs ? setAdminViewAs(null) : setUser(null)

  const adminBar = isAdmin && adminViewAs ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-purple-600 text-white flex items-center justify-between px-4 py-2 shadow-lg">
      <span className="text-xs font-bold">👁 Viendo como: {adminViewAs}</span>
      <button onClick={() => setAdminViewAs(null)} className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-bold">
        ← Volver a Admin
      </button>
    </div>
  ) : null

  const withAdminBar = (view) => adminBar
    ? <>{adminBar}<div style={{ paddingTop: '44px' }}>{view}</div></>
    : view

  if (effectiveRole === 'Chofer')
    return withAdminBar(<ChoferView user={{ ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }} data={scopedData} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Almacén Bolsas')
    return withAdminBar(<BolsasView user={{ ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }} data={scopedData} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Producción')
    return withAdminBar(<ProduccionStandaloneView user={{ ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }} data={scopedData} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Ventas')
    return withAdminBar(<VentasStandaloneView user={{ ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }} data={scopedData} actions={actions} onLogout={handleLogout} />)

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
