import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Clock3, Crown, Sparkles, X, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { requestLimits } from '../services/generationApi';

const TOKEN_WINDOW_MS = 6 * 60 * 60 * 1000;

function localStatus(usage, tier) {
  const tokenLimit = tier === 'ultra' ? 8_000_000 : tier === 'pro' ? 200_000 : 50_000;
  const chatLimit = tier === 'ultra' ? 300 : tier === 'pro' ? 120 : 60;
  const now = Date.now();
  const start = Number(usage?.tokenWindowStart) || now;
  const expired = now - start >= TOKEN_WINDOW_MS || start > now;
  const usedTokens = expired ? 0 : Math.max(0, Number(usage?.tokenUsed) || 0);
  const chatCount = Math.max(0, Number(usage?.chatCount ?? usage?.textUsed) || 0);
  const chatStart = Number(usage?.chatWindowStart) || 0;
  return {
    usedTokens,
    tokenLimit,
    usedPercent: Math.max(0, Math.min(100, Math.floor((usedTokens / tokenLimit) * 100))),
    resetAt: new Date(expired ? now : Number(usage?.tokenResetAt) || start + TOKEN_WINDOW_MS).toISOString(),
    chatCount,
    chatLimit,
    chatRemaining: Math.max(0, chatLimit - chatCount),
    chatResetAt: chatStart ? new Date(chatStart + 4 * 60 * 60 * 1000).toISOString() : null,
    blocked: usedTokens >= tokenLimit || chatCount >= chatLimit
  };
}

function formatRemaining(value, now) {
  const resetAt = Date.parse(value || '');
  if (!Number.isFinite(resetAt) || resetAt <= now) return 'All tokens available';
  const total = Math.ceil((resetAt - now) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

export default function UsageLimitsModal({ isOpen, onClose }) {
  const { currentUser, tier, usage, setIsPricingModalOpen } = useAuth();
  const [status, setStatus] = useState(() => localStatus(usage, tier));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    const refresh = async () => {
      const remote = await requestLimits(currentUser);
      if (active) setStatus(remote || localStatus(usage, tier));
    };
    setNow(Date.now());
    refresh();
    const refreshTimer = window.setInterval(refresh, 30_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { active = false; window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, [isOpen, currentUser, usage, tier]);

  const nextRefresh = useMemo(() => formatRemaining(status?.resetAt, now), [status?.resetAt, now]);
  if (!isOpen) return null;

  const percent = Math.max(0, Math.min(100, Number(status?.usedPercent) || 0));
  const tokenLimit = Number(status?.tokenLimit) || (tier === 'ultra' ? 8_000_000 : tier === 'pro' ? 200_000 : 50_000);
  const usedTokens = Math.max(0, Number(status?.usedTokens) || 0);
  const chatLimit = Number(status?.chatLimit) || (tier === 'ultra' ? 300 : tier === 'pro' ? 120 : 60);
  const chatRemaining = Math.max(0, Number(status?.chatRemaining ?? chatLimit - (Number(status?.chatCount) || 0)));
  const blocked = Boolean(status?.blocked || percent >= 100 || chatRemaining <= 0);
  const openPricing = () => { onClose?.(); setIsPricingModalOpen(true); };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-slate-950/75 p-2 backdrop-blur-xl sm:p-4" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <section className="relative my-auto max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-[28px] border border-white/10 bg-[#101522] p-5 text-white shadow-[0_30px_120px_rgba(0,0,0,.55)] sm:max-h-[calc(100dvh-2rem)] sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />
        <button aria-label="Close usage" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
        <div className="relative flex items-center gap-3 pr-9">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><BarChart3 size={22} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-200/70">Zulora capacity</p>
            <h2 className="text-xl font-bold">Rolling 6-hour token usage</h2>
          </div>
          <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs capitalize text-slate-300">{tier} plan</span>
        </div>

        <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[.035] p-4 sm:mt-8 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-300">Token budget</span>
            <span className={`text-sm font-semibold ${blocked ? 'text-rose-300' : 'text-cyan-200'}`}>{percent}% used</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full transition-[width] duration-700 ease-out ${blocked ? 'bg-gradient-to-r from-rose-500 to-orange-400' : 'bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-500'}`} style={{ width: `${percent}%` }} /></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>{usedTokens.toLocaleString()} / {tokenLimit.toLocaleString()} tokens</span>
            <span className="flex items-center gap-1.5"><Clock3 size={14} /> Resets in {nextRefresh}</span>
          </div>
        </div>

        <div className="relative mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.045] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-300">Chat requests remaining</span>
            <span className="text-sm font-semibold text-cyan-200">{chatRemaining} / {chatLimit}</span>
          </div>
          <div className="mt-2 text-xs text-slate-400">Chat request limits refresh on their separate four-hour window.</div>
        </div>

        <div className={`relative mt-4 rounded-2xl border p-4 ${blocked ? 'border-violet-300/40 bg-violet-400/10' : 'border-white/10 bg-white/[.025]'}`}>
          <div className="flex gap-3">
            <div className="mt-0.5 text-violet-200">{blocked ? <Sparkles size={19} /> : <Zap size={19} />}</div>
            <div>
              <h3 className="font-semibold">{blocked ? 'A usage limit has been reached' : 'Usage refreshes automatically'}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-400">Earlier token usage returns to your balance as it ages out of the rolling six-hour window.</p>
            </div>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><Crown className="mb-2 text-violet-200" size={18} /><p className="text-sm font-semibold">Pro</p><p className="mt-1 text-xs text-slate-400">More room for daily work</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><Check className="mb-2 text-cyan-200" size={18} /><p className="text-sm font-semibold">Rolling refresh</p><p className="mt-1 text-xs text-slate-400">Token usage returns after six hours</p></div>
        </div>
        <button onClick={openPricing} className="relative mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-400 px-4 py-3 text-sm font-bold shadow-lg shadow-violet-900/30 transition hover:brightness-110"><Sparkles size={16} /> {blocked ? 'Explore upgrade options' : 'View plans'}</button>
      </section>
    </div>
  );
}
