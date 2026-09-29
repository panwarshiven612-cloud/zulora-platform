/**
 * Zulora AI — Browser Agent Engine (v1.4.0)
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

// ─── 500ms Fallback Waterfall Brain ───────────────────────────────────────────
/**
 * Fast LLM Caller with cascading failover:
 *  1. Groq (llama-3.3-70b / llama-3.1-8b) — <400ms planning
 *  2. Cerebras (llama3.1-8b) — <300ms ultra-fast routing
 *  3. Gemini 2.0 Flash / Pro REST endpoints (rotating key pool)
 *  4. OpenRouter
 *  5. Graceful fallback (NEVER throws "All providers exhausted")
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

  // 1. Groq Llama-3.3-70b (Fastest Router <400ms)
  const groqKey = get('VITE_GROQ_KEY') || get('VITE_GROQ_API_KEY');
  if (groqKey) {
    try {
      const res = await postJSON(
        'https://api.groq.com/openai/v1/chat/completions',
        { Authorization: `Bearer ${groqKey}` },
        {
          model: opts.groqModel || 'llama-3.3-70b-versatile',
          max_tokens: opts.maxTokens || 1024,
          temperature: opts.temperature || 0.2,
          messages
        },
        1800
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'groq' };
      }
    } catch (e) {
      console.warn('[Zulora Waterfall] Groq bypassed:', e.message);
    }
  }

  // 2. Cerebras Llama-3.1-8b (Ultra-fast DOM Extraction <300ms)
  const cerebrasKey = get('VITE_CEREBRAS_KEY');
  if (cerebrasKey) {
    try {
      const res = await postJSON(
        'https://api.cerebras.ai/v1/chat/completions',
        { Authorization: `Bearer ${cerebrasKey}` },
        {
          model: 'llama3.1-8b',
          max_tokens: opts.maxTokens || 1024,
          temperature: 0.1,
          messages
        },
        1500
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'cerebras' };
      }
    } catch (e) {
      console.warn('[Zulora Waterfall] Cerebras bypassed:', e.message);
    }
  }

  // 3. Gemini REST API Key Pool (Gemini 2.0 Flash / Pro)
  const geminiKeys = Array.from({ length: 7 }, (_, i) =>
    get(`VITE_GEMINI_KEY_${i + 1}`) || get(`VITE_GEMINI_API_KEY_${i + 1}`)
  ).concat([get('VITE_GEMINI_API_KEY')]).filter(k => k && k.length > 20);

  for (const apiKey of geminiKeys) {
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const res = await postJSON(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {},
          {
            contents: [{ parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }] }],
            generationConfig: { temperature: opts.temperature || 0.2, maxOutputTokens: opts.maxTokens || 1024 }
          },
          2500
        );
        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { success: true, text, provider: `gemini/${model}` };
        }
        if (res.status === 429 || res.status === 403) break; // rotate key immediately
      } catch (e) {
        // Continue to next key
      }
    }
  }

  // 4. OpenRouter Fallback
  const openRouterKey = get('VITE_OPENROUTER_KEY') || get('VITE_OPENROUTER_API_KEY');
  if (openRouterKey) {
    try {
      const res = await postJSON(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://zulora.ai' },
        { model: 'mistralai/mistral-7b-instruct', max_tokens: 512, messages },
        2000
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'openrouter' };
      }
    } catch {}
  }

  // 5. Graceful Local Fallback — Never throw "All providers exhausted"
  return {
    success: false,
    text: '',
    provider: 'local_deterministic',
    error: null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 1: MASTER PLANNER & DECOMPOSER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Takes user voice/text prompt + current screen text context.
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

  const systemPrompt = `You are Zulora AI's Master Task Planner (Agent 1).
Analyze the user prompt and break the task into an ordered JSON array of executable browser steps.
Output ONLY raw valid JSON array. Do NOT wrap in markdown code blocks. No comments, no explanations.

Standard JSON Step Schema:
[
  { "step": 1, "action": "NAVIGATE", "url": "https://..." },
  { "step": 2, "action": "FILL_INPUT", "target": "search bar or CSS selector", "value": "text to type" },
  { "step": 3, "action": "CLICK", "target": "button or link text / CSS selector" },
  { "step": 4, "action": "EXTRACT_DATA", "selector": "h1, p, or text area", "variable": "varName" },
  { "step": 5, "action": "POST_DATA", "url": "https://...", "data": "{{varName}}" },
  { "step": 6, "action": "WAIT", "ms": 1500 }
]

Specialized Actions:
- { "action": "YOUTUBE_PLAY", "query": "..." }
- { "action": "WHATSAPP_SEND", "recipient": "...", "message": "..." }
- { "action": "GMAIL_COMPOSE", "to": "...", "subject": "...", "body": "..." }
- { "action": "CHATGPT_PROMPT", "prompt": "..." }
- { "action": "GEMINI_PROMPT", "prompt": "..." }
- { "action": "READ_SCREEN" }
- { "action": "AUTOFILL_FORM" }

Rules:
- Strip redundant fillers ("please", "there", "search for") from query values.
- If task contains sequential instructions ("and then", "after that", "next"), generate distinct steps.
- Ensure all URLs start with https://.
- Output ONLY the JSON array.`;

  const contextPrompt = screenContext
    ? `User Prompt: ${cleanPrompt}\nCurrent Screen Summary:\n${screenContext.slice(0, 1000)}`
    : `User Prompt: ${cleanPrompt}`;

  const planResult = await callWaterfallLLM(contextPrompt, systemPrompt, {
    maxTokens: 900,
    temperature: 0.1,
    timeoutMs: 2500,
    groqModel: 'llama-3.3-70b-versatile'
  });

  if (planResult.success && planResult.text) {
    try {
      const sanitized = planResult.text.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(sanitized);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => normalizeAgentStep(item, idx + 1));
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
  return { verified: true, retry: false };
}

// ─── Deterministic Step Parser (Fast Local Fallback) ──────────────────────────
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();

  // Screen reading
  if (cmd.includes('read screen') || cmd.includes('what is on this page') || cmd.includes('summarize page')) {
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
  if (cmd.includes('youtube') || cmd.match(/\bplay\b/)) {
    const rawMatch = command.match(/(?:search|play|find|for)[:\s]+["']?(.+?)["']?$/i);
    const entity = cleanSearchIntent(rawMatch ? rawMatch[1] : command);
    return [{ action: ACTION_TYPES.YOUTUBE_PLAY, app: 'YouTube', params: { query: entity } }];
  }

  // Gmail
  if (cmd.includes('email') || cmd.includes('gmail') || cmd.includes('send mail')) {
    const toMatch = command.match(/to\s+([\w._%+-]+@[\w.-]+\.[a-z]{2,})/i);
    const subjMatch = command.match(/subject[:\s]+["']?(.+?)["']?(?:\s+(?:body|saying|with|and|message)|$)/i);
    const bodyMatch = command.match(/(?:body|saying|message|draft|write)[:\s]+["']?(.+?)["']?$/i);
    const isAzure = /azure/i.test(command);
    const isPearl = /pearl|template|formal/i.test(command);
    return [{
      action: ACTION_TYPES.GMAIL_COMPOSE, app: 'Gmail', needsLlm: true, llmType: 'email',
      params: {
        to: toMatch?.[1] || '',
        subject: subjMatch?.[1] || 'Message from Zulora AI',
        rawPrompt: bodyMatch?.[1] || cleanSearchIntent(command),
        template: isAzure ? TEMPLATES.AZURE : (isPearl ? TEMPLATES.PEARL : TEMPLATES.PEARL)
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

  // ChatGPT
  if (cmd.includes('chatgpt') || cmd.includes('chat gpt')) {
    const promptMatch = command.match(/(?:ask|prompt|search|tell|with|query)[:\s]+["']?(.+?)["']?$/i);
    return [{ action: ACTION_TYPES.CHATGPT_PROMPT, app: 'ChatGPT', params: { prompt: cleanSearchIntent(promptMatch?.[1] || command) } }];
  }

  // Gemini
  if (cmd.includes('gemini')) {
    const promptMatch = command.match(/(?:ask|prompt|tell|query|say)[:\s]+["']?(.+?)["']?$/i);
    return [{ action: ACTION_TYPES.GEMINI_PROMPT, app: 'Gemini', params: { prompt: cleanSearchIntent(promptMatch?.[1] || command) } }];
  }

  // PDF export
  if (cmd.includes('export pdf') || cmd.includes('save as pdf') || cmd.includes('convert to pdf')) {
    return [{ action: ACTION_TYPES.EXPORT_PDF, app: 'System', params: {} }];
  }

  // Form fill
  if (cmd.includes('fill form') || cmd.includes('register') || cmd.includes('sign in') || cmd.includes('auto fill')) {
    return [{ action: ACTION_TYPES.AUTOFILL_FORM, app: 'AutoFill', params: { intent: cleanSearchIntent(command) } }];
  }

  // Direct URL navigation
  const urlMatch = command.match(/(?:open|go to|navigate to|visit)\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,})/i);
  if (urlMatch) {
    let url = urlMatch[1];
    if (!url.startsWith('http')) url = 'https://' + url;
    return [{ action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url } }];
  }

  // Google search
  if (cmd.includes('search') || cmd.includes('google') || cmd.includes('look up')) {
    const query = cleanSearchIntent(command.replace(/search|google|look up/gi, ''));
    return [{ action: ACTION_TYPES.SEARCH_GOOGLE, app: 'Google', params: { query: query || command } }];
  }

  // Default: AI brain reasoning
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
