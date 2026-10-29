const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'components', 'chat', 'ModelSelector.tsx');
let content = fs.readFileSync(target, 'utf8');

content = content.replace(
  "description: 'High token budget (40k) for complex coding, web building & video',",
  "description: 'High token budget (40k) for complex coding, web building & deep research',"
);

content = content.replace(
  "if (cur === 'gemini 3.8 flash' || cur === 'gemini 3.8' || cur === 'gemini' || cur === 'gemini-3.8-flash') return 'gemini-3.8-flash';",
  "if (cur === 'gemini 3.8 flash' || cur === 'gemini 3.8' || cur === 'gemini' || cur === 'gemini-3.8-flash' || cur === 'think' || cur === 'pro' || cur === 'deep research') return 'gemini-3.8-flash';"
);

fs.writeFileSync(target, content, 'utf8');
console.log('ModelSelector.tsx updated');
