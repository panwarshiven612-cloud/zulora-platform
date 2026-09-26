import React, { useState } from 'react';
import {
  User, Mail, Shield, Trash2, AlertTriangle, CheckCircle2,
  ChevronLeft, Crown, BarChart3, Lock, Download, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../services/firestoreService';
import { doc, deleteDoc, collection, getDocs, query, where, limit, startAfter } from 'firebase/firestore';
import { db } from '../services/firebase';

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

  /**
   * DPDP Act §17 — Right to Erasure
   * Permanently delete ALL user data from Firestore then sign out.
   */
  const handleDeleteAccount = async () => {
    if (!currentUser?.uid) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const uid = currentUser.uid;

      // Delete all chat sessions
      try {
        const sessionsRef = collection(db, 'users', uid, 'sessions');
        await deleteCollectionInBatches(sessionsRef);
      } catch (e) { console.warn('Session deletion error:', e); }

      // Delete all generated assets
      try {
        const assetsRef = collection(db, 'users', uid, 'assets');
        await deleteCollectionInBatches(assetsRef);
      } catch (e) { console.warn('Assets deletion error:', e); }

      // Delete user profile document
      try {
        await deleteDoc(doc(db, 'users', uid));
      } catch (e) { console.warn('Profile deletion error:', e); }

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

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay animate-scale-in">
        <div className="glass-elevated dark:glass-dark rounded-2xl border border-white/80 dark:border-slate-700/60 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 glass-pearl dark:glass-dark border-b border-slate-200/60 dark:border-slate-700/50 px-5 py-3 flex items-center justify-between rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl overflow-hidden">
                <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
              </div>
              <h2 className="font-bold text-slate-900 dark:text-white">Account Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
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

            {/* Contact for data requests */}
            <p className="text-[10px] text-center text-slate-400 dark:text-slate-600">
              For data access/correction requests, email{' '}
              <a href="mailto:zulora.help@gmail.com" className="text-sky-500 underline">zulora.help@gmail.com</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default AccountSettings;
