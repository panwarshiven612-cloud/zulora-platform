import aiHandler from '../server/handlers/ai.js';
import connectorModelHandler from '../server/handlers/connector-model.js';
import googleConnectorHandler from '../server/handlers/google-connector.js';
import googleOAuthHandler from '../server/handlers/google-oauth.js';
import limitsHandler from '../server/handlers/limits.js';
import mediaDownloadHandler from '../server/handlers/media-download.js';
import paymentUtrHandler from '../server/handlers/payments/utr.js';
import videoHandler from '../server/handlers/video.js';
import voiceHandler from '../server/handlers/voice.js';
import voiceTokenHandler from '../server/handlers/voice-token.js';
import voicesHandler from '../server/handlers/voices.js';

export const maxDuration = 60;
export const config = { maxDuration };

const ROUTES = Object.freeze({
  ai: aiHandler,
  chat: aiHandler,
  'connector-model': connectorModelHandler,
  'google-connector': googleConnectorHandler,
  'google-oauth': googleOAuthHandler,
  'google/calendar': googleConnectorHandler,
  'google/drive': googleConnectorHandler,
  'google/gmail': googleConnectorHandler,
  'google/sheets': googleConnectorHandler,
  'google/workspace': googleConnectorHandler,
  limits: limitsHandler,
  'media/download': mediaDownloadHandler,
  'media-download': mediaDownloadHandler,
  'media/image': aiHandler,
  'media/video': videoHandler,
  'payments/utr': paymentUtrHandler,
  video: videoHandler,
  voice: voiceHandler,
  'voice-token': voiceTokenHandler,
  voices: voicesHandler
});

function routePath(req) {
  const requested = req.query?.route ?? req.query?.path ?? '';
  const joined = Array.isArray(requested) ? requested.join('/') : String(requested);
  return joined.replace(/^\/+|\/+$/g, '').split('?')[0];
}

function normalizeLegacyAction(req, route) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  if (route === 'chat' && !body.action) req.body = { ...body, action: 'chat' };
  if (route === 'media/image') req.body = { ...body, action: 'image' };
}

export default async function handler(req, res) {
  const route = routePath(req);
  const target = ROUTES[route];
  if (!target) return res.status(404).json({ error: 'API route not found.' });

  normalizeLegacyAction(req, route);
  return target(req, res);
}
