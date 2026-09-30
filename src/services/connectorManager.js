import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const GOOGLE_CLIENT_ID = String(
  import.meta.env?.VITE_GOOGLE_CLIENT_ID
  || '791256936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com'
).trim();
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const sessionTokens = new Map();
let identityScriptPromise;

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
    scopes: ['https://www.googleapis.com/auth/forms.responses.readonly', 'openid', 'email'],
    description: 'Read responses from forms you select.'
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

async function readGoogleAccount(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return '';
  const account = await response.json();
  return String(account.email || '');
}

export const connectorManager = {
  clientConfigured: Boolean(GOOGLE_CLIENT_ID),
  prepareOAuth: loadIdentityServices,

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
    sessionTokens.set(providerId, {
      accessToken: token.access_token,
      expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
      email,
      uid
    });
    // Persist connection metadata only. GIS browser access tokens are short-lived;
    // refresh tokens and access tokens are deliberately never written to storage.
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
    if (uid) await deleteDoc(connectorDoc(uid, providerId)).catch(() => {});
    emitConnectorChange();
  },

  async getAccessToken(providerId) {
    const token = sessionTokens.get(providerId);
    if (!token || token.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      sessionTokens.delete(providerId);
      throw new Error(`${CONNECTOR_CONFIG[providerId]?.name || providerId} needs to be connected again. Reconnect it in Connectors to continue.`);
    }
    return token.accessToken;
  },

  async apiFetch(providerId, url, options = {}) {
    const accessToken = await this.getAccessToken(providerId);
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (response.status === 401) {
      sessionTokens.delete(providerId);
      emitConnectorChange();
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const reason = data?.error?.message || response.statusText || 'Google API request failed';
      throw new Error(`${CONNECTOR_CONFIG[providerId]?.name || providerId}: ${reason} (HTTP ${response.status})`);
    }
    return data;
  },

  async getStatuses(uid) {
    const entries = await Promise.all(Object.keys(CONNECTOR_CONFIG).map(async provider => {
      const session = sessionTokens.get(provider);
      let metadata = null;
      if (uid) {
        try {
          const snapshot = await getDoc(connectorDoc(uid, provider));
          if (snapshot.exists()) metadata = snapshot.data();
        } catch { /* Metadata is optional; live OAuth state is authoritative. */ }
      }
      const connected = Boolean(session && session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS);
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
    const active = Object.keys(CONNECTOR_CONFIG).filter(provider => {
      const session = sessionTokens.get(provider);
      return session && session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS;
    }).map(provider => CONNECTOR_CONFIG[provider].name);
    if (driveConnected) active.push('Zulora Drive');
    return active.length
      ? `Available native connectors for this signed-in session: ${active.join(', ')}. When a request targets one of these services, Zulora can use its direct API connector without opening tabs or using the Computer Plugin.`
      : 'No native connectors are active in this session. Ask the user to connect the requested service from the Connectors hub before accessing its data.';
  },

  async sendGmailMessage({ to, subject, body }) {
    const mime = [
      `To: ${String(to || '').trim()}`,
      `Subject: ${String(subject || '').replace(/[\r\n]+/g, ' ').trim()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      String(body || '')
    ].join('\r\n');
    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', body: JSON.stringify({ raw })
    });
  },

  async createGmailDraft({ to, subject, body }) {
    const mime = [
      `To: ${String(to || '').trim()}`,
      `Subject: ${String(subject || '').replace(/[\r\n]+/g, ' ').trim()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      String(body || '')
    ].join('\r\n');
    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return this.apiFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST', body: JSON.stringify({ message: { raw } })
    });
  }
};

export default connectorManager;
