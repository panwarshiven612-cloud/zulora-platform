import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBGOtawcfRqXTm7jw5P3DB0qhJCUTmfyDc',
  authDomain: 'zulora-drive.firebaseapp.com',
  projectId: 'zulora-drive',
  storageBucket: 'zulora-drive.firebasestorage.app',
  messagingSenderId: '715420173020',
  appId: '1:715420173020:web:46245edda3eb0f31edaa19',
  measurementId: 'G-ZZHB448LN5'
};

// Keep Drive isolated from the app's existing Firebase project. Reusing the
// default app here would silently point Drive operations at zulora-al.
const existingDriveApp = getApps().find(existing => existing.options.appId === firebaseConfig.appId);
const app = existingDriveApp
  ? getApp(existingDriveApp.name)
  : initializeApp(firebaseConfig, 'zulora-drive');

export const driveStorage = getStorage(app);
export const driveDb = getFirestore(app);
export const driveAuth = getAuth(app);
export default app;
