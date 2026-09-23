import React, { useState, useEffect } from 'react';
import { 
  X, 
  Zap, 
  Clock, 
  Sparkles, 
  MessageSquare, 
  Image as ImageIcon, 
  Film, 
  Check, 
  ShieldCheck, 
  AlertCircle,
  ExternalLink,
  Crown
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../context/AuthContext';
import { TIERS, TIER_PRICING, BASE_LIMITS } from '../services/firestoreService';

export const UsageLimitsModal = ({ isOpen, onClose }) => {
  const { 
    tier, 
    limits, 
    usage, 
    upgradeTier, 
    refreshProfile 
  } = useAuth();

  const [chatCountdown, setChatCountdown] = useState('');
  const [dayCountdown, setDayCountdown] = useState('');
  const [upgrading, setUpgrading] = useState(false);

  // Dynamic countdown calculations
  useEffect(() => {
    if (!isOpen) return;

    const updateTimers = () => {
      const now = Date.now();

      // Chat window (2 hours)
      const chatStart = usage.chatWindowStart || now;
      const chatDuration = 2 * 60 * 60 * 1000;
      const chatLeft = Math.max(0, (chatStart + chatDuration) - now);
      
      const cHours = Math.floor(chatLeft / (1000 * 60 * 60));
      const cMinutes = Math.floor((chatLeft % (1000 * 60 * 60)) / (1000 * 60));
      const cSeconds = Math.floor((chatLeft % (1000 * 60)) / 1000);
      setChatCountdown(`${cHours}h ${cMinutes}m ${cSeconds}s`);

      // Day window (24 hours)
      const imageStart = usage.imageWindowStart || now;
      const dayDuration = 24 * 60 * 60 * 1000;
      const dayLeft = Math.max(0, (imageStart + dayDuration) - now);

      const dHours = Math.floor(dayLeft / (1000 * 60 * 60));
      const dMinutes = Math.floor((dayLeft % (1000 * 60 * 60)) / (1000 * 60));
      setDayCountdown(`${dHours}h ${dMinutes}m`);
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);
    return () => clearInterval(interval);
  }, [isOpen, usage]);

  if (!isOpen) return null;

  const handleUpgrade = async (newTier) => {
    setUpgrading(true);
    try {
      await upgradeTier(newTier);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      await refreshProfile();
    } catch (e) {
      console.error('Upgrade failed:', e);
    } finally {
      setUpgrading(false);
    }
  };

  const chatPercent = Math.min(100, Math.round(((usage.chatCount || 0) / limits.chat) * 100));
  const imagePercent = Math.min(100, Math.round(((usage.imageCount || 0) / limits.image) * 100));
  const videoPercent = Math.min(100, Math.round(((usage.videoCount || 0) / limits.video) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-fade-in">
      <div 
        className="fixed inset-0" 
        onClick={onClose} 
      />

      <div className="relative max-w-2xl w-full rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6 z-10 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Usage Limits & Quota
                </h2>
                <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-sky-500/10 text-sky-500 border border-sky-500/20 uppercase">
                  {tier} Plan
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dynamic quotas tracked in real-time. Upgrade to unlock 2x or 5x capacity.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-time Usage Progress Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          
          {/* Chat Quota Card */}
          <div className="p-4 rounded-2xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-sky-500" />
                <span>Chats (2h)</span>
              </span>
              <span className={`text-xs font-extrabold ${chatPercent >= 100 ? 'text-red-500' : 'text-sky-500'}`}>
                {chatPercent}%
              </span>
            </div>

            <div className="text-xl font-black text-slate-900 dark:text-white">
              {usage.chatCount || 0} <span className="text-xs font-normal text-slate-400">/ {limits.chat}</span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  chatPercent >= 100 ? 'bg-red-500' : 'bg-sky-500'
                }`}
                style={{ width: `${chatPercent}%` }}
              />
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>Resets in: {chatCountdown}</span>
            </div>
          </div>

          {/* Image Quota Card */}
          <div className="p-4 rounded-2xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                <span>Images (24h)</span>
              </span>
              <span className={`text-xs font-extrabold ${imagePercent >= 100 ? 'text-red-500' : 'text-indigo-500'}`}>
                {imagePercent}%
              </span>
            </div>

            <div className="text-xl font-black text-slate-900 dark:text-white">
              {usage.imageCount || 0} <span className="text-xs font-normal text-slate-400">/ {limits.image}</span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  imagePercent >= 100 ? 'bg-red-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${imagePercent}%` }}
              />
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>Resets in: {dayCountdown}</span>
            </div>
          </div>

          {/* Video Quota Card */}
          <div className="p-4 rounded-2xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-purple-500" />
                <span>Videos (24h)</span>
              </span>
              <span className={`text-xs font-extrabold ${videoPercent >= 100 ? 'text-red-500' : 'text-purple-500'}`}>
                {videoPercent}%
              </span>
            </div>

            <div className="text-xl font-black text-slate-900 dark:text-white">
              {usage.videoCount || 0} <span className="text-xs font-normal text-slate-400">/ {limits.video}</span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  videoPercent >= 100 ? 'bg-red-500' : 'bg-purple-500'
                }`}
                style={{ width: `${videoPercent}%` }}
              />
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>Resets in: {dayCountdown}</span>
            </div>
          </div>

        </div>

        {/* Upgrade Tiers Showcase */}
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">
            Expand Your Computational Limits
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Pro Upgrade Card (₹299/mo) */}
            <div className={`p-5 rounded-2xl border transition-all ${
              tier === TIERS.PRO
                ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/40 ring-2 ring-sky-500/20'
                : 'border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 hover:border-sky-400'
            }`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-xs font-bold text-sky-500 uppercase tracking-wider">Pro Tier</div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    ₹299 <span className="text-xs font-normal text-slate-400">/ month</span>
                  </div>
                </div>
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  2x Multiplier
                </span>
              </div>

              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 mb-4">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span><strong>100 Chats</strong> per 2 hours (2x)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span><strong>60 Images</strong> per day (2x)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span><strong>8 Videos</strong> per day (2x)</span>
                </li>
              </ul>

              <button
                onClick={() => handleUpgrade(TIERS.PRO)}
                disabled={upgrading || tier === TIERS.PRO}
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                  tier === TIERS.PRO
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-default'
                    : 'text-white azure-gradient-btn'
                }`}
              >
                {tier === TIERS.PRO ? 'Active Plan' : 'Activate Pro (₹299)'}
              </button>
            </div>

            {/* Ultra Pro Max Card (₹599/mo) */}
            <div className={`p-5 rounded-2xl border transition-all ${
              tier === TIERS.ULTRA
                ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/40 ring-2 ring-amber-500/20'
                : 'border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 hover:border-amber-400'
            }`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                    <Crown className="w-3.5 h-3.5" />
                    <span>Ultra Pro Max</span>
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    ₹599 <span className="text-xs font-normal text-slate-400">/ month</span>
                  </div>
                </div>
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  5x Multiplier
                </span>
              </div>

              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 mb-4">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span><strong>250 Chats</strong> per 2 hours (5x)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span><strong>150 Images</strong> per day (5x)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span><strong>20 Videos</strong> per day (5x)</span>
                </li>
              </ul>

              <button
                onClick={() => handleUpgrade(TIERS.ULTRA)}
                disabled={upgrading || tier === TIERS.ULTRA}
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                  tier === TIERS.ULTRA
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-default'
                    : 'text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md'
                }`}
              >
                {tier === TIERS.ULTRA ? 'Active Plan' : 'Activate Ultra (₹599)'}
              </button>
            </div>

          </div>
        </div>

        {/* WhatsApp Quick Support */}
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-emerald-500 font-bold text-xs">WhatsApp Helpline:</span>
            <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">+91 6395211325</span>
          </div>
          <a
            href="https://wa.me/916395211325?text=Hello%20Shiven,%20I%20want%20to%20upgrade%20my%20Zulora%20AI%20tier"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-emerald-500 hover:underline flex items-center gap-1"
          >
            <span>Message Founder</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

      </div>
    </div>
  );
};

export default UsageLimitsModal;

