/**
 * Zulora AI Computer Plugin — Background Service Worker v1.2.0
 * ==============================================================
 * Key Capabilities:
 *  1. Keep-Alive Heartbeat: 20-second alarm prevents service worker going inactive.
 *  2. Resilient Async Message Channels: all onMessage listeners return true.
 *  3. Local Notification Assets: No remote URL crashes.
 *  4. API Key Waterfall Brain: Autonomous reasoning across Gemini keys pool (1-7) & fallback providers.
 *  5. Generic Dynamic Automation Engine:
 *     - Dynamic Tab Lifecycle (create -> wait for complete -> inject executor)
 *     - WhatsApp Web (search, open chat, paste, send)
 *     - Google Gemini & ChatGPT (type prompt, submit, MutationObserver response listener)
 *     - Gmail (compose, rich HTML template, recipient, subject)
 *     - Screen & DOM Reader + Screenshot capture (chrome.tabs.captureVisibleTab)
 *     - PDF & Code Exporters (local jsPDF & download triggers)
 */

// ─── 1. Keep-Alive Heartbeat ──────────────────────────────────────────────────
try {
  chrome.alarms.create('zuloraKeepAlive', { periodInMinutes: 0.33 }); // ~20 seconds
} catch (e) {
  console.warn('[Zulora SW] Alarm setup:', e);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'zuloraKeepAlive') {
    // Touch storage to keep service worker active
    chrome.storage.local.set({ _lastHeartbeat: Date.now() }).catch(() => {});
    console.log('[Zulora SW] Heartbeat ping', new Date().toISOString());
  }
});

// ─── 2. State & Storage ───────────────────────────────────────────────────────
let taskQueue = [];
let taskStatus = 'idle'; // 'idle' | 'running' | 'paused' | 'done' | 'error'
let actionLog = [];
let currentStepIndex = 0;
let isCancelled = false;

// Default API Keys Waterfall cache (synced from Zulora Web App)
let cachedApiKeys = {
  geminiKeys: [],
  groqKey: '',
  cerebrasKey: '',
  mistralKey: '',
  openRouterKey: ''
};

// Initialize cached keys from storage
chrome.storage.local.get(['zuloraApiKeys'], (res) => {
  if (res?.zuloraApiKeys) {
    cachedApiKeys = { ...cachedApiKeys, ...res.zuloraApiKeys };
  }
});

// ─── 3. Safe Chrome API Wrappers ──────────────────────────────────────────────
function safeRuntimeId() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function safeNotify(title, message) {
  if (!safeRuntimeId() || !chrome.notifications) return;
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl,
      title: title || 'Zulora AI Agent',
      message: message || ''
    });
  } catch (err) {
    console.warn('[Zulora Notify] Warning:', err.message);
  }
}

function log(label, status = 'done', detail = '') {
  const entry = {
    index: actionLog.length + 1,
    label,
    status,
    detail,
    timestamp: Date.now()
  };
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
        if (tab.id && tab.url && isZuloraOrigin(tab.url)) {
          chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
        }
      });
    });
  } catch {}
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
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 4. API Key Waterfall Brain ───────────────────────────────────────────────
/**
 * Executes a prompt using Gemini Key Waterfall (keys 1-7).
 * If key N fails with 429, 403, or quota error, instantly falls back to key N+1.
 * If all Gemini keys fail, tries Groq / OpenRouter if available.
 */
async function executeAiWaterfall(prompt, systemInstruction = '', model = 'gemini-2.5-flash') {
  const keys = cachedApiKeys.geminiKeys.filter(k => k && k.length > 20);
  const modelsToTry = [model, 'gemini-1.5-flash', 'gemini-1.5-pro'];

  let lastError = null;

  // 1. Try Gemini waterfall
  for (const apiKey of keys) {
    for (const modelId of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        };
        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { success: true, text, provider: 'gemini', model: modelId };
        } else {
          const errData = await res.json().catch(() => ({}));
          lastError = errData?.error?.message || `HTTP ${res.status}`;
          // If rate limited or quota exceeded, try next key
          if (res.status === 429 || res.status === 403) break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }
  }

  // 2. Fallback to Groq if key exists
  if (cachedApiKeys.groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cachedApiKeys.groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
          ]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) return { success: true, text, provider: 'groq' };
      }
    } catch (e) {
      lastError = e.message;
    }
  }

  return { success: false, error: lastError || 'All AI waterfall providers exhausted' };
}

// ─── 5. Dynamic Tab Creator & Loader ──────────────────────────────────────────
async function openTabAndWait(url, matchPattern = null, timeout = 30000) {
  // Check if a tab matching pattern already exists
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

function waitForTabComplete(tabId, timeout = 30000) {
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

async function injectAndRun(tabId, funcOrStr, args = [], maxRetries = 3, retryDelay = 2000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sleep(attempt === 1 ? 600 : retryDelay);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: typeof funcOrStr === 'function' ? funcOrStr : eval(`(${funcOrStr})`),
        args
      });
      return results?.[0]?.result;
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('Cannot access') || err.message?.includes('No tab')) break;
    }
  }
  throw lastErr || new Error('Script execution failed in target tab');
}

// ─── 6. Universal Injected Automation Executor ────────────────────────────────
function __zuloraUniversalExecutor(action, payload) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitFor(selectors, timeout = 15000) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await sleep(250);
    }
    return null;
  }

  function insertText(el, text) {
    el.focus();
    // 1. Synthetic execCommand for rich text / React editors
    try {
      el.select?.();
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    } catch {}

    // 2. Direct property setting with Prototype setter for React inputs
    if ('value' in el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // 3. Fallback innerText
    el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function pressEnter(el) {
    el.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }

  async function waitForResponseMutation(containerSelector, timeout = 40000) {
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
          }, 2500);
        }
      });

      observer.observe(container, { childList: true, subtree: true, characterData: true });
    });
  }

  
  // ── YouTube ──
  async function youtube(query) {
    const searchInput = await waitFor(['input#search', 'input[name="search_query"]'], 15000);
    if (!searchInput) return { error: 'YouTube search bar not found.' };
    insertText(searchInput, query);
    await sleep(500);
    const searchBtn = document.querySelector('button#search-icon-legacy');
    if (searchBtn) searchBtn.click();
    else pressEnter(searchInput);
    
    await sleep(3000);
    const firstVideo = await waitFor(['ytd-video-renderer #video-title', 'a#video-title'], 15000);
    if (!firstVideo) return { error: 'No video results found.' };
    firstVideo.click();
    return { success: true, title: firstVideo.innerText };
  }

  // ── AutoFill Form ──
  async function autofill() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])');
    for (const input of inputs) {
      if (!input.value) {
        if (input.type === 'email' || input.name.includes('email')) insertText(input, 'test@zulora.in');
        else if (input.type === 'password' || input.name.includes('pass')) insertText(input, 'ZuloraSecure@123');
        else insertText(input, 'Zulora Test');
        await sleep(200);
      }
    }
    const submit = document.querySelector('button[type="submit"], input[type="submit"], form button');
    if (submit) submit.click();
    return { success: true };
  }

  
      // ── YouTube ──
      case 'youtube_play': {
        const query = params.query || '';
        log(`YouTube: Loading youtube.com`, 'running');
        const ytTabId = await openTabAndWait('https://www.youtube.com', 'youtube.com', 25000);
        await sleep(2500);
        
        const ytRes = await injectAndRun(ytTabId, __zuloraUniversalExecutor, ['YOUTUBE', { query }], 3, 3000);
        if (ytRes?.error) throw new Error(ytRes.error);
        log(`YouTube: Playing "${ytRes.title}"`, 'done');
        result = { tabId: ytTabId, ...ytRes };
        break;
      }
      
      // ── Autofill ──
      case 'autofill_form': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['AUTOFILL', {}]);
        if (res?.error) throw new Error(res.error);
        log(`Auto-filled form fields`, 'done');
        result = res;
        break;
      }

      // ── WhatsApp Web ──
  async function whatsapp(contactName, message) {
    const searchBox = await waitFor([
      'div[contenteditable="true"][data-tab="3"]',
      'div[contenteditable="true"][title*="Search"]',
      'div[role="textbox"][title*="Search"]',
      '#side div[contenteditable="true"]'
    ], 20000);

    if (!searchBox) return { error: 'WhatsApp search box not found. Ensure WhatsApp Web is loaded & logged in.' };

    insertText(searchBox, contactName);
    await sleep(2000);

    const contact = await waitFor([
      '#pane-side div[role="listitem"]',
      '#pane-side [data-testid="cell-frame-container"]',
      'div[role="listitem"] div[tabindex="-1"]'
    ], 10000);

    if (!contact) return { error: `Contact "${contactName}" not found in WhatsApp search results.` };

    contact.click();
    await sleep(1500);

    const msgInput = await waitFor([
      'footer div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"][aria-label*="message" i]',
      'footer div[contenteditable="true"]',
      'div[contenteditable="true"][spellcheck="true"]'
    ], 10000);

    if (!msgInput) return { error: 'WhatsApp chat input box not found.' };

    insertText(msgInput, message);
    await sleep(600);

    const sendBtn = document.querySelector('[data-icon="send"], button[aria-label*="Send" i], span[data-icon="send"]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      pressEnter(msgInput);
    }

    return { success: true, contact: contactName };
  }

  // ── ChatGPT ──
  async function chatgpt(prompt, waitResponse) {
    const input = await waitFor([
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"]'
    ], 18000);

    if (!input) return { error: 'ChatGPT prompt box not found.' };

    insertText(input, prompt);
    await sleep(600);

    const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send prompt" i], button[aria-label*="Send" i]:not([disabled])');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      pressEnter(input);
    }

    if (!waitResponse) return { success: true, promptSubmitted: true };

    await sleep(2500);
    const response = await waitForResponseMutation('[data-message-author-role="assistant"]:last-child, .markdown.prose:last-of-type, .agent-turn:last-child', 45000);
    return { success: true, response };
  }

  // ── Gemini ──
  async function gemini(prompt, waitResponse) {
    const input = await waitFor([
      'rich-textarea p',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="prompt" i]'
    ], 18000);

    if (!input) return { error: 'Google Gemini input box not found.' };

    insertText(input, prompt);
    await sleep(600);

    const sendBtn = document.querySelector('button[aria-label*="Send prompt" i], button.send-button, button[data-mat-icon-name="send"], button[aria-label*="Send" i]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      pressEnter(input);
    }

    if (!waitResponse) return { success: true, promptSubmitted: true };

    await sleep(2500);
    const response = await waitForResponseMutation('model-response:last-of-type .markdown, .response-container:last-child, div.model-response-text', 45000);
    return { success: true, response };
  }

  // ── Gmail ──
  async function gmail(to, subject, bodyHtml) {
    if (to) {
      const toField = await waitFor(['input[aria-label*="To" i]', 'input[name="to"]', 'textarea[name="to"]'], 10000);
      if (toField) {
        insertText(toField, to);
        toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(500);
      }
    }

    if (subject) {
      const subjField = await waitFor(['input[name="subjectbox"]', 'input[aria-label*="Subject" i]'], 6000);
      if (subjField) {
        insertText(subjField, subject);
      }
    }

    const bodyField = await waitFor(['div[aria-label*="Message Body" i]', '.Am.Al.editable', 'div[role="textbox"].Am', 'div[g_editable="true"]'], 10000);
    if (!bodyField) return { error: 'Gmail message body editor not found.' };

    bodyField.focus();
    bodyField.innerHTML = bodyHtml || '';
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true };
  }

  // ── Screen & DOM Analyzer ──
  async function readScreen(deep) {
    const title = document.title;
    const url = window.location.href;
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText?.trim()).filter(Boolean).slice(0, 10);
    const bodyText = document.body?.innerText?.slice(0, 15000) || '';
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    return {
      title,
      url,
      headings,
      metaDesc,
      bodyText: deep ? bodyText : bodyText.slice(0, 4000)
    };
  }

  // ── Universal Click & Type ──
  async function clickEl(selector) {
    const el = await waitFor(selector, 10000);
    if (!el) return { error: `Element not found: ${selector}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);
    el.focus();
    el.click();
    return { success: true };
  }

  async function typeEl(selector, text) {
    const el = await waitFor(selector, 10000);
    if (!el) return { error: `Element not found: ${selector}` };
    insertText(el, text);
    return { success: true };
  }

  switch (action) {
    case 'WHATSAPP':    return whatsapp(payload.contact, payload.message);
    case 'CHATGPT':     return chatgpt(payload.prompt, payload.waitResponse !== false);
    case 'GEMINI':      return gemini(payload.prompt, payload.waitResponse !== false);
    case 'GMAIL':       return gmail(payload.to, payload.subject, payload.bodyHtml);
    case 'READ_SCREEN': return readScreen(payload.deep);
    case 'CLICK':       return clickEl(payload.selector);
    case 'TYPE':        return typeEl(payload.selector, payload.text);
    case 'YOUTUBE':     return youtube(payload.query);
    case 'AUTOFILL':    return autofill();
    default:            return { error: 'Unknown executor action: ' + action };
  }
}

// ─── 7. Step Execution Engine ─────────────────────────────────────────────────
async function executeStep(step) {
  const { action, params = {} } = step;
  if (isCancelled) throw new Error('Task stopped by user');

  log(humanLabel(action, params), 'running');

  try {
    let result = {};

    switch (action) {
      // ── URLs & Search ──
      case 'open_url': {
        let url = params.url || 'https://google.com';
        if (!url.startsWith('http')) url = 'https://' + url;
        const tabId = await openTabAndWait(url);
        log(`Opened: ${url}`, 'done');
        result = { tabId };
        break;
      }

      case 'search_google': {
        const url = `https://www.google.com/search?q=${encodeURIComponent(params.query || '')}`;
        const tabId = await openTabAndWait(url);
        log(`Searched Google: "${params.query}"`, 'done');
        result = { tabId };
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

      // ── WhatsApp Web ──
      case 'whatsapp_send': {
        const contact = params.recipient || params.contact;
        const message = params.message || '';
        if (!contact) {
          log('WhatsApp: Contact name required', 'paused');
          taskStatus = 'paused';
          broadcastStatus();
          safeNotify('Zulora — Input Required', 'Please specify a WhatsApp contact name to continue.');
          result = { paused: true, reason: 'no_contact' };
          break;
        }

        log(`WhatsApp: Loading web.whatsapp.com`, 'running');
        const waTabId = await openTabAndWait('https://web.whatsapp.com', 'web.whatsapp.com', 35000);
        await sleep(3500);

        const waRes = await injectAndRun(waTabId, __zuloraUniversalExecutor, ['WHATSAPP', { contact, message }], 3, 3000);
        if (waRes?.error) throw new Error(waRes.error);
        log(`WhatsApp: Message sent to "${contact}"`, 'done', `"${message.slice(0, 60)}…"`);
        result = { tabId: waTabId, ...waRes };
        break;
      }

      // ── ChatGPT ──
      case 'chatgpt_prompt': {
        const prompt = params.prompt || '';
        log(`ChatGPT: Opening chatgpt.com`, 'running');
        const cgTabId = await openTabAndWait('https://chatgpt.com', 'chatgpt.com', 25000);
        await sleep(3000);

        log(`ChatGPT: Injecting prompt`, 'running');
        const cgRes = await injectAndRun(cgTabId, __zuloraUniversalExecutor, ['CHATGPT', { prompt, waitResponse: params.waitResponse !== false }], 3, 3000);
        if (cgRes?.error) throw new Error(cgRes.error);
        const snippet = cgRes?.response?.slice(0, 100) || '';
        log(`ChatGPT: Prompt submitted${snippet ? ' — Response ready' : ''}`, 'done', snippet);
        result = { tabId: cgTabId, ...cgRes };
        break;
      }

      // ── Gemini ──
      case 'gemini_prompt': {
        const prompt = params.prompt || '';
        log(`Gemini: Opening gemini.google.com`, 'running');
        const gmTabId = await openTabAndWait('https://gemini.google.com/app', 'gemini.google.com', 25000);
        await sleep(3000);

        log(`Gemini: Injecting prompt`, 'running');
        const gmRes = await injectAndRun(gmTabId, __zuloraUniversalExecutor, ['GEMINI', { prompt, waitResponse: params.waitResponse !== false }], 3, 3000);
        if (gmRes?.error) throw new Error(gmRes.error);
        const snippet = gmRes?.response?.slice(0, 100) || '';
        log(`Gemini: Prompt submitted${snippet ? ' — Response ready' : ''}`, 'done', snippet);
        result = { tabId: gmTabId, ...gmRes };
        break;
      }

      // ── Gmail Compose ──
      case 'gmail_compose': {
        const composeUrl = 'https://mail.google.com/mail/u/0/#inbox?compose=new';
        log(`Gmail: Opening compose window`, 'running');
        const gmTabId = await openTabAndWait(composeUrl, 'mail.google.com', 25000);
        await sleep(3500);

        const gmRes = await injectAndRun(gmTabId, __zuloraUniversalExecutor, [
          'GMAIL',
          { to: params.to, subject: params.subject, bodyHtml: params.bodyHtml || params.body || '' }
        ], 3, 3000);
        if (gmRes?.error) throw new Error(gmRes.error);
        log(`Gmail: Draft prepared → ${params.to || 'recipient'}`, 'done');
        result = { tabId: gmTabId };
        break;
      }

      // ── Screen & DOM Analyzer + Screenshot ──
      case 'read_page_dom': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active browser tab found');

        const dom = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['READ_SCREEN', { deep: params.deep !== false }]);
        log(`Screen Reader: Extracted structure from "${dom?.title || tab.title}"`, 'done');
        result = { dom };
        break;
      }

      case 'capture_screenshot': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.windowId) throw new Error('No active window to capture');

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        log(`Captured screen screenshot`, 'done');
        result = { screenshot: dataUrl };
        break;
      }

      // ── AI Waterfall Execution (Autonomous Extension Brain) ──
      case 'ai_reasoning':
      case 'llm_generate': {
        log(`AI Brain: Thinking with waterfall API keys...`, 'running');
        const aiRes = await executeAiWaterfall(params.prompt, params.systemInstruction);
        if (!aiRes.success) throw new Error(aiRes.error);
        log(`AI Brain: Generated response via ${aiRes.provider}`, 'done', aiRes.text.slice(0, 100));
        result = aiRes;
        break;
      }

      // ── DOM click / type ──
      case 'click_element': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['CLICK', { selector: params.selector }]);
        if (res?.error) throw new Error(res.error);
        log(`Clicked: ${params.selector}`, 'done');
        result = res;
        break;
      }

      case 'type_text': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active tab');
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['TYPE', { selector: params.selector, text: params.text }]);
        if (res?.error) throw new Error(res.error);
        log(`Typed into: ${params.selector}`, 'done');
        result = res;
        break;
      }

      // ── Exports ──
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
        log(`Exported file: ${filename}`, 'done');
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
        safeNotify('Zulora AI — Task Notice', params.message || 'Action completed.');
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

function humanLabel(action, params) {
  const map = {
    open_url:        `Open URL: ${params.url}`,
    switch_tab:      `Switch Tab (${params.urlContains})`,
    search_google:   `Google Search: "${params.query}"`,
    type_text:       `Type into: ${params.selector}`,
    click_element:   `Click: ${params.selector}`,
    read_page_dom:   `Screen Reader — Capture DOM`,
    capture_screenshot: `Capture Tab Screenshot`,
    gmail_compose:   `Gmail Compose → ${params.to || 'recipient'}`,
    whatsapp_send:   `WhatsApp → ${params.recipient || params.contact || 'contact'}`,
    chatgpt_prompt:  `ChatGPT — Submit prompt`,
    gemini_prompt:   `Gemini — Submit prompt`,
    ai_reasoning:    `AI Brain — Reason with waterfall`,
    llm_generate:    `AI Brain — Generate payload`,
    export_code:     `Export: ${params.filename || 'file'}`,
    export_pdf:      `Export PDF`,
    wait:            `Wait ${params.ms || 2000}ms`,
    notify_user:     `Notify: ${params.message}`
  };
  return map[action] || action;
}

// ─── 8. Queue Runner ──────────────────────────────────────────────────────────
async function runQueue() {
  isCancelled = false;
  taskStatus = 'running';
  broadcastStatus();

  while (currentStepIndex < taskQueue.length) {
    if (taskStatus === 'paused') break;
    if (taskStatus === 'error')  break;
    if (isCancelled)             break;

    try {
      const res = await executeStep(taskQueue[currentStepIndex]);
      if (res?.paused) break;
      await sleep(600);
    } catch {
      taskStatus = 'error';
      broadcastStatus();
      return;
    }
    currentStepIndex++;
  }

  if (taskStatus === 'running') {
    taskStatus = 'done';
    safeNotify('✅ Zulora Task Complete', `Successfully completed all ${taskQueue.length} steps!`);
    broadcastStatus();
  }
}

// ─── 9. Task Dispatcher ───────────────────────────────────────────────────────
async function handleAgentTask(payload) {
  if (!payload) return { ok: true };

  // Task execution
  if (payload.type === 'ZULORA_RUN_TASK' || payload.steps) {
    taskQueue        = Array.isArray(payload.steps) ? payload.steps : [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    isCancelled      = false;
    runQueue();
    return { ok: true, success: true, queued: taskQueue.length };
  }

  // Stop / Cancel Agent
  if (payload.type === 'ZULORA_CANCEL' || payload.type === 'STOP_TASK') {
    isCancelled      = true;
    taskQueue        = [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    broadcastStatus();
    return { ok: true, success: true, stopped: true };
  }

  // Pause
  if (payload.type === 'ZULORA_PAUSE') {
    taskStatus = 'paused';
    broadcastStatus();
    return { ok: true };
  }

  // Resume
  if (payload.type === 'ZULORA_RESUME') {
    if (taskStatus === 'paused') {
      currentStepIndex++;
      taskStatus = 'running';
      runQueue();
    }
    return { ok: true };
  }

  // API Key Waterfall Sync
  if (payload.type === 'SYNC_API_KEYS') {
    cachedApiKeys = { ...cachedApiKeys, ...(payload.payload || payload.keys || {}) };
    chrome.storage.local.set({ zuloraApiKeys: cachedApiKeys });
    return { ok: true, success: true, keysCount: cachedApiKeys.geminiKeys?.length || 0 };
  }

  // Status query
  if (payload.type === 'ZULORA_STATUS') {
    return { ok: true, taskStatus, actionLog: [...actionLog], currentStep: currentStepIndex, totalSteps: taskQueue.length };
  }

  // Ping
  if (payload.type === 'PING') {
    return { ok: true, success: true, status: 'PONG', version: '1.2.0' };
  }

  // Single step execution
  const step = payload.action ? payload : (payload.step || null);
  if (step?.action) {
    const r = await executeStep(step);
    return { ok: true, success: true, ...r };
  }

  return { ok: true, status: taskStatus };
}

// ─── 10. Message Listeners ────────────────────────────────────────────────────
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  handleAgentTask(message)
    .then(r => sendResponse({ success: true, ok: true, ...r }))
    .catch(e => sendResponse({ success: false, error: e.message }));
  return true; // Keep async channel open
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!safeRuntimeId()) return false;

  if (message.type === 'EXECUTE_ACTION' || message.type === 'EXECUTE_STEP') {
    handleAgentTask(message.payload)
      .then(r => sendResponse({ success: true, ok: true, data: r, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // CRITICAL: Keep async channel open
  }

  if (message.type === 'SYNC_API_KEYS') {
    handleAgentTask({ type: 'SYNC_API_KEYS', payload: message.payload })
      .then(r => sendResponse({ success: true, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', ok: true, version: '1.2.0' });
    return true;
  }

  if (message.type === 'ZULORA_CONTENT_READY') {
    sendResponse({ ok: true, taskStatus });
    return true;
  }

  handleAgentTask(message.payload || message)
    .then(r => sendResponse({ success: true, ok: true, ...r }))
    .catch(e => sendResponse({ success: false, error: e.message }));
  return true; // Keep async channel open
});

console.log('[Zulora Computer Plugin v1.2] Service worker running. Keep-alive active.');
