import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Gift, ExternalLink, Zap } from 'lucide-react';

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
  const [dismissed, setDismissed] = useState(false);
  const [adLoaded, setAdLoaded] = useState(false);
  const adRef = useRef<HTMLModElement>(null);

  // If user is already on Pro or Ultra tier, hide ad banners completely
  const isPaidTier = tier === 'pro' || tier === 'ultra';

  useEffect(() => {
    if (isPaidTier || dismissed) return;

    try {
      if (typeof window !== 'undefined' && adRef.current) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        setAdLoaded(true);
      }
    } catch (e) {
      // AdSense script may be blocked by adblocker, fallback banner remains visible
      setAdLoaded(false);
    }
  }, [isPaidTier, dismissed]);

  if (isPaidTier || dismissed) {
    return null;
  }

  return (
    <div
      role="complementary"
      aria-label="Advertisement and Rewards"
      className={`relative w-full max-w-4xl mx-auto my-1.5 transition-all duration-300 animate-fade-slide ${className}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/70 dark:border-sky-900/50 bg-gradient-to-r from-sky-50/90 via-indigo-50/70 to-emerald-50/80 dark:from-slate-900/90 dark:via-sky-950/40 dark:to-slate-900/90 p-2 sm:p-2.5 shadow-sm backdrop-blur-md">
        
        {/* Subtle decorative glow */}
        <div className="absolute -right-10 -top-10 w-28 h-28 bg-sky-400/10 dark:bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

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

