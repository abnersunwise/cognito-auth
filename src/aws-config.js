// src/aws-config.js
// Configuración de Cognito desde variables de entorno (Vite).

function getRequiredEnv(name) {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`[aws-config] Missing required env var: ${name}`)
  }
  return value
}

const awsConfig = {
  Auth: {
    Cognito: {
      region: getRequiredEnv('VITE_COGNITO_REGION'),
      userPoolId: getRequiredEnv('VITE_COGNITO_USER_POOL_ID'),
      userPoolClientId: getRequiredEnv('VITE_COGNITO_USER_POOL_CLIENT_ID'),
      hostedUIDomain: import.meta.env.VITE_COGNITO_HOSTED_UI_DOMAIN || '',
      loginWith: {
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
