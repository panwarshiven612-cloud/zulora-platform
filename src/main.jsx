import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { AppErrorBoundary } from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './index.css'

window.addEventListener('error', event => {
  console.error('Uncaught application error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', event => {
  console.error('Uncaught application promise rejection:', event.reason);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Zulora AI could not find the application root element.');
} else {
  const root = ReactDOM.createRoot(rootElement, {
    onRecoverableError(error, errorInfo) {
      console.error('React recovered from an application rendering error:', error, errorInfo);
    }
  });

  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
