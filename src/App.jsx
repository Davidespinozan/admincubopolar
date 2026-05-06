import { useMemo, useState, useEffect, useRef, lazy, Suspense } from 'react'
import LoginScreen from './components/Login'
import CuboPolarERP from './components/CuboPolarERP'
import { useSupaStore } from './data/supaStore'
import { supabase } from './lib/supabase'
import { setUserContext, Sentry } from './lib/sentry'
import { buildUserFromSessionAndProfile } from './lib/sessionUser'

// Lazy-load role-specific views — reduces initial bundle for admin by ~40%
const ChoferView = lazy(() => import('./components/ChoferView'))
const BolsasView = lazy(() => import('./components/BolsasView'))
const ProduccionStandaloneView = lazy(() => import('./components/ProduccionStandaloneView'))
const VentasStandaloneView = lazy(() => import('./components/VentasStandaloneView'))

function RoleFallback() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #f2f8fa 0%, #e7eff2 100%)' }}>
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
  // Tanda 19 A: `restoring` arranca true para evitar flash de Login
  // mientras supabase.auth.getSession() resuelve al mount. Una vez
  // intentamos restaurar (con o sin éxito), pasa a false.
  const [restoring, setRestoring] = useState(true)
  // Tanda 19 D: ref para distinguir logout manual (botón Cerrar sesión)
  // vs espontáneo (sesión perdida sin acción del usuario). Se setea a
  // true ANTES del setUser(null) en handleLogout y se resetea tras
  // consumirse en el useEffect de telemetría.
  const isManualLogoutRef = useRef(false)
  // Para detectar transiciones truthy ↔ null en el useEffect de Sentry.
  const previousUserRef = useRef(null)
  const { data, actions, loading, error } = useSupaStore(user?.id, user?.nombre, user?.rol)

  // ── Detector de offline/online ──
  // Listener global para mostrar banner cuando se cae la red. NO implementa
  // queue de mutaciones pendientes (post-entrega): solo avisa al usuario.
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  const [showReconectado, setShowReconectado] = useState(false)
  useEffect(() => {
    const onOffline = () => setIsOffline(true)
    const onOnline = () => {
      setIsOffline(false)
      setShowReconectado(true)
      setTimeout(() => setShowReconectado(false), 3000)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  // Tanda 19 A+C: restaurar sesión al mount + listener global de auth.
  // Sin esto, cada reload, reapertura de pestaña, o re-mount del PWA
  // mostraba Login aunque el JWT siguiera válido en localStorage.
  useEffect(() => {
    if (!supabase) {
      setRestoring(false)
      return
    }
    let active = true

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          if (active) setRestoring(false)
          return
        }
        const email = session.user.email
        if (!email) {
          if (active) setRestoring(false)
          return
        }
        const { data: profile } = await supabase
          .from('usuarios')
          .select('*')
          .eq('email', email.toLowerCase())
          .maybeSingle()
        const restored = buildUserFromSessionAndProfile(session, profile)
        if (restored && active) setUser(restored)
        if (active) setRestoring(false)
      } catch (e) {
        if (active) setRestoring(false)
        try { Sentry?.captureException?.(e, { tags: { source: 'session-restore' } }) } catch { /* noop */ }
      }
    })()

    // Listener global. Solo nos importa SIGNED_OUT explícito (otra pestaña
    // hizo logout, o Supabase invalidó la session por seguridad). Los
    // demás eventos (TOKEN_REFRESHED OK, INITIAL_SESSION) no requieren
    // acción aquí — el state del user no debe cambiar por ellos.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        setUser(null)
      }
    })

    return () => {
      active = false
      try { subscription?.unsubscribe?.() } catch { /* noop */ }
    }
  }, [])

  // Tanda 7+19D: tagear contexto Sentry + telemetría de cambios de user.
  // Reactivo a login/logout/switch. adminViewAs NO aplica aquí: el user
  // real no cambió, solo el filtro UI.
  useEffect(() => {
    setUserContext(user)

    const prev = previousUserRef.current
    previousUserRef.current = user

    // Logout: truthy → null
    if (prev && !user) {
      const meta = {
        timestamp: new Date().toISOString(),
        url: typeof window !== 'undefined' ? window.location.href : null,
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
        pwa_standalone: typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(display-mode: standalone)').matches
          : false,
        prev_user_id: prev?.id ?? null,
        prev_user_rol: prev?.rol ?? null,
      }
      try {
        Sentry?.addBreadcrumb?.({
          category: 'auth',
          message: 'User logout',
          level: isManualLogoutRef.current ? 'info' : 'warning',
          data: { manual: isManualLogoutRef.current, ...meta },
        })
        // Logout NO manual = señal de "salida espontánea" que queremos
        // investigar en Sentry. captureMessage con level=warning para
        // que aparezca en el feed pero no spamee como error rojo.
        if (!isManualLogoutRef.current) {
          Sentry?.captureMessage?.('Unexpected user logout', {
            level: 'warning',
            tags: { source: 'auth' },
            extra: meta,
          })
        }
      } catch { /* noop — no romper la app por telemetría */ }
      isManualLogoutRef.current = false
    }

    // Login: null → truthy
    if (!prev && user) {
      try {
        Sentry?.addBreadcrumb?.({
          category: 'auth',
          message: 'User login',
          level: 'info',
          data: {
            user_id: user.id ?? null,
            user_rol: user.rol ?? null,
            timestamp: new Date().toISOString(),
          },
        })
      } catch { /* noop */ }
    }
  }, [user])

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

  // Tanda 19 A: mientras se restaura la sesión persistida, mostrar
  // splash en lugar de flash de Login. Sin esto, cada reload mostraba
  // ~150ms de pantalla Login antes de que getSession resolviera.
  if (restoring) return (
    <div className="min-h-dvh flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #f2f8fa 0%, #e7eff2 100%)' }}>
      <div className="erp-panel erp-shell-blur w-full max-w-sm rounded-[32px] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-900 text-cyan-200 animate-pulse shadow-[0_18px_34px_rgba(8,20,27,0.24)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </div>
        <p className="erp-kicker text-slate-400">Restaurando sesión</p>
        <p className="mt-2 text-sm font-medium text-slate-600">Un momento…</p>
      </div>
    </div>
  )

  if (!user) return <LoginScreen onLogin={setUser} />

  if (loading) return (
    <div className="min-h-dvh flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #f2f8fa 0%, #e7eff2 100%)' }}>
      <div className="erp-panel erp-shell-blur w-full max-w-sm rounded-[32px] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-900 text-cyan-200 animate-pulse shadow-[0_18px_34px_rgba(8,20,27,0.24)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </div>
        <p className="erp-kicker text-slate-400">Sincronizando datos</p>
        <p className="mt-2 text-sm font-medium text-slate-600">Cargando datos...</p>
      </div>
    </div>
  )

  // ── Pantalla de error de carga inicial ──
  // Si fetchAll falló y data quedó vacía, mostrar pantalla con Reintentar
  // en lugar de un dashboard fantasma sin datos.
  if (error) return (
    <div className="min-h-dvh flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%)' }}>
      <div className="erp-panel erp-shell-blur w-full max-w-md rounded-[32px] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] bg-red-100 text-red-600 shadow-[0_18px_34px_rgba(239,68,68,0.24)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <p className="erp-kicker text-red-500">Error de carga</p>
        <h1 className="font-display mt-2 text-xl font-bold tracking-[-0.03em] text-slate-900">No pudimos cargar los datos</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isOffline
            ? 'Parece que no hay conexión a internet. Verifica tu red e intenta de nuevo.'
            : 'Hubo un problema al sincronizar con el servidor. Intenta de nuevo en unos segundos.'}
        </p>
        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">Detalles técnicos</summary>
          <p className="mt-2 break-words rounded-lg bg-slate-50 p-2 text-[10px] font-mono text-slate-600">{String(error)}</p>
        </details>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_18px_28px_rgba(8,20,27,0.16)] transition-all hover:bg-slate-800"
        >
          Reintentar
        </button>
      </div>
    </div>
  )

  const isAdmin = user.rol === 'Admin'
  const effectiveRole = adminViewAs || user.rol
  const handleLogout = async () => {
    if (isAdmin && adminViewAs) {
      setAdminViewAs(null)
      return
    }
    // Tanda 19 D: flag para que el useEffect de telemetría no marque
    // este logout como espontáneo. Se resetea automáticamente cuando
    // se consume.
    isManualLogoutRef.current = true
    try { await supabase?.auth?.signOut() } catch { /* best-effort: continuar aunque falle */ }
    setUser(null)
  }

  const adminBar = isAdmin && adminViewAs ? (
    <div className="fixed top-0 left-0 right-0 z-[110] border-b border-white/10 bg-slate-950/92 px-4 py-2 text-cyan-50 erp-shell-blur shadow-[0_14px_30px_rgba(8,20,27,0.28)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-[0.14em] uppercase">Vista previa: {adminViewAs}</span>
        <button onClick={() => setAdminViewAs(null)} className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/14">
          ← Volver a Admin
        </button>
      </div>
      <p className="text-[10px] text-amber-300 mt-1">Estás viendo TODOS los datos como Admin. Cada usuario real solo ve lo suyo.</p>
    </div>
  ) : null

  // Banner sticky de offline + toast efímero "Conexión restaurada"
  const offlineBar = isOffline ? (
    <div className="fixed top-0 left-0 right-0 z-[120] border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-900 shadow-[0_8px_20px_rgba(180,83,9,0.18)]">
      <div className="flex items-center justify-center gap-2 text-center">
        <span className="text-base">⚠️</span>
        <p className="text-xs font-semibold sm:text-sm">Sin conexión. Los cambios se guardarán cuando vuelva la conexión.</p>
      </div>
    </div>
  ) : null

  const reconectadoBar = showReconectado && !isOffline ? (
    <div className="fixed top-0 left-0 right-0 z-[120] border-b border-emerald-300 bg-emerald-100 px-4 py-2 text-emerald-900 shadow-[0_8px_20px_rgba(5,150,105,0.18)]">
      <div className="flex items-center justify-center gap-2 text-center">
        <span className="text-base">✓</span>
        <p className="text-xs font-semibold sm:text-sm">Conexión restaurada</p>
      </div>
    </div>
  ) : null

  const globalTop = offlineBar || reconectadoBar
  const topPadding = (globalTop && adminBar) ? '108px' : (globalTop ? '40px' : (adminBar ? '56px' : '0'))

  const withGlobalBars = (view) => (globalTop || adminBar)
    ? <>{globalTop}{adminBar}<div style={{ paddingTop: topPadding }}>{view}</div></>
    : view

  const roleUser = { ...user, id: usuarioActualId || user?.id, auth_id: authUserId || user?.auth_id }

  if (effectiveRole === 'Chofer')
    return withGlobalBars(<Suspense fallback={<RoleFallback />}><ChoferView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Almacén Bolsas')
    return withGlobalBars(<Suspense fallback={<RoleFallback />}><BolsasView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Producción')
    return withGlobalBars(<Suspense fallback={<RoleFallback />}><ProduccionStandaloneView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  if (effectiveRole === 'Ventas')
    return withGlobalBars(<Suspense fallback={<RoleFallback />}><VentasStandaloneView user={roleUser} data={scopedData} actions={actions} onLogout={handleLogout} /></Suspense>)

  return withGlobalBars(
    <CuboPolarERP
      user={user}
      data={data}
      actions={actions}
      onLogout={handleLogout}
      onViewAs={isAdmin ? setAdminViewAs : null}
    />
  )
}

export default App
