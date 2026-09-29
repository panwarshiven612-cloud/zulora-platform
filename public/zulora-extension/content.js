/**
 * Zulora AI Computer Plugin — Content Script v1.4.1
 * ===================================================
 * Features:
 *  - Triple-Agent DOM & Native Turtle Cursor Executor (sub-300ms latency)
 *  - Smooth visual mouse cursor movement on screen during clicks
 *  - Continuous Voice Recognition with 4.0s Silence Auto-Stop & Manual 2nd-Click Stop
 *  - Draggable Pearl & Azure Glassmorphism Floating Mic with Coordinate Persistence
 *  - Live pulsing audio visualizer ring & real-time interim transcript tooltip
 *  - Ultra-Fast DOM Minifier (<3KB payload, clickable/interactive elements only)
 *  - Real-Time Screen Readout via Web Speech Synthesis TTS
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
      detail: { version: '1.4.1', status: 'connected' }
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

  // ─── Listen for Status Updates & Commands from Background ────────────────────
  if (isExtensionValid()) {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && (message.type === 'ZULORA_STATUS_UPDATE' || message.type === 'ZULORA_AGENT_STEP_UPDATE' || message.type === 'ZULORA_SCREEN_STATE_UPDATE')) {
          window.postMessage({ ...message, source: 'ZULORA_EXTENSION' }, '*');
          if (sendResponse) sendResponse({ ok: true });
        }
        if (message && message.type === 'ZULORA_READ_SCREEN_TTS') {
          speakScreenText(message.text || document.body?.innerText?.slice(0, 1500) || 'No text found on screen.');
          if (sendResponse) sendResponse({ ok: true });
        }
        if (message && message.type === 'ZULORA_MOVE_TURTLE_CURSOR') {
          animateTurtleCursorTo(message.x, message.y, () => {
            if (sendResponse) sendResponse({ ok: true });
          });
          return true;
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
      // Inject smart ID for deterministic targeting
      const zId = (idx + 1).toString();
      el.setAttribute('data-zulora-id', zId);

      const tag = el.tagName.toLowerCase();
      let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
      const placeholder = (el.placeholder || '').slice(0, 30);
      const ariaLabel = (el.getAttribute('aria-label') || '').slice(0, 30);
      const name = el.name || el.id || '';
      const type = el.type || '';
      const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 80) : '';

      let selector = `[data-zulora-id="${zId}"]`; // Primary resilient selector
      
      // Fallback selector string
      let fallbackSelector = tag;
      if (el.id) fallbackSelector = `#${el.id}`;
      else if (el.name) fallbackSelector = `${tag}[name="${el.name}"]`;

      return { id: zId, tag, type, name, placeholder, ariaLabel, text, href, selector, fallbackSelector };
    });

    const mainContainer = document.querySelector('article, main, [role="main"]') || document.body;
    const mainText = (mainContainer?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200);

    return {
      url: window.location.href,
      title: document.title,
      elements: minifiedList,
      summary: mainText
    };
  }

  // ─── AGENT 2: Turtle Cursor Simulation Engine ───────────────────────────────
  function getOrCreateTurtleCursor() {
    let cursor = document.getElementById('zulora-turtle-cursor');
    if (cursor) return cursor;

    cursor = document.createElement('div');
    cursor.id = 'zulora-turtle-cursor';
    cursor.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 8px rgba(2, 132, 199, 0.75));">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="#0284c7" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
      <div class="zulora-cursor-ripple"></div>
    `;
    document.body.appendChild(cursor);
    return cursor;
  }

  function animateTurtleCursorTo(targetX, targetY, onComplete) {
    const cursor = getOrCreateTurtleCursor();
    cursor.style.opacity = '1';
    cursor.style.transform = `translate(${targetX}px, ${targetY}px)`;

    setTimeout(() => {
      const ripple = cursor.querySelector('.zulora-cursor-ripple');
      if (ripple) {
        ripple.classList.add('animate');
        setTimeout(() => ripple.classList.remove('animate'), 350);
      }
      if (typeof onComplete === 'function') onComplete();
      setTimeout(() => {
        cursor.style.opacity = '0';
      }, 350);
    }, 160);
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
          const rect = el.getBoundingClientRect();
          animateTurtleCursorTo(rect.left + rect.width / 2, rect.top + rect.height / 2, () => {
            el.focus();
            if (el.isContentEditable) {
              el.innerText = text;
            } else {
              el.value = text;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
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
          const rect = el.getBoundingClientRect();
          animateTurtleCursorTo(rect.left + rect.width / 2, rect.top + rect.height / 2, () => {
            el.focus();
            el.click();
          });
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
      window.speechSynthesis.cancel();
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

    // Inject Styles for Mic & Turtle Cursor
    const style = document.createElement('style');
    style.id = 'zulora-mic-styles';
    style.textContent = `
      #zulora-turtle-cursor {
        position: fixed;
        top: 0; left: 0;
        width: 24px;
        height: 24px;
        pointer-events: none;
        z-index: 2147483647;
        opacity: 0;
        transform: translate(0px, 0px);
        transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.2s ease;
      }
      .zulora-cursor-ripple {
        position: absolute;
        top: 50%; left: 50%;
        width: 10px; height: 10px;
        margin: -5px 0 0 -5px;
        border-radius: 50%;
        border: 2px solid #38bdf8;
        opacity: 0;
        pointer-events: none;
      }
      .zulora-cursor-ripple.animate {
        animation: zuloraRippleAnim 0.38s ease-out forwards;
      }
      @keyframes zuloraRippleAnim {
        0% { transform: scale(1); opacity: 1; }
        100% { transform: scale(5); opacity: 0; }
      }

      /* Pearl & Azure Glassmorphism Floating Mic */
      #zulora-floating-mic {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 2147483647;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.88) 0%, rgba(56, 189, 248, 0.75) 50%, rgba(99, 102, 241, 0.88) 100%);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1.5px solid rgba(255, 255, 255, 0.65);
        box-shadow: 0 8px 32px 0 rgba(2, 132, 199, 0.38), inset 0 1px 2px rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        touch-action: none;
        transition: transform 0.15s ease, box-shadow 0.2s ease;
      }
      #zulora-floating-mic:hover {
        transform: scale(1.06);
        box-shadow: 0 10px 36px 0 rgba(2, 132, 199, 0.55), inset 0 1px 2px rgba(255, 255, 255, 0.9);
      }
      #zulora-floating-mic.listening {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.92) 0%, rgba(220, 38, 38, 0.92) 100%);
        border: 1.5px solid rgba(255, 255, 255, 0.8);
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8);
        animation: zuloraPulseRing 1.3s infinite cubic-bezier(0.4, 0, 0.6, 1);
      }
      #zulora-floating-mic svg { pointer-events: none; }
      
      /* Visualizer waves inside mic while listening */
      .zulora-wave-bar {
        width: 3px;
        background: #ffffff;
        border-radius: 2px;
        margin: 0 1.5px;
        display: none;
      }
      #zulora-floating-mic.listening .zulora-mic-icon { display: none; }
      #zulora-floating-mic.listening .zulora-wave-bar {
        display: block;
        animation: zuloraWave 0.8s ease-in-out infinite alternate;
      }
      #zulora-floating-mic .zulora-wave-bar:nth-child(2) { animation-delay: 0.15s; }
      #zulora-floating-mic .zulora-wave-bar:nth-child(3) { animation-delay: 0.3s; }
      #zulora-floating-mic .zulora-wave-bar:nth-child(4) { animation-delay: 0.45s; }
      @keyframes zuloraWave {
        0%   { height: 6px; }
        100% { height: 22px; }
      }

      /* Real-time Interim Tooltip */
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

    // Create Widget Button with Wave Visualizer
    const mic = document.createElement('div');
    mic.id = 'zulora-floating-mic';
    mic.setAttribute('title', 'Zulora AI Voice Agent (Click to speak / click to stop)');
    mic.innerHTML = `
      <svg class="zulora-mic-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      <div class="zulora-wave-bar" style="height: 10px;"></div>
      <div class="zulora-wave-bar" style="height: 18px;"></div>
      <div class="zulora-wave-bar" style="height: 24px;"></div>
      <div class="zulora-wave-bar" style="height: 14px;"></div>
    `;
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

    // ─── BUGFIX 5: CONTINUOUS VOICE RECOGNITION (2.5s Silence Auto-Stop) ───
    let isListening = false;
    let recognition = null;
    let silenceTimer = null;
    let fullTranscript = '';

    // Smart Voice Polisher - strips um, ah, stutters
    function cleanInterimSpeech(text) {
      return text.replace(/\b(um|uh|ah|like|you know|so|basically)\b/gi, '')
                 .replace(/\s+/g, ' ').trim();
    }

    function resetSilenceTimer() {
      clearTimeout(silenceTimer);
      // Wait for 2.5 seconds of absolute silence before auto-finalizing task
      silenceTimer = setTimeout(() => {
        if (isListening && fullTranscript.trim()) {
          finalizeVoiceCommand();
        }
      }, 2500);
    }

    function finalizeVoiceCommand() {
      clearTimeout(silenceTimer);
      if (recognition) {
        try { recognition.stop(); } catch {}
      }
      isListening = false;
      mic.classList.remove('listening');

      let command = cleanInterimSpeech(fullTranscript.trim());
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
      recognition.continuous = true;       // CONTINUOUS: Do NOT cut off early while speaking
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

        const rawDisplay = (fullTranscript + interimText).trim();
        const currentDisplay = cleanInterimSpeech(rawDisplay);
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

  safeSendMessage({ type: 'ZULORA_CONTENT_READY', url: window.location.href });
  console.log('[Zulora Content v1.4.1] Triple-Agent & Continuous Speech Active on', window.location.hostname);

})();
