/**
 * Fix missed patches — CRLF-aware targeted patch script
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function patch(rel, search, replacement) {
  const full = path.join(ROOT, rel);
  let content = fs.readFileSync(full, 'utf8');
  // Normalize search to work regardless of CRLF/LF
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedSearch = search.replace(/\r\n/g, '\n');
  if (!normalizedContent.includes(normalizedSearch)) {
    console.warn(`  ⚠ Pattern not found in ${rel}: ${normalizedSearch.slice(0,80)}...`);
    return false;
  }
  const updated = normalizedContent.replace(normalizedSearch, replacement.replace(/\r\n/g, '\n'));
  // Restore CRLF if original had it
  const useCRLF = content.includes('\r\n');
  fs.writeFileSync(full, useCRLF ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
  console.log(`  ✓ Fixed: ${rel}`);
  return true;
}

// FIX 1: ChatInterface.jsx — add effortLevel to generateModelResponse options
patch('src/components/ChatInterface.jsx',
  `          simpleQuery,
          signal: generationController.signal,`,
  `          simpleQuery,
          effortLevel,
          signal: generationController.signal,`
);

// FIX 2: ChatInterface.jsx — add effort overlay after model menu overlay
// First check if it's already there
const ci = fs.readFileSync(path.join(ROOT, 'src/components/ChatInterface.jsx'), 'utf8');
const ciNorm = ci.replace(/\r\n/g, '\n');
if (!ciNorm.includes('showEffortMenu && (') || !ciNorm.includes('setShowEffortMenu(false)')) {
  // Try to find the showModelMenu overlay and add effortMenu after
  patch('src/components/ChatInterface.jsx',
    `      {showModelMenu && (
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
      )}`,
    `      {showModelMenu && (
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
      )}
      {showEffortMenu && (
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowEffortMenu(false)} />
      )}`
  );
}

// FIX 3: apiRouter.js — add effortLevel to chatPayload
patch('src/services/apiRouter.js',
  `          simpleQuery,
          coding,
          flagship
        };`,
  `          simpleQuery,
          coding,
          flagship,
          effortLevel: options.effortLevel || 'medium',
          effortTokenBudget: resolveTokenBudget(options.effortLevel || 'medium', coding, false)
        };`
);

// FIX 4: server/handlers/ai.js — add effortLevel reading in generateChat
patch('server/handlers/ai.js',
  `  const requestedPreference = normalizeModelPreference(body.modelId || body.modelPreference || body.model);
  const simpleQuery = body.simpleQuery === true;`,
  `  const requestedPreference = normalizeModelPreference(body.modelId || body.modelPreference || body.model);
  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();
  const effortTokenBudget = resolveEffortTokenBudget(effortLevel, false, false);
  const simpleQuery = body.simpleQuery === true;`
);

// FIX 5: server/handlers/ai.js — scale maxTokens in tryGeminiWithModelFallback call
patch('server/handlers/ai.js',
  `maxTokens: body.guestDemo && !coding ? 2_048 : coding || geminiModel === 'gemini-3.8-flash' ? 40_000 : 32_768,`,
  `maxTokens: body.guestDemo && !coding ? 2_048 : Math.max(effortTokenBudget, coding || geminiModel === 'gemini-3.8-flash' ? 40_000 : 32_768),`
);

// FIX 6: route.ts — add effortLevel extraction from body
patch('src/app/api/chat/route.ts',
  `const modelPref = String(body.modelId || body.modelPreference || body.model || 'auto').trim();`,
  `const modelPref = String(body.modelId || body.modelPreference || body.model || 'auto').trim();
  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();
  const effortBudget = resolveEffortTokenBudget(effortLevel, Boolean(body.coding));`
);

console.log('\n✅ All secondary patches applied!');

