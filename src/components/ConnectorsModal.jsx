import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Check, ChevronRight, Cloud, ExternalLink, FileSpreadsheet,
  FileText, LoaderCircle, Mail, Plug, RefreshCw, ShieldCheck, Trash2, Unplug, Upload, X
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { driveAuth } from '../config/firebaseDrive';
import connectorManager, { CONNECTOR_CONFIG } from '../services/connectorManager';
import {
  listConnectorSpreadsheets, listGoogleFormResponses, listUpcomingCalendarEvents
} from '../services/backgroundConnectorEngine';
import { zuloraDriveService } from '../services/zuloraDriveService';

const ICONS = {
  gmail: Mail,
  sheets: FileSpreadsheet,
  calendar: CalendarDays,
  forms: FileText,
  drive: Cloud
};

const formatBytes = bytes => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
};

const formatEventDate = event => {
  const value = event?.start?.dateTime || event?.start?.date;
  if (!value) return 'Time not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: event?.start?.dateTime ? 'short' : undefined });
};

export default function ConnectorsModal({ currentUser, reconnectProvider = '', onClose }) {
  const [connections, setConnections] = useState({});
  const [driveUser, setDriveUser] = useState(driveAuth.currentUser);
  const [driveUsage, setDriveUsage] = useState({ usedBytes: 0, filesCount: 0 });
  const [driveFiles, setDriveFiles] = useState([]);
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [events, setEvents] = useState([]);
  const [formId, setFormId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const driveFileInputRef = useRef(null);

  const refresh = useCallback(async () => {
    const status = await connectorManager.getStatuses(currentUser?.uid);
    setConnections(status);
    if (status.sheets?.connected) {
      try { setSpreadsheets(await listConnectorSpreadsheets()); }
      catch (error) { setNotice(error.message); }
    } else setSpreadsheets([]);
    if (status.calendar?.connected) {
      try { setEvents(await listUpcomingCalendarEvents(4)); }
      catch (error) { setNotice(error.message); }
    } else setEvents([]);
    if (driveAuth.currentUser) {
      try {
        const [usage, files] = await Promise.all([
          zuloraDriveService.getStorageUsage(), zuloraDriveService.listAllDriveFiles()
        ]);
        setDriveUsage(usage);
        setDriveFiles(files);
      }
      catch (error) { setNotice(error.message); }
    } else { setDriveUsage({ usedBytes: 0, filesCount: 0 }); setDriveFiles([]); }
  }, [currentUser?.uid]);

  useEffect(() => {
    connectorManager.prepareOAuth().catch(() => {});
    refresh();
    let stopUsage = () => {};
    const unsubscribe = onAuthStateChanged(driveAuth, user => {
      setDriveUser(user);
      stopUsage();
      stopUsage = () => {};
      if (user) {
        try {
          stopUsage = zuloraDriveService.watchStorageUsage(setDriveUsage, error => setNotice(error.message));
        } catch (error) { setNotice(error.message); }
        zuloraDriveService.listAllDriveFiles().then(setDriveFiles).catch(error => setNotice(error.message));
      } else {
        setDriveUsage({ usedBytes: 0, filesCount: 0 });
        setDriveFiles([]);
      }
    });
    const onChanged = () => refresh();
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('zulora-connectors-changed', onChanged);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      stopUsage();
      window.removeEventListener('zulora-connectors-changed', onChanged);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, refresh]);

  const providerCards = useMemo(() => Object.values(CONNECTOR_CONFIG), []);

  const connectGoogle = async provider => {
    setBusy(provider);
    setNotice('');
    try {
      const result = await connectorManager.connect(provider, currentUser?.uid);
      if (!result.metadataSaved) setNotice('Connected for this browser session. Deploy the updated Firestore rules to persist connector status across sessions.');
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const disconnectGoogle = async provider => {
    setBusy(provider);
    try {
      await connectorManager.disconnect(provider, currentUser?.uid);
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const connectDrive = async () => {
    setBusy('drive');
    setNotice('');
    try {
      await zuloraDriveService.connect();
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const uploadDriveFiles = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setBusy('drive-upload');
    setNotice('');
    try {
      for (const file of files) await zuloraDriveService.uploadFileToDrive(file, 'Uploads');
      setDriveFiles(await zuloraDriveService.listAllDriveFiles());
      setNotice(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'} to Zulora Drive.`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const deleteDriveFile = async file => {
    if (!window.confirm(`Delete “${file.name}” from Zulora Drive?`)) return;
    setBusy(`delete:${file.id}`);
    setNotice('');
    try {
      await zuloraDriveService.deleteDriveFile(file.id);
      setDriveFiles(await zuloraDriveService.listAllDriveFiles());
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const clearAllDriveFiles = async () => {
    if (!window.confirm('Permanently delete every indexed file and its stored object from this Zulora Drive account? This cannot be undone.')) return;
    setBusy('drive-clear');
    setNotice('');
    try {
      const result = await zuloraDriveService.clearDriveFiles();
      setDriveFiles(await zuloraDriveService.listAllDriveFiles());
      setNotice(result.failed
        ? `Deleted ${result.deleted} file${result.deleted === 1 ? '' : 's'}; ${result.failed} could not be deleted. Contact support to finish cleanup.`
        : `Deleted ${result.deleted} file${result.deleted === 1 ? '' : 's'} from Zulora Drive.`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const syncForm = async () => {
    const id = formId.match(/forms\/d\/(?:e\/)?([\w-]+)/i)?.[1] || formId.trim();
    if (!id) { setFormMessage('Enter a Google Form URL or form ID.'); return; }
    setBusy('form-sync');
    setFormMessage('');
    try {
      const responses = await listGoogleFormResponses(id);
      setFormMessage(`Loaded ${responses.length} response${responses.length === 1 ? '' : 's'} into the chat composer. Review before sending.`);
      window.dispatchEvent(new CustomEvent('zulora-form-responses', { detail: { formId: id, responses } }));
    } catch (error) { setFormMessage(error.message); }
    finally { setBusy(''); }
  };

  const cardClass = 'rounded-2xl border border-sky-100/90 bg-white/85 p-4 shadow-[0_12px_36px_rgba(30,105,180,0.08)] backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/75';
  const renderStatus = connected => connected
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Check className="h-3 w-3" /> Connected</span>
    : <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Not connected</span>;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connectors-title"
        className="max-h-[92dvh] w-full overflow-hidden rounded-t-[1.75rem] border border-white/70 bg-gradient-to-br from-[#f8fdff] via-white to-[#edf7ff] shadow-2xl dark:border-slate-700 dark:from-[#0a1526] dark:via-[#0b1220] dark:to-[#101b2f] sm:max-w-4xl sm:rounded-[1.75rem]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-sky-100/80 px-4 pb-4 pt-5 dark:border-slate-700/70 sm:px-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-white/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700 dark:border-sky-900/70 dark:bg-slate-900/70 dark:text-sky-300"><ShieldCheck className="h-3 w-3" /> Native API connections</div>
            <h2 id="connectors-title" className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">Connectors</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">Google APIs and Zulora Drive run without the Computer Plugin extension. The Computer Plugin is reserved for browser page and DOM automation.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connectors" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white/80 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[calc(92dvh-112px)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {notice && <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">{notice}</div>}
          {reconnectProvider && <div role="status" className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">{reconnectProvider} needs a fresh Google authorization for this browser session. Select Connect/Reconnect below; Google access tokens are kept in memory only.</div>}
          {!connectorManager.clientConfigured && <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50/80 px-3.5 py-3 text-xs leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">Set <code className="font-bold">VITE_GOOGLE_CLIENT_ID</code> and enable the Google APIs and OAuth consent screen in Google Cloud to connect Gmail, Sheets, Calendar, and Forms. Zulora Drive uses its separate Firebase sign-in.</div>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providerCards.map(config => {
              const Icon = ICONS[config.id];
              const status = connections[config.id] || {};
              const connecting = busy === config.id;
              return (
                <article key={config.id} className={`${cardClass} flex min-h-[190px] flex-col`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-100 bg-gradient-to-br from-white to-sky-50 text-sky-600 shadow-sm dark:border-sky-900/70 dark:from-slate-800 dark:to-sky-950/50 dark:text-sky-300"><Icon className="h-5 w-5" /></div>
                    {renderStatus(status.connected)}
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{config.name}</h3>
                  <p className="mt-1 min-h-8 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{config.description}</p>
                  {status.email && <div className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{status.email}</div>}
                  {status.needsReconnect && <div className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">Reconnect to authorize this session</div>}
                  {config.id === 'sheets' && status.connected && <div className="mt-2 space-y-1">{spreadsheets.length ? spreadsheets.slice(0, 2).map(file => <a key={file.id} href={file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[10px] font-medium text-sky-700 hover:underline dark:text-sky-300"><ExternalLink className="h-3 w-3 shrink-0" />{file.name}</a>) : <span className="text-[10px] text-slate-400">No recent spreadsheet found</span>}</div>}
                  {config.id === 'calendar' && status.connected && <div className="mt-2 space-y-1">{events.length ? events.slice(0, 2).map(event => <div key={event.id} className="truncate text-[10px] text-slate-600 dark:text-slate-300">{formatEventDate(event)} · {event.summary || 'Untitled event'}</div>) : <span className="text-[10px] text-slate-400">No upcoming events</span>}</div>}
                  {config.id === 'forms' && status.connected && <div className="mt-2 space-y-2"><input value={formId} onChange={event => setFormId(event.target.value)} placeholder="Form URL or ID" aria-label="Google Form URL or ID" className="h-9 w-full rounded-lg border border-slate-200 bg-white/90 px-2.5 text-xs outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950/50" />{formMessage && <p role="status" className="text-[10px] text-slate-500">{formMessage}</p>}</div>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    {config.id === 'forms' && status.connected ? <button type="button" disabled={Boolean(busy)} onClick={syncForm} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60">{busy === 'form-sync' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sync responses</button> : <span className="text-[10px] text-slate-400">{status.connected ? 'Ready for chat tasks' : ''}</span>}
                    <button type="button" disabled={Boolean(busy) || !connectorManager.clientConfigured} onClick={() => status.connected ? disconnectGoogle(config.id) : connectGoogle(config.id)} className={`ml-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${status.connected ? 'border border-slate-200 bg-white/75 text-slate-600 hover:border-rose-200 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300' : 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md hover:from-sky-700 hover:to-blue-700'}`}>
                      {connecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : status.connected ? <Unplug className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}{status.connected ? 'Disconnect' : status.needsReconnect ? 'Reconnect' : 'Connect'}
                    </button>
                  </div>
                </article>
              );
            })}

            <article className={`${cardClass} flex min-h-[190px] flex-col`}>
              <div className="flex items-start justify-between gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-100 bg-gradient-to-br from-white to-sky-50 text-sky-600 shadow-sm dark:border-sky-900/70 dark:from-slate-800 dark:to-sky-950/50 dark:text-sky-300"><Cloud className="h-5 w-5" /></div>{renderStatus(Boolean(driveUser))}</div>
              <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Zulora Drive</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Owner-scoped Firebase storage for files and AI reports. Anyone with a file download link may be able to open it.</p>
              {driveUser && <><div className="mt-2 truncate text-[10px] text-slate-500 dark:text-slate-400">{driveUser.email || 'Drive account connected'}</div><div className="mt-1 text-[10px] text-slate-600 dark:text-slate-300">{formatBytes(driveUsage.usedBytes)} indexed usage · Firebase manages bucket quota</div></>}
              <div className="mt-auto flex items-center justify-between pt-3"><span className="text-[10px] text-slate-400">{driveUser ? 'Storage ready' : 'Separate Drive account sign-in'}</span><button type="button" disabled={Boolean(busy)} onClick={async () => { setBusy('drive'); setNotice(''); try { if (driveUser) await zuloraDriveService.disconnect(); else await connectDrive(); await refresh(); } catch (error) { setNotice(error.message); } finally { setBusy(''); } }} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold disabled:opacity-60 ${driveUser ? 'border border-slate-200 bg-white/75 text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300' : 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md'}`}>{busy === 'drive' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : driveUser ? <Unplug className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}{driveUser ? 'Disconnect' : 'Connect'}</button></div>
            </article>
          </div>

          {driveUser && <section className="mt-3 rounded-2xl border border-sky-100/90 bg-white/85 p-4 shadow-[0_12px_36px_rgba(30,105,180,0.08)] backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/75">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Drive files</h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{driveFiles.length} indexed files · {formatBytes(driveUsage.usedBytes)} used. Firebase does not expose a per-user storage quota or separate Drive upgrade plan.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {driveFiles.length > 0 && <button type="button" disabled={Boolean(busy)} onClick={clearAllDriveFiles} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white/80 px-3 text-xs font-bold text-rose-600 disabled:opacity-60 dark:border-rose-900/60 dark:bg-slate-950/40 dark:text-rose-300">
                  {busy === 'drive-clear' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete all
                </button>}
                <button type="button" disabled={Boolean(busy)} onClick={() => driveFileInputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 px-3.5 text-xs font-bold text-white shadow-md disabled:opacity-60">
                  {busy === 'drive-upload' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload files
                </button>
              </div>
              <input ref={driveFileInputRef} type="file" multiple className="hidden" onChange={uploadDriveFiles} accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {driveFiles.slice(0, 8).map(file => <div key={file.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200/70 bg-white/70 p-2.5 dark:border-slate-700/70 dark:bg-slate-950/35">
                {file.type?.startsWith('image/') && file.downloadURL
                  ? <img src={file.downloadURL} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300"><FileText className="h-4 w-4" /></div>}
                <div className="min-w-0 flex-1">
                  <a href={file.downloadURL} target="_blank" rel="noreferrer" className="block truncate text-xs font-semibold text-sky-700 hover:underline dark:text-sky-300">{file.name}</a>
                  <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{formatBytes(file.size)} · {file.folderPath || 'My Drive'}</div>
                </div>
                <button type="button" aria-label={`Delete ${file.name}`} title="Delete file" disabled={Boolean(busy)} onClick={() => deleteDriveFile(file)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
              </div>)}
              {!driveFiles.length && <p className="col-span-full rounded-xl bg-slate-50/80 p-3 text-xs text-slate-500 dark:bg-slate-950/30 dark:text-slate-400">No files have been uploaded yet.</p>}
            </div>
            {driveFiles.length > 8 && <p className="mt-2 text-[10px] text-slate-400">Showing 8 recent files. Ask Zulora AI to search the full Drive index.</p>}
          </section>}

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200/70 bg-white/60 p-3 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-400"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" /><span>OAuth access tokens stay in memory for this browser session and are not written to LocalStorage or Firestore. Reconnect after the session or token expires. Google prompts for consent on first use.</span><ChevronRight className="mt-0.5 ml-auto h-3.5 w-3.5 shrink-0" /></div>
        </div>
      </section>
    </div>
  );
}
