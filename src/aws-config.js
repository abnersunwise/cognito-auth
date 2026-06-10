// src/aws-config.js
// Soporta múltiples ambientes.
// Ambiente primario: vars VITE_COGNITO_* existentes (con label opcional VITE_ENV_LABEL).
// Ambientes adicionales: VITE_ENV_2_*, VITE_ENV_3_*, … (hasta 10).

function normalizeHostedUiDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '')
}

function getRequiredEnv(name) {
  const value = import.meta.env[name]
  if (!value) throw new Error(`[aws-config] Missing required env var: ${name}`)
  return value
}

function getOptionalEnv(name, fallback = '') {
  const value = import.meta.env[name]
  return value != null ? String(value).trim() : fallback
}

function parseClientEntry(rawEntry) {
  const entry = String(rawEntry || '').trim()
  if (!entry) return null
  const sep = entry.indexOf(':')
  if (sep === -1) return { id: entry, label: entry }
  const id = entry.slice(0, sep).trim()
  const label = entry.slice(sep + 1).trim() || id
  return id ? { id, label } : null
}

function parseAppClientList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map(parseClientEntry)
    .filter(Boolean)
}

function buildClientList(rawAppClients, defaultClientId) {
  const parsed = parseAppClientList(rawAppClients)
  const all = [...parsed, { id: defaultClientId, label: 'env-default' }]
  const seen = new Set()
  return all.filter((c) => {
    if (!c?.id || seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

// ── Environments ──────────────────────────────────────────────────────────────

const ACTIVE_ENVIRONMENT_STORAGE_KEY = 'auth.activeEnvironmentId'
const ACTIVE_APP_CLIENT_KEY_PREFIX = 'auth.activeAppClientId'

const availableEnvironments = (() => {
  const envs = []

  // Ambiente primario — siempre requerido
  const primaryClientId = getRequiredEnv('VITE_COGNITO_USER_POOL_CLIENT_ID')
  envs.push({
    id: 'env-1',
    label: getOptionalEnv('VITE_ENV_LABEL') || 'Desarrollo',
    region: getRequiredEnv('VITE_COGNITO_REGION'),
    userPoolId: getRequiredEnv('VITE_COGNITO_USER_POOL_ID'),
    hostedUIDomain: normalizeHostedUiDomain(getRequiredEnv('VITE_COGNITO_HOSTED_UI_DOMAIN')),
    defaultClientId: primaryClientId,
    appClients: buildClientList(getOptionalEnv('VITE_COGNITO_APP_CLIENTS'), primaryClientId),
  })

  // Ambientes adicionales: VITE_ENV_2_LABEL … VITE_ENV_10_LABEL
  for (let i = 2; i <= 10; i++) {
    const label = getOptionalEnv(`VITE_ENV_${i}_LABEL`)
    if (!label) break

    const region = getOptionalEnv(`VITE_ENV_${i}_COGNITO_REGION`)
    const userPoolId = getOptionalEnv(`VITE_ENV_${i}_COGNITO_USER_POOL_ID`)
    const rawDomain = getOptionalEnv(`VITE_ENV_${i}_COGNITO_HOSTED_UI_DOMAIN`)
    const defaultClientId = getOptionalEnv(`VITE_ENV_${i}_COGNITO_USER_POOL_CLIENT_ID`)

    if (!region || !userPoolId || !rawDomain || !defaultClientId) continue

    envs.push({
      id: `env-${i}`,
      label,
      region,
      userPoolId,
      hostedUIDomain: normalizeHostedUiDomain(rawDomain),
      defaultClientId,
      appClients: buildClientList(
        getOptionalEnv(`VITE_ENV_${i}_COGNITO_APP_CLIENTS`),
        defaultClientId,
      ),
    })
  }

  return envs
})()

// ── Helpers de ambiente ───────────────────────────────────────────────────────

export function getAvailableEnvironments() {
  return availableEnvironments
}

export function getActiveEnvironmentId() {
  if (typeof window === 'undefined' || !window.localStorage) return availableEnvironments[0].id
  const stored = window.localStorage.getItem(ACTIVE_ENVIRONMENT_STORAGE_KEY)
  return availableEnvironments.some((e) => e.id === stored) ? stored : availableEnvironments[0].id
}

export function getActiveEnvironment() {
  const id = getActiveEnvironmentId()
  return availableEnvironments.find((e) => e.id === id) || availableEnvironments[0]
}

export function setActiveEnvironmentId(envId) {
  const env = availableEnvironments.find((e) => e.id === envId)
  if (!env) return availableEnvironments[0].id
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ACTIVE_ENVIRONMENT_STORAGE_KEY, envId)
  }
  return envId
}

// ── Helpers de App Client ─────────────────────────────────────────────────────

function appClientKey(envId) {
  return `${ACTIVE_APP_CLIENT_KEY_PREFIX}.${envId}`
}

export function getAvailableAppClients(envId = getActiveEnvironmentId()) {
  const env = availableEnvironments.find((e) => e.id === envId) || availableEnvironments[0]
  return env.appClients
}

export function getActiveAppClientId(envId = getActiveEnvironmentId()) {
  const env = availableEnvironments.find((e) => e.id === envId) || availableEnvironments[0]
  if (typeof window === 'undefined' || !window.localStorage) return env.defaultClientId
  const stored = window.localStorage.getItem(appClientKey(envId))
  return stored && env.appClients.some((c) => c.id === stored) ? stored : env.defaultClientId
}

export function setActiveAppClientId(clientId, envId = getActiveEnvironmentId()) {
  const env = availableEnvironments.find((e) => e.id === envId) || availableEnvironments[0]
  const resolved = env.appClients.some((c) => c.id === clientId) ? clientId : env.defaultClientId
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(appClientKey(envId), resolved)
  }
  return resolved
}

// ── Config de Amplify ─────────────────────────────────────────────────────────

export function getAmplifyConfig(clientId, envId = getActiveEnvironmentId()) {
  const env = availableEnvironments.find((e) => e.id === envId) || availableEnvironments[0]
  const activeClientId =
    clientId && env.appClients.some((c) => c.id === clientId)
      ? clientId
      : getActiveAppClientId(envId)

  return {
    Auth: {
      Cognito: {
        region: env.region,
        userPoolId: env.userPoolId,
        userPoolClientId: activeClientId,
        hostedUIDomain: env.hostedUIDomain,
        loginWith: {
          oauth: {
            domain: env.hostedUIDomain,
            scopes: ['openid', 'profile', 'email'],
            redirectSignIn: [`${window.location.origin}/callback`],
            redirectSignOut: [`${window.location.origin}/logout`],
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

// Export default para useAuth.js — getter lazy que siempre refleja el ambiente activo.
const awsConfig = {
  get Auth() {
    const env = getActiveEnvironment()
    return {
      Cognito: {
        region: env.region,
        userPoolId: env.userPoolId,
        userPoolClientId: getActiveAppClientId(),
      },
    }
  },
}

export default awsConfig
