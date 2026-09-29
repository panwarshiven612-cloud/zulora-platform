/**
 * Zulora AI Computer Plugin — Content Script v1.3
 * ================================================
 * Features:
 *  - Bulletproof context-invalidation guard
 *  - Graceful window.postMessage fallback
 *  - Draggable, persistent floating mic widget
 *  - Universal Form Auto-Fill via voice
 *  - Native input event dispatch (works with React/Vue/Angular)
 */

(function () {
  'use strict';

  // ─── Context Guard ───────────────────────────────────────────────────────────
  function isExtensionValid() {
    try { return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
    catch { return false; }
  }

  // ─── Handshake ───────────────────────────────────────────────────────────────
  try {
    document.documentElement.setAttribute('data-zulora-plugin-active', 'true');
    window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED', {
      detail: { version: '1.3.0', status: 'connected' }
    }));
  } catch {}

  // ─── Safe Runtime Message Sender ─────────────────────────────────────────────
  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) {
      window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_CONTEXT_INVALIDATED' }, '*');
      if (typeof callback === 'function') callback({ success: false, error: 'Extension context invalidated' });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          console.warn('[Zulora Bridge]', lastErr.message);
          if (typeof callback === 'function') callback({ success: false, error: lastErr.message });
          return;
        }
        if (typeof callback === 'function') callback(response || { success: true, ok: true });
      });
    } catch (err) {
      console.warn('[Zulora Bridge] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  }

  // ─── Listen for Status Updates from Background ──────────────────────────────
  if (isExtensionValid()) {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.type === 'ZULORA_STATUS_UPDATE') {
          window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
          if (sendResponse) sendResponse({ ok: true });
        }
        return true;
      });
    } catch {}
  }

  // ─── Web App Event Listeners ────────────────────────────────────────────────
  window.addEventListener('ZULORA_EXECUTE_AGENT_TASK', (event) => {
    const detail = event.detail || {};
    safeSendMessage({ type: 'EXECUTE_ACTION', payload: detail }, (response) => {
      window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', {
        detail: response || { success: true, ok: true }
      }));
    });
  });

  window.addEventListener('ZULORA_SYNC_API_KEYS', (event) => {
    const keys = event.detail || {};
    safeSendMessage({ type: 'SYNC_API_KEYS', payload: keys });
  });

  window.addEventListener('ZULORA_PING', () => {
    if (isExtensionValid()) {
      safeSendMessage({ type: 'PING' }, (res) => {
        window.dispatchEvent(new CustomEvent('ZULORA_PONG', { detail: res }));
      });
    }
  });

  // ─── Fast DOM Minifier (never sends raw innerHTML to LLM) ────────────────────
  // Extracts ONLY interactive elements into a lightweight JSON tree (<2KB).
  // Used by the background agent for deterministic, zero-token action matching.
  function getMinifiedDOM() {
    const MAX_ELEMENTS = 40;
    const MAX_TEXT = 60;
    const elements = Array.from(
      document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"]')
    ).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    }).slice(0, MAX_ELEMENTS);

    return {
      url: window.location.href,
      title: document.title,
      elements: elements.map(el => {
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.textContent || '').trim().slice(0, MAX_TEXT);
        const placeholder = el.placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const name = el.name || el.id || '';
        const type = el.type || '';
        const href = el.href || '';
        return { tag, type, name, placeholder, ariaLabel, text, href };
      }),
      bodyPreview: (document.body?.innerText || '').slice(0, 1500)
    };
  }

  // ─── Direct JS Executor (0 tokens, instant — for standard inputs) ─────────────
  // Attempts to fill/click standard elements WITHOUT calling any LLM.
  function tryDirectExecution(action, params) {
    try {
      if (action === 'TYPE' && params.selector && params.text) {
        const el = document.querySelector(params.selector);
        if (el) {
          el.focus();
          if (el.isContentEditable) { el.innerText = params.text; }
          else { el.value = params.text; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'direct-js' };
        }
        // Heuristic: find by placeholder or type
        const byPlaceholder = Array.from(document.querySelectorAll('input, textarea'))
          .find(i => (i.placeholder || '').toLowerCase().includes((params.selector || '').toLowerCase())
                  || (i.type || '') === (params.selector || '').toLowerCase());
        if (byPlaceholder) {
          byPlaceholder.focus();
          byPlaceholder.value = params.text;
          byPlaceholder.dispatchEvent(new Event('input', { bubbles: true }));
          byPlaceholder.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'direct-js-heuristic' };
        }
      }
      if (action === 'CLICK' && params.selector) {
        const el = document.querySelector(params.selector);
        if (el) { el.click(); return { success: true, method: 'direct-js' }; }
      }
    } catch (e) { /* fall through */ }
    return null; // Null = needs full LLM execution
  }

  // Expose DOM snapshot to background via message
  window.addEventListener('ZULORA_GET_DOM_SNAPSHOT', () => {
    const snap = getMinifiedDOM();
    window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_DOM_SNAPSHOT', snapshot: snap }, '*');
  });

  // ─── Login Detection ─────────────────────────────────────────────────────────
  try {
    const hasLogin = [
      () => document.querySelector('input[type="password"]'),
      () => document.querySelector('[aria-label*="sign in" i]'),
      () => /sign.?in|log.?in|login/i.test(document.title)
    ].some(fn => { try { return Boolean(fn()); } catch { return false; } });

    if (hasLogin) {
      window.postMessage({
        source: 'ZULORA_EXTENSION', type: 'ZULORA_LOGIN_REQUIRED',
        host: window.location.hostname,
        message: `Sign-in required on ${window.location.hostname}.`
      }, '*');
    }
  } catch {}

  // ─── Universal Form Auto-Fill via Voice ──────────────────────────────────────
  function dispatchNativeEvents(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function autoFillFromVoice(transcript) {
    const text = transcript.toLowerCase();
    const name    = text.match(/(?:my name is|i am) ([a-z ]+?)(?:\s+my|$)/i)?.[1];
    const email   = text.match(/(?:email is|my email) ([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
    const phone   = text.match(/(?:number is|mobile is|phone is) (\d{10})/i)?.[1];
    const address = text.match(/(?:address is|i live at) (.+?)(?:\s+my|$)/i)?.[1];

    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea').forEach(input => {
      const idName = (input.name || input.id || '').toLowerCase();
      if ((input.type === 'email' || idName.includes('email')) && email) dispatchNativeEvents(input, email);
      else if ((input.type === 'tel' || idName.includes('phone') || idName.includes('mobile')) && phone) dispatchNativeEvents(input, phone);
      else if ((idName.includes('name') || idName.includes('first')) && name) dispatchNativeEvents(input, name);
      else if ((idName.includes('address') || idName.includes('street')) && address) dispatchNativeEvents(input, address);
    });
  }

  // ─── Draggable Floating Mic Widget ──────────────────────────────────────────
  function injectVoiceWidget() {
    if (document.getElementById('zulora-floating-mic')) return;

    // Check if disabled in storage
    if (isExtensionValid()) {
      try {
        chrome.storage.local.get(['floatingMicEnabled'], (res) => {
          if (res.floatingMicEnabled === false) return;
          buildWidget();
        });
      } catch { buildWidget(); }
    } else {
      buildWidget();
    }
  }

  function buildWidget() {
    if (document.getElementById('zulora-floating-mic')) return;

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = `
      #zulora-floating-mic {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 2147483647;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
        box-shadow: 0 4px 16px rgba(2, 132, 199, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        touch-action: none;
        transition: box-shadow 0.2s;
      }
      #zulora-floating-mic:hover { box-shadow: 0 6px 20px rgba(2,132,199,0.65); }
      #zulora-floating-mic.listening {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        box-shadow: 0 0 0 0 rgba(239,68,68,0.7);
        animation: zuloraPulse 1.4s infinite;
      }
      #zulora-floating-mic svg { pointer-events: none; }
      #zulora-voice-toast {
        position: fixed;
        bottom: 94px;
        right: 28px;
        z-index: 2147483646;
        background: rgba(15,23,42,0.92);
        color: #f8fafc;
        font-family: -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 500;
        padding: 8px 14px;
        border-radius: 10px;
        max-width: 260px;
        backdrop-filter: blur(6px);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.25s, transform 0.25s;
        pointer-events: none;
      }
      #zulora-voice-toast.visible { opacity: 1; transform: translateY(0); }
      @keyframes zuloraPulse {
        0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
        70%  { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
        100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
      }
    `;
    document.head.appendChild(style);

    // Create toast
    const toast = document.createElement('div');
    toast.id = 'zulora-voice-toast';
    toast.textContent = '🎙 Listening…';
    document.body.appendChild(toast);

    function showToast(msg, durationMs = 2500) {
      toast.textContent = msg;
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), durationMs);
    }

    // Create widget button
    const mic = document.createElement('div');
    mic.id = 'zulora-floating-mic';
    mic.setAttribute('title', 'Zulora Voice Agent');
    mic.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    document.body.appendChild(mic);

    // ── Restore saved position ──
    if (isExtensionValid()) {
      try {
        chrome.storage.local.get(['zuloraWidgetPos'], (res) => {
          if (res.zuloraWidgetPos) {
            mic.style.right = 'auto';
            mic.style.bottom = 'auto';
            mic.style.left = res.zuloraWidgetPos.x + 'px';
            mic.style.top  = res.zuloraWidgetPos.y + 'px';
          }
        });
      } catch {}
    }

    // ── Drag logic ──
    let dragging = false, dragOffsetX = 0, dragOffsetY = 0, hasDragged = false;

    mic.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      hasDragged = false;
      mic.style.cursor = 'grabbing';
      const rect = mic.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      hasDragged = true;
      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;
      mic.style.right = 'auto';
      mic.style.bottom = 'auto';
      mic.style.left = Math.max(0, Math.min(window.innerWidth - 54, x)) + 'px';
      mic.style.top  = Math.max(0, Math.min(window.innerHeight - 54, y)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      mic.style.cursor = 'grab';
      // Persist position
      if (hasDragged && isExtensionValid()) {
        try {
          chrome.storage.local.set({ zuloraWidgetPos: { x: parseInt(mic.style.left), y: parseInt(mic.style.top) } });
        } catch {}
      }
    });

    // ── Voice Recognition ──
    let isListening = false;
    let recognition = null;

    mic.addEventListener('click', () => {
      if (hasDragged) { hasDragged = false; return; } // Don't trigger on drag-end

      if (isListening) {
        if (recognition) recognition.stop();
        return;
      }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { showToast('⚠ Voice not supported in this browser.'); return; }

      recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isListening = true;
        mic.classList.add('listening');
        showToast('🎙 Listening… speak your command', 60000);
      };

      recognition.onend = () => {
        isListening = false;
        mic.classList.remove('listening');
        toast.classList.remove('visible');
      };

      recognition.onerror = (e) => {
        isListening = false;
        mic.classList.remove('listening');
        showToast('⚠ Voice error: ' + e.error);
      };

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(r => r[0].transcript).join(' ').trim();
        const lower = transcript.toLowerCase();

        recognition.stop();
        showToast(`✅ Task received: "${transcript}"`, 3000);

        if (lower.includes('stop task') || lower.includes('stop agent') || lower.includes('cancel')) {
          safeSendMessage({ type: 'EXECUTE_ACTION', payload: { type: 'ZULORA_CANCEL' } });
          return;
        }

        // Form fill via voice
        if (lower.includes('fill') || lower.includes('my name is') || lower.includes('email is')) {
          autoFillFromVoice(transcript);
        }

        // Send command to web app and to background
        window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_VOICE_COMMAND', command: transcript }, '*');
        safeSendMessage({ type: 'EXECUTE_ACTION', payload: { type: 'ZULORA_RUN_TASK', voiceCommand: transcript } });
      };

      try { recognition.start(); }
      catch (e) { showToast('⚠ Could not start mic: ' + e.message); }
    });
  }

  // ─── Inject Widget ───────────────────────────────────────────────────────────
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectVoiceWidget();
  } else {
    document.addEventListener('DOMContentLoaded', injectVoiceWidget);
  }

  // Ready signal
  safeSendMessage({ type: 'ZULORA_CONTENT_READY', url: window.location.href });
  console.log('[Zulora Content v1.3] Active on', window.location.hostname);

})();
