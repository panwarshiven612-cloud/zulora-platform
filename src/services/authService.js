import {
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth, authPersistenceReady, performGoogleSignIn, checkRedirectResult } from './firebase';

export const authService = {
  /**
   * Sign in using Google OAuth with popup, with redirect fallback
   */
  async signInWithGoogle() {
    try {
      await authPersistenceReady;
      const user = await performGoogleSignIn();
      return { success: true, user, pendingRedirect: !user };
    } catch (error) {
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
    let unsubscribe = () => {};
    let cancelled = false;
    authPersistenceReady.then(() => {
      if (!cancelled) unsubscribe = onAuthStateChanged(auth, callback);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  },

  checkRedirectResult() {
    return checkRedirectResult();
  }
};

export default authService;
