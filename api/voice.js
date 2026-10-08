import { reserveVoiceUsage, verifyRequestUser } from './ai.js';

export const maxDuration = 30;
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
    const allowance = await reserveVoiceUsage(uid, text.length);
    if (!allowance.allowed) return res.status(429).json({ error: 'The voice character allowance is used for now.', usage: allowance });

    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'xi-api-key': apiKey },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.28, use_speaker_boost: true }
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (attempt === 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 160));
        continue;
      } finally { clearTimeout(timer); }
      if (response.ok) break;
      if (![408, 425, 429].includes(response.status) && response.status < 500) {
        console.warn('ElevenLabs TTS request failed with HTTP', response.status);
        return reply(res, response.status === 429 ? 503 : response.status, 'ElevenLabs could not synthesize this response.');
      }
      if (attempt === 1) {
        console.warn('ElevenLabs TTS retries exhausted with HTTP', response.status);
        return reply(res, 503, 'ElevenLabs could not synthesize this response.');
      }
      await new Promise(resolve => setTimeout(resolve, 160));
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
