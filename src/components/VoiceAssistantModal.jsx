import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  Sparkles,
  Zap,
  RotateCcw,
  Square,
  Radio
} from 'lucide-react';
import { apiRouter } from '../services/apiRouter';

export const VoiceAssistantModal = ({ isOpen, onClose, currentUser, onNewTurn }) => {
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [conversation, setConversation] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [waveHeights, setWaveHeights] = useState([20, 35, 60, 40, 25, 55, 30, 45]);

  const recognitionRef = useRef(null);
  const speechUtteranceRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const animFrameRef = useRef(null);
  const activeRef = useRef(false);

  // Initialize SpeechSynthesis Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const pickBestVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;

      // Prefer natural/enhanced English voices
      const preferred = voices.find(v =>
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Siri')) &&
        v.lang.startsWith('en')
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

      setSelectedVoice(preferred);
    };

    pickBestVoice();
    window.speechSynthesis.onvoiceschanged = pickBestVoice;
  }, []);

  // Animated visualizer waves
  useEffect(() => {
    if (status === 'listening' || status === 'speaking') {
      const interval = setInterval(() => {
        setWaveHeights(
          Array.from({ length: 9 }, () => Math.floor(Math.random() * (status === 'speaking' ? 70 : 50)) + 15)
        );
      }, 120);
      return () => clearInterval(interval);
    } else {
      setWaveHeights([20, 25, 20, 25, 20, 25, 20, 25, 20]);
    }
  }, [status]);

  // Clean up when modal closes
  const stopAll = useCallback(() => {
    activeRef.current = false;
    clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopAll();
      setStatus('idle');
      setTranscript('');
      setInterimTranscript('');
      setAiResponse('');
    } else {
      activeRef.current = true;
      startListening();
    }
    return () => stopAll();
  }, [isOpen]);

  // Speak AI response using native SpeechSynthesis
  const speakText = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    // Clean markdown symbols for natural speech
    const cleanSpeech = text
      .replace(/[*#`_~]/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/```[\s\S]*?```/g, 'Here is the code.')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      if (activeRef.current) setStatus('speaking');
    };

    utterance.onend = () => {
      if (activeRef.current) {
        setStatus('idle');
        // Automatically listen again for hands-free live assistant flow
        setTimeout(() => {
          if (activeRef.current) startListening();
        }, 600);
      }
    };

    utterance.onerror = (e) => {
      console.warn('[VoiceAssistant] Speech error:', e);
      if (activeRef.current) setStatus('idle');
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [selectedVoice]);

  // Query AI model with waterfall failover (Gemini -> Groq -> fallback)
  const processUserQuery = useCallback(async (userQuery) => {
    if (!userQuery.trim()) {
      setStatus('idle');
      return;
    }

    setStatus('thinking');
    clearTimeout(silenceTimerRef.current);

    const voicePrompt = `You are Zulora Live Voice Assistant, a friendly, concise, natural-sounding AI. Respond directly to the user in 1 to 3 conversational sentences. Avoid complex markdown, bullet lists, or code blocks unless explicitly requested. User said: "${userQuery}"`;

    try {
      const context = conversation.slice(-4).map(turn => ({
        role: turn.role,
        content: turn.text
      }));

      // Use fast flash model for ultra-low latency responses
      const result = await apiRouter.generateChat(
        voicePrompt,
        context,
        {
          model: 'flash',
          currentUser
        }
      );

      const reply = result?.text?.trim() || "I'm here with you. What would you like to explore next?";
      setAiResponse(reply);

      // Add to session history
      const updatedHistory = [
        ...conversation,
        { role: 'user', text: userQuery },
        { role: 'assistant', text: reply }
      ];
      setConversation(updatedHistory);
      onNewTurn?.({ user: userQuery, assistant: reply });

      // Speak back
      speakText(reply);
    } catch (err) {
      console.error('[VoiceAssistant] AI generation error:', err);
      // Failover response
      const fallbackReply = "I heard you, but encountered a network glitch. Let's try once more.";
      setAiResponse(fallbackReply);
      speakText(fallbackReply);
    }
  }, [conversation, currentUser, speakText, onNewTurn]);

  // Speech Recognition (Web Speech API)
  const startListening = useCallback(() => {
    stopAll();
    activeRef.current = true;
    setErrorMessage('');
    setTranscript('');
    setInterimTranscript('');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('error');
      setErrorMessage('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let finalSoFar = '';

      recognition.onstart = () => {
        if (activeRef.current) setStatus('listening');
      };

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalSoFar += ' ' + item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }

        const combined = (finalSoFar + ' ' + interim).trim();
        setTranscript(combined);
        setInterimTranscript(interim);

        // Reset silence timer: automatically process after 1.8 seconds of silence
        clearTimeout(silenceTimerRef.current);
        if (combined.length > 2) {
          silenceTimerRef.current = setTimeout(() => {
            if (activeRef.current && combined.trim()) {
              recognition.stop();
              processUserQuery(combined.trim());
            }
          }, 1800);
        }
      };

      recognition.onerror = (event) => {
        console.warn('[VoiceAssistant] Recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setStatus('error');
          setErrorMessage('Microphone access denied. Please allow microphone permissions.');
        } else if (event.error !== 'no-speech') {
          setStatus('idle');
        }
      };

      recognition.onend = () => {
        if (status === 'listening' && activeRef.current && !silenceTimerRef.current) {
          setStatus('idle');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('[VoiceAssistant] Could not start speech recognition:', err);
      setStatus('idle');
    }
  }, [stopAll, processUserQuery, status]);

  // Tap to Interrupt: instantly cuts off AI speaking and switches to listening
  const handleInterrupt = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    startListening();
  };

  // Toggle Mic
  const handleToggleMic = () => {
    if (status === 'listening') {
      clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
      if (transcript.trim()) {
        processUserQuery(transcript.trim());
      } else {
        setStatus('idle');
      }
    } else if (status === 'speaking') {
      handleInterrupt();
    } else {
      startListening();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-2xl animate-fade-in">
      {/* Background radial glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-sky-500/20 rounded-full blur-[100px]" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-lg rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6 glass-elevated dark:glass-dark border border-white/20 dark:border-slate-700/60 shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gemini Live Voice</span>
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close Assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Central Visualizer Orb & Rings */}
        <div className="relative flex items-center justify-center my-4">
          {/* Animated Glowing Wave Rings */}
          <div
            className={`absolute w-44 h-44 rounded-full transition-all duration-700 ${
              status === 'listening'
                ? 'bg-gradient-to-tr from-sky-500/30 via-cyan-400/20 to-blue-600/30 animate-ping opacity-75'
                : status === 'speaking'
                ? 'bg-gradient-to-tr from-indigo-500/40 via-purple-500/20 to-sky-400/40 animate-pulse opacity-85'
                : status === 'thinking'
                ? 'bg-gradient-to-tr from-amber-400/30 to-sky-500/30 animate-spin opacity-60'
                : 'bg-sky-500/10 opacity-30'
            }`}
          />

          <div
            className={`absolute w-36 h-36 rounded-full border border-sky-400/30 transition-transform duration-500 ${
              status === 'listening' || status === 'speaking' ? 'scale-110' : 'scale-95'
            }`}
          />

          {/* Core Interactive Button Orb */}
          <button
            onClick={handleToggleMic}
            className={`relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-2xl cursor-pointer ${
              status === 'listening'
                ? 'bg-gradient-to-br from-sky-400 via-sky-500 to-blue-600 text-white shadow-sky-500/50 scale-105 ring-4 ring-sky-300/40'
                : status === 'speaking'
                ? 'bg-gradient-to-br from-indigo-500 via-purple-600 to-sky-500 text-white shadow-indigo-500/50 scale-105 ring-4 ring-indigo-300/40'
                : status === 'thinking'
                ? 'bg-gradient-to-br from-slate-800 to-slate-900 text-sky-400 border border-sky-500/40'
                : 'bg-white/10 dark:bg-slate-800/80 text-slate-300 hover:text-white hover:scale-105 border border-white/20'
            }`}
          >
            {status === 'thinking' ? (
              <Zap className="w-9 h-9 animate-bounce text-sky-400" />
            ) : status === 'speaking' ? (
              <Volume2 className="w-9 h-9 animate-pulse" />
            ) : status === 'listening' ? (
              <Mic className="w-9 h-9" />
            ) : (
              <MicOff className="w-9 h-9 text-slate-400" />
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider mt-1">
              {status === 'listening'
                ? 'Listening'
                : status === 'speaking'
                ? 'Speaking'
                : status === 'thinking'
                ? 'Thinking'
                : 'Tap to speak'}
            </span>
          </button>
        </div>

        {/* Dynamic Waveform Bars */}
        <div className="flex items-center justify-center gap-1.5 h-12 w-full max-w-xs">
          {waveHeights.map((h, i) => (
            <div
              key={i}
              className={`w-1.5 rounded-full transition-all duration-150 ${
                status === 'listening'
                  ? 'bg-sky-400 shadow-sm shadow-sky-400/50'
                  : status === 'speaking'
                  ? 'bg-gradient-to-t from-indigo-400 to-sky-400'
                  : 'bg-slate-700/50'
              }`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        {/* Live Subtitle Transcript Display */}
        <div className="w-full min-h-[5rem] max-h-36 overflow-y-auto px-4 py-2 rounded-2xl bg-white/5 dark:bg-black/30 border border-white/10 flex flex-col items-center justify-center text-center">
          {errorMessage ? (
            <p className="text-xs text-rose-400 font-medium">{errorMessage}</p>
          ) : status === 'listening' ? (
            <p className="text-sm font-medium text-sky-300 animate-pulse">
              {transcript || 'Go ahead, I am listening...'}
            </p>
          ) : status === 'thinking' ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Zap className="w-3.5 h-3.5 text-sky-400 animate-spin" />
              <span>Synthesizing smart answer...</span>
            </div>
          ) : status === 'speaking' ? (
            <p className="text-sm font-medium text-slate-100 leading-relaxed">
              "{aiResponse}"
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              Tap the orb or speak to converse in real-time. 100% free speech recognition.
            </p>
          )}
        </div>

        {/* Interactive Controls & Tap To Interrupt */}
        <div className="w-full flex items-center justify-between gap-3 pt-2">
          {status === 'speaking' ? (
            <button
              onClick={handleInterrupt}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-2"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Tap to Interrupt</span>
            </button>
          ) : (
            <button
              onClick={handleToggleMic}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                status === 'listening'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                  : 'azure-gradient-btn text-white'
              }`}
            >
              {status === 'listening' ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span>Done Speaking</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Start Voice Mode</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => {
              stopAll();
              setTranscript('');
              setAiResponse('');
              setConversation([]);
              startListening();
            }}
            className="p-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Reset conversation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceAssistantModal;
