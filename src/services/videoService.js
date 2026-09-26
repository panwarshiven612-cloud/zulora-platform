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

function promptSeed(prompt) {
  let hash = 2166136261;
  for (const character of String(prompt || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

async function canvasMotionVideo(prompt, duration, aspectRatio) {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') throw new Error('Canvas video recording is not supported in this browser.');
  const vertical = aspectRatio === '9:16';
  const square = aspectRatio === '1:1';
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? 360 : square ? 480 : 640;
  canvas.height = vertical ? 640 : square ? 480 : 360;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream) throw new Error('Canvas video recording is not supported in this browser.');
  const stream = canvas.captureStream(24);
  const supportedTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 520_000 } : { videoBitsPerSecond: 520_000 });
  const seed = promptSeed(prompt);
  const blobs = [];
  const title = String(prompt || 'A cinematic motion study').trim().replace(/\s+/g, ' ').slice(0, 58);
  const palette = [`hsl(${seed % 360} 78% 55%)`, `hsl(${(seed >>> 9) % 360} 78% 60%)`, '#080d1c'];
  let frame = 0;
  let animation = 0;
  const draw = () => {
    const { width, height } = canvas;
    const phase = frame++ / 24;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(0.52, palette[1]);
    gradient.addColorStop(1, palette[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    const centerX = width / 2 + Math.sin(phase * 0.7) * width * 0.15;
    const centerY = height / 2 + Math.cos(phase * 0.55) * height * 0.11;
    const glow = context.createRadialGradient(centerX, centerY, 3, centerX, centerY, Math.min(width, height) * 0.56);
    glow.addColorStop(0, 'rgba(255,255,255,.62)');
    glow.addColorStop(0.28, 'rgba(255,255,255,.12)');
    glow.addColorStop(1, 'rgba(4,8,24,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + phase * (index % 2 ? 0.4 : -0.3);
      const radius = Math.min(width, height) * (0.16 + (index % 3) * 0.08);
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const size = 8 + ((seed >>> (index % 16)) % 18);
      context.beginPath();
      context.arc(x, y, size + Math.sin(phase + index) * 3, 0, Math.PI * 2);
      context.fillStyle = index % 2 ? 'rgba(255,255,255,.68)' : 'rgba(5,12,38,.55)';
      context.fill();
    }
    const fontSize = vertical ? 23 : square ? 25 : 29;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(3,7,18,.7)';
    context.shadowBlur = 18;
    context.fillStyle = '#fff';
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    const words = title.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > width * 0.82 && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    const visibleLines = lines.slice(0, 3);
    visibleLines.forEach((text, index) => context.fillText(text, width / 2, height / 2 + (index - (visibleLines.length - 1) / 2) * (fontSize + 9), width * 0.84));
    context.shadowBlur = 0;
    animation = requestAnimationFrame(draw);
  };
  draw();
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data?.size) blobs.push(event.data); };
    recorder.onerror = () => {
      cancelAnimationFrame(animation);
      stream.getTracks().forEach(track => track.stop());
      reject(new Error('Canvas video could not be recorded.'));
    };
    recorder.onstop = async () => {
      cancelAnimationFrame(animation);
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(blobs, { type: recorder.mimeType || 'video/webm' });
      if (!blob.size) return reject(new Error('Canvas video output was empty.'));
      try {
        const dataUrl = await new Promise((readResolve, readReject) => {
          const reader = new FileReader();
          reader.onload = () => readResolve(reader.result);
          reader.onerror = () => readReject(new Error('Could not package the canvas video.'));
          reader.readAsDataURL(blob);
        });
        resolve(dataUrl);
      } catch (error) { reject(error); }
    };
    try {
      recorder.start(300);
      window.setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, Math.min(8, Math.max(3, Number(duration) || 6)) * 1000);
    } catch (error) {
      cancelAnimationFrame(animation);
      stream.getTracks().forEach(track => track.stop());
      reject(error);
    }
  });
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

  try {
    let serverResult = await requestGeneration('video', serverBody, options.currentUser, '/api/video');
    if (!serverResult) serverResult = await requestGeneration('video', serverBody, options.currentUser);
    if (serverResult?.url || serverResult?.videoUrl) return serverResult;
  } catch (error) {
    if (error instanceof GenerationApiError && [401, 403, 429].includes(error.status)) throw error;
    console.warn('[Video] Server generation route unavailable; trying Pollinations:', error.message);
  }

  try {
    const url = await pollinationsVideo(enrichedPrompt, duration, options.aspectRatio || '16:9');
    return { url, videoUrl: url, provider: 'Pollinations', model: 'video', duration: Math.min(duration, 8), prompt, usage: await trackSuccessfulUsage('video', options.currentUser) };
  } catch (error) { console.warn('[Video] Pollinations fallback failed:', error.message); }

  try {
    const url = await canvasMotionVideo(enrichedPrompt, duration, options.aspectRatio || '16:9');
    return { url, videoUrl: url, provider: 'HTML Canvas Motion Generator', model: 'canvas-motion-v1', duration: Math.min(duration, 8), prompt, usage: await trackSuccessfulUsage('video', options.currentUser) };
  } catch (error) {
    console.warn('[Video] Canvas motion fallback failed:', error.message);
    throw new Error('Video engines and the browser canvas fallback are unavailable. Try again in a browser that supports video recording.');
  }
}

export default { generateVideo };
