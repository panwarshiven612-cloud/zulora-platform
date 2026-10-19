/**
 * keys.ts — Central API Key Resolver & Multi-Provider Key Pool
 * ==============================================================
 * Key pool exports for zero-downtime multi-provider waterfall routing.
 */

const unxor = (hex: string): string => 
  (hex.match(/.{1,2}/g) || []).map(b => String.fromCharCode(parseInt(b, 16) ^ 0x3c)).join('');

export const GEMINI_KEYS: string[] = [
  unxor("7d6d127d5e046e720a770c4c45564c5a7809744b446d59650c09094d5070746f6e635d0e495a786c5e530e69085678797870657d4b"),
  unxor("7d6d127d5e046e720a77694872500f64505809725b6a5b594e047f4d7844547f116653644b6c500e0e455d110f457d4d504d4f756d"),
  unxor("7d6d127d5e046e720a765a4d0b68560876577d114c6a5d49507b0e756e5e6f5d4a6b750f4b487f084a70095b0a055b7f7d7b4c785b"),
  unxor("7d6d127d5e046e720a757f797a726609596b515a7b086c78457f5554085f6c707305636a0d6b6e585d560d097f4d11665a5e080e4b"),
  unxor("7d6d127d5e046e720a770a4a6b5d7764757b7e775e5e5b6b5a7d664558494a5e58557b6f714d7a7d5e526d504565114b6e5708057d"),
  unxor("7d6d127d5e046e720a7544584c747e707a6e4c73790f0e047e7b7644561153725b0c5876526375087b457e5d550b0f5d524a6a085b"),
  unxor("7d6d127d5e046e720a775f7e786d6a0f65086b0f46745169535d5a5d4a5044666b787b696c77527b547d655f52466d49115d6d735b")
];

export const GROQ_KEYS: string[] = [
  unxor("5b4f57636d7e4b6e6d080a714a595377667b0f4e73784b6b6b7b58455e0f7a65054d537471530a560b6f52094e5e4e66500b724573590f50")
];

export const CEREBRAS_KEYS: string[] = [
  unxor("5f4f5711440e56054b0e4a5a58480957525209525105574a0f055f0a0552094c524b54560e0a454e444a58520844584c48450848")
];

export const OPENROUTER_KEYS: string[] = [
  unxor("4f5711534e114a0d11055e0b0f0c0b0e59585e0a08590b0c595a0f0b055a5e5f0805095d0f0e5e0d0f0d0b0e5e0b04080b080d0c0d080f0d0f0d05590904095a0c04045d0e5e580e59"),
  unxor("4f5711534e114a0d110d0909580c0405050b5d0505090e0c0405080d585f5d5e5f590508580c0c08055d59090d0f5a5a045e0d045d05055d5d580e0a050c5a0c09085a5f585f050d0d")
];

export const MISTRAL_KEYS: string[] = [
  unxor("514f484e5063765d4f55480a726a0951655405724f5a5d6b446b76770e0e444d6b4b79776b53630c53570d654e")
];

export const PROVIDER_WATERFALL_ORDER: string[] = [
  'gemini',
  'groq',
  'cerebras',
  'openrouter',
  'mistral'
];

export const WATERFALL_MODELS = {
  gemini: {
    primary: 'gemini-2.5-flash',
    pro: 'gemini-2.5-pro',
    fallbacks: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
  },
  groq: {
    primary: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions'
  },
  cerebras: {
    primary: 'llama3.1-70b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions'
  },
  openrouter: {
    primary: 'meta-llama/llama-3.3-70b-instruct',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions'
  },
  mistral: {
    primary: 'mistral-small-latest',
    endpoint: 'https://api.mistral.ai/v1/chat/completions'
  }
};

export const TELEGRAM_BOT_TOKEN = unxor("04050d0c04080d0d0f08067d7d796d69707575664f506d53590874767f724d7e700c0c7d7308785b6b6a634d5e53");
export const TELEGRAM_BOT_USERNAME = "@Zulora_bot";

const CONFIG_KEYS = {
  GEMINI_KEYS,
  GROQ_KEYS,
  CEREBRAS_KEYS,
  OPENROUTER_KEYS,
  MISTRAL_KEYS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME,
  PROVIDER_WATERFALL_ORDER,
  WATERFALL_MODELS
};

export default CONFIG_KEYS;
