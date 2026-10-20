import { onAuthStateChanged } from 'firebase/auth';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI } from '../lib/config/env';

const GOOGLE_CLIENT_ID = GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_REDIRECT_URI = GOOGLE_OAUTH_REDIRECT_URI;
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_STORAGE_KEY = 'zulora_oauth_token';
const TOKEN_DB_NAME = 'zulora-connector-sessions';
const TOKEN_DB_VERSION = 1;
const CONNECTOR_STATE_KEY = 'zulora_connector_sessions';
const OAUTH_SESSION_DOCUMENT_ID = 'googleOAuth';
const OAUTH_REDIRECT_STATE_KEY = 'zulora_google_oauth_state';
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

function emailText(value) {
  return String(value || '')
    .replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, label) => label.replace(/<[^>]*>/g, '').trim() + ' (' + href + ')')
    .replace(/<\s*br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|table|section|header|footer)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([\da-f]{1,6});/gi, (_match, code) => {
      const point = parseInt(code, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d{1,7});/g, (_match, code) => {
      const point = Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function emailTemplateIntent(subject, body) {
  const text = (String(subject || '') + '\n' + emailText(body)).toLowerCase();
  if (/\b(meeting|calendar invite|invitation|rsvp|agenda|conference|appointment|stand-?up|sync call|video call)\b/.test(text)) return 'meeting';
  const reportSubject = /\b(report|status update|team update|metrics summary|daily brief)\b/i.test(String(subject || ''));
  if (reportSubject || /\b(daily|weekly|monthly)\s+(?:status\s+)?(?:update|report)\b|\b(status update|team update|metrics summary|daily brief|progress report)\b/.test(text)) return 'report';
  if (/\b(launch|new product|product release|promotion|promotional|special offer|discount|limited time|early access|now available)\b/.test(text)) return 'promotion';
  if (/\b(corporate|business|client|proposal|partnership|executive|board meeting)\b/.test(text)) return 'corporate';
  return 'general';
}

function meetingRows(body, subject) {
  const labels = /^(date|time|when|location|where|venue|agenda|duration|meeting link|video call|attendees|participants|organizer)$/i;
  const lines = emailText(body).split('\n').map(line => line.trim()).filter(Boolean);
  const rows = [{ label: 'Event', value: String(subject || 'Meeting').trim() }];
  const notes = [];
  for (const line of lines) {
    const match = line.match(/^([^:]{2,30}):\s*(.+)$/);
    if (match && labels.test(match[1].trim())) rows.push({ label: match[1].trim(), value: match[2].trim() });
    else notes.push(line.replace(/^(?:[-*•]|\d+[.)])\s*/, ''));
  }
  return { rows, notes };
}

function firstEmailLink(contentHtml) {
  const match = String(contentHtml || '').match(/<a\b[^>]*\bhref\s*=\s*(["'])(https?:\/\/[^"']+|mailto:[^"']+)\1[^>]*>([\s\S]*?)<\/a>/i);
  if (!match) return null;
  return { href: match[2], label: emailText(match[3]) || 'Learn more', markup: match[0] };
}

function emailReplyLink(senderEmail, subject, response) {
  const params = new URLSearchParams({
    subject: 'Re: ' + String(subject || 'Zulora AI update').replace(/[\r\n]+/g, ' ').trim(),
    body: response
  });
  return 'mailto:' + encodeURIComponent(String(senderEmail || '').trim()) + '?' + params.toString();
}

function actionButton(href, label, background, foreground = '#ffffff') {
  return '<a href="' + escapeHtml(href) + '" style="display:inline-block;margin:5px 4px;padding:12px 18px;border-radius:8px;background-color:' + background + ';color:' + foreground + ';font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">' + escapeHtml(label) + '</a>';
}

function reportBodyHtml(body, contentHtml) {
  if (/<(?:ul|ol|table)\b/i.test(String(body || ''))) return contentHtml;
  const entries = emailText(body).split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => line.replace(/^(?:[-*•]|\d+[.)])\s*/, ''));
  if (!entries.length) return contentHtml;
  return '<ul style="margin:0;padding:0 0 0 22px;color:#26384d;">' + entries.map(line => '<li style="padding:0 0 10px 4px;line-height:1.65;">' + sanitizeEmailContent(line) + '</li>').join('') + '</ul>';
}

function buildHtmlMimeMessage({ to, subject, body, senderEmail = '' }) {
  const safeSubject = String(subject || '').trim();
  const intent = emailTemplateIntent(safeSubject, body);
  const contentHtml = sanitizeEmailContent(body);
  const link = firstEmailLink(contentHtml);
  const headerTitle = escapeHtml(safeSubject || 'A note from Zulora AI');
  const brand = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#57b9f2;">Zulora AI <span style="color:#a6b8c5;">&middot;</span> Pearl &amp; Azure</div>';
  let banner = '<tr><td style="padding:25px 30px 10px;background-color:#fffefa;">' + brand + '</td></tr><tr><td style="padding:8px 30px 22px;background-color:#fffefa;color:#1e2d43;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:1.3;">' + headerTitle + '</td></tr>';
  let bodyContent = contentHtml;
  let bodyBackground = '#fffefa';
  let actionContent = '';

  const hasCustomHtml = /<(?:table|div|p|ul|ol|li|h[1-6]|span|strong|em|br|hr)\b/i.test(String(body || ''));
  if (!hasCustomHtml) {
    if (intent === 'meeting') {
      const details = meetingRows(body, safeSubject);
      const detailRows = details.rows.map(row => '<tr><td style="width:27%;padding:10px 12px;border-bottom:1px solid #e4ebf2;color:#52657b;font-size:12px;font-weight:700;vertical-align:top;">' + escapeHtml(row.label) + '</td><td style="padding:10px 12px;border-bottom:1px solid #e4ebf2;color:#1e2d43;font-size:14px;line-height:1.5;">' + escapeHtml(row.value) + '</td></tr>').join('');
      const noteHtml = details.notes.length
        ? '<div style="padding:18px 0 0;color:#25344c;font-size:15px;line-height:1.7;">' + details.notes.map(line => '<p style="margin:0 0 10px;">' + sanitizeEmailContent(line) + '</p>').join('') + '</div>'
        : '';
      bodyContent = '<div style="margin:0 0 14px;color:#536980;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;">Meeting details</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e1e8f0;border-radius:10px;border-collapse:separate;border-spacing:0;background-color:#f8fafc;">' + detailRows + '</table>' + noteHtml;
      actionContent = '<tr><td align="center" style="padding:0 22px 24px;background-color:#fffefa;text-align:center;"><div style="padding:0 0 8px;color:#536980;font-size:12px;font-weight:700;">RSVP</div>'
        + actionButton(emailReplyLink(senderEmail, safeSubject, 'I will attend.'), 'Yes, I will attend', '#0879c9')
        + actionButton(emailReplyLink(senderEmail, safeSubject, 'I may attend. Please share any updates.'), 'Maybe', '#e8f3fa', '#18324b')
        + actionButton(emailReplyLink(senderEmail, safeSubject, 'I cannot attend.'), 'Decline', '#eef1f5', '#31445b')
        + '</td></tr>';
    } else if (intent === 'promotion') {
      bodyBackground = '#f8fbfe';
      banner = '<tr><td style="padding:28px 30px 8px;background-color:#10192b;background-image:linear-gradient(125deg,#10192b 0%,#19314c 60%,#07578f 100%);border-bottom:1px solid rgba(125,211,252,.35);">' + brand + '</td></tr>'
        + '<tr><td style="padding:10px 30px 30px;background-color:#10192b;background-image:linear-gradient(125deg,#10192b 0%,#19314c 60%,#07578f 100%);color:#f8fbff;font-family:Arial,Helvetica,sans-serif;font-size:27px;font-weight:700;line-height:1.3;">' + headerTitle + '</td></tr>';
      const ctaHref = link?.href || emailReplyLink(senderEmail, safeSubject, 'I would like to learn more about this launch.');
      const ctaLabel = link?.label || 'Ask us about the launch';
      if (link) bodyContent = contentHtml.replace(link.markup, '');
      actionContent = '<tr><td align="center" style="padding:4px 22px 28px;background-color:#f8fbfe;text-align:center;">' + actionButton(ctaHref, ctaLabel, '#0879c9') + '</td></tr>';
    } else if (intent === 'report') {
      bodyBackground = '#f4f8fb';
      banner = '<tr><td style="padding:24px 28px 10px;background-color:#f4f8fb;">' + brand + '</td></tr><tr><td style="padding:8px 28px 18px;background-color:#f4f8fb;color:#1e2d43;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:1.3;">' + headerTitle + '</td></tr>';
      bodyContent = '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #dce7ef;border-radius:12px;background-color:#ffffff;border-collapse:separate;border-spacing:0;"><tr><td style="padding:20px 22px;color:#26384d;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;">' + reportBodyHtml(body, contentHtml) + '</td></tr></table>';
    } else if (intent === 'corporate') {
      banner = '<tr><td style="padding:25px 30px 10px;background-color:#fffefa;">' + brand + '</td></tr><tr><td style="padding:8px 30px 22px;background-color:#fffefa;color:#1e2d43;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:1.3;">' + headerTitle + '</td></tr>';
    }
  }

  const stripe = intent === 'meeting' || intent === 'corporate' ? '#14283f' : '#168bd2';
  const html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>'
    + '<body style="margin:0;padding:0;background-color:#edf3f7;color:#203248;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#edf3f7;border-collapse:collapse;"><tr><td align="center" style="padding:28px 14px;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background-color:' + bodyBackground + ';border:1px solid #dce8ef;border-radius:16px;overflow:hidden;border-collapse:separate;border-spacing:0;">'
    + '<tr><td style="height:5px;background-color:' + stripe + ';font-size:0;line-height:0;">&nbsp;</td></tr>'
    + banner
    + '<tr><td style="padding:20px 22px 24px;background-color:' + bodyBackground + ';color:#25344c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;overflow-wrap:anywhere;">' + bodyContent + '</td></tr>'
    + actionContent
    + '<tr><td style="padding:17px 22px 20px;background-color:#f2f7fa;border-top:1px solid #e3edf5;color:#718096;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;">Sent via <a href="https://zulora.in" style="color:#0879c9;text-decoration:none;font-weight:700;">Zulora AI Workspace</a> <span style="color:#a6b8c5;">&middot; Pearl &amp; Azure</span></td></tr>'
    + '</table></td></tr></table></body></html>';
  const plainText = emailText(html);
  const boundary = 'zulora_' + crypto.randomUUID().replaceAll('-', '');
  const encodedSubject = '=?UTF-8?B?' + encodeBase64Utf8(safeSubject.replace(/[\r\n]+/g, ' ').trim()) + '?=';
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
  delete tokens.accessToken;
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
      'https://www.googleapis.com/auth/gmail.readonly',
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
      'https://www.googleapis.com/auth/drive.file',
      'openid', 'email'
    ],
    description: 'Read and update spreadsheets; list spreadsheet names for quick access.'
  },
  calendar: {
    id: 'calendar', name: 'Google Calendar', icon: 'calendar',
    scopes: ['https://www.googleapis.com/auth/calendar', 'openid', 'email'],
    description: 'View and schedule calendar events.'
  },
  forms: {
    id: 'forms', name: 'Google Forms', icon: 'form',
    scopes: ['https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/forms.body.readonly', 'https://www.googleapis.com/auth/forms.responses.readonly', 'openid', 'email'],
    description: 'Read and create Google Forms and their responses.'
  },
  drive: {
    id: 'drive', name: 'Google Drive', icon: 'drive',
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly', 'openid', 'email'],
    description: 'Find, download, and manage files you have granted access to.'
  }
});

function hasRequiredConnectorScopes(provider, session) {
  const apiScopes = CONNECTOR_CONFIG[provider]?.scopes.filter(scope => scope.startsWith('https://www.googleapis.com/auth/')) || [];
  const grantedScopes = new Set(session?.scopes || []);
  return provider === 'sheets'
    ? apiScopes.every(scope => grantedScopes.has(scope))
    : apiScopes.some(scope => grantedScopes.has(scope));
}

function normalizeSpreadsheetId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) throw new Error('Provide a valid Google spreadsheet ID.');
  return id;
}

function normalizeSheetRange(value) {
  const range = String(value || '').trim();
  if (!range || range.length > 200 || /[\u0000-\u001f\u007f]/.test(range)) {
    throw new Error('Provide a valid Google Sheets A1 notation range.');
  }
  return range;
}

function normalizeSheetValues(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('Provide at least one row of cell values.');
  const rows = Array.isArray(value[0]) ? value : [value];
  if (rows.some(row => !Array.isArray(row))) throw new Error('Google Sheets values must be one row or a matrix of rows.');
  return rows.map(row => row.map(cell => {
    if (cell == null) return '';
    if (typeof cell === 'string' || typeof cell === 'boolean') return cell;
    if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
    throw new Error('Google Sheets cells must contain only text, finite numbers, or booleans.');
  }));
}

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

async function oauthApiRequest(action, payload = {}) {
  const user = auth.currentUser;
  if (!user?.getIdToken) throw new Error('Sign in again to use Google connectors.');
  const response = await fetch('/api/google-oauth', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(action === 'exchange' ? { 'X-Requested-With': 'XmlHttpRequest' } : {})
    },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Google OAuth request failed (HTTP ${response.status}).`);
  return data;
}

function authorizationCodeRequest(oauth, scopes) {
  const state = crypto.randomUUID();
  const redirectUri = new URL(GOOGLE_REDIRECT_URI || window.location.origin, window.location.origin).href;
  sessionStorage.setItem(OAUTH_REDIRECT_STATE_KEY, state);
  const client = oauth.initCodeClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    ux_mode: 'redirect',
    redirect_uri: redirectUri,
    state
  });
  try { client.requestCode(); }
  catch (error) {
    sessionStorage.removeItem(OAUTH_REDIRECT_STATE_KEY);
    throw error;
  }
  return new Promise(() => {});
}

async function persistOAuthSession(uid, token) {
  if (!token?.encryptedSession) return { storage: 'memory' };
  try {
    await setDoc(connectorDoc(uid, OAUTH_SESSION_DOCUMENT_ID), {
      encryptedSession: token.encryptedSession,
      updatedAt: Date.now()
    }, { merge: true });
    return { storage: 'firestore' };
  } catch (firestoreError) {
    console.warn('Google OAuth session could not be saved to Firestore; using secure cookie fallback:', firestoreError.message);
    try {
      const fallback = await oauthApiRequest('cookie-fallback', { encryptedSession: token.encryptedSession });
      return { storage: fallback.storage || 'secure-cookie' };
    } catch (fallbackError) {
      throw new Error(`Google Workspace session could not be saved. ${fallbackError.message}`);
    }
  }
}

async function activateGoogleSession(uid, token) {
  const persistence = await persistOAuthSession(uid, token);
  const grantedScopes = Array.isArray(token.scopes)
    ? token.scopes
    : String(token.scope || '').split(/\s+/).filter(Boolean);
  const accessToken = token.accessToken || token.access_token || '';
  const email = token.email || (accessToken ? await readGoogleAccount(accessToken).catch(() => '') : '');
  const enabledProviders = Array.isArray(token.enabledProviders)
    ? token.enabledProviders
    : Object.keys(CONNECTOR_CONFIG).filter(id => hasRequiredConnectorScopes(id, { scopes: grantedScopes }));
  const expiresAt = Number(token.expiresAt) || Date.now() + (Number(token.expires_in) || 3600) * 1000;
  const connections = enabledProviders.filter(id => CONNECTOR_CONFIG[id]).map(id => {
    const connection = { provider: id, email, scopes: grantedScopes, connected: true, connectedAt: Date.now(), updatedAt: Date.now() };
    writeStoredConnectorState(id, connection);
    sessionTokens.set(id, { accessToken, expiresAt, email, uid, provider: id, scopes: grantedScopes, enabledProviders, connected: true });
    return connection;
  });
  writeStoredTokens();
  emitConnectorChange();
  let metadataSaved = true;
  try { await Promise.all(connections.map(connection => setDoc(connectorDoc(uid, connection.provider), connection, { merge: true }))); }
  catch (error) {
    metadataSaved = false;
    console.warn('Google connector is active, but its display metadata could not be saved:', error.message);
  }
  return { connections, enabledProviders, email, scopes: grantedScopes, expiresAt, metadataSaved, storage: persistence.storage };
}

function cleanOAuthCallbackUrl(url) {
  for (const parameter of ['code', 'state', 'scope', 'authuser', 'prompt', 'error', 'error_description']) url.searchParams.delete(parameter);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function handleGoogleOAuthRedirect(uid) {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  if (!code && !oauthError) return false;
  const expectedState = sessionStorage.getItem(OAUTH_REDIRECT_STATE_KEY) || '';
  const receivedState = url.searchParams.get('state') || '';
  sessionStorage.removeItem(OAUTH_REDIRECT_STATE_KEY);
  try {
    if (!expectedState || expectedState !== receivedState) throw new Error('Google OAuth state validation failed. Please reconnect Google Workspace.');
    if (oauthError) throw new Error(url.searchParams.get('error_description') || oauthError);
    if (!code) throw new Error('Google did not return an authorization code.');
    const token = await oauthApiRequest('exchange', { code, redirectUri: GOOGLE_REDIRECT_URI || url.origin });
    await activateGoogleSession(uid, token);
    window.dispatchEvent(new CustomEvent('zulora-google-oauth-complete'));
    return true;
  } catch (error) {
    console.warn('Google OAuth callback could not be completed:', error.message);
    window.dispatchEvent(new CustomEvent('zulora-google-oauth-error', { detail: { message: error.message } }));
    return false;
  } finally { cleanOAuthCallbackUrl(url); }
}

async function providerAccessToken(providerId, token) {
  const provider = CONNECTOR_CONFIG[providerId];
  if (!provider || !token) return null;
  const accessToken = String(token.accessToken || token.access_token || '');
  const expiresAt = Number(token.expiresAt) || Date.now() + (Number(token.expires_in) || 3600) * 1000;
  const scopes = Array.isArray(token.scopes) ? token.scopes : String(token.scope || '').split(/\s+/).filter(Boolean);
  const enabledProviders = Array.isArray(token.enabledProviders) ? token.enabledProviders : [providerId];
  return {
    accessToken,
    expiresAt,
    email: String(token.email || ''),
    uid: auth.currentUser?.uid || '',
    provider: providerId,
    scopes,
    enabledProviders,
    connected: token.connected !== false
  };
}

async function silentlyRefresh(providerId, uid = auth.currentUser?.uid || '') {
  // Production providers share one server-side OAuth session. In development,
  // each service gets its own browser token scoped to that provider.
  const refreshKey = import.meta.env?.DEV ? providerId : 'google-workspace-session';
  if (silentRefreshes.has(refreshKey)) {
    await silentRefreshes.get(refreshKey);
    return sessionTokens.get(providerId) || null;
  }
  const refreshPromise = (async () => {
    const provider = CONNECTOR_CONFIG[providerId];
    if (!provider || !uid || (auth.currentUser?.uid && auth.currentUser.uid !== uid)) return null;
    try {
      const priorTokens = new Map(sessionTokens);
      const token = import.meta.env?.DEV
        ? await tokenRequest(await loadIdentityServices(), provider.scopes, '')
        : await oauthApiRequest('refresh');
      const record = await providerAccessToken(providerId, token);
      const targets = record.enabledProviders?.length
        ? record.enabledProviders
        : priorTokens.size ? [...priorTokens.keys()] : [providerId];
      for (const target of targets) {
        if (!CONNECTOR_CONFIG[target]) continue;
        const previous = priorTokens.get(target);
        sessionTokens.set(target, {
          ...previous,
          ...record,
          accessToken: record.accessToken || previous?.accessToken || '',
          scopes: record.scopes?.length ? record.scopes : previous?.scopes || [],
          enabledProviders: record.enabledProviders?.length ? record.enabledProviders : previous?.enabledProviders || targets,
          email: record.email || previous?.email || '',
          provider: target,
          connected: record.connected !== false
        });
      }
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
  })().finally(() => silentRefreshes.delete(refreshKey));
  silentRefreshes.set(refreshKey, refreshPromise);
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

  clearSession() {
    sessionTokens.clear();
    writeStoredTokens(Object.keys(CONNECTOR_CONFIG));
    emitConnectorChange();
  },

  async restoreSession() {
    const uid = auth.currentUser?.uid;
    if (!import.meta.env?.DEV && !uid) {
      sessionTokens.clear();
      writeStoredTokens(Object.keys(CONNECTOR_CONFIG));
      emitConnectorChange();
      return [];
    }
    if (!import.meta.env?.DEV && uid) {
      await handleGoogleOAuthRedirect(uid);
      sessionTokens.clear();
      writeStoredTokens(Object.keys(CONNECTOR_CONFIG));
      try {
        const status = await oauthApiRequest('status');
        for (const providerId of status.enabledProviders || []) {
          if (!CONNECTOR_CONFIG[providerId]) continue;
          sessionTokens.set(providerId, {
            accessToken: '',
            expiresAt: Number(status.expiresAt) || 0,
            email: status.email || '',
            uid,
            provider: providerId,
            scopes: status.scopes || [],
            enabledProviders: status.enabledProviders,
            connected: Boolean(status.connected)
          });
        }
      } catch (error) {
        console.info('Google Workspace session restore is unavailable:', error.message);
      }
    } else {
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
      if (uid) {
        for (const providerId of Object.keys(CONNECTOR_CONFIG)) {
          const token = sessionTokens.get(providerId);
          if (token?.uid === uid && token.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
            silentlyRefresh(providerId, uid).catch(() => {});
          }
        }
      }
    }
    emitConnectorChange();
    return this.getActiveGoogleProviders();
  },

  async connect(providerId, uid) {
    const provider = CONNECTOR_CONFIG[providerId];
    if (!provider) throw new Error(`Unknown connector: ${providerId}`);
    if (!uid) throw new Error('Sign in to Zulora before connecting Google services.');
    const oauth = await loadIdentityServices();
    const scopes = [...new Set(Object.values(CONNECTOR_CONFIG).flatMap(item => item.scopes))];
    const token = import.meta.env?.DEV
      ? await tokenRequest(oauth, scopes, 'consent')
      : await authorizationCodeRequest(oauth, scopes);
    const activated = await activateGoogleSession(uid, token);
    const connection = activated.connections.find(item => item.provider === providerId) || activated.connections[0];
    if (!connection) throw new Error(`Google did not grant the required ${provider.name} access scope.`);
    return { ...connection, connected: true, metadataSaved: activated.metadataSaved, storage: activated.storage };
  },

  async disconnect(providerId, uid) {
    if (!import.meta.env?.DEV && uid) {
      await oauthApiRequest('disconnect', { provider: providerId });
    }
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
    const { expectedStatus, responseType = 'json', ...requestOptions } = options;
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const retryableMethod = ['GET', 'HEAD', 'DELETE'].includes(method);
    let refreshedAfter401 = false;
    let transientRetries = 0;
    while (true) {
      let response;
      if (import.meta.env?.DEV) {
        const accessToken = await this.getAccessToken(providerId);
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
        if (!this.getActiveGoogleProviders().includes(providerId)) {
          throw new Error(`${OAUTH_PERMISSION_REQUIRED}. Open Connectors to authorize ${CONNECTOR_CONFIG[providerId]?.name || providerId}.`);
        }
        const firebaseToken = await user.getIdToken();
        response = await fetch('/api/google-connector', {
          method: 'POST',
          credentials: 'same-origin',
          signal: requestOptions.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firebaseToken}` },
          body: JSON.stringify({
            provider: providerId,
            url,
            request: { method, body: requestOptions.body || null, responseType }
          })
        });
      }
      let data = null;
      if (response.status !== 204) {
        if (responseType === 'base64' && import.meta.env?.DEV && response.ok) {
          const blob = await response.blob();
          if (blob.size > 2 * 1024 * 1024) throw new Error('Files larger than 2 MB must be opened from Google Drive instead of attached to chat.');
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          data = { base64: btoa(binary), mimeType: blob.type || 'application/octet-stream', size: blob.size };
        } else {
          data = await response.json().catch(() => null);
        }
      }
      if (data?.code === 'AUTH_REQUIRED') {
        throw new Error(data.error?.message || 'Sign in again to use Google connectors.');
      }
      if (response.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        const current = sessionTokens.get(providerId);
        const renewed = await silentlyRefresh(providerId, current?.uid || auth.currentUser?.uid || '');
        if (renewed) continue;
      }
      const scopeRequired = response.status === 403 && data?.code === 'GOOGLE_SCOPE_REQUIRED';
      if ((response.status === 401 || response.status === 403) && !scopeRequired) {
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
          oauthErr.message = scopeRequired ? reason : `${OAUTH_PERMISSION_REQUIRED}. Your ${CONNECTOR_CONFIG[providerId]?.name || providerId} session has expired or lacks permission.`;
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
      const connected = Boolean(session && session.connected !== false
        && (session.enabledProviders ? session.enabledProviders.includes(provider) : true)
        && (provider !== 'sheets' || hasRequiredConnectorScopes(provider, session))
        && (import.meta.env?.DEV ? session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS : true)
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
      const connected = Boolean(session && session.connected !== false
        && (session.enabledProviders ? session.enabledProviders.includes(provider) : true)
        && (provider !== 'sheets' || hasRequiredConnectorScopes(provider, session))
        && (import.meta.env?.DEV ? session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS : true)
        && (!uid || !session.uid || session.uid === uid));
      if (import.meta.env?.DEV && session && !connected && uid && session.uid === uid) silentlyRefresh(provider, uid).catch(() => {});
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
    const activeProviders = this.getActiveGoogleProviders();
    const active = ['calendar', 'gmail', 'sheets', 'drive']
      .filter(provider => activeProviders.includes(provider))
      .map(provider => `${CONNECTOR_CONFIG[provider].name}: CONNECTED AND AUTHORIZED`);
    if (active.length) {
      active.unshift('ACTIVE WORKSPACE CONNECTORS:');
      active.push('Use the matching live connector function for supported requests. A connector action is complete only after its function returns success.');
    }
    if (driveConnected) active.push('Zulora Drive: CONNECTED AND AUTHORIZED');
    return active.length
      ? active.join('\n')
      : 'No Google Workspace connector is active in this signed-in session. Connect the requested service before accessing its data.';
  },

  getActiveGoogleProviders() {
    return Object.keys(CONNECTOR_CONFIG).filter(provider => {
      const token = sessionTokens.get(provider) || restoreStoredToken(provider);
      const hasProviderScope = hasRequiredConnectorScopes(provider, token);
      const enabled = token?.enabledProviders ? token.enabledProviders.includes(provider) : true;
      const liveToken = import.meta.env?.DEV
        ? Boolean(token?.accessToken && token.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS)
        : Boolean(token?.connected !== false);
      return Boolean(token && liveToken && enabled
        && (hasProviderScope || (provider !== 'sheets' && !token.scopes?.length))
        && (!auth.currentUser?.uid || !token.uid || token.uid === auth.currentUser.uid));
    });
  },

  hasActiveGoogleConnectors() {
    return this.getActiveGoogleProviders().length > 0;
  },

  async sendGmailMessage({ to, recipient = to, subject, body, htmlContent, body_html }) {
    const resolvedBody = body ?? htmlContent ?? body_html ?? '';
    const raw = buildHtmlMimeMessage({ to: recipient, subject, body: resolvedBody, senderEmail: sessionTokens.get('gmail')?.email || '' });
    const res = await this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', body: JSON.stringify({ raw }), expectedStatus: 200
    });
    if (!res?.id || !res?.threadId) {
      throw new Error('Gmail API did not confirm delivery with both a message ID and thread ID. The email is not reported as sent.');
    }
    return { ...res, success: true, to: recipient, subject, delivered: true, messageId: res.id, threadId: res.threadId, verified: true, timestamp: Date.now() };
  },

  async sendRichEmail({ to, subject, body }) {
    return this.sendGmailMessage({ to, subject, body });
  },

  async createGmailDraft({ to, subject, body }) {
    const raw = buildHtmlMimeMessage({ to, subject, body, senderEmail: sessionTokens.get('gmail')?.email || '' });
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
    const raw = buildHtmlMimeMessage({ to, subject, body, senderEmail: sessionTokens.get('gmail')?.email || '' });
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

  async readEmails({ query = 'in:inbox', max_results = 5, all_results = false } = {}) {
    const limit = all_results ? Infinity : Math.min(500, Math.max(1, Number(max_results) || 5));
    const ids = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: String(query || 'in:inbox'), maxResults: String(all_results ? 500 : Math.min(500, limit - ids.length)) });
      if (pageToken) params.set('pageToken', pageToken);
      const list = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
      if (!list || typeof list !== 'object' || (list.messages !== undefined && !Array.isArray(list.messages))
        || (!Array.isArray(list.messages) && !Number.isFinite(Number(list.resultSizeEstimate)))) {
        throw new Error('Gmail returned an invalid inbox response. No inbox result is reported.');
      }
      ids.push(...(list.messages || []));
      pageToken = list.nextPageToken || '';
    } while (pageToken && (all_results || ids.length < limit));
    const messages = [];
    const messageIds = all_results ? ids : ids.slice(0, limit);
    for (let offset = 0; offset < messageIds.length; offset += 50) {
      const pageMessages = await Promise.all(messageIds.slice(offset, offset + 50).map(async item => {
      if (!item?.id) throw new Error('Gmail returned a message without an ID. No inbox result is reported.');
      const message = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`);
      if (!message?.id || !message?.threadId) throw new Error('Gmail returned an invalid message record. No inbox result is reported.');
      const headers = message.payload?.headers || [];
      const getHeader = name => headers.find(header => header.name?.toLowerCase() === name)?.value || '';
      return { id: message.id, from: getHeader('from'), subject: getHeader('subject'), date: getHeader('date'), snippet: message.snippet || '', body: getGmailText(message.payload) || message.snippet || '' };
      }));
      messages.push(...pageMessages);
    }
    return messages;
  },

  async analyzeInbox({ query = 'in:inbox', max_results = 10, all_results = false } = {}) {
    const emails = await this.readEmails({ query, max_results, all_results });
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
      emails: emails.map(e => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, preview: e.snippet, body: String(e.body || '').slice(0, 6_000) }))
    };
  },

  async createCalendarEvent({ title, start_time, end_time, description = '' }) {
    const event = await this.apiFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST', body: JSON.stringify({ summary: title, description, start: { dateTime: start_time }, end: { dateTime: end_time }, reminders: { useDefault: true } })
    });
    if (!event?.id) throw new Error('Google Calendar did not return an event ID. The event is not reported as created.');
    return { ...event, eventUrl: event.htmlLink || '', confirmation: event.htmlLink ? `Created “${event.summary || title}”: ${event.htmlLink}` : `Created “${event.summary || title}” (event ${event.id}).`, verified: true };
  },

  async scheduleEvents({ events = [], title, start_time, end_time, description = '' } = {}) {
    if (Array.isArray(events) && events.length > 0) {
      const created = [];
      for (const [index, ev] of events.entries()) {
        try {
          const res = await this.createCalendarEvent({
            title: ev.title || ev.summary,
            start_time: ev.start_time || ev.start,
            end_time: ev.end_time || ev.end,
            description: ev.description || ''
          });
          created.push(res);
        } catch (error) {
          const partial = created.map(event => `${event.summary || 'Untitled event'} (${event.htmlLink || event.id})`).join(', ');
          throw new Error(`Calendar batch stopped at event ${index + 1} of ${events.length}; ${created.length} event(s) were created before the failure.${partial ? ` Created events: ${partial}.` : ''} ${error.message}`);
        }
      }
      return { success: true, count: created.length, events: created, confirmation: created.map(event => event.confirmation).join('\n') };
    }
    if (title && start_time && end_time) {
      const res = await this.createCalendarEvent({ title, start_time, end_time, description });
      return { success: true, count: 1, event: res };
    }
    throw new Error('Provide event details (title, start_time, end_time) or a list of events to schedule.');
  },

  async createAndPopulateSpreadsheet({ title, rows = [] } = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('At least one header or data row is required to populate the spreadsheet.');
    const spreadsheet = await this.createSpreadsheet({ title });
    const spreadsheetId = spreadsheet?.spreadsheetId;
    if (!spreadsheetId) throw new Error('Google Sheets did not return the new spreadsheet ID.');
    
    // Chunk spreadsheet row updates in batches of 50 to prevent payload timeouts on large datasets
    const CHUNK_SIZE = 50;
    let lastResult = null;
    let totalUpdated = 0;
    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        lastResult = await this.appendSheetRow({ spreadsheet_id: spreadsheetId, range: 'Sheet1!A1', values: chunk });
        totalUpdated += Number(lastResult?.updates?.updatedRows || chunk.length);
      }
    } catch (error) {
      throw new Error(`Google Sheets values.append failed after spreadsheet creation. The sheet was not confirmed as populated, so no link is being returned. ${error.message}`);
    }
    return {
      success: true,
      spreadsheet: {
        id: spreadsheetId,
        title: spreadsheet.properties?.title || String(title || '').trim(),
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      },
      appended: { ...(lastResult?.updates || {}), updatedRows: totalUpdated },
      populated: true
    };
  },

  async exportGmailToSheet({ title = `Gmail Export ${new Date().toLocaleDateString()}`, query = 'in:inbox', max_results = 5 } = {}) {
    const emails = await this.readEmails({ query, max_results });
    const rows = [
      ['Sender Name & Email', 'Subject', 'Snippet / Summary', 'Timestamp'],
      ...emails.map(email => [email.from || '', email.subject || '(no subject)', email.snippet || email.body || '', email.date || ''])
    ];
    const populated = await this.createAndPopulateSpreadsheet({ title, rows });
    return { ...populated, messagesCount: emails.length, query, confirmation: `Created and populated [${populated.spreadsheet.title}](${populated.spreadsheet.url}) with ${emails.length} email rows.` };
  },

  async exportCalendarToSheet({ title = `Calendar Export ${new Date().toLocaleDateString()}`, time_min, time_max, max_results = 50 } = {}) {
    const events = await this.getCalendarEvents({ time_min, time_max, max_results });
    const rows = [
      ['Meeting', 'Start', 'End', 'Location', 'Description', 'Calendar Event Link'],
      ...events.map(event => [event.summary || '(untitled)', event.start?.dateTime || event.start?.date || '', event.end?.dateTime || event.end?.date || '', event.location || '', event.description || '', event.htmlLink || ''])
    ];
    const populated = await this.createAndPopulateSpreadsheet({ title, rows });
    return { ...populated, eventsCount: events.length, confirmation: `Created and populated [${populated.spreadsheet.title}](${populated.spreadsheet.url}) with ${events.length} calendar events.` };
  },

  async getCalendarEvents({ time_min, time_max, max_results = 50 } = {}) {
    const limit = Math.min(2500, Math.max(1, Number(max_results) || 50));
    const events = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ timeMin: time_min || new Date().toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(2500, limit - events.length)) });
      if (time_max) params.set('timeMax', time_max);
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.apiFetch('calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
      if (!result || typeof result !== 'object' || (result.items !== undefined && !Array.isArray(result.items))
        || (!Array.isArray(result.items) && result.kind !== 'calendar#events')) {
        throw new Error('Google Calendar returned an invalid event-list response. No schedule result is reported.');
      }
      events.push(...(result.items || []));
      pageToken = result.nextPageToken || '';
    } while (pageToken && events.length < limit);
    return events.slice(0, limit);
  },

  async analyzeCalendar({ time_min, time_max, max_results = 50 } = {}) {
    const events = await this.getCalendarEvents({ time_min, time_max, max_results });
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
    const id = normalizeSpreadsheetId(spreadsheet_id);
    const a1Range = normalizeSheetRange(range);
    const rows = normalizeSheetValues(values);
    const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1Range)}:append?${params}`;
    const result = await this.apiFetch('sheets', endpoint, {
      method: 'POST', body: JSON.stringify({ range: a1Range, majorDimension: 'ROWS', values: rows }), expectedStatus: 200
    });
    if (!result?.spreadsheetId || !result?.updates || Number(result.updates.updatedRows) < rows.length) {
      throw new Error(`Google Sheets did not confirm that all ${rows.length} requested row(s) were appended.`);
    }
    return result;
  },

  async createSpreadsheet({ title, folder_id = '' }) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) throw new Error('A spreadsheet title is required.');
    const spreadsheet = await this.apiFetch('sheets', 'https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', body: JSON.stringify({ properties: { title: safeTitle } }), expectedStatus: 200
    });
    if (!spreadsheet?.spreadsheetId) throw new Error('Google Sheets did not return the new spreadsheet ID.');
    if (!String(folder_id || '').trim()) return spreadsheet;
    const folder = normalizeSpreadsheetId(folder_id);
    const file = await this.moveDriveFileToFolder({ file_id: spreadsheet.spreadsheetId, folder_id: folder });
    return { ...spreadsheet, driveFile: file };
  },

  async createDriveFolder({ name }) {
    return this.apiFetch('drive', 'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink', {
      method: 'POST',
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
  },

  async moveDriveFileToFolder({ file_id, folder_id }) {
    const safeFileId = normalizeSpreadsheetId(file_id);
    const safeFolderId = normalizeSpreadsheetId(folder_id);
    const fileUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeFileId)}?fields=id,parents`;
    const file = await this.apiFetch('drive', fileUrl);
    const params = new URLSearchParams({ addParents: safeFolderId, fields: 'id,name,parents,webViewLink' });
    if (Array.isArray(file.parents) && file.parents.length) params.set('removeParents', file.parents.join(','));
    return this.apiFetch('drive', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeFileId)}?${params}`, {
      method: 'PATCH', body: JSON.stringify({})
    });
  },

  async formatSpreadsheet({ spreadsheet_id, sheet_id = 0 }) {
    return this.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId: Number(sheet_id) || 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        { repeatCell: { range: { sheetId: Number(sheet_id) || 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.03, green: 0.34, blue: 0.62 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)' } },
        { autoResizeDimensions: { dimensions: { sheetId: Number(sheet_id) || 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 } } }
      ] })
    });
  },

  async getSentEmailMetrics({ query = 'in:sent' } = {}) {
    const safeQuery = String(query || 'in:sent').trim() || 'in:sent';
    const params = new URLSearchParams({ q: safeQuery, maxResults: '5' });
    const listing = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
    const latestMessages = await Promise.all((listing.messages || []).slice(0, 5).map(async item => {
      const metadata = await this.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Date&metadataHeaders=Subject`);
      const headers = metadata.payload?.headers || [];
      const getHeader = name => headers.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value || '';
      return { date: getHeader('date'), subject: getHeader('subject'), snippet: metadata.snippet || '' };
    }));
    return { query: safeQuery, sentCount: Number(listing.resultSizeEstimate) || 0, sampledMessageCount: latestMessages.length, latestMessages };
  },

  async createFolderSpreadsheetEmailMetrics({ folder_name, spreadsheet_title, gmail_query = 'in:sent', onProgress }) {
    onProgress?.({ label: 'Step 1 of 4: Creating the Google Drive folder', status: 'running' });
    const folder = await this.createDriveFolder({ name: folder_name });
    if (!folder?.id) throw new Error('Google Drive did not return the new folder ID.');
    onProgress?.({ label: 'Step 1 of 4: Google Drive folder created', status: 'done' });
    onProgress?.({ label: 'Step 2 of 4: Creating and formatting the spreadsheet in that folder', status: 'running' });
    const spreadsheet = await this.createSpreadsheet({ title: spreadsheet_title });
    const spreadsheetId = spreadsheet?.spreadsheetId;
    if (!spreadsheetId) throw new Error('Google Sheets did not return the new spreadsheet ID.');
    const sheetId = spreadsheet.sheets?.[0]?.properties?.sheetId ?? 0;
    const file = await this.moveDriveFileToFolder({ file_id: spreadsheetId, folder_id: folder.id });
    await this.formatSpreadsheet({ spreadsheet_id: spreadsheetId, sheet_id: sheetId });
    onProgress?.({ label: 'Step 2 of 4: Spreadsheet created, moved, and formatted', status: 'done' });
    onProgress?.({ label: 'Step 3 of 4: Fetching sent Gmail metrics', status: 'running' });
    const metrics = await this.getSentEmailMetrics({ query: gmail_query });
    onProgress?.({ label: 'Step 3 of 4: Sent Gmail metrics retrieved', status: 'done' });
    const rows = [
      ['Metric', 'Value'],
      ['Sent emails matching query', metrics.sentCount],
      ['Gmail query', metrics.query],
      ['Messages sampled', metrics.sampledMessageCount],
      ['Most recent sent email date', metrics.latestMessages[0]?.date || 'No sent emails found'],
      ['Most recent sent email subject', metrics.latestMessages[0]?.subject || '']
    ];
    onProgress?.({ label: 'Step 4 of 4: Writing the metrics to Sheets', status: 'running' });
    await this.appendSheetRow({ spreadsheet_id: spreadsheetId, range: 'Sheet1!A:B', values: rows });
    onProgress?.({ label: 'Step 4 of 4: Metrics written to the spreadsheet', status: 'done' });
    return {
      success: true,
      status: 'completed',
      folder: { id: folder.id, name: folder.name, url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` },
      spreadsheet: { id: spreadsheetId, title: spreadsheet.properties?.title || spreadsheet_title, url: file?.webViewLink || spreadsheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}` },
      metrics
    };
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
    const result = await this.apiFetch('drive', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}?alt=media`, { responseType: 'base64' });
    return { mimeType: result.mimeType || 'application/octet-stream', size: Number(result.size) || 0, base64: result.base64 || '' };
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
    const id = normalizeSpreadsheetId(spreadsheet_id);
    const a1Range = normalizeSheetRange(range);
    const result = await this.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1Range)}`);
    return result.values || [];
  }
};

if (typeof window !== 'undefined') {
  connectorManager.restoreSession().catch(() => {});
  onAuthStateChanged(auth, user => {
    if (user) connectorManager.restoreSession().catch(() => {});
    else connectorManager.clearSession();
  });
}

export default connectorManager;
