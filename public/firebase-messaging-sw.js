/* eslint-disable no-undef */
/**
 * firebase-messaging-sw.js
 * Firebase Cloud Messaging Service Worker
 * ----------------------------------------
 * Handles background push notifications for Zulora AI.
 * Deep-links directly back to the active chat session upon notification click.
 */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDU2mwqs-pZjW37FOruKgSoxpIm3GJ3baY',
  authDomain: 'zulora-al.firebaseapp.com',
  projectId: 'zulora-al',
  storageBucket: 'zulora-al.firebasestorage.app',
  messagingSenderId: '791256936681',
  appId: '1:791256936681:web:5c52af9f5b76676b2c0078',
  measurementId: 'G-4FX84TSHEM'
});

const messaging = firebase.messaging();

/**
 * Handle background push notifications (app not in focus)
 */
messaging.onBackgroundMessage(payload => {
  const { title = 'Your response is ready', body = 'Your Zulora AI response has finished generating.' } = payload.notification || {};
  const data = payload.data || {};
  const notificationOptions = {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data,
    tag: data.sessionId ? `zulora-complete-${data.sessionId}` : 'zulora-push',
    renotify: true
  };
  self.registration.showNotification(title, notificationOptions);
});

/**
 * Handle notification click — deep-link directly back to chat session and page
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || (data.sessionId ? `/dashboard?session=${data.sessionId}` : '/dashboard');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes('/dashboard') || client.url.includes('/chat')) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
