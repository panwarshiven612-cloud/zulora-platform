import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Code2, Copy, Download, Eye, FileCode2,
  FolderOpen, Globe2, LoaderCircle, Maximize2, Menu, Mic, Monitor,
  Plus, RefreshCw, Settings2, Smartphone, Sparkles, Tablet,
  Trash2, Upload, WandSparkles, X
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuth } from '../context/AuthContext';
import UsageLimitsModal from '../components/UsageLimitsModal';
import PricingModal from '../components/PricingModal';
import apiRouter from '../services/apiRouter';
import { firestoreService } from '../services/firestoreService';
import { imageFileToDataUrl } from '../services/imageUtils';
import { preparePreviewDocument } from '../services/previewDocument';

const STAGES = ['Understanding request...', 'Planning interface...', 'Generating components...', 'Applying animations...', 'Finalizing website...'];
const readStudioModel = () => {
  const saved = localStorage.getItem('zulora_studio_model') || 'auto';
  if (saved === 'flash' || saved.startsWith('gemini-')) return 'gemini';
  return ['auto', 'gemini', 'groq', 'think'].includes(saved) ? saved : 'auto';
};
const TEMPLATES = [
  { name: 'Landing Page', icon: 'LP', color: 'from-cyan-500/30 to-blue-500/10', prompt: 'Create a complete, conversion-focused product landing page. Include an accessible responsive navigation bar, a memorable hero with a clear value proposition and two working calls to action, a product visual, social proof, benefits, feature cards, a short how-it-works section, pricing or a clear next step, FAQ accordions, and a substantial footer. Use specific, coherent sample copy without inventing real companies or customer claims. Build all interactions in vanilla JavaScript.' },
  { name: 'Portfolio', icon: 'P', color: 'from-violet-500/30 to-fuchsia-500/10', prompt: 'Build a premium personal portfolio for a multidisciplinary creative. Include responsive navigation, a dramatic but readable hero, selected project cards with category filters, about and skills sections, a clear process, contact form with validation and success feedback, and a complete footer. Keep identity details generic unless provided. Add keyboard-accessible interactions and purposeful motion.' },
  { name: 'SaaS', icon: 'S', color: 'from-cyan-500/30 to-blue-500/10', prompt: 'Create a modern SaaS product site with a clear product promise, dashboard-style hero visual, benefits, detailed feature grid, workflow steps, generic testimonial cards, transparent pricing comparison, FAQ accordions, and a strong signup call to action. Make navigation, FAQ, pricing toggle, and mobile menu functional.' },
  { name: 'E-commerce', icon: 'EC', color: 'from-amber-500/30 to-rose-500/10', prompt: 'Create an elegant online store homepage with featured products, category filters, product cards, cart interactions, and responsive navigation. Use neutral placeholder products without personal details.' },
  { name: 'Restaurant', icon: 'R', color: 'from-orange-500/30 to-pink-500/10', prompt: 'Build a stylish restaurant website with a warm hero, menu highlights, opening hours, location block, reservations call to action, and mobile-friendly layout. Use a generic restaurant identity.' },
  { name: 'Agency', icon: 'A', color: 'from-sky-500/30 to-indigo-500/10', prompt: 'Design a creative agency website with a large typographic hero, selected work, services, process, generic testimonials, and a strong contact call to action.' },
  { name: 'Dashboard', icon: 'D', color: 'from-emerald-500/30 to-teal-500/10', prompt: 'Design a polished analytics dashboard with an accessible collapsible sidebar, responsive mobile navigation, top search and profile controls, date-range selector, KPI cards with trends, a readable chart drawn in CSS or inline SVG, activity feed, table with useful empty/loading states, and a notifications panel. Use realistic generic sample data and make filters and navigation interactive.' }
];

function parseArtifact(source) {
  const blocks = [...String(source || '').matchAll(/```\s*([^\r\n]*)\r?\n([\s\S]*?)(?:```|$)/gi)];
  const files = { html: '', css: '', js: '', svg: '' };
  const generatedFiles = {};
  blocks.forEach(([, label, code]) => {
    const parts = label.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const language = parts[0] || '';
    const key = ({ htm: 'html', javascript: 'js', mjs: 'js', typescript: 'js', jsx: 'js', tsx: 'js', xml: 'svg' })[language] || language;
    const namedFile = parts.find(part => /^[a-z0-9_./-]+\.[a-z0-9]+$/i.test(part));
    const defaultNames = { html: 'index.html', css: 'styles.css', js: 'app.js', svg: 'graphic.svg', json: 'package.json', sql: 'schema.sql', python: 'app.py', bash: 'run.sh', yaml: 'config.yml' };
    const fileName = namedFile || defaultNames[key];
    if (fileName) generatedFiles[fileName] = code.trim();
    if (key in files && !files[key]) files[key] = code.trim();
  });
  if (!files.html && !files.svg) {
    const rawHtml = String(source || '').match(/<!doctype html[\s\S]*|<html[\s\S]*/i)?.[0];
    if (rawHtml) files.html = rawHtml.replace(/```\s*$/, '').trim();
  }
  if (files.html && !files.css) files.css = [...files.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim()).join('\n\n');
  if (files.html && !files.js) files.js = [...files.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1].trim()).filter(Boolean).join('\n\n');
  if (files.svg && !files.html) files.html = files.svg;
  let html = files.html || '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Preview is ready</h1><p>The response did not include an HTML document. Review the generated files in Code.</p></main></body></html>';
  if (files.css && !/<style[\s>]/i.test(html)) {
    const style = `<style>\n${files.css}\n</style>`;
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`)
      : /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, `$&${style}`)
        : html.replace(/<\/html>/i, `${style}</html>`);
  }
  if (files.js && !/<script[\s>]/i.test(html)) {
    const script = `<script>\n${files.js}\n<\/script>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`)
      : /<\/html>/i.test(html) ? html.replace(/<\/html>/i, `${script}</html>`) : `${html}${script}`;
  }
  if (!/<html[\s>]/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  return { ...files, generatedFiles, html };
}

function downloadHtml(html, name = 'index.html') {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function StudioModal({ title, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className={`relative max-h-[88vh] w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} overflow-auto rounded-3xl border border-white/10 bg-[#101421] p-5 text-white shadow-2xl sm:p-7`}>
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}

export default function AIStudio({ onExitDashboard }) {
  const { currentUser, tier, isUsageModalOpen, setIsUsageModalOpen, isPricingModalOpen, setIsPricingModalOpen, refreshProfile, recordUsage } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentText, setAttachmentText] = useState('');
  const [artifact, setArtifact] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stage, setStage] = useState(-1);
  const [artifactTab, setArtifactTab] = useState('preview');
  const [codeTab, setCodeTab] = useState('html');
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [viewport, setViewport] = useState('desktop');
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectView, setProjectView] = useState('all');
  const [toast, setToast] = useState('');
  const [preferredModel, setPreferredModel] = useState(readStudioModel);
  const [appearance, setAppearance] = useState(() => localStorage.getItem('zulora_studio_appearance') || 'dark');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);
  const promptRef = useRef(null);
  const streamRef = useRef('');
  const streamTimerRef = useRef(null);
  const restoredUidRef = useRef('');

  const currentHtml = artifact?.html || '<!doctype html><html><body style="margin:0;background:#0b1020;color:#e2e8f0;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="text-align:center"><div style="font-size:36px">✦</div><h2>Your live preview appears here</h2><p>Describe the site you want to build.</p></main></body></html>';
  const previewHtml = useMemo(() => preparePreviewDocument(currentHtml), [currentHtml]);
  const activeCode = artifact?.[codeTab] || (codeTab === 'html' ? artifact?.html : '') || '';
  const viewportWidth = viewport === 'mobile' ? '390px' : viewport === 'tablet' ? '768px' : '100%';
  const fileName = useMemo(() => `${(artifact?.title || 'index').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'index'}.html`, [artifact?.title]);

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  const loadProjects = useCallback(async () => {
    if (!currentUser?.uid) return;
    setProjects(await firestoreService.getCodeProjects(currentUser.uid));
  }, [currentUser?.uid]);
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || restoredUidRef.current === uid) return undefined;
    let active = true;
    restoredUidRef.current = uid;
    const restoreWorkspace = async () => {
      const savedProjects = await firestoreService.getCodeProjects(uid);
      if (!active) return;
      setProjects(savedProjects);
      const savedActive = firestoreService.getActiveCodeProject(uid);
      const project = savedActive || savedProjects.find(item => item.kind !== 'search');
      if (!project) return;
      const parsed = parseArtifact(project.html || project.code || project.svg || '');
      setArtifact({ ...parsed, ...project, html: project.html || parsed.html, title: project.title || 'Saved project' });
      setPrompt(project.prompt || '');
      setProjectId(project.id || null);
      setMessages(project.prompt
        ? [{ role: 'user', text: project.prompt }, { role: 'assistant', text: project.code || 'Saved website project restored.' }]
        : []);
    };
    restoreWorkspace().catch(error => console.warn('Could not restore the previous Studio session:', error.message));
    return () => { active = false; };
  }, [currentUser?.uid]);
  useEffect(() => { localStorage.setItem('zulora_studio_model', preferredModel); }, [preferredModel]);
  useEffect(() => { localStorage.setItem('zulora_studio_appearance', appearance); }, [appearance]);

  useEffect(() => {
    if (!isGenerating) { setStage(-1); return undefined; }
    setStage(0);
    const timers = [1200, 3100, 6400, 9400].map((delay, index) => window.setTimeout(() => setStage(index + 1), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [isGenerating]);

  const addFile = async file => {
    if (!file) return;
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      try { setAttachmentText(await imageFileToDataUrl(file, { maxDimension: 1536, maxBytes: 1_200_000 })); }
      catch { showToast('Could not read that image.'); }
    } else {
      try { setAttachmentText(String(await apiRouter.readFileContent(file)).slice(0, 35_000)); }
      catch { setAttachmentText(''); showToast('This file type could not be read.'); }
    }
  };

  const runBuild = useCallback(async (overridePrompt = '') => {
    const request = String(overridePrompt || prompt).trim();
    if (!request || isGenerating) return;
    setPrompt(request);
    setIsGenerating(true);
    setStage(0);
    streamRef.current = '';
    setMessages(previous => [...previous, { role: 'user', text: request }, { role: 'assistant', text: '', streaming: true }]);
    firestoreService.recordCodeSearch(currentUser?.uid, request, preferredModel)
      .catch(error => console.warn('Code workspace search could not be saved:', error.message));
    firestoreService.recordUserHistory(currentUser?.uid, { type: 'search', prompt: request, preference: preferredModel });
    try {
      const [contextMemory, userVault, aiBrain] = currentUser?.uid ? await Promise.all([
        firestoreService.getRecentActivityContext(currentUser.uid, 8),
        firestoreService.getVault(currentUser.uid),
        firestoreService.getAiBrain(currentUser.uid)
      ]) : [[], null, null];
      const inputAttachment = attachment?.type?.startsWith('image/') && attachmentText
        ? [{ name: attachment.name, mimeType: attachment.type, base64: attachmentText }]
        : [];
      const attachedText = attachment && !attachment.type.startsWith('image/') && attachmentText
        ? `\n\nAttached file (${attachment.name}):\n\n${attachmentText}` : '';
      const fullPrompt = `Build a polished, production-ready website matching the user's request. Return exactly one complete, self-contained index.html document with all CSS inside a <style> tag and all JavaScript inside a <script> tag. Do not split the website into separate files or require a build step. Use the Tailwind CDN when useful, plus vanilla JavaScript; Font Awesome or Lucide, Animate.css, and GSAP are available in the sandboxed preview. Return the whole document without Markdown fences. The entire document must render by itself in a browser preview and be ready to download.\n\nVISUAL DIRECTION\n- Use a refined Pearl & Azure palette over a sophisticated dark-mode foundation: deep ink and midnight navy surfaces, pearl-white typography and highlights, and luminous azure/cyan accents.\n- Build clear visual hierarchy with generous spacing, polished typography, translucent glass panels, soft borders, layered shadows, and tasteful gradients.\n- Add subtle interactive hover, focus, and pressed-state animations. Make navigation and every visible control functional, with useful form validation and complete interaction behavior.\n- Create a smoothly animated background using lightweight CSS gradients, shapes, or canvas. Keep it low-contrast behind content and provide a prefers-reduced-motion fallback.\n- Add a restrained letter-by-letter or GSAP reveal for the main heading. Honor prefers-reduced-motion and keep all content readable before animation.\n- When the request is in Urdu or Arabic, set the document language, add dir="rtl" on the root element, and preserve left-to-right rendering for code, URLs, and Latin numbers. Always include UTF-8 metadata.\n- Make every section fully responsive from narrow phones to wide desktop screens. Use semantic HTML, accessible labels, visible keyboard focus, and readable contrast.\n- Prefer self-contained CSS, inline SVG, and canvas drawing over network assets so the preview works offline.\n\nIMPLEMENTATION QUALITY\nUse clean, modular JavaScript functions inside the document, validate user input, handle empty/loading/error states where relevant, and avoid console errors. Fill out the requested experience with realistic generic sample content only where the user did not provide details. Do not invent personal information. Output the complete code through the closing </html> tag with no omitted sections, TODOs, ellipses, or placeholders. Use the full 8192-token output budget when supported.\n\nUser request:\n${request}${attachedText}`;
      const result = await apiRouter.generateChat(fullPrompt, [], {
        model: preferredModel,
        currentUser,
        contextMemory,
        userVault,
        aiBrain,
        attachments: inputAttachment,
        onReset: () => {
          streamRef.current = '';
          setArtifact(null);
          setMessages(previous => {
            const next = [...previous];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: '', streaming: true };
            return next;
          });
        },
        onToken: token => {
          streamRef.current += token;
          if (!streamTimerRef.current) streamTimerRef.current = window.setTimeout(() => {
            streamTimerRef.current = null;
            const parsed = parseArtifact(streamRef.current);
            setArtifact(previous => ({ ...(previous || {}), ...parsed, title: request.slice(0, 72) }));
            setArtifactTab('preview');
            setMessages(previous => {
              const next = [...previous];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: streamRef.current, streaming: true };
              return next;
            });
          }, 80);
        }
      });
      const source = result?.text || streamRef.current;
      if (!source) throw new Error('The model returned an empty website. Please try again.');
      const parsed = parseArtifact(source);
      const nextId = projectId || crypto.randomUUID();
      const nextArtifact = { ...parsed, code: source, title: request.slice(0, 72) || 'Untitled project' };
      setArtifact(nextArtifact);
      setProjectId(nextId);
      setArtifactTab('preview');
      setMessages(previous => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: source, streaming: false };
        return next;
      });
      const savedProject = {
        id: nextId,
        kind: 'project',
        title: nextArtifact.title,
        prompt: request,
        code: source,
        files: { ...parsed.generatedFiles, 'index.html': parsed.html, 'styles.css': parsed.css, 'app.js': parsed.js, ...(parsed.svg ? { 'graphic.svg': parsed.svg } : {}) },
        messages: [{ role: 'user', text: request }, { role: 'assistant', text: source }],
        ...parsed,
        model: result.model || preferredModel,
        timestamp: Date.now()
      };
      await firestoreService.saveCodeProject(currentUser.uid, savedProject);
      firestoreService.setActiveCodeProject(currentUser.uid, savedProject);
      firestoreService.recordUserHistory(currentUser.uid, { type: 'code', prompt: request, code: source, model: result.model || preferredModel });
      const processedTokens = Number(result?.tokenUsage?.totalTokens || result?.usage?.processedTokens) || Math.max(512, Math.ceil((fullPrompt.length + source.length) / 4));
      await recordUsage('chat', Boolean(result?.usage?.tracked), processedTokens, preferredModel === 'think');
      await refreshProfile();
      await loadProjects();
      showToast('Website generated and saved to Projects.');
    } catch (error) {
      const message = error?.message || 'Generation failed. Please retry.';
      if (error?.status === 429) {
        setMessages(previous => previous[previous.length - 1]?.role === 'assistant' ? previous.slice(0, -1) : previous);
        setIsUsageModalOpen(true);
        return;
      }
      if (error?.status === 403 && error?.payload?.upgradeRequired) {
        setMessages(previous => previous[previous.length - 1]?.role === 'assistant' ? previous.slice(0, -1) : previous);
        setIsPricingModalOpen(true);
        return;
      }
      if (error?.payload?.upgradeRequired) setIsUsageModalOpen(true);
      setMessages(previous => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: streamRef.current ? `${streamRef.current}\n\n${message}` : message, streaming: false };
        return next;
      });
      showToast(message);
    } finally {
      if (streamTimerRef.current) { window.clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
      setIsGenerating(false);
      setAttachment(null);
      setAttachmentText('');
      setStage(-1);
    }
  }, [prompt, isGenerating, currentUser, preferredModel, attachment, attachmentText, projectId, loadProjects, showToast, setIsUsageModalOpen, setIsPricingModalOpen, refreshProfile, recordUsage]);

  useEffect(() => {
    const onKeys = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runBuild(); }
      if (event.key === 'Escape' && modal) setModal('');
    };
    window.addEventListener('keydown', onKeys);
    return () => window.removeEventListener('keydown', onKeys);
  }, [runBuild, modal]);

  const startNew = () => {
    setPrompt(''); setArtifact(null); setProjectId(null); setMessages([]); setArtifactTab('preview'); setIsEditingCode(false);
    promptRef.current?.focus(); setModal('');
  };

  const openProject = (project, mode = 'preview') => {
    const parsed = parseArtifact(project.html || project.code || project.svg || '');
    const opened = { ...parsed, ...project, html: project.html || parsed.html, title: project.title || 'Saved project' };
    setArtifact(opened); setPrompt(project.prompt || ''); setProjectId(project.id);
    firestoreService.setActiveCodeProject(currentUser.uid, project);
    setMessages(project.messages || [{ role: 'user', text: project.prompt || project.title }, { role: 'assistant', text: 'Project loaded from your workspace.' }]);
    setModal(''); setArtifactTab(mode === 'edit' ? 'code' : 'preview'); setIsEditingCode(mode === 'edit'); setCodeTab('html');
  };

  const duplicateProject = async project => {
    const copy = { ...project, id: crypto.randomUUID(), title: `${project.title || 'Project'} copy`, updatedAt: Date.now() };
    await firestoreService.saveCodeProject(currentUser.uid, copy); await loadProjects(); showToast('Project duplicated.');
  };
  const removeProject = async project => {
    await firestoreService.deleteCodeProject(currentUser.uid, project.id); await loadProjects(); showToast('Project deleted.');
    if (projectId === project.id) { setArtifact(null); setProjectId(null); setMessages([]); }
  };

  const updateCode = value => {
    setArtifact(previous => {
      if (!previous) return previous;
      if (codeTab === 'html') {
        const parsed = parseArtifact(value);
        return { ...previous, ...parsed, code: value, title: previous.title };
      }
      const tag = codeTab === 'css' ? 'style' : 'script';
      const block = `<${tag}>\n${value}\n</${tag}>`;
      let html = previous.html || '<!doctype html><html><head></head><body></body></html>';
      const tagPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
      if (tagPattern.test(html)) html = html.replace(tagPattern, block);
      else if (tag === 'style' && /<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, `$&${block}`);
      else if (tag === 'script' && /<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${block}</body>`);
      else html += block;
      const parsed = parseArtifact(html);
      return { ...previous, ...parsed, [codeTab]: value, code: html, title: previous.title };
    });
  };

  const saveCurrentProject = useCallback(async () => {
    if (!currentUser?.uid || !artifact || !projectId) return;
    const project = {
      ...artifact,
      id: projectId,
      title: artifact.title || prompt.slice(0, 72) || 'Untitled project',
      prompt,
      code: artifact.code || artifact.html || '',
      files: { ...(artifact.generatedFiles || {}), 'index.html': artifact.html || '', 'styles.css': artifact.css || '', 'app.js': artifact.js || '', ...(artifact.svg ? { 'graphic.svg': artifact.svg } : {}) },
      messages,
      timestamp: Date.now()
    };
    await firestoreService.saveCodeProject(currentUser.uid, project);
    firestoreService.setActiveCodeProject(currentUser.uid, project);
    await loadProjects();
    showToast('Project saved.');
  }, [currentUser?.uid, artifact, projectId, prompt, messages, loadProjects, showToast]);

  useEffect(() => {
    if (isGenerating || !artifact || !projectId || !currentUser?.uid) return undefined;
    const project = {
      ...artifact, id: projectId, prompt,
      title: artifact.title || prompt.slice(0, 72) || 'Untitled project',
      code: artifact.code || artifact.html || '',
      files: { ...(artifact.generatedFiles || {}), 'index.html': artifact.html || '', 'styles.css': artifact.css || '', 'app.js': artifact.js || '', ...(artifact.svg ? { 'graphic.svg': artifact.svg } : {}) },
      messages,
      timestamp: Date.now()
    };
    firestoreService.setActiveCodeProject(currentUser.uid, project);
    firestoreService.saveCodeProject(currentUser.uid, project)
      .then(loadProjects)
      .catch(error => console.warn('Could not autosave Studio code:', error.message));
    return undefined;
  }, [isEditingCode, isGenerating, artifact, projectId, currentUser?.uid, prompt, messages, loadProjects]);

  const copyCode = async () => {
    const code = artifactTab === 'code' && codeTab !== 'html' ? activeCode : currentHtml;
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { showToast('Clipboard access is unavailable in this browser.'); }
  };
  const handleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return showToast('Voice input is not available in this browser.');
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false;
    recognition.onresult = event => setPrompt(value => `${value}${value ? ' ' : ''}${event.results?.[0]?.[0]?.transcript || ''}`);
    recognition.onerror = () => showToast('Voice input could not start. Check microphone permissions.');
    recognition.start();
  };

  const publish = () => {
    downloadHtml(currentHtml, fileName);
    showToast('Website file exported and ready to publish on your host.');
  };

  const codeLanguages = { html: 'html', css: 'css', js: 'javascript', svg: 'xml' };
  const visibleProjects = projects.filter(project =>
    projectView === 'all' || (projectView === 'searches' ? project.kind === 'search' : project.kind !== 'search')
  );
  const visibleFiles = visibleProjects.flatMap(project => {
    const files = { ...(project.generatedFiles || {}), ...(project.files || {}) };
    if (Object.keys(files).length) return Object.entries(files).map(([name, contents]) => ({ project, name, contents }));
    return ['html', 'css', 'js', 'svg'].flatMap(type => project[type]
      ? [{ project, name: ({ html: 'index.html', css: 'styles.css', js: 'app.js', svg: 'graphic.svg' })[type], contents: project[type] }]
      : []);
  }).filter(file => String(file.contents || '').trim());
  const appShell = appearance === 'light' ? 'bg-[#edf2fa] text-slate-900' : 'bg-[#080a13] text-slate-100';

  return <div className={`relative flex h-dvh min-h-[600px] flex-col overflow-hidden ${appShell}`}>
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(140,160,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(140,160,255,.055)_1px,transparent_1px)] bg-[size:44px_44px]" />
    <div className="pointer-events-none absolute -left-40 top-20 h-[32rem] w-[32rem] rounded-full bg-violet-600/20 blur-[120px] animate-pulse" />
    <div className="pointer-events-none absolute -right-40 top-1/3 h-[34rem] w-[34rem] rounded-full bg-cyan-500/15 blur-[140px] animate-pulse [animation-delay:1.2s]" />
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-white/[.08] bg-[#0b0d17]/80 px-4 backdrop-blur-2xl lg:px-7">
      <button onClick={onExitDashboard} className="mr-1 flex items-center gap-2 text-slate-400 transition hover:text-white" title="Return to dashboard"><ArrowLeft size={17} /><span className="hidden text-xs font-medium sm:inline">Zulora</span></button>
      <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/20 bg-gradient-to-br from-violet-400/20 to-cyan-300/10 text-cyan-100 shadow-[0_0_22px_rgba(111,106,255,.2)]"><Code2 size={19} /></div><div><div className="text-sm font-bold tracking-wide">AI Studio</div><div className="text-[10px] text-slate-500">Website builder workspace</div></div></div>
      <div className="mx-auto hidden items-center gap-1 rounded-xl border border-white/[.07] bg-white/[.025] p-1 lg:flex">
        {[['Code Workspace / Projects', 'projects', FolderOpen], ['Templates', 'templates', Sparkles], ['Pricing', 'pricing', WandSparkles], ['Settings', 'settings', Settings2]].map(([label, key, Icon]) => <button key={key} onClick={() => key === 'pricing' ? setModal('pricing') : setModal(key)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/[.06] hover:text-white"><Icon size={14} />{label}</button>)}
      </div>
      <button onClick={startNew} className="ml-auto flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-violet-300/30 hover:bg-violet-300/10"><Plus size={15} /><span className="hidden sm:inline">New Project</span></button>
      <button onClick={() => setModal('menu')} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/[.06] hover:text-white lg:hidden" title="Workspace menu"><Menu size={17} /></button>
      <button onClick={() => setModal('profile')} className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/[.07] hover:text-white" title="Profile">{currentUser?.photoURL ? <img src={currentUser.photoURL} alt="" className="h-6 w-6 rounded-lg object-cover" /> : <span className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-cyan-400/30 to-violet-400/40 text-[10px] text-white">{String(currentUser?.displayName || currentUser?.email || 'U').slice(0, 1).toUpperCase()}</span>}<span className="hidden pr-1 sm:inline">Profile</span></button>
    </header>

    <main className="relative z-10 flex min-h-0 flex-1 flex-col p-3 sm:p-4 lg:p-5">
      {!artifact && !isGenerating ? <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center pb-8">
        <div className="mb-8 text-center"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-[22px] border border-cyan-200/20 bg-gradient-to-br from-cyan-300/15 to-violet-400/20 text-cyan-100 shadow-[0_0_50px_rgba(79,162,255,.2)]"><Globe2 size={30} /></div><p className="mb-3 text-xs font-bold uppercase tracking-[.28em] text-cyan-200/70">Your ideas, live on the web</p><h1 className="text-4xl font-black tracking-tight sm:text-6xl">Build something <span className="bg-gradient-to-r from-violet-300 via-blue-300 to-cyan-200 bg-clip-text text-transparent">remarkable.</span></h1><p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">Describe a website, then watch the interface take shape in a live, editable preview.</p></div>
        <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFile(event.dataTransfer.files?.[0]); }} className="rounded-[28px] border border-white/10 bg-[#111522]/85 p-3 shadow-[0_24px_90px_rgba(0,0,0,.4)] backdrop-blur-2xl ring-1 ring-white/[.025] sm:p-4">
          <textarea ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runBuild(); }} rows={3} placeholder="Describe the site you want to build..." className="w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-7 text-white outline-none placeholder:text-slate-600" />
          {attachment && <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.06] px-3 py-2 text-xs text-cyan-100"><FileCode2 size={14} />{attachment.name}<button onClick={() => { setAttachment(null); setAttachmentText(''); }} className="ml-auto text-slate-400 hover:text-white"><X size={14} /></button></div>}
          <div className="flex items-center gap-2 border-t border-white/[.07] px-2 pt-3"><button onClick={() => fileInputRef.current?.click()} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white/[.06] hover:text-white" title="Attach file"><Upload size={17} /></button><input ref={fileInputRef} type="file" accept="image/*,.html,.css,.js,.txt,.md,.json" className="hidden" onChange={event => { addFile(event.target.files?.[0]); event.target.value = ''; }} /><button onClick={handleVoice} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white/[.06] hover:text-white" title="Voice input"><Mic size={17} /></button><span className="hidden text-[11px] text-slate-600 sm:inline">HTML, CSS, JS, images · Ctrl/⌘ + Enter</span><button disabled={!prompt.trim()} onClick={() => runBuild()} className="ml-auto flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-400 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles size={15} />Build website</button></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{['Build a portfolio', 'Create an online store', 'Make a restaurant site'].map(chip => <button key={chip} onClick={() => setPrompt(chip)} className="rounded-full border border-white/[.08] bg-white/[.025] px-3 py-2 text-xs text-slate-400 transition hover:border-cyan-200/20 hover:bg-cyan-200/[.06] hover:text-cyan-100">{chip}</button>)}</div>
        <button onClick={() => setModal('templates')} className="mx-auto mt-7 flex items-center gap-2 text-xs text-slate-500 transition hover:text-cyan-200"><Sparkles size={14} />Explore starter templates <ChevronDown size={14} /></button>
      </div> : <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <aside className="flex min-h-[230px] w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[.09] bg-[#10131e]/85 backdrop-blur-2xl lg:w-[320px] xl:w-[360px]">
          <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3"><div><p className="text-xs font-bold">Builder chat</p><p className="mt-0.5 text-[10px] text-slate-500">{artifact?.title || 'New project'}</p></div><button onClick={() => setModal('projects')} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.06] hover:text-white" title="Projects"><FolderOpen size={15} /></button></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`rounded-2xl px-3.5 py-3 text-xs leading-6 ${message.role === 'user' ? 'ml-5 bg-violet-400/10 text-violet-50 ring-1 ring-violet-300/10' : 'mr-3 bg-white/[.035] text-slate-300 ring-1 ring-white/[.05]'}`}><div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{message.role === 'user' ? 'You' : <><Sparkles size={11} /> AI Studio</>}{message.streaming && <LoaderCircle size={11} className="animate-spin" />}</div><p className="whitespace-pre-wrap">{message.role === 'assistant' ? message.text.replace(/```[\s\S]*?```/g, '[Generated code is available in the Code panel.]') : message.text}</p></div>)}
            {isGenerating && <div className="rounded-2xl border border-cyan-200/10 bg-cyan-200/[.035] p-3.5"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-cyan-100"><LoaderCircle size={14} className="animate-spin" />Building your website</div><div className="space-y-2">{STAGES.map((label, index) => <div key={label} className={`flex items-center gap-2 text-[11px] transition-all ${stage > index ? 'text-emerald-200' : stage === index ? 'text-cyan-100' : 'text-slate-600'}`}><span className={`grid h-4 w-4 place-items-center rounded-full ${stage > index ? 'bg-emerald-300/20' : stage === index ? 'bg-cyan-300/20' : 'bg-white/[.04]'}`}>{stage > index ? <Check size={10} /> : stage === index ? <LoaderCircle size={10} className="animate-spin" /> : index + 1}</span>{label}</div>)}</div></div>}
          </div>
          <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFile(event.dataTransfer.files?.[0]); }} className="border-t border-white/[.07] p-3"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={2} placeholder="Ask for a change or another page..." className="w-full resize-none rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-slate-600 focus:border-cyan-200/20"/><div className="mt-2 flex items-center gap-2"><button onClick={() => fileInputRef.current?.click()} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.06] hover:text-white"><Upload size={14} /></button><button onClick={handleVoice} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.06] hover:text-white"><Mic size={14} /></button><button disabled={!prompt.trim() || isGenerating} onClick={() => runBuild()} className="ml-auto flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-3 py-2 text-[11px] font-bold disabled:opacity-40"><Sparkles size={13} />{isGenerating ? 'Building…' : 'Build'}</button></div></div>
        </aside>

        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[.09] bg-[#10131e]/85 backdrop-blur-2xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[.07] px-3 py-2.5">
            <div className="flex rounded-xl bg-black/20 p-1"><button onClick={() => setArtifactTab('preview')} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold ${artifactTab === 'preview' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}><Eye size={13} />Live Preview</button><button onClick={() => setArtifactTab('code')} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${artifactTab === 'code' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>&lt;/&gt; Code View</button></div>
            <div className="mx-auto hidden items-center gap-1 rounded-xl bg-black/20 p-1 sm:flex">{[['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]].map(([size, Icon]) => <button key={size} onClick={() => setViewport(size)} className={`rounded-lg p-1.5 ${viewport === size ? 'bg-white/10 text-cyan-100' : 'text-slate-500 hover:text-white'}`} title={`${size} viewport`}><Icon size={14} /></button>)}</div>
            <button onClick={() => setRefreshKey(value => value + 1)} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.06] hover:text-white" title="Refresh preview"><RefreshCw size={14} /></button>
            <button onClick={() => setModal('fullscreen')} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.06] hover:text-white" title="Fullscreen"><Maximize2 size={14} /></button>
            <button onClick={copyCode} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] text-slate-400 hover:bg-white/[.06] hover:text-white" title="Copy code">{copied ? <Check size={13} /> : <Copy size={13} />}<span className="hidden xl:inline">Copy Code</span></button>
            <button onClick={() => downloadHtml(currentHtml, fileName)} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] text-slate-400 hover:bg-white/[.06] hover:text-white" title="Download file"><Download size={14} /><span className="hidden xl:inline">Download File</span></button>
            <button onClick={publish} className="ml-auto flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-[11px] font-bold text-white shadow-lg shadow-violet-950/30 hover:brightness-110"><Globe2 size={13} />Publish</button>
          </div>
          {artifactTab === 'preview' ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#070911] p-3 sm:p-5"><div className="h-full min-h-[390px] max-w-full overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_10px_45px_rgba(0,0,0,.4)] transition-[width] duration-300" style={{ width: viewportWidth, flex: viewport === 'desktop' ? '1' : '0 0 auto' }}><iframe key={refreshKey} title="Generated website live preview" srcDoc={previewHtml} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full min-h-[390px] w-full border-0" /></div></div> : <div className="flex min-h-0 flex-1 flex-col bg-[#080a10]"><div className="flex items-center gap-1 border-b border-white/[.06] px-4 py-2">{['html', 'css', 'js'].map(lang => <button key={lang} onClick={() => setCodeTab(lang)} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase ${codeTab === lang ? 'bg-cyan-300/10 text-cyan-100' : 'text-slate-500 hover:text-white'}`}>{lang}</button>)}<div className="ml-auto flex gap-1"><button onClick={() => setIsEditingCode(value => !value)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-200/10">{isEditingCode ? 'Done editing' : 'Edit Code'}</button><button onClick={saveCurrentProject} disabled={!projectId} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-200/10 disabled:opacity-40">Save Project</button><button onClick={copyCode} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 hover:bg-white/[.06] hover:text-white">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button><button onClick={() => downloadHtml(currentHtml, fileName)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 hover:bg-white/[.06] hover:text-white"><Download size={13} />Download</button></div></div><div className="min-h-0 flex-1 overflow-auto text-xs">{isEditingCode ? <textarea aria-label={`Edit ${codeTab.toUpperCase()} code`} spellCheck={false} value={activeCode} onChange={event => updateCode(event.target.value)} className="h-full min-h-[380px] w-full resize-none bg-transparent p-5 font-mono text-[11px] leading-6 text-slate-200 outline-none" /> : activeCode ? <SyntaxHighlighter language={codeLanguages[codeTab] || 'html'} style={vscDarkPlus} showLineNumbers wrapLongLines customStyle={{ background: 'transparent', margin: 0, minHeight: '100%', fontSize: '11px', lineHeight: '1.65', padding: '18px' }} lineNumberStyle={{ minWidth: '3em', color: '#556077', paddingRight: '1.5em' }}>{activeCode}</SyntaxHighlighter> : <div className="p-6 text-sm text-slate-500">No {codeTab.toUpperCase()} block was returned.</div>}</div></div>}
        </section>
      </div>}
    </main>

    {toast && <div className="fixed bottom-5 left-1/2 z-[90] -translate-x-1/2 rounded-xl border border-white/10 bg-[#171b29] px-4 py-3 text-xs text-slate-100 shadow-2xl">{toast}</div>}
    {modal === 'fullscreen' && <div className="fixed inset-0 z-[80] flex flex-col bg-[#070911]"><div className="flex h-14 items-center justify-between border-b border-white/10 px-4 text-sm"><span className="font-semibold">{artifact?.title || 'Live preview'}</span><button onClick={() => setModal('')} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={18} /></button></div><iframe title="Fullscreen website preview" srcDoc={previewHtml} sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-0 flex-1 border-0 bg-white" /></div>}

    {modal === 'projects' && <StudioModal title="Code Workspace / Projects" onClose={() => setModal('')} wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {[["all", "All sessions"], ["files", "Generated files"], ["searches", "Search history"]].map(([key, label]) => <button key={key} onClick={() => setProjectView(key)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${projectView === key ? 'border-cyan-200/30 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-slate-400 hover:bg-white/[.05]'}`}>{label}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projectView === 'files' ? visibleFiles.map(({ project, name, contents }) => <article key={`${project.id}-${name}`} className="flex min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[.025] p-4">
          <div className="mb-3 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-mono text-xs font-semibold text-cyan-100">{name}</p><p className="mt-1 truncate text-[10px] text-slate-500">{project.title || 'Untitled project'}</p></div><button onClick={() => openProject(project, 'edit')} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-slate-200 hover:bg-white/10">Open project</button></div>
          <details className="min-w-0 rounded-xl bg-black/20"><summary className="cursor-pointer px-3 py-2 text-[10px] text-slate-400">View file contents</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[10px] leading-5 text-slate-300">{contents}</pre></details>
        </article>) : visibleProjects.map(project => project.kind === 'search' ? <article key={project.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[.025] p-4">
          <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-200">Search history</p><p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-200">{project.query || project.prompt}</p></div><button title="Delete" onClick={() => removeProject(project)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={13} /></button></div>
          <p className="mt-auto pt-4 text-[10px] text-slate-500">{new Date(project.timestamp || project.updatedAt || Date.now()).toLocaleString()}</p>
          <button onClick={() => { setModal(''); runBuild(project.query || project.prompt); }} className="mt-3 w-full rounded-lg border border-cyan-200/15 bg-cyan-200/[.06] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-200/10">Run again</button>
        </article> : <article key={project.id} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[.025]">
          <div className="block h-32 w-full overflow-hidden bg-gradient-to-br from-violet-500/20 via-blue-500/10 to-cyan-500/20"><iframe title="Project thumbnail" srcDoc={project.html || ''} sandbox="" tabIndex={-1} className="pointer-events-none h-[520px] w-[1600px] origin-top-left scale-[.11] border-0 bg-white" /></div>
          <div className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">{project.title || 'Untitled project'}</p><p className="mt-1 text-[10px] text-cyan-200/70">Generated code session</p></div><button title="Delete" onClick={() => removeProject(project)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={13} /></button></div>
            <p className="mt-2 truncate text-[10px] text-slate-500">Files: {Object.keys(project.files || {}).length ? Object.entries(project.files).filter(([, contents]) => String(contents || '').trim()).map(([name]) => name).join(', ') : ['html', 'css', 'js', 'svg'].filter(file => project[file]).map(file => `${file === 'js' ? 'app.js' : file === 'css' ? 'styles.css' : file === 'svg' ? 'graphic.svg' : 'index.html'}`).join(', ') || 'source code'}</p>
            <p className="mt-1 text-[10px] text-slate-500">Saved {new Date(project.timestamp || project.updatedAt || Date.now()).toLocaleString()}</p>
            <div className="mt-3 flex gap-2"><button onClick={() => openProject(project, 'preview')} className="flex-1 rounded-lg border border-white/10 bg-white/[.04] px-2 py-2 text-[10px] font-semibold text-slate-200 hover:bg-white/10">Open Preview</button><button onClick={() => openProject(project, 'edit')} className="flex-1 rounded-lg border border-cyan-200/15 bg-cyan-200/[.06] px-2 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-200/10">Edit Code</button></div>
            <button onClick={() => duplicateProject(project)} className="mt-2 w-full rounded-lg px-2 py-1.5 text-[10px] text-slate-500 hover:bg-white/[.05] hover:text-white"><Copy size={12} className="mr-1 inline" />Duplicate</button>
          </div>
        </article>)}
        {!(projectView === 'files' ? visibleFiles.length : visibleProjects.length) && <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-slate-500">Nothing is saved in this view yet.</div>}
      </div>
    </StudioModal>}

    {modal === 'menu' && <StudioModal title="Workspace" onClose={() => setModal('')}><div className="grid gap-2 sm:grid-cols-2">{[['Code Workspace / Projects', 'projects', FolderOpen], ['Templates', 'templates', Sparkles], ['Pricing', 'pricing', WandSparkles], ['Settings', 'settings', Settings2]].map(([label, key, Icon]) => <button key={key} onClick={() => setModal(key)} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4 text-left text-sm text-slate-300 transition hover:border-cyan-200/20 hover:bg-white/[.06] hover:text-white"><Icon size={16} />{label}</button>)}</div></StudioModal>}

    {modal === 'templates' && <StudioModal title="Choose a starting point" onClose={() => setModal('')} wide><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{TEMPLATES.map(template => <article key={template.name} className="group rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:-translate-y-1 hover:border-cyan-200/20 hover:bg-white/[.05]"><div className={`mb-4 grid h-28 place-items-center rounded-xl bg-gradient-to-br ${template.color} text-4xl text-white/80`}><span className="transition duration-300 group-hover:scale-110">{template.icon}</span></div><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">{template.name}</h3><p className="mt-1 text-[11px] text-slate-500">Responsive starter experience</p></div><button onClick={() => { setModal(''); setPrompt(template.prompt); window.setTimeout(() => promptRef.current?.focus(), 0); }} className="rounded-xl bg-white/[.08] px-3 py-2 text-[10px] font-bold text-white opacity-80 transition hover:bg-cyan-300/15 hover:text-cyan-100 group-hover:opacity-100">Use template</button></div></article>)}</div></StudioModal>}

    {modal === 'pricing' && <StudioModal title="Plans for every build" onClose={() => setModal('')}><div className="grid gap-3 md:grid-cols-3">{[['Free', '$0', 'Explore the builder', 'Core generation and preview'], ['Pro', '$12', 'More creation capacity', 'Higher usage and premium engines'], ['Business', '$39', 'For collaborative teams', 'Shared workflows and team controls']].map(([name, price, intro, detail], index) => <article key={name} className={`rounded-2xl border p-4 ${index === 1 ? 'border-violet-300/30 bg-violet-300/[.07]' : 'border-white/10 bg-white/[.025]'}`}><div className="text-sm font-bold">{name}</div><div className="mt-3 text-3xl font-black">{price}<span className="text-xs font-medium text-slate-500"> / month</span></div><p className="mt-3 text-xs font-semibold text-cyan-100">{intro}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-400">{detail}</p><button onClick={() => { setModal(''); setIsPricingModalOpen(true); }} className="mt-4 w-full rounded-xl border border-white/10 bg-white/[.06] py-2.5 text-xs font-bold hover:bg-white/10">{index === 0 ? 'Current plan' : 'Explore plan'}</button></article>)}</div><p className="mt-4 text-[10px] leading-5 text-slate-500">Plan options open the Zulora account upgrade flow. Prices shown here are illustrative.</p></StudioModal>}

    {modal === 'settings' && <StudioModal title="Studio settings" onClose={() => setModal('')}><div className="space-y-5"><div><label className="mb-2 block text-xs font-semibold text-slate-300">Appearance</label><div className="flex gap-2">{['dark', 'light'].map(value => <button key={value} onClick={() => setAppearance(value)} className={`rounded-xl border px-4 py-2 text-xs capitalize ${appearance === value ? 'border-cyan-200/30 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-slate-400'}`}>{value}</button>)}</div></div><div><label className="mb-2 block text-xs font-semibold text-slate-300">AI preferences</label><select value={preferredModel} onChange={event => setPreferredModel(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#171b29] px-3 py-2.5 text-sm text-white outline-none"><option value="auto">Auto (Smart Route)</option><option value="gemini">Gemini</option><option value="groq">Groq LPU</option><option value="think">Zulora 3.5 Pro Ultra</option></select></div><div className="rounded-xl border border-white/10 bg-white/[.025] p-4"><p className="text-xs font-semibold">Keyboard shortcuts</p><p className="mt-2 text-xs text-slate-400"><kbd className="rounded bg-white/10 px-1.5 py-1">Ctrl/⌘ + Enter</kbd> Build website</p><p className="mt-2 text-xs text-slate-400"><kbd className="rounded bg-white/10 px-1.5 py-1">Esc</kbd> Close dialog</p></div></div></StudioModal>}

    {modal === 'profile' && <StudioModal title="Your profile" onClose={() => setModal('')}><div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.025] p-4">{currentUser?.photoURL ? <img src={currentUser.photoURL} alt="" className="h-12 w-12 rounded-2xl object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400/20 to-violet-400/30 font-bold">{String(currentUser?.displayName || currentUser?.email || 'U').slice(0, 1).toUpperCase()}</div>}<div><p className="text-sm font-semibold">{currentUser?.displayName || 'Zulora user'}</p><p className="mt-1 text-xs text-slate-500">{currentUser?.email}</p><p className="mt-2 text-[10px] uppercase tracking-wider text-cyan-200">{tier} plan</p></div></div></StudioModal>}
    <UsageLimitsModal isOpen={isUsageModalOpen} onClose={() => setIsUsageModalOpen(false)} />
    <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />
  </div>;
}
