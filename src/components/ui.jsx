// src/components/ui.jsx
// Componentes reutilizables de la interfaz

import React from 'react'

export const Logo = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
    <div style={{
      width: 32, height: 32, background: '#185FA5', borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    </div>
    <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text)' }}>Mi App</span>
  </div>
)

export const Card = ({ children }) => (
  <div style={{
    background: 'var(--color-surface)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '2rem',
    width: '100%',
    maxWidth: 380,
  }}>
    {children}
  </div>
)

export const Field = ({ label, children, hint }) => (
  <div style={{ marginBottom: '1rem' }}>
    {label && (
      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, letterSpacing: '0.02em' }}>
        {label}
      </label>
    )}
    {children}
    {hint && <p style={{ fontSize: 12, color: 'var(--color-text-hint)', marginTop: 4 }}>{hint}</p>}
  </div>
)

export const Input = React.forwardRef(({ type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    style={{
      width: '100%', height: 38, padding: '0 10px', fontSize: 14,
      border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none',
    }}
    onFocus={e => e.target.style.boxShadow = '0 0 0 3px rgba(24,95,165,0.15)'}
    onBlur={e => e.target.style.boxShadow = 'none'}
    {...props}
  />
))
Input.displayName = 'Input'

export const Button = ({ children, loading, ...props }) => (
  <button
    style={{
      width: '100%', height: 38, background: loading ? 'var(--color-primary-light)' : 'var(--color-primary)',
      color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14,
      fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}
    disabled={loading}
    {...props}
  >
    {loading && <Spinner />}
    {children}
  </button>
)

const Spinner = () => (
  <span style={{
    width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)',
    borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block',
    animation: 'spin 0.6s linear infinite',
  }} />
)

export const Alert = ({ type = 'error', children }) => {
  const styles = {
    error: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', border: 'var(--color-danger-border)' },
    success: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)', border: 'var(--color-success-border)' },
    info: { bg: 'var(--color-info-bg)', color: 'var(--color-info-text)', border: 'var(--color-info-border)' },
  }[type]
  return (
    <div style={{
      fontSize: 13, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: '1rem',
      background: styles.bg, color: styles.color, border: `0.5px solid ${styles.border}`,
    }}>
      {children}
    </div>
  )
}

export const BackButton = ({ onClick, label = '← Volver' }) => (
  <button onClick={onClick} style={{
    background: 'none', border: 'none', fontSize: 13, color: 'var(--color-text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, padding: 0,
  }}>
    {label}
  </button>
)

export const LinkButton = ({ children, ...props }) => (
  <button style={{
    background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer',
    fontSize: 13, textDecoration: 'underline', textUnderlineOffset: 2, padding: 0,
  }} {...props}>
    {children}
  </button>
)

export const TabRow = ({ tabs, active, onChange }) => (
  <div style={{
    display: 'flex', marginBottom: '1.5rem',
    border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
  }}>
    {tabs.map(tab => (
      <button key={tab.value} onClick={() => onChange(tab.value)} style={{
        flex: 1, height: 34, background: active === tab.value ? 'rgba(0,0,0,0.05)' : 'none',
        border: 'none', fontSize: 13, cursor: 'pointer', color: 'var(--color-text)',
        fontWeight: active === tab.value ? 500 : 400,
      }}>
        {tab.label}
      </button>
    ))}
  </div>
)

export const PasswordStrength = ({ password }) => {
  if (!password) return null
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  const map = [
    [25, '#E24B4A', 'Débil'],
    [50, '#EF9F27', 'Regular'],
    [75, '#185FA5', 'Buena'],
    [100, '#639922', 'Fuerte'],
  ]
  const [pct, color, label] = map[score - 1] || [0, '#D3D1C7', '']
  return (
    <>
      <div style={{ height: 3, borderRadius: 2, background: color, width: `${pct}%`, transition: 'all 0.2s', marginTop: 5 }} />
      {label && <p style={{ fontSize: 12, color: 'var(--color-text-hint)', marginTop: 4 }}>{label}</p>}
    </>
  )
}

export const OtpInput = ({ value, onChange }) => {
  const cells = Array(6).fill(0)
  const handleChange = (i, val) => {
    const clean = val.replace(/\D/g, '').slice(-1)
    const next = value.split('')
    next[i] = clean
    onChange(next.join(''))
    if (clean && i < 5) document.getElementById(`otp-${i + 1}`)?.focus()
  }
  const handlePaste = (i, e) => {
    e.preventDefault()
    const pasted = e.clipboardData?.getData('text') || ''
    const digits = pasted.replace(/\D/g, '')
    if (!digits) return

    const next = Array(6).fill('')
    for (let idx = 0; idx < 6; idx++) {
      next[idx] = value[idx] || ''
    }

    for (let offset = 0; offset < digits.length && i + offset < 6; offset++) {
      next[i + offset] = digits[offset]
    }

    onChange(next.join(''))

    const nextFocus = Math.min(i + digits.length, 5)
    document.getElementById(`otp-${nextFocus}`)?.focus()
  }
  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus()
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginBottom: '1rem' }}>
      {cells.map((_, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={e => handleChange(i, e.target.value)}
          onPaste={e => handlePaste(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          style={{
            width: 44, height: 48, textAlign: 'center', fontSize: 20, fontWeight: 500,
            border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none',
          }}
          onFocus={e => e.target.style.boxShadow = '0 0 0 3px rgba(24,95,165,0.15)'}
          onBlur={e => e.target.style.boxShadow = 'none'}
        />
      ))}
    </div>
  )
}

// Inyectar keyframes de spinner una sola vez
if (typeof document !== 'undefined' && !document.getElementById('auth-keyframes')) {
  const style = document.createElement('style')
  style.id = 'auth-keyframes'
  style.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
  document.head.appendChild(style)
}
