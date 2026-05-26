// src/hooks/useAuth.js
// Todas las llamadas reales a AWS Cognito usando aws-amplify v6

import { useState } from 'react'
import awsConfig from '../aws-config'
import {
  signIn,
  signOut,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  confirmSignIn,
  fetchMFAPreference,
  resetPassword,
  confirmResetPassword,
  getCurrentUser,
  fetchAuthSession,
  setUpTOTP,
  updateMFAPreference,
  verifyTOTPSetup,
  rememberDevice,
  forgetDevice,
  fetchDevices,
} from 'aws-amplify/auth'

export function useAuth() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const clearError = () => setError(null)

  // --- LOGIN ---
  const login = async (username, password, authType = 'email-preserve') => {
    setLoading(true)
    setError(null)
    try {
      const normalizedUsername = normalizeUsername(username, authType)
      // Restore device keys saved before last logout so Cognito can skip MFA
      restoreDeviceMetadata(normalizedUsername)

      // Intercept fetch to log Cognito auth payloads Amplify sends (InitiateAuth + SRP challenge)
      const originalFetch = window.fetch
      let initiatedLogged = false
      let passwordVerifierLogged = false
      window.fetch = async (url, options, ...rest) => {
        const requestUrl = typeof url === 'string' ? url : url?.url
        if (typeof requestUrl === 'string' && requestUrl.includes('cognito-idp')) {
          try {
            const maybeRequest = typeof url === 'object' && url ? url : null
            let rawBody = options?.body
            if (!rawBody && maybeRequest?.clone) {
              try {
                rawBody = await maybeRequest.clone().text()
              } catch {
                rawBody = null
              }
            }
            const body = JSON.parse(rawBody || '{}')
            const headers = options?.headers || maybeRequest?.headers
            const target =
              (typeof headers?.get === 'function' && (headers.get('X-Amz-Target') || headers.get('x-amz-target'))) ||
              headers?.['X-Amz-Target'] ||
              headers?.['x-amz-target'] ||
              ''

            if (!initiatedLogged && target.includes('InitiateAuth')) {
              initiatedLogged = true
              const authFlow = body?.AuthFlow
              const deviceKey = body?.AuthParameters?.DEVICE_KEY
              console.log('[Device] InitiateAuth target:', target)
              console.log('[Auth] InitiateAuth AuthFlow:', authFlow || '⚠️ NOT PRESENT')
              console.log('[Device] InitiateAuth AuthParameters keys:', Object.keys(body?.AuthParameters || {}))
              console.log('[Device] DEVICE_KEY in request:', deviceKey || '⚠️ NOT PRESENT')
            }

            if (!passwordVerifierLogged && target.includes('RespondToAuthChallenge') && body?.ChallengeName === 'PASSWORD_VERIFIER') {
              passwordVerifierLogged = true
              const challengeDeviceKey = body?.ChallengeResponses?.DEVICE_KEY
              console.log('[Device] PASSWORD_VERIFIER ChallengeResponses keys:', Object.keys(body?.ChallengeResponses || {}))
              console.log('[Device] DEVICE_KEY in PASSWORD_VERIFIER:', challengeDeviceKey || '⚠️ NOT PRESENT')
            }
          } catch {}
        }
        return originalFetch(url, options, ...rest)
      }

      const performSignIn = async () => {
        // Diagnostic only: Amplify v6 reads device metadata from its token storage.
        const deviceKey = getCurrentDeviceKey(normalizedUsername)
        const deviceGroupKey = getCurrentDeviceGroupKey(normalizedUsername)
        const deviceRandomPassword = getCurrentDeviceRandomPassword(normalizedUsername)
        const shouldTryLegacyPasswordFlow = shouldUseLegacyPasswordFlow(normalizedUsername)

        console.log('[Device] Passing to signIn:', {
          deviceKey: deviceKey ? '✓ Present' : '✗ Missing',
          deviceGroupKey: deviceGroupKey ? '✓ Present' : '✗ Missing',
          deviceRandomPassword: deviceRandomPassword ? '✓ Present' : '✗ Missing',
          legacyPasswordFlow: shouldTryLegacyPasswordFlow ? '✓ Enabled' : '✗ Disabled',
        })

        try {
          if (shouldTryLegacyPasswordFlow) {
            console.warn('[Auth] First login for this user on this device, trying USER_PASSWORD_AUTH for legacy migration')
            console.log('[Auth] Selected authFlowType:', 'USER_PASSWORD_AUTH')

            const passwordResult = await signIn({
              username: normalizedUsername,
              password,
              options: {
                authFlowType: 'USER_PASSWORD_AUTH',
              },
            })

            console.log('[Auth] USER_PASSWORD_AUTH succeeded, future logins for this user will use USER_SRP_AUTH on this device')
            markLegacyPasswordFlowUsed(normalizedUsername)
            return passwordResult
          }

          // Default path after first successful password-based login: SRP.
          console.log('[Auth] Selected authFlowType:', 'USER_SRP_AUTH')
          return await signIn({
            username: normalizedUsername,
            password,
            options: {
              authFlowType: 'USER_SRP_AUTH',
            },
          })
        } finally {
          window.fetch = originalFetch
        }
      }

      let result
      let isMarkedRemembered = false
      try {
        // Diagnostic: show what device keys Amplify will find before signIn
        debugDeviceStorage(normalizedUsername)
        
        // Check if device backup is marked as remembered
        const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
        isMarkedRemembered = window.localStorage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.deviceRemembered`) === 'true'
        console.log(`[Device] Device backup marked as remembered? ${isMarkedRemembered ? '✓ YES' : '✗ NO (device never remembered or flag cleared)'}`)
        
        result = await performSignIn()
        
        // CRITICAL: Show what Cognito responded
        console.log('[Device] InitiateAuth response ChallengeName:', result?.nextStep?.signInStep)
        console.log('[Device] Is DEVICE_SRP_AUTH in response?', result?.nextStep?.signInStep === 'DEVICE_SRP_AUTH' ? '✓ YES (device recognized)' : '✗ NO (device NOT recognized)')
        if (!result?.isSignedIn && result?.nextStep?.signInStep === 'DEVICE_SRP_AUTH') {
          console.log('[Device] Cognito is asking for DEVICE_SRP_AUTH — device was recognized but needs confirmation')
        } else if (!result?.isSignedIn && result?.nextStep?.signInStep && result?.nextStep?.signInStep !== 'DEVICE_SRP_AUTH') {
          console.log('[Device] ⚠️ Cognito skipped DEVICE_SRP_AUTH and went directly to:', result?.nextStep?.signInStep)
        }
      } catch (firstErr) {
        // Si el error es por device keys obsoletos, los limpiamos y reintentamos una vez
        const isDeviceKeyError =
          firstErr?.message?.includes('deviceKey') ||
          firstErr?.message?.includes('deviceGroupKey') ||
          firstErr?.message?.includes('secretPassword') ||
          firstErr?.name === 'DeviceKeyNotFoundException'

        if (isDeviceKeyError) {
          console.warn('Stale device keys detected, clearing and retrying...')
          clearStoredDeviceMetadata([normalizedUsername])
          clearSavedDeviceMetadata(normalizedUsername)
          result = await performSignIn()
        } else {
          throw firstErr
        }
      }

      if (!result?.isSignedIn) {
        setLoading(false)

        if (isMfaSignInStep(result?.nextStep?.signInStep)) {
          const step = result?.nextStep?.signInStep
          const rememberedButStillMfa =
            isMarkedRemembered && step === 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE'

          return {
            success: false,
            requiresMfa: true,
            nextStep: result.nextStep,
            rememberedButStillMfa,
            result,
          }
        }

        const msg = mapSignInNextStep(result?.nextStep)
        setError(msg)
        return { success: false, error: msg, result }
      }

      setLoading(false)
      return { success: true, result, deviceBypassed: true }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // --- LOGOUT ---
  // Note: signOut() sin global evita que Cognito resetee el estado "remembered" del dispositivo.
  // global: true revoca refresh tokens en todos los dispositivos, pero también puede resetear
  // el device remembered status. Para preservar el bypass de MFA, usamos signOut sin global.
  const logout = async () => {
    try {
      // Amplify's signOut clears ALL localStorage including device keys.
      // We save them first so the next login can restore them and skip MFA.
      saveDeviceMetadata()
      await signOut()
    } catch (err) {
      console.error('signOut error:', err)
    }
  }

  // --- REGISTRO ---
  const register = async (email, password) => {
    setLoading(true)
    setError(null)

    try {
      const username = normalizeUsername(email, 'email')
      const result = await signUp({
        username,
        password,
        options: {
          userAttributes: {
            email: username,
          },
        },
      })

      setLoading(false)
      return { success: true, result }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  const confirmRegister = async (email, code) => {
    setLoading(true)
    setError(null)

    try {
      const username = normalizeUsername(email, 'email')
      const result = await confirmSignUp({
        username,
        confirmationCode: String(code || '').trim(),
      })

      setLoading(false)
      return { success: true, result }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  const resendRegisterCode = async (email) => {
    setLoading(true)
    setError(null)

    try {
      const username = normalizeUsername(email, 'email')
      const result = await resendSignUpCode({ username })
      setLoading(false)
      return { success: true, result }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // --- SOLICITAR RESET DE CONTRASEÑA ---
  // Envía un código al email/teléfono del usuario
  const requestPasswordReset = async (username) => {
    setLoading(true)
    setError(null)
    try {
      const normalizedUsername = normalizeUsername(username, 'email-preserve')
      await resetPassword({ username: normalizedUsername })
      setLoading(false)
      return { success: true }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // --- CONFIRMAR RESET CON CÓDIGO + NUEVA CONTRASEÑA ---
  const confirmPasswordReset = async (username, confirmationCode, newPassword) => {
    setLoading(true)
    setError(null)
    try {
      const normalizedUsername = normalizeUsername(username, 'email-preserve')
      await confirmResetPassword({
        username: normalizedUsername,
        confirmationCode: String(confirmationCode).trim(),
        newPassword,
      })
      setLoading(false)
      return { success: true }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // --- OBTENER USUARIO ACTUAL ---
  const getUser = async () => {
    try {
      const user = await getCurrentUser()
      return user
    } catch {
      return null
    }
  }

  // --- OBTENER TOKEN JWT ---
  const getToken = async () => {
    try {
      const session = await fetchAuthSession()
      return session.tokens?.idToken?.toString()
    } catch {
      return null
    }
  }

  const getTokens = async () => {
    try {
      const session = await fetchAuthSession()
      const accessToken = stringifyToken(session.tokens?.accessToken)
      const idToken = stringifyToken(session.tokens?.idToken)
      const refreshToken = stringifyToken(session.tokens?.refreshToken)

      return { accessToken, idToken, refreshToken }
    } catch {
      return { accessToken: null, idToken: null, refreshToken: null }
    }
  }

  const confirmMfaChallenge = async (confirmationCode) => {
    setLoading(true)
    setError(null)

    try {
      const result = await confirmSignIn({
        challengeResponse: String(confirmationCode || '').trim(),
      })

      if (!result?.isSignedIn) {
        const msg = mapSignInNextStep(result?.nextStep)
        setLoading(false)
        setError(msg)
        return { success: false, error: msg, result }
      }

      setLoading(false)
      return { success: true, result }
    } catch (err) {
      setLoading(false)
      const msg = mapCognitoError(err)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  const getMfaPreference = async () => {
    try {
      const preference = await fetchMFAPreference()
      return { success: true, preference }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const beginTotpSetup = async (accountName) => {
    try {
      const details = await setUpTOTP()
      const setupUri = details.getSetupUri('Mi App', accountName).toString()

      return {
        success: true,
        sharedSecret: details.sharedSecret,
        setupUri,
      }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const enableTotp = async (confirmationCode) => {
    try {
      await verifyTOTPSetup({
        code: String(confirmationCode || '').trim(),
        options: { friendlyDeviceName: 'Mi App Web' },
      })
      await updateMFAPreference({ totp: 'ENABLED' })
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const disableTotp = async () => {
    try {
      await updateMFAPreference({ totp: 'DISABLED' })
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const setPreferredMfaMethod = async (method, enabledState = {}) => {
    const nextPreference = {
      totp: enabledState.totpEnabled ? 'ENABLED' : 'DISABLED',
      email: enabledState.emailEnabled ? 'ENABLED' : 'DISABLED',
    }

    if (method === 'TOTP') {
      nextPreference.totp = 'PREFERRED'
    } else if (method === 'EMAIL') {
      nextPreference.email = 'PREFERRED'
    }

    try {
      await updateMFAPreference(nextPreference)
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const toggleEmailMfa = async (enabled) => {
    try {
      await updateMFAPreference({ email: enabled ? 'ENABLED' : 'DISABLED' })
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const rememberCurrentDevice = async () => {
    try {
      // Step 1: Tell Amplify to remember device (handles SRP device confirmation internally)
      console.log('[Device] Calling rememberDevice()...')
      await rememberDevice()
      console.log('[Device] rememberDevice() succeeded')

      // Step 2: Get the current device key
      const username = getLastKnownUsername()
      const currentKey = username ? getCurrentDeviceKey(username) : null
      console.log('[Device] Current device key:', currentKey, 'username:', username)

      if (!currentKey) {
        // Fallback: fetch from Cognito and take the most recently authenticated device
        console.warn('[Device] No local device key found, fetching from Cognito...')
        const devices = await fetchDevices()
        const sorted = [...(devices || [])].sort((a, b) =>
          new Date(b?.lastAuthenticatedDate || 0) - new Date(a?.lastAuthenticatedDate || 0)
        )
        const fallbackKey = sorted[0]?.id
        console.log('[Device] Fallback device key from fetchDevices:', fallbackKey)

        if (!fallbackKey) {
          setError('No se pudo identificar el dispositivo para marcarlo como recordado.')
          return { success: false, error: 'No device key available' }
        }

        const result = await forceRememberDeviceStatus(fallbackKey)
        console.log('[Device] UpdateDeviceStatus(fallback) result:', result)
        if (!result.success) {
          setError('No se pudo marcar el dispositivo como recordado en Cognito.')
          return result
        }
        const verified = await getDeviceStatusFromCognito(fallbackKey)
        console.log('[Device] GetDevice(fallback) verification:', verified)
        markBackupAsRemembered()
        ensureDeviceKeysInAmplifyStorage(username, fallbackKey)
        return { success: true }
      }

      // Step 3: Call UpdateDeviceStatus directly — fetchDevices() does NOT expose
      // DeviceRememberedStatus in Amplify v6, so we trust the HTTP 200 from this call.
      const result = await forceRememberDeviceStatus(currentKey)
      console.log('[Device] UpdateDeviceStatus result:', result)

      if (!result.success) {
        setError('No se pudo marcar el dispositivo como recordado en Cognito.')
        return result
      }

      // Step 4: Mark local backup so restore flow and UI banner align with Cognito state
      markBackupAsRemembered()

      // Step 4.1: Verify on Cognito whether the device is really remembered
      const verified = await getDeviceStatusFromCognito(currentKey)
      console.log('[Device] GetDevice verification:', verified)
      
      // Step 5: Ensure device keys are also in Amplify's storage path so next login finds them
      ensureDeviceKeysInAmplifyStorage(username, currentKey)
      
      console.log('[Device] ✓ Device marked as remembered successfully')
      return { success: true }
    } catch (err) {
      console.error('[Device] rememberCurrentDevice failed:', err)
      setError(mapCognitoError(err))
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const forgetCurrentDevice = async () => {
    try {
      const username = getLastKnownUsername()
      await forgetDevice()
      if (username) {
        clearStoredDeviceMetadata([username])
        clearSavedDeviceMetadata(username)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const forgetDeviceById = async (deviceId) => {
    try {
      await forgetDevice({ device: { id: deviceId } })
      return { success: true }
    } catch (err) {
      return { success: false, error: mapCognitoError(err) }
    }
  }

  const getDevices = async () => {
    try {
      const devices = await fetchDevices()
      return { success: true, devices: devices || [] }
    } catch (err) {
      return { success: false, devices: [] }
    }
  }

  const getDeviceRememberedStatus = async () => {
    try {
      // Trust the local backup flag set by UpdateDeviceStatus,
      // not fetchDevices() which doesn't expose DeviceRememberedStatus.
      if (typeof window === 'undefined' || !window.localStorage) {
        return { success: false, isRemembered: false }
      }

      const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
      const remembered = window.localStorage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.deviceRemembered`)
      const isRemembered = remembered === 'true'

      console.log('Device remembered status (from local backup):', isRemembered)
      return { success: true, isRemembered }
    } catch (err) {
      console.error('Error checking device remembered status:', err)
      return { success: false, isRemembered: false }
    }
  }

  const getCurrentDeviceForRememberPrompt = async () => {
    try {
      const username = getLastKnownUsername()
      const localDeviceKey = username ? getCurrentDeviceKey(username) : null

      if (localDeviceKey) {
        return { success: true, username, deviceKey: localDeviceKey, source: 'localStorage' }
      }

      const devices = await fetchDevices()
      if (!Array.isArray(devices) || devices.length === 0) {
        return { success: false, username, deviceKey: null }
      }

      const sorted = [...devices].sort((a, b) => {
        const aTs = new Date(a?.lastAuthenticatedDate || a?.lastModifiedDate || a?.createDate || 0).getTime()
        const bTs = new Date(b?.lastAuthenticatedDate || b?.lastModifiedDate || b?.createDate || 0).getTime()
        return bTs - aTs
      })

      return {
        success: true,
        username,
        deviceKey: sorted[0]?.id || null,
        source: 'fetchDevices',
      }
    } catch {
      return { success: false, username: null, deviceKey: null }
    }
  }

  return {
    loading,
    error,
    clearError,
    login,
    register,
    confirmRegister,
    resendRegisterCode,
    logout,
    requestPasswordReset,
    confirmPasswordReset,
    getUser,
    getToken,
    getTokens,
    confirmMfaChallenge,
    getMfaPreference,
    beginTotpSetup,
    enableTotp,
    disableTotp,
    setPreferredMfaMethod,
    toggleEmailMfa,
    rememberCurrentDevice,
    forgetCurrentDevice,
    forgetDeviceById,
    getDeviceRememberedStatus,
    getDevices,
    getCurrentDeviceForRememberPrompt,
  }
}

// Mapeo de errores de Cognito a mensajes en español
function mapCognitoError(err) {
  const code = err?.name || err?.code || err?.cause?.name || ''
  const message = err?.message || ''

  if (message.includes('USER_PASSWORD_AUTH is not enabled for the client')) {
    return 'El App Client no tiene habilitado ALLOW_USER_PASSWORD_AUTH en Cognito.'
  }

  switch (code) {
    case 'NotAuthorizedException':
      return 'Correo o contraseña incorrectos.'
    case 'UserNotFoundException':
      return 'No existe una cuenta con ese correo.'
    case 'UserNotConfirmedException':
      return 'Tu cuenta no ha sido verificada. Revisa tu correo.'
    case 'UsernameExistsException':
      return 'Ya existe una cuenta con ese correo.'
    case 'CodeDeliveryFailureException':
      return 'No se pudo enviar el código de verificación. Intenta más tarde.'
    case 'PasswordResetRequiredException':
      return 'Debes restablecer tu contraseña.'
    case 'LimitExceededException':
      return 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
    case 'ExpiredCodeException':
      return 'El código ha expirado. Solicita uno nuevo.'
    case 'CodeMismatchException':
      return 'El código ingresado no es válido.'
    case 'EnableSoftwareTokenMFAException':
    case 'SoftwareTokenMFANotFoundException':
      return 'No se pudo activar TOTP con la configuración actual de Cognito.'
    case 'VerifySoftwareTokenException':
      return 'No se pudo verificar el código TOTP. Revisa el código de tu app autenticadora.'
    case 'InvalidPasswordException':
      return 'La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número.'
    case 'InvalidParameterException':
      return 'Datos inválidos. Verifica el correo ingresado.'
    case 'TooManyRequestsException':
      return 'Demasiadas solicitudes. Intenta más tarde.'
    case 'NetworkError':
      return 'Error de red. Verifica tu conexión.'
    default:
      return err?.message || 'Ocurrió un error inesperado.'
  }
}

function normalizeUsername(rawValue, authType) {
  const value = String(rawValue || '').trim()

  if (authType === 'phone') {
    // Cognito espera formato E.164; quitamos separadores comunes.
    return value.replace(/[\s()-]/g, '')
  }

  if (authType === 'email-preserve') {
    return value
  }

  return value.toLowerCase()
}

function mapSignInNextStep(nextStep) {
  const step = nextStep?.signInStep

  switch (step) {
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return 'Tu cuenta requiere cambio de contraseña al iniciar sesión. Completa ese paso en Cognito.'
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      return 'Tu cuenta tiene TOTP activo. Ingresa el código de tu app autenticadora para continuar.'
    case 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE':
      return 'Revisa tu correo e ingresa el código de verificación para continuar.'
    case 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION':
      return 'Selecciona si quieres recibir el código por correo o usar tu app autenticadora.'
    case 'CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION':
      return 'Debes configurar un método de verificación para continuar.'
    case 'CONTINUE_SIGN_IN_WITH_EMAIL_SETUP':
      return 'Ingresa un correo para recibir códigos de verificación y continuar.'
    case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':
      return 'Este proyecto no contempla MFA por SMS.'
    case 'RESET_PASSWORD':
      return 'Debes restablecer tu contraseña antes de iniciar sesión.'
    default:
      return 'No se pudo completar el inicio de sesión. Intenta de nuevo.'
  }
}

function isMfaSignInStep(step) {
  return [
    'CONFIRM_SIGN_IN_WITH_TOTP_CODE',
    'CONFIRM_SIGN_IN_WITH_EMAIL_CODE',
    'CONTINUE_SIGN_IN_WITH_MFA_SELECTION',
    'CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION',
    'CONTINUE_SIGN_IN_WITH_EMAIL_SETUP',
  ].includes(step)
}

function stringifyToken(token) {
  if (!token) return null
  if (typeof token === 'string') return token
  if (typeof token?.toString === 'function') return token.toString()
  return null
}

function clearStoredDeviceMetadata(usernames = []) {
  if (typeof window === 'undefined' || !window.localStorage) return

  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return

  const storage = window.localStorage
  const lastAuthUserKey = `${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`
  const lastAuthUser = storage.getItem(lastAuthUserKey)
  const usersToClear = [...new Set([lastAuthUser, ...usernames].filter(Boolean))]

  usersToClear.forEach((username) => {
    DEVICE_METADATA_KEYS.forEach((key) => {
      storage.removeItem(`${AUTH_KEY_PREFIX}.${clientId}.${username}.${key}`)
    })
  })
}

const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider'
const DEVICE_METADATA_KEYS = ['deviceKey', 'deviceGroupKey', 'randomPasswordKey']
const DEVICE_BACKUP_PREFIX = 'DeviceBackup'
const LEGACY_MIGRATION_PREFIX = 'LegacyMigration'

function shouldUseLegacyPasswordFlow(username) {
  if (typeof window === 'undefined' || !window.localStorage || !username) return true
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return true
  return window.localStorage.getItem(`${LEGACY_MIGRATION_PREFIX}.${clientId}.${username}.passwordAuthUsed`) !== 'true'
}

function markLegacyPasswordFlowUsed(username) {
  if (typeof window === 'undefined' || !window.localStorage || !username) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  window.localStorage.setItem(`${LEGACY_MIGRATION_PREFIX}.${clientId}.${username}.passwordAuthUsed`, 'true')
}

function isLegacyMigrationCandidateError(err) {
  const code = err?.name || err?.code || err?.cause?.name || ''
  const message = err?.message || ''

  return (
    code === 'UserNotFoundException' ||
    code === 'NotAuthorizedException' ||
    message.includes('USER_SRP_AUTH is not enabled for the client') ||
    message.includes('Initiate Auth method not supported') ||
    message.includes('Incorrect username or password')
  )
}

// Saves device keys to a separate prefix before signOut so Amplify doesn't erase them.
// Scans ALL storage keys to collect device metadata regardless of which username they're under.
function saveDeviceMetadata() {
  if (typeof window === 'undefined' || !window.localStorage) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  const storage = window.localStorage
  const lastAuthUserKey = `${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`
  const primaryUsername = storage.getItem(lastAuthUserKey)
  if (!primaryUsername) return

  // Collect device keys from ALL usernames in live storage, preferring primaryUsername.
  // This handles the case where keys are split between sub and email.
  const merged = {}
  DEVICE_METADATA_KEYS.forEach((key) => {
    // First pass: check under the primary username (sub)
    const primaryVal = storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${primaryUsername}.${key}`)
    if (primaryVal) {
      merged[key] = primaryVal
      return
    }
    // Second pass: scan all storage entries for this key
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (
        k &&
        k.startsWith(`${AUTH_KEY_PREFIX}.${clientId}.`) &&
        k.endsWith(`.${key}`) &&
        !k.endsWith(`LastAuthUser`)
      ) {
        const val = storage.getItem(k)
        if (val) { merged[key] = val; break }
      }
    }
  })

  // Save merged set under primaryUsername so restore always finds a complete set
  DEVICE_METADATA_KEYS.forEach((key) => {
    if (merged[key]) {
      storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${primaryUsername}.${key}`, merged[key])
    }
  })
  storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`, primaryUsername)
  console.log('[Device] Saved device metadata for', primaryUsername, '→', merged)
  // Preserve the remembered flag if it was set
  // (don't reset it on every save — only markBackupAsRemembered sets it)
}

// Marks the current backup as remembered (called after rememberDevice() succeeds)
function markBackupAsRemembered() {
  if (typeof window === 'undefined' || !window.localStorage) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  window.localStorage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.deviceRemembered`, 'true')
  console.log('[Device] Backup marked as remembered')
}

// Ensures device keys are in BOTH Amplify's expected storage path AND our backup.
// Amplify v6 looks for keys at CognitoIdentityServiceProvider.{clientId}.{username}.{key}
// This forces keys into that exact path so next login's signIn() finds them.
function ensureDeviceKeysInAmplifyStorage(username, deviceKey) {
  if (typeof window === 'undefined' || !window.localStorage || !username || !deviceKey) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  const storage = window.localStorage
  
  try {
    const lastAuthUser = storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`)
    const sourceCandidates = [...new Set([username, lastAuthUser].filter(Boolean))]

    // Prefer backup values, fallback to live Amplify keys if backup is not populated yet.
    let deviceGroupKey = null
    let randomPasswordKey = null
    for (const source of sourceCandidates) {
      deviceGroupKey =
        deviceGroupKey ||
        storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${source}.deviceGroupKey`) ||
        storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${source}.deviceGroupKey`)
      randomPasswordKey =
        randomPasswordKey ||
        storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${source}.randomPasswordKey`) ||
        storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${source}.randomPasswordKey`)
    }
    
    if (!deviceGroupKey || !randomPasswordKey) {
      console.warn('[Device] Cannot ensure device keys in Amplify storage: missing metadata in backup/live storage')
      return
    }
    
    // Write to Amplify's search path: CognitoIdentityServiceProvider.{clientId}.{username}.{key}
    // Also write under the sub (UUID) in case Amplify resolves to that username
    const targets = [...new Set([username, lastAuthUser].filter(Boolean))]
    
    targets.forEach((target) => {
      storage.setItem(`${AUTH_KEY_PREFIX}.${clientId}.${target}.deviceKey`, deviceKey)
      storage.setItem(`${AUTH_KEY_PREFIX}.${clientId}.${target}.deviceGroupKey`, deviceGroupKey)
      storage.setItem(`${AUTH_KEY_PREFIX}.${clientId}.${target}.randomPasswordKey`, randomPasswordKey)

      // Keep backup aligned so restore works even after signOut clears live keys
      storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${target}.deviceKey`, deviceKey)
      storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${target}.deviceGroupKey`, deviceGroupKey)
      storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${target}.randomPasswordKey`, randomPasswordKey)
    })

    storage.setItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`, lastAuthUser || username)
    
    console.log('[Device] Device keys ensured in Amplify storage paths:', targets)
  } catch (err) {
    console.warn('[Device] Error ensuring device keys in Amplify storage:', err?.message)
  }
}

// Restores device keys saved by saveDeviceMetadata() back into Amplify's storage.
// Tries the provided username first, then the backed-up LastAuthUser (handles SRP username mismatches).
function restoreDeviceMetadata(username) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  const storage = window.localStorage
  const liveLastAuthUserKey = `${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`

  const backedUpUsername = storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`)
  const candidates = [...new Set([username, backedUpUsername].filter(Boolean))]

  // Find which backed-up username actually has keys
  let sourceUsername = null
  for (const candidate of candidates) {
    const hasKeys = DEVICE_METADATA_KEYS.some(
      (key) => storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${candidate}.${key}`)
    )
    if (hasKeys) { sourceUsername = candidate; break }
  }

  if (!sourceUsername) {
    console.log('[Device] No backup found for', candidates)
    return
  }

  // Cognito/Amplify relies on LastAuthUser to resolve device metadata keys.
  // If this key is missing after signOut, device SRP flow can be skipped and MFA is requested.
  storage.setItem(liveLastAuthUserKey, sourceUsername)
  console.log('[Device] Restored LastAuthUser:', sourceUsername)

  console.log('[Device] Restoring keys from backup:', sourceUsername)

  // Restore under BOTH the sub (sourceUsername) and the email (username).
  // ALWAYS overwrite — never skip with "if not exists".
  // Partial/stale state is the main cause of device SRP failures: keys end up under
  // different usernames (sub vs email) and Amplify can't find a consistent set of 3.
  const targets = [...new Set([username, sourceUsername].filter(Boolean))]
  DEVICE_METADATA_KEYS.forEach((key) => {
    const backupVal = storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${sourceUsername}.${key}`)
    if (backupVal) {
      targets.forEach((target) => {
        const amplifyKey = `${AUTH_KEY_PREFIX}.${clientId}.${target}.${key}`
        const existing = storage.getItem(amplifyKey)
        if (existing !== backupVal) {
          console.log(`[Device] Restoring ${key} → ${target}${existing ? ' (overwrite)' : ''}`)
          storage.setItem(amplifyKey, backupVal)
        } else {
          console.log(`[Device] ${key} → ${target} already up to date`)
        }
      })
    }
  })
}

// Returns true if there are backed-up device keys AND the device was marked as remembered
export function hasDeviceBackup(username) {
  if (typeof window === 'undefined' || !window.localStorage) return false
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return false
  const storage = window.localStorage

  // Only return true if device was explicitly marked as remembered via rememberDevice()
  const rememberedFlag = storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.deviceRemembered`)
  if (rememberedFlag !== 'true') return false

  const candidates = [...new Set([
    username,
    storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`),
  ].filter(Boolean))]

  return candidates.some((u) =>
    DEVICE_METADATA_KEYS.some((key) =>
      storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${u}.${key}`)
    )
  )
}

function getLastKnownUsername() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return null
  const storage = window.localStorage

  const lastAuthUser = storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`)
  if (lastAuthUser) return lastAuthUser

  return storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`)
}

function getCurrentDeviceKey(username) {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId || !username) return null
  const storage = window.localStorage

  return (
    storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${username}.deviceKey`) ||
    storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${username}.deviceKey`)
  )
}

function getCurrentDeviceRandomPassword(username) {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId || !username) return null
  const storage = window.localStorage

  // Try to find randomPasswordKey under the given username OR any username
  const key1 = `${AUTH_KEY_PREFIX}.${clientId}.${username}.randomPasswordKey`
  const key2 = `${DEVICE_BACKUP_PREFIX}.${clientId}.${username}.randomPasswordKey`
  
  const val1 = storage.getItem(key1)
  const val2 = storage.getItem(key2)

  if (!val1 && !val2) {
    // Debug: try to find it under ANY username
    const sub = storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.LastAuthUser`)
    if (sub && sub !== username) {
      const val3 = storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${sub}.randomPasswordKey`)
      if (val3) {
        console.log(`[Device] randomPasswordKey found under sub ${sub}, not email ${username}`)
        return val3
      }
    }
  }

  return val1 || val2
}

function getCurrentDeviceGroupKey(username) {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId || !username) return null
  const storage = window.localStorage

  return (
    storage.getItem(`${AUTH_KEY_PREFIX}.${clientId}.${username}.deviceGroupKey`) ||
    storage.getItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${username}.deviceGroupKey`)
  )
}

// Clears the backup device keys (e.g. when device is explicitly forgotten or keys are stale)
function clearSavedDeviceMetadata(username) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  const storage = window.localStorage

  DEVICE_METADATA_KEYS.forEach((key) => {
    storage.removeItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.${username}.${key}`)
  })
  storage.removeItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.LastAuthUser`)
  storage.removeItem(`${DEVICE_BACKUP_PREFIX}.${clientId}.deviceRemembered`)
}

// Dumps all device-related localStorage entries for debugging
function debugDeviceStorage(username) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const clientId = awsConfig.Auth?.Cognito?.userPoolClientId
  if (!clientId) return
  const storage = window.localStorage
  const prefix = `${AUTH_KEY_PREFIX}.${clientId}`
  const backupPrefix = `${DEVICE_BACKUP_PREFIX}.${clientId}`

  const relevant = {}
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && (k.startsWith(prefix) || k.startsWith(backupPrefix))) {
      const val = storage.getItem(k)
      // Truncate long values for readability
      relevant[k] = val && val.length > 40 ? val.substring(0, 40) + '…' : val
    }
  }
  console.log('[Device] localStorage snapshot before signIn (username=%s):', username, relevant)
}

async function forceRememberDeviceStatus(deviceKey) {
  try {
    if (!deviceKey) return { success: false, error: 'Missing deviceKey' }

    const region = awsConfig.Auth?.Cognito?.region
    if (!region) return { success: false, error: 'Missing Cognito region in config' }

    const session = await fetchAuthSession()
    const accessToken = stringifyToken(session?.tokens?.accessToken)
    if (!accessToken) return { success: false, error: 'Missing access token' }

    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.UpdateDeviceStatus',
      },
      body: JSON.stringify({
        AccessToken: accessToken,
        DeviceKey: deviceKey,
        DeviceRememberedStatus: 'remembered',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.warn('[Device] UpdateDeviceStatus HTTP error:', response.status, errorText)
      return {
        success: false,
        error: `UpdateDeviceStatus failed (${response.status})`,
        raw: errorText,
      }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err?.message || 'Unknown UpdateDeviceStatus error' }
  }
}

async function getDeviceStatusFromCognito(deviceKey) {
  try {
    if (!deviceKey) return { success: false, error: 'Missing deviceKey' }

    const region = awsConfig.Auth?.Cognito?.region
    if (!region) return { success: false, error: 'Missing Cognito region in config' }

    const session = await fetchAuthSession()
    const accessToken = stringifyToken(session?.tokens?.accessToken)
    if (!accessToken) return { success: false, error: 'Missing access token' }

    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetDevice',
      },
      body: JSON.stringify({
        AccessToken: accessToken,
        DeviceKey: deviceKey,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `GetDevice failed (${response.status})`,
        raw: errorText,
      }
    }

    const json = await response.json()
    const deviceAttributes = Array.isArray(json?.Device?.DeviceAttributes)
      ? json.Device.DeviceAttributes
      : []

    const attributeMap = deviceAttributes.reduce((acc, attr) => {
      if (attr?.Name) acc[attr.Name] = attr?.Value
      return acc
    }, {})

    const rememberedStatus =
      json?.Device?.DeviceRememberedStatus ||
      json?.DeviceRememberedStatus ||
      json?.device?.deviceRememberedStatus ||
      attributeMap.device_status ||
      'unknown'

    const resolvedDeviceKey =
      json?.Device?.DeviceKey ||
      json?.DeviceKey ||
      json?.device?.deviceKey ||
      deviceKey

    const lastAuthenticatedDate =
      json?.Device?.DeviceLastAuthenticatedDate ||
      json?.DeviceLastAuthenticatedDate ||
      json?.device?.deviceLastAuthenticatedDate ||
      null

    return {
      success: true,
      deviceKey: resolvedDeviceKey,
      rememberedStatus,
      lastAuthenticatedDate,
      rawKeys: Object.keys(json || {}),
      deviceAttributes: attributeMap,
    }
  } catch (err) {
    return { success: false, error: err?.message || 'Unknown GetDevice error' }
  }
}
