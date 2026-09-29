/**
 * Zulora AI Computer Plugin — Content Script v1.4.0
 * ===================================================
 * Features:
 *  - Triple-Agent Execution Support (Direct JS actions in <300ms)
 *  - Ultra-Fast DOM Minifier (<3KB Payload, interactive elements only)
 *  - Continuous Voice Recognition with 4.0s Silence Auto-Stop & Manual Stop
 *  - Draggable Pearl & Azure Floating Mic with Position Persistence
 *  - Real-time Screen Readout via Web Speech Synthesis TTS
 *  - Bulletproof Context-Invalidation Guard & Native Event Dispatch
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
      detail: { version: '1.4.0', status: 'connected' }
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
        if (message && (message.type === 'ZULORA_STATUS_UPDATE' || message.type === 'ZULORA_AGENT_STEP_UPDATE')) {
          window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
          if (sendResponse) sendResponse({ ok: true });
        }
        if (message && message.type === 'ZULORA_READ_SCREEN_TTS') {
          speakScreenText(message.text || document.body?.innerText?.slice(0, 1500) || 'No text found on screen.');
          if (sendResponse) sendResponse({ ok: true });
        }
        return true;
      });
    } catch {}
  }

  // ─── Web App Event Listeners ────────────────────────────────────────────────
  window.addEventListener('ZULORA_EXECUTE_AGENT_TASK', (event) => {
    const detail = event.detail || {};
    if (detail.type === 'SET_FLOATING_MIC') {
      const mic = document.getElementById('zulora-floating-mic');
      if (mic) mic.style.display = detail.enabled ? 'flex' : 'none';
      return;
    }
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
        window.dispatchEvent(new CustomEvent('ZULORA_PONG', { detail: res || { status: 'PONG', installed: true } }));
      });
    } else {
      window.dispatchEvent(new CustomEvent('ZULORA_PONG', { detail: { status: 'PONG', installed: true } }));
    }
  });

  // ─── Ultra-Fast DOM Minifier (<3KB Payload) ─────────────────────────────────
  /**
   * Extracts ONLY clickable / interactive elements:
   *  a, button, input, textarea, select, [role="button"], [onclick]
   * Strips all inline styles, SVG paths, and hidden elements to keep payload <3KB.
   */
  function getMinifiedDOM() {
    const MAX_ELEMENTS = 35;
    const MAX_TEXT = 50;

    const interactiveSelectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [onclick]';
    const all = Array.from(document.querySelectorAll(interactiveSelectors));

    const elements = all.filter(el => {
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      } catch {
        return false;
      }
    }).slice(0, MAX_ELEMENTS);

    const minifiedList = elements.map((el, idx) => {
      const tag = el.tagName.toLowerCase();
      let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
      const placeholder = (el.placeholder || '').slice(0, 30);
      const ariaLabel = (el.getAttribute('aria-label') || '').slice(0, 30);
      const name = el.name || el.id || '';
      const type = el.type || '';
      const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 80) : '';

      // Generate a fast selector
      let selector = tag;
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.name) {
        selector = `${tag}[name="${el.name}"]`;
      } else if (placeholder) {
        selector = `${tag}[placeholder*="${placeholder.slice(0, 15)}"]`;
      } else if (ariaLabel) {
        selector = `[aria-label*="${ariaLabel.slice(0, 15)}"]`;
      }

      return { i: idx, tag, type, name, placeholder, ariaLabel, text, href, selector };
    });

    // Main article/body text excerpt
    const mainContainer = document.querySelector('article, main, [role="main"]') || document.body;
    const mainText = (mainContainer?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200);

    return {
      url: window.location.href,
      title: document.title,
      elements: minifiedList,
      summary: mainText
    };
  }

  // ─── Direct JS Executor Engine (Agent 2 - <300ms Latency) ───────────────────
  function tryDirectExecution(action, params = {}) {
    try {
      if ((action === 'TYPE' || action === 'FILL_INPUT') && params.text !== undefined) {
        const text = String(params.text);
        let el = params.selector ? document.querySelector(params.selector) : null;

        if (!el && params.target) {
          el = document.querySelector(params.target) ||
               Array.from(document.querySelectorAll('input, textarea')).find(i =>
                 (i.placeholder || '').toLowerCase().includes(params.target.toLowerCase()) ||
                 (i.name || '').toLowerCase().includes(params.target.toLowerCase()) ||
                 (i.id || '').toLowerCase().includes(params.target.toLowerCase())
               );
        }

        if (el) {
          el.focus();
          if (el.isContentEditable) {
            el.innerText = text;
          } else {
            el.value = text;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'direct_js', target: el.tagName };
        }
      }

      if ((action === 'CLICK' || action === 'CLICK_ELEMENT')) {
        let el = params.selector ? document.querySelector(params.selector) : null;
        if (!el && params.target) {
          el = document.querySelector(params.target) ||
               Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]')).find(b =>
                 (b.innerText || b.textContent || '').toLowerCase().includes(params.target.toLowerCase())
               );
        }
        if (el) {
          el.focus();
          el.click();
          return { success: true, method: 'direct_js', clicked: true };
        }
      }

      if (action === 'NAVIGATE' && params.url) {
        window.location.href = params.url;
        return { success: true, method: 'direct_js', navigating: true };
      }
    } catch (e) {
      console.warn('[Direct JS Executor]', e.message);
    }
    return null;
  }

  // ─── Real-Time Screen Readout (Speech Synthesis TTS) ────────────────────────
  function speakScreenText(textToSpeak) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // Stop any active speech
      const text = textToSpeak || extractCleanScreenText();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[TTS Readout]', e.message);
    }
  }

  function extractCleanScreenText() {
    const main = document.querySelector('article, main, [role="main"]') || document.body;
    if (!main) return 'No text found on current page.';
    return (main.innerText || '')
      .replace(/(\r\n|\n|\r)+/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);
  }

  // Expose DOM snapshot to background & web app
  window.addEventListener('ZULORA_GET_DOM_SNAPSHOT', () => {
    const snap = getMinifiedDOM();
    window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_DOM_SNAPSHOT', snapshot: snap }, '*');
  });

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

  // ─── Draggable Pearl & Azure Floating Voice Widget ──────────────────────────
  function injectVoiceWidget() {
    if (document.getElementById('zulora-floating-mic')) return;

    if (isExtensionValid()) {
      try {
        chrome.storage.local.get(['floatingMicEnabled'], (res) => {
          if (res && res.floatingMicEnabled === false) return;
          buildWidget();
        });
      } catch { buildWidget(); }
    } else {
      buildWidget();
    }
  }

  function buildWidget() {
    if (document.getElementById('zulora-floating-mic')) return;

    // Inject Styles
    const style = document.createElement('style');
    style.id = 'zulora-mic-styles';
    style.textContent = `
      #zulora-floating-mic {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 2147483647;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
        box-shadow: 0 4px 18px rgba(2, 132, 199, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        touch-action: none;
        transition: transform 0.15s ease, box-shadow 0.2s ease;
      }
      #zulora-floating-mic:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 22px rgba(2, 132, 199, 0.65);
      }
      #zulora-floating-mic.listening {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8);
        animation: zuloraPulseRing 1.3s infinite cubic-bezier(0.4, 0, 0.6, 1);
      }
      #zulora-floating-mic svg { pointer-events: none; }
      #zulora-voice-toast {
        position: fixed;
        bottom: 96px;
        right: 28px;
        z-index: 2147483646;
        background: rgba(15, 23, 42, 0.94);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        padding: 9px 15px;
        border-radius: 12px;
        max-width: 320px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(8px);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
        line-height: 1.4;
      }
      #zulora-voice-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      @keyframes zuloraPulseRing {
        0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
        70%  { box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); }
        100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
      }
    `;
    document.head.appendChild(style);

    // Create Toast Tooltip
    const toast = document.createElement('div');
    toast.id = 'zulora-voice-toast';
    toast.textContent = '🎙 Listening… Speak your command';
    document.body.appendChild(toast);

    let toastTimer = null;
    function showToast(msg, durationMs = 3000) {
      clearTimeout(toastTimer);
      toast.textContent = msg;
      toast.classList.add('visible');
      if (durationMs > 0) {
        toastTimer = setTimeout(() => toast.classList.remove('visible'), durationMs);
      }
    }

    function hideToast() {
      clearTimeout(toastTimer);
      toast.classList.remove('visible');
    }

    // Create Widget Button
    const mic = document.createElement('div');
    mic.id = 'zulora-floating-mic';
    mic.setAttribute('title', 'Zulora AI Voice Agent (Click to speak / click to stop)');
    mic.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    document.body.appendChild(mic);

    // Restore Saved Coordinates
    if (isExtensionValid()) {
      try {
        chrome.storage.local.get(['zuloraWidgetPos'], (res) => {
          if (res && res.zuloraWidgetPos) {
            mic.style.right = 'auto';
            mic.style.bottom = 'auto';
            mic.style.left = res.zuloraWidgetPos.x + 'px';
            mic.style.top  = res.zuloraWidgetPos.y + 'px';
          }
        });
      } catch {}
    }

    // Smooth Mouse & Touch Dragging
    let dragging = false, dragStartX = 0, dragStartY = 0, hasMoved = false;

    const startDrag = (clientX, clientY) => {
      dragging = true;
      hasMoved = false;
      mic.style.cursor = 'grabbing';
      const rect = mic.getBoundingClientRect();
      dragStartX = clientX - rect.left;
      dragStartY = clientY - rect.top;
    };

    const doDrag = (clientX, clientY) => {
      if (!dragging) return;
      hasMoved = true;
      const x = clientX - dragStartX;
      const y = clientY - dragStartY;
      const safeX = Math.max(8, Math.min(window.innerWidth - 64, x));
      const safeY = Math.max(8, Math.min(window.innerHeight - 64, y));
      mic.style.right = 'auto';
      mic.style.bottom = 'auto';
      mic.style.left = safeX + 'px';
      mic.style.top  = safeY + 'px';
    };

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      mic.style.cursor = 'grab';
      if (hasMoved && isExtensionValid()) {
        try {
          const pos = { x: parseInt(mic.style.left, 10), y: parseInt(mic.style.top, 10) };
          chrome.storage.local.set({ zuloraWidgetPos: pos });
        } catch {}
      }
    };

    mic.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startDrag(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup', stopDrag);

    // Touch Support
    mic.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (touch) startDrag(touch.clientX, touch.clientY);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      if (touch) doDrag(touch.clientX, touch.clientY);
    }, { passive: true });
    document.addEventListener('touchend', stopDrag);

    // ─── CONTINUOUS VOICE RECOGNITION (4.0s Silence Auto-Stop & Manual Stop) ───
    let isListening = false;
    let recognition = null;
    let silenceTimer = null;
    let fullTranscript = '';

    function resetSilenceTimer() {
      clearTimeout(silenceTimer);
      // Wait for 4.0 seconds of absolute silence before auto-finalizing task
      silenceTimer = setTimeout(() => {
        if (isListening && fullTranscript.trim()) {
          finalizeVoiceCommand();
        }
      }, 4000);
    }

    function finalizeVoiceCommand() {
      clearTimeout(silenceTimer);
      if (recognition) {
        try { recognition.stop(); } catch {}
      }
      isListening = false;
      mic.classList.remove('listening');

      const command = fullTranscript.trim();
      fullTranscript = '';

      if (!command) {
        hideToast();
        return;
      }

      showToast(`⚡ Executing: "${command.slice(0, 45)}…"`, 4000);

      const lower = command.toLowerCase();

      // Screen Reading query check
      if (lower.includes('read screen') || lower.includes('what is on this page') || lower.includes('summarize page')) {
        const screenText = extractCleanScreenText();
        speakScreenText(screenText);
        showToast('🔊 Reading screen text aloud…', 4000);
        window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_SCREEN_READ', text: screenText }, '*');
        return;
      }

      // Auto-fill check
      if (lower.includes('my name is') || lower.includes('email is') || lower.includes('phone is') || lower.includes('fill form')) {
        autoFillFromVoice(command);
        showToast('✅ Form fields populated from voice!', 3500);
      }

      // Broadcast command to web app UI and execute task pipeline
      window.postMessage({
        source: 'ZULORA_EXTENSION',
        type: 'ZULORA_VOICE_COMMAND',
        command
      }, '*');

      safeSendMessage({
        type: 'EXECUTE_ACTION',
        payload: {
          type: 'ZULORA_RUN_TASK',
          voiceCommand: command,
          command
        }
      });
    }

    mic.addEventListener('click', () => {
      if (hasMoved) {
        hasMoved = false;
        return; // Suppress click trigger when dragging
      }

      // Manual Stop on second click
      if (isListening) {
        finalizeVoiceCommand();
        return;
      }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        showToast('⚠ Speech recognition not supported in this browser.');
        return;
      }

      recognition = new SR();
      recognition.continuous = true;       // CONTINUOUS: Do NOT cut off early
      recognition.interimResults = true;   // Live transcript stream
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      fullTranscript = '';

      recognition.onstart = () => {
        isListening = true;
        mic.classList.add('listening');
        showToast('🎙 Listening… speak your command (Click to stop)', 0);
        resetSilenceTimer();
      };

      recognition.onresult = (event) => {
        let interimText = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += piece + ' ';
          } else {
            interimText += piece;
          }
        }

        if (finalChunk) {
          fullTranscript += finalChunk;
        }

        const currentDisplay = (fullTranscript + interimText).trim();
        if (currentDisplay) {
          showToast(`🎙 "${currentDisplay.slice(-40)}"`, 0);
          resetSilenceTimer();
        }
      };

      recognition.onerror = (e) => {
        console.warn('[Web Speech Error]', e.error);
        if (e.error === 'no-speech') return; // Keep listening
        isListening = false;
        mic.classList.remove('listening');
        showToast('⚠ Speech: ' + e.error, 3000);
      };

      recognition.onend = () => {
        // If still flagged as listening (e.g. Chrome automatic pause), restart if no silence cutoff
        if (isListening && !fullTranscript) {
          try { recognition.start(); } catch {}
        } else if (isListening) {
          finalizeVoiceCommand();
        }
      };

      try {
        recognition.start();
      } catch (e) {
        showToast('⚠ Could not activate mic: ' + e.message, 3000);
      }
    });
  }

  // ─── Initialize Widget ───────────────────────────────────────────────────────
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectVoiceWidget();
  } else {
    document.addEventListener('DOMContentLoaded', injectVoiceWidget);
  }

  // Ready signal
  safeSendMessage({ type: 'ZULORA_CONTENT_READY', url: window.location.href });
  console.log('[Zulora Content v1.4] Triple-Agent & Continuous Speech Active on', window.location.hostname);

})();
