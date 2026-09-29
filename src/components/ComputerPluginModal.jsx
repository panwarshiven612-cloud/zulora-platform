import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Plug, Terminal, Play, Pause, RotateCcw, ChevronDown,
  ChevronUp, CheckCircle2, AlertCircle, Loader2, ExternalLink,
  Mic, Send, MonitorPlay, Zap, Clock, Download, Square,
  Sparkles, Crown, MessageSquare, Mail, FileText, Globe, Bot
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
import { useAuth } from '../context/AuthContext';

// ─── Status Badge Config ──────────────────────────────────────────────────────
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

const APP_BADGE = {
  Gmail:           { icon: <Mail className="w-3 h-3 text-red-500" />, bg: 'bg-red-50 dark:bg-red-950/40 text-red-600' },
  WhatsApp:        { icon: <MessageSquare className="w-3 h-3 text-emerald-500" />, bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600' },
  ChatGPT:         { icon: <Bot className="w-3 h-3 text-teal-500" />, bg: 'bg-teal-50 dark:bg-teal-950/40 text-teal-600' },
  Gemini:          { icon: <Sparkles className="w-3 h-3 text-sky-500" />, bg: 'bg-sky-50 dark:bg-sky-950/40 text-sky-600' },
  'Screen Reader': { icon: <Globe className="w-3 h-3 text-indigo-500" />, bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600' },
  'PDF Exporter':  { icon: <FileText className="w-3 h-3 text-amber-500" />, bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600' },
  'Code Exporter': { icon: <Terminal className="w-3 h-3 text-violet-500" />, bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-600' },
  Google:          { icon: <Globe className="w-3 h-3 text-blue-500" />, bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600' },
  Browser:         { icon: <Globe className="w-3 h-3 text-slate-500" />, bg: 'bg-slate-100 dark:bg-slate-800 text-slate-600' }
};

// ─── Multi-App Quick Tasks ────────────────────────────────────────────────────
const QUICK_TASKS = [
  { label: '💎 Pearl Email',    command: 'Draft email to client@example.com with subject Project Update using pearl template saying we are ahead of schedule' },
  { label: '🌊 Azure Letter',   command: 'Draft formal letter using azure template to team@company.com about quarterly review' },
  { label: '💬 WhatsApp',       command: 'Send whatsapp message to Alex saying I will join the meeting in 5 minutes' },
  { label: '🤖 ChatGPT Prompt', command: 'Open ChatGPT and ask for a complete Node.js Express server boilerplate' },
  { label: '👁️ Read Screen',    command: 'Summarize this page' },
];

const INSTALL_STEPS = [
  'Download the Zulora Computer Plugin ZIP below.',
  'Go to chrome://extensions in your browser.',
  'Enable "Developer mode" (toggle top-right).',
  'Click "Load unpacked" and select the extracted folder.',
  'Reload this page — the plugin connects automatically.',
];

const FREE_TASK_LIMIT = 5;

// ─── Component ────────────────────────────────────────────────────────────────
const ComputerPluginModal = ({ isOpen, onClose }) => {
  const { isPro, setIsPricingModalOpen, currentUser } = useAuth();

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

  // Token Tracking & Gatekeeper state
  const [sessionTokens, setSessionTokens] = useState(() => {
    return parseInt(localStorage.getItem('zulora_total_tokens') || '0', 10);
  });
  const [taskCount, setTaskCount] = useState(() => {
    return parseInt(localStorage.getItem('zulora_plugin_task_count') || '0', 10);
  });
  const [showUpgradeGate, setShowUpgradeGate] = useState(false);
  const [floatingMicEnabled, setFloatingMicEnabled] = useState(() => {
    return localStorage.getItem('zulora_floating_mic') !== 'false';
  });

  const logEndRef = useRef(null);
  const inputRef  = useRef(null);
  const recognitionRef = useRef(null);

  // ── Sync session token storage ──────────────────────────────────────────────
  const recordTokens = useCallback((tokens) => {
    if (!tokens || isNaN(tokens)) return;
    setSessionTokens(prev => {
      const next = prev + tokens;
      localStorage.setItem('zulora_total_tokens', String(next));
      return next;
    });
  }, []);

  const toggleFloatingMic = useCallback((enabled) => {
    setFloatingMicEnabled(enabled);
    localStorage.setItem('zulora_floating_mic', enabled ? 'true' : 'false');
    // Notify extension content script to show/hide the widget
    window.dispatchEvent(new CustomEvent('ZULORA_EXECUTE_AGENT_TASK', {
      detail: { type: 'SET_FLOATING_MIC', enabled }
    }));
    // Communicate directly to extension storage if available
    try {
      if (window.chrome?.storage?.local) {
        window.chrome.storage.local.set({ floatingMicEnabled: enabled });
      }
    } catch {}
    const el = document.getElementById('zulora-floating-mic');
    if (el) el.style.display = enabled ? 'flex' : 'none';
  }, []);

  // ── Extension Connection Check ──────────────────────────────────────────────
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

    const onReady = () => checkConnection();
    window.addEventListener('ZULORA_PLUGIN_CONNECTED', onReady);

    return () => {
      clearInterval(interval);
      window.removeEventListener('ZULORA_PLUGIN_CONNECTED', onReady);
    };
  }, [isOpen, checkConnection]);

  // ── Status Updates from Extension ───────────────────────────────────────────
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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [actionLog]);

  // ── Live Action Plan Preview ────────────────────────────────────────────────
  useEffect(() => {
    if (!command.trim()) {
      setParsedPreview([]);
      setShowPreview(false);
      return;
    }
    const steps = parseCommandToSteps(command);
    setParsedPreview(steps);
    setShowPreview(steps.length > 0);
  }, [command]);

  // ── Web Speech API Live Voice Recognition ───────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Live voice command is not supported in this browser. Please use Chrome, Edge, or Brave.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setIsListening(true);
    };

    rec.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');
      setCommand(transcript);
    };

    rec.onend = () => {
      setIsListening(false);
    };

    rec.onerror = (err) => {
      console.warn('[Voice Recognition] Error:', err);
      setIsListening(false);
    };

    recognitionRef.current = rec;
    rec.start();
  }, [isListening]);

  // ── Run Task & Gatekeeper ───────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!command.trim() || isRunning) return;

    // Gatekeeper: Free users capped at 5 tasks
    if (!isPro && taskCount >= FREE_TASK_LIMIT) {
      setShowUpgradeGate(true);
      return;
    }

    const connected = await checkConnection();
    if (!connected) {
      setShowInstallGuide(true);
      return;
    }

    setIsRunning(true);
    setTaskStatus('running');
    setActionLog([]);
    setLoginRequired(null);
    setIsLogOpen(true);

    // Increment task count for free users
    if (!isPro) {
      const nextCount = taskCount + 1;
      setTaskCount(nextCount);
      localStorage.setItem('zulora_plugin_task_count', String(nextCount));
    }

    const result = await executeCommand(command, (entry) => {
      setActionLog(prev => [...prev, entry]);
    }, currentUser);

    if (result.tokensUsed) {
      recordTokens(result.tokensUsed);
    }

    if (!result.ok && !result.success) {
      setTaskStatus('error');
      setIsRunning(false);
      setActionLog(prev => [...prev, {
        index: prev.length + 1,
        label: result.error || 'Execution halted.',
        status: 'error',
        timestamp: Date.now()
      }]);
    }
  }, [command, isRunning, isPro, taskCount, checkConnection, currentUser, recordTokens]);

  const handlePause = useCallback(async () => {
    await pauseTask();
    setTaskStatus('paused');
  }, []);

  const handleResume = useCallback(async () => {
    setLoginRequired(null);
    await resumeTask();
    setTaskStatus('running');
    setIsRunning(true);
  }, []);

  const handleStopAgent = useCallback(async () => {
    await cancelTask();
    setTaskStatus('idle');
    setIsRunning(false);
    setActionLog(prev => [...prev, {
      index: prev.length + 1,
      label: 'Agent stopped by user.',
      status: 'paused',
      timestamp: Date.now()
    }]);
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
        className="fixed right-0 top-0 z-[90] h-full w-full max-w-[430px] flex flex-col bg-white dark:bg-slate-950 shadow-2xl border-l border-slate-200 dark:border-slate-800 animate-slide-right overflow-hidden font-sans"
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md">
            <MonitorPlay className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                Computer Plugin
              </h2>
              {isPro ? (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-500 text-[9px] font-black uppercase">
                  <Crown className="w-2.5 h-2.5" /> PRO
                </span>
              ) : (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                  FREE
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
              Autonomous Browser Agent
            </p>
          </div>

          {/* Connection Badge */}
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

        {/* ── Token Tracker & Session Usage Banner ────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[11px]">
          <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
            <Zap className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
            <span>Tokens Used: <strong className="font-bold text-sky-600 dark:text-sky-400">{sessionTokens.toLocaleString()}</strong> Tokens</span>
          </div>
          {/* Floating Mic Toggle */}
          <button
            onClick={() => toggleFloatingMic(!floatingMicEnabled)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
              floatingMicEnabled
                ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
            }`}
            title="Toggle floating mic widget on browser tabs"
          >
            <Mic className="w-2.5 h-2.5" />
            Floating Mic {floatingMicEnabled ? 'ON' : 'OFF'}
          </button>
        </div>


        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 p-4">

          {/* Upgrade Gatekeeper Modal / Alert */}
          {showUpgradeGate && (
            <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-transparent p-4 space-y-3 shadow-lg">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Crown className="w-5 h-5 text-amber-500" />
                <h3 className="text-xs font-black uppercase tracking-wide">
                  Free Limit Reached (5/5 Tasks)
                </h3>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                You've completed all 5 free automation tasks. Upgrade to <strong>Zulora Pro</strong> for unlimited autonomous browser agent execution, rich Pearl/Azure templates, and WhatsApp/Gmail integration.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowUpgradeGate(false);
                    setIsPricingModalOpen(true);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <Crown className="w-3.5 h-3.5" />
                  Upgrade to Pro
                </button>
                <button
                  onClick={() => setShowUpgradeGate(false)}
                  className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-200 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

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

          {/* Status Badge & Step Tracker */}
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl ${sc.bg}`}>
            <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
            <span className={`text-xs font-bold ${sc.color}`}>{sc.label}</span>
            {taskStatus === 'running' && (
              <span className="text-[10px] text-sky-500 ml-auto font-medium">
                {actionLog.filter(l => l.status === 'done').length} / {actionLog.length} steps done
              </span>
            )}
            {!isPro && (
              <span className="text-[10px] text-slate-400 ml-auto font-medium">
                {taskCount}/{FREE_TASK_LIMIT} tasks used
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

          {/* ── Command Input Box ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                <Terminal className="w-3 h-3 text-sky-500" />
                Task Command
              </label>
              {isListening && (
                <span className="flex items-center gap-1.5 text-[10px] text-rose-500 font-bold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  Listening live…
                </span>
              )}
            </div>

            {/* Quick Multi-App Chips */}
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

            {/* Input Textarea & Glowing Mic Button */}
            <div className="relative">
              <textarea
                ref={inputRef}
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(); }
                }}
                placeholder="e.g. Draft formal letter using pearl template to client@example.com, or send whatsapp message to Alex..."
                rows={3}
                className="w-full px-4 py-3 pr-14 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400 transition-all resize-none"
                disabled={isRunning}
              />
              <button
                onClick={toggleVoice}
                title={isListening ? 'Stop listening' : 'Voice command (Speech-to-Text)'}
                className={`absolute right-3 bottom-3 p-2 rounded-xl transition-all duration-300 ${
                  isListening
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/40 ring-4 ring-rose-500/20 animate-pulse'
                    : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/40'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>

            {/* Action Plan Preview Box */}
            {showPreview && !isRunning && (
              <div className="rounded-xl border border-sky-100 dark:border-sky-900/40 bg-gradient-to-br from-sky-50/60 to-indigo-50/40 dark:from-sky-950/20 dark:to-indigo-950/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-wider text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-sky-500" />
                    Action Plan Preview ({parsedPreview.length} Steps)
                  </p>
                  <span className="text-[9px] text-slate-400">Ready to execute</span>
                </div>
                <div className="space-y-1.5">
                  {parsedPreview.map((step, i) => {
                    const badge = APP_BADGE[step.app] || APP_BADGE.Browser;
                    return (
                      <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800/50 text-[11px]">
                        <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-500 shrink-0">
                          {i + 1}
                        </span>
                        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${badge.bg}`}>
                          {badge.icon}
                          {step.app || 'Browser'}
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200 truncate flex-1">
                          {step.action.replace(/_/g, ' ')}
                        </span>
                        {step.needsLlm && (
                          <span className="px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[9px] font-bold shrink-0">
                            ✨ Smart Payload
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Run & Control Buttons */}
            <div className="flex gap-2 pt-1">
              {!isRunning ? (
                <button
                  onClick={handleRun}
                  disabled={!command.trim() || !isConnected}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white text-xs font-bold shadow-md hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  Execute Agent Task
                </button>
              ) : (
                <>
                  <button
                    onClick={taskStatus === 'paused' ? handleResume : handlePause}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md transition-all"
                  >
                    {taskStatus === 'paused' ? (
                      <><Play className="w-3.5 h-3.5" /> Resume Task</>
                    ) : (
                      <><Pause className="w-3.5 h-3.5" /> Pause Agent</>
                    )}
                  </button>

                  <button
                    onClick={handleStopAgent}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md flex items-center gap-1.5 transition-all"
                    title="Stop Agent Task"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop Agent
                  </button>
                </>
              )}

              {(taskStatus !== 'idle' && !isRunning) && (
                <button
                  onClick={handleReset}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  title="Reset Workspace"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* ── Action Log ────────────────────────────────────────────────── */}
          {actionLog.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <button
                onClick={() => setIsLogOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-sky-500" />
                  Live Action Log ({actionLog.length} steps)
                </span>
                {isLogOpen
                  ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </button>

              {isLogOpen && (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-950">
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
                        {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
                className="mt-1 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors shadow-sm"
              >
                Run Another Task
              </button>
            </div>
          )}

          <div className="h-2" />
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-900/40">
          <span>Zulora Computer Plugin v1.1</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPricingModalOpen(true)}
              className="text-amber-500 hover:text-amber-600 font-bold transition-colors"
            >
              {isPro ? 'Pro Active' : 'Upgrade Plan'}
            </button>
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
        </div>
      </aside>
    </>
  );
};

export default ComputerPluginModal;
