/**
 * src/components/ads/UserAdDashboard.tsx
 * =======================================
 * Self-Serve User Ad Campaign Platform for Zulora AI.
 * Users must add funds (min ₹100) via wallet before launching campaigns.
 * Tracks impressions, clicks, CTR, and budget spend in real-time.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Wallet, TrendingUp, Eye, MousePointer, BarChart2,
  Play, Pause, Trash2, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, X, Image, ExternalLink, IndianRupee, Target
} from 'lucide-react';
import {
  createAdCampaign, getUserAdCampaigns, updateAdCampaign,
  getUserWallet, adjustUserWallet,
  CustomAd, UserWallet
} from './adAnalyticsService';
import { useAuth } from '../../context/AuthContext';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const INR_PER_500_IMPRESSIONS = 100;
const MIN_FUND_INR = 100;

function ctr(ad: CustomAd): string {
  if (!ad.impressions || ad.impressions === 0) return '0.00%';
  return (((ad.clicks || 0) / ad.impressions) * 100).toFixed(2) + '%';
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */
const StatChip: React.FC<{ label: string; value: string | number; icon: React.ReactNode; color?: string }> = ({
  label, value, icon, color = 'text-sky-600'
}) => (
  <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
    <span className={`${color}`}>{icon}</span>
    <div className="min-w-0">
      <p className="text-sm font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  </div>
);

/* ─── Main Component ─────────────────────────────────────────────────────── */
export interface UserAdDashboardProps {
  onClose?: () => void;
}

export const UserAdDashboard: React.FC<UserAdDashboardProps> = ({ onClose }) => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || '';

  const [campaigns, setCampaigns] = useState<CustomAd[]>([]);
  const [wallet, setWallet] = useState<UserWallet>({ uid, balanceInr: 0, totalSpent: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'campaigns' | 'create' | 'wallet'>('campaigns');
  const [creating, setCreating] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // New campaign form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    imageUrl: '',
    targetUrl: '',
    ctaText: 'Learn More',
    sponsorName: currentUser?.displayName || '',
    budgetInr: 100,
    placement: 'bottom_banner' as const
  });

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 4000);
  };

  const loadData = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const [cams, w] = await Promise.all([getUserAdCampaigns(uid), getUserWallet(uid)]);
    setCampaigns(cams);
    setWallet(w);
    setLoading(false);
  }, [uid]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddFunds = async () => {
    if (wallet.balanceInr >= MIN_FUND_INR) {
      notify('success', `Wallet balance: ₹${wallet.balanceInr}. You're ready to launch campaigns!`);
      return;
    }
    // Simulate UPI fund addition (in production, integrate Razorpay / UPI gateway here)
    notify('error', `Minimum ₹${MIN_FUND_INR} required. Integrate UPI payment gateway to add funds.`);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) { notify('error', 'Please sign in to create a campaign.'); return; }
    if (!form.title.trim()) { notify('error', 'Ad title is required.'); return; }
    if (!form.targetUrl.trim()) { notify('error', 'Target URL is required.'); return; }
    if (wallet.balanceInr < MIN_FUND_INR) {
      notify('error', `You need at least ₹${MIN_FUND_INR} in your wallet to launch a campaign.`);
      return;
    }

    setCreating(true);
    const impressionBudget = Math.floor((form.budgetInr / INR_PER_500_IMPRESSIONS) * 500);
    const id = await createAdCampaign({
      ...form,
      sponsorUid: uid,
      status: 'pending',
      impressions: 0,
      clicks: 0,
      impressionBudget,
      budgetInr: form.budgetInr
    });

    if (id) {
      notify('success', `Campaign submitted for review! It will go live after admin approval. (ID: ${id.slice(0, 8)}...)`);
      setForm({ title: '', description: '', imageUrl: '', targetUrl: '', ctaText: 'Learn More', sponsorName: currentUser?.displayName || '', budgetInr: 100, placement: 'bottom_banner' });
      setTab('campaigns');
      await loadData();
    } else {
      notify('error', 'Failed to create campaign. Please try again.');
    }
    setCreating(false);
  };

  const handleToggleCampaign = async (ad: CustomAd) => {
    if (!ad.id) return;
    const newStatus = ad.status === 'active' ? 'paused' : 'active';
    await updateAdCampaign(ad.id, { status: newStatus });
    await loadData();
  };

  if (!uid) {
    return (
      <div className="p-8 text-center text-slate-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        <p className="font-semibold">Sign in to access your Ad Dashboard.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0c1222] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">My Ad Campaigns</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Self-serve advertising platform</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <IndianRupee className="w-3 h-3 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{wallet.balanceInr}</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`mx-4 mt-3 p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {notification.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0">
        {(['campaigns', 'create', 'wallet'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-colors ${
              tab === t ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            {t === 'wallet' ? '💰 Wallet' : t === 'create' ? '+ Create Ad' : '📊 Campaigns'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ── CAMPAIGNS TAB ── */}
        {tab === 'campaigns' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-sm">No campaigns yet.</p>
                <p className="text-xs mt-1">Create your first ad to reach Zulora AI users.</p>
                <button onClick={() => setTab('create')} className="mt-4 px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition-colors">
                  + Create First Campaign
                </button>
              </div>
            ) : (
              campaigns.map(ad => (
                <div key={ad.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{ad.title}</h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{ad.targetUrl}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      ad.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      ad.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {ad.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <StatChip label="Impressions" value={ad.impressions || 0} icon={<Eye className="w-4 h-4" />} color="text-sky-600" />
                    <StatChip label="Clicks" value={ad.clicks || 0} icon={<MousePointer className="w-4 h-4" />} color="text-violet-600" />
                    <StatChip label="CTR" value={ctr(ad)} icon={<TrendingUp className="w-4 h-4" />} color="text-emerald-600" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(100, ((ad.impressions || 0) / (ad.impressionBudget || 1)) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">{ad.impressions || 0}/{ad.impressionBudget || 0}</span>
                    {(ad.status === 'active' || ad.status === 'paused') && (
                      <button onClick={() => handleToggleCampaign(ad)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                        {ad.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── CREATE TAB ── */}
        {tab === 'create' && (
          <form onSubmit={handleCreateCampaign} className="space-y-4">
            {wallet.balanceInr < MIN_FUND_INR && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>You need at least <strong>₹{MIN_FUND_INR}</strong> in your wallet to launch campaigns. Add funds in the Wallet tab.</span>
              </div>
            )}

            {[
              { name: 'title', label: 'Ad Title *', placeholder: 'e.g. Try Zulora Pro for free!', type: 'text' },
              { name: 'imageUrl', label: 'Image URL', placeholder: 'https://your-image.jpg', type: 'url' },
              { name: 'targetUrl', label: 'Target URL *', placeholder: 'https://yoursite.com', type: 'url' },
              { name: 'ctaText', label: 'CTA Button Text', placeholder: 'Learn More', type: 'text' },
              { name: 'sponsorName', label: 'Sponsor Name', placeholder: 'Your Brand', type: 'text' },
              { name: 'description', label: 'Description (optional)', placeholder: 'Brief ad description...', type: 'text' },
            ].map(({ name, label, placeholder, type }) => (
              <div key={name}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>
                <input
                  type={type}
                  value={(form as any)[name]}
                  onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Budget (₹) — ₹100 = 500 impressions
              </label>
              <input
                type="number"
                min={100}
                step={100}
                value={form.budgetInr}
                onChange={e => setForm(f => ({ ...f, budgetInr: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">≈ {Math.floor((form.budgetInr / 100) * 500).toLocaleString()} impressions</p>
            </div>

            <button
              type="submit"
              disabled={creating || wallet.balanceInr < MIN_FUND_INR}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? 'Submitting...' : 'Submit Campaign for Review'}
            </button>
          </form>
        )}

        {/* ── WALLET TAB ── */}
        {tab === 'wallet' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-center">
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider mb-1">Current Balance</p>
              <p className="text-3xl font-black text-emerald-700 dark:text-emerald-300">₹{wallet.balanceInr}</p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Total Spent: ₹{wallet.totalSpent || 0}</p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Add Funds via UPI</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Send payment to <strong className="text-slate-700 dark:text-slate-300">zulora.help@gmail.com</strong> via UPI and contact support to credit your wallet. Minimum: ₹{MIN_FUND_INR}.</p>

              <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                <p>📧 UPI ID: <strong>panwarshiven612@oksbi</strong></p>
                <p>💬 WhatsApp: <strong>+91 9XXXXXXXX</strong></p>
                <p>📩 Email: <strong>zulora.help@gmail.com</strong></p>
              </div>

              <button
                onClick={handleAddFunds}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                I've Sent the Payment
              </button>
            </div>

            <div className="p-4 rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/20 text-xs text-sky-700 dark:text-sky-300 space-y-1">
              <p className="font-bold">Pricing</p>
              <p>• ₹100 = 500 impressions across Zulora AI chat & sidebar</p>
              <p>• ₹500 = 2,500 impressions + priority placement</p>
              <p>• ₹1,000 = 5,500 impressions + featured ad label</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserAdDashboard;

