import { createPublicKey, createSign, verify as verifySignature } from 'node:crypto';
import { apiKeyPool, availableProviders, providerKeys } from './apiKeyPool.js';
import { buildSystemPrompt } from '../src/services/systemPrompt.js';

export const config = { maxDuration: 60 };

const CHAT_ORDER = ['gemini', 'groq', 'cerebras', 'openrouter', 'mistral'];
const COUNTERS = {
  chat: { used: 'textUsed', limit: 'textLimit', count: 'chatCount', window: 'chatWindowStart', duration: 2 * 60 * 60 * 1000 },
  image: { used: 'imageUsed', limit: 'imageLimit', count: 'imageCount', window: 'imageWindowStart', duration: 24 * 60 * 60 * 1000 },
  video: { used: 'videoUsed', limit: 'videoLimit', count: 'videoCount', window: 'videoWindowStart', duration: 24 * 60 * 60 * 1000 }
};
const PLAN_LIMITS = {
  free: { chat: 50, image: 30, video: 4 },
  pro: { chat: 100, image: 60, video: 8 },
  ultra: { chat: 250, image: 150, video: 20 }
};
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

async function fetchProviderWithRetry(url, options, timeoutMs = 16_000) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
    if (response.ok || !retryable || attempt === 2) return response;
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

function usageState(profile, type, now = Date.now()) {
  const spec = COUNTERS[type];
  const usage = { ...(profile.usage || {}) };
  const rawTiers = [profile.planTier, profile.tier].map(value => String(value || '').toLowerCase().replace(/[ _-]/g, ''));
  const tier = rawTiers.some(value => value.includes('ultra'))
    ? 'ultra'
    : rawTiers.some(value => value.includes('pro')) ? 'pro' : 'free';
  const windowStart = Number(usage[spec.window]) || now;
  const expired = now - windowStart >= spec.duration;
  const current = expired ? 0 : Number(profile[spec.used] ?? usage[spec.count] ?? 0);
  const limit = PLAN_LIMITS[tier][type];
  return { usage: { ...usage, [spec.count]: current, [spec.window]: expired ? now : windowStart }, current, limit, allowed: current < limit, normalizedTier: tier };
}

async function checkUsage(uid, type) {
  const adminToken = await firestoreAccessToken();
  const { profile, error } = await readUsageProfile(uid, adminToken);
  if (error) return { allowed: false, error };
  const state = usageState(profile, type);
  return { ...state, planTier: state.normalizedTier };
}

async function incrementUsage(uid, type) {
  const adminToken = await firestoreAccessToken();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const begin = await fetchWithTimeout(`${firestoreRoot()}:beginTransaction`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { readWrite: {} } })
    }, 8_000);
    if (!begin.ok) throw new Error('Could not start Firestore usage transaction.');
    const transaction = (await begin.json()).transaction;
    if (!transaction) throw new Error('Firestore did not return a usage transaction.');
    const { profile, error } = await readUsageProfile(uid, adminToken, transaction);
    if (error) throw new Error(error);
    const state = usageState(profile, type);
    if (!state.allowed) return { allowed: false, current: state.current, limit: state.limit, planTier: profile.planTier || 'Free' };
    const spec = COUNTERS[type];
    const next = state.current + 1;
    const usage = { ...state.usage, [spec.count]: next };
    const fields = { [spec.used]: next, usage };
    const write = {
      update: { name: firestoreDoc(uid), fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toFirestoreValue(value)])) },
      updateMask: { fieldPaths: [spec.used, 'usage'] }
    };
    const commit = await fetchWithTimeout(`${firestoreRoot()}:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction, writes: [write] })
    }, 8_000);
    if (commit.ok) return { allowed: true, current: next, limit: state.limit };
    const details = await commit.text();
    if (attempt < 2 && (commit.status === 409 || details.includes('ABORTED'))) continue;
    throw new Error('Firestore rejected the usage update.');
  }
  throw new Error('Firestore usage update could not be committed.');
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

async function readProviderEventStream(response, readToken, onToken, streamState) {
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
    const token = readToken(event);
    if (typeof token === 'string' && token) {
      output += token;
      streamState.sent = true;
      onToken(token);
    }
    if (event.error?.message) throw new Error(event.error.message);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
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
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: options.model || 'llama-3.3-70b-versatile', label: 'Groq' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: options.model || (options.vision ? 'google/gemini-3.8-flash' : 'meta-llama/llama-3.3-70b-instruct'), label: 'OpenRouter' },
    cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', label: 'Cerebras' },
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', label: 'Mistral AI' }
  };
  const config = configs[provider];
  const parts = attachmentParts(options.attachments);
  for (const { key, index } of apiKeyPool.candidates(provider)) {
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
      const response = await fetchProviderWithRetry(config.url, {
        method: 'POST', headers,
        body: JSON.stringify(requestBody)
      }, 15_000);
      if (response.ok) {
        const text = options.stream
          ? await readProviderEventStream(response, event => event.choices?.[0]?.delta?.content, options.onToken, options.streamState)
          : (await response.json()).choices?.[0]?.message?.content;
        if (typeof text === 'string' && (text.trim() || (options.stream && options.streamState?.sent))) {
          apiKeyPool.succeeded(provider, index);
          return { text: text.trim(), provider: `${config.label}${provider === 'openrouter' ? ` (Key #${index + 1})` : ''}`, model: config.model };
        }
      }
      console.warn(`${config.label} text request failed with HTTP ${response.status}.`);
      apiKeyPool.failed(provider, index, parseRetryAfter(response));
    } catch (error) {
      console.warn(`${config.label} text request failed:`, error.message);
      apiKeyPool.failed(provider, index);
      if (options.stream && options.streamState?.sent) throw error;
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
  for (const { key, index } of apiKeyPool.candidates('gemini')) {
    try {
      const model = options.model || 'gemini-2.5-flash';
      const endpoint = options.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      const response = await fetchProviderWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents,
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          ...(options.enableWebSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { temperature: 0.7, maxOutputTokens: options.coding ? 8192 : (options.model === 'gemini-2.5-pro' ? 8192 : 4096) }
        })
      }, 16_000);
      if (response.ok) {
        let data;
        let text;
        if (options.stream) {
          text = await readProviderEventStream(response, event => event.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(''), options.onToken, options.streamState);
          data = {};
        } else {
          data = await response.json();
          text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
        }
        const candidate = data.candidates?.[0];
        if (text || (options.stream && options.streamState?.sent)) {
          apiKeyPool.succeeded('gemini', index);
          const grounding = candidate?.groundingMetadata || {};
          const chunks = grounding.groundingChunks || [];
          const sources = chunks.map(chunk => chunk.web && ({ title: chunk.web.title || chunk.web.uri, url: chunk.web.uri })).filter(Boolean);
          return { text, provider: `Google Gemini (Key #${index + 1})`, model, sources };
        }
      }
      console.warn(`Google Gemini text request failed with HTTP ${response.status}.`);
      apiKeyPool.failed('gemini', index, parseRetryAfter(response));
    } catch (error) {
      console.warn('Google Gemini text request failed:', error.message);
      apiKeyPool.failed('gemini', index);
      if (options.stream && options.streamState?.sent) throw error;
    }
  }
  return null;
}

function normalizeModelPreference(value) {
  const selected = String(value || 'auto').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (selected === 'think' || selected.includes('thinking') || selected.includes('3.5 pro ultra') || selected.includes('pro ultra')) return 'think';
  if (selected === 'llama' || (selected.includes('llama') && selected.includes('70b'))) return 'llama';
  if (selected === 'pro 3.14' || selected === 'zulora pro 3.14' || selected === 'pro' || selected === 'pro 314') return 'pro';
  if (selected === 'flash' || selected.includes('gemini 2.5 flash')) return 'flash';
  if (selected === 'auto' || !selected) return 'auto';
  if (['high reason', 'high reasoning', 'reasoning'].includes(selected)) return 'think';
  return 'auto';
}

function chooseChatOrder(preference, vision, search, autoSelected = false) {
  if (preference === 'llama') return autoSelected ? ['groq', 'openrouter', 'gemini', 'cerebras', 'mistral'] : ['groq', 'openrouter'];
  if (preference === 'think') return ['openrouter', 'groq', 'gemini'];
  if (vision) return ['gemini'];
  if (['pro', 'high_reason', 'pro_314', 'pro_ultra'].includes(preference)) {
    return ['gemini', 'groq', 'openrouter', 'cerebras', 'mistral'];
  }
  if (['flash', 'auto'].includes(preference)) return ['gemini', 'groq', 'cerebras', 'openrouter', 'mistral'];
  const mapped = ['groq', 'openrouter', 'cerebras', 'gemini', 'mistral'].includes(preference) ? preference : null;
  if (search) return ['gemini', 'openrouter', ...CHAT_ORDER.filter(provider => provider !== 'gemini' && provider !== 'openrouter')];
  return mapped ? [mapped, ...CHAT_ORDER.filter(provider => provider !== mapped)] : CHAT_ORDER;
}

async function generateChat(body, streamOptions = {}) {
  const systemPrompt = buildSystemPrompt(body.contextMemory, new Date(), body.aiBrain, body.userVault);
  const messages = plainMessages(body.messages, systemPrompt);
  const attachments = attachmentParts(body.attachments);
  if (body.attachments?.length && !attachments.length) throw new Error('The attached image format is unsupported. Use PNG, JPEG, WebP, or GIF.');
  const vision = attachments.length > 0;
  const requestedPreference = normalizeModelPreference(body.modelPreference || body.model);
  const latestUserPrompt = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const coding = Boolean(body.coding) || /(?:\bcode\b|\bhtml\b|\bcss\b|\bjs\b|\bjavascript\b|\breact\b|\bfunction\b|\bbuild\s+(?:a\s+)?ui\b|\bwebsite\b|\bwebpage\b|\bweb\s+app\b|\blanding\s+page\b|\b(?:1000|\d{4,})\s*(?:\+\s*)?lines?\b|\bfull\s+(?:landing\s+page|website|web\s+app|application)\b|\binteractive\s+app\b|\bcomplete\s+(?:landing\s+page|website|web\s+app|application)\b)/i.test(latestUserPrompt);
  const complex = ['pro', 'think', 'high_reason', 'pro_314', 'pro_ultra'].includes(requestedPreference) ||
    /\b(?:complex|think deeply|reason(?:ing)?|analy[sz]e|analysis|architecture|derive|evaluate|proof|step by step|high reason)\b/i.test(latestUserPrompt);
  const preference = requestedPreference === 'auto' ? (coding ? 'llama' : complex ? 'pro' : 'flash') : requestedPreference;
  const useProModel = ['pro', 'think', 'high_reason', 'pro_314', 'pro_ultra'].includes(preference);
  const geminiModel = useProModel ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  const groqModel = preference === 'think' ? 'openai/gpt-oss-120b' : preference === 'flash' ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
  const order = chooseChatOrder(preference, vision, Boolean(body.enableWebSearch), requestedPreference === 'auto');
  for (const provider of order) {
    let result = provider === 'gemini'
      ? await tryGemini(messages, { attachments: body.attachments, enableWebSearch: Boolean(body.enableWebSearch), model: vision && !useProModel ? 'gemini-2.5-flash' : geminiModel, coding, ...streamOptions })
      : await tryOpenAiProvider(provider, messages, {
        attachments: body.attachments,
        vision,
        coding,
        model: provider === 'groq'
          ? groqModel
          : provider === 'openrouter' && preference === 'think'
            ? 'deepseek/deepseek-r1'
            : provider === 'openrouter' && preference === 'llama'
              ? 'meta-llama/llama-3.3-70b-instruct'
              : undefined,
        reasoning: preference === 'think' && provider === 'groq',
        maxTokens: coding || useProModel ? 8192 : 4096,
        ...streamOptions
      });
    if (result) return result;
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
      if (encoded.length * 0.75 > 2_800_000) throw new Error('Image output exceeds the serverless response limit.');
      return `data:${data.mime_type || 'image/png'};base64,${encoded}`;
    }
    if (url) {
      const generatedUrl = new URL(url);
      const pollinationsHost = generatedUrl.protocol === 'https:' && ['gen.pollinations.ai', 'image.pollinations.ai'].some(host => generatedUrl.hostname === host || generatedUrl.hostname.endsWith(`.${host}`));
      if (!pollinationsHost) throw new Error('Image provider returned an unsupported asset URL.');
      const imageResponse = await fetchWithTimeout(generatedUrl.href, {
        headers: pollinationsKey ? { Authorization: `Bearer ${pollinationsKey}` } : {}
      }, 12_000);
      if (!imageResponse.ok) throw new Error('Generated image URL could not be fetched.');
      return responseImage(imageResponse);
    }
    throw new Error('Image provider returned no image.');
  }
  if (!type.startsWith('image/')) throw new Error('Image provider returned an unsupported response.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2_800_000) throw new Error('Image output exceeds the serverless response limit.');
  return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
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

async function generateImage(body, profileTier = null) {
  const prompt = String(body.prompt || '').trim();
  const sourceImage = String(body.sourceImage || '');
  const imageEngine = String(body.imageEngine || 'flux-quick');
  if (!prompt) throw new Error('Write a prompt before generating an image.');
  if (['hf-flux-dev', 'hf-sdxl'].includes(imageEngine)) {
    const normalizedTier = String(profileTier || '').toLowerCase().replace(/[ _-]/g, '');
    if (!normalizedTier.includes('pro') && !normalizedTier.includes('ultra')) {
      throw new Error('Hugging Face image models require a verified Pro or Ultra subscription.');
    }
    if (sourceImage) throw new Error('The selected Hugging Face model supports text-to-image generation, not reference-image editing.');
    const modelId = imageEngine === 'hf-flux-dev'
      ? 'black-forest-labs/FLUX.1-dev'
      : 'stabilityai/stable-diffusion-xl-base-1.0';
    const url = await huggingfaceImage(prompt, modelId);
    if (!url) throw new Error('Hugging Face Inference API is unavailable. Configure HUGGINGFACE_API_KEY on the server.');
    return { url, provider: 'Hugging Face Inference API', model: modelId, enhancedPrompt: prompt, aspectRatio: body.aspectRatio || '1:1' };
  }
  if (imageEngine === 'pollinations-hd') {
    if (sourceImage) throw new Error('Pollinations HD currently supports text-to-image generation only.');
    const url = await pollinationsImage(prompt, '', body.aspectRatio, body.seed, 'hd');
    if (!url) throw new Error('Pollinations HD is unavailable. Configure POLLINATIONS_API_KEY on the server.');
    return { url, provider: 'Pollinations HD', model: 'flux-hd', enhancedPrompt: prompt, aspectRatio: body.aspectRatio || '1:1' };
  }
  const hasImageProvider = sourceImage
    ? availableProviders().includes('gemini') || Boolean(providerKeys.pollinations)
    : Boolean(providerKeys.pollinations || providerKeys.huggingface || providerKeys.fal || (providerKeys.cloudflareAccountId && providerKeys.cloudflareToken) || providerKeys.replicate);
  if (!hasImageProvider) throw new Error(`No image-${sourceImage ? 'editing' : 'generation'} providers are configured. Add server-side provider credentials in the deployment environment; do not use VITE_* names.`);
  const fullPrompt = prompt;
  const attempts = [];
  if (sourceImage) attempts.push(['Gemini 3.1 Flash Image', () => geminiImageEdit(fullPrompt, sourceImage, body.aspectRatio)]);
  attempts.push(['Pollinations', () => pollinationsImage(fullPrompt, sourceImage, body.aspectRatio, body.seed)]);
  if (!sourceImage) {
    attempts.push(['Hugging Face', () => huggingfaceImage(fullPrompt)]);
    attempts.push(['Fal', async () => { const data = await falRequest('fal-ai/flux/schnell', { prompt: fullPrompt, image_size: falImageSize(body.aspectRatio) }); return data?.images?.[0]?.url || null; }]);
    attempts.push(['Cloudflare Workers AI', () => cloudflareImage(fullPrompt, body.aspectRatio)]);
    attempts.push(['Replicate', () => replicateImage(fullPrompt, body.aspectRatio)]);
  }
  for (const [provider, run] of attempts) {
    try {
      const url = await run();
      if (url) return { url, provider, model: provider === 'Gemini 3.1 Flash Image' ? 'gemini-3.1-flash-image' : provider === 'Pollinations' ? (sourceImage ? 'kontext' : 'flux') : 'image-generation', enhancedPrompt: fullPrompt, aspectRatio: body.aspectRatio || '1:1' };
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
        const candidate = data.video?.url || data.video_url || data.mediaUrl || data.url;
        if (candidate && new URL(candidate).protocol === 'https:') return candidate;
        throw new Error('Pollinations returned no valid video URL.');
      }
      if (!contentType.startsWith('video/')) throw new Error('Pollinations returned an unsupported video response.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1 || bytes.length > 30 * 1024 * 1024) throw new Error('Pollinations video output is outside the supported size.');
      const mimeType = contentType.split(';')[0];
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

async function generateVideo(body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('Write a prompt before generating a video.');
  const enriched = [prompt, body.cameraAngle ? `Camera movement: ${body.cameraAngle}.` : '', body.motionSpeed ? `Motion intensity: ${body.motionSpeed}/10.` : ''].filter(Boolean).join(' ');
  const deadline = Date.now() + 48_000;
  const falModels = [
    ['fal-ai/luma-dream-machine/ray-2-flash', 'Luma Dream Machine Ray 2 Flash'],
    ['fal-ai/hunyuan-video-v1.5/text-to-video', 'HunyuanVideo 1.5']
  ];
  const attempts = [
    ['Pollinations', 'veo-3.1-fast', () => pollinationsVideo(enriched, body.duration, body.aspectRatio, deadline)],
    ...falModels.map(([modelId, model]) => ['Fal AI', model, () => falVideo(enriched, body.duration, modelId, deadline)]),
    ['Replicate', 'minimax-video-01', () => replicateVideo(enriched, deadline)]
  ];
  for (const [provider, model, run] of attempts) {
    if (Date.now() >= deadline) break;
    try {
      const url = await run();
      if (url) {
        const generatedDuration = provider === 'Replicate' ? 6 : Math.min(Number(body.duration) || 6, provider === 'Pollinations' ? 8 : 10);
        return { url, provider, model, duration: generatedDuration };
      }
    } catch (error) { console.warn(`${provider} ${model} video attempt failed:`, error.message); }
  }
  throw new Error('Pollinations, Fal AI, and Replicate video providers are unavailable. Configure POLLINATIONS_API_KEY, FAL_API_KEY, or REPLICATE_API_TOKEN on the server, then retry.');
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

  try {
    if (allowanceOnly) {
      if (!firestoreAdminCredentials()) return json(res, 200, { allowance: null, quotaSource: 'client' });
      let before;
      try { before = await checkUsage(uid, type); }
      catch (error) {
        console.warn('Server quota preflight fell back to the client store:', error.message);
        return json(res, 200, { allowance: null, quotaSource: 'client' });
      }
      if (before.error) return json(res, 200, { allowance: null, quotaSource: 'client' });
      if (!before.allowed) return safeError(res, 403, `${type} limit reached. Upgrade your subscription to continue.`, { limit: before.limit, used: before.current, planTier: before.planTier });
      return json(res, 200, { allowance: { type, allowed: true, used: before.current, limit: before.limit, planTier: before.planTier } });
    }

    if (usageOnly) {
      if (!firestoreAdminCredentials()) return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
      try {
        const before = await checkUsage(uid, type);
        if (before.error || !before.allowed) return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
        const updated = await incrementUsage(uid, type);
        if (!updated.allowed) return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
        return json(res, 200, { usage: { type, tracked: true, used: updated.current, limit: updated.limit } });
      } catch (error) {
        console.warn('Server usage write fell back to the client store:', error.message);
        return json(res, 200, { usage: { type, tracked: false, source: 'client' } });
      }
    }

    let usageTrackingAvailable = false;
    let profileTier = null;
    if (firestoreAdminCredentials()) {
      try {
        const before = await checkUsage(uid, type);
        profileTier = before.planTier;
        if (before.error) {
          console.warn('Server quota check fell back to the client store:', before.error);
        } else if (!before.allowed) {
          return safeError(res, 403, `${type} limit reached. Upgrade your subscription to continue.`, { limit: before.limit, used: before.current, planTier: before.planTier });
        } else {
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

    const imageEngine = String(body.imageEngine || 'flux-quick');
    const huggingFaceEngine = ['hf-flux-dev', 'hf-sdxl'].includes(imageEngine);
    if (type === 'image' && huggingFaceEngine) {
      const normalizedTier = String(profileTier || '').toLowerCase().replace(/[ _-]/g, '');
      if (!normalizedTier.includes('pro') && !normalizedTier.includes('ultra')) {
        return safeError(res, profileTier ? 403 : 503, profileTier
          ? 'Hugging Face image models require a Pro or Ultra subscription.'
          : 'Your Pro subscription could not be verified for Hugging Face image generation.',
        { upgradeRequired: Boolean(profileTier) });
      }
    }

    if (streamChat) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      const sendEvent = (name, data) => {
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        res.flush?.();
      };
      const streamState = { sent: false };
      try {
        const output = await generateChat(body, {
          stream: true,
          streamState,
          onToken: tokenValue => sendEvent('token', { token: tokenValue })
        });
        let usage = { type, tracked: false };
        if (usageTrackingAvailable) {
          try {
            const updated = await incrementUsage(uid, type);
            if (updated.allowed) usage = { type, tracked: true, used: updated.current, limit: updated.limit };
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

    const output = type === 'chat' ? await generateChat(body) : type === 'image' ? await generateImage(body, profileTier) : await generateVideo(body);
    let usage = { type, tracked: false };
    if (usageTrackingAvailable) {
      try {
        const updated = await incrementUsage(uid, type);
        if (!updated.allowed) {
          usage = { type, tracked: false, source: 'client' };
        } else {
          usage = { type, tracked: true, used: updated.current, limit: updated.limit };
        }
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
