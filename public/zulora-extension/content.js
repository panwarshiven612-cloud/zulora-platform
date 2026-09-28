/**
 * Zulora AI Computer Plugin — Content Script (v1.1)
 * Multi-app DOM automation engine for Gmail, WhatsApp, ChatGPT, Gemini, and Web Extraction.
 */

(function () {
  'use strict';

  // ─── Handshake / Auto-Detection ─────────────────────────────────────────────
  document.documentElement.setAttribute('data-zulora-plugin-active', 'true');
  window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED'));

  // ─── Bridge: Relay background status updates to the web app ─────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'ZULORA_STATUS_UPDATE') {
      window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
      sendResponse({ ok: true, success: true });
    }
    return true;
  });

  // ─── Bridge: Receive commands from Zulora web app page ──────────────────────
  window.addEventListener('ZULORA_EXECUTE_AGENT_TASK', async (event) => {
    try {
      chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', payload: event.detail }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Zulora Content] chrome.runtime.lastError:', chrome.runtime.lastError.message);
          window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', {
            detail: { success: false, ok: false, error: chrome.runtime.lastError.message }
          }));
          return;
        }
        window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', {
          detail: response || { success: true, ok: true }
        }));
      });
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', {
        detail: { success: false, ok: false, error: err.message }
      }));
    }
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
    chrome.runtime.sendMessage({
      type: 'ZULORA_LOGIN_REQUIRED',
      url: window.location.href,
      host: window.location.hostname
    }).catch(() => {});

    window.postMessage({
      source: 'ZULORA_EXTENSION',
      type: 'ZULORA_LOGIN_REQUIRED',
      host: window.location.hostname,
      message: `Sign-in required on ${window.location.hostname}. Please sign in and resume your task.`
    }, '*');
  }

  // ─── Core DOM Utilities ─────────────────────────────────────────────────────

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function typeIntoElement(el, text) {
    el.focus();
    if ('value' in el) {
      el.value = '';
    } else {
      el.innerText = '';
    }
    for (const char of text) {
      if ('value' in el) {
        el.value += char;
      } else {
        document.execCommand('insertText', false, char);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(25 + Math.random() * 35);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickElement(selector) {
    const el = await waitForElement(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);
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
    const bodyField = await waitForElement('div[aria-label*="Message Body" i], div[role="textbox"][aria-label*="Message" i], .Am.Al.editable', 8000);
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
    // Search contact if recipient specified
    if (recipient) {
      const searchBox = await waitForElement('div[contenteditable="true"][data-tab="3"], div[role="textbox"][title*="Search" i]', 12000);
      if (searchBox) {
        searchBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, recipient);
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1500);

        // Click first contact search result
        const contact = document.querySelector('div[role="listitem"] div[tabindex="-1"], div[data-testid="cell-frame-container"]');
        if (contact) {
          contact.click();
          await sleep(1000);
        }
      }
    }

    // Find main chat message input
    const msgBox = await waitForElement('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]', 8000);
    if (!msgBox) throw new Error('WhatsApp chat message input not found. Ensure WhatsApp is logged in.');

    msgBox.focus();
    document.execCommand('insertText', false, message);
    msgBox.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);

    // Click send button or press enter
    const sendBtn = document.querySelector('span[data-icon="send"], button[aria-label*="Send" i]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      msgBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    return { success: true, recipient };
  }

  // ─── ChatGPT & Gemini Automation Helpers ────────────────────────────────────

  async function injectChatGptPrompt(promptText) {
    const input = await waitForElement('#prompt-textarea, div[contenteditable="true"][data-id="root"], textarea', 10000);
    if (!input) throw new Error('ChatGPT prompt input not found');

    input.focus();
    if ('value' in input) {
      input.value = promptText;
    } else {
      document.execCommand('insertText', false, promptText);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(600);

    const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    return { submitted: true };
  }

  async function injectGeminiPrompt(promptText) {
    const input = await waitForElement('rich-textarea [contenteditable="true"], textarea, div[role="textbox"]', 10000);
    if (!input) throw new Error('Gemini prompt input not found');

    input.focus();
    document.execCommand('insertText', false, promptText);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(600);

    const sendBtn = document.querySelector('button[aria-label*="Send" i], button.send-button');
    if (sendBtn) sendBtn.click();
    return { submitted: true };
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
    detectLoginRequired
  };

  console.log('[Zulora Content Script v1.1] Ready on', window.location.hostname);
})();
