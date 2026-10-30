import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Gift, ExternalLink, Zap, Megaphone } from 'lucide-react';
import { getActiveCustomAds, logAdImpression, logAdClick, CustomAd } from './adAnalyticsService';

declare global {
  interface Window {
    adsbygoogle?: any[];
  }
}

export interface AdBannerProps {
  onOpenRewards?: () => void;
  tier?: string;
  userId?: string;
  className?: string;
}

export const AdBanner: React.FC<AdBannerProps> = ({
  onOpenRewards,
  tier = 'free',
  userId = 'anonymous',
  className = ''
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [adLoaded, setAdLoaded] = useState(false);
  const [customAd, setCustomAd] = useState<CustomAd | null>(null);
  const adRef = useRef<HTMLModElement>(null);

  // If user is already on Pro or Ultra tier, hide ad banners completely
  const isPaidTier = tier === 'pro' || tier === 'ultra';

  // 1. Fetch active custom admin sponsored ad (if any)
  useEffect(() => {
    if (isPaidTier || dismissed) return;

    let isMounted = true;
    getActiveCustomAds('bottom_banner')
      .then(ads => {
        if (!isMounted) return;
        if (ads.length > 0) {
          // Pick the latest or a random active custom ad
          const chosen = ads[Math.floor(Math.random() * ads.length)];
          setCustomAd(chosen);
          // Log impression to Firestore adAnalytics
          if (chosen.id) {
            logAdImpression(chosen.id, userId, { adTitle: chosen.title, placement: 'bottom_banner' });
          }
        }
      })
      .catch(err => {
        console.debug('[AdBanner] Could not load custom ads:', err);
      });

    return () => { isMounted = false; };
  }, [isPaidTier, dismissed, userId]);

  // 2. Initialize Google AdSense for banner slot
  useEffect(() => {
    if (isPaidTier || dismissed) return;

    try {
      if (typeof window !== 'undefined' && adRef.current) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        setAdLoaded(true);
        // Log AdSense impression
        logAdImpression('google-adsense-bottom', userId, { adTitle: 'Google AdSense Banner', placement: 'bottom_banner' });
      }
    } catch (e) {
      // AdSense script may be blocked by adblocker, fallback banner remains visible
      setAdLoaded(false);
    }
  }, [isPaidTier, dismissed, userId]);

  if (isPaidTier || dismissed) {
    return null;
  }

  const handleCustomAdClick = () => {
    if (!customAd?.targetUrl) return;
    if (customAd.id) {
      logAdClick(customAd.id, userId, { 
        adTitle: customAd.title, 
        targetUrl: customAd.targetUrl, 
        placement: 'bottom_banner' 
      });
    }
    window.open(customAd.targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      role="complementary"
      aria-label="Advertisement and Rewards"
      className={`relative w-full max-w-4xl mx-auto my-1.5 transition-all duration-300 animate-fade-slide ${className}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/70 dark:border-sky-900/50 bg-gradient-to-r from-sky-50/90 via-indigo-50/70 to-emerald-50/80 dark:from-slate-900/90 dark:via-sky-950/40 dark:to-slate-900/90 p-2 sm:p-2.5 shadow-sm backdrop-blur-md">
        
        {/* Subtle decorative glow */}
        <div className="absolute -right-10 -top-10 w-28 h-28 bg-sky-400/10 dark:bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* 1. Custom Admin Sponsored Ad (if active) */}
        {customAd ? (
          <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap pb-1 border-b border-sky-100 dark:border-sky-900/40 mb-1.5">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {customAd.imageUrl ? (
                <img 
                  src={customAd.imageUrl} 
                  alt={customAd.title} 
                  className="w-10 h-10 rounded-xl object-cover border border-sky-200/60 dark:border-sky-800 shrink-0 shadow-xs"
                  onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-300 dark:border-sky-800 flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold tracking-wider uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60">
                    Sponsored
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                    {customAd.sponsorName || 'Featured Partner'}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {customAd.title}
                </p>
                {customAd.description && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">
                    {customAd.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <button
                type="button"
                onClick={handleCustomAdClick}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 shadow-xs transition cursor-pointer"
              >
                <span>{customAd.ctaText || 'Visit Sponsor'}</span>
                <ExternalLink className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        ) : null}

        {/* 2. Zulora AdSense & Free Pro Rewards Ribbon */}
        <div className="flex items-center justify-between gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap">
          {/* Left: Sponsored Badge & Pitch */}
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

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {onOpenRewards && (
              <button
                type="button"
                onClick={onOpenRewards}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-xs hover:shadow-sm active:scale-95 transition-all cursor-pointer"
                title="Watch Ad & Earn Reward Points"
              >
                <Gift className="w-3.5 h-3.5 animate-bounce" />
                <span>Earn Free Pro</span>
                <span className="text-[10px] bg-white/20 px-1 py-0.2 rounded font-extrabold">+10 pts</span>
              </button>
            )}

            {/* Dismiss button */}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors"
              title="Hide banner"
              aria-label="Dismiss advertisement banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Real Google AdSense Banner Container (non-intrusive slot) */}
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
    </div>
  );
};

export default AdBanner;
