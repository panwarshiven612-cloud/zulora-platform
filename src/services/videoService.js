import { requestGeneration, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';

async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(prompt, options) {
  return [
    String(prompt || '').trim(),
    options.cameraAngle ? `Camera movement: ${options.cameraAngle}.` : '',
    options.motionSpeed ? `Motion intensity: ${options.motionSpeed}/10.` : ''
  ].filter(Boolean).join(' ');
}

async function pollinationsVideo(prompt, duration, aspectRatio) {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=video&duration=${Math.min(Number(duration) || 4, 8)}&aspectRatio=${encodeURIComponent(aspectRatio || '16:9')}`;
  const response = await fetchWithTimeout(url, {}, 240_000);
  if (!response.ok) throw new Error(`Pollinations video generation failed (HTTP ${response.status}).`);

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const data = await response.json();
    const videoUrl = data.video?.url || data.video_url || data.videoUrl || data.mediaUrl || data.url || data.output?.url;
    if (videoUrl && ['https:', 'http:'].includes(new URL(videoUrl).protocol)) return videoUrl;
    throw new Error('Pollinations returned no video URL.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('Pollinations returned an empty video.');
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const isMp4 = head.length >= 8 && String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
  if (!contentType.startsWith('video/') && !isMp4) throw new Error('Pollinations returned an unsupported video response.');
  const videoBlob = contentType.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
  const form = new FormData();
  form.set('file', videoBlob, 'zulora-generated.mp4');
  try {
    const upload = await fetchWithTimeout('https://media.pollinations.ai/upload', { method: 'POST', body: form }, 12_000);
    if (upload.ok) {
      const stored = await upload.json();
      const storedUrl = stored.url || stored.mediaUrl;
      if (storedUrl && new URL(storedUrl).protocol === 'https:') return storedUrl;
    }
  } catch { /* Use a compact inline result or the generation URL if media hosting is unavailable. */ }

  if (videoBlob.size <= 1_000_000) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not prepare the generated video for playback.'));
      reader.readAsDataURL(videoBlob);
    });
  }
  return url;
}

export async function generateVideo(arg1, arg2 = {}) {
  const options = typeof arg1 === 'object' && arg1 !== null ? arg1 : { ...arg2, prompt: String(arg1 || '') };
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('Write a prompt before generating a video.');

  const duration = Number(options.duration) || 6;
  const enrichedPrompt = buildPrompt(prompt, options);
  const serverBody = {
    prompt,
    motionSpeed: options.motionSpeed,
    cameraAngle: options.cameraAngle,
    duration,
    aspectRatio: options.aspectRatio || '16:9'
  };

  const allowance = await checkGenerationAllowance('video', options.currentUser);
  if (allowance && !allowance.allowed) {
    throw new GenerationApiError('Video limit reached. Upgrade your subscription to continue.', 403, allowance);
  }

  try {
    let serverResult = await requestGeneration('video', serverBody, options.currentUser, '/api/video');
    if (!serverResult) serverResult = await requestGeneration('video', serverBody, options.currentUser);
    if (serverResult?.url || serverResult?.videoUrl) return serverResult;
  } catch (error) {
    if (error instanceof GenerationApiError && (error.status === 401 || error.status === 403)) throw error;
    console.warn('[Video] Server generation route unavailable; trying Pollinations:', error.message);
  }

  try {
    const url = await pollinationsVideo(enrichedPrompt, duration, options.aspectRatio || '16:9');
    return {
      url,
      videoUrl: url,
      provider: 'Pollinations',
      model: 'video',
      duration: Math.min(duration, 8),
      prompt,
      usage: await trackSuccessfulUsage('video', options.currentUser)
    };
  } catch (error) {
    console.warn('[Video] Pollinations fallback failed:', error.message);
    throw new Error(error.message || 'Pollinations video generation is temporarily unavailable.');
  }
}

export default { generateVideo };
