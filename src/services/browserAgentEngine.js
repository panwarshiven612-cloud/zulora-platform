/**
 * Zulora AI — Browser Agent Engine (v1.1)
 * Autonomous Web Agent engine with Multi-App orchestration (Gmail, WhatsApp, ChatGPT, Gemini),
 * Smart LLM content payload generation, and built-in Zulora Pearl & Azure HTML email templates.
 */

import { apiRouter } from './apiRouter';

// ─── Extension ID ─────────────────────────────────────────────────────────────
const EXTENSION_ID = 'emimeingkoocmgljpjkpdnlnbkpkfbff';

// ─── Action Type Constants ────────────────────────────────────────────────────
export const ACTION_TYPES = {
  OPEN_URL:        'open_url',
  SWITCH_TAB:      'switch_tab',
  CLOSE_TAB:       'close_tab',
  SEARCH_GOOGLE:   'search_google',
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
};

// ─── Built-in Zulora HTML Templates ───────────────────────────────────────────

export const TEMPLATES = {
  PEARL: 'pearl',
  AZURE: 'azure',
  FORMAL: 'formal',
};

/**
 * Render email content wrapped inside a Zulora Pearl, Azure, or Formal styled template.
 */
export function renderEmailTemplate(bodyHtml, templateType = TEMPLATES.PEARL, meta = {}) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const subject = meta.subject || 'Important Notice';
  const recipient = meta.to || '';

  if (templateType === TEMPLATES.AZURE) {
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #bae6fd; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(2, 132, 199, 0.1); color: #0f172a; line-height: 1.6;">
  <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px 28px; color: #ffffff;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 19px; font-weight: 800; letter-spacing: -0.02em;">Zulora Azure</span>
      <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 9999px;">Priority</span>
    </div>
    <div style="font-size: 13px; color: #e0f2fe; margin-top: 6px;">${subject}</div>
  </div>
  <div style="padding: 28px; font-size: 15px; color: #1e293b;">
    ${bodyHtml}
  </div>
  <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 28px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; align-items: center;">
    <span>Sent with <strong>Zulora AI Enterprise</strong></span>
    <span>${currentDate}</span>
  </div>
</div>`;
  }

  if (templateType === TEMPLATES.FORMAL) {
    return `
<div style="font-family: 'Georgia', Times, serif; max-width: 620px; margin: 0 auto; padding: 36px 30px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; color: #111827; line-height: 1.7; font-size: 15px;">
  <div style="text-align: right; margin-bottom: 24px; font-size: 13px; color: #6b7280;">${currentDate}</div>
  ${recipient ? `<div style="margin-bottom: 16px; font-weight: bold; color: #374151;">To: ${recipient}</div>` : ''}
  <div style="margin-bottom: 24px;">
    ${bodyHtml}
  </div>
  <div style="margin-top: 32px; border-top: 1px solid #f3f4f6; padding-top: 16px; font-size: 13px; color: #4b5563;">
    <div>Sincerely,</div>
    <div style="margin-top: 18px; font-weight: bold; color: #111827;">Zulora Executive Assistant</div>
  </div>
</div>`;
  }

  // Default: Zulora Pearl Template
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04); color: #1e293b; line-height: 1.65;">
  <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f8fafc; padding-bottom: 16px; margin-bottom: 20px;">
    <div style="font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em;">Zulora Pearl</div>
    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; background: #f1f5f9; padding: 3px 9px; border-radius: 9999px;">Verified</span>
  </div>
  <div style="font-size: 15px; color: #334155; margin-bottom: 20px;">
    ${bodyHtml}
  </div>
  <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
    <span>Crafted with Zulora Assistant</span>
    <span>${currentDate}</span>
  </div>
</div>`;
}

// ─── Status Update Event Hub ──────────────────────────────────────────────────
let _statusListeners = [];
let _lastStatus = null;

export function onStatusUpdate(fn) {
  _statusListeners.push(fn);
  return () => { _statusListeners = _statusListeners.filter(l => l !== fn); };
}

function _emit(status) {
  _lastStatus = status;
  _statusListeners.forEach(fn => { try { fn(status); } catch {} });
}

// ─── Extension DOM Bridge with Retry Logic ────────────────────────────────────

export async function checkExtensionConnected() {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-zulora-plugin-active') === 'true') {
    return true;
  }
  return false;
}

/**
 * Dispatch message through DOM CustomEvent bridge with up to 3 retries and 1.5s delay.
 */
async function sendBridgeMessageWithRetry(detail, maxAttempts = 3, delayMs = 1500, timeoutMs = 3000) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await new Promise((resolve) => {
      let settled = false;

      const listener = (event) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('ZULORA_AGENT_RESPONSE', listener);
        clearTimeout(timer);
        const res = event.detail || { ok: false, success: false, error: 'Empty response' };
        if (res.ok === undefined && res.success !== undefined) res.ok = !!res.success;
        if (res.success === undefined && res.ok !== undefined) res.success = !!res.ok;
        resolve(res);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('ZULORA_AGENT_RESPONSE', listener);
        resolve(null);
      }, timeoutMs);

      window.addEventListener('ZULORA_AGENT_RESPONSE', listener);

      try {
        window.dispatchEvent(new CustomEvent('ZULORA_EXECUTE_AGENT_TASK', { detail }));
      } catch (err) {
        if (settled) return;
        settled = true;
        window.removeEventListener('ZULORA_AGENT_RESPONSE', listener);
        clearTimeout(timer);
        resolve({ ok: false, success: false, error: err.message });
      }
    });

    if (result && (result.ok || result.success)) {
      return result;
    }

    lastError = result?.error || 'No response from extension bridge';

    if (attempt < maxAttempts) {
      console.warn(`[Zulora Bridge] Attempt ${attempt}/${maxAttempts} failed (${lastError}). Retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { ok: false, success: false, error: lastError || 'No response from extension bridge' };
}

export async function runTask(steps) {
  if (!steps?.length) {
    return { ok: false, success: false, error: 'No steps provided' };
  }
  return sendBridgeMessageWithRetry({ type: 'ZULORA_RUN_TASK', steps }, 3, 1500, 3000);
}

export async function pauseTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_PAUSE' }, 3, 1500, 2000);
}

export async function resumeTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_RESUME' }, 3, 1500, 2000);
}

export async function cancelTask() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_CANCEL' }, 3, 1500, 2000);
}

export async function getTaskStatus() {
  return sendBridgeMessageWithRetry({ type: 'ZULORA_STATUS' }, 3, 1500, 2000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION') {
      _emit(event.data);
    }
  });
}

// ─── Smart LLM Payload Generator ─────────────────────────────────────────────

/**
 * Generate high-quality text or HTML payload using Gemini/LLM before DOM automation.
 */
export async function generateTaskPayload(instruction, contextType = 'email', options = {}) {
  const isTemplate = /template|pearl|azure|formal letter|letter|resignation|proposal/i.test(instruction);
  const isHtml = contextType === 'email' || isTemplate;

  let prompt = '';
  if (contextType === 'email') {
    prompt = `You are an expert executive communicator for Zulora AI. Write a professional, complete, and polite email body based on this user instruction: "${instruction}".
${isHtml ? 'Format the email in clean, well-spaced HTML paragraphs (<p style="margin: 0 0 14px 0;">). Use <strong> for emphasis and <ul><li> for lists if needed. Do NOT include markdown ticks or wrap in ```html codeblocks.' : 'Write clean text with linebreaks.'} Include a warm closing and sign-off.`;
  } else if (contextType === 'whatsapp') {
    prompt = `You are an AI assistant. Draft a natural, concise, and friendly WhatsApp message based on this request: "${instruction}". Include relevant emojis where appropriate. Do NOT include quotation marks around the output.`;
  } else if (contextType === 'code') {
    prompt = `You are a principal software engineer. Generate production-ready code based on this request: "${instruction}". Output only clean code without backticks if possible, or well-structured code.`;
  } else {
    prompt = `You are an autonomous AI web assistant. Generate the exact content payload requested here: "${instruction}". Be thorough and concise.`;
  }

  try {
    const res = await apiRouter.generateText(prompt, [], 'auto', {
      currentUser: options.currentUser,
      temperature: 0.7
    });

    const rawText = String(res?.text || '').trim();
    const cleanText = rawText.replace(/^```html\s*|```$/gi, '').trim();

    // Estimate tokens
    const tokens = res?.tokens || Math.ceil((prompt.length + cleanText.length) / 4);

    // Template selection
    let templateType = null;
    let finalHtml = cleanText;

    if (/azure/i.test(instruction)) {
      templateType = TEMPLATES.AZURE;
      finalHtml = renderEmailTemplate(cleanText, TEMPLATES.AZURE, options);
    } else if (/pearl/i.test(instruction)) {
      templateType = TEMPLATES.PEARL;
      finalHtml = renderEmailTemplate(cleanText, TEMPLATES.PEARL, options);
    } else if (/formal|letter|resignation/i.test(instruction)) {
      templateType = TEMPLATES.FORMAL;
      finalHtml = renderEmailTemplate(cleanText, TEMPLATES.FORMAL, options);
    } else if (isTemplate || contextType === 'email') {
      templateType = TEMPLATES.PEARL;
      finalHtml = renderEmailTemplate(cleanText, TEMPLATES.PEARL, options);
    }

    return {
      text: cleanText,
      html: finalHtml,
      tokens,
      template: templateType
    };
  } catch (err) {
    console.warn('[BrowserAgentEngine] LLM generation failed, falling back to instruction:', err.message);
    const fallbackText = instruction;
    return {
      text: fallbackText,
      html: `<p>${fallbackText}</p>`,
      tokens: Math.ceil(fallbackText.length / 4),
      template: null
    };
  }
}

// ─── Multi-App Command Parser ─────────────────────────────────────────────────

/**
 * Parse natural language user instruction into structured multi-step plan.
 */
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();
  const steps = [];

  // ── 1. Gmail / Email ──────────────────────────────────────────────
  if (cmd.includes('email') || cmd.includes('gmail') || cmd.includes('send mail') || cmd.includes('draft email')) {
    const toMatch   = command.match(/to\s+([\w._%+-]+@[\w.-]+\.[a-z]{2,})/i);
    const subjMatch = command.match(/subject[:\s]+["']?(.+?)["']?(?:\s+(?:body|saying|with|and|message)|$)/i);
    const bodyMatch = command.match(/(?:body|saying|message|draft|write)[:\s]+["']?(.+?)["']?$/i);

    const isTemplate = /template|pearl|azure|formal letter|resignation|proposal/i.test(command);
    const templateName = /azure/i.test(command) ? 'Azure' : /formal/i.test(command) ? 'Formal' : 'Pearl';

    steps.push({
      action: ACTION_TYPES.GMAIL_COMPOSE,
      app: 'Gmail',
      needsLlm: true,
      llmType: 'email',
      params: {
        to:       toMatch?.[1] || '',
        subject:  subjMatch?.[1] || 'Important Message from Zulora AI',
        rawPrompt: bodyMatch?.[1] || command,
        template: isTemplate ? templateName : 'Pearl'
      }
    });
    return steps;
  }

  // ── 2. WhatsApp Web ───────────────────────────────────────────────
  if (cmd.includes('whatsapp') || cmd.includes('whats app')) {
    const toMatch = command.match(/to\s+([A-Za-z0-9\s]+?)(?:\s+(?:saying|with|message)|$)/i);
    const msgMatch = command.match(/(?:saying|message|with|text)[:\s]+["']?(.+?)["']?$/i);

    steps.push({
      action: ACTION_TYPES.WHATSAPP_SEND,
      app: 'WhatsApp',
      needsLlm: true,
      llmType: 'whatsapp',
      params: {
        recipient: toMatch?.[1]?.trim() || '',
        rawPrompt: msgMatch?.[1] || command
      }
    });
    return steps;
  }

  // ── 3. ChatGPT Automation ─────────────────────────────────────────
  if (cmd.includes('chatgpt') || cmd.includes('chat gpt')) {
    const promptMatch = command.match(/(?:ask|prompt|search|tell|with|query)[:\s]+["']?(.+?)["']?$/i);
    steps.push({
      action: ACTION_TYPES.CHATGPT_PROMPT,
      app: 'ChatGPT',
      params: {
        prompt: promptMatch?.[1] || command
      }
    });
    return steps;
  }

  // ── 4. Gemini Automation ──────────────────────────────────────────
  if (cmd.includes('gemini.google') || cmd.includes('open gemini') || cmd.includes('ask gemini')) {
    const promptMatch = command.match(/(?:ask|prompt|tell|query)[:\s]+["']?(.+?)["']?$/i);
    steps.push({
      action: ACTION_TYPES.GEMINI_PROMPT,
      app: 'Gemini',
      params: {
        prompt: promptMatch?.[1] || command
      }
    });
    return steps;
  }

  // ── 5. Screen & DOM Reader ────────────────────────────────────────
  if (cmd.includes('summarize this page') || cmd.includes('read page') || cmd.includes('read dom') || cmd.includes('screen reader') || cmd.includes('what is on this page')) {
    steps.push({
      action: ACTION_TYPES.READ_DOM,
      app: 'Screen Reader',
      params: {}
    });
    return steps;
  }

  // ── 6. PDF & Code Exporters ───────────────────────────────────────
  if (cmd.includes('export pdf') || cmd.includes('save as pdf') || cmd.includes('download pdf')) {
    steps.push({
      action: ACTION_TYPES.EXPORT_PDF,
      app: 'PDF Exporter',
      params: { filename: 'zulora_document.pdf' }
    });
    return steps;
  }

  if (cmd.includes('export code') || (cmd.includes('save') && cmd.includes('code'))) {
    steps.push({
      action: ACTION_TYPES.EXPORT_CODE,
      app: 'Code Exporter',
      needsLlm: true,
      llmType: 'code',
      params: {
        filename: 'zulora_script.js',
        rawPrompt: command
      }
    });
    return steps;
  }

  // ── 7. Google Search ──────────────────────────────────────────────
  if (cmd.includes('search') || cmd.includes('google')) {
    const qMatch = command.match(/(?:search|google)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+on google|$)/i);
    if (qMatch) {
      steps.push({ action: ACTION_TYPES.SEARCH_GOOGLE, app: 'Google', params: { query: qMatch[1] } });
      return steps;
    }
  }

  // ── 8. Open URL ───────────────────────────────────────────────────
  if (cmd.includes('open') || cmd.includes('go to') || cmd.includes('navigate to') || cmd.includes('visit')) {
    const urlMatch = command.match(/(?:open|go to|navigate to|visit)\s+(https?:\/\/\S+|[\w-]+\.[\w.-]+\S*)/i);
    if (urlMatch) {
      let url = urlMatch[1];
      if (!url.startsWith('http')) url = 'https://' + url;
      steps.push({ action: ACTION_TYPES.OPEN_URL, app: 'Browser', params: { url } });
      return steps;
    }
  }

  // ── Fallback: Default Google Search & User Assist ──────────────────
  steps.push({
    action: ACTION_TYPES.SEARCH_GOOGLE,
    app: 'Google',
    params: { query: command }
  });
  return steps;
}

// ─── Execution Pipeline with Smart LLM & Token Tracking ───────────────────────

/**
 * Full agent execution:
 * 1. Checks plugin health
 * 2. Pre-processes user prompts through Gemini/LLM to generate rich payloads
 * 3. Injects Zulora Pearl or Azure templates if requested
 * 4. Tracks token metrics
 * 5. Executes actions via extension bridge
 */
export async function executeCommand(command, onLog, currentUser = null) {
  const connected = await checkExtensionConnected();
  if (!connected) {
    return { ok: false, success: false, error: 'Extension not connected. Please install the Zulora Computer Plugin.' };
  }

  const steps = parseCommandToSteps(command);
  if (!steps.length) {
    return { ok: false, success: false, error: 'Could not parse command into executable steps.' };
  }

  let totalTokensUsed = 0;
  let templateUsed = null;

  // Process LLM generation for steps that need rich payloads
  for (const step of steps) {
    if (step.needsLlm && step.params?.rawPrompt) {
      if (onLog) {
        onLog({
          index: 1,
          label: `✨ AI Generating payload via Gemini (${step.llmType})…`,
          status: 'running',
          timestamp: Date.now()
        });
      }

      const generated = await generateTaskPayload(step.params.rawPrompt, step.llmType, {
        currentUser,
        to: step.params.to,
        subject: step.params.subject
      });

      totalTokensUsed += generated.tokens || 0;
      templateUsed = generated.template || templateUsed;

      if (step.action === ACTION_TYPES.GMAIL_COMPOSE) {
        step.params.body = generated.text;
        step.params.bodyHtml = generated.html;
        step.params.template = generated.template || step.params.template;
      } else if (step.action === ACTION_TYPES.WHATSAPP_SEND) {
        step.params.message = generated.text;
      } else if (step.action === ACTION_TYPES.EXPORT_CODE) {
        step.params.code = generated.text;
      }

      if (onLog) {
        onLog({
          index: 1,
          label: `✨ Generated payload (${generated.tokens} tokens)`,
          status: 'done',
          timestamp: Date.now()
        });
      }
    }
  }

  if (onLog) {
    onLog({
      index: 0,
      label: `Parsed ${steps.length} automated steps for execution`,
      status: 'done',
      timestamp: Date.now()
    });
  }

  const result = await runTask(steps);
  return {
    ...result,
    steps,
    tokensUsed: totalTokensUsed,
    templateUsed
  };
}

export default {
  checkExtensionConnected,
  runTask,
  pauseTask,
  resumeTask,
  cancelTask,
  getTaskStatus,
  parseCommandToSteps,
  generateTaskPayload,
  renderEmailTemplate,
  executeCommand,
  onStatusUpdate,
  ACTION_TYPES,
  TEMPLATES
};
