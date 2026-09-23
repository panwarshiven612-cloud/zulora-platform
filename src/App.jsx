import React, { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import ImageGenerator from './components/ImageGenerator';
import VideoGenerator from './components/VideoGenerator';
import UsageLimitsModal from './components/UsageLimitsModal';
import PricingModal from './components/PricingModal';
import Footer from './components/Footer';
import LandingPage from './components/LandingPage';
import SignIn from './pages/SignIn';
import { Sparkles } from 'lucide-react';

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

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    return <SignIn />;
  }

  if (pathname === '/signin' && currentUser) {
    window.history.replaceState({}, '', '/dashboard');
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
    <div className="min-h-screen flex flex-col bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Top Navbar */}
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
      />

      {/* Main Workspace with Sidebar & Active Studio */}
      <div className="flex-1 flex overflow-hidden max-w-full">
        
        {/* Left Sidebar */}
        <Sidebar
          currentChatId={activeSession?.id}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          setActiveTab={setActiveTab}
        />

        {/* Studio Viewport */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
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

      {/* Footer */}
      <Footer />

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

