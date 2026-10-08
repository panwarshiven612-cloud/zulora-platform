import { verifyUser } from './ai.js';
import {
  GOOGLE_OAUTH_SCOPES,
  deleteGoogleSession,
  exchangeGoogleAuthorizationCode,
  googleSessionStatus,
  loadGoogleSession,
  saveGoogleSession,
  refreshGoogleSession
} from './googleOAuthStore.js';

export const config = { maxDuration: 30 };

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

export default async function googleOAuth(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: { message: 'Method not allowed.' } });
  }

  let uid;
  try { uid = await verifyUser(req); }
  catch { uid = null; }
  if (!uid) return respond(res, 401, { code: 'AUTH_REQUIRED', error: { message: 'Sign in again to use Google connectors.' } });

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
      if (!origin || origin !== redirectUri) return respond(res, 400, { error: { message: 'Google OAuth origin validation failed.' } });
      const allowedOrigins = String(process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS || '')
        .split(',').map(value => value.trim()).filter(Boolean);
      if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
        return respond(res, 403, { error: { message: 'This application origin is not allowed to connect Google Workspace.' } });
      }
      if (typeof body.code !== 'string' || body.code.length < 10 || body.code.length > 4096) {
        return respond(res, 400, { error: { message: 'Google did not return a valid authorization code.' } });
      }
      const session = await exchangeGoogleAuthorizationCode(uid, { code: body.code, redirectUri });
      return respond(res, 200, {
        ...googleSessionStatus(session),
        availableScopes: GOOGLE_OAUTH_SCOPES
      });
    }

    if (action === 'refresh') {
      const session = await refreshGoogleSession(uid);
      return respond(res, 200, googleSessionStatus(session));
    }

    if (action === 'disconnect') {
      const provider = String(body.provider || '');
      const session = await loadGoogleSession(uid);
      if (session && session.enabledProviders.includes(provider)) {
        const updated = { ...session, enabledProviders: session.enabledProviders.filter(value => value !== provider), updatedAt: Date.now() };
        await saveGoogleSession(uid, updated);
        return respond(res, 200, googleSessionStatus(updated));
      }
      return respond(res, 200, googleSessionStatus(session));
    }

    if (action === 'revoke') {
      await deleteGoogleSession(uid);
      return respond(res, 200, { connected: false, email: '', scopes: [], enabledProviders: [] });
    }

    if (action === 'status') {
      const session = await loadGoogleSession(uid);
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
