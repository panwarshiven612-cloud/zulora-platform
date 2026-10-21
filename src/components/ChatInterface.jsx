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
  ChevronDown,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { apiRouter } from '../services/apiRouter';
import connectorManager from '../services/connectorManager';
import { detectConnectorTask, executeConnectorTask } from '../services/backgroundConnectorEngine';
import { executeDriveChatIntent, getDriveSystemContext } from '../services/driveChatTools';
import { driveAuth } from '../config/firebaseDrive';
import { isCodeGenerationPrompt, isImageGenIntent } from '../services/aiModels';
import { firestoreService, deriveChatTitle } from '../services/firestoreService';
import { db } from '../services/firebase';
import { readFileAsDataUrl } from '../services/imageUtils';
import { uploadGeneratedAssetToDrive } from '../services/zuloraDriveService';
import { executeVideoAgent } from '../lib/agents/video';
import { isExplicitBrowserAutomationIntent } from '../services/browserAutomationIntent';
import { checkExtensionConnected, executeCommand } from '../services/browserAgentEngine';
import CodeArtifactRunner from './CodeArtifactRunner';
import ModelSelector from './ModelSelector';
import ChatInput from './chat/ChatInput';
import ConnectorsModal from './ConnectorsModal';
import GuestGateModal from './GuestGateModal';
import { guestGate } from '../services/guestGate';
import { backgroundTaskManager } from '../services/backgroundTaskManager';
import { runFullVideoPipeline } from '../services/videoEditAgent';
import { MotionArtifact, detectMotionArtifact } from './chat/MotionArtifact';

/* ============================================================
   CONSTANTS
   ============================================================ */
const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const CHAT_MODEL_PREFERENCE_KEY = 'zulora_chat_model_preference';
const readStoredModelPreference = key => {
  try { return localStorage.getItem(key) || ''; }
  catch { return ''; }
};
const ATTACHMENT_MIME_BY_EXTENSION = {
  bmp: 'image/bmp', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mpeg: 'video/mpeg', mpg: 'video/mpeg',
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
const getZuloraEngineLabel = (model = '', provider = '') => {
  const rawModel = String(model || '').trim();
  const value = `${rawModel} ${provider}`.toLowerCase().replace(/[_-]+/g, ' ');
  if (/instant reply/.test(value)) return 'Zulora Instant Reply';
  if (/selecting model|generating/.test(value) || !rawModel || rawModel.toLowerCase() === 'auto') return 'Selecting model';
  if (/^(?:pro|think)$/.test(rawModel.toLowerCase())) return 'Gemini 2.5 Pro';
  if (rawModel.toLowerCase() === 'groq') return 'Groq LPU';
  if (rawModel.toLowerCase() === 'cerebras') return 'Cerebras';
  if (rawModel.toLowerCase() === 'openrouter') return 'OpenRouter';
  if (rawModel.toLowerCase() === 'mistral') return 'Mistral AI';
  if (/zulora video engine/.test(value)) return 'Zulora Video Engine';
  if (/computer plugin|computer agent/.test(value)) return 'Computer Agent';
  if (/native api connectors|connector/.test(value)) return rawModel || 'Google Workspace Connector';

  const modelId = rawModel.toLowerCase();
  const cleanModelName = value => value.replace(/[-_]+/g, ' ')
    .replace(/\b(llama|flash|lite|pro|preview|versatile|instruct|small|latest|cerebras)\b/gi, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B');
  const prettyModel = modelId.startsWith('gemini-')
    ? `Gemini ${cleanModelName(modelId.slice('gemini-'.length))}`
    : cleanModelName(modelId.includes('/') ? modelId.split('/').at(-1) : modelId);

  if (/groq|llama/.test(value)) return `Groq LPU (${prettyModel || 'Llama model'})`;
  if (/cerebras/.test(value)) return `Cerebras (${prettyModel || 'Active model'})`;
  if (/openrouter/.test(value)) return `OpenRouter (${prettyModel || 'Active model'})`;
  if (/mistral/.test(value)) return `Mistral AI (${prettyModel || 'Active model'})`;
  if (/gemini/.test(value) || modelId.startsWith('gemini-')) return prettyModel;
  if (/pollinations/.test(value)) return `Pollinations AI (${prettyModel || 'Mistral'})`;
  if (/zulora resilient fallback|fallback cluster|system safe/.test(value)) return 'Zulora Fallback';
  return rawModel;
};
const estimateStreamTokenCount = text => {
  const trimmed = String(text || '').trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
};

// MODULE 2: In-chat media generation intent detection
const IMAGE_EDIT_REGEX = /\b(?:edit|modify|change|update|transform|enhance|improve|fix|crop|resize|adjust|remove|add)\s+(?:this\s+)?(?:image|photo|picture|background)\b/i;
const VIDEO_GEN_REGEX = /\b(?:generate|create|make|produce|render|animate|show me)\s+(?:a\s+)?(?:video|animation|clip|motion|reel|short|cinematic|film|movie|timelapse)\b/i;
const requestedVideoAspectRatio = prompt => {
  if (/\b(?:16\s*:\s*9|landscape|widescreen|horizontal)\b/i.test(prompt)) return '16:9';
  if (/\b(?:1\s*:\s*1|square)\b/i.test(prompt)) return '1:1';
  return '9:16';
};
const requestedVideoDuration = prompt => {
  const match = String(prompt || '').match(/\b(\d{1,2})\s*(?:seconds?|secs?|s)\b/i);
  return match ? Math.max(5, Math.min(60, Number(match[1]))) : 8;
};

const isImageEditIntent = (prompt, hasImageAttachment) => hasImageAttachment && IMAGE_EDIT_REGEX.test(String(prompt || ''));
const isVideoGenIntent = prompt => VIDEO_GEN_REGEX.test(String(prompt || ''));
const isVideoEditIntent = prompt => /\b(?:caption|subtitle|kinetic|motion graphics?|transcribe|edit|trim|crop|add text|overlay|remove audio|replace audio)\b/i.test(String(prompt || ''));
const MAX_INLINE_ATTACHMENT_BYTES = 2_700_000;
const safeChatError = error => {
  const message = String(error?.message || 'The response could not be completed. Please try again.');
  return /(?:Gemini|Groq|Cerebras|OpenRouter|Mistral|ElevenLabs|provider|HTTP\s*\d{3}|\b(?:401|403|408|425|429|500|503)\b|API key|rate.?limit|timeout|timed out|network|fetch failed|overloaded|generation failed)/i.test(message)
    ? 'The response could not be completed. Please try again.'
    : message;
};
const attachWebCitations = (content, sources = []) => {
  const text = String(content || '');
  const validSources = sources.filter(source => {
    try { return ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { return false; }
  }).slice(0, 8);
  if (!validSources.length) return text;
  const missing = validSources.filter(source => !text.includes(`](${new URL(source.url).href})`));
  if (!missing.length) return text;
  return `${text.trim()}\n\n**Sources**\n${missing.map(source => {
    const url = new URL(source.url).href;
    const title = String(source.title || new URL(url).hostname).replace(/[\[\]\\]/g, '').trim();
    return `- [${title || new URL(url).hostname}](${url})`;
  }).join('\n')}`;
};

const COMPLEX_CHAT_INTENT = /\b(?:research|deep dive|latest|recent news|source|citation|compare|benchmark|analy[sz]e|audit|architecture|implement|build|code|script|debug|step by step|multi[- ]step|workflow|automate|gmail|inbox|calendar|spreadsheet|google sheets|google drive|workspace|forms|send email|draft email|upload to drive|generate|create|render|animate|video|image|photo|picture|write me|plan)\b/i;
const isSimpleChatRequest = (prompt, { attachments = [], webSearch = false } = {}) => {
  const text = String(prompt || '').trim();
  if (!text || attachments.length || webSearch || text.length > 360 || isCodeGenerationPrompt(text)
    || isImageGenIntent(text) || isVideoGenIntent(text) || detectConnectorTask(text)
    || COMPLEX_CHAT_INTENT.test(text)) return false;
  return (text.match(/[.!?]+(?=\s|$)/g) || []).length <= 3;
};

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
      <div className="max-w-full overflow-x-auto scroll-smooth">
        <SyntaxHighlighter
          style={oneDark}
          language={language || 'text'}
          PreTag="div"
          customStyle={{
            margin: 0,
            minWidth: 'max-content',
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
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';

/* ============================================================
   MARKDOWN RENDERER
   ============================================================ */
const MarkdownContent = memo(({ content }) => {
  return (
    <div className="prose-chat min-w-0 max-w-full overflow-x-auto">
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
              <div className="table-responsive-wrapper my-3 w-full max-w-full min-w-0 overflow-x-auto scroll-smooth rounded-xl border border-slate-200/60 dark:border-slate-800">
                <table className="min-w-max w-full border-collapse text-sm">
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
          img({ src, alt, ...props }) {
            return (
              <div className="my-3.5 rounded-2xl overflow-hidden glass-pearl dark:glass-dark border border-slate-200/80 dark:border-slate-800/80 shadow-xl max-w-lg">
                <img
                  src={src}
                  alt={alt || 'Generated by Zulora AI'}
                  className="w-full h-auto object-cover rounded-t-2xl"
                  loading="lazy"
                  {...props}
                />
                <div className="px-4 py-2 bg-slate-900/90 backdrop-blur-md flex items-center justify-between text-xs text-slate-300 border-t border-slate-800">
                  <span className="font-semibold text-sky-400">Generated by Zulora AI</span>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-white transition-colors flex items-center gap-1 font-medium"
                    title="Open full image"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          },
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
const MessageBubble = memo(({ message, index, onCopy, onSpeak, onEdit, isSpeaking, copiedIndex, attachmentPreviews = [], onReconnect }) => {
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
      <div className={`flex flex-col min-w-0 max-w-[92%] sm:max-w-[80%] gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {isUser ? 'You' : 'Zulora AI'}
          </span>
          {message.connectorBadge && !isUser ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium border bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/40">
              {message.connectorBadge}
            </span>
          ) : message.model && !isUser && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${getZuloraEngineLabel(message.model, message.provider).startsWith('Groq LPU')
              ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200/60 dark:border-orange-800/40'
              : 'bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border-sky-200/50 dark:border-sky-800/40'}`}>
              {getZuloraEngineLabel(message.model, message.provider)}
            </span>
          )}
          {timestamp && (
            <span className="text-[10px] text-slate-400 dark:text-slate-600">{timestamp}</span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={`relative min-w-0 max-w-full overflow-hidden rounded-2xl px-4 py-3 shadow-sm transition-all duration-200
            ${isUser
              ? 'bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-tr-sm'
              : 'glass-pearl dark:glass-dark border border-white/60 dark:border-slate-700/60 rounded-tl-sm text-slate-800 dark:text-slate-200'
            }`}
        >
          {isUser ? (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.displayContent || message.content}</p>
              {attachmentPreviews.length > 0 && <div className="mt-3 grid max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {attachmentPreviews.map((attachment, attachmentIndex) => (
                  <div key={`${attachment.name}-${attachmentIndex}`} className="overflow-hidden rounded-xl border border-white/30 bg-slate-950/15">
                    {attachment.mimeType?.startsWith('image/') ? (
                      <a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Open ${attachment.name}`}>
                        <img src={attachment.url} alt={attachment.name} className="max-h-64 w-full object-contain" />
                      </a>
                    ) : attachment.mimeType?.startsWith('video/') ? (
                      <video src={attachment.url} controls preload="metadata" aria-label={attachment.name} className="max-h-64 w-full bg-black object-contain" />
                    ) : (
                      <a href={attachment.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white underline">
                        <Paperclip className="h-4 w-4 shrink-0" /><span className="truncate">{attachment.name}</span>
                      </a>
                    )}
                    <p className="truncate px-2 py-1 text-[10px] text-white/80">{attachment.name}</p>
                  </div>
                ))}
              </div>}
              {message.needsReconnect && <button type="button" onClick={onReconnect} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50/95 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-100">
                🔑 Please reconnect your Google Account to use Gmail/Calendar features.
              </button>}
            </>
          ) : (
            <>
              {message.thinkingSteps?.length > 0 && <details className="zulora-thinking-box mb-3 overflow-hidden rounded-xl border border-violet-200/70 bg-violet-50/70 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100 shadow-sm" open={Boolean(message.streaming || message.thinkingSteps.some(s => s.status === 'running'))}>
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>Response process ({message.thinkingSteps.filter(s => s.status === 'done').length}/{message.thinkingSteps.length} complete)</span>
                  </span>
                </summary>
                <div className="step-log space-y-1.5 border-t border-violet-200/60 px-3 py-2 dark:border-violet-900/50">
                  {message.thinkingSteps.map((step, stepIndex) => <div key={`${step.label}-${stepIndex}`} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span aria-hidden="true" className="mt-0.5 shrink-0">{step.status === 'done' ? '✅' : step.status === 'error' ? '⚠️' : '🔄'}</span>
                    <span className="min-w-0"><span className="font-semibold">Step {stepIndex + 1}: {step.label}</span>{step.status === 'done' ? <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-bold">[DONE]</span> : step.status === 'error' ? <span className="ml-1 text-rose-600 dark:text-rose-400 font-bold">[FAILED]</span> : <span className="ml-1 text-violet-600 dark:text-violet-400 font-medium">[IN PROGRESS]</span>}{step.detail && <span className="ml-1.5 text-slate-500 dark:text-slate-400">({step.detail})</span>}</span>
                  </div>)}
                </div>
              </details>}
              {(() => {
                const art = !message.streaming && message.role === 'assistant' ? detectMotionArtifact(message.content) : null;
                if (art && art.hasArtifact) return React.createElement(React.Fragment, null, React.createElement(MotionArtifact, { htmlCode: art.htmlCode, title: art.title }), React.createElement(MarkdownContent, { content: art.cleanedText }));
                return React.createElement(MarkdownContent, { content: message.content });
              })()}
              {message.emailDispatch?.success && <div role="status" className="mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-900 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-3.5 w-3.5" /></span>
                <span className="min-w-0"><span className="block text-xs font-bold">Email dispatched successfully</span><span className="mt-0.5 block break-all text-[11px]">To: {message.emailDispatch.to}</span>{message.emailDispatch.subject && <span className="mt-0.5 block text-[11px] text-emerald-800/80 dark:text-emerald-200/80">Subject: {message.emailDispatch.subject}</span>}</span>
              </div>}
              {message.connectorSuccess && !message.emailDispatch?.success && <div role="status" className="mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-900 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-3.5 w-3.5" /></span>
                <span className="text-xs font-bold">{String(message.connectorProvider || 'Workspace').replace(/^./, letter => letter.toUpperCase())} action completed successfully</span>
              </div>}
              {message.generatedVideoUrl && (
                <div className="mt-3 space-y-2">
                  <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-black dark:border-slate-800 shadow-md">
                    <video
                      src={message.generatedVideoUrl}
                      controls
                      autoPlay
                      loop
                      className="max-h-96 w-full rounded-xl object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={message.generatedVideoDownloadUrl || message.generatedVideoUrl}
                      download="zulora_video.mp4"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download MP4 (1080p)
                    </a>
                    <a
                      href={message.generatedVideoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-xs transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Full Screen
                    </a>
                  </div>
                  {Array.isArray(message.videoStoryboard?.scenes) && message.videoStoryboard.scenes.length > 0 && <details className="rounded-lg border border-slate-200/80 px-3 py-2 text-xs dark:border-slate-700/70">
                    <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">Storyboard · {message.videoStoryboard.totalDuration || message.videoStoryboard.scenes.at(-1)?.end || '?'}s</summary>
                    <ol className="mt-2 space-y-1.5 text-slate-500 dark:text-slate-400">
                      {message.videoStoryboard.scenes.map((scene, sceneIndex) => <li key={`${scene.id || sceneIndex}-${scene.start}`}>
                        <span className="font-semibold">{scene.start}–{scene.end}s</span> · {scene.caption || scene.text || scene.hero || 'Scene'}
                      </li>)}
                    </ol>
                  </details>}
                </div>
              )}
              {message.generatedImageUrl && (
                <div className="mt-3 space-y-2">
                  <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-md">
                    <img
                      src={message.generatedImageUrl}
                      alt="Generated"
                      className="max-h-96 w-full rounded-xl object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={message.generatedImageUrl}
                      download="zulora_image.png"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Image
                    </a>
                    <a
                      href={message.generatedImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-xs transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Full Resolution
                    </a>
                  </div>
                </div>
              )}
              {message.needsReconnect && <button type="button" onClick={onReconnect} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50/95 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-100">
                🔑 Please reconnect your Google Account to use connected features.
              </button>}
              {message.streaming && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-sky-200/50 bg-sky-50/50 px-2.5 py-1 text-[10px] font-semibold text-sky-600 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-400">
                  <span className="animate-pulse">⚡</span>
                  <span>Generating ({message.streamMetrics ? `~${message.streamMetrics.tokens} tokens | ~${message.streamMetrics.tokensPerSec} tokens/sec` : 'tokens...'})</span>
                  <span aria-hidden="true" className="inline-block h-3 ml-0.5 align-middle border-r-2 border-sky-500 animate-pulse" />
                </div>
              )}
            </>
          )}
        </div>
        {!isUser && message.sources?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {message.webSearched && <span className="basis-full px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Web Sources</span>}
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
          Hello, <span className="azure-gradient-text">{user?.displayName?.split(' ')[0] || 'Guest'}</span> {'\u{1F44B}'} How can Zulora AI help you today?
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base">Ask a question or choose a prompt to get started.</p>
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
export const ChatInterface = ({ activeSession, onUpdateSession, onNewChat, onOpenVoiceAssistant, pendingLibraryAsset, onLibraryAssetConsumed, guestMode = false, onNavigate }) => {
  const { currentUser, isPro, setIsUsageModalOpen, setIsPricingModalOpen, checkUsage, recordUsage } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [mediaAnalysisStatus, setMediaAnalysisStatus] = useState('');
  const [modelPreference, setModelPreference] = useState(() => readStoredModelPreference(`${CHAT_MODEL_PREFERENCE_KEY}_guest`));
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState(() => new Map());
  const [messageMedia, setMessageMedia] = useState(() => new Map());
  const [isListening, setIsListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isSpeakingIndex, setIsSpeakingIndex] = useState(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showConnectorsModal, setShowConnectorsModal] = useState(false);
  const [connectorReauthProvider, setConnectorReauthProvider] = useState('');
  const [connectorContext, setConnectorContext] = useState('');
  const [driveConnected, setDriveConnected] = useState(Boolean(driveAuth.currentUser));
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [queryTime, setQueryTime] = useState(null);
  const [showGuestUpgrade, setShowGuestUpgrade] = useState(false);
  const [guestUsage, setGuestUsage] = useState(() => guestGate.check());
  const [showMoreTools, setShowMoreTools] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const preparedAttachmentDataRef = useRef(new Map());
  const messagePreviewUrlsRef = useRef(new Set());
  const lastActiveSessionIdRef = useRef(activeSession?.id || '');
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const speechRef = useRef(null);
  const sendingRef = useRef(false);
  const thinkingTimerRef = useRef(null);
  const activeStreamCleanupsRef = useRef(new Set());
  const activeRequestsRef = useRef(new Map());
  const activeGenerationControllerRef = useRef(null);
  const chatMountedRef = useRef(true);
  // App-switch stream persistence: tracks page visibility without aborting active streams
  const isHiddenRef = useRef(false);
  const modelPreferenceKey = `${CHAT_MODEL_PREFERENCE_KEY}_${currentUser?.uid || 'guest'}`;
  const skipModelPreferenceWriteRef = useRef(false);

  useEffect(() => {
    skipModelPreferenceWriteRef.current = true;
    const stored = readStoredModelPreference(modelPreferenceKey) || readStoredModelPreference('zulora_chat_model_preference') || 'auto';
    const sessionModel = activeSession?.modelPreference || activeSession?.model;
    if (stored) {
      setModelPreference(stored);
      return;
    }
    if (typeof sessionModel === 'string' && sessionModel.trim() && sessionModel !== 'auto') {
      setModelPreference(sessionModel);
    } else {
      setModelPreference(stored || 'auto');
    }
  }, [activeSession?.id, modelPreferenceKey]);

  useEffect(() => {
    if (skipModelPreferenceWriteRef.current) {
      skipModelPreferenceWriteRef.current = false;
      return;
    }
    try {
      localStorage.setItem(modelPreferenceKey, modelPreference);
      localStorage.setItem('zulora_chat_model_preference', modelPreference);
    } catch { /* The selected model remains active for this chat session. */ }
  }, [modelPreference, modelPreferenceKey]);

  const handleModelPreferenceChange = useCallback(nextModel => {
    setModelPreference(nextModel);
    try {
      localStorage.setItem(modelPreferenceKey, nextModel);
      localStorage.setItem('zulora_chat_model_preference', nextModel);
    } catch { /* The selected model remains active for this chat session. */ }
    if (activeSession?.id) {
      onUpdateSession?.({ ...activeSession, model: nextModel, modelPreference: nextModel, updatedAt: Date.now() });
    }
  }, [activeSession, modelPreferenceKey, onUpdateSession]);

  const stopGeneration = useCallback(() => {
    const controller = activeGenerationControllerRef.current;
    if (!controller) return;
    controller.abort();
    activeGenerationControllerRef.current = null;
    sendingRef.current = false;
    setLoading(false);
    setShowThinking(false);
    setMediaAnalysisStatus('');
  }, []);

  useEffect(() => {
    chatMountedRef.current = true;
    return () => {
      chatMountedRef.current = false;
      clearTimeout(thinkingTimerRef.current);
      activeGenerationControllerRef.current?.abort();
      for (const cleanup of activeStreamCleanupsRef.current) cleanup();
      activeStreamCleanupsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshConnectorContext = () => {
      if (!active) return;
      const driveConnected = Boolean(driveAuth.currentUser);
      setDriveConnected(driveConnected);
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
    const nextSessionId = activeSession?.id || '';
    const previousSessionId = lastActiveSessionIdRef.current;
    if (previousSessionId !== nextSessionId && (previousSessionId || !nextSessionId)) {
      setMessageMedia(new Map());
      for (const url of messagePreviewUrlsRef.current) URL.revokeObjectURL(url);
      messagePreviewUrlsRef.current.clear();
    }
    lastActiveSessionIdRef.current = nextSessionId;
    const sessionIsProcessing = Array.from(activeRequestsRef.current.values()).includes(nextSessionId);
    setLoading(sessionIsProcessing);
    setShowThinking(sessionIsProcessing);
  }, [activeSession?.id]);

  useEffect(() => () => {
    for (const url of messagePreviewUrlsRef.current) URL.revokeObjectURL(url);
    messagePreviewUrlsRef.current.clear();
  }, []);

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
    const onReconnect = event => {
      setConnectorReauthProvider(String(event.detail?.provider || 'Google service'));
      setShowConnectorsModal(true);
    };
    window.addEventListener('zulora-connector-reauth-required', onReconnect);
    return () => window.removeEventListener('zulora-connector-reauth-required', onReconnect);
  }, []);

  useEffect(() => {
    const previews = new Map();
    attachments.forEach(file => {
      if (isImageAttachment(file) || attachmentMimeType(file).startsWith('video/')) previews.set(file, URL.createObjectURL(file));
    });
    setAttachmentPreviewUrls(previews);
    return () => previews.forEach(url => URL.revokeObjectURL(url));
  }, [attachments]);

  // Sync messages when activeSession changes
  useEffect(() => {
    if (Array.isArray(activeSession?.messages)) {
      const sessionIsLive = Array.from(activeRequestsRef.current.values()).includes(activeSession.id);
      setMessages(activeSession.messages
        .filter(message => message && typeof message === 'object')
        .map(message => message.streaming && !sessionIsLive
          ? { ...message, streaming: false, interrupted: true }
          : message));
    } else {
      setMessages([]);
    }
  }, [activeSession?.id, activeSession?.messages]);

  // App-switch stream persistence: track page visibility so we can suppress
  // spurious AbortError disconnects when the user backgrounds the browser tab
  useEffect(() => {
    const onVisibilityChange = () => { isHiddenRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

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

  const getAttachmentDataUrl = useCallback((file, signal) => {
    let pending = preparedAttachmentDataRef.current.get(file);
    if (!pending) {
      if (isPdfAttachment(file) && file.size > 3 * 1024 * 1024) {
        pending = Promise.reject(new Error('PDFs must be 3 MB or smaller to attach. Save a smaller copy and try again.'));
      } else {
        // Keep original image/video bytes; native multimodal input avoids
        // canvas resizing and frame extraction before the model request.
        pending = readFileAsDataUrl(file, signal);
      }
      preparedAttachmentDataRef.current.set(file, pending);
      pending.catch(() => preparedAttachmentDataRef.current.delete(file));
    }
    return pending;
  }, []);

  const addAttachments = useCallback(files => {
    const incoming = Array.from(files || []).filter(Boolean).map(normalizeAttachmentFile);
    setAttachments(previous => {
      const added = incoming.slice(0, Math.max(0, 5 - previous.length));
      added.forEach(file => {
        // Instant client-side Base64 conversion without waiting for send
        getAttachmentDataUrl(file).catch(() => {});
      });
      return [...previous, ...added];
    });
  }, [getAttachmentDataUrl]);

  useEffect(() => {
    if (!pendingLibraryAsset?.url) return undefined;
    let cancelled = false;
    const insertAsset = async () => {
      if (String(pendingLibraryAsset.type || '').startsWith('video/')) {
        setInputPrompt(previous => `${previous}${previous.trim() ? '\n\n' : ''}Use this video from my Zulora Library as context: ${pendingLibraryAsset.name || 'video'} (${pendingLibraryAsset.url})`);
        onLibraryAssetConsumed?.();
        return;
      }
      try {
        const response = await fetch(pendingLibraryAsset.url);
        if (!response.ok) throw new Error(`File request returned HTTP ${response.status}.`);
        const blob = await response.blob();
        const type = blob.type || pendingLibraryAsset.type || 'application/octet-stream';
        const name = pendingLibraryAsset.name || pendingLibraryAsset.fileName || 'library-file';
        const file = new File([blob], name, { type });
        if (cancelled) return;
        addAttachments([file]);
      } catch (error) {
        if (!cancelled) setInputPrompt(previous => `${previous}${previous.trim() ? '\n\n' : ''}Use this Zulora Library asset as context: ${pendingLibraryAsset.name || 'file'} (${pendingLibraryAsset.url})`);
        console.warn('Could not attach Library file bytes; added its link to the prompt instead:', error.message);
      } finally {
        if (!cancelled) onLibraryAssetConsumed?.();
      }
    };
    insertAsset();
    return () => { cancelled = true; };
  }, [pendingLibraryAsset, addAttachments, onLibraryAssetConsumed]);

  const handleFileSelect = event => {
    const selectedFiles = Array.from(event.currentTarget.files || []).map(normalizeAttachmentFile)
      .slice(0, Math.max(0, 5 - attachments.length));
    try {
      addAttachments(selectedFiles);
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
    const files = Array.from(event.dataTransfer?.files || []).map(normalizeAttachmentFile);
    addAttachments(files);
  }, [addAttachments]);

  const removeAttachment = (idx) => {
    if (attachments[idx]) {
      preparedAttachmentDataRef.current.delete(attachments[idx]);
    }
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
    if (sendingRef.current) return;
    const hasAttachments = attachments.length > 0;
    const basePrompt = String(promptOverride ?? inputPrompt).trim() || (hasAttachments ? 'Please analyze the attached image or document.' : '');
    if (!basePrompt) return;

    const codeGenerationRequest = isCodeGenerationPrompt(basePrompt);
    const simpleQuery = isSimpleChatRequest(basePrompt, { attachments, webSearch: enableWebSearch });
    const generationController = new AbortController();
    activeGenerationControllerRef.current = generationController;
    setMediaAnalysisStatus('');
    setLoading(true);
    const finishPreparation = () => {
      if (activeGenerationControllerRef.current === generationController) {
        activeGenerationControllerRef.current = null;
        setLoading(false);
        setMediaAnalysisStatus('');
        sendingRef.current = false;
      }
    };
    sendingRef.current = true;
    if (generationController.signal.aborted) { finishPreparation(); return; }

    // Read media on the client and send inline data to the model; user attachments are never auto-uploaded.
    let fullPrompt = basePrompt;
    let attachmentPayloads = [];
    try {
      const uploadDirectlyToDrive = /\b(?:zulora\s+)?drive\b/i.test(basePrompt)
        && /\b(upload|save|store|back\s*up)\b/i.test(basePrompt);
      if (!uploadDirectlyToDrive) {
        const imageFiles = attachments.filter(isImageAttachment);
        const pdfFiles = attachments.filter(isPdfAttachment);
        const videoFiles = attachments.filter(file => attachmentMimeType(file).startsWith('video/'));
        const textFiles = attachments.filter(file => !isImageAttachment(file) && !isPdfAttachment(file) && !attachmentMimeType(file).startsWith('video/'));
        const shouldRenderVideoEdit = videoFiles.length > 0 && isVideoEditIntent(basePrompt);
        const directVideoFiles = shouldRenderVideoEdit ? [] : videoFiles;
        if (imageFiles.some(file => !/^image\/(?:png|jpe?g|webp|gif|heic|heif)$/i.test(attachmentMimeType(file)))) {
          throw new Error('Direct image analysis supports PNG, JPEG, WebP, GIF, HEIC, and HEIF.');
        }
        const inlineFiles = [...imageFiles, ...pdfFiles, ...directVideoFiles];
        const inlineBytes = inlineFiles.reduce((total, file) => total + Number(file.size || 0), 0);
        if (inlineBytes > MAX_INLINE_ATTACHMENT_BYTES) {
          throw new Error('For direct in-chat analysis, keep attached images, videos, and PDFs under 2.7 MB total.');
        }
        const inlineAttachments = await Promise.all([...imageFiles, ...pdfFiles].map(async file => {
          if (isPdfAttachment(file) && file.size > 3 * 1024 * 1024) {
            throw new Error('PDFs must be 3 MB or smaller to attach. Save a smaller copy and try again.');
          }
          const base64 = await getAttachmentDataUrl(file, generationController.signal);
          const mimeType = base64.match(/^data:([^;]+);base64,/)?.[1] || attachmentMimeType(file);
          return { name: file.name, mimeType, base64 };
        }));
        const inlineVideos = await Promise.all(directVideoFiles.map(async file => ({
          name: file.name,
          mimeType: attachmentMimeType(file),
          base64: await getAttachmentDataUrl(file, generationController.signal)
        })));
        attachmentPayloads = [...inlineAttachments, ...inlineVideos];
        if (pdfFiles.length) {
          fullPrompt += `\n\nAttached PDF document${pdfFiles.length === 1 ? '' : 's'}: ${pdfFiles.map(file => file.name).join(', ')}. Use the document content to answer the user's question.`;
        }
        if (directVideoFiles.length) {
          fullPrompt += `\n\nThe original video file${directVideoFiles.length === 1 ? ' is' : 's are'} attached as native multimodal input. Analyze the video content directly.`;
        }
        if (textFiles.length > 0) {
          const fileContents = await Promise.all(textFiles.map(async file => {
            const content = await apiRouter.readFileContent(file);
            return `\n\n**File: ${file.name}**\n\`\`\`\n${content}\n\`\`\``;
          }));
          fullPrompt += fileContents.join('');
        }
      }
    } catch (error) {
      finishPreparation();
      setMediaAnalysisStatus('');
      if (generationController.signal.aborted) return;
      alert(error.message || 'Could not read the attached file. Please choose another file.');
      return;
    }
    if (generationController.signal.aborted) { finishPreparation(); return; }

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: fullPrompt,
      displayContent: basePrompt, // show original prompt in UI
      timestamp: Date.now(),
      attachments: attachments.map(f => f.name),
    };
    const messagePreviews = attachments.map(file => {
      const url = URL.createObjectURL(file);
      messagePreviewUrlsRef.current.add(url);
      return { name: file.name, mimeType: attachmentMimeType(file), url };
    });
    if (messagePreviews.length) setMessageMedia(previous => new Map(previous).set(userMsg.id, messagePreviews));

    const newMessages = [...messages, userMsg];
    const sessionId = activeSession?.id || `chat_${Date.now()}`;
    const isRequestCurrent = () => chatMountedRef.current && lastActiveSessionIdRef.current === sessionId;
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
      modelPreference,
      pending: true,
      generationState: 'generating'
    };
    const assistantId = `${Date.now() + 1}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestsRef.current.set(assistantId, sessionId);
    if (!activeSession?.id) lastActiveSessionIdRef.current = sessionId;
    onUpdateSession?.(pendingSession);
    let streamedText = '';
    let displayedText = '';
    let streamedProvider = null;
    let thinkingSteps = [];
    let hasLoggedFirstToken = false;
    let firstTokenAt = 0;
    let lastStreamSnapshotAt = 0;
    let streamSnapshotTimer = null;
    const shouldShowThinkingBox = !simpleQuery;
    const defaultModelLabel = getZuloraEngineLabel(modelPreference);
    const startTime = Date.now();
    const getLiveStreamMetrics = () => {
      const tokens = estimateStreamTokenCount(displayedText);
      const elapsedSeconds = firstTokenAt ? Math.max(0.1, (Date.now() - firstTokenAt) / 1000) : 0.1;
      return {
        tokens,
        tokensPerSec: (tokens / elapsedSeconds).toFixed(1),
        estimated: true
      };
    };
    const logMessage = (message, uploadedContext = '') => {
      if (!currentUser?.uid || !message?.id) return;
      firestoreService.logChatMessage(currentUser.uid, {
        sessionId,
        messageId: message.id,
        role: message.role,
        content: message.content,
        uploadedContext,
        attachments: attachments.map(file => ({ name: file.name, mimeType: attachmentMimeType(file), size: file.size })),
        model: message.model || modelPreference,
        provider: message.provider || '',
        timestamp: message.timestamp
      }).catch(error => console.warn('Chat message log could not be saved:', error.message));
    };
    const persistGenerationSnapshot = (force = false, generationState = 'generating') => {
      const now = Date.now();
      if (!force && now - lastStreamSnapshotAt < 1_200) {
        if (!streamSnapshotTimer) {
          streamSnapshotTimer = setTimeout(() => {
            streamSnapshotTimer = null;
            persistGenerationSnapshot(true, generationState);
          }, 1_200 - (now - lastStreamSnapshotAt));
        }
        return;
      }
      lastStreamSnapshotAt = now;
      const partial = displayedText.trim() ? {
        id: assistantId,
        role: 'assistant',
        content: displayedText,
        timestamp: now,
        model: streamedProvider?.model || defaultModelLabel,
        provider: streamedProvider?.provider || 'Zulora Intelligence',
        thinkingSteps: [...thinkingSteps],
        streaming: generationState === 'generating'
      } : null;
      const snapshot = {
        ...pendingSession,
        messages: [...newMessages.filter(message => message.id !== assistantId), ...(partial ? [partial] : [])],
        updatedAt: now,
        pending: generationState === 'generating',
        generationState
      };
      if (currentUser?.uid) firestoreService.saveChatSession(currentUser.uid, sessionId, snapshot).catch(error => console.warn('Active chat snapshot could not be saved:', error.message));
      if (chatMountedRef.current && lastActiveSessionIdRef.current === sessionId) onUpdateSession?.(snapshot);
    };
    logMessage(userMsg, fullPrompt.slice(basePrompt.length).trim());

    const publishAssistant = (streaming = true) => {
      if (!isRequestCurrent()) return;
      setMessages(previous => [
        ...previous.filter(message => message.id !== assistantId),
        {
          id: assistantId,
          role: 'assistant',
          content: displayedText,
          timestamp: Date.now(),
          model: streamedProvider?.model || defaultModelLabel,
          provider: streamedProvider?.provider || 'Zulora Intelligence',
          thinkingSteps: [...thinkingSteps],
          streaming,
          streamMetrics: getLiveStreamMetrics()
        }
      ]);
    };

    // Immediately display assistant typing indicator with selected model
    publishAssistant(true);
    const pushThinkingStep = (label, status = 'running', detail = '') => {
      if (!shouldShowThinkingBox || !label) return;
      const prior = thinkingSteps.at(-1);
      if (prior?.label === label && prior.status === status && prior.detail === detail) return;
      thinkingSteps = [
        ...thinkingSteps.map(step => step.status === 'running' ? { ...step, status: 'done' } : step),
        { label: String(label), status, detail: String(detail || '') }
      ].slice(-16);
      publishAssistant();
    };
    let renderFrameId = null;
    const publishStreamFrame = () => {
      try {
        if (!isRequestCurrent()) return;
        setMessages(previous => [
          ...previous.filter(message => message.id !== assistantId),
          {
            id: assistantId,
            role: 'assistant',
            content: displayedText,
            timestamp: Date.now(),
            model: streamedProvider?.model || 'Generating…',
            provider: streamedProvider?.provider,
            thinkingSteps: [...thinkingSteps],
            streaming: true,
            streamMetrics: getLiveStreamMetrics()
          }
        ]);
      } catch (err) {
        console.error("Error publishing stream frame:", err);
      }
    };
    const scheduleStreamRender = () => {
      if (renderFrameId) return;
      renderFrameId = requestAnimationFrame(() => {
        renderFrameId = null;
        publishStreamFrame();
      });
    };
    const flushStreamImmediately = () => {
      if (renderFrameId) {
        cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
      }
      publishStreamFrame();
    };
    const stopTypewriter = () => {
      if (renderFrameId) {
        cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
      }
      activeStreamCleanupsRef.current.delete(stopTypewriter);
    };
    const drainTypewriter = () => {
      clearTimeout(streamSnapshotTimer);
      streamSnapshotTimer = null;
      flushStreamImmediately();
      return Promise.resolve();
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
    pushThinkingStep('Preparing request');

    try {
      // Start persistence without making the model wait for Firestore.
      if (currentUser?.uid) {
        firestoreService.saveChatSession(currentUser.uid, sessionId, pendingSession)
          .catch(error => console.warn('Chat session save failed:', error.message));
        firestoreService.recordUserHistory(currentUser.uid, {
          type: enableWebSearch ? 'search' : 'prompt',
          prompt: basePrompt
        });
      }
      persistGenerationSnapshot(true);
      const contextMessages = buildContextMessages();
      const [contextMemory, aiBrain, userVault] = !simpleQuery && currentUser?.uid
        ? await Promise.all([
          firestoreService.getRecentActivityContext(currentUser.uid),
          firestoreService.getAiBrain(currentUser.uid),
          firestoreService.getVault(currentUser.uid)
        ])
        : [[], null, null];
      if (generationController.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      if (!simpleQuery) pushThinkingStep('Checking active connectors and request context', 'done');
      const detectedConnector = simpleQuery ? null : detectConnectorTask(basePrompt);
      const trackEmailAction = detectedConnector === 'gmail'
        && /\b(send|draft|compose)\b/i.test(basePrompt)
        && /\bto\s+[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(basePrompt)
        && /\bsubject\b/i.test(basePrompt)
        && /\b(body|message|saying)\b/i.test(basePrompt);
      let browserTask = null;
      if (!simpleQuery && isExplicitBrowserAutomationIntent(basePrompt) && !codeGenerationRequest) {
        if (!await checkExtensionConnected()) {
          browserTask = {
            handled: true,
            executed: false,
            provider: 'Computer Plugin',
            error: 'The Zulora Computer Plugin is not connected.',
            text: 'Computer action not completed: connect the Zulora Computer Plugin to run browser automation.'
          };
          pushThinkingStep('Computer Plugin is not connected', 'error');
        } else {
        const today = new Date().toISOString().slice(0, 10);
        const lastRunDate = localStorage.getItem('zulora_plugin_last_date');
        const priorRuns = lastRunDate === today ? Math.max(0, Number(localStorage.getItem('zulora_plugin_daily_count')) || 0) : 0;
        if (!isPro && priorRuns >= 10) {
          browserTask = { handled: true, text: 'The free Computer Plugin limit is 10 tasks per day. Your daily allowance resets tomorrow.' };
          pushThinkingStep('Checking Computer Plugin daily allowance', 'error', 'Daily free limit reached');
        } else {
          if (!isPro) {
            const nextRuns = priorRuns + 1;
            localStorage.setItem('zulora_plugin_last_date', today);
            localStorage.setItem('zulora_plugin_daily_count', String(nextRuns));
            if (currentUser?.uid) setDoc(doc(db, 'users', currentUser.uid), { dailyPluginUsage: { date: today, count: nextRuns, updatedAt: Date.now() } }, { merge: true }).catch(() => {});
          }
          pushThinkingStep('Connecting to the active Computer Plugin');
          let result;
          const automationTask = backgroundTaskManager.runTracked('automation', `Computer action: ${basePrompt.slice(0, 64)}`, async updateProgress => {
            updateProgress(5);
            const actionResult = await executeCommand(basePrompt, currentUser, entry => pushThinkingStep(entry.label, entry.status, entry.detail));
            updateProgress(100);
            return actionResult;
          });
          try { result = await automationTask.promise; }
          catch (error) { result = { ok: false, error: error.message || 'Computer action failed.' }; }
          browserTask = {
            handled: true,
            executed: result?.ok === true && result?.status === 'done',
            text: result?.ok || result?.success
              ? (result.text || result.message || 'The Computer Plugin completed the requested browser actions.')
              : `The Computer Plugin could not complete the browser action: ${result?.error || 'No completion response was received.'}`,
            data: result,
            provider: 'Computer Plugin'
          };
          pushThinkingStep('Browser automation finished', result?.ok || result?.success ? 'done' : 'error', result?.error || '');
        }
        }
      }
      const modelToolProvider = !simpleQuery && ['gmail', 'calendar', 'sheets', 'forms', 'drive'].includes(detectedConnector)
        && connectorManager.getActiveGoogleProviders().includes(detectedConnector);
      const executeNativeConnector = () => executeConnectorTask(basePrompt, {
        signal: generationController.signal,
        onStatus: status => {
          setShowThinking(Boolean(status));
          if (status) pushThinkingStep('Executing a connected service action');
        },
        onLog: entry => pushThinkingStep(entry.label, entry.status, entry.detail)
      });
      const connectorTask = simpleQuery || browserTask?.handled || modelToolProvider || detectedConnector === 'drive' ? null : trackEmailAction
        ? await backgroundTaskManager.runTracked('email', `Gmail action: ${basePrompt.slice(0, 64)}`, async updateProgress => {
          updateProgress(5);
          const result = await executeNativeConnector();
          updateProgress(100);
          return result;
        }).promise
        : await executeNativeConnector();
      const driveTask = simpleQuery || browserTask?.handled || connectorTask?.handled
        ? null
        : await executeDriveChatIntent(basePrompt, { files: attachments });
      const directTask = browserTask?.handled
        ? browserTask
        : connectorTask?.handled
        ? connectorTask
        : driveTask?.handled && !driveTask.useLLM ? driveTask : null;

      // MODULE 2: In-chat image/video generation & editing intercept
      const hasImageAttach = attachmentPayloads.some(p => p.mimeType?.startsWith('image/'));
      const videoAttachFile = attachments.find(file => attachmentMimeType(file).startsWith('video/'));
      const hasVideoAttach = Boolean(videoAttachFile) || attachmentPayloads.some(p => p.mimeType?.startsWith('video/'));
      const videoEditRequest = !directTask && hasVideoAttach && isVideoEditIntent(basePrompt);
      const imageGenRequest = !directTask && !videoEditRequest && (isImageGenIntent(basePrompt) || isImageEditIntent(basePrompt, hasImageAttach));
      const videoGenRequest = !directTask && !imageGenRequest && !videoEditRequest && isVideoGenIntent(basePrompt);

      if (guestMode && !currentUser?.uid && (imageGenRequest || videoGenRequest || videoEditRequest)) {
        setShowGuestUpgrade(true);
        return;
      }

      if (videoEditRequest && videoAttachFile) {
        pushThinkingStep('Probing video specifications (ffprobe)', 'running');
        try {
          const editedVideo = await runFullVideoPipeline(videoAttachFile, basePrompt, p => {
            pushThinkingStep(`${p.stage}: ${p.message || ''}`, p.stage === 'Done' ? 'done' : 'running', `${p.percent}%`);
          }, currentUser, generationController.signal);

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setQueryTime(elapsed);
          pushThinkingStep('Video editing complete! Saved to Drive', 'done', '100%');

          const aiMsg = {
            id: assistantId,
            role: 'assistant',
            content: `Here is your edited video with synced kinetic captions and motion graphics! 🎬\n\n* **Canvas:** 1080x1920 (9:16 Vertical Reel)\n* **Audio/Speech:** Synced Hinglish Roman script captions\n* **Status:** Saved to Zulora Drive & Media Library\n\nYou can play it directly, download using the button below, or ask to tweak fonts, colors, or pacing!`,
            timestamp: Date.now(),
            model: 'Zulora Video Studio',
            provider: 'Video Motion Engine',
            generatedVideoUrl: editedVideo.url,
            queryTime: elapsed,
            thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined
          };

          const finalMessages = [...newMessages.filter(message => message.id !== assistantId), aiMsg];
          logMessage(aiMsg);
          if (isRequestCurrent()) setMessages(previous => [...previous.filter(message => message.id !== assistantId), aiMsg]);
          await recordUsage('video', false, 0);
          if (currentUser?.uid) {
            await firestoreService.saveChatSession(currentUser.uid, sessionId, { id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' }).catch(console.warn);
          }
          if (isRequestCurrent()) onUpdateSession?.({ id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' });
          return;
        } catch (editErr) {
          pushThinkingStep('Video editing error', 'error', editErr.message);
          // fall through to LLM
        }
      }

      if (imageGenRequest) {
        pushThinkingStep('Generating image with AI 🎨', 'running');
        try {
          const referenceImage = attachmentPayloads.find(item => item.mimeType?.startsWith('image/'))?.base64 || null;
          const imgResult = await apiRouter.generateImage(basePrompt, { currentUser, referenceImage: hasImageAttach ? referenceImage : null, signal: generationController.signal });
          const imgUrl = imgResult?.url || imgResult?.imageUrl;
          if (!imgUrl) throw new Error('Image generation returned no downloadable image.');
          let assetNotice = '';
          if (currentUser?.uid) {
            await firestoreService.saveAsset(currentUser.uid, { type: 'image', url: imgUrl, prompt: basePrompt, provider: imgResult.provider || 'Zulora AI' })
              .catch(error => console.warn('Generated image could not be added to the Library:', error.message));
          }
          if (driveAuth.currentUser) {
            try {
              const driveFile = await uploadGeneratedAssetToDrive({ type: 'image', url: imgUrl, fileName: `zulora-image-${Date.now()}.png`, folderPath: 'Generated Media' });
              assetNotice = `\n\nSaved to your Zulora Library and Drive as ${driveFile.name || 'a generated image'}.`;
            } catch (error) {
              assetNotice = `\n\nAdded to your Zulora Library. Drive sync failed: ${error.message}`;
            }
          } else if (currentUser?.uid) assetNotice = '\n\nAdded to your Zulora Library.';
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setQueryTime(elapsed);
          pushThinkingStep('Image ready', 'done');
          const aiMsg = {
            id: assistantId, role: 'assistant',
            content: `Here's your AI-generated image! 🎨\n\n![${basePrompt}](${imgUrl})\n\n[📥 **Download File**](${imgUrl}) &nbsp;•&nbsp; [↗️ **Open Full Resolution**](${imgUrl})\n\n*Generated by Zulora AI*`,
            timestamp: Date.now(), model: 'Zulora Image AI',
            provider: 'Zulora AI',
            generatedImageUrl: imgUrl, queryTime: elapsed,
            thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined
          };
          aiMsg.content = `Here's your AI-generated image!\n\n*Generated by Zulora AI*`;
          aiMsg.content += assetNotice;
          const finalMessages = [...newMessages.filter(message => message.id !== assistantId), aiMsg];
          logMessage(aiMsg);
          if (isRequestCurrent()) setMessages(previous => [...previous.filter(message => message.id !== assistantId), aiMsg]);
          await recordUsage('image', false, 0);
          if (currentUser?.uid) {
            await firestoreService.saveChatSession(currentUser.uid, sessionId, { id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' }).catch(console.warn);
          }
          if (isRequestCurrent()) onUpdateSession?.({ id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' });
          return;
        } catch (imgErr) {
          if (generationController.signal.aborted) throw imgErr;
          pushThinkingStep('Image could not be generated', 'error', imgErr.message);
          // fall through to LLM
        }
      }

      if (videoGenRequest) {
        pushThinkingStep('Generating video with AI 🎬', 'running', '0%');
        try {
          let videoProgress = 3;
          const videoTask = backgroundTaskManager.runTracked('video', `Video generation: ${basePrompt.slice(0, 64)}`, async updateProgress => {
            const heartbeat = setInterval(() => {
              videoProgress = Math.min(91, videoProgress + 1);
              updateProgress(videoProgress);
              pushThinkingStep('Rendering video', 'running', `${videoProgress}%`);
            }, 1_500);
            try {
              return await executeVideoAgent(basePrompt, {
                currentUser,
                signal: generationController.signal,
                duration: requestedVideoDuration(basePrompt),
                aspectRatio: requestedVideoAspectRatio(basePrompt),
                onProgress: progress => {
                  const phase = String(progress?.phase || '').toLowerCase();
                  const phaseProgress = phase.includes('done') || phase.includes('ready') ? 100 : phase.includes('upload') ? 92 : phase.includes('render') ? 65 : phase.includes('generating') ? 35 : 6;
                  videoProgress = Math.max(videoProgress, Number(progress?.percent) || phaseProgress);
                  updateProgress(videoProgress);
                  pushThinkingStep('Rendering video frames', 'running', `${videoProgress}%`);
                }
              });
            } finally {
              clearInterval(heartbeat);
            }
          });
          const vidResult = await videoTask.promise;
          const vidUrl = vidResult?.url || vidResult?.videoUrl;
          if (!vidUrl) throw new Error('Video generation returned no playable MP4.');
          let assetNotice = '';
          if (currentUser?.uid) {
            await firestoreService.saveAsset(currentUser.uid, {
              type: 'video', url: vidUrl, prompt: basePrompt, provider: 'HTML Motion Renderer', model: 'Playwright + FFmpeg', fileType: 'video/mp4'
            }).catch(error => console.warn('Generated video could not be added to the Library:', error.message));
          }
          if (driveAuth.currentUser) {
            if (vidResult.driveFile) {
              assetNotice = `\n\nSaved to your Zulora Library and Drive as ${vidResult.driveFile.name || 'a generated video'}.`;
            } else {
              try {
                const driveFile = await uploadGeneratedAssetToDrive({ type: 'video', url: vidUrl, fileType: 'video/mp4', fileName: `zulora-video-${Date.now()}.mp4`, folderPath: 'Generated Media' }, { signal: generationController.signal });
                assetNotice = `\n\nSaved to your Zulora Library and Drive as ${driveFile.name || 'a generated video'}.`;
              } catch (error) {
                assetNotice = `\n\nAdded to your Zulora Library. Drive sync failed: ${error.message}`;
              }
            }
          } else if (currentUser?.uid) assetNotice = '\n\nAdded to your Zulora Library.';
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setQueryTime(elapsed);
          pushThinkingStep('Video ready', 'done', '100%');
          const aiMsg = {
            id: assistantId, role: 'assistant',
            content: `Here's your AI-generated video! 🎬\n\n*Zulora Video Engine*`,
            timestamp: Date.now(), model: 'Zulora Video Engine',
            provider: 'Zulora AI',
            generatedVideoUrl: vidUrl,
            generatedVideoDownloadUrl: vidResult.downloadUrl || vidUrl,
            videoStoryboard: vidResult.storyboard,
            queryTime: elapsed,
            thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined
          };
          aiMsg.content = `Here's your HTML-rendered AI video!\n\n[Download MP4](${vidUrl})${assetNotice}\n\n*Rendered with Playwright and FFmpeg.*`;
          const finalMessages = [...newMessages.filter(message => message.id !== assistantId), aiMsg];
          logMessage(aiMsg);
          if (isRequestCurrent()) setMessages(previous => [...previous.filter(message => message.id !== assistantId), aiMsg]);
          await recordUsage('video', false, 0);
          if (currentUser?.uid) {
            await firestoreService.saveChatSession(currentUser.uid, sessionId, { id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' }).catch(console.warn);
          }
          if (isRequestCurrent()) onUpdateSession?.({ id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: modelPreference, modelPreference, pending: false, generationState: 'complete' });
          return;
        } catch (vidErr) {
          if (generationController.signal.aborted) throw vidErr;
          pushThinkingStep('Video could not be generated', 'error', vidErr.message);
        }
      }

      pushThinkingStep(enableWebSearch ? 'Searching the web and grounding the answer' : 'Sending request to the model');
      const directResult = directTask ? {
          text: directTask.text,
          model: browserTask?.handled ? 'Computer Plugin' : connectorTask?.handled ? 'Zulora Connectors' : 'Zulora Drive',
          provider: browserTask?.handled ? 'Browser Automation' : connectorTask?.handled ? 'Native API Connectors' : 'Zulora Drive Tools',
          connectorData: directTask.data,
          emailDispatch: directTask.emailDispatch,
          connectorBadge: directTask.executed === true
            ? browserTask?.handled ? '💻 Computer Agent Plugin'
              : directTask.provider === 'gmail' ? '📧 Gmail Connector'
                : directTask.provider === 'calendar' ? '📅 Google Calendar Connector' : ''
            : '',
          usage: { tracked: false, processedTokens: 0 },
          tokenUsage: { totalTokens: 0 }
        } : null;
      let updateCodeTaskProgress = () => {};
      const generateModelResponse = () => apiRouter.generateChat(
        driveTask?.useLLM ? `${fullPrompt}\n\n${driveTask.context}` : fullPrompt,
        contextMessages,
        {
          model: modelPreference,
          modelPreference: modelPreference,
          webSearch: enableWebSearch,
          simpleQuery,
          signal: generationController.signal,
          userId: currentUser?.uid,
          currentUser,
          contextMemory,
          aiBrain,
          userVault,
          guestMode: Boolean(guestMode && !currentUser?.uid),
          connectorContext: simpleQuery ? '' : connectorContext,
          attachments: [...attachmentPayloads, ...(driveTask?.attachments || [])],
          onProgress: entry => pushThinkingStep(entry.label, entry.status, entry.detail),
          onToken: token => {
            if (!token) return;
            firstTokenAt ||= Date.now();
            streamedText += token;
            displayedText += token;
            persistGenerationSnapshot();
            updateCodeTaskProgress(Math.min(95, Math.max(5, Math.floor(streamedText.length / 100))));
            if (!isRequestCurrent()) return;
            scheduleStreamRender();
            if (!hasLoggedFirstToken) {
              hasLoggedFirstToken = true;
              pushThinkingStep('Streaming response at ultra-fast speed', 'running');
            }
            clearTimeout(thinkingTimerRef.current);
            setShowThinking(false);
          },
          onProvider: route => {
            streamedProvider = { provider: route?.provider || 'Zulora AI', model: route?.model || modelPreference };
            pushThinkingStep(`${getZuloraEngineLabel(streamedProvider.model, streamedProvider.provider)} connected`, 'done');
            if (!displayedText || !isRequestCurrent()) return;
            setMessages(prev => [
              ...prev.filter(m => m.id !== assistantId),
              {
                id: assistantId,
                role: 'assistant',
                content: displayedText,
                timestamp: Date.now(),
                model: route.model || 'Generating…',
                provider: route.provider,
                thinkingSteps: [...thinkingSteps],
                streaming: true,
                streamMetrics: getLiveStreamMetrics()
              }
            ]);
          },
          onReset: () => {
            streamedText = '';
            displayedText = '';
            streamedProvider = null;
            stopTypewriter();
            if (isRequestCurrent()) setMessages(previous => previous.filter(message => message.id !== assistantId));
            clearTimeout(thinkingTimerRef.current);
            if (isRequestCurrent()) {
              setShowThinking(true);
              thinkingTimerRef.current = setTimeout(() => setShowThinking(false), 7000);
            }
            pushThinkingStep('Retrying with the next available provider');
          },
        }
      );

      const result = directTask ? directResult : codeGenerationRequest
        ? await backgroundTaskManager.runTracked('code', `Code generation: ${basePrompt.slice(0, 64)}`, updateProgress => {
          updateCodeTaskProgress = updateProgress;
          updateCodeTaskProgress(2);
          return generateModelResponse();
        }).promise
        : trackEmailAction && modelToolProvider
        ? await backgroundTaskManager.runTracked('email', `Gmail action: ${basePrompt.slice(0, 64)}`, async updateProgress => {
          updateProgress(5);
          const response = await generateModelResponse();
          const emailAction = response?.connectorData?.find(item => /^(send_email|send_gmail|send_rich_email|reply_and_draft)$/.test(item?.name || ''));
          updateProgress(100);
          return response;
        }).promise
        : await generateModelResponse();
      await drainTypewriter();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setQueryTime(elapsed);
      pushThinkingStep('Request completed', 'done');
      thinkingSteps = thinkingSteps.map(step => step.status === 'running' ? { ...step, status: 'done' } : step);
      let rawResponseText = result.text || streamedText || 'I encountered an issue generating a response. Please try again.';

      const sentEmail = (result.connectorData || []).find(item =>
        item?.executionVerified === true
        && /^(?:gmail_send_email|send_email|send_gmail|send_rich_email)$/.test(item.name || '')
        && item.result?.verified === true
        && item.result?.id && item.result?.threadId
      );
      const emailDispatch = result.emailDispatch || (sentEmail ? {
        success: true,
        to: sentEmail.result.to || sentEmail.result.recipient || '',
        subject: sentEmail.result.subject || '',
        messageId: sentEmail.result.id,
        threadId: sentEmail.result.threadId
      } : null);
      const responseText = emailDispatch?.success
        ? `Email dispatched successfully to ${emailDispatch.to}.`
        : attachWebCitations(rawResponseText, result.sources || []);

      const aiMsg = {
        id: assistantId,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        model: directTask
          ? String(result.connectorProvider || '').toLowerCase().includes('computer') ? 'Zulora Computer Agent'
            : result.connectorProvider ? 'Zulora Connectors' : 'Zulora Drive'
          : result.model || streamedProvider?.model || modelPreference,
        provider: directTask ? 'Zulora AI' : result.provider || streamedProvider?.provider || 'Zulora AI',
        sources: result.sources || [],
        webSearched: Boolean(enableWebSearch),
        thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined,
        needsReconnect: Boolean(result.needsReconnect || directTask?.needsReconnect),
        connectorProvider: result.connectorProvider || directTask?.provider || '',
        queryTime: elapsed,
        // MODULE 2: Dynamic connector badge from real API execution
        connectorBadge: result.connectorBadge || '',
        connectorData: result.connectorData || [],
        emailDispatch: emailDispatch?.success ? emailDispatch : undefined,
        connectorSuccess: Boolean(directTask?.executed || (result.connectorData || []).some(item => item?.executionVerified === true && item.result?.verified === true)),
      };
      logMessage(aiMsg);

      if (!isRequestCurrent() && currentUser?.uid) {
        const backgroundSession = {
          id: sessionId,
          title: sessionTitle,
          messages: [...newMessages.filter(message => message.id !== assistantId), aiMsg],
          updatedAt: Date.now(),
          model: modelPreference,
          modelPreference,
          pending: false,
          generationState: 'complete'
        };
        firestoreService.saveChatSession(currentUser.uid, sessionId, backgroundSession).catch(console.warn);
      }

      setMessages(prev => {
        if (!isRequestCurrent()) return prev;
        const finalMessages = [...prev.filter(m => m.id !== assistantId), aiMsg];
        const updatedSession = {
          id: sessionId,
          title: sessionTitle,
          messages: finalMessages,
          updatedAt: Date.now(),
          model: modelPreference,
          modelPreference,
          pending: false,
          generationState: 'complete',
        };
        if (currentUser?.uid) {
          firestoreService.saveChatSession(currentUser.uid, sessionId, updatedSession).catch(console.warn);
        }
        onUpdateSession?.(updatedSession);
        return finalMessages;
      });

      const estimatedTokens = Math.max(512, Math.ceil((fullPrompt.length + String(result.text || '').length) / 4));
      const processedTokens = directTask
        ? 0
        : Number(result.tokenUsage?.totalTokens || result.usage?.processedTokens) || estimatedTokens;
      await recordUsage('chat', Boolean(result.usage?.tracked), processedTokens);
      if (guestMode && !currentUser?.uid) {
        const status = guestGate.consume();
        setGuestUsage(status);
        if (!status.allowed) setShowGuestUpgrade(true);
      }
      if (currentUser?.uid) firestoreService.recordQueryContext(currentUser.uid, basePrompt, enableWebSearch ? 'search' : 'chat');
      const generatedCode = Array.from(String(result.text || '').matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g))
        .map(([, language, source]) => `\`\`\`${language.trim()}\n${source.replace(/\n$/, '')}\n\`\`\``)
        .join('\n\n');
      if (currentUser?.uid && generatedCode) {
        firestoreService.recordUserHistory(currentUser.uid, { type: 'code', prompt: basePrompt, code: generatedCode, model: result.model });
        firestoreService.saveGeneratedCodeProject(currentUser.uid, { prompt: basePrompt, code: generatedCode, model: result.model })
          .catch(error => console.warn('Generated chat code could not be saved to Studio projects:', error.message));
      }

    } catch (err) {
      stopTypewriter();
      clearTimeout(streamSnapshotTimer);
      streamSnapshotTimer = null;
      const error = err && typeof err === 'object'
        ? err
        : new Error(String(err || 'Unknown error'));
      if (generationController.signal.aborted || error.name === 'AbortError') {
        const requestCanCommitStop = activeGenerationControllerRef.current === generationController
          || activeGenerationControllerRef.current === null;
        if (!requestCanCommitStop) return;
        // If page was backgrounded (app-switch) and abort came from network drop, silently discard
        if (isHiddenRef.current && displayedText) return;
        clearTimeout(streamSnapshotTimer);
        const partialText = displayedText || streamedText;
        const stoppedAssistant = partialText ? {
          id: assistantId,
          role: 'assistant',
          content: partialText,
          timestamp: Date.now(),
          model: streamedProvider?.model || defaultModelLabel,
          provider: streamedProvider?.provider || 'Zulora Intelligence',
          streaming: false,
          interrupted: true
        } : null;
        const stoppedMessages = [...newMessages.filter(message => message.id !== assistantId), ...(stoppedAssistant ? [stoppedAssistant] : [])];
        const stoppedSession = {
          ...pendingSession,
          messages: stoppedMessages,
          updatedAt: Date.now(),
          pending: false,
          generationState: 'stopped'
        };
        if (currentUser?.uid) firestoreService.saveChatSession(currentUser.uid, sessionId, stoppedSession).catch(console.warn);
        if (stoppedAssistant) logMessage(stoppedAssistant);
        if (isRequestCurrent()) {
          setMessages(stoppedMessages);
          onUpdateSession?.(stoppedSession);
        }
        return;
      }
      console.error('Chat error:', error);
      if (error.status === 429 || (error.payload?.upgradeRequired && error.payload?.usage?.blocked)) {
        const quotaSession = { ...pendingSession, messages: newMessages, pending: false, generationState: 'error', updatedAt: Date.now() };
        if (currentUser?.uid) firestoreService.saveChatSession(currentUser.uid, sessionId, quotaSession).catch(console.warn);
        if (isRequestCurrent()) onUpdateSession?.(quotaSession);
        if (isRequestCurrent()) setMessages(prev => prev.filter(m => m.id !== assistantId));
        if (guestMode && !currentUser?.uid) {
          setGuestUsage({ allowed: false, remaining: 0, count: guestGate.GUEST_LIMIT });
          setShowGuestUpgrade(true);
        }
        else setIsUsageModalOpen(true);
        return;
      }
      if (error.status === 403) {
        if (error.payload?.upgradeRequired) setIsPricingModalOpen(true);
        else setIsUsageModalOpen(true);
      }
      const userError = safeChatError(error);
      const errorMsg = {
        id: assistantId,
        role: 'assistant',
        content: `⚠️ **This response could not be completed**: ${userError}`,
        timestamp: Date.now(),
        model: 'Error',
        thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps.map(step => step.status === 'running' ? { ...step, status: 'done' } : step), { label: 'Request completed with warnings', status: 'done', detail: userError }] : undefined,
      };
      if (streamedText) {
        errorMsg.content = `${streamedText}\n\n_Response interrupted: ${userError}_`;
      }
      logMessage(errorMsg);
      const failedSession = {
        ...pendingSession,
        messages: [...newMessages.filter(message => message.id !== assistantId), errorMsg],
        pending: false,
        generationState: 'error',
        updatedAt: Date.now()
      };
      if (currentUser?.uid) firestoreService.saveChatSession(currentUser.uid, sessionId, failedSession).catch(console.warn);
      if (isRequestCurrent()) setMessages(prev => {
        const failedMessages = [...prev.filter(m => m.id !== assistantId), errorMsg];
        if (currentUser?.uid) {
          onUpdateSession?.(failedSession);
        }
        return failedMessages;
      });
    } finally {
      clearTimeout(thinkingTimerRef.current);
      clearTimeout(streamSnapshotTimer);
      setMediaAnalysisStatus('');
      activeRequestsRef.current.delete(assistantId);
      if (activeGenerationControllerRef.current === generationController) {
        activeGenerationControllerRef.current = null;
        const activeSessionId = lastActiveSessionIdRef.current;
        const sessionStillProcessing = Array.from(activeRequestsRef.current.values()).includes(activeSessionId);
        if (isRequestCurrent()) setShowThinking(sessionStillProcessing);
        setLoading(sessionStillProcessing);
        sendingRef.current = false;
      }
    }
  }, [inputPrompt, loading, messages, modelPreference, enableWebSearch, attachments, currentUser, activeSession, buildContextMessages, getAttachmentDataUrl, isPro, recordUsage, setIsUsageModalOpen, setIsPricingModalOpen, onUpdateSession, connectorContext]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden relative">

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 bg-white/55 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/25 sm:px-5">
        <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">Zulora AI Chat</p><p className="hidden text-[10px] text-slate-400 sm:block">{guestMode ? `${guestUsage.remaining} free demo questions remaining` : 'Native connectors and media tools are ready in this workspace'}</p></div>
      </header>

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-6 scroll-smooth"
      >
        {messages.length === 0 ? (
          <WelcomeScreen user={{ displayName: currentUser?.displayName || (guestMode ? 'Guest' : 'Shiven') }} onSuggestion={(q) => sendMessage(q)} />
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
                attachmentPreviews={messageMedia.get(msg.id) || []}
                onReconnect={() => {
                  setConnectorReauthProvider(msg.connectorProvider || 'Google service');
                  setShowConnectorsModal(true);
                }}
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
      <div className="chat-composer-wrapper shrink-0 border-t border-slate-200/70 bg-white/80 px-2.5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-[#070b14]/90 sm:px-4 sm:py-4 sm:pb-4 md:px-6">

        {/* Input Box */}
        <ChatInput
          inputPrompt={inputPrompt}
          setInputPrompt={setInputPrompt}
          onSendMessage={sendMessage}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          modelPreference={modelPreference}
          onModelChange={handleModelPreferenceChange}
          showModelMenu={showModelMenu}
          onToggleModelMenu={event => {
            event.stopPropagation();
            setShowModelMenu(value => !value);
          }}
          onCloseModelMenu={() => setShowModelMenu(false)}
          isListening={isListening}
          onToggleListening={toggleListening}
          onOpenVoiceAssistant={onOpenVoiceAssistant}
          fileInputRef={fileInputRef}
          cameraInputRef={cameraInputRef}
          onFileSelect={handleFileSelect}
          attachmentPreviewUrls={attachmentPreviewUrls}
          isSendDisabled={false}
          isGenerating={loading}
          onStopGeneration={stopGeneration}
          mediaAnalysisStatus={mediaAnalysisStatus}
          showMoreTools={showMoreTools}
          onToggleMoreTools={() => setShowMoreTools(value => !value)}
          enableWebSearch={enableWebSearch}
          onToggleWebSearch={() => setEnableWebSearch(value => !value)}
          onOpenConnectors={() => setShowConnectorsModal(true)}
        />

        {/* Disclaimer */}
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 mt-2">
          Zulora AI can make mistakes. Consider checking important information.
        </p>
      </div>

      {/* Click outside model menu */}
      {showModelMenu && (
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
      )}
      {showConnectorsModal && <ConnectorsModal currentUser={currentUser} reconnectProvider={connectorReauthProvider} onClose={() => { setShowConnectorsModal(false); setConnectorReauthProvider(''); }} />}
      {guestMode && showGuestUpgrade && <GuestGateModal
        onSignIn={() => { setShowGuestUpgrade(false); onNavigate?.('/login'); }}
        onClose={() => setShowGuestUpgrade(false)}
        reason="Sign in with Google to unlock unlimited access"
        limitReached={!guestUsage.allowed}
      />}
    </div>
  );
};

export default ChatInterface;
