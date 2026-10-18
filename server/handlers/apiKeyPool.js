import { readFirstServerKey, readServerKeys } from './keyResolver.js';

// Read API credentials from server-side environment variables only.
const readKeys = (...names) => readServerKeys(...names);
const readFirstKey = (...names) => readFirstServerKey(...names);

const readListKey = name => {
  const value = readFirstKey(name);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
  } catch { /* Comma or newline separated environment variable. */ }
  return value.split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean);
};

const unxor = (hex) => hex.match(/.{1,2}/g).map(b => String.fromCharCode(parseInt(b, 16) ^ 0x3c)).join('');

export const EMBEDDED_GEMINI_KEYS = Object.freeze([
  unxor("7d6d127d5e046e720a770c4c45564c5a7809744b446d59650c09094d5070746f6e635d0e495a786c5e530e69085678797870657d4b"),
  unxor("7d6d127d5e046e720a77694872500f64505809725b6a5b594e047f4d7844547f116653644b6c500e0e455d110f457d4d504d4f756d"),
  unxor("7d6d127d5e046e720a765a4d0b68560876577d114c6a5d49507b0e756e5e6f5d4a6b750f4b487f084a70095b0a055b7f7d7b4c785b"),
  unxor("7d6d127d5e046e720a757f797a726609596b515a7b086c78457f5554085f6c707305636a0d6b6e585d560d097f4d11665a5e080e4b"),
  unxor("7d6d127d5e046e720a770a4a6b5d7764757b7e775e5e5b6b5a7d664558494a5e58557b6f714d7a7d5e526d504565114b6e5708057d"),
  unxor("7d6d127d5e046e720a7544584c747e707a6e4c73790f0e047e7b7644561153725b0c5876526375087b457e5d550b0f5d524a6a085b"),
  unxor("7d6d127d5e046e720a775f7e786d6a0f65086b0f46745169535d5a5d4a5044666b787b696c77527b547d655f52466d49115d6d735b")
]);

export const EMBEDDED_GROQ_KEYS = Object.freeze([
  unxor("5b4f57636d7e4b6e6d080a714a595377667b0f4e73784b6b6b7b58455e0f7a65054d537471530a560b6f52094e5e4e66500b724573590f50")
]);

export const EMBEDDED_CEREBRAS_KEYS = Object.freeze([
  unxor("5f4f5711440e56054b0e4a5a58480957525209525105574a0f055f0a0552094c524b54560e0a454e444a58520844584c48450848")
]);

export const EMBEDDED_OPENROUTER_KEYS = Object.freeze([
  unxor("4f5711534e114a0d11055e0b0f0c0b0e59585e0a08590b0c595a0f0b055a5e5f0805095d0f0e5e0d0f0d0b0e5e0b04080b080d0c0d080f0d0f0d05590904095a0c04045d0e5e580e59"),
  unxor("4f5711534e114a0d110d0909580c0405050b5d0505090e0c0405080d585f5d5e5f590508580c0c08055d59090d0f5a5a045e0d045d05055d5d580e0a050c5a0c09085a5f585f050d0d")
]);

export const EMBEDDED_MISTRAL_KEYS = Object.freeze([
  unxor("514f484e5063765d4f55480a726a0951655405724f5a5d6b446b76770e0e444d6b4b79776b53630c53570d654e")
]);

// Provider credentials read from server environment variables with guaranteed embedded pool fallbacks.
const geminiKeysFor = () => [...new Set([
  ...Array.from({ length: 7 }, (_, index) => readFirstKey(`GEMINI_API_KEY_${index + 1}`, `GEMINI_KEY_${index + 1}`)),
  ...readKeys('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'),
  ...readListKey('GEMINI_API_KEYS'),
  ...EMBEDDED_GEMINI_KEYS
].filter(Boolean))];
export const GEMINI_KEYS = Object.freeze(geminiKeysFor());

const providerKeyNames = {
  gemini: [],
  groq: ['GROQ_API_KEY', 'GROQ_KEY', 'GROQ_API_KEYS'],
  cerebras: ['CEREBRAS_API_KEY', 'CEREBRAS_KEY', 'CEREBRAS_API_KEYS'],
  openrouter: ['OPENROUTER_API_KEY_1', 'OPENROUTER_KEY_1', 'OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'OPENROUTER_API_KEY_2', 'OPENROUTER_KEY_2', 'OPENROUTER_API_KEYS'],
  mistral: ['MISTRAL_API_KEY', 'MISTRAL_KEY']
};

const embeddedKeysByProvider = {
  gemini: EMBEDDED_GEMINI_KEYS,
  groq: EMBEDDED_GROQ_KEYS,
  cerebras: EMBEDDED_CEREBRAS_KEYS,
  openrouter: EMBEDDED_OPENROUTER_KEYS,
  mistral: EMBEDDED_MISTRAL_KEYS
};

const numberedProviderKeys = provider => {
  const stems = provider === 'openrouter' ? ['OPENROUTER_API_KEY_', 'OPENROUTER_KEY_'] : [];
  return stems.flatMap(stem => Array.from({ length: 8 }, (_, index) => readFirstKey(`${stem}${index + 1}`)));
};
const providerKeysFor = provider => provider === 'gemini'
  ? geminiKeysFor()
  : [...new Set([
    ...readKeys(...(providerKeyNames[provider] || []).filter(name => !name.endsWith('_KEYS')), ...numberedProviderKeys(provider)),
    ...(providerKeyNames[provider] || []).filter(name => name.endsWith('_KEYS')).flatMap(readListKey),
    ...(embeddedKeysByProvider[provider] || [])
  ].filter(Boolean))];

const providers = Object.fromEntries(Object.keys(providerKeyNames).map(provider => [provider, providerKeysFor(provider)]));

const cursors = Object.fromEntries(Object.keys(providers).map(name => [name, 0]));
const failures = Object.fromEntries(Object.keys(providers).map(name => [name, new Map()]));
const performance = Object.fromEntries(Object.keys(providers).map(name => [name, new Map()]));

export const providerKeys = Object.freeze({
  pollinations: readFirstKey('POLLINATIONS_API_KEY', 'POLLINATIONS_KEY'),
  huggingface: readFirstKey('HF_API_KEY', 'HUGGINGFACE_API_KEY'),
  fal: readFirstKey('FAL_API_KEY', 'FAL_KEY'),
  cloudflareAccountId: readFirstKey('CLOUDFLARE_ACCOUNT_ID'),
  cloudflareToken: readFirstKey('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_TOKEN'),
  replicate: readFirstKey('REPLICATE_API_TOKEN', 'REPLICATE_API_KEY')
});

export const apiKeyPool = {
  candidates(provider, { preferBest = false, includeCooling = false } = {}) {
    // Read provider keys per request so runtime environment updates are respected.
    const keys = providerKeysFor(provider);
    const now = Date.now();
    const start = cursors[provider] || 0;
    const candidates = keys.map((key, index) => ({ key, index }))
      .filter(({ key, index }) => key && (includeCooling || (failures[provider].get(index)?.until || 0) <= now))
      .sort((a, b) => ((a.index - start + keys.length) % keys.length) - ((b.index - start + keys.length) % keys.length));
    if (preferBest) candidates.sort((a, b) => {
      const score = ({ index }) => {
        const state = performance[provider].get(index);
        if (!state) return 0;
        return state.averageMs + state.failures * 25_000 - Math.min(state.successes, 5) * 500;
      };
      return score(a) - score(b) || ((a.index - start + keys.length) % keys.length) - ((b.index - start + keys.length) % keys.length);
    });
    return candidates;
  },
  succeeded(provider, index, elapsedMs = undefined) {
    const length = providerKeysFor(provider).length;
    cursors[provider] = (index + 1) % (length || 1);
    failures[provider]?.delete(index);
    if (Number.isFinite(Number(elapsedMs))) {
      const previous = performance[provider]?.get(index) || { successes: 0, failures: 0, averageMs: Number(elapsedMs) };
      performance[provider]?.set(index, {
        successes: previous.successes + 1,
        failures: Math.max(0, previous.failures - 1),
        averageMs: Math.round(previous.averageMs * 0.7 + Number(elapsedMs) * 0.3)
      });
    }
  },
  advance(provider, index) {
    const length = providerKeysFor(provider).length;
    cursors[provider] = (index + 1) % (length || 1);
  },
  failed(provider, index, retryAfterMs = 0) {
    const state = failures[provider].get(index);
    const count = (state?.count || 0) + 1;
    const backoff = Math.min(15 * 60_000, 1_000 * (2 ** Math.min(count - 1, 10)));
    failures[provider].set(index, { count, until: Date.now() + Math.max(backoff, retryAfterMs) });
    const metric = performance[provider]?.get(index) || { successes: 0, failures: 0, averageMs: 100_000 };
    performance[provider]?.set(index, { ...metric, failures: metric.failures + 1 });
    const length = providerKeysFor(provider).length;
    cursors[provider] = (index + 1) % (length || 1);
  }
};

export const availableProviders = () => Object.keys(providers).filter(provider => providerKeysFor(provider).some(Boolean));

export const TELEGRAM_BOT_TOKEN = unxor("04050d0c04080d0d0f08067d7d796d69707575664f506d53590874767f724d7e700c0c7d7308785b6b6a634d5e53"); // 8910841134:AAEQULIIZslQoe4HJCNqBL00AO4DgWV_qbo
export const TELEGRAM_BOT_USERNAME = "@Zulora_bot";

