import { reserveVoiceUsage, verifyRequestUser } from './ai.js';

export const maxDuration = 30;
export const config = { maxDuration };

const VOICE_IDS = new Set([
  'pNInz6obpgDQGcFmaJgB', 'ErXwobaYiN019PkySvjV', 'TxGEqnHWrfWFTfGW9XjX',
  '21m00Tcm4TlvDq8ikWAM', 'EXAVITQu4vr4xnSDxMaL', 'AZnzlk1XvdvUeBnXmlld',
  'XB0fDUnXU5powFXDhCwa', 'VR6AewLTigWG4xSOukaG'
]);

const reply = (res, status, message) => res.status(status).json({ error: message });

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, 'Method not allowed.');
  const uid = await verifyRequestUser(req).catch(() => null);
  if (!uid) return reply(res, 401, 'Sign in to use voice responses.');
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;
  if (!apiKey) return reply(res, 503, 'ElevenLabs voice is not configured.');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return reply(res, 400, 'Invalid voice request.'); }
  }
  const text = String(body?.text || '').trim();
  const voiceId = String(body?.voiceId || 'pNInz6obpgDQGcFmaJgB');
  if (!text || text.length > 5_000) return reply(res, 400, 'Voice text must be between 1 and 5,000 characters.');
  if (!VOICE_IDS.has(voiceId)) return reply(res, 400, 'Choose one of the available Zulora voices.');

  try {
    const allowance = await reserveVoiceUsage(uid, text.length);
    if (!allowance.allowed) return res.status(429).json({ error: 'The voice character allowance is used for now.', usage: allowance });

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.28, use_speaker_boost: true }
      })
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      console.warn('ElevenLabs TTS request failed:', response.status, details.detail?.status || response.statusText);
      return reply(res, response.status === 429 ? 503 : response.status, 'ElevenLabs could not synthesize this response.');
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(audio.length));
    return res.status(200).send(audio);
  } catch (error) {
    console.warn('Voice synthesis failed:', error?.message || error);
    return reply(res, 503, 'Voice responses are temporarily unavailable.');
  }
}
