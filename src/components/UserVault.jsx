import React, { useEffect, useState } from 'react';
import { Check, Database, LoaderCircle, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../services/firestoreService';

const EMPTY_VAULT = { preferences: '', customInstructions: '', keyFacts: '' };

export default function UserVault() {
  const { currentUser } = useAuth();
  const [vault, setVault] = useState(EMPTY_VAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    firestoreService.getVault(currentUser?.uid).then(value => {
      if (active) setVault({ ...EMPTY_VAULT, ...value });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser?.uid]);

  const update = key => event => {
    setSaveState('');
    setVault(previous => ({ ...previous, [key]: event.target.value }));
  };

  const save = async event => {
    event.preventDefault();
    if (!currentUser?.uid || saving) return;
    setSaving(true);
    setSaveState('');
    try {
      const result = await firestoreService.saveVault(currentUser.uid, vault);
      setVault({ ...EMPTY_VAULT, ...result.vault });
      setSaveState(result.synced ? 'Synced to your private Firestore Vault and this browser.' : 'Saved on this browser. Firestore will sync when available.');
    } catch (error) {
      setSaveState(error.message || 'Could not save your Vault.');
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: 'preferences', label: 'Preferences', help: 'How should Zulora respond? Include tone, formatting, learning style, or recurring preferences.', placeholder: 'I prefer concise answers with a short summary first. Explain unfamiliar terms in plain language.' },
    { key: 'customInstructions', label: 'Custom instructions', help: 'Ongoing guidance you want applied across chats.', placeholder: 'When helping with my projects, ask before changing the existing architecture.' },
    { key: 'keyFacts', label: 'Key facts to remember', help: 'Personal or project context that is useful in future conversations.', placeholder: 'I am building a small online shop using React. My target audience is independent makers.' }
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="p-6 sm:p-8 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800 shadow-glass">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 text-xs font-bold mb-3">
            <Database className="w-3.5 h-3.5" /> Personal memory
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">Zulora AI Vault</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Save preferences, instructions, and key facts for future chats. Your Vault is private to your account and is included as context when Zulora answers.
          </p>
        </header>

        <form onSubmit={save} className="p-5 sm:p-7 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800 shadow-glass space-y-6">
          {fields.map(field => (
            <div key={field.key}>
              <label htmlFor={`vault-${field.key}`} className="block text-sm font-bold text-slate-800 dark:text-slate-200">{field.label}</label>
              <p className="mt-1 mb-2 text-xs text-slate-500 dark:text-slate-400">{field.help}</p>
              <textarea
                id={`vault-${field.key}`}
                value={vault[field.key]}
                onChange={update(field.key)}
                placeholder={field.placeholder}
                rows={4}
                maxLength={4000}
                disabled={loading}
                className="w-full p-3.5 rounded-2xl bg-white/80 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 resize-y focus:outline-none focus:ring-2 focus:ring-sky-500/25 focus:border-sky-500 disabled:opacity-60"
              />
              <div className="mt-1 text-right text-[10px] text-slate-400">{vault[field.key].length}/4000</div>
            </div>
          ))}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <p aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">{loading ? 'Loading your Vault…' : saveState}</p>
            <button
              type="submit"
              disabled={loading || saving}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white azure-gradient-btn shadow-md disabled:opacity-50"
            >
              {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : saveState.startsWith('Synced') ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
