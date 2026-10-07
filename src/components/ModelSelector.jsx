import React from 'react';
import { Brain, Check, ChevronDown, Gauge, Sparkles, Zap } from 'lucide-react';
import { MODEL_TIERS } from '../services/apiRouter';

const MODEL_OPTIONS = [
  {
    ...MODEL_TIERS.auto,
    label: 'Auto (Smart Route)',
    description: 'Zulora selects a fast model or stronger reasoning route for the request.',
    icon: Sparkles,
  },
  {
    ...MODEL_TIERS.flash,
    label: 'Zulora Flash 3.5',
    description: 'Everyday chat and search · Gemini 3.5 Flash with Pro and Groq backup routes.',
    icon: Zap,
  },
  {
    ...MODEL_TIERS.think,
    label: 'Zulora 3.1 Pro Ultra',
    description: 'Advanced reasoning, coding, and deep tasks · Gemini Pro fallbacks.',
    icon: Brain,
  },
  {
    ...MODEL_TIERS.groq,
    label: 'Zulora Turbo Speed',
    description: 'Fast responses routed directly through Groq LPU.',
    icon: Gauge,
  },
];

export default function ModelSelector({ modelPreference, onModelChange, isOpen, onToggle, onClose }) {
  const selectedModel = MODEL_OPTIONS.find(model => model.id === modelPreference) || MODEL_OPTIONS[0];
  const SelectedIcon = selectedModel.icon;

  return (
    <div className="relative" id="model-selector">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="model-selector-menu"
        onClick={onToggle}
        title={selectedModel.label}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 transition-all"
      >
        <SelectedIcon className={`w-3.5 h-3.5 shrink-0 ${selectedModel.color}`} />
        <span className="max-w-[4.5rem] truncate sm:max-w-none">{selectedModel.shortLabel}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>
      {isOpen && (
        <div
          id="model-selector-menu"
          role="menu"
          onClick={event => event.stopPropagation()}
          className="absolute bottom-full mb-2 left-0 glass-elevated dark:glass-dark rounded-xl border border-white/80 dark:border-slate-700/60 shadow-2xl z-50 p-1.5 w-[min(21rem,calc(100vw-1.5rem))] max-h-[min(65vh,28rem)] overflow-y-auto animate-scale-in"
        >
          {MODEL_OPTIONS.map(model => {
            const Icon = model.icon;
            const selected = modelPreference === model.id;
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                key={model.id}
                onClick={() => {
                  onModelChange(model.id);
                  onClose();
                }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  selected
                    ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${model.color}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{model.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-slate-500 dark:text-slate-400">{model.description}</span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
