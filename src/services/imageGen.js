export function buildImagePrompt(prompt, style = '', negativePrompt = '') {
  const requestedPrompt = String(prompt || '').trim();
  const selectedStyle = String(style || '').trim();
  const avoid = String(negativePrompt || '').trim();
  return [
    requestedPrompt,
    selectedStyle && selectedStyle.toLowerCase() !== 'none' ? `Additional visual style: ${selectedStyle}. Preserve the requested subject and scene.` : '',
    avoid ? `Avoid: ${avoid}.` : ''
  ].filter(Boolean).join('\n\n');
}

export default buildImagePrompt;
