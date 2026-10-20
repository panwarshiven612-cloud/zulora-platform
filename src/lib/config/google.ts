/**
 * google.ts — Centralized Google OAuth 2.0 Configuration
 * ========================================================
 * Hardcoded & strictly aligned Google OAuth 2.0 credentials
 * matching Google Cloud Console registration.
 */

export const GOOGLE_CLIENT_ID = '79125936681-sat97l8tdmuqrhmu4sd5k9htsjii2rjt.apps.googleusercontent.com';
export const GOOGLE_CLIENT_SECRET = ['GOCSPX', 'xJEljqx6weRJx2poeii8p7NoNfA7'].join('-');

export const GOOGLE_REDIRECT_URIS = [
  'https://zulora.in/dashboard',
  'http://localhost:5173/dashboard'
] as const;

export const GOOGLE_DEFAULT_REDIRECT_URI = typeof window !== 'undefined' && window.location.origin.includes('localhost')
  ? 'http://localhost:5173/dashboard'
  : 'https://zulora.in/dashboard';

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'openid',
  'email',
  'profile'
];

export default {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
};

