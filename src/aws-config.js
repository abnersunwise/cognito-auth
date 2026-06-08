// src/aws-config.js
// Configuración de Cognito desde variables de entorno (Vite).

function getRequiredEnv(name) {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`[aws-config] Missing required env var: ${name}`)
  }
  return value
}

function normalizeHostedUiDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '')
}

const ACTIVE_APP_CLIENT_STORAGE_KEY = 'auth.activeAppClientId'
const DEFAULT_PREFERRED_APP_CLIENT_ID = '65ru3aghhfs76ib9vj07dbsi8b'
const DEFAULT_APP_CLIENTS = [
  { id: '5pjp5gauclo7ifqv39bc9m93ab', label: 'staff-web' },
  { id: '65ru3aghhfs76ib9vj07dbsi8b', label: 'sunwise-web' },
  { id: '6g0q1nda12ej8n5j5nnjsnuvl8', label: 'sunpay-web' },
  { id: 'e7t9rv0j427hkifon1sbarv9c', label: 'lisa-web' },
]

function getOptionalEnv(name) {
  const value = import.meta.env[name]
  if (value == null) return ''
  return String(value).trim()
}

function parseClientEntry(rawEntry) {
  const entry = String(rawEntry || '').trim()
  if (!entry) return null

  const separatorIndex = entry.indexOf(':')
  if (separatorIndex === -1) {
    return { id: entry, label: entry }
  }

  const id = entry.slice(0, separatorIndex).trim()
  const label = entry.slice(separatorIndex + 1).trim() || id
  if (!id) return null
  return { id, label }
}

function parseAppClientList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map(parseClientEntry)
    .filter(Boolean)
}

const hostedUiDomain = normalizeHostedUiDomain(getRequiredEnv('VITE_COGNITO_HOSTED_UI_DOMAIN'))
const envAppClientId = getRequiredEnv('VITE_COGNITO_USER_POOL_CLIENT_ID')

const configuredAppClients = (() => {
  const parsed = parseAppClientList(getOptionalEnv('VITE_COGNITO_APP_CLIENTS'))
  const baseClients = parsed.length > 0 ? parsed : DEFAULT_APP_CLIENTS
  const allClients = [...baseClients, { id: envAppClientId, label: 'env-default' }]

  const seen = new Set()
  return allClients.filter((client) => {
    if (!client?.id || seen.has(client.id)) return false
    seen.add(client.id)
    return true
  })
})()

const defaultAppClientId = configuredAppClients.some((client) => client.id === DEFAULT_PREFERRED_APP_CLIENT_ID)
  ? DEFAULT_PREFERRED_APP_CLIENT_ID
  : envAppClientId

function isKnownClientId(clientId) {
  return configuredAppClients.some((client) => client.id === clientId)
}

function getStoredActiveClientId() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const value = window.localStorage.getItem(ACTIVE_APP_CLIENT_STORAGE_KEY)
  return value && isKnownClientId(value) ? value : null
}

function persistActiveClientId(clientId) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(ACTIVE_APP_CLIENT_STORAGE_KEY, clientId)
}

export function getAvailableAppClients() {
  return configuredAppClients
}

export function getActiveAppClientId() {
  return getStoredActiveClientId() || defaultAppClientId
}

function resolveAppClientId(clientId) {
  return isKnownClientId(clientId) ? clientId : defaultAppClientId
}

export function setActiveAppClientId(clientId) {
  const nextClientId = resolveAppClientId(clientId)
  persistActiveClientId(nextClientId)
  return nextClientId
}

export function getAmplifyConfig(clientId = getActiveAppClientId()) {
  const activeClientId = resolveAppClientId(clientId)

  return {
  Auth: {
    Cognito: {
      region: getRequiredEnv('VITE_COGNITO_REGION'),
      userPoolId: getRequiredEnv('VITE_COGNITO_USER_POOL_ID'),
      userPoolClientId: activeClientId,
      hostedUIDomain: hostedUiDomain,
      loginWith: {
        oauth: {
          domain: hostedUiDomain,
          scopes: ['openid', 'profile', 'email'],
          redirectSignIn: [
            `${window.location.origin}/callback`,
          ],
          redirectSignOut: [
            `${window.location.origin}/logout`,
          ],
          responseType: 'code',
        },
        email: true,
      },
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      },
    },
  },
}
}

const awsConfig = getAmplifyConfig(getActiveAppClientId())

export default awsConfig
