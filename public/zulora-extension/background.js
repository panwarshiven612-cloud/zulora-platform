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
let agentTabIds = new Set();
let activeStepTabIds = new Set();
let overlayTabIds = new Set();
let activeTimers = new Map();
let taskGeneration = 0;
let cancelRequested = false;
let taskCancelledByUser = false;
let pausedAfterAction = false;
let queueRunnerActive = false;
const HEARTBEAT_ALARM = 'zulora-task-recovery-heartbeat';
const TASK_STATE_KEY = 'zuloraAgentTaskState';

async function persistTaskState() {
  try {
    await chrome.storage.session.set({ [TASK_STATE_KEY]: {
      taskQueue, taskStatus, actionLog, currentStepIndex,
      agentTabIds: [...agentTabIds], pausedAfterAction, savedAt: Date.now()
    } });
  } catch {}
}

async function restoreTaskState() {
  try {
    const stored = (await chrome.storage.session.get(TASK_STATE_KEY))?.[TASK_STATE_KEY];
    if (!stored) return;
    taskQueue = Array.isArray(stored.taskQueue) ? stored.taskQueue : [];
    taskStatus = stored.taskStatus || 'idle';
    actionLog = Array.isArray(stored.actionLog) ? stored.actionLog : [];
    currentStepIndex = Math.max(0, Number(stored.currentStepIndex) || 0);
    agentTabIds = new Set(Array.isArray(stored.agentTabIds) ? stored.agentTabIds : []);
    overlayTabIds = new Set([...agentTabIds]);
    pausedAfterAction = !!stored.pausedAfterAction;
    if (taskStatus === 'running') {
      taskStatus = 'paused';
      actionLog.push({ index: actionLog.length + 1, label: 'Service worker restarted. Review the current step, then resume.', status: 'paused', detail: 'The interrupted step may need review before it is retried.', timestamp: Date.now() });
    }
    await persistTaskState();
  } catch {}
}

const stateReady = restoreTaskState();

async function ensureHeartbeatAlarm() {
  try {
    const alarm = await chrome.alarms.get(HEARTBEAT_ALARM);
    if (!alarm) chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  } catch {}
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void stateReady.then(() => persistTaskState());
});
chrome.runtime.onInstalled.addListener(() => { void ensureHeartbeatAlarm(); });
chrome.runtime.onStartup.addListener(() => { void ensureHeartbeatAlarm(); });
chrome.tabs.onRemoved.addListener((tabId) => { agentTabIds.delete(tabId); void persistTaskState(); });
void ensureHeartbeatAlarm();

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
  void persistTaskState();
  broadcastStatus();
  return entry;
}

function broadcastStatus() {
  const payload = {
    type: 'ZULORA_STATUS_UPDATE',
    taskStatus,
    actionLog: [...actionLog],
    currentStep: currentStepIndex,
    totalSteps: taskQueue.length,
    cancelled: taskCancelledByUser
  };
  const targetIds = new Set([...overlayTabIds, ...activeStepTabIds]);

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && (isZuloraOrigin(tab.url) || targetIds.has(tab.id))) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    });
  });
}

function clearFloatingOverlays() {
  const payload = { type: 'ZULORA_STATUS_UPDATE', taskStatus: 'idle', actionLog: [], currentStep: 0, totalSteps: 0 };
  for (const tabId of overlayTabIds) chrome.tabs.sendMessage(tabId, payload).catch(() => {});
  overlayTabIds.clear();
}

function isZuloraOrigin(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === 'zulora.in' || host.endsWith('.zulora.in') ||
      host === 'zulora.ai' || host.endsWith('.zulora.ai') ||
      ['zulora.vercel.app', 'zulora-ai.web.app', 'zulora-ai.firebaseapp.com'].includes(host);
  } catch { return false; }
}

function taskSleep(ms, generation = taskGeneration) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      resolve(generation !== taskGeneration || cancelRequested);
    }, ms);
    activeTimers.set(timer, resolve);
  });
}

function assertTaskActive(generation = taskGeneration) {
  if (generation !== taskGeneration || cancelRequested) {
    const error = new Error('Task stopped by user.');
    error.cancelled = true;
    throw error;
  }
}

function trackAgentTab(tab) {
  if (!tab?.id) return tab;
  agentTabIds.add(tab.id);
  overlayTabIds.add(tab.id);
  void persistTaskState();
  if (cancelRequested) {
    chrome.tabs.remove(tab.id).catch(() => {});
    const error = new Error('Task stopped by user.');
    error.cancelled = true;
    throw error;
  }
  return tab;
}

async function createAgentTab(options) {
  const tab = await chrome.tabs.create(options);
  trackAgentTab(tab);
  return tab;
}

function markActiveStepTab(tab) {
  if (tab?.id) {
    activeStepTabIds.add(tab.id);
    overlayTabIds.add(tab.id);
  }
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/dom-selectors.js', 'content.js'] });
    broadcastStatus();
  } catch (error) {
    throw new Error(`Could not load browser automation on this page: ${error.message}`);
  }
}

async function executeYoutubeSearch(query, generation = taskGeneration) {
  const tab = await createAgentTab({ url: 'https://www.youtube.com', active: true });
  markActiveStepTab(tab);
  await waitForTabLoad(tab.id);
  assertTaskActive(generation);
  await ensureContentScript(tab.id);
  broadcastStatus();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: searchTerm => window.__ZULORA_CONTENT__?.searchAndOpenTopYoutubeVideo(searchTerm),
    args: [query]
  });
  assertTaskActive(generation);
  const details = result?.result;
  if (!details?.success) throw new Error(details?.error || 'YouTube could not open the first matching video.');
  log(`Opened and played the top YouTube result for: "${query}"`, 'done', details.title || details.url);
  return { tabId: tab.id, result: details };
}

function parseOverlayVoiceTask(transcript, tabId) {
  const text = String(transcript || '').trim();
  if (!text) return [];
  const urlMatch = text.match(/(?:open|go to|navigate to|visit)\s+(https?:\/\/\S+|[\w-]+\.[\w.-]+\S*)/i);
  if (urlMatch) return [{ action: 'open_url', params: { url: /^https?:\/\//i.test(urlMatch[1]) ? urlMatch[1] : `https://${urlMatch[1]}` } }];
  const youtubeMatch = text.match(/(?:youtube|play)\s+(?:search\s+(?:for\s+)?)?(.+)/i);
  if (youtubeMatch) return [{ action: 'youtube_search', params: { query: youtubeMatch[1].trim() } }];
  const googleMatch = text.match(/(?:search|google)\s+(?:google\s+)?(?:for\s+)?(.+)/i);
  if (googleMatch) return [{ action: 'search_google', params: { query: googleMatch[1].trim(), openTopResult: /\b(?:open|click|go to)\b/i.test(text) } }];
  if (/\b(read|summari[sz]e|analy[sz]e)\b.*\b(page|screen|website)\b/i.test(text)) return [{ action: 'read_page_dom', params: { tabId } }];
  if (/\b(scroll)\b/i.test(text)) return [{ action: 'automate_page', params: { operation: 'scroll', direction: /\bup\b/i.test(text) ? 'up' : 'down', tabId } }];
  const clickMatch = text.match(/\bclick\s+(?:on\s+)?(.+)/i);
  if (clickMatch) return [{ action: 'automate_page', params: { operation: 'click', target: clickMatch[1].trim(), tabId } }];
  const fillMatch = text.match(/(?:type|write|enter|fill)\s+(.+)/i);
  if (fillMatch) return [{ action: 'automate_page', params: { operation: 'fill', text: fillMatch[1].trim(), tabId } }];
  return [{ action: 'read_page_dom', params: { tabId } }];
}

async function handleOverlayVoice(transcript, tab) {
  await stateReady;
  const normalized = String(transcript || '').trim().toLowerCase();
  if (/^(pause|pause task|hold on)$/.test(normalized)) return handleAgentTask({ type: 'ZULORA_PAUSE' });
  if (/^(resume|continue|continue task)$/.test(normalized)) return handleAgentTask({ type: 'ZULORA_RESUME' });
  if (/^(stop|stop task|cancel|cancel task|quit)$/.test(normalized)) return handleAgentTask({ type: 'ZULORA_CANCEL' });
  if (taskStatus === 'running' || taskStatus === 'paused') return { ok: false, success: false, error: 'Stop the current task before starting a new voice command.' };
  taskGeneration++;
  cancelRequested = false;
  taskCancelledByUser = false;
  pausedAfterAction = false;
  taskQueue = parseOverlayVoiceTask(transcript, tab?.id);
  actionLog = [];
  currentStepIndex = 0;
  clearFloatingOverlays();
  if (tab?.id) { overlayTabIds.add(tab.id); activeStepTabIds.add(tab.id); }
  taskStatus = 'running';
  void persistTaskState();
  broadcastStatus();
  void runQueue();
  return { ok: true, success: true, queued: taskQueue.length };
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

function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      activeTimers.delete(timer);
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
      try { chrome.tabs.onRemoved.removeListener(onRemoved); } catch {}
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const onRemoved = removedTabId => {
      if (removedTabId === tabId) finish(new Error(`Tab ${tabId} was closed before loading completed.`));
    };
    timer = setTimeout(() => finish(new Error(`Timed out waiting for tab ${tabId} to finish loading.`)), timeout);
    activeTimers.set(timer, () => {
      const error = new Error('Task stopped by user.');
      error.cancelled = true;
      finish(error);
    });
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish();
    }).catch(() => finish(new Error(`Tab ${tabId} was closed before loading completed.`)));
  });
}

// ─── Action Executor ──────────────────────────────────────────────────────────
async function executeStep(step, generation = taskGeneration) {
  const { action, params = {} } = step;
  activeStepTabIds.clear();
  log(`Step ${currentStepIndex + 1}: ${humanLabel(action, params)}`, 'running');

  try {
    assertTaskActive(generation);
    switch (action) {
      // ── Generic Browsing ──
      case 'open_url': {
        let url = params.url || 'https://google.com';
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        const tab = await createAgentTab({ url, active: params.active !== false });
        markActiveStepTab(tab);
        await waitForTabLoad(tab.id);
        assertTaskActive(generation);
        await ensureContentScript(tab.id);
        log(`Opened URL → ${url}`, 'done');
        return { tabId: tab.id };
      }

      case 'search_google': {
        const query = params.query || '';
        if (params.site === 'youtube' || params.platform === 'youtube' || /^\s*(?:youtube|on youtube)\s*:/i.test(query)) {
          const youtubeQuery = query.replace(/^\s*(?:youtube|on youtube)\s*:\s*/i, '').replace(/^search\s+(?:for\s+)?/i, '').trim();
          return executeYoutubeSearch(youtubeQuery || query, generation);
        }
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const tab = await createAgentTab({ url, active: true });
        markActiveStepTab(tab);
        await waitForTabLoad(tab.id);
        assertTaskActive(generation);
        await ensureContentScript(tab.id);
        let opened = null;
        if (params.openTopResult !== false && params.stayOnResultsPage !== true) {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.__ZULORA_CONTENT__?.openTopGoogleResult()
          });
          opened = result?.result;
          if (opened?.success && opened.url) {
            await chrome.tabs.update(tab.id, { url: opened.url, active: true });
            await waitForTabLoad(tab.id, 20000).catch(() => {});
            assertTaskActive(generation);
            await ensureContentScript(tab.id);
          } else {
            opened = null;
          }
        }
        const [page] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ title: document.title, url: location.href, contentSnippet: document.body?.innerText?.slice(0, 3500) || '' })
        });
        const dom = page?.result;
        log(opened ? `Opened top Google result for: "${query}"` : `Searched Google: "${query}"`, 'done', dom?.contentSnippet?.slice(0, 350) || opened?.url || 'Search results are ready.');
        return { tabId: tab.id, dom };
      }

      case 'youtube_search': {
        return executeYoutubeSearch(params.query || params.searchTerm || '', generation);
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

      case 'automate_page': {
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
        if (!tab?.id) throw new Error('No active browser tab found for automate_page');
        await ensureContentScript(tab.id);
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (automationParams) => window.__ZULORA_CONTENT__?.executeAutomation(automationParams),
          args: [params]
        });
        assertTaskActive(generation);
        const payload = result?.result;
        if (!payload?.success && !['read', 'extract', 'analyze'].includes(String(params.operation || params.intent || '').toLowerCase())) {
          throw new Error('The browser action could not be verified on the page.');
        }
        log(`Browser action completed: ${params.operation || params.intent || 'read'}`, 'done', payload?.text?.slice(0, 350) || payload?.target || (payload?.verified ? 'Page change verified.' : 'Page was observed; no visible change was detected.'));
        return { result: payload };
      }

      // ── DOM Automation ──
      case 'type_text': {
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
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
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
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
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
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
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
        if (!tab?.id) throw new Error('No active browser tab to read');

        await ensureContentScript(tab.id);
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
        log(`Read DOM of ${tab.title || tab.url}`, 'done', result?.result?.contentSnippet?.slice(0, 350) || '');
        return { dom: result?.result };
      }

      case 'capture_screen': {
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
        if (!tab?.id) throw new Error('No active browser tab to capture');
        await chrome.tabs.update(tab.id, { active: true });
        const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        log(`Captured visible screen of ${tab.title || tab.url}`, 'done');
        return { screenshot };
      }

      case 'ocr_screen': {
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
        if (!tab?.id) throw new Error('No active browser tab to read');
        await chrome.tabs.update(tab.id, { active: true });
        const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/tesseract/tesseract.min.js'] });
        const workerUrl = chrome.runtime.getURL('lib/tesseract/worker.min.js');
        const langPath = chrome.runtime.getURL('lib/tesseract/lang');
        const corePath = chrome.runtime.getURL('lib/tesseract/core');
        const [recognized] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (image, workerPath, localLangPath, localCorePath) => {
            const worker = await Tesseract.createWorker('eng', 1, { workerPath, langPath: localLangPath, corePath: localCorePath, gzip: true });
            try { return (await worker.recognize(image)).data.text; }
            finally { await worker.terminate(); }
          },
          args: [screenshot, workerUrl, langPath, corePath]
        });
        const text = recognized?.result || '';
        log(`Read visible screen with offline OCR`, 'done', text.slice(0, 350));
        return { text };
      }

      // ── Gmail Automation ──
      case 'gmail_compose': {
        const composeUrl = 'https://mail.google.com/mail/u/0/#inbox?compose=new';
        const tab = await createAgentTab({ url: composeUrl, active: true });
        markActiveStepTab(tab);
        await waitForTabLoad(tab.id);
        await taskSleep(400, generation);
        assertTaskActive(generation);
        await ensureContentScript(tab.id);

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

        assertTaskActive(generation);
        if (!res?.result?.success) throw new Error(res?.result?.error || 'Gmail compose fields were not ready.');
        log(`Gmail Draft Prepared (${params.template || 'Rich HTML'}) → ${params.to || 'recipient'}`, 'done');
        return { tabId: tab.id, details: res?.result };
      }

      case 'gmail_read_inbox': {
        const tabs = await chrome.tabs.query({});
        let gmailTab = tabs.find(t => t.url && t.url.includes('mail.google.com'));
        if (!gmailTab) {
          gmailTab = await createAgentTab({ url: 'https://mail.google.com/mail/u/0/#inbox', active: true });
          await waitForTabLoad(gmailTab.id);
          await taskSleep(400, generation);
          assertTaskActive(generation);
        }
        markActiveStepTab(gmailTab);
        await ensureContentScript(gmailTab.id);
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
        const tab = await createAgentTab({ url: gmailUrl, active: true });
        await waitForTabLoad(tab.id);
        await ensureContentScript(tab.id);
        log(`Opened Gmail compose → ${params.to || 'recipient'}`, 'done');
        return { tabId: tab.id };
      }

      // ── WhatsApp Web Automation ──
      case 'whatsapp_send': {
        const tabs = await chrome.tabs.query({});
        let waTab = tabs.find(t => t.url && t.url.includes('web.whatsapp.com'));
        if (!waTab) {
          waTab = await createAgentTab({ url: 'https://web.whatsapp.com', active: true });
          await waitForTabLoad(waTab.id);
          await taskSleep(400, generation);
          assertTaskActive(generation);
        } else {
          await chrome.tabs.update(waTab.id, { active: true });
          await taskSleep(400, generation);
          assertTaskActive(generation);
        }
        markActiveStepTab(waTab);
        await ensureContentScript(waTab.id);

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

        assertTaskActive(generation);
        if (!res?.result?.success) throw new Error(res?.result?.error || 'WhatsApp could not confirm the message input.');
        log(`WhatsApp: Message sent to "${params.recipient || 'recipient'}"`, 'done');
        return { tabId: waTab.id, result: res?.result };
      }

      // ── ChatGPT & Gemini Automation ──
      case 'chatgpt_prompt': {
        const tab = await createAgentTab({ url: 'https://chatgpt.com', active: true });
        markActiveStepTab(tab);
        await waitForTabLoad(tab.id);
        await taskSleep(400, generation);
        assertTaskActive(generation);
        await ensureContentScript(tab.id);

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

        assertTaskActive(generation);
        log(`ChatGPT: Prompt submitted ("${params.prompt?.slice(0, 30)}…")`, 'done');
        return { tabId: tab.id, result: res?.result };
      }

      case 'gemini_prompt': {
        const tab = await createAgentTab({ url: 'https://gemini.google.com/app', active: true });
        markActiveStepTab(tab);
        await waitForTabLoad(tab.id);
        await taskSleep(400, generation);
        assertTaskActive(generation);
        await ensureContentScript(tab.id);

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

        assertTaskActive(generation);
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
        const tab = markActiveStepTab(await getActiveTab(params.tabId));
        if (tab?.id) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/html2canvas.min.js', 'lib/jspdf.umd.min.js'] });
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (filename) => {
              if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('Offline PDF libraries could not be loaded.');
              const { jsPDF } = window.jspdf;
              const pdf = new jsPDF('p', 'mm', 'a4');
              const canvas = await window.html2canvas(document.body, { scale: 1.5, useCORS: false, backgroundColor: '#ffffff', logging: false });
              const pageWidth = pdf.internal.pageSize.getWidth();
              const pageHeight = pdf.internal.pageSize.getHeight();
              const imageHeight = (canvas.height * pageWidth) / canvas.width;
              const image = canvas.toDataURL('image/jpeg', 0.88);
              let offset = 0;
              while (offset < imageHeight) {
                if (offset > 0) pdf.addPage();
                pdf.addImage(image, 'JPEG', 0, -offset, pageWidth, imageHeight, undefined, 'FAST');
                offset += pageHeight;
              }
              pdf.save(filename);
              return { filename, pages: Math.max(1, Math.ceil(imageHeight / pageHeight)) };
            },
            args: [params.filename || 'zulora_document.pdf']
          });
          log(`Exported page as PDF`, 'done', result?.result?.filename || '');
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
        await taskSleep(ms, generation);
        assertTaskActive(generation);
        log(`Waited ${ms}ms`, 'done');
        return {};
      }

      case 'notify_user': {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Zulora AI Computer Plugin',
          message: params.message || 'Action required.'
        }, () => { try { void chrome.runtime.lastError; } catch {} });
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
    if (!err?.cancelled && generation === taskGeneration && !cancelRequested) {
      log(`Error in ${action}: ${err.message}`, 'error', err.message);
    }
    throw err;
  } finally {
    activeStepTabIds.clear();
  }
}

function humanLabel(action, params) {
  const map = {
    open_url:        `Open URL → ${params.url}`,
    automate_page:   `Page ${params.operation || 'automation'}${params.target ? `: ${params.target}` : ''}`,
    switch_tab:      `Switch Tab (${params.urlContains})`,
    close_tab:       `Close Tab`,
    search_google:   `Google: "${params.query}"`,
    youtube_search:  `YouTube: Search and play "${params.query || params.searchTerm}"`,
    type_text:       `Type into ${params.selector}`,
    click_element:   `Click ${params.selector}`,
    extract_content: `Extract page text`,
    read_page_dom:   `Screen & DOM Reader`,
    capture_screen:  `Capture visible screen`,
    ocr_screen:      `Offline screen OCR`,
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
  if (queueRunnerActive) {
    taskStatus = 'running';
    broadcastStatus();
    return;
  }
  taskStatus = 'running';
  queueRunnerActive = true;
  void persistTaskState();
  broadcastStatus();

  const generation = taskGeneration;
  try {
    while (currentStepIndex < taskQueue.length) {
      if (taskStatus !== 'running') break;
      assertTaskActive(generation);
      const step = taskQueue[currentStepIndex];
      const result = await executeStep(step, generation);
      if (result?.paused) {
        pausedAfterAction = true;
        taskStatus = 'paused';
        break;
      }
      currentStepIndex++;
      void persistTaskState();
      await taskSleep(400, generation);
      assertTaskActive(generation);
    }

    if (taskStatus === 'running' && currentStepIndex >= taskQueue.length) {
      taskStatus = 'done';
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Zulora Task Complete',
        message: `All ${taskQueue.length} steps executed successfully!`
      }, () => { try { void chrome.runtime.lastError; } catch {} });
      broadcastStatus();
    }
  } catch (err) {
    if (!err?.cancelled && generation === taskGeneration) {
      taskStatus = 'error';
      log(`Task stopped: ${err.message}`, 'error', err.message);
    }
  } finally {
    if (generation === taskGeneration) {
      queueRunnerActive = false;
      void persistTaskState();
      broadcastStatus();
    }
  }
}

// ─── Agent Task Handler ───────────────────────────────────────────────────────
async function handleAgentTask(payload) {
  await stateReady;
  if (!payload) return { ok: true, queued: 0 };
  if ((payload.type === 'EXECUTE_ACTION' || payload.type === 'EXECUTE_STEP') && payload.payload) {
    return handleAgentTask(payload.payload);
  }

  // Task queue execution
  if (payload.type === 'ZULORA_RUN_TASK' || payload.steps) {
    if (queueRunnerActive) {
      return { ok: false, success: false, error: 'A browser task is already running. Stop or pause it before starting another.' };
    }
    const steps = payload.steps || (Array.isArray(payload) ? payload : []);
    taskGeneration++;
    cancelRequested = false;
    taskCancelledByUser = false;
    pausedAfterAction = false;
    taskQueue        = Array.isArray(steps) ? steps : [];
    actionLog        = [];
    currentStepIndex = 0;
    clearFloatingOverlays();
    activeStepTabIds.clear();
    agentTabIds.clear();
    taskStatus       = 'running';
    void persistTaskState();
    runQueue();
    return { ok: true, success: true, queued: taskQueue.length };
  }

  // Control commands
  if (payload.type === 'ZULORA_PAUSE') {
    taskStatus = 'paused';
    pausedAfterAction = false;
    void persistTaskState();
    broadcastStatus();
    return { ok: true, success: true, status: 'paused' };
  }

  if (payload.type === 'ZULORA_RESUME') {
    if (taskStatus === 'paused') {
      if (pausedAfterAction) currentStepIndex++;
      pausedAfterAction = false;
      taskStatus = 'running';
      void persistTaskState();
      runQueue();
    }
    return { ok: true, success: true, status: 'running' };
  }

  if (payload.type === 'ZULORA_CANCEL') {
    taskGeneration++;
    cancelRequested = true;
    taskCancelledByUser = true;
    for (const [timer, resolve] of activeTimers) {
      clearTimeout(timer);
      resolve(true);
    }
    activeTimers.clear();
    for (const tabId of activeStepTabIds) chrome.tabs.sendMessage(tabId, { type: 'ZULORA_ABORT_AUTOMATION' }).catch(() => {});
    activeStepTabIds.clear();
    for (const tabId of agentTabIds) chrome.tabs.remove(tabId).catch(() => {});
    agentTabIds.clear();
    taskQueue        = [];
    actionLog        = [];
    currentStepIndex = 0;
    taskStatus       = 'idle';
    pausedAfterAction = false;
    queueRunnerActive = false;
    void persistTaskState();
    broadcastStatus();
    overlayTabIds.clear();
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
    return {
      ok: true, success: true, status: 'PONG', taskStatus,
      actionLog: [...actionLog], currentStep: currentStepIndex, totalSteps: taskQueue.length
    };
  }

  // Single step execution
  const step = payload.step || (payload.action ? payload : null);
  if (step && step.action) {
    cancelRequested = false;
    taskCancelledByUser = false;
    taskGeneration++;
    const result = await executeStep(step, taskGeneration);
    return { ok: true, success: true, ...result };
  }

  const action = payload.action || (payload.type !== 'EXECUTE_ACTION' && payload.type !== 'EXECUTE_STEP' ? payload.type : null);
  if (action && typeof executeStep === 'function') {
    cancelRequested = false;
    taskCancelledByUser = false;
    taskGeneration++;
    const result = await executeStep(payload, taskGeneration);
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
  if (message?.type === 'ZULORA_OVERLAY_VOICE') {
    handleOverlayVoice(message.transcript, sender?.tab)
      .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
      .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'EXECUTE_ACTION' || message.type === 'EXECUTE_STEP') {
    handleAgentTask(message.payload)
      .then((result) => sendResponse({ success: true, ok: true, data: result, ...(result && typeof result === 'object' ? result : {}) }))
      .catch((err) => sendResponse({ success: false, ok: false, error: err.message }));
    return true; // CRITICAL: Explicitly return true for async sendResponse
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', ok: true, success: true, taskStatus, actionLog: [...actionLog], currentStep: currentStepIndex, totalSteps: taskQueue.length });
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
