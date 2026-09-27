import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './index.css'

window.addEventListener('error', event => {
  console.error('Uncaught application error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', event => {
  console.error('Uncaught application promise rejection:', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
