import { requestVideoGeneration, checkGenerationAllowance, GenerationApiError } from './generationApi';

export async function generateVideo(arg1, arg2 = {}) {
  const options = typeof arg1 === 'object' && arg1 !== null ? arg1 : { ...arg2, prompt: String(arg1 || '') };
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('Write a prompt before generating a video.');

  const duration = Number(options.duration) || 6;
  const serverBody = {
    prompt,
    generationType: 'text-to-video',
    model: 'video',
    motionSpeed: options.motionSpeed,
    cameraAngle: options.cameraAngle,
    duration,
    aspectRatio: options.aspectRatio || '16:9'
  };

  const allowance = await checkGenerationAllowance('video', options.currentUser);
  if (allowance && !allowance.allowed) {
    throw new GenerationApiError(
      allowance.usage?.blocked ? 'Your rolling usage limit is reached. Capacity returns automatically as earlier usage expires.' : 'Video generation is currently unavailable.',
      allowance.usage?.blocked ? 429 : 403,
      { ...allowance, upgradeRequired: Boolean(allowance.usage?.blocked || allowance.upgradeRequired) }
    );
  }

  const onProgress = options.onProgress;
  onProgress?.({ provider: 'Video model pipeline', phase: 'Connecting', message: 'Requesting an actual text-to-video model result.' });
  try {
    let serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/video');
    if (!serverResult) serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/ai');
    if (serverResult?.url || serverResult?.videoUrl) return serverResult;
    throw new GenerationApiError('The video model service returned no playable video.', 502);
  } catch (error) {
    if (error instanceof GenerationApiError && [401, 403, 429].includes(error.status)) throw error;
    console.error('[Video] Video model providers could not return a playable clip:', error.message);
    throw new GenerationApiError(`Video generation failed. Configure a video model provider and retry. ${error.message}`, error.status || 502, error.payload || {});
  }
}

export default { generateVideo };
