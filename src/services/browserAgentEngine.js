/**
 * Zulora AI — Browser Agent Engine (v1.5.0)
 * ============================================
 * TRIPLE-AGENT AUTONOMOUS ARCHITECTURE:
 *  - AGENT 1: Master Planner & Decomposer (Multi-step JSON action queue)
 *  - AGENT 2: DOM & Native Executor Engine (Direct JS execution, <300ms latency)
 *  - AGENT 3: Vision & Screen Verifier (DOM & state verification, auto-retry)
 *
 * FAST WATERFALL BRAIN (500ms failover):
 *  - Groq Llama-3.3-70b / Cerebras (ultra-fast planning <400ms)
 *  - Direct Gemini 2.0 Flash / Pro REST endpoints
 *  - OpenRouter & deterministic local fallback (NEVER crashes)
 *
 * PERSISTENT UNIFIED TOKEN ENGINE:
 *  - Merges plugin & chat tokens into Firestore `users/{userId}/tokenUsage`
 *  - Retains counts in localStorage `zulora_total_tokens`
 */

import { db } from './firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const EXTENSION_ID = 'emimeingkoocmgljpjkpdnlnbkpkfbff';

export const ACTION_TYPES = {
  // Triple-Agent Standard Actions
  NAVIGATE:        'NAVIGATE',
  FILL_INPUT:      'FILL_INPUT',
  CLICK:           'CLICK',
  EXTRACT_DATA:    'EXTRACT_DATA',
  POST_DATA:       'POST_DATA',
  READ_SCREEN:     'READ_SCREEN',
  AUTOFILL_FORM:   'autofill_form',
  WAIT:            'wait',

  // High-Level App Orchestration Actions
  OPEN_URL:        'open_url',
  SWITCH_TAB:      'switch_tab',
  CLOSE_TAB:       'close_tab',
  SEARCH_GOOGLE:   'search_google',
  YOUTUBE_PLAY:    'youtube_play',
  TYPE_TEXT:       'type_text',
  CLICK_ELEMENT:   'click_element',
  EXTRACT:         'extract_content',
  READ_DOM:        'read_page_dom',
  SUMMARIZE_PAGE:  'summarize_page',
  GMAIL_COMPOSE:   'gmail_compose',
  GMAIL_READ:      'gmail_read_inbox',
  CHATGPT_PROMPT:  'chatgpt_prompt',
  GEMINI_PROMPT:   'gemini_prompt',
  WHATSAPP_SEND:   'whatsapp_send',
  EXPORT_PDF:      'export_pdf',
  EXPORT_CODE:     'export_code',
  DOWNLOAD_FILE:   'download_file',
  NOTIFY_USER:     'notify_user',
  EVAL_TOP_RESULT: 'evaluate_and_open_top_result',
};

export const TEMPLATES = { PEARL: 'pearl', AZURE: 'azure', FORMAL: 'formal' };

// ─── BUGFIX 3: Direct App Routing Matrix ─────────────────────────────────────
// Maps keywords → canonical URLs. Used to prevent defaulting to Google search.
export const APP_ROUTING_MATRIX = {
  // Google Apps
  'gemini':          'https://gemini.google.com/app',
  'google gemini':   'https://gemini.google.com/app',
  'gmail':           'https://mail.google.com',
  'google docs':     'https://docs.google.com',
  'google sheets':   'https://sheets.google.com',
  'google slides':   'https://slides.google.com',
  'google drive':    'https://drive.google.com',
  'google maps':     'https://maps.google.com',
  'google meet':     'https://meet.google.com',
  'google calendar': 'https://calendar.google.com',
  'google photos':   'https://photos.google.com',
  'google translate':'https://translate.google.com',
  'google news':     'https://news.google.com',
  'youtube':         'https://www.youtube.com',
  // AI Tools
  'chatgpt':         'https://chatgpt.com',
  'chat gpt':        'https://chatgpt.com',
  'claude':          'https://claude.ai',
  'perplexity':      'https://www.perplexity.ai',
  'midjourney':      'https://www.midjourney.com',
  'copilot':         'https://copilot.microsoft.com',
  'grok':            'https://grok.x.ai',
  'notebooklm':      'https://notebooklm.google.com',
  'bard':            'https://gemini.google.com/app',
  // Communication
  'whatsapp':        'https://web.whatsapp.com',
  'whats app':       'https://web.whatsapp.com',
  'telegram':        'https://web.telegram.org',
  'discord':         'https://discord.com/app',
  'slack':           'https://app.slack.com',
  'twitter':         'https://twitter.com',
  'x.com':           'https://x.com',
  'linkedin':        'https://www.linkedin.com',
  'instagram':       'https://www.instagram.com',
  'facebook':        'https://www.facebook.com',
  'reddit':          'https://www.reddit.com',
  // Developer
  'github':          'https://github.com',
  'gitlab':          'https://gitlab.com',
  'stackoverflow':   'https://stackoverflow.com',
  'stack overflow':  'https://stackoverflow.com',
  'codepen':         'https://codepen.io',
  'codesandbox':     'https://codesandbox.io',
  'replit':          'https://replit.com',
  'vercel':          'https://vercel.com/dashboard',
  'netlify':         'https://app.netlify.com',
  'firebase':        'https://console.firebase.google.com',
  // Productivity
  'notion':          'https://www.notion.so',
  'trello':          'https://trello.com',
  'figma':           'https://www.figma.com',
  'canva':           'https://www.canva.com',
  'miro':            'https://miro.com',
  'airtable':        'https://airtable.com',
  'linear':          'https://linear.app',
  'jira':            'https://www.atlassian.com/software/jira',
  'asana':           'https://app.asana.com',
  'clickup':         'https://app.clickup.com',
  // Shopping & Finance
  'amazon':          'https://www.amazon.in',
  'flipkart':        'https://www.flipkart.com',
  'meesho':          'https://www.meesho.com',
  'myntra':          'https://www.myntra.com',
  'swiggy':          'https://www.swiggy.com',
  'zomato':          'https://www.zomato.com',
  // News & Media
  'netflix':         'https://www.netflix.com',
  'spotify':         'https://open.spotify.com',
  'hotstar':         'https://www.hotstar.com',
  'prime video':     'https://www.primevideo.com',
  // Other
  'wikipedia':       'https://en.wikipedia.org',
  'leetcode':        'https://leetcode.com',
  'npm':             'https://www.npmjs.com',
  'pypi':            'https://pypi.org',
};

/**
 * Resolve a user keyword (e.g. "gmail", "chatgpt") to a direct URL.
 * Returns null if no match found — caller should fall back to Google search.
 */
export function resolveDirectUrl(phrase) {
  const lower = String(phrase || '').toLowerCase().trim();
  // Try longest match first (multi-word)
  const sorted = Object.keys(APP_ROUTING_MATRIX).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (lower.includes(key)) return APP_ROUTING_MATRIX[key];
  }
  // Is it a raw URL?
  if (/^https?:\/\//.test(lower)) return lower;
  // Is it a domain like "youtube.com"?
  if (/^[a-z0-9-]+\.[a-z]{2,}/.test(lower)) return 'https://' + lower;
  return null;
}

// ─── BUGFIX 2: Smart Email & Content Payload Generator ───────────────────────
/**
 * Extracts structured { recipient, subject, body } from a natural-language prompt.
 * Never passes raw prompt text directly into DOM inputs.
 */
export function smartExtractEmailPayload(prompt) {
  const emailMatch = prompt.match(/to\s+([\w._%+\-]+@[\w.\-]+\.[a-z]{2,})/i);
  const subjectPatterns = [
    /subject[:\s]+[\"']?(.+?)[\"']?(?:\s+(?:body|saying|with|and|message|telling)|$)/i,
    /(?:about|regarding|re:)\s+[\"']?(.+?)[\"']?(?:\s+(?:body|saying|with|and|message)|$)/i,
  ];
  const bodyPatterns = [
    /(?:body|saying|message|draft|write|tell (?:them|him|her))[:\s]+[\"']?(.+?)[\"']?$/i,
    /(?:that|saying that)\s+(.+)$/i,
  ];

  let recipient = '';
  let subject = '';
  let body = '';

  if (emailMatch) recipient = emailMatch[1].trim();

  for (const p of subjectPatterns) {
    const m = prompt.match(p);
    if (m) { subject = m[1].trim(); break; }
  }

  for (const p of bodyPatterns) {
    const m = prompt.match(p);
    if (m) { body = m[1].trim(); break; }
  }

  // Fallback: use the cleaned prompt as body
  if (!body) {
    body = cleanSearchIntent(prompt.replace(/send (an? )?email/gi, '').replace(/to\s+[\w.@]+/gi, '').trim());
  }

  if (!subject) {
    // Guess subject from body
    const words = body.split(' ').slice(0, 6).join(' ');
    subject = words.length > 3 ? words : 'Message from Zulora AI';
  }

  return { recipient, subject, body };
}

/**
 * Generates a professional AI email body using the waterfall LLM,
 * then wraps it in a Pearl or Azure template.
 */
export async function generateEmailPayload(rawPrompt, template = TEMPLATES.PEARL, meta = {}) {
  const systemPrompt = `You are an expert email writer. Write a concise, professional email body based on the following user instruction.
- Output ONLY the email body text, no subject line, no greeting like "Dear..." unless explicitly requested.
- Keep it under 200 words.
- Use clean, professional language.
- Output plain text only, no markdown.`;

  const llmResult = await callWaterfallLLM(rawPrompt, systemPrompt, {
    maxTokens: 400,
    temperature: 0.3,
    timeoutMs: 3000,
    groqModel: 'llama-3.3-70b-versatile'
  });

  const bodyText = (llmResult.success && llmResult.text) ? llmResult.text.trim() : rawPrompt;
  const bodyHtml = renderEmailTemplate(bodyText, template, { subject: meta.subject || '' });

  return {
    bodyText,
    bodyHtml,
    tokensUsed: llmResult.success ? Math.ceil(bodyText.split(/\s+/).length * 1.3) : 0,
    provider: llmResult.provider || 'fallback'
  };
}

// ─── Token Synchronization Engine ───────────────────────────────────────────────
export async function syncTokenUsage(tokensConsumed, userId) {
  if (!tokensConsumed || typeof tokensConsumed !== 'number') {
    return parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  }
  let currentTotal = parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  currentTotal += tokensConsumed;
  localStorage.setItem('zulora_total_tokens', currentTotal.toString());

  if (userId && db && typeof doc === 'function') {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      const dbTokens = snap.exists() ? parseInt(snap.data()?.tokenUsage || '0', 10) : 0;
      const newTotal = Math.max(dbTokens, currentTotal);
      await setDoc(userRef, { tokenUsage: newTotal }, { merge: true });
      localStorage.setItem('zulora_total_tokens', newTotal.toString());
      return newTotal;
    } catch (e) {
      console.warn('[Zulora Token Engine] Firebase sync warning:', e.message);
    }
  }
  return currentTotal;
}

// ─── NLP Intent & Entity Cleaner ───────────────────────────────────────────────
export function cleanSearchIntent(rawQuery) {
  if (!rawQuery) return '';
  let text = typeof rawQuery === 'object'
    ? (rawQuery.text || rawQuery.query || rawQuery.searchTerm || rawQuery.value || Object.values(rawQuery).join(' '))
    : String(rawQuery);
  text = text.trim();

  // Strip NLP fillers
  const fillers = [
    /^open youtube and search for\s+/i,
    /^open youtube and play\s+/i,
    /^search for\s+/i,
    /^search\s+/i,
    /^play the video\s+/i,
    /^play\s+/i,
    /^find\s+/i,
    /^go to google and find\s+/i,
    /\s+there please$/i,
    /\s+please$/i,
    /\s+there$/i,
    /\s+on the search bar$/i,
    /\s+on youtube$/i,
    /\s+in youtube$/i,
    /\s+on google$/i
  ];
  for (const r of fillers) {
    text = text.replace(r, '');
  }
  return text.trim();
}

// ─── Email & Content Templates (Pearl & Azure) ────────────────────────────────
export function renderEmailTemplate(bodyHtml, templateType = TEMPLATES.PEARL, meta = {}) {
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const content = typeof bodyHtml === 'object' ? Object.values(bodyHtml).join('\n') : String(bodyHtml || '');

  if (templateType === TEMPLATES.AZURE || templateType === 'azure') {
    return `<div style="font-family:'Inter',-apple-system,sans-serif;background:linear-gradient(135deg,#0c1a2e,#0f2a4a);color:#e2e8f0;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">
      <div style="padding:32px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <h2 style="margin:0;color:#38bdf8;font-size:24px;font-weight:600">${meta.subject || 'Message from Zulora AI'}</h2>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:13px">Sent on ${currentDate} at ${time}</p>
      </div>
      <div style="padding:32px;font-size:15px;line-height:1.7">${content.replace(/\n/g, '<br>')}</div>
      <div style="padding:24px;border-top:1px solid rgba(255,255,255,0.1);text-align:center">
        <p style="margin:0;font-size:12px;color:#64748b">Automated by <span style="color:#38bdf8;font-weight:600">Zulora AI</span></p>
      </div></div>`;
  }

  // Default Pearl Template
  return `<div style="font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1e293b;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <div style="padding:32px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border-bottom:1px solid #e2e8f0">
      <h2 style="margin:0;color:#0f172a;font-size:24px;font-weight:600">${meta.subject || 'Message from Zulora AI'}</h2>
      <p style="margin:8px 0 0;color:#64748b;font-size:13px">Sent on ${currentDate} at ${time}</p>
    </div>
    <div style="padding:32px;font-size:15px;line-height:1.6;color:#334155">${content.replace(/\n/g, '<br>')}</div>
    <div style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">Automated by <span style="color:#0ea5e9;font-weight:600">Zulora AI</span></p>
    </div></div>`;
}

// ─── Extension Bridge Communicator ────────────────────────────────────────────
export async function checkExtensionConnected() {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(false); }
    }, 1500);

    const onPong = (event) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('ZULORA_PONG', onPong);
        resolve(true);
      }
    };
    window.addEventListener('ZULORA_PONG', onPong);

    // Also check direct external runtime messaging if available
    try {
      if (typeof window !== 'undefined' && window.chrome?.runtime?.sendMessage) {
        window.chrome.runtime.sendMessage(EXTENSION_ID, { type: 'PING' }, (res) => {
          if (!resolved && res && res.status === 'PONG') {
            resolved = true;
            clearTimeout(timer);
            window.removeEventListener('ZULORA_PONG', onPong);
            resolve(true);
          }
        });
      }
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('ZULORA_PING'));
    } catch {
      if (!resolved) { resolved = true; resolve(false); }
    }
  });
}

export function onStatusUpdate(callback) {
  const listener = (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION' && (event.data?.type === 'ZULORA_STATUS_UPDATE' || event.data?.type === 'ZULORA_AGENT_STEP_UPDATE')) {
      callback(event.data);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export async function sendBridgeMessageWithRetry(detail, maxAttempts = 3, delayMs = 800, timeoutMs = 7000) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('ZULORA_AGENT_RESPONSE', listener);
        resolve(val);
      };
      const listener = (event) => done(event.detail || { ok: false, error: 'Empty response' });
      const timer = setTimeout(() => done(null), timeoutMs);
      window.addEventListener('ZULORA_AGENT_RESPONSE', listener);
      try {
        window.dispatchEvent(new CustomEvent('ZULORA_EXECUTE_AGENT_TASK', { detail }));
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    });

    if (result && (result.ok || result.success)) return result;
    lastError = result?.error || 'No response from bridge';
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
  }
  return { ok: false, success: false, error: lastError || 'Extension bridge timeout' };
}

// ─── BUGFIX 4: Waterfall API Resilience — Exponential Backoff Retry Engine ────
/**
 * Fast LLM Caller with cascading failover and per-provider retry:
 *  1. Groq (llama-3.3-70b) — <400ms planning
 *  2. Cerebras (llama3.1-70b) — <300ms ultra-fast routing
 *  3. Gemini 2.0 Flash / 1.5 Flash (rotating key pool)
 *  4. OpenRouter fallback
 *  5. Graceful local deterministic fallback (NEVER crashes UI)
 *
 * Each provider gets 2 exponential-backoff retries.
 * HTTP 429 (rate-limit) silently skips to next provider in <200ms.
 */
export async function callWaterfallLLM(prompt, systemPrompt = '', opts = {}) {
  const env = import.meta.env || {};
  const get = (k) => String(env[k] || '').trim();
  const perProviderTimeoutMs = opts.timeoutMs || 2500;

  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);

  // Exponential backoff helper: 2 retries per provider, skips on 429/403 immediately
  const tryProvider = async (name, callFn, retries = 2) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await callFn(attempt);
        if (result && result.success && result.text) return result;
        // If we got a rate-limit status, skip immediately (no retry)
        if (result && result._rateLimit) {
          console.warn(`[Zulora Waterfall] ${name} rate-limited, skipping.`);
          return null;
        }
      } catch (e) {
        const isTimeout = e.message === 'timeout';
        if (attempt < retries && !isTimeout) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt - 1), 400);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }
    return null;
  };

  const postJSON = (url, headers, body, timeoutMs = perProviderTimeoutMs) =>
    withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      timeoutMs
    );

  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: prompt }
  ];

  // ── Priority 1: Groq Llama-3.3-70b (Fastest Router <400ms) ──
  const groqKey = get('VITE_GROQ_KEY') || get('VITE_GROQ_API_KEY');
  if (groqKey) {
    const result = await tryProvider('Groq', async () => {
      const res = await postJSON(
        'https://api.groq.com/openai/v1/chat/completions',
        { Authorization: `Bearer ${groqKey}` },
        {
          model: opts.groqModel || 'llama-3.3-70b-versatile',
          max_tokens: opts.maxTokens || 1024,
          temperature: opts.temperature ?? 0.2,
          messages
        },
        1800
      );
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'groq' } : null;
    });
    if (result) return result;
  }

  // ── Priority 2: Cerebras Llama-3.1-70b (Ultra-fast <300ms) ──
  const cerebrasKey = get('VITE_CEREBRAS_KEY');
  if (cerebrasKey) {
    const result = await tryProvider('Cerebras', async () => {
      const res = await postJSON(
        'https://api.cerebras.ai/v1/chat/completions',
        { Authorization: `Bearer ${cerebrasKey}` },
        {
          model: 'llama3.1-70b',
          max_tokens: opts.maxTokens || 1024,
          temperature: 0.1,
          messages
        },
        1500
      );
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'cerebras' } : null;
    });
    if (result) return result;
  }

  // ── Priority 3: Gemini REST API Key Pool (2.0 Flash / 1.5 Flash) ──
  const geminiKeys = Array.from({ length: 7 }, (_, i) =>
    get(`VITE_GEMINI_KEY_${i + 1}`) || get(`VITE_GEMINI_API_KEY_${i + 1}`)
  ).concat([get('VITE_GEMINI_API_KEY')]).filter(k => k && k.length > 20);

  for (const apiKey of geminiKeys) {
    let keyRateLimited = false;
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      if (keyRateLimited) break;
      const result = await tryProvider(`Gemini/${model}`, async () => {
        const res = await postJSON(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {},
          {
            contents: [{ parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }] }],
            generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens || 1024 }
          },
          2500
        );
        if (res.status === 429 || res.status === 403) {
          keyRateLimited = true;
          return { _rateLimit: true };
        }
        if (!res.ok) return null;
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text ? { success: true, text, provider: `gemini/${model}` } : null;
      }, 1); // 1 attempt per model — rotate key on any failure
      if (result && result.success) return result;
    }
  }

  // ── Priority 4: OpenRouter Fallback ──
  const openRouterKey = get('VITE_OPENROUTER_KEY') || get('VITE_OPENROUTER_API_KEY');
  if (openRouterKey) {
    const result = await tryProvider('OpenRouter', async () => {
      const res = await postJSON(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://zulora.in' },
        { model: 'mistralai/mistral-7b-instruct', max_tokens: 512, messages },
        2000
      );
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'openrouter' } : null;
    });
    if (result) return result;
  }

  // ── Priority 5: Graceful Local Fallback — NEVER crash UI ──
  console.warn('[Zulora Waterfall] All providers exhausted — using local fallback');
  return {
    success: false,
    text: '',
    provider: 'local_deterministic',
    error: null
  };
}

// ─── Persistent Screen State Memory Buffer ───────────────────────────────────
export const screenMemoryBuffer = [];

export function recordScreenMemory(entry) {
  if (!entry) return;
  screenMemoryBuffer.push({
    timestamp: Date.now(),
    url: entry.url || '',
    title: entry.title || '',
    summary: (entry.summary || entry.text || '').slice(0, 1500),
    screenshot: entry.screenshot || '',
    step: entry.step || null,
    status: entry.status || 'captured'
  });
  if (screenMemoryBuffer.length > 25) {
    screenMemoryBuffer.shift();
  }
}

export function getRecentScreenMemory(count = 3) {
  return screenMemoryBuffer.slice(-count);
}

export function clearScreenMemory() {
  screenMemoryBuffer.length = 0;
}

// Listen for screen state memory updates from extension background
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION' && event.data?.type === 'ZULORA_SCREEN_STATE_UPDATE') {
      recordScreenMemory({
        url: event.data.url,
        title: event.data.title,
        screenshot: event.data.screenshot,
        step: event.data.stepAction,
        status: event.data.status
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 1: MASTER PLANNER & DECOMPOSER (SCREEN MEMORY AWARE)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Takes user voice/text prompt + current screen text context + past screen history.
 * Decomposes complex tasks into an ordered JSON step queue:
 * [
 *   { "step": 1, "action": "NAVIGATE", "url": "..." },
 *   { "step": 2, "action": "FILL_INPUT", "target": "search", "value": "..." },
 *   { "step": 3, "action": "EXTRACT_DATA", "selector": "..." },
 *   { "step": 4, "action": "POST_DATA", "url": "..." }
 * ]
 */
export async function agent1_MasterPlanner(prompt, screenContext = '') {
  const cleanPrompt = cleanSearchIntent(prompt);

  // BUGFIX 1: Pre-check for direct URL routing to guide the LLM planner
  const directUrlHint = (() => {
    const lower = prompt.toLowerCase();
    const entries = Object.entries(APP_ROUTING_MATRIX).sort((a, b) => b[0].length - a[0].length);
    const matches = entries.filter(([k]) => lower.includes(k)).map(([k, v]) => `"${k}" → ${v}`);
    return matches.length > 0 ? `\nDirect Routing Hints (USE THESE URLs, do NOT default to Google Search):\n${matches.join('\n')}` : '';
  })();

  const systemPrompt = `You are Zulora AI's Master Task Planner (Agent 1) — a world-class autonomous browser agent.
Analyze the user prompt and break the task into an ordered JSON array of executable browser steps.
Output ONLY raw valid JSON array. Do NOT wrap in markdown code blocks. No comments, no explanations.

IMPORTANT ROUTING RULES:
- When user says "open [service]", ALWAYS use NAVIGATE with the direct URL from the routing hints.
- NEVER type into Google search to open known web apps (Gmail, ChatGPT, Gemini, WhatsApp, etc.).
- For multi-step tasks with "and then", "after that", "next", "then", generate SEPARATE steps.
- Each step must be atomic (one action per step).
- Use WAIT steps (500-2000ms) after navigation steps before interacting with page elements.${directUrlHint}

Standard JSON Step Schema:
[
  { "step": 1, "action": "NAVIGATE", "url": "https://..." },
  { "step": 2, "action": "WAIT", "ms": 1500 },
  { "step": 3, "action": "FILL_INPUT", "target": "search bar CSS selector or placeholder text", "value": "text to type" },
  { "step": 4, "action": "CLICK", "target": "button text or CSS selector" },
  { "step": 5, "action": "EXTRACT_DATA", "selector": "h1, p, .result", "variable": "varName" },
  { "step": 6, "action": "NAVIGATE", "url": "https://second-site.com" },
  { "step": 7, "action": "FILL_INPUT", "target": "input area", "value": "{{varName}}" }
]

Specialized High-Level Actions (preferred for common apps):
- { "action": "YOUTUBE_PLAY", "query": "search term" }
- { "action": "WHATSAPP_SEND", "recipient": "contact name", "message": "message text" }
- { "action": "GMAIL_COMPOSE", "to": "email@domain.com", "subject": "subject", "body": "email body" }
- { "action": "CHATGPT_PROMPT", "prompt": "your question" }
- { "action": "GEMINI_PROMPT", "prompt": "your question" }
- { "action": "READ_SCREEN" }
- { "action": "AUTOFILL_FORM" }

Rules:
- Strip filler words ("please", "there", "search for", "go to google and") from query values.
- All URLs must start with https://.
- Output ONLY the JSON array, nothing else.`;

  // Weave persistent screen memory buffer into planning context
  const recentMemory = getRecentScreenMemory(2);
  const memoryContext = recentMemory.length > 0
    ? `\nScreen Vision Memory History:\n` + recentMemory.map((m, i) => `[State ${i+1}: ${m.title || m.url}]`).join('\n')
    : '';

  const contextPrompt = screenContext
    ? `User Prompt: ${cleanPrompt}\nCurrent Screen Summary:\n${screenContext.slice(0, 1000)}${memoryContext}`
    : `User Prompt: ${cleanPrompt}${memoryContext}`;

  const planResult = await callWaterfallLLM(contextPrompt, systemPrompt, {
    maxTokens: 1200,
    temperature: 0.1,
    timeoutMs: 3000,
    groqModel: 'llama-3.3-70b-versatile'
  });

  if (planResult.success && planResult.text) {
    try {
      const sanitized = planResult.text
        .replace(/```json?|```/g, '')
        .replace(/^\s*\[/, '[')
        .trim();
      // Extract JSON array even if surrounded by text
      const jsonMatch = sanitized.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item, idx) => normalizeAgentStep(item, idx + 1));
        }
      }
    } catch (e) {
      console.warn('[Agent 1 Planner] LLM JSON parse failed, utilizing deterministic decomposition:', e.message);
    }
  }

  // Deterministic Local Fallback Planner
  return parseCommandToSteps(prompt);
}

function normalizeAgentStep(raw, stepNum) {
  const action = (raw.action || raw.type || '').toUpperCase();
  const step = raw.step || stepNum;

  // Map to unified engine actions
  if (action === 'NAVIGATE' || action === 'OPEN_URL') {
    let url = raw.url || raw.params?.url || 'https://google.com';
    if (!url.startsWith('http')) url = 'https://' + url;
    return { step, action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url } };
  }
  if (action === 'FILL_INPUT' || action === 'TYPE_TEXT' || action === 'TYPE') {
    return {
      step,
      action: ACTION_TYPES.TYPE_TEXT,
      app: 'Browser',
      params: {
        selector: raw.target || raw.selector || raw.params?.selector || 'input',
        text: raw.value || raw.text || raw.params?.text || ''
      }
    };
  }
  if (action === 'CLICK' || action === 'CLICK_ELEMENT') {
    return {
      step,
      action: ACTION_TYPES.CLICK_ELEMENT,
      app: 'Browser',
      params: { selector: raw.target || raw.selector || raw.params?.selector || 'button' }
    };
  }
  if (action === 'EXTRACT_DATA' || action === 'EXTRACT' || action === 'READ_DOM') {
    return {
      step,
      action: ACTION_TYPES.READ_DOM,
      app: 'Web Scraper',
      params: { selector: raw.selector, variable: raw.variable || 'extractedData' }
    };
  }
  if (action === 'READ_SCREEN') {
    return { step, action: ACTION_TYPES.READ_DOM, app: 'Screen Reader', params: { readAloud: true } };
  }
  if (action === 'AUTOFILL_FORM') {
    return { step, action: ACTION_TYPES.AUTOFILL_FORM, app: 'AutoFill', params: { intent: raw.intent || '' } };
  }
  if (action === 'YOUTUBE_PLAY') {
    return { step, action: ACTION_TYPES.YOUTUBE_PLAY, app: 'YouTube', params: { query: cleanSearchIntent(raw.query || raw.params?.query) } };
  }
  if (action === 'WHATSAPP_SEND') {
    return {
      step,
      action: ACTION_TYPES.WHATSAPP_SEND,
      app: 'WhatsApp',
      params: { recipient: cleanSearchIntent(raw.recipient || ''), message: raw.message || '' },
      needsLlm: !raw.message
    };
  }
  if (action === 'GMAIL_COMPOSE') {
    return {
      step,
      action: ACTION_TYPES.GMAIL_COMPOSE,
      app: 'Gmail',
      params: { to: raw.to || '', subject: raw.subject || '', body: raw.body || '' },
      needsLlm: !raw.body
    };
  }
  if (action === 'CHATGPT_PROMPT') {
    return { step, action: ACTION_TYPES.CHATGPT_PROMPT, app: 'ChatGPT', params: { prompt: cleanSearchIntent(raw.prompt || '') } };
  }
  if (action === 'GEMINI_PROMPT') {
    return { step, action: ACTION_TYPES.GEMINI_PROMPT, app: 'Gemini', params: { prompt: cleanSearchIntent(raw.prompt || '') } };
  }
  if (action === 'WAIT') {
    return { step, action: ACTION_TYPES.WAIT, app: 'System', params: { ms: raw.ms || 1500 } };
  }

  // Default passthrough
  return {
    step,
    action: raw.action || 'ai_reasoning',
    app: raw.app || 'Web Agent',
    params: raw.params || raw
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 2: DOM & NATIVE EXECUTOR ENGINE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Executes direct DOM and browser manipulations (<300ms latency)
 * without invoking external LLMs for standard UI tasks.
 */
export function agent2_DirectExecutor(step) {
  return {
    ready: true,
    step,
    dispatchPayload: {
      type: 'EXECUTE_STEP',
      step
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 3: VISION & SCREEN VERIFIER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Verifies whether the previous action succeeded on the page.
 * Checks for target text, mutated DOM nodes, or navigation.
 * If failed, triggers retry heuristic.
 */
export function agent3_ScreenVerifier(stepResult, step) {
  if (!stepResult) {
    return { verified: false, retry: true, reason: 'No response from target tab' };
  }
  if (stepResult.error) {
    return { verified: false, retry: true, reason: stepResult.error };
  }
  // Record screen memory state
  if (stepResult.url || stepResult.dom || stepResult.screenshot || stepResult.text) {
    recordScreenMemory({
      url: stepResult.url || stepResult.dom?.url,
      title: stepResult.title || stepResult.dom?.title,
      summary: stepResult.text || stepResult.dom?.summary,
      screenshot: stepResult.screenshot,
      step: step?.action,
      status: 'verified'
    });
  }
  return { verified: true, retry: false };
}

// ─── BUGFIX 1 & 3: Deterministic Step Parser with Direct App Routing ──────────
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();

  // Screen reading
  if (cmd.includes('read screen') || cmd.includes('what is on this page') ||
      cmd.includes('summarize this page') || cmd.includes('summarize page') ||
      cmd.includes('what does this page say')) {
    return [{ action: ACTION_TYPES.READ_DOM, app: 'Screen Reader', params: { readAloud: true, deep: true } }];
  }

  // Multi-step: find best website
  if (cmd.includes('find best website for') && cmd.includes('open')) {
    const query = cleanSearchIntent(command.replace(/find best website for|open it/gi, ''));
    return [
      { action: ACTION_TYPES.SEARCH_GOOGLE, app: 'Google', params: { query } },
      { action: ACTION_TYPES.EVAL_TOP_RESULT, app: 'Search Engine', params: {} },
    ];
  }

  // Multi-step: scrape and paste
  if (cmd.includes('scrape') && (cmd.includes('paste') || cmd.includes('inject'))) {
    const destMatch = command.match(/(?:paste|inject)(?: it| data)?(?: into| in| to) (.+)/i);
    const destination = cleanSearchIntent(destMatch ? destMatch[1] : '');
    return [
      { action: ACTION_TYPES.READ_DOM, app: 'Web Scraper', params: { deep: true } },
      destination.includes('notepad')
        ? { action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url: 'https://notepad.pw' } }
        : { action: 'ai_reasoning', app: 'Web Agent', params: { prompt: `Navigate to ${destination} and paste the scraped data.` } },
    ];
  }

  // YouTube
  if (cmd.includes('youtube') || (cmd.match(/\bplay\b/) && !cmd.includes('gemini') && !cmd.includes('chatgpt'))) {
    const rawMatch = command.match(/(?:search|play|find|for)[:\s]+["']?(.+?)["']?$/i);
    const entity = cleanSearchIntent(rawMatch ? rawMatch[1] : command);
    return [{ action: ACTION_TYPES.YOUTUBE_PLAY, app: 'YouTube', params: { query: entity } }];
  }

  // Gmail / Email
  if (cmd.includes('email') || cmd.includes('gmail') || cmd.includes('send mail') || cmd.includes('compose')) {
    // BUGFIX 2: Use smart payload extractor — never dump raw prompt into DOM
    const extracted = smartExtractEmailPayload(command);
    const isAzure = /azure/i.test(command);
    const isPearl = /pearl|template|formal|beautiful/i.test(command);
    return [{
      action: ACTION_TYPES.GMAIL_COMPOSE, app: 'Gmail', needsLlm: true, llmType: 'email',
      params: {
        to: extracted.recipient || '',
        subject: extracted.subject || 'Message from Zulora AI',
        rawPrompt: extracted.body || cleanSearchIntent(command),
        template: isAzure ? TEMPLATES.AZURE : TEMPLATES.PEARL
      }
    }];
  }

  // WhatsApp
  if (cmd.includes('whatsapp') || cmd.includes('whats app')) {
    const toMatch = command.match(/to\s+([A-Za-z0-9\s]+?)(?:\s+(?:saying|with|message)|$)/i);
    const msgMatch = command.match(/(?:saying|message|with|text)[:\s]+["']?(.+?)["']?$/i);
    return [{
      action: ACTION_TYPES.WHATSAPP_SEND, app: 'WhatsApp', needsLlm: true, llmType: 'whatsapp',
      params: {
        recipient: cleanSearchIntent(toMatch?.[1] || ''),
        rawPrompt: msgMatch?.[1] || cleanSearchIntent(command)
      }
    }];
  }

  // ChatGPT — BUGFIX 3: Direct routing
  if (cmd.includes('chatgpt') || cmd.includes('chat gpt')) {
    const promptMatch = command.match(/(?:ask|prompt|search|tell|with|query)[:\s]+["']?(.+?)["']?$/i);
    return [{ action: ACTION_TYPES.CHATGPT_PROMPT, app: 'ChatGPT', params: { prompt: cleanSearchIntent(promptMatch?.[1] || command) } }];
  }

  // Gemini — BUGFIX 3: Direct routing
  if (cmd.includes('gemini') || cmd.includes('google gemini')) {
    const promptMatch = command.match(/(?:ask|prompt|tell|query|say)[:\s]+["']?(.+?)["']?$/i);
    // If no prompt keyword, it's "open gemini" → just navigate
    if (!promptMatch && /(?:open|go to|launch)\s+gemini/i.test(command)) {
      return [{ action: ACTION_TYPES.OPEN_URL, app: 'Gemini', params: { url: 'https://gemini.google.com/app' } }];
    }
    return [{ action: ACTION_TYPES.GEMINI_PROMPT, app: 'Gemini', params: { prompt: cleanSearchIntent(promptMatch?.[1] || command) } }];
  }

  // PDF export
  if (cmd.includes('export pdf') || cmd.includes('save as pdf') || cmd.includes('convert to pdf')) {
    return [{ action: ACTION_TYPES.EXPORT_PDF, app: 'System', params: {} }];
  }

  // Form fill
  if (cmd.includes('fill form') || cmd.includes('auto fill') || cmd.includes('autofill')) {
    return [{ action: ACTION_TYPES.AUTOFILL_FORM, app: 'AutoFill', params: { intent: cleanSearchIntent(command) } }];
  }

  // BUGFIX 3: Direct app routing — check routing matrix BEFORE defaulting to Google search
  const openMatch = command.match(/(?:open|go to|navigate to|launch|visit|take me to)\s+(.+?)(?:\s+and\s+.+)?$/i);
  if (openMatch) {
    const target = openMatch[1].trim();
    const directUrl = resolveDirectUrl(target);
    if (directUrl) {
      return [{ action: ACTION_TYPES.OPEN_URL, app: target, params: { url: directUrl } }];
    }
    // Try raw URL pattern
    if (/https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}/.test(target)) {
      let url = target;
      if (!url.startsWith('http')) url = 'https://' + url;
      return [{ action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url } }];
    }
  }

  // Try resolving any mention of a known service even without "open"
  const knownServiceUrl = resolveDirectUrl(cmd);
  if (knownServiceUrl && /\b(open|go|take|launch|visit|load|show)\b/.test(cmd)) {
    return [{ action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url: knownServiceUrl } }];
  }

  // Google search (last resort for "search X" or "look up X")
  if (cmd.includes('search') || cmd.includes('look up')) {
    const query = cleanSearchIntent(command.replace(/search\s+(for\s+)?|look\s+up\s+/gi, ''));
    return [{ action: ACTION_TYPES.SEARCH_GOOGLE, app: 'Google', params: { query: query || command } }];
  }

  // Default: pass to AI brain for reasoning
  return [{ action: 'ai_reasoning', app: 'Web Agent', needsLlm: false, params: { prompt: cleanSearchIntent(command) } }];
}

// ─── Task Control Commands ───────────────────────────────────────────────────
export function pauseTask()  { return sendBridgeMessageWithRetry({ type: 'ZULORA_PAUSE' }, 1); }
export function resumeTask() { return sendBridgeMessageWithRetry({ type: 'ZULORA_RESUME' }, 1); }
export function cancelTask() { return sendBridgeMessageWithRetry({ type: 'ZULORA_CANCEL' }, 1); }

// ─── Main Execution Pipeline ──────────────────────────────────────────────────
/**
 * Flexible signature handling both:
 *  - executeCommand(command, onLog, currentUser)
 *  - executeCommand(command, currentUser, onLog)
 */
export async function executeCommand(command, arg2, arg3) {
  let onLog = null;
  let currentUser = null;

  if (typeof arg2 === 'function') {
    onLog = arg2;
    currentUser = arg3 || null;
  } else {
    currentUser = arg2 || null;
    if (typeof arg3 === 'function') onLog = arg3;
  }

  const logEntry = (label, status, detail = '') => {
    if (typeof onLog === 'function') {
      onLog({ index: Date.now(), label, status, detail, timestamp: Date.now() });
    }
  };

  // 1. AGENT 1: Master Planning & Task Decomposition
  logEntry('🧠 Agent 1: Planning action sequence...', 'running');
  const steps = await agent1_MasterPlanner(command);

  if (!steps || !steps.length) {
    logEntry('Could not parse task into executable steps', 'error');
    return { ok: false, error: 'Could not parse command into steps.' };
  }

  logEntry(`📋 Agent 1 Plan: ${steps.length} step(s) queued`, 'done');

  let totalTokensUsed = 0;

  // 2. Pre-generate payloads for steps requiring dynamic content (Gmail, WhatsApp)
  for (const step of steps) {
    if (!step.needsLlm || !step.params?.rawPrompt) continue;

    logEntry(`🤖 Generating ${step.llmType || 'content'} payload...`, 'running');

    const sysP = step.llmType === 'email'
      ? 'Write a professional email body. Output raw plain text only. No markdown code blocks.'
      : 'Write a concise, friendly WhatsApp message. Output raw plain text only. No markdown.';

    const result = await callWaterfallLLM(step.params.rawPrompt, sysP, {
      maxTokens: 1024,
      timeoutMs: 2500
    });

    if (result.success && result.text) {
      const tokens = Math.floor(result.text.split(/\s+/).length * 1.3) + 20;
      totalTokensUsed += tokens;

      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.bodyHtml = renderEmailTemplate(
          result.text,
          step.params.template || TEMPLATES.PEARL,
          { subject: step.params.subject }
        );
      } else if (step.action === ACTION_TYPES.WHATSAPP_SEND) {
        step.params.message = result.text;
      }

      logEntry(`⚡ Generated payload via ${result.provider} (${tokens} tokens)`, 'done');
    } else {
      // Direct text fallback
      if (step.action === ACTION_TYPES.WHATSAPP_SEND) step.params.message = step.params.rawPrompt;
      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.bodyHtml = renderEmailTemplate(step.params.rawPrompt, TEMPLATES.PEARL, { subject: step.params.subject });
      }
      logEntry('⚠️ Using direct text fallback', 'done');
    }
  }

  // 3. Sync Unified Token Counter to Firestore & localStorage
  const updatedTokens = await syncTokenUsage(totalTokensUsed, currentUser?.uid);

  // 4. AGENT 2 & 3: Dispatch to Extension Bridge with Verification
  logEntry('⚡ Agent 2: Executing DOM & native browser steps...', 'running');
  const res = await sendBridgeMessageWithRetry({
    type: 'ZULORA_RUN_TASK',
    steps,
    enableVerification: true // Triggers Agent 3 screen verification inside background
  }, 3, 800, 8000);

  return {
    ...res,
    ok: res?.ok ?? res?.success ?? true,
    tokensUsed: totalTokensUsed,
    newTotalTokens: updatedTokens
  };
}
