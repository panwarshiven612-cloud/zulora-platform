/**
 * telegram.js — Zulora AI Telegram Bot Webhook Handler
 * ======================================================
 * Receives incoming Telegram updates, looks up the user's Firestore profile
 * (via telegram_chat_id), executes AI / Gmail / Calendar / Image tools,
 * and replies back through the Telegram Bot API — completely free, zero deps.
 *
 * Bot token: stored in env var TELEGRAM_BOT_TOKEN
 * Webhook URL: https://zulora.in/api/telegram
 */

import { randomBytes } from 'node:crypto';
import { readServerEnv } from './keyResolver.js';
import { firestoreAccessToken, generateTextWithWaterfall, verifyRequestUser } from './ai.js';
import { openGoogleSession, sealGoogleSession } from './googleOAuthStore.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ID = () =>
  readServerEnv('FIREBASE_PROJECT_ID') ||
  readServerEnv('VITE_FIREBASE_PROJECT_ID') ||
  'zulora-al';

const BOT_TOKEN = () => readServerEnv('TELEGRAM_BOT_TOKEN', { allowViteAlias: false });

const TG_API = () => `https://api.telegram.org/bot${BOT_TOKEN()}`;

// ─── Firestore REST helpers ───────────────────────────────────────────────────

function firestoreRoot() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID())}/databases/(default)/documents`;
}

async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

/** Obtain a short-lived Firestore access token via the metadata server (Vercel). */
let _cachedToken = null;
async function firestoreToken() {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 30_000) return _cachedToken.token;

  // Try Google service-account metadata (Cloud Run / Vercel with GOOGLE_APPLICATION_CREDENTIALS)
  try {
    const r = await fetchWithTimeout(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
      3_000
    );
    if (r.ok) {
      const j = await r.json();
      _cachedToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
      return _cachedToken.token;
    }
  } catch { /* not on GCP metadata — fall through */ }

  // Vercel: use FIREBASE_ADMIN_TOKEN env var (manually set Service Account token)
  const manual = readServerEnv('FIREBASE_ADMIN_TOKEN') || readServerEnv('GOOGLE_ACCESS_TOKEN');
  if (manual) return manual;

  const serviceToken = await firestoreAccessToken().catch(() => '');
  if (serviceToken) return serviceToken;

  throw new Error('No Firestore access token available. Set FIREBASE_ADMIN_TOKEN env var.');
}

/**
 * Look up a Firestore document by collection + filter.
 * Uses a simple GET if docId is known, or a runQuery for field-based lookups.
 */
async function firestoreQuery(collection, field, value) {
  const token = await firestoreToken();
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'EQUAL',
          value: { stringValue: String(value) }
        }
      },
      limit: 1
    }
  };
  const r = await fetchWithTimeout(`${firestoreRoot()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) return null;
  const results = await r.json();
  const doc = results?.[0]?.document;
  if (!doc) return null;
  // Flatten Firestore typed fields to plain JS values
  const documentId = String(doc.name || '').split('/').at(-1) || '';
  return { ...flattenFields(doc.fields || {}), documentId, ...(collection === 'users' ? { uid: documentId } : {}) };
}

async function firestoreGetDoc(path) {
  const token = await firestoreToken();
  const r = await fetchWithTimeout(`${firestoreRoot()}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const doc = await r.json();
  return doc.fields ? flattenFields(doc.fields) : null;
}

async function firestoreSetDoc(path, data) {
  const token = await firestoreToken();
  const fields = toFirestoreFields(data);
  const updateMask = Object.keys(fields).map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const r = await fetchWithTimeout(`${firestoreRoot()}/${path}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return r.ok;
}

function flattenFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) out[key] = val.stringValue;
    else if ('timestampValue' in val) out[key] = Date.parse(val.timestampValue);
    else if ('integerValue' in val) out[key] = Number(val.integerValue);
    else if ('booleanValue' in val) out[key] = val.booleanValue;
    else if ('mapValue' in val) out[key] = flattenFields(val.mapValue.fields || {});
    else if ('arrayValue' in val) out[key] = (val.arrayValue.values || []).map(v => flattenFields({ _: v })._);
    else if ('nullValue' in val) out[key] = null;
    else out[key] = val;
  }
  return out;
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'object') fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
  }
  return fields;
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function tgSendMessage(chatId, text, options = {}) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown', ...options };
  await fetchWithTimeout(`${TG_API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function tgSendPhoto(chatId, photoUrl, caption = '') {
  const body = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' };
  await fetchWithTimeout(`${TG_API()}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function tgSendTyping(chatId) {
  await fetchWithTimeout(`${TG_API()}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});
}

// ─── Intent Classifier ────────────────────────────────────────────────────────

const INTENTS = [
  { name: 'verify',        re: /^\/(?:start|verify)\s+([A-Z0-9]{6,12})\b/i },
  { name: 'start',         re: /^\/start\s*$/i },
  { name: 'help',          re: /^\/(help|commands)/i },
  { name: 'gmail',         re: /\b(analy[sz]e|summari[sz]e|emails?|inbox|gmail|mail|unread|messages?)\b/i },
  { name: 'calendar',      re: /\b(schedule|meeting|event|calendar|appointment|book)\b/i },
  { name: 'sheets',        re: /\b(?:google\s+)?(?:sheet|spreadsheet|sheets)\b/i },
  { name: 'image',         re: /\b(generate|create|make|draw|image|photo|picture|art)\b/i },
  { name: 'ai',            re: /./ } // catch-all
];

function classifyIntent(text) {
  for (const intent of INTENTS) {
    const m = text.match(intent.re);
    if (m) return { name: intent.name, match: m };
  }
  return { name: 'ai', match: null };
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

async function callGemini(prompt, systemPrompt = '') {
  return generateTextWithWaterfall(prompt, systemPrompt);
}

async function readGmailInbox(accessToken, maxResults = 5) {
  if (!accessToken) return null;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX&q=is:unread`;
  const listRes = await fetchWithTimeout(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!listRes.ok) return null;
  const { messages = [] } = await listRes.json();
  const summaries = await Promise.all(messages.slice(0, 5).map(async msg => {
    const msgRes = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!msgRes.ok) return null;
    const data = await msgRes.json();
    const headers = data.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(unknown)';
    return `• *${subject}* — from ${from}`;
  }));
  return summaries.filter(Boolean).join('\n');
}

async function generatePollinationsImage(prompt) {
  const encoded = encodeURIComponent(prompt.slice(0, 300));
  // Pollinations serves the image synchronously at this URL
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true`;
  return url; // Return URL directly — Telegram's sendPhoto will fetch it
}

async function createCalendarEvent(accessToken, title, startTime, endTime) {
  if (!accessToken) return null;
  const event = {
    summary: title,
    start: { dateTime: startTime || new Date(Date.now() + 3600_000).toISOString(), timeZone: 'UTC' },
    end: { dateTime: endTime || new Date(Date.now() + 7200_000).toISOString(), timeZone: 'UTC' }
  };
  const r = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.htmlLink || 'Event created';
}

async function createGoogleSheet(accessToken, title) {
  const response = await fetchWithTimeout('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title } })
  });
  if (!response.ok) return null;
  const sheet = await response.json();
  return sheet.spreadsheetUrl || (sheet.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheet.spreadsheetId)}/edit`
    : null);
}

async function loadTelegramGoogleAccessToken(uid) {
  const paths = [
    `users/${encodeURIComponent(uid)}/connectors/googleOAuth`,
    `users/${encodeURIComponent(uid)}/private/googleOAuth`
  ];
  let session = null;
  for (const path of paths) {
    const stored = await firestoreGetDoc(path);
    if (!stored) continue;
    const encrypted = stored.encryptedSession || stored.encrypted;
    if (encrypted) {
      try { session = openGoogleSession(uid, encrypted); }
      catch (error) { console.warn('[TelegramBot] Stored Google session could not be opened:', error.message); }
    }
    if (!session) session = stored;
    break;
  }
  if (!session) return null;

  const accessToken = session.accessToken || session.access_token || '';
  const expiryValue = session.expiresAt || session.expiry_date || 0;
  const numericExpiry = Number(expiryValue);
  const expiresAt = Number.isFinite(numericExpiry) ? numericExpiry : Date.parse(expiryValue);
  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return accessToken;

  const refreshToken = session.refreshToken || session.refresh_token || '';
  const clientId = readServerEnv('GOOGLE_CLIENT_ID', { allowViteAlias: false });
  const clientSecret = readServerEnv('GOOGLE_CLIENT_SECRET', { allowViteAlias: false });
  if (!refreshToken || !clientId || !clientSecret) return null;

  const refreshResponse = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret
    })
  });
  if (!refreshResponse.ok) return null;
  const refreshedToken = await refreshResponse.json();
  const refreshedSession = {
    ...session,
    uid,
    accessToken: refreshedToken.access_token,
    refreshToken: refreshedToken.refresh_token || refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(refreshedToken.expires_in) || 3600) * 1000,
    scopes: session.scopes || String(refreshedToken.scope || '').split(/\s+/).filter(Boolean)
  };
  try {
    await firestoreSetDoc(`users/${encodeURIComponent(uid)}/connectors/googleOAuth`, {
      encryptedSession: sealGoogleSession(uid, refreshedSession)
    });
  } catch (error) {
    console.warn('[TelegramBot] Refreshed Google session could not be saved:', error.message);
  }
  return refreshedSession.accessToken || null;
}

// ─── Verification Code Store (in-memory, 10min TTL) ──────────────────────────

const verifyCodes = new Map(); // Fast path for warm serverless instances; Firestore is authoritative.

export async function generateVerifyCode(uid) {
  const code = randomBytes(6).toString('hex').toUpperCase();
  const expiresAtMs = Date.now() + 10 * 60_000;
  verifyCodes.set(code, { uid, expiresAtMs });
  if (!await firestoreSetDoc(`telegram_codes/${code}`, { code, uid, expiresAtMs, used: false })) {
    verifyCodes.delete(code);
    throw new Error('Could not save the Telegram verification code.');
  }
  return code;
}

async function linkTelegramAccount(code, chatId, userId, username) {
  let entry = verifyCodes.get(code);
  if (!entry || entry.expiresAtMs < Date.now()) {
    entry = await firestoreGetDoc(`telegram_codes/${encodeURIComponent(code)}`);
    if (!entry?.uid) entry = await firestoreQuery('telegram_codes', 'code', code);
  }
  const expiryValue = entry?.expiresAtMs || entry?.expiresAt || entry?.expires || 0;
  const numericExpiry = Number(expiryValue);
  const expiry = Number.isFinite(numericExpiry) ? numericExpiry : Date.parse(expiryValue);
  if (!entry?.uid || entry.used || !expiry || expiry < Date.now()) return false;
  verifyCodes.delete(code);
  const linked = await firestoreSetDoc(`users/${encodeURIComponent(entry.uid)}`, {
    telegram_chat_id: String(chatId),
    telegram_user_id: String(userId),
    telegram_username: username || '',
    telegram_linked_at: new Date().toISOString()
  });
  if (!linked) throw new Error('Could not save the Telegram account link.');
  await firestoreSetDoc(`telegram_codes/${encodeURIComponent(code)}`, { used: true, usedAtMs: Date.now() });
  return true;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── Dashboard API actions (from TelegramConnectCard frontend) ─────────────
  // These are POST requests from the Zulora dashboard, not Telegram webhooks.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const action = body?.action;

  // generate_code — create a one-time verification code tied to the signed-in UID
  if (req.method === 'POST' && ['generate_code', 'check_linked'].includes(action)) {
    const uid = body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const authenticatedUid = await verifyRequestUser(req).catch(() => null);
    if (!authenticatedUid || authenticatedUid !== uid) return res.status(401).json({ error: 'Sign in to manage Telegram linking.' });
    if (action === 'generate_code') {
      try {
        const code = await generateVerifyCode(uid);
        return res.status(200).json({ ok: true, code });
      } catch (error) {
        console.warn('[TelegramBot] Verification code could not be stored:', error.message);
        return res.status(503).json({ error: 'Could not create a Telegram verification code. Please try again.' });
      }
    }
    try {
      const userData = await firestoreGetDoc(`users/${encodeURIComponent(uid)}`);
      if (userData?.telegram_chat_id) {
        return res.status(200).json({
          linked: true,
          chatId: userData.telegram_chat_id,
          username: userData.telegram_username || ''
        });
      }
    } catch { /* ignore */ }
    return res.status(200).json({ linked: false });
  }

  // ── Telegram Webhook (POST from Telegram servers) ─────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const message = body?.message || body?.edited_message;
  if (!message) return res.status(200).json({ ok: true }); // silently ack non-message updates

  const chatId = message.chat?.id;
  const userId = message.from?.id;
  const username = message.from?.username || message.from?.first_name || 'User';
  const text = (message.text || '').trim();

  if (!chatId || !text) return res.status(200).json({ ok: true });

  // Respond 200 immediately so Telegram doesn't retry (process async)
  res.status(200).json({ ok: true });

  try {
    await tgSendTyping(chatId);
    const { name: intent, match } = classifyIntent(text);

    // ── /start VERIFY_CODE — pair Telegram with Firebase account ─────────────
    if (intent === 'verify') {
      const code = match[1].toUpperCase();
      const linked = await linkTelegramAccount(code, chatId, userId, username);
      if (linked) {
        await tgSendMessage(chatId,
        `✅ *Zulora AI Connected!*\n\nHello ${username}! Your Telegram account is now linked to Zulora AI.\n\nYou can now:\n• Say _"Summarize my emails"_\n• Say _"Create a Google Sheet"_\n• Say _"Schedule a meeting tomorrow"_\n• Ask anything — I'm your AI assistant!`
        );
      } else {
        await tgSendMessage(chatId,
          `❌ Invalid or expired code. Please go to [zulora.in/dashboard](https://zulora.in/dashboard) → Connectors → Telegram to get a fresh code.`
        );
      }
      return;
    }

    // ── /start with no code — welcome message ────────────────────────────────
    if (intent === 'start') {
      await tgSendMessage(chatId,
        `👋 *Welcome to Zulora AI Bot!*\n\nI'm your personal AI assistant powered by Zulora AI.\n\n*To get started:*\n1. Visit [zulora.in/dashboard](https://zulora.in/dashboard)\n2. Go to *Connectors → Telegram*\n3. Click *Connect* to get your verification code\n4. Send it here as: \`/start YOUR_CODE\`\n\n*Commands:*\n• _"Summarize my emails"_\n• _"Create a Google Sheet"_\n• _"Generate image of [description]"_\n• _"Schedule meeting [details]"_\n• Any question — I'll answer it!`
      );
      return;
    }

    // ── /help ─────────────────────────────────────────────────────────────────
    if (intent === 'help') {
      await tgSendMessage(chatId,
        `🤖 *Zulora AI Bot — Commands*\n\n📧 *Email:* "Summarize my inbox" / "Show unread emails"\n📊 *Sheets:* "Create a Google Sheet for expenses"\n🗓 *Calendar:* "Schedule a meeting tomorrow at 3pm"\n🖼 *Image:* "Generate image of a mountain at sunset"\n💬 *AI Chat:* Just ask anything naturally!\n\n_Link your account at [zulora.in](https://zulora.in) → Connectors → Telegram_`
      );
      return;
    }

    // ── Look up user profile via telegram_chat_id ─────────────────────────────
    let userProfile = null;
    let googleAccessToken = null;
    try {
      userProfile = await firestoreQuery('users', 'telegram_chat_id', String(chatId));
      if (!userProfile) {
        userProfile = await firestoreQuery('users', 'telegram_user_id', String(userId));
      }
      if (userProfile?.uid) {
        googleAccessToken = await loadTelegramGoogleAccessToken(userProfile.uid);
      }
    } catch (e) {
      console.warn('[TelegramBot] Profile lookup failed:', e.message);
    }

    const isLinked = Boolean(userProfile?.uid);

    // ── Gmail: Summarize inbox ────────────────────────────────────────────────
    if (intent === 'gmail') {
      if (!isLinked) {
        await tgSendMessage(chatId,
          `🔗 Link your account first at [zulora.in/dashboard](https://zulora.in/dashboard) → Connectors → Telegram`
        );
        return;
      }
      if (!googleAccessToken) {
        await tgSendMessage(chatId,
          `📧 Connect your Gmail at [zulora.in/dashboard](https://zulora.in/dashboard) → Connectors → Gmail first.`
        );
        return;
      }
      const emails = await readGmailInbox(googleAccessToken, 5);
      if (!emails) {
        await tgSendMessage(chatId, `❌ Could not access Gmail. Please reconnect at [zulora.in](https://zulora.in/dashboard).`);
        return;
      }
      const summary = await callGemini(
        `Summarize these email subjects briefly and clearly:\n${emails}`,
        'You are a concise email assistant. Summarize in 3-5 bullet points. Use plain language.'
      );
      await tgSendMessage(chatId, emails ? `📧 *Your Recent Inbox:*\n\n${emails}\n\n📝 *Summary:*\n${summary}` : 'Your inbox has no unread messages.');
      return;
    }

    // ── Image Generation ──────────────────────────────────────────────────────
    if (intent === 'image') {
      const imagePrompt = text
        .replace(/^(generate|create|make|draw|image of|a photo of|picture of)\s*/i, '')
        .trim() || text;
      const imageUrl = await generatePollinationsImage(imagePrompt);
      await tgSendPhoto(chatId, imageUrl, `🎨 *"${imagePrompt.slice(0, 100)}"*\n\n_Generated by Zulora AI_`);
      return;
    }

    // ── Calendar: Create event ────────────────────────────────────────────────
    if (intent === 'calendar') {
      if (!isLinked || !googleAccessToken) {
        await tgSendMessage(chatId,
          `🗓 Connect your Google Calendar at [zulora.in/dashboard](https://zulora.in/dashboard) → Connectors first.`
        );
        return;
      }
      // Use AI to extract event details, then create
      const parsed = await callGemini(
        `Extract event details from: "${text}". Return JSON only: {"title": "...", "startISO": "...", "endISO": "..."}. Use reasonable defaults if missing. Current time: ${new Date().toISOString()}`,
        'You are a calendar assistant. Return only valid JSON.'
      );
      let eventData = {};
      try { eventData = JSON.parse(parsed.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {}
      const link = await createCalendarEvent(
        googleAccessToken,
        eventData.title || text,
        eventData.startISO,
        eventData.endISO
      );
      if (link) {
        await tgSendMessage(chatId, `✅ *Event Created!*\n\n📅 ${eventData.title || 'Event'}\n[View in Calendar](${link})`);
      } else {
        await tgSendMessage(chatId, `❌ Could not create event. Please reconnect your Calendar at [zulora.in](https://zulora.in/dashboard).`);
      }
      return;
    }

    if (intent === 'sheets') {
      if (!isLinked || !googleAccessToken) {
        await tgSendMessage(chatId, `📊 Connect Google Sheets at [zulora.in/dashboard](https://zulora.in/dashboard) → Connectors first.`);
        return;
      }
      const requestedTitle = text
        .replace(/^\/(?:start|verify)\s+[A-Z0-9]{6,12}\s*/i, '')
        .replace(/^(?:please\s+)?(?:create|make|build)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?(?:google\s+)?(?:sheet|spreadsheet)(?:\s+(?:named|called|for|about))?\s*/i, '')
        .trim();
      const title = (requestedTitle || 'Zulora Sheet').slice(0, 120);
      const link = await createGoogleSheet(googleAccessToken, title);
      if (link) await tgSendMessage(chatId, `✅ *Google Sheet created*\n\n${title}\n${link}`);
      else await tgSendMessage(chatId, 'Could not create the Google Sheet. Please reconnect Google Sheets at zulora.in/dashboard and try again.');
      return;
    }

    // ── General AI fallback ───────────────────────────────────────────────────
    const systemPrompt = isLinked && userProfile?.displayName
      ? `You are Zulora AI, a helpful assistant. The user's name is ${userProfile.displayName}. Be concise and friendly. Use Markdown for formatting.`
      : `You are Zulora AI, a helpful AI assistant. Be concise and friendly. Use Markdown formatting.`;

    const aiReply = await callGemini(text, systemPrompt);
    await tgSendMessage(chatId, aiReply.slice(0, 4000)); // Telegram max ~4096 chars

  } catch (err) {
    console.error('[TelegramBot] Handler error:', err);
    await tgSendMessage(chatId, '⚠️ Something went wrong. Please try again in a moment.').catch(() => {});
  }
}

