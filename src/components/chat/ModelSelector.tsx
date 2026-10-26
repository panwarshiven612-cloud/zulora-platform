import React, { useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Zap, 
  Gauge, 
  Check, 
  ChevronDown,
  Layers
} from 'lucide-react';

export interface ModelOption {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge: string;
  isAuto?: boolean;
}

export const AUTO_OPTION: ModelOption = {
  id: 'auto',
  label: 'Auto (Smart Adaptive)',
  shortLabel: 'Auto',
  description: 'Smart Route — Groq/Lite for instant text, Gemini 3.8 Flash for code & video',
  icon: Sparkles,
  color: 'text-sky-500',
  badge: 'Adaptive',
  isAuto: true
};

export const MANUAL_OPTIONS: ModelOption[] = [
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    shortLabel: 'Gemini 3.8',
    description: 'High token budget (40k) for complex coding, web building & video',
    icon: Zap,
    color: 'text-amber-500',
    badge: '40k Tokens'
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    shortLabel: 'Flash Lite',
    description: 'Fast, lightweight reasoning for everyday standard tasks',
    icon: Sparkles,
    color: 'text-emerald-500',
    badge: 'Fast Lite'
  },
  {
    id: 'groq',
    label: 'Groq LPU (Ultra Speed)',
    shortLabel: 'Groq LPU',
    description: 'Sub-500ms hardware LPU acceleration',
    icon: Gauge,
    color: 'text-orange-500',
    badge: 'Ultra Fast'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter Multi-Provider',
    shortLabel: 'OpenRouter',
    description: 'Decentralized open-source models with resilient fallback',
    icon: Layers,
    color: 'text-indigo-500',
    badge: 'Multi-LLM'
  }
];

export const MODEL_OPTIONS: ModelOption[] = [
  AUTO_OPTION,
  ...MANUAL_OPTIONS
];

export interface ModelSelectorProps {
  modelPreference?: string;
  onModelChange?: (modelId: string) => void;
  isOpen?: boolean;
  onToggle?: (e: React.MouseEvent | React.TouchEvent) => void;
  onClose?: () => void;
}

export default function ModelSelector({
  modelPreference = 'auto',
  onModelChange,
  isOpen = false,
  onToggle,
  onClose
}: ModelSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-close when clicking or tapping outside
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isOpen, onClose]);

  // Normalize model ID to match available engines
  const normalizedId = (() => {
    const raw = String(modelPreference || 'auto').trim();
    const cur = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (cur === 'auto' || cur === 'zulora auto') return 'auto';
    if (cur === 'gemini 3.8 flash' || cur === 'gemini 3.8' || cur === 'gemini' || cur === 'gemini-3.8-flash') return 'gemini-3.8-flash';
    if (cur === 'gemini 3.5 flash lite' || cur === 'gemini 3.5' || cur === 'flash lite' || cur === 'gemini lite' || cur === 'gemini-3.5-flash-lite' || cur === 'lite') return 'gemini-3.5-flash-lite';
    if (cur === 'groq' || cur === 'groq lpu' || cur === 'zulora lpu speed' || cur === 'zulora lpu') return 'groq';
    if (cur === 'openrouter' || cur === 'openrouter multi provider' || cur === 'openrouter multi-provider') return 'openrouter';
    return cur || 'auto';
  })();

  const activeModel = MODEL_OPTIONS.find(m => m.id === normalizedId) || AUTO_OPTION;
  const ActiveIcon = activeModel.icon;

  const handleSelect = (modelId: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      localStorage.setItem('zulora_chat_model_preference', modelId);
    } catch {
      // storage fallback
    }
    onModelChange?.(modelId);
    onClose?.();
  };

  const renderModelButton = (model: ModelOption) => {
    const Icon = model.icon;
    const isSelected = activeModel.id === model.id;
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isSelected}
        key={model.id}
        onClick={(e) => handleSelect(model.id, e)}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleSelect(model.id, e);
        }}
        className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all select-none touch-manipulation cursor-pointer ${
          isSelected
            ? 'bg-sky-50/90 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/60 shadow-xs'
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 border border-transparent active:scale-[0.98]'
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
  };

  return (
    <div className="relative" id="model-selector" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="model-selector-menu"
        onClick={onToggle}
        onTouchEnd={(e) => {
          e.preventDefault();
          onToggle?.(e);
        }}
        title={`Selected Model: ${activeModel.label}`}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 shadow-xs bg-white/70 dark:bg-slate-800/40 backdrop-blur-md transition-all active:scale-95 touch-manipulation cursor-pointer"
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
          {/* Section 1: Auto Mode */}
          <div className="px-2 py-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Smart Adaptive
            </span>
            <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
              Auto Fallback
            </span>
          </div>
          {renderModelButton(AUTO_OPTION)}

          {/* Section 2: Manual Selection */}
          <div className="pt-2 px-2 pb-1 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Manual Direct Engine Control
            </span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              Dedicated Route
            </span>
          </div>
          <div className="space-y-1">
            {MANUAL_OPTIONS.map(model => renderModelButton(model))}
          </div>
        </div>
      )}
    </div>
  );
}
