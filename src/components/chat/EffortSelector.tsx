/**
 * EffortSelector.tsx — Zulora AI Dynamic Thinking Effort Level Selector
 * =====================================================================
 * Provides a UI control for selecting the AI's reasoning depth and token budget.
 * Low/Medium: lightweight, fast (8k tokens)
 * High:       deep reasoning (20k tokens)
 * Extra:      research-grade (40k tokens)
 * Max:        full-budget synthesis + web scraping (65k tokens)
 */

import React, { useRef, useEffect } from 'react';
import { Zap, Brain, Rocket, Flame, Star, ChevronDown } from 'lucide-react';

export type EffortLevel = 'low' | 'medium' | 'high' | 'extra' | 'max';

export interface EffortOption {
  id: EffortLevel;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  tokenBudget: number;
  badge: string;
}

export const EFFORT_OPTIONS: EffortOption[] = [
  {
    id: 'low',
    label: 'Low Effort',
    shortLabel: 'Low',
    description: 'Quick, concise responses. Fastest latency.',
    icon: Zap,
    color: 'text-slate-400',
    tokenBudget: 4096,
    badge: '4k'
  },
  {
    id: 'medium',
    label: 'Medium Effort',
    shortLabel: 'Medium',
    description: 'Balanced depth for everyday tasks.',
    icon: Zap,
    color: 'text-sky-500',
    tokenBudget: 8192,
    badge: '8k'
  },
  {
    id: 'high',
    label: 'High Effort',
    shortLabel: 'High',
    description: 'Deep reasoning for code & analysis (20k tokens).',
    icon: Brain,
    color: 'text-violet-500',
    tokenBudget: 20000,
    badge: '20k'
  },
  {
    id: 'extra',
    label: 'Extra Effort',
    shortLabel: 'Extra',
    description: 'Research-grade output, full 8-part Zulora format (40k).',
    icon: Flame,
    color: 'text-amber-500',
    tokenBudget: 40000,
    badge: '40k'
  },
  {
    id: 'max',
    label: 'Max Effort',
    shortLabel: 'Max',
    description: 'Full synthesis — code + web scraping + deep reports (65k).',
    icon: Rocket,
    color: 'text-rose-500',
    tokenBudget: 65536,
    badge: '65k'
  }
];

export const DEFAULT_EFFORT: EffortLevel = 'medium';
export const EFFORT_STORAGE_KEY = 'zulora_effort_level';

export function getEffortOption(id: string): EffortOption {
  return EFFORT_OPTIONS.find(o => o.id === id) ?? EFFORT_OPTIONS[1];
}

export function resolveTokenBudget(effortLevel: string, coding = false, research = false): number {
  const effort = getEffortOption(effortLevel);
  let budget = effort.tokenBudget;
  // Boost heavy task types to at least 20k for high/extra/max
  if ((coding || research) && budget < 20000) budget = 20000;
  return budget;
}

export interface EffortSelectorProps {
  effortLevel?: EffortLevel;
  onEffortChange?: (level: EffortLevel) => void;
  isOpen?: boolean;
  onToggle?: (e: React.MouseEvent | React.TouchEvent) => void;
  onClose?: () => void;
}

export default function EffortSelector({
  effortLevel = DEFAULT_EFFORT,
  onEffortChange,
  isOpen = false,
  onToggle,
  onClose
}: EffortSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  const activeOption = getEffortOption(effortLevel);
  const ActiveIcon = activeOption.icon;

  const handleSelect = (id: EffortLevel, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    try { localStorage.setItem(EFFORT_STORAGE_KEY, id); } catch { /* storage unavailable */ }
    onEffortChange?.(id);
    onClose?.();
  };

  return (
    <div className="relative" id="effort-selector" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="effort-selector-menu"
        onClick={onToggle}
        onTouchEnd={(e) => { e.preventDefault(); onToggle?.(e); }}
        title={`Thinking Effort: ${activeOption.label} (${activeOption.badge} tokens)`}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 shadow-xs bg-white/70 dark:bg-slate-800/40 backdrop-blur-md transition-all active:scale-95 touch-manipulation cursor-pointer"
      >
        <ActiveIcon className={`w-3.5 h-3.5 shrink-0 ${activeOption.color}`} />
        <span className="hidden sm:inline max-w-[3.5rem] truncate font-medium">{activeOption.shortLabel}</span>
        <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${activeOption.color} bg-current/10 opacity-90`}>{activeOption.badge}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          id="effort-selector-menu"
          role="menu"
          onClick={e => e.stopPropagation()}
          className="absolute bottom-full mb-2.5 left-0 z-50 p-1.5 w-[min(18rem,calc(100vw-2rem))] max-h-[min(65vh,22rem)] overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl animate-scale-in space-y-1"
        >
          {/* Header */}
          <div className="px-2 py-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Thinking Effort
            </span>
            <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium flex items-center gap-1">
              <Star className="w-2.5 h-2.5" />
              Token Budget
            </span>
          </div>

          {/* Options */}
          {EFFORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = activeOption.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={(e) => handleSelect(option.id, e)}
                onTouchEnd={(e) => { e.preventDefault(); handleSelect(option.id, e); }}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all select-none touch-manipulation cursor-pointer ${
                  isSelected
                    ? 'bg-violet-50/90 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200/60 dark:border-violet-800/60 shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 border border-transparent active:scale-[0.98]'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${option.color}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold leading-tight">{option.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold ${option.color} bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60`}>
                      {option.badge}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-3.5 text-slate-500 dark:text-slate-400 line-clamp-2">
                    {option.description}
                  </span>
                </span>
                {isSelected && (
                  <span className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-600 dark:text-violet-400">✓</span>
                )}
              </button>
            );
          })}

          {/* Footer note */}
          <div className="px-2.5 pt-1 pb-0.5 border-t border-slate-100 dark:border-slate-800/80">
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight">
              Higher effort = deeper responses, more tokens, longer generation time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

