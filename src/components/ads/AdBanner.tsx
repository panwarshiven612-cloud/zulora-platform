/**
 * src/components/ads/AdBanner.tsx
 * ================================
 * ChatGPT-style bottom non-intrusive Ad Banner with Global Zulora Ads Priority.
 * - Real-time listener via `useActiveAds`: broadcasts active/approved campaigns globally to all users.
 * - ABSOLUTE PRIORITY: Zulora Custom Ads take 100% absolute priority over Google AdSense.
 * - Tracks impressions and clicks into Firestore (`adAnalytics` collection).
 * - FALLS BACK to Google AdSense only if zero active Zulora campaigns exist in Firestore.
 * - Hidden for Pro and Ultra subscribers.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Gift, ArrowRight, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useActiveAds, logAdImpression, logAdClick, CustomAd } from '../../lib/ads/adService';

declare global {
  interface Window {
    adsbygoogle?: any[];
  }
}

export interface AdBannerProps {
  onOpenRewards?: () => void;
  tier?: string;
  className?: string;
}

export const AdBanner: React.FC<AdBannerProps> = ({
  onOpenRewards,
  tier = 'free',
  className = ''
}) => {
  const { currentUser } = useAuth();
  const userId = currentUser?.uid || 'guest';

  const [dismissed, setDismissed] = useState(false);
  const adRef = useRef<HTMLModElement>(null);
  const loggedImpressionAdIdRef = useRef<string | null>(null);

  // If user is already on Pro or Ultra tier, hide ad banners completely
  const isPaidTier = tier === 'pro' || tier === 'ultra';

  // 1. Global Real-time Zulora Ads Listener (queries adCampaigns, adminAds, customAds)
  const { ads: activeAds, activeAd: realtimeAd, loading: adsLoading } = useActiveAds('bottom_banner');
  const customAd: CustomAd | null = realtimeAd || (activeAds.length > 0 ? activeAds[0] : null);
  const hasZuloraAd = Boolean(customAd);

  // Track impression once per distinct active ad
  useEffect(() => {
    if (isPaidTier || dismissed || !customAd?.id) return;
    if (loggedImpressionAdIdRef.current === customAd.id) return;
    loggedImpressionAdIdRef.current = customAd.id;

    logAdImpression(customAd.id, userId, {
      adTitle: customAd.title,
      placement: 'bottom_banner',
      sourceCollection: customAd._sourceCollection
    }).catch(() => {});
  }, [customAd, isPaidTier, dismissed, userId]);

  // 2. Google AdSense Fallback ONLY if zero active Zulora campaigns exist
  useEffect(() => {
    if (isPaidTier || dismissed || hasZuloraAd || adsLoading) return;

    try {
      if (typeof window !== 'undefined' && adRef.current) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) {
      // AdSense script may be blocked by adblocker, silent fallback
    }
  }, [isPaidTier, dismissed, hasZuloraAd, adsLoading]);

  if (isPaidTier || dismissed) {
    return null;
  }

  const handleCustomAdClick = () => {
    if (customAd?.id) {
      logAdClick(customAd.id, userId, {
        adTitle: customAd.title,
        targetUrl: customAd.targetUrl,
        placement: 'bottom_banner',
        sourceCollection: customAd._sourceCollection
      }).catch(() => {});
    }
    if (customAd?.targetUrl) {
      window.open(customAd.targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      role="complementary"
      aria-label="Advertisement and Rewards"
      className={`relative w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto my-1.5 transition-all duration-300 animate-fade-slide ${className}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-gradient-to-r from-sky-50/95 via-indigo-50/80 to-emerald-50/80 dark:from-[#0c1222]/95 dark:via-sky-950/40 dark:to-slate-900/90 p-2 sm:p-2.5 shadow-sm backdrop-blur-md">
        
        {/* Subtle decorative glow */}
        <div className="absolute -right-10 -top-10 w-28 h-28 bg-sky-400/10 dark:bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* ── PRIORITY 1: CUSTOM ZULORA AD LAYOUT (ChatGPT-Style, 100% Absolute Priority) ── */}
        {hasZuloraAd && customAd ? (
          <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
            {/* Left side: Media + Sponsor Info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {customAd.imageUrl && (
                <div className="shrink-0">
                  {customAd.imageUrl.endsWith('.mp4') || customAd.imageUrl.endsWith('.webm') ? (
                    <video
                      src={customAd.imageUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-slate-800"
                    />
                  ) : (
                    <img
                      src={customAd.imageUrl}
                      alt={customAd.title}
                      className="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-slate-800 shadow-xs"
                      onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-extrabold tracking-wider uppercase bg-sky-500/15 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800/60">
                    Sponsored
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">This might also interest you</span>
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                  {customAd.title}
                </p>
                {customAd.description && (
                  <p className="hidden xs:block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {customAd.description}
                  </p>
                )}
              </div>
            </div>

            {/* Right side: Action CTA & Rewards */}
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {/* Click target CTA */}
              <button
                type="button"
                onClick={handleCustomAdClick}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                <span>{customAd.ctaText || 'Learn More'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              {/* Earn Free Pro rewards button */}
              {onOpenRewards && (
                <button
                  type="button"
                  onClick={onOpenRewards}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 transition-all"
                  title="Watch Ad & Earn Points"
                >
                  <Gift className="w-3.5 h-3.5" />
                  <span>Rewards</span>
                </button>
              )}

              {/* Dismiss */}
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Dismiss banner"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* ── PRIORITY 2: GOOGLE ADSENSE FALLBACK (Only when zero custom Zulora ads exist) ── */
          <div>
            <div className="flex items-center justify-between gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider uppercase bg-sky-500/15 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800/60">
                  Ad
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    Support Free AI on Zulora &bull; <span className="text-slate-600 dark:text-slate-400 font-normal">Earn 1 Month Pro Free</span>
                  </p>
                  <p className="hidden xs:block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    Watch short 10s ads to collect reward points and redeem 1 Month Pro worth ₹299!
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                {onOpenRewards && (
                  <button
                    type="button"
                    onClick={onOpenRewards}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-xs active:scale-95 transition-all cursor-pointer"
                    title="Watch Ad & Earn Reward Points"
                  >
                    <Gift className="w-3.5 h-3.5 animate-bounce" />
                    <span>Earn Free Pro</span>
                    <span className="text-[10px] bg-white/20 px-1 py-0.2 rounded font-extrabold">+10 pts</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors"
                  title="Hide banner"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Google AdSense container fallback */}
            <div className="hidden sm:block mt-1 overflow-hidden max-h-[60px] text-center">
              <ins
                ref={adRef}
                className="adsbygoogle"
                style={{ display: 'block', maxHeight: '60px' }}
                data-ad-client="ca-pub-8102315442541393"
                data-ad-slot="zulora_bottom_banner"
                data-ad-format="horizontal"
                data-full-width-responsive="true"
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdBanner;
