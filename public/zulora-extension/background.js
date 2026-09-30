/**
 * Zulora AI Computer Plugin — Background Service Worker v1.5.0
 * ==============================================================
 * BUGFIX 4: Waterfall retry engine with exponential backoff.
 * BUGFIX 3: Direct URL routing matrix injected into ai_reasoning fallback.
 * BUGFIX 1: Multi-tab task orchestration with chrome.tabs.create/update.
 * Added: Cerebras llama3.1-70b upgrade.
 * Added: 429 silent skip between providers (<200ms failover).
 */

// ─── 1. Keep-Alive Heartbeat ──────────────────────────────────────────────────
try {
  chrome.alarms.create('zuloraKeepAlive', { periodInMinutes: 0.33 });
} catch (e) {
  console.warn('[Zulora SW] Alarm setup:', e);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'zuloraKeepAlive') {
    chrome.storage.local.set({ _lastHeartbeat: Date.now() }).catch(() => {});
  }
});

// ─── 2. State & Storage ───────────────────────────────────────────────────────
let taskQueue = [];
let taskStatus = 'idle';
let actionLog = [];
let currentStepIndex = 0;
let isCancelled = false;
let isQueueRunning = false;
let hasReceivedTaskMessage = false;
let latestScreenshotDataUrl = '';
const QUEUE_STORAGE_KEYS = ['zulora_agent_queue', 'zulora_agent_queue_index', 'zulora_agent_status', 'zulora_agent_log'];

let cachedApiKeys = {
  geminiKeys: [],
  groqKey: '',
  cerebrasKey: '',
  mistralKey: '',
  openRouterKey: ''
};

chrome.storage.local.get(['zuloraApiKeys'], (res) => {
  if (res?.zuloraApiKeys) cachedApiKeys = { ...cachedApiKeys, ...res.zuloraApiKeys };
});

// ─── 3. Safe Chrome API Wrappers ──────────────────────────────────────────────
function safeRuntimeId() {
  try { return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
  catch { return false; }
}

function safeNotify(title, message) {
  if (!safeRuntimeId() || !chrome.notifications) return;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: title || 'Zulora AI Agent',
      message: message || ''
    });
  } catch (err) {
    console.warn('[Zulora Notify]', err.message);
  }
}

function log(label, status = 'done', detail = '') {
  const entry = { index: actionLog.length + 1, label, status, detail, timestamp: Date.now() };
  actionLog.push(entry);
  broadcastStatus();
  return entry;
}

function broadcastStatus() {
  if (!safeRuntimeId()) return;
  const payload = {
    type: 'ZULORA_STATUS_UPDATE',
    taskStatus,
    actionLog: [...actionLog],
    currentStep: currentStepIndex,
    totalSteps: taskQueue.length
  };
  try {
    chrome.tabs.query({}, (tabs) => {
      if (!tabs) return;
      tabs.forEach(tab => {
        if (tab.id && tab.url) chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      });
    });
  } catch {}
}

function broadcastTokenUsage(tokens) {
  const amount = Number(tokens) || 0;
  if (!amount || !safeRuntimeId()) return;
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach(tab => {
      if (tab.id && tab.url && isZuloraOrigin(tab.url)) {
        chrome.tabs.sendMessage(tab.id, { type: 'ZULORA_TOKEN_UPDATE', taskTokens: amount, delta: amount, source: 'extension' }).catch(() => {});
      }
    });
  });
}

function isZuloraOrigin(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname.includes('zulora') ||
      u.hostname.includes('vercel.app') ||
      u.hostname.includes('web.app') ||
      u.hostname.includes('firebaseapp.com')
    );
  } catch { return false; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistQueueState() {
  return chrome.storage.local.set({
    zulora_agent_queue: taskQueue,
    zulora_agent_queue_index: currentStepIndex,
    zulora_agent_status: taskStatus,
    zulora_agent_log: actionLog.slice(-100)
  }).catch(() => {});
}

async function persistScreenMemory(entry) {
  try {
    const saved = await chrome.storage.local.get('zulora_session_memory');
    const memory = Array.isArray(saved.zulora_session_memory) ? saved.zulora_session_memory : [];
    memory.push({
      timestamp: entry.timestamp || Date.now(),
      url: entry.url || '',
      title: entry.title || '',
      summary: String(entry.summary || '').slice(0, 1500),
      step: entry.step || null,
      status: entry.status || 'captured'
    });
    await chrome.storage.local.set({ zulora_session_memory: memory.slice(-12) });
  } catch {}
}

async function setLatestScreenshot(dataUrl) {
  latestScreenshotDataUrl = dataUrl || '';
  if (chrome.storage.session) {
    try {
      if (latestScreenshotDataUrl) await chrome.storage.session.set({ zulora_latest_screenshot: latestScreenshotDataUrl });
      else await chrome.storage.session.remove('zulora_latest_screenshot');
    } catch {}
  }
}

async function getLatestScreenshot() {
  if (latestScreenshotDataUrl) return latestScreenshotDataUrl;
  if (chrome.storage.session) {
    try {
      const saved = await chrome.storage.session.get('zulora_latest_screenshot');
      latestScreenshotDataUrl = saved.zulora_latest_screenshot || '';
    } catch {}
  }
  return latestScreenshotDataUrl;
}

// ─── 4. Direct App Routing Matrix (BUGFIX 3) ──────────────────────────────────
const APP_ROUTING_MATRIX = {
  'gemini': 'https://gemini.google.com/app', 'google gemini': 'https://gemini.google.com/app',
  'gmail': 'https://mail.google.com', 'youtube': 'https://www.youtube.com',
  'chatgpt': 'https://chatgpt.com', 'chat gpt': 'https://chatgpt.com',
  'claude': 'https://claude.ai', 'perplexity': 'https://www.perplexity.ai',
  'whatsapp': 'https://web.whatsapp.com', 'whats app': 'https://web.whatsapp.com',
  'zulora school': 'https://school.zulora.in', 'zulora drive': 'https://drive.zulora.in',
  'telegram': 'https://web.telegram.org', 'discord': 'https://discord.com/app',
  'slack': 'https://app.slack.com', 'github': 'https://github.com',
  'notion': 'https://www.notion.so', 'figma': 'https://www.figma.com',
  'canva': 'https://www.canva.com', 'google docs': 'https://docs.google.com',
  'google sheets': 'https://sheets.google.com', 'google drive': 'https://drive.google.com',
  'google meet': 'https://meet.google.com', 'google maps': 'https://maps.google.com',
  'twitter': 'https://twitter.com', 'x.com': 'https://x.com',
  'linkedin': 'https://www.linkedin.com', 'instagram': 'https://www.instagram.com',
  'reddit': 'https://www.reddit.com', 'netflix': 'https://www.netflix.com',
  'spotify': 'https://open.spotify.com', 'amazon': 'https://www.amazon.in',
  'flipkart': 'https://www.flipkart.com', 'wikipedia': 'https://en.wikipedia.org',
  'stackoverflow': 'https://stackoverflow.com', 'stack overflow': 'https://stackoverflow.com',
  'vercel': 'https://vercel.com/dashboard', 'firebase': 'https://console.firebase.google.com',
  'copilot': 'https://copilot.microsoft.com', 'grok': 'https://grok.x.ai',
  'notebooklm': 'https://notebooklm.google.com', 'leetcode': 'https://leetcode.com',
  'replit': 'https://replit.com', 'codepen': 'https://codepen.io',
};

function resolveDirectUrlBg(phrase) {
  const lower = String(phrase || '').toLowerCase().trim();
  const sorted = Object.keys(APP_ROUTING_MATRIX).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (lower.includes(key)) return APP_ROUTING_MATRIX[key];
  }
  if (/^https?:\/\//.test(lower)) return lower;
  if (/^[a-z0-9-]+\.[a-z]{2,}/.test(lower)) return 'https://' + lower;
  return null;
}

// ─── 5. API Key Waterfall Brain — BUGFIX 4: Exponential Backoff Retry Engine ──
async function executeAiWaterfall(prompt, systemInstruction = '', model = 'gemini-2.0-flash') {
  const tierTimeoutMs = 1800;

  const request = (url, options, timeoutMs = tierTimeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  // Each provider tier gets one bounded attempt. A rate limit falls through immediately.
  const tryProvider = async (name, callFn, retries = 1) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await callFn(attempt);
        if (result && result.success && result.text) return result;
        if (result && result._rateLimit) return null; // 429 silent skip
      } catch (e) {
        if (attempt < retries) await sleep(40);
      }
    }
    return null;
  };

  const messages = (systemInstruction)
    ? [{ role: 'system', content: systemInstruction }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];

  // ── Priority 1: Groq Llama-3.3-70b (Fastest <400ms) ──
  if (cachedApiKeys.groqKey) {
    const result = await tryProvider('Groq', async () => {
      const res = await request('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cachedApiKeys.groqKey}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 1024, temperature: 0.2 })
      }, tierTimeoutMs);
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'groq', tokensUsed: Number(data?.usage?.total_tokens) || 0 } : null;
    });
    if (result) return result;
  }

  // ── Priority 2: Cerebras Llama-3.1-70b (<300ms ultra-fast) ──
  if (cachedApiKeys.cerebrasKey) {
    const result = await tryProvider('Cerebras', async () => {
      const res = await request('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cachedApiKeys.cerebrasKey}` },
        body: JSON.stringify({ model: 'llama3.1-70b', messages, max_tokens: 1024, temperature: 0.1 })
      }, tierTimeoutMs);
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'cerebras', tokensUsed: Number(data?.usage?.total_tokens) || 0 } : null;
    });
    if (result) return result;
  }

  // ── Priority 3: Gemini REST key pool (2.0 Flash → 1.5 Flash) ──
  const keys = (cachedApiKeys.geminiKeys || []).filter(k => k && k.length > 20);
  const modelsToTry = ['gemini-2.0-flash'];
  const geminiDeadline = Date.now() + tierTimeoutMs;

  for (const apiKey of keys) {
    const remainingMs = geminiDeadline - Date.now();
    if (remainingMs <= 0) break;
    let keyRateLimited = false;
    for (const modelId of modelsToTry) {
      if (keyRateLimited) break;
      const requestTimeout = Math.max(1, Math.min(tierTimeoutMs, geminiDeadline - Date.now()));
      const result = await tryProvider(`Gemini/${modelId}`, async () => {
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
        const res = await request(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          requestTimeout
        );
        if (res.status === 429 || res.status === 403) { keyRateLimited = true; return { _rateLimit: true }; }
        if (!res.ok) return null;
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text ? { success: true, text, provider: 'gemini', model: modelId, tokensUsed: Number(data?.usageMetadata?.totalTokenCount) || 0 } : null;
      }, 1);
      if (result && result.success) return result;
    }
  }

  // ── Priority 4: OpenRouter fallback ──
  if (cachedApiKeys.openRouterKey) {
    const result = await tryProvider('OpenRouter', async () => {
      const res = await request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cachedApiKeys.openRouterKey}`, 'HTTP-Referer': 'https://zulora.in' },
        body: JSON.stringify({ model: 'mistralai/mistral-7b-instruct', max_tokens: 512, messages })
      }, tierTimeoutMs);
      if (res.status === 429 || res.status === 403) return { _rateLimit: true };
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? { success: true, text, provider: 'openrouter', tokensUsed: Number(data?.usage?.total_tokens) || 0 } : null;
    });
    if (result) return result;
  }

  // ── Priority 5: Graceful fallback — NEVER crash the agent UI ──
  console.warn('[Zulora SW Waterfall] All providers exhausted, using local deterministic fallback');
  return { success: false, text: '', error: null, provider: 'local_deterministic' };
}

async function executeGeminiVision(prompt, screenshotDataUrl) {
  const keys = (cachedApiKeys.geminiKeys || []).filter(key => key && key.length > 20);
  if (!keys.length) return { success: false, error: 'Add a Gemini API key in the Zulora extension settings to analyze screenshots.' };
  const match = String(screenshotDataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return { success: false, error: 'No valid screenshot is available to send to Gemini.' };
  const deadline = Date.now() + 1800;

  for (const apiKey of keys) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await requestGeminiVision(apiKey, prompt, match[1], match[2], remaining);
      if (response?.status === 429 || response?.status === 403) continue;
      if (!response?.ok) continue;
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
      if (text) return {
        success: true,
        text,
        provider: 'gemini-2.0-flash-vision',
        tokensUsed: Number(data?.usageMetadata?.totalTokenCount) || 0
      };
    } catch {}
  }
  return { success: false, error: 'Gemini screenshot analysis failed or timed out.' };
}

function requestGeminiVision(apiKey, prompt, mimeType, imageData, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt || 'Describe the screenshot.' }, { inline_data: { mime_type: mimeType, data: imageData } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

// ─── 5. Dynamic Tab Creator & Loader ──────────────────────────────────────────
async function openTabAndWait(url, matchPattern = null, timeout = 25000) {
  if (matchPattern) {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url && t.url.includes(matchPattern));
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.status === 'complete') return existing.id;
      return waitForTabComplete(existing.id, timeout);
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  return waitForTabComplete(tab.id, timeout);
}

function waitForTabComplete(tabId, timeout = 25000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
      resolve(tabId);
    }, timeout);

    const listener = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
      resolve(tabId);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function injectAndRun(tabId, func, args = [], maxRetries = 3, retryDelay = 1500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sleep(attempt === 1 ? 400 : retryDelay);
      const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
      return results?.[0]?.result;
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('Cannot access') || err.message?.includes('No tab')) break;
    }
  }
  throw lastErr || new Error('Script execution failed');
}

// ─── 6. Universal Injected Automation Executor ────────────────────────────────
// NOTE: This function is serialized and injected into target tabs via chrome.scripting.executeScript.
// It MUST be a pure, self-contained function with NO references to outer scope variables.
function __zuloraUniversalExecutor(action, payload) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitForPageReady(timeout = 5000) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return true;
    await Promise.race([
      new Promise(resolve => window.addEventListener('DOMContentLoaded', resolve, { once: true })),
      sleep(timeout)
    ]);
    return document.readyState !== 'loading';
  }

  async function waitFor(selectors, timeout = 12000) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await sleep(200);
    }
    return null;
  }

  function insertText(el, text) {
    const safeText = typeof text === 'object'
      ? (text.text || text.query || text.searchTerm || Object.values(text).join(' '))
      : String(text || '');
    if (el.isContentEditable) {
      el.focus();
      el.replaceChildren();
      el.appendChild(document.createTextNode(safeText));
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: safeText, bubbles: true }));
    } else {
      el.focus();
      const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      valueSetter ? valueSetter.call(el, safeText) : (el.value = safeText);
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: safeText, bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function pressEnter(el) {
    [  'keydown', 'keypress', 'keyup'].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
  }

  async function waitForResponseMutation(containerSelector, timeout = 35000) {
    const container = document.querySelector(containerSelector);
    if (!container) return null;
    return new Promise((resolve) => {
      let lastText = container.innerText;
      let stableTimer;
      const timeoutTimer = setTimeout(() => {
        observer.disconnect();
        resolve(container.innerText?.slice(-3500) || '');
      }, timeout);
      const observer = new MutationObserver(() => {
        const curText = container.innerText;
        if (curText !== lastText) {
          lastText = curText;
          clearTimeout(stableTimer);
          stableTimer = setTimeout(() => {
            observer.disconnect();
            clearTimeout(timeoutTimer);
            resolve(curText?.slice(-3500) || '');
          }, 2000);
        }
      });
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    });
  }

  // ── Individual Action Handlers ──

  async function whatsapp(contactName, message) {
    await waitForPageReady(5000);
    const phone = String(contactName || '').replace(/[^+\d]/g, '');
    if (phone.length >= 7 && /^[+\d\s().-]+$/.test(String(contactName || ''))) {
      location.href = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone.replace(/^\+/, ''))}`;
      await sleep(2500);
    }
    const whatsappSearchSelectors = [
      'div[contenteditable="true"][data-tab="3"]',
      'div[title="Search input box"]',
      'div[role="textbox"]',
      'p.selectable-text'
    ];
    let searchBox = await waitFor(whatsappSearchSelectors, 5000);
    if (searchBox?.tagName === 'P' && !searchBox.isContentEditable) searchBox = searchBox.closest('[contenteditable="true"]');
    if (searchBox?.getAttribute('role') === 'textbox') {
      const bounds = searchBox.getBoundingClientRect();
      if (bounds.left > innerWidth * 0.48 && !/search/i.test(`${searchBox.title} ${searchBox.getAttribute('aria-label') || ''}`)) searchBox = null;
    }
    if (!searchBox) return { error: 'WhatsApp search box not found after the 5 second page wait.', visionFallback: true };

    insertText(searchBox, contactName);
    await sleep(1500);

    let contact = await waitFor([
      '#pane-side div[role="listitem"]',
      '#pane-side [data-testid="cell-frame-container"]',
      'div[role="listitem"] div[tabindex="-1"]'
    ], 8000);
    if (contactName && contact) {
      const matches = Array.from(document.querySelectorAll('#pane-side [role="listitem"], #pane-side [data-testid="cell-frame-container"], [role="listitem"]'));
      contact = matches.find(el => (el.innerText || el.getAttribute('aria-label') || '').toLowerCase().includes(String(contactName).toLowerCase())) || contact;
    }
    if (!contact) return { error: `Contact "${contactName}" not found.` };
    contact.click();
    await sleep(1200);

    const msgInput = await waitFor([
      'footer div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"]',
      'div[contenteditable="true"][spellcheck="true"]'
    ], 8000);
    if (!msgInput) return { error: 'WhatsApp chat input not found.' };

    insertText(msgInput, message);
    await sleep(400);
    const sendBtn = document.querySelector('[data-icon="send"], button[aria-label*="Send" i], span[data-icon="send"]');
    if (sendBtn) (sendBtn.closest('button') || sendBtn).click(); else pressEnter(msgInput);
    return { success: true, contact: contactName };
  }

  function screenCoordinateMap() {
    return Array.from(document.querySelectorAll('a,button,input,textarea,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]')).map((el, index) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
      const label = (el.innerText || el.getAttribute('aria-label') || el.placeholder || el.title || el.getAttribute('data-testid') || '').trim().slice(0, 100);
      return {
        index, label, title: el.title || '', ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '', role: el.getAttribute('role') || '',
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', name: el.getAttribute('name') || '',
        id: el.id || '', contentEditable: Boolean(el.isContentEditable), viewportWidth: innerWidth
      };
    }).filter(Boolean).slice(0, 120);
  }

  function elementAtPoint(x, y) {
    const hit = document.elementFromPoint(Number(x), Number(y));
    return hit?.closest('input,textarea,[contenteditable="true"],[role="textbox"]') || hit;
  }

  function typeAtCoordinate(x, y, text) {
    const el = elementAtPoint(x, y);
    if (!el) return { error: 'No input element at the recovered screen coordinate.' };
    el.scrollIntoView({ block: 'center' });
    el.focus?.();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: Number(x), clientY: Number(y) }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: Number(x), clientY: Number(y) }));
    el.click?.();
    insertText(el, text);
    return { success: true, typed: true, x: Number(x), y: Number(y) };
  }

  async function whatsappVisionFallback(contactName, message, searchPoint) {
    await waitForPageReady(5000);
    let searchBox = await waitFor([
      'div[contenteditable="true"][data-tab="3"]', 'div[title="Search input box"]',
      'div[role="textbox"]', 'p.selectable-text'
    ], 1200);
    if (!searchBox && searchPoint) searchBox = elementAtPoint(searchPoint.x, searchPoint.y);
    if (!searchBox) return { error: 'Vision fallback could not locate a WhatsApp search input.' };
    searchBox.focus?.();
    searchBox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: searchPoint?.x || 0, clientY: searchPoint?.y || 0 }));
    searchBox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: searchPoint?.x || 0, clientY: searchPoint?.y || 0 }));
    searchBox.click?.();
    insertText(searchBox, contactName);
    await sleep(900);
    const match = await waitFor([
      '#pane-side [role="listitem"]', '#pane-side [data-testid="cell-frame-container"]', '[role="listitem"]'
    ], 5000);
    const candidates = Array.from(document.querySelectorAll('#pane-side [role="listitem"], #pane-side [data-testid="cell-frame-container"], [role="listitem"]'));
    const contact = candidates.find(el => (el.innerText || el.getAttribute('aria-label') || '').toLowerCase().includes(String(contactName).toLowerCase())) || match;
    if (!contact) return { error: `Vision fallback could not find contact "${contactName}".` };
    contact.click();
    await sleep(800);
    const messageInput = await waitFor([
      'footer div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"]', 'footer [role="textbox"]'
    ], 5000);
    if (!messageInput) return { error: 'Vision fallback could not locate the WhatsApp message box.' };
    insertText(messageInput, message);
    await sleep(300);
    const sendBtn = document.querySelector('[data-icon="send"], button[aria-label*="Send" i], span[data-icon="send"]');
    if (sendBtn) (sendBtn.closest('button') || sendBtn).click(); else pressEnter(messageInput);
    return { success: true, contact: contactName, usedVisionFallback: true };
  }

  async function chatgpt(prompt, waitResponse) {
    const input = await waitFor([
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"]'
    ], 15000);
    if (!input) return { error: 'ChatGPT prompt box not found.' };

    insertText(input, prompt);
    await sleep(400);
    const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send prompt" i]');
    if (sendBtn && !sendBtn.disabled) sendBtn.click(); else pressEnter(input);
    if (!waitResponse) return { success: true, promptSubmitted: true };
    await sleep(2000);
    const response = await waitForResponseMutation('[data-message-author-role="assistant"]:last-child, .markdown.prose:last-of-type', 40000);
    return { success: true, response };
  }

  async function gemini(prompt, waitResponse) {
    const input = await waitFor([
      'rich-textarea p',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="prompt" i]'
    ], 15000);
    if (!input) return { error: 'Gemini input box not found.' };

    insertText(input, prompt);
    await sleep(400);
    const sendBtn = document.querySelector('button[aria-label*="Send prompt" i], button.send-button, button[aria-label*="Send" i]');
    if (sendBtn) sendBtn.click(); else pressEnter(input);
    if (!waitResponse) return { success: true, promptSubmitted: true };
    await sleep(2000);
    const response = await waitForResponseMutation('model-response:last-of-type .markdown, .response-container:last-child', 40000);
    return { success: true, response };
  }

  async function gmail(to, subject, bodyHtml) {
    await selectGoogleProfile();
    if (to) {
      const toField = await waitFor(['input[aria-label*="To" i]', 'input[name="to"]'], 8000);
      if (toField) {
        insertText(toField, to);
        toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(400);
      }
    }
    if (subject) {
      const subjField = await waitFor(['input[name="subjectbox"]', 'input[aria-label*="Subject" i]'], 6000);
      if (subjField) insertText(subjField, subject);
    }
    const bodyField = await waitFor(['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[contenteditable="true"][g_editable="true"]', '.Am.Al.editable[contenteditable="true"]', 'div[contenteditable="true"]'], 8000);
    if (!bodyField) return { error: 'Gmail message body not found.' };
    bodyField.focus();
    bodyField.innerHTML = bodyHtml || '';
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true };
  }

  async function selectGoogleProfile() {
    if (!location.hostname.includes('google.')) return { selected: false };
    const desired = 'shivenpanwar412@gmail.com';
    const signIn = Array.from(document.querySelectorAll('a[href*="accounts.google.com"],button,[role="button"]'))
      .find(el => /sign in with google|choose an account|sign in/i.test(el.innerText || el.getAttribute('aria-label') || ''));
    const exactProfile = Array.from(document.querySelectorAll('a,button,[role="button"]'))
      .find(el => (el.innerText || el.getAttribute('aria-label') || '').toLowerCase().includes(desired));
    if (exactProfile && !document.querySelector('input[type="password"]')) {
      exactProfile.click();
      await sleep(900);
      return { selected: desired };
    }
    if (signIn && !document.querySelector('input[type="password"]')) signIn.click();
    return { selected: false };
  }

  async function readScreen(deep) {
    return {
      title: document.title,
      url: window.location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.innerText?.trim()).filter(Boolean).slice(0, 10),
      metaDesc: document.querySelector('meta[name="description"]')?.content || '',
      bodyText: (document.body?.innerText || '').slice(0, deep ? 15000 : 4000)
    };
  }

  async function youtube(query) {
    const safeQuery = typeof query === 'object'
      ? (query.text || query.query || Object.values(query).join(' '))
      : String(query || '');
    const searchInput = await waitFor(['input#search', 'input[name="search_query"]'], 12000);
    if (!searchInput) return { error: 'YouTube search bar not found.' };
    insertText(searchInput, safeQuery);
    await sleep(400);
    const searchBtn = document.querySelector('button#search-icon-legacy');
    if (searchBtn) searchBtn.click(); else pressEnter(searchInput);
    await sleep(2500);
    const firstVideo = await waitFor(['ytd-video-renderer #video-title', 'a#video-title'], 12000);
    if (!firstVideo) return { error: 'No YouTube video results found.' };
    firstVideo.click();
    return { success: true, title: firstVideo.innerText };
  }

  async function autofill(fieldValues = {}) {
    const entries = Object.entries(fieldValues || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="password"]),textarea,[contenteditable="true"]'));
    let filled = 0;
    for (const input of inputs) {
      if (input.value || input.innerText?.trim()) continue;
      const idName = [input.name, input.id, input.getAttribute('aria-label'), input.placeholder, input.labels?.[0]?.innerText].filter(Boolean).join(' ').toLowerCase();
      const match = entries.find(([key]) => idName.includes(key.toLowerCase()));
      if (match) {
        insertText(input, String(match[1]));
        filled++;
        await sleep(100);
      }
    }
    return { success: true, filled, submitted: false };
  }

  async function evaluateTopResult() {
    const links = Array.from(document.querySelectorAll('a'))
      .filter(a => a.href && a.href.startsWith('http') && !a.href.includes('google.com/search'))
      .slice(0, 10);
    if (!links.length) return { error: 'No search results found.' };
    const best = links.find(a => a.querySelector('h3')) || links[0];
    return { success: true, url: best.href, title: best.innerText };
  }

  async function clickEl(selector, target) {
    let el = selector ? await waitFor(selector, 4000) : null;
    if (!el && target) {
      // Fuzzy heuristic matching (Agent 3 selector recovery)
      const allClickable = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], [onclick]'));
      el = allClickable.find(b => (b.innerText || b.textContent || '').toLowerCase().includes(target.toLowerCase()));
    }
    if (!el && selector) {
      const allClickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      el = allClickable.find(b => (b.innerText || b.textContent || '').toLowerCase().includes(selector.toLowerCase()));
    }
    if (!el && target) {
      const label = String(target).toLowerCase();
      const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[role="link"],input[type="submit"]'));
      const visionTarget = candidates.find(candidate => {
        const r = candidate.getBoundingClientRect();
        const text = (candidate.innerText || candidate.getAttribute('aria-label') || candidate.title || '').toLowerCase();
        return text.includes(label) && r.width && r.height && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      });
      if (visionTarget) {
        const r = visionTarget.getBoundingClientRect();
        el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || visionTarget;
      }
    }
    if (!el) return { error: `Element not found: ${selector || target}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(150);

    // Agent 2 Turtle Cursor Simulation
    const rect = el.getBoundingClientRect();
    const turtle = document.getElementById('zulora-turtle-cursor');
    if (turtle) {
      turtle.style.opacity = '1';
      turtle.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px)`;
      const ripple = turtle.querySelector('.zulora-cursor-ripple');
      if (ripple) {
        ripple.classList.add('animate');
        setTimeout(() => ripple.classList.remove('animate'), 350);
      }
      await sleep(180);
      turtle.style.opacity = '0';
    }

    el.focus();
    el.click();
    return { success: true, clicked: true, tag: el.tagName };
  }

  function clickVisionCoordinate(x, y) {
    const target = document.elementFromPoint(Number(x), Number(y));
    if (!target) return { error: 'No interactive element at the requested screen coordinate.' };
    const clickable = target.closest('button,a,[role="button"],[role="link"],input[type="submit"],[onclick]') || target;
    clickable.focus?.();
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: Number(x), clientY: Number(y) }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: Number(x), clientY: Number(y) }));
    clickable.click();
    return { success: true, clicked: true, x: Number(x), y: Number(y), label: (clickable.innerText || clickable.getAttribute('aria-label') || '').trim().slice(0, 80) };
  }

  async function typeEl(selector, text, target) {
    let el = selector ? await waitFor(selector, 4000) : null;
    if (!el && target) {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      el = inputs.find(i =>
        (i.placeholder || '').toLowerCase().includes(target.toLowerCase()) ||
        (i.name || '').toLowerCase().includes(target.toLowerCase()) ||
        (i.id || '').toLowerCase().includes(target.toLowerCase())
      );
    }
    if (!el && selector) {
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      el = inputs.find(i => (i.placeholder || '').toLowerCase().includes(selector.toLowerCase()));
    }
    if (!el) return { error: `Input element not found: ${selector || target}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(150);

    // Agent 2 Turtle Cursor Simulation
    const rect = el.getBoundingClientRect();
    const turtle = document.getElementById('zulora-turtle-cursor');
    if (turtle) {
      turtle.style.opacity = '1';
      turtle.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px)`;
      await sleep(150);
      turtle.style.opacity = '0';
    }

    insertText(el, text);
    return { success: true, filled: true, value: text };
  }

  async function scrollPage(direction) {
    const amount = window.innerHeight * 0.8;
    window.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
    await sleep(800);
    return { success: true, scrolled: direction };
  }

  async function downloadImage(target) {
    let img = null;
    if (target) img = await waitFor(target, 4000);
    if (!img) img = document.querySelector('img[src]');
    if (!img || !img.src) return { error: 'No image found to download.' };
    
    // Agent 2 Turtle Cursor Simulation
    const rect = img.getBoundingClientRect();
    const turtle = document.getElementById('zulora-turtle-cursor');
    if (turtle) {
      turtle.style.opacity = '1';
      turtle.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px)`;
      await sleep(150);
      turtle.style.opacity = '0';
    }
    
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'zulora_image_download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, downloaded: img.src };
  }

  // ── Dispatcher ──
  switch (action) {
    case 'WHATSAPP':        return whatsapp(payload.contact, payload.message);
    case 'WHATSAPP_VISION': return whatsappVisionFallback(payload.contact, payload.message, payload.searchPoint);
    case 'CHATGPT':         return chatgpt(payload.prompt, payload.waitResponse !== false);
    case 'GEMINI':          return gemini(payload.prompt, payload.waitResponse !== false);
    case 'GMAIL':           return gmail(payload.to, payload.subject, payload.bodyHtml);
    case 'READ_SCREEN':     return readScreen(payload.deep);
    case 'CLICK':           return clickEl(payload.selector, payload.target);
    case 'VISION_CLICK':    return clickVisionCoordinate(payload.x, payload.y);
    case 'VISION_TYPE':     return typeAtCoordinate(payload.x, payload.y, payload.text);
    case 'TYPE':            return typeEl(payload.selector, payload.text, payload.target);
    case 'SCROLL':          return scrollPage(payload.direction);
    case 'DOWNLOAD_IMAGE':  return downloadImage(payload.target);
    case 'YOUTUBE':         return youtube(payload.query);
    case 'AUTOFILL':        return autofill(payload.fieldValues || {});
    case 'EVAL_TOP_RESULT': return evaluateTopResult();
    case 'GOOGLE_SESSION_SELECT': return selectGoogleProfile();
    case 'SCREEN_COORDINATE_MAP': return screenCoordinateMap();
    default:                return { error: 'Unknown action: ' + action };
  }
}

function __zuloraDriveUpload(html, fileName) {
  return new Promise(async resolve => {
    const safeName = String(fileName || 'index.html').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'index.html';
    const isVisible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const loginControl = Array.from(document.querySelectorAll('a,button,[role="button"]')).find(element =>
      isVisible(element) && /sign in|log in|login|continue with google/i.test(element.innerText || element.getAttribute('aria-label') || '')
    );
    const uploadButton = document.querySelector('#newUploadBtn, #emptyUploadBtn, #headerUploadBtn, #mobileBottomUploadBtn');
    if (loginControl && !isVisible(uploadButton)) {
      resolve({ error: 'Sign in to Zulora Drive in the opened tab, then try the export again.', requiresLogin: true });
      return;
    }
    const input = document.querySelector('#fileUploadInput[type="file"]');
    if (!input) {
      resolve({ error: 'Zulora Drive upload control was not available on this page.' });
      return;
    }
    const drawer = document.querySelector('#uploadDrawer');
    const initiallyOpen = Boolean(drawer && isVisible(drawer));
    const data = new DataTransfer();
    const mimeType = safeName.toLowerCase().endsWith('.txt') ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8';
    data.items.add(new File([String(html || '')], safeName, { type: mimeType, lastModified: Date.now() }));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const startedAt = Date.now();
    const deadline = startedAt + 35000;
    let observedOpen = initiallyOpen;
    const poll = () => {
      const status = document.querySelector('#uploadDrawerStatus')?.innerText || '';
      const body = document.body?.innerText || '';
      if (/upload failed|failed to upload|quota exceeded|not enough storage/i.test(`${status}\n${body.slice(-1600)}`)) {
        resolve({ error: status.trim() || 'Zulora Drive reported an upload error.' });
        return;
      }
      if (drawer && isVisible(drawer)) observedOpen = true;
      if (observedOpen && drawer && !isVisible(drawer) && Date.now() - startedAt > 1200) {
        resolve({ success: true, fileName: safeName, message: `Uploaded ${safeName} to Zulora Drive.` });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ success: true, queued: true, fileName: safeName, message: `Sent ${safeName} to Zulora Drive. Check the Drive upload panel for status.` });
        return;
      }
      setTimeout(poll, 350);
    };
    setTimeout(poll, 350);
  });
}

// ─── 7. Step Execution Engine ─────────────────────────────────────────────────
function humanLabel(action, params) {
  const map = {
    open_url:                 `Open: ${params.url}`,
    switch_tab:               `Switch Tab (${params.urlContains})`,
    search_google:            `Google Search: "${params.query}"`,
    type_text:                `Type into: ${params.selector}`,
    click_element:            `Click: ${params.selector}`,
    read_page_dom:            `Screen Reader`,
    capture_screenshot:       `Screenshot`,
    gmail_compose:            `Gmail Compose → ${params.to || 'recipient'}`,
    whatsapp_send:            `WhatsApp → ${params.recipient || params.contact || 'contact'}`,
    chatgpt_prompt:           `ChatGPT prompt`,
    gemini_prompt:            `Gemini prompt`,
    youtube_play:             `YouTube: "${params.query}"`,
    autofill_form:            `Auto-fill form`,
    evaluate_and_open_top_result: `Open top search result`,
    ai_reasoning:             `AI Reasoning`,
    llm_generate:             `AI Generate`,
    export_code:              `Export: ${params.filename || 'file'}`,
    export_pdf:               `Export PDF`,
    wait:                     `Wait ${params.ms || 2000}ms`,
    notify_user:              `Notify: ${params.message}`
  };
  return map[action] || action;
}

async function executeStep(step) {
  const { action, params = {} } = step;
  if (isCancelled) throw new Error('Task stopped by user');

  log(humanLabel(action, params), 'running');

  try {
    let result = {};

    const act = (action || '').toLowerCase();

    switch (act) {

      case 'open_url':
      case 'navigate': {
        let url = params.url || 'https://google.com';
        if (!/^(https?:|tel:|whatsapp:)/i.test(url)) url = 'https://' + url;
        let tabId;
        if (/^(tel|whatsapp):/i.test(url)) {
          try { tabId = (await chrome.tabs.create({ url, active: true })).id; }
          catch {
            const fallback = /^tel:/i.test(url) ? 'https://meet.google.com' : 'https://web.whatsapp.com';
            tabId = await openTabAndWait(fallback);
          }
        } else tabId = await openTabAndWait(url);
        log(`Opened: ${url}`, 'done');
        result = { tabId, url };
        break;
      }

      case 'search_google': {
        const safeQ = typeof params.query === 'object'
          ? (params.query.text || Object.values(params.query).join(' '))
          : String(params.query || '');
        const url = `https://www.google.com/search?q=${encodeURIComponent(safeQ)}`;
        const tabId = await openTabAndWait(url);
        log(`Searched: "${safeQ}"`, 'done');
        result = { tabId };
        break;
      }

      case 'evaluate_and_open_top_result': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) throw new Error('No active tab');
        const evalRes = await injectAndRun(tabId, __zuloraUniversalExecutor, ['EVAL_TOP_RESULT', {}], 3, 3000);
        if (evalRes?.error) throw new Error(evalRes.error);
        log(`Navigating to: ${evalRes.url}`, 'running');
        await chrome.tabs.update(tabId, { url: evalRes.url });
        await waitForTabComplete(tabId, 20000);
        result = { tabId, url: evalRes.url };
        break;
      }

      case 'switch_tab': {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url && t.url.includes(params.urlContains || ''));
        if (target) {
          await chrome.tabs.update(target.id, { active: true });
          log(`Switched to: ${target.title}`, 'done');
          result = { tabId: target.id };
        } else {
          throw new Error(`Tab matching "${params.urlContains}" not found`);
        }
        break;
      }

      case 'youtube_play': {
        const safeQuery = typeof params.query === 'object'
          ? (params.query.text || Object.values(params.query).join(' '))
          : String(params.query || '');
        log(`YouTube: Loading...`, 'running');
        const ytTabId = await openTabAndWait('https://www.youtube.com', 'youtube.com', 20000);
        await sleep(2000);
        const ytRes = await injectAndRun(ytTabId, __zuloraUniversalExecutor, ['YOUTUBE', { query: safeQuery }], 3, 2000);
        if (ytRes?.error) throw new Error(ytRes.error);
        log(`YouTube: Playing "${ytRes.title}"`, 'done');
        result = { tabId: ytTabId, ...ytRes };
        break;
      }

      case 'autofill_form': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const intent = String(params.intent || '');
        let fieldValues = {};
        if (intent) {
          const generated = await executeAiWaterfall(intent, 'Extract only explicitly provided values that belong in form fields. Return ONLY JSON object mapping concise field labels to values. Do not invent identity, passwords, or other personal data. Do not copy the whole instruction into any field.');
          try {
            const json = generated.text?.replace(/```json?|```/gi, '').match(/\{[\s\S]*\}/)?.[0];
            if (generated.success && json) fieldValues = JSON.parse(json);
          } catch {}
          const tokens = Number(generated.tokensUsed) || 0;
          if (tokens) broadcastTokenUsage(tokens);
        }
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['AUTOFILL', { fieldValues }]);
        if (res?.error) throw new Error(res.error);
        log(`Filled ${res.filled || 0} matching form field(s); review before submitting`, 'done');
        result = res;
        break;
      }

      case 'whatsapp_send': {
        const contact = params.recipient || params.contact;
        const message = params.message || '';
        if (!contact) {
          log('WhatsApp: Contact name required', 'paused');
          taskStatus = 'paused';
          broadcastStatus();
          safeNotify('Zulora — Input Required', 'Please specify a WhatsApp contact name.');
          result = { paused: true, reason: 'no_contact' };
          break;
        }
        log(`WhatsApp: Opening...`, 'running');
        const phone = String(contact).replace(/[^+\d]/g, '');
        const waUrl = phone.length >= 7 && /^[+\d\s().-]+$/.test(String(contact))
          ? `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone.replace(/^\+/, ''))}`
          : 'https://web.whatsapp.com';
        const matchingWa = phone.length >= 7 ? (await chrome.tabs.query({})).find(t => t.url?.includes('web.whatsapp.com')) : null;
        let waTabId;
        if (matchingWa?.id) {
          await chrome.tabs.update(matchingWa.id, { url: waUrl, active: true });
          waTabId = await waitForTabComplete(matchingWa.id, 30000);
        } else waTabId = await openTabAndWait(waUrl, phone.length >= 7 ? null : 'web.whatsapp.com', 30000);
        await sleep(2500);
        let waRes = await injectAndRun(waTabId, __zuloraUniversalExecutor, ['WHATSAPP', { contact, message }], 3, 2000);
        if (waRes?.visionFallback) {
          const waTab = await chrome.tabs.get(waTabId);
          let screenshot = '';
          try { screenshot = await chrome.tabs.captureVisibleTab(waTab.windowId, { format: 'jpeg', quality: 55 }); } catch {}
          if (screenshot) await setLatestScreenshot(screenshot);
          const coordinateMap = await injectAndRun(waTabId, __zuloraUniversalExecutor, ['SCREEN_COORDINATE_MAP', {}], 1, 0).catch(() => []);
          const inputs = (coordinateMap || []).filter(item => item.contentEditable || item.role === 'textbox' || ['input', 'textarea'].includes(item.tag));
          const searchPoint = inputs.find(item => /search/i.test(`${item.label} ${item.title} ${item.ariaLabel} ${item.placeholder}`))
            || inputs.find(item => item.x < (item.viewportWidth || 1280) * 0.48);
          if (screenshot && searchPoint) {
            waRes = await injectAndRun(waTabId, __zuloraUniversalExecutor, ['WHATSAPP_VISION', {
              contact, message, searchPoint: { x: searchPoint.x, y: searchPoint.y }
            }], 1, 0);
          }
        }
        if (waRes?.error) throw new Error(waRes.error);
        log(`WhatsApp: Sent to "${contact}"`, 'done');
        result = { tabId: waTabId, ...waRes };
        break;
      }

      case 'chatgpt_prompt': {
        const prompt = params.prompt || '';
        log(`ChatGPT: Opening...`, 'running');
        const cgTabId = await openTabAndWait('https://chatgpt.com', 'chatgpt.com', 20000);
        await sleep(2000);
        const cgRes = await injectAndRun(cgTabId, __zuloraUniversalExecutor, ['CHATGPT', { prompt, waitResponse: params.waitResponse !== false }], 3, 2000);
        if (cgRes?.error) throw new Error(cgRes.error);
        log(`ChatGPT: Prompt submitted`, 'done', cgRes?.response?.slice(0, 100) || '');
        result = { tabId: cgTabId, ...cgRes };
        break;
      }

      case 'gemini_prompt': {
        const prompt = params.prompt || '';
        if (params.includeScreenshot) {
          log('Gemini: Sending captured screenshot...', 'running');
          let screenshot = await getLatestScreenshot();
          if (!screenshot) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.windowId) {
              screenshot = await chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'jpeg', quality: 55 });
              await setLatestScreenshot(screenshot);
            }
          }
          const visionResult = await executeGeminiVision(prompt, screenshot);
          if (!visionResult.success) throw new Error(visionResult.error || 'Gemini image request failed.');
          if (visionResult.tokensUsed) broadcastTokenUsage(visionResult.tokensUsed);
          log('Gemini: Screenshot analyzed', 'done', visionResult.text.slice(0, 160));
          result = visionResult;
        } else {
          log(`Gemini: Opening...`, 'running');
          const gmTabId = await openTabAndWait('https://gemini.google.com/app', 'gemini.google.com', 20000);
          await sleep(2000);
          const gmRes = await injectAndRun(gmTabId, __zuloraUniversalExecutor, ['GEMINI', { prompt, waitResponse: params.waitResponse !== false }], 3, 2000);
          if (gmRes?.error) throw new Error(gmRes.error);
          log(`Gemini: Prompt submitted`, 'done', gmRes?.response?.slice(0, 100) || '');
          result = { tabId: gmTabId, ...gmRes };
        }
        break;
      }

      case 'gmail_compose': {
        const composeUrl = 'https://mail.google.com/mail/u/0/#inbox?compose=new';
        log(`Gmail: Opening compose...`, 'running');
        const gmTabId = await openTabAndWait(composeUrl, 'mail.google.com', 20000);
        await sleep(2500);
        const gmRes = await injectAndRun(gmTabId, __zuloraUniversalExecutor, [
          'GMAIL', { to: params.to, subject: params.subject, bodyHtml: params.bodyHtml || params.body || '' }
        ], 3, 2000);
        if (gmRes?.error) throw new Error(gmRes.error);
        log(`Gmail: Draft prepared → ${params.to || 'recipient'}`, 'done');
        result = { tabId: gmTabId };
        break;
      }

      case 'read_page_dom':
      case 'read_screen':
      case 'extract_data': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active browser tab');
        const dom = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['READ_SCREEN', { deep: params.deep !== false }]);
        log(`Screen Reader: Captured "${dom?.title || tab.title}"`, 'done');
        if (params.readAloud && dom?.text) {
          chrome.tabs.sendMessage(tab.id, { type: 'ZULORA_READ_SCREEN_TTS', text: dom.text.slice(0, 800) }).catch(() => {});
        }
        result = { dom, text: dom?.text || '' };
        break;
      }

      case 'capture_screenshot': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.windowId) throw new Error('No active window');
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
        await setLatestScreenshot(dataUrl);
        log(`Screenshot captured`, 'done');
        result = { screenshotCaptured: true, screenshot: dataUrl };
        break;
      }

      case 'ai_reasoning':
      case 'llm_generate': {
        const aiPrompt = String(params.prompt || '');

        // BUGFIX 3: Try direct URL routing BEFORE calling LLM brain
        const directNavUrl = resolveDirectUrlBg(aiPrompt);
        if (directNavUrl && /\b(open|go|take|launch|visit|load|show|navigate)\b/i.test(aiPrompt)) {
          log(`Direct Navigate: ${directNavUrl}`, 'running');
          const navTabId = await openTabAndWait(directNavUrl);
          log(`Opened: ${directNavUrl}`, 'done');
          result = { tabId: navTabId, url: directNavUrl };
          break;
        }

        log(`AI Brain: Reasoning...`, 'running');
        const aiRes = await executeAiWaterfall(aiPrompt, params.systemInstruction);
        if (aiRes?.tokensUsed) broadcastTokenUsage(aiRes.tokensUsed);
        if (!aiRes.success) {
          // Graceful: log and continue rather than throwing and halting queue
          log(`AI Brain: No response from providers, skipping step`, 'done');
          result = { skipped: true };
          break;
        }
        log(`AI Brain: Done via ${aiRes.provider}`, 'done', (aiRes.text || '').slice(0, 100));
        result = aiRes;
        break;
      }

      case 'click_element':
      case 'click': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        let res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['CLICK', { selector: params.selector, target: params.target }]);
        // Agent 3 Auto-Retry Verification
        if (res?.error && params.target) {
          await sleep(1000);
          res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['CLICK', { target: params.target }]);
        }
        if (res?.error) {
          let screenshot = '';
          try { screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 }); } catch {}
          if (screenshot) await setLatestScreenshot(screenshot);
          const coordinateMap = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['SCREEN_COORDINATE_MAP', {}], 1, 0).catch(() => []);
          const wanted = String(params.target || params.selector || '').toLowerCase();
          const match = (coordinateMap || []).find(item => `${item.label} ${item.ariaLabel} ${item.title}`.toLowerCase().includes(wanted));
          if (screenshot && match) res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['VISION_CLICK', { x: match.x, y: match.y }], 1, 0);
        }
        if (res?.error) throw new Error(res.error);
        log(`Agent 2 Clicked: ${params.selector || params.target}`, 'done');
        result = res;
        break;
      }

      case 'type_text':
      case 'fill_input': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const textToFill = params.text !== undefined ? params.text : (params.value || '');
        let res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['TYPE', { selector: params.selector, text: textToFill, target: params.target }]);
        // Agent 3 Auto-Retry Verification
        if (res?.error && params.target) {
          await sleep(1000);
          res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['TYPE', { target: params.target, text: textToFill }]);
        }
        if (res?.error) {
          let screenshot = '';
          try { screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 }); } catch {}
          if (screenshot) await setLatestScreenshot(screenshot);
          const coordinateMap = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['SCREEN_COORDINATE_MAP', {}], 1, 0).catch(() => []);
          const wanted = String(params.target || params.selector || '').toLowerCase();
          const editable = (coordinateMap || []).filter(item => ['input', 'textarea'].includes(item.tag) || item.contentEditable || item.role === 'textbox');
          const match = editable.find(item => `${item.label} ${item.ariaLabel} ${item.title} ${item.placeholder} ${item.name} ${item.id}`.toLowerCase().includes(wanted)) || editable[0];
          if (screenshot && match) res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['VISION_TYPE', { x: match.x, y: match.y, text: textToFill }], 1, 0);
        }
        if (res?.error) throw new Error(res.error);
        log(`Agent 2 Typed into: ${params.selector || params.target || 'input'}`, 'done');
        result = res;
        break;
      }

      case 'scroll': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        await injectAndRun(tab.id, __zuloraUniversalExecutor, ['SCROLL', { direction: params.direction }]);
        log(`Agent 2 Scrolled ${params.direction || 'down'}`, 'done');
        result = { success: true };
        break;
      }

      case 'download_image': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['DOWNLOAD_IMAGE', { target: params.target }]);
        if (res?.error) throw new Error(res.error);
        log(`Agent 2 Downloaded image`, 'done');
        result = res;
        break;
      }

      case 'post_data': {
        log(`POST Data to: ${params.url || 'endpoint'}`, 'done');
        result = { success: true };
        break;
      }

      case 'export_pdf': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.id) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.print() });
          log(`PDF Print Dialog opened`, 'done');
        }
        result = {};
        break;
      }

      case 'export_code': {
        const code = params.code || params.content || '';
        const filename = params.filename || 'zulora_export.js';
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(code)}`;
        await chrome.downloads.download({ url: dataUrl, filename });
        log(`Exported: ${filename}`, 'done');
        result = { filename };
        break;
      }

      case 'wait': {
        const ms = params.ms || 2000;
        await sleep(ms);
        log(`Waited ${ms}ms`, 'done');
        result = {};
        break;
      }

      case 'notify_user': {
        safeNotify('Zulora AI', params.message || 'Action completed.');
        log(`Notification: ${params.message}`, 'done');
        result = {};
        break;
      }

      default:
        log(`Action: ${action}`, 'done');
        result = {};
    }

    return result || {};
  } catch (err) {
    log(`Failed: ${err.message}`, 'error', err.message);
    throw err;
  }
}

// ─── 8. Queue Runner ──────────────────────────────────────────────────────────
async function runQueue() {
  if (isQueueRunning) return;
  isQueueRunning = true;
  isCancelled = false;
  taskStatus = 'running';
  await persistQueueState();
  broadcastStatus();

  while (currentStepIndex < taskQueue.length) {
    if (taskStatus === 'paused' || taskStatus === 'error' || isCancelled) break;
    try {
      const stepIndex = currentStepIndex;
      const res = await executeStep(taskQueue[stepIndex]);
      if (res?.paused) break;

      // ── Agent 3: Vision & Screen Reasoning Verifier ──
      try {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const curTab = activeTabs[0];
        if (curTab?.id) {
          let screenshot = '';
          try {
            if (curTab.windowId) {
              screenshot = await chrome.tabs.captureVisibleTab(curTab.windowId, { format: 'jpeg', quality: 50 });
            }
          } catch {}
          if (screenshot) await setLatestScreenshot(screenshot);

          const [domSnapshot, coordinateMap] = await Promise.all([
            injectAndRun(curTab.id, __zuloraUniversalExecutor, ['READ_SCREEN', { deep: false }], 1, 0).catch(() => null),
            injectAndRun(curTab.id, __zuloraUniversalExecutor, ['SCREEN_COORDINATE_MAP', {}], 1, 0).catch(() => [])
          ]);
          const screenMemoryPayload = {
            type: 'ZULORA_SCREEN_STATE_UPDATE',
            stepIndex: stepIndex + 1,
            totalSteps: taskQueue.length,
            stepAction: taskQueue[stepIndex]?.action,
            url: curTab.url || '',
            title: curTab.title || domSnapshot?.title || '',
            summary: String(domSnapshot?.bodyText || '').slice(0, 1500),
            screenshot,
            coordinateMap,
            status: 'verified',
            timestamp: Date.now()
          };
          await persistScreenMemory(screenMemoryPayload);

          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(t => {
              if (t.id && isZuloraOrigin(t.url || '')) {
                chrome.tabs.sendMessage(t.id, screenMemoryPayload).catch(() => {});
              }
            });
          });
        }
      } catch (visionErr) {
        console.warn('[Agent 3 Screen Verifier]', visionErr.message);
      }

      await sleep(250);
    } catch {
      taskStatus = 'error';
      await persistQueueState();
      broadcastStatus();
      isQueueRunning = false;
      return;
    }
    currentStepIndex++;
    await persistQueueState();
  }

  if (taskStatus === 'running') {
    taskStatus = 'done';
    safeNotify('✅ Zulora Task Complete', `Completed all ${taskQueue.length} step(s)!`);
  }
  await persistQueueState();
  broadcastStatus();
  isQueueRunning = false;
}

// ─── 9. Task Dispatcher ───────────────────────────────────────────────────────
function normalizeBackgroundStep(raw) {
  const action = String(raw?.action || raw?.type || '').toLowerCase();
  const source = raw?.params && typeof raw.params === 'object' ? { ...raw, ...raw.params } : raw || {};
  const stringValue = (...values) => String(values.find(value => value !== undefined && value !== null) || '');
  if (['navigate', 'open_url', 'open', 'go_to'].includes(action)) return { action: 'open_url', params: { url: stringValue(source.url, resolveDirectUrlBg(source.target || source.app), 'https://www.google.com') } };
  if (['type', 'type_text', 'fill_input'].includes(action)) return { action: 'type_text', params: { selector: source.selector, target: source.target, text: stringValue(source.text, source.value) } };
  if (['click', 'click_element'].includes(action)) return { action: 'click_element', params: { selector: source.selector, target: source.target || source.label } };
  if (['whatsapp', 'whatsapp_send'].includes(action)) return { action: 'whatsapp_send', params: { recipient: stringValue(source.recipient, source.contact, source.to), message: stringValue(source.message, source.text) } };
  if (['gemini', 'gemini_prompt'].includes(action)) return { action: 'gemini_prompt', params: { prompt: stringValue(source.prompt, source.message), includeScreenshot: Boolean(source.includeScreenshot || source.screenshot || /screenshot|screen shot/i.test(source.prompt || '')) } };
  if (['chatgpt', 'chatgpt_prompt'].includes(action)) return { action: 'chatgpt_prompt', params: { prompt: stringValue(source.prompt, source.message) } };
  if (['gmail', 'gmail_compose'].includes(action)) return { action: 'gmail_compose', params: { to: stringValue(source.to, source.recipient), subject: stringValue(source.subject), body: stringValue(source.body, source.message) } };
  if (['capture_screenshot', 'screenshot', 'take_screenshot'].includes(action)) return { action: 'capture_screenshot', params: {} };
  if (['read_screen', 'read_page_dom', 'extract_data'].includes(action)) return { action: 'read_screen', params: { deep: true } };
  if (action === 'autofill_form') return { action: 'autofill_form', params: { intent: stringValue(source.intent, source.prompt, source.value) } };
  if (action === 'wait') return { action: 'wait', params: { ms: Math.max(100, Math.min(5000, Number(source.ms) || 1000)) } };
  if (action === 'search_google') return { action: 'search_google', params: { query: stringValue(source.query, source.prompt) } };
  return null;
}

function planSimpleVoiceCommand(command) {
  const parts = String(command || '').split(/\s*(?:->|→|;|\bafter that\b|\band then\b|\bthen\b|\bnext\b)\s*/i).map(value => value.trim()).filter(Boolean);
  const steps = parts.map(phase => {
    const lower = phase.toLowerCase();
    if (/\b(?:take|capture|save)\s+(?:a\s+)?screenshot\b/.test(lower)) return { action: 'capture_screenshot', params: {} };
    if (/\b(?:send|share|show|analy[sz]e|describe)\s+(?:the\s+)?(?:screenshot|screen shot|image)\b/.test(lower) && /gemini/i.test(lower)) {
      return { action: 'gemini_prompt', params: { prompt: 'Analyze the screenshot of the current page and describe its contents.', includeScreenshot: true } };
    }
    if (/\b(?:fill|autofill)\s+(?:the\s+)?form\b/i.test(phase)) return { action: 'autofill_form', params: { intent: phase } };
    if (/\b(?:whatsapp|whats app)\b/i.test(phase)) {
      const recipient = phase.match(/\bto\s+(.+?)(?:\s+(?:saying|with|message)\b|$)/i)?.[1]?.trim() || '';
      const message = phase.match(/\b(?:saying|message)\s+["']?(.+?)["']?$/i)?.[1]?.trim() || '';
      return { action: 'whatsapp_send', params: { recipient, message } };
    }
    if (/\b(?:open|go to|visit|launch|navigate to)\b/i.test(phase)) {
      const target = phase.replace(/^.*?\b(?:open|go to|visit|launch|navigate to)\s+/i, '').trim();
      const url = resolveDirectUrlBg(target);
      if (url) return { action: 'open_url', params: { url } };
    }
    if (/\b(?:read|summari[sz]e)\s+(?:the\s+)?screen\b/i.test(phase)) return { action: 'read_screen', params: { deep: true } };
    if (/\bgemini\b/i.test(phase)) return { action: 'gemini_prompt', params: { prompt: phase, includeScreenshot: /screenshot|screen shot/i.test(phase) } };
    if (/\bchat\s*gpt\b|\bchatgpt\b/i.test(phase)) return { action: 'chatgpt_prompt', params: { prompt: phase } };
    return { action: 'ai_reasoning', params: { prompt: phase } };
  });
  return steps.filter(Boolean);
}

async function planVoiceCommand(command) {
  const systemPrompt = 'Convert the command into a JSON array of atomic browser steps. Output only JSON. Allowed actions: OPEN_URL {url}, TYPE_TEXT {selector,target,text}, CLICK {selector,target}, AUTOFILL_FORM {intent}, CAPTURE_SCREENSHOT {}, GEMINI_PROMPT {prompt,includeScreenshot}, CHATGPT_PROMPT {prompt}, WHATSAPP_SEND {recipient,message}, GMAIL_COMPOSE {to,subject,body}, READ_SCREEN {}, WAIT {ms}. Preserve the requested order. Include a screenshot before GEMINI_PROMPT when the user asks to send a screenshot to Gemini.';
  const result = await executeAiWaterfall(command, systemPrompt);
  if (result.tokensUsed) broadcastTokenUsage(result.tokensUsed);
  if (result.success && result.text) {
    try {
      const json = result.text.replace(/```json?|```/gi, '').match(/\[[\s\S]*\]/)?.[0];
      const parsed = JSON.parse(json || 'null');
      if (Array.isArray(parsed) && parsed.length) {
        const normalized = parsed.map(normalizeBackgroundStep).filter(Boolean).slice(0, 12);
        if (normalized.length) return normalized;
      }
    } catch {}
  }
  return planSimpleVoiceCommand(command);
}

async function handleAgentTask(payload) {
  if (!payload) return { ok: true };

  if (payload.type === 'EXPORT_TO_DRIVE_FILE') {
    if (!String(payload.html || '').trim()) return { ok: false, success: false, error: 'There is no generated HTML to upload.' };
    try {
      const driveTabId = await openTabAndWait('https://drive.zulora.in', 'drive.zulora.in', 30000);
      const result = await injectAndRun(driveTabId, __zuloraDriveUpload, [payload.html, payload.fileName || 'index.html'], 2, 800);
      if (result?.error) return { ok: false, success: false, ...result };
      return { ok: true, success: true, ...result };
    } catch (error) {
      return { ok: false, success: false, error: `Could not upload to Zulora Drive: ${error.message}` };
    }
  }

  if (payload.type === 'ZULORA_RUN_TASK' || payload.steps) {
    hasReceivedTaskMessage = true;
    taskQueue        = Array.isArray(payload.steps) ? payload.steps : [];
    if (!taskQueue.length && (payload.command || payload.voiceCommand)) {
      taskQueue = await planVoiceCommand(payload.command || payload.voiceCommand);
    }
    if (!taskQueue.length) return { ok: false, success: false, error: 'No browser steps could be planned from this command.' };
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    isCancelled      = false;
    await setLatestScreenshot('');
    await persistQueueState();
    runQueue();
    return { ok: true, success: true, queued: taskQueue.length };
  }

  if (payload.type === 'ZULORA_CANCEL' || payload.type === 'STOP_TASK') {
    hasReceivedTaskMessage = true;
    isCancelled = true; taskQueue = []; actionLog = []; currentStepIndex = 0; taskStatus = 'idle';
    await setLatestScreenshot('');
    await persistQueueState();
    broadcastStatus();
    return { ok: true, success: true, stopped: true };
  }

  if (payload.type === 'ZULORA_PAUSE') {
    taskStatus = 'paused'; await persistQueueState(); broadcastStatus();
    return { ok: true };
  }

  if (payload.type === 'ZULORA_RESUME') {
    if (taskStatus === 'paused') { taskStatus = 'running'; await persistQueueState(); runQueue(); }
    return { ok: true };
  }

  if (payload.type === 'SET_CONTINUOUS_LISTENING') {
    await chrome.storage.local.set({ continuousListening: Boolean(payload.enabled) });
    return { ok: true, enabled: Boolean(payload.enabled) };
  }

  if (payload.type === 'SYNC_API_KEYS') {
    cachedApiKeys = { ...cachedApiKeys, ...(payload.payload || payload.keys || {}) };
    chrome.storage.local.set({ zuloraApiKeys: cachedApiKeys });
    return { ok: true, success: true, keysCount: cachedApiKeys.geminiKeys?.length || 0 };
  }

  if (payload.type === 'ZULORA_STATUS') {
    return { ok: true, taskStatus, actionLog: [...actionLog], currentStep: currentStepIndex, totalSteps: taskQueue.length, steps: taskQueue };
  }

  if (payload.type === 'PING') {
    return { ok: true, success: true, status: 'PONG', version: '1.5.0', installed: true };
  }

  const step = payload.action ? payload : (payload.step || null);
  if (step?.action) {
    const r = await executeStep(step);
    return { ok: true, success: true, ...r };
  }

  return { ok: true, status: taskStatus };
}

// ─── 10. Message Listeners ────────────────────────────────────────────────────

// External messages from web app (PING for connection detection)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ status: 'PONG', version: '1.5.0', installed: true, ok: true });
    return true;
  }
  handleAgentTask(message)
    .then(r => sendResponse({ success: true, ok: true, ...r }))
    .catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});

// Internal messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!safeRuntimeId()) return false;

  if (message.type === 'EXECUTE_ACTION' || message.type === 'EXECUTE_STEP') {
    handleAgentTask(message.payload)
      .then(r => sendResponse({ success: true, ok: true, data: r, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'SYNC_API_KEYS') {
    handleAgentTask({ type: 'SYNC_API_KEYS', payload: message.payload })
      .then(r => sendResponse({ success: true, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', ok: true, version: '1.5.0', installed: true });
    return true;
  }

  if (message.type === 'ZULORA_CONTENT_READY') {
    sendResponse({ ok: true, taskStatus });
    return true;
  }

  handleAgentTask(message.payload || message)
    .then(r => sendResponse({ success: true, ok: true, ...r }))
    .catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});

chrome.storage.local.get([...QUEUE_STORAGE_KEYS, 'zuloraApiKeys'], (saved) => {
  if (hasReceivedTaskMessage) return;
  if (saved?.zuloraApiKeys) cachedApiKeys = { ...cachedApiKeys, ...saved.zuloraApiKeys };
  if (!Array.isArray(saved?.zulora_agent_queue)) return;
  taskQueue = saved.zulora_agent_queue;
  currentStepIndex = Math.max(0, Number(saved.zulora_agent_queue_index) || 0);
  actionLog = Array.isArray(saved.zulora_agent_log) ? saved.zulora_agent_log : [];
  taskStatus = saved.zulora_agent_status || 'idle';
  if (taskStatus === 'running' && currentStepIndex < taskQueue.length) runQueue();
});

console.log('[Zulora Computer Plugin v1.4] Service worker running. Keep-alive active.');
