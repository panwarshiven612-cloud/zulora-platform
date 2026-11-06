/**
 * router.ts — Zulora AI Multi-Provider Intelligent Routing Gateway
 * =================================================================
 * Enforces multi-key round-robin rotation, 2-second latency switcher,
 * token continuity mid-stream fallback, and high-token Auto routing:
 *
 * 1. Round-Robin Key Pool: Dynamically balances across Groq, OpenRouter, and multiple Gemini keys.
 * 2. 2-Second Latency Watchdog: If an API key or model exceeds 2s before first token or hits 429,
 *    instantly failover to the next healthy key/provider with sub-second recovery.
 * 3. Token Continuity: Preserves partial streamed tokens and prompts fallback models from the exact
 *    cut-off point without token wastage or repetition.
 * 4. Auto-Mode Intelligence:
 *    - Simple / quick queries: Gemini 3.5 Flash Lite (<500ms latency).
 *    - Complex coding, web apps, motion graphics, research: Gemini 3.8 Flash (45k-65k+ tokens).
 */

import {
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS
} from '../config/keys';

export {
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS
};

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'cerebras' | 'mistral';

export interface RouteResolution {
  provider: ProviderId;
  model: string;
  isAuto: boolean;
  maxTokens: number;
  taskType: 'simple' | 'coding' | 'video' | 'research' | 'general';
  timeoutMs: number;
}

export interface KeyHealthState {
  failures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  successCount: number;
  avgLatencyMs: number;
}

// 2-Second Initial Response Latency Threshold
export const LATENCY_TIMEOUT_MS = 2000;
export const KEY_COOLDOWN_MS = 60_000; // 60s cooldown for rate-limited (429) or timed-out keys
export const CODE_GENERATION_MAX_TOKENS = 65_536;

const cursors: Record<string, number> = {};
const keyHealthMap = new Map<string, KeyHealthState>();

/**
 * Returns or initializes key health state
 */
function getKeyHealth(key: string): KeyHealthState {
  let state = keyHealthMap.get(key);
  if (!state) {
    state = { failures: 0, lastFailureAt: 0, cooldownUntil: 0, successCount: 0, avgLatencyMs: 0 };
    keyHealthMap.set(key, state);
  }
  return state;
}

/**
 * Marks an API key as failed/rate-limited to immediately remove it from active rotation
 */
export function markKeyFailure(key: string, retryAfterMs: number = KEY_COOLDOWN_MS): void {
  if (!key) return;
  const state = getKeyHealth(key);
  state.failures += 1;
  state.lastFailureAt = Date.now();
  const backoff = Math.min(15 * 60_000, KEY_COOLDOWN_MS * (2 ** Math.min(state.failures - 1, 4)));
  state.cooldownUntil = Date.now() + Math.max(backoff, retryAfterMs);
}

/**
 * Records a successful response on an API key to update latency metrics and clear failures
 */
export function recordKeySuccess(key: string, latencyMs?: number): void {
  if (!key) return;
  const state = getKeyHealth(key);
  state.failures = Math.max(0, state.failures - 1);
  state.cooldownUntil = 0;
  state.successCount += 1;
  if (typeof latencyMs === 'number' && latencyMs > 0) {
    state.avgLatencyMs = state.avgLatencyMs 
      ? Math.round(state.avgLatencyMs * 0.7 + latencyMs * 0.3)
      : latencyMs;
  }
}

/**
 * Checks whether an API key is currently healthy or past its cooldown window
 */
export function isKeyHealthy(key: string): boolean {
  if (!key) return false;
  const state = keyHealthMap.get(key);
  if (!state) return true;
  if (state.cooldownUntil <= Date.now()) {
    state.cooldownUntil = 0;
    return true;
  }
  return false;
}

function advanceCursor(provider: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  const current = (cursors[provider] ?? 0) % poolSize;
  cursors[provider] = (current + 1) % poolSize;
  return current;
}

/**
 * Returns rotated API keys prioritizing healthy keys first.
 * If all keys are in cooldown, falls back to the full valid pool to prevent total outage.
 */
export function getRotatedKeys(
  provider: string,
  keys: readonly string[],
  failedKeys: ReadonlySet<string> = new Set()
): string[] {
  const validKeys = keys.filter(k => k && !failedKeys.has(k));
  if (validKeys.length === 0) return [];
  
  // Prioritize healthy keys not currently in cooldown
  const healthy = validKeys.filter(k => isKeyHealthy(k));
  const pool = healthy.length > 0 ? healthy : validKeys;
  
  const start = advanceCursor(provider, pool.length);
  return [...pool.slice(start), ...pool.slice(0, start)];
}

/**
 * Creates an AbortSignal linked to a parent signal with a strict 2-second first-token latency watchdog.
 * Disarms the timeout once `onFirstToken()` is invoked.
 */
export function createLatencyWatchdog(parentSignal?: AbortSignal, timeoutMs = LATENCY_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  let disarmed = false;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    if (!disarmed) {
      timedOut = true;
      controller.abort(new Error(`Latency watchdog: initial token exceeded ${timeoutMs}ms`));
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    disarm: () => {
      disarmed = true;
      clearTimeout(timeoutId);
    },
    cleanup: () => {
      disarmed = true;
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  };
}

/**
 * Token Continuity Builder:
 * When a model or key fails mid-stream after emitting partial tokens, creates
 * a seamless continuation prompt for the fallback model so output resumes from
 * the exact cut-off point without repeating or dropping content.
 */
export function buildContinuationContext(
  messages: Array<{ role: string; content: string }>,
  accumulatedText: string
): Array<{ role: string; content: string }> {
  if (!accumulatedText || !accumulatedText.trim()) {
    return messages;
  }

  const trimmedCutOff = accumulatedText.trim();
  const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
  if (lastUserIdx === -1) return messages;

  const prefix = messages.slice(0, lastUserIdx + 1);
  const continuationPrompt = `[CONTINUATION DIRECTIVE: Generation was interrupted mid-stream. The response so far is:\n"${trimmedCutOff}"\n\nContinue the response seamlessly from the exact point of interruption without repeating any of the above text.]`;

  return [
    ...prefix,
    { role: 'assistant', content: trimmedCutOff },
    { role: 'user', content: continuationPrompt }
  ];
}

export const CODING_REGEX = /\b(?:code|coding|function|class|component|refactor|debug|typescript|javascript|python|rust|golang|c\+\+|html|css|sql|regex|algorithm|api\s*route|backend|frontend|react|vue|svelte|nextjs|vite|build\s+(?:a\s+)?(?:website|web\s*app|site|dashboard|application|saas|landing\s*page|full[- ]stack))\b/i;
export const VIDEO_REGEX = /\b(?:video|animation|motion|motion\s*graphics?|render|timeline|storyboard|gsap|canvas|keyframe|1080x1920|9:16|mp4|ffmpeg|ui\/ux\s*animation|lottie|threejs|webgl|shader|kinetic)\b/i;
export const RESEARCH_REGEX = /\b(?:research|deep\s*dive|in-depth|cite|citation|paper|sources|benchmark|analysis|audit|compare|investigate|thorough|market\s*analysis|competitive\s*analysis|landscape|evaluation|comprehensive|detailed\s*report|literature\s*review|whitepaper)\b/i;

export function classifyTaskType(prompt: string, hasAttachments = false): 'simple' | 'coding' | 'video' | 'research' | 'general' {
  const text = String(prompt || '').trim();
  if (VIDEO_REGEX.test(text)) return 'video';
  if (CODING_REGEX.test(text)) return 'coding';
  if (RESEARCH_REGEX.test(text)) return 'research';
  
  if (!hasAttachments && text.length < 300 && (text.match(/[.!?]+(?=\s|$)/g) || []).length <= 2) {
    return 'simple';
  }
  return 'general';
}

/**
 * Resolves requested model preference with strict user override or smart auto routing:
 * - Groq LPU: Instant sub-500ms hardware LPU acceleration
 * - Gemini 3.5 Flash Lite: Fast lightweight reasoning for everyday standard tasks
 * - Gemini 3.8 Flash: 45,000 - 65,536 token execution budget for complex coding, web building & deep research
 * - OpenRouter: Resilient multi-provider open-source fallback
 */
export function resolveModelRoute(
  preference: string = 'auto',
  prompt: string = '',
  hasAttachments: boolean = false
): RouteResolution {
  const raw = String(preference || 'auto').trim().toLowerCase();

  // 1. Strict Explicit User Selection Overrides
  if (raw === 'gemini-3.8-flash' || raw === 'gemini-3.8' || raw === 'gemini' || raw === 'gemini flash' || raw === 'flash' || raw === 'think' || raw === 'pro' || raw.includes('pro')) {
    return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: false, maxTokens: CODE_GENERATION_MAX_TOKENS, taskType: 'coding', timeoutMs: LATENCY_TIMEOUT_MS };
  }
  if (raw === 'gemini-3.5-flash-lite' || raw === 'gemini-3.5' || raw === 'flash lite' || raw === 'gemini lite' || raw === 'lite') {
    return { provider: 'gemini', model: 'gemini-3.5-flash-lite', isAuto: false, maxTokens: 16384, taskType: 'general', timeoutMs: LATENCY_TIMEOUT_MS };
  }
  if (raw === 'groq' || raw === 'groq lpu' || raw.includes('lpu') || raw.includes('groq')) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile', isAuto: false, maxTokens: 16384, taskType: 'simple', timeoutMs: LATENCY_TIMEOUT_MS };
  }
  if (raw === 'openrouter' || raw === 'openrouter multi-provider' || raw.includes('openrouter')) {
    return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', isAuto: false, maxTokens: 16384, taskType: 'general', timeoutMs: LATENCY_TIMEOUT_MS };
  }

  // 2. Smart Auto Waterfall
  const taskType = classifyTaskType(prompt, hasAttachments);

  // Coding, Full-Scale Web Apps & Motion Graphics -> Gemini 3.8 Flash (65,536 token scaling)
  if (taskType === 'coding' || taskType === 'video') {
    return {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      isAuto: true,
      maxTokens: CODE_GENERATION_MAX_TOKENS,
      taskType,
      timeoutMs: LATENCY_TIMEOUT_MS
    };
  }

  // Deep Research -> Gemini 3.8 Flash with deep reasoning tokens (65k)
  if (taskType === 'research') {
    return {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      isAuto: true,
      maxTokens: CODE_GENERATION_MAX_TOKENS,
      taskType: 'research',
      timeoutMs: LATENCY_TIMEOUT_MS
    };
  }

  // Common / Simple tasks -> Ultra-fast Gemini 3.5 Flash Lite (<500ms latency)
  return {
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    isAuto: true,
    maxTokens: 16384,
    taskType: 'simple',
    timeoutMs: LATENCY_TIMEOUT_MS
  };
}

export default {
  resolveModelRoute,
  getRotatedKeys,
  markKeyFailure,
  recordKeySuccess,
  isKeyHealthy,
  classifyTaskType,
  createLatencyWatchdog,
  buildContinuationContext,
  LATENCY_TIMEOUT_MS,
  KEY_COOLDOWN_MS,
  CODE_GENERATION_MAX_TOKENS,
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS
};
