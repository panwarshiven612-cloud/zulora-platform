/**
 * webSearch.js — Client-side web search with in-memory citation caching
 * Uses DuckDuckGo Instant API as primary, Pollinations as fallback.
 * Results cached for 5 minutes to reduce repeated API calls.
 */

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function verifiedResult(title, snippet, rawUrl) {
  try {
    let url = new URL(String(rawUrl || ''));
    if (/^(?:www\.)?duckduckgo\.com$/i.test(url.hostname) && url.pathname === '/l/') {
      const destination = url.searchParams.get('uddg');
      if (!destination) return null;
      url = new URL(destination);
    }
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || !host || host === 'localhost'
      || host.endsWith('.localhost') || host.endsWith('.local') || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)
      || /^(?:www\.)?duckduckgo\.com$/i.test(host)) return null;
    return {
      title: String(title || host).replace(/\s+/g, ' ').trim().slice(0, 180),
      snippet: String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 1_200),
      url: url.href
    };
  } catch { return null; }
}

async function fetchDuckDuckGo(query, signal) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
  const combinedSignal = signal && timeoutSignal && AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal || timeoutSignal;
  const res = await fetch(url, { signal: combinedSignal });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const data = await res.json();
  const results = [];
  const add = (title, snippet, rawUrl) => {
    const source = verifiedResult(title, snippet, rawUrl);
    if (source && !results.some(item => item.url === source.url)) results.push(source);
  };
  add(data.Heading || query, data.AbstractText, data.AbstractURL);
  const visitTopics = topics => {
    for (const topic of Array.isArray(topics) ? topics : []) {
      if (topic.FirstURL && topic.Text) add(topic.Text, topic.Text, topic.FirstURL);
      if (Array.isArray(topic.Topics)) visitTopics(topic.Topics);
      if (results.length >= 8) return;
    }
  };
  visitTopics(data.RelatedTopics);
  visitTopics(data.Results);
  return results.slice(0, 8);
}

/**
 * Perform a web search and return { results, context }
 * results: Array<{ title, snippet, url }>
 * context: string for injecting into LLM prompt
 */
export async function webSearch(query, { signal } = {}) {
  const cacheKey = String(query || '').toLowerCase().trim();
  if (!cacheKey) return { results: [], context: '' };

  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  let results = [];
  try {
    results = await fetchDuckDuckGo(query, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[WebSearch] DDG failed:', e.message);
  }

  const context = results.length
    ? `Web search results for "${query}":\n` +
      results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`).join('\n\n')
    : '';

  const data = { results, context };
  if (results.length) SEARCH_CACHE.set(cacheKey, { ts: Date.now(), data });
  return data;
}

/**
 * Format citation links from search results for markdown display.
 */
export function formatCitations(results = []) {
  if (!results.length) return '';
  return '\n\n---\n**Sources:**  \n' + results.slice(0, 5).map((r, i) => {
    const hostname = (() => {
      try { return new URL(r.url).hostname.replace('www.', ''); } catch { return r.url; }
    })();
    return `[${i + 1}. ${r.title || hostname}](${r.url})`;
  }).join('  ·  ');
}
