import React, { useEffect, useState } from 'react';
import { User, Mail, Phone, Save, CheckCircle2, Shield } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

export interface UserProfileProps {
  currentUser?: {
    uid?: string;
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null;
  onSaved?: (phoneNumber: string) => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ currentUser, onSaved }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    let active = true;

    const loadUserData = async () => {
      try {
        const userDocRef = doc(db, 'users', currentUser.uid!);
        const snap = await getDoc(userDocRef);
        if (active && snap.exists()) {
          const data = snap.data();
          if (data?.phoneNumber) {
            setPhoneNumber(data.phoneNumber);
          }
        }
      } catch (err) {
        console.warn('[UserProfile] Failed to load user profile data:', err);
      }
    };

    loadUserData();
    return () => {
      active = false;
    };
  }, [currentUser?.uid]);

  const handleSavePhone = async () => {
    if (!currentUser?.uid) return;
    const trimmed = phoneNumber.trim();

    if (trimmed && !/^[+]?[0-9\s\-()]{7,15}$/.test(trimmed)) {
      setPhoneError('Please enter a valid phone number (e.g., +91 9876543210)');
      return;
    }

    setPhoneSaving(true);
    setPhoneError('');

    try {
      const userDocRef = doc(db, 'users', currentUser.uid);
      await setDoc(userDocRef, { phoneNumber: trimmed }, { merge: true });
      setPhoneSaved(true);
      onSaved?.(trimmed);
      setTimeout(() => setPhoneSaved(false), 3000);
    } catch (err: any) {
      console.error('[UserProfile] Failed to sync phone number to Firestore:', err);
      setPhoneError('Could not save phone number. Please try again.');
    } finally {
      setPhoneSaving(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      {/* Profile Overview Card */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-sm">
        <div className="flex items-center gap-4">
          {currentUser?.photoURL ? (
            <img
              src={currentUser.photoURL}
              alt={currentUser?.displayName || 'User'}
              className="w-14 h-14 rounded-2xl object-cover ring-2 ring-sky-500/20"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-500/20">
              <User className="w-7 h-7 text-white" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
              {currentUser?.displayName || 'Zulora Member'}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{currentUser?.email || 'No email provided'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Phone Sync Section */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/40 flex items-center justify-center text-sky-600 dark:text-sky-400">
            <Phone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Mobile Phone Number</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synced with your Zulora account for WhatsApp updates and account recovery
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value);
              setPhoneError('');
            }}
            placeholder="+91 9876543210"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <button
            type="button"
            onClick={handleSavePhone}
            disabled={phoneSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-bold transition shadow-sm"
          >
            {phoneSaving ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {phoneSaved ? 'Saved!' : 'Save'}
          </button>
        </div>

        {phoneError && (
          <p className="text-xs text-rose-500 font-medium">{phoneError}</p>
        )}

        {phoneSaved && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Phone number synced to Firestore profile!
          </p>
        )}
      </div>
    </div>
  );
};

export default UserProfile;

