import React, { useState, useEffect } from 'react';
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
  CheckCircle2,
  Cpu,
  Star,
  Sun,
  Moon,
  Clock,
  Check,
  ChevronRight,
  ExternalLink,
  MessageCircle,
  Mail,
  Layers,
  Code2,
  BrainCircuit,
  Wand2,
  Play,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

/* ─── Animated Particle/Orb Background ─── */
const FloatingOrbs = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
    <div className="hero-glow hero-glow-azure" />
    <div className="hero-glow hero-glow-indigo" />
    <div
      className="absolute w-[350px] h-[350px] rounded-full opacity-[0.06] dark:opacity-[0.1]"
      style={{
        background: 'radial-gradient(circle, #0ea5e9 0%, transparent 70%)',
        bottom: '15%', left: '-5%',
        filter: 'blur(60px)',
        animation: 'pulseGlow 8s ease-in-out infinite',
      }}
    />
    {/* Subtle dots grid */}
    <div className="absolute inset-0 bg-grid opacity-50" />
  </div>
);

/* ─── Stat Counter Card ─── */
const StatCard = ({ value, label, icon: Icon }) => (
  <div className="text-center space-y-1">
    <div className="text-2xl md:text-3xl font-black azure-gradient-text stat-number">{value}</div>
    <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      {Icon && <Icon className="w-3.5 h-3.5 text-sky-500" />}
      {label}
    </div>
  </div>
);

/* ─── Feature Card ─── */
const FeatureCard = ({ icon: Icon, iconBg, title, desc, badge, items, onOpen }) => (
  <div className="feature-card glass-pearl dark:glass-dark rounded-2xl p-6 border border-white/70 dark:border-slate-700/60 glass-card-hover cursor-default">
    <div className="flex items-start justify-between mb-4">
      <div className={`p-3 rounded-xl ${iconBg}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      {badge && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/40">
          {badge}
        </span>
      )}
    </div>
    <h3 className="font-bold text-slate-900 dark:text-white mb-1.5 text-base">{title}</h3>
    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-4">{desc}</p>
    {items && (
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    )}
    <button
      type="button"
      onClick={onOpen}
      className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-500"
    >
      Open {title} <ArrowRight className="w-3.5 h-3.5" />
    </button>
  </div>
);

/* ─── Pricing Card ─── */
const PricingCard = ({ tier, price, period, desc, features, highlight, badge }) => (
  <div
    className={`relative rounded-2xl p-6 border transition-all duration-300 ${
      highlight
        ? 'bg-gradient-to-br from-sky-500 to-sky-600 border-sky-400/50 shadow-[0_20px_50px_-10px_rgba(14,165,233,0.5)] scale-[1.02] text-white'
        : 'glass-pearl dark:glass-dark border-white/70 dark:border-slate-700/60 glass-card-hover'
    }`}
  >
    {badge && (
      <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-md ${
        highlight ? 'bg-white text-sky-600' : 'bg-sky-500 text-white'
      }`}>
        {badge}
      </div>
    )}
    <div className="mb-4">
      <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${highlight ? 'text-sky-100' : 'text-sky-500'}`}>
        {tier}
      </p>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-black ${highlight ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
          {price === 0 ? 'Free' : `₹${price}`}
        </span>
        {price > 0 && (
          <span className={`text-sm ${highlight ? 'text-sky-200' : 'text-slate-500 dark:text-slate-400'}`}>/{period}</span>
        )}
      </div>
      <p className={`text-xs mt-1 ${highlight ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'}`}>{desc}</p>
    </div>
    <ul className="space-y-2.5 mb-6">
      {features.map((f, i) => (
        <li key={i} className={`flex items-center gap-2 text-sm ${highlight ? 'text-sky-100' : 'text-slate-600 dark:text-slate-300'}`}>
          <Check className={`w-4 h-4 flex-shrink-0 ${highlight ? 'text-white' : 'text-sky-500'}`} />
          {f}
        </li>
      ))}
    </ul>
  </div>
);

/* ─── MAIN LANDING PAGE ─── */
export const LandingPage = () => {
  const { currentUser, signInWithGoogle, theme, toggleTheme } = useAuth();
  const [authError, setAuthError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    const result = await signInWithGoogle();
    if (!result?.success) {
      setAuthError(result?.error || 'Sign-in failed. Please try again.');
    }
    setSigningIn(false);
  };

  const openFeature = () => {
    window.history.pushState({}, '', currentUser ? '/dashboard' : '/signin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const features = [
    {
      icon: BrainCircuit,
      iconBg: 'bg-gradient-to-br from-sky-500 to-sky-600',
      title: 'Multi-Model AI Chat',
      badge: '7+ Models',
      desc: 'Intelligent waterfall routing across Gemini, Groq, Mistral, Cerebras & more. Zero downtime, always the best available model.',
      items: ['50 chats / 2 hours (Free)', 'Markdown & code rendering', 'Voice input & TTS output', 'Chat history & sessions'],
    },
    {
      icon: Wand2,
      iconBg: 'bg-gradient-to-br from-violet-500 to-violet-600',
      title: 'AI Image Studio',
      badge: 'FLUX Engine',
      desc: 'Generate stunning, high-definition images in seconds using the cutting-edge FLUX diffusion engine with 6 artistic styles.',
      items: ['30 images / day (Free)', '6 artistic style presets', 'Multiple aspect ratios', 'One-click download'],
    },
    {
      icon: Film,
      iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',
      title: 'Video Generation',
      badge: 'AI Powered',
      desc: 'Create cinematic AI-generated videos from your prompts. Perfect for social media, content creation, and creative projects.',
      items: ['4 videos / day (Free)', 'Camera motion controls', 'MP4 download', 'Cinematic presets'],
    },
    {
      icon: ShieldCheck,
      iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      title: 'Secure & Private',
      badge: 'Firebase',
      desc: 'Enterprise-grade security with Google OAuth, Firestore data isolation, and strict access control. Your data is yours.',
      items: ['Google OAuth sign-in', 'Isolated user data', 'Per-user encryption', 'No data selling'],
    },
    {
      icon: Zap,
      iconBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
      title: 'API Waterfall',
      badge: 'Smart Failover',
      desc: 'If one AI provider goes down, Zulora instantly switches to the next. Seven Gemini keys, plus Groq, Mistral, Cerebras & more.',
      items: ['7 Gemini API keys', 'Groq ultra-fast inference', 'OpenRouter fallback', 'Edge model backup'],
    },
    {
      icon: Globe,
      iconBg: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
      title: 'Web Search',
      badge: 'Live Data',
      desc: 'Toggle real-time web search to ground AI responses in current, factual information. No outdated training cutoff.',
      items: ['Toggle per-message', 'Source citations', 'Current events aware', 'Research assistant'],
    },
  ];

  const pricingPlans = [
    {
      tier: 'Free',
      price: 0,
      period: 'month',
      desc: 'Perfect for getting started',
      features: ['50 chats / 2 hours', '30 image generations / day', '4 video generations / day', 'All AI models (waterfall)', 'Chat history storage', 'Voice input & output'],
    },
    {
      tier: 'Pro',
      price: 299,
      period: 'month',
      desc: 'Best for regular creators',
      highlight: true,
      badge: 'Most Popular',
      features: ['100 chats / 2 hours', '60 image generations / day', '8 video generations / day', 'Priority model routing', 'Extended history storage', 'Email support'],
    },
    {
      tier: 'Ultra Pro Max',
      price: 599,
      period: 'month',
      desc: 'For power users & teams',
      features: ['250 chats / 2 hours', '150 image generations / day', '20 video generations / day', 'Priority queue access', 'Dedicated model access', 'WhatsApp priority support'],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 overflow-x-hidden">

      {/* ═══════════════ NAVBAR ═══════════════ */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'glass-pearl dark:glass-dark border-b border-white/60 dark:border-slate-800/60 shadow-sm'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl overflow-hidden ring-2 ring-sky-500/30 shadow-md">
              <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-black text-slate-900 dark:text-white text-base tracking-tight">
                Zulora <span className="text-sky-500">AI</span>
              </span>
              <span className="text-[9px] text-slate-500 dark:text-slate-500 hidden sm:block">
                By Shiven Panwar
              </span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {['Features', 'Pricing', 'About'].map(link => (
              <a
                key={link}
                href={`#${link.toLowerCase()}`}
                className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/20 transition-all font-medium"
              >
                {link}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-all border border-slate-200/60 dark:border-slate-700/50"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="azure-gradient-btn text-white text-sm font-semibold px-4 py-1.5 rounded-xl flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {signingIn ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" opacity=".9"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".9"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".9"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".9"/>
                </svg>
              )}
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════════ HERO SECTION ═══════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-20 pb-16 text-center overflow-hidden">
        <FloatingOrbs />

        <div className="relative z-10 max-w-4xl mx-auto space-y-6 animate-float-up">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-pearl dark:glass-dark border border-sky-200/60 dark:border-sky-800/40 shadow-sm text-xs font-semibold text-sky-600 dark:text-sky-400">
            <span className="w-1.5 h-1.5 bg-sky-500 rounded-full animate-pulse" />
            Founded by Shiven Panwar — India's Next-Gen AI Studio
            <Star className="w-3 h-3 text-amber-400" />
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black leading-[1.08] tracking-tight text-slate-900 dark:text-white">
            The Future of AI is{' '}
            <span className="azure-gradient-text-animated block sm:inline">
              Zulora
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-slate-500 dark:text-slate-400 text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            One unified studio for multi-model AI chat, image generation, and cinematic video synthesis.
            Built with enterprise-grade security and a 7-model waterfall for zero downtime.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="azure-gradient-btn text-white font-bold px-7 py-3.5 rounded-2xl text-base flex items-center gap-2.5 shadow-xl disabled:opacity-60 disabled:cursor-not-allowed min-w-[200px] justify-center"
            >
              {signingIn ? (
                <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="rgba(255,255,255,0.9)"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="rgba(255,255,255,0.9)"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="rgba(255,255,255,0.9)"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="rgba(255,255,255,0.9)"/>
                </svg>
              )}
              {signingIn ? 'Signing in...' : 'Start for Free — Google Sign In'}
            </button>
          </div>

          {/* Auth Error */}
          {authError && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 rounded-xl text-sm animate-scale-in">
              ⚠️ {typeof authError === 'string' ? authError : authError?.error || 'Sign-in failed. Please try again.'}
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-xs text-slate-500 dark:text-slate-500">
            {[
              { icon: ShieldCheck, text: 'Google OAuth secured' },
              { icon: Zap, text: 'No credit card required' },
              { icon: Globe, text: '7+ AI models' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-sky-500" />
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="relative z-10 mt-16 w-full max-w-2xl mx-auto">
          <div className="glass-pearl dark:glass-dark rounded-2xl border border-white/70 dark:border-slate-700/60 p-5 grid grid-cols-3 divide-x divide-slate-200/60 dark:divide-slate-700/50 shadow-xl">
            <StatCard value="7+" label="AI Models" icon={Cpu} />
            <StatCard value="∞" label="Availability" icon={Zap} />
            <StatCard value="Free" label="To Start" icon={Star} />
          </div>
        </div>
      </section>

      {/* ═══════════════ FEATURES ═══════════════ */}
      <section id="features" className="relative px-4 py-20 max-w-7xl mx-auto w-full">
        <div className="text-center mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <Sparkles className="w-3.5 h-3.5" /> Everything You Need
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            One Studio, <span className="azure-gradient-text">Infinite Possibilities</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto text-sm md:text-base">
            From intelligent conversation to creative generation — Zulora AI brings every tool you need into a single, beautiful workspace.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <FeatureCard key={i} {...f} onOpen={openFeature} />
          ))}
        </div>
      </section>

      {/* ═══════════════ HOW IT WORKS ═══════════════ */}
      <section className="px-4 py-20 bg-slate-50/80 dark:bg-slate-900/20">
        <div className="max-w-4xl mx-auto text-center space-y-3 mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <Layers className="w-3.5 h-3.5" /> Simple Process
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            Up and Running in <span className="azure-gradient-text">30 Seconds</span>
          </h2>
        </div>
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { step: '01', icon: Lock, title: 'Sign in Securely', desc: 'Use your Google account for instant, secure authentication. No passwords to remember.' },
            { step: '02', icon: MessageSquare, title: 'Start Creating', desc: 'Chat with AI, generate images, or create videos. Switch between tools instantly.' },
            { step: '03', icon: Sparkles, title: 'Upgrade Anytime', desc: 'Start free, upgrade to Pro or Ultra Pro Max when you need more power.' },
          ].map(({ step, icon: Icon, title, desc }) => (
            <div key={step} className="glass-pearl dark:glass-dark rounded-2xl p-6 border border-white/70 dark:border-slate-700/60 text-center space-y-3 relative overflow-hidden">
              <div className="absolute top-3 right-4 text-5xl font-black text-slate-100 dark:text-slate-800/60 select-none">
                {step}
              </div>
              <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-500 flex items-center justify-center shadow-md shadow-sky-500/30">
                <Icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ PRICING ═══════════════ */}
      <section id="pricing" className="px-4 py-20 max-w-7xl mx-auto w-full">
        <div className="text-center mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <Star className="w-3.5 h-3.5" /> Simple Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            Plans for Every <span className="azure-gradient-text">Creator</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto text-sm">
            Start free. Scale when you need to. Cancel anytime.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto items-stretch">
          {pricingPlans.map((plan, i) => (
            <PricingCard key={i} {...plan} />
          ))}
        </div>

        <div className="text-center mt-8">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            To upgrade, contact us via WhatsApp or email after signing in.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a
              href="https://wa.me/916395211325"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors shadow-md shadow-emerald-500/30"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp Support
            </a>
            <a
              href="mailto:zulora.help@gmail.com"
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-sky-400 hover:text-sky-500 glass-pearl dark:glass-dark text-sm font-semibold transition-all"
            >
              <Mail className="w-4 h-4" /> zulora.help@gmail.com
            </a>
          </div>
        </div>
      </section>

      {/* ═══════════════ ABOUT / FOUNDER ═══════════════ */}
      <section id="about" className="px-4 py-20 bg-slate-50/80 dark:bg-slate-900/20">
        <div className="max-w-3xl mx-auto">
          <div className="glass-pearl dark:glass-dark rounded-3xl border border-white/70 dark:border-slate-700/60 p-8 md:p-12 text-center space-y-6 shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-grid opacity-30 dark:opacity-20" />
            <div className="relative z-10 space-y-4">
              <div className="w-20 h-20 mx-auto rounded-2xl overflow-hidden ring-4 ring-sky-500/30 shadow-xl">
                <img src={LOGO_URL} alt="Zulora Logo" className="w-full h-full object-cover" />
              </div>
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white">
                  Built by a <span className="azure-gradient-text">Young Entrepreneur</span>
                </h2>
                <p className="text-sky-500 dark:text-sky-400 font-semibold text-sm mt-1">
                  Shiven Panwar — Founder & Creator of Zulora
                </p>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm md:text-base max-w-xl mx-auto">
                Zulora AI is a passion project born from the belief that powerful AI tools should be accessible to everyone — students, creators, developers, and entrepreneurs alike. Every feature is crafted with care, speed, and user-first thinking.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <a href="https://school.zulora.in" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-sky-400 hover:text-sky-500 transition-all glass-pearl dark:glass-dark">
                  <ExternalLink className="w-3 h-3" /> school.zulora.in
                </a>
                <a href="https://drive.zulora.in" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-sky-400 hover:text-sky-500 transition-all glass-pearl dark:glass-dark">
                  <ExternalLink className="w-3 h-3" /> drive.zulora.in
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ FINAL CTA ═══════════════ */}
      <section className="px-4 py-20">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            Ready to Experience the <span className="azure-gradient-text">Future?</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base max-w-md mx-auto">
            Join thousands of creators and professionals using Zulora AI every day. Start for free — no credit card needed.
          </p>
          <button
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="azure-gradient-btn text-white font-bold px-8 py-4 rounded-2xl text-base inline-flex items-center gap-2.5 shadow-xl disabled:opacity-60"
          >
            {signingIn ? (
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
            Get Started Free
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <footer className="border-t border-slate-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xl px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl overflow-hidden ring-2 ring-sky-500/20">
                <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
              </div>
              <span className="font-black text-slate-900 dark:text-white text-sm">
                Zulora <span className="text-sky-500">AI</span>
              </span>
            </div>

            {/* Links */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-500">
              <a href="https://school.zulora.in" target="_blank" rel="noopener noreferrer" className="hover:text-sky-500 transition-colors">school.zulora.in</a>
              <a href="https://drive.zulora.in" target="_blank" rel="noopener noreferrer" className="hover:text-sky-500 transition-colors">drive.zulora.in</a>
              <a href="mailto:zulora.help@gmail.com" className="hover:text-sky-500 transition-colors">zulora.help@gmail.com</a>
              <a href="https://wa.me/916395211325" target="_blank" rel="noopener noreferrer" className="hover:text-sky-500 transition-colors">WhatsApp</a>
              <span className="cursor-pointer hover:text-sky-500 transition-colors">Terms & Conditions</span>
              <span className="cursor-pointer hover:text-sky-500 transition-colors">Privacy Policy</span>
            </div>

            {/* Credit */}
            <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center md:text-right">
              Created by Zulora · Made by{' '}
              <span className="text-sky-500 font-semibold">Shiven Panwar</span>{' '}
              (Young Entrepreneur)
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200/40 dark:border-slate-800/40 text-center text-[10px] text-slate-400 dark:text-slate-600">
            © {new Date().getFullYear()} Zulora. All rights reserved. Powered by Google Gemini, Groq, Mistral & more.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
