import React, { useState, useEffect } from 'react';
import { Sparkles, ExternalLink, X, Megaphone, ArrowRight } from 'lucide-react';
import { getActiveCustomAds, logAdImpression, logAdClick, CustomAd } from './adAnalyticsService';

export interface SponsoredCardProps {
  userId?: string;
  tier?: string;
  className?: string;
}

export const SponsoredCard: React.FC<SponsoredCardProps> = ({
  userId = 'anonymous',
  tier = 'free',
  className = ''
}) => {
  const [ad, setAd] = useState<CustomAd | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Free tier only
  const isPaid = tier === 'pro' || tier === 'ultra';

  useEffect(() => {
    if (isPaid || dismissed) return;

    let isMounted = true;
    getActiveCustomAds('bottom_banner')
      .then(ads => {
        if (!isMounted || ads.length === 0) return;
        const chosen = ads[Math.floor(Math.random() * ads.length)];
        setAd(chosen);
        if (chosen.id) {
          logAdImpression(chosen.id, userId, { adTitle: chosen.title, placement: 'chat_sponsored_card' });
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [isPaid, dismissed, userId]);

  if (isPaid || dismissed || !ad) return null;

  const handleClick = () => {
    if (!ad.targetUrl) return;
    if (ad.id) {
      logAdClick(ad.id, userId, { adTitle: ad.title, targetUrl: ad.targetUrl, placement: 'chat_sponsored_card' });
    }
    window.open(ad.targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`my-3 w-full max-w-2xl mx-auto animate-fade-slide ${className}`}>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#0c1322]/95 p-3.5 shadow-sm hover:shadow-md transition-all">
        
        {/* Dismiss Button */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Dismiss sponsored recommendation"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Sponsored Label Header */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[10px] font-extrabold tracking-wider uppercase px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-300/60 dark:border-amber-800/60">
            Sponsored
          </span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            This might also interest you &bull; {ad.sponsorName || 'Featured Partner'}
          </span>
        </div>

        {/* Main Card Content */}
        <div className="flex items-start gap-3.5 flex-col sm:flex-row">
          {ad.imageUrl && (
            <div className="shrink-0 w-full sm:w-28 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
              <img
                src={ad.imageUrl}
                alt={ad.title}
                className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
              />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight">
              {ad.title}
            </h4>
            {ad.description && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                {ad.description}
              </p>
            )}

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={handleClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 transition cursor-pointer shadow-xs"
              >
                <span>{ad.ctaText || 'Learn More'}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-slate-400 truncate">
                {ad.targetUrl.replace(/^https?:\/\//, '').split('/')[0]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SponsoredCard;

