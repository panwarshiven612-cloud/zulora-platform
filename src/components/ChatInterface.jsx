import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import clike from 'react-syntax-highlighter/dist/esm/languages/prism/clike';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import {
  Send,
  Search,
  Sparkles,
  Paperclip,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
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
  X,
  ChevronRight,
  StopCircle,
  Lightbulb,
  Code2,
  FlaskConical,
  BarChart3,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  ArrowDown,
  Plus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRouter, MODEL_TIERS } from '../services/apiRouter';
import { firestoreService } from '../services/firestoreService';

/* ============================================================
   CONSTANTS
   ============================================================ */
const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';

[
  ['clike', clike], ['markup', markup], ['javascript', javascript], ['jsx', jsx],
  ['typescript', typescript], ['tsx', tsx], ['python', python], ['bash', bash],
  ['json', json], ['css', css], ['sql', sql], ['yaml', yaml], ['markdown', markdown]
].forEach(([name, language]) => SyntaxHighlighter.registerLanguage(name, language));

const MODEL_OPTIONS = Object.values(MODEL_TIERS).map(t => ({
  id: t.id,
  label: t.label,
  shortLabel: t.shortLabel,
  icon: t.id === 'flash' ? Zap : t.id === 'think' ? FlaskConical : Sparkles,
  color: t.color,
  badge: t.badge,
}));

const SUGGESTION_CARDS = [
  {
    icon: Globe,
    iconColor: 'text-sky-500',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    borderColor: 'border-sky-100 dark:border-sky-900/40',
    title: 'Research latest AI breakthroughs',
    subtitle: 'Summarize 2026 AI developments',
    query: 'What are the major AI architecture breakthroughs and LLM innovations happening in 2026? Provide a well-structured summary.',
  },
  {
    icon: Code2,
    iconColor: 'text-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-100 dark:border-emerald-900/40',
    title: 'Write a Python web scraper',
    subtitle: 'With retry logic & error handling',
    query: 'Write a production-ready Python web scraper using httpx and BeautifulSoup with retry logic, rate limiting, and proper error handling. Include docstrings.',
  },
  {
    icon: BarChart3,
    iconColor: 'text-violet-500',
    bgColor: 'bg-violet-50 dark:bg-violet-950/30',
    borderColor: 'border-violet-100 dark:border-violet-900/40',
    title: 'Analyze market strategies',
    subtitle: 'Strategic business analysis',
    query: 'Provide a strategic SWOT analysis and market positioning framework for a new SaaS AI platform launching in 2026.',
  },
  {
    icon: Lightbulb,
    iconColor: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    borderColor: 'border-amber-100 dark:border-amber-900/40',
    title: 'Design a SaaS database schema',
    subtitle: 'Multi-tenant with billing',
    query: 'Design a scalable PostgreSQL schema for a multi-tenant AI SaaS platform with user tiers, credit billing, sessions, and audit logs. Use proper indexing.',
  },
];

/* ============================================================
   CODE BLOCK COMPONENT
   ============================================================ */
const CodeBlock = memo(({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div className="code-block-wrapper my-3">
      <div className="code-block-header">
        <span className="lang-label">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          padding: '1rem',
          fontSize: '0.835rem',
          lineHeight: '1.6',
          background: '#0d1117',
        }}
        codeTagProps={{
          style: { fontFamily: "'JetBrains Mono', monospace" },
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';

/* ============================================================
   MARKDOWN RENDERER
   ============================================================ */
const MarkdownContent = memo(({ content }) => {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            if (!inline && (match || String(children).includes('\n'))) {
              return (
                <CodeBlock
                  language={lang}
                  value={String(children).replace(/\n$/, '')}
                />
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-500 hover:text-sky-400 underline underline-offset-2 inline-flex items-center gap-0.5"
              >
                {children}
                <ExternalLink className="w-3 h-3 inline ml-0.5" />
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-left font-semibold text-slate-800 dark:text-slate-200">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 border border-slate-200/60 dark:border-slate-700/40 text-slate-700 dark:text-slate-300">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-3 border-sky-400 pl-4 my-3 text-slate-500 dark:text-slate-400 italic bg-sky-50/30 dark:bg-sky-950/10 py-2 pr-2 rounded-r">
                {children}
              </blockquote>
            );
          },
          h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-slate-900 dark:text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mt-4 mb-2 text-slate-900 dark:text-white">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1.5 text-slate-800 dark:text-slate-100">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-slate-700 dark:text-slate-300">{children}</li>,
          p: ({ children }) => <p className="mb-2 last:mb-0 text-slate-700 dark:text-slate-300 leading-relaxed">{children}</p>,
          hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
          strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownContent.displayName = 'MarkdownContent';

/* ============================================================
   TYPING INDICATOR
   ============================================================ */
const TypingIndicator = () => (
  <div className="flex items-start gap-3 animate-fade-slide">
    <div className="flex-shrink-0 w-8 h-8 rounded-xl overflow-hidden ring-2 ring-sky-500/30">
      <img src={LOGO_URL} alt="Zulora AI" className="w-full h-full object-cover" />
    </div>
    <div className="glass-pearl dark:glass-dark rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 border border-white/60 dark:border-slate-700/60">
      <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Thinking</span>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  </div>
);

/* ============================================================
   MESSAGE BUBBLE
   ============================================================ */
const MessageBubble = memo(({ message, index, onCopy, onSpeak, isSpeaking, copiedIndex }) => {
  const isUser = message.role === 'user';
  const timestamp = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`group flex items-start gap-3 animate-fade-slide ${isUser ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-xl overflow-hidden shadow-sm ${isUser ? 'ring-2 ring-sky-500/20' : 'ring-2 ring-sky-500/30'}`}>
        {isUser ? (
          <div className="w-full h-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        ) : (
          <img src={LOGO_URL} alt="Zulora AI" className="w-full h-full object-cover" />
        )}
      </div>

      {/* Content */}
      <div className={`flex flex-col max-w-[80%] sm:max-w-[75%] gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {isUser ? 'You' : 'Zulora AI'}
          </span>
          {message.model && !isUser && (
            <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 rounded-full font-medium border border-sky-200/50 dark:border-sky-800/40">
              {message.model}
            </span>
          )}
          {timestamp && (
            <span className="text-[10px] text-slate-400 dark:text-slate-600">{timestamp}</span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={`relative rounded-2xl px-4 py-3 shadow-sm transition-all duration-200
            ${isUser
              ? 'bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-tr-sm'
              : 'glass-pearl dark:glass-dark border border-white/60 dark:border-slate-700/60 rounded-tl-sm text-slate-800 dark:text-slate-200'
            }`}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>
        {!isUser && message.sources?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {message.sources.slice(0, 5).map((source, sourceIndex) => (
              <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-sky-200/70 dark:border-sky-800/50 bg-sky-50/70 dark:bg-sky-950/30 px-2 py-1 text-[10px] text-sky-700 dark:text-sky-300 hover:underline">
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{source.title || source.url}</span>
              </a>
            ))}
          </div>
        )}

        {/* Action Bar — AI messages only */}
        {!isUser && (
          <div className={`flex items-center gap-1 px-1 transition-opacity duration-200 ${showActions ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={() => onCopy(message.content, index)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
              title="Copy"
            >
              {copiedIndex === index ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => onSpeak(message.content, index)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
              title={isSpeaking === index ? 'Stop' : 'Read aloud'}
            >
              {isSpeaking === index ? (
                <VolumeX className="w-3.5 h-3.5 text-sky-500" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <button className="p-1.5 rounded-lg text-slate-400 hover:text-green-500 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all" title="Good response">
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all" title="Bad response">
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

/* ============================================================
   WELCOME / EMPTY STATE
   ============================================================ */
const WelcomeScreen = ({ user, onSuggestion }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10 space-y-8 animate-scale-in">
    {/* Hero */}
    <div className="text-center space-y-3">
      <div className="relative inline-flex">
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-xl ring-2 ring-sky-500/30">
          <img src={LOGO_URL} alt="Zulora" className="w-full h-full object-cover" />
        </div>
        <div className="absolute -inset-1.5 rounded-2xl bg-sky-500/20 blur-xl -z-10" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white">
          Hello, <span className="azure-gradient-text">{user?.displayName?.split(' ')[0] || 'there'}</span> 👋
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base">
          How can Zulora AI help you today?
        </p>
      </div>
    </div>

    {/* Suggestion Cards */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
      {SUGGESTION_CARDS.map((card, i) => (
        <button
          key={i}
          onClick={() => onSuggestion(card.query)}
          className={`text-left p-4 rounded-xl border ${card.bgColor} ${card.borderColor} glass-card-hover cursor-pointer transition-all duration-200 group`}
        >
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${card.bgColor} border ${card.borderColor}`}>
              <card.icon className={`w-4 h-4 ${card.iconColor}`} />
            </div>
            <div className="space-y-0.5 min-w-0">
              <p className="font-semibold text-slate-800 dark:text-slate-200 text-sm leading-tight group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                {card.title}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500">{card.subtitle}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </button>
      ))}
    </div>
  </div>
);

/* ============================================================
   MAIN CHAT INTERFACE
   ============================================================ */
export const ChatInterface = ({ activeSession, onUpdateSession, onNewChat }) => {
  const { currentUser, setIsUsageModalOpen, checkUsage } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelPreference, setModelPreference] = useState('pro');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isSpeakingIndex, setIsSpeakingIndex] = useState(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [queryTime, setQueryTime] = useState(null);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const speechRef = useRef(null);

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
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
    setIsAtBottom(distFromBottom < 60);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, [inputPrompt]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        setInputPrompt(prev => prev ? `${prev} ${transcript}` : transcript);
        setIsListening(false);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleCopy = useCallback((text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }, []);

  const handleSpeak = useCallback((text, index) => {
    if (!window.speechSynthesis) return;
    if (isSpeakingIndex === index) {
      window.speechSynthesis.cancel();
      setIsSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.replace(/[#*`_]/g, ''));
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.onend = () => setIsSpeakingIndex(null);
    utter.onerror = () => setIsSpeakingIndex(null);
    speechRef.current = utter;
    window.speechSynthesis.speak(utter);
    setIsSpeakingIndex(index);
  }, [isSpeakingIndex]);

  const handleFileAttach = (e) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files.slice(0, 5 - prev.length)]);
    e.target.value = '';
  };

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const buildContextMessages = useCallback(() => {
    return messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
  }, [messages]);

  const sendMessage = useCallback(async (promptOverride = null) => {
    const basePrompt = (promptOverride || inputPrompt).trim();
    if (!basePrompt || loading) return;

    // Read any attached files and append their content to the prompt
    let fullPrompt = basePrompt;
    if (attachments.length > 0) {
      const fileContents = await Promise.all(
        attachments.map(async (file) => {
          try {
            const content = await apiRouter.readFileContent(file);
            return `\n\n📎 **File: ${file.name}**\n\`\`\`\n${content}\n\`\`\``;
          } catch (err) {
            return `\n\n📎 [Could not read ${file.name}: ${err.message}]`;
          }
        })
      );
      fullPrompt = basePrompt + fileContents.join('');
    }

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: fullPrompt,
      displayContent: basePrompt, // show original prompt in UI
      timestamp: Date.now(),
      attachments: attachments.map(f => f.name),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInputPrompt('');
    setAttachments([]);
    setLoading(true);
    setIsAtBottom(true);
    setQueryTime(null);
    const startTime = Date.now();

    try {
      const contextMessages = buildContextMessages();
      const result = await apiRouter.generateChat(
        fullPrompt,
        contextMessages,
        {
          model: modelPreference,
          webSearch: enableWebSearch,
          userId: currentUser?.uid,
        }
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setQueryTime(elapsed);

      const aiMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.text || 'I encountered an issue generating a response. Please try again.',
        timestamp: Date.now(),
        model: result.model || 'Zulora AI',
        provider: result.provider,
        queryTime: elapsed,
      };

      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);

      // Persist to Firestore
      const sessionId = activeSession?.id || `chat_${Date.now()}`;
      const sessionTitle = basePrompt.length > 50 ? basePrompt.slice(0, 47) + '...' : basePrompt;
      const updatedSession = {
        id: sessionId,
        title: activeSession?.title || sessionTitle,
        messages: finalMessages,
        updatedAt: Date.now(),
        model: result.model,
      };
      if (currentUser?.uid) {
        await firestoreService.saveChatSession(currentUser.uid, updatedSession).catch(console.warn);
      }
      onUpdateSession?.(updatedSession);

    } catch (err) {
      console.error('Chat error:', err);
      if (err.status === 403) setIsUsageModalOpen(true);
      const errorMsg = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `⚠️ **Generation failed**: ${err.message || 'All AI providers unavailable. Please check your connection and try again.'}`,
        timestamp: Date.now(),
        model: 'Error',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [inputPrompt, loading, messages, modelPreference, enableWebSearch, attachments, currentUser, activeSession, buildContextMessages, setIsUsageModalOpen, onUpdateSession]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectedModel = MODEL_OPTIONS.find(m => m.id === modelPreference) || MODEL_OPTIONS[0];

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden relative">

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-6 scroll-smooth"
      >
        {messages.length === 0 ? (
          <WelcomeScreen user={currentUser} onSuggestion={(q) => sendMessage(q)} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id || i}
                message={msg}
                index={i}
                onCopy={handleCopy}
                onSpeak={handleSpeak}
                isSpeaking={isSpeakingIndex}
                copiedIndex={copiedIndex}
              />
            ))}
            {loading && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom Button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-28 right-6 w-9 h-9 rounded-full azure-gradient-btn text-white flex items-center justify-center shadow-lg z-10 animate-scale-in"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* ─── Input Area ─── */}
      <div className="shrink-0 border-t border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-[#070b14]/90 backdrop-blur-xl px-3 sm:px-4 md:px-6 py-3 sm:py-4">

        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((file, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/40 rounded-lg px-2.5 py-1.5">
                <Paperclip className="w-3 h-3" />
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button onClick={() => removeAttachment(i)} className="hover:text-red-500 transition-colors ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Box */}
        <div className="glass-pearl dark:glass-dark rounded-2xl border border-slate-200/70 dark:border-slate-700/60 overflow-hidden transition-all duration-200 focus-within:border-sky-400/50 dark:focus-within:border-sky-500/40 focus-within:shadow-[0_0_0_3px_rgba(14,165,233,0.1)]">

          {/* Text Area */}
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Zulora AI anything... (Shift+Enter for new line)"
            rows={1}
            disabled={loading}
            className="w-full bg-transparent px-4 pt-3.5 pb-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 resize-none outline-none leading-relaxed"
            style={{ maxHeight: '180px' }}
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 gap-2">
            {/* Left Tools */}
            <div className="flex items-center gap-1">
              {/* Model Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowModelMenu(v => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 transition-all"
                >
                  <selectedModel.icon className={`w-3.5 h-3.5 ${selectedModel.color}`} />
                  <span>{selectedModel.shortLabel}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {showModelMenu && (
                  <div className="absolute bottom-full mb-2 left-0 glass-elevated dark:glass-dark rounded-xl border border-white/80 dark:border-slate-700/60 shadow-2xl z-50 p-1.5 min-w-[160px] animate-scale-in">
                    {MODEL_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => { setModelPreference(opt.id); setShowModelMenu(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          modelPreference === opt.id
                            ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <opt.icon className={`w-3.5 h-3.5 ${opt.color}`} />
                        {opt.label}
                        {modelPreference === opt.id && <Check className="w-3 h-3 ml-auto" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Web Search Toggle */}
              <button
                onClick={() => setEnableWebSearch(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  enableWebSearch
                    ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border-sky-200/60 dark:border-sky-800/50'
                    : 'text-slate-500 dark:text-slate-500 border-slate-200/60 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Search</span>
              </button>

              {/* Attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 border border-slate-200/60 dark:border-slate-700/50 transition-all"
                title="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileAttach} accept="image/*" />

              {/* Mic */}
              <button
                onClick={toggleListening}
                className={`p-1.5 rounded-lg border transition-all ${
                  isListening
                    ? 'bg-red-50 dark:bg-red-950/30 text-red-500 border-red-200/60 dark:border-red-800/50 animate-pulse'
                    : 'text-slate-500 dark:text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 border-slate-200/60 dark:border-slate-700/50'
                }`}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Right: Send Button */}
            <button
              onClick={() => sendMessage()}
              disabled={!inputPrompt.trim() || loading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                inputPrompt.trim() && !loading
                  ? 'azure-gradient-btn text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 cursor-not-allowed'
              }`}
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{loading ? 'Generating...' : 'Send'}</span>
            </button>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 mt-2">
          Zulora AI can make mistakes. Consider checking important information.
        </p>
      </div>

      {/* Click outside model menu */}
      {showModelMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
      )}
    </div>
  );
};

export default ChatInterface;
