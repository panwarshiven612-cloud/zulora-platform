/* eslint-disable no-undef */
/**
 * firebase-messaging-sw.js
 * Firebase Cloud Messaging Service Worker
 * ----------------------------------------
 * Handles background push notifications for Zulora AI.
 * Must be placed at the root of the public/ directory.
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
  const { title = 'Zulora AI', body = 'You have a new message.' } = payload.notification || {};
  const notificationOptions = {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data || {},
    tag: 'zulora-push',
    renotify: true
  };
  self.registration.showNotification(title, notificationOptions);
});

/**
 * Handle notification click — open Zulora dashboard
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://zulora.in/dashboard';
  event.waitUntil(clients.openWindow(url));
});

