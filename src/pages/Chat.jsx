import React, { useState, useEffect, useCallback } from 'react';
import { Menu, Plus, Radio, Sparkles } from 'lucide-react';
import ChatInterface from '../components/ChatInterface';
import VoiceAssistantModal from '../components/VoiceAssistantModal';
import { firestoreService } from '../services/firestoreService';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

export const Chat = ({
  activeSession,
  onUpdateSession,
  onNewChat,
  onOpenMobileSidebar
}) => {
  const { currentUser } = useAuth();
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden relative bg-[#f8fafc] dark:bg-[#070b14]">
      {/* Sticky Mobile Chat Topbar with Hamburger Menu and New Chat Button */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2.5 glass-pearl dark:glass-dark border-b border-white/60 dark:border-slate-800/80 shadow-sm">
        <div className="flex items-center gap-2">
          {onOpenMobileSidebar && (
            <button
              onClick={onOpenMobileSidebar}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
              aria-label="Open sidebar drawer"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <img src={LOGO_URL} alt="Zulora" className="w-6 h-6 rounded-lg object-cover ring-1 ring-sky-500/40" />
            <span className="font-extrabold text-xs text-slate-900 dark:text-white">
              Zulora <span className="text-sky-500">AI</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mobile Live Voice Button */}
          <button
            onClick={() => setIsVoiceOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-sky-600 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 border border-sky-300/60 dark:border-sky-700/60"
            title="Open Gemini Live Voice"
          >
            <Radio className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
            <span>Voice</span>
          </button>

          {/* Mobile Prominent New Chat (+) Button */}
          <button
            onClick={onNewChat}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold text-xs text-white azure-gradient-btn shadow-sm"
            title="Create New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Main Chat Interface */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        <ChatInterface
          activeSession={activeSession}
          onUpdateSession={onUpdateSession}
          onNewChat={onNewChat}
          onOpenVoiceAssistant={() => setIsVoiceOpen(true)}
        />
      </div>

      {/* Voice Assistant Modal Overlay */}
      <VoiceAssistantModal
        isOpen={isVoiceOpen}
        onClose={() => setIsVoiceOpen(false)}
        currentUser={currentUser}
        onNewTurn={turn => {
          if (activeSession?.id && currentUser?.uid) {
            const updated = {
              ...activeSession,
              messages: [
                ...(activeSession.messages || []),
                { id: Date.now().toString(), role: 'user', content: turn.user, timestamp: Date.now() },
                { id: (Date.now() + 1).toString(), role: 'assistant', content: turn.assistant, timestamp: Date.now(), model: 'Gemini Live Voice' }
              ],
              updatedAt: Date.now()
            };
            onUpdateSession?.(updated);
            firestoreService.saveChatSession(currentUser.uid, activeSession.id, updated).catch(console.warn);
          }
        }}
      />
    </div>
  );
};

export default Chat;
