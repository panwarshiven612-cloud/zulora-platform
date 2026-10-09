import { verifyUser } from './ai.js';
import {
  GOOGLE_OAUTH_SCOPES,
  deleteGoogleSession,
  exchangeGoogleAuthorizationCode,
  googleSessionStatus,
  loadGoogleSession,
  openGoogleSession,
  saveGoogleSession,
  refreshGoogleSession,
  sealGoogleSession,
  setGoogleSessionCookie
} from './googleOAuthStore.js';

export const config = { maxDuration: 30 };

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

const bearer = req => String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';

export default async function googleOAuth(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: { message: 'Method not allowed.' } });
  }

  let uid;
  try { uid = await verifyUser(req); }
  catch { uid = null; }
  if (!uid) return respond(res, 401, { code: 'AUTH_REQUIRED', error: { message: 'Sign in again to use Google connectors.' } });
  const idToken = bearer(req);
  const cookieHeader = String(req.headers.cookie || '');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return respond(res, 400, { error: { message: 'Invalid JSON request.' } }); }
  }
  const action = String(body?.action || 'status');
  try {
    if (action === 'exchange') {
      if (req.headers['x-requested-with'] !== 'XmlHttpRequest') {
        return respond(res, 400, { error: { message: 'Google OAuth request validation failed.' } });
      }
      const origin = String(req.headers.origin || '');
      const redirectUri = String(body.redirectUri || '');
      let redirect;
      try { redirect = new URL(redirectUri); } catch { redirect = null; }
      const configuredRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || process.env.VITE_GOOGLE_REDIRECT_URI || '').trim();
      const redirectMatchesOrigin = redirectUri === origin;
      const redirectMatchesConfigured = Boolean(configuredRedirectUri && redirectUri === configuredRedirectUri);
      const redirectUsesDashboardPath = Boolean(redirect && redirect.pathname === '/dashboard' && redirect.origin === origin);
      if (!origin || !redirect || redirect.origin !== origin || redirect.username || redirect.password
        || redirect.hash || redirect.search || (!redirectMatchesOrigin && !redirectMatchesConfigured && !redirectUsesDashboardPath)) {
        return respond(res, 400, { error: { message: 'Google OAuth origin validation failed.' } });
      }
      const allowedOrigins = String(process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS || '')
        .split(',').map(value => value.trim()).filter(Boolean);
      if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
        return respond(res, 403, { error: { message: 'This application origin is not allowed to connect Google Workspace.' } });
      }
      if (typeof body.code !== 'string' || body.code.length < 10 || body.code.length > 4096) {
        return respond(res, 400, { error: { message: 'Google did not return a valid authorization code.' } });
      }
      const priorSession = await loadGoogleSession(uid, idToken, cookieHeader);
      const session = await exchangeGoogleAuthorizationCode(uid, { code: body.code, redirectUri, priorSession });
      const encryptedSession = sealGoogleSession(uid, session);
      setGoogleSessionCookie(res, uid, encryptedSession);
      return respond(res, 200, {
        ...googleSessionStatus(session),
        encryptedSession,
        availableScopes: GOOGLE_OAUTH_SCOPES
      });
    }

    if (action === 'cookie-fallback') {
      if (typeof body.encryptedSession !== 'string' || body.encryptedSession.length > 12_000) {
        return respond(res, 400, { error: { message: 'Google did not return a valid encrypted session.' } });
      }
      const session = openGoogleSession(uid, body.encryptedSession);
      setGoogleSessionCookie(res, uid, body.encryptedSession);
      return respond(res, 200, { ...googleSessionStatus(session), storage: 'secure-cookie' });
    }

    if (action === 'refresh') {
      const session = await refreshGoogleSession(uid, idToken, cookieHeader, res, null, true);
      return respond(res, 200, googleSessionStatus(session));
    }

    if (action === 'disconnect') {
      const provider = String(body.provider || '');
      const session = await loadGoogleSession(uid, idToken, cookieHeader);
      if (session && session.enabledProviders.includes(provider)) {
        const updated = { ...session, enabledProviders: session.enabledProviders.filter(value => value !== provider), updatedAt: Date.now() };
        await saveGoogleSession(uid, updated, idToken, res);
        return respond(res, 200, googleSessionStatus(updated));
      }
      return respond(res, 200, googleSessionStatus(session));
    }

    if (action === 'revoke') {
      await deleteGoogleSession(uid, idToken, res);
      return respond(res, 200, { connected: false, email: '', scopes: [], enabledProviders: [] });
    }

    if (action === 'status') {
      const session = await loadGoogleSession(uid, idToken, cookieHeader);
      return respond(res, 200, googleSessionStatus(session));
    }

    return respond(res, 400, { error: { message: 'Unsupported Google OAuth action.' } });
  } catch (error) {
    const message = String(error?.message || 'Google OAuth request failed.');
    console.warn('Google OAuth request failed:', message);
    const status = /OAuth Permission Required/.test(message) ? 401 : 503;
    return respond(res, status, { code: status === 401 ? 'GOOGLE_OAUTH_REQUIRED' : 'GOOGLE_OAUTH_UNAVAILABLE', error: { message } });
  }
}
