import { onAuthStateChanged } from 'firebase/auth';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const GOOGLE_CLIENT_ID = String(
  import.meta.env?.VITE_GOOGLE_CLIENT_ID
  || '791256936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com'
).trim();
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_STORAGE_KEY = 'zulora_oauth_token';
const TOKEN_DB_NAME = 'zulora-connector-sessions';
const TOKEN_DB_VERSION = 1;
const CONNECTOR_STATE_KEY = 'zulora_connector_sessions';
const sessionTokens = new Map();
let identityScriptPromise;
let tokenDbPromise;
let tokenWriteQueue = Promise.resolve();
const silentRefreshes = new Map();

const OAUTH_PERMISSION_REQUIRED = 'OAuth Permission Required: Please re-connect your Gmail/Calendar account';

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

const encodeBase64UrlUtf8 = value => encodeBase64Utf8(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function wrapMimeBase64(value) {
  return String(value).match(/.{1,76}/g)?.join('\r\n') || '';
}

function sanitizeEmailContent(value) {
  const raw = String(value || '').trim()
    .replace(/^```html\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const containsHtml = /<\/?(?:html|head|body|a|p|div|span|h[1-6]|strong|b|em|i|u|ul|ol|li|br|hr|table|thead|tbody|tr|td|th|img|blockquote|pre|code|small|header|footer|section)\b/i.test(raw);
  if (!containsHtml) {
    return escapeHtml(raw)
      .replace(/https?:\/\/[^\s<]+/gi, url => {
        const cleanUrl = url.replace(/[),.!?;:]+$/g, '');
        const trailing = url.slice(cleanUrl.length);
        return '<a href="' + cleanUrl + '">' + cleanUrl + '</a>' + trailing;
      })
      .replace(/\r?\n/g, '<br>');
  }

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(raw, 'text/html');
    document.querySelectorAll('script,style,iframe,object,embed,svg,math,video,audio,source,canvas,form,input,button,meta,link,base').forEach(node => node.remove());
    document.body.querySelectorAll('*').forEach(node => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        const content = attribute.value.trim();
        if (name.startsWith('on') || name === 'srcdoc') {
          node.removeAttribute(attribute.name);
        } else if (['href', 'src', 'action', 'xlink:href'].includes(name)
          && content && !/^(?:https?:|mailto:|tel:|cid:|#)/i.test(content)) {
          node.removeAttribute(attribute.name);
        } else if (name === 'style' && /(?:expression\s*\(|url\s*\(|-moz-binding|behavior\s*:)/i.test(content)) {
          node.removeAttribute(attribute.name);
        }
      }
    });
    return document.body.innerHTML;
  }

  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|video|audio|canvas|form|input|button|meta|link|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\s*(?:script|style|iframe|object|embed|svg|math|video|audio|source|canvas|form|input|button|meta|link|base)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|action)\s*=\s*(["'])\s*(?:javascript|data|vbscript):[\s\S]*?\2/gi, ' $1="#"')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '');
}

function buildHtmlMimeMessage({ to, subject, body }) {
  const contentHtml = sanitizeEmailContent(body)
    .replace(/<a\b([^>]*)>/gi, (_match, attributes) => {
      const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '#';
      const safeHref = escapeHtml(href.replace(/&amp;/gi, '&'));
      const withoutStyle = attributes
        .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
        .replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
      return '<a' + withoutStyle + ' href="' + safeHref + '" style="display:inline-block;background-color:#0879c9;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:20px;padding:12px 20px;border-radius:8px;margin:8px 0">';
    });
  const plainText = contentHtml
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => label.replace(/<[^>]*>/g, '') + ' (' + href + ')')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim() + '\n\nSent via Zulora AI Workspace';
  const html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>'
    + '<body style="margin:0;padding:0;background-color:#0b1221;color:#16233a;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#0b1221;border-collapse:collapse;"><tr><td align="center" style="padding:32px 14px;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #dbe6f1;border-radius:18px;overflow:hidden;border-collapse:separate;border-spacing:0;">'
    + '<tr><td style="height:5px;background-color:#168bd2;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '<tr><td style="padding:25px 30px 10px;background-color:#ffffff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#0879c9;">Zulora AI Workspace</div></td></tr>'
    + '<tr><td style="padding:14px 30px 30px;background-color:#ffffff;color:#25344c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;overflow-wrap:anywhere;">' + contentHtml + '</td></tr>'
    + '<tr><td style="padding:18px 30px 22px;background-color:#f4f8fc;border-top:1px solid #e3edf5;color:#718096;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;">Sent via <a href="https://zulora.in" style="color:#0879c9;text-decoration:none;font-weight:700;">Zulora AI Workspace</a></td></tr>'
    + '</table><div style="max-width:640px;padding:14px 8px 0;color:#8fa1b8;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:center;">A thoughtful note, delivered with care.</div>'
    + '</td></tr></table></body></html>';
  const boundary = `zulora_${crypto.randomUUID().replaceAll('-', '')}`;
  const encodedSubject = `=?UTF-8?B?${encodeBase64Utf8(String(subject || '').replace(/[\r\n]+/g, ' ').trim())}?=`;
  const mime = [
    `To: ${String(to || '').replace(/[\r\n]+/g, '').trim()}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapMimeBase64(encodeBase64Utf8(plainText)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapMimeBase64(encodeBase64Utf8(html)),
    `--${boundary}--`,
    ''
  ].join('\r\n');
  return encodeBase64UrlUtf8(mime);
}

function readStoredConnectorStates() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CONNECTOR_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function writeStoredConnectorState(providerId, state) {
  const states = readStoredConnectorStates();
  if (state) states[providerId] = state;
  else delete states[providerId];
  try { localStorage.setItem(CONNECTOR_STATE_KEY, JSON.stringify(states)); } catch { /* State is also represented by persisted OAuth tokens. */ }
}

function readStoredTokens() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && parsed) return { accessToken: parsed, expiresAt: Date.now() + 5 * 60_000 };
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    try {
      const raw = localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
      return raw ? { accessToken: raw, expiresAt: Date.now() + 5 * 60_000 } : {};
    } catch { return {}; }
  }
}

function openTokenDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!tokenDbPromise) tokenDbPromise = new Promise(resolve => {
    const request = indexedDB.open(TOKEN_DB_NAME, TOKEN_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return tokenDbPromise;
}

function persistTokensToIndexedDb(tokens) {
  tokenWriteQueue = tokenWriteQueue.then(async () => {
    const db = await openTokenDb();
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      store.clear();
      for (const [provider, token] of Object.entries(tokens)) store.put(token, provider);
      transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
    });
  }).catch(() => {});
  return tokenWriteQueue;
}

function validTokenRecord(value, providerId) {
  if (!value || typeof value !== 'object') return null;
  let expiresAt = Number(value.expiresAt || value.expiry_date || value.expires_at || value.expirationTime) || 0;
  if (expiresAt > 0 && expiresAt < 1_000_000_000_000) expiresAt *= 1000;
  const accessToken = String(value.accessToken || value.access_token || '');
  const uid = String(value.uid || auth.currentUser?.uid || '');
  if (!accessToken || !expiresAt || (auth.currentUser?.uid && uid && uid !== auth.currentUser.uid)) return null;
  return { accessToken, expiresAt, email: String(value.email || ''), uid, provider: providerId };
}

function writeStoredTokens(removeProviders = []) {
  if (typeof window === 'undefined') return;
  const tokens = { ...readStoredTokens() };
  for (const provider of removeProviders) delete tokens[provider];
  for (const [provider, token] of sessionTokens.entries()) tokens[provider] = { ...token, provider };
  for (const [provider, value] of Object.entries(tokens)) {
    if (provider === 'accessToken') continue;
    if (!validTokenRecord(value, provider)) delete tokens[provider];
  }
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch { /* IndexedDB and the in-memory session remain available where possible. */ }
  persistTokensToIndexedDb(tokens);
}

function restoreStoredToken(providerId) {
  const stored = readStoredTokens();
  const candidate = stored[providerId] || (stored.provider === providerId ? stored : null);
  const accessToken = typeof candidate === 'string'
    ? candidate
    : String(candidate?.accessToken || candidate?.access_token || '');
  let expiresAt = Number(candidate?.expiresAt || candidate?.expiry_date || candidate?.expires_at || candidate?.expirationTime) || 0;
  if (expiresAt > 0 && expiresAt < 1_000_000_000_000) expiresAt *= 1000;
  if (!expiresAt && candidate?.expires_in && candidate?.storedAt) expiresAt = Number(candidate.storedAt) + Number(candidate.expires_in) * 1000;
  if (!expiresAt && accessToken) expiresAt = Date.now() + 5 * 60_000;
  const uid = String(candidate?.uid || auth.currentUser?.uid || '');
  if (!accessToken || !expiresAt || (auth.currentUser?.uid && uid && uid !== auth.currentUser.uid)) {
    return null;
  }
  const token = { accessToken, expiresAt, email: String(candidate?.email || ''), uid };
  sessionTokens.set(providerId, token);
  return token;
}

export const CONNECTOR_CONFIG = Object.freeze({
  gmail: {
    id: 'gmail', name: 'Gmail', icon: 'mail',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'openid', 'email'
    ],
    description: 'Read inbox messages and send or create drafts.'
  },
  sheets: {
    id: 'sheets', name: 'Google Sheets', icon: 'table',
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'openid', 'email'
    ],
    description: 'Read and update spreadsheets; list spreadsheet names for quick access.'
  },
  calendar: {
    id: 'calendar', name: 'Google Calendar', icon: 'calendar',
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'],
    description: 'View and schedule calendar events.'
  },
  forms: {
    id: 'forms', name: 'Google Forms', icon: 'form',
    scopes: ['https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/forms.body.readonly', 'https://www.googleapis.com/auth/forms.responses.readonly', 'openid', 'email'],
    description: 'Read and create Google Forms and their responses.'
  },
  drive: {
    id: 'drive', name: 'Google Drive', icon: 'drive',
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
    description: 'Find, download, and manage files you have granted access to.'
  }
});

function connectorDoc(uid, provider) {
  return doc(db, 'users', uid, 'connectors', provider);
}

function emitConnectorChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zulora-connectors-changed'));
}

function loadIdentityServices() {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('Google connectors need VITE_GOOGLE_CLIENT_ID in the app environment.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (!identityScriptPromise) {
    identityScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
      const script = existing || document.createElement('script');
      const cleanup = () => {
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
      };
      const onLoad = () => {
        cleanup();
        if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2);
        else reject(new Error('Google Identity Services loaded without OAuth support.'));
      };
      const onError = () => {
        cleanup();
        reject(new Error('Could not load Google Identity Services. Check your connection and try again.'));
      };
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      if (!existing) {
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      if (existing && window.google?.accounts?.oauth2) onLoad();
    }).catch(error => {
      identityScriptPromise = null;
      throw error;
    });
  }
  return identityScriptPromise;
}

const tokenRequest = (oauth, scopes, prompt) => new Promise((resolve, reject) => {
  const client = oauth.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: scopes.join(' '),
    prompt,
    callback: response => {
      if (response?.error) reject(new Error(response.error_description || response.error));
      else if (response?.access_token) resolve(response);
      else reject(new Error('Google did not return an access token.'));
    },
    error_callback: error => reject(new Error(error?.message || 'Google authorization was cancelled.'))
  });
  client.requestAccessToken({ prompt });
});

async function silentlyRefresh(providerId, uid = auth.currentUser?.uid || '') {
  if (silentRefreshes.has(providerId)) return silentRefreshes.get(providerId);
  const refreshPromise = (async () => {
    const provider = CONNECTOR_CONFIG[providerId];
    if (!provider || !uid || (auth.currentUser?.uid && auth.currentUser.uid !== uid)) return null;
    const oauth = await loadIdentityServices();
    try {
      const token = await tokenRequest(oauth, provider.scopes, '');
      const email = await readGoogleAccount(token.access_token).catch(() => '');
      sessionTokens.set(providerId, {
        accessToken: token.access_token,
        expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
        email,
        uid
      });
      writeStoredTokens();
      emitConnectorChange();
      return sessionTokens.get(providerId);
    } catch (error) {
      // A silent request is deliberately non-interactive. Keep the connector
      // session record so the UI can offer an explicit reconnect action.
      if (!/interaction_required|login_required|consent_required|immediate_failed/i.test(String(error?.message || ''))) {
        console.info(`Silent ${provider.name} token renewal was unavailable.`, error.message);
      }
      return null;
    }
  })().finally(() => silentRefreshes.delete(providerId));
  silentRefreshes.set(providerId, refreshPromise);
  return refreshPromise;
}

async function readGoogleAccount(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return '';
  const account = await response.json();
  return String(account.email || '');
}

function decodeGmailBody(data) {
  if (!data) return '';
  const base64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}

function getGmailText(payload) {
  const parts = [];
  const visit = part => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) parts.push(decodeGmailBody(part.body.data));
    for (const nested of part.parts || []) visit(nested);
  };
  visit(payload);
  if (parts.length) return parts.join('\n').replace(/\s+/g, ' ').trim().slice(0, 12_000);
  const htmlParts = [];
  const visitHtml = part => {
    if (!part) return;
    if (part.mimeType === 'text/html' && part.body?.data) htmlParts.push(decodeGmailBody(part.body.data));
    for (const nested of part.parts || []) visitHtml(nested);
  };
  visitHtml(payload);
  return htmlParts.join('\n').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim().slice(0, 12_000);
}

export const connectorManager = {
  clientConfigured: Boolean(GOOGLE_CLIENT_ID),
  prepareOAuth: loadIdentityServices,

  async restoreSession() {
    const stored = readStoredTokens();
    for (const providerId of Object.keys(CONNECTOR_CONFIG)) {
      const localToken = validTokenRecord(stored[providerId], providerId);
      if (localToken) sessionTokens.set(providerId, localToken);
    }
    const db = await openTokenDb();
    if (db) {
      const idbTokens = await new Promise(resolve => {
        const store = db.transaction('sessions', 'readonly').objectStore('sessions');
        const valuesRequest = store.getAll();
        const keysRequest = store.getAllKeys();
        let values;
        let keys;
        const finish = () => {
          if (values && keys) resolve(values.map((value, index) => ({ ...value, provider: value.provider || keys[index] })));
        };
        valuesRequest.onsuccess = () => { values = valuesRequest.result || []; finish(); };
        keysRequest.onsuccess = () => { keys = keysRequest.result || []; finish(); };
        valuesRequest.onerror = keysRequest.onerror = () => resolve([]);
      });
      for (const value of idbTokens) {
        const record = validTokenRecord(value, value?.provider);
        if (!record || !CONNECTOR_CONFIG[record.provider]) continue;
        const current = sessionTokens.get(record.provider);
        if (!current || record.expiresAt > current.expiresAt) sessionTokens.set(record.provider, record);
      }
      writeStoredTokens();
    }
    emitConnectorChange();
    const uid = auth.currentUser?.uid;
    if (uid) {
      for (const providerId of Object.keys(CONNECTOR_CONFIG)) {
        const token = sessionTokens.get(providerId);
        if (token?.uid === uid && token.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
          silentlyRefresh(providerId, uid).catch(() => {});
        }
      }
    }
    return this.getActiveGoogleProviders();
  },

  async connect(providerId, uid) {
    const provider = CONNECTOR_CONFIG[providerId];
    if (!provider) throw new Error(`Unknown connector: ${providerId}`);
    if (!uid) throw new Error('Sign in to Zulora before connecting Google services.');
    const oauth = await loadIdentityServices();
    const token = await tokenRequest(oauth, provider.scopes, 'consent');
    const email = await readGoogleAccount(token.access_token).catch(() => '');
    const connection = {
      provider: providerId,
      email,
      scopes: provider.scopes,
      connectedAt: Date.now(),
      updatedAt: Date.now()
    };
    writeStoredConnectorState(providerId, connection);
    sessionTokens.set(providerId, {
      accessToken: token.access_token,
      expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
      email,
      uid,
      provider: providerId
    });
    writeStoredTokens();
    // Persist the short-lived session access token in localStorage and
    // IndexedDB for reload recovery. GIS does not issue refresh tokens from
    // its browser token flow; long-lived refresh credentials stay server-side.
    emitConnectorChange();
    let metadataSaved = true;
    try { await setDoc(connectorDoc(uid, providerId), connection, { merge: true }); }
    catch (error) {
      metadataSaved = false;
      console.warn('Google connector is available for this session, but its status could not be saved:', error.message);
    }
    return { ...connection, connected: true, metadataSaved };
  },

  async disconnect(providerId, uid) {
    // Forget this connector locally without revoking the whole Google OAuth
    // grant, which may also contain another connected Workspace service.
    sessionTokens.delete(providerId);
    writeStoredTokens([providerId]);
    writeStoredConnectorState(providerId, null);
    if (uid) await deleteDoc(connectorDoc(uid, providerId)).catch(() => {});
    emitConnectorChange();
  },

  async getAccessToken(providerId) {
    let token = sessionTokens.get(providerId) || restoreStoredToken(providerId);
    if (token && token.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      token = await silentlyRefresh(providerId, token.uid || auth.currentUser?.uid || '');
    }
    if (!token || token.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS || (auth.currentUser?.uid && token.uid && token.uid !== auth.currentUser.uid)) {
      sessionTokens.delete(providerId);
      writeStoredTokens([providerId]);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zulora-connector-reauth-required', { detail: { provider: providerId } }));
      const error = new Error(`${OAUTH_PERMISSION_REQUIRED}. Open Connectors to authorize ${CONNECTOR_CONFIG[providerId]?.name || providerId}.`);
      error.code = 'OAUTH_REQUIRED';
      throw error;
    }
    return token.accessToken;
  },

  async apiFetch(providerId, url, options = {}) {
    const { expectedStatus, ...requestOptions } = options;
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const retryableMethod = ['GET', 'HEAD', 'DELETE'].includes(method);
    let refreshedAfter401 = false;
    let transientRetries = 0;
    while (true) {
      const accessToken = await this.getAccessToken(providerId);
      let response;
      if (import.meta.env?.DEV) {
        response = await fetch(url, {
          ...requestOptions,
          headers: {
            ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
            ...requestOptions.headers,
            Authorization: `Bearer ${accessToken}`
          }
        });
      } else {
        const user = auth.currentUser;
        if (!user?.getIdToken) throw new Error('Sign in again to use Google connectors.');
        const firebaseToken = await user.getIdToken();
        response = await fetch('/api/google-connector', {
          method: 'POST',
          signal: requestOptions.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firebaseToken}` },
          body: JSON.stringify({
            provider: providerId,
            url,
            accessToken,
            request: { method, body: requestOptions.body || null }
          })
        });
      }
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (data?.code === 'AUTH_REQUIRED') {
        throw new Error(data.error?.message || 'Sign in again to use Google connectors.');
      }
      if (response.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        const current = sessionTokens.get(providerId);
        const renewed = await silentlyRefresh(providerId, current?.uid || auth.currentUser?.uid || '');
        if (renewed) continue;
      }
      if (response.status === 401 || response.status === 403) {
        sessionTokens.delete(providerId);
        writeStoredTokens([providerId]);
        emitConnectorChange();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('zulora-connector-reauth-required', { detail: { provider: providerId } }));
        }
      }
      if ((response.status === 429 || response.status >= 500) && transientRetries < 1 && (retryableMethod || response.status === 429)) {
        transientRetries += 1;
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = retryAfter ? Math.min(1500, retryAfter * 1000) : 250 * transientRetries;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        const reason = data?.error?.message || response.statusText || 'Google API request failed';
        // MODULE 1: Throw explicit OAuth error for 401/403 so caller can prompt reconnect
        if (response.status === 401 || response.status === 403) {
          const oauthErr = new Error(`${OAUTH_PERMISSION_REQUIRED}. Your ${CONNECTOR_CONFIG[providerId]?.name || providerId} session has expired or lacks permission.`);
          oauthErr.code = 'OAUTH_REQUIRED';
          oauthErr.status = response.status;
          throw oauthErr;
        }
        throw new Error(`${CONNECTOR_CONFIG[providerId]?.name || providerId}: ${reason} (HTTP ${response.status})`);
      }
      if (expectedStatus && response.status !== expectedStatus) {
        throw new Error(`${CONNECTOR_CONFIG[providerId]?.name || providerId} returned HTTP ${response.status}; expected HTTP ${expectedStatus}.`);
      }
      return data;
    }
  },

  getCachedStatuses(uid) {
    const states = readStoredConnectorStates();
    return Object.fromEntries(Object.keys(CONNECTOR_CONFIG).map(provider => {
      const session = sessionTokens.get(provider) || restoreStoredToken(provider);
      const connected = Boolean(session && session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
        && (!uid || !session.uid || session.uid === uid));
      return [provider, {
        ...CONNECTOR_CONFIG[provider],
        ...(states[provider] || {}),
        connected,
        needsReconnect: Boolean(states[provider] && !connected),
        email: session?.email || states[provider]?.email || ''
      }];
    }));
  },

  async getStatuses(uid) {
    const entries = await Promise.all(Object.keys(CONNECTOR_CONFIG).map(async provider => {
      const session = sessionTokens.get(provider) || restoreStoredToken(provider);
      let metadata = null;
      if (uid) {
        try {
          const snapshot = await getDoc(connectorDoc(uid, provider));
          if (snapshot.exists()) {
            metadata = snapshot.data();
            writeStoredConnectorState(provider, metadata);
          }
        } catch { /* Metadata is optional; live OAuth state is authoritative. */ }
      }
      const connected = Boolean(session && session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
        && (!uid || !session.uid || session.uid === uid));
      if (session && !connected && uid && session.uid === uid) silentlyRefresh(provider, uid).catch(() => {});
      return [provider, {
        ...CONNECTOR_CONFIG[provider],
        ...metadata,
        connected,
        needsReconnect: Boolean(metadata && !connected),
        email: session?.email || metadata?.email || ''
      }];
    }));
    return Object.fromEntries(entries);
  },

  getActiveConnectorContext(driveConnected = false) {
    const active = this.getActiveGoogleProviders().map(provider => CONNECTOR_CONFIG[provider].name);
    if (this.getActiveGoogleProviders().includes('drive')) active.push('Google Drive');
    if (driveConnected) active.push('Zulora Drive');
    return active.length
      ? `Available native connectors for this signed-in session: ${active.join(', ')}. When a request targets one of these services, Zulora can use its direct API connector without opening tabs or using the Computer Plugin.`
      : 'No native connectors are active in this session. Ask the user to connect the requested service from the Connectors hub before accessing its data.';
  },

  getActiveGoogleProviders() {
    return Object.keys(CONNECTOR_CONFIG).filter(provider => {
      const token = sessionTokens.get(provider) || restoreStoredToken(provider);
      return Boolean(token && token.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
        && (!auth.currentUser?.uid || !token.uid || token.uid === auth.currentUser.uid));
    });
  },

  hasActiveGoogleConnectors() {
    return this.getActiveGoogleProviders().length > 0;
  },

  async sendGmailMessage({ to, subject, body }) {
    const raw = buildHtmlMimeMessage({ to, subject, body });
    const res = await this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', body: JSON.stringify({ raw }), expectedStatus: 200
    });
    if (!res?.id || !res?.threadId) {
      throw new Error('Gmail API did not confirm delivery with both a message ID and thread ID. The email is not reported as sent.');
    }
    return { ...res, success: true, to, subject, delivered: true, messageId: res.id, threadId: res.threadId, verified: true, timestamp: Date.now() };
  },

  async sendRichEmail({ to, subject, body }) {
    return this.sendGmailMessage({ to, subject, body });
  },

  async createGmailDraft({ to, subject, body }) {
    const raw = buildHtmlMimeMessage({ to, subject, body });
    const res = await this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST', body: JSON.stringify({ message: { raw } })
    });
    if (!res?.id || !res?.message?.id) throw new Error('Gmail API did not return a valid draft ID.');
    return { ...res, success: true, isDraft: true, to, subject, verified: true };
  },

  async replyAndDraft({ to, subject, body, thread_id = null, is_draft = false }) {
    if (is_draft) {
      return this.createGmailDraft({ to, subject, body });
    }
    const raw = buildHtmlMimeMessage({ to, subject, body });
    const payload = { raw };
    if (thread_id) payload.threadId = thread_id;
    const res = await this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', body: JSON.stringify(payload), expectedStatus: 200
    });
    if (!res?.id || !res?.threadId) {
      throw new Error('Gmail API did not confirm delivery with both a message ID and thread ID. The reply is not reported as sent.');
    }
    return { ...res, success: true, replied: Boolean(thread_id), to, subject, messageId: res.id, threadId: res.threadId, verified: true };
  },

  async readEmails({ query = 'in:inbox', max_results = 5 } = {}) {
    const params = new URLSearchParams({ q: String(query || 'in:inbox'), maxResults: String(Math.min(20, Math.max(1, Number(max_results) || 5))) });
    const list = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
    if (!list || typeof list !== 'object' || (list.messages !== undefined && !Array.isArray(list.messages))
      || (!Array.isArray(list.messages) && !Number.isFinite(Number(list.resultSizeEstimate)))) {
      throw new Error('Gmail returned an invalid inbox response. No inbox result is reported.');
    }
    const messages = await Promise.all((list.messages || []).map(async item => {
      if (!item?.id) throw new Error('Gmail returned a message without an ID. No inbox result is reported.');
      const message = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`);
      if (!message?.id || !message?.threadId) throw new Error('Gmail returned an invalid message record. No inbox result is reported.');
      const headers = message.payload?.headers || [];
      const getHeader = name => headers.find(header => header.name?.toLowerCase() === name)?.value || '';
      return { id: message.id, from: getHeader('from'), subject: getHeader('subject'), date: getHeader('date'), snippet: message.snippet || '', body: getGmailText(message.payload) || message.snippet || '' };
    }));
    return messages;
  },

  async analyzeInbox({ query = 'in:inbox', max_results = 10 } = {}) {
    const emails = await this.readEmails({ query, max_results });
    const now = new Date();
    const todayStr = now.toDateString();
    let todayCount = 0;
    const senders = new Map();
    for (const email of emails) {
      if (email.date && new Date(email.date).toDateString() === todayStr) {
        todayCount++;
      }
      const sender = email.from || 'Unknown';
      senders.set(sender, (senders.get(sender) || 0) + 1);
    }
    return {
      totalAnalyzed: emails.length,
      todayCount,
      topSenders: Array.from(senders.entries()).map(([sender, count]) => ({ sender, count })),
      emails: emails.map(e => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, preview: e.snippet }))
    };
  },

  async createCalendarEvent({ title, start_time, end_time, description = '' }) {
    const event = await this.apiFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST', body: JSON.stringify({ summary: title, description, start: { dateTime: start_time }, end: { dateTime: end_time } })
    });
    if (!event?.id) throw new Error('Google Calendar did not return an event ID. The event is not reported as created.');
    return { ...event, verified: true };
  },

  async scheduleEvents({ events = [], title, start_time, end_time, description = '' } = {}) {
    if (Array.isArray(events) && events.length > 0) {
      const created = [];
      for (const ev of events) {
        const res = await this.createCalendarEvent({
          title: ev.title || ev.summary,
          start_time: ev.start_time || ev.start,
          end_time: ev.end_time || ev.end,
          description: ev.description || ''
        });
        created.push(res);
      }
      return { success: true, count: created.length, events: created };
    }
    if (title && start_time && end_time) {
      const res = await this.createCalendarEvent({ title, start_time, end_time, description });
      return { success: true, count: 1, event: res };
    }
    throw new Error('Provide event details (title, start_time, end_time) or a list of events to schedule.');
  },

  async getCalendarEvents({ time_min, time_max } = {}) {
    const params = new URLSearchParams({ timeMin: time_min || new Date().toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
    if (time_max) params.set('timeMax', time_max);
    const result = await this.apiFetch('calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
    if (!result || typeof result !== 'object' || (result.items !== undefined && !Array.isArray(result.items))
      || (!Array.isArray(result.items) && result.kind !== 'calendar#events')) {
      throw new Error('Google Calendar returned an invalid event-list response. No schedule result is reported.');
    }
    return result.items || [];
  },

  async analyzeCalendar({ time_min, time_max } = {}) {
    const events = await this.getCalendarEvents({ time_min, time_max });
    return {
      totalEvents: events.length,
      timeWindow: { timeMin: time_min || 'now', timeMax: time_max || 'upcoming' },
      events: events.map(ev => ({
        id: ev.id,
        summary: ev.summary || '(no title)',
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date,
        location: ev.location || '',
        description: ev.description || ''
      }))
    };
  },

  async deleteCalendarEvent({ event_id }) {
    return this.apiFetch('calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event_id)}`, { method: 'DELETE' });
  },

  async appendSheetRow({ spreadsheet_id, range = 'Sheet1!A:Z', values = [] }) {
    const encodedRange = encodeURIComponent(range);
    return this.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values })
    });
  },

  async createSpreadsheet({ title }) {
    return this.apiFetch('sheets', 'https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', body: JSON.stringify({ properties: { title } })
    });
  },

  async searchGmailThreads({ query = 'in:inbox', max_results = 5 } = {}) {
    const params = new URLSearchParams({ q: String(query || 'in:inbox'), maxResults: String(Math.min(20, Math.max(1, Number(max_results) || 5))) });
    const listing = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`);
    return Promise.all((listing.threads || []).map(async item => {
      const thread = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(item.id)}?format=full`);
      const messages = (thread.messages || []).map(message => {
        const headers = message.payload?.headers || [];
        const getHeader = name => headers.find(header => header.name?.toLowerCase() === name)?.value || '';
        return { from: getHeader('from'), subject: getHeader('subject'), date: getHeader('date'), snippet: message.snippet || '', body: getGmailText(message.payload) || message.snippet || '' };
      });
      return { id: thread.id, historyId: thread.historyId, messages };
    }));
  },

  async listGoogleDriveFiles({ query = '', max_results = 20 } = {}) {
    const params = new URLSearchParams({
      pageSize: String(Math.min(100, Math.max(1, Number(max_results) || 20))),
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,description,trashed)'
    });
    const cleanQuery = String(query || '').trim();
    if (cleanQuery) params.set('q', `trashed = false and (name contains '${cleanQuery.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`);
    else params.set('q', 'trashed = false');
    const result = await this.apiFetch('drive', `https://www.googleapis.com/drive/v3/files?${params}`);
    return result.files || [];
  },

  async manageGoogleDriveFile({ action = 'list', file_id = '', name = '', max_results = 20 } = {}) {
    if (action === 'list') return this.listGoogleDriveFiles({ query: name, max_results });
    if (!file_id) throw new Error('A Google Drive file ID is required.');
    if (action === 'trash') return this.apiFetch('drive', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}`, {
      method: 'PATCH', body: JSON.stringify({ trashed: true })
    });
    if (action === 'get') return this.apiFetch('drive', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}?fields=id,name,mimeType,size,modifiedTime,webViewLink,description,trashed`);
    throw new Error('Drive file action must be list, get, or trash.');
  },

  async downloadGoogleDriveFile({ file_id }) {
    if (!file_id) throw new Error('A Google Drive file ID is required.');
    let token = await this.getAccessToken('drive');
    let response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      const current = sessionTokens.get('drive');
      const renewed = await silentlyRefresh('drive', current?.uid || auth.currentUser?.uid || '');
      if (renewed) {
        token = renewed.accessToken;
        response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      }
    }
    if (!response.ok) throw new Error(`Google Drive download failed (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (blob.size > 2 * 1024 * 1024) throw new Error('Files larger than 2 MB must be opened from Google Drive instead of attached to chat.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { mimeType: blob.type || 'application/octet-stream', size: blob.size, base64: btoa(binary) };
  },

  async getGoogleForm({ form_id }) {
    if (!form_id) throw new Error('A Google Form ID is required.');
    return this.apiFetch('forms', `https://forms.googleapis.com/v1/forms/${encodeURIComponent(form_id)}`);
  },

  async getGoogleFormResponses({ form_id, max_results = 100 } = {}) {
    if (!form_id) throw new Error('A Google Form ID is required.');
    const params = new URLSearchParams({ pageSize: String(Math.min(500, Math.max(1, Number(max_results) || 100))) });
    const result = await this.apiFetch('forms', `https://forms.googleapis.com/v1/forms/${encodeURIComponent(form_id)}/responses?${params}`);
    return result.responses || [];
  },

  async createGoogleForm({ title, description = '', questions = [] }) {
    if (!title) throw new Error('A form title is required to create a Google Form.');
    // Step 1: Create the form with title
    const form = await this.apiFetch('forms', 'https://forms.googleapis.com/v1/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ info: { title, documentTitle: title } })
    });
    const formId = form.formId;
    if (!formId) throw new Error('Google Forms API did not return a form ID.');

    // Step 2: Batch update to add description + questions
    const requests = [];
    if (description) {
      requests.push({ updateFormInfo: { info: { description }, updateMask: 'description' } });
    }
    questions.slice(0, 20).forEach((q, i) => {
      requests.push({
        createItem: {
          item: {
            title: String(q.title || `Question ${i + 1}`),
            questionItem: {
              question: {
                required: Boolean(q.required),
                ...(q.type === 'multiple_choice'
                  ? { choiceQuestion: { type: 'RADIO', options: (q.options || []).map(o => ({ value: String(o) })) } }
                  : q.type === 'checkbox'
                  ? { choiceQuestion: { type: 'CHECKBOX', options: (q.options || []).map(o => ({ value: String(o) })) } }
                  : { textQuestion: { paragraph: q.type === 'paragraph' } })
              }
            }
          },
          location: { index: i }
        }
      });
    });

    if (requests.length) {
      await this.apiFetch('forms', `https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      });
    }

    return {
      formId,
      formUrl: `https://docs.google.com/forms/d/${formId}/edit`,
      viewUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
      title
    };
  },

  async readSheetData({ spreadsheet_id, range }) {
    const result = await this.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range)}`);
    return result.values || [];
  }
};

if (typeof window !== 'undefined') {
  connectorManager.restoreSession().catch(() => {});
  onAuthStateChanged(auth, user => {
    if (!user) return;
    connectorManager.restoreSession().catch(() => {});
  });
}

export default connectorManager;
