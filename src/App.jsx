import { useState } from 'react'
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
    return withAdminBar(<ChoferView user={user} data={data} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Almacén Bolsas')
    return withAdminBar(<BolsasView user={user} data={data} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Producción')
    return withAdminBar(<ProduccionStandaloneView user={user} data={data} actions={actions} onLogout={handleLogout} />)

  if (effectiveRole === 'Ventas')
    return withAdminBar(<VentasStandaloneView user={user} data={data} actions={actions} onLogout={handleLogout} />)

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
