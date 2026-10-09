import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readServerEnv } from './keyResolver.js';

export const GOOGLE_SERVICE_SCOPES = Object.freeze({
  gmail: Object.freeze([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose'
  ]),
  sheets: Object.freeze([
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ]),
  drive: Object.freeze([
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly'
  ]),
  calendar: Object.freeze(['https://www.googleapis.com/auth/calendar']),
  forms: Object.freeze([
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.body.readonly',
    'https://www.googleapis.com/auth/forms.responses.readonly'
  ])
});

export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  ...new Set([...Object.values(GOOGLE_SERVICE_SCOPES).flat(), 'openid', 'email'])
]);

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SESSION_DOCUMENT_ID = 'googleOAuth';
const LEGACY_SESSION_DOCUMENT_ID = 'googleOAuth';
const SESSION_COOKIE = 'zulora_google_oauth';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function firestoreRoot() {
  const projectId = readServerEnv('FIREBASE_PROJECT_ID')
    || readServerEnv('VITE_FIREBASE_PROJECT_ID')
    || 'zulora-al';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

const sessionDocumentPath = uid => `${firestoreRoot()}/users/${encodeURIComponent(uid)}/connectors/${SESSION_DOCUMENT_ID}`;

function googleClientId() {
  return readServerEnv('GOOGLE_CLIENT_ID') || '791256936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com';
}

function googleClientSecret() {
  return readServerEnv('GOOGLE_CLIENT_SECRET', { allowViteAlias: false });
}

function encryptionKey() {
  const raw = readServerEnv('GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY', { allowViteAlias: false });
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    const configuredKey = decoded.length === 32 ? decoded : Buffer.from(raw, 'utf8');
    if (configuredKey.length === 32) return configuredKey;
  }

  // The OAuth client secret is server-only and already required for the code
  // exchange. It provides a stable key when a dedicated AES key is absent.
  const serverSecret = googleClientSecret();
  if (serverSecret) {
    return createHash('sha256')
      .update('zulora-google-oauth-token-encryption:v2\0', 'utf8')
      .update(serverSecret, 'utf8')
      .digest();
  }

  const error = new Error('Google Workspace is temporarily unavailable. Please try again later.');
  error.code = 'GOOGLE_OAUTH_ENCRYPTION_UNAVAILABLE';
  throw error;
}

function legacyEncryptionKey() {
  const raw = readServerEnv('GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY', { allowViteAlias: false });
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    const configuredKey = decoded.length === 32 ? decoded : Buffer.from(raw, 'utf8');
    if (configuredKey.length === 32) return configuredKey;
  }
  const serverSecret = readServerEnv('FIREBASE_ADMIN_PRIVATE_KEY', { allowViteAlias: false })
    || readServerEnv('FIREBASE_PRIVATE_KEY', { allowViteAlias: false })
    || googleClientSecret();
  if (serverSecret) {
    return createHash('sha256')
      .update('zulora-google-oauth-token-encryption:v1\0', 'utf8')
      .update(serverSecret, 'utf8')
      .digest();
  }
  throw new Error('Google Workspace is temporarily unavailable. Please try again later.');
}

export function sealGoogleSession(uid, session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`zulora-google-oauth:${uid}`, 'utf8'));
  const payload = {
    ...session,
    uid,
    access_token: session.accessToken || '',
    refresh_token: session.refreshToken || '',
    expiry_date: Number(session.expiresAt) || 0
  };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 2,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  });
}

export function openGoogleSession(uid, value) {
  if (!value) return null;
  let sealed;
  try { sealed = JSON.parse(value); }
  catch { throw new Error('Stored Google OAuth credentials are invalid.'); }
  if (![1, 2].includes(sealed?.version) || !sealed.iv || !sealed.tag || !sealed.data) {
    throw new Error('Stored Google OAuth credentials use an unsupported format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', sealed.version === 1 ? legacyEncryptionKey() : encryptionKey(), Buffer.from(sealed.iv, 'base64'));
  if (sealed.version === 2) decipher.setAAD(Buffer.from(`zulora-google-oauth:${uid}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(sealed.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const payload = JSON.parse(decrypted);
  if (sealed.version === 2 && payload.uid !== uid) throw new Error('Stored Google OAuth credentials belong to another account.');
  const session = { ...payload, uid };
  return session;
}

function userCookieValue(cookieHeader = '') {
  const cookie = String(cookieHeader).split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return '';
  try {
    const encoded = cookie.slice(SESSION_COOKIE.length + 1);
    return Buffer.from(decodeURIComponent(encoded), 'base64url').toString('utf8');
  } catch { return ''; }
}

export function setGoogleSessionCookie(res, uid, encryptedSession) {
  openGoogleSession(uid, encryptedSession);
  const value = Buffer.from(encryptedSession, 'utf8').toString('base64url');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`);
}

export function clearGoogleSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0${secure}`);
}

async function firestoreRequest(idToken, path, options = {}) {
  if (!idToken) throw new Error('Sign in again to use Google connectors.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } finally { clearTimeout(timer); }
}

function decryptCookieSession(uid, cookieHeader) {
  const encrypted = userCookieValue(cookieHeader);
  return encrypted ? openGoogleSession(uid, encrypted) : null;
}

export async function loadGoogleSession(uid, idToken, cookieHeader = '') {
  let firestoreError = null;
  if (idToken) {
    try {
      const response = await firestoreRequest(idToken, sessionDocumentPath(uid));
      if (response.ok) {
        const document = await response.json();
        const encrypted = document.fields?.encryptedSession?.stringValue || '';
        if (encrypted) return openGoogleSession(uid, encrypted);
      } else if (response.status !== 404) {
        firestoreError = new Error(`Could not read Google OAuth credentials (HTTP ${response.status}).`);
      }
      if (response.status === 404) {
        const legacyPath = `${firestoreRoot()}/users/${encodeURIComponent(uid)}/private/${LEGACY_SESSION_DOCUMENT_ID}`;
        const legacyResponse = await firestoreRequest(idToken, legacyPath);
        if (legacyResponse.ok) {
          const legacyDocument = await legacyResponse.json();
          const encrypted = legacyDocument.fields?.encrypted?.stringValue || '';
          if (encrypted) return openGoogleSession(uid, encrypted);
        } else if (legacyResponse.status !== 404) {
          firestoreError = new Error(`Could not read the previous Google OAuth session (HTTP ${legacyResponse.status}).`);
        }
      }
    } catch (error) { firestoreError = error; }
  }

  try {
    const cookieSession = decryptCookieSession(uid, cookieHeader);
    if (cookieSession) return cookieSession;
  } catch (error) {
    if (!firestoreError) firestoreError = error;
  }

  // A transient Firestore outage with no cookie should show the connector as
  // unavailable rather than triggering a Firebase Admin credential crash.
  if (firestoreError && !/AbortError/i.test(String(firestoreError.name || ''))) {
    console.warn('Google Workspace session could not be loaded:', firestoreError.message);
  }
  return null;
}

export async function saveGoogleSession(uid, session, idToken, res = null) {
  const encryptedSession = sealGoogleSession(uid, session);
  let firestoreError;
  try {
    const response = await firestoreRequest(idToken, `${sessionDocumentPath(uid)}?updateMask.fieldPaths=encryptedSession`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { encryptedSession: { stringValue: encryptedSession } } })
    });
    if (response.ok) {
      if (res) setGoogleSessionCookie(res, uid, encryptedSession);
      return { storage: 'firestore', encryptedSession };
    }
    firestoreError = new Error(`Firestore returned HTTP ${response.status}.`);
  } catch (error) { firestoreError = error; }

  if (res) {
    setGoogleSessionCookie(res, uid, encryptedSession);
    console.warn('Google OAuth session is using its secure cookie fallback:', firestoreError?.message || 'Firestore is unavailable.');
    return { storage: 'secure-cookie', encryptedSession };
  }
  throw new Error('Google Workspace could not save this session. Please reconnect while online.');
}

export async function deleteGoogleSession(uid, idToken, res = null) {
  let firestoreError = null;
  try {
    const response = await firestoreRequest(idToken, sessionDocumentPath(uid), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) firestoreError = new Error(`Firestore returned HTTP ${response.status}.`);
  } catch (error) { firestoreError = error; }
  if (res) clearGoogleSessionCookie(res);
  if (firestoreError) throw new Error('Google Workspace could not remove the saved session from Firestore.');
}

async function exchangeToken(params) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) throw new Error('Google Workspace connection is temporarily unavailable. Please try again later.');
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

export async function exchangeGoogleAuthorizationCode(uid, { code, redirectUri, priorSession = null }) {
  const redirect = new URL(String(redirectUri || ''));
  if (redirect.username || redirect.password || redirect.hash || redirect.search) {
    throw new Error('Google OAuth redirect URI is invalid.');
  }
  const response = await exchangeToken({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: String(redirectUri)
  });
  const scopes = scopesFrom(response.scope || priorSession?.scopes?.join(' '));
  const refreshToken = String(response.refresh_token || priorSession?.refreshToken || '');
  if (!refreshToken) throw new Error('Google did not issue an offline refresh token. Reconnect Google with consent enabled.');
  return {
    uid,
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000,
    scopes,
    enabledProviders: Object.keys(GOOGLE_SERVICE_SCOPES).filter(provider => GOOGLE_SERVICE_SCOPES[provider].some(scope => scopes.includes(scope))),
    email: await readGoogleEmail(response.access_token),
    updatedAt: Date.now()
  };
}

export async function refreshGoogleSession(uid, idToken, cookieHeader = '', res = null, current = null, force = false) {
  const session = current || await loadGoogleSession(uid, idToken, cookieHeader);
  if (!session?.refreshToken) throw new Error('OAuth Permission Required: Connect Google Workspace to authorize this service.');
  if (!force && Number(session.expiresAt) > Date.now() + 60_000 && session.accessToken) return session;
  const response = await exchangeToken({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
  const refreshed = {
    ...session,
    uid,
    accessToken: response.access_token,
    refreshToken: response.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000,
    scopes: scopesFrom(response.scope || session.scopes.join(' ')),
    updatedAt: Date.now()
  };
  refreshed.expiry_date = refreshed.expiresAt;
  await saveGoogleSession(uid, refreshed, idToken, res);
  return refreshed;
}

export async function getValidGoogleSession(uid, provider, idToken, cookieHeader = '', res = null) {
  const session = await loadGoogleSession(uid, idToken, cookieHeader);
  if (!session || !(session.enabledProviders || []).includes(provider)) {
    throw new Error(`OAuth Permission Required: Connect Google ${provider} to authorize this service.`);
  }
  return refreshGoogleSession(uid, idToken, cookieHeader, res, session);
}

export function googleSessionStatus(session) {
  if (!session) return { connected: false, email: '', expiresAt: 0, scopes: [], enabledProviders: [] };
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
    required = ['https://www.googleapis.com/auth/calendar'];
  } else if (provider === 'forms') {
    required = pathname.endsWith('/responses')
      ? ['https://www.googleapis.com/auth/forms.responses.readonly']
      : verb === 'GET'
        ? ['https://www.googleapis.com/auth/forms.body.readonly']
        : ['https://www.googleapis.com/auth/forms.body'];
  }
  return required.every(scope => scopes.has(scope));
}
