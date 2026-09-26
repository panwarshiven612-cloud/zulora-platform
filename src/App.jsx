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
const AiBrain = lazy(() => import('./components/AiBrain'));
const UserVault = lazy(() => import('./components/UserVault'));
const AIStudio = lazy(() => import('./pages/AIStudio'));

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

  const selectTab = useCallback(tab => {
    setActiveTab(tab);
    if (currentUser) navigate(tab === 'vault' ? '/vault' : tab === 'studio' ? '/studio' : '/dashboard');
  }, [currentUser, navigate]);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) {
      setActiveSession(null);
      return undefined;
    }
    let active = true;
    const activeChatKey = `zulora_active_chat_${uid}`;
    const sessionId = localStorage.getItem(activeChatKey);
    if (!sessionId) {
      setActiveSession(null);
      return undefined;
    }
    import('./services/firestoreService').then(({ firestoreService }) => firestoreService.getChatSession(uid, sessionId)).then(session => {
      if (active) setActiveSession(session || null);
    }).catch(error => {
      console.warn('Could not restore the active chat:', error.message);
      if (active) setActiveSession(null);
    });
    return () => { active = false; };
  }, [currentUser?.uid]);

  // ── Post-login redirect logic ──────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (currentUser && !['/dashboard', '/vault', '/studio'].includes(pathname)) {
      navigate('/dashboard');
    }
    if (!currentUser && ['/dashboard', '/vault', '/studio', '/settings'].includes(pathname)) {
      navigate('/signin');
    }
  }, [currentUser, loading, navigate, pathname]);

  useEffect(() => {
    if (pathname === '/vault') setActiveTab('vault');
    else if (pathname === '/studio') setActiveTab('studio');
    else if (pathname === '/dashboard' && activeTab === 'studio') setActiveTab('chat');
    else if (pathname === '/dashboard' && activeTab === 'vault') setActiveTab('chat');
  }, [pathname, activeTab]);

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

  if (pathname === '/studio' || activeTab === 'studio') {
    return <Suspense fallback={<div className="min-h-screen grid place-items-center bg-[#070914] text-slate-300">Opening AI Studio…</div>}>
      <AIStudio onExitDashboard={() => { setActiveTab('chat'); navigate('/dashboard'); }} />
    </Suspense>;
  }

  // ── Authenticated: Dashboard ───────────────────────────────────────────────
  const handleNewChat = () => {
    if (currentUser?.uid) localStorage.removeItem(`zulora_active_chat_${currentUser.uid}`);
    setActiveSession(null);
    setActiveTab('chat');
    if (pathname === '/vault') navigate('/dashboard');
  };
  const handleSelectChat = (session) => {
    if (currentUser?.uid && session?.id) localStorage.setItem(`zulora_active_chat_${currentUser.uid}`, session.id);
    setActiveSession(session);
    setActiveTab('chat');
    if (pathname === '/vault') navigate('/dashboard');
  };
  const handleUpdateSession = (updatedSession) => {
    if (currentUser?.uid && updatedSession?.id) localStorage.setItem(`zulora_active_chat_${currentUser.uid}`, updatedSession.id);
    setActiveSession(updatedSession);
  };
  const handleSidebarSessionUpdate = (updatedSession) => setActiveSession(previous =>
    previous?.id === updatedSession.id ? { ...previous, ...updatedSession } : previous
  );

  return (
    <div className="h-dvh min-h-0 flex flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">

      <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-slate-500">Loading workspace...</div>}>

        {/* Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={selectTab}
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
            setActiveTab={selectTab}
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
            {activeTab === 'brain' && <AiBrain />}
            {activeTab === 'vault' && <UserVault />}
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
