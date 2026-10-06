import React, { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

export default function TaskToastHost() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let timer;
    const receive = event => {
      window.clearTimeout(timer);
      setToast({ id: Date.now(), title: String(event.detail?.title || 'Task update'), message: String(event.detail?.message || '') });
      timer = window.setTimeout(() => setToast(null), 6_000);
    };
    window.addEventListener('zulora-toast', receive);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('zulora-toast', receive);
    };
  }, []);

  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[1200] flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-emerald-200/70 bg-white/95 p-4 shadow-2xl backdrop-blur-xl dark:border-emerald-900/60 dark:bg-slate-900/95">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white">{toast.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{toast.message}</p>
      </div>
      <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"><X className="h-4 w-4" /></button>
    </div>
  );
}
