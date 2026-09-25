const providers = {
  gemini: Array.from({ length: 7 }, (_, index) => process.env[`GEMINI_API_KEY_${index + 1}`] || process.env[`GEMINI_KEY_${index + 1}`]),
  groq: [process.env.GROQ_API_KEY],
  openrouter: [process.env.OPENROUTER_API_KEY_1, process.env.OPENROUTER_API_KEY_2],
  cerebras: [process.env.CEREBRAS_API_KEY],
  mistral: [process.env.MISTRAL_API_KEY]
};

const cursors = Object.fromEntries(Object.keys(providers).map(name => [name, 0]));
const failures = Object.fromEntries(Object.keys(providers).map(name => [name, new Map()]));

export const providerKeys = Object.freeze({
  pollinations: process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY || process.env.VITE_POLLINATIONS_KEY || '',
  huggingface: process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || process.env.VITE_HUGGINGFACE_KEY || '',
  fal: process.env.FAL_API_KEY || process.env.VITE_FAL_KEY || '',
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_TOKEN || '',
  replicate: process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || ''
});

export const apiKeyPool = {
  candidates(provider) {
    const keys = providers[provider] || [];
    const now = Date.now();
    const start = cursors[provider] || 0;
    return keys.map((key, index) => ({ key, index }))
      .filter(({ key, index }) => key && (failures[provider].get(index)?.until || 0) <= now)
      .sort((a, b) => ((a.index - start + keys.length) % keys.length) - ((b.index - start + keys.length) % keys.length));
  },
  succeeded(provider, index) {
    cursors[provider] = (index + 1) % (providers[provider]?.length || 1);
    failures[provider]?.delete(index);
  },
  failed(provider, index, retryAfterMs = 0) {
    const state = failures[provider].get(index);
    const count = (state?.count || 0) + 1;
    const backoff = Math.min(15 * 60_000, 1_000 * (2 ** Math.min(count - 1, 10)));
    failures[provider].set(index, { count, until: Date.now() + Math.max(backoff, retryAfterMs) });
    cursors[provider] = (index + 1) % (providers[provider]?.length || 1);
  }
};

export const availableProviders = () => Object.keys(providers).filter(provider => providers[provider].some(Boolean));
