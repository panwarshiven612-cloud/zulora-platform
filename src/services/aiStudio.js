/**
 * aiStudio.js — AI Studio Service and Code Generation Engine for Zulora AI
 * Supports single-file HTML/Tailwind CSS/JS generation with animations, glassmorphism, and RTL.
 */
import { AI_STUDIO_SYSTEM_PROMPT, buildAIStudioUserPrompt } from './aiStudioPrompt';
import { preparePreviewDocument } from './previewDocument';

export { AI_STUDIO_SYSTEM_PROMPT, buildAIStudioUserPrompt, preparePreviewDocument };

export function parseArtifact(source) {
  const blocks = [...String(source || '').matchAll(/```\s*([^\r\n]*)\r?\n([\s\S]*?)(?:```|$)/gi)];
  const files = { html: '', css: '', js: '', svg: '' };
  const generatedFiles = {};
  blocks.forEach(([, label, code]) => {
    const parts = label.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const language = parts[0] || '';
    const key = ({ htm: 'html', javascript: 'js', mjs: 'js', typescript: 'js', jsx: 'js', tsx: 'js', xml: 'svg' })[language] || language;
    const namedFile = parts.find(part => /^[a-z0-9_./-]+\.[a-z0-9]+$/i.test(part));
    const defaultNames = { html: 'index.html', css: 'styles.css', js: 'app.js', svg: 'graphic.svg', json: 'package.json', sql: 'schema.sql', python: 'app.py', bash: 'run.sh', yaml: 'config.yml' };
    const fileName = namedFile || defaultNames[key];
    if (fileName) generatedFiles[fileName] = code.trim();
    if (key in files && !files[key]) files[key] = code.trim();
  });
  if (!files.html && !files.svg) {
    const rawHtml = String(source || '').match(/<!doctype html[\s\S]*|<html[\s\S]*/i)?.[0];
    if (rawHtml) files.html = rawHtml.replace(/```\s*$/, '').trim();
  }
  if (files.html && !files.css) files.css = [...files.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim()).join('\n\n');
  if (files.html && !files.js) files.js = [...files.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1].trim()).filter(Boolean).join('\n\n');
  if (files.svg && !files.html) files.html = files.svg;
  let html = files.html || '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Preview is ready</h1><p>The response did not include an HTML document. Review the generated files in Code.</p></main></body></html>';
  if (files.css && !/<style[\s>]/i.test(html)) {
    const style = `<style>\n${files.css}\n</style>`;
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`)
      : /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, `$&${style}`)
        : html.replace(/<\/html>/i, `${style}</html>`);
  }
  if (files.js && !/<script[\s>]/i.test(html)) {
    const script = `<script>\n${files.js}\n<\/script>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`)
      : /<\/html>/i.test(html) ? html.replace(/<\/html>/i, `${script}</html>`) : `${html}${script}`;
  }
  if (!/<html[\s>]/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  return { ...files, generatedFiles, html };
}

export default {
  AI_STUDIO_SYSTEM_PROMPT,
  buildAIStudioUserPrompt,
  preparePreviewDocument,
  parseArtifact
};
