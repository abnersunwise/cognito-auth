// src/components/ResetPasswordFlow.jsx
// Flujo completo de reset de contraseña en 3 pasos:
//   1. RequestStep  — captura de email
//   2. CodeStep     — verificación OTP 6 dígitos
//   3. NewPassStep  — nueva contraseña
//   4. DoneStep     — confirmación

import React, { useState } from 'react'
import {
  Logo, Card, Field, Input, Button, Alert, BackButton, LinkButton,
  PasswordStrength, OtpInput,
} from './ui'
import { useAuth } from '../hooks/useAuth'

const STEPS = { REQUEST: 'request', CODE: 'code', NEW_PASS: 'new_pass', DONE: 'done' }

export default function ResetPasswordFlow({ onBack, onSuccess }) {
  const { requestPasswordReset, confirmPasswordReset, loading, error, clearError } = useAuth()
  const [step, setStep] = useState(STEPS.REQUEST)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [localError, setLocalError] = useState(null)
  const [resendInfo, setResendInfo] = useState(null)

  const displayError = localError || error

  const handleRequest = async () => {
    setLocalError(null)
    clearError()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) { setLocalError('Ingresa tu correo electrónico'); return }
    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) { setLocalError('Correo electrónico inválido'); return }
    const result = await requestPasswordReset(normalizedEmail)
    if (result.success) setStep(STEPS.CODE)
  }

  const handleResend = async () => {
    setResendInfo(null)
    const normalizedEmail = email.trim().toLowerCase()
    const result = await requestPasswordReset(normalizedEmail)
    if (result.success) setResendInfo(`Código reenviado a ${normalizedEmail}`)
  }

  const handleVerify = () => {
    setLocalError(null)
    if (otp.length < 6) { setLocalError('Ingresa los 6 dígitos del código'); return }
    // El código se valida en Cognito al enviar la nueva contraseña.
    // Aquí simplemente avanzamos al siguiente paso.
    setStep(STEPS.NEW_PASS)
  }

  const handleChangePass = async () => {
    setLocalError(null)
    clearError()
    if (newPass.length < 8) { setLocalError('La contraseña debe tener al menos 8 caracteres'); return }
    if (newPass !== confirmPass) { setLocalError('Las contraseñas no coinciden'); return }
    const result = await confirmPasswordReset(email.trim().toLowerCase(), otp, newPass)
    if (result.success) setStep(STEPS.DONE)
  }

  if (step === STEPS.REQUEST) return (
    <Card>
      <Logo />
      <BackButton onClick={onBack} />
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Recuperar contraseña</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Te enviaremos un código de verificación
      </p>
      {displayError && <Alert type="error">{displayError}</Alert>}
      <Field label="Correo electrónico">
        <Input
          type="email"
          placeholder="usuario@ejemplo.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRequest()}
          autoComplete="email"
        />
      </Field>
      <Button loading={loading} onClick={handleRequest}>Enviar código</Button>
    </Card>
  )

  if (step === STEPS.CODE) return (
    <Card>
      <Logo />
      <BackButton onClick={() => setStep(STEPS.REQUEST)} />
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Verificar código</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Ingresa el código de 6 dígitos enviado a <strong>{email}</strong>
      </p>
      {displayError && <Alert type="error">{displayError}</Alert>}
      {resendInfo && <Alert type="info">{resendInfo}</Alert>}
      <OtpInput value={otp} onChange={setOtp} />
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        ¿No llegó?{' '}
        <LinkButton onClick={handleResend} disabled={loading}>Reenviar código</LinkButton>
      </p>
      <Button loading={loading} onClick={handleVerify}>Verificar</Button>
    </Card>
  )

  if (step === STEPS.NEW_PASS) return (
    <Card>
      <Logo />
      <BackButton onClick={() => setStep(STEPS.CODE)} />
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Nueva contraseña</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Debe tener al menos 8 caracteres, una mayúscula y un número
      </p>
      {displayError && <Alert type="error">{displayError}</Alert>}
      <Field label="Nueva contraseña">
        <Input
          type="password"
          placeholder="••••••••"
          value={newPass}
          onChange={e => setNewPass(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordStrength password={newPass} />
      </Field>
      <Field label="Confirmar contraseña">
        <Input
          type="password"
          placeholder="••••••••"
          value={confirmPass}
          onChange={e => setConfirmPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleChangePass()}
          autoComplete="new-password"
        />
      </Field>
      <Button loading={loading} onClick={handleChangePass}>Cambiar contraseña</Button>
    </Card>
  )

  if (step === STEPS.DONE) return (
    <Card>
      <Logo />
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          width: 52, height: 52, background: 'var(--color-success-bg)', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="#3B6D11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>¡Contraseña actualizada!</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          Ya puedes iniciar sesión con tu nueva contraseña
        </p>
        <Button onClick={() => onSuccess?.()}>Iniciar sesión</Button>
      </div>
    </Card>
  )

  return null
}
