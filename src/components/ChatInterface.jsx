import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Search, 
  Sparkles, 
  Paperclip, 
  Mic, 
  MicOff, 
  Volume2, 
  Copy, 
  Check, 
  Globe, 
  Cpu, 
  Bot, 
  User, 
  ExternalLink,
  ChevronDown,
  RefreshCw,
  Zap,
  Image as ImageIcon,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRouter } from '../services/apiRouter';
import { firestoreService } from '../services/firestoreService';

const SUGGESTIONS = [
  { icon: Globe, label: 'Research 2026 AI breakthroughs', query: 'What are the major breakthrough AI architectures and quantum computing developments in 2026?' },
  { icon: Cpu, label: 'Write a Python web scraper', query: 'Write a production-ready Python script using httpx and BeautifulSoup with retry logic, proxies, and error handling.' },
  { icon: Sparkles, label: 'Build fullstack SaaS schema', query: 'Design an optimal scalable database schema for a multi-tenant AI SaaS with credits and billing.' },
  { icon: Zap, label: 'Analyze tech market trends', query: 'Provide a strategic macroeconomic analysis of generative AI adoption and cloud compute efficiency.' }
];

export const ChatInterface = ({ activeSession, onUpdateSession, onNewChat }) => {
  const { currentUser, checkAndIncrement, setIsUsageModalOpen } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelPreference, setModelPreference] = useState('auto');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isSpeakingIndex, setIsSpeakingIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  // Sync messages when activeSession changes
  useEffect(() => {
    if (activeSession?.messages) {
      setMessages(activeSession.messages);
    } else {
      setMessages([]);
    }
  }, [activeSession?.id]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputPrompt(prev => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleSpeechRecognition = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const speakText = (text, index) => {
    if (!window.speechSynthesis) return;

    if (isSpeakingIndex === index) {
      window.speechSynthesis.cancel();
      setIsSpeakingIndex(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[#*`_~\[\]()]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setIsSpeakingIndex(null);
    utterance.onerror = () => setIsSpeakingIndex(null);

    setIsSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
      if (!file.type.startsWith('image/')) {
        alert('Currently, image attachments are supported for multimodal analysis.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [
          ...prev,
          {
            name: file.name,
            mimeType: file.type,
            base64: reader.result
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (overridePrompt = null) => {
    const promptToSend = (overridePrompt || inputPrompt).trim();
    if ((!promptToSend && attachments.length === 0) || loading) return;

    // 1. Check Usage Limits before sending
    const usageCheck = await checkAndIncrement('chat');
    if (!usageCheck.allowed) {
      return;
    }

    const userMessage = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content: promptToSend,
      attachments: [...attachments],
      timestamp: Date.now()
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputPrompt('');
    setAttachments([]);
    setLoading(true);

    // Generate response via Multi-Model Engine
    try {
      const response = await apiRouter.generateChat({
        messages: newMessages,
        modelPreference,
        enableWebSearch,
        attachments: userMessage.attachments
      });

      const assistantMessage = {
        id: 'msg_' + (Date.now() + 1),
        role: 'assistant',
        content: response.text,
        provider: response.provider,
        model: response.model,
        sources: response.sources || [],
        latencyMs: response.latencyMs,
        timestamp: Date.now()
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);

      // Save to Firestore & local history
      const chatId = activeSession?.id || 'chat_' + Date.now();
      const chatTitle = activeSession?.title || promptToSend.substring(0, 36) + (promptToSend.length > 36 ? '...' : '');

      const sessionData = {
        id: chatId,
        title: chatTitle,
        mode: enableWebSearch ? 'search' : 'chat',
        model: modelPreference,
        messages: finalMessages,
        updatedAt: Date.now()
      };

      await firestoreService.saveChatSession(currentUser.uid, chatId, sessionData);
      if (onUpdateSession) {
        onUpdateSession(sessionData);
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errorMessage = {
        id: 'msg_' + (Date.now() + 1),
        role: 'assistant',
        content: "We encountered a temporary network delay with upstream models. Zulora AI will seamlessly reconnect on your next prompt.",
        provider: 'Zulora Failover Engine',
        model: 'failover-recovery',
        timestamp: Date.now()
      };
      setMessages([...newMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] relative overflow-hidden bg-slate-50/50 dark:bg-slate-950/30">
      
      {/* Top Floating Control Bar */}
      <div className="shrink-0 p-3 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/60 dark:bg-slate-950/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 z-10">
        
        {/* Model Selector */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={modelPreference}
              onChange={e => setModelPreference(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
            >
              <option value="auto">Auto-Fallback Engine (Gemini + Groq + Cerebras)</option>
              <option value="gemini">Google Gemini 2.0 Flash (Rotating Keys)</option>
              <option value="groq">Groq Cloud (Llama 3.3 70B Ultra-Fast)</option>
              <option value="cerebras">Cerebras AI (Llama 3.1 8B High-Speed)</option>
              <option value="openrouter">OpenRouter (DeepSeek / Llama 3.3)</option>
              <option value="mistral">Mistral AI (Mistral Small)</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-[11px] font-semibold text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Multi-Model Live</span>
          </div>
        </div>

        {/* Web Search Toggle & Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEnableWebSearch(!enableWebSearch)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              enableWebSearch
                ? 'bg-sky-500 text-white border-sky-400 shadow-azure-glow'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Globe className={`w-3.5 h-3.5 ${enableWebSearch ? 'animate-spin' : ''}`} />
            <span>{enableWebSearch ? 'Web Search: ON' : 'Web Search'}</span>
          </button>

          <button
            onClick={onNewChat}
            className="p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-sky-500 hover:border-sky-400 transition-colors"
            title="Start Fresh Chat"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 space-y-6">
        
        {/* Welcome Empty State */}
        {messages.length === 0 && (
          <div className="max-w-3xl mx-auto py-10 sm:py-16 text-center animate-fade-in">
            <div className="inline-flex p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-500 mb-4 shadow-glass">
              <Sparkles className="w-8 h-8" />
            </div>
            
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
              What can <span className="azure-gradient-text">Zulora AI</span> solve for you today?
            </h1>
            
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto mb-8">
              Pristine Pearl & Azure intelligence studio founded by <strong>Shiven Panwar</strong>. Powered by automated multi-model routing across Gemini, Groq, Cerebras, and real-time Web Research.
            </p>

            {/* Prompt Suggestion Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left max-w-2xl mx-auto">
              {SUGGESTIONS.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSend(item.query)}
                  className="p-3.5 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 glass-card-hover cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5 mb-1">
                    <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-500 group-hover:scale-110 transition-transform">
                      <item.icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-sky-500 transition-colors">
                      {item.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                    {item.query}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Stream */}
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id || index}
              className={`flex gap-3 max-w-3xl mx-auto ${isUser ? 'justify-end' : 'justify-start'} animate-slide-up`}
            >
              {/* Assistant Avatar */}
              {!isUser && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-md">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              {/* Message Bubble Container */}
              <div className={`max-w-[85%] sm:max-w-[80%] space-y-2`}>
                
                {/* User Attachment previews */}
                {isUser && msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end mb-1">
                    {msg.attachments.map((att, i) => (
                      <img
                        key={i}
                        src={att.base64}
                        alt="attachment"
                        className="w-24 h-24 object-cover rounded-xl border border-sky-400/50 shadow-md"
                      />
                    ))}
                  </div>
                )}

                {/* Bubble */}
                <div
                  className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? 'azure-gradient-btn text-white rounded-br-none shadow-md font-medium'
                      : 'glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800/90 text-slate-800 dark:text-slate-100 rounded-bl-none shadow-sm'
                  }`}
                >
                  <div className="whitespace-pre-wrap font-sans break-words">
                    {msg.content}
                  </div>

                  {/* Sources Preview for Deep Research */}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
                      <span className="text-[11px] font-bold text-sky-500 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5" />
                        <span>Sources & Citations:</span>
                      </span>
                      <div className="grid grid-cols-1 gap-1.5">
                        {msg.sources.map((source, sIdx) => (
                          <a
                            key={sIdx}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-900/70 border border-slate-200/60 dark:border-slate-800/60 hover:border-sky-500/50 transition-colors flex items-center justify-between group"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-sky-500">
                                [{sIdx + 1}] {source.title}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">{source.snippet}</p>
                            </div>
                            <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-sky-500 shrink-0 ml-2" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Assistant Footer Info & Action Icons */}
                {!isUser && (
                  <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sky-500">{msg.provider || 'Zulora AI'}</span>
                      {msg.latencyMs && (
                        <span>• {(msg.latencyMs / 1000).toFixed(2)}s</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => speakText(msg.content, index)}
                        className="p-1 hover:text-sky-500 transition-colors"
                        title="Read aloud"
                      >
                        <Volume2 className={`w-3.5 h-3.5 ${isSpeakingIndex === index ? 'text-sky-500 animate-pulse' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleCopy(msg.content, index)}
                        className="p-1 hover:text-sky-500 transition-colors"
                        title="Copy message"
                      >
                        {copiedIndex === index ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

              </div>

              {/* User Avatar */}
              {isUser && (
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0 border border-slate-300 dark:border-slate-700">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Loading Spinner Indicator */}
        {loading && (
          <div className="flex gap-3 max-w-3xl mx-auto justify-start animate-fade-in">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-md">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-4 rounded-2xl glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {enableWebSearch ? 'Searching web & reasoning...' : 'Synthesizing response across multi-model waterfall...'}
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Fixed Area */}
      <div className="shrink-0 p-3 sm:p-5 max-w-4xl w-full mx-auto">
        
        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
            {attachments.map((att, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={att.base64}
                  alt={att.name}
                  className="w-12 h-12 rounded-lg object-cover border border-sky-400"
                />
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-500 text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Wrapper Glass Card */}
        <div className="relative rounded-2xl glass-pearl dark:glass-dark border border-slate-300/80 dark:border-slate-700/80 shadow-lg focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all p-2 sm:p-3">
          
          <textarea
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              enableWebSearch 
                ? "Enter your research topic or question with Web Grounding..."
                : "Ask Zulora AI anything, paste code, or explore ideas..."
            }
            rows={2}
            className="w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none resize-none px-2"
          />

          {/* Bottom input toolbar */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/50 dark:border-slate-800/60 mt-1">
            
            <div className="flex items-center gap-1 sm:gap-2">
              {/* File / Image attachment button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
                multiple
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-xl text-slate-500 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Attach image for multimodal analysis"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Voice recognition input button */}
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`p-2 rounded-xl transition-colors ${
                  isListening 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : 'text-slate-500 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={isListening ? "Listening... click to stop" : "Voice input"}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {/* Quick web search chip */}
              <button
                type="button"
                onClick={() => setEnableWebSearch(!enableWebSearch)}
                className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  enableWebSearch
                    ? 'bg-sky-500/10 text-sky-500 border border-sky-500/30'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <Globe className="w-3 h-3" />
                <span>Web Grounding</span>
              </button>
            </div>

            {/* Send button */}
            <button
              onClick={() => handleSend()}
              disabled={(!inputPrompt.trim() && attachments.length === 0) || loading}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                (!inputPrompt.trim() && attachments.length === 0) || loading
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'text-white azure-gradient-btn'
              }`}
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>

          </div>

        </div>

        {/* Small footer disclaimer */}
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 mt-2">
          Zulora AI can make mistakes. Verify critical facts. Founded by <strong>Shiven Panwar</strong>.
        </p>

      </div>

    </div>
  );
};

export default ChatInterface;

