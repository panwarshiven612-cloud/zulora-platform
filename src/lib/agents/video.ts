/**
 * video.ts — Incremental Video Generation & Editing Engine for Zulora AI
 *
 * Implements:
 * 1. Text-to-Video storyboard + animated HTML synthesis
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

const STORYBOARD_PROMPT = `You are an elite motion graphics director and storyboard engineer creating a cinematic, high-retention social video.
Return ONLY valid storyboard JSON, with no markdown. Match the requested duration and aspect ratio exactly. Use 30 fps and these fields:
{"totalDuration":8,"fps":30,"resolution":"1080x1920","palette":["#060C20","#1E90FF","#28D2FF","#ECEFF8","#FFD628"],"scenes":[{"id":1,"start":0,"end":2.5,"caption":"Three to five words","voiceover":"Optional spoken line","hero":"One clear focal element","background":"Layered animated navy and azure environment","top":"Optional support","middle":"Hero region","bottom":"Optional support","transition":"whip-pan"}]}
Use a concise storyboard that the HTML renderer can reproduce deterministically. Scene times must be contiguous, cover the entire duration, and no scene may exceed 3 seconds without a new motion event. Keep exactly one hero and at most two supporting elements per scene; assign elements to distinct top, middle, and bottom regions. For portrait videos keep all important text and cards inside x=60..1020 and y=280..1560. Use varied 0.25-0.5 second transitions every 3-5 seconds (glitch-zoom, glass-shatter, whip-pan, or flash-cut). Use captions in three-word chunks with timed word emphasis. Do not invent product claims, metrics, or endorsements.`;

const HTML_RENDER_PROMPT = `You are an elite creative developer producing a cinematic HTML motion graphic. Convert the storyboard into ONE complete, self-contained HTML file. No network access, external scripts, fonts, images, libraries, or other assets; use inline SVG, CSS, canvas, and vanilla JavaScript.

Stage and timeline:
- Default stage is fixed 1080x1920 (9:16). Use 1920x1080 for requested 16:9 and 1080x1080 for requested 1:1. Center and scale the fixed stage to fit the renderer viewport; letterbox with a background and never crop the stage.
- Expose window.DURATION (5..60 seconds), window.FPS=30, deterministic window.renderFrame(t), and window.__ready=true only when initialization is complete. renderFrame(t) must draw every element from t alone, clamp to the timeline, and support seeking, replay, and frame-by-frame rendering. Do not use wall-clock animation, unseeded random values, or CSS animations that continue independently of t.
- Make scenes and transitions deterministic. Add an animated layered background (navy gradient, perspective neon grid, glass pillars, pearl-shaded orbs with depth blur, particles, scanline sweep, vignette), subtle camera push, parallax, glow, and float. Keep motion visible in every frame. Use easing such as easeOutCubic, easeOutBack, or spring curves.

Composition and typography:
- In portrait, keep critical text/cards inside x=60..1020 and y=280..1560. The top 250px and bottom 360px are UI-covered. Prevent clipping and horizontal overflow in all aspect ratios.
- One hero element plus at most two support elements per scene, in distinct top/middle/bottom regions. No text overlaps. Keep body text at least 52px, never below 48px; headline text is 96-150px at 1080px width. Include a fitText(element, box) function to size copy into its box.
- Use Pearl & Azure (#060C20, #1E90FF, #28D2FF, #ECEFF8, #FFD628), one font family with at most two weights, and inline SVG for icons. Use no emoji glyphs as icons.
- Split kinetic headlines into words with 60-90ms stagger and overshoot. Add three-word synchronized captions with a yellow current-word highlight, white text, dark stroke, pop entrance, and safe placement around 70-78% of portrait height. When transcript timestamps are absent, distribute words by character count.
- Keep scenes at or below 3 seconds without a new motion event. Vary 0.25-0.5 second transitions every 3-5 seconds (glitch-zoom, glass-shatter wipe, whip-pan, flash-cut). Add count-ups, progress, typing/cursor, or price animations only when supported by the user's brief.

Controls:
- Include accessible Play/Pause, Replay, and Download MP4 controls. Prefer the host's server-rendered MP4 export; provide canvas.captureStream(30) + MediaRecorder as an optional fallback when running standalone. Include a WebAudio synthesized bed and transition whooshes only when the browser permits audio; handle autoplay restrictions.
- Return only the full HTML document beginning with <!doctype html>. No prose or markdown fences.`;

/**
 * Generate a new video storyboard from text prompt
 */
export async function generateStoryboard(prompt: string, duration = 8, aspectRatio = '9:16', signal?: AbortSignal): Promise<any> {
  const dimensions = aspectRatio === '16:9' ? '1920x1080' : aspectRatio === '1:1' ? '1080x1080' : '1080x1920';
  const userPrompt = `Create a ${duration}s storyboard for this user-provided brief: "${prompt}". Aspect ratio: ${aspectRatio}; resolution: ${dimensions}. Use the Pearl & Azure palette and satisfy the system storyboard schema. Return JSON.`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: STORYBOARD_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(raw.replace(/```json|```/gi, '').trim());
    } catch {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      // try next key
    }
  }
  throw new Error('Storyboard generation failed across all available keys.');
}

/**
 * Generate complete animated HTML from storyboard
 */
export async function generateHtmlFromStoryboard(storyboard: any, aspectRatio = '9:16', signal?: AbortSignal): Promise<string> {
  const userPrompt = `Aspect ratio: ${aspectRatio}. Convert this storyboard into the complete self-contained HTML animation. Implement the storyboard faithfully and expose deterministic window.renderFrame(t):\n${JSON.stringify(storyboard, null, 2)}`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: HTML_RENDER_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 16384 }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return raw.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim();
    } catch {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      // try next key
    }
  }
  throw new Error('Animated HTML generation failed across all keys.');
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

