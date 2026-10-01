import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, Cloud, CloudUpload, File, FileImage, FileText, Film,
  FolderOpen, LoaderCircle, MessageSquare, RefreshCw, Search, Trash2, Upload
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { driveAuth } from '../config/firebaseDrive';
import { firestoreService } from '../services/firestoreService';
import { uploadGeneratedAssetToDrive, zuloraDriveService } from '../services/zuloraDriveService';

const formatBytes = bytes => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
};

const driveItem = item => ({
  ...item,
  source: 'drive',
  type: item.fileType || item.type || 'application/octet-stream',
  name: item.fileName || item.name || 'Untitled file',
  url: item.fileUrl || item.downloadURL || item.cloudinaryUrl || '',
  size: Number(item.fileSize ?? item.size) || 0
});

const assetItem = item => ({
  ...item,
  source: 'workspace',
  name: item.fileName || item.name || item.prompt || 'Generated media',
  type: item.type === 'video' ? 'video/mp4' : item.type === 'image' ? 'image/png' : item.type || 'application/octet-stream',
  url: item.url || item.fileUrl || '',
  size: Number(item.fileSize ?? item.size) || 0
});

export default function Library({ onInsertIntoChat }) {
  const { currentUser } = useAuth();
  const [driveUser, setDriveUser] = useState(driveAuth.currentUser);
  const [driveFiles, setDriveFiles] = useState([]);
  const [workspaceAssets, setWorkspaceAssets] = useState([]);
  const [usage, setUsage] = useState({ usedBytes: 0, filesCount: 0, capacityBytes: null });
  const [queryText, setQueryText] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const fileInput = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const tasks = [];
    if (currentUser?.uid) {
      tasks.push(firestoreService.getUserAssets(currentUser.uid).then(items => setWorkspaceAssets(Array.isArray(items) ? items : [])).catch(() => setWorkspaceAssets([])));
    }
    if (driveAuth.currentUser) {
      tasks.push(Promise.all([zuloraDriveService.listAllDriveFiles(), zuloraDriveService.getStorageUsage()])
        .then(([files, stats]) => { setDriveFiles(files.map(driveItem)); setUsage(stats); })
        .catch(error => { setNotice(error.message); setDriveFiles([]); }));
    } else {
      setDriveFiles([]);
      setUsage({ usedBytes: 0, filesCount: 0, capacityBytes: null });
    }
    await Promise.all(tasks);
    setLoading(false);
  }, [currentUser?.uid]);

  useEffect(() => {
    let stopUsage = () => {};
    const unsubscribe = onAuthStateChanged(driveAuth, user => {
      setDriveUser(user);
      stopUsage();
      stopUsage = () => {};
      if (user) {
        try { stopUsage = zuloraDriveService.watchStorageUsage(setUsage, error => setNotice(error.message)); }
        catch (error) { setNotice(error.message); }
      }
      refresh();
    });
    return () => { unsubscribe(); stopUsage(); };
  }, [refresh]);

  const items = useMemo(() => {
    const all = [...driveFiles, ...workspaceAssets.map(assetItem)];
    const needle = queryText.trim().toLowerCase();
    return all.filter(item => {
      const mime = String(item.type || '').toLowerCase();
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document';
      return (typeFilter === 'all' || kind === typeFilter)
        && (!needle || `${item.name} ${item.prompt || ''} ${item.folderPath || ''} ${item.type}`.toLowerCase().includes(needle));
    }).sort((a, b) => Number(b.createdAtMs ?? b.createdAt) - Number(a.createdAtMs ?? a.createdAt));
  }, [driveFiles, workspaceAssets, queryText, typeFilter]);

  const connectAndUpload = async files => {
    if (!files.length) return;
    setBusy('upload'); setNotice('');
    try {
      if (!driveAuth.currentUser) await zuloraDriveService.connect();
      for (const file of files) await zuloraDriveService.uploadFileToDrive(file, 'Uploads');
      setNotice(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'} to Zulora Drive.`);
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const handleUpload = event => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    connectAndUpload(files);
  };

  const connectDrive = async () => {
    setBusy('connect'); setNotice('');
    try { await zuloraDriveService.connect(); await refresh(); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const saveToDrive = async item => {
    if (item.source === 'drive') { setNotice('This item is already saved in Zulora Drive.'); return; }
    setBusy(`save:${item.id}`); setNotice('');
    try {
      if (!driveAuth.currentUser) await zuloraDriveService.connect();
      const saved = await uploadGeneratedAssetToDrive({ ...item, fileName: item.name });
      setNotice(`Saved ${saved.name} to Zulora Drive.`);
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const deleteItem = async item => {
    if (!window.confirm(`Delete “${item.name}”${item.source === 'drive' ? ' from Zulora Drive' : ' from your Zulora AI gallery'}?`)) return;
    setBusy(`delete:${item.id}`); setNotice('');
    try {
      if (item.source === 'drive') await zuloraDriveService.deleteDriveFile(item.id);
      else await firestoreService.deleteAsset(currentUser.uid, item.id);
      setNotice(`Deleted ${item.name}.`);
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(''); }
  };

  const storagePercent = usage.capacityBytes ? Math.min(100, Math.round((usage.usedBytes / usage.capacityBytes) * 100)) : null;

  return (
    <section className="flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-3xl border border-sky-100 bg-gradient-to-br from-white via-[#f6fbff] to-[#e9f5ff] p-5 shadow-[0_18px_55px_rgba(32,113,177,0.10)] dark:border-slate-700 dark:from-[#0d1728] dark:via-[#0a1424] dark:to-[#10213a] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700 dark:border-sky-900/70 dark:bg-slate-900/60 dark:text-sky-300"><FolderOpen className="h-3.5 w-3.5" /> Asset Library</div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">Your Zulora Library</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Generated images, videos, uploaded documents, and files synchronized to Zulora Drive.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!driveUser ? <button type="button" onClick={connectDrive} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white shadow-lg shadow-sky-600/20 disabled:opacity-60"><Cloud className="h-4 w-4" />{busy === 'connect' ? 'Connecting…' : 'Connect Zulora Drive'}</button> : <div className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"><Check className="h-4 w-4" /> Drive connected</div>}
              <button type="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-200 bg-white/80 px-4 text-sm font-bold text-sky-800 hover:border-sky-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/80 dark:text-sky-200"><Upload className="h-4 w-4" />{busy === 'upload' ? 'Uploading…' : 'Upload files'}</button>
              <input ref={fileInput} type="file" multiple className="hidden" accept="image/*,video/*,.pdf,.txt,.csv,.md,.json,.doc,.docx" onChange={handleUpload} />
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/65 p-3 dark:border-slate-700/70 dark:bg-slate-950/30"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Indexed files</div><div className="mt-1 text-lg font-black text-slate-900 dark:text-white">{items.length}</div></div>
            <div className="rounded-2xl border border-white/80 bg-white/65 p-3 dark:border-slate-700/70 dark:bg-slate-950/30"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Zulora Drive storage used</div><div className="mt-1 text-lg font-black text-slate-900 dark:text-white">{formatBytes(usage.usedBytes)}</div></div>
            <div className="rounded-2xl border border-white/80 bg-white/65 p-3 dark:border-slate-700/70 dark:bg-slate-950/30"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Storage quota</div><div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{storagePercent == null ? 'Not reported by Firebase' : `${storagePercent}% used`}</div>{storagePercent != null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${storagePercent}%` }} /></div>}</div>
          </div>
          {storagePercent == null && driveUser && <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Firebase exposes indexed file sizes here, but does not return a per-user bucket capacity or plan quota.</p>}
        </header>

        {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Search your files and generated media…" className="h-11 w-full rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-sm outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900/70" /></label>
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white/70 p-1 dark:border-slate-700 dark:bg-slate-900/70">
            {[['all', 'All'], ['image', 'Images'], ['video', 'Videos'], ['document', 'Documents']].map(([value, label]) => <button key={value} type="button" onClick={() => setTypeFilter(value)} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${typeFilter === value ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{label}</button>)}
          </div>
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh library" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white/80 text-slate-500 hover:text-sky-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/70"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {loading && !items.length ? <div role="status" className="grid min-h-52 place-items-center rounded-3xl border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Loading your Library…</div>
          : items.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map(item => {
              const isImage = item.type.startsWith('image/');
              const isVideo = item.type.startsWith('video/');
              const ItemIcon = isImage ? FileImage : isVideo ? Film : FileText;
              const isBusy = busy === `save:${item.id}` || busy === `delete:${item.id}`;
              return <article key={`${item.source}:${item.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/85 shadow-[0_12px_36px_rgba(30,105,180,0.07)] dark:border-slate-700/70 dark:bg-slate-900/75">
                <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-slate-100 dark:bg-slate-950">
                  {isImage && item.url ? <img src={item.url} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                    : isVideo && item.url ? <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      : <ItemIcon className="h-12 w-12 text-sky-400" />}
                  <span className="absolute left-2 top-2 rounded-full bg-slate-950/65 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white">{item.source === 'drive' ? 'Drive' : 'Workspace'}</span>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white" title={item.name}>{item.name}</p>
                  <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{item.prompt || item.folderPath || item.type} · {formatBytes(item.size)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => onInsertIntoChat?.(item)} disabled={!item.url || isBusy} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-sky-600 px-2 text-[10px] font-bold text-white disabled:opacity-50"><MessageSquare className="h-3.5 w-3.5" /> Insert into Chat</button>
                    <button type="button" onClick={() => saveToDrive(item)} disabled={isBusy || item.source === 'drive'} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-sky-200 px-2 text-[10px] font-bold text-sky-700 disabled:opacity-50 dark:border-sky-900/70 dark:text-sky-300"><CloudUpload className="h-3.5 w-3.5" />{item.source === 'drive' ? 'In Drive' : 'Save to Drive'}</button>
                    <button type="button" onClick={() => deleteItem(item)} disabled={isBusy} className="col-span-2 inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900/70 dark:text-rose-300">{isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete</button>
                  </div>
                </div>
              </article>;
            })}
          </div>
          : <div className="grid min-h-64 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white/40 px-6 text-center dark:border-slate-700 dark:bg-slate-900/30"><div><FolderOpen className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-700" /><p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">No files match this view</p><p className="mt-1 text-xs text-slate-500">Upload a file or generate media to get started.</p></div></div>}
      </div>
    </section>
  );
}
