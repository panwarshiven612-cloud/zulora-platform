import React, { useState, useEffect } from 'react';
import { Chrome, LoaderCircle, ShieldCheck, CheckSquare, Square, ExternalLink, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

/* ─── Privacy Policy Modal ─── */
const PrivacyModal = ({ onClose }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay animate-scale-in">
    <div className="glass-elevated dark:glass-dark rounded-2xl border border-white/80 dark:border-slate-700/60 shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
      <div className="sticky top-0 glass-pearl dark:glass-dark border-b border-slate-200/60 dark:border-slate-700/50 px-5 py-3 flex items-center justify-between rounded-t-2xl">
        <h2 className="font-bold text-slate-900 dark:text-white text-base">Privacy Policy — Zulora AI</h2>
        <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5 space-y-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
        <p className="text-xs font-semibold text-sky-500 uppercase tracking-widest">Last updated: September 2026 · DPDP Act 2023 Compliant</p>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">1. What Data We Collect</h3>
          <p>We collect only what is necessary to provide Zulora AI services:</p>
          <ul className="list-disc pl-4 mt-1 space-y-1">
            <li><strong>Name & Email</strong> — from Google Sign-In, used to create your account.</li>
            <li><strong>Usage Data</strong> — chat counts, image/video generation counts (to enforce fair usage limits).</li>
            <li><strong>Chat Sessions</strong> — your conversation history, stored in Firebase Firestore under your user ID.</li>
            <li><strong>Profile Photo</strong> — from Google OAuth (display only, not stored on our servers).</li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">2. What We Do NOT Collect</h3>
          <ul className="list-disc pl-4 space-y-1">
            <li>Home address or physical location</li>
            <li>Date of birth or age</li>
            <li>Phone number (unless voluntarily provided for WhatsApp support)</li>
            <li>Financial information or payment details</li>
            <li>Biometric data of any kind</li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">3. Why We Use Your Data</h3>
          <ul className="list-disc pl-4 space-y-1">
            <li>To create and manage your Zulora AI account</li>
            <li>To enforce per-user usage limits (DPDP Act: Data Minimization)</li>
            <li>To send you a one-time welcome email via EmailJS</li>
            <li>To display your name and photo in the app UI</li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">4. Data Retention & Deletion</h3>
          <p>You can permanently delete your account and all associated data at any time from <strong>Settings → Account → Delete My Account</strong>. All data is deleted from Firebase Firestore within 24 hours of the deletion request.</p>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">5. Third-Party Services</h3>
          <p>Zulora AI uses the following third-party services, each with their own privacy policies:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Google Firebase (Auth, Firestore)</li>
            <li>Google Gemini AI</li>
            <li>Groq, Mistral, Cerebras, OpenRouter (AI inference)</li>
            <li>EmailJS (welcome email delivery)</li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">6. Your Rights (DPDP Act 2023)</h3>
          <p>Under India's Digital Personal Data Protection Act 2023, you have the right to:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Access your personal data</li>
            <li>Correct inaccurate personal data</li>
            <li>Erase your personal data</li>
            <li>Withdraw consent at any time</li>
            <li>File a grievance with the Data Protection Board of India</li>
          </ul>
          <p className="mt-1">Contact us: <a href="mailto:zulora.help@gmail.com" className="text-sky-500 underline">zulora.help@gmail.com</a></p>
        </section>

        <section>
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">7. Contact</h3>
          <p>Data Fiduciary: <strong>Shiven Panwar, Zulora</strong><br />
          Email: <a href="mailto:zulora.help@gmail.com" className="text-sky-500 underline">zulora.help@gmail.com</a><br />
          WhatsApp: +91 6395211325</p>
        </section>
      </div>
    </div>
  </div>
);

/* ─── MAIN SIGN-IN PAGE ─── */
export const SignIn = ({ onAuthenticated }) => {
  const { currentUser, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [consentError, setConsentError] = useState(false);

  useEffect(() => {
    if (currentUser) onAuthenticated?.();
  }, [currentUser, onAuthenticated]);

  // Persist consent in localStorage so we don't re-ask on auth redirect return
  useEffect(() => {
    const saved = localStorage.getItem('zulora_consent_given');
    if (saved === 'true') setConsent(true);
  }, []);

  const signIn = async () => {
    if (!consent) {
      setConsentError(true);
      setTimeout(() => setConsentError(false), 3000);
      return;
    }
    localStorage.setItem('zulora_consent_given', 'true');
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
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}

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
                I agree that Zulora AI may collect my <strong>Name</strong> and <strong>Email</strong> from Google Sign-In to create and manage my account, and to enforce usage limits per the{' '}
                <button
                  type="button"
                  onClick={() => setShowPrivacy(true)}
                  className="text-sky-500 hover:text-sky-400 underline font-semibold"
                >
                  Privacy Policy
                </button>
                . I understand I can delete my data at any time from Account Settings.
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
