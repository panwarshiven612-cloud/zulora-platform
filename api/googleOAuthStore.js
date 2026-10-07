import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { firestoreAccessToken, firestoreRoot } from './ai.js';

export const GOOGLE_SERVICE_SCOPES = Object.freeze({
  gmail: Object.freeze([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose'
  ]),
  sheets: Object.freeze(['https://www.googleapis.com/auth/spreadsheets']),
  drive: Object.freeze([
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly'
  ]),
  calendar: Object.freeze(['https://www.googleapis.com/auth/calendar.events']),
  forms: Object.freeze([
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.body.readonly',
    'https://www.googleapis.com/auth/forms.responses.readonly'
  ])
});

export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  ...new Set([...Object.values(GOOGLE_SERVICE_SCOPES).flat(), 'openid', 'email'])
]);

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DOCUMENT_ID = 'googleOAuth';
const serviceAccountDocumentPath = uid => `${firestoreRoot()}/users/${encodeURIComponent(uid)}/private/${GOOGLE_DOCUMENT_ID}`;
const serviceAccountCollectionPath = uid => `${firestoreRoot()}/users/${encodeURIComponent(uid)}/private`;

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

function googleClientSecret() {
  return String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

function encryptionKey() {
  const raw = String(process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY is not configured on the server.');
  const decoded = Buffer.from(raw, 'base64');
  const key = decoded.length === 32 ? decoded : Buffer.from(raw, 'utf8');
  if (key.length !== 32) throw new Error('GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

function encryptSession(session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  });
}

function decryptSession(value) {
  if (!value) return null;
  let sealed;
  try { sealed = JSON.parse(value); } catch { throw new Error('Stored Google OAuth credentials are invalid.'); }
  if (sealed?.version !== 1 || !sealed.iv || !sealed.tag || !sealed.data) {
    throw new Error('Stored Google OAuth credentials use an unsupported format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(sealed.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(decrypted);
}

async function firestoreRequest(uid, path, options = {}) {
  const token = await firestoreAccessToken();
  return fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
}

export async function loadGoogleSession(uid) {
  const response = await firestoreRequest(uid, serviceAccountDocumentPath(uid));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not read Google OAuth credentials (HTTP ${response.status}).`);
  const document = await response.json();
  return decryptSession(document.fields?.encrypted?.stringValue || '');
}

export async function saveGoogleSession(uid, session) {
  const path = serviceAccountDocumentPath(uid);
  const encrypted = encryptSession(session);
  let existing = await firestoreRequest(uid, path);
  if (existing.status === 404) {
    const created = await firestoreRequest(uid, `${serviceAccountCollectionPath(uid)}?documentId=${GOOGLE_DOCUMENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ fields: { encrypted: { stringValue: encrypted } } })
    });
    if (created.ok) return;
    if (created.status !== 409) throw new Error(`Could not save Google OAuth credentials (HTTP ${created.status}).`);
    existing = await firestoreRequest(uid, path);
  }
  if (!existing.ok) throw new Error(`Could not read Google OAuth credentials (HTTP ${existing.status}).`);
  const updated = await firestoreRequest(uid, `${path}?updateMask.fieldPaths=encrypted`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { encrypted: { stringValue: encrypted } } })
  });
  if (!updated.ok) throw new Error(`Could not update Google OAuth credentials (HTTP ${updated.status}).`);
}

export async function deleteGoogleSession(uid) {
  const response = await firestoreRequest(uid, serviceAccountDocumentPath(uid), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Could not delete Google OAuth credentials (HTTP ${response.status}).`);
}

async function exchangeToken(params) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) throw new Error('Google OAuth server credentials are not configured.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth token request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function readGoogleEmail(accessToken) {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  return String(data.email || '');
}

function scopesFrom(value) {
  return [...new Set(String(value || '').split(/\s+/).filter(Boolean))];
}

function activeProviders(session) {
  const granted = new Set(session?.scopes || []);
  return Object.entries(GOOGLE_SERVICE_SCOPES)
    .filter(([, scopes]) => scopes.some(scope => granted.has(scope)))
    .map(([provider]) => provider)
    .filter(provider => (session?.enabledProviders || []).includes(provider));
}

export async function exchangeGoogleAuthorizationCode(uid, { code, redirectUri }) {
  const origin = new URL(String(redirectUri || '')).origin;
  if (origin !== String(redirectUri || '')) throw new Error('Google OAuth redirect URI must be an application origin.');
  const prior = await loadGoogleSession(uid).catch(() => null);
  const response = await exchangeToken({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: origin
  });
  const scopes = scopesFrom(response.scope || prior?.scopes?.join(' '));
  const refreshToken = String(response.refresh_token || prior?.refreshToken || '');
  if (!refreshToken) throw new Error('Google did not issue an offline refresh token. Reconnect Google with consent enabled.');
  const session = {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000,
    scopes,
    enabledProviders: Object.keys(GOOGLE_SERVICE_SCOPES).filter(provider => GOOGLE_SERVICE_SCOPES[provider].some(scope => scopes.includes(scope))),
    email: await readGoogleEmail(response.access_token),
    updatedAt: Date.now()
  };
  await saveGoogleSession(uid, session);
  return session;
}

export async function refreshGoogleSession(uid, current = null) {
  const session = current || await loadGoogleSession(uid);
  if (!session?.refreshToken) throw new Error('OAuth Permission Required: Connect Google Workspace to authorize this service.');
  if (Number(session.expiresAt) > Date.now() + 60_000 && session.accessToken) return session;
  const response = await exchangeToken({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
  const refreshed = {
    ...session,
    accessToken: response.access_token,
    refreshToken: response.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000,
    scopes: scopesFrom(response.scope || session.scopes.join(' ')),
    updatedAt: Date.now()
  };
  await saveGoogleSession(uid, refreshed);
  return refreshed;
}

export async function getValidGoogleSession(uid, provider) {
  const session = await loadGoogleSession(uid);
  if (!session || !(session.enabledProviders || []).includes(provider)) {
    throw new Error(`OAuth Permission Required: Connect Google ${provider} to authorize this service.`);
  }
  return refreshGoogleSession(uid, session);
}

export function googleSessionStatus(session) {
  if (!session) return { connected: false, email: '', scopes: [], enabledProviders: [] };
  return {
    connected: Boolean(session.refreshToken),
    email: session.email || '',
    expiresAt: session.expiresAt || 0,
    scopes: session.scopes || [],
    enabledProviders: activeProviders(session)
  };
}

export function googleScopeAllowed(session, provider, url, method) {
  const scopes = new Set(session?.scopes || []);
  if (!(session?.enabledProviders || []).includes(provider)) return false;
  const pathname = new URL(url).pathname;
  const verb = String(method || 'GET').toUpperCase();
  let required = [];
  if (provider === 'gmail') {
    if (pathname.includes('/drafts')) required = ['https://www.googleapis.com/auth/gmail.compose'];
    else if (/\/messages\/send$/.test(pathname)) required = ['https://www.googleapis.com/auth/gmail.send'];
    else required = ['https://www.googleapis.com/auth/gmail.readonly'];
  } else if (provider === 'sheets') {
    required = ['https://www.googleapis.com/auth/spreadsheets'];
  } else if (provider === 'drive') {
    required = verb === 'GET' || verb === 'HEAD'
      ? ['https://www.googleapis.com/auth/drive.readonly']
      : ['https://www.googleapis.com/auth/drive.file'];
  } else if (provider === 'calendar') {
    required = ['https://www.googleapis.com/auth/calendar.events'];
  } else if (provider === 'forms') {
    required = pathname.endsWith('/responses')
      ? ['https://www.googleapis.com/auth/forms.responses.readonly']
      : verb === 'GET'
        ? ['https://www.googleapis.com/auth/forms.body.readonly']
        : ['https://www.googleapis.com/auth/forms.body'];
  }
  return required.every(scope => scopes.has(scope));
}
