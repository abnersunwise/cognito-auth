import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import 'aws-amplify/auth/enable-oauth-listener'
import { getAmplifyConfig } from './aws-config'
import App from './App'
import './index.css'

Amplify.configure(getAmplifyConfig())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
