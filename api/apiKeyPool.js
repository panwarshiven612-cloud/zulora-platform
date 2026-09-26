const readKeys = (...names) => [...new Set(names.map(name => String(process.env[name] || '').trim()).filter(Boolean))];
const readFirstKey = (...names) => readKeys(...names)[0] || '';

// Keep server-only names first. VITE_* fallbacks preserve older deployments, but Vite exposes them in browser builds.
const numberedGeminiKeySlots = Array.from({ length: 7 }, (_, index) => readFirstKey(
  `GEMINI_API_KEY_${index + 1}`,
  `GEMINI_KEY_${index + 1}`,
  `VITE_GEMINI_KEY_${index + 1}`,
  `VITE_GEMINI_API_KEY_${index + 1}`
));
const legacyGeminiKeys = readKeys('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'VITE_GEMINI_API_KEY', 'VITE_GOOGLE_API_KEY', 'VITE_GOOGLE_GENERATIVE_AI_API_KEY');
export const GEMINI_KEYS = Object.freeze([...new Set([...numberedGeminiKeySlots.filter(Boolean), ...legacyGeminiKeys])]);

const providerKeyNames = {
  gemini: [],
  groq: ['GROQ_KEY', 'VITE_GROQ_API_KEY', 'VITE_GROQ_KEY'],
  openrouter: [
    'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY_1', 'OPENROUTER_API_KEY_2',
    'VITE_OPENROUTER_API_KEY', 'VITE_OPENROUTER_KEY', 'VITE_OPENROUTER_API_KEY_1',
    'VITE_OPENROUTER_API_KEY_2', 'VITE_OPENROUTER_KEY_1', 'VITE_OPENROUTER_KEY_2'
  ],
  cerebras: ['CEREBRAS_API_KEY', 'VITE_CEREBRAS_API_KEY', 'VITE_CEREBRAS_KEY'],
  mistral: ['MISTRAL_API_KEY', 'VITE_MISTRAL_API_KEY', 'VITE_MISTRAL_KEY']
};
const providerKeysFor = provider => provider === 'groq'
  ? [...new Set([String(process.env.GROQ_API_KEY || '').trim(), ...readKeys(...providerKeyNames.groq)].filter(Boolean))]
  : provider === 'gemini' ? GEMINI_KEYS : readKeys(...(providerKeyNames[provider] || []));

const providers = Object.fromEntries(Object.keys(providerKeyNames).map(provider => [provider, providerKeysFor(provider)]));

const cursors = Object.fromEntries(Object.keys(providers).map(name => [name, 0]));
const failures = Object.fromEntries(Object.keys(providers).map(name => [name, new Map()]));
const performance = Object.fromEntries(Object.keys(providers).map(name => [name, new Map()]));

export const providerKeys = Object.freeze({
  pollinations: readFirstKey('POLLINATIONS_API_KEY', 'POLLINATIONS_KEY', 'VITE_POLLINATIONS_API_KEY', 'VITE_POLLINATIONS_KEY'),
  huggingface: process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '',
  fal: readFirstKey('FAL_API_KEY', 'FAL_KEY', 'VITE_FAL_API_KEY', 'VITE_FAL_KEY'),
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_TOKEN || '',
  replicate: readFirstKey('REPLICATE_API_TOKEN', 'REPLICATE_API_KEY', 'VITE_REPLICATE_API_TOKEN', 'VITE_REPLICATE_KEY')
});

export const apiKeyPool = {
  candidates(provider, { preferBest = false } = {}) {
    // Read Groq's server key per request so runtime environment updates are respected.
    const keys = provider === 'groq' ? providerKeysFor('groq') : providers[provider] || [];
    const now = Date.now();
    const start = cursors[provider] || 0;
    const candidates = keys.map((key, index) => ({ key, index }))
      .filter(({ key, index }) => key && (failures[provider].get(index)?.until || 0) <= now)
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
    const length = provider === 'groq' ? providerKeysFor('groq').length : providers[provider]?.length || 0;
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
    const length = provider === 'groq' ? providerKeysFor('groq').length : providers[provider]?.length || 0;
    cursors[provider] = (index + 1) % (length || 1);
  },
  failed(provider, index, retryAfterMs = 0) {
    const state = failures[provider].get(index);
    const count = (state?.count || 0) + 1;
    const backoff = Math.min(15 * 60_000, 1_000 * (2 ** Math.min(count - 1, 10)));
    failures[provider].set(index, { count, until: Date.now() + Math.max(backoff, retryAfterMs) });
    const metric = performance[provider]?.get(index) || { successes: 0, failures: 0, averageMs: 100_000 };
    performance[provider]?.set(index, { ...metric, failures: metric.failures + 1 });
    const length = provider === 'groq' ? providerKeysFor('groq').length : providers[provider]?.length || 0;
    cursors[provider] = (index + 1) % (length || 1);
  }
};

export const availableProviders = () => Object.keys(providers).filter(provider =>
  (provider === 'groq' ? providerKeysFor('groq') : providers[provider]).some(Boolean)
);
