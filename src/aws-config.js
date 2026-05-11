// src/aws-config.js
// Reemplaza estos valores con los de tu User Pool en AWS Cognito

const awsConfig = {
  Auth: {
    Cognito: {
      region: 'us-east-1',                        // e.g. 'us-east-1'
      userPoolId: 'us-east-1_fCms3cnhK',          // AWS Console > Cognito > User Pool ID
      userPoolClientId: '65ru3aghhfs76ib9vj07dbsi8b', // App client ID
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
