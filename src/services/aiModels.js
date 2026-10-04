export const GEMINI_MODELS = Object.freeze([
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'stable', speed: 'fast' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', tier: 'stable', speed: 'balanced' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', tier: 'stable', speed: 'balanced' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', tier: 'stable', speed: 'fast' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tier: 'stable', speed: 'fastest' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', tier: 'stable', speed: 'fastest' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tier: 'preview', speed: 'reasoning' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', tier: 'preview', speed: 'fast' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'stable', speed: 'fast' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tier: 'stable', speed: 'fastest' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'stable', speed: 'reasoning' }
]);

export const GEMINI_FLASH_MODEL_ID = 'gemini-3.5-flash';
export const GEMINI_FAST_MODEL_ID = 'gemini-3.5-flash-lite';
export const GEMINI_BEST_MODEL_ID = 'gemini-3.8-flash';
export const GEMINI_PRO_MODEL_ID = 'gemini-3.1-pro-preview';
export const GEMINI_PRO_MODEL_FALLBACKS = Object.freeze([
  GEMINI_PRO_MODEL_ID,
  'gemini-2.5-pro'
]);

export const GEMINI_MODEL_FALLBACKS = Object.freeze([
  ...GEMINI_PRO_MODEL_FALLBACKS,
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview'
]);

const GEMINI_MODEL_IDS = new Set(GEMINI_MODELS.map(model => model.id));

export function toGeminiInlineData(attachment) {
  const source = String(attachment?.base64 || '');
  const match = source.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  const mimeType = String(attachment?.mimeType || match?.[1] || '').toLowerCase();
  if (!match || !(/^(?:image\/(?:png|jpe?g|webp|gif)|application\/pdf|video\/(?:mp4|webm|mpeg|quicktime))$/i.test(mimeType))) return null;
  return { mimeType, data: match[2].replace(/\s/g, '') };
}

export function normalizeGeminiModelId(value) {
  const id = String(value || '').trim().toLowerCase();
  return GEMINI_MODEL_IDS.has(id) ? id : null;
}

export function estimateTextTokens(value) {
  return Math.max(0, Math.ceil(String(value || '').length / 4));
}

/**
 * Strict image generation & media viewing intent detection.
 * Matches terms like "show image", "photo of", "picture of", "generate image",
 * "show me apple image", "draw a sunset", etc.
 */
export function isImageGenIntent(value) {
  const p = String(value || '').trim().toLowerCase();
  if (!p) return false;

  // Negative check: coding, HTML tags, or explanatory queries about images
  if (/\b(?:how to|explain|what is|why is|code an? image|html image|img tag|read image|ocr|analyze image|extract text)\b/i.test(p)) {
    return false;
  }

  // 1. Explicit triggers: "show image", "photo of", "picture of", "generate image", "create image", "draw image"
  if (/\b(?:show\s+(?:me\s+)?(?:an?\s+)?image|photo\s+of|picture\s+of|image\s+of|generate\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image|draw\s+(?:an?\s+)?image|make\s+(?:an?\s+)?image|paint\s+(?:an?\s+)?image)\b/i.test(p)) {
    return true;
  }

  // 2. "Show [anything] image/photo/picture" e.g. "show me apple image", "show apple photo", "show sunset picture"
  if (/\bshow\s+(?:me\s+)?.*?\b(?:image|photo|picture|wallpaper|artwork|portrait|drawing|sketch)\b/i.test(p)) {
    return true;
  }

  // 3. "[action] ... [image keyword]" e.g. "generate a red car picture", "create an apple image", "draw a lion"
  if (/\b(?:generate|create|render|draw|paint|design|sketch|make)\b.*?\b(?:image|photo|picture|wallpaper|illustration|artwork|portrait|logo|avatar|drawing)\b/i.test(p)) {
    return true;
  }

  // 4. "Photo of ...", "Picture of ...", "Image of ..." anywhere
  if (/\b(?:photo|picture|image|illustration|painting|wallpaper)\s+of\b/i.test(p)) {
    return true;
  }

  // 5. Short queries ending with image keyword, e.g. "apple image", "cute cat photo", "car wallpaper"
  const words = p.split(/\s+/);
  if (words.length <= 6 && /\b(?:image|photo|picture|wallpaper|artwork)$/i.test(p)) {
    return true;
  }

  return false;
}

export function isCodeGenerationPrompt(value) {
  // Bypasses code generation output if the user is asking for an image!
  if (isImageGenIntent(value)) return false;
  return /(?:\bcode\b|\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b|\bfunction\b|\bfrontend\b|\bweb development\b|\bbuild\s+(?:a\s+)?(?:mobile\s+)?(?:website|web app|application|app|site|ui|tool|dashboard)\b|\bwebsite\b|\bwebpage\b|\bweb app\b|\blanding page\b|\binteractive app\b|\bcomplete application\b|\bportfolio site\b)/i.test(String(value || ''));
}
