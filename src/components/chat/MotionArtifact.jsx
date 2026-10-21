import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Pause, RefreshCw, Maximize2, Download, Code2 } from 'lucide-react';

/**
 * MotionArtifact — Claude-style interactive HTML5/Canvas animation preview.
 * Renders a sandboxed <iframe> with Play/Pause, Replay, Fullscreen, and
 * Download HTML controls. Used by ChatInterface when the AI generates
 * motion graphics, canvas animations, or interactive HTML artifacts.
 */
export function MotionArtifact({ htmlCode, title = 'Motion Artifact' }) {
  const iframeRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const containerRef = useRef(null);

  // Inject the HTML into a sandboxed iframe
  const buildSrcDoc = useCallback((code) => {
    if (!code) return '';
    // Wrap bare code snippets in a full HTML document if needed
    const trimmed = code.trim().toLowerCase();
    if (!trimmed.startsWith('<!doctype') && !trimmed.startsWith('<html')) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}body{margin:0;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;}</style></head><body>${code}</body></html>`;
    }
    return code;
  }, []);

  const srcDoc = buildSrcDoc(htmlCode || '');

  const handleReplay = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.srcdoc = srcDoc;
      });
      setIsPlaying(true);
    }
  }, [srcDoc]);

  const handlePlayPause = useCallback(() => {
    if (iframeRef.current) {
      try {
        if (isPlaying) {
          iframeRef.current.contentWindow?.postMessage({ zuloraCommand: 'pause' }, '*');
          iframeRef.current.style.filter = 'brightness(0.6) grayscale(0.4)';
        } else {
          iframeRef.current.contentWindow?.postMessage({ zuloraCommand: 'resume' }, '*');
          iframeRef.current.style.filter = '';
        }
      } catch (e) { /* cross-origin sandbox — ignore */ }
    }
    setIsPlaying(prev => !prev);
  }, [isPlaying]);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleDownloadHTML = useCallback(() => {
    const blob = new Blob([htmlCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(title || 'motion_artifact').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [htmlCode, title]);

  if (!htmlCode) return null;

  return (
    <div
      ref={containerRef}
      className="motion-artifact my-4 rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-700/60 bg-[#0a0a12] shadow-2xl"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-300 truncate max-w-[180px]">{title}</span>
          <span className="text-[10px] text-slate-500 font-mono">HTML5 · Canvas</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCode(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
        >
          <Code2 className="w-3 h-3" />
          {showCode ? 'Preview' : 'Code'}
        </button>
      </div>

      {/* Preview / Code panel */}
      {showCode ? (
        <div className="bg-[#0d1117] overflow-auto" style={{ maxHeight: 360 }}>
          <pre className="text-[11px] text-emerald-400 font-mono p-4 whitespace-pre-wrap break-all leading-relaxed select-text">
            {htmlCode}
          </pre>
        </div>
      ) : (
        <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title={title}
            sandbox="allow-scripts"
            className="w-full h-full border-0 transition-all duration-300"
            style={{ display: 'block', aspectRatio: '16/9' }}
          />
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
              <div className="rounded-full bg-white/10 p-4 backdrop-blur-md border border-white/20">
                <Play className="w-8 h-8 text-white" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/70 border-t border-slate-700/40">
        <button
          type="button"
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/30 transition-colors"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={handleReplay}
          title="Replay from beginning"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 border border-slate-600/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Replay
        </button>

        <button
          type="button"
          onClick={handleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 border border-slate-600/40 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          {isFullscreen ? 'Exit' : 'Fullscreen'}
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleDownloadHTML}
          title="Download as HTML file"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/30 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download HTML
        </button>
      </div>
    </div>
  );
}

/**
 * detectMotionArtifact — scans assistant message text for HTML5/Canvas animation
 * code blocks and extracts them for rendering in MotionArtifact.
 *
 * Returns: { hasArtifact, htmlCode, cleanedText, title }
 */
export function detectMotionArtifact(content) {
  const text = String(content || '');
  if (!text) return { hasArtifact: false, htmlCode: '', cleanedText: text, title: '' };

  const fencePattern = /```(?:html|canvas|animation|motion|svg)[\s]*\n([\s\S]*?)```/gi;
  let match;
  let htmlCode = '';
  let cleanedText = text;
  let title = 'Motion Artifact';

  while ((match = fencePattern.exec(text)) !== null) {
    const code = (match[1] || '').trim();
    // Only treat as motion artifact if it contains canvas, animation, or requestAnimationFrame keywords
    const isMotion = (
      /<canvas[\s>]/i.test(code) ||
      /requestAnimationFrame/i.test(code) ||
      /@keyframes/i.test(code) ||
      /animation\s*:/i.test(code) ||
      /ctx\.(fill|stroke|arc|beginPath|moveTo|lineTo)/i.test(code) ||
      /\.animate\(/i.test(code)
    );
    if (code && isMotion) {
      htmlCode = code;
      const headingMatch = text.match(/#{1,3}\s+([^\n]+)/);
      if (headingMatch) title = headingMatch[1].trim();
      cleanedText = text.replace(match[0], '\n_[Interactive motion artifact rendered above ↑]_\n').trim();
      break;
    }
  }

  return {
    hasArtifact: Boolean(htmlCode),
    htmlCode,
    cleanedText,
    title
  };
}

export default MotionArtifact;

