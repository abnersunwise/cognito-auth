import React, { useState } from 'react'
import { Logo, Card, Field, Input, Button, Alert, LinkButton, BackButton } from './ui'
import { useAuth } from '../hooks/useAuth'
import awsConfig from '../aws-config'

function signInWithGoogle() {
  const domain = awsConfig.Auth.Cognito.hostedUIDomain
  const clientId = awsConfig.Auth.Cognito.userPoolClientId
  const redirectUri = window.location.origin

  if (!domain) {
    console.error('[Google] Missing VITE_COGNITO_HOSTED_UI_DOMAIN in env config')
    return
  }

  const url = `https://${domain}/oauth2/authorize?identity_provider=Google&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=CODE&client_id=${clientId}&scope=openid+profile+email`
  window.location.href = url
}

export default function RegisterForm({ onBack, onSuccess }) {
  const { register, confirmRegister, resendRegisterCode, loading, error, clearError } = useAuth()
  const [step, setStep] = useState('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(null)

  const normalizedEmail = email.trim().toLowerCase()
  const isConfirmStep = step === 'confirm'

  const handleRegister = async () => {
    clearError()
    setNotice(null)

    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) return
    if (!password || password.length < 8) return
    if (password !== confirmPassword) {
      setNotice('La confirmacion de contraseña no coincide.')
      return
    }

    const result = await register(normalizedEmail, password)
    if (result.success) {
      setStep('confirm')
      setNotice('Te enviamos un codigo al correo. Ingresalo para activar tu cuenta.')
    }
  }

  const handleConfirm = async () => {
    clearError()
    setNotice(null)

    if (!normalizedEmail || code.trim().length < 6) return

    const result = await confirmRegister(normalizedEmail, code)
    if (result.success) {
      setNotice('Cuenta verificada. Ya puedes iniciar sesion.')
      onSuccess?.()
    }
  }

  const handleResend = async () => {
    clearError()
    setNotice(null)

    const result = await resendRegisterCode(normalizedEmail)
    if (result.success) {
      setNotice('Te reenviamos el codigo de verificacion.')
    }
  }

  return (
    <Card>
      <Logo />
      <BackButton onClick={onBack} label="← Volver al login" />
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Crear cuenta</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        {isConfirmStep
          ? 'Confirma tu correo para activar tu cuenta.'
          : 'Empieza con Google o, si prefieres, crea tu cuenta con correo.'}
      </p>

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type="info">{notice}</Alert>}

      {!isConfirmStep && (
        <>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={loading}
            style={{
              width: '100%',
              height: 40,
              marginBottom: 12,
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 1rem' }}>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-hint)' }}>o crea tu cuenta con correo</span>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--color-border)' }} />
          </div>
        </>
      )}

      <Field label="Correo electronico">
        <Input
          type="email"
          placeholder="usuario@ejemplo.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          disabled={step === 'confirm'}
        />
      </Field>

      {step === 'register' ? (
        <>
          <Field label="Contraseña">
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Confirmar contraseña">
            <Input
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Button loading={loading} onClick={handleRegister}>Crear cuenta</Button>
        </>
      ) : (
        <>
          <Field label="Codigo de verificacion">
            <Input
              type="text"
              placeholder="123456"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
            />
          </Field>

          <Button loading={loading} onClick={handleConfirm}>Verificar cuenta</Button>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>
            ¿No recibiste el codigo?{' '}
            <LinkButton onClick={handleResend}>Reenviar</LinkButton>
          </p>
        </>
      )}
    </Card>
  )
}
