import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';

const DEMO_USER_STORAGE_KEY = 'zulora_demo_user';

export const authService = {
  /**
   * Sign in using Google OAuth with popup, with redirect fallback
   */
  async signInWithGoogle() {
    try {
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, googleProvider);
      // Clear any previous demo user
      localStorage.removeItem(DEMO_USER_STORAGE_KEY);
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

  /**
   * Demo / Guest Sign In
   * Allows full app testing even if the origin is pending in Firebase Console
   */
  signInAsDemoUser(customProfile = {}) {
    const demoUser = {
      uid: customProfile.uid || 'demo-user-' + Math.random().toString(36).substring(2, 9),
      displayName: customProfile.displayName || 'Guest Explorer',
      email: customProfile.email || 'guest@zulora.ai',
      photoURL: customProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
      isDemo: true
    };
    localStorage.setItem(DEMO_USER_STORAGE_KEY, JSON.stringify(demoUser));
    return demoUser;
  },

  /**
   * Check if demo user is stored
   */
  getStoredDemoUser() {
    try {
      const stored = localStorage.getItem(DEMO_USER_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  /**
   * Sign out user from both Firebase and demo storage
   */
  async signOut() {
    localStorage.removeItem(DEMO_USER_STORAGE_KEY);
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
    return onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        callback(firebaseUser);
      } else {
        const demoUser = this.getStoredDemoUser();
        callback(demoUser || null);
      }
    });
  }
};

export default authService;
