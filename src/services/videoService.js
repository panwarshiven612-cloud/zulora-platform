import { requestVideoGeneration, checkGenerationAllowance, GenerationApiError } from './generationApi';

function renderLocalMotionVideo(prompt, duration, aspectRatio, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
      reject(new Error('This browser cannot create a local WebM motion fallback.'));
      return;
    }
    const portrait = aspectRatio === '9:16';
    const canvas = document.createElement('canvas');
    canvas.width = portrait ? 540 : 960;
    canvas.height = portrait ? 960 : 540;
    const context = canvas.getContext('2d');
    if (!context || !canvas.captureStream) {
      reject(new Error('Canvas video capture is unavailable in this browser.'));
      return;
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported?.(type)) || '';
    let recorder;
    try { recorder = new MediaRecorder(canvas.captureStream(24), mimeType ? { mimeType } : undefined); }
    catch (error) { reject(error); return; }

    const chunks = [];
    const seconds = Math.min(6, Math.max(3, Number(duration) || 4));
    const frameCount = seconds * 24;
    const title = String(prompt || 'Zulora AI motion study').replace(/\s+/g, ' ').slice(0, 58);
    let frame = 0;
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = event => reject(event.error || new Error('Local video capture failed.'));
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (blob.size < 1000) { reject(new Error('Local motion fallback produced an empty video.')); return; }
      resolve(URL.createObjectURL(blob));
    };
    onProgress?.({ provider: 'Local Canvas Motion Renderer', phase: 'Rendering Frames', message: 'Online video engines are unavailable. Rendering a short animated WebM motion preview locally.' });
    recorder.start(250);

    const draw = () => {
      const t = frame / frameCount;
      const hue = 205 + Math.sin(t * Math.PI * 2) * 35;
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${hue} 74% 24%)`);
      gradient.addColorStop(0.52, '#101a37');
      gradient.addColorStop(1, `hsl(${hue + 45} 70% 11%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let index = 0; index < 15; index += 1) {
        const x = (Math.sin(t * 6 + index * 1.77) * 0.42 + 0.5) * canvas.width;
        const y = (Math.cos(t * 4 + index * 2.13) * 0.38 + 0.5) * canvas.height;
        const radius = 14 + (Math.sin(t * 9 + index) + 1) * 17;
        context.fillStyle = `hsla(${190 + index * 5}, 90%, 68%, 0.12)`;
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      }

      context.textAlign = 'center';
      context.fillStyle = 'rgba(255,255,255,.88)';
      context.font = '700 25px system-ui, sans-serif';
      context.fillText('ZULORA MOTION PREVIEW', canvas.width / 2, canvas.height / 2 - 16);
      context.fillStyle = 'rgba(186,230,253,.94)';
      context.font = '16px system-ui, sans-serif';
      context.fillText(title, canvas.width / 2, canvas.height / 2 + 22, canvas.width - 64);

      frame += 1;
      if (frame >= frameCount) { recorder.stop(); return; }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
}

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
  onProgress?.({ provider: 'Video model pipeline', phase: 'Initializing Engine', message: 'Starting the Fal AI / Replicate video provider waterfall.' });
  try {
    let serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/video');
    if (!serverResult) serverResult = await requestVideoGeneration(serverBody, options.currentUser, onProgress, '/api/ai');
    if (serverResult?.url || serverResult?.videoUrl) return serverResult;
    throw new GenerationApiError('The video model service returned no playable video.', 502);
  } catch (error) {
    if (error instanceof GenerationApiError && [401, 403, 429].includes(error.status)) throw error;
    console.warn('[Video] Hosted video providers could not return a playable clip; trying local frame interpolation:', error.message);
    onProgress?.({ provider: 'Local Canvas Motion Renderer', phase: 'Fallback', message: 'Switching to a locally rendered animated WebM preview.' });
    try {
      const url = await renderLocalMotionVideo(prompt, duration, serverBody.aspectRatio, onProgress);
      return { url, videoUrl: url, provider: 'Local Canvas Motion Renderer', model: 'Animated WebM motion preview', duration: Math.min(6, Math.max(3, duration)) };
    } catch (fallbackError) {
      throw new GenerationApiError(`Video providers are unavailable and this browser could not render the motion fallback. ${fallbackError.message}`, error.status || 502, error.payload || {});
    }
  }
}

export default { generateVideo };
