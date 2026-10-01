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
  Paperclip,
  Camera,
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
  RefreshCw,
  Image as ImageIcon,
  X,
  ChevronRight,
  StopCircle,
  Lightbulb,
  Code2,
  BarChart3,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  ArrowDown,
  Plus,
  Pencil,
  Radio,
  Link,
  CloudUpload,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { apiRouter } from '../services/apiRouter';
import connectorManager from '../services/connectorManager';
import { executeConnectorTask } from '../services/backgroundConnectorEngine';
import { executeDriveChatIntent, getDriveSystemContext, uploadChatMediaToDrive } from '../services/driveChatTools';
import { driveAuth } from '../config/firebaseDrive';
import { isCodeGenerationPrompt } from '../services/aiModels';
import { firestoreService, deriveChatTitle } from '../services/firestoreService';
import { imageFileToDataUrl, readFileAsDataUrl } from '../services/imageUtils';
import CodeArtifactRunner from './CodeArtifactRunner';
import ModelSelector from './ModelSelector';
import ConnectorsModal from './ConnectorsModal';

/* ============================================================
   CONSTANTS
   ============================================================ */
const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const ATTACHMENT_MIME_BY_EXTENSION = {
  bmp: 'image/bmp', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
  csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json', md: 'text/markdown', pdf: 'application/pdf', txt: 'text/plain'
};
const attachmentMimeType = file => {
  const declared = String(file?.type || '').toLowerCase();
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && !(extension === 'pdf' && declared === 'application/x-pdf')) return declared;
  return ATTACHMENT_MIME_BY_EXTENSION[extension] || declared;
};
const normalizeAttachmentFile = file => {
  const mimeType = attachmentMimeType(file);
  return mimeType && mimeType !== file.type
    ? new File([file], file.name, { type: mimeType, lastModified: Number(file.lastModified) || Date.now() })
    : file;
};
const isImageAttachment = file => attachmentMimeType(file).startsWith('image/');
const isPdfAttachment = file => attachmentMimeType(file) === 'application/pdf';

[
  ['clike', clike], ['markup', markup], ['javascript', javascript], ['jsx', jsx],
  ['typescript', typescript], ['tsx', tsx], ['python', python], ['bash', bash],
  ['json', json], ['css', css], ['sql', sql], ['yaml', yaml], ['markdown', markdown]
].forEach(([name, language]) => SyntaxHighlighter.registerLanguage(name, language));

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
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(error => console.warn('Could not copy code:', error));
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
              if (['html', 'css', 'js', 'javascript', 'svg'].includes(lang.toLowerCase())) {
                return <CodeArtifactRunner language={lang.toLowerCase()} code={String(children).replace(/\n$/, '')} />;
              }
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
          pre({ children }) { return <>{children}</>; },
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
const MessageBubble = memo(({ message, index, onCopy, onSpeak, onEdit, isSpeaking, copiedIndex }) => {
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
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${String(message.provider || '').toLowerCase().includes('groq')
              ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200/60 dark:border-orange-800/40'
              : 'bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border-sky-200/50 dark:border-sky-800/40'}`}>
              {String(message.provider || '').toLowerCase().includes('groq') ? 'Powered by Groq LPU' : message.model}
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
            <>
              <MarkdownContent content={message.content} />
              {message.streaming && <span aria-hidden="true" className="inline-block h-4 ml-0.5 align-middle border-r-2 border-sky-500 animate-pulse" />}
            </>
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

        {isUser && (
          <div className={`flex items-center px-1 transition-opacity duration-200 ${showActions ? 'opacity-100' : 'opacity-100 sm:opacity-0'}`}>
            <button
              onClick={() => onEdit(message.displayContent || message.content)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800/60 dark:hover:text-sky-400"
              title="Edit and resend this prompt"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>✏️ Edit Prompt</span>
            </button>
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
export const ChatInterface = ({ activeSession, onUpdateSession, onNewChat, onOpenVoiceAssistant }) => {
  const { currentUser, isPro, setIsUsageModalOpen, setIsPricingModalOpen, checkUsage, recordUsage } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [modelPreference, setModelPreference] = useState('auto');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState(() => new Map());
  const [isListening, setIsListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isSpeakingIndex, setIsSpeakingIndex] = useState(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showConnectorsModal, setShowConnectorsModal] = useState(false);
  const [connectorContext, setConnectorContext] = useState('');
  const [driveUploadStatus, setDriveUploadStatus] = useState('');
  const [driveUploadingFile, setDriveUploadingFile] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [queryTime, setQueryTime] = useState(null);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const preparedAttachmentDataRef = useRef(new Map());
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const speechRef = useRef(null);
  const sendingRef = useRef(false);
  const thinkingTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(thinkingTimerRef.current), []);

  useEffect(() => {
    let active = true;
    const refreshConnectorContext = () => {
      if (!active) return;
      const driveConnected = Boolean(driveAuth.currentUser);
      setConnectorContext([
        connectorManager.getActiveConnectorContext(driveConnected),
        getDriveSystemContext(driveConnected)
      ].join('\n\n'));
    };
    refreshConnectorContext();
    window.addEventListener('zulora-connectors-changed', refreshConnectorContext);
    const unsubscribe = onAuthStateChanged(driveAuth, refreshConnectorContext);
    return () => {
      active = false;
      window.removeEventListener('zulora-connectors-changed', refreshConnectorContext);
      unsubscribe();
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    const onFormResponses = event => {
      const responses = Array.isArray(event.detail?.responses) ? event.detail.responses : [];
      const formId = String(event.detail?.formId || '');
      const context = JSON.stringify(responses.slice(0, 20), null, 2).slice(0, 18_000);
      setInputPrompt(previous => [
        previous.trim(),
        `Please summarize these Google Forms responses${formId ? ` (form ${formId})` : ''}:\n\n${context}`
      ].filter(Boolean).join('\n\n'));
      setShowConnectorsModal(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener('zulora-form-responses', onFormResponses);
    return () => window.removeEventListener('zulora-form-responses', onFormResponses);
  }, []);

  useEffect(() => {
    const previews = new Map();
    attachments.forEach(file => {
      if (isImageAttachment(file)) previews.set(file, URL.createObjectURL(file));
    });
    setAttachmentPreviewUrls(previews);
    return () => previews.forEach(url => URL.revokeObjectURL(url));
  }, [attachments]);

  // Sync messages when activeSession changes
  useEffect(() => {
    if (Array.isArray(activeSession?.messages)) {
      setMessages(activeSession.messages.filter(message => message && typeof message === 'object'));
    } else {
      setMessages([]);
    }
  }, [activeSession?.id, activeSession?.messages]);

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
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }).catch(error => console.warn('Could not copy chat text:', error));
  }, []);

  const handleEditPrompt = useCallback(text => {
    const value = String(text || '');
    setInputPrompt(value);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(value.length, value.length);
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

  const addAttachments = useCallback(files => {
    const incoming = Array.from(files || []).filter(Boolean).map(normalizeAttachmentFile);
    setAttachments(previous => [...previous, ...incoming.slice(0, Math.max(0, 5 - previous.length))]);
  }, []);

  const handleUploadAttachment = useCallback(async file => {
    if (!driveAuth.currentUser) {
      setDriveUploadStatus('Connect Zulora Drive to upload this attachment.');
      setShowConnectorsModal(true);
      return;
    }
    setDriveUploadingFile(file.name);
    setDriveUploadStatus('');
    try {
      const saved = await uploadChatMediaToDrive(file, 'Chat Uploads');
      setDriveUploadStatus(`Uploaded ${saved.name} to Zulora Drive.`);
    } catch (error) {
      setDriveUploadStatus(error.message || 'Could not upload this file to Zulora Drive.');
    } finally {
      setDriveUploadingFile('');
    }
  }, []);

  const getAttachmentDataUrl = useCallback(file => {
    let pending = preparedAttachmentDataRef.current.get(file);
    if (!pending) {
      if (isPdfAttachment(file) && file.size > 3 * 1024 * 1024) {
        pending = Promise.reject(new Error('PDFs must be 3 MB or smaller to attach. Save a smaller copy and try again.'));
      } else {
        pending = isImageAttachment(file)
          ? imageFileToDataUrl(file, { maxDimension: 1536, maxBytes: 1_200_000 })
          : readFileAsDataUrl(file);
      }
      preparedAttachmentDataRef.current.set(file, pending);
      pending.catch(() => preparedAttachmentDataRef.current.delete(file));
    }
    return pending;
  }, []);

  const handleFileSelect = event => {
    const selectedFiles = Array.from(event.currentTarget.files || []).map(normalizeAttachmentFile)
      .slice(0, Math.max(0, 5 - attachments.length));
    try {
      addAttachments(selectedFiles);
      selectedFiles.filter(file => isImageAttachment(file) || isPdfAttachment(file)).forEach(file => {
        getAttachmentDataUrl(file).catch(error => console.warn('Could not prepare selected attachment:', error.message));
      });
    } finally {
      event.currentTarget.value = null;
    }
  };

  const handlePaste = useCallback(event => {
    const imageFiles = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean)
      .map((file, index) => new File([file], `clipboard-image-${Date.now()}-${index}.${file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'}`, { type: file.type }));
    if (!imageFiles.length) return;
    event.preventDefault();
    addAttachments(imageFiles);
  }, [addAttachments]);

  const handleDrop = useCallback(event => {
    event.preventDefault();
    addAttachments(event.dataTransfer?.files || []);
  }, [addAttachments]);

  const removeAttachment = (idx) => {
    if (attachments[idx]) preparedAttachmentDataRef.current.delete(attachments[idx]);
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const buildContextMessages = useCallback(() => {
    // Native Google connector results are handled directly by the connector
    // engine. Do not forward saved Gmail/Calendar/Sheets/Forms output to a
    // third-party model provider in a later chat turn.
    return messages
      .filter(message => message.provider !== 'Native API Connectors')
      .map(message => ({ role: message.role, content: message.content }));
  }, [messages]);

  const sendMessage = useCallback(async (promptOverride = null) => {
    const hasAttachments = attachments.length > 0;
    const basePrompt = String(promptOverride ?? inputPrompt).trim() || (hasAttachments ? 'Please analyze the attached image or document.' : '');
    if (!basePrompt || loading || sendingRef.current) return;

    const codeGenerationRequest = isCodeGenerationPrompt(basePrompt);
    const highTierCodeRequest = codeGenerationRequest && (modelPreference === 'think' || modelPreference === 'pro' || /-pro(?:-|$)/i.test(modelPreference));
    if (modelPreference === 'think' && !isPro && !codeGenerationRequest) {
      setIsPricingModalOpen(true);
      return;
    }
    sendingRef.current = true;
    let allowance;
    try {
      allowance = await checkUsage('chat', { skipTokenLimit: highTierCodeRequest });
    } catch (error) {
      sendingRef.current = false;
      console.warn('Could not check chat usage:', error.message);
      setIsUsageModalOpen(true);
      return;
    }
    if (!allowance.allowed) {
      sendingRef.current = false;
      return;
    }

    // Keep image data separate from prompt text; only text document contents are appended.
    let fullPrompt = basePrompt;
    let attachmentPayloads = [];
    try {
      const uploadDirectlyToDrive = /\b(?:zulora\s+)?drive\b/i.test(basePrompt)
        && /\b(upload|save|store|back\s*up)\b/i.test(basePrompt);
      if (!uploadDirectlyToDrive) {
        const imageFiles = attachments.filter(isImageAttachment);
        const pdfFiles = attachments.filter(isPdfAttachment);
        const textFiles = attachments.filter(file => !isImageAttachment(file) && !isPdfAttachment(file));
        attachmentPayloads = await Promise.all([...imageFiles, ...pdfFiles].map(async file => {
          if (isPdfAttachment(file) && file.size > 3 * 1024 * 1024) {
            throw new Error('PDFs must be 3 MB or smaller to attach. Save a smaller copy and try again.');
          }
          const base64 = await getAttachmentDataUrl(file);
          const mimeType = base64.match(/^data:([^;]+);base64,/)?.[1] || attachmentMimeType(file);
          return { name: file.name, mimeType, base64 };
        }));
        if (pdfFiles.length) {
          fullPrompt += `\n\nAttached PDF document${pdfFiles.length === 1 ? '' : 's'}: ${pdfFiles.map(file => file.name).join(', ')}. Use the document content to answer the user's question.`;
        }
        if (textFiles.length > 0) {
          const fileContents = await Promise.all(textFiles.map(async file => {
            const content = await apiRouter.readFileContent(file);
            return `\n\n**File: ${file.name}**\n\`\`\`\n${content}\n\`\`\``;
          }));
          fullPrompt = basePrompt + fileContents.join('');
        }
      }
    } catch (error) {
      sendingRef.current = false;
      alert(error.message || 'Could not read the attached file. Please choose another file.');
      return;
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
    const sessionId = activeSession?.id || `chat_${Date.now()}`;
    const firstUserPrompt = newMessages.find(message => message.role === 'user')?.displayContent || newMessages.find(message => message.role === 'user')?.content || basePrompt;
    const sessionTitle = activeSession?.title && !['Untitled Chat', 'New Chat'].includes(activeSession.title)
      ? activeSession.title
      : deriveChatTitle(firstUserPrompt);
    const pendingSession = {
      id: sessionId,
      title: sessionTitle,
      messages: newMessages,
      updatedAt: Date.now(),
      model: modelPreference,
      pending: true
    };
    setMessages(newMessages);
    setInputPrompt('');
    attachments.forEach(file => preparedAttachmentDataRef.current.delete(file));
    setAttachments([]);
    setLoading(true);
    setShowThinking(true);
    clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = setTimeout(() => setShowThinking(false), 7000);
    setIsAtBottom(true);
    setQueryTime(null);
    const startTime = Date.now();
    const assistantId = (Date.now() + 1).toString();
    let streamedText = '';
    let streamedProvider = null;

    try {
      // Save the user turn before inference so navigation or reloads do not lose it.
      if (currentUser?.uid) {
        onUpdateSession?.(pendingSession);
        await firestoreService.saveChatSession(currentUser.uid, sessionId, pendingSession);
        firestoreService.recordUserHistory(currentUser.uid, {
          type: enableWebSearch ? 'search' : 'prompt',
          prompt: basePrompt
        });
      }
      const contextMessages = buildContextMessages();
      const contextMemory = currentUser?.uid
        ? await firestoreService.getRecentActivityContext(currentUser.uid)
        : [];
      const aiBrain = currentUser?.uid
        ? await firestoreService.getAiBrain(currentUser.uid)
        : null;
      const userVault = currentUser?.uid
        ? await firestoreService.getVault(currentUser.uid)
        : null;
      const connectorTask = await executeConnectorTask(basePrompt, {
        onStatus: status => setShowThinking(Boolean(status))
      });
      const driveTask = connectorTask?.handled
        ? null
        : await executeDriveChatIntent(basePrompt, { files: attachments });
      const directTask = connectorTask?.handled
        ? connectorTask
        : driveTask?.handled && !driveTask.useLLM ? driveTask : null;
      const result = directTask
        ? {
          text: directTask.text,
          model: connectorTask?.handled ? 'Zulora Connectors' : 'Zulora Drive',
          provider: connectorTask?.handled ? 'Native API Connectors' : 'Zulora Drive Tools',
          connectorData: directTask.data,
          usage: { tracked: false, processedTokens: 0 },
          tokenUsage: { totalTokens: 0 }
        }
        : await apiRouter.generateChat(
        driveTask?.useLLM ? `${fullPrompt}\n\n${driveTask.context}` : fullPrompt,
        contextMessages,
        {
          model: modelPreference,
          webSearch: enableWebSearch,
          userId: currentUser?.uid,
          currentUser,
          contextMemory,
          aiBrain,
          userVault,
          connectorContext,
          attachments: [...attachmentPayloads, ...(driveTask?.attachments || [])],
          onToken: token => {
            if (!token) return;
            streamedText += token;
            clearTimeout(thinkingTimerRef.current);
            setShowThinking(false);
            setMessages([...newMessages, {
              id: assistantId,
              role: 'assistant',
              content: streamedText,
              timestamp: Date.now(),
              model: streamedProvider?.model || 'Generating…',
              provider: streamedProvider?.provider,
              streaming: true
            }]);
          },
          onProvider: route => {
            streamedProvider = route;
            if (!streamedText) return;
            setMessages([...newMessages, {
              id: assistantId,
              role: 'assistant',
              content: streamedText,
              timestamp: Date.now(),
              model: route.model || 'Generating…',
              provider: route.provider,
              streaming: true
            }]);
          },
          onReset: () => {
            streamedText = '';
            streamedProvider = null;
            clearTimeout(thinkingTimerRef.current);
            setShowThinking(true);
            thinkingTimerRef.current = setTimeout(() => setShowThinking(false), 7000);
            setMessages(newMessages);
          },
        }
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setQueryTime(elapsed);

      const aiMsg = {
        id: assistantId,
        role: 'assistant',
        content: result.text || streamedText || 'I encountered an issue generating a response. Please try again.',
        timestamp: Date.now(),
        model: result.model || 'Zulora AI',
        provider: result.provider,
        sources: result.sources || [],
        queryTime: elapsed,
      };

      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);
      const estimatedTokens = Math.max(512, Math.ceil((fullPrompt.length + String(result.text || '').length) / 4));
      const processedTokens = directTask
        ? 0
        : Number(result.tokenUsage?.totalTokens || result.usage?.processedTokens) || estimatedTokens;
      await recordUsage('chat', Boolean(result.usage?.tracked), processedTokens);
      if (currentUser?.uid) firestoreService.recordQueryContext(currentUser.uid, basePrompt, enableWebSearch ? 'search' : 'chat');
      const generatedCode = Array.from(String(result.text || '').matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g))
        .map(([, language, source]) => `\`\`\`${language.trim()}\n${source.replace(/\n$/, '')}\n\`\`\``)
        .join('\n\n');
      if (currentUser?.uid && generatedCode) {
        firestoreService.recordUserHistory(currentUser.uid, { type: 'code', prompt: basePrompt, code: generatedCode, model: result.model });
        firestoreService.saveGeneratedCodeProject(currentUser.uid, { prompt: basePrompt, code: generatedCode, model: result.model })
          .catch(error => console.warn('Generated chat code could not be saved to Studio projects:', error.message));
      }

      // Persist to Firestore
      const updatedSession = {
        id: sessionId,
        title: sessionTitle,
        messages: finalMessages,
        updatedAt: Date.now(),
        model: result.model,
        pending: false,
      };
      if (currentUser?.uid) {
        await firestoreService.saveChatSession(currentUser.uid, sessionId, updatedSession).catch(console.warn);
      }
      onUpdateSession?.(updatedSession);

    } catch (err) {
      const error = err && typeof err === 'object'
        ? err
        : new Error(String(err || 'Unknown error'));
      console.error('Chat error:', error);
      if (error.status === 429 || (error.payload?.upgradeRequired && error.payload?.usage?.blocked)) {
        setMessages(newMessages);
        setIsUsageModalOpen(true);
        return;
      }
      if (error.status === 403) {
        if (error.payload?.upgradeRequired) setIsPricingModalOpen(true);
        else setIsUsageModalOpen(true);
      }
      const errorMsg = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `⚠️ **Generation failed**: ${error.message || 'All AI providers unavailable. Please check your connection and try again.'}`,
        timestamp: Date.now(),
        model: 'Error',
      };
      if (streamedText) {
        errorMsg.content = `${streamedText}\n\n_Response interrupted: ${error.message || 'the connection ended before completion.'}_`;
      }
      const failedMessages = [...newMessages, errorMsg];
      setMessages(failedMessages);
      if (currentUser?.uid) {
        const failedSession = { ...pendingSession, messages: failedMessages, pending: false, updatedAt: Date.now() };
        await firestoreService.saveChatSession(currentUser.uid, sessionId, failedSession).catch(console.warn);
        onUpdateSession?.(failedSession);
      }
    } finally {
      clearTimeout(thinkingTimerRef.current);
      setShowThinking(false);
      setLoading(false);
      sendingRef.current = false;
    }
  }, [inputPrompt, loading, messages, modelPreference, enableWebSearch, attachments, currentUser, activeSession, buildContextMessages, getAttachmentDataUrl, isPro, checkUsage, recordUsage, setIsUsageModalOpen, setIsPricingModalOpen, onUpdateSession, connectorContext]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden relative">

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-6 scroll-smooth"
      >
        {messages.length === 0 ? (
          <WelcomeScreen user={{ displayName: currentUser?.displayName || 'Shiven' }} onSuggestion={(q) => sendMessage(q)} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id || i}
                message={msg}
                index={i}
                onCopy={handleCopy}
                onSpeak={handleSpeak}
                onEdit={handleEditPrompt}
                isSpeaking={isSpeakingIndex}
                copiedIndex={copiedIndex}
              />
            ))}
            {loading && showThinking && <TypingIndicator />}
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
      <div className={`shrink-0 border-t border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-[#070b14]/90 backdrop-blur-xl px-2.5 sm:px-4 md:px-6 pt-3 sm:py-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-4 ${showModelMenu ? 'relative z-[60]' : ''}`}>

        {/* Input Box */}
        <div
          onDrop={handleDrop}
          onDragOver={event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; }}
          className="glass-pearl dark:glass-dark rounded-2xl border border-slate-200/70 dark:border-slate-700/60 overflow-visible transition-all duration-200 focus-within:border-sky-400/50 dark:focus-within:border-sky-500/40 focus-within:shadow-[0_0_0_3px_rgba(14,165,233,0.1)]"
        >

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files">
              {driveUploadStatus && <div role="status" className="basis-full rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300">{driveUploadStatus}</div>}
              {attachments.map((file, i) => {
                const previewUrl = isImageAttachment(file) ? attachmentPreviewUrls.get(file) : null;
                return (
                  <div key={`${file.name}-${file.lastModified}-${i}`} className="group relative flex h-14 max-w-[16rem] items-center gap-2 overflow-hidden rounded-xl border border-sky-200/60 bg-sky-50/80 pr-16 text-xs text-sky-800 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300">
                    {previewUrl ? (
                      <img src={previewUrl} alt={`Preview of ${file.name}`} className="h-14 w-14 shrink-0 object-cover" />
                    ) : (
                      <span className="grid h-14 w-14 shrink-0 place-items-center bg-sky-100 dark:bg-sky-900/50"><Paperclip className="h-4 w-4" /></span>
                    )}
                    <span className="max-w-[7rem] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => handleUploadAttachment(file)}
                      disabled={Boolean(driveUploadingFile)}
                      aria-label={`Upload ${file.name} to Zulora Drive`}
                      title="Upload to Zulora Drive"
                      className="absolute right-8 top-1 grid h-6 w-6 place-items-center rounded-full bg-sky-700/90 text-white transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
                    >
                      {driveUploadingFile === file.name ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      aria-label={`Remove ${file.name}`}
                      title="Remove attachment"
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-900/70 text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Text Area */}
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask Zulora AI anything... (Shift+Enter for new line)"
            rows={1}
            disabled={loading}
            className="w-full bg-transparent px-4 pt-3.5 pb-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 resize-none outline-none leading-relaxed"
            style={{ maxHeight: '180px' }}
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-2 sm:px-3 pb-3 gap-1.5 sm:gap-2 min-w-0">
            {/* Left Tools */}
            <div className="flex items-center gap-1 min-w-0">
              {/* Model Selector */}
              <ModelSelector
                modelPreference={modelPreference}
                onModelChange={setModelPreference}
                isOpen={showModelMenu}
                onToggle={event => {
                  event.stopPropagation();
                  setShowModelMenu(value => !value);
                }}
                onClose={() => setShowModelMenu(false)}
              />

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

              <button
                type="button"
                onClick={() => setShowConnectorsModal(true)}
                className="flex min-h-9 items-center gap-1.5 rounded-lg border border-sky-200/70 bg-sky-50/70 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-950/60"
                title="Connect Gmail, Sheets, Calendar, Forms, or Zulora Drive"
                aria-label="Open Connectors"
              >
                <Link className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Connectors</span>
              </button>

              {/* Attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 border border-slate-200/60 dark:border-slate-700/50 transition-all"
                title="Attach file"
                aria-label="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30 border border-slate-200/60 dark:border-slate-700/50 transition-all"
                title="Take or choose a photo"
                aria-label="Take or choose a photo"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" style={{ display: 'none' }} onChange={handleFileSelect} accept="image/*,.pdf,.txt,.doc,.docx,.csv,.md,.json" />
              <input ref={cameraInputRef} type="file" className="hidden" style={{ display: 'none' }} onChange={handleFileSelect} accept="image/*" capture="environment" />

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

              {/* Gemini Live Voice Assistant Modal Trigger */}
              {onOpenVoiceAssistant && (
                <button
                  type="button"
                  onClick={onOpenVoiceAssistant}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-sky-300/60 dark:border-sky-700/60 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 hover:border-sky-400 transition-all shadow-sm"
                  title="Open Gemini Live Voice Assistant"
                >
                  <Radio className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
                  <span className="hidden xs:inline sm:inline text-xs font-semibold">Live</span>
                </button>
              )}
            </div>

            {/* Right: Send Button */}
            <button
              onClick={() => sendMessage()}
              disabled={(!inputPrompt.trim() && !attachments.length) || loading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                (inputPrompt.trim() || attachments.length > 0) && !loading
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
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
      )}
      {showConnectorsModal && <ConnectorsModal currentUser={currentUser} onClose={() => setShowConnectorsModal(false)} />}
    </div>
  );
};

export default ChatInterface;
