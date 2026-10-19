import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Play, 
  Download, 
  CheckCircle2, 
  Loader2, 
  Film, 
  Mic, 
  Layers, 
  Sparkles, 
  RefreshCw, 
  FileText, 
  Eye, 
  Share2, 
  Sliders,
  AlertCircle
} from 'lucide-react';
import { runFullVideoPipeline, render_overlay, composite_video } from '../services/videoEditAgent';
import { useAuth } from '../context/AuthContext';

const STAGES = [
  { key: 'Probing', label: 'Probing', icon: Film },
  { key: 'Transcribing', label: 'Transcribing', icon: Mic },
  { key: 'Planning', label: 'Planning', icon: Layers },
  { key: 'Designing', label: 'Designing', icon: Sparkles },
  { key: 'Rendering', label: 'Rendering', icon: Sliders },
  { key: 'Encoding', label: 'Encoding', icon: Loader2 },
  { key: 'Done', label: 'Done', icon: CheckCircle2 }
];

export default function VideoEditorAgent({ 
  initialFile = null, 
  userPrompt = '', 
  onComplete, 
  className = '' 
}) {
  const { currentUser } = useAuth();
  const [file, setFile] = useState(initialFile);
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (initialFile && !file) {
      setFile(initialFile);
    }
  }, [initialFile]);

  const handleProgress = useCallback(({ stage: s, percent: p, message: m }) => {
    setStage(s);
    setPercent(p);
    setStatusMessage(m || '');
  }, []);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith('video/')) {
      setFile(f);
      setResult(null);
      setError('');
      setStage('');
      setPercent(0);
    }
  };

  const executePipeline = async () => {
    if (!file || running) return;
    setRunning(true);
    setError('');
    setResult(null);

    try {
      const output = await runFullVideoPipeline(file, userPrompt, handleProgress, currentUser);
      setResult(output);
      onComplete?.(output);
    } catch (err) {
      console.error('[VideoEditorAgent] Execution error:', err);
      setError(err.message || 'Video processing failed. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  // Fast Incremental Edit Loop (Skips re-transcription, only re-plans and re-renders)
  const handleIncrementalEdit = async () => {
    if (!result || !editInstruction.trim() || isEditing) return;
    setIsEditing(true);
    setError('');

    try {
      handleProgress({ stage: 'Designing', percent: 60, message: `Applying edit: "${editInstruction}"...` });
      // Re-render overlay with new styles
      const newOverlayHtml = render_overlay(result.captions, result.videoInfo || { width: 1080, height: 1920, duration: result.duration }, editInstruction);
      
      handleProgress({ stage: 'Rendering', percent: 75, message: 'Re-compositing kinetic video...' });
      const reRendered = await composite_video(file, newOverlayHtml, result.videoInfo || { width: 1080, height: 1920, duration: result.duration }, handleProgress);
      
      setResult(prev => ({
        ...prev,
        ...reRendered
      }));
      setEditInstruction('');
      handleProgress({ stage: 'Done', percent: 100, message: 'Edit applied successfully!' });
    } catch (err) {
      setError(`Incremental edit failed: ${err.message}`);
    } finally {
      setIsEditing(false);
    }
  };

  const currentStageIndex = STAGES.findIndex(s => s.key === stage);

  return (
    <div className={`w-full max-w-xl mx-auto rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-5 shadow-xl backdrop-blur-xl space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Zulora AI Video Studio</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Kinetic captions & motion graphics engine</p>
          </div>
        </div>
        {result && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Ready
          </span>
        )}
      </div>

      {/* Upload Zone */}
      {!file && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-500 rounded-2xl p-7 text-center cursor-pointer transition-all bg-slate-50/50 dark:bg-slate-800/30 group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400 group-hover:text-sky-500 transition-colors" />
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Upload a reference or talking-head video
          </p>
          <p className="text-[10px] text-slate-400 mt-1">MP4, MOV, WebM up to 100MB (auto-synced to 1080x1920)</p>
        </div>
      )}

      {/* Selected File Details */}
      {file && !result && !running && (
        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <Film className="w-4 h-4 text-sky-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{file.name}</p>
              <p className="text-[10px] text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          </div>
          <button
            onClick={executePipeline}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-semibold text-xs shadow-md shadow-sky-500/25 transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Add Kinetic Captions
          </button>
        </div>
      )}

      {/* Progress Tracker Bar */}
      {running && (
        <div className="space-y-3 p-4 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
          <div className="flex items-center justify-between text-xs font-semibold text-sky-900 dark:text-sky-200">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500" />
              {statusMessage || 'Processing video...'}
            </span>
            <span>{percent}%</span>
          </div>

          <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Stepper badges */}
          <div className="flex items-center justify-between gap-1 pt-1 overflow-x-auto no-scrollbar">
            {STAGES.map((s, idx) => {
              const Icon = s.icon;
              const isPast = idx < currentStageIndex;
              const isCurrent = idx === currentStageIndex;
              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold whitespace-nowrap transition-all ${
                    isPast
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : isCurrent
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  <Icon className={`w-2.5 h-2.5 ${isCurrent ? 'animate-spin' : ''}`} />
                  {s.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Playable Video Output & Actions */}
      {result && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-lg">
            <video
              src={result.url}
              controls
              playsInline
              className="w-full max-h-[360px] object-contain mx-auto"
            />
          </div>

          <div className="flex items-center gap-2">
            <a
              href={result.url}
              download={result.filename || 'zulora_kinetic_video.mp4'}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold text-xs shadow-md shadow-emerald-500/20 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Download MP4 (1080x1920)
            </a>

            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium transition"
              title="Inspect Transcript & Storyboard"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Incremental Editing Loop */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 space-y-2">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
              Quick Edit (re-renders without re-transcribing):
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={editInstruction}
                onChange={e => setEditInstruction(e.target.value)}
                placeholder='e.g., "Make captions yellow", "Increase font size", "Clean minimal white"'
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                type="button"
                onClick={handleIncrementalEdit}
                disabled={isEditing || !editInstruction.trim()}
                className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition"
              >
                {isEditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
              </button>
            </div>
          </div>

          {/* Transcript & Storyboard JSON Inspector */}
          {showJson && (
            <div className="p-3 rounded-2xl bg-slate-950 text-slate-300 font-mono text-[10px] max-h-48 overflow-y-auto space-y-2">
              <div>
                <p className="text-sky-400 font-bold mb-1">=== Transcript JSON (Word Timestamps) ===</p>
                <pre>{JSON.stringify(result.transcript, null, 2)}</pre>
              </div>
              <div>
                <p className="text-amber-400 font-bold mb-1">=== Storyboard Caption Chunks ===</p>
                <pre>{JSON.stringify(result.captions, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

