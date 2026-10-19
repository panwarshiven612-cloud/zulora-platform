import { GEMINI_KEYS, GROQ_KEYS, CEREBRAS_KEYS, OPENROUTER_KEYS, MISTRAL_KEYS } from '../../../lib/config/keys';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export interface RouteModelConfig {
  provider: 'gemini' | 'groq' | 'cerebras' | 'openrouter' | 'mistral';
  model: string;
  isAuto: boolean;
}

export function normalizeRequestedModel(modelName: string = 'auto'): RouteModelConfig {
  const raw = String(modelName || 'auto').trim().toLowerCase();
  
  // Thinking & Reasoning Models (Zulora 3.1 Pro Ultra)
  if (raw === 'pro_ultra' || raw === 'zulora-3.1-pro-ultra' || raw.includes('pro ultra') || raw === 'gemini-2.5-pro' || raw === '2.5-pro' || raw === 'pro' || raw === 'think') {
    return { provider: 'gemini', model: 'gemini-2.5-pro', isAuto: false };
  }
  
  // Gemini fast tier models
  if (raw === 'gemini-3.8-flash' || raw === '3.8-flash' || raw === '3.8 flash') {
    return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: false };
  }
  if (raw === 'gemini-3.5-flash-lite' || raw === '3.5-lite' || raw === '3.5 flash lite') {
    return { provider: 'gemini', model: 'gemini-3.5-flash-lite', isAuto: false };
  }
  if (raw === 'gemini-3.1-flash-lite' || raw === '3.1-lite' || raw === '3.1 flash lite') {
    return { provider: 'gemini', model: 'gemini-3.1-flash-lite', isAuto: false };
  }
  if (raw === 'gemini-3.6-flash' || raw === '3.6-flash') {
    return { provider: 'gemini', model: 'gemini-3.6-flash', isAuto: false };
  }
  if (raw === 'gemini-2.5-flash' || raw === '2.5-flash') {
    return { provider: 'gemini', model: 'gemini-2.5-flash', isAuto: false };
  }
  if (raw === 'gemini' || raw === 'flash') {
    return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: false };
  }
  if (raw.startsWith('gemini-')) {
    return { provider: 'gemini', model: raw, isAuto: false };
  }

  // LPUs and External Engines
  if (raw === 'groq' || raw.includes('llama')) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile', isAuto: false };
  }
  if (raw === 'cerebras') {
    return { provider: 'cerebras', model: 'llama3.1-70b', isAuto: false };
  }
  if (raw === 'openrouter') {
    return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', isAuto: false };
  }
  if (raw === 'mistral') {
    return { provider: 'mistral', model: 'mistral-small-latest', isAuto: false };
  }

  // Auto defaults to Gemini 3.8 Flash with full waterfall
  return { provider: 'gemini', model: 'gemini-3.8-flash', isAuto: true };
}

interface StreamStats {
  tokenCount: number;
}

async function streamFromGemini(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  stats: StreamStats
): Promise<boolean> {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

  const systemMessage = messages.find(m => m.role === 'system')?.content;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
      
      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => fetchController.abort(), 3500);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
          ...(systemMessage ? { system_instruction: { parts: [{ text: systemMessage }] } } : {}),
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: model === 'gemini-2.5-pro' ? 16384 : 8192
          }
        }),
        signal: fetchController.signal
      });

      clearTimeout(timeoutId);

      // Only failover if rate limited or server error
      if (res.status === 429 || res.status >= 500 || !res.ok || !res.body) {
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
                // Word-by-word token chunking for live real-time response
                const words = textChunk.split(/(\s+)/);
                for (const word of words) {
                  if (!word) continue;
                  stats.tokenCount += 1;
                  controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: word, tokenCount: stats.tokenCount })}\n\n`));
                }
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
      // try next key on connection error or timeout
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
  stats: StreamStats
): Promise<boolean> {
  try {
    const fetchController = new AbortController();
    const timeoutId = setTimeout(() => fetchController.abort(), 3500);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 8192
      }),
      signal: fetchController.signal
    });

    clearTimeout(timeoutId);

    if (res.status === 429 || res.status >= 500 || !res.ok || !res.body) return false;

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
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              receivedAnyToken = true;
              const words = token.split(/(\s+)/);
              for (const word of words) {
                if (!word) continue;
                stats.tokenCount += 1;
                controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: word, tokenCount: stats.tokenCount })}\n\n`));
              }
            }
          } catch {}
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
    modelPreference?: string;
    stream?: boolean;
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
  
  // Context isolation: clean stale tool tags while preserving natural text dialogue
  const messages = rawMessages.map((m: { role?: string; content?: string }, idx: number) => {
    const isCurrentPrompt = idx === rawMessages.length - 1;
    let content = String(m.content || '');
    if (!isCurrentPrompt) {
      content = content.replace(/\[\s*(?:send_email|sheets_create|drive_upload)[\s\S]*?\]/gi, '');
    }
    return { role: m.role || 'user', content };
  });

  const requestedModel = body.modelPreference || body.model || 'auto';
  const { provider, model, isAuto } = normalizeRequestedModel(requestedModel);
  const wantsStream = body.stream !== false;

  if (!wantsStream) {
    for (const key of GEMINI_KEYS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
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
    return new Response(JSON.stringify({ text: 'All providers are currently unavailable. Please retry in a moment.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Real-time SSE Token Streaming with live word-by-word streaming & token tracking
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      const stats: StreamStats = { tokenCount: 0 };

      // Sub-second initial response emission (<100ms)
      controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider, model })}\n\n`));
      controller.enqueue(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ stage: 'Analyzing query and reasoning in real time...', tokenCount: 0 })}\n\n`));

      let streamed = false;

      // 1. Execute user's manually chosen engine first
      if (provider === 'gemini') {
        streamed = await streamFromGemini(messages, model, controller, encoder, stats);
      } else if (provider === 'groq' && GROQ_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', GROQ_KEYS[0], model, messages, controller, encoder, stats);
      } else if (provider === 'cerebras' && CEREBRAS_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://api.cerebras.ai/v1/chat/completions', CEREBRAS_KEYS[0], model, messages, controller, encoder, stats);
      } else if (provider === 'openrouter' && OPENROUTER_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEYS[0], model, messages, controller, encoder, stats);
      } else if (provider === 'mistral' && MISTRAL_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://api.mistral.ai/v1/chat/completions', MISTRAL_KEYS[0], model, messages, controller, encoder, stats);
      }

      // 2. Waterfall Fallback: Only activates if primary provider returned 429/500 rate limit or failure
      if (!streamed) {
        controller.enqueue(encoder.encode(`event: reset\ndata: {}\n\n`));
        
        // Waterfall Step 1: Gemini 3.8 Flash
        if (model !== 'gemini-3.8-flash') {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Google Gemini (Waterfall)', model: 'gemini-3.8-flash' })}\n\n`));
          streamed = await streamFromGemini(messages, 'gemini-3.8-flash', controller, encoder, stats);
        }

        // Waterfall Step 2: Groq Llama 3.3 70B
        if (!streamed && GROQ_KEYS[0]) {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Groq LPU (Waterfall)', model: 'llama-3.3-70b-versatile' })}\n\n`));
          streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', GROQ_KEYS[0], 'llama-3.3-70b-versatile', messages, controller, encoder, stats);
        }

        // Waterfall Step 3: Cerebras Llama 3.1 70B
        if (!streamed && CEREBRAS_KEYS[0]) {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Cerebras (Waterfall)', model: 'llama3.1-70b' })}\n\n`));
          streamed = await streamFromOpenAiCompatible('https://api.cerebras.ai/v1/chat/completions', CEREBRAS_KEYS[0], 'llama3.1-70b', messages, controller, encoder, stats);
        }

        // Waterfall Step 4: OpenRouter
        if (!streamed && OPENROUTER_KEYS[0]) {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'OpenRouter (Waterfall)', model: 'meta-llama/llama-3.3-70b-instruct' })}\n\n`));
          streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEYS[0], 'meta-llama/llama-3.3-70b-instruct', messages, controller, encoder, stats);
        }

        // Waterfall Step 5: Mistral
        if (!streamed && MISTRAL_KEYS[0]) {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Mistral (Waterfall)', model: 'mistral-small-latest' })}\n\n`));
          streamed = await streamFromOpenAiCompatible('https://api.mistral.ai/v1/chat/completions', MISTRAL_KEYS[0], 'mistral-small-latest', messages, controller, encoder, stats);
        }

        // Waterfall Step 6: Gemini 3.5 Flash-Lite
        if (!streamed) {
          controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Gemini 3.5 Flash-Lite (Fallback)', model: 'gemini-3.5-flash-lite' })}\n\n`));
          streamed = await streamFromGemini(messages, 'gemini-3.5-flash-lite', controller, encoder, stats);
        }
      }

      // Signal completion with token count
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ done: true, model, provider, tokenCount: stats.tokenCount })}\n\n`));
      controller.close();
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
