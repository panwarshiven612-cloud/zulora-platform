import React, { useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Radio, 
  Send, 
  StopCircle,
  Paperclip, 
  Camera, 
  Globe, 
  Link, 
  X,
  FileText
} from 'lucide-react';
import ModelSelector from './ModelSelector';

export default function ChatInput({
  inputPrompt = '',
  setInputPrompt,
  onSendMessage,
  attachments = [],
  onRemoveAttachment,
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
  isSendDisabled = false,
  mediaUploadProgress = null,
  enableWebSearch = false,
  onToggleWebSearch,
  onOpenConnectors,
  isGenerating = false,
  onStopGeneration
}) {
  const textareaRef = useRef(null);

  // Auto-grow textarea height cleanly based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 40), 160);
    el.style.height = `${nextHeight}px`;
  }, [inputPrompt]);

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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSendDisabled && (inputPrompt.trim() || attachments.length > 0)) {
        onSendMessage();
      }
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0 && onFileSelect) {
      onFileSelect({ target: { files } });
    }
  };

  const hasContent = inputPrompt.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !isSendDisabled;

  return (
    <div className="chat-composer-container relative w-full max-w-4xl mx-auto rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#0c1222]/95 shadow-xl backdrop-blur-2xl transition-all">
      {/* Attachment Chips Tray */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2.5 border-b border-slate-100 dark:border-slate-800/80">
          {attachments.map((file, idx) => {
            const isImg = file.type?.startsWith('image/');
            return (
              <div 
                key={`${file.name}-${idx}`} 
                className="relative group flex items-center gap-1.5 pl-2 pr-6 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 max-w-[200px]"
              >
                {isImg ? (
                  <img 
                    src={URL.createObjectURL(file)} 
                    alt={file.name} 
                    className="w-4 h-4 object-cover rounded" 
                  />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                )}
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {mediaUploadProgress && (
        <div className="mx-3 my-2 rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 dark:border-sky-900/50 dark:bg-sky-950/30" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-sky-800 dark:text-sky-200">
            <span>{mediaUploadProgress.status === 'error'
              ? `Upload failed: ${mediaUploadProgress.error}`
              : mediaUploadProgress.status === 'complete'
                ? 'Files uploaded to server.'
                : `Uploading file to server... ${mediaUploadProgress.percent}%`}</span>
            {mediaUploadProgress.status === 'uploading' && <span className="shrink-0">{mediaUploadProgress.fileCount} file{mediaUploadProgress.fileCount === 1 ? '' : 's'}</span>}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100 dark:bg-slate-800" role="progressbar" aria-label="Media upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={mediaUploadProgress.status === 'error' ? 0 : mediaUploadProgress.percent}>
            <div className={`h-full rounded-full transition-[width] duration-200 ${mediaUploadProgress.status === 'error' ? 'bg-rose-500' : 'bg-gradient-to-r from-sky-500 to-blue-600'}`} style={{ width: `${mediaUploadProgress.status === 'error' ? 0 : mediaUploadProgress.percent}%` }} />
          </div>
        </div>
      )}

      {/* Main Textarea Area */}
      <div className="w-full px-3.5 pt-3 pb-1">
        <textarea
          ref={textareaRef}
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
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

          {/* 3. Connectors Link Icon */}
          <button
            type="button"
            onClick={onOpenConnectors}
            title="Google & Workspace Connectors"
            aria-label="Connectors"
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
          >
            <Link className="h-4 w-4" />
          </button>

          {/* 4. Attachment Clip */}
          <button
            type="button"
            onClick={() => fileInputRef?.current?.click()}
            title="Attach file"
            aria-label="Attach file"
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* 5. Camera Icon */}
          <button
            type="button"
            onClick={() => cameraInputRef?.current?.click()}
            title="Take or upload photo"
            aria-label="Photo"
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
          >
            <Camera className="h-4 w-4" />
          </button>

          {/* 6. Microphone Icon */}
          <button
            type="button"
            onClick={onToggleListening}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Voice input'}
            className={`h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 flex items-center justify-center rounded-xl border transition-all ${
              isListening
                ? 'animate-pulse border-red-300 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-950/40'
                : 'border-slate-200/80 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* 7. Live Voice Icon */}
          {onOpenVoiceAssistant && (
            <button
              type="button"
              onClick={onOpenVoiceAssistant}
              title="Open Zulora Live Voice Assistant"
              aria-label="Live Voice Assistant"
              className="chat-live-voice-btn h-8 px-2 sm:h-8.5 sm:px-2.5 shrink-0 flex items-center justify-center gap-1 rounded-xl border border-sky-300/70 dark:border-sky-700/60 bg-sky-50/90 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-all text-xs font-semibold shadow-xs"
            >
              <Radio className="h-3.5 w-3.5 animate-pulse text-sky-500 shrink-0" />
              <span className="hidden xs:inline">Live</span>
            </button>
          )}
        </div>

        {/* 8. Send Arrow Button */}
        <div className="shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => isGenerating ? onStopGeneration?.() : onSendMessage()}
            disabled={isGenerating ? false : !canSend}
            aria-label={isGenerating ? 'Stop generation' : 'Send message'}
            title={isGenerating ? 'Stop generation' : 'Send message'}
            className={`h-9 w-9 sm:h-9 sm:w-9 flex items-center justify-center rounded-full font-semibold transition-all duration-200 ${
              isGenerating
                ? 'animate-pulse bg-rose-500 text-white shadow-md shadow-rose-500/30 hover:bg-rose-600 active:scale-90'
                : canSend
                  ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 active:scale-95'
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
    </div>
  );
}
