/**
 * webSearch.js — Client-side web search with in-memory citation caching
 * Uses DuckDuckGo Instant API as primary, Pollinations as fallback.
 * Results cached for 5 minutes to reduce repeated API calls.
 */

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchDuckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const data = await res.json();
  const results = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  (data.RelatedTopics || []).slice(0, 5).forEach(topic => {
    if (topic.FirstURL && topic.Text) {
      results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, url: topic.FirstURL });
    }
  });
  (data.Results || []).slice(0, 3).forEach(r => {
    if (r.FirstURL && r.Text) {
      results.push({ title: r.Text.slice(0, 80), snippet: r.Text, url: r.FirstURL });
    }
  });
  return results;
}

/**
 * Perform a web search and return { results, context }
 * results: Array<{ title, snippet, url }>
 * context: string for injecting into LLM prompt
 */
export async function webSearch(query) {
  const cacheKey = String(query || '').toLowerCase().trim();
  if (!cacheKey) return { results: [], context: '' };

  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  let results = [];
  try {
    results = await fetchDuckDuckGo(query);
  } catch (e) {
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
