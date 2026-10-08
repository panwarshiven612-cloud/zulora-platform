export const VOICE_PREFERENCE_KEY = 'zulora_voice_preference';
export const VOICE_OPTIONS = Object.freeze([
  { id: 'adam', name: 'Adam', gender: 'Male', voiceId: 'pNInz6obpgDQGcFmaJgB', tier: 'free' },
  { id: 'antoni', name: 'Antoni', gender: 'Male', voiceId: 'ErXwobaYiN019PkySvjV', tier: 'free' },
  { id: 'josh', name: 'Josh', gender: 'Male', voiceId: 'TxGEqnHWrfWFTfGW9XjX', tier: 'free' },
  { id: 'rachel', name: 'Rachel', gender: 'Female', voiceId: '21m00Tcm4TlvDq8ikWAM', tier: 'free' },
  { id: 'bella', name: 'Bella', gender: 'Female', voiceId: 'EXAVITQu4vr4xnSDxMaL', tier: 'free' },
  { id: 'domi', name: 'Domi', gender: 'Female', voiceId: 'AZnzlk1XvdvUeBnXmlld', tier: 'free' },
  { id: 'charlotte', name: 'Charlotte', gender: 'Female', voiceId: 'XB0fDUnXU5powFXDhCwa', tier: 'pro' },
  { id: 'arnold', name: 'Arnold', gender: 'Male', voiceId: 'VR6AewLTigWG4xSOukaG', tier: 'pro' }
]);

export function getPreferredVoiceId() {
  try { return localStorage.getItem(VOICE_PREFERENCE_KEY) || 'adam'; }
  catch { return 'adam'; }
}

export function setPreferredVoiceId(id) {
  const valid = VOICE_OPTIONS.some(voice => voice.id === id || voice.voiceId === id)
    ? (VOICE_OPTIONS.find(voice => voice.id === id || voice.voiceId === id)?.id || id)
    : /^[A-Za-z0-9_-]{8,80}$/.test(String(id || '')) ? String(id) : 'adam';
  try { localStorage.setItem(VOICE_PREFERENCE_KEY, valid); }
  catch { /* Keep the setting for this session if storage is unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zulora:voice-preference', { detail: valid }));
  return valid;
}

export function getVoiceByPreference(id, voices = VOICE_OPTIONS) {
  return voices.find(voice => voice.id === id || voice.voiceId === id) || VOICE_OPTIONS.find(voice => voice.id === 'adam') || VOICE_OPTIONS[0];
}
