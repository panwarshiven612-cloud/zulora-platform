/**
 * HtmlVideoStudio.jsx — Zulora AI HTML-to-Video Motion Engine UI
 * Transforms prompts -> JSON Storyboard -> Animated GSAP HTML -> Live Preview -> MP4 Export
 * Free user daily quota: 5 videos/day stored in Firestore.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Clapperboard, Play, Pause, Download, RefreshCw, Sparkles,
  Code2, Film, Clock, AlertCircle, CheckCircle, Upload,
  ChevronRight, Zap, Monitor, Sliders, Palette
} from 'lucide-react';
import {
  generateStoryboard,
  generateAnimatedHtml,
  validateHtml,
  repairHtmlWithRetry,
  checkHtmlVideoDailyQuota,
  incrementHtmlVideoQuota,
  submitHtmlVideoRenderJob,
  HTML_VIDEO_DAILY_LIMIT
} from '../services/htmlVideoEngine';
import { db } from '../services/firebase';

const ASPECT_OPTIONS = [
  { value: '16:9', label: '16:9 Landscape', icon: '🖥️' },
  { value: '9:16', label: '9:16 Portrait', icon: '📱' },
  { value: '1:1',  label: '1:1 Square',    icon: '⬜' },
];

const DURATION_OPTIONS = [5, 10, 15, 20, 30];

const STAGE = {
  IDLE: 'idle',
  STORYBOARD: 'storyboard',
  HTML: 'html',
  PREVIEW: 'preview',
  RENDERING: 'rendering',
  DONE: 'done',
  ERROR: 'error'
};

export default function HtmlVideoStudio({ currentUser }) {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(10);
  const [brandColors, setBrandColors] = useState('#0ea5e9, #6366f1, #0f172a');
  const [logo, setLogo] = useState(null);
  const [stage, setStage] = useState(STAGE.IDLE);
  const [storyboard, setStoryboard] = useState(null);
  const [htmlContent, setHtmlContent] = useState('');
  const [progress, setProgress] = useState({ phase: '', percent: 0 });
  const [error, setError] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const [quota, setQuota] = useState({ allowed: true, used: 0, limit: HTML_VIDEO_DAILY_LIMIT });
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [showHtml, setShowHtml] = useState(false);
  const iframeRef = useRef(null);
  const scrubTimerRef = useRef(null);
  const logoInputRef = useRef(null);

  // Load user daily quota from Firestore
  useEffect(() => {
    if (!currentUser?.uid) return;
    checkHtmlVideoDailyQuota(currentUser.uid, db).then(setQuota).catch(() => {});
  }, [currentUser?.uid]);

  // Scrub animation loop for playback in iframe
  useEffect(() => {
    if (!isPlaying || !storyboard?.totalDuration) return;
    scrubTimerRef.current = setInterval(() => {
      setScrubTime(t => {
        const next = t + 0.033;
        if (next >= storyboard.totalDuration) {
          setIsPlaying(false);
          return storyboard.totalDuration;
        }
        return next;
      });
    }, 33);
    return () => clearInterval(scrubTimerRef.current);
  }, [isPlaying, storyboard?.totalDuration]);

  // Push seek frame to iframe when scrub time changes
  useEffect(() => {
    try {
      iframeRef.current?.contentWindow?.renderFrame?.(scrubTime);
    } catch {
      // guard cross-origin sandbox
    }
  }, [scrubTime]);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogo(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || (stage !== STAGE.IDLE && stage !== STAGE.ERROR)) return;
    if (!quota.allowed) {
      setError(`Daily quota reached (${quota.used}/${quota.limit} videos). Resets at midnight.`);
      return;
    }

    setError('');
    setScrubTime(0);
    setIsPlaying(false);

    // 1. Generate Scene Plan (JSON Storyboard)
    setStage(STAGE.STORYBOARD);
    setProgress({ phase: 'Synthesizing scene plan & pacing...', percent: 15 });
    let sb;
    try {
      const brandColorArr = brandColors.split(',').map(c => c.trim()).filter(Boolean);
      sb = await generateStoryboard(prompt, {
        aspectRatio,
        duration,
        brand: { colors: brandColorArr, logo, tagline: '' }
      });
      setStoryboard(sb);
      setProgress({ phase: 'Storyboard formulated', percent: 35 });
    } catch (err) {
      setStage(STAGE.ERROR);
      setError('Scene plan synthesis failed: ' + err.message);
      return;
    }

    // 2. Generate Animated GSAP HTML
    setStage(STAGE.HTML);
    setProgress({ phase: 'Coding animated GSAP HTML canvas...', percent: 50 });
    let html;
    try {
      html = await generateAnimatedHtml(sb, { logo }, { aspectRatio });
      
      // Auto-validation and repair
      const validation = validateHtml(html);
      if (!validation.valid) {
        setProgress({ phase: 'Validating & auto-repairing animation keys...', percent: 65 });
        html = await repairHtmlWithRetry(html, validation.errors, sb);
      }
      setHtmlContent(html);
      setProgress({ phase: 'Preview ready!', percent: 80 });
    } catch (err) {
      setStage(STAGE.ERROR);
      setError('HTML animation generation failed: ' + err.message);
      return;
    }

    setStage(STAGE.PREVIEW);
  }, [prompt, aspectRatio, duration, brandColors, logo, stage, quota]);

  const handleExportMp4 = useCallback(async () => {
    if (!htmlContent || stage === STAGE.RENDERING) return;
    setStage(STAGE.RENDERING);
    setProgress({ phase: 'Submitting frame sequence to render engine...', percent: 10 });
    setError('');

    try {
      const result = await submitHtmlVideoRenderJob(htmlContent, {
        aspectRatio,
        fps: 30,
        onProgress: prog => setProgress({
          phase: prog.phase || 'Rendering video frames...',
          percent: prog.percent || 15
        })
      });

      setRenderUrl(result.url);
      if (currentUser?.uid) {
        await incrementHtmlVideoQuota(currentUser.uid, db);
        const newQuota = await checkHtmlVideoDailyQuota(currentUser.uid, db);
        setQuota(newQuota);
      }
      setStage(STAGE.DONE);
      setProgress({ phase: 'High-res MP4 exported successfully!', percent: 100 });
    } catch (err) {
      setStage(STAGE.ERROR);
      setError('Server render encountered an issue: ' + err.message + '. The live HTML preview remains fully functional.');
    }
  }, [htmlContent, aspectRatio, currentUser?.uid, stage]);

  const handleReset = () => {
    setStage(STAGE.IDLE);
    setStoryboard(null);
    setHtmlContent('');
    setProgress({ phase: '', percent: 0 });
    setError('');
    setRenderUrl('');
    setScrubTime(0);
    setIsPlaying(false);
  };

  const isBusy = [STAGE.STORYBOARD, STAGE.HTML, STAGE.RENDERING].includes(stage);

  return (
    <div className="flex flex-col gap-5 w-full max-w-4xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-violet-600/10 via-purple-600/10 to-indigo-600/10 border border-violet-500/20">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
            <Clapperboard className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">HTML-to-Video Motion Engine</h2>
              <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-300 text-[10px] font-bold tracking-wide">STUDIO</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Transform prompts into production-grade animated videos with GSAP</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <Film className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {Math.max(0, quota.limit - quota.used)}/{quota.limit} Daily Exports
            </span>
          </div>
        </div>
      </div>

      {/* Creation Configuration Form */}
      {(stage === STAGE.IDLE || stage === STAGE.ERROR) && (
        <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-4 shadow-sm">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Video Concept & Prompt
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder='e.g., "10-second high-energy product launch video with futuristic neon lighting, bold typography, and smooth scale transitions"'
              rows={3}
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none transition"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                <Monitor className="w-3.5 h-3.5 text-slate-400" /> Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                {ASPECT_OPTIONS.map(a => (
                  <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> Duration
              </label>
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                {DURATION_OPTIONS.map(d => (
                  <option key={d} value={d}>{d} seconds</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-slate-400" /> Palette Hex Colors
              </label>
              <input
                value={brandColors}
                onChange={e => setBrandColors(e.target.value)}
                placeholder="#0ea5e9, #6366f1, #0f172a"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:border-violet-500 hover:text-violet-600 transition"
            >
              <Upload className="w-3.5 h-3.5" />
              {logo ? '✓ Logo attached' : 'Upload Brand Logo / Clip'}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || !quota.allowed}
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-violet-500/25 transition flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Synthesize Motion Video
          </button>
        </div>
      )}

      {/* Progress State */}
      {isBusy && (
        <div className="rounded-3xl border border-violet-200/60 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/20 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-bold text-violet-900 dark:text-violet-200">{progress.phase}</span>
            </div>
            <span className="text-xs font-mono font-bold text-violet-600 dark:text-violet-400">{progress.percent}%</span>
          </div>
          <div className="h-2 w-full bg-violet-200/40 dark:bg-violet-900/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Storyboard Card */}
      {storyboard && !isBusy && stage !== STAGE.IDLE && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                Scene Architecture ({storyboard.scenes?.length} Scenes · {storyboard.totalDuration}s Total)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">{aspectRatio}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            {(storyboard.scenes || []).slice(0, 6).map((scene, idx) => (
              <div
                key={scene.id || idx}
                className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs space-y-1"
              >
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Scene {idx + 1}</span>
                  <span>{scene.start}s – {scene.end}s</span>
                </div>
                <p className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 leading-relaxed">
                  {scene.text}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-400 pt-1">
                  <span>{scene.animation}</span>
                  <span>·</span>
                  <span>{scene.transition}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HTML Video Live Player Preview */}
      {htmlContent && (stage === STAGE.PREVIEW || stage === STAGE.DONE || stage === STAGE.ERROR) && (
        <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden shadow-2xl">
          {/* Top Control Bar */}
          <div className="bg-slate-900/90 px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Monitor className="w-4 h-4 text-sky-400" />
              <span>Interactive HTML Canvas Player</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHtml(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                <Code2 className="w-3.5 h-3.5" />
                {showHtml ? 'Hide Code' : 'Inspect Code'}
              </button>
              <button
                type="button"
                onClick={() => setScrubTime(0)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title="Restart"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          </div>

          {/* Iframe Screen */}
          <div
            className="relative bg-black mx-auto overflow-hidden"
            style={{
              width: '100%',
              paddingBottom: aspectRatio === '9:16' ? '177.7%' : aspectRatio === '1:1' ? '100%' : '56.25%',
              maxHeight: '620px'
            }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              sandbox="allow-scripts allow-same-origin"
              className="absolute inset-0 w-full h-full border-0 select-none"
              title="Zulora HTML Video Engine Preview"
            />
          </div>

          {/* Scrubber Timeline */}
          {storyboard?.totalDuration > 0 && (
            <div className="bg-slate-900/90 px-4 py-3 border-t border-slate-800 space-y-1.5">
              <input
                type="range"
                min={0}
                max={storyboard.totalDuration}
                step={0.033}
                value={scrubTime}
                onChange={e => {
                  setScrubTime(Number(e.target.value));
                  setIsPlaying(false);
                }}
                className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
              <div className="flex justify-between text-[11px] font-mono text-slate-400">
                <span>{scrubTime.toFixed(2)}s</span>
                <span>{storyboard.totalDuration.toFixed(2)}s</span>
              </div>
            </div>
          )}

          {/* Raw HTML Inspection Drawer */}
          {showHtml && (
            <div className="bg-slate-950 p-4 border-t border-slate-800 max-h-56 overflow-auto">
              <pre className="text-emerald-400 font-mono text-[11px] leading-relaxed select-all">
                {htmlContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Actions and Export Bar */}
      {(stage === STAGE.PREVIEW || stage === STAGE.DONE || stage === STAGE.ERROR) && !isBusy && (
        <div className="flex flex-wrap items-center gap-3">
          {stage !== STAGE.DONE && (
            <button
              type="button"
              onClick={handleExportMp4}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition"
            >
              <Film className="w-4 h-4" />
              Render & Export MP4
            </button>
          )}

          {stage === STAGE.DONE && renderUrl && (
            <a
              href={renderUrl}
              download="zulora-video.mp4"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-sky-500/20 transition"
            >
              <Download className="w-4 h-4" />
              Download Rendered MP4
            </a>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Create Another Video
          </button>

          {stage === STAGE.DONE && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium ml-auto">
              <CheckCircle className="w-4 h-4" />
              MP4 Render Complete!
            </div>
          )}
        </div>
      )}
    </div>
  );
}

