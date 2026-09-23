// Client-side key pool. VITE_* values are shipped to browsers; production secrets
// belong behind a server endpoint. Values are intentionally read from environment.
const env = import.meta.env;

const pools = {
  gemini: [env.VITE_GEMINI_KEY_1, env.VITE_GEMINI_KEY_2, env.VITE_GEMINI_KEY_3, env.VITE_GEMINI_KEY_4, env.VITE_GEMINI_KEY_5, env.VITE_GEMINI_KEY_6, env.VITE_GEMINI_KEY_7],
  groq: [env.VITE_GROQ_API_KEY],
  openrouter: [env.VITE_OPENROUTER_KEY_1, env.VITE_OPENROUTER_KEY_2],
  cerebras: [env.VITE_CEREBRAS_API_KEY],
  mistral: [env.VITE_MISTRAL_API_KEY]
};

const state = Object.fromEntries(Object.keys(pools).map(name => [name, { index: 0, failures: new Map() }]));

export const apiKeyPool = {
  candidates(provider) {
    const keys = pools[provider] || [];
    const now = Date.now();
    return keys.map((key, index) => ({ key, index })).filter(({ key, index }) => key && (state[provider].failures.get(index)?.until || 0) <= now)
      .sort((a, b) => ((a.index - state[provider].index + keys.length) % keys.length) - ((b.index - state[provider].index + keys.length) % keys.length));
  },
  succeeded(provider, index) {
    state[provider].index = (index + 1) % (pools[provider]?.length || 1);
    state[provider].failures.delete(index);
  },
  failed(provider, index, retryAfterMs = 0) {
    const failures = state[provider].failures;
    const count = (failures.get(index)?.count || 0) + 1;
    const backoff = Math.min(5 * 60_000, 1_000 * (2 ** Math.min(count - 1, 8)));
    failures.set(index, { count, until: Date.now() + Math.max(backoff, retryAfterMs) });
    state[provider].index = (index + 1) % (pools[provider]?.length || 1);
  }
};
