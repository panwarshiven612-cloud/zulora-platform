import React, { useEffect, useState } from 'react';
import { Chrome, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const SignIn = ({ onAuthenticated }) => {
  const { currentUser, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentUser) onAuthenticated?.();
  }, [currentUser, onAuthenticated]);

  const signIn = async () => {
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
    <main className="min-h-screen bg-[#f8fafc] text-slate-900 flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-sky-200/60 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 w-96 h-96 rounded-full bg-cyan-100/80 blur-3xl" />

      <section className="relative w-full max-w-md rounded-[2rem] border border-white/80 bg-white/70 backdrop-blur-2xl shadow-[0_24px_80px_rgba(14,165,233,0.16)] p-8 sm:p-10 text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-2xl overflow-hidden ring-4 ring-sky-100 shadow-lg">
          <img src="https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg" alt="Zulora AI" className="w-full h-full object-cover" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600 mb-3">Zulora AI</p>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Welcome back</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">Sign in securely to access your AI workspace, image studio, and video studio.</p>

        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="mt-8 w-full rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-bold py-3.5 px-5 flex items-center justify-center gap-3 shadow-lg shadow-sky-500/20 transition-colors"
        >
          {busy ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Chrome className="w-5 h-5" />}
          {busy ? 'Connecting to Google...' : 'Sign in with Google'}
        </button>

        {error && <p className="mt-4 text-xs font-medium text-red-600" role="alert">{error}</p>}

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-sky-500" />
          <span>Protected by Firebase Authentication</span>
        </div>
      </section>
    </main>
  );
};

export default SignIn;
