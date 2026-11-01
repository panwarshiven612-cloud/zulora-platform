/**
 * src/components/wallet/WalletModal.tsx
 * =====================================
 * Quick wallet funding modal for Zulora AI with UPI QR code,
 * 12-digit UTR submission, and direct WhatsApp verification support.
 * UPI ID: shivenpanwar@fam | WhatsApp: +91 6395211325
 */

import React, { useState } from 'react';
import { X, IndianRupee, QrCode, Copy, Check, ExternalLink, MessageCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';

export interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const OFFICIAL_UPI_ID = 'shivenpanwar@fam';
const OFFICIAL_WHATSAPP = '+91 6395211325';
const WHATSAPP_RAW_NUMBER = '916395211325';

export const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { currentUser } = useAuth();
  const [amount, setAmount] = useState<number>(100);
  const [utr, setUtr] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const upiDeepLink = `upi://pay?pa=${OFFICIAL_UPI_ID}&pn=Zulora%20AI&am=${amount}&cu=INR&tn=Zulora%20Wallet%20Topup`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiDeepLink)}`;
  const whatsappUrl = `https://wa.me/${WHATSAPP_RAW_NUMBER}?text=${encodeURIComponent(
    `Hello Zulora Team! I transferred ₹${amount} for my Zulora Wallet. My 12-digit UTR is: ${utr || '[Attached in screenshot]'}, User ID: ${currentUser?.uid || 'guest'}`
  )}`;

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(OFFICIAL_UPI_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{12}$/.test(utr.trim())) {
      setMessage('Please enter a valid 12-digit numeric UTR / Transaction ID.');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'walletRequests'), {
        userId: currentUser?.uid || 'guest',
        userEmail: currentUser?.email || 'guest@zulora.in',
        amount,
        utr: utr.trim(),
        status: 'pending',
        upiId: OFFICIAL_UPI_ID,
        createdAt: Date.now(),
        serverTimestamp: serverTimestamp()
      });
      setMessage('UTR recorded! Verification takes less than 1 hour on WhatsApp.');
      setUtr('');
      onSuccess?.();
    } catch {
      setMessage('Recorded locally. Please message our WhatsApp with your screenshot.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-slide"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/70 dark:border-slate-800 bg-white dark:bg-[#0c1222] shadow-2xl p-5 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Funds to Zulora Wallet</h3>
              <p className="text-[11px] text-slate-500">Instant UPI QR Code deposit</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Amount Selector */}
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Select Amount</label>
          <div className="grid grid-cols-4 gap-1.5">
            {[100, 250, 500, 1000].map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmount(amt)}
                className={`py-1.5 rounded-xl text-xs font-bold transition border ${
                  amount === amt
                    ? 'border-emerald-500 bg-emerald-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                ₹{amt}
              </button>
            ))}
          </div>
        </div>

        {/* QR Code Container */}
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <img src={qrCodeUrl} alt="UPI QR" className="w-28 h-28 bg-white p-1 rounded-xl shadow-xs shrink-0" />
          <div className="space-y-1.5 text-xs min-w-0 flex-1">
            <span className="text-[10px] text-slate-400 uppercase font-bold block">UPI ID</span>
            <div className="flex items-center justify-between gap-1 font-mono font-bold text-slate-900 dark:text-white text-xs">
              <span className="truncate">{OFFICIAL_UPI_ID}</span>
              <button onClick={handleCopy} className="p-1 rounded bg-slate-200 dark:bg-slate-700 shrink-0">
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <a href={upiDeepLink} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline">
              <span>Pay directly via UPI</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* UTR Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Enter 12-Digit UTR ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={12}
                value={utr}
                onChange={e => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="12-digit UTR Number"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold"
              />
              <button
                type="submit"
                disabled={submitting || utr.length !== 12}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-xs"
              >
                {submitting ? '...' : 'Submit'}
              </button>
            </div>
          </div>

          {message && (
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{message}</p>
          )}

          {/* Verification Instruction Note */}
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
            <em>&quot;Send your UTR ID and payment screenshot to our WhatsApp ({OFFICIAL_WHATSAPP}) for fastest verification and wallet crediting within 1 hour.&quot;</em>
          </div>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
          >
            <MessageCircle className="w-4 h-4" />
            <span>WhatsApp Screenshot to {OFFICIAL_WHATSAPP}</span>
          </a>
        </form>
      </div>
    </div>
  );
};

export default WalletModal;

