/**
 * messaging.ts — Firebase Cloud Messaging (FCM) Push Notification Manager
 */
import { getToken, onMessage, type Messaging } from 'firebase/messaging';
import { doc, setDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';

let messagingInstance: Messaging | null = null;

async function getMessaging(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;
  try {
    const firebaseModule = await import('./firebase') as any;
    messagingInstance = firebaseModule.messaging || null;
    return messagingInstance;
  } catch {
    return null;
  }
}

export async function requestPushPermission(userId: string, db: any): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const messaging = await getMessaging();
    if (!messaging) return null;

    const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || '';
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
    });

    if (token && userId && db) {
      await setDoc(
        doc(db, 'users', userId),
        { fcmTokens: arrayUnion(token), fcmUpdatedAt: serverTimestamp() },
        { merge: true }
      );
      console.log('[FCM] Token saved for user:', userId);
    }
    return token;
  } catch (err) {
    console.warn('[FCM] requestPushPermission failed:', err);
    return null;
  }
}

export function onForegroundPushNotification(callback: (payload: any) => void): (() => void) | null {
  if (typeof window === 'undefined') return null;
  let unsubscribe: (() => void) | null = null;
  getMessaging().then((messaging) => {
    if (!messaging) return;
    unsubscribe = onMessage(messaging, (payload) => {
      console.log('[FCM] Foreground message:', payload);
      callback(payload);
      // Show browser notification if page is visible
      if (document.visibilityState === 'visible' && payload.notification) {
        new Notification(payload.notification.title || 'Zulora AI', {
          body: payload.notification.body || '',
          icon: '/icon-192.png'
        });
      }
    });
  });
  return () => { unsubscribe?.(); };
}
