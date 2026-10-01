import React, { Suspense, lazy, useState, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import ChatInterface from '../components/ChatInterface';
import ImageGenerator from '../components/ImageGenerator';
import VideoGenerator from '../components/VideoGenerator';
import AiBrain from '../components/AiBrain';
import UserVault from '../components/UserVault';
import Library from '../components/Library';
import UsageLimitsModal from '../components/UsageLimitsModal';
import PricingModal from '../components/PricingModal';
import AccountSettings from './AccountSettings';
import VoiceAgentModal from '../components/VoiceAgentModal';
import ComputerPluginModal from '../components/ComputerPluginModal';
import { firestoreService } from '../services/firestoreService';

const AIStudio = lazy(() => import('./AIStudio'));

export const Dashboard = ({
  initialTab = 'chat',
  onNavigate
}) => {
  const {
    currentUser,
    userProfile,
    isAuthenticated,
    loading,
    isUsageModalOpen,
    setIsUsageModalOpen,
    isPricingModalOpen,
    setIsPricingModalOpen
  } = useAuth();

  const [activeTab, setActiveTab] = useState(() =>
    ['chat', 'image', 'video', 'brain', 'vault', 'studio', 'library'].includes(initialTab) ? initialTab : 'chat'
  );
  const [activeSession, setActiveSession] = useState(null);
  const [pendingLibraryAsset, setPendingLibraryAsset] = useState(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isComputerPluginOpen, setIsComputerPluginOpen] = useState(false);

  const safeDisplayName = currentUser?.displayName || userProfile?.displayName || 'Shiven';

  useEffect(() => {
    if (['chat', 'image', 'video', 'brain', 'vault', 'studio', 'library'].includes(initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Load / Restore active chat session
  useEffect(() => {
    if (!currentUser?.uid) return;
    let active = true;
    const activeChatKey = `zulora_active_chat_${currentUser.uid}`;
    let sessionId = null;
    try {
      sessionId = localStorage.getItem(activeChatKey);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }

    if (sessionId && sessionId.length <= 150 && !sessionId.includes('/')) {
      firestoreService.getChatSession(currentUser.uid, sessionId).then(session => {
        if (active && session && typeof session === 'object' && typeof session.id === 'string') {
          setActiveSession({
            ...session,
            messages: Array.isArray(session.messages)
              ? session.messages.filter(message => message && typeof message === 'object')
              : []
          });
        }
      }).catch(err => {
        console.warn('Could not restore chat session:', err);
      });
    } else if (sessionId) {
      try { localStorage.removeItem(activeChatKey); }
      catch (error) { console.warn('Could not remove invalid active chat state:', error); }
    }
    return () => { active = false; };
  }, [currentUser?.uid]);

  const handleNewChat = useCallback(async () => {
    if (currentUser?.uid && activeSession?.id && Array.isArray(activeSession?.messages) && activeSession.messages.length > 0) {
      try {
        await firestoreService.saveChatSession(currentUser.uid, activeSession.id, activeSession);
      } catch (err) {
        console.warn('Auto-save previous chat failed:', err);
      }
    }

    const newChatId = `chat_${Date.now()}`;
    const freshSession = {
      id: newChatId,
      title: 'New Chat',
      messages: [],
      updatedAt: Date.now()
    };

    if (currentUser?.uid) {
      try {
        localStorage.setItem(`zulora_active_chat_${currentUser.uid}`, newChatId);
      } catch {}
    }
    setActiveSession(freshSession);
    setActiveTab('chat');
    onNavigate?.('/dashboard');
  }, [currentUser?.uid, activeSession, onNavigate]);

  const handleSelectChat = useCallback((session) => {
    if (!session || typeof session !== 'object') return;
    if (currentUser?.uid && session?.id) {
      try {
        localStorage.setItem(`zulora_active_chat_${currentUser.uid}`, String(session.id));
      } catch {}
    }
    setActiveSession({
      ...session,
      messages: Array.isArray(session.messages)
        ? session.messages.filter(message => message && typeof message === 'object')
        : []
    });
    setActiveTab('chat');
    onNavigate?.('/dashboard');
  }, [currentUser?.uid, onNavigate]);

  const handleUpdateSession = useCallback((updatedSession) => {
    if (!updatedSession || typeof updatedSession !== 'object') return;
    if (currentUser?.uid && updatedSession?.id) {
      try {
        localStorage.setItem(`zulora_active_chat_${currentUser.uid}`, String(updatedSession.id));
      } catch {}
    }
    setActiveSession(updatedSession);
  }, [currentUser?.uid]);

  const handleSidebarSessionUpdate = useCallback((updatedSession) => {
    if (!updatedSession || typeof updatedSession !== 'object') return;
    setActiveSession(previous =>
      previous?.id === updatedSession.id ? { ...previous, ...updatedSession } : previous
    );
  }, []);

  const handleSelectTab = useCallback((tab) => {
    setActiveTab(tab);
    const routeByTab = {
      chat: '/dashboard',
      image: '/image',
      video: '/video',
      brain: '/brain',
      vault: '/vault',
      studio: '/studio',
      library: '/library'
    };
    if (onNavigate) onNavigate(routeByTab[tab] || '/dashboard');
  }, [onNavigate]);

  useEffect(() => {
    if (!loading && !isAuthenticated) onNavigate?.('/');
  }, [isAuthenticated, loading, onNavigate]);

  if (loading && !isAuthenticated) {
    return <div role="status" className="min-h-screen grid place-items-center bg-slate-50 text-slate-700 dark:bg-[#070b14] dark:text-slate-200"><span className="h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" /></div>;
  }
  if (!isAuthenticated || !currentUser) {
    return <div role="status" className="min-h-screen grid place-items-center bg-slate-50 text-slate-700 dark:bg-[#070b14] dark:text-slate-200">Returning to Zulora AI…</div>;
  }

  return (
    <div className="h-dvh min-h-0 flex flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Top Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onNewChat={handleNewChat}
        onOpenVoiceAssistant={() => setIsVoiceModalOpen(true)}
        onOpenComputerPlugin={() => setIsComputerPluginOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Sidebar Drawer */}
        <Sidebar
          currentChatId={activeSession?.id}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onUpdateSession={handleSidebarSessionUpdate}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          setActiveTab={handleSelectTab}
          onOpenComputerPlugin={() => setIsComputerPluginOpen(true)}
        />

        {/* Main Interactive Area */}
        <main aria-label={`${safeDisplayName}'s Zulora AI workspace`} className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
          {activeTab === 'chat' && (
            <ChatInterface
              activeSession={activeSession}
              onUpdateSession={handleUpdateSession}
              onNewChat={handleNewChat}
              onOpenVoiceAssistant={() => setIsVoiceModalOpen(true)}
              pendingLibraryAsset={pendingLibraryAsset}
              onLibraryAssetConsumed={() => setPendingLibraryAsset(null)}
            />
          )}

          {activeTab === 'image' && <ImageGenerator />}
          {activeTab === 'video' && <VideoGenerator />}
          {activeTab === 'brain' && <AiBrain />}
          {activeTab === 'vault' && <UserVault />}
          {activeTab === 'library' && <Library onInsertIntoChat={asset => { setPendingLibraryAsset(asset); handleSelectTab('chat'); }} />}

          {activeTab === 'studio' && (
            <Suspense fallback={<div className="min-h-full grid place-items-center bg-[#070914] text-slate-300">Loading AI Studio...</div>}>
              <AIStudio onExitDashboard={() => handleSelectTab('chat')} />
            </Suspense>
          )}
        </main>
      </div>

      {/* Voice Assistant Modal Overlay */}
      <VoiceAgentModal
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
            firestoreService.saveChatSession(currentUser.uid, sid, updated).catch(console.warn);
          }
        }}
      />

      {/* Modals */}
      <UsageLimitsModal isOpen={isUsageModalOpen} onClose={() => setIsUsageModalOpen(false)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />
      {isSettingsOpen && <AccountSettings onClose={() => setIsSettingsOpen(false)} />}

      {/* Computer Plugin Drawer */}
      <ComputerPluginModal
        isOpen={isComputerPluginOpen}
        onClose={() => setIsComputerPluginOpen(false)}
      />
    </div>
  );
};

export default Dashboard;
