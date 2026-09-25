import { requestGeneration, trackSuccessfulUsage, GenerationApiError } from './generationApi';

const clientEnv = import.meta.env || {};
const FAL_KEY = String(clientEnv.VITE_FAL_KEY || '').trim();
const HUGGINGFACE_KEY = String(clientEnv.VITE_HUGGINGFACE_KEY || '').trim();

const FAL_MODELS = [
  { id: 'fal-ai/luma-dream-machine/ray-2-flash', label: 'Fal AI', model: 'Luma Dream Machine Ray 2 Flash', timeout: 180_000 },
  { id: 'fal-ai/hunyuan-video-v1.5/text-to-video', label: 'Fal AI', model: 'HunyuanVideo 1.5', timeout: 270_000 },
  { id: 'fal-ai/cogvideox-5b', label: 'Fal AI', model: 'CogVideoX-5B', timeout: 240_000 }
];

const HF_MODELS = [
  { id: 'tencent/HunyuanVideo', model: 'HunyuanVideo' },
  { id: 'zai-org/CogVideoX-5b', model: 'CogVideoX-5B' }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function videoUrlFrom(data) {
  const value = data?.video?.url || data?.video_url || data?.url || data?.output?.video?.url || data?.output?.url;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function falQueueVideo(model, input, timeoutMs) {
  const start = await fetchWithTimeout(`https://queue.fal.run/${model.id}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }, 20_000);
  const initial = await start.json().catch(() => ({}));
  if (!start.ok) throw new Error(initial.detail || initial.error || `Fal request failed (HTTP ${start.status}).`);

  const immediateUrl = videoUrlFrom(initial);
  if (immediateUrl) return immediateUrl;
  if (!initial.request_id || !initial.status_url || !initial.response_url) {
    throw new Error('Fal accepted the request without returning queue status URLs.');
  }

  const deadline = Date.now() + timeoutMs;
  let retryDelay = 1_800;
  while (Date.now() < deadline) {
    await sleep(retryDelay);
    let statusResponse;
    try {
      statusResponse = await fetchWithTimeout(initial.status_url, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      }, 12_000);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      retryDelay = Math.min(5_000, retryDelay + 500);
      continue;
    }

    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      if (statusResponse.status === 429 || statusResponse.status >= 500) {
        retryDelay = Math.min(6_000, retryDelay * 1.5);
        continue;
      }
      throw new Error(status.detail || `Fal status request failed (HTTP ${statusResponse.status}).`);
    }
    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      throw new Error(status.error || status.logs?.at?.(-1)?.message || `${model.model} failed to generate a video.`);
    }
    if (status.status === 'COMPLETED') {
      const output = await fetchWithTimeout(initial.response_url, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      }, 20_000);
      const result = await output.json().catch(() => ({}));
      if (!output.ok) throw new Error(result.detail || 'Fal completed the job but its result could not be fetched.');
      const url = videoUrlFrom(result);
      if (url) return url;
      throw new Error('Fal completed the job without returning a video URL.');
    }
    retryDelay = status.status === 'IN_PROGRESS' ? 2_500 : Math.min(5_000, retryDelay + 300);
  }
  throw new Error(`${model.model} is still processing. The request timed out while waiting for Fal.`);
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the generated video for saving.'));
    reader.readAsDataURL(blob);
  });
}

async function huggingFaceVideo(model, prompt, timeoutMs = 240_000) {
  const url = `https://router.huggingface.co/hf-inference/models/${model.id}`;
  const deadline = Date.now() + timeoutMs;
  let delay = 2_000;

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HUGGINGFACE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { num_frames: 49 } })
    }, Math.min(90_000, Math.max(10_000, deadline - Date.now())));

    const contentType = response.headers.get('content-type') || '';
    if (response.ok && (contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
      const blob = await response.blob();
      if (blob.size < 10_000 || blob.size > 50 * 1024 * 1024) throw new Error('Hugging Face returned a video outside the supported size.');
      const normalizedBlob = blob.type ? blob : new Blob([blob], { type: 'video/mp4' });
      return await blobToDataUrl(normalizedBlob);
    }

    const detail = contentType.includes('json') ? await response.json().catch(() => ({})) : {};
    if (response.status === 503 || response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const estimated = Number(detail.estimated_time);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Number.isFinite(estimated) && estimated > 0 ? estimated * 1000 : delay;
      await sleep(Math.min(Math.max(waitMs, 1_000), Math.max(0, deadline - Date.now())));
      delay = Math.min(12_000, delay * 1.5);
      continue;
    }
    throw new Error(detail.error || detail.message || `${model.model} request failed (HTTP ${response.status}).`);
  }
  throw new Error(`${model.model} did not finish before the Hugging Face wait limit.`);
}

function buildPrompt(prompt, options) {
  return [
    String(prompt || '').trim(),
    options.cameraAngle ? `Camera movement: ${options.cameraAngle}.` : '',
    options.motionSpeed ? `Motion intensity: ${options.motionSpeed}/10.` : ''
  ].filter(Boolean).join(' ');
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

  const finishBrowserGeneration = async result => {
    result.usage = await trackSuccessfulUsage('video', options.currentUser);
    return result;
  };

  if (!FAL_KEY && !HUGGINGFACE_KEY) {
    try {
      const serverResult = await requestGeneration('video', serverBody, options.currentUser);
      if (serverResult?.url || serverResult?.videoUrl) return serverResult;
    } catch (error) {
      if (error instanceof GenerationApiError && (error.status === 403 || error.status === 401)) throw error;
      console.warn('[Video] Server generation route unavailable:', error.message);
    }
  }

  const errors = [];
  if (FAL_KEY) {
    for (const model of FAL_MODELS) {
      try {
        const url = await falQueueVideo(model, { prompt: enrichedPrompt, prompt_optimizer: true }, model.timeout);
        return await finishBrowserGeneration({
          url,
          videoUrl: url,
          provider: model.label,
          model: model.model,
          duration,
          prompt,
          usage: { type: 'video', tracked: false }
        });
      } catch (error) {
        errors.push(`${model.model}: ${error.message}`);
        console.warn(`[Video] ${model.model} failed:`, error.message);
      }
    }
  }

  if (HUGGINGFACE_KEY) {
    for (const model of HF_MODELS) {
      try {
        const dataUrl = await huggingFaceVideo(model, enrichedPrompt);
        return await finishBrowserGeneration({
          url: dataUrl,
          videoUrl: dataUrl,
          provider: 'Hugging Face Inference Providers',
          model: model.model,
          duration,
          prompt,
          usage: { type: 'video', tracked: false }
        });
      } catch (error) {
        errors.push(`${model.model}: ${error.message}`);
        console.warn(`[Video] Hugging Face ${model.model} failed:`, error.message);
      }
    }
  }

  const configured = [FAL_KEY && 'VITE_FAL_KEY', HUGGINGFACE_KEY && 'VITE_HUGGINGFACE_KEY'].filter(Boolean);
  if (!configured.length) throw new Error('Video generation is not configured. Add VITE_FAL_KEY or VITE_HUGGINGFACE_KEY, or configure the server video providers.');
  throw new Error(errors.at(-1) || 'All configured Fal AI and Hugging Face video models are unavailable.');
}

export default { generateVideo };
