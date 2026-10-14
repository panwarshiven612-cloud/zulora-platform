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

// Provider credentials are read from server-only environment variables.
const geminiKeysFor = () => [...new Set([
  ...Array.from({ length: 7 }, (_, index) => readFirstKey(`GEMINI_API_KEY_${index + 1}`, `GEMINI_KEY_${index + 1}`)),
  ...readKeys('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'),
  ...readListKey('GEMINI_API_KEYS')
].filter(Boolean))];
export const GEMINI_KEYS = Object.freeze(geminiKeysFor());

const providerKeyNames = {
  gemini: [],
  groq: ['GROQ_API_KEY', 'GROQ_KEY', 'GROQ_API_KEYS'],
  cerebras: ['CEREBRAS_API_KEY', 'CEREBRAS_KEY', 'CEREBRAS_API_KEYS'],
  openrouter: ['OPENROUTER_API_KEY_1', 'OPENROUTER_KEY_1', 'OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'OPENROUTER_API_KEY_2', 'OPENROUTER_KEY_2'],
  mistral: ['MISTRAL_API_KEY', 'MISTRAL_KEY']
};

const numberedProviderKeys = provider => {
  const stems = provider === 'openrouter' ? ['OPENROUTER_API_KEY_', 'OPENROUTER_KEY_'] : [];
  return stems.flatMap(stem => Array.from({ length: 8 }, (_, index) => readFirstKey(`${stem}${index + 1}`)));
};
const providerKeysFor = provider => provider === 'gemini'
  ? geminiKeysFor()
  : [...new Set([
    ...readKeys(...(providerKeyNames[provider] || []).filter(name => !name.endsWith('_KEYS')), ...numberedProviderKeys(provider)),
    ...(providerKeyNames[provider] || []).filter(name => name.endsWith('_KEYS')).flatMap(readListKey)
  ])];

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
