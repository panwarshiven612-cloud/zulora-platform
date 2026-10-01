import React, { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, Mic, PhoneCall, Video, X } from 'lucide-react';

const APP_ID = Number(import.meta.env?.VITE_ZEGO_APP_ID || 993897076);
const makeRoomId = () => `zulora_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
const validRoomId = value => /^[A-Za-z0-9_]{1,64}$/.test(value || '');

export default function ZegoCallModal({ currentUser, onClose }) {
  const meetingRef = useRef(null);
  const instanceRef = useRef(null);
  const [mode, setMode] = useState('voice');
  const [roomId, setRoomId] = useState(() => {
    const sharedRoom = new URLSearchParams(window.location.search).get('roomID');
    return validRoomId(sharedRoom) ? sharedRoom : makeRoomId();
  });
  const [busy, setBusy] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const closeOnEscape = event => { if (event.key === 'Escape' && !inCall) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [inCall, onClose]);

  useEffect(() => () => {
    try { instanceRef.current?.destroy?.(); } catch { /* The SDK may already have closed its room. */ }
  }, []);

  const startCall = async () => {
    if (!currentUser?.getIdToken || !meetingRef.current || busy) return;
    setBusy(true); setNotice('');
    try {
      const [{ ZegoUIKitPrebuilt }, idToken] = await Promise.all([
        import('@zegocloud/zego-uikit-prebuilt'),
        currentUser.getIdToken()
      ]);
      const response = await fetch('/api/zego-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomId, userName: currentUser.displayName || currentUser.email || 'Zulora User' })
      });
      const credentials = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(credentials.error || `Call token request failed (HTTP ${response.status}).`);

      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForProduction(
        credentials.appId || APP_ID,
        credentials.token,
        credentials.roomId || roomId,
        credentials.userId,
        credentials.userName
      );
      const instance = ZegoUIKitPrebuilt.create(kitToken);
      instanceRef.current = instance;
      const inviteUrl = new URL(window.location.href);
      inviteUrl.searchParams.set('roomID', roomId);
      await instance.joinRoom({
        container: meetingRef.current,
        scenario: { mode: ZegoUIKitPrebuilt.GroupCall },
        turnOnMicrophoneWhenJoining: true,
        turnOnCameraWhenJoining: mode === 'video',
        showMyCameraToggleButton: mode === 'video',
        showAudioVideoSettingsButton: true,
        showScreenSharingButton: false,
        showTextChat: false,
        showUserList: true,
        showPreJoinView: false,
        showLeavingView: true,
        sharedLinks: [{ name: 'Join Zulora call', url: inviteUrl.toString() }]
      });
      setInCall(true);
    } catch (error) {
      setNotice(error.message || 'Could not start the call.');
      try { instanceRef.current?.destroy?.(); } catch { /* Ignore partial SDK startup errors. */ }
      instanceRef.current = null;
    } finally { setBusy(false); }
  };

  const copyInvite = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('roomID', roomId);
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setNotice('Clipboard access is unavailable. Copy the room ID manually.'); }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && !inCall) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="zego-call-title" className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[1.5rem] border border-sky-100 bg-gradient-to-br from-white via-[#f5fbff] to-[#e9f5ff] shadow-2xl dark:border-slate-700 dark:from-[#0b1424] dark:via-[#0b1220] dark:to-[#10213a] sm:rounded-[1.5rem]">
        <header className="flex items-start justify-between gap-3 border-b border-sky-100 px-4 py-4 dark:border-slate-700 sm:px-6">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-600">ZEGOCLOUD · Live room</div><h2 id="zego-call-title" className="mt-1 text-lg font-black text-slate-900 dark:text-white">Voice &amp; video call</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Start a private room or share its invite link. A Zulora AI media participant requires a separate real-time agent service.</p></div>
          <button type="button" onClick={onClose} aria-label="Close call" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white/80 text-slate-500 dark:border-slate-700 dark:bg-slate-900/70"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {notice && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">{notice}</p>}
          {!inCall && <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setMode('voice')} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold ${mode === 'voice' ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300'}`}><Mic className="h-4 w-4" /> Voice room</button>
            <button type="button" onClick={() => setMode('video')} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold ${mode === 'video' ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300'}`}><Video className="h-4 w-4" /> Video room</button>
            <span className="ml-auto rounded-lg bg-slate-100 px-2.5 py-2 font-mono text-[10px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">{roomId}</span>
            <button type="button" onClick={copyInvite} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sky-200 bg-white/80 px-3 text-xs font-bold text-sky-700 dark:border-sky-900/60 dark:bg-slate-900/70 dark:text-sky-300"><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy invite'}</button>
            <button type="button" onClick={() => { setRoomId(makeRoomId()); setNotice(''); }} className="min-h-10 rounded-xl border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">New room</button>
          </div>}
          <div ref={meetingRef} className={`min-h-[320px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-slate-700 ${inCall ? 'h-[min(68dvh,680px)]' : 'grid place-items-center'}`}>
            {!inCall && <div className="max-w-sm px-5 text-center text-white"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-500/20 text-sky-300">{mode === 'video' ? <Video className="h-7 w-7" /> : <PhoneCall className="h-7 w-7" />}</div><p className="mt-3 text-sm font-bold">Ready to start your {mode} room</p><p className="mt-1 text-xs text-slate-400">Camera and microphone permissions are requested by your browser when the room starts.</p><button type="button" onClick={startCall} disabled={busy} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-500 px-5 text-sm font-bold text-white hover:bg-sky-400 disabled:opacity-60">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}{busy ? 'Connecting…' : `Start ${mode} room`}</button></div>}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Call tokens are signed on the server and expire after one hour. Set <code className="font-bold">ZEGO_SERVER_SECRET</code> in the server environment; it is never sent to the browser.</p>
        </div>
      </section>
    </div>
  );
}
