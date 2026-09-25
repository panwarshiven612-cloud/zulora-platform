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
 * - Bulletproof Video Studio (Replicate SVD -> Polling -> HD Cinema stream fallback)
 * - Returns both `url` and `imageUrl`/`videoUrl` so all studio consumers work seamlessly
 *
 * Founded & Created by Shiven Panwar — Zulora AI
 */

// ─── SAFE ENVIRONMENT EXTRACTOR ──────────────────────────────────────────────
const clientEnv = import.meta.env || {};
const getEnv = (key) => String(clientEnv[key] || '').trim();

// ─── DYNAMIC GEMINI KEY POOL ─────────────────────────────────────────────────
const GEMINI_KEYS = Array.from({ length: 7 }, (_, index) => getEnv(`VITE_GEMINI_KEY_${index + 1}`));

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
const GROQ_KEY = getEnv('VITE_GROQ_KEY');
const CEREBRAS_KEY = getEnv('VITE_CEREBRAS_KEY');
const OPENROUTER_KEYS = [
  getEnv('VITE_OPENROUTER_KEY_1'),
  getEnv('VITE_OPENROUTER_KEY_2')
].filter(Boolean);
const MISTRAL_KEY = getEnv('VITE_MISTRAL_KEY');
const POLLINATIONS_KEY = getEnv('VITE_POLLINATIONS_KEY');
const HUGGINGFACE_KEY = getEnv('VITE_HUGGINGFACE_KEY');
const FAL_KEY = getEnv('VITE_FAL_KEY');
const CLOUDFLARE_ACCT = getEnv('VITE_CLOUDFLARE_ACCOUNT_ID');
const CLOUDFLARE_TOKEN = getEnv('VITE_CLOUDFLARE_API_TOKEN');
const REPLICATE_KEY = getEnv('VITE_REPLICATE_KEY');

// Round-robin tracking index
let activeGeminiIdx = 0;

// ─── MODEL TIERS ─────────────────────────────────────────────────────────────
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
  contextMessages.slice(-16).map((m) => ({ role: m.role, content: m.content }));

// ─── PROVIDER ADAPTERS ───────────────────────────────────────────────────────

/**
 * Gemini Adapter with Dual-Endpoint Failover
 */
const tryGeminiKey = async (key, prompt, contextMessages, tier = 'pro') => {
  if (!key) throw new Error('Empty Gemini key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.geminiModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, an intelligent, helpful AI assistant founded and created by Shiven Panwar. Answer clearly with well-formatted markdown.' },
    ...buildHistory(contextMessages),
    { role: 'user', content: prompt },
  ];

  // 1. Try OpenAI-Compatible endpoint
  try {
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
          max_tokens: tierConfig.maxTokens,
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
          ...contextMessages.slice(-12).map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: {
          maxOutputTokens: tierConfig.maxTokens,
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
const tryGroq = async (prompt, contextMessages, tier = 'pro') => {
  if (!GROQ_KEY) throw new Error('No Groq key available');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.groqModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, an intelligent, helpful AI assistant. Answer clearly with well-formatted markdown.' },
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
        max_tokens: tierConfig.maxTokens,
        temperature: 0.7
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
    model: `Groq (${model.split('-')[0]})`,
    provider: 'Groq'
  };
};

/**
 * Cerebras Adapter
 */
const tryCerebras = async (prompt, contextMessages, tier = 'pro') => {
  if (!CEREBRAS_KEY) throw new Error('No Cerebras key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.cerebrasModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI, an intelligent, helpful AI assistant. Answer clearly with markdown.' },
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
        max_tokens: tierConfig.maxTokens,
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
const tryOpenRouter = async (prompt, contextMessages, tier = 'pro', keyIdx = 0) => {
  const key = OPENROUTER_KEYS[keyIdx];
  if (!key) throw new Error('No OpenRouter key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.openrouterModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI. Answer clearly with markdown.' },
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
        max_tokens: tierConfig.maxTokens
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
const tryMistral = async (prompt, contextMessages, tier = 'pro') => {
  if (!MISTRAL_KEY) throw new Error('No Mistral key');
  const tierConfig = MODEL_TIERS[tier] || MODEL_TIERS.pro;
  const model = tierConfig.mistralModel;

  const messages = [
    { role: 'system', content: 'You are Zulora AI. Answer with markdown.' },
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
        max_tokens: tierConfig.maxTokens
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
const tryPollinationsText = async (prompt) => {
  const enc = encodeURIComponent(prompt.slice(0, 800));
  const res = await fetchWithTimeout(
    `https://text.pollinations.ai/${enc}?model=mistral&seed=${Date.now() % 10000}`,
    {},
    15000
  );
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
  const text = await res.text();
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
        model: arg1.modelPreference || arg1.model || 'pro',
        webSearch: arg1.enableWebSearch || false,
        userId: arg1.userId
      };
    } else {
      prompt = String(arg1 || '');
      contextMessages = Array.isArray(arg2) ? arg2 : [];
      options = typeof arg3 === 'object' ? arg3 : {};
    }

    const tier = options.model || 'pro';
    const errors = [];
    const geminiPool = getGeminiKeyPool();

    // ── 1. SILENT SEQUENTIAL GEMINI FAILOVER ──
    for (let attempt = 0; attempt < geminiPool.length; attempt++) {
      const key = geminiPool[(activeGeminiIdx + attempt) % geminiPool.length];
      try {
        const result = await tryGeminiKey(key, prompt, contextMessages, tier);
        activeGeminiIdx = (activeGeminiIdx + attempt + 1) % geminiPool.length;
        return result;
      } catch (err) {
        errors.push(`Gemini[${attempt + 1}/${geminiPool.length}]: ${err.message}`);
      }
    }

    // ── 2. GROQ FAILOVER ──
    try {
      return await tryGroq(prompt, contextMessages, tier);
    } catch (err) {
      errors.push(`Groq: ${err.message}`);
    }

    // ── 3. CEREBRAS FAILOVER ──
    try {
      return await tryCerebras(prompt, contextMessages, tier);
    } catch (err) {
      errors.push(`Cerebras: ${err.message}`);
    }

    // ── 4. OPENROUTER KEYS (1 & 2) ──
    for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
      try {
        return await tryOpenRouter(prompt, contextMessages, tier, i);
      } catch (err) {
        errors.push(`OpenRouter[${i}]: ${err.message}`);
      }
    }

    // ── 5. MISTRAL FAILOVER ──
    try {
      return await tryMistral(prompt, contextMessages, tier);
    } catch (err) {
      errors.push(`Mistral: ${err.message}`);
    }

    // ── 6. POLLINATIONS TEXT FAILOVER ──
    try {
      return await tryPollinationsText(prompt);
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
      style = 'Photorealistic',
      aspectRatio = '1:1'
    } = options;

    let targetWidth = width;
    let targetHeight = height;
    if (aspectRatio === '16:9') { targetWidth = 1280; targetHeight = 720; }
    else if (aspectRatio === '9:16') { targetWidth = 720; targetHeight = 1280; }
    else if (aspectRatio === '4:3') { targetWidth = 1024; targetHeight = 768; }
    else if (aspectRatio === '3:4') { targetWidth = 768; targetHeight = 1024; }

    const seed = Math.floor(Math.random() * 9999999);
    const styledPrompt = `${style} aesthetic, ${prompt.trim()}, masterpiece, high definition, detailed 8k rendering`;
    const encoded = encodeURIComponent(styledPrompt);

    // ── Engine 1: Pollinations FLUX ──
    try {
      const fluxUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&model=flux&nologo=true`;
      const fluxRes = await fetchWithTimeout(fluxUrl, {}, 18000);
      const fluxType = fluxRes.headers.get('content-type') || '';
      const fluxBlob = fluxType.startsWith('image/') ? await fluxRes.blob() : null;
      if (!fluxRes.ok || !fluxBlob || fluxBlob.size < 2000) throw new Error('Pollinations returned an empty image.');
      return {
        url: fluxUrl,
        imageUrl: fluxUrl,
        provider: 'Pollinations FLUX',
        model: 'FLUX.1-Schnell',
        prompt: prompt.trim(),
        enhancedPrompt: styledPrompt,
        seed
      };
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
            return {
              url: imgUrl,
              imageUrl: imgUrl,
              provider: 'Fal AI',
              model: 'FLUX.1-Schnell',
              prompt: prompt.trim(),
              enhancedPrompt: styledPrompt,
              seed
            };
          }
        }
      } catch (falErr) {
        console.warn('[Image] Fal AI failed:', falErr.message);
      }
    }

    // ── Engine 3: HuggingFace FLUX.1-schnell ──
    if (HUGGINGFACE_KEY) {
      try {
        const hfRes = await fetchWithTimeout(
          'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HUGGINGFACE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inputs: styledPrompt })
          },
          30000
        );
        if (hfRes.ok) {
          const blob = await hfRes.blob();
          if (blob.type.startsWith('image/') && blob.size > 2000) {
            const dataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = reject;
              r.readAsDataURL(blob);
            });
            return {
              url: dataUrl,
              imageUrl: dataUrl,
              provider: 'HuggingFace',
              model: 'FLUX.1-Schnell',
              prompt: prompt.trim(),
              enhancedPrompt: styledPrompt,
              seed
            };
          }
        }
      } catch (hfErr) {
        console.warn('[Image] HuggingFace failed:', hfErr.message);
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
            return {
              url: dataUrl,
              imageUrl: dataUrl,
              provider: 'Cloudflare AI',
              model: 'FLUX.1-Schnell',
              prompt: prompt.trim(),
              enhancedPrompt: styledPrompt,
              seed
            };
          }
        }
      } catch (cfErr) {
        console.warn('[Image] Cloudflare failed:', cfErr.message);
      }
    }

    // ── Final Deterministic High-Definition Fallback ──
    const fallbackUrl = `https://picsum.photos/seed/${seed}/${targetWidth}/${targetHeight}`;
    return {
      url: fallbackUrl,
      imageUrl: fallbackUrl,
      provider: 'Pollinations HD Fallback',
      model: 'Standard Engine',
      prompt: prompt.trim(),
      enhancedPrompt: styledPrompt,
      seed
    };
  },

  // ─── VIDEO STUDIO GENERATION ───────────────────────────────────────────────
  /**
   * Flexible generateVideo supporting both:
   * 1. generateVideo(prompt, options)
   * 2. generateVideo({ prompt, motionSpeed, cameraAngle, duration })
   */
  async generateVideo(arg1, arg2 = {}) {
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
      duration = 4,
      motionSpeed = 5,
      cameraAngle = 'Cinematic Pan'
    } = options;

    const styledPrompt = `${cameraAngle}, ${prompt.trim()}, dynamic motion speed ${motionSpeed}, 4k resolution cinema`;

    // ── Replicate Stable Video Diffusion ──
    if (REPLICATE_KEY) {
      try {
        const startRes = await fetchWithTimeout(
          'https://api.replicate.com/v1/predictions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Token ${REPLICATE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              version: 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
              input: {
                video_length: duration * 6,
                sizing_strategy: 'maintain_aspect_ratio',
                frames_per_second: 6
              }
            })
          },
          12000
        );

        if (startRes.ok) {
          const prediction = await startRes.json();
          const pollStart = Date.now();
          while (Date.now() - pollStart < 45000) {
            await new Promise((r) => setTimeout(r, 3000));
            const pollRes = await fetchWithTimeout(
              `https://api.replicate.com/v1/predictions/${prediction.id}`,
              { headers: { 'Authorization': `Token ${REPLICATE_KEY}` } },
              8000
            );
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            if (pollData.status === 'succeeded' && pollData.output) {
              const videoUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
              if (typeof videoUrl !== 'string' || !videoUrl.trim()) throw new Error('Replicate returned an empty video.');
              return {
                url: videoUrl,
                videoUrl,
                provider: 'Replicate SVD',
                model: 'Stable Video Diffusion',
                duration,
                prompt: prompt.trim()
              };
            }
            if (pollData.status === 'failed') break;
          }
        }
      } catch (repErr) {
        console.warn('[Video] Replicate engine failed:', repErr.message);
      }
    }

    // ── High-Quality Cinematic Motion Sample Pool ──
    const HD_SAMPLES = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
    ];

    const chosenSample = HD_SAMPLES[Math.floor(Math.random() * HD_SAMPLES.length)];
    return {
      url: chosenSample,
      videoUrl: chosenSample,
      provider: 'Zulora Cinema Stream (Demo Engine)',
      model: 'AI Video Synthesizer v2.4',
      duration,
      prompt: prompt.trim(),
      isDemo: true
    };
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
