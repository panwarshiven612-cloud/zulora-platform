import { verifyRequestUser } from './ai.js';
import { VOICE_OPTIONS } from '../src/services/voicePreferences.js';

export const maxDuration = 15;
export const config = { maxDuration };

const voiceFallback = () => VOICE_OPTIONS.map(({ name, gender, voiceId, tier }) => ({ id: voiceId, voiceId, name, gender, tier }));
let cachedVoices = null;
let cachedUntil = 0;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!await verifyRequestUser(req).catch(() => null)) return res.status(401).json({ error: 'Sign in to load voice options.' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(200).json({ voices: voiceFallback(), source: 'defaults' });
  if (cachedVoices && cachedUntil > Date.now()) return res.status(200).json({ voices: cachedVoices, source: 'elevenlabs' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response;
    try {
      response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      console.warn('ElevenLabs voice list request failed with HTTP', response.status);
      return res.status(503).json({ error: 'Voice options could not be loaded.' });
    }
    const defaults = new Map(VOICE_OPTIONS.map(voice => [voice.voiceId, voice]));
    const voices = (await response.json()).voices;
    if (!Array.isArray(voices)) throw new Error('Invalid voice list response.');
    cachedVoices = voices.filter(voice => /^[A-Za-z0-9_-]{8,80}$/.test(String(voice.voice_id || ''))).map(voice => {
      const fallback = defaults.get(voice.voice_id);
      const genderLabel = String(voice.labels?.gender || fallback?.gender || 'Voice').toLowerCase();
      const gender = genderLabel === 'male' || genderLabel === 'female' ? genderLabel[0].toUpperCase() + genderLabel.slice(1) : 'Voice';
      return {
        id: voice.voice_id,
        voiceId: voice.voice_id,
        name: String(voice.name || fallback?.name || 'ElevenLabs voice').slice(0, 80),
        gender,
        tier: fallback?.tier || 'pro'
      };
    });
    if (!cachedVoices.length) cachedVoices = voiceFallback();
    cachedUntil = Date.now() + 10 * 60_000;
    return res.status(200).json({ voices: cachedVoices, source: 'elevenlabs' });
  } catch (error) {
    console.warn('Could not load ElevenLabs voices:', error?.name || 'request failed');
    return res.status(503).json({ error: 'Voice options could not be loaded.' });
  }
}
