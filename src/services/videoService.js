import { requestVideoGeneration, checkGenerationAllowance, GenerationApiError } from './generationApi';
import { refineVideoPrompt } from './videoPrompt';

export async function generateVideo(arg1, arg2 = {}) {
  const options = typeof arg1 === 'object' && arg1 !== null ? arg1 : { ...arg2, prompt: String(arg1 || '') };
  const prompt = refineVideoPrompt(options.prompt);
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
  onProgress?.({ provider: 'Video model pipeline', phase: 'Initializing Engine', message: 'Starting hosted Luma, Replicate, and Pollinations video providers.' });
  let serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/video');
  if (!serverResult) serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/ai');
  if (serverResult?.url || serverResult?.videoUrl) return { ...serverResult, prompt: serverResult.prompt || prompt };
  throw new GenerationApiError('The video model service returned no playable video.', 502);
}

export default { generateVideo };
