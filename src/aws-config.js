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

const hostedUiDomain = normalizeHostedUiDomain(getRequiredEnv('VITE_COGNITO_HOSTED_UI_DOMAIN'))

const awsConfig = {
  Auth: {
    Cognito: {
      region: getRequiredEnv('VITE_COGNITO_REGION'),
      userPoolId: getRequiredEnv('VITE_COGNITO_USER_POOL_ID'),
      userPoolClientId: getRequiredEnv('VITE_COGNITO_USER_POOL_CLIENT_ID'),
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

export default awsConfig
