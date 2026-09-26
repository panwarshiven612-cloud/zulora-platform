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
import { buildSystemPrompt } from './systemPrompt';

// ─── SAFE ENVIRONMENT EXTRACTOR ──────────────────────────────────────────────
const clientEnv = import.meta.env || {};
const getEnv = (key) => String(clientEnv[key] || '').trim();
export const GROQ_MODELS = Object.freeze({
  primary: 'llama-3.3-70b-versatile',
  fastStream: 'llama-3.1-8b-instant',
  fallback: 'gemini-2.5-flash',
});

// ─── DYNAMIC GEMINI KEY POOL ─────────────────────────────────────────────────
const GEMINI_KEYS = [getEnv('VITE_GEMINI_API_KEY'), ...Array.from({ length: 7 }, (_, index) => getEnv(`VITE_GEMINI_KEY_${index + 1}`) || getEnv(`VITE_GEMINI_API_KEY_${index + 1}`))];

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

  GEMINI_KEYS.forEach(add);

  return pool;
};

// ─── SECONDARY ENGINE KEYS ───────────────────────────────────────────────────
const GROQ_KEY = getEnv('VITE_GROQ_KEY') || getEnv('VITE_GROQ_API_KEY');
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

// ─── MODEL TIERS ─────────────────────────────────────────────────────────────
export const MODEL_TIERS = {
  auto: {
    id: 'auto',
    label: 'Auto (Smart Route)',
    shortLabel: 'Auto',
    description: 'Automatically selects a fast model or coding model',
    badge: '✦',
    color: 'text-sky-500',
    geminiModel: 'gemini-2.5-flash',
    groqModel: GROQ_MODELS.primary,
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-small-latest',
    maxTokens: 8192,
    tier: 'free',
  },
  flash: {
    id: 'flash',
    label: 'Gemini 2.5 Flash',
    shortLabel: 'Gemini Flash',
    description: 'Ultra-fast lightweight responses',
    badge: '⚡',
    color: 'text-sky-500',
    geminiModel: 'gemini-2.5-flash',
    groqModel: GROQ_MODELS.fastStream,
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.1-8b-instruct:free',
    mistralModel: 'mistral-7b-instruct',
    maxTokens: 4096,
    tier: 'free',
  },
  llama: {
    id: 'llama',
    label: 'Llama 3.3 70B',
    shortLabel: 'Llama 70B',
    description: 'Long-form coding and text generation',
    badge: '⌘',
    color: 'text-emerald-500',
    geminiModel: 'gemini-2.5-flash',
    groqModel: 'llama-3.3-70b-versatile',
    cerebrasModel: 'llama-3.3-70b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-medium',
    maxTokens: 8192,
    tier: 'free',
  },
  groq: {
    id: 'groq',
    label: 'Groq LPU (Llama 3.3 70B)',
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
    geminiModel: 'gemini-2.5-pro',
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
    shortLabel: 'Thinking',
    description: 'Extended reasoning & complex analysis',
    badge: '🧠',
    color: 'text-amber-500',
    geminiModel: 'gemini-2.5-pro',
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

const buildHistory = (contextMessages = []) =>
  contextMessages.map((m) => ({ role: m.role, content: m.content }));

const isCodingPrompt = prompt => /(?:\bcode\b|\bhtml\b|\bcss\b|\bjs\b|\bjavascript\b|\breact\b|\bfunction\b|\bbuild\s+(?:a\s+)?ui\b|\bwebsite\b|\bwebpage\b|\bweb\s+app\b|\blanding\s+page\b|\b(?:1000|\d{4,})\s*(?:\+\s*)?lines?\b|\bfull\s+(?:landing\s+page|website|web\s+app|application)\b|\binteractive\s+app\b|\bcomplete\s+(?:landing\s+page|website|web\s+app|application)\b)/i.test(String(prompt || ''));
const isComplexPrompt = prompt => /\b(?:complex|think deeply|reason(?:ing)?|analy[sz]e|analysis|architecture|derive|evaluate|proof|step by step|high reason)\b/i.test(String(prompt || ''));
const normalizeModelPreference = value => {
  const selected = String(value || 'auto').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (selected === 'think' || selected.includes('thinking') || selected.includes('3.5 pro ultra') || selected.includes('pro ultra') || ['high reason', 'high reasoning', 'reasoning'].includes(selected)) return 'think';
  if (selected === 'llama' || (selected.includes('llama') && selected.includes('70b'))) return 'llama';
  if (selected === 'groq' || selected.includes('groq')) return 'groq';
  if (selected === 'pro' || selected === 'pro 314' || selected === 'zulora pro 3.14') return 'pro';
  if (selected === 'flash' || selected.includes('gemini 2.5 flash')) return 'flash';
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
  const estimatedTokens = type === 'chat' ? Math.max(512, Math.ceil(String(result?.text || '').length / 4) + 256) : undefined;
  return { ...result, usage: await trackSuccessfulUsage(type, currentUser, estimatedTokens) };
};
const isQuotaAuthorityError = error => error instanceof GenerationApiError &&
  (error.status === 401 || error.status === 403 || error.status === 429 || error.payload?.upgradeRequired || (error.status >= 500 && /Firestore|quota|usage|plan validation|verify sign-in|session/i.test(error.message)));
const ensureGenerationAllowance = async (type, currentUser) => {
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
  const model = tierConfig.geminiModel;

  const messages = [
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
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
          max_tokens: options.coding ? 8192 : tierConfig.maxTokens,
          temperature: 0.7
        })
      },
      12000
    );

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text && text.trim().length > 0) {
        return {
          text,
          model: `Gemini ${model.replace('gemini-', '').replace('-', ' ')}`,
          provider: 'Google Gemini'
        };
      }
    }
  } catch (openaiErr) {
    // Silently proceed to native generateContent
  }

  // 2. Try Native Google generateContent endpoint
  const nativeRes = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
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
        system_instruction: { parts: [{ text: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) }] },
        generationConfig: {
          maxOutputTokens: options.coding ? 8192 : tierConfig.maxTokens,
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

  const nativeData = await nativeRes.json();
  const text = nativeData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length === 0) throw new Error('Gemini empty candidate response');

  return {
    text,
    model: `Gemini ${model.replace('gemini-', '').replace('-', ' ')}`,
    provider: 'Google Gemini'
  };
};

/**
 * Groq Adapter
 */
const tryGroq = async (prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!GROQ_KEY) throw new Error('No Groq key available');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.groqModel;

  const messages = [
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
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
          ? { max_completion_tokens: tierConfig.maxTokens, reasoning_effort: 'high', reasoning_format: 'hidden', temperature: 0.6 }
          : { max_tokens: options.coding ? 8192 : tierConfig.maxTokens, temperature: 0.7 })
      })
    },
    12000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq HTTP ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
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
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
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
        max_tokens: options.coding ? 8192 : tierConfig.maxTokens,
        temperature: 0.7
      })
    },
    12000
  );

  if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
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
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
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
        max_tokens: options.coding ? 8192 : tierConfig.maxTokens
      })
    },
    14000
  );

  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
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
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
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
        max_tokens: options.coding ? 8192 : tierConfig.maxTokens
      })
    },
    12000
  );

  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
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
    { role: 'system', content: buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault) },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt }
  ];
  const res = POLLINATIONS_KEY
    ? await fetchWithTimeout('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${POLLINATIONS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistralai/mistral-small-3.2', messages, max_tokens: options.coding ? 8192 : 4096 })
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
    const tier = vision
      ? (requestedTier === 'think' || requestedTier === 'pro' ? requestedTier : 'flash')
      : requestedTier === 'auto' ? (coding ? 'think' : isComplexPrompt(prompt) ? 'pro' : 'flash') : requestedTier;
    options = { ...options, coding };
    const errors = [];
    const geminiPool = getGeminiKeyPool();
    const messages = [...buildHistory(contextMessages), { role: 'user', content: prompt }];

    await ensureGenerationAllowance('chat', options.currentUser);

    let emittedStreamTokens = false;
    try {
      const chatPayload = {
        messages,
        contextMemory: options.contextMemory,
        aiBrain: options.aiBrain || null,
        userVault: options.userVault || null,
        modelPreference: requestedTier === 'auto' ? 'auto' : tier,
        enableWebSearch: Boolean(options.webSearch),
        attachments: options.attachments || [],
        coding
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
      if (options.onToken && emittedStreamTokens) throw error;
      if (options.onToken && error instanceof GenerationApiError && (error.status === 401 || error.status === 403)) throw error;
      console.warn('[Chat] Server generation route unavailable; trying browser providers:', error.message);
    }

    const groqFirst = !vision && (requestedTier === 'auto' || requestedTier === 'groq');
    if (groqFirst) {
      try {
        return await syncUsage(await withProviderRetry(() => tryGroq(prompt, contextMessages, 'groq', options), 2), 'chat', options.currentUser);
      } catch (err) {
        errors.push(`Groq LPU: ${err.message}`);
      }
      for (let attempt = 0; attempt < geminiPool.length; attempt++) {
        const key = geminiPool[(activeGeminiIdx + attempt) % geminiPool.length];
        try {
          const result = await tryGeminiKey(key, prompt, contextMessages, 'flash', options);
          activeGeminiIdx = (activeGeminiIdx + attempt + 1) % geminiPool.length;
          return await syncUsage(result, 'chat', options.currentUser);
        } catch (err) {
          errors.push(`Gemini 2.5 Flash fallback[${attempt + 1}/${geminiPool.length}]: ${err.message}`);
        }
      }
    }

    // Explicit Llama selections stay within Groq and OpenRouter. Auto may continue to the wider fallback pool.
    if (tier === 'llama') {
      try {
        return await syncUsage(await withProviderRetry(() => tryGroq(prompt, contextMessages, tier, options), 2), 'chat', options.currentUser);
      } catch (err) {
        errors.push(`Groq Llama 3.3 70B: ${err.message}`);
      }
      for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
        try {
          return await syncUsage(await withProviderRetry(() => tryOpenRouter(prompt, contextMessages, tier, i, options), 2), 'chat', options.currentUser);
        } catch (err) {
          errors.push(`OpenRouter Llama 3.3 70B[${i}]: ${err.message}`);
        }
      }
      if (requestedTier !== 'auto') throw new Error('Groq and OpenRouter Llama 3.3 70B are temporarily unavailable.');
    }

    if (tier === 'think') {
      for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
        try {
          return await syncUsage(await withProviderRetry(() => tryOpenRouter(prompt, contextMessages, tier, i, options), 2), 'chat', options.currentUser);
        } catch (err) {
          errors.push(`OpenRouter DeepSeek R1[${i}]: ${err.message}`);
        }
      }
      for (let attempt = 0; attempt < geminiPool.length; attempt++) {
        const key = geminiPool[(activeGeminiIdx + attempt) % geminiPool.length];
        try {
          const result = await tryGeminiKey(key, prompt, contextMessages, tier, options);
          activeGeminiIdx = (activeGeminiIdx + attempt + 1) % geminiPool.length;
          return await syncUsage(result, 'chat', options.currentUser);
        } catch (err) {
          errors.push(`Gemini 2.5 Pro[${attempt + 1}/${geminiPool.length}]: ${err.message}`);
        }
      }
      for (let attempt = 0; attempt < geminiPool.length; attempt++) {
        const key = geminiPool[(activeGeminiIdx + attempt) % geminiPool.length];
        try {
          const result = await tryGeminiKey(key, prompt, contextMessages, 'flash', options);
          activeGeminiIdx = (activeGeminiIdx + attempt + 1) % geminiPool.length;
          return await syncUsage(result, 'chat', options.currentUser);
        } catch (err) {
          errors.push(`Gemini 2.5 Flash[${attempt + 1}/${geminiPool.length}]: ${err.message}`);
        }
      }
      try {
        return await syncUsage(await withProviderRetry(() => tryGroq(prompt, contextMessages, tier, options), 2), 'chat', options.currentUser);
      } catch (err) {
        errors.push(`Groq reasoning: ${err.message}`);
      }
      throw new Error('DeepSeek R1, Groq reasoning, and Gemini 2.5 Pro are temporarily unavailable.');
    }

    if (!groqFirst) {
      for (let attempt = 0; attempt < geminiPool.length; attempt++) {
        const key = geminiPool[(activeGeminiIdx + attempt) % geminiPool.length];
        try {
          const result = await tryGeminiKey(key, prompt, contextMessages, tier, options);
          activeGeminiIdx = (activeGeminiIdx + attempt + 1) % geminiPool.length;
          return await syncUsage(result, 'chat', options.currentUser);
        } catch (err) {
          errors.push(`Gemini[${attempt + 1}/${geminiPool.length}]: ${err.message}`);
        }
      }
    }

    if (vision) {
      throw new Error('Gemini image analysis is temporarily unavailable. Please retry shortly.');
    }

    // ── 2. GROQ FAILOVER ──
    if (!groqFirst) {
      try {
        return await syncUsage(await withProviderRetry(() => tryGroq(prompt, contextMessages, tier, options), 2), 'chat', options.currentUser);
      } catch (err) {
        errors.push(`Groq: ${err.message}`);
      }
    }

    // ── 3. CEREBRAS FAILOVER ──
    try {
      return await syncUsage(await withProviderRetry(() => tryCerebras(prompt, contextMessages, tier, options), 2), 'chat', options.currentUser);
    } catch (err) {
      errors.push(`Cerebras: ${err.message}`);
    }

    // ── 4. OPENROUTER KEYS (1 & 2) ──
    for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
      try {
        return await syncUsage(await withProviderRetry(() => tryOpenRouter(prompt, contextMessages, tier, i, options), 2), 'chat', options.currentUser);
      } catch (err) {
        errors.push(`OpenRouter[${i}]: ${err.message}`);
      }
    }

    // ── 5. MISTRAL FAILOVER ──
    try {
      return await syncUsage(await withProviderRetry(() => tryMistral(prompt, contextMessages, tier, options), 2), 'chat', options.currentUser);
    } catch (err) {
      errors.push(`Mistral: ${err.message}`);
    }

    // ── 6. POLLINATIONS TEXT FAILOVER ──
    try {
      return await syncUsage(await tryPollinationsText(prompt, options, contextMessages), 'chat', options.currentUser);
    } catch (err) {
      errors.push(`Pollinations: ${err.message}`);
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

    // ── Engine 1: Pollinations FLUX ──
    try {
      const fluxUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&model=flux&nologo=true`;
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
