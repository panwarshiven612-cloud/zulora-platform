import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import LandingPage from './components/LandingPage';
import SignIn from './pages/SignIn';
import Dashboard from './pages/Dashboard';
import GuestGateModal from './components/GuestGateModal';
import { useSeoMeta } from './hooks/useSeoMeta';

import SearchEngineView from './components/SearchEngineView';

const AIStudio = lazy(() => import('./pages/AIStudio'));

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const WORKSPACE_TABS = {
  '/dashboard': 'chat',
  '/image': 'image',
  '/video': 'video',
  '/brain': 'brain',
  '/vault': 'vault',
  '/library': 'library'
};
// Routes that require authentication — guests get GuestGateModal
const AUTH_REQUIRED_PATHS = ['/dashboard', '/chat', '/image', '/video', '/brain', '/vault', '/studio', '/library', '/settings'];

const AppLoading = ({ label = 'Opening your workspace...' }) => (
  <main role="status" aria-live="polite" className="min-h-screen grid place-items-center bg-slate-50 text-slate-700 dark:bg-[#070b14] dark:text-slate-200">
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/85 px-5 py-4 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85">
      <img src={LOGO_URL} alt="" className="h-10 w-10 rounded-xl object-cover" />
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  </main>
);

export class AppErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Zulora AI could not render this view:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="min-h-screen grid place-items-center bg-slate-50 px-6 text-slate-800 dark:bg-[#070b14] dark:text-slate-100">
          <section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <img src={LOGO_URL} alt="Zulora AI" className="mx-auto mb-5 h-12 w-12 rounded-2xl object-cover" />
            <h1 className="text-xl font-bold">This view hit a snag</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Zulora AI caught a rendering error. Reload the workspace to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-600"
            >
              Reload workspace
            </button>
          </section>
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
    // Only redirect away from login/signin/chat when authenticated; root / remains on SearchEngineView
    if (isAuthenticated && ['/signin', '/login', '/chat'].includes(pathname)) {
      navigate('/dashboard');
      return;
    }
    if (loading) return;
    // Guests can access '/' and '/signin' — block workspace routes and show guest gate
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

  // Root domain route: Search Engine View
  if (pathname === '/') {
    return <SearchEngineView onNavigate={navigate} onSignIn={() => navigate('/login')} />;
  }

  // Dashboard owns its auth-loading state, so a direct /dashboard visit mounts
  // the workspace immediately while authentication finishes in the background.
  if (pathname in WORKSPACE_TABS) {
    if (!isAuthenticated && !loading) {
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
    return <Dashboard initialTab={WORKSPACE_TABS[pathname]} onNavigate={navigate} />;
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
  </AppErrorBoundary>
);

export default App;
