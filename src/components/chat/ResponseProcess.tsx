import React, { useState } from 'react';
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
  Clock
} from 'lucide-react';

export interface ThinkingStep {
  label: string;
  status: 'running' | 'done' | 'error' | 'pending';
  detail?: string;
  timestamp?: number;
}

export interface GroundingSource {
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  type?: 'web' | 'vault' | 'drive' | 'doc';
}

export interface ResponseProcessProps {
  steps?: ThinkingStep[];
  isStreaming?: boolean;
  sources?: GroundingSource[];
  queryTime?: string | number;
  model?: string;
  provider?: string;
  className?: string;
}

export const ResponseProcess: React.FC<ResponseProcessProps> = ({
  steps = [],
  isStreaming = false,
  sources = [],
  queryTime,
  model,
  provider,
  className = ''
}) => {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const doneCount = steps.filter(s => s.status === 'done').length;
  const totalCount = steps.length;
  const isActivelyThinking = isStreaming || steps.some(s => s.status === 'running');

  // Filter out any empty steps without a label to ensure no empty tick marks
  const validSteps = steps.filter(s => s && typeof s.label === 'string' && s.label.trim().length > 0);

  if (validSteps.length === 0 && sources.length === 0 && !isActivelyThinking) {
    return null;
  }

  return (
    <div className={`space-y-2 mb-3 ${className}`}>
      {/* 1. Claude-Style Thinking & Step Process Box */}
      {(validSteps.length > 0 || isActivelyThinking) && (
        <details 
          className="zulora-thinking-box overflow-hidden rounded-xl border border-violet-200/80 bg-violet-50/70 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100 shadow-xs transition-all"
          open={Boolean(isActivelyThinking || doneCount < totalCount)}
        >
          <summary className="cursor-pointer list-none px-3.5 py-2 text-xs font-semibold flex items-center justify-between hover:bg-violet-100/50 dark:hover:bg-violet-900/20 select-none">
            <span className="flex items-center gap-2">
              {isActivelyThinking ? (
                <span className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 font-bold">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                  </span>
                  <span>Thinking...</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  <span>Thought Process</span>
                </span>
              )}
              {totalCount > 0 && (
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                  ({doneCount}/{totalCount} steps complete{queryTime ? ` • ${queryTime}s` : ''})
                </span>
              )}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-violet-500 transition-transform duration-200 group-open:rotate-180" />
          </summary>

          <div className="step-log space-y-2 border-t border-violet-200/60 px-3.5 py-2.5 dark:border-violet-900/50 bg-white/40 dark:bg-slate-900/30">
            {validSteps.map((step, idx) => {
              const isDone = step.status === 'done';
              const isError = step.status === 'error';
              const isRunning = step.status === 'running';

              return (
                <div key={`${step.label}-${idx}`} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span className="mt-0.5 shrink-0">
                    {isDone && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    {isError && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}
                    {isRunning && <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />}
                    {!isDone && !isError && !isRunning && <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-1.5 mx-1" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className={`font-semibold ${isDone ? 'text-slate-800 dark:text-slate-200' : isRunning ? 'text-violet-700 dark:text-violet-300 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                      {step.label}
                    </span>
                    {isDone && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]">✓ Done</span>}
                    {isError && <span className="ml-1.5 text-rose-600 dark:text-rose-400 font-bold text-[10px]">✗ Failed</span>}
                    {isRunning && <span className="ml-1.5 text-violet-500 dark:text-violet-400 font-medium text-[10px] animate-pulse">● Working...</span>}
                    {step.detail && (
                      <span className="ml-1.5 text-slate-400 dark:text-slate-500 text-[10px]">({step.detail})</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* 2. Claude-Style Grounding Sources Attribution Drawer */}
      {Array.isArray(sources) && sources.length > 0 && (
        <div className="rounded-xl border border-sky-200/80 dark:border-sky-800/50 bg-sky-50/60 dark:bg-sky-950/20 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setSourcesOpen(v => !v)}
            className="w-full px-3 py-1.5 text-[11px] font-bold text-sky-700 dark:text-sky-400 flex items-center justify-between hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-500" />
              <span>Grounding Sources & Citations ({sources.length})</span>
            </span>
            <ChevronRight className={`w-3.5 h-3.5 text-sky-500 transition-transform duration-200 ${sourcesOpen ? 'rotate-90' : ''}`} />
          </button>

          {sourcesOpen && (
            <div className="px-3 pb-2.5 pt-1 space-y-1.5 border-t border-sky-200/60 dark:border-sky-800/40">
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
                  <div key={i} className="flex items-start gap-2 text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="shrink-0 mt-0.5">
                      {isVault ? (
                        <Database className="w-3 h-3 text-amber-500" />
                      ) : (
                        <Link2 className="w-3 h-3 text-sky-500" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 truncate"
                        >
                          <span className="truncate">{title}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                        </a>
                      ) : (
                        <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{title}</span>
                      )}
                      {domain && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 ml-1">
                          [{domain}]
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

export default ResponseProcess;
