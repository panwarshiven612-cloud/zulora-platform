import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Check, 
  AlertTriangle, 
  Loader2, 
  ExternalLink, 
  Link2, 
  ChevronDown, 
  ChevronRight,
  Database,
  Globe,
  Clock,
  Cpu,
  Zap,
  Layers,
  ArrowUpRight
} from 'lucide-react';

export interface ThinkingStep {
  label: string;
  status: 'running' | 'done' | 'error' | 'pending';
  detail?: string;
  timestamp?: number;
  timeOffset?: string;
  subtasks?: string[];
}

export interface GroundingSource {
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  type?: 'web' | 'vault' | 'drive' | 'doc';
}

export interface ThoughtProcessProps {
  steps?: ThinkingStep[];
  isStreaming?: boolean;
  sources?: GroundingSource[];
  queryTime?: string | number;
  model?: string;
  provider?: string;
  className?: string;
  defaultOpen?: boolean;
}

export const ThoughtProcess: React.FC<ThoughtProcessProps> = ({
  steps = [],
  isStreaming = false,
  sources = [],
  queryTime,
  model,
  provider,
  className = '',
  defaultOpen
}) => {
  const isActivelyThinking = isStreaming || steps.some(s => s.status === 'running');
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof defaultOpen === 'boolean') return defaultOpen;
    return isActivelyThinking;
  });
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());

  // Track live thinking timer while streaming
  useEffect(() => {
    if (!isActivelyThinking) return;
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setLiveElapsed(Math.max(0.1, Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1))));
    }, 100);
    return () => clearInterval(interval);
  }, [isActivelyThinking]);

  // Keep open automatically while actively thinking, unless user explicitly toggles
  useEffect(() => {
    if (isActivelyThinking) {
      setIsOpen(true);
    }
  }, [isActivelyThinking]);

  // Filter out invalid/empty steps
  const validSteps = steps.filter(s => s && typeof s.label === 'string' && s.label.trim().length > 0);
  const doneCount = validSteps.filter(s => s.status === 'done').length;
  const totalCount = validSteps.length;

  if (validSteps.length === 0 && sources.length === 0 && !isActivelyThinking) {
    return null;
  }

  const displayTime = isActivelyThinking 
    ? `${liveElapsed}s` 
    : (queryTime ? `${queryTime}s` : (liveElapsed > 0 ? `${liveElapsed}s` : ''));

  return (
    <div className={`zulora-thought-container space-y-2 mb-3.5 select-text ${className}`}>
      {/* 1. Claude-Style Collapsible Header Pill / Card */}
      <div className="overflow-hidden rounded-xl border border-violet-200/80 bg-violet-50/70 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100 shadow-xs transition-all duration-200">
        <button
          type="button"
          onClick={() => setIsOpen(prev => !prev)}
          aria-expanded={isOpen}
          className="w-full cursor-pointer px-3.5 py-2 text-xs font-semibold flex items-center justify-between hover:bg-violet-100/60 dark:hover:bg-violet-900/30 transition-colors select-none text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {isActivelyThinking ? (
              <span className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 font-bold shrink-0">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-600 dark:bg-violet-400"></span>
                </span>
                <span className="tracking-wide">Thinking...</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                <span>
                  {displayTime ? `Thought for ${displayTime}` : 'Thought Process'}
                </span>
              </span>
            )}

            {/* Step Counter & Meta Tag */}
            {totalCount > 0 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal truncate">
                ({doneCount}/{totalCount} steps complete
                {displayTime && isActivelyThinking ? ` • ${displayTime}` : ''})
              </span>
            )}

            {/* Active Model/Effort Badge if provided */}
            {model && (
              <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                <Cpu className="w-2.5 h-2.5" />
                <span className="truncate max-w-[100px]">{model}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <span className="text-[10px] text-violet-600/80 dark:text-violet-400/80 font-normal">
              {isOpen ? 'Hide' : 'Show'}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-violet-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {/* 2. Collapsible Action Drawer (Timeline & Step Details) */}
        {isOpen && (
          <div className="border-t border-violet-200/60 dark:border-violet-900/50 bg-white/50 dark:bg-slate-900/40 px-3.5 py-3 space-y-2.5 animate-fadeIn">
            <div className="relative pl-3 space-y-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-violet-200 dark:before:bg-violet-900/60">
              {validSteps.map((step, idx) => {
                const isDone = step.status === 'done';
                const isError = step.status === 'error';
                const isRunning = step.status === 'running';

                // Calculate relative timestamp offset
                const offset = step.timeOffset || (step.timestamp ? `+${((step.timestamp - (steps[0]?.timestamp || step.timestamp)) / 1000).toFixed(1)}s` : '');

                return (
                  <div key={`${step.label}-${idx}`} className="relative flex items-start gap-2.5 text-xs">
                    {/* Status Dot / Icon */}
                    <span className="mt-0.5 shrink-0 z-10 bg-white dark:bg-slate-900 rounded-full">
                      {isDone && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                      {isError && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}
                      {isRunning && <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />}
                      {!isDone && !isError && !isRunning && (
                        <span className="block w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 m-0.5" />
                      )}
                    </span>

                    {/* Step Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 leading-snug">
                        <span className={`font-semibold ${
                          isDone 
                            ? 'text-slate-800 dark:text-slate-200' 
                            : isRunning 
                            ? 'text-violet-700 dark:text-violet-300 font-bold' 
                            : 'text-slate-600 dark:text-slate-400'
                        }`}>
                          {step.label}
                        </span>

                        {isDone && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                            ✓ Complete
                          </span>
                        )}
                        {isError && (
                          <span className="text-rose-600 dark:text-rose-400 font-semibold text-[10px]">
                            ✗ Failed
                          </span>
                        )}
                        {isRunning && (
                          <span className="text-violet-600 dark:text-violet-400 font-medium text-[10px] animate-pulse">
                            ● In progress
                          </span>
                        )}

                        {offset && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto tabular-nums">
                            {offset}
                          </span>
                        )}
                      </div>

                      {/* Sub-detail if provided */}
                      {step.detail && (
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {step.detail}
                        </div>
                      )}

                      {/* Subtasks array if provided */}
                      {Array.isArray(step.subtasks) && step.subtasks.length > 0 && (
                        <ul className="mt-1 space-y-0.5 pl-2 border-l border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                          {step.subtasks.map((st, sidx) => (
                            <li key={sidx} className="flex items-center gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                              <span className="truncate">{st}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Provider and Token Scaling Footer Details */}
            {(provider || model) && (
              <div className="mt-2 pt-2 border-t border-violet-100 dark:border-violet-900/40 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-500" />
                  <span>Engine: {provider || 'Zulora AI'} ({model || 'auto'})</span>
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-violet-500" />
                  <span>Effort Tier: High (65k Tokens)</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Claude-Style Grounding Sources & Citations Drawer */}
      {Array.isArray(sources) && sources.length > 0 && (
        <div className="rounded-xl border border-sky-200/80 dark:border-sky-800/50 bg-sky-50/60 dark:bg-sky-950/20 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setSourcesOpen(v => !v)}
            className="w-full px-3.5 py-2 text-[11px] font-bold text-sky-700 dark:text-sky-400 flex items-center justify-between hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-colors select-none"
          >
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-500" />
              <span>Grounding Sources & Citations ({sources.length})</span>
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-normal text-sky-600/80 dark:text-sky-400/80">
                {sourcesOpen ? 'Collapse' : 'View'}
              </span>
              <ChevronRight className={`w-3.5 h-3.5 text-sky-500 transition-transform duration-200 ${sourcesOpen ? 'rotate-90' : ''}`} />
            </div>
          </button>

          {sourcesOpen && (
            <div className="px-3.5 pb-2.5 pt-1.5 space-y-2 border-t border-sky-200/60 dark:border-sky-800/40">
              {sources.map((src, i) => {
                const url = typeof src === 'string' ? src : src.url;
                const title = typeof src === 'string' ? src : (src.title || src.url || `Source #${i + 1}`);
                let domain = typeof src === 'object' && src.domain ? src.domain : '';
                if (!domain && url) {
                  try {
                    domain = new URL(url).hostname.replace(/^www\./, '');
                  } catch {}
                }
                const isVault = typeof src === 'object' && src.type === 'vault';

                return (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="shrink-0 mt-0.5">
                      {isVault ? (
                        <Database className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5 text-sky-500" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 max-w-full"
                        >
                          <span className="truncate">{title}</span>
                          <ArrowUpRight className="w-3 h-3 shrink-0 opacity-70" />
                        </a>
                      ) : (
                        <span className="font-medium text-slate-700 dark:text-slate-200 truncate block">
                          {title}
                        </span>
                      )}
                      {domain && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 block">
                          {domain}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ThoughtProcess;

