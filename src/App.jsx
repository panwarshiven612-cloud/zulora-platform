import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import LandingPage from './components/LandingPage';
import SignIn from './pages/SignIn';
import Dashboard from './pages/Dashboard';
import GuestGateModal from './components/GuestGateModal';
import TaskToastHost from './components/TaskToastHost';
import { useSeoMeta } from './hooks/useSeoMeta';

import SearchEngineView from './components/SearchEngineView';

const AIStudio = lazy(() => import('./pages/AIStudio'));

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const WORKSPACE_TABS = {
  '/dashboard': 'chat',
  '/chat': 'chat',
  '/image': 'image',
  '/video': 'video',
  '/brain': 'brain',
  '/vault': 'vault',
  '/library': 'library'
};
// Routes that require authentication — guests get GuestGateModal
const AUTH_REQUIRED_PATHS = ['/image', '/video', '/brain', '/vault', '/studio', '/library', '/settings'];

const AppLoading = ({ label = 'Opening your workspace...' }) => (
  <main role="status" aria-live="polite" className="min-h-screen grid place-items-center bg-slate-50 text-slate-700 dark:bg-[#070b14] dark:text-slate-200">
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/85 px-5 py-4 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85">
      <img src={LOGO_URL} alt="" className="h-10 w-10 rounded-xl object-cover" />
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  </main>
);

/**
 * AppErrorBoundary — self-healing boundary.
 * On first crash: purges corrupted session localStorage keys, then auto-resets
 * state after 50 ms so the component tree re-renders fresh without any error UI.
 * Only shows a visible fallback UI if the second render also crashes (recovered===true).
 */
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, recovered: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Zulora AI caught a render error — auto-recovering:', error, errorInfo);
    // Purge all corrupted localStorage chat/session keys so next render starts clean
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('zulora_active_chat') ||
            key.startsWith('zulora_session') ||
            key === 'zulora_active_chat')
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
      });
    } catch (lsErr) {
      console.warn('Could not clear corrupted localStorage on recovery:', lsErr);
    }
    // Auto-attempt recovery — reset error state so the tree re-renders fresh
    if (!this.state.recovered) {
      setTimeout(() => {
        this.setState({ hasError: false, recovered: true });
      }, 80);
    }
  }

  render() {
    if (this.state.hasError) {
      // Show a brief spinner while auto-recovery fires (usually < 100 ms)
      return (
        <main
          role="status"
          aria-live="polite"
          className="min-h-screen grid place-items-center bg-slate-50 dark:bg-[#070b14]"
        >
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white/90 px-8 py-6 shadow-xl dark:border-slate-800 dark:bg-slate-900/90">
            <img src={LOGO_URL} alt="Zulora AI" className="h-12 w-12 rounded-2xl object-cover" />
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Restoring your workspace…
            </span>
            {this.state.recovered && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-600"
              >
                Reload workspace
              </button>
            )}
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const AppRouter = () => {
  const { isAuthenticated, loading } = useAuth();
  const [pathname, setPathname] = useState(() => {
    try { return window.location.pathname || '/'; }
    catch { return '/'; }
  });
  const [showGuestGate, setShowGuestGate] = useState(false);

  // Module 6: Dynamic SEO — update title/canonical on every route change
  useSeoMeta(pathname);

  const navigate = useCallback((path, replace = true) => {
    const safePath = typeof path === 'string' && path.startsWith('/') ? path : '/';
    try {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', safePath);
    } catch (error) {
      console.error('App navigation failed:', error);
      try { window.location.assign(safePath); }
      catch (navigationError) { console.error('Full page navigation failed:', navigationError); }
    }
    setPathname(safePath);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      try { setPathname(window.location.pathname || '/'); }
      catch (error) {
        console.error('Could not read the current route:', error);
        setPathname('/');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    // Keep the marketing landing page public and allow a guest demo workspace.
    if (isAuthenticated && ['/signin', '/login', '/chat'].includes(pathname)) {
      navigate('/dashboard');
      return;
    }
    if (loading) return;
    // Only media and account tools require sign-in; /dashboard and /chat are demo routes.
    if (!isAuthenticated && AUTH_REQUIRED_PATHS.includes(pathname)) {
      setShowGuestGate(true);
      navigate('/');
    }
  }, [isAuthenticated, loading, navigate, pathname]);

  // Guest gate: show SearchEngineView + modal
  if (showGuestGate && !isAuthenticated) {
    return (
      <>
        <SearchEngineView onNavigate={navigate} onSignIn={() => { setShowGuestGate(false); navigate('/login'); }} />
        <GuestGateModal
          onSignIn={() => { setShowGuestGate(false); navigate('/login'); }}
          onClose={() => setShowGuestGate(false)}
          reason="sign in to access your Zulora workspace"
        />
      </>
    );
  }

  // Root domain route: full marketing landing page.
  if (pathname === '/') {
    return <LandingPage onTryDemo={() => navigate('/dashboard', false)} onSignIn={() => navigate('/login', false)} />;
  }

  // Dashboard owns its auth-loading state and renders chat in guest mode.
  if (pathname in WORKSPACE_TABS) {
    if (!isAuthenticated && !loading && pathname !== '/dashboard' && pathname !== '/chat') {
      return (
        <>
          <SearchEngineView onNavigate={navigate} onSignIn={() => navigate('/login')} />
          <GuestGateModal
            onSignIn={() => navigate('/login')}
            onClose={() => navigate('/')}
            reason="sign in to access your Zulora workspace"
          />
        </>
      );
    }
    return <Dashboard initialTab={WORKSPACE_TABS[pathname]} onNavigate={navigate} guestMode={!isAuthenticated} />;
  }

  if (loading && !isAuthenticated) return <AppLoading label="Checking your secure sign-in..." />;

  if (!isAuthenticated) {
    if (pathname === '/login' || pathname === '/signin') {
      return <SignIn onAuthenticated={() => navigate('/dashboard')} />;
    }
    return <SearchEngineView onNavigate={navigate} onSignIn={() => navigate('/login')} />;
  }

  if (pathname === '/studio') {
    return (
      <Suspense fallback={<AppLoading label="Opening the code editor..." />}>
        <AIStudio onExitDashboard={() => navigate('/dashboard')} />
      </Suspense>
    );
  }

  return <Dashboard initialTab="chat" onNavigate={navigate} />;
};

export const App = () => (
  <AppErrorBoundary>
    <AppRouter />
    <TaskToastHost />
  </AppErrorBoundary>
);

export default App;
