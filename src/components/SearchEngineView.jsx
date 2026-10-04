import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Sparkles,
  ArrowRight,
  Globe,
  ExternalLink,
  ShieldCheck,
  Zap,
  Cpu,
  Layers,
  Code2,
  Wand2,
  Film,
  Sun,
  Moon,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { guestGate } from '../services/guestGate';
import { webSearch } from '../services/webSearch';
import ZuloraLogo from './ZuloraLogo';
import GuestGateModal from './GuestGateModal';

const SUGGESTIONS = [
  'Latest AI breakthroughs and models in 2026',
  'What is quantum computing and how does it work?',
  'Global stock market trends and tech earnings',
  'Next-generation renewable energy developments',
  'Best frameworks for modern web development'
];

export const SearchEngineView = ({ onNavigate, onSignIn }) => {
  const { currentUser, isAuthenticated, theme, toggleTheme } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchData, setSearchData] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [gateStatus, setGateStatus] = useState(() => guestGate.check());
  const [gateModal, setGateModal] = useState({ open: false, feature: null, reason: '' });
  const resultsRef = useRef(null);

  useEffect(() => {
    setGateStatus(guestGate.check());
  }, []);

  const handleProtectedAction = (featureName, targetPath) => {
    if (isAuthenticated) {
      onNavigate?.(targetPath);
      return;
    }
    // Guest clicked a restricted feature
    setGateModal({
      open: true,
      feature: featureName,
      reason: `sign in to access ${featureName}`
    });
  };

  const executeSearch = async (searchQuery) => {
    const q = String(searchQuery || query).trim();
    if (!q) return;

    // If unauthenticated, check guest limit
    if (!isAuthenticated) {
      const current = guestGate.check();
      if (!current.allowed) {
        setGateModal({
          open: true,
          feature: null,
          reason: 'you have reached your 10 free search limit'
        });
        return;
      }
      // Consume 1 search
      const updated = guestGate.consume();
      setGateStatus(updated);
    }

    setSearching(true);
    setSearchError('');
    setSearchData(null);

    try {
      const data = await webSearch(q);
      setSearchData({
        query: q,
        results: data.results || [],
        context: data.context || '',
        timestamp: Date.now()
      });

      // Smooth scroll to results
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchError('Search is temporarily unavailable. Please retry in a moment.');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 transition-colors">
      {/* ─── Top Navbar ─── */}
      <header className="sticky top-0 z-40 w-full glass-pearl dark:glass-dark border-b border-white/60 dark:border-slate-800/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate?.('/')}>
            <div className="w-9 h-9 p-1 rounded-xl bg-white/40 dark:bg-slate-800/40 border border-white/60 dark:border-slate-700/50 shadow-md flex items-center justify-center">
              <ZuloraLogo className="w-7 h-7 rounded-lg" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-black text-slate-900 dark:text-white text-base tracking-tight">
                Zulora <span className="text-sky-500">AI</span>
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:block">
                Web Search Engine
              </span>
            </div>
          </div>

          {/* Quick Nav Links */}
          <nav className="hidden md:flex items-center gap-1.5 text-xs font-semibold">
            <button
              onClick={() => onNavigate?.('/')}
              className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/40 flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>AI Search</span>
            </button>
            <button
              onClick={() => handleProtectedAction('Dashboard', '/dashboard')}
              className="px-3 py-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors"
            >
              Dashboard
            </button>
            <button
              onClick={() => handleProtectedAction('AI Studio', '/studio')}
              className="px-3 py-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors"
            >
              AI Studio
            </button>
            <button
              onClick={() => handleProtectedAction('Image & Video Studio', '/image')}
              className="px-3 py-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors"
            >
              Media Studio
            </button>
          </nav>

          {/* Right Action Items */}
          <div className="flex items-center gap-2.5">
            {/* Guest limit indicator */}
            {!isAuthenticated && (
              <div
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/40"
                title={`${gateStatus.remaining} free searches remaining`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>{gateStatus.remaining}/10 Free Demo</span>
              </div>
            )}

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-all border border-slate-200/60 dark:border-slate-700/50"
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>

            {/* Sign in / Account */}
            {isAuthenticated ? (
              <button
                onClick={() => onNavigate?.('/dashboard')}
                className="azure-gradient-btn text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-md"
              >
                <span>Open Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={onSignIn}
                className="azure-gradient-btn text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-md"
              >
                <span>Sign In Free</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Search Hero Section ─── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pt-16 pb-12 text-center relative overflow-hidden">
        {/* Glow effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-r from-sky-400/20 via-indigo-500/15 to-violet-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl w-full mx-auto space-y-6">
          {/* Logo badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200/60 dark:border-slate-700/50 text-xs font-semibold text-slate-600 dark:text-slate-300 shadow-sm">
            <ZuloraLogo className="w-4 h-4 rounded" />
            <span>Zulora AI · Live Web Search Engine</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
            Search the Live Web with{' '}
            <span className="azure-gradient-text">Zulora AI</span>
          </h1>

          <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
            Real-time web crawling, zero training cutoff, and factual answers with verified source citations.
          </p>

          {/* ── Search Input Box ── */}
          <div className="relative w-full max-w-2xl mx-auto">
            <div className="relative flex items-center rounded-2xl glass-pearl dark:glass-dark border-2 border-slate-200/80 dark:border-slate-700/80 focus-within:border-sky-500 dark:focus-within:border-sky-400 shadow-2xl transition-all">
              <Search className="w-5 h-5 ml-4 text-slate-400 flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything or search the live web..."
                className="w-full py-4 px-3.5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 text-sm sm:text-base focus:outline-none"
              />
              <button
                type="button"
                onClick={() => executeSearch()}
                disabled={searching || !query.trim()}
                className="mr-2.5 px-5 py-2.5 rounded-xl azure-gradient-btn text-white text-sm font-bold flex items-center gap-1.5 shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {searching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <span>Search</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Free search counter below input for guests */}
            {!isAuthenticated && (
              <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 px-2">
                <span>
                  Demo Mode: <strong>{gateStatus.remaining} of 10 free searches</strong> left today
                </span>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="text-sky-500 hover:text-sky-400 font-semibold"
                >
                  Sign in for unlimited
                </button>
              </div>
            )}
          </div>

          {/* Suggestion Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setQuery(s);
                  executeSearch(s);
                }}
                className="px-3.5 py-1.5 rounded-full text-xs bg-white/70 dark:bg-slate-800/60 hover:bg-sky-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 transition-colors shadow-sm"
              >
                {s}
              </button>
            ))}
          </div>

          {searchError && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 text-xs text-red-600 dark:text-red-400">
              {searchError}
            </div>
          )}
        </div>

        {/* ── Search Results Card ── */}
        {searchData && (
          <div ref={resultsRef} className="mt-12 max-w-3xl w-full text-left space-y-5 animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Results for &ldquo;{searchData.query}&rdquo;
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                {searchData.results.length} verified sources
              </span>
            </div>

            {/* Sources Cards Carousel */}
            {searchData.results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Grounding Sources
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {searchData.results.slice(0, 6).map((src, i) => {
                    const host = (() => {
                      try { return new URL(src.url).hostname.replace('www.', ''); } catch { return src.url; }
                    })();
                    return (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group p-3 rounded-2xl glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800/80 hover:border-sky-400 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[10px] text-sky-500 font-semibold">
                            <span className="w-4 h-4 rounded bg-sky-500/10 text-sky-500 flex items-center justify-center font-bold">
                              {i + 1}
                            </span>
                            <span className="truncate">{host}</span>
                            <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-2">
                            {src.title || host}
                          </p>
                        </div>
                        {src.snippet && (
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                            {src.snippet}
                          </p>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Synthesized Answer */}
            <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800/80 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-500">
                <Sparkles className="w-4 h-4" />
                <span>AI Grounded Summary</span>
              </div>
              <div className="prose dark:prose-invert max-w-none text-sm text-slate-700 dark:text-slate-300 leading-relaxed space-y-3">
                {searchData.results.map((r, i) => (
                  <p key={i}>
                    <strong className="text-slate-900 dark:text-white">{r.title}:</strong> {r.snippet}{' '}
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-500 hover:underline text-xs font-semibold"
                    >
                      [{i + 1}]
                    </a>
                  </p>
                ))}
              </div>

              {/* Ask Follow-up prompt */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-500">Want deeper multi-turn reasoning?</span>
                <button
                  type="button"
                  onClick={() => handleProtectedAction('Full AI Chat', '/dashboard')}
                  className="azure-gradient-btn text-white font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
                >
                  <span>Chat in Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── Sleek Features & Pricing Showcase ─── */}
      <section className="border-t border-slate-200/70 dark:border-slate-800/70 py-16 px-4 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
              Explore the Full <span className="azure-gradient-text">Zulora AI Ecosystem</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              Unlock multi-model chat, code creation, high-definition image generation, and cinematic video.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: Cpu,
                title: 'Multi-Model AI Chat',
                desc: '7+ models with smart failover across Gemini, Groq, Cerebras & Mistral.',
                action: 'Open Chat',
                path: '/dashboard'
              },
              {
                icon: Wand2,
                title: 'AI Image Studio',
                desc: 'FLUX diffusion engine rendering photorealistic images in seconds with zero watermark.',
                action: 'Generate Images',
                path: '/image'
              },
              {
                icon: Film,
                title: 'Cinematic Video Studio',
                desc: 'Text-to-video AI generating cinematic MP4 clips with motion controls.',
                action: 'Create Videos',
                path: '/video'
              },
              {
                icon: Code2,
                title: 'AI Code Studio',
                desc: 'Interactive live web application generator with instant sandboxed previews.',
                action: 'Build Apps',
                path: '/studio'
              },
              {
                icon: Globe,
                title: 'Real-Time Web Grounding',
                desc: 'Instant web search citations attached to every answer for verified facts.',
                action: 'Live Search',
                path: '/'
              },
              {
                icon: ShieldCheck,
                title: 'Zulora Cloud Drive',
                desc: 'Secure cloud storage integrated directly with all generated AI creations.',
                action: 'View Drive',
                path: '/dashboard'
              }
            ].map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl glass-pearl dark:glass-dark border border-white/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center font-bold">
                    <f.icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">{f.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleProtectedAction(f.title, f.path)}
                  className="mt-5 text-xs font-bold text-sky-500 hover:text-sky-400 inline-flex items-center gap-1 self-start"
                >
                  <span>{f.action}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 px-4 text-center text-xs text-slate-500">
        <p>© 2026 Zulora AI · Founded & Created by Shiven Panwar · All rights reserved.</p>
      </footer>

      {/* ─── Sleek Guest Gate Modal ─── */}
      {gateModal.open && (
        <GuestGateModal
          onSignIn={() => {
            setGateModal({ open: false, feature: null, reason: '' });
            onSignIn?.();
          }}
          onClose={() => setGateModal({ open: false, feature: null, reason: '' })}
          reason={gateModal.reason}
          featureName={gateModal.feature}
        />
      )}
    </div>
  );
};

export default SearchEngineView;
