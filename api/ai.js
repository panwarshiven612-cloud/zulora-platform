import { createSign } from 'node:crypto';
import { apiKeyPool, providerKeys } from './apiKeyPool.js';

export const config = { maxDuration: 60 };

const CHAT_ORDER = ['groq', 'openrouter', 'cerebras', 'gemini', 'mistral'];
const COUNTERS = {
  chat: { used: 'textUsed', limit: 'textLimit', count: 'chatCount', window: 'chatWindowStart', duration: 2 * 60 * 60 * 1000 },
  image: { used: 'imageUsed', limit: 'imageLimit', count: 'imageCount', window: 'imageWindowStart', duration: 24 * 60 * 60 * 1000 },
  video: { used: 'videoUsed', limit: 'videoLimit', count: 'videoCount', window: 'videoWindowStart', duration: 24 * 60 * 60 * 1000 }
};
let cachedFirestoreToken = null;

const json = (res, status, payload) => res.status(status).json(payload);
const bearer = req => String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
const safeError = (res, status, message, extra = {}) => json(res, status, { error: message, ...extra });

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function verifyUser(req) {
  const token = bearer(req);
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!token) return null;
  if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY is not configured on the server.');
  const response = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token })
  }, 8_000);
  if (!response.ok) return null;
  const data = await response.json();
  const user = data.users?.[0];
  return user && !user.disabled ? user.localId : null;
}

const firestoreRoot = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not configured on the server.');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
};

const firestoreDoc = uid => `${firestoreRoot()}/users/${encodeURIComponent(uid)}`;

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function firestoreAccessToken() {
  if (cachedFirestoreToken?.expiresAt > Date.now() + 60_000) return cachedFirestoreToken.token;
  const email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Firestore Admin credentials are not configured on the server.');
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
  const windowStart = Number(usage[spec.window]) || now;
  const expired = now - windowStart >= spec.duration;
  const current = expired ? 0 : Number(profile[spec.used] ?? usage[spec.count] ?? 0);
  const limit = Number(profile[spec.limit]);
  if (!Number.isFinite(limit) || limit < 0) return { error: `Firestore ${spec.limit} is missing or invalid.` };
  return { usage: { ...usage, [spec.count]: current, [spec.window]: expired ? now : windowStart }, current, limit, allowed: current < limit };
}

async function checkUsage(uid, type) {
  const adminToken = await firestoreAccessToken();
  const { profile, error } = await readUsageProfile(uid, adminToken);
  if (error) return { allowed: false, error };
  return { ...usageState(profile, type), planTier: profile.planTier || profile.tier || 'Free' };
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
    ...messages.slice(-16).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '').slice(0, 20_000) }))
  ];
}

async function tryOpenAiProvider(provider, messages, options = {}) {
  const configs = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', label: 'Groq' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: options.vision ? 'google/gemini-3.8-flash' : 'meta-llama/llama-3.3-70b-instruct', label: 'OpenRouter' },
    cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-8b', label: 'Cerebras' },
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
      const response = await fetchWithTimeout(config.url, {
        method: 'POST', headers,
        body: JSON.stringify({ model: config.model, messages: contentMessages, temperature: 0.7, max_tokens: 2048 })
      }, 15_000);
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim()) {
          apiKeyPool.succeeded(provider, index);
          return { text: text.trim(), provider: `${config.label}${provider === 'openrouter' ? ` (Key #${index + 1})` : ''}`, model: config.model };
        }
      }
      apiKeyPool.failed(provider, index, parseRetryAfter(response));
    } catch {
      apiKeyPool.failed(provider, index);
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
      const response = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents,
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          ...(options.enableWebSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      }, 16_000);
      if (response.ok) {
        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map(part => part.text || '').join('').trim();
        if (text) {
          apiKeyPool.succeeded('gemini', index);
          const grounding = candidate.groundingMetadata || {};
          const chunks = grounding.groundingChunks || [];
          const sources = chunks.map(chunk => chunk.web && ({ title: chunk.web.title || chunk.web.uri, url: chunk.web.uri })).filter(Boolean);
          return { text, provider: `Google Gemini (Key #${index + 1})`, model: 'gemini-3.8-flash', sources };
        }
      }
      apiKeyPool.failed('gemini', index, parseRetryAfter(response));
    } catch {
      apiKeyPool.failed('gemini', index);
    }
  }
  return null;
}

function chooseChatOrder(preference, vision, search) {
  const mapped = ['groq', 'openrouter', 'cerebras', 'gemini', 'mistral'].includes(preference) ? preference : null;
  if (vision || search) return ['gemini', 'openrouter', ...CHAT_ORDER.filter(provider => provider !== 'gemini' && provider !== 'openrouter')];
  return mapped ? [mapped, ...CHAT_ORDER.filter(provider => provider !== mapped)] : CHAT_ORDER;
}

async function generateChat(body) {
  const messages = plainMessages(body.messages, String(body.systemPrompt || 'You are Zulora AI. Give accurate, helpful answers with clear formatting.').slice(0, 8_000));
  const attachments = attachmentParts(body.attachments);
  if (body.attachments?.length && !attachments.length) throw new Error('The attached image format is unsupported. Use PNG, JPEG, WebP, or GIF.');
  const vision = attachments.length > 0;
  const order = chooseChatOrder(String(body.modelPreference || 'auto'), vision, Boolean(body.enableWebSearch));
  for (const provider of order) {
    let result = provider === 'gemini'
      ? await tryGemini(messages, { attachments: body.attachments, enableWebSearch: Boolean(body.enableWebSearch) })
      : await tryOpenAiProvider(provider, messages, { attachments: body.attachments, vision });
    if (result) return result;
  }
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
          { type: 'text', text: `Edit the supplied reference image according to this request. Keep the main subject recognizable unless asked otherwise. Request: ${prompt}` },
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

async function pollinationsImage(prompt, sourceImage, aspectRatio, seed) {
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
  const longest = 1024;
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
  const response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(providerKeys.cloudflareAccountId)}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.cloudflareToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, num_steps: 4, width: aspectRatio === '16:9' ? 1024 : 768, height: aspectRatio === '9:16' ? 1024 : 768 })
  }, 24_000);
  if (!response.ok) throw new Error('Cloudflare image generation failed.');
  const data = await response.json();
  const image = data.result?.image || data.image;
  if (!image) throw new Error('Cloudflare returned no image.');
  return `data:image/png;base64,${image}`;
}

async function huggingfaceImage(prompt) {
  if (!providerKeys.huggingface) return null;
  const response = await fetchWithTimeout('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.huggingface}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt })
  }, 25_000);
  if (!response.ok) throw new Error('Hugging Face image generation failed.');
  return responseImage(response);
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
  if (!prompt) throw new Error('Write a prompt before generating an image.');
  const fullPrompt = [body.style && body.style !== 'Photorealistic' ? `Style: ${body.style}.` : '', prompt, body.negativePrompt ? `Avoid: ${String(body.negativePrompt).slice(0, 1000)}.` : ''].filter(Boolean).join(' ');
  const attempts = [];
  if (sourceImage) attempts.push(['Gemini 3.1 Flash Image', () => geminiImageEdit(fullPrompt, sourceImage, body.aspectRatio)]);
  attempts.push(['Pollinations', () => pollinationsImage(fullPrompt, sourceImage, body.aspectRatio, body.seed)]);
  if (!sourceImage) {
    attempts.push(['Fal', async () => { const data = await falRequest('fal-ai/flux/schnell', { prompt: fullPrompt, image_size: body.aspectRatio || 'square' }); return data?.images?.[0]?.url || null; }]);
    attempts.push(['Cloudflare Workers AI', () => cloudflareImage(fullPrompt, body.aspectRatio)]);
    attempts.push(['Hugging Face', () => huggingfaceImage(fullPrompt)]);
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

async function replicateVideo(prompt, duration, aspectRatio, deadline) {
  if (!providerKeys.replicate) return null;
  const remaining = () => Math.max(0, deadline - Date.now());
  if (remaining() < 1_000) return null;
  const response = await fetchWithTimeout('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
    method: 'POST', headers: { Authorization: `Bearer ${providerKeys.replicate}`, 'Content-Type': 'application/json', Prefer: 'wait=12' },
    body: JSON.stringify({ input: { prompt, prompt_optimizer: true, duration: Math.min(Number(duration) || 4, 6), aspect_ratio: aspectRatio || '16:9' } })
  }, Math.min(14_000, remaining()));
  if (!response.ok) throw new Error('Replicate video generation failed.');
  let data = await response.json();
  if (data.status !== 'succeeded' && data.urls?.get) {
    if (remaining() < 1_000) throw new Error('Replicate video generation is still running.');
    const poll = await fetchWithTimeout(data.urls.get, { headers: { Authorization: `Bearer ${providerKeys.replicate}` } }, Math.min(8_000, remaining()));
    if (!poll.ok) throw new Error('Replicate video result failed.');
    data = await poll.json();
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url || data.status === 'failed') throw new Error('Replicate returned no video.');
  return url;
}

async function falVideo(prompt, duration) {
  const data = await falRequest('fal-ai/minimax/hailuo-2.3/standard/text-to-video', {
    prompt, prompt_optimizer: true, duration: Math.min(Number(duration) || 4, 6)
  }, 16_000);
  return data?.video?.url || null;
}

async function pollinationsVideo(prompt, duration, aspectRatio, deadline) {
  const key = providerKeys.pollinations;
  if (!key) return null;
  const remaining = () => Math.max(0, deadline - Date.now());
  if (remaining() < 2_000) return null;
  const url = `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?model=google/veo-3.1-fast&duration=${Math.min(Number(duration) || 4, 8)}&aspectRatio=${encodeURIComponent(aspectRatio || '16:9')}`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${key}` } }, Math.min(20_000, remaining()));
  if (!response.ok) throw new Error('Pollinations video generation failed.');
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const data = await response.json();
    if (data.url) return data.url;
    throw new Error('Pollinations returned no video URL.');
  }
  if (!contentType.startsWith('video/')) throw new Error('Pollinations returned an unsupported video response.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 30 * 1024 * 1024) throw new Error('Pollinations video output is outside the supported size.');
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: contentType.split(';')[0] }), 'zulora-generated.mp4');
  if (remaining() < 1_500) throw new Error('Could not store the generated video before the request deadline.');
  const upload = await fetchWithTimeout('https://media.pollinations.ai/upload', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, Math.min(8_000, remaining()));
  if (upload.ok) {
    const stored = await upload.json();
    if (stored.url || stored.mediaUrl) return stored.url || stored.mediaUrl;
  }
  if (bytes.length <= 2_500_000) return `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`;
  throw new Error('Could not store the generated video for playback.');
}

async function generateVideo(body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('Write a prompt before generating a video.');
  const enriched = [prompt, body.cameraAngle ? `Camera movement: ${body.cameraAngle}.` : '', body.motionSpeed ? `Motion intensity: ${body.motionSpeed}/10.` : ''].filter(Boolean).join(' ');
  const deadline = Date.now() + 44_000;
  const attempts = [
    ['Fal AI', () => falVideo(enriched, body.duration)],
    ['Replicate', () => replicateVideo(enriched, body.duration, body.aspectRatio, deadline)],
    ['Pollinations', () => pollinationsVideo(enriched, body.duration, body.aspectRatio, deadline)]
  ];
  for (const [provider, run] of attempts) {
    if (Date.now() >= deadline) break;
    try {
      const url = await run();
      if (url) return { url, provider, model: provider === 'Fal AI' ? 'hailuo-2.3' : provider === 'Replicate' ? 'minimax-video-01' : 'veo-3.1-fast' };
    } catch (error) { console.warn(`${provider} video attempt failed:`, error.message); }
  }
  throw new Error('All configured video providers are unavailable.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return safeError(res, 405, 'Method not allowed.');
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return safeError(res, 400, 'Invalid JSON request.'); }
  }
  if (!body || typeof body !== 'object') return safeError(res, 400, 'Invalid request.');
  const type = body.action === 'chat' ? 'chat' : body.action === 'image' ? 'image' : body.action === 'video' ? 'video' : null;
  if (!type) return safeError(res, 400, 'Unsupported generation action.');
  const token = bearer(req);
  if (!token) return safeError(res, 401, 'Sign in to use Zulora AI.');
  let uid;
  try { uid = await verifyUser(req); }
  catch { return safeError(res, 503, 'Could not verify sign-in. Please retry.'); }
  if (!uid) return safeError(res, 401, 'Your sign-in session has expired. Sign in again.');

  try {
    const before = await checkUsage(uid, type);
    if (before.error) return safeError(res, 503, before.error);
    if (!before.allowed) return safeError(res, 403, before.error || `${type} limit reached. Upgrade your subscription to continue.`, { limit: before.limit, used: before.current, planTier: before.planTier });
    const output = type === 'chat' ? await generateChat(body) : type === 'image' ? await generateImage(body) : await generateVideo(body);
    const updated = await incrementUsage(uid, type);
    if (!updated.allowed) return safeError(res, 403, `${type} limit reached. Upgrade your subscription to continue.`, { limit: updated.limit, used: updated.current, planTier: updated.planTier });
    return json(res, 200, { ...output, usage: { type, used: updated.current, limit: updated.limit } });
  } catch (error) {
    const message = error?.message || 'Generation failed. Please retry.';
    console.error('Zulora generation request failed:', type, message);
    const isSetup = /FIREBASE_|Firestore Admin|Firestore .*missing|User profile was not found/.test(message);
    return safeError(res, isSetup ? 503 : 502, message);
  }
}
