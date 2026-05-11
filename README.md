# cognito-auth

Interfaz de autenticación con AWS Cognito — Login y Reset de contraseña.

## Stack

- React 18 + Vite
- aws-amplify v6

## Estructura

```
src/
├── aws-config.js          # Configuración de Amplify/Cognito ← EDITAR ESTO
├── main.jsx               # Entry point
├── App.jsx                # Router de vistas
├── index.css              # Estilos globales + variables CSS
├── hooks/
│   └── useAuth.js         # Lógica de Cognito (signIn, resetPassword, etc.)
└── components/
    ├── ui.jsx             # Componentes reutilizables (Input, Button, Alert...)
    ├── LoginForm.jsx      # Formulario de inicio de sesión
    └── ResetPasswordFlow.jsx  # Flujo reset (3 pasos: email → OTP → nueva pass)
```

## Configuración rápida

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar Cognito

Edita `src/aws-config.js` con los datos de tu User Pool:

```js
const awsConfig = {
  Auth: {
    Cognito: {
      region: 'us-east-1',                          // tu región
      userPoolId: 'us-east-1_XXXXXXXXX',            // User Pool ID
      userPoolClientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX', // App client ID
    },
  },
}
```

Encuéntralos en: **AWS Console → Cognito → User pools → [tu pool] → App clients**

### 3. Ejecutar en desarrollo

```bash
npm run dev
```

### 4. Build para producción

```bash
npm run build
```

## Flujos implementados

### Login
- Tabs: Email / Teléfono
- Validación de campos vacíos
- Mapeo de errores de Cognito en español
- `Auth.signIn(username, password)`

### Reset de contraseña (3 pasos)
1. **Email** — `Auth.forgotPassword(username)` → envía código al correo
2. **OTP** — Input de 6 dígitos con autoavance
3. **Nueva contraseña** — `Auth.forgotPasswordSubmit(username, code, newPassword)`
   - Indicador de fortaleza de contraseña
   - Validación de confirmación

## Errores de Cognito manejados

| Código Cognito | Mensaje en español |
|---|---|
| NotAuthorizedException | Correo o contraseña incorrectos |
| UserNotFoundException | No existe una cuenta con ese correo |
| UserNotConfirmedException | Cuenta no verificada |
| ExpiredCodeException | Código expirado |
| CodeMismatchException | Código inválido |
| LimitExceededException | Demasiados intentos |
| InvalidPasswordException | Contraseña no cumple requisitos |

## Personalización

- **Colores/tema**: edita las variables CSS en `src/index.css`
- **Nombre de la app**: cambia `Mi App` en `src/components/ui.jsx` (componente `Logo`)
- **Idioma de mensajes de error**: edita `mapCognitoError` en `src/hooks/useAuth.js`
- **Requisitos de contraseña**: ajusta en `src/aws-config.js` bajo `passwordFormat`
