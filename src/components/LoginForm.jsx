// src/components/LoginForm.jsx
import React, { useState, useEffect } from 'react'
import { Logo, Card, Field, Input, Button, Alert, LinkButton, BackButton, OtpInput } from './ui'
import { signInWithRedirect } from 'aws-amplify/auth'
import { useAuth } from '../hooks/useAuth'

// Redirige a Hosted UI de Cognito para Google
async function signInWithGoogle(setGoogleLoading) {
  try {
    setGoogleLoading(true)
    await signInWithRedirect({ provider: 'Google' })
  } catch (err) {
    console.error('[Google] Error starting Hosted UI redirect:', err)
    setGoogleLoading(false)
  }
}
import { hasDeviceBackup } from '../hooks/useAuth'

export default function LoginForm({ onResetPassword, onRegister, onSuccess }) {
  const {
    login,
    getTokens,
    confirmMfaChallenge,
    rememberCurrentDevice,
    loading,
    error,
    clearError,
  } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [emailSetupValue, setEmailSetupValue] = useState('')
  const [mfaStep, setMfaStep] = useState(null)
  const [deviceAlreadyKnown, setDeviceAlreadyKnown] = useState(false)
  const [rememberThisDevice, setRememberThisDevice] = useState(true)
  const [rememberedDeviceBypassUnavailable, setRememberedDeviceBypassUnavailable] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Limpiar error cuando el componente se monta (después de logout)
  useEffect(() => {
    clearError()
  }, [])

  // Check if this user has a backed-up device key (was previously remembered)
  useEffect(() => {
    const normalized = username.trim().toLowerCase()
    if (normalized) {
      setDeviceAlreadyKnown(hasDeviceBackup(normalized))
    } else {
      setDeviceAlreadyKnown(false)
    }
  }, [username])

  const finishLogin = async (result) => {
    const tokens = await getTokens()
    console.log('Cognito Access Token:', tokens.accessToken)
    console.log('Cognito Refresh Token:', tokens.refreshToken)
    console.log('Cognito ID Token:', tokens.idToken)
    onSuccess?.(result)
  }

  const handleSubmit = async () => {
    if (!username) return
    if (!password) return
    setRememberedDeviceBypassUnavailable(false)
    const result = await login(username, password, 'email')

    if (result.requiresMfa) {
      setRememberedDeviceBypassUnavailable(Boolean(result.rememberedButStillMfa))
      setOtp('')
      setMfaStep(result.nextStep)
      return
    }

    if (result.success) {
      await finishLogin(result)
    }
  }

  const handleConfirmMfa = async () => {
    if (otp.length < 6) return

    const result = await confirmMfaChallenge(otp)
    if (result.success) {
      setMfaStep(null)
      if (rememberThisDevice) {
        const remembered = await rememberCurrentDevice()
        if (!remembered?.success) return
      }
      await finishLogin(result)
    }
  }

  const handleSelectMfaMethod = async (method) => {
    const result = await confirmMfaChallenge(method)
    if (result.success) {
      setMfaStep(null)
      await finishLogin(result)
      return
    }

    if (result?.result?.nextStep) {
      setMfaStep(result.result.nextStep)
      setOtp('')
    }
  }

  const handleBackToLogin = () => {
    setOtp('')
    setEmailSetupValue('')
    setMfaStep(null)
    setRememberedDeviceBypassUnavailable(false)
    clearError()
  }

  const handleEmailSetup = async () => {
    const email = emailSetupValue.trim().toLowerCase()
    if (!/\S+@\S+\.\S+/.test(email)) return

    const result = await confirmMfaChallenge(email)
    if (result.success) {
      setMfaStep(null)
      if (rememberThisDevice) {
        const remembered = await rememberCurrentDevice()
        if (!remembered?.success) return
      }
      await finishLogin(result)
      return
    }

    if (result?.result?.nextStep) {
      setMfaStep(result.result.nextStep)
      setOtp('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (mfaStep) {
        handleConfirmMfa()
        return
      }

      handleSubmit()
    }
  }

  if (mfaStep) {
    const step = mfaStep?.signInStep
    const isTotp = step === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE'
    const isEmail = step === 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE'
    const isEmailSetup = step === 'CONTINUE_SIGN_IN_WITH_EMAIL_SETUP'
    const isMethodSelection =
      step === 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION' ||
      step === 'CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION'

    const title = isMethodSelection
      ? 'Selecciona un método'
      : isEmailSetup
        ? 'Configurar correo de verificación'
        : (isTotp ? 'Verificación en dos pasos' : 'Código de verificación')
    const destination = mfaStep?.codeDeliveryDetails?.destination
    const description = isMethodSelection
      ? 'Elige si quieres recibir el código por correo o usar tu app autenticadora.'
      : isEmailSetup
        ? 'Ingresa el correo donde quieres recibir códigos de verificación.'
      : isTotp
      ? 'Ingresa el código de 6 dígitos de tu app autenticadora.'
      : `Ingresa el código de 6 dígitos enviado a tu correo${destination ? ` (${destination})` : ''}.`

    const allowedMethods = mfaStep?.allowedMFATypes || ['TOTP', 'EMAIL']

    return (
      <Card>
        <Logo />
        <BackButton onClick={handleBackToLogin} label="← Volver al login" />
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          {description}
        </p>

        {error && <Alert type="error">{error}</Alert>}

        {rememberedDeviceBypassUnavailable && (
          <Alert type="info">
            Este dispositivo est\u00e1 marcado como recordado, pero Cognito sigui\u00f3 solicitando c\u00f3digo por correo.
            Esto suele ocurrir por configuraci\u00f3n/comportamiento del User Pool con EMAIL_OTP.
          </Alert>
        )}

        {isMethodSelection ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {allowedMethods.includes('TOTP') && (
              <button
                onClick={() => handleSelectMfaMethod('TOTP')}
                disabled={loading}
                style={{
                  width: '100%', height: 38, background: '#0F766E', color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Usar app autenticadora
              </button>
            )}
            {allowedMethods.includes('EMAIL') && (
              <button
                onClick={() => handleSelectMfaMethod('EMAIL')}
                disabled={loading}
                style={{
                  width: '100%', height: 38, background: '#185FA5', color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Recibir código por correo
              </button>
            )}
          </div>
        ) : isEmailSetup ? (
          <>
            <Field label="Correo para verificación">
              <Input
                type="email"
                placeholder="usuario@ejemplo.com"
                value={emailSetupValue}
                onChange={e => setEmailSetupValue(e.target.value)}
              />
            </Field>
            <Button loading={loading} onClick={handleEmailSetup}>
              Continuar
            </Button>
          </>
        ) : (
          <>
            <OtpInput value={otp} onChange={setOtp} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 12px' }}>
              <input
                type="checkbox"
                id="rememberThisDeviceInline"
                checked={rememberThisDevice}
                onChange={(e) => setRememberThisDevice(e.target.checked)}
                style={{ cursor: 'pointer', width: 16, height: 16 }}
              />
              <label
                htmlFor="rememberThisDeviceInline"
                style={{ fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}
              >
                Recordar este dispositivo
              </label>
            </div>
            <Button loading={loading} onClick={handleConfirmMfa}>
              Verificar código
            </Button>
          </>
        )}
      </Card>
    )
  }

  return (
    <Card>
      <Logo />
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Iniciar sesión</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Bienvenido de nuevo
      </p>

      {error && <Alert type="error">{error}</Alert>}

      <Field label="Correo electrónico">
        <Input
          type="email"
          placeholder="usuario@ejemplo.com"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="username"
        />
      </Field>

      <Field label="Contraseña">
        <Input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="current-password"
        />
      </Field>

      {deviceAlreadyKnown ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem',
          padding: '8px 10px', borderRadius: 8,
          background: 'var(--color-success-bg)', border: '0.5px solid var(--color-success-border)',
        }}>
          <span style={{ fontSize: 14, color: 'var(--color-success-text)' }}>✓</span>
          <span style={{ fontSize: 13, color: 'var(--color-success-text)', flex: 1 }}>
            Dispositivo reconocido — MFA será omitido
          </span>
          <button
            onClick={() => {
              setDeviceAlreadyKnown(false)
            }}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: 11, color: 'var(--color-success-text)',
              cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Olvidar
          </button>
        </div>
      ) : null}

      <Button loading={loading} onClick={handleSubmit}>
        Entrar
      </Button>

      <button
        type="button"
        onClick={() => signInWithGoogle(setGoogleLoading)}
        disabled={loading || googleLoading}
        style={{
          width: '100%',
          height: 40,
          marginTop: 12,
          borderRadius: 'var(--radius-md)',
          border: '1px solid #d9d9d9',
          background: '#fff',
          color: '#202124',
          fontSize: 14,
          fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12 24 12c3 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.8-3.3-11.4-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.3 5.2C37.1 39.1 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/>
        </svg>
        Continuar con Google
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '1.25rem 0' }}>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: 12, color: 'var(--color-text-hint)' }}>o</span>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
      </div>

      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
        ¿No tienes cuenta?{' '}
        <LinkButton onClick={onRegister}>Regístrate</LinkButton>
      </p>

      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
        ¿Olvidaste tu contraseña?{' '}
        <LinkButton onClick={onResetPassword}>Recuperar acceso</LinkButton>
      </p>
    </Card>
  )
}
