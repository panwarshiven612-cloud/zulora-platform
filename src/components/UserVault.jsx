import React, { useEffect, useState } from 'react';
import { Check, Code2, Database, LoaderCircle, Search, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../services/firestoreService';

const EMPTY_VAULT = { preferences: '', customInstructions: '', keyFacts: '' };

export default function UserVault() {
  const { currentUser } = useAuth();
  const [vault, setVault] = useState(EMPTY_VAULT);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      firestoreService.getVault(currentUser?.uid),
      firestoreService.getUserHistory(currentUser?.uid, 12)
    ]).then(([value, activity]) => {
      if (!active) return;
      setVault({ ...EMPTY_VAULT, ...value });
      setHistory(activity);
    }).catch(error => {
      console.warn('Could not load the complete Vault view:', error.message);
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
      setHistory(await firestoreService.getUserHistory(currentUser.uid, 12));
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

        <section className="p-5 sm:p-7 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800 shadow-glass">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent activity</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Searches, prompts, code artifacts, and preference updates kept in your personal history.</p>
            </div>
            <Database className="h-4 w-4 text-indigo-500 shrink-0 mt-1" />
          </div>
          {history.length ? (
            <div className="space-y-2">
              {history.slice(0, 12).map((item, index) => {
                const isCode = item.type === 'code';
                const isSearch = item.type === 'search';
                const title = isCode ? 'Generated code' : isSearch ? 'Web search' : item.type === 'preference' ? 'Preference update' : 'Chat prompt';
                return (
                  <article key={item.clientId || item.id || index} className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {isCode ? <Code2 className="h-3.5 w-3.5 text-violet-500" /> : <Search className="h-3.5 w-3.5 text-sky-500" />}{title}
                      </span>
                      <time className="shrink-0 text-[10px] text-slate-400">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</time>
                    </div>
                    {item.prompt && <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">{item.prompt}</p>}
                    {item.code && <pre className="mt-2 max-h-20 overflow-hidden rounded-lg bg-slate-950/90 p-2 text-[10px] leading-relaxed text-sky-200"><code>{item.code.slice(0, 500)}</code></pre>}
                    {item.preference && <p className="mt-1.5 text-[10px] text-slate-500 line-clamp-2">{item.preference}</p>}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500 dark:border-slate-700">Your searches and generated code will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
