/**
 * liveVoiceStream.js — Sub-2s ElevenLabs WebSocket Token-Streaming Engine
 * Connects to ElevenLabs streaming-input WebSocket and plays audio chunks
 * immediately as LLM tokens arrive, using the Web Audio API.
 *
 * Usage:
 *   const stream = new LiveVoiceStream({ voiceId: 'pNInz6obpgDQGcFmaJgB' });
 *   await stream.open();
 *   stream.push('Hello');          // call as LLM tokens arrive
 *   stream.push(' world!');
 *   await stream.flush();          // signal end of text
 *   stream.close();
 */

const ELEVENLABS_WSS = 'wss://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_turbo_v2_5';
const CHUNK_WORD_THRESHOLD = 3; // flush audio every N words
const PUNCTUATION_RE = /[.!?,;:\n]/;

function getApiKey() {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ELEVENLABS_API_KEY) ||
    (typeof window !== 'undefined' && window.__ELEVENLABS_KEY__) ||
    ''
  );
}

export class LiveVoiceStream {
  /**
   * @param {object} opts
   * @param {string}   opts.voiceId     ElevenLabs voice ID
   * @param {function} opts.onAudio     Called with each ArrayBuffer audio chunk
   * @param {function} opts.onError     Called on WebSocket error
   * @param {function} opts.onOpen      Called when WS opens
   * @param {function} opts.onClose     Called when WS closes or playback ends
   */
  constructor({
    voiceId = 'pNInz6obpgDQGcFmaJgB',
    onAudio,
    onError,
    onOpen,
    onClose
  } = {}) {
    this.voiceId = voiceId;
    this.onAudio = onAudio || (() => {});
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});

    this._ws = null;
    this._wordBuffer = [];
    this._wordCount = 0;
    this._closed = false;
    this._audioCtx = null;
    this._playbackQueue = Promise.resolve(); // serialise audio chunks
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  _buildUrl() {
    const key = getApiKey();
    const params = new URLSearchParams({
      model_id: MODEL_ID,
      output_format: 'mp3_44100_128',
    });
    if (key) params.set('xi-api-key', key);
    return `${ELEVENLABS_WSS}/${this.voiceId}/stream-input?${params}`;
  }

  _send(payload) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
    }
  }

  _getAudioCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._audioCtx;
  }

  _enqueueAudio(arrayBuffer) {
    this.onAudio(arrayBuffer);
    this._playbackQueue = this._playbackQueue.then(async () => {
      try {
        const ctx = this._getAudioCtx();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(ctx.destination);
        src.start();
        await new Promise(res => { src.onended = res; });
      } catch (err) {
        // Non-fatal: log and continue queue
        console.warn('[LiveVoiceStream] Audio decode/play error:', err.message);
      }
    });
  }

  _flushWordBuffer() {
    const text = this._wordBuffer.join('');
    if (!text.trim()) return;
    this._wordBuffer = [];
    this._wordCount = 0;
    this._send({ text, try_trigger_generation: true });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Open the ElevenLabs WebSocket connection. */
  async open() {
    if (this._ws) return;
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._buildUrl());
        this._ws.binaryType = 'arraybuffer';

        this._ws.onopen = () => {
          // Send BOS (beginning-of-stream) marker with voice settings
          this._send({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
            generation_config: { chunk_length_schedule: [120, 160, 250, 290] }
          });
          this.onOpen();
          resolve();
        };

        this._ws.onmessage = (event) => {
          try {
            if (event.data instanceof ArrayBuffer) {
              this._enqueueAudio(event.data);
              return;
            }
            const msg = JSON.parse(event.data);
            if (msg.audio) {
              // Base-64 encoded MP3 bytes
              const raw = atob(msg.audio);
              const buf = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
              this._enqueueAudio(buf.buffer);
            }
            if (msg.isFinal) this.onClose();
          } catch (err) {
            console.warn('[LiveVoiceStream] Message parse error:', err.message);
          }
        };

        this._ws.onerror = (err) => {
          this.onError(err);
          reject(err);
        };

        this._ws.onclose = (ev) => {
          if (!this._closed) this.onClose(ev);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Push text tokens as they arrive from the LLM.
   * Automatically flushes at word-count or punctuation boundaries.
   */
  push(text) {
    if (!text || this._closed) return;
    this._wordBuffer.push(text);
    const joined = this._wordBuffer.join('');
    // Count whitespace-delimited words
    this._wordCount = joined.split(/\s+/).filter(Boolean).length;
    const hasBoundary = PUNCTUATION_RE.test(text);
    if (this._wordCount >= CHUNK_WORD_THRESHOLD || hasBoundary) {
      this._flushWordBuffer();
    }
  }

  /**
   * Signal end of text — flush remaining buffer then send EOS marker.
   * Waits briefly so in-flight audio can finish.
   */
  async flush() {
    this._flushWordBuffer();
    this._send({ text: ' ', flush: true });
    await new Promise(res => setTimeout(res, 200));
  }

  /**
   * Zero-lag interrupt: clears audio queue and resets WS context.
   * Call when the user starts speaking while assistant is playing.
   */
  interrupt() {
    this._wordBuffer = [];
    this._wordCount = 0;
    // Reset WS context
    this._send({ text: ' ', flush: true });
    // Drain the playback queue
    this._playbackQueue = Promise.resolve();
    // Suspend audio context to cut sound immediately
    try { this._audioCtx?.suspend(); } catch { /* ignore */ }
  }

  /** Resume audio after an interrupt. */
  resume() {
    try { this._audioCtx?.resume(); } catch { /* ignore */ }
  }

  /** Cleanly close the stream. */
  close() {
    this._closed = true;
    this._wordBuffer = [];
    this._wordCount = 0;
    try { this._ws?.close(); } catch { /* ignore */ }
    this._ws = null;
  }
}

/**
 * Convenience: one-shot TTS for a complete string.
 * Opens, streams, flushes, then closes automatically.
 *
 * @param {string} text     Text to speak
 * @param {string} voiceId  ElevenLabs voice ID
 */
export async function speakWithStream(text, voiceId = 'pNInz6obpgDQGcFmaJgB') {
  const stream = new LiveVoiceStream({ voiceId });
  try {
    await stream.open();
    // Simulate word-by-word push so chunking fires naturally
    const words = text.split(/(\s+)/);
    for (const token of words) {
      stream.push(token);
    }
    await stream.flush();
  } finally {
    stream.close();
  }
}

export default LiveVoiceStream;

