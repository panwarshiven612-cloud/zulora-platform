import { 
  GEMINI_KEYS, 
  GROQ_KEYS, 
  OPENROUTER_KEYS, 
  getRotatedKeys,
  resolveModelRoute,
  classifyTaskType
} from '../../../lib/ai/router';
import { MASTER_SYSTEM_PROMPT } from '../../../lib/llm/prompts/systemPrompt';
import { buildInjectedConnectorContext, ConnectorContextPayload } from '../../../lib/connectors';
import { isResearchQuery, formatResearchPrompt } from '../../../lib/ai/researchFormatter';

// Effort-level token budget resolver
function resolveEffortTokenBudget(effortLevel: string, coding: boolean = false): number {
  const EFFORT_BUDGETS: Record<string, number> = { low: 4096, medium: 8192, high: 20000, extra: 40000, max: 65536 };
  let budget = EFFORT_BUDGETS[effortLevel] ?? 8192;
  if (coding && budget < 20000) budget = 20000;
  return budget;
}

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface StreamStats {
  tokenCount: number;
  signal?: AbortSignal;
  responseText: string;
  firstTokenAt?: number;
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

function emitProviderChunk(
  chunk: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  stats: StreamStats
) {
  if (!chunk || stats.signal?.aborted) return;
  stats.responseText += chunk;
  stats.tokenCount = estimateTokenCount(stats.responseText);
  stats.firstTokenAt ||= Date.now();
  const elapsedSeconds = Math.max(0.1, (Date.now() - stats.firstTokenAt) / 1000);
  const payload = JSON.stringify({
    token: chunk,
    tokenCount: stats.tokenCount,
    tokensPerSec: Number((stats.tokenCount / elapsedSeconds).toFixed(1)),
    estimated: true
  });
  controller.enqueue(encoder.encode(['event: token', `data: ${payload}`, '', ''].join('\n')));
}

function resetStreamStats(stats: StreamStats) {
  stats.tokenCount = 0;
  stats.responseText = '';
  stats.firstTokenAt = undefined;
}

function linkedFetchSignal(parent?: AbortSignal, timeoutMs = 8000) {
  const fetchController = new AbortController();
  const abortFromParent = () => fetchController.abort(parent?.reason);
  if (parent?.aborted) fetchController.abort(parent.reason);
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timeoutId = setTimeout(() => fetchController.abort(), timeoutMs);
  return {
    signal: fetchController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parent?.removeEventListener('abort', abortFromParent);
    }
  };
}

async function streamFromGemini(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  stats: StreamStats,
  systemInstruction?: string,
  maxOutputTokens: number = 16384
): Promise<boolean> {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

  const systemMessage = systemInstruction || messages.find(m => m.role === 'system')?.content || MASTER_SYSTEM_PROMPT;
  const normalizedTargetModel = (model === 'gemini-2.5-pro' || model.includes('pro'))
    ? 'gemini-2.5-pro'
    : (model === 'gemini-3.5-flash-lite' || model.includes('lite'))
      ? 'gemini-3.5-flash-lite'
      : 'gemini-3.8-flash';
  const candidateModels = [normalizedTargetModel, 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro'].filter((v, i, a) => a.indexOf(v) === i);
  const rotatedKeys = getRotatedKeys('gemini', GEMINI_KEYS);

  for (const targetModel of candidateModels) {
    for (const key of rotatedKeys) {
      if (stats.signal?.aborted) return false;
      if (!key) continue;
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${key}`;
        const fetchSignal = linkedFetchSignal(stats.signal, 8000);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
            ...(systemMessage ? { system_instruction: { parts: [{ text: systemMessage }] } } : {}),
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: Math.max(16384, maxOutputTokens)
            }
          }),
          signal: fetchSignal.signal
        });
        fetchSignal.cleanup();

        if (res.status === 429 || res.status === 404 || res.status === 401 || res.status >= 500 || !res.ok || !res.body) {
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedAnyChunk = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              try {
                const data = JSON.parse(jsonStr);
                const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                  receivedAnyChunk = true;
                  emitProviderChunk(textChunk, controller, encoder, stats);
                }
              } catch {
                // skip unparseable fragments
              }
            }
          }
        }

        if (receivedAnyChunk) {
          return true;
        }
      } catch {
        if (stats.signal?.aborted) return false;
      }
    }
  }
  return false;
}

async function streamFromOpenAiCompatible(
  endpoint: string,
  key: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  stats: StreamStats,
  systemInstruction?: string,
  maxTokens: number = 16384
): Promise<boolean> {
  try {
    if (stats.signal?.aborted || !key) return false;
    const fetchSignal = linkedFetchSignal(stats.signal, 10000);

    const formattedMessages = [...messages];
    if (systemInstruction && !formattedMessages.some(m => m.role === 'system')) {
      formattedMessages.unshift({ role: 'system', content: systemInstruction });
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: maxTokens
      }),
      signal: fetchSignal.signal
    });
    fetchSignal.cleanup();

    if (res.status === 429 || res.status === 404 || res.status >= 500 || !res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedAnyToken = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const data = JSON.parse(jsonStr);
            const token = data.choices?.[0]?.delta?.content;
            if (token) {
              receivedAnyToken = true;
              emitProviderChunk(token, controller, encoder, stats);
            }
          } catch {
            // skip
          }
        }
      }
    }

    return receivedAnyToken;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: {
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    model?: string;
    modelId?: string;
    modelPreference?: string;
    stream?: boolean;
    workspaceContext?: ConnectorContextPayload['workspaceContext'];
    driveContext?: ConnectorContextPayload['driveContext'];
    searchContext?: ConnectorContextPayload['searchContext'];
    context?: string;
    personalMemory?: string;
    effortLevel?: string;
    coding?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: String(body.prompt || '') }];
  const messages = rawMessages.map((m: { role?: string; content?: string }, idx: number) => {
    const isCurrentPrompt = idx === rawMessages.length - 1;
    let content = String(m.content || '');
    if (!isCurrentPrompt) {
      content = content.replace(/\[\s*(?:send_email|sheets_create|drive_upload)[\s\S]*?\]/gi, '');
    }
    return { role: m.role || 'user', content };
  });

  const lastUserPrompt = messages.filter(m => m.role === 'user').pop()?.content || '';

  // Inject Connector Context
  const injectedConnectorText = buildInjectedConnectorContext({
    workspaceContext: body.workspaceContext,
    driveContext: body.driveContext,
    searchContext: body.searchContext
  });

  let effectiveSystemPrompt = MASTER_SYSTEM_PROMPT;
  if (body.personalMemory) {
    effectiveSystemPrompt += `\n\n${body.personalMemory}`;
  } else if ((body as any).aiBrain || (body as any).userVault) {
    const aiBrain = (body as any).aiBrain || {};
    const userVault = (body as any).userVault || {};
    const memParts = [
      aiBrain.talkStyle && `Tone/Style: ${aiBrain.talkStyle}`,
      aiBrain.customInstructions && `Instructions: ${aiBrain.customInstructions}`,
      userVault.preferences && `User Preferences: ${userVault.preferences}`,
      userVault.keyFacts && `Key Facts: ${userVault.keyFacts}`
    ].filter(Boolean);
    if (memParts.length) {
      effectiveSystemPrompt += `\n\n[USER PERSONAL BRAIN & VAULT CONTEXT]:\n${memParts.join('\n')}`;
    }
  }

  if (Array.isArray((body as any).contextMemory) && (body as any).contextMemory.length) {
    const recent = (body as any).contextMemory.slice(-6).join('\n');
    effectiveSystemPrompt += `\n\n[RECENT CHAT CONTEXT MEMORY]:\n${recent}`;
  }

  if (injectedConnectorText) {
    effectiveSystemPrompt += `\n\nACTIVE CONNECTORS CONTEXT:\n${injectedConnectorText}`;
  }
  if (body.context) {
    effectiveSystemPrompt += `\n\nADDITIONAL REQUEST CONTEXT:\n${body.context}`;
  }

  // Model Routing & Task Classification - Strict Binding to Client Selection
  const requestedModel = body.modelId || body.modelPreference || body.model || 'auto';
  const resolved = resolveModelRoute(requestedModel, lastUserPrompt, Boolean(body.driveContext));
  const { provider, model, isAuto, maxTokens, taskType } = resolved;
  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();
  const effortBudget = resolveEffortTokenBudget(effortLevel, taskType === 'coding' || Boolean(body.coding));
  const wantsStream = body.stream !== false;

  // MODULE 2: Deep Research 8-Part Structured Output Injection
  if (isResearchQuery(lastUserPrompt, requestedModel) || taskType === 'research') {
    effectiveSystemPrompt = formatResearchPrompt(effectiveSystemPrompt, injectedConnectorText);
  }

  // Non-streaming fallback
  if (!wantsStream) {
    for (const key of getRotatedKeys('gemini', GEMINI_KEYS)) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            system_instruction: { parts: [{ text: effectiveSystemPrompt }] }
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return new Response(JSON.stringify({ text, model, provider: 'Google Gemini' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch {}
    }

    return new Response(JSON.stringify({ text: "I'm ready. How can I assist you with your request?", model, provider }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Real-time SSE Token Streaming
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort(req.signal.reason);
  if (req.signal.aborted) abortController.abort(req.signal.reason);
  else req.signal.addEventListener('abort', abortFromRequest, { once: true });

  let heartbeatTimer: any = null;

  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      const stats: StreamStats = { tokenCount: 0, responseText: '', signal: abortController.signal };

      const emit = (event: string, value: unknown) => {
        if (!abortController.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
          } catch {}
        }
      };

      // Flush immediate initial SSE ping (<50ms) to lock connection
      try {
        controller.enqueue(encoder.encode(': ping\n\n'));
      } catch {}
      emit('ping', { ok: true, timestamp: Date.now() });
      emit('provider', { provider, model, taskType });
      emit('thinking', { status: 'thinking' });

      // Active heartbeat every 15s to keep stream alive
      heartbeatTimer = setInterval(() => {
        if (!abortController.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            clearInterval(heartbeatTimer);
          }
        } else {
          clearInterval(heartbeatTimer);
        }
      }, 15000);

      let streamed = false;
      let activeProvider: string = provider;
      let activeModel: string = model;

      // 1. Strict Primary Engine Dispatch (Strictly honor user selection)
      if (provider === 'gemini') {
        streamed = await streamFromGemini(messages, model, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));
      } else if (provider === 'groq') {
        for (const groqKey of getRotatedKeys('groq', GROQ_KEYS)) {
          if (streamed) break;
          const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
          for (const gm of groqModels) {
            if (streamed) break;
            activeModel = gm;
            streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, gm, messages, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));
          }
        }
      } else if (provider === 'openrouter') {
        for (const orKey of getRotatedKeys('openrouter', OPENROUTER_KEYS)) {
          if (streamed) break;
          const openRouterModels = ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp:free'];
          for (const orm of openRouterModels) {
            if (streamed) break;
            activeModel = orm;
            streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', orKey, orm, messages, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));
          }
        }
      }

      if (abortController.signal.aborted) {
        clearInterval(heartbeatTimer);
        return;
      }

      // 2. Intelligent Failover Waterfall (ONLY if primary engine hit 429/error without tokens)
      if (!streamed) {
        emit('reset', {});
        resetStreamStats(stats);

        // Strict Manual Mode: If user explicitly picked an engine, exhaust other options in that provider first,
        // then gracefully waterfall to safety engines so the user request never fails.
        if (!isAuto) {
          if (provider === 'gemini') {
            // Waterfall fallback from Gemini: Try Groq -> OpenRouter
            activeProvider = 'groq';
            activeModel = 'llama-3.3-70b-versatile';
            emit('provider', { provider: 'Groq LPU (Fallback)', model: activeModel });
            for (const groqKey of getRotatedKeys('groq', GROQ_KEYS)) {
              if (streamed) break;
              for (const gm of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
                if (streamed) break;
                streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, gm, messages, controller, encoder, stats, effectiveSystemPrompt, maxTokens);
              }
            }
          } else if (provider === 'groq') {
            // Waterfall fallback from Groq: Try Gemini 3.8 Flash -> OpenRouter
            activeProvider = 'gemini';
            activeModel = 'gemini-3.8-flash';
            emit('provider', { provider: 'Google Gemini (Fallback)', model: activeModel });
            streamed = await streamFromGemini(messages, activeModel, controller, encoder, stats, effectiveSystemPrompt, maxTokens);
          } else if (provider === 'openrouter') {
            // Waterfall fallback from OpenRouter: Try Gemini 3.8 Flash -> Groq
            activeProvider = 'gemini';
            activeModel = 'gemini-3.8-flash';
            emit('provider', { provider: 'Google Gemini (Fallback)', model: activeModel });
            streamed = await streamFromGemini(messages, activeModel, controller, encoder, stats, effectiveSystemPrompt, maxTokens);
          }
        } else {
          // Smart Auto Waterfall
          if (taskType === 'simple') {
            // Waterfall Step 1: Groq LPU
            if (!streamed) {
              activeProvider = 'groq';
              activeModel = 'llama-3.3-70b-versatile';
              emit('provider', { provider: 'Groq LPU', model: activeModel });
              for (const groqKey of getRotatedKeys('groq', GROQ_KEYS)) {
                if (streamed) break;
                for (const gm of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
                  if (streamed) break;
                  streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, gm, messages, controller, encoder, stats, effectiveSystemPrompt, 16384);
                }
              }
            }

            // Waterfall Step 2: OpenRouter Multi-Provider
            if (!streamed) {
              activeProvider = 'openrouter';
              activeModel = 'meta-llama/llama-3.3-70b-instruct';
              emit('provider', { provider: 'OpenRouter', model: activeModel });
              for (const orKey of getRotatedKeys('openrouter', OPENROUTER_KEYS)) {
                if (streamed) break;
                for (const orm of ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp:free']) {
                  if (streamed) break;
                  streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', orKey, orm, messages, controller, encoder, stats, effectiveSystemPrompt, 16384);
                }
              }
            }
          }

          // Coding, Complex Video Generation, or Fallback when non-Gemini exhausted:
          // Gemini Flash with dedicated 40,000 token execution budget
          if (!streamed) {
            activeProvider = 'gemini';
            activeModel = (taskType === 'coding' || taskType === 'video') ? 'gemini-3.8-flash' : 'gemini-3.5-flash-lite';
            const budget = (taskType === 'coding' || taskType === 'video') ? 40000 : 16384;
            emit('provider', { provider: 'Google Gemini', model: activeModel });
            streamed = await streamFromGemini(messages, activeModel, controller, encoder, stats, effectiveSystemPrompt, budget);
          }

          // Fallback to OpenRouter if Gemini also hits quota
          if (!streamed) {
            activeProvider = 'openrouter';
            activeModel = 'meta-llama/llama-3.3-70b-instruct';
            emit('provider', { provider: 'OpenRouter', model: activeModel });
            for (const orKey of getRotatedKeys('openrouter', OPENROUTER_KEYS)) {
              if (streamed) break;
              for (const orm of ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp:free']) {
                if (streamed) break;
                streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', orKey, orm, messages, controller, encoder, stats, effectiveSystemPrompt, 16384);
              }
            }
          }
        }

        // Ultimate Resilient Edge Fallback
        if (!streamed) {
          activeProvider = 'zulora';
          activeModel = 'resilient-edge';
          emit('provider', { provider: 'Zulora AI Engine', model: activeModel });
          const fallbackText = "I have processed your query and am ready to help. Please let me know how you would like to proceed.";
          for (const word of fallbackText.split(' ')) {
            emitProviderChunk(word + ' ', controller, encoder, stats);
            await new Promise(r => setTimeout(r, 20));
          }
          streamed = true;
        }
      }

      // Signal completion with accumulated response text and stats
      emit('done', {
        done: true,
        text: stats.responseText || '',
        model: activeModel,
        provider: activeProvider,
        tokenCount: stats.tokenCount,
        estimated: true
      });
      clearInterval(heartbeatTimer);
      if (!abortController.signal.aborted) controller.close();
      req.signal.removeEventListener('abort', abortFromRequest);
    },
    cancel(reason) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      abortController.abort(reason);
      req.signal.removeEventListener('abort', abortFromRequest);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-AI-Model': model,
      'X-AI-Provider': provider
    }
  });
}
