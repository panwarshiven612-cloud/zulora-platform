import React from 'react';

export interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Mobile-responsive container for chat messages, tables, and code snippets.
 * Enforces horizontal containment so wide tables or pre elements stay inside
 * without breaking or horizontally stretching the mobile viewport.
 */
export function ChatMessageContainer({ role, content, className = '', children }: ChatMessageProps) {
  const isUser = role === 'user';
  return (
    <div className={`chat-message-row flex flex-col min-w-0 max-w-[92%] sm:max-w-[80%] gap-1 ${isUser ? 'items-end' : 'items-start'} ${className}`}>
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

