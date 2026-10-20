/** Public browser OAuth configuration. Client secrets stay server-side. */
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_REDIRECT_URIS,
  GOOGLE_OAUTH_REDIRECT_URI
} from './env';

export const GOOGLE_CLIENT_ID = GOOGLE_OAUTH_CLIENT_ID;
export const GOOGLE_REDIRECT_URIS = GOOGLE_OAUTH_REDIRECT_URIS;
export const GOOGLE_DEFAULT_REDIRECT_URI = GOOGLE_OAUTH_REDIRECT_URI;

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
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
};

