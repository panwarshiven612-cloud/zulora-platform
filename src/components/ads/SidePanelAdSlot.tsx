/**
 * SidePanelAdSlot.tsx — Compact sidebar ad unit for free-tier users.
 * Supports image and video formats with impression & click logging.
 */

import React, { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { getActiveCustomAds, logAdImpression, logAdClick, CustomAd } from './adAnalyticsService';

export interface SidePanelAdSlotProps {
  userId?: string;
  tier?: string;
  className?: string;
}

export const SidePanelAdSlot: React.FC<SidePanelAdSlotProps> = ({
  userId = 'guest',
  tier = 'free',
  className = ''
}) => {
  const [ad, setAd] = useState<CustomAd | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Hidden for Pro / Ultra users
  const isPaidUser = tier === 'pro' || tier === 'ultra';

  useEffect(() => {
    if (isPaidUser || dismissed) return;
    let cancelled = false;

    getActiveCustomAds('sidebar')
      .then(ads => {
        if (cancelled) return;
        if (ads.length > 0) {
          const pick = ads[Math.floor(Math.random() * ads.length)];
          setAd(pick);
          if (pick.id) {
            logAdImpression(pick.id, userId, { adTitle: pick.title, placement: 'sidebar' }).catch(() => {});
          }
        } else {
          // Fallback to any active ad
          getActiveCustomAds('bottom_banner').then(fallbackAds => {
            if (cancelled || fallbackAds.length === 0) return;
            const pick = fallbackAds[Math.floor(Math.random() * fallbackAds.length)];
            setAd(pick);
            if (pick.id) {
              logAdImpression(pick.id, userId, { adTitle: pick.title, placement: 'sidebar' }).catch(() => {});
            }
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [userId, isPaidUser, dismissed]);

  if (isPaidUser || dismissed || !ad) return null;

  const isVideo = ad.imageUrl && (ad.imageUrl.endsWith('.mp4') || ad.imageUrl.endsWith('.webm'));

  const handleClick = () => {
    if (ad.id) {
      logAdClick(ad.id, userId, { adTitle: ad.title, targetUrl: ad.targetUrl, placement: 'sidebar' }).catch(() => {});
    }
    if (ad.targetUrl) {
      window.open(ad.targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className={`mt-2 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 overflow-hidden text-xs shadow-xs transition-all ${className}`}>
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Sponsored</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          title="Dismiss ad"
          aria-label="Dismiss"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      {ad.imageUrl && (
        <div className="relative overflow-hidden">
          {isVideo ? (
            <video
              src={ad.imageUrl}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-20 object-cover"
            />
          ) : (
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-full h-20 object-cover bg-slate-100 dark:bg-slate-800"
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                const parent = e.currentTarget.parentElement;
                if (parent) parent.style.display = 'none';
              }}
            />
          )}
        </div>
      )}

      <div className="p-2 space-y-1">
        <p className="font-semibold text-slate-800 dark:text-slate-100 truncate text-[11px]">{ad.title}</p>
        {ad.description && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2">{ad.description}</p>
        )}
        <button
          type="button"
          onClick={handleClick}
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
        >
          <span>{ad.ctaText || 'Learn More'}</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};

export default SidePanelAdSlot;

