/**
 * Zulora AI — Browser Agent Engine (v1.2.0)
 * Autonomous Web Agent Engine with Multi-App orchestration (WhatsApp, YouTube, ChatGPT, Gemini, Gmail),
 * NLP Intent Cleaner, and built-in Zulora templates.
 */

import { apiRouter } from './apiRouter';
import { db, doc, setDoc, getDoc } from '../firebase'; // Import Firestore database

const EXTENSION_ID = 'emimeingkoocmgljpjkpdnlnbkpkfbff';

export const ACTION_TYPES = {
  OPEN_URL:        'open_url',
  SWITCH_TAB:      'switch_tab',
  CLOSE_TAB:       'close_tab',
  SEARCH_GOOGLE:   'search_google',
  YOUTUBE_PLAY:    'youtube_play',
  TYPE_TEXT:       'type_text',
  CLICK_ELEMENT:   'click_element',
  EXTRACT:         'extract_content',
  READ_DOM:        'read_page_dom',
  SUMMARIZE_PAGE:  'summarize_page',
  GMAIL_COMPOSE:   'gmail_compose',
  GMAIL_READ:      'gmail_read_inbox',
  CHATGPT_PROMPT:  'chatgpt_prompt',
  GEMINI_PROMPT:   'gemini_prompt',
  WHATSAPP_SEND:   'whatsapp_send',
  EXPORT_PDF:      'export_pdf',
  EXPORT_CODE:     'export_code',
  DOWNLOAD_FILE:   'download_file',
  WAIT:            'wait',
  NOTIFY_USER:     'notify_user',
  AUTOFILL_FORM:   'autofill_form'
};

export const TEMPLATES = {
  PEARL: 'pearl',
  AZURE: 'azure',
  FORMAL: 'formal',
};

// ─── Token Synchronization Engine ───────────────────────────────────────────────
export async function syncTokenUsage(tokensConsumed, userId) {
  if (!tokensConsumed || typeof tokensConsumed !== 'number') return 0;
  
  // 1. Get current local tokens
  let currentTotal = parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  currentTotal += tokensConsumed;
  
  // 2. Save locally so page reloads don't reset
  localStorage.setItem('zulora_total_tokens', currentTotal.toString());

  // 3. Sync to Firebase (Unified Tracker)
  if (userId && db) {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const dbTokens = parseInt(data.tokenUsage || '0', 10);
        // Take the max of DB and local to ensure no lost tokens, then add new consumed
        const newTotal = Math.max(dbTokens, currentTotal);
        await setDoc(userRef, { tokenUsage: newTotal }, { merge: true });
        localStorage.setItem('zulora_total_tokens', newTotal.toString());
        return newTotal;
      } else {
        await setDoc(userRef, { tokenUsage: currentTotal }, { merge: true });
      }
    } catch (e) {
      console.warn('[Zulora Token Engine] Firebase sync failed:', e);
    }
  }
  return currentTotal;
}


// ─── Intent & NLP Cleaner ─────────────────────────────────────────────────────
/**
 * Strips filler words to extract the pure intent entity.
 * Fixes "[object Object]" bugs and cleans queries like "open youtube and search for mrbeast there please".
 */
export function cleanSearchIntent(rawQuery) {
  if (!rawQuery) return '';
  
  // 1. Fix [object Object] serialization
  let text = typeof rawQuery === 'object' 
    ? (rawQuery.text || rawQuery.query || rawQuery.searchTerm || Object.values(rawQuery).join(' ')) 
    : String(rawQuery);

  text = text.trim().toLowerCase();

  // 2. Strip NLP fillers
  const fillers = [
    /open youtube and search for/gi,
    /search for/gi,
    /search/gi,
    /open youtube and play/gi,
    /play the video/gi,
    /play/gi,
    /find/gi,
    /go to google and find/gi,
    /there/gi,
    /please/gi,
    /on the search bar/gi,
    /on youtube/gi,
    /in youtube/gi,
    /on google/gi
  ];

  for (const regex of fillers) {
    text = text.replace(regex, '');
  }

  return text.trim();
}

// ─── HTML Templates ───────────────────────────────────────────────────────────
export function renderEmailTemplate(bodyHtml, templateType = TEMPLATES.PEARL, meta = {}) {
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const content = typeof bodyHtml === 'object' ? Object.values(bodyHtml).join('\n') : String(bodyHtml || '');

  if (templateType === TEMPLATES.PEARL) {
    return `
      <div style="font-family: 'Inter', -apple-system, sans-serif; background: #ffffff; color: #1e293b; max-width: 600px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="padding: 32px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0;">
          <h2 style="margin: 0; color: #0f172a; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">${meta.subject || 'Message from Zulora AI'}</h2>
          <p style="margin: 8px 0 0; color: #64748b; font-size: 13px;">Sent on ${currentDate} at ${time}</p>
        </div>
        <div style="padding: 32px; font-size: 15px; line-height: 1.6; color: #334155;">
          ${content.replace(/\n/g, '<br>')}
        </div>
        <div style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: 500;">Automated by <span style="color: #0ea5e9; font-weight: 600;">Zulora AI</span></p>
        </div>
      </div>
    `;
  }
  
  return `<div style="font-family: sans-serif; white-space: pre-wrap;">${content}</div>`;
}

// ─── Bridge Communicator ──────────────────────────────────────────────────────
export async function checkExtensionConnected() {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(false); }
    }, 1500);

    const onPong = (event) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('ZULORA_PONG', onPong);
        resolve(true);
      }
    };
    window.addEventListener('ZULORA_PONG', onPong);
    try {
      window.dispatchEvent(new CustomEvent('ZULORA_PING'));
    } catch {
      resolve(false);
    }
  });
}

export function onStatusUpdate(callback) {
  const listener = (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION' && event.data?.type === 'ZULORA_STATUS_UPDATE') {
      callback(event.data);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export async function sendBridgeMessageWithRetry(detail, maxAttempts = 3, delayMs = 1500, timeoutMs = 15000) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await new Promise((resolve) => {
      let settled = false;
      const listener = (event) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('ZULORA_AGENT_RESPONSE', listener);
        clearTimeout(timer);
        resolve(event.detail || { ok: false, success: false, error: 'Empty' });
      };
      const timer = setTimeout(() => {
        if (!settled) { settled = true; window.removeEventListener('ZULORA_AGENT_RESPONSE', listener); resolve(null); }
      }, timeoutMs);
      window.addEventListener('ZULORA_AGENT_RESPONSE', listener);
      try {
        window.dispatchEvent(new CustomEvent('ZULORA_EXECUTE_AGENT_TASK', { detail }));
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); window.removeEventListener('ZULORA_AGENT_RESPONSE', listener); resolve({ ok: false, error: err.message }); }
      }
    });

    if (result && (result.ok || result.success)) return result;
    lastError = result?.error || 'No response';
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
  }
  return { ok: false, success: false, error: lastError || 'Extension bridge timeout' };
}

// ─── Step Parser ──────────────────────────────────────────────────────────────
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();
  const steps = [];

  // 1. YouTube Action (Entity extraction & [object Object] fix applied in Extension side, but we ensure string here)
  if (cmd.includes('youtube') || cmd.includes('play video') || cmd.includes('play ')) {
    const rawMatch = command.match(/(?:search|play|find|for)[:\s]+["']?(.+?)["']?$/i);
    let entity = rawMatch ? rawMatch[1] : command;
    entity = cleanSearchIntent(entity);

    steps.push({
      action: ACTION_TYPES.YOUTUBE_PLAY,
      app: 'YouTube',
      needsLlm: false,
      params: { query: entity }
    });
    return steps;
  }

  // 2. Gmail / Email
  if (cmd.includes('email') || cmd.includes('gmail') || cmd.includes('send mail')) {
    const toMatch = command.match(/to\s+([\w._%+-]+@[\w.-]+\.[a-z]{2,})/i);
    const subjMatch = command.match(/subject[:\s]+["']?(.+?)["']?(?:\s+(?:body|saying|with|and|message)|$)/i);
    const bodyMatch = command.match(/(?:body|saying|message|draft|write)[:\s]+["']?(.+?)["']?$/i);

    const isTemplate = /template|pearl|azure|formal letter/i.test(command);
    
    steps.push({
      action: ACTION_TYPES.GMAIL_COMPOSE,
      app: 'Gmail',
      needsLlm: true,
      llmType: 'email',
      params: {
        to: toMatch?.[1] || '',
        subject: subjMatch?.[1] || 'Important Message from Zulora AI',
        rawPrompt: bodyMatch?.[1] || cleanSearchIntent(command),
        template: isTemplate ? 'Pearl' : 'None'
      }
    });
    return steps;
  }

  // 3. WhatsApp Web
  if (cmd.includes('whatsapp') || cmd.includes('whats app')) {
    const toMatch = command.match(/to\s+([A-Za-z0-9\s]+?)(?:\s+(?:saying|with|message)|$)/i);
    const msgMatch = command.match(/(?:saying|message|with|text)[:\s]+["']?(.+?)["']?$/i);

    steps.push({
      action: ACTION_TYPES.WHATSAPP_SEND,
      app: 'WhatsApp',
      needsLlm: true,
      llmType: 'whatsapp',
      params: {
        recipient: cleanSearchIntent(toMatch?.[1] || ''),
        rawPrompt: msgMatch?.[1] || cleanSearchIntent(command)
      }
    });
    return steps;
  }

  // 4. ChatGPT
  if (cmd.includes('chatgpt') || cmd.includes('chat gpt')) {
    const promptMatch = command.match(/(?:ask|prompt|search|tell|with|query)[:\s]+["']?(.+?)["']?$/i);
    steps.push({
      action: ACTION_TYPES.CHATGPT_PROMPT,
      app: 'ChatGPT',
      needsLlm: false,
      params: { prompt: cleanSearchIntent(promptMatch?.[1] || command) }
    });
    return steps;
  }

  // 5. PDF Export
  if (cmd.includes('export pdf') || cmd.includes('save as pdf') || cmd.includes('convert to pdf')) {
    steps.push({ action: ACTION_TYPES.EXPORT_PDF, app: 'System', needsLlm: false, params: {} });
    return steps;
  }

  // 6. Generic Extension Brain Fallback (Autonomous logic for Forms/UI)
  if (cmd.includes('fill form') || cmd.includes('register') || cmd.includes('sign in')) {
    steps.push({
      action: ACTION_TYPES.AUTOFILL_FORM,
      app: 'Zulora AutoFill',
      needsLlm: false,
      params: { intent: cleanSearchIntent(command) }
    });
    return steps;
  }

  // Fallback Web Agent Reasoning
  steps.push({
    action: 'ai_reasoning',
    app: 'Web Agent',
    needsLlm: false,
    params: { prompt: cleanSearchIntent(command) }
  });
  return steps;
}

// ─── Control Commands ─────────────────────────────────────────────────────────
export function pauseTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_PAUSE' }, 1);
}
export function resumeTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_RESUME' }, 1);
}
export function cancelTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_CANCEL' }, 1);
}

// ─── Task Execution ───────────────────────────────────────────────────────────
export async function executeCommand(command, currentUser, onLog) {
  const steps = parseCommandToSteps(command);
  if (!steps.length) return { ok: false, error: 'Could not parse command.' };

  let totalTokensUsed = 0;

  // Pre-generate rich LLM payloads for Email/WhatsApp before passing to browser executor
  for (const step of steps) {
    if (step.needsLlm && step.params?.rawPrompt) {
      if (onLog) onLog({ index: 1, label: `🤖 LLM Generating payload (${step.llmType})`, status: 'running', timestamp: Date.now() });
      
      const payloadReq = [
        { role: 'system', content: `Generate a perfect output for ${step.llmType}. Do NOT use markdown code blocks. Output the raw text only.` },
        { role: 'user', content: step.params.rawPrompt }
      ];
      
      try {
        const generated = await apiRouter.generateChat(step.params.rawPrompt, payloadReq);
        const text = typeof generated === 'object' ? (generated.text || Object.values(generated).join('')) : String(generated);
        // Approximation: 1 word ~ 1.3 tokens
        const tokens = Math.floor(text.split(/\s+/).length * 1.3) + 20; 
        totalTokensUsed += tokens;

        if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
          step.params.bodyHtml = renderEmailTemplate(text, step.params.template, { subject: step.params.subject });
        } else if (step.action === ACTION_TYPES.WHATSAPP_SEND) {
          step.params.message = text;
        }

        if (onLog) onLog({ index: 1, label: `⚡ Generated payload (${tokens} tokens)`, status: 'done', timestamp: Date.now() });
      } catch (err) {
        if (onLog) onLog({ index: 1, label: `Payload generation failed`, status: 'error', detail: err.message, timestamp: Date.now() });
      }
    }
  }

  // Persist Tokens to Unified Firebase Tracker
  const updatedTokens = await syncTokenUsage(totalTokensUsed, currentUser?.uid);

  // Send steps to Extension
  const res = await sendBridgeMessageWithRetry({ type: 'ZULORA_RUN_TASK', steps });
  return { ...res, tokensUsed: totalTokensUsed, newTotalTokens: updatedTokens };
}
