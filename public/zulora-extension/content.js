/**
 * Zulora AI Computer Plugin — Content Script
 * Runs in every page context. Handles DOM automation and relays status
 * back to the background service worker / Zulora web app.
 */

(function () {
  'use strict';

  // ─── Handshake / Auto-Detection ─────────────────────────────────────────────
  document.documentElement.setAttribute('data-zulora-plugin-active', 'true');
  
  // Dispatch an event on load to tell the web app that extension is connected
  window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED'));

  // ─── Bridge: relay background messages to page via postMessage ──────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'ZULORA_STATUS_UPDATE') {
      window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
      sendResponse({ ok: true, success: true });
    }
    return true;
  });

  // ─── Bridge: receive commands from Zulora web app page ──────────────────────
  window.addEventListener("ZULORA_EXECUTE_AGENT_TASK", async (event) => {
    try {
      chrome.runtime.sendMessage({ type: "EXECUTE_ACTION", payload: event.detail }, (response) => {
        if (chrome.runtime.lastError) {
          window.dispatchEvent(new CustomEvent("ZULORA_AGENT_RESPONSE", {
            detail: { success: false, ok: false, error: chrome.runtime.lastError.message }
          }));
          return;
        }
        window.dispatchEvent(new CustomEvent("ZULORA_AGENT_RESPONSE", {
          detail: response || { success: true, ok: true }
        }));
      });
    } catch (err) {
      window.dispatchEvent(new CustomEvent("ZULORA_AGENT_RESPONSE", {
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

  // Notify background if login wall detected
  const loginDetected = detectLoginRequired();
  if (loginDetected) {
    chrome.runtime.sendMessage({
      type: 'ZULORA_LOGIN_REQUIRED',
      url: window.location.href,
      host: window.location.hostname
    }).catch(() => {});

    // Relay to Zulora web app
    window.postMessage({
      source: 'ZULORA_EXTENSION',
      type: 'ZULORA_LOGIN_REQUIRED',
      host: window.location.hostname,
      message: `Login required on ${window.location.hostname}. Please sign in and click Resume.`
    }, '*');
  }

  // ─── DOM Automation Utilities ───────────────────────────────────────────────

  /**
   * Wait for an element matching `selector` to appear in DOM.
   * Resolves with the element or null after `timeout` ms.
   */
  function waitForElement(selector, timeout = 8000) {
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

  /**
   * Type text into an element character-by-character (simulates real typing).
   */
  async function typeIntoElement(el, text) {
    el.focus();
    el.value = '';
    for (const char of text) {
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30 + Math.random() * 40));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Click an element with a slight human-like delay.
   */
  async function clickElement(selector) {
    const el = await waitForElement(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    el.click();
    return el;
  }

  /**
   * Fill a form field.
   */
  async function fillField(selector, value) {
    const el = await waitForElement(selector);
    if (!el) throw new Error(`Field not found: ${selector}`);
    await typeIntoElement(el, value);
    return el;
  }

  /**
   * Extract visible text from the page or a specific element.
   */
  function extractText(selector) {
    const el = selector ? document.querySelector(selector) : document.body;
    return el ? el.innerText.slice(0, 10000) : '';
  }

  /**
   * Detect download links / buttons on a page.
   */
  function findDownloadLink() {
    const selectors = [
      'a[download]',
      'a[href$=".pdf"]',
      'a[href$=".docx"]',
      'a[href$=".doc"]',
      'a[href$=".zip"]',
      '[aria-label*="download" i]',
      'button:is([aria-label*="download" i], [title*="download" i])'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ─── Expose helpers on window for scripting.executeScript ───────────────────
  window.__ZULORA_CONTENT__ = {
    waitForElement,
    typeIntoElement,
    clickElement,
    fillField,
    extractText,
    findDownloadLink,
    detectLoginRequired
  };

  // Signal ready
  chrome.runtime.sendMessage({ type: 'ZULORA_CONTENT_READY', url: window.location.href }).catch(() => {});

  console.log('[Zulora Content Script] Loaded on', window.location.hostname);
})();
