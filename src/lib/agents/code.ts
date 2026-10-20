/**
 * code.ts — High-Token Production Website & Media Code Generation Agent
 * ======================================================================
 * Handles website, component, and motion graphics generation with
 * 32K+ token capacity, glassmorphic design, zero truncation.
 */

import { GEMINI_KEYS, GROQ_KEYS } from '../config/keys';

export interface CodeGenerationOptions {
  prompt: string;
  type?: 'website' | 'component' | 'motion' | 'general';
  maxTokens?: number;
  stream?: boolean;
  model?: string;
}

export interface CodeGenerationResult {
  success: boolean;
  code?: string;
  language?: string;
  filename?: string;
  downloadUrl?: string;
  error?: string;
  tokenCount?: number;
}

// Detect intent type from prompt
export function detectCodeType(prompt: string): 'website' | 'component' | 'motion' | 'general' {
  const p = String(prompt || '').toLowerCase();
  if (/\b(website|landing page|web app|html page|single.?page|portfolio|product page)\b/.test(p)) return 'website';
  if (/\b(animation|motion|kinetic|video|mp4|canvas|animated|lottie)\b/.test(p)) return 'motion';
  if (/\b(component|widget|card|button|navbar|sidebar|modal|dropdown)\b/.test(p)) return 'component';
  return 'general';
}

// Build a detailed system prompt for production-grade website generation
function buildWebsiteSystemPrompt(type: string): string {
  if (type === 'website') {
    return `You are an expert full-stack web developer and UI/UX designer specializing in production-ready, glassmorphic web applications.

MANDATORY RULES:
1. Generate a COMPLETE, single-file HTML document with embedded CSS and JavaScript. Never truncate.
2. Use modern glassmorphism design: frosted glass panels (backdrop-filter: blur), gradient backgrounds, subtle shadows, rounded corners.
2a. For visual styling, use a Pearl & Azure palette with pearl white surfaces, translucent glass panels, azure and sky-blue accents, and polished mobile layouts.
2b. This Pearl & Azure palette takes priority over any different color examples below.
3. Include ALL sections the user requested — never say "continued below" or leave placeholders.
4. Use responsive design with CSS Grid/Flexbox. Mobile-first approach.
5. Embed beautiful animations: CSS keyframes, smooth transitions, hover effects.
6. Typography: Use Google Fonts (Inter or Poppins) via CDN link. 
7. Use the Pearl & Azure palette throughout: pearl white and translucent glass surfaces, pale blue-gray backgrounds, and azure or sky-blue accents. Use deep navy only for contrast where the brief calls for it.
8. Include working navigation, hero section, features, call-to-action, and footer as appropriate.
9. Output ONLY the raw HTML code starting with <!DOCTYPE html>. No explanations outside code blocks.
10. Never truncate. Produce the complete file. If you must be long, be long — this is production.`;
  }
  if (type === 'motion') {
    return `You are a canvas animation and motion graphics specialist.
Generate fully working, self-contained HTML5 Canvas or CSS animation code.
Include smooth 60fps animations, particle systems, or kinetic typography as requested.
Output only complete, runnable HTML. Never truncate.`;
  }
  if (type === 'component') {
    return `You are a UI component architect. Generate production-ready, standalone HTML/CSS/JS component code.
Use modern glassmorphism aesthetics, smooth animations, and accessible markup.
Output only complete, runnable code. Never truncate.`;
  }
  return `You are an expert software engineer. Generate complete, production-ready code as requested.
Never truncate your output. Produce the full implementation.`;
}

// Generate high-token code via Gemini with up to 32K output tokens
export async function generateCode(options: CodeGenerationOptions): Promise<CodeGenerationResult> {
  const {
    prompt,
    type: typeHint,
    maxTokens = 32768,
    model = 'gemini-2.5-pro'
  } = options;

  const type = typeHint || detectCodeType(prompt);
  const systemPrompt = buildWebsiteSystemPrompt(type);
  const outputTokenLimit = type === 'website' ? Math.min(32768, Math.max(16384, maxTokens)) : maxTokens;

  const userMessage = `${prompt}\n\nIMPORTANT: Generate the COMPLETE code without any truncation. Output a production-ready, fully working implementation.`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: outputTokenLimit,
            stopSequences: []
          }
        })
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) continue;
        throw new Error(`Gemini API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawCode = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const tokenCount = data.usageMetadata?.candidatesTokenCount || 0;

      if (!rawCode) continue;

      // Strip code fences if wrapped
      const code = rawCode
        .replace(/^```(?:html|javascript|css|typescript|tsx?|jsx?)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const extension = type === 'website' || type === 'motion' || type === 'component' ? 'html' : 'txt';
      const filename = `zulora-${type}-${Date.now()}.${extension}`;

      // Generate a client-side downloadable blob URL
      const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);

      return {
        success: true,
        code,
        language: extension,
        filename,
        downloadUrl,
        tokenCount
      };
    } catch (err: any) {
      console.warn('[CodeAgent] Gemini key failed:', err.message);
      continue;
    }
  }

  // Fallback to Groq for simpler code tasks
  if (GROQ_KEYS[0]) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEYS[0]}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.8,
          max_tokens: outputTokenLimit,
          stream: false
        })
      });
      if (response.ok) {
        const data = await response.json();
        const rawCode = data.choices?.[0]?.message?.content || '';
        const code = rawCode
          .replace(/^```(?:html|javascript|css)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        if (code) {
          const filename = `zulora-${type}-${Date.now()}.html`;
          const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
          return {
            success: true,
            code,
            language: 'html',
            filename,
            downloadUrl: URL.createObjectURL(blob)
          };
        }
      }
    } catch (err: any) {
      console.warn('[CodeAgent] Groq fallback failed:', err.message);
    }
  }

  return {
    success: false,
    error: 'All code generation providers failed. Please retry.'
  };
}

// Stream high-token website code via Gemini SSE
export async function* streamCode(options: CodeGenerationOptions): AsyncGenerator<string> {
  const {
    prompt,
    type: typeHint,
    maxTokens = 32768,
    model = 'gemini-2.5-pro'
  } = options;

  const type = typeHint || detectCodeType(prompt);
  const systemPrompt = buildWebsiteSystemPrompt(type);
  const outputTokenLimit = type === 'website' ? Math.min(32768, Math.max(16384, maxTokens)) : maxTokens;
  const userMessage = `${prompt}\n\nIMPORTANT: Generate the COMPLETE code without any truncation.`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: outputTokenLimit }
        })
      });

      if (!response.ok || !response.body) {
        if (response.status === 429 || response.status >= 500) continue;
        break;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedAny = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(jsonStr);
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              receivedAny = true;
              yield text;
            }
          } catch {}
        }
      }

      if (receivedAny) return;
    } catch (err: any) {
      console.warn('[CodeAgent] Stream key failed:', err.message);
    }
  }
}

export default {
  generateCode,
  streamCode,
  detectCodeType
};

