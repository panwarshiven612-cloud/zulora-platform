import React, { useState } from 'react';
import { 
  X, 
  Check,
  Crown, 
  Sparkles, 
  MessageCircle,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { TIERS } from '../services/firestoreService';

export const PricingModal = ({ isOpen, onClose }) => {
  const { currentUser, tier, refreshProfile } = useAuth();
  const [utr, setUtr] = useState('');
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const [utrMessage, setUtrMessage] = useState('');
  const [utrError, setUtrError] = useState('');

  const submitUtr = async event => {
    event.preventDefault();
    const transactionId = utr.trim();
    setUtrMessage('');
    setUtrError('');
    if (!/^\d{12}$/.test(transactionId)) {
      setUtrError('Enter a valid 12-digit UTR / transaction ID.');
      return;
    }
    if (!currentUser?.getIdToken) {
      setUtrError('Sign in before submitting your payment UTR.');
      return;
    }
    setSubmittingUtr(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/payments/utr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ utr: transactionId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not verify this transaction.');
      await refreshProfile();
      setUtr('');
      setUtrMessage('UTR recorded. Your Pro plan is active.');
    } catch (error) {
      setUtrError(error.message || 'Could not verify this transaction.');
    } finally {
      setSubmittingUtr(false);
    }
  };

  const handleUpgrade = () => setUtrMessage('Contact support to change an active subscription.');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-fade-in">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative max-w-4xl w-full rounded-3xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 z-10 max-h-[92vh] overflow-y-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200/80 dark:border-slate-800">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Transparent & Scalable Plans</span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white">
              Choose the Plan for Your Intelligence Needs
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Built by Zulora AI. Cancel or switch plans dynamically at any time.
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          
          {/* 1. Free Tier */}
          <div className={`p-5 rounded-3xl border flex flex-col justify-between transition-all ${
            tier === TIERS.FREE 
              ? 'border-slate-400 dark:border-slate-600 bg-slate-100/50 dark:bg-slate-900/50' 
              : 'border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/30'
          }`}>
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Free Tier</span>
                {tier === TIERS.FREE && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    Current
                  </span>
                )}
              </div>

              <div className="mb-4">
                <div className="text-3xl font-black text-slate-900 dark:text-white">₹0</div>
                <div className="text-xs text-slate-400">Forever free access</div>
              </div>

              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Flexible daily AI capacity</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Chat, image, and video generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Live usage and reset estimates</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Standard Multi-Model failover</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Cloud history synchronization</span>
                </li>
              </ul>
            </div>

            <button
              disabled={tier === TIERS.FREE}
              onClick={() => handleUpgrade(TIERS.FREE)}
              className="w-full py-2.5 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {tier === TIERS.FREE ? 'Current Plan' : 'Downgrade to Free'}
            </button>
          </div>

          {/* 2. Pro Tier (₹299 / month) */}
          <div className={`p-5 rounded-3xl border relative flex flex-col justify-between transition-all ${
            tier === TIERS.PRO 
              ? 'border-sky-500 bg-sky-50/70 dark:bg-sky-950/50 shadow-azure-glow' 
              : 'border-sky-400/50 dark:border-sky-800/80 bg-white/60 dark:bg-slate-900/60 shadow-lg'
          }`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-500 text-white shadow-sm">
              Most Popular • More Capacity
            </div>

            <div>
              <div className="flex justify-between items-center mb-3 mt-1">
                <span className="text-xs font-bold uppercase tracking-wider text-sky-500">Pro Upgrade</span>
                {tier === TIERS.PRO && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400">
                    Active
                  </span>
                )}
              </div>

              <div className="mb-4">
                <div className="text-3xl font-black text-slate-900 dark:text-white">
                  ₹299 <span className="text-xs font-normal text-slate-400">/ month</span>
                </div>
                <div className="text-xs text-sky-500 font-semibold">More daily generation capacity</div>
              </div>

              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>Expanded daily AI capacity</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>Priority access to premium models</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>Chat, image, and video generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>Priority Groq & Gemini speed</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>High-resolution FLUX & Fal AI rendering</span>
                </li>
              </ul>
            </div>

            {tier === TIERS.PRO ? <button disabled className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-default">Verified Pro Plan</button> : <a href="upi://pay?pa=shivenpanwar@fam&pn=Zulora%20AI&cu=INR" className="flex w-full items-center justify-center py-2.5 rounded-xl text-xs font-bold text-white azure-gradient-btn">Pay via UPI App</a>}
          </div>

          {/* 3. Ultra Pro Max Tier (₹599 / month) */}
          <div className={`p-5 rounded-3xl border flex flex-col justify-between transition-all ${
            tier === TIERS.ULTRA 
              ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/50 shadow-lg' 
              : 'border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/30 hover:border-amber-500/50'
          }`}>
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5" />
                  <span>Ultra Pro Max</span>
                </span>
                {tier === TIERS.ULTRA && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">
                    Active
                  </span>
                )}
              </div>

              <div className="mb-4">
                <div className="text-3xl font-black text-slate-900 dark:text-white">
                  ₹599 <span className="text-xs font-normal text-slate-400">/ month</span>
                </div>
                <div className="text-xs text-amber-500 font-semibold">Maximum daily generation capacity</div>
              </div>

              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Maximum daily AI capacity</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Priority access to premium models</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Chat, image, and video generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Unlimited Deep Web Citations</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Direct VIP Priority support</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => window.open('https://wa.me/916395211325?text=Hi%20Shiven,%20I%20have%20completed%20the%20payment%20to%20shivenpanwar@fam%20for%20Zulora%20AI%20Pro.%20Here%20is%20my%20registered%20email:', '_blank', 'noopener,noreferrer')}
              disabled={tier === TIERS.ULTRA}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                tier === TIERS.ULTRA 
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-default'
                  : 'text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md'
              }`}
            >
              {tier === TIERS.ULTRA ? 'Verified Ultra Plan' : 'Submit Payment Proof via WhatsApp'}
            </button>
          </div>

        </div>

        <div className="p-5 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 space-y-3">
          <p className="text-sm font-bold text-slate-900 dark:text-white">UPI payment and Pro activation</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">Pay from any UPI app to UPI ID: <strong>shivenpanwar@fam</strong></p>
          <a href="upi://pay?pa=shivenpanwar@fam&pn=Zulora%20AI&cu=INR" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
            <ExternalLink className="w-4 h-4" />
            Pay via UPI App
          </a>
          <form onSubmit={submitUtr} className="space-y-2 border-t border-sky-200/70 pt-4 dark:border-sky-800">
            <label htmlFor="utr-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Enter 12-Digit UTR / Transaction ID</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="utr-input" inputMode="numeric" autoComplete="off" maxLength={12} pattern="[0-9]{12}" value={utr} onChange={event => setUtr(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="12-digit UTR" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              <button type="submit" disabled={submittingUtr || tier !== TIERS.FREE} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50">{submittingUtr ? 'Submitting…' : 'Verify & Activate Pro'}</button>
            </div>
            {utrError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{utrError}</p>}
            {utrMessage && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{utrMessage}</p>}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Each UTR can be submitted once. The submitted UTR is recorded with your account.</p>
          </form>
        </div>

        {/* Enterprise & Founder WhatsApp Card */}
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Enterprise & School Campus Licensing?
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Contact Founder <strong>Shiven Panwar</strong> for bulk institutional pricing or custom integration.
              </p>
            </div>
          </div>

          <a
            href="https://wa.me/916395211325?text=Hello%20Shiven,%20I%20am%20interested%20in%20an%20enterprise%20plan%20for%20Zulora%20AI"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <span>WhatsApp: +91 6395211325</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

      </div>
    </div>
  );
};

export default PricingModal;
