import React, { useEffect, useState } from 'react';
import { Brain, Check, Cloud, LoaderCircle, Save, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../services/firestoreService';

const EMPTY_BRAIN = { talkStyle: '', customInstructions: '', domainContext: '' };

const fields = [
  {
    name: 'talkStyle',
    label: 'How should Zulora AI talk to you?',
    hint: 'For example: friendly and concise, explain new terms, and use a little humor.',
    placeholder: 'Describe the tone, level of detail, language, or format you prefer.',
    rows: 3
  },
  {
    name: 'customInstructions',
    label: 'Your custom instructions & preferences',
    hint: 'Add preferences that should carry across chats, such as your role, goals, or how you like answers structured.',
    placeholder: 'What would you like Zulora AI to remember about how it can help you?',
    rows: 5
  },
  {
    name: 'domainContext',
    label: 'Specific domain context / rules',
    hint: 'Add project context, terminology, constraints, or rules for a subject you work with often.',
    placeholder: 'Share background, important definitions, requirements, or project rules.',
    rows: 5
  }
];

export default function AiBrain() {
  const { currentUser } = useAuth();
  const [brain, setBrain] = useState(EMPTY_BRAIN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setStatus('');
    setError('');
    firestoreService.getAiBrain(currentUser?.uid).then(value => {
      if (active) setBrain({ ...EMPTY_BRAIN, ...(value || {}) });
    }).catch(loadError => {
      if (active) setError(loadError.message || 'Your saved preferences could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [currentUser?.uid]);

  const handleChange = event => {
    const { name, value } = event.target;
    setBrain(previous => ({ ...previous, [name]: value }));
    setStatus('');
    setError('');
  };

  const handleSave = async event => {
    event.preventDefault();
    if (!currentUser?.uid || saving) return;
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const result = await firestoreService.saveAiBrain(currentUser.uid, brain);
      setBrain({ ...EMPTY_BRAIN, ...result.brain });
      setStatus(result.synced
        ? 'Your Brain is saved and will guide future chats.'
        : 'Saved on this device. Reconnect and save again to sync with Firestore.');
    } catch (saveError) {
      setError(saveError.message || 'Your Brain could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="overflow-hidden rounded-3xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50 to-indigo-50 p-6 shadow-glass dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/40 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-sky-500/10 p-3 text-sky-600 dark:text-sky-300">
              <Brain className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:text-sky-300">
                <Sparkles className="h-3.5 w-3.5" /> Your personal AI profile
              </p>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">AI Training & Personal Brain</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Teach Zulora how you like to work. These preferences are included with your future chats and stay tied to your account.
              </p>
            </div>
          </div>
        </header>

        <form onSubmit={handleSave} className="rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/70 sm:p-7">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading your saved Brain…
            </div>
          ) : (
            <div className="space-y-6">
              {fields.map(field => (
                <div key={field.name}>
                  <label htmlFor={field.name} className="mb-1.5 block text-sm font-bold text-slate-800 dark:text-slate-200">
                    {field.label}
                  </label>
                  <p className="mb-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{field.hint}</p>
                  <textarea
                    id={field.name}
                    name={field.name}
                    value={brain[field.name] || ''}
                    onChange={handleChange}
                    rows={field.rows}
                    maxLength={4000}
                    placeholder={field.placeholder}
                    className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-600"
                  />
                  <div className="mt-1 text-right text-[10px] text-slate-400">{(brain[field.name] || '').length}/4000</div>
                </div>
              ))}

              <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-5 text-xs" aria-live="polite">
                  {status && <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{status}</p>}
                  {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
                </div>
                <button
                  type="submit"
                  disabled={saving || loading || !currentUser?.uid}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving your Brain…' : 'Save preferences'}
                </button>
              </div>
            </div>
          )}
        </form>

        <p className="flex items-start gap-2 px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          Your profile syncs to your private Firestore account and is cached in this browser so it is ready across chats.
        </p>
      </div>
    </section>
  );
}
