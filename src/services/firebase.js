import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
} from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDU2mwqs-pZjW37FOruKgSoxpIm3GJ3baY',
  authDomain: 'zulora-al.firebaseapp.com',
  projectId: 'zulora-al',
  storageBucket: 'zulora-al.firebasestorage.app',
  messagingSenderId: '791256936681',
  appId: '1:791256936681:web:5c52af9f5b76676b2c0078'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
export const firestorePersistenceReady = enableIndexedDbPersistence(db).then(() => true).catch(error => {
  // Persistence can already be owned by another tab or unavailable in some browsers.
  if (error?.code !== 'failed-precondition' && error?.code !== 'unimplemented') {
    console.warn('Firestore offline persistence is unavailable:', error.message);
  }
  return false;
});
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(error => {
  console.error('Firebase persistence error:', error);
  return null;
});

export const authStateReady = authPersistenceReady.then(() => new Promise(resolve => {
  let unsubscribe = () => {};
  let settled = false;
  const finish = user => {
    if (settled) return;
    settled = true;
    unsubscribe();
    resolve(user || null);
  };
  unsubscribe = onAuthStateChanged(auth, finish, error => {
    console.error('Firebase initial auth state error:', error);
    finish(null);
  });
  if (settled) unsubscribe();
}));

export const waitForAuthInitialization = () => authStateReady;

export const performGoogleSignIn = async () => {
  try {
    await authPersistenceReady;
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.warn('Google popup sign-in failed; falling back to redirect:', error);
    if (
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
};

export const handleGoogleSignIn = performGoogleSignIn;

export const checkRedirectResult = async () => {
  try {
    await authPersistenceReady;
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error) {
    console.error('Error handling Google redirect sign-in:', error);
    return null;
  }
};

export const checkAuthRedirect = checkRedirectResult;

export { app, auth, db, storage };
export default app;
