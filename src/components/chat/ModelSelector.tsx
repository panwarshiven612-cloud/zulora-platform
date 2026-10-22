import React from 'react';
import { 
  Sparkles, 
  Zap, 
  Gauge, 
  Check, 
  ChevronDown,
  Cpu,
  Layers,
  Flame,
  Brain
} from 'lucide-react';

export interface ModelOption {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    shortLabel: 'Auto',
    description: 'Smart Route — LPU for simple, Gemini 3.8 for code & video',
    icon: Sparkles,
    color: 'text-sky-500',
    badge: 'Smart'
  },
  {
    id: 'gemini',
    label: 'Gemini Flash',
    shortLabel: 'Gemini',
    description: 'Gemini 3.8 / 2.5 Flash — 40k token high-speed execution',
    icon: Zap,
    color: 'text-amber-500',
    badge: 'Flash'
  },
  {
    id: 'groq',
    label: 'Groq LPU',
    shortLabel: 'Groq LPU',
    description: 'Ultra-fast LPU hardware acceleration',
    icon: Gauge,
    color: 'text-orange-500',
    badge: 'LPU'
  },
  {
    id: 'cerebras',
    label: 'Cerebras Ultra Speed',
    shortLabel: 'Cerebras',
    description: 'Wafer-scale accelerated ultra-low latency',
    icon: Cpu,
    color: 'text-rose-500',
    badge: 'Wafer'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter Multi-Provider',
    shortLabel: 'OpenRouter',
    description: 'Global open-source multi-provider routing',
    icon: Layers,
    color: 'text-indigo-500',
    badge: 'Global'
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    shortLabel: 'Mistral',
    description: 'Mistral Small & Large deep synthesis',
    icon: Flame,
    color: 'text-red-500',
    badge: 'Mistral'
  }
];

export interface ModelSelectorProps {
  modelPreference?: string;
  onModelChange?: (modelId: string) => void;
  isOpen?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
  onClose?: () => void;
}

export default function ModelSelector({
  modelPreference = 'auto',
  onModelChange,
  isOpen = false,
  onToggle,
  onClose
}: ModelSelectorProps) {
  // Normalize model ID to match available engines
  const normalizedId = (() => {
    const raw = String(modelPreference || 'auto').trim();
    const cur = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (cur === 'auto' || cur === 'zulora auto') return 'auto';
    if (cur === 'gemini' || cur === 'gemini flash' || cur === 'flash' || cur.startsWith('gemini ')) return 'gemini';
    if (cur === 'groq' || cur === 'groq lpu' || cur === 'zulora lpu speed' || cur === 'zulora lpu') return 'groq';
    if (cur === 'cerebras' || cur === 'cerebras ultra speed' || cur === 'ultra speed') return 'cerebras';
    if (cur === 'openrouter' || cur === 'openrouter multi provider' || cur === 'openrouter multi-provider') return 'openrouter';
    if (cur === 'mistral' || cur === 'mistral ai') return 'mistral';
    if (cur === 'pro ultra' || cur === 'zulora 3.1 pro ultra' || cur === 'think' || cur === 'pro' || cur === 'gemini 2.5 pro') return 'pro_ultra';
    return cur || 'auto';
  })();

  const activeModel = MODEL_OPTIONS.find(m => m.id === normalizedId) || MODEL_OPTIONS[0];
  const ActiveIcon = activeModel.icon;

  const handleSelect = (modelId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      localStorage.setItem('zulora_chat_model_preference', modelId);
    } catch {
      // storage fallback
    }
    onModelChange?.(modelId);
    onClose?.();
  };

  return (
    <div className="relative" id="model-selector">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="model-selector-menu"
        onClick={onToggle}
        title={`Selected Model: ${activeModel.label}`}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 shadow-xs bg-white/70 dark:bg-slate-800/40 backdrop-blur-md transition-all active:scale-95"
      >
        <ActiveIcon className={`w-3.5 h-3.5 shrink-0 ${activeModel.color}`} />
        <span className="max-w-[4.5rem] sm:max-w-[6.5rem] truncate font-medium">{activeModel.shortLabel}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          id="model-selector-menu"
          role="menu"
          onClick={e => e.stopPropagation()}
          className="absolute bottom-full mb-2.5 left-0 z-50 p-1.5 w-[min(20rem,calc(100vw-2rem))] max-h-[min(65vh,26rem)] overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl animate-scale-in space-y-1"
        >
          <div className="px-2 py-1 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Select AI Engine
            </span>
            <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
              {MODEL_OPTIONS.length} Engines
            </span>
          </div>

          <div className="space-y-1 pt-1">
            {MODEL_OPTIONS.map(model => {
              const Icon = model.icon;
              const isSelected = activeModel.id === model.id;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  key={model.id}
                  onClick={(e) => handleSelect(model.id, e)}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
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
                    <span className="mt-0.5 block text-[10px] leading-3.5 text-slate-500 dark:text-slate-400 line-clamp-1">
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
