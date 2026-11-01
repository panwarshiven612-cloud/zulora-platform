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
  Timer,
  ExternalLink
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../../context/AuthContext';
import { firestoreService, TIERS } from '../../services/firestoreService';
import { getActiveCustomAds, logAdImpression, logAdClick, CustomAd } from './adAnalyticsService';

export interface RewardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const POINTS_PER_AD = 10;
const PRO_REDEEM_THRESHOLD = 200;
const AD_DURATION_SECONDS = 10;
const COOLDOWN_SECONDS = 60;

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
  const [promoAd, setPromoAd] = useState<CustomAd | null>(null);

  const timerRef = useRef<any>(null);
  const cooldownRef = useRef<any>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // Restore cooldown from localStorage on open and prefetch active promotional ad
  useEffect(() => {
    if (!isOpen) return;

    if (currentUser?.uid) {
      const key = `zulora_last_ad_watch_${currentUser.uid}`;
      let last = 0;
      try { last = parseInt(localStorage.getItem(key) || '0', 10); } catch (e) { /* ignore */ }
      const elapsed = Math.floor((Date.now() - last) / 1000);
      const remaining = Math.max(0, COOLDOWN_SECONDS - elapsed);
      setCooldownSeconds(remaining);

      if (remaining > 0) {
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
          setCooldownSeconds(prev => {
            if (prev <= 1) {
              clearInterval(cooldownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }

    // Prefetch an active promotional ad for the player
    getActiveCustomAds().then(ads => {
      if (ads && ads.length > 0) {
        setPromoAd(ads[Math.floor(Math.random() * ads.length)]);
      }
    }).catch(() => {});

    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [isOpen, currentUser?.uid]);

  if (!isOpen) return null;

  const handleStartWatchAd = () => {
    if (cooldownSeconds > 0) return;
    if (!currentUser?.uid) {
      setNotification('Please sign in to save your reward points!');
      return;
    }
    setWatchingAd(true);
    setAdSecondsLeft(AD_DURATION_SECONDS);
    setAdFinished(false);
    setNotification(null);

    // Log impression for promo ad if present
    if (promoAd?.id) {
      logAdImpression(promoAd.id, currentUser.uid, { adTitle: promoAd.title, placement: 'rewarded_modal' }).catch(() => {});
    }

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

    if (!currentUser?.uid) return;

    // Start 60-second anti-exploit cooldown immediately
    const key = `zulora_last_ad_watch_${currentUser.uid}`;
    try { localStorage.setItem(key, Date.now().toString()); } catch (e) { /* ignore */ }
    setCooldownSeconds(COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      const newPoints = currentPoints + POINTS_PER_AD;

      // Check for automatic Pro redemption milestone (200 points)
      if (newPoints >= PRO_REDEEM_THRESHOLD) {
        const oneMonthLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const remainingPoints = Math.max(0, newPoints - PRO_REDEEM_THRESHOLD);

        await firestoreService.updateUserProfile(currentUser.uid, {
          tier: TIERS.PRO,
          planTier: 'Pro',
          proExpiresAt: oneMonthLater,
          points: remainingPoints,
          lastAdWatchedAt: new Date().toISOString(),
          redeemedProAt: new Date().toISOString()
        });

        confetti({
          particleCount: 180,
          spread: 100,
          origin: { y: 0.6 }
        });

        setRedeemSuccess(true);
        setNotification('🎉 Milestone Reached: 200 Points! 1 Month Free Pro Subscription Automatically Activated!');
        await refreshProfile?.();
      } else {
        // Normal points credit
        await firestoreService.updateUserProfile(currentUser.uid, {
          points: newPoints,
          lastAdWatchedAt: new Date().toISOString()
        });

        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.7 }
        });

        setNotification(`🎉 +${POINTS_PER_AD} Points earned! Total: ${newPoints} pts. Next ad available in ${COOLDOWN_SECONDS}s.`);
        await refreshProfile?.();
      }
    } catch (err: any) {
      console.warn('Error crediting reward points:', err?.message);
      setNotification(`+${POINTS_PER_AD} Points credited! Next ad in ${COOLDOWN_SECONDS}s.`);
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

          {/* Cooldown Active Banner */}
          {cooldownSeconds > 0 && !watchingAd && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <Timer className="w-4 h-4 shrink-0 text-amber-500 animate-spin" />
              <span>Anti-exploit cooldown active: next ad ready in <strong>{cooldownSeconds}s</strong></span>
            </div>
          )}

          {/* Points Progress Card */}
          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                  Your Reward Balance
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                    {currentPoints}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    / {PRO_REDEEM_THRESHOLD} Points
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-extrabold text-xs">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{Math.round(progressPercent)}%</span>
                </span>
                <p className="text-[10px] text-slate-400 mt-1">
                  {currentPoints >= PRO_REDEEM_THRESHOLD 
                    ? 'Ready to redeem!' 
                    : `${PRO_REDEEM_THRESHOLD - currentPoints} pts to 1 Mo Pro`}
                </p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden p-0.5">
              <div 
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 transition-all duration-500 shadow-xs"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] text-slate-400 font-semibold px-1">
              <span>0 pts</span>
              <span>100 pts</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">200 pts (1 Mo Pro)</span>
            </div>
          </div>

          {/* Active Rewarded Ad Player Screen */}
          {watchingAd ? (
            <div className="p-5 rounded-2xl border-2 border-emerald-400 bg-gradient-to-b from-slate-900 to-[#070b14] text-white shadow-xl text-center space-y-4 animate-scale-in">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-400 tracking-wider uppercase">
                <Clock className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Sponsored Video Playing</span>
              </div>

              {/* Promotional Media Container */}
              <div className="py-4 px-4 rounded-xl bg-slate-800/80 border border-slate-700/60 relative overflow-hidden">
                {promoAd?.imageUrl ? (
                  promoAd.imageUrl.endsWith('.mp4') || promoAd.imageUrl.endsWith('.webm') ? (
                    <video
                      src={promoAd.imageUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full max-h-48 rounded-xl object-contain mx-auto mb-3 bg-slate-900"
                    />
                  ) : (
                    <img
                      src={promoAd.imageUrl}
                      alt={promoAd.title}
                      className="w-full max-h-44 rounded-xl object-contain mx-auto mb-3 bg-slate-900 shadow-md"
                      onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )
                ) : (
                  /* High quality fallback promotional showcase when no custom ads uploaded yet */
                  <div className="w-full py-5 px-3 rounded-xl bg-gradient-to-tr from-sky-900/60 via-indigo-950/60 to-purple-900/60 border border-sky-500/30 mb-3 text-center">
                    <Crown className="w-10 h-10 text-amber-400 mx-auto mb-2 animate-bounce" />
                    <p className="font-extrabold text-sm text-white">Zulora Pro Ultra Experience</p>
                    <p className="text-[11px] text-sky-200 mt-1">Unlock 65k Token Budget, Instant Groq LPU, and Ad-Free Superintelligence</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">
                      {promoAd?.title || 'Zulora AI Pro Ultra'}
                    </p>
                    <p className="text-[11px] text-slate-300 line-clamp-2">
                      {promoAd?.description || 'Earn 10 points per ad. 200 points automatically unlocks 1 Month Free Pro!'}
                    </p>
                  </div>

                  {/* Clickable target link button during ad view */}
                  <a
                    href={promoAd?.targetUrl || 'https://zulora.in/pricing'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (promoAd?.id && currentUser?.uid) {
                        logAdClick(promoAd.id, currentUser.uid, {
                          adTitle: promoAd.title,
                          targetUrl: promoAd.targetUrl,
                          placement: 'rewarded_modal'
                        }).catch(() => {});
                      }
                    }}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] transition shadow-xs"
                  >
                    <span>{promoAd?.ctaText || 'Visit Sponsor'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Big Countdown Number */}
                <div className="w-16 h-16 mx-auto rounded-full border-4 border-emerald-400/80 bg-emerald-500/20 flex items-center justify-center text-2xl font-black text-white shadow-lg mt-3">
                  {adSecondsLeft}s
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                Reward will automatically be credited upon countdown completion.
              </p>
            </div>
          ) : (
            /* Action Buttons: Watch Ad & Redeem Pro */
            <div className="space-y-3">
              {/* Watch Ad Button with Cooldown Guard */}
              <button
                type="button"
                onClick={cooldownSeconds > 0 ? undefined : handleStartWatchAd}
                disabled={cooldownSeconds > 0}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border font-bold text-sm transition-all ${
                  cooldownSeconds > 0
                    ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : 'border-sky-300/80 bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 text-white shadow-lg shadow-sky-500/25 hover:opacity-95 active:scale-[0.99] cursor-pointer group'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cooldownSeconds > 0 ? 'bg-slate-200 dark:bg-slate-800' : 'bg-white/20 group-hover:scale-110 transition-transform'}`}>
                    {cooldownSeconds > 0 ? <Timer className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
                  </div>
                  <div className="text-left">
                    <p className="leading-tight">
                      {cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s before next ad` : 'Watch Rewarded Ad'}
                    </p>
                    <p className="text-[11px] font-normal opacity-85">
                      {cooldownSeconds > 0 ? '60s anti-exploit cooldown' : '10 seconds &bull; Earn +10 Points'}
                    </p>
                  </div>
                </div>

                <span className={`px-2.5 py-1 rounded-xl text-xs font-extrabold tracking-wide ${cooldownSeconds > 0 ? 'bg-slate-200 dark:bg-slate-800 text-slate-400' : 'bg-white/20'}`}>
                  {cooldownSeconds > 0 ? `${cooldownSeconds}s` : '+10 pts'}
                </span>
              </button>

              {/* Redeem 1 Month Free Pro Button */}
              <button
                type="button"
                onClick={handleRedeemPro}
                disabled={currentPoints < PRO_REDEEM_THRESHOLD || redeeming}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border font-bold text-sm transition-all ${
                  currentPoints >= PRO_REDEEM_THRESHOLD
                    ? 'border-emerald-400 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 hover:opacity-95 active:scale-[0.99] cursor-pointer'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${currentPoints >= PRO_REDEEM_THRESHOLD ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-800'}`}>
                    <Crown className="w-5 h-5 text-amber-300" />
                  </div>
                  <div className="text-left">
                    <p className="leading-tight">
                      {redeeming ? 'Activating Pro Subscription...' : 'Redeem 1 Month Free Pro'}
                    </p>
                    <p className="text-[11px] font-normal opacity-85">
                      {currentPoints >= PRO_REDEEM_THRESHOLD 
                        ? 'Worth ₹299 &bull; Click to activate instantly!' 
                        : `Need 200 Points (${currentPoints}/200)`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-extrabold">200 pts</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            </div>
          )}

          {/* Success Screen after Redemption */}
          {redeemSuccess && (
            <div className="p-4 rounded-2xl border border-emerald-400 bg-emerald-50/90 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100 text-center space-y-2 animate-scale-in">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
              <p className="font-extrabold text-sm">
                🎉 Congratulations! Pro Subscription Activated!
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                You now have 30 days of free Pro access with 40k-65k tokens for coding, instant Groq LPU, and an ad-free workspace.
              </p>
            </div>
          )}

          {/* Perks list of Pro */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Pro Tier Perks Included
            </span>
            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span><strong>40k - 65k Token Budget</strong> for full web apps &amp; coding</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span><strong>Zulora Research 8-Part</strong> deep reporting framework</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span><strong>Zero Ad Banners</strong> &amp; priority GPU/LPU compute</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-6 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 flex items-center justify-between text-xs text-slate-400">
          <span>1 Ad = 10 Pts &bull; 200 Pts = Auto 1 Month Pro Free &bull; 60s cooldown</span>
          <button
            type="button"
            onClick={onClose}
            className="font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default RewardModal;
