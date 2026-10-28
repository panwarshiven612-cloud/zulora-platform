/**
 * notifications.ts — Zulora AI Web Push & FCM Background Alerts
 * =============================================================
 * Handles background push notifications when a user navigates away from
 * the tab while a heavy model query or video task is generating.
 * Deep-links directly back to the active chat session upon click.
 */

import { getToken, onMessage, type Messaging } from 'firebase/messaging';
import { doc, setDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';

let messagingInstance: Messaging | null = null;

async function getMessagingInstance(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;
  if (typeof window === 'undefined') return null;
  try {
    const firebaseModule = await import('./firebase') as any;
    messagingInstance = firebaseModule.messaging || null;
    return messagingInstance;
  } catch (err) {
    console.warn('[Notifications] Failed to load firebase messaging module:', err);
    return null;
  }
}

/**
 * Requests Notification permission and registers FCM service worker token
 */
export async function requestNotificationPermission(userId?: string, db?: any): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    // Register service worker if supported
    let swReg: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      try {
        swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      } catch (swErr) {
        console.warn('[Notifications] Service worker registration error:', swErr);
      }
    }

    const messaging = await getMessagingInstance();
    if (!messaging) return 'granted';

    const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || '';
    const token = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swReg
    });

    if (token && userId && db) {
      await setDoc(
        doc(db, 'users', userId),
        { fcmTokens: arrayUnion(token), fcmUpdatedAt: serverTimestamp() },
        { merge: true }
      );
      console.log('[Notifications] FCM token registered for user:', userId);
    }
    return token;
  } catch (err) {
    console.warn('[Notifications] requestNotificationPermission encountered an error:', err);
    return null;
  }
}

export interface CompletionNotificationOptions {
  sessionId: string;
  sessionTitle?: string;
  promptSnippet?: string;
  url?: string;
  force?: boolean;
}

/**
 * Sends a background web push notification when response generation finishes
 * while the user has navigated away or minimized the window.
 */
export async function sendCompletionNotification(options: CompletionNotificationOptions): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  // Only trigger if tab is hidden (navigated away / in background) unless forced
  const isBackgrounded = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!isBackgrounded && !options.force) {
    return false;
  }

  const sessionId = options.sessionId || 'current';
  const targetUrl = options.url || `/dashboard?session=${sessionId}`;
  const title = 'Your response is ready';
  const bodyText = options.sessionTitle 
    ? `${options.sessionTitle.slice(0, 80)}`
    : (options.promptSnippet ? `"${options.promptSnippet.slice(0, 60)}..." is complete.` : 'Your Zulora AI response has finished generating.');

  const notificationData = {
    sessionId,
    url: targetUrl,
    timestamp: Date.now()
  };

  // 1. Try displaying via active Service Worker registration (native web push behavior)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js') || await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await (reg as any).showNotification(title, {
          body: bodyText,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: `zulora-complete-${sessionId}`,
          data: notificationData,
          renotify: true
        });
        return true;
      }
    } catch (swErr) {
      console.warn('[Notifications] SW showNotification fallback to DOM Notification:', swErr);
    }
  }

  // 2. Direct DOM Notification Fallback
  try {
    const notif = new Notification(title, {
      body: bodyText,
      icon: '/favicon.ico',
      tag: `zulora-complete-${sessionId}`,
      data: notificationData
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
      if (typeof window !== 'undefined') {
        window.location.href = targetUrl;
      }
    };
    return true;
  } catch (domErr) {
    console.warn('[Notifications] DOM Notification failed:', domErr);
    return false;
  }
}

export default {
  requestNotificationPermission,
  sendCompletionNotification
};
