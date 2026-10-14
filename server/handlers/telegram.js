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

import { readServerEnv } from './keyResolver.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ID = () =>
  readServerEnv('FIREBASE_PROJECT_ID') ||
  readServerEnv('VITE_FIREBASE_PROJECT_ID') ||
  'zulora-al';

const BOT_TOKEN = () =>
  readServerEnv('TELEGRAM_BOT_TOKEN') ||
  '8777678845:AAFMNVnvHUHdcF1ULvZtpwdhZ8PBKrcHW7k';

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
  return flattenFields(doc.fields || {});
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
  const r = await fetchWithTimeout(`${firestoreRoot()}/${path}`, {
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
  { name: 'verify',        re: /^\/start\s+([A-Z0-9]{6,12})/i },
  { name: 'start',         re: /^\/start\s*$/i },
  { name: 'help',          re: /^\/(help|commands)/i },
  { name: 'gmail',         re: /\b(email|inbox|gmail|mail|unread|messages?)\b/i },
  { name: 'image',         re: /\b(generate|create|make|draw|image|photo|picture|art)\b/i },
  { name: 'calendar',      re: /\b(schedule|meeting|event|calendar|appointment|book)\b/i },
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
  const geminiKey = readServerEnv('GEMINI_API_KEY') || readServerEnv('VITE_GEMINI_API_KEY');
  if (!geminiKey) return 'Zulora AI: No Gemini key configured on the server.';

  const model = readServerEnv('GEMINI_FLASH_MODEL') || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const body = {
    contents,
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    generationConfig: { maxOutputTokens: 1024 }
  };
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 20_000);
  if (!r.ok) return `AI error: HTTP ${r.status}`;
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';
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

// ─── Verification Code Store (in-memory, 10min TTL) ──────────────────────────

const verifyCodes = new Map(); // code -> { uid, expires }

export function generateVerifyCode(uid) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  verifyCodes.set(code, { uid, expires: Date.now() + 10 * 60_000 });
  return code;
}

async function linkTelegramAccount(code, chatId, userId, username) {
  const entry = verifyCodes.get(code);
  if (!entry || entry.expires < Date.now()) return false;
  verifyCodes.delete(code);
  // Write telegram fields to users/{uid} in Firestore
  await firestoreSetDoc(`users/${entry.uid}`, {
    telegram_chat_id: String(chatId),
    telegram_user_id: String(userId),
    telegram_username: username || '',
    telegram_linked_at: new Date().toISOString()
  });
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

  // generate_code — create a 6-char verification code tied to the user's UID
  if (req.method === 'POST' && action === 'generate_code') {
    const uid = body?.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const code = generateVerifyCode(uid);
    return res.status(200).json({ ok: true, code });
  }

  // check_linked — check if the user's Firebase account is now paired with Telegram
  if (req.method === 'POST' && action === 'check_linked') {
    const uid = body?.uid;
    if (!uid) return res.status(400).json({ linked: false });
    try {
      const userData = await firestoreGetDoc(`users/${uid}`);
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
          `✅ *Zulora AI Connected!*\n\nHello ${username}! Your Telegram account is now linked to Zulora AI.\n\nYou can now:\n• Say _"Summarize my emails"_\n• Say _"Generate image of a sunset"_\n• Say _"Schedule a meeting tomorrow"_\n• Ask anything — I'm your AI assistant!`
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
        `👋 *Welcome to Zulora AI Bot!*\n\nI'm your personal AI assistant powered by Zulora AI.\n\n*To get started:*\n1. Visit [zulora.in/dashboard](https://zulora.in/dashboard)\n2. Go to *Connectors → Telegram*\n3. Click *Connect* to get your verification code\n4. Send it here as: \`/start YOUR_CODE\`\n\n*Commands:*\n• _"Summarize my emails"_\n• _"Generate image of [description]"_\n• _"Schedule meeting [details]"_\n• Any question — I'll answer it!`
      );
      return;
    }

    // ── /help ─────────────────────────────────────────────────────────────────
    if (intent === 'help') {
      await tgSendMessage(chatId,
        `🤖 *Zulora AI Bot — Commands*\n\n📧 *Email:* "Summarize my inbox" / "Show unread emails"\n🗓 *Calendar:* "Schedule a meeting tomorrow at 3pm"\n🖼 *Image:* "Generate image of a mountain at sunset"\n💬 *AI Chat:* Just ask anything naturally!\n\n_Link your account at [zulora.in](https://zulora.in) → Connectors → Telegram_`
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
        const connectors = await firestoreGetDoc(`users/${userProfile.uid}/connectors/googleOAuth`);
        googleAccessToken = connectors?.accessToken || null;
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
      await tgSendMessage(chatId, `📧 *Your Recent Inbox:*\n\n${emails}\n\n📝 *Summary:*\n${summary}`);
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

    // ── General AI fallback ───────────────────────────────────────────────────
    const systemPrompt = isLinked && userProfile?.displayName
      ? `You are Zulora AI, a helpful assistant. The user's name is ${userProfile.displayName}. Be concise and friendly. Use Markdown for formatting.`
      : `You are Zulora AI, a helpful AI assistant. Be concise and friendly. Use Markdown formatting.`;

    const aiReply = await callGemini(text, systemPrompt);
    await tgSendMessage(chatId, aiReply.slice(0, 4000)); // Telegram max ~4096 chars

  } catch (err) {
    console.error('[TelegramBot] Handler error:', err);
    await tgSendMessage(chatId, `⚠️ Something went wrong. Please try again in a moment.\n\n_Error: ${err.message?.slice(0, 100)}_`).catch(() => {});
  }
}

