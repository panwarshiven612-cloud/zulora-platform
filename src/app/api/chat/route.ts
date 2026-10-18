import { GEMINI_KEYS, GROQ_KEYS, CEREBRAS_KEYS, OPENROUTER_KEYS } from '../../../lib/config/keys';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function normalizeRequestedModel(modelName: string = 'auto'): { provider: string; model: string } {
  const raw = String(modelName || 'auto').trim().toLowerCase();
  
  // Tier 1: Light & Low Cost
  if (raw === 'gemini-3.5-flash-lite' || raw === '3.5-lite' || raw === '3.5 lite') {
    return { provider: 'gemini', model: 'gemini-3.5-flash-lite' };
  }
  if (raw === 'gemini-3.1-flash-lite' || raw === '3.1-lite' || raw === '3.1 lite') {
    return { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
  }

  // Tier 2: Thinking & Reasoning Models
  if (raw === 'gemini-2.5-pro' || raw === '2.5-pro' || raw === 'pro' || raw === 'think') {
    return { provider: 'gemini', model: 'gemini-2.5-pro' };
  }
  if (raw === 'gemini-3.6-flash' || raw === '3.6-flash' || raw === '3.6 flash') {
    return { provider: 'gemini', model: 'gemini-3.6-flash' };
  }

  // Tier 3: Complex / Auto / Third-Party LPUs
  if (raw === 'groq' || raw.includes('llama')) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
  }
  if (raw === 'cerebras') {
    return { provider: 'cerebras', model: 'llama3.1-70b' };
  }
  if (raw === 'openrouter') {
    return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct' };
  }
  if (raw.startsWith('gemini-')) {
    return { provider: 'gemini', model: raw };
  }

  // Auto defaults to fastest flagship
  return { provider: 'gemini', model: 'gemini-3.8-flash' };
}

async function streamFromGemini(
  messages: Array<{ role: string; content: string }>,
  model: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
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
        })
      });

      if (!res.ok || !res.body) {
        continue; // Try next key
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                // Send standard SSE data packet
                controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: textChunk })}\n\n`));
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      }
      return true;
    } catch {
      // try next key
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
  encoder: TextEncoder
): Promise<boolean> {
  try {
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
      })
    });

    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
              controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`));
            }
          } catch {}
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: String(body.prompt || '') }];
  const requestedModel = body.modelPreference || body.model || 'auto';
  const { provider, model } = normalizeRequestedModel(requestedModel);
  const wantsStream = body.stream !== false;

  if (!wantsStream) {
    // Non-streaming fallback if explicitly requested
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

  // Streaming Response via ReadableStream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      // Send initial connect notification
      controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider, model })}\n\n`));

      let streamed = false;

      // 1. Try selected provider
      if (provider === 'gemini') {
        streamed = await streamFromGemini(messages, model, controller, encoder);
      } else if (provider === 'groq' && GROQ_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', GROQ_KEYS[0], model, messages, controller, encoder);
      } else if (provider === 'cerebras' && CEREBRAS_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://api.cerebras.ai/v1/chat/completions', CEREBRAS_KEYS[0], model, messages, controller, encoder);
      } else if (provider === 'openrouter' && OPENROUTER_KEYS[0]) {
        streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEYS[0], model, messages, controller, encoder);
      }

      // 2. Fallback to Gemini pool if primary provider failed
      if (!streamed && provider !== 'gemini') {
        controller.enqueue(encoder.encode(`event: provider\ndata: ${JSON.stringify({ provider: 'Google Gemini (Fallback)', model: 'gemini-3.8-flash' })}\n\n`));
        streamed = await streamFromGemini(messages, 'gemini-3.8-flash', controller, encoder);
      }

      // 3. Fallback to Gemini 3.5 Flash-Lite if still not streamed
      if (!streamed) {
        streamed = await streamFromGemini(messages, 'gemini-3.5-flash-lite', controller, encoder);
      }

      // Signal completion
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ done: true, model, provider })}\n\n`));
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

