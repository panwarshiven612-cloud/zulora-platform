import { reserveVoiceUsage, verifyRequestUser } from './ai.js';

export const maxDuration = 15;
export const config = { maxDuration };

const reply = (res, status, message) => res.status(status).json({ error: message });

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, 'Method not allowed.');
  const uid = await verifyRequestUser(req).catch(() => null);
  if (!uid) return reply(res, 401, 'Sign in to use voice responses.');
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return reply(res, 503, 'ElevenLabs voice is not configured.');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return reply(res, 400, 'Invalid voice request.'); }
  }
  const text = String(body?.text || '').trim();
  const voiceId = String(body?.voiceId || 'pNInz6obpgDQGcFmaJgB');
  if (!text || text.length > 5_000) return reply(res, 400, 'Voice text must be between 1 and 5,000 characters.');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(voiceId)) return reply(res, 400, 'Choose one of the available Zulora voices.');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response;
    try {
      response = await fetch('https://api.elevenlabs.io/v1/single-use-token/tts_websocket', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      console.warn('ElevenLabs websocket token request failed with HTTP', response.status);
      return reply(res, response.status === 429 ? 503 : response.status, 'Live voice could not connect.');
    }
    const token = String((await response.json()).token || '');
    if (!token) return reply(res, 503, 'Live voice could not connect.');

    const allowance = await reserveVoiceUsage(uid, text.length);
    if (!allowance.allowed) return res.status(429).json({ error: 'The voice character allowance is used for now.', usage: allowance });
    return res.status(200).json({ token });
  } catch (error) {
    console.warn('Could not create ElevenLabs websocket session:', error?.name || 'request failed');
    return reply(res, 503, 'Live voice could not connect.');
  }
}
