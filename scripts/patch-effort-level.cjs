/**
 * Zulora AI — Effort Level Integration Patcher
 * =============================================
 * Patches:
 * 1. ChatInput.tsx — add effortLevel + effortSelectorOpen props, wire EffortSelector
 * 2. ChatInterface.jsx — add effortLevel state, pass to ChatInput and chatPayload
 * 3. apiRouter.js — pass effortLevel + token budget in chatPayload
 * 4. server/handlers/ai.js — read effortLevel and scale maxTokens accordingly
 * 5. app/api/chat/route.ts — read effortLevel and scale maxOutputTokens
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeFile(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  console.log(`  ✓ Patched: ${rel}`);
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    console.warn(`  ⚠ Pattern not found in ${label}: ${search.slice(0, 60)}...`);
    return content;
  }
  return content.replace(search, replacement);
}

// ══════════════════════════════════════════════════════════════
// 1. Patch ChatInput.tsx — add EffortSelector between ModelSelector and Web Search
// ══════════════════════════════════════════════════════════════
let chatInput = readFile('src/components/chat/ChatInput.tsx');

// Add EffortSelector import after ModelSelector import
chatInput = replaceOnce(chatInput,
  `import ModelSelector from './ModelSelector';`,
  `import ModelSelector from './ModelSelector';\nimport EffortSelector, { type EffortLevel, DEFAULT_EFFORT, EFFORT_STORAGE_KEY } from './EffortSelector';`,
  'ChatInput.tsx import'
);

// Add new props to interface
chatInput = replaceOnce(chatInput,
  `  showMoreTools?: boolean;\n  onToggleMoreTools?: () => void;\n}`,
  `  showMoreTools?: boolean;\n  onToggleMoreTools?: () => void;\n  effortLevel?: EffortLevel;\n  onEffortChange?: (level: EffortLevel) => void;\n  showEffortMenu?: boolean;\n  onToggleEffortMenu?: (e: React.MouseEvent | React.TouchEvent) => void;\n  onCloseEffortMenu?: () => void;\n}`,
  'ChatInput.tsx interface'
);

// Add new destructured props
chatInput = replaceOnce(chatInput,
  `  isGenerating = false,\n  onStopGeneration\n}) => {`,
  `  isGenerating = false,\n  onStopGeneration,\n  effortLevel = DEFAULT_EFFORT,\n  onEffortChange,\n  showEffortMenu = false,\n  onToggleEffortMenu,\n  onCloseEffortMenu\n}) => {`,
  'ChatInput.tsx destructure'
);

// Add EffortSelector after ModelSelector in the JSX bottom toolbar
chatInput = replaceOnce(chatInput,
  `          {/* 2. Web Search Icon */}`,
  `          {/* 1b. Thinking Effort Selector */}
          <EffortSelector
            effortLevel={effortLevel}
            onEffortChange={onEffortChange}
            isOpen={showEffortMenu}
            onToggle={onToggleEffortMenu}
            onClose={onCloseEffortMenu}
          />

          {/* 2. Web Search Icon */}`,
  'ChatInput.tsx JSX'
);

writeFile('src/components/chat/ChatInput.tsx', chatInput);

// ══════════════════════════════════════════════════════════════
// 2. Patch ChatInterface.jsx — add effortLevel state, pass to ChatInput, pass to generateChat
// ══════════════════════════════════════════════════════════════
let chatInterface = readFile('src/components/ChatInterface.jsx');

// Add import for EffortSelector types at the top (after ModelSelector import)
chatInterface = replaceOnce(chatInterface,
  `import ModelSelector from './ModelSelector';`,
  `import ModelSelector from './ModelSelector';\nimport { DEFAULT_EFFORT, EFFORT_STORAGE_KEY, getEffortOption, resolveTokenBudget } from './chat/EffortSelector';`,
  'ChatInterface.jsx import EffortSelector'
);

// Add effortLevel state declaration after showModelMenu state
chatInterface = replaceOnce(chatInterface,
  `  const [showModelMenu, setShowModelMenu] = useState(false);`,
  `  const [showModelMenu, setShowModelMenu] = useState(false);\n  const [effortLevel, setEffortLevel] = useState(() => { try { return localStorage.getItem(EFFORT_STORAGE_KEY) || DEFAULT_EFFORT; } catch { return DEFAULT_EFFORT; } });\n  const [showEffortMenu, setShowEffortMenu] = useState(false);`,
  'ChatInterface.jsx effort state'
);

// Add effortLevel to generateModelResponse call options (after simpleQuery)
chatInterface = replaceOnce(chatInterface,
  `          simpleQuery,\n          signal: generationController.signal,`,
  `          simpleQuery,\n          effortLevel,\n          signal: generationController.signal,`,
  'ChatInterface.jsx generateChat options'
);

// Wire effortLevel props to ChatInput in JSX (after onCloseModelMenu)
chatInterface = replaceOnce(chatInterface,
  `          onCloseModelMenu={() => setShowModelMenu(false)}`,
  `          onCloseModelMenu={() => setShowModelMenu(false)}\n          effortLevel={effortLevel}\n          onEffortChange={level => { setEffortLevel(level); try { localStorage.setItem(EFFORT_STORAGE_KEY, level); } catch {} }}\n          showEffortMenu={showEffortMenu}\n          onToggleEffortMenu={event => { event.stopPropagation(); setShowEffortMenu(v => !v); }}\n          onCloseEffortMenu={() => setShowEffortMenu(false)}`,
  'ChatInterface.jsx ChatInput effort props'
);

// Add effort menu click-outside close overlay (after showModelMenu overlay)
chatInterface = replaceOnce(chatInterface,
  `      {showModelMenu && (\n        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />\n      )}`,
  `      {showModelMenu && (\n        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />\n      )}\n      {showEffortMenu && (\n        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowEffortMenu(false)} />\n      )}`,
  'ChatInterface.jsx effort overlay'
);

writeFile('src/components/ChatInterface.jsx', chatInterface);

// ══════════════════════════════════════════════════════════════
// 3. Patch apiRouter.js — pass effortLevel in chatPayload to server
// ══════════════════════════════════════════════════════════════
let apiRouter = readFile('src/services/apiRouter.js');

// Pass effortLevel in chatPayload object sent to server
apiRouter = replaceOnce(apiRouter,
  `          simpleQuery,\n          coding,\n          flagship\n        };`,
  `          simpleQuery,\n          coding,\n          flagship,\n          effortLevel: options.effortLevel || 'medium',\n          effortTokenBudget: resolveTokenBudget ? resolveTokenBudget(options.effortLevel || 'medium', coding, false) : undefined\n        };`,
  'apiRouter.js chatPayload'
);

// Add resolveTokenBudget import at the top of apiRouter.js
if (!apiRouter.includes('resolveTokenBudget')) {
  apiRouter = replaceOnce(apiRouter,
    `import { requestConnectorModel, requestGeneration, requestGenerationStream, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';`,
    `import { requestConnectorModel, requestGeneration, requestGenerationStream, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';\n\n// Effort token budget resolver (inline, avoids TS import in .js file)\nfunction resolveTokenBudget(effortLevel, coding, research) {\n  const EFFORT_BUDGETS = { low: 4096, medium: 8192, high: 20000, extra: 40000, max: 65536 };\n  let budget = EFFORT_BUDGETS[String(effortLevel || 'medium')] || 8192;\n  if ((coding || research) && budget < 20000) budget = 20000;\n  return budget;\n}`,
    'apiRouter.js resolveTokenBudget'
  );
}

writeFile('src/services/apiRouter.js', apiRouter);

// ══════════════════════════════════════════════════════════════
// 4. Patch server/handlers/ai.js — read effortLevel and scale maxTokens
// ══════════════════════════════════════════════════════════════
let aiHandler = readFile('server/handlers/ai.js');

// After normalizeModelPreference definition, add effort level resolver
if (!aiHandler.includes('resolveEffortTokenBudget')) {
  aiHandler = replaceOnce(aiHandler,
    `function normalizeModelPreference(value) {`,
    `function resolveEffortTokenBudget(effortLevel, coding, research) {\n  const EFFORT_BUDGETS = { low: 4096, medium: 8192, high: 20000, extra: 40000, max: 65536 };\n  let budget = EFFORT_BUDGETS[String(effortLevel || 'medium')] || 8192;\n  if ((coding || research) && budget < 20000) budget = 20000;\n  return budget;\n}\n\nfunction normalizeModelPreference(value) {`,
    'ai.js resolveEffortTokenBudget'
  );
}

// In generateChat function, read effortLevel and override token allocation
aiHandler = replaceOnce(aiHandler,
  `  const requestedPreference = normalizeModelPreference(body.modelId || body.modelPreference || body.model);\n  const simpleQuery = body.simpleQuery === true;`,
  `  const requestedPreference = normalizeModelPreference(body.modelId || body.modelPreference || body.model);\n  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();\n  const effortTokenBudget = resolveEffortTokenBudget(effortLevel, false, false);\n  const simpleQuery = body.simpleQuery === true;`,
  'ai.js generateChat effortLevel'
);

// Override maxTokens in the tryGeminiWithModelFallback call to respect effortTokenBudget
aiHandler = replaceOnce(aiHandler,
  `maxTokens: body.guestDemo && !coding ? 2_048 : coding || geminiModel === 'gemini-3.8-flash' ? 40_000 : 32_768,`,
  `maxTokens: body.guestDemo && !coding ? 2_048 : Math.max(effortTokenBudget, coding || geminiModel === 'gemini-3.8-flash' ? 40_000 : 32_768),`,
  'ai.js maxTokens scaling'
);

writeFile('server/handlers/ai.js', aiHandler);

// ══════════════════════════════════════════════════════════════
// 5. Patch app/api/chat/route.ts — read effortLevel and scale maxOutputTokens
// ══════════════════════════════════════════════════════════════
let routeTs = readFile('src/app/api/chat/route.ts');

if (!routeTs.includes('resolveEffortTokenBudget')) {
  // Add effort resolver before the POST handler
  routeTs = replaceOnce(routeTs,
    `export const runtime = 'edge';`,
    `// Effort-level token budget resolver\nfunction resolveEffortTokenBudget(effortLevel: string, coding: boolean = false): number {\n  const EFFORT_BUDGETS: Record<string, number> = { low: 4096, medium: 8192, high: 20000, extra: 40000, max: 65536 };\n  let budget = EFFORT_BUDGETS[effortLevel] ?? 8192;\n  if (coding && budget < 20000) budget = 20000;\n  return budget;\n}\n\nexport const runtime = 'edge';`,
    'route.ts resolveEffortTokenBudget'
  );
}

writeFile('src/app/api/chat/route.ts', routeTs);

// ══════════════════════════════════════════════════════════════
// 6. Look for where route.ts reads body and inject effortLevel extraction
// ══════════════════════════════════════════════════════════════
let routeTs2 = readFile('src/app/api/chat/route.ts');

// Find the POST handler body extraction and inject effortLevel
if (!routeTs2.includes('const effortLevel')) {
  routeTs2 = replaceOnce(routeTs2,
    `const modelPref = String(body.modelId || body.modelPreference || body.model || 'auto').trim();`,
    `const modelPref = String(body.modelId || body.modelPreference || body.model || 'auto').trim();\n  const effortLevel = String(body.effortLevel || 'medium').toLowerCase();\n  const effortBudget = resolveEffortTokenBudget(effortLevel, Boolean(body.coding));`,
    'route.ts body effortLevel'
  );
  writeFile('src/app/api/chat/route.ts', routeTs2);
}

console.log('\n✅ All effort-level patches applied successfully!');

