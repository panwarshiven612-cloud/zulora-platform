import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Clock3, Crown, Sparkles, X, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { requestLimits } from '../services/generationApi';

function localStatus(usage, tier) {
  const cap = tier === 'ultra' ? 100_000 : tier === 'pro' ? 50_000 : 10_000;
  const start = Number(usage?.tokenWindowStart) || Date.now();
  const expired = Date.now() - start >= 24 * 60 * 60 * 1000 || start > Date.now();
  const used = expired ? 0 : Number(usage?.tokenUsed) || 0;
  return {
    usedPercent: Math.max(0, Math.min(100, Math.floor((used / cap) * 100))),
    resetAt: new Date((expired ? Date.now() : start) + 24 * 60 * 60 * 1000).toISOString(),
    blocked: used >= cap
  };
}

export default function UsageLimitsModal({ isOpen, onClose }) {
  const { currentUser, tier, usage, setIsPricingModalOpen } = useAuth();
  const [status, setStatus] = useState(() => localStatus(usage, tier));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setNow(Date.now());
    const refresh = async () => {
      const remote = await requestLimits(currentUser);
      if (active) setStatus(remote || localStatus(usage, tier));
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { active = false; window.clearInterval(interval); window.clearInterval(clock); };
  }, [isOpen, currentUser, usage, tier]);

  const resetLabel = useMemo(() => {
    const date = new Date(status?.resetAt || Date.now() + 24 * 60 * 60 * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [status?.resetAt]);
  if (!isOpen) return null;

  const percent = Math.max(0, Math.min(100, Number(status?.usedPercent) || 0));
  const cooldownUntil = Date.parse(status?.cooldownUntil || '');
  const coolingDown = Boolean(status?.softCooldown && Number.isFinite(cooldownUntil) && cooldownUntil > now);
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const cooldownLabel = `${String(Math.floor(cooldownSeconds / 60)).padStart(2, '0')}:${String(cooldownSeconds % 60).padStart(2, '0')}`;
  const blocked = !coolingDown && Boolean(status?.blocked || percent >= 100);
  const openPricing = () => { onClose?.(); setIsPricingModalOpen(true); };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-xl" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <section className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#101522] p-6 text-white shadow-[0_30px_120px_rgba(0,0,0,.55)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />
        <button aria-label="Close usage" onClick={onClose} className="absolute right-4 top-4 rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
        <div className="relative flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><BarChart3 size={22} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-200/70">Zulora capacity</p>
            <h2 className="text-xl font-bold">Daily usage</h2>
          </div>
          <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs capitalize text-slate-300">{tier} plan</span>
        </div>

        <div className="relative mt-8 rounded-2xl border border-white/10 bg-white/[.035] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-300">Current usage</span>
            <span className={`text-sm font-semibold ${blocked ? 'text-rose-300' : 'text-cyan-200'}`}>{percent}% used</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${blocked ? 'bg-gradient-to-r from-rose-500 to-orange-400' : 'bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-500'}`} style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Clock3 size={14} /> Resets at {resetLabel}</div>
        </div>

        <div className={`relative mt-5 rounded-2xl border p-4 transition-all duration-300 ${blocked ? 'animate-pulse border-violet-300/40 bg-violet-400/10' : coolingDown ? 'border-cyan-300/30 bg-cyan-300/[.06]' : 'border-white/10 bg-white/[.025]'}`}>
          <div className="flex gap-3">
            <div className="mt-0.5 text-violet-200">{blocked ? <Sparkles size={19} /> : <Zap size={19} />}</div>
            <div>
              <h3 className="font-semibold">{coolingDown ? 'Taking a 5-minute breather to maintain top performance...' : blocked ? 'You’ve reached today’s token allocation' : 'Usage refreshes automatically'}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-400">{coolingDown ? `You can continue in ${cooldownLabel}. Your daily token allocation is unchanged.` : blocked ? 'Upgrade for a larger daily pool, or come back after the reset.' : 'Chat, code, image, and video requests share a daily token allocation.'}</p>
            </div>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><Crown className="mb-2 text-violet-200" size={18} /><p className="text-sm font-semibold">Pro</p><p className="mt-1 text-xs text-slate-400">More room for daily work</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><Check className="mb-2 text-cyan-200" size={18} /><p className="text-sm font-semibold">Resets daily</p><p className="mt-1 text-xs text-slate-400">Usage stays private</p></div>
        </div>
        {!coolingDown && <button onClick={openPricing} className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-400 px-4 py-3 text-sm font-bold shadow-lg shadow-violet-900/30 transition hover:brightness-110">
          <Sparkles size={16} /> {blocked ? 'Explore upgrade options' : 'View plans'}
        </button>}
      </section>
    </div>
  );
}
