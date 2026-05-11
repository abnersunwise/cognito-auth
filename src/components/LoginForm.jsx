// src/components/LoginForm.jsx
import React, { useState, useEffect } from 'react'
import { Logo, Card, Field, Input, Button, Alert, LinkButton, BackButton, OtpInput } from './ui'
import { useAuth } from '../hooks/useAuth'
import awsConfig from '../aws-config'
// Redirige a Hosted UI de Cognito para Google
function signInWithGoogle() {
  const domain = awsConfig.Auth.Cognito.hostedUIDomain
  const clientId = awsConfig.Auth.Cognito.userPoolClientId
  const redirectUri = window.location.origin
  const url = `https://${domain}/oauth2/authorize?identity_provider=Google&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=CODE&client_id=${clientId}&scope=openid+profile+email`
  window.location.href = url
}
import { hasDeviceBackup } from '../hooks/useAuth'

export default function LoginForm({ onResetPassword, onSuccess }) {
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

      <Button
        type="button"
        style={{ background: '#fff', color: '#222', border: '1px solid #ccc', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={signInWithGoogle}
        disabled={loading}
      >
        <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" style={{ width: 20, height: 20 }} />
        Iniciar sesión con Google
      </Button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '1.25rem 0' }}>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: 12, color: 'var(--color-text-hint)' }}>o</span>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
      </div>

      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
        ¿No tienes cuenta?{' '}
        <LinkButton onClick={() => window.location.href = '/register'}>Regístrate</LinkButton>
      </p>

      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
        ¿Olvidaste tu contraseña?{' '}
        <LinkButton onClick={onResetPassword}>Recuperar acceso</LinkButton>
      </p>
    </Card>
  )
}
