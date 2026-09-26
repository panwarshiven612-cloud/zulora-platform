import { requestVideoGeneration, trackSuccessfulUsage, checkGenerationAllowance, GenerationApiError } from './generationApi';

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
  const response = await fetchWithTimeout(url, {}, 38_000);
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
    if (allowance.softCooldown) {
      throw new GenerationApiError('Taking a 5-minute breather to maintain top performance...', 429, { ...allowance, upgradeRequired: false });
    }
    throw new GenerationApiError(
      allowance.usage?.blocked ? 'Your daily AI token allocation is used. Upgrade or wait for the reset to continue.' : 'Video generation is currently unavailable.',
      allowance.usage?.blocked ? 429 : 403,
      { ...allowance, upgradeRequired: Boolean(allowance.usage?.blocked || allowance.upgradeRequired) }
    );
  }

  const onProgress = options.onProgress;
  onProgress?.({ provider: 'Zulora Video API', phase: 'Connecting', message: 'Connecting to the text-to-video service.' });
  try {
    let serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/video');
    if (!serverResult) serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/ai');
    if (serverResult?.url || serverResult?.videoUrl) return serverResult;
  } catch (error) {
    if (error instanceof GenerationApiError && [401, 403, 429].includes(error.status)) throw error;
    console.warn('[Video] Server video provider pipeline failed; trying direct Pollinations:', error.message);
  }

  try {
    onProgress?.({ provider: 'Pollinations', phase: 'Generating video', message: 'Submitting your prompt to Pollinations text-to-video.' });
    const url = await pollinationsVideo(enrichedPrompt, duration, options.aspectRatio || '16:9');
    onProgress?.({ provider: 'Pollinations', phase: 'Video ready', message: 'Your generated video is ready.' });
    return { url, videoUrl: url, provider: 'Pollinations', model: 'video', duration: Math.min(duration, 8), prompt, usage: await trackSuccessfulUsage('video', options.currentUser) };
  } catch (error) {
    console.warn('[Video] Direct Pollinations video request failed:', error.message);
    throw new Error('Real text-to-video providers are unavailable. Configure Pollinations, Replicate, Hugging Face, or Fal AI credentials, then retry.');
  }
}

export default { generateVideo };
