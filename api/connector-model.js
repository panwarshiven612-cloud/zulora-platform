import { verifyRequestUser } from './ai.js';
import { apiKeyPool, availableProviders } from './apiKeyPool.js';

export const maxDuration = 30;
export const config = { maxDuration };

const reply = (res, status, message) => res.status(status).json({ error: message });
const CHAT_ORDER = ['gemini', 'groq', 'cerebras', 'openrouter', 'mistral'];
const CONFIG = {
  groq: { label: 'Groq LPU', url: 'https://api.groq.com/openai/v1/chat/completions', model: process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile' },
  cerebras: { label: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', model: process.env.CEREBRAS_CHAT_MODEL || 'llama-3.3-70b' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: process.env.OPENROUTER_CHAT_MODEL || 'meta-llama/llama-3.3-70b-instruct' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', model: process.env.MISTRAL_CHAT_MODEL || 'mistral-large-latest' }
};

function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length > 40) throw new Error('Invalid connector conversation.');
  return value.map(message => {
    const role = ['system', 'user', 'assistant', 'tool'].includes(message?.role) ? message.role : '';
    if (!role) throw new Error('Invalid connector conversation.');
    if (role === 'assistant' && Array.isArray(message.tool_calls)) return {
      role,
      content: typeof message.content === 'string' ? message.content.slice(0, 12_000) : null,
      tool_calls: message.tool_calls.slice(0, 12).map(call => ({
        id: String(call.id || '').slice(0, 100),
        type: 'function',
        function: { name: String(call.function?.name || '').slice(0, 64), arguments: String(call.function?.arguments || '{}').slice(0, 8_000) }
      }))
    };
    return {
      role,
      ...(message.name ? { name: String(message.name).slice(0, 64) } : {}),
      ...(message.tool_call_id ? { tool_call_id: String(message.tool_call_id).slice(0, 100) } : {}),
      content: typeof message.content === 'string' ? message.content.slice(0, 12_000) : ''
    };
  });
}

function normalizeTools(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw new Error('Invalid connector tool definitions.');
  return value.map(item => {
    const tool = item?.function || item;
    const name = String(tool?.name || '');
    if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('Invalid connector tool definitions.');
    const parameters = tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters)
      ? tool.parameters : { type: 'object', properties: {} };
    return { name, description: String(tool.description || '').slice(0, 1_000), parameters };
  });
}

function geminiSchema(schema) {
  const output = {};
  if (schema?.type) output.type = String(schema.type).toUpperCase();
  if (schema?.description) output.description = String(schema.description);
  if (Array.isArray(schema?.enum)) output.enum = schema.enum;
  if (Array.isArray(schema?.required) && schema.required.length) output.required = schema.required;
  if (schema?.properties && typeof schema.properties === 'object') {
    output.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, geminiSchema(value)]));
  }
  if (schema?.items) output.items = geminiSchema(schema.items);
  return output;
}

function parseArguments(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || {}; }
  catch { return {}; }
}

function toGeminiContents(messages) {
  const contents = [];
  const toolNames = new Map();
  for (const message of messages.filter(item => item.role !== 'system')) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const parts = message.tool_calls.map(call => {
        const name = call.function.name;
        toolNames.set(call.id, name);
        return { functionCall: { name, args: parseArguments(call.function.arguments) } };
      });
      contents.push({ role: 'model', parts });
    } else if (message.role === 'tool') {
      const name = message.name || toolNames.get(message.tool_call_id);
      if (!name) continue;
      contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { result: parseArguments(message.content) } } }] });
    } else {
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(message.content || '') }]
      });
    }
  }
  return contents.length ? contents : [{ role: 'user', parts: [{ text: 'Continue the connector task.' }] }];
}

function preferredProvider(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('groq') || text.includes('llama') || text.includes('turbo')) return 'groq';
  if (text.includes('cerebras')) return 'cerebras';
  if (text.includes('openrouter')) return 'openrouter';
  if (text.includes('mistral')) return 'mistral';
  return 'gemini';
}

async function fetchJson(url, options, timeoutMs = 18_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}

async function callGemini(messages, tools) {
  const modelPreference = String(messages.find(message => message.role === 'system')?.model || '');
  const model = /^gemini-[A-Za-z0-9.-]+$/.test(modelPreference) ? modelPreference : 'gemini-2.5-flash';
  const system = messages.find(message => message.role === 'system')?.content || '';
  for (const { key, index } of apiKeyPool.candidates('gemini')) {
    try {
      const response = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: toGeminiContents(messages),
          ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
          tools: [{ functionDeclarations: tools.map(tool => ({ ...tool, parameters: geminiSchema(tool.parameters) })) }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { temperature: 0.35, maxOutputTokens: 2_048 }
        })
      });
      if (response.ok) {
        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const calls = parts.filter(part => part.functionCall?.name).map((part, callIndex) => ({
          id: `gemini_call_${Date.now()}_${callIndex}`,
          type: 'function',
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
        }));
        apiKeyPool.succeeded('gemini', index);
        return {
          provider: 'Google Gemini', model,
          assistantMessage: { role: 'assistant', content: parts.map(part => part.text || '').join('').trim(), ...(calls.length ? { tool_calls: calls } : {}) },
          tokenUsage: { totalTokens: Number(data.usageMetadata?.totalTokenCount) || 0 }
        };
      }
      apiKeyPool.failed('gemini', index, Number(response.headers.get('retry-after')) * 1_000 || 0);
    } catch (error) {
      console.warn('Gemini connector request failed:', error?.name || 'request failed');
      apiKeyPool.failed('gemini', index);
    }
  }
  return null;
}

async function callOpenAiProvider(provider, messages, tools) {
  const config = CONFIG[provider];
  for (const { key, index } of apiKeyPool.candidates(provider)) {
    try {
      const response = await fetchJson(config.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(message => message.role === 'tool' ? { ...message, content: message.content || '{}' } : message),
          tools: tools.map(tool => ({ type: 'function', function: tool })),
          tool_choice: 'auto', temperature: 0.35, max_tokens: 2_048
        })
      });
      if (response.ok) {
        const data = await response.json();
        const assistantMessage = data.choices?.[0]?.message;
        if (!assistantMessage) throw new Error('Empty provider response.');
        apiKeyPool.succeeded(provider, index);
        return { provider: config.label, model: config.model, assistantMessage, tokenUsage: { totalTokens: Number(data.usage?.total_tokens) || 0 } };
      }
      apiKeyPool.failed(provider, index, Number(response.headers.get('retry-after')) * 1_000 || 0);
    } catch (error) {
      console.warn(`${config.label} connector request failed:`, error?.name || 'request failed');
      apiKeyPool.failed(provider, index);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, 'Method not allowed.');
  if (!await verifyRequestUser(req).catch(() => null)) return reply(res, 401, 'Sign in to use connected tools.');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return reply(res, 400, 'Invalid connector request.'); }
  }
  let messages;
  let tools;
  try {
    messages = normalizeMessages(body?.messages);
    tools = normalizeTools(body?.tools);
  } catch {
    return reply(res, 400, 'Invalid connector request.');
  }
  const preference = String(body?.modelPreference || 'auto').slice(0, 120);
  const order = preferredProvider(preference);
  const providers = [order, ...CHAT_ORDER.filter(provider => provider !== order)];
  const system = messages.find(message => message.role === 'system');
  const modelHint = /^gemini-[A-Za-z0-9.-]+$/.test(String(body?.model || '')) ? String(body.model) : preference;
  if (system) system.model = modelHint;
  else messages.unshift({ role: 'system', content: '', model: modelHint });

  for (const provider of providers) {
    if (provider === 'gemini') {
      const result = await callGemini(messages, tools);
      if (result) return res.status(200).json(result);
    } else if (availableProviders().includes(provider)) {
      const result = await callOpenAiProvider(provider, messages, tools);
      if (result) return res.status(200).json(result);
    }
  }
  return reply(res, 503, 'The connector model could not complete the request.');
}
