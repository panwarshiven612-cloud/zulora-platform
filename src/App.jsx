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
const VoiceAssistantModal = lazy(() => import('./components/VoiceAssistantModal'));

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const readLocalStorage = key => {
  try { return window.localStorage.getItem(key); }
  catch (error) {
    console.warn(`Could not read local state (${key}); continuing without it:`, error);
    return null;
  }
};
const writeLocalStorage = (key, value) => {
  try { window.localStorage.setItem(key, value); return true; }
  catch (error) {
    console.warn(`Could not save local state (${key}):`, error);
    return false;
  }
};

const LoadingSpinner = () => (
  <div role="status" aria-live="polite" aria-label="Checking your secure sign-in" className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] dark:bg-[#070b14]">
    <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col items-center space-y-4">
      <div className="relative">
        <img src={LOGO_URL} alt="Zulora" className="w-16 h-16 rounded-2xl object-cover ring-2 ring-sky-500 shadow-lg animate-pulse" />
        <div className="absolute -inset-1 rounded-2xl bg-sky-500/30 blur animate-ping" />
        <div className="absolute -inset-1 rounded-2xl border-2 border-sky-300/70 border-t-transparent animate-spin" />
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
    isAuthenticated,
    loading,
    isUsageModalOpen,
    setIsUsageModalOpen,
    isPricingModalOpen,
    setIsPricingModalOpen,
  } = useAuth();

  const [pathname, setPathname] = useState(() => {
    try { return window.location.pathname || '/'; }
    catch { return '/'; }
  });
  const [activeTab, setActiveTab] = useState('chat');
  const [activeSession, setActiveSession] = useState(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  const navigate = useCallback((path, replace = true) => {
    try { window.history[replace ? 'replaceState' : 'pushState']({}, '', path); }
    catch (error) {
      console.warn('Client-side navigation failed; using a full page navigation:', error);
      try { window.location.assign(path); } catch { /* The current view remains usable. */ }
    }
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
    let sessionId = readLocalStorage(activeChatKey);
    if (sessionId && (sessionId.length > 150 || sessionId.includes('/'))) {
      try { window.localStorage.removeItem(activeChatKey); } catch { /* Ignore corrupt or unavailable storage. */ }
      sessionId = null;
    }
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
    if (isAuthenticated && ['/', '/signin', '/login', '/chat'].includes(pathname)) {
      navigate('/dashboard');
    }
    if (!isAuthenticated && ['/dashboard', '/chat', '/vault', '/studio', '/settings'].includes(pathname)) {
      navigate('/');
    }
  }, [isAuthenticated, loading, navigate, pathname]);

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
  if (!isAuthenticated) {
    if (['/signin', '/login'].includes(pathname)) {
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
  const handleNewChat = useCallback(async () => {
    // Preserve current ongoing chat before switching
    if (currentUser?.uid && activeSession?.id && activeSession?.messages?.length > 0) {
      try {
        const { firestoreService } = await import('./services/firestoreService');
        await firestoreService.saveChatSession(currentUser.uid, activeSession.id, activeSession);
      } catch (err) {
        console.warn('Could not auto-save previous chat before new chat:', err);
      }
    }

    const newChatId = `chat_${Date.now()}`;
    const freshSession = {
      id: newChatId,
      title: 'New Chat',
      messages: [],
      updatedAt: Date.now()
    };

    if (currentUser?.uid) writeLocalStorage(`zulora_active_chat_${currentUser.uid}`, newChatId);
    setActiveSession(freshSession);
    setActiveTab('chat');
    if (pathname === '/vault' || pathname === '/studio') navigate('/dashboard');
  }, [currentUser?.uid, activeSession, pathname, navigate]);

  const handleSelectChat = session => {
    if (!session || typeof session !== 'object') return;
    if (currentUser?.uid && session?.id) writeLocalStorage(`zulora_active_chat_${currentUser.uid}`, String(session.id));
    setActiveSession(session);
    setActiveTab('chat');
    if (pathname === '/vault' || pathname === '/studio') navigate('/dashboard');
  };
  const handleUpdateSession = (updatedSession) => {
    if (!updatedSession || typeof updatedSession !== 'object') return;
    if (currentUser?.uid && updatedSession?.id) writeLocalStorage(`zulora_active_chat_${currentUser.uid}`, String(updatedSession.id));
    setActiveSession(updatedSession);
  };
  const handleSidebarSessionUpdate = updatedSession => {
    if (!updatedSession || typeof updatedSession !== 'object') return;
    setActiveSession(previous => previous?.id === updatedSession.id ? { ...previous, ...updatedSession } : previous);
  };

  return (
    <div className="h-dvh min-h-0 flex flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">

      <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-slate-500">Loading workspace...</div>}>

        {/* Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={selectTab}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onNewChat={handleNewChat}
          onOpenVoiceAssistant={() => setIsVoiceModalOpen(true)}
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
                onOpenVoiceAssistant={() => setIsVoiceModalOpen(true)}
              />
            )}
            {activeTab === 'image' && <ImageGenerator />}
            {activeTab === 'video' && <VideoGenerator />}
            {activeTab === 'brain' && <AiBrain />}
            {activeTab === 'vault' && <UserVault />}
          </main>
        </div>

      </Suspense>

      {/* Voice Assistant Modal */}
      <VoiceAssistantModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        currentUser={currentUser}
        onNewTurn={turn => {
          if (currentUser?.uid) {
            const sid = activeSession?.id || `chat_${Date.now()}`;
            const updated = {
              ...(activeSession || { id: sid, title: 'Voice Chat' }),
              messages: [
                ...(Array.isArray(activeSession?.messages) ? activeSession.messages : []),
                { id: Date.now().toString(), role: 'user', content: turn?.user || '', timestamp: Date.now() },
                { id: (Date.now() + 1).toString(), role: 'assistant', content: turn?.assistant || '', timestamp: Date.now(), model: 'Gemini Live Voice' }
              ],
              updatedAt: Date.now()
            };
            handleUpdateSession(updated);
            import('./services/firestoreService').then(({ firestoreService }) => {
              firestoreService.saveChatSession(currentUser.uid, sid, updated);
            }).catch(console.warn);
          }
        }}
      />

      {/* Modals */}
      <UsageLimitsModal isOpen={isUsageModalOpen} onClose={() => setIsUsageModalOpen(false)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />
      {isSettingsOpen && <AccountSettings onClose={() => setIsSettingsOpen(false)} />}

    </div>
  );
};

export default App;
