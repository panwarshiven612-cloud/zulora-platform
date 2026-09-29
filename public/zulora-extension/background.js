/**
 * Zulora AI Computer Plugin — Background Service Worker v1.3.0
 * ==============================================================
 * Fixed: Structural syntax error from orphaned case blocks.
 * Added: onMessageExternal PING-PONG for web app detection.
 * Improved: Response speed via reduced sleep() delays.
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
  } catch { return false; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 4. API Key Waterfall Brain ───────────────────────────────────────────────
async function executeAiWaterfall(prompt, systemInstruction = '', model = 'gemini-2.5-flash') {
  const keys = cachedApiKeys.geminiKeys.filter(k => k && k.length > 20);
  const modelsToTry = [model, 'gemini-1.5-flash'];
  let lastError = null;

  for (const apiKey of keys) {
    for (const modelId of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

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
          if (res.status === 429 || res.status === 403) break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }
  }

  // Fallback to Groq
  if (cachedApiKeys.groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cachedApiKeys.groqKey}` },
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
    } catch (e) { lastError = e.message; }
  }

  return { success: false, error: lastError || 'All AI waterfall providers exhausted' };
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
      el.innerText = safeText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      el.value = safeText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
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
    const searchBox = await waitFor([
      'div[contenteditable="true"][data-tab="3"]',
      'div[contenteditable="true"][title*="Search"]',
      '#side div[contenteditable="true"]'
    ], 18000);
    if (!searchBox) return { error: 'WhatsApp search box not found. Ensure WhatsApp Web is loaded & logged in.' };

    insertText(searchBox, contactName);
    await sleep(1500);

    const contact = await waitFor([
      '#pane-side div[role="listitem"]',
      '#pane-side [data-testid="cell-frame-container"]',
      'div[role="listitem"] div[tabindex="-1"]'
    ], 8000);
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
    if (sendBtn) sendBtn.click(); else pressEnter(msgInput);
    return { success: true, contact: contactName };
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
    const bodyField = await waitFor(['div[aria-label*="Message Body" i]', '.Am.Al.editable', 'div[g_editable="true"]'], 8000);
    if (!bodyField) return { error: 'Gmail message body not found.' };
    bodyField.focus();
    bodyField.innerHTML = bodyHtml || '';
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true };
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

  async function autofill() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])');
    for (const input of inputs) {
      if (!input.value) {
        const idName = (input.name || input.id || '').toLowerCase();
        if (input.type === 'email' || idName.includes('email')) insertText(input, 'test@zulora.in');
        else if (input.type === 'password' || idName.includes('pass')) insertText(input, 'ZuloraSecure@123');
        else if (input.type === 'tel' || idName.includes('phone') || idName.includes('mobile')) insertText(input, '9876543210');
        else insertText(input, 'Zulora AI');
        await sleep(150);
      }
    }
    const submit = document.querySelector('button[type="submit"], input[type="submit"], form button');
    if (submit) submit.click();
    return { success: true };
  }

  async function evaluateTopResult() {
    const links = Array.from(document.querySelectorAll('a'))
      .filter(a => a.href && a.href.startsWith('http') && !a.href.includes('google.com/search'))
      .slice(0, 10);
    if (!links.length) return { error: 'No search results found.' };
    const best = links.find(a => a.querySelector('h3')) || links[0];
    return { success: true, url: best.href, title: best.innerText };
  }

  async function clickEl(selector) {
    const el = await waitFor(selector, 8000);
    if (!el) return { error: `Element not found: ${selector}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.focus();
    el.click();
    return { success: true };
  }

  async function typeEl(selector, text) {
    const el = await waitFor(selector, 8000);
    if (!el) return { error: `Element not found: ${selector}` };
    insertText(el, text);
    return { success: true };
  }

  // ── Dispatcher ──
  switch (action) {
    case 'WHATSAPP':        return whatsapp(payload.contact, payload.message);
    case 'CHATGPT':         return chatgpt(payload.prompt, payload.waitResponse !== false);
    case 'GEMINI':          return gemini(payload.prompt, payload.waitResponse !== false);
    case 'GMAIL':           return gmail(payload.to, payload.subject, payload.bodyHtml);
    case 'READ_SCREEN':     return readScreen(payload.deep);
    case 'CLICK':           return clickEl(payload.selector);
    case 'TYPE':            return typeEl(payload.selector, payload.text);
    case 'YOUTUBE':         return youtube(payload.query);
    case 'AUTOFILL':        return autofill();
    case 'EVAL_TOP_RESULT': return evaluateTopResult();
    default:                return { error: 'Unknown action: ' + action };
  }
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

    switch (action) {

      case 'open_url': {
        let url = params.url || 'https://google.com';
        if (!url.startsWith('http')) url = 'https://' + url;
        const tabId = await openTabAndWait(url);
        log(`Opened: ${url}`, 'done');
        result = { tabId };
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
        const res = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['AUTOFILL', {}]);
        if (res?.error) throw new Error(res.error);
        log(`Auto-filled form`, 'done');
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
        const waTabId = await openTabAndWait('https://web.whatsapp.com', 'web.whatsapp.com', 30000);
        await sleep(2500);
        const waRes = await injectAndRun(waTabId, __zuloraUniversalExecutor, ['WHATSAPP', { contact, message }], 3, 2000);
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
        log(`Gemini: Opening...`, 'running');
        const gmTabId = await openTabAndWait('https://gemini.google.com/app', 'gemini.google.com', 20000);
        await sleep(2000);
        const gmRes = await injectAndRun(gmTabId, __zuloraUniversalExecutor, ['GEMINI', { prompt, waitResponse: params.waitResponse !== false }], 3, 2000);
        if (gmRes?.error) throw new Error(gmRes.error);
        log(`Gemini: Prompt submitted`, 'done', gmRes?.response?.slice(0, 100) || '');
        result = { tabId: gmTabId, ...gmRes };
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

      case 'read_page_dom': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('No active browser tab');
        const dom = await injectAndRun(tab.id, __zuloraUniversalExecutor, ['READ_SCREEN', { deep: params.deep !== false }]);
        log(`Screen Reader: Captured "${dom?.title || tab.title}"`, 'done');
        result = { dom };
        break;
      }

      case 'capture_screenshot': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.windowId) throw new Error('No active window');
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        log(`Screenshot captured`, 'done');
        result = { screenshot: dataUrl };
        break;
      }

      case 'ai_reasoning':
      case 'llm_generate': {
        log(`AI Brain: Reasoning...`, 'running');
        const aiRes = await executeAiWaterfall(params.prompt, params.systemInstruction);
        if (!aiRes.success) throw new Error(aiRes.error);
        log(`AI Brain: Done via ${aiRes.provider}`, 'done', aiRes.text.slice(0, 100));
        result = aiRes;
        break;
      }

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
  isCancelled = false;
  taskStatus = 'running';
  broadcastStatus();

  while (currentStepIndex < taskQueue.length) {
    if (taskStatus === 'paused' || taskStatus === 'error' || isCancelled) break;
    try {
      const res = await executeStep(taskQueue[currentStepIndex]);
      if (res?.paused) break;
      await sleep(300);
    } catch {
      taskStatus = 'error';
      broadcastStatus();
      return;
    }
    currentStepIndex++;
  }

  if (taskStatus === 'running') {
    taskStatus = 'done';
    safeNotify('✅ Zulora Task Complete', `Completed all ${taskQueue.length} step(s)!`);
    broadcastStatus();
  }
}

// ─── 9. Task Dispatcher ───────────────────────────────────────────────────────
async function handleAgentTask(payload) {
  if (!payload) return { ok: true };

  if (payload.type === 'ZULORA_RUN_TASK' || payload.steps) {
    taskQueue        = Array.isArray(payload.steps) ? payload.steps : [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    isCancelled      = false;
    runQueue();
    return { ok: true, success: true, queued: taskQueue.length };
  }

  if (payload.type === 'ZULORA_CANCEL' || payload.type === 'STOP_TASK') {
    isCancelled = true; taskQueue = []; actionLog = []; currentStepIndex = 0; taskStatus = 'idle';
    broadcastStatus();
    return { ok: true, success: true, stopped: true };
  }

  if (payload.type === 'ZULORA_PAUSE') {
    taskStatus = 'paused'; broadcastStatus();
    return { ok: true };
  }

  if (payload.type === 'ZULORA_RESUME') {
    if (taskStatus === 'paused') { currentStepIndex++; taskStatus = 'running'; runQueue(); }
    return { ok: true };
  }

  if (payload.type === 'SYNC_API_KEYS') {
    cachedApiKeys = { ...cachedApiKeys, ...(payload.payload || payload.keys || {}) };
    chrome.storage.local.set({ zuloraApiKeys: cachedApiKeys });
    return { ok: true, success: true, keysCount: cachedApiKeys.geminiKeys?.length || 0 };
  }

  if (payload.type === 'ZULORA_STATUS') {
    return { ok: true, taskStatus, actionLog: [...actionLog], currentStep: currentStepIndex, totalSteps: taskQueue.length };
  }

  if (payload.type === 'PING') {
    return { ok: true, success: true, status: 'PONG', version: '1.3.0', installed: true };
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
    sendResponse({ status: 'PONG', version: '1.3.0', installed: true, ok: true });
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
    sendResponse({ status: 'PONG', ok: true, version: '1.3.0', installed: true });
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

console.log('[Zulora Computer Plugin v1.3] Service worker running. Keep-alive active.');
