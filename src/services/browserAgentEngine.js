/**
 * Zulora AI — Browser Agent Engine
 * Parses natural language commands into structured JSON execution steps
 * and communicates with the Zulora Computer Plugin Chrome extension.
 */

// ─── Extension ID ─────────────────────────────────────────────────────────────
// Replace with your published extension ID after uploading to Chrome Web Store.
// During development, find this at chrome://extensions after loading unpacked.
const EXTENSION_ID = 'YOUR_EXTENSION_ID_HERE'; // e.g. "abcdefghijklmnopqrstuvwxyz012345"

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

// ─── Extension Bridge ─────────────────────────────────────────────────────────

/**
 * Check if the Zulora Chrome Extension is installed and responding.
 * @returns {Promise<boolean>}
 */
export async function checkExtensionConnected() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'ZULORA_PING' }, (response) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(response?.ok === true);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Send a task queue to the extension and start execution.
 * @param {Array<{action: string, params: object}>} steps
 * @returns {Promise<{ok: boolean, queued?: number, error?: string}>}
 */
export async function runTask(steps) {
  return new Promise((resolve) => {
    if (!steps?.length) { resolve({ ok: false, error: 'No steps provided' }); return; }
    try {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { type: 'ZULORA_RUN_TASK', steps },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'No response from extension' });
        }
      );
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

export async function pauseTask() {
  return _sendControl('ZULORA_PAUSE');
}

export async function resumeTask() {
  return _sendControl('ZULORA_RESUME');
}

export async function cancelTask() {
  return _sendControl('ZULORA_CANCEL');
}

export async function getTaskStatus() {
  return _sendControl('ZULORA_STATUS');
}

function _sendControl(type) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type }, (response) => {
        if (chrome.runtime.lastError) { resolve({ ok: false }); return; }
        resolve(response || { ok: false });
      });
    } catch { resolve({ ok: false }); }
  });
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
 * @returns {Promise<{ok: boolean, steps: Array, error?: string}>}
 */
export async function executeCommand(command, onLog) {
  const connected = await checkExtensionConnected();
  if (!connected) {
    return { ok: false, error: 'Extension not connected. Please install the Zulora Computer Plugin.' };
  }

  const steps = parseCommandToSteps(command);
  if (!steps.length) {
    return { ok: false, error: 'Could not parse command into executable steps.' };
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
