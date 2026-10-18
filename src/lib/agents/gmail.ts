/**
 * gmail.ts — Dynamic Gmail Agent for Zulora AI
 * Allows dynamic email generation tailored to exact user formatting instructions
 * rather than rigid, static pre-made templates.
 */

import connectorManager from '../../services/connectorManager';
import { GEMINI_KEYS } from '../config/keys';

export interface DynamicEmailOptions {
  to: string;
  subject: string;
  body: string;
  formattingInstructions?: string;
  isDraft?: boolean;
}

export interface DynamicEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  isDraft: boolean;
  subject: string;
  to: string;
  htmlContent: string;
  confirmation: string;
  error?: string;
}

/**
 * Convert markdown to clean, inline-styled email HTML
 */
export function markdownToEmailHtml(markdown: string): string {
  let html = String(markdown || '').trim();
  if (!html) return '';

  // Tables
  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
    const lines = match.trim().split(/\r?\n/).filter(l => !/^\|[-:\s|]+\|$/.test(l));
    if (!lines.length) return '';
    const rows = lines.map((line, idx) => {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const tag = idx === 0 ? 'th' : 'td';
      const cellStyle = idx === 0
        ? 'padding:10px 14px;background-color:#f1f5f9;color:#1e293b;font-weight:700;font-size:13px;border-bottom:2px solid #cbd5e1;text-align:left;'
        : 'padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:14px;';
      return `<tr>${cells.map(c => `<${tag} style="${cellStyle}">${c}</${tag}>`).join('')}</tr>`;
    });
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;width:100%;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">${rows.join('')}</table>`;
  });

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 style="margin:18px 0 8px;font-size:16px;font-weight:700;color:#0f172a;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="margin:20px 0 10px;font-size:18px;font-weight:700;color:#0f172a;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="margin:24px 0 12px;font-size:22px;font-weight:700;color:#0f172a;">$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Bullet points
  html = html.replace(/((?:^[-*•]\s+.*(?:\r?\n|$))+)/gm, (match) => {
    const items = match.trim().split(/\r?\n/).map(l => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
    return `<ul style="margin:12px 0;padding-left:24px;color:#334155;">${items.map(i => `<li style="margin-bottom:6px;line-height:1.6;">${i}</li>`).join('')}</ul>`;
  });

  // Numbered lists
  html = html.replace(/((?:^\d+\.\s+.*(?:\r?\n|$))+)/gm, (match) => {
    const items = match.trim().split(/\r?\n/).map(l => l.replace(/^\d+\.\s+/, '').trim()).filter(Boolean);
    return `<ol style="margin:12px 0;padding-left:24px;color:#334155;">${items.map(i => `<li style="margin-bottom:6px;line-height:1.6;">${i}</li>`).join('')}</ol>`;
  });

  // Paragraphs
  const paragraphs = html.split(/\n\s*\n/).map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<table') || p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol')) return p;
    return `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">${p.replace(/\n/g, '<br/>')}</p>`;
  }).filter(Boolean);

  return paragraphs.join('\n');
}

/**
 * Generate customized HTML content dynamically matching specific formatting instructions
 */
export async function generateDynamicHtmlEmail(
  subject: string,
  body: string,
  instructions?: string
): Promise<string> {
  const needsAiFormatting = Boolean(instructions && instructions.trim().length > 5);

  if (needsAiFormatting) {
    const prompt = `You are an expert email layout designer.
Convert the following email draft into rich, modern, responsive email-safe HTML matching these exact formatting instructions:
"${instructions}"

Subject: ${subject}
Content:
${body}

CRITICAL RULES:
1. Strictly follow all user formatting requests (e.g. table, bullet list, header styling, tone, signature).
2. Do NOT use static templates. Output clean inline CSS compatible with Gmail.
3. Return ONLY the HTML markup for the body container. No markdown code fences.`;

    for (const key of GEMINI_KEYS) {
      if (!key) continue;
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
          })
        });
        if (res.ok) {
          const data = await res.json();
          let generated = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          generated = generated.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
          if (generated) return generated;
        }
      } catch {}
    }
  }

  // Fallback / standard dynamic conversion from markdown
  return markdownToEmailHtml(body);
}

/**
 * Main dynamic Gmail agent executor
 */
export async function executeDynamicEmail(options: DynamicEmailOptions): Promise<DynamicEmailResult> {
  const { to, subject, body, formattingInstructions, isDraft = false } = options;

  if (!to || !to.trim()) {
    return {
      success: false,
      isDraft,
      subject,
      to,
      htmlContent: '',
      confirmation: 'Recipient email address is required.',
      error: 'Missing recipient'
    };
  }

  try {
    const htmlContent = await generateDynamicHtmlEmail(subject, body, formattingInstructions);

    if (isDraft) {
      const res = await connectorManager.createGmailDraft({
        to,
        subject,
        body: htmlContent
      });
      return {
        success: true,
        messageId: res.id,
        isDraft: true,
        subject,
        to,
        htmlContent,
        confirmation: `Created Gmail draft for ${to} with custom layout: "${subject}".`
      };
    }

    const res = await connectorManager.sendGmailMessage({
      to,
      subject,
      body: htmlContent,
      htmlContent
    });

    return {
      success: true,
      messageId: res.messageId || res.id,
      threadId: res.threadId,
      isDraft: false,
      subject,
      to,
      htmlContent,
      confirmation: `Delivered email to ${to}: "${subject}".`
    };
  } catch (error: any) {
    return {
      success: false,
      isDraft,
      subject,
      to,
      htmlContent: '',
      confirmation: `Gmail operation failed: ${error.message}`,
      error: error.message
    };
  }
}

export default {
  executeDynamicEmail,
  generateDynamicHtmlEmail,
  markdownToEmailHtml
};

