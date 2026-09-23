import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Search, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Zap, 
  Sparkles, 
  Film, 
  Clock, 
  HelpCircle, 
  ChevronLeft, 
  ChevronRight,
  ExternalLink,
  MessageCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService, TIERS } from '../services/firestoreService';

export const Sidebar = ({ 
  currentChatId, 
  onSelectChat, 
  onNewChat, 
  isMobileOpen, 
  onCloseMobile,
  setActiveTab
}) => {
  const { 
    currentUser, 
    tier, 
    limits, 
    usage, 
    setIsUsageModalOpen, 
    setIsPricingModalOpen 
  } = useAuth();

  const [sessions, setSessions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resetCountdown, setResetCountdown] = useState('');

  // Load chat sessions from Firestore / LocalStorage
  const loadSessions = async () => {
    if (!currentUser?.uid) return;
    const list = await firestoreService.getChatSessions(currentUser.uid);
    setSessions(list);
  };

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [currentUser?.uid]);

  // Dynamic countdown timer for Chat Window (2 hours rolling)
  useEffect(() => {
    const updateCountdown = () => {
      const windowStart = usage.chatWindowStart || Date.now();
      const twoHours = 2 * 60 * 60 * 1000;
      const msLeft = Math.max(0, (windowStart + twoHours) - Date.now());

      if (msLeft === 0) {
        setResetCountdown('Reset available');
        return;
      }

      const hours = Math.floor(msLeft / (1000 * 60 * 60));
      const minutes = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((msLeft % (1000 * 60)) / 1000);

      if (hours > 0) {
        setResetCountdown(`${hours}h ${minutes}m`);
      } else {
        setResetCountdown(`${minutes}m ${seconds}s`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [usage.chatWindowStart]);

  const handleStartRename = (session, e) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title || 'Untitled Chat');
  };

  const handleSaveRename = async (sessionId, e) => {
    e?.stopPropagation();
    if (!editTitle.trim()) return;
    await firestoreService.renameChatSession(currentUser.uid, sessionId, editTitle.trim());
    setEditingId(null);
    await loadSessions();
  };

  const handleDelete = async (sessionId, e) => {
    e.stopPropagation();
    if (confirm('Delete this chat session?')) {
      await firestoreService.deleteChatSession(currentUser.uid, sessionId);
      if (currentChatId === sessionId) {
        onNewChat();
      }
      await loadSessions();
    }
  };

  // Group sessions by date
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  const todaySessions = sessions.filter(s => now - (s.updatedAt || 0) < oneDay);
  const weekSessions = sessions.filter(s => {
    const diff = now - (s.updatedAt || 0);
    return diff >= oneDay && diff < sevenDays;
  });
  const olderSessions = sessions.filter(s => now - (s.updatedAt || 0) >= sevenDays);

  const renderSessionItem = (session) => {
    const isSelected = currentChatId === session.id;
    const isEditing = editingId === session.id;

    return (
      <div
        key={session.id}
        onClick={() => {
          onSelectChat(session);
          if (onCloseMobile) onCloseMobile();
        }}
        className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
          isSelected
            ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/80 shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {session.mode === 'search' ? (
            <Search className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-500 shrink-0" />
          )}

          {isEditing ? (
            <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveRename(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full px-2 py-0.5 rounded bg-white dark:bg-slate-900 text-xs border border-sky-500 focus:outline-none"
                autoFocus
              />
              <button
                onClick={e => handleSaveRename(session.id, e)}
                className="p-1 text-emerald-500 hover:text-emerald-600"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  setEditingId(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span className="truncate flex-1">{session.title || 'Untitled Chat'}</span>
          )}
        </div>

        {/* Action icons on hover */}
        {!isEditing && (
          <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
            <button
              onClick={e => handleStartRename(session, e)}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
              title="Rename chat"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={e => handleDelete(session.id, e)}
              className="p-1 text-slate-400 hover:text-red-500 rounded"
              title="Delete chat"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800/80">
      
      {/* Top action: New Chat Button */}
      <div className="p-3 border-b border-slate-200/80 dark:border-slate-800/80">
        <button
          onClick={() => {
            onNewChat();
            if (onCloseMobile) onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white azure-gradient-btn shadow-md group"
        >
          <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
          <span>New Chat & Search</span>
        </button>
      </div>

      {/* Studios Quick Navigator */}
      <div className="p-3 pb-1 border-b border-slate-200/60 dark:border-slate-800/60">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1.5 block">
          Creative Studios
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => {
              setActiveTab('image');
              if (onCloseMobile) onCloseMobile();
            }}
            className="flex items-center gap-2 p-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-500" />
            <span>Image Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('video');
              if (onCloseMobile) onCloseMobile();
            }}
            className="flex items-center gap-2 p-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 transition-colors"
          >
            <Film className="w-3.5 h-3.5 text-indigo-500" />
            <span>Video Studio</span>
          </button>
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {sessions.length === 0 ? (
          <div className="text-center py-10 px-4">
            <MessageSquare className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">No chat history yet</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Start asking questions or searching the web!
            </p>
          </div>
        ) : (
          <>
            {todaySessions.length > 0 && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1.5 block">
                  Today
                </span>
                <div className="space-y-1">
                  {todaySessions.map(renderSessionItem)}
                </div>
              </div>
            )}

            {weekSessions.length > 0 && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1.5 block">
                  Previous 7 Days
                </span>
                <div className="space-y-1">
                  {weekSessions.map(renderSessionItem)}
                </div>
              </div>
            )}

            {olderSessions.length > 0 && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1.5 block">
                  Older
                </span>
                <div className="space-y-1">
                  {olderSessions.map(renderSessionItem)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Usage & Credit Summary Card */}
      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80">
        <div className="p-3 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800/80 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-sky-500" />
              <span>Usage Limits</span>
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>{resetCountdown}</span>
            </span>
          </div>

          {/* Chat Limit Bar */}
          <div>
            <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
              <span>Chats (2h)</span>
              <span>{usage.chatCount || 0} / {limits.chat}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div 
                className="h-full bg-sky-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, ((usage.chatCount || 0) / limits.chat) * 100)}%` }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setIsUsageModalOpen(true)}
              className="flex-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-center"
            >
              Details
            </button>
            {tier === TIERS.FREE ? (
              <button
                onClick={() => setIsPricingModalOpen(true)}
                className="flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold text-white azure-gradient-btn text-center"
              >
                Upgrade 2x
              </button>
            ) : (
              <span className="text-[10px] font-bold text-sky-500 px-2 py-1 rounded bg-sky-500/10">
                {tier === TIERS.ULTRA ? 'Ultra 5x' : 'Pro 2x'}
              </span>
            )}
          </div>
        </div>

        {/* WhatsApp & Email Help shortcuts */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
          <a
            href="https://wa.me/916395211325"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-emerald-500 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
            <span>WA Help</span>
          </a>
          <a
            href="mailto:zulora.help@gmail.com"
            className="hover:text-sky-500 transition-colors"
          >
            Email Support
          </a>
        </div>
      </div>

    </div>
  );

  return (
    <>
      {/* Desktop Sidebar Rail */}
      <aside 
        className={`hidden md:block shrink-0 transition-all duration-300 h-[calc(100vh-4rem)] ${
          isCollapsed ? 'w-16' : 'w-72'
        }`}
      >
        {isCollapsed ? (
          <div className="h-full flex flex-col items-center py-4 bg-white/70 dark:bg-slate-950/70 border-r border-slate-200 dark:border-slate-800 space-y-4">
            <button
              onClick={() => setIsCollapsed(false)}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
              title="Expand Sidebar"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={onNewChat}
              className="p-3 rounded-xl azure-gradient-btn text-white shadow-md"
              title="New Chat"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => setActiveTab('image')}
              className="p-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Image Studio"
            >
              <Sparkles className="w-5 h-5" />
            </button>
            <button
              onClick={() => setActiveTab('video')}
              className="p-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Video Studio"
            >
              <Film className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsUsageModalOpen(true)}
              className="p-2.5 rounded-xl text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Usage Limits"
            >
              <Zap className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="relative h-full">
            {sidebarContent}
            <button
              onClick={() => setIsCollapsed(true)}
              className="absolute -right-3 top-5 p-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-sky-500 shadow-md z-10"
              title="Collapse sidebar"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
            onClick={onCloseMobile}
          />
          <div className="relative w-80 max-w-[85vw] h-full z-10 shadow-2xl animate-fade-in">
            {sidebarContent}
            <button
              onClick={onCloseMobile}
              className="absolute top-3 right-3 p-1.5 rounded-xl text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;

