import React from 'react';

export interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  className?: string;
  children?: React.ReactNode;
}

function modelBadgeLabel(model = '', provider = '') {
  const modelId = String(model || '').trim();
  const source = String(provider || '').trim();
  if (!modelId) return '';
  const readableModel = modelId
    .replace(/^gemini-/i, 'Gemini ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(llama|flash|lite|pro|versatile|instruct|small|latest)\b/gi, word => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B');
  const providerName = source.toLowerCase();
  if (providerName.includes('groq')) return `Groq LPU (${readableModel})`;
  if (providerName.includes('cerebras')) return `Cerebras Ultra Speed (${readableModel})`;
  if (providerName.includes('openrouter')) return `OpenRouter (${readableModel})`;
  if (providerName.includes('mistral')) return `Mistral AI (${readableModel})`;
  if (providerName.includes('gemini') || modelId.toLowerCase().startsWith('gemini-')) return readableModel;
  return readableModel;
}

/**
 * Mobile-responsive container for chat messages, tables, and code snippets.
 * Enforces horizontal containment so wide tables or pre elements stay inside
 * without breaking or horizontally stretching the mobile viewport.
 */
export function ChatMessageContainer({ role, content, model, provider, className = '', children }: ChatMessageProps) {
  const isUser = role === 'user';
  return (
    <div className={`chat-message-row flex flex-col min-w-0 max-w-[92%] sm:max-w-[80%] gap-1 ${isUser ? 'items-end' : 'items-start'} ${className}`}>
      {!isUser && model && <span className="px-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">{modelBadgeLabel(model, provider)}</span>}
      <div className={`relative min-w-0 max-w-full overflow-hidden rounded-2xl px-4 py-3 shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-tr-sm'
          : 'glass-pearl dark:glass-dark border border-white/60 dark:border-slate-700/60 rounded-tl-sm text-slate-800 dark:text-slate-200'
      }`}>
        <div className="prose-chat w-full min-w-0 max-w-full overflow-x-auto break-words">
          {children || content}
        </div>
      </div>
    </div>
  );
}

export default ChatMessageContainer;

