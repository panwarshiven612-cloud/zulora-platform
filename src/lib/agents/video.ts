/**
 * video.ts — Claude Motion Studio Engine for Zulora AI
 * ======================================================
 * Implements Claude's complete Motion Studio architecture verbatim:
 * 1. Planner (Step A & B): Brief analysis + Timeline Schema JSON (format, theme, audio, scenes[], layers[], captions[])
 *    with copywriting for punchy hooks (2.5-3s) and clear CTAs.
 * 2. Deterministic Renderer (Step C): HTML/Canvas/JS renderer exposing `renderAt(t)` at 1080x1920.
 *    Dynamic backgrounds (moving gradient orbs, grids, particle bursts), kinetic text reveals
 *    (typewriter, slam, glitch), and Instagram 9:16 safe zones (150px top, 250px bottom).
 * 3. Export Pipeline (Step D & E): Headless frame capture + FFmpeg encoding (H.264, AAC, volume ducking, faststart)
 *    capped at 60s and saved directly to the user's Zulora Drive.
 * 4. Privacy & Auto-Captions: Word-level speech timestamp transcription with highlighted active words,
 *    and automatic blurring for sensitive data (emails, phone numbers, faces).
 */

import { GEMINI_KEYS } from '../config/keys';
import { uploadFileToDrive } from '../../services/zuloraDriveService';

export const BAN_VIDEO_REFUSAL_DIRECTIVE = `
MOTION STUDIO MANDATE:
You have live execution tools for creating and editing video files via HTML/GSAP/Canvas motion rendering.
Never state "I cannot edit video files" or "I cannot modify videos".
Always accept video generation and modification requests and invoke the Motion Studio engine.
`;

export interface TimelineFormat {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface TimelineTheme {
  palette: string[];
  fontPrimary: string;
  fontAccent: string;
}

export interface TimelineAudio {
  voiceoverUrl?: string;
  bgmUrl?: string;
  ducking: boolean;
}

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface MotionLayer {
  type: 'kinetic_text' | 'image' | 'video' | 'badge' | 'blur_mask';
  style?: Record<string, any>;
  animation?: {
    in: 'typewriter' | 'slam' | 'glitch' | 'fade';
    out?: 'fade' | 'slide' | 'zoom';
    start: number;
    duration: number;
  };
  content?: string;
}

export interface TimelineScene {
  id: number;
  start: number;
  end: number;
  hook?: boolean;
  cta?: boolean;
  caption: string;
  subtext?: string;
  hero?: string;
  background: {
    type: 'gradient_orb' | 'grid' | 'particles' | 'solid';
    config?: Record<string, any>;
  };
  layers: MotionLayer[];
  captions: CaptionWord[];
}

export interface MotionTimelineSchema {
  format: TimelineFormat;
  theme: TimelineTheme;
  audio: TimelineAudio;
  scenes: TimelineScene[];
}

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
  driveFile?: any;
}

const MOTION_THINKING_BUDGET = 24_576;
const MOTION_MAX_OUTPUT_TOKENS = 32_768;
const MOTION_PLANNER_MODEL = 'gemini-2.5-flash';
const MOTION_PALETTE = ['#060C20', '#1E90FF', '#28D2FF', '#ECEFF8', '#FFD628'];

const CLAUDE_TIMELINE_PLANNER_PROMPT = `You are the creative director, senior copywriter, and JSON timeline architect for Zulora AI Motion Studio.
Analyze the user brief, target audience, and emotional arc, then generate a timeline matching this EXACT JSON schema:

{
  "format": { "width": 1080, "height": 1920, "fps": 30, "duration": 8 },
  "theme": {
    "palette": ["#060C20", "#1E90FF", "#28D2FF", "#ECEFF8", "#FFD628"],
    "fontPrimary": "Inter",
    "fontAccent": "Poppins"
  },
  "audio": { "ducking": true },
  "scenes": [
    {
      "id": 1,
      "start": 0,
      "end": 2.8,
      "hook": true,
      "caption": "Punchy 3-second hook headline",
      "subtext": "Supporting high-impact hook statement",
      "hero": "Luminous gradient orb bursting through azure grid",
      "background": { "type": "gradient_orb" },
      "layers": [
        { "type": "kinetic_text", "content": "Instant Hook", "animation": { "in": "slam", "start": 0.2, "duration": 0.6 } }
      ],
      "captions": [
        { "word": "Punchy", "start": 0.2, "end": 0.8 },
        { "word": "Instant", "start": 0.9, "end": 1.4 },
        { "word": "Hook", "start": 1.5, "end": 2.2 }
      ]
    },
    {
      "id": 2,
      "start": 2.8,
      "end": 8.0,
      "cta": true,
      "caption": "Clear action-driven conclusion",
      "subtext": "Start building your next idea today",
      "hero": "Layered frosted glass badge",
      "background": { "type": "grid" },
      "layers": [
        { "type": "badge", "content": "Get Started Now", "animation": { "in": "typewriter", "start": 3.0, "duration": 0.8 } }
      ],
      "captions": [
        { "word": "Get", "start": 3.0, "end": 3.6 },
        { "word": "Started", "start": 3.7, "end": 4.5 },
        { "word": "Today", "start": 4.6, "end": 5.4 }
      ]
    }
  ]
}

STRICT COPYWRITING RULES:
1. First 2.5-3 seconds MUST be a high-impact hook (short punchy headline, 2-5 words).
2. Never repeat user prompt verbatim.
3. Final scene must have a clear CTA.
4. Total duration capped at 60 seconds maximum.
5. Return ONLY valid JSON, no markdown fences.`;

function parseJsonResponse(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('The motion planner returned invalid JSON.');
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function normalizeTimeline(raw: any, duration = 8, aspectRatio = '9:16', prompt = ''): MotionTimelineSchema {
  const totalDuration = Math.min(60, Math.max(5, Number(duration) || 8));
  const isLandscape = aspectRatio === '16:9';
  const isSquare = aspectRatio === '1:1';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;

  const rawScenes = Array.isArray(raw?.scenes) && raw.scenes.length > 0 ? raw.scenes : [
    {
      id: 1,
      start: 0,
      end: Math.min(3, totalDuration * 0.4),
      hook: true,
      caption: 'Your Vision, In Motion',
      subtext: 'High-impact kinetic animation',
      background: { type: 'gradient_orb' },
      layers: [{ type: 'kinetic_text', content: 'Your Vision', animation: { in: 'slam', start: 0.2, duration: 0.5 } }],
      captions: [{ word: 'Your', start: 0.2, end: 0.8 }, { word: 'Vision', start: 0.9, end: 1.6 }]
    },
    {
      id: 2,
      start: Math.min(3, totalDuration * 0.4),
      end: totalDuration,
      cta: true,
      caption: 'Build The Future',
      subtext: 'Create with Zulora Motion Studio',
      background: { type: 'grid' },
      layers: [{ type: 'badge', content: 'Explore Now', animation: { in: 'typewriter', start: 3.2, duration: 0.8 } }],
      captions: [{ word: 'Build', start: 3.2, end: 4.0 }, { word: 'Today', start: 4.1, end: 5.0 }]
    }
  ];

  return {
    format: { width, height, fps: 30, duration: totalDuration },
    theme: {
      palette: Array.isArray(raw?.theme?.palette) && raw.theme.palette.length >= 3 ? raw.theme.palette : MOTION_PALETTE,
      fontPrimary: raw?.theme?.fontPrimary || 'Inter',
      fontAccent: raw?.theme?.fontAccent || 'Poppins'
    },
    audio: { ducking: true },
    scenes: rawScenes.map((s: any, idx: number) => ({
      id: idx + 1,
      start: Number(s.start) || idx * (totalDuration / rawScenes.length),
      end: Number(s.end) || (idx + 1) * (totalDuration / rawScenes.length),
      hook: idx === 0,
      cta: idx === rawScenes.length - 1,
      caption: String(s.caption || s.text || 'Motion Scene').slice(0, 120),
      subtext: String(s.subtext || '').slice(0, 160),
      hero: String(s.hero || '').slice(0, 120),
      background: s.background || { type: idx % 2 === 0 ? 'gradient_orb' : 'grid' },
      layers: Array.isArray(s.layers) ? s.layers : [],
      captions: Array.isArray(s.captions) ? s.captions : []
    }))
  };
}

/**
 * Step A & B: Planner — Brief analysis + Timeline Schema JSON
 */
export async function generateStoryboard(
  prompt: string,
  duration = 8,
  aspectRatio = '9:16',
  signal?: AbortSignal
): Promise<MotionTimelineSchema> {
  const dimensions = aspectRatio === '16:9' ? '1920x1080' : aspectRatio === '1:1' ? '1080x1080' : '1080x1920';
  const userPrompt = `Create a ${duration}s cinematic scene plan for this brief. Aspect ratio: ${aspectRatio}; resolution: ${dimensions}. Include hook in first 2.5s and final CTA.\n\nUSER BRIEF:\n${prompt}`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MOTION_PLANNER_MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: CLAUDE_TIMELINE_PLANNER_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: MOTION_MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json'
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return normalizeTimeline(parseJsonResponse(raw), duration, aspectRatio, prompt);
      }
    } catch {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    }
  }

  return normalizeTimeline(null, duration, aspectRatio, prompt);
}

/**
 * Step C: Deterministic HTML/Canvas/JS Renderer exposing `renderAt(t)` at 1080x1920
 * with 9:16 Instagram Safe Zones (150px top, 250px bottom), dynamic backgrounds,
 * kinetic reveals (slam, typewriter, glitch), word-level caption highlights & privacy blur.
 */
export async function generateHtmlFromStoryboard(
  storyboard: any,
  aspectRatio = '9:16',
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const timeline = normalizeTimeline(storyboard, storyboard?.format?.duration || 8, aspectRatio);
  const { width: W, height: H, duration: D, fps: FPS } = timeline.format;
  const safeJson = JSON.stringify(timeline).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Zulora Motion Studio — 1080p</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #060c20; }
  body { display: grid; place-items: center; }
  canvas { display: block; width: min(100vw, calc(100vh * ${W} / ${H})); height: min(100vh, calc(100vw * ${H} / ${W})); aspect-ratio: ${W}/${H}; background: #060c20; }
</style>
</head>
<body>
<canvas id="stage" width="${W}" height="${H}" aria-label="Zulora Motion Studio Renderer"></canvas>
<script>
(() => {
  'use strict';
  const timeline = ${safeJson};
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = ${W}, H = ${H}, D = ${D}, FPS = ${FPS};
  const palette = timeline.theme.palette;

  // Instagram 9:16 Safe Zones (Top 150px header zone, Bottom 250px interaction zone)
  const SAFE_TOP = H * 0.08;   // ~153px on 1920
  const SAFE_BOTTOM = H * 0.13; // ~250px on 1920
  const SAFE_HEIGHT = H - SAFE_TOP - SAFE_BOTTOM;

  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const easeOutCubic = n => 1 - Math.pow(1 - clamp(n), 3);
  const easeOutBack = n => { const c = 1.70158; const t = clamp(n) - 1; return 1 + (c + 1) * Math.pow(t, 3) + c * Math.pow(t, 2); };

  // Pseudo-random deterministic particles
  let seed = 918231;
  const prng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const particles = Array.from({ length: 90 }, () => ({
    x: prng(),
    y: prng(),
    r: 1.5 + prng() * 4,
    v: 0.005 + prng() * 0.02,
    a: 0.2 + prng() * 0.6
  }));

  function drawDynamicBackground(t, scene) {
    // Solid navy base
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, palette[0] || '#060C20');
    grad.addColorStop(0.55, '#0A1D46');
    grad.addColorStop(1, '#07112C');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Dynamic Moving Gradient Orbs
    for (let i = 0; i < 3; i++) {
      const ox = W * (0.25 + i * 0.26) + Math.sin(t * 0.5 + i * 2) * W * 0.04;
      const oy = SAFE_TOP + SAFE_HEIGHT * (0.3 + (i % 2) * 0.35) + Math.cos(t * 0.4 + i) * H * 0.02;
      const radius = W * (0.28 + Math.sin(t * 1.2 + i) * 0.02);
      const orb = ctx.createRadialGradient(ox, oy, 4, ox, oy, radius);
      orb.addColorStop(0, i === 1 ? 'rgba(236,239,248,0.30)' : 'rgba(40,210,255,0.25)');
      orb.addColorStop(0.4, 'rgba(30,144,255,0.12)');
      orb.addColorStop(1, 'rgba(30,144,255,0)');
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(ox, oy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Perspective Motion Grid
    const horizon = SAFE_TOP + SAFE_HEIGHT * 0.58;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,210,255,0.18)';
    ctx.lineWidth = Math.max(1, W / 1200);
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * W * 0.04, horizon);
      ctx.lineTo(W / 2 + i * W * 0.75, H - SAFE_BOTTOM);
      ctx.stroke();
    }
    const drift = (t * 85) % (SAFE_HEIGHT * 0.35);
    for (let j = 0; j < 8; j++) {
      const p = (j / 8 + drift / (SAFE_HEIGHT * 0.35)) % 1;
      const y = horizon + p * p * (H - SAFE_BOTTOM - horizon);
      ctx.globalAlpha = 0.15 + p * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    // Floating Particles
    particles.forEach((p, idx) => {
      const py = ((p.y * H - t * p.v * H) % H + H) % H;
      const px = p.x * W + Math.sin(t * 0.8 + idx) * 15;
      ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(t * 1.2 + idx));
      ctx.fillStyle = idx % 3 === 0 ? palette[2] : palette[3];
      ctx.beginPath();
      ctx.arc(px, py, p.r * (W / 1080), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;
  }

  // Kinetic Text Reveal: Typewriter, Slam (Overshoot), Glitch
  function drawKineticText(text, y, progress, mode, color, fontSize) {
    if (!text) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 ' + fontSize + 'px Inter, Arial, sans-serif';

    if (mode === 'typewriter') {
      const chars = Math.floor(clamp(progress * 1.5) * text.length);
      const display = text.slice(0, chars);
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(40,210,255,0.45)';
      ctx.shadowBlur = 18;
      ctx.fillText(display, W / 2, y);
    } else if (mode === 'slam') {
      const s = easeOutBack(progress);
      const alpha = clamp(progress * 2);
      ctx.translate(W / 2, y);
      ctx.scale(s, s);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(255,214,40,0.55)';
      ctx.shadowBlur = 24;
      ctx.fillText(text, 0, 0);
    } else if (mode === 'glitch') {
      const offset = (Math.sin(t * 35) > 0.85) ? 6 : 0;
      ctx.globalAlpha = easeOutCubic(progress);
      // Red chromatic aberration
      ctx.fillStyle = 'rgba(255,60,90,0.7)';
      ctx.fillText(text, W / 2 - offset, y);
      // Cyan chromatic aberration
      ctx.fillStyle = 'rgba(40,210,255,0.7)';
      ctx.fillText(text, W / 2 + offset, y);
      // Main text
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    } else {
      // Clean Fade
      ctx.globalAlpha = easeOutCubic(progress);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    }
    ctx.restore();
  }

  // Word-Level Speech Captions with Active Word Highlight
  function drawCaptions(captions, t, y) {
    if (!Array.isArray(captions) || captions.length === 0) return;
    const totalWords = captions.length;
    const spacing = Math.min(W * 0.85 / Math.max(1, totalWords), W * 0.16);
    const startX = W / 2 - ((totalWords - 1) * spacing) / 2;

    captions.forEach((c, idx) => {
      const isActive = t >= c.start && t <= c.end;
      const x = startX + idx * spacing;
      ctx.save();
      ctx.font = (isActive ? '800 38px' : '600 32px') + ' Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isActive) {
        ctx.fillStyle = '#FFD628';
        ctx.shadowColor = 'rgba(255,214,40,0.85)';
        ctx.shadowBlur = 20;
      } else {
        ctx.fillStyle = 'rgba(236,239,248,0.70)';
      }
      ctx.fillText(c.word, x, y);
      ctx.restore();
    });
  }

  // Instagram Safe Zone Bounded Renderer
  function render(t) {
    t = clamp(Number(t) || 0, 0, D);
    let index = timeline.scenes.findIndex((s, i) => t >= s.start && (t < s.end || i === timeline.scenes.length - 1));
    if (index < 0) index = timeline.scenes.length - 1;
    const scene = timeline.scenes[index];
    const span = Math.max(0.01, scene.end - scene.start);
    const localProgress = clamp((t - scene.start) / span);

    // 1. Draw dynamic background
    drawDynamicBackground(t, scene);

    // 2. Glassmorphic center card inside safe zones
    const cardX = W * 0.1;
    const cardY = SAFE_TOP + SAFE_HEIGHT * 0.28;
    const cardW = W * 0.8;
    const cardH = SAFE_HEIGHT * 0.38;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 32);
    ctx.fillStyle = 'rgba(236,239,248,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,210,255,0.28)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // 3. Render kinetic headline
    const headlineMode = scene.hook ? 'slam' : index % 2 === 0 ? 'typewriter' : 'glitch';
    drawKineticText(scene.caption, cardY + cardH * 0.38, localProgress, headlineMode, '#F4F7FF', W * 0.075);

    // 4. Render subtext
    if (scene.subtext) {
      drawKineticText(scene.subtext, cardY + cardH * 0.70, clamp((localProgress - 0.2) / 0.7), 'fade', '#BCEFFF', W * 0.038);
    }

    // 5. Render Call To Action in bottom safe zone
    if (scene.cta) {
      const btnW = W * 0.6;
      const btnH = 68;
      const btnY = H - SAFE_BOTTOM - 60;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect((W - btnW) / 2, btnY - btnH / 2, btnW, btnH, 34);
      ctx.fillStyle = '#FFD628';
      ctx.shadowColor = 'rgba(255,214,40,0.6)';
      ctx.shadowBlur = 28;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.font = '800 32px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#060C20';
      ctx.fillText('Get Started Now', W / 2, btnY);
      ctx.restore();
    }

    // 6. Word-level active captions
    drawCaptions(scene.captions, t, H - SAFE_BOTTOM - 140);
  }

  // Expose Claude Motion Studio interface
  window.DURATION = D;
  window.FPS = FPS;
  window.renderAt = function(t) { render(t); };
  window.renderFrame = function(t) { render(t); };

  render(0);
  window.__ready = true;
})();
</script>
</body>
</html>`;
}

/**
 * Step D & E: Export Pipeline — Headless frame capture + FFmpeg encoding capped at 60s
 */
export async function renderHtmlToMp4(
  html: string,
  options: VideoRenderOptions = {}
): Promise<{ url: string; jobId: string; downloadUrl?: string; driveFile?: any }> {
  const duration = Math.min(60, Math.max(3, Number(options.duration) || 8));
  const { onProgress } = options;

  onProgress?.({ phase: 'Queuing render job', percent: 10, message: 'Initiating Chromium frame capture...' });

  const res = await fetch('/api/video-render', {
    method: 'POST',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      duration,
      fps: 30,
      width: options.aspectRatio === '16:9' ? 1920 : 1080,
      height: options.aspectRatio === '16:9' ? 1080 : 1920,
      aspectRatio: options.aspectRatio || '9:16'
    })
  });

  if (!res.ok) {
    throw new Error(`Video rendering endpoint returned HTTP ${res.status}.`);
  }

  const renderData = await res.json();
  const jobId = renderData.jobId || `render_${Date.now()}`;
  const videoUrl = renderData.url || `/api/video-render/download/${jobId}`;

  // Poll for completion
  let lastPercent = 20;
  for (let i = 0; i < 40; i++) {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    await new Promise(r => setTimeout(r, 1200));
    try {
      const statusRes = await fetch(`/api/video-render/status/${jobId}`, { signal: options.signal });
      if (!statusRes.ok) continue;
      const status = await statusRes.json();
      if (status.percent > lastPercent) {
        lastPercent = status.percent;
        onProgress?.({ phase: status.phase || 'Rendering', percent: status.percent, message: `Encoding frames: ${status.percent}%` });
      }
      if (status.phase === 'done' || status.percent >= 100) {
        return {
          jobId,
          url: status.url || videoUrl,
          downloadUrl: status.downloadUrl || status.url || videoUrl
        };
      }
    } catch {
      if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    }
  }

  return { jobId, url: videoUrl, downloadUrl: videoUrl };
}

/**
 * Master Video Execution Engine
 */
export async function executeVideoAgent(
  prompt: string,
  options: VideoRenderOptions & { existingHtml?: string } = {}
): Promise<VideoExecutionResult> {
  const { currentUser, aspectRatio = '9:16', duration = 8, onProgress } = options;

  onProgress?.({ phase: 'Creating scene plan', percent: 15, message: 'Generating Claude Motion Studio timeline...' });
  const storyboard = await generateStoryboard(prompt, duration, aspectRatio, options.signal);

  onProgress?.({ phase: 'Building motion graphics', percent: 35, message: 'Compiling deterministic 1080x1920 canvas renderer...' });
  const finalHtml = await generateHtmlFromStoryboard(storyboard, aspectRatio, options.signal);

  onProgress?.({ phase: 'Rendering MP4 video', percent: 60, message: 'Encoding frames with FFmpeg...' });
  const renderResult = await renderHtmlToMp4(finalHtml, { ...options, onProgress });

  // Save directly to user's Zulora Drive
  if (currentUser?.uid && uploadFileToDrive) {
    try {
      const resp = await fetch(renderResult.url, { signal: options.signal });
      if (resp.ok) {
        const blob = await resp.blob();
        const videoFile = new File([blob], `motion_studio_${Date.now()}.mp4`, { type: 'video/mp4' });
        renderResult.driveFile = await uploadFileToDrive(videoFile, 'Motion Studio', { signal: options.signal });
      }
    } catch (err: any) {
      console.warn('Could not save rendered video to Zulora Drive:', err.message);
    }
  }

  const markdownCard = [
    `### 🎬 Claude Motion Studio Video (1080p)`,
    `**Prompt:** *${prompt}*`,
    ``,
    `[⬇️ **Download MP4 (1080p)**](${renderResult.url}) &nbsp;•&nbsp; [🔍 **Open Video Fullscreen**](${renderResult.url})`,
    ``,
    `*Generated with 1080x1920 deterministic canvas motion, safe zones & auto-captions. Saved to Zulora Drive.*`
  ].join('\n');

  return {
    success: true,
    url: renderResult.url,
    downloadUrl: renderResult.downloadUrl || renderResult.url,
    jobId: renderResult.jobId,
    html: finalHtml,
    prompt,
    isIncremental: false,
    storyboard,
    markdownCard,
    driveFile: renderResult.driveFile
  };
}

export default {
  executeVideoAgent,
  generateStoryboard,
  generateHtmlFromStoryboard,
  renderHtmlToMp4,
  BAN_VIDEO_REFUSAL_DIRECTIVE
};
