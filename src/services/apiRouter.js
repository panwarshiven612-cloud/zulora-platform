/**
 * ZULORA AI â€” Client-Side API Waterfall Router
 * =============================================
 * Complete Multi-Engine Resilience & Dynamic Fallback Pool
 * 
 * - Sends text generation through the authenticated server-side provider waterfall
 * - Keeps text-provider keys out of browser code and bundles
 * - Uses only explicitly listed browser media settings for client-side fallbacks
 * - Bulletproof Image Studio (Pollinations FLUX -> Fal AI -> HuggingFace -> Cloudflare -> High-Res fallback)
 * - Video Studio delegates to the Pollinations-first server video router, with Fal AI / Replicate fallbacks
 * - Returns both `url` and `imageUrl`/`videoUrl` so all studio consumers work seamlessly
 *
 * Founded & Created by Shiven Panwar â€” Zulora AI
 */
import { requestConnectorModel, requestGeneration, requestGenerationStream, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';
import { generateVideo as generateVideoWithProviders } from './videoService';
import { buildSystemPrompt, FLAGSHIP_SYSTEM_PROMPT } from './systemPrompt';
import { webSearch, formatCitations } from './webSearch';
import { AI_STUDIO_SYSTEM_PROMPT } from './aiStudioPrompt';
import { GEMINI_FLASH_MODEL_ID, GEMINI_MODELS, GEMINI_PRO_MODEL_ID, isCodeGenerationPrompt, normalizeGeminiModelId, toGeminiInlineData } from './aiModels';
import { buildImagePrompt } from './imageGen';
import connectorManager from './connectorManager';
import { checkExtensionConnected } from './browserAgentEngine';
import { classifyGoogleConnectorIntents, executeGoogleConnectorFunction, getGoogleConnectorFunctionDeclarations, getGoogleConnectorFunctionProvider, getGoogleConnectorToolInstructions, isGoogleReconnectError, isWorkspaceMetricsWorkflowRequest, normalizeGoogleConnectorArguments, toGeminiFunctionDeclaration, toOpenAiFunctionTool } from './googleConnectorTools';

// â”€â”€â”€ SAFE ENVIRONMENT EXTRACTOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Only browser-safe media variables are read here. Text-model credentials stay
// in the server router and are never serialized into this Vite bundle.
const clientEnv = {
  VITE_GEMINI_FLASH_MODEL: import.meta.env.VITE_GEMINI_FLASH_MODEL,
  VITE_HF_API_KEY: import.meta.env.VITE_HF_API_KEY,
  VITE_HUGGINGFACE_API_KEY: import.meta.env.VITE_HUGGINGFACE_API_KEY,
  VITE_REPLICATE_API_TOKEN: import.meta.env.VITE_REPLICATE_API_TOKEN,
  VITE_REPLICATE_KEY: import.meta.env.VITE_REPLICATE_KEY,
  VITE_FAL_KEY: import.meta.env.VITE_FAL_KEY,
  VITE_CLOUDFLARE_ACCOUNT_ID: import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID,
  VITE_CLOUDFLARE_API_TOKEN: import.meta.env.VITE_CLOUDFLARE_API_TOKEN
};
const getEnv = key => String(clientEnv[key] || '').trim();
export const GROQ_MODELS = Object.freeze({
  primary: 'llama-3.3-70b-versatile',
});
const GEMINI_FLASH_MODEL = getEnv('VITE_GEMINI_FLASH_MODEL') || GEMINI_FLASH_MODEL_ID;
export { GEMINI_MODELS };

// â”€â”€â”€ DYNAMIC GEMINI KEY POOL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Text-provider credentials are kept on the server and never read from VITE_* browser variables.
export const getGeminiKeyPool = () => [];

// â”€â”€â”€ SECONDARY ENGINE KEYS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GROQ_KEY = '';
const HF_IMAGE_KEY = getEnv('VITE_HF_API_KEY') || getEnv('VITE_HUGGINGFACE_API_KEY');
const REPLICATE_IMAGE_KEY = getEnv('VITE_REPLICATE_API_TOKEN') || getEnv('VITE_REPLICATE_KEY');
const FAL_KEY = getEnv('VITE_FAL_KEY');
const CLOUDFLARE_ACCT = getEnv('VITE_CLOUDFLARE_ACCOUNT_ID');
const CLOUDFLARE_TOKEN = getEnv('VITE_CLOUDFLARE_API_TOKEN');

// Round-robin tracking index
let activeGeminiIdx = 0;
const geminiKeyPerformance = new Map();

const providerSystemPrompt = options => [
  buildSystemPrompt(options.contextMemory, undefined, options.aiBrain, options.userVault),
  getGoogleConnectorToolInstructions(options.connectorProviders),
  options.connectorContext ? `NATIVE CONNECTORS CONTEXT:\n${options.connectorContext}` : '',
  // MODULE 7: Inject web search grounding
  options.flagship ? FLAGSHIP_SYSTEM_PROMPT : '',
  options._searchContext ? `\nWEB SEARCH RESULTS (cite inline as [1],[2] markers):\n${options._searchContext}` : '',
].filter(Boolean).join('\n\n');

// â”€â”€â”€ MODEL TIERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const MODEL_TIERS = {
  auto: {
    id: 'auto',
    label: 'Auto (Smart Route)',
    shortLabel: 'Auto',
    description: 'Automatically selects a fast model or coding model',
    badge: 'âœ¦',
    color: 'text-sky-500',
    geminiModel: GEMINI_FLASH_MODEL,
    groqModel: GROQ_MODELS.primary,
    maxTokens: 8192,
    tier: 'free',
  },
  flash: {
    id: 'flash',
    label: 'Zulora Flash 3.5',
    shortLabel: 'Flash 3.5',
    description: 'Gemini 3.5 Flash with Gemini Pro and Groq backup routes',
    badge: 'âš¡',
    color: 'text-sky-500',
    geminiModel: GEMINI_FLASH_MODEL,
    groqModel: GROQ_MODELS.primary,
    maxTokens: 4096,
    tier: 'free',
  },
  groq: {
    id: 'groq',
    label: 'Zulora Turbo Speed',
    shortLabel: 'Turbo Speed',
    description: 'Fast Groq LPU responses with Gemini backup routes',
    badge: 'âš¡',
    color: 'text-orange-500',
    geminiModel: GEMINI_FLASH_MODEL,
    groqModel: GROQ_MODELS.primary,
    maxTokens: 8192,
    tier: 'free',
  },
  think: {
    id: 'think',
    label: 'Zulora 3.1 Pro Ultra',
    shortLabel: 'Pro Ultra',
    description: 'Extended reasoning & complex analysis',
    badge: 'ðŸ§ ',
    color: 'text-amber-500',
    geminiModel: GEMINI_PRO_MODEL_ID,
    groqModel: GROQ_MODELS.primary,
    maxTokens: 8192,
    tier: 'pro',
  },
};

// â”€â”€â”€ TIMEOUT FETCH HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
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

async function browserHuggingFaceImage(prompt, modelId, sourceImage = '') {
  if (!HF_IMAGE_KEY) throw new Error('No Hugging Face browser key is configured.');
  const imageMatch = String(sourceImage || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (sourceImage && !imageMatch) throw new Error('Reference image must be a PNG, JPEG, or WebP data URL.');
  const body = imageMatch
    ? { inputs: imageMatch[2], parameters: { prompt, guidance_scale: 3.5, num_inference_steps: 28 } }
    : { inputs: prompt };
  const response = await fetchWithTimeout(`https://router.huggingface.co/hf-inference/models/${modelId.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HF_IMAGE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

// MODULE 1: Adaptive Dynamic Context & Thinking Tokens Allocation
const isComplexPrompt = (prompt, options = {}) => {
  if (options.coding || options.flagship || options.connectorContext || options.complex || options.analysis) return true;
  return /\b(?:complex|think deeply|reason(?:ing)?|analy[sz]e|analysis|audit|architecture|derive|evaluate|proof|step by step|high reason|calendar|schedule|meeting|email|inbox|workflow|automate|draft)\b/i.test(String(prompt || ''));
};

const buildHistory = (contextMessages = [], isComplex = false) => {
  const msgs = Array.isArray(contextMessages) ? contextMessages : [];
  if (isComplex) {
    // Complex tasks: full model context window without rigid truncation
    return msgs.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    }));
  }
  // Fast path for simple queries: lean context up to 24 recent turns with 64k char budget
  const recent = msgs.slice(-24);
  let remainingChars = 64_000;
  const pruned = [];
  for (let i = recent.length - 1; i >= 0 && remainingChars > 0; i -= 1) {
    const message = recent[i];
    const text = String(message?.content || '');
    const sliceLen = Math.min(text.length, remainingChars);
    const content = text.slice(-sliceLen);
    if (content) {
      pruned.unshift({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
      remainingChars -= content.length;
    }
  }
  return pruned;
};

const isCodingPrompt = prompt => isCodeGenerationPrompt(prompt);
const normalizeModelPreference = value => {
  const raw = String(value || 'auto').trim().toLowerCase();
  const modelId = normalizeGeminiModelId(raw);
  if (modelId) return modelId;
  const selected = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (selected === 'think' || selected.includes('thinking') || selected.includes('3.5 pro ultra') || selected.includes('pro ultra') || /zulora 3\.1 pro(?: ultra)?/.test(selected) || ['high reason', 'high reasoning', 'reasoning'].includes(selected)) return 'think';
  if (selected === 'llama' || (selected.includes('llama') && /(?:70b|3\.3)/.test(selected))) return 'groq';
  if (selected === 'groq' || selected.includes('groq') || selected.includes('turbo')) return 'groq';
  if (selected === 'flash' || selected.includes('gemini flash') || selected.includes('zulora flash')) return 'flash';
  if (selected === 'gemini' || (/^gemini\s+\d/.test(selected) && selected.includes('flash'))) return 'gemini';
  if (selected === 'pro' || selected === 'pro 314' || selected === 'zulora pro 3.14') return 'think';
  return 'auto';
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const retryableProviderError = error => {
  const message = error?.message || '';
  return !/HTTP \d{3}/i.test(message) && /network|fetch|timeout|aborted/i.test(message);
};
const withProviderRetry = async (operation, attempts = 2, signal) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
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
const ensureGenerationAllowance = async (type, currentUser, requestContext = {}) => {
  const allowance = await checkGenerationAllowance(type, currentUser, requestContext);
  if (allowance && !allowance.allowed) {
    const hardLimit = Boolean(allowance.usage?.blocked || allowance.upgradeRequired);
    throw new GenerationApiError(
      hardLimit ? 'Your rolling usage limit is reached. Capacity returns automatically as earlier usage expires.' : `${type} request is currently unavailable.`,
      hardLimit ? 429 : 403,
      { ...allowance, upgradeRequired: hardLimit }
    );
  }
};

// â”€â”€â”€ PROVIDER ADAPTERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Gemini Adapter with Dual-Endpoint Failover
 */
const tryGeminiKey = async (key, prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!key) throw new Error('Empty Gemini key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.think;
  const model = String(tier).startsWith('gemini-') ? tier : tierConfig.geminiModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages, isComplexPrompt(prompt, options)),
    { role: 'user', content: prompt },
  ];
  const inlineParts = (options.attachments || []).map(toGeminiInlineData).filter(Boolean)
    .map(({ mimeType, data }) => ({ inlineData: { mimeType, data } }));

  // Multimodal requests use Google's native endpoint so image/PDF bytes are sent inline.
  if (!inlineParts.length) try {
    const res = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      {
        method: 'POST',
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.coding || options.flagship ? 16_384 : tierConfig.maxTokens,
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
    if (!res.ok && ([401, 403, 408, 425, 429].includes(res.status) || res.status >= 500)) {
      const err = await res.json().catch(() => ({}));
      const providerError = new Error(`Gemini HTTP ${res.status}: ${err.error?.message || res.statusText}`);
      providerError.status = res.status;
      throw providerError;
    }
  } catch (openaiErr) {
    if (options.signal?.aborted) throw openaiErr;
    if (openaiErr?.status) throw openaiErr;
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
      signal: options.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          ...contextMessages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: prompt }, ...inlineParts] }
        ],
        system_instruction: { parts: [{ text: providerSystemPrompt(options) }] },
        generationConfig: {
          maxOutputTokens: options.coding || options.flagship ? 16_384 : tierConfig.maxTokens,
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
  if (![GEMINI_PRO_MODEL_ID, 'gemini-2.5-pro'].includes(preferredModel)) models.push(GEMINI_PRO_MODEL_ID);
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
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
        if (options.signal?.aborted) throw error;
        const previous = geminiKeyPerformance.get(keyIndex) || { successes: 0, failures: 0, averageMs: 100_000 };
        geminiKeyPerformance.set(keyIndex, { ...previous, failures: previous.failures + 1 });
        errors.push(`${model} (Gemini key ${keyIndex + 1}/${keys.length}): ${error.message}`);
        if (options.streamState?.sent) {
          options.onReset?.();
          options.streamState.sent = false;
        }
        activeGeminiIdx = (keyIndex + 1) % keys.length;
      }
    }
  }
  return null;
}

function requestedConnectorProvider(prompt, declarations = []) {
  const text = String(prompt || '');
  if (/\b(?:should\s+i|should\s+we|how\s+do\s+i|how\s+to|whether\s+i\s+should)\b/i.test(text)) return '';
  if (isWorkspaceMetricsWorkflowRequest(text)) return 'workspace';
  const intents = classifyGoogleConnectorIntents(text);
  if (intents.length) return intents[0];
  const providers = new Set(declarations.map(declaration => typeof declaration === 'string' ? declaration : getGoogleConnectorFunctionProvider(declaration.name)));
  if (providers.has('gmail') && /\b(?:gmail|inbox|e-?mails?|mail messages?)\b/i.test(text)
    && /\b(?:send|read|review|summari[sz]e|draft|compose|search|check|show|list|find|retrieve|fetch|latest|recent|analy[sz]e|how\s+many|tell\s+me|what(?:'s|\s+is)\s+in)\b/i.test(text)) return 'gmail';
  if (providers.has('calendar') && /\b(?:calendar|events?|meetings?|appointments?)\b/i.test(text)
    && /\b(?:schedule|book|create|list|show|check|find|delete|remove|cancel|upcoming|analy[sz]e|tell\s+me|what(?:'s|\s+is)\s+on)\b/i.test(text)) return 'calendar';
  if (providers.has('sheets') && /\b(?:spreadsheet|google\s*sheets?)\b/i.test(text)
    && /\b(?:read|append|write|update|add|create|list|show|find|search)\b/i.test(text)) return 'sheets';
  if (providers.has('forms') && /\b(?:google\s+)?forms?\b/i.test(text)
    && /\b(?:read|create|make|build|show|list|responses?)\b/i.test(text)) return 'forms';
  if (providers.has('drive') && /\bdrive\b/i.test(text)
    && /\b(?:list|show|search|find|download|open|manage|delete|trash|inspect)\b/i.test(text)) return 'drive';
  if (providers.has('computer') && /\b(?:computer|system|browser)\b/i.test(text)
    && /\b(?:scan|inspect|check)\b/i.test(text)) return 'computer';
  return '';
}

const asksForClarification = text => /\b(?:please\s+(?:provide|specify|share)|need(?:s)?\s+(?:the|a|an|more|some)|which\b|who\b|when\b|what\s+(?:date|time|subject|recipient|body|message)|what\s+should\s+i\s+(?:include|write)|would\s+you\s+like|could\s+you\s+(?:specify|share|provide)|before\s+i\s+can)\b/i.test(text);

function connectorBadgeForResults(results = []) {
  const providers = [...new Set(results
    .filter(item => item?.executionVerified === true && item?.result && !item.result.error)
    .map(item => getGoogleConnectorFunctionProvider(item.name)))];
  const badges = { gmail: '📧 Gmail Connector', calendar: '📅 Google Calendar Connector', computer: '💻 Computer Agent Plugin', workspace: 'Google Workspace Workflow' };
  return providers.map(provider => badges[provider]).filter(Boolean).join(' · ');
}

function connectorFailureResult({ name, error, model, provider, totalTokens, toolResults = [] }) {
  const declaredProvider = getGoogleConnectorFunctionProvider(name);
  const needsReconnect = isGoogleReconnectError(error);
  const message = String(error?.message || '');
  const inferredProvider = /(?:Google\s+)?Drive/i.test(message) ? 'drive'
    : /(?:Google\s+)?Sheets/i.test(message) ? 'sheets'
      : /Gmail/i.test(message) ? 'gmail' : declaredProvider;
  const connectorProvider = needsReconnect ? (error?.connectorProvider || inferredProvider) : declaredProvider;
  const providerName = ({ gmail: 'Gmail', calendar: 'Google Calendar', computer: 'Computer Plugin', workspace: 'Google Workspace workflow', drive: 'Google Drive', sheets: 'Google Sheets' })[connectorProvider] || 'Google connector';
  const completedActions = toolResults.filter(item => item?.executionVerified === true).map(item => item.name.replaceAll('_', ' '));
  const failure = needsReconnect
    ? 'OAuth Permission Required: Please re-connect your Gmail/Calendar account.'
    : `${providerName} could not complete the request: ${error?.message || 'The connected service returned an invalid response.'}`;
  const structuredError = { status: 'error', message: error?.message || 'The connector request failed.' };
  const text = completedActions.length
    ? `Completed and verified: ${completedActions.join(', ')}. A later connector action failed. ${failure}`
    : needsReconnect ? failure : `${failure} No success is reported.`;
  return {
    text,
    status: 'error',
    error: structuredError,
    message: structuredError.message,
    model,
    provider,
    tokenUsage: { totalTokens },
    connectorData: toolResults,
    connectorProvider,
    needsReconnect,
    connectorExecutionFailed: true
  };
}

function verifyConnectorToolResult(name, result, args = {}) {
  if (result?.error || result?.success === false) throw new Error(result.error || 'The connector reported failure.');
  if (name === 'workspace_create_folder_sheet_email_metrics'
    && (!result?.folder?.id || !result?.spreadsheet?.id || !Number.isFinite(Number(result?.metrics?.sentCount)))) {
    throw new Error('The workspace dispatcher did not return verified Drive, Sheets, and Gmail results.');
  }
  const isEmailSend = name === 'gmail_send_email'
    || ['send_email', 'send_gmail', 'send_rich_email'].includes(name)
    || (name === 'reply_and_draft' && result?.isDraft !== true);
  if (isEmailSend) {
    if (result?.verified !== true || !result?.id || !result?.threadId) {
      throw new Error('Gmail did not return a verified HTTP 200 message ID and thread ID.');
    }
  }
  if (name === 'calendar_create_event' || ['create_event', 'create_calendar_event'].includes(name)) {
    if (result?.verified !== true || !result?.id) throw new Error('Google Calendar did not return a verified event ID.');
  }
  if (name === 'sheets_create_spreadsheet' || name === 'create_sheet') {
    if (!result?.spreadsheetId) throw new Error('Google Sheets did not return a spreadsheet ID.');
    if (args.folder_id && !result?.driveFile?.id) throw new Error('Google Drive did not confirm that the spreadsheet was moved into the requested folder.');
  }
  if (name === 'sheets_append_data' || ['append_row', 'append_sheet_row'].includes(name)) {
    if (!result?.spreadsheetId || !result?.updates) throw new Error('Google Sheets did not confirm that the rows were appended.');
  }
  if (name === 'drive_create_folder' || name === 'create_drive_folder') {
    if (!result?.id || result?.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Google Drive did not confirm the new folder.');
  }
  if (name === 'computer_scan_system' && (result?.verified !== true || !result?.scannedAt)) {
    throw new Error('The Computer Plugin did not return a verified scan.');
  }
}

async function postConnectorModelRequest(endpoint, headers, payload, options, timeoutMs, provider, normalizedRetryPayload = payload) {
  let requestPayload = payload;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      signal: options.signal,
      headers,
      body: JSON.stringify(requestPayload)
    }, timeoutMs);
    const data = await response.json().catch(() => ({}));
    const schemaError = [400, 422].includes(response.status)
      && /tool|function|schema|parameter|argument/i.test(String(data.error?.message || data.message || ''));
    if (response.ok || attempt > 0 || !schemaError) return { response, data };
    options.onProgress?.({ label: `${provider} is retrying with normalized tool schemas`, status: 'running' });
    requestPayload = normalizedRetryPayload;
  }
  throw new Error(`${provider} tool request failed after schema normalization.`);
}

async function runGeminiConnectorToolProvider({ key, keyIndex, prompt, contextMessages, model, options, declarations }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const toolResults = [];
  const executedCalls = new Map();
  const declaredNames = new Set(declarations.map(item => item.name));
  let totalTokens = 0;
  const attachments = (options.attachments || []).map(toGeminiInlineData).filter(Boolean)
    .map(({ mimeType, data }) => ({ inlineData: { mimeType, data } }));
  const contents = [
    ...contextMessages.filter(message => ['user', 'assistant', 'model'].includes(message.role)).map(message => ({
      role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }]
    })),
    { role: 'user', parts: [{ text: prompt }, ...attachments] }
  ];
  const makeResult = text => ({
    text,
    model,
    provider: 'Google Gemini',
    tokenUsage: { totalTokens },
    connectorData: toolResults,
    connectorBadge: connectorBadgeForResults(toolResults),
    ...(toolResults.length ? { connectorProvider: getGoogleConnectorFunctionProvider(toolResults[0].name) } : {})
  });

  for (let round = 0; round < 4; round += 1) {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const requestBody = {
        contents,
        system_instruction: { parts: [{ text: `${providerSystemPrompt({ ...options, connectorProviders: [...new Set(declarations.map(item => getGoogleConnectorFunctionProvider(item.name)))] })}\n\nIf a connector action is requested, call its function. Never claim an action succeeded unless the returned function result confirms it.` }] },
        tools: [{ functionDeclarations: declarations.map(toGeminiFunctionDeclaration) }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: Math.min(options.coding || options.flagship ? 16_384 : (MODEL_TIERS[options.tier]?.maxTokens || 8192), 2048), temperature: 0.4 }
    };
    const { response, data } = await postConnectorModelRequest(endpoint, { 'Content-Type': 'application/json' }, requestBody, options, 18_000, 'Google Gemini', {
      ...requestBody,
      tools: [{ functionDeclarations: declarations.map(declaration => toGeminiFunctionDeclaration(declaration)) }]
    });
    if (!response.ok) {
      const error = new Error(`Gemini HTTP ${response.status}: ${data.error?.message || response.statusText}`);
      error.status = response.status;
      throw error;
    }
    totalTokens += Number(data.usageMetadata?.totalTokenCount || 0);
    const candidate = data.candidates?.[0];
    const modelContent = candidate?.content;
    const parts = Array.isArray(modelContent?.parts) ? modelContent.parts : [];
    if (!modelContent || !parts.length) throw new Error('Gemini returned an empty connector response.');
    const calls = parts.map(part => part.functionCall).filter(call => call?.name);
    if (!calls.length) {
      const text = parts.map(part => part.text || '').join('').trim();
      if (!text) {
        if (toolResults.length) return makeResult('The connected API action completed and its response was verified.');
        throw new Error('Gemini returned no text or function call.');
      }
      const requiredProvider = requestedConnectorProvider(prompt, declarations);
      if (requiredProvider && !toolResults.length && !asksForClarification(text)) {
        throw new Error('Gemini did not issue the required connector function call.');
      }
      options.onProvider?.({ provider: 'Google Gemini', model });
      if (options.onToken) options.onToken(text);
      return makeResult(text);
    }

    const normalizedCalls = calls.map(call => {
      const name = call.name;
      if (!declaredNames.has(name)) throw new Error(`Gemini requested an undeclared connector function: ${name}.`);
      return { call, name, args: normalizeGoogleConnectorArguments(call.args, name) };
    });
    contents.push(modelContent);
    const functionResponses = [];
    for (const { call, name, args } of normalizedCalls) {
      let result;
      const signature = `${name}:${JSON.stringify(args)}`;
      if (executedCalls.has(signature)) {
        result = executedCalls.get(signature);
      } else {
        try {
          options.onProgress?.({ label: `Executing ${name.replaceAll('_', ' ')}`, status: 'running' });
          result = await executeGoogleConnectorFunction(name, args, { onProgress: options.onProgress });
          verifyConnectorToolResult(name, result, args);
          executedCalls.set(signature, result);
        } catch (error) {
          const message = error.message || 'Connector request failed.';
          const failedResult = { name, result: { status: 'error', message, error: message } };
          toolResults.push(failedResult);
          options.onProgress?.({ label: `${name.replaceAll('_', ' ')} failed`, status: 'error', detail: error.message });
          return connectorFailureResult({ name, error, model, provider: 'Google Gemini', totalTokens, toolResults });
        }
      }
      const resultEntry = { name, result, executionVerified: true };
      toolResults.push(resultEntry);
      functionResponses.push({ functionResponse: { name, ...(call.id ? { id: call.id } : {}), response: { result } } });
    }
    contents.push({ role: 'user', parts: functionResponses });
  }

  return makeResult('The connected API action completed and its response was verified.');
}

async function runConnectorToolProvider({ provider, key, keyIndex, prompt, contextMessages, model, options, declarations }) {
  const tools = declarations.map(declaration => toOpenAiFunctionTool(declaration));
  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages, isComplexPrompt(prompt, options)),
    { role: 'user', content: prompt }
  ];
  let totalTokens = 0;
  let reconnectProvider = '';
  let resolvedProvider = provider;
  let resolvedModel = model;
  const toolResults = [];
  const executedCalls = new Map();
  const completedResult = () => ({
    text: `Connector results:\n${toolResults.map(({ name, result }) => `${name}: ${result?.error || JSON.stringify(result)}`).join('\n')}`,
    model: resolvedModel,
    provider: resolvedProvider,
    tokenUsage: { totalTokens },
    connectorData: toolResults,
    connectorBadge: connectorBadgeForResults(toolResults),
    ...(toolResults.length ? { connectorProvider: getGoogleConnectorFunctionProvider(toolResults[0].name) } : {}),
    ...(reconnectProvider ? { needsReconnect: true, connectorProvider: reconnectProvider } : {})
  });

  for (let round = 0; round < 4; round += 1) {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    let completion;
    try {
      completion = await requestConnectorModel({ messages, tools, modelPreference: options.model, model }, options.currentUser, options.signal);
      if (!completion) throw new Error('The server connector model route is unavailable.');
    } catch (error) {
      if (toolResults.length) return completedResult();
      throw error;
    }
    resolvedProvider = completion.provider || resolvedProvider;
    resolvedModel = completion.model || resolvedModel;
    totalTokens += Number(completion.tokenUsage?.totalTokens || 0);
    const assistantMessage = completion.assistantMessage;
    if (!assistantMessage) {
      if (toolResults.length) return completedResult();
      throw new Error('The connector model returned an empty response.');
    }
    const calls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (!calls.length) {
      const text = typeof assistantMessage.content === 'string'
        ? assistantMessage.content.trim()
        : Array.isArray(assistantMessage.content) ? assistantMessage.content.map(part => part.text || '').join('').trim() : '';
      if (!text) {
        if (toolResults.length) return completedResult();
        throw new Error('The connector model returned no text after connector execution.');
      }
      const requiredProvider = requestedConnectorProvider(prompt, declarations);
      if (!toolResults.length && requiredProvider && !asksForClarification(text)) {
        throw new Error(`${provider} did not issue the required connector function call.`);
      }
      options.onProvider?.({ provider: resolvedProvider, model: resolvedModel });
      if (options.onToken) options.onToken(text);
      return {
        text,
        model: resolvedModel,
        provider: resolvedProvider,
        tokenUsage: { totalTokens },
        connectorData: toolResults,
        ...(reconnectProvider ? { needsReconnect: true, connectorProvider: reconnectProvider } : {})
      };
    }

    const normalizedCalls = calls.map(call => {
      const name = call.function?.name || '';
      if (!declarations.some(declaration => declaration.name === name)) {
        throw new Error(`The connector model requested an undeclared function: ${name || '(empty name)'}.`);
      }
      return { call, name, args: normalizeGoogleConnectorArguments(call.function?.arguments, name) };
    });
    messages.push(assistantMessage);
    for (const { call, name, args } of normalizedCalls) {
      const signature = `${name}:${JSON.stringify(args)}`;
      let result = executedCalls.get(signature);
      if (!executedCalls.has(signature)) {
        try {
          options.onProgress?.({ label: `Executing ${name.replaceAll('_', ' ')}`, status: 'running' });
          result = await executeGoogleConnectorFunction(name, args, { onProgress: options.onProgress });
          verifyConnectorToolResult(name, result, args);
        }
        catch (error) {
          if (isGoogleReconnectError(error)) {
            reconnectProvider = getGoogleConnectorFunctionProvider(name);
          }
          const message = error.message || 'The Google connector request failed.';
          const failedResult = { name, result: { status: 'error', message, error: message } };
          toolResults.push(failedResult);
          return connectorFailureResult({ name, error, model: resolvedModel, provider: resolvedProvider, totalTokens, toolResults });
        }
        executedCalls.set(signature, result);
      }
      toolResults.push({ name, result, executionVerified: true });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return completedResult();
}

async function tryGoogleConnectorToolWaterfall(prompt, contextMessages, model, options, errors) {
  const activeProviders = [...connectorManager.getActiveGoogleProviders()];
  if (/\b(?:computer|system|browser)\b/i.test(prompt) && /\b(?:scan|inspect|check)\b/i.test(prompt) && await checkExtensionConnected()) {
    activeProviders.push('computer');
  }
  const declarations = getGoogleConnectorFunctionDeclarations(activeProviders, prompt);
  if (!declarations.length) return null;
  const connectorOptions = {
    ...options,
    connectorProviders: activeProviders
  };
  const candidates = [{ provider: 'Universal Tool Adapter', key: '', keyIndex: 0, model }];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    try {
      const result = await runConnectorToolProvider({ ...candidate, prompt, contextMessages, options: connectorOptions, declarations });
      if (result?.connectorExecutionFailed) return result;
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      errors.push(`${candidate.provider} connector tools (key ${candidate.keyIndex + 1}): ${error.message}`);
      if (candidates[candidateIndex + 1]?.provider === candidate.provider) continue;
    }
  }
  return null;
}

/**
 * Groq Adapter
 */
const tryGroq = async (prompt, contextMessages, tier = 'pro', options = {}) => {
  if (!GROQ_KEY) throw new Error('No Groq key available');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.think;
  const model = tierConfig.groqModel;

  const messages = [
    { role: 'system', content: providerSystemPrompt(options) },
    ...buildHistory(contextMessages, isComplexPrompt(prompt, options)),
    { role: 'user', content: prompt }
  ];

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tier === 'think'
          ? { max_completion_tokens: options.flagship ? 16_384 : tierConfig.maxTokens, reasoning_effort: 'high', reasoning_format: 'hidden', temperature: 0.6 }
          : { max_tokens: options.coding || options.flagship ? 16_384 : tierConfig.maxTokens, temperature: 0.7 }),
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

// â”€â”€â”€ MASTER UNIFIED ROUTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function readDocxText(file) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack DOCX files. Save the document as PDF or plain text and attach that instead.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) throw new Error('This DOCX file is not a valid Word document.');

  const entryCount = view.getUint16(endRecord + 10, true);
  let cursor = view.getUint32(endRecord + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount && cursor + 46 <= bytes.length; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (entryName !== 'word/document.xml') continue;

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Could not read the main text in this DOCX file.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let xml;
    if (method === 0) xml = decoder.decode(compressed);
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      xml = await new Response(stream).text();
    } else throw new Error('This DOCX compression format is not supported.');

    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    if (documentXml.querySelector('parsererror')) throw new Error('Could not read the text in this DOCX file.');
    const paragraphs = Array.from(documentXml.getElementsByTagNameNS('*', 'p')).map(paragraph =>
      Array.from(paragraph.getElementsByTagNameNS('*', 't')).map(node => node.textContent || '').join('')
    ).filter(Boolean);
    if (!paragraphs.length) throw new Error('This DOCX file does not contain readable text.');
    return paragraphs.join('\n');
  }
  throw new Error('Could not find readable document text in this DOCX file.');
}

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
        attachments: arg1.attachments || [],
        computerAgent: Boolean(arg1.computerAgent),
        computerVision: Boolean(arg1.computerVision)
      };
    } else {
      prompt = String(arg1 || '');
      contextMessages = Array.isArray(arg2) ? arg2 : [];
      options = typeof arg3 === 'object' ? arg3 : {};
    }

    prompt = String(prompt || '').slice(-4_000); // Keep the current request to about 1,000 tokens.

    const requestedTier = normalizeModelPreference(options.model);
    const vision = (options.attachments || []).some(item => String(item.mimeType || '').startsWith('image/'));
    const coding = isCodingPrompt(prompt);
    const complex = isComplexPrompt(prompt);
    const flagship = requestedTier === 'think';
    const directGeminiModel = String(requestedTier).startsWith('gemini-');
    const geminiSelected = requestedTier === 'gemini';
    const intentGeminiModel = coding || complex || flagship ? GEMINI_PRO_MODEL_ID : GEMINI_FLASH_MODEL;
    const tier = vision
      ? directGeminiModel ? requestedTier : (geminiSelected ? 'gemini' : requestedTier === 'think' || requestedTier === 'pro' ? requestedTier : 'flash')
      : requestedTier === 'auto' ? (coding ? 'think' : complex ? 'pro' : 'flash') : requestedTier;
    const highTierCodeRequest = coding && (flagship || requestedTier === 'pro' || (directGeminiModel && /pro/i.test(requestedTier)));
    options = { ...options, coding, flagship: highTierCodeRequest, tier, preferBestKey: flagship || highTierCodeRequest, streamState: options.streamState || { sent: false } };
    const errors = [];
    let webCitations = [];
    // MODULE 7: Web search injection for grounding
    if (options.webSearch && prompt) {
      try {
        const { results, context } = await webSearch(prompt);
        if (context) {
          options = { ...options, _searchContext: context };
          webCitations = results;
        }
      } catch (searchErr) { console.warn('[Chat] Web search failed:', searchErr.message); }
    }
    const messages = [...buildHistory(contextMessages), { role: 'user', content: prompt }];
    const geminiModel = options.computerAgent && options.computerVision
      ? GEMINI_FLASH_MODEL
      : directGeminiModel ? requestedTier : geminiSelected ? intentGeminiModel : flagship ? MODEL_TIERS.think.geminiModel : (MODEL_TIERS[tier]?.geminiModel || MODEL_TIERS.flash.geminiModel);

    await ensureGenerationAllowance('chat', options.currentUser, {
      modelPreference: requestedTier,
      messages,
      coding,
      skipTokenLimit: highTierCodeRequest
    });

    await connectorManager.restoreSession();
    const activeConnectorProviders = connectorManager.getActiveGoogleProviders();
    const requestedProvider = requestedConnectorProvider(prompt, ['gmail', 'calendar', 'sheets', 'forms', 'drive', 'computer']);
    if (requestedProvider === 'workspace') {
      const requiredProviders = ['drive', 'sheets', 'gmail'];
      const missingProviders = requiredProviders.filter(provider => !activeConnectorProviders.includes(provider));
      if (missingProviders.length) {
        const labels = { drive: 'Google Drive', sheets: 'Google Sheets', gmail: 'Gmail' };
        return await syncUsage({
          text: `Connect ${missingProviders.map(provider => labels[provider]).join(', ')} to run the folder, spreadsheet, and sent-email workflow.`,
          status: 'error', error: { status: 'error', message: `Missing active connectors: ${missingProviders.join(', ')}.` },
          model: 'Native API Connectors', provider: 'Google Workspace Dispatcher',
          connectorProvider: 'workspace', connectorExecutionFailed: true, connectorData: []
        }, 'chat', options.currentUser);
      }
    }
    if (requestedProvider && ['gmail', 'calendar', 'sheets', 'forms', 'drive'].includes(requestedProvider) && !activeConnectorProviders.includes(requestedProvider)) {
      const message = ['gmail', 'calendar'].includes(requestedProvider)
        ? 'OAuth Permission Required: Please re-connect your Gmail/Calendar account.'
        : 'OAuth Permission Required: Please re-connect your Google account.';
      return await syncUsage({
        text: message,
        status: 'error', error: { status: 'error', message },
        model: 'Zulora AI', provider: 'Native API Connectors', needsReconnect: true,
        connectorProvider: requestedProvider, connectorExecutionFailed: true, connectorData: []
      }, 'chat', options.currentUser);
    }
    if (requestedProvider === 'computer' && !await checkExtensionConnected()) {
      const message = 'Computer scan not completed: install and connect the Zulora Computer Plugin to run a live scan.';
      return await syncUsage({
        text: message,
        status: 'error', error: { status: 'error', message },
        model: 'Computer Plugin', provider: 'Computer Agent Plugin',
        connectorProvider: 'Computer Plugin', connectorExecutionFailed: true, connectorData: []
      }, 'chat', options.currentUser);
    }

    if (requestedProvider && (activeConnectorProviders.includes(requestedProvider) || requestedProvider === 'computer' || requestedProvider === 'workspace')) {
      try {
        const connectorResult = await tryGoogleConnectorToolWaterfall(prompt, contextMessages, geminiModel, options, errors);
        if (connectorResult?.text) return await syncUsage(connectorResult, 'chat', options.currentUser);
        if (requestedProvider) {
          const serviceName = requestedProvider === 'computer' ? 'Computer Plugin' : requestedProvider === 'workspace' ? 'Google Workspace workflow' : requestedProvider === 'calendar' ? 'Google Calendar' : requestedProvider === 'sheets' ? 'Google Sheets' : 'Gmail';
          const message = `${serviceName} could not execute the requested action. No successful API or agent response was received.`;
          return await syncUsage({
            text: message,
            status: 'error', error: { status: 'error', message },
            model: geminiModel, provider: 'Native API Connectors',
            connectorProvider: requestedProvider, connectorExecutionFailed: true, connectorData: []
          }, 'chat', options.currentUser);
        }
      } catch (error) {
        if (options.signal?.aborted || isQuotaAuthorityError(error)) throw error;
        if (requestedProvider) {
          const message = requestedProvider === 'computer'
            ? `Computer scan not completed: ${error.message}`
            : isGoogleReconnectError(error)
              ? 'OAuth Permission Required: Please re-connect the requested Google service.'
              : `${requestedProvider === 'workspace' ? 'Google Workspace workflow' : requestedProvider} could not complete the requested action: ${error.message}`;
          return await syncUsage({
            text: message,
            status: 'error', error: { status: 'error', message: error.message || message },
            model: geminiModel, provider: 'Native API Connectors',
            connectorProvider: requestedProvider,
            needsReconnect: requestedProvider !== 'computer' && isGoogleReconnectError(error),
            connectorExecutionFailed: true, connectorData: []
          }, 'chat', options.currentUser);
        }
        errors.push(`Google connector tool execution: ${error.message}`);
      }
    }

    let emittedStreamTokens = false;
    if (!options.computerAgent) {
      try {
        const chatPayload = {
          messages,
          contextMemory: options.contextMemory,
          aiBrain: options.aiBrain || null,
          userVault: options.userVault || null,
          activeConnectorProviders,
          studioMode: Boolean(options.studioMode),
          modelPreference: requestedTier,
          enableWebSearch: Boolean(options.webSearch),
          searchResults: webCitations,
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
          }, route => options.onProvider?.(route), options.signal, Boolean(options.guestMode && !options.currentUser?.uid))
          : await requestGeneration('chat', chatPayload, options.currentUser, '/api/ai', options.signal);
        if (serverResult?.text) return await syncUsage(serverResult, 'chat', options.currentUser);
        if (options.guestMode && !options.currentUser?.uid && !import.meta.env.DEV) {
          throw new GenerationApiError('The demo service is temporarily unavailable. Please retry in a moment.', 503);
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (isQuotaAuthorityError(error) || (options.guestMode && !import.meta.env.DEV)) throw error;
        if (options.onToken && emittedStreamTokens) {
          options.onReset?.();
          emittedStreamTokens = false;
        }
        if (options.onToken && error instanceof GenerationApiError && (error.status === 401 || error.status === 403)) throw error;
        console.warn('[Chat] Server generation route unavailable:', error.message);
      }
    }
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    console.error('[Zulora Server Router Unavailable]', errors);
    throw new GenerationApiError('The response could not be completed. Please try again.', 503);
  },

  // â”€â”€â”€ IMAGE STUDIO GENERATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    prompt = String(prompt || '').trim();
    if (!prompt) throw new Error('Please provide a prompt to generate an image.');

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
        style: options.style || '',
        negativePrompt: options.negativePrompt || '',
        aspectRatio,
        imageEngine,
        seed: options.seed,
        width,
        height,
        sourceImage: options.sourceImage || '',
        operation: options.operation || (options.sourceImage ? 'edit' : 'generate')
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

    const requestedSeed = Number(options.seed);
    const seed = Number.isInteger(requestedSeed) && requestedSeed >= 0
      ? requestedSeed
      : Math.floor(Math.random() * 1_000_000);
    // Keep each generation call isolated to the current Image Studio prompt.
    const cleanPrompt = String(prompt).trim();
    const styledPrompt = buildImagePrompt(cleanPrompt, options.style, options.negativePrompt) || cleanPrompt;
    const encoded = encodeURIComponent(styledPrompt);

    const referenceImage = options.sourceImage || (options.sourceImageBase64
      ? `data:${options.sourceImageMimeType || 'image/png'};base64,${options.sourceImageBase64}`
      : '');
    if (referenceImage) {
      if (HF_IMAGE_KEY) {
        const model = 'black-forest-labs/FLUX.1-Kontext-dev';
        try {
          const imageUrl = await browserHuggingFaceImage(styledPrompt, model, referenceImage);
          return await syncUsage({
            url: imageUrl, imageUrl, provider: 'Hugging Face Image-to-Image API', model,
            prompt: prompt.trim(), enhancedPrompt: styledPrompt, seed
          }, 'image', currentUser);
        } catch (error) {
          console.warn('[Image] Hugging Face reference edit failed; falling back to text-prompt synthesis:', error.message);
        }
      }
    }

    if (!referenceImage && HF_IMAGE_KEY && imageEngine !== 'hf-flux-dev' && imageEngine !== 'hf-sdxl') {
      try {
        const model = 'black-forest-labs/FLUX.1-schnell';
        const imageUrl = await browserHuggingFaceImage(styledPrompt, model);
        return await syncUsage({
          url: imageUrl, imageUrl, provider: 'Hugging Face Inference API', model,
          prompt: prompt.trim(), enhancedPrompt: styledPrompt, seed
        }, 'image', currentUser);
      } catch (error) {
        console.warn('[Image] Hugging Face primary failed; switching to Pollinations:', error.message);
      }
    }

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

    // â”€â”€ Engine 1: Pollinations FLUX â”€â”€
    try {
      const selectedPollinationsModel = imageEngine === 'pollinations-hd' ? 'flux-hd' : 'flux';
      const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(styledPrompt)}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&nologo=true&model=${selectedPollinationsModel}`;
      const fluxRes = await fetchWithTimeout(fluxUrl, {}, 18000);
      const fluxType = fluxRes.headers.get('content-type') || '';
      const fluxBlob = fluxType.startsWith('image/') ? await fluxRes.blob() : null;
      if (!fluxRes.ok || !fluxBlob || fluxBlob.size < 2000) throw new Error('Pollinations returned an empty image.');
      return await syncUsage({
        url: fluxUrl,
        imageUrl: fluxUrl,
        provider: referenceImage ? 'Pollinations prompt-only edit fallback' : 'Pollinations FLUX',
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

    // â”€â”€ Engine 2: Fal AI FLUX Schnell â”€â”€
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

    // â”€â”€ Engine 4: Cloudflare Workers AI FLUX â”€â”€
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

    // â”€â”€ Final Deterministic High-Definition Fallback â”€â”€
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

    // â”€â”€ Resilient Pollinations Failover (Guaranteed image generation) â”€â”€
    const fallbackPollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&nologo=true&model=flux`;
    return await syncUsage({
      url: fallbackPollinationsUrl,
      imageUrl: fallbackPollinationsUrl,
      provider: referenceImage ? 'Pollinations prompt-only edit fallback' : 'Pollinations AI',
      model: 'FLUX.1-Schnell',
      prompt: prompt.trim(),
      enhancedPrompt: styledPrompt,
      seed
    }, 'image', currentUser);
  },

  // â”€â”€â”€ VIDEO STUDIO GENERATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Flexible generateVideo supporting both:
   * 1. generateVideo(prompt, options)
   * 2. generateVideo({ prompt, motionSpeed, cameraAngle, duration })
   */
  async generateVideo(arg1, arg2 = {}) {
    return generateVideoWithProviders(arg1, arg2);
  },

  // â”€â”€â”€ MULTIMODAL FILE READER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async readFileContent(file) {
    if (!file) return '';
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 8 MB.`);
    }

    const mimeType = String(file.type || '').toLowerCase();
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (extension === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return readDocxText(file);
    }
    if (extension === 'doc' || mimeType === 'application/msword') {
      throw new Error('Legacy .doc files cannot be reliably extracted in the browser. Save this document as PDF or DOCX and attach it again.');
    }

    const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];
    const isText = textTypes.some((type) => mimeType.startsWith(type)) ||
      /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|cpp|c|cs|go|rs|php|rb|sh|yaml|yml|html|css|sql|xml)$/i.test(file.name);

    if (isText) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed reading text file'));
        reader.readAsText(file);
      });
    }

    if (mimeType.startsWith('image/')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(`[Attached image: ${file.name}]\n${e.target.result}`);
        reader.onerror = () => reject(new Error('Failed reading image file'));
        reader.readAsDataURL(file);
      });
    }

    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return `[Attached PDF: ${file.name} (${(file.size / 1024).toFixed(0)} KB). You may ask questions regarding its structure or contents.]`;
    }

    return `[Attached file: ${file.name} (${(file.size / 1024).toFixed(0)} KB)]`;
  }
};

export default apiRouter;

