/**
 * Final targeted patches for route.ts and OpenAI token scaling
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function patch(rel, search, replacement) {
  const full = path.join(ROOT, rel);
  let content = fs.readFileSync(full, 'utf8');
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedSearch = search.replace(/\r\n/g, '\n');
  if (!normalizedContent.includes(normalizedSearch)) {
    console.warn(`  ⚠ Not found in ${rel}: ${normalizedSearch.slice(0,80)}`);
    return false;
  }
  const useCRLF = content.includes('\r\n');
  const updated = normalizedContent.replace(normalizedSearch, replacement.replace(/\r\n/g, '\n'));
  fs.writeFileSync(full, useCRLF ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
  console.log(`  ✓ Patched: ${rel}`);
  return true;
}

// FIX: route.ts — add effortLevel reading after requestedModel
patch('src/app/api/chat/route.ts',
  `  // Model Routing & Task Classification - Strict Binding to Client Selection
  const requestedModel = body.modelId || body.modelPreference || body.model || 'auto';`,
  `  // Model Routing & Task Classification - Strict Binding to Client Selection
  const requestedModel = body.modelId || body.modelPreference || body.model || 'auto';
  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();
  const effortBudget = resolveEffortTokenBudget(effortLevel, taskType === 'coding' || Boolean(body.coding));`
);

// FIX: server/handlers/ai.js — also scale the OpenAI-compat maxTokens
patch('server/handlers/ai.js',
  `          maxTokens: body.guestDemo && !coding ? 2_048 : coding ? CODE_GENERATION_MAX_TOKENS : useProModel || flagship ? 32_768 : 16_384,`,
  `          maxTokens: body.guestDemo && !coding ? 2_048 : Math.max(effortTokenBudget, coding ? CODE_GENERATION_MAX_TOKENS : useProModel || flagship ? 32_768 : 16_384),`
);

console.log('\n✅ Final patches done!');

