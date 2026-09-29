/**
 * Zulora AI — Browser Agent Engine (v1.3.0)
 * ============================================
 * Multi-Step Task Decomposer, Waterfall Recovery, Fast DOM Pipeline
 * - LLM-powered ActionQueue decomposition via Groq/Cerebras first (fastest)
 * - Graceful exhaustion recovery — never crashes on "all providers exhausted"
 * - NLP Intent cleaner, Pearl/Azure template engine, unified token sync
 */

import { db } from './firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const EXTENSION_ID = 'emimeingkoocmgljpjkpdnlnbkpkfbff';

export const ACTION_TYPES = {
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
  WAIT:            'wait',
  NOTIFY_USER:     'notify_user',
  AUTOFILL_FORM:   'autofill_form',
  EVAL_TOP_RESULT: 'evaluate_and_open_top_result',
};

export const TEMPLATES = { PEARL: 'pearl', AZURE: 'azure', FORMAL: 'formal' };

// ─── Token Sync ───────────────────────────────────────────────────────────────
export async function syncTokenUsage(tokensConsumed, userId) {
  if (!tokensConsumed || typeof tokensConsumed !== 'number') return 0;
  let currentTotal = parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  currentTotal += tokensConsumed;
  localStorage.setItem('zulora_total_tokens', currentTotal.toString());

  if (userId && db && typeof doc === 'function') {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      const dbTokens = snap.exists() ? parseInt(snap.data().tokenUsage || '0', 10) : 0;
      const newTotal = Math.max(dbTokens, currentTotal);
      await setDoc(userRef, { tokenUsage: newTotal }, { merge: true });
      localStorage.setItem('zulora_total_tokens', newTotal.toString());
      return newTotal;
    } catch (e) {
      console.warn('[Zulora Token Engine] Firebase sync failed:', e);
    }
  }
  return currentTotal;
}

// ─── NLP Intent Cleaner ───────────────────────────────────────────────────────
export function cleanSearchIntent(rawQuery) {
  if (!rawQuery) return '';
  let text = typeof rawQuery === 'object'
    ? (rawQuery.text || rawQuery.query || rawQuery.searchTerm || Object.values(rawQuery).join(' '))
    : String(rawQuery);
  text = text.trim().toLowerCase();
  const fillers = [
    /open youtube and search for/gi, /open youtube and play/gi,
    /search for/gi, /search/gi,
    /play the video/gi, /play/gi,
    /find/gi, /go to google and find/gi,
    /there please/gi, /there/gi, /please/gi,
    /on the search bar/gi, /on youtube/gi,
    /in youtube/gi, /on google/gi
  ];
  for (const r of fillers) text = text.replace(r, '');
  return text.trim();
}

// ─── Email Templates (Pearl & Azure) ─────────────────────────────────────────
export function renderEmailTemplate(bodyHtml, templateType = TEMPLATES.PEARL, meta = {}) {
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const content = typeof bodyHtml === 'object' ? Object.values(bodyHtml).join('\n') : String(bodyHtml || '');

  if (templateType === TEMPLATES.PEARL || templateType === 'pearl') {
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

  if (templateType === TEMPLATES.AZURE || templateType === 'azure') {
    return `<div style="font-family:'Inter',-apple-system,sans-serif;background:linear-gradient(135deg,#0c1a2e,#0f2a4a);color:#e2e8f0;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden">
      <div style="padding:32px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <h2 style="margin:0;color:#38bdf8;font-size:24px;font-weight:600">${meta.subject || 'Message from Zulora AI'}</h2>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:13px">Sent on ${currentDate} at ${time}</p>
      </div>
      <div style="padding:32px;font-size:15px;line-height:1.7">${content.replace(/\n/g, '<br>')}</div>
      <div style="padding:24px;border-top:1px solid rgba(255,255,255,0.1);text-align:center">
        <p style="margin:0;font-size:12px;color:#64748b">Automated by <span style="color:#38bdf8;font-weight:600">Zulora AI</span></p>
      </div></div>`;
  }

  return `<div style="font-family:sans-serif;white-space:pre-wrap">${content}</div>`;
}

// ─── Extension Bridge ─────────────────────────────────────────────────────────
export async function checkExtensionConnected() {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(false); } }, 1500);
    const onPong = () => {
      if (!resolved) { resolved = true; clearTimeout(timer); window.removeEventListener('ZULORA_PONG', onPong); resolve(true); }
    };
    window.addEventListener('ZULORA_PONG', onPong);
    try { window.dispatchEvent(new CustomEvent('ZULORA_PING')); } catch { resolve(false); }
  });
}

export function onStatusUpdate(callback) {
  const listener = (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION' && event.data?.type === 'ZULORA_STATUS_UPDATE') {
      callback(event.data);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export async function sendBridgeMessageWithRetry(detail, maxAttempts = 3, delayMs = 1000, timeoutMs = 8000) {
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
    lastError = result?.error || 'No response';
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
  }
  return { ok: false, success: false, error: lastError || 'Extension bridge timeout' };
}

// ─── Waterfall LLM Router ──────────────────────────────────────────────────────
// Priority: Groq (300ms) → Cerebras (200ms) → Gemini Flash → OpenRouter → local fallback
async function callWaterfallLLM(prompt, systemPrompt = '', opts = {}) {
  const env = import.meta.env || {};
  const get = (k) => String(env[k] || '').trim();
  const timeoutMs = opts.timeoutMs || 5000;

  const withTimeout = (promise, ms) =>
    Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  const postJSON = (url, headers, body) =>
    withTimeout(
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
      timeoutMs
    );

  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: prompt }
  ];

  // 1. Groq — llama-3.3-70b — ~300ms routing
  const groqKey = get('VITE_GROQ_KEY') || get('VITE_GROQ_API_KEY');
  if (groqKey) {
    try {
      const res = await postJSON(
        'https://api.groq.com/openai/v1/chat/completions',
        { Authorization: `Bearer ${groqKey}` },
        { model: opts.groqModel || 'llama-3.3-70b-versatile', max_tokens: opts.maxTokens || 1024, temperature: opts.temperature || 0.3, messages }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'groq' };
      }
    } catch (e) { console.warn('[Zulora Waterfall] Groq:', e.message); }
  }

  // 2. Cerebras — llama3.1-8b — ~200ms for DOM/routing decisions
  const cerebrasKey = get('VITE_CEREBRAS_KEY');
  if (cerebrasKey) {
    try {
      const res = await postJSON(
        'https://api.cerebras.ai/v1/chat/completions',
        { Authorization: `Bearer ${cerebrasKey}` },
        { model: 'llama3.1-8b', max_tokens: opts.maxTokens || 1024, messages }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'cerebras' };
      }
    } catch (e) { console.warn('[Zulora Waterfall] Cerebras:', e.message); }
  }

  // 3. Gemini key pool — rotating 7 keys
  const geminiKeys = Array.from({ length: 7 }, (_, i) =>
    get(`VITE_GEMINI_KEY_${i + 1}`) || get(`VITE_GEMINI_API_KEY_${i + 1}`)
  ).concat([get('VITE_GEMINI_API_KEY')]).filter(k => k.length > 20);

  for (const apiKey of geminiKeys) {
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const res = await postJSON(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {},
          {
            contents: [{ parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }] }],
            generationConfig: { temperature: opts.temperature || 0.3, maxOutputTokens: opts.maxTokens || 1024 }
          }
        );
        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { success: true, text, provider: `gemini/${model}` };
        }
        if (res.status === 429 || res.status === 403) break; // next key
      } catch (e) { /* continue */ }
    }
  }

  // 4. OpenRouter — Mistral-7B
  const openRouterKey = get('VITE_OPENROUTER_KEY') || get('VITE_OPENROUTER_API_KEY');
  if (openRouterKey) {
    try {
      const res = await postJSON(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://zulora.ai' },
        { model: 'mistralai/mistral-7b-instruct', max_tokens: 512, messages }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'openrouter' };
      }
    } catch (e) { /* */ }
  }

  // 5. Local deterministic fallback — NEVER crash
  return { success: false, text: '', provider: 'none', error: 'All LLM providers unavailable — using local parser' };
}

// ─── Multi-Step Task Decomposer ───────────────────────────────────────────────
/**
 * For complex multi-step prompts, uses the fastest available LLM to convert
 * the prompt into a structured JSON action queue.
 * Falls back to local parseCommandToSteps() if LLM fails.
 */
export async function decomposeTaskToActionQueue(prompt) {
  const systemPrompt = `You are Zulora AI's browser automation task decomposer.
Convert the user's request into a JSON array of sequential browser steps.
Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
Each item: { "step": number, "action": string, "params": object }

Valid actions and their params:
- open_url: { "url": "https://..." }
- search_google: { "query": "clean search query" }
- youtube_play: { "query": "video title to search" }
- whatsapp_send: { "recipient": "contact name", "message": "text" }
- gmail_compose: { "to": "email@domain.com", "subject": "subject", "body": "body text" }
- chatgpt_prompt: { "prompt": "text to send" }
- gemini_prompt: { "prompt": "text to send" }
- click_element: { "selector": "CSS selector" }
- type_text: { "selector": "CSS selector", "text": "text to type" }
- read_page_dom: { "deep": true }
- evaluate_and_open_top_result: {}
- autofill_form: {}
- export_pdf: {}
- wait: { "ms": 2000 }

Rules:
- Strip filler words from queries (remove "please", "there", "on youtube", etc.)
- For multi-app tasks, create one step per app action
- Keep queries clean: "mrbeast" not "search for mrbeast on youtube please"
- Output ONLY the JSON array, nothing else`;

  const result = await callWaterfallLLM(prompt, systemPrompt, {
    maxTokens: 800,
    temperature: 0.1,
    timeoutMs: 5000,
    groqModel: 'llama-3.3-70b-versatile'
  });

  if (result.success && result.text) {
    try {
      const cleaned = result.text.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((s, i) => ({
          action: s.action,
          app: deriveApp(s.action),
          params: s.params || {},
          needsLlm: false,
          _step: s.step || i + 1
        }));
      }
    } catch (e) {
      console.warn('[Zulora Decomposer] JSON parse failed, using local parser:', e.message);
    }
  }

  // Fallback: local deterministic parser
  return parseCommandToSteps(prompt);
}

function deriveApp(action) {
  const map = {
    open_url: 'Browser', search_google: 'Google',
    youtube_play: 'YouTube', whatsapp_send: 'WhatsApp',
    chatgpt_prompt: 'ChatGPT', gemini_prompt: 'Gemini',
    gmail_compose: 'Gmail', click_element: 'Browser',
    type_text: 'Browser', read_page_dom: 'Screen Reader',
    evaluate_and_open_top_result: 'Search Engine',
    autofill_form: 'AutoFill', export_pdf: 'System',
    wait: 'System', ai_reasoning: 'Web Agent', llm_generate: 'AI Brain'
  };
  return map[action] || 'Web Agent';
}

// ─── Deterministic Local Parser (no LLM, instant) ────────────────────────────
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();

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

// ─── Control Commands ─────────────────────────────────────────────────────────
export function pauseTask()  { return sendBridgeMessageWithRetry({ type: 'ZULORA_PAUSE' }, 1); }
export function resumeTask() { return sendBridgeMessageWithRetry({ type: 'ZULORA_RESUME' }, 1); }
export function cancelTask() { return sendBridgeMessageWithRetry({ type: 'ZULORA_CANCEL' }, 1); }

// ─── Main Execution Entry Point ───────────────────────────────────────────────
export async function executeCommand(command, currentUser, onLog) {
  const logEntry = (label, status, detail = '') => {
    if (onLog) onLog({ index: Date.now(), label, status, detail, timestamp: Date.now() });
  };

  // Detect complex multi-step prompts
  const isComplex = /\b(?:and then|then|after that|next|also|finally|afterwards)\b/i.test(command)
    || (command.split(/[,;]+/).length >= 2 && command.length > 60);

  let steps = [];

  if (isComplex) {
    logEntry('🤖 Decomposing complex task via AI...', 'running');
    steps = await decomposeTaskToActionQueue(command);
    logEntry(`📋 Plan ready: ${steps.length} step(s) queued`, 'done');
  } else {
    steps = parseCommandToSteps(command);
  }

  if (!steps.length) return { ok: false, error: 'Could not parse command into steps.' };

  let totalTokensUsed = 0;

  // Pre-generate LLM payloads for email/WhatsApp steps
  for (const step of steps) {
    if (!step.needsLlm || !step.params?.rawPrompt) continue;

    logEntry(`🤖 Generating ${step.llmType || 'content'} payload...`, 'running');

    const sysP = step.llmType === 'email'
      ? 'Write a professional email body. Output raw plain text only. No markdown code blocks.'
      : 'Write a friendly WhatsApp message. Output raw plain text only. No markdown.';

    const result = await callWaterfallLLM(step.params.rawPrompt, sysP, {
      maxTokens: 1024, timeoutMs: 5000
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

      logEntry(`⚡ Payload ready via ${result.provider} (${tokens} tokens)`, 'done');
    } else {
      // Graceful: use raw prompt directly — never block execution
      if (step.action === ACTION_TYPES.WHATSAPP_SEND) step.params.message = step.params.rawPrompt;
      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.bodyHtml = renderEmailTemplate(step.params.rawPrompt, TEMPLATES.PEARL, { subject: step.params.subject });
      }
      logEntry('⚠️ LLM unavailable — using direct text fallback', 'done');
    }
  }

  // Sync tokens
  const updatedTokens = await syncTokenUsage(totalTokensUsed, currentUser?.uid);

  // Send step queue to extension background
  const res = await sendBridgeMessageWithRetry({ type: 'ZULORA_RUN_TASK', steps }, 3, 1000, 8000);
  return { ...res, tokensUsed: totalTokensUsed, newTotalTokens: updatedTokens };
}
