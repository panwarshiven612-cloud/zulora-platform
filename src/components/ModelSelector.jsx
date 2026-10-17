import React from 'react';
import { 
  Sparkles, 
  Zap, 
  Brain, 
  Gauge, 
  Cpu, 
  Layers, 
  Rocket, 
  Activity, 
  Check, 
  ChevronDown 
} from 'lucide-react';

export const MODEL_OPTIONS = [
  {
    id: 'auto',
    label: 'Auto (Smart Route)',
    shortLabel: 'Auto',
    description: 'Intelligent auto-routing based on query complexity & speed.',
    icon: Sparkles,
    color: 'text-sky-500',
    badge: 'Smart'
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    shortLabel: '3.8 Flash',
    description: 'Next-gen multimodal speed with sub-second response times.',
    icon: Zap,
    color: 'text-amber-500',
    badge: 'Ultra Fast'
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    shortLabel: '3.5 Lite',
    description: 'Lightweight, highly optimized engine for everyday queries.',
    icon: Activity,
    color: 'text-emerald-500',
    badge: 'Fast'
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    shortLabel: '3.6 Flash',
    description: 'High throughput with strong reasoning across text and images.',
    icon: Zap,
    color: 'text-sky-400',
    badge: 'Balanced'
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    shortLabel: '3.1 Lite',
    description: 'Rapid real-time token streaming and responsive search.',
    icon: Rocket,
    color: 'text-teal-500',
    badge: 'Stream'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    shortLabel: '2.5 Pro',
    description: 'Advanced reasoning, full-stack code synthesis & complex problem solving.',
    icon: Brain,
    color: 'text-purple-500',
    badge: 'Reasoning'
  },
  {
    id: 'groq',
    label: 'Groq LPU (Llama 3.3 70B)',
    shortLabel: 'Groq 70B',
    description: 'Near-instant LPUs running Meta Llama 3.3 70B Versatile.',
    icon: Gauge,
    color: 'text-orange-500',
    badge: 'LPU Speed'
  },
  {
    id: 'cerebras',
    label: 'Cerebras (Llama 3.1 70B)',
    shortLabel: 'Cerebras',
    description: 'Wafer-scale accelerated inference for maximum token velocity.',
    icon: Cpu,
    color: 'text-rose-500',
    badge: 'Fastest'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (Llama 3.3 70B)',
    shortLabel: 'OpenRouter',
    description: 'Global multi-region redundant routing with Meta Llama 3.3.',
    icon: Layers,
    color: 'text-indigo-500',
    badge: 'Resilient'
  }
];

export default function ModelSelector({ modelPreference, onModelChange, isOpen, onToggle, onClose }) {
  // Normalize preference to match options or aliases
  const normalizedId = (() => {
    if (modelPreference === 'think' || modelPreference === 'pro') return 'gemini-2.5-pro';
    if (modelPreference === 'flash') return 'gemini-3.8-flash';
    return modelPreference;
  })();

  const selectedModel = MODEL_OPTIONS.find(m => m.id === normalizedId || m.id === modelPreference) || MODEL_OPTIONS[0];
  const SelectedIcon = selectedModel.icon;

  return (
    <div className="relative" id="model-selector">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="model-selector-menu"
        onClick={onToggle}
        title={`Selected Model: ${selectedModel.label}`}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 shadow-xs bg-white/70 dark:bg-slate-800/40 backdrop-blur-md transition-all active:scale-95"
      >
        <SelectedIcon className={`w-3.5 h-3.5 shrink-0 ${selectedModel.color}`} />
        <span className="max-w-[4rem] sm:max-w-[5.5rem] truncate font-medium">{selectedModel.shortLabel}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          id="model-selector-menu"
          role="menu"
          onClick={event => event.stopPropagation()}
          className="absolute bottom-full mb-2.5 left-0 z-50 p-1.5 w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl animate-scale-in"
        >
          <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800/80 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Select AI Engine
            </span>
          </div>

          <div className="space-y-0.5">
            {MODEL_OPTIONS.map(model => {
              const Icon = model.icon;
              const isSelected = selectedModel.id === model.id;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  key={model.id}
                  onClick={() => {
                    onModelChange(model.id);
                    onClose?.();
                  }}
                  className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
                    isSelected
                      ? 'bg-sky-50/90 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/60 shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${model.color}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold leading-tight">{model.label}</span>
                      {model.badge && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-md font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">
                          {model.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-3.5 text-slate-500 dark:text-slate-400 line-clamp-2">
                      {model.description}
                    </span>
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
