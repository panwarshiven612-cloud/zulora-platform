import React, { useState } from 'react';
import { 
  Sparkles, 
  MessageSquare, 
  Image as ImageIcon, 
  Film, 
  ShieldCheck, 
  Zap, 
  ArrowRight, 
  Globe, 
  Lock, 
  UserCheck, 
  ExternalLink,
  MessageCircle,
  Mail,
  CheckCircle2,
  Cpu,
  Layers,
  HelpCircle,
  Star,
  Sun,
  Moon,
  Clock,
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LandingPage = () => {
  const { 
    signInWithGoogle, 
    signInAsDemo, 
    theme, 
    toggleTheme 
  } = useAuth();

  const [authError, setAuthError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  const LOGO_URL = "https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg";

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    const result = await signInWithGoogle();
    if (!result.success) {
      setAuthError(result);
    }
    setSigningIn(false);
  };

  const handleDemoSignIn = async () => {
    setSigningIn(true);
    await signInAsDemo();
    setSigningIn(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 selection:bg-sky-500 selection:text-white transition-colors duration-200">
      
      {/* Landing Header */}
      <header className="sticky top-0 z-40 w-full glass-pearl dark:glass-dark border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-3.5">
            <div className="relative group">
              <img
                src={LOGO_URL}
                alt="Zulora AI Logo"
                className="w-12 h-12 rounded-2xl object-cover ring-2 ring-sky-500/50 shadow-md group-hover:scale-105 transition-transform"
              />
              <div className="absolute -inset-1 rounded-2xl bg-sky-500/20 blur opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Zulora <span className="text-sky-500">AI</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-500 border border-sky-500/20">
                  Protected Access
                </span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Created by <strong>Zulora</strong> | Made by <strong className="text-slate-700 dark:text-slate-200">Shiven Panwar</strong>
              </span>
            </div>
          </div>

          {/* Right Header: Theme Toggle & Sign In CTA */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white azure-gradient-btn flex items-center gap-2 shadow-md hover:shadow-azure-glow"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Sign In with Google</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        
        {/* Hero Section */}
        <section className="relative px-4 sm:px-6 lg:px-8 py-16 sm:py-24 max-w-7xl mx-auto text-center space-y-8">
          
          {/* Subtle Azure radial glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[32rem] h-[32rem] bg-sky-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-pearl dark:glass-dark border border-sky-500/30 text-sky-600 dark:text-sky-400 text-xs font-bold shadow-sm animate-fade-in">
            <Sparkles className="w-4 h-4 text-sky-500 animate-pulse" />
            <span>Pristine Pearl & Azure Glassmorphic AI Suite</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-slate-900 dark:text-white max-w-4xl mx-auto leading-tight sm:leading-none">
            Intelligence without limits, engineered by <span className="azure-gradient-text">Zulora AI</span>.
          </h1>

          {/* Subheading */}
          <p className="text-sm sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Welcome to the flagship AI platform created by <strong>Shiven Panwar (Young Entrepreneur)</strong>. Multi-model text reasoning, deep web research, high-definition visual generation, and cinematic video synthesis under one seamless interface.
          </p>

          {/* Authentication Access-Gated Card */}
          <div className="max-w-md mx-auto p-6 sm:p-8 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 text-center">
            
            <div className="space-y-1">
              <span className="text-xs font-extrabold uppercase tracking-wider text-sky-500">
                Authentication Required
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign in with Google to enter your private dashboard and unlock real-time Firestore credit quotas.
              </p>
            </div>

            {/* Google OAuth Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="w-full py-3.5 px-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-500 text-slate-800 dark:text-slate-100 font-bold text-xs sm:text-sm flex items-center justify-center gap-3 shadow-md hover:shadow-lg transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>{signingIn ? 'Connecting to Google OAuth...' : 'Sign in with Google'}</span>
            </button>

            {/* Error / Domain Notice Banner */}
            {authError && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-500/30 text-left text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Google Authentication Note</span>
                </div>
                <p className="text-[11px] leading-tight">
                  {authError.code === 'auth/unauthorized-domain'
                    ? "Domain not yet registered in Firebase Console authorized domains. You can immediately access the full platform using Guest/Demo mode below."
                    : authError.error || "Please allow popup windows or use Guest access."}
                </p>
              </div>
            )}

            {/* Instant Demo Session Bypass */}
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800">
              <button
                onClick={handleDemoSignIn}
                className="w-full py-2.5 px-3 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-sky-500 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Enter with Guest / Demo Session</span>
              </button>
            </div>

          </div>

          {/* 4 Feature Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto pt-10 text-left">
            
            <div className="p-5 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass space-y-2">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Multi-Model Chat</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automated waterfall routing across 7-key Google Gemini, Groq Llama 3.3, Cerebras, and OpenRouter.
              </p>
            </div>

            <div className="p-5 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass space-y-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Deep Web Research</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ground answers in real-time internet search results with verifiable citations and sources.
              </p>
            </div>

            <div className="p-5 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass space-y-2">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
                <ImageIcon className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Image Studio</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate 8K visuals with FLUX.1-schnell, SDXL, Fal AI, aspect ratio selectors, and style presets.
              </p>
            </div>

            <div className="p-5 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass space-y-2">
              <div className="w-10 h-10 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center">
                <Film className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Video Studio</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create dynamic cinematic video clips with camera movement presets and MP4 exports.
              </p>
            </div>

          </div>

        </section>

        {/* Usage Limits & Plans Overview on Landing Page */}
        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-white/40 dark:bg-slate-900/30 border-y border-slate-200/80 dark:border-slate-800/80">
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-500">
                Transparent Quotas
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
                Usage Limits & Multiplier Tiers
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                All limits are stored in Cloud Firestore and reset dynamically per rolling window.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Free Tier */}
              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Free Tier</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">1x Base</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white">₹0</div>
                  <div className="text-xs text-slate-400">Default for all registered members</div>
                </div>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>50 Chats</strong> per 2 hours (Rolling)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>30 Images</strong> per day (24h)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>4 Videos</strong> per day (24h)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span>Automated Multi-Model failover</span>
                  </li>
                </ul>
              </div>

              {/* Pro Tier (₹299) */}
              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-sky-500/80 shadow-azure-glow space-y-4 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-500 text-white">
                  Most Popular • 2x
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-500">Pro Upgrade</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400">2x Limits</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white">₹299 <span className="text-xs font-normal text-slate-400">/ mo</span></div>
                  <div className="text-xs text-sky-500 font-semibold">Doubles all free tier limits</div>
                </div>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>100 Chats</strong> per 2 hours (2x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>60 Images</strong> per day (2x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span><strong>8 Videos</strong> per day (2x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-sky-500" />
                    <span>Priority Groq & Gemini speed</span>
                  </li>
                </ul>
              </div>

              {/* Ultra Pro Max Tier (₹599) */}
              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-amber-500/80 shadow-lg space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-500">Ultra Pro Max</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">5x Limits</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white">₹599 <span className="text-xs font-normal text-slate-400">/ mo</span></div>
                  <div className="text-xs text-amber-500 font-semibold">5x usage limits across all models</div>
                </div>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-amber-500" />
                    <span><strong>250 Chats</strong> per 2 hours (5x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-amber-500" />
                    <span><strong>150 Images</strong> per day (5x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-amber-500" />
                    <span><strong>20 Videos</strong> per day (5x)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-amber-500" />
                    <span>Dedicated compute priority</span>
                  </li>
                </ul>
              </div>

            </div>
          </div>
        </section>

        {/* Founder Spotlight & "About Us" */}
        <section className="px-4 sm:px-6 lg:px-8 py-16 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            
            <div className="md:col-span-5 flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <img
                  src={LOGO_URL}
                  alt="Zulora Founder Shiven Panwar"
                  className="w-48 h-48 rounded-3xl object-cover ring-4 ring-sky-500/30 shadow-2xl"
                />
                <div className="absolute -bottom-2 -right-2 px-3 py-1 rounded-xl bg-sky-500 text-white text-[11px] font-extrabold shadow-md">
                  Young Entrepreneur
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white">Shiven Panwar</h3>
                <p className="text-xs text-sky-500 font-semibold">Founder & Chief Visionary • Zulora</p>
              </div>
            </div>

            <div className="md:col-span-7 space-y-4 text-left">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-500">
                Founder Story & Mission
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white leading-tight">
                Created by Zulora | Made by Shiven Panwar.
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Zulora AI was founded by visionary young entrepreneur <strong>Shiven Panwar</strong> with a resolute ambition: to build an integrated neural studio that never experiences outages. By combining 10 tier-1 AI providers with automated failover and cloud persistence, Zulora puts high-performance AI in everyone's hands.
              </p>

              <div className="pt-2 grid grid-cols-2 gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-sky-500" />
                  <span>Real-time Multi-Model waterfall</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-sky-500" />
                  <span>Dynamic Firestore quota resets</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-sky-500" />
                  <span>Portals: school.zulora.in</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-sky-500" />
                  <span>Cloud: drive.zulora.in</span>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* "What Zulora AI is Working On" */}
        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-slate-100/50 dark:bg-slate-950/40 border-t border-slate-200/80 dark:border-slate-800/80">
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-500">
                Future Roadmap & Ventures
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
                What Zulora AI is Working On
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                Active expansion projects in the Zulora technology umbrella.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass flex flex-col justify-between space-y-4">
                <div>
                  <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-500 flex items-center justify-center mb-3">
                    <Globe className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                    Zulora School
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    AI-powered educational ecosystem offering adaptive tutoring, student analytics, and academic curricula at <strong>school.zulora.in</strong>.
                  </p>
                </div>

                <a
                  href="https://school.zulora.in"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-bold text-sky-500 flex items-center gap-1 hover:underline"
                >
                  <span>Visit school.zulora.in</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass flex flex-col justify-between space-y-4">
                <div>
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-3">
                    <Layers className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                    Zulora Drive
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    Intelligent neural cloud drive supporting semantic document search, automated vectorization, and encrypted storage at <strong>drive.zulora.in</strong>.
                  </p>
                </div>

                <a
                  href="https://drive.zulora.in"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-bold text-indigo-500 flex items-center gap-1 hover:underline"
                >
                  <span>Visit drive.zulora.in</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-glass flex flex-col justify-between space-y-4">
                <div>
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                    Autonomous Agent Fleet
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    Deploying persistent AI agents capable of continuous asynchronous research, code writing, and automated media production.
                  </p>
                </div>

                <span className="text-xs font-bold text-emerald-500">
                  Active Engineering Beta
                </span>
              </div>

            </div>
          </div>
        </section>

      </main>

      {/* Landing Footer */}
      <footer className="w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <a href="https://wa.me/916395211325" target="_blank" rel="noreferrer" className="hover:text-emerald-500 flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span>WhatsApp: +91 6395211325</span>
            </a>
            <a href="mailto:zulora.help@gmail.com" className="hover:text-sky-500 flex items-center gap-1">
              <Mail className="w-3.5 h-3.5 text-sky-500" />
              <span>zulora.help@gmail.com</span>
            </a>
          </div>
          <div>
            Created by <strong>Zulora</strong> | Made by <span className="font-bold text-sky-500">Shiven Panwar (Young Entrepreneur)</span>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;
