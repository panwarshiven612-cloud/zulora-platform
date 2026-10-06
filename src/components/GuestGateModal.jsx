import React from 'react';
import { Sparkles, Lock, X, ArrowRight, ShieldCheck } from 'lucide-react';
import ZuloraLogo from './ZuloraLogo';
import { guestGate } from '../services/guestGate';

/**
 * GuestGateModal — Glassmorphic modal prompting guest users to sign in.
 * Shown when a guest tries to access a restricted feature or exceeds 10 searches.
 */
export default function GuestGateModal({
  onSignIn,
  onClose,
  reason = 'sign in to unlock full Zulora AI capabilities',
  featureName = null,
  limitReached = false
}) {
  const gateStatus = guestGate.check();
  const remaining = gateStatus.remaining;
  const isLimitReached = limitReached || remaining <= 0;
  const canContinueGuest = !isLimitReached && remaining > 0 && !featureName;

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in required"
    >
      <div
        className="relative w-full max-w-md rounded-3xl border border-white/20 bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 p-8 shadow-2xl backdrop-blur-2xl"
        onClick={e => e.stopPropagation()}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="flex flex-col items-center text-center gap-5">
          {/* Logo with glassmorphic badge */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl p-1 bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl flex items-center justify-center ring-4 ring-sky-500/20">
              <ZuloraLogo className="w-14 h-14 rounded-xl" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center shadow-md">
              <Lock className="w-3.5 h-3.5 text-amber-950" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-black text-white">
              {featureName ? `Unlock ${featureName}` : 'Sign in to Continue'}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isLimitReached
                ? 'Sign in with Google to unlock unlimited access.'
                : featureName
                ? `${featureName} requires a free Zulora account. Sign in with Google to get started in 10 seconds!`
                : `Please ${reason}.`}
            </p>
          </div>

          {/* Quota indicator if guest searches remain */}
            {!isLimitReached && remaining > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/20 text-xs font-semibold text-sky-300">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>{remaining} of 10 free demo searches remaining</span>
            </div>
          )}

          <div className="w-full space-y-3">
            {/* Primary Sign In Button */}
            <button
              type="button"
              onClick={onSignIn}
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600 hover:from-sky-600 hover:to-violet-700 text-white font-bold text-sm shadow-xl shadow-sky-500/25 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" />
              </svg>
              <span>Sign in with Google to unlock unlimited access</span>
            </button>

            {/* Secondary Continue as Guest / Try Demo Button */}
            {canContinueGuest && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl border border-white/10 text-slate-300 hover:text-white hover:border-white/30 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Continue as Guest / Try Demo ({remaining} left)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Perks list */}
          <div className="w-full pt-2 border-t border-white/10 flex items-center justify-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-sky-400" /> Free 60 Chats/4h</span>
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-violet-400" /> 30 Images/day</span>
          </div>
        </div>
      </div>
    </div>
  );
}
