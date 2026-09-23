import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export const authService = {
  /**
   * Sign in using Google OAuth with popup, with redirect fallback
   */
  async signInWithGoogle() {
    try {
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, googleProvider);
      return { success: true, user: result.user };
    } catch (error) {
      console.warn('Firebase signInWithPopup note:', error.code, error.message);

      // If popup was blocked or closed, try redirect
      if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
        try {
          await signInWithRedirect(auth, googleProvider);
          return { success: true, pendingRedirect: true };
        } catch (redirectError) {
          console.error('Firebase redirect sign-in error:', redirectError);
        }
      }

      // Return error code and message for UI handling
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  },

  /** Sign out the Firebase user. */
  async signOut() {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  },

  /**
   * Subscribe to auth changes
   */
  onAuthStateChange(callback) {
    return onAuthStateChanged(auth, callback);
  }
};

export default authService;
