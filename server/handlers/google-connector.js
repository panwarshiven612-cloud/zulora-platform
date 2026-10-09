import { verifyUser } from './ai.js';
import { getValidGoogleSession, googleScopeAllowed } from './googleOAuthStore.js';

export const config = { maxDuration: 30 };

const CONNECTOR_HOSTS = Object.freeze({
  gmail: { host: 'gmail.googleapis.com', path: '/gmail/v1/' },
  calendar: { host: 'www.googleapis.com', path: '/calendar/v3/' },
  sheets: { host: 'sheets.googleapis.com', path: '/v4/' },
  forms: { host: 'forms.googleapis.com', path: '/v1/forms/' },
  drive: { host: 'www.googleapis.com', path: '/drive/v3/' }
});

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

const bearer = req => String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';

export default async function googleConnector(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: { message: 'Method not allowed.' } });
  }

  let uid;
  try { uid = await verifyUser(req); }
  catch { uid = null; }
  if (!uid) {
    return respond(res, 401, {
      code: 'AUTH_REQUIRED',
      error: { message: 'Sign in again to use Google connectors.' }
    });
  }

  const { provider, url: rawUrl, request: googleRequest = {} } = req.body || {};
  const target = CONNECTOR_HOSTS[provider];
  let url;
  try { url = new URL(String(rawUrl || '')); }
  catch { return respond(res, 400, { error: { message: 'Invalid Google API URL.' } }); }
  const pathBase = target?.path.replace(/\/$/, '');
  if (!target || url.protocol !== 'https:' || url.hostname !== target.host
    || !(url.pathname === pathBase || url.pathname.startsWith(`${pathBase}/`))
    || url.username || url.password || url.port) {
    return respond(res, 400, { error: { message: 'The requested Google API endpoint is not permitted.' } });
  }

  const method = String(googleRequest.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return respond(res, 405, { error: { message: 'This Google API method is not permitted.' } });
  }

  let session;
  try { session = await getValidGoogleSession(uid, provider, bearer(req), String(req.headers.cookie || ''), res); }
  catch (error) {
    const message = error?.message || 'Google OAuth session is unavailable.';
    return respond(res, /OAuth Permission Required/.test(message) ? 401 : 503, {
      code: /OAuth Permission Required/.test(message) ? 'GOOGLE_OAUTH_REQUIRED' : 'GOOGLE_OAUTH_UNAVAILABLE',
      error: { message }
    });
  }
  if (!googleScopeAllowed(session, provider, url, method)) {
    return respond(res, 403, { code: 'GOOGLE_SCOPE_REQUIRED', error: { message: `OAuth Permission Required: The connected Google account has not granted the scope required for this ${provider} action. Reconnect the service to grant it.` } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(googleRequest.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(googleRequest.body && method !== 'GET' && method !== 'HEAD' ? { body: googleRequest.body } : {})
    });
    const responseType = String(googleRequest.responseType || 'json');
    if (responseType === 'base64' && upstream.ok) {
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024) return respond(res, 413, { error: { message: 'Files larger than 2 MB must be opened from Google Drive instead of attached to chat.' } });
      res.setHeader('Cache-Control', 'no-store');
      return respond(res, 200, { base64: bytes.toString('base64'), mimeType: upstream.headers.get('content-type') || 'application/octet-stream', size: bytes.length });
    }
    const raw = upstream.status === 204 || method === 'HEAD' ? '' : await upstream.text();
    res.status(upstream.status);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Zulora-Upstream-Status', String(upstream.status));
    if (raw) {
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      return res.send(raw);
    }
    return res.end();
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return respond(res, aborted ? 504 : 502, {
      error: { message: aborted ? 'Google API request timed out.' : 'Google API could not be reached.' }
    });
  } finally {
    clearTimeout(timeout);
  }
}
