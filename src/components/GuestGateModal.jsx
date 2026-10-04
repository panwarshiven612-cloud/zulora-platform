import React from 'react';
import { Sparkles, Lock, X } from 'lucide-react';

/**
 * GuestGateModal — Glassmorphic modal prompting guest users to sign in.
 * Shown when a guest tries to access a restricted feature.
 */
export default function GuestGateModal({ onSignIn, onClose, reason = 'sign in to unlock full Zulora AI capabilities' }) {
  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in required"
    >
      <div
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 p-8 shadow-2xl backdrop-blur-2xl"
        onClick={e => e.stopPropagation()}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex flex-col items-center text-center gap-5">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-amber-900" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Sign in to continue</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Please {reason}.
            </p>
          </div>

          <div className="w-full space-y-3">
            <button
              onClick={onSignIn}
              className="w-full py-3 px-6 rounded-2xl bg-gradient-to-r from-sky-500 to-violet-600 hover:from-sky-600 hover:to-violet-700 text-white font-semibold text-sm shadow-lg shadow-sky-500/25 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Sign in with Google — It&apos;s Free
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 text-sm font-medium transition-colors"
              >
                Continue as guest
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-600">
            Free plan: 60 AI chats · 30 images · 4 videos per day
          </p>
        </div>
      </div>
    </div>
  );
}
