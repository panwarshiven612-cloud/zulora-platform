const publicEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};

// Keep the browser authorization request aligned with the server token exchange.
// The OAuth client ID is public; its matching secret remains server-only.
export const GOOGLE_OAUTH_CLIENT_ID = '79125936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com';

export const GOOGLE_OAUTH_AUTHORIZED_ORIGINS = Object.freeze([
  'https://zulora.in',
  'http://localhost:5173'
]);

export const GOOGLE_OAUTH_REDIRECT_URIS = Object.freeze([
  'https://zulora.in/dashboard',
  'http://localhost:5173/dashboard'
]);

const configuredRedirectUri = String(publicEnv.VITE_GOOGLE_REDIRECT_URI || '').trim();
const sameOriginRedirectUri = typeof window !== 'undefined'
  && GOOGLE_OAUTH_AUTHORIZED_ORIGINS.includes(window.location.origin)
  ? `${window.location.origin}/dashboard`
  : '';

export const GOOGLE_OAUTH_REDIRECT_URI = GOOGLE_OAUTH_REDIRECT_URIS.includes(configuredRedirectUri)
  && (!sameOriginRedirectUri || new URL(configuredRedirectUri).origin === window.location.origin)
  ? configuredRedirectUri
  : GOOGLE_OAUTH_REDIRECT_URIS.includes(sameOriginRedirectUri)
    ? sameOriginRedirectUri
    : GOOGLE_OAUTH_REDIRECT_URIS[0];
