import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '1mb' } }
};

const MAX_HTML_LENGTH = 700_000;
const ASPECT_RATIOS = Object.freeze({
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
});

function respond(res, status, payload) {
  if (!res.destroyed && !res.writableEnded) res.status(status).json(payload);
}

function renderError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function uploadMp4ToCloudinary(filePath, jobId, signal) {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || 't3dkhv0z').trim();
  const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_PRESET || 'zulora_unsigned').trim();
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), `zulora-${jobId}.mp4`);
  form.append('upload_preset', uploadPreset);
  form.append('folder', 'zulora/generated-video');

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/video/upload`, {
    method: 'POST',
    body: form,
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) {
    throw renderError(data.error?.message || `Generated MP4 could not be stored (Cloudinary HTTP ${response.status}).`, 502);
  }
  return { url: data.secure_url, bytes: Number(data.bytes) || bytes.length };
}

async function renderHtmlVideo({ html, aspectRatio, fps, duration, crf, signal }) {
  if (!ffmpegPath) throw renderError('The FFmpeg encoder is not available on this server.', 503);
  const dimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];
  const frameCount = Math.ceil(duration * fps);
  const directory = await mkdtemp(join(tmpdir(), 'zulora-video-'));
  const outputPath = join(directory, 'render.mp4');
  let browser;
  let encoder;
  const abortRender = () => {
    try { encoder?.kill('SIGKILL'); } catch { /* The encoder may already have exited. */ }
    browser?.close().catch(() => {});
  };
  signal.addEventListener('abort', abortRender, { once: true });

  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath();
    browser = await playwrightChromium.launch({
      executablePath,
      args: chromium.args,
      headless: true
    });
    const page = await browser.newPage({ viewport: dimensions, deviceScaleFactor: 1 });
    page.setDefaultTimeout(12_000);
    await page.route('**/*', route => {
      const requestUrl = route.request().url();
      if (/^(?:about:|data:|blob:)/i.test(requestUrl)) return route.continue();
      try {
        const url = new URL(requestUrl);
        if (url.protocol === 'https:' && url.hostname === 'cdnjs.cloudflare.com'
          && url.pathname === '/ajax/libs/gsap/3.12.2/gsap.min.js') return route.continue();
      } catch { /* Abort malformed and untrusted external asset URLs. */ }
      return route.abort('blockedbyclient');
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForFunction(() => window.__ready === true && typeof window.renderFrame === 'function', undefined, { timeout: 15_000 });

    if (signal.aborted) throw new DOMException('The render was cancelled.', 'AbortError');
    encoder = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderError = '';
    encoder.stderr.on('data', chunk => {
      if (encoderError.length < 4_000) encoderError += chunk.toString();
    });
    const encoderExit = new Promise((resolve, reject) => {
      encoder.once('error', reject);
      encoder.once('close', code => code === 0 ? resolve() : reject(renderError(encoderError.trim() || `FFmpeg exited with code ${code}.`)));
    });

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (signal.aborted) throw new DOMException('The render was cancelled.', 'AbortError');
      const timestamp = frame / fps;
      await page.evaluate(async time => {
        await window.renderFrame(time);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, timestamp);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 88, animations: 'allow' });
      if (!encoder.stdin.write(jpeg)) await once(encoder.stdin, 'drain');
    }
    encoder.stdin.end();
    await encoderExit;

    const outputInfo = await stat(outputPath);
    if (outputInfo.size < 1_000) throw renderError('FFmpeg produced an empty or invalid MP4.');
    return await uploadMp4ToCloudinary(outputPath, `render-${Date.now()}`, signal);
  } finally {
    signal.removeEventListener('abort', abortRender);
    try { encoder?.stdin.end(); } catch { /* The encoder may already be closed. */ }
    try { encoder?.kill('SIGKILL'); } catch { /* The encoder may already be closed. */ }
    await browser?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    if (req.method === 'GET') return respond(res, 200, { status: 'online', service: 'Zulora HTML-to-MP4 renderer' });
    res.setHeader('Allow', 'GET, POST');
    return respond(res, 405, { error: 'Method not allowed.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return respond(res, 400, { error: 'Invalid JSON request.' }); }
  }
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html || html.length > MAX_HTML_LENGTH) {
    return respond(res, 413, { error: 'Provide an HTML animation smaller than 700 KB.' });
  }
  if (!/window\.renderFrame\s*=/.test(html) || !/window\.__ready\s*=\s*true/.test(html)) {
    return respond(res, 400, { error: 'The animation must expose window.renderFrame(t) and set window.__ready = true.' });
  }

  const requestedDuration = Number(body.duration) || 8;
  const requestedFps = Number(body.fps) || 30;
  const duration = Math.min(12, Math.max(2, requestedDuration));
  const fps = Math.min(30, Math.max(24, Math.round(requestedFps)));
  const crf = Math.min(28, Math.max(16, Math.round(Number(body.crf) || 18)));
  const aspectRatio = Object.hasOwn(ASPECT_RATIOS, body.aspectRatio) ? body.aspectRatio : '16:9';
  const jobId = `zulora-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new DOMException('The MP4 render timed out.', 'TimeoutError')), 54_000);
  const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', abortOnDisconnect);
  res.once('close', abortOnDisconnect);

  try {
    const rendered = await renderHtmlVideo({ html, aspectRatio, fps, duration, crf, signal: controller.signal });
    respond(res, 200, {
      success: true,
      jobId,
      phase: 'done',
      percent: 100,
      duration,
      fps,
      fileType: 'video/mp4',
      bytes: rendered.bytes,
      url: rendered.url
    });
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    console.error('HTML-to-MP4 rendering failed:', error.message);
    respond(res, error.status || 502, { error: error.message || 'The HTML animation could not be rendered.' });
  } finally {
    clearTimeout(deadline);
    req.off('aborted', abortOnDisconnect);
    res.off('close', abortOnDisconnect);
  }
}
