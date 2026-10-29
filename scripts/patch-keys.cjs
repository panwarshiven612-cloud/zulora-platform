const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'lib', 'config', 'keys.ts');
let content = fs.readFileSync(target, 'utf8');

content = content.replace("pro: 'gemini-2.5-pro',", "pro: 'gemini-3.8-flash',");
content = content.replace("fallbacks: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro']", "fallbacks: ['gemini-3.8-flash', 'gemini-3.5-flash-lite']");

fs.writeFileSync(target, content, 'utf8');
console.log('keys.ts updated');
