// src/App.jsx
import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import LoginForm from './components/LoginForm'
import ResetPasswordFlow from './components/ResetPasswordFlow'
import RegisterForm from './components/RegisterForm'
import { useAuth } from './hooks/useAuth'
import { Alert, Field, Input } from './components/ui'

const VIEWS = { LOGIN: 'login', RESET: 'reset', REGISTER: 'register', AUTHENTICATED: 'authenticated' }

function getViewFromPath(pathname) {
  if (pathname === '/register') return VIEWS.REGISTER
  if (pathname === '/reset') return VIEWS.RESET
  return VIEWS.LOGIN
}

export default function App() {
  const [view, setView] = useState(getViewFromPath(window.location.pathname))
  const [user, setUser] = useState(null)
  const [initializingSession, setInitializingSession] = useState(true)
  const { logout, getUser } = useAuth()

  const navigate = (nextView) => {
    setView(nextView)

    const nextPath =
      nextView === VIEWS.REGISTER ? '/register'
        : nextView === VIEWS.RESET ? '/reset'
        : '/'

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
  }

  useEffect(() => {
    const restoreSession = async () => {
      const currentUser = await getUser()

      if (currentUser) {
        setUser(currentUser)
        setView(VIEWS.AUTHENTICATED)
      }

      setInitializingSession(false)
    }

    restoreSession()

    const onPopState = () => {
      setView(getViewFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleLogout = async () => {
    await logout()
    setUser(null)
    navigate(VIEWS.LOGIN)
  }

  const displayName =
    user?.signInDetails?.loginId ||
    user?.username ||
    user?.userId ||
    'Usuario autenticado'

  if (initializingSession) {
    return (
      <div style={{
        background: 'var(--color-surface)', border: '0.5px solid var(--color-border)',
        borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 380, textAlign: 'center',
      }}>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
          Verificando sesión...
        </p>
      </div>
    )
  }

  if (view === VIEWS.AUTHENTICATED) {
    return (
      <div style={{
        background: 'var(--color-surface)', border: '0.5px solid var(--color-border)',
        borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 380, textAlign: 'center',
      }}>
        <div style={{
          width: 52, height: 52, background: '#E6F1FB', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="#185FA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Sesión iniciada</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          Autenticación exitosa con Cognito
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Usuario: <strong>{displayName}</strong>
        </p>
        <SecurityPanel accountName={displayName} />
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0.5rem 0 0.35rem' }}>
          Sesión actual
        </p>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', height: 34, background: 'transparent', color: 'var(--color-text-muted)', border: '0.5px solid var(--color-border)',
            borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Cerrar sesión de esta cuenta
        </button>
      </div>
    )
  }

  if (view === VIEWS.RESET) return (
    <ResetPasswordFlow
      onBack={() => navigate(VIEWS.LOGIN)}
      onSuccess={() => navigate(VIEWS.LOGIN)}
    />
  )

  if (view === VIEWS.REGISTER) return (
    <RegisterForm
      onBack={() => navigate(VIEWS.LOGIN)}
      onSuccess={() => navigate(VIEWS.LOGIN)}
    />
  )

  return (
    <LoginForm
      onResetPassword={() => navigate(VIEWS.RESET)}
      onRegister={() => navigate(VIEWS.REGISTER)}
      onSuccess={async () => {
        const currentUser = await getUser()
        setUser(currentUser)
        setView(VIEWS.AUTHENTICATED)
      }}
    />
  )
}

function SecurityPanel({ accountName }) {
  const {
    getMfaPreference,
    beginTotpSetup,
    enableTotp,
    disableTotp,
    toggleEmailMfa,
    setPreferredMfaMethod,
    getDeviceRememberedStatus,
    forgetCurrentDevice,
    forgetDeviceById,
    getDevices,
  } = useAuth()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [isTotpEnabled, setIsTotpEnabled] = useState(false)
  const [isEmailEnabled, setIsEmailEnabled] = useState(false)
  const [preferredMfa, setPreferredMfa] = useState(null)
  const [setupData, setSetupData] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [isDeviceRemembered, setIsDeviceRemembered] = useState(false)
  const [devices, setDevices] = useState([])
  const [showDevices, setShowDevices] = useState(false)
  const bothMethodsEnabled = isEmailEnabled && isTotpEnabled

  useEffect(() => {
    const loadPreference = async () => {
      const result = await getMfaPreference()

      if (result.success) {
        const enabled = result.preference?.enabled || []
        setIsEmailEnabled(enabled.includes('EMAIL'))
        setIsTotpEnabled(enabled.includes('TOTP'))
        setPreferredMfa(result.preference?.preferred || null)
      } else {
        setError(result.error)
      }

      // Check if device is remembered and fetch device list
      const [deviceStatus, devicesResult] = await Promise.all([
        getDeviceRememberedStatus(),
        getDevices(),
      ])
      setIsDeviceRemembered(deviceStatus.isRemembered)
      setDevices(devicesResult.devices)

      setLoading(false)
    }

    loadPreference()
  }, [])

  const handleStartSetup = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)

    const result = await beginTotpSetup(accountName)
    if (result.success) {
      setSetupData(result)
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  const handleEnable = async () => {
    if (code.trim().length < 6) {
      setError('Ingresa el código de 6 dígitos que muestra tu app autenticadora.')
      return
    }

    setBusy(true)
    setError(null)

    const result = await enableTotp(code)
    if (result.success) {
      const emailWasEnabled = isEmailEnabled
      setIsTotpEnabled(true)
      setSetupData(null)
      setCode('')

      if (!emailWasEnabled) {
        await handleSetPreferredMfa('TOTP', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: false, totpEnabled: true } })
        setMessage('Verificación en dos pasos activada correctamente.')
      } else {
        const confirmed = window.confirm('Ya tienes otro método activo. ¿Quieres usar la app autenticadora como método principal?')
        if (confirmed) {
          await handleSetPreferredMfa('TOTP', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: true, totpEnabled: true } })
          setMessage('App autenticadora activada y configurada como método principal.')
        } else {
          setMessage('Verificación en dos pasos activada correctamente.')
        }
      }
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  const handleDisable = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)

    const result = await disableTotp()
    if (result.success) {
      const emailStillEnabled = isEmailEnabled
      const wasPreferred = preferredMfa === 'TOTP'
      setIsTotpEnabled(false)
      setSetupData(null)
      setCode('')

      if (wasPreferred && emailStillEnabled) {
        await handleSetPreferredMfa('EMAIL', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: true, totpEnabled: false } })
        setMessage('App autenticadora desactivada. Correo quedó como método principal.')
      } else {
        setPreferredMfa(prev => (prev === 'TOTP' ? null : prev))
        setMessage('Verificación en dos pasos desactivada.')
      }
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  const handleToggleEmailMfa = async (enabled = !isEmailEnabled) => {
    setBusy(true)
    setError(null)
    setMessage(null)

    const result = await toggleEmailMfa(enabled)

    if (result.success) {
      const totpWasEnabled = isTotpEnabled
      const wasPreferred = preferredMfa === 'EMAIL'
      setIsEmailEnabled(enabled)

      if (enabled) {
        if (!totpWasEnabled) {
          await handleSetPreferredMfa('EMAIL', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: true, totpEnabled: false } })
          setMessage('Verificación por correo activada.')
        } else {
          const confirmed = window.confirm('Ya tienes otro método activo. ¿Quieres usar correo como método principal?')
          if (confirmed) {
            await handleSetPreferredMfa('EMAIL', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: true, totpEnabled: true } })
            setMessage('Correo activado y configurado como método principal.')
          } else {
            setMessage('Verificación por correo activada.')
          }
        }
      } else if (wasPreferred && totpWasEnabled) {
        await handleSetPreferredMfa('TOTP', { suppressBusy: true, suppressMessage: true, nextState: { emailEnabled: false, totpEnabled: true } })
        setMessage('Verificación por correo desactivada. App autenticadora quedó como método principal.')
      } else {
        if (!enabled && preferredMfa === 'EMAIL') setPreferredMfa(null)
        setMessage('Verificación por correo desactivada.')
      }
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  const handleSetPreferredMfa = async (method, options = {}) => {
    const {
      suppressBusy = false,
      suppressMessage = false,
      nextState,
    } = options

    if (!suppressBusy) setBusy(true)
    setError(null)
    if (!suppressMessage) setMessage(null)

    const enabledState = nextState || {
      totpEnabled: isTotpEnabled,
      emailEnabled: isEmailEnabled,
    }

    const result = await setPreferredMfaMethod(method, {
      totpEnabled: enabledState.totpEnabled,
      emailEnabled: enabledState.emailEnabled,
    })

    if (result.success) {
      setPreferredMfa(method)
      if (!suppressMessage) {
        setMessage(method === 'EMAIL' ? 'Correo configurado como método principal.' : 'App autenticadora configurada como método principal.')
      }
    } else {
      setError(result.error)
    }

    if (!suppressBusy) setBusy(false)

    return result
  }

  const handleRowSetPreferred = async (method) => {
    if (!bothMethodsEnabled || preferredMfa === method || busy) return

    const methodLabel = method === 'EMAIL' ? 'correo' : 'app autenticadora'
    const confirmed = window.confirm(`¿Quieres establecer ${methodLabel} como método principal?`)
    if (!confirmed) return

    await handleSetPreferredMfa(method)
  }

  return (
    <div style={{
      textAlign: 'left', borderTop: '0.5px solid var(--color-border)', marginTop: '1.5rem',
      paddingTop: '1.25rem', marginBottom: '1rem',
    }}>
      <h3 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 0.35rem' }}>Verificación en dos pasos</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
        Configura verificación por app autenticadora o por correo y elige tu método principal.
      </p>

      {isDeviceRemembered && (
        <div style={{
          marginBottom: '1rem',
          padding: '12px 12px',
          background: '#C8E6C9',
          border: '0.5px solid #66BB6A',
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <p style={{ fontSize: 13, margin: 0, color: '#2E7D32', fontWeight: 500 }}>
            ✓ Dispositivo recordado - MFA omitido
          </p>
          <button
            onClick={async () => {
              setBusy(true)
              const result = await forgetCurrentDevice()
              setBusy(false)
              if (result.success) {
                setIsDeviceRemembered(false)
                setMessage('Dispositivo olvidado. MFA se requerirá en el próximo acceso.')
              } else {
                setError(result.error)
              }
            }}
            disabled={busy}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: '#2E7D32',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {busy ? 'Olvidando...' : 'Olvidar dispositivo'}
          </button>
        </div>
      )}

      {loading && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
          Cargando configuración...
        </p>
      )}

      {!loading && error && <Alert type="error">{error}</Alert>}
      {!loading && message && <Alert type="success">{message}</Alert>}

      {!loading && (
        <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '8px 10px',
            cursor: bothMethodsEnabled && preferredMfa !== 'EMAIL' ? 'pointer' : 'default',
          }}
          title={bothMethodsEnabled && preferredMfa !== 'EMAIL' ? 'Haz click para marcar Correo como método principal' : undefined}
          onClick={() => handleRowSetPreferred('EMAIL')}>
            <div>
              <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>Correo</p>
              <p style={{ fontSize: 12, margin: 0, color: 'var(--color-text-muted)' }}>Código enviado al email registrado</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 999,
                background: isEmailEnabled ? 'var(--color-success-bg)' : '#F3F3F1',
                color: isEmailEnabled ? 'var(--color-success-text)' : '#6D6B63',
              }}>
                {isEmailEnabled ? 'Activado' : 'Desactivado'}
              </span>
              {preferredMfa === 'EMAIL' && (
                <span style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: 999,
                  background: 'var(--color-info-bg)', color: 'var(--color-info-text)',
                }}>
                  Principal
                </span>
              )}
              {isEmailEnabled ? (
                <IconActionButton
                  title="Desactivar verificación por correo"
                  onClick={() => handleToggleEmailMfa(false)}
                  disabled={busy}
                  variant="danger"
                >
                  ×
                </IconActionButton>
              ) : (
                <IconActionButton
                  title="Activar verificación por correo"
                  onClick={() => handleToggleEmailMfa(true)}
                  disabled={busy}
                  variant="success"
                >
                  +
                </IconActionButton>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '8px 10px',
            cursor: bothMethodsEnabled && preferredMfa !== 'TOTP' ? 'pointer' : 'default',
          }}
          title={bothMethodsEnabled && preferredMfa !== 'TOTP' ? 'Haz click para marcar App autenticadora como método principal' : undefined}
          onClick={() => handleRowSetPreferred('TOTP')}>
            <div>
              <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>App autenticadora</p>
              <p style={{ fontSize: 12, margin: 0, color: 'var(--color-text-muted)' }}>Google Authenticator, Authy o 1Password</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 999,
                background: isTotpEnabled ? 'var(--color-success-bg)' : '#F3F3F1',
                color: isTotpEnabled ? 'var(--color-success-text)' : '#6D6B63',
              }}>
                {isTotpEnabled ? 'Activada' : 'Desactivada'}
              </span>
              {preferredMfa === 'TOTP' && (
                <span style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: 999,
                  background: 'var(--color-info-bg)', color: 'var(--color-info-text)',
                }}>
                  Principal
                </span>
              )}
              {isTotpEnabled ? (
                <IconActionButton
                  title="Desactivar app autenticadora"
                  onClick={handleDisable}
                  disabled={busy}
                  variant="danger"
                >
                  ×
                </IconActionButton>
              ) : (
                <IconActionButton
                  title="Activar app autenticadora"
                  onClick={handleStartSetup}
                  disabled={busy}
                  variant="success"
                >
                  +
                </IconActionButton>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && devices.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <button
            onClick={() => setShowDevices(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer',
              marginBottom: showDevices ? 8 : 0, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ fontSize: 11 }}>{showDevices ? '▲' : '▼'}</span>
            Dispositivos con sesión ({devices.length})
          </button>
          {showDevices && (
            <div style={{ display: 'grid', gap: 6 }}>
              {devices.map((device) => {
                const date = device.lastModifiedDate
                  ? new Date(device.lastModifiedDate).toLocaleDateString('es-MX', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })
                  : null
                return (
                  <div key={device.id} style={{
                    padding: '8px 10px', borderRadius: 8,
                    border: '0.5px solid var(--color-border)',
                    background: 'var(--color-surface-raised, var(--color-surface))',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    overflow: 'hidden',
                  }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <p style={{ fontSize: 12, margin: 0, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {device.name || 'Dispositivo desconocido'}
                      </p>
                      {date && (
                        <p style={{ fontSize: 11, margin: '2px 0 0', color: 'var(--color-text-muted)' }}>
                          Último acceso: {date}
                        </p>
                      )}
                    </div>
                    <button
                      title="Eliminar dispositivo"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const result = await forgetDeviceById(device.id)
                        setBusy(false)
                        if (result.success) {
                          setDevices(prev => prev.filter(d => d.id !== device.id))
                          setMessage('Dispositivo eliminado.')
                        } else {
                          setError(result.error)
                        }
                      }}
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: '0.5px solid var(--color-border)',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 11,
                        color: 'var(--color-text-muted)',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!loading && setupData && (
        <div>
          <Alert type="info">
            Escanea el código QR con tu app autenticadora y luego ingresa el código que genere para confirmar.
          </Alert>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0', padding: '1rem', background: '#fff', borderRadius: 8, border: '0.5px solid var(--color-border)' }}>
            <QRCodeSVG value={setupData.setupUri} size={180} />
          </div>
          <Field label="¿No puedes escanear? Copia la clave manualmente" hint="útil en Google Authenticator, Authy, 1Password o similar.">
            <Input readOnly value={setupData.sharedSecret} />
          </Field>
          <Field label="Código de tu app autenticadora">
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          <button
            onClick={handleEnable}
            disabled={busy}
            style={{
              width: '100%', height: 38, background: '#0F766E', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer',
              marginBottom: 8,
            }}
          >
            {busy ? 'Verificando...' : 'Confirmar y activar'}
          </button>
          <button
            onClick={() => {
              setSetupData(null)
              setCode('')
              setError(null)
              setMessage(null)
            }}
            disabled={busy}
            style={{
              width: '100%', height: 38, background: 'transparent', color: '#185FA5', border: '0.5px solid #185FA5',
              borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

function IconActionButton({ title, onClick, disabled, children, variant = 'neutral' }) {
  const palette = {
    neutral: { color: 'var(--color-text-muted)', border: 'var(--color-border)' },
    success: { color: '#0F766E', border: '#7AC7BE' },
    danger: { color: '#A53A18', border: '#E5B2A2' },
  }[variant]

  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      disabled={disabled}
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        border: `0.5px solid ${palette.border}`,
        background: 'var(--color-surface)',
        color: palette.color,
        fontSize: 14,
        lineHeight: '24px',
        textAlign: 'center',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}
