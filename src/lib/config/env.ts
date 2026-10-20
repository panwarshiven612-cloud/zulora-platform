const publicEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};

export const GOOGLE_OAUTH_CLIENT_ID = String(
  publicEnv.VITE_GOOGLE_CLIENT_ID || '791256936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com'
).trim();

export const GOOGLE_OAUTH_REDIRECT_URIS = Object.freeze([
  'https://zulora.in/dashboard',
  'http://localhost:5173/dashboard'
]);

const localOrigin = typeof window !== 'undefined' && window.location.origin === 'http://localhost:5173';
const configuredRedirectUri = String(publicEnv.VITE_GOOGLE_REDIRECT_URI || '').trim();

export const GOOGLE_OAUTH_REDIRECT_URI = GOOGLE_OAUTH_REDIRECT_URIS.includes(configuredRedirectUri)
  ? configuredRedirectUri
  : GOOGLE_OAUTH_REDIRECT_URIS[localOrigin ? 1 : 0];
