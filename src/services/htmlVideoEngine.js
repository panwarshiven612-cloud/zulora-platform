/**
 * htmlVideoEngine.js — HTML-to-Video Motion Engine for Zulora AI Video Studio
 * Converts text prompts -> JSON storyboard -> animated HTML -> MP4 (via serverless rendering)
 * Free user daily limit: 5 videos/day stored in Firestore.
 * 
 * Pipeline:
 *  1. Prompt -> Scene plan (JSON storyboard via LLM)
 *  2. Storyboard -> Self-contained animated HTML (LLM + GSAP seek pattern)
 *  3. HTML preview in iframe (live play/pause/scrub)
 *  4. HTML -> frames -> MP4 via server render API (POST /api/video-render)
 */

import { GEMINI_KEYS } from '../lib/config/keys';

export const HTML_VIDEO_DAILY_LIMIT = 5;

export const ASPECT_RATIOS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
};

// ─── Storyboard Generation ────────────────────────────────────────────────────

const STORYBOARD_SYSTEM = `You are a professional motion video director and JSON storyboard engineer.
Generate a precise JSON storyboard for an animated promotional video.

Rules:
- Return ONLY valid JSON, no markdown fences.
- Format:
{
  "totalDuration": 10,
  "fps": 30,
  "resolution": "1920x1080",
  "palette": ["#0ea5e9", "#6366f1", "#0f172a"],
  "fonts": ["Inter", "Poppins"],
  "scenes": [
    {
      "id": 1,
      "start": 0,
      "end": 2.5,
      "text": "Hook text here",
      "layout": "hero",
      "animation": "scaleIn",
      "transition": "fade"
    }
  ]
}
- Each scene has: id, start (seconds), end (seconds), text, layout ("hero" | "split" | "lower-third" | "fullscreen"), animation ("fadeIn" | "slideUp" | "scaleIn" | "textReveal" | "zoomOut"), transition ("fade" | "slide" | "wipe" | "zoom").
- totalDuration must equal last scene end.
- First 2 seconds must be a strong hook scene.`;

const HTML_TEMPLATE_SYSTEM = `You are a senior creative HTML/CSS/JS motion graphics developer.
Convert the storyboard JSON into a single self-contained HTML file that renders an animated video.

STRICT RULES:
1. Fixed canvas: 1920x1080 (or specified resolution), overflow:hidden, margin:0, padding:0.
2. Every scene is a <section> positioned absolutely (top:0, left:0, width:100%, height:100%), stacked via z-index.
3. ALL animation MUST be driven by global function window.renderFrame(t) where t is time in seconds.
4. Use GSAP paused timelines: const tl = gsap.timeline({ paused: true }); window.renderFrame = (t) => tl.seek(t);
5. Load GSAP from: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
6. Expose window.DURATION = totalDuration (number) and window.FPS = 30 (number).
7. Expose window.__ready = true once DOM and GSAP timeline are fully initialized.
8. Seeded pseudo-random generator: expose window.prng = function(seed) { let t = seed || 12345; return function() { t = (t * 9301 + 49297) % 233280; return t / 233280; }; };
9. NO setTimeout, setInterval, or CSS keyframe animations. Only GSAP timeline seek.
10. Inline ALL CSS in <style> block. Inline all JS in <script> blocks.
11. No external network calls except GSAP CDN.
12. Use high-impact motion: fade, slide, scale, text reveal, gradient shifts, counters, clean transitions.
13. First 2 seconds must be a strong hook.
14. Apply the palette colors and fonts from storyboard.

Return ONLY the complete HTML file starting with <!DOCTYPE html>. No markdown code fences.`;

export async function generateStoryboard(prompt, options = {}) {
  const { aspectRatio = '16:9', duration = 10, brand = {} } = options;
  const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];

  const userPrompt = `Create a ${duration}-second video storyboard for: "${prompt}"
Aspect ratio: ${aspectRatio} (${dims.width}x${dims.height})
${brand.colors ? `Brand colors: ${Array.isArray(brand.colors) ? brand.colors.join(', ') : brand.colors}` : ''}
${brand.fonts ? `Brand fonts: ${Array.isArray(brand.fonts) ? brand.fonts.join(', ') : brand.fonts}` : ''}
${brand.tagline ? `Tagline: ${brand.tagline}` : ''}

Return JSON with keys: totalDuration, fps, resolution, palette, fonts, scenes`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: STORYBOARD_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(raw.replace(/```json|```/gi, '').trim());
      if (parsed.scenes?.length) return parsed;
    } catch {
      // try next key in pool
    }
  }

  // Robust fallback storyboard
  return {
    totalDuration: duration,
    fps: 30,
    resolution: `${dims.width}x${dims.height}`,
    palette: ['#0ea5e9', '#6366f1', '#0f172a'],
    fonts: ['Inter', 'Poppins'],
    scenes: [
      { id: 1, start: 0, end: Math.floor(duration * 0.35), text: prompt, layout: 'hero', animation: 'scaleIn', transition: 'fade' },
      { id: 2, start: Math.floor(duration * 0.35), end: Math.floor(duration * 0.75), text: 'Powered by Zulora AI', layout: 'split', animation: 'slideUp', transition: 'wipe' },
      { id: 3, start: Math.floor(duration * 0.75), end: duration, text: 'Experience the Future of Intelligence', layout: 'fullscreen', animation: 'textReveal', transition: 'zoom' }
    ]
  };
}

export async function generateAnimatedHtml(storyboard, userAssets = {}, options = {}) {
  const { aspectRatio = '16:9' } = options;
  const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];

  const userPrompt = `Convert this storyboard into animated HTML:
${JSON.stringify(storyboard, null, 2)}

Canvas Dimensions: ${dims.width}x${dims.height}px
${userAssets.logo ? `Logo base64: ${userAssets.logo.slice(0, 120)}...` : ''}

Return ONLY the complete HTML file starting with <!DOCTYPE html>.`;

  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: HTML_TEMPLATE_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const html = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
      if (cleaned.includes('<!DOCTYPE') || cleaned.includes('<html')) return cleaned;
    } catch {
      // try next key
    }
  }

  // Fallback standalone HTML motion template
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zulora Motion Video</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html { width: ${dims.width}px; height: ${dims.height}px; overflow: hidden; background: #0f172a; font-family: 'Segoe UI', system-ui, sans-serif; }
    .viewport { position: relative; width: ${dims.width}px; height: ${dims.height}px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 50%, #1e1b4b, #0f172a); }
    .scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 60px; opacity: 0; }
    .title { font-size: 72px; font-weight: 800; color: #ffffff; margin-bottom: 24px; line-height: 1.15; max-width: 80%; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { font-size: 36px; font-weight: 500; color: #94a3b8; max-width: 70%; line-height: 1.4; }
    .badge { display: inline-block; padding: 10px 24px; border-radius: 9999px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 22px; font-weight: 700; margin-bottom: 24px; letter-spacing: 0.05em; }
  </style>
</head>
<body>
  <div class="viewport">
    <section class="scene" id="scene1">
      <div class="badge">ZULORA AI STUDIO</div>
      <h1 class="title">${storyboard.scenes?.[0]?.text || 'Next-Gen Video Synthesis'}</h1>
      <p class="subtitle">AI-Driven Motion Graphics Engine</p>
    </section>
    <section class="scene" id="scene2">
      <div class="badge">POWERED BY MOTION AI</div>
      <h1 class="title">${storyboard.scenes?.[1]?.text || 'Sub-Second Creative Intelligence'}</h1>
      <p class="subtitle">Transform ideas directly into high-fidelity video</p>
    </section>
    <section class="scene" id="scene3">
      <div class="badge">GET STARTED</div>
      <h1 class="title">${storyboard.scenes?.[2]?.text || 'Experience Zulora AI Today'}</h1>
      <p class="subtitle">Visit zulora.in to build anything</p>
    </section>
  </div>
  <script>
    window.DURATION = ${storyboard.totalDuration || 10};
    window.FPS = 30;
    window.prng = function(s) { let t = s ? s : 12345; return function() { t = (t * 9301 + 49297) % 233280; return t / 233280; }; };
    const tl = gsap.timeline({ paused: true });
    
    // Scene 1
    tl.to('#scene1', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
      .from('#scene1 .title', { y: 40, scale: 0.95, duration: 1, ease: 'back.out(1.5)' }, 0.2)
      .to('#scene1', { opacity: 0, scale: 1.05, duration: 0.5, ease: 'power2.in' }, 2.8);

    // Scene 2
    tl.to('#scene2', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 3.2)
      .from('#scene2 .title', { y: 40, duration: 1, ease: 'power3.out' }, 3.4)
      .to('#scene2', { opacity: 0, y: -40, duration: 0.5, ease: 'power2.in' }, 6.2);

    // Scene 3
    tl.to('#scene3', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 6.6)
      .from('#scene3 .title', { scale: 0.8, duration: 1.2, ease: 'elastic.out(1, 0.75)' }, 6.8);

    window.renderFrame = function(t) {
      tl.seek(t);
    };
    window.__ready = true;
  </script>
</body>
</html>`;
}

export function validateHtml(html) {
  const errors = [];
  if (!html.includes('window.renderFrame')) errors.push('Missing window.renderFrame function');
  if (!html.includes('window.DURATION')) errors.push('Missing window.DURATION variable');
  if (!html.includes('window.FPS')) errors.push('Missing window.FPS variable');
  if (!html.includes('gsap')) errors.push('Missing GSAP animation library reference');
  if (!html.includes('window.__ready')) errors.push('Missing window.__ready flag');
  if (!html.includes('<!DOCTYPE') && !html.includes('<html')) errors.push('Not a valid HTML document structure');
  return { valid: errors.length === 0, errors };
}

export async function repairHtmlWithRetry(html, errors, storyboard, maxRetries = 3) {
  let current = html;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const repairPrompt = `Fix these errors in the animated video HTML:
${errors.join('\n')}

Broken HTML snippet:
${current.slice(0, 10000)}

Ensure window.renderFrame(t), window.DURATION = ${storyboard.totalDuration || 10}, window.FPS = 30, window.__ready = true, and GSAP are present.
Return only the corrected self-contained HTML file.`;

    for (const key of GEMINI_KEYS) {
      if (!key) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: HTML_TEMPLATE_SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: repairPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
          })
        });
        if (!res.ok) continue;
        const data = await res.json();
        const fixed = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
          .replace(/^```(?:html)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        const validation = validateHtml(fixed);
        if (validation.valid) return fixed;
        current = fixed;
        break;
      } catch {
        // try next key
      }
    }
  }

  // Deterministic local patching for minor missing flags
  if (!current.includes('window.FPS')) {
    current = current.replace('window.DURATION', 'window.FPS = 30;\n    window.DURATION');
  }
  if (!current.includes('window.__ready')) {
    current = current.replace('window.renderFrame', 'window.__ready = true;\n    window.renderFrame');
  }
  return current;
}

// ─── Token-Saving Incremental Edit Loop ───────────────────────────────────────

const INCREMENTAL_EDIT_SYSTEM = `You are a professional video editor and JSON storyboard engineer.
You are given an existing JSON storyboard and a user edit request (e.g., "make scene 2 faster", "change color palette to emerald and cyan", "update scene 1 text to 'Next Generation AI'").
Update ONLY the requested scenes or attributes without regenerating everything from scratch.
Keep the rest of the storyboard intact to save tokens and maintain continuity.
Return ONLY valid JSON matching the storyboard schema: { totalDuration, fps, resolution, palette, fonts, scenes }`;

export async function editStoryboardOrHtml(existingStoryboard, existingHtml, instruction, options = {}) {
  const { aspectRatio = '16:9' } = options;
  if (!existingStoryboard || !instruction) {
    return { storyboard: existingStoryboard, html: existingHtml };
  }

  const userPrompt = `Current Storyboard JSON:
${JSON.stringify(existingStoryboard, null, 2)}

Requested Edit: "${instruction}"

Modify only what was requested. Return ONLY the updated JSON storyboard:`;

  let updatedStoryboard = null;
  for (const key of GEMINI_KEYS) {
    if (!key) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: INCREMENTAL_EDIT_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(raw.replace(/```json|```/gi, '').trim());
      if (parsed.scenes?.length) {
        updatedStoryboard = parsed;
        break;
      }
    } catch {
      // try next key
    }
  }

  if (!updatedStoryboard) {
    updatedStoryboard = { ...existingStoryboard };
  }

  let updatedHtml = await generateAnimatedHtml(updatedStoryboard, {}, { aspectRatio });
  const validation = validateHtml(updatedHtml);
  if (!validation.valid) {
    updatedHtml = await repairHtmlWithRetry(updatedHtml, validation.errors, updatedStoryboard);
  }

  return { storyboard: updatedStoryboard, html: updatedHtml };
}

export const editStoryboard = editStoryboardOrHtml;

export async function checkHtmlVideoDailyQuota(userId, db) {
  if (!userId || !db) return { allowed: true, used: 0, limit: HTML_VIDEO_DAILY_LIMIT };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.data() || {};
    const quota = data.htmlVideoQuota || {};
    if (quota.date !== today) return { allowed: true, used: 0, limit: HTML_VIDEO_DAILY_LIMIT };
    const used = Number(quota.count) || 0;
    return { allowed: used < HTML_VIDEO_DAILY_LIMIT, used, limit: HTML_VIDEO_DAILY_LIMIT };
  } catch {
    return { allowed: true, used: 0, limit: HTML_VIDEO_DAILY_LIMIT };
  }
}

export async function incrementHtmlVideoQuota(userId, db) {
  if (!userId || !db) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.data() || {};
    const quota = data.htmlVideoQuota || {};
    const current = quota.date === today ? (Number(quota.count) || 0) : 0;
    await setDoc(doc(db, 'users', userId), { htmlVideoQuota: { date: today, count: current + 1 } }, { merge: true });
  } catch {
    // ignore
  }
}

export async function submitHtmlVideoRenderJob(html, options = {}) {
  const { aspectRatio = '16:9', fps = 30, onProgress } = options;
  onProgress?.({ phase: 'Submitting render job...', percent: 5 });

  try {
    const res = await fetch('/api/video-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, aspectRatio, fps, crf: 18 })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Render server returned HTTP ${res.status}`);
    }

    const render = await res.json();
    const { jobId } = render;
    if (render.url && (render.phase === 'done' || render.percent === 100)) {
      onProgress?.({ phase: 'Video ready', percent: 100, jobId });
      return { jobId, url: render.url, phase: 'done', percent: 100 };
    }
    onProgress?.({ phase: 'Processing frames...', percent: 20, jobId });

    // Poll for progress up to 90 seconds
    let lastPct = 20;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const statusRes = await fetch(`/api/video-render/status/${jobId}`);
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (status.percent > lastPct) {
          lastPct = status.percent;
          onProgress?.({ ...status, jobId });
        }
        if (status.phase === 'done') {
          return { jobId, url: `/api/video-render/download/${jobId}`, ...status };
        }
      } catch (pollErr) {
        // continue polling
      }
    }

    // Fallback if polling completes
    return {
      jobId,
      url: `/api/video-render/download/${jobId}`,
      phase: 'done',
      percent: 100
    };
  } catch (err) {
    onProgress?.({ phase: 'error', percent: 0, error: err.message });
    throw err;
  }
}

export default {
  generateStoryboard,
  generateAnimatedHtml,
  validateHtml,
  repairHtmlWithRetry,
  editStoryboardOrHtml,
  editStoryboard,
  checkHtmlVideoDailyQuota,
  incrementHtmlVideoQuota,
  submitHtmlVideoRenderJob,
  HTML_VIDEO_DAILY_LIMIT,
  ASPECT_RATIOS
};

