const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'server', 'handlers', 'ai.js');
let content = fs.readFileSync(target, 'utf8');

// Replace gemini-2.5-pro references with gemini-3.8-flash
content = content.replace(/options\.model === 'gemini-2\.5-pro'/g, "options.model === 'gemini-3.8-flash'");
content = content.replace(/return 'gemini-2\.5-pro';/g, "return 'gemini-3.8-flash';");
content = content.replace(/requestedPreference === 'gemini-2\.5-pro'/g, "requestedPreference === 'gemini-3.8-flash'");
content = content.replace(/'gemini-2\.5-pro'/g, "'gemini-3.8-flash'");

fs.writeFileSync(target, content, 'utf8');
console.log('server/handlers/ai.js patched successfully');
