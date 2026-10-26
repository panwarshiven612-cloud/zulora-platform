import React, { useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  MicOff, 
  Radio, 
  Send, 
  StopCircle,
  Paperclip, 
  Camera, 
  Globe, 
  X,
  FileText
} from 'lucide-react';
import ModelSelector from './ModelSelector';

export const MAX_FILE_SIZE: number = 50 * 1024 * 1024; // 50 MB max file size

export interface ChatInputProps {
  inputPrompt?: string;
  input?: string;
  setInputPrompt?: (val: string | ((prev: string) => string)) => void;
  setInput?: (val: string | ((prev: string) => string)) => void;
  onSendMessage?: (prompt?: string) => void;
  handleSendMessage?: (prompt?: string) => void;
  attachments?: File[];
  files?: File[];
  onRemoveAttachment?: (index: number) => void;
  onRemoveFile?: (index: number) => void;
  modelPreference?: string;
  onModelChange?: (modelId: string) => void;
  showModelMenu?: boolean;
  onToggleModelMenu?: (e: React.MouseEvent | React.TouchEvent) => void;
  onCloseModelMenu?: () => void;
  isListening?: boolean;
  onToggleListening?: () => void;
  onOpenVoiceAssistant?: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  cameraInputRef?: React.RefObject<HTMLInputElement>;
  onFileSelect?: (e: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => void;
  attachmentPreviewUrls?: Map<File, string>;
  isSendDisabled?: boolean;
  mediaAnalysisStatus?: string;
  enableWebSearch?: boolean;
  onToggleWebSearch?: () => void;
  onOpenConnectors?: () => void;
  isGenerating?: boolean;
  onStopGeneration?: () => void;
  showMoreTools?: boolean;
  onToggleMoreTools?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputPrompt = '',
  input = '',
  setInputPrompt,
  setInput,
  onSendMessage,
  handleSendMessage,
  attachments = [],
  files = [],
  onRemoveAttachment,
  onRemoveFile,
  modelPreference = 'auto',
  onModelChange,
  showModelMenu = false,
  onToggleModelMenu,
  onCloseModelMenu,
  isListening = false,
  onToggleListening,
  onOpenVoiceAssistant,
  fileInputRef,
  cameraInputRef,
  onFileSelect,
  attachmentPreviewUrls = new Map(),
  isSendDisabled = false,
  mediaAnalysisStatus = '',
  enableWebSearch = false,
  onToggleWebSearch,
  onOpenConnectors,
  isGenerating = false,
  onStopGeneration
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const activePrompt = inputPrompt || input;
  const setPrompt = setInputPrompt || setInput;
  const activeAttachments = attachments.length > 0 ? attachments : files;
  const removeAttachment = onRemoveAttachment || onRemoveFile;

  // Auto-grow textarea height cleanly based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 40), 160);
    el.style.height = `${nextHeight}px`;
  }, [activePrompt]);

  // Dynamic Viewport Height (dvh) & mobile keyboard slide-above handler
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleViewportChange = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--dvh', `${height * 0.01}px`);
      const offset = vv ? Math.max(0, window.innerHeight - (vv.height + (vv.offsetTop || 0))) : 0;
      document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
    };

    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    handleViewportChange();

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, []);

  const submitMessage = useCallback((e?: React.FormEvent | React.MouseEvent | React.TouchEvent | React.KeyboardEvent) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    if (isGenerating) {
      onStopGeneration?.();
      return;
    }

    const trimmed = (activePrompt || '').trim();
    const hasFiles = activeAttachments.length > 0;
    
    // Explicitly reject whitespace-only or empty messages without files
    if (!trimmed && !hasFiles) {
      return;
    }

    if (isSendDisabled) {
      return;
    }

    // Debounce rapid double-clicks/touches within 250ms
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 250);

    // Call whichever send handler was passed
    const sendHandler = onSendMessage || handleSendMessage;
    if (typeof sendHandler === 'function') {
      try {
        sendHandler(trimmed);
      } catch (err) {
        console.error('[ChatInput] Error executing message send handler:', err);
      }
    }

    // Reset textarea height to default 40px
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [activePrompt, activeAttachments, isGenerating, isSendDisabled, onSendMessage, handleSendMessage, onStopGeneration]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      submitMessage(e);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0 && onFileSelect) {
      onFileSelect({ target: { files: pastedFiles } });
    }
  };

  const hasContent = Boolean(activePrompt && activePrompt.trim().length > 0) || Boolean(activeAttachments && activeAttachments.length > 0);
  const canSend = hasContent && !isSendDisabled;

  return (
    <form 
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        submitMessage(e);
      }}
      className="chat-composer-container relative w-full max-w-4xl mx-auto rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#0c1222]/95 shadow-xl backdrop-blur-2xl transition-all"
    >
      {/* Attachment Chips Tray */}
      {activeAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2.5 border-b border-slate-100 dark:border-slate-800/80">
          {activeAttachments.map((file, idx) => {
            const isImg = file.type?.startsWith('image/');
            const previewUrl = attachmentPreviewUrls.get(file);
            return (
              <div 
                key={`${file.name}-${idx}`} 
                className="relative group flex items-center gap-1.5 pl-2 pr-6 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 max-w-[200px]"
              >
                {isImg && previewUrl ? (
                  <img 
                    src={previewUrl || ''} 
                    alt={file.name} 
                    className="w-4 h-4 object-cover rounded" 
                  />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                )}
                <span className="truncate">{file.name}</span>
                {removeAttachment && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Main Textarea Area */}
      <div className="w-full px-3.5 pt-3 pb-1">
        <textarea
          ref={textareaRef}
          id="chat-textarea"
          data-testid="chat-input"
          value={activePrompt}
          onChange={(e) => setPrompt?.(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask Zulora AI anything..."
          rows={1}
          aria-label="Message Zulora AI"
          onFocus={() => {
            if (typeof window !== 'undefined' && window.innerWidth <= 768) {
              setTimeout(() => textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
            }
          }}
          className="w-full resize-none bg-transparent text-sm sm:text-base leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none overflow-y-auto max-h-[160px]"
        />
      </div>

      {/* Bottom Action Row: [Auto/Model Selector], [Web Search], [Connectors], [Attachment], [Camera], [Mic], [Live Voice], [Send] */}
      <div className="flex items-center justify-between gap-1 sm:gap-2 px-2.5 sm:px-3 pb-2.5 pt-1.5 border-t border-slate-100/70 dark:border-slate-800/60">
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap sm:flex-nowrap min-w-0">
          {/* 1. Auto/Model Selector */}
          <ModelSelector
            modelPreference={modelPreference}
            onModelChange={onModelChange}
            isOpen={showModelMenu}
            onToggle={onToggleModelMenu}
            onClose={onCloseModelMenu}
          />

          {/* 2. Web Search Icon */}
          <button
            type="button"
            onClick={onToggleWebSearch}
            title={enableWebSearch ? 'Web search active' : 'Enable web search'}
            aria-pressed={enableWebSearch}
            className={`h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border transition-all ${
              enableWebSearch
                ? 'border-sky-400 bg-sky-100/90 text-sky-700 dark:border-sky-600 dark:bg-sky-950/70 dark:text-sky-300 shadow-xs'
                : 'border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Globe className="h-4 w-4" />
          </button>

          {/* 3. Attachment Clip */}
          <button
            type="button"
            onClick={() => fileInputRef?.current?.click()}
            title="Attach file"
            aria-label="Attach file"
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all touch-manipulation"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* 4. Camera Icon */}
          <button
            type="button"
            onClick={() => cameraInputRef?.current?.click()}
            title="Take or upload photo"
            aria-label="Photo"
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all touch-manipulation"
          >
            <Camera className="h-4 w-4" />
          </button>

          {/* 5. Microphone Icon */}
          <button
            type="button"
            onClick={onToggleListening}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Voice input'}
            className={`h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border transition-all touch-manipulation ${
              isListening
                ? 'animate-pulse border-red-300 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-950/40'
                : 'border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* 6. Live Voice Icon */}
          {onOpenVoiceAssistant && (
            <button
              type="button"
              onClick={onOpenVoiceAssistant}
              title="Open Zulora Live Voice Assistant"
              aria-label="Live Voice Assistant"
              className="chat-live-voice-btn h-8 px-2 sm:h-8.5 sm:px-2.5 shrink-0 flex items-center justify-center gap-1 rounded-xl border border-sky-300/70 dark:border-sky-700/60 bg-sky-50/90 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-all text-xs font-semibold shadow-xs touch-manipulation"
            >
              <Radio className="h-3.5 w-3.5 animate-pulse text-sky-500 shrink-0" />
              <span className="hidden xs:inline">Live</span>
            </button>
          )}
        </div>

        {/* 7. Send Arrow Button */}
        <div className="shrink-0 flex items-center">
          <button
            type="submit"
            id="chat-send-button"
            data-testid="send-button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              submitMessage(e);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              submitMessage(e);
            }}
            disabled={!isGenerating && !canSend}
            aria-label={isGenerating ? 'Stop generation' : 'Send message'}
            title={isGenerating ? 'Stop generation' : 'Send message'}
            className={`h-9 w-9 sm:h-9 sm:w-9 flex items-center justify-center rounded-full font-semibold transition-all duration-200 select-none touch-manipulation ${
              isGenerating
                ? 'animate-pulse bg-rose-500 text-white shadow-md shadow-rose-500/30 hover:bg-rose-600 active:scale-90 cursor-pointer'
                : canSend
                  ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 active:scale-95 cursor-pointer'
                  : 'cursor-not-allowed bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600'
            }`}
          >
            {isGenerating ? <StopCircle className="h-5 w-5 shrink-0" /> : <Send className="h-4 w-4 shrink-0" />}
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input 
        ref={fileInputRef} 
        type="file" 
        multiple 
        className="hidden" 
        style={{ display: 'none' }} 
        onChange={onFileSelect} 
        accept="image/*,video/*,.pdf,.txt,.doc,.docx,.csv,.md,.json" 
      />
      <input 
        ref={cameraInputRef} 
        type="file" 
        className="hidden" 
        style={{ display: 'none' }} 
        onChange={onFileSelect} 
        accept="image/*,video/*" 
      />
    </form>
  );
};

export default ChatInput;
