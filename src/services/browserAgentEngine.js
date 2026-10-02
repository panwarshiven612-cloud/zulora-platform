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
import { doc, setDoc, getDoc, increment } from 'firebase/firestore';

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
  GMAIL_ANALYZE_INBOX: 'gmail_analyze_inbox',
  GMAIL_READ:      'gmail_read_inbox',
  EXPORT_DATA_TO_SHEETS: 'export_data_to_sheets',
  CHATGPT_PROMPT:  'chatgpt_prompt',
  GEMINI_PROMPT:   'gemini_prompt',
  WHATSAPP_SEND:   'whatsapp_send',
  EXPORT_PDF:      'export_pdf',
  EXPORT_CODE:     'export_code',
  DOWNLOAD_FILE:   'download_file',
  CAPTURE_SCREENSHOT: 'capture_screenshot',
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
  'zulora school':   'https://school.zulora.in',
  'zulora drive':    'https://drive.zulora.in',
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
  const systemPrompt = 'Act as an intent and copywriting processor. Return ONLY JSON {"subject":"...","body":"...","isHtml":false}. Write a polished complete email based on the intent, not a verbatim copy of the instruction. Include greeting and sign-off. Do not invent facts.';

  const llmResult = await callWaterfallLLM(rawPrompt, systemPrompt, {
    maxTokens: 600,
    temperature: 0.3,
    timeoutMs: 3000,
    groqModel: 'llama-3.3-70b-versatile'
  });

  let structured = {};
  try {
    const json = llmResult.text?.replace(/```json?|```/gi, '').match(/\{[\s\S]*\}/)?.[0];
    if (llmResult.success && json) structured = JSON.parse(json);
  } catch {}
  const bodyText = String(structured.body || '').trim() || 'Hello,\n\nI wanted to share an update with you. Please let me know if you have any questions.\n\nBest regards,\nZulora AI';
  const subject = String(meta.subject || structured.subject || 'A quick update').trim();
  const bodyHtml = renderEmailTemplate(bodyText, template, { subject });

  return {
    bodyText,
    bodyHtml,
    subject,
    isHtml: true,
    tokensUsed: Number(llmResult.tokensUsed) || 0,
    provider: llmResult.provider || 'fallback'
  };
}

// ─── Token Synchronization Engine ───────────────────────────────────────────────
export async function syncTokenUsage(tokensConsumed, userId) {
  if (!Number.isFinite(Number(tokensConsumed)) || Number(tokensConsumed) <= 0) {
    return parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  }
  const amount = Math.floor(Number(tokensConsumed));
  let currentTotal = parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  currentTotal += amount;
  localStorage.setItem('zulora_total_tokens', currentTotal.toString());

  if (userId && db && typeof doc === 'function') {
    try {
      const userRef = doc(db, 'users', userId);
      await setDoc(userRef, {
        tokensUsed: increment(amount),
        tokenUsage: increment(amount)
      }, { merge: true });
      const snap = await getDoc(userRef);
      const newTotal = Math.max(currentTotal, Number(snap.data()?.tokensUsed || snap.data()?.tokenUsage) || 0);
      localStorage.setItem('zulora_total_tokens', String(newTotal));
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
  const rawContent = typeof bodyHtml === 'object' ? Object.values(bodyHtml).join('\n') : String(bodyHtml || '');
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const content = escapeHtml(rawContent).replace(/\n/g, '<br>');
  const safeSubject = escapeHtml(meta.subject || 'Message from Zulora AI');

  if (templateType === TEMPLATES.AZURE || templateType === 'azure') {
    return `<div style="font-family:'Inter',-apple-system,sans-serif;background:linear-gradient(135deg,#0c1a2e,#0f2a4a);color:#e2e8f0;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">
      <div style="padding:32px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <h2 style="margin:0;color:#007AFF;font-size:24px;font-weight:600">${safeSubject}</h2>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:13px">Sent on ${currentDate} at ${time}</p>
      </div>
      <div style="padding:32px;font-size:15px;line-height:1.7">${content}</div>
      <div style="padding:24px;border-top:1px solid rgba(255,255,255,0.1);text-align:center">
        <p style="margin:0;font-size:12px;color:#64748b">Automated by <span style="color:#38bdf8;font-weight:600">Zulora AI</span></p>
      </div></div>`;
  }

  // Default Pearl Template
  return `<div style="font-family:'Inter',-apple-system,sans-serif;background:#F8F9FA;color:#1e293b;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <div style="padding:32px;background:#F8F9FA;border-bottom:1px solid #e2e8f0">
      <h2 style="margin:0;color:#007AFF;font-size:24px;font-weight:600">${safeSubject}</h2>
      <p style="margin:8px 0 0;color:#64748b;font-size:13px">Sent on ${currentDate} at ${time}</p>
    </div>
    <div style="padding:32px;font-size:15px;line-height:1.6;color:#334155">${content}</div>
    <div style="padding:24px 32px;background:#F8F9FA;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">Automated by <span style="color:#007AFF;font-weight:600">Zulora AI</span></p>
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
  const perProviderTimeoutMs = Math.min(Number(opts.timeoutMs) || 1800, 1800);
  const groqTimeoutMs = Math.min(Number(opts.groqTimeoutMs) || 1500, 1500);
  const failures = [];
  const report = (name, status, detail = '') => {
    const timestamp = Date.now();
    console.info(`[Zulora Waterfall] ${name}: ${status}${detail ? ` — ${detail}` : ''}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ZULORA_ACTION_LOG_UPDATE', {
        detail: { label: `LLM ${name}: ${status}`, status: status === 'complete' || status === 'skipped' ? 'done' : status === 'failed' ? 'error' : 'running', detail, timestamp }
      }));
    }
  };

  // Retry transient errors with bounded exponential backoff; rate limits go straight to the next tier.
  const tryProvider = async (name, callFn, retries = 2) => {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      report(name, 'running', `attempt ${attempt}/${retries}`);
      try {
        const result = await callFn(attempt);
        if (result && result.success && result.text) {
          report(name, 'complete', `${result.tokensUsed || 0} tokens`);
          return result;
        }
        if (result && result._rateLimit) {
          lastError = new Error(result.error || 'HTTP 429 rate limit');
          break;
        }
        lastError = new Error(result?.error || 'Provider returned an empty response.');
      } catch (e) {
        lastError = e;
        const status = Number(e?.status || e?.response?.status);
        if (status >= 400 && status < 500 && status !== 429) break;
      }
      if (attempt < retries) {
        const delay = Math.min(400, 100 * (2 ** (attempt - 1)));
        report(name, 'retrying', `${lastError?.message || 'No response'}; retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    const reason = `${name}: ${lastError?.message || 'provider returned no response'}`;
    failures.push(reason);
    report(name, 'failed', reason.slice(name.length + 2));
    return null;
  };

  const postJSON = (url, headers, body, timeoutMs = perProviderTimeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
  };

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
        groqTimeoutMs
      );
      if (res.status === 429) return { _rateLimit: true, error: 'HTTP 429 rate limit' };
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const tokensUsed = Number(data?.usage?.total_tokens) || 0;
      return text ? { success: true, text, provider: 'groq', tokensUsed } : null;
    }, 2);
    if (result) return result;
  } else {
    failures.push('Groq: API key not configured');
    report('Groq', 'skipped', 'API key not configured');
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
        perProviderTimeoutMs
      );
      if (res.status === 429) return { _rateLimit: true, error: 'HTTP 429 rate limit' };
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const tokensUsed = Number(data?.usage?.total_tokens) || 0;
      return text ? { success: true, text, provider: 'cerebras', tokensUsed } : null;
    }, 2);
    if (result) return result;
  } else {
    failures.push('Cerebras: API key not configured');
    report('Cerebras', 'skipped', 'API key not configured');
  }

  // ── Priority 3: Gemini REST API Key Pool (2.0 Flash / 1.5 Flash) ──
  const geminiKeys = Array.from({ length: 7 }, (_, i) =>
    get(`VITE_GEMINI_KEY_${i + 1}`) || get(`VITE_GEMINI_API_KEY_${i + 1}`)
  ).concat([get('VITE_GEMINI_API_KEY')]).filter(k => k && k.length > 20);
  if (!geminiKeys.length) {
    failures.push('Gemini: API key not configured');
    report('Gemini', 'skipped', 'API key not configured');
  }

  const geminiDeadline = Date.now() + perProviderTimeoutMs;
  for (const apiKey of geminiKeys) {
    let keyRateLimited = false;
    for (const model of ['gemini-2.0-flash']) {
      if (keyRateLimited) break;
      const remainingMs = geminiDeadline - Date.now();
      if (remainingMs <= 0) break;
      const result = await tryProvider(`Gemini/${model}`, async () => {
        const res = await postJSON(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {},
          {
            contents: [{ parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }] }],
            generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens || 1024 }
          },
          remainingMs
        );
        if (res.status === 429) {
          keyRateLimited = true;
          return { _rateLimit: true, error: 'HTTP 429 rate limit' };
        }
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const tokensUsed = Number(data?.usageMetadata?.totalTokenCount) || 0;
        return text ? { success: true, text, provider: `gemini/${model}`, tokensUsed } : null;
      }, 1); // Rotate to the next credential on failure.
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
        perProviderTimeoutMs
      );
      if (res.status === 429) return { _rateLimit: true, error: 'HTTP 429 rate limit' };
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const tokensUsed = Number(data?.usage?.total_tokens) || 0;
      return text ? { success: true, text, provider: 'openrouter', tokensUsed } : null;
    }, 2);
    if (result) return result;
  } else {
    failures.push('OpenRouter: API key not configured');
    report('OpenRouter', 'skipped', 'API key not configured');
  }

  const message = failures.length ? failures.join(' | ') : 'No LLM API credentials are configured.';
  report('Waterfall', 'failed', message);
  throw new Error(`All LLM providers failed. ${message}`);
}

// ─── Persistent Screen State Memory Buffer ───────────────────────────────────
export const screenMemoryBuffer = [];

export function recordScreenMemory(entry) {
  if (!entry) return;
  const memoryEntry = {
    timestamp: Date.now(),
    url: entry.url || '',
    title: entry.title || '',
    summary: (entry.summary || entry.text || '').slice(0, 1500),
    screenshot: entry.screenshot || '',
    step: entry.step || null,
    status: entry.status || 'captured'
  };
  screenMemoryBuffer.push(memoryEntry);
  if (screenMemoryBuffer.length > 25) {
    screenMemoryBuffer.shift();
  }
  try {
    const persisted = JSON.parse(localStorage.getItem('zulora_session_memory') || '[]');
    localStorage.setItem('zulora_session_memory', JSON.stringify([...persisted, { ...memoryEntry, screenshot: '' }].slice(-12)));
  } catch {}
}

export function getRecentScreenMemory(count = 3) {
  if (!screenMemoryBuffer.length && typeof localStorage !== 'undefined') {
    try {
      const persisted = JSON.parse(localStorage.getItem('zulora_session_memory') || '[]');
      if (Array.isArray(persisted)) screenMemoryBuffer.push(...persisted.slice(-12));
    } catch {}
  }
  return screenMemoryBuffer.slice(-count);
}

export function clearScreenMemory() {
  screenMemoryBuffer.length = 0;
  try { localStorage.removeItem('zulora_session_memory'); } catch {}
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

  // Inbox analysis is deterministic so Gmail read/copy requests can never become compose actions.
  if (isGmailInboxAnalysisIntent(prompt)) {
    return { steps: parseCommandToSteps(prompt), tokensUsed: 0 };
  }

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
- For multi-step tasks with "and then", "after that", "next", "then", or arrows, generate a complete ordered queue with one atomic step per phase.
- Each step must be atomic (one action per step).
- Use WAIT steps (500-2000ms) after navigation steps before interacting with page elements.${directUrlHint}

Standard JSON Step Schema (Use [data-zulora-id="X"] for target if available in Screen Vision Memory):
[
  { "step": 1, "action": "NAVIGATE", "url": "https://..." },
  { "step": 2, "action": "WAIT", "ms": 1500 },
  { "step": 3, "action": "TYPE", "target": "[data-zulora-id='1'] or CSS selector", "value": "text to type" },
  { "step": 4, "action": "CLICK", "target": "[data-zulora-id='2'] or CSS selector" },
  { "step": 5, "action": "SCROLL", "direction": "down" },
  { "step": 6, "action": "EXTRACT_DATA", "selector": "h1, p, .result", "variable": "varName" },
  { "step": 7, "action": "DOWNLOAD_IMAGE", "target": "[data-zulora-id='3'] or img selector" }
]

Specialized High-Level Actions (preferred for common apps):
- { "action": "YOUTUBE_PLAY", "query": "search term" }
- { "action": "WHATSAPP_SEND", "recipient": "contact name", "message": "message text" }
- { "action": "GMAIL_COMPOSE", "to": "email@domain.com", "subject": "subject", "body": "email body" }
- { "action": "GMAIL_ANALYZE_INBOX", "limit": 10 } — use for Gmail read/analyze/extract/copy/summarize requests, never compose.
- { "action": "EXPORT_DATA_TO_SHEETS", "filename": "gmail-inbox.csv" } — use after inbox analysis when requested.
- { "action": "CHATGPT_PROMPT", "prompt": "your question" }
- { "action": "GEMINI_PROMPT", "prompt": "your question" }
- { "action": "CAPTURE_SCREENSHOT" }
- { "action": "GEMINI_PROMPT", "prompt": "analyze this screenshot", "includeScreenshot": true }
- { "action": "READ_SCREEN" }
- { "action": "AUTOFILL_FORM" }

Rules:
- Strip filler words ("please", "there", "search for", "go to google and") from query values.
- All URLs must start with https://.
- Output ONLY the JSON array, nothing else.`;

  // Weave persistent screen memory buffer into planning context
  const recentMemory = getRecentScreenMemory(2);
  const memoryContext = recentMemory.length > 0
    ? `\nScreen Vision Memory History:\n` + recentMemory.map((m, i) => `[State ${i + 1}: ${m.title || m.url}] ${String(m.summary || '').slice(0, 400)}`).join('\n')
    : '';

  const contextPrompt = screenContext
    ? `User Prompt: ${cleanPrompt}\nCurrent Screen Summary:\n${screenContext.slice(0, 1000)}${memoryContext}`
    : `User Prompt: ${cleanPrompt}${memoryContext}`;

  let planResult = null;
  try {
    planResult = await callWaterfallLLM(contextPrompt, systemPrompt, {
      maxTokens: 1200,
      temperature: 0.1,
      timeoutMs: 1800,
      groqTimeoutMs: 1500,
      groqModel: 'llama-3.3-70b-versatile'
    });
  } catch (error) {
    console.warn('[Agent 1 Planner] Provider waterfall exhausted; using deterministic parser:', error.message);
  }

  if (planResult?.success && planResult.text) {
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
          const steps = parsed.slice(0, 12).map((item, idx) => normalizeAgentStep(item, idx + 1));
          if (isComplexCommand(prompt) && steps.length < 3) {
            const fallback = parseCommandToSteps(prompt);
            return { steps: fallback.length > steps.length ? fallback : steps, tokensUsed: planResult.tokensUsed || 0 };
          }
          return { steps, tokensUsed: planResult.tokensUsed || 0 };
        }
      }
    } catch (e) {
      console.warn('[Agent 1 Planner] LLM JSON parse failed, utilizing deterministic decomposition:', e.message);
    }
  }

  // Deterministic Local Fallback Planner
  const fallbackSteps = parseCommandToSteps(prompt);
  return { steps: fallbackSteps.slice(0, 12), tokensUsed: 0 };
}

function isComplexCommand(prompt) {
  return /(?:->|→|;)|\b(and then|after that|then|next|also|multiple|several|step by step)\b/i.test(String(prompt || ''));
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
        selector: raw.target || raw.selector || raw.params?.target || raw.params?.selector || 'input',
        text: raw.value || raw.text || raw.params?.value || raw.params?.text || '',
        submit: Boolean(raw.submit || raw.pressEnter || raw.params?.submit || raw.params?.pressEnter ||
          /search|query/i.test(String(raw.target || raw.selector || raw.params?.target || raw.params?.selector || '')))
      }
    };
  }
  if (action === 'CLICK' || action === 'CLICK_ELEMENT') {
    return {
      step,
      action: ACTION_TYPES.CLICK_ELEMENT,
      app: 'Browser',
      params: { selector: raw.target || raw.selector || raw.params?.target || raw.params?.selector || 'button' }
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
      params: { recipient: cleanSearchIntent(raw.recipient || raw.params?.recipient || ''), rawPrompt: String(raw.message || raw.params?.message || raw.intent || "Write a concise, friendly WhatsApp message fulfilling the user's intent.") },
      needsLlm: true,
      llmType: 'whatsapp'
    };
  }
  if (action === 'GMAIL_COMPOSE') {
    return {
      step,
      action: ACTION_TYPES.GMAIL_COMPOSE,
      app: 'Gmail',
      params: { to: raw.to || raw.params?.to || '', subject: 'A quick update', rawPrompt: String(raw.body || raw.params?.body || raw.intent || 'Write a professional email fulfilling the user intent.'), template: raw.template || raw.params?.template || TEMPLATES.PEARL },
      needsLlm: true,
      llmType: 'email'
    };
  }
  if (action === 'GMAIL_ANALYZE_INBOX' || action === 'GMAIL_READ_INBOX') {
    return {
      step,
      action: ACTION_TYPES.GMAIL_ANALYZE_INBOX,
      app: 'Gmail',
      params: { limit: Math.max(1, Math.min(50, Number(raw.limit || raw.count || raw.params?.limit) || 10)) }
    };
  }
  if (action === 'EXPORT_DATA_TO_SHEETS' || action === 'EXPORT_TO_SHEETS') {
    return { step, action: ACTION_TYPES.EXPORT_DATA_TO_SHEETS, app: 'Google Sheets', params: { filename: raw.filename || raw.params?.filename || 'gmail-inbox.csv' } };
  }
  if (action === 'CHATGPT_PROMPT') {
    return { step, action: ACTION_TYPES.CHATGPT_PROMPT, app: 'ChatGPT', params: { prompt: cleanSearchIntent(raw.prompt || '') } };
  }
  if (action === 'GEMINI_PROMPT') {
    const prompt = String(raw.prompt || raw.params?.prompt || '');
    return {
      step,
      action: ACTION_TYPES.GEMINI_PROMPT,
      app: 'Gemini',
      params: {
        prompt: cleanSearchIntent(prompt),
        includeScreenshot: Boolean(raw.includeScreenshot || raw.params?.includeScreenshot || /(?:send|share|show|analy[sz]e|describe).*(?:screenshot|screen shot|this image)/i.test(prompt))
      }
    };
  }
  if (action === 'CAPTURE_SCREENSHOT' || action === 'SCREENSHOT' || action === 'TAKE_SCREENSHOT') {
    return { step, action: ACTION_TYPES.CAPTURE_SCREENSHOT, app: 'Browser', params: {} };
  }
  if (action === 'WAIT') {
    return { step, action: ACTION_TYPES.WAIT, app: 'System', params: { ms: raw.ms || 1500 } };
  }
  if (action === 'SCROLL') {
    return { step, action: 'scroll', app: 'Browser', params: { direction: raw.direction || 'down' } };
  }
  if (action === 'DOWNLOAD_IMAGE' || action === 'DOWNLOAD') {
    return { step, action: 'download_image', app: 'Browser', params: { target: raw.target || raw.selector || 'img' } };
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

  if (isGmailInboxAnalysisIntent(command)) {
    const requestedCount = command.match(/\b(?:first|top)\s+(\d{1,2})\b/i)?.[1];
    const limit = Math.max(1, Math.min(50, Number(requestedCount) || 10));
    const steps = [
      { action: ACTION_TYPES.OPEN_URL, app: 'Gmail', params: { url: 'https://mail.google.com' } },
      { action: ACTION_TYPES.WAIT, app: 'System', params: { ms: 3000 } },
      { action: ACTION_TYPES.GMAIL_ANALYZE_INBOX, app: 'Gmail', params: { limit } }
    ];
    if (/\b(?:google\s+sheets|sheets|spreadsheet|csv|export)\b/i.test(command)) {
      steps.push({ action: ACTION_TYPES.EXPORT_DATA_TO_SHEETS, app: 'Google Sheets', params: { filename: 'gmail-inbox.csv' } });
    }
    return steps.map((step, index) => ({ ...step, step: index + 1 }));
  }

  const phases = String(command)
    .split(/\s*(?:->|→|;|\bafter that\b|\band then\b|\bthen\b|\bnext\b)\s*/i)
    .map(value => value.trim())
    .filter(Boolean);
  if (phases.length > 1) {
    return phases.flatMap((phase) => {
      const lower = phase.toLowerCase();
      if (/\b(?:take|capture|save)\s+(?:a\s+)?screenshot\b/.test(lower) || /\bscreenshot this page\b/.test(lower)) {
        return [{ action: ACTION_TYPES.CAPTURE_SCREENSHOT, app: 'Browser', params: {} }];
      }
      if (/\b(?:send|share|show|analy[sz]e|describe)\s+(?:the\s+)?(?:screenshot|screen shot|image)\b/.test(lower) && /\b(?:gemini|google gemini)\b/.test(lower)) {
        const ask = phase.replace(/\b(?:send|share|show|analy[sz]e|describe)\s+(?:the\s+)?(?:screenshot|screen shot|image)\s+(?:to|with|in)\s+(?:google\s+)?gemini\b/i, '').trim();
        return [{ action: ACTION_TYPES.GEMINI_PROMPT, app: 'Gemini', params: { prompt: ask || 'Analyze the screenshot of the page and describe its contents.', includeScreenshot: true } }];
      }
      return parseCommandToSteps(phase);
    }).map((step, index) => ({ ...step, step: index + 1 }));
  }

  if (/\b(?:send|share|show|analy[sz]e|describe)\s+(?:the\s+)?(?:screenshot|screen shot|image)\b/i.test(command) && /\bgemini\b/i.test(command)) {
    return [{ action: ACTION_TYPES.GEMINI_PROMPT, app: 'Gemini', params: { prompt: 'Analyze the screenshot of the current page and describe its contents.', includeScreenshot: true } }];
  }

  if (/\b(?:take|capture|save)\s+(?:a\s+)?screenshot\b/.test(cmd) || /\bscreenshot this page\b/.test(cmd)) {
    return [{ action: ACTION_TYPES.CAPTURE_SCREENSHOT, app: 'Browser', params: {} }];
  }

  // Screen reading
  if (cmd.includes('read screen') || cmd.includes('what is on this page') ||
      cmd.includes('summarize this page') || cmd.includes('summarize page') ||
      cmd.includes('what does this page say')) {
    return [{ action: ACTION_TYPES.READ_DOM, app: 'Screen Reader', params: { readAloud: true, deep: true } }];
  }

  // Phone calls use the operating-system handler when a number is present.
  if (/\b(call|phone|dial)\b/i.test(cmd)) {
    const phone = command.match(/(?:\+?\d[\d\s().-]{6,}\d)/)?.[0]?.replace(/[^+\d]/g, '');
    return [{ action: ACTION_TYPES.OPEN_URL, app: phone ? 'Phone' : 'Google Meet', params: { url: phone ? `tel:${phone}` : 'https://meet.google.com' } }];
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
        subject: 'A quick update',
        rawPrompt: extracted.body || cleanSearchIntent(command),
        template: isAzure ? TEMPLATES.AZURE : TEMPLATES.PEARL
      }
    }];
  }

  // WhatsApp
  if (cmd.includes('whatsapp') || cmd.includes('whats app')) {
    const toMatch = command.match(/(?:\bto\s+|\bmessage\s+)([A-Za-z0-9+().\s-]+?)(?:\s+(?:saying|with|and send|and say)|$)/i);
    const msgMatch = command.match(/(?:saying|with (?:the )?message|send (?:them )?a message)[:\s]+["']?(.+?)["']?$/i);
    return [{
      action: ACTION_TYPES.WHATSAPP_SEND, app: 'WhatsApp', needsLlm: true, llmType: 'whatsapp',
      params: {
        recipient: cleanSearchIntent(toMatch?.[1] || ''),
        rawPrompt: msgMatch?.[1] || 'Write a concise, friendly WhatsApp message that fulfills the user intent.'
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

function isGmailInboxAnalysisIntent(command) {
  const text = String(command || '').toLowerCase();
  const referencesInbox = /\b(?:gmail|inbox|emails)\b/.test(text);
  const analysisIntent = /\b(?:analy[sz]e|read|extract|copy|summari[sz]e|first\s+\d+|top\s+\d+)\b/.test(text);
  return referencesInbox && analysisIntent;
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

  const dispatchTokenUpdate = (stepTokens, total) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('ZULORA_TOKEN_UPDATE', {
      detail: { tokensUsed: Number(total) || 0, stepTokens: Number(stepTokens) || 0, taskTokens: Number(stepTokens) || 0, delta: Number(stepTokens) || 0, source: 'web' }
    }));
  };

  // 1. AGENT 1: Master Planning & Task Decomposition
  logEntry('🧠 Agent 1: Planning action sequence...', 'running');
  const plan = await agent1_MasterPlanner(command);
  const steps = plan.steps;

  if (!steps || !steps.length) {
    logEntry('Could not parse task into executable steps', 'error');
    return { ok: false, error: 'Could not parse command into steps.' };
  }

  logEntry(`📋 Agent 1 Plan: ${steps.length} step(s) queued`, 'done');

  let totalTokensUsed = plan.tokensUsed || 0;
  dispatchTokenUpdate(totalTokensUsed, totalTokensUsed);

  // 2. Pre-generate payloads for steps requiring dynamic content (Gmail, WhatsApp)
  for (const step of steps) {
    if (!step.needsLlm || !step.params?.rawPrompt) continue;

    logEntry(`🤖 Generating ${step.llmType || 'content'} payload...`, 'running');

    const sysP = step.llmType === 'email'
      ? 'Act as an intent and copywriting processor. Return ONLY JSON {"subject":"...","body":"...","isHtml":false}. Produce a polished email, not a rewrite of the instruction. Do not invent facts.'
      : 'Act as an intent and copywriting processor. Return ONLY JSON {"message":"..."}. Produce a concise, natural message fulfilling the intent. Never echo the instruction verbatim.';

    let result;
    try {
      result = await callWaterfallLLM(step.params.rawPrompt, sysP, {
        maxTokens: 700,
        timeoutMs: 1800,
        groqTimeoutMs: 1500
      });
    } catch (error) {
      logEntry(`LLM content generation failed: ${error.message}`, 'error');
      result = null;
    }

    if (result?.success && result.text) {
      const tokens = Number(result.tokensUsed) || 0;
      totalTokensUsed += tokens;

      let copy = {};
      try {
        const json = result.text.replace(/```json?|```/gi, '').match(/\{[\s\S]*\}/)?.[0];
        if (json) copy = JSON.parse(json);
      } catch {}

      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.subject = String(copy.subject || step.params.subject || 'A quick update').trim();
        const emailBody = String(copy.body || '').trim() || 'Hello,\n\nI wanted to share an update with you. Please let me know if you have any questions.\n\nBest regards,\nZulora AI';
        step.params.bodyHtml = renderEmailTemplate(
          emailBody,
          step.params.template || TEMPLATES.PEARL,
          { subject: step.params.subject }
        );
      } else if (step.action === ACTION_TYPES.WHATSAPP_SEND) {
        step.params.message = String(copy.message || '').trim() || 'Hello! I wanted to get in touch. Please let me know when you have a moment.';
      }

      logEntry(`⚡ Generated payload via ${result.provider} (${tokens} tokens)`, 'done');
      
      // Dispatch incremental token update event
      dispatchTokenUpdate(tokens, totalTokensUsed);
    } else {
      // Direct text fallback
      if (step.action === ACTION_TYPES.WHATSAPP_SEND) step.params.message = 'Hello! I wanted to get in touch. Please let me know when you have a moment.';
      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.subject = step.params.subject || 'A quick update';
        step.params.bodyHtml = renderEmailTemplate('Hello,\n\nI wanted to share an update with you. Please let me know if you have any questions.\n\nBest regards,\nZulora AI', step.params.template || TEMPLATES.PEARL, { subject: step.params.subject });
      }
      logEntry('⚠️ Using direct text fallback', 'done');
    }
  }

  // 3. Sync Unified Token Counter to Firestore & localStorage
  const updatedTokens = await syncTokenUsage(totalTokensUsed, currentUser?.uid);
  if (totalTokensUsed > 0) {
    // Publish the persisted total for consumers that mounted after an incremental update.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ZULORA_TOKEN_UPDATE', {
      detail: { tokensUsed: updatedTokens, stepTokens: 0, source: 'web' }
    }));
  }

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
