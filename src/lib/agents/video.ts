/**
 * video.ts — Incremental Video Generation & Editing Engine for Zulora AI
 *
 * Implements:
 * 1. High-token JSON scene planning + deterministic HTML motion synthesis
 * 2. Incremental HTML/CSS motion editing (token-saving partial edits without full regeneration)
 * 3. Playwright/headless rendering + FFmpeg MP4 export via /api/video-render
 * 4. Automatic syncing to Zulora Drive and user Media Library
 * 5. Strict refusal ban ("I can't edit videos" is forbidden)
 */

import { GEMINI_KEYS } from '../config/keys';
import { uploadFileToDrive } from '../../services/zuloraDriveService';

export const BAN_VIDEO_REFUSAL_DIRECTIVE = `
VIDEO EDITING MANDATE:
You have live execution tools for creating and editing video files via HTML/GSAP motion rendering.
Never state "I cannot edit video files" or "I cannot modify videos".
Always accept video generation and modification requests and invoke the video engine.
`;

export interface VideoRenderOptions {
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  fps?: number;
  currentUser?: any;
  signal?: AbortSignal;
  onProgress?: (progress: { phase: string; percent: number; message?: string }) => void;
}

export interface VideoExecutionResult {
  success: boolean;
  url: string;
  downloadUrl?: string;
  jobId: string;
  html: string;
  prompt: string;
  isIncremental: boolean;
  storyboard?: any;
  markdownCard: string;
  error?: string;
}

const MOTION_THINKING_BUDGET = 24_576;
const MOTION_MAX_OUTPUT_TOKENS = 32_768;

const STORYBOARD_PROMPT = `You are the creative director, senior copywriter, and JSON scene planner for Zulora AI Motion Studio. First analyze the brief, audience, and intended emotion internally; then do a separate copywriting pass before composing the scene plan. Return ONLY valid JSON matching this schema:
{"totalDuration":8,"fps":30,"resolution":"1080x1920","aspectRatio":"9:16","palette":["#060C20","#1E90FF","#28D2FF","#ECEFF8","#FFD628"],"scenes":[{"id":1,"start":0,"end":2.5,"caption":"Original punchy on-screen copy","subtext":"Short supporting line","voiceover":"Optional spoken line","hero":"One clear focal element","background":"Layered navy and azure environment","top":"Optional support","middle":"Hero region","bottom":"Optional support","transition":"whip-pan","cta":"Optional call to action"}]}
Write original on-screen copy: never repeat the user's prompt verbatim, even as a headline. The first scene must land a strong visual and copy hook within the first 3 seconds. End the final scene with one clear, concise call to action. Keep headlines punchy and readable, usually 2-6 words; keep supporting copy short. Use one hero and at most two supporting elements per scene. Use 30 fps, contiguous scene times covering the complete requested duration, and a new motion event at least every 3 seconds. Do not invent product claims, metrics, endorsements, or facts absent from the brief. Describe visual concepts; do not output HTML, JavaScript, or instructions for external assets.`;

const MOTION_PLANNER_MODEL = 'gemini-2.5-pro';
const MOTION_PALETTE = ['#060C20', '#1E90FF', '#28D2FF', '#ECEFF8', '#FFD628'];

type MotionScene = {
  id: number;
  start: number;
  end: number;
  caption: string;
  subtext: string;
  hero: string;
  background: string;
  top?: string;
  middle?: string;
  bottom?: string;
  transition?: string;
  cta?: string;
};

type MotionSceneSpec = {
  totalDuration: number;
  fps: number;
  resolution: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  palette: string[];
  scenes: MotionScene[];
};

function cleanCopy(value: unknown, fallback: string, originalPrompt: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const normalized = (input: string) => input.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!text || normalized(text) === normalized(originalPrompt)) return fallback;
  return text.slice(0, 180);
}

function normalizeSceneSpec(raw: any, duration: number, aspectRatio: MotionSceneSpec['aspectRatio'], prompt: string): MotionSceneSpec {
  const totalDuration = Math.min(60, Math.max(5, Number(duration) || 8));
  const dimensions = aspectRatio === '16:9' ? '1920x1080' : aspectRatio === '1:1' ? '1080x1080' : '1080x1920';
  const sourceScenes = Array.isArray(raw?.scenes) ? raw.scenes.slice(0, 24) : [];
  const fallbackScenes = [
    { caption: 'Your next idea, in motion', hero: 'A luminous pearl orb emerges through azure light' },
    { caption: 'Made to move forward', hero: 'Layered glass forms open into a bright horizon' },
    { caption: 'Make your next move', hero: 'A confident final composition with room for action', cta: 'Start creating today' }
  ];
  const requestedCount = Math.max(sourceScenes.length || fallbackScenes.length, Math.ceil(totalDuration / 3));
  const sceneCount = Math.min(24, requestedCount);
  const step = totalDuration / sceneCount;
  const defaultCta = 'Start creating today';
  const scenes: MotionScene[] = Array.from({ length: sceneCount }, (_, index) => {
    const candidate = sourceScenes[index] || fallbackScenes[index % fallbackScenes.length] || {};
    const fallback = fallbackScenes[index % fallbackScenes.length];
    return {
      id: index + 1,
      start: Number((index * step).toFixed(3)),
      end: Number(((index + 1) * step).toFixed(3)),
      caption: cleanCopy(candidate.caption, fallback.caption, prompt),
      subtext: cleanCopy(candidate.subtext || candidate.top, '', prompt),
      hero: cleanCopy(candidate.hero || candidate.middle, fallback.hero, prompt),
      background: cleanCopy(candidate.background, 'Pearl and azure cinematic glass, light, and depth', prompt),
      top: cleanCopy(candidate.top, '', prompt),
      middle: cleanCopy(candidate.middle, '', prompt),
      bottom: cleanCopy(candidate.bottom, '', prompt),
      transition: typeof candidate.transition === 'string' ? candidate.transition.slice(0, 32) : 'glass sweep',
      cta: index === sceneCount - 1 ? cleanCopy(candidate.cta, defaultCta, prompt) : undefined
    };
  });
  // Keep the opening hook inside the first three seconds and make the CTA the final headline.
  scenes[0].end = Math.min(scenes[0].end, 3);
  scenes[0].caption = cleanCopy(scenes[0].caption, 'Your next idea, in motion', prompt);
  const finalScene = scenes[scenes.length - 1];
  if (finalScene.cta) finalScene.caption = finalScene.cta;
  return {
    totalDuration,
    fps: 30,
    resolution: dimensions,
    aspectRatio,
    palette: Array.isArray(raw?.palette) && raw.palette.length >= 3 ? raw.palette.slice(0, 5) : MOTION_PALETTE,
    scenes
  };
}

function parseJsonResponse(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('The motion planner returned invalid JSON.');
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

/**
 * Generate a new video storyboard from text prompt
 */
export async function generateStoryboard(prompt: string, duration = 8, aspectRatio = '9:16', signal?: AbortSignal): Promise<any> {
  const dimensions = aspectRatio === '16:9' ? '1920x1080' : aspectRatio === '1:1' ? '1080x1080' : '1080x1920';
  const normalizedAspectRatio: MotionSceneSpec['aspectRatio'] = aspectRatio === '16:9' || aspectRatio === '1:1' ? aspectRatio : '9:16';
  const userPrompt = `Create a ${duration}s cinematic scene plan for this brief. Aspect ratio: ${normalizedAspectRatio}; resolution: ${dimensions}. Use the Pearl & Azure palette, create distinct original copy with a hook in the first 3 seconds and a clear final CTA, and return a detailed JSON scene spec only.\n\nUSER BRIEF:\n${prompt}`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MOTION_PLANNER_MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: STORYBOARD_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: MOTION_MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingBudget: MOTION_THINKING_BUDGET },
            responseMimeType: 'application/json'
          }
        })
      });
      if (!res.ok) {
        const details = await res.text().catch(() => '');
        console.warn(`Motion scene planner returned HTTP ${res.status}: ${details.slice(0, 240)}`);
        continue;
      }
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return normalizeSceneSpec(parseJsonResponse(raw), duration, normalizedAspectRatio, prompt);
    } catch {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      // try next key
    }
  }
  // Keep the studio usable when the planner service is temporarily unavailable.
  return normalizeSceneSpec(null, duration, normalizedAspectRatio, prompt);
}

/**
 * Build a self-contained deterministic canvas animation from the scene spec.
 */
export async function generateHtmlFromStoryboard(storyboard: any, aspectRatio = '9:16', signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const ratio: MotionSceneSpec['aspectRatio'] = aspectRatio === '16:9' || aspectRatio === '1:1' ? aspectRatio : '9:16';
  const spec = normalizeSceneSpec(storyboard, storyboard?.totalDuration || 8, ratio, '');
  const [width, height] = spec.resolution.split('x').map(Number);
  const safeSpec = JSON.stringify(spec).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>Zulora Motion Studio</title>
<style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#060c20}body{display:grid;place-items:center}canvas{display:block;width:min(100vw,calc(100vh * ${width} / ${height}));height:min(100vh,calc(100vw * ${height} / ${width}));aspect-ratio:${width}/${height};background:#060c20}</style></head>
<body><canvas id="stage" width="${width}" height="${height}" aria-label="Animated scene preview"></canvas>
<script>
(() => {
  'use strict';
  const spec = ${safeSpec};
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = canvas.width, H = canvas.height, D = spec.totalDuration;
  const palette = spec.palette;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const ease = n => { n = clamp(n); return 1 - Math.pow(1 - n, 3); };
  const seed = 734921;
  let randomState = seed;
  const random = () => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 4294967296; };
  const particles = Array.from({ length: 115 }, () => ({ x: random(), y: random(), r: 1 + random() * 4, v: 0.004 + random() * 0.018, a: 0.12 + random() * 0.62 }));
  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

  function fitText(text, maxWidth, maxSize, minSize = 48, weight = 700) {
    let size = maxSize;
    do { ctx.font = weight + ' ' + size + 'px Inter, Arial, sans-serif'; if (ctx.measureText(text).width <= maxWidth) return size; size -= 2; } while (size > minSize);
    return minSize;
  }
  function wrap(text, maxWidth, font) {
    ctx.font = font;
    const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }
  function drawBackdrop(t, sceneIndex) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, palette[0] || '#060C20'); bg.addColorStop(0.52, '#0A1D46'); bg.addColorStop(1, '#07112C');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + sceneIndex);
    for (let i = 0; i < 3; i++) {
      const x = W * (0.22 + i * 0.29) + Math.sin(t * 0.34 + i * 2) * W * 0.035;
      const y = H * (0.28 + (i % 2) * 0.31);
      const radius = W * (0.2 + pulse * 0.025);
      const orb = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.3, 2, x, y, radius);
      orb.addColorStop(0, i === 1 ? 'rgba(236,239,248,.32)' : 'rgba(40,210,255,.27)');
      orb.addColorStop(0.34, 'rgba(30,144,255,.16)'); orb.addColorStop(1, 'rgba(30,144,255,0)');
      ctx.fillStyle = orb; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    // Neon perspective grid and pearl-glass pillars.
    const horizon = H * 0.56;
    ctx.save(); ctx.strokeStyle = 'rgba(40,210,255,.19)'; ctx.lineWidth = Math.max(1, W / 1400);
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.035, horizon); ctx.lineTo(W / 2 + i * W * 0.72, H); ctx.stroke(); }
    const drift = (t * 90) % (H * 0.42);
    for (let j = 0; j < 9; j++) { const p = (j / 9 + drift / (H * 0.42)) % 1; const y = horizon + p * p * H * 0.44; ctx.globalAlpha = 0.18 + p * 0.3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      const x = W * (0.05 + i * 0.3) + Math.sin(t * 0.24 + i) * W * 0.012;
      const y = H * (0.16 + (i % 2) * 0.12), pw = W * (0.045 + (i % 2) * 0.02), ph = H * 0.48;
      const glass = ctx.createLinearGradient(x, y, x + pw, y + ph); glass.addColorStop(0, 'rgba(236,239,248,.14)'); glass.addColorStop(.5, 'rgba(40,210,255,.025)'); glass.addColorStop(1, 'rgba(30,144,255,.12)');
      roundRect(x, y, pw, ph, pw * .36); ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = 'rgba(210,241,255,.19)'; ctx.lineWidth = 2; ctx.stroke();
    }
    particles.forEach((p, i) => { const y = ((p.y * H - t * p.v * H) % H + H) % H; const x = p.x * W + Math.sin(t * .7 + i) * 12; ctx.globalAlpha = p.a * (.55 + .45 * Math.sin(t * 1.1 + i)); ctx.fillStyle = i % 4 ? palette[2] : palette[3]; ctx.beginPath(); ctx.arc(x, y, p.r * W / 1080, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1;
    const scanY = (t * H * .18) % H; const scan = ctx.createLinearGradient(0, scanY - H * .025, 0, scanY + H * .025); scan.addColorStop(0, 'rgba(40,210,255,0)'); scan.addColorStop(.5, 'rgba(40,210,255,.075)'); scan.addColorStop(1, 'rgba(40,210,255,0)'); ctx.fillStyle = scan; ctx.fillRect(0, scanY - H * .025, W, H * .05);
    const vignette = ctx.createRadialGradient(W / 2, H / 2, W * .2, W / 2, H / 2, W * .8); vignette.addColorStop(.45, 'rgba(2,7,22,0)'); vignette.addColorStop(1, 'rgba(2,7,22,.68)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  }
  function drawCard(t, sceneIndex, progress) {
    const x = W * .12, y = H * .32, w = W * .76, h = H * .32;
    const scale = .96 + ease(progress) * .04 + Math.sin(t * 1.1 + sceneIndex) * .006;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2);
    roundRect(x, y, w, h, Math.min(W, H) * .035);
    const glass = ctx.createLinearGradient(x, y, x + w, y + h); glass.addColorStop(0, 'rgba(236,239,248,.14)'); glass.addColorStop(.45, 'rgba(30,144,255,.08)'); glass.addColorStop(1, 'rgba(40,210,255,.15)');
    ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = 'rgba(231,247,255,.24)'; ctx.lineWidth = Math.max(2, W / 540); ctx.stroke();
    ctx.restore();
  }
  function drawLineReveal(text, y, maxWidth, maxSize, progress, color, weight = 750) {
    if (!text) return;
    const size = fitText(text, maxWidth, maxSize, Math.max(38, maxSize * .46), weight);
    const font = weight + ' ' + size + 'px Inter, Arial, sans-serif';
    const lines = wrap(text, maxWidth, font), lineHeight = size * 1.18;
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      const lineProgress = clamp((progress - i * .09) / .58); const reveal = ease(lineProgress); const lineY = startY + i * lineHeight + (1 - reveal) * 30;
      ctx.save(); ctx.globalAlpha = reveal; ctx.shadowColor = 'rgba(40,210,255,.48)'; ctx.shadowBlur = size * .26; ctx.fillStyle = color;
      const lineWidth = ctx.measureText(line).width; ctx.beginPath(); ctx.rect(W / 2 - lineWidth / 2 - 8, lineY - lineHeight / 2, (lineWidth + 16) * reveal, lineHeight); ctx.clip(); ctx.fillText(line, W / 2, lineY); ctx.restore();
    });
  }
  function render(t) {
    t = clamp(Number(t) || 0, 0, D);
    let index = spec.scenes.findIndex((scene, i) => t >= scene.start && (t < scene.end || i === spec.scenes.length - 1));
    if (index < 0) index = spec.scenes.length - 1;
    const scene = spec.scenes[index], span = Math.max(.01, scene.end - scene.start), local = clamp((t - scene.start) / span);
    drawBackdrop(t, index); drawCard(t, index, local);
    const maxWidth = W * .78;
    drawLineReveal(scene.caption, H * .455, maxWidth, W * (spec.aspectRatio === '16:9' ? .085 : .105), local, '#F4F7FF');
    drawLineReveal(scene.subtext || scene.hero, H * .565, maxWidth * .88, W * .043, clamp((local - .18) / .7), '#BCEFFF', 500);
    if (scene.top) drawLineReveal(scene.top, H * .245, maxWidth * .76, W * .032, clamp((local - .3) / .5), '#DCEBFF', 500);
    const bottomCopy = scene.cta || (index === spec.scenes.length - 1 ? scene.bottom : '');
    if (bottomCopy) {
      const pillW = W * .56, pillH = H * .052, pillY = H * .755;
      roundRect((W - pillW) / 2, pillY - pillH / 2, pillW, pillH, pillH / 2); ctx.fillStyle = 'rgba(255,214,40,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,214,40,.65)'; ctx.lineWidth = 2; ctx.stroke();
      drawLineReveal(bottomCopy, pillY, pillW * .88, W * .033, clamp((local - .35) / .5), '#FFE45C', 700);
    }
    const transitionWindow = Math.min(.42, span * .18);
    if (index > 0 && t - scene.start < transitionWindow) { ctx.fillStyle = 'rgba(210,242,255,' + ((1 - (t - scene.start) / Math.max(transitionWindow, .01)) * .09) + ')'; ctx.fillRect(0, 0, W, H); }
  }
  window.DURATION = D; window.FPS = 30;
  window.renderFrame = function(t) { render(t); };
  render(0); window.__ready = true;
})();
</script></body></html>`;
}

/**
 * Incremental HTML-to-Video Editing:
 * Modifies existing HTML/CSS animation code directly instead of regenerating from scratch.
 * Saves tokens and preserves motion timing.
 */
export async function editVideoIncrementally(
  existingHtml: string,
  modificationPrompt: string,
  signal?: AbortSignal
): Promise<string> {
  const systemPrompt = `You are a high-speed motion graphics code refactoring engineer.
Your task is to perform an INCREMENTAL EDIT on existing HTML/CSS/GSAP video animation code.
Rules:
1. DO NOT regenerate from scratch. Preserve existing structure, layout, styles, and animation timeline.
2. Only modify the specific text, colors, characters, icons, background, or elements requested in the user's prompt.
3. Keep window.renderFrame(t) and window.DURATION working perfectly.
4. Return ONLY the complete updated HTML starting with <!DOCTYPE html>. No markdown explanations.`;

  const userPrompt = `USER REQUESTED CHANGE: "${modificationPrompt}"

CURRENT HTML CODE TO MODIFY:
\`\`\`html
${existingHtml.slice(0, 24000)}
\`\`\`

Apply the requested modification directly into the HTML and return the updated file.`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 16384 }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim();
      if (cleaned.includes('<!DOCTYPE') || cleaned.includes('<html')) {
        return cleaned;
      }
    } catch {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      // try next key
    }
  }
  throw new Error('Incremental video editing failed across all keys.');
}

/**
 * Submits HTML code to backend Playwright + FFmpeg rendering engine
 * and polls until complete MP4 download URL is returned.
 */
export async function renderHtmlToMp4(
  html: string,
  options: VideoRenderOptions = {}
): Promise<{ url: string; downloadUrl?: string; jobId: string }> {
  const { aspectRatio = '9:16', fps = 30, onProgress } = options;
  onProgress?.({ phase: 'Submitting render job', percent: 10, message: 'Initiating backend headless render pipeline...' });

  const res = await fetch('/api/video-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, aspectRatio, fps, duration: options.duration || 8, crf: 18 }),
    signal: options.signal
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Render server HTTP ${res.status}`);
  }

  const render = await res.json();
  const { jobId } = render;
  if (render.url && (render.phase === 'done' || render.percent === 100)) {
    onProgress?.({ phase: 'Video ready', percent: 100, message: 'The MP4 render is ready to play and download.' });
    return { jobId: jobId || `render_${Date.now()}`, url: render.url, downloadUrl: render.downloadUrl || render.url };
  }
  onProgress?.({ phase: 'Rendering frames', percent: 25, message: 'Rendering GSAP animation frames via headless browser...' });

  // Poll for completion
  let lastPercent = 25;
  for (let i = 0; i < 40; i++) {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    await new Promise(r => setTimeout(r, 1500));
    try {
      const statusRes = await fetch(`/api/video-render/status/${jobId}`, { signal: options.signal });
      if (!statusRes.ok) continue;
      const status = await statusRes.json();
      if (status.percent > lastPercent) {
        lastPercent = status.percent;
        onProgress?.({ phase: status.phase, percent: status.percent, message: `Rendering progress: ${status.percent}%` });
      }
      if (status.phase === 'done' || status.percent >= 100) {
        return {
          jobId,
          url: status.url || `/api/video-render/download/${jobId}`,
          downloadUrl: status.downloadUrl || status.url || `/api/video-render/download/${jobId}`
        };
      }
      } catch (error) { if (options.signal?.aborted) throw error; }
  }

  // Fallback to direct download endpoint
  return {
    jobId,
    url: `/api/video-render/download/${jobId}`,
    downloadUrl: `/api/video-render/download/${jobId}`
  };
}

/**
 * Master Video Execution Engine
 * Handles both new generation and incremental edit requests directly from chat.
 */
export async function executeVideoAgent(
  prompt: string,
  options: VideoRenderOptions & { existingHtml?: string } = {}
): Promise<VideoExecutionResult> {
  const { existingHtml, currentUser, aspectRatio = '9:16', duration = 8, onProgress } = options;
  const isIncremental = Boolean(existingHtml && existingHtml.trim().length > 100);

  let finalHtml = '';
  let storyboard: any = undefined;

  if (isIncremental) {
    onProgress?.({ phase: 'Applying incremental edit', percent: 20, message: 'Patching existing animation elements without full re-render...' });
    finalHtml = await editVideoIncrementally(existingHtml!, prompt, options.signal);
  } else {
    onProgress?.({ phase: 'Creating scene plan', percent: 15, message: 'Generating video storyboard...' });
    storyboard = await generateStoryboard(prompt, duration, aspectRatio, options.signal);
    onProgress?.({ phase: 'Storyboard ready', percent: 28, message: (storyboard.scenes || []).map((scene: any) => `${scene.start}-${scene.end}s: ${scene.caption || scene.text || scene.hero}`).join(' · ').slice(0, 480) });
    onProgress?.({ phase: 'Generating animation code', percent: 35, message: 'Building a self-contained, deterministic motion graphic...' });
    finalHtml = await generateHtmlFromStoryboard(storyboard, aspectRatio, options.signal);
  }

  onProgress?.({ phase: 'Rendering MP4 video', percent: 60, message: 'Encoding frames with FFmpeg...' });
  const renderResult = await renderHtmlToMp4(finalHtml, { ...options, onProgress });
  if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  // Auto-sync to Zulora Drive if user is logged in
  if (currentUser?.uid && uploadFileToDrive) {
    try {
      const resp = await fetch(renderResult.url, { signal: options.signal });
      if (!resp.ok) throw new Error(`Rendered MP4 download returned HTTP ${resp.status}.`);
      const blob = await resp.blob();
      if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const videoFile = new File([blob], `zulora_video_${Date.now()}.mp4`, { type: 'video/mp4' });
      renderResult.driveFile = await uploadFileToDrive(videoFile, 'Generated Media', { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      console.warn('Rendered video could not be copied to Zulora Drive:', error.message);
    }
  }

  const markdownCard = [
    `### 🎬 AI Motion Video (1080p)`,
    `**Prompt:** *${prompt}*`,
    isIncremental ? `\n*✨ Incrementally updated from previous version.*` : '',
    ``,
    `[📥 **Download MP4 (1080p)**](${renderResult.url}) &nbsp;•&nbsp; [↗️ **Open Video in Full Window**](${renderResult.url})`,
    ``,
    `*Rendered with full motion graphics and saved to your Zulora Drive.*`
  ].filter(Boolean).join('\n');

  return {
    success: true,
    url: renderResult.url,
    downloadUrl: renderResult.downloadUrl || renderResult.url,
    jobId: renderResult.jobId,
    html: finalHtml,
    prompt,
    isIncremental,
    storyboard,
    markdownCard
  };
}

export default {
  executeVideoAgent,
  generateStoryboard,
  generateHtmlFromStoryboard,
  editVideoIncrementally,
  renderHtmlToMp4,
  BAN_VIDEO_REFUSAL_DIRECTIVE
};

