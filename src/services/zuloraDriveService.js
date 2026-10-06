import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref, uploadBytesResumable
} from 'firebase/storage';
import { driveAuth, driveDb, driveStorage } from '../config/firebaseDrive';
import { uploadToCloudinary } from './cloudinaryService';

const FILES_COLLECTIONS = ['user_drive_files', 'files', 'drive_files', 'driveFiles'];
const MAX_SEARCH_FILES = 300;
const MAX_INDEXED_TEXT_LENGTH = 24_000;

const normalizeFolderPath = path => String(path || '')
  .split('/')
  .map(part => part.trim())
  .filter(Boolean)
  .join('/');

const safeFileName = name => String(name || 'untitled')
  .replace(/[\\/]+/g, '_')
  .replace(/[\u0000-\u001f]/g, '')
  .slice(0, 180) || 'untitled';

const currentDriveUid = () => {
  const uid = driveAuth.currentUser?.uid;
  if (!uid) throw new Error('Connect Zulora Drive before using its files.');
  return uid;
};

const isPermissionDenied = error => error?.code === 'permission-denied'
  || /missing or insufficient permissions/i.test(String(error?.message || ''));
const readIndexSnapshot = (collectionName, read) => read().catch(error => {
  // The new index collection can be denied until the updated Firebase rules
  // are deployed. Existing indexes remain readable during that rollout.
  if (collectionName === 'user_drive_files' && isPermissionDenied(error)) return { docs: [] };
  throw error;
});

const usageFromSnapshot = snapshot => {
  const unique = new Map(snapshot.docs.map(item => [item.id, item.data()]));
  const usedBytes = [...unique.values()].reduce((total, item) => total + (Number(item.fileSize ?? item.size) || 0), 0);
  return {
    usedBytes,
    totalBytes: usedBytes,
    remainingBytes: null,
    capacityBytes: null,
    capacityAvailable: false,
    filesCount: unique.size,
    note: 'Usage counts indexed files. Firebase does not expose a per-user remaining bucket quota to the web SDK.'
  };
};

async function indexTextFromFile(file) {
  if (typeof file?.searchableText === 'string') return file.searchableText.slice(0, MAX_INDEXED_TEXT_LENGTH);
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  const textLike = mime.startsWith('text/') || /\.(txt|md|csv|json|html|xml|log)$/i.test(name);
  if (!textLike || typeof file?.text !== 'function' || file.size > 2_000_000) return '';
  try { return (await file.text()).slice(0, MAX_INDEXED_TEXT_LENGTH); }
  catch { return ''; }
}

export const zuloraDriveService = {
  async connect() {
    if (driveAuth.currentUser) return driveAuth.currentUser;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(driveAuth, provider);
    return result.user;
  },

  async disconnect() {
    await signOut(driveAuth);
  },

  async uploadFileToDrive(file, folderPath = '', { onProgress } = {}) {
    const blobLike = typeof Blob !== 'undefined' && file instanceof Blob;
    const fileLike = file && Number.isFinite(Number(file.size)) && typeof file.arrayBuffer === 'function';
    if (!blobLike && !fileLike) throw new Error('Choose a file to upload to Zulora Drive.');
    const originalName = String(file.name || 'upload');
    if (!blobLike) {
      const bytes = await file.arrayBuffer();
      file = new Blob([bytes], { type: file.type || 'application/octet-stream' });
    }
    const uid = currentDriveUid();
    const id = `file_${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
    const name = safeFileName(originalName || 'generated-report.txt');
    const folder = normalizeFolderPath(folderPath);
    const now = new Date();
    const storagePath = `users/${uid}/drive/${id}-${name}`;
    const storageRef = ref(driveStorage, storagePath);
    const searchableText = await indexTextFromFile(file);
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file, {
        contentType: file.type || 'application/octet-stream',
        customMetadata: { ownerUid: uid, fileId: id }
      });
      const timer = setTimeout(() => {
        task.cancel();
        reject(new Error('Upload timed out. Check your connection and try again.'));
      }, 180_000);
      task.on('state_changed', snapshot => {
        const ratio = snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
        onProgress?.({ percent: Math.min(100, Math.round(ratio * 100)), bytesTransferred: snapshot.bytesTransferred, totalBytes: snapshot.totalBytes });
      }, error => {
        clearTimeout(timer);
        reject(error);
      }, () => {
        clearTimeout(timer);
        resolve();
      });
    });

    try {
      const downloadURL = await getDownloadURL(storageRef);
      const createdAt = serverTimestamp();
      const metadata = {
        id,
        uid,
        name,
        folderPath: folder,
        storagePath,
        downloadURL,
        fileId: id,
        fileName: name,
        fileUrl: downloadURL,
        cloudinaryUrl: '',
        fileType: file.type || 'application/octet-stream',
        mimeType: file.type || 'application/octet-stream',
        fileSize: Number(file.size) || 0,
        uploadedFrom: 'Zulora AI Workspace',
        createdAt,
        createdAtMs: Date.now(),
        isPublic: true,
        type: file.type || 'application/octet-stream',
        size: Number(file.size) || 0,
        uploadTime: Date.now(),
        searchableText,
        updatedAt: Date.now()
      };
      try { await setDoc(doc(driveDb, 'users', uid, 'user_drive_files', id), metadata); }
      catch (error) {
        if (isPermissionDenied(error)) {
          console.info('The updated Drive index rule is not deployed yet; the file remains available in the legacy Drive indexes.');
        } else {
          throw error;
        }
      }
      const legacyBatch = writeBatch(driveDb);
      for (const collectionName of FILES_COLLECTIONS.filter(name => name !== 'user_drive_files')) {
        legacyBatch.set(doc(driveDb, 'users', uid, collectionName, id), metadata);
      }
      await legacyBatch.commit();
      onProgress?.({ percent: 100, bytesTransferred: file.size, totalBytes: file.size, stage: 'saved' });

      // Non-blocking Cloudinary mirror: runs in background so upload modal never hangs
      uploadToCloudinary(file, `users/${uid}/drive`, () => {}, 30_000)
        .then(async cRes => {
          if (!cRes?.url) throw new Error('Cloudinary returned no file URL.');
          const cloudinaryMetadata = {
            cloudinaryUrl: cRes.url,
            cloudinaryPublicId: cRes.publicId || '',
            cloudinaryResourceType: cRes.resourceType || '',
            name,
            fileName: name,
            fileType: file.type || 'application/octet-stream',
            mimeType: file.type || 'application/octet-stream',
            type: file.type || 'application/octet-stream',
            fileSize: Number(file.size) || 0,
            updatedAt: Date.now()
          };
          await Promise.all(FILES_COLLECTIONS.map(collectionName => setDoc(
            doc(driveDb, 'users', uid, collectionName, id), cloudinaryMetadata, { merge: true }
          ).catch(error => {
            console.warn(`[Drive Cloudinary Metadata] Could not update ${collectionName}:`, error.message);
          })));
        })
        .catch(cErr => console.warn('[Drive Cloudinary Mirror] Skipped or timed out:', cErr.message));

      return metadata;
    } catch (error) {
      await Promise.all(FILES_COLLECTIONS.map(collectionName => deleteDoc(doc(driveDb, 'users', uid, collectionName, id)).catch(() => {})));
      await deleteObject(storageRef).catch(() => {});
      throw new Error(`The file uploaded, but Drive could not save its directory record: ${error.message}`);
    }
  },

  async listFilesFromDrive(path = '') {
    const uid = currentDriveUid();
    const folderPath = normalizeFolderPath(path);
    const snapshots = await Promise.all(FILES_COLLECTIONS.map(collectionName => readIndexSnapshot(collectionName, () => getDocs(query(
      collection(driveDb, 'users', uid, collectionName), where('folderPath', '==', folderPath), limit(MAX_SEARCH_FILES)
    )))));
    const byId = new Map(snapshots.flatMap(snapshot => snapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }])));
    const files = [...byId.values()].sort((a, b) => Number(b.createdAtMs ?? b.createdAt) - Number(a.createdAtMs ?? a.createdAt));

    // Folders are virtual paths derived from indexed file metadata.
    const allSnapshots = folderPath ? await Promise.all(FILES_COLLECTIONS.map(collectionName => readIndexSnapshot(collectionName, () => getDocs(query(
      collection(driveDb, 'users', uid, collectionName), limit(MAX_SEARCH_FILES)
    ))))) : snapshots;
    const folders = [...new Set(allSnapshots.flatMap(snapshot => snapshot.docs.map(item => normalizeFolderPath(item.data().folderPath))
      .filter(item => item && item !== folderPath)
      .map(item => item.slice(folderPath ? folderPath.length + 1 : 0).split('/')[0])
      .filter(Boolean)))].sort((a, b) => a.localeCompare(b));

    return { path: folderPath, files, folders };
  },

  async searchDriveFiles(searchText) {
    const uid = currentDriveUid();
    const terms = String(searchText || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const snapshots = await Promise.all(FILES_COLLECTIONS.map(collectionName => readIndexSnapshot(collectionName, () => getDocs(query(
      collection(driveDb, 'users', uid, collectionName), limit(MAX_SEARCH_FILES)
    )))));
    const files = [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]))).values()];
    return files
      .map(file => {
        const haystack = `${file.name || ''} ${file.folderPath || ''} ${file.searchableText || ''}`.toLowerCase();
        const matchedTerms = terms.filter(term => haystack.includes(term)).length;
        return { ...file, matchedTerms };
      })
      .filter(file => file.matchedTerms === terms.length)
      .sort((a, b) => b.matchedTerms - a.matchedTerms || Number(b.createdAtMs ?? b.updatedAt) - Number(a.createdAtMs ?? a.updatedAt));
  },

  async getStorageUsage() {
    const uid = currentDriveUid();
    const snapshots = await Promise.all(FILES_COLLECTIONS.map(collectionName => readIndexSnapshot(collectionName, () => getDocs(collection(driveDb, 'users', uid, collectionName)))));
    return usageFromSnapshot({ docs: [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(item => [item.id, item]))).values()], size: 0 });
  },

  watchStorageUsage(onUpdate, onError = () => {}) {
    const uid = currentDriveUid();
    const snapshotsByCollection = new Map();
    let stopped = false;
    const publish = () => {
      if (stopped) return;
      const docs = [...new Map([...snapshotsByCollection.values()].flatMap(snapshot => snapshot.docs.map(item => [item.id, item]))).values()];
      onUpdate(usageFromSnapshot({ docs, size: docs.length }));
    };
    const unsubscribes = FILES_COLLECTIONS.map(collectionName => onSnapshot(
      collection(driveDb, 'users', uid, collectionName), snapshot => { snapshotsByCollection.set(collectionName, snapshot); publish(); }, error => {
        if (collectionName !== 'user_drive_files' || !isPermissionDenied(error)) onError(error);
      }
    ));
    return () => { stopped = true; unsubscribes.forEach(unsubscribe => unsubscribe()); };
  },

  async listAllDriveFiles() {
    const uid = currentDriveUid();
    const snapshots = await Promise.all(FILES_COLLECTIONS.map(collectionName => readIndexSnapshot(collectionName, () => getDocs(query(
      collection(driveDb, 'users', uid, collectionName), limit(MAX_SEARCH_FILES)
    )))));
    return [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]))).values()]
      .sort((a, b) => Number(b.createdAtMs ?? b.updatedAt) - Number(a.createdAtMs ?? a.updatedAt));
  },

  async deleteDriveFile(fileId) {
    const uid = currentDriveUid();
    const fileRefs = FILES_COLLECTIONS.map(collectionName => doc(driveDb, 'users', uid, collectionName, String(fileId)));
    const snapshots = await Promise.all(fileRefs.map((reference, index) => {
      const collectionName = FILES_COLLECTIONS[index];
      return getDoc(reference).catch(error => {
        if (collectionName === 'user_drive_files' && isPermissionDenied(error)) return { exists: () => false };
        throw error;
      });
    }));
    const source = snapshots.find(snapshot => snapshot.exists());
    if (!source) return false;
    const metadata = source.data();
    if (metadata.uid !== uid) throw new Error('This Drive file does not belong to the signed-in account.');
    if (metadata.storagePath) {
      try { await deleteObject(ref(driveStorage, metadata.storagePath)); }
      catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
    }
    await Promise.all(fileRefs.map(reference => deleteDoc(reference).catch(() => {})));
    return true;
  },

  async clearDriveFiles() {
    const uid = currentDriveUid();
    const files = await this.listAllDriveFiles();
    const results = await Promise.allSettled(files.map(async item => {
      const metadata = item;
      if (metadata.uid !== uid) throw new Error('A Drive record did not belong to the signed-in account.');
      if (metadata.storagePath) {
        try { await deleteObject(ref(driveStorage, metadata.storagePath)); }
        catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
      }
      await Promise.all(FILES_COLLECTIONS.map(collectionName => deleteDoc(doc(driveDb, 'users', uid, collectionName, item.id)).catch(() => {})));
    }));
    const failed = results.filter(result => result.status === 'rejected').length;
    return { deleted: results.length - failed, failed };
  }
};

export async function uploadGeneratedAssetToDrive(asset) {
  if (!driveAuth.currentUser) throw new Error('Connect Zulora Drive in the Connectors panel to sync generated media.');
  const url = String(asset?.url || asset?.fileUrl || '').trim();
  if (!url) throw new Error('The generated file has no download URL.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch generated media for Drive upload (HTTP ${response.status}).`);
  const blob = await response.blob();
  const mimeType = blob.type || asset.fileType || (asset.type === 'video' ? 'video/webm' : 'image/png');
  const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('pdf') ? 'pdf' : 'png';
  const fileName = safeFileName(asset.fileName || asset.name || `zulora-${asset.type || 'asset'}-${Date.now()}.${extension}`);
  const file = new File([blob], fileName, { type: mimeType });
  return zuloraDriveService.uploadFileToDrive(file, asset.folderPath || 'Generated Media');
}

export const uploadFileToDrive = (...args) => zuloraDriveService.uploadFileToDrive(...args);
export const listFilesFromDrive = (...args) => zuloraDriveService.listFilesFromDrive(...args);
export const searchDriveFiles = (...args) => zuloraDriveService.searchDriveFiles(...args);
export const listAllDriveFiles = (...args) => zuloraDriveService.listAllDriveFiles(...args);
export const deleteDriveFile = (...args) => zuloraDriveService.deleteDriveFile(...args);
export const clearDriveFiles = (...args) => zuloraDriveService.clearDriveFiles(...args);

export default zuloraDriveService;
