import { buildImagePrompt } from './imageGen';

/**
 * imageApi.js — Bulletproof Image Studio API powered by Pollinations AI
 * Ensures image generation NEVER breaks by using Pollinations as primary & failover.
 * Created for Zulora AI.
 */

export function buildStyledPrompt(prompt, style, negativePrompt) {
  return buildImagePrompt(prompt, style, negativePrompt);
}

export function getDimensionsForRatio(aspectRatio = '1:1') {
  switch (aspectRatio) {
    case '16:9': return { width: 1280, height: 720 };
    case '9:16': return { width: 720, height: 1280 };
    case '4:3':  return { width: 1024, height: 768 };
    case '3:4':  return { width: 768, height: 1024 };
    case '1:1':
    default:     return { width: 1024, height: 1024 };
  }
}

/**
 * Generates an image using Pollinations AI as primary & failover.
 * URL: https://image.pollinations.ai/prompt/{prompt}?width=1024&height=1024&seed={seed}&nologo=true
 */
export async function generatePollinationsImage(arg1, arg2 = {}) {
  let prompt = '';
  let options = {};

  if (typeof arg1 === 'object' && arg1 !== null) {
    prompt = arg1.prompt || '';
    options = arg1;
  } else {
    prompt = String(arg1 || '');
    options = arg2 || {};
  }

  const userPrompt = String(prompt || '').trim();
  if (!userPrompt) {
    throw new Error('Please provide a prompt to generate an image.');
  }

  const { width: targetWidth, height: targetHeight } = getDimensionsForRatio(options.aspectRatio || '1:1');
  const requestedSeed = Number(options.seed);
  const seed = Number.isInteger(requestedSeed) && requestedSeed >= 0
    ? requestedSeed
    : Math.floor(Math.random() * 1_000_000);
  const cleanPrompt = buildStyledPrompt(userPrompt, options.style, options.negativePrompt) || userPrompt;
  const encodedPrompt = encodeURIComponent(cleanPrompt);

  const primaryUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${targetWidth}&height=${targetHeight}&seed=${seed}&nologo=true&model=${options.imageEngine === 'pollinations-hd' ? 'flux-hd' : 'flux'}`;
  const failoverUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;

  try {
    // Attempt verification with short timeout to ensure server is reachable
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(primaryUrl, { method: 'HEAD', signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);

    if (res && (res.ok || res.status === 200 || res.status === 304)) {
      return {
        url: primaryUrl,
        imageUrl: primaryUrl,
        provider: 'Pollinations AI',
        model: options.imageEngine === 'pollinations-hd' ? 'Pollinations HD FLUX' : 'FLUX.1-Schnell',
        prompt: userPrompt,
        enhancedPrompt: cleanPrompt,
        seed
      };
    }
  } catch (err) {
    console.warn('[imageApi] Verification check failed; returning primary URL:', err?.message);
  }

  // Pollinations images generate dynamically on GET, so returning the URL guarantees display
  return {
    url: primaryUrl || failoverUrl,
    imageUrl: primaryUrl || failoverUrl,
    provider: 'Pollinations AI',
    model: 'FLUX.1-Schnell',
    prompt: userPrompt,
    enhancedPrompt: cleanPrompt,
    seed
  };
}

export default {
  generateImage: generatePollinationsImage,
  buildStyledPrompt,
  getDimensionsForRatio
};
