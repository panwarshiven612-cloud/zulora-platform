/**
 * router.ts — Zulora AI Multi-Provider Intelligent Routing Gateway
 * =================================================================
 * Enforces manual provider selection override and smart automated waterfall:
 * 1. Explicit User Selection: Strictly locks execution to chosen provider.
 * 2. Model Strategy: Standardized on Gemini 3.8 Flash (Coding/Research/40k) and Gemini 3.5 Flash Lite (Standard/Fast).
 * 3. Sub-0.5s Latency: Fast round-robin key pool with instantaneous health tracking and failover.
 * 4. Resilient Key Waterfall: Automatic 60-second cooldown on 429/404 rate-limited keys.
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

export type ProviderId = 'gemini' | 'groq' | 'openrouter';

export interface RouteResolution {
  provider: ProviderId;
  model: string;
  isAuto: boolean;
  maxTokens: number;
  taskType: 'simple' | 'coding' | 'video' | 'research' | 'general';
}

const cursors: Record<string, number> = {};

// In-memory key health state with automatic cooldown
const failedKeyTimestamps = new Map<string, number>();
const KEY_COOLDOWN_MS = 60_000; // 60s cooldown for rate-limited (429) or erroneous keys

/**
 * Marks an API key as failed/rate-limited to immediately remove it from the active rotation
 */
export function markKeyFailure(key: string): void {
  if (!key) return;
  failedKeyTimestamps.set(key, Date.now());
}

/**
 * Checks whether an API key is currently healthy or past its cooldown window
 */
export function isKeyHealthy(key: string): boolean {
  if (!key) return false;
  const failedAt = failedKeyTimestamps.get(key);
  if (!failedAt) return true;
  if (Date.now() - failedAt > KEY_COOLDOWN_MS) {
    failedKeyTimestamps.delete(key);
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

export const CODING_REGEX = /\b(?:code|coding|function|class|component|refactor|debug|typescript|javascript|python|rust|golang|c\+\+|html|css|sql|regex|algorithm|api\s*route|backend|frontend|react|vue|svelte|nextjs|vite|build\s+(?:a\s+)?(?:website|web\s*app|site|dashboard))\b/i;
export const VIDEO_REGEX = /\b(?:video|animation|motion|motion\s*graphics?|render|timeline|storyboard|gsap|canvas|keyframe|1080x1920|9:16|mp4|ffmpeg)\b/i;
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
 * - Gemini 3.8 Flash: 40k execution budget for complex coding, web building & deep research
 * - OpenRouter: Resilient multi-provider open-source fallback
 */
export function resolveModelRoute(
  preference: string = 'auto',
  prompt: string = '',
  hasAttachments: boolean = false
): RouteResolution {
  const raw = String(preference || 'auto').trim().toLowerCase();

  // 1. Strict Explicit User Selection Overrides
  if (raw.includes('3.8') || raw === 'gemini-3.8-flash' || raw === 'gemini-3.8' || raw === 'think' || raw === 'pro' || (raw.includes('flash') && !raw.includes('lite') && !raw.includes('3.5'))) {
    return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: false, maxTokens: 40000, taskType: 'coding' };
  }
  if (raw.includes('3.5') || raw.includes('lite') || raw === 'gemini-3.5-flash-lite') {
    return { provider: 'gemini', model: 'gemini-3.5-flash-lite', isAuto: false, maxTokens: 16384, taskType: 'general' };
  }
  if (raw.includes('groq') || raw.includes('lpu')) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile', isAuto: false, maxTokens: 16384, taskType: 'simple' };
  }
  if (raw.includes('openrouter') || raw.includes('meta-llama') || raw.includes('llama-3.3-70b-instruct')) {
    return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', isAuto: false, maxTokens: 16384, taskType: 'general' };
  }

  // 2. Smart Auto Waterfall
  const taskType = classifyTaskType(prompt, hasAttachments);

  // Coding & Complex Video Generation -> Gemini 3.8 Flash with 40,000 token execution budget
  if (taskType === 'coding' || taskType === 'video') {
    return {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      isAuto: true,
      maxTokens: 40000,
      taskType
    };
  }

  // Deep Research -> Gemini 3.8 Flash with deep reasoning tokens (40k)
  if (taskType === 'research') {
    return {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      isAuto: true,
      maxTokens: 40000,
      taskType: 'research'
    };
  }

  // Common / Simple tasks -> Ultra-fast Groq LPU (<500ms latency)
  return {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    isAuto: true,
    maxTokens: 16384,
    taskType: 'simple'
  };
}

export default {
  resolveModelRoute,
  getRotatedKeys,
  markKeyFailure,
  isKeyHealthy,
  classifyTaskType,
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS
};
