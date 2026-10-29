/**
 * Fix route.ts variable ordering and wire effortBudget into stream calls
 * Fix apiRouter.js chatPayload flagship line
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function patch(rel, search, replacement) {
  const full = path.join(ROOT, rel);
  let content = fs.readFileSync(full, 'utf8');
  const n = content.replace(/\r\n/g, '\n');
  const s = search.replace(/\r\n/g, '\n');
  if (!n.includes(s)) {
    console.warn(`  ⚠ Not found in ${rel}: "${s.slice(0,70)}"`);
    return false;
  }
  const useCRLF = content.includes('\r\n');
  const updated = n.replace(s, replacement.replace(/\r\n/g, '\n'));
  fs.writeFileSync(full, useCRLF ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
  console.log(`  ✓ Patched: ${rel}`);
  return true;
}

// FIX 1: route.ts — reorder so resolved comes before effortBudget uses taskType
// Currently: effortLevel/effortBudget defined (line 322-323) before resolved (325), 
// so taskType is undefined at that point. Move effortBudget calculation AFTER resolved.
patch('src/app/api/chat/route.ts',
  `  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();\n  const effortBudget = resolveEffortTokenBudget(effortLevel, taskType === 'coding' || Boolean(body.coding));\n  const resolved = resolveModelRoute(requestedModel, lastUserPrompt, Boolean(body.driveContext));\n  const { provider, model, isAuto, maxTokens, taskType } = resolved;`,
  `  const resolved = resolveModelRoute(requestedModel, lastUserPrompt, Boolean(body.driveContext));\n  const { provider, model, isAuto, maxTokens, taskType } = resolved;\n  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();\n  const effortBudget = resolveEffortTokenBudget(effortLevel, taskType === 'coding' || Boolean(body.coding));`
);

// FIX 2: route.ts — wire effortBudget into the primary gemini stream call
patch('src/app/api/chat/route.ts',
  `        streamed = await streamFromGemini(messages, model, controller, encoder, stats, effectiveSystemPrompt, maxTokens);`,
  `        streamed = await streamFromGemini(messages, model, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));`
);

// FIX 3: route.ts — wire effortBudget into groq stream call
patch('src/app/api/chat/route.ts',
  `            streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, gm, messages, controller, encoder, stats, effectiveSystemPrompt, maxTokens);`,
  `            streamed = await streamFromOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, gm, messages, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));`
);

// FIX 4: route.ts — wire effortBudget into openrouter stream call
patch('src/app/api/chat/route.ts',
  `            streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', orKey, orm, messages, controller, encoder, stats, effectiveSystemPrompt, maxTokens);`,
  `            streamed = await streamFromOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', orKey, orm, messages, controller, encoder, stats, effectiveSystemPrompt, Math.max(maxTokens, effortBudget));`
);

// FIX 5: apiRouter.js — fix the flagship/effortLevel chatPayload line (may have dupe 'flagship')
const routerContent = fs.readFileSync(path.join(ROOT, 'src/services/apiRouter.js'), 'utf8');
const rNorm = routerContent.replace(/\r\n/g, '\n');
if (!rNorm.includes('effortLevel: options.effortLevel')) {
  patch('src/services/apiRouter.js',
    `          flagship\n        };`,
    `          flagship,\n          effortLevel: options.effortLevel || 'medium',\n          effortTokenBudget: resolveTokenBudget(options.effortLevel || 'medium', coding, false)\n        };`
  );
}

console.log('\n✅ Route.ts ordering + stream wiring + apiRouter effort fixes done!');

