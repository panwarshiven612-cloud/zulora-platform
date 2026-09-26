import { createPublicKey, createSign, verify as verifySignature } from 'node:crypto';
import { apiKeyPool, availableProviders, providerKeys } from './apiKeyPool.js';
import { buildSystemPrompt, FLAGSHIP_SYSTEM_PROMPT } from '../src/services/systemPrompt.js';

export const maxDuration = 60;
export const config = { maxDuration };

const CHAT_ORDER = ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter'];
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_HIGH_CAPACITY_MODEL = process.env.GEMINI_HIGH_CAPACITY_MODEL || 'gemini-3.8-flash';
const GEMINI_FLASH_VARIANTS = [...new Set([GEMINI_HIGH_CAPACITY_MODEL, 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])];
const TOKEN_LIMITS = { free: 10_000, pro: 50_000, ultra: 100_000 };
const TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROMPT_BURST_WINDOW_MS = 2 * 60 * 1000;
const PROMPT_BURST_LIMIT = 8;
const SOFT_COOLDOWN_MS = 5 * 60 * 1000;
let cachedFirestoreToken = null;
let cachedFirebaseCertificates = null;

const json = (res, status, payload) => res.status(status).json(payload);
const bearer = req => String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
const safeError = (res, status, message, extra = {}) => json(res, status, { error: message, ...extra });

function firestoreAdminCredentials() {
  const serviceAccountValue = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_KEY || '';
  let serviceAccount = {};
  try { serviceAccount = JSON.parse(serviceAccountValue); }
  catch { /* The admin key may be supplied as a separate PEM value. */ }
  const email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || serviceAccount.client_email;
  const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || serviceAccount.private_key ||
    (serviceAccountValue.includes('BEGIN PRIVATE KEY') ? serviceAccountValue : '');
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
  return email && privateKey ? { email, privateKey } : null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchProviderWithRetry(url, options, timeoutMs = 16_000, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
    if (response.ok || !retryable || attempt === maxAttempts - 1) return response;
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4_000) : 350 * (attempt + 1);
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  throw new Error('Provider request retry limit exceeded.');
}

async function firebaseCertificates(forceRefresh = false) {
  if (!forceRefresh && cachedFirebaseCertificates?.expiresAt > Date.now()) return cachedFirebaseCertificates.certificates;
  const response = await fetchWithTimeout('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', {}, 8_000);
  if (!response.ok) throw new Error(`Firebase signing certificates returned HTTP ${response.status}.`);
  const certificates = await response.json();
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1]) || 300;
  cachedFirebaseCertificates = { certificates, expiresAt: Date.now() + maxAge * 1000 };
  return certificates;
}

async function verifyUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra !== undefined) return null;

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') return null;

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'zulora-al';
  const now = Math.floor(Date.now() / 1000);
  if (
    header.alg !== 'RS256' || typeof header.kid !== 'string' ||
    claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) || claims.exp <= now ||
    !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
    !Number.isFinite(claims.auth_time) || claims.auth_time > now + 60
  ) return null;

  let certificates = await firebaseCertificates();
  if (!certificates[header.kid]) certificates = await firebaseCertificates(true);
  const certificate = certificates[header.kid];
  if (!certificate) return null;
  const valid = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey(certificate),
    Buffer.from(encodedSignature, 'base64url')
  );
  return valid ? claims.sub : null;
}

const firestoreRoot = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'zulora-al';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
};

const firestoreDoc = uid => `${firestoreRoot()}/users/${encodeURIComponent(uid)}`;

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function firestoreAccessToken() {
  if (cachedFirestoreToken?.expiresAt > Date.now() + 60_000) return cachedFirestoreToken.token;
  const credentials = firestoreAdminCredentials();
  if (!credentials) throw new Error('Firestore Admin credentials are not configured on the server.');
  const { email, privateKey } = credentials;
  const now = Math.floor(Date.now() / 1000);
  const claims = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + base64Url(JSON.stringify({
    iss: email, sub: email, aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/datastore', iat: now, exp: now + 3600
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(claims);
  const assertion = `${claims}.${signer.sign(privateKey, 'base64url')}`;
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  }, 8_000);
  if (!response.ok) throw new Error('Could not authorize the Firestore usage service.');
  const data = await response.json();
  if (!data.access_token) throw new Error('Google did not return a Firestore access token.');
  cachedFirestoreToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedFirestoreToken.token;
}

function readValue(value) {
  if (!value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(readValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, field]) => [key, readValue(field)]));
  return null;
}

function readProfile(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, readValue(value)]));
}

function toFirestoreValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toFirestoreValue(child)])) } };
  return { nullValue: null };
}

async function readUsageProfile(uid, token, transaction) {
  const suffix = transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
  const response = await fetchWithTimeout(`${firestoreDoc(uid)}${suffix}`, { headers: { Authorization: `Bearer ${token}` } }, 8_000);
  if (response.status === 404) return { error: 'User profile was not found. Sign in again to initialize your account.' };
  if (!response.ok) throw new Error('Could not read usage limits from Firestore.');
  return { profile: readProfile(await response.json()) };
}

async function readPlan(uid) {
  const adminToken = await firestoreAccessToken();
  const { profile, error } = await readUsageProfile(uid, adminToken);
  if (error) return { allowed: false, error };
  const values = [profile.planTier, profile.tier].map(value => String(value || '').toLowerCase().replace(/[ _-]/g, ''));
  const planTier = values.some(value => value.includes('ultra')) ? 'ultra' : values.some(value => value.includes('pro')) ? 'pro' : 'free';
  return { planTier };
}

function tokenUsageState(profile, now = Date.now()) {
  const usage = { ...(profile.usage || {}) };
  const rawTiers = [profile.planTier, profile.tier].map(value => String(value || '').toLowerCase().replace(/[ _-]/g, ''));
  const tier = rawTiers.some(value => value.includes('ultra')) ? 'ultra' : rawTiers.some(value => value.includes('pro')) ? 'pro' : 'free';
  const previousStart = Number(usage.tokenWindowStart) || now;
  const expired = now - previousStart >= TOKEN_WINDOW_MS || previousStart > now;
  const windowStart = expired ? now : previousStart;
  const current = expired ? 0 : Math.max(0, Number(usage.tokenUsed) || 0);
  const limit = TOKEN_LIMITS[tier];
  const cooldownUntil = Math.max(0, Number(profile.rateLimit?.cooldownUntil) || 0);
  return {
    usage, tier, current, limit, windowStart, resetAt: windowStart + TOKEN_WINDOW_MS,
    allowed: current < limit, cooldownUntil, softCooldown: cooldownUntil > now
  };
}

async function readTokenUsageState(uid) {
  const token = await firestoreAccessToken();
  const { profile, error } = await readUsageProfile(uid, token);
  if (error) throw new Error(error);
  return tokenUsageState(profile);
}

async function incrementTokenUsage(uid, estimatedTokens = 1000, allowOverage = false) {
  const adminToken = await firestoreAccessToken();
  const charge = Math.max(1, Math.min(20_000, Math.ceil(Number(estimatedTokens) || 1000)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const begin = await fetchWithTimeout(`${firestoreRoot()}:beginTransaction`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { readWrite: {} } })
    }, 8_000);
    if (!begin.ok) throw new Error('Could not start Firestore token usage transaction.');
    const transaction = (await begin.json()).transaction;
    const { profile, error } = await readUsageProfile(uid, adminToken, transaction);
    if (error) throw new Error(error);
    const state = tokenUsageState(profile);
    if (!state.allowed && !allowOverage) return { allowed: false, usedPercent: 100, resetAt: state.resetAt, planTier: state.tier };
    const usage = { ...state.usage, tokenUsed: state.current + charge, tokenWindowStart: state.windowStart };
    const write = {
      update: { name: firestoreDoc(uid), fields: { usage: toFirestoreValue(usage) } },
      updateMask: { fieldPaths: ['usage'] }
    };
    const commit = await fetchWithTimeout(`${firestoreRoot()}:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction, writes: [write] })
    }, 8_000);
    if (commit.ok) return {
      allowed: true,
      usedTokens: state.current + charge,
      processedTokens: charge,
      tokenLimit: state.limit,
      usedPercent: Math.max(0, Math.min(100, Math.floor(((state.current + charge) / state.limit) * 100))),
      resetAt: state.resetAt,
      planTier: state.tier
    };
    const details = await commit.text();
    if (attempt < 2 && (commit.status === 409 || details.includes('ABORTED'))) continue;
    throw new Error('Firestore rejected the token usage update.');
  }
  throw new Error('Firestore token usage update could not be committed.');
}

async function registerPromptAttempt(uid, now = Date.now()) {
  const adminToken = await firestoreAccessToken();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const begin = await fetchWithTimeout(`${firestoreRoot()}:beginTransaction`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { readWrite: {} } })
    }, 8_000);
    if (!begin.ok) throw new Error('Could not start the Firestore rate-limit transaction.');
    const transaction = (await begin.json()).transaction;
    const { profile, error } = await readUsageProfile(uid, adminToken, transaction);
    if (error) throw new Error(error);
    const rateLimit = { ...(profile.rateLimit || {}) };
    const cooldownUntil = Number(rateLimit.cooldownUntil) || 0;
    if (cooldownUntil > now) {
      await fetchWithTimeout(`${firestoreRoot()}:rollback`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction })
      }, 8_000).catch(() => {});
      return { allowed: false, softCooldown: true, cooldownUntil };
    }
    const promptTimes = (Array.isArray(rateLimit.promptTimes) ? rateLimit.promptTimes : [])
      .map(Number).filter(timestamp => Number.isFinite(timestamp) && timestamp > now - PROMPT_BURST_WINDOW_MS && timestamp <= now);
    if (promptTimes.length >= PROMPT_BURST_LIMIT) {
      const until = now + SOFT_COOLDOWN_MS;
      const write = {
        update: { name: firestoreDoc(uid), fields: { rateLimit: toFirestoreValue({ promptTimes: [...promptTimes, now].slice(-PROMPT_BURST_LIMIT - 1), cooldownUntil: until }) } },
        updateMask: { fieldPaths: ['rateLimit'] }
      };
      const commit = await fetchWithTimeout(`${firestoreRoot()}:commit`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction, writes: [write] })
      }, 8_000);
      if (commit.ok) return { allowed: false, softCooldown: true, cooldownUntil: until };
      const details = await commit.text();
      if (attempt < 2 && (commit.status === 409 || details.includes('ABORTED'))) continue;
      throw new Error('Firestore rejected the prompt rate-limit update.');
    }
    const write = {
      update: { name: firestoreDoc(uid), fields: { rateLimit: toFirestoreValue({ promptTimes: [...promptTimes, now], cooldownUntil: 0 }) } },
      updateMask: { fieldPaths: ['rateLimit'] }
    };
    const commit = await fetchWithTimeout(`${firestoreRoot()}:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction, writes: [write] })
    }, 8_000);
    if (commit.ok) return { allowed: true, softCooldown: false, cooldownUntil: 0 };
    const details = await commit.text();
    if (attempt < 2 && (commit.status === 409 || details.includes('ABORTED'))) continue;
    throw new Error('Firestore rejected the prompt rate-limit update.');
  }
  throw new Error('Firestore prompt rate-limit update could not be committed.');
}

export async function verifyRequestUser(req) { return verifyUser(req); }

export async function recordUtrAndActivate(uid, utr) {
  const adminToken = await firestoreAccessToken();
  const now = Date.now();
  const { profile, error } = await readUsageProfile(uid, adminToken);
  if (error) throw new Error(error);
  const existingTier = [profile.planTier, profile.tier].map(value => String(value || '').toLowerCase().replace(/[ _-]/g, ''));
  if (existingTier.some(value => value.includes('ultra'))) {
    const activePlan = new Error('Your Ultra plan is already active.');
    activePlan.status = 409;
    throw activePlan;
  }
  if (existingTier.some(value => value.includes('pro'))) {
    const activePlan = new Error('Your Pro plan is already active.');
    activePlan.status = 409;
    throw activePlan;
  }
  const paymentDoc = `${firestoreRoot()}/payments/utr_logs/entries/${encodeURIComponent(utr)}`;
  const paymentParent = `${firestoreRoot()}/payments/utr_logs`;
  const writes = [
    {
      update: { name: paymentParent, fields: { collection: { stringValue: 'utr_logs' }, updatedAt: { integerValue: String(now) } } },
      updateMask: { fieldPaths: ['collection', 'updatedAt'] }
    },
    {
      update: { name: paymentDoc, fields: {
        uid: { stringValue: uid }, utr: { stringValue: utr }, planTier: { stringValue: 'pro' },
        status: { stringValue: 'activated' }, submittedAt: { integerValue: String(now) },
        verificationMethod: { stringValue: 'upi-utr-submission' }
      } },
      currentDocument: { exists: false }
    },
    {
      update: { name: firestoreDoc(uid), fields: {
        planTier: { stringValue: 'pro' }, tier: { stringValue: 'pro' }, isPro: { booleanValue: true },
        proActivatedAt: { integerValue: String(now) }, paymentUtr: { stringValue: utr }
      } },
      updateMask: { fieldPaths: ['planTier', 'tier', 'isPro', 'proActivatedAt', 'paymentUtr'] }
    }
  ];
  const commit = await fetchWithTimeout(`${firestoreRoot()}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes })
  }, 12_000);
  if (!commit.ok) {
    const details = await commit.text();
    if (commit.status === 409 || details.includes('ALREADY_EXISTS') || details.includes('FAILED_PRECONDITION')) {
      const duplicate = new Error('This 12-digit UTR has already been submitted.');
      duplicate.status = 409;
      throw duplicate;
    }
    throw new Error('Could not record the UTR or activate the plan.');
  }
  return { activated: true, planTier: 'pro', submittedAt: now };
}

export async function getTokenUsageStatus(uid) {
  const state = await readTokenUsageState(uid);
  return {
    usedPercent: Math.max(0, Math.min(100, Math.floor((state.current / state.limit) * 100))),
    usedTokens: state.current,
    tokenLimit: state.limit,
    resetAt: new Date(state.resetAt).toISOString(),
    blocked: !state.allowed,
    softCooldown: state.softCooldown,
    cooldownUntil: state.softCooldown ? new Date(state.cooldownUntil).toISOString() : null,
    tier: state.tier
  };
}

const parseRetryAfter = response => {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
};

function attachmentParts(attachments = []) {
  return attachments.filter(item => /^image\/(png|jpe?g|webp|gif)$/i.test(item.mimeType || '') && item.base64)
    .map(item => {
      const match = String(item.base64).match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return { mimeType: match[1], data: match[2] };
    }).filter(Boolean);
}

function plainMessages(messages, systemPrompt) {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') }))
  ];
}

async function readProviderEventStream(response, readToken, onToken, streamState, onUsage = undefined) {
  if (!response.body) throw new Error('The model returned no response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  const consume = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.usageMetadata || event.usage) onUsage?.(event.usageMetadata || event.usage);
    const token = readToken(event);
    if (typeof token === 'string' && token) {
      output += token;
      streamState.sent = true;
      onToken(token);
    }
    if (event.error?.message) throw new Error(event.error.message);
  };
  const readChunk = async () => {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('The model stream stalled. Switching to a fallback model.')), 10_000);
        })
      ]);
    } catch (error) {
      try { await reader.cancel(error); } catch { /* The provider may already have closed the stream. */ }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    while (true) {
      const { value, done } = await readChunk();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      frames.forEach(consume);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  return output;
}

async function tryOpenAiProvider(provider, messages, options = {}) {
  const configs = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: options.model || 'llama-3.3-70b-versatile', label: 'Groq LPU' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: options.model || 'openrouter/free', label: 'OpenRouter' },
    cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', model: options.model || 'llama3.1-70b', label: 'Cerebras' },
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', model: options.model || 'mistral-large-latest', label: 'Mistral AI' }
  };
  const config = configs[provider];
  const parts = attachmentParts(options.attachments);
  const keys = apiKeyPool.candidates(provider);
  for (const { key, index } of keys) {
    try {
      const contentMessages = messages.map((message, messageIndex) => {
        if (provider === 'openrouter' && parts.length && messageIndex === messages.length - 1) {
          return { role: message.role, content: [
            { type: 'text', text: message.content },
            ...parts.map(part => ({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }))
          ] };
        }
        return message;
      });
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      if (provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://zulora.in', 'X-Title': 'Zulora AI' });
      const requestBody = {
        model: config.model,
        messages: contentMessages,
        temperature: options.reasoning ? 0.6 : 0.7,
        ...(options.stream ? { stream: true } : {}),
        ...(options.reasoning && provider === 'groq'
          ? { max_completion_tokens: options.maxTokens || 8192, reasoning_effort: 'high', reasoning_format: 'hidden' }
          : { max_tokens: options.maxTokens || (options.coding ? 8192 : 4096) })
      };
      if (provider === 'groq') {
        if (config.model === 'llama-3.3-70b-versatile') {
          console.log("⚡ Calling Groq LPU API with model: llama-3.3-70b-versatile");
        } else {
          console.log(`⚡ Calling Groq LPU API with model: ${config.model}`);
        }
      }
      const response = await fetchProviderWithRetry(config.url, {
        method: 'POST', headers,
        body: JSON.stringify(requestBody)
      }, options.stream ? 12_000 : 15_000, options.stream ? 1 : 3);
      if (response.ok) {
        options.onProvider?.(config.label, config.model);
        let tokenUsage;
        let text;
        if (options.stream) {
          text = await readProviderEventStream(response, event => event.choices?.[0]?.delta?.content, options.onToken, options.streamState, usage => { tokenUsage = normalizeTokenUsage(usage); });
        } else {
          const data = await response.json();
          text = data.choices?.[0]?.message?.content;
          tokenUsage = normalizeTokenUsage(data.usage);
        }
        if (typeof text === 'string' && (text.trim() || (options.stream && options.streamState?.sent))) {
          apiKeyPool.succeeded(provider, index);
          return { text: text.trim(), tokenUsage, provider: `${config.label}${provider === 'openrouter' ? ` (Key #${index + 1})` : ''}`, model: config.model };
        }
      }
      console.warn(`${config.label} text request failed with HTTP ${response.status}.`);
      apiKeyPool.failed(provider, index, parseRetryAfter(response));
    } catch (error) {
      console.warn(`${config.label} text request failed:`, error.message);
      apiKeyPool.failed(provider, index);
      if (options.stream && options.streamState?.sent) {
        options.onReset?.();
        options.streamState.sent = false;
      }
    }
  }
  return null;
}

async function tryGemini(messages, options = {}) {
  const parts = attachmentParts(options.attachments);
  const systemPrompt = messages.find(message => message.role === 'system')?.content || '';
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }, ...(message.role === 'user' && parts.length && message === messages.filter(item => item.role !== 'system').at(-1)
      ? parts.map(part => ({ inline_data: { mime_type: part.mimeType, data: part.data } })) : [])]
  }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  const keys = apiKeyPool.candidates('gemini', { preferBest: Boolean(options.preferBestKey) });
  for (const { key, index } of keys) {
    const startedAt = Date.now();
    try {
      const model = options.model || 'gemini-2.5-flash';
      const endpoint = options.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      const response = await fetchProviderWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents,
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          ...(options.enableWebSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { temperature: 0.7, maxOutputTokens: options.coding || options.flagship ? 8192 : (options.model === 'gemini-2.5-pro' ? 8192 : 4096) }
        })
      }, options.stream ? 12_000 : 16_000, options.stream ? 1 : 3);
      if (response.ok) {
        options.onProvider?.('Google Gemini', model);
        let data;
        let text;
        if (options.stream) {
          let usageMetadata;
          text = await readProviderEventStream(response, event => event.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(''), options.onToken, options.streamState, usage => { usageMetadata = usage; });
          data = { usageMetadata };
        } else {
          data = await response.json();
          text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
        }
        const candidate = data.candidates?.[0];
        if (text || (options.stream && options.streamState?.sent)) {
          apiKeyPool.succeeded('gemini', index, Date.now() - startedAt);
          const grounding = candidate?.groundingMetadata || {};
          const chunks = grounding.groundingChunks || [];
          const sources = chunks.map(chunk => chunk.web && ({ title: chunk.web.title || chunk.web.uri, url: chunk.web.uri })).filter(Boolean);
          return { text, tokenUsage: normalizeTokenUsage(data.usageMetadata), provider: `Google Gemini (Key #${index + 1})`, model, sources };
        }
      }
      console.warn(`Google Gemini text request failed with HTTP ${response.status}.`);
      if ([404, 503].includes(response.status)) options.onModelUnavailable?.(model, response.status);
      if ([401, 403, 429].includes(response.status)) apiKeyPool.failed('gemini', index, parseRetryAfter(response));
      else apiKeyPool.advance('gemini', index);
    } catch (error) {
      console.warn('Google Gemini text request failed:', error.message);
      apiKeyPool.failed('gemini', index);
      if (options.stream && options.streamState?.sent) {
        options.onReset?.();
        options.streamState.sent = false;
      }
    }
  }
  return null;
}

async function tryGeminiWithModelFallback(messages, options = {}) {
  const preferredModel = options.model || 'gemini-2.5-flash';
  let modelUnavailable = false;
  const result = await tryGemini(messages, {
    ...options,
    model: preferredModel,
    onModelUnavailable: () => { modelUnavailable = true; }
  });
  if (result || !modelUnavailable) return result;

  const alternatives = [...new Set([...GEMINI_FLASH_VARIANTS, 'gemini-2.5-flash-lite'])]
    .filter(model => model !== preferredModel);
  for (const model of alternatives) {
    const fallback = await tryGemini(messages, { ...options, model });
    if (fallback) return fallback;
  }
  return null;
}

async function tryPollinationsText(messages, options = {}) {
  const prompt = messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
  const response = providerKeys.pollinations
    ? await fetchWithTimeout('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${providerKeys.pollinations}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistralai/mistral-small-3.2', messages, max_tokens: options.coding ? 8192 : 4096 })
    }, 18_000)
    : await fetchWithTimeout(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=mistral&seed=${Date.now() % 10000}`, {}, 18_000);
  if (!response.ok) throw new Error(`Pollinations text request failed (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : null;
  const text = data
    ? data.choices?.[0]?.message?.content || data.output_text || data.output?.[0]?.content?.[0]?.text || ''
    : await response.text();
  if (!text || text.trim().length < 5) throw new Error('Pollinations returned an empty response.');
  return { text, provider: 'Pollinations', model: 'mistralai/mistral-small-3.2' };
}

function normalizeModelPreference(value) {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (/^gemini-\d+(?:\.\d+)?-[a-z0-9.-]+$/.test(raw)) return raw;
  const selected = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (selected === 'think' || selected.includes('thinking') || selected.includes('3.5 pro ultra') || selected.includes('pro ultra')) return 'think';
  if (selected === 'llama' || (selected.includes('llama') && selected.includes('70b'))) return 'llama';
  if (selected === 'groq' || selected.includes('groq')) return 'groq';
  if (selected === 'gemini' || selected === 'flash' || selected.includes('gemini flash') || (/^gemini\s+\d/.test(selected) && selected.includes('flash'))) return 'gemini';
  if (selected === 'pro 3.14' || selected === 'zulora pro 3.14' || selected === 'pro' || selected === 'pro 314') return 'pro';
  if (selected === 'auto' || !selected) return 'auto';
  if (['high reason', 'high reasoning', 'reasoning'].includes(selected)) return 'think';
  return 'auto';
}

function chooseChatOrder(preference, autoSelected = false) {
  if (preference === 'groq' && !autoSelected) return ['groq', ...CHAT_ORDER.filter(provider => provider !== 'groq')];
  return CHAT_ORDER;
}

async function generateChat(body, streamOptions = {}) {
  const requestedPreference = normalizeModelPreference(body.modelPreference || body.model);
  const flagship = requestedPreference === 'think';
  const systemPrompt = `${buildSystemPrompt(body.contextMemory, new Date(), body.aiBrain, body.userVault)}${flagship ? FLAGSHIP_SYSTEM_PROMPT : ''}`;
  const messages = plainMessages(body.messages, systemPrompt);
  const attachments = attachmentParts(body.attachments);
  if (body.attachments?.length && !attachments.length) throw new Error('The attached image format is unsupported. Use PNG, JPEG, WebP, or GIF.');
  const vision = attachments.length > 0;
  const latestUserPrompt = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const coding = Boolean(body.coding) || /(?:\bcode\b|\bhtml\b|\bcss\b|\bjs\b|\bjavascript\b|\breact\b|\bfunction\b|\bbuild\s+(?:a\s+)?ui\b|\bwebsite\b|\bwebpage\b|\bweb\s+app\b|\blanding\s+page\b|\b(?:1000|\d{4,})\s*(?:\+\s*)?lines?\b|\bfull\s+(?:landing\s+page|website|web\s+app|application)\b|\binteractive\s+app\b|\bcomplete\s+(?:landing\s+page|website|web\s+app|application)\b)/i.test(latestUserPrompt);
  const complex = ['pro', 'think', 'high_reason', 'pro_314', 'pro_ultra'].includes(requestedPreference) ||
    /\b(?:complex|think deeply|reason(?:ing)?|analy[sz]e|analysis|architecture|derive|evaluate|proof|step by step|high reason)\b/i.test(latestUserPrompt);
  const preference = requestedPreference === 'auto' ? (coding ? 'pro' : complex ? 'pro' : 'flash') : requestedPreference;
  const useProModel = ['pro', 'think', 'high_reason', 'pro_314', 'pro_ultra'].includes(preference);
  const geminiModel = String(preference).startsWith('gemini-')
    ? preference
    : requestedPreference === 'gemini' ? (coding || complex ? GEMINI_HIGH_CAPACITY_MODEL : GEMINI_FAST_MODEL)
      : flagship ? GEMINI_HIGH_CAPACITY_MODEL
        : useProModel ? GEMINI_HIGH_CAPACITY_MODEL : GEMINI_FAST_MODEL;
  const groqModel = 'llama-3.3-70b-versatile';
  const order = chooseChatOrder(preference, requestedPreference === 'auto');
  for (const provider of order) {
    try {
      const result = provider === 'gemini'
        ? await tryGeminiWithModelFallback(messages, { attachments: body.attachments, enableWebSearch: Boolean(body.enableWebSearch), model: geminiModel, coding, flagship, preferBestKey: flagship, maxTokens: 8192, ...streamOptions })
        : await tryOpenAiProvider(provider, messages, {
          attachments: body.attachments,
          vision,
          coding,
          model: provider === 'groq' ? groqModel : undefined,
          reasoning: preference === 'think' && provider === 'groq',
          maxTokens: coding || useProModel || flagship ? 8192 : 4096,
          ...streamOptions
        });
      if (result) return result;
    } catch (error) {
      if (streamOptions.stream && streamOptions.streamState?.sent) {
        console.warn(`${provider} stream failed after output began; restarting with the next fallback:`, error.message);
        streamOptions.onReset?.();
        streamOptions.streamState.sent = false;
        continue;
      }
      throw error;
    }
  }
  if (!vision) {
    try {
      const output = await tryPollinationsText(messages, { coding, flagship });
      if (streamOptions.stream) {
        streamOptions.onProvider?.(output.provider, output.model);
        if (streamOptions.streamState) streamOptions.streamState.sent = true;
        streamOptions.onToken?.(output.text);
      }
      return output;
    } catch (error) {
      console.warn('Pollinations text fallback failed:', error.message);
    }
  }
  if (!availableProviders().length) throw new Error('No text-generation providers are configured. Add server-side provider credentials in the deployment environment; do not use VITE_* names.');
  throw new Error(vision ? 'Image analysis providers are unavailable. Please retry shortly.' : 'All configured AI providers are unavailable. Check the server provider keys and retry.');
}

function parseDataImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

async function responseImage(response, pollinationsKey = '') {
  const type = response.headers.get('content-type') || '';
  if (type.includes('json')) {
    const data = await response.json();
    const encoded = data.data?.[0]?.b64_json || data.image || data.result?.image;
    const url = data.data?.[0]?.url || data.images?.[0]?.url;
    if (encoded) {
      const bytes = Buffer.from(String(encoded), 'base64');
      return verifiedImageDataUrl(bytes, data.mime_type || 'image/png');
    }
    if (url) {
      const generatedUrl = new URL(url);
      if (!isTrustedImageHost(generatedUrl)) throw new Error('Image provider returned an unsupported asset URL.');
      const imageResponse = await fetchWithTimeout(generatedUrl.href, {
        headers: pollinationsKey && ['gen.pollinations.ai', 'image.pollinations.ai'].includes(generatedUrl.hostname) ? { Authorization: `Bearer ${pollinationsKey}` } : {}
      }, 12_000);
      if (!imageResponse.ok) throw new Error('Generated image URL could not be fetched.');
      return responseImage(imageResponse, pollinationsKey);
    }
    throw new Error('Image provider returned no image.');
  }
  if (!type.startsWith('image/')) throw new Error('Image provider returned an unsupported response.');
  const bytes = Buffer.from(await response.arrayBuffer());
  return verifiedImageDataUrl(bytes, type.split(';')[0]);
}

function isTrustedImageHost(url) {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ['gen.pollinations.ai', 'image.pollinations.ai', 'replicate.delivery', 'fal.media', 'fal.ai', 'huggingface.co']
    .some(domain => host === domain || host.endsWith(`.${domain}`));
}

function verifiedImageDataUrl(bytes, declaredType = '') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) throw new Error('Image provider returned a corrupt or empty image.');
  if (bytes.length > 2_800_000) throw new Error('Image output exceeds the serverless response limit.');
  const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
        : ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) ? 'image/gif' : '';
  if (!mimeType) throw new Error('Image provider returned a corrupt or unsupported image payload.');
  const normalizedDeclared = String(declaredType || '').split(';')[0].toLowerCase();
  if (normalizedDeclared.startsWith('image/') && normalizedDeclared !== mimeType && normalizedDeclared !== 'image/jpg') {
    console.warn(`Image provider declared ${normalizedDeclared} but returned ${mimeType}; using the detected image format.`);
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

async function validateGeneratedImage(result) {
  const value = String(result || '');
  const dataMatch = value.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (dataMatch) return verifiedImageDataUrl(Buffer.from(dataMatch[2], 'base64'), dataMatch[1]);
  const url = new URL(value);
  if (!isTrustedImageHost(url)) throw new Error('Image provider returned an unsupported asset URL.');
  const response = await fetchWithTimeout(url.href, {}, 12_000);
  if (!response.ok) throw new Error(`Generated image asset returned HTTP ${response.status}.`);
  return responseImage(response);
}

async function geminiImageEdit(prompt, sourceImage, aspectRatio) {
  const source = parseDataImage(sourceImage);
  if (!source) return null;
  for (const { key, index } of apiKeyPool.candidates('gemini')) {
    try {
      const response = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ model: 'gemini-3.1-flash-image', input: [
          { type: 'text', text: `${prompt}` },
          { type: 'image', mime_type: source.mimeType, data: source.data }
        ], response_format: { type: 'image', aspect_ratio: aspectRatio || '1:1' } })
      }, 20_000);
      if (response.ok) {
        const data = await response.json();
        const output = data.output_image || data.output?.find?.(item => item.type === 'image') || data.outputs?.find?.(item => item.type === 'image');
        if (output?.data && output.data.length * 0.75 <= 2_800_000) {
          apiKeyPool.succeeded('gemini', index);
          return `data:${output.mime_type || 'image/png'};base64,${output.data}`;
        }
      }
      apiKeyPool.failed('gemini', index, parseRetryAfter(response));
    } catch { apiKeyPool.failed('gemini', index); }
  }
  return null;
}

async function pollinationsImage(prompt, sourceImage, aspectRatio, seed, quality = 'quick') {
  const key = providerKeys.pollinations;
  if (!key) return null;
  if (sourceImage) {
    const source = parseDataImage(sourceImage);
    if (!source) throw new Error('Reference image must be PNG, JPEG, or WebP.');
    const form = new FormData();
    form.set('model', 'kontext');
    form.set('prompt', prompt);
    form.set('image', new Blob([Buffer.from(source.data, 'base64')], { type: source.mimeType }), 'reference-image');
    const response = await fetchWithTimeout('https://gen.pollinations.ai/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form
    }, 25_000);
    if (!response.ok) throw new Error('Pollinations image edit failed.');
    return responseImage(response, key);
  }
  const [ratioW, ratioH] = String(aspectRatio || '1:1').split(':').map(Number);
  const longest = quality === 'hd' ? 1536 : 1024;
  const width = ratioW >= ratioH ? longest : Math.round(longest * ratioW / ratioH);
  const height = ratioH >= ratioW ? longest : Math.round(longest * ratioH / ratioW);
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux&width=${width}&height=${height}&seed=${encodeURIComponent(seed || 0)}`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${key}` } }, 28_000);
  if (!response.ok) throw new Error('Pollinations image generation failed.');
  return responseImage(response);
}

async function falRequest(model, input, maxWaitMs = 16_000) {
  if (!providerKeys.fal) return null;
  const response = await fetchWithTimeout(`https://queue.fal.run/${model}`, {
    method: 'POST', headers: { Authorization: `Key ${providerKeys.fal}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  }, Math.min(8_000, maxWaitMs));
  if (!response.ok) throw new Error('Fal request failed.');
  let result = await response.json();
  if (result.images?.[0]?.url || result.video?.url) return result;
  const statusUrl = result.status_url;
  const responseUrl = result.response_url;
  if (!result.request_id || !statusUrl || !responseUrl) throw new Error('Fal returned no generation request.');
  const deadline = Date.now() + Math.max(0, maxWaitMs - 8_000);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_400));
    const status = await fetchWithTimeout(statusUrl, { headers: { Authorization: `Key ${providerKeys.fal}` } }, 6_000);
    if (!status.ok) throw new Error('Fal status request failed.');
    const state = await status.json();
    if (state.status === 'FAILED') throw new Error('Fal generation failed.');
    if (state.status === 'COMPLETED') {
      const output = await fetchWithTimeout(responseUrl, { headers: { Authorization: `Key ${providerKeys.fal}` } }, 8_000);
      if (!output.ok) throw new Error('Fal result could not be fetched.');
      result = await output.json();
      return result;
    }
  }
  throw new Error('Fal generation timed out.');
}

async function cloudflareImage(prompt, aspectRatio) {
  if (!providerKeys.cloudflareAccountId || !providerKeys.cloudflareToken) return null;
  const [ratioWidth, ratioHeight] = String(aspectRatio || '1:1').split(':').map(Number);
  const safeRatioWidth = Number.isFinite(ratioWidth) && ratioWidth > 0 ? ratioWidth : 1;
  const safeRatioHeight = Number.isFinite(ratioHeight) && ratioHeight > 0 ? ratioHeight : 1;
  const longEdge = 1024;
  const width = Math.max(256, Math.round((safeRatioWidth >= safeRatioHeight ? longEdge : longEdge * safeRatioWidth / safeRatioHeight) / 8) * 8);
  const height = Math.max(256, Math.round((safeRatioHeight >= safeRatioWidth ? longEdge : longEdge * safeRatioHeight / safeRatioWidth) / 8) * 8);
  const response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(providerKeys.cloudflareAccountId)}/ai/run/@cf/bytedance/stable-diffusion-xl-lightning`, {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.cloudflareToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, num_steps: 4, width, height })
  }, 24_000);
  if (!response.ok) throw new Error('Cloudflare image generation failed.');
  const data = await response.json();
  const image = data.result?.image || data.image;
  if (!image) throw new Error('Cloudflare returned no image.');
  return `data:image/png;base64,${image}`;
}

async function huggingfaceImage(prompt, modelId = 'black-forest-labs/FLUX.1-schnell') {
  if (!providerKeys.huggingface) return null;
  const response = await fetchWithTimeout(`https://router.huggingface.co/hf-inference/models/${modelId.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.huggingface}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt })
  }, 25_000);
  if (!response.ok) throw new Error('Hugging Face image generation failed.');
  return responseImage(response);
}

function falImageSize(aspectRatio) {
  return ({
    '1:1': 'square',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3'
  })[aspectRatio] || 'square';
}

async function replicateImage(prompt, aspectRatio) {
  if (!providerKeys.replicate) return null;
  const response = await fetchWithTimeout('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.replicate}`, 'Content-Type': 'application/json', Prefer: 'wait=20' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio || '1:1', num_outputs: 1 } })
  }, 24_000);
  if (!response.ok) throw new Error('Replicate image generation failed.');
  let data = await response.json();
  if (data.status !== 'succeeded' && data.urls?.get) {
    const poll = await fetchWithTimeout(data.urls.get, { headers: { Authorization: `Bearer ${providerKeys.replicate}` } }, 20_000);
    if (!poll.ok) throw new Error('Replicate image result failed.');
    data = await poll.json();
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url || data.status === 'failed') throw new Error('Replicate returned no image.');
  return url;
}

async function generateImage(body) {
  const prompt = String(body.prompt || '').trim();
  const sourceImage = String(body.sourceImage || '');
  const imageEngine = String(body.imageEngine || 'flux-quick');
  if (!prompt) throw new Error('Write a prompt before generating an image.');
  const hasImageProvider = sourceImage
    ? availableProviders().includes('gemini') || Boolean(providerKeys.pollinations)
    : Boolean(providerKeys.pollinations || providerKeys.huggingface || providerKeys.fal || (providerKeys.cloudflareAccountId && providerKeys.cloudflareToken) || providerKeys.replicate);
  if (!hasImageProvider) throw new Error(`No image-${sourceImage ? 'editing' : 'generation'} providers are configured. Add server-side provider credentials in the deployment environment; do not use VITE_* names.`);
  const fullPrompt = prompt;
  const attempts = [];
  const selectedHfModel = imageEngine === 'hf-sdxl'
    ? 'stabilityai/stable-diffusion-xl-base-1.0'
    : 'black-forest-labs/FLUX.1-dev';
  if (sourceImage) {
    if (imageEngine === 'pollinations-hd' || imageEngine === 'hf-flux-dev' || imageEngine === 'hf-sdxl') {
      throw new Error('The selected model supports text-to-image generation, not reference-image editing.');
    }
    attempts.push(['Gemini 3.1 Flash Image', 'gemini-3.1-flash-image', () => geminiImageEdit(fullPrompt, sourceImage, body.aspectRatio)]);
    attempts.push(['Pollinations', 'kontext', () => pollinationsImage(fullPrompt, sourceImage, body.aspectRatio, body.seed)]);
  } else {
    if (imageEngine === 'hf-flux-dev' || imageEngine === 'hf-sdxl') {
      attempts.push(['Hugging Face Inference API', selectedHfModel, () => huggingfaceImage(fullPrompt, selectedHfModel)]);
    } else if (imageEngine === 'pollinations-hd') {
      attempts.push(['Pollinations HD', 'flux-hd', () => pollinationsImage(fullPrompt, '', body.aspectRatio, body.seed, 'hd')]);
    } else {
      attempts.push(['Pollinations', 'flux', () => pollinationsImage(fullPrompt, '', body.aspectRatio, body.seed)]);
    }
    if (imageEngine !== 'hf-flux-dev' && imageEngine !== 'hf-sdxl') {
      attempts.push(['Hugging Face Inference API', 'black-forest-labs/FLUX.1-schnell', () => huggingfaceImage(fullPrompt)]);
    }
    if (imageEngine !== 'pollinations-hd') attempts.push(['Pollinations HD', 'flux-hd', () => pollinationsImage(fullPrompt, '', body.aspectRatio, body.seed, 'hd')]);
    attempts.push(['Fal AI', 'fal-ai/flux/schnell', async () => { const data = await falRequest('fal-ai/flux/schnell', { prompt: fullPrompt, image_size: falImageSize(body.aspectRatio) }); return data?.images?.[0]?.url || null; }]);
    attempts.push(['Cloudflare Workers AI', 'stable-diffusion-xl-lightning', () => cloudflareImage(fullPrompt, body.aspectRatio)]);
    attempts.push(['Replicate', 'black-forest-labs/flux-schnell', () => replicateImage(fullPrompt, body.aspectRatio)]);
  }
  for (const [provider, model, run] of attempts) {
    try {
      const candidate = await run();
      if (candidate) {
        const url = await validateGeneratedImage(candidate);
        return { url, provider, model, enhancedPrompt: fullPrompt, aspectRatio: body.aspectRatio || '1:1' };
      }
    } catch (error) { console.warn(`${provider} image attempt failed:`, error.message); }
  }
  throw new Error(sourceImage ? 'Image editing providers are unavailable. Check Gemini and Pollinations server keys.' : 'All configured image providers are unavailable.');
}

async function replicateVideo(prompt, deadline) {
  if (!providerKeys.replicate) return null;
  const remaining = () => Math.max(0, deadline - Date.now());
  if (remaining() < 1_000) return null;
  const response = await fetchWithTimeout('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.replicate}`, 'Content-Type': 'application/json', Prefer: 'wait=12' },
    body: JSON.stringify({ input: { prompt, prompt_optimizer: true } })
  }, Math.min(14_000, remaining()));
  if (!response.ok) throw new Error('Replicate video generation failed.');
  let data = await response.json();
  while (!['succeeded', 'failed', 'canceled'].includes(data.status) && data.urls?.get && remaining() > 2_000) {
    await new Promise(resolve => setTimeout(resolve, Math.min(2_500, remaining())));
    if (remaining() < 1_000) break;
    const poll = await fetchWithTimeout(data.urls.get, { headers: { Authorization: `Bearer ${providerKeys.replicate}` } }, Math.min(8_000, remaining()));
    if (!poll.ok) throw new Error('Replicate video result failed.');
    data = await poll.json();
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url || data.status !== 'succeeded') throw new Error('Replicate video generation did not finish before the request deadline.');
  return url;
}

async function huggingfaceVideo(prompt, duration, aspectRatio, deadline) {
  if (!providerKeys.huggingface) return null;
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining < 2_000) return null;
  const modelId = process.env.HUGGINGFACE_VIDEO_MODEL || 'Lightricks/LTX-Video';
  const url = `https://router.huggingface.co/hf-inference/models/${modelId.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${providerKeys.huggingface}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters: { num_frames: Math.min(97, Math.max(49, (Number(duration) || 4) * 12)), aspect_ratio: aspectRatio || '16:9' } })
  }, Math.min(18_000, remaining));
  if (!response.ok) throw new Error(`Hugging Face video generation failed (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const data = await response.json();
    const candidate = data.video?.url || data.video_url || data.videoUrl || data.url || data.output?.url;
    if (!candidate) throw new Error('Hugging Face returned no video payload.');
    const resultUrl = new URL(candidate);
    const allowed = ['huggingface.co', 'hf.co', 'replicate.delivery', 'fal.media']
      .some(host => resultUrl.hostname === host || resultUrl.hostname.endsWith(`.${host}`));
    if (resultUrl.protocol !== 'https:' || !allowed) throw new Error('Hugging Face returned an unsupported video URL.');
    return resultUrl.href;
  }
  if (!contentType.startsWith('video/')) throw new Error('Hugging Face returned a non-video response.');
  const bytes = Buffer.from(await response.arrayBuffer());
  const isMp4 = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  const isWebm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if ((!isMp4 && !isWebm) || bytes.length < 128 || bytes.length > 3_000_000) throw new Error('Hugging Face returned a corrupt or oversized video.');
  return `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`;
}

async function falVideo(prompt, duration, modelId, deadline) {
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining < 2_000) return null;
  const modelInput = modelId.includes('hunyuan')
    ? { prompt, aspect_ratio: '16:9', resolution: '480p', num_frames: Number(duration) > 6 ? 121 : 85 }
    : { prompt };
  const data = await falRequest(modelId, modelInput, Math.min(18_000, remaining));
  return data?.video?.url || data?.video_url || null;
}

async function pollinationsVideo(prompt, duration, aspectRatio, deadline) {
  const key = providerKeys.pollinations;
  const remaining = () => Math.max(0, deadline - Date.now());
  if (remaining() < 2_000) return null;
  const encodedPrompt = encodeURIComponent(prompt);
  const common = `duration=${Math.min(Number(duration) || 4, 8)}&aspectRatio=${encodeURIComponent(aspectRatio || '16:9')}`;
  const urls = [
    ...(key ? [`https://gen.pollinations.ai/video/${encodedPrompt}?model=google/veo-3.1-fast&${common}`] : []),
    `https://image.pollinations.ai/prompt/${encodedPrompt}?model=video&${common}`
  ];
  let lastError;
  for (const url of urls) {
    if (remaining() < 2_000) break;
    try {
      const headers = key && url.startsWith('https://gen.pollinations.ai/') ? { Authorization: `Bearer ${key}` } : {};
      const response = await fetchWithTimeout(url, { headers }, Math.min(key ? 28_000 : 20_000, remaining()));
      if (!response.ok) throw new Error(`Pollinations video generation failed (HTTP ${response.status}).`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const data = await response.json();
        const candidate = data.video?.url || data.video_url || data.videoUrl || data.mediaUrl || data.url || data.output?.url;
        if (candidate) return candidate;
        throw new Error('Pollinations returned no valid video URL.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const isMp4 = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
      const isWebm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if ((!contentType.startsWith('video/') && !isMp4 && !isWebm) || (!isMp4 && !isWebm)) throw new Error('Pollinations returned an unsupported or corrupt video response.');
      if (bytes.length < 1 || bytes.length > 30 * 1024 * 1024) throw new Error('Pollinations video output is outside the supported size.');
      const mimeType = isWebm ? 'video/webm' : 'video/mp4';
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: mimeType }), 'zulora-generated.mp4');
      if (remaining() > 1_500) {
        const uploadHeaders = key ? { Authorization: `Bearer ${key}` } : {};
        const upload = await fetchWithTimeout('https://media.pollinations.ai/upload', { method: 'POST', headers: uploadHeaders, body: form }, Math.min(8_000, remaining()));
        if (upload.ok) {
          const stored = await upload.json();
          const storedUrl = stored.url || stored.mediaUrl;
          if (storedUrl && new URL(storedUrl).protocol === 'https:') return storedUrl;
        }
      }
      if (bytes.length <= 2_500_000) return `data:${mimeType};base64,${bytes.toString('base64')}`;
      // Let the browser stream or download the provider's MP4 when upload hosting is unavailable.
      return url;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Pollinations video generation timed out.');
}

async function validateVideoCandidate(candidate, timeoutMs = 7_000) {
  const value = String(candidate || '');
  const data = value.match(/^data:video\/(mp4|webm);base64,([A-Za-z0-9+/=]+)$/i);
  if (data) {
    const bytes = Buffer.from(data[2], 'base64');
    const valid = bytes.length >= 128 && ((data[1].toLowerCase() === 'mp4' && bytes.toString('ascii', 4, 8) === 'ftyp') || (data[1].toLowerCase() === 'webm' && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))));
    if (!valid) throw new Error('Video provider returned a corrupt video payload.');
    return value;
  }
  const url = new URL(value);
  const trustedHost = ['gen.pollinations.ai', 'image.pollinations.ai', 'media.pollinations.ai', 'replicate.delivery', 'fal.media', 'fal.ai', 'huggingface.co', 'hf.co']
    .some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !trustedHost) throw new Error('Video provider returned an unsupported asset URL.');
  const response = await fetchWithTimeout(url.href, { headers: { Range: 'bytes=0-31' } }, timeoutMs);
  if (!response.ok) throw new Error(`Generated video asset returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Generated video asset returned no payload.');
  let bytes = new Uint8Array();
  try {
    const first = await reader.read();
    bytes = first.value || bytes;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const isMp4 = bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  const isWebm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if ((!contentType.startsWith('video/') && contentType !== 'application/octet-stream') || (!isMp4 && !isWebm)) {
    throw new Error('Video provider returned a corrupt or unsupported video asset.');
  }
  return url.href;
}

async function generateVideo(body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('Write a prompt before generating a video.');
  const enriched = [prompt, body.cameraAngle ? `Camera movement: ${body.cameraAngle}.` : '', body.motionSpeed ? `Motion intensity: ${body.motionSpeed}/10.` : ''].filter(Boolean).join(' ');
  const deadline = Date.now() + 56_000;
  const falModels = [
    ['fal-ai/luma-dream-machine/ray-2-flash', 'Luma Dream Machine Ray 2 Flash'],
    ['fal-ai/hunyuan-video-v1.5/text-to-video', 'HunyuanVideo 1.5']
  ];
  const attempts = [
    ['Pollinations', 'veo-3.1-fast', () => pollinationsVideo(enriched, body.duration, body.aspectRatio, deadline)],
    ['Replicate', 'minimax-video-01', () => replicateVideo(enriched, Math.min(deadline, Date.now() + 20_000))],
    ['Hugging Face Video API', process.env.HUGGINGFACE_VIDEO_MODEL || 'Lightricks/LTX-Video', () => huggingfaceVideo(enriched, body.duration, body.aspectRatio, Math.min(deadline, Date.now() + 16_000))],
    ...falModels.map(([modelId, model]) => ['Fal AI', model, () => falVideo(enriched, body.duration, modelId, deadline)])
  ];
  for (const [provider, model, run] of attempts) {
    if (Date.now() >= deadline) break;
    try {
      const candidate = await run();
      if (candidate) {
        const url = await validateVideoCandidate(candidate, Math.min(7_000, Math.max(1_000, deadline - Date.now())));
        const generatedDuration = provider === 'Replicate' ? 6 : Math.min(Number(body.duration) || 6, provider === 'Pollinations' ? 8 : 10);
        return { url, provider, model, duration: generatedDuration };
      }
    } catch (error) { console.warn(`${provider} ${model} video attempt failed:`, error.message); }
  }
  throw new Error('Pollinations, Replicate, Hugging Face, and Fal AI video providers are unavailable. Configure the matching server API keys, then retry.');
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Math.max(0, Number(usage.promptTokenCount ?? usage.prompt_tokens ?? usage.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage.candidatesTokenCount ?? usage.completion_tokens ?? usage.outputTokens) || 0);
  const totalTokens = Math.max(0, Number(usage.totalTokenCount ?? usage.total_tokens ?? usage.totalTokens) || inputTokens + outputTokens);
  if (!totalTokens) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

function estimateRequestTokens(type, body, output = {}) {
  if (type === 'image') return 2_048;
  if (type === 'video') return 4_096;
  if (Number(output.tokenUsage?.totalTokens) > 0) return Math.ceil(Number(output.tokenUsage.totalTokens));
  const inputChars = (Array.isArray(body.messages) ? body.messages : [])
    .reduce((total, message) => total + String(message?.content || '').length, 0);
  const imageChars = (Array.isArray(body.attachments) ? body.attachments : []).reduce((total, item) => total + String(item?.base64 || '').length, 0);
  const outputChars = String(output.text || '').length;
  return Math.max(1, Math.ceil((inputChars + outputChars) / 4) + Math.ceil(imageChars / 5_000));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return safeError(res, 405, 'Method not allowed.');
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return safeError(res, 400, 'Invalid JSON request.'); }
  }
  if (!body || typeof body !== 'object') return safeError(res, 400, 'Invalid request.');
  const usageOnly = body.action === 'usage';
  const allowanceOnly = body.action === 'allowance';
  const streamChat = body.action === 'chat-stream';
  const quotaOnly = usageOnly || allowanceOnly;
  const type = quotaOnly
    ? (['chat', 'image', 'video'].includes(body.usageType) ? body.usageType : null)
    : (body.action === 'chat' || streamChat) ? 'chat' : body.action === 'image' ? 'image' : body.action === 'video' ? 'video' : null;
  if (!type) return safeError(res, 400, 'Unsupported generation action.');
  const token = bearer(req);
  if (!token) return safeError(res, 401, 'Sign in to use Zulora AI.');
  let uid;
  try { uid = await verifyUser(req); }
  catch { return safeError(res, 503, 'Could not verify sign-in. Please retry.'); }
  if (!uid) return safeError(res, 401, 'Your sign-in session has expired. Sign in again.');
  const flagshipRequest = type === 'chat' && normalizeModelPreference(body.modelPreference || body.model) === 'think';

  try {
    if (allowanceOnly) {
      if (!firestoreAdminCredentials()) return json(res, 200, { allowance: null, quotaSource: 'client' });
      let before;
      try { before = await readPlan(uid); }
      catch (error) {
        console.warn('Server quota preflight fell back to the client store:', error.message);
        return json(res, 200, { allowance: null, quotaSource: 'client' });
      }
      if (before.error) return json(res, 200, { allowance: null, quotaSource: 'client' });
      const bucket = await readTokenUsageState(uid);
      const status = {
        usedPercent: Math.max(0, Math.min(100, Math.floor((bucket.current / bucket.limit) * 100))),
        usedTokens: bucket.current, tokenLimit: bucket.limit,
        resetAt: new Date(bucket.resetAt).toISOString(), tier: bucket.tier,
        softCooldown: bucket.softCooldown,
        cooldownUntil: bucket.softCooldown ? new Date(bucket.cooldownUntil).toISOString() : null
      };
      if (!bucket.allowed && !flagshipRequest) return safeError(res, 429, 'Your daily AI token allocation is used. Upgrade or wait for the reset to continue.', { upgradeRequired: true, usage: { ...status, blocked: true } });
      if (bucket.softCooldown && !flagshipRequest) return safeError(res, 429, 'Taking a 5-minute breather to maintain top performance...', { softCooldown: true, cooldownUntil: status.cooldownUntil, upgradeRequired: false, usage: { ...status, blocked: false } });
      return json(res, 200, { allowance: { type, allowed: true, planTier: before.planTier, usage: { ...status, blocked: false } } });
    }

    if (usageOnly) {
      if (!firestoreAdminCredentials()) return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
      try {
        const updated = await incrementTokenUsage(uid, body.estimatedTokens || (type === 'image' ? 2_048 : type === 'video' ? 4_096 : 1_000));
        return json(res, 200, { usage: { type, tracked: true, ...updated } });
      } catch (error) {
        console.warn('Server usage write fell back to the client store:', error.message);
        return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
      }
    }

    let usageTrackingAvailable = false;
    let profileTier = null;
    if (firestoreAdminCredentials()) {
      try {
        const before = await readPlan(uid);
        profileTier = before.planTier;
        if (before.error) {
          console.warn('Server quota check fell back to the client store:', before.error);
        } else {
          if (!flagshipRequest) {
            const tokenState = await readTokenUsageState(uid);
            if (!tokenState.allowed) return safeError(res, 429, 'Your daily AI token allocation is used. Upgrade or wait for the reset to continue.', { upgradeRequired: true, usage: { blocked: true, usedPercent: 100, resetAt: new Date(tokenState.resetAt).toISOString() } });
            if (tokenState.softCooldown) return safeError(res, 429, 'Taking a 5-minute breather to maintain top performance...', { softCooldown: true, cooldownUntil: new Date(tokenState.cooldownUntil).toISOString(), upgradeRequired: false });
          }
          usageTrackingAvailable = true;
        }
      } catch (error) {
        console.warn('Server quota check fell back to the client store:', error?.message || 'Could not read usage.');
      }
    }

    if (type === 'chat' && normalizeModelPreference(body.modelPreference || body.model) === 'think') {
      const normalizedTier = String(profileTier || '').toLowerCase().replace(/[ _-]/g, '');
      if (profileTier && !normalizedTier.includes('pro') && !normalizedTier.includes('ultra')) {
        return safeError(res, 403, 'The Zulora 3.5 Pro Ultra model requires a Pro or Ultra subscription.', { upgradeRequired: true });
      }
    }

    if (firestoreAdminCredentials() && !flagshipRequest) {
      try {
        const promptRate = await registerPromptAttempt(uid);
        if (!promptRate.allowed) {
          return safeError(res, 429, 'Taking a 5-minute breather to maintain top performance...', {
            softCooldown: true,
            cooldownUntil: new Date(promptRate.cooldownUntil).toISOString(),
            upgradeRequired: false
          });
        }
      } catch (error) {
        console.warn('Firestore prompt cooldown check failed open:', error?.message || error);
      }
    }

    if (streamChat) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      const activeProvider = { provider: '', model: '' };
      let announcedProvider = '';
      const sendEvent = (name, data) => {
        if (!res.headersSent) res.flushHeaders?.();
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        res.flush?.();
      };
      const streamState = { sent: false };
      try {
        const output = await generateChat(body, {
          stream: true,
          streamState,
          onProvider: (provider, model) => {
            activeProvider.provider = provider;
            activeProvider.model = model;
          },
          onToken: tokenValue => {
            if (!res.headersSent) {
              res.setHeader('X-AI-Provider', activeProvider.provider || 'Unknown');
              res.setHeader('X-AI-Model', activeProvider.model || '');
            }
            const providerKey = `${activeProvider.provider}:${activeProvider.model}`;
            if (providerKey !== announcedProvider) {
              announcedProvider = providerKey;
              sendEvent('provider', activeProvider);
            }
            sendEvent('token', { token: tokenValue });
          },
          onReset: () => sendEvent('reset', {})
        });
        let usage = { type, tracked: false };
        if (usageTrackingAvailable) {
          try {
            const tokenUpdate = await incrementTokenUsage(uid, estimateRequestTokens(type, body, output), flagshipRequest);
            usage = { type, tracked: true, ...tokenUpdate };
          } catch (error) {
            console.warn('Firestore usage write fell back to the client store:', error?.message || 'Could not save usage.');
          }
        }
        sendEvent('done', { ...output, usage });
      } catch (error) {
        const message = error?.message || 'Generation failed. Please retry.';
        sendEvent('error', { error: message, status: error?.status || 502, upgradeRequired: Boolean(error?.payload?.upgradeRequired) });
      }
      return res.end();
    }

    const output = type === 'chat' ? await generateChat(body) : type === 'image' ? await generateImage(body) : await generateVideo(body);
    if (type === 'chat') {
      res.setHeader('X-AI-Provider', output.provider || 'Unknown');
      res.setHeader('X-AI-Model', output.model || '');
    }
    let usage = { type, tracked: false };
    if (usageTrackingAvailable) {
      try {
        const tokenUpdate = await incrementTokenUsage(uid, estimateRequestTokens(type, body, output), flagshipRequest);
        usage = { type, tracked: true, ...tokenUpdate };
      } catch (error) {
        console.warn('Server usage write fell back to the client store:', error?.message || 'Could not save usage.');
      }
    }
    return json(res, 200, { ...output, usage });
  } catch (error) {
    const message = error?.message || 'Generation failed. Please retry.';
    console.error('Zulora generation request failed:', type, message);
    const isSetup = /FIREBASE_|Firebase|Firestore|usage service|User profile was not found|No (?:text|video)-generation providers are configured|No image-(?:generation|editing) providers are configured/.test(message);
    return safeError(res, isSetup ? 503 : 502, message);
  }
}
