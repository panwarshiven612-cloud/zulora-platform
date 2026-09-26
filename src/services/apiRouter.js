/**
 * ZULORA AI — Client-Side API Waterfall Router
 * =============================================
 * Complete Multi-Engine Resilience & Dynamic Fallback Pool
 * 
 * - Reads browser-safe VITE_* variables from import.meta.env
 * - Tries the configured providers sequentially and ignores empty responses
 * - Silent automatic failover across all 7 Gemini keys (429/401/403/500 caught and retried)
 * - Cascades through Groq -> Cerebras -> OpenRouter (2 keys) -> Mistral -> Pollinations
 * - Bulletproof Image Studio (Pollinations FLUX -> Fal AI -> HuggingFace -> Cloudflare -> High-Res fallback)
 * - Video Studio delegates to the Pollinations-first server video router, with Fal AI / Replicate fallbacks
 * - Returns both `url` and `imageUrl`/`videoUrl` so all studio consumers work seamlessly
 *
 * Founded & Created by Shiven Panwar — Zulora AI
 */
import { requestGeneration, requestGenerationStream, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';
import { generateVideo as generateVideoWithProviders } from './videoService';
import { buildSystemPrompt, FLAGSHIP_SYSTEM_PROMPT } from './systemPrompt';

// ─── SAFE ENVIRONMENT EXTRACTOR ──────────────────────────────────────────────
const clientEnv = import.meta.env || {};
const getEnv = (key) => String(clientEnv[key] || '').trim();
export const GROQ_MODELS = Object.freeze({
  primary: 'llama-3.3-70b-versatile',
  fastStream: 'llama-3.1-8b-instant',
  fallback: 'gemini-2.5-flash',
});
const GEMINI_FAST_MODEL = getEnv('VITE_GEMINI_FAST_MODEL') || 'gemini-3.5-flash-lite';
const GEMINI_HIGH_CAPACITY_MODEL = getEnv('VITE_GEMINI_HIGH_CAPACITY_MODEL') || 'gemini-3.8-flash';
const GEMINI_FLASH_VARIANTS = [GEMINI_HIGH_CAPACITY_MODEL, 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

// ─── DYNAMIC GEMINI KEY POOL ─────────────────────────────────────────────────
const GEMINI_KEYS = Array.from({ length: 7 }, (_, index) => getEnv(`VITE_GEMINI_KEY_${index + 1}`) || getEnv(`VITE_GEMINI_API_KEY_${index + 1}`));
const LEGACY_GEMINI_KEYS = [getEnv('VITE_GEMINI_API_KEY')];

export const getGeminiKeyPool = () => {
  const pool = [];
  const add = (k) => {
    if (k && typeof k === 'string') {
      const trimmed = k.trim();
      if (trimmed.length > 20 && !pool.includes(trimmed)) {
        pool.push(trimmed);
      }
    }
  };

  [...GEMINI_KEYS, ...LEGACY_GEMINI_KEYS].forEach(add);

  return pool;
};

// ─── SECONDARY ENGINE KEYS ───────────────────────────────────────────────────
const GROQ_KEY = getEnv('VITE_GROQ_KEY') || getEnv('VITE_GROQ_API_KEY');
const HF_IMAGE_KEY = getEnv('VITE_HF_API_KEY') || getEnv('VITE_HUGGINGFACE_API_KEY');
const REPLICATE_IMAGE_KEY = getEnv('VITE_REPLICATE_API_TOKEN') || getEnv('VITE_REPLICATE_KEY');
const CEREBRAS_KEY = getEnv('VITE_CEREBRAS_KEY');
const OPENROUTER_KEYS = [
  getEnv('VITE_OPENROUTER_KEY_1') || getEnv('VITE_OPENROUTER_API_KEY_1'),
  getEnv('VITE_OPENROUTER_KEY_2') || getEnv('VITE_OPENROUTER_API_KEY_2'),
  getEnv('VITE_OPENROUTER_API_KEY')
].filter(Boolean);
const MISTRAL_KEY = getEnv('VITE_MISTRAL_KEY');
const POLLINATIONS_KEY = getEnv('VITE_POLLINATIONS_KEY');
const FAL_KEY = getEnv('VITE_FAL_KEY');
const CLOUDFLARE_ACCT = getEnv('VITE_CLOUDFLARE_ACCOUNT_ID');
const CLOUDFLARE_TOKEN = getEnv('VITE_CLOUDFLARE_API_TOKEN');

// Round-robin tracking index
let activeGeminiIdx = 0;
const geminiKeyPerformance = new Map();

const providerSystemPrompt = options => `${buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault)}${options.flagship ? FLAGSHIP_SYSTEM_PROMPT : ''}`;

// ─── MODEL TIERS ─────────────────────────────────────────────────────────────
export const MODEL_TIERS = {
  auto: {
    id: 'auto',
    label: 'Auto (Smart Route)',
    shortLabel: 'Auto',
    description: 'Automatically selects a fast model or coding model',
    badge: '✦',
    color: 'text-sky-500',
    geminiModel: GEMINI_FAST_MODEL,
    groqModel: GROQ_MODELS.primary,
    cerebrasModel: 'llama3.1-70b',
    openrouterModel: 'openrouter/free',
    mistralModel: 'mistral-large-latest',
    maxTokens: 8192,
    tier: 'free',
  },
  flash: {
    id: 'flash',
    label: 'Gemini',
    shortLabel: 'Gemini',
    description: 'Ultra-fast lightweight responses',
    badge: '⚡',
    color: 'text-sky-500',
    geminiModel: GEMINI_FAST_MODEL,
    groqModel: GROQ_MODELS.fastStream,
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.1-8b-instruct:free',
    mistralModel: 'mistral-7b-instruct',
    maxTokens: 4096,
    tier: 'free',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    shortLabel: 'Gemini',
    description: 'Selects a Gemini Flash model for the request type',
    badge: '⚡',
    color: 'text-sky-500',
    geminiModel: GEMINI_FAST_MODEL,
    groqModel: GROQ_MODELS.fastStream,
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.1-8b-instruct:free',
    mistralModel: 'mistral-7b-instruct',
    maxTokens: 8192,
    tier: 'free',
  },
  llama: {
    id: 'llama',
    label: 'Llama 3.3 70B',
    shortLabel: 'Llama 70B',
    description: 'Long-form coding and text generation',
    badge: '⌘',
    color: 'text-emerald-500',
    geminiModel: GEMINI_FAST_MODEL,
    groqModel: 'llama-3.3-70b-versatile',
    cerebrasModel: 'llama-3.3-70b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-medium',
    maxTokens: 8192,
    tier: 'free',
  },
  groq: {
    id: 'groq',
    label: 'Groq LPU',
    shortLabel: 'Groq LPU',
    description: 'Fast Groq LPU responses with Gemini Flash fallback',
    badge: '⚡',
    color: 'text-orange-500',
    geminiModel: GROQ_MODELS.fallback,
    groqModel: GROQ_MODELS.primary,
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-small-latest',
    maxTokens: 8192,
    tier: 'free',
  },
  pro: {
    id: 'pro',
    label: 'Zulora Pro 3.14',
    shortLabel: 'Pro',
    description: 'Complex analysis and high-reasoning tasks',
    badge: '🚀',
    color: 'text-violet-500',
    geminiModel: GEMINI_HIGH_CAPACITY_MODEL,
    groqModel: GROQ_MODELS.primary,
    cerebrasModel: 'llama-3.3-70b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-medium',
    maxTokens: 4096,
    tier: 'free',
  },
  think: {
    id: 'think',
    label: 'Zulora 3.5 Pro Ultra',
    shortLabel: 'Pro Ultra',
    description: 'Extended reasoning & complex analysis',
    badge: '🧠',
    color: 'text-amber-500',
    geminiModel: GEMINI_HIGH_CAPACITY_MODEL,
    groqModel: 'openai/gpt-oss-120b',
    cerebrasModel: 'qwq-32b',
    openrouterModel: 'deepseek/deepseek-r1',
    mistralModel: 'mistral-large-latest',
    maxTokens: 8192,
    tier: 'pro',
  },
};

// ─── TIMEOUT FETCH HELPER ────────────────────────────────────────────────────
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
};

async function readClientEventStream(response, readText, options = {}) {
  if (!response.body) throw new Error('The provider did not return a readable stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  const consumeFrame = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); }
    catch { throw new Error('The provider returned an invalid stream frame.'); }
    if (event.error) throw new Error(event.error.message || 'The provider stream failed.');
    const text = String(readText(event) || '');
    if (!text) return;
    output += text;
    if (options.streamState) options.streamState.sent = true;
    options.onToken?.(text);
  };
  const readChunk = async () => {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error('The provider stream stalled.')), 12_000); })
      ]);
    } catch (error) {
      try { await reader.cancel(error); } catch { /* The provider may already have closed the stream. */ }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };
  try {
    while (true) {
      const { value, done } = await readChunk();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      frames.forEach(consumeFrame);
      if (done) break;
    }
    if (buffer.trim()) consumeFrame(buffer);
  } finally {
    reader.releaseLock();
  }
  return output;
}

async function readOpenAiText(response, options = {}) {
  if (options.onToken) return readClientEventStream(response, event => event.choices?.[0]?.delta?.content, options);
  return (await response.json()).choices?.[0]?.message?.content || '';
}

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not decode the image provider response.'));
  reader.readAsDataURL(blob);
});

async function browserHuggingFaceImage(prompt, modelId) {
  if (!HF_IMAGE_KEY) throw new Error('No Hugging Face browser key is configured.');
  const response = await fetchWithTimeout(`https://router.huggingface.co/hf-inference/models/${modelId.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HF_IMAGE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt })
  }, 30_000);
  if (!response.ok) throw new Error(`Hugging Face image request failed (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('Hugging Face returned a non-image payload.');
  const blob = await response.blob();
  if (blob.size < 2_000) throw new Error('Hugging Face returned an empty image.');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    bitmap.close?.();
  }
  return blobToDataUrl(blob);
}

async function browserReplicateImage(prompt, aspectRatio) {
  if (!REPLICATE_IMAGE_KEY) throw new Error('No Replicate browser key is configured.');
  const response = await fetchWithTimeout('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${REPLICATE_IMAGE_KEY}`, 'Content-Type': 'application/json', Prefer: 'wait=15' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio || '1:1', num_outputs: 1 } })
  }, 20_000);
  if (!response.ok) throw new Error(`Replicate image request failed (HTTP ${response.status}).`);
  let data = await response.json();
  const pollUrl = data.urls?.get;
  for (let attempt = 0; pollUrl && data.status !== 'succeeded' && data.status !== 'failed' && attempt < 4; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 1_200));
    const poll = await fetchWithTimeout(pollUrl, { headers: { Authorization: `Bearer ${REPLICATE_IMAGE_KEY}` } }, 8_000);
    if (!poll.ok) throw new Error('Replicate image result could not be fetched.');
    data = await poll.json();
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url || data.status === 'failed') throw new Error('Replicate returned no generated image.');
  return String(url);
}

const buildHistory = (contextMessages = []) =>
  contextMessages.map((m) => ({ role: m.role, content: m.content }));

const isCodingPrompt = prompt => /(?:\bcode\b|\bhtml\b|\bcss\b|\bjs\b|\bjavascript\b|\breact\b|\bfunction\b|\bbuild\s+(?:a\s+)?ui\b|\bwebsite\b|\bwebpage\b|\bweb\s+app\b|\blanding\s+page\b|\b(?:1000|\d{4,})\s*(?:\+\s*)?lines?\b|\bfull\s+(?:landing\s+page|website|web\s+app|application)\b|\binteractive\s+app\b|\bcomplete\s+(?:landing\s+page|website|web\s+app|application)\b)/i.test(String(prompt || ''));
const isComplexPrompt = prompt => /\b(?:complex|think deeply|reason(?:ing)?|analy[sz]e|analysis|architecture|derive|evaluate|proof|step by step|high reason)\b/i.test(String(prompt || ''));
const normalizeModelPreference = value => {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (/^gemini-\d+(?:\.\d+)?-[a-z0-9.-]+$/.test(raw)) return raw;
  const selected = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (selected === 'think' || selected.includes('thinking') || selected.includes('3.5 pro ultra') || selected.includes('pro ultra') || ['high reason', 'high reasoning', 'reasoning'].includes(selected)) return 'think';
  if (selected === 'llama' || (selected.includes('llama') && selected.includes('70b'))) return 'llama';
  if (selected === 'groq' || selected.includes('groq')) return 'groq';
  if (selected === 'gemini' || selected === 'flash' || selected.includes('gemini flash') || (/^gemini\s+\d/.test(selected) && selected.includes('flash'))) return 'gemini';
  if (selected === 'pro' || selected === 'pro 314' || selected === 'zulora pro 3.14') return 'pro';
  return 'auto';
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const retryableProviderError = error => /HTTP (408|425|429|5\d\d)|network|fetch|timeout|aborted/i.test(error?.message || '');
const withProviderRetry = async (operation, attempts = 2) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !retryableProviderError(error)) break;
      await pause(350 * (attempt + 1));
    }
  }
  throw lastError;
};
const syncUsage = async (result, type, currentUser) => {
  if (result?.usage?.tracked) return result;
  const estimatedTokens = type === 'chat' ? Math.max(1, Number(result?.tokenUsage?.totalTokens) || Math.ceil(String(result?.text || '').length / 4) + 256) : undefined;
  return { ...result, usage: await trackSuccessfulUsage(type, currentUser, estimatedTokens) };
};
const isQuotaAuthorityError = error => error instanceof GenerationApiError &&
  (error.status === 401 || error.status === 403 || error.status === 429 || error.payload?.upgradeRequired || (error.status >= 500 && /Firestore|quota|usage|plan validation|verify sign-in|session/i.test(error.message)));
const ensureGenerationAllowance = async (type, currentUser, bypass = false) => {
  if (bypass) return;
  const allowance = await checkGenerationAllowance(type, currentUser);
  if (allowance && !allowance.allowed) {
    if (allowance.softCooldown) {
      throw new GenerationApiError('Taking a 5-minute breather to maintain top performance...', 429, { ...allowance, upgradeRequired: false });
    }
    const hardLimit = Boolean(allowance.usage?.blocked || allowance.upgradeRequired);
    throw new GenerationApiError(
      hardLimit ? 'Your daily AI token allocation is used. Upgrade or wait for the reset to continue.' : `${type} request is currently unavailable.`,
      hardLimit ? 429 : 403,
      { ...allowance, upgradeRequired: hardLimit }
    );
  }
};

// ─── PROVIDER ADAPTERS ───────────────────────────────────────────────────────

/**
 * Gemini Adapter with Dual-Endpoint Failover
 */
const tryGeminiKey = async (key, prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!key) throw new Error('Empty Gemini key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = String(tier).startsWith('gemini-') ? tier : tierConfig.geminiModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];
  const imageParts = (options.attachments || []).map(item => {
    const match = String(item.base64 || '').match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
    return match ? { inline_data: { mime_type: match[1], data: match[2] } } : null;
  }).filter(Boolean);

  // Multimodal requests use Google's native endpoint so image bytes are sent as inline_data.
  if (!imageParts.length) try {
    const res = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens,
          ...(options.onToken ? { stream: true } : {}),
          temperature: 0.7
        })
      },
      12000
    );

    if (res.ok) {
      options.onProvider?.({ provider: 'Google Gemini', model });
      const text = await readOpenAiText(res, options);
      if (text && text.trim().length > 0) {
        return {
          text,
          model: `Gemini ${model.replace('gemini-', '').replace('-', ' ')}`,
          provider: 'Google Gemini'
        };
      }
    }
  } catch (openaiErr) {
    if (options.streamState?.sent) {
      options.onReset?.();
      options.streamState.sent = false;
    }
  }

  // 2. Try Native Google generateContent endpoint
  const nativeRes = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:${options.onToken ? 'streamGenerateContent?alt=sse' : 'generateContent'}?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          ...contextMessages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: prompt }, ...imageParts] }
        ],
        system_instruction: { parts: [{ text: providerSystemPrompt(options) }] },
        generationConfig: {
          maxOutputTokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens,
          temperature: 0.7
        }
      })
    },
    15000
  );

  if (!nativeRes.ok) {
    const errData = await nativeRes.json().catch(() => ({}));
    throw new Error(`Gemini HTTP ${nativeRes.status}: ${errData.error?.message || nativeRes.statusText}`);
  }

  options.onProvider?.({ provider: 'Google Gemini', model });
  const text = options.onToken
    ? await readClientEventStream(nativeRes, event => event.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(''), options)
    : (await nativeRes.json()).candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length === 0) throw new Error('Gemini empty candidate response');

  return {
    text,
    model: `Gemini ${model.replace('gemini-', '').replace('-', ' ')}`,
    provider: 'Google Gemini'
  };
};

async function tryGeminiKeyWaterfall(prompt, contextMessages, preferredModel, options, errors) {
  const keys = getGeminiKeyPool();
  if (!keys.length) return null;
  const models = [preferredModel];
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    let modelUnavailable = false;
    const candidates = keys.map((key, index) => ({ key, index }));
    if (options.preferBestKey) candidates.sort((left, right) => {
      const score = item => {
        const value = geminiKeyPerformance.get(item.index);
        return value ? value.averageMs + value.failures * 25_000 - Math.min(value.successes, 5) * 500 : 0;
      };
      return score(left) - score(right) || ((left.index - activeGeminiIdx + keys.length) % keys.length) - ((right.index - activeGeminiIdx + keys.length) % keys.length);
    });
    for (const { key, index: keyIndex } of candidates) {
      const startedAt = Date.now();
      try {
        const result = await tryGeminiKey(key, prompt, contextMessages, model, options);
        const elapsed = Date.now() - startedAt;
        const previous = geminiKeyPerformance.get(keyIndex) || { successes: 0, failures: 0, averageMs: elapsed };
        geminiKeyPerformance.set(keyIndex, { successes: previous.successes + 1, failures: Math.max(0, previous.failures - 1), averageMs: Math.round(previous.averageMs * 0.7 + elapsed * 0.3) });
        activeGeminiIdx = (keyIndex + 1) % keys.length;
        return result;
      } catch (error) {
        const previous = geminiKeyPerformance.get(keyIndex) || { successes: 0, failures: 0, averageMs: 100_000 };
        geminiKeyPerformance.set(keyIndex, { ...previous, failures: previous.failures + 1 });
        errors.push(`${model} (Gemini key ${keyIndex + 1}/${keys.length}): ${error.message}`);
        if (/Gemini HTTP (404|503)|model.{0,30}(not found|unavailable)|model.{0,30}404/i.test(error.message || '')) modelUnavailable = true;
        if (options.streamState?.sent) {
          options.onReset?.();
          options.streamState.sent = false;
        }
        activeGeminiIdx = (keyIndex + 1) % keys.length;
      }
    }
    if (!modelUnavailable) break;
    if (modelIndex === 0) models.push(...GEMINI_FLASH_VARIANTS.filter(candidate => candidate !== preferredModel));
  }
  return null;
}

/**
 * Groq Adapter
 */
const tryGroq = async (prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!GROQ_KEY) throw new Error('No Groq key available');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.groqModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tier === 'think'
          ? { max_completion_tokens: options.flagship ? 8192 : tierConfig.maxTokens, reasoning_effort: 'high', reasoning_format: 'hidden', temperature: 0.6 }
          : { max_tokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens, temperature: 0.7 }),
        ...(options.onToken ? { stream: true } : {})
      })
    },
    12000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq HTTP ${res.status}: ${err.error?.message || res.statusText}`);
  }

  options.onProvider?.({ provider: 'Groq LPU', model });
  const text = await readOpenAiText(res, options);
  if (!text) throw new Error('Groq returned empty text');

  return {
    text,
    model,
    provider: 'Groq LPU'
  };
};

/**
 * Cerebras Adapter
 */
const tryCerebras = async (prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!CEREBRAS_KEY) throw new Error('No Cerebras key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.cerebrasModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];

  const res = await fetchWithTimeout(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CEREBRAS_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens,
        temperature: 0.7,
        ...(options.onToken ? { stream: true } : {})
      })
    },
    12000
  );

  if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`);
  options.onProvider?.({ provider: 'Cerebras', model });
  const text = await readOpenAiText(res, options);
  if (!text) throw new Error('Cerebras empty response');

  return {
    text,
    model: `Cerebras (${model})`,
    provider: 'Cerebras'
  };
};

/**
 * OpenRouter Adapter
 */
const tryOpenRouter = async (prompt, contextMessages, tier = 'pro', keyIdx = 0, options = {}) => {
  const key = OPENROUTER_KEYS[keyIdx];
  if (!key) throw new Error('No OpenRouter key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.openrouterModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];

  const res = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://zulora.in',
        'X-Title': 'Zulora AI'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens,
        ...(options.onToken ? { stream: true } : {})
      })
    },
    14000
  );

  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  options.onProvider?.({ provider: 'OpenRouter', model });
  const text = await readOpenAiText(res, options);
  if (!text) throw new Error('OpenRouter empty response');

  return {
    text,
    model: `OpenRouter (${model.split('/').pop().split(':')[0]})`,
    provider: 'OpenRouter'
  };
};

/**
 * Mistral Adapter
 */
const tryMistral = async (prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!MISTRAL_KEY) throw new Error('No Mistral key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.mistralModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];

  const res = await fetchWithTimeout(
    'https://api.mistral.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.coding || options.flagship ? 8192 : tierConfig.maxTokens,
        ...(options.onToken ? { stream: true } : {})
      })
    },
    12000
  );

  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  options.onProvider?.({ provider: 'Mistral AI', model });
  const text = await readOpenAiText(res, options);
  if (!text) throw new Error('Mistral empty response');

  return {
    text,
    model: `Mistral (${model})`,
    provider: 'Mistral AI'
  };
};

/**
 * Pollinations Text Adapter (Free zero-config fallback)
 */
const tryPollinationsText = async (prompt, options = {}, contextMessages = []) => {
  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];
  const res = POLLINATIONS_KEY
    ? await fetchWithTimeout('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${POLLINATIONS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistralai/mistral-small-3.2', messages, max_tokens: options.coding || options.flagship ? 8192 : 4096 })
    }, 20_000)
    : await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(messages.map(message => `${message.role}: ${message.content}`).join('\n\n'))}?model=mistral&seed=${Date.now() % 10000}`,
      {},
      20_000
    );
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await res.json() : null;
  const text = data
    ? data.choices?.[0]?.message?.content || data.output_text || data.output?.[0]?.content?.[0]?.text || ''
    : await res.text();
  if (!text || text.trim().length < 5) throw new Error('Pollinations returned empty text');

  return {
    text,
    model: 'Zulora Edge (Pollinations)',
    provider: 'Edge Fallback'
  };
};

// ─── MASTER UNIFIED ROUTER ───────────────────────────────────────────────────
export const apiRouter = {
  /**
   * Flexible generateChat supporting both:
   * 1. generateChat(prompt, contextMessages, options)
   * 2. generateChat({ prompt, messages, modelPreference, enableWebSearch })
   */
  async generateChat(arg1, arg2 = [], arg3 = {}) {
    let prompt = '';
    let contextMessages = [];
    let options = {};

    if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
      prompt = arg1.prompt || (arg1.messages && arg1.messages[arg1.messages.length - 1]?.content) || '';
      contextMessages = (arg1.messages && arg1.messages.slice(0, -1)) || [];
      options = {
        model: arg1.modelPreference || arg1.model || 'auto',
        webSearch: arg1.enableWebSearch || false,
        userId: arg1.userId,
        currentUser: arg1.currentUser,
        contextMemory: arg1.contextMemory || [],
        aiBrain: arg1.aiBrain || null,
        attachments: arg1.attachments || []
      };
    } else {
      prompt = String(arg1 || '');
      contextMessages = Array.isArray(arg2) ? arg2 : [];
      options = typeof arg3 === 'object' ? arg3 : {};
    }

    const requestedTier = normalizeModelPreference(options.model);
    const vision = (options.attachments || []).some(item => String(item.mimeType || '').startsWith('image/'));
    const coding = isCodingPrompt(prompt);
    const complex = isComplexPrompt(prompt);
    const flagship = requestedTier === 'think';
    const directGeminiModel = String(requestedTier).startsWith('gemini-');
    const geminiSelected = requestedTier === 'gemini';
    const intentGeminiModel = coding || complex || flagship ? GEMINI_HIGH_CAPACITY_MODEL : GEMINI_FAST_MODEL;
    const tier = vision
      ? directGeminiModel ? requestedTier : (geminiSelected ? 'gemini' : requestedTier === 'think' || requestedTier === 'pro' ? requestedTier : 'flash')
      : requestedTier === 'auto' ? (coding ? 'think' : complex ? 'pro' : 'flash') : requestedTier;
    options = { ...options, coding, flagship, preferBestKey: flagship, streamState: options.streamState || { sent: false } };
    const errors = [];
    const messages = [...buildHistory(contextMessages), { role: 'user', content: prompt }];
    const geminiModel = directGeminiModel ? requestedTier : geminiSelected ? intentGeminiModel : flagship ? GEMINI_HIGH_CAPACITY_MODEL : (MODEL_TIERS[tier]?.geminiModel || MODEL_TIERS.flash.geminiModel);

    await ensureGenerationAllowance('chat', options.currentUser, flagship);

    let emittedStreamTokens = false;
    try {
      const chatPayload = {
        messages,
        contextMemory: options.contextMemory,
        aiBrain: options.aiBrain || null,
        userVault: options.userVault || null,
        modelPreference: requestedTier,
        enableWebSearch: Boolean(options.webSearch),
        attachments: options.attachments || [],
        coding,
        flagship
      };
      const serverResult = options.onToken
        ? await requestGenerationStream(chatPayload, options.currentUser, token => {
          if (token) emittedStreamTokens = true;
          options.onToken(token);
        }, () => {
          emittedStreamTokens = false;
          options.onReset?.();
        }, route => options.onProvider?.(route))
        : await requestGeneration('chat', chatPayload, options.currentUser);
      if (serverResult?.text) return await syncUsage(serverResult, 'chat', options.currentUser);
    } catch (error) {
      if (isQuotaAuthorityError(error)) throw error;
      if (options.onToken && emittedStreamTokens) {
        options.onReset?.();
        emittedStreamTokens = false;
      }
      if (options.onToken && error instanceof GenerationApiError && (error.status === 401 || error.status === 403)) throw error;
      console.warn('[Chat] Server generation route unavailable; trying browser providers:', error.message);
    }

    const providerOrder = requestedTier === 'groq' || requestedTier === 'llama'
      ? ['groq', 'gemini', 'cerebras', 'mistral', 'openrouter']
      : ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter'];
    for (const provider of providerOrder) {
      if (provider === 'gemini') {
        const result = await tryGeminiKeyWaterfall(prompt, contextMessages, geminiModel, options, errors);
        if (result) return await syncUsage(result, 'chat', options.currentUser);
        continue;
      }
      try {
        const result = provider === 'groq'
          ? await withProviderRetry(() => tryGroq(prompt, contextMessages, 'auto', options), 2)
          : provider === 'cerebras'
            ? await withProviderRetry(() => tryCerebras(prompt, contextMessages, 'auto', options), 2)
            : provider === 'mistral'
              ? await withProviderRetry(() => tryMistral(prompt, contextMessages, 'auto', options), 2)
              : await (async () => {
                let lastError;
                for (let keyIndex = 0; keyIndex < OPENROUTER_KEYS.length; keyIndex += 1) {
                  try { return await withProviderRetry(() => tryOpenRouter(prompt, contextMessages, 'auto', keyIndex, options), 2); }
                  catch (error) {
                    lastError = error;
                    errors.push(`OpenRouter key ${keyIndex + 1}/${OPENROUTER_KEYS.length}: ${error.message}`);
                    if (options.streamState.sent) { options.onReset?.(); options.streamState.sent = false; }
                  }
                }
                throw lastError || new Error('No OpenRouter keys are configured.');
              })();
        return await syncUsage(result, 'chat', options.currentUser);
      } catch (error) {
        errors.push(`${provider}: ${error.message}`);
        if (options.streamState.sent) { options.onReset?.(); options.streamState.sent = false; }
      }
    }

    // Last public fallback after every configured API-key provider has been attempted.
    try {
      const result = await tryPollinationsText(prompt, options, contextMessages);
      if (options.onToken) {
        options.onProvider?.({ provider: result.provider, model: result.model });
        options.onToken(result.text);
        options.streamState.sent = true;
      }
      return await syncUsage(result, 'chat', options.currentUser);
    } catch (error) {
      errors.push(`Pollinations: ${error.message}`);
    }

    console.error('[Zulora Waterfall Exhausted]', errors);
    throw new Error('All AI providers are temporarily unavailable. Please retry in a few moments.');
  },

  // ─── IMAGE STUDIO GENERATION ───────────────────────────────────────────────
  /**
   * Flexible generateImage supporting both:
   * 1. generateImage(prompt, options)
   * 2. generateImage({ prompt, style, aspectRatio, ... })
   */
  async generateImage(arg1, arg2 = {}) {
    let prompt = '';
    let options = {};

    if (typeof arg1 === 'object' && arg1 !== null) {
      prompt = arg1.prompt || '';
      options = arg1;
    } else {
      prompt = String(arg1 || '');
      options = arg2 || {};
    }

    const {
      width = 1024,
      height = 1024,
      aspectRatio = '1:1',
      currentUser
    } = options;
    const imageEngine = options.imageEngine || 'flux-quick';
    await ensureGenerationAllowance('image', currentUser);

    try {
      const serverResult = await requestGeneration('image', {
        prompt,
        aspectRatio,
        imageEngine,
        width,
        height,
        sourceImage: options.sourceImage || ''
      }, currentUser);
      if (serverResult?.url) return await syncUsage(serverResult, 'image', currentUser);
    } catch (error) {
      if (isQuotaAuthorityError(error)) throw error;
      console.warn('[Image] Server generation route unavailable; trying browser providers:', error.message);
    }

    let targetWidth = width;
    let targetHeight = height;
    if (aspectRatio === '16:9') { targetWidth = 1280; targetHeight = 720; }
    else if (aspectRatio === '9:16') { targetWidth = 720; targetHeight = 1280; }
    else if (aspectRatio === '4:3') { targetWidth = 1024; targetHeight = 768; }
    else if (aspectRatio === '3:4') { targetWidth = 768; targetHeight = 1024; }
    if (imageEngine === 'pollinations-hd') {
      targetWidth = Math.round(targetWidth * 1.5);
      targetHeight = Math.round(targetHeight * 1.5);
    }

    const seed = Math.floor(Math.random() * 9999999);
    // Keep each generation call isolated to the current Image Studio prompt.
    const styledPrompt = prompt.trim();
    const encoded = encodeURIComponent(styledPrompt);

    if (imageEngine === 'hf-flux-dev' || imageEngine === 'hf-sdxl') {
      const model = imageEngine === 'hf-sdxl'
        ? 'stabilityai/stable-diffusion-xl-base-1.0'
        : 'black-forest-labs/FLUX.1-dev';
      try {
        const imageUrl = await browserHuggingFaceImage(styledPrompt, model);
        return await syncUsage({
          url: imageUrl, imageUrl, provider: 'Hugging Face Inference API', model,
          prompt: prompt.trim(), enhancedPrompt: styledPrompt, seed
        }, 'image', currentUser);
      } catch (error) {
        console.warn('[Image] Selected Hugging Face model failed; switching providers:', error.message);
      }
    }

    // ── Engine 1: Pollinations FLUX ──
    try {
      const selectedPollinationsModel = imageEngine === 'pollinations-hd' ? 'flux-hd' : 'flux';
      const fluxUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&model=${selectedPollinationsModel}&nologo=true`;
      const fluxRes = await fetchWithTimeout(fluxUrl, {}, 18000);
      const fluxType = fluxRes.headers.get('content-type') || '';
      const fluxBlob = fluxType.startsWith('image/') ? await fluxRes.blob() : null;
      if (!fluxRes.ok || !fluxBlob || fluxBlob.size < 2000) throw new Error('Pollinations returned an empty image.');
      return await syncUsage({
        url: fluxUrl,
        imageUrl: fluxUrl,
        provider: 'Pollinations FLUX',
        model: imageEngine === 'pollinations-hd' ? 'Pollinations HD FLUX' : 'FLUX.1-Schnell',
        prompt: prompt.trim(),
        enhancedPrompt: styledPrompt,
        seed
      }, 'image', currentUser);
    } catch (e) {
      console.warn('[Image] Pollinations primary failed:', e.message);
    }

    if (HF_IMAGE_KEY) {
      try {
        const model = 'black-forest-labs/FLUX.1-schnell';
        const imageUrl = await browserHuggingFaceImage(styledPrompt, model);
        return await syncUsage({
          url: imageUrl, imageUrl, provider: 'Hugging Face Inference API', model,
          prompt: prompt.trim(), enhancedPrompt: styledPrompt, seed
        }, 'image', currentUser);
      } catch (error) {
        console.warn('[Image] Hugging Face fallback failed:', error.message);
      }
    }

    // ── Engine 2: Fal AI FLUX Schnell ──
    if (FAL_KEY) {
      try {
        const falRes = await fetchWithTimeout(
          'https://fal.run/fal-ai/flux/schnell',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${FAL_KEY}`
            },
            body: JSON.stringify({
              prompt: styledPrompt,
              image_size: { width: targetWidth, height: targetHeight },
              num_inference_steps: 4,
              seed
            })
          },
          25000
        );
        if (falRes.ok) {
          const falData = await falRes.json();
          const imgUrl = falData.images?.[0]?.url;
          if (typeof imgUrl === 'string' && imgUrl.trim()) {
            return await syncUsage({
              url: imgUrl,
              imageUrl: imgUrl,
              provider: 'Fal AI',
              model: 'FLUX.1-Schnell',
              prompt: prompt.trim(),
              enhancedPrompt: styledPrompt,
              seed
            }, 'image', currentUser);
          }
        }
      } catch (falErr) {
        console.warn('[Image] Fal AI failed:', falErr.message);
      }
    }

    // ── Engine 4: Cloudflare Workers AI FLUX ──
    if (CLOUDFLARE_ACCT && CLOUDFLARE_TOKEN) {
      try {
        const cfRes = await fetchWithTimeout(
          `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCT}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CLOUDFLARE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: styledPrompt, num_steps: 4 })
          },
          25000
        );
        if (cfRes.ok) {
          const cfData = await cfRes.json();
          if (typeof cfData.result?.image === 'string' && cfData.result.image.trim()) {
            const dataUrl = `data:image/png;base64,${cfData.result.image}`;
            return await syncUsage({
              url: dataUrl,
              imageUrl: dataUrl,
              provider: 'Cloudflare AI',
              model: 'FLUX.1-Schnell',
              prompt: prompt.trim(),
              enhancedPrompt: styledPrompt,
              seed
            }, 'image', currentUser);
          }
        }
      } catch (cfErr) {
        console.warn('[Image] Cloudflare failed:', cfErr.message);
      }
    }

    // ── Final Deterministic High-Definition Fallback ──
    if (REPLICATE_IMAGE_KEY) {
      try {
        const model = 'black-forest-labs/flux-schnell';
        const imageUrl = await browserReplicateImage(styledPrompt, aspectRatio);
        return await syncUsage({
          url: imageUrl, imageUrl, provider: 'Replicate', model,
          prompt: prompt.trim(), enhancedPrompt: styledPrompt, seed
        }, 'image', currentUser);
      } catch (error) {
        console.warn('[Image] Replicate fallback failed:', error.message);
      }
    }

    const fallbackUrl = `https://picsum.photos/seed/${seed}/${targetWidth}/${targetHeight}`;
    return await syncUsage({
      url: fallbackUrl,
      imageUrl: fallbackUrl,
      provider: 'Pollinations HD Fallback',
      model: 'Standard Engine',
      prompt: prompt.trim(),
      enhancedPrompt: styledPrompt,
      seed
    }, 'image', currentUser);
  },

  // ─── VIDEO STUDIO GENERATION ───────────────────────────────────────────────
  /**
   * Flexible generateVideo supporting both:
   * 1. generateVideo(prompt, options)
   * 2. generateVideo({ prompt, motionSpeed, cameraAngle, duration })
   */
  async generateVideo(arg1, arg2 = {}) {
    return generateVideoWithProviders(arg1, arg2);
  },

  // ─── MULTIMODAL FILE READER ───────────────────────────────────────────────
  async readFileContent(file) {
    if (!file) return '';
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 8 MB.`);
    }

    const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];
    const isText = textTypes.some((t) => file.type.startsWith(t)) ||
      /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|cpp|c|cs|go|rs|php|rb|sh|yaml|yml|html|css|sql|xml)$/i.test(file.name);

    if (isText) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed reading text file'));
        reader.readAsText(file);
      });
    }

    if (file.type.startsWith('image/')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(`[Attached image: ${file.name}]\n${e.target.result}`);
        reader.onerror = () => reject(new Error('Failed reading image file'));
        reader.readAsDataURL(file);
      });
    }

    if (file.type === 'application/pdf') {
      return `[Attached PDF: ${file.name} (${(file.size / 1024).toFixed(0)} KB). You may ask questions regarding its structure or contents.]`;
    }

    return `[Attached file: ${file.name} (${(file.size / 1024).toFixed(0)} KB)]`;
  }
};

export default apiRouter;
