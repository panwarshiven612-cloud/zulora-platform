/**
 * Zulora AI Computer Plugin — Background Service Worker (Manifest V3)
 * Bridges the Zulora web app with DOM automation running in content scripts.
 */

// ─── State ────────────────────────────────────────────────────────────────────
let taskQueue = [];
let taskStatus = 'idle';   // 'idle' | 'running' | 'paused' | 'done' | 'error'
let actionLog  = [];
let currentStepIndex = 0;
let zuloraOrigin = null;   // origin of the connected Zulora web app tab

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

  // Notify all Zulora web-app tabs via postMessage bridge
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

// ─── Action Executor ──────────────────────────────────────────────────────────
async function executeStep(step) {
  const { action, params = {} } = step;
  log(`Step ${currentStepIndex + 1}: ${humanLabel(action, params)}`, 'running');

  try {
    switch (action) {
      case 'open_url': {
        const tab = await chrome.tabs.create({ url: params.url, active: params.active !== false });
        await waitForTabLoad(tab.id);
        log(`Opened → ${params.url}`, 'done');
        return { tabId: tab.id };
      }

      case 'switch_tab': {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url && t.url.includes(params.urlContains || ''));
        if (target) {
          await chrome.tabs.update(target.id, { active: true });
          log(`Switched to tab: ${target.title}`, 'done');
          return { tabId: target.id };
        }
        throw new Error(`No tab found matching: ${params.urlContains}`);
      }

      case 'close_tab': {
        if (params.tabId) {
          await chrome.tabs.remove(params.tabId);
          log(`Closed tab #${params.tabId}`, 'done');
        }
        return {};
      }

      case 'search_google': {
        const url = `https://www.google.com/search?q=${encodeURIComponent(params.query)}`;
        const tab = await chrome.tabs.create({ url, active: true });
        await waitForTabLoad(tab.id);
        log(`Searched Google: "${params.query}"`, 'done');
        return { tabId: tab.id };
      }

      case 'type_text': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, text) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error('Element not found: ' + selector);
            el.focus();
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
          args: [params.selector, params.text]
        });
        log(`Typed text into ${params.selector}`, 'done');
        return {};
      }

      case 'click_element': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error('Element not found: ' + selector);
            el.click();
          },
          args: [params.selector]
        });
        log(`Clicked: ${params.selector}`, 'done');
        return {};
      }

      case 'extract_content': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => {
            const el = selector ? document.querySelector(selector) : document.body;
            return el ? el.innerText.slice(0, 5000) : '';
          },
          args: [params.selector || null]
        });
        log(`Extracted content from page`, 'done', result?.result?.slice(0, 80) + '…');
        return { content: result?.result };
      }

      case 'send_email': {
        // Open Gmail compose window via URL scheme
        const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(params.to || '')}&su=${encodeURIComponent(params.subject || '')}&body=${encodeURIComponent(params.body || '')}`;
        const tab = await chrome.tabs.create({ url: gmailUrl, active: true });
        await waitForTabLoad(tab.id);
        log(`Opened Gmail compose → ${params.to}`, 'done');
        return { tabId: tab.id };
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
    open_url:       `Open URL → ${params.url}`,
    switch_tab:     `Switch Tab (${params.urlContains})`,
    close_tab:      `Close Tab #${params.tabId}`,
    search_google:  `Google: "${params.query}"`,
    type_text:      `Type into ${params.selector}`,
    click_element:  `Click ${params.selector}`,
    extract_content:`Extract page content`,
    send_email:     `Email to ${params.to}`,
    download_file:  `Download ${params.filename || params.url}`,
    wait:           `Wait ${params.ms || 2000}ms`,
    notify_user:    `Notify: ${params.message}`
  };
  return map[action] || action;
}

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.webNavigation.onCompleted.removeListener(listener);
      resolve(); // resolve anyway after timeout
    }, timeout);

    const listener = (details) => {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timer);
        chrome.webNavigation.onCompleted.removeListener(listener);
        resolve();
      }
    };
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}

// ─── Queue Runner ─────────────────────────────────────────────────────────────
async function runQueue() {
  taskStatus = 'running';
  broadcastStatus();

  while (currentStepIndex < taskQueue.length) {
    if (taskStatus === 'paused') break;
    if (taskStatus === 'error')  break;

    const step = taskQueue[currentStepIndex];
    try {
      const result = await executeStep(step);
      if (result?.paused) break;
      await sleep(800); // brief delay between steps
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
      message: `All ${taskQueue.length} steps finished successfully!`
    });
    broadcastStatus();
  }
}

// ─── External Message Handler (from Zulora web app) ───────────────────────────
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const { type, steps, stepIndex } = message;

  switch (type) {
    case 'ZULORA_PING':
      sendResponse({ ok: true, version: '1.0.0', status: taskStatus });
      break;

    case 'ZULORA_RUN_TASK':
      taskQueue        = Array.isArray(steps) ? steps : [];
      actionLog        = [];
      currentStepIndex = 0;
      taskStatus       = 'idle';
      zuloraOrigin     = sender.origin;
      runQueue();
      sendResponse({ ok: true, queued: taskQueue.length });
      break;

    case 'ZULORA_RESUME':
      if (taskStatus === 'paused') {
        currentStepIndex++;
        taskStatus = 'running';
        runQueue();
      }
      sendResponse({ ok: true });
      break;

    case 'ZULORA_PAUSE':
      taskStatus = 'paused';
      broadcastStatus();
      sendResponse({ ok: true });
      break;

    case 'ZULORA_CANCEL':
      taskQueue        = [];
      actionLog        = [];
      currentStepIndex = 0;
      taskStatus       = 'idle';
      broadcastStatus();
      sendResponse({ ok: true });
      break;

    case 'ZULORA_STATUS':
      sendResponse({ taskStatus, actionLog, currentStep: currentStepIndex, totalSteps: taskQueue.length });
      break;

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }

  return true; // keep channel open for async sendResponse
});

// ─── Internal message from content scripts ────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ZULORA_CONTENT_READY') {
    sendResponse({ ok: true, taskStatus });
  }
  return true;
});

console.log('[Zulora Computer Plugin] Background service worker started.');
