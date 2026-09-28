import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, X, Sparkles, Zap, Settings2, Languages, Radio } from 'lucide-react';
import { apiRouter } from '../services/apiRouter';
import { requestVoiceAudio } from '../services/generationApi';
import { getPreferredVoiceId, getVoiceByPreference, setPreferredVoiceId, VOICE_OPTIONS } from '../services/voicePreferences';
import { useAuth } from '../context/AuthContext';

const cleanForSpeech = text => String(text || '')
  .replace(/```[\s\S]*?```/g, ' Code response is ready in the chat.')
  .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
  .replace(/[*#`_~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const VoiceAssistantModal = ({ isOpen, onClose, currentUser, onNewTurn }) => {
  const { isPro } = useAuth();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [conversation, setConversation] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState(getPreferredVoiceId);
  const [language, setLanguage] = useState('hi-IN');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [waveHeights, setWaveHeights] = useState(Array(13).fill(18));
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef('');
  const utteranceRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const activeRef = useRef(false);
  const statusRef = useRef(status);
  const startListeningRef = useRef(null);
  statusRef.current = status;

  const availableVoices = useMemo(() => VOICE_OPTIONS.filter(voice => voice.tier === 'free' || isPro), [isPro]);
  const selectedVoice = getVoiceByPreference(selectedVoiceId);

  useEffect(() => {
    const syncVoice = event => {
      const id = event.detail || getPreferredVoiceId();
      const voice = VOICE_OPTIONS.find(option => option.id === id);
      setSelectedVoiceId(voice && (voice.tier === 'free' || isPro) ? id : 'adam');
    };
    syncVoice({ detail: getPreferredVoiceId() });
    window.addEventListener('zulora:voice-preference', syncVoice);
    return () => window.removeEventListener('zulora:voice-preference', syncVoice);
  }, [isPro]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = '';
    }
    try { window.speechSynthesis?.cancel(); } catch { /* Browser speech may be unavailable. */ }
  }, []);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* Recognition may already have stopped. */ }
      recognitionRef.current = null;
    }
    cleanupAudio();
  }, [cleanupAudio]);

  const startListening = useCallback(() => {
    if (!activeRef.current || typeof window === 'undefined') return;
    clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* Replacing the previous recognition session. */ }
      recognitionRef.current = null;
    }
    cleanupAudio();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('error');
      setErrorMessage('Voice input is unavailable in this browser. Try Chrome, Edge, or Safari.');
      return;
    }
    setErrorMessage('');
    setTranscript('');
    setInterimTranscript('');
    let finalText = '';
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.onstart = () => activeRef.current && setStatus('listening');
      recognition.onresult = event => {
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalText += `${result[0].transcript} `;
          else interim += `${result[0].transcript} `;
        }
        const combined = `${finalText} ${interim}`.trim();
        setTranscript(combined);
        setInterimTranscript(interim.trim());
        clearTimeout(silenceTimerRef.current);
        if (combined.length > 2) {
          silenceTimerRef.current = window.setTimeout(() => {
            if (!activeRef.current || !combined.trim()) return;
            try { recognition.stop(); } catch { /* The browser may have ended recognition already. */ }
            processQueryRef.current?.(combined.trim());
          }, 1_450);
        }
      };
      recognition.onerror = event => {
        if (event.error === 'not-allowed') {
          setStatus('error');
          setErrorMessage('Allow microphone access in your browser to talk with Zulora.');
        } else if (event.error !== 'no-speech' && activeRef.current) {
          setStatus('idle');
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (activeRef.current && statusRef.current === 'listening' && !silenceTimerRef.current) setStatus('idle');
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      console.warn('[VoiceAssistant] Could not start speech recognition:', error?.message || error);
      setStatus('error');
      setErrorMessage('The microphone could not start. Check browser permissions and try again.');
    }
  }, [cleanupAudio, language]);
  startListeningRef.current = startListening;

  const speakText = useCallback(async text => {
    const spokenText = cleanForSpeech(text);
    if (!spokenText || !activeRef.current) return;
    setStatus('speaking');
    cleanupAudio();
    try {
      const blob = await requestVoiceAudio(spokenText, selectedVoice.voiceId, currentUser);
      if (blob?.size && activeRef.current) {
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          cleanupAudio();
          if (activeRef.current) {
            setStatus('idle');
            window.setTimeout(() => startListeningRef.current?.(), 350);
          }
        };
        audio.onerror = () => {
          cleanupAudio();
          if (activeRef.current) setStatus('idle');
        };
        await audio.play();
        return;
      }
    } catch (error) {
      console.info('[VoiceAssistant] Using device speech fallback:', error?.message || error);
    }
    if (!activeRef.current) return;
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      setStatus('error');
      setErrorMessage('Voice playback is unavailable. The response is still shown here.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = language;
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.onend = () => {
      utteranceRef.current = null;
      if (activeRef.current) {
        setStatus('idle');
        window.setTimeout(() => startListeningRef.current?.(), 350);
      }
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      if (activeRef.current) setStatus('idle');
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [cleanupAudio, currentUser, language, selectedVoice.voiceId]);

  const processQueryRef = useRef(null);
  const processUserQuery = useCallback(async userQuery => {
    const query = String(userQuery || '').trim();
    if (!query || !activeRef.current) return;
    clearTimeout(silenceTimerRef.current);
    setTranscript(query);
    setInterimTranscript('');
    setStatus('thinking');
    const voicePrompt = `You are Zulora's natural voice conversation partner. Reply in the same language and script the user used, including natural Hindi or Hinglish when appropriate. Keep the spoken answer warm, direct, and concise in one to three sentences. Avoid markdown, lists, and code unless asked. User: ${query}`;
    try {
      const context = conversation.slice(-6).map(turn => ({ role: turn.role, content: turn.text }));
      const result = await apiRouter.generateChat(voicePrompt, context, { model: 'auto', currentUser });
      if (!activeRef.current) return;
      const reply = result?.text?.trim() || 'I am here. What would you like to talk about?';
      setAiResponse(reply);
      setConversation(previous => [...previous, { role: 'user', text: query }, { role: 'assistant', text: reply }]);
      onNewTurn?.({ user: query, assistant: reply });
      await speakText(reply);
    } catch (error) {
      console.warn('[VoiceAssistant] AI generation error:', error?.message || error);
      if (!activeRef.current) return;
      const fallback = 'I heard you, but the connection interrupted. Please try once more.';
      setAiResponse(fallback);
      await speakText(fallback);
    }
  }, [conversation, currentUser, onNewTurn, speakText]);
  processQueryRef.current = processUserQuery;

  useEffect(() => {
    if (!isOpen) {
      stopAll();
      setStatus('idle');
      setTranscript('');
      setInterimTranscript('');
      setAiResponse('');
      setErrorMessage('');
      return undefined;
    }
    activeRef.current = true;
    const timer = window.setTimeout(() => startListeningRef.current?.(), 250);
    return () => {
      window.clearTimeout(timer);
      stopAll();
    };
  }, [isOpen, stopAll]);

  useEffect(() => {
    if (!['listening', 'speaking', 'thinking'].includes(status)) {
      setWaveHeights(Array(13).fill(18));
      return undefined;
    }
    const interval = window.setInterval(() => {
      const maximum = status === 'thinking' ? 48 : status === 'speaking' ? 70 : 54;
      setWaveHeights(Array.from({ length: 13 }, () => Math.floor(Math.random() * maximum) + 12));
    }, 130);
    return () => window.clearInterval(interval);
  }, [status]);

  if (!isOpen) return null;

  const handleMic = () => {
    if (status === 'listening') {
      clearTimeout(silenceTimerRef.current);
      try { recognitionRef.current?.stop(); } catch { /* Ignore stale recognition instances. */ }
      const query = transcript.trim();
      if (query) processUserQuery(query);
      else setStatus('idle');
      return;
    }
    if (status === 'speaking') {
      cleanupAudio();
      startListeningRef.current?.();
      return;
    }
    startListeningRef.current?.();
  };

  const chooseVoice = event => {
    const id = event.target.value;
    setSelectedVoiceId(setPreferredVoiceId(id));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#050711]/95 p-2 backdrop-blur-2xl sm:p-5" role="dialog" aria-modal="true" aria-label="Zulora voice assistant">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-28 -top-20 h-72 w-72 rounded-full bg-sky-500/20 blur-[100px]" />
        <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-violet-500/20 blur-[110px]" />
        <div className="voice-particle absolute left-[18%] top-[22%] h-1 w-1 rounded-full bg-cyan-100" />
        <div className="voice-particle voice-particle-delay absolute right-[22%] top-[31%] h-1.5 w-1.5 rounded-full bg-indigo-100" />
        <div className="voice-particle absolute bottom-[24%] left-[27%] h-1 w-1 rounded-full bg-sky-100" />
      </div>

      <section className="relative my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col items-center overflow-y-auto rounded-[30px] border border-white/10 bg-slate-950/65 p-4 text-center text-white shadow-[0_30px_120px_rgba(0,0,0,.65)] sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[36px] sm:p-7">
        <header className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 bg-slate-950/70 pb-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2 text-left">
            <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-sky-200 sm:text-xs"><Sparkles size={13} /> Zulora Live Voice</p>
              <p className="truncate text-[10px] text-slate-500">Natural Hindi, Hinglish &amp; English</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings} className="rounded-xl border border-white/10 p-2 text-slate-300 transition hover:bg-white/10" aria-label="Voice settings"><Settings2 size={17} /></button>
            <button type="button" onClick={() => { stopAll(); onClose?.(); }} className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close voice assistant"><X size={19} /></button>
          </div>
        </header>

        {showSettings && (
          <div className="z-[5] mt-1 grid w-full gap-3 rounded-2xl border border-white/10 bg-white/[.045] p-3 text-left sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-slate-300">
              Voice · {selectedVoice.gender}
              <select value={selectedVoiceId} onChange={chooseVoice} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#131827] px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400">
                {availableVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}{voice.tier === 'pro' ? ' · Pro' : ''}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-slate-300">
              Speech recognition language
              <select value={language} onChange={event => setLanguage(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#131827] px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400">
                <option value="hi-IN">Hindi + Hinglish</option>
                <option value="en-IN">English (India)</option>
                <option value="en-US">English (US)</option>
              </select>
            </label>
            {!isPro && <p className="text-[10px] leading-5 text-slate-500 sm:col-span-2">Six voices are available on the free plan. Pro plans add two more studio voices.</p>}
          </div>
        )}

        <div className="flex w-full flex-1 flex-col items-center justify-center py-2 sm:py-5">
          <div className={`relative my-2 flex h-44 w-44 items-center justify-center sm:h-56 sm:w-56 ${status === 'thinking' ? 'voice-orb-thinking' : status === 'speaking' ? 'voice-orb-speaking' : status === 'listening' ? 'voice-orb-listening' : ''}`}>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-300/15 via-blue-500/15 to-violet-500/25 blur-xl" />
            <div className={`absolute inset-4 rounded-full border border-sky-200/20 ${status === 'listening' || status === 'speaking' ? 'animate-pulse' : ''}`} />
            <div className="absolute inset-8 rounded-full border border-violet-200/20" />
            <button type="button" onClick={handleMic} aria-label={status === 'listening' ? 'Finish speaking' : status === 'speaking' ? 'Interrupt response' : 'Start talking'} className={`relative z-10 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-white/20 shadow-[0_0_65px_rgba(56,189,248,.25)] transition-all duration-500 sm:h-36 sm:w-36 ${status === 'listening' ? 'scale-105 bg-gradient-to-br from-cyan-300 via-sky-500 to-blue-700 ring-4 ring-sky-200/20' : status === 'speaking' ? 'scale-105 bg-gradient-to-br from-indigo-400 via-violet-600 to-sky-500 ring-4 ring-violet-200/20' : 'bg-[#111827]/95 hover:scale-105 hover:border-sky-200/60'}`}>
              {status === 'thinking' ? <Zap className="h-8 w-8 animate-pulse text-cyan-200 sm:h-9 sm:w-9" /> : status === 'speaking' ? <Volume2 className="h-8 w-8 animate-pulse sm:h-9 sm:w-9" /> : status === 'listening' ? <Mic className="h-8 w-8 sm:h-9 sm:w-9" /> : <MicOff className="h-8 w-8 text-slate-300 sm:h-9 sm:w-9" />}
              <span className="mt-2 text-[9px] font-bold uppercase tracking-widest sm:text-[10px]">{status === 'listening' ? 'Listening' : status === 'speaking' ? 'Speaking' : status === 'thinking' ? 'Thinking' : 'Tap to speak'}</span>
            </button>
          </div>

          <div className="my-3 flex h-12 items-center justify-center gap-1.5" aria-hidden="true">
            {waveHeights.map((height, index) => <span key={index} className={`w-1 rounded-full transition-[height,background-color] duration-150 ${status === 'speaking' ? 'bg-gradient-to-t from-violet-500 to-cyan-200' : status === 'listening' ? 'bg-sky-300' : status === 'thinking' ? 'bg-amber-200/70' : 'bg-slate-700'}`} style={{ height: `${height}px` }} />)}
          </div>
          <p className="mb-3 flex items-center gap-1.5 text-[10px] text-slate-500"><Languages size={13} /> {language === 'hi-IN' ? 'Hindi + Hinglish' : language === 'en-IN' ? 'English (India)' : 'English (US)'} <span className="text-slate-700">·</span> {selectedVoice.name}</p>

          <div className="flex min-h-24 max-h-40 w-full items-center justify-center overflow-y-auto rounded-2xl border border-white/10 bg-black/25 px-4 py-3 sm:min-h-28">
            {errorMessage ? <p className="text-xs leading-5 text-rose-300">{errorMessage}</p>
              : status === 'listening' ? <p className="text-sm font-medium leading-6 text-sky-100">{transcript || <span className="animate-pulse text-slate-400">Go ahead, I am listening…</span>}{interimTranscript && transcript !== interimTranscript ? <span className="text-sky-200/60"> {interimTranscript}</span> : null}</p>
                : status === 'thinking' ? <p className="flex items-center gap-2 text-xs text-slate-400"><Zap size={14} className="animate-pulse text-sky-300" /> Finding a clear, natural response…</p>
                  : status === 'speaking' ? <p className="text-sm leading-6 text-slate-100">{aiResponse}</p>
                    : <p className="text-xs leading-5 text-slate-400">Tap the glowing sphere or speak naturally. Zulora replies in your language.</p>}
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600"><Radio size={12} /> Microphone stays active only while this voice panel is open</div>
        </div>
      </section>
      <style>{`@keyframes voice-float{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-14px);opacity:1}}@keyframes voice-bloom{0%,100%{transform:scale(.97);filter:brightness(.9)}50%{transform:scale(1.04);filter:brightness(1.18)}}.voice-particle{animation:voice-float 4.5s ease-in-out infinite}.voice-particle-delay{animation-delay:1.4s}.voice-orb-listening{animation:voice-bloom 1.8s ease-in-out infinite}.voice-orb-speaking{animation:voice-bloom 1.1s ease-in-out infinite}.voice-orb-thinking{animation:voice-bloom 2.2s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.voice-particle,.voice-orb-listening,.voice-orb-speaking,.voice-orb-thinking{animation:none}}`}</style>
    </div>
  );
};

export default VoiceAssistantModal;
