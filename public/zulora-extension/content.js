/**
 * Zulora AI Computer Plugin — Content Script v1.2
 * ================================================
 * Fixes & Features:
 *  - Bulletproof context-invalidation guard: detects extension reload/update
 *  - Graceful fallback using window.postMessage without throwing red console errors
 *  - API Key synchronization: receives keys from Zulora web app to power offline/extension AI brain
 *  - Universal DOM action handlers for WhatsApp, ChatGPT, Gemini, Gmail, etc.
 */

(function () {
  'use strict';

  // ─── Context Guard ───────────────────────────────────────────────────────────
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  // ─── Handshake / Auto-Detection ─────────────────────────────────────────────
  try {
    document.documentElement.setAttribute('data-zulora-plugin-active', 'true');
    window.dispatchEvent(new CustomEvent('ZULORA_PLUGIN_CONNECTED', {
      detail: { version: '1.2.0', status: 'connected' }
    }));
  } catch {}

  // ─── Safe Runtime Message Sender ─────────────────────────────────────────────
  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) {
      // Graceful fallback: post message to window so web application handles it gracefully
      window.postMessage({
        source: 'ZULORA_EXTENSION',
        type: 'ZULORA_CONTEXT_INVALIDATED',
        message: 'Extension context invalidated. Please refresh the page.'
      }, '*');
      if (typeof callback === 'function') {
        callback({ success: false, ok: false, error: 'Extension context invalidated' });
      }
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          // Suppress unhandled error log, invoke callback with error object
          console.warn('[Zulora Bridge] Extension connection note:', lastErr.message);
          if (typeof callback === 'function') {
            callback({ success: false, ok: false, error: lastErr.message });
          }
          return;
        }
        if (typeof callback === 'function') {
          callback(response || { success: true, ok: true });
        }
      });
    } catch (err) {
      console.warn('[Zulora Bridge] Runtime error handled:', err.message);
      if (typeof callback === 'function') {
        callback({ success: false, ok: false, error: err.message });
      }
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
  // 1. Task Execution
  window.addEventListener('ZULORA_EXECUTE_AGENT_TASK', (event) => {
    const detail = event.detail || {};
    safeSendMessage({ type: 'EXECUTE_ACTION', payload: detail }, (response) => {
      window.dispatchEvent(new CustomEvent('ZULORA_AGENT_RESPONSE', {
        detail: response || { success: true, ok: true }
      }));
    });
  });

  // 2. API Key Waterfall Sync (from web app to extension storage)
  window.addEventListener('ZULORA_SYNC_API_KEYS', (event) => {
    const keys = event.detail || {};
    safeSendMessage({ type: 'SYNC_API_KEYS', payload: keys }, (res) => {
      console.log('[Zulora Extension] API Key Waterfall synchronized successfully');
    });
  });

  // 3. Ping Check
  window.addEventListener('ZULORA_PING', () => {
    if (isExtensionValid()) {
      safeSendMessage({ type: 'PING' }, (res) => {
        window.dispatchEvent(new CustomEvent('ZULORA_PONG', { detail: res }));
      });
    }
  });

  // ─── Login Required Detection ───────────────────────────────────────────────
  function detectLoginRequired() {
    try {
      const signals = [
        () => document.querySelector('input[type="password"]'),
        () => document.querySelector('[aria-label*="sign in" i]'),
        () => document.querySelector('[aria-label*="log in" i]'),
        () => /sign.?in|log.?in|login|authenticate/i.test(document.title)
      ];
      return signals.some(fn => { try { return Boolean(fn()); } catch { return false; } });
    } catch { return false; }
  }

  if (detectLoginRequired()) {
    window.postMessage({
      source: 'ZULORA_EXTENSION',
      type: 'ZULORA_LOGIN_REQUIRED',
      host: window.location.hostname,
      message: `Sign-in required on ${window.location.hostname}. Please log in and continue your task.`
    }, '*');
  }

  // Ready signal
  safeSendMessage({ type: 'ZULORA_CONTENT_READY', url: window.location.href });
  console.log('[Zulora Content v1.2] Active on', window.location.hostname);
})();


  // ─── Floating Voice & Control Widget ─────────────────────────────────────────
  function injectVoiceWidget() {
    if (document.getElementById('zulora-ai-widget')) return;
    
    const widget = document.createElement('div');
    widget.id = 'zulora-ai-widget';
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: linear-gradient(135deg, #0284c7 0%, #3b82f6 100%);
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.2s;
    `;
    
    widget.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
    
    widget.addEventListener('mouseenter', () => widget.style.transform = 'scale(1.05)');
    widget.addEventListener('mouseleave', () => widget.style.transform = 'scale(1)');
    
    let isListening = false;
    let recognition = null;
    
    widget.addEventListener('click', () => {
      if (isListening) {
        if (recognition) recognition.stop();
        isListening = false;
        widget.style.background = 'linear-gradient(135deg, #0284c7 0%, #3b82f6 100%)';
        widget.style.animation = 'none';
        return;
      }
      
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('Voice recognition not supported in this browser.');
        return;
      }
      
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      
      recognition.onstart = () => {
        isListening = true;
        widget.style.background = '#ef4444'; // red when listening
        widget.style.animation = 'pulse 1.5s infinite';
      };
      
      recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        
        // Mid-task voice updates
        if (transcript.includes('stop task') || transcript.includes('stop agent')) {
          safeSendMessage({ type: 'ZULORA_CANCEL' });
          widget.style.background = 'linear-gradient(135deg, #0284c7 0%, #3b82f6 100%)';
          isListening = false;
          recognition.stop();
        } else {
          // Dispatch intent back to web app
          window.postMessage({ source: 'ZULORA_EXTENSION', type: 'ZULORA_VOICE_COMMAND', command: transcript }, '*');
        }
      };
      
      recognition.start();
    });
    
    document.body.appendChild(widget);
    
    // Add keyframes for pulse
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
        70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Inject when ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectVoiceWidget();
  } else {
    document.addEventListener('DOMContentLoaded', injectVoiceWidget);
  }
