/**
 * Zulora AI - Logo URL Bulk Updater
 * Replaces old logo URL with the new official Zulora AI logo across all source files.
 */
const fs = require('fs');
const path = require('path');

const OLD_URL = 'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg';
const NEW_URL = 'https://i.postimg.cc/wxXPzmkp/file-00000000a3608208b2ebb7552f63ec28.png';

const TARGET_DIRS = [
  path.join(__dirname, '..', 'src'),
  path.join(__dirname, '..', 'index.html'),
  path.join(__dirname, '..', 'public')
];

const EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts', '.html', '.json', '.md']);

let updatedFiles = 0;
let totalReplacements = 0;

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(OLD_URL)) return;
    const count = (content.match(new RegExp(OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const updated = content.split(OLD_URL).join(NEW_URL);
    fs.writeFileSync(filePath, updated, 'utf8');
    updatedFiles++;
    totalReplacements += count;
    console.log(`  ✓ Updated ${path.relative(path.join(__dirname, '..'), filePath)} (${count} occurrences)`);
  } catch (err) {
    console.error(`  ✗ Error processing ${filePath}: ${err.message}`);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(dir).toLowerCase())) processFile(dir);
    return;
  }
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    // Skip node_modules, .git, dist, .kilo worktrees
    if (['node_modules', '.git', 'dist', '.kilo', 'worktrees', 'scripts'].includes(entry)) continue;
    walkDir(path.join(dir, entry));
  }
}

console.log('Zulora AI Logo URL Updater');
console.log('='.repeat(50));
console.log(`OLD: ${OLD_URL}`);
console.log(`NEW: ${NEW_URL}`);
console.log('='.repeat(50));

for (const target of TARGET_DIRS) {
  walkDir(target);
}

console.log('='.repeat(50));
console.log(`Done! Updated ${updatedFiles} file(s) with ${totalReplacements} total replacement(s).`);
