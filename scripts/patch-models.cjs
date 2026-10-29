const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'services', 'aiModels.js');
let content = fs.readFileSync(target, 'utf8');

content = content.replace(
  /export const GEMINI_MODELS = Object\.freeze\(\[[\s\S]*?\]\);/,
  `export const GEMINI_MODELS = Object.freeze([
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'stable', speed: 'fast' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tier: 'stable', speed: 'fast' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', tier: 'stable', speed: 'fast' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', tier: 'stable', speed: 'fast' }
]);`
);
content = content.replace(/export const GEMINI_BEST_MODEL_ID = 'gemini-2\.5-pro';/, "export const GEMINI_BEST_MODEL_ID = 'gemini-3.8-flash';");
content = content.replace(/export const GEMINI_PRO_MODEL_ID = 'gemini-2\.5-pro';/, "export const GEMINI_PRO_MODEL_ID = 'gemini-3.8-flash';");
content = content.replace(
  /export const GEMINI_PRO_MODEL_FALLBACKS = Object\.freeze\(\[[\s\S]*?\]\);/,
  `export const GEMINI_PRO_MODEL_FALLBACKS = Object.freeze([
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite'
]);`
);
content = content.replace(
  /export const GEMINI_MODEL_FALLBACKS = Object\.freeze\(\[[\s\S]*?\]\);/,
  `export const GEMINI_MODEL_FALLBACKS = Object.freeze([
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite'
]);`
);
fs.writeFileSync(target, content, 'utf8');
console.log('aiModels.js patched successfully');
