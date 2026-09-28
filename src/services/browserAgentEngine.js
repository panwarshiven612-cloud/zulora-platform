/**
 * Zulora AI — Browser Agent Engine
 * Parses natural language commands into structured JSON execution steps
 * and communicates with the Zulora Computer Plugin Chrome extension.
 */

// ─── Extension ID ─────────────────────────────────────────────────────────────
// Replace with your published extension ID after uploading to Chrome Web Store.
// During development, find this at chrome://extensions after loading unpacked.
const EXTENSION_ID = 'emimeingkoocmgljpjkpdnlnbkpkfbff';

// ─── Action type constants ────────────────────────────────────────────────────
export const ACTION_TYPES = {
  OPEN_URL:       'open_url',
  SWITCH_TAB:     'switch_tab',
  CLOSE_TAB:      'close_tab',
  SEARCH_GOOGLE:  'search_google',
  TYPE_TEXT:      'type_text',
  CLICK_ELEMENT:  'click_element',
  EXTRACT:        'extract_content',
  SEND_EMAIL:     'send_email',
  DOWNLOAD_FILE:  'download_file',
  WAIT:           'wait',
  NOTIFY_USER:    'notify_user',
};

// ─── Status ───────────────────────────────────────────────────────────────────
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

// ─── Extension Bridge with Retry Mechanism ───────────────────────────────────

/**
 * Check if the Zulora Chrome Extension is installed and responding.
 * @returns {Promise<boolean>}
 */
export async function checkExtensionConnected() {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-zulora-plugin-active') === 'true') {
    return true;
  }
  return false;
}

/**
 * Send a message across the extension DOM bridge with robust retry mechanism.
 * Attempts up to maxAttempts (default 3) with a 1.5s delay between attempts
 * before falling back to error state.
 *
 * @param {object} detail - Payload to send in ZULORA_EXECUTE_AGENT_TASK
 * @param {number} maxAttempts - Number of attempts before failure (default 3)
 * @param {number} delayMs - Delay between attempts in milliseconds (default 1500)
 * @param {number} timeoutMs - Timeout per attempt in milliseconds (default 2500)
 * @returns {Promise<{ok: boolean, success?: boolean, error?: string, [key: string]: any}>}
 */
async function sendBridgeMessageWithRetry(detail, maxAttempts = 3, delayMs = 1500, timeoutMs = 2500) {
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
        resolve(null); // Timed out on this attempt
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

/**
 * Send a task queue to the extension and start execution.
 * @param {Array<{action: string, params: object}>} steps
 * @returns {Promise<{ok: boolean, success?: boolean, queued?: number, error?: string}>}
 */
export async function runTask(steps) {
  if (!steps?.length) {
    return { ok: false, success: false, error: 'No steps provided' };
  }
  return sendBridgeMessageWithRetry({ type: 'ZULORA_RUN_TASK', steps }, 3, 1500, 2500);
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

// Listen for status updates posted by the content script
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'ZULORA_EXTENSION') {
      _emit(event.data);
    }
  });
}

// ─── Natural Language → Steps Parser ─────────────────────────────────────────

/**
 * Parse a natural language command into structured execution steps.
 * Uses a rule-based engine for common patterns. Complex tasks should
 * be sent through the Gemini API (see aiRouter.js) for full parsing.
 *
 * @param {string} command - Natural language instruction
 * @returns {Array<{action: string, params: object}>}
 */
export function parseCommandToSteps(command) {
  const cmd = command.toLowerCase().trim();
  const steps = [];

  // ── Gmail / Email ─────────────────────────────────────────────────
  if (cmd.includes('send email') || cmd.includes('draft email') || cmd.includes('compose email')) {
    const toMatch    = command.match(/to\s+([\w._%+-]+@[\w.-]+\.[a-z]{2,})/i);
    const subjMatch  = command.match(/subject[:\s]+["']?(.+?)["']?(?:\s+body|\s+with|\s+saying|$)/i);
    const bodyMatch  = command.match(/(?:body|saying|message)[:\s]+["']?(.+?)["']?$/i);
    steps.push({
      action: ACTION_TYPES.SEND_EMAIL,
      params: {
        to:      toMatch?.[1]  || '',
        subject: subjMatch?.[1] || 'Message from Zulora AI',
        body:    bodyMatch?.[1] || ''
      }
    });
    return steps;
  }

  // ── Google Search ─────────────────────────────────────────────────
  if (cmd.includes('search') || cmd.includes('google')) {
    const qMatch = command.match(/(?:search|google)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+on google|$)/i);
    if (qMatch) {
      steps.push({ action: ACTION_TYPES.SEARCH_GOOGLE, params: { query: qMatch[1] } });
      return steps;
    }
  }

  // ── Open URL ──────────────────────────────────────────────────────
  if (cmd.includes('open') || cmd.includes('go to') || cmd.includes('navigate to')) {
    const urlMatch = command.match(/(?:open|go to|navigate to|visit)\s+(https?:\/\/\S+|[\w-]+\.[\w.-]+\S*)/i);
    if (urlMatch) {
      let url = urlMatch[1];
      if (!url.startsWith('http')) url = 'https://' + url;
      steps.push({ action: ACTION_TYPES.OPEN_URL, params: { url } });
      return steps;
    }
  }

  // ── PDF / File Conversion ─────────────────────────────────────────
  if (cmd.includes('convert') && (cmd.includes('pdf') || cmd.includes('doc') || cmd.includes('image'))) {
    const fromFormat = cmd.includes('pdf to') ? 'PDF' : cmd.includes('doc') ? 'DOC' : 'file';
    const toFormat   = cmd.includes('to doc') ? 'DOC' : cmd.includes('to pdf') ? 'PDF' : 'format';
    steps.push(
      { action: ACTION_TYPES.SEARCH_GOOGLE, params: { query: `${fromFormat} to ${toFormat} converter online free` } },
      { action: ACTION_TYPES.WAIT, params: { ms: 2000 } },
      { action: ACTION_TYPES.NOTIFY_USER, params: { message: `Online converter found. Please upload your ${fromFormat} file and click Resume when done.` } }
    );
    return steps;
  }

  // ── Download ─────────────────────────────────────────────────────
  if (cmd.includes('download')) {
    const urlMatch = command.match(/(?:download)\s+(https?:\/\/\S+)/i);
    if (urlMatch) {
      steps.push({ action: ACTION_TYPES.DOWNLOAD_FILE, params: { url: urlMatch[1] } });
      return steps;
    }
  }

  // ── YouTube ───────────────────────────────────────────────────────
  if (cmd.includes('youtube') || cmd.includes('watch')) {
    const qMatch = command.match(/(?:youtube|watch|play)\s+["']?(.+?)["']?(?:\s+on youtube|$)/i);
    const query  = qMatch?.[1] || command;
    steps.push({
      action: ACTION_TYPES.OPEN_URL,
      params: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }
    });
    return steps;
  }

  // ── Fallback: open Google with the whole command ──────────────────
  steps.push(
    { action: ACTION_TYPES.SEARCH_GOOGLE, params: { query: command } },
    { action: ACTION_TYPES.NOTIFY_USER, params: { message: 'Search ready. Review and click Resume to continue.' } }
  );
  return steps;
}

/**
 * Full pipeline: parse command → send to extension → return run result.
 * @param {string} command
 * @param {function} onLog - callback(log entry) for real-time updates
 * @returns {Promise<{ok: boolean, success?: boolean, steps: Array, error?: string}>}
 */
export async function executeCommand(command, onLog) {
  const connected = await checkExtensionConnected();
  if (!connected) {
    return { ok: false, success: false, error: 'Extension not connected. Please install the Zulora Computer Plugin.' };
  }

  const steps = parseCommandToSteps(command);
  if (!steps.length) {
    return { ok: false, success: false, error: 'Could not parse command into executable steps.' };
  }

  if (onLog) {
    onLog({ index: 0, label: `Parsed ${steps.length} steps from your command`, status: 'done', timestamp: Date.now() });
  }

  const result = await runTask(steps);
  return { ...result, steps };
}

export default {
  checkExtensionConnected,
  runTask,
  pauseTask,
  resumeTask,
  cancelTask,
  getTaskStatus,
  parseCommandToSteps,
  executeCommand,
  onStatusUpdate,
  ACTION_TYPES
};
