/**
 * router.ts — Zulora AI Multi-Provider Intelligent Routing Gateway
 * =================================================================
 * Enforces manual provider selection override and smart automated waterfall:
 * 1. Explicit User Selection: Strictly locks execution to chosen provider.
 * 2. Model Strategy: Standardized on Gemini 3.8 Flash (Complex/40k) and Gemini 3.5 Flash Lite (Standard).
 * 3. Smart Auto Waterfall:
 *    - Common/Simple queries: Route to ultra-fast Groq LPU / Gemini 3.5 Flash Lite (~1s latency).
 *    - Coding, Web Building & Video: Routes strictly to Gemini 3.8 Flash with 40,000-token budget.
 *    - Fallback: OpenRouter Multi-Provider (5 keys).
 * 4. Thinking State Tracking: Locks active token speed metrics without flickering.
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

function advanceCursor(provider: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  const current = (cursors[provider] ?? 0) % poolSize;
  cursors[provider] = (current + 1) % poolSize;
  return current;
}

export function getRotatedKeys(
  provider: string,
  keys: readonly string[],
  failedKeys: ReadonlySet<string> = new Set()
): string[] {
  const pool = keys.filter(k => k && !failedKeys.has(k));
  if (pool.length === 0) return [];
  const start = advanceCursor(provider, pool.length);
  return [...pool.slice(start), ...pool.slice(0, start)];
}

const CODING_REGEX = /\b(?:code|coding|function|class|component|refactor|debug|typescript|javascript|python|rust|golang|c\+\+|html|css|sql|regex|algorithm|api\s*route|backend|frontend|react|vue|svelte|nextjs|vite|build\s+(?:a\s+)?(?:website|web\s*app|site|dashboard))\b/i;
const VIDEO_REGEX = /\b(?:video|animation|motion|motion\s*graphics?|render|timeline|storyboard|gsap|canvas|keyframe|1080x1920|9:16|mp4|ffmpeg)\b/i;
const RESEARCH_REGEX = /\b(?:research|deep\s*dive|in-depth|cite|citation|paper|sources|benchmark|analysis|audit|compare|investigate|thorough)\b/i;

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
 * Resolves requested model preference with strict user override or smart auto routing
 */
export function resolveModelRoute(
  preference: string = 'auto',
  prompt: string = '',
  hasAttachments: boolean = false
): RouteResolution {
  const raw = String(preference || 'auto').trim().toLowerCase();

  // 1. Explicit User Selection Overrides
  if (raw === 'gemini-3.8-flash' || raw === 'gemini-3.8' || raw === 'gemini' || raw === 'gemini flash' || raw === 'flash') {
    return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: false, maxTokens: 40000, taskType: 'coding' };
  }
  if (raw === 'gemini-3.5-flash-lite' || raw === 'gemini-3.5' || raw === 'flash lite' || raw === 'gemini lite' || raw === 'lite') {
    return { provider: 'gemini', model: 'gemini-3.5-flash-lite', isAuto: false, maxTokens: 16384, taskType: 'general' };
  }
  if (raw === 'pro_ultra' || raw === 'gemini-2.5-pro' || raw === 'pro' || raw.includes('pro')) {
    return { provider: 'gemini', model: 'gemini-2.5-pro', isAuto: false, maxTokens: 32768, taskType: 'research' };
  }
  if (raw === 'groq' || raw === 'groq lpu' || raw.includes('lpu')) {
    return { provider: 'groq', model: 'openai/gpt-oss-20b', isAuto: false, maxTokens: 16384, taskType: 'simple' };
  }
  if (raw === 'openrouter' || raw === 'openrouter multi-provider' || raw.includes('openrouter')) {
    return { provider: 'openrouter', model: 'meta-llama/llama-4-maverick:free', isAuto: false, maxTokens: 16384, taskType: 'general' };
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

  // Research -> Gemini Pro with deep reasoning tokens
  if (taskType === 'research') {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      isAuto: true,
      maxTokens: 32768,
      taskType: 'research'
    };
  }

  // Common / Simple tasks -> Ultra-fast Groq LPU (~1s latency)
  return {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    isAuto: true,
    maxTokens: 16384,
    taskType: 'simple'
  };
}

export default {
  resolveModelRoute,
  getRotatedKeys,
  classifyTaskType,
  GEMINI_KEYS,
  GROQ_KEYS,
  OPENROUTER_KEYS
};
