/**
 * src/components/ads/UserAdDashboard.tsx
 * =======================================
 * Self-Serve User Ad Campaign Platform for Zulora AI.
 * Users must add funds (min ₹100 via UPI) before launching campaigns.
 * Tracks impressions, clicks, CTR, and budget spend in real-time.
 * UPI ID: shivenpanwar@fam | WhatsApp: +91 6395211325
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Wallet, TrendingUp, Eye, Users, MousePointer, BarChart2,
  Play, Pause, Trash2, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, X, Image, ExternalLink, IndianRupee, Target,
  QrCode, MessageCircle, Copy, Check
} from 'lucide-react';
import {
  createAdCampaign, getUserAdCampaigns, updateAdCampaign, deleteAdCampaign,
  getUserWallet, adjustUserWallet,
  CustomAd, UserWallet
} from './adAnalyticsService';
import { useAuth } from '../../context/AuthContext';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';

/* ─── Helpers & Constants ─────────────────────────────────────────────────── */
const INR_PER_500_IMPRESSIONS = 100;
const MIN_FUND_INR = 100;
const OFFICIAL_UPI_ID = 'shivenpanwar@fam';
const OFFICIAL_WHATSAPP = '+91 6395211325';
const WHATSAPP_RAW_NUMBER = '916395211325';

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
  const userEmail = currentUser?.email || 'guest@zulora.in';

  const [campaigns, setCampaigns] = useState<CustomAd[]>([]);
  const [wallet, setWallet] = useState<UserWallet>({ uid, balanceInr: 0, totalSpent: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'campaigns' | 'create' | 'wallet'>('campaigns');
  const [creating, setCreating] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Wallet add funds state
  const [fundAmount, setFundAmount] = useState<number>(100);
  const [utrInput, setUtrInput] = useState<string>('');
  const [submittingUtr, setSubmittingUtr] = useState<boolean>(false);
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);

  // New campaign form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    imageUrl: '',
    targetUrl: '',
    ctaText: 'Learn More',
    sponsorName: currentUser?.displayName || 'Promoted Brand',
    budgetInr: 100,
    placement: 'bottom_banner' as const
  });

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 5000);
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

  const handleCopyUpi = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(OFFICIAL_UPI_ID);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2500);
    }
  };

  const handleSubmitUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUtr = utrInput.trim();
    if (!/^\d{12}$/.test(cleanUtr)) {
      notify('error', 'Please enter a valid 12-digit numeric UTR / Transaction ID.');
      return;
    }
    if (!uid) {
      notify('error', 'Please sign in to record your wallet deposit.');
      return;
    }

    setSubmittingUtr(true);
    try {
      await addDoc(collection(db, 'walletRequests'), {
        userId: uid,
        userEmail,
        userName: currentUser?.displayName || 'User',
        amount: fundAmount,
        utr: cleanUtr,
        status: 'pending',
        upiId: OFFICIAL_UPI_ID,
        createdAt: Date.now(),
        serverTimestamp: serverTimestamp()
      });

      notify(
        'success',
        `UTR ${cleanUtr} recorded! Send payment screenshot to WhatsApp ${OFFICIAL_WHATSAPP} for verification within 1 hour.`
      );
      setUtrInput('');
    } catch (err: any) {
      console.warn('UTR submission error:', err);
      notify('error', 'Failed to submit UTR. Please message our WhatsApp directly with your screenshot.');
    } finally {
      setSubmittingUtr(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) { notify('error', 'Please sign in to create a campaign.'); return; }
    if (!form.title.trim()) { notify('error', 'Ad title is required.'); return; }
    if (!form.targetUrl.trim()) { notify('error', 'Target URL is required.'); return; }
    const requiredBudget = Math.max(MIN_FUND_INR, Number(form.budgetInr || 100));
    if (wallet.balanceInr < requiredBudget) {
      notify('error', `You need at least ₹${requiredBudget} in your wallet to launch this campaign. Current balance: ₹${wallet.balanceInr}. Please add funds in the Wallet tab.`);
      setTab('wallet');
      return;
    }

    setCreating(true);
    const impressionBudget = Math.floor((requiredBudget / INR_PER_500_IMPRESSIONS) * 500);
    const id = await createAdCampaign({
      ...form,
      sponsorUid: uid,
      status: 'pending',
      impressions: 0,
      uniqueViewers: 0,
      viewerUids: [],
      clicks: 0,
      impressionBudget,
      budgetInr: requiredBudget
    });

    if (id) {
      // Immediately deduct required budget from advertising wallet balance
      await adjustUserWallet(uid, -requiredBudget);
      setWallet(prev => ({
        ...prev,
        balanceInr: Math.max(0, prev.balanceInr - requiredBudget),
        totalSpent: prev.totalSpent + requiredBudget
      }));

      notify('success', `Campaign submitted for review! ₹${requiredBudget} deducted from ad wallet. It will go live after admin approval. (ID: ${id.slice(0, 8)}...)`);
      setForm({
        title: '',
        description: '',
        imageUrl: '',
        targetUrl: '',
        ctaText: 'Learn More',
        sponsorName: currentUser?.displayName || '',
        budgetInr: 100,
        placement: 'bottom_banner'
      });
      setTab('campaigns');
      await loadData();
    } else {
      notify('error', 'Failed to create campaign. Please try again.');
    }
    setCreating(false);
  };

  const handleDeleteCampaign = async (ad: CustomAd) => {
    if (!ad.id) return;
    if (!window.confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await deleteAdCampaign(ad.id);
      setCampaigns(prev => prev.filter(c => c.id !== ad.id));
      notify('success', 'Campaign deleted successfully.');
    } catch {
      notify('error', 'Failed to delete campaign.');
    }
  };

  const handleToggleCampaign = async (ad: CustomAd) => {
    if (!ad.id) return;
    const newStatus = ad.status === 'active' ? 'paused' : 'active';
    await updateAdCampaign(ad.id, { status: newStatus });
    await loadData();
  };

  const upiDeepLink = `upi://pay?pa=${OFFICIAL_UPI_ID}&pn=Zulora%20AI&am=${fundAmount}&cu=INR&tn=Zulora%20Ad%20Wallet%20Deposit`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiDeepLink)}`;
  const whatsappUrl = `https://wa.me/${WHATSAPP_RAW_NUMBER}?text=${encodeURIComponent(
    `Hello Zulora Team! I sent payment of ₹${fundAmount} for my Zulora Ad Campaign Wallet. My UTR ID is: ${utrInput || '[Attached in screenshot]'}, User ID: ${uid}`
  )}`;

  if (!uid) {
    return (
      <div className="p-8 text-center text-slate-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-sky-500" />
        <p className="font-semibold">Sign in to access your Ad Dashboard & Wallet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0c1222] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Zulora Ad Campaign Studio</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Promote your brand to thousands of Zulora AI users</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <IndianRupee className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">₹{wallet.balanceInr}</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className={`mx-4 mt-3 p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 px-4 pt-3 pb-0 border-b border-slate-200/60 dark:border-slate-800/60">
        {(['campaigns', 'create', 'wallet'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold capitalize transition-colors flex items-center gap-1.5 ${
              tab === t ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t === 'wallet' && <Wallet className="w-3.5 h-3.5" />}
            {t === 'create' && <Plus className="w-3.5 h-3.5" />}
            {t === 'campaigns' && <BarChart2 className="w-3.5 h-3.5" />}
            {t === 'wallet' ? 'Wallet & Funds' : t === 'create' ? 'Create Ad' : 'My Campaigns'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── CAMPAIGNS TAB ── */}
        {tab === 'campaigns' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-40 text-sky-500" />
                <p className="font-semibold text-sm text-slate-800 dark:text-white">No campaigns active yet.</p>
                <p className="text-xs mt-1 text-slate-500">Launch your first promotional ad across Zulora AI chat and sidebar.</p>
                <button
                  onClick={() => setTab('create')}
                  className="mt-4 px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create First Campaign
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
                    <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      ad.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      ad.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {ad.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatChip label="Views" value={ad.impressions || 0} icon={<Eye className="w-4 h-4" />} color="text-sky-600" />
                    <StatChip label="Viewers" value={ad.uniqueViewers || (ad.viewerUids ? ad.viewerUids.length : (ad.impressions ? 1 : 0))} icon={<Users className="w-4 h-4" />} color="text-indigo-600" />
                    <StatChip label="Clicks" value={ad.clicks || 0} icon={<MousePointer className="w-4 h-4" />} color="text-violet-600" />
                    <StatChip label="CTR" value={ctr(ad)} icon={<TrendingUp className="w-4 h-4" />} color="text-emerald-600" />
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-sky-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, ((ad.impressions || 0) / (ad.impressionBudget || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                      {ad.impressions || 0} / {ad.impressionBudget || 0}
                    </span>
                    {(ad.status === 'active' || ad.status === 'paused') && (
                      <button
                        onClick={() => handleToggleCampaign(ad)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        title={ad.status === 'active' ? 'Pause Campaign' : 'Resume Campaign'}
                      >
                        {ad.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteCampaign(ad)}
                      className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-950/40 transition-colors"
                      title="Delete Campaign"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="font-bold">Minimum Wallet Balance Required</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    You need at least <strong>₹{MIN_FUND_INR}</strong> in your advertising wallet to launch campaigns.
                    Please add funds in the Wallet tab via UPI ({OFFICIAL_UPI_ID}).
                  </p>
                </div>
              </div>
            )}

            {[
              { name: 'title', label: 'Campaign Title *', placeholder: 'e.g. Try our SaaS platform for free!', type: 'text' },
              { name: 'imageUrl', label: 'Media URL (Image or Video .mp4 string)', placeholder: 'https://...', type: 'url' },
              { name: 'targetUrl', label: 'Click Target Link URL *', placeholder: 'https://yoursite.com/signup', type: 'url' },
              { name: 'ctaText', label: 'CTA Button Text', placeholder: 'Visit Website', type: 'text' },
              { name: 'sponsorName', label: 'Sponsor / Brand Name', placeholder: 'Your Brand Name', type: 'text' },
              { name: 'description', label: 'Short Pitch / Description (optional)', placeholder: 'Describe your product in 1-2 sentences...', type: 'text' },
            ].map(({ name, label, placeholder, type }) => (
              <div key={name}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>
                <input
                  type={type}
                  value={(form as any)[name]}
                  onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Budget Allocation (₹) — ₹100 = 500 targeted views
              </label>
              <input
                type="number"
                min={100}
                step={50}
                value={form.budgetInr}
                onChange={e => setForm(f => ({ ...f, budgetInr: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                ≈ {Math.floor((form.budgetInr / 100) * 500).toLocaleString()} impressions across Zulora chat &amp; sidebar
              </p>
            </div>

            <button
              type="submit"
              disabled={creating || wallet.balanceInr < MIN_FUND_INR}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-sm"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? 'Submitting Campaign...' : 'Submit Campaign for Review'}
            </button>
          </form>
        )}

        {/* ── WALLET TAB ── */}
        {tab === 'wallet' && (
          <div className="space-y-4">
            {/* Balance Card */}
            <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-sky-500/10 text-center">
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-extrabold uppercase tracking-wider mb-0.5">
                Advertising Wallet Balance
              </p>
              <p className="text-3xl font-black text-emerald-700 dark:text-emerald-300">₹{wallet.balanceInr}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Total Budget Spent: ₹{wallet.totalSpent || 0} &bull; Min Deposit: ₹{MIN_FUND_INR}
              </p>
            </div>

            {/* UPI Payment Box */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-emerald-500" />
                  Add Funds via UPI QR Code
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Select an amount and scan to transfer from any UPI app (Google Pay, PhonePe, Paytm, BHIM).
                </p>
              </div>

              {/* Amount Selector */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1.5">Select Amount (₹)</label>
                <div className="grid grid-cols-4 gap-2">
                  {[100, 250, 500, 1000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setFundAmount(amt)}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                        fundAmount === amt
                          ? 'border-emerald-500 bg-emerald-600 text-white shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-400'
                      }`}
                    >
                      ₹{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* QR Code & UPI Details Row */}
              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <div className="shrink-0 p-2 bg-white rounded-xl shadow-xs border border-slate-100 text-center">
                  <img
                    src={qrCodeUrl}
                    alt="UPI Payment QR Code"
                    className="w-36 h-36 mx-auto object-contain"
                  />
                  <span className="text-[10px] font-bold text-slate-600 mt-1 block">Scan to Pay ₹{fundAmount}</span>
                </div>

                <div className="flex-1 space-y-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Official UPI ID</span>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="font-mono font-bold text-slate-900 dark:text-white text-sm select-all">
                        {OFFICIAL_UPI_ID}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyUpi}
                        className="px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300 text-[10px] font-bold flex items-center gap-1 hover:bg-sky-100 transition"
                      >
                        {copiedUpi ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedUpi ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <a
                    href={upiDeepLink}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open UPI App Directly (Pay ₹{fundAmount})
                  </a>
                </div>
              </div>

              {/* UTR Submission Form */}
              <form onSubmit={handleSubmitUtr} className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700/60">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Enter 12-Digit UTR / Transaction ID after payment
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={12}
                      pattern="[0-9]{12}"
                      value={utrInput}
                      onChange={e => setUtrInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="12-digit UTR Number"
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-bold"
                    />
                    <button
                      type="submit"
                      disabled={submittingUtr || utrInput.length !== 12}
                      className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-xs transition"
                    >
                      {submittingUtr ? 'Recording...' : 'Submit UTR'}
                    </button>
                  </div>
                </div>

                {/* Explicit Verification Instructions Banner */}
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1.5">
                  <p className="font-bold flex items-center gap-1.5">
                    <MessageCircle className="w-4 h-4 text-emerald-600" />
                    Important Payment Verification Instruction:
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    <em>&quot;Send your UTR ID and payment screenshot to our WhatsApp ({OFFICIAL_WHATSAPP}) for fastest verification and wallet crediting within 1 hour.&quot;</em>
                  </p>
                </div>

                {/* Direct WhatsApp Button */}
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Send Screenshot on WhatsApp: {OFFICIAL_WHATSAPP}</span>
                </a>
              </form>
            </div>

            {/* Pricing tiers */}
            <div className="p-3.5 rounded-2xl border border-sky-200/70 dark:border-sky-900/50 bg-sky-50/60 dark:bg-sky-950/20 text-xs text-sky-800 dark:text-sky-300 space-y-1">
              <p className="font-bold">Campaign Reach Estimates</p>
              <p>&bull; <strong>₹100</strong> = 500 targeted impressions across chat &amp; sidebar</p>
              <p>&bull; <strong>₹500</strong> = 2,500 impressions + priority delivery</p>
              <p>&bull; <strong>₹1,000</strong> = 5,500 impressions + featured sponsor badge</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserAdDashboard;
