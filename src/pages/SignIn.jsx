import React, { useState, useEffect } from 'react';
import { Chrome, LoaderCircle, ShieldCheck, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

/* ─── Privacy Policy Modal ─── */
export const SignIn = ({ onAuthenticated }) => {
  const { loading, isAuthenticated, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) onAuthenticated?.();
  }, [isAuthenticated, loading, onAuthenticated]);

  // Persist consent in localStorage so we don't re-ask on auth redirect return
  useEffect(() => {
    try {
      const saved = localStorage.getItem('zulora_consent_given');
      if (saved === 'true') setConsent(true);
    } catch (storageError) {
      console.warn('Could not read saved sign-in consent:', storageError);
    }
  }, []);

  const signIn = async () => {
    if (!consent) {
      setConsentError(true);
      setTimeout(() => setConsentError(false), 3000);
      return;
    }
    try { localStorage.setItem('zulora_consent_given', 'true'); }
    catch (storageError) { console.warn('Could not save sign-in consent:', storageError); }
    setBusy(true);
    setError('');
    try {
      const result = await signInWithGoogle();
      if (!result.success) setError(result.error || 'Unable to complete Google sign-in.');
      else if (result.user) onAuthenticated?.();
    } catch (signInError) {
      setError(signInError.message || 'Unable to complete Google sign-in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>

      <main className="min-h-screen bg-[#f8fafc] dark:bg-[#070b14] text-slate-900 dark:text-slate-100 flex items-center justify-center px-4 py-10 relative overflow-hidden">
        {/* Background orbs */}
        <div className="absolute -top-32 -right-24 w-[500px] h-[500px] rounded-full opacity-30 dark:opacity-15" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.3) 0%, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="absolute -bottom-40 -left-24 w-[400px] h-[400px] rounded-full opacity-20 dark:opacity-10" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)', filter: 'blur(70px)' }} />
        <div className="absolute inset-0 bg-grid opacity-40 dark:opacity-30" />

        <section className="relative w-full max-w-md glass-pearl dark:glass-dark rounded-3xl border border-white/80 dark:border-slate-700/60 shadow-2xl p-8 sm:p-10 text-center animate-scale-in">
          {/* Logo */}
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl overflow-hidden ring-4 ring-sky-500/20 shadow-xl">
            <img src={LOGO_URL} alt="Zulora AI" className="w-full h-full object-cover" />
          </div>

          {/* Brand */}
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-500 mb-2">Zulora AI</p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Welcome back
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Sign in securely to access your AI workspace, image studio, and video studio.
          </p>

          {/* ── DPDP Consent Checkbox ── */}
          <div
            className={`mt-6 p-3.5 rounded-xl border text-left transition-all ${
              consentError
                ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
                : consent
                ? 'border-sky-300/60 dark:border-sky-700/50 bg-sky-50/50 dark:bg-sky-950/20'
                : 'border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/20'
            }`}
          >
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => setConsent(v => !v)}
                className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded transition-colors ${consent ? 'text-sky-500' : 'text-slate-400'}`}
              >
                {consent ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
              <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                I agree that Zulora AI may collect my <strong>Name</strong> and <strong>Email</strong> from Google Sign-In to create and manage my account and enforce usage limits. I understand I can delete my data at any time from Account Settings.
                {' '}<span className="text-red-500 font-semibold">*</span>
              </span>
            </label>
            {consentError && (
              <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400 font-medium pl-6">
                ⚠️ Please accept the data consent before signing in (required by DPDP Act 2023).
              </p>
            )}
          </div>

          {/* Sign In Button */}
          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="mt-5 w-full azure-gradient-btn text-white font-bold py-3.5 px-5 rounded-2xl flex items-center justify-center gap-3 shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <LoaderCircle className="w-5 h-5 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="rgba(255,255,255,0.9)" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="rgba(255,255,255,0.9)" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="rgba(255,255,255,0.9)" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="rgba(255,255,255,0.9)" />
              </svg>
            )}
            {busy ? 'Connecting to Google...' : 'Continue with Google'}
          </button>

          {error && (
            <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-3 py-2 rounded-xl border border-red-200/60 dark:border-red-800/40" role="alert">
              ⚠️ {error}
            </p>
          )}

          {/* Trust indicators */}
          <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-slate-400 dark:text-slate-600">
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-sky-500" /> Firebase Auth</span>
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-emerald-500" /> DPDP Compliant</span>
          </div>
          <p className="mt-2 text-[9px] text-slate-400 dark:text-slate-600">
            Created by Zulora · Made by Shiven Panwar
          </p>
        </section>
      </main>
    </>
  );
};

export default SignIn;
