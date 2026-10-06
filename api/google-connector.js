import { verifyUser } from './ai.js';

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

  const { provider, url: rawUrl, accessToken, request: googleRequest = {} } = req.body || {};
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

  const token = String(accessToken || '');
  const method = String(googleRequest.method || 'GET').toUpperCase();
  if (token.length < 10 || token.length > 8192) {
    return respond(res, 401, { code: 'GOOGLE_OAUTH_REQUIRED', error: { message: 'OAuth Permission Required: Please re-connect your Gmail/Calendar account.' } });
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return respond(res, 405, { error: { message: 'This Google API method is not permitted.' } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(googleRequest.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(googleRequest.body && method !== 'GET' && method !== 'HEAD' ? { body: googleRequest.body } : {})
    });
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
