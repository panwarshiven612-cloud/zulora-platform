/**
 * SponsoredCard.tsx — ChatGPT-style inline sponsored ad card.
 * Rendered directly beneath completed AI response streams.
 * Shown only for free-tier users. Logs impression and click metrics to Firestore ('adAnalytics').
 */

import React, { useEffect, useState, useRef } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { useActiveAds, logAdImpression, logAdClick, CustomAd } from '../../lib/ads/adService';

export interface SponsoredCardProps {
  userId?: string;
  tier?: string;
  className?: string;
  contextPrompt?: string;
  userInterests?: string[];
}

export const SponsoredCard: React.FC<SponsoredCardProps> = ({
  userId = 'guest',
  tier = 'free',
  className = '',
  contextPrompt = '',
  userInterests = []
}) => {
  const [dismissed, setDismissed] = useState(false);
  const loggedImpressionAdIdRef = useRef<string | null>(null);

  // Free users only
  const isPaidUser = tier === 'pro' || tier === 'ultra';

  // Global real-time listener for chat sponsored cards / bottom banners
  const { ads, activeAd, loading } = useActiveAds('chat_sponsored_card', contextPrompt, userInterests);
  const ad: CustomAd | null = activeAd || (ads.length > 0 ? ads[0] : null);

  useEffect(() => {
    if (isPaidUser || dismissed || !ad?.id) return;
    if (loggedImpressionAdIdRef.current === ad.id) return;
    loggedImpressionAdIdRef.current = ad.id;

    logAdImpression(ad.id, userId, {
      adTitle: ad.title,
      placement: 'chat_sponsored_card',
      sourceCollection: ad._sourceCollection
    }).catch(() => {});
  }, [ad, isPaidUser, dismissed, userId]);

  if (isPaidUser || dismissed || loading || !ad) {
    return null;
  }

  const handleClick = () => {
    if (ad.id) {
      logAdClick(ad.id, userId, {
        adTitle: ad.title,
        targetUrl: ad.targetUrl,
        placement: 'chat_sponsored_card',
        sourceCollection: ad._sourceCollection
      }).catch(() => {});
    }
    if (ad.targetUrl) {
      window.open(ad.targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      role="complementary"
      aria-label="Sponsored recommendation"
      className={`mx-auto w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mt-3 mb-2 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 backdrop-blur-md shadow-sm overflow-hidden animate-fade-slide ${className}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/30">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500">
            Sponsored
          </span>
          <span className="text-slate-300 dark:text-slate-700">&bull;</span>
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
            This might also interest you
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Dismiss sponsored content"
          aria-label="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex items-center gap-3 p-3">
        {ad.imageUrl && (
          <div className="shrink-0">
            {ad.imageUrl.endsWith('.mp4') || ad.imageUrl.endsWith('.webm') ? (
              <video
                src={ad.imageUrl}
                autoPlay
                muted
                loop
                playsInline
                className="w-14 h-14 rounded-xl object-cover bg-slate-100 dark:bg-slate-800"
              />
            ) : (
              <img
                src={ad.imageUrl}
                alt={ad.title}
                className="w-14 h-14 rounded-xl object-cover bg-slate-100 dark:bg-slate-800 shadow-xs"
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug truncate">
            {ad.title}
          </p>
          {ad.description && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
              {ad.description}
            </p>
          )}
          {ad.sponsorName && (
            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
              by {ad.sponsorName}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleClick}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white text-[11px] font-bold shadow-xs transition-all cursor-pointer"
        >
          <span>{ad.ctaText || 'Learn More'}</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default SponsoredCard;
