/**
 * Zulora AI Computer Plugin — Content Script (v1.1)
 * Multi-app DOM automation engine for Gmail, WhatsApp, ChatGPT, Gemini, and Web Extraction.
 */

(function () {
  'use strict';

  if (window.__ZULORA_CONTENT_SCRIPT_ACTIVE__) return;
  window.__ZULORA_CONTENT_SCRIPT_ACTIVE__ = true;
  let automationCancelled = false;
  let automationRunId = 0;

  function isZuloraPage() {
    const host = location.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === 'zulora.in' || host.endsWith('.zulora.in') ||
      host === 'zulora.ai' || host.endsWith('.zulora.ai') ||
      ['zulora.vercel.app', 'zulora-ai.web.app', 'zulora-ai.firebaseapp.com'].includes(host);
  }

  function extensionContextAvailable() {
    try { return !!(globalThis.chrome?.runtime?.id && chrome.runtime.sendMessage); }
    catch { return false; }
  }

  function dispatchBridgeResponse(detail) {
    try {
      window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', { detail }));
      window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_AGENT_RESPONSE', ...detail }, '*');
    } catch {}
  }

  function cancelAutomation() {
    automationCancelled = true;
    automationRunId++;
    window.dispatchEvent(new Event('ZULORA_ABORT_AUTOMATION'));
  }

  function startAutomation() {
    window.dispatchEvent(new Event('ZULORA_ABORT_AUTOMATION'));
    automationCancelled = false;
    return ++automationRunId;
  }

  function assertAutomationActive(runId = automationRunId) {
    if (automationCancelled || runId !== automationRunId) throw new Error('Browser action cancelled.');
  }

  function sendRuntimeMessage(message, callback = () => {}) {
    if (!extensionContextAvailable()) {
      dispatchBridgeResponse({ ok: false, success: false, error: 'Extension context was refreshed. Reload this page to reconnect.' });
      callback({ ok: false, success: false, error: 'Extension context was refreshed. Reload this page to reconnect.' });
      return false;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError?.message || null; } catch {}
        if (runtimeError) {
          const result = { ok: false, success: false, error: /context invalidated/i.test(runtimeError) ? 'Extension context was refreshed. Reload this page to reconnect.' : runtimeError };
          callback(result);
          return;
        }
        callback(response || { ok: true, success: true });
      });
      return true;
    } catch (error) {
      const messageText = /context invalidated|extension context/i.test(error?.message || '')
        ? 'Extension context was refreshed. Reload this page to reconnect.'
        : (error?.message || 'Extension connection unavailable.');
      callback({ ok: false, success: false, error: messageText });
      return false;
    }
  }

  let lastAnnouncedStatus = null;
  function playStatusPrompt(status) {
    const audioByStatus = { running: 'agent-start.wav', done: 'agent-complete.wav', paused: 'agent-paused.wav', error: 'agent-error.wav' };
    const file = audioByStatus[status];
    if (!file || !extensionContextAvailable()) return;
    try {
      const audio = new Audio(chrome.runtime.getURL(`audio/${file}`));
      audio.volume = 0.45;
      void audio.play().catch(() => {});
    } catch {}
  }

  // ─── Handshake / Auto-Detection ─────────────────────────────────────────────
  if (extensionContextAvailable() && isZuloraPage()) {
    document.documentElement.setAttribute('data-zulora-plugin-active', 'true');
    window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED'));
  }

  window.addEventListener('ZULORA_PING_EXTENSION', (event) => {
    if (!isZuloraPage()) return;
    const nonce = event.detail?.nonce;
    sendRuntimeMessage({ type: 'PING' }, (response) => {
      window.postMessage({
        source: 'ZULORA_EXTENSION', type: 'ZULORA_PING_RESPONSE', nonce,
        ok: !!response?.ok, taskStatus: response?.taskStatus,
        actionLog: response?.actionLog, currentStep: response?.currentStep, totalSteps: response?.totalSteps
      }, '*');
      if (response?.taskStatus) {
        window.postMessage({
          source: 'ZULORA_EXTENSION', type: 'ZULORA_STATUS_UPDATE',
          taskStatus: response.taskStatus, actionLog: response.actionLog || [],
          currentStep: response.currentStep || 0, totalSteps: response.totalSteps || 0
        }, '*');
      }
    });
  });

  // ─── Bridge: Relay background status updates to the web app ─────────────────
  try {
    if (extensionContextAvailable()) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'ZULORA_ABORT_AUTOMATION') {
          cancelAutomation();
          sendResponse({ ok: true, success: true });
          return true;
        }
        if (message?.type === 'ZULORA_STATUS_UPDATE') {
          if (message.taskStatus !== lastAnnouncedStatus) {
            lastAnnouncedStatus = message.taskStatus;
            playStatusPrompt(message.taskStatus);
          }
          window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
          sendResponse({ ok: true, success: true });
        }
        return true;
      });
    }
  } catch {
    document.documentElement.removeAttribute('data-zulora-plugin-active');
  }

  // ─── Bridge: Receive commands from Zulora web app page ──────────────────────
  window.addEventListener('ZULORA_EXECUTE_AGENT_TASK', async (event) => {
    if (!isZuloraPage()) return;
    sendRuntimeMessage({ type: 'EXECUTE_ACTION', payload: event.detail }, dispatchBridgeResponse);
  });

  // ─── Auth / Login Detection ─────────────────────────────────────────────────
  function detectLoginRequired() {
    const signals = [
      () => document.querySelector('input[type="password"]'),
      () => document.querySelector('[aria-label*="sign in" i]'),
      () => document.querySelector('[aria-label*="log in" i]'),
      () => document.querySelector('button[data-action="sign in"]'),
      () => /sign.?in|log.?in|login|authenticate/i.test(document.title)
    ];
    return signals.some(fn => { try { return !!fn(); } catch { return false; } });
  }

  const loginDetected = detectLoginRequired();
  if (loginDetected) {
    sendRuntimeMessage({
      type: 'ZULORA_LOGIN_REQUIRED',
      url: window.location.href,
      host: window.location.hostname
    });

    window.postMessage({
      source: 'ZULORA_EXTENSION',
      type: 'ZULORA_LOGIN_REQUIRED',
      host: window.location.hostname,
      message: `Sign-in required on ${window.location.hostname}. Please sign in and resume your task.`
    }, '*');
  }

  // ─── Core DOM Utilities ─────────────────────────────────────────────────────

  function waitForElement(selector, timeout = 10000, runId = automationRunId) {
    return new Promise((resolve) => {
      if (automationCancelled || runId !== automationRunId) { resolve(null); return; }
      let existing = null;
      try { existing = document.querySelector(selector); } catch { resolve(null); return; }
      if (existing) { resolve(existing); return; }
      let timer;
      const finish = (element) => {
        observer.disconnect();
        clearTimeout(timer);
        window.removeEventListener('ZULORA_ABORT_AUTOMATION', onCancel);
        resolve(element);
      };
      const onCancel = () => finish(null);
      const observer = new MutationObserver(() => {
        if (automationCancelled || runId !== automationRunId) { finish(null); return; }
        let el = null;
        try { el = document.querySelector(selector); } catch { finish(null); return; }
        if (el) finish(el);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('ZULORA_ABORT_AUTOMATION', onCancel, { once: true });
      timer = setTimeout(() => finish(null), timeout);
    });
  }

  function sleep(ms, runId = automationRunId) {
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        window.removeEventListener('ZULORA_ABORT_AUTOMATION', finish);
        resolve();
      };
      if (automationCancelled || runId !== automationRunId) { resolve(); return; }
      window.addEventListener('ZULORA_ABORT_AUTOMATION', finish, { once: true });
      timer = setTimeout(finish, ms);
    });
  }

  async function typeIntoElement(el, text, runId = automationRunId) {
    assertAutomationActive(runId);
    el.focus();
    const value = String(text ?? '');
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } else if ('value' in el) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  }

  const DOM_SELECTOR_DICTIONARIES = globalThis.ZULORA_DOM_SELECTORS || {
    search: ['input[type="search"]', 'input[placeholder*="search" i]', 'input[aria-label*="search" i]', '[role="searchbox"]'],
    prompt: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
    message: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
    email: ['input[type="email"]', 'input[name*="to" i]', 'input[placeholder*="recipient" i]'],
    submit: ['button[type="submit"]', '[role="button"][aria-label*="send" i]', 'button[aria-label*="send" i]']
  };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  function findTextTarget(text) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return null;
    return Array.from(document.querySelectorAll('button, [role="button"], a, [role="menuitem"]'))
      .find(el => isVisible(el) && [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
        .some(value => value?.trim().toLowerCase().includes(needle))) || null;
  }

  async function executeAutomation(params = {}) {
    const runId = startAutomation();
    const operation = String(params.operation || params.intent || 'read').toLowerCase();
    const selector = params.selector ? String(params.selector) : '';
    const text = String(params.text ?? params.value ?? '');

    if (operation === 'read' || operation === 'extract' || operation === 'analyze') {
      return { title: document.title, url: location.href, text: extractText(selector || null), dom: extractDomStructure() };
    }
    if (operation === 'click' || operation === 'submit') {
      let target = null;
      try { target = selector ? document.querySelector(selector) : findTextTarget(params.target || text); } catch {}
      if (!target && operation === 'submit') target = document.querySelector(DOM_SELECTOR_DICTIONARIES.submit.join(','));
      if (!target || !isVisible(target)) throw new Error(`Could not find a visible ${operation} target.`);
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.click();
      return { success: true, target: target.innerText?.trim().slice(0, 120) || target.getAttribute('aria-label') || target.tagName };
    }
    if (operation === 'fill' || operation === 'type' || operation === 'search') {
      let target = null;
      try { target = selector ? document.querySelector(selector) : null; } catch {}
      if (!target) {
        const kinds = operation === 'search' ? DOM_SELECTOR_DICTIONARIES.search : DOM_SELECTOR_DICTIONARIES.prompt;
        const hint = String(params.target || params.label || '').toLowerCase();
        const candidates = Array.from(document.querySelectorAll(kinds.join(','))).filter(isVisible);
        target = candidates.find(el => [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('name')]
          .some(label => label?.toLowerCase().includes(hint))) || candidates.at(-1);
      }
      if (!target || !isVisible(target)) throw new Error('Could not find a visible text input.');
      await typeIntoElement(target, text, runId);
      assertAutomationActive(runId);
      if (operation === 'search' && params.submit !== false) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      return { success: true, selector: selector || target.tagName.toLowerCase() };
    }
    if (operation === 'wait_for') {
      const target = await waitForElement(selector, Math.min(60000, Number(params.timeoutMs) || 15000), runId);
      assertAutomationActive(runId);
      if (!target) throw new Error(`Timed out waiting for ${selector || 'an element'}.`);
      return { success: true };
    }
    throw new Error(`Unsupported browser automation operation: ${operation}`);
  }

  function waitForResponseComplete({ timeout = 90000, quietPeriod = 1200, runId = automationRunId } = {}) {
    return new Promise((resolve) => {
      const stopSelectors = ['button[aria-label*="Stop generating" i]', 'button[aria-label*="Stop response" i]', 'button[data-testid*="stop" i]'];
      const replySelectors = DOM_SELECTOR_DICTIONARIES.assistantReply || ['[data-message-author-role="assistant"]', 'message-content', 'model-response', '.markdown'];
      let started = false;
      let quietTimer = null;
      const initialReplyCount = document.querySelectorAll(replySelectors.join(',')).length;
      const initialReplyText = extractText(replySelectors.join(','));
      const finish = (timedOut = false, cancelled = false) => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(quietTimer);
        window.removeEventListener('ZULORA_ABORT_AUTOMATION', onCancel);
        resolve({ completed: started && !timedOut && !cancelled && runId === automationRunId, timedOut, cancelled: cancelled || runId !== automationRunId, text: extractText(replySelectors.join(',')) });
      };
      const onCancel = () => finish(false, true);
      const inspect = () => {
        const stopVisible = Array.from(document.querySelectorAll(stopSelectors.join(','))).some(isVisible);
        const replyCount = document.querySelectorAll(replySelectors.join(',')).length;
        const replyText = extractText(replySelectors.join(','));
        if (stopVisible || replyCount > initialReplyCount || replyText.length > initialReplyText.length) started = true;
        if (started && !stopVisible) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => finish(false), quietPeriod);
        }
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
      window.addEventListener('ZULORA_ABORT_AUTOMATION', onCancel, { once: true });
      const timer = setTimeout(() => finish(true), timeout);
      inspect();
    });
  }

  async function clickElement(selector) {
    const runId = automationRunId;
    const el = await waitForElement(selector, 10000, runId);
    assertAutomationActive(runId);
    if (!el) throw new Error(`Element not found: ${selector}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250, runId);
    assertAutomationActive(runId);
    el.focus();
    el.click();
    return el;
  }

  function extractText(selector) {
    const el = selector ? document.querySelector(selector) : document.body;
    return el ? el.innerText.slice(0, 15000) : '';
  }

  function extractDomStructure() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.innerText.trim())
      .filter(Boolean)
      .slice(0, 10);
    const mainText = document.body ? document.body.innerText.slice(0, 12000) : '';
    return {
      title: document.title,
      url: window.location.href,
      headings,
      contentSnippet: mainText
    };
  }

  // ─── Gmail Automation Helpers ───────────────────────────────────────────────

  async function injectGmailCompose(bodyHtml, to = '', subject = '') {
    const runId = startAutomation();
    // 1. Recipient
    if (to) {
      const toField = document.querySelector('input[aria-label*="To" i], input[name="to"], textarea[name="to"], div[aria-label*="Search people" i]');
      if (toField) {
        toField.focus();
        if ('value' in toField) {
          toField.value = to;
        } else {
          document.execCommand('insertText', false, to);
        }
        toField.dispatchEvent(new Event('input', { bubbles: true }));
        toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    }

    // 2. Subject
    if (subject) {
      const subjField = document.querySelector('input[name="subjectbox"], input[aria-label*="Subject" i]');
      if (subjField) {
        subjField.focus();
        subjField.value = subject;
        subjField.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 3. Body injection (Rich HTML or Pearl/Azure styled email)
    const bodyField = await waitForElement((DOM_SELECTOR_DICTIONARIES.gmailBody || ['div[aria-label*="Message Body" i]']).join(','), 8000, runId);
    assertAutomationActive(runId);
    if (!bodyField) throw new Error('Could not find Gmail compose message body');

    bodyField.focus();
    if (bodyHtml) {
      // Direct rich HTML injection
      bodyField.innerHTML = bodyHtml;
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { success: true };
  }

  function readGmailInbox() {
    const rows = Array.from(document.querySelectorAll('tr.zA, div[role="main"] tr[tabindex="-1"]')).slice(0, 10);
    return rows.map((row, idx) => {
      const sender = row.querySelector('.yX .yW span, .zF')?.innerText?.trim() || 'Unknown';
      const subject = row.querySelector('.y6, .bog')?.innerText?.trim() || 'No Subject';
      const snippet = row.querySelector('.y2')?.innerText?.trim() || '';
      return { index: idx + 1, sender, subject, snippet };
    });
  }

  // ─── WhatsApp Web Automation Helpers ────────────────────────────────────────

  async function injectWhatsAppMessage(recipient, message) {
    const runId = startAutomation();
    // Search contact if recipient specified
    if (recipient) {
      const searchBox = await waitForElement((DOM_SELECTOR_DICTIONARIES.whatsappSearch || ['div[contenteditable="true"][data-tab="3"]']).join(','), 12000, runId);
      if (!searchBox) throw new Error('WhatsApp contact search is unavailable. Sign in and open the chats panel first.');
      searchBox.focus();
      await typeIntoElement(searchBox, recipient, runId);
      await sleep(1500, runId);
      assertAutomationActive(runId);

      const contactSelector = 'div[role="listitem"] div[tabindex="-1"], div[data-testid="cell-frame-container"]';
      const contact = await waitForElement(contactSelector, 8000, runId);
      if (!contact) throw new Error(`No WhatsApp chat matched "${recipient}". Message was not sent.`);
      contact.click();
      await sleep(900, runId);
      assertAutomationActive(runId);
    }

    if (!recipient) throw new Error('Choose a WhatsApp contact before sending.');

    // Find main chat message input
    const msgBox = await waitForElement((DOM_SELECTOR_DICTIONARIES.message || ['footer div[contenteditable="true"]']).join(','), 8000, runId);
    if (!msgBox) throw new Error('WhatsApp chat message input not found. Ensure WhatsApp is logged in.');

    msgBox.focus();
    await typeIntoElement(msgBox, message, runId);
    await sleep(500, runId);
    assertAutomationActive(runId);

    // Click send button or press enter
    const sendBtn = document.querySelector('button[aria-label*="Send" i], [data-icon="send"]')?.closest('button') || document.querySelector('button[aria-label*="Send" i]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      msgBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    return { success: true, recipient };
  }

  // ─── ChatGPT & Gemini Automation Helpers ────────────────────────────────────

  async function injectChatGptPrompt(promptText) {
    const runId = startAutomation();
    const input = await waitForElement('#prompt-textarea, div[contenteditable="true"][data-id="root"], textarea', 10000, runId);
    if (!input) throw new Error('ChatGPT prompt input not found');

    input.focus();
    if ('value' in input) {
      await typeIntoElement(input, promptText, runId);
    } else {
      await typeIntoElement(input, promptText, runId);
    }
    await sleep(600, runId);
    assertAutomationActive(runId);

    const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    return { submitted: true, ...(await waitForResponseComplete({ runId })) };
  }

  async function injectGeminiPrompt(promptText) {
    const runId = startAutomation();
    const input = await waitForElement('rich-textarea [contenteditable="true"], textarea, div[role="textbox"]', 10000, runId);
    if (!input) throw new Error('Gemini prompt input not found');

    input.focus();
    await typeIntoElement(input, promptText, runId);
    await sleep(600, runId);
    assertAutomationActive(runId);

    const sendBtn = document.querySelector('button[aria-label*="Send" i], button.send-button');
    if (sendBtn) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { submitted: true, ...(await waitForResponseComplete({ runId })) };
  }

  // ─── File Download / Blob Exporter ──────────────────────────────────────────

  function downloadContentAsFile(content, filename = 'export.txt', mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return { downloaded: filename };
  }

  // Expose on window for chrome.scripting.executeScript
  window.__ZULORA_CONTENT__ = {
    waitForElement,
    typeIntoElement,
    clickElement,
    extractText,
    extractDomStructure,
    injectGmailCompose,
    readGmailInbox,
    injectWhatsAppMessage,
    injectChatGptPrompt,
    injectGeminiPrompt,
    downloadContentAsFile,
    detectLoginRequired,
    executeAutomation,
    waitForResponseComplete,
    DOM_SELECTOR_DICTIONARIES
  };

  if (extensionContextAvailable() && isZuloraPage()) window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED'));
})();
