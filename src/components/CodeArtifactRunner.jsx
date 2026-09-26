import React, { useMemo, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import { Check, Code2, Copy, Download, Eye, Maximize2, X } from 'lucide-react';

SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('css', css);

const LANGUAGE_CONFIG = {
  html: { highlighter: 'markup', filename: 'index.html' },
  css: { highlighter: 'css', filename: 'styles.css' },
  js: { highlighter: 'javascript', filename: 'script.js' },
  javascript: { highlighter: 'javascript', filename: 'script.js' },
  svg: { highlighter: 'markup', filename: 'graphic.svg' }
};

const CONTENT_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';">`;

function secureDocument(html) {
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${CONTENT_POLICY}`);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head>${CONTENT_POLICY}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${CONTENT_POLICY}</head><body>${html}</body></html>`;
}

function createPreview(code, language) {
  if (language === 'html') return secureDocument(code);
  if (language === 'svg') return secureDocument(code);
  if (language === 'css') {
    return secureDocument(`<!doctype html><html><head><meta charset="utf-8">${CONTENT_POLICY}<style>body{margin:0;min-height:100vh;padding:2rem;box-sizing:border-box;font:15px system-ui;background:#0b1120;color:#e2e8f0}.preview-sample{max-width:520px;margin:2rem auto;padding:2rem;border:1px solid #ffffff22;border-radius:24px;background:#ffffff0d;backdrop-filter:blur(18px)}${code}</style></head><body><main class="preview-sample"><h1>Style preview</h1><p>This sample shows the CSS from the code block.</p><button>Example action</button></main></body></html>`);
  }
  const safeScript = code.replace(/<\/script/gi, '<\\/script');
  return secureDocument(`<!doctype html><html><head><meta charset="utf-8">${CONTENT_POLICY}<style>body{margin:0;min-height:100vh;padding:2rem;box-sizing:border-box;font:15px system-ui;background:#0b1120;color:#e2e8f0}#app{max-width:720px;margin:auto;padding:2rem;border:1px solid #ffffff22;border-radius:24px;background:#ffffff0d}</style></head><body><main id="app"><h1>JavaScript preview</h1><p>Script output appears in this sandbox.</p></main><script>${safeScript}\n</script></body></html>`);
}

function CodeView({ code, language }) {
  return (
    <div className="max-h-[min(65vh,620px)] overflow-auto bg-[#0d1117]">
      <SyntaxHighlighter
        language={LANGUAGE_CONFIG[language]?.highlighter || 'markup'}
        style={oneDark}
        showLineNumbers
        wrapLongLines
        PreTag="div"
        customStyle={{ margin: 0, padding: '1rem 0', background: '#0d1117', fontSize: '0.8rem', lineHeight: '1.55' }}
        codeTagProps={{ style: { fontFamily: "'JetBrains Mono', monospace" } }}
        lineNumberStyle={{ minWidth: '3.25em', paddingRight: '1em', color: '#64748b', textAlign: 'right' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default function CodeArtifactRunner({ code, language = 'html' }) {
  const normalizedLanguage = String(language).toLowerCase();
  const [tab, setTab] = useState('preview');
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const srcDoc = useMemo(() => createPreview(code, normalizedLanguage), [code, normalizedLanguage]);
  const filename = LANGUAGE_CONFIG[normalizedLanguage]?.filename || 'artifact.html';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      const field = document.createElement('textarea');
      field.value = code;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { setCopied(document.execCommand('copy')); }
      catch { setCopied(false); }
      field.remove();
    }
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadCode = () => {
    const blob = new Blob([code], { type: normalizedLanguage === 'html' ? 'text/html' : normalizedLanguage === 'svg' ? 'image/svg+xml' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const preview = (expanded = false) => (
    <iframe
      title={`${normalizedLanguage.toUpperCase()} artifact preview`}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={`w-full border-0 bg-[#0b1120] ${expanded ? 'h-full min-h-[70vh]' : 'h-[360px] sm:h-[440px]'}`}
    />
  );

  return (
    <section className="my-4 overflow-hidden rounded-2xl border border-sky-200/70 bg-white/80 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-950/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-2.5 py-2 dark:border-slate-800 sm:px-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-900">
          <button type="button" onClick={() => setTab('preview')} aria-pressed={tab === 'preview'} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${tab === 'preview' ? 'bg-white text-sky-600 shadow-sm dark:bg-slate-800 dark:text-sky-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            <Eye className="h-3.5 w-3.5" /> {'\u{1F441}\uFE0F Live Preview'}
          </button>
          <button type="button" onClick={() => setTab('code')} aria-pressed={tab === 'code'} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${tab === 'code' ? 'bg-white text-sky-600 shadow-sm dark:bg-slate-800 dark:text-sky-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            <Code2 className="h-3.5 w-3.5" /> {'</> Code View'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={copyCode} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-400">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : '\u{1F4CB} Copy Code'}
          </button>
          <button type="button" onClick={downloadCode} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-400">
            <Download className="h-3.5 w-3.5" /> {'\u2B07\uFE0F Download File'}
          </button>
          <button type="button" onClick={() => setFullscreen(true)} disabled={tab !== 'preview'} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-400">
            <Maximize2 className="h-3.5 w-3.5" /> {'\u26F6 Fullscreen'}
          </button>
        </div>
      </div>
      {tab === 'preview' ? preview() : <CodeView code={code} language={normalizedLanguage} />}
      <div className="flex items-center justify-between border-t border-slate-200/80 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800">
        <span>{filename}</span><span>Sandboxed preview</span>
      </div>
      {fullscreen && (
        <div role="dialog" aria-modal="true" aria-label="Fullscreen artifact preview" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md sm:p-6">
          <div className="flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1120] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
              <span>{filename} · Live Preview</span>
              <button type="button" onClick={() => setFullscreen(false)} aria-label="Close fullscreen preview" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1">{preview(true)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
