import React, { useState, useEffect } from 'react';
import { Megaphone, ExternalLink, X } from 'lucide-react';
import { getActiveCustomAds, logAdImpression, logAdClick, CustomAd } from './adAnalyticsService';

export interface SidePanelAdSlotProps {
  userId?: string;
  className?: string;
}

export const SidePanelAdSlot: React.FC<SidePanelAdSlotProps> = ({
  userId = 'anonymous',
  className = ''
}) => {
  const [ad, setAd] = useState<CustomAd | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getActiveCustomAds('sidebar')
      .then(ads => {
        if (!isMounted || ads.length === 0) return;
        const chosen = ads[Math.floor(Math.random() * ads.length)];
        setAd(chosen);
        if (chosen.id) {
          logAdImpression(chosen.id, userId, { adTitle: chosen.title, placement: 'sidebar' });
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [userId]);

  if (!ad || closed) return null;

  const handleClick = () => {
    if (!ad.targetUrl) return;
    if (ad.id) {
      logAdClick(ad.id, userId, { adTitle: ad.title, targetUrl: ad.targetUrl, placement: 'sidebar' });
    }
    window.open(ad.targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`p-3 my-2 rounded-2xl border border-sky-200/60 dark:border-sky-900/40 bg-sky-50/50 dark:bg-slate-900/50 backdrop-blur-xs relative text-left ${className}`}>
      <button
        onClick={() => setClosed(true)}
        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
        title="Dismiss ad"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="px-1.5 py-0.2 rounded text-[8px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/60">
          Sponsored
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
          {ad.sponsorName}
        </span>
      </div>

      {ad.imageUrl && (
        <img
          src={ad.imageUrl}
          alt={ad.title}
          className="w-full h-24 object-cover rounded-xl mb-2 border border-slate-200/60 dark:border-slate-800"
          onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
        />
      )}

      <p className="text-xs font-bold text-slate-800 dark:text-white line-clamp-1">
        {ad.title}
      </p>
      {ad.description && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5 mb-2">
          {ad.description}
        </p>
      )}

      <button
        type="button"
        onClick={handleClick}
        className="w-full mt-1.5 flex items-center justify-center gap-1 py-1.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold shadow-xs transition"
      >
        <span>{ad.ctaText || 'Learn More'}</span>
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
};

export default SidePanelAdSlot;
