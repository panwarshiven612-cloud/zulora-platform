import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Gift, 
  Crown, 
  Sparkles, 
  Play, 
  CheckCircle2, 
  Clock, 
  Zap, 
  ArrowRight,
  Award,
  Layers,
  ChevronRight,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../../context/AuthContext';
import { firestoreService, TIERS } from '../../services/firestoreService';

export interface RewardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const POINTS_PER_AD = 10;
const PRO_REDEEM_THRESHOLD = 200;
const AD_DURATION_SECONDS = 10;
const AD_COOLDOWN_SECONDS = 60; // Anti-exploit cooldown between ad views
const COOLDOWN_STORAGE_KEY = 'zulora_last_ad_watched_at';

export const RewardModal: React.FC<RewardModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, userProfile, tier, refreshProfile } = useAuth();

  const currentPoints = Number(userProfile?.points || 0);
  const isAlreadyPro = tier === 'pro' || tier === 'ultra';

  const [watchingAd, setWatchingAd] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(AD_DURATION_SECONDS);
  const [adFinished, setAdFinished] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemSuccess, setRedeemSuccess] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const timerRef = useRef<any>(null);
  const cooldownRef = useRef<any>(null);

  // Calculate cooldown state on modal open or userProfile update
  useEffect(() => {
    const checkCooldown = () => {
      let lastWatchedMs = 0;
      if (userProfile?.lastAdWatchedAt) {
        lastWatchedMs = new Date(userProfile.lastAdWatchedAt).getTime();
      } else {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(COOLDOWN_STORAGE_KEY) : null;
        if (stored) lastWatchedMs = Number(stored);
      }

      if (lastWatchedMs > 0) {
        const diffMs = Date.now() - lastWatchedMs;
        const remainingSec = Math.ceil((AD_COOLDOWN_SECONDS * 1000 - diffMs) / 1000);
        if (remainingSec > 0) {
          setCooldownSeconds(remainingSec);
          return;
        }
      }
      setCooldownSeconds(0);
    };

    checkCooldown();

    // Live cooldown countdown
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [userProfile?.lastAdWatchedAt, isOpen]);

  if (!isOpen) return null;

  const handleStartWatchAd = () => {
    if (!currentUser?.uid) {
      setNotification('Please sign in to save your reward points!');
      return;
    }

    // Anti-exploit check
    if (cooldownSeconds > 0) {
      setNotification(`Anti-exploit cooldown active. Please wait ${cooldownSeconds}s before watching another ad.`);
      return;
    }

    setWatchingAd(true);
    setAdSecondsLeft(AD_DURATION_SECONDS);
    setAdFinished(false);
    setNotification(null);

    // Countdown timer for 10 seconds
    timerRef.current = setInterval(() => {
      setAdSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleAdCompleted();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleAdCompleted = async () => {
    setWatchingAd(false);
    setAdFinished(true);

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    try {
      localStorage.setItem(COOLDOWN_STORAGE_KEY, String(nowMs));
    } catch {}

    setCooldownSeconds(AD_COOLDOWN_SECONDS);

    if (!currentUser?.uid) return;

    try {
      const newPoints = currentPoints + POINTS_PER_AD;
      await firestoreService.updateUserProfile(currentUser.uid, {
        points: newPoints,
        lastAdWatchedAt: nowIso
      });

      // Trigger celebratory confetti
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.7 }
      });

      setNotification(`🎉 +${POINTS_PER_AD} Points earned! Total: ${newPoints} pts.`);
      await refreshProfile?.();
    } catch (err: any) {
      console.warn('Error crediting reward points:', err?.message);
      setNotification(`+${POINTS_PER_AD} Points credited!`);
    }
  };

  const handleRedeemPro = async () => {
    if (!currentUser?.uid) return;
    if (currentPoints < PRO_REDEEM_THRESHOLD) {
      setNotification(`You need ${PRO_REDEEM_THRESHOLD - currentPoints} more points to redeem 1 Month Free Pro!`);
      return;
    }

    setRedeeming(true);
    setNotification(null);

    try {
      const oneMonthLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const updatedPoints = Math.max(0, currentPoints - PRO_REDEEM_THRESHOLD);

      await firestoreService.updateUserProfile(currentUser.uid, {
        tier: TIERS.PRO,
        planTier: 'Pro',
        proExpiresAt: oneMonthLater,
        points: updatedPoints,
        redeemedProAt: new Date().toISOString()
      });

      // Mega celebration confetti explosion
      confetti({
        particleCount: 160,
        spread: 90,
        origin: { y: 0.6 }
      });

      setRedeemSuccess(true);
      await refreshProfile?.();
    } catch (err: any) {
      console.error('Error redeeming Pro subscription:', err);
      setNotification('Could not redeem right now. Please try again.');
    } finally {
      setRedeeming(false);
    }
  };

  const progressPercent = Math.min(100, (currentPoints / PRO_REDEEM_THRESHOLD) * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reward-modal-title"
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-slide"
    >
      <div 
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 dark:border-slate-800 bg-white/95 dark:bg-[#0c1222]/95 shadow-2xl backdrop-blur-2xl transition-all"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="relative p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800/80 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-sky-500/10">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
            title="Close dialog"
            aria-label="Close"
          >
            <X className="w-4.5 h-4.5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-md shadow-emerald-500/30">
              <Gift className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 id="reward-modal-title" className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Zulora Rewards</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500 text-white shadow-xs">
                  Free Pro
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Watch short ads to earn points &bull; Unlock 1 Month Free Pro Subscription
              </p>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          
          {/* Notification Message */}
          {notification && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-2 animate-fade-slide">
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>{notification}</span>
            </div>
          )}

          {/* Points Progress Card */}
          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                  Your Reward Balance
                </span>
                <p className="text-2xl font-black text-slate-900 dark:text-white flex items-baseline gap-1.5">
                  <span>{currentPoints}</span>
                  <span className="text-xs font-semibold text-slate-400">/ {PRO_REDEEM_THRESHOLD} pts</span>
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                  Pro Status
                </span>
                <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg inline-block ${
                  isAlreadyPro 
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}>
                  {isAlreadyPro ? 'Active Pro' : `${PRO_REDEEM_THRESHOLD - currentPoints} pts to Pro`}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                <span>0 pts</span>
                <span>{Math.round(progressPercent)}% towards 1 Month Free Pro</span>
                <span>200 pts</span>
              </div>
            </div>
          </div>

          {/* Ad Viewing Panel */}
          <div className="p-4 rounded-2xl border border-sky-100 dark:border-sky-950/70 bg-gradient-to-br from-sky-50/50 to-indigo-50/30 dark:from-sky-950/20 dark:to-indigo-950/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sky-500 text-white">
                  <Play className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    Watch Rewarded Ad (+10 Points)
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Watch for 10 seconds to earn points. Anti-exploit protected.
                  </p>
                </div>
              </div>

              {cooldownSeconds > 0 && !watchingAd && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 px-2 py-0.5 rounded-lg">
                  <Clock className="w-3 h-3 animate-spin" />
                  {cooldownSeconds}s cooldown
                </span>
              )}
            </div>

            {/* Active Ad Playing Card */}
            {watchingAd ? (
              <div className="p-4 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/90 dark:bg-sky-950/50 text-center space-y-2 animate-fade-slide">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sky-500 text-white font-extrabold text-lg shadow-md animate-pulse">
                  {adSecondsLeft}s
                </div>
                <p className="text-xs font-bold text-sky-900 dark:text-sky-200">
                  Sponsored Video Ad in Progress...
                </p>
                <p className="text-[10px] text-sky-700 dark:text-sky-400">
                  Please keep this window open. Your +10 points will credit automatically when timer hits 0.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartWatchAd}
                disabled={watchingAd || cooldownSeconds > 0}
                className={`w-full py-3 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition shadow-sm ${
                  cooldownSeconds > 0
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white cursor-pointer active:scale-98'
                }`}
              >
                {cooldownSeconds > 0 ? (
                  <>
                    <Clock className="w-4 h-4 text-amber-500 animate-spin" />
                    <span>Cooldown active: Wait {cooldownSeconds}s before next ad</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Watch Short Ad &bull; Earn +10 Points</span>
                  </>
                )}
              </button>
            )}

            {/* Anti-exploit notice */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>Anti-Exploit Security: 60-second cooldown applies between view credits.</span>
            </div>
          </div>

          {/* Pro Redemption Card */}
          <div className="p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 dark:from-emerald-950/20 dark:to-teal-950/20 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500 text-white">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    Redeem 1 Month Free Pro Subscription
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Unlocks unlimited Gemini 3.8 Flash, 65k token thinking effort, high-res image & video tools.
                  </p>
                </div>
              </div>

              <span className="shrink-0 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-1 rounded-lg">
                200 pts
              </span>
            </div>

            {redeemSuccess ? (
              <div className="p-3 rounded-xl bg-emerald-500 text-white text-center text-xs font-bold flex items-center justify-center gap-2 animate-bounce">
                <CheckCircle2 className="w-4 h-4" />
                <span>🎉 Congratulations! 1 Month Free Pro Subscription Activated!</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleRedeemPro}
                disabled={redeeming || currentPoints < PRO_REDEEM_THRESHOLD}
                className={`w-full py-3 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition shadow-sm ${
                  currentPoints >= PRO_REDEEM_THRESHOLD
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white cursor-pointer active:scale-98 animate-pulse'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                }`}
              >
                {redeeming ? (
                  <span>Activating Pro Subscription...</span>
                ) : currentPoints >= PRO_REDEEM_THRESHOLD ? (
                  <>
                    <Crown className="w-4 h-4" />
                    <span>Redeem 1 Month Free Pro Now!</span>
                  </>
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    <span>Need {PRO_REDEEM_THRESHOLD - currentPoints} More Points to Redeem Pro</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RewardModal;
