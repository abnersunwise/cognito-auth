// src/App.jsx
import React, { useEffect, useState } from 'react'
import { fetchUserAttributes } from 'aws-amplify/auth'
import { QRCodeSVG } from 'qrcode.react'
import LoginForm from './components/LoginForm'
import ResetPasswordFlow from './components/ResetPasswordFlow'
import RegisterForm from './components/RegisterForm'
import { getActiveAppClientId, getAvailableAppClients } from './aws-config'
import { useAuth } from './hooks/useAuth'
import { Alert, Field, Input } from './components/ui'

const VIEWS = {
  LOGIN: 'login',
  RESET: 'reset',
  REGISTER: 'register',
  CALLBACK: 'callback',
  LOGOUT: 'logout',
  AUTHENTICATED: 'authenticated',
}

function getViewFromPath(pathname) {
  if (pathname === '/register') return VIEWS.REGISTER
  if (pathname === '/reset') return VIEWS.RESET
  if (pathname === '/callback') return VIEWS.CALLBACK
  if (pathname === '/logout') return VIEWS.LOGOUT
  return VIEWS.LOGIN
}

export default function App() {
  const [view, setView] = useState(getViewFromPath(window.location.pathname))
  const [user, setUser] = useState(null)
  const [displayName, setDisplayName] = useState('Usuario autenticado')
  const [profileImageUrl, setProfileImageUrl] = useState(null)
  const [isFederatedUser, setIsFederatedUser] = useState(null)
  const [callbackDebug, setCallbackDebug] = useState(null)
  const [initializingSession, setInitializingSession] = useState(true)
  const { logout, getUser, getTokens, clearError } = useAuth()
  const SOCIAL_SESSION_WAIT_MS = 3000
  const SOCIAL_SESSION_POLL_MS = 120
  const DEBUG_AUTH = import.meta.env.DEV || import.meta.env.VITE_DEBUG_AUTH === 'true'
  const STAFF_WEB_CLIENT_ID = '5pjp5gauclo7ifqv39bc9m93ab'
  const SUNWISE_WEB_CLIENT_ID = '65ru3aghhfs76ib9vj07dbsi8b'
  const activeClientId = getActiveAppClientId()
  const activeClient = getAvailableAppClients().find((client) => client.id === activeClientId)
  const isStaffWebSession = activeClientId === STAFF_WEB_CLIENT_ID

  const debugAuth = (...args) => {
    if (DEBUG_AUTH) console.log(...args)
  }

  const decodeJwtPayload = (token) => {
    if (!token) return null
    try {
      const parts = token.split('.')
      if (parts.length < 2) return null
      const base64Url = parts[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4 || 4)) % 4, '=')
      return JSON.parse(window.atob(padded))
    } catch {
      return null
    }
  }

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const normalizeHostedUiDomain = (value) => String(value || '').replace(/^https?:\/\//, '').replace(/\/$/, '')

  const encodeState = (value) => {
    const json = JSON.stringify(value)
    const base64 = window.btoa(unescape(encodeURIComponent(json)))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const decodeState = (value) => {
    if (!value) return null
    try {
      const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4 || 4)) % 4, '=')
      const json = decodeURIComponent(escape(window.atob(padded)))
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  const generateSupportSessionId = () => {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  }

  const openSunwiseSsoWindow = () => {
    const domain = normalizeHostedUiDomain(import.meta.env.VITE_COGNITO_HOSTED_UI_DOMAIN)
    const redirectUri = import.meta.env.VITE_SSO_SUNWISE_REDIRECT_URI || 'https://portal.stg.sunwise.io/callback'
    const supportSessionId = generateSupportSessionId()
    const state = encodeState({
      supportsessionid: supportSessionId,
      sourceClientId: activeClientId,
      targetClientId: SUNWISE_WEB_CLIENT_ID,
      createdAt: Date.now(),
    })

    const query = new URLSearchParams({
      client_id: SUNWISE_WEB_CLIENT_ID,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: redirectUri,
      prompt: 'none',
      state,
    })

    const authorizeUrl = `https://${domain}/oauth2/authorize?${query.toString()}`
    console.log('[SSO] Opening silent SSO window for sunwise-web:', authorizeUrl)
    console.log('[SSO] redirect_uri used for sunwise-web:', redirectUri)
    console.log('[SSO] supportsessionid:', supportSessionId)
    window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
  }

  const extractPictureFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null
    if (payload.picture) return payload.picture
    if (payload['custom:picture']) return payload['custom:picture']

    const dynamicPictureKey = Object.keys(payload).find((key) => {
      const normalized = key.toLowerCase()
      return normalized.includes('picture') || normalized.includes('photo') || normalized.includes('avatar')
    })

    return dynamicPictureKey ? payload[dynamicPictureKey] : null
  }

  const isFederatedFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return false

    if (payload.identities) return true

    const cognitoUsername = payload['cognito:username']
    if (typeof cognitoUsername === 'string' && cognitoUsername.toLowerCase().startsWith('google_')) {
      return true
    }

    return false
  }

  const getIdTokenPayloadWithRetry = async () => {
    // En OAuth federado, el token puede tardar un instante en quedar disponible.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const tokens = await getTokens()
        const idTokenPayload = decodeJwtPayload(tokens.idToken)
        if (idTokenPayload) return idTokenPayload
      } catch {
        // Reintentar
      }

      if (attempt < 3) await wait(150)
    }

    return null
  }

  const getUserPresentationData = async (currentUser) => {
    if (!currentUser) {
      return {
        name: 'Usuario autenticado',
        picture: null,
        federated: false,
      }
    }

    const fallbackName = currentUser.username || currentUser.userId || 'Usuario autenticado'
    const loginId = currentUser.signInDetails?.loginId

    const idTokenPayload = await getIdTokenPayloadWithRetry()
    const emailFromToken = idTokenPayload?.email || null
    const idTokenPicture = extractPictureFromPayload(idTokenPayload)
    let picture = idTokenPicture
    let pictureSource = idTokenPicture ? 'id_token' : 'none'
    let federated = isFederatedFromPayload(idTokenPayload)

    debugAuth('[OAuth] idTokenPayload loaded?', Boolean(idTokenPayload))
    debugAuth('[OAuth] email claim:', emailFromToken || '(none)')
    debugAuth('[OAuth] picture claim present in id_token?', Boolean(idTokenPicture))
    debugAuth('[OAuth] federated claim detected?', federated)

    // Si falta picture en el id_token, intentar atributos una sola vez.
    if (!picture) {
      try {
        const attributes = await fetchUserAttributes()
        picture = extractPictureFromPayload(attributes) || null
        if (picture) pictureSource = 'attributes'
        debugAuth('[OAuth] picture from user attributes?', Boolean(picture))
      } catch {
        // Ignorar: dejamos fallback visual
        debugAuth('[OAuth] fetchUserAttributes failed while resolving picture')
      }
    }

    // Si aún no hay picture, intentar Google API si es usuario federado.
    if (!picture && federated) {
      const googlePicture = await fetchPictureFromGoogleAPI()
      if (googlePicture) {
        picture = googlePicture
        pictureSource = 'google_api'
      }
    }

    const username = currentUser.username || currentUser.userId || ''
    if (!federated) {
      federated = typeof username === 'string' && username.toLowerCase().startsWith('google_')
    }

    return {
      name: loginId || emailFromToken || fallbackName,
      picture,
      pictureSource,
      federated,
    }
  }

  const logAuthTokens = async (label) => {
    try {
      const tokens = await getTokens()
      const idTokenPayload = decodeJwtPayload(tokens.idToken)
      const selectedClientId = getActiveAppClientId()
      const selectedClient = getAvailableAppClients().find((client) => client.id === selectedClientId)
      const tokenClientId = idTokenPayload?.aud || '(not available)'
      const groups = idTokenPayload?.['cognito:groups'] || []

      console.log('[Auth] App Client activo (selector):', selectedClient?.label || selectedClientId, selectedClientId)
      console.log('[Auth] App Client en ID token (aud):', tokenClientId)
      console.log('[Auth] Grupos del usuario (cognito:groups):', Array.isArray(groups) ? groups : [groups])

      debugAuth(`[OAuth] ${label} Access Token:`, tokens.accessToken || '(not available)')
      debugAuth(`[OAuth] ${label} Refresh Token:`, tokens.refreshToken || '(not available)')
      debugAuth(`[OAuth] ${label} ID Token:`, tokens.idToken || '(not available)')
      debugAuth(`[OAuth] ${label} ID Token claims:`, idTokenPayload || '(could not decode payload)')
    } catch (error) {
      debugAuth(`[OAuth] ${label} token logging failed:`, error?.message || error)
    }
  }

  const fetchPictureFromGoogleAPI = async () => {
    try {
      const tokens = await getTokens()
      if (!tokens.accessToken) {
        debugAuth('[OAuth] No access token available for Google API call')
        return null
      }

      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      if (!response.ok) {
        debugAuth('[OAuth] Google API userinfo request failed:', response.status, response.statusText)
        return null
      }

      const userData = await response.json()
      const googlePicture = userData?.picture || null
      debugAuth('[OAuth] picture from Google API userinfo:', Boolean(googlePicture), googlePicture || '(none)')
      return googlePicture
    } catch (error) {
      debugAuth('[OAuth] fetchPictureFromGoogleAPI error:', error?.message || error)
      return null
    }
  }

  const waitForSocialSession = async () => {
    const startedAt = Date.now()

    while (Date.now() - startedAt < SOCIAL_SESSION_WAIT_MS) {
      const currentUser = await getUser()
      debugAuth('[OAuth] polling session user found?', Boolean(currentUser))
      if (currentUser) return currentUser
      await wait(SOCIAL_SESSION_POLL_MS)
    }

    return null
  }

  const navigate = (nextView) => {    setView(nextView)

    const nextPath =
      nextView === VIEWS.REGISTER ? '/register'
        : nextView === VIEWS.RESET ? '/reset'
        : nextView === VIEWS.CALLBACK ? '/callback'
        : nextView === VIEWS.LOGOUT ? '/logout'
        : '/'

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
  }

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const currentUser = await Promise.race([
          getUser(),
          new Promise((resolve) => window.setTimeout(() => resolve(null), 2500)),
        ])

        if (currentUser) {
          setUser(currentUser)
          setView(VIEWS.AUTHENTICATED)
          return currentUser
        }

        setUser(null)
        if (window.location.pathname !== '/register' && window.location.pathname !== '/reset') {
          setView(VIEWS.LOGIN)
        }
        return null
      } finally {
        setInitializingSession(false)
      }
    }

    const isLogoutRoute = window.location.pathname === '/logout'
    const isCallbackRoute = window.location.pathname === '/callback'

    if (isLogoutRoute) {
      setView(VIEWS.LOGOUT)
      console.log('[Logout] User navigated to /logout, logging out...')
      const timer = window.setTimeout(async () => {
        await logout()
        clearError()
        setUser(null)
        window.history.replaceState({}, '', '/')
        setView(VIEWS.LOGIN)
        setInitializingSession(false)
      }, 500)
      return () => window.clearTimeout(timer)
    }

    if (isCallbackRoute) {
      setView(VIEWS.CALLBACK)
      debugAuth('[OAuth callback] entered callback route:', window.location.href)
      const callbackParams = new URLSearchParams(window.location.search)
      const callbackCode = callbackParams.get('code')
      const callbackRawState = callbackParams.get('state')
      const callbackState = decodeState(callbackParams.get('state'))
      if (callbackState?.supportsessionid) {
        console.log('[SSO] supportsessionid (callback):', callbackState.supportsessionid)
      }
      const isSupportCallback = Boolean(callbackState?.supportsessionid)

      if (isSupportCallback) {
        let cancelled = false
        setCallbackDebug({
          loading: true,
          code: callbackCode,
          rawState: callbackRawState,
          decodedState: callbackState,
          tokens: null,
          idTokenPayload: null,
          error: null,
        })

        ;(async () => {
          const socialUser = await waitForSocialSession()

          if (cancelled) return

          if (socialUser) {
            setUser(socialUser)
            clearError()
          } else {
            const currentUser = await Promise.race([
              getUser(),
              new Promise((resolve) => window.setTimeout(() => resolve(null), 2500)),
            ])
            if (currentUser) {
              setUser(currentUser)
            }
          }

          const tokens = await getTokens()
          const idTokenPayload = decodeJwtPayload(tokens.idToken)

          setCallbackDebug({
            loading: false,
            code: callbackCode,
            rawState: callbackRawState,
            decodedState: callbackState,
            tokens,
            idTokenPayload,
            error: null,
          })
          setInitializingSession(false)
        })().catch((error) => {
          if (cancelled) return
          setCallbackDebug({
            loading: false,
            code: callbackCode,
            rawState: callbackRawState,
            decodedState: callbackState,
            tokens: null,
            idTokenPayload: null,
            error: error?.message || 'No se pudo leer la información del callback.',
          })
          setInitializingSession(false)
        })

        return () => {
          cancelled = true
        }
      }

      let cancelled = false
      ;(async () => {
        const socialUser = await waitForSocialSession()

        if (cancelled) return

        if (socialUser) {
          debugAuth('[OAuth callback] social session resolved, setting authenticated view')
          setUser(socialUser)
          setView(VIEWS.AUTHENTICATED)
          setInitializingSession(false)
          clearError()
          await logAuthTokens('Google login')
          window.history.replaceState({}, '', '/')
          return
        }

        debugAuth('[OAuth callback] social session not ready, falling back to restoreSession()')
        const restoredUser = await restoreSession()
        if (restoredUser) {
          await logAuthTokens('Restored session')
        }
      })()

      return () => {
        cancelled = true
      }
    }

    restoreSession()

    const onPopState = () => {
      setView(getViewFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Actualizar displayName cuando cambia el usuario (incluyendo después de Google login)
  useEffect(() => {
    const updateDisplay = async () => {
      setIsFederatedUser(null)
      const presentation = await getUserPresentationData(user)
      setDisplayName(presentation.name)
      setProfileImageUrl(presentation.picture)
      setIsFederatedUser(presentation.federated)
      debugAuth('[OAuth] picture source resolved:', presentation.pictureSource)
    }
    updateDisplay()
  }, [user])


  const handleLogout = async () => {
    await logout()
    setUser(null)
    navigate(VIEWS.LOGIN)
  }

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
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', overflow: 'hidden',
        }}>
          {profileImageUrl ? (
            <img
              src={profileImageUrl}
              alt="Foto de perfil"
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="#185FA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Sesión iniciada</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          Autenticación exitosa con Cognito
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Usuario: <strong>{displayName}</strong>
        </p>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '-0.5rem 0 1rem' }}>
          App Client activo: <strong>{activeClient?.label || activeClientId}</strong>
        </p>
        {profileImageUrl && (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '-0.4rem 0 1rem' }}>
            Foto de perfil: <strong>recibida</strong>
          </p>
        )}
        {isStaffWebSession && (
          <button
            onClick={openSunwiseSsoWindow}
            style={{
              width: '100%', height: 34, background: '#0F766E', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: '0.75rem',
            }}
          >
            Iniciar sesión SSO en sunwise-web
          </button>
        )}
        {isFederatedUser === null ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
            Comprobando configuración de seguridad...
          </p>
        ) : (
          <SecurityPanel accountName={displayName} isFederatedUser={isFederatedUser} />
        )}
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

  if (view === VIEWS.LOGOUT) {
    return (
      <div style={{
        background: 'var(--color-surface)', border: '0.5px solid var(--color-border)',
        borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 380, textAlign: 'center',
      }}>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
          Cerrando sesión...
        </p>
      </div>
    )
  }

  if (view === VIEWS.CALLBACK) {
    if (callbackDebug) {
      return (
        <div style={{
          background: 'var(--color-surface)', border: '0.5px solid var(--color-border)',
          borderRadius: 12, padding: '1.25rem', width: '100%', maxWidth: 640, textAlign: 'left',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 0.35rem' }}>Callback SSO recibido</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
            Vista de diagnóstico para soporte (state + tokens del callback)
          </p>

          {callbackDebug.loading ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Procesando callback y leyendo tokens...
            </p>
          ) : (
            <>
              {callbackDebug.error && <Alert type="error">{callbackDebug.error}</Alert>}
              <Field label="authorization code">
                <Input readOnly value={callbackDebug.code || '(sin code)'} />
              </Field>
              <Field label="supportsessionid (state)">
                <Input readOnly value={callbackDebug.decodedState?.supportsessionid || '(no enviado)'} />
              </Field>

              <Field label="state decodificado">
                <pre style={{
                  margin: 0,
                  padding: '10px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '0.5px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(callbackDebug.decodedState || {}, null, 2)}
                </pre>
              </Field>

              <Field label="tokens (nuevo app client)">
                <pre style={{
                  margin: 0,
                  padding: '10px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '0.5px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(callbackDebug.tokens || {}, null, 2)}
                </pre>
              </Field>

              <Field label="id_token decodificado">
                <pre style={{
                  margin: 0,
                  padding: '10px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '0.5px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(callbackDebug.idTokenPayload || {}, null, 2)}
                </pre>
              </Field>
            </>
          )}
        </div>
      )
    }

    return (
      <div style={{
        background: 'var(--color-surface)', border: '0.5px solid var(--color-border)',
        borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 380, textAlign: 'center',
      }}>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
          Procesando login con Google...
        </p>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0.75rem 0 0' }}>
          Revisa la consola para ver el code y el state que devolvió Cognito.
        </p>
      </div>
    )
  }

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

function SecurityPanel({ accountName, isFederatedUser = false }) {
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
  const [isFederated, setIsFederated] = useState(false)
  const bothMethodsEnabled = isEmailEnabled && isTotpEnabled

  useEffect(() => {
    const loadPreference = async () => {
      if (isFederatedUser) {
        setIsFederated(true)
        setLoading(false)
        return
      }

      const result = await getMfaPreference()
      let shouldLoadDeviceData = true

      if (result.success) {
        const enabled = result.preference?.enabled || []
        setIsEmailEnabled(enabled.includes('EMAIL'))
        setIsTotpEnabled(enabled.includes('TOTP'))
        setPreferredMfa(result.preference?.preferred || null)
      } else {
        // Usuarios federados (Google) no soportan MFA ni dispositivos de la misma manera.
        // Si el error es un 400/NotAuthorized, es un usuario federado — ignorar silenciosamente.
        const isFederatedError =
          result.error?.includes('NotAuthorized') ||
          result.error?.includes('400') ||
          result.error?.includes('Correo') ||
          result.error?.includes('contraseña')
        if (isFederatedError) {
          setIsFederated(true)
          shouldLoadDeviceData = false
        } else {
          setError(result.error)
        }
      }

      if (shouldLoadDeviceData) {
        // Check if device is remembered and fetch device list
        const [deviceStatus, devicesResult] = await Promise.all([
          getDeviceRememberedStatus(),
          getDevices(),
        ])
        setIsDeviceRemembered(deviceStatus.isRemembered)
        setDevices(devicesResult.devices)
      }

      setLoading(false)
    }

    loadPreference()
  }, [isFederatedUser])

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
      {isFederated ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, textAlign: 'center' }}>
          Sesión iniciada con Google
        </p>
      ) : (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 0.35rem' }}>Verificación en dos pasos</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
            Configura verificación por app autenticadora o por correo y elige tu método principal.
          </p>
        </>
      )}

      {!isFederated && isDeviceRemembered && (
        <div style={{
          marginBottom: '1rem', padding: '12px 12px',
          background: '#C8E6C9', border: '0.5px solid #66BB6A', borderRadius: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
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
              fontSize: 12, padding: '6px 12px', background: '#2E7D32', color: '#fff',
              border: 'none', borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500,
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

      {!loading && !isFederated && error && <Alert type="error">{error}</Alert>}
      {!loading && message && <Alert type="success">{message}</Alert>}

      {!loading && !isFederated && (
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
