import React, { useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Radio, 
  Send, 
  Paperclip, 
  Camera, 
  Globe, 
  Link, 
  MoreHorizontal, 
  ChevronDown, 
  X,
  FileText
} from 'lucide-react';
import ModelSelector from '../ModelSelector';

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
  showMoreTools = false,
  onToggleMoreTools,
  enableWebSearch = false,
  onToggleWebSearch,
  onOpenConnectors
}) {
  const textareaRef = useRef(null);

  // Auto-grow textarea height cleanly based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 38), 160);
    el.style.height = `${nextHeight}px`;
  }, [inputPrompt]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputPrompt.trim() || attachments.length > 0) {
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

  return (
    <div className="chat-composer-container relative w-full max-w-4xl mx-auto rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shadow-xl backdrop-blur-2xl transition-all">
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

      {/* Responsive Single-Row Flex Toolbar */}
      <div className="chat-input-single-row flex items-end gap-1 sm:gap-2 p-1.5 sm:p-2 w-full min-w-0">
        {/* Left: Model Selector & More Tools */}
        <div className="chat-composer-left flex shrink-0 items-center gap-1 z-20">
          <ModelSelector
            modelPreference={modelPreference}
            onModelChange={onModelChange}
            isOpen={showModelMenu}
            onToggle={onToggleModelMenu}
            onClose={onCloseModelMenu}
          />
          <button
            type="button"
            onClick={onToggleMoreTools}
            aria-expanded={showMoreTools}
            title="More tools (Web search, Connectors, Attachments)"
            className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-xl border transition-colors ${
              showMoreTools 
                ? 'border-violet-300 bg-violet-50 text-violet-600 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-400' 
                : 'border-slate-200/70 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        {/* Center: Clean Textarea with auto-growing height */}
        <div className="chat-composer-center flex-1 min-w-0 relative z-10 flex items-center">
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask Zulora AI anything..."
            rows={1}
            aria-label="Message Zulora AI"
            className="w-full resize-none bg-transparent px-2 sm:px-2.5 py-2 text-sm leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none overflow-y-auto max-h-[160px]"
          />
        </div>

        {/* Right: Voice / Send button group with zero overlap */}
        <div className="chat-composer-right flex shrink-0 items-center gap-1 sm:gap-1.5 z-20">
          {onOpenVoiceAssistant && (
            <button
              type="button"
              onClick={onOpenVoiceAssistant}
              title="Open Gemini Live Voice Assistant"
              className="chat-live-voice-btn h-9 px-2 sm:px-2.5 shrink-0 flex items-center justify-center gap-1 rounded-xl border border-sky-300/70 dark:border-sky-700/60 bg-sky-50/90 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-all text-xs font-semibold shadow-xs"
            >
              <Radio className="h-3.5 w-3.5 animate-pulse text-sky-500 shrink-0" />
              <span className="hidden xs:inline sm:inline">Live</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleListening}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Voice input'}
            className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-xl border transition-all ${
              isListening
                ? 'animate-pulse border-red-300 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-950/40'
                : 'border-slate-200/70 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => onSendMessage()}
            disabled={!hasContent}
            aria-label="Send message"
            title="Send message"
            className={`h-9 w-9 sm:w-auto sm:px-3.5 shrink-0 flex items-center justify-center gap-1.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-200 ${
              hasContent
                ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 active:scale-95'
                : 'cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'
            }`}
          >
            <Send className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>

      {/* Expanded Tools Drawer */}
      {showMoreTools && (
        <div className="flex flex-wrap items-center gap-2 p-2 sm:p-2.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/60 rounded-b-2xl sm:rounded-b-3xl">
          <button
            type="button"
            onClick={onToggleWebSearch}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              enableWebSearch
                ? 'border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400'
                : 'border-slate-200/70 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Search &amp; Research</span>
          </button>

          <button
            type="button"
            onClick={onOpenConnectors}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-200/70 bg-sky-50/70 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300 text-xs font-semibold hover:bg-sky-100 transition-colors"
          >
            <Link className="w-3.5 h-3.5" />
            <span>Connectors</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef?.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 text-xs font-medium hover:bg-white dark:hover:bg-slate-800 transition-colors"
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>Attach File</span>
          </button>

          <button
            type="button"
            onClick={() => cameraInputRef?.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 text-xs font-medium hover:bg-white dark:hover:bg-slate-800 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Photo</span>
          </button>

          <a 
            href="https://drive.zulora.in" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200/70 bg-amber-50/70 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 transition-colors"
          >
            <span>📁 Zulora Drive</span>
          </a>
        </div>
      )}

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

