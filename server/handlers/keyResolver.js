const namesFor = name => name.startsWith('VITE_') ? [name] : [name, `VITE_${name}`];

export function readServerEnv(name, { allowViteAlias = true } = {}) {
  const names = allowViteAlias ? namesFor(name) : [name];
  for (const candidate of names) {
    const value = String(process.env[candidate] || '').trim();
    if (value) return value;
  }
  return '';
}

export function readServerKeys(...names) {
  return [...new Set(names.map(name => readServerEnv(name)).filter(Boolean))];
}

export function readFirstServerKey(...names) {
  return readServerKeys(...names)[0] || '';
}
