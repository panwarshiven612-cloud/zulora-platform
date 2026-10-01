import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, where
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref, uploadBytes
} from 'firebase/storage';
import { driveAuth, driveDb, driveStorage } from '../config/firebaseDrive';

const FILES_COLLECTION = 'driveFiles';
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

const usageFromSnapshot = snapshot => {
  const usedBytes = snapshot.docs.reduce((total, item) => total + (Number(item.data().size) || 0), 0);
  return {
    usedBytes,
    totalBytes: usedBytes,
    remainingBytes: null,
    capacityBytes: null,
    capacityAvailable: false,
    filesCount: snapshot.size,
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

  async uploadFileToDrive(file, folderPath = '') {
    if (!(file instanceof Blob)) throw new Error('Choose a file to upload to Zulora Drive.');
    const uid = currentDriveUid();
    const id = `file_${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
    const name = safeFileName(file.name || 'generated-report.txt');
    const folder = normalizeFolderPath(folderPath);
    const storagePath = `users/${uid}/drive/${id}/${name}`;
    const storageRef = ref(driveStorage, storagePath);
    const searchableText = await indexTextFromFile(file);
    await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
      customMetadata: { ownerUid: uid, fileId: id }
    });

    try {
      const downloadURL = await getDownloadURL(storageRef);
      const metadata = {
        id,
        uid,
        name,
        folderPath: folder,
        storagePath,
        downloadURL,
        type: file.type || 'application/octet-stream',
        size: Number(file.size) || 0,
        searchableText,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await setDoc(doc(driveDb, 'users', uid, FILES_COLLECTION, id), metadata);
      return metadata;
    } catch (error) {
      await deleteObject(storageRef).catch(() => {});
      throw new Error(`The file uploaded, but Drive could not save its directory record: ${error.message}`);
    }
  },

  async listFilesFromDrive(path = '') {
    const uid = currentDriveUid();
    const folderPath = normalizeFolderPath(path);
    const filesQuery = query(
      collection(driveDb, 'users', uid, FILES_COLLECTION),
      where('folderPath', '==', folderPath),
      limit(MAX_SEARCH_FILES)
    );
    const snapshot = await getDocs(filesQuery);
    const files = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

    // Folders are virtual paths derived from indexed file metadata.
    const allSnapshot = folderPath ? await getDocs(query(
      collection(driveDb, 'users', uid, FILES_COLLECTION), limit(MAX_SEARCH_FILES)
    )) : snapshot;
    const folders = [...new Set(allSnapshot.docs
      .map(item => normalizeFolderPath(item.data().folderPath))
      .filter(item => item && item !== folderPath)
      .map(item => item.slice(folderPath ? folderPath.length + 1 : 0).split('/')[0])
      .filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return { path: folderPath, files, folders };
  },

  async searchDriveFiles(searchText) {
    const uid = currentDriveUid();
    const terms = String(searchText || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const snapshot = await getDocs(query(
      collection(driveDb, 'users', uid, FILES_COLLECTION),
      orderBy('createdAt', 'desc'),
      limit(MAX_SEARCH_FILES)
    ));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .map(file => {
        const haystack = `${file.name || ''} ${file.folderPath || ''} ${file.searchableText || ''}`.toLowerCase();
        const matchedTerms = terms.filter(term => haystack.includes(term)).length;
        return { ...file, matchedTerms };
      })
      .filter(file => file.matchedTerms === terms.length)
      .sort((a, b) => b.matchedTerms - a.matchedTerms || Number(b.updatedAt) - Number(a.updatedAt));
  },

  async getStorageUsage() {
    const uid = currentDriveUid();
    const snapshot = await getDocs(collection(driveDb, 'users', uid, FILES_COLLECTION));
    return usageFromSnapshot(snapshot);
  },

  watchStorageUsage(onUpdate, onError = () => {}) {
    const uid = currentDriveUid();
    return onSnapshot(
      collection(driveDb, 'users', uid, FILES_COLLECTION),
      snapshot => onUpdate(usageFromSnapshot(snapshot)),
      onError
    );
  },

  async listAllDriveFiles() {
    const uid = currentDriveUid();
    const snapshot = await getDocs(query(
      collection(driveDb, 'users', uid, FILES_COLLECTION),
      orderBy('createdAt', 'desc'),
      limit(MAX_SEARCH_FILES)
    ));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  },

  async deleteDriveFile(fileId) {
    const uid = currentDriveUid();
    const fileRef = doc(driveDb, 'users', uid, FILES_COLLECTION, String(fileId));
    const snapshot = await getDoc(fileRef);
    if (!snapshot.exists()) return false;
    const metadata = snapshot.data();
    if (metadata.uid !== uid) throw new Error('This Drive file does not belong to the signed-in account.');
    if (metadata.storagePath) {
      try { await deleteObject(ref(driveStorage, metadata.storagePath)); }
      catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
    }
    await deleteDoc(fileRef);
    return true;
  },

  async clearDriveFiles() {
    const uid = currentDriveUid();
    const snapshot = await getDocs(collection(driveDb, 'users', uid, FILES_COLLECTION));
    const results = await Promise.allSettled(snapshot.docs.map(async item => {
      const metadata = item.data();
      if (metadata.uid !== uid) throw new Error('A Drive record did not belong to the signed-in account.');
      if (metadata.storagePath) {
        try { await deleteObject(ref(driveStorage, metadata.storagePath)); }
        catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
      }
      await deleteDoc(item.ref);
    }));
    const failed = results.filter(result => result.status === 'rejected').length;
    return { deleted: results.length - failed, failed };
  }
};

export const uploadFileToDrive = (...args) => zuloraDriveService.uploadFileToDrive(...args);
export const listFilesFromDrive = (...args) => zuloraDriveService.listFilesFromDrive(...args);
export const searchDriveFiles = (...args) => zuloraDriveService.searchDriveFiles(...args);
export const listAllDriveFiles = (...args) => zuloraDriveService.listAllDriveFiles(...args);
export const deleteDriveFile = (...args) => zuloraDriveService.deleteDriveFile(...args);
export const clearDriveFiles = (...args) => zuloraDriveService.clearDriveFiles(...args);

export default zuloraDriveService;
