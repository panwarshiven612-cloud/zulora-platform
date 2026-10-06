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
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { apiRouter } from '../services/apiRouter';
import connectorManager from '../services/connectorManager';
import { detectConnectorTask, executeConnectorTask } from '../services/backgroundConnectorEngine';
import { executeDriveChatIntent, getDriveSystemContext, uploadChatMediaToDrive } from '../services/driveChatTools';
import { driveAuth } from '../config/firebaseDrive';
import { isCodeGenerationPrompt, isImageGenIntent } from '../services/aiModels';
import { firestoreService, deriveChatTitle } from '../services/firestoreService';
import { db } from '../services/firebase';
import { imageFileToDataUrl, readFileAsDataUrl } from '../services/imageUtils';
import { checkExtensionConnected, executeCommand } from '../services/browserAgentEngine';
import CodeArtifactRunner from './CodeArtifactRunner';
import ModelSelector from './ModelSelector';
import ConnectorsModal from './ConnectorsModal';

/* ============================================================
   CONSTANTS
   ============================================================ */
const LOGO_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
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
const isComputerAutomationIntent = prompt => /\b(?:whatsapp|browser|webpage|website|tab|dom|button|input|text field|element|current page|web app)\b/i.test(String(prompt || ''))
  && /\b(?:open|navigate|go to|click|type|fill|send|message|search|select|press)\b/i.test(String(prompt || ''));

// MODULE 2: In-chat media generation intent detection
const IMAGE_EDIT_REGEX = /\b(?:edit|modify|change|update|transform|enhance|improve|fix|crop|resize|adjust|remove|add)\s+(?:this\s+)?(?:image|photo|picture|background)\b/i;
const VIDEO_GEN_REGEX = /\b(?:generate|create|make|produce|render|animate|show me)\s+(?:a\s+)?(?:video|animation|clip|motion|reel|short|cinematic|film|movie|timelapse)\b/i;

const isImageEditIntent = (prompt, hasImageAttachment) => hasImageAttachment && IMAGE_EDIT_REGEX.test(String(prompt || ''));
const isVideoGenIntent = prompt => VIDEO_GEN_REGEX.test(String(prompt || ''));
const attachWebCitations = (content, sources = []) => {
  const text = String(content || '');
  const validSources = sources.filter(source => {
    try { return ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { return false; }
  });
  if (!validSources.length) return text;
  const missing = validSources.filter(source => !text.includes(source.url));
  if (!missing.length) return text;
  return `${text.trim()}\n\n${missing.map(source => `Source: [${String(source.title || new URL(source.url).hostname).replace(/[\[\]]/g, '')}](${source.url})`).join('\n')}`;
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
              {message.thinkingSteps?.length > 0 && <details className="zulora-thinking-box mb-3 overflow-hidden rounded-xl border border-violet-200/70 bg-violet-50/70 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100" open={Boolean(message.streaming)}>
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold">🧠 Thinking / Executing Steps...</summary>
                <div className="step-log space-y-1.5 border-t border-violet-200/60 px-3 py-2 dark:border-violet-900/50">
                  {message.thinkingSteps.slice(-12).map((step, stepIndex) => <div key={`${step.label}-${stepIndex}`} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${step.status === 'done' ? 'bg-emerald-500' : step.status === 'error' ? 'bg-rose-500' : 'bg-violet-500 animate-pulse'}`} />
                    <span className="min-w-0"><span className="font-medium">Step {stepIndex + 1}: {step.label}</span>{step.detail && <span className="ml-1 text-violet-700/75 dark:text-violet-200/70">{step.detail}</span>}</span>
                  </div>)}
                </div>
              </details>}
              <MarkdownContent content={message.content} />
              {message.generatedVideoUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-black dark:border-slate-800 shadow-md">
                  <video
                    src={message.generatedVideoUrl}
                    controls
                    autoPlay
                    loop
                    className="max-h-96 w-full rounded-xl object-contain"
                  />
                </div>
              )}
              {message.needsReconnect && <button type="button" onClick={onReconnect} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50/95 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-100">
                🔑 Please reconnect your Google Account to use connected features.
              </button>}
              {message.streaming && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-sky-200/50 bg-sky-50/50 px-2.5 py-1 text-[10px] font-semibold text-sky-600 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-400">
                  <span className="animate-pulse">⚡</span>
                  <span>Generating... {message.streamMetrics ? `${message.streamMetrics.tokens} tokens written | ${message.streamMetrics.tokensPerSec} tokens/sec` : ''}</span>
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
export const ChatInterface = ({ activeSession, onUpdateSession, onNewChat, onOpenVoiceAssistant, pendingLibraryAsset, onLibraryAssetConsumed }) => {
  const { currentUser, isPro, setIsUsageModalOpen, setIsPricingModalOpen, checkUsage, recordUsage } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [modelPreference, setModelPreference] = useState('auto');
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
  const [driveUploadStatus, setDriveUploadStatus] = useState('');
  const [driveUploadingFile, setDriveUploadingFile] = useState('');
  const [driveConnected, setDriveConnected] = useState(Boolean(driveAuth.currentUser));
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [queryTime, setQueryTime] = useState(null);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const preparedAttachmentDataRef = useRef(new Map());
  const uploadedAttachmentFilesRef = useRef(new WeakSet());
  const messagePreviewUrlsRef = useRef(new Set());
  const lastActiveSessionIdRef = useRef(activeSession?.id || '');
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

  const handleUploadAttachment = useCallback(async (file, { promptConnect = false } = {}) => {
    if (!driveAuth.currentUser) {
      setDriveUploadStatus('Attachment is ready in chat. Connect Zulora Drive to sync it to your Library.');
      if (promptConnect) setShowConnectorsModal(true);
      return;
    }
    setDriveUploadingFile(file.name);
    setDriveUploadStatus('');
    try {
      const saved = await uploadChatMediaToDrive(file, 'Chat Uploads', {
        onProgress: progress => setDriveUploadStatus(progress.stage === 'saved'
          ? `Saving ${file.name} to Zulora Drive…`
          : `Uploading ${file.name} to Zulora Drive… ${progress.percent || 0}%`)
      });
      setDriveUploadStatus(`Uploaded ${saved.name} to Zulora Drive.`);
    } catch (error) {
      setDriveUploadStatus(error.message || 'Could not upload this file to Zulora Drive.');
    } finally {
    setDriveUploadingFile('');
    }
  }, []);

  useEffect(() => {
    if (!driveConnected) return;
    attachments.forEach(file => {
      if (uploadedAttachmentFilesRef.current.has(file)) return;
      uploadedAttachmentFilesRef.current.add(file);
      handleUploadAttachment(file).catch(() => uploadedAttachmentFilesRef.current.delete(file));
    });
  }, [attachments, driveConnected, handleUploadAttachment]);

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
      if (!driveAuth.currentUser && selectedFiles.length) setDriveUploadStatus('Attachment is ready in chat. Connect Zulora Drive to sync it to your Library.');
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
    const files = Array.from(event.dataTransfer?.files || []).map(normalizeAttachmentFile);
    addAttachments(files);
    if (!driveAuth.currentUser && files.length) setDriveUploadStatus('Dropped files are ready in chat. Connect Zulora Drive to sync them to your Library.');
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
    if (!basePrompt) return;

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
        const videoFiles = attachments.filter(file => attachmentMimeType(file).startsWith('video/'));
        const textFiles = attachments.filter(file => !isImageAttachment(file) && !isPdfAttachment(file) && !attachmentMimeType(file).startsWith('video/'));
        attachmentPayloads = await Promise.all([...imageFiles, ...pdfFiles, ...videoFiles].map(async file => {
          if (isPdfAttachment(file) && file.size > 3 * 1024 * 1024) {
            throw new Error('PDFs must be 3 MB or smaller to attach. Save a smaller copy and try again.');
          }
          if (attachmentMimeType(file).startsWith('video/') && file.size > 15 * 1024 * 1024) {
            throw new Error('Videos must be 15 MB or smaller to analyze in chat. The file is still available to upload to Zulora Drive.');
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
    const messagePreviews = attachments.map(file => {
      const url = URL.createObjectURL(file);
      messagePreviewUrlsRef.current.add(url);
      return { name: file.name, mimeType: attachmentMimeType(file), url };
    });
    if (messagePreviews.length) setMessageMedia(previous => new Map(previous).set(userMsg.id, messagePreviews));

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
    const assistantId = (Date.now() + 1).toString();
    let streamedText = '';
    let streamedProvider = null;
    let thinkingSteps = [];
    let hasLoggedFirstToken = false;
    const shouldShowThinkingBox = codeGenerationRequest || enableWebSearch || isComputerAutomationIntent(basePrompt)
      || /\b(?:gmail|email|calendar|meeting|sheets|spreadsheet|forms|drive|multi[- ]step|multi[- ]task|multiple actions|and then|after that|step by step|complex|analy[sz]e|architecture|execute|run code)\b/i.test(basePrompt);
    const publishAssistant = (streaming = true) => {
      if (!shouldShowThinkingBox) return;
      setMessages(previous => [
        ...previous.filter(message => message.id !== assistantId),
        { id: assistantId, role: 'assistant', content: streamedText, timestamp: Date.now(), model: streamedProvider?.model || 'Working…', provider: streamedProvider?.provider, thinkingSteps: [...thinkingSteps], streaming }
      ]);
    };
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
    pushThinkingStep('Preparing request');

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
      pushThinkingStep('Checking active connectors and request context', 'done');
      const detectedConnector = detectConnectorTask(basePrompt);
      let browserTask = null;
      if (isComputerAutomationIntent(basePrompt) && await checkExtensionConnected()) {
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
          const result = await executeCommand(basePrompt, currentUser, entry => pushThinkingStep(entry.label, entry.status, entry.detail));
          browserTask = {
            handled: true,
            text: result?.ok || result?.success
              ? (result.text || result.message || 'The Computer Plugin completed the requested browser actions.')
              : `The Computer Plugin could not complete the browser action: ${result?.error || 'No completion response was received.'}`,
            data: result,
            provider: 'Computer Plugin'
          };
          pushThinkingStep('Browser automation finished', result?.ok || result?.success ? 'done' : 'error', result?.error || '');
        }
      }
      const modelToolProvider = ['gmail', 'calendar', 'sheets', 'forms', 'drive'].includes(detectedConnector)
        && connectorManager.getActiveGoogleProviders().includes(detectedConnector);
      const connectorTask = browserTask?.handled || modelToolProvider || detectedConnector === 'drive' ? null : await executeConnectorTask(basePrompt, {
        onStatus: status => {
          setShowThinking(Boolean(status));
          if (status) pushThinkingStep('Executing a connected service action');
        },
        onLog: entry => pushThinkingStep(entry.label, entry.status, entry.detail)
      });
      const driveTask = browserTask?.handled || connectorTask?.handled
        ? null
        : await executeDriveChatIntent(basePrompt, { files: attachments });
      const directTask = browserTask?.handled
        ? browserTask
        : connectorTask?.handled
        ? connectorTask
        : driveTask?.handled && !driveTask.useLLM ? driveTask : null;

      // MODULE 2: In-chat image/video generation intercept
      const hasImageAttach = attachmentPayloads.some(p => p.mimeType?.startsWith('image/'));
      const imageGenRequest = !directTask && (isImageGenIntent(basePrompt) || isImageEditIntent(basePrompt, hasImageAttach));
      const videoGenRequest = !directTask && !imageGenRequest && isVideoGenIntent(basePrompt);

      if (imageGenRequest) {
        pushThinkingStep('Generating image with AI 🎨', 'running');
        try {
          const imgResult = await apiRouter.generateImage(basePrompt, { currentUser, referenceImage: hasImageAttach ? attachmentPayloads[0]?.base64 : null });
          const imgUrl = imgResult?.url || imgResult?.imageUrl;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setQueryTime(elapsed);
          pushThinkingStep('Image ready', 'done');
          const aiMsg = {
            id: assistantId, role: 'assistant',
            content: `Here's your AI-generated image! 🎨\n\n![AI Generated Image](${imgUrl})\n\n*Generated by Zulora AI*`,
            timestamp: Date.now(), model: 'Zulora Image AI',
            provider: 'Zulora AI',
            generatedImageUrl: imgUrl, queryTime: elapsed,
            thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined
          };
          const finalMessages = [...newMessages, aiMsg];
          setMessages(finalMessages);
          await recordUsage('image', false, 0);
          if (currentUser?.uid) {
            await firestoreService.saveChatSession(currentUser.uid, sessionId, { id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: aiMsg.model, pending: false }).catch(console.warn);
          }
          onUpdateSession?.({ id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: aiMsg.model, pending: false });
          return;
        } catch (imgErr) {
          pushThinkingStep('Image generation failed', 'error', imgErr.message);
          // fall through to LLM
        } finally {
          setLoading(false); sendingRef.current = false; setShowThinking(false);
        }
      }

      if (videoGenRequest) {
        pushThinkingStep('Generating video with AI 🎬', 'running', '0%');
        try {
          const vidResult = await apiRouter.generateVideo(basePrompt, {
            currentUser,
            onProgress: progress => {
              const pct = typeof progress?.percent === 'number' ? `${progress.percent}%` : (progress?.phase || 'Rendering frames');
              pushThinkingStep(progress?.provider || 'Generating video frames', 'running', pct);
            }
          });
          const vidUrl = vidResult?.url || vidResult?.videoUrl;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setQueryTime(elapsed);
          pushThinkingStep('Video ready', 'done', '100%');
          const aiMsg = {
            id: assistantId, role: 'assistant',
            content: `Here's your AI-generated video! 🎬\n\n*${vidResult?.provider || 'Zulora Video AI'}*`,
            timestamp: Date.now(), model: vidResult?.model || 'Video AI',
            provider: vidResult?.provider || 'Video Studio',
            generatedVideoUrl: vidUrl, queryTime: elapsed,
            thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined
          };
          const finalMessages = [...newMessages, aiMsg];
          setMessages(finalMessages);
          await recordUsage('video', false, 0);
          if (currentUser?.uid) {
            await firestoreService.saveChatSession(currentUser.uid, sessionId, { id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: aiMsg.model, pending: false }).catch(console.warn);
          }
          onUpdateSession?.({ id: sessionId, title: sessionTitle, messages: finalMessages, updatedAt: Date.now(), model: aiMsg.model, pending: false });
          return;
        } catch (vidErr) {
          pushThinkingStep('Video generation failed', 'error', vidErr.message);
        } finally {
          setLoading(false); sendingRef.current = false; setShowThinking(false);
        }
      }

      pushThinkingStep(enableWebSearch ? 'Searching the web and grounding the answer' : 'Sending request to the model');
      const result = directTask
        ? {
          text: directTask.text,
          model: browserTask?.handled ? 'Computer Plugin' : connectorTask?.handled ? 'Zulora Connectors' : 'Zulora Drive',
          provider: browserTask?.handled ? 'Browser Automation' : connectorTask?.handled ? 'Native API Connectors' : 'Zulora Drive Tools',
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
          onProgress: entry => pushThinkingStep(entry.label, entry.status, entry.detail),
          onToken: token => {
            if (!token) return;
            streamedText += token;
            if (!hasLoggedFirstToken) {
              hasLoggedFirstToken = true;
              pushThinkingStep('Receiving streamed response', 'running');
            }
            clearTimeout(thinkingTimerRef.current);
            setShowThinking(false);
            setMessages(prev => [
              ...prev.filter(m => m.id !== assistantId),
              {
                id: assistantId,
                role: 'assistant',
                content: streamedText,
                timestamp: Date.now(),
                model: streamedProvider?.model || 'Generating…',
                provider: streamedProvider?.provider,
                thinkingSteps: [...thinkingSteps],
                streaming: true,
                streamMetrics: {
                  tokens: Math.ceil(streamedText.length / 4),
                  tokensPerSec: (Math.ceil(streamedText.length / 4) / Math.max(0.1, (Date.now() - startTime) / 1000)).toFixed(1)
                }
              }
            ]);
          },
          onProvider: route => {
            streamedProvider = route;
            pushThinkingStep(`Connected to ${route.provider || 'model provider'}`, 'done');
            if (!streamedText) return;
            setMessages(prev => [
              ...prev.filter(m => m.id !== assistantId),
              {
                id: assistantId,
                role: 'assistant',
                content: streamedText,
                timestamp: Date.now(),
                model: route.model || 'Generating…',
                provider: route.provider,
                thinkingSteps: [...thinkingSteps],
                streaming: true,
                streamMetrics: {
                  tokens: Math.ceil(streamedText.length / 4),
                  tokensPerSec: (Math.ceil(streamedText.length / 4) / Math.max(0.1, (Date.now() - startTime) / 1000)).toFixed(1)
                }
              }
            ]);
          },
          onReset: () => {
            streamedText = '';
            streamedProvider = null;
            clearTimeout(thinkingTimerRef.current);
            setShowThinking(true);
            thinkingTimerRef.current = setTimeout(() => setShowThinking(false), 7000);
            pushThinkingStep('Retrying with the next available provider');
          },
        }
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setQueryTime(elapsed);
      pushThinkingStep('Response ready', 'done');
      const responseText = attachWebCitations(result.text || streamedText || 'I encountered an issue generating a response. Please try again.', result.sources || []);

      const aiMsg = {
        id: assistantId,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        model: result.model || 'Zulora AI',
        provider: result.provider,
        sources: result.sources || [],
        webSearched: Boolean(enableWebSearch),
        thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps] : undefined,
        needsReconnect: Boolean(result.needsReconnect || directTask?.needsReconnect),
        connectorProvider: result.connectorProvider || directTask?.provider || '',
        queryTime: elapsed,
      };

      setMessages(prev => {
        const finalMessages = [...prev.filter(m => m.id !== assistantId), aiMsg];
        const updatedSession = {
          id: sessionId,
          title: sessionTitle,
          messages: finalMessages,
          updatedAt: Date.now(),
          model: result.model,
          pending: false,
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
      const error = err && typeof err === 'object'
        ? err
        : new Error(String(err || 'Unknown error'));
      console.error('Chat error:', error);
      if (error.status === 429 || (error.payload?.upgradeRequired && error.payload?.usage?.blocked)) {
        setMessages(prev => prev.filter(m => m.id !== assistantId));
        setIsUsageModalOpen(true);
        return;
      }
      if (error.status === 403) {
        if (error.payload?.upgradeRequired) setIsPricingModalOpen(true);
        else setIsUsageModalOpen(true);
      }
      const errorMsg = {
        id: assistantId,
        role: 'assistant',
        content: `⚠️ **Generation failed**: ${error.message || 'All AI providers unavailable. Please check your connection and try again.'}`,
        timestamp: Date.now(),
        model: 'Error',
        thinkingSteps: shouldShowThinkingBox ? [...thinkingSteps.map(step => step.status === 'running' ? { ...step, status: 'done' } : step), { label: 'Request failed', status: 'error', detail: error.message || 'Provider error' }] : undefined,
      };
      if (streamedText) {
        errorMsg.content = `${streamedText}\n\n_Response interrupted: ${error.message || 'the connection ended before completion.'}_`;
      }
      setMessages(prev => {
        const failedMessages = [...prev.filter(m => m.id !== assistantId), errorMsg];
        if (currentUser?.uid) {
          const failedSession = { ...pendingSession, messages: failedMessages, pending: false, updatedAt: Date.now() };
          firestoreService.saveChatSession(currentUser.uid, sessionId, failedSession).catch(console.warn);
          onUpdateSession?.(failedSession);
        }
        return failedMessages;
      });
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

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 bg-white/55 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/25 sm:px-5">
        <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">Zulora AI Chat</p><p className="hidden text-[10px] text-slate-400 sm:block">Native connectors and media tools are ready in this workspace</p></div>
      </header>

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
                const previewUrl = attachmentPreviewUrls.get(file);
                return (
                  <div key={`${file.name}-${file.lastModified}-${i}`} className="group relative flex h-14 max-w-[16rem] items-center gap-2 overflow-hidden rounded-xl border border-sky-200/60 bg-sky-50/80 pr-16 text-xs text-sky-800 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300">
                    {previewUrl ? (
                      <img src={previewUrl} alt={`Preview of ${file.name}`} className="h-14 w-14 shrink-0 object-cover" />
                    ) : attachmentMimeType(file).startsWith('video/') && attachmentPreviewUrls.get(file) ? (
                      <video src={attachmentPreviewUrls.get(file)} muted playsInline preload="metadata" aria-label={`Preview of ${file.name}`} className="h-14 w-14 shrink-0 bg-black object-cover" />
                    ) : (
                      <span className="grid h-14 w-14 shrink-0 place-items-center bg-sky-100 dark:bg-sky-900/50"><Paperclip className="h-4 w-4" /></span>
                    )}
                    <span className="max-w-[7rem] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => handleUploadAttachment(file, { promptConnect: true })}
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
              <input ref={fileInputRef} type="file" multiple className="hidden" style={{ display: 'none' }} onChange={handleFileSelect} accept="image/*,video/*,.pdf,.txt,.doc,.docx,.csv,.md,.json" />
              <input ref={cameraInputRef} type="file" className="hidden" style={{ display: 'none' }} onChange={handleFileSelect} accept="image/*,video/*" />

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
              disabled={!inputPrompt.trim() && !attachments.length}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                (inputPrompt.trim() || attachments.length > 0)
                  ? 'azure-gradient-btn text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>

        {!attachments.length && (driveUploadingFile || driveUploadStatus) && <p role="status" className="mt-2 text-center text-[11px] text-sky-700 dark:text-sky-300">
          {driveUploadingFile ? `Syncing ${driveUploadingFile} to Zulora Drive…` : driveUploadStatus}
        </p>}

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
    </div>
  );
};

export default ChatInterface;
