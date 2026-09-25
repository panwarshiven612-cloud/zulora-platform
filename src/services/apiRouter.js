/**
 * ZULORA AI — Client-Side API Waterfall Router
 * =============================================
 * All keys are read from import.meta.env (VITE_* vars in .env)
 * Provider waterfall: Gemini → Groq → Cerebras → OpenRouter → Mistral → Pollinations (fallback)
 *
 * MODEL TIERS:
 *   flash   → Zulora Flash 3.0   (fast, lightweight)
 *   pro     → Zulora Pro 3.1     (balanced + accurate)
 *   think   → Zulora High Thinking 3.5 Pro (deep reasoning)
 *
 * Founded & Created by Shiven Panwar — Zulora AI
 */

// ─── Key Pool Resolution ─────────────────────────────────────────────────────
const e = import.meta.env;

const GEMINI_KEYS = [
  e.VITE_GEMINI_KEY_1, e.VITE_GEMINI_KEY_2, e.VITE_GEMINI_KEY_3,
  e.VITE_GEMINI_KEY_4, e.VITE_GEMINI_KEY_5, e.VITE_GEMINI_KEY_6,
  e.VITE_GEMINI_KEY_7,
].filter(Boolean);

const GROQ_KEY          = e.VITE_GROQ_KEY        || '';
const CEREBRAS_KEY      = e.VITE_CEREBRAS_KEY    || '';
const OPENROUTER_KEYS   = [e.VITE_OPENROUTER_KEY_1, e.VITE_OPENROUTER_KEY_2].filter(Boolean);
const MISTRAL_KEY       = e.VITE_MISTRAL_KEY     || '';
const POLLINATIONS_KEY  = e.VITE_POLLINATIONS_KEY || '';
const HUGGINGFACE_KEY   = e.VITE_HUGGINGFACE_KEY || '';
const FAL_KEY           = e.VITE_FAL_KEY         || '';
const CLOUDFLARE_ACCT   = e.VITE_CLOUDFLARE_ACCOUNT_ID  || '';
const CLOUDFLARE_TOKEN  = e.VITE_CLOUDFLARE_API_TOKEN   || '';
const REPLICATE_KEY     = e.VITE_REPLICATE_KEY   || '';

// Round-robin index for Gemini key rotation
let geminiIdx = 0;
const nextGeminiKey = () => {
  if (!GEMINI_KEYS.length) return '';
  const key = GEMINI_KEYS[geminiIdx % GEMINI_KEYS.length];
  geminiIdx++;
  return key;
};

// ─── MODEL TIER CONFIG ────────────────────────────────────────────────────────
export const MODEL_TIERS = {
  flash: {
    id: 'flash',
    label: 'Zulora Flash 3.0',
    shortLabel: 'Flash',
    description: 'Ultra-fast lightweight responses',
    badge: '⚡',
    color: 'text-sky-500',
    geminiModel: 'gemini-2.0-flash-lite',
    groqModel: 'llama-3.1-8b-instant',
    cerebrasModel: 'llama3.1-8b',
    openrouterModel: 'meta-llama/llama-3.1-8b-instruct:free',
    mistralModel: 'mistral-7b-instruct',
    maxTokens: 1024,
    tier: 'free',
  },
  pro: {
    id: 'pro',
    label: 'Zulora Pro 3.1',
    shortLabel: 'Pro',
    description: 'Balanced performance & accuracy',
    badge: '🚀',
    color: 'text-violet-500',
    geminiModel: 'gemini-2.5-flash',
    groqModel: 'llama-3.3-70b-versatile',
    cerebrasModel: 'llama-3.3-70b',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
    mistralModel: 'mistral-medium',
    maxTokens: 4096,
    tier: 'free',
  },
  think: {
    id: 'think',
    label: 'Zulora High Thinking 3.5 Pro',
    shortLabel: 'Thinking',
    description: 'Extended reasoning & complex analysis',
    badge: '🧠',
    color: 'text-amber-500',
    geminiModel: 'gemini-2.5-pro',
    groqModel: 'deepseek-r1-distill-llama-70b',
    cerebrasModel: 'qwq-32b',
    openrouterModel: 'deepseek/deepseek-r1:free',
    mistralModel: 'mistral-large-latest',
    maxTokens: 8192,
    tier: 'pro',
  },
};

// ─── Timeout Fetch Helper ────────────────────────────────────────────────────
const fetchWithTimeout = async (url, options, timeoutMs = 12000) => {
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

// ─── Build conversation history array ────────────────────────────────────────
const buildHistory = (contextMessages = []) =>
  contextMessages.slice(-16).map(m => ({ role: m.role, content: m.content }));

// ─── PROVIDER IMPLEMENTATIONS ─────────────────────────────────────────────────

/**
 * Google Gemini via OpenAI-compat endpoint (generativelanguage.googleapis.com)
 * Uses round-robin across 7 keys
 */
const tryGemini = async (prompt, contextMessages, tier = 'pro') => {
  const key = nextGeminiKey();
  if (!key) throw new Error('No Gemini keys configured');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.geminiModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, a helpful and knowledgeable assistant created by Shiven Panwar. Respond with detailed, well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: tierConfig.maxTokens, temperature: 0.7 }),
    },
    15000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${model}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Gemini returned empty response');
  return { text, model: `Gemini ${model.replace('gemini-', '').replace('-', ' ')}`, provider: 'gemini' };
};

/**
 * Groq — ultra-fast inference
 */
const tryGroq = async (prompt, contextMessages, tier = 'pro') => {
  if (!GROQ_KEY) throw new Error('No Groq key configured');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.groqModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, a helpful and knowledgeable assistant. Respond with detailed, well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model, messages, max_tokens: tierConfig.maxTokens, temperature: 0.7 }),
    },
    12000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq ${model}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');
  return { text, model: `Groq ${model.split('-')[0]}`, provider: 'groq' };
};

/**
 * Cerebras — fast inference for large models
 */
const tryCerebras = async (prompt, contextMessages, tier = 'pro') => {
  if (!CEREBRAS_KEY) throw new Error('No Cerebras key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.cerebrasModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, a helpful assistant. Respond with well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  const res = await fetchWithTimeout(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CEREBRAS_KEY}` },
      body: JSON.stringify({ model, messages, max_tokens: tierConfig.maxTokens, temperature: 0.7 }),
    },
    12000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Cerebras: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Cerebras returned empty response');
  return { text, model: `Cerebras ${model}`, provider: 'cerebras' };
};

/**
 * OpenRouter — routes to many models
 */
const tryOpenRouter = async (prompt, contextMessages, tier = 'pro', keyIndex = 0) => {
  const key = OPENROUTER_KEYS[keyIndex];
  if (!key) throw new Error('No OpenRouter key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.openrouterModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, an advanced AI assistant. Respond with well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  const res = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://zulora-al.firebaseapp.com',
        'X-Title': 'Zulora AI',
      },
      body: JSON.stringify({ model, messages, max_tokens: tierConfig.maxTokens }),
    },
    15000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned empty response');
  return { text, model: `OpenRouter ${model.split('/').pop().split(':')[0]}`, provider: 'openrouter' };
};

/**
 * Mistral — European AI provider
 */
const tryMistral = async (prompt, contextMessages, tier = 'pro') => {
  if (!MISTRAL_KEY) throw new Error('No Mistral key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.mistralModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, a helpful AI assistant. Respond with well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  const res = await fetchWithTimeout(
    'https://api.mistral.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({ model, messages, max_tokens: tierConfig.maxTokens, temperature: 0.7 }),
    },
    15000
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Mistral: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Mistral returned empty response');
  return { text, model: `Mistral ${model}`, provider: 'mistral' };
};

/**
 * Pollinations (Free fallback text generation)
 */
const tryPollinationsText = async (prompt) => {
  const encoded = encodeURIComponent(prompt.slice(0, 600));
  const url = `https://text.pollinations.ai/${encoded}?model=mistral&seed=${Date.now() % 9999}`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error('Pollinations text fallback failed');
  const text = await res.text();
  if (!text || text.length < 5) throw new Error('Pollinations returned empty text');
  return { text, model: 'Pollinations (Fallback)', provider: 'pollinations' };
};

// ─── MAIN CHAT WATERFALL ─────────────────────────────────────────────────────
export const apiRouter = {
  /**
   * Generate a chat response with full waterfall failover.
   * @param {string} prompt
   * @param {Array}  contextMessages
   * @param {Object} options — { model: 'flash'|'pro'|'think', userId, webSearch }
   */
  async generateChat(prompt, contextMessages = [], options = {}) {
    const tier = options.model || 'pro';
    const errors = [];

    // ── Try all Gemini keys (round-robin, up to 3 attempts) ──
    for (let attempt = 0; attempt < Math.min(3, GEMINI_KEYS.length); attempt++) {
      try {
        return await tryGemini(prompt, contextMessages, tier);
      } catch (err) {
        errors.push(`Gemini[${attempt}]: ${err.message}`);
      }
    }

    // ── Groq ──
    try { return await tryGroq(prompt, contextMessages, tier); }
    catch (err) { errors.push(`Groq: ${err.message}`); }

    // ── Cerebras ──
    try { return await tryCerebras(prompt, contextMessages, tier); }
    catch (err) { errors.push(`Cerebras: ${err.message}`); }

    // ── OpenRouter key 1 ──
    try { return await tryOpenRouter(prompt, contextMessages, tier, 0); }
    catch (err) { errors.push(`OpenRouter[0]: ${err.message}`); }

    // ── OpenRouter key 2 ──
    try { return await tryOpenRouter(prompt, contextMessages, tier, 1); }
    catch (err) { errors.push(`OpenRouter[1]: ${err.message}`); }

    // ── Mistral ──
    try { return await tryMistral(prompt, contextMessages, tier); }
    catch (err) { errors.push(`Mistral: ${err.message}`); }

    // ── Pollinations text fallback ──
    try { return await tryPollinationsText(prompt); }
    catch (err) { errors.push(`Pollinations: ${err.message}`); }

    // ── All providers failed ──
    console.error('[apiRouter] All providers failed:', errors);
    throw new Error('All AI providers are temporarily unavailable. Please check your connection and try again.');
  },

  // ─── IMAGE GENERATION ────────────────────────────────────────────────────
  /**
   * Generate an image via Pollinations FLUX → HuggingFace → Cloudflare fallback
   * @param {string} prompt
   * @param {Object} options — { width, height, style, steps }
   */
  async generateImage(prompt, options = {}) {
    const { width = 1024, height = 1024, style = 'photorealistic', steps = 30 } = options;
    const seed = Math.floor(Math.random() * 999999);
    const styledPrompt = `${style}, ${prompt}, ultra high quality, 8k resolution, professional photography, detailed`;

    // ── Pollinations FLUX (best quality free) ──
    try {
      const encoded = encodeURIComponent(styledPrompt);
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&model=flux&steps=${steps}&nologo=true`;
      const res = await fetchWithTimeout(url, {}, 30000);
      if (!res.ok) throw new Error(`Pollinations FLUX: ${res.status}`);
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error('Pollinations returned tiny image');
      return { imageUrl: URL.createObjectURL(blob), provider: 'Pollinations FLUX', prompt: styledPrompt, seed };
    } catch (err) {
      console.warn('[Image] Pollinations FLUX failed:', err.message);
    }

    // ── HuggingFace FLUX (fallback) ──
    if (HUGGINGFACE_KEY) {
      try {
        const res = await fetchWithTimeout(
          'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${HUGGINGFACE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: styledPrompt, parameters: { num_inference_steps: steps, width, height } }),
          },
          45000
        );
        if (!res.ok) throw new Error(`HF: ${res.status}`);
        const blob = await res.blob();
        if (blob.size < 1000) throw new Error('HuggingFace returned tiny image');
        return { imageUrl: URL.createObjectURL(blob), provider: 'HuggingFace FLUX', prompt: styledPrompt, seed };
      } catch (err) {
        console.warn('[Image] HuggingFace failed:', err.message);
      }
    }

    // ── Cloudflare AI (fallback) ──
    if (CLOUDFLARE_ACCT && CLOUDFLARE_TOKEN) {
      try {
        const res = await fetchWithTimeout(
          `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCT}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CLOUDFLARE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: styledPrompt, num_steps: steps }),
          },
          30000
        );
        if (!res.ok) throw new Error(`Cloudflare AI: ${res.status}`);
        const data = await res.json();
        if (data.result?.image) {
          return { imageUrl: `data:image/png;base64,${data.result.image}`, provider: 'Cloudflare AI', prompt: styledPrompt, seed };
        }
        throw new Error('Cloudflare returned no image');
      } catch (err) {
        console.warn('[Image] Cloudflare failed:', err.message);
      }
    }

    // ── Ultimate fallback — deterministic picsum ──
    const fallbackUrl = `https://picsum.photos/seed/${seed}/${width}/${height}`;
    return { imageUrl: fallbackUrl, provider: 'Placeholder', prompt: styledPrompt, seed };
  },

  // ─── VIDEO GENERATION ────────────────────────────────────────────────────
  /**
   * Generate a video — uses Replicate stable-video-diffusion → sample fallback
   */
  async generateVideo(prompt, options = {}) {
    const { duration = 4, style = 'cinematic' } = options;
    const styledPrompt = `${style}, ${prompt}, high quality, smooth motion, professional cinematography`;

    // ── Replicate stable-video-diffusion ──
    if (REPLICATE_KEY) {
      try {
        // Step 1: Start prediction
        const startRes = await fetchWithTimeout(
          'https://api.replicate.com/v1/predictions',
          {
            method: 'POST',
            headers: { 'Authorization': `Token ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              version: 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
              input: { video_length: duration * 6, sizing_strategy: 'maintain_aspect_ratio', frames_per_second: 6 },
            }),
          },
          10000
        );
        if (!startRes.ok) throw new Error(`Replicate start: ${startRes.status}`);
        const prediction = await startRes.json();

        // Step 2: Poll for result (up to 60s)
        const pollStart = Date.now();
        while (Date.now() - pollStart < 60000) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetchWithTimeout(
            `https://api.replicate.com/v1/predictions/${prediction.id}`,
            { headers: { 'Authorization': `Token ${REPLICATE_KEY}` } },
            8000
          );
          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();
          if (pollData.status === 'succeeded' && pollData.output) {
            const videoUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
            return { videoUrl, provider: 'Replicate SVD', prompt: styledPrompt };
          }
          if (pollData.status === 'failed') throw new Error('Replicate prediction failed');
        }
        throw new Error('Replicate timed out');
      } catch (err) {
        console.warn('[Video] Replicate failed:', err.message);
      }
    }

    // ── Sample video fallback (always works) ──
    const sampleVideos = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    ];
    const videoUrl = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];
    return { videoUrl, provider: 'Sample (Demo)', prompt: styledPrompt, isDemo: true };
  },

  // ─── FILE READING (multimodal) ────────────────────────────────────────────
  /**
   * Read file content and include it in a chat message.
   * Supports text, PDF, images (via Gemini vision).
   * @param {File} file
   * @returns {string} extracted text content
   */
  async readFileContent(file) {
    if (!file) return '';
    const maxBytes = 5 * 1024 * 1024; // 5 MB limit

    if (file.size > maxBytes) {
      throw new Error(`File too large (max 5 MB). Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
    }

    // Text-based files — read directly
    const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];
    const isTextFile = textTypes.some(t => file.type.startsWith(t)) ||
      /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|cpp|c|cs|go|rs|php|rb|sh|yaml|yml|html|css|sql|xml)$/i.test(file.name);

    if (isTextFile) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsText(file);
      });
    }

    // Image files — return as base64 data URL for visual context
    if (file.type.startsWith('image/')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(`[Image file: ${file.name}]\n${e.target.result}`);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
    }

    // PDF — return placeholder (full PDF parsing requires a library)
    if (file.type === 'application/pdf') {
      return `[PDF file attached: ${file.name} (${(file.size / 1024).toFixed(0)} KB). Please describe what you need from this document.]`;
    }

    return `[File attached: ${file.name} (${file.type || 'unknown type'}, ${(file.size / 1024).toFixed(0)} KB)]`;
  },
};

export default apiRouter;

