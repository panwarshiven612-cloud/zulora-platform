import React, { useEffect, useState } from 'react';
import {
  User, Mail, Shield, Trash2, AlertTriangle, CheckCircle2,
  ChevronLeft, Crown, BarChart3, Lock, Download, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { doc, deleteDoc, collection, getDocs, query, limit, startAfter } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import { deleteObject, ref } from 'firebase/storage';
import { db, storage } from '../services/firebase';
import { getPreferredVoiceId, setPreferredVoiceId, VOICE_OPTIONS } from '../services/voicePreferences';
import { requestLimits, requestVoiceOptions } from '../services/generationApi';

const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const DELETE_BATCH_SIZE = 15;

const deleteCollectionInBatches = async collectionRef => {
  let cursor = null;
  while (true) {
    const pageQuery = cursor
      ? query(collectionRef, limit(DELETE_BATCH_SIZE), startAfter(cursor))
      : query(collectionRef, limit(DELETE_BATCH_SIZE));
    const page = await getDocs(pageQuery);
    if (page.empty) break;
    await Promise.all(page.docs.map(item => deleteDoc(item.ref)));
    if (page.size < DELETE_BATCH_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }
};

/* ─── Delete Confirmation Modal ─── */
const DeleteConfirmModal = ({ onConfirm, onCancel, loading }) => {
  const [typed, setTyped] = useState('');
  const CONFIRM_WORD = 'DELETE';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay animate-scale-in">
      <div className="glass-elevated dark:glass-dark rounded-2xl border border-red-200/60 dark:border-red-800/40 shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-100 dark:bg-red-950/40">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">Delete Account Permanently</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">This action cannot be undone.</p>
          </div>
        </div>

        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40 rounded-xl p-4 text-sm text-red-700 dark:text-red-400 space-y-1">
          <p className="font-semibold">The following will be permanently deleted:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs mt-1">
            <li>Your account profile (name, email)</li>
            <li>All chat sessions and conversation history</li>
            <li>Usage data and limits</li>
            <li>Plan/tier information</li>
          </ul>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">
            Type <span className="font-black text-red-500">DELETE</span> to confirm:
          </label>
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="Type DELETE here"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-red-400 dark:focus:border-red-600 transition-colors"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={typed !== CONFIRM_WORD || loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {loading ? 'Deleting...' : 'Delete Forever'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── MAIN ACCOUNT SETTINGS ─── */
export const AccountSettings = ({ onClose }) => {
  const { currentUser, logout, tier, userProfile } = useAuth();
  const [creditStatus, setCreditStatus] = useState(null);
  const fallbackCreditLimit = tier === 'ultra' ? 8_000_000 : tier === 'pro' ? 200_000 : 60_000;
  const creditLimit = Number(creditStatus?.tokenLimit) || fallbackCreditLimit;
  const creditStart = Number(userProfile?.usage?.tokenWindowStart) || 0;
  const localCreditWindowExpired = !creditStart || Date.now() - creditStart >= 4 * 60 * 60 * 1000 || creditStart > Date.now();
  const creditsUsed = creditStatus
    ? Math.max(0, Number(creditStatus.usedTokens) || 0)
    : localCreditWindowExpired ? 0 : Math.min(creditLimit, Math.max(0, Number(userProfile?.usage?.tokenUsed) || 0));
  const creditsRemaining = Math.max(0, creditLimit - creditsUsed);
  const creditPercent = Math.min(100, Math.floor(creditsUsed / creditLimit * 100));
  const [preferredVoice, setPreferredVoice] = useState(getPreferredVoiceId);
  const [voiceOptions, setVoiceOptions] = useState(VOICE_OPTIONS);
  useEffect(() => {
    let active = true;
    requestVoiceOptions(currentUser).then(voices => {
      if (!active || !voices) return;
      setVoiceOptions(voices);
      const saved = getPreferredVoiceId();
      const legacy = VOICE_OPTIONS.find(option => option.id === saved || option.voiceId === saved);
      const match = voices.find(option => option.id === saved || option.voiceId === saved)
        || (legacy && voices.find(option => option.voiceId === legacy.voiceId));
      if (match) setPreferredVoice(match.id || match.voiceId);
    });
    return () => { active = false; };
  }, [currentUser?.uid]);
  useEffect(() => {
    const legacy = VOICE_OPTIONS.find(option => option.id === preferredVoice || option.voiceId === preferredVoice);
    const voice = voiceOptions.find(option => option.id === preferredVoice || option.voiceId === preferredVoice)
      || (legacy && voiceOptions.find(option => option.voiceId === legacy.voiceId));
    if (voice && (voice.tier === 'free' || tier !== 'free')) {
      if (voice.id && voice.id !== preferredVoice) setPreferredVoice(voice.id);
      return;
    }
    const fallback = voiceOptions.find(option => option.tier === 'free') || VOICE_OPTIONS[0];
    setPreferredVoice(setPreferredVoiceId(fallback.id));
  }, [preferredVoice, tier, voiceOptions]);
  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    let active = true;
    const refreshCredits = async () => {
      const status = await requestLimits(currentUser);
      if (active && status) setCreditStatus(status);
    };
    refreshCredits();
    const timer = window.setInterval(refreshCredits, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [currentUser?.uid]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const tierLabel =
    tier === 'ultra' ? 'Ultra Pro Max' :
    tier === 'pro'   ? 'Pro'           : 'Free';
  const tierColor =
    tier === 'ultra' ? 'from-violet-500 to-purple-600' :
    tier === 'pro'   ? 'from-amber-500 to-orange-500'  : 'from-slate-400 to-slate-500';

  /** Delete app-owned records and the signed-in Firebase Authentication user. */
  const handleDeleteAccount = async () => {
    if (!currentUser?.uid) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const uid = currentUser.uid;

      const lastSignInAt = Date.parse(currentUser.metadata?.lastSignInTime || '');
      if (!lastSignInAt || Date.now() - lastSignInAt > 4 * 60 * 1000) {
        throw new Error('For security, sign out and sign back in before deleting your account, then retry.');
      }

      // Remove all account-owned Firestore subcollections used by the app.
      for (const name of ['sessions', 'chats', 'vault', 'search_vault', 'projects', 'studio_projects', 'code_projects', 'connectors']) {
        await deleteCollectionInBatches(collection(db, 'users', uid, name));
      }

      // Remove generated asset objects and their index records.
      const assetsRef = collection(db, 'users', uid, 'assets');
      while (true) {
        const page = await getDocs(query(assetsRef, limit(DELETE_BATCH_SIZE)));
        if (page.empty) break;
        for (const item of page.docs) {
          try { await deleteObject(ref(storage, `users/${uid}/assets/${item.id}`)); }
          catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
          await deleteDoc(item.ref);
        }
      }

      // Delete the profile before removing the Firebase Authentication user.
      await deleteDoc(doc(db, 'users', uid));
      await deleteUser(currentUser);

      // Clear localStorage
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('zulora_')) localStorage.removeItem(key);
      });

      setDeleteSuccess(true);
      setTimeout(async () => {
        await logout();
        setShowDeleteModal(false);
        onClose?.();
      }, 2000);

    } catch (err) {
      setDeleteError(err.message || 'Account deletion failed. Please try again or contact zulora.help@gmail.com');
      setDeleting(false);
    }
  };

  return (
    <>
      {showDeleteModal && (
        <DeleteConfirmModal
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDeleteModal(false)}
          loading={deleting}
        />
      )}

      <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-2 modal-overlay animate-scale-in sm:p-4">
        <div className="glass-elevated dark:glass-dark my-auto w-full max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/80 dark:border-slate-700/60 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          {/* Header */}
          <div className="sticky top-0 z-20 glass-pearl dark:glass-dark border-b border-slate-200/60 dark:border-slate-700/50 px-4 py-3 flex items-center justify-between rounded-t-2xl sm:px-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl overflow-hidden">
                <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
              </div>
              <h2 className="font-bold text-slate-900 dark:text-white">Account Settings</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close account settings"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {/* Profile Card */}
            <div className="glass-pearl dark:glass-dark rounded-xl border border-white/70 dark:border-slate-700/50 p-4 flex items-center gap-3">
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt="" className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center">
                  <span className="font-bold text-white text-lg">{currentUser?.displayName?.[0] || '?'}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900 dark:text-white truncate">{currentUser?.displayName || 'User'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{currentUser?.email}</p>
                <div className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${tierColor} text-white text-[10px] font-bold`}>
                  <Crown className="w-2.5 h-2.5" /> {tierLabel} Plan
                </div>
              </div>
            </div>

            <section className="rounded-xl border border-sky-200/60 bg-sky-50/50 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">AI credit balance</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{creditLimit.toLocaleString()} credits per rolling 4 hours</p></div>
                <div className="text-right"><p className="text-sm font-bold text-sky-700 dark:text-sky-300">{creditsRemaining.toLocaleString()}</p><p className="text-[10px] text-slate-500 dark:text-slate-400">credits remaining</p></div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all" style={{ width: `${creditPercent}%` }} /></div>
              <p className="mt-1.5 text-right text-[10px] text-slate-500 dark:text-slate-400">{creditsUsed.toLocaleString()} / {creditLimit.toLocaleString()} used</p>
            </section>

            <section className="rounded-xl border border-sky-200/60 bg-sky-50/50 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Voice assistant</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Choose the voice Zulora uses for spoken replies. Hindi and Hinglish speech are supported.</p>
              <label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="account-voice-choice">Preferred voice</label>
              <select
                id="account-voice-choice"
                value={preferredVoice}
                onChange={event => { setPreferredVoiceId(event.target.value); setPreferredVoice(event.target.value); }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {voiceOptions.filter(voice => voice.tier === 'free' || tier !== 'free').map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}{voice.tier === 'pro' ? ' · Pro' : ''}</option>
                ))}
              </select>
              {tier === 'free' && <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Upgrade to Pro for two additional studio voices.</p>}
            </section>

            {/* Data Info Section */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2 px-1">
                Your Data (DPDP Act 2023)
              </h3>
              <div className="space-y-2">
                {[
                  { icon: User, label: 'Name', value: currentUser?.displayName || '—', note: 'From Google OAuth' },
                  { icon: Mail, label: 'Email', value: currentUser?.email || '—', note: 'From Google OAuth' },
                  { icon: Shield, label: 'Data Collected', value: 'Name, Email, Usage Counts, Chat History', note: 'Minimum required' },
                  { icon: Lock, label: 'Data NOT Collected', value: 'Address, DOB, Phone, Financial Info', note: 'Data minimization' },
                ].map(({ icon: Icon, label, value, note }) => (
                  <div key={label} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/60 dark:bg-slate-800/30 border border-slate-100/60 dark:border-slate-700/30">
                    <Icon className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{value}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border border-red-200/60 dark:border-red-800/40 rounded-xl overflow-hidden">
              <div className="bg-red-50/60 dark:bg-red-950/20 px-4 py-2.5 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-bold text-red-600 dark:text-red-400">Danger Zone</span>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white text-sm">Delete My Account</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Permanently removes your account, all chat sessions, usage data, and personal information from Zulora AI's databases.
                    This action is <strong>irreversible</strong> and complies with your Right to Erasure under the{' '}
                    <span className="text-sky-500 font-semibold">DPDP Act 2023 §17</span>.
                  </p>
                </div>

                {deleteSuccess ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 rounded-xl text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Account deleted successfully. Signing you out...
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-100 dark:bg-red-950/30 hover:bg-red-200 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 text-sm font-bold border border-red-200/60 dark:border-red-800/40 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete My Account & All Data
                  </button>
                )}

                {deleteError && (
                  <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-3 py-2 rounded-xl border border-red-200/60 dark:border-red-800/40">
                    ⚠️ {deleteError}
                  </p>
                )}
              </div>
            </div>

            <section aria-labelledby="settings-legal-heading" className="rounded-2xl border border-sky-100/80 bg-sky-50/50 p-4 dark:border-slate-700/70 dark:bg-slate-900/40">
              <h3 id="settings-legal-heading" className="text-sm font-bold text-slate-800 dark:text-slate-100">About & Legal</h3>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
                <a href="https://zulora.in/privacy.html" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline dark:text-sky-400">Privacy Policy</a>
                <a href="https://zulora.in/terms.html" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline dark:text-sky-400">Terms of Service</a>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                24/7 support for Zulora AI & Zulora Drive: <a href="mailto:zulora.help@gmail.com" className="text-sky-600 underline dark:text-sky-400">zulora.help@gmail.com</a> · <a href="https://wa.me/916395211325" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline dark:text-sky-400">WhatsApp +91 6395211325</a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default AccountSettings;
