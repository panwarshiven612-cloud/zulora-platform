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

export function normalizeGeminiModelId(value) {
  const id = String(value || '').trim().toLowerCase();
  return GEMINI_MODEL_IDS.has(id) ? id : null;
}

export function estimateTextTokens(value) {
  return Math.max(0, Math.ceil(String(value || '').length / 4));
}

export function isCodeGenerationPrompt(value) {
  return /(?:\bcode\b|\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b|\bfunction\b|\bfrontend\b|\bweb development\b|\bbuild\s+(?:a\s+)?(?:mobile\s+)?(?:website|web app|application|app|site|ui|tool|dashboard)\b|\bwebsite\b|\bwebpage\b|\bweb app\b|\blanding page\b|\binteractive app\b|\bcomplete application\b|\bportfolio site\b)/i.test(String(value || ''));
}
