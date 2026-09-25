import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import UsageLimitsModal from './components/UsageLimitsModal';
import PricingModal from './components/PricingModal';
import LandingPage from './components/LandingPage';
import SignIn from './pages/SignIn';
import AccountSettings from './pages/AccountSettings';

const Navbar        = lazy(() => import('./components/Navbar'));
const Sidebar       = lazy(() => import('./components/Sidebar'));
const ChatInterface = lazy(() => import('./components/ChatInterface'));
const ImageGenerator = lazy(() => import('./components/ImageGenerator'));
const VideoGenerator = lazy(() => import('./components/VideoGenerator'));

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

const LoadingSpinner = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] dark:bg-[#070b14]">
    <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col items-center space-y-4">
      <div className="relative">
        <img src={LOGO_URL} alt="Zulora" className="w-16 h-16 rounded-2xl object-cover ring-2 ring-sky-500 shadow-lg animate-pulse" />
        <div className="absolute -inset-1 rounded-2xl bg-sky-500/30 blur animate-ping" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
          Zulora <span className="text-sky-500">AI</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Initializing Secure Multi-Model Intelligence...
        </p>
      </div>
    </div>
  </div>
);

export const App = () => {
  const {
    currentUser,
    loading,
    isUsageModalOpen,
    setIsUsageModalOpen,
    isPricingModalOpen,
    setIsPricingModalOpen,
  } = useAuth();

  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [activeTab, setActiveTab] = useState('chat');
  const [activeSession, setActiveSession] = useState(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const navigate = useCallback((path, replace = true) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setPathname(path);
  }, []);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ── Post-login redirect logic ──────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    // If authenticated and not on dashboard → push to /dashboard
    if (currentUser && pathname !== '/dashboard') {
      navigate('/dashboard');
    }
    // If not authenticated and on protected route → push to /signin
    if (!currentUser && (pathname === '/dashboard' || pathname === '/settings')) {
      navigate('/signin');
    }
  }, [currentUser, loading, navigate, pathname]);

  const goToDashboard = useCallback(() => navigate('/dashboard'), [navigate]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) return <LoadingSpinner />;

  // ── Unauthenticated routes ─────────────────────────────────────────────────
  if (!currentUser) {
    if (pathname === '/signin') {
      return <SignIn onAuthenticated={goToDashboard} />;
    }
    // All unauthenticated users → Landing Page (also has sign-in)
    return <LandingPage onSignIn={goToDashboard} />;
  }

  // ── Authenticated: Dashboard ───────────────────────────────────────────────
  const handleNewChat = () => { setActiveSession(null); setActiveTab('chat'); };
  const handleSelectChat = (session) => { setActiveSession(session); setActiveTab('chat'); };
  const handleUpdateSession = (updatedSession) => setActiveSession(updatedSession);
  const handleSidebarSessionUpdate = (updatedSession) => setActiveSession(previous =>
    previous?.id === updatedSession.id ? { ...previous, ...updatedSession } : previous
  );

  return (
    <div className="h-dvh min-h-0 flex flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">

      <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-slate-500">Loading workspace...</div>}>

        {/* Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* Main Workspace */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <Sidebar
            currentChatId={activeSession?.id}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onUpdateSession={handleSidebarSessionUpdate}
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
            setActiveTab={setActiveTab}
          />

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
            {activeTab === 'chat' && (
              <ChatInterface
                activeSession={activeSession}
                onUpdateSession={handleUpdateSession}
                onNewChat={handleNewChat}
              />
            )}
            {activeTab === 'image' && <ImageGenerator />}
            {activeTab === 'video' && <VideoGenerator />}
          </main>
        </div>

      </Suspense>

      {/* Modals */}
      <UsageLimitsModal isOpen={isUsageModalOpen} onClose={() => setIsUsageModalOpen(false)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />
      {isSettingsOpen && <AccountSettings onClose={() => setIsSettingsOpen(false)} />}

    </div>
  );
};

export default App;
