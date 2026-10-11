const TYPO_CORRECTIONS = Object.freeze({
  gigeon: 'pigeon',
  cinemtaic: 'cinematic',
  cinamatic: 'cinematic',
  realstic: 'realistic',
  skys: 'sky'
});

export function refineVideoPrompt(value) {
  let scene = String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  scene = scene.replace(/\b(gigeon|cinemtaic|cinamatic|realstic|skys)\b/gi, word => {
    const corrected = TYPO_CORRECTIONS[word.toLowerCase()] || word;
    return word[0] === word[0].toUpperCase()
      ? corrected[0].toUpperCase() + corrected.slice(1)
      : corrected;
  });
  scene = scene
    .replace(/^(?:high[- ]definition\s+)?cinematic\s+(?:motion\s+)?video\s+of\s+/i, '')
    .replace(/(?:[,;]\s*(?:realistic motion|4k quality))+[.!?]*\s*$/i, '')
    .replace(/[.!?]+\s*$/, '')
    .trim();
  if (!scene) return '';
  return `High-definition cinematic motion video of ${scene}, realistic motion, 4k quality.`;
}
