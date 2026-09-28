import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Plug, Terminal, Play, Pause, RotateCcw, ChevronDown,
  ChevronUp, CheckCircle2, AlertCircle, Loader2, ExternalLink,
  Mic, Send, MonitorPlay, Zap, Clock, Download
} from 'lucide-react';
import {
  checkExtensionConnected,
  executeCommand,
  pauseTask,
  resumeTask,
  cancelTask,
  onStatusUpdate,
  parseCommandToSteps
} from '../services/browserAgentEngine';

// ─── Status badge config ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
  idle:    { label: 'Idle',       color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800',       dot: 'bg-slate-400' },
  running: { label: 'Running…',   color: 'text-sky-600',   bg: 'bg-sky-50 dark:bg-sky-950/60',         dot: 'bg-sky-500 animate-pulse' },
  paused:  { label: 'Paused',     color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30',     dot: 'bg-amber-500' },
  done:    { label: 'Complete ✓', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500' },
  error:   { label: 'Error',      color: 'text-red-600',   bg: 'bg-red-50 dark:bg-red-950/30',         dot: 'bg-red-500' },
};

const STEP_ICON = {
  running: <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin shrink-0" />,
  done:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
  error:   <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />,
  paused:  <Pause className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  pending: <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
};

// ─── Suggested quick tasks ────────────────────────────────────────────────────
const QUICK_TASKS = [
  { label: '📧 Draft Email',     command: 'Send email to friend@gmail.com with subject Hello and body Just checking in!' },
  { label: '🔍 Google Search',   command: 'Search for best AI tools 2025' },
  { label: '📄 PDF Converter',   command: 'Convert PDF to DOC online' },
  { label: '▶️ YouTube',         command: 'Open YouTube and search lofi hip hop' },
];

// ─── Install guide steps ──────────────────────────────────────────────────────
const INSTALL_STEPS = [
  'Download the Zulora Computer Plugin ZIP below.',
  'Go to chrome://extensions in your browser.',
  'Enable "Developer mode" (toggle top-right).',
  'Click "Load unpacked" and select the extracted folder.',
  'Reload this page — the plugin connects automatically.',
];

// ─── Component ────────────────────────────────────────────────────────────────
const ComputerPluginModal = ({ isOpen, onClose }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [command, setCommand] = useState('');
  const [taskStatus, setTaskStatus] = useState('idle');
  const [actionLog, setActionLog] = useState([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [loginRequired, setLoginRequired] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [parsedPreview, setParsedPreview] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const logEndRef = useRef(null);
  const inputRef  = useRef(null);
  const recognitionRef = useRef(null);

  // ── Check extension connection ───────────────────────────────────────────────
  const checkConnection = useCallback(async () => {
    setCheckingConnection(true);
    const connected = await checkExtensionConnected();
    setIsConnected(connected);
    setCheckingConnection(false);
    return connected;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    checkConnection();
    const interval = setInterval(checkConnection, 8000);
    return () => clearInterval(interval);
  }, [isOpen, checkConnection]);

  // ── Listen for status updates from extension ─────────────────────────────────
  useEffect(() => {
    const unsubscribe = onStatusUpdate((data) => {
      if (data.type === 'ZULORA_STATUS_UPDATE') {
        setTaskStatus(data.taskStatus);
        setActionLog(data.actionLog || []);
        if (data.taskStatus === 'done' || data.taskStatus === 'error') {
          setIsRunning(false);
          setIsLogOpen(true);
        }
      }
      if (data.type === 'ZULORA_LOGIN_REQUIRED') {
        setLoginRequired(data);
        setIsLogOpen(true);
      }
    });
    return unsubscribe;
  }, []);

  // ── Auto-scroll log ──────────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [actionLog]);

  // ── Auto-preview steps as user types ────────────────────────────────────────
  useEffect(() => {
    if (!command.trim()) { setParsedPreview([]); setShowPreview(false); return; }
    const steps = parseCommandToSteps(command);
    setParsedPreview(steps);
    setShowPreview(steps.length > 0);
  }, [command]);

  // ── Voice input ──────────────────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice input is not supported in this browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-IN';
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setCommand(transcript);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [isListening]);

  // ── Run task ─────────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!command.trim() || isRunning) return;
    const connected = await checkConnection();
    if (!connected) { setShowInstallGuide(true); return; }

    setIsRunning(true);
    setTaskStatus('running');
    setActionLog([]);
    setLoginRequired(null);
    setIsLogOpen(true);

    const result = await executeCommand(command, (entry) => {
      setActionLog(prev => [...prev, entry]);
    });

    if (!result.ok) {
      setTaskStatus('error');
      setIsRunning(false);
      setActionLog(prev => [...prev, {
        index: prev.length + 1,
        label: result.error || 'Unknown error',
        status: 'error',
        timestamp: Date.now()
      }]);
    }
  }, [command, isRunning, checkConnection]);

  const handleResume = useCallback(async () => {
    setLoginRequired(null);
    await resumeTask();
    setTaskStatus('running');
    setIsRunning(true);
  }, []);

  const handleCancel = useCallback(async () => {
    await cancelTask();
    setTaskStatus('idle');
    setIsRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    setTaskStatus('idle');
    setActionLog([]);
    setLoginRequired(null);
    setIsRunning(false);
    setCommand('');
    setParsedPreview([]);
    setShowPreview(false);
  }, []);

  if (!isOpen) return null;

  const sc = STATUS_CONFIG[taskStatus] || STATUS_CONFIG.idle;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Zulora Computer Plugin"
        className="fixed right-0 top-0 z-[90] h-full w-full max-w-[420px] flex flex-col bg-white dark:bg-slate-950 shadow-2xl border-l border-slate-200 dark:border-slate-800 animate-slide-right overflow-hidden"
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md">
            <MonitorPlay className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
              Computer Plugin
            </h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
              Browser Automation Agent
            </p>
          </div>

          {/* Connection badge */}
          <div className="flex items-center gap-1.5">
            {checkingConnection ? (
              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking…
              </span>
            ) : isConnected ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-200 dark:border-emerald-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Connected
              </span>
            ) : (
              <button
                onClick={() => setShowInstallGuide(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-500 text-[10px] font-bold border border-red-200 dark:border-red-800/60 hover:bg-red-100 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Not Installed
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 p-4">

          {/* Install Guide */}
          {showInstallGuide && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                  Install Zulora Computer Plugin
                </span>
              </div>
              <ol className="space-y-1.5">
                {INSTALL_STEPS.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300 flex items-center justify-center text-[9px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <a
                href="/zulora-extension.zip"
                download
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors w-full justify-center"
              >
                <Download className="w-3.5 h-3.5" />
                Download Extension ZIP
              </a>
              <button
                onClick={() => { setShowInstallGuide(false); checkConnection(); }}
                className="w-full text-[11px] text-amber-600 hover:text-amber-700 font-semibold"
              >
                I've installed it — Check again
              </button>
            </div>
          )}

          {/* Status Badge */}
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl ${sc.bg}`}>
            <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
            <span className={`text-xs font-bold ${sc.color}`}>{sc.label}</span>
            {taskStatus === 'running' && (
              <span className="text-[10px] text-sky-500 ml-auto font-medium">
                {actionLog.filter(l => l.status === 'done').length} / {actionLog.length} steps done
              </span>
            )}
          </div>

          {/* Login Required Alert */}
          {loginRequired && (
            <div className="rounded-2xl border border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/30 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-sky-700 dark:text-sky-300">
                    Action Required on {loginRequired.host}
                  </p>
                  <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5 leading-relaxed">
                    {loginRequired.message}
                  </p>
                </div>
              </div>
              <button
                onClick={handleResume}
                className="w-full py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                Resume Task
              </button>
            </div>
          )}

          {/* Command Terminal */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <Terminal className="w-3 h-3" />
              Task Command
            </label>

            {/* Quick task chips */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TASKS.map(qt => (
                <button
                  key={qt.label}
                  onClick={() => setCommand(qt.command)}
                  className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[10px] font-semibold hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-sky-600 dark:hover:text-sky-400 border border-slate-200/60 dark:border-slate-700/60 transition-colors"
                >
                  {qt.label}
                </button>
              ))}
            </div>

            {/* Textarea + mic */}
            <div className="relative">
              <textarea
                ref={inputRef}
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(); }
                }}
                placeholder="e.g. Search Google for best AI tools, then open the first result..."
                rows={3}
                className="w-full px-4 py-3 pr-12 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400 transition-all resize-none"
                disabled={isRunning}
              />
              <button
                onClick={toggleVoice}
                title={isListening ? 'Stop listening' : 'Voice input'}
                className={`absolute right-3 bottom-3 p-1.5 rounded-lg transition-colors ${
                  isListening
                    ? 'text-red-500 bg-red-50 dark:bg-red-950/30 animate-pulse'
                    : 'text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>

            {/* Step preview */}
            {showPreview && !isRunning && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                  Preview — {parsedPreview.length} Steps
                </p>
                {parsedPreview.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                    <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[8px] font-bold text-slate-500 shrink-0">
                      {i + 1}
                    </span>
                    <span className="capitalize">{step.action.replace(/_/g, ' ')}</span>
                    {step.params?.url && <span className="truncate text-sky-500 max-w-[120px]">{step.params.url}</span>}
                    {step.params?.query && <span className="truncate text-indigo-500 max-w-[120px]">"{step.params.query}"</span>}
                    {step.params?.to && <span className="truncate text-emerald-500 max-w-[120px]">{step.params.to}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Run / control buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleRun}
                disabled={!command.trim() || isRunning || !isConnected}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white text-xs font-bold shadow-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {isRunning ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />Running…</>
                ) : (
                  <><Send className="w-3.5 h-3.5" />Run Task</>
                )}
              </button>

              {isRunning && (
                <button
                  onClick={taskStatus === 'paused' ? handleResume : () => pauseTask().then(() => setTaskStatus('paused'))}
                  className="px-3 py-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-bold hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                >
                  {taskStatus === 'paused' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
              )}

              {(isRunning || taskStatus !== 'idle') && (
                <button
                  onClick={taskStatus === 'idle' ? handleReset : handleCancel}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  title="Cancel / Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* ── Action Log Accordion ──────────────────────────────────────── */}
          {actionLog.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => setIsLogOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-sky-500" />
                  Action Log ({actionLog.length} steps)
                </span>
                {isLogOpen
                  ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </button>

              {isLogOpen && (
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                  {actionLog.map((entry, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                      <div className="mt-0.5">
                        {STEP_ICON[entry.status] || STEP_ICON.pending}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-snug">
                          {entry.label}
                        </p>
                        {entry.detail && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                            {entry.detail}
                          </p>
                        )}
                      </div>
                      <span className="text-[9px] text-slate-400 shrink-0 mt-0.5">
                        {new Date(entry.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          )}

          {/* ── Success Card ──────────────────────────────────────────────── */}
          {taskStatus === 'done' && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 p-4 text-center space-y-2">
              <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-sm font-black text-emerald-700 dark:text-emerald-300">Task Complete!</p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                All {actionLog.filter(l => l.status === 'done').length} steps executed successfully.
              </p>
              <button
                onClick={handleReset}
                className="mt-1 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors"
              >
                Run Another Task
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="h-2" />
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
          <span>Zulora Computer Plugin v1.0</span>
          <a
            href="chrome://extensions"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-sky-500 transition-colors"
            onClick={e => { e.preventDefault(); window.open('chrome://extensions'); }}
          >
            <ExternalLink className="w-3 h-3" />
            Extensions
          </a>
        </div>
      </aside>
    </>
  );
};

export default ComputerPluginModal;
