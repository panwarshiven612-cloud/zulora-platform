/**
 * firebase.ts — Zulora AI Firebase Analytics + FCM Initialization
 * ================================================================
 * Configures:
 *   1. Firebase Analytics (GA4 Measurement ID: G-4FX84TSHEM)
 *   2. Firebase Cloud Messaging (FCM) for user push notifications
 *      via a registered service worker (firebase-messaging-sw.js)
 *   3. Exports typed helpers for event logging and FCM token retrieval
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAnalytics, logEvent as gaLogEvent, isSupported as analyticsSupported } from 'firebase/analytics';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDU2mwqs-pZjW37FOruKgSoxpIm3GJ3baY',
  authDomain: 'zulora-al.firebaseapp.com',
  projectId: 'zulora-al',
  storageBucket: 'zulora-al.firebasestorage.app',
  messagingSenderId: '791256936681',
  appId: '1:791256936681:web:5c52af9f5b76676b2c0078',
  measurementId: 'G-4FX84TSHEM'
};

// Re-use the existing Firebase app to prevent duplicate initialization
const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
export { app };

// ─── 1. Analytics ─────────────────────────────────────────────────────────────
let analyticsInstance: ReturnType<typeof getAnalytics> | null = null;

export async function initializeAnalytics() {
  if (typeof window === 'undefined') return null;
  try {
    const supported = await analyticsSupported();
    if (supported) {
      analyticsInstance = getAnalytics(app);
    }
  } catch (err) {
    console.warn('[Zulora Analytics] Could not initialize:', err);
  }
  return analyticsInstance;
}

/**
 * Log a GA4 custom event
 * @param eventName - The GA4 event name (e.g. 'chat_message_sent')
 * @param params    - Additional event parameters
 */
export function logAnalyticsEvent(eventName: string, params: Record<string, any> = {}) {
  if (!analyticsInstance) return;
  try {
    gaLogEvent(analyticsInstance, eventName, params);
  } catch (err) {
    console.warn('[Zulora Analytics] Event log failed:', err);
  }
}

// Auto-initialize analytics on module load (non-blocking)
if (typeof window !== 'undefined') {
  initializeAnalytics().catch(() => {});
}

// ─── 2. Firebase Cloud Messaging (FCM) ────────────────────────────────────────
const FCM_VAPID_KEY = 'BOZulora_VAPID_KEY_PLACEHOLDER'; // Replace with real VAPID from Firebase Console

/**
 * Registers the FCM service worker and requests notification permission.
 * Stores the FCM token in Firestore under users/{uid}/fcm_token for server fan-out.
 */
export async function requestFCMPermission(userId: string): Promise<string | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (!('Notification' in window)) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[FCM] Push notification permission denied.');
      return null;
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/'
    });

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token && userId) {
      await setDoc(doc(db, 'users', userId, 'settings', 'fcm_token'), {
        token,
        updatedAt: Date.now(),
        platform: 'web'
      }, { merge: true });
    }

    return token || null;
  } catch (err) {
    console.warn('[FCM] Permission or token request failed:', err);
    return null;
  }
}

/**
 * Registers a foreground message listener (app is open & focused)
 */
export function onForegroundMessage(callback: (payload: any) => void): (() => void) {
  if (typeof window === 'undefined') return () => {};
  try {
    const messaging = getMessaging(app);
    return onMessage(messaging, callback);
  } catch {
    return () => {};
  }
}

export default {
  app,
  initializeAnalytics,
  logAnalyticsEvent,
  requestFCMPermission,
  onForegroundMessage
};

