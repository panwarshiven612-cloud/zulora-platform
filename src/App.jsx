import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import UsageLimitsModal from './components/UsageLimitsModal';
import PricingModal from './components/PricingModal';
import LandingPage from './components/LandingPage';
import SignIn from './pages/SignIn';
import { Sparkles } from 'lucide-react';

const Navbar = lazy(() => import('./components/Navbar'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const ChatInterface = lazy(() => import('./components/ChatInterface'));
const ImageGenerator = lazy(() => import('./components/ImageGenerator'));
const VideoGenerator = lazy(() => import('./components/VideoGenerator'));

export const App = () => {
  const { 
    currentUser, 
    loading, 
    isUsageModalOpen, 
    setIsUsageModalOpen, 
    isPricingModalOpen, 
    setIsPricingModalOpen 
  } = useAuth();

  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'image' | 'video'
  const [activeSession, setActiveSession] = useState(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const navigate = useCallback((path, replace = true) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setPathname(path);
  }, []);
  const goToDashboard = useCallback(() => navigate('/dashboard'), [navigate]);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (pathname === '/dashboard' && !currentUser) navigate('/signin');
    else if (pathname === '/signin' && currentUser) navigate('/dashboard');
  }, [currentUser, loading, navigate, pathname]);

  // If initial auth check is loading, display refined glass spinner
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-white transition-colors">
        <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col items-center space-y-4">
          <div className="relative">
            <img
              src="https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg"
              alt="Zulora Logo"
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-sky-500 shadow-lg animate-pulse"
            />
            <div className="absolute -inset-1 rounded-2xl bg-sky-500/30 blur animate-ping" />
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-black tracking-tight">
              Zulora <span className="text-sky-500">AI</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Initializing Secure Multi-Model Intelligence...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if ((pathname === '/signin' || pathname === '/dashboard') && !currentUser) {
    return <SignIn onAuthenticated={goToDashboard} />;
  }

  if (pathname === '/signin' && currentUser) {
    return null;
  }

  if (pathname !== '/dashboard') {
    return <LandingPage />;
  }

  // Handle creating a new chat
  const handleNewChat = () => {
    setActiveSession(null);
    setActiveTab('chat');
  };

  const handleSelectChat = (session) => {
    setActiveSession(session);
    setActiveTab('chat');
  };

  const handleUpdateSession = (updatedSession) => {
    setActiveSession(updatedSession);
  };

  return (
    <div className="h-dvh min-h-0 flex flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      <Suspense fallback={<div className="flex-1 min-h-0 grid place-items-center text-sm text-slate-500">Loading Zulora workspace…</div>}>
        {/* Top Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
        />

        {/* Main Workspace with Sidebar & Active Studio */}
        <div className="flex-1 min-h-0 flex overflow-hidden max-w-full">
          <Sidebar
            currentChatId={activeSession?.id}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
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

      {/* Usage Limits Dedicated Modal */}
      <UsageLimitsModal
        isOpen={isUsageModalOpen}
        onClose={() => setIsUsageModalOpen(false)}
      />

      {/* Pricing Modal */}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />

    </div>
  );
};

export default App;
