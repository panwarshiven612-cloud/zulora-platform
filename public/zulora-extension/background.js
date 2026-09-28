/**
 * Zulora AI Computer Plugin — Background Service Worker (Manifest V3)
 * Full-scale AI Autonomous Web Agent engine for Gmail, WhatsApp, ChatGPT, Gemini, and DOM automation.
 */

// ─── State ────────────────────────────────────────────────────────────────────
let taskQueue = [];
let taskStatus = 'idle';   // 'idle' | 'running' | 'paused' | 'done' | 'error'
let actionLog  = [];
let currentStepIndex = 0;
let zuloraOrigin = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(stepLabel, status = 'done', detail = '') {
  const entry = {
    index: actionLog.length + 1,
    label: stepLabel,
    status,   // 'pending' | 'running' | 'done' | 'error' | 'paused'
    detail,
    timestamp: Date.now()
  };
  actionLog.push(entry);
  broadcastStatus();
  return entry;
}

function broadcastStatus() {
  const payload = {
    type: 'ZULORA_STATUS_UPDATE',
    taskStatus,
    actionLog: [...actionLog],
    currentStep: currentStepIndex,
    totalSteps: taskQueue.length
  };

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && isZuloraOrigin(tab.url)) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    });
  });
}

function isZuloraOrigin(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'localhost' ||
      u.hostname.includes('zulora') ||
      u.hostname.includes('vercel.app')
    );
  } catch { return false; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getActiveTab(preferredTabId = null) {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab) return tab;
    } catch {}
  }
  const [activeInWindow] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeInWindow) return activeInWindow;
  const [anyActive] = await chrome.tabs.query({ active: true });
  if (anyActive) return anyActive;
  const [firstTab] = await chrome.tabs.query({});
  return firstTab || null;
}

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise(async (resolve) => {
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      if (tabInfo && tabInfo.status === 'complete') {
        resolve();
        return;
      }
    } catch {}

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { chrome.webNavigation.onCompleted.removeListener(listener); } catch {}
        resolve();
      }
    }, timeout);

    const listener = (details) => {
      if (details.tabId === tabId && details.frameId === 0) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { chrome.webNavigation.onCompleted.removeListener(listener); } catch {}
          resolve();
        }
      }
    };

    try {
      chrome.webNavigation.onCompleted.addListener(listener);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

// ─── Action Executor ──────────────────────────────────────────────────────────
async function executeStep(step) {
  const { action, params = {} } = step;
  log(`Step ${currentStepIndex + 1}: ${humanLabel(action, params)}`, 'running');

  try {
    switch (action) {
      // ── Generic Browsing ──
      case 'open_url': {
        let url = params.url || 'https://google.com';
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        const tab = await chrome.tabs.create({ url, active: params.active !== false });
        await waitForTabLoad(tab.id);
        log(`Opened URL → ${url}`, 'done');
        return { tabId: tab.id };
      }

      case 'search_google': {
        const query = params.query || '';
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const tab = await chrome.tabs.create({ url, active: true });
        await waitForTabLoad(tab.id);
        log(`Searched Google: "${query}"`, 'done');
        return { tabId: tab.id };
      }

      case 'switch_tab': {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url && t.url.includes(params.urlContains || ''));
        if (target) {
          await chrome.tabs.update(target.id, { active: true });
          log(`Switched to tab: ${target.title || target.url}`, 'done');
          return { tabId: target.id };
        }
        throw new Error(`No tab found matching: ${params.urlContains}`);
      }

      case 'close_tab': {
        const tab = await getActiveTab(params.tabId);
        if (tab?.id) {
          await chrome.tabs.remove(tab.id);
          log(`Closed tab #${tab.id}`, 'done');
        }
        return {};
      }

      // ── DOM Automation ──
      case 'type_text': {
        const tab = await getActiveTab(params.tabId);
        if (!tab?.id) throw new Error('No active browser tab found for type_text');

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, text) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error('Element not found: ' + selector);
            el.focus();
            if ('value' in el) {
              el.value = text;
            } else {
              el.innerText = text;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
          args: [params.selector, params.text || '']
        });
        log(`Typed text into ${params.selector}`, 'done');
        return {};
      }

      case 'click_element': {
        const tab = await getActiveTab(params.tabId);
        if (!tab?.id) throw new Error('No active browser tab found for click_element');

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error('Element not found: ' + selector);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
            el.click();
          },
          args: [params.selector]
        });
        log(`Clicked: ${params.selector}`, 'done');
        return {};
      }

      case 'extract_content': {
        const tab = await getActiveTab(params.tabId);
        if (!tab?.id) throw new Error('No active browser tab found for extract_content');

        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => {
            const el = selector ? document.querySelector(selector) : document.body;
            return el ? el.innerText.slice(0, 10000) : '';
          },
          args: [params.selector || null]
        });
        log(`Extracted page content`, 'done', result?.result?.slice(0, 80) + '…');
        return { content: result?.result };
      }

      // ── DOM & Screen Reader ──
      case 'read_page_dom': {
        const tab = await getActiveTab(params.tabId);
        if (!tab?.id) throw new Error('No active browser tab to read');

        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window.__ZULORA_CONTENT__?.extractDomStructure) {
              return window.__ZULORA_CONTENT__.extractDomStructure();
            }
            return {
              title: document.title,
              url: window.location.href,
              contentSnippet: document.body ? document.body.innerText.slice(0, 8000) : ''
            };
          }
        });
        log(`Read DOM of ${tab.title || tab.url}`, 'done');
        return { dom: result?.result };
      }

      // ── Gmail Automation ──
      case 'gmail_compose': {
        const composeUrl = 'https://mail.google.com/mail/u/0/#inbox?compose=new';
        const tab = await chrome.tabs.create({ url: composeUrl, active: true });
        await waitForTabLoad(tab.id);
        await sleep(3500); // Allow Gmail SPA interface to hydrate

        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (bodyHtml, to, subject) => {
            if (window.__ZULORA_CONTENT__?.injectGmailCompose) {
              return await window.__ZULORA_CONTENT__.injectGmailCompose(bodyHtml, to, subject);
            }
            // Fallback manual injection
            const bodyField = document.querySelector('div[aria-label*="Message Body" i], .Am.Al.editable, div[role="textbox"]');
            if (bodyField) {
              bodyField.focus();
              bodyField.innerHTML = bodyHtml || '';
              bodyField.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true };
            }
            return { success: false, error: 'Gmail editor not found' };
          },
          args: [params.bodyHtml || params.body || '', params.to || '', params.subject || '']
        });

        log(`Gmail Draft Prepared (${params.template || 'Rich HTML'}) → ${params.to || 'recipient'}`, 'done');
        return { tabId: tab.id, details: res?.result };
      }

      case 'gmail_read_inbox': {
        const tabs = await chrome.tabs.query({});
        let gmailTab = tabs.find(t => t.url && t.url.includes('mail.google.com'));
        if (!gmailTab) {
          gmailTab = await chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/#inbox', active: true });
          await waitForTabLoad(gmailTab.id);
          await sleep(3000);
        }
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: gmailTab.id },
          func: () => window.__ZULORA_CONTENT__?.readGmailInbox?.() || []
        });
        log(`Read Gmail Inbox (${res?.result?.length || 0} messages found)`, 'done');
        return { inbox: res?.result };
      }

      case 'send_email': {
        // Direct Gmail Compose URL fallback
        const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(params.to || '')}&su=${encodeURIComponent(params.subject || '')}&body=${encodeURIComponent(params.body || '')}`;
        const tab = await chrome.tabs.create({ url: gmailUrl, active: true });
        await waitForTabLoad(tab.id);
        log(`Opened Gmail compose → ${params.to || 'recipient'}`, 'done');
        return { tabId: tab.id };
      }

      // ── WhatsApp Web Automation ──
      case 'whatsapp_send': {
        const tabs = await chrome.tabs.query({});
        let waTab = tabs.find(t => t.url && t.url.includes('web.whatsapp.com'));
        if (!waTab) {
          waTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
          await waitForTabLoad(waTab.id);
          await sleep(5000); // WhatsApp Web loading time
        } else {
          await chrome.tabs.update(waTab.id, { active: true });
          await sleep(1000);
        }

        const [res] = await chrome.scripting.executeScript({
          target: { tabId: waTab.id },
          func: async (recipient, message) => {
            if (window.__ZULORA_CONTENT__?.injectWhatsAppMessage) {
              return await window.__ZULORA_CONTENT__.injectWhatsAppMessage(recipient, message);
            }
            return { error: 'WhatsApp handler not ready' };
          },
          args: [params.recipient || '', params.message || '']
        });

        log(`WhatsApp: Message sent to "${params.recipient || 'recipient'}"`, 'done');
        return { tabId: waTab.id, result: res?.result };
      }

      // ── ChatGPT & Gemini Automation ──
      case 'chatgpt_prompt': {
        const tab = await chrome.tabs.create({ url: 'https://chatgpt.com', active: true });
        await waitForTabLoad(tab.id);
        await sleep(3500);

        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (prompt) => {
            if (window.__ZULORA_CONTENT__?.injectChatGptPrompt) {
              return await window.__ZULORA_CONTENT__.injectChatGptPrompt(prompt);
            }
            return { error: 'ChatGPT automation script not loaded' };
          },
          args: [params.prompt || '']
        });

        log(`ChatGPT: Prompt submitted ("${params.prompt?.slice(0, 30)}…")`, 'done');
        return { tabId: tab.id, result: res?.result };
      }

      case 'gemini_prompt': {
        const tab = await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
        await waitForTabLoad(tab.id);
        await sleep(3500);

        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (prompt) => {
            if (window.__ZULORA_CONTENT__?.injectGeminiPrompt) {
              return await window.__ZULORA_CONTENT__.injectGeminiPrompt(prompt);
            }
            return { error: 'Gemini automation script not loaded' };
          },
          args: [params.prompt || '']
        });

        log(`Gemini: Prompt submitted ("${params.prompt?.slice(0, 30)}…")`, 'done');
        return { tabId: tab.id, result: res?.result };
      }

      // ── File & PDF Exporters ──
      case 'export_code': {
        const filename = params.filename || 'zulora_code.js';
        const code = params.code || params.content || '';
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(code)}`;
        await chrome.downloads.download({ url: dataUrl, filename });
        log(`Downloaded code file: ${filename}`, 'done');
        return { filename };
      }

      case 'export_pdf': {
        const tab = await getActiveTab(params.tabId);
        if (tab?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (filename) => {
              window.print();
            },
            args: [params.filename || 'zulora_document.pdf']
          });
          log(`Triggered PDF export dialog`, 'done');
        }
        return {};
      }

      case 'download_file': {
        await chrome.downloads.download({ url: params.url, filename: params.filename });
        log(`Downloaded: ${params.filename || params.url}`, 'done');
        return {};
      }

      case 'wait': {
        const ms = params.ms || 2000;
        await sleep(ms);
        log(`Waited ${ms}ms`, 'done');
        return {};
      }

      case 'notify_user': {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Zulora AI Computer Plugin',
          message: params.message || 'Action required.'
        });
        log(`Notification: ${params.message}`, 'paused');
        taskStatus = 'paused';
        broadcastStatus();
        return { paused: true };
      }

      default:
        log(`Unknown action: ${action}`, 'error');
        return {};
    }
  } catch (err) {
    log(`Error in ${action}: ${err.message}`, 'error', err.message);
    throw err;
  }
}

function humanLabel(action, params) {
  const map = {
    open_url:        `Open URL → ${params.url}`,
    switch_tab:      `Switch Tab (${params.urlContains})`,
    close_tab:       `Close Tab`,
    search_google:   `Google: "${params.query}"`,
    type_text:       `Type into ${params.selector}`,
    click_element:   `Click ${params.selector}`,
    extract_content: `Extract page text`,
    read_page_dom:   `Screen & DOM Reader`,
    gmail_compose:   `Gmail: Compose with ${params.template ? `Zulora ${params.template}` : 'Rich HTML'} → ${params.to || 'recipient'}`,
    gmail_read_inbox:`Gmail: Read Inbox`,
    send_email:      `Email to ${params.to}`,
    whatsapp_send:   `WhatsApp: Send message to "${params.recipient || 'recipient'}"`,
    chatgpt_prompt:  `ChatGPT: Submit prompt`,
    gemini_prompt:   `Gemini: Submit prompt`,
    export_code:     `Export code file (${params.filename || 'file'})`,
    export_pdf:      `Export as PDF document`,
    download_file:   `Download ${params.filename || params.url}`,
    wait:            `Wait ${params.ms || 2000}ms`,
    notify_user:     `Notify: ${params.message}`
  };
  return map[action] || action;
}

// ─── Queue Runner ─────────────────────────────────────────────────────────────
async function runQueue() {
  taskStatus = 'running';
  broadcastStatus();

  while (currentStepIndex < taskQueue.length) {
    if (taskStatus === 'paused') break;
    if (taskStatus === 'error')  break;
    if (taskStatus === 'idle')   break;

    const step = taskQueue[currentStepIndex];
    try {
      const result = await executeStep(step);
      if (result?.paused) break;
      await sleep(750);
    } catch (err) {
      taskStatus = 'error';
      broadcastStatus();
      return;
    }
    currentStepIndex++;
  }

  if (taskStatus === 'running') {
    taskStatus = 'done';
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '✅ Zulora Task Complete',
      message: `All ${taskQueue.length} steps executed successfully!`
    });
    broadcastStatus();
  }
}

// ─── Agent Task Handler ───────────────────────────────────────────────────────
async function handleAgentTask(payload) {
  if (!payload) return { ok: true, queued: 0 };

  // Task queue execution
  if (payload.type === 'ZULORA_RUN_TASK' || payload.steps) {
    const steps = payload.steps || (Array.isArray(payload) ? payload : []);
    taskQueue        = Array.isArray(steps) ? steps : [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    runQueue();
    return { ok: true, success: true, queued: taskQueue.length };
  }

  // Control commands
  if (payload.type === 'ZULORA_PAUSE') {
    taskStatus = 'paused';
    broadcastStatus();
    return { ok: true, success: true, status: 'paused' };
  }

  if (payload.type === 'ZULORA_RESUME') {
    if (taskStatus === 'paused') {
      currentStepIndex++;
      taskStatus = 'running';
      runQueue();
    }
    return { ok: true, success: true, status: 'running' };
  }

  if (payload.type === 'ZULORA_CANCEL') {
    taskQueue        = [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    broadcastStatus();
    return { ok: true, success: true, status: 'idle' };
  }

  if (payload.type === 'ZULORA_STATUS') {
    return {
      ok: true,
      success: true,
      taskStatus,
      actionLog: [...actionLog],
      currentStep: currentStepIndex,
      totalSteps: taskQueue.length
    };
  }

  if (payload.type === 'PING') {
    return { ok: true, success: true, status: 'PONG' };
  }

  // Single step execution
  const step = payload.step || (payload.action ? payload : null);
  if (step && step.action) {
    const result = await executeStep(step);
    return { ok: true, success: true, ...result };
  }

  const action = payload.action || (payload.type !== 'EXECUTE_ACTION' && payload.type !== 'EXECUTE_STEP' ? payload.type : null);
  if (action && typeof executeStep === 'function') {
    const result = await executeStep(payload);
    return { ok: true, success: true, ...result };
  }

  return { ok: true, success: true, status: taskStatus };
}

// ─── External Message Handler (from Zulora web app) ───────────────────────────
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleAgentTask(message)
    .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
    .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
  return true; // Keep channel open for async response
});

// ─── Internal Message Handler (from content scripts & bridge) ─────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTION' || message.type === 'EXECUTE_STEP') {
    handleAgentTask(message.payload)
      .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
      .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
    return true; // CRITICAL: Explicitly return true for async sendResponse
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', ok: true, success: true });
    return true;
  }

  if (message.type === 'ZULORA_CONTENT_READY') {
    sendResponse({ ok: true, success: true, taskStatus });
    return true;
  }

  if (message.type === 'ZULORA_RUN_TASK' || message.steps) {
    handleAgentTask(message)
      .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
      .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
    return true;
  }

  // Fallback for any other message
  handleAgentTask(message.payload || message)
    .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
    .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
  return true; // CRITICAL: Explicitly return true for async sendResponse
});

console.log('[Zulora Computer Plugin v1.1] Service worker initialized.');
