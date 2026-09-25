import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles, MessageSquare, Image as ImageIcon, Film,
  Sun, Moon, LogOut, ChevronDown, Menu, Zap, BarChart3,
  User, Crown, Settings, Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

const TAB_CONFIG = [
  { id: 'chat',  label: 'AI Chat',       icon: MessageSquare, description: 'Multi-model chat' },
  { id: 'image', label: 'Image Studio',  icon: ImageIcon,     description: 'AI image generation' },
  { id: 'video', label: 'Video Studio',  icon: Film,          description: 'AI video synthesis' },
];

const Navbar = ({ activeTab, setActiveTab, onOpenMobileSidebar, onOpenSettings }) => {
  const {
    currentUser, theme, toggleTheme, logout, tier,
    setIsUsageModalOpen, setIsPricingModalOpen, userProfile,
  } = useAuth();

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tierLabel =
    tier === 'ultra' ? 'Ultra Pro' :
    tier === 'pro'   ? 'Pro'       : 'Free';
  const tierGradient =
    tier === 'ultra' ? 'from-violet-500 to-purple-600' :
    tier === 'pro'   ? 'from-amber-500 to-orange-500'  : 'from-slate-400 to-slate-500';

  return (
    <header className="sticky top-0 z-40 glass-pearl dark:glass-dark border-b border-white/60 dark:border-slate-800/60 shadow-sm">
      <div className="flex items-center h-14 px-3 md:px-5 gap-2">

        {/* Mobile Menu Button */}
        <button
          onClick={onOpenMobileSidebar}
          className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors flex-shrink-0"
          aria-label="Open sidebar"
        >
          <Menu className="w-4.5 h-4.5" />
        </button>

        {/* Brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl overflow-hidden ring-2 ring-sky-500/30 shadow-sm flex-shrink-0">
            <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
          </div>
          <div className="hidden sm:flex flex-col leading-tight">
            <span className="font-black text-slate-900 dark:text-white text-sm tracking-tight">
              Zulora <span className="text-sky-500">AI</span>
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight">
              by Shiven Panwar
            </span>
          </div>
        </div>

        {/* Studio Tabs */}
        <nav className="flex-1 flex items-center justify-center gap-1 mx-2">
          <div className="flex items-center gap-1 glass-pearl dark:glass-dark rounded-xl border border-white/70 dark:border-slate-700/50 p-1 shadow-sm">
            {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap ${
                  activeTab === id
                    ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/40'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">

          {/* Usage */}
          <button
            onClick={() => setIsUsageModalOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200/60 dark:border-slate-700/50 text-xs font-medium text-slate-600 dark:text-slate-400 hover:border-sky-400/60 hover:text-sky-500 dark:hover:text-sky-400 glass-pearl dark:glass-dark transition-all"
          >
            <BarChart3 className="w-3.5 h-3.5 text-sky-500" />
            <span>Usage</span>
          </button>

          {/* Upgrade / Tier Badge */}
          {tier === 'free' ? (
            <button
              onClick={() => setIsPricingModalOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg azure-gradient-btn text-white text-xs font-semibold shadow-sm"
            >
              <Zap className="w-3.5 h-3.5" /> Upgrade
            </button>
          ) : (
            <div className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r ${tierGradient} text-white text-xs font-bold shadow-sm`}>
              <Crown className="w-3 h-3" /> {tierLabel}
            </div>
          )}

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 border border-slate-200/60 dark:border-slate-700/50 transition-all"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {/* Profile Menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileMenuOpen(v => !v)}
              className="flex items-center gap-1.5 h-8 rounded-xl pl-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 transition-all"
              aria-expanded={profileMenuOpen}
            >
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt="" className="w-6 h-6 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">{currentUser?.displayName?.[0] || '?'}</span>
                </div>
              )}
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 hidden sm:block ${profileMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {profileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 glass-elevated dark:glass-dark rounded-2xl border border-white/80 dark:border-slate-700/60 shadow-2xl z-50 overflow-hidden animate-scale-in">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    {currentUser?.photoURL ? (
                      <img src={currentUser.photoURL} alt="" className="w-9 h-9 rounded-xl object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center">
                        <span className="font-bold text-white text-sm">{currentUser?.displayName?.[0] || '?'}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{currentUser?.displayName || 'User'}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{currentUser?.email}</p>
                    </div>
                  </div>
                  <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${tierGradient} text-white text-[10px] font-bold`}>
                    <Crown className="w-2.5 h-2.5" /> {tierLabel} Plan
                  </div>
                </div>

                {/* Menu Items */}
                <div className="p-1.5">
                  <button onClick={() => { setIsUsageModalOpen(true); setProfileMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-sky-500 dark:hover:text-sky-400 transition-all">
                    <BarChart3 className="w-4 h-4 text-sky-500" /> View Usage
                  </button>
                  {tier === 'free' && (
                    <button onClick={() => { setIsPricingModalOpen(true); setProfileMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-amber-500 transition-all">
                      <Crown className="w-4 h-4 text-amber-500" /> Upgrade to Pro
                    </button>
                  )}
                  {/* Account Settings — DPDP data deletion */}
                  <button onClick={() => { onOpenSettings?.(); setProfileMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all">
                    <Settings className="w-4 h-4 text-slate-500" /> Account Settings
                  </button>
                  <div className="border-t border-slate-100 dark:border-slate-800/60 my-1" />
                  <button onClick={() => { logout(); setProfileMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
