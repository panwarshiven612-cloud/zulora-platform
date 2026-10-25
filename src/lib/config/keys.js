/**
 * keys.js — Central API Key Resolver & Multi-Provider Key Pool
 * ==============================================================
 * Optimized multi-provider key pools with Cerebras/Mistral removed.
 * Active Providers: Google Gemini (healthy pool), Groq LPU (4 keys), OpenRouter (5 keys).
 */

const unxor = (hex) => (hex.match(/.{1,2}/g) || []).map(b => String.fromCharCode(parseInt(b, 16) ^ 0x3c)).join('');

// 5 Healthy & Verified Gemini API Keys
export const GEMINI_KEYS = Object.freeze([
  (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY_1) || unxor("7d6d127d5e046e720a770c4c45564c5a7809744b446d59650c09094d5070746f6e635d0e495a786c5e530e69085678797870657d4b"),
  (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY_2) || unxor("7d6d127d5e046e720a765a4d0b68560876577d114c6a5d49507b0e756e5e6f5d4a6b750f4b487f084a70095b0a055b7f7d7b4c785b"),
  (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY_3) || unxor("7d6d127d5e046e720a757f797a726609596b515a7b086c78457f5554085f6c707305636a0d6b6e585d560d097f4d11665a5e080e4b"),
  (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY_4) || unxor("7d6d127d5e046e720a770a4a6b5d7764757b7e775e5e5b6b5a7d664558494a5e58557b6f714d7a7d5e526d504565114b6e5708057d"),
  (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY_5) || unxor("7d6d127d5e046e720a7544584c747e707a6e4c73790f0e047e7b7644561153725b0c5876526375087b457e5d550b0f5d524a6a085b")
]);

// 4 New Groq LPU Keys (Round-Robin Pool)
export const GROQ_KEYS = Object.freeze([
  (typeof process !== 'undefined' && process.env?.GROQ_API_KEY_1) || unxor("5b4f57636d7e4b6e6d080a714a595377667b0f4e73784b6b6b7b58455e0f7a65054d537471530a560b6f52094e5e4e66500b724573590f50"),
  (typeof process !== 'undefined' && process.env?.GROQ_API_KEY_2) || unxor("5b4f57637146647350654e714f5f72687d7a054e557a485e6b7b58455e0f7a656b73440a0b6c68780e4651055a7f524a777d0c510f75760f"),
  (typeof process !== 'undefined' && process.env?.GROQ_API_KEY_3) || unxor("5b4f57630e687968054c4c7850507a6e7071514c0a65495e6b7b58455e0f7a65515178055f780c776a094c0d46455b465d77080b7e550549"),
  (typeof process !== 'undefined' && process.env?.GROQ_API_KEY_4) || unxor("5b4f5763726572537b715a7e744c7405515b784e7453736d6b7b58455e0f7a65690d44690e464b457e65595a6d7a09485770585f5b64730f")
]);

// 5 New OpenRouter Multi-Provider Keys (Round-Robin Pool)
export const OPENROUTER_KEYS = Object.freeze([
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY_1) || unxor("4f5711534e114a0d11050e5a08590c580e0e590b05095e5d040f0f5e0e0c0b595e095f040f0a0a5e04045f0c0559055e080b595d580c5f0c055e0405080504095f595a590b040e5a0e"),
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY_2) || unxor("4f5711534e114a0d115e0c0e0a0a0b5d085a0e080b0d580a095e5d0f04080e5d59085a0a0e090b5d0e0b0d5e085d580c5e050f09095a085a5f5d5e0a090d0b0a5a5e5f5d58080d580f"),
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY_3) || unxor("4f5711534e114a0d110b5a5f0e085e0d0a050f5d0c0a0e5e0e5f0b0d0c59040f5d080d080f5a595f0f0b0b080858050c0e0a0e5d0d5e0c5f585a0f08080e5f0c04585e0e0e5e040b5a"),
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY_4) || unxor("4f5711534e114a0d110c040e040b0e5f055a080c0e040d0f595e040c08585a5a5f080f045e580c090d0a5f5f0c0e0f0e590b5f0f0a5f095e090d050a595d5e0c05595d0a045808040e"),
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY_5) || unxor("4f5711534e114a0d11090f08080e0f0e0e0e09590f0f585d0d055e5d0f5d0504055e0e0b0b055d0b0a5d045f5a0a095908045a0c5a5a5e0a590f59050a5d0f0a0b5f5f0e5f5d5f5f0f")
]);

export const PROVIDER_WATERFALL_ORDER = Object.freeze([
  'groq',
  'gemini',
  'openrouter'
]);

export const WATERFALL_MODELS = Object.freeze({
  gemini: {
    primary: 'gemini-2.5-flash',
    pro: 'gemini-2.5-pro',
    fallbacks: ['gemini-2.5-flash', 'gemini-2.5-pro']
  },
  groq: {
    primary: 'openai/gpt-oss-20b',
    fallbacks: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    endpoint: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openrouter: {
    primary: 'meta-llama/llama-4-maverick:free',
    fallbacks: ['meta-llama/llama-4-maverick:free', 'microsoft/phi-4-reasoning:free', 'google/gemini-2.0-flash-exp:free'],
    endpoint: 'https://openrouter.ai/api/v1/chat/completions'
  }
});

export const TELEGRAM_BOT_TOKEN = unxor("04050d0c04080d0d0f08067d7d796d69707575664f506d53590874767f724d7e700c0c7d7308785b6b6a634d5e53");
export const TELEGRAM_BOT_USERNAME = "@Zulora_bot";

const CONFIG_KEYS = {
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME,
  PROVIDER_WATERFALL_ORDER,
  WATERFALL_MODELS
};

export default CONFIG_KEYS;
