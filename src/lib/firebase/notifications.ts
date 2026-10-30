/**
 * notifications.ts — Zulora AI Web Push, FCM Alerts & 24h Personalized Reminders
 * ==============================================================================
 * Handles:
 * 1. Background push notifications when generation finishes.
 * 2. 24-Hour Personalized Inactivity Reminders using user name, last search & project.
 * 3. Deep-links directly back to the active chat session or dashboard.
 */

import { getToken, onMessage, type Messaging } from 'firebase/messaging';
import { doc, setDoc, arrayUnion, serverTimestamp, getDoc } from 'firebase/firestore';

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

  // 1. Try displaying via active Service Worker registration
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
      console.warn('[Notifications] SW showNotification fallback:', swErr);
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

export interface PersonalizedReminderOptions {
  userName?: string;
  lastSearch?: string;
  activeProject?: string;
  url?: string;
}

/**
 * Sends a 24-hour personalized reminder notification
 */
export async function sendPersonalizedReminder(options: PersonalizedReminderOptions): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const name = options.userName || 'there';
  const projectOrTopic = options.activeProject || options.lastSearch || 'your next big project';
  const title = `Zulora is waiting for you, ${name}!`;
  const bodyText = `Let's continue building ${projectOrTopic.slice(0, 50)}. Tap to resume your session with 40k+ reasoning tokens.`;
  const targetUrl = options.url || '/dashboard';

  const notificationData = {
    type: 'inactivity_reminder',
    url: targetUrl,
    timestamp: Date.now()
  };

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js') || await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await (reg as any).showNotification(title, {
          body: bodyText,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'zulora-24h-reminder',
          data: notificationData,
          renotify: true
        });
        return true;
      }
    } catch {}
  }

  try {
    const notif = new Notification(title, {
      body: bodyText,
      icon: '/favicon.ico',
      tag: 'zulora-24h-reminder',
      data: notificationData
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
      window.location.href = targetUrl;
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether 24 hours have passed since the user's last activity
 * and triggers a personalized notification if due.
 */
export async function checkAndScheduleInactivityReminder(
  currentUser: any,
  userProfile: any,
  db?: any
): Promise<void> {
  if (!currentUser?.uid || typeof window === 'undefined') return;

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const REMINDER_KEY = `zulora_last_reminder_sent_${currentUser.uid}`;

  try {
    const lastReminderSent = Number(localStorage.getItem(REMINDER_KEY) || 0);
    // Don't spam: at most one reminder every 24 hours
    if (now - lastReminderSent < ONE_DAY_MS) return;

    let lastActiveAt = userProfile?.lastActiveAt?.seconds 
      ? userProfile.lastActiveAt.seconds * 1000 
      : (userProfile?.lastActiveAt || 0);

    // If last active was more than 24 hours ago, trigger personalized notification
    if (lastActiveAt > 0 && (now - lastActiveAt >= ONE_DAY_MS)) {
      const userName = currentUser.displayName || userProfile?.displayName || 'Friend';
      const lastSearch = userProfile?.lastSearchQuery || (userProfile?.pastSearches?.[0] || '');
      const activeProject = userProfile?.activeProjects?.[0] || 'your creative workspace';

      await sendPersonalizedReminder({
        userName,
        lastSearch,
        activeProject,
        url: '/dashboard'
      });

      localStorage.setItem(REMINDER_KEY, String(now));

      if (db) {
        await setDoc(doc(db, 'users', currentUser.uid), {
          lastReminderSentAt: now
        }, { merge: true }).catch(() => {});
      }
    }
  } catch (err) {
    console.debug('[Notifications] Inactivity reminder check:', err);
  }
}

export default {
  requestNotificationPermission,
  sendCompletionNotification,
  sendPersonalizedReminder,
  checkAndScheduleInactivityReminder
};
