import React, { useState } from 'react';
import { 
  Sparkles, 
  MessageSquare, 
  Image as ImageIcon, 
  Film, 
  Sun, 
  Moon, 
  LogOut, 
  Zap, 
  ShieldCheck, 
  Menu, 
  X,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { TIERS, TIER_PRICING } from '../services/firestoreService';

export const Navbar = ({ activeTab, setActiveTab, onOpenMobileSidebar }) => {
  const { 
    currentUser, 
    userProfile, 
    tier, 
    limits, 
    usage, 
    theme, 
    toggleTheme, 
    logout,
    setIsUsageModalOpen,
    setIsPricingModalOpen
  } = useAuth();

  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const LOGO_URL = "https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg";

  const getTierBadge = () => {
    if (tier === TIERS.ULTRA) {
      return {
        label: 'Ultra Pro Max 5x',
        bg: 'bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-400 border-amber-500/30'
      };
    }
    if (tier === TIERS.PRO) {
      return {
        label: 'Pro 2x Tier',
        bg: 'bg-gradient-to-r from-sky-500/20 to-blue-500/20 text-sky-400 border-sky-500/30'
      };
    }
    return {
      label: 'Free Plan',
      bg: 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
    };
  };

  const tierBadge = getTierBadge();

  return (
    <header className="sticky top-0 z-40 w-full transition-colors duration-200 glass-pearl dark:glass-dark border-b border-slate-200/80 dark:border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Left: Mobile hamburger + Brand & Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenMobileSidebar}
              className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none"
              aria-label="Open navigation sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('chat')}>
              <div className="relative group">
                <img
                  src={LOGO_URL}
                  alt="Zulora AI Logo"
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-sky-500/40 shadow-md group-hover:scale-105 transition-transform"
                />
                <div className="absolute -inset-0.5 rounded-xl bg-sky-500/20 blur opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">
                    Zulora <span className="text-sky-500">AI</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-500 border border-sky-500/20">
                    v2.5
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-none">
                  Founded by <span className="font-semibold text-slate-700 dark:text-slate-200">Shiven Panwar</span>
                </span>
              </div>
            </div>
          </div>

          {/* Center: Navigation Studio Tabs */}
          <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200/60 dark:border-slate-800/60 shadow-inner">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'chat'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat & Search</span>
            </button>

            <button
              onClick={() => setActiveTab('image')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'image'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Image Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('video')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'video'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Video Studio</span>
            </button>
          </nav>

          {/* Right: Usage chip, Theme Toggle & User Profile */}
          <div className="flex items-center gap-2.5">
            
            {/* Live Usage Indicator Chip */}
            <button
              onClick={() => setIsUsageModalOpen(true)}
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors shadow-sm"
              title="Click to view detailed usage limits and reset countdowns"
            >
              <Zap className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
              <span>
                Chats: <strong className="font-semibold">{usage.chatCount || 0}/{limits.chat}</strong>
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${tierBadge.bg}`}>
                {tierBadge.label}
              </span>
            </button>

            {/* Quick Upgrade Button if Free */}
            {tier === TIERS.FREE && (
              <button
                onClick={() => setIsPricingModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white azure-gradient-btn"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Upgrade ₹299</span>
              </button>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors"
              aria-label="Toggle color theme"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 transition-transform rotate-0 hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700 transition-transform rotate-0 hover:-rotate-12" />
              )}
            </button>

            {/* User Profile Avatar / Menu */}
            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 transition-all focus:outline-none"
              >
                <img
                  src={currentUser?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser?.uid || 'user'}`}
                  alt={currentUser?.displayName || 'User Profile'}
                  className="w-7 h-7 rounded-lg object-cover ring-1 ring-sky-500/50"
                />
                <span className="hidden xl:inline text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[100px] truncate">
                  {currentUser?.displayName?.split(' ')[0] || 'Member'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* Profile Dropdown Menu */}
              {isProfileOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsProfileOpen(false)} 
                  />
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl glass-pearl dark:glass-dark shadow-2xl border border-slate-200 dark:border-slate-700/80 p-3 z-50 animate-fade-in text-xs">
                    
                    {/* User Info Header */}
                    <div className="pb-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
                      <img
                        src={currentUser?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser?.uid || 'user'}`}
                        alt="Avatar"
                        className="w-10 h-10 rounded-xl ring-2 ring-sky-500/30"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 dark:text-white truncate">
                          {currentUser?.displayName || 'Zulora Member'}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {currentUser?.email || 'Authenticated User'}
                        </p>
                        <div className="mt-1">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${tierBadge.bg}`}>
                            {tierBadge.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Menu Actions */}
                    <div className="py-2 space-y-1">
                      <button
                        onClick={() => {
                          setIsUsageModalOpen(true);
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-sky-500" />
                          <span>Usage & Limits</span>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400">View</span>
                      </button>

                      <button
                        onClick={() => {
                          setIsPricingModalOpen(true);
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                          <span>Upgrade Tier</span>
                        </div>
                        <span className="text-[10px] font-semibold text-sky-500">₹299/mo</span>
                      </button>

                      <a
                        href="https://wa.me/916395211325"
                        target="_blank"
                        rel="noreferrer"
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-500 font-bold">WA</span>
                          <span>WhatsApp Support</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      </a>
                    </div>

                    {/* Sign Out Button */}
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800">
                      <button
                        onClick={() => {
                          setIsProfileOpen(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors font-semibold"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    </div>

                  </div>
                </>
              )}
            </div>

          </div>

        </div>
      </div>

      {/* Mobile Studio Tabs Bottom bar */}
      <div className="md:hidden flex border-t border-slate-200/70 dark:border-slate-800/70 bg-white/70 dark:bg-slate-950/70 backdrop-blur-md px-2 py-1 justify-around">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
            activeTab === 'chat'
              ? 'text-sky-500 bg-sky-50 dark:bg-sky-950/50'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
        </button>
        <button
          onClick={() => setActiveTab('image')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
            activeTab === 'image'
              ? 'text-sky-500 bg-sky-50 dark:bg-sky-950/50'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Images</span>
        </button>
        <button
          onClick={() => setActiveTab('video')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
            activeTab === 'video'
              ? 'text-sky-500 bg-sky-50 dark:bg-sky-950/50'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Videos</span>
        </button>
      </div>
    </header>
  );
};

export default Navbar;

