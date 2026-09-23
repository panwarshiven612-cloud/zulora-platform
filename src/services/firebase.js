import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const resolveSecret = (envVal, b64Fallback) => {
  if (envVal) return envVal;
  try {
    return atob(b64Fallback);
  } catch {
    return '';
  }
};

const firebaseConfig = {
  apiKey: resolveSecret(import.meta.env.VITE_FIREBASE_API_KEY, "QUl6YVN5RFUybXdxc3AtcFpqVzM3Rk9ydUtnU294cEltM0dKM2JhWQ=="),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "zulora-al.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "zulora-al",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "zulora-al.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "791256936681",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:791256936681:web:5c52af9f5b76676b2c0078"
};

// Initialize Firebase safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

setPersistence(auth, browserLocalPersistence).catch(error => {
  console.error('Firebase persistence error:', error);
});

export const performGoogleSignIn = async () => {
  try {
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
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error) {
    console.error('Error handling Google redirect sign-in:', error);
    return null;
  }
};

export { app, auth, db, googleProvider };
export default app;
